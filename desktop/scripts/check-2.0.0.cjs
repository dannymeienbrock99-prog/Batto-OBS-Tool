"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const errors = [];
const fail = (message) => errors.push(message);
const exists = (relative) => fs.existsSync(path.join(root, relative));
function read(relative) {
  const filename = path.join(root, relative);
  if (!fs.existsSync(filename)) { fail(`Datei fehlt: ${relative}`); return ""; }
  const text = fs.readFileSync(filename, "utf8");
  if (!text.trim()) fail(`Datei ist leer: ${relative}`);
  return text;
}
const must = (text, pattern, message) => { if (pattern instanceof RegExp ? !pattern.test(text) : !text.includes(pattern)) fail(message); };
const mustNot = (text, pattern, message) => { if (pattern instanceof RegExp ? pattern.test(text) : text.includes(pattern)) fail(message); };

const required = [
  "src/main.cjs","src/chat-bootstrap.cjs","src/preload.cjs","src/renderer/index.html","src/renderer/app.js","src/renderer/styles.css",
  "src/renderer/v4-shell.css","src/renderer/v4-settings.js","src/renderer/v4-settings.css","src/renderer/assets/HIntergund.png",
  "src/renderer/multi-chat.js","src/renderer/multi-chat.css","src/renderer/chat-bot.js","src/renderer/chat-bot.css",
  "src/services/chat-core.cjs","src/services/chat-bot.cjs","src/services/moderation-store.cjs","src/services/moderation-bootstrap.cjs",
  "src/services/v4-config-store.cjs","src/services/v4-log-store.cjs","src/services/v4-bootstrap.cjs","src/services/internet-test.cjs",
  "src/services/obs-websocket.cjs","src/services/obs-chat-overlay.cjs","src/services/store.cjs","src/services/twitch-holo-server.cjs",
  "test/v4-phase1.test.cjs","test/chat-bot.test.cjs","test/multi-chat.test.cjs","build/installer.nsh","build/license.txt","package.json"
];
for (const relative of required) read(relative);
for (const relative of required.filter((item) => /\.(?:cjs|js)$/.test(item))) {
  const result = spawnSync(process.execPath, ["--check", path.join(root, relative)], { encoding: "utf8" });
  if (result.status !== 0) fail(`Syntaxfehler in ${relative}: ${result.stderr || result.stdout}`);
}
for (const relative of ["src/renderer/assets/multi-chat-hero.jpg","src/services/hardware.cjs","src/services/recommendation.cjs","src/services/telemetry.cjs","modules/encoder-monitoring-overlay"]) if (exists(relative)) fail(`Entfernter Bereich ist wieder vorhanden: ${relative}`);

let pkg = {};
try { pkg = JSON.parse(read("package.json") || "{}"); } catch (error) { fail(`package.json ungültig: ${error.message}`); }
if (pkg.name !== "batto-obs-tool" || pkg.version !== "2.0.0" || pkg.main !== "src/chat-bootstrap.cjs") fail("Paketidentität/Programmeinstieg ist falsch.");
if (!String(pkg.scripts?.test || "").includes("v4-phase1.test.cjs")) fail("V4-Abnahmetest ist nicht eingebunden.");
if (JSON.stringify(pkg).includes("multi-chat-hero")) fail("Altes Multi-Chat-Bild ist noch im Paket enthalten.");

const main = read("src/main.cjs");
const bootstrap = read("src/chat-bootstrap.cjs");
const preload = read("src/preload.cjs");
const index = read("src/renderer/index.html");
const appJs = read("src/renderer/app.js");
const shell = read("src/renderer/v4-shell.css");
const settings = read("src/renderer/v4-settings.js");
const config = read("src/services/v4-config-store.cjs");
const multi = read("src/renderer/multi-chat.js");
const multiCss = read("src/renderer/multi-chat.css");
const moderation = read("src/services/moderation-store.cjs");
const bot = read("src/services/chat-bot.cjs");
const obs = read("src/services/obs-websocket.cjs");

