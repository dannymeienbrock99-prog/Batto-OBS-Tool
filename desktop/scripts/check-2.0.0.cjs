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

const required = [
  "src/main.cjs",
  "src/preload.cjs",
  "src/renderer/index.html",
  "src/renderer/styles.css",
  "src/renderer/app.js",
  "src/renderer/assets/team-logo.svg",
  "src/mobile/index.html",
  "src/mobile/styles.css",
  "src/mobile/app.js",
  "src/mobile/team-logo.svg",
  "src/stream-overlay/overlay.html",
  "src/stream-overlay/overlay.css",
  "src/stream-overlay/overlay.js",
  "src/stream-overlay/editor.html",
  "src/stream-overlay/editor.css",
  "src/stream-overlay/editor.js",
  "src/stream-overlay/team-logo.svg",
  "src/services/obs-client-v2.cjs",
  "src/services/mobile-bridge-v2.cjs",
  "src/services/stream-overlay-server-v2.cjs",
  "src/services/multi-chat-v2.cjs",
  "src/services/plugin-registry-v2.cjs",
  "src/services/deck-manager-v2.cjs",
  "src/services/action-executor-v2.cjs",
  "src/services/migration-v2.cjs",
  "modules/encoder-monitoring-overlay/src/server.cjs",
  "modules/twitch-holo-chat/web/overlay.html",
  "build/installer.nsh",
  "resources/team-logo.svg"
];
required.forEach(read);

const syntaxFiles = required.filter((relative) => /\.(?:cjs|js)$/.test(relative));
for (const relative of syntaxFiles) {
  const result = spawnSync(process.execPath, ["--check", path.join(root, relative)], { encoding: "utf8" });
  if (result.status !== 0) fail(`Syntaxfehler in ${relative}:\n${result.stderr || result.stdout}`);
}

const packageJson = JSON.parse(read("package.json") || "{}");
if (packageJson.name !== "batto-obs-tool") fail("package.json: Name muss batto-obs-tool sein");
if (packageJson.version !== "2.0.0") fail("package.json: Version muss 2.0.0 sein");
if (packageJson.main !== "src/main.cjs") fail("package.json: Haupteinstieg muss src/main.cjs sein");
if (packageJson.productName !== "Batto OBS Tool") fail("package.json: Produktname ist falsch");
if (packageJson.build?.nsis?.oneClick !== false) fail("Installer muss Assistent-Modus verwenden");
if (packageJson.build?.nsis?.allowToChangeInstallationDirectory !== true) fail("Installationsordner muss auswählbar sein");
if (packageJson.build?.nsis?.runAfterFinish !== false) fail("Installer darf die App nicht automatisch starten");
if (!packageJson.dependencies?.ws || !packageJson.dependencies?.qrcode) fail("WebSocket- oder QR-Abhängigkeit fehlt");

const rendererHtml = read("src/renderer/index.html");
const rendererJs = read("src/renderer/app.js");
const preload = read("src/preload.cjs");
const main = read("src/main.cjs");
const mobileHtml = read("src/mobile/index.html");
const mobileJs = read("src/mobile/app.js");
const overlayHtml = read("src/stream-overlay/overlay.html");
const overlayJs = read("src/stream-overlay/overlay.js");
const pluginRegistry = read("src/services/plugin-registry-v2.cjs");

for (const id of [...rendererJs.matchAll(/\$\("([a-zA-Z0-9_-]+)"\)/g)].map((match) => match[1])) {
  if (!rendererHtml.includes(`id="${id}"`)) fail(`Renderer-Element fehlt: #${id}`);
}
for (const id of [...mobileJs.matchAll(/\$\("([a-zA-Z0-9_-]+)"\)/g)].map((match) => match[1])) {
  if (!mobileHtml.includes(`id="${id}"`)) fail(`Mobile-Element fehlt: #${id}`);
}

const visibleFiles = [rendererHtml, rendererJs, overlayHtml, overlayJs, read("src/stream-overlay/editor.html"), read("src/stream-overlay/editor.js"), mobileHtml, mobileJs];
if (visibleFiles.some((content) => /Creator[ -]?Hub/i.test(content))) fail("Alte Produktbezeichnung ist in einer sichtbaren Oberfläche enthalten");
if (visibleFiles.some((content) => /show-test-values|Testwerte anzeigen|createTestTelemetry/i.test(content))) fail("Veröffentlichte Demo-/Testwerte-Funktion gefunden");
if (!rendererHtml.includes("Monitoring-Overlay") || !rendererHtml.includes("Stream-Overlay") || !rendererHtml.includes("Multi-Chat") || !rendererHtml.includes("Handy verbinden")) fail("Integrierte Hauptnavigation ist unvollständig");
if (!rendererHtml.includes("Twitch-Hologramm") || !rendererHtml.includes("OBS-Gäste") || !rendererHtml.includes("Plugins")) fail("Alte und neue Funktionsbereiche sind nicht vollständig eingebunden");
if (!rendererHtml.includes("team-logo.svg") || !overlayHtml.includes("overlay")) fail("Team-Logo oder Overlay-Einstieg fehlt");
if (!mobileJs.includes("creatorhub://pair") && !main.includes("creatorhub://pair") && !read("src/services/mobile-bridge-v2.cjs").includes("creatorhub://pair")) fail("Kompatibles altes Kopplungsschema fehlt");
if (!read("src/services/mobile-bridge-v2.cjs").includes("battoobstool://pair")) fail("Neues Batto-Kopplungsschema fehlt");
if (!main.includes("requestSingleInstanceLock")) fail("Single-Instance-Sperre fehlt");
if (!main.includes("127.0.0.1")) fail("Lokale OBS-/Overlay-Bindung fehlt");
if (!preload.includes("contextBridge") || /nodeIntegration:\s*true/.test(main)) fail("Sichere Electron-Brücke ist nicht korrekt konfiguriert");

for (const requiredPlugin of [
  "OBS Studio", "Discord", "Discord Volume Mixer", "Advanced Launcher", "iCUE", "BambuLab Printer Monitor",
  "Spotify", "Volume Controller", "TikFinity", "TikTok LIVE Studio", "Twitch Giveaway",
  "YouTube Music Desktop Connector", "YouTube Ticker", "OBSBOT WebCam", "Polls, Word Clouds & Spinner Wheels"
]) if (!pluginRegistry.includes(requiredPlugin)) fail(`Native Plugin-Kompatibilität fehlt: ${requiredPlugin}`);

if (!read("src/services/deck-manager-v2.cjs").includes("Raster zu klein") || !read("src/services/deck-manager-v2.cjs").includes("moveButton")) fail("Touch-Deck-Datenschutz gegen verlorene Belegungen fehlt");
if (!read("src/services/stream-overlay-server-v2.cjs").includes('id: "team-logo"')) fail("Team-Logo ist nicht im Stream-Overlay-Standardlayout enthalten");
if (!read("src/services/migration-v2.cjs").includes("copyMissing")) fail("Sichere, nicht überschreibende Alt-Datenmigration fehlt");
if (!read("src/services/obs-client-v2.cjs").includes("authentication(password")) fail("OBS-WebSocket-Authentifizierung fehlt");

if (errors.length) {
  console.error(`Batto OBS Tool 2.0.0 – ${errors.length} Prüfung(en) fehlgeschlagen:`);
  errors.forEach((error, index) => console.error(`${index + 1}. ${error}`));
  process.exit(1);
}

console.log(`Batto OBS Tool 2.0.0 – ${required.length} Dateien, ${syntaxFiles.length} Syntaxprüfungen und alle Produktionsregeln bestanden.`);
