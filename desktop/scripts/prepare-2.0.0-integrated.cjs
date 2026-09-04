"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = path.join(root, "src");
const assets = path.join(source, "renderer", "assets");

const backgroundParts = [1, 2, 3, 4].map((number) => path.join(assets, `HIntergund-part-${String(number).padStart(2, "0")}.txt`));
for (const filename of backgroundParts) {
  if (!fs.existsSync(filename)) throw new Error(`V4-Hintergrundquelle fehlt: ${path.basename(filename)}`);
}
const backgroundBase64 = backgroundParts.map((filename) => fs.readFileSync(filename, "utf8").replace(/\s+/g, "")).join("");
const backgroundBuffer = Buffer.from(backgroundBase64, "base64");
if (backgroundBuffer.length < 10000 || backgroundBuffer[0] !== 0xff || backgroundBuffer[1] !== 0xd8) throw new Error("V4-Programm-Hintergrund konnte nicht rekonstruiert werden.");
fs.writeFileSync(path.join(assets, "HIntergund.png"), backgroundBuffer);

const indexFile = path.join(source, "renderer", "index.html");
if (!fs.existsSync(indexFile)) throw new Error("Hauptfenster fehlt.");
const index = fs.readFileSync(indexFile, "utf8").replaceAll("1.9.1", "2.0.0");
fs.writeFileSync(indexFile, index, "utf8");

const packagePath = path.join(root, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
if (packageJson.version !== "2.0.0") throw new Error(`Falsche Paketversion: ${packageJson.version}`);
if (packageJson.main !== "src/chat-bootstrap.cjs") throw new Error(`Falscher Programmeinstieg: ${packageJson.main}`);
packageJson.build = packageJson.build || {};
packageJson.build.nsis = {
  ...(packageJson.build.nsis || {}),
  oneClick: false,
  allowToChangeInstallationDirectory: true,
  runAfterFinish: false,
  include: "build/installer.nsh"
};
fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + "\n", "utf8");

const required = [
  "src/main.cjs",
  "src/chat-bootstrap.cjs",
  "src/preload.cjs",
  "src/renderer/index.html",
  "src/renderer/app.js",
  "src/renderer/styles.css",
  "src/renderer/v4-shell.css",
  "src/renderer/v4-settings.js",
  "src/renderer/v4-settings.css",
  "src/renderer/assets/team-alpha-logo.svg",
  "src/renderer/assets/HIntergund.png",
  "src/renderer/multi-chat.html",
  "src/renderer/multi-chat.js",
  "src/renderer/multi-chat.css",
  "src/renderer/chat-overlay-controls.js",
  "src/renderer/chat-bot.js",
  "src/renderer/chat-bot.css",
  "src/services/chat-bot.cjs",
  "src/services/chat-core.cjs",
  "src/services/chat-filter.cjs",
  "src/services/moderation-store.cjs",
  "src/services/moderation-bootstrap.cjs",
  "src/services/v4-config-store.cjs",
  "src/services/v4-log-store.cjs",
  "src/services/v4-operations.cjs",
  "src/services/v4-bootstrap.cjs",
  "src/services/stream-status.cjs",
  "src/services/internet-test.cjs",
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
  "src/renderer/assets/multi-chat-hero.jpg",
  "src/services/hardware.cjs",
  "src/services/recommendation.cjs",
  "src/services/telemetry.cjs",
  "modules/encoder-monitoring-overlay",
  "../.github/workflows/encoder-monitoring-overlay.yml"
];
for (const relative of forbiddenPaths) {
  if (fs.existsSync(path.resolve(root, relative))) throw new Error(`Entfernter Bereich ist wieder vorhanden: ${relative}`);
}

const visible = ["src/renderer/index.html", "src/renderer/app.js", "src/preload.cjs", "src/main.cjs", "src/renderer/multi-chat.css"]
  .map((relative) => fs.readFileSync(path.join(root, relative), "utf8")).join("\n");
if (/Hardwarediagnose|Hardware vollständig erfassen|PC vollständig scannen|PC jetzt scannen|Hardware-Scan|hardware:scan|scanHardware|collectHardware/i.test(visible)) throw new Error("Hardwarediagnose ist wieder im Produkt enthalten.");
if (/multi-chat-hero/i.test(visible)) throw new Error("Das laut V4 verbotene alte Multi-Chat-Bild ist wieder eingebunden.");
if (/Touch[ -]?Deck|Stream[ -]?Deck|deck-pro|deckStore|DeckStore|deck:/i.test(visible)) throw new Error("Eine verbotene Deck-Funktion ist wieder im produktiven Code enthalten.");

console.log(`Batto OBS Tool 2.0.0: ${required.length} V4-Kernbestandteile geprüft; V4-Funktionen vollständig vorbereitet und entfernte Altbereiche ausgeschlossen.`);
