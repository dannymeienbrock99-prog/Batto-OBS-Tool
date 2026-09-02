"use strict";

const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const write = (relative, text) => fs.writeFileSync(path.join(root, relative), text, "utf8");

// The legacy MultiChat service is still used for overlay forwarding/actions. Make its
// Twitch path anonymous/read-only too so there is no second OAuth code path in production.
{
  const file = "src/services/multi-chat.cjs";
  let text = read(file).replace(/\r\n/g, "\n");

  text = text.replace('twitch: { channel: "", oauth: "", nickname: "" }', 'twitch: { channel: "", nickname: "" }');
  text = text.replace(/twitch: \{ \.\.\.this\.settings\.twitch, oauth: this\.settings\.twitch\.oauth \? "••••••••" : "" \}/g, 'twitch: { ...this.settings.twitch }');
  text = text.replace(/\n\s*if \(secrets\.twitchOauth !== undefined\) this\.settings\.twitch\.oauth = String\(secrets\.twitchOauth \|\| ""\);/g, "");

  text = text.replace(
    /  async connectTwitch\(options = \{\}\) \{[\s\S]*?\n  \}\n\n  parseTwitchLine\(line\) \{/,
    `  async connectTwitch(options = {}) {\n    this.disconnectTwitch();\n    const channel = String(options.channel || this.settings.twitch.channel || "").trim().replace(/^#/, "").toLowerCase();\n    if (!channel) throw new Error("Twitch-Kanalname fehlt.");\n    const nickname = \`justinfan\${Math.floor(Math.random() * 900000 + 100000)}\`;\n    this.settings.twitch = { channel, nickname };\n    this.persistSettings?.();\n    await new Promise((resolve, reject) => {\n      const socket = new WebSocket("wss://irc-ws.chat.twitch.tv:443");\n      this.twitchSocket = socket;\n      let settled = false;\n      const timer = setTimeout(() => finish(new Error("Twitch-Verbindung hat zu lange gedauert.")), 10000);\n      const finish = (error) => {\n        if (settled) return;\n        settled = true;\n        clearTimeout(timer);\n        if (error) reject(error); else resolve();\n      };\n      socket.on("open", () => {\n        socket.send("PASS SCHMOOPIIE");\n        socket.send(\`NICK \${nickname}\`);\n        socket.send("CAP REQ :twitch.tv/tags twitch.tv/commands twitch.tv/membership");\n        socket.send(\`JOIN #\${channel}\`);\n      });\n      socket.on("message", (data) => {\n        for (const line of String(data).split(/\\r?\\n/).filter(Boolean)) {\n          if (line.startsWith("PING")) { socket.send(line.replace(/^PING/, "PONG")); continue; }\n          if (/ 001 /.test(line) || / JOIN #/i.test(line)) { this.twitchConnected = true; this.lastError.twitch = ""; finish(); this.emit("changed", this.snapshot()); }\n          this.parseTwitchLine(line);\n        }\n      });\n      socket.on("error", (error) => { this.lastError.twitch = String(error?.message || error); finish(error); });\n      socket.on("close", () => { this.twitchConnected = false; this.twitchSocket = null; this.emit("changed", this.snapshot()); });\n    });\n    return this.snapshot();\n  }\n\n  parseTwitchLine(line) {`
  );

  text = text.replace(
    /  async sendTwitch\(text\) \{[\s\S]*?\n  \}\n\n  disconnectTwitch\(\) \{/,
    '  async sendTwitch() {\n    throw new Error("Twitch ist in Batto OBS Tool absichtlich anonym und nur lesend verbunden.");\n  }\n\n  disconnectTwitch() {'
  );

  if (!text.includes("this.persistSettings?.();") || !text.includes('socket.send("PASS SCHMOOPIIE")')) {
    throw new Error("Tokenfreier Twitch-Connect konnte nicht eingebaut werden.");
  }
  write(file, text);
}

// Remove the old main-process secret handling for Twitch. YouTube secrets remain unchanged.
{
  const file = "src/main.cjs";
  let text = read(file).replace(/\r\n/g, "\n");
  text = text.replace(
    /  handle\("multichat:connectTwitch", async \(payload\) => \{[^\n]*\}\);/g,
    '  handle("multichat:connectTwitch", async (payload) => { const result = await multiChat.connectTwitch({ channel: payload.channel }); scheduleState(); return result; });'
  );
  text = text.replace(/if \(payload\?\.twitch\?\.oauth !== undefined\) \{ secrets\.twitchOauth = payload\.twitch\.oauth; delete sanitized\.twitch\.oauth; \} /g, 'if (sanitized?.twitch && Object.hasOwn(sanitized.twitch, "oauth")) delete sanitized.twitch.oauth; ');
  text = text.replace(/if \(secrets\.twitchOauth !== undefined\) writeSecret\("twitchOauth", secrets\.twitchOauth\); /g, "");
  write(file, text);
}

const combined = read("src/services/multi-chat.cjs") + "\n" + read("src/renderer/multi-chat.js") + "\n" + read("src/renderer/integrated.js");
if (/cfg-twitch-token|chat-twitch-token|OAuth-Token<input[^>]*twitch|Twitch benötigt Kanalname und OAuth-Token/i.test(combined)) {
  throw new Error("Twitch-OAuth ist noch in der veröffentlichten Chat-Laufzeit sichtbar/erforderlich.");
}
if (!combined.includes("anonymous-read-only") && !combined.includes("absichtlich anonym")) {
  throw new Error("Tokenfreier Twitch-Modus ist nicht nachweisbar.");
}

console.log("Twitch-Chat ist in allen veröffentlichten Pfaden tokenfrei und read-only.");
