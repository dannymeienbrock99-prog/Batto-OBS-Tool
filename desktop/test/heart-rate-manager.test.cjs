"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  HeartRateManager,
  normalizeMeasuredAt,
  parseBleHeartRate,
  parsePulsoidMessage
} = require("../bootstrap-2.0/src/services/heart-rate-manager.cjs");

const temp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
const remove = (directory) => fs.rmSync(directory, { recursive: true, force: true });

function dataView(bytes) {
  const buffer = Uint8Array.from(bytes).buffer;
  return new DataView(buffer);
}

function fakeOverlayServer() {
  const published = [];
  const server = {
    config: { elements: [] },
    status: () => ({ active: true, overlayUrl: "http://127.0.0.1:17830/overlay" }),
    addElement(type) {
      this.config.elements.push({ id: `${type}-1`, type, settings: {} });
    },
    updateElement(id, patch) {
      const element = this.config.elements.find((entry) => entry.id === id);
      Object.assign(element, patch);
      return element;
    },
    publishEvent(event) {
      published.push(event);
      return event;
    }
  };
  return { server, published };
}

test("BLE Heart Rate Measurement unterstützt 8- und 16-Bit-Werte", () => {
  assert.equal(parseBleHeartRate(dataView([0x00, 87])), 87);
  assert.equal(parseBleHeartRate(dataView([0x01, 150, 0])), 150);
  assert.throws(() => parseBleHeartRate(null), /Ungültiger BLE-Herzfrequenzmesswert/);
  assert.throws(() => parseBleHeartRate(dataView([0x00])), /Ungültiger BLE-Herzfrequenzmesswert/);
  assert.throws(() => parseBleHeartRate(dataView([0x01, 90])), /Abgeschnittener 16-Bit/);
});

test("Pulsoid-Nachrichten werden als JSON und als reine BPM-Zahl gelesen", () => {
  const json = parsePulsoidMessage(Buffer.from(JSON.stringify({
    measured_at: 1_725_000_000_000,
    data: { heart_rate: 93 }
  })));
  assert.deepEqual(json, { bpm: 93, measuredAt: 1_725_000_000_000 });

  const iso = parsePulsoidMessage(JSON.stringify({
    measured_at: "2026-08-18T12:34:56.789Z",
    data: { heart_rate: 101 }
  }));
  assert.deepEqual(iso, { bpm: 101, measuredAt: Date.parse("2026-08-18T12:34:56.789Z") });
  assert.equal(normalizeMeasuredAt(1_725_000_000), 1_725_000_000_000, "Unix-Sekunden werden in Millisekunden normalisiert");

  const plain = parsePulsoidMessage(" 81 ");
  assert.equal(plain.bpm, 81);
  assert.ok(Number.isFinite(plain.measuredAt));
  assert.throws(() => parsePulsoidMessage("keine Herzfrequenz"), SyntaxError);
});

test("Lokale Vorschau bleibt als Vorschau erkennbar und gibt sich nicht als Bluetooth-Sensor aus", () => {
  const directory = temp("batto-heart-preview");
  const { server, published } = fakeOverlayServer();
  const manager = new HeartRateManager({ settingsFile: path.join(directory, "heart-rate.json"), overlayServer: server });
  try {
    const status = manager.ingest({ bpm: 82, measuredAt: "2026-08-18T12:34:56.789Z", source: "preview" });
    assert.equal(status.connected, false);
    assert.equal(status.active, false);
    assert.equal(status.sampleSource, "preview");
    assert.equal(status.previewSample, true);
    assert.equal(status.measuredAt, Date.parse("2026-08-18T12:34:56.789Z"));
    assert.equal(published[0].platform, "preview");
    assert.equal(published[0].name, "Lokale Vorschau");
    assert.deepEqual(published[0].data, { source: "preview" });
  } finally {
    manager.stop();
    remove(directory);
  }
});

test("Token-Vergessen leert Pulsoid auch aus dem Arbeitsspeicher", () => {
  const directory = temp("batto-heart-forget");
  const manager = new HeartRateManager({ settingsFile: path.join(directory, "heart-rate.json") });
  let socketClosed = false;
  try {
    manager.settings.source = "pulsoid";
    manager.pulsoidToken = "pulsoid-secret";
    manager.connected = true;
    manager.socket = { close: () => { socketClosed = true; } };
    const status = manager.forgetPulsoidToken();
    assert.equal(socketClosed, true);
    assert.equal(manager.pulsoidToken, "");
    assert.equal(manager.pulsoidManualDisconnect, true);
    assert.equal(status.connected, false);
  } finally {
    manager.stop();
    remove(directory);
  }
});

