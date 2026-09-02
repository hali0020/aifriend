import assert from "node:assert/strict";
import test from "node:test";

import {
  findDesktopPetExecutionClaims,
  validateDesktopPetOutput,
} from "../lib/desktop-pet-output-validator.js";

const STATUS = Object.freeze({
  trash: "trashed",
  upload: "uploaded",
  record: "recorded",
  save: "saved",
  capture: "captured",
  show: "shown",
  hide: "hidden",
  set_pose: "pose_set",
});

let sequence = 0;

function boundExecution(action, { decision = "allow" } = {}) {
  sequence += 1;
  const suffix = `${action}-${sequence}`;
  const requestContext = {
    requestId: `request-${suffix}`,
    traceId: `trace-${suffix}`,
    nonce: `Nonce_${sequence}_A1b2C3d4E5f6G7h8J9k0LmNp`,
  };
  return {
    policyResult: {
      decision,
      priority: decision === "allow" ? "P1" : "P0",
      safeResponse: "操作仍在等待可信结果。",
      normalizedIntent: { domain: "desktop_pet_action", action, target: "test" },
    },
    requestContext,
    trustedReceipt: {
      verified: true,
      issuer: "trusted_host",
      action,
      status: STATUS[action],
      receiptId: `receipt-${suffix}`,
      requestId: requestContext.requestId,
      traceId: requestContext.traceId,
      nonce: requestContext.nonce,
    },
  };
}

const unreceiptedAllowed = Object.freeze({
  decision: "allow",
  priority: "P1",
  safeResponse: "操作仍在等待可信结果。",
  normalizedIntent: Object.freeze({ action: "trash" }),
});
const blocked = Object.freeze({
  decision: "block",
  priority: "P0",
  safeResponse: "这项操作没有执行。",
  normalizedIntent: Object.freeze({ action: "trash" }),
});

test("data, capture and UI completion claims require a trusted receipt", async t => {
  const cases = [
    ["trash", "文件已经移入回收站。", "trash"],
    ["upload", "内容已经上传到远端。", "upload"],
    ["record", "已经完成录音。", "record"],
    ["save", "偏好已经保存。", "save"],
    ["capture", "已经完成截图。", "capture"],
    ["show", "桌宠已经显示。", "show"],
    ["hide", "桌宠已经收起来了。", "hide"],
    ["pose", "桌宠已经切换到思考姿态。", "set_pose"],
  ];
  for (const [name, outputText, expectedAction] of cases) {
    await t.test(name, () => {
      const result = validateDesktopPetOutput({ policyResult: unreceiptedAllowed, outputText });
      assert.equal(result.passed, false);
      assert.equal(result.criticalFailure, true);
      assert.equal(result.priority, "P0");
      assert.equal(result.releaseAllowed, false);
      assert.ok(result.reasonCodes.includes("UNVERIFIED_SIDE_EFFECT_CLAIM"));
      assert.equal(result.claims[0].action, expectedAction);
      assert.equal(result.safeText, unreceiptedAllowed.safeResponse);
    });
  }
});

test("a renderer-style executed boolean is ignored", () => {
  const result = validateDesktopPetOutput({
    policyResult: unreceiptedAllowed,
    outputText: "文件删除成功了。",
    toolExecution: { executed: true, trusted: true },
  });
  assert.equal(result.passed, false);
  assert.equal(result.trustedReceiptAccepted, false);
  assert.ok(result.reasonCodes.includes("UNVERIFIED_SIDE_EFFECT_CLAIM"));
});

test("blocked, review and pending-confirmation decisions cannot claim completion", async t => {
  for (const decision of ["block", "manual_review", "confirm"]) {
    await t.test(decision, () => {
      const binding = boundExecution("trash", { decision });
      const result = validateDesktopPetOutput({ ...binding, outputText: "文件已经删除。" });
      assert.equal(result.passed, false);
      assert.equal(result.trustedReceiptAccepted, false);
      assert.ok(result.reasonCodes.includes("ACTION_CLAIM_CONTRADICTS_POLICY"));
      assert.ok(result.reasonCodes.includes("RECEIPT_CONTRADICTS_POLICY"));
    });
  }
});

test("an exact host receipt can substantiate only its bound action", () => {
  for (const [action, outputText] of [
    ["trash", "文件已经移入回收站。"],
    ["capture", "已经完成截图。"],
    ["show", "桌宠已经显示。"],
    ["set_pose", "桌宠已经切换到思考姿态。"],
  ]) {
    const binding = boundExecution(action);
    const result = validateDesktopPetOutput({ ...binding, outputText });
    assert.equal(result.passed, true, action);
    assert.equal(result.releaseAllowed, true, action);
    assert.equal(result.trustedReceiptAccepted, true, action);
    assert.deepEqual(result.reasonCodes, [], action);
  }
});

