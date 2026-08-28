const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const test = require("node:test");
const { capFile, createDiagnostics, diagnosticsEnabled, normalizedEvent, sanitizeDiagnosticText, summarizeUtilityReport } = require("../electron/diagnostics.cjs");

test("diagnostics are opt-in only", () => {
  assert.equal(diagnosticsEnabled([], {}), false);
  assert.equal(diagnosticsEnabled(["electron", ".", "--diagnostics"], {}), true);
  assert.equal(diagnosticsEnabled([], { AGENT_DIAGNOSTICS: "1" }), true);
});

test("diagnostic text removes local paths, emails and assigned secrets", () => {
  const sanitized = sanitizeDiagnosticText("C:\\Users\\Example\\Agent\\server.js user@example.invalid token=abc123\nnext");
  assert.equal(sanitized.includes("Example\\Agent"), false);
  assert.equal(sanitized.includes("user@example"), false);
  assert.equal(sanitized.includes("abc123"), false);
  assert.match(sanitized, /\[local-path\]/);
  assert.match(sanitized, /\[email\]/);
  assert.match(sanitized, /\[redacted\]/);
  const structured = sanitizeDiagnosticText('"C:\\Users\\Example Person\\Agent\\server.js" {"authorization":"Bearer abc.def.123456789","token":"secret-value"} sk-proj-abcdefghijklmnopqrstuvwxyz');
  assert.doesNotMatch(structured, /Example Person|abc\.def|secret-value|sk-proj/);
  const prefixed = sanitizeDiagnosticText("OPENAI_API_KEY=plainSecretValue123 GH_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz AWS_SECRET_ACCESS_KEY=base64ishValue== client_secret='oauth-secret-value'");
  assert.doesNotMatch(prefixed, /plainSecretValue123|ghp_|base64ishValue|oauth-secret-value/);
  assert.equal((prefixed.match(/\[redacted\]/g) || []).length, 4);
});

test("diagnostic events keep an allowlist and never serialize arbitrary objects", () => {
  const event = normalizedEvent("render_process_gone", { reason: "crashed", exitCode: 9, secret: "do-not-log", detail: { nested: "ignored" } });
  assert.equal(event.reason, "crashed");
  assert.equal(event.exitCode, 9);
  assert.equal("secret" in event, false);
  assert.equal(event.detail, "[object Object]");
});

test("utility diagnostic reports are summarized from Electron's string payload without retaining the report", () => {
  const report = JSON.stringify({ header: { event: "Allocation failed", filename: "C:\\Users\\Example\\private.js" }, environmentVariables: { TOKEN: "secret" } });
  assert.deepEqual(summarizeUtilityReport(report), { bytes: Buffer.byteLength(report), detail: "Allocation failed" });
  assert.deepEqual(summarizeUtilityReport("not-json"), {
    bytes: Buffer.byteLength("not-json"),
    detail: "Node.js 诊断报告已由 Electron 提供，但未保存原文",
  });
});

test("server stderr is drained when disabled and records byte metadata only when enabled", () => {
  let resumed = false;
  let subscribed = false;
  const diagnostics = createDiagnostics({
    app: {},
    crashReporter: {},
    argv: [],
    env: {},
  });
  diagnostics.monitorServerStderr({
    on() { subscribed = true; },
    resume() { resumed = true; },
  });
  assert.equal(resumed, true);
  assert.equal(subscribed, false);

  const root = mkdtempSync(join(tmpdir(), "amadeus-stderr-diagnostics-"));
  const app = new EventEmitter();
  app.commandLine = { appendSwitch() {} };
  app.getVersion = () => "test";
  app.setPath = () => {};
  const enabled = createDiagnostics({ app, crashReporter: { start() {} }, enabled: true, localDiagnosticsRoot: root });
  try {
    assert.equal(enabled.initializeEarly(), true);
    const stream = new EventEmitter();
    enabled.monitorServerStderr(stream);
    stream.emit("data", Buffer.from("OPENAI_API_KEY="));
    stream.emit("data", Buffer.from("plainSecretValue123 C:\\Users\\Private"));
    const events = readFileSync(join(root, "events.jsonl"), "utf8").trim().split(/\r?\n/).map(line => JSON.parse(line));
    const stderr = events.filter(event => event.type === "server_stderr");
    assert.deepEqual(stderr.map(event => event.bytes), [15, 36]);
    assert.equal(stderr.some(event => "detail" in event), false);
    assert.doesNotMatch(JSON.stringify(stderr), /OPENAI|plainSecret|Private/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Chromium logs are capped and diagnostic initialization failures do not crash startup", () => {
  const root = mkdtempSync(join(tmpdir(), "amadeus-diagnostics-"));
  const log = join(root, "chromium.log");
  try {
    writeFileSync(log, Buffer.alloc(64));
    assert.equal(capFile(log, 32), true);
    assert.equal(statSync(log).size, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  const diagnostics = createDiagnostics({
    app: { getPath() { throw new Error("unavailable"); } },
    crashReporter: {},
    enabled: true,
  });
  assert.equal(diagnostics.initializeEarly(), false);
});
