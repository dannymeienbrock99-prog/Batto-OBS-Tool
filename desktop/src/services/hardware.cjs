"use strict";

const crypto = require("node:crypto");
const os = require("node:os");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

function number(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}
function array(value) { return value == null ? [] : Array.isArray(value) ? value : [value]; }
function encodePowerShell(script) { return Buffer.from(script, "utf16le").toString("base64"); }
async function runPowerShell(script, options = {}) {
  if (process.platform !== "win32") throw new Error("Die vollständige Hardwarediagnose ist nur unter Windows verfügbar.");
  const { stdout } = await execFileAsync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodePowerShell(script)], {
    windowsHide: true,
    timeout: options.timeoutMs || 15000,
    maxBuffer: options.maxBuffer || 8 * 1024 * 1024
  });
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
  return list.length ? list.slice().sort((a, b) => gpuScore(b) - gpuScore(a))[0] : null;
}

async function collectHardware() {
  if (process.platform !== "win32") {
    return {
      platform: process.platform,
      scannedAt: new Date().toISOString(),
      cpu: { name: os.cpus()?.[0]?.model || "Nicht verfügbar", cores: os.cpus().length, threads: os.cpus().length },
      gpus: [], preferredGpu: null,
      memory: { totalBytes: os.totalmem(), totalGb: os.totalmem() / 1024 ** 3, modules: [] },
      mainboard: null, bios: null, monitors: [], disks: [], networkAdapters: [],
      os: { caption: os.type(), version: os.release(), architecture: os.arch() },
      obs: { installed: false, paths: [] },
      warning: "Vollständige Windows-CIM-Diagnose ist auf diesem Betriebssystem nicht verfügbar."
    };
  }

  const script = String.raw`
$ErrorActionPreference='SilentlyContinue'
$cpu=Get-CimInstance Win32_Processor | Select-Object -First 1 Name,Manufacturer,NumberOfCores,NumberOfLogicalProcessors,MaxClockSpeed,SocketDesignation,ProcessorId
$gpu=Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion,VideoProcessor,PNPDeviceID
$ram=Get-CimInstance Win32_PhysicalMemory | Select-Object Manufacturer,PartNumber,SerialNumber,Capacity,ConfiguredClockSpeed,Speed,DeviceLocator,BankLabel
$board=Get-CimInstance Win32_BaseBoard | Select-Object Manufacturer,Product,Version,SerialNumber
$bios=Get-CimInstance Win32_BIOS | Select-Object Manufacturer,SMBIOSBIOSVersion,ReleaseDate,SerialNumber
$disk=Get-CimInstance Win32_DiskDrive | Select-Object Model,Manufacturer,SerialNumber,Size,InterfaceType,MediaType,FirmwareRevision,Status
$net=Get-NetAdapter | Select-Object Name,InterfaceDescription,Status,LinkSpeed,MacAddress,MediaType
$os=Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber,OSArchitecture,LastBootUpTime
$mon=Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorID | ForEach-Object { [pscustomobject]@{ Name=([Text.Encoding]::ASCII.GetString($_.UserFriendlyName)).Trim([char]0); Manufacturer=([Text.Encoding]::ASCII.GetString($_.ManufacturerName)).Trim([char]0); Serial=([Text.Encoding]::ASCII.GetString($_.SerialNumberID)).Trim([char]0); Active=$_.Active; InstanceName=$_.InstanceName } }
$obs=@('C:\Program Files\obs-studio\bin\64bit\obs64.exe','C:\Program Files (x86)\obs-studio\bin\64bit\obs64.exe') | Where-Object { Test-Path $_ }
[pscustomobject]@{cpu=$cpu;gpus=@($gpu);memory=@($ram);board=$board;bios=$bios;disks=@($disk);networkAdapters=@($net);operatingSystem=$os;monitors=@($mon);obsPaths=@($obs)} | ConvertTo-Json -Depth 6 -Compress
`;
  const parsed = JSON.parse(await runPowerShell(script));
  const gpus = array(parsed.gpus).map((gpu) => ({
    name: gpu.Name || "Nicht verfügbar",
    adapterRamBytes: number(gpu.AdapterRAM, 0),
    adapterRamGb: number(gpu.AdapterRAM, 0) / 1024 ** 3,
    driverVersion: gpu.DriverVersion || "",
    videoProcessor: gpu.VideoProcessor || "",
    pnpDeviceId: gpu.PNPDeviceID || "",
    integrated: isIntegratedGpuName(gpu.Name)
  }));
  const modules = array(parsed.memory).map((module) => ({
    manufacturer: module.Manufacturer || "", partNumber: module.PartNumber || "", serialNumber: module.SerialNumber || "",
    capacityBytes: number(module.Capacity, 0), capacityGb: number(module.Capacity, 0) / 1024 ** 3,
    speedMt: number(module.ConfiguredClockSpeed ?? module.Speed), locator: module.DeviceLocator || module.BankLabel || ""
  }));
  const totalBytes = modules.reduce((sum, module) => sum + module.capacityBytes, 0) || os.totalmem();
  return {
    platform: "win32", scannedAt: new Date().toISOString(),
    cpu: parsed.cpu ? { name: parsed.cpu.Name || "Nicht verfügbar", manufacturer: parsed.cpu.Manufacturer || "", cores: number(parsed.cpu.NumberOfCores, os.cpus().length), threads: number(parsed.cpu.NumberOfLogicalProcessors, os.cpus().length), maxClockMhz: number(parsed.cpu.MaxClockSpeed), socket: parsed.cpu.SocketDesignation || "", processorId: parsed.cpu.ProcessorId || "" } : null,
    gpus, preferredGpu: selectPreferredGpu(gpus),
    memory: { totalBytes, totalGb: totalBytes / 1024 ** 3, modules },
    mainboard: parsed.board ? { manufacturer: parsed.board.Manufacturer || "", product: parsed.board.Product || "", version: parsed.board.Version || "", serialNumber: parsed.board.SerialNumber || "" } : null,
    bios: parsed.bios ? { manufacturer: parsed.bios.Manufacturer || "", version: parsed.bios.SMBIOSBIOSVersion || "", releaseDate: parsed.bios.ReleaseDate || "", serialNumber: parsed.bios.SerialNumber || "" } : null,
    monitors: array(parsed.monitors).map((m) => ({ name: m.Name || "Unbekannter Monitor", manufacturer: m.Manufacturer || "", serial: m.Serial || "", active: m.Active !== false, instanceName: m.InstanceName || "" })),
    disks: array(parsed.disks).map((d) => ({ model: d.Model || "Nicht verfügbar", manufacturer: d.Manufacturer || "", serialNumber: d.SerialNumber || "", sizeBytes: number(d.Size, 0), sizeGb: number(d.Size, 0) / 1024 ** 3, interfaceType: d.InterfaceType || "", mediaType: d.MediaType || "", firmware: d.FirmwareRevision || "", status: d.Status || "" })),
    networkAdapters: array(parsed.networkAdapters).map((a) => ({ name: a.Name || "", description: a.InterfaceDescription || "", status: a.Status || "", linkSpeed: a.LinkSpeed || "", macAddress: a.MacAddress || "", mediaType: a.MediaType || "" })),
    os: parsed.operatingSystem ? { caption: parsed.operatingSystem.Caption || "Windows", version: parsed.operatingSystem.Version || "", build: parsed.operatingSystem.BuildNumber || "", architecture: parsed.operatingSystem.OSArchitecture || os.arch(), lastBootUpTime: parsed.operatingSystem.LastBootUpTime || "" } : null,
    obs: { installed: array(parsed.obsPaths).length > 0, paths: array(parsed.obsPaths) }
  };
}

async function timedFetch(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal, cache: "no-store" }); }
  finally { clearTimeout(timer); }
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
  const uploadResponse = await timedFetch("https://speed.cloudflare.com/__up", { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: uploadPayload });
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
    testedAt: new Date().toISOString(), downloadedBytes: downloadBuffer.byteLength, uploadedBytes: uploadBytes,
    downloadMbps: downloadBuffer.byteLength * 8 / downloadSeconds / 1_000_000,
    uploadMbps: uploadBytes * 8 / uploadSeconds / 1_000_000,
    latencyMs: latencySamples.reduce((sum, value) => sum + value, 0) / latencySamples.length,
    provider: "Cloudflare Speed Test"
  };
}

module.exports = { collectHardware, gpuScore, isIntegratedGpuName, runInternetTest, runPowerShell, selectPreferredGpu };
