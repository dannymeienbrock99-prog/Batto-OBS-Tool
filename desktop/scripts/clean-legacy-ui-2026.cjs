"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const indexFile = path.join(root, "src", "renderer", "index.html");
let html = fs.readFileSync(indexFile, "utf8").replace(/\r\n/g, "\n");

function removeBalancedBlock(source, openPattern, openTag, closeTag) {
  const match = source.match(openPattern);
  if (!match || match.index == null) return source;
  const start = match.index;
  const token = new RegExp(`<${openTag}\\b[^>]*>|<\\/${closeTag}>`, "gi");
  token.lastIndex = start + match[0].length;
  let depth = 1;
  let current;
  while ((current = token.exec(source))) {
    if (current[0].toLowerCase().startsWith(`</${closeTag}`)) depth -= 1;
    else depth += 1;
    if (depth === 0) return source.slice(0, start) + source.slice(token.lastIndex);
  }
  throw new Error(`Unvollständiger ${openTag}-Block ab Position ${start}.`);
}

function removeLegacyView(id) {
  const open = new RegExp(`<section\\b[^>]*\\bid=["']view-${id}["'][^>]*>`, "i");
  html = removeBalancedBlock(html, open, "section", "section");
}

function removeDivByClass(className) {
  const open = new RegExp(`<div\\b[^>]*\\bclass=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>`, "i");
  html = removeBalancedBlock(html, open, "div", "div");
}

for (const id of ["hardware", "internet", "recommendation", "loadtest", "monitoring", "holo"]) removeLegacyView(id);

for (const id of ["hardware", "internet", "recommendation", "loadtest", "monitoring", "holo"]) {
  html = html.replace(new RegExp(`\\s*<button\\b[^>]*\\bdata-view=["']${id}["'][^>]*>[\\s\\S]*?<\\/button>`, "gi"), "");
  html = html.replace(new RegExp(`\\s*<button\\b[^>]*\\bdata-jump=["']${id}["'][^>]*>[\\s\\S]*?<\\/button>`, "gi"), "");
}

html = html.replace(/\s*<button\b[^>]*\bid=["']overview-scan["'][^>]*>[\s\S]*?<\/button>/gi, "");
html = html.replace(/\s*<span\b[^>]*\bid=["']scan-pill["'][^>]*>[\s\S]*?<\/span>/gi, "");
removeDivByClass("summary-grid");
removeDivByClass("two-column-cards");

html = html.replace("Vom echten PC zur passenden OBS-Einstellung", "Streaming-Steuerung an einem Ort");
html = html.replace(/Die Windows-Diagnose liest Hardware lokal aus\.[\s\S]*?gekennzeichnet\./, "OBS, Multi-Chat, Stream-Overlay, Touch-Deck Pro, Plugins und Handy-Steuerung arbeiten gemeinsam in Batto OBS Tool.");
html = html.replace("PC erkennen, OBS prüfen und passende Einstellungen ermitteln.", "OBS, Chat, Overlays und Touch-Deck Pro zentral steuern.");

const forbidden = [
  /Hardwarediagnose/i,
  /Encoder-Empfehlung/i,
  /Monitoring-Overlay/i,
  /Twitch-Hologramm/i,
  /Belastungstest/i,
  /LIVE-MONITORING/i,
  /data-view=["'](?:hardware|internet|recommendation|loadtest|monitoring|holo)["']/i,
  /id=["']view-(?:hardware|internet|recommendation|loadtest|monitoring|holo)["']/i
];
for (const pattern of forbidden) {
  if (pattern.test(html)) throw new Error(`Alte Diagnose-/Monitoring-Oberfläche wurde nicht vollständig entfernt: ${pattern}`);
}

if (!/Touch-Deck/i.test(html)) throw new Error("Touch-Deck Pro ist nach der Bereinigung nicht mehr erreichbar.");
if (!/overview-hero/i.test(html)) throw new Error("Übersichts-Hintergrund ist nach der Bereinigung nicht aktiv.");

fs.writeFileSync(indexFile, html, "utf8");
console.log("Batto UI 2026: alte Diagnose-, Belastungs-, Monitoring- und Hologramm-Oberfläche vollständig entfernt.");
