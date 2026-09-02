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

// IPC im Electron-Mainprozess verdrahten.
{
  const file = "src/main.cjs";
  let text = read(file).replace(/\r\n/g, "\n");
  text = replaceRequired(
    text,
    '  handle("deck:activate-profile", (payload) => deckStore.activateProfile(payload.profileId));\n  handle("deck:create-folder", (payload) => deckStore.createFolder(payload.profileId, payload.name, payload.parentId));',
    '  handle("deck:activate-profile", (payload) => deckStore.activateProfile(payload.profileId));\n  handle("deck:create-page", (payload) => deckStore.createPage(payload.profileId, payload.name));\n  handle("deck:create-folder", (payload) => deckStore.createFolder(payload.profileId, payload.name, payload.parentId));',
    "Touch-Deck-Seiten-IPC im Mainprozess"
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
  ["Preload IPC deck:create-page", preload.includes('"deck:create-page"')]
]) {
  if (!ok) throw new Error(`${label} fehlt nach dem Patch.`);
}

console.log("Touch-Deck Pro: echte Top-Level-Seiten mit DeckStore, IPC und Preload verdrahtet.");
