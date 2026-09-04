"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.join(ROOT, "resources", "touchdeck-0802");
const EXE = path.join(OUTPUT, "CreatorHub.TouchDeck.exe");
const COMMIT = "51be33d29c07f50323b19d58782804af391b8394";
const ARCHIVE_URL = `https://codeload.github.com/dannymeienbrock99-prog/CrazyBattoSoftwareManager_vol.1/zip/${COMMIT}`;

function run(file, args, cwd) {
  execFileSync(file, args, { cwd, stdio: "inherit", windowsHide: true });
}

if (process.platform !== "win32") {
  console.log("Original TouchDeck publish skipped: Windows build only.");
  process.exit(0);
}

if (fs.existsSync(EXE) && fs.statSync(EXE).size > 1024 * 1024) {
  console.log(`Original TouchDeck already prepared: ${EXE}`);
  process.exit(0);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "batto-touchdeck-0802-"));
try {
  const archive = path.join(tmp, "source.zip");
  const extract = path.join(tmp, "source");
  const ps = [
    "$ErrorActionPreference='Stop'",
    `$ProgressPreference='SilentlyContinue'`,
    `Invoke-WebRequest -UseBasicParsing -Uri '${ARCHIVE_URL}' -OutFile '${archive.replaceAll("'", "''")}'`,
    `Expand-Archive -LiteralPath '${archive.replaceAll("'", "''")}' -DestinationPath '${extract.replaceAll("'", "''")}' -Force`
  ].join("; ");
  run("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", ps], tmp);

  const roots = fs.readdirSync(extract, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  if (roots.length !== 1) throw new Error("TouchDeck source archive has an unexpected root layout.");
  const sourceRoot = path.join(extract, roots[0].name);
  const project = path.join(sourceRoot, "ControllerHub.Desktop", "ControllerHub.Desktop.csproj");
  if (!fs.existsSync(project)) throw new Error(`Original TouchDeck project missing in archive: ${project}`);

  fs.rmSync(OUTPUT, { recursive: true, force: true });
  fs.mkdirSync(OUTPUT, { recursive: true });
  run("dotnet", ["publish", project, "-c", "Release", "-r", "win-x64", "--self-contained", "true", "-o", OUTPUT], sourceRoot);

  if (!fs.existsSync(EXE) || fs.statSync(EXE).size < 1024 * 1024) {
    throw new Error(`Original TouchDeck executable was not produced: ${EXE}`);
  }
  fs.writeFileSync(path.join(OUTPUT, "SOURCE-COMMIT.txt"), `${COMMIT}\r\n`, "utf8");
  console.log(`Original 02.08.2026 TouchDeck prepared from exact commit ${COMMIT}.`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
