"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");
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
  "src/main.cjs", "src/preload.cjs", "src/renderer/index.html", "src/renderer/styles.css", "src/renderer/app.js",
  "src/renderer/integrated.js", "src/renderer/integrated.css", "src/renderer/assets/team-alpha-logo.svg",
  "src/renderer/assets/team-alpha-logo.png", "src/renderer/assets/overview-dragon-pc.png",
  "src/services/hardware.cjs", "src/services/recommendation.cjs", "src/services/obs-websocket.cjs",
  "src/services/common.cjs", "src/services/deck-store.cjs", "src/services/plugin-registry.cjs",
  "src/services/native-plugin-additions.cjs", "src/services/action-executor.cjs", "src/services/migration.cjs",
  "src/services/stream-deck-plugin-host.cjs", "src/services/sotf-death-counter-client.cjs",
  "src/services/mobile-bridge.cjs", "src/services/multi-chat.cjs", "src/services/heart-rate-manager.cjs", "src/services/stream-overlay-server.cjs",
  "src/services/twitch-holo-server.cjs", "src/mobile/index.html", "src/mobile/styles.css", "src/mobile/app.js",
  "src/stream-overlay/editor.html", "src/stream-overlay/editor.css", "src/stream-overlay/editor.js",
  "src/stream-overlay/overlay.html", "src/stream-overlay/overlay.css", "src/stream-overlay/overlay.js",
  "src/stream-overlay/team-logo.svg", "src/stream-overlay/team-logo.png", "modules/encoder-monitoring-overlay/src/server.cjs",
  "modules/encoder-monitoring-overlay/src/telemetry.cjs", "modules/encoder-monitoring-overlay/web/overlay.css",
  "modules/twitch-holo-chat/web/overlay.html", "modules/twitch-holo-chat/web/overlay.js",
  "src/renderer/touch-deck-v3.js", "src/renderer/touch-deck-v3.css",
  "build/installer.nsh", "build/license.txt", "resources/team-logo.svg", "resources/team-logo.png",
  "resources/sotf-death-counter/CrazyBatto.SotfDeathCounter.dll", "resources/sotf-death-counter/manifest.json", "package.json"
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
if (packageJson.main !== "src/main.cjs") fail("package.json: Haupteinstieg muss src/main.cjs sein.");
if (packageJson.build?.productName !== "Batto OBS Tool") fail("package.json: Produktname ist falsch.");
if (packageJson.build?.nsis?.oneClick !== false) fail("Installer muss den Assistent-Modus verwenden.");
if (packageJson.build?.nsis?.allowToChangeInstallationDirectory !== true) fail("Installationsordner muss auswählbar sein.");
if (packageJson.build?.nsis?.runAfterFinish !== false) fail("Installer darf die App nicht automatisch starten.");
if (packageJson.build?.nsis?.include !== "build/installer.nsh") fail("Installer-Erweiterung fehlt.");
if (packageJson.build?.nsis?.createDesktopShortcut !== true) fail("Desktop-Verknüpfung muss installiert werden.");
if (packageJson.build?.nsis?.createStartMenuShortcut !== true) fail("Startmenü-Verknüpfung muss installiert werden.");
if (packageJson.build?.nsis?.shortcutName !== "Batto OBS Tool") fail("Name der Windows-Verknüpfung ist falsch.");
const extraResources = Array.isArray(packageJson.build?.extraResources) ? packageJson.build.extraResources : [];
for (const [from, to] of [
  ["resources/team-logo.png", "resources/team-logo.png"],
  ["resources/sotf-death-counter", "resources/sotf-death-counter"]
]) {
  if (!extraResources.some((entry) => entry?.from === from && entry?.to === to)) {
    fail(`Externe Windows-Ressource wird nicht korrekt gepackt: ${from}`);
  }
}
if (!packageJson.dependencies?.ws || !packageJson.dependencies?.qrcode || !packageJson.dependencies?.["adm-zip"]) fail("WebSocket-, ZIP- oder QR-Abhängigkeit fehlt.");
if (!String(packageJson.scripts?.test || "").includes("integrated-2.0.0.test.cjs")) fail("2.0.0-Integrationstest ist nicht eingebunden.");
if (!String(packageJson.scripts?.test || "").includes("cpu-efficiency.test.cjs")) fail("CPU-Effizienztest ist nicht eingebunden.");
if (!String(packageJson.scripts?.test || "").includes("heart-rate-manager.test.cjs")) fail("Herzfrequenztest ist nicht eingebunden.");
if (!String(packageJson.scripts?.test || "").includes("hologram-persistence-v2.test.cjs")) fail("Hologramm-Persistenztest ist nicht eingebunden.");

