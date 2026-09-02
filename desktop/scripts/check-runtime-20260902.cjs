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
  const text = fs.readFileSync(file, "utf8");
  if (!text.trim()) fail(`Datei ist leer: ${relative}`);
  return text;
}
function has(text, token, message) { if (!text.includes(token)) fail(message); }
function lacks(text, pattern, message) { if (pattern instanceof RegExp ? pattern.test(text) : text.includes(pattern)) fail(message); }

const required = [
  "src/main.cjs", "src/preload.cjs", "src/chat-bootstrap.cjs",
  "src/renderer/index.html", "src/renderer/styles.css", "src/renderer/integrated.js", "src/renderer/integrated.css",
  "src/renderer/touch-deck-classic.js", "src/renderer/touch-deck-classic.css",
  "src/renderer/multi-chat.html", "src/renderer/multi-chat.js", "src/renderer/multi-chat.css",
  "src/services/deck-store.cjs", "src/services/action-executor.cjs", "src/services/plugin-registry.cjs",
  "src/services/multi-chat.cjs", "src/services/piper-tts.cjs",
  "src/services/platforms/twitch-adapter.cjs", "src/services/platforms/tiktok-adapter.cjs",
  "src/services/obs-websocket.cjs", "src/services/stream-overlay-server.cjs",
  "src/stream-overlay/editor.js", "src/stream-overlay/overlay.js", "src/stream-overlay/overlay.css",
  "src/mobile/index.html", "src/mobile/app.js", "package.json"
];
const contents = Object.fromEntries(required.map((file) => [file, read(file)]));

for (const relative of required.filter((file) => /\.(?:js|cjs)$/.test(file))) {
  const result = spawnSync(process.execPath, ["--check", path.join(root, relative)], { encoding: "utf8" });
  if (result.status !== 0) fail(`Syntaxfehler in ${relative}: ${result.stderr || result.stdout}`);
}

let pkg = {};
try { pkg = JSON.parse(contents["package.json"] || "{}"); } catch (error) { fail(`package.json ungültig: ${error.message}`); }
if (pkg.version !== "2.0.0") fail("Version muss 2.0.0 sein.");
if (pkg.build?.artifactName !== "Batto-OBS-Tool-Setup-${version}.${ext}") fail("Installer-Artefaktname ist falsch.");
if (pkg.build?.nsis?.oneClick !== false || pkg.build?.nsis?.allowToChangeInstallationDirectory !== true) fail("NSIS-Assistent ist falsch konfiguriert.");

const index = contents["src/renderer/index.html"];
const integrated = contents["src/renderer/integrated.js"];
const classicDeck = contents["src/renderer/touch-deck-classic.js"];
const main = contents["src/main.cjs"];
const preload = contents["src/preload.cjs"];
const twitch = contents["src/services/platforms/twitch-adapter.cjs"];
const tiktok = contents["src/services/platforms/tiktok-adapter.cjs"];
const legacyChat = contents["src/services/multi-chat.cjs"];
const unifiedChat = contents["src/renderer/multi-chat.js"];
const overlay = contents["src/stream-overlay/overlay.js"];
const editor = contents["src/stream-overlay/editor.js"];
const deckStore = contents["src/services/deck-store.cjs"];
const actionExecutor = contents["src/services/action-executor.cjs"];
const pluginRegistry = contents["src/services/plugin-registry.cjs"];

has(index, "touch-deck-classic.css", "Classic Touch-Deck CSS ist nicht eingebunden.");
has(index, "touch-deck-classic.js", "Classic Touch-Deck JavaScript ist nicht eingebunden.");
lacks(index, /touch-deck-pro-v2/i, "Touch-Deck-Pro-Laufzeit ist noch eingebunden.");
lacks(integrated, /Touch-Deck Pro/, "Touch-Deck Pro ist noch sichtbar.");
has(integrated, "Touch-Deck", "Touch-Deck Navigation fehlt.");
has(classicDeck, "PROFILBASIERTES TOUCH-DECK", "Altes profilbasiertes Touch-Deck-Layout fehlt.");
has(classicDeck, "classic-deck-rows", "Touch-Deck Zeilen fehlen.");
has(classicDeck, "classic-deck-columns", "Touch-Deck Spalten fehlen.");
has(classicDeck, "deck:update-button", "Touch-Deck kann Tasten nicht speichern.");
has(classicDeck, "deck:execute-button", "Touch-Deck kann Tasten nicht ausführen.");
has(deckStore, "rows * columns", "Variables Touch-Deck-Raster fehlt.");
lacks(deckStore, /buttons\s*=\s*buttons\.slice\(0,\s*capacity\)/, "Rasterverkleinerung würde Tasten löschen.");

