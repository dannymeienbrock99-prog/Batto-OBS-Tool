"use strict";

const { EventEmitter } = require("node:events");
const { WebSocket } = require("ws");
const { clampNumber, deepClone, readJson, safeText, writeJsonAtomic } = require("./common.cjs");

function normalizeHeartRateSettings(value = {}) {
  const overlay = value.overlay && typeof value.overlay === "object" ? value.overlay : {};
  return {
    source: value.source === "ble" ? "ble" : "pulsoid",
    autoConnect: Boolean(value.autoConnect),
    overlay: {
      layout: ["minimal", "hologram", "bar"].includes(overlay.layout) ? overlay.layout : "hologram",
      heartColor: /^#[0-9a-f]{6}$/i.test(String(overlay.heartColor || "")) ? String(overlay.heartColor).toLowerCase() : "#ff526e",
      bpmColor: /^#[0-9a-f]{6}$/i.test(String(overlay.bpmColor || "")) ? String(overlay.bpmColor).toLowerCase() : "#ffffff",
      backgroundColor: /^#[0-9a-f]{6}$/i.test(String(overlay.backgroundColor || "")) ? String(overlay.backgroundColor).toLowerCase() : "#08121d",
      backgroundOpacity: clampNumber(overlay.backgroundOpacity, 0, 1, 0.35),
      fontSize: Math.round(clampNumber(overlay.fontSize, 16, 120, 42)),
      pulse: overlay.pulse !== false,
      showTitle: Boolean(overlay.showTitle),
      lowBpm: Math.round(clampNumber(overlay.lowBpm, 30, 180, 55)),
      highBpm: Math.round(clampNumber(overlay.highBpm, 60, 240, 150))
    }
  };
}

function parsePulsoidMessage(raw) {
  const text = String(raw || "").trim();
  if (/^\d{2,3}$/.test(text)) return { bpm: Number(text), measuredAt: Date.now() };
  const value = JSON.parse(text);
  return {
    bpm: Number(value?.data?.heart_rate ?? value?.heart_rate ?? value?.bpm),
    measuredAt: normalizeMeasuredAt(value?.measured_at ?? value?.measuredAt)
  };
}

function normalizeMeasuredAt(value, fallback = Date.now()) {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : fallback;
  }
  const numeric = typeof value === "number" || /^\d+(?:\.\d+)?$/.test(String(value || "").trim())
    ? Number(value)
    : Number.NaN;
  if (Number.isFinite(numeric) && numeric > 0) return numeric < 100_000_000_000 ? Math.round(numeric * 1000) : Math.round(numeric);
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBleHeartRate(value) {
  if (!value || typeof value.getUint8 !== "function" || value.byteLength < 2) throw new Error("Ungültiger BLE-Herzfrequenzmesswert.");
  const flags = value.getUint8(0);
  const sixteenBit = Boolean(flags & 0x01);
  if (sixteenBit && value.byteLength < 3) throw new Error("Abgeschnittener 16-Bit-BLE-Herzfrequenzmesswert.");
  return sixteenBit ? value.getUint16(1, true) : value.getUint8(1);
}

class HeartRateManager extends EventEmitter {
  constructor({ settingsFile, overlayServer } = {}) {
    super();
    this.settingsFile = settingsFile;
    this.overlayServer = overlayServer;
    this.settings = normalizeHeartRateSettings(readJson(settingsFile, {}) || {});
    this.socket = null;
    this.pulsoidToken = "";
    this.pulsoidManualDisconnect = false;
    this.reconnectTimer = null;
    this.reconnectMs = 1000;
    this.staleTimer = null;
    this.connected = false;
    this.bleConnected = false;
    this.bleDeviceName = "";
    this.bpm = 0;
    this.measuredAt = 0;
    this.sampleSource = "";
    this.minimum = 0;
    this.maximum = 0;
    this.lastError = "";
  }

  save() {
    writeJsonAtomic(this.settingsFile, this.settings);
  }

