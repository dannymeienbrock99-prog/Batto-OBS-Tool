"use strict";

const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

class PiperTtsClient {
  constructor({ baseUrl = "http://127.0.0.1:5000", player = "powershell.exe" } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.player = player;
    this.current = null;
  }

  request(method, route, body) {
    const url = new URL(route, this.baseUrl);
    return new Promise((resolve, reject) => {
      const payload = body == null ? null : Buffer.from(JSON.stringify(body));
      const req = http.request({ hostname: url.hostname, port: url.port || 80, path: `${url.pathname}${url.search}`, method, headers: payload ? { "content-type": "application/json", "content-length": payload.length } : {} }, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const data = Buffer.concat(chunks);
          if ((res.statusCode || 500) >= 400) return reject(new Error(`Piper HTTP ${res.statusCode}: ${data.toString("utf8")}`));
          resolve({ statusCode: res.statusCode, headers: res.headers, data });
        });
      });
      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  async voices() {
    const result = await this.request("GET", "/voices");
    return JSON.parse(result.data.toString("utf8"));
  }

  async synthesize(text, options = {}) {
    const body = {
      text: String(text || ""),
      voice: options.voice || undefined,
      speaker: options.speaker ?? options.speakerId,
      length_scale: options.lengthScale ?? options.length_scale,
      noise_scale: options.noiseScale ?? options.noise_scale,
      noise_w: options.noiseW ?? options.noise_w
    };
    for (const key of Object.keys(body)) if (body[key] === undefined || body[key] === "") delete body[key];
    const result = await this.request("POST", "/synthesize", body);
    return result.data;
  }

  async speak(text, options = {}) {
    this.stop();
    const wav = await this.synthesize(text, options);
    const file = path.join(os.tmpdir(), `batto-piper-${process.pid}-${Date.now()}.wav`);
    fs.writeFileSync(file, wav);
    const ps = `[Console]::OutputEncoding=[Text.UTF8Encoding]::UTF8; Add-Type -AssemblyName presentationCore; $p=New-Object System.Windows.Media.MediaPlayer; $p.Open([Uri]'${file.replaceAll("'", "''")}'); $p.Volume=${Math.max(0, Math.min(1, Number(options.volume ?? 1)))}; $p.Play(); Start-Sleep -Milliseconds 250; while($p.Position -lt $p.NaturalDuration.TimeSpan){Start-Sleep -Milliseconds 100}; $p.Close()`;
    const child = spawn(this.player, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", ps], { windowsHide: true, stdio: "ignore" });
    this.current = child;
    child.once("exit", () => { this.current = null; try { fs.unlinkSync(file); } catch {} });
    return true;
  }

  stop() {
    if (this.current) {
      try { this.current.kill(); } catch {}
      this.current = null;
    }
  }
}

module.exports = { PiperTtsClient };
