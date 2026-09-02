"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("TikTok moderation V2 exposes moderator account and dedicated chat filter", () => {
  const js = read("src/renderer/tiktok-moderation.js");
  const css = read("src/renderer/tiktok-moderation.css");
  assert.match(js, /BATTO_TIKTOK_MOD_UI_V2/);
  assert.match(js, /ttmod-login-name/);
  assert.match(js, /Moderator-Konto/);
  assert.match(js, /ttmod-filter-enabled/);
  assert.match(js, /ttmod-filter-mode/);
  assert.match(js, /Chat-Filter/);
  assert.match(css, /\.tiktok-mod-subsection/);
});

test("TikTok user name context menu contains moderation and moderator status", () => {
  const js = read("src/renderer/tiktok-moderation.js");
  assert.match(js, /tiktok-mod-user/);
  assert.match(js, /contextmenu/);
  assert.match(js, /5 Min\. stummschalten/);
  assert.match(js, /Nutzer sperren/);
  assert.match(js, /Moderator hinzufügen/);
  assert.match(js, /Moderator-Status prüfen/);
});

test("TikTok bans and mutes use separate real windows", () => {
  const main = read("src/main.cjs");
  const preload = read("src/preload.cjs");
  const html = read("src/renderer/tiktok-moderation-list.html");
  const js = read("src/renderer/tiktok-moderation-list.js");
  assert.match(main, /openTikTokModerationListWindow/);
  assert.match(main, /TikTok – Gesperrte Nutzer/);
  assert.match(main, /TikTok – Stummgeschaltete Nutzer/);
  assert.match(main, /tiktok:open-list-window/);
  assert.match(preload, /tiktok:open-list-window/);
  assert.match(html, /Nutzerliste/);
  assert.match(js, /tiktok:list-bans/);
  assert.match(js, /tiktok:list-mutes/);
  assert.match(js, /tiktok:unban/);
  assert.match(js, /tiktok:unmute/);
});
