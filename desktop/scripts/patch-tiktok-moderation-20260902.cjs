"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const file = (relative) => path.join(root, relative);
const read = (relative) => fs.readFileSync(file(relative), "utf8");
const write = (relative, value) => {
  fs.mkdirSync(path.dirname(file(relative)), { recursive: true });
  fs.writeFileSync(file(relative), value, "utf8");
};

function replaceRequired(text, before, after, label) {
  if (text.includes(after)) return text;
  if (!text.includes(before)) throw new Error(`${label}: Marker fehlt.`);
  return text.replace(before, after);
}

const service = String.raw`"use strict";

const TOKEN_KEY = "tiktok-euler-oauth-access-token";
const REQUIRED_SCOPES = Object.freeze([
  "webcast:fetch",
  "webcast:mute",
  "webcast:ban",
  "webcast:comments",
  "webcast:moderators",
  "webcast:sensitive_words",
  "user:info"
]);

function required(value, name) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(name + " fehlt.");
  return text;
}

function optional(value) {
  const text = String(value ?? "").trim();
  return text || "";
}

function errorMessage(data, fallback) {
  if (data && typeof data === "object") {
    return String(data.message || data.error_description || data.error || fallback || "EulerStream-Anfrage fehlgeschlagen.");
  }
  return String(fallback || data || "EulerStream-Anfrage fehlgeschlagen.");
}

class EulerStreamModeration {
  constructor(options = {}) {
    this.secretStore = options.secretStore;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.baseUrl = String(options.baseUrl || "https://tiktok.eulerstream.com").replace(/\/$/, "");
    if (!this.secretStore) throw new Error("SecretStore fehlt für TikTok-Moderation.");
    if (typeof this.fetchImpl !== "function") throw new Error("Fetch ist für TikTok-Moderation nicht verfügbar.");
  }

  async status() {
    return {
      configured: await this.secretStore.has(TOKEN_KEY),
      baseUrl: this.baseUrl,
      requiredScopes: [...REQUIRED_SCOPES],
      authentication: "oauth",
      cookieAuthEnabled: false,
      premiumModeration: true
    };
  }

  async saveToken(token) {
    const value = required(token, "EulerStream OAuth-Token");
    if (value.length < 16) throw new Error("EulerStream OAuth-Token ist zu kurz.");
    await this.secretStore.set(TOKEN_KEY, value);
    return this.status();
  }

  async clearToken() {
    await this.secretStore.delete(TOKEN_KEY);
    return this.status();
  }

  async request(method, pathname, query = {}) {
    const token = await this.secretStore.get(TOKEN_KEY);
    if (!token) throw new Error("TikTok-Moderation benötigt eine EulerStream OAuth-Anmeldung mit den Moderations-Scopes.");
    const url = new URL(pathname, this.baseUrl);
    for (const [key, value] of Object.entries(query || {})) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, String(value));
    }
    let response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          accept: "application/json",
          "x-oauth-token": token
        }
      });
    } catch (error) {
      throw new Error("EulerStream ist nicht erreichbar: " + String(error?.message || error));
    }
    const raw = await response.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { message: raw }; }
    const apiCode = Number(data?.code);
    if (!response.ok || (Number.isFinite(apiCode) && apiCode !== 0)) {
      const message = errorMessage(data, "HTTP " + response.status);
      throw new Error("EulerStream Moderation: " + message);
    }
    return data;
  }

  mute(input = {}) {
    const duration = String(input.duration ?? "300");
    if (!["-1", "5", "30", "60", "300"].includes(duration)) throw new Error("Ungültige Stummschalt-Dauer.");
    return this.request("PUT", "/webcast/rooms/" + encodeURIComponent(required(input.roomId, "Room-ID")) + "/moderation/mutes", {
      user_id: required(input.userId, "TikTok User-ID"),
      duration,
      comment_msg_id: optional(input.commentMsgId)
    });
  }

  unmute(input = {}) {
    return this.request("DELETE", "/webcast/rooms/" + encodeURIComponent(required(input.roomId, "Room-ID")) + "/moderation/mutes", {
      user_id: required(input.userId, "TikTok User-ID")
    });
  }

  listMutes(input = {}) {
    return this.request("GET", "/webcast/rooms/" + encodeURIComponent(required(input.roomId, "Room-ID")) + "/moderation/mutes", {
      page: Number.isFinite(Number(input.page)) ? Math.max(0, Number(input.page)) : 0
    });
  }

  ban(input = {}) {
    return this.request("PUT", "/webcast/rooms/" + encodeURIComponent(required(input.roomId, "Room-ID")) + "/moderation/bans", {
      tiktok_user_id: required(input.userId, "TikTok User-ID"),
      comment_msg_id: optional(input.commentMsgId)
    });
  }

  unban(input = {}) {
    return this.request("DELETE", "/webcast/rooms/" + encodeURIComponent(required(input.roomId, "Room-ID")) + "/moderation/bans", {
      tiktok_user_id: required(input.userId, "TikTok User-ID")
    });
  }

  listBans(input = {}) {
    return this.request("GET", "/webcast/rooms/" + encodeURIComponent(required(input.roomId, "Room-ID")) + "/moderation/bans", {
      page: Number.isFinite(Number(input.page)) ? Math.max(0, Number(input.page)) : 0
    });
  }

  listModerators(input = {}) {
    return this.request("GET", "/webcast/anchors/" + encodeURIComponent(required(input.anchorId, "Anchor-ID")) + "/moderation/moderators");
  }

  addModerator(input = {}) {
    return this.request("PUT", "/webcast/anchors/" + encodeURIComponent(required(input.anchorId, "Anchor-ID")) + "/moderation/moderators", {
      to_user_id: required(input.userId, "TikTok User-ID")
    });
  }

  removeModerator(input = {}) {
    return this.request("DELETE", "/webcast/anchors/" + encodeURIComponent(required(input.anchorId, "Anchor-ID")) + "/moderation/moderators", {
      to_user_id: required(input.userId, "TikTok User-ID")
    });
  }

  toggleComments(input = {}) {
    return this.request("POST", "/webcast/rooms/" + encodeURIComponent(required(input.roomId, "Room-ID")) + "/moderation/toggle_comments", {
      enabled: input.enabled === true || String(input.enabled).toLowerCase() === "true"
    });
  }

  listSensitiveWords(input = {}) {
    return this.request("GET", "/webcast/rooms/" + encodeURIComponent(required(input.roomId, "Room-ID")) + "/moderation/sensitive-words", {
      sec_anchor_id: required(input.secAnchorId, "Sec-Anchor-ID")
    });
  }

  addSensitiveWord(input = {}) {
    const word = required(input.word, "Filterwort");
    if (word.length > 100) throw new Error("Filterwort ist zu lang.");
    return this.request("POST", "/webcast/rooms/" + encodeURIComponent(required(input.roomId, "Room-ID")) + "/moderation/sensitive-words", {
      word,
      sec_anchor_id: required(input.secAnchorId, "Sec-Anchor-ID")
    });
  }

  deleteSensitiveWord(input = {}) {
    return this.request("DELETE", "/webcast/rooms/" + encodeURIComponent(required(input.roomId, "Room-ID")) + "/moderation/sensitive-words", {
      word_id: required(input.wordId, "Filterwort-ID"),
      sec_anchor_id: required(input.secAnchorId, "Sec-Anchor-ID")
    });
  }
}

module.exports = { EulerStreamModeration, REQUIRED_SCOPES, TOKEN_KEY };
`;
write("src/services/eulerstream-moderation.cjs", service);

