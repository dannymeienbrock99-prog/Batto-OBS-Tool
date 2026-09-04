"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = path.join(root, "src");
const resources = path.join(root, "resources");

function ensureDir(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function copyFile(from, to) {
  if (!fs.existsSync(from)) throw new Error(`Quelldatei fehlt: ${path.relative(root, from)}`);
  ensureDir(path.dirname(to));
  fs.copyFileSync(from, to);
}

ensureDir(resources);
const fallbackLogo = path.join(source, "stream-overlay", "team-logo.svg");
if (!fs.existsSync(fallbackLogo)) throw new Error("Team-Alpha-Fallbacklogo fehlt im Stream-Overlay.");
copyFile(fallbackLogo, path.join(resources, "team-logo.svg"));
copyFile(fallbackLogo, path.join(source, "renderer", "assets", "team-alpha-logo.svg"));
copyFile(fallbackLogo, path.join(source, "mobile", "team-logo.svg"));

const indexFile = path.join(source, "renderer", "index.html");
let index = fs.readFileSync(indexFile, "utf8").replaceAll("1.9.1", "2.0.0");
index = index.replaceAll("./assets/team-alpha-logo.svg", "./assets/team-alpha-logo.png");
if (fs.existsSync(path.join(source, "renderer", "integrated.css")) && !index.includes("integrated.css")) {
  const marker = '<link rel="stylesheet" href="./styles.css">';
  if (!index.includes(marker)) throw new Error("Stylesheet-Marker im Hauptfenster fehlt.");
  index = index.replace(marker, `${marker}\n    <link rel="stylesheet" href="./integrated.css">`);
}
if (fs.existsSync(path.join(source, "renderer", "integrated.js")) && !index.includes("integrated.js")) {
  const marker = '<script src="./app.js"></script>';
  if (!index.includes(marker)) throw new Error("Skript-Marker im Hauptfenster fehlt.");
  index = index.replace(marker, `${marker}\n    <script src="./integrated.js"></script>`);
}
fs.writeFileSync(indexFile, index, "utf8");

const packagePath = path.join(root, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
if (packageJson.version !== "2.0.0") throw new Error(`Falsche Paketversion: ${packageJson.version}`);
if (packageJson.main !== "src/main.cjs") throw new Error(`Falscher Programmeinstieg: ${packageJson.main}`);
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
  "src/main.cjs", "src/chat-bootstrap.cjs", "src/preload.cjs", "src/renderer/index.html", "src/renderer/app.js",
  "src/renderer/multi-chat.html", "src/renderer/multi-chat.js", "src/renderer/multi-chat.css", "src/renderer/chat-overlay-controls.js",
  "src/stream-overlay/chat-overlay.html", "src/stream-overlay/chat-overlay.css", "src/stream-overlay/chat-overlay.js",
  "src/services/hardware.cjs", "src/services/recommendation.cjs", "src/services/obs-websocket.cjs", "src/services/obs-chat-overlay.cjs",
  "src/services/mobile-bridge.cjs", "src/services/stream-overlay-server.cjs", "src/services/plugin-registry.cjs",
  "src/services/multi-chat.cjs", "src/mobile/index.html",
  "src/stream-overlay/editor.html", "src/stream-overlay/overlay.html", "resources/team-logo.svg",
  "modules/encoder-monitoring-overlay/src/server.cjs", "modules/twitch-holo-chat/web/overlay.html"
];
for (const relative of required) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).size) throw new Error(`Integrierte Datei fehlt oder ist leer: ${relative}`);
}

console.log(`Batto OBS Tool 2.0.0: ${required.length} Kernbestandteile korrekt zusammengesetzt.`);
