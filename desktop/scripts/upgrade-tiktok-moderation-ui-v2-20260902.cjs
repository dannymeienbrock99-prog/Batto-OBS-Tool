"use strict";

const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const file = (relative) => path.join(root, relative);
const read = (relative) => fs.readFileSync(file(relative), "utf8");
const write = (relative, value) => { fs.mkdirSync(path.dirname(file(relative)), { recursive: true }); fs.writeFileSync(file(relative), value, "utf8"); };
const marker = "BATTO_TIKTOK_MOD_UI_V2";

// Upgrade the generated TikTok moderation controller. This runs after the base
// moderation patch and the visible-chat patch so it modifies the real published UI.
{
  const target = "src/renderer/tiktok-moderation.js";
  let text = read(target);
  if (!text.includes(marker)) {
    text = text.replace(
      '  let menu = null;',
      '  let menu = null;\n  // ' + marker
    );

    text = text.replace(
      '  function localWords(){ return val("ttmod-local-filter").split(/[,\\n]/).map((x)=>x.trim().toLowerCase()).filter(Boolean); }\n  function applyLocalFilter(){ const words=localWords(); host.querySelectorAll("#chat-body .chat-row").forEach((row)=>{const text=String(row.querySelector(".chat-message")?.textContent||"").toLowerCase();row.classList.toggle("tiktok-filtered",words.some((word)=>text.includes(word)));}); }\n  function saveLocalFilter(){ set("localFilter", val("ttmod-local-filter")); applyLocalFilter(); }',
      '  function localWords(){ return val("ttmod-local-filter").split(/[,\\n]/).map((x)=>x.trim().toLowerCase()).filter(Boolean); }\n  function filterEnabled(){ return get("filterEnabled","1") === "1"; }\n  function filterMode(){ return get("filterMode","hide"); }\n  function applyLocalFilter(){ const words=localWords(); const enabled=filterEnabled(); const mode=filterMode(); host.querySelectorAll("#chat-body .chat-row").forEach((row)=>{const isTikTok=Array.from(row.querySelectorAll(".chat-role")).some((n)=>n.textContent.trim()==="TikTok");if(!isTikTok)return;const message=row.querySelector(".chat-message");if(!message)return;const original=message.dataset.ttOriginal || message.textContent || "";if(!message.dataset.ttOriginal)message.dataset.ttOriginal=original;const matched=enabled&&words.length>0&&words.some((word)=>String(original).toLowerCase().includes(word));row.classList.toggle("tiktok-filtered",matched&&mode==="hide");if(mode==="mask"&&matched){message.textContent="••• Nachricht durch Chat-Filter ausgeblendet •••";message.classList.add("tiktok-masked")}else{if(message.dataset.ttOriginal!==undefined)message.textContent=message.dataset.ttOriginal;message.classList.remove("tiktok-masked")}}); }\n  function saveLocalFilter(){ set("localFilter", val("ttmod-local-filter")); set("filterEnabled", el("ttmod-filter-enabled")?.checked ? "1" : "0"); set("filterMode", val("ttmod-filter-mode")||"hide"); applyLocalFilter(); }'
    );

    const insertBeforeBind = '  function bind(){';
    if (!text.includes(insertBeforeBind)) throw new Error("TikTok MOD V2: bind Marker fehlt.");
    const helpers = String.raw`  function normalizeModeratorName(value){ const clean=String(value||"").trim().replace(/^@+/,""); return clean ? "@"+clean : ""; }
  function moderatorStatusText(){ const name=normalizeModeratorName(get("moderatorName")); return name ? "Mod-Konto "+name : "Kein Mod-Konto eingetragen"; }
  function ensureAdvancedControls(){
    const panel=el("ttmod-panel"); if(!panel||el("ttmod-account-box"))return;
    const grid=panel.querySelector(".tiktok-mod-grid"); if(!grid)return;
    const account=document.createElement("section"); account.id="ttmod-account-box"; account.className="tiktok-mod-subsection wide";
    account.innerHTML='<div class="tiktok-mod-subhead"><div><strong>Moderator-Konto</strong><small>TikTok-Anmeldename des verwendeten Moderator-Kontos.</small></div><span id="ttmod-account-status" class="tiktok-mod-account-status"></span></div><div class="tiktok-mod-inline"><label>TikTok-Name<input id="ttmod-login-name" placeholder="@deinname" value="'+esc(normalizeModeratorName(get("moderatorName")))+'"></label><button id="ttmod-login-save" type="button">Mod-Namen speichern</button></div>';
    grid.prepend(account);

    const filter=document.createElement("section"); filter.id="ttmod-filter-box"; filter.className="tiktok-mod-subsection wide";
    filter.innerHTML='<div class="tiktok-mod-subhead"><div><strong>Chat-Filter</strong><small>Eigene lokale Filtereinstellung nur für TikTok-Nachrichten.</small></div></div><div class="tiktok-filter-settings"><label class="check-line"><input id="ttmod-filter-enabled" type="checkbox"> Filter aktiv</label><label>Treffer behandeln<select id="ttmod-filter-mode"><option value="hide">Nachricht ausblenden</option><option value="mask">Nachricht zensieren</option></select></label></div>';
    const filterLabel=el("ttmod-local-filter")?.closest("label"); if(filterLabel)filter.append(filterLabel);
    const buttons=document.createElement("div");buttons.className="tiktok-mod-actions";buttons.innerHTML='<button id="ttmod-filter-save" type="button">Chat-Filter speichern</button><button id="ttmod-filter-clear" type="button">Filter leeren</button>';filter.append(buttons);
    const resultNode=el("ttmod-result"); if(resultNode)grid.insertBefore(filter,resultNode); else grid.append(filter);

    const lists=document.createElement("section"); lists.id="ttmod-lists-box"; lists.className="tiktok-mod-subsection wide";
    lists.innerHTML='<div class="tiktok-mod-subhead"><div><strong>Moderationslisten</strong><small>Gesperrte und stummgeschaltete Nutzer jeweils in einem eigenen Fenster.</small></div></div><div class="tiktok-mod-actions"><button id="ttmod-open-mutes" type="button">🔇 Stummgeschaltete öffnen</button><button id="ttmod-open-bans" type="button">⛔ Gesperrte öffnen</button></div>';
    if(resultNode)grid.insertBefore(lists,resultNode); else grid.append(lists);

    el("ttmod-account-status").textContent=moderatorStatusText();
    el("ttmod-filter-enabled").checked=get("filterEnabled","1")==="1";
    el("ttmod-filter-mode").value=get("filterMode","hide");
    el("ttmod-login-save").onclick=()=>{const name=normalizeModeratorName(val("ttmod-login-name"));set("moderatorName",name);el("ttmod-login-name").value=name;el("ttmod-account-status").textContent=moderatorStatusText();result(name?"Moderator-Konto gespeichert: "+name:"Moderator-Konto entfernt.")};
    el("ttmod-filter-save").onclick=()=>{saveLocalFilter();result("Chat-Filter gespeichert.")};
    el("ttmod-filter-clear").onclick=()=>{el("ttmod-local-filter").value="";saveLocalFilter();result("Chat-Filter geleert.")};
    el("ttmod-filter-enabled").onchange=saveLocalFilter; el("ttmod-filter-mode").onchange=saveLocalFilter;
    el("ttmod-open-mutes").onclick=()=>{rememberIds();call("tiktok:open-list-window",{type:"mutes",roomId:val("ttmod-room")}).catch(fail)};
    el("ttmod-open-bans").onclick=()=>{rememberIds();call("tiktok:open-list-window",{type:"bans",roomId:val("ttmod-room")}).catch(fail)};
    applyLocalFilter();
  }
  function moderatorArray(data){const values=[data,data?.response,data?.response?.moderators,data?.response?.items,data?.moderators,data?.items,data?.data];return values.find(Array.isArray)||[];}
  async function checkModerator(message){rememberIds();const data=await call("tiktok:list-moderators",ids());const id=String(message?.userId||"");const name=String(message?.username||"").replace(/^@/,"").toLowerCase();const found=moderatorArray(data).some((item)=>String(item?.user_id??item?.userId??item?.id??"")===id || String(item?.unique_id??item?.uniqueId??item?.username??"").replace(/^@/,"").toLowerCase()===name);result((message.username||id)+(found?" ist Moderator.":" ist kein Moderator."));return found;}
`;
    text = text.replace(insertBeforeBind, helpers + insertBeforeBind);

    text = text.replace(
      '    el("ttmod-list-mutes").onclick=()=>action("tiktok:list-mutes").catch(()=>{});\n    el("ttmod-list-bans").onclick=()=>action("tiktok:list-bans").catch(()=>{});',
      '    el("ttmod-list-mutes").onclick=()=>{rememberIds();call("tiktok:open-list-window",{type:"mutes",roomId:val("ttmod-room")}).catch(fail)};\n    el("ttmod-list-bans").onclick=()=>{rememberIds();call("tiktok:open-list-window",{type:"bans",roomId:val("ttmod-room")}).catch(fail)};'
    );

    text = text.replace(
      '    refreshStatus(); applyLocalFilter();',
      '    ensureAdvancedControls(); refreshStatus(); applyLocalFilter();'
    );
    text = text.replace(
      'else settings.append(panel); bind();',
      'else settings.append(panel); bind(); ensureAdvancedControls();'
    );

    const menuStart = text.indexOf('  function openMenu(event,message)');
    const rowsStart = text.indexOf('  function bindRows()', menuStart);
    if (menuStart < 0 || rowsStart < 0) throw new Error("TikTok MOD V2: Kontextmenü-Marker fehlt.");
    const newMenu = String.raw`  function openMenu(event,message){
    closeMenu(); menu=document.createElement("div"); menu.className="tiktok-context-menu";
    const title=document.createElement("div");title.className="tiktok-context-title";title.textContent=(message.username?"@"+String(message.username).replace(/^@/,""):"TikTok Nutzer")+" · "+String(message.userId||"");menu.append(title);
    const actions=[["🔇 5 Min. stummschalten","tiktok:mute",{duration:"300"}],["🔊 Stumm aufheben","tiktok:unmute",{}],["⛔ Nutzer sperren","tiktok:ban",{}],["✅ Sperre aufheben","tiktok:unban",{}],["🛡 Moderator hinzufügen","tiktok:add-moderator",{}],["➖ Moderator entfernen","tiktok:remove-moderator",{}]];
    for(const [label,channel,extra] of actions){const b=document.createElement("button");b.textContent=label;b.onclick=async()=>{try{const payload={...userPayload(message),...extra};await call(channel,payload);result(label+" · "+(message.username||message.userId));closeMenu()}catch(e){fail(e)}};menu.append(b)}
    const status=document.createElement("button");status.textContent="ℹ Moderator-Status prüfen";status.onclick=()=>checkModerator(message).then(closeMenu).catch(fail);menu.append(status);
    const copyName=document.createElement("button");copyName.textContent="@Name kopieren";copyName.onclick=()=>{navigator.clipboard?.writeText("@"+String(message.username||"").replace(/^@/,""));closeMenu()};menu.append(copyName);
    const copy=document.createElement("button");copy.textContent="User-ID kopieren";copy.onclick=()=>{navigator.clipboard?.writeText(String(message.userId||""));closeMenu()};menu.append(copy);
    document.body.append(menu);menu.style.left=Math.min(event.clientX,window.innerWidth-240)+"px";menu.style.top=Math.min(event.clientY,window.innerHeight-360)+"px";
  }
`;
    text = text.slice(0, menuStart) + newMenu + text.slice(rowsStart);

    const bindRowsStart = text.indexOf('  function bindRows()');
    const nextMessages = text.indexOf('  if(typeof api.onChatMessages', bindRowsStart);
    if (bindRowsStart < 0 || nextMessages < 0) throw new Error("TikTok MOD V2: bindRows Marker fehlt.");
    const newBindRows = String.raw`  function bindRows(){
    host.querySelectorAll("#chat-body .chat-row:not([data-ttmod-bound])").forEach((row)=>{
      row.dataset.ttmodBound="1";const role=Array.from(row.querySelectorAll(".chat-role")).some((n)=>n.textContent.trim()==="TikTok");if(!role)return;
      const userNode=row.querySelector(".chat-user");if(!userNode)return;userNode.classList.add("tiktok-mod-user");userNode.title="Rechtsklick: TikTok Moderation";
      userNode.addEventListener("contextmenu",(event)=>{event.preventDefault();event.stopPropagation();const username=userNode.textContent?.trim()||"";const messageText=row.querySelector(".chat-message")?.dataset.ttOriginal||row.querySelector(".chat-message")?.textContent?.trim()||"";const message=[...recent].reverse().find((m)=>m.platform==="tiktok"&&String(m.username||"")===username&&String(m.message||"")===messageText)||[...recent].reverse().find((m)=>m.platform==="tiktok"&&String(m.username||"")===username);if(!message?.userId){result("Für @"+username.replace(/^@/,"")+" wurde keine numerische TikTok User-ID geliefert.");return}el("ttmod-user")&&(el("ttmod-user").value=String(message.userId));openMenu(event,message)});
    });applyLocalFilter();
  }
`;
    text = text.slice(0, bindRowsStart) + newBindRows + text.slice(nextMessages);
    write(target, text);
  }
}

