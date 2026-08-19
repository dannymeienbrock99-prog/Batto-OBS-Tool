"use strict";

const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { WebSocket, WebSocketServer } = require("ws");
const { readJson, safeText, writeJsonAtomic } = require("./common.cjs");

const DEVICE_ID = "batto-touch-monitor";
const VIRTUAL_DEVICE_TYPE = 11;
const REGISTER_EVENT = "registerPlugin";
const PROPERTY_INSPECTOR_REGISTER_EVENT = "registerPropertyInspector";
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function normalizedDeviceSize(value = {}) {
  return {
    columns: Math.max(1, Math.min(10, Math.round(Number(value.columns) || 5))),
    rows: Math.max(1, Math.min(10, Math.round(Number(value.rows) || 3)))
  };
}

function deviceInfo(size) {
  return { name: "Batto Touch Monitor", size: normalizedDeviceSize(size), type: VIRTUAL_DEVICE_TYPE };
}

function contextId(pluginId, actionId, context = {}) {
  const key = [pluginId, actionId, context.profileId || "default", context.folderId || "root", Number(context.buttonIndex) || 0].join(":");
  return `batto-${crypto.createHash("sha256").update(key).digest("hex").slice(0, 32)}`;
}

function coordinates(context = {}) {
  const index = Math.max(0, Number(context.buttonIndex) || 0);
  const columns = Math.max(1, Number(context.columns) || 5);
  return { column: index % columns, row: Math.floor(index / columns) };
}

function jsonObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function resourceMap(value) {
  const result = {};
  for (const [rawKey, rawPath] of Object.entries(jsonObject(value))) {
    if (typeof rawPath !== "string") continue;
    const key = safeText(rawKey, 240);
    if (!key) continue;
    Object.defineProperty(result, key, { configurable: true, enumerable: true, value: safeText(rawPath, 32768), writable: true });
  }
  return result;
}

function actionPayload(context = {}, settings = {}, resources = {}) {
  const isInMultiAction = Boolean(context.multiAction);
  const payload = {
    controller: "Keypad",
    isInMultiAction,
    resources: resourceMap(resources),
    settings: jsonObject(settings)
  };
  if (!isInMultiAction) payload.coordinates = coordinates(context);
  if (context.state !== undefined && context.state !== null && Number.isFinite(Number(context.state))) {
    payload.state = Math.max(0, Math.round(Number(context.state)));
  }
  return payload;
}

function pluginInfo(plugin, size = { columns: 5, rows: 3 }) {
  return {
    application: {
      font: "Arial",
      language: "de",
      platform: "windows",
      platformVersion: os.release(),
      version: "7.1.0"
    },
    colors: {
      buttonMouseOverBackgroundColor: "#1d2b3c",
      buttonPressedBackgroundColor: "#26344d",
      buttonPressedBorderColor: "#34d6ff",
      buttonPressedTextColor: "#ffffff",
      highlightColor: "#34d6ff"
    },
    devicePixelRatio: 1,
    devices: [{ id: DEVICE_ID, ...deviceInfo(size) }],
    plugin: { uuid: plugin.id, version: plugin.version || "0.0.0" }
  };
}

class StreamDeckPluginHost extends EventEmitter {
  constructor({ registry, stateFile, shell, registrationTimeoutMs = 8000, idleTimeoutMs = 120000 } = {}) {
    super();
    this.registry = registry;
    this.stateFile = stateFile || path.join(process.cwd(), "stream-deck-plugin-host.json");
    this.shell = shell;
    this.registrationTimeoutMs = registrationTimeoutMs;
    this.idleTimeoutMs = Math.max(15000, Math.min(30 * 60 * 1000, Number(idleTimeoutMs) || 120000));
    this.state = readJson(this.stateFile, { contexts: {}, global: {}, resources: {}, feedback: {} }) || { contexts: {}, global: {}, resources: {}, feedback: {} };
    this.state.contexts ||= {};
    this.state.global ||= {};
    this.state.resources ||= {};
    for (const [context, resources] of Object.entries(this.state.resources)) this.state.resources[context] = resourceMap(resources);
    this.state.feedback ||= {};
    this.server = null;
    this.sessions = new Map();
    this.socketSessions = new WeakMap();
    this.inspectorSockets = new WeakMap();
    this.pendingByUuid = new Map();
    this.pendingPropertyInspectors = new Map();
    this.propertyInspectors = new Map();
    this.visibleContexts = new Map();
    this.deviceSize = normalizedDeviceSize();
    this.persistTimer = null;
  }

