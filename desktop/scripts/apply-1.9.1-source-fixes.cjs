"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const MARKER = "BATTO_1_9_1_HOTFIX";

async function read(relative) {
  return fs.readFile(path.join(root, relative), "utf8");
}

async function write(relative, content) {
  await fs.writeFile(path.join(root, relative), content, "utf8");
}

async function patch(relative, transform) {
  const before = await read(relative);
  const after = transform(before);
  if (after !== before) await write(relative, after);
  return after;
}

function replaceRequired(source, search, replacement, label) {
  if (typeof search === "string") {
    if (!source.includes(search)) throw new Error(`Hotfix: ${label} wurde nicht gefunden.`);
    return source.replace(search, replacement);
  }
  if (!search.test(source)) throw new Error(`Hotfix: ${label} wurde nicht gefunden.`);
  search.lastIndex = 0;
  return source.replace(search, replacement);
}

function findBalancedBlockEnd(source, openingBraceIndex) {
  let depth = 0;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = openingBraceIndex; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === quote) quote = "";
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  throw new Error("Hotfix: JavaScript-Block hat kein Ende.");
}

function replaceFunction(source, functionName, replacement) {
  const patterns = [
    `async function ${functionName}(`,
    `function ${functionName}(`
  ];
  const start = patterns.map((pattern) => source.indexOf(pattern)).find((index) => index >= 0);
  if (start === undefined) {
    if (source.includes(replacement.trim().slice(0, 48))) return source;
    throw new Error(`Hotfix: Funktion ${functionName} wurde nicht gefunden.`);
  }
  const brace = source.indexOf("{", start);
  const end = findBalancedBlockEnd(source, brace);
  return source.slice(0, start) + replacement + source.slice(end);
}

function removeIfBlockContaining(source, needle) {
  const needleIndex = source.indexOf(needle);
  if (needleIndex < 0) return source;
  const start = source.lastIndexOf("if (", needleIndex);
  if (start < 0) throw new Error(`Hotfix: Bedingung für ${needle} wurde nicht gefunden.`);
  const brace = source.indexOf("{", needleIndex);
  const end = findBalancedBlockEnd(source, brace);
  let nextEnd = end;
  while (source[nextEnd] === "\r" || source[nextEnd] === "\n" || source[nextEnd] === " ") nextEnd += 1;
  return source.slice(0, start) + source.slice(nextEnd);
}

async function patchMain() {
  await patch("src/main.cjs", (source) => {
    if (!source.includes("normalizeLocalObsHost")) {
      source = replaceRequired(
        source,
        'const { ObsWebSocketClient } = require("./services/obs-websocket.cjs");',
        'const { ObsWebSocketClient, normalizeLocalObsHost } = require("./services/obs-websocket.cjs");',
        "OBS-Import"
      );
    }
    if (!source.includes(MARKER)) {
      source = replaceRequired(
        source,
        'app.setName("Batto OBS Tool");',
        `app.setName("Batto OBS Tool");\n\n// ${MARKER}\nconst singleInstanceLock = app.requestSingleInstanceLock();\nif (!singleInstanceLock) {\n  app.exit(0);\n}\napp.on("second-instance", () => {\n  if (!mainWindow || mainWindow.isDestroyed()) return;\n  if (mainWindow.isMinimized()) mainWindow.restore();\n  mainWindow.show();\n  mainWindow.focus();\n});`,
        "Single-Instance-Sperre"
      );
    }
    if (!source.includes("let moduleErrors = {}")) {
      source = replaceRequired(
        source,
        "let latestTelemetry = null;",
        "let latestTelemetry = null;\nlet moduleErrors = {};",
        "Modulfehler-Zustand"
      );
    }
    const startModules = `async function startLocalModules() {
  moduleErrors = {};
  const monitoringRoot = path.join(__dirname, "..", "modules", "encoder-monitoring-overlay", "web");
  try {
    monitoringServer = new MonitoringOverlayServer({
      port: 17822,
      webRoot: monitoringRoot,
      configFile: userDataFile("encoder-monitoring-layouts.json"),
      historySize: 600
    });
    await monitoringServer.start();
  } catch (error) {
    moduleErrors.monitoring = errorPayload(error);
    monitoringServer = null;
    console.error("Monitoring-Overlay konnte nicht starten:", error);
  }

  try {
    holoServer = new TwitchHoloServer({
      preferredPort: 17823,
      webRoot: path.join(__dirname, "..", "modules", "twitch-holo-chat", "web")
    });
    await holoServer.start();
  } catch (error) {
    moduleErrors.twitchHolo = errorPayload(error);
    holoServer = null;
    console.error("Twitch-Hologramm konnte nicht starten:", error);
  }
}`;
    source = replaceFunction(source, "startLocalModules", startModules);
    source = source.replace(
      'const host = String(input.host || current.obs.host || "127.0.0.1").trim();',
      'const host = normalizeLocalObsHost(input.host || current.obs.host || "127.0.0.1");'
    );
    if (!source.includes("moduleErrors: { ...moduleErrors }")) {
      source = replaceRequired(
        source,
        'twitchHolo: holoServer?.status() || { running: false }',
        'twitchHolo: holoServer?.status() || { running: false },\n    moduleErrors: { ...moduleErrors }',
        "Modulfehler im Status"
      );
    }
    return source;
  });
}

