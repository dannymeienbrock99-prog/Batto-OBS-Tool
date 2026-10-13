"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter, once } = require("node:events");
const WebSocket = require("ws");
const design = require("../src/shared/chat-design.js");
const { ChatDesignStore } = require("../src/services/chat-design-store.cjs");
const { TwitchHoloServer } = require("../src/services/twitch-holo-server.cjs");
const { deliverBroadcast } = require("../src/services/broadcast-delivery.cjs");
const { ChatBotService, normalizeConfig } = require("../src/services/chat-bot.cjs");
const { ChatCore } = require("../src/services/chat-core.cjs");
const { TwitchAdapter } = require("../src/services/platforms/twitch-adapter.cjs");
const { YouTubeAdapter } = require("../src/services/platforms/youtube-adapter.cjs");
const { TikTokAdapter } = require("../src/services/platforms/tiktok-adapter.cjs");
const { CngUnifiedAdapter } = require("../src/services/platforms/cng-adapter.cjs");
const reply = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function temporary(t) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), "batto-holo-")); t.after(() => fs.rm(dir, { recursive: true, force: true })); return dir; }
const item = (extra = {}) => normalizeConfig({ broadcasts: [{ id: "one", messages: ["Hallo!", "Zweite Nachricht"], platforms: ["twitch", "youtube"], ...extra }] }).broadcasts[0];

test("one design resolves platform, role and case-insensitive user priority with safe bounds", () => {
  const config = design.defaults();
  Object.assign(config.platforms.twitch, { nameColor: "#123456", roleColors: { moderator: "#abcdef" }, userColors: { Batto: "#fedcba" }, fontSize: 999, fontFamily: "x;url(evil)", backgroundColor: "javascript:x" });
  assert.equal(design.resolve(config, { platform: "twitch", username: "BATTO", role: "moderator" }).nameColor, "#fedcba");
  assert.equal(design.resolve(config, { platform: "twitch", role: "moderator" }).nameColor, "#abcdef");
  assert.equal(design.resolve(config, { platform: "twitch" }).nameColor, "#123456");
  assert.equal(design.normalize(config).platforms.twitch.fontSize, 48);
  assert.equal(design.normalize(config).platforms.twitch.fontFamily, "Segoe UI");
  assert.notEqual(design.resolve(config, { platform: "youtube" }).nameColor, "#123456");
  assert.deepEqual(design.normalize(null), design.defaults());
  config.enabled = false;
  assert.equal(design.resolve(config, { platform: "twitch", color: "#112233" }).nameColor, "#112233");
  assert.equal(design.resolve(config, { platform: "twitch" }).fontSize, 16);
});

test("design persists atomically, broadcasts changes and survives reopening", async (t) => {
  const dir = await temporary(t), filename = path.join(dir, "chat-design.json"), store = new ChatDesignStore(filename);
  await store.load(); const changes = []; store.on("changed", (value) => changes.push(value));
  const first = design.defaults(), second = design.defaults(); first.platforms.twitch.glow = 3; second.platforms.youtube.glow = 9;
  await Promise.all([store.save(first), store.save(second)]);
  const reopened = new ChatDesignStore(filename); await reopened.load();
  assert.equal(reopened.snapshot().platforms.youtube.glow, 9); assert.equal(changes.length, 2);
  const copy = store.snapshot(); copy.platforms.youtube.glow = 0; assert.equal(store.snapshot().platforms.youtube.glow, 9);
});

