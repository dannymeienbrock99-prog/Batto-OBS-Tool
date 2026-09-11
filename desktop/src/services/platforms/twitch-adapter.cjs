"use strict";
const WebSocket = require("ws");
const { EventEmitter } = require("node:events");
const { requestJson } = require("./chat-api.cjs");
const COLORS = ["blue", "blue_violet", "cadet_blue", "chocolate", "coral", "dodger_blue", "firebrick", "golden_rod", "green", "hot_pink", "orange_red", "red", "sea_green", "spring_green", "yellow_green"];

class TwitchAdapter extends EventEmitter {
  constructor({ fetcher = globalThis.fetch, Socket = WebSocket } = {}) {
    super(); this.platform = "twitch"; this.fetcher = fetcher; this.Socket = Socket; this.ws = null; this.config = {}; this.connected = false; this.session = null; this.validationTimer = null;
  }
  onMessage(callback) { this.on("message", callback); }
  onStatus(callback) { this.on("status", callback); }
  status() {
    const write = this.config.scopes?.includes("user:write:chat") === true;
    return { platform: this.platform, connected: this.connected, configured: Boolean(this.config.channel), channel: this.config.channel || "", username: this.config.username || "", canSend: this.connected && write, canSetColor: this.connected && this.config.scopes?.includes("user:manage:chat_color") === true, sendReason: !this.connected ? "Twitch ist nicht verbunden." : !write ? "OAuth-Berechtigung user:write:chat fehlt." : "", transport: "twitch-helix" };
  }
  emitStatus(extra = {}) { this.emit("status", { ...this.status(), ...extra }); }
  headers() { return { Authorization: `Bearer ${this.config.token}`, "Client-Id": this.config.clientId, "Content-Type": "application/json" }; }
  async api(endpoint, options = {}) {
    const session = this.session;
    try { return await requestJson(this.fetcher, `https://api.twitch.tv/helix/${endpoint}`, { ...options, headers: this.headers(), signal: options.signal ? AbortSignal.any([options.signal, session.signal]) : session.signal }, "Twitch"); }
    catch (error) { if (error.status === 401 && session === this.session) await this.disconnect(); throw error; }
  }
  async validate(session) {
    return requestJson(this.fetcher, "https://id.twitch.tv/oauth2/validate", { headers: { Authorization: `OAuth ${this.config.token}` }, signal: session.signal }, "Twitch-Anmeldung");
  }
  async connect(config = {}) {
    await this.disconnect();
    const channel = String(config.channel || "").trim().replace(/^#/, "").toLowerCase();
    const token = String(config.token || "").trim().replace(/^oauth:/i, "");
    if (!/^[a-z0-9_]{1,25}$/.test(channel) || !token || /[\r\n]/.test(token)) throw new Error("Twitch benötigt Kanalname und OAuth-Token.");
    const session = this.session = new AbortController();
    this.config = { channel, token };
    try {
      const identity = await this.validate(session);
      if (!identity.login || !identity.user_id || !identity.client_id) throw new Error("Ein Twitch-Benutzer-Token ist erforderlich.");
      if (!identity.scopes?.includes("chat:read")) throw new Error("Twitch: OAuth-Berechtigung chat:read fehlt.");
      session.signal.throwIfAborted();
      Object.assign(this.config, { username: identity.login, userId: identity.user_id, clientId: identity.client_id, scopes: identity.scopes });
      const users = await this.api(`users?login=${encodeURIComponent(channel)}`);
      session.signal.throwIfAborted();
      if (!users.data?.[0]?.id) throw new Error("Twitch-Kanal wurde nicht gefunden.");
      this.config.broadcasterId = users.data[0].id;
      session.signal.throwIfAborted();
      const ws = this.ws = new this.Socket("wss://irc-ws.chat.twitch.tv:443");
      await new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error) => { if (settled) return; settled = true; clearTimeout(timer); session.signal.removeEventListener("abort", abort); error ? reject(error) : resolve(); };
        const abort = () => finish(new Error("Twitch-Verbindung abgebrochen."));
        const timer = setTimeout(() => finish(new Error("Twitch: Zeitlimit bei der Chat-Anmeldung erreicht.")), 15000);
        session.signal.addEventListener("abort", abort, { once: true });
        ws.on("open", () => {
          if (session.signal.aborted) return;
          ws.send(`PASS oauth:${token}`); ws.send(`NICK ${identity.login}`);
          ws.send("CAP REQ :twitch.tv/tags twitch.tv/commands"); ws.send(`JOIN #${channel}`);
        });
        ws.on("message", (data) => {
          if (session.signal.aborted) return;
          for (const line of String(data).split(/\r?\n/).filter(Boolean)) {
            if (/Login authentication failed|Improperly formatted auth|Login unsuccessful/i.test(line)) { finish(new Error("Twitch: Chat-Anmeldung abgelehnt.")); return; }
            this.handleLine(line);
          }
          if (this.connected) finish();
        });
        ws.on("error", () => { if (!session.signal.aborted) this.emitStatus({ error: "Twitch-WebSocket-Verbindung fehlgeschlagen." }); finish(new Error("Twitch-WebSocket-Verbindung fehlgeschlagen.")); });
        ws.on("close", () => { if (this.ws === ws) { this.connected = false; this.emitStatus(); } finish(new Error("Twitch-Verbindung geschlossen.")); });
        this.emitStatus({ connecting: true });
      });
      this.validationTimer = setInterval(async () => {
        try { const identity = await this.validate(session); if (this.session === session) { this.config.scopes = identity.scopes || []; this.emitStatus(); } }
        catch { if (this.session === session) { await this.disconnect(); this.emitStatus({ error: "Twitch-Anmeldung abgelaufen. Erneut verbinden." }); } }
      }, 3600000);
      this.validationTimer.unref?.();
      return this.status();
    } catch (error) { if (this.session === session) await this.disconnect(); throw error; }
  }
  handleLine(line) {
    if (line.startsWith("PING")) { this.ws?.send("PONG :tmi.twitch.tv"); return; }
    if (line.includes(" ROOMSTATE #") || (line.includes(" JOIN #") && line.includes(`:${this.config.username}!`))) { this.connected = true; this.emitStatus(); return; }
    if (!line.includes(" PRIVMSG #")) return;
    const tagText = line.startsWith("@") ? line.slice(1, line.indexOf(" ")) : "";
    const tags = Object.fromEntries(tagText.split(";").filter(Boolean).map((part) => { const [key, ...rest] = part.split("="); return [key, rest.join("=")]; }));
    const bodyIndex = line.indexOf(" :", line.indexOf(" PRIVMSG "));
    if (bodyIndex < 0) return;
    const prefix = line.match(/(?:^| ):(\w+)!/);
    const badges = String(tags.badges || "").split(",").filter(Boolean).map((badge) => badge.split("/")[0]);
    this.emit("message", { id: tags.id, platform: "twitch", username: tags["display-name"] || prefix?.[1] || "User", userId: tags["user-id"] || "", message: line.slice(bodyIndex + 2), color: tags.color || "#9146ff", badges, role: ["broadcaster", "moderator", "vip", "subscriber"].find((role) => badges.includes(role)) || "", metadata: { channel: this.config.channel } });
  }
  async sendMessage(message, { signal } = {}) {
    if (!this.status().canSend) throw new Error(this.status().sendReason);
    const value = String(message || "").replace(/[\r\n]+/g, " ").trim();
    if (!value || [...value].length > 500) throw new Error("Twitch: Nachricht muss 1–500 Zeichen enthalten.");
    const result = await this.api("chat/messages", { method: "POST", signal, body: JSON.stringify({ broadcaster_id: this.config.broadcasterId, sender_id: this.config.userId, message: value }) });
    const delivery = result.data?.[0];
    if (delivery?.is_sent !== true) throw new Error(`Twitch hat die Nachricht nicht gesendet (${String(delivery?.drop_reason?.code || "unbestätigt").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80)}).`);
    return { platform: "twitch", sent: true, confirmed: true, messageId: delivery.message_id };
  }
  async setChatColor(color) {
    if (!this.status().canSetColor) throw new Error("Twitch: OAuth-Berechtigung user:manage:chat_color fehlt oder Konto ist nicht verbunden.");
    if (!COLORS.includes(color) && !/^#[0-9a-f]{6}$/i.test(color)) throw new Error("Ungültige Twitch-Namensfarbe.");
    await this.api(`chat/color?user_id=${encodeURIComponent(this.config.userId)}&color=${encodeURIComponent(color)}`, { method: "PUT" });
    return { applied: true, username: this.config.username, color };
  }
  async disconnect() {
    this.session?.abort(); clearInterval(this.validationTimer); this.validationTimer = null;
    const ws = this.ws; this.ws = null; this.connected = false;
    if (ws) { try { ws.close(); } catch {} }
    this.config = { channel: this.config.channel || "" }; this.emitStatus(); return this.status();
  }
}
module.exports = { TwitchAdapter, COLORS };
