"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { app, nativeImage } = require("electron");

const root = path.resolve(__dirname, "..");
const brandSource = path.join(root, "build", "icon.ico");
const shortcutSource = path.join(root, "build", "shortcut-icon.png");
const shortcutOutput = path.join(root, "build", "icon.png");
const brandOutputs = [
  path.join(root, "resources", "team-logo.png"),
  path.join(root, "src", "renderer", "assets", "team-alpha-logo.png"),
  path.join(root, "src", "stream-overlay", "team-logo.png"),
  path.join(root, "src", "mobile", "team-logo.png")
];

function fail(message) {
  console.error(message);
  app.exit(1);
}

function png256(source, label) {
  if (!fs.existsSync(source)) throw new Error(`${label} fehlt: ${source}`);
  const image = nativeImage.createFromPath(source);
  if (image.isEmpty()) throw new Error(`${label} konnte nicht gelesen werden.`);
  const resized = image.resize({ width: 256, height: 256, quality: "best" });
  const png = resized.toPNG();
  if (!png || png.length < 10_000) throw new Error(`${label}: erzeugtes 256px-PNG ist ungültig oder zu klein: ${png?.length || 0} Bytes`);
  return png;
}

app.whenReady().then(() => {
  try {
    const shortcutPng = png256(shortcutSource, "Desktop-Verknüpfungsbild");
    fs.mkdirSync(path.dirname(shortcutOutput), { recursive: true });
    fs.writeFileSync(shortcutOutput, shortcutPng);

    const brandPng = png256(brandSource, "Team-Alpha-Quellicon");
    for (const output of brandOutputs) {
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, brandPng);
    }

    console.log(`Windows-Icon aus Desktop-Verknüpfungsbild erzeugt: 256 × 256, ${shortcutPng.length} Bytes. Team-Alpha-Branding separat: ${brandOutputs.length} Ziele.`);
    app.exit(0);
  } catch (error) {
    console.error(error?.stack || error);
    app.exit(1);
  }
});
