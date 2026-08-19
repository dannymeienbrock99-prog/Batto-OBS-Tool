"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { WebSocketServer, WebSocket } = require("ws");
const { contentType, deepClone, isLoopback, normalizePathInside, readJson, readRequestJson, safeText, sendJson, sendText, writeJsonAtomic } = require("./common.cjs");

const ROLES = ["broadcaster", "moderator", "vip", "subscriber", "viewer"];
const BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function defaultHoloConfig() {
  const style = { enabled: true, colors: ["#54f4ff", "#9867ff", "#ff55c8", "#ffe66d"], angle: 110, speedSeconds: 4.5, glow: 18, brightness: 1.15, saturation: 1.2, fontWeight: 800 };
  return {
    enabled: true, applyToName: true, applyToMessage: true, useOriginalTwitchColorWhenDisabled: true,
    reducedMotion: false, transparentBubbles: false, showRole: false, showTime: false,
    align: "left", newest: "bottom", maximumMessages: 40, displayMs: 20000, defaultStyle: style,
    roleStyles: {
      broadcaster: { ...style, colors: ["#ff3b3b", "#ffb347", "#fff08a", "#ff3b3b"], glow: 22, speedSeconds: 3.2 },
      moderator: { ...style, colors: ["#00f5a0", "#00d9f5", "#6dffb8"], speedSeconds: 4 },
      vip: { ...style, colors: ["#ff4ecd", "#8d5cff", "#ff8fe7"], glow: 20, speedSeconds: 3.8 },
      subscriber: { ...style, colors: ["#ffd166", "#ff8c42", "#fff1a8"], glow: 14, speedSeconds: 5 },
      viewer: { ...style, glow: 14, speedSeconds: 5.5 }
    },
    userStyles: {}
  };
}

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const bounded = (value, minimum, maximum, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
};
const hex = (value, fallback = "") => /^#[0-9a-f]{6}$/i.test(String(value || "").trim()) ? String(value).trim().toLowerCase() : fallback;

function normalizeStyle(value, fallback) {
  const source = isRecord(value) ? value : {};
  const colors = (Array.isArray(source.colors) ? source.colors : []).map((color) => hex(color)).filter(Boolean).slice(0, 6);
  return {
    enabled: source.enabled === undefined ? fallback.enabled !== false : source.enabled !== false,
    colors: colors.length >= 2 ? colors : [...fallback.colors],
    angle: bounded(source.angle, 0, 360, fallback.angle),
    speedSeconds: bounded(source.speedSeconds, 0.6, 30, fallback.speedSeconds),
    glow: bounded(source.glow, 0, 50, fallback.glow),
    brightness: bounded(source.brightness, 0.5, 2, fallback.brightness),
    saturation: bounded(source.saturation, 0, 3, fallback.saturation),
    fontWeight: Math.round(bounded(source.fontWeight, 300, 1000, fallback.fontWeight))
  };
}

function normalizeUserKey(value) {
  const key = safeText(value, 80).trim().replace(/^@/, "").toLowerCase();
  return key && !BLOCKED_KEYS.has(key) ? key : "";
}

function normalizeHoloConfig(value = {}) {
  const source = isRecord(value) ? value : {};
  const defaults = defaultHoloConfig();
  const defaultStyle = normalizeStyle(source.defaultStyle, defaults.defaultStyle);
  const roleStyles = {};
  for (const role of ROLES) roleStyles[role] = normalizeStyle(source.roleStyles?.[role], normalizeStyle(defaults.roleStyles[role], defaultStyle));
  const userStyles = Object.create(null);
  if (isRecord(source.userStyles)) {
    for (const [rawKey, rawStyle] of Object.entries(source.userStyles).slice(0, 1000)) {
      const key = normalizeUserKey(rawKey);
      if (key && isRecord(rawStyle)) userStyles[key] = normalizeStyle(rawStyle, defaultStyle);
    }
  }
  return {
    enabled: source.enabled !== false, applyToName: source.applyToName !== false, applyToMessage: source.applyToMessage !== false,
    useOriginalTwitchColorWhenDisabled: source.useOriginalTwitchColorWhenDisabled !== false,
    reducedMotion: Boolean(source.reducedMotion), transparentBubbles: Boolean(source.transparentBubbles),
    showRole: Boolean(source.showRole), showTime: Boolean(source.showTime),
    align: source.align === "right" ? "right" : "left", newest: source.newest === "top" ? "top" : "bottom",
    maximumMessages: Math.round(bounded(source.maximumMessages, 1, 200, 40)),
    displayMs: Math.round(bounded(source.displayMs, 1000, 300000, 20000)),
    defaultStyle, roleStyles, userStyles
  };
}

