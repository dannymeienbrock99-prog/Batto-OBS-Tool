"use strict";

function number(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function first(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function parameterValue(entry) {
  if (!entry || entry.__error) return null;
  return first(entry.parameterValue, entry.defaultParameterValue);
}

function encoderDetails(encoderId, preferredGpuName = "") {
  const id = String(encoderId || "").trim();
  const normalized = id.toLowerCase();
  if (!id) {
    return {
      id: "",
      name: "Nicht verfügbar",
      codec: "Nicht verfügbar",
      vendor: "",
      hardware: null
    };
  }
  const codec = /av1/.test(normalized)
    ? "AV1"
    : /hevc|h265/.test(normalized)
      ? "HEVC"
      : "H.264";
  if (/nvenc|nvidia/.test(normalized)) {
    return { id, name: `NVIDIA NVENC ${codec}`, codec, vendor: "NVIDIA", hardware: true };
  }
  if (/amd|amf|h264_texture|hevc_texture|av1_texture/.test(normalized)) {
    return { id, name: `AMD Hardware Encoder ${codec}`, codec, vendor: "AMD", hardware: true };
  }
  if (/qsv|quicksync|intel/.test(normalized)) {
    return { id, name: `Intel Quick Sync ${codec}`, codec, vendor: "Intel", hardware: true };
  }
  if (/x264/.test(normalized)) {
    return { id, name: "x264 (CPU)", codec: "H.264", vendor: "CPU", hardware: false };
  }
  return {
    id,
    name: id,
    codec,
    vendor: /nvidia|geforce|rtx|gtx/i.test(preferredGpuName) ? "NVIDIA" : "",
    hardware: null
  };
}

function encoderFromObs(snapshot = {}, hardware = {}, outputActive = false) {
  const parameters = snapshot.profileParameters || {};
  const mode = String(parameterValue(parameters.outputMode) || "").toLowerCase();
  const simple = mode !== "advanced";
  const encoderId = simple
    ? parameterValue(parameters.simpleStreamEncoder)
    : parameterValue(parameters.advancedStreamEncoder);
  const preferred = hardware?.preferredGpu || null;
  const details = encoderDetails(encoderId, preferred?.name || "");
  const configuredBitrateKbps = simple
    ? number(parameterValue(parameters.simpleBitrate))
    : null;
  const preset = simple ? parameterValue(parameters.simplePreset) : null;
  const available = Array.isArray(snapshot.version?.availableRequestTypes)
    ? snapshot.version.availableRequestTypes
    : [];
  return {
    ...details,
    label: outputActive ? "Aktiver Encoder" : "Encoder",
    rateControl: simple && configuredBitrateKbps ? "CBR" : "Nicht verfügbar",
    preset: preset || "Nicht verfügbar",
    profile: "Nicht verfügbar",
    keyframeIntervalSeconds: null,
    bFrames: null,
    configuredBitrateKbps,
    outputMode: mode || "Nicht verfügbar",
    obsProfileName: snapshot.profile?.currentProfileName || "",
    gpuName: preferred?.name || "",
    availableRequestTypes: available
  };
}

function composeTelemetry({ hardware, system, obsSnapshot, profileName = "Standard" } = {}) {
  const obs = obsSnapshot || {};
  const stats = obs.stats && !obs.stats.__error ? obs.stats : {};
  const stream = obs.stream && !obs.stream.__error ? obs.stream : {};
  const record = obs.record && !obs.record.__error ? obs.record : {};
  const video = obs.video && !obs.video.__error ? obs.video : {};
  const streamActive = Boolean(stream.outputActive);
  const recordActive = Boolean(record.outputActive);
  const outputActive = streamActive || recordActive;
  const encoder = encoderFromObs(obs, hardware, outputActive);
  const totalFrames = number(first(stream.outputTotalFrames, record.outputTotalFrames), 0) || 0;
  const skipped = number(stats.outputSkippedFrames, 0) || 0;
  const renderSkipped = number(stats.renderSkippedFrames, 0) || 0;
  const networkDropped = number(first(stream.outputSkippedFrames, stream.outputCongestion), 0) || 0;
  const fps = number(first(stats.activeFps, video.fpsNumerator && video.fpsDenominator
    ? video.fpsNumerator / video.fpsDenominator
    : null), 0);

  const gpus = [];
  if (system?.gpu) gpus.push(system.gpu);
  for (const gpu of hardware?.gpus || []) {
    if (gpus.some((entry) => String(entry.name).toLowerCase() === String(gpu.name).toLowerCase())) continue;
    gpus.push({
      name: gpu.name,
      memoryTotalMb: number(gpu.adapterRamBytes, 0) / 1024 ** 2,
      dedicated: !gpu.integrated,
      integrated: Boolean(gpu.integrated),
      source: "Windows-CIM"
    });
  }

  return {
    timestamp: Date.now(),
    profileName,
    obsProfileName: obs.profile?.currentProfileName || "",
    gpus,
    encoder,
    output: {
      streamActive,
      recordActive,
      configuredBitrateKbps: encoder.configuredBitrateKbps,
      actualBitrateKbps: number(stream.outputBytes) && number(stream.outputDuration)
        ? number(stream.outputBytes) * 8 / Math.max(1, number(stream.outputDuration))
        : null,
      totalFrames,
      renderLagFrames: renderSkipped,
      encodingLagFrames: skipped,
      networkDroppedFrames: networkDropped,
      totalDroppedFrames: renderSkipped + skipped + networkDropped,
      streamTimecode: stream.outputTimecode || "",
      recordTimecode: record.outputTimecode || "",
      recordingSizeBytes: number(record.outputBytes)
    },
    video: {
      outputWidth: number(video.outputWidth),
      outputHeight: number(video.outputHeight),
      outputFps: fps,
      renderFps: number(stats.activeFps, fps),
      scaleFilter: "Nicht verfügbar"
    },
    frame: {
      frameTimeMs: fps > 0 ? 1000 / fps : null
    },
    obs: {
      cpuUsagePercent: number(stats.cpuUsage),
      memoryUsageMb: number(stats.memoryUsage),
      status: outputActive ? "Ausgabe aktiv" : obs.connected ? "Verbunden" : "Nicht verbunden"
    },
    system: {
      cpu: system?.cpu || {},
      ram: system?.ram || {},
      network: system?.network || {}
    }
  };
}

module.exports = {
  composeTelemetry,
  encoderDetails,
  encoderFromObs,
  parameterValue
};
