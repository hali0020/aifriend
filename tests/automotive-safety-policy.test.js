import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTOMOTIVE_POLICY_VERSION,
  AUTOMOTIVE_TOOL_ALLOWLIST,
  createHumanReviewRecord,
  evaluateAutomotiveAction,
  redactReviewText,
} from "../lib/automotive-safety-policy.js";

const movingContext = Object.freeze({
  speedKph: 42,
  gear: "D",
  parkBrake: false,
  doorsLocked: true,
  childLock: true,
  stateFreshnessMs: 120,
  stateConflict: false,
  occupantRole: "driver",
});

const parkedContext = Object.freeze({
  speedKph: 0,
  gear: "P",
  parkBrake: true,
  doorsLocked: true,
  childLock: true,
  stateFreshnessMs: 80,
  stateConflict: false,
  occupantRole: "driver",
});

function actionRequest({ action, target, position = "driver", context = movingContext, args = {} }) {
  return {
    inputText: `${action} ${target}`,
    intent: { domain: "vehicle_control", action, target, position, confidence: 0.98 },
    vehicleContext: context,
    proposedToolCall: { name: "vehicle.control", arguments: { action, target, position, ...args } },
  };
}

test("moving vehicle door request is understood but independently blocked from execution", () => {
  const result = evaluateAutomotiveAction(actionRequest({ action: "open", target: "door" }));

  assert.equal(result.policyVersion, AUTOMOTIVE_POLICY_VERSION);
  assert.equal(result.intentUnderstood, true);
  assert.equal(result.normalizedIntent.action, "open");
  assert.equal(result.normalizedIntent.target, "door");
  assert.equal(result.decision, "block");
  assert.equal(result.priority, "P0");
  assert.equal(result.actionAuthorized, false);
  assert.equal(result.toolExecutionAllowed, false);
  assert.equal(result.reviewRequired, true);
  assert.ok(result.reasonCodes.includes("VEHICLE_MOVING"));
  assert.ok(result.reasonCodes.includes("MOVING_DOOR_OPERATION_BLOCKED"));
  assert.ok(result.reasonCodes.includes("TOOL_BLOCKED_BY_POLICY"));
});

test("moving vehicle blocks trunk opening and door unlocking", () => {
  const trunk = evaluateAutomotiveAction(actionRequest({ action: "open", target: "trunk" }));
  const unlock = evaluateAutomotiveAction(actionRequest({ action: "unlock", target: "door" }));

  assert.equal(trunk.decision, "block");
  assert.equal(trunk.priority, "P0");
  assert.ok(trunk.reasonCodes.includes("MOVING_TRUNK_OPERATION_BLOCKED"));
  assert.equal(unlock.decision, "block");
  assert.equal(unlock.toolExecutionAllowed, false);
  assert.ok(unlock.reasonCodes.includes("MOVING_DOOR_UNLOCK_BLOCKED"));
});

test("parked door opening needs confirmation, then permits the same bounded tool call", () => {
  const request = actionRequest({ action: "open", target: "door", context: parkedContext });
  const beforeConfirmation = evaluateAutomotiveAction(request);
  const afterConfirmation = evaluateAutomotiveAction({ ...request, userConfirmed: true });

  assert.equal(beforeConfirmation.decision, "confirm");
  assert.equal(beforeConfirmation.priority, "P1");
  assert.equal(beforeConfirmation.actionAuthorized, false);
  assert.equal(beforeConfirmation.toolExecutionAllowed, false);
  assert.ok(beforeConfirmation.reasonCodes.includes("USER_CONFIRMATION_REQUIRED"));
  assert.equal(afterConfirmation.decision, "allow");
  assert.equal(afterConfirmation.actionAuthorized, true);
  assert.equal(afterConfirmation.toolExecutionAllowed, true);
});

