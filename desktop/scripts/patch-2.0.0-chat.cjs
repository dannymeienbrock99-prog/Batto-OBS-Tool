"use strict";

const fs = require("node:fs");
const path = require("node:path");

const file = path.resolve(__dirname, "..", "src", "services", "multi-chat-v2.cjs");
let content = fs.readFileSync(file, "utf8");
const before = '        const nick = this.secrets.twitchOAuth ? `justinfan${Math.floor(Math.random() * 90000 + 10000)}` : `justinfan${Math.floor(Math.random() * 90000 + 10000)}`;';
const after = '        const nick = this.secrets.twitchOAuth ? target : `justinfan${Math.floor(Math.random() * 90000 + 10000)}`;';
if (!content.includes(before)) throw new Error("Twitch-Anmelde-Patchpunkt fehlt");
content = content.replace(before, after);
fs.writeFileSync(file, content, "utf8");
console.log("Batto OBS Tool 2.0.0: Twitch-Schreibverbindung nutzt den Kanal-Login.");
