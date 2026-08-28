import { styleIntent } from "./style-retrieval.js";

export const BRIEF_COMFORT_REPLY = "……这样啊。听起来今天不太好受。更像是身体不舒服、太累了，还是心情有点低落？";

const CHARACTER_ADDRESS = "(?:克里斯提娜|克里斯蒂娜|牧濑红莉西|牧濑红莉栖|红莉西|牧瀬紅莉栖)";
const BRIEF_COMFORT_ONLY = new RegExp(
  `^(?:${CHARACTER_ADDRESS}[，,:：\\s]*)?(?:我)?(?:今天|最近|这几天)?(?:的)?(?:`+
    "(?:状态|心情)(?:不太好|不好|很不好|有点低落|很低落)|"+
    "(?:有点|很|太|特别|真的|实在)?累(?:了|坏了)?"+
  ")[。.!！…~～]*$",
  "u",
);

export function isBriefComfortTurn(text, { hasImage = false, hasAudio = false } = {}) {
  const input = String(text || "").normalize("NFKC").trim();
  if (hasImage || hasAudio || !input || input.length > 36) return false;
  return BRIEF_COMFORT_ONLY.test(input);
}

export function demoReply(text, hasImage = false, hasAudio = false) {
  const input = String(text || "");
  if (hasImage) return "图片已经收到。演示模式目前还不能可靠分析内容；你更想确认哪一部分？";
  if (hasAudio) return "录音已经收到。不过演示模式目前没有语音识别，几个文字关键词也能让我理解大意。";
  if (styleIntent(input) === "comfort") return BRIEF_COMFORT_REPLY;
  if (/心情(?:很好|不错)|开心|高兴|顺利|成功/.test(input)) return "嗯，结果不错。哪些部分是你这次做对了的？这些部分会让下次复现更有把握。";
  return "目前的信息还不多。事情大概是怎么发生的，你现在最想解决哪一部分？";
}
