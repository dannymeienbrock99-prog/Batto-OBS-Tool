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

// Twitch läuft anonym/read-only. Das frühere Bot-/Kontonamenfeld wurde entfernt;
// übrig gebliebene Zugriffe darauf würden im Renderer auf null.value laufen.
text = text.replace(
  '          twitch: { channel: $("#chat-twitch-channel").value.trim(), nickname: $("#chat-twitch-name").value.trim() },',
  '          twitch: { channel: $("#chat-twitch-channel").value.trim() },'
);
text = text.replace(/\n\s*\$\("#chat-twitch-name"\)\.value = settings\.twitch\?\.nickname \|\| "";/g, "");

if (!text.includes('id="classic-deck-host"')) {
  throw new Error("Classic Touch-Deck Host konnte nicht eingebaut werden.");
}
if (text.includes('$("#chat-twitch-name").value')) {
  throw new Error("Entferntes Twitch-Namensfeld wird noch im Renderer angesprochen.");
}

write(integratedFile, text);
replaceVisibleProLabel(path.join(rendererRoot, "index.html"));
replaceVisibleProLabel(path.join(rendererRoot, "app.js"));

for (const file of [path.join(rendererRoot, "index.html"), path.join(rendererRoot, "app.js"), integratedFile]) {
  if (fs.existsSync(file) && read(file).includes("Touch-Deck Pro")) {
    throw new Error(`Alte Touch-Deck-Pro-Bezeichnung blieb in ${path.basename(file)} erhalten.`);
  }
}

console.log("Classic Touch-Deck Host eingesetzt; alte Pro-Bezeichnungen und verwaiste Twitch-Namenszugriffe entfernt.");
