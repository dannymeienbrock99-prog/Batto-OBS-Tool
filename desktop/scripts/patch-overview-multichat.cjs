"use strict";
const fs = require("node:fs");
const path = require("node:path");

const file = path.join(__dirname, "..", "src", "renderer", "index.html");
let html = fs.readFileSync(file, "utf8");
const oldImage = /\s*<img class="overview-bg"[^>]*>\s*/;
if (oldImage.test(html)) {
  html = html.replace(oldImage, "\n              ");
}
fs.writeFileSync(file, html, "utf8");
console.log("Overview: altes bg-Bild entfernt; Multi-Chat-CSS-Artwork aktiv.");
