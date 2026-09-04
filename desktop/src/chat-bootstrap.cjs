"use strict";

const mainRuntime = require("./main.cjs");
const path = require("node:path");
const fs = require("node:fs/promises");
const { app, BrowserWindow, clipboard, globalShortcut, ipcMain, safeStorage, shell } = require("electron");
const { ChatCore } = require("./services/chat-core.cjs");
const { ChatBotService } = require("./services/chat-bot.cjs");
const { ChatFilterService } = require("./services/chat-filter.cjs");
const { ChatWindowManager } = require("./services/chat-window-manager.cjs");
const { ensureModerationStore } = require("./services/moderation-bootstrap.cjs");
const { ensureV4Stores } = require("./services/v4-bootstrap.cjs");
const { TwitchAdapter } = require("./services/platforms/twitch-adapter.cjs");
const { CngUnifiedAdapter } = require("./services/platforms/cng-adapter.cjs");
const { TikTokAdapter } = require("./services/platforms/tiktok-adapter.cjs");
const { YouTubeAdapter } = require("./services/platforms/youtube-adapter.cjs");
const { normalizeCngConfig } = require("./services/cng-config.cjs");
const { normalizeTtsConfig } = require("./services/tts-config.cjs");
const { SecretStore } = require("./services/secret-store.cjs");
const { ensureObsChatOverlay, removeObsChatOverlay, toOverlayChatEvent } = require("./services/obs-chat-overlay.cjs");

let core = null;
let chatBot = null;
let chatFilter = null;
let windows = null;
let cngConfig = {};
let ttsConfig = normalizeTtsConfig();
let cngSecretStore = null;
let mainWindowPoll = null;
let overlaySettings = { sourceName: "Batto Multi-Chat", sceneName: "", width: 1920, height: 1080, autoInstall: false };

const cngConfigFile = () => path.join(app.getPath("userData"), "cng-personal-chat.json");
const ttsConfigFile = () => path.join(app.getPath("userData"), "tts-config.json");
const overlaySettingsFile = () => path.join(app.getPath("userData"), "chat-overlay.json");
const chatBotConfigFile = () => path.join(app.getPath("userData"), "chat-bot.json");
const chatBotMediaRoot = () => path.join(app.getPath("userData"), "chat-bot-media");

async function readJson(filename, fallback) { try { return JSON.parse(await fs.readFile(filename, "utf8")); } catch { return fallback; } }
async function writeJson(filename, value) { await fs.mkdir(path.dirname(filename), { recursive: true }); await fs.writeFile(filename, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 }); }
async function loadCngConfig() {
  const stored = await readJson(cngConfigFile(), {});
  const token = await cngSecretStore?.get("cng-obs-chat-token");
  if (stored.chat?.url && token) stored.chat.url = `${stored.chat.url}${stored.chat.url.includes("?") ? "&" : "?"}obsChatToken=${encodeURIComponent(token)}`;
  cngConfig = stored;
  return cngConfig;
}
function broadcast(channel, payload) { for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send(channel, payload); }
function overlayServer() { return mainRuntime.getStreamOverlayServer?.() || null; }
function obsClient() { return mainRuntime.getObsClient?.() || null; }
function overlayStatus() {
  const server = overlayServer();
  const serverStatus = server?.status?.() || {};
  return { ...overlaySettings, active: Boolean(serverStatus.active), url: serverStatus.chatOverlayUrl || "", obs: obsClient()?.status?.() || { connected: false } };
}
async function streamIsLive() {
  const client = obsClient();
  if (!client) return false;
  try {
    const snapshot = await client.snapshot?.();
    return Boolean(snapshot?.stream?.active || snapshot?.streaming || snapshot?.output?.streaming || snapshot?.stats?.outputActive);
  } catch {
    return Boolean(client.status?.().streaming);
  }
}
function attachEmbeddedChat(main) {
  if (!main || main.isDestroyed()) return;
  const scriptPath = path.join(__dirname, "renderer", "multi-chat.js").replaceAll("\\", "/");
  const controlsPath = path.join(__dirname, "renderer", "chat-overlay-controls.js").replaceAll("\\", "/");
  const cssPath = path.join(__dirname, "renderer", "multi-chat.css").replaceAll("\\", "/");
  const code = `(function(){if(document.getElementById('multi-chat-root')||document.getElementById('batto-multi-chat-dock'))return;const css=document.createElement('link');css.rel='stylesheet';css.href='file://${cssPath}';document.head.appendChild(css);const host=document.createElement('div');host.id='batto-multi-chat-dock';host.style='position:fixed;right:18px;bottom:18px;width:460px;height:700px;z-index:2147483000;box-shadow:0 22px 70px rgba(0,0,0,.55);border:1px solid #223044;border-radius:10px;overflow:hidden;background:#090d14;';const root=document.createElement('div');root.id='multi-chat-root';root.style='height:100%';host.appendChild(root);document.body.appendChild(host);const s=document.createElement('script');s.src='file://${scriptPath}';s.onload=function(){const controls=document.createElement('script');controls.src='file://${controlsPath}';document.body.appendChild(controls);};document.body.appendChild(s);window.batto.onChatWindow(function(state){host.hidden=!!state.undocked});})();`;
  main.webContents.executeJavaScript(code).catch((error) => console.error("Multi-Chat-Einbettung fehlgeschlagen:", error));
}

