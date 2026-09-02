"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const crypto = require("node:crypto");
const { WebSocketServer, WebSocket } = require("ws");

function uid(prefix = "sd") { return `${prefix}-${crypto.randomUUID()}`; }
function isOpen(socket) { return socket?.readyState === WebSocket.OPEN; }
function safeJson(value) { return JSON.stringify(value ?? {}); }

class StreamDeckRuntime {
  constructor({ BrowserWindow, shell, pluginRegistry, deckStore, getParent, scheduleState } = {}) {
    this.BrowserWindow = BrowserWindow;
    this.shell = shell;
    this.pluginRegistry = pluginRegistry;
    this.deckStore = deckStore;
    this.getParent = getParent || (() => null);
    this.scheduleState = scheduleState || (() => {});
    this.server = null;
    this.wss = null;
    this.port = 0;
    this.sockets = new Set();
    this.pluginSockets = new Map();
    this.piSockets = new Map();
    this.pluginProcesses = new Map();
    this.contexts = new Map();
    this.windows = new Map();
  }

  info(plugin) {
    return {
      application: { language: "de", platform: process.platform === "win32" ? "windows" : process.platform, version: "7.0.0", font: "Segoe UI" },
      plugin: { uuid: plugin?.id || "", version: plugin?.version || "" },
      devicePixelRatio: 1,
      devices: [{ id: "batto-virtual-deck", name: "Batto Touch-Deck", size: { columns: 5, rows: 3 }, type: 11 }],
      colors: { buttonPressedBackgroundColor: "#303030", buttonPressedBorderColor: "#646464", buttonPressedTextColor: "#ffffff", disabledColor: "#969696", highlightColor: "#4fd8ff", mouseDownColor: "#303030" }
    };
  }

