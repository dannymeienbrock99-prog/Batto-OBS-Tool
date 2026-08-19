"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const main = read("src/main.cjs");
const preload = read("src/preload.cjs");
const hardware = read("src/services/hardware.cjs");
const sotf = read("src/services/sotf-death-counter-client.cjs");
const pluginHost = read("src/services/stream-deck-plugin-host.cjs");
const multiChat = read("bootstrap-2.0/src/services/multi-chat.cjs");
const streamOverlayCss = read("src/stream-overlay/overlay.css");
const streamOverlayJs = read("src/stream-overlay/overlay.js");
const holoCss = read("modules/twitch-holo-chat/web/overlay.css");

test("Telemetrie sendet kompakte, adaptive und überlappungsfreie Updates", () => {
  assert.match(main, /webContents\.send\("telemetry:changed", payload\)/);
  assert.match(main, /telemetryInFlight/);
  assert.match(main, /mainWindow\.isMinimized\(\).*8000/s);
  assert.match(main, /:\s*2000/);
  assert.doesNotMatch(main, /setInterval\(\(\) => void refreshTelemetry\(\), 1000\)/);
  assert.match(preload, /ipcRenderer\.on\("telemetry:changed", listener\)/);
  assert.match(main, /backgroundThrottling:\s*true/);
  assert.match(main, /decryptedSecretsCache/, "Status-Updates dürfen safeStorage nicht fortlaufend neu entschlüsseln");
});

test("teure Windows-Hardwareabfragen werden gecacht", () => {
  assert.match(hardware, /gpuIntervalMs = 5000/);
  assert.match(hardware, /networkIntervalMs = 10000/);
  assert.match(hardware, /latencyIntervalMs = 30000/);
  assert.match(hardware, /queryGpu \? queryNvidia\(\)/);
  assert.match(hardware, /queryNetwork \? queryNetworkTotals\(\)/);
});

test("SOTF und Original-Plugins besitzen Leerlaufbremsen", () => {
  assert.match(sotf, /offlineIntervalMs = 15000/);
  assert.match(sotf, /scheduleNextRefresh/);
  assert.doesNotMatch(sotf, /setInterval/);
  assert.match(pluginHost, /idleTimeoutMs = 120000/);
  assert.match(pluginHost, /scheduleSessionIdle/);
  assert.match(pluginHost, /Plugin wegen Inaktivität beendet/);
});

test("Multi-Chat polls sequentially and releases network and TTS workers", () => {
  assert.doesNotMatch(multiChat, /setInterval/);
  assert.match(multiChat, /youtubeAbortController/);
  assert.match(multiChat, /youtubeGeneration/);
  assert.match(multiChat, /scheduleTtsIdleStop/);
  assert.match(multiChat, /ttsIdleTimer/);
  assert.match(multiChat, /pumpTts\(\{ emit: false \}\)/);
});

test("OBS-Overlays animieren Messwerte und Hologramm nur ereignisbezogen", () => {
  assert.match(streamOverlayCss, /\.heart\.is-beating \.pulse[^}]*animation:[^;}]+\s1\s*;/s);
  assert.doesNotMatch(streamOverlayCss, /heart[^}]*animation:[^;}]*infinite/is);
  assert.match(streamOverlayJs, /ingest\(event, \{ renderNow = true \}/);
  assert.match(streamOverlayJs, /render\(\{ heartBeat \}\)/);
  assert.match(holoCss, /\.batto-holo-text[^}]*animation:[^;}]+\s1\s+both/s);
  assert.doesNotMatch(holoCss, /\.batto-holo-text[^}]*animation:[^;}]*infinite/is);
  const activeBackdropFilters = [...holoCss.matchAll(/backdrop-filter\s*:\s*([^;}]+)/gi)]
    .map((match) => match[1].trim().toLowerCase())
    .filter((value) => value !== "none");
  assert.deepEqual(activeBackdropFilters, []);
});
