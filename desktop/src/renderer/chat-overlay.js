"use strict";
(() => {
  const root = document.getElementById("overlay-chat");
  const design = window.BattoChatDesign;
  let config = design.defaults(); let messages = []; let reconnect = null; let stopped = false; let socket = null;
  const platform = new URLSearchParams(location.search).get("platform");
  function render() {
    root.replaceChildren();
    for (const message of messages.filter((item) => !platform || item.platform === platform).slice(-40)) {
      const row = document.createElement("article"); row.className = "chat-row";
      const meta = document.createElement("div"); meta.className = "chat-meta";
      const name = document.createElement("span"); name.className = "chat-user"; name.textContent = message.username;
      const badge = document.createElement("span"); badge.className = "chat-platform"; badge.textContent = message.platform;
      const body = document.createElement("div"); body.className = "chat-message"; body.textContent = message.message;
      meta.append(name, badge); row.append(meta, body); design.apply(row, message, config); root.append(row);
    }
  }
  function connect() {
    const ws = new WebSocket("ws://" + location.host + "/chat-ws"); socket = ws;
    ws.onmessage = ({ data }) => {
      try {
        const event = JSON.parse(data);
        if (event.type === "snapshot") { config = design.normalize(event.config); messages = event.messages || []; }
        else if (event.type === "design") config = design.normalize(event.config);
        else if (event.type === "chat") { messages.push(event.message); messages = messages.slice(-100); }
        render();
      } catch {}
    };
    ws.onerror = () => ws.close();
    ws.onclose = () => { if (!stopped) reconnect = setTimeout(connect, 2000); };
  }
  window.addEventListener("beforeunload", () => { stopped = true; clearTimeout(reconnect); socket?.close(); }, { once: true });
  connect();
})();
