"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const htmlFile = path.join(root, "src", "renderer", "index.html");
let html = fs.readFileSync(htmlFile, "utf8");

const cssTag = '<link rel="stylesheet" href="./commercial-settings.css">';
const jsTag = '<script src="./commercial-settings.js"></script>';
const compatTag = '<script src="./settings-compat.js"></script>';

if (!html.includes(cssTag)) {
  const marker = '<link rel="stylesheet" href="./styles.css">';
  if (!html.includes(marker)) throw new Error("styles.css marker missing in renderer/index.html");
  html = html.replace(marker, `${marker}\n    ${cssTag}`);
}

if (!html.includes(jsTag)) {
  const marker = "</body>";
  if (!html.includes(marker)) throw new Error("body closing tag missing in renderer/index.html");
  html = html.replace(marker, `  ${jsTag}\n  ${compatTag}\n  ${marker}`);
} else if (!html.includes(compatTag)) {
  html = html.replace(jsTag, `${jsTag}\n  ${compatTag}`);
}

html = html
  .replaceAll("BATTO OBS TOOL 1.9.1", "BATTO OBS TOOL 2.1.0")
  .replaceAll("Version 1.9.1", "Version 2.1.0");

fs.writeFileSync(htmlFile, html, "utf8");
console.log("Commercial settings center + compatibility layer integrated.");
