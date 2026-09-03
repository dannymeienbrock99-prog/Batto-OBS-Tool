"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const htmlFile = path.join(root, "src", "renderer", "index.html");
let html = fs.readFileSync(htmlFile, "utf8");

const cssTag = '<link rel="stylesheet" href="./commercial-settings.css">';
const jsTag = '<script src="./commercial-settings.js"></script>';
const compatTag = '<script src="./settings-compat.js"></script>';
const cleanupTag = '<script src="./product-cleanup.js"></script>';

for (const name of ["hardware", "internet", "recommendation", "loadtest", "monitoring"]) {
  html = html.replace(new RegExp(`\\s*<button class="nav-button" data-view="${name}">[\\s\\S]*?<\\/button>`, "g"), "");
  html = html.replace(new RegExp(`\\s*<section id="view-${name}" class="view(?: full-height-view)?">[\\s\\S]*?<\\/section>`, "g"), "");
}

html = html
  .replace(/\\s*<span id="scan-pill"[\\s\\S]*?<\\/span>/g, "")
  .replace(/\\s*<button id="overview-scan"[\\s\\S]*?<\\/button>/g, "")
  .replace(/\\s*<button data-jump="recommendation">[\\s\\S]*?<\\/button>/g, "")
  .replace(/\\s*<button data-jump="monitoring">[\\s\\S]*?<\\/button>/g, "");

for (const id of ["summary-cpu", "summary-gpu", "summary-ram", "summary-board", "summary-upload"]) {
  html = html.replace(new RegExp(`\\s*<article class="summary-card">(?=[\\s\\S]*?id="${id}")[\\s\\S]*?<\\/article>`, "g"), "");
}

html = html.replace(/\\s*<article class="panel">(?=[\\s\\S]*?LIVE-MONITORING)[\\s\\S]*?<\\/article>/g, "");
html = html
  .replace("Vom echten PC zur passenden OBS-Einstellung", "OBS, TikTok und Multi-Chat zentral steuern")
  .replace("Die Windows-Diagnose liest Hardware lokal aus. Werte, die Windows oder der Treiber nicht zuverlässig liefert, bleiben als „Nicht verfügbar“ gekennzeichnet.", "Keine Hardwarediagnose. Die Anwendung konzentriert sich auf OBS, TikTok LIVE Studio/API, Multi-Chat, Touch-Deck und Overlays.")
  .replace("PC erkennen, OBS prüfen und passende Einstellungen ermitteln.", "OBS, TikTok, Multi-Chat, Touch-Deck und Overlays an einem Ort.");

if (!html.includes(cssTag)) {
  const marker = '<link rel="stylesheet" href="./styles.css">';
  if (!html.includes(marker)) throw new Error("styles.css marker missing in renderer/index.html");
  html = html.replace(marker, `${marker}\n    ${cssTag}`);
}

if (!html.includes(jsTag)) {
  const marker = "</body>";
  if (!html.includes(marker)) throw new Error("body closing tag missing in renderer/index.html");
  html = html.replace(marker, `  ${jsTag}\n  ${compatTag}\n  ${cleanupTag}\n  ${marker}`);
} else {
  if (!html.includes(compatTag)) html = html.replace(jsTag, `${jsTag}\n  ${compatTag}`);
  if (!html.includes(cleanupTag)) html = html.replace(compatTag, `${compatTag}\n  ${cleanupTag}`);
}

html = html
  .replaceAll("BATTO OBS TOOL 1.9.1", "BATTO OBS TOOL 2.1.0")
  .replaceAll("Version 1.9.1", "Version 2.1.0");

for (const forbidden of ["Hardwarediagnose", "PC vollständig scannen", "Encoder- und Hardware-Monitoring", "CPU-Belastungstest"]) {
  if (html.includes(forbidden)) throw new Error(`Diagnose-UI wurde nicht vollständig entfernt: ${forbidden}`);
}

fs.writeFileSync(htmlFile, html, "utf8");
console.log("Commercial settings integrated; diagnostics UI stripped from packaged renderer.");
