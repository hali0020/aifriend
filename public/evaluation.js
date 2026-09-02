const $ = selector => document.querySelector(selector);

const state = {
  cases: [],
  selected: null,
  lastAssessment: null,
  lastCandidate: null,
  lastReview: null,
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function json(value) {
  return JSON.stringify(value ?? null, null, 2);
}

function badge(value) {
  const text = String(value || "—");
  return `<span class="eval-badge ${escapeHtml(text.toLowerCase())}">${escapeHtml(text)}</span>`;
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`);
  return data;
}

function summaryCounts(summary, key) {
  const byName = `by${key[0].toUpperCase()}${key.slice(1)}`;
  return summary?.counts?.[key] || summary?.[byName] || summary?.[`${key}Counts`] || {};
}

async function loadSummary() {
  const summary = await requestJson("/api/evaluation/summary");
  const priorities = summaryCounts(summary, "priority");
  const categories = summaryCounts(summary, "category");
  $("#evalTotal").textContent = summary.total ?? summary.caseCount ?? 0;
  $("#evalP0").textContent = priorities.P0 ?? priorities.p0 ?? 0;
  $("#evalCategories").textContent = Object.keys(categories).length;
  $("#evalReviewed").textContent = summary.reviewCount ?? summary.reviews ?? 0;
  const categorySelect = $("#evalCategory");
  const selected = categorySelect.value;
  categorySelect.innerHTML = '<option value="">全部</option>' + Object.keys(categories)
    .sort((a, b) => a.localeCompare(b, "zh-CN"))
    .map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)} (${categories[value]})</option>`)
    .join("");
  categorySelect.value = selected;
}

function queryString() {
  const params = new URLSearchParams();
  for (const [name, selector] of [["priority", "#evalPriority"], ["category", "#evalCategory"], ["split", "#evalSplit"]]) {
    const value = $(selector).value;
    if (value) params.set(name, value);
  }
  return params.toString();
}

async function loadCases({ preserveSelection = true } = {}) {
  const oldId = preserveSelection ? state.selected?.id : "";
  const data = await requestJson(`/api/evaluation/cases?${queryString()}`);
  state.cases = data.items || data.cases || [];
  state.selected = state.cases.find(item => item.id === oldId) || state.cases[0] || null;
  renderCaseList();
  renderCaseDetail();
}

function renderCaseList() {
  const root = $("#evalCaseList");
  if (!state.cases.length) {
    root.innerHTML = "<p>当前筛选条件下没有用例。</p>";
    return;
  }
  root.innerHTML = state.cases.map(item => `
    <button class="evaluation-case-button ${item.id === state.selected?.id ? "active" : ""}" type="button" data-case-id="${escapeHtml(item.id)}">
      <span>${badge(item.priority)} ${badge(item.category)}</span>
      <b>${escapeHtml(item.title || item.name || item.id)}</b>
      <span>${escapeHtml(item.id)} · ${escapeHtml(item.split || "regression")}</span>
    </button>`).join("");
  root.querySelectorAll("[data-case-id]").forEach(button => button.addEventListener("click", () => {
    state.selected = state.cases.find(item => item.id === button.dataset.caseId) || null;
    state.lastAssessment = null;
    state.lastCandidate = null;
    renderCaseList();
    renderCaseDetail();
  }));
}

function caseMessages(item) {
  const input = item.input || {};
  if (Array.isArray(input)) return input;
  if (Array.isArray(input.messages)) return input.messages;
  if (Array.isArray(item.messages)) return item.messages;
  return input.text ? [{ role: "user", content: input.text }] : [];
}

function intentDefault(expected) {
  return expected?.intent || { domain: "conversation", action: "answer", target: "none", confidence: 1 };
}

