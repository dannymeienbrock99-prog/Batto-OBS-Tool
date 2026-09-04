"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const PLATFORMS = ["twitch", "tiktok", "cng", "youtube"];
const ACTIONS = ["moderator-add", "moderator-remove", "mute", "unmute", "block", "unblock"];

function clean(value, max = 500) {
  return String(value ?? "").replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, max);
}
function emptyPlatform() { return { moderators: [], muted: [], blocked: [], history: [] }; }
function normalizeList(value) { return Array.isArray(value) ? [...new Set(value.map((item) => clean(item, 120)).filter(Boolean))] : []; }

class ModerationStore {
  constructor(filename) {
    this.filename = filename;
    this.state = Object.fromEntries(PLATFORMS.map((platform) => [platform, emptyPlatform()]));
  }

  async load() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.filename, "utf8"));
      for (const platform of PLATFORMS) {
        const source = parsed?.[platform] || {};
        this.state[platform] = {
          moderators: normalizeList(source.moderators),
          muted: normalizeList(source.muted),
          blocked: normalizeList(source.blocked),
          history: Array.isArray(source.history) ? source.history.slice(-500) : []
        };
      }
    } catch {}
    return this.snapshot();
  }

  async save() {
    await fs.mkdir(path.dirname(this.filename), { recursive: true });
    await fs.writeFile(this.filename, JSON.stringify(this.state, null, 2), { encoding: "utf8", mode: 0o600 });
  }

  snapshot(platform = null) {
    if (platform && PLATFORMS.includes(platform)) return JSON.parse(JSON.stringify(this.state[platform]));
    return JSON.parse(JSON.stringify(this.state));
  }

  async apply(input = {}) {
    const platform = PLATFORMS.includes(input.platform) ? input.platform : null;
    const action = ACTIONS.includes(input.action) ? input.action : null;
    const username = clean(input.username, 120);
    if (!platform) throw new Error("Ungültige Plattform.");
    if (!action) throw new Error("Ungültige Moderationsaktion.");
    if (!username) throw new Error("Benutzername fehlt.");

    const bucket = this.state[platform];
    const mutate = (key, add) => {
      const set = new Set(bucket[key]);
      if (add) set.add(username); else set.delete(username);
      bucket[key] = [...set];
    };
    if (action === "moderator-add") mutate("moderators", true);
    if (action === "moderator-remove") mutate("moderators", false);
    if (action === "mute") mutate("muted", true);
    if (action === "unmute") mutate("muted", false);
    if (action === "block") mutate("blocked", true);
    if (action === "unblock") mutate("blocked", false);

    const entry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      platform,
      action,
      username,
      userId: clean(input.userId, 160),
      reason: clean(input.reason, 500),
      lastMessage: clean(input.lastMessage, 1000),
      actor: clean(input.actor || "Crazy_Batto", 120),
      timestamp: Date.now(),
      transport: clean(input.transport || "local", 80),
      remoteApplied: input.remoteApplied === true,
      remoteMessage: clean(input.remoteMessage, 500)
    };
    bucket.history.push(entry);
    if (bucket.history.length > 500) bucket.history.splice(0, bucket.history.length - 500);
    await this.save();
    return { state: this.snapshot(platform), entry };
  }
}

module.exports = { ModerationStore, PLATFORMS, ACTIONS };
