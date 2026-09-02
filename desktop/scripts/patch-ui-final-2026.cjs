"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const write = (relative, value) => fs.writeFileSync(path.join(root, relative), value, "utf8");

function requireFile(relative) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file) || !fs.statSync(file).size) throw new Error(`Erforderliche UI-Datei fehlt: ${relative}`);
  return file;
}

// Übersicht mit dem vom Nutzer gelieferten Drachen-PC-Hintergrund aufbauen.
{
  const backgroundFile = requireFile("src/renderer/assets/overview-bg.jpg");
  const image = fs.readFileSync(backgroundFile);
  if (image.length < 10000 || image[0] !== 0xff || image[1] !== 0xd8) throw new Error("overview-bg.jpg ist kein gültiges JPEG.");

  const indexFile = "src/renderer/index.html";
  let html = read(indexFile);
  html = html.replace('<div class="hero panel">', '<div class="hero panel overview-hero">');
  html = html.replace(/(<section class="page active" data-page-panel="overview">[\s\S]*?<div class="hero panel overview-hero">[\s\S]*?)<img src="\.\/assets\/team-logo\.(?:svg|png)" alt="Team Alpha">/, "$1");
  write(indexFile, html);

  const stylesFile = "src/renderer/styles.css";
  let css = read(stylesFile);
  if (!css.includes("/* Batto overview dragon hero */")) {
    css += `\n/* Batto overview dragon hero */\n.overview-hero {\n  position: relative;\n  min-height: 285px;\n  isolation: isolate;\n  overflow: hidden;\n  background-image:\n    linear-gradient(90deg, rgba(4,7,12,.98) 0%, rgba(7,10,16,.91) 30%, rgba(7,10,16,.58) 52%, rgba(4,7,12,.14) 76%),\n    radial-gradient(circle at 18% 58%, rgba(160,0,26,.34), transparent 39%),\n    url("./assets/overview-bg.jpg");\n  background-size: cover;\n  background-position: center right;\n  background-repeat: no-repeat;\n}\n.overview-hero > div { position: relative; z-index: 1; max-width: min(790px, 64%); }\n.overview-hero h2 { text-shadow: 0 2px 20px rgba(0,0,0,.9); }\n.overview-hero p { color: #d5dde7; text-shadow: 0 2px 14px rgba(0,0,0,.94); }\n@media (max-width: 1120px) { .overview-hero { background-position: 68% center; } .overview-hero > div { max-width: 74%; } }\n`;
    write(stylesFile, css);
  }
}

