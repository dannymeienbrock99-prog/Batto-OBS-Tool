"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeLocalObsHost(value) {
  let host = String(value || "").trim();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  const normalized = host.toLowerCase();
  if (normalized === "localhost" || normalized === "127.0.0.1") return "127.0.0.1";
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return "::1";
  return "127.0.0.1";
}

const DEFAULT_STATE = Object.freeze({
  version: 2,
  obs: {
    host: "127.0.0.1",
    port: 4455,
    password: ""
  },
  preferences: {
    platform: "twitch",
    targetResolution: "1920x1080",
    targetFps: 60,
    monitoringEnabled: true,
    twitchHoloEnabled: true
  }
});

function normalizeState(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};

  return {
    version: 2,
    obs: {
      host: normalizeLocalObsHost(source.obs?.host),
      port: Math.max(1, Math.min(65535, Math.round(Number(source.obs?.port) || 4455))),
      password: ""
    },
    preferences: {
      platform: ["twitch", "youtube", "recording"].includes(source.preferences?.platform)
        ? source.preferences.platform
        : "twitch",
      targetResolution: String(source.preferences?.targetResolution || "1920x1080"),
      targetFps: [30, 60, 120].includes(Number(source.preferences?.targetFps))
        ? Number(source.preferences.targetFps)
        : 60,
      monitoringEnabled: source.preferences?.monitoringEnabled !== false,
      twitchHoloEnabled: source.preferences?.twitchHoloEnabled !== false
    }
  };
}

class SettingsStore {
  constructor(filename) {
    this.filename = path.resolve(filename);
    this.state = clone(DEFAULT_STATE);
    this.loaded = false;
    this.queue = Promise.resolve();
  }

  async load() {
    if (this.loaded) return clone(this.state);
    try {
      this.state = normalizeState(JSON.parse(await fs.readFile(this.filename, "utf8")));
    } catch (error) {
      if (error.code !== "ENOENT") {
        const backup = `${this.filename}.invalid-${Date.now()}.json`;
        await fs.mkdir(path.dirname(this.filename), { recursive: true });
        await fs.rename(this.filename, backup).catch(() => {});
      }
      this.state = clone(DEFAULT_STATE);
    }
    this.loaded = true;
    await this.persist().catch(() => {});
    return clone(this.state);
  }

  async persist() {
    await fs.mkdir(path.dirname(this.filename), { recursive: true });
    const temporary = `${this.filename}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(this.state, null, 2), {
      encoding: "utf8",
      mode: 0o600
    });
    await fs.rename(temporary, this.filename);
  }

  async get() {
    await this.load();
    return clone(this.state);
  }

  async set(value) {
    await this.load();
    this.state = normalizeState(value);
    this.queue = this.queue.catch(() => {}).then(() => this.persist());
    await this.queue;
    return clone(this.state);
  }

  async patch(patch = {}) {
    const current = await this.get();
    return this.set({
      ...current,
      ...patch,
      obs: { ...current.obs, ...(patch.obs || {}) },
      preferences: { ...current.preferences, ...(patch.preferences || {}) }
    });
  }
}

module.exports = {
  DEFAULT_STATE,
  SettingsStore,
  normalizeLocalObsHost,
  normalizeState
};
