import { join, resolve } from "node:path";

export function resolveRuntimePaths({ environment = process.env, cwd = process.cwd() } = {}) {
  const resourceRoot = resolve(String(environment.AGENT_RESOURCE_ROOT || cwd));
  const userDataRoot = resolve(String(environment.AGENT_USER_DATA_ROOT || resourceRoot));
  const dataRoot = join(userDataRoot, "data");
  const modelsRoot = resolve(String(environment.AGENT_MODELS_ROOT || join(userDataRoot, "models")));
  return Object.freeze({
    resourceRoot,
    userDataRoot,
    publicRoot: join(resourceRoot, "public"),
    resourceDataRoot: join(resourceRoot, "data"),
    dataRoot,
    settingsFile: join(dataRoot, "settings.json"),
    memoryFile: join(dataRoot, "memory.json"),
    defaultUserProfileFile: join(dataRoot, "user-profile.local.json"),
    evaluationDatasetFile: join(resourceRoot, "data", "evaluation", "automotive-eval-v1.jsonl"),
    evaluationReviewFile: join(dataRoot, "evaluation-review-queue.local.json"),
    modelsRoot,
    speechModel: join(modelsRoot, "speech", "faster-whisper-tiny"),
    customCorpusRoot: join(dataRoot, "character-corpus"),
    defaultCorpusRoot: join(resourceRoot, "data", "character-corpus"),
    transcribeScript: resolve(String(environment.AGENT_TRANSCRIBE_SCRIPT || join(resourceRoot, "scripts", "transcribe.py"))),
    transcribeScriptSha256: /^[a-f0-9]{64}$/i.test(String(environment.AGENT_TRANSCRIBE_SHA256 || ""))
      ? String(environment.AGENT_TRANSCRIBE_SHA256).toLowerCase()
      : "",
  });
}
