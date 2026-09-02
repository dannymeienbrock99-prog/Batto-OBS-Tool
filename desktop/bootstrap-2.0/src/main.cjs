"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  safeStorage,
  shell
} = require("electron");
const {
  collectHardware,
  runCpuLoadTest,
  runInternetTest,
  SystemTelemetrySampler
} = require("./services/hardware.cjs");
const { ObsWebSocketClient, normalizeLocalObsHost } = require("./services/obs-websocket.cjs");
const { buildRecommendation } = require("./services/recommendation.cjs");
const { MobileBridge } = require("./services/mobile-bridge.cjs");
const { StreamOverlayServer } = require("./services/stream-overlay-server.cjs");
const { MultiChat } = require("./services/multi-chat.cjs");
const { PluginRegistry } = require("./services/plugin-registry.cjs");
const { DeckStore } = require("./services/deck-store.cjs");
const { LegacyMigration } = require("./services/migration.cjs");
const { ActionExecutor } = require("./services/action-executor.cjs");
const { deepClone, ensureDirectory, readJson, safeText, writeJsonAtomic } = require("./services/common.cjs");
const { MonitoringOverlayServer } = require("../modules/encoder-monitoring-overlay/src/server.cjs");

app.setName("Batto OBS Tool");

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) app.exit(0);

let mainWindow = null;
const childWindows = new Set();
let appSettings = null;
let hardware = null;
let internetResult = null;
let recommendation = null;
let latestObs = { available: false, connected: false };
let latestTelemetry = null;
let telemetryTimer = null;
let stateTimer = null;
let monitoringServer = null;
let streamOverlayServer = null;
let mobileBridge = null;
let multiChat = null;
let pluginRegistry = null;
let deckStore = null;
let migration = null;
let actionExecutor = null;
let sampler = null;
const moduleErrors = {};
const obs = new ObsWebSocketClient();

function userDataFile(name) { return path.join(app.getPath("userData"), name); }
function programDataRoot() { return ensureDirectory(path.join(process.env.ProgramData || "C:\\ProgramData", "Batto OBS Tool")); }
function rendererFile(name) { return path.join(__dirname, "renderer", name); }
function appResource(...parts) {
  const development = path.join(__dirname, "..", "resources", ...parts);
  const packaged = path.join(process.resourcesPath, "resources", ...parts);
  return fs.existsSync(packaged) ? packaged : development;
}
function modulePath(name, ...parts) { return path.join(__dirname, "..", "modules", name, ...parts); }

function defaultAppSettings() {
  return {
    version: 2,
    obs: { host: "127.0.0.1", port: 4455, autoConnect: true },
    encoder: { platform: "twitch", resolution: "1920x1080", fps: 60 },
    mobile: { enabled: true, requireApproval: true },
    overlay: { streamEnabled: true, monitoringEnabled: true },
    ui: { startPage: "overview", compact: false },
    updatedAt: Date.now()
  };
}

function loadSettings() {
  const loaded = readJson(userDataFile("app-settings.json"), {}) || {};
  const fallback = defaultAppSettings();
  appSettings = {
    ...fallback,
    ...loaded,
    obs: { ...fallback.obs, ...(loaded.obs || {}), host: normalizeLocalObsHost(loaded.obs?.host) },
    encoder: { ...fallback.encoder, ...(loaded.encoder || {}) },
    mobile: { ...fallback.mobile, ...(loaded.mobile || {}) },
    overlay: { ...fallback.overlay, ...(loaded.overlay || {}) },
    ui: { ...fallback.ui, ...(loaded.ui || {}) }
  };
  saveSettings();
  return appSettings;
}

function saveSettings() {
  appSettings.updatedAt = Date.now();
  writeJsonAtomic(userDataFile("app-settings.json"), appSettings);
}

function secretFile() { return userDataFile("secrets.dat.json"); }
function readSecrets() {
  const value = readJson(secretFile(), {}) || {};
  const result = {};
  for (const [key, encoded] of Object.entries(value)) {
    try {
      result[key] = safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(Buffer.from(String(encoded), "base64"))
        : "";
    } catch { result[key] = ""; }
  }
  return result;
}
function writeSecret(key, value) {
  const current = readJson(secretFile(), {}) || {};
  if (!value) delete current[key];
  else {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows-Verschlüsselung ist momentan nicht verfügbar.");
    current[key] = safeStorage.encryptString(String(value)).toString("base64");
  }
  writeJsonAtomic(secretFile(), current);
}

