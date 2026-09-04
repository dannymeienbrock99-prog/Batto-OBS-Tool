"use strict";

const path = require("node:path");
const { app, BrowserWindow, clipboard, dialog, ipcMain, safeStorage, shell } = require("electron");
require("./services/moderation-bootstrap.cjs");
require("./services/v4-bootstrap.cjs");
const { SettingsStore } = require("./services/store.cjs");
const { SecretStore } = require("./services/secret-store.cjs");
const { runInternetTest } = require("./services/internet-test.cjs");
const { ObsWebSocketClient, normalizeLocalObsHost } = require("./services/obs-websocket.cjs");
const { StreamStatusSampler } = require("./services/stream-status.cjs");
const { TwitchHoloServer } = require("./services/twitch-holo-server.cjs");

app.setName("Batto OBS Tool");
const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) app.exit(0);

let mainWindow = null;
let settingsStore = null;
let secretStore = null;
let holoServer = null;
let internetResult = null;
let moduleErrors = {};
const obs = new ObsWebSocketClient();
const streamStatusSampler = new StreamStatusSampler(obs);

function userDataFile(name) { return path.join(app.getPath("userData"), name); }
function errorPayload(error) { return { message: String(error?.message || error || "Unbekannter Fehler"), name: error?.name || "Error", code: error?.code || "" }; }
async function safeObsSnapshot() { try { return await obs.snapshot(); } catch (error) { return { ...obs.status(), available: false, error: errorPayload(error) }; } }

app.on("second-instance", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

async function startLocalModules() {
  moduleErrors = {};
  try {
    holoServer = new TwitchHoloServer({ preferredPort: 17823, webRoot: path.join(__dirname, "..", "modules", "twitch-holo-chat", "web") });
    await holoServer.start();
  } catch (error) {
    moduleErrors.twitchHolo = errorPayload(error);
    holoServer = null;
    console.error("Twitch-Hologramm konnte nicht starten:", error);
  }
}

async function stateSnapshot() {
  const state = await settingsStore.get();
  return {
    product: { name: "Batto OBS Tool", version: app.getVersion(), author: "Crazy_Batto / Team Alpha", packaged: app.isPackaged },
    settings: { ...state, obs: { host: state.obs.host, port: state.obs.port, passwordConfigured: await secretStore.has("obs-websocket-password") } },
    internetResult,
    obs: await safeObsSnapshot(),
    twitchHolo: holoServer?.status() || { running: false },
    moduleErrors: { ...moduleErrors }
  };
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    title: "Batto OBS Tool",
    width: 1500,
    height: 940,
    minWidth: 1040,
    minHeight: 700,
    backgroundColor: "#e9f7ff",
    autoHideMenuBar: true,
    show: false,
    icon: path.join(__dirname, "..", "resources", "desktop-icon.jpg"),
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: false, webSecurity: true }
  });
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => { mainWindow = null; });
}

function registerIpc() {
  ipcMain.handle("app:get-state", () => stateSnapshot());
  ipcMain.handle("settings:save", async (_event, value) => {
    const current = await settingsStore.get();
    const payload = value && typeof value === "object" ? value : {};
    return settingsStore.set({ ...current, ...payload, obs: { ...current.obs, ...(payload.obs || {}), password: "" }, preferences: { ...current.preferences, ...(payload.preferences || {}) } });
  });
  ipcMain.handle("internet:test", async () => { internetResult = await runInternetTest(); return internetResult; });
  ipcMain.handle("stream-status:get", () => streamStatusSampler.snapshot());
  ipcMain.handle("obs:connect", async (_event, input = {}) => {
    const current = await settingsStore.get();
    const host = normalizeLocalObsHost(input.host || current.obs.host || "127.0.0.1");
    const port = Number(input.port || current.obs.port || 4455);
    let password = String(input.password || "");
    if (!password) password = await secretStore.get("obs-websocket-password");
    const result = await obs.connect({ host, port, password });
    await settingsStore.patch({ obs: { host, port, password: "" } });
    if (input.rememberPassword && password) await secretStore.set("obs-websocket-password", password);
    else if (input.clearStoredPassword) await secretStore.delete("obs-websocket-password");
    return result;
  });
  ipcMain.handle("obs:disconnect", async () => { await obs.disconnect(); return obs.status(); });
  ipcMain.handle("obs:forget-password", async () => { await secretStore.delete("obs-websocket-password"); return { configured: false }; });
  ipcMain.handle("obs:snapshot", () => safeObsSnapshot());
  ipcMain.handle("obs:execute", (_event, action, payload) => obs.execute(action, payload));
  ipcMain.handle("holo:status", () => holoServer?.status() || { running: false });
  ipcMain.handle("holo:open-editor", async () => { const status = holoServer?.status(); if (!status?.editorUrl) throw new Error("Hologramm-Editor ist nicht gestartet."); await shell.openExternal(status.editorUrl); return status; });
  ipcMain.handle("holo:copy-url", () => { const status = holoServer?.status(); if (!status?.overlayUrl) throw new Error("Hologramm-Overlay ist nicht gestartet."); clipboard.writeText(status.overlayUrl); return status.overlayUrl; });
}

async function runSelfTest() {
  const result = { product: "Batto OBS Tool", version: app.getVersion(), platform: process.platform, modules: {} };
  const testHolo = new TwitchHoloServer({ preferredPort: 18923, webRoot: path.join(__dirname, "..", "modules", "twitch-holo-chat", "web") });
  await testHolo.start();
  result.modules.twitchHolo = testHolo.status().running;
  await testHolo.stop();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

app.whenReady().then(async () => {
  settingsStore = new SettingsStore(userDataFile("settings.json"));
  secretStore = new SecretStore(userDataFile("secrets.json"), safeStorage);
  await settingsStore.load();
  if (process.argv.includes("--self-test")) { try { await runSelfTest(); app.exit(0); } catch (error) { process.stderr.write(`${String(error?.stack || error)}\n`); app.exit(1); } return; }
  registerIpc();
  await startLocalModules();
  createMainWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); });
}).catch((error) => { dialog.showErrorBox("Batto OBS Tool konnte nicht starten", String(error?.stack || error)); app.exit(1); });

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => { void obs.disconnect(); void holoServer?.stop(); });

module.exports = {
  getObsClient: () => obs,
  getMainWindow: () => mainWindow,
  getTwitchHoloServer: () => holoServer,
  getStreamOverlayServer: () => null,
  getStateSnapshot: () => stateSnapshot()
};
