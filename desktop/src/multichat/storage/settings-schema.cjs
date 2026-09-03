"use strict";

const DEFAULT_SETTINGS = Object.freeze({
  general: {
    language: "de",
    startWithWindows: false,
    notifications: true
  },
  chat: {
    showAvatars: true,
    showBadges: true,
    showTimestamps: true,
    compactMode: false
  },
  moderation: {
    commentsEnabled: true,
    blockedWords: []
  },
  tts: {
    enabled: false,
    volume: 1,
    rate: 1,
    platforms: ["twitch", "cng", "tiktok", "youtube"]
  },
  obs: {
    overlayEnabled: true,
    hologramEnabled: true
  }
});

function cloneDefaults() {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

module.exports = { DEFAULT_SETTINGS, cloneDefaults };