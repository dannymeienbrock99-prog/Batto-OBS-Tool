"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const file = path.join(root, "src", "stream-overlay", "overlay.js");
let text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");

if (!text.includes("function applyViewport()")) {
  const marker = "  function render() {\n";
  if (!text.includes(marker)) throw new Error("Overlay: render()-Patchpunkt fehlt.");
  const helper = `  function applyViewport() {\n    const width = Math.max(1, Number(config.width) || 1920);\n    const height = Math.max(1, Number(config.height) || 1080);\n    const viewportWidth = Math.max(1, window.innerWidth || width);\n    const viewportHeight = Math.max(1, window.innerHeight || height);\n    const scale = Math.min(viewportWidth / width, viewportHeight / height);\n    stage.style.position = \"absolute\";\n    stage.style.left = \"50%\";\n    stage.style.top = \"50%\";\n    stage.style.width = width + \"px\";\n    stage.style.height = height + \"px\";\n    stage.style.transformOrigin = \"center center\";\n    stage.style.transform = \"translate(-50%, -50%) scale(\" + scale + \")\";\n    stage.dataset.orientation = height > width ? \"portrait\" : \"landscape\";\n  }\n\n`;
  text = text.replace(marker, helper + marker);
}

if (!/function render\(\) \{\n\s*applyViewport\(\);/.test(text)) {
  text = text.replace("  function render() {\n", "  function render() {\n    applyViewport();\n");
}

if (!text.includes('window.addEventListener("resize", applyViewport)')) {
  const marker = "  connect();\n})();";
  if (!text.includes(marker)) throw new Error("Overlay: connect()-Patchpunkt fehlt.");
  text = text.replace(marker, '  window.addEventListener("resize", applyViewport);\n  connect();\n})();');
}

if (!text.includes("stage.dataset.orientation") || !text.includes('window.addEventListener("resize", applyViewport)') || !/function render\(\) \{\n\s*applyViewport\(\);/.test(text)) {
  throw new Error("Overlay-Ausrichtung ist nach Reparatur nicht vollständig verdrahtet.");
}

fs.writeFileSync(file, text, "utf8");
console.log("Stream-Overlay: gespeicherte Breite/Höhe, Hoch-/Querformat und Viewport-Skalierung robust verdrahtet.");
