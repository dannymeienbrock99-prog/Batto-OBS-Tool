"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");
const { app, ipcMain } = require("electron");

const execFileAsync = promisify(execFile);
const MEDIA_KEYS = Object.freeze({
  mute: 0xAD,
  volumeup: 0xAF,
  volumedown: 0xAE
});

function scriptFor(command) {
  const code = MEDIA_KEYS[String(command || "").toLowerCase()];
  if (!code) throw new Error("Nicht erlaubte Audio-Schnellaktion.");
  return `$signature='[DllImport(\"user32.dll\")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);';Add-Type -MemberDefinition $signature -Name Native -Namespace BattoQuickAudio;[BattoQuickAudio.Native]::keybd_event(${code},0,0,[UIntPtr]::Zero);Start-Sleep -Milliseconds 40;[BattoQuickAudio.Native]::keybd_event(${code},0,2,[UIntPtr]::Zero)`;
}

async function execute(command) {
  await execFileAsync("powershell.exe", [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", scriptFor(command)
  ], { windowsHide: true, timeout: 8000, maxBuffer: 512 * 1024 });
  return { ok: true, command: String(command || "").toLowerCase() };
}

function touchDeckExe() {
  const packaged = path.join(process.resourcesPath || "", "touchdeck-0802", "CreatorHub.TouchDeck.exe");
  const development = path.join(__dirname, "..", "resources", "touchdeck-0802", "CreatorHub.TouchDeck.exe");
  return fs.existsSync(packaged) ? packaged : development;
}

function touchDeckStatus() {
  const exe = touchDeckExe();
  return {
    available: fs.existsSync(exe),
    exe,
    sourceCommit: "51be33d29c07f50323b19d58782804af391b8394",
    sourceDate: "02.08.2026"
  };
}

async function launchOriginalTouchDeck() {
  const status = touchDeckStatus();
  if (!status.available) {
    throw new Error("Das originale Touch-Deck vom 02.08.2026 wurde in diesem Build nicht gefunden.");
  }
  const child = spawn(status.exe, [], {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
    cwd: path.dirname(status.exe)
  });
  child.unref();
  return { ...status, launched: true };
}

ipcMain.handle("deck:quick-media", (_event, payload = {}) => execute(payload.command));
ipcMain.handle("deck:original-0802-status", () => touchDeckStatus());
ipcMain.handle("deck:open-original-0802", () => launchOriginalTouchDeck());

module.exports = { execute, scriptFor, touchDeckStatus, launchOriginalTouchDeck };
