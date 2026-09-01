"use strict";
const { EventEmitter } = require("node:events");
class YouTubeAdapter extends EventEmitter {
  constructor() { super(); this.platform = "youtube"; this.config = {}; this.connected = false; }
  onMessage(callback) { this.on("message", callback); }
  onStatus(callback) { this.on("status", callback); }
  status() { return { platform: this.platform, connected: this.connected, configured: Boolean(this.config.liveChatId || this.config.videoId), transport: "api-boundary" }; }
  async connect(config = {}) { this.config = { videoId: String(config.videoId || ""), liveChatId: String(config.liveChatId || "") }; this.connected = false; this.emit("status", this.status()); return this.status(); }
  async disconnect() { this.connected = false; this.emit("status", this.status()); return this.status(); }
}
module.exports = { YouTubeAdapter };
