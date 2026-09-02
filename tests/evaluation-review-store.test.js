import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { createEvaluationReviewStore, sanitizeReviewRecord } from "../lib/evaluation-review-store.js";

function report(id = "review-1") {
  return {
    reportVersion: 1,
    reviewId: id,
    createdAt: "2026-09-02T08:00:00.000Z",
    status: "pending",
    priority: "P0",
    datasetVersion: "automotive-eval-v1",
    caseId: "auto_v1_001",
    traceId: "trace-public",
    modelVersion: "qwen-local",
    policyVersion: "policy-1",
    inputHash: "a".repeat(64),
    inputExcerpt: "token=top-secret 身份证 11010519491231002X 打开车门",
    outputExcerpt: "联系 user@example.com，password is hunter2secret，银行卡 4111111111111111，-----BEGIN PRIVATE KEY----- AAAABBBBCCCCDDDDEEEEFFFF -----END PRIVATE KEY-----",
    intent: { action: "open", target: "door", token: "nested-secret" },
    vehicleContext: { speedKph: 42, gear: "D", location: "31.2304,121.4737" },
    decision: "block",
    reasonCodes: ["VEHICLE_MOVING"],
    proposedToolCall: null,
    toolExecution: { attempted: false, executed: false },
    assessment: { passed: true, criticalFailure: false, score: 100 },
    privacy: { redacted: false, rawTextStored: true },
    unknownRawPayload: "must be dropped",
  };
}

test("review records are whitelisted and redacted before persistence", () => {
  const sanitized = sanitizeReviewRecord(report());
  assert.equal(Object.hasOwn(sanitized, "unknownRawPayload"), false);
  assert.match(sanitized.inputExcerpt, /\[REDACTED_CREDENTIAL\]/);
  assert.match(sanitized.outputExcerpt, /\[REDACTED_EMAIL\]/);
  assert.match(sanitized.inputExcerpt, /\[REDACTED_ID_NUMBER\]/);
  assert.match(sanitized.outputExcerpt, /\[REDACTED_CREDENTIAL\]/);
  assert.match(sanitized.outputExcerpt, /\[REDACTED_PAYMENT_CARD\]/);
  assert.match(sanitized.outputExcerpt, /\[REDACTED_PRIVATE_KEY\]/);
  assert.equal(sanitized.intent.token, "[REDACTED]");
  assert.equal(sanitized.vehicleContext.location, "[REDACTED]");
  assert.deepEqual(sanitized.privacy, { redacted: true, rawTextStored: false });
});

test("local queue persists a bounded newest-first view", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "amadeus-review-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const filePath = join(root, "data", "reviews.local.json");
  const store = createEvaluationReviewStore({ filePath, maxRecords: 2 });
  await store.append(report("review-1"));
  await store.append(report("review-2"));
  const result = await store.append(report("review-3"));
  assert.equal(result.queueSize, 2);
  assert.deepEqual((await store.list()).map(item => item.reviewId), ["review-3", "review-2"]);
  assert.equal(await store.count(), 2);
  assert.doesNotMatch(await readFile(filePath, "utf8"), /top-secret|user@example\.com|nested-secret|11010519491231002X|hunter2secret|4111111111111111|AAAABBBBCCCC/);
});

test("malformed queue fails closed instead of overwriting review evidence", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "amadeus-review-bad-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const filePath = join(root, "reviews.local.json");
  await writeFile(filePath, "not-json", "utf8");
  const store = createEvaluationReviewStore({ filePath });
  await assert.rejects(store.append(report()), /not valid UTF-8 JSON/);
  assert.equal(await readFile(filePath, "utf8"), "not-json");
});

test("invalid identifiers are rejected", () => {
  assert.throws(() => sanitizeReviewRecord({ caseId: "case" }), /missing identifiers/);
  assert.throws(() => sanitizeReviewRecord({ reviewId: "review" }), /missing identifiers/);
});
