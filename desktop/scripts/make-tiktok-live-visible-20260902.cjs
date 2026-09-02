"use strict";

const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const write = (relative, value) => fs.writeFileSync(path.join(root, relative), value, "utf8");

const marker = "BATTO_TIKTOK_VISIBLE_MOD_V1";

// Make the moderation entry point visible in the normal chat UI instead of hiding
// everything behind the generic settings drawer.
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
    const count=(name)=>Number(liveStats[name]||0);
    const values={gift:count("gift"),like:count("like"),follow:count("follow"),share:count("share"),member:count("member"),subscribe:count("subscribe")};
    for(const [name,value] of Object.entries(values)){const node=el("ttlive-"+name);if(node)node.textContent=String(value)}
  }
  function openModeration(){
    ensurePanel();
    const settings=host.querySelector("#chat-settings"); if(settings) settings.hidden=false;
    const panel=el("ttmod-panel"); if(panel){panel.classList.add("tiktok-mod-highlight");panel.scrollIntoView({behavior:"smooth",block:"start"});setTimeout(()=>panel.classList.remove("tiktok-mod-highlight"),1600)}
  }
  function ensureVisibleControls(){
    const chat=host.querySelector(".multi-chat"); if(!chat)return;
    const actions=host.querySelector(".chat-head .chat-actions");
    if(actions&&!el("ttmod-open")){
      const button=document.createElement("button");button.id="ttmod-open";button.type="button";button.className="ttmod-open-btn";button.textContent="🛡 TikTok MOD";button.title="TikTok LIVE Moderation öffnen";button.onclick=openModeration;actions.prepend(button);
    }
    const tabs=host.querySelector(".chat-tabs");
    if(tabs&&!el("ttlive-strip")){
      const strip=document.createElement("section");strip.id="ttlive-strip";strip.className="ttlive-strip";
      strip.innerHTML='<strong>TikTok LIVE</strong><span>🎁 <b id="ttlive-gift">0</b></span><span>❤ <b id="ttlive-like">0</b></span><span>+Follower <b id="ttlive-follow">0</b></span><span>↗ Shares <b id="ttlive-share">0</b></span><span>↪ Join <b id="ttlive-member">0</b></span><span>★ Subs <b id="ttlive-subscribe">0</b></span><button id="ttlive-open-mod" type="button">Moderation & Filter</button>';
      tabs.insertAdjacentElement("afterend",strip);el("ttlive-open-mod").onclick=openModeration;updateLiveStrip();
    }
  }
`;
    text = text.replace(helperMarker, helpers + helperMarker);

    const batchMarker = '  if(typeof api.onChatMessages==="function")api.onChatMessages((batch)=>{for(const m of batch||[])if(m?.platform==="tiktok")recent.push(m);if(recent.length>500)recent=recent.slice(-500);setTimeout(bindRows,0)});';
    if (!text.includes(batchMarker)) throw new Error("TikTok sichtbare LIVE-Zähler: Nachrichten-Marker fehlt.");
    const batchReplacement = '  if(typeof api.onChatMessages==="function")api.onChatMessages((batch)=>{for(const m of batch||[]){if(m?.platform!=="tiktok")continue;recent.push(m);const type=String(m.metadata?.eventType||m.metadata?.raw?.eventType||"").toLowerCase();if(type&&Object.prototype.hasOwnProperty.call(liveStats,type))liveStats[type]+=1;const raw=String(m.metadata?.raw?.displayType||m.metadata?.raw?.label||"").toLowerCase();if(type==="social"&&raw.includes("follow"))liveStats.follow+=1;else if(type==="social"&&raw.includes("share"))liveStats.share+=1;}if(recent.length>500)recent=recent.slice(-500);ensureVisibleControls();updateLiveStrip();setTimeout(bindRows,0)});';
    text = text.replace(batchMarker, batchReplacement);

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

// Improve the existing direct TikTok event adapter: identify follows/shares and
// only emit the final event for streakable gift combos so they are not counted repeatedly.
{
  const file = "src/services/platforms/tiktok-adapter.cjs";
  let text = read(file);
  if (!text.includes("BATTO_GIFT_COMBO_FINAL_ONLY")) {
    const giftBefore = '      this.client.on?.("gift", (data) => {\n        const user = userFrom(data);\n        this.emitEvent("gift", data, `${user.nickname} sendet ${data?.giftName || data?.gift?.name || "ein Geschenk"}${data?.repeatCount ? ` ×${data.repeatCount}` : ""}`);\n      });';
    const giftAfter = '      this.client.on?.("gift", (data) => {\n        // BATTO_GIFT_COMBO_FINAL_ONLY: streakable gifts are published once when the combo ends.\n        if (Number(data?.giftType) === 1 && data?.repeatEnd !== true) return;\n        const user = userFrom(data);\n        this.emitEvent("gift", data, `${user.nickname} sendet ${data?.giftName || data?.gift?.name || "ein Geschenk"}${data?.repeatCount ? ` ×${data.repeatCount}` : ""}`);\n      });';
    if (!text.includes(giftBefore)) throw new Error("TikTok Gift-Combo Marker fehlt.");
    text = text.replace(giftBefore, giftAfter);

    const socialBefore = '      this.client.on?.("social", (data) => { const user = userFrom(data); this.emitEvent("social", data, `${user.nickname} hat eine soziale Aktion ausgelöst`); });';
    const socialAfter = '      this.client.on?.("social", (data) => { const user = userFrom(data); const raw = String(data?.displayType || data?.label || data?.action || "").toLowerCase(); const type = raw.includes("follow") ? "follow" : raw.includes("share") ? "share" : "social"; const label = type === "follow" ? "folgt jetzt" : type === "share" ? "hat den LIVE geteilt" : "hat eine soziale Aktion ausgelöst"; this.emitEvent(type, data, `${user.nickname} ${label}`); });';
    if (!text.includes(socialBefore)) throw new Error("TikTok Social-Event Marker fehlt.");
    text = text.replace(socialBefore, socialAfter);
    write(file, text);
  }
}

console.log("TikTok LIVE ist im normalen Chat sichtbar: MOD-Button, LIVE-Zähler, Filterzugriff und Gift-Combo-Schutz aktiv.");
