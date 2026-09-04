"use strict";

const fs = require("node:fs");
const path = require("node:path");

const file = path.join(__dirname, "..", "src", "renderer", "multi-chat.js");
let source = fs.readFileSync(file, "utf8");

source = source.replace(
  'root.querySelector("#tikfinity-connect").onclick = () => connectTikfinity(true);',
  'root.querySelector("#tikfinity-connect").onclick = () => void connectTikfinityBackend(true);'
);
source = source.replace(
  'root.querySelector("#tikfinity-disconnect").onclick = () => disconnectTikfinity(false);',
  'root.querySelector("#tikfinity-disconnect").onclick = () => void disconnectTikfinityBackend();'
);

const transportBlock = /  function scheduleTikfinityRetry\(\) \{[\s\S]*?\n  function bindListeners\(\) \{/;
if (!transportBlock.test(source)) throw new Error("Alter Renderer-TikFinity-Transportblock wurde nicht gefunden.");
source = source.replace(transportBlock, `  async function connectTikfinityBackend(manual = false) {
    updateTikfinityState("Verbinde …");
    try {
      const status = await api.chatConnect("tiktok", { tikfinityUrl:TIKFINITY_URL, directFallback:false });
      if (status?.connected && status?.source === "tikfinity") {
        updateTikfinityState("Verbunden");
        setStatus("TikFinity lokal verbunden");
      } else {
        updateTikfinityState("Nicht erreichbar");
        if (manual) setStatus("TikFinity Desktop ist lokal nicht erreichbar. Batto versucht die Verbindung im Hintergrund erneut.", true);
      }
      await refreshSettings();
      return status;
    } catch (error) {
      updateTikfinityState("Nicht erreichbar");
      if (manual) setStatus(\`TikFinity: \${error?.message || error}\`, true);
      return null;
    }
  }

  async function disconnectTikfinityBackend() {
    try { await api.chatDisconnect("tiktok"); } catch {}
    updateTikfinityState("Getrennt");
    await refreshSettings();
  }

  function bindListeners() {`);

source = source.replace('    connectTikfinity(false);', '    await connectTikfinityBackend(false);');
source = source.replace(/\n  window\.addEventListener\("beforeunload", \(\) => \{ clearTimeout\(tikfinityRetry\); try \{ tikfinity\?\.close\(\); \} catch \{\} \}\);/, "");
source = source.replace('  let tikfinity = null;\n  let tikfinityRetry = null;\n', '');

if (source.includes('new WebSocket(TIKFINITY_URL)')) throw new Error("Renderer öffnet weiterhin einen eigenen TikFinity-WebSocket.");
if (!source.includes('connectTikfinityBackend')) throw new Error("Backend-TikFinity-Verbindung wurde nicht eingebaut.");
if (!source.includes('directFallback:false')) throw new Error("TikFinity-Button ist nicht auf den lokalen Backend-Transport festgelegt.");

fs.writeFileSync(file, source, "utf8");
console.log("Multi-Chat: TikFinity besitzt jetzt genau einen Transportweg über den Backend-Hybridadapter.");