must(main, "requestSingleInstanceLock", "Single-Instance-Sperre fehlt.");
must(main, "v4-bootstrap.cjs", "V4-Konfigurationskern wird nicht gestartet.");
must(main, "desktop-icon.jpg", "CRAZY_BATTO Desktop-/Programm-Icon wird nicht verwendet.");
must(main, "moderation-bootstrap.cjs", "Moderationsdienst wird nicht gestartet.");
mustNot(main, /collectHardware|hardware:scan|recommendation:build|diagnostics:cpu-load|obs:recording-test/, "Entfernte Hardware-/Encoder-/Belastungsfunktion ist im Hauptprozess zurück.");
mustNot(preload, /scanHardware|saveReport|hardware:scan|dialog:save-report/, "Hardwarediagnose-Bridge ist zurück.");
must(preload, "getV4Configs", "V4 Config Bridge fehlt.");
must(preload, "getModerationState", "Moderations-Bridge fehlt.");
must(shell, "HIntergund.png", "V4-Programm-Hintergrund fehlt.");
must(index, "v4-shell.css", "V4-Hintergrund wird nicht geladen.");
must(index, "v4-settings.js", "V4-Modul-Configs werden nicht geladen.");
for (const id of ["general","appearance","multichat","moderation","chatFilter","chatDesign","cohost","liveTools","platforms","chatbot","autoBroadcast","commands","hotkeys","events","media","mediaPools","tts","obsHttp","overlays","discord","statusbar","logs","backup","advanced"]) must(config, `\"${id}\"`, `V4-Modul fehlt: ${id}`);
for (const label of ["HILFE","TESTEN","ZURÜCKSETZEN","ÜBERNEHMEN","SPEICHERN"]) must(settings, label, `V4-Config-Button fehlt: ${label}`);
must(settings, "nicht als funktionierend simuliert", "Nicht verfügbare Module werden nicht sauber gekennzeichnet.");
must(bootstrap, /new ChatCore\(/, "Multi-Chat Core fehlt.");
must(bootstrap, /new ChatBotService\(/, "Chat Bot fehlt.");
must(bootstrap, "document.getElementById('multi-chat-root')", "Doppeltes Multi-Chat-Dock wird nicht verhindert.");
must(multi, "contextmenu", "Rechtsklick-Moderation fehlt.");
must(multi, "Als Moderator hinzufügen", "Moderator hinzufügen fehlt.");
must(multi, "Stummschalten", "Stummschalten fehlt.");
must(multi, "Blockieren", "Blockieren fehlt.");
must(multi, 'entry.remoteApplied ? "Plattform" : "Lokal"', "Moderationsverlauf unterscheidet Plattform/Lokal nicht.");
mustNot(multi, "OAuth-Token", "OAuth-Token wird direkt im Multi-Chat angezeigt.");
mustNot(multiCss, /multi-chat-hero/i, "V4-verbotenes Multi-Chat-Bild ist wieder eingebunden.");
for (const key of ["moderators","muted","blocked","history"]) must(moderation, key, `Moderationsspeicher fehlt: ${key}`);
must(bot, "/overlay/gifts", "Gift-Overlay fehlt.");
must(bot, "target.requireRunning", "Hotkey-Zielprozessprüfung fehlt.");
must(obs, "127.0.0.1", "Lokaler OBS-Host fehlt.");
must(obs, "::1", "OBS IPv6-Loopback fehlt.");

const visible = [index,appJs,settings,preload,main,multiCss].join("\n");
mustNot(visible, /Creator Hub/i, "Alte Produktbezeichnung ist sichtbar.");
mustNot(visible, /Hardwarediagnose|Hardware vollständig erfassen|PC vollständig scannen|PC jetzt scannen|Hardware-Scan|Windows-Diagnose|Encoder-Empfehlung|Realer Belastungs|Encoder- und Hardware-Monitoring|Monitoring-Overlay/i, "Entfernter Hardware-/Encoder-/Monitoring-Bereich ist sichtbar.");
mustNot(visible, /Touch[ -]?Deck|Stream[ -]?Deck|deck-pro|deckStore|DeckStore|deck:/i, "Verbotene Deck-Funktion ist im produktiven Code zurückgekehrt.");

if (errors.length) {
  console.error(`Batto OBS Tool 2.0.0 – ${errors.length} Prüfung(en) fehlgeschlagen:`);
  errors.forEach((error,index)=>console.error(`${index+1}. ${error}`));
  process.exit(1);
}
console.log(`Batto OBS Tool 2.0.0 – V4 Phase 1 Quellvertrag bestanden (${required.length} Kern-Dateien).`);
