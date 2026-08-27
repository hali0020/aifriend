"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const {
  DEFAULT_EDGE_THRESHOLD,
  EDGE_STATES,
  classifyEdgeState,
  isEdgeState
} = require("../electron/edge-state.cjs");

const WORK_AREA = Object.freeze({ x: 0, y: 0, width: 1920, height: 1080 });
const WINDOW_SIZE = Object.freeze({ width: 300, height: 380 });

test("edge-state exports the strict public enum", () => {
  assert.deepEqual(EDGE_STATES, ["none", "moving", "top", "bottom", "left", "right"]);
  assert.equal(DEFAULT_EDGE_THRESHOLD, 12);
  for (const state of EDGE_STATES) assert.equal(isEdgeState(state), true);
  for (const state of [undefined, null, "", "center", "TOP", 0, {}]) assert.equal(isEdgeState(state), false);
});

test("classifies center and all four work-area edges", () => {
  assert.equal(classifyEdgeState({ x: 810, y: 350, ...WINDOW_SIZE }, WORK_AREA), "none");
  assert.equal(classifyEdgeState({ x: 810, y: 8, ...WINDOW_SIZE }, WORK_AREA), "top");
  assert.equal(classifyEdgeState({ x: 810, y: 1080 - 380 - 7, ...WINDOW_SIZE }, WORK_AREA), "bottom");
  assert.equal(classifyEdgeState({ x: 10, y: 350, ...WINDOW_SIZE }, WORK_AREA), "left");
  assert.equal(classifyEdgeState({ x: 1920 - 300 - 9, y: 350, ...WINDOW_SIZE }, WORK_AREA), "right");
});

test("corners choose the nearest edge with a stable top/bottom/left/right tie order", () => {
  assert.equal(classifyEdgeState({ x: 4, y: 9, ...WINDOW_SIZE }, WORK_AREA), "left");
  assert.equal(classifyEdgeState({ x: 6, y: 6, ...WINDOW_SIZE }, WORK_AREA), "top");
  assert.equal(classifyEdgeState({ x: 5, y: 1080 - 380 - 5, ...WINDOW_SIZE }, WORK_AREA), "bottom");
  assert.equal(classifyEdgeState({ x: 1920 - 300 - 5, y: 1080 - 380 - 5, ...WINDOW_SIZE }, WORK_AREA), "bottom");
});

test("supports negative display coordinates and finite DPI-scaled values", () => {
  const negativeArea = { x: -1920, y: -180, width: 1920, height: 1080 };
  assert.equal(classifyEdgeState({ x: -1915, y: 120, ...WINDOW_SIZE }, negativeArea), "left");
  assert.equal(classifyEdgeState({ x: -302.5, y: 100.25, width: 300.5, height: 380.25 }, negativeArea), "right");
});

test("does not classify positions outside the threshold", () => {
  assert.equal(classifyEdgeState({ x: 13, y: 100, ...WINDOW_SIZE }, WORK_AREA), "none");
  assert.equal(classifyEdgeState({ x: 12, y: 100, ...WINDOW_SIZE }, WORK_AREA), "left");
  assert.equal(classifyEdgeState({ x: 5, y: 100, ...WINDOW_SIZE }, WORK_AREA, 4), "none");
});

test("invalid bounds, work areas, and thresholds fail closed to none", () => {
  const invalidRects = [
    null,
    {},
    { x: 0, y: 0, width: 0, height: 100 },
    { x: 0, y: 0, width: -1, height: 100 },
    { x: Number.NaN, y: 0, width: 100, height: 100 },
    { x: 0, y: Number.POSITIVE_INFINITY, width: 100, height: 100 }
  ];
  for (const value of invalidRects) {
    assert.equal(classifyEdgeState(value, WORK_AREA), "none");
    assert.equal(classifyEdgeState({ x: 0, y: 0, ...WINDOW_SIZE }, value), "none");
  }
  assert.equal(classifyEdgeState({ x: 0, y: 0, ...WINDOW_SIZE }, WORK_AREA, -1), "none");
  assert.equal(classifyEdgeState({ x: 0, y: 0, ...WINDOW_SIZE }, WORK_AREA, Number.NaN), "none");
  assert.equal(classifyEdgeState({
    get x() { throw new Error("untrusted getter"); },
    y: 0,
    width: 100,
    height: 100
  }, WORK_AREA), "none");
  assert.equal(classifyEdgeState({ x: Number.MAX_VALUE, y: 0, width: Number.MAX_VALUE, height: 100 }, WORK_AREA), "none");
});

function loadPreloadWithMock() {
  const source = fs.readFileSync(path.join(__dirname, "..", "electron", "preload-pet.cjs"), "utf8");
  let exposedApi = null;
  const listeners = new Map();
  const removed = [];
  const ipcRenderer = {
    invoke: async () => ({ ok: true }),
    on(channel, listener) {
      listeners.set(channel, listener);
    },
    removeListener(channel, listener) {
      removed.push([channel, listener]);
      if (listeners.get(channel) === listener) listeners.delete(channel);
    }
  };
  const contextBridge = {
    exposeInMainWorld(name, api) {
      assert.equal(name, "desktopPetNative");
      exposedApi = api;
    }
  };
  vm.runInNewContext(source, {
    Object,
    Set,
    TypeError,
    require(id) {
      assert.equal(id, "electron");
      return { contextBridge, ipcRenderer };
    }
  }, { filename: "preload-pet.cjs" });
  return { api: exposedApi, listeners, removed };
}

test("pet preload exposes only narrow APIs, filters states, and truly unsubscribes", () => {
  const { api, listeners, removed } = loadPreloadWithMock();
  assert.deepEqual(Object.keys(api).sort(), ["closePet", "onEdgeState", "openMain", "rendererReady"]);
  assert.equal(Object.isFrozen(api), true);
  assert.equal("send" in api, false);
  assert.equal("setBounds" in api, false);
  assert.throws(() => api.onEdgeState(null), TypeError);

  const received = [];
  const unsubscribe = api.onEdgeState(state => received.push(state));
  assert.equal(typeof unsubscribe, "function");
  const wrapped = listeners.get("desktop-pet:edge-state");
  assert.equal(typeof wrapped, "function");
  for (const state of ["none", "moving", "top", "bottom", "left", "right", "center", null, 2]) wrapped({}, state);
  assert.deepEqual(received, ["none", "moving", "top", "bottom", "left", "right"]);

  unsubscribe();
  unsubscribe();
  assert.equal(listeners.has("desktop-pet:edge-state"), false);
  assert.equal(removed.length, 1);
  assert.equal(removed[0][0], "desktop-pet:edge-state");
  assert.equal(removed[0][1], wrapped);
  wrapped({}, "top");
  assert.deepEqual(received, ["none", "moving", "top", "bottom", "left", "right"]);
});