// Backend-only moderation client + explicit IPC endpoints.
{
  let text = read("src/main.cjs");
  if (!text.includes('require("./services/eulerstream-moderation.cjs")')) {
    const marker = 'const { StreamDeckRuntime } = require("./services/streamdeck-runtime.cjs");';
    const fallback = 'const { ActionExecutor } = require("./services/action-executor.cjs");';
    if (text.includes(marker)) text = text.replace(marker, marker + '\nconst { EulerStreamModeration } = require("./services/eulerstream-moderation.cjs");');
    else text = replaceRequired(text, fallback, fallback + '\nconst { EulerStreamModeration } = require("./services/eulerstream-moderation.cjs");', "TikTok moderation require");
  }
  if (!text.includes("let eulerStreamModeration = null;")) {
    text = replaceRequired(text, "let streamDeckRuntime = null;", "let streamDeckRuntime = null;\nlet eulerStreamModeration = null;", "TikTok moderation variable");
  }
  if (!text.includes("new EulerStreamModeration")) {
    text = replaceRequired(text, "await streamDeckRuntime.start();", "await streamDeckRuntime.start();\n  eulerStreamModeration = new EulerStreamModeration({ secretStore });", "TikTok moderation init");
  }
  if (!text.includes('handle("tiktok:moderation-status"')) {
    const marker = '  handle("streamdeck:open-inspector", (payload) => streamDeckRuntime.openInspector(payload));';
    const handlers = [
      '  handle("tiktok:moderation-status", () => eulerStreamModeration.status());',
      '  handle("tiktok:oauth-save", (payload = {}) => eulerStreamModeration.saveToken(payload.token));',
      '  handle("tiktok:oauth-clear", () => eulerStreamModeration.clearToken());',
      '  handle("tiktok:mute", (payload) => eulerStreamModeration.mute(payload));',
      '  handle("tiktok:unmute", (payload) => eulerStreamModeration.unmute(payload));',
      '  handle("tiktok:list-mutes", (payload) => eulerStreamModeration.listMutes(payload));',
      '  handle("tiktok:ban", (payload) => eulerStreamModeration.ban(payload));',
      '  handle("tiktok:unban", (payload) => eulerStreamModeration.unban(payload));',
      '  handle("tiktok:list-bans", (payload) => eulerStreamModeration.listBans(payload));',
      '  handle("tiktok:list-moderators", (payload) => eulerStreamModeration.listModerators(payload));',
      '  handle("tiktok:add-moderator", (payload) => eulerStreamModeration.addModerator(payload));',
      '  handle("tiktok:remove-moderator", (payload) => eulerStreamModeration.removeModerator(payload));',
      '  handle("tiktok:toggle-comments", (payload) => eulerStreamModeration.toggleComments(payload));',
      '  handle("tiktok:list-sensitive-words", (payload) => eulerStreamModeration.listSensitiveWords(payload));',
      '  handle("tiktok:add-sensitive-word", (payload) => eulerStreamModeration.addSensitiveWord(payload));',
      '  handle("tiktok:delete-sensitive-word", (payload) => eulerStreamModeration.deleteSensitiveWord(payload));'
    ].join("\n");
    text = replaceRequired(text, marker, handlers + "\n" + marker, "TikTok moderation IPC");
  }
  write("src/main.cjs", text);
}