function registerChatIpc() {
  ipcMain.handle("chat:history", async (_event, options) => {
    const history = core.history(options);
    if (!chatFilter) return history;
    return (await chatFilter.filterBatch(history, { apply: false })).visible;
  });
  ipcMain.handle("chat:statuses", () => core.statuses());
  ipcMain.handle("chat:connect", (_event, platform, config) => core.connect(platform, config));
  ipcMain.handle("chat:disconnect", (_event, platform) => core.disconnect(platform));
  ipcMain.handle("chat:send", (_event, platform, message) => core.send(platform, message));
  ipcMain.handle("chat:unified-clear", (_event, platform) => { core.clear(platform); return true; });
  ipcMain.handle("chat:toggle-window", () => windows.toggle());
  ipcMain.handle("chat:window-status", () => windows.status());
  ipcMain.handle("chat:window-always-on-top", (_event, value) => windows.setAlwaysOnTop(value));
  ipcMain.handle("chat-filter:test", async (_event, input = {}) => {
    if (!chatFilter) throw new Error("Chat-Filter ist noch nicht gestartet.");
    return chatFilter.evaluate({ platform: input.platform || "twitch", username: input.username || "TestUser", message: input.message || "" }, { apply: false });
  });
  ipcMain.handle("chat:overlay-status", () => overlayStatus());
  ipcMain.handle("chat:overlay-copy-url", () => { const url = overlayStatus().url; if (!url) throw new Error("Das lokale Chat-Overlay ist noch nicht gestartet."); clipboard.writeText(url); return url; });
  ipcMain.handle("chat:overlay-open", async () => { const url = overlayStatus().url; if (!url) throw new Error("Das lokale Chat-Overlay ist noch nicht gestartet."); await shell.openExternal(url); return url; });
  ipcMain.handle("chat:overlay-install", async (_event, input = {}) => {
    const status = overlayStatus();
    if (!status.url) throw new Error("Das lokale Chat-Overlay ist noch nicht gestartet.");
    overlaySettings = { ...overlaySettings, ...input, autoInstall: input.autoInstall === true };
    await writeJson(overlaySettingsFile(), overlaySettings);
    return ensureObsChatOverlay(obsClient(), { ...overlaySettings, url: status.url });
  });
  ipcMain.handle("chat:overlay-remove", async () => removeObsChatOverlay(obsClient(), overlaySettings.sourceName));

  ipcMain.handle("chatbot:get-state", () => chatBot.snapshot());
  ipcMain.handle("chatbot:save-config", async (_event, value = {}) => {
    const result = await chatBot.update(value);
    broadcast("chatbot:state", result);
    return result;
  });
  ipcMain.handle("chatbot:test-command", async (_event, commandId, platform = "twitch") => {
    const command = chatBot.config.commands.find((item) => item.id === commandId);
    if (!command) throw new Error("Command wurde nicht gefunden.");
    await chatBot.runActions(command.actions, chatBot.context({ username: "TestUser", user: "TestUser", platform, streamer: "Crazy_Batto", title: "Test-Stream", game: "Test" }));
    return { ok: true };
  });
  ipcMain.handle("chatbot:test-actions", async (_event, actions = [], context = {}) => {
    await chatBot.runActions(actions, chatBot.context({ username: "TestUser", user: "TestUser", platform: "twitch", streamer: "Crazy_Batto", ...context }));
    return { ok: true };
  });
  ipcMain.handle("chatbot:trigger-event", (_event, trigger, payload = {}) => chatBot.triggerEvent(trigger, payload));
  ipcMain.handle("chatbot:open-media-folder", async () => { await fs.mkdir(chatBot.mediaRoot, { recursive: true }); const error = await shell.openPath(chatBot.mediaRoot); if (error) throw new Error(error); return chatBot.mediaRoot; });
  ipcMain.handle("chatbot:copy-overlay-url", (_event, channel = "all") => { const url = chatBot.overlayUrls()[channel] || chatBot.overlayUrls().all; clipboard.writeText(url); return url; });
  ipcMain.handle("chatbot:open-overlay", async (_event, channel = "all") => { const url = chatBot.overlayUrls()[channel] || chatBot.overlayUrls().all; await shell.openExternal(url); return url; });

  ipcMain.handle("cng:save-config", async (_event, input = {}) => {
    const normalized = normalizeCngConfig(input);
    if (normalized.chat?.obsChatToken) await cngSecretStore.set("cng-obs-chat-token", normalized.chat.obsChatToken);
    const safe = JSON.parse(JSON.stringify(normalized));
    if (safe.chat) {
      safe.chat.obsChatToken = "";
      if (safe.chat.url) { const url = new URL(safe.chat.url); url.searchParams.delete("obsChatToken"); safe.chat.url = url.toString(); }
    }
    await writeJson(cngConfigFile(), safe); cngConfig = normalized;
    return { ...normalized, chat: { ...normalized.chat, obsChatToken: "" } };
  });
  ipcMain.handle("cng:get-config", async () => loadCngConfig());
  ipcMain.handle("tts:get-config", () => ttsConfig);
  ipcMain.handle("tts:save-config", async (_event, input) => { ttsConfig = normalizeTtsConfig(input); await writeJson(ttsConfigFile(), ttsConfig); return ttsConfig; });
}

