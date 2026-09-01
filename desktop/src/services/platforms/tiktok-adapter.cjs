"use strict";

const { EventEmitter } = require("node:events");

class TikTokAdapter extends EventEmitter {
  constructor() { super(); this.platform = "tiktok"; this.client = null; this.username = ""; this.connected = false; this.available = false; }
  onMessage(callback) { this.on("message", callback); }
  onStatus(callback) { this.on("status", callback); }
  status() { return { platform: this.platform, connected: this.connected, configured: Boolean(this.username), available: this.available }; }
  emitStatus(extra = {}) { this.emit("status", { ...this.status(), ...extra }); }

  async connect(config = {}) {
    await this.disconnect();
    this.username = String(config.username || config.uniqueId || "").trim().replace(/^@/, "");
    if (!this.username) throw new Error("TikTok LIVE benötigt den @Username des öffentlichen LIVE-Streams.");
    let Connector;
    try {
      const module = await import("tiktok-live-connector");
      Connector = module.TikTokLiveConnection || module.default?.TikTokLiveConnection || module.default;
      this.available = Boolean(Connector);
    } catch {
      this.available = false;
      this.emitStatus({ error: "tiktok-live-connector ist nicht installiert." });
      throw new Error("TikTok LIVE ist vorbereitet, aber das optionale tiktok-live-connector Paket fehlt.");
    }
    this.client = new Connector(this.username);
    this.client.on?.("chat", (data) => this.emit("message", { platform: "tiktok", username: data?.nickname || data?.uniqueId || "TikTok User", userId: data?.userId || "", message: data?.comment || "", color: data?.color || "#111111", badges: data?.userBadges || [], role: data?.isModerator ? "moderator" : data?.isSubscriber ? "subscriber" : "", avatar: data?.profilePictureUrl || "", metadata: data }));
    this.client.on?.("connected", () => { this.connected = true; this.emitStatus(); });
    this.client.on?.("disconnected", () => { this.connected = false; this.emitStatus(); });
    await this.client.connect();
    this.emitStatus();
    return this.status();
  }

  async disconnect() { try { await this.client?.disconnect?.(); } catch {} this.client = null; this.connected = false; this.emitStatus(); return this.status(); }
}

module.exports = { TikTokAdapter };
