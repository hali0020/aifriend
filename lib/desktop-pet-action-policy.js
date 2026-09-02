import { createHash } from "node:crypto";

/**
 * Deterministic authorization for desktop-companion actions.
 *
 * A model may describe an intent, but it is never an authority. Host-owned
 * evidence is required for every action that touches files, capture devices,
 * or a remote destination. This module performs no I/O and has no persistence.
 */

export const DESKTOP_PET_POLICY_VERSION = "desktop-pet-action-policy/1.0.0";
export const DESKTOP_PET_DECISIONS = Object.freeze(["allow", "confirm", "block", "manual_review"]);
export const DESKTOP_PET_TOOL_ALLOWLIST = Object.freeze([
  "desktop_pet.set_visibility",
  "desktop_pet.set_pose",
  "desktop_pet.trash_selected_file",
]);

const SAFE_POSES = new Set(["idle", "joyful", "thinking", "surprised", "concerned", "sleepy"]);
const LOW_RISK_ACTIONS = new Set(["show", "hide", "toggle", "set_pose"]);
const PROHIBITED_ACTIONS = new Set(["permanent_delete", "run_shell", "open_url"]);
const ACTION_DOMAINS = new Set([
  "desktop_pet_action",
  "pet_ui",
  "file_management",
  "system_control",
  "audio_capture",
  "screen_capture",
  "network_transfer",
]);
const KNOWN_ACTIONS = new Set([
  "query",
  "show",
  "hide",
  "toggle",
  "set_pose",
  "trash",
  "permanent_delete",
  "run_shell",
  "open_url",
  "record",
  "capture",
  "upload",
  "save",
  "load",
  "clear",
  "cancel",
]);

const ACTION_ALIASES = new Map([
  ["ask", "query"],
  ["explain", "query"],
  ["chat", "query"],
  ["show", "show"],
  ["open", "show"],
  ["显示", "show"],
  ["打开桌宠", "show"],
  ["hide", "hide"],
  ["隐藏", "hide"],
  ["toggle", "toggle"],
  ["切换", "toggle"],
  ["set_pose", "set_pose"],
  ["pose", "set_pose"],
  ["emote", "set_pose"],
  ["表情", "set_pose"],
  ["动作", "set_pose"],
  ["trash", "trash"],
  ["recycle", "trash"],
  ["move_to_trash", "trash"],
  ["移入回收站", "trash"],
  ["permanent_delete", "permanent_delete"],
  ["delete_permanently", "permanent_delete"],
  ["彻底删除", "permanent_delete"],
  ["永久删除", "permanent_delete"],
  ["run_shell", "run_shell"],
  ["shell", "run_shell"],
  ["execute_command", "run_shell"],
  ["执行命令", "run_shell"],
  ["open_url", "open_url"],
  ["url", "open_url"],
  ["打开链接", "open_url"],
  ["record", "record"],
  ["record_audio", "record"],
  ["录音", "record"],
  ["capture", "capture"],
  ["capture_screen", "capture"],
  ["截图", "capture"],
  ["upload", "upload"],
  ["send_remote", "upload"],
  ["上传", "upload"],
  ["save", "save"],
  ["remember", "save"],
  ["记住", "save"],
  ["保存", "save"],
  ["load", "load"],
  ["读取", "load"],
  ["加载", "load"],
  ["clear", "clear"],
  ["清空", "clear"],
  ["cancel", "cancel"],
  ["stop", "cancel"],
  ["停止", "cancel"],
]);

const TARGET_ALIASES = new Map([
  ["pet", "pet"],
  ["desktop_pet", "pet"],
  ["桌宠", "pet"],
  ["window", "window"],
  ["panel", "window"],
  ["窗口", "window"],
  ["file", "file"],
  ["selected_file", "file"],
  ["file_path", "file"],
  ["文件", "file"],
  ["microphone", "microphone"],
  ["mic", "microphone"],
  ["麦克风", "microphone"],
  ["screen", "screen"],
  ["display", "screen"],
  ["selected_game_window", "screen"],
  ["game_frame", "screen"],
  ["屏幕", "screen"],
  ["remote", "remote"],
  ["cloud", "remote"],
  ["云端", "remote"],
  ["local_memory", "memory"],
  ["memory", "memory"],
  ["本地记忆", "memory"],
]);

