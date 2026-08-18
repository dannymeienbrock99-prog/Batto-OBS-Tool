"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const sourceIconPath = path.join(root, "build", "icon.ico");
const generatorPath = path.join(root, "scripts", "generate-icon.cjs");
const packagePath = path.join(root, "package.json");

if (!fs.existsSync(sourceIconPath)) throw new Error("Team-Alpha-Quellicon fehlt: build/icon.ico");
const icon = fs.readFileSync(sourceIconPath);
if (icon.length < 10_000) throw new Error(`Team-Alpha-Quellicon ist unerwartet klein: ${icon.length} Bytes`);
if (icon[0] !== 0x00 || icon[1] !== 0x00 || icon[2] !== 0x01 || icon[3] !== 0x00) {
  throw new Error("build/icon.ico besitzt keinen gültigen ICO-Header.");
}
const imageCount = icon.readUInt16LE(4);
if (imageCount < 1) throw new Error("build/icon.ico enthält kein Bild.");
if (icon.length < 6 + imageCount * 16) throw new Error("build/icon.ico besitzt ein abgeschnittenes Bildverzeichnis.");
const pngSignature = Buffer.from("89504e470d0a1a0a", "hex");
const pngEnd = Buffer.from("0000000049454e44ae426082", "hex");
let contains256 = false;
for (let index = 0; index < imageCount; index += 1) {
  const entry = 6 + index * 16;
  const width = icon[entry] || 256;
  const height = icon[entry + 1] || 256;
  const bytes = icon.readUInt32LE(entry + 8);
  const offset = icon.readUInt32LE(entry + 12);
  if (!bytes || offset < 6 + imageCount * 16 || offset + bytes > icon.length) {
    throw new Error(`build/icon.ico: Bild ${index + 1} zeigt außerhalb der Datei.`);
  }
  const image = icon.subarray(offset, offset + bytes);
  if (!image.subarray(0, pngSignature.length).equals(pngSignature) || !image.subarray(-pngEnd.length).equals(pngEnd)) {
    throw new Error(`build/icon.ico: PNG-Bild ${index + 1} ist abgeschnitten oder ungültig.`);
  }
  if (width === 256 && height === 256) contains256 = true;
}
if (!contains256) throw new Error("build/icon.ico enthält kein 256 × 256 Pixel großes Windows-Icon.");
if (!fs.existsSync(generatorPath)) throw new Error("Generator für das 256px-Team-Alpha-Logo fehlt.");
const generator = fs.readFileSync(generatorPath, "utf8");
if (!generator.includes("width: 256") || !generator.includes("height: 256")) {
  throw new Error("Der Logo-Generator erzeugt kein 256 × 256 Pixel großes Windows-Icon.");
}
for (const output of ["build/icon.png", "resources/team-logo.png", "src/renderer/assets/team-alpha-logo.png", "src/stream-overlay/team-logo.png"]) {
  if (!generator.includes(output.split("/").at(-1))) throw new Error(`Logo-Generator berücksichtigt ${output} nicht.`);
}

const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
if (packageJson.build?.win?.icon !== "build/icon.png") throw new Error("Das Windows-Programm verwendet nicht das erzeugte 256px-Logo build/icon.png.");
if (packageJson.build?.nsis?.installerIcon || packageJson.build?.nsis?.uninstallerIcon) {
  throw new Error("NSIS darf kein zu kleines separates Icon überschreiben, sondern muss das 256px-App-Logo erben.");
}
if (!String(packageJson.scripts?.["predist:win"] || "").includes("generate-icon.cjs")) {
  throw new Error("Das 256px-Logo wird vor dem Windows-Build nicht erzeugt.");
}

console.log(`Team-Alpha-Branding geprüft: Quellicon ${icon.length} Bytes, 256px-App-Logo wird vor dem Build erzeugt und von NSIS übernommen.`);
