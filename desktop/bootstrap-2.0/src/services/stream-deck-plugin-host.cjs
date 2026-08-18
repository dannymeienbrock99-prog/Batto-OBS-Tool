"use strict";

const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { WebSocket, WebSocketServer } = require("ws");
const { readJson, safeText, writeJsonAtomic } = require("./common.cjs");

const DEVICE_ID = "batto-touch-monitor";
const REGISTER_EVENT = "registerPlugin";
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function contextId(pluginId, actionId, context = {}) {
  const key = [pluginId, actionId, context.profileId || "default", context.folderId || "root", Number(context.buttonIndex) || 0].join(":");
  return `batto-${crypto.createHash("sha256").update(key).digest("hex").slice(0, 32)}`;
}

function coordinates(context = {}) {
  const index = Math.max(0, Number(context.buttonIndex) || 0);
  const columns = Math.max(1, Number(context.columns) || 5);
  return { column: index % columns, row: Math.floor(index / columns) };
}

function pluginInfo(plugin) {
  return {
    application: {
      font: "Arial",
      language: "de",
      platform: "windows",
      platformVersion: os.release(),
      version: "2.0.0"
    },
    colors: {
      buttonPressedBackgroundColor: "#26344d",
      buttonPressedBorderColor: "#34d6ff",
      buttonPressedTextColor: "#ffffff",
      highlightColor: "#34d6ff"
    },
    devicePixelRatio: 1,
    devices: [{ id: DEVICE_ID, name: "Batto Touch Monitor", size: { columns: 8, rows: 4 }, type: 0 }],
    plugin: { uuid: plugin.id, version: plugin.version || "0.0.0" }
  };
}

