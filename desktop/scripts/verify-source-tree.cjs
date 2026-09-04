"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const required = [
  "src/main-v2.cjs",
  "src/main.cjs",
  "src/preload.cjs",
  "src/chat-bootstrap.cjs",
  "src/deck-bootstrap.cjs",
  "src/stream-overlay-bootstrap.cjs",
  "src/services/common.cjs",
  "src/services/deck-store.cjs",
  "src/services/plugin-registry.cjs",
  "src/services/store.cjs",
  "src/services/secret-store.cjs",
  "src/services/obs-websocket.cjs",
  "src/services/connection-manager.cjs",
  "src/services/hybrid-runtime.cjs",
  "src/services/tiktok-live-studio.cjs",
  "src/services/stream-overlay-server.cjs",
  "src/services/platforms/tiktok-adapter.cjs",
  "src/services/platforms/twitch-adapter.cjs",
  "src/services/platforms/youtube-adapter.cjs",
  "src/services/platforms/cng-adapter.cjs",
  "src/renderer/index.html",
  "src/renderer/app.js",
  "src/renderer/commercial-settings.js",
  "src/renderer/commercial-settings.css",
  "src/renderer/multi-chat.js",
  "src/renderer/multi-chat.css",
  "src/renderer/touch-deck-20260802.js",
  "src/renderer/touch-deck-20260802.css",
  "src/renderer/integration-20260904.js",
  "src/renderer/integration-20260904.css",
  "src/stream-overlay/chat-overlay.html",
  "src/stream-overlay/chat-overlay.css",
  "src/stream-overlay/chat-overlay.js",
  "src/stream-overlay/editor.html",
  "src/stream-overlay/overlay.html",
  "src/stream-overlay/cohost-tiktok.html",
  "src/stream-overlay/cohost-twitch.html",
  "modules/twitch-holo-chat/web/font-editor-addon.js",
  "modules/twitch-holo-chat/web/font-overlay-addon.js"
];

for (const relative of required) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) throw new Error(`Produktionsdatei fehlt: ${relative}`);
  if (!fs.statSync(absolute).size) throw new Error(`Produktionsdatei ist leer: ${relative}`);
}

const syntaxFiles = required.filter((file) => /\.(?:cjs|js)$/.test(file));
for (const relative of syntaxFiles) {
  execFileSync(process.execPath, ["--check", path.join(root, relative)], { stdio: "pipe" });
}

const index = fs.readFileSync(path.join(root, "src", "renderer", "index.html"), "utf8");
for (const marker of [
  "touch-deck-20260802.css", "touch-deck-20260802.js",
  "integration-20260904.css", "integration-20260904.js",
  "commercial-settings.css", "commercial-settings.js",
  "multi-chat.css", "multi-chat.js",
  "view-overview", "view-obs", "multi-chat-root", "view-deck-0802", "view-moderation", "view-cohost", "view-holo", "view-settings"
]) {
  if (!index.includes(marker)) throw new Error(`Renderer-Einbindung fehlt: ${marker}`);
}
for (const forbidden of ["Hardwarediagnose", "Encoder- und Hardware-Monitoring", "settings-compat.js", "product-cleanup.js", "Touch-Deck Pro", "view-deck-pro", "touch-deck-pro-v2.js", "touch-deck-pro-v2.css"]) {
  if (index.includes(forbidden)) throw new Error(`Unerwünschte Alt-/Pro-UI ist noch eingebunden: ${forbidden}`);
}

const preload = fs.readFileSync(path.join(root, "src", "preload.cjs"), "utf8");
if (!preload.includes("SAFE_INVOKE_CHANNELS") || !preload.includes('"deck:execute-button"')) throw new Error("Touch-Deck IPC-Allowlist fehlt im Preload.");
if (!preload.includes("onStateChanged") || !preload.includes('ipcRenderer.invoke("chat:unified-clear"')) throw new Error("Touch-Deck/Multi-Chat Preload-Wiring ist unvollständig.");
for (const forbidden of ["hardware:scan", "diagnostics:cpu-load", "monitoring:status", "telemetry:update"]) {
  if (preload.includes(forbidden)) throw new Error(`Entfernte Diagnose-IPC ist noch im Preload: ${forbidden}`);
}

const entry = fs.readFileSync(path.join(root, "src", "main-v2.cjs"), "utf8");
for (const marker of ["stream-overlay-bootstrap.cjs", "deck-bootstrap.cjs", "chat-bootstrap.cjs"]) {
  if (!entry.includes(marker)) throw new Error(`2.1-Einstieg lädt Runtime-Modul nicht: ${marker}`);
}
if (/enrichHardware|SystemTelemetrySampler|collectHardware/.test(entry)) throw new Error("2.1-Einstieg darf keine Hardwarediagnose laden.");

const main = fs.readFileSync(path.join(root, "src", "main.cjs"), "utf8");
for (const forbidden of ["collectHardware", "SystemTelemetrySampler", "MonitoringOverlayServer", "hardware:scan", "diagnostics:cpu-load", "monitoring:status"]) {
  if (main.includes(forbidden)) throw new Error(`Hardware-/Monitoring-Runtime ist noch aktiv: ${forbidden}`);
}

const chat = fs.readFileSync(path.join(root, "src", "chat-bootstrap.cjs"), "utf8");
for (const marker of ["startStreamOverlay", "ensureChatObs", "twitch-oauth-token", "youtube-oauth-token"]) {
  if (!chat.includes(marker)) throw new Error(`Multi-Chat-Produktverdrahtung fehlt: ${marker}`);
}
const youtube = fs.readFileSync(path.join(root, "src", "services", "platforms", "youtube-adapter.cjs"), "utf8");
if (!youtube.includes("youtube/v3/liveChat/messages") || !youtube.includes("pollingIntervalMillis")) throw new Error("YouTube-Live-Chat-Transport ist nicht implementiert.");
const twitch = fs.readFileSync(path.join(root, "src", "services", "platforms", "twitch-adapter.cjs"), "utf8");
if (!twitch.includes("366") || !twitch.includes("Zeitüberschreitung beim Verbinden")) throw new Error("Twitch-Kanalbeitritt/Timeout ist nicht robust verdrahtet.");

const integration = fs.readFileSync(path.join(root, "src", "renderer", "integration-20260904.js"), "utf8");
for (const marker of ["ws://127.0.0.1:21213/", "Als Moderator hinzufügen", "Als Moderator entfernen", "Stummen", "Blockieren", "Entstummen", "Entblocken", "cohost-tiktok.html", "cohost-twitch.html"]) {
  if (!integration.includes(marker)) throw new Error(`Neue Produktfunktion fehlt: ${marker}`);
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
if (packageJson.main !== "src/main-v2.cjs") throw new Error("package.json muss src/main-v2.cjs als Programmeinstieg verwenden.");
if (packageJson.version !== "2.1.0") throw new Error(`Unerwartete Version: ${packageJson.version}`);
const prepareScript = String(packageJson.scripts?.["prepare:integrated"] || "");
if (prepareScript.includes("prepare-touch-deck-pro-v2")) throw new Error("Touch-Deck Pro wird noch beim Build injiziert.");
const files = JSON.stringify(packageJson.build?.files || []);
if (files.includes("encoder-monitoring-overlay")) throw new Error("Encoder-Monitoring wird noch ausgeliefert.");

console.log(`Sauberer diagnosefreier 2.1-Produktionsbaum geprüft: ${required.length} Dateien, ${syntaxFiles.length} Syntaxprüfungen OK.`);
