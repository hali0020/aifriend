const { relative, resolve, sep } = require("node:path");

const RUNTIME_FILES = new Set([
  "package.json",
  "server.js",
  "electron/main.cjs",
  "electron/diagnostics.cjs",
  "electron/edge-state.cjs",
  "electron/file-trash-service.cjs",
  "electron/pet-roam.cjs",
  "electron/preload-host.cjs",
  "electron/preload-pet.cjs",
  "electron/server-runtime.cjs",
  "electron/window-source-pager.cjs",
  "lib/demo-reply.js",
  "lib/desktop-pet-action-policy.js",
  "lib/desktop-pet-output-validator.js",
  "lib/evaluation-input-risk.js",
  "lib/evaluation-review-store.js",
  "lib/evaluation-service.js",
  "lib/game-request-coordinator.js",
  "lib/image-safety-service.js",
  "lib/local-ollama.js",
  "lib/media-validation.js",
  "lib/python-runtime.js",
  "lib/runtime-paths.js",
  "lib/safety-classifier.js",
  "lib/safety-service.js",
  "lib/style-retrieval.js",
  "lib/user-profile.js",
  "scripts/transcribe.py",
  "data/character-corpus/README.md",
  "data/character-corpus/default_style_dictionary.json",
  "data/character-corpus/default_retrieval_examples.jsonl",
  "data/evaluation/README.md",
  "data/evaluation/desktop-pet-eval-v1.jsonl",
]);
const RUNTIME_DIRECTORIES = new Set([
  "electron",
  "lib",
  "public",
  "public/desktop-pet-assets",
  "public/desktop-pet-assets/animations",
  "scripts",
  "data",
  "data/character-corpus",
  "data/evaluation",
  "node_modules",
  "node_modules/electron-squirrel-startup",
  "node_modules/electron-squirrel-startup/node_modules",
  "node_modules/electron-squirrel-startup/node_modules/debug",
  "node_modules/electron-squirrel-startup/node_modules/debug/src",
  "node_modules/electron-squirrel-startup/node_modules/ms",
]);
const DEPENDENCY_FILES = new Set([
  "node_modules/electron-squirrel-startup/index.js",
  "node_modules/electron-squirrel-startup/package.json",
  "node_modules/electron-squirrel-startup/node_modules/debug/package.json",
  "node_modules/electron-squirrel-startup/node_modules/debug/src/browser.js",
  "node_modules/electron-squirrel-startup/node_modules/debug/src/debug.js",
  "node_modules/electron-squirrel-startup/node_modules/debug/src/index.js",
  "node_modules/electron-squirrel-startup/node_modules/debug/src/node.js",
  "node_modules/electron-squirrel-startup/node_modules/ms/index.js",
  "node_modules/electron-squirrel-startup/node_modules/ms/package.json",
]);
const PUBLIC_FILES = new Set([
  "public/app.js",
  "public/avatar.css",
  "public/christina-avatar.webp",
  "public/christina-desktop-pet.webp",
  "public/desktop-pet-bootstrap.js",
  "public/desktop-pet-entry.js",
  "public/desktop-pet.html",
  "public/desktop-pet.js",
  "public/emotion-engine.js",
  "public/evaluation.css",
  "public/evaluation.js",
  "public/enhancements.css",
  "public/game-session-policy.js",
  "public/index.html",
  "public/message-state.css",
  "public/model-center.css",
  "public/presence.css",
  "public/reply-policy.js",
  "public/status-view.js",
  "public/style.css",
  "public/desktop-pet-assets/catalog.json",
  "public/desktop-pet-assets/animations/manifest.json",
]);

function normalizeEntry(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\/+/, "");
}

function isForbiddenPackageEntry(value) {
  const entry = normalizeEntry(value);
  if (!entry) return false;
  const lower = entry.toLowerCase();
  if (/(^|\/)\.env(?:\.|$)/.test(lower)) return true;
  if (/(^|\/)(?:credentials|secrets)[^/]*\.json$/.test(lower)) return true;
  if (/\.(?:pem|key|p12|pfx|gguf|safetensors|onnx|pt|pth|ckpt|log|dmp|dump)$/i.test(entry)) return true;
  if (/^(?:audio|models|runtime|downloads|tmp|work|data\/quarantine|data\/character-sources)(?:\/|$)/i.test(entry)) return true;
  if (/^data\/(?:memory|settings|user-profile\.local)\.json$/i.test(entry)) return true;
  if (/^data\/evaluation-review-queue\.local\.json$/i.test(entry)) return true;
  if (/^data\/character-corpus\//i.test(entry) && !/^data\/character-corpus\/(?:README\.md|default_style_dictionary\.json|default_retrieval_examples\.jsonl)$/i.test(entry)) return true;
  return false;
}

function isAllowedPackageEntry(value) {
  const entry = normalizeEntry(value);
  if (!entry || RUNTIME_DIRECTORIES.has(entry) || RUNTIME_FILES.has(entry)) return true;
  if (PUBLIC_FILES.has(entry)) return true;
  if (DEPENDENCY_FILES.has(entry)) return true;
  if (/^public\/desktop-pet-assets\/makise-kurisu-chibi-\d{2}-[a-z0-9-]+\.png$/i.test(entry)) return true;
  if (/^public\/desktop-pet-assets\/animations\/[a-z0-9-]+$/i.test(entry)) return true;
  if (/^public\/desktop-pet-assets\/animations\/[a-z0-9-]+\/(?:frame-\d{2}|key-[a-z0-9-]+)\.png$/i.test(entry)) return true;
  return false;
}

function shouldIgnoreSourcePath(absolutePath, projectRoot) {
  const root = resolve(projectRoot);
  const rawPath = String(absolutePath || "");
  let entry = "";
  if (/^[A-Za-z]:[\\/]/.test(rawPath) || /^\\\\/.test(rawPath)) {
    const target = resolve(rawPath);
    if (target === root) return false;
    if (!target.startsWith(root + sep)) return true;
    entry = normalizeEntry(relative(root, target));
  } else {
    entry = normalizeEntry(rawPath);
  }
  return isForbiddenPackageEntry(entry) || !isAllowedPackageEntry(entry);
}

module.exports = { isAllowedPackageEntry, isForbiddenPackageEntry, normalizeEntry, shouldIgnoreSourcePath };
