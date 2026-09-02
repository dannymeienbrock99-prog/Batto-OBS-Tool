"use strict";
const fs = require("node:fs");
const path = require("node:path");
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
const registry = fs.readFileSync(path.join(production, "plugin-registry.cjs"), "utf8");
const additions = fs.readFileSync(path.join(production, "native-plugin-additions.cjs"), "utf8");
const executor = fs.readFileSync(path.join(production, "action-executor.cjs"), "utf8");
if (!registry.toLowerCase().includes(".streamdeckplugin")) throw new Error(".streamDeckPlugin-Prüfung fehlt nach Synchronisierung.");
for (const name of ["YouTube Music Desktop Connector","YouTube Ticker","iCUE","BambuLab Printer Monitor","Spotify","Volume Controller","Discord Volume Mixer","TikFinity","TikTok LIVE Studio","Polls, Word Clouds & Spinner Wheels"]) {
  if (!additions.includes(name)) throw new Error(`Native Plugin-Kompatibilität fehlt nach Synchronisierung: ${name}`);
}
for (const id of ["icue.launch","bambulab.launch","spotify.launch","volume.mixer","youtube.music.open","youtube.ticker.status"]) {
  if (!executor.includes(id)) throw new Error(`Native Aktionslaufzeit fehlt nach Synchronisierung: ${id}`);
}
console.log("Batto OBS Tool 2.0.0: native Plugin- und Aktionslaufzeit vollständig in Produktionsquelle synchronisiert.");
