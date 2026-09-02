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

// Encoder-/Hardware-Monitoring und die alte Diagnose-/Empfehlungslaufzeit vollständig
// aus dem generierten Produktions-Mainprozess entfernen. Der Patch ist idempotent.
{
  const file = "src/main.cjs";
  let text = read(file).replace(/\r\n/g, "\n");

  text = text.replace(/const \{\n\s*collectHardware,\n\s*runCpuLoadTest,\n\s*runInternetTest,\n\s*SystemTelemetrySampler\n\} = require\("\.\/services\/hardware\.cjs"\);\n/, "");
  text = text.replace(/^const \{ buildRecommendation \} = require\("\.\/services\/recommendation\.cjs"\);\n/m, "");
  text = text.replace(/^const \{ MonitoringOverlayServer \} = require\([^\n]+\);\n/m, "");

  for (const declaration of [
    "let hardware = null;", "let internetResult = null;", "let recommendation = null;",
    "let latestTelemetry = null;", "let telemetryTimer = null;", "let monitoringServer = null;", "let sampler = null;"
  ]) text = text.replace(`${declaration}\n`, "");

  text = text.replace(/\nfunction monitoringStatus\(\) \{[\s\S]*?\n\}\n\nfunction sanitizedChatSnapshot/, "\nfunction sanitizedChatSnapshot");
  text = text.replace(/\n\s*hardware: hardware \|\| null,/, "");
  text = text.replace(/\n\s*internet: internetResult \|\| null,/, "");
  text = text.replace(/\n\s*recommendation: recommendation \|\| null,/, "");
  text = text.replace(/\n\s*telemetry: latestTelemetry,/, "");
  text = text.replace(/\n\s*monitoring: monitoringStatus\(\),/, "");

  text = text.replace(/\nfunction preferredGpu\(\) \{[\s\S]*?\nasync function startModules\(\) \{/, "\nasync function startModules() {");
  text = text.replace(/\n\s*const monitoringWeb = modulePath\([^\n]+\);\n\s*try \{\n\s*monitoringServer = new MonitoringOverlayServer\([\s\S]*?\n\s*\} catch \(error\) \{[^\n]*\}\n/, "\n");

  text = text.replace(/\n\s*handle\("hardware:scan"[^\n]*\n/, "\n");
  text = text.replace(/\n\s*handle\("hardware:save-report"[\s\S]*?\n\s*\}\);\n/, "\n");
  text = text.replace(/\n\s*handle\("internet:test"[^\n]*\n/, "\n");
  text = text.replace(/\n\s*handle\("cpu:test"[^\n]*\n/, "\n");
  text = text.replace(/\n\s*handle\("recommendation:build"[^\n]*\n/, "\n");
  text = text.replace(/\n\s*handle\("monitoring:status"[\s\S]*?handle\("monitoring:copy-url"[^\n]*\n/, "\n");

  text = text.replace(/\n\s*try \{ hardware = await collectHardware\(\); \} catch \(error\) \{ moduleErrors\.hardware = errorPayload\(error\); \}/, "");
  text = text.replace(/\n\s*sampler = new SystemTelemetrySampler\(\);/, "");
  text = text.replace(/\n\s*await buildEncoderRecommendation\(\{\}\);/, "");
  text = text.replace(/\n\s*await refreshTelemetry\(\);/, "");
  text = text.replace(/\n\s*telemetryTimer = setInterval\(refreshTelemetry, 1000\);\n\s*telemetryTimer\.unref\?\.\(\);/, "");
  text = text.replace(/\n\s*clearInterval\(telemetryTimer\);/, "");
  text = text.replace(/\n\s*try \{ await monitoringServer\?\.stop\?\.\(\); \} catch \{\}/, "");

  write(file, text);
}

removeIfExists("modules/encoder-monitoring-overlay");
removeIfExists("modules/twitch-holo-chat");

// Alte sichtbare Diagnose-, Monitoring- und Hologramm-Bereiche aus beiden UI-Generationen entfernen.
{
  const file = "src/renderer/index.html";
  let html = read(file);
  const legacyPages = ["hardware", "internet", "recommendation", "loadtest", "monitoring", "holo", "encoder", "load", "hologram"];

  for (const page of legacyPages) {
    html = html.replace(new RegExp(`\\s*<button[^>]*data-view=[\"']${page}[\"'][^>]*>[\\s\\S]*?<\\/button>`, "gi"), "");
    html = html.replace(new RegExp(`\\s*<button[^>]*data-jump=[\"']${page}[\"'][^>]*>[\\s\\S]*?<\\/button>`, "gi"), "");
    html = html.replace(new RegExp(`\\s*<button[^>]*data-page=[\"']${page}[\"'][^>]*>[\\s\\S]*?<\\/button>`, "gi"), "");
    html = html.replace(new RegExp(`\\s*<section[^>]*id=[\"']view-${page}[\"'][^>]*>[\\s\\S]*?<\\/section>`, "gi"), "");
    html = html.replace(new RegExp(`\\s*<section[^>]*data-page-panel=[\"']${page}[\"'][^>]*>[\\s\\S]*?<\\/section>`, "gi"), "");
  }

  html = html.replace(/\s*<button[^>]*id=[\"']overview-scan[\"'][^>]*>[\s\S]*?<\/button>/gi, "");
  html = html.replace(/\s*<span[^>]*id=[\"']scan-pill[\"'][^>]*>[\s\S]*?<\/span>/gi, "");
  html = html.replace(/\s*<div class=[\"']summary-grid[\"']>[\s\S]*?<\/div>\s*(?=<div class=[\"']two-column-cards[\"'])/i, "\n");
  html = html.replace(/\s*<div class=[\"']two-column-cards[\"']>[\s\S]*?<\/div>\s*(?=<\/section>)/i, "\n");
  html = html.replace("Vom echten PC zur passenden OBS-Einstellung", "Streaming-Steuerung an einem Ort");
  html = html.replace(/Die Windows-Diagnose liest Hardware lokal aus\.[\s\S]*?gekennzeichnet\./, "OBS, Multi-Chat, Stream-Overlay, Touch-Deck Pro, Plugins und Handy-Steuerung arbeiten gemeinsam in Batto OBS Tool.");
  html = html.replace("PC erkennen, OBS prüfen und passende Einstellungen ermitteln.", "OBS, Chat, Overlays und Touch-Deck Pro zentral steuern.");
  html = html.replace(/<p>Alle Funktionen laufen lokal\.[\s\S]*?<\/p>/, "<p>Alle Kernfunktionen laufen lokal: OBS, Multi-Chat, Stream-Overlay, Touch-Deck Pro, Plugins und Handy-Steuerung.</p>");
  html = html.replace(/<button[^>]*data-go=[\"']hardware[\"'][^>]*>[\s\S]*?<\/button>/gi, "");
  html = html.replace(/<button[^>]*data-action=[\"']monitoring:open[\"'][^>]*>[\s\S]*?<\/button>/gi, "");

  write(file, html);
}

{
  const packageFile = "package.json";
  const packageJson = JSON.parse(read(packageFile));
  packageJson.description = "Batto OBS Tool – OBS-Steuerung, Multi-Chat, Stream-Overlay, Touch-Deck Pro, Plugins und lokale Handy-Steuerung";
  if (packageJson.scripts?.test) {
    packageJson.scripts.test = packageJson.scripts.test
      .replace(/\s*modules\/encoder-monitoring-overlay\/test\/\*\.test\.cjs/g, "")
      .replace(/\s*modules\/twitch-holo-chat\/test\/\*\.test\.cjs/g, "");
  }
  if (Array.isArray(packageJson.build?.files)) packageJson.build.files = packageJson.build.files.filter((entry) => entry !== "modules/**/*");
  write(packageFile, JSON.stringify(packageJson, null, 2) + "\n");
}

{
  const production = path.join(root, "src", "services", "piper-tts.cjs");
  const bootstrap = path.join(root, "bootstrap-2.0", "src", "services", "piper-tts.cjs");
  if (fs.existsSync(production) && !fs.existsSync(bootstrap)) {
    fs.mkdirSync(path.dirname(bootstrap), { recursive: true });
    fs.copyFileSync(production, bootstrap);
  }
  if (fs.existsSync(bootstrap)) fs.copyFileSync(bootstrap, production);
}

requireMissing("src/main.cjs", [
  /MonitoringOverlayServer/, /monitoring:open/, /monitoring:copy-url/, /monitoring:status/,
  /SystemTelemetrySampler/, /refreshTelemetry/, /telemetryTimer/, /TwitchHoloServer/, /holo:/,
  /hardware:scan/, /hardware:save-report/, /internet:test/, /cpu:test/, /recommendation:build/
]);
requireMissing("src/renderer/index.html", [
  /Twitch-Hologramm/i, /Monitoring-Overlay/i, /Hardwarediagnose/i, /Encoder-Empfehlung/i,
  /Belastungstest/i, /LIVE-MONITORING/i, /data-view=["'](?:hardware|internet|recommendation|loadtest|monitoring|holo)["']/i
]);
requirePresent("src/renderer/index.html", [/Touch-Deck/i, /overview-hero/i]);
requirePresent("src/renderer/touch-deck-pro-v2.js", ['id="tdp-pagebar"', "addLibraryAction", "slice(newCapacity).filter(isUsed)"]);
requirePresent("src/services/plugin-registry.cjs", ["importPackage(packageFile", ".streamdeckplugin", "sdkVersion:", "supportedInMultiActions:"]);
requirePresent("src/services/native-plugin-additions.cjs", ["YouTube Music Desktop Connector", "TikFinity", "TikTok LIVE Studio", "Spotify", "Volume Controller"]);
requirePresent("src/services/action-executor.cjs", ["icue.launch", "bambulab.launch", "spotify.launch", "volume.mixer", "youtube.music.open", "youtube.ticker.status"]);
requirePresent("src/services/piper-tts.cjs", ["/voices", "/synthesize"]);

console.log("Batto OBS Tool 2.0.0: finaler Produktionsumfang ohne Hologramm/Monitoring angewendet und geprüft.");