function errorPayload(error) {
  return { name: error?.name || "Error", code: error?.code || "", message: String(error?.message || error || "Unbekannter Fehler") };
}

function monitoringStatus() {
  if (!monitoringServer) return { active: false, error: moduleErrors.monitoring?.message || "" };
  try {
    if (typeof monitoringServer.status === "function") return { active: true, ...monitoringServer.status() };
  } catch {}
  const port = Number(monitoringServer.port || monitoringServer.address?.port || 17822);
  return { active: true, port, baseUrl: `http://127.0.0.1:${port}`, editorUrl: `http://127.0.0.1:${port}/editor`, overlayUrl: `http://127.0.0.1:${port}/overlay` };
}

function sanitizedChatSnapshot() {
  const value = multiChat?.snapshot() || { settings: {}, messages: [], status: {} };
  return value;
}

function publicSettings() {
  const secrets = readSecrets();
  return {
    ...deepClone(appSettings),
    obs: { ...deepClone(appSettings.obs), passwordStored: Boolean(secrets.obsPassword) },
    chatSecrets: { twitchStored: Boolean(secrets.twitchOauth), youtubeStored: Boolean(secrets.youtubeApiKey) }
  };
}

function currentState() {
  return {
    app: { name: "Batto OBS Tool", version: app.getVersion(), packaged: app.isPackaged, platform: process.platform },
    settings: publicSettings(),
    hardware: hardware || null,
    internet: internetResult || null,
    recommendation: recommendation || null,
    obs: latestObs || obs.status(),
    telemetry: latestTelemetry,
    deck: deckStore?.snapshot() || null,
    plugins: pluginRegistry?.snapshot() || { plugins: [], iconPacks: [] },
    chat: sanitizedChatSnapshot(),
    mobile: mobileBridge?.status() || { active: false },
    migration: migration?.status() || null,
    modules: {
      monitoring: monitoringStatus(),
      streamOverlay: streamOverlayServer?.status() || { active: false, error: moduleErrors.streamOverlay?.message || "" }
    },
    errors: deepClone(moduleErrors),
    sampledAt: Date.now()
  };
}

function sendState() {
  const state = currentState();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("state:changed", state);
  mobileBridge?.broadcastState();
}

function scheduleState() {
  clearTimeout(stateTimer);
  stateTimer = setTimeout(sendState, 80);
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1540,
    height: 940,
    minWidth: 1060,
    minHeight: 700,
    backgroundColor: "#060d15",
    show: false,
    title: "Batto OBS Tool",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });
  mainWindow.loadFile(rendererFile("index.html"));
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => { mainWindow = null; });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
}

function openLocalWindow(url, title, width = 1480, height = 900) {
  if (!/^http:\/\/127\.0\.0\.1:\d+\//.test(url)) throw new Error("Nur lokale Batto-Module dürfen im Programmfenster geöffnet werden.");
  const child = new BrowserWindow({
    width, height, minWidth: 840, minHeight: 620, parent: mainWindow || undefined, title,
    autoHideMenuBar: true, backgroundColor: "#080e15",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true }
  });
  childWindows.add(child);
  child.on("closed", () => childWindows.delete(child));
  child.loadURL(url);
  return true;
}

function preferredGpu() {
  if (!hardware) return null;
  return hardware.preferredGpu
    || hardware.gpus?.find((gpu) => gpu.dedicated || /nvidia|geforce|radeon\s+rx|intel\s+arc/i.test(gpu.name || ""))
    || hardware.gpus?.[0]
    || null;
}

