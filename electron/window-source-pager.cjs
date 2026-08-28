const DEFAULT_PAGE_SIZE = 8;

function buildWindowSourcePage(sources, requestedPage = 0, pageSize = DEFAULT_PAGE_SIZE) {
  const list = Array.isArray(sources) ? sources : [];
  const size = Number.isInteger(pageSize) && pageSize > 0 && pageSize <= 10 ? pageSize : DEFAULT_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(list.length / size));
  const page = Math.max(0, Math.min(pageCount - 1, Number.isInteger(requestedPage) ? requestedPage : 0));
  const offset = page * size;
  const visible = list.slice(offset, offset + size);
  const buttons = visible.map((source, index) => `${offset + index + 1}. ${String(source?.name || "未命名窗口").slice(0, 90)}`);
  const nextIndex = page + 1 < pageCount ? buttons.push("下一页") - 1 : -1;
  const previousIndex = page > 0 ? buttons.push("上一页") - 1 : -1;
  const cancelId = buttons.push("取消") - 1;
  return { buttons, cancelId, nextIndex, offset, page, pageCount, previousIndex, visible };
}

function resolveWindowSourceChoice(view, response) {
  if (!view || !Number.isInteger(response)) return { action: "cancel" };
  if (response >= 0 && response < view.visible.length) return { action: "select", source: view.visible[response] };
  if (response === view.nextIndex) return { action: "page", page: view.page + 1 };
  if (response === view.previousIndex) return { action: "page", page: view.page - 1 };
  return { action: "cancel" };
}

module.exports = { buildWindowSourcePage, DEFAULT_PAGE_SIZE, resolveWindowSourceChoice };
