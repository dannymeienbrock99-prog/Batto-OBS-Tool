"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { authentication, normalizeLocalObsHost, websocketUrl } = require("../src/services/obs-websocket.cjs");
const { DeckStore } = require("../src/services/deck-store.cjs");
const { PluginRegistry } = require("../src/services/plugin-registry.cjs");
const { StreamOverlayServer } = require("../src/services/stream-overlay-server.cjs");
const { MobileBridge } = require("../src/services/mobile-bridge.cjs");
const { MultiChat } = require("../src/services/multi-chat.cjs");
const { LegacyMigration, copyDirectoryMissing } = require("../src/services/migration.cjs");
const { buildRecommendation } = require("../src/services/recommendation.cjs");
const { selectPreferredGpu } = require("../src/services/hardware.cjs");
const { ActionExecutor } = require("../src/services/action-executor.cjs");

function temporaryDirectory(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
}

function remove(directory) {
  fs.rmSync(directory, { recursive: true, force: true });
}

test("OBS stays local and formats IPv6 loopback correctly", () => {
  assert.equal(normalizeLocalObsHost("2003:f8:3733:8662:183e:947b:4c84:e8f7"), "127.0.0.1");
  assert.equal(normalizeLocalObsHost("192.168.2.121"), "127.0.0.1");
  assert.equal(normalizeLocalObsHost("localhost"), "127.0.0.1");
  assert.equal(normalizeLocalObsHost("[::1]"), "::1");
  assert.equal(websocketUrl("::1", 4455), "ws://[::1]:4455");
  assert.equal(websocketUrl("127.0.0.1", 4455), "ws://127.0.0.1:4455");
  assert.equal(authentication("pass", "salt", "challenge"), "4Qn9qMydK3cf6n0kAHVmXnCu6K1R/5G3k69R7dPveo0=");
});

test("dedicated RTX is selected before the processor graphics", () => {
  const gpu = selectPreferredGpu([
    { name: "AMD Radeon(TM) Graphics", adapterRamBytes: 512 * 1024 * 1024 },
    { name: "NVIDIA GeForce RTX 5080", adapterRamBytes: 16 * 1024 ** 3 }
  ]);
  assert.equal(gpu.name, "NVIDIA GeForce RTX 5080");
  const recommendation = buildRecommendation({
    platform: "twitch",
    resolution: "1920x1080",
    fps: 60,
    uploadMbps: 30,
    gpu
  });
  assert.equal(recommendation.hardware.gpu, "NVIDIA GeForce RTX 5080");
  assert.equal(recommendation.settings.encoder, "NVIDIA NVENC H.264");
  assert.equal(recommendation.settings.codec, "H.264");
});

test("Touch-Deck keeps occupied buttons when the visible grid becomes smaller", () => {
  const directory = temporaryDirectory("batto-deck");
  try {
    const store = new DeckStore(path.join(directory, "deck.json"));
    const state = store.snapshot();
    const profile = state.profiles[0];
    const folder = profile.folders[0];
    store.updateButton(profile.id, folder.id, 14, {
      title: "OBS und Overlay",
      actions: [
        { type: "obs.scene", settings: { sceneName: "Gaming" }, delayMs: 0 },
        { type: "overlay.wheel", settings: {}, delayMs: 750 }
      ]
    });
    store.updateFolder(profile.id, folder.id, { rows: 2, columns: 3 });
    const smaller = store.snapshot().profiles[0].folders[0];
    assert.equal(smaller.rows * smaller.columns, 6);
    assert.equal(smaller.buttons[14].title, "OBS und Overlay");
    assert.equal(smaller.buttons[14].actions.length, 2);
    assert.equal(smaller.buttons[14].actions[1].delayMs, 750);
    store.updateFolder(profile.id, folder.id, { rows: 3, columns: 5 });
    assert.equal(store.snapshot().profiles[0].folders[0].buttons[14].title, "OBS und Overlay");
  } finally {
    remove(directory);
  }
});

test("Plugin registry exposes native legacy replacements and clear action IDs", () => {
  const directory = temporaryDirectory("batto-plugins");
  try {
    const registry = new PluginRegistry({ stateFile: path.join(directory, "state.json"), pluginRoots: [], iconPackRoots: [] });
    const snapshot = registry.scan();
    const names = new Set(snapshot.plugins.map((plugin) => plugin.name));
    for (const name of [
      "OBS Studio", "YouTube Music Desktop Connector", "YouTube Ticker", "iCUE", "BambuLab Printer Monitor",
      "Spotify", "Volume Controller", "Discord Volume Mixer", "TikFinity", "TikTok LIVE Studio",
      "OBSBOT WebCam", "Twitch Giveaway", "Polls, Word Clouds & Spinner Wheels"
    ]) assert.ok(names.has(name), `Plugin fehlt: ${name}`);
    const actionIds = new Set(snapshot.plugins.flatMap((plugin) => plugin.actions.map((action) => action.id)));
    for (const id of ["obs.scene", "media.playpause", "youtube.music.open", "youtube.ticker.status", "icue.launch", "bambulab.launch", "obsbot.center", "overlay.wheel"]) assert.ok(actionIds.has(id), `Aktion fehlt: ${id}`);
  } finally {
    remove(directory);
  }
});

test("unknown plugin action fails instead of reporting success", async () => {
  const executor = new ActionExecutor({ shell: { openPath: async () => "", openExternal: async () => {} } });
  await assert.rejects(() => executor.execute({ type: "unknown.vendor.action", settings: {} }), /ohne passende Laufzeit nicht ausgeführt/);
});

