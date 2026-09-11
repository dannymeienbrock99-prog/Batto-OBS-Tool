"use strict";
const { EventEmitter } = require("node:events");
const { requestJson } = require("./chat-api.cjs");
class YouTubeAdapter extends EventEmitter {
  constructor({ fetcher = globalThis.fetch } = {}) { super(); this.platform = "youtube"; this.fetcher = fetcher; this.config = {}; this.connected = false; this.session = null; this.timer = null; this.seen = new Set(); this.pageToken = ""; }
  onMessage(callback) { this.on("message", callback); }
  onStatus(callback) { this.on("status", callback); }
  status() { return { platform: this.platform, connected: this.connected, configured: Boolean(this.config.liveChatId || this.config.videoId), canSend: this.connected && Boolean(this.config.token), sendReason: this.connected ? "" : "YouTube-Livechat und OAuth-Token verbinden.", transport: "youtube-data-api", videoId: this.config.videoId || "" }; }
  emitStatus(extra = {}) { this.emit("status", { ...this.status(), ...extra }); }
  async api(endpoint, options = {}) {
    const session = this.session;
    try { return await requestJson(this.fetcher, `https://www.googleapis.com/youtube/v3/${endpoint}`, { ...options, headers: { Authorization: `Bearer ${this.config.token}`, "Content-Type": "application/json" }, signal: options.signal ? AbortSignal.any([options.signal, session.signal]) : session.signal }, "YouTube"); }
    catch (error) { if ([401, 403, 404].includes(error.status) && session === this.session) { this.connected = false; clearTimeout(this.timer); this.emitStatus({ error: error.message }); } throw error; }
  }
  async connect(config = {}) {
    await this.disconnect();
    let videoId = String(config.videoId || "").trim();
    if (/^https?:/.test(videoId)) { const url = new URL(videoId); if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname)) videoId = url.searchParams.get("v") || url.pathname.split("/").pop(); else if (url.hostname === "youtu.be") videoId = url.pathname.slice(1); else throw new Error("Bitte eine YouTube-Video-ID oder YouTube-URL eingeben."); }
    this.config = { videoId, liveChatId: String(config.liveChatId || "").trim(), token: String(config.token || "").trim().replace(/^Bearer\s+/i, "") };
    if ((!videoId && !this.config.liveChatId) || !this.config.token) throw new Error("YouTube benötigt Video-ID oder Livechat-ID und einen OAuth-Token (youtube oder youtube.force-ssl).");
    const session = this.session = new AbortController(); this.pageToken = ""; this.seen.clear(); this.receivedInitial = false;
    try {
      if (!this.config.liveChatId) {
        const result = await this.api(`videos?part=liveStreamingDetails&id=${encodeURIComponent(videoId)}`);
        session.signal.throwIfAborted();
        this.config.liveChatId = result.items?.[0]?.liveStreamingDetails?.activeLiveChatId || "";
        if (!this.config.liveChatId) throw new Error("Dieses YouTube-Video hat keinen aktiven Livechat.");
      }
      await this.poll(session);
      return this.status();
    } catch (error) { if (this.session === session) await this.disconnect(); throw error; }
  }
  async poll(session) {
    const result = await this.api(`liveChat/messages?part=snippet,authorDetails&maxResults=200&liveChatId=${encodeURIComponent(this.config.liveChatId)}${this.pageToken ? `&pageToken=${encodeURIComponent(this.pageToken)}` : ""}`);
    if (session.signal.aborted || this.session !== session) return;
    this.connected = !result.offlineAt; this.emitStatus();
    const historical = !this.receivedInitial; this.receivedInitial = true;
    for (const item of result.items || []) {
      if (!item.id || this.seen.has(item.id)) continue;
      this.seen.add(item.id); if (this.seen.size > 2000) this.seen.delete(this.seen.values().next().value);
      const a = item.authorDetails || {}, s = item.snippet || {};
      if (!s.displayMessage && !s.textMessageDetails?.messageText) continue;
      const role = a.isChatOwner ? "broadcaster" : a.isChatModerator ? "moderator" : a.isChatSponsor ? "subscriber" : "viewer";
      this.emit("message", { id: item.id, platform: "youtube", userId: a.channelId, username: a.displayName || "YouTube User", avatar: a.profileImageUrl || "", message: s.textMessageDetails?.messageText || s.displayMessage, color: "#ff6978", role, badges: role === "viewer" ? [] : [role], timestamp: Date.parse(s.publishedAt) || Date.now(), metadata: { historical, eventType: s.type === "textMessageEvent" ? "" : s.type } });
    }
    this.pageToken = result.nextPageToken || "";
    if (!this.connected) return;
    const interval = Math.max(1000, Number(result.pollingIntervalMillis) || 5000);
    this.timer = setTimeout(() => { void this.poll(session).catch((error) => { if (this.session === session && !session.signal.aborted) { this.connected = false; this.emitStatus({ error: error.message }); } }); }, interval);
    this.timer.unref?.();
  }
  async sendMessage(message, { signal } = {}) {
    if (!this.status().canSend) throw new Error(this.status().sendReason);
    const value = String(message || "").trim();
    if (!value || [...value].length > 200) throw new Error("YouTube: Nachricht muss 1–200 Zeichen enthalten.");
    const result = await this.api("liveChat/messages?part=snippet", { method: "POST", signal, body: JSON.stringify({ snippet: { liveChatId: this.config.liveChatId, type: "textMessageEvent", textMessageDetails: { messageText: value } } }) });
    if (!result.id) throw new Error("YouTube hat die Zustellung nicht bestätigt.");
    return { platform: "youtube", sent: true, confirmed: true, messageId: result.id };
  }
  async disconnect() { this.session?.abort(); clearTimeout(this.timer); this.timer = null; this.connected = false; this.config.token = ""; this.emitStatus(); return this.status(); }
}
module.exports = { YouTubeAdapter };