test("high-risk actions fail closed when critical state is missing, stale, or conflicting", async (t) => {
  const variants = [
    ["missing", { ...parkedContext, speedKph: undefined }, "CRITICAL_STATE_MISSING"],
    ["stale", { ...parkedContext, stateFreshnessMs: 5_001 }, "VEHICLE_STATE_STALE"],
    ["conflicting", { ...parkedContext, stateConflict: true }, "VEHICLE_STATE_CONFLICT"],
  ];

  for (const [name, context, reason] of variants) {
    await t.test(name, () => {
      const result = evaluateAutomotiveAction(actionRequest({ action: "open", target: "door", context }));
      assert.equal(result.decision, "manual_review");
      assert.equal(result.intentUnderstood, true);
      assert.equal(result.priority, "P0");
      assert.equal(result.actionAuthorized, false);
      assert.equal(result.toolExecutionAllowed, false);
      assert.equal(result.reviewRequired, true);
      assert.ok(result.reasonCodes.includes(reason));
    });
  }
});

test("an observed positive speed keeps the safer moving block even if gear conflicts", () => {
  const context = { ...movingContext, gear: "P", stateConflict: true };
  const result = evaluateAutomotiveAction(actionRequest({ action: "open", target: "door", context }));
  assert.equal(result.decision, "block");
  assert.ok(result.reasonCodes.includes("VEHICLE_MOVING"));
});

test("safe reversible climate settings are allowed only inside deterministic bounds", () => {
  const safe = evaluateAutomotiveAction(
    actionRequest({ action: "set", target: "climate", args: { temperature: 22 } }),
  );
  const unsafe = evaluateAutomotiveAction(
    actionRequest({ action: "set", target: "climate", args: { temperature: 45 } }),
  );

  assert.equal(safe.decision, "allow");
  assert.equal(safe.priority, "P2");
  assert.equal(safe.toolExecutionAllowed, true);
  assert.ok(safe.reasonCodes.includes("SAFE_REVERSIBLE_ACTION"));
  assert.equal(unsafe.decision, "block");
  assert.equal(unsafe.priority, "P1");
  assert.equal(unsafe.reviewRequired, false);
  assert.equal(unsafe.toolExecutionAllowed, false);
  assert.ok(unsafe.reasonCodes.includes("TEMPERATURE_OUT_OF_RANGE"));
});

test("driver seat movement and driver-area video are blocked while moving", () => {
  const seat = evaluateAutomotiveAction(
    actionRequest({ action: "adjust", target: "seat", position: "driver", args: { reclinePercent: 80 } }),
  );
  const video = evaluateAutomotiveAction(actionRequest({ action: "play", target: "video", position: "center" }));

  assert.equal(seat.decision, "block");
  assert.ok(seat.reasonCodes.includes("DRIVER_SEAT_MOVEMENT_BLOCKED"));
  assert.equal(video.decision, "block");
  assert.ok(video.reasonCodes.includes("DRIVER_DISTRACTION_BLOCKED"));
});

test("moving video may execute only for an explicitly identified passenger display", () => {
  const passengerContext = { ...movingContext, occupantRole: "passenger" };
  const passengerVideo = evaluateAutomotiveAction(
    actionRequest({ action: "play", target: "video", position: "front_passenger", context: passengerContext }),
  );
  const unspecifiedVideo = evaluateAutomotiveAction(
    actionRequest({ action: "play", target: "video", position: "unknown", context: passengerContext }),
  );

  assert.equal(passengerVideo.decision, "allow");
  assert.equal(passengerVideo.toolExecutionAllowed, true);
  assert.ok(passengerVideo.reasonCodes.includes("PASSENGER_DISPLAY_ONLY"));
  assert.equal(unspecifiedVideo.decision, "block");
  assert.equal(unspecifiedVideo.toolExecutionAllowed, false);
});

test("child and guest roles cannot change protected locks", () => {
  for (const occupantRole of ["child", "guest", "passenger"]) {
    const context = { ...parkedContext, occupantRole, childLock: true };
    const result = evaluateAutomotiveAction(
      actionRequest({ action: "disable", target: "child_lock", position: "rear_left", context, args: { enabled: false } }),
    );
    assert.equal(result.decision, "block");
    assert.equal(result.priority, "P0");
    assert.ok(result.reasonCodes.includes("OCCUPANT_NOT_AUTHORIZED"));
    assert.ok(result.reasonCodes.includes("CHILD_LOCK_PROTECTED"));
  }
});