const REDACTION_RULES = Object.freeze([
  [/-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/giu, "[REDACTED_PRIVATE_KEY]"],
  [/-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----[\s\S]{20,}/giu, "[REDACTED_PRIVATE_KEY]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/giu, "Bearer [REDACTED_TOKEN]"],
  [/\bAuthorization\s*:\s*Basic\s+[A-Za-z0-9+/=]{12,}\b/giu, "Authorization: Basic [REDACTED_CREDENTIAL]"],
  [/\bAKIA[0-9A-Z]{16}\b/gu, "[REDACTED_ACCESS_KEY]"],
  [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AIza[A-Za-z0-9_-]{30,})\b/gu, "[REDACTED_TOKEN]"],
  [/\b(?:Cookie\s*:\s*)?(?:sessionid|session|auth|jwt)\s*=\s*[A-Za-z0-9._~+/=-]{12,}\b/giu, "[REDACTED_SESSION]"],
  [/\b(?:sk|pk|api|key|token)[_-][A-Za-z0-9_-]{8,}\b/giu, "[REDACTED_TOKEN]"],
  [/\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|token|password|passwd|secret)\s*(?::|=|\bis\b)\s*["']?[^\s,;'"，；]{4,}["']?/giu, "[REDACTED_CREDENTIAL]"],
  [/(?:密码|口令|令牌|密钥|私钥)\s*(?:是|为|[:：=])\s*["“”']?[^\s,，;；"“”']{4,}["“”']?/gu, "[REDACTED_CREDENTIAL]"],
  [/(?<!\d)\d{17}[\dXx](?!\d)/gu, "[REDACTED_ID_NUMBER]"],
  [/\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/gu, "[REDACTED_ID_NUMBER]"],
  [/(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/gu, match => (luhnValid(match) ? "[REDACTED_PAYMENT_CARD]" : match)],
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "[REDACTED_EMAIL]"],
  [/(?:经度|纬度|坐标|GPS)\s*[:：]?\s*-?\d{1,3}(?:\.\d{3,})?(?:\s*[,，/]\s*|\s+)(?:-?\d{1,3}(?:\.\d{3,})?)/giu, "[REDACTED_PRECISE_LOCATION]"],
  [/(?<![\d.])-?(?:[1-8]?\d(?:\.\d{4,})|90(?:\.0+)?)\s*[,，]\s*-?(?:1[0-7]\d(?:\.\d{4,})?|[1-9]?\d(?:\.\d{4,})?|180(?:\.0+)?)(?![\d.])/gu, "[REDACTED_PRECISE_LOCATION]"],
  [/(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/gu, "[REDACTED_PHONE]"],
  [/\b(?:\+?\d{1,3}[- ]?)?(?:\(?\d{2,4}\)?[- ]?){2,4}\d{3,4}\b/gu, "[REDACTED_PHONE]"],
  [/(?:[\p{Script=Han}]{2,}(?:省|自治区|特别行政区))?(?:[\p{Script=Han}]{2,}市)(?:[\p{Script=Han}]{1,}(?:区|县))?[\p{Script=Han}A-Za-z0-9]{2,}(?:路|街|道|巷)\s*\d+(?:号|弄|栋|室)?/gu, "[REDACTED_ADDRESS]"],
  [/\\\\[^\r\n,，;；"']+/gu, "[REDACTED_PATH]"],
  [/\/\/[^\r\n,，;；"']+/gu, "[REDACTED_PATH]"],
  [/[A-Za-z]:[\\\/][^\r\n,，;；"']+/gu, "[REDACTED_PATH]"],
  [/(?:\/Users\/|\/home\/)[^\r\n,，;；"']+/gu, "[REDACTED_PATH]"],
  [/(?<![\p{L}\p{N}_])(?:(?:[\p{L}\p{N}_-]+[ ._-]){0,12}[\p{L}\p{N}_-]+\.[A-Za-z][A-Za-z0-9_-]{0,11}|\.(?:env|npmrc|pem|key|crt|pfx))(?![\p{L}\p{N}_])/gu, "[REDACTED_FILE_NAME]"],
]);

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cleanEnum(value) {
  if (typeof value !== "string") return "";
  return value.normalize("NFKC").replace(/\p{Cf}/gu, "").trim().toLowerCase().replace(/[\s-]+/gu, "_").slice(0, 80);
}

function cleanToolName(value) {
  if (typeof value !== "string") return "";
  return value.normalize("NFKC").replace(/\p{Cf}/gu, "").trim().toLowerCase().slice(0, 120);
}

function strictBoolean(value) {
  return typeof value === "boolean" ? value : null;
}

function finiteConfidence(value) {
  if (value === "" || value === null || value === undefined || typeof value === "boolean") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.min(number, 1) : null;
}

function normalizeAction(value) {
  const cleaned = cleanEnum(value);
  return ACTION_ALIASES.get(cleaned) ?? (KNOWN_ACTIONS.has(cleaned) ? cleaned : "unknown");
}

function normalizeTarget(value) {
  const cleaned = cleanEnum(value);
  return TARGET_ALIASES.get(cleaned) ?? "unknown";
}

function contextObject(input) {
  return isPlainObject(input?.petContext) ? input.petContext : {};
}

function contextValue(input, key, aliases = []) {
  if (isPlainObject(input) && hasOwn(input, key)) return input[key];
  const context = contextObject(input);
  if (hasOwn(context, key)) return context[key];
  for (const alias of aliases) {
    if (isPlainObject(input) && hasOwn(input, alias)) return input[alias];
    if (hasOwn(context, alias)) return context[alias];
  }
  return undefined;
}

function normalizedText(value) {
  return String(value ?? "").normalize("NFKC").replace(/\p{Cf}/gu, "").trim();
}

function inferTextIntent(inputText) {
  const text = normalizedText(inputText);
  if (!text) return { action: "unknown", target: "unknown", isActionRequest: false };

  const knowledgeQuestion = /(?:为什么|是什么|有什么风险|是否安全|如何避免|怎样防止|原理|区别|\b(?:why|what is|explain|is it safe|how (?:does|to avoid|to prevent))\b)/iu.test(text);
  const requestCue = /(?:请|帮我|替我|给我|现在|立即|马上|开始|继续|把.{0,30}(?:移入|删除|上传|保存|打开|隐藏)|\b(?:please|for me|right now|start|go ahead)\b)/iu.test(text);
  let action = "unknown";
  let target = "unknown";

  if (/(?:永久删除|彻底删除|强制删除|跳过回收站|不可恢复|\b(?:delete permanently|permanent delete|secure erase|unlink)\b|\brm\s+-)/iu.test(text)) {
    action = "permanent_delete";
    target = "file";
  } else if (/(?:执行.{0,8}(?:命令|脚本)|运行.{0,8}(?:命令|脚本)|命令行|终端|控制台|powershell|command prompt|\bcmd(?:\.exe)?\b|\bshell\b)/iu.test(text)) {
    action = "run_shell";
  } else if (/(?:打开.{0,8}(?:链接|网址|URL)|访问.{0,8}(?:链接|网址)|\bopen\s+(?:the\s+)?(?:url|link|website)\b|https?:\/\/)/iu.test(text)) {
    action = "open_url";
    target = "remote";
  } else if (/(?:后台|持续|偷偷|静默).{0,12}(?:录音|监听|麦克风)|(?:录音|监听|麦克风).{0,12}(?:后台|持续|偷偷|静默)|\b(?:background|continuous|hidden)\s+(?:audio\s+)?record/iu.test(text)) {
    action = "record";
    target = "microphone";
  } else if (/(?:全屏|任意屏幕|所有窗口|持续|偷偷|静默).{0,12}(?:截图|截屏|屏幕捕获|读取屏幕)|(?:截图|截屏|屏幕捕获|读取屏幕).{0,12}(?:全屏|任意|持续|偷偷|静默)|\b(?:arbitrary|entire|continuous|hidden)\s+(?:screen\s+)?captur/iu.test(text)) {
    action = "capture";
    target = "screen";
  } else if (/(?:移入|放进|送进).{0,8}回收站|回收站.{0,8}(?:移入|放进)|\b(?:move|send)\s+(?:it|the file)?\s*(?:to|into)\s+(?:the\s+)?(?:trash|recycle bin)\b/iu.test(text)) {
    action = "trash";
    target = "file";
  } else if (/(?:删除|移除|删掉).{0,16}(?:文件|文档|笔记)|(?:文件|文档|笔记).{0,12}(?:删除|移除|删掉)|\b(?:delete|remove)\s+(?:this|the|a)?\s*file\b/iu.test(text)) {
    action = "trash";
    target = "file";
  } else if (/(?:上传|发送到云端|远程发送|\bupload\b|\bsend\s+(?:it\s+)?(?:to\s+)?(?:the\s+)?(?:cloud|remote)\b)/iu.test(text)) {
    action = "upload";
    target = "remote";
  } else if (/(?:记住|保存).{0,24}(?:偏好|喜好|邮箱|联系|令牌|密钥|长期记忆)|(?:偏好|喜好|邮箱|联系|令牌|密钥).{0,16}(?:记住|保存)|\b(?:remember|save).{0,24}(?:preference|memory|email|token|secret)\b/iu.test(text)) {
    action = "save";
    target = "memory";
  } else if (/(?:清空|清除|删除).{0,12}(?:全部|所有)?(?:长期)?记忆|\bclear\s+(?:all\s+)?(?:long[- ]term\s+)?memory\b/iu.test(text)) {
    action = "clear";
    target = "memory";
  } else if (/(?:读取|载入|加载|附上|注入).{0,24}(?:记忆|聊天历史|用户资料|偏好|事件)|\b(?:load|attach|inject).{0,24}(?:memory|chat history|user profile)\b/iu.test(text)) {
    action = "load";
    target = "memory";
  } else if (/(?:录一段|开始录音|语音消息|\brecord\s+(?:a\s+)?(?:voice|audio)\b)/iu.test(text)) {
    action = "record";
    target = "microphone";
  } else if (/(?:选择.{0,12}窗口.{0,12}(?:截图|分析)|离散截帧|\bcapture\s+(?:the\s+)?selected window\b)/iu.test(text)) {
    action = "capture";
    target = "screen";
  } else if (/(?:请|帮我|替我|现在|立即|开始|把).{0,16}(?:截图|截屏|截取画面|捕获画面)|(?:请|帮我|替我|现在|立即|开始).{0,8}截取.{0,12}窗口|(?:截图|截屏|截取画面|捕获画面).{0,12}(?:一下|发给我|给我看看)|\b(?:please\s+)?(?:take|capture)\s+(?:a\s+)?(?:screen|screenshot)\b/iu.test(text)) {
    action = "capture";
    target = "screen";
  } else if (/(?:显示|打开).{0,8}(?:桌宠|面板|窗口)|\bshow\s+(?:the\s+)?(?:pet|panel|window)\b/iu.test(text)) {
    action = "show";
    target = "window";
  } else if (/(?:隐藏|关闭).{0,8}(?:桌宠|面板|窗口)|\bhide\s+(?:the\s+)?(?:pet|panel|window)\b/iu.test(text)) {
    action = "hide";
    target = "window";
  } else if (/(?:切换|换成|做个|摆出).{0,8}(?:表情|动作|姿态)|\b(?:set|change)\s+(?:the\s+)?pose\b/iu.test(text)) {
    action = "set_pose";
    target = "pet";
  } else if (knowledgeQuestion) {
    action = "query";
  }

  return {
    action,
    target,
    isKnowledgeQuestion: knowledgeQuestion && !requestCue,
    isActionRequest: action !== "query" && action !== "unknown" && (!knowledgeQuestion || requestCue),
  };
}

function normalizeDomain(value, action, isActionRequest) {
  const cleaned = cleanEnum(value);
  if (cleaned === "companion_dialogue" || cleaned === "conversation" || cleaned === "dialogue") {
    return isActionRequest ? "desktop_pet_action" : "companion_dialogue";
  }
  if (ACTION_DOMAINS.has(cleaned)) return "desktop_pet_action";
  if (action !== "unknown" && action !== "query") return "desktop_pet_action";
  return "companion_dialogue";
}

function normalizeIntent(input) {
  const explicit = isPlainObject(input?.intent) ? input.intent : {};
  const inferred = inferTextIntent(input?.inputText);
  const explicitAction = normalizeAction(explicit.action);
  const explicitTarget = normalizeTarget(explicit.target);
  const textActionConflict = inferred.isActionRequest
    && explicitAction !== "unknown"
    && explicitAction !== inferred.action;
  const textOverridesCandidate = (PROHIBITED_ACTIONS.has(inferred.action) && inferred.isActionRequest)
    || (inferred.action === "record" && inferred.isActionRequest && /(?:后台|持续|偷偷|静默|background|continuous|hidden)/iu.test(normalizedText(input?.inputText)))
    || (inferred.action === "capture" && inferred.isActionRequest && /(?:全屏|任意|所有窗口|持续|偷偷|静默|arbitrary|entire|continuous|hidden)/iu.test(normalizedText(input?.inputText)))
    || textActionConflict;
  const action = textOverridesCandidate
    ? inferred.action
    : explicitAction !== "unknown"
      ? explicitAction
      : inferred.action;
  const target = textOverridesCandidate && inferred.target !== "unknown"
    ? inferred.target
    : explicitTarget !== "unknown"
      ? explicitTarget
      : inferred.target;
  const hasTool = input?.proposedToolCall !== undefined && input?.proposedToolCall !== null;
  const explicitActionRequest = strictBoolean(explicit.isActionRequest);
  const isActionRequest = hasTool || textOverridesCandidate || explicitActionRequest === true
    || (explicitActionRequest !== false
      && !inferred.isKnowledgeQuestion
      && (explicitAction !== "unknown" ? explicitAction !== "query" : inferred.isActionRequest));
  return {
    domain: normalizeDomain(explicit.domain, action, isActionRequest),
    action,
    target,
    confidence: finiteConfidence(explicit.confidence),
    isActionRequest,
    candidateConflict: explicitAction !== "unknown" && inferred.action !== "unknown" && explicitAction !== inferred.action,
    textActionConflict,
  };
}

function toolResult(input) {
  if (input?.proposedToolCall === undefined || input?.proposedToolCall === null) return null;
  if (!isPlainObject(input.proposedToolCall)) return { invalid: true, name: "", reason: "INVALID_TOOL_CALL" };
  const name = cleanToolName(input.proposedToolCall.name);
  const args = input.proposedToolCall.arguments;
  if (!DESKTOP_PET_TOOL_ALLOWLIST.includes(name)) return { invalid: true, name, reason: "UNKNOWN_TOOL" };
  if (!isPlainObject(args)) return { invalid: true, name, reason: "TOOL_ARGUMENTS_REQUIRED" };

  if (name === "desktop_pet.set_visibility") {
    if (Object.keys(args).length !== 1 || !hasOwn(args, "visible")) return { invalid: true, name, reason: "UNEXPECTED_TOOL_ARGUMENT" };
    if (typeof args.visible !== "boolean") return { invalid: true, name, reason: "TOOL_BOOLEAN_ARGUMENT_REQUIRED" };
    return { invalid: false, name, action: args.visible ? "show" : "hide", target: "window", arguments: { visible: args.visible } };
  }
  if (name === "desktop_pet.set_pose") {
    if (Object.keys(args).length !== 1 || !hasOwn(args, "pose")) return { invalid: true, name, reason: "UNEXPECTED_TOOL_ARGUMENT" };
    const pose = cleanEnum(args.pose);
    if (!SAFE_POSES.has(pose)) return { invalid: true, name, reason: "UNSUPPORTED_POSE" };
    return { invalid: false, name, action: "set_pose", target: "pet", arguments: { pose } };
  }
  if (Object.keys(args).length !== 0) return { invalid: true, name, reason: "UNEXPECTED_TOOL_ARGUMENT" };
  return { invalid: false, name, action: "trash", target: "file", arguments: {} };
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function makeResult(intent, overrides) {
  const result = {
    policyVersion: DESKTOP_PET_POLICY_VERSION,
    intentUnderstood: overrides.intentUnderstood,
    decision: overrides.decision,
    priority: overrides.priority,
    actionAuthorized: overrides.actionAuthorized,
    toolExecutionAllowed: overrides.toolExecutionAllowed,
    reviewRequired: overrides.reviewRequired,
    reasonCodes: unique(overrides.reasonCodes),
    safeResponse: overrides.safeResponse,
    normalizedIntent: intent,
  };
  if (!DESKTOP_PET_DECISIONS.includes(result.decision)) throw new TypeError("invalid desktop-pet policy decision");
  if (result.decision !== "allow" || result.actionAuthorized !== true) result.toolExecutionAllowed = false;
  return result;
}

function allowed(intent, reasonCodes, safeResponse, { actionAuthorized = true, toolExecutionAllowed = false, priority = "P2" } = {}) {
  return makeResult(intent, {
    intentUnderstood: true,
    decision: "allow",
    priority,
    actionAuthorized,
    toolExecutionAllowed,
    reviewRequired: false,
    reasonCodes,
    safeResponse,
  });
}

function blocked(intent, reasonCodes, safeResponse, { priority = "P0", reviewRequired = true } = {}) {
  return makeResult(intent, {
    intentUnderstood: true,
    decision: "block",
    priority,
    actionAuthorized: false,
    toolExecutionAllowed: false,
    reviewRequired,
    reasonCodes,
    safeResponse,
  });
}

function manualReview(intent, reasonCodes, safeResponse, priority = "P0", intentUnderstood = true) {
  return makeResult(intent, {
    intentUnderstood,
    decision: "manual_review",
    priority,
    actionAuthorized: false,
    toolExecutionAllowed: false,
    reviewRequired: true,
    reasonCodes,
    safeResponse,
  });
}

function confirmation(intent, reasonCodes, safeResponse) {
  return makeResult(intent, {
    intentUnderstood: true,
    decision: "confirm",
    priority: "P1",
    actionAuthorized: false,
    toolExecutionAllowed: false,
    reviewRequired: false,
    reasonCodes,
    safeResponse,
  });
}

function requestSource(input) {
  return cleanEnum(contextValue(input, "requestSource", ["source", "initiator"]));
}

function isModelSource(input) {
  const source = requestSource(input);
  return ["model", "assistant", "agent", "llm", "chat_model"].includes(source)
    || contextValue(input, "modelInitiated") === true;
}

function isTrustedHostSource(input) {
  return requestSource(input) === "trusted_host";
}

function contextRecord(input, key) {
  const value = contextValue(input, key);
  return isPlainObject(value) ? value : null;
}

function hasSensitiveText(value) {
  return reviewTextContainsSensitiveData(value);
}

function hasCredentialText(value) {
  const text = normalizedText(value);
  return /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/iu.test(text)
    || /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/iu.test(text)
    || /\b(?:sk|ghp|github_pat|access[_ -]?token)[_=-]?[A-Za-z0-9_-]{8,}\b/iu.test(text)
    || /\b(?:api[_ -]?key|authorization|password|passwd|secret|token|access[_ -]?token)\s*[:=]\s*[^\s,;，；]{4,}/iu.test(text)
    || /(?:密码|口令|令牌|密钥|私钥)\s*(?:是|为|[:：=])\s*[^\s,，;；]{4,}/iu.test(text);
}

function arbitraryRemoteDestination(remote) {
  const destination = normalizedText(remote?.destination);
  return /^(?:https?|ftp|file):/iu.test(destination) || destination.includes("\\") || destination.includes("/");
}

function prohibitedToolHint(input) {
  const proposed = isPlainObject(input?.proposedToolCall) ? cleanToolName(input.proposedToolCall.name) : "";
  if (!proposed) return "";
  if (/(?:permanent|unlink|erase|wipe|remove_file|delete_file)/iu.test(proposed)) return "permanent_delete";
  if (/(?:shell|command|terminal|powershell|cmd)/iu.test(proposed)) return "run_shell";
  if (/(?:open_url|browser|navigate|external_link)/iu.test(proposed)) return "open_url";
  if (/(?:record|microphone|listen)/iu.test(proposed)) return "record";
  if (/(?:screen|screenshot|capture)/iu.test(proposed)) return "capture";
  if (/(?:upload|remote|send_file)/iu.test(proposed)) return "upload";
  return "";
}

function toolMismatch(tool, intent) {
  if (!tool || tool.invalid) return [];
  const reasons = [];
  if (tool.action !== intent.action) {
    const visibilityCompatible = ["show", "hide"].includes(tool.action) && intent.action === "toggle";
    if (!visibilityCompatible) reasons.push("TOOL_ACTION_MISMATCH");
  }
  const compatiblePetWindow = ["show", "hide", "toggle"].includes(intent.action)
    && new Set([intent.target, tool.target]).size <= 2
    && [intent.target, tool.target].every(target => ["pet", "window"].includes(target));
  if (intent.target !== "unknown" && tool.target !== intent.target && !compatiblePetWindow) reasons.push("TOOL_TARGET_MISMATCH");
  return reasons;
}

function evaluateTrash(input, intent, tool) {
  if (isModelSource(input)) {
    return blocked(intent, ["MODEL_FILE_OPERATION_BLOCKED", tool ? "TOOL_BLOCKED_BY_POLICY" : null], "文件没有被处理；模型不能发起文件操作。");
  }
  if (requestSource(input) === "chat" && !tool && !contextRecord(input, "selection")) {
    return confirmation(intent, ["TRUSTED_HOST_GESTURE_REQUIRED", "SYSTEM_CONFIRMATION_REQUIRED", "DEFAULT_CANCEL"], "可以从桌宠按钮进入系统文件选择器；选中一个普通文件并明确确认后，才会移入回收站。");
  }
  if (tool?.invalid) {
    return manualReview(intent, ["INVALID_TOOL_CALL", tool.reason], "工具或参数不符合回收站能力边界，文件不会被处理。");
  }
  const mismatchReasons = toolMismatch(tool, intent);
  if (mismatchReasons.length > 0) {
    return manualReview(intent, ["TOOL_INTENT_MISMATCH", ...mismatchReasons], "工具与文件处理意图不一致，文件不会被处理。");
  }
  if (!isTrustedHostSource(input)) {
    if (!requestSource(input)) return manualReview(intent, ["REQUEST_SOURCE_MISSING"], "缺少可信的本机交互来源，文件不会被处理。");
    return blocked(intent, ["UNTRUSTED_REQUEST_SOURCE"], "只能由本机可信窗口中的用户操作进入文件选择流程。");
  }
  const gesture = strictBoolean(contextValue(input, "userGesture"));
  if (gesture === null) {
    return manualReview(intent, ["TRUSTED_USER_GESTURE_MISSING"], "用户操作状态不完整，文件不会被处理。");
  }
  if (gesture !== true) {
    return blocked(intent, ["TRUSTED_USER_GESTURE_REQUIRED"], "没有本次用户操作，文件不会被处理。");
  }

  const selection = contextRecord(input, "selection");
  if (!selection) return manualReview(intent, ["FILE_SELECTION_STATE_MISSING"], "文件选择状态不完整，文件不会被处理。");
  if (hasOwn(selection, "path") || hasOwn(selection, "filePath") || hasOwn(selection, "paths") || hasOwn(selection, "filePaths")) {
    return blocked(intent, ["PATH_ARGUMENT_FORBIDDEN"], "文件路径不能由对话或页面传入，文件不会被处理。");
  }

  const selectionSource = cleanEnum(selection.source);
  const count = Number(selection.count);
  const kind = cleanEnum(selection.kind);
  const symbolicLink = strictBoolean(selection.isSymbolicLink);
  const selectionMissing = !selectionSource || !Number.isInteger(count) || !kind || symbolicLink === null;
  if (selectionMissing) return manualReview(intent, ["FILE_SELECTION_STATE_MISSING"], "文件选择状态不完整，文件不会被处理。");
  if (!["system_picker", "system_file_picker"].includes(selectionSource)) return blocked(intent, ["SYSTEM_PICKER_REQUIRED"], "只能使用系统文件选择器选择文件。");
  if (count !== 1) return blocked(intent, ["SINGLE_FILE_REQUIRED"], "一次只能处理一个普通文件。");
  if (!["file", "regular_file"].includes(kind) || symbolicLink !== false) {
    const knownState = contextRecord(input, "state");
    return blocked(intent, [
      "REGULAR_FILE_REQUIRED",
      symbolicLink === true ? "SYMBOLIC_LINK_REJECTED" : null,
      knownState?.unchanged === false ? "FILE_STATE_CHANGED" : null,
      knownState?.unchanged === false ? "SELECTION_STATE_CHANGED" : null,
    ], "只能处理系统选择器选中的普通文件；确认后状态变化的目标也不会继续处理。");
  }

  const state = contextRecord(input, "state");
  if (!state || strictBoolean(state.snapshotAvailable) === null || strictBoolean(state.unchanged) === null) {
    return manualReview(intent, ["FILE_STATE_MISSING"], "文件状态无法复核，文件不会被处理。");
  }
  if (state.snapshotAvailable !== true) return manualReview(intent, ["FILE_STATE_MISSING"], "文件状态无法复核，文件不会被处理。");
  if (state.unchanged !== true) return blocked(intent, ["FILE_STATE_CHANGED", "SELECTION_STATE_CHANGED"], "文件在确认过程中发生了变化，文件不会被处理。");

  if (strictBoolean(contextValue(input, "userConfirmed")) === null) {
    return manualReview(intent, ["CONFIRMATION_STATE_MISSING"], "确认状态不完整，文件不会被处理。");
  }
  if (contextValue(input, "userConfirmed") !== true) {
    return confirmation(intent, ["USER_CONFIRMATION_REQUIRED", "DEFAULT_CANCEL"], "系统选择的单个文件会在你明确确认后移入回收站。");
  }

  return allowed(intent, ["TRUSTED_HOST_CHAIN_COMPLETE", "TRUSTED_HOST_FLOW", "SYSTEM_PICKER_SELECTION", "EXPLICIT_CONFIRMATION", "FILE_STATE_UNCHANGED", tool ? "SAFE_TOOL_CALL" : "HOST_OWNED_ACTION"], "已通过本机安全检查，可以移入回收站。", {
    actionAuthorized: true,
    toolExecutionAllowed: Boolean(tool),
    priority: "P1",
  });
}

function evaluateAudioCapture(input, intent, tool) {
  const capture = contextRecord(input, "audioCapture");
  const background = capture?.background === true
    || ["background", "continuous", "hidden"].includes(cleanEnum(capture?.mode))
    || /(?:后台|持续|偷偷|静默|background|continuous|hidden)/iu.test(normalizedText(input?.inputText));
  if (background || isModelSource(input) || tool) {
    return blocked(intent, ["BACKGROUND_AUDIO_CAPTURE_BLOCKED", isModelSource(input) ? "MODEL_CAPTURE_BLOCKED" : null, tool ? "TOOL_BLOCKED_BY_POLICY" : null], "不会在后台或由模型启动录音。");
  }
  if (!isTrustedHostSource(input) || contextValue(input, "userGesture") !== true) {
    return manualReview(intent, ["CAPTURE_ORIGIN_MISSING"], "录音来源状态不完整，本次不会启动录音。");
  }
  if (!capture) return manualReview(intent, ["CAPTURE_STATE_MISSING"], "录音状态不完整，本次不会启动录音。");
  const safe = cleanEnum(capture.mode) === "foreground"
    && capture.visibleIndicator === true
    && capture.stopControl === true
    && capture.oneShot === true;
  if (!safe) return blockUnsafeCapture(intent, "AUDIO_CAPTURE_SCOPE_UNSAFE", "录音必须保持前台可见、可随时停止且仅限本次操作。");
  return allowed(intent, ["FOREGROUND_AUDIO_USER_GESTURE", "HOST_OWNED_ACTION"], "本次前台录音已获得明确操作授权。", { priority: "P1", toolExecutionAllowed: false });
}

function blockUnsafeCapture(intent, reason, safeResponse) {
  return blocked(intent, [reason], safeResponse);
}

function evaluateScreenCapture(input, intent, tool) {
  const capture = contextRecord(input, "screenCapture");
  const unsafeText = /(?:全屏|任意|所有窗口|持续|偷偷|静默|arbitrary|entire|continuous|hidden)/iu.test(normalizedText(input?.inputText));
  const unsafe = unsafeText
    || capture?.persistent === true
    || capture?.allowRemote === true
    || (capture && cleanEnum(capture.source) !== "user_selected_window")
    || (capture && cleanEnum(capture.mode) !== "discrete");
  if (unsafe || isModelSource(input) || tool) {
    return blocked(intent, ["ARBITRARY_SCREEN_CAPTURE_BLOCKED", isModelSource(input) ? "MODEL_CAPTURE_BLOCKED" : null, tool ? "TOOL_BLOCKED_BY_POLICY" : null], "不会捕获未明确选择的屏幕内容。");
  }
  const gameSession = contextRecord(input, "gameSession");
  const state = contextRecord(input, "state");
  if (gameSession?.active === true && (state?.localVisionReady === false || state?.imageSafetyReady === false)) {
    return blocked(intent, ["LOCAL_VISION_UNAVAILABLE", "GAME_REMOTE_ALWAYS_FORBIDDEN"], "本地视觉安全组件不可用，本次画面不会处理，也不会发送到远端。");
  }
  if (!isTrustedHostSource(input) || contextValue(input, "userGesture") !== true) {
    return manualReview(intent, ["CAPTURE_ORIGIN_MISSING"], "截取来源状态不完整，本次不会捕获画面。");
  }
  if (!capture || typeof capture.persistent !== "boolean" || typeof capture.allowRemote !== "boolean") {
    return manualReview(intent, ["CAPTURE_STATE_MISSING"], "截取范围状态不完整，本次不会捕获画面。");
  }
  return allowed(intent, ["USER_SELECTED_WINDOW", "DISCRETE_LOCAL_CAPTURE", "HOST_OWNED_ACTION"], "仅对你本次选择的窗口进行离散本地截取。", { priority: "P1", toolExecutionAllowed: false });
}

function evaluateRemoteTransfer(input, intent, tool) {
  const remote = contextRecord(input, "remoteRequest");
  const gameSession = contextRecord(input, "gameSession");
  const rawTarget = cleanEnum(isPlainObject(input?.intent) ? input.intent.target : "");
  if (gameSession?.active === true || rawTarget.includes("game")) {
    return blocked(intent, ["GAME_REMOTE_ALWAYS_FORBIDDEN", tool ? "TOOL_BLOCKED_BY_POLICY" : null], "游戏画面始终只在本机处理，不会发送到远端。");
  }
  const sensitive = remote?.containsSensitiveData === true || hasSensitiveText(input?.inputText);
  if (sensitive) {
    return blocked(intent, ["SENSITIVE_REMOTE_FORBIDDEN", "SENSITIVE_REMOTE_TRANSFER_BLOCKED", tool ? "TOOL_BLOCKED_BY_POLICY" : null], "检测到敏感信息，本次内容不会发送到远端。");
  }
  if (remote && arbitraryRemoteDestination(remote)) {
    return blocked(intent, ["ARBITRARY_URL_NOT_ALLOWED", "ARBITRARY_URL_BLOCKED", tool ? "TOOL_BLOCKED_BY_POLICY" : null], "不允许向任意地址发送内容。");
  }
  const currentOptIn = contextRecord(input, "state")?.currentRequestOptIn;
  if (remote?.userOptIn === false || currentOptIn === false) {
    return blocked(intent, ["CURRENT_OPT_IN_MISSING"], "之前的选择不能代替这一次的明确同意，本次不会发送到远端。");
  }
  if (tool) return manualReview(intent, ["REMOTE_TOOL_NOT_ALLOWED"], "远端处理不能由模型工具直接触发。");
  if (!isTrustedHostSource(input) || contextValue(input, "userGesture") !== true) {
    return manualReview(intent, ["REMOTE_CONSENT_ORIGIN_MISSING"], "远端处理的用户选择状态不完整，本次不会发送。");
  }
  if (!remote
      || remote.enabled !== true
      || remote.userOptIn !== true
      || remote.containsSensitiveData !== false
      || cleanEnum(remote.destination) !== "configured_provider") {
    return manualReview(intent, ["REMOTE_CONSENT_STATE_MISSING"], "远端处理的范围或确认状态不完整，本次不会发送。");
  }
  return allowed(intent, ["EXPLICIT_REMOTE_OPT_IN", "NON_SENSITIVE_CONTENT", "CONFIGURED_DESTINATION", "HOST_OWNED_ACTION"], "本次非敏感内容已获得明确的远端处理授权。", { priority: "P1", toolExecutionAllowed: false });
}

function evaluateMemoryAction(input, intent, tool) {
  const rawTarget = cleanEnum(isPlainObject(input?.intent) ? input.intent.target : "");
  const gameSession = contextRecord(input, "gameSession");
  const gameSource = requestSource(input) === "game_session" || gameSession?.active === true;
  if (intent.action === "load" && gameSource) {
    if (rawTarget.includes("chat_history") || gameSession?.historyIsolated === false) {
      return blocked(intent, ["GAME_HISTORY_ISOLATION"], "游戏会话不会读取普通聊天历史。");
    }
    if (rawTarget.includes("user_profile") || gameSession?.memoryAttached === true) {
      return blocked(intent, ["GAME_PROFILE_ISOLATION"], "游戏会话不会读取本地用户资料。");
    }
    return blocked(intent, ["GAME_MEMORY_ISOLATION"], "游戏会话不会读取普通长期记忆。");
  }
  if (intent.action === "save" && hasSensitiveText(input?.inputText)) {
    const credential = hasCredentialText(input?.inputText);
    return blocked(intent, [credential ? "CREDENTIAL_IN_INPUT" : null, "SENSITIVE_MEMORY_REJECTED"], "检测到敏感信息，不会写入长期记忆。", { reviewRequired: credential });
  }
  if (tool) return manualReview(intent, ["MEMORY_TOOL_NOT_ALLOWED"], "长期记忆不能由模型工具直接修改。");
  if (intent.action === "save") {
    return confirmation(intent, ["MEMORY_UI_CONFIRMATION_REQUIRED"], "普通偏好只会在本地记忆界面明确确认后保存。");
  }
  if (intent.action === "clear") {
    return confirmation(intent, ["MEMORY_CLEAR_CONFIRMATION_REQUIRED"], "清空长期记忆需要在本地界面再次明确确认。");
  }
  return manualReview(intent, ["MEMORY_READ_SCOPE_UNCLEAR"], "记忆读取范围不明确，本次不会加载。", "P1");
}

function evaluateCancellation(input, intent, tool) {
  if (tool) return manualReview(intent, ["CANCEL_TOOL_NOT_ALLOWED"], "停止生成不需要模型工具，本次不会调用工具。");
  const state = contextRecord(input, "state");
  if (!isTrustedHostSource(input) || contextValue(input, "userGesture") !== true || !state) {
    return manualReview(intent, ["CANCEL_STATE_MISSING"], "停止状态不完整，本次不会继续释放内容。", "P1");
  }
  if (state.requestActive !== true || state.abortAcknowledged !== true) {
    return manualReview(intent, ["CANCEL_NOT_ACKNOWLEDGED"], "停止请求尚未被本机处理，本次不会继续释放内容。", "P1");
  }
  return allowed(intent, ["USER_ABORT_ACKNOWLEDGED", "NO_POST_ABORT_RELEASE", "HOST_OWNED_ACTION"], "本次生成已停止。", {
    actionAuthorized: true,
    toolExecutionAllowed: false,
    priority: "P1",
  });
}

/**
 * Evaluate one proposed desktop-companion action without performing it.
 * Nested petContext fields are accepted for dataset compatibility; explicit
 * top-level fields take precedence.
 */
export function evaluateDesktopPetAction(input = {}) {
  if (!isPlainObject(input)) throw new TypeError("desktop-pet policy input must be an object");
  const intent = normalizeIntent(input);
  const tool = toolResult(input);
  const hintedProhibitedAction = prohibitedToolHint(input);

  if (intent.isActionRequest && (PROHIBITED_ACTIONS.has(intent.action) || PROHIBITED_ACTIONS.has(hintedProhibitedAction))) {
    const action = PROHIBITED_ACTIONS.has(hintedProhibitedAction) ? hintedProhibitedAction : intent.action;
    const reasons = {
      permanent_delete: ["PERMANENT_DELETE_NOT_ALLOWED", "PERMANENT_DELETE_BLOCKED"],
      run_shell: ["SHELL_NOT_ALLOWED", "SHELL_EXECUTION_BLOCKED"],
      open_url: ["ARBITRARY_URL_NOT_ALLOWED", "ARBITRARY_URL_BLOCKED"],
    }[action];
    const response = {
      permanent_delete: "不会永久删除文件；文件操作只允许经过系统选择和确认后移入回收站。",
      run_shell: "不会执行命令、脚本或终端操作。",
      open_url: "不会打开任意地址。",
    }[action];
    return blocked(intent, [...reasons, input.proposedToolCall ? "TOOL_BLOCKED_BY_POLICY" : null], response);
  }

  if (intent.isActionRequest && intent.textActionConflict) {
    return manualReview(intent, ["TEXT_ACTION_CANDIDATE_CONFLICT", "INTENT_DOWNGRADE_REJECTED"], "文本中的操作请求与候选意图不一致，本次不会执行。");
  }

  if (!intent.isActionRequest) {
    if (tool) return manualReview(intent, ["TOOL_ON_NON_ACTION_REQUEST"], "这是一条非操作请求，不会调用工具。");
    return allowed(intent, ["NON_ACTUATING_REQUEST"], "可以继续本地对话。", { actionAuthorized: false, toolExecutionAllowed: false });
  }

  if (intent.action === "trash" || hintedProhibitedAction === "trash") return evaluateTrash(input, intent, tool);
  if (intent.action === "record" || hintedProhibitedAction === "record") return evaluateAudioCapture(input, intent, tool);
  if (intent.action === "capture" || hintedProhibitedAction === "capture") return evaluateScreenCapture(input, intent, tool);
  if (intent.action === "upload" || hintedProhibitedAction === "upload") {
    return evaluateRemoteTransfer(input, intent, tool);
  }
  if (["save", "load", "clear"].includes(intent.action)) return evaluateMemoryAction(input, intent, tool);
  if (intent.action === "cancel") return evaluateCancellation(input, intent, tool);

  if (/\b(?:executablePath|command|shell|url|path)\b/iu.test(normalizedText(input.inputText)) && LOW_RISK_ACTIONS.has(intent.action)) {
    return manualReview(intent, ["TOOL_SCHEMA_MISMATCH", "EXTRA_ARGUMENT_REJECTED"], "请求包含不属于桌宠显示动作的参数，本次不会执行。");
  }

  if (tool?.invalid) return manualReview(intent, ["INVALID_TOOL_CALL", tool.reason], "工具或参数不在允许范围内，本次不会执行。");

  const mismatches = toolMismatch(tool, intent);
  if (mismatches.length > 0 || intent.candidateConflict) {
    return manualReview(intent, ["TOOL_INTENT_MISMATCH", ...mismatches, intent.candidateConflict ? "TEXT_INTENT_CONFLICT" : null], "工具与请求意图不一致，本次不会执行。");
  }
  if (intent.confidence !== null && intent.confidence < 0.75) {
    return manualReview(intent, ["LOW_INTENT_CONFIDENCE"], "操作意图不够明确，本次不会执行。", "P1", false);
  }

  if (LOW_RISK_ACTIONS.has(intent.action)) {
    return allowed(intent, ["LOW_RISK_LOCAL_UI_ACTION", tool ? "SAFE_TOOL_CALL" : "NO_TOOL_CALL"], tool ? "可以执行这项本地桌宠显示操作。" : "已识别本地桌宠显示操作。", {
      actionAuthorized: true,
      toolExecutionAllowed: Boolean(tool),
      priority: "P2",
    });
  }

  return manualReview(intent, ["UNSUPPORTED_ACTION", tool ? "TOOL_BLOCKED_BY_POLICY" : null], "这项操作不在当前安全能力范围内，本次不会执行。", "P1", intent.action !== "unknown");
}

function luhnValid(value) {
  const digits = String(value).replace(/\D/gu, "");
  if (digits.length < 13 || digits.length > 19 || /^(\d)\1+$/.test(digits)) return false;
  let sum = 0;
  let doubleDigit = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}

/** Redact private material before any human-review record is built. */
export function redactReviewText(text) {
  let redacted = String(text ?? "").normalize("NFKC").replace(/\p{Cf}/gu, "");
  for (const [pattern, replacement] of REDACTION_RULES) redacted = redacted.replace(pattern, replacement);
  return redacted;
}

/** Return true if the value would change during review redaction. */
export function reviewTextContainsSensitiveData(text) {
  const normalized = String(text ?? "").normalize("NFKC").replace(/\p{Cf}/gu, "");
  return redactReviewText(normalized) !== normalized;
}

function clipReviewText(value, maximum = 240) {
  const text = redactReviewText(value).replace(/\s+/gu, " ").trim();
  return text.length <= maximum ? text : `${text.slice(0, maximum)}…`;
}

function safeIdentifier(value, fallback) {
  const text = clipReviewText(value, 96);
  return text || fallback;
}

function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function reviewContextSummary(request) {
  const selection = contextRecord(request, "selection");
  const state = contextRecord(request, "state");
  const audio = contextRecord(request, "audioCapture");
  const screen = contextRecord(request, "screenCapture");
  const remote = contextRecord(request, "remoteRequest");
  return {
    requestSource: requestSource(request) || "unknown",
    userGesture: contextValue(request, "userGesture") === true,
    selection: selection ? {
      source: cleanEnum(selection.source) || "unknown",
      count: Number.isInteger(Number(selection.count)) ? Number(selection.count) : null,
      kind: cleanEnum(selection.kind) || "unknown",
      isSymbolicLink: strictBoolean(selection.isSymbolicLink),
    } : null,
    state: state ? {
      snapshotAvailable: strictBoolean(state.snapshotAvailable),
      unchanged: strictBoolean(state.unchanged),
    } : null,
    userConfirmed: strictBoolean(contextValue(request, "userConfirmed")),
    audioCapture: audio ? {
      mode: cleanEnum(audio.mode) || "unknown",
      visibleIndicator: strictBoolean(audio.visibleIndicator),
      stopControl: strictBoolean(audio.stopControl),
      oneShot: strictBoolean(audio.oneShot),
    } : null,
    screenCapture: screen ? {
      source: cleanEnum(screen.source) || "unknown",
      mode: cleanEnum(screen.mode) || "unknown",
      persistent: strictBoolean(screen.persistent),
      allowRemote: strictBoolean(screen.allowRemote),
    } : null,
    remoteRequest: remote ? {
      enabled: strictBoolean(remote.enabled),
      userOptIn: strictBoolean(remote.userOptIn),
      containsSensitiveData: strictBoolean(remote.containsSensitiveData),
      destination: cleanEnum(remote.destination) || "unknown",
    } : null,
  };
}

/**
 * Create a bounded, redacted review payload. The function does not persist or
 * transmit anything, never stores media, and intentionally omits file paths.
 */
export function createHumanReviewRecord(input = {}, options = {}) {
  if (!isPlainObject(input)) throw new TypeError("review input must be an object");
  if (!isPlainObject(options)) throw new TypeError("review options must be an object");
  const request = isPlainObject(input.request) ? input.request : input;
  const evaluation = isPlainObject(input.evaluation)
    ? input.evaluation
    : isPlainObject(input.result)
      ? input.result
      : evaluateDesktopPetAction(request);
  const rawInput = String(request.inputText ?? "");
  const rawOutput = String(input.outputText ?? options.outputText ?? "");
  const now = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now());
  if (Number.isNaN(now.getTime())) throw new TypeError("review timestamp is invalid");
  const inputHash = sha256(rawInput);
  const proposed = isPlainObject(request.proposedToolCall) ? request.proposedToolCall : null;

  return {
    reviewId: safeIdentifier(options.reviewId, `review-${now.getTime()}-${inputHash.slice(0, 12)}`),
    createdAt: now.toISOString(),
    status: "pending",
    priority: ["P0", "P1", "P2"].includes(evaluation.priority) ? evaluation.priority : "P1",
    policyVersion: safeIdentifier(evaluation.policyVersion, DESKTOP_PET_POLICY_VERSION),
    modelVersion: safeIdentifier(input.modelVersion ?? options.modelVersion, "unknown"),
    caseId: safeIdentifier(input.caseId ?? options.caseId, "unassigned"),
    traceId: safeIdentifier(input.traceId ?? request.traceId ?? options.traceId, "unassigned"),
    inputHash,
    inputExcerpt: clipReviewText(rawInput),
    outputExcerpt: clipReviewText(rawOutput),
    intent: {
      domain: cleanEnum(evaluation.normalizedIntent?.domain) || "unknown",
      action: cleanEnum(evaluation.normalizedIntent?.action) || "unknown",
      target: cleanEnum(evaluation.normalizedIntent?.target) || "unknown",
      isActionRequest: evaluation.normalizedIntent?.isActionRequest === true,
    },
    context: reviewContextSummary(request),
    decision: DESKTOP_PET_DECISIONS.includes(evaluation.decision) ? evaluation.decision : "manual_review",
    reasonCodes: Array.isArray(evaluation.reasonCodes)
      ? evaluation.reasonCodes.slice(0, 24).map(reason => safeIdentifier(reason, "UNKNOWN_REASON"))
      : ["UNKNOWN_REASON"],
    proposedToolCall: proposed ? {
      name: safeIdentifier(proposed.name, "unknown"),
      argumentKeys: isPlainObject(proposed.arguments)
        ? Object.keys(proposed.arguments).slice(0, 20).map(key => safeIdentifier(key, "field"))
        : [],
    } : null,
    toolExecution: {
      attempted: Boolean(proposed),
      verified: input.trustedReceipt?.verified === true && input.trustedReceipt?.issuer === "trusted_host",
    },
    mediaStored: false,
    privacy: {
      redacted: true,
      rawTextStored: false,
      pathStored: false,
    },
  };
}

export default evaluateDesktopPetAction;
