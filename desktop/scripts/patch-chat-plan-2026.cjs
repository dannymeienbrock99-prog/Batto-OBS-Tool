"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const write = (relative, value) => fs.writeFileSync(path.join(root, relative), value, "utf8");
const replaceRequired = (relative, before, after, label) => {
  let text = read(relative);
  if (text.includes(after)) return;
  if (!text.includes(before)) throw new Error(`${label}: Patchpunkt fehlt in ${relative}`);
  text = text.replace(before, after);
  write(relative, text);
};

// Übersicht: das Nutzerbild ist die vollflächige Hero-Fläche; kein kleines Logo mehr.
{
  const file = "src/renderer/index.html";
  let text = read(file);
  text = text.replace(/\s*<button class="nav-button" data-view="holo">[\s\S]*?<\/button>/, "");
  text = text.replace(/\s*<button class="nav-button" data-view="deck">[\s\S]*?<\/button>/, "");
  text = text.replace(/\s*<button data-jump="holo">[\s\S]*?<\/button>/, "");
  text = text.replace(/\s*<button data-jump="deck">[\s\S]*?<\/button>/, "");
  text = text.replace('<div class="hero-card">', '<div class="hero-card overview-hero">');
  text = text.replace(/\s*<img src="\.\/assets\/team-alpha-logo\.(?:svg|png)" alt="Team Alpha">/, "");
  write(file, text);

  const cssFile = "src/renderer/styles.css";
  let css = read(cssFile);
  if (!css.includes("/* Batto overview dragon hero */")) {
    css += `\n/* Batto overview dragon hero */\n.overview-hero {\n  position: relative;\n  min-height: 260px;\n  grid-template-columns: minmax(0, 1fr);\n  align-items: center;\n  isolation: isolate;\n  background-image:\n    linear-gradient(90deg, rgba(4,7,12,.96) 0%, rgba(8,10,16,.88) 31%, rgba(8,10,16,.45) 54%, rgba(4,7,12,.08) 78%),\n    radial-gradient(circle at 16% 60%, rgba(150,0,24,.30), transparent 40%),\n    url(\"./assets/overview-bg.jpg\");\n  background-size: cover;\n  background-position: center right;\n  background-repeat: no-repeat;\n}\n.overview-hero > div { position: relative; z-index: 1; max-width: min(760px, 62%); }\n.overview-hero h2 { text-shadow: 0 2px 18px rgba(0,0,0,.85); }\n.overview-hero p { color: #d1d9e4; text-shadow: 0 2px 12px rgba(0,0,0,.9); }\n@media (max-width: 980px) { .overview-hero { background-position: 68% center; } .overview-hero > div { max-width: 72%; } }\n`;
    write(cssFile, css);
  }
}

