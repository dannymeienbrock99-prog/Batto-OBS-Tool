"use strict";

const WebSocket = require("ws");
const { EventEmitter } = require("node:events");

class TwitchAdapter extends EventEmitter {
  constructor() { super(); this.platform = "twitch"; this.ws = null; this.config = {}; this.connected = false; }
  onMessage(callback) { this.on("message", callback); }
  onStatus(callback) { this.on("status", callback); }
  status() { return { platform: this.platform, connected: this.connected, configured: Boolean(this.config.channel && this.config.token), channel: this.config.channel || "" }; }
  emitStatus(extra = {}) { this.emit("status", { ...this.status(), ...extra }); }

  async connect(config = {}) {
    await this.disconnect();
    const channel = String(config.channel || "").trim().replace(/^#/, "").toLowerCase();
    const token = String(config.token || "").trim().replace(/^oauth:/i, "");
    const username = String(config.username || "batto_reader").trim().toLowerCase();
    if (!channel || !token) throw new Error("Twitch benötigt Kanalname und OAuth-Token für den Chat-Reader.");
    this.config = { channel, token, username };
    this.ws = new WebSocket("wss://irc-ws.chat.twitch.tv:443");
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (error) => { if (!settled) { settled = true; reject(error); } this.emitStatus({ error: String(error?.message || error) }); };
      this.ws.on("open", () => {
        this.ws.send(`PASS oauth:${token}`);
        this.ws.send(`NICK ${username}`);
        this.ws.send("CAP REQ :twitch.tv/tags twitch.tv/commands");
        this.ws.send(`JOIN #${channel}`);
      });
      this.ws.on("message", (data) => {
        for (const line of String(data).split(/\r?\n/).filter(Boolean)) this.handleLine(line);
        if (!settled && this.connected) { settled = true; resolve(this.status()); }
      });
      this.ws.on("error", fail);
      this.ws.on("close", () => { this.connected = false; this.emitStatus(); });
      this.emitStatus({ connecting: true });
    });
  }

  handleLine(line) {
    if (line.startsWith("PING")) { this.ws?.send("PONG :tmi.twitch.tv"); return; }
    if (line.includes(" 001 ") || line.includes(" JOIN #")) { this.connected = true; this.emitStatus(); return; }
    if (line.includes(" GLOBALUSERSTATE ")) { this.connected = true; this.emitStatus(); return; }
    if (!line.includes(" PRIVMSG #")) return;
    const tagText = line.startsWith("@") ? line.slice(1, line.indexOf(" ")) : "";
    const tags = Object.fromEntries(tagText.split(";").filter(Boolean).map((part) => { const [key, ...rest] = part.split("="); return [key, rest.join("=")]; }));
    const bodyIndex = line.indexOf(" :", line.indexOf(" PRIVMSG "));
    if (bodyIndex < 0) return;
    const message = line.slice(bodyIndex + 2);
    const prefixStart = line.indexOf(" :") + 2;
    const prefixEnd = line.indexOf("!", prefixStart);
    const username = tags["display-name"] || line.slice(prefixStart, prefixEnd > prefixStart ? prefixEnd : bodyIndex);
    const badges = String(tags.badges || "").split(",").filter(Boolean).map((badge) => badge.split("/")[0]);
    this.connected = true;
    this.emitStatus();
    this.emit("message", {
      platform: "twitch", username, userId: tags["user-id"] || "", message,
      color: tags.color || "#9146ff", badges, role: badges.includes("broadcaster") ? "broadcaster" : badges.includes("moderator") ? "moderator" : badges.includes("vip") ? "vip" : badges.includes("subscriber") ? "subscriber" : "",
      metadata: { channel: this.config.channel, rawTags: tags }
    });
  }

  async sendMessage(message) {
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error("Twitch ist nicht verbunden.");
    const value = String(message || "").replace(/[\r\n]+/g, " ").trim().slice(0, 500);
    if (!value) throw new Error("Leere Twitch-Nachrichten werden nicht gesendet.");
    this.ws.send(`PRIVMSG #${this.config.channel} :${value}`);
    return { platform: "twitch", sent: true, message: value };
  }

  async disconnect() {
    if (this.ws) { try { this.ws.close(); } catch {} }
    this.ws = null; this.connected = false; this.emitStatus();
    return this.status();
  }
}

module.exports = { TwitchAdapter };
