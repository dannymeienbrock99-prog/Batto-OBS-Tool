"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

const DEFAULT_CANDIDATES = [
  "%LOCALAPPDATA%\\TikTok LIVE Studio\\TikTok LIVE Studio.exe",
  "%PROGRAMFILES%\\TikTok LIVE Studio\\TikTok LIVE Studio.exe",
  "%PROGRAMFILES(X86)%\\TikTok LIVE Studio\\TikTok LIVE Studio.exe"
];

function expandEnvironment(input) {
  return String(input || "").replace(/%([^%]+)%/g, (_match, name) => process.env[name] || process.env[name.toUpperCase()] || "");
}

async function exists(filename) {
  try {
    const stat = await fs.stat(filename);
    return stat.isFile();
  } catch {
    return false;
  }
}

class TikTokLiveStudioService {
  constructor(options = {}) {
    this.configuredPath = String(options.executablePath || "").trim();
    this.lastDetectedPath = "";
    this.lastProcessCheck = null;
  }

  configure(options = {}) {
    this.configuredPath = String(options.executablePath || "").trim();
  }

  async detectExecutable() {
    const candidates = [];
    if (this.configuredPath) candidates.push(this.configuredPath);
    candidates.push(...DEFAULT_CANDIDATES.map(expandEnvironment));

    for (const candidate of [...new Set(candidates.filter(Boolean))]) {
      if (await exists(candidate)) {
        this.lastDetectedPath = path.resolve(candidate);
        return this.lastDetectedPath;
      }
    }
    this.lastDetectedPath = "";
    return "";
  }

  async isRunning() {
    if (process.platform !== "win32") {
      this.lastProcessCheck = { running: false, supported: false };
      return false;
    }
    try {
      const { stdout } = await execFileAsync("tasklist.exe", ["/FI", "IMAGENAME eq TikTok LIVE Studio.exe", "/FO", "CSV", "/NH"], {
        windowsHide: true,
        timeout: 5000
      });
      const running = /TikTok LIVE Studio\.exe/i.test(stdout || "");
      this.lastProcessCheck = { running, supported: true, checkedAt: Date.now() };
      return running;
    } catch (error) {
      this.lastProcessCheck = { running: false, supported: true, checkedAt: Date.now(), error: String(error?.message || error) };
      return false;
    }
  }

  async status() {
    const executablePath = await this.detectExecutable();
    const running = await this.isRunning();
    return {
      available: Boolean(executablePath),
      installed: Boolean(executablePath),
      running,
      executablePath,
      integrationMode: executablePath ? "live-studio" : "api-fallback",
      process: this.lastProcessCheck
    };
  }

  async launch() {
    const executablePath = await this.detectExecutable();
    if (!executablePath) throw new Error("TikTok LIVE Studio wurde nicht gefunden. Installationspfad in den Einstellungen prüfen.");
    const child = require("node:child_process").spawn(executablePath, [], {
      detached: true,
      stdio: "ignore",
      windowsHide: false
    });
    child.unref();
    return { launched: true, executablePath };
  }
}

module.exports = { TikTokLiveStudioService, DEFAULT_CANDIDATES, expandEnvironment };
