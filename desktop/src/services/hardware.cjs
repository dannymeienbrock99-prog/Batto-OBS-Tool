"use strict";

const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { Worker } = require("node:worker_threads");

const execFileAsync = promisify(execFile);

function number(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function array(value) {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function encodePowerShell(script) {
  return Buffer.from(script, "utf16le").toString("base64");
}

async function runPowerShell(script, options = {}) {
  if (process.platform !== "win32") {
    throw new Error("Die vollständige Hardwarediagnose ist nur unter Windows verfügbar.");
  }
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodePowerShell(script)],
    {
      windowsHide: true,
      timeout: options.timeoutMs || 15000,
      maxBuffer: options.maxBuffer || 8 * 1024 * 1024
    }
  );
  return String(stdout || "").replace(/^\uFEFF/, "").trim();
}

function isIntegratedGpuName(name) {
  return /amd\s+radeon\(tm\)\s+graphics|intel\s+(?:uhd|hd|iris)\s+graphics|microsoft\s+basic|virtual|remote/i.test(String(name || ""));
}

function gpuScore(gpu = {}) {
  const name = String(gpu.name || gpu.Name || gpu.Caption || "");
  const ram = number(gpu.adapterRamBytes || gpu.AdapterRAM || gpu.vramBytes, 0);
  let score = ram / 1024 ** 3 * 20;
  if (isIntegratedGpuName(name)) score -= 1000;
  if (/nvidia|geforce|rtx|gtx/i.test(name)) score += 500;
  if (/radeon\s+rx/i.test(name)) score += 450;
  if (/intel\s+arc/i.test(name)) score += 420;
  return score;
}

function selectPreferredGpu(gpus = []) {
  const list = array(gpus).filter(Boolean);
  if (!list.length) return null;
  return list.slice().sort((a, b) => gpuScore(b) - gpuScore(a))[0];
}