const expectedSotfDllSha256 = "170c59f26b543e7b8d9467263e7ae749c9a36eb7d45f25f56b306cbacd2bba3a";
const expectedSotfManifestSha256 = "2e8251e4ad1b78e9348c49e44f25120c742617260b835e6fb430a81c212e344c";
const sotfDllPath = path.join(root, "resources", "sotf-death-counter", "CrazyBatto.SotfDeathCounter.dll");
const sotfManifestPath = path.join(root, "resources", "sotf-death-counter", "manifest.json");
if (fs.existsSync(sotfDllPath)) {
  const actual = crypto.createHash("sha256").update(fs.readFileSync(sotfDllPath)).digest("hex");
  if (actual !== expectedSotfDllSha256) fail(`SOTF-DLL v0.3.3 besitzt eine falsche SHA-256-Prüfsumme: ${actual}`);
}
if (fs.existsSync(sotfManifestPath)) {
  const bytes = fs.readFileSync(sotfManifestPath);
  const actual = crypto.createHash("sha256").update(bytes).digest("hex");
  if (actual !== expectedSotfManifestSha256) fail(`SOTF-Manifest v0.3.3 besitzt eine falsche SHA-256-Prüfsumme: ${actual}`);
  try {
    const manifest = JSON.parse(bytes.toString("utf8"));
    if (manifest.id !== "CrazyBatto_SotfDeathCounter" || manifest.version !== "0.3.3") {
      fail("SOTF-Manifest muss CrazyBatto_SotfDeathCounter v0.3.3 beschreiben.");
    }
  } catch (error) { fail(`SOTF-Manifest ist ungültig: ${error.message}`); }
}

const main = read("src/main.cjs");
const preload = read("src/preload.cjs");
const index = read("src/renderer/index.html");
const appJs = read("src/renderer/app.js");
const integratedJs = read("src/renderer/integrated.js");
const integratedCss = read("src/renderer/integrated.css");
const mobileBridge = read("src/services/mobile-bridge.cjs");
const mobileHtml = read("src/mobile/index.html");
const mobileJs = read("src/mobile/app.js");
const pluginRegistry = read("src/services/plugin-registry.cjs");
const pluginAdditions = read("src/services/native-plugin-additions.cjs");
const actionExecutor = read("src/services/action-executor.cjs");
const deckStore = read("src/services/deck-store.cjs");
const migration = read("src/services/migration.cjs");
const multiChat = read("src/services/multi-chat.cjs");
const heartRate = read("src/services/heart-rate-manager.cjs");
const streamOverlayCss = read("src/stream-overlay/overlay.css");
const monitoringCss = read("modules/encoder-monitoring-overlay/web/overlay.css");
const hardware = read("src/services/hardware.cjs");
const obsClient = read("src/services/obs-websocket.cjs");
const streamDeckHost = read("src/services/stream-deck-plugin-host.cjs");
const sotfClient = read("src/services/sotf-death-counter-client.cjs");
const touchDeck = read("src/renderer/touch-deck-v3.js");
const touchDeckCss = read("src/renderer/touch-deck-v3.css");

