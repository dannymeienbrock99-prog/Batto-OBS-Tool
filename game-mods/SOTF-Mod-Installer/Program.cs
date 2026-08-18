using System.Diagnostics;
using System.IO.Compression;
using System.Text;

namespace CrazyBatto.SotfModInstaller;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new InstallerForm());
    }
}

internal sealed class InstallerForm : Form
{
    private const string SourceArchiveName = "CrazyBatto-SOTF-DeathCounter-Module-v0.3.0-source.zip";
    private readonly TextBox _gamePath = new() { Dock = DockStyle.Fill };
    private readonly Button _browse = new() { Text = "Ordner wählen", AutoSize = true };
    private readonly Button _install = new() { Text = "Mod bauen und installieren", AutoSize = true, Height = 40 };
    private readonly ProgressBar _progress = new() { Dock = DockStyle.Fill, Style = ProgressBarStyle.Marquee, Visible = false };
    private readonly TextBox _log = new() { Dock = DockStyle.Fill, Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical };
    private readonly Label _status = new() { Dock = DockStyle.Fill, AutoSize = true, ForeColor = Color.FromArgb(165, 181, 196) };

    public InstallerForm()
    {
        Text = "Crazy_Batto SOTF Mod-Installer 0.3.0";
        Width = 820;
        Height = 590;
        MinimumSize = new Size(680, 480);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(8, 14, 22);
        ForeColor = Color.White;
        Font = new Font("Segoe UI", 10F);

        var root = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(20), RowCount = 7, ColumnCount = 1 };
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100F));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        Controls.Add(root);

        var title = new Label { Text = "Crazy_Batto · Sons of the Forest Integration", AutoSize = true, Font = new Font("Segoe UI Semibold", 18F), ForeColor = Color.FromArgb(90, 220, 255), Margin = new Padding(0, 0, 0, 6) };
        var info = new Label { Text = "Dieser Installer baut das mitgelieferte Modul gegen deine echte Sons-of-the-Forest-/RedLoader-Installation und kopiert anschließend die Mod-Dateien in den Mods-Ordner. Es wird kein ungetestetes Fremd-DLL-Paket verwendet.", AutoSize = true, MaximumSize = new Size(750, 0), ForeColor = Color.FromArgb(185, 199, 210), Margin = new Padding(0, 0, 0, 14) };
        root.Controls.Add(title);
        root.Controls.Add(info);

        var pathRow = new TableLayoutPanel { Dock = DockStyle.Fill, AutoSize = true, ColumnCount = 2, Margin = new Padding(0, 0, 0, 10) };
        pathRow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));
        pathRow.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        _gamePath.BackColor = Color.FromArgb(13, 22, 32);
        _gamePath.ForeColor = Color.White;
        _gamePath.BorderStyle = BorderStyle.FixedSingle;
        _gamePath.Margin = new Padding(0, 0, 8, 0);
        _gamePath.Text = DetectGameDirectory() ?? string.Empty;
        pathRow.Controls.Add(_gamePath, 0, 0);
        pathRow.Controls.Add(_browse, 1, 0);
        root.Controls.Add(pathRow);

        var requirement = new Label { Text = "Voraussetzung: RedLoader wurde installiert und Sons of the Forest mindestens einmal mit RedLoader gestartet. Ein .NET-SDK mit Unterstützung für .NET 6 muss vorhanden sein.", AutoSize = true, MaximumSize = new Size(750, 0), ForeColor = Color.FromArgb(255, 201, 100), Margin = new Padding(0, 0, 0, 10) };
        root.Controls.Add(requirement);

        var actionRow = new TableLayoutPanel { Dock = DockStyle.Fill, AutoSize = true, ColumnCount = 2, Margin = new Padding(0, 0, 0, 10) };
        actionRow.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        actionRow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));
        StyleButton(_browse, false);
        StyleButton(_install, true);
        actionRow.Controls.Add(_install, 0, 0);
        actionRow.Controls.Add(_progress, 1, 0);
        root.Controls.Add(actionRow);

        _log.BackColor = Color.FromArgb(7, 12, 18);
        _log.ForeColor = Color.FromArgb(205, 219, 230);
        _log.BorderStyle = BorderStyle.FixedSingle;
        _log.Font = new Font("Consolas", 9F);
        root.Controls.Add(_log);
        root.Controls.Add(_status);

        _browse.Click += (_, _) => Browse();
        _install.Click += async (_, _) => await InstallAsync();
        Append("Bereit. Spielordner prüfen und anschließend die Installation starten.");
    }

    private static void StyleButton(Button button, bool primary)
    {
        button.FlatStyle = FlatStyle.Flat;
        button.FlatAppearance.BorderColor = primary ? Color.FromArgb(70, 205, 242) : Color.FromArgb(63, 82, 100);
        button.BackColor = primary ? Color.FromArgb(27, 122, 153) : Color.FromArgb(27, 38, 49);
        button.ForeColor = Color.White;
        button.Padding = new Padding(12, 5, 12, 5);
        button.Cursor = Cursors.Hand;
    }

    private void Browse()
    {
        using var dialog = new FolderBrowserDialog
        {
            Description = "Sons-of-the-Forest-Spielordner auswählen",
            UseDescriptionForTitle = true,
            SelectedPath = Directory.Exists(_gamePath.Text) ? _gamePath.Text : string.Empty
        };
        if (dialog.ShowDialog(this) == DialogResult.OK) _gamePath.Text = dialog.SelectedPath;
    }

    private async Task InstallAsync()
    {
        var gameDirectory = Path.GetFullPath(_gamePath.Text.Trim().Trim('"'));
        var sourceArchive = Path.Combine(AppContext.BaseDirectory, SourceArchiveName);
        var gameExecutable = Path.Combine(gameDirectory, "SonsOfTheForest.exe");

        if (!File.Exists(gameExecutable)) { Fail("SonsOfTheForest.exe wurde im gewählten Ordner nicht gefunden."); return; }
        var missingRedLoaderFiles = RequiredRedLoaderFiles(gameDirectory).Where(file => !File.Exists(file)).ToArray();
        if (missingRedLoaderFiles.Length > 0)
        {
            var relative = missingRedLoaderFiles.Select(file => Path.GetRelativePath(gameDirectory, file));
            Fail("RedLoader ist nicht vollständig vorbereitet. Installiere RedLoader, starte das Spiel einmal und versuche es erneut.\n\nFehlende Dateien:\n" + string.Join("\n", relative));
            return;
        }
        if (!File.Exists(sourceArchive)) { Fail($"Mitgeliefertes Quellmodul fehlt: {SourceArchiveName}"); return; }

        _install.Enabled = false;
        _browse.Enabled = false;
        _progress.Visible = true;
        _status.Text = "Mod wird gegen die lokale Spielinstallation gebaut …";

        var temporary = Path.Combine(Path.GetTempPath(), $"CrazyBatto-SOTF-{Guid.NewGuid():N}");
        try
        {
            Directory.CreateDirectory(temporary);
            Append($"Quellmodul entpacken: {temporary}");
            ZipFile.ExtractToDirectory(sourceArchive, temporary);
            var sourceRoot = Directory.GetDirectories(temporary).SingleOrDefault()
                ?? throw new InvalidOperationException("Das Quellarchiv enthält keinen eindeutigen Modulordner.");
            var hostDirectory = Path.Combine(sourceRoot, "src", "CrazyBatto.SotfIntegration.ModHost");
            Directory.CreateDirectory(hostDirectory);
            WriteHostProject(hostDirectory);

            var dotnet = FindDotnet();
            if (dotnet is null) throw new InvalidOperationException("Kein dotnet-SDK gefunden. Installiere das aktuelle .NET SDK und starte den Installer erneut.");
            var sdkResult = await RunAsync(dotnet, "--list-sdks", sourceRoot);
            if (sdkResult.ExitCode != 0 || string.IsNullOrWhiteSpace(sdkResult.Output))
                throw new InvalidOperationException("dotnet wurde gefunden, aber kein verwendbares .NET SDK. Installiere ein aktuelles .NET SDK.");
            Append("Installierte .NET-SDKs:");
            Append(sdkResult.Output);
            Append("Release-Build wird gestartet …");

            var arguments = $"build \"{Path.Combine(hostDirectory, "CrazyBatto.SotfIntegration.ModHost.csproj")}\" -c Release -p:GameDir=\"{gameDirectory}\" --nologo";
            var result = await RunAsync(dotnet, arguments, sourceRoot);
            Append(result.Output);
            if (result.ExitCode != 0) throw new InvalidOperationException($"Der Mod-Build ist mit Fehlercode {result.ExitCode} fehlgeschlagen. Siehe Protokoll.");

            var output = Path.Combine(hostDirectory, "bin", "Release", "net6.0");
            var mainDll = Path.Combine(output, "CrazyBatto.SotfIntegration.dll");
            var manifest = Path.Combine(output, "manifest.json");
            if (!File.Exists(mainDll) || !File.Exists(manifest)) throw new InvalidOperationException("Build war beendet, aber Haupt-DLL oder manifest.json fehlt.");

            var modsDirectory = Path.Combine(gameDirectory, "Mods");
            var metadataDirectory = Path.Combine(modsDirectory, "CrazyBatto.SotfIntegration");
            Directory.CreateDirectory(modsDirectory);
            Directory.CreateDirectory(metadataDirectory);

            foreach (var file in Directory.EnumerateFiles(output, "CrazyBatto.*.dll"))
            {
                var target = Path.Combine(modsDirectory, Path.GetFileName(file));
                File.Copy(file, target, true);
                Append($"Installiert: Mods\\{Path.GetFileName(file)}");
            }
            File.Copy(manifest, Path.Combine(metadataDirectory, "manifest.json"), true);
            Append("Installiert: Mods\\CrazyBatto.SotfIntegration\\manifest.json");

            _status.Text = "Installation abgeschlossen.";
            MessageBox.Show(this,
                "Die Crazy_Batto-SOTF-Mod wurde gebaut und in den Mods-Ordner installiert.\n\nStarte Sons of the Forest über RedLoader.\nDeath-Counter-Overlay: http://127.0.0.1:19447/overlay",
                "SOTF-Mod installiert", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        catch (Exception ex)
        {
            Append($"FEHLER: {ex.Message}");
            Fail(ex.Message);
        }
        finally
        {
            try { if (Directory.Exists(temporary)) Directory.Delete(temporary, true); } catch { }
            _install.Enabled = true;
            _browse.Enabled = true;
            _progress.Visible = false;
        }
    }

    private static IEnumerable<string> RequiredRedLoaderFiles(string gameDirectory)
    {
        var net6 = Path.Combine(gameDirectory, "_RedLoader", "net6");
        var game = Path.Combine(gameDirectory, "_RedLoader", "Game");
        foreach (var name in new[] { "SonsSdk.dll", "RedLoader.dll", "Il2CppInterop.Common.dll", "Il2CppInterop.Runtime.dll", "0Harmony.dll" })
            yield return Path.Combine(net6, name);
        foreach (var name in new[] { "Il2Cppmscorlib.dll", "Sons.dll", "Endnight.dll", "Sons.Multiplayer.dll", "UnityEngine.dll", "UnityEngine.CoreModule.dll", "bolt.dll", "Bolt.Unity.dll", "bolt.user.dll" })
            yield return Path.Combine(game, name);
    }

    private static void WriteHostProject(string directory)
    {
        File.WriteAllText(Path.Combine(directory, "CrazyBatto.SotfIntegration.ModHost.csproj"), HostProject, new UTF8Encoding(false));
        File.WriteAllText(Path.Combine(directory, "CrazyBattoSotfIntegrationMod.cs"), HostSource, new UTF8Encoding(false));
        File.WriteAllText(Path.Combine(directory, "manifest.json"), Manifest, new UTF8Encoding(false));
    }

    private static string? FindDotnet()
    {
        var candidates = new[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "dotnet", "dotnet.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "dotnet", "dotnet.exe")
        };
        return candidates.FirstOrDefault(File.Exists);
    }

    private static async Task<(int ExitCode, string Output)> RunAsync(string fileName, string arguments, string workingDirectory)
    {
        var output = new StringBuilder();
        using var process = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = fileName,
                Arguments = arguments,
                WorkingDirectory = workingDirectory,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            },
            EnableRaisingEvents = true
        };
        process.OutputDataReceived += (_, args) => { if (args.Data is not null) output.AppendLine(args.Data); };
        process.ErrorDataReceived += (_, args) => { if (args.Data is not null) output.AppendLine(args.Data); };
        process.Start();
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        await process.WaitForExitAsync();
        return (process.ExitCode, output.ToString());
    }

    private static string? DetectGameDirectory()
    {
        var roots = new List<string>
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Steam", "steamapps", "common", "Sons Of The Forest"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Steam", "steamapps", "common", "Sons Of The Forest")
        };
        for (var letter = 'C'; letter <= 'Z'; letter++)
        {
            roots.Add($@"{letter}:\Steam\steamapps\common\Sons Of The Forest");
            roots.Add($@"{letter}:\SteamLibrary\steamapps\common\Sons Of The Forest");
        }
        return roots.FirstOrDefault(path => File.Exists(Path.Combine(path, "SonsOfTheForest.exe")));
    }

    private void Append(string message)
    {
        if (InvokeRequired) { BeginInvoke(() => Append(message)); return; }
        _log.AppendText($"[{DateTime.Now:HH:mm:ss}] {message.TrimEnd()}\r\n");
    }

    private void Fail(string message)
    {
        _status.Text = "Installation nicht abgeschlossen.";
        MessageBox.Show(this, message, "SOTF-Mod-Installer", MessageBoxButtons.OK, MessageBoxIcon.Error);
    }

    private const string HostProject = """
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net6.0</TargetFramework>
    <AssemblyName>CrazyBatto.SotfIntegration</AssemblyName>
    <RootNamespace>CrazyBatto.SotfIntegration</RootNamespace>
    <Version>0.3.0</Version>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>
  <ItemGroup>
    <ProjectReference Include="..\CrazyBatto.SotfDeathCounter.Core\CrazyBatto.SotfDeathCounter.Core.csproj" />
    <ProjectReference Include="..\CrazyBatto.SotfDeathCounter.RedLoader\CrazyBatto.SotfDeathCounter.RedLoader.csproj" />
    <ProjectReference Include="..\CrazyBatto.SotfDeathCounter.LocalApi\CrazyBatto.SotfDeathCounter.LocalApi.csproj" />
  </ItemGroup>
  <ItemGroup>
    <Reference Include="SonsSdk"><HintPath>$(GameDir)\_RedLoader\net6\SonsSdk.dll</HintPath><Private>false</Private></Reference>
  </ItemGroup>
  <ItemGroup>
    <None Update="manifest.json"><CopyToOutputDirectory>Always</CopyToOutputDirectory></None>
  </ItemGroup>
</Project>
""";

    private const string HostSource = """
using CrazyBatto.SotfDeathCounter.Core;
using CrazyBatto.SotfDeathCounter.LocalApi;
using CrazyBatto.SotfDeathCounter.RedLoader;
using SonsSdk;
using SonsSdk.Attributes;

namespace CrazyBatto.SotfIntegration;

public sealed class CrazyBattoSotfIntegrationMod : SonsMod, IOnInWorldUpdateReceiver
{
    private DeathCounterModule? _counter;
    private SotfDeathCounterAdapter? _adapter;
    private LocalApiOutput? _overlay;

    protected override void OnInitializeMod()
    {
        var dataDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Crazy_Batto", "SOTFIntegration");
        Directory.CreateDirectory(dataDirectory);
        var store = new JsonFileDeathCounterStore(Path.Combine(dataDirectory, "stats.json"), WriteLog);
        _counter = new DeathCounterModule(
            new DeathCounterOptions { Title = "SONS OF THE FOREST – TODESZÄHLER", CountKnockdowns = false },
            store, WriteLog);
        _adapter = new SotfDeathCounterAdapter(
            _counter, dataDirectory,
            new SotfAdapterOptions { EnableRuntimeHooks = true, ScanIntervalMilliseconds = 1000, WorldScanIntervalMilliseconds = 2500 },
            WriteLog);
        WriteLog("Crazy_Batto SOTF Integration 0.3.0 initialisiert.");
    }

    protected override void OnSdkInitialized()
    {
        _adapter?.Start();
        if (_counter is null) return;
        _overlay = new LocalApiOutput(new LocalApiOptions { Port = 19447, EnableObsOverlay = true }, WriteLog);
        _overlay.Start(_counter);
        WriteLog("Death-Counter-Overlay: http://127.0.0.1:19447/overlay");
    }

    protected override void OnGameStart() => _adapter?.BeginSession();

    protected override void OnSonsSceneInitialized(ESonsScene sonsScene)
    {
        if (sonsScene == ESonsScene.Title) _adapter?.MarkAllOffline();
    }

    public void OnInWorldUpdate() => _adapter?.Tick();

    private void WriteLog(string message) => Log(message);
}
""";

    private const string Manifest = """
{
  "$schema": "https://raw.githubusercontent.com/ToniMacaroni/RedLoader/main/MetadataSchema.json",
  "id": "CrazyBatto.SotfIntegration",
  "author": "Crazy_Batto / Team Alpha",
  "version": "0.3.0",
  "description": "Sons of the Forest Todeszähler mit automatischer Mitspieler-Erkennung und lokaler OBS-Browserquelle.",
  "gameVersion": "1.0.0",
  "type": "Mod",
  "url": "https://github.com/dannymeienbrock99-prog/Batto-OBS-Tool"
}
""";
}
