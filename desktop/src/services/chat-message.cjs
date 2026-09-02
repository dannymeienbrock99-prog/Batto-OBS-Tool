"use strict";

const ROLE_ORDER = ["broadcaster", "moderator", "vip", "subscriber", "follower", "viewer"];

function normalizeRole(value, badges = []) {
  const requested = String(value || "").toLowerCase();
  if (ROLE_ORDER.includes(requested)) return requested;
  const names = new Set((badges || []).map((badge) => String(badge).split("/")[0].toLowerCase()));
  if (names.has("broadcaster")) return "broadcaster";
  if (names.has("moderator")) return "moderator";
  if (names.has("vip")) return "vip";
  if (names.has("subscriber") || names.has("founder")) return "subscriber";
  return "viewer";
}

function normalizeChatMessage(input = {}) {
  const badges = Array.isArray(input.badges) ? input.badges.filter(Boolean) : [];
  const platform = String(input.platform || "local").trim().toLowerCase();
  const username = String(input.username || input.displayName || "Unbekannt").trim();
  return {
    id: String(input.id || `${platform}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`),
    platform,
    channel: String(input.channel || input.metadata?.channel || "").trim(),
    userId: String(input.userId || ""),
    username,
    displayName: String(input.displayName || username),
    message: String(input.message || ""),
    color: String(input.color || ""),
    badges,
    role: normalizeRole(input.role, badges),
    timestamp: Number(input.timestamp || Date.now()),
    metadata: input.metadata && typeof input.metadata === "object" ? { ...input.metadata } : {}
  };
}

module.exports = { ROLE_ORDER, normalizeRole, normalizeChatMessage };
