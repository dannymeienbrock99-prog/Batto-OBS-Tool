"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const script = fs.readFileSync(path.join(root, "bootstrap-2.0/src/renderer/touch-deck-v3.js"), "utf8");
const css = fs.readFileSync(path.join(root, "bootstrap-2.0/src/renderer/touch-deck-v3.css"), "utf8");
const prepare = fs.readFileSync(path.join(root, "scripts/prepare-touch-deck-v3.cjs"), "utf8");

test("Touch-Deck V3 JavaScript ist syntaktisch gültig", () => {
  assert.doesNotThrow(() => new vm.Script(script));
});

test("Touch-Deck kombiniert Pluginleiste, Deck und Inspector", () => {
  for (const marker of [
    "tdp-library", "tdp-search", "tdp-tab-actions", "tdp-tab-plugins",
    "tdp-grid", "tdp-inspector", "tdp-action-type", "tdp-save-key"
  ]) assert.match(script, new RegExp(marker));
  assert.match(css, /grid-template-columns:\s*minmax\(260px, 315px\)\s+minmax\(430px, 1fr\)\s+minmax\(300px, 340px\)/);
  assert.doesNotMatch(script, /Touch-Deck Pro/i);
});

test("Pluginaktionen können angeklickt und per Drag-and-drop zugewiesen werden", () => {
  assert.match(script, /application\/x-batto-touch-deck-action/);
  assert.match(script, /selectLibraryAction/);
  assert.match(script, /assignActionToKey/);
  assert.match(script, /deck:update-button/);
  assert.match(script, /belegt und gespeichert/);
  assert.match(script, /dataTransfer\.setData\(actionTransferType/);
  assert.match(script, /dataTransfer\.getData\(actionTransferType/);
});

test("Raster, Gerätegröße und Tastendarstellung sind frei anpassbar", () => {
  for (const marker of [
    "Stream Deck Mini · 6", "Stream Deck Neo · 8", "Stream Deck + · 8",
    "Stream Deck · 15", "Stream Deck XL · 32", "tdp-auto-fit", "tdp-show-labels",
    "tdp-radius", "layoutFromControls", "ResizeObserver"
  ]) assert.match(script, new RegExp(marker.replace(/[+]/g, "\\+")));
  assert.match(script, /buttonSize:\s*Math\.max\(48, Math\.min\(320/);
  assert.match(css, /--tdp-button-radius/);
  assert.match(css, /data-labels="hidden"/);
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

test("Ausführenmodus, Vollbild und berührbares Verschieben sind integriert", () => {
  assert.match(script, /let mode = "run"/);
  assert.match(script, /deck:execute-button/);
  assert.match(script, /window:toggle-fullscreen/);
  assert.match(script, /beginTouchMove/);
  assert.match(script, /finishTouchMove/);
  assert.match(script, /document\.getElementById\("view-deck"\)/);
  assert.match(css, /pointer:\s*coarse/);
  assert.match(css, /data-mode="run"/);
});

test("Produktionsvorbereitung kopiert und lädt beide V3-Dateien", () => {
  assert.match(prepare, /copyRequired\("touch-deck-v3\.css"\)/);
  assert.match(prepare, /copyRequired\("touch-deck-v3\.js"\)/);
  assert.match(prepare, /touch-deck-v3\.css/);
  assert.match(prepare, /touch-deck-v3\.js/);
});
