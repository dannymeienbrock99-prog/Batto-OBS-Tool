"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { spawn } = require("node:child_process");
const { WebSocketServer } = require("ws");

const PLATFORMS = ["twitch", "tiktok", "youtube", "cng"];
const ROLES = ["all", "follower", "subscriber", "vip", "moderator", "broadcaster"];

function id(prefix = "item") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function text(value, max = 2000) { return String(value ?? "").trim().slice(0, max); }
function clamp(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0))); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function safePlatforms(value) {
  const list = Array.isArray(value) ? value : [];
  return [...new Set(list.filter((item) => PLATFORMS.includes(item)))];
}
function defaultConfig() {
  return {
    version: 1,
    enabled: true,
    platforms: Object.fromEntries(PLATFORMS.map((platform) => [platform, { enabled: true }])),
    broadcasts: [],
    commands: [],
    events: [],
    discord: { enabled: false, webhookUrl: "", title: "{streamer} ist LIVE!", message: "{title}\n{stream_url}", embed: true, oncePerStream: true, startDelayMs: 0, offlineMessage: "" },
    media: { root: "media", pools: [] },
    overlay: { enabled: true, host: "127.0.0.1", port: 8787, width: 1920, height: 1080, defaultDurationMs: 7000, queue: true },
    safety: { oneActionChainAtATime: false, globalCommandCooldownMs: 750, gameCommandCooldownMs: 1500, maxQueue: 100 }
  };
}
function normalizeAction(input = {}) {
  const type = text(input.type, 40).toLowerCase();
  return {
    id: text(input.id, 120) || id("action"),
    type,
    enabled: input.enabled !== false,
    delayMs: clamp(input.delayMs ?? input.milliseconds, 0, 600000, 0),
    message: text(input.message, 4000),
    keys: Array.isArray(input.keys) ? input.keys.map((key) => text(key, 40)).filter(Boolean).slice(0, 12) : [],
    target: input.target && typeof input.target === "object" ? {
      mode: ["active", "process", "window", "obs", "program"].includes(input.target.mode) ? input.target.mode : "active",
      process: text(input.target.process, 260),
      window: text(input.target.window, 260),
      program: text(input.target.program, 520),
      requireRunning: input.target.requireRunning !== false
    } : { mode: "active", process: "", window: "", program: "", requireRunning: true },
    file: text(input.file, 520),
    poolId: text(input.poolId, 120),
    durationMs: clamp(input.durationMs, 0, 3600000, 0),
    volume: clamp(input.volume, 0, 1, 1),
    loop: input.loop === true,
    fadeMs: clamp(input.fadeMs, 0, 60000, 250),
    obsAction: text(input.obsAction || input.action, 120),
    obsPayload: input.obsPayload && typeof input.obsPayload === "object" ? input.obsPayload : {},
    webhookUrl: text(input.webhookUrl, 1000),
    title: text(input.title, 500),
    body: text(input.body, 4000),
    platforms: safePlatforms(input.platforms)
  };
}
function normalizeCommand(input = {}) {
  return {
    id: text(input.id, 120) || id("command"),
    command: text(input.command, 80).toLowerCase(),
    enabled: input.enabled !== false,
    platforms: safePlatforms(input.platforms).length ? safePlatforms(input.platforms) : [...PLATFORMS],
    permission: ROLES.includes(input.permission) ? input.permission : "all",
    cooldownMs: clamp(input.cooldownMs ?? Number(input.cooldown) * 1000, 0, 86400000, 30000),
    userCooldownMs: clamp(input.userCooldownMs, 0, 86400000, 0),
    onlyWhenLive: input.onlyWhenLive === true,
    targetProcess: text(input.targetProcess, 260),
    actions: Array.isArray(input.actions) ? input.actions.map(normalizeAction).filter((action) => action.type) : []
  };
}
function normalizeBroadcast(input = {}) {
  const messages = Array.isArray(input.messages) ? input.messages.map((item) => text(item, 1000)).filter(Boolean) : [text(input.message, 1000)].filter(Boolean);
  return {
    id: text(input.id, 120) || id("broadcast"), enabled: input.enabled !== false,
    platforms: safePlatforms(input.platforms).length ? safePlatforms(input.platforms) : [...PLATFORMS],
    messages, intervalMs: clamp(input.intervalMs, 10000, 86400000, 300000), randomInterval: input.randomInterval === true,
    intervalMinMs: clamp(input.intervalMinMs, 10000, 86400000, 180000), intervalMaxMs: clamp(input.intervalMaxMs, 10000, 86400000, 600000),
    startDelayMs: clamp(input.startDelayMs, 0, 86400000, 0), rotation: input.rotation !== false,
    onlyWhenLive: input.onlyWhenLive === true, onlyWhenActive: input.onlyWhenActive === true, minChatMessages: clamp(input.minChatMessages, 0, 10000, 1)
  };
}
function normalizeEvent(input = {}) {
  return {
    id: text(input.id, 120) || id("event"), enabled: input.enabled !== false,
    trigger: text(input.trigger, 80).toLowerCase(), platforms: safePlatforms(input.platforms), cooldownMs: clamp(input.cooldownMs, 0, 86400000, 0),
    actions: Array.isArray(input.actions) ? input.actions.map(normalizeAction).filter((action) => action.type) : []
  };
}
function normalizePool(input = {}) {
  return { id: text(input.id, 120) || id("pool"), name: text(input.name, 120) || "Medien-Pool", mode: ["fixed", "rotate", "random"].includes(input.mode) ? input.mode : "random", files: Array.isArray(input.files) ? input.files.map((file) => text(file, 520)).filter(Boolean) : [] };
}
function normalizeConfig(input = {}) {
  const base = defaultConfig();
  return {
    ...base, ...input,
    platforms: { ...base.platforms, ...(input.platforms || {}) },
    broadcasts: Array.isArray(input.broadcasts) ? input.broadcasts.map(normalizeBroadcast) : [],
    commands: Array.isArray(input.commands) ? input.commands.map(normalizeCommand) : [],
    events: Array.isArray(input.events) ? input.events.map(normalizeEvent) : [],
    discord: { ...base.discord, ...(input.discord || {}) },
    media: { ...base.media, ...(input.media || {}), pools: Array.isArray(input.media?.pools) ? input.media.pools.map(normalizePool) : [] },
    overlay: { ...base.overlay, ...(input.overlay || {}), host: "127.0.0.1", port: clamp(input.overlay?.port, 1024, 65535, 8787) },
    safety: { ...base.safety, ...(input.safety || {}) }
  };
}
function substitute(template, context = {}) {
  return String(template || "").replace(/\{([a-z0-9_]+)\}/gi, (_match, key) => String(context[key] ?? ""));
}
function roleRank(message = {}) {
  const badges = new Set(Array.isArray(message.badges) ? message.badges.map((x) => String(x).toLowerCase()) : []);
  const role = String(message.role || "").toLowerCase();
  if (role === "broadcaster" || badges.has("broadcaster")) return 5;
  if (role === "moderator" || badges.has("moderator")) return 4;
  if (role === "vip" || badges.has("vip")) return 3;
  if (role === "subscriber" || badges.has("subscriber") || badges.has("member")) return 2;
  if (role === "follower" || badges.has("follower")) return 1;
  return 0;
}
function allowed(permission, message) {
  const need = { all: 0, follower: 1, subscriber: 2, vip: 3, moderator: 4, broadcaster: 5 }[permission] ?? 0;
  return roleRank(message) >= need;
}
function sendKeysExpression(keys) {
  const list = keys.map((key) => String(key).trim().toUpperCase()).filter(Boolean);
  const modifiers = { CTRL: "^", CONTROL: "^", ALT: "%", SHIFT: "+" };
  let prefix = "";
  const normal = [];
  for (const key of list) {
    if (modifiers[key]) prefix += modifiers[key]; else normal.push(key);
  }
  const mapped = normal.map((key) => /^F(?:[1-9]|1[0-2])$/.test(key) || ["ENTER", "ESC", "ESCAPE", "TAB", "SPACE", "UP", "DOWN", "LEFT", "RIGHT", "HOME", "END", "PGUP", "PGDN", "DELETE", "BACKSPACE"].includes(key) ? `{${key === "ESCAPE" ? "ESC" : key}}` : key.length === 1 ? key : `{${key}}`).join("");
  return prefix + mapped;
}

