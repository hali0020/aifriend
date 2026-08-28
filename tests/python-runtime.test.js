import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { FASTER_WHISPER_REQUIRED_FILES, missingSpeechModelFiles, resolvePythonExecutable } from "../lib/python-runtime.js";

test("Python runtime accepts only an existing absolute explicit executable", () => {
  assert.equal(resolvePythonExecutable({ platform: "win32", environment: { AGENT_PYTHON_EXECUTABLE: "python.exe" }, exists: () => true }), "");
  assert.equal(resolvePythonExecutable({ platform: "win32", environment: { AGENT_PYTHON_EXECUTABLE: "C:\\Python\\python.exe" }, exists: value => value === "C:\\Python\\python.exe" }), "C:\\Python\\python.exe");
});

test("Windows Python discovery uses the fixed system where.exe outside the application cwd", () => {
  let invocation;
  const existing = new Set(["C:\\Windows\\System32\\where.exe", "C:\\Python311\\python.exe"]);
  const result = resolvePythonExecutable({
    platform: "win32",
    environment: { SystemRoot: "C:\\Windows", PATH: "C:\\Python311" },
    exists: value => existing.has(value),
    run: (executable, args, options) => {
      invocation = { executable, args, options };
      return "C:\\Python311\\python.exe\r\n";
    },
  });
  assert.equal(result, "C:\\Python311\\python.exe");
  assert.equal(invocation.executable, "C:\\Windows\\System32\\where.exe");
  assert.equal(invocation.options.cwd, "C:\\Windows");
});

test("faster-whisper readiness requires every runtime model file", () => {
  const root = "C:\\Models\\faster-whisper-tiny";
  const complete = new Set(FASTER_WHISPER_REQUIRED_FILES.map(name => join(root, name)));
  assert.deepEqual(missingSpeechModelFiles(root, { exists: value => complete.has(value) }), []);
  complete.delete(join(root, "tokenizer.json"));
  assert.deepEqual(missingSpeechModelFiles(root, { exists: value => complete.has(value) }), ["tokenizer.json"]);
});
