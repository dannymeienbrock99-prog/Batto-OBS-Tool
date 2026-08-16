"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { promisify } = require("node:util");
const { EventEmitter } = require("node:events");
const { readJson, safeText, writeJsonAtomic } = require("./common.cjs");

const execFile = promisify(childProcess.execFile);
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(milliseconds) || 0)));

function powershellEncoded(script) {
  return Buffer.from(script, "utf16le").toString("base64");
}

async function runPowerShell(script, timeout = 15000) {
  const { stdout, stderr } = await execFile("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", powershellEncoded(script)], {
    windowsHide: true,
    timeout,
    maxBuffer: 4 * 1024 * 1024
  });
  return { stdout: String(stdout || "").trim(), stderr: String(stderr || "").trim() };
}

const MEDIA_KEYS = Object.freeze({
  "media.playpause": 0xB3,
  "media.stop": 0xB2,
  "media.next": 0xB0,
  "media.previous": 0xB1,
  "media.volume.up": 0xAF,
  "media.volume.down": 0xAE,
  "media.mute": 0xAD
});

async function pressVirtualKey(code) {
  const key = Number(code);
  const script = `Add-Type @'\nusing System;\nusing System.Runtime.InteropServices;\npublic static class BattoKeys { [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint flags, UIntPtr extra); }\n'@; [BattoKeys]::keybd_event(${key},0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 30; [BattoKeys]::keybd_event(${key},0,2,[UIntPtr]::Zero)`;
  await runPowerShell(script, 5000);
}

function findExecutable(candidates) {
  for (const candidate of candidates.filter(Boolean)) {
    try { if (fs.statSync(candidate).isFile()) return candidate; } catch {}
  }
  return "";
}

function installedProgramCandidates(name) {
  const local = process.env.LOCALAPPDATA || "";
  const programFiles = process.env.ProgramFiles || "C:\\Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const known = {
    discord: [path.join(local, "Discord", "Update.exe"), path.join(local, "DiscordCanary", "Update.exe")],
    obsbot: [path.join(programFiles, "OBSBOT Center", "OBSBOT Center.exe"), path.join(programFilesX86, "OBSBOT Center", "OBSBOT Center.exe")],
    tiktok: [path.join(local, "Programs", "TikTok LIVE Studio", "TikTok LIVE Studio.exe"), path.join(programFiles, "TikTok LIVE Studio", "TikTok LIVE Studio.exe")],
    spotify: [path.join(process.env.APPDATA || "", "Spotify", "Spotify.exe"), path.join(local, "Microsoft", "WindowsApps", "Spotify.exe")]
  };
  return findExecutable(known[name] || []);
}

class ActionExecutor extends EventEmitter {
  constructor({ obs, shell, overlayServer, multiChat, dataFile } = {}) {
    super();
    this.obs = obs;
    this.shell = shell;
    this.overlayServer = overlayServer;
    this.multiChat = multiChat;
    this.dataFile = dataFile;
    this.data = readJson(dataFile, { giveaway: [], lastWinner: null }) || { giveaway: [], lastWinner: null };
  }

  persist() {
    if (this.dataFile) writeJsonAtomic(this.dataFile, this.data);
  }

  async executeMany(actions = [], context = {}) {
    const results = [];
    for (const action of Array.isArray(actions) ? actions : []) {
      if (action?.delayMs) await sleep(action.delayMs);
      results.push(await this.execute(action, context));
    }
    return results;
  }

  async execute(action = {}, context = {}) {
    const type = safeText(action.type || action.action || "none", 160);
    const settings = action.settings && typeof action.settings === "object" ? action.settings : {};
    const startedAt = Date.now();
    try {
      const value = await this._execute(type, settings, context);
      const result = { ok: true, type, value, startedAt, finishedAt: Date.now() };
      this.emit("executed", result);
      return result;
    } catch (error) {
      const result = { ok: false, type, error: String(error?.message || error), startedAt, finishedAt: Date.now() };
      this.emit("failed", result);
      throw Object.assign(new Error(result.error), { actionResult: result });
    }
  }

