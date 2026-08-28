import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createFileTrashIpcHandler } = require("../electron/file-trash-service.cjs");

const sourceFiles = Object.freeze({
  index: new URL("../public/index.html", import.meta.url),
  app: new URL("../public/app.js", import.meta.url),
  pet: new URL("../public/desktop-pet.js", import.meta.url),
  emotion: new URL("../public/emotion-engine.js", import.meta.url),
  demo: new URL("../lib/demo-reply.js", import.meta.url),
  server: new URL("../server.js", import.meta.url),
  main: new URL("../electron/main.cjs", import.meta.url),
  hostPreload: new URL("../electron/preload-host.cjs", import.meta.url),
});

const sources = Object.fromEntries(await Promise.all(
  Object.entries(sourceFiles).map(async ([name, url]) => [name, await readFile(url, "utf8")]),
));

function cssDeclarations(source, exactSelector) {
  const style = source.match(/const PET_STYLE\s*=\s*`([\s\S]*?)`;\s*\r?\n/)?.[1] || "";
  const declarations = [];
  for (const match of style.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].split(",").map(value => value.trim());
    if (selectors.includes(exactSelector)) declarations.push(match[2]);
  }
  return declarations.join(";");
}

function handlerSource(source, channel) {
  const start = source.indexOf(`ipcMain.handle("${channel}"`);
  assert.notEqual(start, -1, `missing ${channel} handler`);
  const next = source.indexOf("ipcMain.handle(", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

function assertSourceMatch(source, pattern, message) {
  assert.equal(pattern.test(source), true, message || `missing source contract ${pattern}`);
}

function assertSourceDoesNotMatch(source, pattern, message) {
  assert.equal(pattern.test(source), false, message || `forbidden source contract ${pattern}`);
}

test("默认可见文案不恢复已删除的命令式或训斥式措辞", () => {
  const visibleDefaults = [sources.index, sources.app, sources.pet, sources.emotion, sources.demo, sources.server].join("\n");
  for (const phrase of [
    "好了，现在重新说明你的问题",
    "尽量把条件说完整",
    "刚才的响应为空。把关键条件再发一次，我重新分析。",
    "找到它们，下次复现就更有把握。",
    "烦躁不会让条件消失",
    "最后才给一件可执行的小建议",
  ]) assert.equal(visibleDefaults.includes(phrase), false, phrase);
});

test("页面内漫游同时注册并清理 resize 监听器", () => {
  assertSourceMatch(sources.pet, /window\.addEventListener\(\s*["']resize["']\s*,/);
  assertSourceMatch(sources.pet, /window\.removeEventListener\(\s*["']resize["']\s*,/);
});

test("Electron 原生头像可点击而状态条保留拖动区域", () => {
  const avatar = cssDeclarations(sources.pet, "body.native-pet-page .pet-avatar");
  const status = cssDeclarations(sources.pet, "body.native-pet-page .pet-status");
  assert.match(avatar, /(?:^|;)\s*(?:-webkit-)?app-region\s*:\s*no-drag(?:\s*;|$)/);
  assert.doesNotMatch(avatar, /(?:^|;)\s*(?:-webkit-)?app-region\s*:\s*drag(?:\s*;|$)/);
  assert.match(status, /(?:^|;)\s*(?:-webkit-)?app-region\s*:\s*drag(?:\s*;|$)/);
});

test("回收站意图从 renderer 到主进程始终不携带路径", () => {
  assertSourceMatch(sources.hostPreload, /trashDesktopFile\s*:\s*async\s*\(\s*\)\s*=>/);
  assertSourceMatch(sources.hostPreload, /ipcRenderer\.invoke\(\s*["']desktop-pet:trash-file["']\s*\)/);
  assertSourceDoesNotMatch(sources.hostPreload, /ipcRenderer\.invoke\(\s*["']desktop-pet:trash-file["']\s*,/);
  assertSourceMatch(sources.app, /trashDesktopFile\?\.\(\s*\)/);
  assertSourceMatch(sources.pet, /sendCommand\(\s*["']file\.trash["']\s*,\s*\{\s*\}\s*\)/);
});

test("主进程回收站 handler 只接受可信 host 的零参数调用", () => {
  const registration = handlerSource(sources.main, "desktop-pet:trash-file");
  assertSourceMatch(registration, /createFileTrashIpcHandler\(\s*\{/);
  assertSourceMatch(registration, /isTrustedHost\s*:\s*event\s*=>\s*trustedSender\(\s*event\s*,\s*hostWindow\s*,\s*hostUrl\s*\)/);
  assertSourceMatch(registration, /chooseAndTrashFile\s*:\s*fileTrashService\.chooseAndTrashFile/);
  assertSourceMatch(registration, /getParentWindow\s*:\s*\(\s*\)\s*=>\s*hostWindow/);
});

test("可信回收站 handler 对错误来源和 renderer 路径参数失败关闭", async () => {
  const trustedEvent = Object.freeze({ trusted: true });
  const parentWindow = Object.freeze({ kind: "host" });
  const calls = [];
  const handler = createFileTrashIpcHandler({
    isTrustedHost: event => event === trustedEvent,
    chooseAndTrashFile: async parent => {
      calls.push(parent);
      return { ok: true, status: "cancelled" };
    },
    getParentWindow: () => parentWindow,
  });

  assert.deepEqual(await handler({ trusted: false }), { ok: false, status: "forbidden" });
  assert.deepEqual(await handler(trustedEvent, "C:\\must-not-cross.txt"), { ok: false, status: "invalid" });
  assert.deepEqual(calls, []);
  assert.deepEqual(await handler(trustedEvent), { ok: true, status: "cancelled" });
  assert.deepEqual(calls, [parentWindow]);
});
