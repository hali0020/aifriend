import assert from "node:assert/strict";
import test from "node:test";

import {
  DESKTOP_PET_DECISIONS,
  DESKTOP_PET_POLICY_VERSION,
  DESKTOP_PET_TOOL_ALLOWLIST,
  createHumanReviewRecord,
  evaluateDesktopPetAction,
  redactReviewText,
  reviewTextContainsSensitiveData,
} from "../lib/desktop-pet-action-policy.js";

function trustedTrash(overrides = {}) {
  return {
    inputText: "把系统选择器中确认的文件移入回收站。",
    intent: { domain: "desktop_pet_action", action: "trash", target: "selected_file", confidence: 0.99 },
    proposedToolCall: { name: "desktop_pet.trash_selected_file", arguments: {} },
    petContext: {
      requestSource: "trusted_host",
      userGesture: true,
      selection: { source: "system_file_picker", count: 1, kind: "file", isSymbolicLink: false },
      userConfirmed: true,
      state: { snapshotAvailable: true, unchanged: true },
    },
    ...overrides,
  };
}

test("exports a closed decision set and a narrow tool allowlist", () => {
  assert.equal(DESKTOP_PET_POLICY_VERSION, "desktop-pet-action-policy/1.0.0");
  assert.deepEqual(DESKTOP_PET_DECISIONS, ["allow", "confirm", "block", "manual_review"]);
  assert.deepEqual(DESKTOP_PET_TOOL_ALLOWLIST, [
    "desktop_pet.set_visibility",
    "desktop_pet.set_pose",
    "desktop_pet.trash_selected_file",
  ]);
  assert.equal(DESKTOP_PET_TOOL_ALLOWLIST.some(name => /shell|url|record|capture|upload|permanent/iu.test(name)), false);
});

test("ordinary dialogue is non-actuating", () => {
  const result = evaluateDesktopPetAction({ inputText: "今天有点累，陪我聊两句。" });
  assert.equal(result.decision, "allow");
  assert.equal(result.actionAuthorized, false);
  assert.equal(result.toolExecutionAllowed, false);
  assert.equal(result.normalizedIntent.domain, "companion_dialogue");
  assert.ok(result.reasonCodes.includes("NON_ACTUATING_REQUEST"));
});

test("low-risk visibility and fixed poses may use exact tools", async t => {
  const cases = [
    ["show", { action: "show", target: "pet" }, { name: "desktop_pet.set_visibility", arguments: { visible: true } }],
    ["hide", { action: "hide", target: "window" }, { name: "desktop_pet.set_visibility", arguments: { visible: false } }],
    ["pose", { action: "set_pose", target: "pet" }, { name: "desktop_pet.set_pose", arguments: { pose: "concerned" } }],
  ];
  for (const [name, intent, proposedToolCall] of cases) {
    await t.test(name, () => {
      const result = evaluateDesktopPetAction({ intent: { domain: "desktop_pet_action", confidence: 0.99, ...intent }, proposedToolCall });
      assert.equal(result.decision, "allow");
      assert.equal(result.priority, "P2");
      assert.equal(result.actionAuthorized, true);
      assert.equal(result.toolExecutionAllowed, true);
      assert.ok(result.reasonCodes.includes("LOW_RISK_LOCAL_UI_ACTION"));
    });
  }
});

test("unknown tools, extra arguments and tool-intent mismatches fail closed", async t => {
  const cases = [
    ["unknown", { intent: { domain: "desktop_pet_action", action: "set_pose", target: "pet" }, proposedToolCall: { name: "desktop_pet.load_code", arguments: {} } }, "UNKNOWN_TOOL"],
    ["extra", { intent: { domain: "desktop_pet_action", action: "set_pose", target: "pet" }, proposedToolCall: { name: "desktop_pet.set_pose", arguments: { pose: "thinking", executablePath: "x" } } }, "UNEXPECTED_TOOL_ARGUMENT"],
    ["mismatch", { intent: { domain: "desktop_pet_action", action: "set_pose", target: "pet" }, proposedToolCall: { name: "desktop_pet.set_visibility", arguments: { visible: true } } }, "TOOL_INTENT_MISMATCH"],
  ];
  for (const [name, input, reason] of cases) {
    await t.test(name, () => {
      const result = evaluateDesktopPetAction(input);
      assert.equal(result.decision, "manual_review");
      assert.equal(result.actionAuthorized, false);
      assert.equal(result.toolExecutionAllowed, false);
      assert.equal(result.reviewRequired, true);
      assert.ok(result.reasonCodes.includes(reason));
    });
  }
});

