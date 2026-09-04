"use strict";

const path = require("node:path");
const {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  safeStorage,
  shell
} = require("electron");
const { SettingsStore } = require("./services/store.cjs");
const { SecretStore } = require("./services/secret-store.cjs");
const {
  SystemTelemetrySampler,
  collectHardware,
  runCpuLoadTest,
  runInternetTest
} = require("./services/hardware.cjs");
const { ObsWebSocketClient, normalizeLocalObsHost } = require("./services/obs-websocket.cjs");
const { buildRecommendation } = require("./services/recommendation.cjs");
const { composeTelemetry } = require("./services/telemetry.cjs");
const { TwitchHoloServer } = require("./services/twitch-holo-server.cjs");
const { MonitoringOverlayServer } = require("../modules/encoder-monitoring-overlay/src/server.cjs");

app.setName("Batto OBS Tool");

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) app.exit(0);
app.on("second-instance", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

let mainWindow = null;
let settingsStore = null;
let secretStore = null;
let monitoringServer = null;
let holoServer = null;
let hardware = null;
let internetResult = null;
let recommendation = null;
let telemetryTimer = null;
let latestTelemetry = null;
let moduleErrors = {};
const obs = new ObsWebSocketClient();
const sampler = new SystemTelemetrySampler();

function userDataFile(name) {
  return path.join(app.getPath("userData"), name);
}

function errorPayload(error) {
  return {
    message: String(error?.message || error || "Unbekannter Fehler"),
    name: error?.name || "Error",
    code: error?.code || ""
  };
}

async function safeObsSnapshot() {
  try {
    return await obs.snapshot();
  } catch (error) {
    return { ...obs.status(), available: false, error: errorPayload(error) };
  }
}

async function ensureHardware() {
  if (!hardware) hardware = await collectHardware();
  return hardware;
}

async function startLocalModules() {
  moduleErrors = {};
  const monitoringRoot = path.join(__dirname, "..", "modules", "encoder-monitoring-overlay", "web");
  try {
    monitoringServer = new MonitoringOverlayServer({
      port: 17822,
      webRoot: monitoringRoot,
      configFile: userDataFile("encoder-monitoring-layouts.json"),
      historySize: 600
    });
    await monitoringServer.start();
  } catch (error) {
    moduleErrors.monitoring = errorPayload(error);
    monitoringServer = null;
    console.error("Monitoring-Overlay konnte nicht starten:", error);
  }

  try {
    holoServer = new TwitchHoloServer({
      preferredPort: 17823,
      webRoot: path.join(__dirname, "..", "modules", "twitch-holo-chat", "web")
    });
    await holoServer.start();
  } catch (error) {
    moduleErrors.twitchHolo = errorPayload(error);
    holoServer = null;
    console.error("Twitch-Hologramm konnte nicht starten:", error);
  }
}

async function sampleTelemetry() {
  try {
    const currentHardware = await ensureHardware().catch(() => hardware);
    const system = await sampler.sample(currentHardware);
    const obsSnapshot = await safeObsSnapshot();
    latestTelemetry = composeTelemetry({
      hardware: currentHardware,
      system,
      obsSnapshot,
      profileName: "Standard"
    });
    monitoringServer?.updateTelemetry(latestTelemetry);
    mainWindow?.webContents.send("telemetry:update", latestTelemetry);
    mainWindow?.webContents.send("obs:status-changed", obs.status());
  } catch (error) {
    mainWindow?.webContents.send("telemetry:error", errorPayload(error));
  }
}

function startTelemetryLoop() {
  clearInterval(telemetryTimer);
  telemetryTimer = setInterval(() => void sampleTelemetry(), 1000);
  telemetryTimer.unref?.();
  void sampleTelemetry();
}

async function stateSnapshot() {
  const state = await settingsStore.get();
  const obsSnapshot = await safeObsSnapshot();
  return {
    product: {
      name: "Batto OBS Tool",
      version: app.getVersion(),
      author: "Crazy_Batto / Team Alpha",
      packaged: app.isPackaged
    },
    settings: {
      ...state,
      obs: {
        host: state.obs.host,
        port: state.obs.port,
        passwordConfigured: await secretStore.has("obs-websocket-password")
      }
    },
    hardware,
    internetResult,
    recommendation,
    obs: obsSnapshot,
    telemetry: latestTelemetry,
    monitoring: monitoringServer?.status() || { running: false },
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
    backgroundColor: "#070b12",
    autoHideMenuBar: true,
    show: false,
    icon: path.join(__dirname, "renderer", "assets", "team-alpha-logo.svg"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true
    }
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
    return settingsStore.set({
      ...current,
      ...payload,
      obs: {
        ...current.obs,
        ...(payload.obs || {}),
        password: ""
      },
      preferences: { ...current.preferences, ...(payload.preferences || {}) }
    });
  });

  ipcMain.handle("hardware:scan", async () => {
    hardware = await collectHardware();
    await sampleTelemetry();
    return hardware;
  });

  ipcMain.handle("internet:test", async () => {
    internetResult = await runInternetTest();
    return internetResult;
  });

  ipcMain.handle("diagnostics:cpu-load", (_event, options) => runCpuLoadTest(options?.durationSeconds || 10));

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
    await sampleTelemetry();
    return result;
  });

  ipcMain.handle("obs:disconnect", async () => { await obs.disconnect(); return obs.status(); });
  ipcMain.handle("obs:forget-password", async () => { await secretStore.delete("obs-websocket-password"); return { configured: false }; });
  ipcMain.handle("obs:snapshot", () => safeObsSnapshot());
  ipcMain.handle("obs:execute", (_event, action, payload) => obs.execute(action, payload));
  ipcMain.handle("obs:recording-test", (_event, options) => obs.runRecordingTest(options?.durationSeconds || 15));

  ipcMain.handle("recommendation:build", async (_event, input = {}) => {
    const state = await settingsStore.get();
    const currentHardware = await ensureHardware();
    recommendation = buildRecommendation({
      platform: input.platform || state.preferences.platform,
      resolution: input.resolution || state.preferences.targetResolution,
      fps: input.fps || state.preferences.targetFps,
      uploadMbps: input.uploadMbps ?? internetResult?.uploadMbps ?? 0,
      gpu: currentHardware.preferredGpu || {}
    });
    return recommendation;
  });

  ipcMain.handle("monitoring:status", () => monitoringServer?.status() || { running: false });
  ipcMain.handle("monitoring:open-editor", async () => {
    const status = monitoringServer?.status();
    if (!status?.editorUrl) throw new Error("Monitoring-Editor ist nicht gestartet.");
    await shell.openExternal(status.editorUrl);
    return status;
  });
  ipcMain.handle("monitoring:copy-url", () => {
    const status = monitoringServer?.status();
    if (!status?.overlayUrl) throw new Error("Monitoring-Overlay ist nicht gestartet.");
    clipboard.writeText(status.overlayUrl);
    return status.overlayUrl;
  });

  ipcMain.handle("holo:status", () => holoServer?.status() || { running: false });
  ipcMain.handle("holo:open-editor", async () => {
    const status = holoServer?.status();
    if (!status?.editorUrl) throw new Error("Hologramm-Editor ist nicht gestartet.");
    await shell.openExternal(status.editorUrl);
    return status;
  });
  ipcMain.handle("holo:copy-url", () => {
    const status = holoServer?.status();
    if (!status?.overlayUrl) throw new Error("Hologramm-Overlay ist nicht gestartet.");
    clipboard.writeText(status.overlayUrl);
    return status.overlayUrl;
  });

  ipcMain.handle("dialog:save-report", async (_event, report) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Batto-OBS-Tool-Diagnosebericht speichern",
      defaultPath: `Batto-OBS-Tool-Diagnose-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }]
    });
    if (result.canceled || !result.filePath) return { saved: false };
    const fs = require("node:fs/promises");
    await fs.writeFile(result.filePath, JSON.stringify(report, null, 2), "utf8");
    return { saved: true, filePath: result.filePath };
  });
}

async function runSelfTest() {
  const result = { product: "Batto OBS Tool", version: app.getVersion(), platform: process.platform, modules: {} };
  const currentHardware = await collectHardware();
  result.hardware = {
    cpu: currentHardware.cpu?.name || "Nicht verfügbar",
    preferredGpu: currentHardware.preferredGpu?.name || "Nicht verfügbar",
    memoryGb: currentHardware.memory?.totalGb || 0
  };
  const monitoringRoot = path.join(__dirname, "..", "modules", "encoder-monitoring-overlay", "web");
  const testMonitoring = new MonitoringOverlayServer({ port: 18922, webRoot: monitoringRoot });
  await testMonitoring.start();
  result.modules.monitoring = testMonitoring.status().running;
  await testMonitoring.stop();
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

  if (process.argv.includes("--self-test")) {
    try { await runSelfTest(); app.exit(0); }
    catch (error) { process.stderr.write(`${String(error?.stack || error)}\n`); app.exit(1); }
    return;
  }

  registerIpc();
  await startLocalModules();
  createMainWindow();
  startTelemetryLoop();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
}).catch((error) => {
  dialog.showErrorBox("Batto OBS Tool konnte nicht starten", String(error?.stack || error));
  app.exit(1);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  clearInterval(telemetryTimer);
  void obs.disconnect();
  void monitoringServer?.stop();
  void holoServer?.stop();
});

module.exports = {
  getObsClient: () => obs,
  getMainWindow: () => mainWindow,
  getMonitoringServer: () => monitoringServer,
  getTwitchHoloServer: () => holoServer,
  getStreamOverlayServer: () => null,
  getStateSnapshot: () => stateSnapshot()
};
