"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ensureDirectory, readJson, safeText, writeJsonAtomic } = require("./common.cjs");

function exists(file) {
  try { return fs.existsSync(file); } catch { return false; }
}

function copyDirectoryMissing(source, destination, report, category) {
  if (!exists(source)) return;
  ensureDirectory(destination);
  let entries = [];
  try { entries = fs.readdirSync(source, { withFileTypes: true }); } catch (error) {
    report.errors.push(`${category}: ${error.message}`);
    return;
  }
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    try {
      if (entry.isDirectory()) {
        if (!exists(destinationPath)) {
          fs.cpSync(sourcePath, destinationPath, { recursive: true, force: false, errorOnExist: true });
          report.copied.push({ category, source: sourcePath, destination: destinationPath });
        } else {
          copyDirectoryMissing(sourcePath, destinationPath, report, category);
        }
      } else if (entry.isFile() && !exists(destinationPath)) {
        fs.copyFileSync(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL);
        report.copied.push({ category, source: sourcePath, destination: destinationPath });
      }
    } catch (error) {
      report.errors.push(`${category}: ${sourcePath}: ${error.message}`);
    }
  }
}

function legacyRoots() {
  const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const programData = process.env.ProgramData || "C:\\ProgramData";
  return {
    appData,
    localAppData,
    programData,
    legacyAppData: [
      path.join(appData, "Creator Hub"),
      path.join(appData, "creator-hub"),
      path.join(appData, "creator-hub-live"),
      path.join(localAppData, "Controller Hub")
    ],
    legacyProgramData: [
      path.join(programData, "Creator Hub"),
      path.join(programData, "CreatorHub")
    ],
    legacyInstall: [
      path.join(localAppData, "Programs", "Creator Hub"),
      path.join(programData, "Creator Hub")
    ]
  };
}

