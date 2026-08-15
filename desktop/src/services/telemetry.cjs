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

function encoderFromObs(snapshot = {}, hardware = {}) {
  const version = snapshot.version || {};
  const preferred = hardware?.preferredGpu || null;
  const available = Array.isArray(version.availableRequestTypes)
    ? version.availableRequestTypes
    : [];
  let name = "Nicht verfügbar";
  if (preferred?.name) {
    if (/nvidia|geforce|rtx|gtx/i.test(preferred.name)) name = "NVIDIA NVENC";
    else if (/amd|radeon/i.test(preferred.name)) name = "AMD Hardware Encoder";
    else if (/intel|arc|iris|uhd/i.test(preferred.name)) name = "Intel Quick Sync";
  }
  return {
    name,
    codec: "Nicht verfügbar",
    rateControl: "Nicht verfügbar",
    preset: "Nicht verfügbar",
    profile: "Nicht verfügbar",
    keyframeIntervalSeconds: null,
    bFrames: null,
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
  const totalFrames = number(first(stream.outputTotalFrames, record.outputTotalFrames), 0) || 0;
  const skipped = number(stats.outputSkippedFrames, 0) || 0;
  const renderSkipped = number(stats.renderSkippedFrames, 0) || 0;
  const dropped = number(stream.outputSkippedFrames, 0) || 0;
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
    gpus,
    encoder: encoderFromObs(obs, hardware),
    output: {
      streamActive,
      recordActive,
      configuredBitrateKbps: null,
      actualBitrateKbps: number(stream.outputBytes) && number(stream.outputDuration)
        ? number(stream.outputBytes) * 8 / Math.max(1, number(stream.outputDuration))
        : null,
      totalFrames,
      renderLagFrames: renderSkipped,
      encodingLagFrames: skipped,
      networkDroppedFrames: dropped,
      totalDroppedFrames: renderSkipped + skipped + dropped,
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
  encoderFromObs
};
