import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { redactReviewText, reviewTextContainsSensitiveData } from "./automotive-safety-policy.js";

const DEFAULT_MAX_RECORDS = 200;
const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024;
const ALLOWED_STATUS = new Set(["pending", "in_review", "resolved", "accepted_risk", "duplicate", "invalid"]);
const SENSITIVE_KEY = /(?:raw|password|passwd|secret|token|api[_-]?key|private[_-]?key|authorization|cookie|vin|location|latitude|longitude|coordinate|address|email|phone)/iu;
const ROOT_KEYS = Object.freeze([
  "reportVersion",
  "reviewId",
  "createdAt",
  "status",
  "priority",
  "datasetVersion",
  "caseId",
  "traceId",
  "modelVersion",
  "policyVersion",
  "inputHash",
  "inputExcerpt",
  "outputExcerpt",
  "intent",
  "vehicleContext",
  "decision",
  "reasonCodes",
  "proposedToolCall",
  "toolExecution",
  "assessment",
  "privacy",
]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function boundedText(value, maximum = 300) {
  const redacted = redactReviewText(value).replace(/\s+/gu, " ").trim();
  return [...redacted].length <= maximum ? redacted : `${[...redacted].slice(0, maximum).join("")}…`;
}

function sanitizeValue(value, key = "", depth = 0) {
  if (SENSITIVE_KEY.test(key) && !["inputHash", "inputExcerpt", "outputExcerpt"].includes(key)) return "[REDACTED]";
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return boundedText(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (depth >= 5) return "[OMITTED]";
  if (Array.isArray(value)) return value.slice(0, 30).map(entry => sanitizeValue(entry, key, depth + 1));
  if (!isPlainObject(value)) return null;
  return Object.fromEntries(Object.entries(value).slice(0, 50).map(([entryKey, entry]) => [
    boundedText(entryKey, 64) || "field",
    sanitizeValue(entry, entryKey, depth + 1),
  ]));
}

function assertNoSensitiveData(value, path = "record", depth = 0) {
  if (depth > 7) throw new Error("review record exceeds the inspection depth limit");
  if (typeof value === "string") {
    if (reviewTextContainsSensitiveData(value)) throw new Error(`review record still contains sensitive data at ${path}`);
    return;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) assertNoSensitiveData(value[index], `${path}[${index}]`, depth + 1);
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, entry] of Object.entries(value)) assertNoSensitiveData(entry, `${path}.${key}`, depth + 1);
}

export function sanitizeReviewRecord(record) {
  if (!isPlainObject(record)) throw new TypeError("review record must be an object");
  const sanitized = {};
  for (const key of ROOT_KEYS) {
    if (Object.hasOwn(record, key)) sanitized[key] = sanitizeValue(record[key], key);
  }
  sanitized.reportVersion = Number.isInteger(record.reportVersion) ? record.reportVersion : 1;
  sanitized.reviewId = boundedText(record.reviewId, 120);
  sanitized.createdAt = boundedText(record.createdAt, 60);
  sanitized.status = ALLOWED_STATUS.has(record.status) ? record.status : "pending";
  sanitized.priority = ["P0", "P1", "P2"].includes(record.priority) ? record.priority : "P1";
  sanitized.caseId = boundedText(record.caseId, 100);
  sanitized.decision = ["allow", "confirm", "block", "manual_review"].includes(record.decision)
    ? record.decision
    : "manual_review";
  sanitized.privacy = { redacted: true, rawTextStored: false };
  if (!sanitized.reviewId || !sanitized.caseId) throw new TypeError("review record is missing identifiers");
  // The store does not trust the report builder. Every value is redacted here
  // and then independently inspected before it can reach disk.
  assertNoSensitiveData(sanitized);
  return sanitized;
}

export function createEvaluationReviewStore({
  filePath,
  maxRecords = DEFAULT_MAX_RECORDS,
  maxFileBytes = DEFAULT_MAX_FILE_BYTES,
} = {}) {
  if (!filePath || typeof filePath !== "string") throw new TypeError("review filePath is required");
  const capacity = Math.min(1_000, Math.max(1, Number(maxRecords) || DEFAULT_MAX_RECORDS));
  let writeChain = Promise.resolve();

  async function readRecords() {
    let source;
    try {
      source = await readFile(filePath);
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
    if (source.byteLength > maxFileBytes) throw new Error("Human-review queue exceeds the local size limit");
    let parsed;
    try {
      parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(source));
    } catch {
      throw new Error("Human-review queue is not valid UTF-8 JSON");
    }
    if (!Array.isArray(parsed)) throw new Error("Human-review queue must be an array");
    return parsed.slice(-capacity).map(sanitizeReviewRecord);
  }

  async function list({ limit = 50 } = {}) {
    const boundedLimit = Math.min(capacity, Math.max(1, Number(limit) || 50));
    const records = await readRecords();
    return records.slice(-boundedLimit).reverse();
  }

  async function count() {
    return (await readRecords()).length;
  }

  function append(record) {
    const sanitized = sanitizeReviewRecord(record);
    const operation = writeChain.then(async () => {
      const records = await readRecords();
      const next = [...records, sanitized].slice(-capacity);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      return { report: structuredClone(sanitized), queueSize: next.length };
    });
    writeChain = operation.catch(() => {});
    return operation;
  }

  return Object.freeze({ append, count, list });
}

export const EVALUATION_REVIEW_LIMITS = Object.freeze({
  maxRecords: DEFAULT_MAX_RECORDS,
  maxFileBytes: DEFAULT_MAX_FILE_BYTES,
});
