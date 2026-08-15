"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const root = path.join(__dirname, "..");

async function read(relative) {
  return fs.readFile(path.join(root, relative), "utf8");
}

async function write(relative, content) {
  return fs.writeFile(path.join(root, relative), content, "utf8");
}

function replaceRequired(source, expression, replacement, label) {
  const next = source.replace(expression, replacement);
  if (next === source) throw new Error(`Produktionsvorbereitung fehlgeschlagen: ${label}`);
  return next;
}

async function prepareMonitoring() {
  const htmlPath = "modules/encoder-monitoring-overlay/web/editor.html";
  const jsPath = "modules/encoder-monitoring-overlay/web/editor.js";
  const serverPath = "modules/encoder-monitoring-overlay/src/server.cjs";
  let html = await read(htmlPath);
  let js = await read(jsPath);
  let server = await read(serverPath);

  html = html.replace(/\s*<button id="show-test-values"[^>]*>[^<]*<\/button>/, "");
  js = js.replace(/\s*showTestValues:\s*byId\("show-test-values"\),?\n/, "\n");
  js = js.replace(/\n\s*async function showTestValues\(\) \{[\s\S]*?\n\s*function switchProfile\(/, "\n\n  function switchProfile(");
  js = js.replace(/\n\s*ui\.showTestValues\.addEventListener\([^\n]+\);/, "");
  server = server.replace(/,\s*createTestTelemetry\s*\n?\}/, "\n}");
  server = server.replace(/\n\s*if \(request\.method === "POST" && pathname === "\/api\/test"\) \{[\s\S]*?\n\s*\}/, "");

  await Promise.all([
    write(htmlPath, html),
    write(jsPath, js),
    write(serverPath, server)
  ]);
}

async function prepareHolo() {
  const overlayPath = "modules/twitch-holo-chat/web/overlay.js";
  let source = await read(overlayPath);
  source = source.replace(/\n\s*if \(query\.get\("demo"\) === "1"\) \{[\s\S]*?\n\s*\}\n\}\)\(\);/, "\n})();");
  await write(overlayPath, source);
}

async function verifyProduction() {
  const files = [
    "src/main.cjs",
    "src/preload.cjs",
    "src/renderer/index.html",
    "src/renderer/app.js",
    "modules/encoder-monitoring-overlay/web/editor.html",
    "modules/encoder-monitoring-overlay/web/editor.js",
    "modules/encoder-monitoring-overlay/src/server.cjs"
  ];
  for (const file of files) {
    const content = await read(file);
    if (/Creator[ -]?Hub/i.test(content)) {
      throw new Error(`Verbotene Altbezeichnung in ${file}`);
    }
  }
  const monitoringHtml = await read("modules/encoder-monitoring-overlay/web/editor.html");
  const monitoringJs = await read("modules/encoder-monitoring-overlay/web/editor.js");
  if (/show-test-values|Testwerte anzeigen/i.test(`${monitoringHtml}\n${monitoringJs}`)) {
    throw new Error("Der sichtbare Monitoring-Demomodus wurde nicht vollständig entfernt.");
  }
}

async function main() {
  await prepareMonitoring();
  await prepareHolo();
  await verifyProduction();
  process.stdout.write("Batto-Module für den produktiven Windows-Installer vorbereitet.\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