test("duplicate calls and already-achieved state are idempotent no-ops", () => {
  const duplicate = evaluateAutomotiveAction({
    ...actionRequest({ action: "close", target: "window", args: { percent: 0 } }),
    duplicateRequest: true,
  });
  const alreadyLocked = evaluateAutomotiveAction(
    actionRequest({ action: "lock", target: "door", context: parkedContext }),
  );

  assert.equal(duplicate.decision, "allow");
  assert.equal(duplicate.toolExecutionAllowed, false);
  assert.ok(duplicate.reasonCodes.includes("DUPLICATE_REQUEST"));
  assert.ok(duplicate.reasonCodes.includes("IDEMPOTENT_NO_OP"));
  assert.equal(alreadyLocked.decision, "allow");
  assert.equal(alreadyLocked.toolExecutionAllowed, false);
  assert.ok(alreadyLocked.reasonCodes.includes("ALREADY_IN_DESIRED_STATE"));
});

test("high-speed large window opening requires confirmation while a small opening remains reversible", () => {
  const highSpeedContext = { ...movingContext, speedKph: 110 };
  const large = evaluateAutomotiveAction(
    actionRequest({ action: "set", target: "window", context: highSpeedContext, args: { percent: 80 } }),
  );
  const small = evaluateAutomotiveAction(
    actionRequest({ action: "set", target: "window", context: highSpeedContext, args: { percent: 20 } }),
  );

  assert.equal(large.decision, "confirm");
  assert.equal(large.priority, "P1");
  assert.equal(large.toolExecutionAllowed, false);
  assert.ok(large.reasonCodes.includes("HIGH_SPEED_WINDOW_CHANGE"));
  assert.equal(small.decision, "allow");
  assert.equal(small.toolExecutionAllowed, true);
});

test("knowledge questions never actuate a vehicle control", () => {
  const result = evaluateAutomotiveAction({
    inputText: "车辆行驶中打开车门为什么危险？",
    vehicleContext: movingContext,
  });

  assert.equal(result.intentUnderstood, true);
  assert.equal(result.normalizedIntent.action, "open");
  assert.equal(result.normalizedIntent.target, "door");
  assert.equal(result.normalizedIntent.isActionRequest, false);
  assert.equal(result.decision, "allow");
  assert.equal(result.actionAuthorized, false);
  assert.equal(result.toolExecutionAllowed, false);
  assert.ok(result.reasonCodes.includes("NON_ACTUATING_REQUEST"));
});

test("low-confidence intent and tool-intent mismatches are sent to manual review", () => {
  const lowConfidence = evaluateAutomotiveAction({
    ...actionRequest({ action: "open", target: "door", context: parkedContext }),
    intent: { domain: "vehicle_control", action: "open", target: "door", confidence: 0.3 },
  });
  const mismatch = evaluateAutomotiveAction({
    ...actionRequest({ action: "set", target: "climate", args: { temperature: 22 } }),
    proposedToolCall: { name: "vehicle.open_door", arguments: { position: "driver" } },
  });

  assert.equal(lowConfidence.decision, "manual_review");
  assert.equal(lowConfidence.intentUnderstood, false);
  assert.ok(lowConfidence.reasonCodes.includes("LOW_INTENT_CONFIDENCE"));
  assert.equal(mismatch.decision, "manual_review");
  assert.ok(mismatch.reasonCodes.includes("TOOL_INTENT_MISMATCH"));
  assert.equal(mismatch.toolExecutionAllowed, false);
});

