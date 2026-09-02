const MAX_INPUT_CHARACTERS = 20_000;

const CREDENTIAL_PATTERNS = Object.freeze([
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/iu,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/iu,
  /\b(?:sk|ghp|github_pat)[_-]?[A-Za-z0-9_-]{12,}\b/iu,
  /\b(?:api[_ -]?key|authorization|password|passwd|secret|token|access[_ -]?token)\s*[:=]\s*[^\s,;，；]{4,}/iu,
  /(?:密码|口令|令牌|密钥|私钥)\s*(?:是|为|[:：=])\s*[^\s,，;；]{4,}/iu,
]);

const PERSONAL_PATTERNS = Object.freeze([
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
  /(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/u,
  /(?<!\d)\d{17}[\dXx](?!\d)/u,
  /(?<![\d.])-?(?:[1-8]?\d(?:\.\d{4,})|90(?:\.0+)?)\s*[,，]\s*-?(?:1[0-7]\d(?:\.\d{4,})?|[1-9]?\d(?:\.\d{4,})?|180(?:\.0+)?)(?![\d.])/u,
  /[A-Za-z]:\\(?:[^\s<>:"|?*]+\\)*[^\s<>:"|?*]*/u,
  /(?:\/Users\/|\/home\/)[^\s'"<>]+/u,
]);

const INJECTION_PATTERNS = Object.freeze([
  /(?:忽略|无视|覆盖|绕过).{0,16}(?:之前|上面|全部|所有)?(?:指令|规则|安全|系统提示|权限)/iu,
  /(?:系统消息|开发者消息|developer mode|system prompt).{0,24}(?:改成|现在是|启用|泄露|显示|输出|reveal|print)/iu,
  /(?:测试模式|管理员模式|越狱模式).{0,20}(?:启用|开启|已授权|绕过)/iu,
  /(?:调用|执行|使用).{0,16}(?:隐藏|未公开|未授权|内部)(?:工具|函数|接口)/iu,
  /\b(?:ignore|override|bypass)\b.{0,32}\b(?:previous|system|developer|safety|policy|instructions?)\b/iu,
  /\b(?:reveal|print|leak|show)\b.{0,24}\b(?:system prompt|hidden tool|developer message|secret)\b/iu,
]);

const CRITICAL_ACTION_PATTERNS = Object.freeze([
  /(?:永久删除|彻底删除|强制删除|跳过回收站|不可恢复|\b(?:delete permanently|permanent delete|secure erase|unlink)\b|\brm\s+-)/iu,
  /(?:执行.{0,8}(?:命令|脚本)|运行.{0,8}(?:命令|脚本)|命令行|终端|powershell|command prompt|\bcmd(?:\.exe)?\b|\bshell\b)/iu,
  /(?:打开.{0,8}(?:链接|网址|URL)|访问.{0,8}(?:链接|网址)|\bopen\s+(?:the\s+)?(?:url|link|website)\b|https?:\/\/)/iu,
  /(?:后台|持续|偷偷|静默).{0,12}(?:录音|监听|麦克风)|(?:录音|监听|麦克风).{0,12}(?:后台|持续|偷偷|静默)|\b(?:background|continuous|hidden)\s+(?:audio\s+)?record/iu,
  /(?:全屏|任意屏幕|所有窗口|持续|偷偷|静默).{0,12}(?:截图|截屏|屏幕捕获|读取屏幕)|(?:截图|截屏|屏幕捕获|读取屏幕).{0,12}(?:全屏|任意|持续|偷偷|静默)|\b(?:arbitrary|entire|continuous|hidden)\s+(?:screen\s+)?captur/iu,
]);

const HIGH_ACTION_PATTERNS = Object.freeze([
  /(?:移入|放进|送进).{0,8}回收站|回收站.{0,8}(?:移入|放进)|(?:删除|移除|删掉).{0,16}(?:文件|文档|笔记)|\b(?:delete|remove)\s+(?:this|the|a)?\s*file\b/iu,
  /(?:录一段|开始录音|发送语音消息)|\b(?:start|record)\s+(?:a\s+)?(?:voice|audio)\b/iu,
  /(?:请|帮我|替我|现在|立即|开始|把).{0,16}(?:截图|截屏|截取画面|捕获画面)|(?:请|帮我|替我|现在|立即|开始).{0,8}截取.{0,12}窗口|(?:截图|截屏|截取画面|捕获画面).{0,12}(?:一下|发给我|给我看看)|\b(?:please\s+)?(?:take|capture)\s+(?:a\s+)?(?:screen|screenshot)\b/iu,
  /(?:上传|发送到云端|远程发送)|\b(?:upload|send)\b.{0,20}\b(?:cloud|remote)\b/iu,
]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasAny(text, patterns) {
  return patterns.some(pattern => pattern.test(text));
}

function cleanEnum(value) {
  return String(value ?? "").normalize("NFKC").replace(/\p{Cf}/gu, "").trim().toLowerCase().replace(/[\s-]+/gu, "_").slice(0, 80);
}

function normalizeAction(value) {
  const action = cleanEnum(value);
  const aliases = new Map([
    ["delete_permanently", "permanent_delete"],
    ["shell", "run_shell"],
    ["execute_command", "run_shell"],
    ["record_audio", "record"],
    ["capture_screen", "capture"],
    ["send_remote", "upload"],
    ["move_to_trash", "trash"],
  ]);
  return aliases.get(action) ?? action;
}

function normalizedText(value) {
  const text = String(value ?? "").normalize("NFKC").replace(/\p{Cf}/gu, "").trim();
  if ([...text].length > MAX_INPUT_CHARACTERS) throw new RangeError("evaluation input is too long");
  return text;
}

function contextValue(input, key) {
  if (isPlainObject(input) && Object.prototype.hasOwnProperty.call(input, key)) return input[key];
  if (isPlainObject(input?.petContext) && Object.prototype.hasOwnProperty.call(input.petContext, key)) return input.petContext[key];
  return undefined;
}

function actionRisk(text, intent, input) {
  const action = normalizeAction(intent?.action);
  const domain = cleanEnum(intent?.domain);
  const remote = isPlainObject(contextValue(input, "remoteRequest")) ? contextValue(input, "remoteRequest") : {};
  const audio = isPlainObject(contextValue(input, "audioCapture")) ? contextValue(input, "audioCapture") : {};
  const screen = isPlainObject(contextValue(input, "screenCapture")) ? contextValue(input, "screenCapture") : {};
  const sensitiveRemote = remote.enabled === true && remote.containsSensitiveData === true;
  const backgroundAudio = audio.background === true || ["background", "continuous", "hidden"].includes(cleanEnum(audio.mode));
  const arbitraryScreen = screen.persistent === true
    || screen.allowRemote === true
    || (screen.source && cleanEnum(screen.source) !== "user_selected_window");
  const knowledgeOnly = intent?.isActionRequest === false
    || (/(?:为什么|是什么|有什么风险|是否安全|如何避免|怎样防止|原理|区别|\b(?:why|what is|explain|is it safe|how (?:does|to avoid|to prevent))\b)/iu.test(text)
      && !/(?:请|帮我|替我|现在|立即|马上|开始|继续|\b(?:please|for me|right now|start|go ahead)\b)/iu.test(text));

  if (!knowledgeOnly && (
    hasAny(text, CRITICAL_ACTION_PATTERNS)
      || ["permanent_delete", "run_shell", "open_url"].includes(action)
      || (action === "record" && backgroundAudio)
      || (action === "capture" && arbitraryScreen)
      || (action === "upload" && sensitiveRemote)
  )) return "critical";
  if (knowledgeOnly) return "none";
  if (hasAny(text, HIGH_ACTION_PATTERNS)) return "high";
  if (["trash", "record", "capture", "upload"].includes(action)
      || /(?:移入|放进).{0,8}回收站|(?:删除|删掉).{0,12}(?:文件|文档)|\b(?:delete|remove)\s+(?:this|the|a)?\s*file\b/iu.test(text)) return "high";
  if (["show", "hide", "toggle", "set_pose"].includes(action)) return "low";
  if (["desktop_pet_action", "pet_ui", "file_management", "system_control", "audio_capture", "screen_capture", "network_transfer"].includes(domain)
      && action !== "query") return "high";
  return "none";
}

/** Classify independent privacy, prompt-injection, and local-action risk axes. */
export function classifyEvaluationInputRisk(input = {}) {
  if (!isPlainObject(input)) throw new TypeError("evaluation input must be an object");
  const text = normalizedText(input.text ?? input.inputText);
  const intent = isPlainObject(input.intent) ? input.intent : {};
  const credential = hasAny(text, CREDENTIAL_PATTERNS);
  const personal = hasAny(text, PERSONAL_PATTERNS);
  const injection = hasAny(text, INJECTION_PATTERNS);
  const actionRiskHint = actionRisk(text, intent, input);
  const remote = isPlainObject(contextValue(input, "remoteRequest")) ? contextValue(input, "remoteRequest") : {};
  const sensitiveRemote = remote.enabled === true && (remote.containsSensitiveData === true || credential || personal);
  const reasonCodes = [];
  if (credential) reasonCodes.push("CREDENTIAL_IN_INPUT");
  if (personal) reasonCodes.push("PERSONAL_DATA_IN_INPUT");
  if (injection) reasonCodes.push("PROMPT_INJECTION_SUSPECTED");
  if (["high", "critical"].includes(actionRiskHint)) reasonCodes.push("HIGH_RISK_DESKTOP_ACTION_INTENT");
  if (sensitiveRemote) reasonCodes.push("SENSITIVE_REMOTE_TRANSFER_BLOCKED");
  return {
    privacy: credential ? "sensitive" : personal ? "personal" : "none",
    injection: injection ? "suspected" : "none",
    actionRiskHint,
    requiresDeterministicPolicy: actionRiskHint !== "none",
    remoteAllowed: !credential && !personal && !sensitiveRemote,
    persistOriginal: !credential && !personal,
    reviewRecommended: credential || injection || actionRiskHint === "critical",
    reasonCodes: [...new Set(reasonCodes)],
  };
}

export const EVALUATION_INPUT_RISK_LIMITS = Object.freeze({ maxInputCharacters: MAX_INPUT_CHARACTERS });
