"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const file = path.join(root, "src", "services", "action-executor.cjs");
if (!fs.existsSync(file)) throw new Error("ActionExecutor fehlt.");
let text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");

function insertBeforeToggle(toggleType, startType, startRequest, stopType, stopRequest) {
  if (text.includes(`case "${startType}"`) && text.includes(`case "${stopType}"`)) return;
  const pattern = new RegExp(`(^[ \\t]*)case "${toggleType.replaceAll(".", "\\.")}":\\n\\1  return this\\.obs\\.[A-Za-z0-9_]+\\(\\);`, "m");
  const match = text.match(pattern);
  if (!match) throw new Error(`OBS-Aktions-Patchpunkt fehlt: ${toggleType}`);
  const indent = match[1];
  const original = match[0];
  const replacement = `${indent}case "${startType}":\n${indent}  return this.obs.call("${startRequest}");\n${indent}case "${stopType}":\n${indent}  return this.obs.call("${stopRequest}");\n${original}`;
  text = text.replace(pattern, replacement);
}

insertBeforeToggle("obs.stream.toggle", "obs.stream.start", "StartStream", "obs.stream.stop", "StopStream");
insertBeforeToggle("obs.record.toggle", "obs.record.start", "StartRecord", "obs.record.stop", "StopRecord");
insertBeforeToggle("obs.virtualcam.toggle", "obs.virtualcam.start", "StartVirtualCam", "obs.virtualcam.stop", "StopVirtualCam");

for (const token of [
  'case "obs.stream.start"', 'case "obs.stream.stop"',
  'case "obs.record.start"', 'case "obs.record.stop"',
  'case "obs.virtualcam.start"', 'case "obs.virtualcam.stop"'
]) {
  if (!text.includes(token)) throw new Error(`Classic Touch-Deck-Aktion fehlt nach Patch: ${token}`);
}

fs.writeFileSync(file, text, "utf8");
console.log("Classic Touch-Deck: OBS Start/Stop für Stream, Aufnahme und virtuelle Kamera eingebaut.");