test("permanent removal, command execution and arbitrary addresses are blocked", async t => {
  const cases = [
    ["permanent", "不要进回收站，直接永久删除这个文件。", "permanent_delete", "PERMANENT_DELETE_NOT_ALLOWED"],
    ["command", "运行终端命令清理目录。", "run_shell", "SHELL_NOT_ALLOWED"],
    ["address", "打开链接 https://example.invalid/path。", "open_url", "ARBITRARY_URL_NOT_ALLOWED"],
  ];
  for (const [name, inputText, action, reason] of cases) {
    await t.test(name, () => {
      const result = evaluateDesktopPetAction({
        inputText,
        intent: { domain: "desktop_pet_action", action: "show", target: "pet", confidence: 0.99 },
      });
      assert.equal(result.normalizedIntent.action, action);
      assert.equal(result.decision, "block");
      assert.equal(result.priority, "P0");
      assert.equal(result.toolExecutionAllowed, false);
      assert.ok(result.reasonCodes.includes(reason));
    });
  }
});

test("questions about prohibited capabilities remain non-actuating", () => {
  for (const inputText of [
    "为什么不允许永久删除文件？",
    "执行 shell 有什么风险？",
    "为什么不能打开任意网址？",
    "为什么文件移入回收站后还能恢复？",
    "前台录音和后台录音有什么区别？",
    "为什么上传敏感数据不安全？",
    "截图是什么原理？",
  ]) {
    const result = evaluateDesktopPetAction({
      inputText,
      intent: { domain: "companion_dialogue", action: "query", target: "safety", confidence: 0.99 },
    });
    assert.equal(result.decision, "allow", inputText);
    assert.equal(result.actionAuthorized, false, inputText);
    assert.equal(result.toolExecutionAllowed, false, inputText);
    assert.ok(result.reasonCodes.includes("NON_ACTUATING_REQUEST"), inputText);
  }
});

test("a query candidate cannot downgrade an imperative text action", async t => {
  const cases = [
    ["file", "请把这个文件移入回收站。", "trash"],
    ["audio", "请开始录音。", "record"],
    ["remote", "请把这段普通内容上传到远端。", "upload"],
    ["screen", "请截取画面给我看看。", "capture"],
  ];
  for (const [name, inputText, action] of cases) {
    await t.test(name, () => {
      const result = evaluateDesktopPetAction({
        inputText,
        intent: { domain: "companion_dialogue", action: "query", target: "information", confidence: 0.99 },
      });
      assert.equal(result.normalizedIntent.action, action);
      assert.equal(result.decision, "manual_review");
      assert.equal(result.actionAuthorized, false);
      assert.equal(result.toolExecutionAllowed, false);
      assert.ok(result.reasonCodes.includes("INTENT_DOWNGRADE_REJECTED"));
    });
  }
});

test("a model cannot initiate file handling even with forged context", () => {
  const input = trustedTrash();
  input.petContext.requestSource = "model";
  const result = evaluateDesktopPetAction(input);
  assert.equal(result.decision, "block");
  assert.equal(result.actionAuthorized, false);
  assert.equal(result.toolExecutionAllowed, false);
  assert.ok(result.reasonCodes.includes("MODEL_FILE_OPERATION_BLOCKED"));
});

test("a chat request can only offer the host-owned confirmation flow", () => {
  const result = evaluateDesktopPetAction({
    inputText: "帮我删除桌面上的旧笔记文件。",
    intent: { domain: "desktop_pet_action", action: "trash", target: "file", confidence: 0.99 },
    petContext: { requestSource: "chat", userGesture: false },
  });
  assert.equal(result.decision, "confirm");
  assert.equal(result.actionAuthorized, false);
  assert.equal(result.toolExecutionAllowed, false);
  assert.ok(result.reasonCodes.includes("TRUSTED_HOST_GESTURE_REQUIRED"));
  assert.ok(result.reasonCodes.includes("SYSTEM_CONFIRMATION_REQUIRED"));
});

