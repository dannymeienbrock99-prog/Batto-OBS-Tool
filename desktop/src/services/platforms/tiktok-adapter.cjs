"use strict";
const { EventEmitter } = require("node:events");
const WebSocket = require("ws");

class TikTokAdapter extends EventEmitter {
  constructor() { super(); this.platform = "tiktok"; this.client = null; this.username = ""; this.connected = false; this.available = false; this.mode = "direct"; this.socket = null; }
  onMessage(callback) { this.on("message", callback); }
  onStatus(callback) { this.on("status", callback); }
  status() { return { platform: this.platform, connected: this.connected, configured: this.mode === "tikfinity" || Boolean(this.username), available: this.available, transport: this.mode, canSend: false, sendReason: "Die angebundene TikTok-Schnittstelle empfängt Ereignisse; Chatversand ist nicht verfügbar." }; }
  emitStatus(extra = {}) { this.emit("status", { ...this.status(), ...extra }); }
  emitEvent(eventType, data, text) { this.emit("message", { platform:"tiktok", username:data?.nickname || data?.uniqueId || "TikTok User", userId:data?.userId || "", message:text, color:"#111111", badges:data?.userBadges || [], role:data?.isModerator ? "moderator" : "", metadata:{ eventType, raw:data } }); }

  async connect(config = {}) {
    await this.disconnect();
    this.mode = config.mode === "tikfinity" ? "tikfinity" : "direct";
    if (this.mode === "tikfinity") return this.connectTikFinity();
    this.username = String(config.username || config.uniqueId || "").trim().replace(/^@/, "");
    if (!this.username) throw new Error("TikTok LIVE benötigt den @Username des öffentlichen LIVE-Streams.");
    let Connector;
    try {
      const module = await import("tiktok-live-connector");
      Connector = module.TikTokLiveConnection || module.default?.TikTokLiveConnection || module.default;
      this.available = Boolean(Connector);
    } catch {
      this.available = false; this.emitStatus({ error:"tiktok-live-connector ist nicht installiert." });
      throw new Error("TikTok LIVE ist vorbereitet, aber das tiktok-live-connector Paket fehlt.");
    }
    this.client = new Connector(this.username);
    this.client.on?.("chat", (data) => this.emit("message", { platform:"tiktok", username:data?.nickname || data?.uniqueId || "TikTok User", userId:data?.userId || "", message:data?.comment || "", color:data?.color || "#111111", badges:data?.userBadges || [], role:data?.isModerator ? "moderator" : data?.isSubscriber ? "subscriber" : "", avatar:data?.profilePictureUrl || "", metadata:data }));
    this.client.on?.("gift", (data) => this.emitEvent("gift", data, `${data?.nickname || data?.uniqueId || "User"} sendet ${data?.giftName || "ein Geschenk"}${data?.repeatCount ? ` ×${data.repeatCount}` : ""}`));
    this.client.on?.("like", (data) => this.emitEvent("like", data, `${data?.nickname || data?.uniqueId || "User"} hat geliked${data?.likeCount ? ` ×${data.likeCount}` : ""}`));
    this.client.on?.("member", (data) => this.emitEvent("member", data, `${data?.nickname || data?.uniqueId || "User"} ist beigetreten`));
    this.client.on?.("social", (data) => this.emitEvent("social", data, `${data?.nickname || data?.uniqueId || "User"} hat eine soziale Aktion ausgelöst`));
    this.client.on?.("subscribe", (data) => this.emitEvent("subscribe", data, `${data?.nickname || data?.uniqueId || "User"} hat abonniert`));
    this.client.on?.("connected", () => { this.connected=true; this.emitStatus(); });
    this.client.on?.("disconnected", () => { this.connected=false; this.emitStatus(); });
    await this.client.connect(); this.emitStatus(); return this.status();
  }
  async connectTikFinity() {
    const socket = this.socket = new WebSocket("ws://127.0.0.1:21213/", { maxPayload: 1024 * 1024 });
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error) => { if (settled) return; settled = true; clearTimeout(timer); if (error) { if (this.socket === socket) this.socket = null; socket.close(); reject(error); } else resolve(this.status()); };
      const timer = setTimeout(() => finish(new Error("TikFinity antwortet nicht. Desktop-App auf diesem Computer starten.")), 10000);
      socket.on("open", () => { if (this.socket !== socket) return; this.connected = true; this.available = true; this.emitStatus(); finish(); });
      socket.on("message", (packet) => {
        if (this.socket !== socket) return;
        let input; try { input = JSON.parse(String(packet)); } catch { return; }
        const data = input.data || {}, kind = input.event;
        if (kind === "chat") this.emit("message", { id: data.msgId, platform: "tiktok", username: data.nickname || data.uniqueId || "TikTok User", userId: data.userId || "", message: data.comment || "", color: "#25f4ee", role: data.isModerator ? "moderator" : data.isSubscriber ? "subscriber" : "viewer", avatar: data.profilePictureUrl || "", metadata: { transport: "tikfinity" } });
        else if (["gift", "share", "follow", "like", "subscribe"].includes(kind)) this.emitEvent(kind, data, `${data.nickname || data.uniqueId || "User"}: ${kind}${data.giftName ? ` · ${data.giftName}` : ""}`);
      });
      socket.on("error", () => { this.emitStatus({ error: "TikFinity nicht erreichbar (127.0.0.1:21213)." }); finish(new Error("TikFinity nicht erreichbar. Desktop-App auf diesem Computer starten.")); });
      socket.on("close", () => { if (this.socket === socket) { this.connected = false; this.emitStatus(); } finish(new Error("TikFinity-Verbindung geschlossen.")); });
    });
  }
  async disconnect() { const socket = this.socket; this.socket = null; if (socket) { try { socket.close(); } catch {} } try { await this.client?.disconnect?.(); } catch {} this.client=null; this.connected=false; this.emitStatus(); return this.status(); }
}
module.exports = { TikTokAdapter };