function renderCaseDetail() {
  const root = $("#evalCaseDetail");
  const item = state.selected;
  if (!item) {
    root.innerHTML = '<div class="evaluation-empty">当前没有可显示的用例。</div>';
    return;
  }
  const expected = item.expected || {};
  root.innerHTML = `
    <div class="eval-case-head"><div><h3>${escapeHtml(item.title || item.name || item.id)}</h3><p>${escapeHtml(item.id)} · ${escapeHtml(item.description || "固定回归用例")}</p></div><div class="eval-badges">${badge(item.priority)}${badge(item.category)}${badge(expected.policyDecision || expected.decision)}</div></div>
    <div class="evaluation-layers"><span>1 输入内容</span><span>2 意图解析</span><span>3 动作策略</span><span>4 工具调用</span><span>5 输出校验</span></div>
    <section class="eval-section"><h4>模型输入</h4><pre class="eval-code">${escapeHtml(json({ messages: caseMessages(item), vehicleContext: item.vehicleContext || item.vehicle_context || {} }))}</pre></section>
    <section class="eval-section"><h4>期望与评分规则</h4><pre class="eval-code">${escapeHtml(json({ expected, rubric: item.rubric || {} }))}</pre></section>
    <form id="candidateForm" class="candidate-form">
      <label class="wide">候选意图（JSON）<textarea id="candidateIntent" rows="4" maxlength="6000">${escapeHtml(json(intentDefault(expected)))}</textarea></label>
      <label>候选策略<select id="candidateDecision"><option value="allow">allow</option><option value="confirm">confirm</option><option value="block">block</option><option value="manual_review">manual_review</option></select></label>
      <label>候选工具调用（JSON 或 null）<input id="candidateTool" maxlength="4000" value="${escapeHtml(json(expected.toolCall ?? null))}"></label>
      <label class="wide">候选最终回复<textarea id="candidateAnswer" rows="5" maxlength="12000" placeholder="粘贴模型输出，或运行本地模型生成候选结果"></textarea></label>
      <div class="candidate-actions"><button class="primary" type="submit">评分候选输出</button><button id="runLocalEvaluation" type="button">运行本地模型</button><span id="evalRunState">评测只提出工具调用，不会执行车辆动作。</span></div>
    </form>
    <div id="evaluationResult" aria-live="polite"></div>`;
  $("#candidateDecision").value = expected.policyDecision || expected.decision || "allow";
  $("#candidateForm").addEventListener("submit", event => { event.preventDefault(); void assessCurrentCandidate(); });
  $("#runLocalEvaluation").addEventListener("click", () => void runLocalModel());
  if (state.lastAssessment && state.lastCandidate) renderAssessment(state.lastAssessment);
}

function parseJsonField(selector, fallback) {
  const value = $(selector).value.trim();
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { throw new Error(`${selector === "#candidateIntent" ? "候选意图" : "候选工具调用"}不是有效 JSON`); }
}

function currentCandidate() {
  return {
    intent: parseJsonField("#candidateIntent", {}),
    policyDecision: $("#candidateDecision").value,
    toolCall: parseJsonField("#candidateTool", null),
    answer: $("#candidateAnswer").value,
  };
}

async function assessCurrentCandidate() {
  const root = $("#evaluationResult");
  try {
    const candidate = currentCandidate();
    root.innerHTML = '<div class="evaluation-result"><h4>正在执行确定性评分…</h4></div>';
    const assessment = await requestJson("/api/evaluation/assess", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId: state.selected.id, candidate }),
    });
    state.lastCandidate = candidate;
    state.lastAssessment = assessment.assessment || assessment;
    renderAssessment(state.lastAssessment);
  } catch (error) {
    root.innerHTML = `<div class="evaluation-result failed"><h4>无法评分</h4><span>${escapeHtml(error.message)}</span></div>`;
  }
}

function assessmentScores(value) {
  const scores = value?.scores || value?.dimensions || {};
  const normalize = key => {
    const item = scores[key];
    if (typeof item === "number") return item;
    if (typeof item?.score === "number") return item.score;
    if (typeof item?.passed === "boolean") return item.passed ? 1 : 0;
    if (typeof item === "boolean") return item ? 1 : 0;
    return null;
  };
  return {
    intent: normalize("intent"),
    policy: normalize("policy"),
    tool: normalize("tool"),
    answer: normalize("answer") ?? normalize("response"),
  };
}

function percent(value) {
  if (value === null || value === undefined) return "—";
  return `${Math.round((value > 1 ? value / 100 : value) * 100)}%`;
}

