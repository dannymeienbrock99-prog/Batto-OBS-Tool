"use strict";

const path = require("node:path");
const { app, ipcMain } = require("electron");
const { ModerationStore } = require("./moderation-store.cjs");

let store = null;
let registered = false;

async function ensureStore() {
  if (store) return store;
  store = new ModerationStore(path.join(app.getPath("userData"), "multi-chat-moderation.json"));
  await store.load();
  return store;
}

function register() {
  if (registered) return;
  registered = true;
  ipcMain.handle("moderation:get-state", async (_event, platform) => (await ensureStore()).snapshot(platform));
  ipcMain.handle("moderation:apply", async (_event, input) => (await ensureStore()).apply(input));
}

app.whenReady().then(async () => {
  await ensureStore();
  register();
}).catch((error) => console.error("Moderationsdienst konnte nicht starten:", error));

module.exports = { ensureModerationStore: ensureStore };
