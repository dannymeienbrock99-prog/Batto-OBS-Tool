"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const iconPath = path.join(root, "build", "icon.ico");
const packagePath = path.join(root, "package.json");

if (!fs.existsSync(iconPath)) throw new Error("Windows-Icon fehlt: build/icon.ico");
const icon = fs.readFileSync(iconPath);
if (icon.length < 10_000) throw new Error(`Windows-Icon ist unerwartet klein: ${icon.length} Bytes`);
if (icon[0] !== 0x00 || icon[1] !== 0x00 || icon[2] !== 0x01 || icon[3] !== 0x00) {
  throw new Error("build/icon.ico besitzt keinen gültigen ICO-Header.");
}
const imageCount = icon.readUInt16LE(4);
if (imageCount < 1) throw new Error("build/icon.ico enthält kein Bild.");

const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
if (packageJson.build?.win?.icon !== "build/icon.ico") throw new Error("Das Windows-Programm verwendet nicht build/icon.ico.");
if (packageJson.build?.nsis?.installerIcon !== "build/icon.ico") throw new Error("Der Installer verwendet nicht build/icon.ico.");
if (packageJson.build?.nsis?.uninstallerIcon !== "build/icon.ico") throw new Error("Der Deinstaller verwendet nicht build/icon.ico.");

console.log(`Team-Alpha-Windows-Icon geprüft: ${icon.length} Bytes, ${imageCount} Bild(er).`);
