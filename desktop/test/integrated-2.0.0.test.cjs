"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { obsAuthentication, normalizeLocalObsHost, buildObsWebSocketUrl } = require("../src/services/obs-websocket.cjs");
const { normalizeState } = require("../src/services/store.cjs");

test("OBS connection is local, authenticated and IPv6-safe", () => {
  assert.equal(normalizeLocalObsHost("2003:f8:3733:8662:183e:947b:4c84:e8f7"), "127.0.0.1");
  assert.equal(normalizeLocalObsHost("192.168.2.121"), "127.0.0.1");
  assert.equal(normalizeLocalObsHost("[::1]"), "::1");
  assert.equal(buildObsWebSocketUrl("::1", 4455), "ws://[::1]:4455");
  assert.equal(buildObsWebSocketUrl("127.0.0.1", 4455), "ws://127.0.0.1:4455");
  assert.equal(obsAuthentication("pass", "salt", "challenge"), "EabUNw4z9EKKpEOC0yvqBO8dJPSIcTb82eo+adWKOvk=");
});

test("settings normalization keeps supported application preferences", () => {
  const state = normalizeState({
    obs: { host: "localhost", port: 4455 },
    preferences: { platform: "youtube", targetResolution: "2560x1440", targetFps: 60 }
  });
  assert.equal(state.obs.host, "127.0.0.1");
  assert.equal(state.obs.port, 4455);
  assert.equal(state.preferences.platform, "youtube");
});

test("production UI uses Batto branding and removed areas stay absent", () => {
  const root = path.join(__dirname, "..");
  const visible = ["src/renderer/index.html", "src/renderer/app.js", "src/renderer/multi-chat.js", "src/renderer/chat-bot.js"]
    .map((relative) => fs.readFileSync(path.join(root, relative), "utf8")).join("\n");
  assert.doesNotMatch(visible, /Creator Hub/i);
  assert.doesNotMatch(visible, /Hardwarediagnose|Hardware vollständig erfassen|PC vollständig scannen|PC jetzt scannen|Hardware-Scan|Windows-Diagnose|Encoder-Empfehlung|Belastungstest|Monitoring-Overlay|Encoder- und Hardware-Monitoring|Realer Belastungs- und OBS-Aufnahmetest/i);
  assert.match(visible, /Batto OBS Tool/i);
  assert.match(visible, /BATTO CHAT BOT/i);
  assert.match(visible, /BATTO MULTI-CHAT/i);
});
