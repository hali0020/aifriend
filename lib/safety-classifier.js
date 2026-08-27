/**
 * Local, deterministic safety classification for user input and model output.
 *
 * Privacy invariant: this module has no logging, telemetry, network access, or
 * persistence. Text exists only for the duration of a classification call.
 */

const ACTION_RANK = Object.freeze({ allow: 0, warn: 1, block: 2, support: 3 });
const SEVERITY_RANK = Object.freeze({ none: 0, low: 1, medium: 2, high: 3, critical: 4 });
const MAX_TEXT_CHARS = 1_000_000;

export const SAFETY_CATEGORIES = Object.freeze([
  "self_harm",
  "sexual_minors",
  "credential_or_private_data",
  "malware_high_risk",
  "violent_wrongdoing",
]);

const CATEGORY_RANK = new Map(SAFETY_CATEGORIES.map((category, index) => [category, index]));

const USER_MESSAGES = Object.freeze({
  allow: "未检测到需要拦截的高风险内容。",
  oversized: "内容过长，无法在本地安全检查的长度上限内完成处理。请缩短后重试。",
  self_harm:
    "我很在意你的安全。如果你可能马上伤害自己，请立即联系当地紧急服务或身边可信任的人，并远离可用于伤害自己的物品。",
  sexual_minors:
    "无法协助涉及未成年人的性内容；可以改为举报、预防或受害者支持等安全方向。",
  credential_or_private_data_warn:
    "内容可能包含凭据或私人信息。请先移除或遮盖敏感字段后再继续。",
  credential_or_private_data_block:
    "无法协助窃取、公开或泄露凭据与私人信息；可以帮助进行脱敏、账户恢复或安全加固。",
  malware_high_risk:
    "无法协助制作、部署或隐蔽高风险恶意软件；可以提供检测、隔离、取证和防御建议。",
  violent_wrongdoing:
    "无法协助策划或实施对他人的暴力伤害；可以帮助降级冲突、脱离危险或寻找安全支持。",
});

const SAFE_TEXT = Object.freeze({
  self_harm:
    "你不必独自承受这些。如果危险迫在眉睫，请立即联系当地紧急服务或可信任的人，先移动到有人陪伴的安全地点，并远离可能伤害自己的物品。",
  sexual_minors:
    "我不能协助涉及未成年人的性内容，但可以帮助查找举报渠道、制定儿童安全措施或提供受害者支持信息。",
  credential_or_private_data:
    "请删除或遮盖密码、令牌、私钥、身份证件、联系方式和住址等敏感信息后再继续。",
  malware_high_risk:
    "我不能帮助制作或部署恶意软件，但可以协助分析风险、编写检测规则、隔离样本或修复受影响系统。",
  violent_wrongdoing:
    "我不能帮助策划伤害他人。如果存在现实冲突，请先拉开距离、避免接触武器，并联系可信任的人或当地紧急服务。",
  oversized: "请将内容拆分为较短的段落后再继续。",
});

