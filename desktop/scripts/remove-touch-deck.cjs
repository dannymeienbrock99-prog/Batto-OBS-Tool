"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const src = path.join(root, "src");

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}
function write(relative, text) {
  fs.writeFileSync(path.join(root, relative), text, "utf8");
}
function removeFile(relative) {
  const file = path.join(root, relative);
  if (fs.existsSync(file)) fs.rmSync(file, { force: true });
}
function removeIndentedFunction(text, namePattern) {
  const rx = new RegExp(`\\n  function ${namePattern}\\([^]*?\\n  }\\n`, "g");
  return text.replace(rx, "\n");
}

// Main process: remove DeckStore, deck state, mobile deck execution and all deck IPC handlers.
{
  const relative = "src/main.cjs";
  let text = read(relative);
  text = text.replace(/^const \{ DeckStore \} = require\("\.\/services\/deck-store\.cjs"\);\r?\n/m, "");
  text = text.replace(/^let deckStore = null;\r?\n/m, "");
  text = text.replace(/^\s*deck:\s*deckStore\?\.snapshot\(\) \|\| null,\r?\n/m, "");
  text = text.replace(/^\s*deckStore = new DeckStore\([^\n]+\);\r?\n/m, "");
  text = text.replace(/new LegacyMigration\(\{ userData: app\.getPath\("userData"\), deckStore, pluginRegistry \}\)/g,
    'new LegacyMigration({ userData: app.getPath("userData"), pluginRegistry })');
  text = text.replace(/\nasync function executeMobilePayload\(payload = \{\}\) \{\n\s*if \(payload\.kind === "deck-button"\) \{[^]*?\n\s*\}\n\s*if \(payload\.kind === "action"/, '\nasync function executeMobilePayload(payload = {}) {\n  if (payload.kind === "action"');
  text = text.replace(/\n\s*handle\("deck:create-profile"[^]*?\n\s*handle\("action:execute"/, '\n  handle("action:execute"');
  text = text.replace(/Touch-Deck/gi, "entfernte Altsteuerung");
  write(relative, text);
}

// Preload bridge: no deck API/channel may be exposed to the renderer.
{
  const relative = "src/preload.cjs";
  let text = read(relative);
  text = removeIndentedFunction(text, "deckForLegacy");
  text = text.replace(/^.*deck:[^\n]*\r?\n/gmi, "");
  text = text.replace(/^.*deck[A-Z][^\n]*\r?\n/gm, "");
  text = text.replace(/^.*Deck[^\n]*\r?\n/gm, "");
  text = text.replace(/,?\s*deck:\s*deckForLegacy\([^\n]+\)/g, "");
  write(relative, text);
}

// Integrated renderer: remove navigation, view markup, functions, state and event lines for Touch Deck Pro.
{
  const relative = "src/renderer/integrated.js";
  let text = read(relative);
  text = text.replace(/^\s*\["deck-pro"[^\n]*\r?\n/m, "");
  text = text.replace(/^\s*"deck-pro": deckMarkup\(\),\r?\n/m, "");
  text = text.replace(/^\s*let selectedDeckButtonIndex[^\n]*\r?\n/m, "");
  text = text.replace(/^\s*let editingDeckButton[^\n]*\r?\n/m, "");
  for (const pattern of ["deckMarkup", "deck[A-Za-z0-9_]*", "renderDeck[A-Za-z0-9_]*", "fillDeck[A-Za-z0-9_]*", "saveDeck[A-Za-z0-9_]*", "loadDeck[A-Za-z0-9_]*"]) {
    text = removeIndentedFunction(text, pattern);
  }
  text = text.replace(/^.*deck-pro[^\n]*\r?\n/gmi, "");
  text = text.replace(/^.*Touch-Deck[^\n]*\r?\n/gmi, "");
  text = text.replace(/^.*state\.deck[^\n]*\r?\n/gm, "");
  write(relative, text);
}

// Legacy renderer: remove old navigation/view strings and deck-only blocks where possible.
{
  const relative = "src/renderer/app.js";
  let text = read(relative);
  text = removeIndentedFunction(text, "deckState");
  text = removeIndentedFunction(text, "renderDeck[A-Za-z0-9_]*");
  text = text.replace(/^.*deck:\s*\["Touch-Deck"[^\n]*\r?\n/gm, "");
  text = text.replace(/^.*data-view=["']deck["'][^\n]*\r?\n/gmi, "");
  text = text.replace(/^.*Touch-Deck[^\n]*\r?\n/gmi, "");
  write(relative, text);
}

// Desktop HTML: remove any legacy deck navigation/view remnants.
{
  const relative = "src/renderer/index.html";
  let text = read(relative);
  text = text.replace(/^.*data-view=["']deck["'][^\n]*\r?\n/gmi, "");
  text = text.replace(/<section[^>]+id=["']view-deck["'][^>]*>[^]*?<\/section>/gmi, "");
  text = text.replace(/^.*Touch-Deck[^\n]*\r?\n/gmi, "");
  write(relative, text);
}

// Mobile client: remove deck tab/sections/scripts; OBS/status remain available.
for (const relative of ["src/mobile/index.html", "src/mobile/app.js", "src/mobile/index-v2.html", "src/mobile/app-v2.js"]) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) continue;
  let text = fs.readFileSync(file, "utf8");
  text = text.replace(/^.*data-page=["']deck["'][^\n]*\r?\n/gmi, "");
  text = text.replace(/<section[^>]+id=["']deck["'][^>]*>[^]*?<\/section>/gmi, "");
  text = text.replace(/^.*Touch-Deck[^\n]*\r?\n/gmi, "");
  text = text.replace(/^.*deck-button[^\n]*\r?\n/gmi, "");
  text = text.replace(/^.*state\.deck[^\n]*\r?\n/gm, "");
  fs.writeFileSync(file, text, "utf8");
}

// Files that must not enter the packaged application.
for (const relative of [
  "src/services/deck-store.cjs",
  "src/services/deck-manager-v2.cjs",
  "src/renderer/touch-deck-pro-v2.js",
  "src/renderer/touch-deck-pro-v2.css"
]) removeFile(relative);

console.log("Touch Deck wurde aus der produktiven Anwendung entfernt.");
