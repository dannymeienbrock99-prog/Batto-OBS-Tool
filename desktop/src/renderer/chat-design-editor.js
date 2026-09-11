"use strict";
(() => {
  const api = window.batto, design = window.BattoChatDesign, root = document.getElementById("chat-design-root");
  if (!api || !design || !root) return;
  const labels = { twitch: "Twitch", tiktok: "TikTok", youtube: "YouTube", cng: "CNG", broadcaster: "Streamer", moderator: "Moderator", vip: "VIP", subscriber: "Abonnent / Mitglied", follower: "Follower", viewer: "Zuschauer" };
  const esc = (s) => String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
  let draft = design.defaults(), platform = "twitch", dirty = false;
  const status = (message, error = false) => { const el = root.querySelector("#design-status"); el.textContent = message; el.dataset.error = String(error); };
  function fields() {
    const value = draft.platforms[platform];
    return [["nameColor", "Namensfarbe", "color"], ["secondColor", "Zweite Holo-Farbe", "color"], ["messageColor", "Nachrichtenfarbe", "color"], ["backgroundColor", "Hintergrund", "color"], ["nameSize", "Namensgröße (px)", "number", 10, 48], ["fontSize", "Textgröße (px)", "number", 10, 48], ["glow", "Leuchten (0–24)", "number", 0, 24], ["backgroundOpacity", "Hintergrunddeckkraft (0–1)", "number", 0, 1]].map(([key, label, type, min, max]) => `<label>${label}<input data-design-field="${key}" type="${type}" value="${esc(value[key])}" ${type === "number" ? `min="${min}" max="${max}" step="${key === "backgroundOpacity" ? "0.05" : "1"}"` : ""}></label>`).join("");
  }
  function render() {
    const value = draft.platforms[platform];
    root.innerHTML = `<div class="design-tabs" role="group" aria-label="Design-Plattform">${design.PLATFORMS.map((p) => `<button data-design-platform="${p}" class="${p === platform ? "active" : ""}" aria-pressed="${p === platform}">${labels[p]}</button>`).join("")}</div>
    <div class="design-layout"><article class="design-card"><h3>${labels[platform]} gestalten</h3><p class="design-note">Gilt für Hauptchat, separates Chatfenster und OBS-Chatquelle. Farben lassen sich pro Plattform, Rolle und Name festlegen.</p>
    <div class="button-row"><button data-design-preset="clean">Klar</button><button data-design-preset="holo">Hologramm</button><button data-design-preset="neon">Neon</button></div>
    <label class="design-check"><input id="design-enabled" type="checkbox" ${draft.enabled ? "checked" : ""}> Eigene Chatgestaltung verwenden</label>
    <div class="design-fields">${fields()}<label>Schriftart<select data-design-field="fontFamily">${["Segoe UI", "Arial", "Verdana", "Trebuchet MS", "Georgia", "Consolas"].map((f) => `<option ${value.fontFamily === f ? "selected" : ""}>${f}</option>`).join("")}</select></label><label>Animation<select data-design-field="animation">${[["none", "Keine"], ["flow", "Holo-Farbfluss"], ["pulse", "Sanftes Pulsieren"]].map(([key, label]) => `<option value="${key}" ${value.animation === key ? "selected" : ""}>${label}</option>`).join("")}</select></label></div>
    <label class="design-check"><input data-design-field="gradient" type="checkbox" ${value.gradient ? "checked" : ""}> Holo-Farbverlauf im Namen</label>
    <details><summary>Farben nach Rolle</summary><div class="design-roles">${design.ROLES.map((role) => `<div class="design-role"><label><input data-role-enabled="${role}" type="checkbox" ${value.roleColors[role] ? "checked" : ""}>${labels[role]}</label><input data-role-color="${role}" aria-label="${labels[role]} Farbe" type="color" value="${value.roleColors[role] || value.nameColor}"></div>`).join("")}</div></details>
    <details><summary>Farben für einzelne Namen</summary><label class="design-note">Eine Zeile pro Name: Name = #RRGGBB<textarea id="design-users" rows="4" placeholder="Crazy_Batto = #64d9ff">${esc(Object.entries(value.userColors).map(([name, color]) => `${name} = ${color}`).join("\n"))}</textarea></label></details>
    <div class="button-row"><button id="design-save" class="primary">Design speichern</button><button id="design-reset">Plattform zurücksetzen</button></div><div id="design-status" class="design-status" role="status">${dirty ? "Ungespeicherte Änderungen" : ""}</div></article>
    <article class="design-card"><h3>Live-Vorschau</h3><p class="design-note">Vorschau ohne Chatversand. Speichern übernimmt das Design in allen verbundenen Fenstern.</p><div class="design-fields"><label>Vorschauname<input id="design-preview-name" value="Crazy_Batto"></label><label>Rolle<select id="design-preview-role">${design.ROLES.map((role) => `<option value="${role}">${labels[role]}</option>`).join("")}</select></label></div><div id="design-preview" class="design-preview"></div>
    <p class="design-note">Namensregel vor Rollenfarbe vor Plattformfarbe. Holo-Effekte verändern die Darstellung in Batto und OBS. Die öffentlichen Plattformchats bestimmen ihre eigene Darstellung.</p>
    <div class="design-native"><h3>Eigene Twitch-Namensfarbe</h3><p class="design-note">Ändert die native Namensfarbe des verbundenen Twitch-Kontos. Erfordert user:manage:chat_color. Andere Chatnamen und Holo-Effekte werden dadurch nicht übertragen.</p><label>Native Twitch-Farbe<select id="design-twitch-color">${["blue", "blue_violet", "cadet_blue", "chocolate", "coral", "dodger_blue", "firebrick", "golden_rod", "green", "hot_pink", "orange_red", "red", "sea_green", "spring_green", "yellow_green"].map((c) => `<option>${c}</option>`).join("")}</select></label><button id="design-twitch-apply">Auf Twitch anwenden</button><p id="design-native-status" class="design-note" role="status"></p></div></article></div>`;
    bind(); preview();
  }
  function collect() {
    const value = draft.platforms[platform];
    root.querySelectorAll("[data-design-field]").forEach((input) => { value[input.dataset.designField] = input.type === "checkbox" ? input.checked : input.type === "number" ? Number(input.value) : input.value; });
    value.roleColors = Object.fromEntries([...root.querySelectorAll("[data-role-enabled]:checked")].map((input) => [input.dataset.roleEnabled, root.querySelector(`[data-role-color="${input.dataset.roleEnabled}"]`).value]));
    const overrides = {};
    for (const line of root.querySelector("#design-users").value.split("\n").filter((s) => s.trim())) {
      const match = line.match(/^\s*([^=]+?)\s*=\s*(#[0-9a-f]{6})\s*$/i);
      if (!match) throw new Error("Namensfarben bitte als Name = #RRGGBB eingeben.");
      overrides[match[1].trim().toLowerCase()] = match[2];
    }
    value.userColors = overrides; draft.enabled = root.querySelector("#design-enabled").checked;
    draft = design.normalize(draft);
  }
  function preview() {
    const host = root.querySelector("#design-preview"); host.replaceChildren();
    for (const p of design.PLATFORMS) {
      const row = document.createElement("div"); row.className = "chat-row";
      const badge = document.createElement("small"); badge.textContent = labels[p] + " · ";
      const name = document.createElement("span"); name.className = "chat-user"; name.textContent = root.querySelector("#design-preview-name").value || "User";
      const body = document.createElement("div"); body.className = "chat-message"; body.textContent = "Willkommen im Stream! Schön, dass du dabei bist. ✦";
      row.append(badge, name, body); host.append(row);
      design.apply(row, { platform: p, username: name.textContent, role: root.querySelector("#design-preview-role").value }, draft);
    }
  }
  function bind() {
    root.querySelectorAll("[data-design-platform]").forEach((button) => button.onclick = () => { try { collect(); platform = button.dataset.designPlatform; render(); } catch (e) { status(e.message, true); } });
    root.querySelectorAll("[data-design-preset]").forEach((button) => button.onclick = () => { try { collect(); Object.assign(draft.platforms[platform], { gradient: button.dataset.designPreset !== "clean", animation: button.dataset.designPreset === "holo" ? "flow" : "none", glow: button.dataset.designPreset === "neon" ? 14 : 0 }); dirty = true; render(); } catch (e) { status(e.message, true); } });
    root.querySelectorAll("input,select,textarea").forEach((input) => input.addEventListener("input", () => {
      if (input.id === "design-twitch-color") return;
      try { collect(); if (!input.id.startsWith("design-preview-")) { dirty = true; status("Ungespeicherte Änderungen"); } preview(); } catch (e) { status(e.message, true); }
    }));
    root.querySelector("#design-save").onclick = async (event) => { event.currentTarget.disabled = true; try { collect(); draft = await api.saveChatDesign(draft); dirty = false; status("Gespeichert · Gemeinsames Chatdesign aktualisiert."); } catch (e) { status(e.message, true); } finally { root.querySelector("#design-save").disabled = false; } };
    root.querySelector("#design-reset").onclick = () => { draft.platforms[platform] = design.defaults().platforms[platform]; dirty = true; render(); };
    root.querySelector("#design-twitch-apply").onclick = async (event) => { const button = event.currentTarget, result = root.querySelector("#design-native-status"); button.disabled = true; try { const applied = await api.setTwitchChatColor(root.querySelector("#design-twitch-color").value); result.textContent = `Twitch bestätigt: Farbe für ${applied.username} geändert.`; } catch (e) { result.textContent = e.message; } finally { button.disabled = false; } };
  }
  api.onChatDesignChanged?.((config) => { const next = design.normalize(config); if (!dirty && JSON.stringify(next) !== JSON.stringify(draft)) { draft = next; render(); } });
  api.getChatDesign().then((config) => { draft = design.normalize(config); render(); }).catch((e) => { render(); status(e.message, true); });
})();
