"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const MODULES = [
  ["general", "Allgemein"], ["appearance", "Darstellung"], ["multichat", "Multi-Chat"],
  ["moderation", "Moderation"], ["chatFilter", "Chat-Filter"], ["chatDesign", "Chat-Design"],
  ["cohost", "Co-Host"], ["liveTools", "LIVE Tools"], ["platforms", "Plattformen"],
  ["chatbot", "Chat-Bot"], ["autoBroadcast", "Auto-Broadcast"], ["commands", "Commands"],
  ["hotkeys", "Hotkeys & Multi-Action"], ["events", "Events"], ["media", "Medien"],
  ["mediaPools", "Medien-Pools"], ["tts", "TTS"], ["obsHttp", "OBS / HTTP"],
  ["overlays", "Overlays"], ["discord", "Discord"], ["statusbar", "Statusleiste"],
  ["logs", "Logs"], ["backup", "Backup"], ["advanced", "Erweitert"]
];

const IMPLEMENTED = new Set(["general", "appearance", "multichat", "moderation", "platforms", "chatbot", "autoBroadcast", "commands", "hotkeys", "events", "tts", "obsHttp", "overlays", "discord", "logs"]);

function defaults() {
  const modules = {};
  for (const [id, title] of MODULES) modules[id] = {
    id,
    title,
    enabled: id === "general" || id === "appearance" ? true : IMPLEMENTED.has(id),
    status: IMPLEMENTED.has(id) || id === "general" || id === "appearance" ? "bereit" : "nicht-verfuegbar",
    lastError: "",
    lastActivity: "",
    config: {}
  };
  modules.appearance.config = { backgroundEnabled: true, backgroundFile: "HIntergund.png", preserveAspect: true, scaleToWindow: true, tiles: false, mode: "cover", brightness: 70, panelOpacity: 75, uiScale: 100 };
  modules.multichat.config = { platforms: ["twitch", "tiktok", "cng", "youtube"], defaultTab: "all", timestamps: true, platformIcon: true, platformName: true, badges: true, autoScroll: true, username: true, keepLastMessage: true, undock: true, rememberPosition: true, rememberSize: true, restoreWindowState: true, alwaysOnTop: false };
  modules.moderation.config = { contextMenu: true, askMuteReason: true, keepLastMessage: true, defaultMuteMinutes: 10, askBlockReason: true, confirmBlock: true, logActions: true, retention: "unlimited" };
  modules.chatFilter.config = { scope: "all", ignoreCase: true, wholeWords: true, partialWords: true, similarSpellings: false, specialCharEvasion: false, defaultAction: "hide", logMatches: true, blockedWords: [], allowedWords: [], allowedUsers: [] };
  modules.chatDesign.config = { overlayEnabled: true, fontFamily: "Segoe UI", fallbackFont: "Arial", customFonts: true, animation: "fade", maxDisplaySeconds: 12, transparentObsBackground: true, livePreview: true };
  modules.cohost.config = { enabled: false, defaultFormat: "tiktok", slots: 4, layout: "2x2", gap: 10, border: 6, radius: 15, hideEmpty: true, followGuestChanges: true, rearrange: true, sourceStrategy: "manual-auto", rememberCrop: true };
  modules.liveTools.config = { enabled: false, unavailableMode: "disabled", detectTikTokLiveStudio: true };
  modules.platforms.config = { reconnect: true, reconnectDelaySeconds: 5, showSecrets: false };
  modules.chatbot.config = { enabled: true, name: "Batto Bot", platforms: ["twitch", "tiktok", "cng", "youtube"], globalCooldownSeconds: 2, maxParallelActions: 5, queue: true, liveOnly: false, errorMode: "skip", logErrors: true };
  modules.autoBroadcast.config = { enabled: false, intervalMinutes: 15, randomInterval: false, minMinutes: 10, maxMinutes: 20, liveOnly: true, requireChatActivity: false, activityWindowMinutes: 5, globalMinimumSeconds: 60, offlineMode: "skip" };
  modules.commands.config = { enabled: true, prefix: "!", ignoreCase: true, maxLength: 50, defaultPermission: "all", cooldownSeconds: 30, userCooldownSeconds: 60, liveOnly: false, logCommands: true, unknownMode: "ignore" };
  modules.hotkeys.config = { enabled: true, safetyMode: true, defaultTarget: "process", missingTarget: "abort", neverDesktop: true, noParallelSameAction: true, preventInfiniteLoops: true, maxActions: 50, maxRuntimeSeconds: 60 };
  modules.events.config = { enabled: true, queue: true, maxQueue: 100, queueOverflow: "drop-oldest", mergeSameWithinSeconds: 2 };
  modules.media.config = { enabled: false, importMode: "copy", duplicateMode: "ask", defaultVolume: 80, formats: ["mp3","wav","ogg","mp4","webm","png","jpg","webp","gif"] };
  modules.mediaPools.config = { enabled: false, defaultMode: "random", preventImmediateRepeat: true, rememberLast: 2, missingFileMode: "next" };
  modules.tts.config = { enabled: false, platforms: ["twitch","tiktok","cng","youtube"], rate: 1, pitch: 0.95, volume: 0.8, maxChars: 250, readLinks: false, readEmotes: false };
  modules.obsHttp.config = { enabled: true, host: "127.0.0.1", port: 8787, autoStart: true, portConflict: "next", websocket: true, heartbeatSeconds: 15, reconnect: true };
  modules.overlays.config = { width: 1920, height: 1080, durationSeconds: 8, fadeInMs: 300, fadeOutMs: 500, queue: true, maxQueue: 50, priority: true, newAlertMode: "queue", completeVideo: true };
  modules.discord.config = { enabled: false, mode: "embed", startDelaySeconds: 10, oncePerStream: true, offlineMessage: false };
  modules.statusbar.config = { enabled: false, metrics: ["cpu","memory","upload","framedrops","bitrate","fps"], refreshSeconds: 1, position: "bottom", fpsWarningBelow: 50, frameDropWarningAbove: 10, bitrateWarningBelow: 3000 };
  modules.logs.config = { retentionDays: 30, maxFileMb: 25, categories: ["chat","moderation","chat-filter","commands","events","media","obs","cohost","error"] };
  modules.backup.config = { enabled: false, automatic: true, keepVersions: 10 };
  return { version: 4, updatedAt: new Date().toISOString(), modules };
}

