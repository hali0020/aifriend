import assert from "node:assert/strict";
import test from "node:test";
import { createGameRequestCoordinator, readRequestGameEnabled } from "../lib/game-request-coordinator.js";
import { acceptsGameWindowSurface, historyForGameRequest, isGameSessionRequest, shouldSkipAutomaticFrame } from "../public/game-session-policy.js";

test("browser capture accepts windows only while Electron may trust its native window picker", () => {
  assert.equal(acceptsGameWindowSurface("window"), true);
  assert.equal(acceptsGameWindowSurface("monitor"), false);
  assert.equal(acceptsGameWindowSurface("browser"), false);
  assert.equal(acceptsGameWindowSurface(undefined), false);
  assert.equal(acceptsGameWindowSurface(undefined, true), true);
});

test("automatic frame skipping is bounded by count and elapsed time", () => {
  const base = { automatic: true, difference: 1, lastAnalyzedAt: 1_000, now: 20_000, intervalSeconds: 30 };
  assert.equal(shouldSkipAutomaticFrame({ ...base, skippedFrames: 0 }), true);
  assert.equal(shouldSkipAutomaticFrame({ ...base, skippedFrames: 3 }), false);
  assert.equal(shouldSkipAutomaticFrame({ ...base, now: 100_000 }), false);
  assert.equal(shouldSkipAutomaticFrame({ ...base, difference: 4 }), false);
  assert.equal(shouldSkipAutomaticFrame({ ...base, automatic: false }), false);
});

test("game requests never inherit ordinary chat history", () => {
  const history = [{ role: "user", text: "later-plot spoiler" }];
  assert.deepEqual(historyForGameRequest(history, { enabled: true }), []);
  assert.equal(historyForGameRequest(history, null), history);
});

test("text and pet turns remain part of the active game session", () => {
  assert.equal(isGameSessionRequest("chat", { enabled: true }), true);
  assert.equal(isGameSessionRequest("pet", { enabled: true }), true);
  assert.equal(isGameSessionRequest("game-manual", null), true);
  assert.equal(isGameSessionRequest("chat", null), false);
});

test("server stop epochs invalidate pending game requests and reject claims until release finishes", () => {
  const coordinator = createGameRequestCoordinator();
  const oldEpoch = coordinator.capture();
  const oldController = new AbortController();
  assert.equal(coordinator.canClaim(oldEpoch,oldController),true);
  coordinator.beginStop();
  assert.equal(coordinator.canClaim(oldEpoch,oldController),false);
  const nextEpoch = coordinator.capture();
  assert.equal(coordinator.canClaim(nextEpoch,new AbortController()),false);
  coordinator.endStop();
  assert.equal(coordinator.canClaim(nextEpoch,new AbortController()),true);
  const aborted = new AbortController();aborted.abort();
  assert.equal(coordinator.canClaim(nextEpoch,aborted),false);
});

test("server accepts only a real boolean game flag", () => {
  assert.equal(readRequestGameEnabled({}), false);
  assert.equal(readRequestGameEnabled({ game: null }), false);
  assert.equal(readRequestGameEnabled({ game: {} }), false);
  assert.equal(readRequestGameEnabled({ game: { enabled: false } }), false);
  assert.equal(readRequestGameEnabled({ game: { enabled: true } }), true);
  for (const game of ["true", [], { enabled: "true" }, { enabled: 1 }, { enabled: null }]) {
    assert.throws(() => readRequestGameEnabled({ game }), SyntaxError);
  }
});