  overlayUrl() {
    const base = this.overlayServer?.status?.().overlayUrl || "";
    return base ? `${base}?only=heartRate` : "";
  }

  status() {
    const ageMs = this.measuredAt ? Math.max(0, Date.now() - this.measuredAt) : null;
    return {
      active: this.connected || this.bleConnected,
      connected: this.settings.source === "ble" ? this.bleConnected : this.connected,
      source: this.settings.source,
      sampleSource: this.sampleSource,
      previewSample: this.sampleSource === "preview",
      bpm: this.bpm,
      measuredAt: this.measuredAt,
      ageMs,
      stale: ageMs === null || ageMs > 15000,
      minimum: this.minimum,
      maximum: this.maximum,
      bleDeviceName: this.bleDeviceName,
      overlayUrl: this.overlayUrl(),
      settings: deepClone(this.settings),
      error: this.lastError
    };
  }

  updateSettings(patch = {}) {
    this.settings = normalizeHeartRateSettings({
      ...this.settings,
      ...patch,
      overlay: { ...this.settings.overlay, ...(patch.overlay || {}) }
    });
    this.save();
    this.applyOverlaySettings();
    this.emit("changed", this.status());
    return this.status();
  }

  ensureOverlayElement() {
    if (!this.overlayServer) return null;
    let element = this.overlayServer.config?.elements?.find((entry) => entry.type === "heartRate") || null;
    if (!element) {
      this.overlayServer.addElement("heartRate");
      element = this.overlayServer.config?.elements?.find((entry) => entry.type === "heartRate") || null;
    }
    return element;
  }

  applyOverlaySettings() {
    const element = this.ensureOverlayElement();
    if (!element) return null;
    const overlay = this.settings.overlay;
    return this.overlayServer.updateElement(element.id, {
      title: overlay.showTitle ? "Herzfrequenz" : "",
      textColor: overlay.bpmColor,
      accentColor: overlay.heartColor,
      backgroundColor: overlay.backgroundColor,
      backgroundOpacity: overlay.backgroundOpacity,
      fontSize: overlay.fontSize,
      settings: {
        ...(element.settings || {}),
        layout: overlay.layout,
        heartColor: overlay.heartColor,
        pulse: overlay.pulse,
        lowBpm: overlay.lowBpm,
        highBpm: overlay.highBpm
      }
    });
  }

  ingest({ bpm, measuredAt = Date.now(), source = this.settings.source } = {}) {
    const normalized = Math.round(Number(bpm));
    if (!Number.isFinite(normalized) || normalized < 25 || normalized > 250) throw new Error("Herzfrequenz liegt außerhalb des gültigen Bereichs 25–250 BPM.");
    const normalizedSource = ["pulsoid", "ble", "preview"].includes(String(source)) ? String(source) : "local";
    this.bpm = normalized;
    this.measuredAt = normalizeMeasuredAt(measuredAt);
    this.sampleSource = normalizedSource;
    this.minimum = this.minimum ? Math.min(this.minimum, normalized) : normalized;
    this.maximum = Math.max(this.maximum, normalized);
    this.lastError = "";
    clearTimeout(this.staleTimer);
    this.staleTimer = setTimeout(() => this.emit("changed", this.status()), 15000);
    this.staleTimer.unref?.();
    this.overlayServer?.publishEvent({
      type: "heart-rate",
      platform: normalizedSource,
      name: normalizedSource === "pulsoid" ? "Pulsoid" : normalizedSource === "ble" ? this.bleDeviceName || "Bluetooth" : normalizedSource === "preview" ? "Lokale Vorschau" : "Lokal",
      value: normalized,
      timestamp: this.measuredAt,
      data: { source: normalizedSource }
    });
    this.emit("sample", this.status());
    this.emit("changed", this.status());
    return this.status();
  }

