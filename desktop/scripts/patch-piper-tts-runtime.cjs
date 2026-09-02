"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const write = (relative, value) => fs.writeFileSync(path.join(root, relative), value, "utf8");

// Ensure Piper service survives prepare.
{
  const source = path.join(root, "src", "services", "piper-tts.cjs");
  const bootstrap = path.join(root, "bootstrap-2.0", "src", "services", "piper-tts.cjs");
  if (fs.existsSync(source) && !fs.existsSync(bootstrap)) {
    fs.mkdirSync(path.dirname(bootstrap), { recursive: true });
    fs.copyFileSync(source, bootstrap);
  }
  if (!fs.existsSync(bootstrap)) throw new Error("Piper-TTS-Service fehlt.");
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.copyFileSync(bootstrap, source);
}

// Main runtime: local HTTP Piper service and IPC.
{
  const file = "src/main.cjs";
  let text = read(file);
  if (!text.includes('require("./services/piper-tts.cjs")')) {
    text = text.replace('const { ActionExecutor } = require("./services/action-executor.cjs");', 'const { ActionExecutor } = require("./services/action-executor.cjs");\nconst { PiperTtsClient } = require("./services/piper-tts.cjs");');
  }
  if (!text.includes("let piperTts = null;")) text = text.replace("let actionExecutor = null;", "let actionExecutor = null;\nlet piperTts = null;");
  if (!text.includes("piperTts = new PiperTtsClient")) {
    text = text.replace("  multiChat = new MultiChat({ settingsFile: userDataFile(\"multi-chat.json\"), overlayServer: streamOverlayServer });", "  multiChat = new MultiChat({ settingsFile: userDataFile(\"multi-chat.json\"), overlayServer: streamOverlayServer });\n  piperTts = new PiperTtsClient({ baseUrl: process.env.BATTO_PIPER_URL || \"http://127.0.0.1:5000\" });");
  }
  if (!text.includes('handle("tts:piper:voices"')) {
    text = text.replace('  handle("state:get", () => currentState());', '  handle("state:get", () => currentState());\n  handle("tts:piper:voices", () => piperTts.voices());\n  handle("tts:piper:speak", (payload) => piperTts.speak(payload.text, payload.options || {}));\n  handle("tts:piper:stop", () => { piperTts.stop(); return true; });');
  }
  write(file, text);
}

// Preload bridge.
{
  const file = "src/preload.cjs";
  let text = read(file);
  if (!text.includes("piperVoices")) {
    text = text.replace('  saveTtsConfig: (value) => ipcRenderer.invoke("tts:save-config", value),', '  saveTtsConfig: (value) => ipcRenderer.invoke("tts:save-config", value),\n  piperVoices: () => ipcRenderer.invoke("tts:piper:voices"),\n  piperSpeak: (text, options) => ipcRenderer.invoke("tts:piper:speak", { text, options }),\n  piperStop: () => ipcRenderer.invoke("tts:piper:stop"),');
  }
  write(file, text);
}

