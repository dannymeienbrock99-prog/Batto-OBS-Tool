"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.join(__dirname, "..");

async function patch(relative, transform) {
  const filename = path.join(root, relative);
  const before = await fs.readFile(filename, "utf8");
  const after = transform(before);
  if (after !== before) await fs.writeFile(filename, after, "utf8");
}

async function main() {
  await patch("src/services/recommendation.cjs", (source) => source.replace(
    'if (uploadMbps > 0 && uploadMbps * 1000 < bitrateKbps / 0.72) {',
    'if (uploadMbps > 0 && platform !== "recording" && bitrateKbps < bitrateFor({ platform, resolution, fps, uploadMbps: 100000 })) {'
  ));

  await patch("modules/encoder-monitoring-overlay/web/editor.js", (source) => source
    .replace(/\s*showTestValues:\s*byId\("show-test-values"\),?\n/, "\n")
    .replace(/\n\s*async function showTestValues\(\) \{[\s\S]*?\n\s*function switchProfile\(/, "\n\n  function switchProfile(")
    .replace(/\n\s*ui\.showTestValues\.addEventListener\([^\n]+\);/, "")
  );

  await patch("modules/encoder-monitoring-overlay/web/editor.html", (source) => source.replace(
    /\s*<button id="show-test-values"[^>]*>[^<]*<\/button>/,
    ""
  ));

  const files = [
    "src/main.cjs",
    "src/preload.cjs",
    "src/services/hardware.cjs",
    "src/services/obs-websocket.cjs",
    "src/services/recommendation.cjs",
    "src/services/secret-store.cjs",
    "src/services/store.cjs",
    "src/services/telemetry.cjs",
    "src/services/twitch-holo-server.cjs",
    "src/renderer/app.js",
    "modules/encoder-monitoring-overlay/src/server.cjs",
    "modules/encoder-monitoring-overlay/src/telemetry.cjs",
    "modules/encoder-monitoring-overlay/src/layout-engine.cjs",
    "modules/encoder-monitoring-overlay/src/metric-catalog.cjs",
    "modules/encoder-monitoring-overlay/web/editor.js",
    "modules/encoder-monitoring-overlay/web/overlay.js",
    "modules/twitch-holo-chat/src/holo-style-engine.cjs",
    "modules/twitch-holo-chat/web/editor.js",
    "modules/twitch-holo-chat/web/overlay.js"
  ];
  for (const relative of files) {
    execFileSync(process.execPath, ["--check", path.join(root, relative)], { stdio: "inherit" });
  }

  const recommendation = require(path.join(root, "src", "services", "recommendation.cjs"));
  const limited = recommendation.buildRecommendation({
    platform: "youtube",
    resolution: "2560x1440",
    fps: 60,
    uploadMbps: 10,
    gpu: { name: "NVIDIA GeForce RTX 5080" }
  });
  if (limited.settings.bitrateKbps !== 7200 || !limited.notes.some((note) => /begrenzt/i.test(note))) {
    throw new Error("Upload-Begrenzung der Encoder-Empfehlung ist nicht korrekt.");
  }
  process.stdout.write("Release-Hotfix und Modul-Syntaxprüfung erfolgreich.\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