async function patchHardware() {
  await patch("src/services/hardware.cjs", (source) => source.replaceAll(
    '${env:ProgramFiles(x86)}',
    "$([Environment]::GetFolderPath('ProgramFilesX86'))"
  ));
}

async function patchRenderer() {
  await patch("src/renderer/index.html", (source) => {
    source = source.replaceAll("1.9.0", "1.9.1");
    source = source.replace(
      '<input id="obs-host" value="127.0.0.1" autocomplete="off">',
      '<input id="obs-host" value="127.0.0.1" autocomplete="off" readonly title="Batto OBS Tool verbindet ausschließlich das lokale OBS auf diesem PC.">'
    );
    return source;
  });

  await patch("src/renderer/app.js", (source) => {
    source = source.replace(
      'host: byId("obs-host").value,',
      'host: "127.0.0.1",'
    );
    source = source.replace(
      'byId("obs-host").value = settings.obs?.host || "127.0.0.1";',
      'byId("obs-host").value = "127.0.0.1";'
    );
    source = source.replace(
      'byId("deck-action-type").addEventListener("change", fillDeckInspector);',
      'byId("deck-action-type").addEventListener("change", () => { byId("deck-value-row").hidden = !["obs:scene.set", "url"].includes(byId("deck-action-type").value); });'
    );

    const monitoringFunction = [
      'function applyModuleFrame(frame, status, label) {',
      '    if (!status?.running || !status.editorUrl) {',
      '      frame.removeAttribute("src");',
      '      frame.dataset.baseUrl = "";',
      '      const message = status?.error?.message || `${label} ist nicht gestartet.`;',
      '      frame.srcdoc = `<!doctype html><html><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#080d14;color:#d7e4ee;font:16px Segoe UI,Arial,sans-serif"><div style="max-width:620px;padding:28px;text-align:center"><h2>${escapeHtml(label)}</h2><p>${escapeHtml(message)}</p></div></body></html>`;',
      '      return;',
      '    }',
      '    frame.removeAttribute("srcdoc");',
      '    if (frame.dataset.baseUrl === status.editorUrl) return;',
      '    frame.dataset.baseUrl = status.editorUrl;',
      '    const separator = status.editorUrl.includes("?") ? "&" : "?";',
      '    frame.src = `${status.editorUrl}${separator}embedded=1&version=${encodeURIComponent(state?.product?.version || "1.9.1")}`;',
      '  }',
      '',
      '  async function loadMonitoringFrame() {',
      '    try {',
      '      const status = await api.getMonitoringStatus();',
      '      byId("monitoring-url").textContent = status.overlayUrl || "Nicht gestartet";',
      '      applyModuleFrame(byId("monitoring-frame"), status, "Monitoring-Overlay");',
      '    } catch (error) {',
      '      applyModuleFrame(byId("monitoring-frame"), { running: false, error: { message: errorMessage(error) } }, "Monitoring-Overlay");',
      '      showToast(errorMessage(error), "error");',
      '    }',
      '  }'
    ].join("\n");
    source = replaceFunction(source, "loadMonitoringFrame", monitoringFunction);
    const holoFunction = [
      'async function loadHoloFrame() {',
      '    try {',
      '      const status = await api.getHoloStatus();',
      '      byId("holo-url").textContent = status.overlayUrl || "Nicht gestartet";',
      '      applyModuleFrame(byId("holo-frame"), status, "Twitch-Hologramm");',
      '    } catch (error) {',
      '      applyModuleFrame(byId("holo-frame"), { running: false, error: { message: errorMessage(error) } }, "Twitch-Hologramm");',
      '      showToast(errorMessage(error), "error");',
      '    }',
      '  }'
    ].join("\n");
    source = replaceFunction(source, "loadHoloFrame", holoFunction);
    return source;
  });

  await patch("src/renderer/styles.css", (source) => {
    if (source.includes("BATTO_1_9_1_LAYOUT_FIX")) return source;
    return `${source}\n\n/* BATTO_1_9_1_LAYOUT_FIX */\nhtml, body { max-width: 100%; overflow-x: hidden; }\n.app-shell { width: 100vw; max-width: 100%; grid-template-columns: minmax(220px, 260px) minmax(0, 1fr); }\n.workspace, .topbar, .content, .view, .panel, .section-heading, .obs-layout, .recommendation-layout, .two-column-cards { min-width: 0; }\n.sidebar nav { display: grid; gap: 6px; }\n.nav-button { width: 100%; min-height: 44px; margin: 0; }\n.module-frame { width: 100%; min-width: 0; background: #080d14; }\nimg, iframe { max-width: 100%; }\n@media (max-width: 1100px) {\n  .app-shell { grid-template-columns: 210px minmax(0, 1fr); }\n  .content { padding-right: 16px; padding-left: 16px; }\n}\n@media (max-width: 820px) {\n  .app-shell { grid-template-columns: 1fr; }\n  .sidebar { position: relative; height: auto; }\n  .sidebar nav { grid-template-columns: repeat(2, minmax(0, 1fr)); }\n}\n`;
  });
}

