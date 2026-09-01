"use strict";

require("./main.cjs");
const path = require("node:path");
const fs = require("node:fs/promises");
const { app, BrowserWindow, globalShortcut, ipcMain, safeStorage } = require("electron");
const { ChatCore } = require("./services/chat-core.cjs");
const { ChatWindowManager } = require("./services/chat-window-manager.cjs");
const { TwitchAdapter } = require("./services/platforms/twitch-adapter.cjs");
const { CngUnifiedAdapter } = require("./services/platforms/cng-adapter.cjs");
const { TikTokAdapter } = require("./services/platforms/tiktok-adapter.cjs");
const { YouTubeAdapter } = require("./services/platforms/youtube-adapter.cjs");
const { normalizeCngConfig, withoutCngSecrets } = require("./services/cng-config.cjs");
const { normalizeTtsConfig } = require("./services/tts-config.cjs");
const { SecretStore } = require("./services/secret-store.cjs");

let core = null;
let windows = null;
let cngConfig = {};
let ttsConfig = normalizeTtsConfig();
let cngSecretStore = null;
let mainWindowPoll = null;
const cngConfigFile = () => path.join(app.getPath("userData"), "cng-personal-chat.json");
const ttsConfigFile = () => path.join(app.getPath("userData"), "tts-config.json");
async function readJson(filename, fallback) { try { return JSON.parse(await fs.readFile(filename, "utf8")); } catch { return fallback; } }
async function writeJson(filename, value) { await fs.mkdir(path.dirname(filename), { recursive: true }); await fs.writeFile(filename, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 }); }
async function loadCngConfig() {
  const stored = normalizeCngConfig(await readJson(cngConfigFile(), {}));
  const token = await cngSecretStore?.get("cng-obs-chat-token") || "";
  cngConfig = { ...stored, chat: { ...stored.chat, obsChatToken: token } };
  return cngConfig;
}
function broadcast(channel, payload) { for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send(channel, payload); }
function attachEmbeddedChat(main) { if (!main || main.isDestroyed()) return; const scriptPath = path.join(__dirname, "renderer", "multi-chat.js").replaceAll("\\", "/"); const cssPath = path.join(__dirname, "renderer", "multi-chat.css").replaceAll("\\", "/"); const code = `(function(){if(document.getElementById('batto-multi-chat-dock'))return;const css=document.createElement('link');css.rel='stylesheet';css.href='file://${cssPath}';document.head.appendChild(css);const host=document.createElement('div');host.id='batto-multi-chat-dock';host.style='position:fixed;right:18px;bottom:18px;width:460px;height:700px;z-index:2147483000;box-shadow:0 22px 70px rgba(0,0,0,.55);border:1px solid #223044;border-radius:10px;overflow:hidden;background:#090d14;';const root=document.createElement('div');root.id='multi-chat-root';root.style='height:100%';host.appendChild(root);document.body.appendChild(host);const s=document.createElement('script');s.src='file://${scriptPath}';document.body.appendChild(s);window.batto.onChatWindow(function(state){host.hidden=!!state.undocked});})();`; main.webContents.executeJavaScript(code).catch((error) => console.error("Multi-Chat-Einbettung fehlgeschlagen:", error)); }
function registerChatIpc() {
  ipcMain.handle("chat:history", (_event, options) => core.history(options));
  ipcMain.handle("chat:statuses", () => core.statuses());
  ipcMain.handle("chat:connect", (_event, platform, config) => core.connect(platform, platform === "cng" ? cngConfig : config));
  ipcMain.handle("chat:disconnect", (_event, platform) => core.disconnect(platform));
  ipcMain.handle("unified-chat:clear", (_event, platform) => { core.clear(platform); return true; });
  ipcMain.handle("chat:toggle-window", () => windows.toggle());
  ipcMain.handle("chat:window-status", () => windows.status());
  ipcMain.handle("chat:window-always-on-top", (_event, value) => windows.setAlwaysOnTop(value));
  ipcMain.handle("cng:save-config", async (_event, input = {}) => {
    const normalized = normalizeCngConfig(input);
    const previousCreatorId = cngConfig.creatorId;
    const suppliedToken = normalized.chat?.obsChatToken || "";
    let token = suppliedToken;
    if (suppliedToken) await cngSecretStore.set("cng-obs-chat-token", suppliedToken);
    else if (normalized.chat?.url && normalized.creatorId === previousCreatorId) token = await cngSecretStore.get("cng-obs-chat-token") || "";
    else await cngSecretStore.delete("cng-obs-chat-token");
    cngConfig = { ...normalized, chat: { ...normalized.chat, obsChatToken: token } };
    const safe = withoutCngSecrets(cngConfig);
    await writeJson(cngConfigFile(), safe);
    return safe;
  });
  ipcMain.handle("cng:get-config", async () => withoutCngSecrets(await loadCngConfig()));
  ipcMain.handle("tts:get-config", () => ttsConfig);
  ipcMain.handle("tts:save-config", async (_event, input) => { ttsConfig = normalizeTtsConfig(input); await writeJson(ttsConfigFile(), ttsConfig); return ttsConfig; });
}
app.whenReady().then(async () => {
  cngSecretStore = new SecretStore(path.join(app.getPath("userData"), "cng-secrets.json"), safeStorage); cngConfig = await loadCngConfig(); ttsConfig = normalizeTtsConfig(await readJson(ttsConfigFile(), {}));
  core = new ChatCore({ maxMessages: 500, flushMs: 60 }); core.registerAdapter(new TwitchAdapter()); core.registerAdapter(new CngUnifiedAdapter()); core.registerAdapter(new TikTokAdapter()); core.registerAdapter(new YouTubeAdapter());
  core.on("messages", (batch) => broadcast("chat:messages", batch)); core.on("status", (status) => broadcast("chat:status", status)); core.on("cleared", (platform) => broadcast("chat:cleared", platform));
  const main = BrowserWindow.getAllWindows().find((win) => win.getTitle() === "Batto OBS Tool") || BrowserWindow.getAllWindows()[0] || null;
  windows = new ChatWindowManager({ mainWindow: main, userDataFile: path.join(app.getPath("userData"), "multi-chat-window.json"), broadcast: (state) => broadcast("chat:window", state) }); await windows.loadSettings(); registerChatIpc(); globalShortcut.register("CommandOrControl+Shift+C", () => windows.toggle());
  const wireMain = () => { const found = BrowserWindow.getAllWindows().find((win) => win.getTitle() === "Batto OBS Tool"); if (!found) return false; windows.mainWindow = found; if (!found.isDestroyed()) { found.webContents.once("did-finish-load", () => attachEmbeddedChat(found)); if (!found.webContents.isLoading()) attachEmbeddedChat(found); } return true; };
  if (!wireMain()) { mainWindowPoll = setInterval(() => { if (wireMain()) { clearInterval(mainWindowPoll); mainWindowPoll = null; } }, 250); mainWindowPoll.unref?.(); }
  if (windows.settings.undocked) setTimeout(() => windows.create(), 1200).unref?.();
}).catch((error) => console.error("Multi-Chat-Bootstrap konnte nicht starten:", error));
app.on("before-quit", () => { if (mainWindowPoll) clearInterval(mainWindowPoll); globalShortcut.unregister("CommandOrControl+Shift+C"); void windows?.prepareToQuit(); void core?.stop(); });