class StreamDeckPluginHost extends EventEmitter {
  constructor({ registry, stateFile, shell, registrationTimeoutMs = 8000 } = {}) {
    super();
    this.registry = registry;
    this.stateFile = stateFile || path.join(process.cwd(), "stream-deck-plugin-host.json");
    this.shell = shell;
    this.registrationTimeoutMs = registrationTimeoutMs;
    this.state = readJson(this.stateFile, { contexts: {}, global: {}, feedback: {} }) || { contexts: {}, global: {}, feedback: {} };
    this.state.contexts ||= {};
    this.state.global ||= {};
    this.state.feedback ||= {};
    this.server = null;
    this.sessions = new Map();
    this.socketSessions = new WeakMap();
    this.pendingByUuid = new Map();
    this.visibleContexts = new Map();
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
      sessions: [...this.sessions.values()].map((session) => ({
        pluginId: session.plugin.id,
        connected: session.socket?.readyState === WebSocket.OPEN,
        pid: session.child?.pid || null,
        error: session.error || ""
      })),
      feedback: { ...this.state.feedback }
    };
  }

  handleConnection(socket) {
    socket.on("message", (data) => this.handleMessage(socket, data));
    socket.on("error", (error) => {
      const session = this.socketSessions.get(socket);
      if (session) session.error = safeText(error?.message || error, 500);
    });
    socket.on("close", () => {
      const session = this.socketSessions.get(socket);
      if (session?.socket === socket) {
        session.socket = null;
        this.emit("changed", this.status());
      }
    });
  }

  handleMessage(socket, raw) {
    let message;
    try { message = JSON.parse(String(raw)); }
    catch { return; }
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
        deviceInfo: { name: "Batto Touch Monitor", size: { columns: 8, rows: 4 }, type: 0 }
      });
      session.resolveReady?.(session);
      this.emit("changed", this.status());
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

  updateFeedback(context, patch) {
    if (!context) return;
    this.state.feedback[context] = {
      ...(this.state.feedback[context] || {}),
      ...patch,
      updatedAt: Date.now()
    };
    this.persist();
    this.emit("feedback", { context, ...this.state.feedback[context] });
    this.emit("changed", this.status());
  }

  async handlePluginCommand(session, message = {}) {
    const context = safeText(message.context || session.plugin.id, 240);
    const payload = message.payload && typeof message.payload === "object" ? message.payload : {};
    switch (message.event) {
      case "setSettings":
        this.state.contexts[context] = payload;
        this.persist();
        break;
      case "getSettings":
        this.send(session, {
          action: message.action,
          event: "didReceiveSettings",
          context,
          device: message.device || DEVICE_ID,
          payload: { settings: this.state.contexts[context] || {}, coordinates: { column: 0, row: 0 }, isInMultiAction: false }
        });
        break;
      case "setGlobalSettings":
        this.state.global[session.plugin.id] = payload;
        this.persist();
        break;
      case "getGlobalSettings":
        this.send(session, { event: "didReceiveGlobalSettings", context: session.plugin.id, payload: { settings: this.state.global[session.plugin.id] || {} } });
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
        this.emit("property-inspector-message", { pluginId: session.plugin.id, action: message.action, context, payload });
        break;
      default:
        this.emit("plugin-command", { pluginId: session.plugin.id, message });
    }
  }

  async ensureSession(plugin) {
    const key = plugin.id.toLowerCase();
    const existing = this.sessions.get(key);
    if (existing?.socket?.readyState === WebSocket.OPEN) return existing;
    if (existing?.readyPromise) return existing.readyPromise;
    if (plugin.runtime?.status !== "ready" || !plugin.executableExists) {
      throw new Error(`Die Laufzeit von „${plugin.name}“ fehlt, ist inkompatibel oder durch die Elgato-Marketplace-Installation geschützt.`);
    }
    if (!plugin.enabled) throw new Error(`Plugin „${plugin.name}“ ist deaktiviert.`);
    await this.start();

    const session = { plugin, child: null, socket: null, error: "", resolveReady: null, rejectReady: null, readyPromise: null };
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
      "-info", JSON.stringify(pluginInfo(plugin))
    ];
    let executable = plugin.executablePath;
    let args = registrationArgs;
    const environment = { ...process.env };
    if (plugin.runtime.kind === "node") {
      executable = process.execPath;
      args = ["--enable-source-maps", plugin.executablePath, ...registrationArgs];
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
      session.child = null;
      session.socket = null;
      session.readyPromise = null;
      this.pendingByUuid.delete(key);
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
    const plugin = this.registry?.findPluginForAction?.(actionId);
    if (!plugin) throw new Error(`Für die originale Stream-Deck-Aktion „${actionId}“ wurde kein ausführbares Plugin gefunden.`);
    const declaredAction = plugin.actions?.find((entry) => entry.id.toLowerCase() === actionId.toLowerCase());
    if (declaredAction?.raw?.supportedInTouchDeck === false) throw new Error(`Aktion „${declaredAction.name}“ unterstützt keine Keypad-/Touch-Taste.`);
    const session = await this.ensureSession(plugin);
    const id = contextId(plugin.id, actionId, context);
    const configured = action.settings && typeof action.settings === "object" ? action.settings : {};
    const settings = { ...(this.state.contexts[id] || {}), ...configured };
    this.state.contexts[id] = settings;
    this.persist();
    const payload = {
      settings,
      coordinates: coordinates(context),
      controller: "Keypad",
      isInMultiAction: Boolean(context.multiAction)
    };
    if (!this.visibleContexts.has(id)) {
      this.send(session, { event: "willAppear", action: actionId, context: id, device: DEVICE_ID, payload });
      this.visibleContexts.set(id, { pluginId: plugin.id, actionId });
    }
    this.send(session, { event: "keyDown", action: actionId, context: id, device: DEVICE_ID, payload: { ...payload, userDesiredState: undefined } });
    await wait(45);
    this.send(session, { event: "keyUp", action: actionId, context: id, device: DEVICE_ID, payload: { ...payload, userDesiredState: undefined } });
    await wait(80);
    return { dispatched: true, pluginId: plugin.id, context: id, feedback: this.state.feedback[id] || null };
  }

  async stop() {
    for (const [context, meta] of this.visibleContexts) {
      const session = this.sessions.get(meta.pluginId.toLowerCase());
      try { this.send(session, { event: "willDisappear", action: meta.actionId, context, device: DEVICE_ID, payload: { settings: this.state.contexts[context] || {}, controller: "Keypad", isInMultiAction: false } }); } catch {}
    }
    this.visibleContexts.clear();
    for (const session of this.sessions.values()) {
      try { this.send(session, { event: "deviceDidDisconnect", device: DEVICE_ID }); } catch {}
      try { session.socket?.close(1001, "Batto OBS Tool wird beendet"); session.socket?.terminate?.(); } catch {}
      try { session.child?.kill(); } catch {}
    }
    this.sessions.clear();
    this.pendingByUuid.clear();
    const server = this.server;
    this.server = null;
    if (server) await new Promise((resolve) => server.close(() => resolve()));
    this.emit("changed", this.status());
  }
}

module.exports = {
  DEVICE_ID,
  StreamDeckPluginHost,
  contextId,
  coordinates,
  pluginInfo
};
