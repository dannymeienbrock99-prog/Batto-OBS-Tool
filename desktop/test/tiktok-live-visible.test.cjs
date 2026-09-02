"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("TikTok moderation is visibly reachable from normal chat UI", () => {
  const js = read("src/renderer/tiktok-moderation.js");
  const css = read("src/renderer/tiktok-moderation.css");
  assert.match(js, /BATTO_TIKTOK_VISIBLE_MOD_V1/);
  assert.match(js, /TikTok MOD/);
  assert.match(js, /ttlive-strip/);
  assert.match(js, /Moderation & Filter/);
  assert.match(js, /liveStats/);
  assert.match(css, /\.ttmod-open-btn/);
  assert.match(css, /\.ttlive-strip/);
});

test("embedded main-window chat really loads TikTok moderation runtime", () => {
  const bootstrap = read("src/chat-bootstrap.cjs");
  assert.match(bootstrap, /BATTO_EMBEDDED_TIKTOK_MOD_V1/);
  assert.match(bootstrap, /tiktok-moderation\.js/);
  assert.match(bootstrap, /tiktok-moderation\.css/);
  assert.match(bootstrap, /moderation\.src='file:\/\/\$\{moderationPath\}'/);
});

test("TikTok live adapter still exposes gift and social live events", () => {
  const adapter = read("src/services/platforms/tiktok-adapter.cjs");
  assert.match(adapter, /["']gift["']/);
  assert.match(adapter, /["']social["']/);
  assert.match(adapter, /["']like["']/);
  assert.match(adapter, /["']member["']/);
  assert.match(adapter, /["']subscribe["']/);
});
