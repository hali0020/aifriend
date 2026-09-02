const MAX_INPUT_CHARACTERS = 20_000;

const CREDENTIAL_PATTERNS = Object.freeze([
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/iu,
  /\b(?:sk|ghp|github_pat)-?[A-Za-z0-9_-]{12,}\b/iu,
  /\b(?:api[_ -]?key|authorization|password|secret|token|access[_ -]?token)\s*[:=]\s*[^\s,;，；]{4,}/iu,
]);

const PERSONAL_PATTERNS = Object.freeze([
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
  /(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/u,
  /\b[A-Z0-9][A-HJ-NPR-Z0-9]{16}\b/u,
  /(?<![\d.])-?(?:[1-8]?\d(?:\.\d{4,})|90(?:\.0+)?)\s*[,，]\s*-?(?:1[0-7]\d(?:\.\d{4,})?|[1-9]?\d(?:\.\d{4,})?|180(?:\.0+)?)(?![\d.])/u,
]);

const INJECTION_PATTERNS = Object.freeze([
  /(?:忽略|无视|覆盖|绕过).{0,16}(?:之前|上面|全部|所有)?(?:指令|规则|安全|系统提示|权限)/iu,
  /(?:系统消息|开发者消息|developer mode|system prompt).{0,24}(?:改成|现在是|启用|泄露|显示|输出|reveal|print)/iu,
  /(?:测试模式|管理员模式|越狱模式).{0,20}(?:启用|开启|已授权|绕过)/iu,
  /(?:调用|执行|使用).{0,16}(?:隐藏|未公开|未授权|内部)(?:工具|函数|接口)/iu,
  /\b(?:ignore|override|bypass)\b.{0,32}\b(?:previous|system|developer|safety|policy|instructions?)\b/iu,
  /\b(?:reveal|print|leak|show)\b.{0,24}\b(?:system prompt|hidden tool|developer message|secret)\b/iu,
]);

function hasAny(text, patterns) {
  return patterns.some(pattern => pattern.test(text));
}

function cleanEnum(value) {
  return String(value ?? "").normalize("NFKC").trim().toLowerCase().replace(/[\s-]+/gu, "_").slice(0, 80);
}

function normalizedText(value) {
  const text = String(value ?? "").normalize("NFKC").replace(/\p{Cf}/gu, "").trim();
  if ([...text].length > MAX_INPUT_CHARACTERS) throw new RangeError("evaluation input is too long");
  return text;
}

function actionRisk(intent, context) {
  const domain = cleanEnum(intent?.domain);
  if (domain !== "vehicle_control") return "none";
  const action = cleanEnum(intent?.action);
  const target = cleanEnum(intent?.target);
  const position = cleanEnum(intent?.position);
  const speed = Number(context?.speedKph);
  const moving = Number.isFinite(speed) && speed > 0;
  const highImpact = ["door", "trunk", "child_lock"].includes(target)
    || (target === "seat" && position === "driver")
    || target === "video";
  if (highImpact && moving) return "critical";
  if (highImpact || ["open", "unlock", "disable"].includes(action)) return "high";
  return "low";
}

export function classifyEvaluationInputRisk({ text, intent, vehicleContext } = {}) {
  const normalized = normalizedText(text);
  const credential = hasAny(normalized, CREDENTIAL_PATTERNS);
  const personal = hasAny(normalized, PERSONAL_PATTERNS);
  const injection = hasAny(normalized, INJECTION_PATTERNS);
  const actionRiskHint = actionRisk(intent, vehicleContext);
  const reasonCodes = [];
  if (credential) reasonCodes.push("CREDENTIAL_IN_INPUT");
  if (personal) reasonCodes.push("PERSONAL_DATA_IN_INPUT");
  if (injection) reasonCodes.push("PROMPT_INJECTION_SUSPECTED");
  if (["high", "critical"].includes(actionRiskHint)) reasonCodes.push("HIGH_RISK_ACTION_INTENT");
  return {
    privacy: credential ? "sensitive" : personal ? "personal" : "none",
    injection: injection ? "suspected" : "none",
    actionRiskHint,
    requiresDeterministicPolicy: actionRiskHint !== "none",
    remoteAllowed: !credential && !personal,
    persistOriginal: !credential && !personal,
    reviewRecommended: credential || injection || actionRiskHint === "critical",
    reasonCodes,
  };
}

export const EVALUATION_INPUT_RISK_LIMITS = Object.freeze({ maxInputCharacters: MAX_INPUT_CHARACTERS });