app.whenReady().then(async () => {
  cngSecretStore = new SecretStore(path.join(app.getPath("userData"), "cng-secrets.json"), safeStorage);
  cngConfig = await loadCngConfig();
  ttsConfig = normalizeTtsConfig(await readJson(ttsConfigFile(), {}));

  const { configStore, logStore } = await ensureV4Stores();
  const moderationStore = await ensureModerationStore();
  chatFilter = new ChatFilterService({ getConfig: (id) => configStore.get(id), moderationStore, logStore });

  core = new ChatCore({ maxMessages: 500, flushMs: 60 });
  core.registerAdapter(new TwitchAdapter());
  core.registerAdapter(new CngUnifiedAdapter());
  core.registerAdapter(new TikTokAdapter());
  core.registerAdapter(new YouTubeAdapter());

  chatBot = new ChatBotService({
    configFile: chatBotConfigFile(),
    mediaRoot: chatBotMediaRoot(),
    sendChat: (platform, message) => core.send(platform, message),
    obs: obsClient(),
    isLive: () => streamIsLive()
  });
  await chatBot.start();
  chatBot.on("log", (entry) => broadcast("chatbot:log", entry));
  chatBot.on("overlay", (entry) => broadcast("chatbot:overlay", entry));

  core.on("messages", (batch) => {
    void (async () => {
      const filtered = chatFilter ? await chatFilter.filterBatch(batch, { apply: true }) : { visible: batch };
      const server = overlayServer();
      for (const message of filtered.visible) {
        server?.publishEvent(toOverlayChatEvent(message));
        await chatBot.ingestChat(message).catch((error) => chatBot.log("error", `Command-Fehler: ${error.message}`));
      }
      if (filtered.visible.length) broadcast("chat:messages", filtered.visible);
    })().catch((error) => console.error("Chat-Filter-Verarbeitung fehlgeschlagen:", error));
  });
  core.on("status", (status) => broadcast("chat:status", status));
  core.on("cleared", (platform) => { overlayServer()?.clearChat(platform); broadcast("chat:cleared", platform); });

  const main = BrowserWindow.getAllWindows().find((win) => win.getTitle() === "Batto OBS Tool") || BrowserWindow.getAllWindows()[0] || null;
  overlaySettings = { ...overlaySettings, ...(await readJson(overlaySettingsFile(), {})) };
  windows = new ChatWindowManager({ mainWindow: main, userDataFile: path.join(app.getPath("userData"), "multi-chat-window.json"), broadcast: (state) => broadcast("chat:window", state) });
  await windows.loadSettings();
  registerChatIpc();
  globalShortcut.register("CommandOrControl+Shift+C", () => windows.toggle());

  obsClient()?.on?.("connected", () => {
    if (overlaySettings.autoInstall) void ensureObsChatOverlay(obsClient(), { ...overlaySettings, url: overlayStatus().url }).catch((error) => console.error("OBS-Chatquelle konnte nicht automatisch aktualisiert werden:", error));
  });

  const wireMain = () => {
    const found = BrowserWindow.getAllWindows().find((win) => win.getTitle() === "Batto OBS Tool");
    if (!found) return false;
    windows.mainWindow = found;
    if (!found.isDestroyed()) {
      found.webContents.once("did-finish-load", () => attachEmbeddedChat(found));
      if (!found.webContents.isLoading()) attachEmbeddedChat(found);
    }
    return true;
  };
  if (!wireMain()) {
    mainWindowPoll = setInterval(() => { if (wireMain()) { clearInterval(mainWindowPoll); mainWindowPoll = null; } }, 250);
    mainWindowPoll.unref?.();
  }
  if (windows.settings.undocked) setTimeout(() => windows.create(), 1200).unref?.();
}).catch((error) => console.error("Multi-Chat/Chat-Bot-Bootstrap konnte nicht starten:", error));

app.on("before-quit", () => {
  if (mainWindowPoll) clearInterval(mainWindowPoll);
  globalShortcut.unregister("CommandOrControl+Shift+C");
  void chatBot?.stop();
  void core?.stop();
});
