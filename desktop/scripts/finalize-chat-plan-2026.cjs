"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const write = (relative, value) => fs.writeFileSync(path.join(root, relative), value, "utf8");
const removeIfExists = (relative) => fs.rmSync(path.join(root, relative), { recursive: true, force: true });

function requireMissing(relative, patterns) {
  const text = read(relative);
  for (const pattern of patterns) {
    if (pattern instanceof RegExp ? pattern.test(text) : text.includes(pattern)) throw new Error(`Veralteter Produktionsbestand in ${relative}: ${pattern}`);
  }
}

function requirePresent(relative, patterns) {
  const text = read(relative);
  for (const pattern of patterns) {
    if (pattern instanceof RegExp ? !pattern.test(text) : !text.includes(pattern)) throw new Error(`Erforderlicher Produktionsbestand fehlt in ${relative}: ${pattern}`);
  }
}

// Monitoring/Encoder-Hardware-Overlay vollständig aus der veröffentlichten Laufzeit entfernen.
{
  const file = "src/main.cjs";
  let text = read(file);
  text = text.replace(/^const \{ MonitoringOverlayServer \} = require\([^\n]+\);\n/m, "");
  text = text.replace(/^let monitoringServer = null;\n/m, "");
  text = text.replace(/\nfunction monitoringStatus\(\) \{[\s\S]*?\n\}\n\nfunction sanitizedChatSnapshot/, "\nfunction sanitizedChatSnapshot");
  text = text.replace(/\nfunction buildTelemetry\([\s\S]*?\n\}\n\nfunction publishMonitoring\([\s\S]*?\n\}\n\nasync function refreshTelemetry\([\s\S]*?\n\}\n\nasync function startModules/, "\nasync function startModules");
  text = text.replace(/\n\s*const monitoringWeb = modulePath\([^\n]+\);\n\s*try \{\n\s*monitoringServer = new MonitoringOverlayServer\([\s\S]*?\n\s*\} catch \(error\) \{[^\n]*\}\n/, "\n");
  text = text.replace(/\n\s*handle\("monitoring:status"[\s\S]*?handle\("monitoring:copy-url"[^\n]*\n/, "\n");
  text = text.replace(/\n\s*telemetry: latestTelemetry,/, "");
  text = text.replace(/\n\s*monitoring: monitoringStatus\(\),/, "");
  text = text.replace(/\nlet latestTelemetry = null;/, "");
  text = text.replace(/\nlet telemetryTimer = null;/, "");
  text = text.replace(/\nlet sampler = null;/, "");
  text = text.replace(/\n\s*hardware: hardware \|\| null,/, "");
  text = text.replace(/\n\s*internet: internetResult \|\| null,/, "");
  text = text.replace(/\n\s*recommendation: recommendation \|\| null,/, "");
  text = text.replace(/\n\s*modules: \{\n\s*streamOverlay:/, "\n    modules: {\n      streamOverlay:");
  write(file, text);
}

removeIfExists("modules/encoder-monitoring-overlay");

// Alte sichtbare Hologramm-, Hardware-, Encoder-, Belastungs- und Monitoring-Seiten aus der veröffentlichten Oberfläche entfernen.
{
  const file = "src/renderer/index.html";
  let html = read(file);
  for (const page of ["hardware", "internet", "encoder", "load", "monitoring", "hologram", "deck"]) {
    html = html.replace(new RegExp(`\\s*<button[^>]*(?:data-page|data-view)=[\"']${page}[\"'][^>]*>[\\s\\S]*?<\\/button>`, "gi"), "");
    html = html.replace(new RegExp(`\\s*<section[^>]*(?:data-page-panel|id)=[\"'](?:${page}|view-${page})[\"'][^>]*>[\\s\\S]*?<\\/section>`, "gi"), "");
  }
  html = html.replace(/<p>Alle Funktionen laufen lokal\.[\s\S]*?<\/p>/, "<p>Alle Kernfunktionen laufen lokal: OBS, Multi-Chat, Stream-Overlay, Touch-Deck Pro, Plugins und Handy-Steuerung.</p>");
  html = html.replace(/<button[^>]*data-go=[\"']hardware[\"'][^>]*>[\s\S]*?<\/button>/gi, "");
  html = html.replace(/<button[^>]*data-action=[\"']monitoring:open[\"'][^>]*>[\s\S]*?<\/button>/gi, "");
  html = html.replace(/<button[^>]*data-go=[\"']deck[\"'][^>]*>[\s\S]*?<\/button>/gi, "");
  write(file, html);
}

// Buildbeschreibung und Tests auf den echten veröffentlichten Umfang bringen.
{
  const packageFile = "package.json";
  const packageJson = JSON.parse(read(packageFile));
  packageJson.description = "Batto OBS Tool – OBS-Steuerung, Multi-Chat, Stream-Overlay, Touch-Deck Pro, Plugins und lokale Handy-Steuerung";
  if (packageJson.scripts?.test) {
    packageJson.scripts.test = packageJson.scripts.test.replace(/\s*modules\/encoder-monitoring-overlay\/test\/\*\.test\.cjs/g, "");
  }
  if (Array.isArray(packageJson.build?.files)) {
    packageJson.build.files = packageJson.build.files.filter((entry) => entry !== "modules/**/*");
  }
  write(packageFile, JSON.stringify(packageJson, null, 2) + "\n");
}

// Produktionsprüfung an die vereinbarten Funktionen koppeln.
{
  const file = "scripts/check-2.0.0.cjs";
  let text = read(file);
  text = text.replace(/,\s*"src\/services\/hardware\.cjs",\s*"src\/services\/recommendation\.cjs"/g, "");
  text = text.replace(/,\s*"modules\/encoder-monitoring-overlay\/src\/server\.cjs",\s*"modules\/encoder-monitoring-overlay\/src\/telemetry\.cjs",\s*"modules\/encoder-monitoring-overlay\/web\/overlay\.css"/g, "");
  text = text.replace(/const monitoringCss = read\([^\n]+\);\n/g, "");
  text = text.replace(/const hardware = read\([^\n]+\);\n/g, "");
  text = text.replace(/requireText\(main, \/new MonitoringOverlayServer[^\n]+\n/g, "");
  text = text.replace(/requireText\(main, 'sampler\?\.sample[^\n]+\n/g, "");
  text = text.replace(/requireText\(main, 'gpu: preferredGpu\(\)'[^\n]+\n/g, "");
  text = text.replace(/requireText\(hardware,[\s\S]*?Integrierte GPU wird nicht abgewertet\."\);\n/g, "");
  text = text.replace(/requireText\(monitoringCss,[\s\S]*?Monitoring-Overlay enthält einen vollflächigen dunklen Hintergrund\."\);\n/g, "");
  text += `\n// Final scope checks\nforbidText(main, /MonitoringOverlayServer|monitoring:open|monitoring:copy-url/, "Encoder-/Hardware-Monitoring ist noch in der Laufzeit enthalten.");\nforbidText(index, /Hardwarediagnose|Encoder-Empfehlung|Monitoring-Overlay|Twitch-Hologramm/, "Entfernte Bereiche sind noch im Hauptfenster sichtbar.");\nrequireText(touchDeck, 'id=\"tdp-pagebar\"', "Touch-Deck-Pro-Seitenleiste fehlt.");\nrequireText(pluginRegistry, ".streamdeckplugin", ".streamDeckPlugin-Unterstützung fehlt.");\n`;
  write(file, text);
}

// Piper-Datei muss in der Produktionsquelle existieren; HTTP-Service bleibt lokal und ohne gebündelten GPL-Binary.
{
  const from = path.join(root, "src", "services", "piper-tts.cjs");
  const bootstrap = path.join(root, "bootstrap-2.0", "src", "services", "piper-tts.cjs");
  if (fs.existsSync(from) && !fs.existsSync(bootstrap)) {
    fs.mkdirSync(path.dirname(bootstrap), { recursive: true });
    fs.copyFileSync(from, bootstrap);
  }
  if (fs.existsSync(bootstrap)) {
    fs.copyFileSync(bootstrap, from);
  }
}

requireMissing("src/main.cjs", [/MonitoringOverlayServer/, /monitoring:open/, /monitoring:copy-url/, /TwitchHoloServer/, /holo:/]);
requireMissing("src/renderer/index.html", [/Twitch-Hologramm/i, /Monitoring-Overlay/i, /Hardwarediagnose/i, /Encoder-Empfehlung/i]);
requirePresent("src/renderer/touch-deck-pro-v2.js", ['id="tdp-pagebar"', "addLibraryAction", "slice(newCapacity).filter(isUsed)"]);
requirePresent("src/services/plugin-registry.cjs", ["importPackage(packageFile", ".streamdeckplugin"]);
requirePresent("src/services/native-plugin-additions.cjs", ["YouTube Music Desktop Connector", "TikFinity", "TikTok LIVE Studio", "Spotify", "Volume Controller"]);
requirePresent("src/services/action-executor.cjs", ["icue.launch", "bambulab.launch", "spotify.launch", "volume.mixer", "youtube.music.open", "youtube.ticker.status"]);

console.log("Batto OBS Tool 2.0.0: finaler vereinbarter Produktionsumfang angewendet und geprüft.");
