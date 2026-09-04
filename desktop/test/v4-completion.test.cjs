"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { v4Defaults, V4_MODULES } = require("../src/services/v4-config-store.cjs");
const { V4Operations, BACKUP_SIGNATURE, buildCohostLayout } = require("../src/services/v4-operations.cjs");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("all V4 modules have a real local implementation state", () => {
  const state = v4Defaults();
  assert.equal(state.version, 4);
  assert.equal(V4_MODULES.length, 24);
  for (const [id] of V4_MODULES) {
    assert.ok(state.modules[id], `missing module ${id}`);
    assert.equal(state.modules[id].status, "bereit", `${id} is not ready`);
  }
  assert.equal(state.modules.appearance.config.backgroundFile, "HIntergund.png");
  assert.equal(state.modules.cohost.config.defaultFormat, "tiktok");
  assert.equal(state.modules.cohost.config.slots, 4);
  assert.equal(state.modules.statusbar.config.enabled, true);
});

test("Co-Host layout produces exact TikTok and Twitch canvases", () => {
  const tiktok = buildCohostLayout({ format: "tiktok", slots: 4, layout: "2x2", gap: 10 });
  assert.equal(tiktok.width, 1080);
  assert.equal(tiktok.height, 1920);
  assert.equal(tiktok.frames.length, 4);
  assert.equal(tiktok.columns, 2);
  assert.equal(tiktok.rows, 2);
  for (const frame of tiktok.frames) {
    assert.ok(frame.x >= 0 && frame.y >= 0);
    assert.ok(frame.x + frame.width <= tiktok.width);
    assert.ok(frame.y + frame.height <= tiktok.height);
  }

  const twitch = buildCohostLayout({ format: "twitch", slots: 4, layout: "2x2", gap: 12 });
  assert.equal(twitch.width, 1920);
  assert.equal(twitch.height, 1080);
  assert.equal(twitch.frames.length, 4);
});

test("V4 media library and backup round-trip work without hidden JSON UI", async () => {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), "batto-v4-test-"));
  try {
    const state = v4Defaults();
    const configStore = {
      get(id) { return JSON.parse(JSON.stringify(state.modules[id])); },
      async load() { return state; }
    };
    const logs = [];
    const logStore = { async append(category, level, message, details) { logs.push({ category, level, message, details }); } };
    const operations = new V4Operations({ userData: temp, configStore, logStore });
    await fsp.mkdir(operations.mediaRoot, { recursive: true });

    const source = path.join(temp, "sample.mp3");
    await fsp.writeFile(source, Buffer.from("batto-media-test"));
    const imported = await operations.importMedia([source]);
    assert.deepEqual(imported.imported, ["sample.mp3"]);
    assert.equal(imported.files.length, 1);

    await fsp.writeFile(path.join(temp, "v4-module-config.json"), JSON.stringify(state), "utf8");
    const backup = await operations.createBackup();
    assert.equal(backup.signature, BACKUP_SIGNATURE);
    assert.ok(backup.files["v4-module-config.json"]);
    assert.equal(backup.media.length, 1);

    const backupFile = path.join(temp, "backup.json");
    await operations.writeBackup(backupFile);
    await fsp.rm(path.join(operations.mediaRoot, "sample.mp3"));
    const restored = await operations.restoreBackup(backupFile);
    assert.equal(restored.restored, true);
    assert.equal(restored.restartRequired, true);
    assert.equal(fs.existsSync(path.join(operations.mediaRoot, "sample.mp3")), true);
    assert.ok(logs.some((entry) => entry.category === "backup"));
  } finally {
    await fsp.rm(temp, { recursive: true, force: true });
  }
});

test("V4 completion UI exposes real operation buttons and platform event mapping", () => {
  const settings = read("src/renderer/v4-settings.js");
  const preload = read("src/preload.cjs");
  const bootstrap = read("src/chat-bootstrap.cjs");
  for (const text of ["DATEIEN IMPORTIEREN", "POOL IM CHAT BOT SPEICHERN", "BACKUP EXPORTIEREN", "HTTP KOPIEREN", "FILTER TESTEN"]) assert.match(settings, new RegExp(text));
  assert.doesNotMatch(settings, /textarea[^>]*json|JSON-Pflicht/i);
  for (const bridge of ["getV4Media", "importV4Media", "getCohostStatus", "exportV4Backup", "importV4Backup", "testChatFilter"]) assert.match(preload, new RegExp(bridge));
  assert.match(bootstrap, /platformEvent/);
  assert.match(bootstrap, /chatBot\.triggerEvent/);
});

test("removed product areas cannot be rebuilt by the current main release tree", () => {
  assert.equal(fs.existsSync(path.join(root, "src/services/hardware.cjs")), false);
  assert.equal(fs.existsSync(path.join(root, "src/services/recommendation.cjs")), false);
  assert.equal(fs.existsSync(path.join(root, "src/services/telemetry.cjs")), false);
  assert.equal(fs.existsSync(path.join(root, "modules/encoder-monitoring-overlay")), false);
  assert.equal(fs.existsSync(path.resolve(root, "../.github/workflows/encoder-monitoring-overlay.yml")), false);
  const visible = ["src/renderer/index.html", "src/renderer/app.js", "src/renderer/v4-settings.js", "src/preload.cjs", "src/main.cjs"].map(read).join("\n");
  assert.doesNotMatch(visible, /Touch[ -]?Deck|Stream[ -]?Deck|deck-pro|deckStore|DeckStore|deck:/i);
  assert.doesNotMatch(visible, /Hardwarediagnose|Encoder-Empfehlung|Realer Belastungs|Encoder- und Hardware-Monitoring|Monitoring-Overlay/i);
});
