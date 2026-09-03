"use strict";

(() => {
  const api = window.batto;
  const byId = (id) => document.getElementById(id);
  const pageMeta = {
    overview: ["Übersicht", "OBS, TikTok, Multi-Chat, Touch-Deck und Overlays an einem Ort."],
    obs: ["OBS-Verbindung", "OBS WebSocket 5 lokal verbinden und steuern."],
    holo: ["Twitch-Hologramm", "Twitch-Namen und Chatfarben als OBS-Browserquelle."],
    deck: ["Touch-Deck", "Profile, Ordner, Tasten und OBS-Aktionen konfigurieren."],
    settings: ["Einstellungen", "Plattformen, TikTok LIVE Studio, Secrets, Chat und Overlays konfigurieren."]
  };

  let state = null;
  let latestObs = null;
  let toastTimer = null;

  function showToast(message, type = "success") {
    const toast = byId("toast");
    if (!toast) return;
    toast.textContent = String(message || "");
    toast.className = `toast${type === "error" ? " error" : ""}`;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 4200);
  }

  function errorMessage(error) {
    return String(error?.message || error || "Unbekannter Fehler");
  }

  function removeDiagnosticsUi() {
    for (const name of ["hardware", "internet", "recommendation", "loadtest", "monitoring"]) {
      document.querySelector(`.nav-button[data-view="${name}"]`)?.remove();
      byId(`view-${name}`)?.remove();
    }

    document.querySelectorAll('[data-jump="recommendation"], [data-jump="monitoring"]').forEach((node) => node.remove());
    byId("scan-pill")?.remove();
    byId("overview-scan")?.remove();

    for (const id of ["summary-cpu", "summary-gpu", "summary-ram", "summary-board", "summary-upload"]) {
      byId(id)?.closest("article")?.remove();
    }

    const liveCpu = byId("live-cpu");
    liveCpu?.closest("article")?.remove();

    const hero = byId("view-overview")?.querySelector(".hero-card");
    if (hero) {
      const eyebrow = hero.querySelector(".eyebrow");
      const title = hero.querySelector("h2");
      const text = hero.querySelector("p");
      if (eyebrow) eyebrow.textContent = "BATTO OBS TOOL 2.1.0";
      if (title) title.textContent = "OBS, TikTok und Multi-Chat zentral steuern";
      if (text) text.textContent = "Keine Hardwarediagnose. Die Anwendung konzentriert sich auf OBS, TikTok LIVE Studio/API, Multi-Chat, Touch-Deck und Overlays.";
    }

    const privacy = byId("view-settings")?.querySelector(".privacy-list");
    if (privacy) {
      [...privacy.children].forEach((item) => {
        const text = item.textContent || "";
        if (/Sensor|Belastungstest|Hardware/i.test(text)) item.remove();
      });
    }
  }

  function switchView(name) {
    if (!pageMeta[name]) return;
    document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === `view-${name}`));
    document.querySelectorAll(".nav-button").forEach((button) => button.classList.toggle("active", button.dataset.view === name));
    const title = byId("page-title");
    const subtitle = byId("page-subtitle");
    if (title) title.textContent = pageMeta[name][0];
    if (subtitle) subtitle.textContent = pageMeta[name][1];
    if (name === "holo") void loadHoloFrame();
  }

  function setObsConnected(connected, details = {}) {
    const pill = byId("obs-pill");
    if (pill) {
      pill.textContent = connected ? "OBS verbunden" : "OBS getrennt";
      pill.className = `status-pill ${connected ? "online" : "offline"}`;
    }
    const large = byId("obs-status-large");
    if (large) {
      large.textContent = connected ? "Verbunden" : "Nicht verbunden";
      large.className = `large-status ${connected ? "online" : "offline"}`;
    }
    if (byId("summary-obs")) byId("summary-obs").textContent = connected ? "Verbunden" : "Nicht verbunden";
    if (details.version?.obsVersion && byId("summary-obs-extra")) byId("summary-obs-extra").textContent = `OBS ${details.version.obsVersion}`;
    document.querySelectorAll("[data-obs-action]").forEach((button) => { button.disabled = !connected; });
    if (byId("obs-set-scene")) byId("obs-set-scene").disabled = !connected;
  }

  function renderObs(snapshot = latestObs) {
    latestObs = snapshot || {};
    setObsConnected(Boolean(latestObs.connected), latestObs);
    if (byId("obs-message")) byId("obs-message").textContent = latestObs.lastError || latestObs.error?.message || "";

    const details = [
      ["Verbindung", latestObs.connected ? "Verbunden" : "Getrennt"],
      ["OBS-Version", latestObs.version?.obsVersion],
      ["WebSocket-Version", latestObs.version?.obsWebSocketVersion],
      ["Ausgabeauflösung", latestObs.video?.outputWidth && latestObs.video?.outputHeight ? `${latestObs.video.outputWidth} × ${latestObs.video.outputHeight}` : null]
    ];
    const target = byId("obs-details");
    if (target) target.innerHTML = details.map(([label, value]) => `<div><dt>${label}</dt><dd>${value || "–"}</dd></div>`).join("");

    const scenes = latestObs.scenes?.scenes || [];
    const select = byId("obs-scene-select");
    if (select) {
      select.innerHTML = scenes.length ? scenes.map((scene) => `<option>${String(scene.sceneName || "")}</option>`).join("") : "<option>Keine Szenen geladen</option>";
      if (latestObs.scenes?.currentProgramSceneName) select.value = latestObs.scenes.currentProgramSceneName;
    }
  }

  async function refreshObs() {
    try { renderObs(await api.getObsSnapshot()); }
    catch (error) { showToast(errorMessage(error), "error"); }
  }

  async function connectObs() {
    const button = byId("obs-connect");
    if (button) button.disabled = true;
    try {
      const result = await api.connectObs({
        host: "127.0.0.1",
        port: Number(byId("obs-port")?.value || 4455),
        password: byId("obs-password")?.value || "",
        rememberPassword: byId("obs-remember")?.checked !== false
      });
      if (byId("obs-password")) byId("obs-password").value = "";
      renderObs(await api.getObsSnapshot());
      showToast(result?.connected === false ? "OBS konnte nicht verbunden werden." : "OBS verbunden.", result?.connected === false ? "error" : "success");
    } catch (error) {
      showToast(`OBS-Verbindung fehlgeschlagen: ${errorMessage(error)}`, "error");
      await refreshObs();
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function executeObs(action, payload = {}) {
    try {
      await api.executeObs(action, payload);
      await refreshObs();
      showToast(`OBS-Aktion ausgeführt: ${action}`);
    } catch (error) {
      showToast(errorMessage(error), "error");
    }
  }

  async function loadHoloFrame() {
    try {
      const status = await api.getHoloStatus();
      if (byId("holo-url")) byId("holo-url").textContent = status.overlayUrl || "Nicht gestartet";
      const frame = byId("holo-frame");
      if (frame && status.editorUrl && frame.src !== status.editorUrl) frame.src = status.editorUrl;
    } catch (error) {
      showToast(errorMessage(error), "error");
    }
  }

  function bindEvents() {
    document.querySelectorAll(".nav-button").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
    document.querySelectorAll("[data-jump]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.jump)));

    byId("overview-connect-obs")?.addEventListener("click", () => switchView("obs"));
    byId("obs-connect")?.addEventListener("click", () => void connectObs());
    byId("obs-disconnect")?.addEventListener("click", async () => { await api.disconnectObs(); renderObs(await api.getObsSnapshot()); });
    byId("obs-forget-password")?.addEventListener("click", async () => { await api.forgetObsPassword(); showToast("Gespeichertes OBS-Passwort entfernt."); });
    byId("obs-refresh")?.addEventListener("click", () => void refreshObs());
    document.querySelectorAll("[data-obs-action]").forEach((button) => button.addEventListener("click", () => void executeObs(button.dataset.obsAction)));
    byId("obs-set-scene")?.addEventListener("click", () => void executeObs("scene.set", { sceneName: byId("obs-scene-select")?.value || "" }));

    byId("holo-copy")?.addEventListener("click", async () => {
      try { showToast(`OBS-Adresse kopiert: ${await api.copyHoloUrl()}`); }
      catch (error) { showToast(errorMessage(error), "error"); }
    });
    byId("holo-external")?.addEventListener("click", () => void api.openHoloEditor());
  }

  async function initialize() {
    if (!api) throw new Error("Batto Desktop API ist nicht verfügbar.");
    removeDiagnosticsUi();
    state = await api.getState();
    latestObs = state.obs || {};
    if (byId("version-label")) byId("version-label").textContent = `Version ${state.product.version}`;
    if (byId("obs-port")) byId("obs-port").value = state.settings?.obs?.port || 4455;
    renderObs(latestObs);
    bindEvents();
    switchView("overview");
  }

  initialize().catch((error) => {
    console.error(error);
    showToast(`Batto OBS Tool konnte nicht geladen werden: ${errorMessage(error)}`, "error");
  });
})();
