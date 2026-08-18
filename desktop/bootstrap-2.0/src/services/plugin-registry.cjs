"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const AdmZip = require("adm-zip");
const { ensureDirectory, readJson, safeText, writeJsonAtomic } = require("./common.cjs");
const { EXTRA_BUILT_IN_PLUGINS } = require("./native-plugin-additions.cjs");

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);
const EMULATED_STREAM_DECK_VERSION = "7.1";

function compareVersions(left, right) {
  const parse = (value) => String(value || "")
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .map((part) => Number.isFinite(part) ? part : 0);
  const leftParts = parse(left);
  const rightParts = parse(right);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

function pathIsInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return Boolean(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function containedFile(root, candidate) {
  try {
    const realRoot = fs.realpathSync(root);
    const realCandidate = fs.realpathSync(candidate);
    return pathIsInside(realRoot, realCandidate) && fs.statSync(realCandidate).isFile() ? realCandidate : "";
  } catch {
    return "";
  }
}

function existingPathEscapesRoot(root, candidates) {
  let realRoot;
  try { realRoot = fs.realpathSync(root); } catch { return true; }
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      if (!pathIsInside(realRoot, fs.realpathSync(candidate))) return true;
    } catch {
      return true;
    }
  }
  return false;
}

function uniquePaths(values) {
  return [...new Set(values.filter(Boolean).map((value) => path.resolve(value)))];
}

function existingDirectories(values) {
  return uniquePaths(values).filter((directory) => {
    try { return fs.statSync(directory).isDirectory(); } catch { return false; }
  });
}

function defaultPluginRoots(programData = process.env.ProgramData, appData = process.env.APPDATA, localAppData = process.env.LOCALAPPDATA) {
  return uniquePaths([
    path.join(programData || "C:\\ProgramData", "Batto OBS Tool", "Plugins"),
    path.join(programData || "C:\\ProgramData", "Creator Hub", "Plugins"),
    path.join(programData || "C:\\ProgramData", "Elgato", "StreamDeck", "Plugins"),
    path.join(appData || path.join(os.homedir(), "AppData", "Roaming"), "Elgato", "StreamDeck", "Plugins"),
    path.join(localAppData || path.join(os.homedir(), "AppData", "Local"), "Elgato", "StreamDeck", "Plugins"),
    path.join(localAppData || path.join(os.homedir(), "AppData", "Local"), "Programs", "Creator Hub", "resources", "plugins"),
    path.join(localAppData || path.join(os.homedir(), "AppData", "Local"), "Programs", "Batto OBS Tool", "resources", "plugins")
  ]);
}

function defaultIconPackRoots(programData = process.env.ProgramData, appData = process.env.APPDATA) {
  return existingDirectories([
    path.join(programData || "C:\\ProgramData", "Batto OBS Tool", "IconPacks"),
    path.join(programData || "C:\\ProgramData", "Creator Hub", "IconPacks"),
    path.join(appData || path.join(os.homedir(), "AppData", "Roaming"), "Elgato", "StreamDeck", "IconPacks")
  ]);
}

function walk(directory, maximumDepth = 4, depth = 0, result = []) {
  if (depth > maximumDepth) return result;
  let entries = [];
  try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return result; }
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file, maximumDepth, depth + 1, result);
    else if (entry.isFile()) result.push(file);
  }
  return result;
}

function findManifest(directory) {
  const names = ["manifest.json", "plugin.json", "Manifest.json"];
  for (const name of names) {
    const file = path.join(directory, name);
    if (fs.existsSync(file)) return file;
  }
  return walk(directory, 2).find((file) => names.includes(path.basename(file))) || null;
}

function isDirectory(file) {
  try { return fs.statSync(file).isDirectory(); } catch { return false; }
}

function discoverPluginDirectories(root, maximumDepth = 3) {
  if (!isDirectory(root)) return [];
  const result = [];
  const seenRealPaths = new Set();
  const visit = (directory, depth) => {
    let real;
    try { real = fs.realpathSync(directory); } catch { return; }
    if (seenRealPaths.has(real)) return;
    seenRealPaths.add(real);
    const directManifest = ["manifest.json", "Manifest.json", "plugin.json"]
      .map((name) => path.join(directory, name))
      .find((file) => fs.existsSync(file));
    if (directManifest) {
      result.push(directory);
      return;
    }
    if (depth >= maximumDepth) return;
    let entries = [];
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      visit(path.join(directory, entry.name), depth + 1);
    }
  };
  visit(root, 0);
  return result;
}

