"use strict";

const { TikTokHybridAdapter, normalizeTikFinityPayload } = require("./tiktok-hybrid-adapter.cjs");
const { isOfflineError } = require("./tiktok-direct-adapter.cjs");

module.exports = {
  TikTokAdapter: TikTokHybridAdapter,
  TikTokHybridAdapter,
  normalizeTikFinityPayload,
  isOfflineError
};
