"use strict";

const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const DefaultWebSocket = require("ws");
const { deepClone, randomId, readJson, safeText, writeJsonAtomic } = require("./common.cjs");

function defaultSettings() {
  return {
    enabledPlatforms: { twitch: true, youtube: true, tiktok: true, tikfinity: true, tiktory: true },
    forwardToOverlay: true,
    twitch: { channel: "", oauth: "", nickname: "" },
    youtube: { apiKey: "", liveChatId: "", pollingSeconds: 5 },
    tikfinity: { url: "ws://127.0.0.1:21213/", autoConnect: true },
    filters: { blockedWords: [], blockedUsers: [], hideLinks: false, maximumLength: 500 },
    tts: {
      enabled: false, maximumLength: 240, voice: "", rate: 0, pitch: 0, volume: 100,
      includeName: true, roles: ["broadcaster", "moderator", "vip", "subscriber", "viewer"]
    },
    bot: { enabled: true, prefix: "!", roles: ["broadcaster", "moderator"], speakCommands: false }
  };
}

function normalizeSettings(value = {}) {
  const fallback = defaultSettings();
  const filters = { ...fallback.filters, ...(value.filters || {}) };
  const tts = { ...fallback.tts, ...(value.tts || {}) };
  const bot = { ...fallback.bot, ...(value.bot || {}) };
  const allowedRoles = new Set(["broadcaster", "moderator", "vip", "subscriber", "viewer"]);
  const roles = (candidate, defaults) => (Array.isArray(candidate) ? candidate : defaults)
    .map((role) => safeText(role, 40).toLowerCase())
    .filter((role, index, list) => allowedRoles.has(role) && list.indexOf(role) === index);
  const enabledPlatforms = { ...fallback.enabledPlatforms };
  for (const [platform, enabled] of Object.entries(value.enabledPlatforms || {})) {
    if (Object.hasOwn(enabledPlatforms, platform)) enabledPlatforms[platform] = enabled !== false;
  }
  return {
    enabledPlatforms,
    forwardToOverlay: value.forwardToOverlay !== false,
    twitch: { ...fallback.twitch, ...(value.twitch || {}) },
    youtube: {
      ...fallback.youtube,
      ...(value.youtube || {}),
      pollingSeconds: Math.max(2, Math.min(30, Number(value.youtube?.pollingSeconds) || fallback.youtube.pollingSeconds))
    },
    tikfinity: { ...fallback.tikfinity, ...(value.tikfinity || {}) },
    filters: {
      ...filters,
      blockedWords: Array.isArray(filters.blockedWords) ? filters.blockedWords.map((word) => safeText(word, 120)).filter(Boolean).slice(0, 500) : [],
      blockedUsers: Array.isArray(filters.blockedUsers) ? filters.blockedUsers.map((user) => safeText(user, 120)).filter(Boolean).slice(0, 500) : [],
      maximumLength: Math.max(1, Math.min(5000, Number(filters.maximumLength) || fallback.filters.maximumLength))
    },
    tts: {
      ...tts,
      maximumLength: Math.max(20, Math.min(1000, Number(tts.maximumLength) || fallback.tts.maximumLength)),
      rate: Math.max(-10, Math.min(10, Number(tts.rate) || 0)),
      volume: Number.isFinite(Number(tts.volume)) ? Math.max(0, Math.min(100, Number(tts.volume))) : fallback.tts.volume,
      roles: roles(tts.roles, fallback.tts.roles)
    },
    bot: {
      ...bot,
      prefix: safeText(bot.prefix || fallback.bot.prefix, 4).replace(/[\r\n]/g, ""),
      roles: roles(bot.roles, fallback.bot.roles)
    }
  };
}

function normalizedTimestamp(value, fallback = Date.now()) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return fallback;
  if (timestamp < 100_000_000_000) return Math.round(timestamp * 1000);
  if (timestamp > 10_000_000_000_000) return Math.round(timestamp / 1000);
  return Math.round(timestamp);
}

function shortHash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 24);
}

function oneLine(value, maximum = 500) {
  return safeText(value, maximum).replace(/[\r\n]+/g, " ").trim();
}

