"use strict";

(() => {
  const api = window.batto;
  const host = document.getElementById("view-settings");
  if (!host || !api?.getV4Configs) return;

  const order = ["general","appearance","multichat","moderation","chatFilter","chatDesign","cohost","liveTools","platforms","chatbot","autoBroadcast","commands","hotkeys","events","media","mediaPools","tts","obsHttp","overlays","discord","statusbar","logs","backup","advanced"];
  const descriptions = {
    general:"Grundverhalten des Batto OBS Tools.", appearance:"Vollflächiger Programm-Hintergrund und Darstellung.", multichat:"Gemeinsamer Chat für Twitch, TikTok, CNG und YouTube.", moderation:"Plattformgetrennte Moderation. Plattform-Aktionen werden nur dann als Plattform markiert, wenn die Schnittstelle sie bestätigt.", chatFilter:"Wort-, Benutzer- und Umgehungsfilter vor Chat Bot und OBS-Ausgabe.", chatDesign:"Design, Schriftarten und OBS-Chat-Overlay.", cohost:"Gast-Layouts für TikTok 1080×1920 und Twitch 1920×1080 mit lokaler HTTP-Anzeige.", liveTools:"LIVE-Funktionen mit echter Verfügbarkeitsprüfung statt vorgetäuschter Plattform-Funktionen.", platforms:"Account-Verbindungen und Fähigkeiten der aktiven Plattform-Adapter.", chatbot:"Automationskern für Antworten und Aktionsketten.", autoBroadcast:"Automatische Nachrichten mit Intervallen und Plattformwahl.", commands:"Frei erstellbare Chat-Commands.", hotkeys:"Sichere Hotkeys und Multi-Actions mit Zielprozessprüfung.", events:"Follow, Sub, Gift, Raid, Share, Like, Member, Stream Start/Ende und eigene Trigger.", media:"Lokale Medienbibliothek für MP3, WAV, OGG, MP4, WebM, PNG, JPG, WebP und GIF.", mediaPools:"Mediengruppen grafisch erstellen – Rotation, Zufall oder feste Reihenfolge ohne JSON-Eingabe.", tts:"Text-to-Speech pro Plattform.", obsHttp:"Lokaler HTTP-/WebSocket-Server für OBS-Browserquellen.", overlays:"Darstellung, Queue und Priorität für OBS-Overlays.", discord:"Live-Benachrichtigungen über Discord-Webhooks.", statusbar:"Kompakte Stream-Statusleiste; keine Hardware-Vollanalyse und kein Belastungstest.", logs:"Filterbare lokale Protokolle.", backup:"Update-sichere Sicherung und Import/Export inklusive begrenzter Medienmitnahme.", advanced:"Erweiterte lokale Sicherheits- und Diagnoseoptionen ohne Belastungstest."
  };
  const labels = {
    language:"Sprache",startMinimized:"Minimiert starten",closeToTray:"Beim Schließen im Tray lassen",confirmDestructiveActions:"Gefährliche Aktionen bestätigen",autoSave:"Automatisch speichern",
    backgroundEnabled:"Programm-Hintergrund aktiv",backgroundFile:"Hintergrunddatei",preserveAspect:"Seitenverhältnis erhalten",scaleToWindow:"Auf Fensterfläche skalieren",tiles:"Kacheln",mode:"Skalierungsmodus",brightness:"Helligkeit (%)",panelOpacity:"Panel-Transparenz (%)",uiScale:"UI-Skalierung (%)",
    reconnect:"Automatisch neu verbinden",reconnectDelaySeconds:"Reconnect nach (Sekunden)",showSecrets:"Technische Zugangsdaten anzeigen",capabilityGated:"Nur echte Plattform-Fähigkeiten freigeben",
    enabled:"Aktiviert",host:"Host",port:"Port",autoStart:"Beim Programmstart starten",websocket:"WebSocket aktiviert",heartbeatSeconds:"Heartbeat (Sekunden)",refreshSeconds:"Aktualisierung (Sekunden)",position:"Position",
    defaultFormat:"Standardformat",slots:"Plätze",layout:"Layout",gap:"Abstand",border:"Rahmen",radius:"Eckenradius",hideEmpty:"Leere Plätze ausblenden",followGuestChanges:"Gastwechsel verfolgen",rearrange:"Neu anordnen",sourceStrategy:"Quellenstrategie",rememberCrop:"Crop merken",
    defaultAction:"Standardaktion",blockedWords:"Gesperrte Wörter",allowedWords:"Erlaubte Wörter",allowedUsers:"Erlaubte Benutzer",scope:"Plattformbereich",ignoreCase:"Groß-/Kleinschreibung ignorieren",wholeWords:"Ganze Wörter",partialWords:"Teilwörter",specialCharEvasion:"Sonderzeichen-Umgehung erkennen",logMatches:"Treffer protokollieren"
  };
  const testable = new Set(order);
  let snapshot = null;
  let selected = "general";
  let draft = {};
  let mediaFiles = [];
  let cohostStatus = null;
  let liveStatus = null;
  let platformStatus = null;
  let logRows = [];

  const esc = (value) => String(value ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
  function human(key) { return labels[key] || key.replace(/([a-z])([A-Z])/g,"$1 $2").replaceAll("_"," ").replace(/^./,(m)=>m.toUpperCase()); }
  function moduleState(id) { return snapshot?.modules?.[id] || null; }

  function renderField(key, value) {
    if (Array.isArray(value) && value.some((item) => item && typeof item === "object")) return "";
    const label = esc(human(key));
    if (typeof value === "boolean") return `<label class="v4-switch"><input data-v4-field="${esc(key)}" type="checkbox" ${value?"checked":""}><span>${label}</span></label>`;
    if (typeof value === "number") return `<label>${label}<input data-v4-field="${esc(key)}" type="number" value="${esc(value)}"></label>`;
    if (Array.isArray(value)) return `<label>${label}<input data-v4-field="${esc(key)}" data-v4-array="1" value="${esc(value.join(", "))}"><small>Mehrere Werte mit Komma trennen.</small></label>`;
    return `<label>${label}<input data-v4-field="${esc(key)}" value="${esc(value)}"></label>`;
  }

  function collectDraft() {
    const module = moduleState(selected);
    if (!module) return null;
    const next = { ...module.config };
    host.querySelectorAll("[data-v4-field]").forEach((input) => {
      const key = input.dataset.v4Field;
      if (input.type === "checkbox") next[key] = input.checked;
      else if (input.dataset.v4Array) next[key] = input.value.split(",").map((item)=>item.trim()).filter(Boolean);
      else if (input.type === "number") next[key] = Number(input.value);
      else next[key] = input.value;
    });
    if (selected === "cohost") {
      next.sources = [...host.querySelectorAll("[data-cohost-source]")].map((row) => ({
        name: row.querySelector("[data-source-name]")?.value.trim() || `Gast ${Number(row.dataset.cohostSource) + 1}`,
        source: row.querySelector("[data-source-value]")?.value.trim() || ""
      }));
    }
    return { enabled: Boolean(host.querySelector("#v4-module-enabled")?.checked), config: next };
  }

  function cohostTools(module) {
    const sources = Array.isArray(module.config.sources) ? module.config.sources : [];
    const rows = Array.from({ length: Math.max(1, Math.min(8, Number(module.config.slots) || 4)) }, (_, index) => {
      const source = sources[index] || { name: `Gast ${index + 1}`, source: "" };
      const sourceLabel = String(module.config.defaultFormat || "tiktok") === "tiktok" ? "OBS-/Capture-Quelle" : "Quelle / URL";
      return `<div class="v4-source-row" data-cohost-source="${index}"><input data-source-name value="${esc(source.name)}" placeholder="Gast ${index + 1}"><input data-source-value value="${esc(source.source)}" placeholder="${sourceLabel}"></div>`;
    }).join("");
    const url = cohostStatus?.cohostUrl || "Wird geladen …";
    const layout = cohostStatus?.layout;
    return `<div class="v4-toolbox"><h3>Co-Host Quellen</h3><p>TikTok verwendet keine Gast-URL-Pflicht. Dort wird eine OBS-/Capture-Quelle hinterlegt. Twitch kann Quelle oder URL verwenden.</p>${rows}<div class="v4-inline-actions"><button data-cohost-refresh>LAYOUT AKTUALISIEREN</button><button data-cohost-copy>HTTP KOPIEREN</button><button data-cohost-open>HTTP ÖFFNEN</button></div><code class="v4-url">${esc(url)}</code>${layout?`<small>${layout.width}×${layout.height} · ${layout.columns}×${layout.rows} · ${layout.slots} Plätze</small>`:""}</div>`;
  }

  function mediaTools() {
    const rows = mediaFiles.length ? mediaFiles.map((file) => `<div class="v4-media-row"><div><strong>${esc(file.name)}</strong><small>${(Number(file.size||0)/1024/1024).toFixed(2)} MB · ${esc(file.extension)}</small></div><button class="danger-text" data-media-delete="${esc(file.name)}">LÖSCHEN</button></div>`).join("") : '<div class="v4-empty">Noch keine Medien importiert.</div>';
    return `<div class="v4-toolbox"><h3>Medienbibliothek</h3><div class="v4-inline-actions"><button class="primary" data-media-import>DATEIEN IMPORTIEREN</button><button data-media-folder>ORDNER ÖFFNEN</button><button data-media-refresh>AKTUALISIEREN</button></div><div class="v4-media-list">${rows}</div></div>`;
  }

  function poolTools() {
    const choices = mediaFiles.map((file) => `<label class="v4-check"><input type="checkbox" data-pool-file value="${esc(file.name)}"> ${esc(file.name)}</label>`).join("") || '<div class="v4-empty">Zuerst Medien importieren.</div>';
    return `<div class="v4-toolbox"><h3>Medien-Pool erstellen</h3><div class="v4-source-row"><input id="pool-name" placeholder="Pool-Name, z. B. Boss-Sounds"><select id="pool-mode"><option value="random">Zufall</option><option value="rotate">Rotation</option><option value="fixed">Feste Reihenfolge</option></select></div><div class="v4-pool-files">${choices}</div><button class="primary" data-pool-save>POOL IM CHAT BOT SPEICHERN</button><div id="pool-result"></div></div>`;
  }

  function backupTools() {
    return `<div class="v4-toolbox"><h3>Backup / Wiederherstellung</h3><p>Gesichert werden V4-Einstellungen, Multi-Chat-Moderation, Chat Bot, CNG/TTS/Overlay-Konfiguration und Medien bis zu den festgelegten Größenlimits.</p><div class="v4-inline-actions"><button class="primary" data-backup-export>BACKUP EXPORTIEREN</button><button data-backup-import>BACKUP IMPORTIEREN</button></div><small>Nach einem Import ist ein Neustart erforderlich, damit alle Laufzeitmodule den wiederhergestellten Zustand übernehmen.</small></div>`;
  }

  function liveTools() {
    if (!liveStatus) return `<div class="v4-toolbox"><h3>LIVE-Status</h3><p>Status wird geladen …</p></div>`;
    return `<div class="v4-toolbox"><h3>LIVE-Status</h3><div class="v4-cap-grid"><div><span>OBS</span><strong>${liveStatus.obsRunning?"Läuft":"Nicht erkannt"}</strong></div><div><span>TikTok LIVE Studio</span><strong>${liveStatus.tiktokLiveStudioRunning?"Läuft":"Nicht erkannt"}</strong></div></div><p>${esc(liveStatus.note||"")}</p><button data-live-refresh>STATUS PRÜFEN</button></div>`;
  }

  function platformTools() {
    if (!platformStatus) return `<div class="v4-toolbox"><h3>Plattform-Fähigkeiten</h3><p>Status wird geladen …</p></div>`;
    const rows = Object.entries(platformStatus).map(([id,status]) => `<div class="v4-cap-row"><strong>${esc(id.toUpperCase())}</strong><span>${status.connected?"Verbunden":"Getrennt"}</span><span>${status.canSend?"Senden möglich":"Senden nicht verfügbar"}</span><span>${status.available===false?"Adapter nicht verfügbar":"Adapter bereit"}</span></div>`).join("");
    return `<div class="v4-toolbox"><h3>Plattform-Fähigkeiten</h3>${rows}<small>Es wird nichts als Plattform-Funktion ausgegeben, was der aktuell verbundene Adapter nicht unterstützt.</small><button data-platform-refresh>AKTUALISIEREN</button></div>`;
  }

  function logsTools() {
    const rows = logRows.length ? logRows.slice().reverse().slice(0,80).map((entry)=>`<div class="v4-log-row"><span>${new Date(entry.time||entry.timestamp||Date.now()).toLocaleString("de-DE")}</span><b>${esc(entry.category||entry.type||"")}</b><span>${esc(entry.message||"")}</span></div>`).join("") : '<div class="v4-empty">Keine Logs vorhanden.</div>';
    return `<div class="v4-toolbox"><h3>Lokale Logs</h3><div class="v4-inline-actions"><button data-logs-refresh>AKTUALISIEREN</button><button data-logs-export>EXPORTIEREN</button><button class="danger-text" data-logs-clear>LÖSCHEN</button></div><div class="v4-log-list">${rows}</div></div>`;
  }

  function chatFilterTools() {
    return `<div class="v4-toolbox"><h3>Filter testen</h3><div class="v4-source-row"><select id="filter-test-platform"><option>twitch</option><option>tiktok</option><option>cng</option><option>youtube</option></select><input id="filter-test-message" placeholder="Testnachricht eingeben"></div><button data-filter-test>FILTER TESTEN</button><div id="filter-test-result"></div></div>`;
  }

  function toolHtml(module) {
    if (selected === "cohost") return cohostTools(module);
    if (selected === "media") return mediaTools();
    if (selected === "mediaPools") return poolTools();
    if (selected === "backup") return backupTools();
    if (selected === "liveTools") return liveTools();
    if (selected === "platforms") return platformTools();
    if (selected === "logs") return logsTools();
    if (selected === "chatFilter") return chatFilterTools();
    if (selected === "chatDesign") return `<div class="v4-toolbox"><h3>Chat-Design</h3><p>Der bestehende Hologramm-/Chat-Design-Editor ist direkt mit dem OBS-Overlay verbunden.</p><button data-open-holo>CHAT-DESIGN ÖFFNEN</button></div>`;
    return "";
  }

  function render() {
    const module = moduleState(selected);
    if (!module) return;
    host.innerHTML = `<div class="v4-settings">
      <nav class="v4-settings-nav" aria-label="V4 Module">${order.map((id)=>{const item=moduleState(id);if(!item)return"";return `<button class="${id===selected?"active":""}" data-v4-module="${id}"><span>${esc(item.title)}</span><small>${item.status==="bereit"?"BEREIT":"NICHT VERFÜGBAR"}</small></button>`}).join("")}</nav>
      <section class="v4-settings-main">
        <header class="v4-module-head"><div><span class="eyebrow">V4 MODUL-CONFIG</span><h2>${esc(module.title)}</h2><p>${esc(descriptions[selected]||"")}</p></div><label class="v4-switch"><input id="v4-module-enabled" type="checkbox" ${module.enabled?"checked":""}><span>Aktiv</span></label></header>
        <div class="v4-state-grid"><div class="v4-state"><span>Status</span><strong>${esc(module.status||"unbekannt")}</strong></div><div class="v4-state"><span>Verbindung</span><strong>${module.status==="bereit"?"Konfigurationskern OK":"Nicht aktiv"}</strong></div><div class="v4-state"><span>Letzter Fehler</span><strong>${esc(module.lastError||"Keiner")}</strong></div><div class="v4-state"><span>Letzte Aktivität</span><strong>${esc(module.lastActivity||"Noch keine")}</strong></div></div>
        <div class="v4-config-panel"><h3>MODUL-CONFIG</h3>${Object.entries(module.config||{}).map(([key,value])=>renderField(key,value)).join("")||"<p>Noch keine zusätzlichen Optionen.</p>"}
          ${toolHtml(module)}
          <div class="v4-actions"><button data-v4-help>HILFE</button><button data-v4-test ${testable.has(selected)?"":"disabled"}>TESTEN</button><button data-v4-reset>ZURÜCKSETZEN</button><button data-v4-apply>ÜBERNEHMEN</button><button class="primary" data-v4-save>SPEICHERN</button></div><div class="v4-save-state" id="v4-save-state"></div>
        </div>
      </section></div>`;
    bind();
  }

  function setMessage(text, error=false) { const el=host.querySelector("#v4-save-state"); if(!el)return; el.textContent=text; el.style.color=error?"#ff9ba8":"#8ee9ba"; }

  async function refreshTools() {
    try {
      if (selected === "media" || selected === "mediaPools") mediaFiles = await api.getV4Media();
      if (selected === "cohost") cohostStatus = await api.getCohostStatus();
      if (selected === "liveTools") liveStatus = await api.getLiveToolsStatus();
      if (selected === "platforms") platformStatus = await api.chatStatuses();
      if (selected === "logs") logRows = await api.getV4Logs({ limit: 500 });
    } catch (error) { setMessage(error.message||String(error), true); }
  }

  function bind() {
    host.querySelectorAll("[data-v4-module]").forEach((button)=>button.onclick=async()=>{selected=button.dataset.v4Module;await refreshTools();render();});
    host.querySelector("[data-v4-help]").onclick=()=>window.alert(`${moduleState(selected).title}\n\n${descriptions[selected]||""}`);
    host.querySelector("[data-v4-test]").onclick=async()=>{try{const result=await api.testV4Module(selected);setMessage(`TEST OK: ${result.message||result.module||selected}`);}catch(error){setMessage(`TEST FEHLER: ${error.message||error}`,true);}};
    host.querySelector("[data-v4-apply]").onclick=()=>{draft=collectDraft();setMessage("Änderungen übernommen – noch nicht dauerhaft gespeichert.");};
    host.querySelector("[data-v4-save]").onclick=async()=>{try{draft=collectDraft();const saved=await api.saveV4Config(selected,draft);snapshot.modules[selected]=saved;setMessage("Gespeichert.");await refreshTools();render();}catch(error){setMessage(error.message||String(error),true);}};
    host.querySelector("[data-v4-reset]").onclick=async()=>{if(!window.confirm(`${moduleState(selected).title} wirklich auf Standard zurücksetzen?`))return;try{const saved=await api.resetV4Config(selected);snapshot.modules[selected]=saved;await refreshTools();render();}catch(error){setMessage(error.message||String(error),true);}};

    host.querySelector("[data-media-import]")?.addEventListener("click",async()=>{try{const result=await api.importV4Media();mediaFiles=result.files||[];render();}catch(error){setMessage(error.message||String(error),true);}});
    host.querySelector("[data-media-folder]")?.addEventListener("click",()=>api.openV4MediaFolder().catch((error)=>setMessage(error.message,true)));
    host.querySelector("[data-media-refresh]")?.addEventListener("click",async()=>{mediaFiles=await api.getV4Media();render();});
    host.querySelectorAll("[data-media-delete]").forEach((button)=>button.onclick=async()=>{if(!window.confirm(`${button.dataset.mediaDelete} löschen?`))return;mediaFiles=await api.deleteV4Media(button.dataset.mediaDelete);render();});

    host.querySelector("[data-pool-save]")?.addEventListener("click",async()=>{try{const state=await api.getChatBotState();const name=host.querySelector("#pool-name").value.trim();const files=[...host.querySelectorAll("[data-pool-file]:checked")].map((x)=>x.value);if(!name)throw new Error("Pool-Name fehlt.");if(!files.length)throw new Error("Mindestens eine Mediendatei auswählen.");const pool={id:`pool-${Date.now().toString(36)}`,name,mode:host.querySelector("#pool-mode").value,files};const config={...state.config,media:{...(state.config.media||{}),pools:[...(state.config.media?.pools||[]),pool]}};await api.saveChatBotConfig(config);host.querySelector("#pool-result").textContent=`Pool „${name}“ gespeichert.`;}catch(error){host.querySelector("#pool-result").textContent=error.message||String(error);}});

    host.querySelector("[data-backup-export]")?.addEventListener("click",async()=>{try{const result=await api.exportV4Backup();setMessage(result.saved?`Backup gespeichert: ${result.filePath}`:"Export abgebrochen.");}catch(error){setMessage(error.message||String(error),true);}});
    host.querySelector("[data-backup-import]")?.addEventListener("click",async()=>{if(!window.confirm("Backup importieren? Die aktuelle Konfiguration wird durch die enthaltenen Dateien ersetzt."))return;try{const result=await api.importV4Backup();setMessage(result.restored?"Backup importiert. Bitte Batto OBS Tool neu starten.":"Import abgebrochen.");}catch(error){setMessage(error.message||String(error),true);}});

    host.querySelector("[data-cohost-refresh]")?.addEventListener("click",async()=>{try{const saved=await api.saveV4Config("cohost",collectDraft());snapshot.modules.cohost=saved;cohostStatus=await api.getCohostStatus();render();}catch(error){setMessage(error.message||String(error),true);}});
    host.querySelector("[data-cohost-copy]")?.addEventListener("click",async()=>{try{const url=await api.copyCohostUrl();setMessage(`HTTP-Adresse kopiert: ${url}`);}catch(error){setMessage(error.message||String(error),true);}});
    host.querySelector("[data-cohost-open]")?.addEventListener("click",()=>api.openCohostOverlay().catch((error)=>setMessage(error.message,true)));

    host.querySelector("[data-live-refresh]")?.addEventListener("click",async()=>{liveStatus=await api.getLiveToolsStatus();render();});
    host.querySelector("[data-platform-refresh]")?.addEventListener("click",async()=>{platformStatus=await api.chatStatuses();render();});

    host.querySelector("[data-logs-refresh]")?.addEventListener("click",async()=>{logRows=await api.getV4Logs({limit:500});render();});
    host.querySelector("[data-logs-export]")?.addEventListener("click",async()=>{const result=await api.exportV4Logs();setMessage(result.saved?`Logs gespeichert: ${result.filePath}`:"Export abgebrochen.");});
    host.querySelector("[data-logs-clear]")?.addEventListener("click",async()=>{if(!window.confirm("Lokale Logs wirklich löschen?"))return;await api.clearV4Logs();logRows=[];render();});

    host.querySelector("[data-filter-test]")?.addEventListener("click",async()=>{try{const result=await api.testChatFilter({platform:host.querySelector("#filter-test-platform").value,message:host.querySelector("#filter-test-message").value});host.querySelector("#filter-test-result").textContent=result.matched?`Treffer: ${result.words.join(", ")} · Aktion ${result.action}`:"Kein Filtertreffer.";}catch(error){host.querySelector("#filter-test-result").textContent=error.message||String(error);}});
    host.querySelector("[data-open-holo]")?.addEventListener("click",()=>api.openHoloEditor().catch((error)=>setMessage(error.message,true)));
  }

  async function init() {
    try { snapshot=await api.getV4Configs(); await refreshTools(); render(); }
    catch(error){host.innerHTML=`<article class="panel"><h2>V4 Einstellungen</h2><p>Konfiguration konnte nicht geladen werden: ${esc(error.message||error)}</p></article>`;}
  }
  api.onV4ConfigChanged?.((changed)=>{if(snapshot?.modules?.[changed.id]){snapshot.modules[changed.id]=changed;if(changed.id===selected)render();}});
  init();
})();
