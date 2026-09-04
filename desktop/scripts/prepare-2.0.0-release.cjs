"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

require("./prepare-2.0.0-integrated.cjs");

const packagePath = path.join(root, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
packageJson.scripts = {
  ...(packageJson.scripts || {}),
  "prepare:release": "node scripts/prepare-2.0.0-release.cjs",
  "check:release": "node scripts/check-2.0.0.cjs",
  "test:release": "node --test test/*.test.cjs",
  "dist:release": "electron-builder --win nsis --x64"
};
packageJson.build = packageJson.build || {};
packageJson.build.extraResources = [
  { from: "resources/team-logo.svg", to: "team-logo.svg" },
  { from: "resources/plugin-catalog-2.0.json", to: "plugin-catalog-2.0.json" }
];
fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + "\n", "utf8");

const source = path.join(root, "src");
const forbiddenNames = [/Creator Hub\.exe/i, /Creator-Hub-\.apk/i];
for (const expression of forbiddenNames) {
  for (const file of fs.readdirSync(source, { recursive: true })) {
    if (expression.test(String(file))) throw new Error(`Veraltete veröffentlichte Datei gefunden: ${file}`);
  }
}

console.log("Batto OBS Tool 2.0.0: finale saubere Produktionsquelle erstellt.");
