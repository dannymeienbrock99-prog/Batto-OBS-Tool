"use strict";

const fs = require("node:fs");
const path = require("node:path");

const rendererRoot = path.join(__dirname, "..", "src", "renderer");
const integratedFile = path.join(rendererRoot, "integrated.js");

function read(file) {
  return fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
}

function write(file, text) {
  fs.writeFileSync(file, text, "utf8");
}

function replaceVisibleProLabel(file) {
  if (!fs.existsSync(file)) return;
  const before = read(file);
  const after = before.replaceAll("Touch-Deck Pro", "Touch-Deck");
  if (after !== before) write(file, after);
}

let text = read(integratedFile).replaceAll("Touch-Deck Pro", "Touch-Deck");

if (!text.includes('id="classic-deck-host"')) {
  const begin = text.indexOf("  function deckMarkup()");
  const end = text.indexOf("  function mobileMarkup()", begin);
  if (begin < 0 || end < 0) {
    throw new Error(`Classic Touch-Deck: deckMarkup/mobileMarkup nicht gefunden (deck=${begin}, mobile=${end}).`);
  }
  const replacement = '  function deckMarkup() {\n    return `<div id="classic-deck-host"></div>`;\n  }\n\n';
  text = text.slice(0, begin) + replacement + text.slice(end);
}

// Twitch ist anonym/read-only. Das alte Bot-/Kontonamenfeld darf weder sichtbar
// sein noch irgendwo über .value angesprochen werden.
text = text.replace(/\n\s*<label>Bot-\/Kontoname<input id="chat-twitch-name"[^>]*><\/label>/g, "");
text = text.replace(/,\s*nickname:\s*\$\("#chat-twitch-name"\)\.value\.trim\(\)/g, "");
text = text.replace(/nickname:\s*\$\("#chat-twitch-name"\)\.value\.trim\(\)\s*,\s*/g, "");
text = text.replace(/\n\s*\$\("#chat-twitch-name"\)\.value\s*=\s*[^;]+;/g, "");

if (!text.includes('id="classic-deck-host"')) {
  throw new Error("Classic Touch-Deck Host konnte nicht eingebaut werden.");
}
if (text.includes("chat-twitch-name")) {
  throw new Error("Entferntes Twitch-Namensfeld wird noch im Renderer verwendet.");
}

write(integratedFile, text);
replaceVisibleProLabel(path.join(rendererRoot, "index.html"));
replaceVisibleProLabel(path.join(rendererRoot, "app.js"));

for (const file of [path.join(rendererRoot, "index.html"), path.join(rendererRoot, "app.js"), integratedFile]) {
  if (fs.existsSync(file) && read(file).includes("Touch-Deck Pro")) {
    throw new Error(`Alte Touch-Deck-Pro-Bezeichnung blieb in ${path.basename(file)} erhalten.`);
  }
}

console.log("Classic Touch-Deck Host eingesetzt; alte Pro-Bezeichnungen und verwaiste Twitch-Namenszugriffe vollständig entfernt.");