function normalizeTimestamp(value) {
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) return number < 10_000_000_000 ? Math.round(number * 1000) : Math.round(number);
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function normalizeHoloMessage(value = {}, fallbackId = `holo-${Date.now()}`) {
  const source = isRecord(value) ? value : {};
  const text = safeText(source.text ?? source.message ?? "", 5000).trim();
  if (!text) return null;
  const role = String(source.role || "").toLowerCase();
  const roles = isRecord(source.roles) ? source.roles : {};
  const flag = (entry) => entry === true || entry === 1 || entry === "1";
  const displayName = safeText(source.displayName || source.username || source.name || "Zuschauer", 120).trim() || "Zuschauer";
  return {
    id: safeText(source.id || fallbackId, 180).trim() || fallbackId,
    platform: safeText(source.platform || "twitch", 40).trim().toLowerCase() || "twitch",
    displayName,
    username: safeText(source.username || source.login || source.name || "", 120).trim(),
    login: safeText(source.login || source.username || "", 120).trim().toLowerCase(),
    userId: safeText(source.userId || "", 160).trim(),
    text,
    color: hex(source.color, "#ffffff"),
    roles: {
      broadcaster: flag(roles.broadcaster) || flag(roles.streamer) || flag(roles.owner) || role === "broadcaster",
      moderator: flag(roles.moderator) || flag(roles.mod) || role === "moderator",
      vip: flag(roles.vip) || role === "vip",
      subscriber: flag(roles.subscriber) || flag(roles.sub) || role === "subscriber"
    },
    timestamp: normalizeTimestamp(source.timestamp)
  };
}

function allowedOrigin(request) {
  const raw = String(request.headers.origin || "").trim();
  if (!raw || raw === "null") return true;
  try { const origin = new URL(raw); return ["http:", "https:"].includes(origin.protocol) && isLoopback(origin.hostname); }
  catch { return false; }
}

function securityHeaders(request) {
  const headers = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
  const origin = String(request.headers.origin || "").trim();
  if (origin && origin !== "null" && allowedOrigin(request)) Object.assign(headers, { "Access-Control-Allow-Origin": origin, Vary: "Origin" });
  return headers;
}

class TwitchHoloServer extends EventEmitter {
  constructor({ webRoot, configFile, preferredPort = 17821 } = {}) {
    super();
    this.webRoot = webRoot;
    this.configFile = configFile;
    this.preferredPort = preferredPort;
    this.config = normalizeHoloConfig(readJson(configFile, {}) || {});
    this.server = null;
    this.webSocketServer = null;
    this.clients = new Set();
    this.port = 0;
    this.history = [];
    this.lastMessageAt = 0;
    this.messageSequence = 0;
  }

  async start() {
    if (this.server) return this.status();
    this.server = http.createServer((request, response) => void this.handleRequest(request, response));
    this.webSocketServer = new WebSocketServer({ noServer: true, maxPayload: 1_000_000 });
    this.server.on("upgrade", (request, socket, head) => {
      let pathname = "";
      try { pathname = new URL(request.url, "http://localhost").pathname; } catch {}
      if (pathname !== "/ws" || !allowedOrigin(request)) return socket.destroy();
      this.webSocketServer.handleUpgrade(request, socket, head, (client) => this.webSocketServer.emit("connection", client, request));
    });
    this.webSocketServer.on("connection", (socket) => {
      this.clients.add(socket);
      socket.on("close", () => this.clients.delete(socket));
      socket.on("error", () => this.clients.delete(socket));
      this.send(socket, { type: "config", config: this.config });
      this.send(socket, { type: "history", messages: this.history.slice(-100) });
    });
    await this.listenWithFallback();
    return this.status();
  }

  listen(port) {
    return new Promise((resolve, reject) => {
      const onError = (error) => { this.server.off("listening", onListening); reject(error); };
      const onListening = () => { this.server.off("error", onError); resolve(); };
      this.server.once("error", onError);
      this.server.once("listening", onListening);
      this.server.listen(port, "127.0.0.1");
    });
  }

  async listenWithFallback() {
    let lastError;
    for (let port = this.preferredPort; port < this.preferredPort + 20; port += 1) {
      try { await this.listen(port); this.port = port; return; }
      catch (error) { lastError = error; if (error.code !== "EADDRINUSE") throw error; }
    }
    throw lastError || new Error("Kein freier Port für Twitch-Hologramm gefunden.");
  }

  status() {
    const baseUrl = this.port ? `http://127.0.0.1:${this.port}` : "";
    const ws = this.port ? `ws://127.0.0.1:${this.port}/ws` : "";
    return {
      active: Boolean(this.server?.listening), port: this.port, baseUrl,
      editorUrl: baseUrl ? `${baseUrl}/editor.html?ws=${encodeURIComponent(ws)}` : "",
      overlayUrl: baseUrl ? `${baseUrl}/overlay.html?ws=${encodeURIComponent(ws)}` : "",
      clients: this.clients.size, messageCount: this.history.length, lastMessageAt: this.lastMessageAt,
      config: deepClone(this.config)
    };
  }

  send(socket, value) {
    if (socket?.readyState !== WebSocket.OPEN) return false;
    try { socket.send(JSON.stringify(value)); return true; } catch { this.clients.delete(socket); return false; }
  }

