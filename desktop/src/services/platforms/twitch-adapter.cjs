"use strict";

const WebSocket = require("ws");
const { EventEmitter } = require("node:events");

function anonymousNick() {
  return `justinfan${Math.floor(Math.random() * 900000 + 100000)}`;
}

class TwitchAdapter extends EventEmitter {
  constructor() {
    super();
    this.platform = "twitch";
    this.ws = null;
    this.config = {};
    this.connected = false;
  }

  onMessage(callback) { this.on("message", callback); }
  onStatus(callback) { this.on("status", callback); }
  status() {
    return {
      platform: this.platform,
      connected: this.connected,
      configured: Boolean(this.config.channel),
      channel: this.config.channel || "",
      mode: "anonymous-read-only"
    };
  }
  emitStatus(extra = {}) { this.emit("status", { ...this.status(), ...extra }); }

  async connect(config = {}) {
    await this.disconnect();
    const channel = String(config.channel || "").trim().replace(/^#/, "").toLowerCase();
    if (!channel) throw new Error("Twitch benötigt nur den Kanalnamen für den anonymen Chat-Reader.");

    const username = anonymousNick();
    this.config = { channel, username };
    this.ws = new WebSocket("wss://irc-ws.chat.twitch.tv:443");

    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => finish(new Error("Twitch-Verbindung hat zu lange gedauert.")), 12000);
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve(this.status());
      };
      const fail = (error) => {
        const normalized = error instanceof Error ? error : new Error(String(error || "Twitch-Verbindung fehlgeschlagen."));
        this.connected = false;
        this.emitStatus({ error: normalized.message });
        finish(normalized);
      };

      this.ws.on("open", () => {
        // Anonymous Twitch IRC: no OAuth token is requested, stored or transmitted.
        this.ws.send(`NICK ${username}`);
        this.ws.send("CAP REQ :twitch.tv/tags twitch.tv/commands twitch.tv/membership");
        this.ws.send(`JOIN #${channel}`);
      });

      this.ws.on("message", (data) => {
        for (const line of String(data).split(/\r?\n/).filter(Boolean)) {
          if (/Login authentication failed|Improperly formatted auth/i.test(line)) {
            fail(new Error("Twitch hat die anonyme IRC-Verbindung abgelehnt."));
            return;
          }
          if (/ 001 /.test(line) || new RegExp(`(?:^|\\s):?${username}![^ ]* JOIN #${channel}(?:\\s|$)`, "i").test(line)) {
            this.connected = true;
            this.emitStatus();
            finish();
          }
          this.handleLine(line);
        }
      });
      this.ws.on("error", fail);
      this.ws.on("close", (code, reason) => {
        const wasConnected = this.connected;
        this.connected = false;
        this.ws = null;
        this.emitStatus();
        if (!settled && !wasConnected) finish(new Error(`Twitch-Verbindung wurde geschlossen (${code}${reason ? `: ${String(reason)}` : ""}).`));
      });
      this.emitStatus({ connecting: true });
    });
  }

  handleLine(line) {
    if (line.startsWith("PING")) { this.ws?.send(line.replace(/^PING/, "PONG")); return; }
    if (!line.includes(" PRIVMSG #")) return;
    const tagText = line.startsWith("@") ? line.slice(1, line.indexOf(" ")) : "";
    const tags = Object.fromEntries(tagText.split(";").filter(Boolean).map((part) => {
      const [key, ...rest] = part.split("=");
      return [key, rest.join("=")];
    }));
    const bodyIndex = line.indexOf(" :", line.indexOf(" PRIVMSG "));
    if (bodyIndex < 0) return;
    const message = line.slice(bodyIndex + 2);
    const prefixStart = line.indexOf(" :") + 2;
    const prefixEnd = line.indexOf("!", prefixStart);
    const username = tags["display-name"] || line.slice(prefixStart, prefixEnd > prefixStart ? prefixEnd : bodyIndex);
    const badges = String(tags.badges || "").split(",").filter(Boolean).map((badge) => badge.split("/")[0]);
    const role = badges.includes("broadcaster") ? "broadcaster"
      : badges.includes("moderator") ? "moderator"
      : badges.includes("vip") ? "vip"
      : badges.includes("subscriber") ? "subscriber"
      : "viewer";
    this.emit("message", {
      platform: "twitch",
      username,
      userId: tags["user-id"] || "",
      message,
      color: tags.color || "#9146ff",
      badges,
      role,
      metadata: { channel: this.config.channel, rawTags: tags, mode: "anonymous-read-only" }
    });
  }

  async disconnect() {
    const socket = this.ws;
    this.ws = null;
    this.connected = false;
    if (socket) { try { socket.removeAllListeners(); socket.close(); } catch {} }
    this.emitStatus();
    return this.status();
  }
}

module.exports = { TwitchAdapter, anonymousNick };
