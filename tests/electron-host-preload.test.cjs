"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadHostPreload(responses = {}) {
  const source = fs.readFileSync(path.join(__dirname, "..", "electron", "preload-host.cjs"), "utf8");
  const invokes = [];
  const listeners = new Map();
  let api = null;
  const ipcRenderer = {
    async invoke(channel, ...args) {
      invokes.push([channel, ...args]);
      return responses[channel] ?? { ok: true, open: true };
    },
    on(channel, listener) { listeners.set(channel, listener); },
    removeListener(channel, listener) { if (listeners.get(channel) === listener) listeners.delete(channel); }
  };
  vm.runInNewContext(source, {
    Object,
    Set,
    TypeError,
    require(id) {
      assert.equal(id, "electron");
      return {
        contextBridge: { exposeInMainWorld(name, value) { assert.equal(name, "desktopPetNative"); api = value; } },
        ipcRenderer
      };
    }
  }, { filename: "preload-host.cjs" });
  return { api, invokes, listeners };
}

test("host preload 只暴露桌宠开关、状态订阅和无路径回收站动作", async () => {
  const { api, invokes } = loadHostPreload({
    "desktop-pet:trash-file": { ok: true, status: "trashed", path: "C:\\private.txt" }
  });
  assert.deepEqual(Object.keys(api).sort(), ["onPetVisibility", "togglePet", "trashDesktopFile"]);
  assert.equal(Object.isFrozen(api), true);
  assert.equal("send" in api, false);
  assert.equal("invoke" in api, false);
  assert.equal("readFile" in api, false);

  const result = await api.trashDesktopFile("C:\\should-not-cross.txt");
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { ok: true, status: "trashed" });
  assert.deepEqual(invokes, [["desktop-pet:trash-file"]]);
  assert.equal("path" in result, false);
});

test("host preload 对未知回收站结果失败关闭且不转发错误或路径", async () => {
  const { api } = loadHostPreload({
    "desktop-pet:trash-file": { ok: true, status: "unknown", error: "C:\\secret.txt" }
  });
  const result = await api.trashDesktopFile();
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { ok: false, status: "failed" });
  assert.equal(Object.isFrozen(result), true);
});
