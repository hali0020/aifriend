"use strict";

const RESULT = Object.freeze({
  trashed: Object.freeze({ ok: true, status: "trashed" }),
  cancelled: Object.freeze({ ok: true, status: "cancelled" }),
  busy: Object.freeze({ ok: false, status: "busy" }),
  invalid: Object.freeze({ ok: false, status: "invalid" }),
  changed: Object.freeze({ ok: false, status: "changed" }),
  failed: Object.freeze({ ok: false, status: "failed" }),
  forbidden: Object.freeze({ ok: false, status: "forbidden" }),
});

const PICKER_OPTIONS = Object.freeze({
  title: "选择要移入回收站的文件",
  buttonLabel: "选择文件",
  properties: Object.freeze(["openFile", "dontAddToRecent"]),
});

const CONFIRM_BUTTONS = Object.freeze(["取消", "移入回收站"]);

const FINGERPRINT_FIELDS = Object.freeze([
  "dev",
  "ino",
  "mode",
  "nlink",
  "size",
  "mtimeMs",
  "ctimeMs",
]);

function callable(value) {
  return typeof value === "function";
}

function regularFile(stat) {
  if (!stat || !callable(stat.isFile) || !callable(stat.isDirectory) || !callable(stat.isSymbolicLink)) return false;
  try {
    return stat.isFile() === true && stat.isDirectory() === false && stat.isSymbolicLink() === false;
  } catch {
    return false;
  }
}

function statFingerprint(stat) {
  if (!regularFile(stat)) return "";
  const parts = [];
  for (const field of FINGERPRINT_FIELDS) {
    const value = stat[field];
    if ((typeof value !== "number" || !Number.isFinite(value)) && typeof value !== "bigint") return "";
    parts.push(`${field}:${typeof value}:${String(value)}`);
  }
  return parts.join("|");
}

function exactSinglePath(selection) {
  if (!selection || selection.canceled === true || !Array.isArray(selection.filePaths)) return "";
  if (selection.filePaths.length !== 1) return "";
  const selected = selection.filePaths[0];
  return typeof selected === "string" && selected.length > 0 && selected === selected.trim() ? selected : "";
}

function safeDisplayName(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function confirmationOptions(displayName) {
  return Object.freeze({
    type: "warning",
    title: "移入回收站",
    message: "将这个文件移入回收站？",
    detail: `文件：${displayName}\n只处理这个普通文件；能否恢复由操作系统回收站决定。`,
    buttons: CONFIRM_BUTTONS,
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
}

function createFileTrashService({ dialog, shell, lstat, resolve, basename } = {}) {
  if (!dialog || !callable(dialog.showOpenDialog) || !callable(dialog.showMessageBox)) {
    throw new TypeError("file trash dialog dependency is invalid");
  }
  if (!shell || !callable(shell.trashItem)) throw new TypeError("file trash shell dependency is invalid");
  if (!callable(lstat)) throw new TypeError("file trash lstat dependency is invalid");
  if (!callable(resolve)) throw new TypeError("file trash resolve dependency is invalid");
  if (!callable(basename)) throw new TypeError("file trash basename dependency is invalid");

  let active = false;

  async function chooseAndTrashFile(parentWindow) {
    if (active) return RESULT.busy;
    active = true;
    try {
      let selection;
      try {
        selection = await dialog.showOpenDialog(parentWindow, PICKER_OPTIONS);
      } catch {
        return RESULT.failed;
      }
      if (selection?.canceled === true) return RESULT.cancelled;

      const selectedPath = exactSinglePath(selection);
      if (!selectedPath) return RESULT.invalid;

      let targetPath;
      try {
        targetPath = resolve(selectedPath);
      } catch {
        return RESULT.invalid;
      }
      if (typeof targetPath !== "string" || targetPath.length === 0 || targetPath !== targetPath.trim()) return RESULT.invalid;
      let displayName;
      try {
        displayName = safeDisplayName(basename(targetPath));
      } catch {
        return RESULT.invalid;
      }
      if (!displayName || displayName === "." || displayName === "..") return RESULT.invalid;

      let before;
      try {
        before = await lstat(targetPath);
      } catch {
        return RESULT.invalid;
      }
      const beforeFingerprint = statFingerprint(before);
      if (!beforeFingerprint) return RESULT.invalid;

      let confirmation;
      try {
        confirmation = await dialog.showMessageBox(parentWindow, confirmationOptions(displayName));
      } catch {
        return RESULT.failed;
      }
      if (!confirmation || confirmation.response !== 1) return RESULT.cancelled;

      let after;
      try {
        after = await lstat(targetPath);
      } catch {
        return RESULT.changed;
      }
      const afterFingerprint = statFingerprint(after);
      if (!afterFingerprint || afterFingerprint !== beforeFingerprint) return RESULT.changed;

      try {
        await shell.trashItem(targetPath);
      } catch {
        return RESULT.failed;
      }
      return RESULT.trashed;
    } finally {
      active = false;
    }
  }

  return Object.freeze({ chooseAndTrashFile });
}

function createFileTrashIpcHandler({ isTrustedHost, chooseAndTrashFile, getParentWindow } = {}) {
  if (!callable(isTrustedHost) || !callable(chooseAndTrashFile) || !callable(getParentWindow)) {
    throw new TypeError("file trash IPC dependencies are invalid");
  }
  return async (event, ...args) => {
    if (isTrustedHost(event) !== true) return RESULT.forbidden;
    if (args.length !== 0) return RESULT.invalid;
    return chooseAndTrashFile(getParentWindow());
  };
}

module.exports = Object.freeze({
  createFileTrashService,
  createFileTrashIpcHandler,
});
