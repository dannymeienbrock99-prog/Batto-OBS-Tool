"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const bootstrap = path.join(root, "bootstrap-2.0");
const source = path.join(root, "src");
const modules = path.join(root, "modules");
const repoModules = path.resolve(root, "..", "modules");

function ensureDir(directory) { fs.mkdirSync(directory, { recursive: true }); }
function copy(sourcePath, destinationPath) {
  if (!fs.existsSync(sourcePath)) throw new Error(`Quelldatei fehlt: ${sourcePath}`);
  ensureDir(path.dirname(destinationPath));
  fs.cpSync(sourcePath, destinationPath, { recursive: true, force: true });
}
function copyFile(sourcePath, destinationPath) {
  if (!fs.existsSync(sourcePath)) throw new Error(`Quelldatei fehlt: ${sourcePath}`);
  ensureDir(path.dirname(destinationPath));
  fs.copyFileSync(sourcePath, destinationPath);
}
function writePatched(sourcePath, destinationPath, replacements = []) {
  let content = fs.readFileSync(sourcePath, "utf8");
  for (const [search, replacement] of replacements) {
    if (!content.includes(search)) throw new Error(`Erwarteter Quelltext fehlt in ${sourcePath}: ${search}`);
    content = content.replace(search, replacement);
  }
  ensureDir(path.dirname(destinationPath));
  fs.writeFileSync(destinationPath, content, "utf8");
}

ensureDir(source);
copy(path.join(bootstrap, "src", "services"), path.join(source, "services"));
copy(path.join(bootstrap, "src", "stream-overlay"), path.join(source, "stream-overlay"));
copy(path.join(bootstrap, "src", "mobile"), path.join(source, "mobile"));

writePatched(path.join(bootstrap, "src", "main-v2.cjs"), path.join(source, "main.cjs"), [
  ["obs: stateSnapshot().obs,", "obs: { ...obs.status(), currentScene: null, scenes: [] },"]
]);
copyFile(path.join(bootstrap, "src", "preload-v2.cjs"), path.join(source, "preload.cjs"));
copyFile(path.join(bootstrap, "src", "renderer", "index-v2.html"), path.join(source, "renderer", "index.html"));
copyFile(path.join(bootstrap, "src", "renderer", "styles.css"), path.join(source, "renderer", "styles.css"));
copyFile(path.join(bootstrap, "src", "renderer", "app.js"), path.join(source, "renderer", "app.js"));
copyFile(path.join(bootstrap, "src", "mobile", "index-v2.html"), path.join(source, "mobile", "index.html"));
copyFile(path.join(bootstrap, "src", "mobile", "styles-v2.css"), path.join(source, "mobile", "styles.css"));
copyFile(path.join(bootstrap, "src", "mobile", "app-v2.js"), path.join(source, "mobile", "app.js"));

const brand = path.join(bootstrap, "brand", "team-logo.svg");
for (const destination of [
  path.join(source, "renderer", "assets", "team-logo.svg"),
  path.join(source, "mobile", "team-logo.svg"),
  path.join(source, "stream-overlay", "team-logo.svg"),
  path.join(root, "resources", "team-logo.svg")
]) copyFile(brand, destination);

let mobileHtml = fs.readFileSync(path.join(source, "mobile", "index.html"), "utf8");
mobileHtml = mobileHtml.replace('../stream-overlay/team-logo.svg', './team-logo.svg');
fs.writeFileSync(path.join(source, "mobile", "index.html"), mobileHtml, "utf8");

if (fs.existsSync(repoModules)) {
  ensureDir(modules);
  for (const name of ["encoder-monitoring-overlay", "twitch-holo-chat"]) {
    const sourceModule = path.join(repoModules, name);
    const destinationModule = path.join(modules, name);
    if (fs.existsSync(sourceModule) && !fs.existsSync(destinationModule)) copy(sourceModule, destinationModule);
  }
}

const required = [
  "src/main.cjs",
  "src/preload.cjs",
  "src/renderer/index.html",
  "src/renderer/styles.css",
  "src/renderer/app.js",
  "src/renderer/assets/team-logo.svg",
  "src/mobile/index.html",
  "src/mobile/styles.css",
  "src/mobile/app.js",
  "src/stream-overlay/overlay.html",
  "src/stream-overlay/overlay.css",
  "src/stream-overlay/overlay.js",
  "src/stream-overlay/editor.html",
  "src/stream-overlay/editor.css",
  "src/stream-overlay/editor.js",
  "modules/encoder-monitoring-overlay/src/server.cjs",
  "modules/twitch-holo-chat/web/overlay.html",
  "resources/team-logo.svg"
];
for (const relative of required) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute) || fs.statSync(absolute).size === 0) throw new Error(`Integrierte Datei fehlt oder ist leer: ${relative}`);
}

const packagePath = path.join(root, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
packageJson.version = "2.0.0";
packageJson.productName = "Batto OBS Tool";
packageJson.build = packageJson.build || {};
packageJson.build.productName = "Batto OBS Tool";
packageJson.build.artifactName = "Batto-OBS-Tool-Setup-${version}.${ext}";
packageJson.build.asar = true;
packageJson.build.files = ["src/**/*", "modules/**/*", "resources/**/*", "package.json"];
packageJson.build.extraMetadata = { ...(packageJson.build.extraMetadata || {}), main: "src/main.cjs" };
packageJson.build.nsis = {
  ...(packageJson.build.nsis || {}),
  oneClick: false,
  perMachine: true,
  allowElevation: true,
  allowToChangeInstallationDirectory: true,
  createDesktopShortcut: true,
  createStartMenuShortcut: true,
  runAfterFinish: false,
  deleteAppDataOnUninstall: false,
  include: "build/installer.nsh"
};
fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + "\n", "utf8");

console.log("Batto OBS Tool 2.0.0: integrierte Quelle vollständig zusammengesetzt.");
