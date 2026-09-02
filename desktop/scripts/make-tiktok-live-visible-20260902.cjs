"use strict";

const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const write = (relative, value) => fs.writeFileSync(path.join(root, relative), value, "utf8");
const marker = "BATTO_TIKTOK_VISIBLE_MOD_V1";

{
  const file = "src/renderer/tiktok-moderation.js";
  let text = read(file);
  if (!text.includes(marker)) {
    text = text.replace(
      "  let recent = [];\n  let menu = null;",
      "  let recent = [];\n  let liveStats = { gift:0, like:0, follow:0, share:0, member:0, subscribe:0 };\n  let menu = null;\n  // " + marker
    );

    const helperMarker = "  function closeMenu(){if(menu){menu.remove();menu=null}}";
    if (!text.includes(helperMarker)) throw new Error("TikTok sichtbarer MOD-Button: closeMenu Marker fehlt.");
    const helpers = String.raw`  function updateLiveStrip(){
    const strip=el("ttlive-strip"); if(!strip)return;
    for(const name of ["gift","like","follow","share","member","subscribe"]){const node=el("ttlive-"+name);if(node)node.textContent=String(Number(liveStats[name]||0))}
  }
  function openModeration(){
    ensurePanel();
    const settings=host.querySelector("#chat-settings"); if(settings) settings.hidden=false;
    const panel=el("ttmod-panel"); if(panel){panel.classList.add("tiktok-mod-highlight");panel.scrollIntoView({behavior:"smooth",block:"start"});setTimeout(()=>panel.classList.remove("tiktok-mod-highlight"),1600)}
  }
  function ensureVisibleControls(){
    const chat=host.querySelector(".multi-chat"); if(!chat)return;
    const actions=host.querySelector(".chat-head .chat-actions");
    if(actions&&!el("ttmod-open")){const button=document.createElement("button");button.id="ttmod-open";button.type="button";button.className="ttmod-open-btn";button.textContent="🛡 TikTok MOD";button.title="TikTok LIVE Moderation öffnen";button.onclick=openModeration;actions.prepend(button)}
    const tabs=host.querySelector(".chat-tabs");
    if(tabs&&!el("ttlive-strip")){const strip=document.createElement("section");strip.id="ttlive-strip";strip.className="ttlive-strip";strip.innerHTML='<strong>TikTok LIVE</strong><span>🎁 <b id="ttlive-gift">0</b></span><span>❤ <b id="ttlive-like">0</b></span><span>+Follower <b id="ttlive-follow">0</b></span><span>↗ Shares <b id="ttlive-share">0</b></span><span>↪ Join <b id="ttlive-member">0</b></span><span>★ Subs <b id="ttlive-subscribe">0</b></span><button id="ttlive-open-mod" type="button">Moderation & Filter</button>';tabs.insertAdjacentElement("afterend",strip);el("ttlive-open-mod").onclick=openModeration;updateLiveStrip()}
  }
`;
    text = text.replace(helperMarker, helpers + helperMarker);

    const batchMarker = '  if(typeof api.onChatMessages==="function")api.onChatMessages((batch)=>{for(const m of batch||[])if(m?.platform==="tiktok")recent.push(m);if(recent.length>500)recent=recent.slice(-500);setTimeout(bindRows,0)});';
    if (!text.includes(batchMarker)) throw new Error("TikTok sichtbare LIVE-Zähler: Nachrichten-Marker fehlt.");
    text = text.replace(batchMarker, '  if(typeof api.onChatMessages==="function")api.onChatMessages((batch)=>{for(const m of batch||[]){if(m?.platform!=="tiktok")continue;recent.push(m);const type=String(m.metadata?.eventType||m.metadata?.raw?.eventType||"").toLowerCase();if(type&&Object.prototype.hasOwnProperty.call(liveStats,type))liveStats[type]+=1;const raw=String(m.metadata?.raw?.displayType||m.metadata?.raw?.label||"").toLowerCase();if(type==="social"&&raw.includes("follow"))liveStats.follow+=1;else if(type==="social"&&raw.includes("share"))liveStats.share+=1;}if(recent.length>500)recent=recent.slice(-500);ensureVisibleControls();updateLiveStrip();setTimeout(bindRows,0)});');

    const observerMarker = '  const observer=new MutationObserver(()=>{ensurePanel();bindRows()});observer.observe(host,{childList:true,subtree:true});ensurePanel();bindRows();document.addEventListener("click",(event)=>{if(menu&&!menu.contains(event.target))closeMenu()});window.addEventListener("blur",closeMenu);';
    if (!text.includes(observerMarker)) throw new Error("TikTok sichtbarer MOD-Button: Observer-Marker fehlt.");
    text = text.replace(observerMarker, '  const observer=new MutationObserver(()=>{ensurePanel();ensureVisibleControls();bindRows()});observer.observe(host,{childList:true,subtree:true});ensurePanel();ensureVisibleControls();bindRows();document.addEventListener("click",(event)=>{if(menu&&!menu.contains(event.target))closeMenu()});window.addEventListener("blur",closeMenu);');
    write(file, text);
  }
}

