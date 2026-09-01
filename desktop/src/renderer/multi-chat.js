"use strict";

(() => {
  const api = window.batto;
  const root = document.getElementById("multi-chat-root");
  if (!api || !root) return;
  const platformMeta = { all:["Alle","#5aa7ff","✦"], twitch:["Twitch","#9146ff","◉"], cng:["CNG","#2f9cff","◆"], tiktok:["TikTok","#111111","♪"], youtube:["YouTube","#ff3030","▶"] };
  let filter = "all";
  let messages = [];
  let ttsConfig = { enabled:false, language:"de-DE", rate:1, pitch:1, volume:1, cooldownMs:1200, maxQueue:20, maxCommentLength:220, chat:true, events:true };
  const ttsQueue = [];
  let ttsRunning = false;
  let lastTts = 0;

  function esc(value){return String(value ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;")}
  function render(){
    root.innerHTML = `<div class="multi-chat">
      <header class="chat-head"><div class="chat-title"><span style="font-size:18px">✦</span><div><strong>BATTO MULTI-CHAT</strong><small>Twitch · CNG · TikTok · YouTube</small></div></div><div class="chat-actions"><button class="icon-btn" id="chat-settings-btn" title="Chat-Einstellungen">⚙</button><button class="icon-btn" id="chat-undock-btn" title="Abdocken">↗</button></div></header>
      <nav class="chat-tabs">${Object.entries(platformMeta).map(([key,v])=>`<button class="chat-tab ${filter===key?'active':''}" data-filter="${key}" ${key!=="all"?`data-platform="${key}"`:""}>${v[0]}</button>`).join("")}</nav>
      <section class="chat-body" id="chat-body"></section>
      <section class="chat-compose"><textarea id="chat-input" maxlength="1000" placeholder="Nachricht schreiben … (Versand wird pro Plattform später separat freigeschaltet)"></textarea><div class="compose-row"><small>Nur Anzeige/Reader-Architektur · kein stilles Senden</small><button class="send-btn" id="chat-send" disabled>Senden</button></div></section>
      <footer class="chat-footer"><span id="chat-status">● Initialisiere …</span><span id="chat-count">0 Nachrichten</span></footer>
      <aside class="chat-settings" id="chat-settings" hidden>${settingsHtml()}</aside>
    </div>`;
    bind(); updateBody();
  }
  function settingsHtml(){return `<div class="settings-section"><h3>Verbindungen</h3><div class="status-grid" id="chat-status-grid"></div></div><div class="settings-section"><h3>Twitch</h3><label>Kanal<input id="cfg-twitch-channel" placeholder="dein_channel"></label><label>OAuth-Token<input id="cfg-twitch-token" type="password" placeholder="oauth-…"></label><label>Username<input id="cfg-twitch-user" placeholder="batto_reader"></label><button id="cfg-twitch-connect">Twitch verbinden</button></div><div class="settings-section"><h3>CNG · persönliche URLs</h3><label>Persönliche CNG-Chat-URL<input id="cfg-cng-chat" placeholder="https://cng-plattform.com/chat-popout/…?mode=obs&obsChatToken=…"></label><label>Persönliche Alert-URL<input id="cfg-cng-alert" placeholder="https://cng-plattform.com/alert-overlay?creatorId=…"></label><div class="settings-actions"><button id="cfg-cng-save">CNG-Konfiguration speichern</button><button id="cfg-cng-connect">Verbinden</button></div><small>Der Token wird intern maskiert/log-sicher behandelt. Der echte CNG-Realtime-Transport wird erst verwendet, wenn seine Schnittstelle nachweislich verfügbar ist.</small></div><div class="settings-section"><h3>TikTok LIVE</h3><label>LIVE-Username<input id="cfg-tiktok-user" placeholder="@username"></label><button id="cfg-tiktok-connect">TikTok verbinden</button><small>Öffentliche LIVE-Lesung über das optionale tiktok-live-connector Paket.</small></div><div class="settings-section"><h3>YouTube</h3><label>Video-ID<input id="cfg-youtube-video" placeholder="Live-Video-ID"></label><button id="cfg-youtube-connect">YouTube vorbereiten</button></div><div class="settings-section"><h3>Batto TTS</h3><label><input id="tts-enabled" type="checkbox"> Chat-TTS aktiv</label><label>Sprache<select id="tts-language"><option>de-DE</option><option>en-US</option><option>en-GB</option><option>fr-FR</option><option>es-ES</option><option>it-IT</option><option>pt-BR</option><option>ja-JP</option><option>ko-KR</option></select></label><label>Stimme<select id="tts-voice"><option value="">Systemstimme</option></select></label><label>Geschwindigkeit<input id="tts-rate" type="range" min="0.5" max="2" step="0.05" value="1"></label><label>Tonhöhe<input id="tts-pitch" type="range" min="0" max="2" step="0.05" value="1"></label><label>Lautstärke<input id="tts-volume" type="range" min="0" max="1" step="0.05" value="1"></label><label>Cooldown (ms)<input id="tts-cooldown" type="number" min="0" max="60000" value="1200"></label><label>Max. Kommentar-Länge<input id="tts-maxlen" type="number" min="20" max="1000" value="220"></label></div><div class="settings-actions"><button id="chat-clear">Chat leeren</button><button id="chat-settings-close">Schließen</button></div>`}
  function bind(){
    root.querySelectorAll("[data-filter]").forEach((button)=>button.onclick=()=>{filter=button.dataset.filter;render()});
    root.querySelector("#chat-settings-btn").onclick=()=>{const el=root.querySelector("#chat-settings");el.hidden=!el.hidden; if(!el.hidden) refreshSettings()};
    root.querySelector("#chat-settings-close").onclick=()=>root.querySelector("#chat-settings").hidden=true;
    root.querySelector("#chat-clear").onclick=async()=>{await api.chatClear(filter);messages=[];updateBody()};
    root.querySelector("#chat-undock-btn").onclick=()=>api.chatToggleWindow();
    root.querySelector("#cfg-twitch-connect").onclick=async()=>{try{await api.chatConnect("twitch",{channel:value("cfg-twitch-channel"),token:value("cfg-twitch-token"),username:value("cfg-twitch-user")});refreshSettings()}catch(e){alert(e.message)}};
    root.querySelector("#cfg-cng-save").onclick=async()=>{try{await api.saveCngConfig({chat:{url:value("cfg-cng-chat")},alerts:{url:value("cfg-cng-alert")}});refreshSettings()}catch(e){alert(e.message)}};
    root.querySelector("#cfg-cng-connect").onclick=async()=>{try{await api.chatConnect("cng",await api.getCngConfig());refreshSettings()}catch(e){alert(e.message)}};
    root.querySelector("#cfg-tiktok-connect").onclick=async()=>{try{await api.chatConnect("tiktok",{username:value("cfg-tiktok-user")});refreshSettings()}catch(e){alert(e.message)}};
    root.querySelector("#cfg-youtube-connect").onclick=async()=>{try{await api.chatConnect("youtube",{videoId:value("cfg-youtube-video")});refreshSettings()}catch(e){alert(e.message)}};
    root.querySelector("#tts-enabled").onchange=saveTts;
    ["tts-language","tts-voice","tts-rate","tts-pitch","tts-volume","tts-cooldown","tts-maxlen"].forEach((id)=>root.querySelector(`#${id}`).onchange=saveTts);
    root.querySelector("#chat-send").onclick=()=>{};
    root.querySelector("#chat-input").addEventListener("keydown",(event)=>{if(event.key==="Enter"&&!event.shiftKey){event.preventDefault()}});
  }
  function value(id){return root.querySelector(`#${id}`)?.value.trim()||""}
  async function refreshSettings(){
    const statuses=await api.chatStatuses();
    root.querySelector("#chat-status-grid").innerHTML=Object.entries(statuses).map(([p,s])=>`<div class="status-card"><strong>${esc(platformMeta[p][0])}</strong><small><span class="dot ${s.connected?'on':''}"></span>${s.connected?'Verbunden':s.configured?'Konfiguriert':'Getrennt'}</small></div>`).join("");
    const cng=await api.getCngConfig(); if(cng){root.querySelector("#cfg-cng-chat").value=cng.chat?.url||"";root.querySelector("#cfg-cng-alert").value=cng.alerts?.url||""}
    const tts=await api.getTtsConfig(); if(tts){ttsConfig=tts;root.querySelector("#tts-enabled").checked=tts.enabled;root.querySelector("#tts-language").value=tts.language;root.querySelector("#tts-rate").value=tts.rate;root.querySelector("#tts-pitch").value=tts.pitch;root.querySelector("#tts-volume").value=tts.volume;root.querySelector("#tts-cooldown").value=tts.cooldownMs;root.querySelector("#tts-maxlen").value=tts.maxCommentLength}
    loadVoices();
  }
  async function saveTts(){ttsConfig={...ttsConfig,enabled:root.querySelector("#tts-enabled").checked,language:value("tts-language"),voice:value("tts-voice"),rate:Number(root.querySelector("#tts-rate").value),pitch:Number(root.querySelector("#tts-pitch").value),volume:Number(root.querySelector("#tts-volume").value),cooldownMs:Number(root.querySelector("#tts-cooldown").value),maxCommentLength:Number(root.querySelector("#tts-maxlen").value)};await api.saveTtsConfig(ttsConfig);}
  function loadVoices(){const select=root.querySelector("#tts-voice");if(!select||!window.speechSynthesis)return;const voices=window.speechSynthesis.getVoices();const current=select.value;select.innerHTML='<option value="">Systemstimme</option>'+voices.map(v=>`<option value="${esc(v.name)}">${esc(v.name)} · ${esc(v.lang)}</option>`).join("");select.value=current}
  function updateBody(){const body=root.querySelector("#chat-body");const visible=messages.filter(m=>filter==="all"||m.platform===filter).slice(-300);root.querySelector("#chat-count").textContent=`${visible.length} Nachrichten`;if(!visible.length){body.innerHTML='<div class="chat-empty"><div><strong>Noch keine Nachrichten</strong><br><small>Verbinde Twitch/CNG/TikTok oder YouTube, um alles in einem Verlauf zu sehen.</small></div></div>';return}body.innerHTML=visible.map(m=>{const meta=platformMeta[m.platform]||platformMeta.cng;return `<div class="chat-row"><span class="platform-badge" style="background:${esc(m.color||meta[1])}">${meta[2]}</span><div><div class="chat-meta"><span class="chat-user" style="color:${esc(m.color||meta[1])}">${esc(m.username)}</span><span class="chat-role">${esc(meta[0])}</span>${m.role?`<span class="chat-role">${esc(m.role)}</span>`:""}</div><div class="chat-message">${esc(m.message)}</div></div></div>`}).join("");body.scrollTop=body.scrollHeight}
  function acceptBatch(batch){for(const message of batch){messages.push(message);if(messages.length>500)messages.splice(0,messages.length-500);speak(message)}updateBody()}
  function speak(message){if(!ttsConfig.enabled||!ttsConfig.chat||!ttsConfig.announcePlatforms.includes(message.platform)||!message.message)return;const text=message.message.slice(0,ttsConfig.maxCommentLength);if(Date.now()-lastTts<ttsConfig.cooldownMs||ttsQueue.length>=ttsConfig.maxQueue)return;if(ttsConfig.blockUsers.includes(message.username))return;if(ttsConfig.allowUsers.length&&!ttsConfig.allowUsers.includes(message.username))return;ttsQueue.push(`${message.username} sagt: ${text}`);pumpTts()}
  function pumpTts(){if(ttsRunning||!ttsQueue.length||!window.speechSynthesis)return;const text=ttsQueue.shift();const utterance=new SpeechSynthesisUtterance(text);utterance.lang=ttsConfig.language;utterance.rate=ttsConfig.rate;utterance.pitch=ttsConfig.pitch;utterance.volume=ttsConfig.volume;const voice=window.speechSynthesis.getVoices().find(v=>v.name===ttsConfig.voice);if(voice)utterance.voice=voice;ttsRunning=true;lastTts=Date.now();utterance.onend=()=>{ttsRunning=false;setTimeout(pumpTts,ttsConfig.cooldownMs)};utterance.onerror=()=>{ttsRunning=false;setTimeout(pumpTts,ttsConfig.cooldownMs)};window.speechSynthesis.speak(utterance)}
  async function init(){
    render();
    messages=await api.chatHistory({limit:300});
    updateBody();
    api.onChatMessages(acceptBatch);api.onChatStatus(()=>{const el=root.querySelector("#chat-status");if(el)el.textContent="● Verbindungen aktualisiert"});api.onChatWindow((state)=>{const button=root.querySelector("#chat-undock-btn");if(button)button.textContent=state.undocked?"↙":"↗"});
    if(window.speechSynthesis)window.speechSynthesis.onvoiceschanged=loadVoices;
    refreshSettings();
  }
  init();
})();
