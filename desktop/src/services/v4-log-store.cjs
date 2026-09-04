"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

class V4LogStore {
  constructor(filename, options = {}) {
    this.filename = filename;
    this.maxEntries = Number(options.maxEntries || 5000);
    this.entries = [];
  }
  async load() {
    try {
      const text = await fs.readFile(this.filename, "utf8");
      this.entries = text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)).slice(-this.maxEntries);
    } catch { this.entries = []; }
    return this.list();
  }
  list(options = {}) {
    const category = String(options.category || "all").toLowerCase();
    const limit = Math.max(1, Math.min(2000, Number(options.limit || 500)));
    const filtered = category === "all" ? this.entries : this.entries.filter((entry) => String(entry.category).toLowerCase() === category);
    return filtered.slice(-limit).map((entry) => ({ ...entry }));
  }
  async append(category, level, message, data = null) {
    const entry = { timestamp: new Date().toISOString(), category: String(category || "general"), level: String(level || "info"), message: String(message || ""), data };
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) this.entries.splice(0, this.entries.length - this.maxEntries);
    await this.persist();
    return { ...entry };
  }
  async clear() { this.entries = []; await this.persist(); return true; }
  async persist() {
    await fs.mkdir(path.dirname(this.filename), { recursive: true });
    const body = this.entries.map((entry) => JSON.stringify(entry)).join("\n");
    await fs.writeFile(this.filename, body ? `${body}\n` : "", { encoding: "utf8", mode: 0o600 });
  }
}

module.exports = { V4LogStore };
