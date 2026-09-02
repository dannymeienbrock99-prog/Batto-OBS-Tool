"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const root = path.resolve(__dirname, "..");
const bootstrap = path.join(root, "bootstrap-2.0", "src", "services");
const production = path.join(root, "src", "services");
const files = ["plugin-registry.cjs", "native-plugin-additions.cjs", "action-executor.cjs"];

fs.mkdirSync(production, { recursive: true });
for (const name of files) {
  const from = path.join(bootstrap, name);
  const to = path.join(production, name);
  if (!fs.existsSync(from)) throw new Error(`Plugin-Produktionsquelle fehlt: ${name}`);
  fs.copyFileSync(from, to);
}

const additions = fs.readFileSync(path.join(production, "native-plugin-additions.cjs"), "utf8");
const executor = fs.readFileSync(path.join(production, "action-executor.cjs"), "utf8");
for (const name of ["YouTube Music Desktop Connector","YouTube Ticker","iCUE","BambuLab Printer Monitor","Spotify","Volume Controller","Discord Volume Mixer","TikFinity","TikTok LIVE Studio","Polls, Word Clouds & Spinner Wheels"]) {
  if (!additions.includes(name)) throw new Error(`Native Plugin-Kompatibilität fehlt nach Synchronisierung: ${name}`);
}
for (const id of ["icue.launch","bambulab.launch","spotify.launch","volume.mixer","youtube.music.open","youtube.ticker.status"]) {
  if (!executor.includes(id)) throw new Error(`Native Aktionslaufzeit fehlt nach Synchronisierung: ${id}`);
}

const { PluginRegistry, normalizePlugin } = require(path.join(production, "plugin-registry.cjs"));
if (typeof PluginRegistry !== "function" || typeof normalizePlugin !== "function") {
  throw new Error("PluginRegistry oder Manifest-Normalisierung fehlt in der Produktionsquelle.");
}
if (typeof PluginRegistry.prototype.importPackage !== "function") {
  throw new Error("Echter .streamDeckPlugin-Importer fehlt in der Produktionsquelle.");
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "batto-plugin-selftest-"));
try {
  const pluginRoot = path.join(tempRoot, "com.crazybatto.selftest.sdPlugin");
  fs.mkdirSync(pluginRoot, { recursive: true });
  const manifestFile = path.join(pluginRoot, "manifest.json");
  fs.writeFileSync(manifestFile, JSON.stringify({
    UUID: "com.crazybatto.selftest",
    Name: "Batto Plugin Selftest",
    Author: "Crazy_Batto",
    Version: "1.0.0",
    Category: "Test",
    Actions: [{
      UUID: "com.crazybatto.selftest.action",
      Name: "Selftest Action",
      Tooltip: "Verifiziert Manifest- und Action-Registrierung",
      Controllers: ["Keypad", "Encoder"],
      States: [{ Title: "OK" }]
    }]
  }, null, 2));

  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  const normalized = normalizePlugin(manifest, manifestFile, tempRoot);
  if (normalized.id !== "com.crazybatto.selftest") throw new Error("Manifest-UUID wird nicht korrekt übernommen.");
  if (!Array.isArray(normalized.actions) || normalized.actions.length !== 1) throw new Error("Manifest-Actions werden nicht korrekt registriert.");
  if (normalized.actions[0].id !== "com.crazybatto.selftest.action") throw new Error("Action-UUID wird nicht korrekt übernommen.");
  if (!normalized.actions[0].controllers.includes("Encoder")) throw new Error("Controller-Metadaten aus manifest.json gehen verloren.");

  const registry = new PluginRegistry({
    stateFile: path.join(tempRoot, "plugin-state.json"),
    pluginRoots: [tempRoot],
    iconPackRoots: []
  });
  const snapshot = registry.scan();
  const loaded = snapshot.plugins.find((plugin) => plugin.id === "com.crazybatto.selftest");
  if (!loaded) throw new Error("Plugin wird nach dem Scan nicht in der Registry sichtbar.");
  if (!loaded.actions?.some((action) => action.id === "com.crazybatto.selftest.action")) {
    throw new Error("Plugin-Aktion wird nach dem Scan nicht im Touch-Deck-Datenmodell sichtbar.");
  }
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log("Batto OBS Tool 2.0.0: echter Plugin-Importer, Manifest-Leser und Action-Registrierung verifiziert.");
