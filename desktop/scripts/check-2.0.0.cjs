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
  "src/renderer/integrated.js", "src/renderer/integrated.css",
  "src/renderer/touch-deck-pro-v2.js", "src/renderer/touch-deck-pro-v2.css",
  "src/renderer/multi-chat.html", "src/renderer/multi-chat.js", "src/renderer/multi-chat.css",
  "src/renderer/chat-overlay-controls.js", "src/renderer/assets/overview-bg.jpg", "src/renderer/assets/team-alpha-logo.svg",
  "src/services/common.cjs", "src/services/obs-websocket.cjs", "src/services/obs-chat-overlay.cjs",
  "src/services/mobile-bridge.cjs", "src/services/stream-overlay-server.cjs", "src/services/multi-chat.cjs",
  "src/services/plugin-registry.cjs", "src/services/native-plugin-additions.cjs", "src/services/action-executor.cjs",
  "src/services/deck-store.cjs", "src/services/migration.cjs", "src/services/piper-tts.cjs",
  "src/mobile/index.html", "src/mobile/styles.css", "src/mobile/app.js",
  "src/stream-overlay/editor.html", "src/stream-overlay/editor.css", "src/stream-overlay/editor.js",
  "src/stream-overlay/overlay.html", "src/stream-overlay/overlay.css", "src/stream-overlay/overlay.js",
  "src/stream-overlay/chat-overlay.html", "src/stream-overlay/chat-overlay.css", "src/stream-overlay/chat-overlay.js",
  "build/installer.nsh", "build/license.txt", "resources/team-logo.svg", "package.json"
];
required.forEach(read);

for (const relative of required.filter((entry) => /\.(?:cjs|js)$/.test(entry))) {
  const result = spawnSync(process.execPath, ["--check", path.join(root, relative)], { encoding: "utf8" });
  if (result.status !== 0) fail(`Syntaxfehler in ${relative}:\n${result.stderr || result.stdout}`);
}

let packageJson = {};
try { packageJson = JSON.parse(read("package.json") || "{}"); }
catch (error) { fail(`package.json ist ungültig: ${error.message}`); }
if (packageJson.name !== "batto-obs-tool") fail("package.json: Name muss batto-obs-tool sein.");
if (packageJson.version !== "2.0.0") fail("package.json: Version muss 2.0.0 sein.");
if (packageJson.main !== "src/main.cjs") fail("package.json: Haupteinstieg muss src/main.cjs sein.");
if (packageJson.build?.productName !== "Batto OBS Tool") fail("package.json: Produktname ist falsch.");
if (packageJson.build?.artifactName !== "Batto-OBS-Tool-Setup-${version}.${ext}") fail("Installer-Artefaktname ist falsch.");
if (packageJson.build?.nsis?.oneClick !== false) fail("Installer muss den Assistent-Modus verwenden.");
if (packageJson.build?.nsis?.allowToChangeInstallationDirectory !== true) fail("Installationsordner muss auswählbar sein.");
if (packageJson.build?.nsis?.runAfterFinish !== false) fail("Installer darf die App nicht automatisch starten.");
if (packageJson.build?.nsis?.include !== "build/installer.nsh") fail("Installer-Erweiterung fehlt.");
if (!packageJson.dependencies?.ws || !packageJson.dependencies?.qrcode) fail("WebSocket- oder QR-Abhängigkeit fehlt.");
forbidText(JSON.stringify(packageJson.build?.files || []), "modules/**/*", "Entfernte Module würden noch paketiert.");
forbidText(String(packageJson.scripts?.test || ""), "encoder-monitoring-overlay", "Entfernte Monitoring-Tests sind noch eingebunden.");
forbidText(String(packageJson.scripts?.test || ""), "twitch-holo-chat", "Entfernte Hologramm-Tests sind noch eingebunden.");

const main = read("src/main.cjs");
const preload = read("src/preload.cjs");
const index = read("src/renderer/index.html");
const styles = read("src/renderer/styles.css");
const integratedJs = read("src/renderer/integrated.js");
const integratedCss = read("src/renderer/integrated.css");
const touchDeck = read("src/renderer/touch-deck-pro-v2.js");
const pluginRegistry = read("src/services/plugin-registry.cjs");
const pluginAdditions = read("src/services/native-plugin-additions.cjs");
const actionExecutor = read("src/services/action-executor.cjs");
const deckStore = read("src/services/deck-store.cjs");
const migration = read("src/services/migration.cjs");
const multiChat = read("src/services/multi-chat.cjs");
const unifiedChat = read("src/renderer/multi-chat.js");
const streamEditor = read("src/stream-overlay/editor.js");
const streamOverlayCss = read("src/stream-overlay/overlay.css");
const mobileBridge = read("src/services/mobile-bridge.cjs");
const mobileHtml = read("src/mobile/index.html");
const obsClient = read("src/services/obs-websocket.cjs");
const piper = read("src/services/piper-tts.cjs");

