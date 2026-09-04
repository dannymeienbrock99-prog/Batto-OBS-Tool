"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const { execFile } = require("node:child_process");

const BACKUP_SIGNATURE = "BATTO_OBS_TOOL_V4_BACKUP";
const BACKUP_FILES = [
  "settings.json",
  "v4-module-config.json",
  "multi-chat-moderation.json",
  "chat-bot.json",
  "cng-personal-chat.json",
  "tts-config.json",
  "chat-overlay.json",
  "multi-chat-window.json"
];
const MEDIA_EXTENSIONS = new Set([".mp3", ".wav", ".ogg", ".mp4", ".webm", ".png", ".jpg", ".jpeg", ".webp", ".gif"]);

function safeName(value) {
  const name = path.basename(String(value || "")).replace(/[\u0000-\u001f<>:"/\\|?*]/g, "_").trim();
  if (!name || name === "." || name === "..") throw new Error("Ungültiger Dateiname.");
  return name.slice(0, 180);
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function uniqueName(existing, requested) {
  if (!existing.has(requested.toLowerCase())) return requested;
  const ext = path.extname(requested);
  const base = path.basename(requested, ext);
  for (let index = 2; index < 10000; index += 1) {
    const candidate = `${base}-${index}${ext}`;
    if (!existing.has(candidate.toLowerCase())) return candidate;
  }
  throw new Error("Für die Mediendatei konnte kein freier Name erzeugt werden.");
}

function buildCohostLayout(input = {}) {
  const format = String(input.format || input.defaultFormat || "tiktok").toLowerCase() === "twitch" ? "twitch" : "tiktok";
  const width = format === "tiktok" ? 1080 : 1920;
  const height = format === "tiktok" ? 1920 : 1080;
  const slots = Math.round(clamp(input.slots, 1, 8, 4));
  const gap = Math.round(clamp(input.gap, 0, 100, 10));
  const border = Math.round(clamp(input.border, 0, 40, 6));
  const radius = Math.round(clamp(input.radius, 0, 80, 15));
  let columns;
  let rows;
  const requested = String(input.layout || "").toLowerCase();
  if (/^\d+x\d+$/.test(requested)) {
    const [c, r] = requested.split("x").map(Number);
    if (c * r >= slots) { columns = c; rows = r; }
  }
  if (!columns) {
    if (format === "tiktok") {
      columns = slots === 1 ? 1 : 2;
      rows = Math.ceil(slots / columns);
    } else {
      columns = slots <= 2 ? slots : slots <= 4 ? 2 : 3;
      rows = Math.ceil(slots / columns);
    }
  }
  const cellWidth = Math.floor((width - gap * (columns + 1)) / columns);
  const cellHeight = Math.floor((height - gap * (rows + 1)) / rows);
  const frames = [];
  for (let index = 0; index < slots; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    frames.push({
      slot: index + 1,
      x: gap + column * (cellWidth + gap),
      y: gap + row * (cellHeight + gap),
      width: cellWidth,
      height: cellHeight,
      border,
      radius
    });
  }
  return { format, width, height, slots, columns, rows, gap, border, radius, frames };
}

function taskList() {
  return new Promise((resolve) => {
    if (process.platform !== "win32") return resolve("");
    execFile("tasklist.exe", ["/FO", "CSV", "/NH"], { windowsHide: true, timeout: 5000 }, (error, stdout) => resolve(error ? "" : String(stdout || "")));
  });
}

function htmlEscape(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

class V4Operations {
  constructor({ userData, configStore, logStore } = {}) {
    this.userData = userData;
    this.configStore = configStore;
    this.logStore = logStore;
    this.mediaRoot = path.join(userData, "chat-bot-media");
    this.server = null;
    this.cohostPort = null;
  }

  async start() {
    await fs.mkdir(this.mediaRoot, { recursive: true });
    await this.startCohostServer();
    return this.status();
  }

  async stop() {
    const server = this.server;
    this.server = null;
    this.cohostPort = null;
    if (!server) return;
    await new Promise((resolve) => server.close(() => resolve()));
  }

  status() {
    return {
      mediaRoot: this.mediaRoot,
      cohostRunning: Boolean(this.server?.listening),
      cohostPort: this.cohostPort,
      cohostUrl: this.cohostPort ? `http://127.0.0.1:${this.cohostPort}/cohost` : ""
    };
  }

  async startCohostServer() {
    if (this.server?.listening) return this.status();
    for (let port = 8790; port <= 8799; port += 1) {
      try {
        await new Promise((resolve, reject) => {
          const server = http.createServer((req, res) => void this.handleCohostRequest(req, res));
          server.once("error", reject);
          server.listen(port, "127.0.0.1", () => {
            server.off("error", reject);
            this.server = server;
            this.cohostPort = port;
            resolve();
          });
        });
        return this.status();
      } catch {}
    }
    throw new Error("Für die Co-Host-HTTP-Anzeige ist kein Port zwischen 8790 und 8799 frei.");
  }

  async handleCohostRequest(req, res) {
    try {
      const url = new URL(req.url || "/", `http://127.0.0.1:${this.cohostPort || 8790}`);
      const module = this.configStore.get("cohost");
      const layout = buildCohostLayout({ ...module.config, format: url.searchParams.get("format") || module.config.defaultFormat, slots: url.searchParams.get("slots") || module.config.slots });
      if (url.pathname === "/api/cohost") {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify({ ...layout, enabled: module.enabled, sources: module.config.sources || [] }));
        return;
      }
      if (url.pathname !== "/cohost" && url.pathname !== "/") {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("Not found");
        return;
      }
      const sources = Array.isArray(module.config.sources) ? module.config.sources : [];
      const slots = layout.frames.map((frame) => {
        const source = sources[frame.slot - 1] || {};
        const name = htmlEscape(source.name || `Gast ${frame.slot}`);
        const hint = layout.format === "tiktok" ? "OBS-/Capture-Quelle" : "Quelle / URL";
        return `<div class="slot" style="left:${frame.x}px;top:${frame.y}px;width:${frame.width}px;height:${frame.height}px;border-width:${frame.border}px;border-radius:${frame.radius}px"><strong>${name}</strong><small>${hint}</small></div>`;
      }).join("");
      const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;font-family:Segoe UI,Arial,sans-serif}.stage{position:relative;width:${layout.width}px;height:${layout.height}px}.slot{position:absolute;box-sizing:border-box;border-style:solid;border-color:rgba(98,181,255,.75);background:rgba(8,14,24,.38);display:flex;align-items:center;justify-content:center;flex-direction:column;color:#fff;text-shadow:0 2px 6px #000}.slot strong{font-size:28px}.slot small{margin-top:8px;font-size:16px;opacity:.72}</style></head><body><div class="stage">${slots}</div></body></html>`;
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "http://127.0.0.1" });
      res.end(html);
    } catch (error) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end(String(error?.message || error));
    }
  }

  async listMedia() {
    await fs.mkdir(this.mediaRoot, { recursive: true });
    const entries = await fs.readdir(this.mediaRoot, { withFileTypes: true });
    const result = [];
    for (const entry of entries) {
      if (!entry.isFile() || !MEDIA_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      const stat = await fs.stat(path.join(this.mediaRoot, entry.name));
      result.push({ name: entry.name, extension: path.extname(entry.name).toLowerCase(), size: stat.size, modifiedAt: stat.mtimeMs });
    }
    return result.sort((a, b) => a.name.localeCompare(b.name, "de"));
  }

  async importMedia(paths = []) {
    const current = await this.listMedia();
    const existing = new Set(current.map((item) => item.name.toLowerCase()));
    const imported = [];
    for (const source of paths.slice(0, 100)) {
      const extension = path.extname(String(source || "")).toLowerCase();
      if (!MEDIA_EXTENSIONS.has(extension)) continue;
      const stat = await fs.stat(source);
      if (!stat.isFile()) continue;
      if (stat.size > 500 * 1024 * 1024) throw new Error(`Mediendatei ist größer als 500 MB: ${path.basename(source)}`);
      const targetName = uniqueName(existing, safeName(path.basename(source)));
      await fs.copyFile(source, path.join(this.mediaRoot, targetName));
      existing.add(targetName.toLowerCase());
      imported.push(targetName);
    }
    await this.logStore?.append("media", "info", `${imported.length} Mediendatei(en) importiert.`, { imported });
    return { imported, files: await this.listMedia() };
  }

  async deleteMedia(name) {
    const target = path.join(this.mediaRoot, safeName(name));
    await fs.rm(target, { force: true });
    await this.logStore?.append("media", "info", `Mediendatei gelöscht: ${path.basename(target)}`);
    return this.listMedia();
  }

  async createBackup() {
    const files = {};
    for (const name of BACKUP_FILES) {
      try { files[name] = await fs.readFile(path.join(this.userData, name), "utf8"); } catch {}
    }
    const media = [];
    let total = 0;
    for (const item of await this.listMedia()) {
      if (item.size > 25 * 1024 * 1024 || total + item.size > 100 * 1024 * 1024) continue;
      const data = await fs.readFile(path.join(this.mediaRoot, item.name));
      total += data.length;
      media.push({ name: item.name, data: data.toString("base64") });
    }
    return { signature: BACKUP_SIGNATURE, version: 4, createdAt: new Date().toISOString(), files, media };
  }

  async writeBackup(filePath) {
    const backup = await this.createBackup();
    await fs.writeFile(filePath, JSON.stringify(backup, null, 2), "utf8");
    await this.logStore?.append("backup", "info", "V4-Backup exportiert.", { filePath, mediaFiles: backup.media.length });
    return { saved: true, filePath, mediaFiles: backup.media.length, configFiles: Object.keys(backup.files).length };
  }

  async restoreBackup(filePath) {
    const raw = await fs.readFile(filePath, "utf8");
    if (Buffer.byteLength(raw, "utf8") > 180 * 1024 * 1024) throw new Error("Backup-Datei ist zu groß.");
    const backup = JSON.parse(raw);
    if (backup?.signature !== BACKUP_SIGNATURE || Number(backup.version) !== 4) throw new Error("Die Datei ist kein gültiges Batto OBS Tool V4 Backup.");
    for (const [name, content] of Object.entries(backup.files || {})) {
      if (!BACKUP_FILES.includes(name) || typeof content !== "string") continue;
      const target = path.join(this.userData, name);
      const temp = `${target}.import.tmp`;
      await fs.writeFile(temp, content, "utf8");
      await fs.rename(temp, target);
    }
    await fs.mkdir(this.mediaRoot, { recursive: true });
    for (const item of Array.isArray(backup.media) ? backup.media : []) {
      const name = safeName(item.name);
      const data = Buffer.from(String(item.data || ""), "base64");
      if (data.length > 25 * 1024 * 1024) continue;
      await fs.writeFile(path.join(this.mediaRoot, name), data);
    }
    await this.configStore.load();
    await this.logStore?.append("backup", "info", "V4-Backup importiert.", { filePath });
    return { restored: true, restartRequired: true, configFiles: Object.keys(backup.files || {}).length, mediaFiles: Array.isArray(backup.media) ? backup.media.length : 0 };
  }

  async liveToolsStatus() {
    const tasks = (await taskList()).toLowerCase();
    const includes = (name) => tasks.includes(name.toLowerCase());
    return {
      platform: process.platform,
      obsRunning: includes("obs64.exe") || includes("obs.exe"),
      tiktokLiveStudioRunning: includes("tiktok live studio.exe") || includes("tiktoklivestudio.exe"),
      note: "LIVE-Funktionen werden nur aktiviert, wenn die jeweilige Plattform-Schnittstelle sie wirklich unterstützt."
    };
  }

  moduleTest(id) {
    if (id === "cohost") return { ok: true, layout: buildCohostLayout(this.configStore.get("cohost").config), ...this.status() };
    if (id === "media" || id === "mediaPools") return this.listMedia().then((files) => ({ ok: true, files, mediaRoot: this.mediaRoot }));
    if (id === "backup") return Promise.resolve({ ok: true, signature: BACKUP_SIGNATURE, files: BACKUP_FILES.slice() });
    if (id === "liveTools") return this.liveToolsStatus().then((status) => ({ ok: true, ...status }));
    return Promise.resolve({ ok: true, module: id, message: "Konfigurationskern erreichbar." });
  }
}

module.exports = { V4Operations, BACKUP_SIGNATURE, BACKUP_FILES, MEDIA_EXTENSIONS, buildCohostLayout, safeName };
