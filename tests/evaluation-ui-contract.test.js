import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [indexHtml, evaluationJs, evaluationCss, serverSource, dataset] = await Promise.all([
  readFile(new URL("../public/index.html", import.meta.url), "utf8"),
  readFile(new URL("../public/evaluation.js", import.meta.url), "utf8"),
  readFile(new URL("../public/evaluation.css", import.meta.url), "utf8"),
  readFile(new URL("../server.js", import.meta.url), "utf8"),
  readFile(new URL("../data/evaluation/desktop-pet-eval-v1.jsonl", import.meta.url), "utf8"),
]);

const evaluationDialog = indexHtml.match(/<dialog id="evaluationDialog"[\s\S]*?<\/dialog>/u)?.[0] || "";

test("主页面提供独立的 AI 桌宠评测入口和只读边界说明", () => {
  assert.match(indexHtml, /id="evaluation"[^>]*aria-controls="evaluationDialog"/u);
  assert.match(evaluationDialog, /AI 桌宠评测台/u);
  assert.match(evaluationDialog, /理解正确，不等于允许执行/u);
  assert.match(evaluationDialog, /不会删除文件、录音、截屏、上传数据或调用 Electron IPC/u);
  assert.match(indexHtml, /src="\/evaluation\.js/u);
  assert.match(indexHtml, /href="\/evaluation\.css/u);
});

test("权限试验将桌宠安全展示为输入、意图、权限、工具、输出五层", () => {
  for (const layer of ["1 输入内容", "2 意图解析", "3 权限策略", "4 工具执行", "5 输出校验"]) {
    assert.match(evaluationJs, new RegExp(layer));
  }
  assert.match(evaluationDialog, /检查五层链路/u);
  assert.match(evaluationDialog, /候选工具只用于测试规则，执行标记固定为 false/u);
  assert.match(evaluationJs, /executionPerformed/u);
});

test("评测页覆盖桌宠交互、回收站、记忆、麦克风、截屏、游戏和云端边界", () => {
  const visibleAndData = `${evaluationDialog}\n${dataset}`;
  for (const concept of ["桌宠", "回收站", "记忆", "麦克风", "截", "游戏", "(?:云端|远端)"]) {
    assert.match(visibleAndData, new RegExp(concept), concept);
  }
  const controls = `${evaluationDialog}\n${evaluationJs}`;
  for (const id of ["evalPriority", "evalCategory", "evalSplit", "evalCaseList", "candidateIntent", "candidateDecision", "candidateTool", "candidateAnswer", "safetyLabForm", "safetyLabResult", "safetyForegroundAudio", "safetyAudioStop", "safetyAudioOneShot", "safetySelectedWindow", "safetyDiscreteCapture", "safetyNoCapturePersistence"]) {
    assert.match(controls, new RegExp(`id=["']${id}["']|#${id}`), id);
  }
  for (const trustedField of ["audioCapture", "screenCapture", "currentRequestOptIn", "userOptIn", "configured_provider", "localVisionReady", "imageSafetyReady"]) {
    assert.match(evaluationJs, new RegExp(trustedField), trustedField);
  }
});

test("浏览器评测模块没有真实文件、Electron IPC、麦克风、截屏或上传执行能力", () => {
  for (const forbidden of [
    /electronAPI/u,
    /ipcRenderer/u,
    /shell\.trashItem/u,
    /trashDesktopFile/u,
    /navigator\.mediaDevices/u,
    /getDisplayMedia/u,
    /getUserMedia/u,
    /showOpenFilePicker/u,
    /WebSocket/u,
    /EventSource/u,
  ]) assert.doesNotMatch(evaluationJs, forbidden);

  assert.match(evaluationJs, /requestJson\("\/api\/evaluation\/safety-check"/u);
  assert.doesNotMatch(evaluationJs, /fetch\(\s*[`'"]https?:/u);
  assert.doesNotMatch(evaluationJs, /method:\s*["'](?:PUT|PATCH|DELETE)["']/u);
});

test("服务端安全试验固定清除执行声明且不调用真实工具", () => {
  const start = serverSource.indexOf("async function evaluationSafetyCheck");
  const end = serverSource.indexOf("const allowedHosts", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const handler = serverSource.slice(start, end);

  assert.match(handler, /toolExecution\s*=\s*\{\s*attempted:[^}]+executed:\s*false\s*\}/u);
  assert.match(handler, /realToolsAvailable:\s*false/u);
  assert.match(handler, /executionPerformed:\s*false/u);
  assert.match(handler, /networkUploadPerformed:\s*false/u);
  assert.doesNotMatch(handler, /shell\.trashItem|trashDesktopFile|ipcRenderer|spawn\(|unlink\(|writeFile\(/u);
});