  async start() {
    if (this.server) return this.status();
    this.server = new WebSocketServer({ host: "127.0.0.1", port: 0, maxPayload: 4 * 1024 * 1024 });
    this.server.on("connection", (socket) => this.handleConnection(socket));
    this.server.on("error", (error) => this.emit("host-error", error));
    await new Promise((resolve, reject) => {
      this.server.once("listening", resolve);
      this.server.once("error", reject);
    });
    this.emit("changed", this.status());
    return this.status();
  }

  port() {
    const address = this.server?.address?.();
    return typeof address === "object" && address ? address.port : 0;
  }

  status() {
    return {
      active: Boolean(this.server),
      port: this.port(),
      device: { id: DEVICE_ID, ...deviceInfo(this.deviceSize) },
      sessions: [...this.sessions.values()].map((session) => ({
        pluginId: session.plugin.id,
        connected: session.socket?.readyState === WebSocket.OPEN,
        pid: session.child?.pid || null,
        error: session.error || ""
      })),
      propertyInspectors: [...this.propertyInspectors.values()].map((inspector) => ({
        id: inspector.id,
        pluginId: inspector.plugin.id,
        actionId: inspector.actionId,
        connected: inspector.socket?.readyState === WebSocket.OPEN,
        error: inspector.error || ""
      })),
      feedback: { ...this.state.feedback }
    };
  }

  handleConnection(socket) {
    socket.on("message", (data) => this.handleMessage(socket, data));
    socket.on("error", (error) => {
      const inspector = this.inspectorSockets.get(socket);
      if (inspector) inspector.error = safeText(error?.message || error, 500);
      const session = this.socketSessions.get(socket);
      if (session) session.error = safeText(error?.message || error, 500);
    });
    socket.on("close", () => {
      const inspector = this.inspectorSockets.get(socket);
      if (inspector?.socket === socket) {
        inspector.socket = null;
        this.inspectorSockets.delete(socket);
        this.emit("changed", this.status());
      }
      const session = this.socketSessions.get(socket);
      if (session?.socket === socket) {
        session.socket = null;
        const key = session.plugin.id.toLowerCase();
        if (this.sessions.get(key) === session) this.stopSession(key, "Plugin-WebSocket wurde getrennt");
      }
    });
  }

