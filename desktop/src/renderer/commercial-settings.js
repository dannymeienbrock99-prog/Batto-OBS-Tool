"use strict";

(() => {
  const $ = (id) => document.getElementById(id);
  const view = $("view-settings");
  if (!view || !window.batto?.getState || !window.batto?.saveSettings) return;

  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);

  function check(id, label, hint = "") {
    return `<label class="cs-toggle"><input id="${id}" type="checkbox"><span><strong>${label}</strong>${hint ? `<small>${hint}</small>` : ""}</span></label>`;
  }

  view.innerHTML = `
    <div class="section-heading cs-heading">
      <div><span class="eyebrow">PRODUKTKONFIGURATION</span><h2>Einstellungen</h2><p>Alle Verbindungen, Plattformen und Creator-Funktionen zentral und nachvollziehbar konfigurieren.</p></div>
      <div class="button-row"><span id="cs-save-state" class="inline-message"></span><button id="cs-save" class="primary">Alles speichern</button></div>
    </div>
    <div class="cs-layout">
      <nav class="cs-tabs" aria-label="Einstellungskategorien">
        <button class="active" data-cs-tab="general">Allgemein</button>
        <button data-cs-tab="obs">OBS</button>
        <button data-cs-tab="tiktok">TikTok</button>
        <button data-cs-tab="twitch">Twitch</button>
        <button data-cs-tab="youtube">YouTube</button>
        <button data-cs-tab="cng">CNG</button>
        <button data-cs-tab="chat">Multi-Chat</button>
        <button data-cs-tab="moderation">Moderation</button>
        <button data-cs-tab="overlays">Overlays</button>
      </nav>
      <div class="cs-content">
        <section class="cs-page active" data-cs-page="general">
          <article class="panel form-panel"><h3>Allgemein</h3>
            <label>Sprache<select id="cs-language"><option value="de-DE">Deutsch</option><option value="en-US">English</option></select></label>
            <label>Standardplattform<select id="cs-platform"><option value="tiktok">TikTok</option><option value="twitch">Twitch</option><option value="youtube">YouTube</option><option value="cng">CNG</option><option value="recording">Lokale Aufnahme</option><option value="custom">Eigene Plattform</option></select></label>
            <label>Zielauflösung<select id="cs-resolution"><option value="1280x720">1280 × 720</option><option value="1920x1080">1920 × 1080</option><option value="2560x1440">2560 × 1440</option><option value="3840x2160">3840 × 2160</option></select></label>
            <label>FPS<select id="cs-fps"><option value="30">30</option><option value="60">60</option><option value="120">120</option></select></label>
            ${check("cs-updates", "Nach Updates suchen")}
            ${check("cs-diagnostics", "Diagnosefunktionen aktivieren")}
          </article>
        </section>
        <section class="cs-page" data-cs-page="obs">
          <article class="panel form-panel"><h3>OBS WebSocket</h3>
            <label>Host<input id="cs-obs-host" value="127.0.0.1" readonly></label>
            <label>Port<input id="cs-obs-port" type="number" min="1" max="65535" value="4455"></label>
            ${check("cs-obs-auto", "Beim Start automatisch verbinden")}
            ${check("cs-obs-reconnect", "Verbindung automatisch wiederherstellen")}
            <label>Wiederverbindung nach<input id="cs-obs-delay" type="number" min="1000" max="30000" step="500"><small>Millisekunden</small></label>
            ${check("cs-obs-scenes", "Szenenstatus synchronisieren")}
            ${check("cs-obs-browser", "Browser-Overlays automatisch aktualisieren")}
            <div class="info-banner">Das OBS-WebSocket-Passwort wird weiterhin separat über Windows safeStorage gespeichert und erscheint nicht in dieser Konfigurationsdatei.</div>
          </article>
        </section>
        <section class="cs-page" data-cs-page="tiktok">
          <article class="panel form-panel"><h3>TikTok LIVE</h3>
            ${check("cs-tiktok-enabled", "TikTok aktivieren")}
            <label>Provider<select id="cs-tiktok-provider"><option value="eulerstream">Euler Stream</option><option value="connector">TikTok LIVE Connector</option></select></label>
            <label>TikTok @Name<input id="cs-tiktok-user" placeholder="@deinname"></label>
            ${check("cs-tiktok-auto", "Automatisch verbinden")}
            <div class="cs-check-grid">${check("cs-tiktok-chat", "Chat")}${check("cs-tiktok-gifts", "Geschenke")}${check("cs-tiktok-follows", "Follower")}${check("cs-tiktok-shares", "Shares")}${check("cs-tiktok-likes", "Likes")}${check("cs-tiktok-mod", "Moderation")}</div>
          </article>
        </section>
        <section class="cs-page" data-cs-page="twitch">
          <article class="panel form-panel"><h3>Twitch</h3>
            ${check("cs-twitch-enabled", "Twitch aktivieren")}
            <label>Kanal<input id="cs-twitch-channel" placeholder="kanalname"></label>
            <label>Benutzername<input id="cs-twitch-user" placeholder="bot/creator name"></label>
            ${check("cs-twitch-auto", "Automatisch verbinden")}
            ${check("cs-twitch-chat", "Chat aktivieren")}
            ${check("cs-twitch-mod", "Moderationsaktionen aktivieren")}
            ${check("cs-twitch-holo", "Twitch-Hologramm aktivieren")}
          </article>
        </section>
        <section class="cs-page" data-cs-page="youtube">
          <article class="panel form-panel"><h3>YouTube Live</h3>
            ${check("cs-youtube-enabled", "YouTube aktivieren")}
            <label>Channel-ID<input id="cs-youtube-channel"></label>
            <label>Live-Chat-ID<input id="cs-youtube-chatid"></label>
            ${check("cs-youtube-auto", "Automatisch verbinden")}
            ${check("cs-youtube-chat", "Live-Chat aktivieren")}
          </article>
        </section>
        <section class="cs-page" data-cs-page="cng">
          <article class="panel form-panel"><h3>CNG – Kleine Creator. Große Zukunft.</h3>
            ${check("cs-cng-enabled", "CNG aktivieren")}
            <label>Profilname<input id="cs-cng-user"></label>
            <label>Plattform-URL<input id="cs-cng-base"></label>
            <label>API-Basis-URL<input id="cs-cng-api" placeholder="Nur eintragen, wenn verfügbar"></label>
            <label>WebSocket-URL<input id="cs-cng-ws" placeholder="wss://…"></label>
            ${check("cs-cng-auto", "Automatisch verbinden")}
            ${check("cs-cng-chat", "Chat aktivieren")}
          </article>
        </section>
        <section class="cs-page" data-cs-page="chat">
          <article class="panel form-panel"><h3>Multi-Chat</h3>
            ${check("cs-chat-enabled", "Unified Multi-Chat aktivieren")}
            ${check("cs-chat-badge", "Plattform-Badge anzeigen")}
            ${check("cs-chat-time", "Zeitstempel anzeigen")}
            ${check("cs-chat-avatar", "Avatare anzeigen")}
            ${check("cs-chat-links", "Links filtern")}
            ${check("cs-chat-words", "Wortfilter aktivieren")}
            ${check("cs-chat-tts", "Text-to-Speech aktivieren")}
            <label>Maximale Nachrichten<input id="cs-chat-max" type="number" min="50" max="5000"></label>
          </article>
        </section>
        <section class="cs-page" data-cs-page="moderation">
          <article class="panel form-panel"><h3>Moderation</h3>
            ${check("cs-mod-context", "Rechtsklick-Aktionen im Chat", "Sperren, stummschalten oder Moderationsaktionen direkt am Namen.")}
            ${check("cs-mod-ban", "Sperren immer bestätigen")}
            ${check("cs-mod-timeout", "Stummschalten bestätigen")}
            ${check("cs-mod-blocked", "Liste gesperrter Nutzer behalten")}
            ${check("cs-mod-muted", "Liste stummgeschalteter Nutzer behalten")}
          </article>
        </section>
        <section class="cs-page" data-cs-page="overlays">
          <article class="panel form-panel"><h3>OBS-Overlays</h3>
            ${check("cs-overlay-chat", "Chat-Overlay")}
            ${check("cs-overlay-gifts", "Geschenke-Overlay")}
            ${check("cs-overlay-alerts", "Alerts")}
            ${check("cs-overlay-monitor", "Monitoring-Overlay")}
            <label>BrowserSource-Port<input id="cs-overlay-port" type="number" min="1" max="65535"></label>
          </article>
        </section>
      </div>
    </div>`;

  document.querySelectorAll("[data-cs-tab]").forEach((button) => button.addEventListener("click", () => {
    document.querySelectorAll("[data-cs-tab]").forEach((item) => item.classList.toggle("active", item === button));
    document.querySelectorAll("[data-cs-page]").forEach((page) => page.classList.toggle("active", page.dataset.csPage === button.dataset.csTab));
  }));

  const setChecked = (id, value) => { if ($(id)) $(id).checked = Boolean(value); };
  const setValue = (id, value) => { if ($(id)) $(id).value = value ?? ""; };

  async function load() {
    const snapshot = await window.batto.getState();
    const s = snapshot.settings || {};
    setValue("cs-language", s.product?.language || "de-DE");
    setValue("cs-platform", s.preferences?.platform || "twitch");
    setValue("cs-resolution", s.preferences?.targetResolution || "1920x1080");
    setValue("cs-fps", String(s.preferences?.targetFps || 60));
    setChecked("cs-updates", s.product?.checkForUpdates !== false);
    setChecked("cs-diagnostics", s.product?.diagnosticsEnabled !== false);
    setValue("cs-obs-host", s.obs?.host || "127.0.0.1");
    setValue("cs-obs-port", s.obs?.port || 4455);
    setChecked("cs-obs-auto", s.obs?.autoConnect !== false);
    setChecked("cs-obs-reconnect", s.obs?.reconnect !== false);
    setValue("cs-obs-delay", s.obs?.reconnectDelayMs || 3000);
    setChecked("cs-obs-scenes", s.obs?.sceneSync !== false);
    setChecked("cs-obs-browser", s.obs?.browserOverlayAutoRefresh !== false);

    const t = s.platforms?.tiktok || {};
    setChecked("cs-tiktok-enabled", t.enabled); setValue("cs-tiktok-provider", t.provider || "eulerstream"); setValue("cs-tiktok-user", t.username); setChecked("cs-tiktok-auto", t.autoConnect); setChecked("cs-tiktok-chat", t.chat !== false); setChecked("cs-tiktok-gifts", t.gifts !== false); setChecked("cs-tiktok-follows", t.follows !== false); setChecked("cs-tiktok-shares", t.shares !== false); setChecked("cs-tiktok-likes", t.likes !== false); setChecked("cs-tiktok-mod", t.moderation !== false);
    const tw = s.platforms?.twitch || {};
    setChecked("cs-twitch-enabled", tw.enabled); setValue("cs-twitch-channel", tw.channel); setValue("cs-twitch-user", tw.username); setChecked("cs-twitch-auto", tw.autoConnect); setChecked("cs-twitch-chat", tw.chat !== false); setChecked("cs-twitch-mod", tw.moderation !== false); setChecked("cs-twitch-holo", tw.holoOverlay !== false);
    const yt = s.platforms?.youtube || {};
    setChecked("cs-youtube-enabled", yt.enabled); setValue("cs-youtube-channel", yt.channelId); setValue("cs-youtube-chatid", yt.liveChatId); setChecked("cs-youtube-auto", yt.autoConnect); setChecked("cs-youtube-chat", yt.chat !== false);
    const c = s.platforms?.cng || {};
    setChecked("cs-cng-enabled", c.enabled); setValue("cs-cng-user", c.username); setValue("cs-cng-base", c.baseUrl || "https://cng-plattform.com"); setValue("cs-cng-api", c.apiBaseUrl); setValue("cs-cng-ws", c.websocketUrl); setChecked("cs-cng-auto", c.autoConnect); setChecked("cs-cng-chat", c.chat !== false);
    const ch = s.chat || {};
    setChecked("cs-chat-enabled", ch.unifiedEnabled !== false); setChecked("cs-chat-badge", ch.showPlatformBadge !== false); setChecked("cs-chat-time", ch.showTimestamps !== false); setChecked("cs-chat-avatar", ch.showAvatars !== false); setChecked("cs-chat-links", ch.filterLinks); setChecked("cs-chat-words", ch.filterBlockedWords); setChecked("cs-chat-tts", ch.ttsEnabled); setValue("cs-chat-max", ch.maxMessages || 500);
    const m = s.moderation || {};
    setChecked("cs-mod-context", m.rightClickActions !== false); setChecked("cs-mod-ban", m.confirmBan !== false); setChecked("cs-mod-timeout", m.confirmTimeout); setChecked("cs-mod-blocked", m.keepBlockedList !== false); setChecked("cs-mod-muted", m.keepMutedList !== false);
    const o = s.overlays || {};
    setChecked("cs-overlay-chat", o.chatEnabled !== false); setChecked("cs-overlay-gifts", o.giftsEnabled !== false); setChecked("cs-overlay-alerts", o.alertsEnabled !== false); setChecked("cs-overlay-monitor", o.monitoringEnabled !== false); setValue("cs-overlay-port", o.browserSourcePort || 17824);
  }

  function checked(id) { return Boolean($(id)?.checked); }
  function value(id) { return $(id)?.value ?? ""; }

  $("cs-save").addEventListener("click", async () => {
    const status = $("cs-save-state");
    status.textContent = "Speichere …";
    try {
      await window.batto.saveSettings({
        product: { language: value("cs-language"), checkForUpdates: checked("cs-updates"), diagnosticsEnabled: checked("cs-diagnostics") },
        obs: { host: "127.0.0.1", port: Number(value("cs-obs-port")), autoConnect: checked("cs-obs-auto"), reconnect: checked("cs-obs-reconnect"), reconnectDelayMs: Number(value("cs-obs-delay")), sceneSync: checked("cs-obs-scenes"), browserOverlayAutoRefresh: checked("cs-obs-browser") },
        preferences: { platform: value("cs-platform"), targetResolution: value("cs-resolution"), targetFps: Number(value("cs-fps")) },
        platforms: {
          tiktok: { enabled: checked("cs-tiktok-enabled"), provider: value("cs-tiktok-provider"), username: value("cs-tiktok-user"), autoConnect: checked("cs-tiktok-auto"), chat: checked("cs-tiktok-chat"), gifts: checked("cs-tiktok-gifts"), follows: checked("cs-tiktok-follows"), shares: checked("cs-tiktok-shares"), likes: checked("cs-tiktok-likes"), moderation: checked("cs-tiktok-mod") },
          twitch: { enabled: checked("cs-twitch-enabled"), channel: value("cs-twitch-channel"), username: value("cs-twitch-user"), autoConnect: checked("cs-twitch-auto"), chat: checked("cs-twitch-chat"), moderation: checked("cs-twitch-mod"), holoOverlay: checked("cs-twitch-holo") },
          youtube: { enabled: checked("cs-youtube-enabled"), channelId: value("cs-youtube-channel"), liveChatId: value("cs-youtube-chatid"), autoConnect: checked("cs-youtube-auto"), chat: checked("cs-youtube-chat") },
          cng: { enabled: checked("cs-cng-enabled"), username: value("cs-cng-user"), baseUrl: value("cs-cng-base"), apiBaseUrl: value("cs-cng-api"), websocketUrl: value("cs-cng-ws"), autoConnect: checked("cs-cng-auto"), chat: checked("cs-cng-chat") }
        },
        chat: { unifiedEnabled: checked("cs-chat-enabled"), showPlatformBadge: checked("cs-chat-badge"), showTimestamps: checked("cs-chat-time"), showAvatars: checked("cs-chat-avatar"), filterLinks: checked("cs-chat-links"), filterBlockedWords: checked("cs-chat-words"), ttsEnabled: checked("cs-chat-tts"), maxMessages: Number(value("cs-chat-max")) },
        moderation: { rightClickActions: checked("cs-mod-context"), confirmBan: checked("cs-mod-ban"), confirmTimeout: checked("cs-mod-timeout"), keepBlockedList: checked("cs-mod-blocked"), keepMutedList: checked("cs-mod-muted") },
        overlays: { chatEnabled: checked("cs-overlay-chat"), giftsEnabled: checked("cs-overlay-gifts"), alertsEnabled: checked("cs-overlay-alerts"), monitoringEnabled: checked("cs-overlay-monitor"), browserSourcePort: Number(value("cs-overlay-port")) }
      });
      status.textContent = "Gespeichert";
      setTimeout(() => { status.textContent = ""; }, 2500);
    } catch (error) {
      status.textContent = `Fehler: ${esc(error?.message || error)}`;
    }
  });

  load().catch((error) => { $("cs-save-state").textContent = `Ladefehler: ${esc(error?.message || error)}`; });
})();
