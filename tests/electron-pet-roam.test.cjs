"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { createPetRoamMoveGuard, nextPetRoamBounds } = require("../electron/pet-roam.cjs");

const AREA = Object.freeze({ x: -1920, y: -120, width: 1920, height: 1080 });
const BOUNDS = Object.freeze({ x: -400, y: 300, width: 300, height: 380 });

test("Electron 桌宠漫游保持窗口尺寸并限制为当前显示器工作区", () => {
  assert.deepEqual(nextPetRoamBounds(BOUNDS, AREA, 0, 0), { x: -640, y: 180, width: 300, height: 380 });
  assert.deepEqual(nextPetRoamBounds(BOUNDS, AREA, 1, 1), { x: -300, y: 420, width: 300, height: 380 });
  const edge = nextPetRoamBounds({ x: -1910, y: -110, width: 300, height: 380 }, AREA, 0, 0);
  assert.deepEqual(edge, { x: -1920, y: -120, width: 300, height: 380 });
});

test("Electron 桌宠漫游拒绝无效、越界尺寸和非有限随机值", () => {
  for (const args of [
    [null, AREA],
    [BOUNDS, null],
    [{ ...BOUNDS, width: 0 }, AREA],
    [{ ...BOUNDS, width: 3000 }, AREA],
    [BOUNDS, AREA, Number.NaN, 0.5],
    [BOUNDS, AREA, 0.5, Infinity]
  ]) assert.equal(nextPetRoamBounds(...args), null);
});

test("Electron 桌宠漫游会钳制随机输入且结果冻结", () => {
  const low = nextPetRoamBounds(BOUNDS, AREA, -10, -10);
  const high = nextPetRoamBounds(BOUNDS, AREA, 10, 10);
  assert.deepEqual(low, nextPetRoamBounds(BOUNDS, AREA, 0, 0));
  assert.deepEqual(high, nextPetRoamBounds(BOUNDS, AREA, 1, 1));
  assert.equal(Object.isFrozen(low), true);
});

test("程序移动标记持续到匹配的 moved 事件并拒绝不同边界", () => {
  let clock = 1000;
  const guard = createPetRoamMoveGuard({ now: () => clock, holdMs: 800 });
  const target = { x: 30, y: 40, width: 300, height: 380 };
  assert.equal(guard.mark(target), true);
  assert.equal(guard.isProgrammatic(), true);
  assert.equal(guard.isProgrammatic({ ...target, x: 31 }), false);
  clock += 500;
  assert.equal(guard.consume(target), true);
  assert.equal(guard.isProgrammatic(target), false);
});

test("过期或无效的程序移动标记不会掩盖手动拖动", () => {
  let clock = 2000;
  const guard = createPetRoamMoveGuard({ now: () => clock, holdMs: 500 });
  assert.equal(guard.mark({ x: 10, y: 20, width: 300, height: 380 }), true);
  clock += 500;
  assert.equal(guard.isProgrammatic(), false);
  assert.equal(guard.consume({ x: 10, y: 20, width: 300, height: 380 }), false);
  assert.equal(guard.mark({ x: 0, y: 0, width: 0, height: 1 }), false);
  assert.throws(() => createPetRoamMoveGuard({ holdMs: 0 }), /invalid/);
});
