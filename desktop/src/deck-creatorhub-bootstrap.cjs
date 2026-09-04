"use strict";

const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { ipcMain } = require("electron");

const execFileAsync = promisify(execFile);
const MEDIA_KEYS = Object.freeze({
  mute: 0xAD,
  volumeup: 0xAF,
  volumedown: 0xAE
});

function scriptFor(command) {
  const code = MEDIA_KEYS[String(command || "").toLowerCase()];
  if (!code) throw new Error("Nicht erlaubte Audio-Schnellaktion.");
  return `$signature='[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);';Add-Type -MemberDefinition $signature -Name Native -Namespace BattoQuickAudio;[BattoQuickAudio.Native]::keybd_event(${code},0,0,[UIntPtr]::Zero);Start-Sleep -Milliseconds 40;[BattoQuickAudio.Native]::keybd_event(${code},0,2,[UIntPtr]::Zero)`;
}

async function execute(command) {
  await execFileAsync("powershell.exe", [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", scriptFor(command)
  ], { windowsHide: true, timeout: 8000, maxBuffer: 512 * 1024 });
  return { ok: true, command: String(command || "").toLowerCase() };
}

ipcMain.handle("deck:quick-media", (_event, payload = {}) => execute(payload.command));

module.exports = { execute, scriptFor };