  broadcast(value) {
    const text = JSON.stringify(value);
    for (const socket of this.clients) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      try { socket.send(text); } catch { this.clients.delete(socket); }
    }
  }

  setConfig(config) {
    this.config = normalizeHoloConfig(config);
    writeJsonAtomic(this.configFile, this.config);
    this.broadcast({ type: "config", config: this.config });
    return deepClone(this.config);
  }

  publishMessage(message) {
    const normalized = normalizeHoloMessage(message, `holo-${Date.now()}-${++this.messageSequence}`);
    if (!normalized) return null;
    this.history = this.history.filter((entry) => entry.id !== normalized.id);
    this.history.push(normalized);
    if (this.history.length > 200) this.history.splice(0, this.history.length - 200);
    this.lastMessageAt = normalized.timestamp;
    this.broadcast({ type: "message", message: normalized });
    return deepClone(normalized);
  }

  deleteMessage(messageId) {
    const id = safeText(messageId, 180).trim();
    if (!id) return false;
    const before = this.history.length;
    this.history = this.history.filter((entry) => entry.id !== id);
    this.broadcast({ type: "delete", messageId: id });
    return before !== this.history.length;
  }

  clearUser(userId) {
    const key = normalizeUserKey(userId);
    if (!key) return 0;
    const before = this.history.length;
    this.history = this.history.filter((entry) => ![entry.userId, entry.username, entry.displayName].some((entry) => normalizeUserKey(entry) === key));
    this.broadcast({ type: "clear-user", userId: key });
    return before - this.history.length;
  }

  clear() { this.history = []; this.lastMessageAt = 0; this.broadcast({ type: "clear" }); }

  async handleRequest(request, response) {
    const headers = securityHeaders(request);
    try {
      const url = new URL(request.url, "http://localhost");
      const mutation = ["POST", "PUT", "PATCH", "DELETE"].includes(request.method);
      if ((request.method === "OPTIONS" || mutation) && !allowedOrigin(request)) return sendJson(response, 403, { ok: false, error: "Externe Browser-Ursprünge sind nicht erlaubt." }, headers);
      if (request.method === "OPTIONS") {
        response.writeHead(204, { ...headers, "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS" });
        return response.end();
      }
      if (request.method === "GET" && url.pathname === "/") { response.writeHead(302, { ...headers, Location: "/editor.html" }); return response.end(); }
      if (request.method === "GET" && url.pathname === "/api/status") return sendJson(response, 200, this.status(), headers);
      if (request.method === "GET" && url.pathname === "/api/config") return sendJson(response, 200, deepClone(this.config), headers);
      if (request.method === "PUT" && url.pathname === "/api/config") {
        const body = await readRequestJson(request);
        return isRecord(body) ? sendJson(response, 200, this.setConfig(body), headers) : sendJson(response, 400, { ok: false, error: "Konfiguration muss ein JSON-Objekt sein." }, headers);
      }
      if (request.method === "POST" && url.pathname === "/api/message") {
        const body = await readRequestJson(request);
        if (!isRecord(body)) return sendJson(response, 400, { ok: false, error: "Nachricht muss ein JSON-Objekt sein." }, headers);
        const message = this.publishMessage(body);
        return message ? sendJson(response, 200, { ok: true, message }, headers) : sendJson(response, 400, { ok: false, error: "Nachrichtentext fehlt." }, headers);
      }
      if (request.method === "POST" && url.pathname === "/api/clear") { this.clear(); return sendJson(response, 200, { ok: true }, headers); }
      if (request.method === "GET") {
        const file = normalizePathInside(this.webRoot, url.pathname);
        if (file) return this.serveFile(file, response, headers);
      }
      return sendJson(response, 404, { ok: false, error: "Nicht gefunden." }, headers);
    } catch (error) {
      const status = Number(error?.statusCode) || (error instanceof SyntaxError ? 400 : 500);
      return sendJson(response, status, { ok: false, error: status >= 500 ? "Interner Hologramm-Serverfehler." : String(error?.message || error) }, headers);
    }
  }

  serveFile(file, response, headers = {}) {
    try {
      const data = fs.readFileSync(file);
      response.writeHead(200, { "Content-Type": contentType(file), "Content-Length": data.length, "Cache-Control": file.endsWith(".html") ? "no-store" : "public, max-age=60", ...headers });
      response.end(data);
    } catch { sendText(response, 404, "Datei nicht gefunden.", "text/plain; charset=utf-8", headers); }
  }

  async stop() {
    for (const socket of this.clients) try { socket.close(1001, "Batto OBS Tool beendet"); } catch {}
    this.clients.clear();
    try { this.webSocketServer?.close(); } catch {}
    await new Promise((resolve) => this.server ? this.server.close(() => resolve()) : resolve());
    this.webSocketServer = null;
    this.server = null;
    this.port = 0;
  }
}

module.exports = { TwitchHoloServer, defaultHoloConfig, normalizeHoloConfig, normalizeHoloMessage, normalizeUserKey };
