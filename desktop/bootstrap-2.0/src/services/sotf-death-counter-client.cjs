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
  constructor({ baseUrl = "http://127.0.0.1:19447/", fetchImpl = globalThis.fetch, timeoutMs = 1500, intervalMs = 2000 } = {}) {
    super();
    this.baseUrl = normalizeLoopbackBaseUrl(baseUrl);
    this.fetchImpl = fetchImpl;
    this.timeoutMs = Math.max(250, Math.min(10000, Number(timeoutMs) || 1500));
    this.intervalMs = Math.max(500, Math.min(60000, Number(intervalMs) || 2000));
    this.timer = null;
    this.latest = null;
    this.connected = false;
    this.lastError = "";
    this.lastCheckedAt = 0;
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
      module: "CrazyBatto-SOTF-DeathCounter-Module-v0.3.0",
      version: "0.3.0",
      ...this.urls(),
      snapshot: this.latest,
      error: this.lastError,
      lastCheckedAt: this.lastCheckedAt
    };
  }

  async refresh({ throwOnError = false } = {}) {
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
      this.emit("changed", this.status());
    }
    return this.status();
  }

  async start() {
    if (this.timer) return this.status();
    await this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.intervalMs);
    this.timer.unref?.();
    return this.status();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = {
  SotfDeathCounterClient,
  normalizeLoopbackBaseUrl,
  normalizePlayer,
  normalizeSnapshot
};