class ChatBotService extends EventEmitter {
  constructor({ configFile, mediaRoot, sendChat, obs, isLive } = {}) {
    super();
    this.configFile = configFile;
    this.mediaRoot = mediaRoot || path.join(path.dirname(configFile || process.cwd()), "chat-bot-media");
    this.sendChat = typeof sendChat === "function" ? sendChat : async () => { throw new Error("Für diese Plattform ist noch kein Sendekanal verbunden."); };
    this.obs = obs || null;
    this.isLive = typeof isLive === "function" ? isLive : () => false;
    this.config = defaultConfig();
    this.logs = [];
    this.commandCooldowns = new Map();
    this.userCooldowns = new Map();
    this.eventCooldowns = new Map();
    this.broadcastTimers = new Map();
    this.broadcastIndexes = new Map();
    this.poolIndexes = new Map();
    this.chatActivity = Object.fromEntries(PLATFORMS.map((p) => [p, 0]));
    this.actionRunning = false;
    this.server = null;
    this.wss = null;
    this.clients = new Set();
  }

  async load() {
    try { this.config = normalizeConfig(JSON.parse(await fsp.readFile(this.configFile, "utf8"))); }
    catch { this.config = defaultConfig(); await this.save(); }
    await fsp.mkdir(this.mediaRoot, { recursive: true });
    return this.snapshot();
  }
  async save() {
    await fsp.mkdir(path.dirname(this.configFile), { recursive: true });
    await fsp.writeFile(this.configFile, JSON.stringify(this.config, null, 2), { encoding: "utf8", mode: 0o600 });
    return this.snapshot();
  }
  async update(value = {}) { this.config = normalizeConfig({ ...this.config, ...value }); await this.save(); this.restartBroadcasts(); return this.snapshot(); }
  snapshot() {
    return {
      config: clone(this.config), logs: this.logs.slice(-200),
      overlay: { running: Boolean(this.server), baseUrl: this.server ? `http://127.0.0.1:${this.config.overlay.port}` : "", urls: this.overlayUrls() },
      mediaRoot: this.mediaRoot
    };
  }
  overlayUrls() {
    const base = `http://127.0.0.1:${this.config.overlay.port}`;
    return { all: `${base}/overlay/all`, follow: `${base}/overlay/follow`, gifts: `${base}/overlay/gifts`, subs: `${base}/overlay/subs`, media: `${base}/overlay/media`, chat: `${base}/overlay/chat` };
  }
  log(type, message, details = {}) {
    const entry = { id: id("log"), time: Date.now(), type, message: text(message, 1000), details };
    this.logs.push(entry); if (this.logs.length > 1000) this.logs.splice(0, this.logs.length - 1000); this.emit("log", entry); return entry;
  }

