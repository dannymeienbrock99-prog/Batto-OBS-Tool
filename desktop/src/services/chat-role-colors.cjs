"use strict";

const DEFAULT_ROLE_COLORS = Object.freeze({
  broadcaster: "#ff4d6d",
  moderator: "#2ecc71",
  vip: "#e056fd",
  subscriber: "#ffd166",
  follower: "#45d6ff",
  viewer: ""
});

function roleColors(settings = {}) {
  return { ...DEFAULT_ROLE_COLORS, ...(settings.roleColors || settings || {}) };
}

function applyRoleColor(message, settings = {}) {
  const colors = roleColors(settings);
  const configured = String(colors[message.role] || "").trim();
  return { ...message, displayColor: configured || message.color || "#dbe7f3" };
}

module.exports = { DEFAULT_ROLE_COLORS, roleColors, applyRoleColor };