test("only explicitly registered tools can ever reach the execution boundary", () => {
  assert.ok(AUTOMOTIVE_TOOL_ALLOWLIST.includes("climate.set_temperature"));
  assert.ok(AUTOMOTIVE_TOOL_ALLOWLIST.includes("vehicle.set_window"));
  assert.equal(AUTOMOTIVE_TOOL_ALLOWLIST.includes("shell.delete_file"), false);

  const unknown = evaluateAutomotiveAction({
    ...actionRequest({ action: "set", target: "climate", args: { temperature: 22 } }),
    proposedToolCall: {
      name: "shell.delete_file",
      arguments: { action: "set", target: "climate", position: "driver", temperature: 22 },
    },
  });
  const smuggledArgument = evaluateAutomotiveAction({
    ...actionRequest({ action: "set", target: "climate", args: { temperature: 22 } }),
    proposedToolCall: {
      name: "vehicle.control",
      arguments: { action: "set", target: "climate", position: "driver", temperature: 22, path: "C:/secret" },
    },
  });

  for (const result of [unknown, smuggledArgument]) {
    assert.equal(result.decision, "manual_review");
    assert.equal(result.actionAuthorized, false);
    assert.equal(result.toolExecutionAllowed, false);
    assert.ok(result.reasonCodes.includes("INVALID_TOOL_CALL"));
  }
  assert.ok(unknown.reasonCodes.includes("UNKNOWN_TOOL"));
  assert.ok(smuggledArgument.reasonCodes.includes("UNEXPECTED_TOOL_ARGUMENT"));
});

test("tool display and seat positions must match the authorized intent", () => {
  const passengerContext = { ...movingContext, occupantRole: "passenger" };
  const displaySpoof = evaluateAutomotiveAction({
    inputText: "在副驾驶乘客屏播放视频。",
    intent: { domain: "vehicle_control", action: "play", target: "video", position: "front_passenger", confidence: 0.99 },
    vehicleContext: passengerContext,
    proposedToolCall: { name: "media.play_video", arguments: { display: "center", source: "local_selection" } },
  });
  const seatSpoof = evaluateAutomotiveAction({
    inputText: "副驾驶座椅向后调整 2 厘米。",
    intent: { domain: "vehicle_control", action: "adjust", target: "seat", position: "front_passenger", confidence: 0.99 },
    vehicleContext: movingContext,
    proposedToolCall: { name: "vehicle.adjust_seat", arguments: { position: "driver", axis: "fore_aft", deltaMm: -20 } },
  });

  for (const result of [displaySpoof, seatSpoof]) {
    assert.equal(result.decision, "manual_review");
    assert.equal(result.toolExecutionAllowed, false);
    assert.ok(result.reasonCodes.includes("TOOL_INTENT_MISMATCH"));
    assert.ok(result.reasonCodes.includes("TOOL_POSITION_MISMATCH"));
  }
});

test("numeric tool parameters must be typed, bounded, and agree with the request", () => {
  const mismatched = evaluateAutomotiveAction({
    inputText: "副驾驶车窗降到 20%。",
    intent: { domain: "vehicle_control", action: "set", target: "window", position: "front_passenger", confidence: 0.99 },
    vehicleContext: movingContext,
    proposedToolCall: { name: "vehicle.set_window", arguments: { position: "front_passenger", openPercent: 80 } },
  });
  const wrongType = evaluateAutomotiveAction({
    inputText: "主驾温度调到 22 度。",
    intent: { domain: "vehicle_control", action: "set", target: "climate", position: "driver", confidence: 0.99 },
    vehicleContext: movingContext,
    proposedToolCall: { name: "climate.set_temperature", arguments: { zone: "driver", celsius: "22" } },
  });

  assert.equal(mismatched.decision, "manual_review");
  assert.ok(mismatched.reasonCodes.includes("TOOL_NUMERIC_ARGUMENT_MISMATCH"));
  assert.equal(mismatched.toolExecutionAllowed, false);
  assert.equal(wrongType.decision, "manual_review");
  assert.ok(wrongType.reasonCodes.includes("TOOL_NUMERIC_ARGUMENT_REQUIRED"));
  assert.equal(wrongType.toolExecutionAllowed, false);
});

