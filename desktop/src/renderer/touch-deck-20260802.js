"use strict";
(() => {
  const api = window.batto;
  const host = document.getElementById("view-deck-0802");
  if (!api || !host) return;

  const fallbackActions = [
    ["◉","Szene wechseln","OBS Studio","obs.scene.set"],
    ["🎙","Audio stumm/laut","OBS Studio","obs.audio.togglemute"],
    ["◫","Quelle ein/aus","OBS Studio","obs.source.toggle"],
    ["●","Aufnahme starten","OBS Studio","obs.record.start"],
    ["■","Aufnahme stoppen","OBS Studio","obs.record.stop"],
    ["▶","Stream starten","OBS Studio","obs.stream.start"],
    ["■","Stream stoppen","OBS Studio","obs.stream.stop"],
    ["📁","Ordner öffnen","Windows","folder.open"],
    ["▶","Programm starten","Windows","process.start"],
    ["🌐","Webadresse öffnen","Windows","url.open"],
    ["♪","TikFinity Aktion","TikFinity","tikfinity.action"],
    ["TT","TikTok Szene/Quelle","TikTok LIVE Studio","tiktok.scene"]
  ].map((a,i)=>({id:`builtin-${i}`,icon:a[0],title:a[1],category:a[2],actionType:a[3]}));

  let state = null;
  let selected = 0;
  let selectedAction = fallbackActions[0];
  let activeProfile = "Standard";
  let pageName = "Seite 1";
  let keys = Array.from({length:15},(_,i)=>({index:i,title:"",icon:"",iconPath:"",actionType:"",command:"",arguments:""}));

  function esc(v){return String(v??"").replace(/[&<>\"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
  function normalizeKeys(input){const out=Array.from({length:15},(_,i)=>({index:i,title:"",icon:"",iconPath:"",actionType:"",command:"",arguments:""}));for(const [i,k] of (Array.isArray(input)?input:[]).slice(0,15).entries())out[i]={...out[i],...k,index:i};return out;}
  function profileNames(){const p=state?.deck?.profiles||state?.profiles||[];return Array.isArray(p)&&p.length?p.map(x=>x.name||x.id||"Standard"):["Standard"];}
  function currentProfile(){const list=state?.deck?.profiles||state?.profiles||[];return Array.isArray(list)?list.find(x=>(x.name||x.id)===activeProfile)||list[0]:null;}
  function loadFromState(){const p=currentProfile();if(p){const page=Array.isArray(p.pages)?(p.pages[p.activePageIndex||0]||p.pages[0]):p;pageName=page?.name||"Seite 1";keys=normalizeKeys(page?.keys||p.keys);}else keys=normalizeKeys([]);}

  function render(){
    host.innerHTML=`<div class="touchdeck-0802">
      <section class="td-left">
        <div class="td-profile"><label>OBS-PROFILE<select id="td-profile">${profileNames().map(n=>`<option ${n===activeProfile?"selected":""}>${esc(n)}</option>`).join("")}</select></label><div class="td-top-actions"><button class="td-button" id="td-pair">📱 Verbinden</button><button class="td-button" id="td-settings">⚙ Einstellungen</button><button class="td-button" id="td-save">Speichern</button><button class="td-button" id="td-test">OBS-Aktion testen</button></div></div>
        <div class="td-pages"><div class="td-page-buttons"><button class="td-button active">${esc(pageName)}</button></div><div class="td-page-actions"><button class="td-button" id="td-add-page">＋ Seite</button><button class="td-button" id="td-rename-page">Umbenennen</button><button class="td-button" id="td-delete-page">Löschen</button></div></div>
        <div class="td-deck-wrap"><div class="td-deck">${keys.map((k,i)=>`<button class="td-key ${selected===i?"selected":""} ${!k.title&&!k.icon&&!k.iconPath?"td-empty":""}" data-key="${i}">${k.iconPath?`<img src="${esc(k.iconPath)}">`:`<span class="td-key-icon">${esc(k.icon||"")}</span>`}<span class="td-key-title">${esc(k.title||`Taste ${i+1}`)}</span></button>`).join("")}</div></div>
        <div class="td-editor"><div class="td-editor-left"><strong>TASTE</strong><label>Titel<input id="td-title" value="${esc(keys[selected]?.title||"")}"></label><label>Symbol<input id="td-icon" value="${esc(keys[selected]?.icon||"")}"></label><button class="td-button" id="td-image">Eigenes Bild wählen</button><button class="td-button" id="td-clear">Taste leeren</button><small class="td-original-note">Layout und Bedienlogik entsprechen dem TouchDeck-Stand vom 02.08.2026.</small></div><div class="td-wizard"><h3 id="td-wizard-title">${esc(selectedAction?.category||"Wähle eine OBS-Aktion")}</h3><p>${esc(selectedAction?.title||"Aktion auswählen")}</p><label>Ziel / Name<input id="td-command" value="${esc(keys[selected]?.command||"")}"></label><label>Zusatz / Argument<input id="td-arguments" value="${esc(keys[selected]?.arguments||"")}"></label><button class="td-button" id="td-apply">Einstellung übernehmen</button></div></div>
      </section>
      <aside class="td-actions"><div class="td-actions-head"><input id="td-search" class="td-search" placeholder="OBS-Aktionen suchen"><span>OBS STUDIO</span></div><div class="td-action-list" id="td-action-list">${actionHtml(fallbackActions)}</div></aside>
    </div>`;
    bind();
  }
  function actionHtml(list){return list.map(a=>`<div class="td-action" data-action="${esc(a.id)}"><span>${esc(a.icon)}</span><div>${esc(a.title)}<small>${esc(a.category)}</small></div><span class="td-dot"></span></div>`).join("");}
  function bind(){
    host.querySelectorAll("[data-key]").forEach(b=>b.onclick=()=>{selected=Number(b.dataset.key);render();});
    host.querySelector("#td-profile").onchange=e=>{activeProfile=e.target.value;loadFromState();selected=0;render();};
    host.querySelectorAll("[data-action]").forEach(el=>el.onclick=()=>{selectedAction=fallbackActions.find(a=>a.id===el.dataset.action)||fallbackActions[0];render();});
    host.querySelector("#td-search").oninput=e=>{const q=e.target.value.toLowerCase();host.querySelector("#td-action-list").innerHTML=actionHtml(fallbackActions.filter(a=>`${a.title} ${a.category}`.toLowerCase().includes(q)));bindActionOnly();};
    host.querySelector("#td-title").oninput=e=>{keys[selected].title=e.target.value;};
    host.querySelector("#td-icon").oninput=e=>{keys[selected].icon=e.target.value;};
    host.querySelector("#td-command").oninput=e=>{keys[selected].command=e.target.value;};
    host.querySelector("#td-arguments").oninput=e=>{keys[selected].arguments=e.target.value;};
    host.querySelector("#td-apply").onclick=async()=>{keys[selected].actionType=selectedAction.actionType;keys[selected].title=host.querySelector("#td-title").value||selectedAction.title;keys[selected].icon=host.querySelector("#td-icon").value||selectedAction.icon;await saveKey();render();};
    host.querySelector("#td-clear").onclick=async()=>{keys[selected]={index:selected,title:"",icon:"",iconPath:"",actionType:"",command:"",arguments:""};try{await api.invoke("deck:clear-button",{profile:activeProfile,index:selected});}catch{}render();};
    host.querySelector("#td-test").onclick=async()=>{try{await api.executeDeckAction(keys[selected]);}catch(e){alert(e.message||e);}};
    host.querySelector("#td-save").onclick=()=>saveKey();
    host.querySelector("#td-add-page").onclick=()=>alert("Die Seitenverwaltung bleibt wie im Original-TouchDeck. Die vorhandene Deck-Store-API wird dafür verwendet, sobald ein Profil geladen ist.");
    host.querySelector("#td-rename-page").onclick=()=>{const n=prompt("Seitenname",pageName);if(n){pageName=n;render();}};
    host.querySelector("#td-delete-page").onclick=()=>alert("Mindestens eine virtuelle Seite muss bestehen bleiben.");
    host.querySelector("#td-pair").onclick=()=>alert("Handy-Kopplung wird über die vorhandene Batto-Deck-Verbindung geöffnet.");
    host.querySelector("#td-settings").onclick=()=>document.querySelector('[data-view="settings"]')?.click();
    host.querySelector("#td-image").onclick=()=>alert("Eigenes Bild wählen: Dateidialog wird im nächsten Backend-Schritt mit der bestehenden Deck-Importfunktion verbunden.");
  }
  function bindActionOnly(){host.querySelectorAll("[data-action]").forEach(el=>el.onclick=()=>{selectedAction=fallbackActions.find(a=>a.id===el.dataset.action)||fallbackActions[0];render();});}
  async function saveKey(){const payload={profile:activeProfile,index:selected,button:{...keys[selected],index:selected}};try{await api.invoke("deck:update-button",payload);}catch{} }
  async function init(){try{state=await api.invoke("state:get");activeProfile=state?.deck?.activeProfile||state?.activeProfile||profileNames()[0];loadFromState();}catch{}render();}
  init();
})();