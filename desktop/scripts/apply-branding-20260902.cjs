"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const cssFile = path.join(root, "src", "renderer", "styles.css");
const indexFile = path.join(root, "src", "renderer", "index.html");
const backgroundFile = path.join(root, "src", "renderer", "assets", "overview-bg.jpg");
const shortcutFile = path.join(root, "build", "shortcut-icon.png");
const marker = "/* BATTO 2.0 CUSTOM OVERVIEW BRANDING */";

for (const [file, label] of [[cssFile, "styles.css"], [indexFile, "index.html"], [backgroundFile, "Übersichts-Hintergrund"], [shortcutFile, "Desktop-Verknüpfungsbild"]]) {
  if (!fs.existsSync(file) || !fs.statSync(file).size) throw new Error(`${label} fehlt oder ist leer: ${path.relative(root, file)}`);
}

let css = fs.readFileSync(cssFile, "utf8");
if (!css.includes(marker)) {
  css += `\n\n${marker}\n.hero-card {\n  position: relative;\n  min-height: 330px;\n  grid-template-columns: minmax(0, 1fr);\n  align-items: center;\n  isolation: isolate;\n  background-image:\n    linear-gradient(90deg, rgba(5, 9, 15, .98) 0%, rgba(5, 9, 15, .92) 30%, rgba(5, 9, 15, .58) 53%, rgba(5, 9, 15, .12) 76%, rgba(5, 9, 15, .18) 100%),\n    linear-gradient(180deg, rgba(0, 0, 0, .08), rgba(0, 0, 0, .32)),\n    url("./assets/overview-bg.jpg");\n  background-size: cover;\n  background-position: center center;\n  background-repeat: no-repeat;\n  box-shadow: 0 18px 60px rgb(0 0 0 / 34%), inset 0 0 0 1px rgb(76 203 255 / 4%);\n}\n.hero-card::after {\n  content: "";\n  position: absolute;\n  inset: 0;\n  z-index: -1;\n  pointer-events: none;\n  background: radial-gradient(circle at 78% 48%, rgb(30 163 255 / 8%), transparent 34%);\n}\n.hero-card > div { position: relative; z-index: 2; max-width: min(760px, 66%); }\n.hero-card > img { display: none !important; }\n.hero-card h2 { text-shadow: 0 3px 22px rgb(0 0 0 / 80%); }\n.hero-card p { color: #c4ced8; text-shadow: 0 2px 10px rgb(0 0 0 / 88%); }\n@media (max-width: 980px) {\n  .hero-card { min-height: 300px; background-position: 62% center; }\n  .hero-card > div { max-width: 78%; }\n}\n@media (max-width: 720px) {\n  .hero-card { min-height: 340px; background-position: 68% center; background-image: linear-gradient(90deg, rgba(5,9,15,.98), rgba(5,9,15,.82)), url("./assets/overview-bg.jpg"); }\n  .hero-card > div { max-width: 100%; }\n}\n`;
  fs.writeFileSync(cssFile, css, "utf8");
}

let index = fs.readFileSync(indexFile, "utf8");
index = index.replaceAll("BATTO OBS TOOL 1.9.1", "BATTO OBS TOOL 2.0.0").replaceAll("Version 1.9.1", "Version 2.0.0");
fs.writeFileSync(indexFile, index, "utf8");

console.log("Branding aktiv: Drachen-PC als Übersichts-Hintergrund und eigenes Desktop-Verknüpfungsbild bereit.");
