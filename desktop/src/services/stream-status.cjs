"use strict";

const os = require("node:os");

function cpuTotals() {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    idle += cpu.times.idle;
    total += Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
  }
  return { idle, total };
}

class StreamStatusSampler {
  constructor(obsClient) {
    this.obs = obsClient;
    this.previousCpu = cpuTotals();
    this.previousStream = null;
  }

  cpuPercent() {
    const current = cpuTotals();
    const idleDelta = current.idle - this.previousCpu.idle;
    const totalDelta = current.total - this.previousCpu.total;
    this.previousCpu = current;
    if (totalDelta <= 0) return null;
    return Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100));
  }

  memoryPercent() {
    const total = os.totalmem();
    if (!total) return null;
    return Math.max(0, Math.min(100, ((total - os.freemem()) / total) * 100));
  }

  async snapshot() {
    const result = {
      timestamp: Date.now(),
      cpuPercent: this.cpuPercent(),
      memoryPercent: this.memoryPercent(),
      uploadKbps: null,
      frameDrops: null,
      encoderBitrateKbps: null,
      fps: null,
      obsConnected: Boolean(this.obs?.connected)
    };

    if (!this.obs?.connected) {
      this.previousStream = null;
      return result;
    }

    const [stats, stream] = await Promise.all([
      this.obs.requestSafe("GetStats"),
      this.obs.requestSafe("GetStreamStatus")
    ]);

    if (!stats?.__error) {
      result.frameDrops = Number.isFinite(Number(stats.outputSkippedFrames)) ? Number(stats.outputSkippedFrames) : null;
      result.fps = Number.isFinite(Number(stats.activeFps)) ? Number(stats.activeFps) : null;
    }

    if (!stream?.__error && stream.outputActive) {
      const bytes = Number(stream.outputBytes);
      const now = Date.now();
      if (Number.isFinite(bytes) && this.previousStream && bytes >= this.previousStream.bytes) {
        const seconds = Math.max(0.25, (now - this.previousStream.time) / 1000);
        const kbps = ((bytes - this.previousStream.bytes) * 8) / seconds / 1000;
        result.uploadKbps = kbps;
        result.encoderBitrateKbps = kbps;
      }
      if (Number.isFinite(bytes)) this.previousStream = { bytes, time: now };
    } else {
      this.previousStream = null;
    }
    return result;
  }
}

module.exports = { StreamStatusSampler, cpuTotals };
