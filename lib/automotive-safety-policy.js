import { createHash } from "node:crypto";

/**
 * Deterministic policy for vehicle actions.
 *
 * This module deliberately does not call a model, a vehicle API, the network,
 * or a persistence layer. Intent recognition and action authorization are
 * separate outputs: understanding a request never implies that it is safe to
 * execute.
 */

export const AUTOMOTIVE_POLICY_VERSION = "automotive-action-policy/1.0.0";
export const AUTOMOTIVE_DECISIONS = Object.freeze(["allow", "confirm", "block", "manual_review"]);
export const VEHICLE_STATE_MAX_AGE_MS = 5_000;

const TOOL_DEFINITIONS = Object.freeze({
  "vehicle.control": Object.freeze({ kind: "generic", allowedKeys: ["action", "target", "position", "temperature", "degrees", "celsius", "percent", "openPercent", "value", "enabled", "locked", "open", "axis", "deltaMm", "reclinePercent", "source", "mediaType"] }),
  "vehicle.open_door": Object.freeze({ action: "open", target: "door", positionKey: "position", requirePosition: true, allowedKeys: ["position"] }),
  "vehicle.close_door": Object.freeze({ action: "close", target: "door", positionKey: "position", requirePosition: true, allowedKeys: ["position"] }),
  "vehicle.unlock_doors": Object.freeze({ action: "unlock", target: "door", positionKey: "position", requirePosition: true, allowedKeys: ["position"] }),
  "vehicle.lock_doors": Object.freeze({ action: "lock", target: "door", positionKey: "position", requirePosition: true, allowedKeys: ["position"] }),
  "vehicle.open_trunk": Object.freeze({ action: "open", target: "trunk", fixedPosition: "rear", allowedKeys: [] }),
  "vehicle.close_trunk": Object.freeze({ action: "close", target: "trunk", fixedPosition: "rear", allowedKeys: [] }),
  "vehicle.set_child_lock": Object.freeze({ target: "child_lock", positionKey: "position", booleanActionKey: "enabled", requirePosition: true, allowedKeys: ["position", "enabled"] }),
  "vehicle.set_window": Object.freeze({ action: "set", target: "window", positionKey: "position", numericKey: "openPercent", requirePosition: true, allowedKeys: ["position", "openPercent"] }),
  "vehicle.adjust_seat": Object.freeze({ action: "adjust", target: "seat", positionKey: "position", requirePosition: true, allowedKeys: ["position", "axis", "deltaMm", "reclinePercent"] }),
  "vehicle.set_hazard_lights": Object.freeze({ target: "hazard_lights", fixedPosition: "all", booleanActionKey: "enabled", allowedKeys: ["enabled"] }),
  "vehicle.set_wipers": Object.freeze({ action: "set", target: "wipers", positionKey: "position", requirePosition: true, allowedKeys: ["position", "mode"] }),
  "vehicle.set_lights": Object.freeze({ fixedPosition: "front", targetKey: "type", booleanActionKey: "enabled", allowedKeys: ["type", "enabled"] }),
  "climate.set_temperature": Object.freeze({ action: "set", target: "climate", positionKey: "zone", numericKey: "celsius", requirePosition: true, allowedKeys: ["zone", "celsius"] }),
  "climate.set_defrost": Object.freeze({ target: "front_defrost", positionKey: "zone", booleanActionKey: "enabled", requirePosition: true, allowedKeys: ["zone", "enabled"] }),
  "media.play_video": Object.freeze({ action: "play", target: "video", positionKey: "display", requirePosition: true, allowedKeys: ["display", "source", "mediaType"] }),
  "media.resume": Object.freeze({ action: "play", target: "media", fixedPosition: "all", allowedKeys: ["source"] }),
});

/** Exact tool identifiers that the deterministic policy understands. */
export const AUTOMOTIVE_TOOL_ALLOWLIST = Object.freeze(Object.keys(TOOL_DEFINITIONS));

const ACTION_ALIASES = new Map([
  ["open", "open"],
  ["打开", "open"],
  ["开启", "open"],
  ["close", "close"],
  ["关闭", "close"],
  ["unlock", "unlock"],
  ["解锁", "unlock"],
  ["lock", "lock"],
  ["锁定", "lock"],
  ["上锁", "lock"],
  ["set", "set"],
  ["设置", "set"],
  ["adjust", "adjust"],
  ["调节", "adjust"],
  ["调整", "adjust"],
  ["enable", "enable"],
  ["启用", "enable"],
  ["disable", "disable"],
  ["禁用", "disable"],
  ["关闭功能", "disable"],
  ["play", "play"],
  ["播放", "play"],
  ["query", "query"],
  ["ask", "query"],
  ["explain", "query"],
  ["查询", "query"],
  ["询问", "query"],
  ["解释", "query"],
]);

const TARGET_ALIASES = new Map([
  ["door", "door"],
  ["doors", "door"],
  ["driver_door", "door"],
  ["passenger_door", "door"],
  ["left_rear_door", "door"],
  ["right_rear_door", "door"],
  ["车门", "door"],
  ["trunk", "trunk"],
  ["tailgate", "trunk"],
  ["boot", "trunk"],
  ["后备箱", "trunk"],
  ["尾门", "trunk"],
  ["window", "window"],
  ["windows", "window"],
  ["车窗", "window"],
  ["seat", "seat"],
  ["seats", "seat"],
  ["driver_seat", "seat"],
  ["座椅", "seat"],
  ["child_lock", "child_lock"],
  ["childlock", "child_lock"],
  ["儿童锁", "child_lock"],
  ["video", "video"],
  ["movie", "video"],
  ["driver_display", "video"],
  ["center_display", "video"],
  ["passenger_display", "video"],
  ["视频", "video"],
  ["影片", "video"],
  ["climate", "climate"],
  ["temperature", "climate"],
  ["air_conditioning", "climate"],
  ["空调", "climate"],
  ["温度", "climate"],
  ["media", "media"],
  ["music", "media"],
  ["音乐", "media"],
  ["front_defrost", "front_defrost"],
  ["defrost", "front_defrost"],
  ["前挡除雾", "front_defrost"],
  ["hazard_lights", "hazard_lights"],
  ["危险警示灯", "hazard_lights"],
  ["wipers", "wipers"],
  ["wiper", "wipers"],
  ["雨刷", "wipers"],
  ["low_beam", "low_beam"],
  ["近光灯", "low_beam"],
  ["high_beam", "high_beam"],
  ["远光灯", "high_beam"],
  ["sunroof", "sunroof"],
  ["天窗", "sunroof"],
]);