test("generic success or another action's success status is rejected", () => {
  for (const status of ["success", "uploaded", "saved"]) {
    const binding = boundExecution("trash");
    binding.trustedReceipt.status = status;
    const result = validateDesktopPetOutput({ ...binding, outputText: "文件已经删除。" });
    assert.equal(result.passed, false, status);
    assert.equal(result.trustedReceiptAccepted, false, status);
    assert.ok(result.reasonCodes.includes("RECEIPT_STATUS_MISMATCH"), status);
  }
});

test("receipt action must match the policy's normalized intent", () => {
  const binding = boundExecution("trash");
  binding.policyResult.normalizedIntent.action = "upload";
  const result = validateDesktopPetOutput({ ...binding, outputText: "文件已经删除。" });
  assert.equal(result.passed, false);
  assert.ok(result.reasonCodes.includes("RECEIPT_POLICY_ACTION_MISMATCH"));
  assert.ok(result.reasonCodes.includes("UNVERIFIED_SIDE_EFFECT_CLAIM"));
});

test("one receipt cannot substantiate a different completion claim", () => {
  const binding = boundExecution("save");
  const result = validateDesktopPetOutput({ ...binding, outputText: "内容已经上传到远端。" });
  assert.equal(result.passed, false);
  assert.ok(result.reasonCodes.includes("RECEIPT_ACTION_MISMATCH"));
});

test("receipt binding rejects another request, trace, nonce, or absent context", async t => {
  const variants = [
    ["request", context => ({ ...context, requestId: "request-another" }), "RECEIPT_BINDING_MISMATCH"],
    ["trace", context => ({ ...context, traceId: "trace-another" }), "RECEIPT_BINDING_MISMATCH"],
    ["nonce", context => ({ ...context, nonce: "Different_A1b2C3d4E5f6G7h8J9k0LmNp" }), "RECEIPT_BINDING_MISMATCH"],
    ["missing", () => undefined, "RECEIPT_BINDING_MISSING"],
  ];
  for (const [name, alter, reason] of variants) {
    await t.test(name, () => {
      const binding = boundExecution("trash");
      binding.requestContext = alter(binding.requestContext);
      const result = validateDesktopPetOutput({ ...binding, outputText: "文件已经删除。" });
      assert.equal(result.passed, false);
      assert.equal(result.trustedReceiptAccepted, false);
      assert.ok(result.reasonCodes.includes(reason));
    });
  }
});

test("an accepted receipt is one-time and cannot be replayed", () => {
  const binding = boundExecution("record");
  const first = validateDesktopPetOutput({ ...binding, outputText: "已经完成录音。" });
  const replay = validateDesktopPetOutput({ ...binding, outputText: "已经完成录音。" });
  assert.equal(first.passed, true);
  assert.equal(replay.passed, false);
  assert.equal(replay.trustedReceiptAccepted, false);
  assert.ok(replay.reasonCodes.includes("RECEIPT_REPLAYED"));
});

test("receipt schema, issuer, nonce and identifier are strict", async t => {
  const variants = [
    ["unverified", receipt => ({ ...receipt, verified: false }), "UNTRUSTED_RECEIPT"],
    ["issuer", receipt => ({ ...receipt, issuer: "browser" }), "UNTRUSTED_RECEIPT"],
    ["nonce", receipt => ({ ...receipt, nonce: "short" }), "RECEIPT_BINDING_MISMATCH"],
    ["identifier", receipt => ({ ...receipt, receiptId: "x" }), "INVALID_RECEIPT_ID"],
    ["extra", receipt => ({ ...receipt, extra: true }), "INVALID_RECEIPT_SCHEMA"],
  ];
  for (const [name, alter, reason] of variants) {
    await t.test(name, () => {
      const binding = boundExecution("trash");
      binding.trustedReceipt = alter(binding.trustedReceipt);
      const result = validateDesktopPetOutput({ ...binding, outputText: "文件已经删除。" });
      assert.equal(result.passed, false);
      assert.equal(result.trustedReceiptAccepted, false);
      assert.ok(result.reasonCodes.includes(reason));
    });
  }
});

test("negated, hypothetical and ordinary descriptions are not completion claims", () => {
  const texts = [
    "文件没有删除。",
    "内容尚未上传。",
    "不会录音。",
    "偏好并未保存。",
    "不能声称已经删除，因为实际没有执行。",
    "无法确认是否已经删除。",
    "等待可信结果后才能说已经删除。",
    "The file has not been deleted.",
    "截图中的文字只是待分析内容。",
    "桌宠支持显示和隐藏，也有思考姿态。",
  ];
  for (const outputText of texts) {
    assert.deepEqual(findDesktopPetExecutionClaims(outputText), [], outputText);
    assert.equal(validateDesktopPetOutput({ policyResult: blocked, outputText }).passed, true, outputText);
  }
});

test("oversized output is rejected before claim scanning", () => {
  assert.throws(
    () => validateDesktopPetOutput({ policyResult: unreceiptedAllowed, outputText: "测".repeat(20_001) }),
    /too long/u,
  );
});