has(twitch, "anonymous-read-only", "Anonymer Twitch-Lesemodus fehlt.");
has(twitch, "justinfan", "Anonymer Twitch-Nickname fehlt.");
lacks(twitch, /config\.token|oauth:\$\{token\}|OAuth-Token/, "Twitch-Adapter verlangt noch OAuth.");
lacks(unifiedChat + integrated, /cfg-twitch-token|chat-twitch-token|OAuth-Token<input[^>]*twitch/i, "Twitch-Token-Feld ist noch sichtbar.");
lacks(legacyChat, /Zum Senden wird ein Twitch-OAuth-Token benötigt|oauth:\$\{oauth\}/, "Legacy MultiChat enthält noch aktiven Twitch-OAuth-Pfad.");
has(legacyChat, "absichtlich anonym", "Legacy MultiChat ist nicht als read-only abgesichert.");

has(tiktok, "processInitialData: false", "TikTok processInitialData Fix fehlt.");
has(tiktok, "fetchRoomInfoOnConnect: true", "TikTok Room-Initialisierung fehlt.");
has(tiktok, "userFrom(data", "TikTok v2 User-Daten-Normalisierung fehlt.");

has(overlay, "function applyViewport()", "Overlay-Ausrichtungsfunktion fehlt.");
has(overlay, "config.width", "Overlay verwendet die gespeicherte Breite nicht.");
has(overlay, "config.height", "Overlay verwendet die gespeicherte Höhe nicht.");
has(overlay, 'window.addEventListener("resize", applyViewport)', "Overlay reagiert nicht auf Browser-/OBS-Größenänderungen.");
has(editor, "config.orientation = height > width", "Overlay-Editor speichert Hoch-/Querformat nicht.");
has(editor, "save(false)", "Overlay-Editor speichert Ausrichtungsänderungen nicht.");

has(main, 'handle("guests:list"', "OBS-Gäste laden fehlt.");
has(main, 'handle("guests:apply"', "OBS-Gäste anwenden fehlt.");
has(main, "obs.getSceneItems", "OBS-Gäste lesen keine echten Scene Items.");
has(main, "obs.setSceneItemEnabled", "OBS-Gäste schalten keine echten Scene Items.");
has(preload, '"guests:list"', "OBS-Gäste IPC ist im Preload nicht freigegeben.");
has(preload, '"guests:apply"', "OBS-Gäste Apply IPC ist im Preload nicht freigegeben.");

for (const type of ["obs.stream.start", "obs.stream.stop", "obs.record.start", "obs.record.stop", "obs.virtualcam.start", "obs.virtualcam.stop", "obs.scene", "system.url"]) {
  has(actionExecutor, type, `Classic Touch-Deck Aktion fehlt: ${type}`);
}
has(pluginRegistry, "importPackage(packageFile", "Echter .streamDeckPlugin Import fehlt.");
has(pluginRegistry, ".streamdeckplugin", "StreamDeckPlugin Erweiterungsprüfung fehlt.");

has(main, "PiperTtsClient", "Piper TTS Runtime fehlt.");
lacks(main, /MonitoringOverlayServer|monitoring:open|monitoring:copy-url|monitoring:status/, "Entferntes Monitoring ist wieder in der Laufzeit.");
lacks(main, /TwitchHoloServer|holo:/, "Entferntes Twitch-Hologramm ist wieder in der Laufzeit.");
lacks(main, /nodeIntegration:\s*true/, "Unsichere Node-Integration ist aktiviert.");

if (errors.length) {
  console.error(`Batto OBS Tool 2.0.0 – ${errors.length} echte Laufzeitprüfung(en) fehlgeschlagen:`);
  errors.forEach((error, index) => console.error(`${index + 1}. ${error}`));
  process.exit(1);
}
console.log(`Batto OBS Tool 2.0.0 – Classic Deck, Chat, TikTok, Overlay, OBS Gäste und Installer-Laufzeit geprüft (${required.length} Dateien).`);