  async connectPulsoid(token) {
    this.disconnectPulsoid({ manual: false, emit: false });
    this.settings.source = "pulsoid";
    this.bleConnected = false;
    this.bleDeviceName = "";
    this.save();
    this.pulsoidToken = safeText(token, 4000).trim();
    if (!this.pulsoidToken) throw new Error("Pulsoid-Zugriffstoken fehlt.");
    this.pulsoidManualDisconnect = false;
    const target = `wss://dev.pulsoid.net/api/v1/data/real_time?access_token=${encodeURIComponent(this.pulsoidToken)}`;
    const socket = new WebSocket(target, { handshakeTimeout: 10000 });
    this.socket = socket;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        if (error) reject(error); else resolve(this.status());
      };
      const timer = setTimeout(() => finish(new Error("Pulsoid-Verbindung hat zu lange gedauert.")), 11000);
      socket.on("open", () => {
        clearTimeout(timer);
        if (socket !== this.socket) return;
        this.connected = true;
        this.reconnectMs = 1000;
        this.lastError = "";
        this.emit("changed", this.status());
        finish();
      });
      socket.on("message", (data) => {
        try { this.ingest({ ...parsePulsoidMessage(data), source: "pulsoid" }); }
        catch (error) { this.lastError = safeText(error?.message || error, 500); }
      });
      socket.on("error", (error) => {
        this.lastError = safeText(error?.message || "Pulsoid ist nicht erreichbar.", 500);
        clearTimeout(timer);
        finish(new Error(this.lastError));
      });
      socket.on("close", () => {
        clearTimeout(timer);
        if (socket !== this.socket) return;
        this.socket = null;
        this.connected = false;
        this.emit("changed", this.status());
        finish(new Error(this.lastError || "Pulsoid wurde getrennt."));
        this.schedulePulsoidReconnect();
      });
    });
  }

  schedulePulsoidReconnect() {
    clearTimeout(this.reconnectTimer);
    if (this.pulsoidManualDisconnect || !this.pulsoidToken || this.settings.source !== "pulsoid") return;
    const delay = this.reconnectMs;
    this.reconnectMs = Math.min(30000, Math.round(this.reconnectMs * 1.8));
    this.reconnectTimer = setTimeout(() => void this.connectPulsoid(this.pulsoidToken).catch(() => {}), delay);
    this.reconnectTimer.unref?.();
  }

  disconnectPulsoid({ manual = true, emit = true } = {}) {
    this.pulsoidManualDisconnect = manual;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const socket = this.socket;
    this.socket = null;
    this.connected = false;
    try { socket?.close(1000, "Batto OBS Tool trennt Pulsoid"); } catch {}
    if (emit) this.emit("changed", this.status());
    return this.status();
  }

  forgetPulsoidToken() {
    this.disconnectPulsoid({ manual: true, emit: false });
    this.pulsoidToken = "";
    this.lastError = "";
    this.emit("changed", this.status());
    return this.status();
  }

  setBleConnected(connected, deviceName = "") {
    const next = Boolean(connected);
    if (next) {
      this.disconnectPulsoid({ manual: true, emit: false });
      this.settings.source = "ble";
      this.bleConnected = true;
      this.bleDeviceName = safeText(deviceName, 160) || "Bluetooth-Sensor";
      this.lastError = "";
      this.save();
    } else {
      this.bleConnected = false;
      this.bleDeviceName = "";
      if (this.settings.source === "ble") this.lastError = "Bluetooth-Sensor ist getrennt.";
    }
    this.emit("changed", this.status());
    return this.status();
  }

  ingestBle(bpm, measuredAt = Date.now(), deviceName = this.bleDeviceName) {
    if (this.settings.source !== "ble" || !this.bleConnected) throw new Error("Bluetooth-Sensor ist nicht verbunden.");
    this.bleDeviceName = safeText(deviceName, 160);
    return this.ingest({ bpm, measuredAt, source: "ble" });
  }

  stop() {
    this.disconnectPulsoid();
    clearTimeout(this.staleTimer);
    this.staleTimer = null;
    this.bleConnected = false;
  }
}

module.exports = {
  HeartRateManager,
  normalizeHeartRateSettings,
  normalizeMeasuredAt,
  parseBleHeartRate,
  parsePulsoidMessage
};
