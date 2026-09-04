"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const sourceIconPath = path.join(root, "resources", "desktop-icon-source.b64");
const generatorPath = path.join(root, "scripts", "generate-icon.cjs");
const packagePath = path.join(root, "package.json");

if (!fs.existsSync(sourceIconPath)) throw new Error("Gelieferte Desktop-Icon-Quelle fehlt: resources/desktop-icon-source.b64");
const encoded = fs.readFileSync(sourceIconPath, "utf8").trim();
const icon = Buffer.from(encoded, "base64");
if (icon.length < 900) throw new Error(`Desktop-Icon-Quelle ist unerwartet klein: ${icon.length} Bytes`);
if (icon[0] !== 0xff || icon[1] !== 0xd8) throw new Error("Desktop-Icon-Quelle besitzt keinen gültigen JPEG-Header.");
if (!fs.existsSync(generatorPath)) throw new Error("Generator für das Windows-Icon fehlt.");
const generator = fs.readFileSync(generatorPath, "utf8");
if (!generator.includes("desktop-icon-source.b64")) throw new Error("Icon-Generator verwendet nicht das verbindliche Desktop-Bild.");
if (!generator.includes("width: 256") || !generator.includes("height: 256")) throw new Error("Der Icon-Generator erzeugt kein 256 × 256 Pixel großes Windows-Icon.");
for (const output of ["icon.png", "team-logo.png", "desktop-icon.jpg"]) {
  if (!generator.includes(output)) throw new Error(`Icon-Generator berücksichtigt ${output} nicht.`);
}

const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
if (packageJson.build?.win?.icon !== "build/icon.png") throw new Error("Das Windows-Programm verwendet nicht das erzeugte 256px-Icon build/icon.png.");
if (packageJson.build?.nsis?.installerIcon || packageJson.build?.nsis?.uninstallerIcon) throw new Error("NSIS muss das erzeugte App-Icon erben.");
if (!String(packageJson.scripts?.["predist:win"] || "").includes("generate-icon.cjs")) throw new Error("Das Desktop-Icon wird vor dem Windows-Build nicht erzeugt.");

console.log(`Crazy_Batto Desktop-Branding geprüft: Bildquelle ${icon.length} Bytes, 256px-App-Icon wird vor dem Build erzeugt und von NSIS übernommen.`);
