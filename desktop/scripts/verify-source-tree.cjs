"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const required = [
  "src/main-v2.cjs",
  "src/main.cjs",
  "src/preload.cjs",
  "src/chat-bootstrap.cjs",
  "src/services/store.cjs",
  "src/services/secret-store.cjs",
  "src/services/hardware-enrichment-v2.cjs",
  "src/services/obs-websocket.cjs",
  "src/services/connection-manager.cjs",
  "src/services/hybrid-runtime.cjs",
  "src/services/tiktok-live-studio.cjs",
  "src/renderer/index.html",
  "src/renderer/app.js",
  "src/renderer/commercial-settings.js",
  "src/renderer/commercial-settings.css",
  "src/renderer/multi-chat.js",
  "src/renderer/multi-chat.css",
  "src/renderer/touch-deck-pro-v2.js",
  "src/renderer/touch-deck-pro-v2.css"
];

for (const relative of required) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) throw new Error(`Produktionsdatei fehlt: ${relative}`);
  if (!fs.statSync(absolute).size) throw new Error(`Produktionsdatei ist leer: ${relative}`);
}

const syntaxFiles = required.filter((file) => /\.(?:cjs|js)$/.test(file));
for (const relative of syntaxFiles) {
  execFileSync(process.execPath, ["--check", path.join(root, relative)], { stdio: "pipe" });
}

const index = fs.readFileSync(path.join(root, "src", "renderer", "index.html"), "utf8");
for (const marker of ["touch-deck-pro-v2.css", "touch-deck-pro-v2.js", "commercial-settings.css", "commercial-settings.js"]) {
  if (!index.includes(marker)) throw new Error(`Renderer-Einbindung fehlt: ${marker}`);
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
if (packageJson.main !== "src/main-v2.cjs") throw new Error("package.json muss src/main-v2.cjs als Programmeinstieg verwenden.");
if (packageJson.version !== "2.1.0") throw new Error(`Unerwartete Version: ${packageJson.version}`);

console.log(`Source-of-truth geprüft: ${required.length} Produktionsdateien, ${syntaxFiles.length} Syntaxprüfungen OK.`);
