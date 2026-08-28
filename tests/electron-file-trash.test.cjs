"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { createFileTrashIpcHandler, createFileTrashService } = require("../electron/file-trash-service.cjs");

const SELECTED_PATH = "C:\\Users\\Example\\private report.txt";
const RESOLVED_PATH = "C:\\Users\\Example\\private report.txt";
const PARENT_WINDOW = Object.freeze({ kind: "host-window" });

function fileStat(overrides = {}) {
  return {
    dev: 7,
    ino: 101,
    mode: 0o100644,
    nlink: 1,
    size: 25,
    mtimeMs: 1_000,
    ctimeMs: 1_000,
    isFile: () => true,
    isDirectory: () => false,
    isSymbolicLink: () => false,
    ...overrides,
  };
}

function fixedResult(result) {
  assert.deepEqual(Object.keys(result).sort(), ["ok", "status"]);
  assert.doesNotMatch(JSON.stringify(result), /private report|Users|Example|\\\\/i);
  return result;
}

function serviceFixture({ selection, confirmation, stats, trashError, pickerError, confirmError } = {}) {
  const calls = { picker: [], confirm: [], lstat: [], resolve: [], basename: [], trash: [] };
  const queuedStats = Array.isArray(stats) ? [...stats] : [fileStat(), fileStat()];
  const dialog = {
    async showOpenDialog(...args) {
      calls.picker.push(args);
      if (pickerError) throw pickerError;
      return selection ?? { canceled: false, filePaths: [SELECTED_PATH] };
    },
    async showMessageBox(...args) {
      calls.confirm.push(args);
      if (confirmError) throw confirmError;
      return confirmation ?? { response: 1 };
    },
  };
  const shell = {
    async trashItem(path) {
      calls.trash.push(path);
      if (trashError) throw trashError;
    },
  };
  const lstat = async path => {
    calls.lstat.push(path);
    const value = queuedStats.shift();
    if (value instanceof Error) throw value;
    return value;
  };
  const resolve = path => {
    calls.resolve.push(path);
    return RESOLVED_PATH;
  };
  const basename = path => {
    calls.basename.push(path);
    return "private report.txt";
  };
  return {
    calls,
    service: createFileTrashService({ dialog, shell, lstat, resolve, basename }),
  };
}

test("取消文件选择时不检查、不确认也不调用回收站", async () => {
  const { service, calls } = serviceFixture({ selection: { canceled: true, filePaths: [] } });
  const result = fixedResult(await service.chooseAndTrashFile(PARENT_WINDOW));

  assert.deepEqual(result, { ok: true, status: "cancelled" });
  assert.equal(calls.picker.length, 1);
  assert.strictEqual(calls.picker[0][0], PARENT_WINDOW);
  assert.deepEqual(calls.picker[0][1].properties, ["openFile", "dontAddToRecent"]);
  assert.equal(calls.picker[0][1].properties.includes("multiSelections"), false);
  assert.equal(calls.picker[0][1].properties.includes("openDirectory"), false);
  assert.equal("defaultPath" in calls.picker[0][1], false);
  assert.equal(calls.resolve.length, 0);
  assert.equal(calls.lstat.length, 0);
  assert.equal(calls.confirm.length, 0);
  assert.equal(calls.trash.length, 0);
});

test("选择普通文件后默认取消确认不会调用回收站", async () => {
  const { service, calls } = serviceFixture({ confirmation: { response: 0 } });
  const result = fixedResult(await service.chooseAndTrashFile(PARENT_WINDOW));

  assert.deepEqual(result, { ok: true, status: "cancelled" });
  assert.deepEqual(calls.resolve, [SELECTED_PATH]);
  assert.deepEqual(calls.lstat, [RESOLVED_PATH]);
  assert.equal(calls.confirm.length, 1);
  const options = calls.confirm[0][1];
  assert.equal(options.defaultId, 0);
  assert.equal(options.cancelId, 0);
  assert.deepEqual(options.buttons, ["取消", "移入回收站"]);
  assert.match(options.detail, /private report\.txt/);
  assert.doesNotMatch(JSON.stringify(options), /C:\\|Users|Example/i);
  assert.equal(calls.trash.length, 0);
});

test("确认后仅用解析出的同一路径调用一次 shell.trashItem", async () => {
  const { service, calls } = serviceFixture();
  const result = fixedResult(await service.chooseAndTrashFile(PARENT_WINDOW));

  assert.deepEqual(result, { ok: true, status: "trashed" });
  assert.deepEqual(calls.resolve, [SELECTED_PATH]);
  assert.deepEqual(calls.lstat, [RESOLVED_PATH, RESOLVED_PATH]);
  assert.deepEqual(calls.trash, [RESOLVED_PATH]);
});

