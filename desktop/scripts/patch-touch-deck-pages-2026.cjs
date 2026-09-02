"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const write = (relative, value) => fs.writeFileSync(path.join(root, relative), value, "utf8");

function replaceRequired(text, search, replacement, label) {
  if (text.includes(replacement)) return text;
  if (!text.includes(search)) throw new Error(`${label} wurde nicht gefunden.`);
  return text.replace(search, replacement);
}

// Echte Touch-Deck-Seiten: Top-Level-Folder ohne parentId.
{
  const file = "src/services/deck-store.cjs";
  let text = read(file).replace(/\r\n/g, "\n");
  if (!text.includes("  createPage(profileId, name) {")) {
    const marker = "  createFolder(profileId, name, parentId = \"root\") {";
    if (!text.includes(marker)) throw new Error("DeckStore.createFolder-Patchpunkt fehlt.");
    const method = `  createPage(profileId, name) {\n    const profile = this.getProfile(profileId);\n    if (!profile) throw new Error(\"Profil wurde nicht gefunden.\");\n    const active = profile.folders.find((folder) => folder.id === profile.activeFolderId);\n    const template = (active && !active.parentId ? active : null)\n      || profile.folders.find((folder) => !folder.parentId)\n      || profile.folders[0];\n    if (!template) throw new Error(\"Keine Seitenvorlage im Profil gefunden.\");\n    const pageNumber = profile.folders.filter((folder) => !folder.parentId).length + 1;\n    const page = normalizeFolder({\n      id: randomId(\"page\"),\n      name: safeText(name || \`Seite \${pageNumber}\`, 120),\n      parentId: \"\",\n      rows: template.rows,\n      columns: template.columns,\n      buttonSize: template.buttonSize,\n      gap: template.gap,\n      hideUnused: template.hideUnused,\n      opacity: template.opacity,\n      background: template.background\n    }, profile.folders.length, { rows: template.rows, columns: template.columns });\n    profile.folders.push(page);\n    profile.activeFolderId = page.id;\n    return this.save();\n  }\n\n`;
    text = text.replace(marker, method + marker);
  }
  write(file, text);
}

