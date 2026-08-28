import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { stripInternalReplyLabels } from "../public/reply-policy.js";
import { formatStyleExamples, rankStyleExamples, styleIntent, styleLexicalUnits } from "../lib/style-retrieval.js";
import {
  BRIEF_COMFORT_REPLY,
  demoReply,
  isBriefComfortTurn,
} from "../lib/demo-reply.js";

const exampleFile = new URL("../data/character-corpus/default_retrieval_examples.jsonl", import.meta.url);
const examples = (await readFile(exampleFile, "utf8"))
  .split(/\r?\n/)
  .filter(Boolean)
  .map(line => JSON.parse(line));

test("情绪状态只检索克制关心示例且不暴露内部标签", () => {
  assert.equal(styleIntent("我今天状态不太好"), "comfort");
  assert.equal(styleIntent("我今天状态不好"), "comfort");
  assert.equal(styleIntent("我今天心情不太好"), "comfort");
  assert.equal(styleIntent("我今天心情不好"), "comfort");
  const ranked = rankStyleExamples("我今天状态不太好", examples);
  assert.deepEqual(ranked.map(item => item.id), ["synthetic-comfort"]);
  const formatted = formatStyleExamples(ranked);
  assert.match(formatted, /^参考表达 1：/);
  assert.doesNotMatch(formatted, /\[情绪支持\/克制关心\]|科学讨论|证据|假设|反例/);
  const quotedOldReply = "我今天状态不太好。你刚才却说这个结论一定是真的吗，还让我把证据、假设和反例分开再讨论。";
  assert.equal(styleIntent(quotedOldReply), "comfort");
  assert.deepEqual(rankStyleExamples(quotedOldReply, examples).map(item => item.id), ["synthetic-comfort"]);
});

test("科学问题只检索科学示例", () => {
  const ranked = rankStyleExamples("这个结论有什么实验数据和反例？", examples);
  assert.deepEqual(ranked.map(item => item.id), ["synthetic-science"]);
  assert.equal(styleIntent("红莉西，这个结论有什么证据？"), "science");
  assert.deepEqual(rankStyleExamples("红莉西，这个结论有什么证据？", examples).map(item => item.id), ["synthetic-science"]);
});

test("无关问题不再按文件顺序默认取第一条", () => {
  assert.deepEqual(rankStyleExamples("午饭吃什么？", examples), []);
  assert.deepEqual(rankStyleExamples("今天天气怎么样？", examples), []);
  assert.deepEqual(rankStyleExamples("我今天吃了午饭。", examples), []);
  assert.equal(styleIntent("我今天心情很好"), "general");
  assert.deepEqual(rankStyleExamples("我今天心情很好", examples), []);
});

test("设备状态不会被误判成用户情绪", () => {
  assert.equal(styleIntent("模型状态不好，服务一直报错"), "technical");
  assert.deepEqual(rankStyleExamples("模型状态不好，服务一直报错", examples), []);
  assert.equal(styleIntent("我的电脑状态不太好"), "technical");
  assert.deepEqual(rankStyleExamples("我的电脑状态不太好", examples), []);
  for (const query of ["我今天模型状态不太好", "我最近电脑状态不好", "我觉得服务器状态很不好"]) {
    assert.equal(styleIntent(query), "technical", query);
    assert.deepEqual(rankStyleExamples(query, examples), [], query);
  }
  for (const query of ["电脑坏了，我的状态不好", "游戏输了，我今天状态不太好"]) {
    assert.equal(styleIntent(query), "comfort", query);
    assert.deepEqual(rankStyleExamples(query, examples).map(item => item.id), ["synthetic-comfort"], query);
  }
});

test("演示回复区分低落、正向心情与设备故障", () => {
  assert.match(demoReply("我今天状态不太好"), /身体不舒服|太累|心情有点低落/);
  assert.match(demoReply("我今天心情很好"), /结果不错/);
  assert.doesNotMatch(demoReply("我今天模型状态不太好"), /身体不舒服|心情有点低落|别硬撑/);
});

