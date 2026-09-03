"use strict";

const path = require("node:path");
const { app, dialog, ipcMain, safeStorage, shell } = require("electron");
const { DeckStore } = require("./services/deck-store.cjs");
const { PluginRegistry } = require("./services/plugin-registry.cjs");
const { SettingsStore } = require("./services/store.cjs");
const { SecretStore } = require("./services/secret-store.cjs");
const { ObsWebSocketClient } = require("./services/obs-websocket.cjs");
const { TikTokLiveStudioService } = require("./services/tiktok-live-studio.cjs");

let deckStore;
let pluginRegistry;
let settingsStore;
let secretStore;
let obs;
let liveStudio;
let registered = false;

function userDataFile(name) {
  return path.join(app.getPath("userData"), name);
}

function register(channel, handler) {
  ipcMain.handle(channel, (_event, payload = {}) => handler(payload || {}));
}

async function ensureObs() {
  if (obs.connected) return obs;
  const settings = await settingsStore.get();
  const password = await secretStore.get("obs-websocket-password");
  await obs.connect({ host: settings.obs.host, port: settings.obs.port, password });
  return obs;
}

function obsAction(action) {
  const type = String(action?.type || "");
  const settings = action?.settings && typeof action.settings === "object" ? action.settings : {};
  if (type === "obs.scene") return ["scene.set", { sceneName: settings.sceneName || settings.scene || settings.name || "" }];
  if (type === "obs.input.mute") return ["input.mute", { inputName: settings.inputName || settings.sourceName || "", inputMuted: settings.inputMuted !== false }];
  if (type === "obs.stream.start") return ["stream.start", {}];
  if (type === "obs.stream.stop") return ["stream.stop", {}];
  if (type === "obs.record.start") return ["record.start", {}];
  if (type === "obs.record.stop") return ["record.stop", {}];
  if (type === "obs.virtualcam.start") return ["virtualcam.start", {}];
  if (type === "obs.virtualcam.stop") return ["virtualcam.stop", {}];
  return null;
}

async function executeAction(action) {
  const delay = Math.max(0, Math.min(120000, Number(action?.delayMs) || 0));
  if (delay) await new Promise((resolve) => setTimeout(resolve, delay));

  const mapped = obsAction(action);
  if (mapped) {
    const client = await ensureObs();
    return client.execute(mapped[0], mapped[1]);
  }

  const type = String(action?.type || "");
  const settings = action?.settings && typeof action.settings === "object" ? action.settings : {};
  if (type === "obs.stream.toggle") {
    const client = await ensureObs();
    const status = await client.request("GetStreamStatus");
    return client.execute(status.outputActive ? "stream.stop" : "stream.start");
  }
  if (type === "obs.record.toggle") {
    const client = await ensureObs();
    const status = await client.request("GetRecordStatus");
    return client.execute(status.outputActive ? "record.stop" : "record.start");
  }
  if (type === "obs.virtualcam.toggle") {
    const client = await ensureObs();
    const status = await client.requestSafe("GetVirtualCamStatus");
    return client.execute(status.outputActive ? "virtualcam.stop" : "virtualcam.start");
  }
  if (type === "system.url") {
    const url = String(settings.url || settings.href || "").trim();
    if (!/^https?:\/\//i.test(url)) throw new Error("Touch-Deck-Webadresse ist ungültig.");
    await shell.openExternal(url);
    return { opened: true };
  }
  if (type === "tiktok.live-studio.launch") return liveStudio.launch();

  throw new Error(`Touch-Deck-Aktion wird noch nicht unterstützt: ${type || "ohne Typ"}`);
}

async function executeButton(payload) {
  const profile = deckStore.getProfile(payload.profileId) || deckStore.activeProfile();
  const folder = profile?.folders.find((item) => item.id === payload.folderId) || profile?.folders[0];
  const button = folder?.buttons?.[Number(payload.buttonIndex)];
  if (!button?.actions?.length) throw new Error("Diese Taste ist nicht belegt.");
  const results = [];
  for (const action of button.actions) results.push(await executeAction(action));
  return results;
}

async function initialize() {
  if (registered) return;
  registered = true;
  settingsStore = new SettingsStore(userDataFile("settings.json"));
  secretStore = new SecretStore(userDataFile("secrets.json"), safeStorage);
  await settingsStore.load();
  obs = new ObsWebSocketClient();
  liveStudio = new TikTokLiveStudioService();
  const settings = await settingsStore.get();
  liveStudio.configure({ executablePath: settings.platforms?.tiktok?.liveStudio?.executablePath || "" });

  deckStore = new DeckStore(userDataFile("deck-profiles.json"));
  pluginRegistry = new PluginRegistry({ stateFile: userDataFile("plugin-state.json") });
  pluginRegistry.scan();

  register("state:get", () => ({ deck: deckStore.snapshot(), plugins: pluginRegistry.snapshot() }));
  register("plugins:scan", () => pluginRegistry.scan());
  register("plugins:enable", (payload) => pluginRegistry.setEnabled(payload.pluginId, payload.enabled));
  register("plugins:settings", (payload) => pluginRegistry.saveSettings(payload.pluginId, payload.settings));

  register("deck:create-profile", (payload) => deckStore.createProfile(payload.name, payload.templateProfileId));
  register("deck:update-profile", (payload) => deckStore.updateProfile(payload.profileId, payload.patch));
  register("deck:delete-profile", (payload) => deckStore.deleteProfile(payload.profileId));
  register("deck:activate-profile", (payload) => deckStore.activateProfile(payload.profileId));
  register("deck:create-folder", (payload) => deckStore.createFolder(payload.profileId, payload.name, payload.parentId));
  register("deck:update-folder", (payload) => deckStore.updateFolder(payload.profileId, payload.folderId, payload.patch));
  register("deck:delete-folder", (payload) => deckStore.deleteFolder(payload.profileId, payload.folderId));
  register("deck:activate-folder", (payload) => deckStore.activateFolder(payload.profileId, payload.folderId));
  register("deck:update-button", (payload) => deckStore.updateButton(payload.profileId, payload.folderId, payload.buttonIndex, payload.button));
  register("deck:move-button", (payload) => deckStore.moveButton(payload.profileId, payload.folderId, payload.fromIndex, payload.toIndex));
  register("deck:clear-button", (payload) => deckStore.clearButton(payload.profileId, payload.folderId, payload.buttonIndex));
  register("deck:execute-button", executeButton);

  register("deck:export", async () => {
    const result = await dialog.showSaveDialog({
      title: "Touch-Deck exportieren",
      defaultPath: "Batto-OBS-Tool-Deck.json",
      filters: [{ name: "JSON", extensions: ["json"] }]
    });
    if (result.canceled || !result.filePath) return null;
    return deckStore.exportTo(result.filePath);
  });
  register("deck:import", async (payload) => {
    const result = await dialog.showOpenDialog({ title: "Touch-Deck importieren", properties: ["openFile"], filters: [{ name: "JSON", extensions: ["json"] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    return deckStore.importFrom(result.filePaths[0], payload.mode || "merge");
  });
}

app.whenReady().then(initialize).catch((error) => console.error("Touch-Deck-Runtime konnte nicht starten:", error));
app.on("before-quit", () => { void obs?.disconnect(); });

module.exports = { executeAction, initialize };
