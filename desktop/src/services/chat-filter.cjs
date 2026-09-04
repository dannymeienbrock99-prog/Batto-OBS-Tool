"use strict";

function normalizeText(value, specialCharEvasion = false) {
  let text = String(value || "");
  if (specialCharEvasion) text = text.normalize("NFKD").replace(/[\p{P}\p{S}_]+/gu, "").replace(/\s+/g, " ");
  return text;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

class ChatFilterService {
  constructor({ getConfig, moderationStore, logStore } = {}) {
    this.getConfig = getConfig;
    this.moderationStore = moderationStore;
    this.logStore = logStore;
  }

  async config() {
    const module = await this.getConfig?.("chatFilter");
    return module || { enabled: false, config: {} };
  }

  match(message, module) {
    const config = module?.config || {};
    if (!module?.enabled) return { matched: false, words: [] };
    const platform = String(message?.platform || "").toLowerCase();
    const scope = String(config.scope || "all").toLowerCase();
    if (scope !== "all" && scope !== platform) return { matched: false, words: [] };
    const username = String(message?.username || message?.user || "");
    const allowedUsers = (config.allowedUsers || []).map((item) => String(item).toLowerCase());
    if (allowedUsers.includes(username.toLowerCase())) return { matched: false, words: [] };

    const original = String(message?.message || "");
    const text = normalizeText(original, config.specialCharEvasion === true);
    const compare = config.ignoreCase === false ? text : text.toLowerCase();
    const allowedWords = (config.allowedWords || []).map((item) => String(item));
    const blockedWords = (config.blockedWords || []).map((item) => String(item)).filter(Boolean);
    const hits = [];

    for (const blocked of blockedWords) {
      if (allowedWords.some((allowed) => allowed && original.includes(allowed))) continue;
      const candidate = config.ignoreCase === false ? blocked : blocked.toLowerCase();
      let matched = false;
      if (config.wholeWords === true) {
        const flags = config.ignoreCase === false ? "u" : "iu";
        matched = new RegExp(`(?:^|\\b)${escapeRegExp(blocked)}(?:\\b|$)`, flags).test(text);
      } else if (config.partialWords === true || config.wholeWords !== true) {
        matched = compare.includes(normalizeText(candidate, config.specialCharEvasion === true));
      }
      if (matched) hits.push(blocked);
    }
    return { matched: hits.length > 0, words: hits };
  }

  async evaluate(message, { apply = false } = {}) {
    const module = await this.config();
    const result = this.match(message, module);
    if (!result.matched) return { ...result, action: "allow", visible: true, message };
    const config = module.config || {};
    const action = String(config.defaultAction || "hide").toLowerCase();
    let visible = action !== "hide";
    const annotated = { ...message, filterMatched: true, filterWords: result.words, filterAction: action };

    if (apply && (action === "mute" || action === "block") && this.moderationStore) {
      await this.moderationStore.apply({
        platform: message.platform,
        action,
        username: message.username || message.user || "Unbekannt",
        userId: message.userId || "",
        reason: `Chat-Filter: ${result.words.join(", ")}`,
        lastMessage: message.message || "",
        actor: "Batto Chat-Filter",
        transport: "local-filter",
        remoteApplied: false,
        remoteMessage: "Plattformaktion nicht ausgeführt; lokale Filteraktion."
      });
      visible = false;
    }

    if (apply && config.logMatches !== false && this.logStore) {
      await this.logStore.append("chat-filter", "info", `Filtertreffer: ${result.words.join(", ")}`, {
        platform: message.platform,
        username: message.username || message.user || "",
        action,
        message: message.message || ""
      });
    }
    return { ...result, action, visible, message: annotated };
  }

  async filterBatch(batch = [], options = {}) {
    const visible = [];
    const results = [];
    for (const message of batch) {
      const result = await this.evaluate(message, options);
      results.push(result);
      if (result.visible) visible.push(result.message);
    }
    return { visible, results };
  }
}

module.exports = { ChatFilterService, normalizeText, escapeRegExp };