function resolveManifestAsset(pluginRoot, value) {
  if (!value || typeof value !== "string") return null;
  const candidates = [
    path.resolve(pluginRoot, value),
    path.resolve(pluginRoot, `${value}.png`),
    path.resolve(pluginRoot, `${value}.svg`),
    path.resolve(pluginRoot, `${value}.jpg`)
  ];
  for (const candidate of candidates) {
    const resolved = containedFile(pluginRoot, candidate);
    if (resolved) return resolved;
  }
  return null;
}

function fileToDataUrl(file, maximumBytes = 1_500_000) {
  if (!file) return "";
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > maximumBytes) return "";
    const extension = path.extname(file).toLowerCase();
    const mime = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".svg": "image/svg+xml"
    }[extension];
    if (!mime) return "";
    return `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
  } catch {
    return "";
  }
}

function actionFromManifest(action, pluginRoot, index) {
  const uuid = safeText(action.UUID || action.uuid || action.id || `action-${index}`, 200);
  const name = safeText(action.Name || action.name || action.Title || uuid, 200);
  const iconFile = resolveManifestAsset(pluginRoot, action.Icon || action.icon || action.Image || action.image);
  const states = Array.isArray(action.States || action.states)
    ? (action.States || action.states).map((state, stateIndex) => ({
        index: stateIndex,
        title: safeText(state.Title || state.title || "", 200),
        image: fileToDataUrl(resolveManifestAsset(pluginRoot, state.Image || state.image))
      }))
    : [];
  const supportsWindows = !Array.isArray(action.OS || action.os)
    || (action.OS || action.os).some((platform) => String(platform).toLowerCase() === "windows");
  return {
    id: uuid,
    name,
    tooltip: safeText(action.Tooltip || action.tooltip || action.Description || "", 500),
    icon: fileToDataUrl(iconFile),
    states,
    controllers: Array.isArray(action.Controllers || action.controllers) ? (action.Controllers || action.controllers) : ["Keypad"],
    visibleInActionsList: action.VisibleInActionsList !== false && action.visibleInActionsList !== false,
    propertyInspectorPath: action.PropertyInspectorPath || action.propertyInspectorPath || "",
    raw: {
      uuid,
      name,
      supportedInTouchDeck: supportsWindows && (!(Array.isArray(action.Controllers || action.controllers))
        || (action.Controllers || action.controllers).some((controller) => String(controller).toLowerCase() === "keypad")),
      propertyInspectorPath: action.PropertyInspectorPath || action.propertyInspectorPath || ""
    }
  };
}

function normalizePlugin(manifest, manifestFile, root) {
  const pluginRoot = path.dirname(manifestFile);
  const actions = Array.isArray(manifest.Actions || manifest.actions)
    ? (manifest.Actions || manifest.actions).map((action, index) => actionFromManifest(action, pluginRoot, index))
    : [];
  const id = safeText(manifest.UUID || manifest.uuid || manifest.id || path.basename(pluginRoot), 200);
  const name = safeText(manifest.Name || manifest.name || id, 200);
  const iconFile = resolveManifestAsset(pluginRoot, manifest.Icon || manifest.icon || manifest.Logo || manifest.logo)
    || walk(pluginRoot, 2).find((file) => IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase()))
    || null;
  const executable = safeText(manifest.CodePathWin || manifest.codePathWin || manifest.CodePath || manifest.codePath || "", 1000);
  const executableCandidates = executable
    ? [path.resolve(pluginRoot, executable), ...(path.extname(executable) ? [] : [path.resolve(pluginRoot, `${executable}.exe`)])]
    : [];
  const executablePath = executableCandidates.map((candidate) => containedFile(pluginRoot, candidate)).find(Boolean) || "";
  const executableExists = Boolean(executablePath);
  const declaredOutsideRoot = Boolean(executable && !pathIsInside(path.resolve(pluginRoot), path.resolve(pluginRoot, executable)));
  const existingOutsideRoot = existingPathEscapesRoot(pluginRoot, executableCandidates);
  const unsafeExecutable = declaredOutsideRoot || existingOutsideRoot;
  const extension = path.extname(executablePath || executable).toLowerCase();
  const runtimeKind = [".js", ".cjs", ".mjs"].includes(extension) ? "node" : extension === ".exe" ? "native" : executablePath ? "unsupported" : "none";
  const protectedPackage = Boolean(manifest.DRM || manifest.Protected || manifest.protected || manifest.Marketplace?.Protected);
  const requiredNodeMajor = Math.max(0, Number.parseInt(String(manifest.Nodejs?.Version || manifest.nodejs?.version || "0"), 10) || 0);
  const hostNodeMajor = Math.max(0, Number.parseInt(String(process.versions.node || "0"), 10) || 0);
  const supportedWindows = !Array.isArray(manifest.OS || manifest.os)
    || (manifest.OS || manifest.os).some((entry) => String(entry?.Platform || entry?.platform || entry).toLowerCase() === "windows");
  const minimumSoftware = safeText(manifest.Software?.MinimumVersion || manifest.software?.minimumVersion || "", 40);
  const sdkVersion = Number(manifest.SDKVersion || manifest.sdkVersion) || null;
  let runtimeStatus = "none";
  if (protectedPackage) runtimeStatus = "protected";
  else if (!supportedWindows) runtimeStatus = "unsupported-os";
  else if (sdkVersion && ![2, 3].includes(sdkVersion)) runtimeStatus = "sdk-version";
  else if (unsafeExecutable) runtimeStatus = "unsafe-path";
  else if (minimumSoftware && compareVersions(minimumSoftware, EMULATED_STREAM_DECK_VERSION) > 0) runtimeStatus = "software-version";
  else if (runtimeKind === "node" && requiredNodeMajor > hostNodeMajor) runtimeStatus = "node-version";
  else if (executableExists && runtimeKind === "unsupported") runtimeStatus = "unsupported-runtime";
  else if (executableExists) runtimeStatus = "ready";
  else if (executable) runtimeStatus = "missing";
  const status = !actions.length
    ? "Manifest erkannt – keine Aktionen veröffentlicht"
    : runtimeStatus === "ready"
      ? "Originale Elgato-Laufzeit für Touch-Deck bereit"
      : runtimeStatus === "protected"
        ? "Geschütztes Marketplace-Plugin – benötigt die Elgato Stream-Deck-App"
        : runtimeStatus === "unsupported-os"
          ? "Plugin unterstützt laut Manifest kein Windows"
          : runtimeStatus === "sdk-version"
            ? `Plugin benötigt die nicht unterstützte SDK-Version ${sdkVersion}`
          : runtimeStatus === "node-version"
            ? `Plugin benötigt Node.js ${requiredNodeMajor}; eingebettet ist Node.js ${hostNodeMajor}`
            : runtimeStatus === "software-version"
              ? `Plugin benötigt Stream Deck ${minimumSoftware}; Batto emuliert das Keypad-Protokoll ${EMULATED_STREAM_DECK_VERSION}`
              : runtimeStatus === "unsafe-path"
                ? "Plugin-Laufzeit liegt außerhalb des Plugin-Ordners und wurde blockiert"
                : runtimeStatus === "unsupported-runtime"
                  ? `Nicht unterstützte Plugin-Laufzeit „${extension || "ohne Dateiendung"}“`
        : runtimeStatus === "missing"
          ? "Manifest erkannt – Laufzeit fehlt, ist inkompatibel oder geschützt"
          : "Manifest erkannt – keine ausführbare Plugin-Laufzeit angegeben";
  return {
    id,
    name,
    version: safeText(manifest.Version || manifest.version || "", 80),
    author: safeText(manifest.Author || manifest.author || "", 120),
    description: safeText(manifest.Description || manifest.description || "", 500),
    category: safeText(manifest.Category || manifest.category || "Plugin", 80),
    icon: fileToDataUrl(iconFile),
    root: pluginRoot,
    sourceRoot: root,
    manifestFile,
    executablePath,
    executableExists,
    runtime: {
      kind: runtimeKind,
      status: runtimeStatus,
      codePath: executable,
      sdkVersion,
      nodeVersion: requiredNodeMajor || null,
      hostNodeVersion: hostNodeMajor || null,
      minimumSoftwareVersion: minimumSoftware || null,
      emulatedSoftwareVersion: EMULATED_STREAM_DECK_VERSION,
      protected: protectedPackage
    },
    propertyInspectorPath: manifest.PropertyInspectorPath || manifest.propertyInspectorPath || "",
    actions,
    rawName: name,
    native: false,
    enabled: true,
    status
  };
}

const BUILT_IN_PLUGINS = Object.freeze([
  {
    id: "batto.obs",
    name: "OBS Studio",
    version: "2.0.0",
    category: "Streaming",
    description: "Native OBS-WebSocket-Aktionen ohne zusätzliche Stream-Deck-Laufzeit.",
    actions: [
      ["obs.scene", "Szene wechseln"], ["obs.source.toggle", "Quelle ein/aus"],
      ["obs.input.mute", "Audio stummschalten"], ["obs.input.volume", "Lautstärke setzen"],
      ["obs.stream.toggle", "Stream Start/Stop"], ["obs.record.toggle", "Aufnahme Start/Stop"],
      ["obs.virtualcam.toggle", "Virtuelle Kamera Start/Stop"]
    ]
  },
  {
    id: "batto.system",
    name: "Advanced Launcher",
    version: "2.0.0",
    category: "System",
    description: "Programme, Dateien, Ordner, Webseiten und Hotkeys starten.",
    actions: [
      ["system.launch", "Programm oder Datei öffnen"], ["system.url", "Webseite öffnen"],
      ["system.hotkey", "Tastenkombination"], ["system.command", "Befehl ausführen"]
    ]
  },
  {
    id: "batto.media",
    name: "Mediensteuerung",
    version: "2.0.0",
    category: "Audio",
    description: "Spotify, YouTube Music und andere Windows-Medienprogramme über Medientasten steuern.",
    actions: [
      ["media.playpause", "Play/Pause"], ["media.next", "Nächster Titel"],
      ["media.previous", "Vorheriger Titel"], ["media.stop", "Stop"],
      ["media.volume.up", "Lautstärke erhöhen"], ["media.volume.down", "Lautstärke verringern"],
      ["media.mute", "Systemton stummschalten"]
    ]
  },
  {
    id: "batto.youtube",
    name: "YouTube Live und Ticker",
    version: "2.0.0",
    category: "Streaming",
    description: "YouTube-Livechat, Kanalstatus, letztes Video, Dashboard und Ticker.",
    actions: [
      ["youtube.dashboard", "YouTube-Dashboard öffnen"], ["youtube.channel", "Kanal öffnen"],
      ["youtube.latest", "Letztes Video öffnen"], ["youtube.refresh", "Ticker aktualisieren"],
      ["youtube.chat.send", "Chat-Nachricht senden"]
    ]
  },
  {
    id: "batto.tiktok",
    name: "TikTok LIVE Studio und TikFinity",
    version: "2.0.0",
    category: "Streaming",
    description: "LIVE Studio starten und lokale TikFinity/TikTok-Ereignisse an das Overlay senden.",
    actions: [
      ["tiktok.live-studio.launch", "TikTok LIVE Studio starten"],
      ["tiktok.event", "TikTok-Ereignis auslösen"], ["tikfinity.webhook", "TikFinity-Webhook senden"]
    ]
  },
  {
    id: "batto.discord",
    name: "Discord",
    version: "2.0.0",
    category: "Kommunikation",
    description: "Discord öffnen, Mikrofon/Audio-Hotkeys und optionale Webhook-Nachrichten.",
    actions: [
      ["discord.launch", "Discord öffnen"], ["discord.webhook", "Webhook-Nachricht senden"],
      ["system.hotkey", "Discord-Hotkey ausführen"]
    ]
  },
  {
    id: "batto.obsbot",
    name: "OBSBOT WebCam",
    version: "2.0.0",
    category: "Kamera",
    description: "OBSBOT Center erkennen und öffnen; Original-Plugin-Aktionen werden angezeigt, wenn das Plugin installiert ist.",
    actions: [["obsbot.center", "OBSBOT Center öffnen"]]
  },
  {
    id: "batto.giveaway",
    name: "Twitch Giveaway",
    version: "2.0.0",
    category: "Streaming",
    description: "Lokale Giveaway-Liste verwalten und zufällig einen Gewinner ziehen.",
    actions: [["giveaway.add", "Teilnehmer hinzufügen"], ["giveaway.draw", "Gewinner ziehen"]]
  },
  {
    id: "batto.creator-tools",
    name: "Umfragen, Word Clouds und Glücksrad",
    version: "2.0.0",
    category: "Overlay",
    description: "Lokale Overlay-Aktionen für Umfragen, Wortwolken und das Glücksrad.",
    actions: [["overlay.poll", "Umfrage anzeigen"], ["overlay.wordcloud", "Wortwolke aktualisieren"], ["overlay.wheel", "Glücksrad drehen"]]
  },
  {
    id: "crazybatto.sotf-death-counter",
    name: "Sons of the Forest Todeszähler",
    version: "0.3.3",
    category: "Gaming",
    description: "Direkte lokale Anbindung an das gebündelte CrazyBatto SOTF DeathCounter Module v0.3.3.",
    actions: [["sotf.counter.refresh", "Todeszähler aktualisieren"], ["sotf.overlay.open", "Todeszähler-Overlay öffnen"], ["sotf.overlay.copy-url", "OBS-Overlay-Adresse kopieren"]]
  }
].map((plugin) => ({
  ...plugin,
  native: true,
  enabled: true,
  status: "Native Batto-Aktionen verfügbar",
  icon: "",
  root: "",
  sourceRoot: "",
  manifestFile: "",
  executablePath: "",
  executableExists: true,
  runtime: { kind: "native", status: "ready", codePath: "", sdkVersion: null, protected: false },
  actions: plugin.actions.map(([id, name]) => ({ id, name, tooltip: "", icon: "", states: [], controllers: ["Keypad"], propertyInspectorPath: "", raw: { id, name } }))
})));

function validateArchiveEntryName(entryName) {
  const normalized = String(entryName || "").replaceAll("\\", "/");
  if (!normalized || normalized.includes("\0") || normalized.startsWith("/") || /^[a-z]:\//i.test(normalized)) {
    throw new Error("Das Stream-Deck-Paket enthält einen ungültigen Dateipfad.");
  }
  const parts = normalized.split("/").filter(Boolean);
  if (parts.some((part) => part === "..")) throw new Error("Das Stream-Deck-Paket versucht, außerhalb des Zielordners zu schreiben.");
  return parts.join("/");
}

function archivePluginRoot(entries) {
  const manifests = entries
    .map((entry) => validateArchiveEntryName(entry.entryName))
    .filter((name) => /(^|\/)[^/]+\.sdplugin\/manifest\.json$/i.test(`/${name}`));
  const roots = [...new Set(manifests.map((name) => name.split("/").slice(0, -1).join("/")))];
  if (roots.length !== 1 || !/\.sdplugin$/i.test(roots[0])) {
    throw new Error("Das Paket muss genau einen *.sdPlugin-Ordner mit manifest.json enthalten.");
  }
  return roots[0];
}

function extractStreamDeckPlugin(sourceFile, destinationRoot) {
  let zip;
  try { zip = new AdmZip(sourceFile); }
  catch (error) { throw new Error(`Das .streamDeckPlugin-Paket kann nicht gelesen werden: ${error?.message || error}`); }
  const entries = zip.getEntries();
  if (!entries.length || entries.length > 5000) throw new Error("Das Stream-Deck-Paket enthält keine oder zu viele Dateien.");
  const totalBytes = entries.reduce((sum, entry) => sum + Number(entry.header?.size || 0), 0);
  if (totalBytes > 500 * 1024 * 1024) throw new Error("Das Stream-Deck-Paket ist entpackt größer als 500 MB.");
  const pluginRootName = archivePluginRoot(entries);
  const destination = ensureDirectory(destinationRoot);
  const targetName = path.basename(pluginRootName);
  const target = path.join(destination, targetName);
  if (fs.existsSync(target)) throw new Error(`Das Plugin „${targetName}“ ist bereits importiert.`);
  const staging = fs.mkdtempSync(path.join(destination, ".batto-streamdeck-import-"));
  try {
    for (const entry of entries) {
      const safeName = validateArchiveEntryName(entry.entryName);
      if (safeName !== pluginRootName && !safeName.startsWith(`${pluginRootName}/`)) continue;
      const relative = safeName.slice(pluginRootName.length).replace(/^\//, "");
      const output = relative ? path.join(staging, targetName, ...relative.split("/")) : path.join(staging, targetName);
      const resolved = path.resolve(output);
      const safeRoot = path.resolve(staging);
      if (resolved !== safeRoot && !resolved.startsWith(`${safeRoot}${path.sep}`)) throw new Error("Unsicherer Paketpfad wurde blockiert.");
      if (entry.isDirectory) fs.mkdirSync(resolved, { recursive: true });
      else {
        fs.mkdirSync(path.dirname(resolved), { recursive: true });
        fs.writeFileSync(resolved, entry.getData());
      }
    }
    const stagedPlugin = path.join(staging, targetName);
    if (!fs.existsSync(path.join(stagedPlugin, "manifest.json"))) {
      const manifest = findManifest(stagedPlugin);
      if (!manifest || path.dirname(manifest) !== stagedPlugin) throw new Error("Das Plugin-Manifest fehlt nach dem Entpacken.");
    }
    fs.renameSync(stagedPlugin, target);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
  return target;
}

class PluginRegistry extends EventEmitter {
  constructor({ stateFile, pluginRoots, iconPackRoots } = {}) {
    super();
    this.stateFile = stateFile || path.join(process.cwd(), "plugin-state.json");
    this.pluginRoots = pluginRoots || defaultPluginRoots();
    this.iconPackRoots = iconPackRoots || defaultIconPackRoots();
    this.state = readJson(this.stateFile, { disabled: [], settings: {} }) || { disabled: [], settings: {} };
    this.plugins = [];
    this.iconPacks = [];
    this.scanErrors = [];
  }

  scan() {
    const plugins = [...BUILT_IN_PLUGINS, ...EXTRA_BUILT_IN_PLUGINS]
      .map((plugin) => ({ ...plugin, runtime: plugin.runtime || { kind: "native", status: "ready" }, actions: plugin.actions.map((action) => ({ ...action })) }));
    const seen = new Set(plugins.map((plugin) => plugin.id.toLowerCase()));
    this.scanErrors = [];
    for (const root of this.pluginRoots) {
      try {
        for (const directory of discoverPluginDirectories(root)) {
          const manifestFile = findManifest(directory);
          const manifest = manifestFile ? readJson(manifestFile, null) : null;
          if (!manifest || typeof manifest !== "object") {
            this.scanErrors.push({ root, path: directory, message: "Plugin-Manifest ist ungültig." });
            continue;
          }
          const plugin = normalizePlugin(manifest, manifestFile, root);
          const key = plugin.id.toLowerCase();
          if (seen.has(key)) {
            const existing = plugins.find((item) => item.id.toLowerCase() === key);
            if (existing?.native) {
              existing.originalPlugin = plugin;
              const knownActions = new Set(existing.actions.map((action) => action.id.toLowerCase()));
              for (const action of plugin.actions) {
                if (knownActions.has(action.id.toLowerCase())) continue;
                existing.actions.push({ ...action, originalPluginId: plugin.id });
                knownActions.add(action.id.toLowerCase());
              }
              existing.status = plugin.runtime.status === "ready"
                ? `Native Aktionen + originale Elgato-Laufzeit ${plugin.version || "erkannt"}`
                : `Native Aktionen + Originalmanifest (${plugin.status})`;
            }
            continue;
          }
          seen.add(key);
          plugins.push(plugin);
        }
      } catch (error) {
        this.scanErrors.push({ root, message: String(error?.message || error) });
      }
    }
    const disabled = new Set((this.state.disabled || []).map((value) => String(value).toLowerCase()));
    for (const plugin of plugins) {
      plugin.enabled = !disabled.has(plugin.id.toLowerCase());
      if (plugin.originalPlugin) plugin.originalPlugin.enabled = plugin.enabled;
    }
    this.plugins = plugins.sort((left, right) => left.category.localeCompare(right.category, "de") || left.name.localeCompare(right.name, "de"));
    this.iconPacks = this.scanIconPacks();
    this.emit("changed", this.snapshot());
    return this.snapshot();
  }

  scanIconPacks() {
    const result = [];
    const seen = new Set();
    for (const root of this.iconPackRoots) {
      let entries = [];
      try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const directory = path.join(root, entry.name);
        const manifestFile = findManifest(directory);
        const manifest = manifestFile ? readJson(manifestFile, {}) : {};
        const id = safeText(manifest.UUID || manifest.uuid || manifest.id || entry.name, 200);
        if (seen.has(id.toLowerCase())) continue;
        seen.add(id.toLowerCase());
        const images = walk(directory, 5).filter((file) => IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase())).slice(0, 500);
        result.push({
          id,
          name: safeText(manifest.Name || manifest.name || entry.name, 200),
          version: safeText(manifest.Version || manifest.version || "", 80),
          root: directory,
          count: images.length,
          icons: images.slice(0, 80).map((file) => ({ name: path.basename(file), dataUrl: fileToDataUrl(file, 600_000) })).filter((item) => item.dataUrl)
        });
      }
    }
    return result;
  }

  snapshot() {
    return {
      plugins: this.plugins.map((plugin) => ({ ...plugin, settings: this.state.settings?.[plugin.id] || {} })),
      iconPacks: this.iconPacks,
      roots: { plugins: this.pluginRoots, iconPacks: this.iconPackRoots },
      errors: this.scanErrors.map((error) => ({ ...error })),
      scannedAt: Date.now()
    };
  }

  setEnabled(pluginId, enabled) {
    const key = String(pluginId || "").toLowerCase();
    const disabled = new Set((this.state.disabled || []).map((value) => String(value).toLowerCase()));
    if (enabled) disabled.delete(key); else disabled.add(key);
    this.state.disabled = [...disabled];
    writeJsonAtomic(this.stateFile, this.state);
    return this.scan();
  }

  saveSettings(pluginId, settings) {
    this.state.settings ||= {};
    this.state.settings[String(pluginId)] = settings && typeof settings === "object" ? settings : {};
    writeJsonAtomic(this.stateFile, this.state);
    return this.state.settings[String(pluginId)];
  }

  findPlugin(pluginId) {
    const key = String(pluginId || "").toLowerCase();
    const match = this.plugins.find((plugin) => plugin.id.toLowerCase() === key) || null;
    return match?.originalPlugin || match;
  }

  findPluginForAction(actionId) {
    const key = String(actionId || "").toLowerCase();
    for (const plugin of this.plugins) {
      if (!plugin.enabled) continue;
      const candidates = plugin.originalPlugin ? [plugin.originalPlugin, plugin] : [plugin];
      for (const candidate of candidates) {
        if (!candidate?.native && candidate?.actions?.some((action) => action.id.toLowerCase() === key)) return candidate;
      }
    }
    return null;
  }

  importDirectory(sourceDirectory, destinationRoot) {
    if (!sourceDirectory || !fs.existsSync(sourceDirectory)) throw new Error("Plugin-Quellordner wurde nicht gefunden.");
    const destination = ensureDirectory(destinationRoot || this.pluginRoots[0] || path.join(process.env.ProgramData || "C:\\ProgramData", "Batto OBS Tool", "Plugins"));
    const sourceStat = fs.statSync(sourceDirectory);
    if (!sourceStat.isDirectory()) throw new Error("Plugin-Quelle ist kein Ordner.");
    const discovered = discoverPluginDirectories(sourceDirectory, 2);
    const sourcePlugin = discovered.length === 1 ? discovered[0] : sourceDirectory;
    const manifest = findManifest(sourcePlugin);
    if (!manifest || path.dirname(manifest) !== sourcePlugin) throw new Error("Der ausgewählte Ordner enthält kein eindeutiges Stream-Deck-Plugin.");
    const target = path.join(destination, path.basename(sourcePlugin));
    fs.cpSync(sourcePlugin, target, { recursive: true, force: false, errorOnExist: true });
    this.pluginRoots = uniquePaths([destination, ...this.pluginRoots]);
    return this.scan();
  }

  importPath(source, destinationRoot) {
    if (!source || !fs.existsSync(source)) throw new Error("Plugin-Datei oder -Ordner wurde nicht gefunden.");
    const destination = ensureDirectory(destinationRoot || this.pluginRoots[0] || path.join(process.env.ProgramData || "C:\\ProgramData", "Batto OBS Tool", "Plugins"));
    const stat = fs.statSync(source);
    let importedPath;
    if (stat.isDirectory()) {
      this.importDirectory(source, destination);
      importedPath = source;
    } else if (stat.isFile() && path.extname(source).toLowerCase() === ".streamdeckplugin") {
      importedPath = extractStreamDeckPlugin(source, destination);
    } else {
      throw new Error("Unterstützt werden *.streamDeckPlugin-Dateien und *.sdPlugin-Ordner.");
    }
    this.pluginRoots = uniquePaths([destination, ...this.pluginRoots]);
    return { importedPath, snapshot: this.scan() };
  }
}

module.exports = {
  BUILT_IN_PLUGINS,
  EMULATED_STREAM_DECK_VERSION,
  PluginRegistry,
  compareVersions,
  defaultIconPackRoots,
  defaultPluginRoots,
  discoverPluginDirectories,
  extractStreamDeckPlugin,
  fileToDataUrl,
  normalizePlugin
};