// IPC im Electron-Mainprozess verdrahten und einen echten headless Self-Test bereitstellen.
{
  const file = "src/main.cjs";
  let text = read(file).replace(/\r\n/g, "\n");
  text = replaceRequired(
    text,
    '  handle("deck:activate-profile", (payload) => deckStore.activateProfile(payload.profileId));\n  handle("deck:create-folder", (payload) => deckStore.createFolder(payload.profileId, payload.name, payload.parentId));',
    '  handle("deck:activate-profile", (payload) => deckStore.activateProfile(payload.profileId));\n  handle("deck:create-page", (payload) => deckStore.createPage(payload.profileId, payload.name));\n  handle("deck:create-folder", (payload) => deckStore.createFolder(payload.profileId, payload.name, payload.parentId));',
    "Touch-Deck-Seiten-IPC im Mainprozess"
  );

  if (!text.includes("async function selfTest() {")) {
    const marker = "async function initialize() {";
    if (!text.includes(marker)) throw new Error("Initialize-Patchpunkt für Self-Test fehlt.");
    const selfTest = `async function selfTest() {\n  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), \"batto-obs-tool-selftest-\"));\n  const results = { ok: true, version: app.getVersion(), tests: [] };\n  const check = async (name, callback) => {\n    try {\n      const value = await callback();\n      results.tests.push({ name, ok: true, value });\n    } catch (error) {\n      results.ok = false;\n      results.tests.push({ name, ok: false, error: String(error?.message || error) });\n    }\n  };\n  try {\n    await check(\"TouchDeckPages\", () => {\n      const store = new DeckStore(path.join(temporary, \"deck.json\"));\n      const profile = store.snapshot().profiles[0];\n      store.createPage(profile.id, \"Self-Test\");\n      const current = store.snapshot().profiles[0];\n      const page = current.folders.find((folder) => folder.name === \"Self-Test\");\n      if (!page || page.parentId !== \"\" || current.activeFolderId !== page.id) throw new Error(\"Top-Level-Seite konnte nicht erstellt oder aktiviert werden.\");\n      return { pageId: page.id, pages: current.folders.filter((folder) => !folder.parentId).length };\n    });\n    await check(\"PluginRegistry\", () => {\n      const snapshot = new PluginRegistry({ stateFile: path.join(temporary, \"plugins.json\"), pluginRoots: [], iconPackRoots: [] }).scan();\n      if (!snapshot.plugins.length) throw new Error(\"Keine Plugin-Aktionen verfügbar.\");\n      return { plugins: snapshot.plugins.length };\n    });\n    await check(\"StreamOverlayFiles\", () => {\n      const required = [\"editor.html\", \"overlay.html\", \"chat-overlay.html\"];\n      const missing = required.filter((name) => !fs.existsSync(path.join(__dirname, \"stream-overlay\", name)));\n      if (missing.length) throw new Error(\`Stream-Overlay-Dateien fehlen: \${missing.join(\", \")}\`);\n      return required;\n    });\n    await check(\"MobileFiles\", () => {\n      const required = [\"index.html\", \"app.js\"];\n      const missing = required.filter((name) => !fs.existsSync(path.join(__dirname, \"mobile\", name)));\n      if (missing.length) throw new Error(\`Mobile-Dateien fehlen: \${missing.join(\", \")}\`);\n      return required;\n    });\n    process.stdout.write(\`\${JSON.stringify(results)}\\n\`);\n  } finally {\n    fs.rmSync(temporary, { recursive: true, force: true });\n  }\n  app.exit(results.ok ? 0 : 1);\n}\n\n`;
    text = text.replace(marker, selfTest + marker);
  }

  text = replaceRequired(
    text,
    "async function initialize() {\n  loadSettings();",
    "async function initialize() {\n  loadSettings();\n  if (process.argv.includes(\"--self-test\")) return selfTest();",
    "Self-Test-Abzweig vor normalem Programmstart"
  );

  text = replaceRequired(
    text,
    'app.whenReady().then(initialize).catch((error) => {\n  console.error(error);\n  dialog.showErrorBox("Batto OBS Tool – Startfehler", errorPayload(error).message);\n});',
    'app.whenReady().then(initialize).catch((error) => {\n  console.error(error);\n  if (process.argv.includes("--self-test")) app.exit(1);\n  else dialog.showErrorBox("Batto OBS Tool – Startfehler", errorPayload(error).message);\n});',
    "Fehlerbehandlung für headless Self-Test"
  );
  write(file, text);
}

// Sichere Preload-Whitelist um den neuen IPC-Kanal erweitern.
{
  const file = "src/preload.cjs";
  let text = read(file).replace(/\r\n/g, "\n");
  text = replaceRequired(
    text,
    '  "deck:create-profile", "deck:update-profile", "deck:delete-profile", "deck:activate-profile",\n  "deck:create-folder", "deck:update-folder", "deck:delete-folder", "deck:activate-folder",',
    '  "deck:create-profile", "deck:update-profile", "deck:delete-profile", "deck:activate-profile",\n  "deck:create-page", "deck:create-folder", "deck:update-folder", "deck:delete-folder", "deck:activate-folder",',
    "Touch-Deck-Seiten-IPC in der Preload-Whitelist"
  );
  write(file, text);
}

const deckStore = read("src/services/deck-store.cjs");
const main = read("src/main.cjs");
const preload = read("src/preload.cjs");
for (const [label, ok] of [
  ["DeckStore.createPage", deckStore.includes("createPage(profileId, name)") && deckStore.includes('parentId: ""')],
  ["Main IPC deck:create-page", main.includes('handle("deck:create-page"')],
  ["Preload IPC deck:create-page", preload.includes('"deck:create-page"')],
  ["Headless Self-Test", main.includes('process.argv.includes("--self-test")') && main.includes("async function selfTest() {")]
]) {
  if (!ok) throw new Error(`${label} fehlt nach dem Patch.`);
}

console.log("Touch-Deck Pro: echte Top-Level-Seiten, IPC und headless Installer-Self-Test verdrahtet.");