// Stream-Overlay: Rechtsklick-Menü, Kopieren, Duplizieren, Löschen und Ausrichten.
{
  const editorFile = "src/stream-overlay/editor.js";
  let js = read(editorFile);

  if (!js.includes("function alignSelected(mode)")) {
    const marker = "  function deleteSelected() {";
    if (!js.includes(marker)) throw new Error("Overlay-Editor-Patchpunkt für Kontextaktionen fehlt.");
    const methods = `  function alignSelected(mode) {\n    const item = selected();\n    if (!item) return;\n    const canvas = state.config.resolution;\n    if (mode === "left") item.x = 0;\n    if (mode === "center") item.x = Math.max(0, (canvas.width - item.width) / 2);\n    if (mode === "right") item.x = Math.max(0, canvas.width - item.width);\n    if (mode === "top") item.y = 0;\n    if (mode === "middle") item.y = Math.max(0, (canvas.height - item.height) / 2);\n    if (mode === "bottom") item.y = Math.max(0, canvas.height - item.height);\n    markDirty("Element ausgerichtet – noch nicht gespeichert");\n    renderPreview();\n  }\n\n  async function copySelected() {\n    const item = selected();\n    if (!item) return;\n    state.elementClipboard = clone(item);\n    await copyText(JSON.stringify(item, null, 2));\n    toast("Element kopiert.");\n  }\n\n  function closeElementContextMenu() {\n    document.getElementById("overlay-element-context-menu")?.remove();\n  }\n\n  function showElementContextMenu(clientX, clientY) {\n    closeElementContextMenu();\n    if (!selected()) return;\n    const menu = document.createElement("div");\n    menu.id = "overlay-element-context-menu";\n    menu.className = "overlay-context-menu";\n    const actions = [\n      ["Kopieren", () => copySelected()],\n      ["Duplizieren", () => duplicateSelected()],\n      ["Löschen", () => deleteSelected()],\n      ["Links ausrichten", () => alignSelected("left")],\n      ["Horizontal zentrieren", () => alignSelected("center")],\n      ["Rechts ausrichten", () => alignSelected("right")],\n      ["Oben ausrichten", () => alignSelected("top")],\n      ["Vertikal zentrieren", () => alignSelected("middle")],\n      ["Unten ausrichten", () => alignSelected("bottom")]\n    ];\n    for (const [label, handler] of actions) {\n      const button = document.createElement("button");\n      button.type = "button";\n      button.textContent = label;\n      button.addEventListener("click", async () => {\n        closeElementContextMenu();\n        await handler();\n      });\n      menu.append(button);\n    }\n    document.body.append(menu);\n    const rect = menu.getBoundingClientRect();\n    menu.style.left = Math.max(8, Math.min(clientX, innerWidth - rect.width - 8)) + "px";\n    menu.style.top = Math.max(8, Math.min(clientY, innerHeight - rect.height - 8)) + "px";\n  }\n\n`;
    js = js.replace(marker, methods + marker);
  }

  if (!js.includes('element.addEventListener("contextmenu"')) {
    const marker = '    element.addEventListener("click", (event) => { event.stopPropagation(); state.selectedId = item.id; renderPreview(); });';
    if (!js.includes(marker)) throw new Error("Overlay-Element-Klick-Patchpunkt fehlt.");
    js = js.replace(marker, `${marker}\n    element.addEventListener("contextmenu", (event) => {\n      event.preventDefault();\n      event.stopPropagation();\n      state.selectedId = item.id;\n      renderPreview();\n      showElementContextMenu(event.clientX, event.clientY);\n    });`);
  }

  if (!js.includes('document.addEventListener("pointerdown", (event) =>')) {
    const marker = '    $("preview-stage").addEventListener("click", (event) => { if (event.target === $("preview-stage")) { state.selectedId = ""; renderPreview(); } });';
    if (!js.includes(marker)) throw new Error("Overlay-Bind-Patchpunkt fehlt.");
    js = js.replace(marker, `${marker}\n    document.addEventListener("pointerdown", (event) => {\n      const menu = document.getElementById("overlay-element-context-menu");\n      if (menu && !menu.contains(event.target)) closeElementContextMenu();\n    });\n    document.addEventListener("keydown", (event) => {\n      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c" && selected()) { event.preventDefault(); copySelected(); }\n      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d" && selected()) { event.preventDefault(); duplicateSelected(); }\n      if (event.key === "Delete" && selected() && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "")) { event.preventDefault(); deleteSelected(); }\n      if (event.key === "Escape") closeElementContextMenu();\n    });`);
  }
  write(editorFile, js);

  const cssFile = "src/stream-overlay/editor.css";
  let css = read(cssFile);
  if (!css.includes(".overlay-context-menu")) {
    css += `\n.overlay-context-menu{position:fixed;z-index:9999;display:grid;min-width:210px;padding:6px;border:1px solid #3b4d61;border-radius:9px;background:#0b1119;box-shadow:0 18px 48px rgba(0,0,0,.48)}\n.overlay-context-menu button{min-height:34px;padding:0 10px;border:0;border-radius:6px;text-align:left;background:transparent;color:#e7eef6}\n.overlay-context-menu button:hover{background:#152536;color:#fff}\n`;
    write(cssFile, css);
  }
}

console.log("Batto UI 2026: Übersichtshintergrund und Stream-Overlay-Kontextwerkzeuge fertig eingebaut.");