test("Stream overlay stays local, transparent and persists its layout", async () => {
  const directory = temporaryDirectory("batto-overlay");
  const server = new StreamOverlayServer({
    webRoot: path.join(__dirname, "..", "src", "stream-overlay"),
    configFile: path.join(directory, "overlay.json"),
    logoPath: path.join(__dirname, "..", "resources", "team-logo.svg"),
    preferredPort: 49221
  });
  try {
    await server.start();
    const status = server.status();
    assert.equal(status.active, true);
    assert.match(status.overlayUrl, /^http:\/\/127\.0\.0\.1:/);
    const configResponse = await fetch(`${status.baseUrl}/api/config`);
    assert.equal(configResponse.ok, true);
    const config = await configResponse.json();
    assert.equal(config.backgroundOpacity, 0);
    assert.ok(config.elements.some((element) => element.type === "logo"));
    const changed = { ...config, width: 1080, height: 1920 };
    const saved = await fetch(`${status.baseUrl}/api/config`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(changed)
    });
    assert.equal(saved.ok, true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, "overlay.json"), "utf8")).height, 1920);
    const eventResponse = await fetch(`${status.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Crazy_Batto", text: "Test" })
    });
    assert.equal(eventResponse.ok, true);
  } finally {
    await server.stop();
    remove(directory);
  }
});

test("Mobile bridge creates both QR schemes and requires a six digit PIN", async () => {
  const directory = temporaryDirectory("batto-mobile");
  const server = new MobileBridge({
    webRoot: path.join(__dirname, "..", "src", "mobile"),
    stateFile: path.join(directory, "pairings.json"),
    preferredPort: 49220,
    stateProvider: () => ({ deck: { profiles: [] } }),
    actionHandler: async () => ({ ok: true })
  });
  try {
    await server.start();
    const status = server.status();
    assert.equal(status.active, true);
    assert.match(status.pin, /^\d{6}$/);
    assert.match(status.qr.batto, /^battoobstool:\/\/pair\?/);
    assert.match(status.qr.legacy, /^creatorhub:\/\/pair\?/);
    assert.match(status.qr.webDataUrl, /^data:image\/png;base64,/);
    assert.match(status.qr.legacyDataUrl, /^data:image\/png;base64,/);
    const response = await fetch(`http://127.0.0.1:${status.port}/api/status`);
    assert.equal(response.ok, true);
    const publicStatus = await response.json();
    assert.equal(Object.hasOwn(publicStatus, "pin"), false);
  } finally {
    await server.stop();
    remove(directory);
  }
});

test("Multi-chat never writes Twitch or YouTube secrets to plain JSON", () => {
  const directory = temporaryDirectory("batto-chat");
  try {
    const file = path.join(directory, "chat.json");
    const chat = new MultiChat({ settingsFile: file, overlayServer: null });
    chat.updateSettings({ twitch: { channel: "crazy_batto" }, youtube: { liveChatId: "live-id" } }, {
      twitchOauth: "oauth-secret-value",
      youtubeApiKey: "youtube-secret-value"
    });
    const raw = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(raw, /oauth-secret-value/);
    assert.doesNotMatch(raw, /youtube-secret-value/);
    assert.equal(chat.settings.twitch.oauth, "oauth-secret-value");
    assert.equal(chat.settings.youtube.apiKey, "youtube-secret-value");
  } finally {
    remove(directory);
  }
});

test("Legacy migration copies only missing files and never overwrites Batto data", () => {
  const directory = temporaryDirectory("batto-migration");
  try {
    const source = path.join(directory, "legacy");
    const destination = path.join(directory, "batto");
    fs.mkdirSync(source, { recursive: true });
    fs.mkdirSync(destination, { recursive: true });
    fs.writeFileSync(path.join(source, "same.json"), "legacy", "utf8");
    fs.writeFileSync(path.join(destination, "same.json"), "batto", "utf8");
    fs.writeFileSync(path.join(source, "new.json"), "new", "utf8");
    const report = { copied: [], errors: [] };
    copyDirectoryMissing(source, destination, report, "Test");
    assert.equal(fs.readFileSync(path.join(destination, "same.json"), "utf8"), "batto");
    assert.equal(fs.readFileSync(path.join(destination, "new.json"), "utf8"), "new");
    assert.equal(report.errors.length, 0);

    const deckStore = new DeckStore(path.join(directory, "deck.json"));
    const pluginRegistry = new PluginRegistry({ stateFile: path.join(directory, "plugins.json"), pluginRoots: [], iconPackRoots: [] });
    const migration = new LegacyMigration({ userData: directory, deckStore, pluginRegistry });
    assert.equal(typeof migration.status(), "object");
  } finally {
    remove(directory);
  }
});

test("Production UI contains all integrated pages without old visible branding", () => {
  const root = path.join(__dirname, "..");
  const files = [
    "src/renderer/index.html", "src/renderer/app.js", "src/renderer/integrated.js",
    "src/mobile/index.html", "src/mobile/app.js", "src/stream-overlay/editor.html", "src/stream-overlay/overlay.html"
  ].map((relative) => fs.readFileSync(path.join(root, relative), "utf8")).join("\n");
  assert.doesNotMatch(files, /Creator Hub/i);
  assert.doesNotMatch(files, /\bKandidat\b/i);
  for (const label of ["Stream-Overlay", "Multi-Chat", "OBS Gäste", "Plugins", "Touch-Deck Pro", "Handy verbinden"]) assert.match(files, new RegExp(label));
  const monitoringCss = fs.readFileSync(path.join(root, "modules", "encoder-monitoring-overlay", "web", "overlay.css"), "utf8");
  assert.match(monitoringCss, /background:\s*transparent\s*!important/);
});