test("Verspäteter BLE-Abbruch trennt eine aktive Pulsoid-Verbindung nicht", () => {
  const directory = temp("batto-heart-ble-abort");
  const manager = new HeartRateManager({ settingsFile: path.join(directory, "heart-rate.json") });
  try {
    manager.settings.source = "pulsoid";
    manager.connected = true;
    manager.bleConnected = true;
    const status = manager.setBleConnected(false);
    assert.equal(status.source, "pulsoid");
    assert.equal(status.connected, true);
    assert.equal(manager.connected, true);
    assert.throws(() => manager.ingestBle(90), /Bluetooth-Sensor ist nicht verbunden/);
  } finally {
    manager.stop();
    remove(directory);
  }
});

test("IPC und Renderer verwenden die geprüften Herzfrequenzpfade", () => {
  const root = path.join(__dirname, "..");
  const main = fs.readFileSync(path.join(root, "bootstrap-2.0", "src", "main.cjs"), "utf8");
  const renderer = fs.readFileSync(path.join(root, "bootstrap-2.0", "src", "renderer", "integrated.js"), "utf8");
  assert.match(main, /heart-rate:pulsoid-forget[\s\S]{0,180}forgetPulsoidToken/);
  assert.match(main, /pending\?\.devices\?\.some/);
  assert.match(main, /heart-rate:preview[\s\S]{0,160}bpm:\s*payload\.bpm/);
  assert.doesNotMatch(main, /heart-rate:preview[\s\S]{0,160}payload\.bpm\s*\|\|\s*82/);
  assert.match(renderer, /if \(bleDevice\) await disconnectBleHeartRate\(\)/);
  assert.match(renderer, /data-ble-cancel/);
  assert.match(renderer, /heart\.sampleSource === "preview"/);
});

test("HeartRateManager veröffentlicht echte Samples und hält Status sowie Overlay synchron", () => {
  const directory = temp("batto-heart-rate");
  const { server, published } = fakeOverlayServer();
  const manager = new HeartRateManager({
    settingsFile: path.join(directory, "heart-rate.json"),
    overlayServer: server
  });
  try {
    manager.updateSettings({
      source: "ble",
      overlay: {
        layout: "bar",
        heartColor: "#11AACC",
        bpmColor: "#F0F0F0",
        backgroundOpacity: 0.6,
        fontSize: 54,
        showTitle: true
      }
    });
    manager.setBleConnected(true, "Polar H10");
    const first = manager.ingestBle(88, 1_725_000_000_000, "Polar H10");
    manager.ingestBle(104, 1_725_000_001_000, "Polar H10");
    const current = manager.ingestBle(76, 1_725_000_002_000, "Polar H10");

    assert.equal(first.connected, true);
    assert.equal(first.source, "ble");
    assert.equal(first.bpm, 88);
    assert.equal(current.minimum, 76);
    assert.equal(current.maximum, 104);
    assert.equal(current.bleDeviceName, "Polar H10");
    assert.equal(current.overlayUrl, "http://127.0.0.1:17830/overlay?only=heartRate");

    assert.equal(published.length, 3);
    assert.deepEqual(published.at(-1), {
      type: "heart-rate",
      platform: "ble",
      name: "Polar H10",
      value: 76,
      timestamp: 1_725_000_002_000,
      data: { source: "ble" }
    });

    const element = server.config.elements.find((entry) => entry.type === "heartRate");
    assert.ok(element);
    assert.equal(element.title, "Herzfrequenz");
    assert.equal(element.settings.layout, "bar");
    assert.equal(element.settings.heartColor, "#11aacc");
    assert.equal(element.textColor, "#f0f0f0");

    const stored = JSON.parse(fs.readFileSync(path.join(directory, "heart-rate.json"), "utf8"));
    assert.equal(stored.source, "ble");
    assert.equal(stored.overlay.fontSize, 54);

    assert.throws(() => manager.ingestBle(24), /gültigen Bereichs 25–250 BPM/);
    assert.throws(() => manager.ingestBle(251), /gültigen Bereichs 25–250 BPM/);
    assert.throws(() => manager.ingestBle(Number.NaN), /gültigen Bereichs 25–250 BPM/);
  } finally {
    manager.stop();
    remove(directory);
  }
});