{
  const file = "src/renderer/tiktok-moderation.css";
  let text = read(file);
  if (!text.includes(".ttlive-strip")) {
    text += `\n.ttmod-open-btn{padding:6px 10px!important;border-color:#4fd8ff!important;color:#eafaff!important;background:linear-gradient(135deg,#102436,#162f46)!important;font-size:10px!important;font-weight:800!important}.ttlive-strip{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:7px 10px;border-bottom:1px solid #283746;background:linear-gradient(90deg,#101b28,#0c141e);font-size:10px}.ttlive-strip strong{color:#64dcff}.ttlive-strip span{color:#9eafc0}.ttlive-strip b{color:#f3f8fc}.ttlive-strip button{margin-left:auto;padding:5px 9px;font-size:9px}.tiktok-mod-highlight{outline:2px solid #54dcff;outline-offset:-2px;box-shadow:0 0 28px #39cfff33}\n`;
    write(file, text);
  }
}

// Best-effort event refinements. The visible moderation UI must never be blocked
// merely because an earlier patch formatted the TikTok adapter differently.
{
  const file = "src/services/platforms/tiktok-adapter.cjs";
  let text = read(file);
  if (!text.includes("BATTO_GIFT_COMBO_FINAL_ONLY")) {
    const giftPattern = /this\.client\.on\?\.\("gift",\s*\(data\)\s*=>\s*\{[\s\S]*?this\.emitEvent\("gift",[\s\S]*?\}\);/;
    if (giftPattern.test(text)) {
      text = text.replace(giftPattern, 'this.client.on?.("gift", (data) => {\n        // BATTO_GIFT_COMBO_FINAL_ONLY\n        if (Number(data?.giftType) === 1 && data?.repeatEnd !== true) return;\n        const user = userFrom(data);\n        this.emitEvent("gift", data, `${user.nickname} sendet ${data?.giftName || data?.gift?.name || "ein Geschenk"}${data?.repeatCount ? ` ×${data.repeatCount}` : ""}`);\n      });');
    }
  }
  if (!text.includes("BATTO_SOCIAL_FOLLOW_SHARE")) {
    const socialPattern = /this\.client\.on\?\.\("social",\s*\(data\)\s*=>\s*\{[\s\S]*?\}\);/;
    if (socialPattern.test(text)) {
      text = text.replace(socialPattern, 'this.client.on?.("social", (data) => { // BATTO_SOCIAL_FOLLOW_SHARE\n        const user = userFrom(data); const raw = String(data?.displayType || data?.label || data?.action || "").toLowerCase();\n        const type = raw.includes("follow") ? "follow" : raw.includes("share") ? "share" : "social";\n        const label = type === "follow" ? "folgt jetzt" : type === "share" ? "hat den LIVE geteilt" : "hat eine soziale Aktion ausgelöst";\n        this.emitEvent(type, data, `${user.nickname} ${label}`);\n      });');
    }
  }
  write(file, text);
}

console.log("TikTok LIVE ist im normalen Chat sichtbar: MOD-Button, LIVE-Zähler und direkter Filterzugriff aktiv.");