test("Holo and OBS share a live feed; reconnect has history; HTTP cannot change design or send chat", async (t) => {
  const dir = await temporary(t), store = new ChatDesignStore(path.join(dir, "design.json"));
  const server = new TwitchHoloServer({ preferredPort: 0, designStore: store }); await server.start(); t.after(() => server.stop());
  const base = `http://127.0.0.1:${server.port}`;
  assert.match(await (await fetch(base + "/chat-overlay")).text(), /chat-overlay.js/);
  assert.equal(await (await fetch(base + "/overlay")).text(), await (await fetch(base + "/chat-overlay")).text());
  assert.equal((await fetch(base + "/api/config", { method: "POST", body: "{}" })).status, 405);
  assert.equal((await fetch(base + "/editor.html")).status, 404);
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}/chat-ws`); t.after(() => socket.terminate());
  const [initial] = await once(socket, "message"); assert.equal(JSON.parse(initial).type, "snapshot");
  const chat = once(socket, "message"); server.publishEvent({ id: "m1", type: "chat", platform: "youtube", name: "Batto", text: "<b>Text</b>", data: { role: "moderator" } });
  assert.equal(JSON.parse((await chat)[0]).message.message, "<b>Text</b>");
  const changed = once(socket, "message"); const config = design.defaults(); config.platforms.youtube.glow = 7; await store.save(config);
  assert.equal(JSON.parse((await changed)[0]).config.platforms.youtube.glow, 7);
  const reconnect = new WebSocket(`ws://127.0.0.1:${server.port}/chat-ws`); t.after(() => reconnect.terminate());
  assert.equal(JSON.parse((await once(reconnect, "message"))[0]).messages[0].id, "m1");
  server.clearChat("youtube"); assert.equal(server.history.length, 0);
});

test("broadcast fan-out isolates rejection and timeout and skips unsupported targets", async () => {
  let aborted = false;
  const results = await deliverBroadcast({ platforms: ["twitch", "youtube", "tiktok", "cng"], message: "x", timeoutMs: 20,
    statuses: { cng: { canSend: false, sendReason: "Keine Schnittstelle" } },
    send: async (p, _message, { signal }) => { if (p === "twitch") throw new Error("abgelehnt"); if (p === "youtube") return { sent: true, confirmed: true, messageId: "yt1" }; signal.addEventListener("abort", () => { aborted = true; }); return new Promise(() => {}); }
  });
  assert.deepEqual(results.map((r) => r.status), ["failed", "sent", "failed", "skipped"]);
  assert.equal(results[1].messageId, "yt1"); assert.equal(aborted, true); assert.match(results[2].reason, /unbekannt/);
});

test("handoff without provider confirmation is not labelled sent; pre-abort never sends", async () => {
  const submitted = await deliverBroadcast({ platforms: ["twitch"], message: "x", send: async () => ({ submitted: true }) });
  assert.equal(submitted[0].status, "submitted");
  const controller = new AbortController(); controller.abort();
  const aborted = await deliverBroadcast({ platforms: ["twitch"], message: "x", signal: controller.signal, send: () => assert.fail("must not send") });
  assert.equal(aborted[0].status, "skipped");
});

test("broadcast uses recent chat activity per target, applies LIVE gate and preserves rotation when all skipped", async (t) => {
  const sent = []; const bot = new ChatBotService({ sendChat: async (p, m) => { sent.push([p, m]); return { sent: true, confirmed: true }; }, isLive: () => false }); t.after(() => bot.stop());
  const plan = item({ onlyWhenActive: true, activityWindowMs: 10000 });
  bot.chatActivityTimes.twitch = [Date.now() - 20000]; bot.chatActivityTimes.youtube = [];
  assert.ok((await bot.runBroadcast(plan)).results.every((r) => r.status === "skipped"));
  assert.equal(bot.broadcastIndexes.get(plan.id), undefined);
  await bot.ingestChat({ platform: "youtube", message: "hello" });
  const result = await bot.runBroadcast(plan); assert.deepEqual(result.results.map((r) => r.status), ["skipped", "sent"]);
  assert.deepEqual(sent, [["youtube", "Hallo!"]]);
  assert.ok((await bot.runBroadcast({ ...plan, onlyWhenLive: true })).results.every((r) => r.status === "skipped"));
});

test("empty target selection is preserved and a parallel send of the same broadcast is blocked", async (t) => {
  assert.deepEqual(item({ platforms: [] }).platforms, []);
  let release; const bot = new ChatBotService({ sendChat: () => new Promise((resolve) => { release = resolve; }) }); t.after(() => bot.stop());
  const pending = bot.runBroadcast(item({ platforms: ["twitch"] }));
  await assert.rejects(bot.runBroadcast(item()), /gerade/);
  release({ sent: true, confirmed: true }); await pending;
});

