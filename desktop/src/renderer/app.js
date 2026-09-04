"use strict";

(() => {
  const api = window.batto;
  const byId = (id) => document.getElementById(id);
  const pageMeta = {
    overview: ["Übersicht", "Hardwarediagnose, OBS, Multi-Chat und Chat Bot."],
    hardware: ["Hardwarediagnose", "Tatsächlich verbaute Komponenten lokal erfassen."],
    internet: ["Internettest", "Upload, Download und Latenz messen."],
    obs: ["OBS-Verbindung", "OBS WebSocket 5 verbinden und steuern."],
    holo: ["Twitch-Hologramm", "Namen und Chatfarben holografisch gestalten."],
    settings: ["Einstellungen", "Lokale Einstellungen des Batto OBS Tools."]
  };
  let state = null;
  let latestObs = null;
  let toastTimer = null;

  function esc(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
  function num(value, fallback = null) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
  function fmt(value, decimals = 0) { const parsed = num(value); return parsed === null ? "Nicht verfügbar" : parsed.toLocaleString("de-DE", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }); }
  function errorMessage(error) { return String(error?.message || error || "Unbekannter Fehler"); }
  function toast(message, error = false) { const el = byId("toast"); if (!el) return; el.textContent = message; el.className = `toast${error ? " error" : ""}`; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 4200); }
  function confirmAction(title, text) {
    const dialog = byId("confirm-dialog");
    if (!dialog?.showModal) return Promise.resolve(window.confirm(text));
    byId("confirm-title").textContent = title; byId("confirm-text").textContent = text; dialog.returnValue = "cancel"; dialog.showModal();
    return new Promise((resolve) => { const done = () => { dialog.removeEventListener("close", done); resolve(dialog.returnValue === "confirm"); }; dialog.addEventListener("close", done); });
  }

  function switchView(name) {
    if (!pageMeta[name]) return;
    document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === `view-${name}`));
    document.querySelectorAll(".nav-button").forEach((button) => button.classList.toggle("active", button.dataset.view === name));
    byId("page-title").textContent = pageMeta[name][0];
    byId("page-subtitle").textContent = pageMeta[name][1];
    if (name === "holo") void loadHolo();
  }

  function setObsConnected(connected, details = {}) {
    const pill = byId("obs-pill"); if (pill) { pill.textContent = connected ? "OBS verbunden" : "OBS getrennt"; pill.className = `status-pill ${connected ? "online" : "offline"}`; }
    const large = byId("obs-status-large"); if (large) { large.textContent = connected ? "Verbunden" : "Nicht verbunden"; large.className = `large-status ${connected ? "online" : "offline"}`; }
    const summary = byId("summary-obs"); if (summary) summary.textContent = connected ? "Verbunden" : "Nicht verbunden";
    const extra = byId("summary-obs-extra"); if (extra && details.version?.obsVersion) extra.textContent = `OBS ${details.version.obsVersion}`;
    document.querySelectorAll("[data-obs-action]").forEach((button) => { button.disabled = !connected; });
    if (byId("obs-set-scene")) byId("obs-set-scene").disabled = !connected;
  }

  function renderOverview() {
    const hw = state?.hardware || {};
    byId("summary-cpu").textContent = hw.cpu?.name || "Nicht erkannt";
    byId("summary-cpu-extra").textContent = hw.cpu ? `${hw.cpu.cores || "?"} Kerne · ${hw.cpu.threads || "?"} Threads` : "–";
    byId("summary-gpu").textContent = hw.preferredGpu?.name || "Nicht erkannt";
    byId("summary-gpu-extra").textContent = hw.preferredGpu?.adapterRamGb ? `${fmt(hw.preferredGpu.adapterRamGb, 1)} GB` : "–";
    byId("summary-ram").textContent = hw.memory ? `${fmt(hw.memory.totalGb, 1)} GB` : "Nicht erkannt";
    byId("summary-ram-extra").textContent = hw.memory ? `${hw.memory.modules?.length || 0} Modul(e)` : "–";
    byId("summary-board").textContent = hw.mainboard ? `${hw.mainboard.manufacturer || ""} ${hw.mainboard.product || ""}`.trim() : "Nicht erkannt";
    byId("summary-board-extra").textContent = hw.bios?.version || "–";
    byId("summary-upload").textContent = state?.internetResult ? `${fmt(state.internetResult.uploadMbps, 2)} Mbit/s` : "Noch nicht getestet";
    byId("summary-upload-extra").textContent = state?.internetResult ? `${fmt(state.internetResult.latencyMs, 0)} ms Latenz` : "–";
    const scan = byId("scan-pill"); scan.textContent = state?.hardware ? "Hardware erkannt" : "Noch nicht gescannt"; scan.className = `status-pill ${state?.hardware ? "online" : "neutral"}`;
    setObsConnected(Boolean(latestObs?.connected), latestObs || {});
  }

  function dl(entries) { return `<dl>${entries.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value || "Nicht verfügbar")}</dd></div>`).join("")}</dl>`; }
  function renderHardware() {
    const target = byId("hardware-grid"); const hw = state?.hardware;
    if (!hw) { target.className = "hardware-grid empty-state"; target.innerHTML = "<p>Noch kein Hardware-Scan.</p>"; return; }
    target.className = "hardware-grid";
    target.innerHTML = [
      `<article class="hardware-card"><h3>Prozessor</h3>${dl([["Modell", hw.cpu?.name], ["Hersteller", hw.cpu?.manufacturer], ["Kerne / Threads", `${hw.cpu?.cores || "?"} / ${hw.cpu?.threads || "?"}`]])}</article>`,
      `<article class="hardware-card"><h3>Arbeitsspeicher</h3>${dl([["Gesamt", `${fmt(hw.memory?.totalGb, 1)} GB`], ["Module", String(hw.memory?.modules?.length || 0)]])}</article>`,
      `<article class="hardware-card"><h3>Mainboard und BIOS</h3>${dl([["Hersteller", hw.mainboard?.manufacturer], ["Mainboard", hw.mainboard?.product], ["BIOS", hw.bios?.version]])}</article>`,
      `<article class="hardware-card wide"><h3>Grafikkarten</h3>${dl((hw.gpus || []).map((gpu, i) => [`GPU ${i + 1}`, `${gpu.name || "Unbekannt"}${gpu.adapterRamGb ? ` · ${fmt(gpu.adapterRamGb, 1)} GB` : ""}`]))}</article>`,
      `<article class="hardware-card wide"><h3>Datenträger</h3>${dl((hw.disks || []).map((disk, i) => [`Datenträger ${i + 1}`, `${disk.model || "Unbekannt"} · ${fmt(disk.sizeGb, 1)} GB`]))}</article>`
    ].join("");
  }

  async function scanHardware() {
    const progress = byId("hardware-progress"); progress.hidden = false;
    byId("hardware-scan").disabled = true; byId("overview-scan").disabled = true;
    try { state.hardware = await api.scanHardware(); renderHardware(); renderOverview(); toast("Hardwarediagnose abgeschlossen."); }
    catch (error) { toast(`Hardwarediagnose fehlgeschlagen: ${errorMessage(error)}`, true); }
    finally { progress.hidden = true; byId("hardware-scan").disabled = false; byId("overview-scan").disabled = false; }
  }

  async function internetTest() {
    if (!(await confirmAction("Internettest starten", "Der Test überträgt Daten über deine Internetverbindung. Jetzt starten?"))) return;
    const button = byId("internet-start"); button.disabled = true;
    try {
      state.internetResult = await api.runInternetTest(); const result = state.internetResult;
      byId("speed-download").textContent = fmt(result.downloadMbps, 2); byId("speed-upload").textContent = fmt(result.uploadMbps, 2); byId("speed-latency").textContent = fmt(result.latencyMs, 0);
      byId("internet-evaluation").textContent = `Gemessen über ${result.provider || "Internettest"}. Das Ergebnis ist eine Momentaufnahme.`; renderOverview(); toast("Internettest abgeschlossen.");
    } catch (error) { byId("internet-evaluation").textContent = `Test fehlgeschlagen: ${errorMessage(error)}`; toast("Internettest fehlgeschlagen.", true); }
    finally { button.disabled = false; }
  }

  function renderObs(snapshot) {
    latestObs = snapshot || {}; setObsConnected(Boolean(latestObs.connected), latestObs);
    byId("obs-message").textContent = latestObs.lastError || latestObs.error?.message || "";
    const details = [["Verbindung", latestObs.connected ? "Verbunden" : "Getrennt"], ["OBS-Version", latestObs.version?.obsVersion], ["WebSocket-Version", latestObs.version?.obsWebSocketVersion], ["Stream", latestObs.stream?.outputActive ? "Aktiv" : "Nicht aktiv"], ["Aufnahme", latestObs.record?.outputActive ? "Aktiv" : "Nicht aktiv"]];
    byId("obs-details").innerHTML = details.map(([k,v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v || "Nicht verfügbar")}</dd></div>`).join("");
    const select = byId("obs-scene-select"); const scenes = latestObs.scenes?.scenes || []; select.innerHTML = scenes.length ? scenes.map((s) => `<option value="${esc(s.sceneName)}" ${s.sceneName === latestObs.scenes?.currentProgramSceneName ? "selected" : ""}>${esc(s.sceneName)}</option>`).join("") : "<option>OBS verbinden</option>";
    renderOverview();
  }

  async function connectObs() { try { renderObs(await api.connectObs({ host: byId("obs-host").value, port: Number(byId("obs-port").value), password: byId("obs-password").value, rememberPassword: byId("obs-remember").checked })); byId("obs-password").value = ""; toast("OBS verbunden."); } catch (error) { byId("obs-message").textContent = errorMessage(error); toast("OBS-Verbindung fehlgeschlagen.", true); } }
  async function refreshObs() { try { renderObs(await api.getObsSnapshot()); } catch (error) { toast(errorMessage(error), true); } }
  async function loadHolo() { try { const status = await api.getHoloStatus(); byId("holo-url").textContent = status.overlayUrl || "Nicht gestartet"; if (status.editorUrl && byId("holo-frame").src !== status.editorUrl) byId("holo-frame").src = status.editorUrl; } catch (error) { toast(errorMessage(error), true); } }

  function bind() {
    document.querySelectorAll(".nav-button").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
    byId("overview-scan").onclick = scanHardware; byId("hardware-scan").onclick = scanHardware; byId("overview-connect-obs").onclick = () => switchView("obs");
    byId("hardware-save-report").onclick = async () => { if (!state?.hardware) return toast("Zuerst Hardware scannen.", true); const result = await api.saveReport({ createdAt: new Date().toISOString(), hardware: state.hardware, internetResult: state.internetResult, obs: latestObs }); if (result.saved) toast("Bericht gespeichert."); };
    byId("internet-start").onclick = internetTest;
    byId("obs-connect").onclick = connectObs; byId("obs-disconnect").onclick = async () => renderObs(await api.disconnectObs()); byId("obs-forget-password").onclick = async () => { await api.forgetObsPassword(); toast("Gespeichertes OBS-Passwort gelöscht."); }; byId("obs-refresh").onclick = refreshObs;
    document.querySelectorAll("[data-obs-action]").forEach((button) => button.onclick = async () => { try { await api.executeObs(button.dataset.obsAction, {}); await refreshObs(); } catch (error) { toast(errorMessage(error), true); } });
    byId("obs-set-scene").onclick = async () => { try { await api.executeObs("scene.set", { sceneName: byId("obs-scene-select").value }); await refreshObs(); } catch (error) { toast(errorMessage(error), true); } };
    byId("holo-copy").onclick = async () => { try { await api.copyHoloUrl(); toast("OBS-Adresse kopiert."); } catch (error) { toast(errorMessage(error), true); } };
    byId("holo-external").onclick = async () => { try { await api.openHoloEditor(); } catch (error) { toast(errorMessage(error), true); } };
  }

  async function init() {
    try { state = await api.getState(); latestObs = state.obs || {}; byId("version-label").textContent = `Version ${state.product?.version || "2.0.0"}`; renderOverview(); renderHardware(); renderObs(latestObs); bind(); }
    catch (error) { toast(`Startfehler: ${errorMessage(error)}`, true); }
  }
  init();
})();
