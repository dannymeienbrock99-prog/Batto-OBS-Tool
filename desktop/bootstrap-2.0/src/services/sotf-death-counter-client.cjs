"use strict";

const { EventEmitter } = require("node:events");
const { safeText } = require("./common.cjs");

function normalizeLoopbackBaseUrl(value = "http://127.0.0.1:19447/") {
  const url = new URL(String(value));
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("Die SOTF-Todeszähler-API muss eine lokale HTTP-Adresse verwenden.");
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function number(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function normalizePlayer(player = {}) {
  return {
    rank: Math.max(0, number(player.rank)),
    id: safeText(player.id, 160),
    name: safeText(player.name || player.displayName || player.id || "Unbekannt", 160),
    sessionDeaths: Math.max(0, number(player.sessionDeaths)),
    lifetimeDeaths: Math.max(0, number(player.lifetimeDeaths)),
    online: Boolean(player.online),
    state: safeText(player.state || "unknown", 40),
    firstSeenUtc: safeText(player.firstSeenUtc, 80),
    lastSeenUtc: safeText(player.lastSeenUtc, 80),
    lastDeathUtc: safeText(player.lastDeathUtc, 80),
    lastSource: safeText(player.lastSource, 160)
  };
}

function normalizeSnapshot(value = {}) {
  const players = Array.isArray(value.players) ? value.players.slice(0, 100).map(normalizePlayer) : [];
  return {
    version: Math.max(1, number(value.version) || 1),
    title: safeText(value.title || "Sons of the Forest Todeszähler", 200),
    sessionId: safeText(value.sessionId, 200),
    generatedAtUtc: safeText(value.generatedAtUtc, 80),
    onlinePlayers: Math.max(0, number(value.onlinePlayers)),
    knownPlayers: Math.max(players.length, number(value.knownPlayers)),
    showOfflinePlayers: Boolean(value.showOfflinePlayers),
    showLifetimeDeaths: Boolean(value.showLifetimeDeaths),
    lastEvent: value.lastEvent && typeof value.lastEvent === "object" ? {
      sequence: number(value.lastEvent.sequence),
      type: safeText(value.lastEvent.type || "death", 40),
      playerId: safeText(value.lastEvent.playerId, 160),
      playerName: safeText(value.lastEvent.playerName, 160),
      sessionDeaths: Math.max(0, number(value.lastEvent.sessionDeaths)),
      lifetimeDeaths: Math.max(0, number(value.lastEvent.lifetimeDeaths)),
      atUtc: safeText(value.lastEvent.atUtc, 80),
      reason: safeText(value.lastEvent.reason, 240)
    } : null,
    players
  };
}

class SotfDeathCounterClient extends EventEmitter {
  constructor({
    baseUrl = "http://127.0.0.1:19447/",
    fetchImpl = globalThis.fetch,
    timeoutMs = 1500,
    intervalMs = 5000,
    offlineIntervalMs = 15000,
    heartbeatMs = 60000,
    moduleVersion = "0.3.3",
    bundle = null
  } = {}) {
    super();
    this.baseUrl = normalizeLoopbackBaseUrl(baseUrl);
    this.fetchImpl = fetchImpl;
    this.timeoutMs = Math.max(250, Math.min(10000, Number(timeoutMs) || 1500));
    this.intervalMs = Math.max(2000, Math.min(60000, Number(intervalMs) || 5000));
    this.offlineIntervalMs = Math.max(this.intervalMs, Math.min(120000, Number(offlineIntervalMs) || 15000));
    this.heartbeatMs = Math.max(15000, Math.min(300000, Number(heartbeatMs) || 60000));
    this.timer = null;
    this.running = false;
    this.refreshPromise = null;
    this.latest = null;
    this.connected = false;
    this.lastError = "";
    this.lastCheckedAt = 0;
    this.lastEmittedAt = 0;
    this.lastChangeSignature = "";
    this.moduleVersion = safeText(moduleVersion, 80) || "0.3.3";
    this.bundle = bundle && typeof bundle === "object" ? { ...bundle } : null;
  }

  urls() {
    return {
      baseUrl: this.baseUrl,
      snapshotUrl: new URL("api/v1/snapshot", this.baseUrl).toString(),
      healthUrl: new URL("api/v1/health", this.baseUrl).toString(),
      overlayUrl: new URL("overlay", this.baseUrl).toString()
    };
  }

  status() {
    return {
      active: this.connected,
      connected: this.connected,
      module: `CrazyBatto-SOTF-DeathCounter-Module-v${this.moduleVersion}`,
      version: this.moduleVersion,
      bundle: this.bundle,
      ...this.urls(),
      snapshot: this.latest,
      error: this.lastError,
      lastCheckedAt: this.lastCheckedAt
    };
  }

  async refresh({ throwOnError = false } = {}) {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.performRefresh({ throwOnError });
    try { return await this.refreshPromise; }
    finally { this.refreshPromise = null; }
  }

  changeSignature() {
    const snapshot = this.latest ? {
      version: this.latest.version,
      title: this.latest.title,
      sessionId: this.latest.sessionId,
      onlinePlayers: this.latest.onlinePlayers,
      knownPlayers: this.latest.knownPlayers,
      showOfflinePlayers: this.latest.showOfflinePlayers,
      showLifetimeDeaths: this.latest.showLifetimeDeaths,
      lastEvent: this.latest.lastEvent,
      players: this.latest.players.map((player) => ({
        rank: player.rank,
        id: player.id,
        name: player.name,
        sessionDeaths: player.sessionDeaths,
        lifetimeDeaths: player.lifetimeDeaths,
        online: player.online,
        state: player.state,
        lastDeathUtc: player.lastDeathUtc,
        lastSource: player.lastSource
      }))
    } : null;
    return JSON.stringify({ connected: this.connected, error: this.lastError, snapshot });
  }

  emitChangeIfNeeded(force = false) {
    const signature = this.changeSignature();
    const heartbeatDue = Date.now() - this.lastEmittedAt >= this.heartbeatMs;
    if (!force && signature === this.lastChangeSignature && !heartbeatDue) return;
    this.lastChangeSignature = signature;
    this.lastEmittedAt = Date.now();
    this.emit("changed", this.status());
  }

  async performRefresh({ throwOnError = false } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      if (typeof this.fetchImpl !== "function") throw new Error("HTTP-Abruf ist in dieser Laufzeit nicht verfügbar.");
      const response = await this.fetchImpl(this.urls().snapshotUrl, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
        headers: { accept: "application/json" }
      });
      if (!response.ok) throw new Error(`Lokale SOTF-API meldet HTTP ${response.status}.`);
      const text = await response.text();
      if (text.length > 2_000_000) throw new Error("Die SOTF-API-Antwort ist ungewöhnlich groß.");
      this.latest = normalizeSnapshot(JSON.parse(text));
      this.connected = true;
      this.lastError = "";
    } catch (error) {
      this.connected = false;
      this.lastError = error?.name === "AbortError"
        ? "Die lokale SOTF-API antwortet nicht rechtzeitig. Läuft das RedLoader-Modul?"
        : safeText(error?.message || error, 500);
      if (throwOnError) throw new Error(this.lastError);
    } finally {
      clearTimeout(timer);
      this.lastCheckedAt = Date.now();
      this.emitChangeIfNeeded();
    }
    return this.status();
  }

  async start() {
    if (this.running) return this.status();
    this.running = true;
    await this.refresh();
    this.scheduleNextRefresh();
    return this.status();
  }

  scheduleNextRefresh() {
    clearTimeout(this.timer);
    if (!this.running) return;
    const delay = this.connected ? this.intervalMs : this.offlineIntervalMs;
    this.timer = setTimeout(async () => {
      try { await this.refresh(); }
      finally { this.scheduleNextRefresh(); }
    }, delay);
    this.timer.unref?.();
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    this.timer = null;
  }
}

module.exports = {
  SotfDeathCounterClient,
  normalizeLoopbackBaseUrl,
  normalizePlayer,
  normalizeSnapshot
};
