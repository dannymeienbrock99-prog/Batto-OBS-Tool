"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const errors = [];
function fail(message) { errors.push(message); }
function read(relative) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) { fail(`Datei fehlt: ${relative}`); return ""; }
  const content = fs.readFileSync(file, "utf8");
  if (!content.trim()) fail(`Datei ist leer: ${relative}`);
  return content;
}
function requireText(content, pattern, message) { if (pattern instanceof RegExp ? !pattern.test(content) : !content.includes(pattern)) fail(message); }
function forbidText(content, pattern, message) { if (pattern instanceof RegExp ? pattern.test(content) : content.includes(pattern)) fail(message); }

const required = [
  "src/main.cjs", "src/chat-bootstrap.cjs", "src/preload.cjs",
  "src/renderer/index.html", "src/renderer/styles.css", "src/renderer/app.js",
  "src/renderer/v4-shell.css", "src/renderer/v4-settings.js", "src/renderer/v4-settings.css", "src/renderer/assets/HIntergund.png",
  "src/renderer/multi-chat.js", "src/renderer/multi-chat.css", "src/renderer/chat-bot.js", "src/renderer/chat-bot.css",
  "src/services/chat-core.cjs", "src/services/chat-bot.cjs", "src/services/moderation-store.cjs", "src/services/moderation-bootstrap.cjs",
  "src/services/v4-config-store.cjs", "src/services/v4-log-store.cjs", "src/services/v4-bootstrap.cjs",
  "src/services/platforms/twitch-adapter.cjs", "src/services/internet-test.cjs", "src/services/obs-websocket.cjs",
  "src/services/secret-store.cjs", "src/services/store.cjs", "src/services/twitch-holo-server.cjs",
  "test/v4-phase1.test.cjs", "test/chat-bot.test.cjs", "test/multi-chat.test.cjs", "modules/twitch-holo-chat/web/overlay.html", "modules/twitch-holo-chat/web/overlay.js",
  "build/installer.nsh", "build/license.txt", "package.json"
];
required.forEach(read);

const syntaxFiles = required.filter((relative) => /\.(?:cjs|js)$/.test(relative));
for (const relative of syntaxFiles) {
  const result = spawnSync(process.execPath, ["--check", path.join(root, relative)], { encoding: "utf8" });
  if (result.status !== 0) fail(`Syntaxfehler in ${relative}:\n${result.stderr || result.stdout}`);
}

for (const forbiddenPath of ["src/renderer/assets/multi-chat-hero.jpg", "src/services/hardware.cjs", "src/services/recommendation.cjs", "src/services/telemetry.cjs", "modules/encoder-monitoring-overlay"]) {
  if (fs.existsSync(path.join(root, forbiddenPath))) fail(`Entfernter Bereich ist wieder vorhanden: ${forbiddenPath}`);
}

let packageJson = {};
try { packageJson = JSON.parse(read("package.json") || "{}"); }
catch (error) { fail(`package.json ist ungültig: ${error.message}`); }
if (packageJson.name !== "batto-obs-tool") fail("package.json: Name muss batto-obs-tool sein.");
if (packageJson.version !== "2.0.0") fail("package.json: Version muss 2.0.0 sein.");
if (packageJson.main !== "src/chat-bootstrap.cjs") fail("package.json: Haupteinstieg muss src/chat-bootstrap.cjs sein.");
if (packageJson.build?.productName !== "Batto OBS Tool") fail("package.json: Produktname ist falsch.");
if (packageJson.build?.nsis?.oneClick !== false) fail("Installer muss den Assistent-Modus verwenden.");
if (packageJson.build?.nsis?.allowToChangeInstallationDirectory !== true) fail("Installationsordner muss auswählbar sein.");
if (packageJson.build?.nsis?.runAfterFinish !== false) fail("Installer darf die App nicht automatisch starten.");
if (!packageJson.dependencies?.ws) fail("WebSocket-Abhängigkeit fehlt.");
if (!String(packageJson.scripts?.test || "").includes("v4-phase1.test.cjs")) fail("V4-Abnahmetest ist nicht eingebunden.");
if (JSON.stringify(packageJson).includes("multi-chat-hero")) fail("Altes Multi-Chat-Bild ist noch in package.json enthalten.");

