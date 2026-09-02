"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { app, nativeImage } = require("electron");

const root = path.resolve(__dirname, "..");
const sourceIconPath = path.join(root, "build", "icon.ico");
const shortcutSource = path.join(root, "build", "shortcut-icon.png");
const shortcutOutput = path.join(root, "build", "icon.png");
const brandOutputs = [
  path.join(root, "resources", "team-logo.png"),
  path.join(root, "src", "renderer", "assets", "team-alpha-logo.png"),
  path.join(root, "src", "stream-overlay", "team-logo.png"),
  path.join(root, "src", "mobile", "team-logo.png")
];

function loadImage(source, label) {
  if (!fs.existsSync(source)) throw new Error(`${label} fehlt: ${source}`);
  const image = nativeImage.createFromPath(source);
  if (image.isEmpty()) throw new Error(`${label} konnte nicht gelesen werden.`);
  return image;
}

app.whenReady().then(() => {
  try {
    // Das vorhandene ICO ist lesbar, war aber kleiner als die von electron-builder
    // geforderten 256 x 256 Pixel. Deshalb wird es vor JEDEM Windows-Build real
    // auf 256 x 256 skaliert und als echtes Windows-ICO zurückgeschrieben.
    const brandImage = loadImage(sourceIconPath, "Windows-Quellicon");
    const icon256 = brandImage.resize({ width: 256, height: 256, quality: "best" });
    const ico = icon256.toICO();
    if (!ico || ico.length < 10_000 || ico[0] !== 0x00 || ico[1] !== 0x00 || ico[2] !== 0x01 || ico[3] !== 0x00) {
      throw new Error(`256px-Windows-ICO konnte nicht erzeugt werden (${ico?.length || 0} Bytes).`);
    }
    fs.writeFileSync(sourceIconPath, ico);

    // Das gewünschte Desktop-Verknüpfungsbild bleibt als Branding-Quelle im Build.
    // Es wird nicht mehr von electron-builder als Icon dekodiert; damit kann eine
    // fehlerhafte PNG-Kompression den Windows-Build nicht mehr blockieren.
    if (fs.existsSync(shortcutSource)) {
      const shortcutPng = fs.readFileSync(shortcutSource);
      fs.writeFileSync(shortcutOutput, shortcutPng);
    }

    const brandPng = icon256.toPNG();
    for (const output of brandOutputs) {
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, brandPng);
    }

    console.log(`Windows-ICO erzeugt: 256 x 256, ${ico.length} Bytes. Branding synchronisiert: ${brandOutputs.length} Ziele.`);
    app.exit(0);
  } catch (error) {
    console.error(error?.stack || error);
    app.exit(1);
  }
});
