import { classifySafety } from "./safety-classifier.js";

const ACTION_RANK = Object.freeze({ allow: 0, warn: 1, support: 2, block: 3 });
const REMOTE_MODEL = "omni-moderation-latest";

export class SafetyServiceError extends Error {
  constructor(message, code = "safety_service_unavailable") {
    super(message);
    this.name = "SafetyServiceError";
    this.code = code;
  }
}

export function envFlag(value) {
  return /^(?:1|true|yes|on)$/i.test(String(value || "").trim());
}

function publicShape(result, { source, remoteUsed }) {
  return {
    action: result.action,
    severity: result.severity,
    categories: [...result.categories],
    reasonCode: result.categories[0] || "none",
    userMessage: result.userMessage,
    source,
    remoteUsed,
    ...(result.safeText ? { safeText: result.safeText } : {}),
  };
}

function mergeResults(local, remote) {
  if (!remote || remote.action === "allow") return local;
  const dominant = ACTION_RANK[remote.action] > ACTION_RANK[local.action] ? remote : local;
  return {
    ...dominant,
    categories: [...new Set([...local.categories, ...remote.categories])],
  };
}

const REMOTE_PROTECTIVE_PURPOSE = [
  /(?:如何|怎么|哪里|去哪|渠道|方式|方法|措施|说明|咨询).{0,24}(?:举报|预防|防止|阻止|保护|救助|求助|受害者支持|支持受害者|检测|防御|删除)/i,
  /(?:举报|预防|防止|阻止|保护|救助|求助|受害者支持|支持受害者|检测|防御|删除).{0,32}(?:渠道|方式|方法|措施|建议|说明|信息|资源|机构|热线|风险|内容)/i,
  /(?:新闻|报道|研究|科普|法律|判例).{0,36}(?:分析|讨论|说明|探讨|调查|预防|保护|举报|求助|支持|风险|影响|案件)/i,
  /(?:分析|讨论|说明|探讨|调查|预防|保护|举报|求助|支持).{0,36}(?:新闻|报道|研究|科普|法律|判例)/i,
  /(?:需要|寻求|请求|哪里可以|如何获得).{0,16}(?:求助|帮助|支持|危机热线|紧急服务)/i,
  /\b(?:how|where|ways?|guidance|information).{0,28}\b(?:report|prevent|protect|seek help|support victims?|detect|defend|remove)\b/i,
  /\b(?:report|prevent|protect|seek help|support victims?|detect|defend|remove).{0,32}\b(?:channel|method|measure|guidance|information|resource|hotline|risk|content)\b/i,
  /\b(?:news|reporting|research|education|legal|case law).{0,40}\b(?:analy(?:sis|ze)|discuss|explain|investigate|prevent|protect|report|support|risk|impact|case)\b/i,
  /\b(?:need|seek|request|where can i|get).{0,20}\b(?:help|support|a crisis line|emergency services)\b/i,
];

