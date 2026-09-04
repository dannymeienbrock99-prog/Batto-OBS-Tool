"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { SettingsStore, normalizeState } = require("../src/services/store.cjs");

test("settings normalization keeps supported preferences", () => {
  const state = normalizeState({
    obs: { host: "localhost", port: 4455 },
    preferences: {
      platform: "youtube",
      targetResolution: "2560x1440",
      targetFps: 60,
      monitoringEnabled: true,
      twitchHoloEnabled: false
    }
  });
  assert.equal(state.obs.host, "127.0.0.1");
  assert.equal(state.obs.port, 4455);
  assert.equal(state.preferences.platform, "youtube");
  assert.equal(state.preferences.targetResolution, "2560x1440");
  assert.equal(state.preferences.targetFps, 60);
  assert.equal(state.preferences.monitoringEnabled, true);
  assert.equal(state.preferences.twitchHoloEnabled, false);
});

test("settings are written atomically and can be loaded again", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "batto-store-"));
  const filename = path.join(directory, "settings.json");
  const store = new SettingsStore(filename);
  const saved = await store.set({
    preferences: {
      platform: "youtube",
      targetResolution: "1920x1080",
      targetFps: 60
    }
  });
  assert.equal(saved.preferences.platform, "youtube");
  const reloaded = new SettingsStore(filename);
  const value = await reloaded.get();
  assert.equal(value.preferences.platform, "youtube");
  assert.equal(value.preferences.targetResolution, "1920x1080");
  assert.equal(value.preferences.targetFps, 60);
});
