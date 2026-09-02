"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const mainFile = path.join(root, "src", "main.cjs");
let main = fs.readFileSync(mainFile, "utf8");

const broken = "eulerStreamModeration = new EulerStreamModeration({ secretStore });";
const fixed = `eulerStreamModeration = new EulerStreamModeration({
    secretStore: {
      get: async (key) => readSecrets()[String(key)] || "",
      set: async (key, value) => { writeSecret(String(key), String(value || "")); return true; },
      delete: async (key) => { writeSecret(String(key), ""); },
      has: async (key) => Boolean(readSecrets()[String(key)])
    }
  });`;

if (main.includes(broken)) main = main.replace(broken, fixed);

if (!main.includes(fixed)) throw new Error("TikTok Moderation: verschlüsselter Secret-Adapter fehlt.");
if (!main.includes("function readSecrets()")) throw new Error("TikTok Moderation: readSecrets() fehlt im Produktions-Mainprozess.");
if (!main.includes("function writeSecret(key, value)")) throw new Error("TikTok Moderation: writeSecret() fehlt im Produktions-Mainprozess.");
if (main.includes(broken)) throw new Error("TikTok Moderation: verwaister secretStore-Verweis ist noch vorhanden.");

fs.writeFileSync(mainFile, main, "utf8");
console.log("TikTok LIVE Moderation: OAuth-Token nutzt jetzt den vorhandenen Windows-safeStorage-Secretpfad; Startfehler beseitigt.");
