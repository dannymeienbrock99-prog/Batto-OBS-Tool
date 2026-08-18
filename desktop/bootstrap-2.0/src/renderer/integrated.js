"use strict";

(() => {
  const api = window.batto;
  if (!api?.invoke) return;

  const pages = [
    ["stream-overlay", "◈", "Stream-Overlay", "Frei positionierbare lokale Browserquelle für Chat, Ziele, Geschenke, Logo und Ereignisse."],
    ["multi-chat", "◧", "Multi-Chat", "Twitch, YouTube und lokale TikTok-/TikFinity-/Tiktory-Ereignisse zusammenführen."],
    ["obs-guests", "♙", "OBS Gäste", "Vorhandene OBS-Quellen als Gastplätze in einer Szene ein- und ausblenden."],
    ["plugins", "◆", "Plugins", "Installierte Stream-Deck-Pakete und native Batto-Aktionen verwalten."],
    ["sotf", "☠", "SOTF Todeszähler", "CrazyBatto DeathCounter v0.3.0 lokal prüfen und als OBS-Overlay öffnen."],
    ["mobile", "▯", "Handy verbinden", "Lokale Kopplung über QR-Code, sechsstellige PIN und WebSocket."],
    ["integration", "⚒", "Übernahme & Diagnose", "Altdaten übernehmen und alle integrierten Module prüfen."]
  ];

  let state = null;
  let activeIntegratedPage = "";
  let pluginCategoryState = {};
  let guestItems = [];
  let guestSceneName = "";
  let pendingToast = null;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  function showToast(message, error = false) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = String(message || "");
    toast.className = `toast${error ? " error" : ""}`;
    toast.hidden = false;
    clearTimeout(pendingToast);
    pendingToast = setTimeout(() => { toast.hidden = true; }, 4200);
  }

  async function call(channel, payload = {}) {
    try {
      const value = await api.invoke(channel, payload);
      return value;
    } catch (error) {
      showToast(error?.message || error, true);
      throw error;
    }
  }

  function statusPill(active, on = "Aktiv", off = "Nicht aktiv") {
    return `<span class="status-pill ${active ? "online" : "offline"}">${escapeHtml(active ? on : off)}</span>`;
  }

  function addNavigationAndViews() {
    const nav = document.querySelector(".sidebar nav");
    const content = document.querySelector("main.content");
    const settingsButton = nav?.querySelector('[data-view="settings"]');
    if (!nav || !content || document.querySelector('[data-view="stream-overlay"]')) return;

    for (const [id, icon, label] of pages) {
      const button = document.createElement("button");
      button.className = "nav-button integrated-nav";
      button.dataset.view = id;
      button.innerHTML = `<span>${icon}</span> ${escapeHtml(label)}`;
      nav.insertBefore(button, settingsButton || null);
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        switchIntegratedPage(id);
      });
    }

    const viewMarkup = {
      "stream-overlay": streamOverlayMarkup(),
      "multi-chat": multiChatMarkup(),
      "obs-guests": guestsMarkup(),
      plugins: pluginsMarkup(),
      sotf: sotfMarkup(),
      mobile: mobileMarkup(),
      integration: integrationMarkup()
    };
    for (const [id, markup] of Object.entries(viewMarkup)) {
      const section = document.createElement("section");
      section.id = `view-${id}`;
      section.className = "view integrated-view";
      section.innerHTML = markup;
      content.append(section);
    }
    bindIntegratedEvents();
  }

  function switchIntegratedPage(id) {
    const meta = pages.find((page) => page[0] === id);
    if (!meta) return;
    activeIntegratedPage = id;
    $$(".view").forEach((view) => view.classList.toggle("active", view.id === `view-${id}`));
    $$(".nav-button").forEach((button) => button.classList.toggle("active", button.dataset.view === id));
    const title = document.getElementById("page-title");
    const subtitle = document.getElementById("page-subtitle");
    if (title) title.textContent = meta[2];
    if (subtitle) subtitle.textContent = meta[3];
    renderIntegratedPage(id);
  }

  function streamOverlayMarkup() {
    return `
      <div class="section-heading">
        <div><span class="eyebrow">LOKAL · TRANSPARENT · OHNE CLOUD</span><h2>Stream-Overlay</h2><p>Das neue Encoder-Monitoring bleibt vollständig erhalten. Dieses Modul ergänzt die frei gestaltbare Stream-Ebene aus dem früheren Setup.</p></div>
        <div class="button-row"><button id="stream-overlay-copy">OBS-Adresse kopieren</button><button id="stream-overlay-open" class="primary">Editor öffnen</button></div>
      </div>
      <div id="stream-overlay-status" class="module-status-grid"></div>
      <div class="two-column-cards">
        <article class="panel"><h3>Lokale Ereignisse testen</h3><p>Testdaten werden ausschließlich lokal in das Overlay gesendet.</p><div class="form-grid compact-form"><label>Typ<select id="stream-test-type"><option value="chat">Chat</option><option value="gift">Geschenk</option><option value="like">Likes</option><option value="heartRate">Herzfrequenz</option><option value="coHost">Co-Host</option><option value="wheel">Glücksrad</option><option value="poll">Umfrage</option></select></label><label>Name<input id="stream-test-name" value="Crazy_Batto"></label><label>Text / Ereignis<input id="stream-test-text" value="Testnachricht"></label><label>Wert<input id="stream-test-value" type="number" value="1"></label></div><div class="button-row"><button id="stream-test-send">Test auslösen</button><button id="stream-events-clear">Ereignisse leeren</button></div></article>
        <article class="panel"><h3>Enthaltene Elemente</h3><div class="tag-cloud"><span>Text</span><span>Follower-Ziel</span><span>Timer</span><span>Live-Chat</span><span>Geschenk-Feed</span><span>Topliste</span><span>Likes</span><span>Co-Host</span><span>Schatztruhe</span><span>Portal</span><span>Herzfrequenz</span><span>Umfrage</span><span>Wortwolke</span><span>Glücksrad</span><span>Team-Logo</span></div></article>
      </div>`;
  }

  function multiChatMarkup() {
    return `
      <div class="section-heading"><div><span class="eyebrow">TWITCH · YOUTUBE · LOKALE WEBHOOKS</span><h2>Multi-Chat</h2><p>TikTok, TikFinity und Tiktory senden weiterhin über den lokalen Stream-Overlay-Webhook. Twitch und YouTube können direkt verbunden werden.</p></div><div class="button-row"><button id="chat-test">Testnachricht</button><button id="chat-clear">Leeren</button></div></div>
      <div class="integrated-split">
        <aside class="panel chat-settings-panel">
          <h3>Plattformen</h3>
          <div class="toggle-grid" id="chat-platforms"></div>
          <label class="check-line"><input id="chat-forward" type="checkbox"> Nachrichten ins Stream-Overlay senden</label>
          <hr>
          <h3>Twitch</h3>
          <label>Kanal<input id="chat-twitch-channel" placeholder="crazy_batto"></label>
          <label>Bot-/Kontoname<input id="chat-twitch-name" placeholder="optional"></label>
          <label>OAuth-Token<input id="chat-twitch-token" type="password" placeholder="gespeichertes Token verwenden"></label>
          <div class="button-row"><button id="chat-twitch-connect">Verbinden</button><button id="chat-twitch-disconnect">Trennen</button></div>
          <hr>
          <h3>YouTube Live</h3>
          <label>API-Schlüssel<input id="chat-youtube-key" type="password" placeholder="gespeicherten Schlüssel verwenden"></label>
          <label>Live-Chat-ID<input id="chat-youtube-id"></label>
          <div class="button-row"><button id="chat-youtube-connect">Verbinden</button><button id="chat-youtube-disconnect">Trennen</button></div>
          <hr>
          <h3>Text-to-Speech</h3>
          <label class="check-line"><input id="chat-tts-enabled" type="checkbox"> Nachrichten lokal vorlesen</label>
          <label>Maximale Zeichen<input id="chat-tts-length" type="number" min="20" max="500" value="240"></label>
          <div class="button-row"><button id="chat-settings-save" class="primary">Einstellungen speichern</button><button id="chat-tts-clear">TTS stoppen</button></div>
        </aside>
        <section class="panel chat-live-panel"><header><div><h3>Live-Nachrichten</h3><p id="chat-status-line">Noch nicht verbunden.</p></div></header><div id="chat-message-list" class="chat-message-list"></div></section>
      </div>`;
  }

  function guestsMarkup() {
    return `
      <div class="section-heading"><div><span class="eyebrow">OBS-QUELLEN ALS GASTPLÄTZE</span><h2>OBS Co-Host- und Gästemodus</h2><p>Das Modul schaltet vorhandene Browser-, Kamera-, NDI- oder Aufnahmequellen innerhalb einer OBS-Szene. Es sendet keine Einladungen an TikTok-Server.</p></div></div>
      <article class="panel"><div class="guest-toolbar"><label>OBS-Szene<select id="guest-scene"><option>OBS verbinden</option></select></label><button id="guest-load">Quellen neu laden</button><button id="guest-add-all">Alle anzeigen</button><button id="guest-apply" class="primary">In OBS anwenden</button></div><div class="info-banner warning">TikTok-LIVE-Einladungen und Plattform-Co-Host-Sitzungen müssen weiterhin in TikTok selbst gestartet werden.</div><div id="guest-list" class="guest-list empty-state"><p>OBS verbinden und eine Szene auswählen.</p></div></article>`;
  }

  function pluginsMarkup() {
    return `
      <div class="section-heading"><div><span class="eyebrow">ELGATO SDK · NATIVE AKTIONEN · SICHERER IMPORT</span><h2>Plugin-System</h2><p>Originale, ungeschützte Elgato-Laufzeiten werden über die lokale WebSocket-API ausgeführt. Geschützte Marketplace-Pakete bleiben erkennbar und werden nicht umgangen.</p></div><div class="button-row"><button id="plugins-import">.streamDeckPlugin importieren</button><button id="plugins-import-folder">.sdPlugin-Ordner</button><button id="plugins-scan" class="primary">Neu scannen</button></div></div>
      <div id="plugin-summary" class="module-status-grid"></div>
      <div id="plugin-list" class="plugin-list"></div>`;
  }

  function sotfMarkup() {
    return `
      <div class="section-heading"><div><span class="eyebrow">CRAZYBATTO · REDLOADER · LOOPBACK-API</span><h2>Sons of the Forest Todeszähler</h2><p>Direkte Integration von CrazyBatto-SOTF-DeathCounter-Module-v0.3.0. Alle Daten bleiben auf 127.0.0.1.</p></div><div class="button-row"><button id="sotf-copy">OBS-Adresse kopieren</button><button id="sotf-refresh">Aktualisieren</button><button id="sotf-open" class="primary">Overlay öffnen</button></div></div>
      <div id="sotf-status" class="module-status-grid"></div>
      <div class="two-column-cards">
        <article class="panel"><h3>Spieler</h3><div id="sotf-players" class="connection-list"></div></article>
        <article class="panel"><h3>Letztes Ereignis</h3><div id="sotf-event" class="empty-state"><p>Noch kein Ereignis empfangen.</p></div><hr><p>Das RedLoader-Modul stellt Snapshot, Healthcheck und OBS-Overlay lokal auf Port 19447 bereit.</p></article>
      </div>`;
  }

  function mobileMarkup() {
    return `
      <div class="section-heading"><div><span class="eyebrow">LOKAL ÜBER WLAN · LAN · USB-TETHERING</span><h2>Handy verbinden</h2><p>QR-Code und PIN werden nur im lokalen Netzwerk verwendet. Es gibt keine Cloud-Anmeldung.</p></div><div class="button-row"><button id="mobile-new-pin">Neue PIN</button><button id="mobile-copy-address">Adresse kopieren</button></div></div>
      <div class="mobile-connect-layout">
        <article class="panel mobile-qr-card"><div id="mobile-active-pill"></div><img id="mobile-qr" alt="QR-Code für die Handy-Verbindung"><h3 id="mobile-pin">PIN ––––––</h3><code id="mobile-address">Server wird gestartet …</code><label class="check-line"><input id="mobile-approval" type="checkbox"> Neue Handys am PC bestätigen</label><details><summary>Kompatibilität mit der alten APK</summary><p>Zusätzlich wird ein QR-Code mit dem alten <code>creatorhub://pair</code>-Schema bereitgestellt.</p><img id="mobile-legacy-qr" alt="Kompatibilitäts-QR-Code"></details></article>
        <section class="panel"><h3>Kopplungsanfragen</h3><div id="mobile-pending" class="connection-list"></div><hr><h3>Verbundene Handys</h3><div id="mobile-clients" class="connection-list"></div><hr><h3>Netzwerkschnittstellen</h3><div id="mobile-networks" class="connection-list"></div></section>
      </div>`;
  }

  function integrationMarkup() {
    return `
      <div class="section-heading"><div><span class="eyebrow">DATENSICHERHEIT UND MODULSTATUS</span><h2>Übernahme & Diagnose</h2><p>Profile, Plugin-Daten und Icon-Pakete aus einer vorhandenen 1.8.6-Installation werden nur ergänzt. Neue Batto-Daten werden nicht überschrieben.</p></div><button id="migration-run" class="primary">Altdaten erneut suchen</button></div>
      <div id="integration-status" class="diagnostic-grid"></div>
      <article class="panel"><h3>Abnahmebedingungen</h3><ul class="check-list"><li>Eine Hauptanwendung und ein Installer</li><li>Kein separater alter Prozess</li><li>Lokale OBS-Adresse 127.0.0.1:4455</li><li>Dedizierte GPU wird bevorzugt</li><li>Monitoring-Overlay bleibt transparent</li><li>Touch-Deck-Belegungen bleiben bei Rasteränderungen erhalten</li><li>Plugin-Fehler werden sichtbar gemeldet</li><li>Handy-Verbindung läuft lokal mit PIN</li></ul></article>`;
  }

  function bindIntegratedEvents() {
    $("#stream-overlay-open")?.addEventListener("click", () => call("stream-overlay:open"));
    $("#stream-overlay-copy")?.addEventListener("click", async () => showToast(`OBS-Adresse kopiert: ${await call("stream-overlay:copy-url")}`));
    $("#stream-test-send")?.addEventListener("click", () => call("stream-overlay:event", { type: $("#stream-test-type").value, platform: "local", name: $("#stream-test-name").value, text: $("#stream-test-text").value, value: Number($("#stream-test-value").value) || 0 }));
    $("#stream-events-clear")?.addEventListener("click", () => call("stream-overlay:clear"));

    $("#chat-settings-save")?.addEventListener("click", saveChatSettings);
    $("#chat-twitch-connect")?.addEventListener("click", connectTwitch);
    $("#chat-twitch-disconnect")?.addEventListener("click", () => call("chat:twitch-disconnect"));
    $("#chat-youtube-connect")?.addEventListener("click", connectYouTube);
    $("#chat-youtube-disconnect")?.addEventListener("click", () => call("chat:youtube-disconnect"));
    $("#chat-test")?.addEventListener("click", () => call("chat:test", { platform: "twitch", name: "Crazy_Batto", text: "Lokale Multi-Chat-Testnachricht", role: "broadcaster" }));
    $("#chat-clear")?.addEventListener("click", () => call("chat:clear"));
    $("#chat-tts-clear")?.addEventListener("click", () => call("chat:tts-clear"));

    $("#guest-load")?.addEventListener("click", loadGuests);
    $("#guest-scene")?.addEventListener("change", loadGuests);
    $("#guest-add-all")?.addEventListener("click", () => $$('#guest-list input[type="checkbox"]').forEach((input) => { input.checked = true; }));
    $("#guest-apply")?.addEventListener("click", applyGuests);

    $("#plugins-scan")?.addEventListener("click", () => call("plugins:scan").then((plugins) => { state.plugins = plugins; renderPlugins(); }));
    $("#plugins-import")?.addEventListener("click", () => call("plugins:import").then(() => call("plugins:scan")).then((plugins) => { state.plugins = plugins; renderPlugins(); }));
    $("#plugins-import-folder")?.addEventListener("click", () => call("plugins:import-folder").then(() => call("plugins:scan")).then((plugins) => { state.plugins = plugins; renderPlugins(); }));

    $("#sotf-refresh")?.addEventListener("click", () => call("sotf:refresh").then((value) => { state.modules.sotfDeathCounter = value; renderSotf(); }));
    $("#sotf-open")?.addEventListener("click", () => call("sotf:open-overlay"));
    $("#sotf-copy")?.addEventListener("click", async () => showToast(`OBS-Adresse kopiert: ${await call("sotf:copy-overlay")}`));

    $("#mobile-new-pin")?.addEventListener("click", () => call("mobile:regenerate-pin").then((mobile) => { state.mobile = mobile; renderMobile(); }));
    $("#mobile-copy-address")?.addEventListener("click", async () => { const value = state?.mobile?.qr?.web || ""; await navigator.clipboard.writeText(value); showToast("Handy-Adresse kopiert."); });
    $("#mobile-approval")?.addEventListener("change", () => call("mobile:approval", { required: $("#mobile-approval").checked }).then((mobile) => { state.mobile = mobile; renderMobile(); }));

    $("#migration-run")?.addEventListener("click", () => call("migration:run").then((migration) => { state.migration = migration; renderIntegration(); }));
  }

  async function refreshState() {
    state = await call("state:get");
    renderIntegratedPage(activeIntegratedPage);
    return state;
  }

  function renderIntegratedPage(id) {
    if (!state) return;
    if (id === "stream-overlay") renderStreamOverlay();
    if (id === "multi-chat") renderMultiChat();
    if (id === "obs-guests") renderGuests();
    if (id === "plugins") renderPlugins();
    if (id === "sotf") renderSotf();
    if (id === "mobile") renderMobile();
    if (id === "integration") renderIntegration();
  }

  function renderStreamOverlay() {
    const status = state?.modules?.streamOverlay || {};
    const target = $("#stream-overlay-status");
    if (!target) return;
    target.innerHTML = `
      <article><span>Status</span><strong>${statusPill(Boolean(status.active))}</strong></article>
      <article><span>OBS-Browserquelle</span><code>${escapeHtml(status.overlayUrl || "Nicht verfügbar")}</code></article>
      <article><span>Lokaler Webhook</span><code>${escapeHtml(status.eventUrl || "Nicht verfügbar")}</code></article>
      <article><span>Aktive Browserquellen</span><strong>${escapeHtml(status.clients ?? 0)}</strong></article>`;
  }

  function chatSettingsFromUi() {
    const platforms = {};
    $$('#chat-platforms input[data-platform]').forEach((input) => { platforms[input.dataset.platform] = input.checked; });
    return {
      enabledPlatforms: platforms,
      forwardToOverlay: $("#chat-forward").checked,
      twitch: { channel: $("#chat-twitch-channel").value.trim(), nickname: $("#chat-twitch-name").value.trim() },
      youtube: { liveChatId: $("#chat-youtube-id").value.trim() },
      tts: { enabled: $("#chat-tts-enabled").checked, maximumLength: Number($("#chat-tts-length").value) || 240 }
    };
  }

  async function saveChatSettings() {
    const payload = { settings: chatSettingsFromUi() };
    if ($("#chat-twitch-token").value) payload.twitchOauth = $("#chat-twitch-token").value;
    if ($("#chat-youtube-key").value) payload.youtubeApiKey = $("#chat-youtube-key").value;
    state.chat = await call("chat:update-settings", payload);
    $("#chat-twitch-token").value = "";
    $("#chat-youtube-key").value = "";
    renderMultiChat();
    showToast("Multi-Chat-Einstellungen gespeichert.");
  }

  async function connectTwitch() {
    await saveChatSettings();
    state.chat = await call("chat:twitch-connect", { channel: $("#chat-twitch-channel").value.trim(), nickname: $("#chat-twitch-name").value.trim() });
    renderMultiChat();
  }

  async function connectYouTube() {
    await saveChatSettings();
    state.chat = await call("chat:youtube-connect", { liveChatId: $("#chat-youtube-id").value.trim() });
    renderMultiChat();
  }

  function renderMultiChat() {
    const chat = state?.chat || {};
    const settings = chat.settings || {};
    const platforms = settings.enabledPlatforms || {};
    const platformTarget = $("#chat-platforms");
    if (!platformTarget) return;
    platformTarget.innerHTML = ["twitch", "youtube", "tiktok", "tikfinity", "tiktory"].map((platform) => `<label class="check-line"><input type="checkbox" data-platform="${platform}" ${platforms[platform] !== false ? "checked" : ""}> ${escapeHtml(platform === "youtube" ? "YouTube" : platform === "twitch" ? "Twitch" : platform === "tiktok" ? "TikTok" : platform === "tikfinity" ? "TikFinity" : "Tiktory")}</label>`).join("");
    $("#chat-forward").checked = settings.forwardToOverlay !== false;
    $("#chat-twitch-channel").value = settings.twitch?.channel || "";
    $("#chat-twitch-name").value = settings.twitch?.nickname || "";
    $("#chat-youtube-id").value = settings.youtube?.liveChatId || "";
    $("#chat-tts-enabled").checked = Boolean(settings.tts?.enabled);
    $("#chat-tts-length").value = String(settings.tts?.maximumLength || 240);
    $("#chat-status-line").textContent = `Twitch: ${chat.status?.twitch ? "verbunden" : "getrennt"} · YouTube: ${chat.status?.youtube ? "verbunden" : "getrennt"} · Lokaler Webhook: ${chat.status?.localWebhook ? "aktiv" : "inaktiv"}`;
    const list = $("#chat-message-list");
    list.innerHTML = (chat.messages || []).slice(-200).reverse().map((message) => `<article class="chat-row platform-${escapeHtml(message.platform)}"><header><strong>${escapeHtml(message.name)}</strong><span>${escapeHtml(message.platform)} · ${new Date(message.timestamp).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}</span></header><p>${escapeHtml(message.text)}</p></article>`).join("") || '<div class="empty-state"><p>Noch keine Nachricht empfangen.</p></div>';
  }

  function renderGuests() {
    const select = $("#guest-scene");
    if (!select) return;
    const scenes = state?.obs?.scenes || [];
    const current = guestSceneName || state?.obs?.currentProgramSceneName || scenes[0]?.sceneName || "";
    select.innerHTML = scenes.length ? scenes.map((scene) => `<option value="${escapeHtml(scene.sceneName)}" ${scene.sceneName === current ? "selected" : ""}>${escapeHtml(scene.sceneName)}</option>`).join("") : "<option>OBS verbinden</option>";
    guestSceneName = select.value || current;
    const target = $("#guest-list");
    if (!guestItems.length) {
      target.className = "guest-list empty-state";
      target.innerHTML = `<p>${state?.obs?.connected ? "Quellen für die ausgewählte Szene neu laden." : "OBS ist nicht verbunden."}</p>`;
      return;
    }
    target.className = "guest-list";
    target.innerHTML = guestItems.map((item) => `<label class="guest-row"><input type="checkbox" data-scene-item-id="${Number(item.sceneItemId)}" ${item.sceneItemEnabled ? "checked" : ""}><span><strong>${escapeHtml(item.sourceName)}</strong><small>${escapeHtml(item.inputKind || item.sourceType || "OBS-Quelle")}</small></span></label>`).join("");
  }

  async function loadGuests() {
    guestSceneName = $("#guest-scene").value;
    const result = await call("guests:list", { sceneName: guestSceneName });
    guestItems = result.items || [];
    renderGuests();
  }

  async function applyGuests() {
    const slots = $$('#guest-list input[data-scene-item-id]').map((input) => ({ sceneItemId: Number(input.dataset.sceneItemId), enabled: input.checked }));
    await call("guests:apply", { sceneName: guestSceneName, slots });
    showToast("Gastquellen in OBS aktualisiert.");
    await loadGuests();
  }

  function renderPlugins() {
    const snapshot = state?.plugins || { plugins: [], iconPacks: [] };
    const plugins = snapshot.plugins || [];
    const summary = $("#plugin-summary");
    if (!summary) return;
    summary.innerHTML = `<article><span>Aktive Plugins</span><strong>${plugins.filter((plugin) => plugin.enabled).length}</strong></article><article><span>Original-Laufzeiten</span><strong>${plugins.filter((plugin) => plugin.runtime?.status === "ready" && !plugin.native).length}</strong></article><article><span>Erkannte Aktionen</span><strong>${plugins.reduce((sum, plugin) => sum + (plugin.actions?.length || 0), 0)}</strong></article><article><span>Scanfehler</span><strong>${snapshot.errors?.length || 0}</strong></article>`;
    const groups = Map.groupBy ? Map.groupBy(plugins, (plugin) => plugin.category || "Plugin") : plugins.reduce((map, plugin) => { const key = plugin.category || "Plugin"; if (!map.has(key)) map.set(key, []); map.get(key).push(plugin); return map; }, new Map());
    const list = $("#plugin-list");
    list.replaceChildren(...[...groups.entries()].map(([category, items]) => {
      const section = document.createElement("section");
      section.className = "plugin-category panel";
      const open = pluginCategoryState[category] !== false;
      section.innerHTML = `<button type="button" class="plugin-category-toggle"><span>${open ? "⌄" : "›"}</span><strong>${escapeHtml(category)}</strong><small>${items.length}</small></button><div class="plugin-category-body" ${open ? "" : "hidden"}></div>`;
      const body = $(".plugin-category-body", section);
      body.replaceChildren(...items.map((plugin) => pluginCard(plugin)));
      $(".plugin-category-toggle", section).addEventListener("click", () => { pluginCategoryState[category] = !open; renderPlugins(); });
      return section;
    }));
  }

  function pluginCard(plugin) {
    const card = document.createElement("article");
    card.className = `plugin-card${plugin.enabled ? "" : " disabled"}`;
    const runtimeLabel = plugin.native ? "Nativ" : plugin.runtime?.status === "ready" ? "Original-Laufzeit bereit" : plugin.runtime?.status === "protected" ? "Elgato-App erforderlich" : "Laufzeit nicht verfügbar";
    card.innerHTML = `<header>${plugin.icon ? `<img src="${escapeHtml(plugin.icon)}" alt="">` : ""}<div><strong>${escapeHtml(plugin.name)}</strong><span>${escapeHtml(plugin.version || "")} · ${escapeHtml(runtimeLabel)}</span></div><label class="switch"><input type="checkbox" ${plugin.enabled ? "checked" : ""}><span></span></label></header><p>${escapeHtml(plugin.description || plugin.status || "")}</p><details><summary>${plugin.actions?.length || 0} Aktion(en)</summary><div class="plugin-actions">${(plugin.actions || []).filter((action) => action.visibleInActionsList !== false).map((action) => `<div><strong>${escapeHtml(action.name)}</strong><code>${escapeHtml(action.id)}</code></div>`).join("") || "<p>Keine Aktionen im Manifest.</p>"}</div></details><small class="plugin-status">${escapeHtml(plugin.status || "")}</small>`;
    $("input[type=checkbox]", card).addEventListener("change", async (event) => {
      state.plugins = await call("plugins:enable", { pluginId: plugin.id, enabled: event.target.checked });
      renderPlugins();
    });
    return card;
  }

  function renderSotf() {
    const module = state?.modules?.sotfDeathCounter || {};
    const snapshot = module.snapshot || null;
    const target = $("#sotf-status");
    if (!target) return;
    target.innerHTML = `
      <article><span>Status</span><strong>${statusPill(Boolean(module.connected), "RedLoader verbunden", "Modul nicht erreichbar")}</strong></article>
      <article><span>Online / bekannt</span><strong>${Number(snapshot?.onlinePlayers || 0)} / ${Number(snapshot?.knownPlayers || 0)}</strong></article>
      <article><span>Session</span><code>${escapeHtml(snapshot?.sessionId || "Noch keine Daten")}</code></article>
      <article><span>OBS-Browserquelle</span><code>${escapeHtml(module.overlayUrl || "http://127.0.0.1:19447/overlay")}</code></article>`;
    const players = $("#sotf-players");
    players.innerHTML = (snapshot?.players || []).map((player) => `<article><span><strong>${escapeHtml(player.name)}</strong><small>${player.online ? "online" : "offline"} · ${escapeHtml(player.state)}</small></span><code>${Number(player.sessionDeaths || 0)} Session · ${Number(player.lifetimeDeaths || 0)} gesamt</code></article>`).join("")
      || `<div class="empty-state"><p>${escapeHtml(module.error || "RedLoader-Modul starten, dann aktualisieren.")}</p></div>`;
    const event = snapshot?.lastEvent;
    $("#sotf-event").innerHTML = event
      ? `<article class="diagnostic-card ok"><span>☠</span><div><strong>${escapeHtml(event.playerName || event.playerId)}</strong><p>${Number(event.sessionDeaths || 0)} Session-Tode · ${escapeHtml(event.reason || event.type)}</p><small>${escapeHtml(event.atUtc || "")}</small></div></article>`
      : '<div class="empty-state"><p>Noch kein Todesereignis empfangen.</p></div>';
  }

  function renderMobile() {
    const mobile = state?.mobile || {};
    if (!$("#mobile-active-pill")) return;
    $("#mobile-active-pill").innerHTML = statusPill(Boolean(mobile.active), "Lokaler Server aktiv", "Server nicht aktiv");
    $("#mobile-pin").textContent = `PIN ${mobile.pin || "––––––"}`;
    $("#mobile-address").textContent = mobile.qr?.web || "Nicht verfügbar";
    $("#mobile-approval").checked = mobile.requireApproval !== false;
    $("#mobile-qr").src = mobile.qr?.webDataUrl || "";
    $("#mobile-legacy-qr").src = mobile.qr?.legacyDataUrl || "";
    $("#mobile-pending").innerHTML = (mobile.pendingClients || []).map((client) => `<article><span><strong>${escapeHtml(client.name)}</strong><small>${escapeHtml(client.address)} · ${client.legacy ? "alte APK" : "Batto"}</small></span><div><button data-approve="${escapeHtml(client.requestId)}">Annehmen</button><button data-reject="${escapeHtml(client.requestId)}">Ablehnen</button></div></article>`).join("") || '<p class="muted-line">Keine offene Anfrage.</p>';
    $("#mobile-clients").innerHTML = (mobile.connectedClients || []).map((client) => `<article><span><strong>${escapeHtml(client.name)}</strong><small>${escapeHtml(client.address)}</small></span><button data-revoke="${escapeHtml(client.clientId)}">Trennen</button></article>`).join("") || '<p class="muted-line">Kein Handy verbunden.</p>';
    $("#mobile-networks").innerHTML = (mobile.addresses || []).map((entry) => `<article><span><strong>${escapeHtml(entry.type)}</strong><small>${escapeHtml(entry.interfaceName)}</small></span><code>${escapeHtml(entry.address)}</code></article>`).join("") || '<p class="muted-line">Keine lokale IPv4-Adresse gefunden.</p>';
    $$('#mobile-pending [data-approve]').forEach((button) => button.addEventListener("click", () => call("mobile:approve", { requestId: button.dataset.approve }).then((value) => { state.mobile = value; renderMobile(); })));
    $$('#mobile-pending [data-reject]').forEach((button) => button.addEventListener("click", () => call("mobile:reject", { requestId: button.dataset.reject }).then((value) => { state.mobile = value; renderMobile(); })));
    $$('#mobile-clients [data-revoke]').forEach((button) => button.addEventListener("click", () => call("mobile:revoke", { clientId: button.dataset.revoke }).then((value) => { state.mobile = value; renderMobile(); })));
  }

  function renderIntegration() {
    const target = $("#integration-status");
    if (!target) return;
    const modules = state?.modules || {};
    const migration = state?.migration || {};
    const checks = [
      ["Hardwarediagnose", Boolean(state.hardware), state.hardware?.preferredGpu?.name || "Noch nicht gescannt"],
      ["OBS WebSocket", Boolean(state.obs?.connected), state.obs?.connected ? `${state.obs.host}:${state.obs.port}` : state.obs?.lastError || "Nicht verbunden"],
      ["Monitoring-Overlay", Boolean(modules.monitoring?.active || modules.monitoring?.running), modules.monitoring?.overlayUrl || modules.monitoring?.error || "Nicht aktiv"],
      ["Stream-Overlay", Boolean(modules.streamOverlay?.active), modules.streamOverlay?.overlayUrl || modules.streamOverlay?.error || "Nicht aktiv"],
      ["Twitch-Hologramm", Boolean(modules.twitchHolo?.active), modules.twitchHolo?.overlayUrl || modules.twitchHolo?.error || "Nicht aktiv"],
      ["Handy-Brücke", Boolean(state.mobile?.active), state.mobile?.active ? `Port ${state.mobile.port}` : "Nicht aktiv"],
      ["Plugin-Registry", Boolean(state.plugins?.plugins?.length), `${state.plugins?.plugins?.length || 0} Plugins · ${state.plugins?.iconPacks?.length || 0} Icon-Pakete`],
      ["Elgato Plugin-Host", Boolean(modules.streamDeckPlugins), `${modules.streamDeckPlugins?.sessions?.filter((session) => session.connected).length || 0} originale Laufzeit(en) verbunden`],
      ["SOTF Todeszähler", Boolean(modules.sotfDeathCounter?.connected), modules.sotfDeathCounter?.connected ? `${modules.sotfDeathCounter.snapshot?.onlinePlayers || 0} Spieler online` : modules.sotfDeathCounter?.error || "RedLoader-Modul nicht aktiv"],
      ["Altdaten-Übernahme", !(migration.errors?.length), `${migration.profilesAdded || 0} Profile ergänzt · ${migration.copied?.length || 0} Dateien kopiert`]
    ];
    target.innerHTML = checks.map(([name, ok, detail]) => `<article class="diagnostic-card ${ok ? "ok" : "warning"}"><span>${ok ? "✓" : "!"}</span><div><strong>${escapeHtml(name)}</strong><p>${escapeHtml(detail)}</p></div></article>`).join("");
  }

  async function initialize() {
    addNavigationAndViews();
    state = await api.invoke("state:get");
    api.onStateChanged((next) => {
      state = next;
      if (activeIntegratedPage) renderIntegratedPage(activeIntegratedPage);
    });
    api.onPairRequest((request) => {
      showToast(`Handy „${request.name}“ möchte gekoppelt werden.`);
      if (activeIntegratedPage === "mobile") renderMobile();
    });
  }

  initialize().catch((error) => console.error("Integrated UI:", error));
})();
