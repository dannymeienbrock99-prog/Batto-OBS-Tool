$ErrorActionPreference = "Stop"

$projectDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$programFile = Join-Path $projectDirectory "Program.cs"
$program = Get-Content $programFile -Raw

$sourceMatch = [regex]::Match(
  $program,
  'private const string HostSource = """\r?\n(?<source>.*?)\r?\n""";',
  [Text.RegularExpressions.RegexOptions]::Singleline
)
if (-not $sourceMatch.Success) {
  throw "Die eingebettete RedLoader-Hostquelle wurde in Program.cs nicht gefunden."
}

$hostSource = $sourceMatch.Groups["source"].Value
foreach ($required in @(
  "using SonsSdk.Attributes;",
  "IOnInWorldUpdateReceiver",
  "OnInWorldUpdate",
  "OnSonsSceneInitialized",
  "private void WriteLog"
)) {
  if (-not $hostSource.Contains($required, [StringComparison]::Ordinal)) {
    throw "Die RedLoader-Hostquelle enthält den Pflichtteil nicht: $required"
  }
}

$temporary = Join-Path $env:RUNNER_TEMP ("CrazyBatto-SOTF-HostCompile-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force $temporary | Out-Null
try {
  @'
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <OutputType>Library</OutputType>
  </PropertyGroup>
</Project>
'@ | Set-Content -Encoding UTF8 (Join-Path $temporary "HostCompile.csproj")

  $hostSource | Set-Content -Encoding UTF8 (Join-Path $temporary "CrazyBattoSotfIntegrationMod.cs")

  @'
using System;

namespace SonsSdk
{
    public enum ESonsScene { Title, Game }

    public abstract class SonsMod
    {
        protected virtual void OnInitializeMod() { }
        protected virtual void OnSdkInitialized() { }
        protected virtual void OnGameStart() { }
        protected virtual void OnSonsSceneInitialized(ESonsScene sonsScene) { }
        protected void Log(object message) { }
    }
}

namespace SonsSdk.Attributes
{
    public interface IOnInWorldUpdateReceiver
    {
        void OnInWorldUpdate();
    }
}

namespace CrazyBatto.SotfDeathCounter.Core
{
    public sealed class DeathCounterOptions
    {
        public string Title { get; set; } = "";
        public bool CountKnockdowns { get; set; }
    }

    public sealed class JsonFileDeathCounterStore
    {
        public JsonFileDeathCounterStore(string path, Action<string>? log = null) { }
    }

    public sealed class DeathCounterModule
    {
        public DeathCounterModule(DeathCounterOptions? options = null, JsonFileDeathCounterStore? store = null, Action<string>? log = null) { }
    }
}

namespace CrazyBatto.SotfDeathCounter.LocalApi
{
    using CrazyBatto.SotfDeathCounter.Core;

    public sealed class LocalApiOptions
    {
        public int Port { get; set; }
        public bool EnableObsOverlay { get; set; }
    }

    public sealed class LocalApiOutput
    {
        public LocalApiOutput(LocalApiOptions? options = null, Action<string>? log = null) { }
        public void Start(DeathCounterModule module) { }
    }
}

namespace CrazyBatto.SotfDeathCounter.RedLoader
{
    using CrazyBatto.SotfDeathCounter.Core;

    public sealed class SotfAdapterOptions
    {
        public int ScanIntervalMilliseconds { get; set; }
        public int WorldScanIntervalMilliseconds { get; set; }
        public bool EnableRuntimeHooks { get; set; }
    }

    public sealed class SotfDeathCounterAdapter
    {
        public SotfDeathCounterAdapter(DeathCounterModule counter, string diagnosticsDirectory, SotfAdapterOptions? options = null, Action<string>? log = null) { }
        public void Start() { }
        public void BeginSession(string? sessionId = null) { }
        public void MarkAllOffline() { }
        public void Tick() { }
    }
}
'@ | Set-Content -Encoding UTF8 (Join-Path $temporary "RedLoaderApiStubs.cs")

  dotnet build (Join-Path $temporary "HostCompile.csproj") -c Release --nologo
  if ($LASTEXITCODE -ne 0) {
    throw "Die generierte RedLoader-Hostquelle lässt sich nicht kompilieren."
  }

  Write-Host "RedLoader-Hostquelle erfolgreich gegen die geprüften API-Signaturen kompiliert."
}
finally {
  Remove-Item -Recurse -Force $temporary -ErrorAction SilentlyContinue
}
