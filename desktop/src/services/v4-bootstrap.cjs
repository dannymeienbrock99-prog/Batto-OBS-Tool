"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const { app, BrowserWindow, clipboard, dialog, ipcMain, shell } = require("electron");
const { V4ConfigStore } = require("./v4-config-store.cjs");
const { V4LogStore } = require("./v4-log-store.cjs");
const { V4Operations } = require("./v4-operations.cjs");

let configStore = null;
let logStore = null;
let operations = null;
let registered = false;

async function ensureStores() {
  if (configStore && logStore) return { configStore, logStore, operations };
  const userData = app.getPath("userData");
  configStore = new V4ConfigStore(path.join(userData, "v4-module-config.json"));
  logStore = new V4LogStore(path.join(userData, "v4-logs.jsonl"));
  await Promise.all([configStore.load(), logStore.load()]);
  operations = new V4Operations({ userData, configStore, logStore });
  await operations.start();
  return { configStore, logStore, operations };
}

function broadcast(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send(channel, payload);
}

function register() {
  if (registered) return;
  registered = true;
  ipcMain.handle("v4:configs:get", async () => (await ensureStores()).configStore.snapshot());
  ipcMain.handle("v4:config:get", async (_event, id) => (await ensureStores()).configStore.get(id));
  ipcMain.handle("v4:config:save", async (_event, id, patch = {}) => {
    const stores = await ensureStores();
    const result = await stores.configStore.save(id, patch);
    await stores.logStore.append("settings", "info", `V4-Modul gespeichert: ${result.title}`, { module: id });
    broadcast("v4:config-changed", result);
    return result;
  });
  ipcMain.handle("v4:config:reset", async (_event, id) => {
    const stores = await ensureStores();
    const result = await stores.configStore.reset(id);
    await stores.logStore.append("settings", "info", `V4-Modul zurückgesetzt: ${result.title}`, { module: id });
    broadcast("v4:config-changed", result);
    return result;
  });
  ipcMain.handle("v4:module:test", async (_event, id) => (await ensureStores()).operations.moduleTest(id));

  ipcMain.handle("v4:media:list", async () => (await ensureStores()).operations.listMedia());
  ipcMain.handle("v4:media:open-folder", async () => {
    const stores = await ensureStores();
    const error = await shell.openPath(stores.operations.mediaRoot);
    if (error) throw new Error(error);
    return stores.operations.mediaRoot;
  });
  ipcMain.handle("v4:media:import", async () => {
    const stores = await ensureStores();
    const result = await dialog.showOpenDialog({
      title: "Medien für Batto OBS Tool auswählen",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "Unterstützte Medien", extensions: ["mp3","wav","ogg","mp4","webm","png","jpg","jpeg","webp","gif"] },
        { name: "Alle Dateien", extensions: ["*"] }
      ]
    });
    if (result.canceled) return { imported: [], files: await stores.operations.listMedia() };
    return stores.operations.importMedia(result.filePaths);
  });
  ipcMain.handle("v4:media:delete", async (_event, name) => (await ensureStores()).operations.deleteMedia(name));

  ipcMain.handle("v4:cohost:status", async () => {
    const stores = await ensureStores();
    return { ...stores.operations.status(), layout: require("./v4-operations.cjs").buildCohostLayout(stores.configStore.get("cohost").config) };
  });
  ipcMain.handle("v4:cohost:copy-url", async () => {
    const stores = await ensureStores();
    const url = stores.operations.status().cohostUrl;
    if (!url) throw new Error("Co-Host-HTTP-Anzeige ist nicht gestartet.");
    clipboard.writeText(url);
    return url;
  });
  ipcMain.handle("v4:cohost:open", async () => {
    const stores = await ensureStores();
    const url = stores.operations.status().cohostUrl;
    if (!url) throw new Error("Co-Host-HTTP-Anzeige ist nicht gestartet.");
    await shell.openExternal(url);
    return url;
  });

  ipcMain.handle("v4:live-tools:status", async () => (await ensureStores()).operations.liveToolsStatus());

  ipcMain.handle("v4:backup:export", async () => {
    const stores = await ensureStores();
    const result = await dialog.showSaveDialog({
      title: "Batto OBS Tool V4 – Backup exportieren",
      defaultPath: `Batto-OBS-Tool-V4-Backup-${new Date().toISOString().slice(0, 10)}.batto-backup.json`,
      filters: [{ name: "Batto V4 Backup", extensions: ["json"] }]
    });
    if (result.canceled || !result.filePath) return { saved: false };
    return stores.operations.writeBackup(result.filePath);
  });
  ipcMain.handle("v4:backup:import", async () => {
    const stores = await ensureStores();
    const result = await dialog.showOpenDialog({
      title: "Batto OBS Tool V4 – Backup importieren",
      properties: ["openFile"],
      filters: [{ name: "Batto V4 Backup", extensions: ["json"] }]
    });
    if (result.canceled || !result.filePaths[0]) return { restored: false };
    const restored = await stores.operations.restoreBackup(result.filePaths[0]);
    broadcast("v4:config-changed", stores.configStore.get("general"));
    return restored;
  });

  ipcMain.handle("v4:logs:list", async (_event, options = {}) => (await ensureStores()).logStore.list(options));
  ipcMain.handle("v4:logs:clear", async () => (await ensureStores()).logStore.clear());
  ipcMain.handle("v4:logs:export", async () => {
    const stores = await ensureStores();
    const result = await dialog.showSaveDialog({
      title: "Batto OBS Tool – Logs exportieren",
      defaultPath: `Batto-OBS-Tool-Logs-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }]
    });
    if (result.canceled || !result.filePath) return { saved: false };
    await fs.writeFile(result.filePath, JSON.stringify(stores.logStore.list({ limit: 2000 }), null, 2), "utf8");
    return { saved: true, filePath: result.filePath };
  });
}

app.whenReady().then(async () => {
  const stores = await ensureStores();
  register();
  await stores.logStore.append("general", "info", "V4-Konfigurationskern gestartet.");
}).catch((error) => console.error("V4-Konfigurationskern konnte nicht starten:", error));

app.on("before-quit", () => { void operations?.stop(); });

module.exports = { ensureV4Stores: ensureStores };
