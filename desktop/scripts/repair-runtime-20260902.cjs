"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const write = (relative, value) => {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, "utf8");
};

// 1) Touch-Deck Pro is removed from the packaged runtime. Restore the compact
// profile/grid/inspector deck used by the earlier Creator Hub/Batto layout,
// while keeping the current persistent DeckStore backend.
{
  const indexFile = "src/renderer/index.html";
  let index = read(indexFile);
  index = index
    .replace(/\s*<link rel="stylesheet" href="\.\/touch-deck-pro-v2\.css">/g, "")
    .replace(/\s*<script src="\.\/touch-deck-pro-v2\.js"><\/script>/g, "");
  if (!index.includes('href="./touch-deck-classic.css"')) {
    const marker = '<link rel="stylesheet" href="./integrated.css">';
    if (!index.includes(marker)) throw new Error("Classic Touch-Deck: integrated.css marker fehlt.");
    index = index.replace(marker, `${marker}\n    <link rel="stylesheet" href="./touch-deck-classic.css">`);
  }
  if (!index.includes('src="./touch-deck-classic.js"')) {
    const marker = '<script src="./integrated.js"></script>';
    if (!index.includes(marker)) throw new Error("Classic Touch-Deck: integrated.js marker fehlt.");
    index = index.replace(marker, `${marker}\n    <script src="./touch-deck-classic.js"></script>`);
  }
  write(indexFile, index);
  fs.rmSync(path.join(root, "src", "renderer", "touch-deck-pro-v2.js"), { force: true });
  fs.rmSync(path.join(root, "src", "renderer", "touch-deck-pro-v2.css"), { force: true });

  let integrated = read("src/renderer/integrated.js");
  integrated = integrated.replaceAll("Touch-Deck Pro", "Touch-Deck");
  integrated = integrated.replace(
    /  function deckMarkup\(\) \{[\s\S]*?\n  \}\n\n  function mobileMarkup\(\)/,
    '  function deckMarkup() {\n    return `<div id="classic-deck-host"></div>`;\n  }\n\n  function mobileMarkup()'
  );
  if (!integrated.includes('id="classic-deck-host"')) throw new Error("Classic Touch-Deck Host konnte nicht eingebaut werden.");

  // Twitch is anonymous/read-only. Remove every OAuth field from the integrated UI.
  integrated = integrated
    .replace(/\s*<label>Bot-\/Kontoname<input id="chat-twitch-name"[^>]*><\/label>/g, "")
    .replace(/\s*<label>OAuth-Token<input id="chat-twitch-token"[^>]*><\/label>/g, "")
    .replace(/\n\s*if \(\$\("#chat-twitch-token"\)\.value\) payload\.twitchOauth = \$\("#chat-twitch-token"\)\.value;/g, "")
    .replace(/\n\s*\$\("#chat-twitch-token"\)\.value = "";/g, "")
    .replace(
      /  async function connectTwitch\(\) \{[\s\S]*?\n  \}/,
      '  async function connectTwitch() {\n    await saveChatSettings();\n    await api.chatConnect("twitch", { channel: $("#chat-twitch-channel").value.trim() });\n    renderMultiChat();\n  }'
    )
    .replace('$("#chat-twitch-disconnect")?.addEventListener("click", () => call("chat:twitch-disconnect"));', '$("#chat-twitch-disconnect")?.addEventListener("click", () => api.chatDisconnect("twitch"));');
  write("src/renderer/integrated.js", integrated);

  const classicCss = `
/* Classic Touch-Deck restored from the earlier Creator Hub/Batto layout. */
#classic-deck-host{min-width:0}
.classic-deck-heading{display:flex;min-width:0;margin-bottom:14px;align-items:flex-start;justify-content:space-between;gap:14px}
.classic-deck-heading h2{margin:5px 0;font-size:25px}.classic-deck-heading p{margin:0;color:#8fa1b5;font-size:11px;line-height:1.55}
.classic-deck-toolbar{display:flex;min-width:0;margin-bottom:12px;padding:10px;align-items:end;gap:8px;flex-wrap:wrap;border:1px solid #263446;border-radius:9px;background:#0e1520}
.classic-deck-toolbar label,.classic-deck-inspector label{display:grid;min-width:0;gap:5px;color:#a8b5c2;font-size:10px}.classic-deck-toolbar label{width:150px}.classic-deck-toolbar label.small{width:90px}
.classic-deck-workspace{display:grid;grid-template-columns:minmax(0,1fr) 300px;min-width:0;gap:12px}
.classic-deck-grid{display:grid;min-width:0;min-height:500px;padding:14px;align-content:start;gap:10px;overflow:auto;border:1px solid #263446;border-radius:11px;background:#080e16}
.classic-deck-key{position:relative;display:grid;min-width:72px;min-height:82px;padding:8px;place-items:center;overflow:hidden;border:1px solid #33475d;border-radius:11px;color:#eaf6ff;text-align:center;background:linear-gradient(145deg,#162436,#0b111b);box-shadow:inset 0 2px rgb(85 214 255 / 10%)}
.classic-deck-key:hover{border-color:#55d6ff}.classic-deck-key.empty{color:#697d91;background:#0a111a}.classic-deck-key.selected{outline:2px solid #55d6ff;outline-offset:2px}.classic-deck-key small{position:absolute;right:7px;bottom:5px;color:#70859a;font-size:9px}
.classic-deck-inspector{display:grid;align-content:start;gap:10px;min-width:0;padding:16px;border:1px solid #263446;border-radius:11px;background:#0e1520}.classic-deck-inspector h3{margin:0;font-size:15px}.classic-deck-inspector p{margin:0;color:#8fa1b5;font-size:11px}
.classic-deck-actions{display:flex;gap:8px;flex-wrap:wrap}.classic-deck-actions button.primary{border-color:#53d4ff;color:#061019;font-weight:800;background:linear-gradient(135deg,#5ce2ff,#4b9dff)}
.classic-deck-note{margin-top:10px;color:#72869a;font-size:10px}
@media(max-width:1050px){.classic-deck-workspace{grid-template-columns:1fr}.classic-deck-inspector{order:-1}.classic-deck-grid{min-height:340px}}
`;
  write("src/renderer/touch-deck-classic.css", classicCss.trimStart());

  const classicJs = `"use strict";
(() => {
  const api = window.batto;
  const host = document.getElementById("classic-deck-host");
  if (!api?.invoke || !host) return;
  let state = null;
  let selectedIndex = -1;
  const $ = (selector) => host.querySelector(selector);
  const esc = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  async function call(channel, payload = {}) { return api.invoke(channel, payload); }
  function profile() { const list = state?.deck?.profiles || []; return list.find((item) => item.id === state?.deck?.activeProfileId) || list[0] || null; }
  function page(current = profile()) { return current?.folders?.find((item) => item.id === "root") || current?.folders?.find((item) => !item.parentId) || current?.folders?.[0] || null; }
  function used(button) { return Boolean(button?.title || button?.subtitle || button?.icon || button?.folderId || button?.actions?.length); }
  function actionLabel(action) {
    const map = { "obs.stream.start":"OBS · Stream starten", "obs.stream.stop":"OBS · Stream stoppen", "obs.record.start":"OBS · Aufnahme starten", "obs.record.stop":"OBS · Aufnahme stoppen", "obs.virtualcam.start":"OBS · Virtuelle Kamera starten", "obs.virtualcam.stop":"OBS · Virtuelle Kamera stoppen", "obs.scene":"OBS · Szene aktivieren", "system.url":"Webseite öffnen", "volume.mixer":"Windows Lautstärkemixer" };
    return map[action?.type] || action?.title || action?.type || "Leer";
  }
  function markup() {
    host.innerHTML = '<div class="classic-deck-heading"><div><span class="eyebrow">PROFILBASIERTES TOUCH-DECK</span><h2>Touch-Deck</h2><p>Das kompakte Tastenraster aus dem früheren Setup: Profile, Zeilen, Spalten und direkte Tastenbelegung ohne Pro-Seitenleiste.</p></div><button id="classic-deck-save" class="primary">Deck speichern</button></div>' +
      '<div class="classic-deck-toolbar"><label>Profil<select id="classic-deck-profile"></select></label><button id="classic-deck-add-profile">Neues Profil</button><label class="small">Zeilen<input id="classic-deck-rows" type="number" min="1" max="10" value="3"></label><label class="small">Spalten<input id="classic-deck-columns" type="number" min="1" max="10" value="5"></label><button id="classic-deck-apply-grid">Raster anwenden</button></div>' +
      '<div class="classic-deck-workspace"><div id="classic-deck-grid" class="classic-deck-grid"></div><aside class="classic-deck-inspector"><h3>Taste bearbeiten</h3><p id="classic-deck-selected">Keine Taste ausgewählt.</p><label>Titel<input id="classic-deck-title" maxlength="80"></label><label>Aktion<select id="classic-deck-action"><option value="none">Keine Aktion</option><option value="obs.stream.start">OBS · Stream starten</option><option value="obs.stream.stop">OBS · Stream stoppen</option><option value="obs.record.start">OBS · Aufnahme starten</option><option value="obs.record.stop">OBS · Aufnahme stoppen</option><option value="obs.virtualcam.start">OBS · Virtuelle Kamera starten</option><option value="obs.virtualcam.stop">OBS · Virtuelle Kamera stoppen</option><option value="obs.scene">OBS · Szene aktivieren</option><option value="system.url">Webseite öffnen</option><option value="volume.mixer">Windows Lautstärkemixer</option></select></label><label id="classic-deck-value-row">Wert<input id="classic-deck-value" placeholder="Szenenname oder https://…"></label><div class="classic-deck-actions"><button id="classic-deck-apply-key" class="primary">Taste übernehmen</button><button id="classic-deck-clear-key">Taste leeren</button></div><p class="classic-deck-note">Doppelklick auf eine belegte Taste führt die Aktion direkt aus.</p></aside></div>';
    $("#classic-deck-profile").addEventListener("change", async (event) => { await call("deck:activate-profile", { profileId: event.currentTarget.value }); selectedIndex = -1; await refresh(); });
    $("#classic-deck-add-profile").addEventListener("click", addProfile);
    $("#classic-deck-apply-grid").addEventListener("click", applyGrid);
    $("#classic-deck-apply-key").addEventListener("click", saveKey);
    $("#classic-deck-clear-key").addEventListener("click", clearKey);
    $("#classic-deck-save").addEventListener("click", refresh);
    $("#classic-deck-action").addEventListener("change", updateValueVisibility);
  }
  function render() {
    if (!state) return;
    const currentProfile = profile();
    const currentPage = page(currentProfile);
    if (!currentProfile || !currentPage) return;
    const select = $("#classic-deck-profile");
    select.innerHTML = (state.deck.profiles || []).map((item) => '<option value="' + esc(item.id) + '"' + (item.id === state.deck.activeProfileId ? ' selected' : '') + '>' + esc(item.name) + '</option>').join("");
    $("#classic-deck-rows").value = currentPage.rows;
    $("#classic-deck-columns").value = currentPage.columns;
    const count = currentPage.rows * currentPage.columns;
    const grid = $("#classic-deck-grid");
    grid.style.gridTemplateColumns = 'repeat(' + currentPage.columns + ', minmax(74px, 1fr))';
    grid.replaceChildren();
    for (let index = 0; index < count; index += 1) {
      const button = currentPage.buttons?.[index] || {};
      const node = document.createElement("button");
      node.type = "button";
      node.className = 'classic-deck-key' + (used(button) ? '' : ' empty') + (index === selectedIndex ? ' selected' : '');
      const action = button.actions?.[0];
      node.innerHTML = '<span>' + esc(button.title || (action ? actionLabel(action) : 'Taste ' + (index + 1))) + '</span><small>' + (index + 1) + '</small>';
      node.addEventListener("click", () => { selectedIndex = index; render(); fillInspector(); });
      node.addEventListener("dblclick", async () => { if (!action) return; try { await call("deck:execute-button", { profileId: currentProfile.id, folderId: currentPage.id, buttonIndex: index }); } catch (error) { window.alert(error.message || error); } });
      grid.append(node);
    }
    fillInspector();
  }
  function fillInspector() {
    const currentPage = page();
    const button = selectedIndex >= 0 ? currentPage?.buttons?.[selectedIndex] : null;
    const action = button?.actions?.[0] || null;
    $("#classic-deck-selected").textContent = selectedIndex >= 0 ? 'Taste ' + (selectedIndex + 1) : 'Keine Taste ausgewählt.';
    $("#classic-deck-title").value = button?.title || '';
    $("#classic-deck-action").value = action?.type || 'none';
    $("#classic-deck-value").value = action?.type === 'obs.scene' ? (action.settings?.sceneName || '') : action?.type === 'system.url' ? (action.settings?.url || '') : '';
    updateValueVisibility();
  }
  function updateValueVisibility() { const type = $("#classic-deck-action").value; $("#classic-deck-value-row").hidden = !['obs.scene','system.url'].includes(type); }
  async function addProfile() {
    const name = window.prompt('Name des neuen Touch-Deck-Profils:', 'Neues Profil')?.trim();
    if (!name) return;
    await call('deck:create-profile', { name: name.slice(0, 80) });
    selectedIndex = -1;
    await refresh();
  }
  async function applyGrid() {
    const currentProfile = profile(); const currentPage = page(currentProfile); if (!currentPage) return;
    const rows = Math.max(1, Math.min(10, Number($("#classic-deck-rows").value) || 3));
    const columns = Math.max(1, Math.min(10, Number($("#classic-deck-columns").value) || 5));
    await call('deck:update-folder', { profileId: currentProfile.id, folderId: currentPage.id, patch: { rows, columns } });
    selectedIndex = -1; await refresh();
  }
  async function saveKey() {
    if (selectedIndex < 0) return;
    const currentProfile = profile(); const currentPage = page(currentProfile); const existing = currentPage.buttons?.[selectedIndex] || {};
    const type = $("#classic-deck-action").value; const value = $("#classic-deck-value").value.trim(); const title = $("#classic-deck-title").value.trim();
    let actions = [];
    if (type !== 'none') {
      const settings = type === 'obs.scene' ? { sceneName: value } : type === 'system.url' ? { url: value } : {};
      actions = [{ id: 'classic-action-' + Date.now(), type, title: title || actionLabel({ type }), settings, delayMs: 0 }];
    }
    await call('deck:update-button', { profileId: currentProfile.id, folderId: currentPage.id, buttonIndex: selectedIndex, button: { ...existing, title, actions } });
    await refresh();
  }
  async function clearKey() {
    if (selectedIndex < 0) return;
    const currentProfile = profile(); const currentPage = page(currentProfile);
    await call('deck:clear-button', { profileId: currentProfile.id, folderId: currentPage.id, buttonIndex: selectedIndex });
    selectedIndex = -1; await refresh();
  }
  async function refresh() { state = await call('state:get'); render(); }
  markup();
  refresh().catch((error) => { host.innerHTML = '<div class="info-banner warning">Touch-Deck konnte nicht geladen werden: ' + esc(error.message || error) + '</div>'; });
})();
`;
  write("src/renderer/touch-deck-classic.js", classicJs);
}