  handleMessage(socket, raw) {
    let message;
    try { message = JSON.parse(String(raw)); }
    catch { return; }
    if (message?.event === PROPERTY_INSPECTOR_REGISTER_EVENT && message.uuid) {
      const id = String(message.uuid);
      const inspector = this.pendingPropertyInspectors.get(id) || this.propertyInspectors.get(id);
      if (!inspector) {
        socket.close(1008, "Unbekannter Property Inspector");
        return;
      }
      const firstRegistration = this.pendingPropertyInspectors.has(id);
      if (inspector.socket && inspector.socket !== socket) {
        this.inspectorSockets.delete(inspector.socket);
        try { inspector.socket.close(1000, "Property Inspector wurde neu geladen"); } catch {}
      }
      inspector.socket = socket;
      inspector.error = "";
      this.inspectorSockets.set(socket, inspector);
      this.pendingPropertyInspectors.delete(inspector.id);
      this.propertyInspectors.set(inspector.id, inspector);
      if (firstRegistration) {
        try {
          this.send(inspector.session, {
            action: inspector.actionId,
            event: "propertyInspectorDidAppear",
            context: inspector.context,
            device: DEVICE_ID
          });
        } catch (error) {
          inspector.error = safeText(error?.message || error, 500);
        }
      }
      this.emit("changed", this.status());
      return;
    }
    if (message?.event === REGISTER_EVENT && message.uuid) {
      const session = this.pendingByUuid.get(String(message.uuid).toLowerCase());
      if (!session) {
        socket.close(1008, "Unbekanntes Plugin");
        return;
      }
      session.socket = socket;
      session.error = "";
      this.socketSessions.set(socket, session);
      this.pendingByUuid.delete(session.plugin.id.toLowerCase());
      this.send(session, {
        event: "deviceDidConnect",
        device: DEVICE_ID,
        deviceInfo: deviceInfo(this.deviceSize)
      });
      session.resolveReady?.(session);
      this.emit("changed", this.status());
      return;
    }
    const inspector = this.inspectorSockets.get(socket);
    if (inspector) {
      this.handlePropertyInspectorCommand(inspector, message).catch((error) => {
        inspector.error = safeText(error?.message || error, 500);
        this.emit("plugin-error", { pluginId: inspector.plugin.id, error: inspector.error });
      });
      return;
    }
    const session = this.socketSessions.get(socket);
    if (!session) return;
    this.handlePluginCommand(session, message).catch((error) => {
      session.error = safeText(error?.message || error, 500);
      this.emit("plugin-error", { pluginId: session.plugin.id, error: session.error });
      this.emit("changed", this.status());
    });
  }

  send(session, message) {
    if (session?.socket?.readyState !== WebSocket.OPEN) throw new Error(`Plugin „${session?.plugin?.name || "unbekannt"}“ ist nicht verbunden.`);
    session.socket.send(JSON.stringify(message));
  }

  persist() {
    writeJsonAtomic(this.stateFile, this.state);
  }

