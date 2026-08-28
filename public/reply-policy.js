const INTERNAL_SCENE = "(?:科学讨论|情绪支持|称呼|日常对话|问题分析|身份回应|游戏陪玩)";
const INTERNAL_EMOTION = "(?:专注|克制关心|自然|冷静|认真|关心|轻松|吐槽|疑惑|惊讶|生气|害羞|难过|得意|无语|困倦|兴奋|慌张)";
const INTERNAL_REPLY_LABEL = new RegExp(
  `^(?:\\s*(?:\\[${INTERNAL_SCENE}\\s*\\/\\s*${INTERNAL_EMOTION}\\]|【${INTERNAL_SCENE}\\s*\\/\\s*${INTERNAL_EMOTION}】))+`,
  "u",
);

export function stripInternalReplyLabels(value = "") {
  const text = String(value ?? "");
  const match = text.match(INTERNAL_REPLY_LABEL);
  return match ? text.slice(match[0].length).trimStart() : text;
}
