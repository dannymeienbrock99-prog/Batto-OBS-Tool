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
    const username = String(config.username || channel).trim().toLowerCase();
    if (!channel || !token) throw new Error("Twitch benötigt Kanalname und OAuth-Token für den Chat-Reader.");
    this.config = { channel, token, username };
    this.ws = new WebSocket("wss://irc-ws.chat.twitch.tv:443");
    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => fail(new Error("Twitch-Chat hat die Anmeldung nicht innerhalb von 10 Sekunden bestätigt.")), 10000);
      const ready = () => { if (settled) return; settled = true; clearTimeout(timeout); this.connected = true; this.emitStatus(); resolve(this.status()); };
      const fail = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.connected = false;
        try { this.ws?.close(); } catch {}
        reject(error);
        this.emitStatus({ error: String(error?.message || error) });
      };
      this.ws.on("open", () => {
        this.ws.send(`PASS oauth:${token}`);
        this.ws.send(`NICK ${username}`);
        this.ws.send("CAP REQ :twitch.tv/tags twitch.tv/commands");
        this.ws.send(`JOIN #${channel}`);
      });
      this.ws.on("message", (data) => {
        for (const line of String(data).split(/\r?\n/).filter(Boolean)) {
          if (line.includes(" 001 ") || line.includes(` JOIN #${channel}`)) ready();
          if (/ (?:NOTICE|464) /.test(line) && /authentication|login unsuccessful|improperly formatted auth/i.test(line)) fail(new Error("Twitch hat den OAuth-Token abgelehnt."));
          this.handleLine(line);
        }
      });
      this.ws.on("error", (error) => settled ? this.emitStatus({ error: String(error?.message || error) }) : fail(error));
      this.ws.on("close", () => { if (!settled) fail(new Error("Twitch hat die Verbindung vor Abschluss der Anmeldung geschlossen.")); this.connected = false; this.emitStatus(); });
      this.emitStatus({ connecting: true });
    });
  }

  handleLine(line) {
    if (line.startsWith("PING")) { this.ws?.send("PONG :tmi.twitch.tv"); return; }
    if (line.includes(" GLOBALUSERSTATE ")) return;
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
      color: tags.color || "#9146ff", badges, role: badges.includes("broadcaster") ? "broadcaster" : badges.includes("moderator") ? "moderator" : badges.includes("vip") ? "vip" : "",
      metadata: { channel: this.config.channel, rawTags: tags }
    });
  }

  async disconnect() {
    if (this.ws) { try { this.ws.close(); } catch {} }
    this.ws = null; this.connected = false; this.emitStatus();
    return this.status();
  }
}

module.exports = { TwitchAdapter };
