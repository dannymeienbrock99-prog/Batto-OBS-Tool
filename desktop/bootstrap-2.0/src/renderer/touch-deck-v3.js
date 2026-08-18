"use strict";

(() => {
  const api = window.batto;
  if (!api?.invoke) return;

  const html = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  const actionTransferType = "application/x-batto-touch-deck-action";
  const keyTransferType = "application/x-batto-touch-deck-key";
  const layoutPresets = Object.freeze({
    custom: { label: "Frei einstellen", rows: null, columns: null },
    mini: { label: "Stream Deck Mini · 6", rows: 2, columns: 3 },
    neo: { label: "Stream Deck Neo · 8", rows: 2, columns: 4 },
    plus: { label: "Stream Deck + · 8", rows: 2, columns: 4 },
    standard: { label: "Stream Deck · 15", rows: 3, columns: 5 },
    xl: { label: "Stream Deck XL · 32", rows: 4, columns: 8 }
  });
  const blankButton = (index) => ({
    id: `button-${index + 1}`,
    title: "",
    subtitle: "",
    icon: "",
    color: "#152130",
    textColor: "#ffffff",
    folderId: "",
    actions: [],
    enabled: true
  });

  let view = null;
  let state = null;
  let selectedIndex = -1;
  let draft = null;
  let draftDirty = false;
  let buttonClipboard = null;
  let libraryTab = "actions";
  let searchText = "";
  let gridSettingsOpen = true;
  let mode = "run";
  let moveSourceIndex = -1;
  let pendingAction = null;
  let assignmentMode = "replace";
  let layoutPreview = null;
  let lastLibrarySignature = "";
  let fitFrame = 0;
  let resizeObserver = null;
  let lastViewSignature = "";
  const groupState = new Map();

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function toast(message, error = false) {
    const target = document.getElementById("toast");
    if (!target) return;
    target.textContent = String(message || "");
    target.className = `toast${error ? " error" : ""}`;
    target.hidden = false;
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => { target.hidden = true; }, 3600);
  }

  async function call(channel, payload = {}) {
    try {
      return await api.invoke(channel, payload);
    } catch (error) {
      toast(error?.message || String(error), true);
      throw error;
    }
  }

  function profile() {
    const profiles = state?.deck?.profiles || [];
    const id = $("#tdp-profile")?.value || state?.deck?.activeProfileId;
    return profiles.find((entry) => entry.id === id) || profiles[0] || null;
  }

  function folder(currentProfile = profile()) {
    if (!currentProfile) return null;
    const id = $("#tdp-folder")?.value || currentProfile.activeFolderId || "root";
    return currentProfile.folders?.find((entry) => entry.id === id)
      || currentProfile.folders?.find((entry) => entry.id === "root")
      || currentProfile.folders?.[0]
      || null;
  }

  function actionCatalog() {
    const result = [];
    for (const plugin of state?.plugins?.plugins || []) {
      if (!plugin.enabled) continue;
      for (const action of plugin.actions || []) {
        if (action.visibleInActionsList === false || action.raw?.supportedInTouchDeck === false) continue;
        result.push({
          pluginId: plugin.id,
          pluginName: plugin.name,
          pluginIcon: plugin.icon || "",
          pluginNative: Boolean(plugin.native),
          actionId: action.id,
          actionName: action.name,
          actionIcon: action.icon || action.states?.find((entry) => entry.image)?.image || plugin.icon || "",
          tooltip: action.tooltip || plugin.description || ""
        });
      }
    }
    return result.sort((a, b) => `${a.pluginName} ${a.actionName}`.localeCompare(`${b.pluginName} ${b.actionName}`, "de"));
  }

  function filteredPlugins() {
    const query = searchText.trim().toLocaleLowerCase("de");
    return (state?.plugins?.plugins || []).filter((plugin) => {
      if (!query) return true;
      return [plugin.name, plugin.description, plugin.category, ...(plugin.actions || []).flatMap((action) => [action.name, action.id])]
        .some((value) => String(value || "").toLocaleLowerCase("de").includes(query));
    });
  }

  function iconMarkup(icon, fallback = "◆") {
    return icon
      ? `<img src="${html(icon)}" alt="">`
      : `<span class="tdp-fallback-icon" aria-hidden="true">${html(fallback)}</span>`;
  }

  function pluginFallback(plugin) {
    const name = String(plugin?.name || "").toLowerCase();
    if (name.includes("youtube")) return "▶";
    if (name.includes("twitch")) return "◩";
    if (name.includes("discord")) return "◉";
    if (name.includes("obs")) return "◍";
    if (name.includes("music") || name.includes("spotify")) return "♫";
    if (name.includes("camera") || name.includes("obsbot")) return "◫";
    if (name.includes("window") || name.includes("launcher")) return "↔";
    return "◆";
  }

  function markup() {
    return `
      <div class="tdp-shell" data-mode="run">
        <header class="tdp-heading">
          <div>
            <span class="eyebrow">PROFILE · ORDNER · PLUGIN-AKTIONEN</span>
            <h2>Touch-Deck</h2>
            <p>Tasten frei belegen, Geräte-Raster wählen und Größe, Abstand sowie Beschriftung an deinen Touch-Monitor anpassen.</p>
          </div>
          <div class="button-row">
            <button id="tdp-mode" class="primary" type="button">✎ Tasten belegen</button>
            <button id="tdp-fullscreen" type="button">⛶ Vollbild</button>
            <button id="tdp-import" type="button">Importieren</button>
            <button id="tdp-export" type="button">Exportieren</button>
          </div>
        </header>

        <section class="tdp-profilebar">
          <label>Profil<select id="tdp-profile"></select></label>
          <button id="tdp-add-profile" type="button">+ Profil</button>
          <label>Ordner<select id="tdp-folder"></select></label>
          <button id="tdp-back-folder" type="button">← Zurück</button>
          <button id="tdp-add-folder" type="button">+ Ordner</button>
          <button id="tdp-move-key" type="button" disabled>↔ Taste verschieben</button>
          <button id="tdp-grid-settings" class="tdp-icon-button" type="button" aria-pressed="true" title="Rastereinstellungen ein- oder ausblenden">⚙</button>
        </section>

        <div class="tdp-editor-layout">
          <aside class="tdp-library" aria-label="Plugin- und Aktionsbibliothek">
            <div class="tdp-search-row">
              <span aria-hidden="true">⌕</span>
              <input id="tdp-search" type="search" placeholder="Suchen" autocomplete="off">
              <button id="tdp-rescan" type="button" title="Plugins neu scannen">☷</button>
            </div>
            <div class="tdp-library-tabs" role="tablist" aria-label="Bibliotheksansicht">
              <button id="tdp-tab-actions" class="active" type="button" role="tab" aria-selected="true"><span>▣</span>Tasten</button>
              <button id="tdp-tab-plugins" type="button" role="tab" aria-selected="false">Plugins</button>
            </div>
            <div id="tdp-library-content" class="tdp-library-content"></div>
          </aside>

          <main class="tdp-stage">
            <section id="tdp-grid-panel" class="tdp-grid-panel">
              <label class="tdp-preset-field">Gerät / Raster<select id="tdp-preset">${Object.entries(layoutPresets).map(([value, preset]) => `<option value="${value}">${preset.label}</option>`).join("")}</select></label>
              <label>Zeilen<input id="tdp-rows" type="number" min="1" max="10"></label>
              <label>Spalten<input id="tdp-columns" type="number" min="1" max="10"></label>
              <label class="tdp-slider-field">Tastengröße <output id="tdp-size-value">116 px</output><input id="tdp-size" type="range" min="48" max="320" step="2"></label>
              <label class="tdp-slider-field">Abstand <output id="tdp-gap-value">12 px</output><input id="tdp-gap" type="range" min="0" max="48"></label>
              <label class="tdp-slider-field">Ecken <output id="tdp-radius-value">12 px</output><input id="tdp-radius" type="range" min="0" max="48"></label>
              <label class="tdp-check"><input id="tdp-auto-fit" type="checkbox" checked> Automatisch einpassen</label>
              <label class="tdp-check"><input id="tdp-show-labels" type="checkbox" checked> Beschriftungen zeigen</label>
              <label class="tdp-check"><input id="tdp-hide-unused" type="checkbox"> Unbenutzte Tasten ausblenden</label>
              <button id="tdp-apply-grid" type="button">Raster übernehmen</button>
            </section>
            <section id="tdp-assignment-bar" class="tdp-assignment-bar" hidden>
              <span class="tdp-assignment-icon" id="tdp-assignment-icon"></span>
              <span><strong id="tdp-assignment-title">Aktion gewählt</strong><small>Jetzt eine Zieltaste antippen – die Belegung wird sofort gespeichert.</small></span>
              <label>Belegen<select id="tdp-assignment-mode"><option value="replace">Taste ersetzen</option><option value="append">Als Mehrfachaktion anhängen</option></select></label>
              <button id="tdp-cancel-assignment" type="button">Abbrechen</button>
            </section>
            <div class="tdp-stage-meta">
              <span id="tdp-capacity">0 Tasten</span>
              <span id="tdp-draft-state">Alle Änderungen gespeichert</span>
            </div>
            <div class="tdp-grid-viewport">
              <div id="tdp-grid" class="tdp-grid" aria-label="Touch-Deck-Tasten"></div>
            </div>
            <p id="tdp-stage-help" class="tdp-stage-help">Taste antippen, um die hinterlegte Aktion auszuführen. Ordner öffnen sich mit einem Tipp.</p>
          </main>

          <aside class="tdp-inspector">
            <header>
              <div><h3>Taste bearbeiten</h3><p id="tdp-selected">Keine Taste ausgewählt.</p></div>
              <div class="tdp-mini-actions">
                <button id="tdp-copy-key" type="button" title="Taste kopieren">⧉</button>
                <button id="tdp-paste-key" type="button" title="Taste einfügen">▣</button>
              </div>
            </header>
            <div id="tdp-inspector-body" class="tdp-inspector-body">
              <label>Titel<input id="tdp-title" maxlength="120"></label>
              <label>Untertitel<input id="tdp-subtitle" maxlength="160"></label>
              <div class="tdp-two-fields">
                <label>Tastenfarbe<input id="tdp-color" type="color" value="#152130"></label>
                <label>Schriftfarbe<input id="tdp-text-color" type="color" value="#ffffff"></label>
              </div>
              <label>Zielordner<select id="tdp-target-folder"><option value="">Kein Ordner</option></select></label>
              <hr>
              <div class="tdp-subheading"><h3>Mehrfachaktionen</h3><span id="tdp-action-count">0</span></div>
              <div id="tdp-actions" class="tdp-action-list"></div>
              <label>Aktion<select id="tdp-action-type"></select></label>
              <label>Einstellungen als JSON<textarea id="tdp-action-settings" rows="5">{}</textarea></label>
              <label>Verzögerung in ms<input id="tdp-action-delay" type="number" min="0" max="120000" value="0"></label>
              <button id="tdp-add-action" type="button">Aktion hinzufügen</button>
              <div class="tdp-save-row">
                <button id="tdp-save-key" class="primary" type="button">Taste speichern</button>
                <button id="tdp-discard-key" type="button">Abbrechen</button>
                <button id="tdp-clear-key" type="button">Leeren</button>
              </div>
            </div>
            <div id="tdp-no-selection" class="tdp-no-selection">Wähle eine Taste aus oder tippe links auf eine Aktion.</div>
          </aside>
        </div>
      </div>`;
  }

  function bind() {
    $("#tdp-search").addEventListener("input", (event) => {
      searchText = event.currentTarget.value;
      renderLibrary();
    });
    $("#tdp-tab-actions").addEventListener("click", () => setLibraryTab("actions"));
    $("#tdp-tab-plugins").addEventListener("click", () => setLibraryTab("plugins"));
    $("#tdp-rescan").addEventListener("click", async () => {
      state.plugins = await call("plugins:scan");
      renderLibrary();
      renderInspector();
      toast("Plugins und Aktionen neu eingelesen.");
    });
    $("#tdp-profile").addEventListener("change", async (event) => {
      if (!discardDraftIfNeeded()) { render(); return; }
      selectedIndex = -1;
      draft = null;
      pendingAction = null;
      layoutPreview = null;
      await call("deck:activate-profile", { profileId: event.currentTarget.value });
      await refresh();
    });
    $("#tdp-folder").addEventListener("change", async (event) => {
      if (!discardDraftIfNeeded()) { render(); return; }
      const currentProfile = profile();
      selectedIndex = -1;
      draft = null;
      pendingAction = null;
      layoutPreview = null;
      await call("deck:activate-folder", { profileId: currentProfile.id, folderId: event.currentTarget.value });
      await refresh();
    });
    $("#tdp-add-profile").addEventListener("click", createProfile);
    $("#tdp-add-folder").addEventListener("click", createFolder);
    $("#tdp-back-folder").addEventListener("click", goBackFolder);
    $("#tdp-apply-grid").addEventListener("click", applyGrid);
    $("#tdp-preset").addEventListener("change", applyLayoutPreset);
    for (const id of ["tdp-rows", "tdp-columns", "tdp-size", "tdp-gap", "tdp-radius", "tdp-auto-fit", "tdp-show-labels", "tdp-hide-unused"]) {
      $("#" + id).addEventListener("input", previewLayout);
      $("#" + id).addEventListener("change", previewLayout);
    }
    $("#tdp-grid-settings").addEventListener("click", () => {
      gridSettingsOpen = !gridSettingsOpen;
      renderGridSettingsVisibility();
    });
    $("#tdp-import").addEventListener("click", async () => { await call("deck:import", { mode: "merge" }); await refresh(); });
    $("#tdp-export").addEventListener("click", () => call("deck:export"));
    $("#tdp-mode").addEventListener("click", () => setMode(mode === "run" ? "edit" : "run"));
    $("#tdp-fullscreen").addEventListener("click", () => call("window:toggle-fullscreen"));
    $("#tdp-move-key").addEventListener("click", beginTouchMove);
    $("#tdp-assignment-mode").addEventListener("change", (event) => { assignmentMode = event.currentTarget.value === "append" ? "append" : "replace"; });
    $("#tdp-cancel-assignment").addEventListener("click", cancelPendingAssignment);
    $("#tdp-add-action").addEventListener("click", addActionFromInspector);
    $("#tdp-save-key").addEventListener("click", saveKey);
    $("#tdp-discard-key").addEventListener("click", discardKey);
    $("#tdp-clear-key").addEventListener("click", clearKey);
    $("#tdp-copy-key").addEventListener("click", copyKey);
    $("#tdp-paste-key").addEventListener("click", pasteKey);

    for (const id of ["tdp-title", "tdp-subtitle", "tdp-color", "tdp-text-color", "tdp-target-folder"]) {
      $("#" + id).addEventListener("input", updateDraftFromFields);
      $("#" + id).addEventListener("change", updateDraftFromFields);
    }

    document.addEventListener("keydown", handleKeyboardShortcut);
  }

  function setLibraryTab(next) {
    libraryTab = next;
    $("#tdp-tab-actions").classList.toggle("active", next === "actions");
    $("#tdp-tab-plugins").classList.toggle("active", next === "plugins");
    $("#tdp-tab-actions").setAttribute("aria-selected", String(next === "actions"));
    $("#tdp-tab-plugins").setAttribute("aria-selected", String(next === "plugins"));
    renderLibrary();
  }

  function setMode(next) {
    if (next === "run" && !discardDraftIfNeeded()) return;
    if (next === "run" && layoutPreview && !window.confirm("Die noch nicht gespeicherte Rastervorschau verwerfen?")) return;
    mode = next === "edit" ? "edit" : "run";
    moveSourceIndex = -1;
    pendingAction = null;
    if (mode === "run") {
      selectedIndex = -1;
      draft = null;
      draftDirty = false;
      layoutPreview = null;
    }
    render();
  }

  function renderLibrary() {
    const target = $("#tdp-library-content");
    if (!target) return;
    const pluginState = state?.plugins || {};
    const signature = JSON.stringify([
      libraryTab,
      searchText,
      pendingAction?.actionId || "",
      pluginState.scannedAt || 0,
      [...groupState.entries()],
      (pluginState.plugins || []).map((plugin) => [plugin.id, plugin.enabled, plugin.status, plugin.actions?.length || 0])
    ]);
    if (signature === lastLibrarySignature) return;
    lastLibrarySignature = signature;
    target.replaceChildren();
    const plugins = filteredPlugins();
    if (libraryTab === "plugins") {
      if (!plugins.length) {
        target.innerHTML = '<p class="tdp-library-empty">Keine installierten Plugins gefunden.</p>';
        return;
      }
      for (const plugin of plugins) target.append(pluginRow(plugin));
      return;
    }

    const enabled = plugins.filter((plugin) => plugin.enabled && (plugin.actions || []).length);
    if (!enabled.length) {
      target.innerHTML = '<p class="tdp-library-empty">Keine passende Aktion gefunden.</p>';
      return;
    }
    enabled.forEach((plugin, index) => target.append(actionGroup(plugin, index === 0)));
  }

  function pluginRow(plugin) {
    const row = document.createElement("article");
    row.className = `tdp-plugin-row${plugin.enabled ? "" : " disabled"}`;
    row.innerHTML = `
      <div class="tdp-plugin-icon">${iconMarkup(plugin.icon, pluginFallback(plugin))}</div>
      <div class="tdp-plugin-copy"><strong>${html(plugin.name)}</strong><small>${html(plugin.version || (plugin.native ? "Native Batto-Aktion" : "Installiert"))}</small><span>${html(plugin.status || plugin.description || "")}</span></div>
      <label class="tdp-switch" title="Plugin aktivieren oder deaktivieren"><input type="checkbox" ${plugin.enabled ? "checked" : ""}><span></span></label>`;
    $("input", row).addEventListener("change", async (event) => {
      state.plugins = await call("plugins:enable", { pluginId: plugin.id, enabled: event.currentTarget.checked });
      renderLibrary();
      renderInspector();
    });
    return row;
  }

  function actionGroup(plugin, first) {
    const section = document.createElement("section");
    section.className = "tdp-action-group";
    const open = groupState.has(plugin.id) ? groupState.get(plugin.id) : first;
    const actions = (plugin.actions || []).filter((action) => {
      const query = searchText.trim().toLocaleLowerCase("de");
      return !query || [plugin.name, action.name, action.id, action.tooltip]
        .some((value) => String(value || "").toLocaleLowerCase("de").includes(query));
    });
    section.innerHTML = `
      <button class="tdp-action-group-toggle" type="button" aria-expanded="${open}">
        <span class="tdp-disclosure">${open ? "⌄" : "›"}</span>
        <span class="tdp-plugin-icon">${iconMarkup(plugin.icon, pluginFallback(plugin))}</span>
        <strong>${html(plugin.name)}</strong>
        ${plugin.native ? '<em>NATIV</em>' : ""}
      </button>
      <div class="tdp-action-group-body" ${open ? "" : "hidden"}></div>`;
    $(".tdp-action-group-toggle", section).addEventListener("click", () => {
      groupState.set(plugin.id, !open);
      renderLibrary();
    });
    const body = $(".tdp-action-group-body", section);
    for (const action of actions) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = `tdp-action-item${pendingAction?.actionId === action.id ? " pending" : ""}`;
      item.draggable = true;
      item.title = "Antippen und danach die gewünschte Taste wählen";
      const transfer = {
        pluginId: plugin.id,
        pluginName: plugin.name,
        actionId: action.id,
        actionName: action.name,
        icon: action.icon || action.states?.find((entry) => entry.image)?.image || plugin.icon || ""
      };
      item.innerHTML = `<span class="tdp-drag-handle">⠿</span><span class="tdp-action-icon">${iconMarkup(transfer.icon, pluginFallback(plugin))}</span><span><strong>${html(action.name)}</strong><small>${html(action.tooltip || action.id)}</small></span>`;
      item.addEventListener("dragstart", (event) => {
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData(actionTransferType, JSON.stringify(transfer));
        event.dataTransfer.setData("text/plain", action.id);
      });
      item.addEventListener("click", () => selectLibraryAction(transfer));
      body.append(item);
    }
    return section;
  }

  function render() {
    if (!view || !state) return;
    const shell = $(".tdp-shell", view);
    if (shell) shell.dataset.mode = mode;
    const modeButton = $("#tdp-mode");
    if (modeButton) {
      modeButton.textContent = mode === "run" ? "✎ Tasten belegen" : "▶ Deck benutzen";
      modeButton.setAttribute("aria-pressed", String(mode === "edit"));
    }
    const help = $("#tdp-stage-help");
    if (help) help.textContent = moveSourceIndex >= 0
      ? `Taste ${moveSourceIndex + 1} gewählt – jetzt das Ziel antippen.`
      : pendingAction
        ? `„${pendingAction.actionName}“ gewählt – jetzt die gewünschte Taste antippen.`
      : mode === "run"
        ? "Taste antippen, um die hinterlegte Aktion auszuführen. Ordner öffnen sich mit einem Tipp."
        : "Aktion links antippen und danach die Zieltaste wählen – oder direkt per Drag-and-drop belegen.";
    const deck = state.deck || { profiles: [] };
    const profileSelect = $("#tdp-profile");
    profileSelect.innerHTML = (deck.profiles || []).map((entry) => `<option value="${html(entry.id)}" ${entry.id === deck.activeProfileId ? "selected" : ""}>${html(entry.name)}</option>`).join("");
    const currentProfile = profile();
    if (!currentProfile) return;
    const folderSelect = $("#tdp-folder");
    folderSelect.innerHTML = (currentProfile.folders || []).map((entry) => `<option value="${html(entry.id)}" ${entry.id === currentProfile.activeFolderId ? "selected" : ""}>${html(entry.name)}</option>`).join("");
    const currentFolder = folder(currentProfile);
    if (!currentFolder) return;

    const effectiveLayout = layoutPreview || currentFolder;
    if (!layoutPreview) syncLayoutControls(currentFolder);
    updateLayoutOutputs(effectiveLayout);
    $("#tdp-back-folder").disabled = !currentFolder.parentId;

    renderGrid(currentProfile, currentFolder, effectiveLayout);
    renderInspector(currentProfile, currentFolder);
    renderLibrary();
    renderAssignmentBar();
    renderGridSettingsVisibility();
    $("#tdp-move-key").disabled = mode !== "edit" || selectedIndex < 0;
    $("#tdp-move-key").classList.toggle("active", moveSourceIndex >= 0);
  }

  function renderGridSettingsVisibility() {
    const panel = $("#tdp-grid-panel");
    const button = $("#tdp-grid-settings");
    if (!panel || !button) return;
    panel.hidden = mode === "run" || !gridSettingsOpen;
    button.setAttribute("aria-pressed", String(gridSettingsOpen));
    button.classList.toggle("active", gridSettingsOpen);
  }

  function syncLayoutControls(currentFolder) {
    $("#tdp-preset").value = layoutPresets[currentFolder.layoutPreset] ? currentFolder.layoutPreset : "custom";
    $("#tdp-rows").value = currentFolder.rows;
    $("#tdp-columns").value = currentFolder.columns;
    $("#tdp-size").value = currentFolder.buttonSize;
    $("#tdp-gap").value = currentFolder.gap;
    $("#tdp-radius").value = currentFolder.buttonRadius ?? 12;
    $("#tdp-auto-fit").checked = currentFolder.autoFit !== false;
    $("#tdp-show-labels").checked = currentFolder.showLabels !== false;
    $("#tdp-hide-unused").checked = Boolean(currentFolder.hideUnused);
  }

  function layoutFromControls() {
    const rows = Math.max(1, Math.min(10, Number($("#tdp-rows").value) || 3));
    const columns = Math.max(1, Math.min(10, Number($("#tdp-columns").value) || 5));
    return {
      layoutPreset: layoutPresets[$("#tdp-preset").value] ? $("#tdp-preset").value : "custom",
      rows,
      columns,
      buttonSize: Math.max(48, Math.min(320, Number($("#tdp-size").value) || 116)),
      buttonRadius: Math.max(0, Math.min(48, Number($("#tdp-radius").value) || 0)),
      gap: Math.max(0, Math.min(48, Number($("#tdp-gap").value) || 0)),
      autoFit: $("#tdp-auto-fit").checked,
      showLabels: $("#tdp-show-labels").checked,
      hideUnused: $("#tdp-hide-unused").checked
    };
  }

  function updateLayoutOutputs(layout = layoutFromControls()) {
    $("#tdp-size-value").textContent = `${layout.buttonSize} px`;
    $("#tdp-gap-value").textContent = `${layout.gap} px`;
    $("#tdp-radius-value").textContent = `${layout.buttonRadius ?? 12} px`;
  }

  function applyLayoutPreset(event) {
    const key = event.currentTarget.value;
    const preset = layoutPresets[key];
    if (preset?.rows && preset?.columns) {
      $("#tdp-rows").value = preset.rows;
      $("#tdp-columns").value = preset.columns;
    }
    previewLayout();
  }

  function previewLayout(event) {
    if (event?.currentTarget && ["tdp-rows", "tdp-columns"].includes(event.currentTarget.id)) {
      $("#tdp-preset").value = "custom";
    }
    layoutPreview = layoutFromControls();
    updateLayoutOutputs(layoutPreview);
    const currentProfile = profile();
    const currentFolder = folder(currentProfile);
    if (currentProfile && currentFolder) renderGrid(currentProfile, currentFolder, layoutPreview);
    $("#tdp-draft-state").textContent = "Rastervorschau – noch nicht gespeichert";
    $("#tdp-draft-state").classList.add("dirty");
  }

  function scheduleGridFit() {
    window.cancelAnimationFrame(fitFrame);
    fitFrame = window.requestAnimationFrame(fitGridToViewport);
  }

  function fitGridToViewport() {
    const grid = $("#tdp-grid");
    const viewport = grid?.parentElement;
    if (!grid || !viewport) return;
    const preferred = Number.parseFloat(grid.style.getPropertyValue("--tdp-preferred-button-size")) || 116;
    if (grid.dataset.fit !== "auto" || !viewport.clientWidth || !viewport.clientHeight) {
      grid.style.setProperty("--tdp-button-size", `${preferred}px`);
      grid.dataset.compressed = "false";
      grid.dataset.density = preferred < 72 ? "compact" : "comfortable";
      return;
    }
    const columns = Math.max(1, Number(grid.style.getPropertyValue("--tdp-columns")) || 5);
    const rows = Math.max(1, Number(grid.style.getPropertyValue("--tdp-rows")) || 3);
    const gap = Math.max(0, Number.parseFloat(grid.style.getPropertyValue("--tdp-gap")) || 0);
    const styles = window.getComputedStyle(grid);
    const horizontalPadding = (Number.parseFloat(styles.paddingLeft) || 0) + (Number.parseFloat(styles.paddingRight) || 0);
    const verticalPadding = (Number.parseFloat(styles.paddingTop) || 0) + (Number.parseFloat(styles.paddingBottom) || 0);
    const horizontal = (viewport.clientWidth - horizontalPadding - (columns - 1) * gap) / columns;
    const vertical = (viewport.clientHeight - verticalPadding - (rows - 1) * gap) / rows;
    const fitted = Math.max(32, Math.floor(Math.min(preferred, horizontal, vertical)));
    grid.style.setProperty("--tdp-button-size", `${fitted}px`);
    grid.dataset.compressed = String(fitted < preferred);
    grid.dataset.density = fitted < 72 ? "compact" : "comfortable";
  }

  function renderAssignmentBar() {
    const bar = $("#tdp-assignment-bar");
    if (!bar) return;
    bar.hidden = mode !== "edit" || !pendingAction;
    if (!pendingAction) return;
    $("#tdp-assignment-title").textContent = `${pendingAction.pluginName} · ${pendingAction.actionName}`;
    $("#tdp-assignment-icon").innerHTML = iconMarkup(pendingAction.icon, "＋");
    $("#tdp-assignment-mode").value = assignmentMode;
  }

  function renderGrid(currentProfile, currentFolder, layout = currentFolder) {
    const capacity = layout.rows * layout.columns;
    const visible = Array.from({ length: capacity }, (_, index) => currentFolder.buttons?.[index] || blankButton(index));
    const usedCount = visible.filter(isUsed).length;
    const freeCount = capacity - usedCount;
    $("#tdp-capacity").textContent = `${freeCount} von ${capacity} Tasten frei · ${usedCount} belegt`;
    const layoutDirty = Boolean(layoutPreview);
    $("#tdp-draft-state").textContent = layoutDirty
      ? "Rastervorschau – noch nicht gespeichert"
      : draftDirty
        ? "Nicht gespeicherte Tastenvorschau"
        : "Alle Änderungen gespeichert";
    $("#tdp-draft-state").classList.toggle("dirty", draftDirty || layoutDirty);

    const grid = $("#tdp-grid");
    grid.dataset.fit = layout.autoFit === false ? "fixed" : "auto";
    grid.dataset.labels = layout.showLabels === false ? "hidden" : "visible";
    grid.style.setProperty("--tdp-columns", String(layout.columns));
    grid.style.setProperty("--tdp-rows", String(layout.rows));
    grid.style.setProperty("--tdp-preferred-button-size", `${layout.buttonSize}px`);
    grid.style.setProperty("--tdp-button-size", `${layout.buttonSize}px`);
    grid.style.setProperty("--tdp-button-radius", `${layout.buttonRadius ?? 12}px`);
    grid.style.setProperty("--tdp-gap", `${layout.gap}px`);
    grid.style.setProperty("--tdp-folder-background", currentFolder.background || "#090f18");
    grid.replaceChildren(...visible.map((button, index) => keyElement(currentProfile, currentFolder, layout, button, index)));
    scheduleGridFit();
  }

  function isUsed(button) {
    return Boolean(button?.actions?.length || button?.folderId || button?.title || button?.subtitle || button?.icon);
  }

  function keyElement(currentProfile, currentFolder, layout, sourceButton, index) {
    const button = index === selectedIndex && draft ? draft : sourceButton;
    const used = isUsed(button);
    const element = document.createElement("button");
    element.type = "button";
    element.className = `tdp-key${used ? " used" : " empty"}${index === selectedIndex ? " selected" : ""}${index === moveSourceIndex ? " move-source" : ""}${index === selectedIndex && draftDirty ? " preview" : ""}`;
    element.dataset.index = String(index);
    element.draggable = mode === "edit";
    element.style.setProperty("--tdp-key-color", button.color || "#152130");
    element.style.setProperty("--tdp-key-text", button.textColor || "#ffffff");
    element.setAttribute("aria-label", used ? (button.title || `Belegte Taste ${index + 1}`) : `Unbelegte Taste ${index + 1}`);
    element.hidden = Boolean(layout.hideUnused && !used);

    if (used) {
      const image = button.icon && /^data:image\//.test(button.icon)
        ? `<img src="${html(button.icon)}" alt="">`
        : button.folderId
          ? '<span class="tdp-key-folder" aria-hidden="true">▰</span>'
          : "";
      element.innerHTML = `${image}<strong>${html(button.title || (button.folderId ? "Ordner" : ""))}</strong>${button.subtitle ? `<span>${html(button.subtitle)}</span>` : ""}<small>${button.actions?.length > 1 ? `${button.actions.length} Aktionen` : button.actions?.[0]?.title || ""}</small>`;
    }

    element.addEventListener("click", async () => {
      if (mode === "run") return executeKey(element, currentProfile, currentFolder, sourceButton, index);
      if (moveSourceIndex >= 0) return finishTouchMove(currentProfile, currentFolder, index);
      if (pendingAction) return assignActionToKey(currentProfile, currentFolder, sourceButton, index, pendingAction);
      selectKey(index, sourceButton);
    });
    element.addEventListener("dblclick", async () => {
      if (mode === "edit" && button.folderId) {
        await call("deck:activate-folder", { profileId: currentProfile.id, folderId: button.folderId });
        selectedIndex = -1;
        draft = null;
        draftDirty = false;
        await refresh();
      }
    });
    element.addEventListener("dragstart", (event) => {
      if (mode !== "edit") return event.preventDefault();
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(keyTransferType, String(index));
    });
    element.addEventListener("dragover", (event) => {
      if (event.dataTransfer.types.includes(actionTransferType) || event.dataTransfer.types.includes(keyTransferType)) {
        event.preventDefault();
        event.dataTransfer.dropEffect = event.dataTransfer.types.includes(actionTransferType) ? "copy" : "move";
        element.classList.add("drop-target");
      }
    });
    element.addEventListener("dragleave", () => element.classList.remove("drop-target"));
    element.addEventListener("drop", async (event) => {
      event.preventDefault();
      element.classList.remove("drop-target");
      const actionJson = event.dataTransfer.getData(actionTransferType);
      if (actionJson) {
        return assignActionToKey(currentProfile, currentFolder, sourceButton, index, JSON.parse(actionJson));
      }
      const from = Number(event.dataTransfer.getData(keyTransferType));
      if (Number.isInteger(from) && from !== index) {
        if (!discardDraftIfNeeded()) return;
        await call("deck:move-button", { profileId: currentProfile.id, folderId: currentFolder.id, fromIndex: from, toIndex: index });
        selectedIndex = index;
        draft = null;
        draftDirty = false;
        await refresh();
      }
    });
    return element;
  }

  async function executeKey(element, currentProfile, currentFolder, button, index) {
    if (button.folderId) {
      await call("deck:activate-folder", { profileId: currentProfile.id, folderId: button.folderId });
      await refresh();
      return;
    }
    if (!button.actions?.length || button.enabled === false || element.disabled) {
      toast("Diese Taste ist nicht belegt.", true);
      return;
    }
    element.disabled = true;
    element.classList.add("executing");
    try {
      const results = await call("deck:execute-button", { profileId: currentProfile.id, folderId: currentFolder.id, buttonIndex: index });
      element.classList.add("success");
      const pluginFeedback = results?.map((result) => result?.value?.feedback?.title).find(Boolean);
      toast(pluginFeedback || `„${button.title || `Taste ${index + 1}`}“ ausgeführt.`);
    } catch (error) {
      element.classList.add("failed");
    } finally {
      window.setTimeout(() => {
        element.disabled = false;
        element.classList.remove("executing", "success", "failed");
      }, 650);
    }
  }

  function beginTouchMove() {
    if (mode !== "edit" || selectedIndex < 0) return;
    if (draftDirty && !window.confirm("Die Vorschau zuerst verwerfen und die gespeicherte Taste verschieben?")) return;
    draftDirty = false;
    moveSourceIndex = selectedIndex;
    render();
    toast(`Taste ${selectedIndex + 1} gewählt. Jetzt das Ziel antippen.`);
  }

  async function finishTouchMove(currentProfile, currentFolder, targetIndex) {
    const fromIndex = moveSourceIndex;
    moveSourceIndex = -1;
    if (fromIndex === targetIndex) return render();
    await call("deck:move-button", { profileId: currentProfile.id, folderId: currentFolder.id, fromIndex, toIndex: targetIndex });
    selectedIndex = targetIndex;
    draft = null;
    draftDirty = false;
    await refresh();
    toast(`Taste ${fromIndex + 1} nach ${targetIndex + 1} verschoben.`);
  }

  function selectKey(index, button, force = false) {
    if (!force && index !== selectedIndex && !discardDraftIfNeeded()) return;
    selectedIndex = index;
    draft = structuredClone(button || blankButton(index));
    draft.actions ||= [];
    draftDirty = false;
    render();
  }

  function discardDraftIfNeeded() {
    if (!draftDirty) return true;
    return window.confirm("Die nicht gespeicherte Vorschau dieser Taste verwerfen?");
  }

  function updateDraftFromFields() {
    if (!draft || selectedIndex < 0) return;
    draft.title = $("#tdp-title").value.trim();
    draft.subtitle = $("#tdp-subtitle").value.trim();
    draft.color = $("#tdp-color").value;
    draft.textColor = $("#tdp-text-color").value;
    draft.folderId = $("#tdp-target-folder").value;
    draftDirty = true;
    const currentProfile = profile();
    const currentFolder = folder(currentProfile);
    if (currentProfile && currentFolder) renderGrid(currentProfile, currentFolder);
  }

  function renderInspector(currentProfile = profile(), currentFolder = folder(currentProfile)) {
    const selected = selectedIndex >= 0 && draft;
    $("#tdp-inspector-body").hidden = !selected;
    $("#tdp-no-selection").hidden = Boolean(selected);
    $("#tdp-copy-key").disabled = !selected;
    $("#tdp-paste-key").disabled = selectedIndex < 0 || !buttonClipboard;
    $("#tdp-selected").textContent = selected ? `Taste ${selectedIndex + 1}${draftDirty ? " · Vorschau" : ""}` : "Keine Taste ausgewählt.";
    if (!selected) return;

    $("#tdp-title").value = draft.title || "";
    $("#tdp-subtitle").value = draft.subtitle || "";
    $("#tdp-color").value = draft.color || "#152130";
    $("#tdp-text-color").value = draft.textColor || "#ffffff";
    const targetFolder = $("#tdp-target-folder");
    targetFolder.innerHTML = '<option value="">Kein Ordner</option>' + (currentProfile?.folders || [])
      .filter((entry) => entry.id !== currentFolder?.id)
      .map((entry) => `<option value="${html(entry.id)}">${html(entry.name)}</option>`).join("");
    targetFolder.value = draft.folderId || "";

    const catalog = actionCatalog();
    const actionSelect = $("#tdp-action-type");
    actionSelect.innerHTML = catalog.length
      ? catalog.map((entry) => `<option value="${html(entry.actionId)}">${html(entry.pluginName)} · ${html(entry.actionName)}</option>`).join("")
      : '<option value="">Keine Aktion verfügbar</option>';

    $("#tdp-action-count").textContent = String(draft.actions?.length || 0);
    const list = $("#tdp-actions");
    list.replaceChildren(...(draft.actions || []).map((action, actionIndex) => {
      const row = document.createElement("article");
      row.className = "tdp-action-row";
      row.innerHTML = `<span class="tdp-action-order">${actionIndex + 1}</span><div><strong>${html(action.title || action.type)}</strong><code>${html(action.type)}</code><small>${Number(action.delayMs || 0)} ms</small></div><div class="tdp-action-row-buttons"><button type="button" data-direction="up" title="Nach oben">↑</button><button type="button" data-direction="down" title="Nach unten">↓</button><button type="button" data-remove title="Entfernen">×</button></div>`;
      $("[data-remove]", row).addEventListener("click", () => {
        draft.actions.splice(actionIndex, 1);
        draftDirty = true;
        renderInspector(currentProfile, currentFolder);
        renderGrid(currentProfile, currentFolder);
      });
      $$('[data-direction]', row).forEach((control) => control.addEventListener("click", () => {
        const direction = control.dataset.direction === "up" ? -1 : 1;
        const next = actionIndex + direction;
        if (next < 0 || next >= draft.actions.length) return;
        [draft.actions[actionIndex], draft.actions[next]] = [draft.actions[next], draft.actions[actionIndex]];
        draftDirty = true;
        renderInspector(currentProfile, currentFolder);
      }));
      return row;
    }));
  }

  function actionFromTransfer(transfer) {
    return {
      id: `action-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type: transfer.actionId,
      title: `${transfer.pluginName} · ${transfer.actionName}`,
      settings: {},
      delayMs: 0
    };
  }

  function selectLibraryAction(transfer) {
    pendingAction = structuredClone(transfer);
    moveSourceIndex = -1;
    lastLibrarySignature = "";
    render();
    toast(`„${transfer.actionName}“ gewählt. Jetzt die Zieltaste antippen.`);
  }

  function cancelPendingAssignment() {
    pendingAction = null;
    lastLibrarySignature = "";
    render();
  }

  async function assignActionToKey(currentProfile, currentFolder, sourceButton, index, transfer) {
    if (draftDirty && !discardDraftIfNeeded()) return;
    draftDirty = false;
    const next = structuredClone(sourceButton || blankButton(index));
    const action = actionFromTransfer(transfer);
    if (assignmentMode === "append" && Array.isArray(next.actions) && next.actions.length) {
      next.actions.push(action);
      if (!next.title) next.title = transfer.actionName;
      if (!next.icon && transfer.icon) next.icon = transfer.icon;
    } else {
      next.title = transfer.actionName;
      next.subtitle = "";
      next.icon = transfer.icon || "";
      next.folderId = "";
      next.actions = [action];
      next.enabled = true;
    }
    const deck = await call("deck:update-button", {
      profileId: currentProfile.id,
      folderId: currentFolder.id,
      buttonIndex: index,
      button: next
    });
    state.deck = deck;
    lastViewSignature = viewStateSignature(state);
    selectedIndex = index;
    draft = structuredClone(next);
    draftDirty = false;
    pendingAction = null;
    lastLibrarySignature = "";
    render();
    toast(`Taste ${index + 1} wurde mit „${transfer.actionName}“ belegt und gespeichert.`);
  }

  function addActionFromInspector() {
    if (selectedIndex < 0 || !draft) return toast("Zuerst eine Taste auswählen.", true);
    let settings;
    try { settings = JSON.parse($("#tdp-action-settings").value || "{}"); }
    catch { return toast("Die Aktionseinstellungen enthalten kein gültiges JSON.", true); }
    const type = $("#tdp-action-type").value;
    if (!type) return toast("Keine Aktion verfügbar.", true);
    const title = $("#tdp-action-type").selectedOptions[0]?.textContent || type;
    draft.actions ||= [];
    draft.actions.push({
      id: `action-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type,
      title,
      settings,
      delayMs: Math.max(0, Math.min(120000, Number($("#tdp-action-delay").value) || 0))
    });
    if (!draft.title) draft.title = title.split(" · ").at(-1) || title;
    draftDirty = true;
    render();
  }

  async function saveKey() {
    if (selectedIndex < 0 || !draft) return;
    updateDraftFromFields();
    const currentProfile = profile();
    const currentFolder = folder(currentProfile);
    await call("deck:update-button", {
      profileId: currentProfile.id,
      folderId: currentFolder.id,
      buttonIndex: selectedIndex,
      button: draft
    });
    draftDirty = false;
    await refresh();
    toast("Taste gespeichert.");
  }

  function discardKey() {
    if (selectedIndex < 0) return;
    const currentFolder = folder();
    draft = structuredClone(currentFolder?.buttons?.[selectedIndex] || blankButton(selectedIndex));
    draft.actions ||= [];
    draftDirty = false;
    render();
  }

  async function clearKey() {
    if (selectedIndex < 0) return;
    if (isUsed(draft) && !window.confirm(`Taste ${selectedIndex + 1} wirklich leeren? Diese Aktion kann nicht automatisch rückgängig gemacht werden.`)) return;
    const currentProfile = profile();
    const currentFolder = folder(currentProfile);
    await call("deck:clear-button", { profileId: currentProfile.id, folderId: currentFolder.id, buttonIndex: selectedIndex });
    selectedIndex = -1;
    draft = null;
    draftDirty = false;
    await refresh();
    toast("Taste geleert.");
  }

  function copyKey() {
    if (!draft) return;
    buttonClipboard = structuredClone(draft);
    $("#tdp-paste-key").disabled = false;
    toast("Taste kopiert.");
  }

  function pasteKey() {
    if (selectedIndex < 0 || !buttonClipboard) return;
    const id = draft?.id || `button-${selectedIndex + 1}`;
    draft = structuredClone(buttonClipboard);
    draft.id = id;
    draftDirty = true;
    render();
    toast("Kopierte Taste als Vorschau eingefügt.");
  }

  async function createProfile() {
    const name = window.prompt("Name des neuen Profils:", "Neues Profil")?.trim();
    if (!name) return;
    await call("deck:create-profile", { name });
    selectedIndex = -1;
    draft = null;
    draftDirty = false;
    pendingAction = null;
    layoutPreview = null;
    await refresh();
  }

  async function createFolder() {
    const currentProfile = profile();
    const currentFolder = folder(currentProfile);
    const name = window.prompt("Name des neuen Ordners:", "Neuer Ordner")?.trim();
    if (!name) return;
    await call("deck:create-folder", { profileId: currentProfile.id, name, parentId: currentFolder.id });
    selectedIndex = -1;
    draft = null;
    draftDirty = false;
    pendingAction = null;
    layoutPreview = null;
    await refresh();
  }

  async function goBackFolder() {
    const currentProfile = profile();
    const currentFolder = folder(currentProfile);
    if (!currentFolder?.parentId) return;
    if (!discardDraftIfNeeded()) return;
    await call("deck:activate-folder", { profileId: currentProfile.id, folderId: currentFolder.parentId });
    selectedIndex = -1;
    draft = null;
    draftDirty = false;
    pendingAction = null;
    layoutPreview = null;
    await refresh();
  }

  async function applyGrid() {
    const currentProfile = profile();
    const currentFolder = folder(currentProfile);
    const layout = layoutFromControls();
    const newCapacity = layout.rows * layout.columns;
    const hiddenUsed = (currentFolder.buttons || []).slice(newCapacity).filter(isUsed).length;
    if (hiddenUsed > 0) {
      const proceed = window.confirm(`${hiddenUsed} belegte Taste(n) werden nur ausgeblendet, aber nicht gelöscht. Raster trotzdem übernehmen?`);
      if (!proceed) return;
    }
    await call("deck:update-folder", {
      profileId: currentProfile.id,
      folderId: currentFolder.id,
      patch: layout
    });
    layoutPreview = null;
    await refresh();
    toast("Raster, Tastengröße und Darstellung gespeichert.");
  }

  function handleKeyboardShortcut(event) {
    if (!view?.classList.contains("active") || selectedIndex < 0) return;
    const tag = event.target?.tagName?.toLowerCase();
    if (["input", "textarea", "select"].includes(tag)) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
      event.preventDefault();
      copyKey();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") {
      event.preventDefault();
      pasteKey();
    } else if (event.key === "Delete") {
      event.preventDefault();
      void clearKey();
    }
  }

  async function refresh(options = {}) {
    state = await call("state:get");
    if (options.scanPlugins && !(state?.plugins?.plugins || []).length) {
      state.plugins = await call("plugins:scan");
    }
    if (selectedIndex >= 0 && !draftDirty) {
      const currentFolder = folder(profile());
      draft = structuredClone(currentFolder?.buttons?.[selectedIndex] || blankButton(selectedIndex));
      draft.actions ||= [];
    }
    lastViewSignature = viewStateSignature(state);
    render();
    return state;
  }

  function viewStateSignature(next) {
    const plugins = next?.plugins || {};
    return JSON.stringify([
      next?.deck || null,
      plugins.scannedAt || 0,
      (plugins.plugins || []).map((plugin) => [
        plugin.id,
        plugin.enabled,
        plugin.status,
        plugin.actions?.map((action) => [action.id, action.name, action.visibleInActionsList]) || []
      ])
    ]);
  }

  function mount(target) {
    if (view) return;
    view = target;
    view.classList.add("touch-deck-v3");
    view.innerHTML = markup();
    bind();
    api.onStateChanged((next) => {
      state = next;
      const signature = viewStateSignature(next);
      if (view.classList.contains("active") && signature !== lastViewSignature) {
        lastViewSignature = signature;
        if (selectedIndex >= 0 && !draftDirty) {
          const currentFolder = folder(profile());
          draft = structuredClone(currentFolder?.buttons?.[selectedIndex] || blankButton(selectedIndex));
          draft.actions ||= [];
        }
        render();
      }
    });
    const viewport = $(".tdp-grid-viewport", view);
    if (typeof ResizeObserver === "function" && viewport) {
      resizeObserver = new ResizeObserver(scheduleGridFit);
      resizeObserver.observe(viewport);
    } else {
      window.addEventListener("resize", scheduleGridFit, { passive: true });
    }
    $("[data-view='deck']")?.addEventListener("click", () => window.setTimeout(() => refresh(), 0));
    refresh({ scanPlugins: true }).catch((error) => console.error("Touch-Deck V3:", error));
  }

  function waitForView() {
    const existing = document.getElementById("view-deck");
    if (existing) return mount(existing);
    const observer = new MutationObserver(() => {
      const target = document.getElementById("view-deck");
      if (!target) return;
      observer.disconnect();
      mount(target);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  waitForView();
})();
