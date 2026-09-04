"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function file(relative) { return path.join(root, relative); }
function read(relative) { return fs.readFileSync(file(relative), "utf8"); }
function write(relative, text) { fs.writeFileSync(file(relative), text, "utf8"); }
function removeFile(relative) { if (fs.existsSync(file(relative))) fs.rmSync(file(relative), { force: true }); }
function removeBetween(text, start, end, keepEnd = true) {
  const a = text.indexOf(start);
  if (a < 0) return text;
  const b = text.indexOf(end, a + start.length);
  if (b < 0) throw new Error(`Touch-Deck-Entfernung: Endmarker fehlt: ${end}`);
  return text.slice(0, a) + (keepEnd ? text.slice(b) : text.slice(b + end.length));
}
function removeLineContaining(text, needles) {
  const list = Array.isArray(needles) ? needles : [needles];
  return text.split(/\r?\n/).filter((line) => !list.some((needle) => line.includes(needle))).join("\n");
}

{
  const relative = "src/main.cjs";
  let text = read(relative);
  text = text.replace(/^const \{ DeckStore \} = require\("\.\/services\/deck-store\.cjs"\);\r?\n/m, "");
  text = text.replace(/^let deckStore = null;\r?\n/m, "");
  text = text.replace(/^\s*deck:\s*deckStore\?\.snapshot\(\) \|\| null,\r?\n/m, "");
  text = text.replace(/^\s*deckStore = new DeckStore\([^\n]+\);\r?\n/m, "");
  text = text.replace(/new LegacyMigration\(\{ userData: app\.getPath\("userData"\), deckStore, pluginRegistry \}\)/g,
    'new LegacyMigration({ userData: app.getPath("userData"), pluginRegistry })');
  text = removeLineContaining(text, ['await check("DeckStore"', 'check("DeckStore"']);

  const mobileFunctionStart = '\nasync function executeMobilePayload(payload = {}) {';
  const connectObsStart = '\nasync function connectObs(';
  if (text.includes(mobileFunctionStart)) {
    const start = text.indexOf(mobileFunctionStart);
    const next = text.indexOf(connectObsStart, start);
    if (next < 0) throw new Error("Touch-Deck-Entfernung: connectObs-Marker fehlt.");
    const replacement = '\nasync function executeMobilePayload(payload = {}) {\n  if (payload.kind === "action" && payload.action) return actionExecutor.execute(payload.action, { source: "mobile" });\n  throw new Error("Unbekannte Handy-Aktion.");\n}\n';
    text = text.slice(0, start) + replacement + text.slice(next);
  }

  const deckIpcStart = '\n  handle("deck:create-profile"';
  const actionIpc = '\n  handle("action:execute"';
  if (text.includes(deckIpcStart)) text = removeBetween(text, deckIpcStart, actionIpc, true);

  text = text.replace(/Touch[-‑– ]Deck/gi, "Altsteuerung");
  text = text.replace(/legacy-deck/gi, "legacy-control");
  if (/DeckStore|deckStore|deck:create-profile|deck:execute-button/.test(text)) {
    throw new Error("Touch-Deck-Entfernung: Im Hauptprozess sind weiterhin Deck-Reste vorhanden.");
  }
  write(relative, text);
}

{
  const relative = "src/preload.cjs";
  let text = read(relative);
  text = removeLineContaining(text, [
    '"deck:create-profile"', '"deck:create-folder"', '"deck:update-button"'
  ]);
  text = removeBetween(text, "\nfunction actionToLegacy(action) {", "\nfunction legacyState(value) {", true);
  text = text.replace(/^\s*deck:\s*deckForLegacy\([^\n]+\),\r?\n/m, "");
  text = removeBetween(text, "\nfunction actionForLegacyAssignment(assignment = {}) {", "\nfunction on(channel, callback) {", true);
  text = text.replace(/^\s*if \(value\.deck\) patch\.legacyDeck = value\.deck;\r?\n/m, "");
  text = text.replace(/^\s*return \(await invoke\("settings:update", patch\)\)\.legacyDeck \|\| value\.deck \|\| patch;\r?\n/m,
    '    return invoke("settings:update", patch);\n');
  text = text.replace(/^\s*executeDeckAction:[^\n]+\r?\n/m, "");
  text = text.replace(/Touch[-‑– ]Deck/gi, "Altsteuerung");
  text = text.replace(/legacy-deck/gi, "legacy-control");
  write(relative, text);
}

