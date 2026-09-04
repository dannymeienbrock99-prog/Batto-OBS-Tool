"use strict";

const crypto = require("node:crypto");

async function timedFetch(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

async function runInternetTest() {
  const downloadBytes = 8 * 1024 * 1024;
  const uploadBytes = 4 * 1024 * 1024;
  const downloadStart = performance.now();
  const downloadResponse = await timedFetch(`https://speed.cloudflare.com/__down?bytes=${downloadBytes}&cache=${Date.now()}`);
  if (!downloadResponse.ok) throw new Error(`Downloadtest fehlgeschlagen: HTTP ${downloadResponse.status}`);
  const downloadBuffer = await downloadResponse.arrayBuffer();
  const downloadSeconds = Math.max(0.001, (performance.now() - downloadStart) / 1000);
  const uploadPayload = crypto.randomBytes(uploadBytes);
  const uploadStart = performance.now();
  const uploadResponse = await timedFetch("https://speed.cloudflare.com/__up", {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: uploadPayload
  });
  if (!uploadResponse.ok) throw new Error(`Uploadtest fehlgeschlagen: HTTP ${uploadResponse.status}`);
  const uploadSeconds = Math.max(0.001, (performance.now() - uploadStart) / 1000);
  const latencySamples = [];
  for (let index = 0; index < 3; index += 1) {
    const start = performance.now();
    const response = await timedFetch(`https://speed.cloudflare.com/__down?bytes=1&latency=${Date.now()}-${index}`, {}, 5000);
    if (response.ok) await response.arrayBuffer();
    latencySamples.push(performance.now() - start);
  }
  return {
    testedAt: new Date().toISOString(),
    downloadedBytes: downloadBuffer.byteLength,
    uploadedBytes: uploadBytes,
    downloadMbps: downloadBuffer.byteLength * 8 / downloadSeconds / 1_000_000,
    uploadMbps: uploadBytes * 8 / uploadSeconds / 1_000_000,
    latencyMs: latencySamples.reduce((sum, value) => sum + value, 0) / latencySamples.length,
    provider: "Cloudflare Speed Test"
  };
}

module.exports = { runInternetTest };
