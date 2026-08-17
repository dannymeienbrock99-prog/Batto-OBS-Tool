"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const script = fs.readFileSync(path.join(root, "bootstrap-2.0/src/renderer/touch-deck-pro-v2.js"), "utf8");
const css = fs.readFileSync(path.join(root, "bootstrap-2.0/src/renderer/touch-deck-pro-v2.css"), "utf8");
const prepare = fs.readFileSync(path.join(root, "scripts/prepare-touch-deck-pro-v2.cjs"), "utf8");

test("Touch-Deck-Pro-V2 JavaScript ist syntaktisch gültig", () => {
  assert.doesNotThrow(() => new vm.Script(script));
});

test("Touch-Deck Pro kombiniert Pluginleiste, Deck und Inspector", () => {
  for (const marker of [
    "tdp-library", "tdp-search", "tdp-tab-actions", "tdp-tab-plugins",
    "tdp-grid", "tdp-inspector", "tdp-action-type", "tdp-save-key"
  ]) assert.match(script, new RegExp(marker));
  assert.match(css, /grid-template-columns:\s*minmax\(260px, 315px\)\s+minmax\(430px, 1fr\)\s+minmax\(300px, 340px\)/);
});

test("Pluginaktionen können angeklickt und per Drag-and-drop zugewiesen werden", () => {
  assert.match(script, /application\/x-batto-touch-deck-action/);
  assert.match(script, /addLibraryAction/);
  assert.match(script, /dataTransfer\.setData\(actionTransferType/);
  assert.match(script, /dataTransfer\.getData\(actionTransferType/);
});

test("Leere Tasten bleiben ohne sichtbare Standardbeschriftung", () => {
  assert.match(script, /if \(used\) \{/);
  assert.doesNotMatch(script, /button\.title \|\| \(button\.folderId \? "Ordner" : `Taste \$\{index \+ 1\}`\)/);
  assert.match(script, /Unbelegte Taste \$\{index \+ 1\}/);
});

test("Rasteränderungen bewahren verdeckte Belegungen", () => {
  assert.match(script, /slice\(newCapacity\)\.filter\(isUsed\)/);
  assert.match(script, /nur ausgeblendet, aber nicht gelöscht/);
  assert.match(script, /deck:update-folder/);
});

test("Produktionsvorbereitung kopiert und lädt beide V2-Dateien", () => {
  assert.match(prepare, /copyRequired\("touch-deck-pro-v2\.css"\)/);
  assert.match(prepare, /copyRequired\("touch-deck-pro-v2\.js"\)/);
  assert.match(prepare, /touch-deck-pro-v2\.css/);
  assert.match(prepare, /touch-deck-pro-v2\.js/);
});
