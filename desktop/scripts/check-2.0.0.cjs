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
function requireText(content, pattern, message) {
  if (pattern instanceof RegExp ? !pattern.test(content) : !content.includes(pattern)) fail(message);
}
function forbidText(content, pattern, message) {
  if (pattern instanceof RegExp ? pattern.test(content) : content.includes(pattern)) fail(message);
}

const required = [
  "src/main.cjs", "src/chat-bootstrap.cjs", "src/preload.cjs",
  "src/renderer/index.html", "src/renderer/styles.css", "src/renderer/app.js",
  "src/renderer/multi-chat.js", "src/renderer/multi-chat.css", "src/renderer/chat-bot.js", "src/renderer/chat-bot.css",
  "src/renderer/assets/multi-chat-hero.jpg",
  "src/services/chat-core.cjs", "src/services/chat-bot.cjs", "src/services/platforms/twitch-adapter.cjs",
  "src/services/hardware.cjs", "src/services/obs-websocket.cjs", "src/services/recommendation.cjs",
  "src/services/secret-store.cjs", "src/services/store.cjs", "src/services/telemetry.cjs", "src/services/twitch-holo-server.cjs",
  "test/chat-bot.test.cjs",
  "modules/encoder-monitoring-overlay/src/server.cjs", "modules/encoder-monitoring-overlay/src/telemetry.cjs",
  "modules/encoder-monitoring-overlay/web/overlay.css", "modules/twitch-holo-chat/web/overlay.html", "modules/twitch-holo-chat/web/overlay.js",
  "build/installer.nsh", "build/license.txt", "package.json"
];

required.forEach(read);
const syntaxFiles = required.filter((relative) => /\.(?:cjs|js)$/.test(relative));
for (const relative of syntaxFiles) {
  const result = spawnSync(process.execPath, ["--check", path.join(root, relative)], { encoding: "utf8" });
  if (result.status !== 0) fail(`Syntaxfehler in ${relative}:\n${result.stderr || result.stdout}`);
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
if (!String(packageJson.scripts?.test || "").includes("chat-bot.test.cjs")) fail("Chat-Bot-Test ist nicht eingebunden.");

const main = read("src/main.cjs");
const bootstrap = read("src/chat-bootstrap.cjs");
const preload = read("src/preload.cjs");
const index = read("src/renderer/index.html");
const appJs = read("src/renderer/app.js");
const styles = read("src/renderer/styles.css");
const multiChatCss = read("src/renderer/multi-chat.css");
const chatBotJs = read("src/renderer/chat-bot.js");
const chatBotService = read("src/services/chat-bot.cjs");
const hardware = read("src/services/hardware.cjs");
const obsClient = read("src/services/obs-websocket.cjs");
const monitoringCss = read("modules/encoder-monitoring-overlay/web/overlay.css");

requireText(main, "requestSingleInstanceLock", "Single-Instance-Sperre fehlt.");
requireText(main, /new MonitoringOverlayServer\(/, "Monitoring-Overlay wird nicht gestartet.");
requireText(main, /new TwitchHoloServer\(/, "Twitch-Hologramm wird nicht gestartet.");
requireText(main, 'handle("obs:forget-password"', "Gespeichertes OBS-Passwort kann nicht gelöscht werden.");
requireText(main, "getObsClient", "Multi-Chat/Chat-Bot erhält keinen OBS-Laufzeitzugriff.");
forbidText(main, /nodeIntegration:\s*true/, "Node-Integration ist im Renderer aktiviert.");

requireText(bootstrap, /new ChatCore\(/, "Multi-Chat wird nicht gestartet.");
requireText(bootstrap, /new ChatBotService\(/, "Chat Bot wird nicht gestartet.");
requireText(bootstrap, 'ipcMain.handle("chatbot:get-state"', "Chat-Bot-IPC fehlt.");
requireText(bootstrap, "chatBot.ingestChat", "Chat-Nachrichten werden nicht an Commands übergeben.");
requireText(preload, "getChatBotState", "Chat-Bot-Bridge fehlt.");
requireText(preload, "view-chatbot", "Chat-Bot-Seite wird nicht in das Hauptfenster eingebunden.");
requireText(chatBotJs, "BATTO CHAT BOT", "Chat-Bot-Oberfläche fehlt.");
requireText(chatBotService, "127.0.0.1", "Lokaler Chat-Bot-Overlay-Host fehlt.");
requireText(chatBotService, "/overlay/gifts", "Gift-Overlay-URL fehlt.");
requireText(chatBotService, "target.requireRunning", "Hotkey-Zielprozess-Sicherheitsprüfung fehlt.");
requireText(multiChatCss, "multi-chat-hero.jpg", "Verbindliches Multi-Chat-Bild wird nicht angezeigt.");

requireText(obsClient, "127.0.0.1", "Lokaler OBS-Loopback fehlt.");
requireText(obsClient, "::1", "IPv6-Loopback fehlt.");
requireText(obsClient, "authentication(password", "OBS-WebSocket-Authentifizierung fehlt.");
requireText(hardware, "selectPreferredGpu", "Auswahl der dedizierten GPU fehlt.");
requireText(index, "Batto OBS Tool", "Produktname fehlt im Hauptfenster.");
requireText(preload, "contextBridge", "Sichere Electron-Brücke fehlt.");
requireText(styles, "overflow-x: hidden", "Horizontaler Überlauf ist nicht abgesichert.");
forbidText([index, appJs, chatBotJs].join("\n"), /Creator Hub/i, "Alte Produktbezeichnung ist in der Oberfläche enthalten.");
forbidText(index, /Encorder/i, "Falsche Schreibweise im Hauptfenster.");
requireText(monitoringCss, /background:\s*transparent\s*!important/, "Monitoring-Overlay ist nicht vollständig transparent.");

if (errors.length) {
  console.error(`Batto OBS Tool 2.0.0 – ${errors.length} Prüfung(en) fehlgeschlagen:`);
  errors.forEach((error, indexValue) => console.error(`${indexValue + 1}. ${error}`));
  process.exit(1);
}
console.log(`Batto OBS Tool 2.0.0 – ${required.length} Dateien und ${syntaxFiles.length} Syntaxprüfungen bestanden.`);
