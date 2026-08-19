"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const AdmZip = require("adm-zip");
const { WebSocket } = require("ws");
const { PluginRegistry, compareVersions, normalizePlugin } = require("../src/services/plugin-registry.cjs");
const { StreamDeckPluginHost, actionPayload, pluginInfo, resourceMap } = require("../src/services/stream-deck-plugin-host.cjs");

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

function createPropertyInspectorArchive(file, {
  uuid = "com.crazybatto.inspector",
  actionId = "com.crazybatto.inspector.action",
  propertyInspectorPath = "property-inspector.html",
  propertyInspectorHtml = "<!doctype html><title>Batto Property Inspector</title>",
  script = ""
} = {}) {
  const zip = new AdmZip();
  zip.addFile(`${uuid}.sdPlugin/manifest.json`, Buffer.from(JSON.stringify({
    UUID: uuid,
    Name: "Batto Property Inspector Test",
    Version: "1.0.0",
    SDKVersion: 2,
    CodePath: "plugin.cjs",
    Actions: [{
      UUID: actionId,
      Name: "Inspector-Aktion",
      Controllers: ["Keypad"],
      PropertyInspectorPath: propertyInspectorPath,
      States: [{ Title: "Inspector" }]
    }]
  })));
  zip.addFile(`${uuid}.sdPlugin/plugin.cjs`, Buffer.from(script || "setInterval(() => {}, 1000);"));
  if (propertyInspectorPath && !path.isAbsolute(propertyInspectorPath) && !propertyInspectorPath.includes("..")) {
    zip.addFile(`${uuid}.sdPlugin/${propertyInspectorPath}`, Buffer.from(propertyInspectorHtml));
  }
  zip.writeZip(file);
}

async function waitFor(predicate, message, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(message);
}

function readJsonArray(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return []; }
}

function createNormalizedPlugin(root, name, manifestPatch = {}, files = {}) {
  const pluginRoot = path.join(root, `${name}.sdPlugin`);
  fs.mkdirSync(pluginRoot, { recursive: true });
  const manifest = {
    UUID: `com.crazybatto.${name}`,
    Name: name,
    Version: "1.0.0",
    SDKVersion: 2,
    Software: { MinimumVersion: "7.1" },
    OS: [{ Platform: "windows", MinimumVersion: "10" }],
    CodePath: "plugin.cjs",
    Actions: [{ UUID: `com.crazybatto.${name}.action`, Name: "Aktion", Controllers: ["Keypad"], States: [{}] }],
    ...manifestPatch
  };
  const manifestFile = path.join(pluginRoot, "manifest.json");
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(pluginRoot, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  }
  return normalizePlugin(manifest, manifestFile, root);
}

test("virtuelles Touch-Gerät meldet das gewählte Raster an originale Plugins", () => {
  const info = pluginInfo({ id: "com.crazybatto.layout", version: "1.0.0" }, { columns: 8, rows: 4 });
  assert.deepEqual(info.devices[0].size, { columns: 8, rows: 4 });
  assert.equal(info.devices[0].name, "Batto Touch Monitor");
  assert.equal(info.devices[0].type, 11);
  assert.equal(info.application.version, "7.1.0");
  assert.equal(typeof info.colors.buttonMouseOverBackgroundColor, "string");
});

