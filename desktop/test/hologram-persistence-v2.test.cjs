"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { WebSocket } = require("ws");
const {
  TwitchHoloServer,
  normalizeHoloConfig,
  normalizeHoloMessage
} = require("../bootstrap-2.0/src/services/twitch-holo-server.cjs");

const temp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
const remove = (directory) => fs.rmSync(directory, { recursive: true, force: true });

async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

function receiveHistory(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const messages = [];
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error("Hologramm-Verlauf wurde nicht rechtzeitig empfangen."));
    }, 3000);
    socket.on("message", (raw) => {
      const value = JSON.parse(String(raw));
      messages.push(value);
      if (value.type === "history") {
        clearTimeout(timer);
        resolve({ socket, messages, history: value.messages });
      }
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

test("hologram server persists styles and exposes a local config API", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "bootstrap-2.0", "src", "services", "twitch-holo-server.cjs"), "utf8");
  assert.match(source, /writeJsonAtomic\(this\.configFile/);
  assert.match(source, /\/api\/config/);
  assert.match(source, /type: "config", config: this\.config/);
});

test("hologram editor saves the configured style to the local server", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "modules", "twitch-holo-chat", "web", "editor.js"), "utf8");
  assert.match(source, /fetch\("\/api\/config"/);
  assert.match(source, /method: "PUT"/);
  assert.match(source, /Hologramm-Stil ist mit der OBS-Browserquelle synchronisiert/);
});

test("hologram OBS URL connects to the local websocket", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "bootstrap-2.0", "src", "services", "twitch-holo-server.cjs"), "utf8");
  assert.match(source, /overlay\.html\?ws=/);
  assert.match(source, /ws:\/\/127\.0\.0\.1/);
});

test("Hologramm normalisiert persistierte Stile, Rollen und nicht vertrauenswürdige Nachrichten", () => {
  const config = normalizeHoloConfig(JSON.parse(JSON.stringify({
    maximumMessages: 9999,
    displayMs: -1,
    defaultStyle: { colors: ["javascript:alert(1)", "#ABCDEF"], glow: 999 },
    userStyles: {
      __proto__: { colors: ["#000000", "#ffffff"] },
      constructor: { colors: ["#000000", "#ffffff"] },
      "@Crazy_Batto": { colors: ["#001122", "#aabbcc"], speedSeconds: 0 }
    }
  })));
  assert.equal(config.maximumMessages, 200);
  assert.equal(config.displayMs, 1000);
  assert.equal(config.defaultStyle.glow, 50);
  assert.deepEqual(Object.keys(config.userStyles), ["crazy_batto"]);
  assert.deepEqual(config.userStyles.crazy_batto.colors, ["#001122", "#aabbcc"]);
  assert.equal(Object.getPrototypeOf(config.userStyles), null);

  const message = normalizeHoloMessage({
    id: "unsafe", displayName: "<img src=x onerror=alert(1)>", text: "<script>alert(1)</script>",
    color: "red", roles: { moderator: "false", vip: true }, raw: { token: "secret" }, timestamp: "2026-08-18T12:00:00Z"
  });
  assert.equal(message.text, "<script>alert(1)</script>");
  assert.equal(message.color, "#ffffff");
  assert.deepEqual(message.roles, { broadcaster: false, moderator: false, vip: true, subscriber: false });
  assert.equal(Object.hasOwn(message, "raw"), false);
  assert.equal(message.timestamp, Date.parse("2026-08-18T12:00:00Z"));
});

test("Overlay rendert externen Chat nur als Text und dedupliziert Reconnect-Verlauf", () => {
  const overlay = fs.readFileSync(path.join(__dirname, "..", "modules", "twitch-holo-chat", "web", "overlay.js"), "utf8");
  const editor = fs.readFileSync(path.join(__dirname, "..", "modules", "twitch-holo-chat", "web", "editor.js"), "utf8");
  assert.match(overlay, /element\.textContent = String\(value \?\? ""\)/);
  assert.doesNotMatch(overlay, /\.innerHTML\s*=|insertAdjacentHTML/);
  assert.match(overlay, /seenMessageIds\.has\(id\)/);
  assert.match(overlay, /addMessage\(message, \{ fromHistory: true \}\)/);
  assert.match(overlay, /\["127\.0\.0\.1", "localhost", "\[::1\]"\]/);
  assert.match(editor, /id: "editor-live-preview"/);
  assert.match(editor, /requestAnimationFrame/);
});

test("Twitch-Hologramm speichert Konfiguration und spielt den Verlauf an neue OBS-Quellen aus", async () => {
  const directory = temp("batto-holo-history");
  const configFile = path.join(directory, "hologram.json");
  const server = new TwitchHoloServer({
    webRoot: path.join(__dirname, "..", "modules", "twitch-holo-chat", "web"),
    configFile,
    preferredPort: await freePort()
  });
  let socket;
  try {
    await server.start();
    const config = {
      maximumMessages: 42,
      displayMs: 45000,
      showRole: true,
      defaultStyle: { colors: ["#20aaff", "#9867ff"], glow: 21 },
      userStyles: { Crazy_Batto: { colors: ["#001122", "#aabbcc"] } }
    };
    const expectedConfig = normalizeHoloConfig(config);
    const expectedSerializedConfig = JSON.parse(JSON.stringify(expectedConfig));
    const response = await fetch(`${server.status().baseUrl}/api/config`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(config)
    });
    assert.equal(response.ok, true);
    assert.deepEqual(await response.json(), expectedSerializedConfig);

    const leakedStatus = server.status();
    leakedStatus.config.maximumMessages = 1;
    assert.equal(server.status().config.maximumMessages, 42);

    for (let index = 0; index < 105; index += 1) {
      server.publishMessage({
        id: `message-${index}`,
        platform: "twitch",
        displayName: "Crazy_Batto",
        text: `Nachricht ${index}`,
        timestamp: 1_725_000_000_000 + index
      });
    }

    const replay = await receiveHistory(`ws://127.0.0.1:${server.port}/ws`);
    socket = replay.socket;
    assert.deepEqual(replay.messages[0], { type: "config", config: expectedSerializedConfig });
    assert.equal(replay.history.length, 100);
    assert.equal(replay.history[0].id, "message-5");
    assert.equal(replay.history.at(-1).id, "message-104");
    assert.equal(server.status().messageCount, 105);
    assert.equal(server.status().lastMessageAt, 1_725_000_000_104);

    const reconnect = await receiveHistory(`ws://127.0.0.1:${server.port}/ws`);
    assert.deepEqual(reconnect.history, replay.history);
    reconnect.socket.terminate();

    const rejected = await fetch(`${server.status().baseUrl}/api/clear`, { method: "POST", headers: { Origin: "https://evil.example" } });
    assert.equal(rejected.status, 403);
    assert.equal(server.status().messageCount, 105);

    assert.deepEqual(JSON.parse(fs.readFileSync(configFile, "utf8")), expectedSerializedConfig);
    const restarted = new TwitchHoloServer({ configFile });
    assert.deepEqual(restarted.status().config, expectedSerializedConfig);
  } finally {
    socket?.terminate();
    await server.stop();
    remove(directory);
  }
});
