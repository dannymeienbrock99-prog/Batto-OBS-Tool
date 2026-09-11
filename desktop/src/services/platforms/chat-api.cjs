"use strict";

async function requestJson(fetcher, url, { signal, ...options } = {}, label = "Chat") {
  const bounded = signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000);
  let response;
  try { response = await fetcher(url, { ...options, signal: bounded }); }
  catch (error) {
    if (bounded.aborted) throw new Error(`${label}: Anfrage abgebrochen oder Zeitlimit erreicht; Zustellung gegebenenfalls unbestätigt.`);
    throw new Error(`${label}: Netzwerkverbindung fehlgeschlagen.`);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = String(body.error?.errors?.[0]?.reason || "").replace(/[^a-zA-Z0-9_]/g, "").slice(0, 80);
    const hints = { 401: "Token abgelaufen oder ungültig. Erneut verbinden.", 403: "Berechtigung fehlt oder Chat ist gesperrt.", 429: "Ratenlimit erreicht. Später erneut versuchen." };
    const error = new Error(`${label}: HTTP ${response.status}. ${hints[response.status] || "Anfrage abgelehnt."}${reason ? ` (${reason})` : ""}`);
    error.status = response.status;
    throw error;
  }
  return body;
}
module.exports = { requestJson };
