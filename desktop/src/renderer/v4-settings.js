"use strict";

(() => {
  const api = window.batto;
  const host = document.getElementById("view-settings");
  if (!host || !api?.getV4Configs) return;

  const order = ["general","appearance","multichat","moderation","chatFilter","chatDesign","cohost","liveTools","platforms","chatbot","autoBroadcast","commands","hotkeys","events","media","mediaPools","tts","obsHttp","overlays","discord","statusbar","logs","backup","advanced"];
  const descriptions = {
    general:"Grundverhalten des Batto OBS Tools.", appearance:"Vollflächiger Programm-Hintergrund und Darstellung.", multichat:"Gemeinsamer Chat für Twitch, TikTok, CNG und YouTube.", moderation:"Plattformgetrennte Moderation mit lokalem und Plattform-Ergebnis.", chatFilter:"Wort-, Benutzer- und Umgehungsfilter.", chatDesign:"Design, Schriftarten und OBS-Chat-Overlay.", cohost:"Gast-Layouts für TikTok 1080×1920 und Twitch 1920×1080.", liveTools:"Interaktions- und Wachstumsfunktionen; nicht verfügbare Funktionen bleiben deaktiviert.", platforms:"Account-Verbindungen und Fähigkeiten der Plattform-Adapter.", chatbot:"Automationskern für Antworten und Aktionsketten.", autoBroadcast:"Automatische Nachrichten mit Intervallen und Plattformwahl.", commands:"Frei erstellbare Chat-Commands.", hotkeys:"Sichere Hotkeys und Multi-Actions mit Zielprozessprüfung.", events:"Follow, Sub, Gift, Raid, Share, Stream Start/Ende und eigene Trigger.", media:"Medienbibliothek ohne JSON-Pflicht.", mediaPools:"Reihenfolge, Rotation oder Zufall für Mediengruppen.", tts:"Text-to-Speech pro Plattform.", obsHttp:"Lokaler HTTP-/WebSocket-Server für OBS-Browserquellen.", overlays:"Darstellung, Queue und Priorität für OBS-Overlays.", discord:"Live-Benachrichtigungen über Discord-Webhooks.", statusbar:"Kompakte Stream-Statusleiste; keine Hardware-Vollanalyse.", logs:"Filterbare lokale Protokolle.", backup:"Update-sichere Sicherung und Import/Export.", advanced:"Erweiterte technische Optionen."
  };
  const labels = {
    backgroundEnabled:"Programm-Hintergrund aktiv",backgroundFile:"Hintergrunddatei",preserveAspect:"Seitenverhältnis erhalten",scaleToWindow:"Auf Fensterfläche skalieren",tiles:"Kacheln",mode:"Skalierungsmodus",brightness:"Helligkeit (%)",panelOpacity:"Panel-Transparenz (%)",uiScale:"UI-Skalierung (%)",
    reconnect:"Automatisch neu verbinden",reconnectDelaySeconds:"Reconnect nach (Sekunden)",showSecrets:"Technische Zugangsdaten anzeigen",
    enabled:"Aktiviert",host:"Host",port:"Port",autoStart:"Beim Programmstart starten",websocket:"WebSocket aktiviert",heartbeatSeconds:"Heartbeat (Sekunden)",refreshSeconds:"Aktualisierung (Sekunden)",position:"Position"
  };
  const testable = new Set([]);
  let snapshot = null;
  let selected = "general";
  let draft = {};

  const esc = (value) => String(value ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
  function human(key) { return labels[key] || key.replace(/([a-z])([A-Z])/g,"$1 $2").replaceAll("_"," ").replace(/^./,(m)=>m.toUpperCase()); }
  function moduleState(id) { return snapshot?.modules?.[id] || null; }

  function renderField(key, value) {
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
    return { enabled: Boolean(host.querySelector("#v4-module-enabled")?.checked), config: next };
  }

  function render() {
    const module = moduleState(selected);
    if (!module) return;
    host.innerHTML = `<div class="v4-settings">
      <nav class="v4-settings-nav" aria-label="V4 Module">${order.map((id)=>{const item=moduleState(id);if(!item)return"";return `<button class="${id===selected?"active":""}" data-v4-module="${id}"><span>${esc(item.title)}</span><small>${item.status==="nicht-verfuegbar"?"NICHT VERFÜGBAR":"CONFIG"}</small></button>`}).join("")}</nav>
      <section class="v4-settings-main">
        <header class="v4-module-head"><div><span class="eyebrow">V4 MODUL-CONFIG</span><h2>${esc(module.title)}</h2><p>${esc(descriptions[selected]||"")}</p></div><label class="v4-switch"><input id="v4-module-enabled" type="checkbox" ${module.enabled?"checked":""}><span>Aktiv</span></label></header>
        <div class="v4-state-grid"><div class="v4-state"><span>Status</span><strong>${esc(module.status||"unbekannt")}</strong></div><div class="v4-state"><span>Verbindung</span><strong>${module.status==="bereit"?"Konfigurationskern OK":"Nicht aktiv"}</strong></div><div class="v4-state"><span>Letzter Fehler</span><strong>${esc(module.lastError||"Keiner")}</strong></div><div class="v4-state"><span>Letzte Aktivität</span><strong>${esc(module.lastActivity||"Noch keine")}</strong></div></div>
        ${module.status==="nicht-verfuegbar"?`<div class="v4-module-note">Dieses Modul ist in der aktuellen Implementierungsphase noch nicht technisch verfügbar. Es wird nicht als funktionierend simuliert.</div>`:""}
        <div class="v4-config-panel"><h3>MODUL-CONFIG</h3>${Object.entries(module.config||{}).map(([key,value])=>renderField(key,value)).join("")||"<p>Noch keine zusätzlichen Optionen.</p>"}
          <div class="v4-actions"><button data-v4-help>HILFE</button><button data-v4-test ${testable.has(selected)?"":"disabled"}>TESTEN</button><button data-v4-reset>ZURÜCKSETZEN</button><button data-v4-apply>ÜBERNEHMEN</button><button class="primary" data-v4-save>SPEICHERN</button></div><div class="v4-save-state" id="v4-save-state"></div>
        </div>
      </section></div>`;
    bind();
  }

  function setMessage(text, error=false) { const el=host.querySelector("#v4-save-state"); if(!el)return; el.textContent=text; el.style.color=error?"#ff9ba8":"#8ee9ba"; }
  function bind() {
    host.querySelectorAll("[data-v4-module]").forEach((button)=>button.onclick=()=>{selected=button.dataset.v4Module;render();});
    host.querySelector("[data-v4-help]").onclick=()=>window.alert(`${moduleState(selected).title}\n\n${descriptions[selected]||""}`);
    host.querySelector("[data-v4-apply]").onclick=()=>{draft=collectDraft();setMessage("Änderungen übernommen – noch nicht dauerhaft gespeichert.");};
    host.querySelector("[data-v4-save]").onclick=async()=>{try{draft=collectDraft();const saved=await api.saveV4Config(selected,draft);snapshot.modules[selected]=saved;setMessage("Gespeichert.");render();}catch(error){setMessage(error.message||String(error),true);}};
    host.querySelector("[data-v4-reset]").onclick=async()=>{if(!window.confirm(`${moduleState(selected).title} wirklich auf Standard zurücksetzen?`))return;try{const saved=await api.resetV4Config(selected);snapshot.modules[selected]=saved;render();}catch(error){setMessage(error.message||String(error),true);}};
  }

  async function init() {
    try { snapshot=await api.getV4Configs(); render(); }
    catch(error){host.innerHTML=`<article class="panel"><h2>V4 Einstellungen</h2><p>Konfiguration konnte nicht geladen werden: ${esc(error.message||error)}</p></article>`;}
  }
  api.onV4ConfigChanged?.((changed)=>{if(snapshot?.modules?.[changed.id]){snapshot.modules[changed.id]=changed;if(changed.id===selected)render();}});
  init();
})();