test("Elgato-7.1-Runtimeprüfung unterscheidet Versionen, Laufzeitarten und sichere Dateipfade", () => {
  const root = temporary("batto-plugin-runtime-compatibility");
  try {
    assert.equal(compareVersions("7.10", "7.4") > 0, true);
    assert.equal(compareVersions("7.1.0", "7.1"), 0);

    const futureSoftware = createNormalizedPlugin(root, "future-software", { Software: { MinimumVersion: "7.10" } }, { "plugin.cjs": "" });
    assert.equal(futureSoftware.runtime.status, "software-version");

    const futureNode = createNormalizedPlugin(root, "future-node", { Nodejs: { Version: String(Number(process.versions.node.split(".")[0]) + 1) } }, { "plugin.cjs": "" });
    assert.equal(futureNode.runtime.status, "node-version");

    const futureSdk = createNormalizedPlugin(root, "future-sdk", { SDKVersion: 4 }, { "plugin.cjs": "" });
    assert.equal(futureSdk.runtime.status, "sdk-version");

    const unsupportedRuntime = createNormalizedPlugin(root, "unsupported-runtime", { CodePath: "plugin.py" }, { "plugin.py": "" });
    assert.equal(unsupportedRuntime.runtime.status, "unsupported-runtime");

    const nativeWithoutDeclaredExtension = createNormalizedPlugin(root, "native-runtime", { CodePath: "native-runtime" }, { "native-runtime.exe": "MZ" });
    assert.equal(nativeWithoutDeclaredExtension.runtime.kind, "native");
    assert.equal(nativeWithoutDeclaredExtension.runtime.status, "ready");

    const outsideDirectory = path.join(root, "outside-runtime");
    fs.mkdirSync(outsideDirectory);
    fs.writeFileSync(path.join(outsideDirectory, "plugin.cjs"), "");
    fs.writeFileSync(path.join(outsideDirectory, "icon.png"), "not-a-real-png");
    const unsafeRoot = path.join(root, "unsafe-runtime.sdPlugin");
    fs.mkdirSync(unsafeRoot);
    fs.symlinkSync(outsideDirectory, path.join(unsafeRoot, "linked"), process.platform === "win32" ? "junction" : "dir");
    const unsafeManifest = {
      UUID: "com.crazybatto.unsafe-runtime",
      Name: "unsafe-runtime",
      Version: "1.0.0",
      SDKVersion: 2,
      Software: { MinimumVersion: "7.1" },
      OS: [{ Platform: "windows", MinimumVersion: "10" }],
      CodePath: "linked/plugin.cjs",
      Icon: "linked/icon",
      Actions: [{ UUID: "com.crazybatto.unsafe-runtime.action", Name: "Aktion", States: [{}] }]
    };
    const unsafeManifestFile = path.join(unsafeRoot, "manifest.json");
    fs.writeFileSync(unsafeManifestFile, JSON.stringify(unsafeManifest));
    const unsafe = normalizePlugin(unsafeManifest, unsafeManifestFile, root);
    assert.equal(unsafe.runtime.status, "unsafe-path");
    assert.equal(unsafe.executablePath, "");
    assert.equal(unsafe.icon, "");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("deaktivierte native Plugin-Gruppe kann ihre gleichnamige Originallaufzeit nicht umgehen", () => {
  const root = temporary("batto-plugin-disabled-original");
  const source = path.join(root, "Obs.streamDeckPlugin");
  const plugins = path.join(root, "plugins");
  const actionId = "batto.obs.original-test";
  try {
    createPluginArchive(source, { uuid: "batto.obs", actionId });
    const registry = new PluginRegistry({ stateFile: path.join(root, "state.json"), pluginRoots: [plugins], iconPackRoots: [] });
    registry.importPath(source, plugins);
    registry.setEnabled("batto.obs", false);
    assert.equal(registry.findPlugin("batto.obs").enabled, false);
    assert.equal(registry.findPluginForAction(actionId), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("7.1-Aktionspayloads trennen Keypad- und Multi-Action-Felder und filtern Resources", () => {
  assert.deepEqual(resourceMap({ audio: "C:\\audio\\track.mp3", invalid: 42 }), { audio: "C:\\audio\\track.mp3" });
  assert.deepEqual(actionPayload({ buttonIndex: 6, columns: 5 }, { enabled: true }, { file: "C:\\x.txt" }), {
    controller: "Keypad",
    isInMultiAction: false,
    resources: { file: "C:\\x.txt" },
    settings: { enabled: true },
    coordinates: { column: 1, row: 1 }
  });
  assert.deepEqual(actionPayload({ multiAction: true }, {}, {}), {
    controller: "Keypad",
    isInMultiAction: true,
    resources: {},
    settings: {}
  });
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

test("originaler Property Inspector tauscht Einstellungen und Plugin-Nachrichten über Elgato WebSocket aus", async () => {
  const root = temporary("batto-property-inspector");
  const source = path.join(root, "Inspector.streamDeckPlugin");
  const plugins = path.join(root, "plugins");
  const eventFile = path.join(root, "plugin-events.json");
  const wsModule = require.resolve("ws");
  const uuid = "com.crazybatto.inspector";
  const actionId = `${uuid}.action`;
  const runtime = `
    const fs = require("node:fs");
    const { WebSocket } = require(${JSON.stringify(wsModule)});
    const args = {};
    for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i]] = process.argv[i + 1];
    const events = [];
    const record = (message) => {
      events.push(message);
      fs.writeFileSync(${JSON.stringify(eventFile)}, JSON.stringify(events));
    };
    record({ event: "runtimeArguments", execArgv: process.execArgv });
    const socket = new WebSocket("ws://127.0.0.1:" + args["-port"]);
    socket.on("open", () => socket.send(JSON.stringify({ event: args["-registerEvent"], uuid: args["-pluginUUID"] })));
    socket.on("message", (raw) => {
      const message = JSON.parse(String(raw));
      record(message);
      if (message.event === "propertyInspectorDidAppear") {
        socket.send(JSON.stringify({
          action: message.action,
          event: "sendToPropertyInspector",
          context: message.context,
          payload: { source: "plugin", phase: "appeared" }
        }));
        socket.send(JSON.stringify({ action: message.action, event: "getSettings", context: message.context, id: "plugin-settings-request" }));
        socket.send(JSON.stringify({ action: message.action, event: "getResources", context: message.context, id: "plugin-resources-request" }));
      }
      if (message.event === "sendToPlugin") {
        socket.send(JSON.stringify({
          action: message.action,
          event: "sendToPropertyInspector",
          context: message.context,
          payload: { source: "plugin", echo: message.payload }
        }));
        if (message.payload?.command === "plugin-updates") {
          socket.send(JSON.stringify({ event: "setSettings", context: message.context, payload: { source: "plugin", enabled: true } }));
          socket.send(JSON.stringify({ event: "setResources", context: message.context, payload: { sound: "C:\\\\audio\\\\alert.mp3", invalid: 12 } }));
          socket.send(JSON.stringify({ event: "setGlobalSettings", context: args["-pluginUUID"], payload: { account: "plugin" } }));
        }
      }
    });
  `;
  createPropertyInspectorArchive(source, { uuid, actionId, script: runtime });
  const registry = new PluginRegistry({ stateFile: path.join(root, "registry.json"), pluginRoots: [plugins], iconPackRoots: [] });
  registry.importPath(source, plugins);
  const host = new StreamDeckPluginHost({ registry, stateFile: path.join(root, "host.json"), shell: { openExternal: async () => {} }, registrationTimeoutMs: 5000 });
  let inspectorSocket;
  try {
    const descriptor = await host.createPropertyInspector(
      { type: actionId, settings: { initial: "vom Touch Deck" } },
      { profileId: "profile-a", folderId: "root", buttonIndex: 7, columns: 5, rows: 3 }
    );
    assert.equal(descriptor.registerEvent, "registerPropertyInspector");
    assert.equal(path.basename(descriptor.filePath), "property-inspector.html");
    assert.match(fs.readFileSync(descriptor.filePath, "utf8"), /Batto Property Inspector/);
    assert.ok(descriptor.filePath.startsWith(path.resolve(plugins)));
    assert.equal(descriptor.port, host.port());
    const actionInfo = JSON.parse(descriptor.actionInfo);
    assert.equal(actionInfo.action, actionId);
    assert.equal(actionInfo.context, descriptor.context);
    assert.deepEqual(actionInfo.payload.settings, { initial: "vom Touch Deck" });
    assert.deepEqual(actionInfo.payload.coordinates, { column: 2, row: 1 });
    assert.equal(actionInfo.payload.controller, "Keypad");
    assert.deepEqual(actionInfo.payload.resources, {});

    const inspectorMessages = [];
    inspectorSocket = new WebSocket(`ws://127.0.0.1:${descriptor.port}`);
    inspectorSocket.on("message", (raw) => inspectorMessages.push(JSON.parse(String(raw))));
    await new Promise((resolve, reject) => {
      inspectorSocket.once("open", resolve);
      inspectorSocket.once("error", reject);
    });
    inspectorSocket.send(JSON.stringify({ event: descriptor.registerEvent, uuid: descriptor.id }));

    await waitFor(
      () => host.status().propertyInspectors.some((entry) => entry.id === descriptor.id && entry.connected),
      "Der Property Inspector hat sich nicht am Host registriert."
    );
    const runtimeArguments = await waitFor(
      () => readJsonArray(eventFile).find((entry) => entry.event === "runtimeArguments"),
      "Die Node-Laufzeitargumente wurden nicht erfasst."
    );
    assert.ok(runtimeArguments.execArgv.includes("--enable-source-maps"));
    assert.ok(runtimeArguments.execArgv.includes("--no-global-search-paths"));
    await waitFor(
      () => readJsonArray(eventFile).some((entry) => entry.event === "propertyInspectorDidAppear" && entry.context === descriptor.context),
      "Das Plugin hat propertyInspectorDidAppear nicht erhalten."
    );
    const pluginRequestedSettings = await waitFor(
      () => readJsonArray(eventFile).find((entry) => entry.event === "didReceiveSettings" && entry.id === "plugin-settings-request"),
      "getSettings der Plugin-Laufzeit wurde nicht beantwortet."
    );
    assert.deepEqual(pluginRequestedSettings.payload.coordinates, { column: 2, row: 1 });
    assert.deepEqual(pluginRequestedSettings.payload.settings, { initial: "vom Touch Deck" });
    const pluginRequestedResources = await waitFor(
      () => readJsonArray(eventFile).find((entry) => entry.event === "didReceiveResources" && entry.id === "plugin-resources-request"),
      "getResources der Plugin-Laufzeit wurde nicht beantwortet."
    );
    assert.deepEqual(pluginRequestedResources.payload.coordinates, { column: 2, row: 1 });
    assert.deepEqual(pluginRequestedResources.payload.resources, {});
    await waitFor(
      () => inspectorMessages.find((entry) => entry.event === "sendToPropertyInspector" && entry.payload?.phase === "appeared"),
      "sendToPropertyInspector wurde nicht an den Inspector weitergeleitet."
    );

    inspectorSocket.send(JSON.stringify({ action: actionId, event: "getSettings", context: descriptor.context }));
    const initialSettings = await waitFor(
      () => inspectorMessages.find((entry) => entry.event === "didReceiveSettings" && entry.payload?.settings?.initial),
      "getSettings lieferte keine gespeicherten Einstellungen."
    );
    assert.equal(initialSettings.payload.settings.initial, "vom Touch Deck");
    assert.deepEqual(initialSettings.payload.coordinates, { column: 2, row: 1 });
    assert.equal(initialSettings.payload.controller, "Keypad");
    assert.deepEqual(initialSettings.payload.resources, {});

    inspectorSocket.send(JSON.stringify({ action: actionId, event: "setSettings", context: descriptor.context, payload: { color: "#34d6ff", count: 4 } }));
    inspectorSocket.send(JSON.stringify({ event: "setGlobalSettings", context: uuid, payload: { account: "alpha" } }));
    inspectorSocket.send(JSON.stringify({ event: "getGlobalSettings", context: uuid }));
    inspectorSocket.send(JSON.stringify({ action: actionId, event: "sendToPlugin", context: descriptor.context, payload: { command: "ping" } }));

    const receivedSettings = await waitFor(
      () => readJsonArray(eventFile).find((entry) => entry.event === "didReceiveSettings" && entry.payload?.settings?.count === 4),
      "setSettings wurde dem Plugin nicht als didReceiveSettings zugestellt."
    );
    assert.equal(receivedSettings.payload.controller, "Keypad");
    assert.deepEqual(receivedSettings.payload.resources, {});
    inspectorSocket.send(JSON.stringify({ action: actionId, event: "setResources", context: descriptor.context, payload: { audio: "C:\\audio\\track.mp3", invalid: 12 } }));
    inspectorSocket.send(JSON.stringify({ action: actionId, event: "getResources", context: descriptor.context, id: "resource-request" }));
    const pluginResources = await waitFor(
      () => readJsonArray(eventFile).find((entry) => entry.event === "didReceiveResources" && entry.payload?.resources?.audio),
      "setResources wurde dem Plugin nicht zugestellt."
    );
    assert.deepEqual(pluginResources.payload.resources, { audio: "C:\\audio\\track.mp3" });
    const inspectorResources = await waitFor(
      () => inspectorMessages.find((entry) => entry.event === "didReceiveResources" && entry.id === "resource-request"),
      "getResources lieferte dem Inspector keine Resources."
    );
    assert.deepEqual(inspectorResources.payload.resources, { audio: "C:\\audio\\track.mp3" });
    await waitFor(
      () => readJsonArray(eventFile).some((entry) => entry.event === "sendToPlugin" && entry.payload?.command === "ping"),
      "sendToPlugin wurde nicht an die originale Plugin-Laufzeit zugestellt."
    );
    const globalSettings = await waitFor(
      () => inspectorMessages.find((entry) => entry.event === "didReceiveGlobalSettings" && entry.payload?.settings?.account === "alpha"),
      "Globale Einstellungen wurden dem Inspector nicht geliefert."
    );
    assert.equal(globalSettings.context, uuid);
    const echo = await waitFor(
      () => inspectorMessages.find((entry) => entry.event === "sendToPropertyInspector" && entry.payload?.echo?.command === "ping"),
      "Die Antwort des Plugins erreichte den Property Inspector nicht."
    );
    assert.equal(echo.context, descriptor.context);

    inspectorSocket.send(JSON.stringify({ action: actionId, event: "sendToPlugin", context: descriptor.context, payload: { command: "plugin-updates" } }));
    const settingsFromPlugin = await waitFor(
      () => inspectorMessages.find((entry) => entry.event === "didReceiveSettings" && entry.payload?.settings?.source === "plugin"),
      "Vom Plugin gesetzte Einstellungen wurden dem Inspector nicht zugestellt."
    );
    assert.deepEqual(settingsFromPlugin.payload.resources, { audio: "C:\\audio\\track.mp3" });
    const resourcesFromPlugin = await waitFor(
      () => inspectorMessages.find((entry) => entry.event === "didReceiveResources" && entry.payload?.resources?.sound),
      "Vom Plugin gesetzte Resources wurden dem Inspector nicht zugestellt."
    );
    assert.deepEqual(resourcesFromPlugin.payload.resources, { sound: "C:\\audio\\alert.mp3" });
    await waitFor(
      () => inspectorMessages.find((entry) => entry.event === "didReceiveGlobalSettings" && entry.payload?.settings?.account === "plugin"),
      "Vom Plugin gesetzte globale Einstellungen wurden dem Inspector nicht zugestellt."
    );

    const firstInspectorSocket = inspectorSocket;
    const reloadedMessages = [];
    const reloadedSocket = new WebSocket(`ws://127.0.0.1:${descriptor.port}`);
    reloadedSocket.on("message", (raw) => reloadedMessages.push(JSON.parse(String(raw))));
    await new Promise((resolve, reject) => {
      reloadedSocket.once("open", resolve);
      reloadedSocket.once("error", reject);
    });
    reloadedSocket.send(JSON.stringify({ event: descriptor.registerEvent, uuid: descriptor.id }));
    await waitFor(() => firstInspectorSocket.readyState === WebSocket.CLOSED, "Der alte Inspector-Socket blieb nach dem Neuladen offen.");
    inspectorSocket = reloadedSocket;
    inspectorSocket.send(JSON.stringify({ action: actionId, event: "getSettings", context: descriptor.context }));
    await waitFor(
      () => reloadedMessages.find((entry) => entry.event === "didReceiveSettings" && entry.payload?.settings?.source === "plugin"),
      "Der neu geladene Property Inspector konnte sich nicht wieder registrieren."
    );
    assert.equal(readJsonArray(eventFile).filter((entry) => entry.event === "propertyInspectorDidAppear").length, 1);

    const saved = host.closePropertyInspector(descriptor.id);
    assert.deepEqual(saved, { source: "plugin", enabled: true });
    await waitFor(
      () => readJsonArray(eventFile).some((entry) => entry.event === "propertyInspectorDidDisappear" && entry.context === descriptor.context),
      "Das Plugin hat propertyInspectorDidDisappear nicht erhalten."
    );
    assert.equal(host.status().propertyInspectors.some((entry) => entry.id === descriptor.id), false);
  } finally {
    try { inspectorSocket?.terminate(); } catch {}
    await host.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Property-Inspector-Pfade dürfen den Plugin-Ordner nicht verlassen", async () => {
  const root = temporary("batto-property-inspector-path");
  const source = path.join(root, "Inspector.streamDeckPlugin");
  const plugins = path.join(root, "plugins");
  const uuid = "com.crazybatto.inspector.path";
  const actionId = `${uuid}.action`;
  createPropertyInspectorArchive(source, { uuid, actionId, propertyInspectorPath: "../escape.html" });
  const registry = new PluginRegistry({ stateFile: path.join(root, "registry.json"), pluginRoots: [plugins], iconPackRoots: [] });
  const imported = registry.importPath(source, plugins);
  const plugin = imported.snapshot.plugins.find((entry) => entry.id === uuid);
  fs.writeFileSync(path.join(plugin.root, "..", "escape.html"), "<!doctype html><title>Außerhalb</title>");
  const host = new StreamDeckPluginHost({ registry, stateFile: path.join(root, "host.json"), shell: { openExternal: async () => {} } });
  try {
    await assert.rejects(
      host.createPropertyInspector({ type: actionId }, { profileId: "p", buttonIndex: 0 }),
      /außerhalb des Plugin-Ordners|fehlt/i
    );

    const originalPlugin = registry.findPluginForAction(actionId);
    const outsideDirectory = path.join(root, "outside-ui");
    const linkedDirectory = path.join(originalPlugin.root, "linked-ui");
    fs.mkdirSync(outsideDirectory);
    fs.writeFileSync(path.join(outsideDirectory, "property-inspector.html"), "<!doctype html><title>Symlink außerhalb</title>");
    fs.symlinkSync(outsideDirectory, linkedDirectory, process.platform === "win32" ? "junction" : "dir");
    originalPlugin.actions[0].propertyInspectorPath = "linked-ui/property-inspector.html";
    await assert.rejects(
      host.createPropertyInspector({ type: actionId }, { profileId: "p", buttonIndex: 0 }),
      /außerhalb des Plugin-Ordners|fehlt/i
    );
    fs.writeFileSync(path.join(originalPlugin.root, "property-inspector.txt"), "Kein HTML");
    originalPlugin.actions[0].propertyInspectorPath = "property-inspector.txt";
    await assert.rejects(
      host.createPropertyInspector({ type: actionId }, { profileId: "p", buttonIndex: 0 }),
      /HTML-Datei/i
    );
    assert.equal(host.status().sessions.length, 0);
  } finally {
    await host.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
