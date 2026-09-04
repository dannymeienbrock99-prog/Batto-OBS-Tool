"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { v4Defaults, V4_MODULES } = require("../src/services/v4-config-store.cjs");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("V4 module config contains every required module", () => {
  const state = v4Defaults();
  const expected = ["general","appearance","multichat","moderation","chatFilter","chatDesign","cohost","liveTools","platforms","chatbot","autoBroadcast","commands","hotkeys","events","media","mediaPools","tts","obsHttp","overlays","discord","statusbar","logs","backup","advanced"];
  assert.deepEqual(V4_MODULES.map(([id]) => id), expected);
  for (const id of expected) assert.ok(state.modules[id], `missing V4 module ${id}`);
  assert.equal(state.modules.appearance.config.backgroundFile, "HIntergund.png");
  assert.equal(state.modules.appearance.config.tiles, false);
  assert.equal(state.modules.statusbar.config.enabled, false);
});

test("V4 full-window background is generated and old Multi Chat artwork is absent", () => {
  const background = path.join(root, "src/renderer/assets/HIntergund.png");
  assert.ok(fs.existsSync(background), "HIntergund.png was not generated during prepare");
  assert.ok(fs.statSync(background).size > 10000, "HIntergund.png is too small");
  assert.equal(fs.existsSync(path.join(root, "src/renderer/assets/multi-chat-hero.jpg")), false);
  const shell = read("src/renderer/v4-shell.css");
  const multi = read("src/renderer/multi-chat.css");
  assert.match(shell, /HIntergund\.png/);
  assert.doesNotMatch(multi, /multi-chat-hero/i);
});

test("V4 settings use module pages and required action buttons without raw JSON editor", () => {
  const ui = read("src/renderer/v4-settings.js");
  for (const word of ["HILFE","TESTEN","ZURÜCKSETZEN","ÜBERNEHMEN","SPEICHERN"]) assert.match(ui, new RegExp(word));
  assert.match(ui, /nicht als funktionierend simuliert/i);
  assert.doesNotMatch(ui, /<textarea/i);
  assert.match(read("src/preload.cjs"), /getV4Configs/);
  assert.match(read("src/main.cjs"), /v4-bootstrap\.cjs/);
});

test("V4 removed areas stay removed from the productive UI", () => {
  const visible = ["src/renderer/index.html","src/renderer/app.js","src/renderer/multi-chat.css","src/renderer/v4-settings.js","src/preload.cjs","src/main.cjs"].map(read).join("\n");
  assert.doesNotMatch(visible, /Hardware vollständig erfassen|Hardwarediagnose|PC vollständig scannen|PC jetzt scannen|multi-chat-hero/i);
  assert.doesNotMatch(visible, /Touch[ -]?Deck|Stream[ -]?Deck|deck-pro|deckStore|DeckStore|deck:/i);
});
