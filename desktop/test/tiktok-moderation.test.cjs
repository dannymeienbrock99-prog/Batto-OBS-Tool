"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EulerStreamModeration } = require("../src/services/eulerstream-moderation.cjs");

class MemorySecrets {
  constructor() { this.data = new Map(); }
  async get(key) { return this.data.get(key) || ""; }
  async set(key, value) { this.data.set(key, String(value)); return true; }
  async delete(key) { this.data.delete(key); }
  async has(key) { return Boolean(await this.get(key)); }
}

function response(body = { code: 0, message: "ok", response: {} }, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(body); }
  };
}

test("TikTok moderation stores OAuth secret and uses official mute route", async () => {
  const secrets = new MemorySecrets();
  const calls = [];
  const client = new EulerStreamModeration({
    secretStore: secrets,
    fetchImpl: async (url, options) => { calls.push({ url: String(url), options }); return response(); }
  });

  assert.equal((await client.status()).configured, false);
  await client.saveToken("oauth-token-abcdefghijklmnopqrstuvwxyz");
  assert.equal((await client.status()).configured, true);

  await client.mute({ roomId: "123", userId: "456", duration: "300", commentMsgId: "789" });
  assert.equal(calls.length, 1);
  const mute = new URL(calls[0].url);
  assert.equal(mute.origin, "https://tiktok.eulerstream.com");
  assert.equal(mute.pathname, "/webcast/rooms/123/moderation/mutes");
  assert.equal(mute.searchParams.get("user_id"), "456");
  assert.equal(mute.searchParams.get("duration"), "300");
  assert.equal(mute.searchParams.get("comment_msg_id"), "789");
  assert.equal(calls[0].options.method, "PUT");
  assert.equal(calls[0].options.headers["x-oauth-token"], "oauth-token-abcdefghijklmnopqrstuvwxyz");
  assert.equal("x-cookie-header" in calls[0].options.headers, false);
});

test("TikTok moderation covers bans, moderators, comments and sensitive words", async () => {
  const secrets = new MemorySecrets();
  await secrets.set("tiktok-euler-oauth-access-token", "oauth-token-abcdefghijklmnopqrstuvwxyz");
  const calls = [];
  const client = new EulerStreamModeration({
    secretStore: secrets,
    fetchImpl: async (url, options) => { calls.push({ url: new URL(String(url)), options }); return response(); }
  });

  await client.ban({ roomId: "r1", userId: "u1", commentMsgId: "c1" });
  await client.unban({ roomId: "r1", userId: "u1" });
  await client.addModerator({ anchorId: "a1", userId: "u1" });
  await client.removeModerator({ anchorId: "a1", userId: "u1" });
  await client.toggleComments({ roomId: "r1", enabled: false });
  await client.addSensitiveWord({ roomId: "r1", secAnchorId: "sec1", word: "spam" });
  await client.deleteSensitiveWord({ roomId: "r1", secAnchorId: "sec1", wordId: "w1" });

  assert.equal(calls[0].url.pathname, "/webcast/rooms/r1/moderation/bans");
  assert.equal(calls[0].url.searchParams.get("tiktok_user_id"), "u1");
  assert.equal(calls[1].options.method, "DELETE");
  assert.equal(calls[2].url.pathname, "/webcast/anchors/a1/moderation/moderators");
  assert.equal(calls[2].url.searchParams.get("to_user_id"), "u1");
  assert.equal(calls[4].url.pathname, "/webcast/rooms/r1/moderation/toggle_comments");
  assert.equal(calls[4].url.searchParams.get("enabled"), "false");
  assert.equal(calls[5].url.pathname, "/webcast/rooms/r1/moderation/sensitive-words");
  assert.equal(calls[5].url.searchParams.get("word"), "spam");
  assert.equal(calls[5].url.searchParams.get("sec_anchor_id"), "sec1");
  assert.equal(calls[6].url.searchParams.get("word_id"), "w1");
});

test("TikTok moderation rejects invalid duration and never leaks OAuth secret in errors", async () => {
  const secrets = new MemorySecrets();
  const token = "oauth-token-super-secret-abcdefghijklmnopqrstuvwxyz";
  await secrets.set("tiktok-euler-oauth-access-token", token);
  const client = new EulerStreamModeration({
    secretStore: secrets,
    fetchImpl: async () => response({ code: 403, message: "missing scope" }, 403)
  });

  await assert.rejects(() => client.mute({ roomId: "1", userId: "2", duration: "999" }), /Ungültige Stummschalt-Dauer/);
  await assert.rejects(async () => {
    try { await client.ban({ roomId: "1", userId: "2" }); }
    catch (error) {
      assert.equal(String(error.message).includes(token), false);
      throw error;
    }
  }, /missing scope/);
});