function fallbackRecommendation(options = {}) {
  const gpu = preferredGpu();
  const name = String(gpu?.name || "");
  const platform = String(options.platform || appSettings.encoder.platform || "twitch").toLowerCase();
  const resolution = String(options.resolution || appSettings.encoder.resolution || "1920x1080");
  const fps = Number(options.fps || appSettings.encoder.fps || 60);
  const nvidia = /nvidia|geforce|rtx|gtx/i.test(name);
  const amd = /amd|radeon/i.test(name) && !/radeon\(tm\) graphics/i.test(name);
  const intel = /intel.*arc/i.test(name);
  let encoder = "x264";
  let codec = "H.264";
  if (nvidia) { encoder = /rtx\s*(?:40|50)/i.test(name) && platform !== "twitch" ? "NVIDIA NVENC AV1" : "NVIDIA NVENC H.264"; codec = encoder.includes("AV1") ? "AV1" : "H.264"; }
  else if (amd) encoder = "AMD HW H.264 (AMF)";
  else if (intel) encoder = "Intel QSV H.264";
  const pixels = resolution.split("x").map(Number);
  const height = pixels[1] || 1080;
  let bitrate = platform === "twitch" ? 6000 : height >= 2160 ? 30000 : height >= 1440 ? 18000 : fps >= 60 ? 10000 : 7500;
  if (internetResult?.uploadMbps) bitrate = Math.min(bitrate, Math.max(2500, Math.floor(internetResult.uploadMbps * 1000 * .7)));
  return {
    generatedAt: Date.now(), platform, resolution, fps, gpu: name || "Nicht verfügbar", encoder, codec,
    rateControl: "CBR", bitrateKbps: bitrate, keyframeInterval: 2, preset: nvidia ? "P5 – Quality" : "Quality",
    profile: "high", bFrames: codec === "AV1" ? 2 : 2,
    notes: ["Werte manuell in OBS eintragen.", "OBS-Einstellungen werden nicht automatisch überschrieben."]
  };
}

async function buildEncoderRecommendation(options = {}) {
  appSettings.encoder = { ...appSettings.encoder, ...options };
  saveSettings();
  try {
    recommendation = await Promise.resolve(buildRecommendation({ hardware: await ensureHardware(), internet: internetResult, ...appSettings.encoder }));
  } catch {
    recommendation = fallbackRecommendation(options);
  }
  scheduleState();
  return recommendation;
}

async function ensureHardware(force = false) {
  if (!hardware || force) hardware = await collectHardware();
  return hardware;
}

function buildTelemetry(systemSample, obsSnapshot) {
  const gpu = preferredGpu();
  const cpu = hardware?.cpu || {};
  const memory = hardware?.memory || {};
  const stats = obsSnapshot?.stats || {};
  const stream = obsSnapshot?.stream || {};
  const record = obsSnapshot?.record || {};
  const profileValues = obsSnapshot?.profileValues || {};
  return {
    timestamp: Date.now(),
    profileName: obsSnapshot?.profiles?.currentProfileName || obsSnapshot?.profiles?.currentProfile || "Standard",
    gpus: (hardware?.gpus || []).map((item) => ({ ...item, name: item.name || item.model, memoryTotalMb: Number(item.memoryTotalMb || item.adapterRamMb || item.vramMb || (item.adapterRamGb ? item.adapterRamGb * 1024 : 0)) || null })),
    gpu: { ...gpu, name: gpu?.name || "Nicht verfügbar", ...(systemSample?.gpu || systemSample?.gpus?.find?.((item) => item.name === gpu?.name) || {}) },
    cpu: { model: cpu.model || cpu.name, utilizationPercent: systemSample?.cpu?.utilizationPercent ?? systemSample?.cpuUsage, temperatureC: systemSample?.cpu?.temperatureC, clockMhz: systemSample?.cpu?.clockMhz },
    ram: { totalGb: memory.totalGb || memory.total, usedGb: systemSample?.memory?.usedGb || systemSample?.ram?.usedGb, percent: systemSample?.memory?.percent || systemSample?.ram?.percent },
    network: { connected: true, uploadBytesPerSecond: systemSample?.network?.uploadBytesPerSecond || systemSample?.uploadBytesPerSecond, averageUploadBytesPerSecond: systemSample?.network?.averageUploadBytesPerSecond, latencyMs: internetResult?.latencyMs || internetResult?.pingMs },
    obs: { cpuUsage: stats.cpuUsage, averageFrameRenderTime: stats.averageFrameRenderTime, activeFps: stats.activeFps },
    output: {
      streamActive: Boolean(stream.outputActive), recordActive: Boolean(record.outputActive),
      totalFrames: stream.outputTotalFrames || record.outputTotalFrames || 0,
      networkDroppedFrames: stream.outputSkippedFrames || 0,
      renderLagFrames: stats.renderSkippedFrames || 0,
      encodingLagFrames: stats.outputSkippedFrames || 0,
      streamTimecode: stream.outputTimecode, recordTimecode: record.outputTimecode,
      outputBytes: stream.outputBytes, recordBytes: record.outputBytes
    },
    video: { outputFps: obsSnapshot?.video?.fpsNumerator && obsSnapshot?.video?.fpsDenominator ? obsSnapshot.video.fpsNumerator / obsSnapshot.video.fpsDenominator : stats.activeFps, renderFps: stats.activeFps, outputWidth: obsSnapshot?.video?.outputWidth, outputHeight: obsSnapshot?.video?.outputHeight },
    encoder: {
      name: profileValues["AdvOut.Encoder"] || profileValues["SimpleOutput.StreamEncoder"] || recommendation?.encoder || "Nicht verfügbar",
      codec: recommendation?.codec || "Nicht verfügbar", rateControl: recommendation?.rateControl || "Nicht verfügbar",
      bitrateKbps: recommendation?.bitrateKbps || Number(profileValues["SimpleOutput.VBitrate"]) || null,
      preset: profileValues["SimpleOutput.Preset"] || recommendation?.preset || "Nicht verfügbar", gpuName: gpu?.name || ""
    },
    hardware,
    internet: internetResult,
    sampledAt: Date.now()
  };
}