{
  const relative = "src/renderer/integrated.js";
  let text = read(relative);
  text = removeLineContaining(text, [
    '["deck-pro",',
    '"deck-pro": deckMarkup()',
    'let selectedDeckButtonIndex',
    'let editingDeckButton',
    'if (id === "deck-pro") renderDeckPro();'
  ]);
  text = removeBetween(text, "\n  function deckMarkup() {", "\n  function mobileMarkup() {", true);
  const deckEventsStart = '    $("#deck-pro-profile")?.addEventListener';
  const mobileEventsStart = '    $("#mobile-new-pin")?.addEventListener';
  if (text.includes(deckEventsStart)) {
    const a = text.indexOf(deckEventsStart);
    const b = text.indexOf(mobileEventsStart, a);
    if (b < 0) throw new Error("Touch-Deck-Entfernung: Mobile-Eventmarker fehlt.");
    text = text.slice(0, a) + text.slice(b);
  }
  text = removeBetween(text, "\n  function deckProfile() {", "\n  function renderMobile() {", true);
  text = text.replace(/<li>Touch[-‑– ]Deck[^<]*<\/li>/gi, "");
  text = text.replace(/Touch[-‑– ]Deck/gi, "Altsteuerung");
  text = text.replace(/deck-pro/gi, "removed-control");
  write(relative, text);
}

{
  const relative = "src/renderer/index.html";
  let text = read(relative);
  text = text.replace(/^.*data-view=["']deck["'][^\n]*\r?\n/gmi, "");
  text = text.replace(/<section[^>]+id=["']view-deck["'][^>]*>[\s\S]*?<\/section>/gmi, "");
  text = text.replace(/Touch[-‑– ]Deck/gi, "Altsteuerung");
  text = text.replace(/deck-pro/gi, "removed-control");
  write(relative, text);
}

{
  const relative = "src/renderer/app.js";
  let text = read(relative);
  text = text.replace(/^\s*deck:\s*\["Touch-Deck"[^\n]*\r?\n/gm, "");
  text = text.replace(/Touch[-‑– ]Deck/gi, "Altsteuerung");
  text = text.replace(/deck-pro/gi, "removed-control");
  text = text.replace(/^.*api\.executeDeckAction[^\n]*\r?\n/gm, "");
  text = text.replace(/^.*data-view=["']deck["'][^\n]*\r?\n/gmi, "");
  write(relative, text);
}

for (const relative of ["src/mobile/index.html", "src/mobile/index-v2.html"]) {
  if (!fs.existsSync(file(relative))) continue;
  let text = read(relative);
  text = text.replace(/^.*data-page=["']deck["'][^\n]*\r?\n/gmi, "");
  text = text.replace(/<section[^>]+id=["']deck["'][^>]*>[\s\S]*?<\/section>/gmi, "");
  text = text.replace(/Touch[-‑– ]Deck/gi, "Altsteuerung");
  text = text.replace(/deck-pro/gi, "removed-control");
  write(relative, text);
}
for (const relative of ["src/mobile/app.js", "src/mobile/app-v2.js"]) {
  if (!fs.existsSync(file(relative))) continue;
  let text = read(relative);
  text = text.replace(/Touch[-‑– ]Deck/gi, "Altsteuerung");
  text = text.replace(/deck-pro/gi, "removed-control");
  text = removeLineContaining(text, ["deck-button", "state.deck"]);
  write(relative, text);
}

{
  const relative = "src/services/migration.cjs";
  if (fs.existsSync(file(relative))) {
    let text = read(relative);
    text = text.replace(/Touch[-‑– ]Deck/gi, "Altsteuerung");
    if (/deckStore|DeckStore|deck-profiles\.json|decks\.json/.test(text)) {
      throw new Error("Touch-Deck-Entfernung: Migration enthält weiterhin Deck-Reste.");
    }
    write(relative, text);
  }
}

for (const relative of [
  "src/services/deck-store.cjs",
  "src/services/deck-manager-v2.cjs",
  "src/renderer/touch-deck-pro-v2.js",
  "src/renderer/touch-deck-pro-v2.css"
]) removeFile(relative);

console.log("Touch Deck wurde aus der produktiven Anwendung entfernt.");
