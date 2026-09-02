"use strict";

(() => {
  const api = window.batto;
  const byId = (id) => document.getElementById(id);
  const pageMeta = {
    overview: ["Übersicht", "OBS, Chat, Overlays und Touch-Deck Pro zentral steuern."],
    obs: ["OBS-Verbindung", "OBS WebSocket 5 lokal verbinden und sicher steuern."],
    settings: ["Einstellungen", "Lokale Standardwerte und Produktinformationen verwalten."]
  };

  let state = null;
  let latestObs = null;
  let toastTimer = null;

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

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

  function switchView(name) {
    if (!pageMeta[name]) return;
    document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === `view-${name}`));
    document.querySelectorAll(".nav-button").forEach((button) => button.classList.toggle("active", button.dataset.view === name));
    if (byId("page-title")) byId("page-title").textContent = pageMeta[name][0];
    if (byId("page-subtitle")) byId("page-subtitle").textContent = pageMeta[name][1];
  }

  function setObsConnected(connected) {
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
    document.querySelectorAll("[data-obs-action]").forEach((button) => { button.disabled = !connected; });
    if (byId("obs-set-scene")) byId("obs-set-scene").disabled = !connected;
  }

  function sceneData(snapshot) {
    const value = snapshot?.scenes;
    if (Array.isArray(value)) return { scenes: value, current: snapshot?.currentScene || snapshot?.currentProgramSceneName || "" };
    if (value && typeof value === "object") {
      return {
        scenes: Array.isArray(value.scenes) ? value.scenes : [],
        current: value.currentProgramSceneName || snapshot?.currentScene || snapshot?.currentProgramSceneName || ""
      };
    }
    return { scenes: [], current: snapshot?.currentScene || snapshot?.currentProgramSceneName || "" };
  }

  function renderObs(snapshot = latestObs) {
    latestObs = snapshot || { connected: false };
    const connected = Boolean(latestObs.connected);
    setObsConnected(connected);

    const message = byId("obs-message");
    if (message) message.textContent = latestObs.lastError || latestObs.error?.message || "";

    const details = byId("obs-details");
    if (details) {
      const version = latestObs.version || {};
      const video = latestObs.video || {};
      details.innerHTML = [
        ["Verbindung", connected ? "Verbunden" : "Getrennt"],
        ["OBS-Version", version.obsVersion || "–"],
        ["WebSocket", version.obsWebSocketVersion || "–"],
        ["Ausgabe", video.outputWidth && video.outputHeight ? `${video.outputWidth} × ${video.outputHeight}` : "–"]
      ].map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("");
    }

    const select = byId("obs-scene-select");
    if (select) {
      const { scenes, current } = sceneData(latestObs);
      select.replaceChildren();
      if (!scenes.length) {
        const option = document.createElement("option");
        option.textContent = connected ? "Keine Szene gemeldet" : "OBS verbinden";
        option.value = "";
        select.append(option);
      } else {
        for (const scene of scenes) {
          const name = typeof scene === "string" ? scene : scene.sceneName || scene.name || "";
          if (!name) continue;
          const option = document.createElement("option");
          option.value = name;
          option.textContent = name;
          option.selected = name === current;
          select.append(option);
        }
      }
    }
  }

  async function refreshObs() {
    try { renderObs(await api.getObsSnapshot()); }
    catch (error) { showToast(`OBS-Status konnte nicht geladen werden: ${errorMessage(error)}`, "error"); }
  }

  async function connectObs() {
    const button = byId("obs-connect");
    if (button) button.disabled = true;
    try {
      const result = await api.connectObs({
        host: "127.0.0.1",
        port: Number(byId("obs-port")?.value || 4455),
        password: byId("obs-password")?.value || "",
        rememberPassword: Boolean(byId("obs-remember")?.checked)
      });
      renderObs(result);
      await refreshObs();
      showToast("OBS verbunden.");
    } catch (error) {
      showToast(`OBS-Verbindung fehlgeschlagen: ${errorMessage(error)}`, "error");
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function executeObs(action, payload = {}) {
    try {
      await api.executeObs(action, payload);
      await refreshObs();
    } catch (error) {
      showToast(`OBS-Aktion fehlgeschlagen: ${errorMessage(error)}`, "error");
    }
  }

  function syncSettings() {
    const settings = state?.settings || {};
    if (byId("obs-host")) byId("obs-host").value = "127.0.0.1";
    if (byId("obs-port")) byId("obs-port").value = settings.obs?.port || 4455;
    if (byId("settings-platform")) byId("settings-platform").value = settings.preferences?.platform || "twitch";
    if (byId("settings-resolution")) byId("settings-resolution").value = settings.preferences?.targetResolution || "1920x1080";
    if (byId("settings-fps")) byId("settings-fps").value = String(settings.preferences?.targetFps || 60);
  }

  async function saveSettings() {
    try {
      const preferences = {
        platform: byId("settings-platform")?.value || "twitch",
        targetResolution: byId("settings-resolution")?.value || "1920x1080",
        targetFps: Number(byId("settings-fps")?.value || 60)
      };
      state.settings = await api.saveSettings({ preferences });
      showToast("Einstellungen gespeichert.");
    } catch (error) {
      showToast(`Einstellungen konnten nicht gespeichert werden: ${errorMessage(error)}`, "error");
    }
  }

  function on(id, event, handler) {
    const element = byId(id);
    if (element) element.addEventListener(event, handler);
  }

  function bindEvents() {
    document.querySelectorAll(".nav-button").forEach((button) => {
      if (pageMeta[button.dataset.view]) button.addEventListener("click", () => switchView(button.dataset.view));
    });
    on("overview-connect-obs", "click", () => switchView("obs"));
    on("obs-connect", "click", () => void connectObs());
    on("obs-disconnect", "click", async () => {
      try { await api.disconnectObs(); renderObs({ connected: false }); }
      catch (error) { showToast(errorMessage(error), "error"); }
    });
    on("obs-forget-password", "click", async () => {
      try { await api.forgetObsPassword(); showToast("Gespeichertes OBS-Passwort entfernt."); }
      catch (error) { showToast(errorMessage(error), "error"); }
    });
    on("obs-refresh", "click", () => void refreshObs());
    document.querySelectorAll("[data-obs-action]").forEach((button) => button.addEventListener("click", () => void executeObs(button.dataset.obsAction)));
    on("obs-set-scene", "click", () => {
      const sceneName = byId("obs-scene-select")?.value || "";
      if (sceneName) void executeObs("scene.set", { sceneName });
    });
    on("settings-save", "click", () => void saveSettings());
    api.onObsStatusChanged?.((status) => renderObs(status));
  }

  async function initialize() {
    if (!api) throw new Error("Batto Desktop API ist nicht verfügbar.");
    state = await api.getState();
    latestObs = state?.obs || { connected: false };
    if (byId("version-label")) byId("version-label").textContent = `Version ${state?.product?.version || "2.0.0"}`;
    syncSettings();
    renderObs(latestObs);
    bindEvents();
    switchView("overview");
  }

  initialize().catch((error) => {
    console.error(error);
    showToast(`Batto OBS Tool konnte nicht vollständig geladen werden: ${errorMessage(error)}`, "error");
  });
})();
