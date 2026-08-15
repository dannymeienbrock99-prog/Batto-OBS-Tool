"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const DEFAULT_STATE = Object.freeze({
  version: 1,
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
  },
  deck: {
    activeProfile: "Standard",
    profiles: {
      Standard: {
        rows: 3,
        columns: 5,
        pages: {
          root: Array.from({ length: 15 }, () => null)
        }
      }
    }
  }
});

function normalizeState(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const profiles = source.deck?.profiles && typeof source.deck.profiles === "object"
    ? source.deck.profiles
    : clone(DEFAULT_STATE.deck.profiles);
  const normalizedProfiles = {};
  for (const [rawName, rawProfile] of Object.entries(profiles).slice(0, 100)) {
    const name = String(rawName || "Standard").trim().slice(0, 80) || "Standard";
    const rows = Math.max(1, Math.min(10, Math.round(Number(rawProfile?.rows) || 3)));
    const columns = Math.max(1, Math.min(10, Math.round(Number(rawProfile?.columns) || 5)));
    const pages = rawProfile?.pages && typeof rawProfile.pages === "object"
      ? clone(rawProfile.pages)
      : { root: [] };
    pages.root ||= [];
    normalizedProfiles[name] = { rows, columns, pages };
  }
  if (!Object.keys(normalizedProfiles).length) {
    normalizedProfiles.Standard = clone(DEFAULT_STATE.deck.profiles.Standard);
  }
  const activeProfile = normalizedProfiles[source.deck?.activeProfile]
    ? source.deck.activeProfile
    : Object.keys(normalizedProfiles)[0];

  return {
    version: 1,
    obs: {
      host: String(source.obs?.host || "127.0.0.1").trim() || "127.0.0.1",
      port: Math.max(1, Math.min(65535, Math.round(Number(source.obs?.port) || 4455))),
      password: String(source.obs?.password || "")
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
    },
    deck: {
      activeProfile,
      profiles: normalizedProfiles
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
    return clone(this.state);
  }

  async get() {
    await this.load();
    return clone(this.state);
  }

  async set(value) {
    await this.load();
    this.state = normalizeState(value);
    this.queue = this.queue.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(this.filename), { recursive: true });
      const temporary = `${this.filename}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(temporary, JSON.stringify(this.state, null, 2), {
        encoding: "utf8",
        mode: 0o600
      });
      await fs.rename(temporary, this.filename);
    });
    await this.queue;
    return clone(this.state);
  }

  async patch(patch = {}) {
    const current = await this.get();
    return this.set({
      ...current,
      ...patch,
      obs: { ...current.obs, ...(patch.obs || {}) },
      preferences: { ...current.preferences, ...(patch.preferences || {}) },
      deck: { ...current.deck, ...(patch.deck || {}) }
    });
  }
}

module.exports = {
  DEFAULT_STATE,
  SettingsStore,
  normalizeState
};
