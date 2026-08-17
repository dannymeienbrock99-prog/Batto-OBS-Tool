"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const bootstrap = path.join(root, "bootstrap-2.0", "src", "renderer");
const renderer = path.join(root, "src", "renderer");
const indexFile = path.join(renderer, "index.html");

function copyRequired(name) {
  const source = path.join(bootstrap, name);
  const target = path.join(renderer, name);
  if (!fs.existsSync(source) || !fs.statSync(source).size) {
    throw new Error(`Touch-Deck-Pro-Quelldatei fehlt: bootstrap-2.0/src/renderer/${name}`);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

copyRequired("touch-deck-pro-v2.css");
copyRequired("touch-deck-pro-v2.js");

let index = fs.readFileSync(indexFile, "utf8");
if (!index.includes('href="./touch-deck-pro-v2.css"')) {
  const marker = '<link rel="stylesheet" href="./integrated.css">';
  if (!index.includes(marker)) throw new Error("Integrated-CSS-Marker im Hauptfenster fehlt.");
  index = index.replace(marker, `${marker}\n    <link rel="stylesheet" href="./touch-deck-pro-v2.css">`);
}
if (!index.includes('src="./touch-deck-pro-v2.js"')) {
  const marker = '<script src="./integrated.js"></script>';
  if (!index.includes(marker)) throw new Error("Integrated-JavaScript-Marker im Hauptfenster fehlt.");
  index = index.replace(marker, `${marker}\n    <script src="./touch-deck-pro-v2.js"></script>`);
}
fs.writeFileSync(indexFile, index, "utf8");

for (const relative of [
  "src/renderer/touch-deck-pro-v2.css",
  "src/renderer/touch-deck-pro-v2.js"
]) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file) || !fs.statSync(file).size) throw new Error(`Touch-Deck-Pro-Builddatei fehlt: ${relative}`);
}

console.log("Touch-Deck Pro V2 mit Plugin-Seitenleiste eingebunden.");
