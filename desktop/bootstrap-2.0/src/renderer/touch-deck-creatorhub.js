"use strict";

(() => {
  const api = window.batto;
  if (!api?.invoke) return;

  function message(text, error = false) {
    const target = document.getElementById("toast");
    if (!target) return;
    target.textContent = String(text || "");
    target.className = `toast${error ? " error" : ""}`;
    target.hidden = false;
    clearTimeout(message.timer);
    message.timer = setTimeout(() => { target.hidden = true; }, 3200);
  }

  async function executeVisibleKey(key) {
    const index = Number(key?.dataset?.index);
    if (!Number.isInteger(index)) return;
    const profileId = document.getElementById("tdp-profile")?.value || "";
    const folderId = document.getElementById("tdp-folder")?.value || "root";
    try {
      const snapshot = await api.invoke("state:get", {});
      const profile = snapshot?.deck?.profiles?.find((item) => item.id === profileId) || snapshot?.deck?.profiles?.[0];
      const folder = profile?.folders?.find((item) => item.id === folderId) || profile?.folders?.find((item) => item.id === "root") || profile?.folders?.[0];
      const button = folder?.buttons?.[index];
      if (button?.folderId) {
        const select = document.getElementById("tdp-folder");
        if (select) {
          select.value = button.folderId;
          select.dispatchEvent(new Event("change", { bubbles: true }));
        }
        return;
      }
      await api.invoke("deck:execute-button", { profileId, folderId, buttonIndex: index });
      message(`Taste ${index + 1} ausgeführt.`);
    } catch (error) {
      message(error?.message || String(error), true);
    }
  }

  function install(shell) {
    if (!shell || shell.dataset.creatorhubEnhanced === "1") return;
    shell.dataset.creatorhubEnhanced = "1";
    shell.classList.add("creatorhub-deck");

    const heading = shell.querySelector(".tdp-heading");
    const eyebrow = heading?.querySelector(".eyebrow");
    const title = heading?.querySelector("h2");
    const copy = heading?.querySelector("p");
    const row = heading?.querySelector(".button-row");
    if (eyebrow) eyebrow.textContent = "STREAM DECK · PROFILE · ORDNER";
    if (title) title.textContent = "Stream Deck";
    if (copy) copy.textContent = "Große Touch-Tasten für OBS, Programme, Medien und deine Streaming-Aktionen.";

    if (row && !document.getElementById("creatorhub-edit")) {
      const edit = document.createElement("button");
      edit.id = "creatorhub-edit";
      edit.type = "button";
      edit.className = "creatorhub-primary";
      edit.textContent = "✎ Tasten belegen";
      edit.addEventListener("click", () => {
        const editing = shell.classList.toggle("creatorhub-editing");
        edit.textContent = editing ? "▦ Deck anzeigen" : "✎ Tasten belegen";
      });

      const fullscreen = document.createElement("button");
      fullscreen.id = "creatorhub-fullscreen";
      fullscreen.type = "button";
      fullscreen.className = "creatorhub-fullscreen";
      fullscreen.textContent = "⛶ Vollbild";
      fullscreen.addEventListener("click", async () => {
        const view = document.getElementById("view-deck-pro");
        try {
          if (document.fullscreenElement) await document.exitFullscreen();
          else await view?.requestFullscreen?.();
        } catch (error) {
          message(error?.message || "Vollbild konnte nicht geöffnet werden.", true);
        }
      });
      row.prepend(fullscreen);
      row.prepend(edit);
    }

    const layout = shell.querySelector(".tdp-editor-layout");
    if (layout && !shell.querySelector(".creatorhub-audio")) {
      const audio = document.createElement("section");
      audio.className = "creatorhub-audio";
      audio.innerHTML = `
        <div class="creatorhub-audio-copy"><span class="creatorhub-audio-icon">♪</span><div><strong>System-Audio</strong><small>Schnellsteuerung</small></div></div>
        <div class="creatorhub-audio-meter" aria-hidden="true"></div>
        <div class="creatorhub-audio-buttons">
          <button type="button" data-media="volumedown" title="Leiser">−</button>
          <button type="button" data-media="mute" title="Stumm">⌁</button>
          <button type="button" data-media="volumeup" title="Lauter">＋</button>
        </div>`;
      layout.insertAdjacentElement("afterend", audio);
      audio.querySelectorAll("[data-media]").forEach((button) => button.addEventListener("click", async () => {
        try {
          await api.invoke("deck:quick-media", { command: button.dataset.media });
        } catch (error) {
          message(error?.message || String(error), true);
        }
      }));
    }

    const grid = shell.querySelector("#tdp-grid");
    grid?.addEventListener("click", (event) => {
      if (shell.classList.contains("creatorhub-editing")) return;
      const key = event.target.closest(".tdp-key");
      if (!key) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void executeVisibleKey(key);
    }, true);
  }

  function tryInstall() {
    const shell = document.querySelector("#view-deck-pro .tdp-shell") || document.querySelector(".tdp-shell");
    if (shell) {
      install(shell);
      return true;
    }
    return false;
  }

  if (!tryInstall()) {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (tryInstall() || attempts > 80) clearInterval(timer);
    }, 125);
  }
})();
