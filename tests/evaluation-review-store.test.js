import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  createEvaluationReviewStore,
  sanitizeReviewRecord,
} from "../lib/evaluation-review-store.js";

function rawRecord(id, overrides = {}) {
  return {
    reportVersion: 1,
    reviewId: id,
    createdAt: "2026-09-02T08:00:00.000Z",
    status: "pending",
    priority: "P0",
    datasetVersion: "desktop-pet-eval-v1",
    caseId: "pet_v1_022",
    traceId: `trace-${id}`,
    modelVersion: "local-model",
    policyVersion: "desktop-pet-action-policy/1.0.0",
    inputHash: "a".repeat(64),
    inputExcerpt: "把文件移入回收站",
    outputExcerpt: "尚未执行",
    intent: { domain: "desktop_pet_action", action: "trash", target: "file" },
    petContext: { requestSource: "chat", path: "C:\\Users\\Example\\secret.txt" },
    decision: "block",
    reasonCodes: ["TRUSTED_HOST_GESTURE_REQUIRED"],
    proposedToolCall: { name: "desktop_pet.trash_selected_file", arguments: { authorization: "Bearer hidden-token" } },
    toolExecution: { attempted: true, executed: true, receipt: "browser-claim" },
    assessment: { passed: false, criticalFailure: true, score: 65 },
    privacy: { redacted: false, rawTextStored: true },
    ignoredRootSecret: "password=must-not-survive",
    ...overrides,
  };
}

test("本地人工复核记录只接受白名单字段并强制脱敏", () => {
  const sanitized = sanitizeReviewRecord(rawRecord("review-1", {
    inputExcerpt: "联系 test@example.com，token=hidden-value，路径 C:\\Users\\Example\\private.txt",
    outputExcerpt: "手机号 13800138000",
  }));
  const serialized = JSON.stringify(sanitized);

  assert.equal(Object.hasOwn(sanitized, "ignoredRootSecret"), false);
  assert.deepEqual(sanitized.privacy, { redacted: true, rawTextStored: false, localOnly: true });
  assert.deepEqual(sanitized.toolExecution, { attempted: true, verified: false });
  assert.equal(sanitized.petContext.path, "[REDACTED]");
  assert.equal(sanitized.proposedToolCall.arguments.authorization, "[REDACTED]");
  assert.doesNotMatch(serialized, /test@example\.com|hidden-value|13800138000|Users|private\.txt|must-not-survive|browser-claim|executed/iu);
});

test("复核队列写入本机文件、限制容量并按最新优先返回", async t => {
  const root = await mkdtemp(join(tmpdir(), "desktop-pet-review-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const filePath = join(root, "data", "evaluation-review-queue.local.json");
  const store = createEvaluationReviewStore({ filePath, maxRecords: 2 });

  await Promise.all([
    store.append(rawRecord("review-1")),
    store.append(rawRecord("review-2")),
    store.append(rawRecord("review-3")),
  ]);

  assert.equal(await store.count(), 2);
  const records = await store.list({ limit: 20 });
  assert.deepEqual(records.map(record => record.reviewId), ["review-3", "review-2"]);
  assert.ok(records.every(record => JSON.stringify(record.toolExecution) === JSON.stringify({ attempted: true, verified: false })));
  const stored = await readFile(filePath, "utf8");
  assert.doesNotMatch(stored, /Users|hidden-token|must-not-survive|browser-claim|"executed"/iu);
  assert.match(stored, /"localOnly": true/u);
});

test("损坏或超限的本地复核队列失败关闭", async t => {
  const root = await mkdtemp(join(tmpdir(), "desktop-pet-review-invalid-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const filePath = join(root, "queue.json");
  const store = createEvaluationReviewStore({ filePath, maxFileBytes: 32 });

  await writeFile(filePath, "not-json", "utf8");
  await assert.rejects(store.list(), /not valid UTF-8 JSON/u);
  await writeFile(filePath, "[" + " ".repeat(64) + "]", "utf8");
  await assert.rejects(store.count(), /exceeds the local size limit/u);
});