// Renderer may invoke only these explicit moderation channels; the OAuth token never comes back to the renderer.
{
  let text = read("src/preload.cjs");
  if (!text.includes('"tiktok:moderation-status"')) {
    const marker = '"streamdeck:open-inspector", "streamdeck:execute", "app:choose-path",';
    const channels = '"tiktok:moderation-status", "tiktok:oauth-save", "tiktok:oauth-clear",\n  "tiktok:mute", "tiktok:unmute", "tiktok:list-mutes", "tiktok:ban", "tiktok:unban", "tiktok:list-bans",\n  "tiktok:list-moderators", "tiktok:add-moderator", "tiktok:remove-moderator", "tiktok:toggle-comments",\n  "tiktok:list-sensitive-words", "tiktok:add-sensitive-word", "tiktok:delete-sensitive-word",\n  ';
    text = replaceRequired(text, marker, channels + marker, "TikTok moderation preload channels");
  }
  write("src/preload.cjs", text);
}

const moderationCss = String.raw`
.tiktok-mod-section{border-color:#39424f!important}.tiktok-mod-head{display:flex;align-items:center;justify-content:space-between;gap:10px}.tiktok-mod-status{font-size:10px;color:#91a3b7}.tiktok-mod-status.on{color:#61e59a}.tiktok-mod-grid{display:grid;grid-template-columns:repeat(2,minmax(150px,1fr));gap:8px}.tiktok-mod-grid .wide{grid-column:1/-1}.tiktok-mod-grid label{display:grid;gap:4px}.tiktok-mod-actions{display:flex;gap:6px;flex-wrap:wrap}.tiktok-mod-actions button{font-size:10px}.tiktok-mod-danger{border-color:#713944!important;color:#ff9aa5!important}.tiktok-mod-result{max-height:170px;margin:6px 0 0;padding:8px;overflow:auto;border:1px solid #263342;border-radius:6px;background:#090f16;color:#b9c6d5;font:10px/1.4 ui-monospace,Consolas,monospace;white-space:pre-wrap}.tiktok-word-list{display:flex;gap:5px;flex-wrap:wrap;margin-top:6px}.tiktok-word-chip{display:flex;align-items:center;gap:5px;padding:4px 6px;border:1px solid #334455;border-radius:999px;background:#101923;font-size:10px}.tiktok-word-chip button{padding:1px 5px}.tiktok-context-menu{position:fixed;z-index:99999;display:grid;min-width:205px;padding:5px;border:1px solid #40536a;border-radius:8px;background:#0d141e;box-shadow:0 18px 50px #000c}.tiktok-context-menu button{padding:7px 9px;border:0;border-radius:5px;text-align:left;background:transparent}.tiktok-context-menu button:hover{background:#1b2a3a}.tiktok-filtered{display:none!important}@media(max-width:800px){.tiktok-mod-grid{grid-template-columns:1fr}.tiktok-mod-grid .wide{grid-column:auto}}
`;
write("src/renderer/tiktok-moderation.css", moderationCss.trimStart());

