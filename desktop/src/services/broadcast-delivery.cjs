"use strict";

// Resolve every target independently. A failed/slow provider must not hide the
// result of any other provider, and an HTTP/IRC handoff is not an acknowledgement.
async function deliverBroadcast({ platforms, message, send, statuses = null, enabled = {}, timeoutMs = 10000, signal, active = () => true }) {
  return Promise.all(platforms.map(async (platform) => {
    const base = { platform, time: Date.now() };
    if (signal?.aborted) return { ...base, status: "skipped", reason: "Abgebrochen" };
    if (enabled[platform]?.enabled === false) return { ...base, status: "skipped", reason: "Plattform deaktiviert" };
    const capability = statuses?.[platform];
    if (capability?.canSend === false) return { ...base, status: "skipped", reason: capability.sendReason || "Diese Verbindung unterstützt kein Senden" };
    if (capability && !capability.connected) return { ...base, status: "skipped", reason: "Nicht verbunden" };
    if (!active(platform)) return { ...base, status: "skipped", reason: "Keine aktuelle Chat-Aktivität" };
    const controller = new AbortController();
    let timer; let abort;
    try {
      const expired = new Promise((_, reject) => {
        abort = () => { controller.abort(); reject(new Error("Abgebrochen; eine bereits übertragene Nachricht kann nicht zurückgerufen werden")); };
        signal?.addEventListener("abort", abort, { once: true });
        timer = setTimeout(() => { controller.abort(); reject(new Error("Zeitüberschreitung; Zustellung unbekannt")); }, timeoutMs);
      });
      const outcome = await Promise.race([send(platform, message, { signal: controller.signal }), expired]);
      if (outcome?.sent === false && !outcome?.submitted) return { ...base, status: "failed", reason: outcome.reason || "Von der Plattform abgelehnt" };
      return { ...base, status: outcome?.sent === true && outcome?.confirmed === true ? "sent" : "submitted",
        reason: outcome?.sent === true && outcome?.confirmed === true ? "Von der Plattform bestätigt" : "Übergeben, keine Zustellbestätigung",
        messageId: outcome?.messageId || "" };
    } catch (error) {
      return { ...base, status: signal?.aborted ? "skipped" : "failed", reason: String(error.message || error).slice(0, 300) };
    } finally { clearTimeout(timer); if (abort) signal?.removeEventListener("abort", abort); }
  }));
}
module.exports = { deliverBroadcast };
