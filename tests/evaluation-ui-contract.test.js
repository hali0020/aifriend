import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [html, source, css] = await Promise.all([
  readFile(new URL("../public/index.html", import.meta.url), "utf8"),
  readFile(new URL("../public/evaluation.js", import.meta.url), "utf8"),
  readFile(new URL("../public/evaluation.css", import.meta.url), "utf8"),
]);

test("页头提供可访问的本地评测入口", () => {
  assert.match(html, /id="evaluation"[^>]*aria-controls="evaluationDialog"/);
  assert.match(html, /id="evaluationDialog"[^>]*class="model-dialog evaluation-dialog"/);
  assert.match(html, /id="closeEvaluation"[^>]*aria-label="关闭模型评测"/);
});

test("评测页明确分开五层判断且不连接真实车辆", () => {
  const visibleSource = `${html}\n${source}`;
  for (const label of ["输入内容", "意图解析", "动作策略", "工具调用", "输出校验"]) {
    assert.match(visibleSource, new RegExp(label));
  }
  assert.match(html, /理解正确，不等于允许执行/);
  assert.match(html, /页面不会连接或控制真实车辆/);
  assert.match(html, /任何工具调用都不会执行/);
});

test("安全链路试验包含行驶中开门的默认回归样例", () => {
  assert.match(html, /车辆正在行驶，打开左后门/);
  assert.match(html, /id="safetySpeed"[^>]*value="60"/);
  assert.match(html, /id="safetyGear"[\s\S]*?<option value="D" selected>/);
  assert.match(html, /id="safetyTarget"[\s\S]*?<option value="door" selected>/);
});

test("候选输出与安全试验走同源本地 API", () => {
  for (const endpoint of [
    "/api/evaluation/summary",
    "/api/evaluation/cases",
    "/api/evaluation/assess",
    "/api/evaluation/run",
    "/api/evaluation/reviews",
    "/api/evaluation/safety-check",
  ]) assert.match(source, new RegExp(endpoint.replaceAll("/", "\\/")));
});

test("服务端数据进入 HTML 前统一转义", () => {
  assert.match(source, /function escapeHtml\(value\)/);
  assert.match(source, /replaceAll\("&", "&amp;"\)/);
  assert.match(source, /escapeHtml\(item\.title/);
  assert.match(source, /escapeHtml\(json\(\{ messages:/);
  assert.match(source, /escapeHtml\(error\.message\)/);
});

test("评测布局在窄屏降为单列", () => {
  assert.match(css, /@media \(max-width: 840px\)/);
  assert.match(css, /\.evaluation-workspace\s*\{\s*grid-template-columns: 1fr;/);
  assert.match(css, /\.safety-chain\s*\{\s*grid-template-columns: 1fr 1fr;/);
});