// Dedicated user-list windows. They use the same hardened preload and moderation
// IPC API, but bans and mutes are deliberately separate windows.
write("src/renderer/tiktok-moderation-list.html", `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TikTok Moderation</title><link rel="stylesheet" href="./tiktok-moderation-list.css"></head><body><header><div><span class="eyebrow">TIKTOK MODERATION</span><h1 id="title">Nutzerliste</h1><p id="subtitle"></p></div><button id="refresh">Aktualisieren</button></header><main><div id="status" class="status">Lade …</div><section id="list" class="list"></section></main><script src="./tiktok-moderation-list.js"></script></body></html>`);
write("src/renderer/tiktok-moderation-list.css", `:root{color-scheme:dark;font-family:Inter,Segoe UI,Arial,sans-serif;background:#080d14;color:#eef5fb}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top right,#17304a 0,#080d14 45%);min-height:100vh}header{position:sticky;top:0;z-index:2;display:flex;justify-content:space-between;align-items:center;gap:16px;padding:20px 22px;border-bottom:1px solid #243243;background:#0a111bcc;backdrop-filter:blur(16px)}h1{margin:3px 0 2px;font-size:22px}p{margin:0;color:#91a4b8;font-size:12px}.eyebrow{font-size:10px;letter-spacing:.18em;color:#54d8ff}button{border:1px solid #34506b;border-radius:7px;background:#132132;color:#eaf6ff;padding:8px 12px;cursor:pointer}button:hover{background:#1b3048}.status{margin:18px 22px;padding:11px 13px;border:1px solid #26384b;border-radius:8px;background:#0c151f;color:#9fb1c4;font-size:12px}.list{display:grid;gap:9px;padding:0 22px 24px}.user{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center;padding:12px 14px;border:1px solid #26384b;border-radius:10px;background:#0d1621}.user strong{display:block;font-size:13px}.user small{display:block;margin-top:4px;color:#879aaf}.user button{border-color:#713944;color:#ffafb7}.empty{padding:32px;text-align:center;color:#8598ad;border:1px dashed #2c4054;border-radius:10px}`);
write("src/renderer/tiktok-moderation-list.js", String.raw`"use strict";
(() => {
  const api=window.batto;const params=new URLSearchParams(location.search);const type=params.get("type")==="bans"?"bans":"mutes";const roomId=params.get("roomId")||"";
  const title=document.getElementById("title"),sub=document.getElementById("subtitle"),list=document.getElementById("list"),status=document.getElementById("status");
  title.textContent=type==="bans"?"Gesperrte Nutzer":"Stummgeschaltete Nutzer";sub.textContent=roomId?"Room-ID: "+roomId:"Keine Room-ID übergeben";
  const arrayOf=(data)=>[data,data?.response,data?.response?.items,data?.response?.users,data?.items,data?.users,data?.data].find(Array.isArray)||[];
  const idOf=(x)=>String(x?.user_id??x?.userId??x?.tiktok_user_id??x?.id??"");const nameOf=(x)=>String(x?.unique_id??x?.uniqueId??x?.username??x?.nickname??x?.display_name??"TikTok Nutzer");
  async function load(){try{if(!roomId)throw new Error("Room-ID fehlt.");status.textContent="Aktualisiere …";const data=await api.invoke(type==="bans"?"tiktok:list-bans":"tiktok:list-mutes",{roomId});const items=arrayOf(data);list.innerHTML="";if(!items.length){list.innerHTML='<div class="empty">Keine Einträge gefunden.</div>'}for(const item of items){const id=idOf(item),name=nameOf(item);const row=document.createElement("article");row.className="user";row.innerHTML='<div><strong>'+name.replaceAll("<","&lt;")+'</strong><small>User-ID: '+id.replaceAll("<","&lt;")+'</small></div><button type="button">'+(type==="bans"?"Freigeben":"Stumm aufheben")+'</button>';row.querySelector("button").onclick=async()=>{try{await api.invoke(type==="bans"?"tiktok:unban":"tiktok:unmute",{roomId,userId:id});await load()}catch(e){status.textContent="Fehler: "+String(e?.message||e)}};list.append(row)}status.textContent=items.length+" Einträge"}catch(e){status.textContent="Fehler: "+String(e?.message||e);list.innerHTML=""}}
  document.getElementById("refresh").onclick=load;load();
})();`));

