import { stripInternalReplyLabels } from "../public/reply-policy.js";

const GENERIC_UNITS = new Set(["今天", "这个", "那个", "什么", "怎么", "可以", "还是", "一下", "现在"]);
const INTENT_PATTERNS = Object.freeze({
  comfort: /情绪支持|克制关心|状态(?:不太好|不好|很不好)|心情(?:不太好|不好|很不好)|低落|难受|疲惫|(?:我|今天|最近|这几天)[^，。！？\n]{0,8}(?:很|有点|太|好|真|特别)?累(?:了|坏了)?(?=[，。！？\n]|$)|压力|崩溃|伤心|焦虑|烦躁|沮丧|委屈|撑不住|做不好|不开心/u,
  science: /科学讨论|专注|结论|证据|实验|假设|数据|原理|变量|样本|反例|因果|理论/u,
  identity: /称呼|克里斯提娜|克里斯蒂娜|牧濑红莉西|牧濑红莉栖|红莉西|牧瀬紅莉栖|kurisu/iu,
});
const NON_PERSONAL_STATUS = /(?:程序|模型|服务|系统|设备|网络|连接|运行|服务器|机器|电脑|游戏)(?:的)?(?:本身|当前|运行|连接|服务)?(?:的)?状态(?:不太好|不好|很不好)/u;
const PERSONAL_CONTEXT = /我|自己|今天|最近|这几天/u;

function normalized(value) {
  return String(value ?? "").normalize("NFKC").toLowerCase();
}

export function styleIntent(value = "") {
  const text = normalized(value);
  if (NON_PERSONAL_STATUS.test(text)) return "technical";
  if (INTENT_PATTERNS.comfort.test(text)
    && PERSONAL_CONTEXT.test(text)) return "comfort";
  if (INTENT_PATTERNS.science.test(text)) return "science";
  if (INTENT_PATTERNS.identity.test(text)) return "identity";
  return "general";
}

export function styleLexicalUnits(value = "") {
  const text = normalized(value);
  const units = new Set(text.match(/[a-z0-9]{2,}/g) || []);
  for (const sequence of text.match(/[\u3400-\u9fff]+/g) || []) {
    for (const size of [2, 3]) {
      for (let index = 0; index + size <= sequence.length; index += 1) {
        const unit = sequence.slice(index, index + size);
        if (!GENERIC_UNITS.has(unit)) units.add(unit);
      }
    }
  }
  return units;
}

function exampleIntent(example) {
  return styleIntent(`${example?.scene || ""} ${example?.emotion || ""} ${example?.context?.text || ""}`);
}

export function rankStyleExamples(query, examples, { limit = 2 } = {}) {
  if (!Array.isArray(examples) || !Number.isSafeInteger(limit) || limit < 1) return [];
  const queryIntent = styleIntent(query);
  const queryUnits = styleLexicalUnits(query);
  return examples.map(example => {
    const haystack = styleLexicalUnits(`${example?.scene || ""} ${example?.emotion || ""} ${example?.context?.text || ""}`);
    let overlap = 0;
    for (const unit of queryUnits) if (haystack.has(unit)) overlap += unit.length === 3 ? 3 : 2;
    const intent = exampleIntent(example);
    let score = overlap;
    if (intent !== queryIntent) score = Number.NEGATIVE_INFINITY;
    else if (queryIntent !== "general") score += 24;
    return { example, score };
  }).filter(item => item.score > 0 && typeof item.example?.response === "string" && item.example.response.trim())
    .sort((left, right) => right.score - left.score
      || String(left.example.id || "").localeCompare(String(right.example.id || ""), "en"))
    .slice(0, limit)
    .map(item => item.example);
}

export function formatStyleExamples(examples, { maxChars = 160 } = {}) {
  if (!Array.isArray(examples)) return "";
  return examples.map((example, index) => {
    const response = stripInternalReplyLabels(example?.response || "").replace(/\s+/g, " ").trim().slice(0, maxChars);
    return response ? `参考表达 ${index + 1}：${response}` : "";
  }).filter(Boolean).join("\n");
}
