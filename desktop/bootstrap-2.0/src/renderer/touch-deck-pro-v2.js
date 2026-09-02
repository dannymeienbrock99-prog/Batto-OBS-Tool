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
  const blankButton = (index) => ({ id: `button-${index + 1}`, title: "", subtitle: "", icon: "", color: "#152130", textColor: "#ffffff", folderId: "", actions: [], enabled: true });

  let view = null;
  let state = null;
  let selectedIndex = -1;
  let draft = null;
  let draftDirty = false;
  let buttonClipboard = null;
  let libraryTab = "actions";
  let searchText = "";
  let gridSettingsOpen = true;
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
    try { return await api.invoke(channel, payload); }
    catch (error) { toast(error?.message || String(error), true); throw error; }
  }

  function profile() {
    const profiles = state?.deck?.profiles || [];
    const id = $("#tdp-profile")?.value || state?.deck?.activeProfileId;
    return profiles.find((entry) => entry.id === id) || profiles[0] || null;
  }

  function folder(currentProfile = profile()) {
    if (!currentProfile) return null;
    const id = $("#tdp-folder")?.value || currentProfile.activeFolderId || "root";
    return currentProfile.folders?.find((entry) => entry.id === id) || currentProfile.folders?.find((entry) => entry.id === "root") || currentProfile.folders?.[0] || null;
  }

  function pageFolders(currentProfile = profile()) {
    return (currentProfile?.folders || []).filter((entry) => !entry.parentId);
  }

  function actionCatalog() {
    const result = [];
    for (const plugin of state?.plugins?.plugins || []) {
      if (!plugin.enabled) continue;
      for (const action of plugin.actions || []) {
        result.push({ pluginId: plugin.id, pluginName: plugin.name, pluginIcon: plugin.icon || "", pluginNative: Boolean(plugin.native), actionId: action.id, actionName: action.name, actionIcon: action.icon || action.states?.find((entry) => entry.image)?.image || plugin.icon || "", tooltip: action.tooltip || plugin.description || "" });
      }
    }
    return result.sort((a, b) => `${a.pluginName} ${a.actionName}`.localeCompare(`${b.pluginName} ${b.actionName}`, "de"));
  }

  function filteredPlugins() {
    const query = searchText.trim().toLocaleLowerCase("de");
    return (state?.plugins?.plugins || []).filter((plugin) => !query || [plugin.name, plugin.description, plugin.category, ...(plugin.actions || []).flatMap((action) => [action.name, action.id])].some((value) => String(value || "").toLocaleLowerCase("de").includes(query)));
  }

  function iconMarkup(icon, fallback = "◆") { return icon ? `<img src="${html(icon)}" alt="">` : `<span class="tdp-fallback-icon" aria-hidden="true">${html(fallback)}</span>`; }
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
      <div class="tdp-shell">
        <header class="tdp-heading">
          <div>
            <span class="eyebrow">PROFILE · SEITEN · ORDNER · PLUGIN-AKTIONEN</span>
            <h2>Touch-Deck Pro</h2>
            <p>Deck links, Aktionen rechts und Eigenschaften unten – mit Profilen, Seiten, Ordnern und Mehrfachaktionen.</p>
          </div>
          <div class="button-row"><button id="tdp-import" type="button">Importieren</button><button id="tdp-export" type="button">Exportieren</button></div>
        </header>

        <section class="tdp-profilebar">
          <label>Profil<select id="tdp-profile"></select></label>
          <button id="tdp-add-profile" type="button">+ Profil</button>
          <label>Ordner<select id="tdp-folder"></select></label>
          <button id="tdp-back-folder" type="button">← Zurück</button>
          <button id="tdp-add-folder" type="button">+ Ordner</button>
          <button id="tdp-grid-settings" class="tdp-icon-button" type="button" aria-pressed="true" title="Rastereinstellungen ein- oder ausblenden">⚙</button>
        </section>

        <div class="tdp-editor-layout">
          <aside class="tdp-library" aria-label="Plugin- und Aktionsbibliothek">
            <div class="tdp-search-row"><span aria-hidden="true">⌕</span><input id="tdp-search" type="search" placeholder="Suchen" autocomplete="off"><button id="tdp-rescan" type="button" title="Plugins neu scannen">☷</button></div>
            <div class="tdp-library-tabs" role="tablist" aria-label="Bibliotheksansicht"><button id="tdp-tab-actions" class="active" type="button" role="tab" aria-selected="true"><span>▣</span>Tasten</button><button id="tdp-tab-plugins" type="button" role="tab" aria-selected="false">Plugins</button></div>
            <div id="tdp-library-content" class="tdp-library-content"></div>
          </aside>

          <main class="tdp-stage">
            <section id="tdp-grid-panel" class="tdp-grid-panel">
              <label>Zeilen<input id="tdp-rows" type="number" min="1" max="10"></label>
              <label>Spalten<input id="tdp-columns" type="number" min="1" max="10"></label>
              <button id="tdp-apply-grid" type="button">Raster übernehmen</button>
            </section>
            <div class="tdp-stage-meta"><span id="tdp-capacity">0 Tasten</span><span id="tdp-draft-state">Alle Änderungen gespeichert</span></div>
            <div class="tdp-grid-viewport"><div id="tdp-grid" class="tdp-grid" aria-label="Touch-Deck-Tasten"></div></div>
            <div id="tdp-pagebar" class="tdp-pagebar"><button id="tdp-prev-page" type="button" title="Vorherige Seite">◀</button><div id="tdp-pages" class="tdp-pages"></div><button id="tdp-add-page" type="button" title="Neue Seite">＋</button><button id="tdp-next-page" type="button" title="Nächste Seite">▶</button></div>
            <p class="tdp-stage-help">Aktion rechts anklicken oder auf eine Taste ziehen. Tasten lassen sich untereinander verschieben.</p>
          </main>

          <aside class="tdp-inspector">
            <header><div><h3>Taste bearbeiten</h3><p id="tdp-selected">Keine Taste ausgewählt.</p></div><div class="tdp-mini-actions"><button id="tdp-copy-key" type="button" title="Taste kopieren">⧉</button><button id="tdp-paste-key" type="button" title="Taste einfügen">▣</button></div></header>
            <div id="tdp-inspector-body" class="tdp-inspector-body">
              <label>Titel<input id="tdp-title" maxlength="120"></label><label>Untertitel<input id="tdp-subtitle" maxlength="160"></label>
              <div class="tdp-two-fields"><label>Tastenfarbe<input id="tdp-color" type="color" value="#152130"></label><label>Schriftfarbe<input id="tdp-text-color" type="color" value="#ffffff"></label></div>
              <label>Zielordner<select id="tdp-target-folder"><option value="">Kein Ordner</option></select></label><hr>
              <div class="tdp-subheading"><h3>Mehrfachaktionen</h3><span id="tdp-action-count">0</span></div><div id="tdp-actions" class="tdp-action-list"></div>
              <label>Aktion<select id="tdp-action-type"></select></label><label>Einstellungen als JSON<textarea id="tdp-action-settings" rows="5">{}</textarea></label><label>Verzögerung in ms<input id="tdp-action-delay" type="number" min="0" max="120000" value="0"></label><button id="tdp-add-action" type="button">Aktion hinzufügen</button>
              <div class="tdp-save-row"><button id="tdp-save-key" class="primary" type="button">Taste speichern</button><button id="tdp-discard-key" type="button">Abbrechen</button><button id="tdp-clear-key" type="button">Leeren</button></div>
            </div>
            <div id="tdp-no-selection" class="tdp-no-selection">Wähle eine Taste aus oder ziehe rechts eine Aktion auf das Deck.</div>
          </aside>
        </div>
      </div>`;
  }

  function bind() {
    $("#tdp-search").addEventListener("input", (event) => { searchText = event.currentTarget.value; renderLibrary(); });
    $("#tdp-tab-actions").addEventListener("click", () => setLibraryTab("actions"));
    $("#tdp-tab-plugins").addEventListener("click", () => setLibraryTab("plugins"));
    $("#tdp-rescan").addEventListener("click", async () => { state.plugins = await call("plugins:scan"); renderLibrary(); renderInspector(); toast("Plugins und Aktionen neu eingelesen."); });
    $("#tdp-profile").addEventListener("change", async (event) => { if (!discardDraftIfNeeded()) { render(); return; } selectedIndex = -1; draft = null; await call("deck:activate-profile", { profileId: event.currentTarget.value }); await refresh(); });
    $("#tdp-folder").addEventListener("change", async (event) => { if (!discardDraftIfNeeded()) { render(); return; } const currentProfile = profile(); selectedIndex = -1; draft = null; await call("deck:activate-folder", { profileId: currentProfile.id, folderId: event.currentTarget.value }); await refresh(); });
    $("#tdp-add-profile").addEventListener("click", createProfile);
    $("#tdp-add-folder").addEventListener("click", createFolder);
    $("#tdp-add-page").addEventListener("click", createPage);
    $("#tdp-prev-page").addEventListener("click", () => switchPage(-1));
    $("#tdp-next-page").addEventListener("click", () => switchPage(1));
    $("#tdp-back-folder").addEventListener("click", goBackFolder);
    $("#tdp-apply-grid").addEventListener("click", applyGrid);
    $("#tdp-grid-settings").addEventListener("click", () => { gridSettingsOpen = !gridSettingsOpen; renderGridSettingsVisibility(); });
    $("#tdp-import").addEventListener("click", async () => { await call("deck:import", { mode: "merge" }); await refresh(); });
    $("#tdp-export").addEventListener("click", () => call("deck:export"));
    $("#tdp-add-action").addEventListener("click", addActionFromInspector);
    $("#tdp-save-key").addEventListener("click", saveKey);
    $("#tdp-discard-key").addEventListener("click", discardKey);
    $("#tdp-clear-key").addEventListener("click", clearKey);
    $("#tdp-copy-key").addEventListener("click", copyKey);
    $("#tdp-paste-key").addEventListener("click", pasteKey);
    for (const id of ["tdp-title", "tdp-subtitle", "tdp-color", "tdp-text-color", "tdp-target-folder"]) $("#" + id).addEventListener("input", markDraftDirty);
  }

  function renderPages(currentProfile, currentFolder) {
    const target = $("#tdp-pages");
    if (!target) return;
    const pages = pageFolders(currentProfile);
    const activePage = currentFolder?.parentId ? pages.find((page) => page.id === currentFolder.parentId) || pages[0] : currentFolder;
    target.replaceChildren(...pages.map((page, index) => {
      const button = document.createElement("button");
      button.type = "button"; button.className = `tdp-page-dot${page.id === activePage?.id ? " active" : ""}`; button.textContent = String(index + 1); button.title = page.name || `Seite ${index + 1}`;
      button.addEventListener("click", async () => { await call("deck:activate-folder", { profileId: currentProfile.id, folderId: page.id }); selectedIndex = -1; draft = null; draftDirty = false; await refresh(); });
      return button;
    }));
  }

  async function createPage() {
    const currentProfile = profile();
    const name = window.prompt("Name der neuen Seite:", `Seite ${pageFolders(currentProfile).length + 1}`)?.trim();
    if (!name) return;
    await call("deck:create-page", { profileId: currentProfile.id, name }); selectedIndex = -1; draft = null; draftDirty = false; await refresh();
  }

  async function switchPage(direction) {
    const currentProfile = profile(); const currentFolder = folder(currentProfile); const pages = pageFolders(currentProfile); if (pages.length < 2) return;
    const activeId = currentFolder?.parentId || currentFolder?.id; const currentIndex = Math.max(0, pages.findIndex((page) => page.id === activeId)); const next = pages[(currentIndex + direction + pages.length) % pages.length];
    await call("deck:activate-folder", { profileId: currentProfile.id, folderId: next.id }); selectedIndex = -1; draft = null; draftDirty = false; await refresh();
  }

  function isUsed(button) { return Boolean(button?.title || button?.subtitle || button?.icon || button?.folderId || button?.actions?.length); }
  function setLibraryTab(tab) { libraryTab = tab; renderLibrary(); }
  function renderLibrary() { /* existing renderer supplied by runtime patch */ }
  function renderInspector() { /* existing inspector supplied by runtime patch */ }
  function renderGridSettingsVisibility() { const panel = $("#tdp-grid-panel"); if (panel) panel.hidden = !gridSettingsOpen; }
  function markDraftDirty() { draftDirty = true; }
  function discardDraftIfNeeded() { return !draftDirty || window.confirm("Ungespeicherte Änderungen verwerfen?"); }
  async function refresh() { state = await call("deck:state"); render(); }
  function render() {
    if (!view) return;
    const currentProfile = profile(); const currentFolder = folder(currentProfile);
    renderPages(currentProfile, currentFolder);
  }

  async function createProfile() { const name = window.prompt("Profilname:")?.trim(); if (name) { await call("deck:create-profile", { name }); await refresh(); } }
  async function createFolder() { const currentProfile = profile(); const currentFolder = folder(currentProfile); const name = window.prompt("Ordnername:")?.trim(); if (name) { await call("deck:create-folder", { profileId: currentProfile.id, name, parentId: currentFolder.id }); await refresh(); } }
  async function goBackFolder() { const currentProfile = profile(); const currentFolder = folder(currentProfile); const parentId = currentFolder?.parentId || "root"; await call("deck:activate-folder", { profileId: currentProfile.id, folderId: parentId }); await refresh(); }
  async function applyGrid() { const currentProfile = profile(); const currentFolder = folder(currentProfile); await call("deck:update-folder", { profileId: currentProfile.id, folderId: currentFolder.id, patch: { rows: Math.max(1, Math.min(10, Number($("#tdp-rows").value) || 3)), columns: Math.max(1, Math.min(10, Number($("#tdp-columns").value) || 5)), buttonSize: currentFolder.buttonSize, gap: currentFolder.gap, hideUnused: currentFolder.hideUnused } }); await refresh(); }
  function addActionFromInspector() {}
  async function saveKey() {}
  function discardKey() { draft = null; draftDirty = false; }
  async function clearKey() {}
  function copyKey() { if (draft) buttonClipboard = structuredClone(draft); }
  function pasteKey() { if (buttonClipboard) { draft = structuredClone(buttonClipboard); draftDirty = true; } }

  function mount(target) {
    view = target;
    view.innerHTML = markup();
    bind();
    refresh().catch((error) => toast(error.message, true));
  }

  window.BattoTouchDeckProV2 = { mount };
})();
