"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BattoChatDesign = api;
})(typeof window === "object" ? window : this, function () {
  const PLATFORMS = ["twitch", "tiktok", "youtube", "cng"];
  const ROLES = ["broadcaster", "moderator", "vip", "subscriber", "follower", "viewer"];
  const COLORS = { twitch: "#b794ff", tiktok: "#25f4ee", youtube: "#ff6978", cng: "#59b8ff" };
  const number = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;
  const color = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value || "")) ? String(value).toLowerCase() : fallback;
  const font = (value) => /^[\p{L}\p{N} _,.-]{1,80}$/u.test(String(value || "")) ? String(value) : "Segoe UI";
  function defaults() {
    return { version: 1, enabled: true, platforms: Object.fromEntries(PLATFORMS.map((platform) => [platform, {
      nameColor: COLORS[platform], secondColor: "#ffffff", messageColor: "#e7eef8", backgroundColor: "#0e1726",
      backgroundOpacity: 0.8, fontFamily: "Segoe UI", fontSize: 16, nameSize: 16, glow: 0,
      gradient: false, animation: "none", roleColors: {}, userColors: {}
    }])) };
  }
  function normalize(input = {}) {
    input = input && typeof input === "object" ? input : {};
    const base = defaults();
    return { version: 1, enabled: input.enabled !== false, platforms: Object.fromEntries(PLATFORMS.map((platform) => {
      const fallback = base.platforms[platform];
      const source = input.platforms?.[platform] || {};
      const result = { ...fallback };
      for (const key of ["nameColor", "secondColor", "messageColor", "backgroundColor"]) result[key] = color(source[key], fallback[key]);
      result.fontFamily = font(source.fontFamily || fallback.fontFamily);
      result.fontSize = number(source.fontSize ?? fallback.fontSize, 10, 48, fallback.fontSize);
      result.nameSize = number(source.nameSize ?? fallback.nameSize, 10, 48, fallback.nameSize);
      result.glow = number(source.glow ?? 0, 0, 24, 0);
      result.backgroundOpacity = number(source.backgroundOpacity ?? 0.8, 0, 1, 0.8);
      result.gradient = source.gradient === true;
      result.animation = ["none", "flow", "pulse"].includes(source.animation) ? source.animation : "none";
      result.roleColors = Object.fromEntries(ROLES.filter((role) => color(source.roleColors?.[role], "")).map((role) => [role, color(source.roleColors[role], COLORS[platform])]));
      result.userColors = Object.fromEntries(Object.entries(source.userColors || {}).slice(0, 200).filter(([name, value]) => name.trim() && color(value, "")).map(([name, value]) => [name.trim().toLowerCase().slice(0, 120), color(value, COLORS[platform])]));
      return [platform, result];
    })) };
  }
  function resolve(config, message = {}) {
    const platform = PLATFORMS.includes(message.platform) ? message.platform : "cng";
    const normalized = normalize(config);
    if (!normalized.enabled) return { ...defaults().platforms[platform], nameColor: color(message.color, COLORS[platform]) };
    const style = { ...normalized.platforms[platform] };
    const badges = (Array.isArray(message.badges) ? message.badges : []).map(String);
    const role = ROLES.find((item) => item === message.role || badges.includes(item)) || "viewer";
    const username = String(message.username || message.name || "").trim().toLowerCase();
    style.nameColor = style.userColors[username] || style.roleColors[role] || style.nameColor;
    return style;
  }
  function apply(row, message, config) {
    if (!row) return;
    const style = resolve(config, message);
    const name = row.querySelector(".chat-user");
    const body = row.querySelector(".chat-message");
    row.style.fontFamily = style.fontFamily;
    const rgb = style.backgroundColor.slice(1).match(/../g).map((part) => parseInt(part, 16));
    row.style.backgroundColor = "rgba(" + rgb.join(",") + "," + style.backgroundOpacity + ")";
    row.classList.add("chat-designed");
    if (name) {
      name.style.color = style.nameColor; name.style.fontSize = style.nameSize + "px"; name.style.fontFamily = style.fontFamily;
      name.style.textShadow = style.glow ? "0 0 " + style.glow + "px " + style.nameColor : "none";
      name.style.backgroundImage = style.gradient ? "linear-gradient(100deg," + style.nameColor + "," + style.secondColor + "," + style.nameColor + ")" : "none";
      name.classList.toggle("chat-name-gradient", style.gradient);
      name.dataset.animation = style.animation;
    }
    if (body) { body.style.color = style.messageColor; body.style.fontSize = style.fontSize + "px"; body.style.fontFamily = style.fontFamily; }
  }
  return { PLATFORMS, ROLES, defaults, normalize, resolve, apply, color };
});
