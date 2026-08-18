"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const AdmZip = require("adm-zip");
const { PluginRegistry } = require("../src/services/plugin-registry.cjs");
const { StreamDeckPluginHost, pluginInfo } = require("../src/services/stream-deck-plugin-host.cjs");

const temporary = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));

function createPluginArchive(file, { uuid = "com.crazybatto.test", actionId = "com.crazybatto.test.action", script = "" } = {}) {
  const zip = new AdmZip();
  zip.addFile(`${uuid}.sdPlugin/manifest.json`, Buffer.from(JSON.stringify({
    UUID: uuid,
    Name: "Batto Test Original Plugin",
    Version: "1.0.0",
    SDKVersion: 2,
    CodePath: "plugin.cjs",
    Actions: [{ UUID: actionId, Name: "Testaktion", Controllers: ["Keypad"], States: [{ Title: "Test" }] }]
  })));
  zip.addFile(`${uuid}.sdPlugin/plugin.cjs`, Buffer.from(script || "setInterval(() => {}, 1000);"));
  zip.writeZip(file);
}

test("virtuelles Touch-Gerät meldet das gewählte Raster an originale Plugins", () => {
  const info = pluginInfo({ id: "com.crazybatto.layout", version: "1.0.0" }, { columns: 8, rows: 4 });
  assert.deepEqual(info.devices[0].size, { columns: 8, rows: 4 });
  assert.equal(info.devices[0].name, "Batto Touch Monitor");
});

test(".streamDeckPlugin ZIP wird sicher importiert und als ausführbare Original-Laufzeit erkannt", () => {
  const root = temporary("batto-streamdeck-import");
  try {
    const source = path.join(root, "Test.streamDeckPlugin");
    const plugins = path.join(root, "plugins");
    createPluginArchive(source);
    const registry = new PluginRegistry({ stateFile: path.join(root, "state.json"), pluginRoots: [plugins], iconPackRoots: [] });
    const result = registry.importPath(source, plugins);
    assert.match(result.importedPath, /com\.crazybatto\.test\.sdPlugin$/i);
    const plugin = result.snapshot.plugins.find((entry) => entry.id === "com.crazybatto.test");
    assert.ok(plugin);
    assert.equal(plugin.runtime.status, "ready");
    assert.equal(plugin.runtime.kind, "node");
    assert.equal(plugin.actions[0].id, "com.crazybatto.test.action");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("Pfadtraversal in einem .streamDeckPlugin-Paket wird blockiert", () => {
  const root = temporary("batto-streamdeck-unsafe");
  try {
    const source = path.join(root, "Unsafe.streamDeckPlugin");
    const zip = new AdmZip();
    zip.addFile("safe.sdPlugin/manifest.json", Buffer.from(JSON.stringify({ UUID: "safe", Name: "Safe", CodePath: "plugin.js", Actions: [] })));
    zip.addFile("safe.sdPlugin/plugin.js", Buffer.from(""));
    zip.addFile("placeholder.txt", Buffer.from("blocked"));
    zip.getEntries().find((entry) => entry.entryName === "placeholder.txt").entryName = "../outside.txt";
    zip.writeZip(source);
    const registry = new PluginRegistry({ stateFile: path.join(root, "state.json"), pluginRoots: [], iconPackRoots: [] });
    assert.throws(() => registry.importPath(source, path.join(root, "plugins")), /außerhalb|ungültigen Dateipfad|Unsicherer/i);
    assert.equal(fs.existsSync(path.join(root, "outside.txt")), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("originale Node-Plugin-Laufzeit empfängt willAppear, keyDown und keyUp über Elgato WebSocket", async () => {
  const root = temporary("batto-streamdeck-runtime");
  const source = path.join(root, "Runtime.streamDeckPlugin");
  const plugins = path.join(root, "plugins");
  const eventFile = path.join(root, "events.json");
  const wsModule = require.resolve("ws");
  const runtime = `
    const fs = require("node:fs");
    const { WebSocket } = require(${JSON.stringify(wsModule)});
    const args = {};
    for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i]] = process.argv[i + 1];
    const events = [];
    const socket = new WebSocket("ws://127.0.0.1:" + args["-port"]);
    socket.on("open", () => socket.send(JSON.stringify({ event: args["-registerEvent"], uuid: args["-pluginUUID"] })));
    socket.on("message", (raw) => {
      const message = JSON.parse(String(raw));
      events.push(message.event);
      fs.writeFileSync(${JSON.stringify(eventFile)}, JSON.stringify(events));
      if (message.event === "keyUp") {
        socket.send(JSON.stringify({ event: "setTitle", context: message.context, payload: { title: "Original OK", target: 0 } }));
        socket.send(JSON.stringify({ event: "showOk", context: message.context, payload: {} }));
      }
    });
  `;
  createPluginArchive(source, { uuid: "com.crazybatto.runtime", actionId: "com.crazybatto.runtime.press", script: runtime });
  const registry = new PluginRegistry({ stateFile: path.join(root, "registry.json"), pluginRoots: [plugins], iconPackRoots: [] });
  registry.importPath(source, plugins);
  const host = new StreamDeckPluginHost({ registry, stateFile: path.join(root, "host.json"), shell: { openExternal: async () => {} }, registrationTimeoutMs: 5000 });
  try {
    const result = await host.execute({ type: "com.crazybatto.runtime.press", settings: { value: 7 } }, { profileId: "p", folderId: "root", buttonIndex: 3, columns: 5, rows: 3 });
    const events = JSON.parse(fs.readFileSync(eventFile, "utf8"));
    assert.deepEqual(events.slice(0, 4), ["deviceDidConnect", "willAppear", "keyDown", "keyUp"]);
    assert.equal(result.dispatched, true);
    assert.deepEqual(host.status().device.size, { columns: 5, rows: 3 });
    assert.equal(host.status().feedback[result.context].title, "Original OK");
    assert.equal(host.status().feedback[result.context].result, "ok");
  } finally {
    await host.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
