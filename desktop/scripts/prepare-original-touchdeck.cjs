"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.join(ROOT, "resources", "touchdeck-0802");
const EXE = path.join(OUTPUT, "CreatorHub.TouchDeck.exe");
const REPO = "https://github.com/dannymeienbrock99-prog/CrazyBattoSoftwareManager_vol.1.git";
const COMMIT = "51be33d29c07f50323b19d58782804af391b8394";

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
  run("git", ["init"], tmp);
  run("git", ["remote", "add", "origin", REPO], tmp);
  run("git", ["fetch", "--depth", "1", "origin", COMMIT], tmp);
  run("git", ["checkout", "--detach", "FETCH_HEAD"], tmp);

  const resolved = execFileSync("git", ["rev-parse", "HEAD"], { cwd: tmp, encoding: "utf8" }).trim();
  if (resolved.toLowerCase() !== COMMIT.toLowerCase()) {
    throw new Error(`TouchDeck source mismatch: expected ${COMMIT}, got ${resolved}`);
  }

  fs.rmSync(OUTPUT, { recursive: true, force: true });
  fs.mkdirSync(OUTPUT, { recursive: true });
  const project = path.join(tmp, "ControllerHub.Desktop", "ControllerHub.Desktop.csproj");
  run("dotnet", ["publish", project, "-c", "Release", "-r", "win-x64", "--self-contained", "true", "-o", OUTPUT], tmp);

  if (!fs.existsSync(EXE) || fs.statSync(EXE).size < 1024 * 1024) {
    throw new Error(`Original TouchDeck executable was not produced: ${EXE}`);
  }
  fs.writeFileSync(path.join(OUTPUT, "SOURCE-COMMIT.txt"), `${COMMIT}\r\n`, "utf8");
  console.log(`Original 02.08.2026 TouchDeck prepared from ${COMMIT}.`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
