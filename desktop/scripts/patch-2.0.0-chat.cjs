"use strict";

const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");

const preload = path.join(root, "src", "preload.cjs");
const bootstrap = path.join(root, "src", "chat-bootstrap.cjs");
const multiChat = path.join(root, "src", "renderer", "multi-chat.js");

let preloadText = fs.readFileSync(preload, "utf8");
let bootstrapText = fs.readFileSync(bootstrap, "utf8");
let multiChatText = fs.readFileSync(multiChat, "utf8");

bootstrapText = bootstrapText.replace('ipcMain.handle("chat:clear", (_event, platform)', 'ipcMain.handle("chat:unified-clear", (_event, platform)');
bootstrapText = bootstrapText.replace("if(document.getElementById('batto-multi-chat-dock'))return;", "if(document.getElementById('multi-chat-root')||document.getElementById('batto-multi-chat-dock'))return;");

const historyNeedle = '<small>${esc(entry.reason || entry.lastMessage || "Kein Grund angegeben")}</small></div>';
const historyReplacement = '<small>${esc(entry.reason || entry.lastMessage || "Kein Grund angegeben")}</small><span class="history-result ${entry.remoteApplied ? "platform" : "local"}">${entry.remoteApplied ? "Plattform" : "Lokal"}</span></div>';
if (!multiChatText.includes('entry.remoteApplied ? "Plattform" : "Lokal"') && multiChatText.includes(historyNeedle)) multiChatText = multiChatText.replace(historyNeedle, historyReplacement);

fs.writeFileSync(preload, preloadText, "utf8");
fs.writeFileSync(bootstrap, bootstrapText, "utf8");
fs.writeFileSync(multiChat, multiChatText, "utf8");

if (!preloadText.includes("chatHistory:") || !preloadText.includes("onChatWindow:") || !preloadText.includes("chatOverlayInstall:")) throw new Error("V4 Multi-Chat Preload-Bridge fehlt.");
if (!bootstrapText.includes('ipcMain.handle("chat:unified-clear"')) throw new Error("V4 Unified-Clear IPC fehlt.");
if (!bootstrapText.includes("document.getElementById('multi-chat-root')")) throw new Error("V4: Doppeltes Multi-Chat-Dock ist nicht verhindert.");
if (!multiChatText.includes('id="cfg-twitch-token"') || !multiChatText.includes('type="password"')) throw new Error("V4: Twitch-Authentifizierung ist im Multi-Chat nicht mehr bedienbar.");
if (!multiChatText.includes('entry.remoteApplied ? "Plattform" : "Lokal"')) throw new Error("V4: Moderationsverlauf kennzeichnet Plattform/Lokal nicht.");

console.log("Batto OBS Tool 2.0.0: V4 Multi-Chat korrigiert – kein Doppel-Dock, Twitch-Authentifizierung funktionsfähig, Moderation Plattform/Lokal.");