// Touch-Deck Pro: nur Zeilen/Spalten als Rastereinstellung und Elgato-artige Anordnung.
{
  const jsFile = "src/renderer/touch-deck-pro-v2.js";
  let js = read(jsFile);
  js = js.replace('<p>Links Aktionen suchen, in der Mitte das Deck gestalten und rechts die ausgewählte Taste konfigurieren.</p>', '<p>Deck links, Aktionen rechts und Eigenschaften unten – mit Profilen, Seiten, Ordnern und Mehrfachaktionen.</p>');
  js = js.replace('<label>Tastengröße<input id="tdp-size" type="number" min="64" max="260"></label>\n              <label>Abstand<input id="tdp-gap" type="number" min="0" max="40"></label>\n              <label class="tdp-check"><input id="tdp-hide-unused" type="checkbox"> Unbenutzte Tasten ausblenden</label>\n              ', '');
  js = js.replace('    $("#tdp-size").value = currentFolder.buttonSize;\n    $("#tdp-gap").value = currentFolder.gap;\n    $("#tdp-hide-unused").checked = Boolean(currentFolder.hideUnused);\n', '');
  js = js.replace('        buttonSize: Math.max(64, Math.min(260, Number($("#tdp-size").value) || 116)),\n        gap: Math.max(0, Math.min(40, Number($("#tdp-gap").value) || 12)),\n        hideUnused: $("#tdp-hide-unused").checked\n', '        buttonSize: currentFolder.buttonSize,\n        gap: currentFolder.gap,\n        hideUnused: currentFolder.hideUnused\n');

  if (!js.includes('id="tdp-pagebar"')) {
    js = js.replace('<div class="tdp-grid-viewport">\n              <div id="tdp-grid" class="tdp-grid" aria-label="Touch-Deck-Tasten"></div>\n            </div>\n            <p class="tdp-stage-help">', '<div class="tdp-grid-viewport">\n              <div id="tdp-grid" class="tdp-grid" aria-label="Touch-Deck-Tasten"></div>\n            </div>\n            <div id="tdp-pagebar" class="tdp-pagebar"><button id="tdp-prev-page" type="button" title="Vorherige Seite">◀</button><div id="tdp-pages" class="tdp-pages"></div><button id="tdp-add-page" type="button" title="Neue Seite">＋</button><button id="tdp-next-page" type="button" title="Nächste Seite">▶</button></div>\n            <p class="tdp-stage-help">');
    js = js.replace('    $("#tdp-add-folder").addEventListener("click", createFolder);', '    $("#tdp-add-folder").addEventListener("click", createFolder);\n    $("#tdp-add-page").addEventListener("click", createPage);\n    $("#tdp-prev-page").addEventListener("click", () => switchPage(-1));\n    $("#tdp-next-page").addEventListener("click", () => switchPage(1));');
    js = js.replace('    renderGrid(currentProfile, currentFolder);\n    renderInspector(currentProfile, currentFolder);', '    renderGrid(currentProfile, currentFolder);\n    renderPages(currentProfile, currentFolder);\n    renderInspector(currentProfile, currentFolder);');
    js = js.replace('  function isUsed(button) {', `  function pageFolders(currentProfile = profile()) {\n    return (currentProfile?.folders || []).filter((entry) => !entry.parentId);\n  }\n\n  function renderPages(currentProfile, currentFolder) {\n    const target = $(\"#tdp-pages\");\n    if (!target) return;\n    const pages = pageFolders(currentProfile);\n    const activePage = currentFolder.parentId ? pages.find((page) => page.id === currentFolder.parentId) || pages[0] : currentFolder;\n    target.replaceChildren(...pages.map((page, index) => {\n      const button = document.createElement(\"button\");\n      button.type = \"button\";\n      button.className = \`tdp-page-dot\${page.id === activePage?.id ? \" active\" : \"\"}\`;\n      button.textContent = String(index + 1);\n      button.title = page.name || \`Seite \${index + 1}\`;\n      button.addEventListener(\"click\", async () => { await call(\"deck:activate-folder\", { profileId: currentProfile.id, folderId: page.id }); selectedIndex = -1; draft = null; draftDirty = false; await refresh(); });\n      return button;\n    }));\n  }\n\n  async function createPage() {\n    const currentProfile = profile();\n    const name = window.prompt(\"Name der neuen Seite:\", \`Seite \${pageFolders(currentProfile).length + 1}\`)?.trim();\n    if (!name) return;\n    await call(\"deck:create-page\", { profileId: currentProfile.id, name });\n    selectedIndex = -1; draft = null; draftDirty = false; await refresh();\n  }\n\n  async function switchPage(direction) {\n    const currentProfile = profile();\n    const currentFolder = folder(currentProfile);\n    const pages = pageFolders(currentProfile);\n    if (pages.length < 2) return;\n    const activeId = currentFolder.parentId || currentFolder.id;\n    const currentIndex = Math.max(0, pages.findIndex((page) => page.id === activeId));\n    const next = pages[(currentIndex + direction + pages.length) % pages.length];\n    await call(\"deck:activate-folder\", { profileId: currentProfile.id, folderId: next.id });\n    selectedIndex = -1; draft = null; draftDirty = false; await refresh();\n  }\n\n  function isUsed(button) {`);
  }
  write(jsFile, js);

  const cssFile = "src/renderer/touch-deck-pro-v2.css";
  let css = read(cssFile);
  if (!css.includes("/* Elgato-style Touch-Deck layout */")) {
    css += `\n/* Elgato-style Touch-Deck layout */\n.tdp-editor-layout{grid-template-columns:minmax(480px,1fr) minmax(260px,330px);grid-template-rows:minmax(360px,1fr) minmax(250px,.62fr)}\n.tdp-stage{grid-column:1;grid-row:1;padding:12px 14px 10px;grid-template-rows:auto auto minmax(0,1fr) auto auto}\n.tdp-library{grid-column:2;grid-row:1 / 3;border-right:0;border-left:1px solid #353535}\n.tdp-inspector{grid-column:1;grid-row:2;border-left:0;border-top:1px solid #353535;overflow:auto;padding:14px}\n.tdp-grid-panel{grid-template-columns:minmax(90px,160px) minmax(90px,160px) auto;justify-content:start}\n.tdp-pagebar{display:flex;min-height:42px;align-items:center;justify-content:center;gap:7px;padding-top:8px}\n.tdp-pagebar>button,.tdp-page-dot{min-width:32px;min-height:30px;padding:0 8px;border:1px solid #384555;border-radius:6px;background:#151d27;color:#aeb9c6}\n.tdp-pages{display:flex;gap:5px;align-items:center}.tdp-page-dot.active{border-color:#5cdcff;color:#fff;background:#1b4353;box-shadow:0 0 0 1px rgb(92 220 255 / 18%)}\n@media(max-width:1100px){.tdp-editor-layout{grid-template-columns:minmax(390px,1fr) 260px;grid-template-rows:minmax(330px,1fr) minmax(260px,.72fr)}}\n`;
    write(cssFile, css);
  }
}

