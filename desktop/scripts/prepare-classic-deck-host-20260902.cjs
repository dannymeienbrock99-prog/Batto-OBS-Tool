"use strict";

const fs = require("node:fs");
const path = require("node:path");

const file = path.join(__dirname, "..", "src", "renderer", "integrated.js");
let text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
text = text.replaceAll("Touch-Deck Pro", "Touch-Deck");

if (!text.includes('id="classic-deck-host"')) {
  const begin = text.indexOf("  function deckMarkup()");
  const end = text.indexOf("  function mobileMarkup()", begin);
  if (begin < 0 || end < 0) {
    throw new Error(`Classic Touch-Deck: deckMarkup/mobileMarkup nicht gefunden (deck=${begin}, mobile=${end}).`);
  }
  const replacement = '  function deckMarkup() {\n    return `<div id="classic-deck-host"></div>`;\n  }\n\n';
  text = text.slice(0, begin) + replacement + text.slice(end);
}

if (!text.includes('id="classic-deck-host"')) {
  throw new Error("Classic Touch-Deck Host konnte nicht eingebaut werden.");
}

fs.writeFileSync(file, text, "utf8");
console.log("Classic Touch-Deck Host robust in die integrierte Oberfläche eingesetzt.");
