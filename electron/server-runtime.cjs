const { isAbsolute, join } = require("node:path");

function resolveLocalApplicationDataRoot({ environment = process.env, userDataRoot }) {
  const candidate = String(environment.LOCALAPPDATA || "");
  return isAbsolute(candidate)
    ? join(candidate, "Amadeus Local Companion")
    : join(userDataRoot, "local-runtime");
}

function resolveDesktopServerPaths({ isPackaged, resourceRoot, userDataRoot, localDataRoot = userDataRoot }) {
  const packaged = isPackaged === true;
  const writableRoot = packaged ? userDataRoot : resourceRoot;
  return Object.freeze({
    cwd: writableRoot,
    userDataRoot: writableRoot,
    modelsRoot: join(packaged ? localDataRoot : writableRoot, "models"),
    sourceTranscribeScript: join(resourceRoot, "scripts", "transcribe.py"),
    extractedTranscribeRoot: packaged ? join(localDataRoot, "runtime") : null,
  });
}

function resolveDesktopSessionDataRoot(localDataRoot) {
  return join(localDataRoot, "session-data");
}

module.exports = { resolveDesktopServerPaths, resolveDesktopSessionDataRoot, resolveLocalApplicationDataRoot };
