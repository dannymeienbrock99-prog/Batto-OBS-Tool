"use strict";

const { EventEmitter } = require("node:events");

function userFrom(data = {}) {
  const user = data.user && typeof data.user === "object" ? data.user : data;
  return {
    nickname: user.nickname || data.nickname || user.uniqueId || data.uniqueId || "TikTok User",
    uniqueId: user.uniqueId || data.uniqueId || "",
    userId: String(user.userId || data.userId || ""),
    profilePictureUrl: user.profilePictureUrl || data.profilePictureUrl || "",
    badges: user.userBadges || data.userBadges || [],
    isModerator: Boolean(user.isModerator ?? data.isModerator),
    isSubscriber: Boolean(user.isSubscriber ?? data.isSubscriber)
  };
}

function connectionOptions() {
  return {
    // Avoid the connector's initial replay path. Live events still arrive normally.
    processInitialData: false,
    fetchRoomInfoOnConnect: true,
    enableExtendedGiftInfo: true
  };
}

class TikTokAdapter extends EventEmitter {
  constructor() {
    super();
    this.platform = "tiktok";
    this.client = null;
    this.username = "";
    this.connected = false;
    this.available = false;
  }

  onMessage(callback) { this.on("message", callback); }
  onStatus(callback) { this.on("status", callback); }
  status() {
    return {
      platform: this.platform,
      connected: this.connected,
      configured: Boolean(this.username),
      available: this.available,
      username: this.username
    };
  }
  emitStatus(extra = {}) { this.emit("status", { ...this.status(), ...extra }); }

  emitEvent(eventType, data, text) {
    const user = userFrom(data);
    this.emit("message", {
      platform: "tiktok",
      username: user.nickname,
      userId: user.userId,
      message: text,
      color: "#111111",
      badges: user.badges,
      role: user.isModerator ? "moderator" : user.isSubscriber ? "subscriber" : "",
      avatar: user.profilePictureUrl,
      metadata: { eventType, raw: data }
    });
  }

  async connect(config = {}) {
    await this.disconnect();
    this.username = String(config.username || config.uniqueId || "").trim().replace(/^@/, "");
    if (!this.username) throw new Error("TikTok LIVE benötigt den @Username des öffentlichen LIVE-Streams.");

    let Connector;
    try {
      const module = await import("tiktok-live-connector");
      Connector = module.TikTokLiveConnection || module.WebcastPushConnection || module.default?.TikTokLiveConnection || module.default?.WebcastPushConnection || module.default;
      this.available = typeof Connector === "function";
    } catch (error) {
      this.available = false;
      this.emitStatus({ error: "tiktok-live-connector ist nicht installiert." });
      throw new Error("TikTok LIVE ist vorbereitet, aber das tiktok-live-connector Paket fehlt.");
    }
    if (!this.available) throw new Error("TikTok LIVE Connector konnte nicht geladen werden.");

    try {
      this.client = new Connector(this.username, connectionOptions());
      this.client.on?.("chat", (data) => {
        const user = userFrom(data);
        this.emit("message", {
          platform: "tiktok",
          username: user.nickname,
          userId: user.userId,
          message: data?.comment || data?.content || "",
          color: data?.color || "#111111",
          badges: user.badges,
          role: user.isModerator ? "moderator" : user.isSubscriber ? "subscriber" : "",
          avatar: user.profilePictureUrl,
          metadata: data
        });
      });
      this.client.on?.("gift", (data) => {
        const user = userFrom(data);
        this.emitEvent("gift", data, `${user.nickname} sendet ${data?.giftName || data?.gift?.name || "ein Geschenk"}${data?.repeatCount ? ` ×${data.repeatCount}` : ""}`);
      });
      this.client.on?.("like", (data) => { const user = userFrom(data); this.emitEvent("like", data, `${user.nickname} hat geliked${data?.likeCount ? ` ×${data.likeCount}` : ""}`); });
      this.client.on?.("member", (data) => { const user = userFrom(data); this.emitEvent("member", data, `${user.nickname} ist beigetreten`); });
      this.client.on?.("social", (data) => { const user = userFrom(data); this.emitEvent("social", data, `${user.nickname} hat eine soziale Aktion ausgelöst`); });
      this.client.on?.("subscribe", (data) => { const user = userFrom(data); this.emitEvent("subscribe", data, `${user.nickname} hat abonniert`); });
      this.client.on?.("connected", () => { this.connected = true; this.emitStatus(); });
      this.client.on?.("disconnected", () => { this.connected = false; this.emitStatus(); });
      this.client.on?.("error", (error) => this.emitStatus({ error: String(error?.message || error) }));
      await this.client.connect();
      this.connected = true;
      this.emitStatus();
      return this.status();
    } catch (error) {
      this.connected = false;
      const message = String(error?.message || error || "TikTok-Verbindung fehlgeschlagen.");
      this.emitStatus({ error: message });
      try { await this.client?.disconnect?.(); } catch {}
      this.client = null;
      throw new Error(`TikTok LIVE konnte nicht verbunden werden: ${message}`);
    }
  }

  async disconnect() {
    try { await this.client?.disconnect?.(); } catch {}
    this.client = null;
    this.connected = false;
    this.emitStatus();
    return this.status();
  }
}

module.exports = { TikTokAdapter, connectionOptions, userFrom };
