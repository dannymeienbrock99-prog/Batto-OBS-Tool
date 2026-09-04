"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { ChatBotService, normalizeConfig, sendKeysExpression, allowed } = require("../src/services/chat-bot.cjs");

function temp(name) { return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`)); }

test("Chat Bot normalizes command permissions, platforms and multi actions", () => {
  const config = normalizeConfig({
    commands: [{
      command: "!heal",
      platforms: ["twitch", "tiktok"],
      permission: "moderator",
      cooldown: 30,
      actions: [
        { type: "hotkey", keys: ["F6"], target: { mode: "process", process: "SonsOfTheForest.exe" } },
        { type: "delay", milliseconds: 500 },
        { type: "chat", message: "{user} hat Heilung ausgelöst!" }
      ]
    }]
  });
  assert.equal(config.commands.length, 1);
  assert.equal(config.commands[0].command, "!heal");
  assert.equal(config.commands[0].permission, "moderator");
  assert.equal(config.commands[0].cooldownMs, 30000);
  assert.deepEqual(config.commands[0].platforms, ["twitch", "tiktok"]);
  assert.equal(config.commands[0].actions[0].target.process, "SonsOfTheForest.exe");
});

test("permission rules keep moderator and broadcaster commands restricted", () => {
  assert.equal(allowed("moderator", { role: "viewer" }), false);
  assert.equal(allowed("moderator", { role: "moderator" }), true);
  assert.equal(allowed("broadcaster", { badges: ["broadcaster"] }), true);
  assert.equal(allowed("broadcaster", { role: "moderator" }), false);
});

test("Windows hotkey expression supports modifiers and function keys", () => {
  assert.equal(sendKeysExpression(["CTRL", "SHIFT", "K"]), "^+K");
  assert.equal(sendKeysExpression(["ALT", "F6"]), "%{F6}");
});

test("command action chain can send chat and delay without source changes", async () => {
  const directory = temp("batto-chatbot-actions");
  const sent = [];
  const bot = new ChatBotService({
    configFile: path.join(directory, "chat-bot.json"),
    mediaRoot: path.join(directory, "media"),
    sendChat: async (platform, message) => sent.push({ platform, message }),
    isLive: async () => true
  });
  try {
    await bot.start();
    await bot.update({ commands: [{ id: "heal", command: "!heal", platforms: ["twitch"], cooldownMs: 0, actions: [{ type: "delay", milliseconds: 5 }, { type: "chat", message: "{user} hat Heilung ausgelöst!", platforms: ["twitch"] }] }] });
    const result = await bot.ingestChat({ platform: "twitch", username: "Batto", message: "!heal" });
    assert.equal(result.executed, true);
    assert.deepEqual(sent, [{ platform: "twitch", message: "Batto hat Heilung ausgelöst!" }]);
  } finally {
    await bot.stop();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("local OBS browser overlay server exposes required endpoints", async () => {
  const directory = temp("batto-chatbot-overlay");
  const bot = new ChatBotService({ configFile: path.join(directory, "chat-bot.json"), mediaRoot: path.join(directory, "media") });
  try {
    await bot.load();
    bot.config.overlay.port = 18987;
    await bot.startOverlay();
    const status = await (await fetch("http://127.0.0.1:18987/api/status")).json();
    assert.equal(status.running, true);
    for (const key of ["all", "follow", "gifts", "subs", "media", "chat"]) assert.match(status.urls[key], /^http:\/\/127\.0\.0\.1:18987\/overlay\//);
    const page = await (await fetch(status.urls.all)).text();
    assert.match(page, /background:transparent!important/);
    assert.match(page, /WebSocket/);
  } finally {
    await bot.stop();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("process-target hotkey safety stops before desktop when target is missing", async () => {
  const directory = temp("batto-chatbot-safety");
  const bot = new ChatBotService({ configFile: path.join(directory, "chat-bot.json"), mediaRoot: path.join(directory, "media") });
  try {
    bot.processRunning = async () => false;
    if (process.platform === "win32") {
      await assert.rejects(() => bot.hotkey({ keys: ["F6"], target: { mode: "process", process: "DefinitelyMissing.exe", requireRunning: true } }), /Zielprozess läuft nicht/);
    } else {
      await assert.rejects(() => bot.hotkey({ keys: ["F6"], target: { mode: "process", process: "DefinitelyMissing.exe", requireRunning: true } }), /nur unter Windows/);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
