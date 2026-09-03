"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const required = [
  "src/main.cjs",
  "src/preload.cjs",
  "src/chat-bootstrap.cjs",
  "src/services/store.cjs",
  "src/services/secret-store.cjs",
  "src/services/obs-websocket.cjs",
  "src/services/connection-manager.cjs",
  "src/services/hybrid-runtime.cjs",
  "src/services/tiktok-live-studio.cjs",
  "src/renderer/index.html",
  "src/renderer/app.js",
  "src/renderer/commercial-settings.js",
  "src/renderer/commercial-settings.css",
  "src/renderer/multi-chat.js",
  "src/renderer/multi-chat.css"
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

const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
if (packageJson.main !== "src/main.cjs") throw new Error("package.json muss src/main.cjs als einzigen Programmeinstieg verwenden.");
if (packageJson.version !== "2.1.0") throw new Error(`Unerwartete Version: ${packageJson.version}`);

console.log(`Source-of-truth geprüft: ${required.length} Produktionsdateien, ${syntaxFiles.length} Syntaxprüfungen OK.`);
