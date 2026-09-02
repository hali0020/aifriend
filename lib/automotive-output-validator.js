const EXECUTION_PATTERNS = Object.freeze([
  /(?:已经|已|现已|正在)(?:为你)?(?:成功)?(?:打开|解锁|上锁|关闭|播放|设置|调节|调整|执行|完成)/giu,
  /(?:打开|解锁|上锁|关闭|播放|设置|调节|调整)(?:好|完成|成功)(?:了|啦)?/giu,
  /\b(?:has been|have been|is being|successfully)\s+(?:opened|unlocked|locked|closed|played|set|adjusted|executed)\b/giu,
  /\b(?:opened|unlocked|locked|closed|set|adjusted)\s+(?:it|the|your)\b/giu,
]);

const NEGATION_BEFORE = /(?:没有|并未|尚未|未|不会|不能|无法|禁止|拒绝|不应|不要|别|no|not|never|cannot|can't|won't|mustn't)\s*(?:为你)?(?:声称|表示|说)?\s*$/iu;

function normalizeText(value) {
  return String(value ?? "").normalize("NFC").replace(/\p{Cf}/gu, "").trim();
}

export function findAutomotiveExecutionClaims(outputText) {
  const text = normalizeText(outputText);
  const claims = [];
  for (const pattern of EXECUTION_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const prefix = text.slice(Math.max(0, match.index - 16), match.index);
      if (NEGATION_BEFORE.test(prefix)) continue;
      claims.push({ text: match[0], index: match.index });
    }
  }
  return claims.sort((a, b) => a.index - b.index).filter((claim, index, values) => (
    index === 0 || claim.index !== values[index - 1].index || claim.text !== values[index - 1].text
  ));
}

export function validateAutomotiveOutput({ policyResult, outputText, toolExecution } = {}) {
  if (!policyResult || typeof policyResult !== "object" || Array.isArray(policyResult)) {
    throw new TypeError("policyResult must be an object");
  }
  const text = normalizeText(outputText);
  if ([...text].length > 20_000) throw new RangeError("outputText is too long");
  const claims = findAutomotiveExecutionClaims(text);
  const executionKnown = toolExecution && typeof toolExecution === "object" && typeof toolExecution.executed === "boolean";
  const executed = executionKnown && toolExecution.executed === true;
  const decisionCannotExecute = ["block", "manual_review", "confirm"].includes(policyResult.decision);
  const policyMismatch = decisionCannotExecute && executed;
  const unsupportedClaim = claims.length > 0 && (!executed || decisionCannotExecute);
  const reasonCodes = [];
  if (policyMismatch) reasonCodes.push("EXECUTION_CONTRADICTS_POLICY");
  if (unsupportedClaim) reasonCodes.push("UNVERIFIED_EXECUTION_CLAIM");
  if (policyResult.decision === "block" && claims.length > 0) reasonCodes.push("BLOCKED_ACTION_CLAIMED_SUCCESS");
  if (policyResult.decision === "confirm" && claims.length > 0) reasonCodes.push("UNCONFIRMED_ACTION_CLAIMED_SUCCESS");

  const passed = reasonCodes.length === 0;
  return {
    passed,
    criticalFailure: !passed,
    priority: !passed ? "P0" : policyResult.priority || "P2",
    reasonCodes: [...new Set(reasonCodes)],
    claims,
    releaseAllowed: passed,
    safeText: passed ? text : normalizeText(policyResult.safeResponse) || "这项操作没有执行。",
  };
}

export default validateAutomotiveOutput;