// Open the mute/ban lists as real Electron windows.
{
  const target = "src/main.cjs";
  let text = read(target);
  if (!text.includes("openTikTokModerationListWindow")) {
    const before = "function currentState() {";
    if (!text.includes(before)) throw new Error("TikTok MOD V2: main helper Marker fehlt.");
    const helper = `function openTikTokModerationListWindow(input = {}) {\n  const type = input.type === "bans" ? "bans" : "mutes";\n  const roomId = String(input.roomId || "").trim();\n  if (!roomId) throw new Error("Room-ID fehlt für die TikTok-Moderationsliste.");\n  const child = new BrowserWindow({ width: 720, height: 760, minWidth: 560, minHeight: 480, parent: mainWindow || undefined, title: type === "bans" ? "TikTok – Gesperrte Nutzer" : "TikTok – Stummgeschaltete Nutzer", autoHideMenuBar: true, backgroundColor: "#080d14", webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });\n  childWindows.add(child); child.on("closed", () => childWindows.delete(child));\n  child.loadFile(rendererFile("tiktok-moderation-list.html"), { query: { type, roomId } });\n  return true;\n}\n\n`;
    text = text.replace(before, helper + before);
  }
  if (!text.includes('handle("tiktok:open-list-window"')) {
    const after = '  handle("tiktok:list-bans", (payload) => eulerStreamModeration.listBans(payload));';
    if (!text.includes(after)) throw new Error("TikTok MOD V2: list-bans Handler Marker fehlt.");
    text = text.replace(after, after + '\n  handle("tiktok:open-list-window", (payload = {}) => openTikTokModerationListWindow(payload));');
  }
  write(target, text);
}