function renderAssessment(assessment) {
  const root = $("#evaluationResult");
  const passed = assessment.passed ?? assessment.pass ?? assessment.criticalFailure !== true;
  const scores = assessmentScores(assessment);
  const findings = assessment.findings || assessment.reasons || assessment.failures || [];
  root.innerHTML = `<section class="evaluation-result ${passed ? "" : "failed"}">
    <h4>${passed ? "通过当前规则" : "未通过当前规则"}${assessment.score !== undefined ? ` · 总分 ${escapeHtml(percent(assessment.score))}` : ""}</h4>
    <div class="score-grid"><span><b>${percent(scores.intent)}</b>意图</span><span><b>${percent(scores.policy)}</b>动作策略</span><span><b>${percent(scores.tool)}</b>工具</span><span><b>${percent(scores.answer)}</b>回复</span></div>
    ${findings.length ? `<ul class="evaluation-findings">${findings.map(item => `<li>${escapeHtml(typeof item === "string" ? item : item.message || item.code || json(item))}</li>`).join("")}</ul>` : ""}
    <div class="review-actions"><button id="createReview" type="button">生成脱敏人工复核单</button><button id="downloadReview" type="button" ${state.lastReview ? "" : "disabled"}>下载复核单</button><span>${assessment.reviewRequired ? "该结果需要人工复核。" : "可按需抽样复核。"}</span></div>
  </section>`;
  $("#createReview").addEventListener("click", () => void createReview());
  $("#downloadReview").addEventListener("click", downloadReview);
}

async function runLocalModel() {
  const button = $("#runLocalEvaluation");
  const status = $("#evalRunState");
  button.disabled = true;
  status.textContent = "本地模型正在生成结构化候选结果…";
  try {
    const result = await requestJson("/api/evaluation/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId: state.selected.id }),
    });
    const candidate = result.candidate || {};
    $("#candidateIntent").value = json(candidate.intent || {});
    $("#candidateDecision").value = candidate.policyDecision || candidate.decision || "allow";
    $("#candidateTool").value = json(candidate.toolCall ?? null);
    $("#candidateAnswer").value = candidate.answer || candidate.output || "";
    state.lastCandidate = candidate;
    state.lastAssessment = result.assessment || null;
    if (state.lastAssessment) renderAssessment(state.lastAssessment);
    status.textContent = `${result.model || "本地模型"} · 已完成 · 未执行工具`;
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function createReview() {
  try {
    const result = await requestJson("/api/evaluation/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId: state.selected.id, candidate: state.lastCandidate, assessment: state.lastAssessment, source: "evaluation-ui" }),
    });
    state.lastReview = result.report || result.review || result;
    $("#evalReviewed").textContent = result.queueSize ?? Number($("#evalReviewed").textContent || 0) + 1;
    $("#downloadReview").disabled = false;
    $("#createReview").textContent = "复核单已生成";
  } catch (error) {
    $("#createReview").textContent = error.message;
  }
}

function downloadJson(value, filename) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json;charset=utf-8" });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
}

function downloadReview() {
  if (!state.lastReview) return;
  downloadJson(state.lastReview, `human-review-${state.lastReview.caseId || state.selected.id}.json`);
}

function showTab(name) {
  const dataset = name === "dataset";
  $("#evalDatasetPanel").classList.toggle("hidden", !dataset);
  $("#evalSafetyPanel").classList.toggle("hidden", dataset);
  $("#evalDatasetTab").classList.toggle("active", dataset);
  $("#evalSafetyTab").classList.toggle("active", !dataset);
}

async function runSafetyLab(event) {
  event.preventDefault();
  const root = $("#safetyLabResult");
  root.innerHTML = '<section class="evaluation-result"><h4>正在检查五层安全链路…</h4></section>';
  const action = $("#safetyAction").value;
  const target = $("#safetyTarget").value;
  const position = $("#safetyPosition").value;
  const proposedToolCall = $("#safetyTool").checked ? {
    name: "vehicle.control",
    arguments: { action, target, position },
  } : null;
  try {
    const result = await requestJson("/api/evaluation/safety-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inputText: $("#safetyInput").value,
        outputText: $("#safetyOutput").value,
        intent: { domain: "vehicle_control", action, target, position, confidence: 0.98 },
        vehicleContext: {
          speedKph: Number($("#safetySpeed").value),
          gear: $("#safetyGear").value,
          stateFreshnessMs: Number($("#safetyFreshness").value),
          stateConflict: $("#safetyConflict").checked,
          occupantRole: "driver",
        },
        proposedToolCall,
      }),
    });
    renderSafetyChain(result);
  } catch (error) {
    root.innerHTML = `<section class="evaluation-result failed"><h4>检查未完成</h4><span>${escapeHtml(error.message)}</span></section>`;
  }
}

function chainValue(value, fallback = "—") {
  if (value === true) return "通过";
  if (value === false) return "未通过";
  return String(value ?? fallback);
}

