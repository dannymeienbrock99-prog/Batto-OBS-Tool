"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const write = (relative, value) => fs.writeFileSync(path.join(root, relative), value, "utf8");

// Originale .streamDeckPlugin-Pakete über den Dateidialog installieren.
{
  const file = "src/main.cjs";
  let text = read(file);
  if (!text.includes("pluginRegistry.importPackage(")) {
    const pattern = /  handle\("plugins:import", async \(\) => \{[\s\S]*?\r?\n  \}\);/;
    if (!pattern.test(text)) throw new Error("Plugin-Import-IPC wurde nicht gefunden.");
    const replacement = [
      '  handle("plugins:import", async () => {',
      '    const result = await dialog.showOpenDialog(mainWindow, {',
      '      title: "Stream-Deck-Plugin installieren",',
      '      properties: ["openFile"],',
      '      filters: [{ name: "Stream Deck Plugin", extensions: ["streamDeckPlugin"] }]',
      '    });',
      '    if (result.canceled || !result.filePaths[0]) return null;',
      '    return pluginRegistry.importPackage(result.filePaths[0], path.join(programDataRoot(), "Plugins"));',
      '  });'
    ].join("\n");
    text = text.replace(pattern, replacement);
    write(file, text);
  }
}

// Registry um echte Stream-Deck-Paketinstallation und Manifest-Metadaten erweitern.
{
  const file = "src/services/plugin-registry.cjs";
  let text = read(file).replace(/\r\n/g, "\n");

  if (!text.includes('const childProcess = require("node:child_process");')) {
    text = text.replace('const path = require("node:path");', 'const path = require("node:path");\nconst childProcess = require("node:child_process");');
  }

  if (!text.includes("supportedInMultiActions:")) {
    text = text.replace(
      '    controllers: Array.isArray(action.Controllers) ? action.Controllers : [],\n    propertyInspectorPath: action.PropertyInspectorPath || action.propertyInspectorPath || "",',
      '    controllers: Array.isArray(action.Controllers) ? action.Controllers : [],\n    supportedInMultiActions: action.SupportedInMultiActions !== false,\n    supportedInKeyLogicActions: action.SupportedInKeyLogicActions !== false,\n    userTitleEnabled: action.UserTitleEnabled !== false,\n    disableAutomaticStates: Boolean(action.DisableAutomaticStates),\n    encoder: action.Encoder && typeof action.Encoder === "object" ? action.Encoder : null,\n    settings: action.Settings && typeof action.Settings === "object" ? action.Settings : {},\n    propertyInspectorPath: action.PropertyInspectorPath || action.propertyInspectorPath || "",'
    );
    if (!text.includes("supportedInMultiActions:")) throw new Error("Action-Metadaten konnten nicht in PluginRegistry eingebaut werden.");
  }

  if (!text.includes("sdkVersion:")) {
    text = text.replace(
      '    propertyInspectorPath: manifest.PropertyInspectorPath || manifest.propertyInspectorPath || "",\n    actions,',
      '    propertyInspectorPath: manifest.PropertyInspectorPath || manifest.propertyInspectorPath || "",\n    sdkVersion: Number(manifest.SDKVersion ?? manifest.sdkVersion ?? 0) || null,\n    nodejs: manifest.Nodejs && typeof manifest.Nodejs === "object" ? manifest.Nodejs : null,\n    codePathWin: executable,\n    os: Array.isArray(manifest.OS) ? manifest.OS : [],\n    software: manifest.Software && typeof manifest.Software === "object" ? manifest.Software : null,\n    applicationsToMonitor: manifest.ApplicationsToMonitor && typeof manifest.ApplicationsToMonitor === "object" ? manifest.ApplicationsToMonitor : null,\n    actions,'
    );
    if (!text.includes("sdkVersion:")) throw new Error("Plugin-SDK-/Nodejs-Metadaten konnten nicht eingebaut werden.");
  }

  if (!text.includes("  importPackage(packageFile, destinationRoot) {")) {
    const marker = '  importDirectory(sourceDirectory, destinationRoot) {';
    if (!text.includes(marker)) throw new Error("PluginRegistry.importDirectory-Patchpunkt fehlt.");
    const method = `  importPackage(packageFile, destinationRoot) {\n    const source = path.resolve(String(packageFile || ""));\n    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error("Plugin-Paket wurde nicht gefunden.");\n    if (path.extname(source).toLowerCase() !== ".streamdeckplugin") throw new Error("Bitte eine originale .streamDeckPlugin-Datei auswählen.");\n\n    const destination = ensureDirectory(destinationRoot || this.pluginRoots[0] || path.join(process.env.ProgramData || "C:\\\\ProgramData", "Batto OBS Tool", "Plugins"));\n    const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "batto-streamdeck-import-"));\n    const archive = path.join(workRoot, "plugin.zip");\n    const extracted = path.join(workRoot, "unpacked");\n    fs.copyFileSync(source, archive);\n    fs.mkdirSync(extracted, { recursive: true });\n\n    try {\n      const psArchive = archive.replaceAll("'", "''");\n      const psExtracted = extracted.replaceAll("'", "''");\n      childProcess.execFileSync("powershell.exe", [\n        "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",\n        "-Command", \`Expand-Archive -LiteralPath '\${psArchive}' -DestinationPath '\${psExtracted}' -Force\`\n      ], { windowsHide: true, stdio: "pipe", timeout: 60000 });\n\n      const pluginDirectories = [];\n      const visit = (directory, depth = 0) => {\n        if (depth > 5) return;\n        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {\n          if (!entry.isDirectory()) continue;\n          const full = path.join(directory, entry.name);\n          if (entry.name.toLowerCase().endsWith(".sdplugin")) pluginDirectories.push(full);\n          else visit(full, depth + 1);\n        }\n      };\n      visit(extracted);\n      if (!pluginDirectories.length) throw new Error("Im Paket wurde kein .sdPlugin-Verzeichnis gefunden.");\n\n      const extractedRoot = path.resolve(extracted) + path.sep;\n      const imported = [];\n      for (const pluginDirectory of pluginDirectories) {\n        const resolvedPlugin = path.resolve(pluginDirectory);\n        if (!resolvedPlugin.startsWith(extractedRoot)) throw new Error("Unsicherer Plugin-Pfad im Paket.");\n        const manifestFile = findManifest(resolvedPlugin);\n        if (!manifestFile) throw new Error(\`manifest.json fehlt in \${path.basename(resolvedPlugin)}.\`);\n        const manifest = readJson(manifestFile, null);\n        if (!manifest || typeof manifest !== "object") throw new Error("Plugin-Manifest ist ungültig.");\n        const normalized = normalizePlugin(manifest, manifestFile, extracted);\n        if (!normalized.id || !normalized.name) throw new Error("Plugin-Manifest enthält keine gültige UUID/Name-Kombination.");\n\n        const targetName = path.basename(resolvedPlugin);\n        if (!targetName.toLowerCase().endsWith(".sdplugin")) throw new Error("Ungültiger Plugin-Ordnername.");\n        const target = path.join(destination, targetName);\n        const staging = path.join(destination, \`.\${targetName}.installing-\${process.pid}-\${Date.now()}\`);\n        fs.rmSync(staging, { recursive: true, force: true });\n        fs.cpSync(resolvedPlugin, staging, { recursive: true, force: true });\n        const stagedManifestFile = findManifest(staging);\n        const stagedManifest = stagedManifestFile ? readJson(stagedManifestFile, null) : null;\n        if (!stagedManifest) {\n          fs.rmSync(staging, { recursive: true, force: true });\n          throw new Error("Installiertes Plugin-Manifest konnte nicht erneut gelesen werden.");\n        }\n        const staged = normalizePlugin(stagedManifest, stagedManifestFile, destination);\n        if (staged.id !== normalized.id) {\n          fs.rmSync(staging, { recursive: true, force: true });\n          throw new Error("Plugin-UUID hat sich bei der Installation verändert.");\n        }\n        fs.rmSync(target, { recursive: true, force: true });\n        fs.renameSync(staging, target);\n        imported.push({ id: staged.id, name: staged.name, version: staged.version, actions: staged.actions.length, target });\n      }\n\n      this.pluginRoots = existingDirectories([destination, ...this.pluginRoots]);\n      const snapshot = this.scan();\n      for (const item of imported) {\n        if (!snapshot.plugins.some((plugin) => plugin.id === item.id || plugin.originalPlugin?.id === item.id)) {\n          throw new Error(\`Importiertes Plugin \${item.id} ist nach dem Scan nicht verfügbar.\`);\n        }\n      }\n      return { imported, snapshot };\n    } finally {\n      fs.rmSync(workRoot, { recursive: true, force: true });\n    }\n  }\n\n`;
    text = text.replace(marker, method + marker);
  }

  write(file, text);
}

console.log("Batto Chat-Plan 2026: echter .streamDeckPlugin-Import, Manifest-Metadaten und Touch-Deck-Registrierung eingebaut.");
