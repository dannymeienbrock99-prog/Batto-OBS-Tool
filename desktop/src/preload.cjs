"use strict";

const { contextBridge, ipcRenderer } = require("electron");

function on(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld("batto", Object.freeze({
  getState: () => ipcRenderer.invoke("app:get-state"),
  saveSettings: (value) => ipcRenderer.invoke("settings:save", value),
  scanHardware: () => ipcRenderer.invoke("hardware:scan"),
  runInternetTest: () => ipcRenderer.invoke("internet:test"),
  runCpuLoadTest: (options) => ipcRenderer.invoke("diagnostics:cpu-load", options),
  connectObs: (options) => ipcRenderer.invoke("obs:connect", options),
  disconnectObs: () => ipcRenderer.invoke("obs:disconnect"),
  forgetObsPassword: () => ipcRenderer.invoke("obs:forget-password"),
  getObsSnapshot: () => ipcRenderer.invoke("obs:snapshot"),
  executeObs: (action, payload) => ipcRenderer.invoke("obs:execute", action, payload),
  runObsRecordingTest: (options) => ipcRenderer.invoke("obs:recording-test", options),
  buildRecommendation: (input) => ipcRenderer.invoke("recommendation:build", input),
  getMonitoringStatus: () => ipcRenderer.invoke("monitoring:status"),
  openMonitoringEditor: () => ipcRenderer.invoke("monitoring:open-editor"),
  copyMonitoringUrl: () => ipcRenderer.invoke("monitoring:copy-url"),
  getHoloStatus: () => ipcRenderer.invoke("holo:status"),
  openHoloEditor: () => ipcRenderer.invoke("holo:open-editor"),
  copyHoloUrl: () => ipcRenderer.invoke("holo:copy-url"),
  executeDeckAction: (assignment) => ipcRenderer.invoke("deck:execute", assignment),
  saveReport: (report) => ipcRenderer.invoke("dialog:save-report", report),
  chatHistory: (options) => ipcRenderer.invoke("chat:history", options),
  chatStatuses: () => ipcRenderer.invoke("chat:statuses"),
  chatConnect: (platform, config) => ipcRenderer.invoke("chat:connect", platform, config),
  chatDisconnect: (platform) => ipcRenderer.invoke("chat:disconnect", platform),
  chatClear: (platform) => ipcRenderer.invoke("unified-chat:clear", platform),
  chatToggleWindow: () => ipcRenderer.invoke("chat:toggle-window"),
  chatWindowStatus: () => ipcRenderer.invoke("chat:window-status"),
  setChatAlwaysOnTop: (value) => ipcRenderer.invoke("chat:window-always-on-top", value),
  saveCngConfig: (value) => ipcRenderer.invoke("cng:save-config", value),
  getCngConfig: () => ipcRenderer.invoke("cng:get-config"),
  getTtsConfig: () => ipcRenderer.invoke("tts:get-config"),
  saveTtsConfig: (value) => ipcRenderer.invoke("tts:save-config", value),
  onTelemetry: (callback) => on("telemetry:update", callback),
  onTelemetryError: (callback) => on("telemetry:error", callback),
  onObsStatusChanged: (callback) => on("obs:status-changed", callback),
  onChatMessages: (callback) => on("chat:messages", callback),
  onChatStatus: (callback) => on("chat:status", callback),
  onChatCleared: (callback) => on("chat:cleared", callback),
  onChatWindow: (callback) => on("chat:window", callback)
}));