requireText(main, "requestSingleInstanceLock", "Single-Instance-Sperre fehlt.");
requireText(main, /new MobileBridge\(/, "Handy-Brücke wird nicht gestartet.");
requireText(main, /new StreamOverlayServer\(/, "Stream-Overlay wird nicht gestartet.");
requireText(main, 'handle("obs:forget-password"', "Gespeichertes OBS-Passwort kann nicht gelöscht werden.");
requireText(main, "PiperTtsClient", "Piper-TTS ist nicht in der Hauptlaufzeit eingebunden.");
requireText(main, 'handle("tts:piper:voices"', "Piper-Stimmen-IPC fehlt.");
forbidText(main, /MonitoringOverlayServer|monitoring:open|monitoring:copy-url|monitoring:status/, "Encoder-/Hardware-Monitoring ist noch in der Laufzeit enthalten.");
forbidText(main, /TwitchHoloServer|holo:/, "Twitch-Hologramm ist noch in der Laufzeit enthalten.");
forbidText(main, /nodeIntegration:\s*true/, "Node-Integration ist im Renderer aktiviert.");

requireText(obsClient, /ws:\/\/\$\{formatted\}:\$\{/, "OBS-WebSocket-Adresse wird nicht gültig formatiert.");
requireText(obsClient, "127.0.0.1", "Lokaler OBS-Loopback fehlt.");
requireText(obsClient, "::1", "IPv6-Loopback fehlt.");
requireText(obsClient, "authentication(password", "OBS-WebSocket-Authentifizierung fehlt.");

requireText(index, "Version 2.0.0", "Hauptfenster zeigt nicht Version 2.0.0.");
requireText(index, "integrated.css", "Integrierte Styles werden nicht geladen.");
requireText(index, "integrated.js", "Integrierte Oberfläche wird nicht geladen.");
requireText(index, "overview-hero", "Übersichts-Hero wurde nicht für das Hintergrundbild vorbereitet.");
requireText(styles, "overview-bg.jpg", "Übersichts-Hintergrundbild ist nicht eingebunden.");
requireText(index, /Touch-Deck|data-page=["']deck["']|data-page-panel=["']deck["']/, "Touch-Deck Pro ist im Hauptfenster nicht erreichbar.");
forbidText(index, /Twitch-Hologramm|Monitoring-Overlay|Hardwarediagnose|Encoder-Empfehlung/i, "Entfernte Bereiche sind noch im Hauptfenster sichtbar.");
for (const label of ["Stream-Overlay", "Multi-Chat", "OBS Gäste", "Plugins", "Touch-Deck Pro", "Handy verbinden"]) {
  requireText(integratedJs, label, `Navigationsbereich fehlt: ${label}`);
}
requireText(integratedCss, "overflow-x: hidden", "Horizontaler Überlauf ist nicht abgesichert.");
requireText(integratedCss, "@media (max-width: 980px)", "Schmale Fenster werden nicht responsiv behandelt.");

requireText(streamOverlayCss, /background:\s*transparent\s*!important/, "Stream-Overlay ist nicht vollständig transparent.");
for (const token of [
  'addEventListener("contextmenu"', "function copySelected()", "function pasteElement()", "function duplicateSelected()",
  "function deleteSelected()", "function alignSelected(mode)", "function moveLayer(direction)"
]) requireText(streamEditor, token, `Stream-Overlay-Funktion fehlt: ${token}`);

requireText(deckStore, "rows * columns", "Variables Touch-Deck-Raster fehlt.");
requireText(deckStore, "moveButton", "Drag-and-drop-Datenoperation fehlt.");
requireText(deckStore, "delayMs", "Mehrfachaktions-Verzögerung fehlt.");
requireText(deckStore, "createPage(profileId, name)", "Touch-Deck-Seiten fehlen.");
forbidText(deckStore, /buttons\s*=\s*buttons\.slice\(0,\s*capacity\)/, "Rasterverkleinerung würde Belegungen löschen.");
requireText(touchDeck, 'id="tdp-pagebar"', "Touch-Deck-Seitenleiste fehlt.");
requireText(touchDeck, "Zeilen", "Touch-Deck-Zeileneinstellung fehlt.");
requireText(touchDeck, "Spalten", "Touch-Deck-Spalteneinstellung fehlt.");
forbidText(touchDeck, 'id="tdp-size"', "Tastengröße ist weiterhin als Rasteroption sichtbar.");
forbidText(touchDeck, 'id="tdp-gap"', "Tastenabstand ist weiterhin als Rasteroption sichtbar.");
forbidText(touchDeck, 'id="tdp-hide-unused"', "Unbenutzte-Tasten-Schalter ist weiterhin sichtbar.");
requireText(migration, "copyDirectoryMissing", "Nicht überschreibende Altdatenmigration fehlt.");

requireText(pluginRegistry, "EXTRA_BUILT_IN_PLUGINS", "Native Plugin-Kompatibilität wird nicht geladen.");
requireText(pluginRegistry, "importPackage(packageFile", "Originale .streamDeckPlugin-Pakete können nicht importiert werden.");
requireText(pluginRegistry, ".streamdeckplugin", "Stream-Deck-Dateierweiterung wird nicht geprüft.");
requireText(pluginRegistry, "sdkVersion:", "Stream-Deck-SDK-Metadaten werden nicht eingelesen.");
requireText(pluginRegistry, "supportedInMultiActions:", "Stream-Deck-Aktionsmetadaten fehlen.");
for (const name of [
  "YouTube Music Desktop Connector", "YouTube Ticker", "iCUE", "BambuLab Printer Monitor", "Spotify",
  "Volume Controller", "Discord Volume Mixer", "TikFinity", "TikTok LIVE Studio", "Polls, Word Clouds & Spinner Wheels"
]) requireText(pluginAdditions, name, `Native Plugin-Kompatibilität fehlt: ${name}`);
for (const action of ["icue.launch", "bambulab.launch", "spotify.launch", "volume.mixer", "youtube.music.open", "youtube.ticker.status"]) {
  requireText(actionExecutor, action, `Native Aktionslaufzeit fehlt: ${action}`);
}

requireText(multiChat, "persistSettings()", "Multi-Chat-Einstellungen werden nicht getrennt gespeichert.");
requireText(multiChat, 'stored.twitch.oauth = ""', "Twitch-Token würde unverschlüsselt gespeichert.");
requireText(multiChat, 'stored.youtube.apiKey = ""', "YouTube-Schlüssel würde unverschlüsselt gespeichert.");
requireText(unifiedChat, "Twitch-Rollenfarben", "Twitch-Rollenfarben fehlen im Unified Multi-Chat.");
requireText(unifiedChat, "subscriber", "Subscriber-Rollenfarbe fehlt.");
requireText(unifiedChat, "follower", "Follower-Rollenfarbe fehlt.");
requireText(unifiedChat, "piper", "Piper-TTS-Auswahl fehlt im Multi-Chat.");
requireText(preload, "contextBridge", "Sichere Electron-Brücke fehlt.");
requireText(preload, "piperVoices", "Piper-Stimmen-Brücke fehlt.");

requireText(piper, "/voices", "Piper-Stimmen-Endpunkt fehlt.");
requireText(piper, "/synthesize", "Piper-Synthese-Endpunkt fehlt.");
requireText(mobileBridge, "battoobstool://pair", "Batto-Kopplungsschema fehlt.");
requireText(mobileBridge, 'this.server.listen(port, "0.0.0.0")', "Handy-Server ist nicht im lokalen Netzwerk erreichbar.");
requireText(mobileBridge, "randomPin()", "Sechsstellige Handy-PIN fehlt.");
requireText(mobileBridge, "QRCode.toDataURL", "QR-Code-Erzeugung fehlt.");
requireText(mobileHtml, "Batto OBS Tool", "Mobile Oberfläche ist nicht korrekt benannt.");

const visible = [index, integratedJs, unifiedChat, mobileHtml, read("src/mobile/app.js"), read("src/stream-overlay/editor.html"), streamEditor].join("\n");
forbidText(visible, /\bCreator Hub\b/i, "Alte Produktbezeichnung ist in einer sichtbaren Oberfläche enthalten.");
forbidText(visible, /show-test-values|Testwerte anzeigen|createTestTelemetry/i, "Veröffentlichte Demo-/Testwerte-Funktion gefunden.");

if (errors.length) {
  console.error(`Batto OBS Tool 2.0.0 – ${errors.length} Prüfung(en) fehlgeschlagen:`);
  errors.forEach((error, indexValue) => console.error(`${indexValue + 1}. ${error}`));
  process.exit(1);
}

console.log(`Batto OBS Tool 2.0.0 – ${required.length} Dateien und finaler Produktionsumfang geprüft.`);