function publishMonitoring(telemetry) {
  if (!monitoringServer) return;
  for (const method of ["ingestTelemetry", "updateTelemetry", "setTelemetry", "ingest", "publishTelemetry", "publish"]) {
    if (typeof monitoringServer[method] === "function") {
      try { monitoringServer[method](telemetry); return; } catch {}
    }
  }
}

async function refreshTelemetry() {
  try {
    const [systemSample, obsSnapshot] = await Promise.all([
      Promise.resolve(sampler?.sample?.() || sampler?.snapshot?.() || {}),
      obs.status().connected ? obs.snapshot() : Promise.resolve({ available: false, ...obs.status() })
    ]);
    latestObs = obsSnapshot;
    latestTelemetry = buildTelemetry(systemSample || {}, obsSnapshot || {});
    publishMonitoring(latestTelemetry);
  } catch (error) {
    moduleErrors.telemetry = errorPayload(error);
  }
  scheduleState();
}

async function startModules() {
  const monitoringWeb = modulePath("encoder-monitoring-overlay", "web");
  try {
    monitoringServer = new MonitoringOverlayServer({ port: 17822, webRoot: monitoringWeb, configFile: userDataFile("encoder-monitoring-layouts.json"), historySize: 600 });
    await monitoringServer.start();
  } catch (error) { moduleErrors.monitoring = errorPayload(error); monitoringServer = null; }

  try {
    streamOverlayServer = new StreamOverlayServer({
      webRoot: path.join(__dirname, "stream-overlay"), configFile: userDataFile("stream-overlay.json"),
      logoPath: appResource("team-logo.svg"), preferredPort: 48621
    });
    await streamOverlayServer.start();
  } catch (error) { moduleErrors.streamOverlay = errorPayload(error); streamOverlayServer = null; }

  multiChat = new MultiChat({ settingsFile: userDataFile("multi-chat.json"), overlayServer: streamOverlayServer });
  multiChat.on("message", () => scheduleState());
  multiChat.on("changed", scheduleState);

  pluginRegistry = new PluginRegistry({ stateFile: userDataFile("plugin-state.json") });
  pluginRegistry.scan();
  pluginRegistry.on("changed", scheduleState);

  deckStore = new DeckStore(userDataFile("deck-profiles.json"));
  actionExecutor = new ActionExecutor({ obs, shell, overlayServer: streamOverlayServer, multiChat, dataFile: userDataFile("action-data.json") });

  migration = new LegacyMigration({ userData: app.getPath("userData"), deckStore, pluginRegistry });
  try { migration.run(); } catch (error) { moduleErrors.migration = errorPayload(error); }

  if (appSettings.mobile.enabled) {
    try {
      mobileBridge = new MobileBridge({
        webRoot: path.join(__dirname, "mobile"), stateFile: userDataFile("mobile-pairings.json"), preferredPort: 48620,
        requireApproval: appSettings.mobile.requireApproval, stateProvider: currentState,
        actionHandler: executeMobilePayload
      });
      await mobileBridge.start();
      mobileBridge.on("changed", scheduleState);
      mobileBridge.on("pair-request", (request) => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("mobile:pair-request", request);
      });
    } catch (error) { moduleErrors.mobile = errorPayload(error); mobileBridge = null; }
  }
}