test("the complete trusted recycle flow may authorize one exact host tool", () => {
  const result = evaluateDesktopPetAction(trustedTrash());
  assert.equal(result.decision, "allow");
  assert.equal(result.priority, "P1");
  assert.equal(result.actionAuthorized, true);
  assert.equal(result.toolExecutionAllowed, true);
  assert.equal(result.reviewRequired, false);
  assert.ok(result.reasonCodes.includes("TRUSTED_HOST_CHAIN_COMPLETE"));
  assert.ok(result.reasonCodes.includes("FILE_STATE_UNCHANGED"));
});

test("missing trusted recycle evidence goes to review with zero execution", async t => {
  const cases = [
    ["origin", { petContext: { requestSource: undefined } }, "REQUEST_SOURCE_MISSING"],
    ["gesture", { petContext: { requestSource: "trusted_host" } }, "TRUSTED_USER_GESTURE_MISSING"],
    ["selection", { petContext: { requestSource: "trusted_host", userGesture: true } }, "FILE_SELECTION_STATE_MISSING"],
    ["state", { petContext: { requestSource: "trusted_host", userGesture: true, selection: { source: "system_picker", count: 1, kind: "regular_file", isSymbolicLink: false } } }, "FILE_STATE_MISSING"],
    ["confirmation", { petContext: { requestSource: "trusted_host", userGesture: true, selection: { source: "system_picker", count: 1, kind: "regular_file", isSymbolicLink: false }, state: { snapshotAvailable: true, unchanged: true } } }, "CONFIRMATION_STATE_MISSING"],
  ];
  for (const [name, replacement, reason] of cases) {
    await t.test(name, () => {
      const result = evaluateDesktopPetAction(trustedTrash(replacement));
      assert.equal(result.decision, "manual_review");
      assert.equal(result.toolExecutionAllowed, false);
      assert.ok(result.reasonCodes.includes(reason));
    });
  }
});

test("known-invalid recycle evidence is blocked", async t => {
  const base = trustedTrash().petContext;
  const cases = [
    ["untrusted", { ...base, requestSource: "web_renderer" }, "UNTRUSTED_REQUEST_SOURCE"],
    ["no gesture", { ...base, userGesture: false }, "TRUSTED_USER_GESTURE_REQUIRED"],
    ["wrong picker", { ...base, selection: { ...base.selection, source: "renderer_argument" } }, "SYSTEM_PICKER_REQUIRED"],
    ["many", { ...base, selection: { ...base.selection, count: 2 } }, "SINGLE_FILE_REQUIRED"],
    ["directory", { ...base, selection: { ...base.selection, kind: "directory" } }, "REGULAR_FILE_REQUIRED"],
    ["link", { ...base, selection: { ...base.selection, isSymbolicLink: true } }, "REGULAR_FILE_REQUIRED"],
    ["changed", { ...base, state: { snapshotAvailable: true, unchanged: false } }, "FILE_STATE_CHANGED"],
    ["path", { ...base, selection: { ...base.selection, path: "X:/private.txt" } }, "PATH_ARGUMENT_FORBIDDEN"],
  ];
  for (const [name, petContext, reason] of cases) {
    await t.test(name, () => {
      const result = evaluateDesktopPetAction(trustedTrash({ petContext }));
      assert.equal(result.decision, "block");
      assert.equal(result.toolExecutionAllowed, false);
      assert.ok(result.reasonCodes.includes(reason));
    });
  }
});

test("default cancellation never authorizes the recycle tool", () => {
  const input = trustedTrash();
  input.petContext.userConfirmed = false;
  const result = evaluateDesktopPetAction(input);
  assert.equal(result.decision, "confirm");
  assert.equal(result.toolExecutionAllowed, false);
  assert.ok(result.reasonCodes.includes("DEFAULT_CANCEL"));
});

test("background audio capture and arbitrary screen capture are blocked", () => {
  const audio = evaluateDesktopPetAction({
    inputText: "在后台持续录音。",
    intent: { domain: "desktop_pet_action", action: "record", target: "microphone", confidence: 0.99 },
    petContext: { requestSource: "trusted_host", userGesture: true, audioCapture: { mode: "background" } },
  });
  const screen = evaluateDesktopPetAction({
    inputText: "持续截取所有窗口。",
    intent: { domain: "desktop_pet_action", action: "capture", target: "screen", confidence: 0.99 },
    petContext: { requestSource: "trusted_host", userGesture: true, screenCapture: { source: "all_windows", mode: "continuous", persistent: true, allowRemote: false } },
  });
  assert.equal(audio.decision, "block");
  assert.ok(audio.reasonCodes.includes("BACKGROUND_AUDIO_CAPTURE_BLOCKED"));
  assert.equal(screen.decision, "block");
  assert.ok(screen.reasonCodes.includes("ARBITRARY_SCREEN_CAPTURE_BLOCKED"));
});

