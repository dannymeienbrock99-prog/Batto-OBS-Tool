"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const design = require("../shared/chat-design.js");

class ChatDesignStore extends EventEmitter {
  constructor(filename) { super(); this.filename = filename; this.config = design.defaults(); this.pending = Promise.resolve(); }
  async load() {
    try { this.config = design.normalize(JSON.parse(await fs.readFile(this.filename, "utf8"))); }
    catch (error) { if (error.code !== "ENOENT") throw new Error("Chatdesign konnte nicht geladen werden: " + error.message); }
    return this.snapshot();
  }
  snapshot() { return structuredClone(this.config); }
  save(input) {
    const next = design.normalize(input);
    const task = this.pending.then(async () => {
      await fs.mkdir(path.dirname(this.filename), { recursive: true });
      const temporary = this.filename + ".tmp";
      await fs.writeFile(temporary, JSON.stringify(next, null, 2), { encoding: "utf8", mode: 0o600 });
      await fs.rename(temporary, this.filename);
      this.config = next;
      this.emit("changed", this.snapshot());
      return this.snapshot();
    });
    this.pending = task.catch(() => {});
    return task;
  }
}
module.exports = { ChatDesignStore };