async function executeMobilePayload(payload = {}) {
  if (payload.kind === "deck-button") {
    const profile = deckStore.getProfile(payload.profileId) || deckStore.activeProfile();
    const folder = profile?.folders.find((item) => item.id === payload.folderId) || profile?.folders[0];
    const button = folder?.buttons?.[Number(payload.buttonIndex)];
    if (!button?.actions?.length) throw new Error("Diese Taste ist nicht belegt.");
    return { ok: true, results: await actionExecutor.executeMany(button.actions, { profileId: profile.id, folderId: folder.id }) };
  }
  if (payload.kind === "action" && payload.action) return actionExecutor.execute(payload.action, { source: "mobile" });
  throw new Error("Unbekannte Handy-Aktion.");
}

async function connectObs(payload = {}) {
  const password = payload.password !== undefined ? String(payload.password || "") : readSecrets().obsPassword || "";
  appSettings.obs = {
    host: normalizeLocalObsHost(payload.host || payload.address || appSettings.obs.host),
    port: Math.max(1, Math.min(65535, Number(payload.port) || appSettings.obs.port || 4455)),
    autoConnect: payload.autoConnect === undefined ? appSettings.obs.autoConnect : Boolean(payload.autoConnect)
  };
  if (payload.password !== undefined) writeSecret("obsPassword", password);
  saveSettings();
  await obs.connect({ ...appSettings.obs, password });
  latestObs = await obs.snapshot();
  scheduleState();
  return latestObs;
}

async function autoConnectObs() {
  if (!appSettings.obs.autoConnect) return;
  try { await connectObs({}); }
  catch (error) { moduleErrors.obs = errorPayload(error); latestObs = { available: false, ...obs.status(), error: errorPayload(error) }; }
}