const main = read("src/main.cjs");
const bootstrap = read("src/chat-bootstrap.cjs");
const preload = read("src/preload.cjs");
const index = read("src/renderer/index.html");
const appJs = read("src/renderer/app.js");
const shellCss = read("src/renderer/v4-shell.css");
const settingsJs = read("src/renderer/v4-settings.js");
const v4Config = read("src/services/v4-config-store.cjs");
const multiChatJs = read("src/renderer/multi-chat.js");
const multiChatCss = read("src/renderer/multi-chat.css");
const chatBotJs = read("src/renderer/chat-bot.js");
const chatBotService = read("src/services/chat-bot.cjs");
const moderationStore = read("src/services/moderation-store.cjs");
const obsClient = read("src/services/obs-websocket.cjs");

requireText(main, "requestSingleInstanceLock", "Single-Instance-Sperre fehlt.");
requireText(main, /new TwitchHoloServer\(/, "Chat-Design/Hologramm-Server wird nicht gestartet.");
requireText(main, 'handle("obs:forget-password"', "Gespeichertes OBS-Passwort kann nicht gelöscht werden.");
requireText(main, "getObsClient", "Multi-Chat/Chat-Bot erhält keinen OBS-Laufzeitzugriff.");
requireText(main, "v4-bootstrap.cjs", "V4-Konfigurationskern wird nicht gestartet.");
requireText(main, "resources\", \"desktop-icon.jpg", "V4 Desktop-Icon wird im Hauptfenster nicht verwendet.");
forbidText(main, /nodeIntegration:\s*true/, "Node-Integration ist im Renderer aktiviert.");
forbidText(main, /collectHardware|hardware:scan|MonitoringOverlayServer|recommendation:build|diagnostics:cpu-load|obs:recording-test/, "Entfernte Hardwarediagnose-/Monitoring-/Empfehlungs-/Belastungstest-Funktion ist im Hauptprozess zurückgekehrt.");
forbidText(preload, /scanHardware|saveReport|hardware:scan|dialog:save-report/, "Hardwarediagnose-Bridge ist wieder vorhanden.");

requireText(shellCss, "HIntergund.png", "V4-Programm-Hintergrund wird nicht vollflächig eingebunden.");
requireText(index, "v4-shell.css", "V4-Hintergrund-Stylesheet fehlt im Hauptfenster.");
requireText(index, "v4-settings.js", "V4-Modul-Einstellungen werden nicht geladen.");
for (const moduleId of ["general","appearance","multichat","moderation","chatFilter","chatDesign","cohost","liveTools","platforms","chatbot","autoBroadcast","commands","hotkeys","events","media","mediaPools","tts","obsHttp","overlays","discord","statusbar","logs","backup","advanced"]) requireText(v4Config, `\"${moduleId}\"`, `V4-Modul fehlt: ${moduleId}`);
for (const action of ["HILFE","TESTEN","ZURÜCKSETZEN","ÜBERNEHMEN","SPEICHERN"]) requireText(settingsJs, action, `V4-Config-Button fehlt: ${action}`);
requireText(settingsJs, "nicht als funktionierend simuliert", "Nicht verfügbare Module werden nicht klar gekennzeichnet.");

requireText(bootstrap, /new ChatCore\(/, "Multi-Chat wird nicht gestartet.");
requireText(bootstrap, /new ChatBotService\(/, "Chat Bot wird nicht gestartet.");
requireText(bootstrap, 'ipcMain.handle("chatbot:get-state"', "Chat-Bot-IPC fehlt.");
requireText(bootstrap, "chatBot.ingestChat", "Chat-Nachrichten werden nicht an Commands übergeben.");
requireText(bootstrap, "document.getElementById('multi-chat-root')", "Doppeltes Multi-Chat-Dock wird nicht verhindert.");
requireText(main, "moderation-bootstrap.cjs", "Moderationsdienst wird nicht eingebunden.");
requireText(preload, "getChatBotState", "Chat-Bot-Bridge fehlt.");
requireText(preload, "getModerationState", "Moderations-Bridge fehlt.");
requireText(preload, "getV4Configs", "V4-Config-Bridge fehlt.");
requireText(index, 'data-view="multichat"', "Multi-Chat-Menüpunkt fehlt im Hauptfenster.");
requireText(index, 'id="view-multichat"', "Multi-Chat-Hauptansicht fehlt.");
requireText(multiChatJs, "contextmenu", "Rechtsklick-Moderationsmenü fehlt.");
requireText(multiChatJs, "Als Moderator hinzufügen", "Moderator-hinzufügen-Aktion fehlt.");
requireText(multiChatJs, "Als Moderator entfernen", "Moderator-entfernen-Aktion fehlt.");
requireText(multiChatJs, "Stummschalten", "Stummschalten-Aktion fehlt.");
requireText(multiChatJs, "Blockieren", "Blockieren-Aktion fehlt.");
requireText(multiChatJs, "moderation-history", "Moderationsverlauf fehlt.");
requireText(multiChatJs, 'entry.remoteApplied ? "Plattform" : "Lokal"', "Moderationsverlauf unterscheidet Plattform/Lokal nicht.");
forbidText(multiChatJs, "OAuth-Token", "OAuth-Token wird entgegen V4 direkt im Multi-Chat angezeigt.");
requireText(moderationStore, "moderators", "Moderatorliste fehlt im persistenten Moderationsspeicher.");
requireText(moderationStore, "muted", "Stummgeschaltete Liste fehlt im persistenten Moderationsspeicher.");
requireText(moderationStore, "blocked", "Blockierte Liste fehlt im persistenten Moderationsspeicher.");
forbidText(multiChatCss, /multi-chat-hero/i, "Das laut V4 verbotene alte Multi-Chat-Bild ist wieder eingebunden.");
requireText(chatBotJs, "BATTO CHAT BOT", "Chat-Bot-Oberfläche fehlt.");
requireText(chatBotService, "127.0.0.1", "Lokaler Chat-Bot-Overlay-Host fehlt.");
requireText(chatBotService, "/overlay/gifts", "Gift-Overlay-URL fehlt.");
requireText(chatBotService, "target.requireRunning", "Hotkey-Zielprozess-Sicherheitsprüfung fehlt.");

requireText(obsClient, "127.0.0.1", "Lokaler OBS-Loopback fehlt.");
requireText(obsClient, "::1", "IPv6-Loopback fehlt.");
requireText(obsClient, /function\s+obsAuthentication\s*\(password,\s*salt,\s*challenge\)/, "OBS-WebSocket-Authentifizierungsfunktion fehlt.");
requireText(obsClient, /identify\.authentication\s*=\s*obsAuthentication\(/, "OBS-WebSocket-Authentifizierung wird beim Identify nicht verwendet.");

const visible = [index, appJs, chatBotJs, settingsJs, preload, main, multiChatCss].join("\n");
forbidText(visible, /Creator Hub/i, "Alte Produktbezeichnung ist in der Oberfläche enthalten.");
forbidText(visible, /Hardwarediagnose|Hardware vollständig erfassen|PC vollständig scannen|PC jetzt scannen|Hardware-Scan|Windows-Diagnose|Encoder-Empfehlung|Realer Belastungs|Encoder- und Hardware-Monitoring|Monitoring-Overlay/i, "Entfernter Hardware-/Encoder-/Monitoring-/Belastungstest-Bereich ist wieder enthalten.");
forbidText(visible, /Touch[ -]?Deck|Stream[ -]?Deck|deck-pro|deckStore|DeckStore|deck:/i, "Verbotene Deck-Funktion ist im produktiven V4-Code zurückgekehrt.");

if (errors.length) {
  console.error(`Batto OBS Tool 2.0.0 – ${errors.length} Prüfung(en) fehlgeschlagen:`);
  errors.forEach((error, indexValue) => console.error(`${indexValue + 1}. ${error}`));
  process.exit(1);
}
console.log(`Batto OBS Tool 2.0.0 – ${required.length} Dateien und ${syntaxFiles.length} Syntaxprüfungen bestanden; V4 Phase 1 Vertrag erfüllt.`);