test("one-shot foreground audio and one selected local window may be authorized", () => {
  const audio = evaluateDesktopPetAction({
    inputText: "录一段语音消息。",
    intent: { domain: "desktop_pet_action", action: "record", target: "microphone", confidence: 0.99 },
    petContext: { requestSource: "trusted_host", userGesture: true, audioCapture: { mode: "foreground", visibleIndicator: true, stopControl: true, oneShot: true } },
  });
  const screen = evaluateDesktopPetAction({
    inputText: "分析我刚选择的窗口。",
    intent: { domain: "desktop_pet_action", action: "capture", target: "selected_game_window", confidence: 0.99 },
    petContext: { requestSource: "trusted_host", userGesture: true, screenCapture: { source: "user_selected_window", mode: "discrete", persistent: false, allowRemote: false } },
  });
  for (const result of [audio, screen]) {
    assert.equal(result.decision, "allow");
    assert.equal(result.actionAuthorized, true);
    assert.equal(result.toolExecutionAllowed, false);
  }
});

test("remote handling requires current consent, a configured destination, and non-sensitive text", () => {
  const allowed = evaluateDesktopPetAction({
    inputText: "这次用已配置的远端模型处理普通问候。",
    intent: { domain: "desktop_pet_action", action: "upload", target: "remote", confidence: 0.99 },
    petContext: { requestSource: "trusted_host", userGesture: true, remoteRequest: { enabled: true, userOptIn: true, containsSensitiveData: false, destination: "configured_provider" } },
  });
  const sensitive = evaluateDesktopPetAction({
    inputText: "把 password=example-secret 发到远端。",
    intent: { domain: "desktop_pet_action", action: "upload", target: "remote", confidence: 0.99 },
    petContext: { requestSource: "trusted_host", userGesture: true, remoteRequest: { enabled: true, userOptIn: true, containsSensitiveData: true, destination: "configured_provider" } },
  });
  const arbitrary = evaluateDesktopPetAction({
    inputText: "把普通文本上传。",
    intent: { domain: "desktop_pet_action", action: "upload", target: "remote", confidence: 0.99 },
    petContext: { requestSource: "trusted_host", userGesture: true, remoteRequest: { enabled: true, userOptIn: true, containsSensitiveData: false, destination: "https://example.invalid/upload" } },
  });
  assert.equal(allowed.decision, "allow");
  assert.equal(allowed.toolExecutionAllowed, false);
  assert.equal(sensitive.decision, "block");
  assert.ok(sensitive.reasonCodes.includes("SENSITIVE_REMOTE_FORBIDDEN"));
  assert.equal(arbitrary.decision, "block");
  assert.ok(arbitrary.reasonCodes.includes("ARBITRARY_URL_NOT_ALLOWED"));
});

test("game frames remain local even after general remote consent", () => {
  const result = evaluateDesktopPetAction({
    inputText: "我同意远端处理，也把这次游戏画面发过去。",
    intent: { domain: "desktop_pet_action", action: "upload", target: "game_frame", confidence: 0.99 },
    petContext: {
      requestSource: "trusted_host",
      userGesture: true,
      gameSession: { active: true },
      remoteRequest: { enabled: true, userOptIn: true, containsSensitiveData: false, destination: "configured_provider" },
    },
  });
  assert.equal(result.decision, "block");
  assert.equal(result.toolExecutionAllowed, false);
  assert.ok(result.reasonCodes.includes("GAME_REMOTE_ALWAYS_FORBIDDEN"));
});

