const { execFileSync, spawn } = require("node:child_process");
const { existsSync, statSync } = require("node:fs");
const { userInfo } = require("node:os");
const { isAbsolute, join, resolve } = require("node:path");

const projectRoot = resolve(__dirname, "..");

function samUserName(account) {
  const normalized = String(account || "").trim().replaceAll("/", "\\");
  return normalized.split("\\").filter(Boolean).at(-1) || "";
}

function isCodexSandboxAccount(account) {
  return /^codexsandbox/i.test(samUserName(account));
}

function detectAccount() {
  const failures = [];
  try {
    const whoami = join(process.env.SystemRoot || "C:\\Windows", "System32", "whoami.exe");
    const account = execFileSync(whoami, [], { encoding: "utf8", windowsHide: true, timeout: 3000 }).trim();
    if (account) return { account, failures };
    failures.push("whoami 未返回账户名");
  } catch (error) {
    failures.push(`whoami：${error?.code || error?.message || "失败"}`);
  }
  try {
    const account = userInfo().username || "";
    if (account) return { account, failures };
    failures.push("系统账户接口未返回账户名");
  } catch (error) {
    failures.push(`系统账户接口：${error?.code || error?.message || "失败"}`);
  }
  return { account: "", failures };
}

function fail(message, code = 1) {
  console.error(`\n${message}\n`);
  process.exitCode = code;
}

function launch() {
  const { account, failures } = detectAccount();
  if (!account) {
    fail(`无法确认当前 Windows 账户，已安全拒绝启动 Electron。\n请在你自己的 PowerShell 中进入 ${projectRoot} 后运行：npm run desktop${failures.length ? `\n检测信息：${failures.join("；")}` : ""}`, 78);
    return;
  }
  if (isCodexSandboxAccount(account)) {
    fail(`Electron 桌宠不能从 Codex 文件沙箱账户启动。\n请在你自己的 PowerShell 中进入 ${projectRoot} 后运行：npm run desktop`, 78);
    return;
  }

  let electronPath = "";
  try {
    electronPath = require("electron");
  } catch {
    fail(`Electron 依赖尚未安装或已经损坏。\n请在 ${projectRoot} 运行：npm install`);
    return;
  }
  try {
    if (typeof electronPath !== "string" || !isAbsolute(electronPath) || !existsSync(electronPath) || !statSync(electronPath).isFile()) throw new Error("invalid executable");
  } catch {
    fail(`没有找到可用的 Electron 程序。\n请在 ${projectRoot} 运行：npm install`);
    return;
  }

  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  delete environment.NODE_OPTIONS;
  delete environment.NODE_PATH;
  const child = spawn(electronPath, [projectRoot, ...process.argv.slice(2)], {
    cwd: projectRoot,
    env: environment,
    stdio: "inherit",
    windowsHide: false
  });
  child.once("error", error => fail(`Electron 启动失败：${error.message}`));
  child.once("exit", (code, signal) => {
    process.exitCode = Number.isInteger(code) ? code : signal ? 1 : 0;
  });
}

module.exports = { detectAccount, isCodexSandboxAccount, samUserName };
if (require.main === module) launch();