const POSITION_ALIASES = new Map([
  ["driver", "driver"],
  ["驾驶位", "driver"],
  ["主驾", "driver"],
  ["front_left", "driver"],
  ["passenger", "front_passenger"],
  ["front_passenger", "front_passenger"],
  ["副驾", "front_passenger"],
  ["rear_left", "rear_left"],
  ["left_rear", "rear_left"],
  ["左后", "rear_left"],
  ["rear_right", "rear_right"],
  ["right_rear", "rear_right"],
  ["右后", "rear_right"],
  ["center", "center"],
  ["中控", "center"],
  ["driver_display", "driver"],
  ["center_display", "center"],
  ["front", "front"],
  ["前部", "front"],
  ["rear", "rear"],
  ["后部", "rear"],
  ["roof", "roof"],
  ["车顶", "roof"],
  ["unspecified", "unknown"],
  ["all", "all"],
  ["全部", "all"],
]);

const ACTION_REQUESTS = new Set(["open", "close", "unlock", "lock", "set", "adjust", "enable", "disable", "play"]);
const AUTHORIZED_PRIMARY_ROLES = new Set(["driver", "owner"]);
const KNOWN_ROLES = new Set(["driver", "owner", "passenger", "child", "guest"]);

function cleanEnum(value) {
  if (typeof value !== "string") return "";
  return value.normalize("NFKC").trim().toLowerCase().replace(/[\s-]+/gu, "_").slice(0, 80);
}

function finiteNumber(value, minimum = -Infinity) {
  if (value === "" || value === null || value === undefined || typeof value === "boolean") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum ? number : null;
}

function strictBoolean(value) {
  return typeof value === "boolean" ? value : null;
}

function normalizeAction(value) {
  const cleaned = cleanEnum(value);
  return ACTION_ALIASES.get(cleaned) ?? "unknown";
}

function normalizeTarget(value) {
  const cleaned = cleanEnum(value);
  return TARGET_ALIASES.get(cleaned) ?? "unknown";
}

function inferPositionFromTarget(value) {
  const cleaned = cleanEnum(value);
  if (cleaned.includes("driver") || cleaned.includes("主驾")) return "driver";
  if (cleaned.includes("passenger") || cleaned.includes("副驾")) return "front_passenger";
  if (cleaned.includes("left_rear") || cleaned.includes("rear_left") || cleaned.includes("左后")) return "rear_left";
  if (cleaned.includes("right_rear") || cleaned.includes("rear_right") || cleaned.includes("右后")) return "rear_right";
  if (cleaned.includes("center") || cleaned.includes("中控")) return "center";
  return "unknown";
}

function normalizePosition(value, rawTarget) {
  const cleaned = cleanEnum(value);
  return POSITION_ALIASES.get(cleaned) ?? inferPositionFromTarget(rawTarget);
}

function inferTextIntent(inputText) {
  const text = typeof inputText === "string" ? inputText.normalize("NFKC").trim() : "";
  if (!text) return { action: "unknown", target: "unknown", position: "unknown", isQuestion: false };

  const isQuestion = /(?:吗|么|是否|能不能|可不可以|安全吗|为什么|原理|是什么|怎么回事|如何避免|\?|？|\b(?:why|what|is it safe|can (?:a|the)|how does)\b)/iu.test(text);
  let action = "unknown";
  if (/(?:打开|开启|\bopen\b)/iu.test(text)) action = "open";
  else if (/(?:关闭|\bclose\b)/iu.test(text)) action = "close";
  else if (/(?:解锁|\bunlock\b)/iu.test(text)) action = "unlock";
  else if (/(?:上锁|锁定|\block\b)/iu.test(text)) action = "lock";
  else if (/(?:禁用|\bdisable\b)/iu.test(text)) action = "disable";
  else if (/(?:启用|\benable\b)/iu.test(text)) action = "enable";
  else if (/(?:播放|\bplay\b)/iu.test(text)) action = "play";
  else if (/(?:设置|调节|调整|\b(?:set|adjust)\b)/iu.test(text)) action = "set";
  else if (isQuestion) action = "query";

  let target = "unknown";
  if (/(?:儿童锁|child[ _-]?lock)/iu.test(text)) target = "child_lock";
  else if (/(?:后备箱|尾门|\b(?:trunk|tailgate|boot)\b)/iu.test(text)) target = "trunk";
  else if (/(?:车门|驾驶门|副驾驶门|[左右]?(?:前|后)门|\bdoors?\b)/iu.test(text)) target = "door";
  else if (/(?:车窗|\bwindows?\b)/iu.test(text)) target = "window";
  else if (/(?:座椅|\bseats?\b|后仰|躺平)/iu.test(text)) target = "seat";
  else if (/(?:视频|影片|\b(?:video|movie)\b)/iu.test(text)) target = "video";
  else if (/(?:空调|温度|\b(?:climate|temperature|air conditioning)\b)/iu.test(text)) target = "climate";
  else if (/(?:音乐|\b(?:music|media)\b)/iu.test(text)) target = "media";

  let position = "unknown";
  if (/(?:主驾|驾驶位|\bdriver\b)/iu.test(text)) position = "driver";
  else if (/(?:副驾|\b(?:front passenger|passenger)\b)/iu.test(text)) position = "front_passenger";
  else if (/(?:左后|\b(?:rear left|left rear)\b)/iu.test(text)) position = "rear_left";
  else if (/(?:右后|\b(?:rear right|right rear)\b)/iu.test(text)) position = "rear_right";
  else if (/(?:中控|\bcenter (?:screen|display)\b)/iu.test(text)) position = "center";

  return { action, target, position, isQuestion };
}

