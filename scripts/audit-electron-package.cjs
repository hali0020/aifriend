const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { existsSync, readFileSync, readdirSync, statSync } = require("node:fs");
const { join, posix, resolve } = require("node:path");
const { isAllowedPackageEntry, isForbiddenPackageEntry, normalizeEntry } = require("../electron/package-boundary.cjs");

const REQUIRED_ENTRIES = [
  "server.js",
  "electron/main.cjs",
  "electron/preload-host.cjs",
  "electron/preload-pet.cjs",
  "electron/diagnostics.cjs",
  "electron/edge-state.cjs",
  "electron/server-runtime.cjs",
  "electron/window-source-pager.cjs",
  "lib/image-safety-service.js",
  "lib/local-ollama.js",
  "lib/media-validation.js",
  "lib/python-runtime.js",
  "lib/runtime-paths.js",
  "lib/safety-classifier.js",
  "lib/safety-service.js",
  "lib/user-profile.js",
  "public/index.html",
  "public/app.js",
  "public/game-session-policy.js",
  "public/desktop-pet-assets/catalog.json",
  "data/character-corpus/default_style_dictionary.json",
  "data/character-corpus/default_retrieval_examples.jsonl",
  "scripts/transcribe.py",
  "node_modules/electron-squirrel-startup/index.js",
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function archiveEntryPath(entry) {
  return entry.split("/").join(require("node:path").sep);
}

function listAllowedSourceFiles(root, relativeRoot = "") {
  const directory = relativeRoot ? join(root, ...relativeRoot.split("/")) : root;
  const files = [];
  for (const child of readdirSync(directory, { withFileTypes: true })) {
    const entry = normalizeEntry(relativeRoot ? `${relativeRoot}/${child.name}` : child.name);
    if (!isAllowedPackageEntry(entry)) continue;
    if (child.isDirectory()) files.push(...listAllowedSourceFiles(root, entry));
    else if (child.isFile()) files.push(entry);
  }
  return files;
}

function findDefaultPackageRoot(outputRoot = resolve(__dirname, "..", "out")) {
  if (!existsSync(outputRoot)) return "";
  return readdirSync(outputRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /-win32-(?:x64|arm64|ia32)$/i.test(entry.name))
    .map(entry => join(outputRoot, entry.name))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)[0] || "";
}

function assertRelativeRuntimeDependencies(entries, readEntry) {
  const entrySet = new Set(entries);
  const codeEntries = entries.filter(entry => /\.(?:c?js|mjs)$/i.test(entry));
  const pattern = /(?:\brequire\s*\(|\bimport\s*\(|\bfrom\s+)["'](\.[^"']+)["']/g;
  for (const entry of codeEntries) {
    const source = String(readEntry(entry));
    for (const match of source.matchAll(pattern)) {
      const target = posix.normalize(posix.join(posix.dirname(entry), match[1]));
      const candidates = [target, `${target}.js`, `${target}.cjs`, `${target}.mjs`, `${target}/index.js`, `${target}/index.cjs`];
      assert.ok(candidates.some(candidate => entrySet.has(candidate)), `missing packaged relative dependency ${match[1]} from ${entry}`);
    }
  }
}

function assertHtmlRuntimeDependencies(entries, readEntry) {
  const entrySet = new Set(entries);
  for (const entry of entries.filter(value => value.endsWith(".html"))) {
    const source = String(readEntry(entry));
    for (const match of source.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi)) {
      const raw = match[1].split(/[?#]/, 1)[0];
      if (!raw || /^(?:data:|https?:|#)/i.test(raw)) continue;
      const target = raw.startsWith("/")
        ? `public/${raw.replace(/^\/+/, "")}`
        : posix.normalize(posix.join(posix.dirname(entry), raw));
      assert.ok(entrySet.has(target), `missing packaged HTML dependency ${raw} from ${entry}`);
    }
  }
}

async function auditPackageRoot(packageRoot) {
  const root = resolve(packageRoot);
  const asarPath = join(root, "resources", "app.asar");
  assert.ok(existsSync(asarPath), `missing app.asar under ${root}`);
  const asar = await import("@electron/asar");
  const entries = (await asar.listPackage(asarPath)).map(normalizeEntry);
  const forbidden = entries.filter(isForbiddenPackageEntry);
  assert.deepEqual(forbidden, [], `forbidden private/package entries: ${forbidden.join(", ")}`);
  const unexpected = entries.filter(entry => !isAllowedPackageEntry(entry));
  assert.deepEqual(unexpected, [], `entries outside the runtime allowlist: ${unexpected.join(", ")}`);
  for (const required of REQUIRED_ENTRIES) assert.ok(entries.includes(required), `missing required package entry: ${required}`);
  const readArchiveEntry = entry => asar.extractFile(asarPath, archiveEntryPath(entry));
  assertRelativeRuntimeDependencies(entries, entry => readArchiveEntry(entry).toString("utf8"));
  assertHtmlRuntimeDependencies(entries, entry => readArchiveEntry(entry).toString("utf8"));
  const projectRoot = resolve(__dirname, "..");
  const packageFiles = entries.filter(entry => !asar.statFile(asarPath, archiveEntryPath(entry)).files).sort();
  const sourceEntries = listAllowedSourceFiles(projectRoot).sort();
  assert.deepEqual(packageFiles, sourceEntries, "packaged runtime files must exactly match the current allowlisted source files");
  for (const entry of sourceEntries) {
    const sourcePath = join(projectRoot, ...entry.split("/"));
    assert.equal(sha256(readArchiveEntry(entry)), sha256(readFileSync(sourcePath)), `stale packaged source: ${entry}`);
  }
  assert.equal(existsSync(join(root, "resources", "app.asar.unpacked")), false, "runtime scripts must remain inside the integrity-protected ASAR");

  const executable = readdirSync(root).find(name => name.toLowerCase() === "amadeuslocalcompanion.exe");
  assert.ok(executable, "missing AmadeusLocalCompanion.exe");
  const fuses = await import("@electron/fuses");
  const wire = await fuses.getCurrentFuseWire(join(root, executable));
  const expected = new Map([
    [fuses.FuseV1Options.RunAsNode, 48],
    [fuses.FuseV1Options.EnableCookieEncryption, 49],
    [fuses.FuseV1Options.EnableNodeOptionsEnvironmentVariable, 48],
    [fuses.FuseV1Options.EnableNodeCliInspectArguments, 48],
    [fuses.FuseV1Options.EnableEmbeddedAsarIntegrityValidation, 49],
    [fuses.FuseV1Options.OnlyLoadAppFromAsar, 49],
    [fuses.FuseV1Options.GrantFileProtocolExtraPrivileges, 48],
  ]);
  for (const [option, state] of expected) assert.equal(wire[option], state, `unexpected Electron fuse ${fuses.FuseV1Options[option]}`);
  return { root, entries: entries.length, executable, fuses: "verified", forbidden: 0, unexpected: 0, sourceHashes: sourceEntries.length };
}

if (require.main === module) {
  const packageRoot = process.argv.slice(2).at(-1) || findDefaultPackageRoot();
  if (!packageRoot) {
    console.error("usage: node scripts/audit-electron-package.cjs <packaged-app-root>");
    process.exitCode = 2;
  } else {
    auditPackageRoot(packageRoot).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
      console.error(error.message || error);
      process.exitCode = 1;
    });
  }
}

module.exports = { assertHtmlRuntimeDependencies, assertRelativeRuntimeDependencies, auditPackageRoot, findDefaultPackageRoot, listAllowedSourceFiles, REQUIRED_ENTRIES };
