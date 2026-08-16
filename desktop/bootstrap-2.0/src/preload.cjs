"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const CHANNELS = new Set([
  "state:get", "hardware:scan", "hardware:save-report", "internet:test", "cpu:test",
  "obs:connect", "obs:disconnect", "obs:refresh", "obs:call", "obs:record-test", "recommendation:build",
  "deck:create-profile", "deck:update-profile", "deck:delete-profile", "deck:activate-profile",
  "deck:create-folder", "deck:update-folder", "deck:delete-folder", "deck:activate-folder",
  "deck:update-button", "deck:move-button", "deck:clear-button", "deck:execute-button", "deck:export", "deck:import",
  "action:execute", "plugins:scan", "plugins:enable", "plugins:settings", "plugins:import",
  "mobile:status", "mobile:approve", "mobile:reject", "mobile:revoke", "mobile:regenerate-pin", "mobile:approval",
  "stream-overlay:status", "stream-overlay:open", "stream-overlay:copy-url", "stream-overlay:event", "stream-overlay:clear",
  "monitoring:open", "monitoring:copy-url", "holo:open", "holo:copy-url", "holo:message", "holo:clear",
  "chat:update-settings", "chat:twitch-connect", "chat:twitch-disconnect", "chat:twitch-send",
  "chat:youtube-connect", "chat:youtube-disconnect", "chat:clear", "chat:test", "chat:tts-skip", "chat:tts-clear",
  "guests:list", "guests:apply", "settings:update", "migration:run",
  "app:open-path", "app:open-url", "app:copy", "app:close"
]);

function invoke(channel, payload = {}) {
  if (!CHANNELS.has(channel)) return Promise.reject(new Error(`IPC-Kanal nicht erlaubt: ${channel}`));
  return ipcRenderer.invoke(channel, payload).then((response) => {
    if (!response?.ok) {
      const error = new Error(response?.error?.message || "Batto OBS Tool: unbekannter Fehler");
      error.code = response?.error?.code || "";
      error.name = response?.error?.name || "Error";
      throw error;
    }
    return response.value;
  });
}

contextBridge.exposeInMainWorld("batto", Object.freeze({
  invoke,
  onStateChanged(callback) {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("state:changed", listener);
    return () => ipcRenderer.removeListener("state:changed", listener);
  },
  onPairRequest(callback) {
    const listener = (_event, request) => callback(request);
    ipcRenderer.on("mobile:pair-request", listener);
    return () => ipcRenderer.removeListener("mobile:pair-request", listener);
  }
}));
