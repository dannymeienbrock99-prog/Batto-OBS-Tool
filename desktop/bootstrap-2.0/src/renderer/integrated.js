"use strict";

(() => {
  const api = window.batto;
  if (!api?.invoke) return;

  const pages = [
    ["stream-overlay", "◈", "Stream-Overlay", "Frei positionierbare lokale Browserquelle für Chat, Ziele, Geschenke, Logo und Ereignisse."],
    ["multi-chat", "◧", "Multi-Chat", "Twitch, YouTube und TikFinity zusammenführen, lokal vorlesen und im Hologramm anzeigen."],
    ["heart-rate", "♥", "Herzfrequenz", "Pulsoid oder einen direkten Bluetooth-Herzfrequenzsensor mit dem lokalen OBS-Overlay verbinden."],
    ["obs-guests", "♙", "OBS Gäste", "Vorhandene OBS-Quellen als Gastplätze in einer Szene ein- und ausblenden."],
    ["sotf", "☠", "SOTF Todeszähler", "Das gebündelte CrazyBatto-Modul installieren, lokal prüfen und mit OBS verbinden."],
    ["mobile", "▯", "Handy verbinden", "Lokale Kopplung über QR-Code, sechsstellige PIN und WebSocket."],
    ["integration", "⚒", "Übernahme & Diagnose", "Altdaten übernehmen und alle integrierten Module prüfen."]
  ];

  let state = null;
  let activeIntegratedPage = "";
  let guestItems = [];
  let guestSceneName = "";
  let pendingToast = null;
  let chatVoices = [];
  let chatVoicesLoaded = false;
  let chatSettingsDirty = false;
  let heartSettingsDirty = false;
  let renderedChatIds = [];
  let bluetoothCandidates = [];
  let bleDevice = null;
  let bleHeartCharacteristic = null;
  let bleConnecting = false;

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
      "heart-rate": heartRateMarkup(),
      "obs-guests": guestsMarkup(),
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
    $$(".nav-button:not(.integrated-nav)").forEach((button) => button.addEventListener("click", () => {
      activeIntegratedPage = "";
      $("#chat-holo-frame")?.removeAttribute("src");
      $("#heart-preview-frame")?.removeAttribute("src");
    }));
    bindIntegratedEvents();
  }

  function switchIntegratedPage(id) {
    const meta = pages.find((page) => page[0] === id);
    if (!meta) return;
    activeIntegratedPage = id;
    if (id !== "multi-chat") $("#chat-holo-frame")?.removeAttribute("src");
    if (id !== "heart-rate") $("#heart-preview-frame")?.removeAttribute("src");
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
      <div class="section-heading"><div><span class="eyebrow">TWITCH · YOUTUBE · TIKFINITY · WINDOWS-STIMMEN</span><h2>Multi-Chat &amp; Hologramm</h2><p>Nachrichten laufen in einem lokalen Feed zusammen, werden auf Wunsch mit einer installierten Windows-Stimme vorgelesen und direkt an die OBS-Hologrammquelle weitergegeben.</p></div><div class="button-row"><button id="chat-holo-copy">Hologramm-URL kopieren</button><button id="chat-holo-open" class="primary">Farben &amp; Hologramm bearbeiten</button></div></div>
      <div class="chat-workspace">
        <aside id="chat-settings-panel" class="panel chat-settings-panel">
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
          <h3>TikFinity Desktop</h3>
          <label>Lokale WebSocket-Adresse<input id="chat-tikfinity-url" spellcheck="false" value="ws://127.0.0.1:21213/"></label>
          <label class="check-line"><input id="chat-tikfinity-auto" type="checkbox"> Beim Programmstart lokal verbinden</label>
          <div class="button-row"><button id="chat-tikfinity-connect">Verbinden</button><button id="chat-tikfinity-disconnect">Trennen</button></div>
          <p class="field-note">Die TikFinity-Desktop-App muss laufen. Es werden nur lokale Ereignisse von <code>127.0.0.1</code> angenommen.</p>
          <hr>
          <h3>Lokales Vorlesen</h3>
          <label class="check-line"><input id="chat-tts-enabled" type="checkbox"> Nachrichten lokal vorlesen</label>
          <label>Installierte Windows-Stimme<select id="chat-tts-voice"><option value="">Systemstandard</option></select></label>
          <div class="range-grid"><label>Sprechtempo <output id="chat-tts-rate-output">0</output><input id="chat-tts-rate" type="range" min="-10" max="10" step="1" value="0"></label><label>Lautstärke <output id="chat-tts-volume-output">100 %</output><input id="chat-tts-volume" type="range" min="0" max="100" step="1" value="100"></label></div>
          <label class="check-line"><input id="chat-tts-name" type="checkbox"> Namen vor der Nachricht mitlesen</label>
          <label>Maximale Zeichen<input id="chat-tts-length" type="number" min="20" max="500" value="240"></label>
          <div class="button-row"><button id="chat-tts-skip">Aktuelle Stimme überspringen</button><button id="chat-tts-clear">Alles stoppen</button></div>
          <hr>
          <h3>Lokale Chat-Befehle</h3>
          <label class="check-line"><input id="chat-bot-enabled" type="checkbox"> Befehle aktivieren</label>
          <label>Befehlspräfix<input id="chat-bot-prefix" maxlength="4" value="!"></label>
          <span class="field-label">Berechtigte Rollen</span>
          <div id="chat-bot-roles" class="role-grid"></div>
          <label class="check-line"><input id="chat-bot-speak" type="checkbox"> Befehlsnachrichten ebenfalls vorlesen</label>
          <div class="button-row sticky-actions"><button id="chat-settings-save" class="primary">Einstellungen speichern</button></div>
        </aside>
        <section class="chat-main-column">
          <div id="chat-status-grid" class="module-status-grid chat-status-grid"></div>
          <article class="panel chat-preview-panel">
            <header class="panel-heading"><div><span class="eyebrow">ECHTE LOKALE BROWSERQUELLE</span><h3>Hologramm-Livevorschau</h3><p id="chat-holo-status">Lokaler Overlay-Server wird geprüft …</p></div><button id="chat-holo-clear">Hologramm leeren</button></header>
            <div id="chat-holo-roles" class="holo-role-strip"></div>
            <div class="browser-preview"><iframe id="chat-holo-frame" title="Lokale Hologramm-Livevorschau"></iframe></div>
          </article>
          <article class="panel chat-test-panel">
            <header class="panel-heading"><div><h3>Explizite lokale Testnachricht</h3><p>Wird wie eine echte Chatnachricht in Feed, Hologramm und – falls aktiviert – TTS verarbeitet.</p></div><button id="chat-clear">Chat leeren</button></header>
            <div class="chat-test-grid"><label>Plattform<select id="chat-test-platform"><option value="twitch">Twitch</option><option value="youtube">YouTube</option><option value="tiktok">TikTok / TikFinity</option><option value="local">Lokal</option></select></label><label>Name<input id="chat-test-name" maxlength="120" value="Crazy_Batto"></label><label>Rolle<select id="chat-test-role"><option value="broadcaster">Streamer</option><option value="moderator">Moderator</option><option value="vip">VIP</option><option value="subscriber">Subscriber</option><option value="viewer">Zuschauer</option></select></label><label class="chat-test-message">Nachricht<input id="chat-test-text" maxlength="500" value="Willkommen im Team Alpha Chat!"></label><button id="chat-test" class="primary">Lokal senden</button></div>
          </article>
          <article class="panel chat-live-panel"><header class="panel-heading"><div><h3>Live-Nachrichten</h3><p id="chat-status-line">Noch nicht verbunden.</p></div><span id="chat-tts-queue" class="status-pill neutral">TTS 0</span></header><div id="chat-message-list" class="chat-message-list"></div></article>
        </section>
      </div>`;
  }

  function heartRateMarkup() {
    return `
      <div class="section-heading"><div><span class="eyebrow">PULSOID CLOUD · DIREKTES BLUETOOTH LE · LOKALES OBS-OVERLAY</span><h2>Herzfrequenz</h2><p>Verbinde Pulsoid oder einen Sensor mit dem Bluetooth Heart Rate Service. Das OBS-Bild bleibt lokal; Zugangstoken werden nicht im Formular angezeigt.</p></div><div class="button-row"><button id="heart-copy-overlay">OBS-Adresse kopieren</button><button id="heart-open-overlay">Overlay im Browser öffnen</button></div></div>
      <div id="heart-status-grid" class="module-status-grid"></div>
      <div class="heart-layout">
        <aside class="heart-connections">
          <article class="panel source-card" data-heart-source="pulsoid">
            <header><span class="source-icon">P</span><div><h3>Pulsoid Cloud</h3><p>Für Smartwatches und Pulsoid-kompatible Geräte.</p></div><span id="heart-pulsoid-pill"></span></header>
            <label>Access Token mit <code>data:heart_rate:read</code><input id="heart-pulsoid-token" type="password" autocomplete="off" placeholder="Gespeichertes Token verwenden"></label>
            <label class="check-line"><input id="heart-auto-connect" type="checkbox"> Beim Start automatisch verbinden</label>
            <div class="button-row"><button id="heart-pulsoid-connect" class="primary">Pulsoid verbinden</button><button id="heart-pulsoid-disconnect">Trennen</button><button id="heart-pulsoid-forget" class="danger-button">Token vergessen</button></div>
            <p class="field-note">Der Token wird über Windows safeStorage gespeichert. Der OBS-Link enthält keinen Token.</p>
          </article>
          <article class="panel source-card" data-heart-source="ble">
            <header><span class="source-icon heart-icon">♥</span><div><h3>Direktes Bluetooth LE</h3><p>Für Brustgurte und Sensoren mit Standarddienst 0x180D.</p></div><span id="heart-ble-pill"></span></header>
            <p id="heart-ble-device" class="device-name">Noch kein Sensor verbunden.</p>
            <div class="button-row"><button id="heart-ble-connect" class="primary">Sensor suchen</button><button id="heart-ble-disconnect">Trennen</button></div>
            <div id="heart-ble-candidates" class="ble-candidates" hidden></div>
            <p class="field-note">Smartwatches stellen den Standarddienst unter Windows nicht immer direkt bereit. In diesem Fall die Uhr mit Pulsoid verbinden.</p>
          </article>
        </aside>
        <section class="heart-preview-column">
          <article class="panel heart-preview-panel">
            <header class="panel-heading"><div><span class="eyebrow">ECHTE LOKALE BROWSERVORSCHAU</span><h3>OBS-Ausgabe</h3><p>Diese Vorschau lädt dieselbe lokale URL wie eine OBS-Browserquelle.</p></div><code id="heart-overlay-url">Wird gestartet …</code></header>
            <div class="browser-preview heart-browser-preview"><iframe id="heart-preview-frame" title="Lokale Herzfrequenz-Overlayvorschau"></iframe></div>
            <div class="local-preview-control"><div><strong>Lokalen Vorschaumesswert senden</strong><small>Nur zum Einrichten des Layouts; keine echte Messung.</small></div><input id="heart-preview-bpm" type="number" min="25" max="250" value="82" aria-label="Lokaler Vorschaumesswert in BPM"><button id="heart-preview-send">Vorschau senden</button></div>
          </article>
          <article id="heart-style-panel" class="panel heart-style-panel">
            <header class="panel-heading"><div><h3>Overlay-Stil</h3><p>Änderungen gelten direkt für die lokale OBS-Browserquelle.</p></div><button id="heart-style-save" class="primary">Stil übernehmen</button></header>
            <div class="heart-style-grid">
              <label>Darstellung<select id="heart-layout"><option value="hologram">Hologramm</option><option value="minimal">Minimal</option><option value="bar">Leiste</option></select></label>
              <label>Herzfarbe<input id="heart-color" type="color" value="#ff526e"></label>
              <label>BPM-Farbe<input id="heart-bpm-color" type="color" value="#ffffff"></label>
              <label>Hintergrund<input id="heart-background" type="color" value="#08121d"></label>
              <label>Hintergrundstärke <output id="heart-opacity-output">35 %</output><input id="heart-opacity" type="range" min="0" max="1" step="0.05" value="0.35"></label>
              <label>Schriftgröße <output id="heart-font-output">42 px</output><input id="heart-font-size" type="range" min="16" max="120" step="1" value="42"></label>
              <label>Warnung unter BPM<input id="heart-low" type="number" min="30" max="180" value="55"></label>
              <label>Warnung über BPM<input id="heart-high" type="number" min="60" max="240" value="150"></label>
            </div>
            <div class="toggle-grid heart-toggles"><label class="check-line"><input id="heart-pulse" type="checkbox"> Herzschlag animieren</label><label class="check-line"><input id="heart-show-title" type="checkbox"> Titel anzeigen</label></div>
          </article>
        </section>
      </div>`;
  }

  function guestsMarkup() {
    return `
      <div class="section-heading"><div><span class="eyebrow">OBS-QUELLEN ALS GASTPLÄTZE</span><h2>OBS Co-Host- und Gästemodus</h2><p>Das Modul schaltet vorhandene Browser-, Kamera-, NDI- oder Aufnahmequellen innerhalb einer OBS-Szene. Es sendet keine Einladungen an TikTok-Server.</p></div></div>
      <article class="panel"><div class="guest-toolbar"><label>OBS-Szene<select id="guest-scene"><option>OBS verbinden</option></select></label><button id="guest-load">Quellen neu laden</button><button id="guest-add-all">Alle anzeigen</button><button id="guest-apply" class="primary">In OBS anwenden</button></div><div class="info-banner warning">TikTok-LIVE-Einladungen und Plattform-Co-Host-Sitzungen müssen weiterhin in TikTok selbst gestartet werden.</div><div id="guest-list" class="guest-list empty-state"><p>OBS verbinden und eine Szene auswählen.</p></div></article>`;
  }

  function sotfMarkup() {
    return `
      <div class="section-heading"><div><span class="eyebrow">CRAZYBATTO · REDLOADER · LOOPBACK-API</span><h2>Sons of the Forest Todeszähler</h2><p>Das mitgelieferte Bundle wird vor der Installation per SHA-256 geprüft und in einen von dir ausgewählten RedLoader-Mods-Ordner kopiert. Laufzeit und OBS-Overlay kommunizieren ausschließlich über 127.0.0.1.</p></div><div class="button-row"><button id="sotf-install">Gebündeltes Modul installieren</button><button id="sotf-copy">OBS-Adresse kopieren</button><button id="sotf-refresh">Aktualisieren</button><button id="sotf-open" class="primary">Overlay öffnen</button></div></div>
      <div id="sotf-status" class="module-status-grid"></div>
      <div class="two-column-cards">
        <article class="panel"><h3>Spieler</h3><div id="sotf-players" class="connection-list"></div></article>
        <article class="panel"><h3>Letztes Ereignis</h3><div id="sotf-event" class="empty-state"><p>Noch kein Ereignis empfangen.</p></div><hr><div id="sotf-bundle" class="bundle-details"></div><p>Das RedLoader-Modul stellt Snapshot, Healthcheck und OBS-Overlay lokal auf Port 19447 bereit.</p></article>
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
      <div class="section-heading"><div><span class="eyebrow">DATENSICHERHEIT UND MODULSTATUS</span><h2>Übernahme & Diagnose</h2><p>Profile, Touch-Deck-Erweiterungen und Icon-Pakete aus einer vorhandenen 1.8.6-Installation werden nur ergänzt. Neue Batto-Daten werden nicht überschrieben.</p></div><button id="migration-run" class="primary">Altdaten erneut suchen</button></div>
      <div id="integration-status" class="diagnostic-grid"></div>
      <article class="panel"><h3>Abnahmebedingungen</h3><ul class="check-list"><li>Eine Hauptanwendung und ein Installer</li><li>Kein separater alter Prozess</li><li>Lokale OBS-Adresse 127.0.0.1:4455</li><li>Dedizierte GPU wird bevorzugt</li><li>Monitoring-Overlay bleibt transparent</li><li>Touch-Deck-Belegungen bleiben bei Rasteränderungen erhalten</li><li>Erweiterungsfehler werden sichtbar gemeldet</li><li>Handy-Verbindung läuft lokal mit PIN</li></ul></article>`;
  }

  function bindIntegratedEvents() {
    $("#stream-overlay-open")?.addEventListener("click", () => call("stream-overlay:open"));
    $("#stream-overlay-copy")?.addEventListener("click", async () => showToast(`OBS-Adresse kopiert: ${await call("stream-overlay:copy-url")}`));
    $("#stream-test-send")?.addEventListener("click", () => call("stream-overlay:event", { type: $("#stream-test-type").value, platform: "local", name: $("#stream-test-name").value, text: $("#stream-test-text").value, value: Number($("#stream-test-value").value) || 0 }));
    $("#stream-events-clear")?.addEventListener("click", () => call("stream-overlay:clear"));

    $("#chat-settings-save")?.addEventListener("click", saveChatSettings);
    $("#chat-twitch-connect")?.addEventListener("click", connectTwitch);
    $("#chat-twitch-disconnect")?.addEventListener("click", () => call("chat:twitch-disconnect").then((chat) => { state.chat = chat; renderMultiChat(); }));
    $("#chat-youtube-connect")?.addEventListener("click", connectYouTube);
    $("#chat-youtube-disconnect")?.addEventListener("click", () => call("chat:youtube-disconnect").then((chat) => { state.chat = chat; renderMultiChat(); }));
    $("#chat-tikfinity-connect")?.addEventListener("click", connectTikfinity);
    $("#chat-tikfinity-disconnect")?.addEventListener("click", () => call("chat:tikfinity-disconnect").then((chat) => { state.chat = chat; renderMultiChat(); }));
    $("#chat-test")?.addEventListener("click", sendChatTest);
    $("#chat-clear")?.addEventListener("click", () => call("chat:clear").then((chat) => { state.chat = chat; renderMultiChat(); }));
    $("#chat-tts-skip")?.addEventListener("click", () => call("chat:tts-skip").then(() => refreshState()));
    $("#chat-tts-clear")?.addEventListener("click", () => call("chat:tts-clear").then(() => refreshState()));
    $("#chat-holo-open")?.addEventListener("click", () => call("holo:open"));
    $("#chat-holo-copy")?.addEventListener("click", async () => showToast(`OBS-Adresse kopiert: ${await call("holo:copy-url")}`));
    $("#chat-holo-clear")?.addEventListener("click", () => call("holo:clear"));
    $("#chat-tts-rate")?.addEventListener("input", renderChatRangeOutputs);
    $("#chat-tts-volume")?.addEventListener("input", renderChatRangeOutputs);
    $("#chat-settings-panel")?.addEventListener("input", () => { chatSettingsDirty = true; });
    $("#chat-settings-panel")?.addEventListener("change", () => { chatSettingsDirty = true; });

    $("#heart-pulsoid-connect")?.addEventListener("click", connectPulsoid);
    $("#heart-pulsoid-disconnect")?.addEventListener("click", () => call("heart-rate:pulsoid-disconnect").then(updateHeartState));
    $("#heart-pulsoid-forget")?.addEventListener("click", forgetPulsoid);
    $("#heart-ble-connect")?.addEventListener("click", connectBleHeartRate);
    $("#heart-ble-disconnect")?.addEventListener("click", disconnectBleHeartRate);
    $("#heart-copy-overlay")?.addEventListener("click", async () => showToast(`OBS-Adresse kopiert: ${await call("heart-rate:copy-overlay")}`));
    $("#heart-open-overlay")?.addEventListener("click", () => {
      const url = state?.modules?.heartRate?.overlayUrl;
      if (url) void call("app:open-url", { url });
    });
    $("#heart-preview-send")?.addEventListener("click", sendHeartPreview);
    $("#heart-style-save")?.addEventListener("click", saveHeartSettings);
    $("#heart-opacity")?.addEventListener("input", renderHeartRangeOutputs);
    $("#heart-font-size")?.addEventListener("input", renderHeartRangeOutputs);
    $("#heart-style-panel")?.addEventListener("input", () => { heartSettingsDirty = true; });
    $("#heart-style-panel")?.addEventListener("change", () => { heartSettingsDirty = true; });
    $("#heart-auto-connect")?.addEventListener("change", () => { heartSettingsDirty = true; });

    $("#guest-load")?.addEventListener("click", loadGuests);
    $("#guest-scene")?.addEventListener("change", loadGuests);
    $("#guest-add-all")?.addEventListener("click", () => $$('#guest-list input[type="checkbox"]').forEach((input) => { input.checked = true; }));
    $("#guest-apply")?.addEventListener("click", applyGuests);

    $("#sotf-refresh")?.addEventListener("click", () => call("sotf:refresh").then((value) => { state.modules.sotfDeathCounter = value; renderSotf(); }));
    $("#sotf-open")?.addEventListener("click", () => call("sotf:open-overlay"));
    $("#sotf-copy")?.addEventListener("click", async () => showToast(`OBS-Adresse kopiert: ${await call("sotf:copy-overlay")}`));
    $("#sotf-install")?.addEventListener("click", installSotfBundle);

    $("#mobile-new-pin")?.addEventListener("click", () => call("mobile:regenerate-pin").then((mobile) => { state.mobile = mobile; renderMobile(); }));
    $("#mobile-copy-address")?.addEventListener("click", async () => { const value = state?.mobile?.qr?.web || ""; await navigator.clipboard.writeText(value); showToast("Handy-Adresse kopiert."); });
    $("#mobile-approval")?.addEventListener("change", () => call("mobile:approval", { required: $("#mobile-approval").checked }).then((mobile) => { state.mobile = mobile; renderMobile(); }));

    $("#migration-run")?.addEventListener("click", () => call("migration:run").then((migration) => { state.migration = migration; renderIntegration(); }));

    api.onBluetoothDevices?.((devices) => {
      bluetoothCandidates = Array.isArray(devices) ? devices : [];
      if (activeIntegratedPage === "heart-rate") renderBluetoothCandidates();
    });
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
    if (id === "heart-rate") renderHeartRate();
    if (id === "obs-guests") renderGuests();
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
      tikfinity: { url: $("#chat-tikfinity-url").value.trim(), autoConnect: $("#chat-tikfinity-auto").checked },
      tts: {
        enabled: $("#chat-tts-enabled").checked,
        maximumLength: Number($("#chat-tts-length").value) || 240,
        voice: $("#chat-tts-voice").value,
        rate: Number($("#chat-tts-rate").value) || 0,
        volume: Number($("#chat-tts-volume").value),
        includeName: $("#chat-tts-name").checked
      },
      bot: {
        enabled: $("#chat-bot-enabled").checked,
        prefix: $("#chat-bot-prefix").value.slice(0, 4),
        roles: $$('#chat-bot-roles input[data-role]:checked').map((input) => input.dataset.role),
        speakCommands: $("#chat-bot-speak").checked
      }
    };
  }

  async function saveChatSettings() {
    const payload = { settings: chatSettingsFromUi() };
    if ($("#chat-twitch-token").value) payload.twitchOauth = $("#chat-twitch-token").value;
    if ($("#chat-youtube-key").value) payload.youtubeApiKey = $("#chat-youtube-key").value;
    state.chat = await call("chat:update-settings", payload);
    chatSettingsDirty = false;
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

  async function connectTikfinity() {
    await saveChatSettings();
    state.chat = await call("chat:tikfinity-connect", { url: $("#chat-tikfinity-url").value.trim() });
    renderMultiChat();
  }

  async function sendChatTest() {
    const text = $("#chat-test-text").value.trim();
    const name = $("#chat-test-name").value.trim();
    if (!text || !name) {
      showToast("Name und Nachricht werden für die lokale Vorschau benötigt.", true);
      return;
    }
    await call("chat:test", {
      platform: $("#chat-test-platform").value,
      name,
      text,
      role: $("#chat-test-role").value
    });
    showToast("Lokale Testnachricht an Chat, Hologramm und aktivierte Ausgaben gesendet.");
  }

  function setValueIfIdle(selector, value) {
    const control = $(selector);
    if (control && document.activeElement !== control) control.value = String(value ?? "");
  }

  function setCheckedIfIdle(selector, value) {
    const control = $(selector);
    if (control && document.activeElement !== control) control.checked = Boolean(value);
  }

  function renderChatRangeOutputs() {
    if ($("#chat-tts-rate-output")) $("#chat-tts-rate-output").textContent = String(Number($("#chat-tts-rate").value) || 0);
    if ($("#chat-tts-volume-output")) $("#chat-tts-volume-output").textContent = `${Number($("#chat-tts-volume").value) || 0} %`;
  }

  function loadChatVoices() {
    if (chatVoicesLoaded) return;
    chatVoicesLoaded = true;
    void call("chat:tts-voices").then((voices) => {
      chatVoices = Array.isArray(voices) ? voices : [];
      if (activeIntegratedPage === "multi-chat") renderMultiChat();
    }).catch(() => { chatVoices = []; });
  }

  function renderMultiChat() {
    const chat = state?.chat || {};
    const settings = chat.settings || {};
    const platforms = settings.enabledPlatforms || {};
    const platformTarget = $("#chat-platforms");
    if (!platformTarget) return;
    const botRoles = settings.bot?.roles || ["broadcaster", "moderator"];
    const roleLabels = { broadcaster: "Streamer", moderator: "Moderatoren", vip: "VIPs", subscriber: "Subscriber", viewer: "Zuschauer" };
    if (!chatSettingsDirty || !platformTarget.children.length) {
      platformTarget.innerHTML = ["twitch", "youtube", "tiktok", "tikfinity", "tiktory"].map((platform) => `<label class="check-line"><input type="checkbox" data-platform="${platform}" ${platforms[platform] !== false ? "checked" : ""}> ${escapeHtml(platform === "youtube" ? "YouTube" : platform === "twitch" ? "Twitch" : platform === "tiktok" ? "TikTok" : platform === "tikfinity" ? "TikFinity" : "Tiktory")}</label>`).join("");
      setCheckedIfIdle("#chat-forward", settings.forwardToOverlay !== false);
      setValueIfIdle("#chat-twitch-channel", settings.twitch?.channel || "");
      setValueIfIdle("#chat-twitch-name", settings.twitch?.nickname || "");
      setValueIfIdle("#chat-youtube-id", settings.youtube?.liveChatId || "");
      setValueIfIdle("#chat-tikfinity-url", settings.tikfinity?.url || "ws://127.0.0.1:21213/");
      setCheckedIfIdle("#chat-tikfinity-auto", settings.tikfinity?.autoConnect !== false);
      setCheckedIfIdle("#chat-tts-enabled", settings.tts?.enabled);
      setValueIfIdle("#chat-tts-length", settings.tts?.maximumLength || 240);
      setValueIfIdle("#chat-tts-rate", Number(settings.tts?.rate) || 0);
      setValueIfIdle("#chat-tts-volume", Number.isFinite(Number(settings.tts?.volume)) ? Number(settings.tts.volume) : 100);
      setCheckedIfIdle("#chat-tts-name", settings.tts?.includeName !== false);
      setCheckedIfIdle("#chat-bot-enabled", settings.bot?.enabled !== false);
      setValueIfIdle("#chat-bot-prefix", settings.bot?.prefix || "!");
      setCheckedIfIdle("#chat-bot-speak", settings.bot?.speakCommands);
      $("#chat-bot-roles").innerHTML = Object.entries(roleLabels).map(([role, label]) => `<label class="check-line"><input type="checkbox" data-role="${role}" ${botRoles.includes(role) ? "checked" : ""}> ${label}</label>`).join("");
    }
    const voiceControl = $("#chat-tts-voice");
    const selectedVoice = chatSettingsDirty ? voiceControl.value : settings.tts?.voice || "";
    if (document.activeElement !== voiceControl) {
      voiceControl.innerHTML = `<option value="">Systemstandard</option>${chatVoices.map((voice) => `<option value="${escapeHtml(voice.name)}">${escapeHtml(voice.name)}${voice.culture ? ` · ${escapeHtml(voice.culture)}` : ""}</option>`).join("")}`;
      voiceControl.value = selectedVoice;
    }
    renderChatRangeOutputs();
    const statuses = [
      ["Twitch", chat.status?.twitch, chat.status?.lastError?.twitch],
      ["YouTube", chat.status?.youtube, chat.status?.lastError?.youtube],
      ["TikFinity lokal", chat.status?.tikfinity, chat.status?.lastError?.tikfinity],
      ["Webhook", chat.status?.localWebhook, chat.status?.localWebhookUrl]
    ];
    $("#chat-status-grid").innerHTML = statuses.map(([label, connected, detail]) => `<article><span>${escapeHtml(label)}</span><strong>${statusPill(Boolean(connected), "Verbunden", "Getrennt")}</strong><small>${escapeHtml(detail || (connected ? "Bereit" : "Keine Verbindung"))}</small></article>`).join("");
    $("#chat-status-line").textContent = `${(chat.messages || []).length} Nachricht(en) im lokalen Verlauf`;
    $("#chat-tts-queue").textContent = `TTS ${Number(chat.status?.ttsQueue || 0)}`;
    const holo = state?.modules?.twitchHolo || {};
    $("#chat-holo-status").textContent = holo.active ? `${holo.clients || 0} OBS-/Vorschaufenster verbunden · ${holo.messageCount || 0} Nachricht(en)` : holo.error || "Hologramm-Server nicht aktiv.";
    const roleLabelsShort = { broadcaster: "Streamer", moderator: "Mods", vip: "VIP", subscriber: "Subs", viewer: "Zuschauer" };
    $("#chat-holo-roles").innerHTML = Object.entries(roleLabelsShort).map(([role, label]) => {
      const colors = (holo.config?.roleStyles?.[role]?.colors || []).filter((color) => /^#[0-9a-f]{6}$/i.test(String(color))).slice(0, 6);
      const gradient = colors.length >= 2 ? `linear-gradient(100deg, ${colors.join(", ")})` : "linear-gradient(100deg, #54f4ff, #9867ff, #ff55c8)";
      return `<span style="--role-gradient:${gradient}">${label}</span>`;
    }).join("");
    const frame = $("#chat-holo-frame");
    if (holo.overlayUrl && frame.getAttribute("src") !== holo.overlayUrl) frame.src = holo.overlayUrl;
    const list = $("#chat-message-list");
    const messages = (chat.messages || []).slice(-200).reverse();
    const messageIds = messages.map((message) => String(message.id || `${message.platform}-${message.timestamp}-${message.name}`));
    if (!messageIds.length) {
      if (renderedChatIds.length || !list.children.length) list.innerHTML = '<div class="empty-state"><p>Noch keine Nachricht empfangen.</p></div>';
    } else if (messageIds.join("\u0000") !== renderedChatIds.join("\u0000")) {
      const oldHeadIndex = renderedChatIds.length ? messageIds.indexOf(renderedChatIds[0]) : -1;
      const canPrepend = oldHeadIndex > 0 && oldHeadIndex <= 20
        && messageIds.slice(oldHeadIndex).every((id, index) => id === renderedChatIds[index]);
      if (canPrepend) {
        list.insertAdjacentHTML("afterbegin", messages.slice(0, oldHeadIndex).map(chatMessageMarkup).join(""));
        while (list.children.length > 200) list.lastElementChild?.remove();
      } else list.innerHTML = messages.map(chatMessageMarkup).join("");
    }
    renderedChatIds = messageIds;
    loadChatVoices();
  }

  function chatMessageMarkup(message) {
    const time = new Date(message.timestamp).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    return `<article class="chat-row platform-${escapeHtml(message.platform)}"><header><strong>${escapeHtml(message.name)}</strong><span>${escapeHtml(message.platform)} · ${escapeHtml(time)}</span></header><p>${escapeHtml(message.text)}</p></article>`;
  }

  function updateHeartState(value, tokenStored) {
    if (!state?.modules) return value;
    const previous = state.modules.heartRate || {};
    state.modules.heartRate = {
      ...previous,
      ...(value || {}),
      tokenStored: tokenStored === undefined ? Boolean(previous.tokenStored) : Boolean(tokenStored)
    };
    renderHeartRate();
    return state.modules.heartRate;
  }

  function heartSettingsFromUi() {
    return {
      source: state?.modules?.heartRate?.settings?.source || state?.modules?.heartRate?.source || "pulsoid",
      autoConnect: $("#heart-auto-connect").checked,
      overlay: {
        layout: $("#heart-layout").value,
        heartColor: $("#heart-color").value,
        bpmColor: $("#heart-bpm-color").value,
        backgroundColor: $("#heart-background").value,
        backgroundOpacity: Number($("#heart-opacity").value),
        fontSize: Number($("#heart-font-size").value),
        pulse: $("#heart-pulse").checked,
        showTitle: $("#heart-show-title").checked,
        lowBpm: Number($("#heart-low").value),
        highBpm: Number($("#heart-high").value)
      }
    };
  }

  async function saveHeartSettings() {
    const lowBpm = Number($("#heart-low").value);
    const highBpm = Number($("#heart-high").value);
    if (lowBpm >= highBpm) {
      showToast("Die obere BPM-Warnschwelle muss über der unteren liegen.", true);
      return null;
    }
    const result = await call("heart-rate:update", heartSettingsFromUi());
    heartSettingsDirty = false;
    updateHeartState(result);
    showToast("Herzfrequenz-Overlay aktualisiert.");
    return result;
  }

  async function connectPulsoid() {
    const token = $("#heart-pulsoid-token").value.trim();
    if (bleDevice) await disconnectBleHeartRate();
    const result = await call("heart-rate:pulsoid-connect", { token, autoConnect: $("#heart-auto-connect").checked });
    $("#heart-pulsoid-token").value = "";
    updateHeartState(result, Boolean(token) || state?.modules?.heartRate?.tokenStored);
    showToast("Pulsoid ist verbunden und liefert Daten direkt an das lokale Overlay.");
  }

  async function forgetPulsoid() {
    const result = await call("heart-rate:pulsoid-forget");
    $("#heart-pulsoid-token").value = "";
    updateHeartState(result, false);
    showToast("Pulsoid-Token aus Windows safeStorage entfernt.");
  }

  function parseBleHeartRate(value) {
    if (!value || value.byteLength < 2) throw new Error("Der Bluetooth-Sensor hat einen ungültigen Messwert gesendet.");
    const flags = value.getUint8(0);
    if (flags & 0x01) {
      if (value.byteLength < 3) throw new Error("Der 16-Bit-Bluetooth-Messwert ist unvollständig.");
      return value.getUint16(1, true);
    }
    return value.getUint8(1);
  }

  function onBleHeartValue(event) {
    try {
      const bpm = parseBleHeartRate(event.target?.value);
      void call("heart-rate:ble-value", { bpm, measuredAt: Date.now(), deviceName: bleDevice?.name || "Bluetooth-Sensor" }).then(updateHeartState).catch(() => {});
    } catch (error) {
      showToast(error?.message || error, true);
    }
  }

  function onBleDisconnected() {
    bleHeartCharacteristic?.removeEventListener("characteristicvaluechanged", onBleHeartValue);
    bleHeartCharacteristic = null;
    bleDevice = null;
    bluetoothCandidates = [];
    void call("heart-rate:ble-disconnect").then(updateHeartState).catch(() => {});
  }

  async function connectBleHeartRate() {
    if (bleConnecting) return;
    if (!navigator.bluetooth?.requestDevice) {
      showToast("Web Bluetooth ist in dieser Windows-/Electron-Umgebung nicht verfügbar.", true);
      return;
    }
    if (bleDevice) await disconnectBleHeartRate();
    bleConnecting = true;
    bluetoothCandidates = [];
    renderBluetoothCandidates();
    try {
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: ["heart_rate"] }]
      });
      bleDevice = device;
      device.addEventListener("gattserverdisconnected", onBleDisconnected, { once: true });
      const server = await device.gatt.connect();
      const service = await server.getPrimaryService("heart_rate");
      bleHeartCharacteristic = await service.getCharacteristic("heart_rate_measurement");
      bleHeartCharacteristic.addEventListener("characteristicvaluechanged", onBleHeartValue);
      await bleHeartCharacteristic.startNotifications();
      bluetoothCandidates = [];
      const result = await call("heart-rate:ble-connected", { deviceName: device.name || "Bluetooth-Sensor" });
      updateHeartState(result);
      showToast(`Bluetooth-Sensor „${device.name || "Unbenannt"}“ verbunden.`);
    } catch (error) {
      const failedDevice = bleDevice;
      bleHeartCharacteristic?.removeEventListener("characteristicvaluechanged", onBleHeartValue);
      bleHeartCharacteristic = null;
      bleDevice = null;
      try { failedDevice?.removeEventListener("gattserverdisconnected", onBleDisconnected); failedDevice?.gatt?.disconnect(); } catch {}
      bluetoothCandidates = [];
      renderBluetoothCandidates();
      if (error?.name !== "NotFoundError") showToast(error?.message || "Bluetooth-Verbindung fehlgeschlagen.", true);
    } finally {
      bleConnecting = false;
      renderHeartRate();
    }
  }

  async function disconnectBleHeartRate() {
    const device = bleDevice;
    bleHeartCharacteristic?.removeEventListener("characteristicvaluechanged", onBleHeartValue);
    bleHeartCharacteristic = null;
    bleDevice = null;
    bluetoothCandidates = [];
    try { device?.removeEventListener("gattserverdisconnected", onBleDisconnected); device?.gatt?.disconnect(); } catch {}
    updateHeartState(await call("heart-rate:ble-disconnect"));
  }

  function renderBluetoothCandidates() {
    const target = $("#heart-ble-candidates");
    if (!target) return;
    target.hidden = !bleConnecting && !bluetoothCandidates.length;
    target.innerHTML = bluetoothCandidates.length
      ? `<strong>Sensor auswählen</strong>${bluetoothCandidates.map((device) => `<button type="button" data-ble-device="${escapeHtml(device.deviceId)}"><span>♥</span>${escapeHtml(device.deviceName || "Unbenannter BLE-Sensor")}</button>`).join("")}<button type="button" data-ble-cancel>Suche abbrechen</button>`
      : bleConnecting ? '<span class="ble-searching">Bluetooth-Sensoren werden gesucht …</span><button type="button" data-ble-cancel>Suche abbrechen</button>' : "";
    $$('[data-ble-device]', target).forEach((button) => button.addEventListener("click", async () => {
      $$('button', target).forEach((item) => { item.disabled = true; });
      await call("heart-rate:ble-select", { deviceId: button.dataset.bleDevice });
    }));
    $("[data-ble-cancel]", target)?.addEventListener("click", () => {
      $$('button', target).forEach((item) => { item.disabled = true; });
      void call("heart-rate:ble-select", { deviceId: "" }).catch(() => {});
    });
  }

  async function sendHeartPreview() {
    const bpm = Number($("#heart-preview-bpm").value);
    if (!Number.isFinite(bpm) || bpm < 25 || bpm > 250) {
      showToast("Für die lokale Vorschau sind 25 bis 250 BPM erlaubt.", true);
      return;
    }
    updateHeartState(await call("heart-rate:preview", { bpm }));
    showToast("Lokaler Vorschaumesswert gesendet – er stammt nicht von einem Sensor.");
  }

  function renderHeartRangeOutputs() {
    if ($("#heart-opacity-output")) $("#heart-opacity-output").textContent = `${Math.round(Number($("#heart-opacity").value) * 100)} %`;
    if ($("#heart-font-output")) $("#heart-font-output").textContent = `${Number($("#heart-font-size").value)} px`;
  }

  function renderHeartRate() {
    const heart = state?.modules?.heartRate || {};
    const settings = heart.settings || {};
    const overlay = settings.overlay || {};
    const bpm = Number(heart.bpm) || 0;
    const age = Number(heart.ageMs);
    const connectionSourceLabel = heart.source === "ble" ? heart.bleDeviceName || "Bluetooth" : "Pulsoid";
    const sampleSourceLabel = heart.sampleSource === "preview" ? "Lokale Vorschau" : heart.sampleSource === "ble" ? "Bluetooth-Sensor" : heart.sampleSource === "pulsoid" ? "Pulsoid" : "Noch kein Messwert";
    const sampleAgeLabel = !heart.measuredAt ? "Noch kein Messwert" : heart.stale ? `${sampleSourceLabel} · nicht aktuell` : `${sampleSourceLabel} · ${Math.round(age / 1000)} s alt`;
    const status = $("#heart-status-grid");
    if (!status) return;
    status.innerHTML = `
      <article><span>Verbindung</span><strong>${statusPill(Boolean(heart.connected), "Verbunden", "Getrennt")}</strong><small>${escapeHtml(connectionSourceLabel)}</small></article>
      <article class="heart-bpm-card"><span>Letzter Messwert</span><strong>${bpm ? `${bpm} BPM` : "– BPM"}</strong><small>${escapeHtml(sampleAgeLabel)}</small></article>
      <article><span>Min / Max</span><strong>${Number(heart.minimum) || "–"} / ${Number(heart.maximum) || "–"}</strong><small>Seit Programmstart</small></article>
      <article><span>OBS-Browserquelle</span><code>${escapeHtml(heart.overlayUrl || "Nicht verfügbar")}</code><small>${heart.error ? escapeHtml(heart.error) : "Lokal auf 127.0.0.1"}</small></article>`;
    $("#heart-pulsoid-pill").innerHTML = statusPill(heart.source === "pulsoid" && heart.connected, "Verbunden", heart.tokenStored ? "Token gespeichert" : "Nicht verbunden");
    $("#heart-ble-pill").innerHTML = statusPill(heart.source === "ble" && heart.connected, "Verbunden", "Nicht verbunden");
    $("#heart-ble-device").textContent = heart.bleDeviceName ? `Sensor: ${heart.bleDeviceName}` : "Noch kein Sensor verbunden.";
    if (!heartSettingsDirty) {
      setCheckedIfIdle("#heart-auto-connect", settings.autoConnect);
      setValueIfIdle("#heart-layout", overlay.layout || "hologram");
      setValueIfIdle("#heart-color", overlay.heartColor || "#ff526e");
      setValueIfIdle("#heart-bpm-color", overlay.bpmColor || "#ffffff");
      setValueIfIdle("#heart-background", overlay.backgroundColor || "#08121d");
      setValueIfIdle("#heart-opacity", Number.isFinite(Number(overlay.backgroundOpacity)) ? Number(overlay.backgroundOpacity) : 0.35);
      setValueIfIdle("#heart-font-size", Number(overlay.fontSize) || 42);
      setValueIfIdle("#heart-low", Number(overlay.lowBpm) || 55);
      setValueIfIdle("#heart-high", Number(overlay.highBpm) || 150);
      setCheckedIfIdle("#heart-pulse", overlay.pulse !== false);
      setCheckedIfIdle("#heart-show-title", overlay.showTitle);
    }
    $("#heart-overlay-url").textContent = heart.overlayUrl || "Nicht verfügbar";
    const frame = $("#heart-preview-frame");
    if (heart.overlayUrl && frame.getAttribute("src") !== heart.overlayUrl) frame.src = heart.overlayUrl;
    $("#heart-open-overlay").disabled = !heart.overlayUrl;
    $("#heart-copy-overlay").disabled = !heart.overlayUrl;
    $("#heart-ble-connect").disabled = bleConnecting;
    renderHeartRangeOutputs();
    renderBluetoothCandidates();
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

  function renderSotf() {
    const module = state?.modules?.sotfDeathCounter || {};
    const snapshot = module.snapshot || null;
    const bundle = module.bundle || {};
    const target = $("#sotf-status");
    if (!target) return;
    target.innerHTML = `
      <article><span>Status</span><strong>${statusPill(Boolean(module.connected), "RedLoader verbunden", "Modul nicht erreichbar")}</strong></article>
      <article><span>Gebündeltes Modul</span><strong>${bundle.available ? `v${escapeHtml(bundle.version || module.version || "")}` : "Fehlt"}</strong><small>${escapeHtml(bundle.name || module.module || "CrazyBatto DeathCounter")}</small></article>
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
    $("#sotf-bundle").innerHTML = bundle.available
      ? `<div><span>Bundle-ID</span><code>${escapeHtml(bundle.id || "CrazyBatto_SotfDeathCounter")}</code></div><div><span>SHA-256</span><code title="${escapeHtml(bundle.sha256 || "")}">${escapeHtml(bundle.sha256 || "Nicht verfügbar")}</code></div>`
      : `<div class="info-banner warning">${escapeHtml(bundle.error || "Das gebündelte RedLoader-Modul ist in dieser Installation nicht verfügbar.")}</div>`;
    $("#sotf-install").disabled = !bundle.available;
  }

  async function installSotfBundle() {
    const result = await call("sotf:install-module");
    if (!result) return;
    const backupNote = result.backups?.length ? ` ${result.backups.length} vorhandene Datei(en) wurden vorher gesichert.` : "";
    showToast(`SOTF-Modul v${result.bundle?.version || ""} installiert: ${result.target}.${backupNote}`);
    await refreshState();
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
      ["Herzfrequenz", Boolean(modules.heartRate?.connected), modules.heartRate?.connected ? `${modules.heartRate.bpm || "–"} BPM · ${modules.heartRate.source === "ble" ? "Bluetooth" : "Pulsoid"}` : modules.heartRate?.error || "Nicht verbunden"],
      ["Handy-Brücke", Boolean(state.mobile?.active), state.mobile?.active ? `Port ${state.mobile.port}` : "Nicht aktiv"],
      ["Touch-Deck-Erweiterungen", Boolean(state.plugins?.plugins?.length), `${state.plugins?.plugins?.length || 0} Erweiterungen · ${modules.streamDeckPlugins?.sessions?.filter((session) => session.connected).length || 0} originale Laufzeit(en) verbunden`],
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
