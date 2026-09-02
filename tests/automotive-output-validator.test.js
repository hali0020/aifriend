import assert from "node:assert/strict";
import test from "node:test";

import { findAutomotiveExecutionClaims, validateAutomotiveOutput } from "../lib/automotive-output-validator.js";

const blocked = {
  decision: "block",
  priority: "P0",
  safeResponse: "车辆正在行驶，车门不会打开。",
};

test("blocked action cannot claim successful execution", () => {
  const result = validateAutomotiveOutput({ policyResult: blocked, outputText: "好的，已经为你打开车门。", toolExecution: { executed: false } });
  assert.equal(result.passed, false);
  assert.equal(result.releaseAllowed, false);
  assert.ok(result.reasonCodes.includes("BLOCKED_ACTION_CLAIMED_SUCCESS"));
  assert.equal(result.safeText, blocked.safeResponse);
});

test("safe refusal is not mistaken for an execution claim", () => {
  for (const text of ["车辆正在行驶，车门不会打开。", "车门尚未打开。", "不能说已经打开，实际没有执行。", "The door has not been opened."]) {
    assert.deepEqual(findAutomotiveExecutionClaims(text), [], text);
    assert.equal(validateAutomotiveOutput({ policyResult: blocked, outputText: text, toolExecution: { executed: false } }).passed, true);
  }
});

test("confirmation does not authorize a success claim", () => {
  const result = validateAutomotiveOutput({
    policyResult: { decision: "confirm", priority: "P1", safeResponse: "明确确认后才会执行。" },
    outputText: "已经打开好了。",
    toolExecution: { executed: false },
  });
  assert.equal(result.criticalFailure, true);
  assert.ok(result.reasonCodes.includes("UNCONFIRMED_ACTION_CLAIMED_SUCCESS"));
});

test("verified allowed execution may be described", () => {
  const result = validateAutomotiveOutput({
    policyResult: { decision: "allow", priority: "P2", safeResponse: "" },
    outputText: "空调已经设置为 22 度。",
    toolExecution: { executed: true },
  });
  assert.equal(result.passed, true);
  assert.equal(result.releaseAllowed, true);
});

test("unverified success claim fails even for an allowed policy", () => {
  const result = validateAutomotiveOutput({
    policyResult: { decision: "allow", priority: "P2", safeResponse: "请求符合安全边界，可以执行。" },
    outputText: "空调已经设置为 22 度。",
    toolExecution: { executed: false },
  });
  assert.equal(result.passed, false);
  assert.ok(result.reasonCodes.includes("UNVERIFIED_EXECUTION_CLAIM"));
});
