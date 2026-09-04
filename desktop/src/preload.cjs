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
  runInternetTest: () => ipcRenderer.invoke("internet:test"),
  connectObs: (options) => ipcRenderer.invoke("obs:connect", options),
  disconnectObs: () => ipcRenderer.invoke("obs:disconnect"),
  forgetObsPassword: () => ipcRenderer.invoke("obs:forget-password"),
  getObsSnapshot: () => ipcRenderer.invoke("obs:snapshot"),
  executeObs: (action, payload) => ipcRenderer.invoke("obs:execute", action, payload),
  getHoloStatus: () => ipcRenderer.invoke("holo:status"),
  openHoloEditor: () => ipcRenderer.invoke("holo:open-editor"),
  copyHoloUrl: () => ipcRenderer.invoke("holo:copy-url"),

  chatHistory: (options) => ipcRenderer.invoke("chat:history", options),
  chatStatuses: () => ipcRenderer.invoke("chat:statuses"),
  chatConnect: (platform, config) => ipcRenderer.invoke("chat:connect", platform, config),
  chatDisconnect: (platform) => ipcRenderer.invoke("chat:disconnect", platform),
  chatSend: (platform, message) => ipcRenderer.invoke("chat:send", platform, message),
  chatClear: (platform) => ipcRenderer.invoke("chat:unified-clear", platform),
  chatToggleWindow: () => ipcRenderer.invoke("chat:toggle-window"),
  chatWindowStatus: () => ipcRenderer.invoke("chat:window-status"),
  setChatAlwaysOnTop: (value) => ipcRenderer.invoke("chat:window-always-on-top", value),
  chatOverlayStatus: () => ipcRenderer.invoke("chat:overlay-status"),
  chatOverlayCopyUrl: () => ipcRenderer.invoke("chat:overlay-copy-url"),
  chatOverlayOpen: () => ipcRenderer.invoke("chat:overlay-open"),
  chatOverlayInstall: (config) => ipcRenderer.invoke("chat:overlay-install", config),
  chatOverlayRemove: () => ipcRenderer.invoke("chat:overlay-remove"),

  getModerationState: (platform) => ipcRenderer.invoke("moderation:get-state", platform),
  applyModeration: (input) => ipcRenderer.invoke("moderation:apply", input),

  getChatBotState: () => ipcRenderer.invoke("chatbot:get-state"),
  saveChatBotConfig: (value) => ipcRenderer.invoke("chatbot:save-config", value),
  testChatBotCommand: (commandId, platform) => ipcRenderer.invoke("chatbot:test-command", commandId, platform),
  testChatBotActions: (actions, context) => ipcRenderer.invoke("chatbot:test-actions", actions, context),
  triggerChatBotEvent: (trigger, payload) => ipcRenderer.invoke("chatbot:trigger-event", trigger, payload),
  openChatBotMediaFolder: () => ipcRenderer.invoke("chatbot:open-media-folder"),
  copyChatBotOverlayUrl: (channel) => ipcRenderer.invoke("chatbot:copy-overlay-url", channel),
  openChatBotOverlay: (channel) => ipcRenderer.invoke("chatbot:open-overlay", channel),

  saveCngConfig: (value) => ipcRenderer.invoke("cng:save-config", value),
  getCngConfig: () => ipcRenderer.invoke("cng:get-config"),
  getTtsConfig: () => ipcRenderer.invoke("tts:get-config"),
  saveTtsConfig: (value) => ipcRenderer.invoke("tts:save-config", value),

  onObsStatusChanged: (callback) => on("obs:status-changed", callback),
  onChatMessages: (callback) => on("chat:messages", callback),
  onChatStatus: (callback) => on("chat:status", callback),
  onChatCleared: (callback) => on("chat:cleared", callback),
  onChatWindow: (callback) => on("chat:window", callback),
  onChatBotLog: (callback) => on("chatbot:log", callback),
  onChatBotState: (callback) => on("chatbot:state", callback),
  onChatBotOverlay: (callback) => on("chatbot:overlay", callback)
}));

window.addEventListener("DOMContentLoaded", () => {
  const nav = document.querySelector(".sidebar nav");
  const content = document.querySelector("main.content");
  if (!nav || !content || document.getElementById("view-chatbot")) return;

  const style = document.createElement("link");
  style.rel = "stylesheet";
  style.href = "./chat-bot.css";
  document.head.appendChild(style);

  const button = document.createElement("button");
  button.className = "nav-button";
  button.dataset.view = "chatbot";
  button.innerHTML = "<span>⚡</span> Chat Bot";
  const settingsButton = nav.querySelector('[data-view="settings"]');
  nav.insertBefore(button, settingsButton || null);

  const section = document.createElement("section");
  section.id = "view-chatbot";
  section.className = "view";
  section.innerHTML = '<div id="batto-chatbot-root"><div class="chatbot-empty">Chat Bot wird geladen …</div></div>';
  content.appendChild(section);

  button.addEventListener("click", () => {
    document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view === section));
    document.querySelectorAll(".nav-button").forEach((item) => item.classList.toggle("active", item === button));
    const title = document.getElementById("page-title");
    const subtitle = document.getElementById("page-subtitle");
    if (title) title.textContent = "Chat Bot";
    if (subtitle) subtitle.textContent = "Auto-Broadcast, Commands, Hotkeys, Events, Medien, Discord und OBS-Overlays konfigurieren.";
  });

  const script = document.createElement("script");
  script.src = "./chat-bot.js";
  script.defer = true;
  document.body.appendChild(script);
});