const moderationJs = String.raw`"use strict";
(() => {
  const api = window.batto;
  const host = document.getElementById("multi-chat-root");
  if (!api?.invoke || !host) return;
  const key = "batto.tiktok.moderation.";
  let recent = [];
  let menu = null;
  const esc = (v) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const get = (name, fallback = "") => localStorage.getItem(key + name) ?? fallback;
  const set = (name, value) => localStorage.setItem(key + name, String(value ?? ""));
  const call = (channel, payload = {}) => api.invoke(channel, payload);
  const el = (id) => host.querySelector("#" + id);
  const val = (id) => String(el(id)?.value ?? "").trim();
  const ids = () => ({ roomId: val("ttmod-room"), anchorId: val("ttmod-anchor"), secAnchorId: val("ttmod-sec-anchor") });
  function rememberIds(){ set("roomId", val("ttmod-room")); set("anchorId", val("ttmod-anchor")); set("secAnchorId", val("ttmod-sec-anchor")); }
  function result(value){ const node = el("ttmod-result"); if (node) node.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2); }
  function fail(error){ result("Fehler: " + String(error?.message || error)); }
  function userPayload(message = {}) { return { ...ids(), userId: String(message.userId || message.user?.id || val("ttmod-user") || ""), commentMsgId: String(message.metadata?.commentMsgId || message.commentMsgId || val("ttmod-comment") || "") }; }
  function localWords(){ return val("ttmod-local-filter").split(/[,\n]/).map((x)=>x.trim().toLowerCase()).filter(Boolean); }
  function applyLocalFilter(){ const words=localWords(); host.querySelectorAll("#chat-body .chat-row").forEach((row)=>{const text=String(row.querySelector(".chat-message")?.textContent||"").toLowerCase();row.classList.toggle("tiktok-filtered",words.some((word)=>text.includes(word)));}); }
  function saveLocalFilter(){ set("localFilter", val("ttmod-local-filter")); applyLocalFilter(); }
  function findWordArray(data){ const candidates=[data,data?.response,data?.response?.words,data?.response?.items,data?.words,data?.items,data?.data]; return candidates.find(Array.isArray) || []; }
  function renderWords(data){ const list=el("ttmod-word-list"); if(!list)return;const items=findWordArray(data);list.innerHTML=items.map((item)=>{const id=item?.id??item?.word_id??item?.wordId??"";const word=item?.word??item?.text??item?.keyword??String(item);return '<span class="tiktok-word-chip">'+esc(word)+(id?'<button type="button" data-word-id="'+esc(id)+'">×</button>':'')+'</span>';}).join("");list.querySelectorAll("[data-word-id]").forEach((button)=>button.onclick=async()=>{try{rememberIds();await call("tiktok:delete-sensitive-word",{...ids(),wordId:button.dataset.wordId});await loadWords()}catch(e){fail(e)}});result(data); }
  async function loadWords(){ rememberIds(); const data=await call("tiktok:list-sensitive-words",ids()); renderWords(data); }
  async function refreshStatus(){ try{const s=await call("tiktok:moderation-status");const node=el("ttmod-status");if(node){node.textContent=s.configured?"OAuth verbunden":"OAuth nicht eingerichtet";node.classList.toggle("on",!!s.configured)}return s}catch(e){fail(e)} }
  async function action(channel,payload={}){try{rememberIds();const data=await call(channel,{...ids(),...payload});result(data);return data}catch(e){fail(e);throw e}}
  function bind(){
    ["ttmod-room","ttmod-anchor","ttmod-sec-anchor"].forEach((id)=>el(id)?.addEventListener("change",rememberIds));
    el("ttmod-token-save").onclick=async()=>{try{const token=val("ttmod-token");const data=await call("tiktok:oauth-save",{token});el("ttmod-token").value="";result(data);await refreshStatus()}catch(e){fail(e)}};
    el("ttmod-token-clear").onclick=async()=>{try{result(await call("tiktok:oauth-clear"));await refreshStatus()}catch(e){fail(e)}};
    el("ttmod-mute").onclick=()=>action("tiktok:mute",{userId:val("ttmod-user"),commentMsgId:val("ttmod-comment"),duration:val("ttmod-duration")}).catch(()=>{});
    el("ttmod-unmute").onclick=()=>action("tiktok:unmute",{userId:val("ttmod-user")}).catch(()=>{});
    el("ttmod-ban").onclick=()=>action("tiktok:ban",{userId:val("ttmod-user"),commentMsgId:val("ttmod-comment")}).catch(()=>{});
    el("ttmod-unban").onclick=()=>action("tiktok:unban",{userId:val("ttmod-user")}).catch(()=>{});
    el("ttmod-add-mod").onclick=()=>action("tiktok:add-moderator",{userId:val("ttmod-user")}).catch(()=>{});
    el("ttmod-remove-mod").onclick=()=>action("tiktok:remove-moderator",{userId:val("ttmod-user")}).catch(()=>{});
    el("ttmod-comments-on").onclick=()=>action("tiktok:toggle-comments",{enabled:true}).catch(()=>{});
    el("ttmod-comments-off").onclick=()=>action("tiktok:toggle-comments",{enabled:false}).catch(()=>{});
    el("ttmod-list-mutes").onclick=()=>action("tiktok:list-mutes").catch(()=>{});
    el("ttmod-list-bans").onclick=()=>action("tiktok:list-bans").catch(()=>{});
    el("ttmod-list-mods").onclick=()=>action("tiktok:list-moderators").catch(()=>{});
    el("ttmod-word-add").onclick=async()=>{try{const word=val("ttmod-word");await action("tiktok:add-sensitive-word",{word});el("ttmod-word").value="";await loadWords()}catch{}};
    el("ttmod-word-load").onclick=()=>loadWords().catch(fail);
    el("ttmod-word-delete").onclick=()=>action("tiktok:delete-sensitive-word",{wordId:val("ttmod-word-id")}).then(()=>loadWords()).catch(()=>{});
    el("ttmod-local-filter").addEventListener("input",saveLocalFilter);
    refreshStatus(); applyLocalFilter();
  }
  function ensurePanel(){
    const settings=host.querySelector("#chat-settings"); if(!settings||settings.querySelector("#ttmod-panel"))return;
    const panel=document.createElement("div");panel.id="ttmod-panel";panel.className="settings-section tiktok-mod-section";
    panel.innerHTML='<div class="tiktok-mod-head"><h3>TikTok Moderation</h3><span id="ttmod-status" class="tiktok-mod-status">Prüfe OAuth …</span></div><small>Stummschalten, Sperren, Moderatoren, Kommentare und TikTok-Wortfilter laufen über EulerStream OAuth. Twitch bleibt davon unberührt und benötigt weiterhin keinen Token.</small><div class="tiktok-mod-grid"><label class="wide">EulerStream OAuth Access-Token<input id="ttmod-token" type="password" autocomplete="off" placeholder="Wird verschlüsselt im Windows SecretStore gespeichert"></label><div class="tiktok-mod-actions wide"><button id="ttmod-token-save">OAuth speichern</button><button id="ttmod-token-clear" class="tiktok-mod-danger">OAuth löschen</button></div><label>Room-ID<input id="ttmod-room" value="'+esc(get("roomId"))+'"></label><label>Anchor-ID<input id="ttmod-anchor" value="'+esc(get("anchorId"))+'"></label><label>Sec-Anchor-ID<input id="ttmod-sec-anchor" value="'+esc(get("secAnchorId"))+'"></label><label>TikTok User-ID<input id="ttmod-user" placeholder="numerische User-ID"></label><label>Kommentar-ID<input id="ttmod-comment" placeholder="optional"></label><label>Stumm-Dauer<select id="ttmod-duration"><option value="5">5 Sekunden</option><option value="30">30 Sekunden</option><option value="60">60 Sekunden</option><option value="300" selected>5 Minuten</option><option value="-1">Dauerhaft</option></select></label><div class="tiktok-mod-actions wide"><button id="ttmod-mute">Stummschalten</button><button id="ttmod-unmute">Stumm aufheben</button><button id="ttmod-ban" class="tiktok-mod-danger">Sperren</button><button id="ttmod-unban">Sperre aufheben</button><button id="ttmod-add-mod">Zum Mod machen</button><button id="ttmod-remove-mod">Mod entfernen</button></div><div class="tiktok-mod-actions wide"><button id="ttmod-comments-on">Kommentare AN</button><button id="ttmod-comments-off">Kommentare AUS</button><button id="ttmod-list-mutes">Stumme Nutzer</button><button id="ttmod-list-bans">Gesperrte Nutzer</button><button id="ttmod-list-mods">Moderatoren</button></div><label>Neues TikTok-Filterwort<input id="ttmod-word" maxlength="100"></label><label>Filterwort-ID löschen<input id="ttmod-word-id"></label><div class="tiktok-mod-actions wide"><button id="ttmod-word-add">Filterwort hinzufügen</button><button id="ttmod-word-load">TikTok-Filter laden</button><button id="ttmod-word-delete">Filterwort-ID löschen</button></div><div id="ttmod-word-list" class="tiktok-word-list wide"></div><label class="wide">Lokaler Anzeige-Filter<textarea id="ttmod-local-filter" rows="3" placeholder="Wörter mit Komma oder neuer Zeile trennen">'+esc(get("localFilter"))+'</textarea></label><pre id="ttmod-result" class="tiktok-mod-result wide">Bereit.</pre></div>';
    const finalActions=settings.querySelector(":scope > .settings-actions:last-child"); if(finalActions) settings.insertBefore(panel,finalActions); else settings.append(panel); bind();
  }
  function closeMenu(){if(menu){menu.remove();menu=null}}
  function openMenu(event,message){closeMenu();menu=document.createElement("div");menu.className="tiktok-context-menu";const actions=[["Stummschalten 5 Min.","tiktok:mute",{duration:"300"}],["Stumm aufheben","tiktok:unmute",{}],["Nutzer sperren","tiktok:ban",{}],["Sperre aufheben","tiktok:unban",{}],["Zum Moderator machen","tiktok:add-moderator",{}],["Moderator entfernen","tiktok:remove-moderator",{}]];for(const [label,channel,extra] of actions){const b=document.createElement("button");b.textContent=label;b.onclick=async()=>{try{const payload={...userPayload(message),...extra};await call(channel,payload);result(label+" ausgeführt für "+(message.username||message.userId));closeMenu()}catch(e){fail(e)}};menu.append(b)}const copy=document.createElement("button");copy.textContent="User-ID kopieren";copy.onclick=()=>{navigator.clipboard?.writeText(String(message.userId||""));closeMenu()};menu.append(copy);document.body.append(menu);menu.style.left=Math.min(event.clientX,window.innerWidth-220)+"px";menu.style.top=Math.min(event.clientY,window.innerHeight-250)+"px";}
  function bindRows(){host.querySelectorAll("#chat-body .chat-row:not([data-ttmod-bound])").forEach((row)=>{row.dataset.ttmodBound="1";const role=Array.from(row.querySelectorAll(".chat-role")).some((n)=>n.textContent.trim()==="TikTok");if(!role)return;row.addEventListener("contextmenu",(event)=>{event.preventDefault();const username=row.querySelector(".chat-user")?.textContent?.trim()||"";const text=row.querySelector(".chat-message")?.textContent?.trim()||"";const message=[...recent].reverse().find((m)=>m.platform==="tiktok"&&String(m.username||"")===username&&String(m.message||"")===text)||[...recent].reverse().find((m)=>m.platform==="tiktok"&&String(m.username||"")===username);if(!message?.userId){result("Für diese TikTok-Nachricht wurde keine numerische User-ID geliefert. Nutze die User-ID im Moderationsfeld.");return}el("ttmod-user")&&(el("ttmod-user").value=String(message.userId));openMenu(event,message)});});applyLocalFilter();}
  if(typeof api.onChatMessages==="function")api.onChatMessages((batch)=>{for(const m of batch||[])if(m?.platform==="tiktok")recent.push(m);if(recent.length>500)recent=recent.slice(-500);setTimeout(bindRows,0)});
  const observer=new MutationObserver(()=>{ensurePanel();bindRows()});observer.observe(host,{childList:true,subtree:true});ensurePanel();bindRows();document.addEventListener("click",(event)=>{if(menu&&!menu.contains(event.target))closeMenu()});window.addEventListener("blur",closeMenu);
})();
`;
write("src/renderer/tiktok-moderation.js", moderationJs);