requireText(main, "requestSingleInstanceLock", "Single-Instance-Sperre fehlt.");
requireText(main, /new MobileBridge\(/, "Handy-Brücke wird nicht gestartet.");
requireText(main, /new StreamOverlayServer\(/, "Stream-Overlay wird nicht gestartet.");
requireText(main, /new MonitoringOverlayServer\(/, "Monitoring-Overlay wird nicht gestartet.");
requireText(main, /new TwitchHoloServer\(/, "Twitch-Hologramm wird nicht gestartet.");
requireText(main, /new StreamDeckPluginHost\(/, "Elgato Plugin-Host wird nicht geladen.");
requireText(main, /new SotfDeathCounterClient\(/, "SOTF-Todeszähler wird nicht geladen.");
requireText(main, /new HeartRateManager\(/, "Herzfrequenzdienst wird nicht geladen.");
requireText(main, 'sampler?.sample?.(hardware)', "Hardware wird nicht an die Telemetrie übergeben.");
requireText(main, 'gpu: preferredGpu()', "Encoder-Empfehlung verwendet nicht die bevorzugte GPU.");
requireText(main, 'webContents.send("telemetry:changed", payload)', "Kompakter Telemetrie-IPC fehlt.");
requireText(main, "telemetryInFlight", "Schutz vor überlappenden Telemetrie-Abfragen fehlt.");
requireText(main, "backgroundThrottling: true", "Electron-Hintergrunddrosselung ist nicht explizit aktiv.");
requireText(main, 'handle("obs:forget-password"', "Gespeichertes OBS-Passwort kann nicht gelöscht werden.");
forbidText(main, /mobileBridge\s*=\s*null\s*;\s*\/\/.*deaktiv/i, "Handy-Brücke ist im Produktionscode deaktiviert.");

requireText(obsClient, /ws:\/\/\$\{formatted\}:\$\{/, "OBS-WebSocket-Adresse wird nicht gültig formatiert.");
requireText(obsClient, "127.0.0.1", "Lokaler OBS-Loopback fehlt.");
requireText(obsClient, "::1", "IPv6-Loopback fehlt.");
requireText(obsClient, "authentication(password", "OBS-WebSocket-Authentifizierung fehlt.");
requireText(hardware, "selectPreferredGpu", "Auswahl der dedizierten GPU fehlt.");
requireText(hardware, /score \+= 500/, "NVIDIA-GPU wird nicht bevorzugt.");
requireText(hardware, /score -= 1000/, "Integrierte GPU wird nicht abgewertet.");
requireText(hardware, "networkIntervalMs = 10000", "Netzwerkabfragen werden nicht ausreichend gecacht.");
requireText(hardware, "latencyIntervalMs = 30000", "Ping-Abfragen werden nicht ausreichend gedrosselt.");

requireText(index, "Version 2.0.0", "Hauptfenster zeigt nicht Version 2.0.0.");
requireText(index, "integrated.css", "Integrierte Styles werden nicht geladen.");
requireText(index, "integrated.js", "Integrierte Oberfläche wird nicht geladen.");
for (const label of ["Stream-Overlay", "Multi-Chat", "Herzfrequenz", "OBS Gäste", "SOTF Todeszähler", "Handy verbinden", "Übernahme & Diagnose"]) {
  requireText(integratedJs, label, `Navigationsbereich fehlt: ${label}`);
}
forbidText(integratedJs, /\[\s*["']plugins["']\s*,/, "Die separate Plugin-System-Seite ist noch registriert.");
forbidText(integratedJs, /Plugin-System/i, "Die entfernte Bezeichnung Plugin-System ist noch sichtbar.");
requireText(integratedCss, "overflow-x: hidden", "Horizontaler Überlauf ist nicht abgesichert.");
requireText(integratedCss, "@media (max-width: 980px)", "Schmale Fenster werden nicht responsiv behandelt.");

const visible = [index, appJs, integratedJs, mobileHtml, mobileJs, read("src/stream-overlay/editor.html"), read("src/stream-overlay/editor.js"), read("src/stream-overlay/overlay.html"), read("src/stream-overlay/overlay.js")].join("\n");
forbidText(visible, /Creator Hub/i, "Alte Produktbezeichnung ist in einer sichtbaren Oberfläche enthalten.");
forbidText(visible, /\bKandidat\b/i, "Alte Encoderbezeichnung „Kandidat“ ist sichtbar.");
forbidText(visible, /show-test-values|Testwerte anzeigen|createTestTelemetry/i, "Veröffentlichte Demo-/Testwerte-Funktion gefunden.");
forbidText(index, /Encorder/i, "Falsche Schreibweise „Encorder“ im Hauptfenster.");
forbidText(visible, /Touch-Deck Pro/i, "Der entfernte Produktbereich „Touch-Deck Pro“ ist noch sichtbar.");

requireText(streamOverlayCss, /background:\s*transparent\s*!important/, "Stream-Overlay ist nicht vollständig transparent.");
requireText(monitoringCss, /background:\s*transparent\s*!important/, "Monitoring-Overlay ist nicht vollständig transparent.");
forbidText(monitoringCss, /body[^}]*background:\s*#0[0-9a-f]{5}/i, "Monitoring-Overlay enthält einen vollflächigen dunklen Hintergrund.");

requireText(mobileBridge, "battoobstool://pair", "Neues Batto-Kopplungsschema fehlt.");
requireText(mobileBridge, "creatorhub://pair", "Kompatibles Kopplungsschema der alten APK fehlt.");
requireText(mobileBridge, 'this.server.listen(port, "0.0.0.0")', "Handy-Server ist nicht im lokalen Netzwerk erreichbar.");
requireText(mobileBridge, "randomPin()", "Sechsstellige Handy-PIN fehlt.");
requireText(mobileBridge, "QRCode.toDataURL", "QR-Code-Erzeugung fehlt.");
requireText(mobileHtml, "Batto OBS Tool", "Mobile Oberfläche ist nicht umbenannt.");

requireText(deckStore, "rows * columns", "Variables Touch-Deck-Raster fehlt.");
requireText(deckStore, "moveButton", "Drag-and-drop-Datenoperation fehlt.");
requireText(deckStore, "delayMs", "Mehrfachaktions-Verzögerung fehlt.");
requireText(deckStore, "layoutPreset", "Stream-Deck-Gerätepresets fehlen.");
requireText(deckStore, "buttonRadius", "Anpassbare Tastenecken fehlen.");
requireText(deckStore, "autoFit", "Automatisches Einpassen des Touch-Rasters fehlt.");
forbidText(deckStore, /buttons\s*=\s*buttons\.slice\(0,\s*capacity\)/, "Rasterverkleinerung würde Belegungen löschen.");
requireText(migration, "copyDirectoryMissing", "Nicht überschreibende Altdatenmigration fehlt.");
requireText(migration, "Creator Hub", "Legacy-Pfade werden nicht erkannt.");

requireText(pluginRegistry, "EXTRA_BUILT_IN_PLUGINS", "Zusätzliche native Plugin-Kompatibilität wird nicht geladen.");
for (const name of [
  "YouTube Music Desktop Connector", "YouTube Ticker", "iCUE", "BambuLab Printer Monitor", "Spotify",
  "Volume Controller", "Discord Volume Mixer", "TikFinity", "TikTok LIVE Studio", "Polls, Word Clouds & Spinner Wheels"
]) requireText(pluginAdditions, name, `Native Plugin-Kompatibilität fehlt: ${name}`);
for (const action of ["icue.launch", "bambulab.launch", "spotify.launch", "volume.mixer", "youtube.music.open", "youtube.ticker.status"]) {
  requireText(actionExecutor, action, `Native Aktionslaufzeit fehlt: ${action}`);
}
requireText(actionExecutor, "wird ohne passende Laufzeit nicht ausgeführt", "Unbekannte Plugin-Aktionen würden keinen klaren Fehler liefern.");
requireText(pluginRegistry, ".streamdeckplugin", "Import originaler .streamDeckPlugin-Pakete fehlt.");
requireText(pluginRegistry, "validateArchiveEntryName", "Sicherheitsprüfung für Plugin-Archive fehlt.");
requireText(streamDeckHost, 'event: "keyDown"', "Elgato keyDown-Ereignis fehlt.");
requireText(streamDeckHost, 'event: "keyUp"', "Elgato keyUp-Ereignis fehlt.");
requireText(streamDeckHost, 'event: "willAppear"', "Elgato willAppear-Ereignis fehlt.");
requireText(streamDeckHost, "scheduleSessionIdle", "Original-Plugins werden bei Inaktivität nicht beendet.");
requireText(streamDeckHost, "normalizedDeviceSize", "Original-Plugins erhalten kein dynamisches Touch-Raster.");
requireText(streamDeckHost, "createPropertyInspector", "Originale Elgato Property Inspectors werden nicht geöffnet.");
requireText(streamDeckHost, "registerPropertyInspector", "Elgato Property Inspector Registrierung fehlt.");
requireText(sotfClient, "api/v1/snapshot", "SOTF-Snapshot-Anbindung fehlt.");
requireText(sotfClient, "scheduleNextRefresh", "SOTF-Polling ist nicht adaptiv.");
requireText(touchDeck, 'mode = "run"', "Touch-Deck-Ausführenmodus fehlt.");
requireText(touchDeck, "finishTouchMove", "Berührbares Verschieben von Tasten fehlt.");
requireText(touchDeck, "assignActionToKey", "Direkte Tastenbelegung aus der Plugin-Bibliothek fehlt.");
requireText(touchDeck, "layoutPresets", "Touch-Deck-Gerätepresets fehlen in der Oberfläche.");
requireText(touchDeck, "ResizeObserver", "Touch-Raster passt sich nicht an den Monitor an.");
requireText(touchDeck, "plugins:property-inspector", "Touch-Deck öffnet keine originalen Plugin-Eigenschaften.");
forbidText(touchDeck, /Einstellungen als JSON|JSON-Textarea/i, "Plugin-Aktionen verlangen weiterhin eine JSON-Eingabe.");
requireText(touchDeckCss, "pointer: coarse", "Touch-Ziele für Touch-Monitore fehlen.");

requireText(multiChat, "persistSettings()", "Multi-Chat-Einstellungen werden nicht sicher getrennt gespeichert.");
requireText(multiChat, 'stored.twitch.oauth = ""', "Twitch-Token würde unverschlüsselt gespeichert.");
requireText(multiChat, 'stored.youtube.apiKey = ""', "YouTube-Schlüssel würde unverschlüsselt gespeichert.");
requireText(multiChat, "connectTikfinity", "Lokale TikFinity-Ereignisse werden nicht angebunden.");
requireText(multiChat, "listVoices", "Installierte Windows-Stimmen können nicht ausgewählt werden.");
requireText(heartRate, "wss://dev.pulsoid.net/api/v1/data/real_time", "Pulsoid-Echtzeitverbindung fehlt.");
requireText(heartRate, "parseBleHeartRate", "Bluetooth-Heart-Rate-Messwerte werden nicht ausgewertet.");
requireText(preload, "contextBridge", "Sichere Electron-Brücke fehlt.");
forbidText(main, /nodeIntegration:\s*true/, "Node-Integration ist im Renderer aktiviert.");
requireText(preload, "legacyState", "Bestehende 1.9-Oberfläche hat keine Kompatibilitätsschicht.");

if (errors.length) {
  console.error(`Batto OBS Tool 2.0.0 – ${errors.length} Prüfung(en) fehlgeschlagen:`);
  errors.forEach((error, indexValue) => console.error(`${indexValue + 1}. ${error}`));
  process.exit(1);
}

console.log(`Batto OBS Tool 2.0.0 – ${required.length} Dateien, ${syntaxFiles.length} Syntaxprüfungen und alle Produktionsregeln bestanden.`);
