import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { resolveRuntimePaths } from "../lib/runtime-paths.js";

const require = createRequire(import.meta.url);
const { resolveDesktopServerPaths, resolveDesktopSessionDataRoot, resolveLocalApplicationDataRoot } = require("../electron/server-runtime.cjs");

test("development mode keeps the existing repository layout", () => {
  const paths = resolveRuntimePaths({ environment: {}, cwd: "D:\\ExampleAgent" });
  assert.equal(paths.publicRoot, "D:\\ExampleAgent\\public");
  assert.equal(paths.settingsFile, "D:\\ExampleAgent\\data\\settings.json");
  assert.equal(paths.evaluationDatasetFile, "D:\\ExampleAgent\\data\\evaluation\\automotive-eval-v1.jsonl");
  assert.equal(paths.evaluationReviewFile, "D:\\ExampleAgent\\data\\evaluation-review-queue.local.json");
  assert.equal(paths.speechModel, "D:\\ExampleAgent\\models\\speech\\faster-whisper-tiny");
});

test("packaged mode separates read-only resources from writable user data", () => {
  const paths = resolveRuntimePaths({
    cwd: "C:\\ignored",
    environment: {
      AGENT_RESOURCE_ROOT: "C:\\Program Files\\Amadeus\\resources\\app.asar",
      AGENT_USER_DATA_ROOT: "C:\\Users\\Example\\AppData\\Roaming\\Amadeus",
      AGENT_MODELS_ROOT: "D:\\LocalModels",
      AGENT_TRANSCRIBE_SCRIPT: "C:\\Users\\Example\\AppData\\Roaming\\Amadeus\\runtime\\transcribe-abcd.py",
      AGENT_TRANSCRIBE_SHA256: "a".repeat(64),
    },
  });
  assert.equal(paths.publicRoot, "C:\\Program Files\\Amadeus\\resources\\app.asar\\public");
  assert.equal(paths.settingsFile, "C:\\Users\\Example\\AppData\\Roaming\\Amadeus\\data\\settings.json");
  assert.equal(paths.evaluationDatasetFile, "C:\\Program Files\\Amadeus\\resources\\app.asar\\data\\evaluation\\automotive-eval-v1.jsonl");
  assert.equal(paths.evaluationReviewFile, "C:\\Users\\Example\\AppData\\Roaming\\Amadeus\\data\\evaluation-review-queue.local.json");
  assert.equal(paths.memoryFile.startsWith(paths.resourceRoot), false);
  assert.equal(paths.modelsRoot, "D:\\LocalModels");
  assert.match(paths.transcribeScript, /AppData\\Roaming\\Amadeus\\runtime/);
  assert.equal(paths.transcribeScriptSha256, "a".repeat(64));
});

test("Electron development keeps data and models in the repository while packaged mode uses userData", () => {
  const development = resolveDesktopServerPaths({
    isPackaged: false,
    resourceRoot: "D:\\Agent",
    userDataRoot: "C:\\Users\\Example\\AppData\\Roaming\\Amadeus",
  });
  assert.equal(development.cwd, "D:\\Agent");
  assert.equal(development.userDataRoot, "D:\\Agent");
  assert.equal(development.modelsRoot, "D:\\Agent\\models");
  assert.equal(development.extractedTranscribeRoot, null);

  const packaged = resolveDesktopServerPaths({
    isPackaged: true,
    resourceRoot: "C:\\Program Files\\Amadeus\\resources\\app.asar",
    userDataRoot: "C:\\Users\\Example\\AppData\\Roaming\\Amadeus",
    localDataRoot: "C:\\Users\\Example\\AppData\\Local\\Amadeus",
  });
  assert.match(packaged.sourceTranscribeScript, /app\.asar\\scripts\\transcribe\.py$/);
  assert.match(packaged.extractedTranscribeRoot, /AppData\\Local\\Amadeus\\runtime$/);
  assert.match(packaged.modelsRoot, /AppData\\Local\\Amadeus\\models$/);
});

test("Electron keeps models, extracted runtime and diagnostics under Local AppData when available", () => {
  assert.equal(resolveLocalApplicationDataRoot({
    environment: { LOCALAPPDATA: "C:\\Users\\Example\\AppData\\Local" },
    userDataRoot: "C:\\Users\\Example\\AppData\\Roaming\\Amadeus",
  }), "C:\\Users\\Example\\AppData\\Local\\Amadeus Local Companion");
  assert.equal(
    resolveDesktopSessionDataRoot("C:\\Users\\Example\\AppData\\Local\\Amadeus Local Companion"),
    "C:\\Users\\Example\\AppData\\Local\\Amadeus Local Companion\\session-data",
  );
});
