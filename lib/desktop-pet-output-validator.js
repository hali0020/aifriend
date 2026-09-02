import { createHash } from "node:crypto";

const SIDE_EFFECT_PATTERNS = Object.freeze([
  Object.freeze({
    action: "trash",
    patterns: Object.freeze([
      /(?:已经|已|刚刚|成功)(?:把|将)?[^。！？\n]{0,32}(?:删除|移入回收站|放进回收站)/giu,
      /(?:删除|移入回收站|移到回收站|放进回收站|放到回收站)(?:成功|完成|好了|了)/giu,
      /(?:删除|移入回收站|移到回收站|放进回收站|放到回收站).{0,8}(?:已经|已)(?:成功|完成|好了|结束)/giu,
      /\b(?:deleted|removed|trashed|moved\s+(?:it|the file)\s+to\s+(?:the\s+)?(?:trash|recycle bin))\b/giu,
    ]),
  }),
  Object.freeze({
    action: "upload",
    patterns: Object.freeze([
      /(?:已经|已|刚刚|成功)(?:把|将)?[^。！？\n]{0,32}(?:上传|发送到远端|发到云端)/giu,
      /(?:上传|发送到远端|发到云端)(?:成功|完成|好了|了)/giu,
      /\b(?:uploaded|sent\s+(?:it|the file|the data)\s+to\s+(?:the\s+)?(?:cloud|remote))\b/giu,
    ]),
  }),
  Object.freeze({
    action: "record",
    patterns: Object.freeze([
      /(?:已经|已|刚刚|成功)(?:开始|完成)?[^。！？\n]{0,20}(?:录音|录下|监听)/giu,
      /(?:录音|录下)(?:成功|完成|好了|了)/giu,
      /(?:录音|录下|监听).{0,8}(?:已经|已)(?:开始|成功|完成|好了|结束)/giu,
      /\b(?:recorded|recording\s+(?:has\s+)?started|captured\s+(?:the\s+)?audio)\b/giu,
    ]),
  }),
  Object.freeze({
    action: "save",
    patterns: Object.freeze([
      /(?:已经|已|刚刚|成功)(?:把|将)?[^。！？\n]{0,32}(?:保存|写入|存储|记住)/giu,
      /(?:保存|写入|存储|记住)(?:成功|完成|好了|了)/giu,
      /(?:保存|写入|存储|记住).{0,8}(?:已经|已)(?:成功|完成|好了|结束)/giu,
      /\b(?:saved|written\s+to\s+(?:disk|a file)|stored)\b/giu,
    ]),
  }),
  Object.freeze({
    action: "capture",
    patterns: Object.freeze([
      /(?:已经|已|刚刚|成功)(?:完成|进行)?[^。！？\n]{0,20}(?:截图|截屏|截取画面|捕获画面)/giu,
      /(?:截图|截屏|截取画面|捕获画面)(?:成功|完成|好了|了)/giu,
      /(?:截图|截屏|截取画面|捕获画面).{0,8}(?:已经|已)(?:成功|完成|好了|结束)/giu,
      /\b(?:captured|took)\s+(?:the\s+|a\s+)?(?:screen|screenshot|selected window)\b/giu,
    ]),
  }),
  Object.freeze({
    action: "show",
    patterns: Object.freeze([
      /(?:桌宠|桌宠窗口).{0,12}(?:已经|已)(?:显示|打开)(?:成功|完成|好了|了)?/giu,
      /(?:已经|已).{0,12}(?:显示|打开)(?:了)?(?:桌宠|桌宠窗口)/giu,
      /\b(?:desktop pet|pet window)\s+(?:is|has been)\s+(?:now\s+)?(?:visible|shown|opened)\b/giu,
    ]),
  }),
  Object.freeze({
    action: "hide",
    patterns: Object.freeze([
      /(?:桌宠|桌宠窗口).{0,12}(?:已经|已)(?:隐藏|收起|关闭)(?:成功|完成|好了|了)?/giu,
      /(?:已经|已).{0,12}(?:隐藏|收起|关闭)(?:了)?(?:桌宠|桌宠窗口)/giu,
      /\b(?:desktop pet|pet window)\s+(?:is|has been)\s+(?:now\s+)?(?:hidden|closed)\b/giu,
    ]),
  }),
  Object.freeze({
    action: "set_pose",
    patterns: Object.freeze([
      /(?:桌宠)?(?:已经|已).{0,12}(?:切换|换成|改成).{0,16}(?:姿态|表情|动作)/giu,
      /(?:桌宠).{0,12}(?:姿态|表情|动作)(?:切换|更改)(?:成功|完成|好了|了)/giu,
      /\b(?:desktop pet|pet)(?:'s)?\s+(?:pose|expression)\s+(?:is|has been)\s+(?:set|changed)\b/giu,
    ]),
  }),
]);

const NEGATION_BEFORE = /(?:没有|还没|没|并未|尚未|未曾|未|不会|不能|无法|禁止|拒绝|不应|不要|别|no|not|never|cannot|can't|won't|didn't|hasn't|haven't|isn't|wasn't|weren't)\s*(?:真的)?\s*(?:声称|表示|说|been|be|get|successfully)?\s*$/iu;
const NON_ASSERTIVE_BEFORE = /(?:无法|不能|尚未)(?:确认|核实)(?:是否)?\s*$|(?:不确定|未知)(?:是否)?\s*$|(?:才能|才可以)(?:说|声称)?\s*$/iu;
const TRUSTED_ISSUER = "trusted_host";
const RECEIPT_STATUS_BY_ACTION = Object.freeze({
  trash: "trashed",
  upload: "uploaded",
  record: "recorded",
  save: "saved",
  capture: "captured",
  show: "shown",
  hide: "hidden",
  set_pose: "pose_set",
});
const RECEIPT_KEYS = Object.freeze([
  "action",
  "issuer",
  "nonce",
  "receiptId",
  "requestId",
  "status",
  "traceId",
  "verified",
]);
const MAX_CONSUMED_RECEIPTS = 4_096;
const consumedReceiptKeys = new Set();
const consumedReceiptQueue = [];

function normalizeText(value) {
  return String(value ?? "").normalize("NFC").replace(/\p{Cf}/gu, "").trim();
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cleanEnum(value) {
  return String(value ?? "").normalize("NFKC").replace(/\p{Cf}/gu, "").trim().toLowerCase().replace(/[\s-]+/gu, "_").slice(0, 80);
}

function boundedOpaque(value, maximum = 160) {
  if (typeof value !== "string") return "";
  const text = value.normalize("NFC").replace(/\p{Cf}/gu, "").trim();
  if (!text || text.length > maximum || /[\u0000-\u001f\u007f]/u.test(text)) return "";
  return text;
}

function validNonce(value) {
  const nonce = boundedOpaque(value, 160);
  if (!/^[A-Za-z0-9_-]{24,160}$/u.test(nonce)) return "";
  if (new Set(nonce).size < 6) return "";
  return nonce;
}

function exactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function receiptReplayKey(receipt) {
  return createHash("sha256")
    .update([receipt.issuer, receipt.action, receipt.status, receipt.receiptId, receipt.requestId, receipt.traceId, receipt.nonce].join("\u0000"), "utf8")
    .digest("hex");
}

function consumeReceipt(key) {
  consumedReceiptKeys.add(key);
  consumedReceiptQueue.push(key);
  while (consumedReceiptQueue.length > MAX_CONSUMED_RECEIPTS) {
    consumedReceiptKeys.delete(consumedReceiptQueue.shift());
  }
}

/** Find claims that a local or remote side effect already happened. */
export function findDesktopPetExecutionClaims(outputText) {
  const text = normalizeText(outputText);
  const claims = [];
  for (const group of SIDE_EFFECT_PATTERNS) {
    for (const pattern of group.patterns) {
      pattern.lastIndex = 0;
      for (const match of text.matchAll(pattern)) {
        const prefix = text.slice(Math.max(0, match.index - 24), match.index);
        if (NEGATION_BEFORE.test(prefix) || NON_ASSERTIVE_BEFORE.test(prefix)) continue;
        claims.push({ action: group.action, text: match[0], index: match.index });
      }
    }
  }
  return claims
    .sort((left, right) => left.index - right.index)
    .filter((claim, index, values) => index === 0
      || claim.index !== values[index - 1].index
      || claim.action !== values[index - 1].action
      || claim.text !== values[index - 1].text);
}

function inspectTrustedReceipt(value, requestContext, policyResult) {
  if (value === undefined || value === null) return { receipt: null, replayKey: "", reasonCodes: [] };
  const reasonCodes = [];
  if (!isPlainObject(value)) return { receipt: null, replayKey: "", reasonCodes: ["INVALID_RECEIPT_SCHEMA"] };
  if (!exactKeys(value, RECEIPT_KEYS)) reasonCodes.push("INVALID_RECEIPT_SCHEMA");

  const issuer = cleanEnum(value.issuer);
  const action = cleanEnum(value.action);
  const status = cleanEnum(value.status);
  const receiptId = boundedOpaque(value.receiptId);
  const requestId = boundedOpaque(value.requestId);
  const traceId = boundedOpaque(value.traceId);
  const nonce = validNonce(value.nonce);
  if (value.verified !== true || issuer !== TRUSTED_ISSUER) reasonCodes.push("UNTRUSTED_RECEIPT");
  if (!Object.hasOwn(RECEIPT_STATUS_BY_ACTION, action)) reasonCodes.push("INVALID_RECEIPT_ACTION");
  else if (status !== RECEIPT_STATUS_BY_ACTION[action]) reasonCodes.push("RECEIPT_STATUS_MISMATCH");
  if (!/^[A-Za-z0-9._:-]{8,160}$/u.test(receiptId)) reasonCodes.push("INVALID_RECEIPT_ID");

  if (!isPlainObject(requestContext)) {
    reasonCodes.push("RECEIPT_BINDING_MISSING");
  } else {
    const expectedRequestId = boundedOpaque(requestContext.requestId);
    const expectedTraceId = boundedOpaque(requestContext.traceId);
    const expectedNonce = validNonce(requestContext.nonce);
    if (!expectedRequestId || !expectedTraceId || !expectedNonce) {
      reasonCodes.push("RECEIPT_BINDING_MISSING");
    } else if (!requestId || !traceId || !nonce
        || requestId !== expectedRequestId
        || traceId !== expectedTraceId
        || nonce !== expectedNonce) {
      reasonCodes.push("RECEIPT_BINDING_MISMATCH");
    }
  }

  const policyAction = cleanEnum(policyResult?.normalizedIntent?.action);
  if (!policyAction) reasonCodes.push("POLICY_ACTION_BINDING_MISSING");
  else if (policyAction !== action) reasonCodes.push("RECEIPT_POLICY_ACTION_MISMATCH");

  const receipt = { issuer, action, status, receiptId, requestId, traceId, nonce };
  const replayKey = receiptReplayKey(receipt);
  if (consumedReceiptKeys.has(replayKey)) reasonCodes.push("RECEIPT_REPLAYED");
  return {
    receipt: reasonCodes.length === 0 ? receipt : null,
    replayKey,
    reasonCodes: [...new Set(reasonCodes)],
  };
}

/**
 * Validate that model prose does not invent side effects. A caller-supplied
 * toolExecution flag is intentionally ignored. A completion claim requires an
 * exact host receipt bound to this request, trace, one-time nonce, and policy
 * action. Accepted receipts are consumed in-process to reject replay.
 */
export function validateDesktopPetOutput({ policyResult, outputText, trustedReceipt, requestContext } = {}) {
  if (!isPlainObject(policyResult)) throw new TypeError("policyResult must be an object");
  const text = normalizeText(outputText);
  if ([...text].length > 20_000) throw new RangeError("outputText is too long");
  const claims = findDesktopPetExecutionClaims(text);
  const receiptInspection = inspectTrustedReceipt(trustedReceipt, requestContext, policyResult);
  const receipt = receiptInspection.receipt;
  const reasonCodes = [...receiptInspection.reasonCodes];
  const decisionCannotExecute = ["block", "manual_review", "confirm"].includes(policyResult.decision);

  if (claims.length > 0 && decisionCannotExecute) reasonCodes.push("ACTION_CLAIM_CONTRADICTS_POLICY");
  if (claims.length > 0 && !receipt) reasonCodes.push("UNVERIFIED_SIDE_EFFECT_CLAIM");
  if (claims.length > 0 && receipt && claims.some(claim => claim.action !== receipt.action)) {
    reasonCodes.push("RECEIPT_ACTION_MISMATCH");
  }
  if (receipt && policyResult.decision !== "allow") reasonCodes.push("RECEIPT_CONTRADICTS_POLICY");

  const uniqueReasons = [...new Set(reasonCodes)];
  const passed = uniqueReasons.length === 0;
  const receiptUsed = passed && Boolean(receipt) && claims.length > 0;
  if (receiptUsed) consumeReceipt(receiptInspection.replayKey);
  return {
    passed,
    criticalFailure: !passed,
    priority: !passed ? "P0" : policyResult.priority || "P2",
    reasonCodes: uniqueReasons,
    claims,
    trustedReceiptAccepted: passed && Boolean(receipt),
    releaseAllowed: passed,
    safeText: passed ? text : normalizeText(policyResult.safeResponse) || "这项操作没有执行。",
  };
}

export default validateDesktopPetOutput;