const REMOTE_REFUSAL_CONTEXT = [
  /(?:无法|不能|不会|拒绝)(?:再)?(?:帮助|协助|提供|生成|制作|创建|给出)/i,
  /\b(?:i\s+)?(?:can(?:not|'t)|won't|will not|refuse to)\s+(?:help|assist|provide|generate|create|make|give)\b/i,
];

const REMOTE_HARMFUL_CONTEXT_OVERRIDE = [
  /(?:但|但是|不过|然而|可是|之后|然后|接着|仍然|还是|却|实际上?).{0,64}(?:帮我|给我|教我|告诉我|请你|生成|制作|创建|实施|执行|步骤|教程|方法|计划|代码|脚本|第一步)/i,
  /\b(?:but|however|after(?:wards)?|then|next|still|actually|nevertheless)\b.{0,72}\b(?:help me|tell me|teach me|give me|provide|generate|create|make|carry out|execute|steps?|tutorial|method|plan|code|script|first)\b/i,
  /(?:帮我|给我|教我|告诉我|请你|替我).{0,48}(?:生成|制作|创建|画|绘制|发送|购买|交换|收藏|观看|描述|实施|执行|策划|伤害|杀|下毒|绑架|纵火|引爆)/i,
  /(?:如何|怎么).{0,40}(?:生成|制作|创建|实施|执行|伤害|杀人|谋杀|下毒|绑架|制造炸弹|引爆|自杀|轻生)/i,
  /(?:寻找|获取|下载)(?![^。！？!?]{0,24}(?:举报|预防|求助|帮助|支持|资源|渠道|法律|防御|检测))/i,
  /(?:步骤|教程|操作方法|实施方法|具体方法|行动计划|代码|脚本)(?:如下|是|为|[:：])/i,
  /(?:我|本人|我们).{0,16}(?:想|要|准备|打算|决定|计划|正在|马上|将要|已经).{0,36}(?:自杀|轻生|伤害自己|杀人|谋杀|伤害他人|下毒|绑架|纵火|引爆|实施现实暴力|生成|制作|获取)/i,
  /\b(?:help|tell|teach|show|give) me.{0,52}\b(?:generate|create|make|send|buy|trade|watch|describe|carry out|execute|plan|harm|kill|poison|kidnap|commit arson|detonate)\b/i,
  /\b(?:how (?:do|can|would) (?:i|we)|how to)\b.{0,48}\b(?:generate|create|make|carry out|execute|harm|kill|murder|poison|kidnap|make a bomb|detonate|commit suicide|self[- ]harm)\b/i,
  /\b(?:find|obtain|download)\b(?![^.!?]{0,32}\b(?:report|prevent|help|support|resource|hotline|legal|defen[cs]e|detect)\b)/i,
  /\b(?:steps?|tutorial|operational method|specific method|action plan|code|script)\s*(?:are|is|follow|below|:)\b/i,
  /\b(?:i|we)\s+(?:want|plan|intend|am going|are going|have decided|am about|are about|already started)\s+to\s+(?:commit suicide|self[- ]harm|kill|murder|harm|poison|kidnap|commit arson|detonate|carry out|execute|generate|create|obtain)\b/i,
];

const REMOTE_SELF_HARM_INTENT_OVERRIDE = [
  /(?:我|本人).{0,18}(?:想|要|准备|打算|决定|计划|正在|马上|将要|已经).{0,48}(?:今晚|现在|马上|立刻|执行|去做|结束一切|不可逆|不想活)/i,
  /\bi\s+(?:want|plan|intend|am going|have decided|am about|already started).{0,52}\b(?:tonight|now|immediately|do it|go through with it|end everything|irreversible)\b/i,
];

function remoteProtectiveContext(text, activeCategories) {
  const normalized = String(text || "")
    .normalize("NFKC")
    .replace(/\p{Cf}/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (!normalized) return false;
  const protective = [...REMOTE_PROTECTIVE_PURPOSE, ...REMOTE_REFUSAL_CONTEXT].some((pattern) => pattern.test(normalized));
  if (!protective) return false;
  if (REMOTE_HARMFUL_CONTEXT_OVERRIDE.some((pattern) => pattern.test(normalized))) return false;
  if (
    activeCategories.some((name) => name === "self-harm/intent" || name === "self-harm/instructions") &&
    REMOTE_SELF_HARM_INTENT_OVERRIDE.some((pattern) => pattern.test(normalized))
  ) {
    return false;
  }
  return true;
}

function remoteResult(result, { direction, text, imagePresent }) {
  const flagged = result?.flagged === true;
  const categories = result?.categories && typeof result.categories === "object" ? result.categories : {};
  const scores = result?.category_scores && typeof result.category_scores === "object" ? result.category_scores : {};
  const active = Object.entries(categories).filter(([, value]) => value === true).map(([name]) => name);
  if (!flagged && active.length === 0) {
    return {
      action: "allow",
      severity: "none",
      categories: [],
      userMessage: "远程安全复核未发现额外风险。",
    };
  }

  const mapped = new Set();
  for (const name of active) {
    if (name.startsWith("self-harm")) mapped.add("self_harm");
    else if (name === "sexual/minors") mapped.add("sexual_minors");
    else if (name.startsWith("illicit") || name.startsWith("violence")) mapped.add("violent_wrongdoing");
    else mapped.add("sensitive_content");
  }

  const score = name => Number.isFinite(Number(scores[name])) ? Number(scores[name]) : 0;
  const protectedContext = !imagePresent && remoteProtectiveContext(text, active);
  if (!protectedContext && active.includes("sexual/minors") && score("sexual/minors") >= 0.8) {
    return {
      action: "block",
      severity: "critical",
      categories: [...mapped],
      userMessage: "远程安全复核检测到涉及未成年人的高风险性内容，已停止处理。",
      safeText: "我不能协助涉及未成年人的性内容，但可以帮助查找举报渠道、制定儿童安全措施或提供受害者支持信息。",
    };
  }
  const selfHarmHigh = active.some(name => ["self-harm/intent", "self-harm/instructions"].includes(name) && score(name) >= 0.8);
  if (!protectedContext && selfHarmHigh) {
    return {
      action: direction === "input" ? "support" : "block",
      severity: "critical",
      categories: [...mapped],
      userMessage: direction === "input" ? "远程安全复核检测到可能的紧急自伤风险；请先保证现实安全。" : "远程安全复核停止了可能鼓励自伤的输出。",
      safeText: "你不必独自承受这些。如果危险迫在眉睫，请立即联系当地紧急服务或可信任的人，先移动到有人陪伴的安全地点，并远离可能伤害自己的物品。",
    };
  }
  const illicitViolentHigh = active.some(name => ["illicit/violent", "violence"].includes(name) && score(name) >= 0.9);
  if (!protectedContext && illicitViolentHigh) {
    return {
      action: "block",
      severity: "high",
      categories: [...mapped],
      userMessage: "远程安全复核检测到高置信度的现实暴力或严重违法实施内容，已停止处理。",
      safeText: "我不能帮助策划现实伤害或严重违法行为，但可以协助降级冲突、脱离危险或提供防护建议。",
    };
  }

  // Lower-confidence and context-sensitive flags remain warnings. This avoids
  // mechanically blocking refusals, prevention material, and quoted reporting.
  return {
    action: "warn",
    severity: "medium",
    categories: [...mapped],
    userMessage: "OpenAI 安全复核检测到敏感内容；系统会保留安全边界继续处理。",
  };
}

export function createSafetyService({
  remoteEnabled = false,
  apiKey = "",
  fetchImpl = globalThis.fetch,
  timeoutMs = 15_000,
} = {}) {
  const enabled = remoteEnabled === true;
  const ready = enabled && Boolean(apiKey);

  async function inspect({ text, direction = "input", allowRemote = false, imageDataUrl = "", context = "chat" } = {}) {
    const local = classifySafety(text, { direction });
    const remoteAllowed = allowRemote === true && context !== "game";
    if (!enabled || !remoteAllowed || local.action === "support" || local.action === "block") {
      return publicShape(local, { source: "local", remoteUsed: false });
    }
    if (!apiKey) {
      throw new SafetyServiceError("远程安全检查已启用，但尚未配置 OPENAI_API_KEY");
    }

    const moderationText = String(local.safeText || text || "").slice(0, 32_000);
    const input = [{ type: "text", text: moderationText || "[empty]" }];
    if (imageDataUrl) input.push({ type: "image_url", image_url: { url: imageDataUrl } });

    let response;
    try {
      response = await fetchImpl("https://api.openai.com/v1/moderations", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({ model: REMOTE_MODEL, input }),
      });
    } catch {
      throw new SafetyServiceError("远程安全检查暂时不可用；为避免未经检查地继续，本次请求已停止");
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new SafetyServiceError("远程安全检查返回了无法识别的结果");
    }
    if (!response.ok || !Array.isArray(payload.results) || !payload.results[0]) {
      throw new SafetyServiceError(`远程安全检查失败（${response.status || "unknown"}）`);
    }

    const combined = mergeResults(local, remoteResult(payload.results[0], { direction, text, imagePresent: Boolean(imageDataUrl) }));
    return publicShape(combined, { source: "local+openai", remoteUsed: true });
  }

  function status() {
    return {
      version: "local-safety-v1",
      mode: enabled ? "local+openai" : "local",
      remoteEnabled: enabled,
      remoteReady: ready,
      storesOriginal: false,
      inputAndOutput: true,
      localTextOnly: true,
      remoteImageInput: enabled,
      gameRemoteAllowed: false,
      remoteModel: enabled ? REMOTE_MODEL : null,
    };
  }

  return { inspect, status };
}
