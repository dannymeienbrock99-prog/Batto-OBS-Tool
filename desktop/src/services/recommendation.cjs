"use strict";

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function text(value) {
  return String(value || "").trim();
}

function classifyGpu(gpu = {}) {
  const name = text(gpu.name || gpu.model || gpu.caption);
  const lower = name.toLowerCase();
  if (/nvidia|geforce|rtx|gtx|quadro/.test(lower)) {
    return {
      vendor: "NVIDIA",
      name,
      family: /rtx\s*(50|40|30|20)/i.test(name) ? "RTX" : "NVIDIA",
      av1: /rtx\s*(50|40)/i.test(name)
    };
  }
  if (/amd|radeon/.test(lower)) {
    return {
      vendor: "AMD",
      name,
      family: /radeon\s+rx/i.test(name) ? "Radeon RX" : "AMD",
      av1: /rx\s*(9|8|7)\d{3}/i.test(name)
    };
  }
  if (/intel|arc/.test(lower)) {
    return {
      vendor: "Intel",
      name,
      family: /\barc\b/i.test(name) ? "Intel Arc" : "Intel",
      av1: /\barc\b/i.test(name)
    };
  }
  return { vendor: "Unbekannt", name: name || "Nicht erkannt", family: "Unbekannt", av1: false };
}

function targetBitrateFor({ platform, resolution, fps }) {
  const key = `${resolution}@${fps}`;
  const targets = {
    twitch: {
      "1280x720@30": 3500,
      "1280x720@60": 5000,
      "1920x1080@30": 5500,
      "1920x1080@60": 6000,
      "2560x1440@60": 8000
    },
    youtube: {
      "1280x720@30": 4000,
      "1280x720@60": 6000,
      "1920x1080@30": 7000,
      "1920x1080@60": 10000,
      "2560x1440@60": 18000,
      "3840x2160@60": 35000
    },
    recording: {
      "1280x720@60": 12000,
      "1920x1080@60": 25000,
      "2560x1440@60": 45000,
      "3840x2160@60": 80000
    }
  };
  const fallback = platform === "recording" ? 25000 : platform === "youtube" ? 10000 : 6000;
  return targets[platform]?.[key] || fallback;
}

function bitrateFor({ platform, resolution, fps, uploadMbps }) {
  const target = targetBitrateFor({ platform, resolution, fps });
  if (platform === "recording") return target;
  const upload = Math.max(0, number(uploadMbps));
  const safeBudget = upload > 0 ? upload * 1000 * 0.72 : 6000;
  return Math.max(1500, Math.round(Math.min(target, safeBudget) / 100) * 100);
}

function buildRecommendation(input = {}) {
  const platform = ["twitch", "youtube", "recording"].includes(input.platform)
    ? input.platform
    : "twitch";
  const resolution = text(input.resolution) || "1920x1080";
  const fps = [30, 60, 120].includes(number(input.fps)) ? number(input.fps) : 60;
  const gpu = classifyGpu(input.gpu || {});
  const uploadMbps = number(input.uploadMbps);
  const targetBitrateKbps = targetBitrateFor({ platform, resolution, fps });
  const bitrateKbps = bitrateFor({ platform, resolution, fps, uploadMbps });

  let encoder = "x264";
  let codec = "H.264";
  let preset = "veryfast";
  let profile = "high";
  const rateControl = platform === "recording" ? "CQP" : "CBR";
  const quality = platform === "recording" ? 20 : null;
  let bFrames = 2;
  const notes = [];

  if (gpu.vendor === "NVIDIA") {
    encoder = platform === "youtube" && gpu.av1
      ? "NVIDIA NVENC AV1"
      : platform === "recording" && gpu.av1
        ? "NVIDIA NVENC AV1"
        : "NVIDIA NVENC H.264";
    codec = encoder.includes("AV1") ? "AV1" : "H.264";
    preset = gpu.family === "RTX" ? "P6 – höhere Qualität" : "P5 – Qualität";
    profile = codec === "H.264" ? "high" : "main";
    bFrames = codec === "AV1" ? 3 : 2;
    notes.push("Die dedizierte NVIDIA-GPU wird vor einer integrierten Prozessorgrafik bevorzugt.");
  } else if (gpu.vendor === "AMD") {
    encoder = gpu.av1 && platform !== "twitch" ? "AMD HW AV1" : "AMD HW H.264";
    codec = encoder.includes("AV1") ? "AV1" : "H.264";
    preset = "Quality";
    profile = codec === "H.264" ? "high" : "main";
    notes.push("AMF-Hardwareencoding reduziert die CPU-Last gegenüber x264.");
  } else if (gpu.vendor === "Intel") {
    encoder = gpu.av1 && platform !== "twitch" ? "Intel QSV AV1" : "Intel QSV H.264";
    codec = encoder.includes("AV1") ? "AV1" : "H.264";
    preset = "Quality";
    profile = codec === "H.264" ? "high" : "main";
  } else {
    notes.push("Kein eindeutig unterstützter Hardwareencoder erkannt; x264 nur nach Belastungstest verwenden.");
  }

  if (platform === "twitch" && codec !== "H.264") {
    encoder = gpu.vendor === "NVIDIA" ? "NVIDIA NVENC H.264"
      : gpu.vendor === "AMD" ? "AMD HW H.264"
        : gpu.vendor === "Intel" ? "Intel QSV H.264"
          : "x264";
    codec = "H.264";
    profile = "high";
  }

  if (platform !== "recording" && uploadMbps > 0 && bitrateKbps < targetBitrateKbps) {
    notes.push(`Die Zielbitrate von ${targetBitrateKbps.toLocaleString("de-DE")} Kbit/s wurde durch die 72-%-Uploadreserve auf ${bitrateKbps.toLocaleString("de-DE")} Kbit/s begrenzt.`);
  }
  if (resolution === "3840x2160" && uploadMbps > 0 && uploadMbps < 45 && platform !== "recording") {
    notes.push("Für 4K-Livestreaming ist mehr stabiler Upload sinnvoll; 1440p oder 1080p ist zuverlässiger.");
  }
  notes.push("Vor einem öffentlichen Stream eine private Testaufnahme und den bestätigungspflichtigen OBS-Test ausführen.");

  return {
    generatedAt: new Date().toISOString(),
    hardware: {
      gpu: gpu.name,
      vendor: gpu.vendor
    },
    target: { platform, resolution, fps, uploadMbps },
    settings: {
      encoder,
      codec,
      rateControl,
      bitrateKbps: rateControl === "CBR" ? bitrateKbps : null,
      cqp: rateControl === "CQP" ? quality : null,
      keyframeIntervalSeconds: platform === "recording" ? 0 : 2,
      preset,
      profile,
      bFrames,
      lookAhead: false,
      psychoVisualTuning: gpu.vendor === "NVIDIA",
      multipass: gpu.vendor === "NVIDIA" ? "Two Passes – Quarter Resolution" : "Nicht verfügbar"
    },
    notes
  };
}

module.exports = {
  bitrateFor,
  buildRecommendation,
  classifyGpu,
  targetBitrateFor
};
