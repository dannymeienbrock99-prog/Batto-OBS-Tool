"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = path.join(__dirname, "..", "src", "services", "hardware-enrichment-v2.cjs");

function load() {
  if (!fs.existsSync(source)) throw new Error("Hardware-Enrichment wurde nicht in die Produktionsquelle kopiert");
  delete require.cache[require.resolve(source)];
  return require(source);
}

test("nvidia-smi parser reads full RTX VRAM instead of a 32-bit WMI value", () => {
  const { parseNvidiaSmi } = load();
  const rows = parseNvidiaSmi("NVIDIA GeForce RTX 5080, 16303, 32.0.15.6889, 47, 22, 8, 2850, 15001, 182.4, 360.0, 35\n");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "NVIDIA GeForce RTX 5080");
  assert.equal(rows[0].memoryTotalMb, 16303);
  assert.ok(rows[0].memoryGb > 15.9);
  assert.equal(rows[0].dedicated, true);
  assert.equal(rows[0].integrated, false);
});

test("hardware integration is called by the production main process", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "src", "main.cjs"), "utf8");
  assert.match(main, /enrichHardware\(await hardwareApi\.collectHardware\(\)\)/);
});