  async start() {
    if (this.server?.listening) return this.status();
    this.server = http.createServer((_request, response) => { response.writeHead(404); response.end(); });
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 4_000_000 });
    this.server.on("upgrade", (request, socket, head) => {
      if (new URL(request.url || "/", "http://127.0.0.1").pathname !== "/streamdeck") return socket.destroy();
      this.wss.handleUpgrade(request, socket, head, (client) => this.wss.emit("connection", client));
    });
    this.wss.on("connection", (socket) => {
      this.sockets.add(socket);
      socket.meta = { kind: "unknown", uuid: "" };
      socket.on("message", (data) => this.onMessage(socket, data));
      socket.on("close", () => this.onClose(socket));
      socket.on("error", () => this.onClose(socket));
    });
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", () => resolve());
    });
    this.port = Number(this.server.address()?.port || 0);
    return this.status();
  }

  status() { return { active: Boolean(this.server?.listening), port: this.port, plugins: this.pluginSockets.size, inspectors: this.piSockets.size }; }

  findPlugin(pluginId) {
    if (!this.pluginRegistry?.plugins?.length) this.pluginRegistry?.scan?.();
    const found = this.pluginRegistry?.plugins?.find((plugin) => plugin.id === pluginId);
    if (!found) throw new Error(`Stream-Deck-Plugin nicht gefunden: ${pluginId}`);
    return found.originalPlugin || found;
  }

  findAction(plugin, actionId) {
    const action = (plugin.actions || []).find((entry) => entry.id === actionId);
    if (!action) throw new Error(`Plugin-Aktion nicht gefunden: ${actionId}`);
    return action;
  }

  contextFrom(input = {}) {
    const profile = this.deckStore.getProfile(input.profileId) || this.deckStore.activeProfile();
    const folder = profile?.folders.find((entry) => entry.id === input.folderId) || profile?.folders[0];
    const buttonIndex = Math.max(0, Math.min(99, Number(input.buttonIndex) || 0));
    const button = folder?.buttons?.[buttonIndex];
    if (!profile || !folder || !button) throw new Error("Touch-Deck-Taste wurde nicht gefunden.");
    const action = button.actions?.find((entry) => entry.type === "streamdeck.original" && entry.settings?.pluginId === input.pluginId && entry.settings?.actionId === input.actionId)
      || button.actions?.find((entry) => entry.type === "streamdeck.original")
      || null;
    return { profile, folder, buttonIndex, button, action };
  }

  pluginSettings(context) { return context.action?.settings?.pluginSettings && typeof context.action.settings.pluginSettings === "object" ? context.action.settings.pluginSettings : {}; }

  persistPluginSettings(context, settings) {
    const button = JSON.parse(JSON.stringify(context.button));
    const index = button.actions.findIndex((entry) => entry.id === context.action?.id || (entry.type === "streamdeck.original" && entry.settings?.pluginId === context.action?.settings?.pluginId && entry.settings?.actionId === context.action?.settings?.actionId));
    if (index < 0) throw new Error("Original-Plugin-Aktion ist auf dieser Taste nicht mehr vorhanden.");
    button.actions[index].settings = { ...button.actions[index].settings, pluginSettings: settings && typeof settings === "object" ? settings : {} };
    this.deckStore.updateButton(context.profile.id, context.folder.id, context.buttonIndex, button);
    context.button = this.deckStore.getProfile(context.profile.id).folders.find((entry) => entry.id === context.folder.id).buttons[context.buttonIndex];
    context.action = context.button.actions[index];
    this.scheduleState();
  }

  persistTitle(context, title) {
    const button = JSON.parse(JSON.stringify(context.button));
    button.title = String(title || "").slice(0, 120);
    this.deckStore.updateButton(context.profile.id, context.folder.id, context.buttonIndex, button);
    this.scheduleState();
  }

  persistImage(context, image) {
    const value = String(image || "");
    if (!value || value.length > 1_900_000 || !/^data:image\//i.test(value)) return;
    const button = JSON.parse(JSON.stringify(context.button));
    button.icon = value;
    this.deckStore.updateButton(context.profile.id, context.folder.id, context.buttonIndex, button);
    this.scheduleState();
  }

  payloadFor(context, settings = this.pluginSettings(context)) {
    return {
      settings,
      coordinates: { column: context.buttonIndex % Math.max(1, context.folder.columns || 5), row: Math.floor(context.buttonIndex / Math.max(1, context.folder.columns || 5)) },
      controller: "Keypad",
      isInMultiAction: false
    };
  }

  send(socket, value) { if (isOpen(socket)) socket.send(JSON.stringify(value)); }

  sendSettingsTo(socket, ctx) {
    this.send(socket, { event: "didReceiveSettings", action: ctx.actionId, context: ctx.contextId, device: "batto-virtual-deck", payload: this.payloadFor(ctx.deckContext) });
  }

  async ensurePluginProcess(plugin) {
    if (this.pluginSockets.has(plugin.id) && isOpen(this.pluginSockets.get(plugin.id))) return this.pluginSockets.get(plugin.id);
    const existing = this.pluginProcesses.get(plugin.id);
    if (!existing || existing.killed || existing.exitCode !== null) {
      const executable = String(plugin.executablePath || "").trim();
      if (!executable || !fs.existsSync(executable)) throw new Error(`Das Original-Plugin ${plugin.name || plugin.id} hat keine ausführbare Windows-Laufzeit.`);
      const args = ["-port", String(this.port), "-pluginUUID", plugin.id, "-registerEvent", "registerPlugin", "-info", safeJson(this.info(plugin))];
      let proc;
      if (/\.(?:js|cjs|mjs)$/i.test(executable)) {
        proc = childProcess.spawn(process.execPath, [executable, ...args], { cwd: plugin.root, windowsHide: true, stdio: "ignore", env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } });
      } else {
        proc = childProcess.spawn(executable, args, { cwd: plugin.root, windowsHide: true, stdio: "ignore" });
      }
      proc.on("exit", () => { this.pluginProcesses.delete(plugin.id); this.pluginSockets.delete(plugin.id); });
      proc.on("error", () => { this.pluginProcesses.delete(plugin.id); this.pluginSockets.delete(plugin.id); });
      this.pluginProcesses.set(plugin.id, proc);
    }
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      const socket = this.pluginSockets.get(plugin.id);
      if (isOpen(socket)) return socket;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Original-Plugin ${plugin.name || plugin.id} hat sich nicht beim Stream-Deck-Host registriert.`);
  }

  async openInspector(input = {}) {
    await this.start();
    const plugin = this.findPlugin(input.pluginId);
    const action = this.findAction(plugin, input.actionId);
    const inspectorPath = action.propertyInspectorPath || plugin.propertyInspectorPath || "";
    if (!inspectorPath) throw new Error("Diese Original-Aktion hat keinen HTML-Property-Inspector. Für Elgato-Private-Aktionen wird der native Batto-Einstellungseditor verwendet.");
    const inspectorFile = path.resolve(plugin.root, inspectorPath);
    const root = path.resolve(plugin.root) + path.sep;
    if (!inspectorFile.startsWith(root) || !fs.existsSync(inspectorFile)) throw new Error(`Property Inspector fehlt: ${inspectorPath}`);

    const deckContext = this.contextFrom(input);
    if (!deckContext.action) throw new Error("Die Original-Plugin-Aktion muss zuerst auf die Taste gelegt werden.");
    const contextId = uid("context");
    const ctx = { contextId, pluginId: plugin.id, actionId: action.id, plugin, action, deckContext, inspectorFile };
    this.contexts.set(contextId, ctx);

    try { await this.ensurePluginProcess(plugin); } catch (error) {
      ctx.runtimeError = String(error?.message || error);
    }

    const parent = this.getParent?.();
    const win = new this.BrowserWindow({
      width: 480, height: 760, minWidth: 360, minHeight: 480, parent: parent && !parent.isDestroyed?.() ? parent : undefined,
      title: `${plugin.name} · ${action.name}`, autoHideMenuBar: true, backgroundColor: "#1b1b1b",
      webPreferences: { contextIsolation: false, nodeIntegration: false, sandbox: false, webSecurity: true }
    });
    this.windows.set(contextId, win);
    win.on("closed", () => {
      this.windows.delete(contextId);
      const socket = this.piSockets.get(contextId);
      try { socket?.close?.(); } catch {}
      this.piSockets.delete(contextId);
      this.contexts.delete(contextId);
      const pluginSocket = this.pluginSockets.get(plugin.id);
      this.send(pluginSocket, { event: "propertyInspectorDidDisappear", action: action.id, context: contextId, device: "batto-virtual-deck" });
    });
    await win.loadFile(inspectorFile);
    const info = safeJson(this.info(plugin));
    const actionInfo = safeJson({ action: action.id, context: contextId, device: "batto-virtual-deck", payload: this.payloadFor(deckContext) });
    const js = `(() => { const start=()=>{ if (typeof window.connectElgatoStreamDeckSocket === 'function') { window.connectElgatoStreamDeckSocket(${JSON.stringify(String(this.port))}, ${JSON.stringify(contextId)}, 'registerPropertyInspector', ${JSON.stringify(info)}, ${JSON.stringify(actionInfo)}); return true; } return false; }; if(!start()){ let tries=0; const timer=setInterval(()=>{ if(start()||++tries>40) clearInterval(timer); },100); } })();`;
    await win.webContents.executeJavaScript(js).catch(() => {});
    return { opened: true, pluginId: plugin.id, actionId: action.id, propertyInspectorPath: inspectorPath, runtimeError: ctx.runtimeError || "" };
  }

  async execute(input = {}) {
    await this.start();
    const plugin = this.findPlugin(input.pluginId);
    const action = this.findAction(plugin, input.actionId);
    const deckContext = this.contextFrom(input);
    if (!deckContext.action) throw new Error("Original-Plugin-Aktion ist nicht auf der Taste gespeichert.");
    const socket = await this.ensurePluginProcess(plugin);
    const contextId = uid("key");
    const ctx = { contextId, pluginId: plugin.id, actionId: action.id, plugin, action, deckContext };
    this.contexts.set(contextId, ctx);
    const base = { action: action.id, context: contextId, device: "batto-virtual-deck", payload: this.payloadFor(deckContext) };
    this.send(socket, { event: "willAppear", ...base });
    this.send(socket, { event: "didReceiveSettings", ...base });
    this.send(socket, { event: "keyDown", ...base });
    await new Promise((resolve) => setTimeout(resolve, 45));
    this.send(socket, { event: "keyUp", ...base });
    setTimeout(() => { this.send(socket, { event: "willDisappear", ...base }); this.contexts.delete(contextId); }, 800).unref?.();
    return { executed: true, pluginId: plugin.id, actionId: action.id };
  }

  onMessage(socket, raw) {
    let message;
    try { message = JSON.parse(String(raw)); } catch { return; }
    const event = String(message.event || "");
    if (event === "registerPlugin") {
      socket.meta = { kind: "plugin", uuid: String(message.uuid || "") };
      this.pluginSockets.set(socket.meta.uuid, socket);
      return;
    }
    if (event === "registerPropertyInspector") {
      const contextId = String(message.uuid || "");
      socket.meta = { kind: "pi", uuid: contextId };
      this.piSockets.set(contextId, socket);
      const ctx = this.contexts.get(contextId);
      if (ctx) {
        this.sendSettingsTo(socket, ctx);
        const pluginSocket = this.pluginSockets.get(ctx.pluginId);
        this.send(pluginSocket, { event: "propertyInspectorDidAppear", action: ctx.actionId, context: ctx.contextId, device: "batto-virtual-deck" });
      }
      return;
    }

    const contextId = String(message.context || socket.meta?.uuid || "");
    const ctx = this.contexts.get(contextId);
    if (!ctx) {
      if (event === "getGlobalSettings" && socket.meta?.kind === "plugin") {
        const pluginId = socket.meta.uuid;
        const state = this.pluginRegistry.snapshot().plugins.find((entry) => entry.id === pluginId)?.settings || {};
        this.send(socket, { event: "didReceiveGlobalSettings", context: pluginId, payload: { settings: state } });
      }
      return;
    }

    if (event === "getSettings") return this.sendSettingsTo(socket, ctx);
    if (event === "setSettings") {
      this.persistPluginSettings(ctx.deckContext, message.payload || {});
      const pi = this.piSockets.get(ctx.contextId);
      this.sendSettingsTo(pi, ctx);
      return;
    }
    if (event === "setGlobalSettings") {
      this.pluginRegistry.saveSettings(ctx.pluginId, message.payload || {});
      this.scheduleState();
      return;
    }
    if (event === "getGlobalSettings") {
      const settings = this.pluginRegistry.snapshot().plugins.find((entry) => entry.id === ctx.pluginId)?.settings || {};
      return this.send(socket, { event: "didReceiveGlobalSettings", context: ctx.pluginId, payload: { settings } });
    }
    if (event === "sendToPlugin") {
      const pluginSocket = this.pluginSockets.get(ctx.pluginId);
      return this.send(pluginSocket, { event: "sendToPlugin", action: ctx.actionId, context: ctx.contextId, payload: message.payload || {} });
    }
    if (event === "sendToPropertyInspector") {
      const pi = this.piSockets.get(ctx.contextId);
      return this.send(pi, { event: "sendToPropertyInspector", action: ctx.actionId, context: ctx.contextId, payload: message.payload || {} });
    }
    if (event === "setTitle") return this.persistTitle(ctx.deckContext, message.payload?.title || "");
    if (event === "setImage") return this.persistImage(ctx.deckContext, message.payload?.image || "");
    if (event === "openUrl") {
      const url = String(message.payload?.url || "");
      if (/^https?:\/\//i.test(url)) void this.shell.openExternal(url);
      return;
    }
  }

  onClose(socket) {
    if (!this.sockets.has(socket)) return;
    this.sockets.delete(socket);
    if (socket.meta?.kind === "plugin" && this.pluginSockets.get(socket.meta.uuid) === socket) this.pluginSockets.delete(socket.meta.uuid);
    if (socket.meta?.kind === "pi" && this.piSockets.get(socket.meta.uuid) === socket) this.piSockets.delete(socket.meta.uuid);
  }

  async stop() {
    for (const win of this.windows.values()) try { if (!win.isDestroyed()) win.close(); } catch {}
    this.windows.clear();
    for (const proc of this.pluginProcesses.values()) try { proc.kill(); } catch {}
    this.pluginProcesses.clear();
    for (const socket of this.sockets) try { socket.close(); } catch {}
    this.sockets.clear();
    this.pluginSockets.clear();
    this.piSockets.clear();
    this.contexts.clear();
    if (this.wss) try { this.wss.close(); } catch {}
    if (this.server) await new Promise((resolve) => this.server.close(() => resolve())).catch(() => {});
    this.wss = null; this.server = null; this.port = 0;
  }
}

module.exports = { StreamDeckRuntime };