// Seiten im Deck-Store: Top-Level-Ordner sind Seiten, Unterordner bleiben normale Ordner.
{
  const file = "src/services/deck-store.cjs";
  let text = read(file);
  if (!text.includes("  createPage(profileId, name)")) {
    text = text.replace('  createFolder(profileId, name, parentId = "root") {', `  createPage(profileId, name) {\n    const profile = this.getProfile(profileId);\n    if (!profile) throw new Error(\"Profil wurde nicht gefunden.\");\n    const template = profile.folders.find((folder) => folder.id === (profile.activeFolderId || \"root\")) || profile.folders[0];\n    const page = normalizeFolder({ id: randomId(\"page\"), name: safeText(name || \"Neue Seite\", 120), parentId: \"\", rows: template.rows, columns: template.columns, buttonSize: template.buttonSize, gap: template.gap }, profile.folders.length);\n    profile.folders.push(page);\n    profile.activeFolderId = page.id;\n    return this.save();\n  }\n\n  createFolder(profileId, name, parentId = \"root\") {`);
    write(file, text);
  }
}

// Main: Seiten-IPC, .streamDeckPlugin Import und Twitch-Hologramm nicht mehr starten/exponieren.
{
  const file = "src/main.cjs";
  let text = read(file);
  if (!text.includes('handle("deck:create-page"')) text = text.replace('  handle("deck:create-folder",', '  handle("deck:create-page", (payload) => deckStore.createPage(payload.profileId, payload.name));\n  handle("deck:create-folder",');

  text = text.replace(/const \{ TwitchHoloServer \} = require\("\.\/services\/twitch-holo-server\.cjs"\);\n?/, "");
  text = text.replace(/let holoServer = null;\n?/, "");
  text = text.replace(/\n\s*try \{\n\s*holoServer = new TwitchHoloServer\([\s\S]*?\n\s*\} catch \(error\) \{[^\n]*\}\n/, "\n");
  text = text.replace(/\n\s*handle\("holo:open"[\s\S]*?handle\("holo:clear"[^\n]*\n/, "\n");

  const oldImport = `  handle(\"plugins:import\", async () => {\n    const result = await dialog.showOpenDialog(mainWindow, { title: \"Plugin-Ordner auswählen\", properties: [\"openDirectory\"] });\n    if (result.canceled || !result.filePaths[0]) return null;\n    return pluginRegistry.importDirectory(result.filePaths[0], path.join(programDataRoot(), \"Plugins\"));\n  });`;
  const newImport = `  handle(\"plugins:import\", async () => {\n    const result = await dialog.showOpenDialog(mainWindow, { title: \"Stream-Deck-Plugin installieren\", properties: [\"openFile\"], filters: [{ name: \"Stream Deck Plugin\", extensions: [\"streamDeckPlugin\"] }] });\n    if (result.canceled || !result.filePaths[0]) return null;\n    return pluginRegistry.importPackage(result.filePaths[0], path.join(programDataRoot(), \"Plugins\"));\n  });`;
  if (text.includes(oldImport)) text = text.replace(oldImport, newImport);
  write(file, text);
}

// Plugin Registry: Original .streamDeckPlugin Pakete entpacken und Manifest/Actions einlesen.
{
  const file = "src/services/plugin-registry.cjs";
  let text = read(file);
  if (!text.includes("importPackage(packageFile")) {
    text = text.replace('const { EventEmitter } = require("node:events");', 'const { EventEmitter } = require("node:events");\nconst childProcess = require("node:child_process");');
    text = text.replace('  importDirectory(sourceDirectory, destinationRoot) {', `  importPackage(packageFile, destinationRoot) {\n    const source = path.resolve(String(packageFile || \"\"));\n    if (!fs.existsSync(source) || path.extname(source).toLowerCase() !== \".streamdeckplugin\") throw new Error(\"Bitte eine originale .streamDeckPlugin-Datei auswählen.\");\n    const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), \"batto-streamdeck-\"));\n    const archive = path.join(workRoot, \"plugin.zip\");\n    const extracted = path.join(workRoot, \"unpacked\");\n    fs.copyFileSync(source, archive);\n    fs.mkdirSync(extracted, { recursive: true });\n    const ps = \`Expand-Archive -LiteralPath '\${archive.replaceAll(\"'\", \"''\")}' -DestinationPath '\${extracted.replaceAll(\"'\", \"''\")}' -Force\`;\n    const result = childProcess.spawnSync(\"powershell.exe\", [\"-NoLogo\", \"-NoProfile\", \"-NonInteractive\", \"-ExecutionPolicy\", \"Bypass\", \"-Command\", ps], { windowsHide: true, encoding: \"utf8\" });\n    if (result.status !== 0) throw new Error(\`Stream-Deck-Plugin konnte nicht entpackt werden: \${String(result.stderr || result.stdout || \"Unbekannter Fehler\").trim()}\`);\n    const manifests = walk(extracted, 6).filter((file) => /(?:^|[\\\\/])manifest\\.json$/i.test(file));\n    if (!manifests.length) throw new Error(\"Das Paket enthält kein Stream-Deck-manifest.json.\");\n    const pluginDirectory = path.dirname(manifests[0]);\n    const snapshot = this.importDirectory(pluginDirectory, destinationRoot);\n    try { fs.rmSync(workRoot, { recursive: true, force: true }); } catch {}\n    return snapshot;\n  }\n\n  importDirectory(sourceDirectory, destinationRoot) {`);
    write(file, text);
  }
}

console.log("Batto Chat-Plan 2026 angewendet: Übersicht, Multi-Chat, Touch-Deck Pro, Stream-Overlay und Plugin-Import.");