function twitchIdentifier(value, label) {
  const identifier = oneLine(value, 40).replace(/^#/, "").toLowerCase();
  if (!/^[a-z0-9_]{1,25}$/.test(identifier)) throw new Error(`${label} ist ungültig.`);
  return identifier;
}

function parseIrcTags(line) {
  const tags = {};
  const firstSpace = line.indexOf(" ");
  if (!line.startsWith("@") || firstSpace < 0) return { tags, remainder: line };
  for (const part of line.slice(1, firstSpace).split(";")) {
    const [key, raw = ""] = part.split("=");
    tags[key] = raw.replace(/\\s/g, " ").replace(/\\:/g, ";").replace(/\\\\/g, "\\").replace(/\\r/g, "\r").replace(/\\n/g, "\n");
  }
  return { tags, remainder: line.slice(firstSpace + 1) };
}

function roleFromTwitchTags(tags) {
  const badges = String(tags.badges || "");
  if (/broadcaster\//.test(badges)) return "broadcaster";
  if (/moderator\//.test(badges) || tags.mod === "1") return "moderator";
  if (/vip\//.test(badges)) return "vip";
  if (/subscriber\//.test(badges) || tags.subscriber === "1") return "subscriber";
  return "viewer";
}

function normalizeChatRole(value) {
  const role = safeText(value || "viewer", 40).toLowerCase();
  return ["broadcaster", "moderator", "vip", "subscriber", "viewer"].includes(role) ? role : "viewer";
}

function powershellEncoded(value) { return Buffer.from(value, "utf16le").toString("base64"); }

class MultiChat extends EventEmitter {
  constructor({
    settingsFile,
    overlayServer,
    fetchImpl = globalThis.fetch,
    WebSocketImpl = DefaultWebSocket,
    spawnImpl = childProcess.spawn,
    platform = process.platform,
    ttsIdleMs = 30000
  } = {}) {
    super();
    this.settingsFile = settingsFile;
    this.overlayServer = overlayServer;
    this.fetchImpl = fetchImpl;
    this.WebSocketImpl = WebSocketImpl;
    this.spawnImpl = spawnImpl;
    this.platform = platform;
    this.ttsIdleMs = Math.max(20, Number(ttsIdleMs) || 30000);
    const storedSettings = readJson(settingsFile, null) || {};
    this.settings = normalizeSettings(storedSettings);
    this.messages = [];
    this.twitchSocket = null;
    this.twitchConnected = false;
    this.twitchGeneration = 0;
    this.twitchConnectTimer = null;
    this.twitchConnectFinish = null;
    this.youtubeTimer = null;
    this.youtubeAbortController = null;
    this.youtubeGeneration = 0;
    this.youtubePageToken = "";
    this.youtubeConnected = false;
    this.seenYouTubeMessages = new Set();
    this.tikfinitySocket = null;
    this.tikfinityConnected = false;
    this.tikfinityRetryTimer = null;
    this.tikfinityRetryMs = 1000;
    this.tikfinityManualDisconnect = false;
    this.seenTikfinityEvents = new Map();
    this.ttsQueue = [];
    this.ttsRunning = false;
    this.ttsProcess = null;
    this.ttsBuffer = "";
    this.ttsCurrent = null;
    this.ttsIdleTimer = null;
    this.ttsRestartTimer = null;
    this.lastError = {};
    if (settingsFile && (storedSettings.twitch?.oauth || storedSettings.youtube?.apiKey)) this.persistSettings();
  }

  persistSettings() {
    if (!this.settingsFile) return;
    const stored = deepClone(this.settings);
    stored.twitch.oauth = "";
    stored.youtube.apiKey = "";
    writeJsonAtomic(this.settingsFile, stored);
  }

  snapshot() {
    const overlayStatus = this.overlayServer?.status?.() || {};
    return {
      settings: deepClone({ ...this.settings, twitch: { ...this.settings.twitch, oauth: this.settings.twitch.oauth ? "••••••••" : "" }, youtube: { ...this.settings.youtube, apiKey: this.settings.youtube.apiKey ? "••••••••" : "" } }),
      messages: deepClone(this.messages.slice(-300)),
      status: {
        twitch: this.twitchConnected,
        youtube: this.youtubeConnected,
        tikfinity: this.tikfinityConnected,
        localWebhook: Boolean(overlayStatus.active),
        localWebhookUrl: overlayStatus.chatUrl || "",
        ttsQueue: this.ttsQueue.length + (this.ttsCurrent ? 1 : 0),
        lastError: deepClone(this.lastError)
      }
    };
  }

  updateSettings(patch = {}, secrets = {}) {
    const ttsWasEnabled = this.settings.tts.enabled;
    this.settings = normalizeSettings({
      ...this.settings,
      ...patch,
      twitch: { ...this.settings.twitch, ...(patch.twitch || {}) },
      youtube: { ...this.settings.youtube, ...(patch.youtube || {}) },
      tikfinity: { ...this.settings.tikfinity, ...(patch.tikfinity || {}) },
      filters: { ...this.settings.filters, ...(patch.filters || {}) },
      tts: { ...this.settings.tts, ...(patch.tts || {}) },
      bot: { ...this.settings.bot, ...(patch.bot || {}) }
    });
    if (secrets.twitchOauth !== undefined) this.settings.twitch.oauth = String(secrets.twitchOauth || "");
    if (secrets.youtubeApiKey !== undefined) this.settings.youtube.apiKey = String(secrets.youtubeApiKey || "");
    if (ttsWasEnabled && this.settings.tts.enabled === false) this.clearTts();
    this.persistSettings();
    this.emit("changed", this.snapshot());
    return this.snapshot();
  }

  filter(message) {
    const user = String(message.name || "").toLowerCase();
    if ((this.settings.filters.blockedUsers || []).some((entry) => String(entry).toLowerCase() === user)) return null;
    let text = safeText(message.text, Math.max(1, Number(this.settings.filters.maximumLength) || 500));
    if (!text) return null;
    for (const word of this.settings.filters.blockedWords || []) {
      const escaped = String(word).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (escaped) text = text.replace(new RegExp(escaped, "gi"), "•••");
    }
    if (this.settings.filters.hideLinks) text = text.replace(/https?:\/\/\S+/gi, "[Link ausgeblendet]");
    return { ...message, text };
  }

  ingest(message = {}) {
    const platform = safeText(message.platform || "local", 40).toLowerCase();
    if (this.settings.enabledPlatforms[platform] === false) return null;
    const normalized = this.filter({
      id: safeText(message.id || randomId("chat"), 180), platform,
      name: safeText(message.name || message.user || "Zuschauer", 120),
      userId: safeText(message.userId || "", 160),
      color: /^#[0-9a-f]{6}$/i.test(String(message.color || "")) ? String(message.color) : "#ffffff",
      role: normalizeChatRole(message.role),
      badges: Array.isArray(message.badges) ? message.badges.map((badge) => safeText(badge, 100)) : [],
      text: safeText(message.text || message.message || "", 5000),
      timestamp: Number(message.timestamp) || Date.now(),
      raw: message.raw && typeof message.raw === "object" ? message.raw : {}
    });
    if (!normalized) return null;
    this.messages.push(normalized);
    if (this.messages.length > 1000) this.messages.splice(0, this.messages.length - 1000);
    if (this.settings.forwardToOverlay) this.overlayServer?.publishEvent({
      type: "chat",
      ...normalized,
      data: { ...(normalized.raw || {}), multiChatForwarded: true }
    });
    const command = this.routeCommand(normalized);
    if (!command || this.settings.bot.speakCommands) this.enqueueTts(normalized);
    this.emit("message", normalized);
    this.emit("changed", this.snapshot());
    return normalized;
  }

  routeCommand(message) {
    const settings = this.settings.bot || {};
    const prefix = String(settings.prefix || "!").slice(0, 4);
    if (!settings.enabled || !prefix || !String(message.text || "").startsWith(prefix)) return null;
    if (!(settings.roles || []).includes(message.role)) return null;
    const parts = String(message.text).slice(prefix.length).trim().split(/\s+/).filter(Boolean);
    const command = safeText(parts.shift() || "", 80).toLowerCase();
    if (!command) return null;
    const payload = { command, args: parts.map((part) => safeText(part, 200)), message };
    this.emit("command", payload);
    return payload;
  }

  clear() {
    this.messages = [];
    this.emit("changed", this.snapshot());
    return this.snapshot();
  }

  async connectTwitch(options = {}) {
    this.disconnectTwitch({ emit: false, reason: "Neue Twitch-Verbindung wird aufgebaut." });
    const channelValue = options.channel || this.settings.twitch.channel || "";
    if (!oneLine(channelValue, 40).replace(/^#/, "")) throw new Error("Twitch-Kanalname fehlt.");
    const channel = twitchIdentifier(channelValue, "Twitch-Kanalname");
    const oauth = oneLine(options.oauth || this.settings.twitch.oauth || "", 1000).replace(/^oauth:/i, "");
    const nicknameValue = options.nickname || this.settings.twitch.nickname || (oauth ? channel : `justinfan${Math.floor(Math.random() * 90000 + 10000)}`);
    const nickname = twitchIdentifier(nicknameValue, "Twitch-Benutzername");
    this.settings.twitch = { channel, oauth, nickname };
    this.persistSettings();
    const generation = this.twitchGeneration;
    await new Promise((resolve, reject) => {
      const socket = new this.WebSocketImpl("wss://irc-ws.chat.twitch.tv:443");
      this.twitchSocket = socket;
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(this.twitchConnectTimer);
        this.twitchConnectTimer = null;
        if (this.twitchConnectFinish === finish) this.twitchConnectFinish = null;
        if (error) reject(error); else resolve();
      };
      const fail = (error) => {
        if (socket !== this.twitchSocket || generation !== this.twitchGeneration) return finish(error);
        const failure = error instanceof Error ? error : new Error(String(error || "Twitch-Verbindung fehlgeschlagen."));
        this.lastError.twitch = oneLine(failure.message, 500);
        this.twitchSocket = null;
        this.twitchConnected = false;
        try { if (typeof socket.terminate === "function") socket.terminate(); else socket.close(); } catch {}
        finish(failure);
        this.emit("changed", this.snapshot());
      };
      this.twitchConnectFinish = finish;
      this.twitchConnectTimer = setTimeout(() => fail(new Error("Twitch-Verbindung hat zu lange gedauert.")), 10000);
      this.twitchConnectTimer.unref?.();
      socket.on("open", () => {
        if (socket !== this.twitchSocket || generation !== this.twitchGeneration) return;
        socket.send(`PASS ${oauth ? `oauth:${oauth}` : "SCHMOOPIIE"}`);
        socket.send(`NICK ${nickname}`);
        socket.send("CAP REQ :twitch.tv/tags twitch.tv/commands twitch.tv/membership");
        socket.send(`JOIN #${channel}`);
      });
      socket.on("message", (data) => {
        if (socket !== this.twitchSocket || generation !== this.twitchGeneration) return;
        for (const line of String(data).split("\r\n").filter(Boolean)) {
          if (line.startsWith("PING")) { socket.send(line.replace("PING", "PONG")); continue; }
          if (/Login authentication failed|Improperly formatted auth/i.test(line)) {
            fail(new Error("Twitch-Anmeldung ist fehlgeschlagen. OAuth-Token prüfen."));
            return;
          }
          const ownJoin = line.toLowerCase().startsWith(`:${nickname}!`) && line.toLowerCase().includes(` join #${channel}`);
          if (/ 001 /.test(line) || ownJoin) {
            const changed = !this.twitchConnected;
            this.twitchConnected = true;
            this.lastError.twitch = "";
            finish();
            if (changed) this.emit("changed", this.snapshot());
          }
          this.parseTwitchLine(line);
        }
      });
      socket.on("error", (error) => fail(error));
      socket.on("close", () => {
        if (socket !== this.twitchSocket || generation !== this.twitchGeneration) return;
        const wasConnected = this.twitchConnected;
        this.twitchConnected = false;
        this.twitchSocket = null;
        const error = wasConnected ? null : new Error(this.lastError.twitch || "Twitch wurde vor der Anmeldung getrennt.");
        if (error) this.lastError.twitch = error.message;
        finish(error);
        this.emit("changed", this.snapshot());
      });
    });
    return this.snapshot();
  }

  parseTwitchLine(line) {
    const parsed = parseIrcTags(line);
    const match = parsed.remainder.match(/^:([^!]+)!.* PRIVMSG #[^ ]+ :(.+)$/);
    if (!match) return;
    const tags = parsed.tags;
    const badges = String(tags.badges || "").split(",").filter(Boolean);
    this.ingest({
      id: tags.id || randomId("twitch"), platform: "twitch", name: tags["display-name"] || match[1], userId: tags["user-id"] || "",
      color: tags.color || "#ffffff", role: roleFromTwitchTags(tags), badges, text: match[2], timestamp: Number(tags["tmi-sent-ts"]) || Date.now(), raw: tags
    });
  }

  async sendTwitch(text) {
    const openState = this.WebSocketImpl.OPEN ?? DefaultWebSocket.OPEN;
    if (!this.twitchConnected || !this.twitchSocket || this.twitchSocket.readyState !== openState) throw new Error("Twitch ist nicht verbunden.");
    if (!this.settings.twitch.oauth) throw new Error("Zum Senden wird ein Twitch-OAuth-Token benötigt.");
    const message = oneLine(text, 500);
    if (!message) throw new Error("Twitch-Nachricht ist leer.");
    this.twitchSocket.send(`PRIVMSG #${this.settings.twitch.channel} :${message}`);
    return { ok: true };
  }

  disconnectTwitch({ emit = true, reason = "Twitch wurde getrennt." } = {}) {
    const hadState = Boolean(this.twitchSocket || this.twitchConnected || this.twitchConnectFinish);
    this.twitchGeneration += 1;
    clearTimeout(this.twitchConnectTimer);
    this.twitchConnectTimer = null;
    const finish = this.twitchConnectFinish;
    this.twitchConnectFinish = null;
    const socket = this.twitchSocket;
    this.twitchSocket = null;
    this.twitchConnected = false;
    finish?.(new Error(reason));
    try { socket?.close(1000, "Batto OBS Tool trennt Twitch"); } catch {}
    if (emit && hadState) this.emit("changed", this.snapshot());
    return this.snapshot();
  }

  async connectYouTube(options = {}) {
    this.disconnectYouTube({ emit: false });
    const apiKey = String(options.apiKey || this.settings.youtube.apiKey || "").trim();
    const liveChatId = String(options.liveChatId || this.settings.youtube.liveChatId || "").trim();
    if (!apiKey || !liveChatId) throw new Error("YouTube-API-Schlüssel und Live-Chat-ID werden benötigt.");
    this.settings.youtube = { ...this.settings.youtube, apiKey, liveChatId, pollingSeconds: Math.max(2, Math.min(30, Number(options.pollingSeconds || this.settings.youtube.pollingSeconds) || 5)) };
    this.persistSettings();
    this.youtubeConnected = true;
    const generation = this.youtubeGeneration;
    await this.pollYouTube(generation);
    return this.snapshot();
  }

  async pollYouTube(generation = this.youtubeGeneration) {
    if (!this.youtubeConnected || generation !== this.youtubeGeneration || this.youtubeAbortController) return;
    const controller = new AbortController();
    this.youtubeAbortController = controller;
    try {
      const url = new URL("https://www.googleapis.com/youtube/v3/liveChat/messages");
      url.searchParams.set("part", "snippet,authorDetails");
      url.searchParams.set("liveChatId", this.settings.youtube.liveChatId);
      url.searchParams.set("key", this.settings.youtube.apiKey);
      if (this.youtubePageToken) url.searchParams.set("pageToken", this.youtubePageToken);
      const response = await this.fetchImpl(url, { signal: controller.signal });
      const body = await response.json();
      if (!this.youtubeConnected || generation !== this.youtubeGeneration || controller.signal.aborted) return;
      if (!response.ok) throw new Error(body?.error?.message || `YouTube API HTTP ${response.status}`);
      this.youtubePageToken = body.nextPageToken || this.youtubePageToken;
      for (const item of body.items || []) {
        if (item.id && this.seenYouTubeMessages.has(item.id)) continue;
        if (item.id) {
          this.seenYouTubeMessages.add(item.id);
          if (this.seenYouTubeMessages.size > 2000) this.seenYouTubeMessages.delete(this.seenYouTubeMessages.values().next().value);
        }
        this.ingest({
          id: item.id, platform: "youtube", name: item.authorDetails?.displayName || "YouTube",
          userId: item.authorDetails?.channelId || "", color: "#ff4d57",
          role: item.authorDetails?.isChatOwner ? "broadcaster" : item.authorDetails?.isChatModerator ? "moderator" : item.authorDetails?.isChatSponsor ? "subscriber" : "viewer",
          text: item.snippet?.displayMessage || "", timestamp: Date.parse(item.snippet?.publishedAt) || Date.now(), raw: item
        });
      }
      this.lastError.youtube = "";
      const wait = Math.max(2000, Math.min(60000, Number(body.pollingIntervalMillis) || this.settings.youtube.pollingSeconds * 1000));
      this.youtubeTimer = setTimeout(() => void this.pollYouTube(generation), wait);
      this.youtubeTimer.unref?.();
    } catch (error) {
      if (controller.signal.aborted || generation !== this.youtubeGeneration || !this.youtubeConnected || error?.name === "AbortError") return;
      this.lastError.youtube = String(error.message || error);
      this.emit("changed", this.snapshot());
      this.youtubeTimer = setTimeout(() => void this.pollYouTube(generation), 10000);
      this.youtubeTimer.unref?.();
    } finally {
      if (this.youtubeAbortController === controller) this.youtubeAbortController = null;
    }
  }

  disconnectYouTube({ emit = true } = {}) {
    const hadState = Boolean(this.youtubeConnected || this.youtubeTimer || this.youtubeAbortController);
    this.youtubeGeneration += 1;
    clearTimeout(this.youtubeTimer);
    this.youtubeTimer = null;
    this.youtubeAbortController?.abort();
    this.youtubeAbortController = null;
    this.youtubeConnected = false;
    this.youtubePageToken = "";
    if (emit && hadState) this.emit("changed", this.snapshot());
    return this.snapshot();
  }

  tikfinityUrl(value = this.settings.tikfinity.url) {
    const url = new URL(String(value || "ws://127.0.0.1:21213/"));
    if (url.protocol !== "ws:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
      throw new Error("TikFinity muss über eine lokale unverschlüsselte WebSocket-Adresse verbunden werden.");
    }
    return url.toString();
  }

  start() {
    if (this.settings.enabledPlatforms.tikfinity !== false && this.settings.tikfinity.autoConnect !== false) {
      void this.connectTikfinity({ quiet: true }).catch((error) => {
        this.lastError.tikfinity = oneLine(error?.message || error, 500);
        this.emit("changed", this.snapshot());
      });
    }
    return this.snapshot();
  }

  async connectTikfinity(options = {}) {
    this.disconnectTikfinity({ manual: false, emit: false });
    const url = this.tikfinityUrl(options.url || this.settings.tikfinity.url);
    this.settings.tikfinity.url = url;
    this.tikfinityManualDisconnect = false;
    const socket = new this.WebSocketImpl(url);
    this.tikfinitySocket = socket;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        if (error && !options.quiet) reject(error);
        else resolve(this.snapshot());
      };
      const fail = (error) => {
        if (socket !== this.tikfinitySocket) return finish(error);
        const failure = error instanceof Error ? error : new Error(String(error || "TikFinity ist nicht erreichbar."));
        this.lastError.tikfinity = oneLine(failure.message, 500);
        this.tikfinitySocket = null;
        this.tikfinityConnected = false;
        try { if (typeof socket.terminate === "function") socket.terminate(); else socket.close(); } catch {}
        finish(failure);
        this.emit("changed", this.snapshot());
        this.scheduleTikfinityReconnect();
      };
      const timer = setTimeout(() => fail(new Error("TikFinity antwortet nicht. Läuft die TikFinity-Desktop-App?")), 5000);
      timer.unref?.();
      socket.on("open", () => {
        clearTimeout(timer);
        if (socket !== this.tikfinitySocket) return;
        this.tikfinityConnected = true;
        this.tikfinityRetryMs = 1000;
        this.lastError.tikfinity = "";
        this.emit("changed", this.snapshot());
        finish();
      });
      socket.on("message", (data) => { if (socket === this.tikfinitySocket) this.parseTikfinityPacket(data); });
      socket.on("error", (error) => { clearTimeout(timer); fail(error); });
      socket.on("close", () => {
        clearTimeout(timer);
        if (socket !== this.tikfinitySocket) return;
        fail(new Error(this.lastError.tikfinity || "TikFinity wurde getrennt."));
      });
    });
  }

  scheduleTikfinityReconnect() {
    clearTimeout(this.tikfinityRetryTimer);
    if (this.tikfinityManualDisconnect || this.settings.enabledPlatforms.tikfinity === false || this.settings.tikfinity.autoConnect === false) return;
    const delay = this.tikfinityRetryMs;
    this.tikfinityRetryMs = Math.min(30000, Math.round(this.tikfinityRetryMs * 1.8));
    this.tikfinityRetryTimer = setTimeout(() => {
      void this.connectTikfinity({ quiet: true }).catch((error) => {
        this.lastError.tikfinity = oneLine(error?.message || error, 500);
        this.emit("changed", this.snapshot());
      });
    }, delay);
    this.tikfinityRetryTimer.unref?.();
  }

  disconnectTikfinity({ manual = true, emit = true } = {}) {
    const hadState = Boolean(this.tikfinitySocket || this.tikfinityConnected || this.tikfinityRetryTimer);
    this.tikfinityManualDisconnect = manual;
    clearTimeout(this.tikfinityRetryTimer);
    this.tikfinityRetryTimer = null;
    const socket = this.tikfinitySocket;
    this.tikfinitySocket = null;
    this.tikfinityConnected = false;
    try { socket?.close(1000, "Batto OBS Tool trennt TikFinity"); } catch {}
    if (emit && hadState) this.emit("changed", this.snapshot());
    return this.snapshot();
  }

  parseTikfinityPacket(raw) {
    if (this.settings.enabledPlatforms.tikfinity === false) return null;
    let packet;
    try { packet = JSON.parse(String(raw)); } catch { return null; }
    if (!packet || typeof packet !== "object" || Array.isArray(packet)) return null;
    const event = safeText(packet.event || packet.type || "event", 80).toLowerCase();
    const data = packet.data && typeof packet.data === "object" && !Array.isArray(packet.data) ? packet.data : packet;
    const user = data.user && typeof data.user === "object" && !Array.isArray(data.user) ? data.user : {};
    const name = safeText(data.nickname || user.nickname || data.uniqueId || user.uniqueId || "TikTok", 120);
    const text = safeText(data.comment || data.text || data.message || data.giftName || data.gift?.name || "", 5000);
    const timestampSource = data.createTime || data.timestamp || packet.createTime || packet.timestamp;
    const timestamp = normalizedTimestamp(timestampSource);
    const explicitId = safeText(data.msgId || data.id || packet.id || "", 180);
    const fingerprint = shortHash(JSON.stringify([
      event, timestampSource || "", data.userId || user.userId || data.uniqueId || user.uniqueId || "",
      name, text, data.giftName || data.gift?.name || "", data.repeatCount || data.count || data.likeCount || 0
    ]));
    const dedupeKey = explicitId ? `id:${explicitId}` : `auto:${fingerprint}`;
    const seenAt = Date.now();
    const previous = this.seenTikfinityEvents.get(dedupeKey);
    if (previous && seenAt - previous < (explicitId ? 600000 : 5000)) return null;
    this.seenTikfinityEvents.set(dedupeKey, seenAt);
    for (const [key, recordedAt] of this.seenTikfinityEvents) {
      if (this.seenTikfinityEvents.size <= 2000 && seenAt - recordedAt <= 600000) break;
      this.seenTikfinityEvents.delete(key);
    }
    const rawBadges = Array.isArray(data.badges) ? data.badges : Array.isArray(user.badges) ? user.badges : [];
    const badges = rawBadges.map((badge) => safeText(typeof badge === "object" ? badge.name || badge.type || "" : badge, 100)).filter(Boolean);
    const isBroadcaster = Boolean(data.isBroadcaster || user.isBroadcaster);
    const isModerator = Boolean(data.isModerator || data.isMod || user.isModerator || user.isMod);
    const isSubscriber = Boolean(data.isSubscriber || data.isSub || user.isSubscriber || user.isSub);
    const role = isBroadcaster ? "broadcaster" : isModerator ? "moderator" : isSubscriber ? "subscriber" : "viewer";
    const common = {
      id: explicitId || `tikfinity-${fingerprint}`,
      platform: "tiktok",
      name,
      userId: safeText(data.userId || user.userId || user.uniqueId || data.uniqueId || "", 160),
      color: /^#[0-9a-f]{6}$/i.test(String(data.color || user.color || "")) ? String(data.color || user.color) : "#ffffff",
      role,
      badges,
      text,
      timestamp,
      raw: data
    };
    if (["chat", "comment", "message"].includes(event)) return this.ingest(common);
    const overlayEvent = this.overlayServer?.publishEvent({
      ...common,
      type: event,
      value: Number(data.repeatCount || data.count || data.likeCount || 0) || 0,
      data: { ...data, multiChatForwarded: true }
    });
    this.emit("platform-event", { event, data: common, overlayEvent });
    return overlayEvent;
  }

  enqueueTts(message) {
    const settings = this.settings.tts;
    if (this.platform !== "win32" || !settings.enabled || !settings.roles.includes(message.role)) return;
    let value = safeText(message.text, Math.max(20, Number(settings.maximumLength) || 240));
    value = value.replace(/https?:\/\/\S+/gi, "Link").replace(/:[a-z0-9_+-]+:/gi, "");
    if (!value.trim()) return;
    this.ttsQueue.push({
      text: settings.includeName === false ? value : `${message.name}: ${value}`,
      voice: safeText(settings.voice || "", 200),
      rate: Number(settings.rate) || 0,
      volume: Number.isFinite(Number(settings.volume)) ? Math.max(0, Math.min(100, Number(settings.volume))) : 100
    });
    if (this.ttsQueue.length > 40) this.ttsQueue.splice(0, this.ttsQueue.length - 40);
    this.pumpTts({ emit: false });
  }

  ensureTtsProcess() {
    if (this.ttsProcess || this.platform !== "win32") return this.ttsProcess;
    const script = [
      "$ErrorActionPreference='SilentlyContinue'",
      "Add-Type -AssemblyName System.Speech",
      "$s=New-Object System.Speech.Synthesis.SpeechSynthesizer",
      "while(($line=[Console]::In.ReadLine()) -ne $null){",
      "if($line -eq '__EXIT__'){break}",
      "try{$json=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($line));$item=$json|ConvertFrom-Json;",
      "$s.Rate=[Math]::Max(-10,[Math]::Min(10,[int]$item.rate));$s.Volume=[Math]::Max(0,[Math]::Min(100,[int]$item.volume));",
      "if($item.voice){try{$s.SelectVoice([string]$item.voice)}catch{}};$s.Speak([string]$item.text)}catch{};",
      "[Console]::Out.WriteLine('DONE');[Console]::Out.Flush()}",
      "$s.Dispose()"
    ].join(";");
    const worker = this.spawnImpl("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", powershellEncoded(script)], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "ignore"]
    });
    this.ttsProcess = worker;
    this.ttsBuffer = "";
    worker.stdout.on("data", (chunk) => {
      this.ttsBuffer += String(chunk);
      const lines = this.ttsBuffer.split(/\r?\n/);
      this.ttsBuffer = lines.pop() || "";
      if (this.ttsRunning && lines.some((line) => line.trim() === "DONE")) {
        this.ttsCurrent = null;
        this.ttsRunning = false;
        this.pumpTts({ emit: false });
        this.scheduleTtsIdleStop();
        this.emit("changed", this.snapshot());
      }
    });
    const stopped = () => {
      if (this.ttsProcess !== worker) return;
      clearTimeout(this.ttsIdleTimer);
      this.ttsIdleTimer = null;
      this.ttsProcess = null;
      this.ttsCurrent = null;
      this.ttsRunning = false;
      this.emit("changed", this.snapshot());
      if (this.ttsQueue.length) {
        clearTimeout(this.ttsRestartTimer);
        this.ttsRestartTimer = setTimeout(() => {
          this.ttsRestartTimer = null;
          this.pumpTts();
        }, 100);
        this.ttsRestartTimer.unref?.();
      }
    };
    worker.once("error", stopped);
    worker.once("exit", stopped);
    worker.stdin.on("error", stopped);
    return worker;
  }

  scheduleTtsIdleStop() {
    clearTimeout(this.ttsIdleTimer);
    this.ttsIdleTimer = null;
    const worker = this.ttsProcess;
    if (!worker || this.ttsRunning || this.ttsQueue.length) return;
    this.ttsIdleTimer = setTimeout(() => {
      this.ttsIdleTimer = null;
      if (this.ttsProcess !== worker || this.ttsRunning || this.ttsQueue.length) return;
      try {
        if (worker.stdin?.writable) worker.stdin.write("__EXIT__\n");
        else worker.kill();
      } catch { try { worker.kill(); } catch {} }
    }, this.ttsIdleMs);
    this.ttsIdleTimer.unref?.();
  }

  pumpTts({ emit = true } = {}) {
    if (this.ttsRunning || !this.ttsQueue.length || this.platform !== "win32") return;
    clearTimeout(this.ttsIdleTimer);
    this.ttsIdleTimer = null;
    const worker = this.ensureTtsProcess();
    if (!worker?.stdin?.writable) return;
    this.ttsCurrent = this.ttsQueue.shift();
    this.ttsRunning = true;
    try {
      worker.stdin.write(`${Buffer.from(JSON.stringify(this.ttsCurrent), "utf8").toString("base64")}\n`);
    } catch {
      this.ttsRunning = false;
      this.ttsQueue.unshift(this.ttsCurrent);
      this.ttsCurrent = null;
      try { worker.kill(); } catch {}
      return;
    }
    if (emit) this.emit("changed", this.snapshot());
  }

  async listVoices() {
    if (this.platform !== "win32") return [];
    const script = "Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; @($s.GetInstalledVoices()|ForEach-Object {$_.VoiceInfo}|Select-Object Name,Culture,Gender,Age)|ConvertTo-Json -Compress; $s.Dispose()";
    return new Promise((resolve) => {
      const child = this.spawnImpl("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", powershellEncoded(script)], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
      let output = "";
      let settled = false;
      const finish = (voices = []) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(voices);
      };
      const timer = setTimeout(() => { try { child.kill(); } catch {}; finish([]); }, 8000);
      timer.unref?.();
      child.stdout.on("data", (data) => { if (output.length < 500000) output += String(data); });
      child.once("error", () => finish([]));
      child.once("exit", () => {
        try {
          const value = JSON.parse(output.trim() || "[]");
          finish((Array.isArray(value) ? value : [value]).map((voice) => ({
            name: safeText(voice.Name, 200),
            culture: safeText(voice.Culture, 80),
            gender: safeText(voice.Gender, 40),
            age: safeText(voice.Age, 40)
          })).filter((voice) => voice.name));
        } catch { finish([]); }
      });
    });
  }

  skipTts() {
    clearTimeout(this.ttsIdleTimer);
    this.ttsIdleTimer = null;
    if (this.ttsCurrent) {
      const worker = this.ttsProcess;
      this.ttsProcess = null;
      this.ttsCurrent = null;
      this.ttsRunning = false;
      try { worker?.kill(); } catch {}
      this.pumpTts();
    } else this.ttsQueue.shift();
    return { remaining: this.ttsQueue.length + (this.ttsCurrent ? 1 : 0) };
  }

  clearTts() {
    this.ttsQueue = [];
    clearTimeout(this.ttsIdleTimer);
    clearTimeout(this.ttsRestartTimer);
    this.ttsIdleTimer = null;
    this.ttsRestartTimer = null;
    const worker = this.ttsProcess;
    this.ttsProcess = null;
    this.ttsCurrent = null;
    this.ttsRunning = false;
    try { worker?.kill(); } catch {}
    return { remaining: 0 };
  }

  stop() {
    this.disconnectTwitch({ emit: false });
    this.disconnectYouTube({ emit: false });
    this.disconnectTikfinity({ emit: false });
    this.clearTts();
  }
}

module.exports = { MultiChat, defaultSettings, normalizeSettings, normalizedTimestamp, parseIrcTags, roleFromTwitchTags };