class V4ConfigStore {
  constructor(filename) { this.filename = filename; this.state = defaults(); }
  async load() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.filename, "utf8"));
      const base = defaults();
      for (const [id, module] of Object.entries(parsed.modules || {})) {
        if (!base.modules[id]) continue;
        base.modules[id] = { ...base.modules[id], ...module, config: { ...base.modules[id].config, ...(module.config || {}) } };
      }
      this.state = { ...base, ...parsed, modules: base.modules };
    } catch { this.state = defaults(); }
    return this.snapshot();
  }
  snapshot() { return JSON.parse(JSON.stringify(this.state)); }
  get(id) { const module = this.state.modules[id]; if (!module) throw new Error(`Unbekanntes V4-Modul: ${id}`); return JSON.parse(JSON.stringify(module)); }
  async save(id, patch = {}) {
    const current = this.get(id);
    this.state.modules[id] = { ...current, ...patch, config: { ...current.config, ...(patch.config || {}) }, lastActivity: new Date().toISOString() };
    this.state.updatedAt = new Date().toISOString();
    await this.persist();
    return this.get(id);
  }
  async reset(id) {
    const base = defaults().modules[id];
    if (!base) throw new Error(`Unbekanntes V4-Modul: ${id}`);
    this.state.modules[id] = { ...base, lastActivity: new Date().toISOString() };
    this.state.updatedAt = new Date().toISOString();
    await this.persist();
    return this.get(id);
  }
  async persist() {
    await fs.mkdir(path.dirname(this.filename), { recursive: true });
    const temp = `${this.filename}.tmp`;
    await fs.writeFile(temp, JSON.stringify(this.state, null, 2), { encoding: "utf8", mode: 0o600 });
    await fs.rename(temp, this.filename);
  }
}

module.exports = { V4ConfigStore, V4_MODULES: MODULES, v4Defaults: defaults };