function migrateCreatorHubDesktopLayout(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.Profiles)) return null;
  const profiles = [];
  for (const sourceProfile of value.Profiles) {
    const pages = Array.isArray(sourceProfile?.Pages) ? sourceProfile.Pages : [];
    const sourcePages = pages.length ? pages : [{ Name: "Seite 1", Keys: sourceProfile?.Keys || [] }];
    const folders = sourcePages.map((page, pageIndex) => ({
      id: pageIndex === 0 ? "root" : `creator-hub-page-${pageIndex + 1}`,
      name: safeText(page?.Name || `Seite ${pageIndex + 1}`, 120),
      parentId: "",
      rows: 3,
      columns: 5,
      buttons: (Array.isArray(page?.Keys) ? page.Keys : []).map((key) => {
        const actions = [];
        const actionType = safeText(key?.ActionType || "", 160);
        const command = safeText(key?.Command || "", 4000);
        const argumentsText = safeText(key?.Arguments || "", 4000);
        if (actionType) {
          let type = actionType;
          let settings = {};
          if (["process.start", "file.open", "folder.open", "sound.play"].includes(type)) {
            type = "system.launch";
            settings = { path: command, arguments: argumentsText };
          } else if (type === "url.open") {
            type = "system.url";
            settings = { url: command };
          } else if (type === "hotkey.send") {
            type = "system.hotkey";
            settings = { keys: command };
          } else if (type === "windows.volume.mute") {
            type = "media.mute";
          } else if (type === "windows.volume.up") {
            type = "media.volume.up";
          } else if (type === "windows.volume.down") {
            type = "media.volume.down";
          } else if (type === "obs.scene.set") {
            type = "obs.scene";
            settings = { sceneName: command };
          } else if (type === "obs.audio.togglemute") {
            type = "obs.input.mute";
            settings = { inputName: command, toggle: true };
          } else if (type === "obs.stream.start") {
            type = "obs.stream.toggle";
          } else if (type === "obs.record.start") {
            type = "obs.record.toggle";
          } else if (type === "obs.virtualcamera.toggle") {
            type = "obs.virtualcam.toggle";
          } else {
            settings = { command, arguments: argumentsText };
          }
          actions.push({ type, title: safeText(key?.Title || actionType, 200), settings, delayMs: 0 });
        }
        return {
          title: safeText(key?.Title || "", 120),
          subtitle: "",
          icon: safeText(key?.IconPath || key?.Icon || "", 2_000_000),
          actions
        };
      })
    }));
    profiles.push({
      id: `creator-hub-${safeText(sourceProfile?.Name || "profil", 80).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      name: safeText(sourceProfile?.Name || "Creator Hub", 120),
      description: "Importiertes Creator-Hub-Touch-Deck",
      activeFolderId: "root",
      folders
    });
  }
  return { version: 2, activeProfileId: profiles[0]?.id || "", profiles, updatedAt: Date.now() };
}

class LegacyMigration {
  constructor({ userData, deckStore, pluginRegistry } = {}) {
    this.userData = userData;
    this.deckStore = deckStore;
    this.pluginRegistry = pluginRegistry;
    this.markerFile = path.join(userData, "legacy-import-v2.json");
    this.reportFile = path.join(userData, "legacy-import-report.json");
  }

  run({ force = false } = {}) {
    const previous = readJson(this.markerFile, null);
    if (previous && !force) return { ...previous, skipped: true };
    const roots = legacyRoots();
    const report = {
      version: 2,
      startedAt: Date.now(),
      finishedAt: 0,
      copied: [],
      profilesAdded: 0,
      settingsImported: [],
      logosFound: [],
      errors: [],
      skipped: false
    };

    for (const directory of roots.legacyAppData) {
      const candidates = ["profiles.json", "deck-profiles.json", "decks.json", "desktop-layout.json"];
      for (const name of candidates) {
        const file = path.join(directory, name);
        if (!exists(file)) continue;
        try {
          const value = JSON.parse(fs.readFileSync(file, "utf8"));
          const migrated = name === "desktop-layout.json" ? migrateCreatorHubDesktopLayout(value) : value;
          const result = this.deckStore?.mergeLegacy(migrated || value);
          report.profilesAdded += Number(result?.added || 0);
          report.settingsImported.push(file);
        } catch (error) {
          report.errors.push(`Profile ${file}: ${error.message}`);
        }
      }
      for (const name of ["app-settings.json", "settings.json", "plugin-settings.json"]) {
        const file = path.join(directory, name);
        if (exists(file)) report.settingsImported.push(file);
      }
    }

    const battoProgramData = ensureDirectory(path.join(roots.programData, "Batto OBS Tool"));
    const pluginDestination = ensureDirectory(path.join(battoProgramData, "Plugins"));
    const iconDestination = ensureDirectory(path.join(battoProgramData, "IconPacks"));
    for (const directory of roots.legacyProgramData) {
      copyDirectoryMissing(path.join(directory, "Plugins"), pluginDestination, report, "Plugin");
      copyDirectoryMissing(path.join(directory, "plugins"), pluginDestination, report, "Plugin");
      copyDirectoryMissing(path.join(directory, "IconPacks"), iconDestination, report, "IconPack");
      copyDirectoryMissing(path.join(directory, "icon-packs"), iconDestination, report, "IconPack");
    }
    for (const directory of roots.legacyInstall) {
      for (const relative of ["resources/plugins", "resources/app/plugins", "plugins"]) {
        copyDirectoryMissing(path.join(directory, relative), pluginDestination, report, "Plugin");
      }
      for (const relative of ["resources/icon-packs", "resources/IconPacks", "icon-packs"]) {
        copyDirectoryMissing(path.join(directory, relative), iconDestination, report, "IconPack");
      }
      const files = [];
      const walk = (current, depth = 0) => {
        if (depth > 4 || !exists(current)) return;
        let entries = [];
        try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
          const file = path.join(current, entry.name);
          if (entry.isDirectory()) walk(file, depth + 1);
          else if (entry.isFile() && /(?:team|batto|crazy).*logo|logo.*(?:team|batto|crazy)/i.test(entry.name) && /\.(?:png|jpe?g|webp|svg)$/i.test(entry.name)) files.push(file);
        }
      };
      walk(directory);
      report.logosFound.push(...files.slice(0, 20));
    }

    if (this.pluginRegistry) {
      this.pluginRegistry.pluginRoots = [...new Set([pluginDestination, ...this.pluginRegistry.pluginRoots])];
      this.pluginRegistry.iconPackRoots = [...new Set([iconDestination, ...this.pluginRegistry.iconPackRoots])];
      try { this.pluginRegistry.scan(); } catch (error) { report.errors.push(`Plugin-Neuscan: ${error.message}`); }
    }

    report.finishedAt = Date.now();
    writeJsonAtomic(this.reportFile, report);
    writeJsonAtomic(this.markerFile, report);
    return report;
  }

  status() {
    return readJson(this.reportFile, { version: 2, copied: [], profilesAdded: 0, settingsImported: [], logosFound: [], errors: [], skipped: true });
  }
}

module.exports = { LegacyMigration, copyDirectoryMissing, legacyRoots, migrateCreatorHubDesktopLayout };
