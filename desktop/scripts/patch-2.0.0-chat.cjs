"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

const legacyChat = path.join(root, "src", "services", "multi-chat-v2.cjs");
if (fs.existsSync(legacyChat)) {
  let content = fs.readFileSync(legacyChat, "utf8");
  const before = '        const nick = this.secrets.twitchOAuth ? `justinfan${Math.floor(Math.random() * 90000 + 10000)}` : `justinfan${Math.floor(Math.random() * 90000 + 10000)}`;';
  const after = '        const nick = this.secrets.twitchOAuth ? target : `justinfan${Math.floor(Math.random() * 90000 + 10000)}`;';
  if (content.includes(before)) {
    content = content.replace(before, after);
    fs.writeFileSync(legacyChat, content, "utf8");
  }
}

const preload = path.join(root, "src", "preload.cjs");
let preloadText = fs.readFileSync(preload, "utf8");
if (!preloadText.includes("chatHistory:")) {
  const marker = "  onStateChanged(callback) {";
  if (!preloadText.includes(marker)) throw new Error("Unified-Multi-Chat: Preload-Patchpunkt fehlt.");
  const bridge = `  chatHistory: (options) => ipcRenderer.invoke("chat:history", options),\n  chatStatuses: () => ipcRenderer.invoke("chat:statuses"),\n  chatConnect: (platform, config) => ipcRenderer.invoke("chat:connect", platform, config),\n  chatDisconnect: (platform) => ipcRenderer.invoke("chat:disconnect", platform),\n  chatClear: (platform) => ipcRenderer.invoke("chat:unified-clear", platform),\n  chatToggleWindow: () => ipcRenderer.invoke("chat:toggle-window"),\n  chatWindowStatus: () => ipcRenderer.invoke("chat:window-status"),\n  setChatAlwaysOnTop: (value) => ipcRenderer.invoke("chat:window-always-on-top", value),\n  saveCngConfig: (value) => ipcRenderer.invoke("cng:save-config", value),\n  getCngConfig: () => ipcRenderer.invoke("cng:get-config"),\n  getTtsConfig: () => ipcRenderer.invoke("tts:get-config"),\n  saveTtsConfig: (value) => ipcRenderer.invoke("tts:save-config", value),\n  onChatMessages: (callback) => on("chat:messages", callback),\n  onChatStatus: (callback) => on("chat:status", callback),\n  onChatCleared: (callback) => on("chat:cleared", callback),\n  onChatWindow: (callback) => on("chat:window", callback),\n`;
  preloadText = preloadText.replace(marker, bridge + marker);
  fs.writeFileSync(preload, preloadText, "utf8");
}

if (!preloadText.includes("chatOverlayStatus:")) {
  const marker = "  onStateChanged(callback) {";
  if (!preloadText.includes(marker)) throw new Error("OBS-Chat-Overlay: Preload-Patchpunkt fehlt.");
  const overlayBridge = `  chatOverlayStatus: () => ipcRenderer.invoke("chat:overlay-status"),\n  chatOverlayCopyUrl: () => ipcRenderer.invoke("chat:overlay-copy-url"),\n  chatOverlayOpen: () => ipcRenderer.invoke("chat:overlay-open"),\n  chatOverlayInstall: (config) => ipcRenderer.invoke("chat:overlay-install", config),\n  chatOverlayRemove: () => ipcRenderer.invoke("chat:overlay-remove"),\n`;
  preloadText = preloadText.replace(marker, overlayBridge + marker);
  fs.writeFileSync(preload, preloadText, "utf8");
}

const bootstrap = path.join(root, "src", "chat-bootstrap.cjs");
let bootstrapText = fs.readFileSync(bootstrap, "utf8");
bootstrapText = bootstrapText.replace('ipcMain.handle("chat:clear", (_event, platform)', 'ipcMain.handle("chat:unified-clear", (_event, platform)');
bootstrapText = bootstrapText.replace("if(document.getElementById('batto-multi-chat-dock'))return;", "if(document.getElementById('multi-chat-root')||document.getElementById('batto-multi-chat-dock'))return;");
fs.writeFileSync(bootstrap, bootstrapText, "utf8");

const multiChat = path.join(root, "src", "renderer", "multi-chat.js");
let multiChatText = fs.readFileSync(multiChat, "utf8");
multiChatText = multiChatText.replace('<label>OAuth-Token<input id="cfg-twitch-token" type="password" placeholder="oauth-…"></label>', '');
const oldHistory = '${state.history.length ? state.history.slice().reverse().slice(0,100).map((entry)=>`<div class="history-row"><span>${new Date(entry.timestamp).toLocaleString("de-DE")}</span><b>${esc(entry.username)}</b><span>${esc(entry.action)}</span><small>${esc(entry.reason || entry.lastMessage || "Kein Grund angegeben")}</small></div>`).join("") : \'<small>Noch keine Moderationsaktionen.</small>\'}';
const newHistory = '${state.history.length ? state.history.slice().reverse().slice(0,100).map((entry)=>`<div class="history-row"><span>${new Date(entry.timestamp).toLocaleString("de-DE")}</span><b>${esc(entry.username)}</b><span>${esc(entry.action)}</span><small>${esc(entry.reason || entry.lastMessage || "Kein Grund angegeben")}</small><span class="history-result ${entry.remoteApplied ? "platform" : "local"}">${entry.remoteApplied ? "Plattform" : "Lokal"}</span></div>`).join("") : \'<small>Noch keine Moderationsaktionen.</small>\'}';
if (multiChatText.includes(oldHistory)) multiChatText = multiChatText.replace(oldHistory, newHistory);
fs.writeFileSync(multiChat, multiChatText, "utf8");

for (const required of ["chatHistory:", "onChatWindow:", "chatOverlayInstall:", 'ipcMain.handle("chat:unified-clear"']) {
  const haystack = required.startsWith("ipcMain") ? bootstrapText : preloadText;
  if (!haystack.includes(required)) throw new Error(`Unified-Multi-Chat-Patch fehlt: ${required}`);
}
if (!bootstrapText.includes("document.getElementById('multi-chat-root')")) throw new Error("V4: Doppeltes eingebettetes Multi-Chat-Fenster ist nicht verhindert.");
if (multiChatText.includes("OAuth-Token")) throw new Error("V4: OAuth-Token-Feld ist weiterhin direkt im Multi-Chat sichtbar.");
if (!multiChatText.includes('entry.remoteApplied ? "Plattform" : "Lokal"')) throw new Error("V4: Moderationsverlauf kennzeichnet Plattform/Lokal nicht.");

console.log("Batto OBS Tool 2.0.0: V4 Multi-Chat korrigiert (kein Doppel-Dock, keine Token-Wand, Moderation Plattform/Lokal). ");