async function patchMonitoringModule() {
  await patch("modules/encoder-monitoring-overlay/web/editor.html", (source) => source.replace(
    /\s*<button id="show-test-values"[^>]*>[^<]*<\/button>/g,
    ""
  ));
  await patch("modules/encoder-monitoring-overlay/web/editor.js", (source) => {
    source = source.replace(/^\s*showTestValues:\s*byId\("show-test-values"\),?\s*$/gm, "");
    if (source.includes("function showTestValues(")) {
      source = replaceFunction(source, "showTestValues", "");
    }
    source = source.replace(/^\s*ui\.showTestValues\.addEventListener\([^\n]+\);\s*$/gm, "");
    return source;
  });
  await patch("modules/encoder-monitoring-overlay/src/server.cjs", (source) => {
    source = source.replace(/,\s*\n\s*createTestTelemetry/, "");
    source = source.replace(/\n\s*createTestTelemetry,?/, "");
    source = removeIfBlockContaining(source, 'pathname === "/api/test"');
    source = source.replace(/;\s*frame-ancestors[^\"]*/g, "");
    return source;
  });
}

async function patchHoloServer() {
  await patch("src/services/twitch-holo-server.cjs", (source) => {
    if (!source.includes('url.pathname === "/health"')) {
      source = replaceRequired(
        source,
        '    let filename;\n    if (url.pathname === "/" || url.pathname === "/editor") filename = "editor.html";',
        '    if (url.pathname === "/health") {\n      const body = Buffer.from(JSON.stringify(this.status()), "utf8");\n      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Content-Length": body.length, "Cache-Control": "no-store" });\n      response.end(body);\n      return;\n    }\n    let filename;\n    if (url.pathname === "/" || url.pathname === "/editor") filename = "editor.html";',
        "Hologramm-Healthcheck"
      );
    }
    if (!source.includes('"Cross-Origin-Resource-Policy": "cross-origin"')) {
      source = replaceRequired(
        source,
        '        "X-Content-Type-Options": "nosniff",',
        '        "X-Content-Type-Options": "nosniff",\n        "Cross-Origin-Resource-Policy": "cross-origin",\n        "Access-Control-Allow-Origin": "*",',
        "Hologramm-Einbettungsheader"
      );
    }
    return source;
  });
}

async function verify() {
  const packageJson = JSON.parse(await read("package.json"));
  if (packageJson.version !== "1.9.1") throw new Error("Paketversion ist nicht 1.9.1.");
  if (packageJson.build?.nsis?.runAfterFinish !== false) throw new Error("Installer würde die App automatisch starten.");
  if (packageJson.build?.nsis?.oneClick !== false) throw new Error("Installationsordner wäre nicht auswählbar.");

  const files = [
    "src/main.cjs",
    "src/preload.cjs",
    "src/services/hardware.cjs",
    "src/services/obs-websocket.cjs",
    "src/services/store.cjs",
    "src/services/telemetry.cjs",
    "src/services/twitch-holo-server.cjs",
    "src/renderer/index.html",
    "src/renderer/app.js",
    "src/renderer/styles.css",
    "modules/encoder-monitoring-overlay/web/editor.html",
    "modules/encoder-monitoring-overlay/web/editor.js",
    "modules/encoder-monitoring-overlay/src/server.cjs"
  ];
  const contents = await Promise.all(files.map(async (file) => [file, await read(file)]));
  for (const [file, content] of contents) {
    if (/Creator[ -]?Hub/i.test(content)) throw new Error(`Verbotene Altbezeichnung in ${file}.`);
  }
  const hardware = await read("src/services/hardware.cjs");
  if (hardware.includes("${env:ProgramFiles(x86)}")) throw new Error("ProgramFiles(x86)-Syntaxfehler ist noch vorhanden.");
  const main = await read("src/main.cjs");
  if (!main.includes(MARKER) || !main.includes("requestSingleInstanceLock")) throw new Error("Single-Instance-Sperre fehlt.");
  const monitoring = `${await read("modules/encoder-monitoring-overlay/web/editor.html")}\n${await read("modules/encoder-monitoring-overlay/web/editor.js")}\n${await read("modules/encoder-monitoring-overlay/src/server.cjs")}`;
  if (/show-test-values|Testwerte anzeigen|pathname === "\/api\/test"|createTestTelemetry/.test(monitoring)) {
    throw new Error("Interner Monitoring-Democode ist noch vorhanden.");
  }
  if (/frame-ancestors/.test(await read("modules/encoder-monitoring-overlay/src/server.cjs"))) {
    throw new Error("Monitoring-Editor würde weiterhin im Electron-Fenster blockiert.");
  }

  const jsFiles = files.filter((file) => /\.(?:cjs|js)$/.test(file));
  for (const file of jsFiles) {
    execFileSync(process.execPath, ["--check", path.join(root, file)], { stdio: "inherit" });
  }
}

async function main() {
  await patchMain();
  await patchHardware();
  await patchRenderer();
  await patchMonitoringModule();
  await patchHoloServer();
  await verify();
  process.stdout.write("Batto OBS Tool 1.9.1: Quellcode-Hotfix vollständig angewendet.\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
