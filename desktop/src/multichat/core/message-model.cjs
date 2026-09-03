"use strict";

const PLATFORMS = new Set(["twitch", "cng", "tiktok", "youtube"]);

function normalizeMessage(input = {}) {
  const platform = String(input.platform || "").toLowerCase();
  if (!PLATFORMS.has(platform)) throw new Error(`Unbekannte Plattform: ${platform || "leer"}`);

  const user = input.user && typeof input.user === "object" ? input.user : {};
  return {
    platform,
    eventType: String(input.eventType || "chat"),
    user: {
      id: String(user.id || input.userId || ""),
      username: String(user.username || input.username || ""),
      displayName: String(user.displayName || input.displayName || input.username || ""),
      avatar: String(user.avatar || input.avatar || ""),
      roles: Array.isArray(user.roles) ? user.roles : [],
      badges: Array.isArray(user.badges) ? user.badges : []
    },
    text: String(input.text ?? input.message ?? ""),
    timestamp: Number(input.timestamp || Date.now()),
    gift: input.gift && typeof input.gift === "object" ? input.gift : null,
    metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {}
  };
}

module.exports = { normalizeMessage, PLATFORMS };