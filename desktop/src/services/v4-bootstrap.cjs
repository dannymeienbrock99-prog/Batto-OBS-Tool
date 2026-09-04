"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { V4ConfigStore } = require("./v4-config-store.cjs");
const { V4LogStore } = require("./v4-log-store.cjs");

let configStore = null;
let logStore = null;
let registered = false;

async function ensureStores() {
  if (configStore && logStore) return { configStore, logStore };
  const userData = app.getPath("userData");
  configStore = new V4ConfigStore(path.join(userData, "v4-module-config.json"));
  logStore = new V4LogStore(path.join(userData, "v4-logs.jsonl"));
  await Promise.all([configStore.load(), logStore.load()]);
  return { configStore, logStore };
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

module.exports = { ensureV4Stores: ensureStores };