  schedulePersist() {
    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persist();
    }, 250);
    this.persistTimer.unref?.();
  }

  updateDeviceSize(context = {}) {
    const next = normalizedDeviceSize({
      columns: context.columns || this.deviceSize.columns,
      rows: context.rows || this.deviceSize.rows
    });
    if (next.columns === this.deviceSize.columns && next.rows === this.deviceSize.rows) return;
    this.deviceSize = next;
    for (const session of this.sessions.values()) {
      if (session.socket?.readyState !== WebSocket.OPEN) continue;
      try { this.send(session, { event: "deviceDidChange", device: DEVICE_ID, deviceInfo: deviceInfo(this.deviceSize) }); } catch {}
    }
    this.emit("changed", this.status());
  }

  updateFeedback(context, patch) {
    if (!context) return;
    const previous = this.state.feedback[context] || {};
    const unchanged = Object.entries(patch).every(([key, value]) => JSON.stringify(previous[key]) === JSON.stringify(value));
    if (unchanged) return;
    this.state.feedback[context] = {
      ...previous,
      ...patch,
      updatedAt: Date.now()
    };
    this.schedulePersist();
    this.emit("feedback", { context, ...this.state.feedback[context] });
  }

  notifyPropertyInspectors(session, context, createMessage) {
    for (const inspector of this.propertyInspectors.values()) {
      if (inspector.session !== session || (context && inspector.context !== context) || inspector.socket?.readyState !== WebSocket.OPEN) continue;
      try { inspector.socket.send(JSON.stringify(createMessage(inspector))); }
      catch (error) { inspector.error = safeText(error?.message || error, 500); }
    }
  }

  contextDataFor(session, context) {
    const visible = this.visibleContexts.get(context)?.contextData;
    if (visible) return visible;
    for (const inspector of [...this.propertyInspectors.values(), ...this.pendingPropertyInspectors.values()]) {
      if (inspector.session === session && inspector.context === context) return inspector.contextData || {};
    }
    return {};
  }

  async handlePluginCommand(session, message = {}) {
    const context = safeText(message.context || session.plugin.id, 240);
    const payload = jsonObject(message.payload);
    switch (message.event) {
      case "setSettings": {
        this.state.contexts[context] = payload;
        this.persist();
        this.notifyPropertyInspectors(session, context, (inspector) => ({
          action: inspector.actionId,
          event: "didReceiveSettings",
          context,
          device: DEVICE_ID,
          payload: actionPayload(inspector.contextData, payload, this.state.resources[context])
        }));
        break;
      }
      case "getSettings": {
        const contextData = this.contextDataFor(session, context);
        this.send(session, {
          action: message.action,
          event: "didReceiveSettings",
          context,
          device: DEVICE_ID,
          id: message.id,
          payload: actionPayload(contextData, this.state.contexts[context], this.state.resources[context])
        });
        break;
      }
      case "setResources": {
        const resources = resourceMap(message.payload);
        this.state.resources[context] = resources;
        this.persist();
        this.notifyPropertyInspectors(session, context, (inspector) => ({
          action: inspector.actionId,
          event: "didReceiveResources",
          context,
          device: DEVICE_ID,
          payload: actionPayload(inspector.contextData, this.state.contexts[context], resources)
        }));
        break;
      }
      case "getResources": {
        const contextData = this.contextDataFor(session, context);
        this.send(session, {
          action: message.action,
          event: "didReceiveResources",
          context,
          device: DEVICE_ID,
          id: message.id,
          payload: actionPayload(contextData, this.state.contexts[context], this.state.resources[context])
        });
        break;
      }
      case "getSecrets":
        this.send(session, { event: "didReceiveSecrets", payload: { secrets: {} } });
        break;
      case "setGlobalSettings":
        this.state.global[session.plugin.id] = payload;
        this.persist();
        this.notifyPropertyInspectors(session, null, () => ({ event: "didReceiveGlobalSettings", payload: { settings: payload } }));
        break;
      case "getGlobalSettings":
        this.send(session, { event: "didReceiveGlobalSettings", context: session.plugin.id, id: message.id, payload: { settings: this.state.global[session.plugin.id] || {} } });
        break;
      case "setTitle":
        this.updateFeedback(context, { title: safeText(payload.title, 200), target: payload.target ?? 0 });
        break;
      case "setImage":
        this.updateFeedback(context, { image: safeText(payload.image, 2_000_000), target: payload.target ?? 0 });
        break;
      case "setState":
        this.updateFeedback(context, { state: Math.max(0, Number(payload.state) || 0) });
        break;
      case "showOk":
        this.updateFeedback(context, { result: "ok" });
        break;
      case "showAlert":
        this.updateFeedback(context, { result: "alert" });
        break;
      case "setFeedback":
      case "setFeedbackLayout":
        this.updateFeedback(context, { [message.event === "setFeedback" ? "feedback" : "feedbackLayout"]: payload });
        break;
      case "setTriggerDescription":
        this.updateFeedback(context, { triggerDescription: payload });
        break;
      case "openUrl": {
        const url = new URL(String(payload.url || ""));
        if (!/^https?:$/.test(url.protocol)) throw new Error("Ein Plugin wollte eine nicht erlaubte Adresse öffnen.");
        await this.shell?.openExternal?.(url.toString());
        break;
      }
      case "logMessage":
        this.emit("plugin-log", { pluginId: session.plugin.id, message: safeText(payload.message, 2000) });
        break;
      case "sendToPropertyInspector":
        for (const inspector of this.propertyInspectors.values()) {
          if (inspector.context !== context || inspector.socket?.readyState !== WebSocket.OPEN) continue;
          inspector.socket.send(JSON.stringify({ action: message.action, event: "sendToPropertyInspector", context, payload }));
        }
        this.emit("property-inspector-message", { pluginId: session.plugin.id, action: message.action, context, payload });
        break;
      default:
        this.emit("plugin-command", { pluginId: session.plugin.id, message });
    }
  }

  async handlePropertyInspectorCommand(inspector, message = {}) {
    const context = inspector.context;
    const action = inspector.actionId;
    const payload = jsonObject(message.payload);
    switch (message.event) {
      case "setSettings":
        this.state.contexts[context] = payload;
        this.persist();
        this.send(inspector.session, {
          action,
          event: "didReceiveSettings",
          context,
          device: DEVICE_ID,
          payload: actionPayload(inspector.contextData, payload, this.state.resources[context])
        });
        break;
      case "getSettings":
        inspector.socket.send(JSON.stringify({
          action,
          event: "didReceiveSettings",
          context,
          device: DEVICE_ID,
          id: message.id,
          payload: actionPayload(inspector.contextData, this.state.contexts[context], this.state.resources[context])
        }));
        break;
      case "setResources": {
        const resources = resourceMap(message.payload);
        this.state.resources[context] = resources;
        this.persist();
        this.send(inspector.session, {
          action,
          event: "didReceiveResources",
          context,
          device: DEVICE_ID,
          payload: actionPayload(inspector.contextData, this.state.contexts[context], resources)
        });
        break;
      }
      case "getResources":
        inspector.socket.send(JSON.stringify({
          action,
          event: "didReceiveResources",
          context,
          device: DEVICE_ID,
          id: message.id,
          payload: actionPayload(inspector.contextData, this.state.contexts[context], this.state.resources[context])
        }));
        break;
      case "getSecrets":
        inspector.socket.send(JSON.stringify({ event: "didReceiveSecrets", payload: { secrets: {} } }));
        break;
      case "setGlobalSettings":
        this.state.global[inspector.plugin.id] = payload;
        this.persist();
        this.send(inspector.session, { event: "didReceiveGlobalSettings", context: inspector.plugin.id, payload: { settings: payload } });
        break;
      case "getGlobalSettings":
        inspector.socket.send(JSON.stringify({ event: "didReceiveGlobalSettings", context: inspector.plugin.id, id: message.id, payload: { settings: this.state.global[inspector.plugin.id] || {} } }));
        break;
      case "sendToPlugin":
        this.send(inspector.session, { action, event: "sendToPlugin", context, payload });
        break;
      case "openUrl": {
        const url = new URL(String(payload.url || ""));
        if (!/^https?:$/.test(url.protocol)) throw new Error("Der Property Inspector wollte eine nicht erlaubte Adresse öffnen.");
        await this.shell?.openExternal?.(url.toString());
        break;
      }
      case "logMessage":
        this.emit("plugin-log", { pluginId: inspector.plugin.id, message: safeText(payload.message, 2000) });
        break;
      default:
        this.emit("property-inspector-command", { pluginId: inspector.plugin.id, message });
    }
  }

  async createPropertyInspector(action = {}, context = {}) {
    const actionId = safeText(action.type || action.action, 200);
    const preferredPlugin = action.pluginId ? this.registry?.findPlugin?.(action.pluginId) : null;
    const plugin = preferredPlugin && !preferredPlugin.native
      && preferredPlugin.actions?.some((entry) => entry.id.toLowerCase() === actionId.toLowerCase())
      ? preferredPlugin
      : this.registry?.findPluginForAction?.(actionId);
    if (!plugin) throw new Error(`Für „${actionId}“ wurde kein originales Stream-Deck-Plugin gefunden.`);
    const declaredAction = plugin.actions?.find((entry) => entry.id.toLowerCase() === actionId.toLowerCase());
    const relative = safeText(declaredAction?.propertyInspectorPath || plugin.propertyInspectorPath || "", 1000);
    if (!relative) throw new Error(`„${declaredAction?.name || actionId}“ besitzt keinen Property Inspector.`);
    if (![".htm", ".html"].includes(path.extname(relative).toLowerCase())) throw new Error("Property-Inspector-Datei muss eine HTML-Datei sein.");
    let filePath;
    try {
      const declaredPath = path.resolve(plugin.root, relative);
      const realRoot = fs.realpathSync(plugin.root);
      const realFile = fs.realpathSync(declaredPath);
      if (!realFile.startsWith(`${realRoot}${path.sep}`) || !fs.statSync(realFile).isFile()) throw new Error("unsafe");
      filePath = realFile;
    } catch {
      throw new Error("Property-Inspector-Datei fehlt oder liegt außerhalb des Plugin-Ordners.");
    }
    const session = await this.ensureSession(plugin, context);
    const id = `pi-${crypto.randomBytes(16).toString("hex")}`;
    const actionContext = contextId(plugin.id, actionId, context);
    this.state.contexts[actionContext] = { ...(this.state.contexts[actionContext] || {}), ...(action.settings || {}) };
    this.persist();
    if (!this.visibleContexts.has(actionContext)) {
      this.send(session, {
        event: "willAppear",
        action: actionId,
        context: actionContext,
        device: DEVICE_ID,
        payload: actionPayload(context, this.state.contexts[actionContext], this.state.resources[actionContext])
      });
      this.visibleContexts.set(actionContext, { pluginId: plugin.id, actionId, contextData: { ...context } });
    }
    const inspector = {
      id,
      plugin,
      session,
      actionId,
      context: actionContext,
      contextData: { ...context },
      filePath,
      socket: null,
      error: ""
    };
    this.pendingPropertyInspectors.set(id, inspector);
    return {
      id,
      port: this.port(),
      filePath,
      context: actionContext,
      registerEvent: PROPERTY_INSPECTOR_REGISTER_EVENT,
      info: JSON.stringify(pluginInfo(plugin, this.deviceSize)),
      actionInfo: JSON.stringify({
        action: actionId,
        context: actionContext,
        device: DEVICE_ID,
        payload: actionPayload(context, this.state.contexts[actionContext], this.state.resources[actionContext])
      })
    };
  }

  closePropertyInspector(id, closeSocket = true) {
    const inspector = this.propertyInspectors.get(String(id)) || this.pendingPropertyInspectors.get(String(id));
    if (!inspector) return null;
    const settings = { ...(this.state.contexts[inspector.context] || {}) };
    this.propertyInspectors.delete(inspector.id);
    this.pendingPropertyInspectors.delete(inspector.id);
    if (inspector.socket) this.inspectorSockets.delete(inspector.socket);
    try {
      this.send(inspector.session, {
        action: inspector.actionId,
        event: "propertyInspectorDidDisappear",
        context: inspector.context,
        device: DEVICE_ID
      });
    } catch {}
    if (closeSocket) try { inspector.socket?.close(1000, "Eigenschaften geschlossen"); } catch {}
    this.scheduleSessionIdle(inspector.session);
    this.emit("changed", this.status());
    return settings;
  }

  clearSessionIdle(session) {
    clearTimeout(session?.idleTimer);
    if (session) session.idleTimer = null;
  }

  scheduleSessionIdle(session) {
    this.clearSessionIdle(session);
    session.lastUsedAt = Date.now();
    session.idleTimer = setTimeout(() => {
      const key = session.plugin.id.toLowerCase();
      if (this.sessions.get(key) === session) this.stopSession(key, "Plugin wegen Inaktivität beendet");
    }, this.idleTimeoutMs);
    session.idleTimer.unref?.();
  }

  stopSession(key, reason = "Plugin-Sitzung beendet", emitChange = true) {
    const normalizedKey = String(key || "").toLowerCase();
    const session = this.sessions.get(normalizedKey);
    if (!session) return;
    for (const inspector of [...this.propertyInspectors.values(), ...this.pendingPropertyInspectors.values()]) {
      if (inspector.session === session) this.closePropertyInspector(inspector.id);
    }
    this.clearSessionIdle(session);
    for (const [context, meta] of this.visibleContexts) {
      if (meta.pluginId.toLowerCase() !== normalizedKey) continue;
      const contextData = meta.contextData || {};
      try {
        this.send(session, {
          event: "willDisappear",
          action: meta.actionId,
          context,
          device: DEVICE_ID,
          payload: actionPayload(contextData, this.state.contexts[context], this.state.resources[context])
        });
      } catch {}
      this.visibleContexts.delete(context);
    }
    try { this.send(session, { event: "deviceDidDisconnect", device: DEVICE_ID }); } catch {}
    try { session.socket?.close(1001, reason); session.socket?.terminate?.(); } catch {}
    try { session.child?.kill(); } catch {}
    this.sessions.delete(normalizedKey);
    this.pendingByUuid.delete(normalizedKey);
    if (emitChange) this.emit("changed", this.status());
  }

  async ensureSession(plugin, context = {}) {
    this.updateDeviceSize(context);
    const key = plugin.id.toLowerCase();
    const existing = this.sessions.get(key);
    if (existing?.socket?.readyState === WebSocket.OPEN) {
      this.clearSessionIdle(existing);
      return existing;
    }
    if (existing?.readyPromise) return existing.readyPromise;
    if (existing) this.stopSession(key, "Veraltete Plugin-Sitzung ersetzt", false);
    if (plugin.runtime?.status !== "ready" || !plugin.executableExists) {
      throw new Error(`Die Laufzeit von „${plugin.name}“ fehlt, ist inkompatibel oder durch die Elgato-Marketplace-Installation geschützt.`);
    }
    if (!plugin.enabled) throw new Error(`Plugin „${plugin.name}“ ist deaktiviert.`);
    await this.start();

    const session = { plugin, child: null, socket: null, error: "", resolveReady: null, rejectReady: null, readyPromise: null, idleTimer: null, lastUsedAt: Date.now() };
    session.readyPromise = new Promise((resolve, reject) => {
      session.resolveReady = resolve;
      session.rejectReady = reject;
    });
    this.sessions.set(key, session);
    this.pendingByUuid.set(key, session);

    const registrationArgs = [
      "-port", String(this.port()),
      "-pluginUUID", plugin.id,
      "-registerEvent", REGISTER_EVENT,
      "-info", JSON.stringify(pluginInfo(plugin, this.deviceSize))
    ];
    let executable = plugin.executablePath;
    let args = registrationArgs;
    const environment = { ...process.env };
    if (plugin.runtime.kind === "node") {
      executable = process.execPath;
      args = ["--enable-source-maps", "--no-global-search-paths", plugin.executablePath, ...registrationArgs];
      if (process.versions.electron) environment.ELECTRON_RUN_AS_NODE = "1";
    } else if (plugin.runtime.kind !== "native") {
      throw new Error(`Die Laufzeitart „${plugin.runtime.kind}“ von „${plugin.name}“ wird nicht unterstützt.`);
    }

    try {
      session.child = childProcess.spawn(executable, args, {
        cwd: plugin.root,
        env: environment,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (error) {
      this.pendingByUuid.delete(key);
      this.sessions.delete(key);
      throw new Error(`Plugin „${plugin.name}“ konnte nicht gestartet werden: ${error?.message || error}`);
    }

    const capture = (stream, level) => stream?.on("data", (data) => this.emit("plugin-log", {
      pluginId: plugin.id,
      level,
      message: safeText(String(data).trim(), 4000)
    }));
    capture(session.child.stdout, "info");
    capture(session.child.stderr, "error");
    session.child.once("error", (error) => session.rejectReady?.(new Error(`Plugin „${plugin.name}“ konnte nicht gestartet werden: ${error.message}`)));
    session.child.once("exit", (code, signal) => {
      if (!session.socket) session.rejectReady?.(new Error(`Plugin „${plugin.name}“ wurde vor der WebSocket-Anmeldung beendet (${code ?? signal ?? "unbekannt"}).`));
      this.clearSessionIdle(session);
      session.child = null;
      session.socket = null;
      session.readyPromise = null;
      this.pendingByUuid.delete(key);
      if (this.sessions.get(key) === session) this.sessions.delete(key);
      this.emit("changed", this.status());
    });

    const timer = setTimeout(() => session.rejectReady?.(new Error(`Plugin „${plugin.name}“ hat sich nicht innerhalb von ${Math.round(this.registrationTimeoutMs / 1000)} Sekunden angemeldet.`)), this.registrationTimeoutMs);
    try {
      await session.readyPromise;
      return session;
    } catch (error) {
      try { session.child?.kill(); } catch {}
      this.sessions.delete(key);
      this.pendingByUuid.delete(key);
      throw error;
    } finally {
      clearTimeout(timer);
      session.readyPromise = null;
      session.resolveReady = null;
      session.rejectReady = null;
    }
  }

  async execute(action = {}, context = {}) {
    const actionId = safeText(action.type || action.action, 200);
    const preferredPlugin = action.pluginId ? this.registry?.findPlugin?.(action.pluginId) : null;
    const plugin = preferredPlugin && !preferredPlugin.native
      && preferredPlugin.actions?.some((entry) => entry.id.toLowerCase() === actionId.toLowerCase())
      ? preferredPlugin
      : this.registry?.findPluginForAction?.(actionId);
    if (!plugin) throw new Error(`Für die originale Stream-Deck-Aktion „${actionId}“ wurde kein ausführbares Plugin gefunden.`);
    const declaredAction = plugin.actions?.find((entry) => entry.id.toLowerCase() === actionId.toLowerCase());
    if (declaredAction?.raw?.supportedInTouchDeck === false) throw new Error(`Aktion „${declaredAction.name}“ unterstützt keine Keypad-/Touch-Taste.`);
    const session = await this.ensureSession(plugin, context);
    const id = contextId(plugin.id, actionId, context);
    const configured = action.settings && typeof action.settings === "object" ? action.settings : {};
    const settings = { ...(this.state.contexts[id] || {}), ...configured };
    this.state.contexts[id] = settings;
    this.persist();
    const payload = actionPayload(context, settings, this.state.resources[id]);
    const keyPayload = context.multiAction
      ? { ...payload, userDesiredState: Math.max(0, Math.round(Number(context.userDesiredState) || 0)) }
      : payload;
    try {
      if (!this.visibleContexts.has(id)) {
        this.send(session, { event: "willAppear", action: actionId, context: id, device: DEVICE_ID, payload });
        this.visibleContexts.set(id, { pluginId: plugin.id, actionId, contextData: { ...context } });
      }
      this.send(session, { event: "keyDown", action: actionId, context: id, device: DEVICE_ID, payload: keyPayload });
      await wait(45);
      this.send(session, { event: "keyUp", action: actionId, context: id, device: DEVICE_ID, payload: keyPayload });
      await wait(80);
      return { dispatched: true, pluginId: plugin.id, context: id, feedback: this.state.feedback[id] || null };
    } finally {
      this.scheduleSessionIdle(session);
    }
  }

  async stop() {
    for (const inspector of [...this.propertyInspectors.values(), ...this.pendingPropertyInspectors.values()]) this.closePropertyInspector(inspector.id);
    for (const key of [...this.sessions.keys()]) this.stopSession(key, "Batto OBS Tool wird beendet", false);
    clearTimeout(this.persistTimer);
    this.persistTimer = null;
    this.persist();
    const server = this.server;
    this.server = null;
    if (server) await new Promise((resolve) => server.close(() => resolve()));
    this.emit("changed", this.status());
  }
}

module.exports = {
  DEVICE_ID,
  PROPERTY_INSPECTOR_REGISTER_EVENT,
  StreamDeckPluginHost,
  actionPayload,
  contextId,
  coordinates,
  deviceInfo,
  normalizedDeviceSize,
  pluginInfo,
  resourceMap
};