  async _execute(type, settings, context) {
    if (!type || type === "none") return { skipped: true };
    if (MEDIA_KEYS[type]) {
      await pressVirtualKey(MEDIA_KEYS[type]);
      return { key: MEDIA_KEYS[type] };
    }
    switch (type) {
      case "obs.scene":
        return this.obs.setScene(settings.sceneName);
      case "obs.source.toggle": {
        const sceneName = settings.sceneName || context.sceneName;
        if (!sceneName) throw new Error("OBS-Szene fehlt.");
        let sceneItemId = Number(settings.sceneItemId);
        if (!Number.isFinite(sceneItemId) && settings.sourceName) {
          const response = await this.obs.call("GetSceneItemId", { sceneName, sourceName: settings.sourceName, searchOffset: 0 });
          sceneItemId = response.sceneItemId;
        }
        if (!Number.isFinite(sceneItemId)) throw new Error("OBS-Quellen-ID fehlt.");
        const current = await this.obs.call("GetSceneItemEnabled", { sceneName, sceneItemId });
        return this.obs.setSceneItemEnabled(sceneName, sceneItemId, !current.sceneItemEnabled);
      }
      case "obs.input.mute":
        return settings.toggle !== false
          ? this.obs.toggleInputMute(settings.inputName)
          : this.obs.setInputMute(settings.inputName, settings.muted);
      case "obs.input.volume":
        return this.obs.setInputVolume(settings.inputName, Number(settings.volumeMul ?? settings.volume ?? 1));
      case "obs.stream.toggle": return this.obs.toggleStream();
      case "obs.record.toggle": return this.obs.toggleRecord();
      case "obs.virtualcam.toggle": return this.obs.toggleVirtualCam();
      case "system.launch": {
        const target = String(settings.path || settings.target || "").trim();
        if (!target) throw new Error("Programm- oder Dateipfad fehlt.");
        const error = await this.shell.openPath(target);
        if (error) throw new Error(error);
        return { target };
      }
      case "system.url": {
        const target = String(settings.url || settings.target || "").trim();
        if (!/^https?:\/\//i.test(target)) throw new Error("Nur HTTP- oder HTTPS-Adressen sind erlaubt.");
        await this.shell.openExternal(target);
        return { target };
      }
      case "system.command": {
        const file = String(settings.file || "").trim();
        const args = Array.isArray(settings.args) ? settings.args.map(String) : [];
        if (!file) throw new Error("Ausführbare Datei fehlt.");
        const { stdout, stderr } = await execFile(file, args, { windowsHide: true, timeout: Math.max(1000, Math.min(120000, Number(settings.timeoutMs) || 15000)), maxBuffer: 4 * 1024 * 1024 });
        return { stdout: safeText(stdout, 4000), stderr: safeText(stderr, 4000) };
      }
      case "system.hotkey": {
        const keys = Array.isArray(settings.keys) ? settings.keys : String(settings.keys || "").split("+");
        const map = { CTRL: 0x11, CONTROL: 0x11, ALT: 0x12, SHIFT: 0x10, WIN: 0x5B, WINDOWS: 0x5B, ENTER: 0x0D, ESC: 0x1B, ESCAPE: 0x1B, SPACE: 0x20, TAB: 0x09 };
        const codes = keys.map((key) => {
          const text = String(key).trim().toUpperCase();
          if (map[text]) return map[text];
          if (/^[A-Z0-9]$/.test(text)) return text.charCodeAt(0);
          if (/^F(?:[1-9]|1[0-2])$/.test(text)) return 0x70 + Number(text.slice(1)) - 1;
          throw new Error(`Unbekannte Taste: ${text}`);
        });
        const down = codes.map((code) => `[BattoKeys]::keybd_event(${code},0,0,[UIntPtr]::Zero);`).join(" ");
        const up = [...codes].reverse().map((code) => `[BattoKeys]::keybd_event(${code},0,2,[UIntPtr]::Zero);`).join(" ");
        await runPowerShell(`Add-Type @'\nusing System;\nusing System.Runtime.InteropServices;\npublic static class BattoKeys { [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint flags, UIntPtr extra); }\n'@; ${down} Start-Sleep -Milliseconds 50; ${up}`, 5000);
        return { keys };
      }
      case "discord.launch": {
        const executable = installedProgramCandidates("discord");
        if (executable) childProcess.spawn(executable, ["--processStart", "Discord.exe"], { detached: true, stdio: "ignore", windowsHide: true }).unref();
        else await this.shell.openExternal("discord://");
        return { executable: executable || "discord://" };
      }
      case "discord.webhook": {
        const url = String(settings.webhookUrl || "");
        if (!/^https:\/\/(?:discord(?:app)?\.com|discord\.com)\/api\/webhooks\//i.test(url)) throw new Error("Ungültige Discord-Webhook-Adresse.");
        const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: safeText(settings.message, 1900) }) });
        if (!response.ok) throw new Error(`Discord-Webhook meldet HTTP ${response.status}.`);
        return { status: response.status };
      }
      case "obsbot.center": {
        const executable = installedProgramCandidates("obsbot");
        if (!executable) throw new Error("OBSBOT Center wurde nicht gefunden.");
        childProcess.spawn(executable, [], { detached: true, stdio: "ignore", windowsHide: true }).unref();
        return { executable };
      }
      case "tiktok.live-studio.launch": {
        const executable = installedProgramCandidates("tiktok");
        if (!executable) throw new Error("TikTok LIVE Studio wurde nicht gefunden.");
        childProcess.spawn(executable, [], { detached: true, stdio: "ignore", windowsHide: true }).unref();
        return { executable };
      }
      case "tiktok.event":
      case "tikfinity.webhook":
        if (!this.overlayServer) throw new Error("Stream-Overlay ist nicht aktiv.");
        return this.overlayServer.publishEvent({ type: settings.eventType || "tiktok", platform: settings.platform || "tiktok", name: safeText(settings.name || context.name || "Zuschauer", 120), text: safeText(settings.text || settings.gift || "Ereignis", 500), value: Number(settings.value) || 0, timestamp: Date.now() });
      case "youtube.dashboard":
        await this.shell.openExternal("https://studio.youtube.com/");
        return { opened: true };
      case "youtube.channel": {
        const channel = String(settings.channelUrl || settings.channelId || "").trim();
        const url = /^https?:\/\//i.test(channel) ? channel : `https://www.youtube.com/channel/${encodeURIComponent(channel)}`;
        await this.shell.openExternal(url);
        return { url };
      }
      case "youtube.latest": {
        const videoId = await this.youtubeLatestVideo(settings);
        const url = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
        await this.shell.openExternal(url);
        return { videoId, url };
      }
      case "youtube.refresh":
        return { videoId: await this.youtubeLatestVideo(settings) };
      case "youtube.chat.send":
        throw new Error("YouTube-Chatversand benötigt eine OAuth-Anmeldung. Ohne gültiges Token wird kein Erfolg vorgetäuscht.");
      case "giveaway.add": {
        const name = safeText(settings.name || context.name, 120).trim();
        if (!name) throw new Error("Teilnehmername fehlt.");
        if (!this.data.giveaway.some((entry) => entry.toLowerCase() === name.toLowerCase())) this.data.giveaway.push(name);
        this.persist();
        return { participants: this.data.giveaway.length };
      }
      case "giveaway.draw": {
        if (!this.data.giveaway.length) throw new Error("Die Giveaway-Liste ist leer.");
        const winner = this.data.giveaway[Math.floor(Math.random() * this.data.giveaway.length)];
        this.data.lastWinner = { name: winner, timestamp: Date.now() };
        this.persist();
        this.overlayServer?.publishEvent({ type: "giveaway", name: winner, text: "Gewinner", timestamp: Date.now() });
        return this.data.lastWinner;
      }
      case "overlay.poll":
      case "overlay.wordcloud":
      case "overlay.wheel":
        if (!this.overlayServer) throw new Error("Stream-Overlay ist nicht aktiv.");
        return this.overlayServer.publishEvent({ type: type.split(".")[1], ...settings, timestamp: Date.now() });
      default:
        throw new Error(`Aktion „${type}“ wird ohne passende Laufzeit nicht ausgeführt.`);
    }
  }

  async youtubeLatestVideo(settings = {}) {
    const apiKey = String(settings.apiKey || "").trim();
    const channelId = String(settings.channelId || "").trim();
    if (!apiKey || !channelId) throw new Error("YouTube-API-Schlüssel und Kanal-ID werden benötigt.");
    const url = new URL("https://www.googleapis.com/youtube/v3/search");
    url.searchParams.set("part", "snippet");
    url.searchParams.set("channelId", channelId);
    url.searchParams.set("order", "date");
    url.searchParams.set("maxResults", "1");
    url.searchParams.set("type", "video");
    url.searchParams.set("key", apiKey);
    const response = await fetch(url);
    const body = await response.json();
    if (!response.ok) throw new Error(body?.error?.message || `YouTube API HTTP ${response.status}`);
    const videoId = body?.items?.[0]?.id?.videoId;
    if (!videoId) throw new Error("Kein Video für diesen Kanal gefunden.");
    return videoId;
  }
}

module.exports = { ActionExecutor, MEDIA_KEYS, installedProgramCandidates, pressVirtualKey, runPowerShell };
