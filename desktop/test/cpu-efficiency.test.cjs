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

test("Telemetrie sendet kompakte, adaptive und überlappungsfreie Updates", () => {
  assert.match(main, /webContents\.send\("telemetry:changed", payload\)/);
  assert.match(main, /telemetryInFlight/);
  assert.match(main, /mainWindow\.isMinimized\(\).*8000/s);
  assert.match(main, /:\s*2000/);
  assert.doesNotMatch(main, /setInterval\(\(\) => void refreshTelemetry\(\), 1000\)/);
  assert.match(preload, /ipcRenderer\.on\("telemetry:changed", listener\)/);
  assert.match(main, /backgroundThrottling:\s*true/);
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
