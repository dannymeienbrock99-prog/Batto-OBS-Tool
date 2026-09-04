"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const forbiddenFiles = [
  "src/services/deck-store.cjs",
  "src/services/deck-manager-v2.cjs",
  "src/renderer/touch-deck-pro-v2.js",
  "src/renderer/touch-deck-pro-v2.css"
];
for (const relative of forbiddenFiles) {
  if (fs.existsSync(path.join(root, relative))) throw new Error(`Touch-Deck-Datei darf nicht im Produktionsbaum liegen: ${relative}`);
}

const scanFiles = [
  "src/main.cjs",
  "src/preload.cjs",
  "src/renderer/index.html",
  "src/renderer/integrated.js",
  "src/renderer/app.js",
  "src/mobile/index.html",
  "src/mobile/app.js"
];
const forbidden = ["Touch-Deck", "Touch Deck", "deck-pro", "deck:create-profile", "deck:execute-button", "deckStore", "DeckStore"];
for (const relative of scanFiles) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) continue;
  const text = fs.readFileSync(file, "utf8");
  for (const needle of forbidden) {
    if (text.includes(needle)) throw new Error(`Touch-Deck-Rest '${needle}' gefunden in ${relative}`);
  }
}
console.log("Touch-Deck-Prüfung OK: keine produktiven Reste gefunden.");