function normalizeIntent(input) {
  const structured = input?.intent && typeof input.intent === "object" && !Array.isArray(input.intent) ? input.intent : {};
  const inferred = inferTextIntent(input?.inputText);
  const explicitAction = normalizeAction(structured.action);
  const explicitTarget = normalizeTarget(structured.target);
  const action = explicitAction !== "unknown" ? explicitAction : inferred.action;
  const target = explicitTarget !== "unknown" ? explicitTarget : inferred.target;
  const explicitPosition = normalizePosition(structured.position, structured.target);
  const position = explicitPosition !== "unknown" ? explicitPosition : inferred.position;
  const confidence = finiteNumber(structured.confidence, 0);
  const boundedConfidence = confidence === null ? null : Math.min(confidence, 1);
  const hasStructuredAction = explicitAction !== "unknown";
  const hasTool = Boolean(input?.proposedToolCall);
  const isActionRequest =
    hasTool ||
    (ACTION_REQUESTS.has(action) && (hasStructuredAction || !inferred.isQuestion));
  const domain = cleanEnum(structured.domain) || (target !== "unknown" ? (isActionRequest ? "vehicle_control" : "vehicle_knowledge") : "general");

  return {
    domain,
    action,
    target,
    position,
    confidence: boundedConfidence,
    isActionRequest,
  };
}