test("registered tools with canonical arguments preserve legitimate controls", () => {
  const climate = evaluateAutomotiveAction({
    inputText: "主驾温度调到 22 度。",
    intent: { domain: "vehicle_control", action: "set", target: "climate", position: "driver", confidence: 0.99 },
    vehicleContext: movingContext,
    proposedToolCall: { name: "climate.set_temperature", arguments: { zone: "driver", celsius: 22 } },
  });
  const video = evaluateAutomotiveAction({
    inputText: "在副驾驶乘客屏播放已下载的视频。",
    intent: { domain: "vehicle_control", action: "play", target: "video", position: "front_passenger", confidence: 0.99 },
    vehicleContext: { ...movingContext, occupantRole: "passenger" },
    proposedToolCall: { name: "media.play_video", arguments: { display: "front_passenger", source: "local_selection" } },
  });

  assert.equal(climate.decision, "allow");
  assert.equal(climate.toolExecutionAllowed, true);
  assert.equal(video.decision, "allow");
  assert.equal(video.toolExecutionAllowed, true);
});

test("review text redacts credentials, identity data, payment cards, private keys, and precise location", () => {
  const raw = "Bearer abcdefghijklmnop 邮箱 test@example.com 手机 13800138000 VIN LDC613P23A1305189 身份证 11010519491231002X 银行卡 4111111111111111 password is hunter2secret 坐标 31.230416, 121.473701 -----BEGIN PRIVATE KEY----- AAAABBBBCCCCDDDDEEEEFFFF -----END PRIVATE KEY-----";
  const redacted = redactReviewText(raw);
  assert.doesNotMatch(redacted, /abcdefghijklmnop|test@example\.com|13800138000|LDC613P23A1305189|11010519491231002X|4111111111111111|hunter2secret|31\.230416|121\.473701|AAAABBBBCCCC/);
  assert.match(redacted, /REDACTED_TOKEN/);
  assert.match(redacted, /REDACTED_EMAIL/);
  assert.match(redacted, /REDACTED_PHONE/);
  assert.match(redacted, /REDACTED_VIN/);
  assert.match(redacted, /REDACTED_ID_NUMBER/);
  assert.match(redacted, /REDACTED_PAYMENT_CARD/);
  assert.match(redacted, /REDACTED_CREDENTIAL/);
  assert.match(redacted, /REDACTED_PRIVATE_KEY/);
  assert.match(redacted, /REDACTED_PRECISE_LOCATION/);
});

test("human review records contain a stable hash and sanitized evidence, never raw sensitive text", () => {
  const request = {
    ...actionRequest({ action: "open", target: "door" }),
    inputText: "打开车门，token=super-secret-value，联系 test@example.com，位置 31.230416, 121.473701",
    traceId: "trace-vehicle-001",
  };
  request.proposedToolCall.arguments.authorization = "Bearer raw-secret-token";
  const evaluation = evaluateAutomotiveAction(request);
  const record = createHumanReviewRecord(
    {
      request,
      evaluation,
      outputText: "已经打开。联系电话 13800138000",
      modelVersion: "local-test-model",
      caseId: "AUTO-SAFE-001",
      toolExecution: { attempted: true, executed: false },
    },
    { now: "2026-09-02T08:00:00.000Z", reviewId: "review-fixed" },
  );

  assert.equal(record.reviewId, "review-fixed");
  assert.equal(record.createdAt, "2026-09-02T08:00:00.000Z");
  assert.equal(record.status, "pending");
  assert.equal(record.priority, "P0");
  assert.equal(record.policyVersion, AUTOMOTIVE_POLICY_VERSION);
  assert.equal(record.decision, "block");
  assert.equal(record.toolExecution.attempted, true);
  assert.equal(record.toolExecution.executed, false);
  assert.equal(record.privacy.redacted, true);
  assert.equal(record.privacy.rawTextStored, false);
  assert.match(record.inputHash, /^[a-f0-9]{64}$/);
  assert.equal(record.proposedToolCall.arguments.authorization, "[REDACTED]");

  const serialized = JSON.stringify(record);
  assert.doesNotMatch(serialized, /super-secret-value|test@example\.com|13800138000|31\.230416|121\.473701|raw-secret-token/);
  assert.match(serialized, /REDACTED/);
});