{
  const target = "src/preload.cjs";
  let text = read(target);
  if (!text.includes('"tiktok:open-list-window"')) {
    const before = '"tiktok:list-moderators", "tiktok:add-moderator", "tiktok:remove-moderator", "tiktok:toggle-comments",';
    if (!text.includes(before)) throw new Error("TikTok MOD V2: preload Marker fehlt.");
    text = text.replace(before, '"tiktok:open-list-window", ' + before);
  }
  write(target, text);
}

{
  const target = "src/renderer/tiktok-moderation.css";
  let text = read(target);
  if (!text.includes(".tiktok-mod-subsection")) text += `\n.tiktok-mod-subsection{padding:10px;border:1px solid #2b4054;border-radius:8px;background:#0b141e}.tiktok-mod-subhead{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:8px}.tiktok-mod-subhead strong{font-size:11px;color:#e7f5ff}.tiktok-mod-subhead small{display:block;margin-top:2px;color:#879caf;font-size:9px}.tiktok-mod-account-status{font-size:9px;color:#68dfff}.tiktok-mod-inline{display:grid;grid-template-columns:1fr auto;align-items:end;gap:8px}.tiktok-filter-settings{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px}.tiktok-context-title{padding:7px 9px;margin-bottom:4px;border-bottom:1px solid #29394b;color:#69dcff;font-size:10px;font-weight:800}.tiktok-mod-user{cursor:context-menu;text-decoration:underline;text-decoration-style:dotted;text-decoration-color:#35556f;text-underline-offset:2px}.tiktok-masked{font-style:italic;color:#7f91a3!important}@media(max-width:700px){.tiktok-mod-inline,.tiktok-filter-settings{grid-template-columns:1fr}}\n`;
  write(target, text);
}

const checks = [
  ["src/renderer/tiktok-moderation.js", marker],
  ["src/renderer/tiktok-moderation.js", "Moderator-Status prüfen"],
  ["src/renderer/tiktok-moderation.js", "ttmod-login-name"],
  ["src/renderer/tiktok-moderation.js", "ttmod-filter-box"],
  ["src/main.cjs", "tiktok:open-list-window"],
  ["src/preload.cjs", "tiktok:open-list-window"],
  ["src/renderer/tiktok-moderation-list.html", "Gesperrte"],
  ["src/renderer/tiktok-moderation-list.js", "tiktok:list-mutes"]
];
for (const [relative, token] of checks) if (!read(relative).includes(token)) throw new Error(`TikTok MOD V2 fehlt in ${relative}: ${token}`);
console.log("TikTok Moderation V2: Mod-@Name, Rechtsklick direkt auf Namen, Moderatorstatus, eigener Chat-Filter und getrennte Ban/Mute-Fenster eingebaut.");
