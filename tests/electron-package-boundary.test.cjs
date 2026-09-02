const assert = require("node:assert/strict");
const test = require("node:test");
const { isAllowedPackageEntry, isForbiddenPackageEntry, shouldIgnoreSourcePath } = require("../electron/package-boundary.cjs");
const { assertHtmlRuntimeDependencies, assertRelativeRuntimeDependencies } = require("../scripts/audit-electron-package.cjs");
const forgeConfig = require("../forge.config.cjs");

test("package boundary rejects every private, local and heavyweight artifact class", () => {
  for (const entry of [
    ".env",
    ".env.local",
    "data/user-profile.local.json",
    "data/memory.json",
    "data/settings.json",
    "data/evaluation-review-queue.local.json",
    "data/character-sources/script.txt",
    "data/quarantine/source.png",
    "data/character-corpus/style_dictionary.json",
    "audio/voice.wav",
    "models/model.gguf",
    "runtime/python.exe",
    "work/frame.jpg",
    "credentials-local.json",
    "diagnostics/crash.dmp",
  ]) assert.equal(isForbiddenPackageEntry(entry), true, entry);
});

test("package boundary preserves only public runtime data", () => {
  for (const entry of [
    "server.js",
    "public/index.html",
    "public/desktop-pet-assets/catalog.json",
    "data/character-corpus/README.md",
    "data/character-corpus/default_style_dictionary.json",
    "data/character-corpus/default_retrieval_examples.jsonl",
    "data/evaluation/README.md",
    "data/evaluation/automotive-eval-v1.jsonl",
  ]) assert.equal(isForbiddenPackageEntry(entry), false, entry);
});

test("packager ignore excludes development files but keeps the transcriber", () => {
  const root = "D:\\Agent";
  assert.equal(shouldIgnoreSourcePath("D:\\Agent\\tests\\safety.test.js", root), true);
  assert.equal(shouldIgnoreSourcePath("D:\\Agent\\scripts\\build_character_corpus.py", root), true);
  assert.equal(shouldIgnoreSourcePath("D:\\Agent\\scripts\\transcribe.py", root), false);
  assert.equal(shouldIgnoreSourcePath("D:\\Agent\\public\\app.js", root), false);
  assert.equal(shouldIgnoreSourcePath("/package.json", root), false);
  assert.equal(shouldIgnoreSourcePath("/data/user-profile.local.json", root), true);
  assert.equal(shouldIgnoreSourcePath("/scripts/transcribe.py", root), false);
});

test("strict runtime allowlist rejects unknown top-level notes and development dependencies", () => {
  for (const entry of [
    "personal-notes.txt",
    "personal-notes.json",
    ".gitignore",
    "node_modules/.package-lock.json",
    "node_modules/.bin/electron-forge.cmd",
    "node_modules/@electron-forge/cli/package.json",
    "node_modules/electron-squirrel-startup/test/index.test.js",
    "node_modules/electron-squirrel-startup/.github/workflows/codeql.yml",
    "node_modules/electron-squirrel-startup/node_modules/debug/karma.conf.js",
    "public/personal-notes.txt",
    "public/personal-notes.json",
    "electron/package-boundary.cjs",
  ]) assert.equal(isAllowedPackageEntry(entry), false, entry);
  for (const entry of [
    "package.json",
    "server.js",
    "electron/server-runtime.cjs",
    "electron/window-source-pager.cjs",
    "lib/local-ollama.js",
    "lib/automotive-safety-policy.js",
    "lib/automotive-output-validator.js",
    "lib/evaluation-input-risk.js",
    "lib/evaluation-review-store.js",
    "lib/evaluation-service.js",
    "public/index.html",
    "public/evaluation.css",
    "public/evaluation.js",
    "scripts/transcribe.py",
    "node_modules/electron-squirrel-startup/index.js",
    "node_modules/electron-squirrel-startup/node_modules/debug/src/debug.js",
    "node_modules/electron-squirrel-startup/node_modules/ms/index.js",
  ]) assert.equal(isAllowedPackageEntry(entry), true, entry);
});

test("package audit catches a required relative module omitted from the archive", () => {
  const sources = new Map([
    ["electron/main.cjs", 'require("./present.cjs"); require("./missing.cjs");'],
    ["electron/present.cjs", "module.exports = true;"],
  ]);
  assert.throws(
    () => assertRelativeRuntimeDependencies([...sources.keys()], entry => sources.get(entry)),
    /missing packaged relative dependency \.\/missing\.cjs/,
  );
  sources.set("electron/missing.cjs", "module.exports = true;");
  assert.doesNotThrow(() => assertRelativeRuntimeDependencies([...sources.keys()], entry => sources.get(entry)));
});

test("package audit catches HTML assets omitted from the archive", () => {
  const sources = new Map([["public/index.html", '<link href="/style.css"><script src="/app.js"></script>'], ["public/style.css", "body{}"]]);
  assert.throws(() => assertHtmlRuntimeDependencies([...sources.keys()], entry => sources.get(entry)), /missing packaged HTML dependency \/app\.js/);
  sources.set("public/app.js", "");
  assert.doesNotThrow(() => assertHtmlRuntimeDependencies([...sources.keys()], entry => sources.get(entry)));
});

test("Squirrel release metadata uses an immutable default icon and neutral publisher", () => {
  const config = forgeConfig.makers.find(maker => maker.name === "@electron-forge/maker-squirrel")?.config;
  assert.ok(config);
  assert.match(config.iconUrl, /\/electron\/electron\/v43\.4\.1\//);
  assert.doesNotMatch(config.iconUrl, /\/main\//);
  assert.equal(config.authors, "Amadeus Local Companion Contributors");
});