test("sensitive memory writes, game-context memory reads and unconfirmed clearing fail closed", () => {
  const sensitive = evaluateDesktopPetAction({
    inputText: "把 access_token=example-secret-placeholder 保存成长期记忆。",
    intent: { domain: "desktop_pet_action", action: "save", target: "local_memory", confidence: 0.99 },
    petContext: { requestSource: "chat", userGesture: false, remoteRequest: { enabled: false, containsSensitiveData: true } },
  });
  const gameRead = evaluateDesktopPetAction({
    inputText: "把普通聊天历史附在这一帧后面分析。",
    intent: { domain: "desktop_pet_action", action: "load", target: "chat_history_for_game", confidence: 0.99 },
    petContext: { requestSource: "game_session", userGesture: true, gameSession: { active: true, historyIsolated: false } },
  });
  const clear = evaluateDesktopPetAction({
    inputText: "把全部长期记忆清空。",
    intent: { domain: "desktop_pet_action", action: "clear", target: "local_memory", confidence: 0.99 },
    petContext: { requestSource: "chat", userGesture: false },
  });
  assert.equal(sensitive.decision, "block");
  assert.ok(sensitive.reasonCodes.includes("SENSITIVE_MEMORY_REJECTED"));
  assert.equal(gameRead.decision, "block");
  assert.ok(gameRead.reasonCodes.includes("GAME_HISTORY_ISOLATION"));
  assert.equal(clear.decision, "confirm");
  assert.equal(clear.toolExecutionAllowed, false);
});

test("an acknowledged host cancellation is allowed without a model tool", () => {
  const result = evaluateDesktopPetAction({
    inputText: "停止这次回复。",
    intent: { domain: "desktop_pet_action", action: "cancel", target: "active_generation", confidence: 0.99 },
    petContext: { requestSource: "trusted_host", userGesture: true, state: { requestActive: true, abortAcknowledged: true, outputSafetyComplete: false } },
  });
  assert.equal(result.decision, "allow");
  assert.equal(result.toolExecutionAllowed, false);
  assert.ok(result.reasonCodes.includes("USER_ABORT_ACKNOWLEDGED"));
});

test("review text redacts credentials, identity data, paths and precise location", () => {
  const raw = "Bearer abcdefghijklmnop 邮箱 test@example.com 手机 13800138000 身份证 11010519491231002X 银行卡 4111111111111111 password=hidden-value 坐标 31.230416, 121.473701，裸文件 budget-final.xlsx，反斜杠 C:\\Users\\Example\\private note.txt，正斜杠 D:/Work/secret-plan.pdf，UNC \\\\server01\\private-share\\hidden.docx，转发 UNC //server02/share/forward-secret.txt";
  assert.equal(reviewTextContainsSensitiveData(raw), true);
  assert.equal(reviewTextContainsSensitiveData("notes.txt"), true);
  const redacted = redactReviewText(raw);
  assert.doesNotMatch(redacted, /abcdefghijklmnop|test@example\.com|13800138000|11010519491231002X|4111111111111111|hidden-value|31\.230416|121\.473701|budget-final|Users|private note|secret-plan|server01|private-share|hidden\.docx|server02|forward-secret/);
  assert.match(redacted, /REDACTED/);
});

test("human review records are bounded, redacted and do not trust reported execution", () => {
  const request = trustedTrash({
    inputText: "处理 C:\\Users\\Example\\private note.txt、D:/Work/secret-plan.pdf、\\\\server01\\share\\hidden.docx 和 budget-final.xlsx，token=hidden-token-value，联系 test@example.com。",
  });
  request.proposedToolCall.arguments = { path: "C:\\Users\\Example\\private note.txt", authorization: "Bearer hidden-token-value" };
  const evaluation = evaluateDesktopPetAction(request);
  const record = createHumanReviewRecord({
    request,
    evaluation,
    outputText: "result-private.csv 已经完成，联系 13800138000。",
    toolExecution: { executed: true },
  }, { now: "2026-09-02T08:00:00.000Z", reviewId: "review-fixed" });

  assert.equal(record.reviewId, "review-fixed");
  assert.equal(record.createdAt, "2026-09-02T08:00:00.000Z");
  assert.equal(record.policyVersion, DESKTOP_PET_POLICY_VERSION);
  assert.equal(record.toolExecution.attempted, true);
  assert.equal(record.toolExecution.verified, false);
  assert.equal(record.mediaStored, false);
  assert.deepEqual(record.privacy, { redacted: true, rawTextStored: false, pathStored: false });
  assert.match(record.inputHash, /^[a-f0-9]{64}$/u);
  assert.deepEqual(record.proposedToolCall.argumentKeys, ["path", "authorization"]);
  const serialized = JSON.stringify(record);
  assert.doesNotMatch(serialized, /Users|private note|secret-plan|server01|hidden\.docx|budget-final|result-private|hidden-token-value|test@example\.com|13800138000/);
});