test("低落快速回应承认感受但不向用户发号施令", () => {
  assert.match(BRIEF_COMFORT_REPLY, /听起来今天不太好受/);
  assert.doesNotMatch(BRIEF_COMFORT_REPLY, /先别|你只|说清楚|说完整|必须|别催/);
});

test("只有无媒体的简短个人低落表达进入本地快速回应", () => {
  for (const text of ["我今天状态不太好", "我心情很低落", "我最近有点累", "克里斯提娜，我今天状态不好。"] ) {
    assert.equal(isBriefComfortTurn(text), true, text);
  }
  assert.equal(isBriefComfortTurn("我今天状态不太好", { hasImage: true }), false);
  assert.equal(isBriefComfortTurn("我今天状态不太好", { hasAudio: true }), false);
  assert.equal(isBriefComfortTurn("我今天模型状态不太好"), false);
  assert.equal(isBriefComfortTurn("我今天心情很好"), false);
  assert.equal(isBriefComfortTurn("我累计完成了三个任务"), false);
  assert.equal(isBriefComfortTurn("我真的撑不住"), false);
  assert.equal(isBriefComfortTurn("我今天状态不太好，因为刚才连续遇到几件事。我想先把经过完整讲清楚，再请你和我一起分析。"), false);
});

test("附带医疗、现实危险或分析任务的文本绝不进入快速回应", () => {
  for (const text of [
    "我今天状态不好，胸痛呼吸困难",
    "我真的撑不住，胸口疼得厉害",
    "我状态不好，被人跟踪了",
    "我状态不好，药吃多了",
    "我今天状态不好，但请分析这个实验的证据和反例",
  ]) assert.equal(isBriefComfortTurn(text), false, text);
});

test("中文检索使用二元和三元片段而不是整句单词", () => {
  const units = styleLexicalUnits("我今天状态不太好");
  assert.equal(units.has("状态"), true);
  assert.equal(units.has("不太好"), true);
  assert.equal(units.has("我今天状态不太好"), false);
});

test("同分结果由稳定 id 决定而不依赖输入文件顺序", () => {
  const tied = [
    { id: "b", scene: "一般", emotion: "自然", context: { text: "量子计算问题" }, response: "乙" },
    { id: "a", scene: "一般", emotion: "自然", context: { text: "量子计算问题" }, response: "甲" },
  ];
  assert.deepEqual(rankStyleExamples("量子计算", tied).map(item => item.id), ["a", "b"]);
  assert.deepEqual(rankStyleExamples("量子计算", [...tied].reverse()).map(item => item.id), ["a", "b"]);
});

test("只移除回复开头的内部场景标签", () => {
  assert.equal(stripInternalReplyLabels("[科学讨论/专注] 先说结论。"), "先说结论。");
  assert.equal(stripInternalReplyLabels("  【情绪支持 / 克制关心】\n先缓一会儿。"), "先缓一会儿。");
  assert.equal(stripInternalReplyLabels("[科学讨论/专注] [情绪支持/克制关心] 正文"), "正文");
});

test("旧风格语料中的内部标签不会再次进入模型参考", () => {
  const formatted = formatStyleExamples([{ response: "[科学讨论/专注] 先检查证据。" }]);
  assert.equal(formatted, "参考表达 1：先检查证据。");
  assert.doesNotMatch(formatted, /科学讨论|专注/);
});

test("链接、代码式方括号、畸形标签和正文中标签保持原样", () => {
  for (const text of [
    "[链接] 正文",
    "[https://example.test/a] 正文",
    "正文 [科学讨论/专注]",
    "[科学讨论] 正文",
    "[科学讨论/专注/额外] 正文",
    "[目标/进度] 正文",
  ]) assert.equal(stripInternalReplyLabels(text), text);
});
