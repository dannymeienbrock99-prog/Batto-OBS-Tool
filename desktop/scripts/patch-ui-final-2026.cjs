"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const write = (relative, value) => fs.writeFileSync(path.join(root, relative), value, "utf8");

function requireFile(relative) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file) || !fs.statSync(file).size) throw new Error(`Erforderliche UI-Datei fehlt: ${relative}`);
  return file;
}

function requireText(content, text, message) {
  if (!content.includes(text)) throw new Error(message);
}

// Übersicht mit dem vom Nutzer gelieferten Drachen-PC-Hintergrund aufbauen.
{
  const backgroundFile = requireFile("src/renderer/assets/overview-bg.jpg");
  const image = fs.readFileSync(backgroundFile);
  const validJpeg = image.length >= 4 && image[0] === 0xff && image[1] === 0xd8 && image[image.length - 2] === 0xff && image[image.length - 1] === 0xd9;
  if (!validJpeg) throw new Error("overview-bg.jpg ist kein vollständiges JPEG.");

  const indexFile = "src/renderer/index.html";
  let html = read(indexFile);
  html = html.replace('<div class="hero panel">', '<div class="hero panel overview-hero">');
  html = html.replace(/(<section class="page active" data-page-panel="overview">[\s\S]*?<div class="hero panel overview-hero">[\s\S]*?)<img src="\.\/assets\/team-logo\.(?:svg|png)" alt="Team Alpha">/, "$1");
  write(indexFile, html);

  const stylesFile = "src/renderer/styles.css";
  let css = read(stylesFile);
  if (!css.includes("/* Batto overview dragon hero */")) {
    css += `\n/* Batto overview dragon hero */\n.overview-hero {\n  position: relative;\n  min-height: 285px;\n  isolation: isolate;\n  overflow: hidden;\n  background-image:\n    linear-gradient(90deg, rgba(4,7,12,.98) 0%, rgba(7,10,16,.91) 30%, rgba(7,10,16,.58) 52%, rgba(4,7,12,.14) 76%),\n    radial-gradient(circle at 18% 58%, rgba(160,0,26,.34), transparent 39%),\n    url("./assets/overview-bg.jpg");\n  background-size: cover;\n  background-position: center right;\n  background-repeat: no-repeat;\n}\n.overview-hero > div { position: relative; z-index: 1; max-width: min(790px, 64%); }\n.overview-hero h2 { text-shadow: 0 2px 20px rgba(0,0,0,.9); }\n.overview-hero p { color: #d5dde7; text-shadow: 0 2px 14px rgba(0,0,0,.94); }\n@media (max-width: 1120px) { .overview-hero { background-position: 68% center; } .overview-hero > div { max-width: 74%; } }\n`;
    write(stylesFile, css);
  }
}

// Stream-Overlay: Die moderne Editor-Laufzeit enthält diese Funktionen bereits.
// Hier wird die reale Implementierung validiert, statt alte Patchpunkte ein zweites Mal zu verändern.
{
  const editorFile = "src/stream-overlay/editor.js";
  const js = read(editorFile);

  requireText(js, 'addEventListener("contextmenu"', "Stream-Overlay: echtes Rechtsklick-Menü fehlt.");
  requireText(js, "function copySelected()", "Stream-Overlay: Kopieren fehlt.");
  requireText(js, "function pasteElement()", "Stream-Overlay: Einfügen fehlt.");
  requireText(js, "function duplicateSelected()", "Stream-Overlay: Duplizieren fehlt.");
  requireText(js, "function deleteSelected()", "Stream-Overlay: Löschen fehlt.");
  requireText(js, "function alignSelected(mode)", "Stream-Overlay: Ausrichten fehlt.");
  requireText(js, "function moveLayer(direction)", "Stream-Overlay: Ebenensteuerung fehlt.");
  requireText(js, 'event.key === "Delete"', "Stream-Overlay: Entf-Tastenkürzel fehlt.");
  requireText(js, 'event.key.toLowerCase() === "c"', "Stream-Overlay: Kopieren-Tastenkürzel fehlt.");
  requireText(js, 'event.key.toLowerCase() === "v"', "Stream-Overlay: Einfügen-Tastenkürzel fehlt.");
  requireText(js, 'event.key.toLowerCase() === "d"', "Stream-Overlay: Duplizieren-Tastenkürzel fehlt.");

  const cssFile = "src/stream-overlay/editor.css";
  let css = read(cssFile);
  if (!css.includes(".overlay-context-menu")) {
    css += `\n.overlay-context-menu{position:fixed;z-index:9999;display:grid;min-width:210px;padding:6px;border:1px solid #3b4d61;border-radius:9px;background:#0b1119;box-shadow:0 18px 48px rgba(0,0,0,.48)}\n.overlay-context-menu button{min-height:34px;padding:0 10px;border:0;border-radius:6px;text-align:left;background:transparent;color:#e7eef6}\n.overlay-context-menu button:hover{background:#152536;color:#fff}\n`;
    write(cssFile, css);
  }
}

console.log("Batto UI 2026: Übersichtshintergrund und vorhandene Stream-Overlay-Kontextwerkzeuge validiert.");
