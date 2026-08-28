import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, join, win32 } from "node:path";

export const FASTER_WHISPER_REQUIRED_FILES = Object.freeze([
  "config.json",
  "model.bin",
  "tokenizer.json",
  "vocabulary.txt",
]);

export function missingSpeechModelFiles(modelDirectory, { exists = existsSync } = {}) {
  return FASTER_WHISPER_REQUIRED_FILES.filter(name => !exists(join(modelDirectory, name)));
}

export function resolvePythonExecutable({
  environment = process.env,
  platform = process.platform,
  exists = existsSync,
  run = execFileSync,
} = {}) {
  const explicit = String(environment.AGENT_PYTHON_EXECUTABLE || "").trim();
  const absolute = platform === "win32" ? win32.isAbsolute : isAbsolute;
  if (explicit) return absolute(explicit) && exists(explicit) ? explicit : "";
  try {
    if (platform === "win32") {
      const systemRoot = String(environment.SystemRoot || environment.WINDIR || "C:\\Windows");
      const whereExecutable = win32.join(systemRoot, "System32", "where.exe");
      if (!exists(whereExecutable)) return "";
      const output = String(run(whereExecutable, ["python.exe"], {
        cwd: systemRoot,
        encoding: "utf8",
        env: environment,
        windowsHide: true,
      }));
      return output.split(/\r?\n/).map(value => value.trim()).find(value => win32.isAbsolute(value) && exists(value)) || "";
    }
    const whichExecutable = "/usr/bin/which";
    if (!exists(whichExecutable)) return "";
    const output = String(run(whichExecutable, ["python3"], { cwd: "/", encoding: "utf8", env: environment }));
    return output.split(/\r?\n/).map(value => value.trim()).find(value => isAbsolute(value) && exists(value)) || "";
  } catch {
    return "";
  }
}
