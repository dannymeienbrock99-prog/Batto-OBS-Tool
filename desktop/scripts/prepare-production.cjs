"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const root = path.join(__dirname, "..");

async function patch(relative, transform) {
  const filename = path.join(root, relative);
  const before = await fs.readFile(filename, "utf8");
  const after = transform(before);
  if (after === before) {
    process.stdout.write(`Keine zusätzliche Änderung erforderlich: ${relative}\n`);
    return;
  }
  await fs.writeFile(filename, after, "utf8");
}

async function main() {
  await patch("src/renderer/app.js", (source) => source.replace(
    'byId("deck-action-type").addEventListener("change", fillDeckInspector);',
    'byId("deck-action-type").addEventListener("change", () => { byId("deck-value-row").hidden = !["obs:scene.set", "url"].includes(byId("deck-action-type").value); });'
  ));

  await patch("modules/encoder-monitoring-overlay/src/server.cjs", (source) => source.replace(
    "; frame-ancestors 'self' http://127.0.0.1:*",
    ""
  ));

  const appSource = await fs.readFile(path.join(root, "src", "renderer", "app.js"), "utf8");
  if (/addEventListener\("change", fillDeckInspector\)/.test(appSource)) {
    throw new Error("Touch-Deck-Aktionsauswahl wurde nicht korrigiert.");
  }
  const html = await fs.readFile(path.join(root, "src", "renderer", "index.html"), "utf8");
  if (/Creator[ -]?Hub|Testwerte anzeigen|Demo starten/i.test(html)) {
    throw new Error("Verbotene Alt- oder Demo-Bezeichnung in der produktiven Hauptoberfläche.");
  }
  process.stdout.write("Produktive Windows-Oberfläche final vorbereitet.\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
