"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const script = fs.readFileSync(path.join(root, "bootstrap-2.0/src/renderer/touch-deck-v3.js"), "utf8");
const css = fs.readFileSync(path.join(root, "bootstrap-2.0/src/renderer/touch-deck-v3.css"), "utf8");
const actionExecutor = fs.readFileSync(path.join(root, "bootstrap-2.0/src/services/action-executor.cjs"), "utf8");
const prepare = fs.readFileSync(path.join(root, "scripts/prepare-touch-deck-v3.cjs"), "utf8");

test("Touch-Deck V3 JavaScript ist syntaktisch gültig", () => {
  assert.doesNotThrow(() => new vm.Script(script));
});

test("Touch-Deck kombiniert Pluginleiste, Deck und Inspector", () => {
  for (const marker of [
    "tdp-library", "tdp-search", "tdp-tab-actions", "tdp-tab-plugins",
    "tdp-grid", "tdp-inspector", "tdp-action-type", "tdp-action-properties", "tdp-save-key"
  ]) assert.match(script, new RegExp(marker));
  assert.match(css, /grid-template-columns:\s*minmax\(260px, 315px\)\s+minmax\(430px, 1fr\)\s+minmax\(300px, 340px\)/);
  assert.doesNotMatch(script, /Touch-Deck Pro/i);
});

test("Elgato-Plugins werden direkt im Touch-Deck geladen und konfiguriert", () => {
  for (const marker of [
    "plugins:import", "plugins:import-folder", "plugins:scan",
    "streamDeckPlugin", "sdPlugin", "propertyInspectorPath",
    "plugins:property-inspector", "tdp-open-property-inspector"
  ]) assert.match(script, new RegExp(marker.replace(/[.]/g, "\\."), "i"));
  assert.match(script, /Original-Plugin konfigurieren/);
  assert.match(css, /\.tdp-plugin-tools/);
  assert.match(css, /\.tdp-property-inspector-button/);
});

test("Aktionseinstellungen verwenden Formulare statt roher JSON-Eingabe", () => {
  for (const marker of [
    "nativeActionFields", "renderActionProperties", "readActionSettings",
    "tdp-key-value-row", "data-setting-key", "Aktion aktualisieren"
  ]) assert.match(script, new RegExp(marker));
  assert.match(script, /"obs\.scene"/);
  assert.match(script, /"system\.hotkey"/);
  assert.match(script, /"youtube\.chat\.send"/);
  assert.doesNotMatch(script, /tdp-action-settings|Einstellungen als JSON/);
});

test("Native Formularfelder entsprechen der tatsächlichen Ausführung", () => {
  assert.match(script, /key: "args"[^\n]+type: "lines"/);
  assert.match(script, /"overlay\.poll": \[[\s\S]*?key: "text"[\s\S]*?key: "value"/);
  assert.match(script, /"overlay\.wheel": \[\]/);
  assert.match(actionExecutor, /case "overlay\.poll"[\s\S]*?type: "poll"[\s\S]*?text: option/);
  assert.match(actionExecutor, /case "overlay\.wordcloud"[\s\S]*?type: "chat"[\s\S]*?touch-deck-wordcloud/);
  assert.match(actionExecutor, /case "overlay\.wheel"[\s\S]*?type: "wheel"/);
});

test("Property-Inspector-Rückgabe landet wieder in der Tastenaktion", () => {
  assert.match(script, /result\?\.settings/);
  assert.match(script, /renderActionProperties\(entry, savedSettings\)/);
  assert.match(script, /draft\.actions\[editingActionIndex\]\.settings = structuredClone\(savedSettings\)/);
});

test("SOTF-Plugin zeigt Verbindung und gebündelte Modulversion", () => {
  assert.match(script, /modules\?\.sotfDeathCounter/);
  assert.match(script, /sotf\.connected/);
  assert.match(script, /sotf\.bundle\?\.version/);
  assert.match(script, /sotf:install-module/);
  assert.match(script, /Installationspaket bereit/);
});

test("Status- und Eingabeänderungen vermeiden unnötige Komplett-Renderings", () => {
  assert.doesNotMatch(script, /pluginState\.scannedAt|plugins\.scannedAt/);
  assert.match(script, /\[sotf\.connected, sotf\.version/);
  assert.match(script, /\[deck\.version, deck\.updatedAt, deck\.activeProfileId\]/);
  assert.match(script, /function applyGridPresentation/);
  assert.match(script, /if \(capacityChanged\) renderGrid/);
  assert.match(script, /function updateKeyAppearance/);
  const draftUpdater = script.slice(script.indexOf("function updateDraftFromFields"), script.indexOf("function renderInspector"));
  assert.match(draftUpdater, /updateKeyAppearance/);
  assert.doesNotMatch(draftUpdater, /renderGrid/);
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
  assert.match(script, /if \(!used\) \{[\s\S]*?element\.replaceChildren\(\)/);
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