function registerIpc() {
  const handle = (channel, handler) => ipcMain.handle(channel, async (event, payload) => {
    try { return { ok: true, value: await handler(payload || {}, event) }; }
    catch (error) { return { ok: false, error: errorPayload(error) }; }
  });

  handle("state:get", () => currentState());
  handle("hardware:scan", async () => { hardware = await ensureHardware(true); await buildEncoderRecommendation({}); await refreshTelemetry(); return hardware; });
  handle("hardware:save-report", async () => {
    const result = await dialog.showSaveDialog(mainWindow, { title: "Diagnosebericht speichern", defaultPath: `Batto-OBS-Tool-Diagnose-${new Date().toISOString().slice(0,10)}.json`, filters: [{ name: "JSON", extensions: ["json"] }] });
    if (result.canceled || !result.filePath) return null;
    fs.writeFileSync(result.filePath, `${JSON.stringify({ generatedAt: new Date().toISOString(), hardware, internet: internetResult, obs: latestObs, recommendation }, null, 2)}\n`, "utf8");
    return result.filePath;
  });
  handle("internet:test", async (payload) => { internetResult = await runInternetTest(payload); await buildEncoderRecommendation({}); return internetResult; });
  handle("cpu:test", (payload) => runCpuLoadTest(payload));
  handle("obs:connect", connectObs);
  handle("obs:disconnect", async () => { await obs.disconnect(); latestObs = { available: false, ...obs.status() }; scheduleState(); return latestObs; });
  handle("obs:refresh", async () => { latestObs = await obs.snapshot(); scheduleState(); return latestObs; });
  handle("obs:call", (payload) => obs.call(payload.requestType, payload.requestData || {}));
  handle("obs:record-test", (payload) => obs.runRecordTest(payload.seconds || 8));
  handle("recommendation:build", buildEncoderRecommendation);

  handle("deck:create-profile", (payload) => deckStore.createProfile(payload.name, payload.templateProfileId));
  handle("deck:update-profile", (payload) => deckStore.updateProfile(payload.profileId, payload.patch));
  handle("deck:delete-profile", (payload) => deckStore.deleteProfile(payload.profileId));
  handle("deck:activate-profile", (payload) => deckStore.activateProfile(payload.profileId));
  handle("deck:create-folder", (payload) => deckStore.createFolder(payload.profileId, payload.name, payload.parentId));
  handle("deck:update-folder", (payload) => deckStore.updateFolder(payload.profileId, payload.folderId, payload.patch));
  handle("deck:delete-folder", (payload) => deckStore.deleteFolder(payload.profileId, payload.folderId));
  handle("deck:activate-folder", (payload) => deckStore.activateFolder(payload.profileId, payload.folderId));
  handle("deck:update-button", (payload) => deckStore.updateButton(payload.profileId, payload.folderId, payload.buttonIndex, payload.button));
  handle("deck:move-button", (payload) => deckStore.moveButton(payload.profileId, payload.folderId, payload.fromIndex, payload.toIndex));
  handle("deck:clear-button", (payload) => deckStore.clearButton(payload.profileId, payload.folderId, payload.buttonIndex));
  handle("deck:execute-button", async (payload) => {
    const profile = deckStore.getProfile(payload.profileId) || deckStore.activeProfile();
    const folder = profile?.folders.find((item) => item.id === payload.folderId) || profile?.folders[0];
    const button = folder?.buttons?.[Number(payload.buttonIndex)];
    if (!button?.actions?.length) throw new Error("Diese Taste ist nicht belegt.");
    return actionExecutor.executeMany(button.actions, { profileId: profile.id, folderId: folder.id });
  });
  handle("deck:export", async () => {
    const result = await dialog.showSaveDialog(mainWindow, { title: "Touch-Deck exportieren", defaultPath: "Batto-OBS-Tool-Deck.json", filters: [{ name: "JSON", extensions: ["json"] }] });
    if (result.canceled || !result.filePath) return null;
    return deckStore.exportTo(result.filePath);
  });
  handle("deck:import", async (payload) => {
    const result = await dialog.showOpenDialog(mainWindow, { title: "Touch-Deck importieren", properties: ["openFile"], filters: [{ name: "JSON", extensions: ["json"] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    return deckStore.importFrom(result.filePaths[0], payload.mode || "merge");
  });
  handle("action:execute", (payload) => actionExecutor.execute(payload.action, payload.context || {}));

  handle("plugins:scan", () => pluginRegistry.scan());
  handle("plugins:enable", (payload) => pluginRegistry.setEnabled(payload.pluginId, payload.enabled));
  handle("plugins:settings", (payload) => pluginRegistry.saveSettings(payload.pluginId, payload.settings));
  handle("plugins:import", async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: "Plugin-Ordner auswählen", properties: ["openDirectory"] });
    if (result.canceled || !result.filePaths[0]) return null;
    return pluginRegistry.importDirectory(result.filePaths[0], path.join(programDataRoot(), "Plugins"));
  });

  handle("mobile:status", () => mobileBridge?.status() || { active: false });
  handle("mobile:approve", (payload) => mobileBridge.approve(payload.requestId));
  handle("mobile:reject", (payload) => mobileBridge.reject(payload.requestId));
  handle("mobile:revoke", (payload) => mobileBridge.revoke(payload.clientId));
  handle("mobile:regenerate-pin", () => mobileBridge.regeneratePin());
  handle("mobile:approval", (payload) => { appSettings.mobile.requireApproval = Boolean(payload.required); saveSettings(); return mobileBridge.setApprovalRequired(payload.required); });

  handle("stream-overlay:status", () => streamOverlayServer?.status());
  handle("stream-overlay:open", () => openLocalWindow(streamOverlayServer.status().editorUrl, "Batto OBS Tool – Stream-Overlay"));
  handle("stream-overlay:copy-url", () => { const url = streamOverlayServer.status().overlayUrl; clipboard.writeText(url); return url; });
  handle("stream-overlay:event", (payload) => streamOverlayServer.publishEvent(payload));
  handle("stream-overlay:clear", () => streamOverlayServer.clearEvents());

  handle("monitoring:status", () => monitoringStatus());
  handle("monitoring:open", () => openLocalWindow(monitoringStatus().editorUrl, "Batto OBS Tool – Monitoring"));
  handle("monitoring:copy-url", () => { const url = monitoringStatus().overlayUrl; clipboard.writeText(url); return url; });

  handle("multichat:connectTwitch", async (payload) => { if (payload.oauthToken) writeSecret("twitchOauth", payload.oauthToken); const result = await multiChat.connectTwitch({ channel: payload.channel, oauth: payload.oauthToken || readSecrets().twitchOauth || "" }); scheduleState(); return result; });
  handle("multichat:disconnectTwitch", () => multiChat.disconnectTwitch());
  handle("multichat:connectYouTube", async (payload) => { if (payload.apiKey) writeSecret("youtubeApiKey", payload.apiKey); const result = await multiChat.connectYouTube({ apiKey: payload.apiKey || readSecrets().youtubeApiKey || "", liveChatId: payload.liveChatId }); scheduleState(); return result; });
  handle("multichat:disconnectYouTube", () => multiChat.disconnectYouTube());
  handle("multichat:update", (payload) => { const sanitized = deepClone(payload || {}); const secrets = {}; if (payload?.twitch?.oauth !== undefined) { secrets.twitchOauth = payload.twitch.oauth; delete sanitized.twitch.oauth; } if (payload?.youtube?.apiKey !== undefined) { secrets.youtubeApiKey = payload.youtube.apiKey; delete sanitized.youtube.apiKey; } if (secrets.twitchOauth !== undefined) writeSecret("twitchOauth", secrets.twitchOauth); if (secrets.youtubeApiKey !== undefined) writeSecret("youtubeApiKey", secrets.youtubeApiKey); return multiChat.updateSettings(sanitized, secrets); });
  handle("multichat:clear", () => multiChat.clear());
  handle("multichat:tts-skip", () => multiChat.skipTts());
  handle("multichat:tts-clear", () => multiChat.clearTts());

  handle("settings:update", (payload) => {
    appSettings = { ...appSettings, ...(payload || {}), obs: { ...appSettings.obs, ...(payload.obs || {}) }, mobile: { ...appSettings.mobile, ...(payload.mobile || {}) }, overlay: { ...appSettings.overlay, ...(payload.overlay || {}) }, ui: { ...appSettings.ui, ...(payload.ui || {}) } };
    saveSettings();
    return publicSettings();
  });

  handle("app:openExternal", (payload) => shell.openExternal(String(payload.url || payload)));
  handle("app:openProgramData", () => shell.openPath(programDataRoot()));
  handle("app:close", () => app.quit());
}

async function initialize() {
  loadSettings();
  try { hardware = await collectHardware(); } catch (error) { moduleErrors.hardware = errorPayload(error); }
  sampler = new SystemTelemetrySampler();
  await startModules();
  registerIpc();
  createMainWindow();
  await buildEncoderRecommendation({});
  await autoConnectObs();
  await refreshTelemetry();
  telemetryTimer = setInterval(refreshTelemetry, 1000);
  telemetryTimer.unref?.();
  sendState();
}

app.whenReady().then(initialize).catch((error) => {
  console.error(error);
  dialog.showErrorBox("Batto OBS Tool – Startfehler", errorPayload(error).message);
});

app.on("second-instance", () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); } });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", async () => {
  clearInterval(telemetryTimer);
  clearTimeout(stateTimer);
  try { await obs.disconnect(); } catch {}
  try { await monitoringServer?.stop?.(); } catch {}
  try { await streamOverlayServer?.stop?.(); } catch {}
  try { await mobileBridge?.stop?.(); } catch {}
  try { await multiChat?.stop?.(); } catch {}
});

module.exports = {
  getMainWindow: () => mainWindow,
  getObsClient: () => obs,
  getStreamOverlayServer: () => streamOverlayServer,
  getMultiChat: () => multiChat
};
