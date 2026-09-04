"use strict";

const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const source = path.join(root, "src");

const indexFile = path.join(source, "renderer", "index.html");
if (!fs.existsSync(indexFile)) throw new Error("Hauptfenster fehlt.");
const packagePath = path.join(root, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
if (packageJson.version !== "2.0.0") throw new Error(`Falsche Paketversion: ${packageJson.version}`);
if (packageJson.main !== "src/chat-bootstrap.cjs") throw new Error(`Falscher Programmeinstieg: ${packageJson.main}`);
packageJson.build = packageJson.build || {};
packageJson.build.nsis = { ...(packageJson.build.nsis || {}), oneClick: false, allowToChangeInstallationDirectory: true, runAfterFinish: false, include: "build/installer.nsh" };
fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + "\n", "utf8");

const required = [
  "src/main.cjs",
  "src/chat-bootstrap.cjs",
  "src/preload.cjs",
  "src/renderer/index.html",
  "src/renderer/app.js",
  "src/renderer/styles.css",
  "src/renderer/assets/team-alpha-logo.svg",
  "src/renderer/assets/multi-chat-hero.jpg",
  "src/renderer/multi-chat.html",
  "src/renderer/multi-chat.js",
  "src/renderer/multi-chat.css",
  "src/renderer/chat-overlay-controls.js",
  "src/renderer/chat-bot.js",
  "src/renderer/chat-bot.css",
  "src/services/chat-bot.cjs",
  "src/services/chat-core.cjs",
  "src/services/hardware.cjs",
  "src/services/obs-websocket.cjs",
  "src/services/obs-chat-overlay.cjs",
  "src/services/store.cjs",
  "src/services/twitch-holo-server.cjs",
  "modules/twitch-holo-chat/web/overlay.html"
];
for (const relative of required) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).size) throw new Error(`Integrierte Datei fehlt oder ist leer: ${relative}`);
}

const forbiddenPaths = [
  "src/services/recommendation.cjs",
  "src/services/telemetry.cjs",
  "modules/encoder-monitoring-overlay"
];
for (const relative of forbiddenPaths) {
  if (fs.existsSync(path.join(root, relative))) throw new Error(`Entfernter Bereich ist wieder vorhanden: ${relative}`);
}

console.log(`Batto OBS Tool 2.0.0: ${required.length} Kernbestandteile geprüft; Monitoring, Encoder-Empfehlung und Belastungstests sind entfernt.`);
