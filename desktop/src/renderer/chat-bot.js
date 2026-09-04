"use strict";

(() => {
  const api = window.batto;
  const root = document.getElementById("batto-chatbot-root");
  if (!api || !root) return;

  const platforms = ["twitch", "tiktok", "youtube", "cng"];
  const labels = { twitch: "Twitch", tiktok: "TikTok", youtube: "YouTube", cng: "CNG" };
  const actionTypes = ["chat", "hotkey", "delay", "sound", "video", "image", "gif", "tts", "obs", "discord-webhook", "overlay"];
  let snapshot = null;
  let tab = "broadcasts";
  let editingCommand = null;
  let editingBroadcast = null;
  let editingEvent = null;

  const esc = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const id = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

  function toast(message, error = false) {
    const existing = document.getElementById("toast");
    if (existing) {
      existing.textContent = message;
      existing.className = `toast${error ? " error" : ""}`;
      existing.hidden = false;
      setTimeout(() => { existing.hidden = true; }, 4000);
    } else if (error) alert(message);
  }
  function config() { return snapshot?.config || {}; }
  function checkedPlatforms(prefix, selected = platforms) {
    return `<div class="chatbot-platforms">${platforms.map((p) => `<label><input type="checkbox" data-platform="${p}" data-prefix="${prefix}" ${selected.includes(p) ? "checked" : ""}> ${labels[p]}</label>`).join("")}</div>`;
  }
  function readPlatforms(prefix) {
    return [...root.querySelectorAll(`[data-prefix="${prefix}"][data-platform]:checked`)].map((el) => el.dataset.platform);
  }
  function actionDefaults(type) {
    if (type === "chat") return { type, message: "{user} hat einen Command ausgelöst!", platforms: [] };
    if (type === "hotkey") return { type, keys: ["F6"], target: { mode: "process", process: "SonsOfTheForest.exe", requireRunning: true } };
    if (type === "delay") return { type, milliseconds: 500 };
    if (["sound", "video", "image", "gif"].includes(type)) return { type, file: type === "sound" ? "sound.mp3" : type === "video" ? "video.mp4" : "bild.png", durationMs: 7000, volume: 1, loop: false };
    if (type === "tts") return { type, message: "{user} hat etwas ausgelöst!", volume: 1 };
    if (type === "obs") return { type, obsAction: "scene.set", obsPayload: { sceneName: "Szene" } };
    if (type === "discord-webhook") return { type, title: "Batto Event", body: "{user} hat ein Event ausgelöst!" };
    return { type, message: "Batto Event", durationMs: 7000 };
  }
  function actionEditor(action, index, owner) {
    const value = JSON.stringify(action, null, 2);
    return `<div class="chatbot-action" data-action-owner="${owner}" data-action-index="${index}">
      <label>Aktion<select class="action-type">${actionTypes.map((type) => `<option value="${type}" ${action.type === type ? "selected" : ""}>${type}</option>`).join("")}</select></label>
      <label>Einstellungen<textarea class="action-json" spellcheck="false">${esc(value)}</textarea></label>
      <button class="danger-text action-remove" type="button">Entfernen</button>
    </div>`;
  }
  function actionsHelp() {
    return `<div class="chatbot-actions-help"><strong>Aktionsbeispiele:</strong> Hotkey: <code>{"type":"hotkey","keys":["CTRL","F8"],"target":{"mode":"process","process":"SonsOfTheForest.exe","requireRunning":true}}</code> · Medien: <code>{"type":"video","file":"boss.mp4","durationMs":8000}</code> · OBS: <code>{"type":"obs","obsAction":"scene.set","obsPayload":{"sceneName":"Boss"}}</code></div>`;
  }
  function collectActions(owner) {
    const result = [];
    for (const row of root.querySelectorAll(`[data-action-owner="${owner}"]`)) {
      try {
        const value = JSON.parse(row.querySelector(".action-json").value);
        value.type = row.querySelector(".action-type").value;
        result.push(value);
      } catch (error) {
        throw new Error(`Aktions-Einstellungen sind kein gültiges JSON: ${error.message}`);
      }
    }
    return result;
  }

  function render() {
    const state = snapshot || { config: {}, overlay: {}, logs: [] };
    const overlay = state.overlay || {};
    root.innerHTML = `<div class="chatbot-shell">
      <section class="chatbot-hero">
        <div><span class="eyebrow">AUTOMATISIERUNG · COMMANDS · EVENTS</span><h2>BATTO CHAT BOT</h2><p>Erweitert den bestehenden Multi-Chat um Auto-Broadcast, frei definierbare Commands, Hotkeys, Multi-Actions, Discord-Webhooks, Medien, TTS und OBS-Browser-Overlays. Die vorhandene Multi-Chat-Moderation bleibt getrennt bestehen.</p></div>
        <div class="chatbot-status"><strong>${config().enabled !== false ? "● Bot aktiv" : "○ Bot deaktiviert"}</strong><small>${overlay.running ? `Overlay 127.0.0.1:${config().overlay?.port || 8787}` : "Overlay nicht gestartet"}</small><label><input id="chatbot-enabled" type="checkbox" ${config().enabled !== false ? "checked" : ""}> Chat Bot aktiv</label></div>
      </section>
      <nav class="chatbot-tabs">
        ${[["broadcasts","Auto-Broadcast"],["commands","Commands"],["events","Events"],["discord","Discord Webhooks"],["media","Medien & Overlay"],["logs","Logs"]].map(([key,label]) => `<button type="button" data-chatbot-tab="${key}" class="${tab === key ? "active" : ""}">${label}</button>`).join("")}
      </nav>
      <section class="chatbot-page ${tab === "broadcasts" ? "active" : ""}" data-chatbot-page="broadcasts">${broadcastPage()}</section>
      <section class="chatbot-page ${tab === "commands" ? "active" : ""}" data-chatbot-page="commands">${commandsPage()}</section>
      <section class="chatbot-page ${tab === "events" ? "active" : ""}" data-chatbot-page="events">${eventsPage()}</section>
      <section class="chatbot-page ${tab === "discord" ? "active" : ""}" data-chatbot-page="discord">${discordPage()}</section>
      <section class="chatbot-page ${tab === "media" ? "active" : ""}" data-chatbot-page="media">${mediaPage()}</section>
      <section class="chatbot-page ${tab === "logs" ? "active" : ""}" data-chatbot-page="logs">${logsPage()}</section>
    </div>`;
    bind();
  }

  function broadcastPage() {
    const list = config().broadcasts || [];
    return `<div class="chatbot-grid"><article class="chatbot-card"><div class="chatbot-item-head"><h3>Automatische Nachrichten</h3><button id="broadcast-new" class="primary">Neue Nachricht</button></div><p>Nachrichten pro Plattform, Intervall, Startverzögerung und LIVE-Bedingung konfigurieren.</p><div class="chatbot-list">${list.length ? list.map((item) => `<div class="chatbot-item"><div class="chatbot-item-head"><strong>${esc(item.messages?.[0] || "Ohne Text")}</strong><span class="chatbot-small">${Math.round((item.intervalMs || 0)/1000)} s</span></div><small>${item.platforms.map((p) => labels[p]).join(" · ")}</small><div class="button-row"><button data-broadcast-edit="${item.id}">Bearbeiten</button><button data-broadcast-test="${item.id}">Test</button><button class="danger-text" data-broadcast-delete="${item.id}">Löschen</button></div></div>`).join("") : '<div class="chatbot-empty">Noch keine Auto-Broadcast-Nachricht.</div>'}</div></article><article class="chatbot-card">${broadcastEditor()}</article></div>`;
  }
  function broadcastEditor() {
    const item = editingBroadcast || { id: id("broadcast"), enabled: true, messages: ["Folgt mir für mehr!"], platforms: [...platforms], intervalMs: 300000, startDelayMs: 0, onlyWhenLive: true, onlyWhenActive: false, rotation: true };
    return `<h3>${editingBroadcast ? "Auto-Broadcast bearbeiten" : "Auto-Broadcast erstellen"}</h3><div class="chatbot-form"><label>Nachrichten – eine pro Zeile<textarea id="broadcast-messages">${esc((item.messages || []).join("\n"))}</textarea></label>${checkedPlatforms("broadcast", item.platforms)}<div class="chatbot-inline"><label>Intervall Sekunden<input id="broadcast-interval" type="number" min="10" value="${Math.max(10,Math.round((item.intervalMs||300000)/1000))}"></label><label>Startverzögerung Sekunden<input id="broadcast-delay" type="number" min="0" value="${Math.round((item.startDelayMs||0)/1000)}"></label></div><label><input id="broadcast-live" type="checkbox" ${item.onlyWhenLive ? "checked" : ""}> Nur wenn Stream LIVE ist</label><label><input id="broadcast-active" type="checkbox" ${item.onlyWhenActive ? "checked" : ""}> Nur bei Chat-Aktivität</label><label><input id="broadcast-enabled" type="checkbox" ${item.enabled !== false ? "checked" : ""}> Aktiv</label><div class="button-row"><button id="broadcast-save" class="primary">Speichern</button><button id="broadcast-cancel">Zurücksetzen</button></div></div>`;
  }

  function commandsPage() {
    const list = config().commands || [];
    return `<div class="chatbot-grid"><article class="chatbot-card"><div class="chatbot-item-head"><h3>Commands</h3><button id="command-new" class="primary">Neuer Command</button></div><p>Commands werden direkt aus dem bestehenden Multi-Chat erkannt und führen die konfigurierte Aktionskette aus.</p><div class="chatbot-list">${list.length ? list.map((item) => `<div class="chatbot-item"><div class="chatbot-item-head"><strong>${esc(item.command)}</strong><span class="chatbot-small">${item.actions.length} Aktion(en)</span></div><small>${item.platforms.map((p) => labels[p]).join(" · ")} · ${esc(item.permission)} · ${Math.round(item.cooldownMs/1000)} s Cooldown</small><div class="button-row"><button data-command-edit="${item.id}">Bearbeiten</button><button data-command-test="${item.id}">TEST</button><button class="danger-text" data-command-delete="${item.id}">Löschen</button></div></div>`).join("") : '<div class="chatbot-empty">Noch kein Command. Beispiel: !heal → F6 → 500 ms → Sound → Chat-Nachricht.</div>'}</div></article><article class="chatbot-card">${commandEditor()}</article></div>`;
  }
  function commandEditor() {
    const item = editingCommand || { id: id("command"), command: "!heal", enabled: true, platforms: [...platforms], permission: "all", cooldownMs: 30000, userCooldownMs: 0, onlyWhenLive: true, targetProcess: "", actions: [] };
    return `<h3>${editingCommand ? "Command bearbeiten" : "Command erstellen"}</h3><div class="chatbot-form"><div class="chatbot-inline"><label>Befehl<input id="command-name" value="${esc(item.command)}" placeholder="!heal"></label><label>Berechtigung<select id="command-permission">${["all","follower","subscriber","vip","moderator","broadcaster"].map((value) => `<option value="${value}" ${item.permission===value?"selected":""}>${value}</option>`).join("")}</select></label></div>${checkedPlatforms("command", item.platforms)}<div class="chatbot-inline three"><label>Command-Cooldown s<input id="command-cooldown" type="number" min="0" value="${Math.round((item.cooldownMs||0)/1000)}"></label><label>Benutzer-Cooldown s<input id="command-user-cooldown" type="number" min="0" value="${Math.round((item.userCooldownMs||0)/1000)}"></label><label>Zielprozess optional<input id="command-process" value="${esc(item.targetProcess||"")}" placeholder="SonsOfTheForest.exe"></label></div><label><input id="command-live" type="checkbox" ${item.onlyWhenLive ? "checked" : ""}> Nur wenn Stream LIVE ist</label><label><input id="command-enabled" type="checkbox" ${item.enabled !== false ? "checked" : ""}> Aktiv</label><div class="chatbot-item-head"><strong>Multi-Action</strong><button id="command-action-add">Aktion hinzufügen</button></div><div id="command-actions" class="chatbot-actions">${(item.actions||[]).map((a,i)=>actionEditor(a,i,"command")).join("") || '<div class="chatbot-empty">Noch keine Aktion.</div>'}</div>${actionsHelp()}<div class="button-row"><button id="command-save" class="primary">Command speichern</button><button id="command-editor-test">Komplette Kette TESTEN</button><button id="command-cancel">Zurücksetzen</button></div></div>`;
  }

  function eventsPage() {
    const list = config().events || [];
    return `<div class="chatbot-grid"><article class="chatbot-card"><div class="chatbot-item-head"><h3>Event-System</h3><button id="event-new" class="primary">Neues Event</button></div><p>Trigger: Follow, Subscriber/Mitglied, Gift, Raid, Share, Stream Start, Stream Ende oder eigener Trigger.</p><div class="chatbot-list">${list.length ? list.map((item) => `<div class="chatbot-item"><div class="chatbot-item-head"><strong>${esc(item.trigger)}</strong><span class="chatbot-small">${item.actions.length} Aktion(en)</span></div><small>${item.platforms.length ? item.platforms.map((p)=>labels[p]).join(" · ") : "Alle Plattformen"}</small><div class="button-row"><button data-event-edit="${item.id}">Bearbeiten</button><button data-event-test="${item.id}">TEST</button><button class="danger-text" data-event-delete="${item.id}">Löschen</button></div></div>`).join("") : '<div class="chatbot-empty">Noch keine Event-Aktion.</div>'}</div></article><article class="chatbot-card">${eventEditor()}</article></div>`;
  }
  function eventEditor() {
    const item = editingEvent || { id: id("event"), enabled: true, trigger: "follow", platforms: [], cooldownMs: 0, actions: [] };
    return `<h3>${editingEvent ? "Event bearbeiten" : "Event erstellen"}</h3><div class="chatbot-form"><div class="chatbot-inline"><label>Trigger<select id="event-trigger">${["follow","subscriber","gift","raid","share","stream-start","stream-end","custom"].map((v)=>`<option value="${v}" ${item.trigger===v?"selected":""}>${v}</option>`).join("")}</select></label><label>Cooldown s<input id="event-cooldown" type="number" min="0" value="${Math.round((item.cooldownMs||0)/1000)}"></label></div>${checkedPlatforms("event", item.platforms)}<label><input id="event-enabled" type="checkbox" ${item.enabled !== false ? "checked" : ""}> Aktiv</label><div class="chatbot-item-head"><strong>Event-Aktionen</strong><button id="event-action-add">Aktion hinzufügen</button></div><div class="chatbot-actions">${(item.actions||[]).map((a,i)=>actionEditor(a,i,"event")).join("") || '<div class="chatbot-empty">Noch keine Aktion.</div>'}</div>${actionsHelp()}<div class="button-row"><button id="event-save" class="primary">Event speichern</button><button id="event-editor-test">Event TESTEN</button><button id="event-cancel">Zurücksetzen</button></div></div>`;
  }

  function discordPage() {
    const d = config().discord || {};
    return `<div class="chatbot-grid"><article class="chatbot-card"><h3>Discord-Live-Benachrichtigung</h3><div class="chatbot-form"><label>Eigener Discord-Webhook<input id="discord-url" type="password" value="${esc(d.webhookUrl||"")}" placeholder="https://discord.com/api/webhooks/…"></label><label>Überschrift<input id="discord-title" value="${esc(d.title||"")}"></label><label>Nachricht<textarea id="discord-message">${esc(d.message||"")}</textarea></label><label><input id="discord-embed" type="checkbox" ${d.embed!==false?"checked":""}> Embed-Modus</label><label><input id="discord-enabled" type="checkbox" ${d.enabled?"checked":""}> Live-Benachrichtigung aktiv</label><div class="button-row"><button id="discord-save" class="primary">Speichern</button><button id="discord-test">Testnachricht</button></div></div></article><article class="chatbot-card"><h3>Platzhalter</h3><p><code>{user}</code> <code>{streamer}</code> <code>{title}</code> <code>{game}</code> <code>{stream_url}</code> <code>{platform}</code> <code>{viewer_count}</code> <code>{start_time}</code> <code>{custom_text}</code> <code>{thumbnail}</code></p><div class="chatbot-note">Der Webhook bleibt lokal in der Chat-Bot-Konfiguration. Der Test sendet tatsächlich eine Discord-Nachricht an den eingetragenen Webhook.</div></article></div>`;
  }

  function mediaPage() {
    const overlay = snapshot?.overlay || {};
    const urls = overlay.urls || {};
    return `<div class="chatbot-grid"><article class="chatbot-card"><h3>Medienbibliothek</h3><p>MP3, WAV, OGG, MP4, WebM, PNG, JPG, WebP und GIF werden aus dem lokalen Chat-Bot-Medienordner geladen.</p><div class="chatbot-file"><code>${esc(snapshot?.mediaRoot||"")}</code><button id="media-open-folder">Ordner öffnen</button></div><div class="chatbot-note">Lege deine Dateien in diesen Ordner. In Commands und Events genügt anschließend der Dateiname, z. B. <code>boss.mp4</code>.</div><h3>Medien-Pools</h3><label>Pool-Konfiguration (JSON)<textarea id="media-pools" spellcheck="false">${esc(JSON.stringify(config().media?.pools||[],null,2))}</textarea></label><button id="media-pools-save">Pools speichern</button></article><article class="chatbot-card"><h3>OBS-Browser-Overlays</h3><p>Lokaler HTTP/WebSocket-Server. Die Seiten sind transparent und für OBS-Browserquellen vorgesehen.</p>${Object.entries(urls).map(([key,url])=>`<div class="chatbot-url"><code>${esc(url)}</code><button data-overlay-copy="${key}">Kopieren</button><button data-overlay-open="${key}">Öffnen</button></div>`).join("") || '<div class="chatbot-empty">Overlay-Server wird gestartet …</div>'}<div class="button-row"><button id="overlay-test-alert">Test-Alert</button><button id="overlay-test-tts">Test-TTS</button></div></article></div>`;
  }

  function logsPage() {
    const logs = snapshot?.logs || [];
    return `<article class="chatbot-card"><div class="chatbot-item-head"><h3>Chat-Bot-Logs</h3><button id="logs-refresh">Aktualisieren</button></div><div class="chatbot-log">${logs.length ? [...logs].reverse().map((entry)=>`<div class="chatbot-log-row"><span>${new Date(entry.time).toLocaleTimeString("de-DE")} · ${esc(entry.type)}</span><br>${esc(entry.message)}</div>`).join("") : '<div class="chatbot-empty">Noch keine Chat-Bot-Ereignisse.</div>'}</div></article>`;
  }

  function bind() {
    root.querySelectorAll("[data-chatbot-tab]").forEach((button) => button.onclick = () => { tab = button.dataset.chatbotTab; render(); });
    root.querySelector("#chatbot-enabled")?.addEventListener("change", async (e) => savePartial({ enabled: e.target.checked }));

    root.querySelector("#broadcast-new")?.addEventListener("click", () => { editingBroadcast = null; render(); });
    root.querySelectorAll("[data-broadcast-edit]").forEach((b)=>b.onclick=()=>{editingBroadcast=clone(config().broadcasts.find((x)=>x.id===b.dataset.broadcastEdit));render()});
    root.querySelectorAll("[data-broadcast-delete]").forEach((b)=>b.onclick=()=>removeById("broadcasts",b.dataset.broadcastDelete));
    root.querySelectorAll("[data-broadcast-test]").forEach((b)=>b.onclick=async()=>{const item=config().broadcasts.find((x)=>x.id===b.dataset.broadcastTest);if(!item)return;try{await api.testChatBotActions([{type:"chat",message:item.messages?.[0]||"Test",platforms:item.platforms}],{platform:item.platforms?.[0]||"twitch"});toast("Auto-Broadcast-Test ausgeführt.")}catch(e){toast(e.message,true)}});
    root.querySelector("#broadcast-save")?.addEventListener("click", saveBroadcast);
    root.querySelector("#broadcast-cancel")?.addEventListener("click",()=>{editingBroadcast=null;render()});

    root.querySelector("#command-new")?.addEventListener("click",()=>{editingCommand=null;render()});
    root.querySelectorAll("[data-command-edit]").forEach((b)=>b.onclick=()=>{editingCommand=clone(config().commands.find((x)=>x.id===b.dataset.commandEdit));render()});
    root.querySelectorAll("[data-command-delete]").forEach((b)=>b.onclick=()=>removeById("commands",b.dataset.commandDelete));
    root.querySelectorAll("[data-command-test]").forEach((b)=>b.onclick=async()=>{try{await api.testChatBotCommand(b.dataset.commandTest,"twitch");toast("Command-Test ausgeführt.")}catch(e){toast(e.message,true)}});
    root.querySelector("#command-action-add")?.addEventListener("click",()=>addEditorAction("command"));
    root.querySelector("#command-save")?.addEventListener("click",saveCommand);
    root.querySelector("#command-editor-test")?.addEventListener("click",async()=>{try{await api.testChatBotActions(collectActions("command"),{platform:"twitch"});toast("Aktionskette ausgeführt.")}catch(e){toast(e.message,true)}});
    root.querySelector("#command-cancel")?.addEventListener("click",()=>{editingCommand=null;render()});

    root.querySelector("#event-new")?.addEventListener("click",()=>{editingEvent=null;render()});
    root.querySelectorAll("[data-event-edit]").forEach((b)=>b.onclick=()=>{editingEvent=clone(config().events.find((x)=>x.id===b.dataset.eventEdit));render()});
    root.querySelectorAll("[data-event-delete]").forEach((b)=>b.onclick=()=>removeById("events",b.dataset.eventDelete));
    root.querySelectorAll("[data-event-test]").forEach((b)=>b.onclick=async()=>{const item=config().events.find((x)=>x.id===b.dataset.eventTest);try{await api.testChatBotActions(item.actions,{platform:item.platforms?.[0]||"twitch",trigger:item.trigger});toast("Event-Test ausgeführt.")}catch(e){toast(e.message,true)}});
    root.querySelector("#event-action-add")?.addEventListener("click",()=>addEditorAction("event"));
    root.querySelector("#event-save")?.addEventListener("click",saveEvent);
    root.querySelector("#event-editor-test")?.addEventListener("click",async()=>{try{await api.testChatBotActions(collectActions("event"),{platform:"twitch",trigger:root.querySelector("#event-trigger").value});toast("Event-Aktionen ausgeführt.")}catch(e){toast(e.message,true)}});
    root.querySelector("#event-cancel")?.addEventListener("click",()=>{editingEvent=null;render()});

    root.querySelectorAll(".action-type").forEach((select)=>select.onchange=()=>{const row=select.closest(".chatbot-action");row.querySelector(".action-json").value=JSON.stringify(actionDefaults(select.value),null,2)});
    root.querySelectorAll(".action-remove").forEach((button)=>button.onclick=()=>{button.closest(".chatbot-action").remove()});

    root.querySelector("#discord-save")?.addEventListener("click",saveDiscord);
    root.querySelector("#discord-test")?.addEventListener("click",async()=>{try{await saveDiscord(false);await api.testChatBotActions([{type:"discord-webhook",title:root.querySelector("#discord-title").value,body:root.querySelector("#discord-message").value,webhookUrl:root.querySelector("#discord-url").value}],{streamer:"Crazy_Batto",title:"Chat-Bot Test",platform:"twitch",stream_url:"https://twitch.tv/"});toast("Discord-Test gesendet.")}catch(e){toast(e.message,true)}});

    root.querySelector("#media-open-folder")?.addEventListener("click",()=>api.openChatBotMediaFolder().catch((e)=>toast(e.message,true)));
    root.querySelector("#media-pools-save")?.addEventListener("click",async()=>{try{const pools=JSON.parse(root.querySelector("#media-pools").value);await savePartial({media:{...(config().media||{}),pools}});toast("Medien-Pools gespeichert.")}catch(e){toast(e.message,true)}});
    root.querySelectorAll("[data-overlay-copy]").forEach((b)=>b.onclick=async()=>{await api.copyChatBotOverlayUrl(b.dataset.overlayCopy);toast("OBS-Adresse kopiert.")});
    root.querySelectorAll("[data-overlay-open]").forEach((b)=>b.onclick=()=>api.openChatBotOverlay(b.dataset.overlayOpen));
    root.querySelector("#overlay-test-alert")?.addEventListener("click",()=>api.testChatBotActions([{type:"overlay",message:"Batto Chat Bot Test",durationMs:4000}],{}).catch((e)=>toast(e.message,true)));
    root.querySelector("#overlay-test-tts")?.addEventListener("click",()=>api.testChatBotActions([{type:"tts",message:"Batto Chat Bot Test",volume:1}],{}).catch((e)=>toast(e.message,true)));
    root.querySelector("#logs-refresh")?.addEventListener("click",refresh);
  }

  function addEditorAction(owner) {
    const host = root.querySelector(`#${owner}-actions`) || root.querySelector(`[data-chatbot-page="${owner === "event" ? "events" : "commands"}"] .chatbot-actions`);
    if (!host) return;
    if (host.querySelector(".chatbot-empty")) host.innerHTML = "";
    const index = host.querySelectorAll(".chatbot-action").length;
    host.insertAdjacentHTML("beforeend", actionEditor(actionDefaults("chat"), index, owner));
    bindActionRows(host);
  }
  function bindActionRows(host) {
    host.querySelectorAll(".action-type").forEach((select)=>select.onchange=()=>{const row=select.closest(".chatbot-action");row.querySelector(".action-json").value=JSON.stringify(actionDefaults(select.value),null,2)});
    host.querySelectorAll(".action-remove").forEach((button)=>button.onclick=()=>button.closest(".chatbot-action").remove());
  }
  async function savePartial(partial) {
    snapshot = await api.saveChatBotConfig({ ...config(), ...partial });
    render();
    return snapshot;
  }
  async function removeById(key, itemId) {
    const list = (config()[key] || []).filter((item)=>item.id !== itemId);
    await savePartial({ [key]: list });
    toast("Eintrag gelöscht.");
  }
  async function saveBroadcast() {
    try {
      const current = editingBroadcast || { id: id("broadcast") };
      const item = { ...current, enabled: root.querySelector("#broadcast-enabled").checked, messages: root.querySelector("#broadcast-messages").value.split(/\r?\n/).map((x)=>x.trim()).filter(Boolean), platforms: readPlatforms("broadcast"), intervalMs: Number(root.querySelector("#broadcast-interval").value)*1000, startDelayMs:Number(root.querySelector("#broadcast-delay").value)*1000, onlyWhenLive:root.querySelector("#broadcast-live").checked, onlyWhenActive:root.querySelector("#broadcast-active").checked, rotation:true };
      const list = [...(config().broadcasts||[])]; const index=list.findIndex((x)=>x.id===item.id); if(index>=0)list[index]=item;else list.push(item);
      editingBroadcast=null; await savePartial({broadcasts:list}); toast("Auto-Broadcast gespeichert.");
    } catch(e){toast(e.message,true)}
  }
  async function saveCommand() {
    try {
      const current = editingCommand || { id: id("command") };
      const item = { ...current, command:root.querySelector("#command-name").value.trim().toLowerCase(), enabled:root.querySelector("#command-enabled").checked, platforms:readPlatforms("command"), permission:root.querySelector("#command-permission").value, cooldownMs:Number(root.querySelector("#command-cooldown").value)*1000, userCooldownMs:Number(root.querySelector("#command-user-cooldown").value)*1000, onlyWhenLive:root.querySelector("#command-live").checked, targetProcess:root.querySelector("#command-process").value.trim(), actions:collectActions("command") };
      if(!item.command.startsWith("!")) throw new Error("Der Command muss mit ! beginnen.");
      const list=[...(config().commands||[])];const index=list.findIndex((x)=>x.id===item.id);if(index>=0)list[index]=item;else list.push(item);
      editingCommand=null;await savePartial({commands:list});toast("Command gespeichert.");
    }catch(e){toast(e.message,true)}
  }
  async function saveEvent() {
    try {
      const current=editingEvent||{id:id("event")};const item={...current,trigger:root.querySelector("#event-trigger").value,enabled:root.querySelector("#event-enabled").checked,platforms:readPlatforms("event"),cooldownMs:Number(root.querySelector("#event-cooldown").value)*1000,actions:collectActions("event")};
      const list=[...(config().events||[])];const index=list.findIndex((x)=>x.id===item.id);if(index>=0)list[index]=item;else list.push(item);
      editingEvent=null;await savePartial({events:list});toast("Event gespeichert.");
    }catch(e){toast(e.message,true)}
  }
  async function saveDiscord(showToast=true) {
    const discord={...(config().discord||{}),enabled:root.querySelector("#discord-enabled").checked,webhookUrl:root.querySelector("#discord-url").value.trim(),title:root.querySelector("#discord-title").value,message:root.querySelector("#discord-message").value,embed:root.querySelector("#discord-embed").checked};
    await savePartial({discord}); if(showToast)toast("Discord-Einstellungen gespeichert.");
  }
  async function refresh() { try { snapshot=await api.getChatBotState();render(); }catch(e){root.innerHTML=`<div class="chatbot-empty">Chat Bot konnte nicht geladen werden: ${esc(e.message)}</div>`;} }

  api.onChatBotLog?.((entry)=>{if(!snapshot)return;snapshot.logs=snapshot.logs||[];snapshot.logs.push(entry);if(tab==="logs")render()});
  api.onChatBotState?.((state)=>{snapshot=state;render()});
  refresh();
})();
