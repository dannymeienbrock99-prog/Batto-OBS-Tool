"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const sourceIconPath = path.join(root, "build", "icon.ico");
const shortcutSourcePath = path.join(root, "build", "shortcut-icon.jpg");
const generatorPath = path.join(root, "scripts", "generate-icon.cjs");
const packagePath = path.join(root, "package.json");

if (!fs.existsSync(sourceIconPath)) throw new Error("Team-Alpha-Quellicon fehlt: build/icon.ico");
const icon = fs.readFileSync(sourceIconPath);
if (icon.length < 10_000) throw new Error(`Team-Alpha-Quellicon ist unerwartet klein: ${icon.length} Bytes`);
if (icon[0] !== 0x00 || icon[1] !== 0x00 || icon[2] !== 0x01 || icon[3] !== 0x00) throw new Error("build/icon.ico besitzt keinen gültigen ICO-Header.");
const imageCount = icon.readUInt16LE(4);
if (imageCount < 1) throw new Error("build/icon.ico enthält kein Bild.");

if (!fs.existsSync(shortcutSourcePath)) throw new Error("Desktop-Verknüpfungsbild fehlt: build/shortcut-icon.jpg");
const shortcut = fs.readFileSync(shortcutSourcePath);
if (shortcut.length < 10_000 || shortcut[0] !== 0xff || shortcut[1] !== 0xd8 || shortcut[shortcut.length - 2] !== 0xff || shortcut[shortcut.length - 1] !== 0xd9) {
  throw new Error("build/shortcut-icon.jpg ist kein vollständiges JPEG.");
}

if (!fs.existsSync(generatorPath)) throw new Error("Generator für das 256px-Windows-Icon fehlt.");
const generator = fs.readFileSync(generatorPath, "utf8");
if (!generator.includes("width: 256") || !generator.includes("height: 256")) throw new Error("Der Icon-Generator erzeugt kein 256 × 256 Pixel großes Windows-Icon.");
if (!generator.includes("shortcut-icon.jpg")) throw new Error("Der Icon-Generator verwendet nicht das gewünschte Desktop-Verknüpfungsbild.");
for (const filename of ["icon.png", "team-logo.png", "team-alpha-logo.png"]) {
  if (!generator.includes(filename)) throw new Error(`Icon-Generator berücksichtigt ${filename} nicht.`);
}

const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
if (packageJson.build?.win?.icon !== "build/icon.png") throw new Error("Das Windows-Programm verwendet nicht das erzeugte Desktop-Icon build/icon.png.");
if (packageJson.build?.nsis?.installerIcon || packageJson.build?.nsis?.uninstallerIcon) {
  throw new Error("NSIS darf kein separates Icon überschreiben, sondern muss das Windows-App-Icon erben.");
}
if (!String(packageJson.scripts?.["predist:win"] || "").includes("generate-icon.cjs")) throw new Error("Das Windows-Icon wird vor dem Windows-Build nicht erzeugt.");

console.log(`Branding geprüft: Desktop-Verknüpfungsbild ${shortcut.length} Bytes -> build/icon.png; Team-Alpha-Logo bleibt separat.`);
