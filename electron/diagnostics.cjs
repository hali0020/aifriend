const {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  truncateSync,
  unlinkSync,
} = require("node:fs");
const { basename, join, resolve } = require("node:path");

const MAX_LOG_BYTES = 1024 * 1024;
const MAX_CHROMIUM_LOG_BYTES = 4 * 1024 * 1024;
const MAX_ARCHIVES = 3;
const MAX_DUMPS = 10;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function diagnosticsEnabled(argv = process.argv, environment = process.env) {
  return argv.includes("--diagnostics") || environment.AGENT_DIAGNOSTICS === "1";
}

function sanitizeDiagnosticText(value) {
  return String(value ?? "")
    .replace(/"[A-Za-z]:[\\/][^\r\n"<>|]{1,400}"/g, "[local-path]")
    .replace(/'[A-Za-z]:[\\/][^\r\n'<>|]{1,400}'/g, "[local-path]")
    .replace(/\b[A-Za-z]:[\\/][^\r\n"'<>|]{1,400}?(?=\s+(?:[\w.+-]+@|api[_ -]?key\b|token\b|password\b|secret\b|authorization\b)|[,;]|$)/gi, "[local-path]")
    .replace(/\\\\[^\\\r\n]+\\[^\r\n"'<>|]{1,400}?(?=\s+(?:[\w.+-]+@|api[_ -]?key\b|token\b|password\b|secret\b|authorization\b)|[,;]|$)/gi, "[network-path]")
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, "[email]")
    .replace(/\b([A-Za-z][A-Za-z0-9_.-]{0,80}(?:(?:api|access|refresh|private)[_-]?key|token|password|passwd|pwd|secret|authorization|credential)[A-Za-z0-9_.-]{0,80})\b["']?\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|(?:Bearer\s+)?[^\s,;}]+)/gi, "$1=[redacted]")
    .replace(/\b(api[_ -]?key|token|password|secret|authorization)\b["']?\s*[:=]\s*["']?\s*(?:Bearer\s+)?[^"'\s,;}]+["']?/gi, "$1=[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 300);
}

function capFile(path, maxBytes = MAX_CHROMIUM_LOG_BYTES) {
  try {
    if (!path || !existsSync(path) || statSync(path).size <= maxBytes) return false;
    truncateSync(path, 0);
    return true;
  } catch {
    return false;
  }
}

function normalizedEvent(type, fields = {}) {
  const event = {
    timestamp: new Date().toISOString(),
    type: /^[a-z0-9_-]{1,48}$/i.test(type) ? type : "diagnostic_event",
  };
  for (const key of ["processType", "reason", "serviceName", "location", "label", "version", "electronVersion", "platform", "arch", "detail"]) {
    if (fields[key] !== undefined && fields[key] !== null) event[key] = sanitizeDiagnosticText(fields[key]);
  }
  if (Number.isInteger(fields.exitCode)) event.exitCode = fields.exitCode;
  if (Number.isInteger(fields.bytes)) event.bytes = Math.max(0, fields.bytes);
  return event;
}

function summarizeUtilityReport(report) {
  const bytes = typeof report === "string" ? Buffer.byteLength(report, "utf8") : 0;
  let detail = "Node.js 诊断报告已由 Electron 提供，但未保存原文";
  if (typeof report === "string") {
    try {
      const parsed = JSON.parse(report);
      const header = parsed && typeof parsed === "object" && parsed.header && typeof parsed.header === "object"
        ? parsed.header
        : null;
      const summary = header && (header.event || header.trigger);
      if (typeof summary === "string" && summary.trim()) detail = summary;
    } catch {}
  }
  return { bytes, detail };
}

function pruneFiles(directory, { maxFiles = MAX_DUMPS, maxAgeMs = MAX_AGE_MS, now = Date.now() } = {}) {
  const root = resolve(directory);
  if (!existsSync(root)) return [];
  const files = readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => {
      const path = join(root, entry.name);
      const stats = statSync(path);
      return { path, mtimeMs: stats.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  const removed = [];
  files.forEach((file, index) => {
    if (index < maxFiles && now - file.mtimeMs <= maxAgeMs) return;
    if (!file.path.startsWith(root + require("node:path").sep)) return;
    try { unlinkSync(file.path); removed.push(basename(file.path)); } catch {}
  });
  return removed;
}

function createDiagnostics({ app, crashReporter, enabled = diagnosticsEnabled(), localDiagnosticsRoot = "" } = {}) {
  let diagnosticsRoot = "";
  let logPath = "";
  let initialized = false;

  function rotateLog() {
    if (!logPath || !existsSync(logPath) || statSync(logPath).size < MAX_LOG_BYTES) return;
    const oldest = `${logPath}.${MAX_ARCHIVES}`;
    if (existsSync(oldest)) unlinkSync(oldest);
    for (let index = MAX_ARCHIVES - 1; index >= 1; index -= 1) {
      const from = `${logPath}.${index}`;
      if (existsSync(from)) renameSync(from, `${logPath}.${index + 1}`);
    }
    renameSync(logPath, `${logPath}.1`);
  }

  function record(type, fields = {}) {
    if (!enabled || !initialized || !logPath) return false;
    try {
      rotateLog();
      appendFileSync(logPath, `${JSON.stringify(normalizedEvent(type, fields))}\n`, { encoding: "utf8", mode: 0o600 });
      return true;
    } catch {
      return false;
    }
  }

  function initializeEarly() {
    if (!enabled || initialized) return false;
    try {
      diagnosticsRoot = localDiagnosticsRoot ? resolve(localDiagnosticsRoot) : join(app.getPath("userData"), "diagnostics");
      const dumpRoot = join(diagnosticsRoot, "dumps");
      const chromiumLogPath = join(diagnosticsRoot, "chromium-raw.log");
      mkdirSync(dumpRoot, { recursive: true });
      logPath = join(diagnosticsRoot, "events.jsonl");
      pruneFiles(dumpRoot);
      pruneFiles(diagnosticsRoot, { maxFiles: MAX_ARCHIVES + 2 });
      capFile(chromiumLogPath);
      app.setPath("crashDumps", dumpRoot);
      app.commandLine.appendSwitch("enable-logging", "file");
      app.commandLine.appendSwitch("log-file", chromiumLogPath);
      crashReporter.start({
        companyName: "Amadeus Local Companion",
        productName: "Amadeus Local Companion",
        uploadToServer: false,
        compress: false,
        ignoreSystemCrashHandler: true,
      });
      initialized = true;
      const chromiumCapTimer = setInterval(() => capFile(chromiumLogPath), 30_000);
      chromiumCapTimer.unref?.();
      record("diagnostics_started", {
        version: app.getVersion(),
        electronVersion: process.versions.electron,
        platform: process.platform,
        arch: process.arch,
      });
      app.on("render-process-gone", (_event, webContents, details) => record("render_process_gone", {
        processType: "renderer",
        reason: details?.reason,
        exitCode: details?.exitCode,
        label: webContents?.getType?.(),
      }));
      app.on("child-process-gone", (_event, details) => record("child_process_gone", {
        processType: details?.type,
        reason: details?.reason,
        exitCode: details?.exitCode,
        serviceName: details?.serviceName,
      }));
      process.on("uncaughtExceptionMonitor", error => record("uncaught_exception", { detail: error?.name || "Error" }));
      return true;
    } catch {
      initialized = false;
      diagnosticsRoot = "";
      logPath = "";
      return false;
    }
  }

  function monitorWindow(window, label) {
    if (!enabled || !window?.webContents) return;
    window.webContents.on("unresponsive", () => record("window_unresponsive", { label }));
    window.webContents.on("responsive", () => record("window_responsive", { label }));
  }

  function monitorServerStderr(stream) {
    if (!stream?.on) return;
    if (!enabled) {
      stream.resume?.();
      return;
    }
    stream.on("data", chunk => record("server_stderr", { bytes: chunk.length }));
  }

  return Object.freeze({
    enabled,
    initializeEarly,
    monitorServerStderr,
    monitorWindow,
    record,
    recordUtilityError(type, location, report) {
      const summary = summarizeUtilityReport(report);
      record("utility_process_error", {
        processType: type,
        location,
        detail: summary.detail,
        bytes: summary.bytes,
      });
    },
    paths() {
      return enabled && initialized ? { diagnosticsRoot, logPath, chromiumRawLog: join(diagnosticsRoot, "chromium-raw.log"), crashDumps: join(diagnosticsRoot, "dumps") } : null;
    },
  });
}

module.exports = {
  capFile,
  createDiagnostics,
  diagnosticsEnabled,
  normalizedEvent,
  pruneFiles,
  sanitizeDiagnosticText,
  summarizeUtilityReport,
};
