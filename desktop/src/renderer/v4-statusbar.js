"use strict";

(() => {
  const api = window.batto;
  const root = document.getElementById("v4-stream-status");
  if (!api?.getStreamStatus || !root) return;
  let stopped = false;
  let timer = null;

  const fmt = (value, suffix = "", digits = 1) => Number.isFinite(Number(value)) ? `${Number(value).toFixed(digits)}${suffix}` : "Nicht verfügbar";
  const item = (label, value, cls = "") => `<span class="${cls}">${label}: <b>${value}</b></span>`;

  async function tick() {
    if (stopped) return;
    try {
      const [status, configs] = await Promise.all([api.getStreamStatus(), api.getV4Configs?.()]);
      const config = configs?.modules?.statusbar?.config || {};
      const enabled = configs?.modules?.statusbar?.enabled !== false;
      root.hidden = !enabled;
      if (!enabled) return schedule(config.refreshSeconds);
      const fpsWarn = Number(config.fpsWarningBelow || 50);
      const dropsWarn = Number(config.frameDropWarningAbove || 10);
      const bitrateWarn = Number(config.bitrateWarningBelow || 3000);
      const parts = [
        item("CPU", fmt(status.cpuPercent, "%")),
        item("Speicher", fmt(status.memoryPercent, "%")),
        item("Hochladen", fmt(status.uploadKbps, " kbps", 0)),
        item("Framedrops", Number.isFinite(Number(status.frameDrops)) ? String(status.frameDrops) : "Nicht verfügbar", Number(status.frameDrops) > dropsWarn ? "bad" : ""),
        item("Encoder-Bitrate", fmt(status.encoderBitrateKbps, " kbps", 0), Number.isFinite(Number(status.encoderBitrateKbps)) && Number(status.encoderBitrateKbps) < bitrateWarn ? "warn" : ""),
        item("FPS", fmt(status.fps, "", 1), Number.isFinite(Number(status.fps)) && Number(status.fps) < fpsWarn ? "bad" : "")
      ];
      root.innerHTML = parts.join("");
      schedule(config.refreshSeconds);
    } catch {
      root.innerHTML = item("Stream-Status", "Nicht verfügbar");
      schedule(2);
    }
  }

  function schedule(seconds = 1) {
    clearTimeout(timer);
    timer = setTimeout(tick, Math.max(1, Math.min(10, Number(seconds) || 1)) * 1000);
  }

  window.addEventListener("beforeunload", () => { stopped = true; clearTimeout(timer); });
  api.onV4ConfigChanged?.((changed) => { if (changed?.id === "statusbar") void tick(); });
  void tick();
})();
