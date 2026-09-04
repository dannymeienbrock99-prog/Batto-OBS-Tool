"use strict";

(() => {
  const api = window.batto;
  const root = document.getElementById("multi-chat-root");
  if (!api || !root) return;

  const platformMeta = {
    all: ["Alle", "#5aa7ff", "✦"],
    twitch: ["Twitch", "#9146ff", "◉"],
    tiktok: ["TikTok", "#111111", "♪"],
    cng: ["CNG", "#2f9cff", "◆"],
    youtube: ["YouTube", "#ff3030", "▶"]
  };
  let filter = "all";
  let messages = [];
  let moderation = {};
  let moderationPlatform = "twitch";
  let contextMessage = null;
  let ttsConfig = { enabled: false, language: "de-DE", rate: 1, pitch: 1, volume: 1, cooldownMs: 1200, maxQueue: 20, maxCommentLength: 220, chat: true, events: true, announcePlatforms: ["twitch","tiktok","cng","youtube"], blockUsers: [], allowUsers: [] };
  const ttsQueue = [];
  let ttsRunning = false;
  let lastTts = 0;

  function esc(value) { return String(value ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;"); }
  function value(id) { return root.querySelector(`#${id}`)?.value.trim() || ""; }
  function stateFor(platform) { return moderation?.[platform] || { moderators: [], muted: [], blocked: [], history: [] }; }
  function has(list, username) { return Array.isArray(list) && list.some((item) => item.toLowerCase() === String(username).toLowerCase()); }

  function render() {
    root.innerHTML = `<div class="multi-chat">
      <header class="chat-head">
        <div class="chat-title"><span style="font-size:18px">✦</span><div><strong>BATTO MULTI-CHAT</strong><small>Twitch · TikTok · CNG · YouTube</small></div></div>
        <div class="chat-actions"><button class="icon-btn" id="chat-settings-btn" title="Chat- und Moderationseinstellungen">⚙</button><button class="icon-btn" id="chat-undock-btn" title="Abdocken">↗</button></div>
      </header>
      <nav class="chat-tabs">${Object.entries(platformMeta).map(([key,v]) => `<button class="chat-tab ${filter===key?'active':''}" data-filter="${key}">${v[0]}</button>`).join("")}</nav>
      <section class="chat-body" id="chat-body"></section>
      <section class="chat-compose"><textarea id="chat-input" maxlength="1000" placeholder="Nachricht schreiben …"></textarea><div class="compose-row"><small>Versand über die gewählte Plattform, sofern unterstützt</small><button class="send-btn" id="chat-send">Senden</button></div></section>
      <footer class="chat-footer"><span id="chat-status">● Bereit</span><span id="chat-count">0 Nachrichten</span></footer>
      <aside class="chat-settings" id="chat-settings" hidden>${settingsHtml()}</aside>
      <div class="moderation-menu" id="moderation-menu" hidden></div>
    </div>`;
    bind();
    updateBody();
  }

  function settingsHtml() {
    return `<div class="settings-section"><h3>Verbindungen</h3><div class="status-grid" id="chat-status-grid"></div></div>
      <div class="settings-section"><h3>Moderation</h3>
        <div class="moderation-tabs">${["twitch","tiktok","cng","youtube"].map((p)=>`<button data-mod-platform="${p}" class="${moderationPlatform===p?'active':''}">${platformMeta[p][0]}</button>`).join("")}</div>
        <div id="moderation-overview"></div>
      </div>
      <div class="settings-section"><h3>Twitch</h3><label>Kanal<input id="cfg-twitch-channel" placeholder="dein_channel"></label><label>OAuth-Token<input id="cfg-twitch-token" type="password" placeholder="oauth-…"></label><label>Username<input id="cfg-twitch-user" placeholder="batto_reader"></label><button id="cfg-twitch-connect">Twitch verbinden</button></div>
      <div class="settings-section"><h3>CNG</h3><label>Persönliche CNG-Chat-URL<input id="cfg-cng-chat" placeholder="https://cng-plattform.com/chat-popout/…"></label><label>Persönliche Alert-URL<input id="cfg-cng-alert" placeholder="https://cng-plattform.com/alert-overlay…"></label><div class="settings-actions"><button id="cfg-cng-save">Speichern</button><button id="cfg-cng-connect">Verbinden</button></div></div>
      <div class="settings-section"><h3>TikTok LIVE</h3><label>LIVE-Username<input id="cfg-tiktok-user" placeholder="@username"></label><button id="cfg-tiktok-connect">TikTok verbinden</button></div>
      <div class="settings-section"><h3>YouTube</h3><label>Video-ID<input id="cfg-youtube-video" placeholder="Live-Video-ID"></label><button id="cfg-youtube-connect">YouTube vorbereiten</button></div>
      <div class="settings-section"><h3>Batto TTS</h3><label><input id="tts-enabled" type="checkbox"> Chat-TTS aktiv</label><label>Sprache<select id="tts-language"><option>de-DE</option><option>en-US</option><option>en-GB</option><option>fr-FR</option><option>es-ES</option><option>it-IT</option><option>pt-BR</option><option>ja-JP</option><option>ko-KR</option></select></label><label>Stimme<select id="tts-voice"><option value="">Systemstimme</option></select></label><label>Geschwindigkeit<input id="tts-rate" type="range" min="0.5" max="2" step="0.05" value="1"></label><label>Tonhöhe<input id="tts-pitch" type="range" min="0" max="2" step="0.05" value="1"></label><label>Lautstärke<input id="tts-volume" type="range" min="0" max="1" step="0.05" value="1"></label></div>
      <div class="settings-actions"><button id="chat-clear">Chat leeren</button><button id="chat-settings-close">Schließen</button></div>`;
  }

  function bind() {
    root.querySelectorAll("[data-filter]").forEach((button) => button.onclick = () => { filter = button.dataset.filter; render(); void refreshSettings(); });
    root.querySelector("#chat-settings-btn").onclick = () => { const el = root.querySelector("#chat-settings"); el.hidden = !el.hidden; if (!el.hidden) void refreshSettings(); };
    root.querySelector("#chat-settings-close").onclick = () => root.querySelector("#chat-settings").hidden = true;
    root.querySelector("#chat-clear").onclick = async () => { await api.chatClear(filter); messages = []; updateBody(); };
    root.querySelector("#chat-undock-btn").onclick = () => api.chatToggleWindow();
    root.querySelector("#chat-send").onclick = sendCurrentMessage;
    root.querySelector("#chat-input").addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendCurrentMessage(); } });

    root.querySelector("#cfg-twitch-connect").onclick = async () => { try { await api.chatConnect("twitch", { channel: value("cfg-twitch-channel"), token: value("cfg-twitch-token"), username: value("cfg-twitch-user") }); await refreshSettings(); } catch (error) { alert(error.message); } };
    root.querySelector("#cfg-cng-save").onclick = async () => { try { await api.saveCngConfig({ chat: { url: value("cfg-cng-chat") }, alerts: { url: value("cfg-cng-alert") } }); await refreshSettings(); } catch (error) { alert(error.message); } };
    root.querySelector("#cfg-cng-connect").onclick = async () => { try { await api.chatConnect("cng", await api.getCngConfig()); await refreshSettings(); } catch (error) { alert(error.message); } };
    root.querySelector("#cfg-tiktok-connect").onclick = async () => { try { await api.chatConnect("tiktok", { username: value("cfg-tiktok-user") }); await refreshSettings(); } catch (error) { alert(error.message); } };
    root.querySelector("#cfg-youtube-connect").onclick = async () => { try { await api.chatConnect("youtube", { videoId: value("cfg-youtube-video") }); await refreshSettings(); } catch (error) { alert(error.message); } };
    root.querySelector("#tts-enabled").onchange = saveTts;
    ["tts-language","tts-voice","tts-rate","tts-pitch","tts-volume"].forEach((id) => root.querySelector(`#${id}`).onchange = saveTts);
    root.querySelectorAll("[data-mod-platform]").forEach((button) => button.onclick = () => { moderationPlatform = button.dataset.modPlatform; renderModerationOverview(); root.querySelectorAll("[data-mod-platform]").forEach((item) => item.classList.toggle("active", item.dataset.modPlatform === moderationPlatform)); });
    document.addEventListener("click", closeContextMenu, { once: true });
  }

  async function sendCurrentMessage() {
    const input = root.querySelector("#chat-input");
    const text = input.value.trim();
    if (!text) return;
    const platform = filter === "all" ? null : filter;
    if (!platform) { alert("Bitte zuerst Twitch, TikTok, CNG oder YouTube auswählen."); return; }
    try { await api.chatSend(platform, text); input.value = ""; }
    catch (error) { alert(error.message); }
  }

  function moderationBadge(message) {
    const state = stateFor(message.platform);
    if (has(state.moderators, message.username)) return '<span class="chat-role mod">MOD</span>';
    if (has(state.blocked, message.username)) return '<span class="chat-role blocked">BLOCKIERT</span>';
    if (has(state.muted, message.username)) return '<span class="chat-role muted">STUMM</span>';
    return "";
  }

  function updateBody() {
    const body = root.querySelector("#chat-body");
    const visible = messages.filter((m) => filter === "all" || m.platform === filter).slice(-300);
    root.querySelector("#chat-count").textContent = `${visible.length} Nachrichten`;
    if (!visible.length) {
      body.innerHTML = '<div class="chat-empty"><div><strong>Noch keine Nachrichten</strong><br><small>Verbinde Twitch, TikTok, CNG oder YouTube.</small></div></div>';
      return;
    }
    body.innerHTML = visible.map((m, index) => {
      const meta = platformMeta[m.platform] || platformMeta.cng;
      return `<div class="chat-row" data-message-index="${index}"><span class="platform-badge" style="background:${esc(m.color || meta[1])}">${meta[2]}</span><div><div class="chat-meta"><button class="chat-user user-context" data-user="${esc(m.username)}" data-platform="${esc(m.platform)}" data-message-id="${esc(m.id || "")}" style="color:${esc(m.color || meta[1])}">${esc(m.username)}</button><span class="chat-role">${esc(meta[0])}</span>${m.role ? `<span class="chat-role">${esc(m.role)}</span>` : ""}${moderationBadge(m)}</div><div class="chat-message">${esc(m.message)}</div></div></div>`;
    }).join("");
    body.querySelectorAll(".user-context").forEach((button) => button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      const row = button.closest(".chat-row");
      const shownIndex = Number(row.dataset.messageIndex);
      contextMessage = visible[shownIndex];
      openContextMenu(event.clientX, event.clientY, contextMessage);
    }));
    body.scrollTop = body.scrollHeight;
  }

  function openContextMenu(x, y, message) {
    const menu = root.querySelector("#moderation-menu");
    const state = stateFor(message.platform);
    const isMod = has(state.moderators, message.username);
    const isMuted = has(state.muted, message.username);
    const isBlocked = has(state.blocked, message.username);
    menu.innerHTML = `<div class="moderation-menu-title">${esc(message.username)} <small>${esc(platformMeta[message.platform]?.[0] || message.platform)}</small></div>
      <button data-mod-action="${isMod ? 'moderator-remove' : 'moderator-add'}">${isMod ? 'Als Moderator entfernen' : 'Als Moderator hinzufügen'}</button>
      <button data-mod-action="${isMuted ? 'unmute' : 'mute'}">${isMuted ? 'Stummschaltung aufheben' : 'Stummschalten'}</button>
      <button data-mod-action="${isBlocked ? 'unblock' : 'block'}">${isBlocked ? 'Blockierung aufheben' : 'Blockieren'}</button>
      <button data-copy-last>Letzte Nachricht kopieren</button>`;
    menu.style.left = `${Math.max(8, x)}px`;
    menu.style.top = `${Math.max(8, y)}px`;
    menu.hidden = false;
    menu.querySelectorAll("[data-mod-action]").forEach((button) => button.onclick = async (event) => { event.stopPropagation(); await applyModeration(button.dataset.modAction, message); menu.hidden = true; });
    menu.querySelector("[data-copy-last]").onclick = async (event) => { event.stopPropagation(); await navigator.clipboard.writeText(message.message || ""); menu.hidden = true; };
  }

  function closeContextMenu() {
    const menu = root.querySelector("#moderation-menu");
    if (menu) menu.hidden = true;
  }

  async function applyModeration(action, message) {
    let reason = "";
    if (action === "mute" || action === "block") reason = window.prompt("Grund für die Moderationsaktion (optional):", message.message ? `Letzte Nachricht: ${message.message}` : "") || "";
    const result = await api.applyModeration({
      platform: message.platform,
      action,
      username: message.username,
      userId: message.userId || "",
      reason,
      lastMessage: message.message || "",
      actor: "Crazy_Batto"
    });
    moderation[message.platform] = result.state;
    updateBody();
    renderModerationOverview();
  }

  function renderModerationOverview() {
    const host = root.querySelector("#moderation-overview");
    if (!host) return;
    const state = stateFor(moderationPlatform);
    const list = (items, empty) => items.length ? `<div class="mod-list">${items.map((item)=>`<span>${esc(item)}</span>`).join("")}</div>` : `<small>${empty}</small>`;
    host.innerHTML = `<div class="mod-columns">
      <div><strong>Moderatoren</strong>${list(state.moderators, "Keine Moderatoren eingetragen.")}</div>
      <div><strong>Stummgeschaltet</strong>${list(state.muted, "Niemand stummgeschaltet.")}</div>
      <div><strong>Blockiert</strong>${list(state.blocked, "Niemand blockiert.")}</div>
    </div>
    <div class="moderation-history"><strong>Verlauf</strong>${state.history.length ? state.history.slice().reverse().slice(0,100).map((entry)=>`<div class="history-row"><span>${new Date(entry.timestamp).toLocaleString("de-DE")}</span><b>${esc(entry.username)}</b><span>${esc(entry.action)}</span><small>${esc(entry.reason || entry.lastMessage || "Kein Grund angegeben")}</small></div>`).join("") : '<small>Noch keine Moderationsaktionen.</small>'}</div>`;
  }

  async function refreshSettings() {
    const statuses = await api.chatStatuses();
    const grid = root.querySelector("#chat-status-grid");
    if (grid) grid.innerHTML = Object.entries(statuses).map(([p,s]) => `<div class="status-card"><strong>${esc(platformMeta[p]?.[0] || p)}</strong><small><span class="dot ${s.connected?'on':''}"></span>${s.connected?'Verbunden':s.configured?'Konfiguriert':'Getrennt'}</small></div>`).join("");
    moderation = await api.getModerationState();
    renderModerationOverview();
    const cng = await api.getCngConfig();
    if (cng && root.querySelector("#cfg-cng-chat")) { root.querySelector("#cfg-cng-chat").value = cng.chat?.url || ""; root.querySelector("#cfg-cng-alert").value = cng.alerts?.url || ""; }
    const tts = await api.getTtsConfig();
    if (tts) {
      ttsConfig = { ...ttsConfig, ...tts };
      root.querySelector("#tts-enabled").checked = ttsConfig.enabled;
      root.querySelector("#tts-language").value = ttsConfig.language;
      root.querySelector("#tts-rate").value = ttsConfig.rate;
      root.querySelector("#tts-pitch").value = ttsConfig.pitch;
      root.querySelector("#tts-volume").value = ttsConfig.volume;
    }
    loadVoices();
    updateBody();
  }

  async function saveTts() {
    ttsConfig = { ...ttsConfig, enabled: root.querySelector("#tts-enabled").checked, language: value("tts-language"), voice: value("tts-voice"), rate: Number(root.querySelector("#tts-rate").value), pitch: Number(root.querySelector("#tts-pitch").value), volume: Number(root.querySelector("#tts-volume").value) };
    await api.saveTtsConfig(ttsConfig);
  }

  function loadVoices() {
    const select = root.querySelector("#tts-voice");
    if (!select || !window.speechSynthesis) return;
    const voices = window.speechSynthesis.getVoices();
    const current = select.value;
    select.innerHTML = '<option value="">Systemstimme</option>' + voices.map((v) => `<option value="${esc(v.name)}">${esc(v.name)} · ${esc(v.lang)}</option>`).join("");
    select.value = current;
  }

  function acceptBatch(batch) {
    for (const message of batch) {
      messages.push(message);
      if (messages.length > 500) messages.splice(0, messages.length - 500);
      speak(message);
    }
    updateBody();
  }

  function speak(message) {
    if (!ttsConfig.enabled || !ttsConfig.chat || !ttsConfig.announcePlatforms?.includes(message.platform) || !message.message) return;
    if (has(stateFor(message.platform).blocked, message.username) || has(stateFor(message.platform).muted, message.username)) return;
    const text = message.message.slice(0, ttsConfig.maxCommentLength || 220);
    if (Date.now() - lastTts < (ttsConfig.cooldownMs || 1200) || ttsQueue.length >= (ttsConfig.maxQueue || 20)) return;
    if (ttsConfig.blockUsers?.includes(message.username)) return;
    if (ttsConfig.allowUsers?.length && !ttsConfig.allowUsers.includes(message.username)) return;
    ttsQueue.push(`${message.username} sagt: ${text}`);
    pumpTts();
  }

  function pumpTts() {
    if (ttsRunning || !ttsQueue.length || !window.speechSynthesis) return;
    const text = ttsQueue.shift();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = ttsConfig.language; utterance.rate = ttsConfig.rate; utterance.pitch = ttsConfig.pitch; utterance.volume = ttsConfig.volume;
    const voice = window.speechSynthesis.getVoices().find((v) => v.name === ttsConfig.voice); if (voice) utterance.voice = voice;
    ttsRunning = true; lastTts = Date.now();
    utterance.onend = utterance.onerror = () => { ttsRunning = false; setTimeout(pumpTts, ttsConfig.cooldownMs || 1200); };
    window.speechSynthesis.speak(utterance);
  }

  async function init() {
    render();
    moderation = await api.getModerationState();
    messages = await api.chatHistory({ limit: 300 });
    updateBody();
    api.onChatMessages(acceptBatch);
    api.onChatStatus(() => { const el = root.querySelector("#chat-status"); if (el) el.textContent = "● Verbindungen aktualisiert"; });
    api.onChatWindow((state) => { const button = root.querySelector("#chat-undock-btn"); if (button) button.textContent = state.undocked ? "↙" : "↗"; });
    if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = loadVoices;
    await refreshSettings();
  }

  init().catch((error) => { root.innerHTML = `<div class="chat-empty"><strong>Multi-Chat konnte nicht starten:</strong><br>${esc(error.message)}</div>`; });
})();
