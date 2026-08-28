import assert from "node:assert/strict";
import test from "node:test";
import { createLocalImageSafetyService, IMAGE_SAFETY_SCHEMA } from "../lib/image-safety-service.js";

const labels = (overrides = {}) => ({
  sexual_minors: "absent",
  sexual_explicit: "absent",
  sexual_violence: "absent",
  graphic_violence: "absent",
  dangerous_instructions: "absent",
  credentials: "absent",
  personal_data: "absent",
  qr_code: "absent",
  prompt_injection: "absent",
  unreadable: "absent",
  ...overrides,
});

function response(content, extra = {}) {
  return { json: async () => ({ done: true, message: { content: typeof content === "string" ? content : JSON.stringify(content) }, ...extra }) };
}

function serviceFor(content, onRequest = () => {}) {
  return createLocalImageSafetyService({
    timeoutMs: 1_000,
    request: async (path, init) => {
      onRequest(path, init);
      return response(content);
    },
  });
}

const image = { base64: "c2FmZS1pbWFnZS1ieXRlcw==", mime: "image/png", width: 32, height: 32 };

test("uses a fixed local structured-output request without captions or OCR output", async () => {
  let captured;
  const result = await serviceFor(labels(), (path, init) => { captured = { path, init }; }).inspect({ image, context: "game", destination: "local" });
  assert.equal(result.action, "allow");
  assert.equal(result.remoteUsed, false);
  assert.equal(captured.path, "/api/chat");
  const body = JSON.parse(captured.init.body);
  assert.deepEqual(body.format, IMAGE_SAFETY_SCHEMA);
  assert.equal(body.stream, false);
  assert.equal(body.think, false);
  assert.equal(body.options.num_predict, 512);
  assert.equal(body.messages.at(-1).images[0], image.base64);
  assert.equal(captured.init.body.includes("game title supplied by user"), false);
});

test("maps every high-risk present label to a local block", async () => {
  for (const category of ["sexual_minors", "sexual_explicit", "sexual_violence", "graphic_violence", "dangerous_instructions", "credentials", "qr_code", "prompt_injection", "unreadable"]) {
    const verdict = await serviceFor(labels({ [category]: "present" })).inspect({ image, context: "chat", destination: "local" });
    assert.equal(verdict.action, "block", category);
    assert.deepEqual(verdict.categories, [`image_${category}`]);
  }
});

test("keeps personal data local and blocks it before cloud upload", async () => {
  const local = await serviceFor(labels({ personal_data: "present" })).inspect({ image, destination: "local" });
  const cloud = await serviceFor(labels({ personal_data: "present" })).inspect({ image, destination: "cloud" });
  assert.equal(local.action, "warn");
  assert.equal(cloud.action, "block");
});

test("fails closed for every uncertain label", async () => {
  for (const category of Object.keys(labels())) {
    const verdict = await serviceFor(labels({ [category]: "uncertain" })).inspect({ image });
    assert.equal(verdict.action, "block", category);
    assert.equal(verdict.reasonCode, "image_safety_uncertain");
  }
});

test("invalid or incomplete model output never fails open or leaks model text", async () => {
  for (const content of ["not json", {}, { ...labels(), extra: "present" }, { ...labels(), qr_code: "maybe" }]) {
    await assert.rejects(serviceFor(content).inspect({ image }), error => {
      assert.equal(error.code, "image_safety_unavailable");
      assert.equal(error.message.includes("not json"), false);
      return true;
    });
  }
});

test("accepts one strict thinking channel but rejects ambiguity and truncated generations", async () => {
  const thinkingOnly = createLocalImageSafetyService({ request: async () => response("", { message: { content: "", thinking: JSON.stringify(labels()) } }) });
  assert.equal((await thinkingOnly.inspect({ image })).action, "allow");

  for (const payload of [
    { done: true, message: { content: JSON.stringify(labels()), thinking: JSON.stringify(labels()) } },
    { done: false, message: { content: JSON.stringify(labels()) } },
    { done: true, done_reason: "length", message: { content: JSON.stringify(labels()) } },
  ]) {
    const service = createLocalImageSafetyService({ request: async () => ({ json: async () => payload }) });
    await assert.rejects(service.inspect({ image }), error => error.code === "image_safety_unavailable");
  }
});

test("request failures and timeouts use one generic fail-closed error", async () => {
  const failing = createLocalImageSafetyService({ request: async () => { throw new Error("private upstream diagnostic"); } });
  await assert.rejects(failing.inspect({ image }), error => error.code === "image_safety_unavailable" && !error.message.includes("private upstream"));
  const hanging = createLocalImageSafetyService({ timeoutMs: 10, request: (_path, init) => new Promise((_, reject) => {
    const keepAlive = setTimeout(() => reject(new Error("test request did not abort")), 1_000);
    init.signal.addEventListener("abort", () => {
      clearTimeout(keepAlive);
      reject(init.signal.reason);
    }, { once: true });
  }) });
  await assert.rejects(hanging.inspect({ image }), error => error.code === "image_safety_unavailable");
});

test("status is explicit about local-only fail-closed operation", () => {
  assert.deepEqual(serviceFor(labels()).status(), { enabled: true, localOnly: true, failClosed: true, model: "qwen3-vl:4b" });
});