function normalizeVehicleContext(value) {
  const context = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const gearValue = cleanEnum(context.gear).toUpperCase();
  const gearAliases = { PARK: "P", DRIVE: "D", REVERSE: "R", NEUTRAL: "N" };
  const gear = gearAliases[gearValue] ?? (["P", "D", "R", "N"].includes(gearValue) ? gearValue : null);
  const occupantRoleValue = cleanEnum(context.occupantRole);

  return {
    speedKph: finiteNumber(context.speedKph, 0),
    gear,
    parkBrake: strictBoolean(context.parkBrake),
    doorsLocked: strictBoolean(context.doorsLocked),
    childLock: strictBoolean(context.childLock),
    stateFreshnessMs: finiteNumber(context.stateFreshnessMs, 0),
    stateConflict: context.stateConflict === true,
    occupantRole: KNOWN_ROLES.has(occupantRoleValue) ? occupantRoleValue : null,
    currentTemperature: finiteNumber(context.currentTemperature),
    windowOpenPercent: finiteNumber(context.windowOpenPercent, 0),
  };
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function makeResult(intent, overrides) {
  const result = {
    policyVersion: AUTOMOTIVE_POLICY_VERSION,
    intentUnderstood: overrides.intentUnderstood,
    decision: overrides.decision,
    priority: overrides.priority,
    actionAuthorized: overrides.actionAuthorized,
    toolExecutionAllowed: overrides.toolExecutionAllowed,
    reviewRequired: overrides.reviewRequired,
    reasonCodes: unique(overrides.reasonCodes),
    safeResponse: overrides.safeResponse,
    normalizedIntent: intent,
  };

  if (!AUTOMOTIVE_DECISIONS.includes(result.decision)) {
    throw new TypeError("invalid automotive policy decision");
  }
  if (result.decision !== "allow") result.toolExecutionAllowed = false;
  if (!result.actionAuthorized) result.toolExecutionAllowed = false;
  return result;
}

function blocked(intent, reasonCodes, safeResponse, { priority = "P0", reviewRequired = true } = {}) {
  return makeResult(intent, {
    intentUnderstood: true,
    decision: "block",
    priority,
    actionAuthorized: false,
    toolExecutionAllowed: false,
    reviewRequired,
    reasonCodes,
    safeResponse,
  });
}

function manualReview(intent, reasonCodes, safeResponse, priority = "P0", { intentUnderstood = true } = {}) {
  return makeResult(intent, {
    intentUnderstood,
    decision: "manual_review",
    priority,
    actionAuthorized: false,
    toolExecutionAllowed: false,
    reviewRequired: true,
    reasonCodes,
    safeResponse,
  });
}

function confirmation(intent, reasonCodes, safeResponse, priority = "P1") {
  return makeResult(intent, {
    intentUnderstood: true,
    decision: "confirm",
    priority,
    actionAuthorized: false,
    toolExecutionAllowed: false,
    reviewRequired: false,
    reasonCodes,
    safeResponse,
  });
}

function allowed(intent, reasonCodes, safeResponse, { toolExecutionAllowed = false, priority = "P2", actionAuthorized = true } = {}) {
  return makeResult(intent, {
    intentUnderstood: true,
    decision: "allow",
    priority,
    actionAuthorized,
    toolExecutionAllowed,
    reviewRequired: false,
    reasonCodes,
    safeResponse,
  });
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function proposedTool(input) {
  if (!input?.proposedToolCall) return null;
  if (!isPlainObject(input.proposedToolCall)) return { invalid: true, name: "", arguments: null };
  const name = cleanEnum(input.proposedToolCall.name);
  const args = input.proposedToolCall.arguments;
  if (!name || !isPlainObject(args)) return { invalid: true, name, arguments: null };
  const canonical = canonicalizeToolCall(name, args);
  return { invalid: !canonical.valid, name, arguments: args, canonical };
}

function allowedArgumentKeys(args, allowedKeys) {
  const allowed = new Set(allowedKeys);
  return Object.keys(args).every((key) => allowed.has(key));
}

function actionFromBoolean(value) {
  return value === true ? "enable" : value === false ? "disable" : "unknown";
}

function strictToolNumber(args, keys) {
  for (const key of keys) {
    if (!Object.hasOwn(args, key)) continue;
    return typeof args[key] === "number" && Number.isFinite(args[key]) ? args[key] : null;
  }
  return null;
}

function genericActionTargetAllowed(action, target) {
  const pairs = Object.freeze({
    door: new Set(["open", "close", "lock", "unlock"]),
    trunk: new Set(["open", "close", "lock", "unlock"]),
    window: new Set(["open", "close", "set", "adjust"]),
    seat: new Set(["set", "adjust"]),
    child_lock: new Set(["set", "enable", "disable", "lock", "unlock"]),
    video: new Set(["play"]),
    media: new Set(["play"]),
    climate: new Set(["set", "adjust", "enable", "disable"]),
    front_defrost: new Set(["enable", "disable"]),
    hazard_lights: new Set(["enable", "disable"]),
    wipers: new Set(["set", "enable", "disable"]),
    low_beam: new Set(["enable", "disable"]),
    high_beam: new Set(["enable", "disable"]),
  });
  return pairs[target]?.has(action) === true;
}

function canonicalNumericForGeneric(target, args) {
  if (target === "climate") return strictToolNumber(args, ["temperature", "degrees", "celsius", "value"]);
  if (target === "window") return strictToolNumber(args, ["openPercent", "percent", "value"]);
  if (target === "seat") return strictToolNumber(args, ["deltaMm", "reclinePercent", "value"]);
  return null;
}

function canonicalizeToolCall(name, args) {
  if (!Object.hasOwn(TOOL_DEFINITIONS, name)) return { valid: false, reason: "UNKNOWN_TOOL" };
  const definition = TOOL_DEFINITIONS[name];
  if (!allowedArgumentKeys(args, definition.allowedKeys)) return { valid: false, reason: "UNEXPECTED_TOOL_ARGUMENT" };

  if (definition.kind === "generic") {
    const action = normalizeAction(args.action);
    const target = normalizeTarget(args.target);
    const position = normalizePosition(args.position, args.target);
    if (!genericActionTargetAllowed(action, target)) return { valid: false, reason: "INVALID_TOOL_ACTION_TARGET" };
    if (["door", "window", "seat", "video"].includes(target) && position === "unknown") {
      return { valid: false, reason: "TOOL_POSITION_REQUIRED" };
    }
    const numeric = canonicalNumericForGeneric(target, args);
    if (["set", "adjust"].includes(action) && ["climate", "window", "seat"].includes(target) && numeric === null) {
      return { valid: false, reason: "TOOL_NUMERIC_ARGUMENT_REQUIRED" };
    }
    if (target === "child_lock" && !["enabled", "locked", "value"].some((key) => typeof args[key] === "boolean")) {
      return { valid: false, reason: "TOOL_BOOLEAN_ARGUMENT_REQUIRED" };
    }
    return { valid: true, action, target, position, numeric };
  }

  let action = definition.action ?? "unknown";
  let target = definition.target ?? "unknown";
  if (definition.booleanActionKey) {
    action = actionFromBoolean(args[definition.booleanActionKey]);
    if (action === "unknown") return { valid: false, reason: "TOOL_BOOLEAN_ARGUMENT_REQUIRED" };
  }
  if (definition.targetKey) {
    target = normalizeTarget(args[definition.targetKey]);
    if (target === "unknown") return { valid: false, reason: "INVALID_TOOL_TARGET" };
  }
  const position = definition.fixedPosition
    ?? normalizePosition(args[definition.positionKey], target);
  if (definition.requirePosition && position === "unknown") return { valid: false, reason: "TOOL_POSITION_REQUIRED" };
  const numeric = definition.numericKey ? strictToolNumber(args, [definition.numericKey]) : null;
  if (definition.numericKey && numeric === null) return { valid: false, reason: "TOOL_NUMERIC_ARGUMENT_REQUIRED" };

  if (name === "vehicle.adjust_seat") {
    const axis = cleanEnum(args.axis);
    const delta = strictToolNumber(args, ["deltaMm"]);
    const recline = strictToolNumber(args, ["reclinePercent"]);
    if (!["fore_aft", "height", "recline"].includes(axis) || (delta === null && recline === null)) {
      return { valid: false, reason: "INVALID_SEAT_ARGUMENTS" };
    }
  }
  if (name === "vehicle.set_wipers" && !["off", "auto", "low", "high"].includes(cleanEnum(args.mode))) {
    return { valid: false, reason: "INVALID_WIPER_MODE" };
  }

  return { valid: true, action, target, position, numeric };
}

function requestedNumericValue(input, intent) {
  const structured = input?.intent && typeof input.intent === "object" ? input.intent : {};
  for (const key of ["value", "amount", "temperature", "percent", "openPercent", "celsius"]) {
    const value = finiteNumber(structured[key]);
    if (value !== null) return value;
  }
  const text = typeof input?.inputText === "string" ? input.inputText.normalize("NFKC") : "";
  let match = null;
  if (intent.target === "window") match = text.match(/(-?\d+(?:\.\d+)?)\s*(?:%|％|百分比)/u);
  else if (intent.target === "climate") match = text.match(/(-?\d+(?:\.\d+)?)\s*(?:摄氏)?(?:度|°\s*C|℃)/iu);
  else if (intent.target === "seat") {
    match = text.match(/(-?\d+(?:\.\d+)?)\s*(毫米|mm|厘米|cm|度|°)/iu);
    if (match && /厘米|cm/iu.test(match[2])) return Math.abs(Number(match[1]) * 10);
    if (match) return Math.abs(Number(match[1]));
  }
  return match ? Number(match[1]) : null;
}

function toolIntentMismatch(tool, intent, input) {
  if (!tool || tool.invalid) return [];
  const canonical = tool.canonical;
  const reasons = [];
  if (canonical.action !== intent.action) reasons.push("TOOL_ACTION_MISMATCH");
  if (canonical.target !== intent.target) reasons.push("TOOL_TARGET_MISMATCH");
  if (canonical.position !== "unknown") {
    if (intent.position === "unknown" || canonical.position !== intent.position) reasons.push("TOOL_POSITION_MISMATCH");
  }
  const requestedNumeric = requestedNumericValue(input, intent);
  if (requestedNumeric !== null && canonical.numeric !== null) {
    const actual = intent.target === "seat" ? Math.abs(canonical.numeric) : canonical.numeric;
    if (Math.abs(actual - requestedNumeric) > 0.001) reasons.push("TOOL_NUMERIC_ARGUMENT_MISMATCH");
  }
  return unique(reasons);
}

function desiredNumber(args, keys) {
  for (const key of keys) {
    if (Object.hasOwn(args, key)) return finiteNumber(args[key]);
  }
  return null;
}

function desiredBoolean(intent, args) {
  for (const key of ["enabled", "value", "locked", "open"]) {
    if (typeof args[key] === "boolean") return args[key];
  }
  if (intent.action === "enable" || intent.action === "lock" || intent.action === "open") return true;
  if (intent.action === "disable" || intent.action === "unlock" || intent.action === "close") return false;
  return null;
}

function criticalVehicleStateReasons(context) {
  const reasons = [];
  if (context.speedKph === null || context.gear === null || context.parkBrake === null || context.stateFreshnessMs === null) {
    reasons.push("CRITICAL_STATE_MISSING");
  }
  if (context.stateFreshnessMs !== null && context.stateFreshnessMs > VEHICLE_STATE_MAX_AGE_MS) {
    reasons.push("VEHICLE_STATE_STALE");
  }
  if (context.stateConflict || (context.speedKph !== null && context.speedKph > 0 && context.gear === "P")) {
    reasons.push("VEHICLE_STATE_CONFLICT");
  }
  return reasons;
}

function isMoving(context) {
  return context.speedKph !== null && context.speedKph > 0;
}

function isParked(context) {
  return context.speedKph === 0 && context.gear === "P" && context.parkBrake === true;
}

function needsPrimaryAuthorization(intent) {
  if (intent.target === "trunk" || intent.target === "child_lock") return true;
  if (intent.target === "door" && (intent.action === "unlock" || intent.position === "driver" || intent.position === "all")) return true;
  return false;
}

function isUnauthorized(intent, context) {
  const role = context.occupantRole;
  if (!role) return null;
  if (role === "child" || role === "guest") return true;
  if (needsPrimaryAuthorization(intent) && !AUTHORIZED_PRIMARY_ROLES.has(role)) return true;
  if (intent.position === "driver" && role !== "driver" && role !== "owner") return true;
  return false;
}

function isIdempotent(input, intent, context, tool) {
  if (input?.duplicateRequest === true) return "DUPLICATE_REQUEST";
  if (intent.target === "door" && intent.action === "lock" && context.doorsLocked === true) return "ALREADY_IN_DESIRED_STATE";
  if (intent.target === "door" && intent.action === "unlock" && context.doorsLocked === false) return "ALREADY_IN_DESIRED_STATE";
  if (intent.target === "child_lock" && tool && !tool.invalid) {
    const desired = desiredBoolean(intent, tool.arguments);
    if (desired !== null && context.childLock === desired) return "ALREADY_IN_DESIRED_STATE";
  }
  if (intent.target === "climate" && tool && !tool.invalid && context.currentTemperature !== null) {
    const desired = desiredNumber(tool.arguments, ["temperature", "degrees", "value"]);
    if (desired !== null && desired === context.currentTemperature) return "ALREADY_IN_DESIRED_STATE";
  }
  return null;
}

function isPassengerOnlyVideo(intent, context) {
  return context.occupantRole === "passenger" && intent.position === "front_passenger";
}

function validateReversibleBounds(intent, tool) {
  if (!tool || tool.invalid) return null;
  if (intent.target === "climate" && (intent.action === "set" || intent.action === "adjust")) {
    const temperature = desiredNumber(tool.arguments, ["temperature", "degrees", "celsius", "value"]);
    if (temperature === null || temperature < 16 || temperature > 30) return "TEMPERATURE_OUT_OF_RANGE";
  }
  if (intent.target === "window" && ["open", "set", "adjust"].includes(intent.action)) {
    const percent = desiredNumber(tool.arguments, ["percent", "openPercent", "position", "value"]);
    if (percent !== null && (percent < 0 || percent > 100)) return "WINDOW_POSITION_OUT_OF_RANGE";
  }
  if (intent.target === "seat" && (intent.action === "set" || intent.action === "adjust")) {
    const percent = desiredNumber(tool.arguments, ["percent", "position", "reclinePercent", "value"]);
    if (percent !== null && (percent < 0 || percent > 100)) return "SEAT_POSITION_OUT_OF_RANGE";
    if (Object.hasOwn(tool.arguments, "deltaMm")) {
      const delta = finiteNumber(tool.arguments.deltaMm);
      if (delta === null || Math.abs(delta) > 300) return "SEAT_MOVEMENT_OUT_OF_RANGE";
    }
  }
  return null;
}

/**
 * Decide whether a proposed vehicle action may execute.
 *
 * @param {{
 *   inputText?: unknown,
 *   intent?: {domain?: unknown, action?: unknown, target?: unknown, position?: unknown, confidence?: unknown},
 *   vehicleContext?: {speedKph?: unknown, gear?: unknown, parkBrake?: unknown, doorsLocked?: unknown, childLock?: unknown, stateFreshnessMs?: unknown, stateConflict?: unknown, occupantRole?: unknown},
 *   proposedToolCall?: {name?: unknown, arguments?: unknown},
 *   duplicateRequest?: unknown,
 *   userConfirmed?: unknown
 * }} input
 */
export function evaluateAutomotiveAction(input = {}) {
  if (!isPlainObject(input)) throw new TypeError("automotive policy input must be an object");

  const intent = normalizeIntent(input);
  const context = normalizeVehicleContext(input.vehicleContext);
  const tool = proposedTool(input);
  const confidenceTooLow = intent.confidence !== null && intent.confidence < 0.6;
  const intentUnderstood = intent.action !== "unknown" && (intent.target !== "unknown" || intent.action === "query");

  if (!intent.isActionRequest) {
    return allowed(intent, [intentUnderstood ? "NON_ACTUATING_REQUEST" : "NO_VEHICLE_ACTION"], "这是信息交流，不会触发车辆控制。", {
      actionAuthorized: false,
      toolExecutionAllowed: false,
    });
  }

  if (!intentUnderstood || confidenceTooLow) {
    return manualReview(
      intent,
      [!intentUnderstood ? "INTENT_NOT_UNDERSTOOD" : null, confidenceTooLow ? "LOW_INTENT_CONFIDENCE" : null],
      "控制意图目前不足以安全确认，这次不会执行，并已标记人工复核。",
      "P0",
      { intentUnderstood: false },
    );
  }

  const moving = isMoving(context);
  const openingDoor = intent.target === "door" && intent.action === "open";
  const unlockingDoor = intent.target === "door" && intent.action === "unlock";
  const openingTrunk = intent.target === "trunk" && ["open", "unlock"].includes(intent.action);
  const changingChildLock = intent.target === "child_lock" && ["set", "enable", "disable", "unlock"].includes(intent.action);
  const driverSeatAdjustment = intent.target === "seat" && intent.position === "driver" && ["set", "adjust", "open"].includes(intent.action);
  const playingVideo = intent.target === "video" && intent.action === "play";

  // A positively observed moving state is sufficient to block these actions,
  // even if another field is stale or contradictory. This avoids a conflict
  // accidentally weakening the safer outcome.
  if (moving && openingDoor) {
    return blocked(intent, ["VEHICLE_MOVING", "MOVING_DOOR_OPERATION_BLOCKED", tool ? "TOOL_BLOCKED_BY_POLICY" : null], "车辆正在行驶，车门不会打开。");
  }
  if (moving && openingTrunk) {
    return blocked(intent, ["VEHICLE_MOVING", "MOVING_TRUNK_OPERATION_BLOCKED", tool ? "TOOL_BLOCKED_BY_POLICY" : null], "车辆正在行驶，后备箱不会打开。");
  }
  if (moving && unlockingDoor) {
    return blocked(intent, ["VEHICLE_MOVING", "MOVING_DOOR_UNLOCK_BLOCKED", tool ? "TOOL_BLOCKED_BY_POLICY" : null], "车辆正在行驶，车门不会解锁。");
  }
  if (moving && driverSeatAdjustment) {
    return blocked(intent, ["VEHICLE_MOVING", "DRIVER_SEAT_MOVEMENT_BLOCKED", tool ? "TOOL_BLOCKED_BY_POLICY" : null], "车辆正在行驶，驾驶位的大幅座椅调整不会执行。");
  }
  if (moving && playingVideo && !isPassengerOnlyVideo(intent, context)) {
    return blocked(intent, ["VEHICLE_MOVING", "DRIVER_DISTRACTION_BLOCKED", tool ? "TOOL_BLOCKED_BY_POLICY" : null], "车辆正在行驶，驾驶区域不会播放视频。");
  }

  if (tool?.invalid) {
    return manualReview(intent, ["INVALID_TOOL_CALL", tool.canonical?.reason], "工具调用不在允许范围内或参数结构不完整，这次不会执行，并已标记人工复核。", "P0");
  }
  const toolMismatchReasons = toolIntentMismatch(tool, intent, input);
  if (toolMismatchReasons.length > 0) {
    return manualReview(intent, ["TOOL_INTENT_MISMATCH", ...toolMismatchReasons], "工具调用与已识别意图不一致，这次不会执行，并已标记人工复核。", "P0");
  }

  const highRiskAction = openingDoor || unlockingDoor || openingTrunk || changingChildLock || driverSeatAdjustment || playingVideo;
  if (highRiskAction) {
    const stateReasons = criticalVehicleStateReasons(context);
    if (stateReasons.length > 0) {
      return manualReview(intent, [...stateReasons, tool ? "TOOL_BLOCKED_BY_POLICY" : null], "关键车辆状态不足或不一致，这次不会执行，并已标记人工复核。", "P0");
    }
    if (!context.occupantRole) {
      return manualReview(intent, ["OCCUPANT_ROLE_MISSING", tool ? "TOOL_BLOCKED_BY_POLICY" : null], "乘员权限状态不足以安全确认，这次不会执行，并已标记人工复核。", "P0");
    }
  }

  const unauthorized = isUnauthorized(intent, context);
  if (unauthorized === true) {
    return blocked(
      intent,
      ["OCCUPANT_NOT_AUTHORIZED", changingChildLock ? "CHILD_LOCK_PROTECTED" : null, tool ? "TOOL_BLOCKED_BY_POLICY" : null],
      changingChildLock ? "当前乘员权限不能更改儿童锁。" : "当前乘员权限不能执行这项车辆控制。",
    );
  }

  const idempotencyReason = isIdempotent(input, intent, context, tool);
  if (idempotencyReason) {
    return allowed(intent, [idempotencyReason, "IDEMPOTENT_NO_OP"], "目标状态已经满足，不会重复调用车辆工具。", {
      priority: "P2",
      toolExecutionAllowed: false,
    });
  }

  if (openingDoor || unlockingDoor || openingTrunk || changingChildLock) {
    if (!isParked(context)) {
      return blocked(intent, ["VEHICLE_NOT_SAFELY_PARKED", tool ? "TOOL_BLOCKED_BY_POLICY" : null], "车辆尚未处于安全驻车状态，这项操作不会执行。", {
        priority: "P0",
      });
    }
    if (input.userConfirmed !== true) {
      return confirmation(intent, ["HIGH_IMPACT_ACTION", "USER_CONFIRMATION_REQUIRED"], "车辆已安全驻车；这项高影响操作会在明确确认后执行。", "P1");
    }
  }

  if (playingVideo && moving && isPassengerOnlyVideo(intent, context)) {
    return allowed(intent, ["PASSENGER_DISPLAY_ONLY", tool ? "SAFE_TOOL_CALL" : "NO_TOOL_CALL"], "视频仅在乘客屏播放，不会显示在驾驶区域。", {
      priority: "P2",
      toolExecutionAllowed: Boolean(tool),
    });
  }

  if (intent.target === "window" && ["open", "set", "adjust"].includes(intent.action)) {
    const percent = tool && !tool.invalid ? desiredNumber(tool.arguments, ["percent", "openPercent", "position", "value"]) : null;
    const largeOpening = intent.action === "open" ? percent === null || percent > 25 : percent !== null && percent > 25;
    if (context.speedKph !== null && context.speedKph >= 80 && largeOpening) {
      return confirmation(intent, ["HIGH_SPEED_WINDOW_CHANGE", "USER_CONFIRMATION_REQUIRED"], "当前车速较高，大幅开窗会在明确确认后执行。", "P1");
    }
  }

  const boundsReason = validateReversibleBounds(intent, tool);
  if (boundsReason) {
    return blocked(intent, [boundsReason, tool ? "TOOL_BLOCKED_BY_POLICY" : null], "请求值超出车辆控制的安全范围，这次不会执行。", {
      priority: "P1",
      reviewRequired: false,
    });
  }

  return allowed(intent, ["SAFE_REVERSIBLE_ACTION", tool ? "SAFE_TOOL_CALL" : "NO_TOOL_CALL"], tool ? "请求符合安全边界，可以执行。" : "已理解车辆控制意图；当前没有待执行的工具调用。", {
    priority: highRiskAction ? "P1" : "P2",
    toolExecutionAllowed: Boolean(tool),
  });
}

function luhnValid(value) {
  const digits = String(value).replace(/\D/gu, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let doubleDigit = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}

const REDACTION_RULES = Object.freeze([
  [/-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/giu, "[REDACTED_PRIVATE_KEY]"],
  [/-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----[\s\S]{20,}/giu, "[REDACTED_PRIVATE_KEY]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/giu, "Bearer [REDACTED_TOKEN]"],
  [/\bAuthorization\s*:\s*Basic\s+[A-Za-z0-9+/=]{12,}\b/giu, "Authorization: Basic [REDACTED_CREDENTIAL]"],
  [/\bAKIA[0-9A-Z]{16}\b/gu, "[REDACTED_ACCESS_KEY]"],
  [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AIza[A-Za-z0-9_-]{30,})\b/gu, "[REDACTED_TOKEN]"],
  [/\b(?:Cookie\s*:\s*)?(?:sessionid|session|auth|jwt)\s*=\s*[A-Za-z0-9._~+/=-]{12,}\b/giu, "[REDACTED_SESSION]"],
  [/\b(?:sk|pk|api|key|token)[_-][A-Za-z0-9_-]{8,}\b/giu, "[REDACTED_TOKEN]"],
  [/\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|token|password|passwd|secret)\s*(?::|=|\bis\b)\s*["']?[^\s,;'"，；]{4,}["']?/giu, "[REDACTED_CREDENTIAL]"],
  [/(?:密码|口令|令牌|密钥|私钥)\s*(?:是|为|[:：=])\s*["“”']?[^\s,，;；"“”']{4,}["“”']?/gu, "[REDACTED_CREDENTIAL]"],
  [/(?<!\d)\d{17}[\dXx](?!\d)/gu, "[REDACTED_ID_NUMBER]"],
  [/\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/gu, "[REDACTED_ID_NUMBER]"],
  [/(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/gu, (match) => (luhnValid(match) ? "[REDACTED_PAYMENT_CARD]" : match)],
  [/\b[A-Z0-9][A-HJ-NPR-Z0-9]{16}\b/gu, "[REDACTED_VIN]"],
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "[REDACTED_EMAIL]"],
  [/(?:经度|纬度|坐标|GPS)\s*[:：]?\s*-?\d{1,3}(?:\.\d{3,})?(?:\s*[,，/]\s*|\s+)(?:-?\d{1,3}(?:\.\d{3,})?)/giu, "[REDACTED_PRECISE_LOCATION]"],
  [/(?<![\d.])-?(?:[1-8]?\d(?:\.\d{4,})|90(?:\.0+)?)\s*[,，]\s*-?(?:1[0-7]\d(?:\.\d{4,})?|[1-9]?\d(?:\.\d{4,})?|180(?:\.0+)?)(?![\d.])/gu, "[REDACTED_PRECISE_LOCATION]"],
  [/(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/gu, "[REDACTED_PHONE]"],
  [/\b(?:\+?\d{1,3}[- ]?)?(?:\(?\d{2,4}\)?[- ]?){2,4}\d{3,4}\b/gu, "[REDACTED_PHONE]"],
  [/(?:[\p{Script=Han}]{2,}(?:省|自治区|特别行政区))?(?:[\p{Script=Han}]{2,}市)(?:[\p{Script=Han}]{1,}(?:区|县))?[\p{Script=Han}A-Za-z0-9]{2,}(?:路|街|道|巷)\s*\d+(?:号|弄|栋|室)?/gu, "[REDACTED_ADDRESS]"],
]);

/** Redact sensitive text before it enters a human-review payload. */
export function redactReviewText(text) {
  let redacted = text === undefined || text === null ? "" : String(text).normalize("NFKC").replace(/\p{Cf}/gu, "");
  for (const [pattern, replacement] of REDACTION_RULES) redacted = redacted.replace(pattern, replacement);
  return redacted;
}

/** Return true when one more redaction pass would change the supplied text. */
export function reviewTextContainsSensitiveData(text) {
  const normalized = text === undefined || text === null ? "" : String(text).normalize("NFKC").replace(/\p{Cf}/gu, "");
  return redactReviewText(normalized) !== normalized;
}

function clipText(value, maximum = 240) {
  const valueText = redactReviewText(value).replace(/\s+/gu, " ").trim();
  return valueText.length <= maximum ? valueText : `${valueText.slice(0, maximum)}…`;
}

function sanitizeReviewValue(value, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return clipText(value, 160);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (depth >= 4 || typeof value !== "object") return "[REDACTED_COMPLEX_VALUE]";
  if (seen.has(value)) return "[REDACTED_CIRCULAR_VALUE]";
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeReviewValue(item, depth + 1, seen));

  const sanitized = {};
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, 30)) {
    const key = String(rawKey)
      .normalize("NFKC")
      .replace(/[^A-Za-z0-9_-]/gu, "_")
      .slice(0, 64) || "field";
    if (/(?:password|passwd|secret|token|api_?key|private_?key|authorization|cookie|vin|location|address|email|phone)/iu.test(key)) {
      sanitized[key] = "[REDACTED]";
    } else {
      sanitized[key] = sanitizeReviewValue(rawValue, depth + 1, seen);
    }
  }
  return sanitized;
}

function safeIdentifier(value, fallback) {
  const redacted = clipText(value, 96);
  return redacted || fallback;
}

function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

/**
 * Build a bounded, redacted record for an application-owned human-review
 * queue. This function never persists or transmits the record.
 *
 * @param {object} input Original policy input, or an object containing
 *   {request, evaluation, outputText, toolExecution}.
 * @param {object} [options] Injectable metadata, including now/reviewId.
 */
export function createHumanReviewRecord(input = {}, options = {}) {
  if (!isPlainObject(input)) throw new TypeError("review input must be an object");
  if (!isPlainObject(options)) throw new TypeError("review options must be an object");

  const request = isPlainObject(input.request) ? input.request : input;
  const evaluation = isPlainObject(input.evaluation)
    ? input.evaluation
    : isPlainObject(input.result)
      ? input.result
      : evaluateAutomotiveAction(request);
  const rawInputText = request.inputText === undefined || request.inputText === null ? "" : String(request.inputText);
  const rawOutputText = input.outputText ?? options.outputText ?? "";
  const nowValue = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now());
  if (Number.isNaN(nowValue.getTime())) throw new TypeError("review timestamp is invalid");
  const inputHash = sha256(rawInputText);
  const proposed = isPlainObject(request.proposedToolCall) ? request.proposedToolCall : null;
  const execution = isPlainObject(input.toolExecution)
    ? input.toolExecution
    : isPlainObject(options.toolExecution)
      ? options.toolExecution
      : {};

  return {
    reviewId: safeIdentifier(options.reviewId, `review-${nowValue.getTime()}-${inputHash.slice(0, 12)}`),
    createdAt: nowValue.toISOString(),
    status: "pending",
    priority: ["P0", "P1", "P2"].includes(evaluation.priority) ? evaluation.priority : "P1",
    policyVersion: safeIdentifier(evaluation.policyVersion, AUTOMOTIVE_POLICY_VERSION),
    modelVersion: safeIdentifier(input.modelVersion ?? options.modelVersion, "unknown"),
    caseId: safeIdentifier(input.caseId ?? options.caseId, "unassigned"),
    traceId: safeIdentifier(input.traceId ?? request.traceId ?? options.traceId, "unassigned"),
    inputHash,
    inputExcerpt: clipText(rawInputText),
    intent: sanitizeReviewValue(evaluation.normalizedIntent ?? normalizeIntent(request)),
    vehicleContext: sanitizeReviewValue(normalizeVehicleContext(request.vehicleContext)),
    decision: AUTOMOTIVE_DECISIONS.includes(evaluation.decision) ? evaluation.decision : "manual_review",
    reasonCodes: Array.isArray(evaluation.reasonCodes)
      ? evaluation.reasonCodes.slice(0, 24).map((reason) => safeIdentifier(reason, "UNKNOWN_REASON"))
      : ["UNKNOWN_REASON"],
    outputExcerpt: clipText(rawOutputText),
    proposedToolCall: proposed
      ? {
          name: safeIdentifier(proposed.name, "unknown"),
          arguments: sanitizeReviewValue(isPlainObject(proposed.arguments) ? proposed.arguments : {}),
        }
      : null,
    toolExecution: {
      attempted: execution.attempted === true || Boolean(proposed),
      executed: execution.executed === true,
    },
    privacy: {
      redacted: true,
      rawTextStored: false,
    },
  };
}

export default evaluateAutomotiveAction;