const REFUSAL_PATTERNS = [
  /(?:无法|不能|不会|拒绝)(?:帮助|协助|提供|生成|编写|制作)/i,
  /\b(?:i\s+)?(?:can(?:not|'t)|won't|will not)\s+(?:help|assist|provide|create|write|build)\b/i,
];

const REFUSAL_REVERSAL_PATTERNS = [
  /(?:但|但是|不过|然而).{0,24}(?:下面|以下|这里|代码|步骤|方法)/i,
  /\b(?:but|however|nevertheless)\b.{0,40}\b(?:here(?:'s| is| are)|code|steps?|method)\b/i,
  /(?:无法|不能|不会|拒绝)(?:帮助|协助|提供|生成|编写|制作).{0,100}(?:以下|下面|这里)(?:是|有)|(?:代码|脚本|步骤|方法)(?:如下|是)/i,
  /\b(?:can(?:not|'t)|won't|will not)\s+(?:help|assist|provide|create|write|build).{0,120}\b(?:here(?:'s| is| are)|code|script|steps?|method)\b/i,
];

const GENERAL_REQUEST_PATTERNS = [
  /(?:怎么|如何|给我|帮我|教我|替我|请你|步骤|教程|方案|计划|代码|脚本|生成|制作|开发|编写|部署|绕过|隐藏|获取|窃取|泄露|公开|人肉|开盒)/i,
  /\b(?:how\s+(?:do|can|to)|give me|help me|teach me|step[- ]by[- ]step|tutorial|plan|code|script|create|build|write|generate|develop|deploy|bypass|hide|steal|leak|dox)\b/i,
];

function hasAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function normalizeText(value) {
  if (value === undefined || value === null) return "";
  const normalized = String(value)
    .normalize("NFKC")
    .replace(/\p{Cf}/gu, "")
    .replace(/(?<=[\u3400-\u9FFF])[-_·•.](?=[\u3400-\u9FFF])/g, "")
    .replace(/\s+/gu, " ")
    .trim();
  return normalized;
}

function isPureRefusal(text) {
  return hasAny(text, REFUSAL_PATTERNS) && !hasAny(text, REFUSAL_REVERSAL_PATTERNS);
}

function makeSignal(category, action, severity, userMessage, safeText) {
  return { category, action, severity, userMessage, ...(safeText ? { safeText } : {}) };
}

// ---------------------------------------------------------------------------
// Self-harm: current intent and crisis language receive a supportive response.
// Merely discussing prevention, reporting, or a resolved past event is allowed.
// ---------------------------------------------------------------------------

const SELF_HARM_TERMS = [
  /(?:自杀|轻生|结束(?:自己(?:的)?)?生命|伤害自己|自残|割腕|跳楼|服毒|不想活(?:了|下去)?|活不下去|撑不下去)/i,
  /\b(?:suicid(?:e|al)|kill myself|end my life|hurt myself|self[- ]harm)\b/i,
];

const SELF_HARM_CRISIS = [
  /(?:我|本人).{0,12}(?:想|要|准备|打算|决定|计划|可能|快要|马上|忍不住).{0,10}(?:死|自杀|轻生|结束(?:自己)?生命|伤害自己|割腕|跳楼)/i,
  /(?:我|本人).{0,8}(?:不想活(?:了|下去)?|活不下去|撑不下去|没有活着的意义|今晚就结束|已经写好遗书)/i,
  /(?:我|本人).{0,12}(?:已经|正在).{0,10}(?:割腕|服毒|吞(?:了)?药|站在楼顶|拿着刀伤害自己)/i,
  /(?:朋友|同学|孩子|家人|伴侣|他|她).{0,12}(?:想|要|准备|打算|已经).{0,8}(?:自杀|轻生|伤害自己|割腕|跳楼)/i,
  /\b(?:i\s+(?:want|plan|intend|am going|have decided|might|may)\s+to\s+(?:die|commit suicide|kill myself|end my life|hurt myself)|i\s+(?:am|'m)\s+about\s+to\s+jump\s+off\s+(?:a|the)\s+(?:bridge|building|roof)|i\s+don't\s+want\s+to\s+live|i\s+can't\s+go\s+on)\b/i,
  /\b(?:my\s+(?:friend|child|partner|sibling)\s+(?:wants|plans|is going)\s+to\s+(?:die|kill (?:himself|herself|themself)|self[- ]harm))\b/i,
  /(?:^|[。！？!?，,])\s*(?:真的|确实)?(?:想|要|准备|打算|决定|计划|快要|马上)(?:去)?(?:死|自杀|轻生|割腕|跳楼)(?!的人)/i,
  /(?:^|[。！？!?，,])\s*(?:真的|确实)?(?:不想活(?:了|下去)?|活不下去|撑不下去)/i,
  /^(?:please\s+)?(?:help me\s+)?(?:commit suicide|kill myself|end my life)\b/i,
  /(?:我|本人).{0,14}(?:要|准备|打算|刚|已经).{0,12}(?:吞|吃|服).{0,8}(?:一整瓶|一瓶|大量).{0,8}(?:安眠药|药片|药)/i,
  /(?:我|本人).{0,12}(?:站在|到了).{0,8}(?:楼顶|天台|桥边).{0,14}(?:准备|想|要).{0,8}(?:跳下去|跳楼|跳桥)/i,
  /(?:朋友|同学|孩子|家人|伴侣|他|她).{0,14}(?:刚|已经|正在).{0,12}(?:吞|吃|服).{0,8}(?:一整瓶|一瓶|大量).{0,8}(?:安眠药|药片|药)/i,
  /\bi\s+(?:just|have|had)\s+(?:swallowed|taken).{0,18}\b(?:a whole bottle|an entire bottle|a large dose).{0,12}\b(?:pills?|medicine|sleeping pills?)\b/i,
  /\bi\s+(?:am|'m)\s+(?:going|planning|about)\s+to\s+jump\s+off\s+(?:a|the)\s+(?:bridge|building|roof)\b/i,
  /\bmy\s+(?:friend|child|partner|sibling)\s+(?:just|has)\s+(?:swallowed|taken).{0,18}\b(?:a whole bottle|an entire bottle|a large dose).{0,12}\b(?:pills?|medicine)\b/i,
];

const SELF_HARM_METHOD = [
  /(?:怎么|如何|什么方法|哪种方式|最不痛苦|最快|成功率高).{0,16}(?:自杀|轻生|死掉|结束(?:自己)?生命)/i,
  /(?:自杀|轻生).{0,14}(?:方法|步骤|剂量|成功率|不痛苦)/i,
  /\b(?:best|quickest|painless|effective|reliable)\s+(?:way|method).{0,20}(?:suicide|die|kill myself|end my life)\b/i,
  /\bhow\s+to\s+(?:commit suicide|kill myself|end my life)\b/i,
];

const SELF_HARM_NEGATED_OR_RESOLVED = [
  /(?:我|本人).{0,8}(?:不想|不会|不打算|没有(?:想|要|打算)|并不想|绝不会).{0,8}(?:死|自杀|轻生|伤害自己)/i,
  /(?:我|本人).{0,18}(?:以前|曾经|过去).{0,10}(?:想过|试过|有过).{0,8}(?:自杀|轻生|伤害自己).{0,24}(?:现在|如今).{0,8}(?:安全|没事|不再|不会|不想)/i,
  /\bi\s+(?:do not|don't|would never|will not|have no (?:plan|intention) to)\s+(?:die|kill myself|self[- ]harm|hurt myself)\b/i,
  /\bi\s+(?:used to|previously)\s+.{0,20}(?:suicid|self[- ]harm).{0,30}\b(?:safe now|no longer|not anymore)\b/i,
];

const SELF_HARM_SAFE_CONTEXT = [
  /(?:预防|阻止|避免|劝阻|干预|求助|支持|陪伴|举报|研究|科普|新闻|报道|小说|剧本|虚构|危机热线|紧急服务|心理援助).{0,24}(?:自杀|轻生|自残|伤害自己)/i,
  /(?:自杀|轻生|自残|伤害自己).{0,24}(?:预防|阻止|避免|劝阻|干预|求助|支持|陪伴|举报|研究|科普|新闻|报道|小说|剧本|虚构|危机热线|紧急服务|心理援助)/i,
  /\b(?:prevent|prevention|intervene|intervention|support|help|report|research|study|news|awareness|fiction|novel|screenplay).{0,30}(?:suicide|self[- ]harm)\b/i,
  /\b(?:suicide|self[- ]harm).{0,30}(?:prevent|prevention|intervene|intervention|support|help|report|research|study|awareness|fiction|novel|screenplay)\b/i,
];

const SELF_HARM_LINGUISTIC_CONTEXT = [
  /(?:分析|翻译|引用|句子|语法).{0,45}(?:自杀|轻生|自残|kill myself|commit suicide|end my life)/i,
  /\b(?:analyze|translate|quote|sentence|grammar).{0,50}\b(?:suicide|kill myself|end my life|self[- ]harm)\b/i,
];

const SELF_HARM_BENIGN_FIRST_PERSON_REQUEST = [
  /(?:我|本人).{0,6}(?:想|要)(?:写|研究|了解|讨论|咨询|分析|报道|做).{0,28}(?:自杀|轻生|自残|伤害自己)/i,
  /\bi\s+(?:want|need|plan)\s+to\s+(?:write|study|research|understand|discuss|analyze|report).{0,30}\b(?:suicide|self[- ]harm)\b/i,
];

const SELF_HARM_SUPPORTIVE_OUTPUT = [
  /(?:联系|拨打).{0,24}(?:紧急服务|急救|报警|危机热线|心理援助|可信任的人)/i,
  /(?:远离|放下).{0,16}(?:刀|药物|武器|危险物品)/i,
  /\b(?:contact|call|reach).{0,30}(?:emergency services|crisis line|trusted person|someone you trust)\b/i,
  /\byou (?:do not|don't) have to (?:face|go through) this alone\b/i,
];

const SELF_HARM_CONTRADICTORY_CRISIS = [
  /(?:但|但是|不过|然而|可是|说真的|其实|不[，,]).{0,24}(?:我|本人).{0,10}(?:想|要|准备|打算|决定|计划|快要|马上).{0,10}(?:死|自杀|轻生|结束(?:自己(?:的)?)?生命|伤害自己|割腕|跳楼)/i,
  /\b(?:but|however|actually|no[,，]?).{0,35}\bi\s+(?:want|plan|intend|am going|have decided)\s+to\s+(?:die|commit suicide|kill myself|end my life|hurt myself)\b/i,
];

const SELF_HARM_DANGEROUS_OUTPUT = [
  /(?:你应该|你可以|建议你|不如|干脆|赶紧|现在就).{0,16}(?:自杀|轻生|结束(?:自己(?:的)?)?生命|割腕|跳楼|服毒)/i,
  /\byou\s+(?:should|could|need to|ought to)\s+(?:commit suicide|kill yourself|end your life|jump off|hurt yourself)\b/i,
  /(?:吞下|吃下|服下).{0,10}(?:一整瓶|一瓶|大量).{0,8}(?:安眠药|药片|药).{0,18}(?:结束|死|解脱)/i,
  /\b(?:swallow|take).{0,16}\b(?:a whole bottle|an entire bottle|a large dose).{0,12}\b(?:pills?|medicine).{0,25}\b(?:die|end it|end everything)\b/i,
  /\bgo\s+kill yourself\b/i,
];

function evaluateSelfHarm(text, direction) {
  const crisis = hasAny(text, SELF_HARM_CRISIS);
  const method = hasAny(text, SELF_HARM_METHOD);
  const dangerousOutput = direction === "output" && hasAny(text, SELF_HARM_DANGEROUS_OUTPUT);
  const contradictoryCrisis = hasAny(text, SELF_HARM_CONTRADICTORY_CRISIS);
  if (!hasAny(text, SELF_HARM_TERMS) && !crisis && !method && !dangerousOutput) return null;
  if (hasAny(text, SELF_HARM_NEGATED_OR_RESOLVED) && !contradictoryCrisis && !dangerousOutput) return null;
  if (
    direction === "output" &&
    hasAny(text, SELF_HARM_SUPPORTIVE_OUTPUT) &&
    !hasAny(text, SELF_HARM_METHOD) &&
    !dangerousOutput
  ) {
    return null;
  }

  const safeContext = hasAny(text, SELF_HARM_SAFE_CONTEXT);
  if (hasAny(text, SELF_HARM_LINGUISTIC_CONTEXT) && !contradictoryCrisis && !dangerousOutput) return null;
  if (
    safeContext &&
    hasAny(text, SELF_HARM_BENIGN_FIRST_PERSON_REQUEST) &&
    !method &&
    !contradictoryCrisis &&
    !dangerousOutput
  ) {
    return null;
  }
  if (!crisis && !method && !dangerousOutput) {
    if (safeContext || isPureRefusal(text)) return null;
    return null;
  }

  return makeSignal(
    "self_harm",
    "support",
    "critical",
    USER_MESSAGES.self_harm,
    SAFE_TEXT.self_harm,
  );
}

// ---------------------------------------------------------------------------
// Sexual content involving minors: block requests or delivered content, while
// allowing prevention, reporting, legal analysis, and non-operational research.
// ---------------------------------------------------------------------------

const MINOR_TERMS = [
  /(?:未成年(?:人|者)?|儿童|幼童|小孩|幼女|幼男|未满\s*18\s*岁|(?:[0-9]|1[0-7]|[一二三四五六七八九十]{1,3})\s*岁(?:的)?(?:女孩|男孩|孩子|少年|少女)?|幼儿园(?:学生|儿童)?|小学生|初中生|中学生|高中生|学龄前儿童)/i,
  /\b(?:child|children|minor|underage|preteen|under\s*18|schoolgirl|schoolboy|(?:middle|high)[- ]school student|(?:[1-9]|1[0-7])[- ]year[- ]old)\b/i,
];

const SEXUAL_TERMS = [
  /(?:色情|裸照|裸体|性行为|性交|性爱|性侵|强奸|猥亵|性内容|露骨|情色|成人视频)/i,
  /\b(?:porn(?:ography|ographic)?|nudes?|naked|sex(?:ual)?|rape|molest|explicit|erotic)\b/i,
];

const MINOR_SEXUAL_HARMFUL_ACTION = [
  /(?:给我|提供|发送|生成|画|绘制|写|制作|创建|下载|寻找|购买|交换|收藏|观看|描述|诱骗|约见).{0,36}(?:未成年|儿童|幼童|小孩|幼女|幼男|小学生)/i,
  /(?:未成年|儿童|幼童|小孩|幼女|幼男|小学生).{0,36}(?:裸照|色情|性行为|性交|性爱|露骨|情色|成人视频).{0,20}(?:给我|提供|发送|生成|画|写|制作|下载|寻找|购买|交换|收藏|观看|描述)/i,
  /\b(?:give|send|show|generate|draw|write|create|make|find|download|buy|trade|collect|watch|describe).{0,40}\b(?:child|minor|underage|preteen).{0,30}\b(?:porn|nude|naked|sexual|explicit|erotic)\b/i,
  /\b(?:child|minor|underage|preteen).{0,30}\b(?:porn|nude|naked|sexual|explicit|erotic).{0,30}\b(?:content|image|story|video|material)\b/i,
];

const MINOR_SAFE_CONTEXT = [
  /(?:举报|预防|阻止|保护|救助|受害者支持|法律|违法|犯罪|判例|新闻|报道|研究|识别|检测|删除).{0,36}(?:儿童|未成年|幼童|小孩).{0,24}(?:色情|性侵|强奸|猥亵|裸照|性内容)/i,
  /(?:儿童|未成年|幼童|小孩).{0,24}(?:色情|性侵|强奸|猥亵|裸照|性内容).{0,36}(?:举报|预防|阻止|保护|救助|受害者支持|法律|违法|犯罪|新闻|报道|研究|识别|检测|删除)/i,
  /\b(?:report|prevent|protect|victim support|law|illegal|crime|news|research|detect|remove).{0,45}\b(?:child|minor|underage).{0,30}\b(?:porn|sexual abuse|exploitation|nude|explicit)\b/i,
  /\b(?:child|minor|underage).{0,30}\b(?:porn|sexual abuse|exploitation|nude|explicit).{0,45}\b(?:report|prevent|protect|victim support|law|illegal|crime|research|detect|remove)\b/i,
];

const MINOR_EXCLUDED_CONTEXT = [
  /(?:不涉及|不包含|没有|不要|排除|拒绝使用).{0,12}(?:未成年|儿童|幼童|小孩)/i,
  /(?:所有|全部|每个).{0,12}(?:角色|人物)?(?:都|均|必须)?(?:是|为)?\s*(?:成年人|成人|18\s*岁以上)/i,
  /\b(?:no|without|exclude|excluding).{0,12}\b(?:minor|underage|child|children)\b/i,
  /\b(?:all|every)\s+(?:characters?|people|participants?)\s+(?:are|must be)\s+(?:adults?|over\s*18)\b/i,
];

const MINOR_EXPLICIT_CONTENT_ACTION = [
  /(?:给我|提供|发送|生成|画|绘制|写|制作|创建|下载|寻找|购买|交换|收藏|观看|描述).{0,36}(?:未成年|儿童|幼童|小孩|幼女|幼男|(?:[0-9]|1[0-7])\s*岁|小学生).{0,30}(?:裸照|裸体|色情(?:图片|视频|故事|内容)?|性内容|性交|性爱|性行为描写|露骨|情色|成人视频)/i,
  /(?:未成年|儿童|幼童|小孩|幼女|幼男|(?:[0-9]|1[0-7])\s*岁|小学生).{0,30}(?:裸照|裸体|色情(?:图片|视频|故事|内容)?|性内容|性交|性爱|性行为描写|露骨|情色|成人视频).{0,24}(?:给我|提供|发送|生成|画|绘制|写|制作|创建|下载|寻找|购买|交换|收藏|观看|描述)/i,
  /\b(?:give|send|show|generate|draw|write|create|make|find|download|buy|trade|collect|watch|describe).{0,40}\b(?:child|minor|underage|preteen|(?:[1-9]|1[0-7])[- ]year[- ]old).{0,30}\b(?:porn|nude|naked|sex scene|explicit|erotic)\b/i,
  /\b(?:give|send|show|generate|draw|write|create|make|find|download|buy|trade|collect|watch|describe).{0,45}\b(?:porn|nude|naked|sexual|sex scene|explicit|erotic).{0,45}\b(?:child|minor|underage|preteen|schoolgirl|schoolboy|(?:middle|high)[- ]school student|(?:[1-9]|1[0-7])[- ]year[- ]old)\b/i,
];

const MINOR_GENERAL_SAFE_PURPOSE = [
  /(?:举报|预防|阻止|保护|救助|受害者支持|法律|违法|犯罪|新闻|报道|研究|识别|检测|删除)/i,
  /\b(?:report|prevent|protect|victim support|law|illegal|crime|news|research|detect|remove)\b/i,
];

const MINOR_OUTPUT_SAFE_PURPOSE = [
  /(?:举报|预防|阻止|保护|救助|受害者支持|法律|违法|犯罪|识别|检测|删除|禁止|不得|不要)/i,
  /\b(?:report|prevent|protect|victim support|law|illegal|crime|detect|remove|prohibit|must not|do not|don't)\b/i,
];

function evaluateSexualMinors(text, direction) {
  if (!hasAny(text, MINOR_TERMS) || !hasAny(text, SEXUAL_TERMS)) return null;
  if (isPureRefusal(text)) return null;

  const harmfulAction = hasAny(text, MINOR_SEXUAL_HARMFUL_ACTION);
  const safeContext = hasAny(text, MINOR_SAFE_CONTEXT) || hasAny(text, MINOR_GENERAL_SAFE_PURPOSE);
  const explicitContentAction = hasAny(text, MINOR_EXPLICIT_CONTENT_ACTION);
  const outputDelivery = direction === "output" && hasAny(text, [/(?:以下|下面|这里)(?:是|有)/i, /```/, /\bhere (?:is|are)\b/i]);

  if (hasAny(text, MINOR_EXCLUDED_CONTEXT) && !explicitContentAction && !outputDelivery) return null;
  if (direction === "output") {
    if (hasAny(text, MINOR_OUTPUT_SAFE_PURPOSE) && !explicitContentAction && !outputDelivery) return null;
    return makeSignal(
      "sexual_minors",
      "block",
      "critical",
      USER_MESSAGES.sexual_minors,
      SAFE_TEXT.sexual_minors,
    );
  }
  if (safeContext && !explicitContentAction && !outputDelivery) return null;
  if (!harmfulAction && !outputDelivery && !hasAny(text, GENERAL_REQUEST_PATTERNS)) return null;

  return makeSignal(
    "sexual_minors",
    "block",
    "critical",
    USER_MESSAGES.sexual_minors,
    SAFE_TEXT.sexual_minors,
  );
}

// ---------------------------------------------------------------------------
// Credentials and private data: redact concrete material. Merely discussing
// defensive password hygiene is allowed; theft/doxxing intent is blocked.
// ---------------------------------------------------------------------------

function isPlaceholderSecret(value) {
  const candidate = value.replace(/["']/g, "").toLowerCase();
  if (/^(?:replace[_-]?me|xxx+|<[^>]+>|\{[^}]+\}|\$\{[^}]+\})$/i.test(candidate)) return true;
  return /^(?:your|example|sample|test|dummy|fake)(?:[_-](?:api[_-]?key|key|token|password|secret|value|here))?$/i.test(
    candidate,
  );
}

function luhnValid(value) {
  const digits = value.replace(/[ -]/g, "");
  if (!/^\d{13,19}$/.test(digits) || /^(\d)\1+$/.test(digits)) return false;
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

// Credential labels are the only place where confusable folding is allowed.
// Keeping this as an explicit, small map avoids rewriting (or interpreting)
// ordinary Greek and Cyrillic prose elsewhere in the message.
const CREDENTIAL_LABEL_CONFUSABLES = new Map([
  ["а", "a"],
  ["α", "a"],
  ["в", "b"],
  ["β", "b"],
  ["с", "c"],
  ["ϲ", "c"],
  ["ԁ", "d"],
  ["е", "e"],
  ["ε", "e"],
  ["ϝ", "f"],
  ["һ", "h"],
  ["і", "i"],
  ["ι", "i"],
  ["ј", "j"],
  ["к", "k"],
  ["κ", "k"],
  ["ӏ", "l"],
  ["м", "m"],
  ["μ", "m"],
  ["н", "n"],
  ["η", "n"],
  ["о", "o"],
  ["ο", "o"],
  ["р", "p"],
  ["ρ", "p"],
  ["г", "r"],
  ["ѕ", "s"],
  ["т", "t"],
  ["τ", "t"],
  ["υ", "u"],
  ["ν", "v"],
  ["ԝ", "w"],
  ["х", "x"],
  ["χ", "x"],
  ["у", "y"],
  ["γ", "y"],
  ["ζ", "z"],
]);

const SENSITIVE_CREDENTIAL_LABELS = new Set([
  "password",
  "passwd",
  "pwd",
  "apikey",
  "xapikey",
  "clientsecret",
  "awssecretaccesskey",
  "accesstoken",
  "refreshtoken",
  "authtoken",
  "xaccesstoken",
  "xauthtoken",
  "token",
  "密码",
  "密碼",
  "口令",
  "密钥",
  "密鑰",
  "令牌",
  "權杖",
  "存取權杖",
  "更新權杖",
  "驗證權杖",
]);

const MAX_CREDENTIAL_LABEL_CHARS = 64;
const CREDENTIAL_LABEL_BOUNDARY = /[\p{L}\p{N}\p{M}_]/u;
const CREDENTIAL_ASSIGNMENT_DELIMITER = /[:=]/g;
const UNQUOTED_CREDENTIAL_VALUE = /^[^\s"',;，；。！？、：“”‘’]{8,}/u;

function canonicalCredentialLabel(value) {
  const compact = value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/\p{Cf}/gu, "")
    .toLowerCase()
    .replace(/[\s_-]+/gu, "");
  let folded = "";
  for (const character of compact) {
    folded += CREDENTIAL_LABEL_CONFUSABLES.get(character) ?? character;
  }
  return folded;
}

function hasSensitiveCredentialLabel(text, delimiterIndex) {
  const windowStart = Math.max(0, delimiterIndex - MAX_CREDENTIAL_LABEL_CHARS);
  const prefix = text.slice(windowStart, delimiterIndex).replace(/\s+$/u, "");

  // Try every bounded suffix. A match is accepted only when the whole suffix
  // folds to a whitelisted field name and begins at a real word boundary.
  for (let start = 0; start < prefix.length; start += 1) {
    let label = prefix.slice(start);
    const first = label[0];
    const last = label.at(-1);
    if ((first === '"' || first === "'") && last === first) {
      label = label.slice(1, -1);
    }
    if (!label || !SENSITIVE_CREDENTIAL_LABELS.has(canonicalCredentialLabel(label))) continue;

    const absoluteStart = windowStart + start;
    const previousCharacter = absoluteStart > 0 ? text[absoluteStart - 1] : "";
    if (!previousCharacter || !CREDENTIAL_LABEL_BOUNDARY.test(previousCharacter)) return true;
  }
  return false;
}

function redactCredentialAssignments(text) {
  const ranges = [];
  CREDENTIAL_ASSIGNMENT_DELIMITER.lastIndex = 0;
  let delimiterMatch;

  while ((delimiterMatch = CREDENTIAL_ASSIGNMENT_DELIMITER.exec(text)) !== null) {
    if (!hasSensitiveCredentialLabel(text, delimiterMatch.index)) continue;

    let valueStart = delimiterMatch.index + delimiterMatch[0].length;
    while (valueStart < text.length && /\s/u.test(text[valueStart])) valueStart += 1;
    if (valueStart >= text.length) continue;

    let valueEnd;
    const openingQuote = text[valueStart];
    if (openingQuote === '"' || openingQuote === "'") {
      valueStart += 1;
      const closingQuote = text.indexOf(openingQuote, valueStart);
      if (closingQuote < valueStart + 8 || closingQuote > valueStart + 256) continue;
      valueEnd = closingQuote;
    } else {
      const valueMatch = text.slice(valueStart).match(UNQUOTED_CREDENTIAL_VALUE);
      if (!valueMatch) continue;
      valueEnd = valueStart + valueMatch[0].length;
    }

    const value = text.slice(valueStart, valueEnd);
    if (isPlaceholderSecret(value)) continue;
    ranges.push({ start: valueStart, end: valueEnd });
  }

  if (ranges.length === 0) return { redacted: text, count: 0, strongCount: 0 };

  let cursor = 0;
  let redacted = "";
  for (const range of ranges) {
    if (range.start < cursor) continue;
    redacted += `${text.slice(cursor, range.start)}[已遮盖]`;
    cursor = range.end;
  }
  redacted += text.slice(cursor);
  return { redacted, count: ranges.length, strongCount: 0 };
}

const SECRET_REDACTION_RULES = [
  {
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/gi,
    redact: () => "[已遮盖的私钥]",
    strong: true,
  },
  {
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----[\s\S]{20,}/gi,
    redact: () => "[已遮盖的私钥]",
    strong: true,
  },
  {
    regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
    redact: () => "[已遮盖的 API 密钥]",
    strong: true,
  },
  {
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
    redact: () => "[已遮盖的访问密钥]",
    strong: true,
  },
  {
    regex: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
    redact: () => "[已遮盖的访问令牌]",
    strong: true,
  },
  {
    regex: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g,
    redact: () => "[已遮盖的访问令牌]",
    strong: true,
  },
  {
    regex: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/gi,
    redact: () => "Bearer [已遮盖]",
    strong: true,
  },
  {
    regex: /\bAuthorization\s*:\s*Basic\s+[A-Za-z0-9+/=]{12,}\b/gi,
    redact: () => "Authorization: Basic [已遮盖]",
    strong: true,
  },
  {
    regex: /\b(?:Cookie\s*:\s*)?(?:sessionid|session|auth|jwt)\s*=\s*[A-Za-z0-9._~+/=-]{16,}\b/gi,
    redact: () => "[已遮盖的会话凭据]",
    strong: true,
  },
  {
    regex: /\bAIza[A-Za-z0-9_-]{30,}\b/g,
    redact: () => "[已遮盖的 API 密钥]",
    strong: true,
  },
];

const PRIVATE_REDACTION_RULES = [
  {
    regex: /\b[A-Z0-9][A-Z0-9._%+-]{0,63}@[A-Z0-9.-]{1,253}\.[A-Z]{2,63}\b/gi,
    redact: (match) => (/^[^@]+@(?:example\.(?:com|org|net)|test\.invalid)$/i.test(match) ? match : "[已遮盖的邮箱]"),
  },
  {
    regex: /(?<!\d)1[3-9]\d{9}(?!\d)/g,
    redact: () => "[已遮盖的手机号]",
  },
  {
    regex: /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g,
    redact: () => "[已遮盖的身份号码]",
  },
  {
    regex: /(?<!\d)\d{17}[\dXx](?!\d)/g,
    redact: () => "[已遮盖的身份证号]",
  },
  {
    regex: /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g,
    redact: (match) => (luhnValid(match) ? "[已遮盖的支付卡号]" : match),
  },
  {
    regex: /(?:家庭住址|家庭地址|住址|地址)\s*[:：]?\s*[\u3400-\u9FFF0-9A-Za-z-]{6,80}(?:号|室|栋|单元)/g,
    redact: () => "[已遮盖的住址]",
  },
];

function applyRedactionRules(text, rules) {
  let count = 0;
  let strongCount = 0;
  let redacted = text;

  for (const rule of rules) {
    redacted = redacted.replace(rule.regex, (...args) => {
      const original = args[0];
      const replacement = rule.redact(...args);
      if (replacement === original) return original;
      count += 1;
      if (rule.strong) strongCount += 1;
      return replacement;
    });
  }

  return { redacted, count, strongCount };
}

const PRIVATE_THEFT_OR_DISCLOSURE = [
  /(?:偷|窃取|盗取|套取|导出|破解|截获|泄露|公开|曝光|出售).{0,24}(?:密码|口令|令牌|token|cookie|API\s*key|密钥|私钥|身份证|手机号|住址|私人信息|聊天记录)/i,
  /(?:人肉|开盒|查出).{0,24}(?:住址|地址|手机号|身份证|私人信息|家人信息)/i,
  /\b(?:steal|harvest|phish|exfiltrate|crack|leak|expose|publish|sell|dox).{0,30}\b(?:password|credential|token|cookie|api key|private key|address|phone|ssn|private (?:data|information))\b/i,
];

const PRIVATE_PROTECTIVE_CONTEXT = [
  /(?:防止|预防|阻止|避免|检测|识别|保护|遮盖|脱敏|轮换|撤销|重置|不要|切勿|拒绝).{0,32}(?:密码|凭据|令牌|token|cookie|API\s*key|密钥|私钥|私人信息|个人信息|泄露|窃取)/i,
  /\b(?:prevent|avoid|detect|protect|redact|rotate|revoke|reset|never|do not|don't).{0,35}\b(?:password|credential|token|cookie|api key|private key|private (?:data|information)|leak|theft)\b/i,
];

const PRIVATE_DISCLOSURE_OVERRIDE = [
  /(?:不[，,]|但|但是|不过|然而).{0,24}(?:请|帮我|给我)?(?:公开|泄露|曝光|出售|开盒|人肉)/i,
  /\b(?:but|however|actually|no[,，]?).{0,35}\b(?:please\s+)?(?:leak|expose|publish|sell|dox)\b/i,
];

function evaluateCredentialsAndPrivacy(text, direction, originalText = text) {
  // Risk intent uses the normalized classifier text, while returned redaction
  // is produced from the original text so unrelated prose and punctuation are
  // never rewritten as a side effect of confusable-label detection.
  const strongSecretResult = applyRedactionRules(originalText, SECRET_REDACTION_RULES);
  const assignedSecretResult = redactCredentialAssignments(strongSecretResult.redacted);
  const privateResult = applyRedactionRules(assignedSecretResult.redacted, PRIVATE_REDACTION_RULES);
  const disclosureIntent = hasAny(text, PRIVATE_THEFT_OR_DISCLOSURE);
  const protectiveContext = hasAny(text, PRIVATE_PROTECTIVE_CONTEXT) || isPureRefusal(text);
  const disclosureOverride = hasAny(text, PRIVATE_DISCLOSURE_OVERRIDE);

  if (disclosureIntent && (!protectiveContext || disclosureOverride)) {
    return makeSignal(
      "credential_or_private_data",
      "block",
      "high",
      USER_MESSAGES.credential_or_private_data_block,
      SAFE_TEXT.credential_or_private_data,
    );
  }

  const secretCount = strongSecretResult.count + assignedSecretResult.count;
  const totalCount = secretCount + privateResult.count;
  if (totalCount === 0) return null;

  const shouldBlock = direction === "output" && totalCount > 0;
  return makeSignal(
    "credential_or_private_data",
    shouldBlock ? "block" : "warn",
    shouldBlock || secretCount > 0 ? "high" : "medium",
    shouldBlock
      ? USER_MESSAGES.credential_or_private_data_block
      : USER_MESSAGES.credential_or_private_data_warn,
    privateResult.redacted,
  );
}

// ---------------------------------------------------------------------------
// High-risk malware: require both a dangerous capability/family and creation,
// deployment, evasion, or delivered operational material.
// ---------------------------------------------------------------------------

const MALWARE_TERMS = [
  /(?:勒索软件|勒索病毒|键盘记录器|信息窃取器|密码窃取器|木马|后门|僵尸网络|恶意软件|恶意载荷|远控木马|蠕虫病毒|免杀马)/i,
  /\b(?:ransomware|keylogger|credential stealer|info(?:rmation)? stealer|malware|trojan|backdoor|botnet|rootkit|remote access trojan|RAT payload)\b/i,
];

const MALWARE_HARMFUL_CAPABILITY = [
  /(?:绕过|规避|关闭|禁用|逃避).{0,18}(?:杀毒|杀软|EDR|AV|防火墙|检测|沙箱)/i,
  /(?:免杀|持久化|横向移动|窃取密码|窃取凭据|窃取\s*cookie|导出\s*cookie|加密文件.{0,10}赎金|传播感染|命令与控制|C2\s*服务器)/i,
  /\b(?:bypass|evade|disable).{0,20}\b(?:antivirus|anti-virus|AV|EDR|firewall|detection|sandbox)\b/i,
  /\b(?:credential theft|steal (?:passwords?|cookies?|tokens?)|exfiltrate (?:passwords?|cookies?|tokens?)|encrypt files?.{0,20}ransom|persistence|lateral movement|command and control|C2 server)\b/i,
  /(?:读取|导出|解密).{0,28}(?:密码|凭据|账号|Chrome\s+Login\s+Data).{0,36}(?:上传|发送|回传|外传|我的服务器)/i,
  /\b(?:read|dump|export|decrypt).{0,30}\b(?:passwords?|credentials?|accounts?|Chrome Login Data).{0,40}\b(?:upload|send|exfiltrate|remote server|my server)\b/i,
];

const MALWARE_OPERATION = [
  /(?:写|编写|生成|制作|创建|开发|部署|投放|传播|感染|植入|隐藏|混淆|打包).{0,36}(?:勒索软件|键盘记录器|信息窃取器|木马|后门|僵尸网络|恶意软件|恶意载荷|远控木马|免杀马)/i,
  /(?:勒索软件|键盘记录器|信息窃取器|木马|后门|僵尸网络|恶意软件|恶意载荷|远控木马|免杀马).{0,36}(?:代码|脚本|源码|步骤|部署|隐藏|混淆|免杀|持久化)/i,
  /\b(?:write|create|build|develop|generate|deploy|spread|infect|implant|hide|obfuscate|pack).{0,35}\b(?:ransomware|keylogger|stealer|malware|trojan|backdoor|botnet|rootkit|RAT payload)\b/i,
  /\b(?:ransomware|keylogger|stealer|malware|trojan|backdoor|botnet|rootkit|RAT payload).{0,35}\b(?:code|script|source|steps?|deploy|spread|hide|obfuscate|persistence)\b/i,
];

const MALWARE_DEFENSIVE_CONTEXT = [
  /(?:检测|识别|分析|逆向|隔离|删除|查杀|防御|缓解|修复|取证|预防|研究|科普|新闻|报告).{0,32}(?:勒索软件|键盘记录器|信息窃取器|木马|后门|僵尸网络|恶意软件|远控木马)/i,
  /(?:勒索软件|键盘记录器|信息窃取器|木马|后门|僵尸网络|恶意软件|远控木马).{0,32}(?:检测|识别|分析|逆向|隔离|删除|查杀|防御|缓解|修复|取证|预防|研究|科普|新闻|报告)/i,
  /\b(?:detect|detection|analyze|analysis|reverse engineer|isolate|remove|defend|mitigate|remediate|forensics|prevent|research|news|report).{0,40}\b(?:ransomware|keylogger|stealer|malware|trojan|backdoor|botnet|rootkit)\b/i,
  /\b(?:ransomware|keylogger|stealer|malware|trojan|backdoor|botnet|rootkit).{0,40}\b(?:detect|detection|detector|scanner|analyze|analysis|reverse engineer|isolate|remove|defend|mitigate|remediate|forensics|prevent|research|report)\b/i,
];

const MALWARE_DEFENSIVE_BUILD = [
  /(?:写|编写|生成|制作|创建|开发).{0,36}(?:检测规则|检测器|扫描器|查杀工具|隔离工具|分析沙箱|蜜罐|YARA\s*规则).{0,36}(?:勒索软件|键盘记录器|信息窃取器|木马|后门|僵尸网络|恶意软件|远控木马)/i,
  /(?:写|编写|生成|制作|创建|开发).{0,36}(?:勒索软件|键盘记录器|信息窃取器|木马|后门|僵尸网络|恶意软件|远控木马).{0,36}(?:检测规则|检测器|扫描器|查杀工具|隔离工具|分析沙箱|蜜罐|YARA\s*规则)/i,
  /\b(?:write|build|create|generate|develop).{0,45}\b(?:detector|scanner|detection rule|YARA rule|signature|analysis sandbox|removal tool|honeypot).{0,45}\b(?:ransomware|keylogger|stealer|malware|trojan|backdoor|botnet|rootkit)\b/i,
  /\b(?:write|build|create|generate|develop).{0,45}\b(?:ransomware|keylogger|stealer|malware|trojan|backdoor|botnet|rootkit).{0,45}\b(?:detector|scanner|detection rule|YARA rule|signature|analysis sandbox|removal tool|honeypot)\b/i,
  /(?:写|编写|用).{0,24}(?:脚本|代码|程序).{0,20}(?:检测|识别|隔离|删除|查杀|防御).{0,24}(?:勒索软件|键盘记录器|信息窃取器|木马|后门|僵尸网络|恶意软件|远控木马)/i,
  /\b(?:write|build|create|generate|develop).{0,35}\b(?:code|script|program).{0,25}\b(?:detect|identify|isolate|remove|defend against).{0,30}\b(?:ransomware|keylogger|stealer|malware|trojan|backdoor|botnet|rootkit)\b/i,
  /(?:写|编写|用).{0,24}(?:检测|识别|隔离|删除|查杀|防御).{0,28}(?:勒索软件|键盘记录器|信息窃取器|木马|后门|僵尸网络|恶意软件|远控木马).{0,24}(?:脚本|代码|程序|检测规则)/i,
];

const MALWARE_PROTECTIVE_CAPABILITY_CONTEXT = [
  /(?:检测|识别|防止|阻止|缓解|调查).{0,28}(?:绕过|规避|关闭|禁用|免杀|持久化|横向移动|窃取密码|窃取凭据|窃取\s*cookie|导出\s*cookie)/i,
  /\b(?:detect|identify|prevent|stop|mitigate|investigate).{0,35}\b(?:bypass|evade|disable|persistence|lateral movement|steal|exfiltrate)\b/i,
];

const MALWARE_EXPLICIT_DEFENSIVE_PURPOSE = [
  /(?:绕过|规避|关闭|禁用|免杀|持久化|横向移动|窃取密码|窃取凭据|窃取\s*cookie|导出\s*cookie).{0,40}(?:以便|用于|从而|目的是).{0,24}(?:检测|识别|防止|阻止|缓解|编写检测规则|防御)/i,
  /\b(?:bypass|evade|disable|persistence|lateral movement|steal|exfiltrate).{0,50}\b(?:in order to|so that|for the purpose of).{0,30}\b(?:detect|identify|prevent|stop|mitigate|defend)\b/i,
];

function evaluateMalware(text, direction) {
  const hasMalwareTerm = hasAny(text, MALWARE_TERMS);
  const hasCapability = hasAny(text, MALWARE_HARMFUL_CAPABILITY);
  if (!hasMalwareTerm && !hasCapability) return null;

  const operation = hasAny(text, MALWARE_OPERATION);
  const defensive = hasAny(text, MALWARE_DEFENSIVE_CONTEXT);
  const defensiveBuild = hasAny(text, MALWARE_DEFENSIVE_BUILD);
  const protectiveCapability =
    hasAny(text, MALWARE_PROTECTIVE_CAPABILITY_CONTEXT) ||
    hasAny(text, MALWARE_EXPLICIT_DEFENSIVE_PURPOSE);
  const harmfulCapabilityRequest =
    hasCapability && hasAny(text, GENERAL_REQUEST_PATTERNS) && !protectiveCapability;
  if (isPureRefusal(text) && !hasCapability) return null;
  const outputDelivery =
    direction === "output" &&
    ((hasMalwareTerm &&
      hasAny(text, [/(?:代码|脚本|步骤)(?:如下|是)/i, /```(?:python|powershell|javascript|c|cpp|go|rust)?/i, /\bhere (?:is|are) (?:the )?(?:code|script|steps?)\b/i])) ||
      (hasCapability && !protectiveCapability));

  if (defensiveBuild && !hasCapability && !outputDelivery) return null;
  if (defensive && !operation && !outputDelivery && !harmfulCapabilityRequest) return null;
  if (!operation && !outputDelivery && !harmfulCapabilityRequest) return null;

  return makeSignal(
    "malware_high_risk",
    "block",
    "high",
    USER_MESSAGES.malware_high_risk,
    SAFE_TEXT.malware_high_risk,
  );
}

// ---------------------------------------------------------------------------
// Violent wrongdoing: block real-world intent, planning, and instruction, but
// allow prevention, news, clearly fictional discussion, and technical idioms.
// ---------------------------------------------------------------------------

const VIOLENT_TERMS = [
  /(?:杀人|谋杀|杀(?:了|死)(?:他|她|他们|她们|某人|别人|敌人)|捅死|勒死|掐死|砍死|雇凶|买凶|枪击|开枪打死|毒死|下毒|绑架|劫持|纵火|制造炸弹|炸弹制作|制作爆炸物|引爆炸弹|毁尸灭迹)/i,
  /\b(?:murder|kill (?:him|her|them|someone|people)|shoot (?:him|her|them|someone|people)|stab (?:him|her|them|someone|people)|strangle|choke (?:him|her|them|someone|a person)|behead|bludgeon|hire (?:a )?(?:hitman|killer)|poison (?:him|her|them|someone|people)|kidnap|hostage|arson|(?:build|make) (?:a )?bomb|bomb-making|make (?:an )?explosive device|detonate (?:a )?bomb|dispose of (?:a )?body)\b/i,
];

const VIOLENT_INTENT_OR_INSTRUCTION = [
  /(?:我|我们).{0,10}(?:要|想|准备|打算|决定|计划).{0,18}(?:杀人|杀了|捅死|枪击|开枪|毒死|下毒|绑架|劫持|纵火|炸掉)/i,
  /(?:怎么|如何|教我|帮我|给我|步骤|计划|方案).{0,28}(?:杀人|谋杀|捅死|勒死|掐死|砍死|雇凶|买凶|枪击|开枪打死|毒死|下毒|绑架|劫持|纵火|制造炸弹|引爆炸弹|毁尸灭迹)/i,
  /(?:杀人|谋杀|捅死|勒死|掐死|砍死|雇凶|买凶|枪击|开枪打死|毒死|下毒|绑架|劫持|纵火|制造炸弹|引爆炸弹|毁尸灭迹).{0,28}(?:步骤|计划|方案|方法|教程|不被发现|不留痕迹|逃避追查)/i,
  /\b(?:i|we)\s+(?:want|plan|intend|am going|are going|have decided)\s+to\s+(?:murder|kill|shoot|stab|poison|kidnap|set fire|bomb)\b/i,
  /\b(?:how (?:do|can) i|how to|teach me to|help me|give me (?:a )?(?:plan|steps?|method)).{0,35}\b(?:murder|kill|shoot|stab|strangle|choke|behead|bludgeon|hire (?:a )?(?:hitman|killer)|poison|kidnap|take hostage|commit arson|(?:build|make) a bomb|make an explosive device|dispose of a body)\b/i,
];

const VIOLENT_SAFE_CONTEXT = [
  /(?:阻止|预防|避免|制止|举报|报警|逃离|保护|急救|法律|判例|新闻|报道|研究|历史|虚构|小说|剧本|电影|游戏).{0,36}(?:杀人|谋杀|杀(?:了|死)|枪击|下毒|绑架|劫持|纵火|炸弹)/i,
  /(?:杀人|谋杀|枪击|下毒|绑架|劫持|纵火|炸弹).{0,36}(?:阻止|预防|避免|制止|举报|报警|逃离|保护|急救|法律|判例|新闻|报道|研究|历史|虚构|小说|剧本|电影|游戏)/i,
  /\b(?:prevent|stop|avoid|report|escape|protect|first aid|law|case|news|research|history|fiction|novel|screenplay|movie|game).{0,45}\b(?:murder|shooting|poisoning|kidnapping|hostage|arson|bomb)\b/i,
  /\b(?:murder|shooting|poisoning|kidnapping|hostage|arson|bomb).{0,45}\b(?:prevent|stop|avoid|report|escape|protect|first aid|law|news|research|history|fiction|novel|screenplay|movie|game)\b/i,
  /(?:警方|警察|侦破|侦查|破案|案件分析|犯罪调查).{0,36}(?:杀人|谋杀|雇凶|买凶|枪击|下毒|绑架|纵火|炸弹)/i,
];

const VIOLENT_FALSE_POSITIVE_REPLACEMENTS = [
  /(?:杀死|结束|终止).{0,8}(?:进程|线程|程序|任务|服务)/gi,
  /\bkill\s+(?:the\s+)?(?:process|thread|program|task|service|server)\b/gi,
  /(?:游戏|副本|关卡).{0,24}(?:击杀|杀死|砍死|勒死|掐死|捅死|毒死|打败).{0,12}(?:Boss|怪物|敌人)/gi,
  /\b(?:bath bomb|bomb shelter|bomb disposal|bomb squad)\b/gi,
];

const VIOLENT_HARMFUL_OVERRIDE = [
  /(?:教我|请教我|帮我|给我).{0,12}(?:如何|怎么).{0,6}(?:谋杀|杀人|杀死|下毒|绑架|制造炸弹|制作爆炸物)/i,
  /\b(?:teach|show|tell|help|give) me.{0,15}\bhow to\s+(?:murder|kill|poison|kidnap|make a bomb|build a bomb)\b/i,
];

const VIOLENT_DIRECT_OUTPUT = [
  /(?:先|首先|然后|接着|通过|把).{0,28}(?:下毒|毒死|杀死|捅死|绑架|纵火|引爆|毁尸)/i,
  /\b(?:murder|kill|shoot|stab|poison|kidnap|burn|detonate).{0,45}\b(?:by|using|with|put|first|then|next)\b/i,
  /\b(?:first|then|next).{0,45}\b(?:murder|kill|shoot|stab|poison|kidnap|burn|detonate)\b/i,
];

function stripViolentFalsePositives(text) {
  return VIOLENT_FALSE_POSITIVE_REPLACEMENTS.reduce(
    (scopedText, pattern) => scopedText.replace(pattern, " [benign-context] "),
    text,
  );
}

function evaluateViolence(text, direction) {
  const scopedText = stripViolentFalsePositives(text);
  if (!hasAny(scopedText, VIOLENT_TERMS)) return null;
  if (/(?:自杀|杀死自己|kill myself|end my life)/i.test(scopedText) && !/(?:他人|别人|someone else|other people)/i.test(scopedText)) {
    return null;
  }

  const intent = hasAny(scopedText, VIOLENT_INTENT_OR_INSTRUCTION);
  const safeContext = hasAny(scopedText, VIOLENT_SAFE_CONTEXT);
  const harmfulOverride = hasAny(scopedText, VIOLENT_HARMFUL_OVERRIDE);
  const directOutput = direction === "output" && hasAny(scopedText, VIOLENT_DIRECT_OUTPUT);
  const realismOverride = /(?:现实|真实|可执行|不被发现|逃避追查|real(?:istic| world)|actionable|undetected)/i.test(scopedText);
  const outputDelivery =
    direction === "output" &&
    hasAny(scopedText, [/(?:步骤|计划|方案)(?:如下|是)/i, /\bhere (?:is|are) (?:the )?(?:plan|steps?|method)\b/i]);

  if (isPureRefusal(scopedText) && !directOutput && !outputDelivery) return null;
  if (safeContext && !realismOverride && !harmfulOverride && !directOutput && !outputDelivery) return null;
  if (!intent && !directOutput && !outputDelivery) return null;

  return makeSignal(
    "violent_wrongdoing",
    "block",
    "high",
    USER_MESSAGES.violent_wrongdoing,
    SAFE_TEXT.violent_wrongdoing,
  );
}

const EVALUATORS = [
  evaluateSelfHarm,
  evaluateSexualMinors,
  evaluateCredentialsAndPrivacy,
  evaluateMalware,
  evaluateViolence,
];

function resultFromSignals(signals) {
  if (signals.length === 0) {
    return {
      action: "allow",
      severity: "none",
      categories: [],
      userMessage: USER_MESSAGES.allow,
    };
  }

  const sortedSignals = [...signals].sort((left, right) => {
    const actionDelta = ACTION_RANK[right.action] - ACTION_RANK[left.action];
    if (actionDelta !== 0) return actionDelta;
    const severityDelta = SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity];
    if (severityDelta !== 0) return severityDelta;
    return CATEGORY_RANK.get(left.category) - CATEGORY_RANK.get(right.category);
  });
  const dominant = sortedSignals[0];
  const severity = signals.reduce(
    (highest, signal) =>
      SEVERITY_RANK[signal.severity] > SEVERITY_RANK[highest] ? signal.severity : highest,
    "none",
  );
  const categories = [...new Set(signals.map((signal) => signal.category))].sort(
    (left, right) => CATEGORY_RANK.get(left) - CATEGORY_RANK.get(right),
  );

  return {
    action: dominant.action,
    severity,
    categories,
    userMessage: dominant.userMessage,
    ...(dominant.safeText ? { safeText: dominant.safeText } : {}),
  };
}

function oversizedResult() {
  return {
    action: "block",
    severity: "high",
    categories: [],
    userMessage: USER_MESSAGES.oversized,
    safeText: SAFE_TEXT.oversized,
  };
}

/**
 * Classify one text boundary.
 *
 * @param {unknown} text Input text or generated output text.
 * @param {{direction?: "input" | "output"}} [options]
 * @returns {{action: "allow" | "warn" | "support" | "block", severity: "none" | "low" | "medium" | "high" | "critical", categories: string[], userMessage: string, safeText?: string}}
 */
export function classifySafety(text, options = {}) {
  let value = text;
  let direction = options?.direction ?? "input";
  if (text !== null && typeof text === "object") {
    if (!Object.hasOwn(text, "text")) {
      throw new TypeError("object input must contain a text property");
    }
    value = text.text;
    direction = text.direction ?? direction;
  }
  if (direction !== "input" && direction !== "output") {
    throw new TypeError('direction must be either "input" or "output"');
  }

  const rawText = value === undefined || value === null ? "" : String(value);
  if (rawText.length > MAX_TEXT_CHARS) return oversizedResult();
  const normalized = normalizeText(rawText);
  if (!normalized) return resultFromSignals([]);
  const signals = EVALUATORS.map((evaluate) => evaluate(normalized, direction, rawText)).filter(Boolean);
  return resultFromSignals(signals);
}

/**
 * Classify both sides of one model exchange and return the strongest result.
 * Output wins a tie because it is the last boundary before content is shown.
 *
 * @param {{inputText?: unknown, outputText?: unknown} | string | null} exchange
 */
export function classifySafetyExchange(exchange = {}) {
  if (exchange === null || exchange === undefined) return classifySafety("");
  if (typeof exchange === "string") return classifySafety(exchange, { direction: "input" });
  if (typeof exchange !== "object" || Array.isArray(exchange)) {
    throw new TypeError("exchange must be an object or input string");
  }
  const inputText = exchange.inputText ?? exchange.text ?? "";
  const outputText = exchange.outputText ?? "";
  const inputResult = classifySafety(inputText, { direction: "input" });
  const outputResult = classifySafety(outputText, { direction: "output" });
  const results = [outputResult, inputResult];
  const active = results.filter((result) => result.action !== "allow");
  if (active.length === 0) return inputResult;

  const dominant = active.reduce((current, candidate) => {
    if (ACTION_RANK[candidate.action] > ACTION_RANK[current.action]) return candidate;
    if (
      ACTION_RANK[candidate.action] === ACTION_RANK[current.action] &&
      SEVERITY_RANK[candidate.severity] > SEVERITY_RANK[current.severity]
    ) {
      return candidate;
    }
    return current;
  });
  const severity = active.reduce(
    (highest, result) =>
      SEVERITY_RANK[result.severity] > SEVERITY_RANK[highest] ? result.severity : highest,
    "none",
  );
  const categories = [...new Set(active.flatMap((result) => result.categories))].sort(
    (left, right) => CATEGORY_RANK.get(left) - CATEGORY_RANK.get(right),
  );

  return {
    action: dominant.action,
    severity,
    categories,
    userMessage: dominant.userMessage,
    ...(dominant.safeText ? { safeText: dominant.safeText } : {}),
  };
}

export default classifySafety;