// Load the moderation controller after the normal Multi-Chat runtime.
{
  let text = read("src/renderer/index.html");
  if (!text.includes("tiktok-moderation.css")) text = text.replace("</head>", '    <link rel="stylesheet" href="./tiktok-moderation.css">\n  </head>');
  if (!text.includes("tiktok-moderation.js")) text = text.replace("</body>", '    <script src="./tiktok-moderation.js"></script>\n  </body>');
  write("src/renderer/index.html", text);
}

// Production assertions: no cookie authentication and no OAuth token may be returned to the renderer.
{
  const main = read("src/main.cjs");
  const preload = read("src/preload.cjs");
  const ui = read("src/renderer/tiktok-moderation.js");
  if (!main.includes('handle("tiktok:mute"') || !main.includes('handle("tiktok:add-moderator"')) throw new Error("TikTok Moderations-IPC fehlt.");
  if (!preload.includes('"tiktok:moderation-status"') || !preload.includes('"tiktok:add-sensitive-word"')) throw new Error("TikTok Moderationskanäle fehlen im Preload.");
  if (!ui.includes("Zum Moderator machen") || !ui.includes("Stummschalten") || !ui.includes("TikTok-Filter")) throw new Error("TikTok Moderationsoberfläche ist unvollständig.");
  if (service.includes("x-cookie-header")) throw new Error("Cookie-Authentifizierung darf nicht in die TikTok Moderation eingebaut werden.");
}

console.log("TikTok LIVE Moderation: Mute/Unmute, Ban/Unban, Moderatoren, Kommentare, Wortfilter und verschlüsseltes OAuth-Secret eingebaut.");