test("pausing during a scheduled send aborts it and prevents an obsolete timer restarting", async (t) => {
  let started; const start = new Promise((resolve) => { started = resolve; });
  const bot = new ChatBotService({ sendChat: (_p, _m, { signal }) => { started(); return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))); } }); t.after(() => bot.stop());
  bot.config = normalizeConfig({ broadcasts: [item({ platforms: ["twitch"], startDelayMs: 0 })] });
  bot.restartBroadcasts();
  // Electron keeps the app alive; an isolated Node test needs its own live handle.
  bot.broadcastTimers.get("one").ref();
  await start;
  bot.config.broadcastSettings.enabled = false; bot.restartBroadcasts(); await sleep(20);
  assert.equal(bot.broadcastTimers.size, 0); assert.equal(bot.broadcastControllers.size, 0);
  assert.equal(bot.broadcastResults[0].results[0].status, "skipped");
});

test("saving unrelated bot settings does not reset a broadcast countdown", async (t) => {
  const dir = await temporary(t); const bot = new ChatBotService({ configFile: path.join(dir, "bot.json") }); t.after(() => bot.stop());
  await bot.update({ broadcasts: [item({ startDelayMs: 86400000 })] }); const timer = bot.broadcastTimers.get("one");
  await bot.update({ discord: { enabled: false, title: "test" } });
  assert.equal(bot.broadcastTimers.get("one"), timer);
});

class FakeTwitchSocket extends EventEmitter {
  constructor() { super(); queueMicrotask(() => this.emit("open")); }
  send(line) { if (line.startsWith("JOIN")) queueMicrotask(() => this.emit("message", ":tmi.twitch.tv ROOMSTATE #batto")); }
  close() { this.emit("close"); }
}
async function twitchFixture(t, delivery = { is_sent: true, message_id: "tw1" }) {
  const requests = []; const adapter = new TwitchAdapter({ Socket: FakeTwitchSocket, fetcher: async (url, options) => {
    requests.push({ url, options });
    if (url.includes("oauth2/validate")) return reply({ login: "sender", user_id: "11", client_id: "client", scopes: ["chat:read", "user:write:chat", "user:manage:chat_color"] });
    if (url.includes("users?")) return reply({ data: [{ id: "22" }] });
    if (url.includes("chat/color")) return reply({}, 204);
    return reply({ data: [delivery] });
  } }); t.after(() => adapter.disconnect()); await adapter.connect({ channel: "batto", token: "oauth:test-only" }); return { adapter, requests };
}

test("Twitch validates sender identity, checks is_sent and changes only own native name color", async (t) => {
  const { adapter, requests } = await twitchFixture(t);
  assert.equal(adapter.status().username, "sender"); assert.equal(adapter.status().canSend, true);
  assert.equal((await adapter.sendMessage("hello")).messageId, "tw1");
  const payload = JSON.parse(requests.find((r) => r.options.method === "POST").options.body);
  assert.deepEqual(payload, { broadcaster_id: "22", sender_id: "11", message: "hello" });
  await adapter.setChatColor("blue"); assert.match(requests.at(-1).url, /user_id=11&color=blue/);
  await assert.rejects(adapter.sendMessage("x".repeat(501)), /500/);
  assert.equal(JSON.stringify(adapter.status()).includes("test-only"), false);
});

test("Twitch HTTP success with is_sent false is rejected", async (t) => {
  const { adapter } = await twitchFixture(t, { is_sent: false, drop_reason: { code: "automod_held" } });
  await assert.rejects(adapter.sendMessage("hello"), /automod_held/);
});

