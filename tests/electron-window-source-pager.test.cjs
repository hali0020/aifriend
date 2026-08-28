const assert = require("node:assert/strict");
const test = require("node:test");
const { buildWindowSourcePage, DEFAULT_PAGE_SIZE, resolveWindowSourceChoice } = require("../electron/window-source-pager.cjs");

const sources = count => Array.from({ length: count }, (_, index) => ({ id: `window:${index}`, name: `窗口 ${index + 1}` }));

test("window picker paginates 0, 1 and boundary-sized source lists", () => {
  for (const [count, expectedPages] of [[0, 1], [1, 1], [8, 1], [9, 2], [16, 2], [17, 3]]) {
    const view = buildWindowSourcePage(sources(count));
    assert.equal(view.pageCount, expectedPages, String(count));
    assert.ok(view.buttons.length <= DEFAULT_PAGE_SIZE + 2, String(count));
    assert.equal(view.buttons.at(-1), "取消");
  }
});

test("window picker resolves selection, next, previous and cancellation without index drift", () => {
  const list = sources(17);
  const first = buildWindowSourcePage(list, 0);
  assert.deepEqual(resolveWindowSourceChoice(first, first.nextIndex), { action: "page", page: 1 });
  const second = buildWindowSourcePage(list, 1);
  assert.equal(resolveWindowSourceChoice(second, 0).source.id, "window:8");
  assert.deepEqual(resolveWindowSourceChoice(second, second.previousIndex), { action: "page", page: 0 });
  assert.deepEqual(resolveWindowSourceChoice(second, second.cancelId), { action: "cancel" });
  const last = buildWindowSourcePage(list, 99);
  assert.equal(last.page, 2);
  assert.equal(resolveWindowSourceChoice(last, 0).source.id, "window:16");
});
