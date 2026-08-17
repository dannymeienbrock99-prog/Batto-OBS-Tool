"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const bootstrap = path.join(root, "bootstrap-2.0", "src");
const source = path.join(root, "src");

function copyFile(from, to) {
  if (!fs.existsSync(from)) throw new Error(`Quelldatei fehlt: ${path.relative(root, from)}`);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function patch(file, before, after, label) {
  let text = fs.readFileSync(file, "utf8");
  if (text.includes(after)) return;
  if (!text.includes(before)) throw new Error(`${label} wurde in ${path.relative(root, file)} nicht gefunden.`);
  text = text.replace(before, after);
  fs.writeFileSync(file, text, "utf8");
}

copyFile(path.join(bootstrap, "services", "native-plugin-additions.cjs"), path.join(source, "services", "native-plugin-additions.cjs"));

const registry = path.join(source, "services", "plugin-registry.cjs");
patch(
  registry,
  'const { ensureDirectory, readJson, safeText, writeJsonAtomic } = require("./common.cjs");',
  'const { ensureDirectory, readJson, safeText, writeJsonAtomic } = require("./common.cjs");\nconst { EXTRA_BUILT_IN_PLUGINS } = require("./native-plugin-additions.cjs");',
  "Native Plugin-Erweiterungen"
);
patch(
  registry,
  'const plugins = [...BUILT_IN_PLUGINS.map((plugin) => ({ ...plugin, actions: plugin.actions.map((action) => ({ ...action })) }))];',
  'const plugins = [...BUILT_IN_PLUGINS, ...EXTRA_BUILT_IN_PLUGINS].map((plugin) => ({ ...plugin, actions: plugin.actions.map((action) => ({ ...action })) }));',
  "Zusammenführung der nativen Plugin-Liste"
);

const executor = path.join(source, "services", "action-executor.cjs");
patch(
  executor,
  '    spotify: [path.join(process.env.APPDATA || "", "Spotify", "Spotify.exe"), path.join(local, "Microsoft", "WindowsApps", "Spotify.exe")]\n  };',
  '    spotify: [path.join(process.env.APPDATA || "", "Spotify", "Spotify.exe"), path.join(local, "Microsoft", "WindowsApps", "Spotify.exe")],\n    icue: [path.join(programFiles, "Corsair", "Corsair iCUE5 Software", "iCUE.exe"), path.join(programFiles, "Corsair", "CORSAIR iCUE 4 Software", "iCUE.exe")],\n    bambulab: [path.join(programFiles, "Bambu Studio", "bambu-studio.exe"), path.join(local, "Programs", "Bambu Studio", "bambu-studio.exe")],\n    youtubeMusic: [path.join(local, "Programs", "YouTube Music Desktop App", "YouTube Music Desktop App.exe"), path.join(local, "Programs", "YouTube Music", "YouTube Music.exe"), path.join(process.env.APPDATA || "", "YouTube Music", "YouTube Music.exe")]\n  };',
  "Erkennung zusätzlicher Desktop-Programme"
);
patch(
  executor,
  '      case "discord.webhook": {',
  '      case "volume.mixer":\n      case "discord.volume.mixer": {\n        childProcess.spawn("sndvol.exe", [], { detached: true, stdio: "ignore", windowsHide: true }).unref();\n        return { executable: "sndvol.exe" };\n      }\n      case "spotify.launch": {\n        const executable = installedProgramCandidates("spotify");\n        if (executable) childProcess.spawn(executable, [], { detached: true, stdio: "ignore", windowsHide: true }).unref();\n        else await this.shell.openExternal("spotify:");\n        return { executable: executable || "spotify:" };\n      }\n      case "icue.launch":\n      case "icue.profile": {\n        const executable = installedProgramCandidates("icue");\n        if (!executable) throw new Error("Corsair iCUE wurde nicht gefunden.");\n        const args = type === "icue.profile" && settings.profile ? ["--profile", String(settings.profile)] : [];\n        childProcess.spawn(executable, args, { detached: true, stdio: "ignore", windowsHide: true }).unref();\n        return { executable, args };\n      }\n      case "bambulab.launch":\n      case "bambulab.monitor": {\n        const executable = installedProgramCandidates("bambulab");\n        if (!executable) throw new Error("Bambu Studio wurde nicht gefunden. Ein Druckerstatus wird ohne lokale Bambu-Verbindung nicht vorgetäuscht.");\n        childProcess.spawn(executable, [], { detached: true, stdio: "ignore", windowsHide: true }).unref();\n        return { executable };\n      }\n      case "youtube.music.open": {\n        const executable = installedProgramCandidates("youtubeMusic");\n        if (executable) childProcess.spawn(executable, [], { detached: true, stdio: "ignore", windowsHide: true }).unref();\n        else await this.shell.openExternal("https://music.youtube.com/");\n        return { executable: executable || "https://music.youtube.com/" };\n      }\n      case "youtube.music.playlist": {\n        const target = String(settings.url || settings.playlistUrl || "").trim();\n        if (!/^https:\/\/music\.youtube\.com\//i.test(target)) throw new Error("Für die Playlist-Aktion wird eine gültige YouTube-Music-Playlist-Adresse benötigt.");\n        await this.shell.openExternal(target);\n        return { target };\n      }\n      case "youtube.music.like":\n      case "youtube.music.dislike":\n      case "youtube.music.shuffle":\n      case "youtube.music.repeat":\n      case "youtube.music.info": {\n        if (settings.keys) return this._execute("system.hotkey", { keys: settings.keys }, context);\n        throw new Error("Diese YouTube-Music-App-Aktion benötigt einen im Aktionseditor konfigurierten Desktop-App-Hotkey. Ohne passende Laufzeit wird kein Erfolg gemeldet.");\n      }\n      case "discord.webhook": {',
  "Native Desktop- und Audioaktionen"
);
patch(
  executor,
  '      case "youtube.refresh":\n        return { videoId: await this.youtubeLatestVideo(settings) };',
  '      case "youtube.refresh":\n      case "youtube.ticker.status":\n        return { videoId: await this.youtubeLatestVideo(settings) };',
  "YouTube-Ticker-Status"
);

const required = [
  "src/services/native-plugin-additions.cjs",
  "src/services/plugin-registry.cjs",
  "src/services/action-executor.cjs"
];
for (const relative of required) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file) || !fs.statSync(file).size) throw new Error(`Patch-Ergebnis fehlt: ${relative}`);
}

console.log("Native Plugin-Kompatibilität und Desktop-Aktionen ergänzt.");