// Unified Multi-Chat renderer: engine selector and real Piper playback.
{
  const file = "src/renderer/multi-chat.js";
  let text = read(file);
  text = text.replace('let ttsConfig = { enabled:false, language:"de-DE", rate:1, pitch:1, volume:1, cooldownMs:1200, maxQueue:20, maxCommentLength:220, chat:true, events:true, announcePlatforms:["twitch","cng","tiktok","youtube"], blockUsers:[], allowUsers:[] };', 'let ttsConfig = { enabled:false, engine:"system", language:"de-DE", voice:"", rate:1, pitch:1, volume:1, cooldownMs:1200, maxQueue:20, maxCommentLength:220, chat:true, events:true, announcePlatforms:["twitch","cng","tiktok","youtube"], blockUsers:[], allowUsers:[] };');
  text = text.replace('<div class="settings-section"><h3>Batto TTS</h3><label><input id="tts-enabled" type="checkbox"> Chat-TTS aktiv</label><label>Sprache<select id="tts-language">', '<div class="settings-section"><h3>Batto TTS</h3><label><input id="tts-enabled" type="checkbox"> Chat-TTS aktiv</label><label>Engine<select id="tts-engine"><option value="system">Windows/System</option><option value="piper">Piper lokal</option></select></label><label>Sprache<select id="tts-language">');
  text = text.replace('["tts-language","tts-voice","tts-rate","tts-pitch","tts-volume","tts-cooldown","tts-maxlen"]', '["tts-engine","tts-language","tts-voice","tts-rate","tts-pitch","tts-volume","tts-cooldown","tts-maxlen"]');
  text = text.replace('if(tts){ttsConfig={...ttsConfig,...tts};root.querySelector("#tts-enabled").checked=ttsConfig.enabled;root.querySelector("#tts-language").value=ttsConfig.language;', 'if(tts){ttsConfig={...ttsConfig,...tts};root.querySelector("#tts-enabled").checked=ttsConfig.enabled;root.querySelector("#tts-engine").value=ttsConfig.engine||"system";root.querySelector("#tts-language").value=ttsConfig.language;');
  text = text.replace('async function saveTts(){ttsConfig={...ttsConfig,enabled:root.querySelector("#tts-enabled").checked,language:value("tts-language"),voice:value("tts-voice"),', 'async function saveTts(){ttsConfig={...ttsConfig,enabled:root.querySelector("#tts-enabled").checked,engine:value("tts-engine")||"system",language:value("tts-language"),voice:value("tts-voice"),');
  text = text.replace('function loadVoices(){const select=root.querySelector("#tts-voice");if(!select||!window.speechSynthesis)return;const voices=window.speechSynthesis.getVoices();const current=select.value;select.innerHTML=\'<option value="">Systemstimme</option>\'+voices.map(v=>`<option value="${esc(v.name)}">${esc(v.name)} · ${esc(v.lang)}</option>`).join("");select.value=current}', 'async function loadVoices(){const select=root.querySelector("#tts-voice");if(!select)return;const current=ttsConfig.voice||select.value; if((ttsConfig.engine||"system")==="piper"){try{const voices=await api.piperVoices();const list=Array.isArray(voices)?voices:(voices?.voices||Object.keys(voices||{}));select.innerHTML=\'<option value="">Piper Standard</option>\'+list.map(v=>{const name=typeof v==="string"?v:(v.name||v.id||v.voice||"");return `<option value="${esc(name)}">${esc(name)}</option>`}).join("");}catch{select.innerHTML=\'<option value="">Piper nicht erreichbar</option>\';}}else{if(!window.speechSynthesis)return;const voices=window.speechSynthesis.getVoices();select.innerHTML=\'<option value="">Systemstimme</option>\'+voices.map(v=>`<option value="${esc(v.name)}">${esc(v.name)} · ${esc(v.lang)}</option>`).join("");}select.value=current}');
  text = text.replace('function pumpTts(){if(ttsRunning||!ttsQueue.length||!window.speechSynthesis)return;const text=ttsQueue.shift();const utterance=new SpeechSynthesisUtterance(text);', 'async function pumpTts(){if(ttsRunning||!ttsQueue.length)return;const text=ttsQueue.shift();if((ttsConfig.engine||"system")==="piper"){ttsRunning=true;lastTts=Date.now();try{await api.piperSpeak(text,{voice:ttsConfig.voice,volume:ttsConfig.volume,lengthScale:ttsConfig.rate>0?1/ttsConfig.rate:1});}catch(e){console.warn("Piper TTS:",e)}finally{ttsRunning=false;setTimeout(pumpTts,ttsConfig.cooldownMs)}return;}if(!window.speechSynthesis)return;const utterance=new SpeechSynthesisUtterance(text);');
  write(file, text);
}

console.log("Batto OBS Tool 2.0.0: Piper TTS in Unified Multi-Chat verdrahtet.");