  async start() {
    if (!this.configFile) throw new Error("Chat-Bot-Konfigurationsdatei fehlt.");
    await this.load();
    if (this.config.overlay.enabled) await this.startOverlay();
    this.restartBroadcasts();
    return this.snapshot();
  }
  async stop() {
    for (const timer of this.broadcastTimers.values()) clearTimeout(timer);
    this.broadcastTimers.clear();
    for (const client of this.clients) { try { client.close(); } catch {} }
    this.clients.clear();
    if (this.wss) { try { this.wss.close(); } catch {} this.wss = null; }
    if (this.server) await new Promise((resolve) => this.server.close(resolve));
    this.server = null;
  }

  async startOverlay() {
    if (this.server) return;
    this.server = http.createServer((req, res) => void this.handleHttp(req, res));
    this.wss = new WebSocketServer({ noServer: true });
    this.wss.on("connection", (socket) => {
      this.clients.add(socket);
      socket.send(JSON.stringify({ type: "hello", payload: { config: this.config.overlay } }));
      socket.on("close", () => this.clients.delete(socket));
    });
    this.server.on("upgrade", (req, socket, head) => {
      if (new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`).pathname !== "/ws") return socket.destroy();
      this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit("connection", ws, req));
    });
    await new Promise((resolve, reject) => {
      const onError = (error) => { this.server?.off("listening", onListen); reject(error); };
      const onListen = () => { this.server?.off("error", onError); resolve(); };
      this.server.once("error", onError); this.server.once("listening", onListen);
      this.server.listen(this.config.overlay.port, "127.0.0.1");
    });
    this.log("overlay", `Overlay-Server auf 127.0.0.1:${this.config.overlay.port} gestartet.`);
  }
  async handleHttp(req, res) {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    if (url.pathname === "/api/status") return this.json(res, 200, { running: true, urls: this.overlayUrls() });
    if (url.pathname === "/api/config") return this.json(res, 200, this.config.overlay);
    if (url.pathname.startsWith("/overlay/")) return this.html(res, this.overlayDocument(url.pathname.split("/").pop() || "all"));
    if (url.pathname.startsWith("/media/")) return this.serveMedia(res, decodeURIComponent(url.pathname.slice(7)));
    return this.json(res, 404, { error: "Not found" });
  }
  json(res, status, value) { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(JSON.stringify(value)); }
  html(res, value) { res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); res.end(value); }
  async serveMedia(res, name) {
    const safe = path.basename(name);
    const file = path.join(this.mediaRoot, safe);
    try {
      const stat = await fsp.stat(file); if (!stat.isFile()) throw new Error("not file");
      const ext = path.extname(file).toLowerCase();
      const mime = { ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".mp4": "video/mp4", ".webm": "video/webm", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" }[ext] || "application/octet-stream";
      res.writeHead(200, { "content-type": mime, "content-length": stat.size, "cache-control": "no-store" }); fs.createReadStream(file).pipe(res);
    } catch { this.json(res, 404, { error: "Media not found" }); }
  }
  overlayDocument(channel) {
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent!important;font-family:Segoe UI,Arial,sans-serif}.stage{position:relative;width:100%;height:100%;display:grid;place-items:center}.media{max-width:92%;max-height:92%;object-fit:contain;filter:drop-shadow(0 14px 40px #0008)}.alert{padding:18px 24px;border:1px solid #5ad8ff66;border-radius:14px;background:#07111dcc;color:white;box-shadow:0 18px 60px #0009;font-size:30px;backdrop-filter:blur(12px)}.hidden{display:none!important}</style></head><body><div class="stage" id="stage"></div><script>const channel=${JSON.stringify(channel)};const stage=document.getElementById('stage');let timer=null;function clear(){clearTimeout(timer);stage.innerHTML=''}function show(e){if(channel!=='all'&&channel!=='media'&&e.channel&&e.channel!==channel)return;clear();const p=e.payload||{};if(e.type==='media'){const ext=(p.file||'').split('.').pop().toLowerCase();const src='/media/'+encodeURIComponent((p.file||'').split(/[\\/]/).pop());if(['mp4','webm'].includes(ext)){const v=document.createElement('video');v.className='media';v.src=src;v.autoplay=true;v.loop=!!p.loop;v.volume=Number.isFinite(p.volume)?p.volume:1;stage.appendChild(v)}else if(['mp3','wav','ogg'].includes(ext)){const a=document.createElement('audio');a.src=src;a.autoplay=true;a.volume=Number.isFinite(p.volume)?p.volume:1;stage.appendChild(a)}else{const i=document.createElement('img');i.className='media';i.src=src;stage.appendChild(i)}}else if(e.type==='tts'){const u=new SpeechSynthesisUtterance(p.text||'');u.rate=p.rate||1;u.volume=p.volume??1;speechSynthesis.speak(u)}else{const d=document.createElement('div');d.className='alert';d.textContent=p.message||p.text||e.type;stage.appendChild(d)}timer=setTimeout(clear,Math.max(250,p.durationMs||7000))}const ws=new WebSocket('ws://127.0.0.1:${this.config.overlay.port}/ws');ws.onmessage=x=>{try{show(JSON.parse(x.data))}catch{}};</script></body></html>`;
  }
  publish(type, payload = {}, channel = "all") {
    const event = { id: id("overlay"), type, channel, time: Date.now(), payload };
    const raw = JSON.stringify(event);
    for (const client of this.clients) if (client.readyState === 1) { try { client.send(raw); } catch {} }
    this.emit("overlay", event); return event;
  }

  restartBroadcasts() {
    for (const timer of this.broadcastTimers.values()) clearTimeout(timer);
    this.broadcastTimers.clear();
    if (!this.config.enabled) return;
    for (const item of this.config.broadcasts) if (item.enabled) this.scheduleBroadcast(item, item.startDelayMs);
  }
  scheduleBroadcast(item, overrideMs = null) {
    const ms = overrideMs ?? (item.randomInterval ? Math.round(item.intervalMinMs + Math.random() * Math.max(0, item.intervalMaxMs - item.intervalMinMs)) : item.intervalMs);
    const timer = setTimeout(async () => {
      try { await this.runBroadcast(item); } catch (error) { this.log("error", `Auto-Broadcast ${item.id}: ${error.message}`); }
      if (this.config.enabled && this.config.broadcasts.some((x) => x.id === item.id && x.enabled)) this.scheduleBroadcast(item);
    }, Math.max(1000, ms));
    timer.unref?.(); this.broadcastTimers.set(item.id, timer);
  }
  async runBroadcast(item) {
    if (item.onlyWhenLive && !await this.isLive()) return;
    if (!item.messages.length) return;
    const index = this.broadcastIndexes.get(item.id) || 0;
    const message = item.rotation ? item.messages[index % item.messages.length] : item.messages[Math.floor(Math.random() * item.messages.length)];
    this.broadcastIndexes.set(item.id, index + 1);
    for (const platform of item.platforms) {
      if (!this.config.platforms[platform]?.enabled) continue;
      if (item.onlyWhenActive && this.chatActivity[platform] < item.minChatMessages) continue;
      await this.sendChat(platform, message);
      this.log("broadcast", `${platform}: ${message}`, { platform, itemId: item.id });
    }
  }

  async ingestChat(message = {}) {
    const platform = PLATFORMS.includes(message.platform) ? message.platform : "cng";
    this.chatActivity[platform] = (this.chatActivity[platform] || 0) + 1;
    if (!this.config.enabled || !this.config.platforms[platform]?.enabled) return { matched: false };
    const body = text(message.message || message.text, 1000);
    const token = body.split(/\s+/)[0].toLowerCase();
    const command = this.config.commands.find((item) => item.enabled && item.command === token && item.platforms.includes(platform));
    if (!command) return { matched: false };
    if (!allowed(command.permission, message)) return { matched: true, executed: false, reason: "permission" };
    if (command.onlyWhenLive && !await this.isLive()) return { matched: true, executed: false, reason: "offline" };
    if (command.targetProcess && !(await this.processRunning(command.targetProcess))) return { matched: true, executed: false, reason: "target-process" };
    const now = Date.now();
    const globalKey = command.id;
    const userKey = `${command.id}:${String(message.userId || message.username || "user").toLowerCase()}`;
    if (now < (this.commandCooldowns.get(globalKey) || 0)) return { matched: true, executed: false, reason: "cooldown" };
    if (now < (this.userCooldowns.get(userKey) || 0)) return { matched: true, executed: false, reason: "user-cooldown" };
    this.commandCooldowns.set(globalKey, now + command.cooldownMs);
    this.userCooldowns.set(userKey, now + command.userCooldownMs);
    const context = this.context({ ...message, platform, command: command.command });
    await this.runActions(command.actions, context);
    this.log("command", `${message.username || "User"}: ${command.command}`, { platform, commandId: command.id });
    return { matched: true, executed: true };
  }
  async triggerEvent(trigger, payload = {}) {
    const name = text(trigger, 80).toLowerCase();
    const now = Date.now();
    const matches = this.config.events.filter((item) => item.enabled && item.trigger === name && (!item.platforms.length || item.platforms.includes(payload.platform)));
    const results = [];
    for (const item of matches) {
      if (now < (this.eventCooldowns.get(item.id) || 0)) continue;
      this.eventCooldowns.set(item.id, now + item.cooldownMs);
      await this.runActions(item.actions, this.context({ ...payload, trigger: name }));
      results.push(item.id);
    }
    return { trigger: name, executed: results };
  }
  context(payload = {}) {
    return {
      user: payload.username || payload.user || "User", streamer: payload.streamer || "", title: payload.title || "", game: payload.game || "",
      stream_url: payload.streamUrl || payload.stream_url || "", platform: payload.platform || "", viewer_count: payload.viewerCount || payload.viewer_count || "",
      start_time: payload.startTime || payload.start_time || new Date().toISOString(), custom_text: payload.customText || payload.custom_text || "", thumbnail: payload.thumbnail || "",
      ...payload
    };
  }

  async runActions(actions, context = {}) {
    if (this.config.safety.oneActionChainAtATime && this.actionRunning) throw new Error("Eine andere Multi-Action läuft bereits.");
    this.actionRunning = true;
    try {
      for (const action of actions) {
        if (!action.enabled) continue;
        if (action.delayMs) await delay(action.delayMs);
        switch (action.type) {
          case "delay": await delay(action.delayMs); break;
          case "chat": {
            const message = substitute(action.message, context);
            const platforms = action.platforms.length ? action.platforms : [context.platform].filter(Boolean);
            for (const platform of platforms) await this.sendChat(platform, message);
            break;
          }
          case "hotkey": await this.hotkey(action); break;
          case "sound": case "video": case "image": case "gif": case "media": {
            const file = this.pickMedia(action); if (!file) throw new Error("Für die Medien-Aktion ist keine Datei konfiguriert.");
            this.publish("media", { file, durationMs: action.durationMs || this.config.overlay.defaultDurationMs, volume: action.volume, loop: action.loop, fadeMs: action.fadeMs }, "media");
            break;
          }
          case "tts": this.publish("tts", { text: substitute(action.message || action.body, context), volume: action.volume }, "all"); break;
          case "obs": {
            if (!this.obs?.execute) throw new Error("OBS ist für den Chat-Bot nicht verfügbar.");
            await this.obs.execute(action.obsAction, action.obsPayload || {}); break;
          }
          case "discord": case "discord-webhook": await this.discord(action, context); break;
          case "overlay": this.publish("alert", { message: substitute(action.message, context), durationMs: action.durationMs || this.config.overlay.defaultDurationMs }, action.channel || "all"); break;
          default: throw new Error(`Unbekannte Chat-Bot-Aktion: ${action.type}`);
        }
      }
    } finally { this.actionRunning = false; }
  }
  pickMedia(action) {
    if (action.file) return path.basename(action.file);
    const pool = this.config.media.pools.find((item) => item.id === action.poolId);
    if (!pool?.files.length) return "";
    if (pool.mode === "fixed") return path.basename(pool.files[0]);
    if (pool.mode === "random") return path.basename(pool.files[Math.floor(Math.random() * pool.files.length)]);
    const index = this.poolIndexes.get(pool.id) || 0; this.poolIndexes.set(pool.id, index + 1); return path.basename(pool.files[index % pool.files.length]);
  }
  async discord(action = {}, context = {}) {
    const url = action.webhookUrl || this.config.discord.webhookUrl;
    if (!/^https:\/\/(?:discord(?:app)?\.com|discord\.com)\/api\/webhooks\//i.test(url)) throw new Error("Ungültiger Discord-Webhook.");
    const title = substitute(action.title || this.config.discord.title, context);
    const body = substitute(action.body || action.message || this.config.discord.message, context);
    const payload = this.config.discord.embed ? { embeds: [{ title, description: body, timestamp: new Date().toISOString() }] } : { content: `${title}\n${body}`.trim() };
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    if (!response.ok) throw new Error(`Discord-Webhook fehlgeschlagen (${response.status}).`);
    this.log("discord", title || "Webhook gesendet"); return true;
  }
  processRunning(processName) {
    return new Promise((resolve) => {
      const name = path.basename(String(processName || "")).replace(/\.exe$/i, "");
      if (!name) return resolve(false);
      const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `$p=Get-Process -Name '${name.replaceAll("'", "''")}' -ErrorAction SilentlyContinue; if($p){exit 0}else{exit 3}`], { windowsHide: true, stdio: "ignore" });
      child.on("exit", (code) => resolve(code === 0)); child.on("error", () => resolve(false));
    });
  }
  async hotkey(action) {
    if (process.platform !== "win32") throw new Error("Hotkeys sind in dieser Version nur unter Windows verfügbar.");
    if (!action.keys.length) throw new Error("Hotkey enthält keine Taste.");
    const expr = sendKeysExpression(action.keys);
    const target = action.target || { mode: "active" };
    let pre = "";
    if (target.mode === "process") {
      const processName = path.basename(target.process || "").replace(/\.exe$/i, "");
      if (!processName) throw new Error("Zielprozess fehlt.");
      if (target.requireRunning && !(await this.processRunning(processName))) throw new Error(`Zielprozess läuft nicht: ${processName}`);
      pre = `$p=Get-Process -Name '${processName.replaceAll("'", "''")}' -ErrorAction SilentlyContinue|Select-Object -First 1;if(-not $p){exit 4};$null=$ws.AppActivate($p.Id);Start-Sleep -Milliseconds 80;`;
    } else if (target.mode === "window") {
      if (!target.window) throw new Error("Zielfenster fehlt.");
      pre = `$ok=$ws.AppActivate('${target.window.replaceAll("'", "''")}');if(-not $ok){exit 5};Start-Sleep -Milliseconds 80;`;
    } else if (target.mode === "program") {
      if (!target.program || !fs.existsSync(target.program)) throw new Error("Benutzerdefiniertes Zielprogramm wurde nicht gefunden.");
      pre = `Start-Process -FilePath '${target.program.replaceAll("'", "''")}';Start-Sleep -Milliseconds 350;`;
    } else if (target.mode === "obs") {
      pre = `$p=Get-Process -Name 'obs64' -ErrorAction SilentlyContinue|Select-Object -First 1;if(-not $p){exit 4};$null=$ws.AppActivate($p.Id);Start-Sleep -Milliseconds 80;`;
    }
    const script = `$ws=New-Object -ComObject WScript.Shell;${pre}$ws.SendKeys('${expr.replaceAll("'", "''")}')`;
    await new Promise((resolve, reject) => {
      const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], { windowsHide: true, stdio: "ignore" });
      child.on("error", reject); child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Hotkey konnte nicht an das Ziel gesendet werden (Code ${code}).`)));
    });
  }
}

module.exports = { ChatBotService, defaultConfig, normalizeConfig, normalizeCommand, normalizeAction, substitute, allowed, sendKeysExpression };
