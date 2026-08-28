import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildStatusView, unavailableStatusView } from "../public/status-view.js";

const indexHtml = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const appSource = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const enhancementCss = await readFile(new URL("../public/enhancements.css", import.meta.url), "utf8");

test("主聊天页不再渲染冗余身份侧栏", () => {
  assert.doesNotMatch(indexHtml, /<aside\b|class=["']side["']/i);
  assert.match(indexHtml, /<section class="chat">/);
});

test("隐私与安全状态保留在紧凑页头中", () => {
  assert.match(indexHtml, /class="runtime-badges"/);
  assert.match(indexHtml, /id="privacyState"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(indexHtml, /id="privacyState"[^>]*>正在确认处理模式…</);
  assert.match(indexHtml, /id="safetyStatus"[^>]*role="status"[^>]*aria-live="polite"/);
});

test("欢迎页与重新开始状态不再命令用户补充条件", () => {
  const visibleCopy = `${indexHtml}\n${appSource}`;
  for (const phrase of ["好了，现在重新说明你的问题", "尽量把条件说完整", "有事就把条件说清楚", "听好，我只说一遍", "别催，马上就好"]) {
    assert.doesNotMatch(visibleCopy, new RegExp(phrase), phrase);
  }
  assert.match(indexHtml, /所以，今天想聊什么/);
  assert.match(appSource, /对话记录已经清空。这里随时可以重新开始/);
});

test("页面内桌宠外层透明且不会用矩形面板拦截页面", () => {
  const rule = enhancementCss.match(/\.embedded-desktop-pet\s*\{([\s\S]*?)\}/)?.[1] || "";
  assert.match(rule, /background:\s*transparent/);
  assert.match(rule, /border:\s*0/);
  assert.match(rule, /box-shadow:\s*none/);
  assert.match(rule, /pointer-events:\s*none/);
});

test("运行状态视图明确区分本地、云端、离线与未知", () => {
  const base={model:"qwen",safety:{remoteEnabled:false,remoteReady:false},imageSemantic:{ready:true}};
  assert.match(buildStatusView({...base,processing:"local"}).privacyText,/本地优先/);
  assert.match(buildStatusView({...base,processing:"cloud"}).privacyText,/会发送/);
  assert.match(buildStatusView({...base,processing:"cloud-offline"}).privacyText,/当前不会发送/);
  assert.match(buildStatusView({...base,processing:"offline"}).statusText,/Ollama 未就绪/);
  assert.throws(()=>buildStatusView({...base,processing:undefined}),/无效/);
  assert.match(unavailableStatusView().privacyText,/无法确认/);
});