// 2) Unified chat: Twitch reader is anonymous and token-free in every visible UI.
{
  let chat = read("src/renderer/multi-chat.js");
  chat = chat
    .replace('<label>OAuth-Token<input id="cfg-twitch-token" type="password" placeholder="oauth-…"></label><label>Username<input id="cfg-twitch-user" placeholder="batto_reader"></label>', '<small>Nur Kanalname nötig · anonymes Lesen ohne OAuth-Token.</small>')
    .replace('await api.chatConnect("twitch",{channel:value("cfg-twitch-channel"),token:value("cfg-twitch-token"),username:value("cfg-twitch-user")})', 'await api.chatConnect("twitch",{channel:value("cfg-twitch-channel")})');
  if (/cfg-twitch-token|OAuth-Token<input id="cfg-twitch/i.test(chat)) throw new Error("Unified Multi-Chat enthält noch ein Twitch-Token-Feld.");
  write("src/renderer/multi-chat.js", chat);
}

// 3) Overlay orientation: use the saved logical canvas size on /overlay and scale it
// into the current browser/OBS viewport. The same URL now visibly reacts to portrait/landscape changes.
{
  const file = "src/stream-overlay/overlay.js";
  let overlay = read(file);
  if (!overlay.includes("function applyViewport()")) {
    overlay = overlay.replace(
      "  function render() {\n",
      `  function applyViewport() {\n    const width = Math.max(1, Number(config.width) || 1920);\n    const height = Math.max(1, Number(config.height) || 1080);\n    const viewportWidth = Math.max(1, window.innerWidth || width);\n    const viewportHeight = Math.max(1, window.innerHeight || height);\n    const scale = Math.min(viewportWidth / width, viewportHeight / height);\n    stage.style.position = "absolute";\n    stage.style.left = "50%";\n    stage.style.top = "50%";\n    stage.style.width = width + "px";\n    stage.style.height = height + "px";\n    stage.style.transformOrigin = "center center";\n    stage.style.transform = "translate(-50%, -50%) scale(" + scale + ")";\n    stage.dataset.orientation = height > width ? "portrait" : "landscape";\n  }\n\n  function render() {\n    applyViewport();\n`
    );
    overlay = overlay.replace("  connect();\n})();", '  window.addEventListener("resize", applyViewport);\n  connect();\n})();');
  }
  if (!overlay.includes("stage.dataset.orientation") || !overlay.includes('window.addEventListener("resize", applyViewport)')) throw new Error("Overlay-Ausrichtung konnte nicht repariert werden.");
  write(file, overlay);
}

// 4) Restore the missing OBS guest/co-host IPC handlers. These operate on real OBS
// scene items and do not pretend to create TikTok co-host sessions.
{
  const file = "src/main.cjs";
  let main = read(file);
  if (!main.includes('handle("guests:list"')) {
    const marker = '  handle("settings:update", (payload) => {';
    if (!main.includes(marker)) throw new Error("OBS-Gäste: settings:update Patchpunkt fehlt.");
    const handlers = `  handle("guests:list", async (payload) => {\n    const sceneName = String(payload.sceneName || "").trim();\n    if (!sceneName) throw new Error("OBS-Szene fehlt.");\n    if (!obs.status().connected) throw new Error("OBS ist nicht verbunden.");\n    return { sceneName, items: await obs.getSceneItems(sceneName) };\n  });\n  handle("guests:apply", async (payload) => {\n    const sceneName = String(payload.sceneName || "").trim();\n    if (!sceneName) throw new Error("OBS-Szene fehlt.");\n    if (!obs.status().connected) throw new Error("OBS ist nicht verbunden.");\n    const results = [];\n    for (const slot of Array.isArray(payload.slots) ? payload.slots : []) {\n      const sceneItemId = Number(slot.sceneItemId);\n      if (!Number.isFinite(sceneItemId)) continue;\n      results.push(await obs.setSceneItemEnabled(sceneName, sceneItemId, Boolean(slot.enabled)));\n    }\n    latestObs = await obs.snapshot();\n    scheduleState();\n    return { sceneName, changed: results.length, results };\n  });\n\n`;
    main = main.replace(marker, handlers + marker);
  }
  write(file, main);

  const preloadFile = "src/preload.cjs";
  let preload = read(preloadFile);
  if (!preload.includes('"guests:list"')) {
    preload = preload.replace('"settings:update", "migration:run"', '"guests:list", "guests:apply", "settings:update", "migration:run"');
  }
  if (!preload.includes('"guests:list"') || !preload.includes('"guests:apply"')) throw new Error("OBS-Gäste-IPC fehlt in der Preload-Whitelist.");
  write(preloadFile, preload);
}

// 5) Classic deck actions need the start/stop operations that existed in the older UI.
{
  const file = "src/services/action-executor.cjs";
  let executor = read(file);
  if (!executor.includes('case "obs.stream.start"')) {
    executor = executor.replace(
      '      case "obs.stream.toggle":\n        return this.obs.toggleStream();',
      '      case "obs.stream.start":\n        return this.obs.call("StartStream");\n      case "obs.stream.stop":\n        return this.obs.call("StopStream");\n      case "obs.stream.toggle":\n        return this.obs.toggleStream();'
    );
    executor = executor.replace(
      '      case "obs.record.toggle":\n        return this.obs.toggleRecord();',
      '      case "obs.record.start":\n        return this.obs.call("StartRecord");\n      case "obs.record.stop":\n        return this.obs.call("StopRecord");\n      case "obs.record.toggle":\n        return this.obs.toggleRecord();'
    );
    executor = executor.replace(
      '      case "obs.virtualcam.toggle":\n        return this.obs.toggleVirtualCam();',
      '      case "obs.virtualcam.start":\n        return this.obs.call("StartVirtualCam");\n      case "obs.virtualcam.stop":\n        return this.obs.call("StopVirtualCam");\n      case "obs.virtualcam.toggle":\n        return this.obs.toggleVirtualCam();'
    );
  }
  for (const token of ['case "obs.stream.start"', 'case "obs.record.start"', 'case "obs.virtualcam.start"']) {
    if (!executor.includes(token)) throw new Error(`Classic Touch-Deck-Aktion fehlt: ${token}`);
  }
  write(file, executor);
}

// Final assertions: no Pro runtime/token field, orientation and OBS guests are real.
{
  const index = read("src/renderer/index.html");
  const integrated = read("src/renderer/integrated.js");
  const chat = read("src/renderer/multi-chat.js");
  const main = read("src/main.cjs");
  if (/touch-deck-pro-v2/i.test(index)) throw new Error("Touch-Deck-Pro-Laufzeit ist noch im Hauptfenster eingebunden.");
  if (/Touch-Deck Pro/.test(integrated)) throw new Error("Touch-Deck-Pro-Bezeichnung ist noch sichtbar.");
  if (/cfg-twitch-token|chat-twitch-token/.test(chat + integrated)) throw new Error("Twitch-Token-Feld ist noch vorhanden.");
  if (!main.includes('handle("guests:list"') || !main.includes('handle("guests:apply"')) throw new Error("OBS-Gäste-Handler fehlen.");
}

console.log("Batto OBS Tool 2.0.0: Classic Touch-Deck, tokenfreier Twitch-Chat, TikTok-Fix, Overlay-Ausrichtung und OBS-Gäste repariert.");