function renderSafetyChain(result) {
  const automotive = result.automotive || result.policy || {};
  const inputSafety = result.inputSafety || {};
  const inputRisk = result.inputRisk || {};
  const outputSafety = result.outputSafety || {};
  const outputConsistency = result.outputConsistency || {};
  const intentOk = automotive.intentUnderstood !== false;
  const toolAllowed = automotive.toolExecutionAllowed === true;
  const decision = automotive.decision || "manual_review";
  $("#safetyLabResult").innerHTML = `<div class="safety-chain">
    <article class="${["block", "support"].includes(inputSafety.action) || inputRisk.injection === "suspected" || inputRisk.privacy === "sensitive" ? "failed" : ""}"><b>1 输入内容</b><span>${escapeHtml(chainValue(inputSafety.action, "allow"))} · 隐私 ${escapeHtml(inputRisk.privacy || "none")}</span><span>注入 ${escapeHtml(inputRisk.injection || "none")} · 动作风险 ${escapeHtml(inputRisk.actionRiskHint || "none")}</span></article>
    <article class="${intentOk ? "" : "failed"}"><b>2 意图解析</b><span>${intentOk ? "已理解" : "不确定"}</span><span>${escapeHtml(`${automotive.normalizedIntent?.action || "—"} ${automotive.normalizedIntent?.target || "—"}`)}</span></article>
    <article class="${decision === "manual_review" ? "failed" : decision === "block" ? "blocked" : ""}"><b>3 动作策略</b><span>${decision === "block" ? "已安全阻断" : escapeHtml(decision)}</span><span>${escapeHtml((automotive.reasonCodes || []).join("、") || "规则允许")}</span></article>
    <article class="${toolAllowed ? "" : "blocked"}"><b>4 工具执行</b><span>${toolAllowed ? "允许进入执行层" : "未执行"}</span><span>${automotive.actionAuthorized ? "动作已授权" : "动作未授权"}</span></article>
    <article class="${["block", "support"].includes(outputSafety.action) || outputConsistency.passed === false ? "failed" : ""}"><b>5 输出内容</b><span>${outputConsistency.passed === false ? "声明不一致" : escapeHtml(chainValue(outputSafety.action, "allow"))}</span><span>${escapeHtml(outputConsistency.reasonCodes?.join("、") || outputSafety.userMessage || "输出安全检查完成")}</span></article>
  </div>
  <section class="evaluation-result ${automotive.reviewRequired ? "failed" : ""}"><h4>${escapeHtml(automotive.safeResponse || "安全策略检查完成")}</h4><pre class="eval-code">${escapeHtml(json({ decision, priority: automotive.priority, reviewRequired: automotive.reviewRequired, reasonCodes: automotive.reasonCodes, report: result.reviewReport || null }))}</pre>${result.reviewReport ? '<div class="review-actions"><button id="downloadSafetyReview" type="button">下载脱敏复核单</button><span>复核单不包含原始敏感文本，也不会上传。</span></div>' : ""}</section>`;
  $("#downloadSafetyReview")?.addEventListener("click", () => downloadJson(result.reviewReport, `human-review-${result.reviewReport.caseId || "safety-lab"}.json`));
}

async function openEvaluation() {
  const dialog = $("#evaluationDialog");
  $("#evaluation").setAttribute("aria-expanded", "true");
  dialog.showModal();
  try {
    await Promise.all([loadSummary(), loadCases()]);
  } catch (error) {
    $("#evalCaseList").innerHTML = `<p>${escapeHtml(error.message)}</p>`;
  }
}

function closeEvaluation() {
  $("#evaluationDialog").close();
  $("#evaluation").setAttribute("aria-expanded", "false");
}

$("#evaluation")?.addEventListener("click", () => void openEvaluation());
$("#closeEvaluation")?.addEventListener("click", closeEvaluation);
$("#evaluationDialog")?.addEventListener("close", () => $("#evaluation")?.setAttribute("aria-expanded", "false"));
$("#evalDatasetTab")?.addEventListener("click", () => showTab("dataset"));
$("#evalSafetyTab")?.addEventListener("click", () => showTab("safety"));
$("#evalRefresh")?.addEventListener("click", () => void loadCases({ preserveSelection: false }));
for (const selector of ["#evalPriority", "#evalCategory", "#evalSplit"]) $(selector)?.addEventListener("change", () => void loadCases({ preserveSelection: false }));
$("#safetyLabForm")?.addEventListener("submit", event => void runSafetyLab(event));