test("零个或多个路径、目录、符号链接和不存在文件全部拒绝", async t => {
  const cases = [
    ["零路径", { selection: { canceled: false, filePaths: [] } }],
    ["多路径", { selection: { canceled: false, filePaths: [SELECTED_PATH, "C:\\other.txt"] } }],
    ["目录", { stats: [fileStat({ isFile: () => false, isDirectory: () => true })] }],
    ["符号链接", { stats: [fileStat({ isFile: () => false, isSymbolicLink: () => true })] }],
    ["不存在", { stats: [new Error("ENOENT: " + SELECTED_PATH)] }],
  ];

  for (const [name, options] of cases) {
    await t.test(name, async () => {
      const { service, calls } = serviceFixture(options);
      const result = fixedResult(await service.chooseAndTrashFile(PARENT_WINDOW));
      assert.deepEqual(result, { ok: false, status: "invalid" });
      assert.equal(calls.confirm.length, 0);
      assert.equal(calls.trash.length, 0);
    });
  }
});

test("确认后文件指纹变化、消失或变成链接时停止", async t => {
  const cases = [
    ["内容变化", [fileStat(), fileStat({ size: 26, mtimeMs: 1_001 })]],
    ["文件消失", [fileStat(), new Error("ENOENT: " + SELECTED_PATH)]],
    ["变成链接", [fileStat(), fileStat({ isFile: () => false, isSymbolicLink: () => true })]],
  ];

  for (const [name, stats] of cases) {
    await t.test(name, async () => {
      const { service, calls } = serviceFixture({ stats });
      const result = fixedResult(await service.chooseAndTrashFile(PARENT_WINDOW));
      assert.deepEqual(result, { ok: false, status: "changed" });
      assert.equal(calls.confirm.length, 1);
      assert.equal(calls.trash.length, 0);
    });
  }
});

test("回收站失败返回固定无路径结果且不采用永久删除回退", async () => {
  const { service, calls } = serviceFixture({ trashError: new Error("cannot trash " + SELECTED_PATH) });
  const result = fixedResult(await service.chooseAndTrashFile(PARENT_WINDOW));

  assert.deepEqual(result, { ok: false, status: "failed" });
  assert.deepEqual(calls.trash, [RESOLVED_PATH]);
  assert.equal(Object.keys(service).length, 1);
  assert.deepEqual(Object.keys(service), ["chooseAndTrashFile"]);
});

test("并发调用返回 busy，首个流程结束后可以重试", async () => {
  let releasePicker;
  let pickerCalls = 0;
  const pickerGate = new Promise(resolve => { releasePicker = resolve; });
  const dialog = {
    async showOpenDialog() {
      pickerCalls += 1;
      if (pickerCalls === 1) await pickerGate;
      return { canceled: true, filePaths: [] };
    },
    async showMessageBox() {
      throw new Error("confirmation must not run");
    },
  };
  const shell = { async trashItem() { throw new Error("trash must not run"); } };
  const service = createFileTrashService({
    dialog,
    shell,
    lstat: async () => { throw new Error("lstat must not run"); },
    resolve: value => value,
    basename: () => "unused.txt",
  });

  const first = service.chooseAndTrashFile(PARENT_WINDOW);
  const second = fixedResult(await service.chooseAndTrashFile(PARENT_WINDOW));
  assert.deepEqual(second, { ok: false, status: "busy" });
  assert.equal(pickerCalls, 1);

  releasePicker();
  assert.deepEqual(fixedResult(await first), { ok: true, status: "cancelled" });
  assert.deepEqual(fixedResult(await service.chooseAndTrashFile(PARENT_WINDOW)), { ok: true, status: "cancelled" });
  assert.equal(pickerCalls, 2);
});

test("IPC handler 只接受可信 host 的无参数调用", async () => {
  const calls = [];
  const parent = Object.freeze({ id: "host" });
  const handler = createFileTrashIpcHandler({
    isTrustedHost: event => event?.trusted === true && event?.mainFrame === true,
    chooseAndTrashFile: async value => { calls.push(value); return { ok: true, status: "trashed" }; },
    getParentWindow: () => parent,
  });

  assert.deepEqual(await handler({ trusted: false, mainFrame: true }), { ok: false, status: "forbidden" });
  assert.deepEqual(await handler({ trusted: true, mainFrame: false }), { ok: false, status: "forbidden" });
  assert.deepEqual(await handler({ trusted: true, mainFrame: true }, "C:\\forbidden.txt"), { ok: false, status: "invalid" });
  assert.deepEqual(await handler({ trusted: true, mainFrame: true }), { ok: true, status: "trashed" });
  assert.deepEqual(calls, [parent]);
});