async function collectHardware() {
  if (process.platform !== "win32") {
    return {
      platform: process.platform,
      cpu: { name: os.cpus()?.[0]?.model || "Nicht verfügbar", cores: os.cpus().length },
      gpus: [],
      preferredGpu: null,
      memory: { totalBytes: os.totalmem(), modules: [] },
      mainboard: null,
      bios: null,
      monitors: [],
      disks: [],
      networkAdapters: [],
      os: { caption: os.type(), version: os.release(), architecture: os.arch() },
      obs: { installed: false, paths: [] },
      warning: "Vollständige Windows-CIM-Diagnose ist auf diesem Betriebssystem nicht verfügbar."
    };
  }

  const script = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
function SafeText($v) { if ($null -eq $v) { return '' }; return [string]$v }
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1 Name,Manufacturer,NumberOfCores,NumberOfLogicalProcessors,MaxClockSpeed,SocketDesignation,ProcessorId
$gpus = @(Get-CimInstance Win32_VideoController | ForEach-Object {
  [PSCustomObject]@{
    Name = $_.Name
    AdapterRAM = [uint64]$_.AdapterRAM
    DriverVersion = $_.DriverVersion
    VideoProcessor = $_.VideoProcessor
    PnpDeviceId = $_.PNPDeviceID
    Status = $_.Status
    CurrentHorizontalResolution = $_.CurrentHorizontalResolution
    CurrentVerticalResolution = $_.CurrentVerticalResolution
    CurrentRefreshRate = $_.CurrentRefreshRate
  }
})
$memoryModules = @(Get-CimInstance Win32_PhysicalMemory | ForEach-Object {
  [PSCustomObject]@{
    Manufacturer = $_.Manufacturer
    PartNumber = (SafeText $_.PartNumber).Trim()
    SerialNumber = (SafeText $_.SerialNumber).Trim()
    Capacity = [uint64]$_.Capacity
    Speed = $_.Speed
    ConfiguredClockSpeed = $_.ConfiguredClockSpeed
    DeviceLocator = $_.DeviceLocator
    BankLabel = $_.BankLabel
  }
})
$board = Get-CimInstance Win32_BaseBoard | Select-Object -First 1 Manufacturer,Product,Version,SerialNumber
$bios = Get-CimInstance Win32_BIOS | Select-Object -First 1 Manufacturer,SMBIOSBIOSVersion,ReleaseDate,SerialNumber
$monitors = @(Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorID | ForEach-Object {
  $name = -join ($_.UserFriendlyName | Where-Object { $_ -ne 0 } | ForEach-Object { [char]$_ })
  $manufacturer = -join ($_.ManufacturerName | Where-Object { $_ -ne 0 } | ForEach-Object { [char]$_ })
  $serial = -join ($_.SerialNumberID | Where-Object { $_ -ne 0 } | ForEach-Object { [char]$_ })
  [PSCustomObject]@{ Name=$name; Manufacturer=$manufacturer; Serial=$serial; Active=$_.Active; InstanceName=$_.InstanceName }
})
$disks = @(Get-CimInstance Win32_DiskDrive | ForEach-Object {
  [PSCustomObject]@{
    Model = $_.Model
    Manufacturer = $_.Manufacturer
    SerialNumber = (SafeText $_.SerialNumber).Trim()
    Size = [uint64]$_.Size
    InterfaceType = $_.InterfaceType
    MediaType = $_.MediaType
    FirmwareRevision = $_.FirmwareRevision
    Status = $_.Status
  }
})
$net = @(Get-NetAdapter -Physical | ForEach-Object {
  [PSCustomObject]@{
    Name = $_.Name
    InterfaceDescription = $_.InterfaceDescription
    Status = [string]$_.Status
    LinkSpeed = [string]$_.LinkSpeed
    MacAddress = $_.MacAddress
    MediaType = [string]$_.MediaType
  }
})
$os = Get-CimInstance Win32_OperatingSystem | Select-Object -First 1 Caption,Version,BuildNumber,OSArchitecture,LastBootUpTime,TotalVisibleMemorySize,FreePhysicalMemory
$obsPaths = @(
  "$env:ProgramFiles\obs-studio\bin\64bit\obs64.exe",
  "$([Environment]::GetFolderPath('ProgramFilesX86'))\obs-studio\bin\64bit\obs64.exe",
  "$env:LOCALAPPDATA\Programs\obs-studio\bin\64bit\obs64.exe"
) | Where-Object { $_ -and (Test-Path $_) }
$result = [PSCustomObject]@{
  cpu = $cpu
  gpus = $gpus
  memoryModules = $memoryModules
  board = $board
  bios = $bios
  monitors = $monitors
  disks = $disks
  networkAdapters = $net
  operatingSystem = $os
  obsPaths = @($obsPaths)
}
$result | ConvertTo-Json -Depth 7 -Compress
`;
  const raw = await runPowerShell(script, { timeoutMs: 25000, maxBuffer: 16 * 1024 * 1024 });
  const parsed = JSON.parse(raw || "{}");
  const gpus = array(parsed.gpus).map((gpu) => ({
    name: gpu.Name || "Nicht verfügbar",
    adapterRamBytes: number(gpu.AdapterRAM, 0),
    adapterRamGb: number(gpu.AdapterRAM, 0) / 1024 ** 3,
    driverVersion: gpu.DriverVersion || "",
    videoProcessor: gpu.VideoProcessor || "",
    pnpDeviceId: gpu.PnpDeviceId || "",
    status: gpu.Status || "",
    integrated: isIntegratedGpuName(gpu.Name),
    resolution: gpu.CurrentHorizontalResolution && gpu.CurrentVerticalResolution
      ? `${gpu.CurrentHorizontalResolution} × ${gpu.CurrentVerticalResolution}`
      : "",
    refreshRate: number(gpu.CurrentRefreshRate)
  }));
  const modules = array(parsed.memoryModules).map((module) => ({
    manufacturer: module.Manufacturer || "",
    partNumber: module.PartNumber || "",
    serialNumber: module.SerialNumber || "",
    capacityBytes: number(module.Capacity, 0),
    capacityGb: number(module.Capacity, 0) / 1024 ** 3,
    speedMt: number(module.ConfiguredClockSpeed ?? module.Speed),
    locator: module.DeviceLocator || module.BankLabel || ""
  }));
  const preferred = selectPreferredGpu(gpus);
  return {
    platform: "win32",
    scannedAt: new Date().toISOString(),
    cpu: parsed.cpu ? {
      name: parsed.cpu.Name || "Nicht verfügbar",
      manufacturer: parsed.cpu.Manufacturer || "",
      cores: number(parsed.cpu.NumberOfCores, os.cpus().length),
      threads: number(parsed.cpu.NumberOfLogicalProcessors, os.cpus().length),
      maxClockMhz: number(parsed.cpu.MaxClockSpeed),
      socket: parsed.cpu.SocketDesignation || "",
      processorId: parsed.cpu.ProcessorId || ""
    } : null,
    gpus,
    preferredGpu: preferred,
    memory: {
      totalBytes: modules.reduce((sum, module) => sum + module.capacityBytes, 0) || os.totalmem(),
      totalGb: (modules.reduce((sum, module) => sum + module.capacityBytes, 0) || os.totalmem()) / 1024 ** 3,
      modules
    },
    mainboard: parsed.board ? {
      manufacturer: parsed.board.Manufacturer || "",
      product: parsed.board.Product || "",
      version: parsed.board.Version || "",
      serialNumber: parsed.board.SerialNumber || ""
    } : null,
    bios: parsed.bios ? {
      manufacturer: parsed.bios.Manufacturer || "",
      version: parsed.bios.SMBIOSBIOSVersion || "",
      releaseDate: parsed.bios.ReleaseDate || "",
      serialNumber: parsed.bios.SerialNumber || ""
    } : null,
    monitors: array(parsed.monitors).map((monitor) => ({
      name: monitor.Name || "Unbekannter Monitor",
      manufacturer: monitor.Manufacturer || "",
      serial: monitor.Serial || "",
      active: monitor.Active !== false,
      instanceName: monitor.InstanceName || ""
    })),
    disks: array(parsed.disks).map((disk) => ({
      model: disk.Model || "Nicht verfügbar",
      manufacturer: disk.Manufacturer || "",
      serialNumber: disk.SerialNumber || "",
      sizeBytes: number(disk.Size, 0),
      sizeGb: number(disk.Size, 0) / 1024 ** 3,
      interfaceType: disk.InterfaceType || "",
      mediaType: disk.MediaType || "",
      firmware: disk.FirmwareRevision || "",
      status: disk.Status || ""
    })),
    networkAdapters: array(parsed.networkAdapters).map((adapter) => ({
      name: adapter.Name || "",
      description: adapter.InterfaceDescription || "",
      status: adapter.Status || "",
      linkSpeed: adapter.LinkSpeed || "",
      macAddress: adapter.MacAddress || "",
      mediaType: adapter.MediaType || ""
    })),
    os: parsed.operatingSystem ? {
      caption: parsed.operatingSystem.Caption || "Windows",
      version: parsed.operatingSystem.Version || "",
      build: parsed.operatingSystem.BuildNumber || "",
      architecture: parsed.operatingSystem.OSArchitecture || os.arch(),
      lastBootUpTime: parsed.operatingSystem.LastBootUpTime || ""
    } : null,
    obs: {
      installed: array(parsed.obsPaths).length > 0,
      paths: array(parsed.obsPaths)
    }
  };
}

function cpuTimes() {
  return os.cpus().map((cpu) => ({
    idle: number(cpu.times?.idle, 0),
    total: Object.values(cpu.times || {}).reduce((sum, value) => sum + number(value, 0), 0),
    speed: number(cpu.speed, 0)
  }));
}

function cpuUsage(previous, current) {
  const perCore = current.map((entry, index) => {
    const before = previous[index] || entry;
    const total = Math.max(0, entry.total - before.total);
    const idle = Math.max(0, entry.idle - before.idle);
    return total > 0 ? Math.max(0, Math.min(100, (1 - idle / total) * 100)) : 0;
  });
  return {
    total: perCore.length ? perCore.reduce((sum, value) => sum + value, 0) / perCore.length : 0,
    perCore,
    clockMhz: current.length ? current.reduce((sum, entry) => sum + entry.speed, 0) / current.length : null
  };
}

async function queryNvidia() {
  if (process.platform !== "win32") return null;
  const candidates = [
    path.join(process.env.WINDIR || "C:\\Windows", "System32", "nvidia-smi.exe"),
    "nvidia-smi.exe"
  ];
  const args = [
    "--query-gpu=name,utilization.gpu,utilization.encoder,utilization.decoder,temperature.gpu,memory.used,memory.total,clocks.current.graphics,clocks.current.memory,power.draw,power.limit,fan.speed",
    "--format=csv,noheader,nounits"
  ];
  for (const executable of candidates) {
    try {
      const { stdout } = await execFileAsync(executable, args, {
        windowsHide: true,
        timeout: 3500,
        maxBuffer: 256 * 1024
      });
      const row = String(stdout || "").split(/\r?\n/).find(Boolean);
      if (!row) continue;
      const values = row.split(",").map((value) => value.trim());
      return {
        name: values[0] || "NVIDIA GPU",
        utilizationPercent: number(values[1]),
        encoderUtilizationPercent: number(values[2]),
        decoderUtilizationPercent: number(values[3]),
        temperatureC: number(values[4]),
        memoryUsedMb: number(values[5]),
        memoryTotalMb: number(values[6]),
        graphicsClockMhz: number(values[7]),
        memoryClockMhz: number(values[8]),
        powerWatts: number(values[9]),
        powerLimitWatts: number(values[10]),
        fanPercent: number(values[11]),
        dedicated: true,
        integrated: false,
        source: "nvidia-smi"
      };
    } catch {
      // Try the next standard location.
    }
  }
  return null;
}

async function queryNetworkTotals() {
  if (process.platform !== "win32") return null;
  try {
    const raw = await runPowerShell(String.raw`
$stats = Get-NetAdapterStatistics | Measure-Object -Property ReceivedBytes,SentBytes -Sum
[PSCustomObject]@{ Received=[uint64]$stats[0].Sum; Sent=[uint64]$stats[1].Sum } | ConvertTo-Json -Compress
`, { timeoutMs: 4000, maxBuffer: 64 * 1024 });
    const parsed = JSON.parse(raw || "{}");
    return { received: number(parsed.Received, 0), sent: number(parsed.Sent, 0) };
  } catch {
    return null;
  }
}

async function queryLatency() {
  const args = process.platform === "win32"
    ? ["-n", "1", "-w", "1200", "1.1.1.1"]
    : ["-c", "1", "-W", "1", "1.1.1.1"];
  try {
    const { stdout } = await execFileAsync(process.platform === "win32" ? "ping.exe" : "ping", args, {
      windowsHide: true,
      timeout: 2500,
      maxBuffer: 64 * 1024
    });
    const match = String(stdout).match(/(?:time|zeit)[=<]\s*(\d+(?:[.,]\d+)?)\s*ms/i)
      || String(stdout).match(/(?:Average|Mittelwert)\s*=\s*(\d+)ms/i);
    return match ? Number(match[1].replace(",", ".")) : null;
  } catch {
    return null;
  }
}

class SystemTelemetrySampler {
  constructor() {
    this.previousCpu = cpuTimes();
    this.previousNetwork = null;
    this.uploadSamples = [];
    this.lastLatency = null;
    this.lastLatencyAt = 0;
    this.reconnects = 0;
    this.wasConnected = null;
  }

  async sample(hardware = null) {
    const timestamp = Date.now();
    const currentCpu = cpuTimes();
    const cpu = cpuUsage(this.previousCpu, currentCpu);
    this.previousCpu = currentCpu;
    const totalRam = os.totalmem();
    const usedRam = totalRam - os.freemem();
    const [nvidia, network] = await Promise.all([
      queryNvidia(),
      queryNetworkTotals()
    ]);
    if (timestamp - this.lastLatencyAt > 5000) {
      this.lastLatency = await queryLatency();
      this.lastLatencyAt = timestamp;
    }
    let upload = 0;
    let download = 0;
    if (network && this.previousNetwork && timestamp > this.previousNetwork.timestamp) {
      const seconds = (timestamp - this.previousNetwork.timestamp) / 1000;
      upload = Math.max(0, network.sent - this.previousNetwork.sent) / seconds;
      download = Math.max(0, network.received - this.previousNetwork.received) / seconds;
    }
    if (network) this.previousNetwork = { ...network, timestamp };
    this.uploadSamples.push(upload);
    if (this.uploadSamples.length > 300) this.uploadSamples.shift();
    const connected = this.lastLatency !== null || Object.values(os.networkInterfaces()).flat().some((entry) => entry && !entry.internal);
    if (this.wasConnected === false && connected) this.reconnects += 1;
    this.wasConnected = connected;
    const preferred = hardware?.preferredGpu || selectPreferredGpu(hardware?.gpus || []);
    const fallbackGpu = preferred ? {
      name: preferred.name,
      memoryTotalMb: number(preferred.adapterRamBytes, 0) / 1024 ** 2,
      dedicated: !preferred.integrated,
      integrated: Boolean(preferred.integrated),
      source: "Windows-CIM"
    } : null;
    return {
      timestamp,
      gpu: nvidia || fallbackGpu,
      cpu: {
        model: hardware?.cpu?.name || os.cpus()?.[0]?.model || "Nicht verfügbar",
        utilizationPercent: cpu.total,
        perCorePercent: cpu.perCore,
        clockMhz: cpu.clockMhz,
        temperatureC: null,
        powerWatts: null,
        source: "Windows CPU-Zeit"
      },
      ram: {
        usedBytes: usedRam,
        totalBytes: totalRam,
        usedGb: usedRam / 1024 ** 3,
        totalGb: totalRam / 1024 ** 3,
        percent: totalRam > 0 ? usedRam / totalRam * 100 : 0,
        source: "Windows-Arbeitsspeicher"
      },
      network: {
        connected,
        uploadBytesPerSecond: upload,
        averageUploadBytesPerSecond: this.uploadSamples.reduce((sum, value) => sum + value, 0) / Math.max(1, this.uploadSamples.length),
        downloadBytesPerSecond: download,
        latencyMs: this.lastLatency,
        reconnects: this.reconnects,
        unstable: !connected || this.lastLatency === null || this.lastLatency > 100,
        source: "Windows-Netzwerkadapter und ICMP"
      }
    };
  }
}

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

function runCpuLoadWorker(durationMs) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      const crypto = require('node:crypto');
      const end = Date.now() + workerData.durationMs;
      let iterations = 0;
      let value = Buffer.alloc(1024 * 1024, 7);
      while (Date.now() < end) {
        value = crypto.createHash('sha256').update(value).digest();
        iterations += 1;
      }
      parentPort.postMessage({ iterations });
    `, { eval: true, workerData: { durationMs } });
    worker.once("message", resolve);
    worker.once("error", reject);
  });
}

async function runCpuLoadTest(durationSeconds = 10) {
  const duration = Math.max(5, Math.min(30, Math.round(Number(durationSeconds) || 10)));
  const workers = Math.max(1, Math.min(8, os.cpus().length));
  const startedAt = Date.now();
  const results = await Promise.all(Array.from({ length: workers }, () => runCpuLoadWorker(duration * 1000)));
  return {
    type: "cpu",
    durationSeconds: duration,
    workers,
    elapsedMs: Date.now() - startedAt,
    iterations: results.reduce((sum, result) => sum + number(result.iterations, 0), 0),
    completed: true
  };
}

module.exports = {
  SystemTelemetrySampler,
  collectHardware,
  gpuScore,
  isIntegratedGpuName,
  runCpuLoadTest,
  runInternetTest,
  runPowerShell,
  selectPreferredGpu
};
