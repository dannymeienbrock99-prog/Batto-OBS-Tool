"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const sourceRoot = path.join(root, "bootstrap-2.0", "src", "services");
const targetRoot = path.join(root, "src", "services");
const files = ["common.cjs", "deck-store.cjs", "plugin-registry.cjs"];

fs.mkdirSync(targetRoot, { recursive: true });
for (const name of files) {
  const source = path.join(sourceRoot, name);
  const target = path.join(targetRoot, name);
  if (!fs.existsSync(source) || !fs.statSync(source).size) throw new Error(`Runtime-Unterbau fehlt: ${source}`);
  fs.copyFileSync(source, target);
}

console.log(`Runtime-Unterbau vorbereitet: ${files.join(", ")}`);
