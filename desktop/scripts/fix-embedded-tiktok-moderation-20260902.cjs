"use strict";

const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const file = path.join(root, "src/chat-bootstrap.cjs");
let text = fs.readFileSync(file, "utf8");

const marker = "BATTO_EMBEDDED_TIKTOK_MOD_V1";
if (!text.includes(marker)) {
  const cssLine = '  const cssPath = path.join(__dirname, "renderer", "multi-chat.css").replaceAll("\\\\", "/");';
  if (!text.includes(cssLine)) throw new Error("Embedded TikTok MOD: CSS-Pfad-Marker fehlt.");
  text = text.replace(cssLine, cssLine + '\n  const moderationPath = path.join(__dirname, "renderer", "tiktok-moderation.js").replaceAll("\\\\", "/");\n  const moderationCssPath = path.join(__dirname, "renderer", "tiktok-moderation.css").replaceAll("\\\\", "/");\n  // ' + marker);

  const oldHead = "const css=document.createElement('link');css.rel='stylesheet';css.href='file://${cssPath}';document.head.appendChild(css);";
  const newHead = oldHead + "const modCss=document.createElement('link');modCss.rel='stylesheet';modCss.href='file://${moderationCssPath}';document.head.appendChild(modCss);";
  if (!text.includes(oldHead)) throw new Error("Embedded TikTok MOD: Stylesheet-Injection-Marker fehlt.");
  text = text.replace(oldHead, newHead);

  const oldLoad = "s.onload=function(){const controls=document.createElement('script');controls.src='file://${controlsPath}';document.body.appendChild(controls);};";
  const newLoad = "s.onload=function(){const controls=document.createElement('script');controls.src='file://${controlsPath}';document.body.appendChild(controls);const moderation=document.createElement('script');moderation.src='file://${moderationPath}';document.body.appendChild(moderation);};";
  if (!text.includes(oldLoad)) throw new Error("Embedded TikTok MOD: Script-Injection-Marker fehlt.");
  text = text.replace(oldLoad, newLoad);
  fs.writeFileSync(file, text, "utf8");
}

for (const token of [marker, "tiktok-moderation.js", "tiktok-moderation.css", "moderation.src='file://${moderationPath}'"]) {
  if (!text.includes(token) && !fs.readFileSync(file, "utf8").includes(token)) throw new Error("Embedded TikTok MOD fehlt: " + token);
}

console.log("Embedded Multi-Chat lädt TikTok-Moderation und CSS jetzt wirklich im Hauptfenster.");
