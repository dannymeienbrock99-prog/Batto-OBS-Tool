"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const { WebSocketServer } = require("ws");
const { defaults } = require("../shared/chat-design.js");

// One presentation feed for Holo, the normal chat overlay and reconnects.
// Configuration writes are IPC-only; this server never accepts chat sends.
class TwitchHoloServer {
  constructor({ preferredPort = 17823, designStore = null } = {}) {
    this.host = "127.0.0.1"; this.preferredPort = preferredPort; this.port = null;
    this.server = null; this.wss = null; this.designStore = designStore; this.history = [];
    this.onDesign = () => this.publish({ type: "design", config: this.config() });
  }
  config() { return this.designStore?.snapshot() || defaults(); }
  async start() {
    if (this.server) return this.status();
    for (let offset = 0; offset < 30; offset++) {
      const port = this.preferredPort + offset;
      const server = http.createServer((req, res) => void this.handle(req, res));
      try {
        await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, this.host, resolve); });
        this.server = server; this.port = server.address().port; break;
      } catch (error) { if (error.code !== "EADDRINUSE" || offset === 29) throw error; }
    }
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
    this.server.on("upgrade", (req, socket, head) => {
      const origin = req.headers.origin;
      if (req.url !== "/chat-ws" || (origin && origin !== "null" && origin !== "http://127.0.0.1:" + this.port)) { socket.destroy(); return; }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit("connection", ws));
    });
    this.wss.on("connection", (ws) => {
      ws.on("error", () => {});
      ws.send(JSON.stringify({ type: "snapshot", config: this.config(), messages: this.history }));
    });
    this.designStore?.on("changed", this.onDesign);
    return this.status();
  }
  publish(event) {
    const payload = JSON.stringify(event);
    for (const ws of this.wss?.clients || []) if (ws.readyState === 1) ws.send(payload, () => {});
  }
  publishEvent(event) {
    if (event.type !== "chat") return;
    const message = { id: event.id, platform: event.platform, username: event.name, message: event.text,
      color: event.data?.color, role: event.data?.role, badges: event.data?.badges, timestamp: event.timestamp };
    if (message.id && this.history.some((item) => item.id === message.id)) return;
    this.history.push(message); this.history = this.history.slice(-100);
    this.publish({ type: "chat", message });
  }
  clearChat(platform) {
    this.history = !platform || platform === "all" ? [] : this.history.filter((item) => item.platform !== platform);
    this.publish({ type: "snapshot", config: this.config(), messages: this.history });
  }
  status() {
    const base = this.port ? "http://127.0.0.1:" + this.port : "";
    return { running: Boolean(this.server), active: Boolean(this.server), host: this.host, port: this.port,
      editorUrl: null, overlayUrl: base ? base + "/overlay" : "", chatOverlayUrl: base ? base + "/chat-overlay" : "" };
  }
  async handle(req, res) {
    try {
      if (req.method !== "GET") { res.writeHead(405); res.end(); return; }
      const route = new URL(req.url, "http://127.0.0.1").pathname;
      if (route === "/health") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(this.status())); return; }
      const assets = {
        "/": ["renderer/chat-overlay.html", "text/html"],
        "/overlay": ["renderer/chat-overlay.html", "text/html"],
        "/chat-overlay": ["renderer/chat-overlay.html", "text/html"],
        "/chat-overlay.js": ["renderer/chat-overlay.js", "text/javascript"],
        "/chat-design.css": ["renderer/chat-design.css", "text/css"],
        "/chat-design.js": ["shared/chat-design.js", "text/javascript"]
      };
      if (!Object.hasOwn(assets, route)) { res.writeHead(404); res.end("Chatdesign wird direkt im Batto OBS Tool bearbeitet."); return; }
      const [asset, type] = assets[route];
      const body = await fs.readFile(path.join(__dirname, "..", asset));
      res.writeHead(200, { "Content-Type": type + "; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:*; object-src 'none'; base-uri 'none'" });
      res.end(body);
    } catch { if (!res.headersSent) res.writeHead(500); res.end("Overlay konnte nicht geladen werden."); }
  }
  async stop() {
    this.designStore?.off("changed", this.onDesign);
    for (const ws of this.wss?.clients || []) ws.terminate();
    this.wss?.close(); this.wss = null;
    const server = this.server; this.server = null; this.port = null;
    if (server) await new Promise((resolve) => server.close(resolve));
  }
}
module.exports = { TwitchHoloServer };
