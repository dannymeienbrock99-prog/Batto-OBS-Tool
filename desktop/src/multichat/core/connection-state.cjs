"use strict";

const STATES = Object.freeze({
  DISCONNECTED: "disconnected",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  LIVE: "live",
  AUTH_REQUIRED: "auth_required",
  PERMISSION_REQUIRED: "permission_required",
  REFRESHING: "refreshing",
  ERROR: "error"
});

function connectionState(platform, state = STATES.DISCONNECTED, extra = {}) {
  if (!Object.values(STATES).includes(state)) throw new Error(`Ungültiger Verbindungsstatus: ${state}`);
  return {
    platform: String(platform || ""),
    state,
    updatedAt: Date.now(),
    error: extra.error ? String(extra.error) : "",
    permissions: Array.isArray(extra.permissions) ? extra.permissions : [],
    profile: extra.profile && typeof extra.profile === "object" ? extra.profile : null,
    diagnostics: extra.diagnostics && typeof extra.diagnostics === "object" ? extra.diagnostics : {}
  };
}

module.exports = { STATES, connectionState };