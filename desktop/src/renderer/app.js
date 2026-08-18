"use strict";

(() => {
  const api = window.batto;
  const byId = (id) => document.getElementById(id);
  const pageMeta = {
    overview: ["Übersicht", "PC erkennen, OBS prüfen und passende Einstellungen ermitteln."],
    hardware: ["Hardwarediagnose", "Tatsächlich verbaute Komponenten und installierte Geräte lokal erfassen."],
    internet: ["Internettest", "Upload, Download und Latenz mit ausdrücklicher Bestätigung messen."],
    obs: ["OBS-Verbindung", "OBS WebSocket 5 verbinden, Status lesen und sichere Aktionen ausführen."],
    recommendation: ["Encoder-Empfehlung", "Aus Hardware, Upload und Zielplattform manuell übertragbare OBS-Werte ermitteln."],
    loadtest: ["Belastungstest", "Reale Last ausschließlich nach Bestätigung erzeugen und auswerten."],
    monitoring: ["Monitoring-Overlay", "Transparente OBS-Browserquelle im 3DMark- beziehungsweise Afterburner-Stil."],
    holo: ["Twitch-Hologramm", "Namen und Chatfarben holografisch gestalten – ohne Discord-Server-Boost."],
    deck: ["Touch-Deck", "Variable Tastenraster, Profile und OBS-Aktionen konfigurieren."],
    settings: ["Einstellungen", "Lokale Standardwerte, Sicherheit und Produktinformationen verwalten."]
  };

  let state = null;
  let currentView = "overview";
  let latestObs = null;
  let latestTelemetry = null;
  let selectedDeckIndex = -1;
  let toastTimer = null;

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function number(value, fallback = null) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function formatNumber(value, decimals = 0) {
    const parsed = number(value);
    return parsed === null
      ? "Nicht verfügbar"
      : parsed.toLocaleString("de-DE", {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals
        });
  }

  function formatBytes(value) {
    let current = number(value);
    if (current === null) return "Nicht verfügbar";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let index = 0;
    while (current >= 1024 && index < units.length - 1) {
      current /= 1024;
      index += 1;
    }
    return `${formatNumber(current, index >= 3 ? 2 : 0)} ${units[index]}`;
  }

  function formatRate(value) {
    const parsed = number(value);
    return parsed === null ? "–" : `${formatNumber(parsed * 8 / 1_000_000, 2)} Mbit/s`;
  }

  function showToast(message, type = "success") {
    const toast = byId("toast");
    toast.textContent = String(message || "");
    toast.className = `toast${type === "error" ? " error" : ""}`;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 4200);
  }

  function errorMessage(error) {
    return String(error?.message || error || "Unbekannter Fehler");
  }

  function confirmAction(title, text) {
    const dialog = byId("confirm-dialog");
    if (!dialog?.showModal) return Promise.resolve(window.confirm(text));
    byId("confirm-title").textContent = title;
    byId("confirm-text").textContent = text;
    dialog.returnValue = "cancel";
    dialog.showModal();
    return new Promise((resolve) => {
      const onClose = () => {
        dialog.removeEventListener("close", onClose);
        resolve(dialog.returnValue === "confirm");
      };
      dialog.addEventListener("close", onClose);
    });
  }

  function switchView(name) {
    if (!pageMeta[name]) return;
    currentView = name;
    document.querySelectorAll(".view").forEach((view) => {
      view.classList.toggle("active", view.id === `view-${name}`);
    });
    document.querySelectorAll(".nav-button").forEach((button) => {
      button.classList.toggle("active", button.dataset.view === name);
    });
    byId("page-title").textContent = pageMeta[name][0];
    byId("page-subtitle").textContent = pageMeta[name][1];
    if (name === "monitoring") loadMonitoringFrame();
    if (name === "holo") loadHoloFrame();
    if (name === "deck") renderDeck();
  }

  function setObsConnected(connected, details = {}) {
    const pill = byId("obs-pill");
    pill.textContent = connected ? "OBS verbunden" : "OBS getrennt";
    pill.className = `status-pill ${connected ? "online" : "offline"}`;
    const large = byId("obs-status-large");
    large.textContent = connected ? "Verbunden" : "Nicht verbunden";
    large.className = `large-status ${connected ? "online" : "offline"}`;
    byId("summary-obs").textContent = connected ? "Verbunden" : "Nicht verbunden";
    if (details.version?.obsVersion) byId("summary-obs-extra").textContent = `OBS ${details.version.obsVersion}`;
    document.querySelectorAll("[data-obs-action]").forEach((button) => {
      button.disabled = !connected;
    });
    byId("obs-set-scene").disabled = !connected;
  }

  function renderOverview() {
    const hardware = state?.hardware;
    const cpu = hardware?.cpu;
    const gpu = hardware?.preferredGpu;
    const memory = hardware?.memory;
    const board = hardware?.mainboard;
    byId("summary-cpu").textContent = cpu?.name || "Nicht erkannt";
    byId("summary-cpu-extra").textContent = cpu ? `${cpu.cores || "?"} Kerne · ${cpu.threads || "?"} Threads` : "–";
    byId("summary-gpu").textContent = gpu?.name || "Nicht erkannt";
    byId("summary-gpu-extra").textContent = gpu
      ? `${gpu.integrated ? "integriert" : "dediziert"}${gpu.adapterRamGb ? ` · ${formatNumber(gpu.adapterRamGb, 1)} GB` : ""}`
      : "–";
    byId("summary-ram").textContent = memory ? `${formatNumber(memory.totalGb, 1)} GB` : "Nicht erkannt";
    byId("summary-ram-extra").textContent = memory ? `${memory.modules?.length || 0} Modul(e)` : "–";
    byId("summary-board").textContent = board ? `${board.manufacturer} ${board.product}`.trim() : "Nicht erkannt";
    byId("summary-board-extra").textContent = state?.hardware?.bios?.version || "–";
    byId("summary-upload").textContent = state?.internetResult ? `${formatNumber(state.internetResult.uploadMbps, 2)} Mbit/s` : "Noch nicht getestet";
    byId("summary-upload-extra").textContent = state?.internetResult ? `${formatNumber(state.internetResult.latencyMs, 0)} ms Latenz` : "–";
    const scanPill = byId("scan-pill");
    scanPill.textContent = hardware ? "Hardware erkannt" : "Noch nicht gescannt";
    scanPill.className = `status-pill ${hardware ? "online" : "neutral"}`;
    setObsConnected(Boolean(latestObs?.connected), latestObs || {});
  }

  function hardwareDl(entries) {
    return `<dl>${entries.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value || "Nicht verfügbar")}</dd></div>`).join("")}</dl>`;
  }

  function renderHardware() {
    const target = byId("hardware-grid");
    const hw = state?.hardware;
    if (!hw) {
      target.className = "hardware-grid empty-state";
      target.innerHTML = "<p>Noch kein Hardware-Scan. Klicke auf „PC jetzt scannen“.</p>";
      return;
    }
    target.className = "hardware-grid";
    const cpu = hw.cpu || {};
    const memory = hw.memory || {};
    const board = hw.mainboard || {};
    const bios = hw.bios || {};
    const preferredGpuName = hw.preferredGpu?.name;
    const cards = [
      `<article class="hardware-card"><h3>Prozessor</h3>${hardwareDl([
        ["Modell", cpu.name], ["Hersteller", cpu.manufacturer], ["Kerne / Threads", `${cpu.cores || "?"} / ${cpu.threads || "?"}`],
        ["Maximaler Takt", cpu.maxClockMhz ? `${cpu.maxClockMhz} MHz` : null], ["Sockel", cpu.socket]
      ])}</article>`,
      `<article class="hardware-card"><h3>Arbeitsspeicher</h3>${hardwareDl([
        ["Gesamt", `${formatNumber(memory.totalGb, 1)} GB`], ["Module", String(memory.modules?.length || 0)],
        ["Takt", memory.modules?.[0]?.speedMt ? `${memory.modules[0].speedMt} MT/s` : null],
        ["Teilenummer", memory.modules?.map((module) => module.partNumber).filter(Boolean).join(", ")]
      ])}</article>`,
      `<article class="hardware-card"><h3>Mainboard und BIOS</h3>${hardwareDl([
        ["Hersteller", board.manufacturer], ["Mainboard", board.product], ["Version", board.version],
        ["BIOS", bios.version], ["BIOS-Hersteller", bios.manufacturer]
      ])}</article>`,
      `<article class="hardware-card"><h3>OBS Studio</h3>${hardwareDl([
        ["Installiert", hw.obs?.installed ? "Ja" : "Nicht erkannt"], ["Pfad", hw.obs?.paths?.join(" · ")]
      ])}</article>`,
      `<article class="hardware-card wide"><h3>Grafikkarten</h3>${hardwareDl((hw.gpus || []).flatMap((gpu, index) => [
        [`GPU ${index + 1}${gpu.name === preferredGpuName ? " · bevorzugt" : ""}`, gpu.name],
        ["Speicher / Treiber", `${gpu.adapterRamGb ? `${formatNumber(gpu.adapterRamGb, 2)} GB` : "Nicht verfügbar"} · ${gpu.driverVersion || "Treiber unbekannt"}`]
      ]))}</article>`,
      `<article class="hardware-card wide"><h3>Monitore</h3>${hardwareDl((hw.monitors || []).map((monitor, index) => [
        `Monitor ${index + 1}`, `${monitor.manufacturer || ""} ${monitor.name || "Unbekannt"}`.trim()
      ]))}</article>`,
      `<article class="hardware-card wide"><h3>Datenträger</h3>${hardwareDl((hw.disks || []).map((disk, index) => [
        `Datenträger ${index + 1}`, `${disk.model} · ${formatNumber(disk.sizeGb, 1)} GB · ${disk.interfaceType || disk.mediaType || ""}`
      ]))}</article>`,
      `<article class="hardware-card wide"><h3>Netzwerkadapter</h3>${hardwareDl((hw.networkAdapters || []).map((adapter, index) => [
        `Adapter ${index + 1}`, `${adapter.name || adapter.description} · ${adapter.status || ""} · ${adapter.linkSpeed || ""}`
      ]))}</article>`
    ];
    target.innerHTML = cards.join("");
  }

  async function scanHardware() {
    const progress = byId("hardware-progress");
    progress.hidden = false;
    byId("hardware-progress-text").textContent = "CIM-, Geräte- und Treiberdaten werden gelesen …";
    byId("hardware-scan").disabled = true;
    byId("overview-scan").disabled = true;
    try {
      state.hardware = await api.scanHardware();
      renderHardware();
      renderOverview();
      showToast("Hardwarediagnose abgeschlossen.");
    } catch (error) {
      showToast(`Hardwarediagnose fehlgeschlagen: ${errorMessage(error)}`, "error");
    } finally {
      progress.hidden = true;
      byId("hardware-scan").disabled = false;
      byId("overview-scan").disabled = false;
    }
  }

  async function runInternetTest() {
    const confirmed = await confirmAction(
      "Internettest starten",
      "Der Test lädt ungefähr 8 MiB herunter und lädt ungefähr 4 MiB hoch. Jetzt starten?"
    );
    if (!confirmed) return;
    const button = byId("internet-start");
    button.disabled = true;
    button.textContent = "Test läuft …";
    try {
      state.internetResult = await api.runInternetTest();
      const result = state.internetResult;
      byId("speed-download").textContent = formatNumber(result.downloadMbps, 2);
      byId("speed-upload").textContent = formatNumber(result.uploadMbps, 2);
      byId("speed-latency").textContent = formatNumber(result.latencyMs, 0);
      byId("speed-budget").textContent = formatNumber(result.uploadMbps * 1000 * .72, 0);
      byId("target-upload").value = result.uploadMbps.toFixed(2);
      const rating = result.uploadMbps >= 25
        ? "Sehr guter Upload für 1080p60 und meist auch 1440p60."
        : result.uploadMbps >= 10
          ? "Guter Upload für 1080p60. Reserviere ungefähr 28 % für Schwankungen."
          : result.uploadMbps >= 6
            ? "1080p60 kann knapp werden; 720p60 oder 1080p30 ist stabiler."
            : "Der Upload ist für einen zuverlässigen Livestream zu niedrig oder stark ausgelastet.";
      byId("internet-evaluation").textContent = `${rating}\nGemessen über ${result.provider}. Das Ergebnis ist eine Momentaufnahme.`;
      renderOverview();
      showToast("Internettest abgeschlossen.");
    } catch (error) {
      showToast(`Internettest fehlgeschlagen: ${errorMessage(error)}`, "error");
      byId("internet-evaluation").textContent = `Test fehlgeschlagen: ${errorMessage(error)}`;
    } finally {
      button.disabled = false;
      button.textContent = "Internettest starten";
    }
  }

  function renderObs(snapshot = latestObs) {
    latestObs = snapshot || {};
    setObsConnected(Boolean(latestObs.connected), latestObs);
    byId("obs-message").textContent = latestObs.lastError || latestObs.error?.message || "";
    const details = [
      ["Verbindung", latestObs.connected ? "Verbunden" : "Getrennt"],
      ["OBS-Version", latestObs.version?.obsVersion],
      ["WebSocket-Version", latestObs.version?.obsWebSocketVersion],
      ["Ausgabeauflösung", latestObs.video?.outputWidth && latestObs.video?.outputHeight ? `${latestObs.video.outputWidth} × ${latestObs.video.outputHeight}` : null],
      ["Basisauflösung", latestObs.video?.baseWidth && latestObs.video?.baseHeight ? `${latestObs.video.baseWidth} × ${latestObs.video.baseHeight}` : null],
      ["FPS", latestObs.stats?.activeFps ? formatNumber(latestObs.stats.activeFps, 2) : null],
      ["OBS-CPU", latestObs.stats?.cpuUsage !== undefined ? `${formatNumber(latestObs.stats.cpuUsage, 1)} %` : null],
      ["Stream", latestObs.stream?.outputActive ? "Aktiv" : "Nicht aktiv"],
      ["Aufnahme", latestObs.record?.outputActive ? "Aktiv" : "Nicht aktiv"]
    ];
    byId("obs-details").innerHTML = details.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value || "Nicht verfügbar")}</dd></div>`).join("");
    const sceneSelect = byId("obs-scene-select");
    const scenes = latestObs.scenes?.scenes || [];
    sceneSelect.innerHTML = scenes.length
      ? scenes.map((scene) => `<option value="${escapeHtml(scene.sceneName)}" ${scene.sceneName === latestObs.scenes.currentProgramSceneName ? "selected" : ""}>${escapeHtml(scene.sceneName)}</option>`).join("")
      : "<option>Keine Szenen verfügbar</option>";
  }

  async function connectObs() {
    const button = byId("obs-connect");
    button.disabled = true;
    byId("obs-message").textContent = "Verbindung wird hergestellt …";
    try {
      const result = await api.connectObs({
        host: "127.0.0.1",
        port: Number(byId("obs-port").value),
        password: byId("obs-password").value,
        rememberPassword: byId("obs-remember").checked
      });
      byId("obs-password").value = "";
      latestObs = await api.getObsSnapshot();
      renderObs(latestObs);
      showToast(`OBS verbunden: ${result.host}:${result.port}`);
    } catch (error) {
      byId("obs-message").textContent = errorMessage(error);
      showToast(`OBS-Verbindung fehlgeschlagen: ${errorMessage(error)}`, "error");
      setObsConnected(false);
    } finally {
      button.disabled = false;
    }
  }

  async function refreshObs() {
    try {
      renderObs(await api.getObsSnapshot());
    } catch (error) {
      showToast(errorMessage(error), "error");
    }
  }

  async function executeObs(action, payload = {}) {
    try {
      await api.executeObs(action, payload);
      showToast(`OBS-Aktion ausgeführt: ${action}`);
      setTimeout(() => void refreshObs(), 350);
    } catch (error) {
      showToast(`OBS-Aktion fehlgeschlagen: ${errorMessage(error)}`, "error");
    }
  }

  function recommendationText(result) {
    const s = result.settings;
    return [
      `Encoder: ${s.encoder}`,
      `Codec: ${s.codec}`,
      `Rate Control: ${s.rateControl}`,
      s.bitrateKbps ? `Bitrate: ${s.bitrateKbps} Kbit/s` : `CQP: ${s.cqp}`,
      `Keyframe-Intervall: ${s.keyframeIntervalSeconds} s`,
      `Preset: ${s.preset}`,
      `Profil: ${s.profile}`,
      `B-Frames: ${s.bFrames}`,
      `Look-ahead: ${s.lookAhead ? "Ein" : "Aus"}`,
      `Psycho Visual Tuning: ${s.psychoVisualTuning ? "Ein" : "Aus"}`,
      `Multipass: ${s.multipass}`
    ].join("\n");
  }

  function renderRecommendation(result) {
    if (!result) return;
    state.recommendation = result;
    byId("recommendation-hardware").textContent = `${result.hardware.gpu} · Ziel: ${result.target.platform}, ${result.target.resolution}, ${result.target.fps} FPS`;
    const labels = {
      encoder: "Encoder", codec: "Codec", rateControl: "Rate Control", bitrateKbps: "Bitrate",
      cqp: "CQP", keyframeIntervalSeconds: "Keyframe", preset: "Preset", profile: "Profil",
      bFrames: "B-Frames", lookAhead: "Look-ahead", psychoVisualTuning: "Psycho Visual Tuning", multipass: "Multipass"
    };
    byId("recommendation-settings").className = "setting-cards";
    byId("recommendation-settings").innerHTML = Object.entries(result.settings)
      .filter(([, value]) => value !== null && value !== undefined)
      .map(([key, value]) => `<article class="setting-card"><span>${escapeHtml(labels[key] || key)}</span><strong>${escapeHtml(typeof value === "boolean" ? (value ? "Ein" : "Aus") : key === "bitrateKbps" ? `${value} Kbit/s` : key === "keyframeIntervalSeconds" ? `${value} s` : value)}</strong></article>`)
      .join("");
    byId("recommendation-notes").innerHTML = result.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("");
  }

  async function buildRecommendation() {
    try {
      const result = await api.buildRecommendation({
        platform: byId("target-platform").value,
        resolution: byId("target-resolution").value,
        fps: Number(byId("target-fps").value),
        uploadMbps: Number(byId("target-upload").value || state?.internetResult?.uploadMbps || 0)
      });
      renderRecommendation(result);
      showToast("Encoder-Empfehlung erstellt.");
    } catch (error) {
      showToast(`Empfehlung fehlgeschlagen: ${errorMessage(error)}`, "error");
    }
  }

  async function runCpuTest() {
    const confirmed = await confirmAction(
      "CPU-Belastungstest starten",
      "Der PC wird zehn Sekunden auf bis zu acht CPU-Threads belastet. Temperaturen währenddessen beobachten und fortfahren?"
    );
    if (!confirmed) return;
    const button = byId("cpu-test-start");
    button.disabled = true;
    byId("cpu-test-result").textContent = "CPU-Test läuft …";
    try {
      const result = await api.runCpuLoadTest({ durationSeconds: 10 });
      byId("cpu-test-result").textContent = JSON.stringify(result, null, 2);
      showToast("CPU-Belastungstest abgeschlossen.");
    } catch (error) {
      byId("cpu-test-result").textContent = errorMessage(error);
      showToast(`CPU-Test fehlgeschlagen: ${errorMessage(error)}`, "error");
    } finally {
      button.disabled = false;
    }
  }

  async function runObsTest() {
    const confirmed = await confirmAction(
      "OBS-Aufnahmetest starten",
      "OBS startet eine 15-sekündige Aufnahme und beendet sie danach. Speicherplatz und Ausgabeordner von OBS werden verwendet. Fortfahren?"
    );
    if (!confirmed) return;
    const button = byId("obs-test-start");
    button.disabled = true;
    byId("obs-test-result").textContent = "OBS-Aufnahmetest läuft 15 Sekunden …";
    try {
      const result = await api.runObsRecordingTest({ durationSeconds: 15 });
      byId("obs-test-result").textContent = JSON.stringify(result.summary, null, 2);
      showToast(result.summary.stable ? "OBS-Aufnahmetest stabil abgeschlossen." : "OBS-Test abgeschlossen; übersprungene Frames wurden erkannt.", result.summary.stable ? "success" : "error");
      await refreshObs();
    } catch (error) {
      byId("obs-test-result").textContent = errorMessage(error);
      showToast(`OBS-Test fehlgeschlagen: ${errorMessage(error)}`, "error");
    } finally {
      button.disabled = false;
    }
  }

  function applyModuleFrame(frame, status, label) {
    if (!status?.running || !status.editorUrl) {
      frame.removeAttribute("src");
      frame.dataset.baseUrl = "";
      const message = status?.error?.message || (label + " ist nicht gestartet.");
      frame.srcdoc = '<!doctype html><html><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#080d14;color:#d7e4ee;font:16px Segoe UI,Arial,sans-serif"><div style="max-width:620px;padding:28px;text-align:center"><h2>' + escapeHtml(label) + '</h2><p>' + escapeHtml(message) + '</p></div></body></html>';
      return;
    }
    frame.removeAttribute("srcdoc");
    if (frame.dataset.baseUrl === status.editorUrl) return;
    frame.dataset.baseUrl = status.editorUrl;
    const separator = status.editorUrl.includes("?") ? "&" : "?";
    frame.src = status.editorUrl + separator + "embedded=1&version=" + encodeURIComponent(state?.product?.version || "2.0.0");
  }

  async function loadMonitoringFrame() {
    try {
      const status = await api.getMonitoringStatus();
      byId("monitoring-url").textContent = status.overlayUrl || "Nicht gestartet";
      applyModuleFrame(byId("monitoring-frame"), status, "Monitoring-Overlay");
    } catch (error) {
      applyModuleFrame(byId("monitoring-frame"), { running: false, error: { message: errorMessage(error) } }, "Monitoring-Overlay");
      showToast(errorMessage(error), "error");
    }
  }

  async function loadHoloFrame() {
    try {
      const status = await api.getHoloStatus();
      byId("holo-url").textContent = status.overlayUrl || "Nicht gestartet";
      applyModuleFrame(byId("holo-frame"), status, "Twitch-Hologramm");
    } catch (error) {
      applyModuleFrame(byId("holo-frame"), { running: false, error: { message: errorMessage(error) } }, "Twitch-Hologramm");
      showToast(errorMessage(error), "error");
    }
  }

  function deckState() {
    state.settings.deck ||= { activeProfile: "Standard", profiles: {} };
    const deck = state.settings.deck;
    deck.profiles ||= {};
    if (!Object.keys(deck.profiles).length) {
      deck.profiles.Standard = { rows: 3, columns: 5, pages: { root: [] } };
    }
    if (!deck.profiles[deck.activeProfile]) deck.activeProfile = Object.keys(deck.profiles)[0];
    return deck;
  }

  function activeDeckProfile() {
    const deck = deckState();
    const profile = deck.profiles[deck.activeProfile];
    profile.pages ||= { root: [] };
    profile.pages.root ||= [];
    return profile;
  }

  function renderDeckProfileOptions() {
    const deck = deckState();
    byId("deck-profile").innerHTML = Object.keys(deck.profiles)
      .map((name) => `<option value="${escapeHtml(name)}" ${name === deck.activeProfile ? "selected" : ""}>${escapeHtml(name)}</option>`)
      .join("");
  }

  function assignmentLabel(assignment) {
    if (!assignment) return "Leer";
    if (assignment.type === "obs") return assignment.action;
    if (assignment.type === "url") return "Webseite";
    if (assignment.type === "monitoring-editor") return "Monitoring";
    if (assignment.type === "holo-editor") return "Hologramm";
    return assignment.type || "Aktion";
  }

  function renderDeck() {
    if (byId("view-deck")?.classList.contains("touch-deck-v3")) return;
    if (!state?.settings) return;
    const deck = deckState();
    const profile = activeDeckProfile();
    renderDeckProfileOptions();
    byId("deck-rows").value = profile.rows;
    byId("deck-columns").value = profile.columns;
    const count = profile.rows * profile.columns;
    while (profile.pages.root.length < count) profile.pages.root.push(null);
    const grid = byId("deck-grid");
    grid.style.gridTemplateColumns = `repeat(${profile.columns}, minmax(74px, 1fr))`;
    grid.innerHTML = "";
    for (let index = 0; index < count; index += 1) {
      const assignment = profile.pages.root[index];
      const button = document.createElement("button");
      button.type = "button";
      button.className = `deck-key${assignment ? "" : " empty"}${index === selectedDeckIndex ? " selected" : ""}`;
      button.innerHTML = `<span>${escapeHtml(assignment?.title || (assignment ? assignmentLabel(assignment) : `Taste ${index + 1}`))}</span><small>${index + 1}</small>`;
      button.addEventListener("click", () => {
        selectedDeckIndex = index;
        renderDeck();
        fillDeckInspector();
      });
      button.addEventListener("dblclick", async () => {
        if (!assignment) return;
        try {
          await api.executeDeckAction(assignment);
          showToast(`Taste ausgeführt: ${assignment.title || assignmentLabel(assignment)}`);
        } catch (error) {
          showToast(errorMessage(error), "error");
        }
      });
      grid.append(button);
    }
    fillDeckInspector();
  }

  function fillDeckInspector() {
    const profile = activeDeckProfile();
    const assignment = selectedDeckIndex >= 0 ? profile.pages.root[selectedDeckIndex] : null;
    byId("deck-selected-label").textContent = selectedDeckIndex >= 0 ? `Taste ${selectedDeckIndex + 1}` : "Keine Taste ausgewählt.";
    byId("deck-title").value = assignment?.title || "";
    let type = "none";
    let value = "";
    if (assignment?.type === "obs") {
      type = `obs:${assignment.action}`;
      value = assignment.payload?.sceneName || "";
    } else if (assignment?.type) {
      type = assignment.type;
      value = assignment.url || "";
    }
    byId("deck-action-type").value = type;
    byId("deck-action-value").value = value;
    byId("deck-value-row").hidden = !["obs:scene.set", "url"].includes(type);
  }

  function assignmentFromInspector() {
    const type = byId("deck-action-type").value;
    const title = byId("deck-title").value.trim();
    const value = byId("deck-action-value").value.trim();
    if (type === "none") return null;
    if (type.startsWith("obs:")) {
      const action = type.slice(4);
      return {
        type: "obs",
        action,
        title: title || action,
        payload: action === "scene.set" ? { sceneName: value } : {}
      };
    }
    if (type === "url") return { type: "url", url: value, title: title || "Webseite" };
    return { type, title: title || (type === "monitoring-editor" ? "Monitoring" : "Hologramm") };
  }

  async function saveDeck() {
    try {
      state.settings = await api.saveSettings({ deck: deckState() });
      showToast("Touch-Deck gespeichert.");
    } catch (error) {
      showToast(`Deck konnte nicht gespeichert werden: ${errorMessage(error)}`, "error");
    }
  }

  function applyDeckGrid() {
    const profile = activeDeckProfile();
    const rows = Math.max(1, Math.min(10, Math.round(Number(byId("deck-rows").value) || 3)));
    const columns = Math.max(1, Math.min(10, Math.round(Number(byId("deck-columns").value) || 5)));
    profile.rows = rows;
    profile.columns = columns;
    while (profile.pages.root.length < rows * columns) profile.pages.root.push(null);
    selectedDeckIndex = -1;
    renderDeck();
    showToast("Raster geändert. Verdeckte Belegungen bleiben im Profil gespeichert.");
  }

  async function saveSettings() {
    try {
      const preferences = {
        platform: byId("settings-platform").value,
        targetResolution: byId("settings-resolution").value,
        targetFps: Number(byId("settings-fps").value),
        monitoringEnabled: true,
        twitchHoloEnabled: true
      };
      state.settings = await api.saveSettings({ preferences, deck: deckState() });
      showToast("Einstellungen gespeichert.");
    } catch (error) {
      showToast(errorMessage(error), "error");
    }
  }

  function syncSettings() {
    const settings = state?.settings;
    if (!settings) return;
    byId("obs-host").value = "127.0.0.1";
    byId("obs-port").value = settings.obs?.port || 4455;
    byId("settings-platform").value = settings.preferences?.platform || "twitch";
    byId("settings-resolution").value = settings.preferences?.targetResolution || "1920x1080";
    byId("settings-fps").value = String(settings.preferences?.targetFps || 60);
    byId("target-platform").value = settings.preferences?.platform || "twitch";
    byId("target-resolution").value = settings.preferences?.targetResolution || "1920x1080";
    byId("target-fps").value = String(settings.preferences?.targetFps || 60);
  }

  function updateTelemetry(telemetry) {
    latestTelemetry = telemetry;
    const cpu = telemetry?.system?.cpu;
    const ram = telemetry?.system?.ram;
    const gpu = telemetry?.gpu || telemetry?.gpus?.[0];
    const network = telemetry?.system?.network;
    byId("live-cpu").textContent = cpu?.utilizationPercent !== undefined ? `${formatNumber(cpu.utilizationPercent, 0)} %` : "–";
    byId("live-ram").textContent = ram?.percent !== undefined ? `${formatNumber(ram.percent, 0)} %` : "–";
    byId("live-gpu").textContent = gpu?.utilizationPercent !== undefined && gpu.utilizationPercent !== null ? `${formatNumber(gpu.utilizationPercent, 0)} %` : "Nicht verfügbar";
    byId("live-upload").textContent = network ? formatRate(network.uploadBytesPerSecond) : "–";
    byId("live-ping").textContent = network?.latencyMs !== null && network?.latencyMs !== undefined ? `${formatNumber(network.latencyMs, 0)} ms` : "–";
    byId("live-fps").textContent = telemetry?.video?.outputFps ? formatNumber(telemetry.video.outputFps, 1) : "–";
  }

  function bindEvents() {
    document.querySelectorAll(".nav-button").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
    document.querySelectorAll("[data-jump]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.jump)));
    byId("overview-scan").addEventListener("click", () => { switchView("hardware"); void scanHardware(); });
    byId("hardware-scan").addEventListener("click", () => void scanHardware());
    byId("hardware-save-report").addEventListener("click", async () => {
      try {
        const result = await api.saveReport({ hardware: state.hardware, internet: state.internetResult, obs: latestObs, recommendation: state.recommendation });
        if (result.saved) showToast(`Bericht gespeichert: ${result.filePath}`);
      } catch (error) { showToast(errorMessage(error), "error"); }
    });
    byId("overview-connect-obs").addEventListener("click", () => switchView("obs"));
    byId("internet-start").addEventListener("click", () => void runInternetTest());
    byId("obs-connect").addEventListener("click", () => void connectObs());
    byId("obs-disconnect").addEventListener("click", async () => { await api.disconnectObs(); renderObs(await api.getObsSnapshot()); });
    byId("obs-forget-password").addEventListener("click", async () => { await api.forgetObsPassword(); showToast("Gespeichertes OBS-Passwort entfernt."); });
    byId("obs-refresh").addEventListener("click", () => void refreshObs());
    document.querySelectorAll("[data-obs-action]").forEach((button) => button.addEventListener("click", () => void executeObs(button.dataset.obsAction)));
    byId("obs-set-scene").addEventListener("click", () => void executeObs("scene.set", { sceneName: byId("obs-scene-select").value }));
    byId("recommendation-build").addEventListener("click", () => void buildRecommendation());
    byId("recommendation-copy").addEventListener("click", async () => {
      if (!state.recommendation) return showToast("Noch keine Empfehlung vorhanden.", "error");
      try { await navigator.clipboard.writeText(recommendationText(state.recommendation)); showToast("Empfohlene Werte kopiert."); }
      catch (error) { showToast(errorMessage(error), "error"); }
    });
    byId("cpu-test-start").addEventListener("click", () => void runCpuTest());
    byId("obs-test-start").addEventListener("click", () => void runObsTest());
    byId("monitoring-copy").addEventListener("click", async () => { try { showToast(`OBS-Adresse kopiert: ${await api.copyMonitoringUrl()}`); } catch (error) { showToast(errorMessage(error), "error"); } });
    byId("monitoring-external").addEventListener("click", () => void api.openMonitoringEditor());
    byId("holo-copy").addEventListener("click", async () => { try { showToast(`OBS-Adresse kopiert: ${await api.copyHoloUrl()}`); } catch (error) { showToast(errorMessage(error), "error"); } });
    byId("holo-external").addEventListener("click", () => void api.openHoloEditor());
    byId("deck-profile").addEventListener("change", () => { deckState().activeProfile = byId("deck-profile").value; selectedDeckIndex = -1; renderDeck(); });
    byId("deck-profile-add").addEventListener("click", () => {
      const name = window.prompt("Name des neuen Touch-Deck-Profils:", "Neues Profil");
      if (!name?.trim()) return;
      const normalized = name.trim().slice(0, 80);
      const deck = deckState();
      if (deck.profiles[normalized]) return showToast("Dieses Profil existiert bereits.", "error");
      deck.profiles[normalized] = { rows: 3, columns: 5, pages: { root: [] } };
      deck.activeProfile = normalized;
      selectedDeckIndex = -1;
      renderDeck();
    });
    byId("deck-apply-grid").addEventListener("click", applyDeckGrid);
    byId("deck-save").addEventListener("click", () => void saveDeck());
    byId("deck-action-type").addEventListener("change", () => { byId("deck-value-row").hidden = !["obs:scene.set", "url"].includes(byId("deck-action-type").value); });
    byId("deck-apply-key").addEventListener("click", () => {
      if (selectedDeckIndex < 0) return showToast("Zuerst eine Taste auswählen.", "error");
      activeDeckProfile().pages.root[selectedDeckIndex] = assignmentFromInspector();
      renderDeck();
    });
    byId("deck-clear-key").addEventListener("click", () => {
      if (selectedDeckIndex < 0) return;
      activeDeckProfile().pages.root[selectedDeckIndex] = null;
      renderDeck();
    });
    byId("settings-save").addEventListener("click", () => void saveSettings());
    api.onTelemetry(updateTelemetry);
    api.onObsStatusChanged((status) => setObsConnected(Boolean(status.connected), status));
    api.onTelemetryError((error) => console.warn("Telemetry:", error));
  }

  async function initialize() {
    if (!api) throw new Error("Batto Desktop API ist nicht verfügbar.");
    state = await api.getState();
    latestObs = state.obs;
    latestTelemetry = state.telemetry;
    byId("version-label").textContent = `Version ${state.product.version}`;
    syncSettings();
    renderOverview();
    renderHardware();
    renderObs(latestObs);
    if (state.internetResult) {
      byId("speed-download").textContent = formatNumber(state.internetResult.downloadMbps, 2);
      byId("speed-upload").textContent = formatNumber(state.internetResult.uploadMbps, 2);
      byId("speed-latency").textContent = formatNumber(state.internetResult.latencyMs, 0);
      byId("speed-budget").textContent = formatNumber(state.internetResult.uploadMbps * 1000 * .72, 0);
      byId("target-upload").value = state.internetResult.uploadMbps.toFixed(2);
    }
    if (state.recommendation) renderRecommendation(state.recommendation);
    updateTelemetry(latestTelemetry);
    renderDeck();
    bindEvents();
    switchView("overview");
  }

  initialize().catch((error) => {
    console.error(error);
    showToast(`Batto OBS Tool konnte nicht vollständig geladen werden: ${errorMessage(error)}`, "error");
  });
})();