test("YouTube discovers liveChatId, reads authors and confirms inserted message IDs", async (t) => {
  const requests = [], messages = [];
  const adapter = new YouTubeAdapter({ fetcher: async (url, options) => {
    requests.push({ url, options });
    if (url.includes("videos?")) return reply({ items: [{ liveStreamingDetails: { activeLiveChatId: "chat1" } }] });
    if (options.method === "POST") return reply({ id: "yt1" });
    return reply({ nextPageToken: "page2", pollingIntervalMillis: 20000, items: [{ id: "m1", authorDetails: { displayName: "Batto", channelId: "author", isChatModerator: true }, snippet: { type: "textMessageEvent", displayMessage: "hello" } }] });
  } }); t.after(() => adapter.disconnect()); adapter.onMessage((m) => messages.push(m));
  await adapter.connect({ videoId: "https://www.youtube.com/watch?v=video1", token: "test-only" });
  assert.equal(adapter.status().canSend, true); assert.equal(messages[0].role, "moderator");
  assert.equal(messages[0].metadata.historical, true);
  assert.equal(adapter.pageToken, "page2"); assert.equal((await adapter.sendMessage("hello")).messageId, "yt1");
  assert.equal(JSON.parse(requests.at(-1).options.body).snippet.liveChatId, "chat1");
  await assert.rejects(adapter.sendMessage("x".repeat(201)), /200/);
  await adapter.disconnect(); assert.equal(adapter.timer, null); assert.equal(adapter.config.token, "");
});

test("YouTube expired token and offline video never become connected or silently succeed", async (t) => {
  const offline = new YouTubeAdapter({ fetcher: async () => reply({ items: [] }) }); t.after(() => offline.disconnect());
  await assert.rejects(offline.connect({ videoId: "video", token: "test" }), /aktiven Livechat/);
  const expired = new YouTubeAdapter({ fetcher: async () => reply({ error: { message: "secret must not leak" } }, 401) }); t.after(() => expired.disconnect());
  await assert.rejects(expired.connect({ liveChatId: "chat", token: "test" }), (error) => /401/.test(error.message) && !error.message.includes("secret"));
  assert.equal(expired.status().canSend, false);
});

test("chat core respects adapter capability flags and forwards abort signals", async (t) => {
  const core = new ChatCore(); t.after(() => core.stop());
  core.registerAdapter(new TikTokAdapter()); core.registerAdapter(new CngUnifiedAdapter()); core.registerAdapter(new YouTubeAdapter());
  assert.equal(core.statuses().youtube.canSend, false); assert.equal(core.statuses().tiktok.canSend, false); assert.equal(core.statuses().cng.canSend, false);
  let passed; core.registerAdapter({ platform: "twitch", status: () => ({ canSend: true }), sendMessage: async (_message, options) => { passed = options.signal; return { sent: true }; } });
  const controller = new AbortController(); await core.send("twitch", "hello", { signal: controller.signal }); assert.equal(passed, controller.signal);
});

test("historical chat cannot execute commands or satisfy activity gating", async (t) => {
  const bot = new ChatBotService({ sendChat: () => assert.fail("historical command must not run") }); t.after(() => bot.stop());
  bot.config = normalizeConfig({ commands: [{ command: "!go", platforms: ["youtube"], actions: [{ type: "chat", message: "executed" }] }] });
  const result = await bot.ingestChat({ platform: "youtube", message: "!go", metadata: { historical: true } });
  assert.equal(result.reason, "history"); assert.equal(bot.chatActivityTimes.youtube.length, 0);
});

test("local OBS display is reported separately and respects live activity conditions", async (t) => {
  const displayed = [];
  const bot = new ChatBotService({ getStatuses: () => ({ tiktok: { canSend: false } }), publishBroadcast: (message, platforms) => displayed.push({ message, platforms }) }); t.after(() => bot.stop());
  const plan = item({ platforms: ["tiktok"], showOverlay: true, onlyWhenActive: true });
  assert.equal((await bot.runBroadcast(plan)).overlay, false);
  await bot.ingestChat({ platform: "tiktok", message: "hello" });
  const report = await bot.runBroadcast(plan);
  assert.equal(report.overlay, true); assert.equal(report.results[0].status, "skipped"); assert.equal(displayed.length, 1);
});
