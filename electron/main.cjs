const { app, BrowserWindow, desktopCapturer, dialog, ipcMain, screen, session, utilityProcess } = require("electron");
const { join, resolve } = require("node:path");
const { classifyEdgeState, isEdgeState } = require("./edge-state.cjs");

const SESSION_PARTITION = "persist:amadeus";
const APP_ROOT = resolve(__dirname, "..");
const SERVER_ENTRY = join(APP_ROOT, "server.js");

let appOrigin = "";
let hostUrl = "";
let petUrl = "";
let hostWindow = null;
let petWindow = null;
let managedServer = null;
let quitting = false;
let ipcRegistered = false;
let startingDesktop = null;
let petRendererReady = false;
let petReadyWaiter = null;
let lastPetBounds = null;
let lastSentPetEdgeState = null;
let petEdgeSettleTimer = null;
let petEdgeTrackedWindow = null;

const PET_EDGE_SETTLE_MS = 80;

app.enableSandbox();

function samePage(rawUrl, expectedUrl) {
  try {
    const actual = new URL(rawUrl);
    const expected = new URL(expectedUrl);
    return actual.origin === expected.origin && actual.pathname === expected.pathname && actual.search === expected.search;
  } catch {
    return false;
  }
}

function originOf(rawUrl) {
  try {
    return new URL(rawUrl).origin;
  } catch {
    return "";
  }
}

function serverEnvironment() {
  const environment = { ...process.env, PORT: "0" };
  delete environment.NODE_OPTIONS;
  delete environment.NODE_PATH;
  delete environment.ELECTRON_RUN_AS_NODE;
  return environment;
}

function isLive(window) {
  return !!window && !window.isDestroyed();
}

function hardenNavigation(window, expectedUrl) {
  window.webContents.on("will-navigate", (details, deprecatedUrl) => {
    if (details.isMainFrame !== true || !samePage(details.url || deprecatedUrl, expectedUrl)) details.preventDefault();
  });
  window.webContents.on("will-redirect", (details, deprecatedUrl, _isInPlace, deprecatedIsMainFrame) => {
    const isMainFrame = typeof details.isMainFrame === "boolean" ? details.isMainFrame : deprecatedIsMainFrame;
    if (isMainFrame !== true || !samePage(details.url || deprecatedUrl, expectedUrl)) details.preventDefault();
  });
  window.webContents.on("will-frame-navigate", details => {
    if (details.isMainFrame !== true || !samePage(details.url, expectedUrl)) details.preventDefault();
  });
  window.webContents.on("will-attach-webview", event => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
}

function isHostContents(webContents) {
  return isLive(hostWindow) && webContents === hostWindow.webContents && samePage(webContents.getURL(), hostUrl);
}

function trustedSender(event, expectedWindow, expectedUrl) {
  if (!isLive(expectedWindow) || event.sender !== expectedWindow.webContents) return false;
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) return false;
  return samePage(event.senderFrame.url, expectedUrl) && samePage(event.sender.getURL(), expectedUrl);
}

function configureSession() {
  const desktopSession = session.fromPartition(SESSION_PARTITION);
  const trustedHostRequest = (webContents, requestingUrl = "") =>
    isHostContents(webContents) && (!requestingUrl || originOf(requestingUrl) === appOrigin);

  desktopSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    if (!trustedHostRequest(webContents, requestingOrigin)) return false;
    return ["media", "display-capture", "clipboard-sanitized-write"].includes(permission);
  });

  desktopSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (!trustedHostRequest(webContents, details.requestingUrl || details.securityOrigin || "")) {
      callback(false);
      return;
    }
    if (permission === "media") {
      const mediaTypes = Array.isArray(details.mediaTypes) ? details.mediaTypes : [];
      callback(mediaTypes.length > 0 && mediaTypes.every(type => type === "audio"));
      return;
    }
    callback(permission === "display-capture" || permission === "clipboard-sanitized-write");
  });

  if (typeof desktopSession.setDisplayMediaRequestHandler === "function") desktopSession.setDisplayMediaRequestHandler(async (request, callback) => {
    const trustedFrame = isLive(hostWindow) && request.frame === hostWindow.webContents.mainFrame;
    if (!trustedFrame || originOf(request.securityOrigin) !== appOrigin || request.videoRequested !== true || request.audioRequested === true) {
      callback({});
      return;
    }
    try {
      const allSources = await desktopCapturer.getSources({ types: ["window"], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false });
      const sources = allSources.filter(source => !/克里斯提娜|Amadeus/i.test(source.name)).slice(0, 24);
      if (!sources.length) return callback({});
      const cancelId = sources.length;
      const choice = await dialog.showMessageBox(hostWindow, {
        type: "question",
        title: "选择游戏窗口",
        message: "只选择需要陪玩的游戏窗口",
        detail: "模型只会收到你手动或按设定间隔触发的离散截图；不会读取其他窗口。",
        buttons: [...sources.map(source => source.name || "未命名窗口"), "取消"],
        cancelId,
        defaultId: cancelId,
        noLink: true
      });
      callback(choice.response >= 0 && choice.response < sources.length ? { video: sources[choice.response] } : {});
    } catch {
      callback({});
    }
  });
  return desktopSession;
}

function secureWebPreferences(preload, extra = {}) {
  return {
    partition: SESSION_PARTITION,
    preload,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    safeDialogs: true,
    navigateOnDragDrop: false,
    spellcheck: false,
    devTools: !app.isPackaged,
    ...extra
  };
}

async function loadWindowUrl(window, url, label, timeoutMs = 15_000) {
  let timeout = null;
  try {
    await Promise.race([
      window.loadURL(url),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label}在 ${Math.round(timeoutMs / 1000)} 秒内没有完成加载。`)), timeoutMs);
      })
    ]);
  } catch (error) {
    if (isLive(window)) window.webContents.stop();
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function notifyPetVisibility(visible) {
  if (!isLive(hostWindow) || hostWindow.webContents.isLoadingMainFrame()) return;
  hostWindow.webContents.send("desktop-pet:visibility", visible === true);
}

function clearPetEdgeSettleTimer() {
  if (petEdgeSettleTimer !== null) clearTimeout(petEdgeSettleTimer);
  petEdgeSettleTimer = null;
}

function resetPetEdgeTracking(window = null) {
  if (window && petEdgeTrackedWindow && petEdgeTrackedWindow !== window) return;
  clearPetEdgeSettleTimer();
  petEdgeTrackedWindow = null;
  lastSentPetEdgeState = null;
}

function isVerifiedPetRenderer(window) {
  return window === petWindow
    && isLive(window)
    && petRendererReady
    && !window.webContents.isDestroyed()
    && samePage(window.webContents.getURL(), petUrl);
}

function sendPetEdgeState(window, state) {
  if (!isEdgeState(state) || !isVerifiedPetRenderer(window) || lastSentPetEdgeState === state) return false;
  try {
    window.webContents.send("desktop-pet:edge-state", state);
    lastSentPetEdgeState = state;
    return true;
  } catch {
    return false;
  }
}

function classifyPetWindowEdge(window) {
  if (!isLive(window)) return "none";
  try {
    const bounds = window.getBounds();
    const workArea = screen.getDisplayMatching(bounds)?.workArea;
    return classifyEdgeState(bounds, workArea);
  } catch {
    return "none";
  }
}

function syncPetEdgeState(window) {
  if (window !== petWindow || !isLive(window)) return false;
  clearPetEdgeSettleTimer();
  petEdgeTrackedWindow = window;
  return sendPetEdgeState(window, classifyPetWindowEdge(window));
}

function notifyPetMoving(window) {
  if (window !== petWindow || !isLive(window)) return false;
  clearPetEdgeSettleTimer();
  petEdgeTrackedWindow = window;
  return sendPetEdgeState(window, "moving");
}

function schedulePetEdgeSync(window) {
  if (window !== petWindow || !isLive(window)) return;
  clearPetEdgeSettleTimer();
  petEdgeTrackedWindow = window;
  petEdgeSettleTimer = setTimeout(() => {
    petEdgeSettleTimer = null;
    if (petEdgeTrackedWindow === window) syncPetEdgeState(window);
  }, PET_EDGE_SETTLE_MS);
}

function placePetWindow(window) {
  if (!isLive(window)) return;
  const { width, height } = window.getBounds();
  const preferred = lastPetBounds || window.getBounds();
  const display = lastPetBounds ? screen.getDisplayMatching(preferred) : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const area = display.workArea;
  const fallbackX = area.x + area.width - width - 24;
  const fallbackY = area.y + area.height - height - 24;
  const x = lastPetBounds ? Math.min(Math.max(preferred.x, area.x), area.x + area.width - width) : fallbackX;
  const y = lastPetBounds ? Math.min(Math.max(preferred.y, area.y), area.y + area.height - height) : fallbackY;
  window.setBounds({
    x: Math.max(area.x, x),
    y: Math.max(area.y, y),
    width,
    height
  }, false);
  lastPetBounds = window.getBounds();
  syncPetEdgeState(window);
}

function waitForPetRenderer(window, timeoutMs = 12_000) {
  return new Promise((resolveReady, rejectReady) => {
    let settled = false;
    const contents = window.webContents;
    const cleanup = () => {
      clearTimeout(timeout);
      contents.removeListener("did-fail-load", onFailedLoad);
      contents.removeListener("preload-error", onPreloadError);
      contents.removeListener("render-process-gone", onRendererGone);
      window.removeListener("closed", onClosed);
      if (petReadyWaiter?.window === window) petReadyWaiter = null;
    };
    const succeed = () => {
      if (settled) return;
      settled = true;
      cleanup();
      petRendererReady = true;
      resolveReady();
    };
    const fail = error => {
      if (settled) return;
      settled = true;
      cleanup();
      petRendererReady = false;
      rejectReady(error instanceof Error ? error : new Error(String(error || "桌宠渲染器启动失败。")));
    };
    const onFailedLoad = (_event, code, description, _url, isMainFrame) => {
      if (isMainFrame !== false && code !== -3) fail(new Error(`桌宠页面加载失败：${description || code}`));
    };
    const onPreloadError = (_event, _path, error) => fail(new Error(`桌宠安全桥加载失败：${error?.message || error || "未知错误"}`));
    const onRendererGone = (_event, details) => fail(new Error(`桌宠渲染器已退出：${details?.reason || "未知原因"}`));
    const onClosed = () => fail(new Error("桌宠窗口在启动期间被关闭。"));
    const timeout = setTimeout(() => fail(new Error("桌宠界面在 12 秒内没有报告就绪。")), timeoutMs);
    contents.on("did-fail-load", onFailedLoad);
    contents.on("preload-error", onPreloadError);
    contents.on("render-process-gone", onRendererGone);
    window.once("closed", onClosed);
    petReadyWaiter = { window, succeed, fail };
  });
}

function failPendingPetReady(window, error) {
  if (petReadyWaiter?.window === window) petReadyWaiter.fail(error);
}

function recoverPetWindow(window, message) {
  if (quitting || petWindow !== window || !petRendererReady) return;
  petRendererReady = false;
  if (!window.isDestroyed()) window.destroy();
  notifyPetVisibility(false);
  showHostWindow();
  if (isLive(hostWindow)) {
    void dialog.showMessageBox(hostWindow, {
      type: "warning",
      title: "桌宠已返回主界面",
      message: "桌宠渲染器停止响应，已安全关闭透明窗口。",
      detail: String(message || "可以从主界面的“桌宠”按钮重新打开。").slice(0, 300),
      buttons: ["知道了"],
      noLink: true
    });
  }
}

function createHostWindow() {
  const window = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 760,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#f5f7f3",
    title: "克里斯提娜 · Amadeus",
    webPreferences: secureWebPreferences(join(__dirname, "preload-host.cjs"), {
      backgroundThrottling: false
    })
  });
  window.webContents.setBackgroundThrottling(false);
  hardenNavigation(window, hostUrl);
  window.on("close", event => {
    if (!quitting && isLive(petWindow)) {
      event.preventDefault();
      window.hide();
    }
  });
  window.on("closed", () => {
    if (hostWindow === window) hostWindow = null;
  });
  return window;
}

function createPetWindow() {
  const window = new BrowserWindow({
    width: 300,
    height: 380,
    minWidth: 260,
    minHeight: 320,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    hasShadow: false,
    title: "克里斯提娜 · 桌宠",
    webPreferences: secureWebPreferences(join(__dirname, "preload-pet.cjs"), {
      backgroundThrottling: false
    })
  });
  window.setAlwaysOnTop(true, "floating");
  window.webContents.setBackgroundThrottling(false);
  hardenNavigation(window, petUrl);
  window.webContents.on("render-process-gone", (_event, details) => recoverPetWindow(window, `渲染器退出：${details?.reason || "未知原因"}`));
  window.webContents.on("unresponsive", () => recoverPetWindow(window, "桌宠渲染器长时间没有响应。"));
  window.webContents.on("preload-error", (_event, _path, error) => recoverPetWindow(window, `安全桥错误：${error?.message || error || "未知错误"}`));
  window.webContents.on("did-fail-load", (_event, code, description, _url, isMainFrame) => {
    if (isMainFrame !== false && code !== -3) recoverPetWindow(window, `页面加载失败：${description || code}`);
  });
  window.on("will-move", () => {
    notifyPetMoving(window);
  });
  window.on("moved", () => {
    if (!window.isDestroyed()) {
      lastPetBounds = window.getBounds();
      schedulePetEdgeSync(window);
    }
  });
  window.on("closed", () => {
    petRendererReady = false;
    resetPetEdgeTracking(window);
    failPendingPetReady(window, new Error("桌宠窗口已关闭。"));
    if (petWindow === window) petWindow = null;
    notifyPetVisibility(false);
    if (!quitting && isLive(hostWindow) && !hostWindow.isVisible()) showHostWindow();
  });
  return window;
}

function showHostWindow() {
  if (!isLive(hostWindow)) return false;
  if (hostWindow.isMinimized()) hostWindow.restore();
  hostWindow.show();
  hostWindow.focus();
  return true;
}

async function showPetWindow() {
  if (isLive(petWindow) && petRendererReady) {
    placePetWindow(petWindow);
    petWindow.show();
    petWindow.focus();
    petWindow.moveTop();
    notifyPetVisibility(true);
    return true;
  }
  if (isLive(petWindow)) petWindow.destroy();
  resetPetEdgeTracking();
  const window = createPetWindow();
  petWindow = window;
  petRendererReady = false;
  const ready = waitForPetRenderer(window);
  try {
    await loadWindowUrl(window, petUrl, "桌宠页面");
    if (petWindow !== window || window.isDestroyed()) throw new Error("桌宠窗口在页面加载后已失效。");
    placePetWindow(window);
    window.show();
    window.focus();
    window.moveTop();
    await ready;
    notifyPetVisibility(true);
    return true;
  } catch (error) {
    failPendingPetReady(window, error);
    await ready.catch(() => {});
    if (petWindow === window) petWindow = null;
    if (!window.isDestroyed()) window.destroy();
    petRendererReady = false;
    notifyPetVisibility(false);
    showHostWindow();
    throw error;
  }
}

async function togglePetWindow(forceVisible) {
  if (forceVisible === true) return showPetWindow();
  if (isLive(petWindow) && forceVisible !== true) {
    petWindow.close();
    return false;
  }
  if (forceVisible === false) return false;
  return showPetWindow();
}

function closePetWindow() {
  if (!isLive(petWindow)) return false;
  petWindow.close();
  return true;
}

function registerIpc() {
  if (ipcRegistered) return;
  ipcRegistered = true;
  ipcMain.handle("desktop-pet:renderer-ready", event => {
    if (!trustedSender(event, petWindow, petUrl)) return { ok: false, code: "forbidden" };
    if (petReadyWaiter?.window === petWindow) petReadyWaiter.succeed();
    else petRendererReady = true;
    syncPetEdgeState(petWindow);
    return { ok: true };
  });
  ipcMain.handle("desktop-pet:toggle", async (event, forceVisible) => {
    if (!trustedSender(event, hostWindow, hostUrl)) return { ok: false, code: "forbidden" };
    if (forceVisible !== undefined && typeof forceVisible !== "boolean") return { ok: false, code: "invalid" };
    try {
      return { ok: true, open: await togglePetWindow(forceVisible) };
    } catch (error) {
      return { ok: false, code: "pet-start-failed", message: String(error?.message || error).slice(0, 300) };
    }
  });
  ipcMain.handle("desktop-pet:open-main", event => {
    if (!trustedSender(event, petWindow, petUrl)) return { ok: false, code: "forbidden" };
    return { ok: showHostWindow() };
  });
  ipcMain.handle("desktop-pet:close", event => {
    if (!trustedSender(event, petWindow, petUrl)) return { ok: false, code: "forbidden" };
    const closable = isLive(petWindow);
    if (closable) setImmediate(closePetWindow);
    return { ok: closable };
  });
}

function handleUnexpectedServerExit(detail) {
  if (quitting) return;
  petRendererReady = false;
  if (isLive(petWindow)) petWindow.destroy();
  notifyPetVisibility(false);
  showHostWindow();
  if (isLive(hostWindow)) {
    void dialog.showMessageBox(hostWindow, {
      type: "error",
      title: "本地服务已停止",
      message: "桌宠的本地服务意外停止。",
      detail: `${String(detail || "未知原因").slice(0, 220)}\n请退出后重新运行 npm run desktop。`,
      buttons: ["知道了"],
      noLink: true
    });
  }
}

function launchPrivateServer() {
  return new Promise((resolveLaunch, rejectLaunch) => {
    const child = utilityProcess.fork(SERVER_ENTRY, [], {
      cwd: APP_ROOT,
      env: serverEnvironment(),
      stdio: "ignore",
      serviceName: "Amadeus Local Server"
    });
    managedServer = child;
    let settled = false;
    const timeout = setTimeout(() => fail(new Error("本地服务未能在 20 秒内报告可用端口。")), 20_000);
    const fail = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (managedServer === child) managedServer = null;
      child.kill();
      rejectLaunch(error);
    };

    child.on("message", message => {
      if (settled || !message || message.type !== "server-ready") return;
      const port = Number(message.port);
      if (message.host !== "127.0.0.1" || !Number.isInteger(port) || port < 1 || port > 65_535) {
        fail(new Error("本地服务返回了无效的监听地址。"));
        return;
      }
      appOrigin = `http://127.0.0.1:${port}`;
      hostUrl = `${appOrigin}/?electronHost=1`;
      petUrl = `${appOrigin}/desktop-pet.html`;
      settled = true;
      clearTimeout(timeout);
      resolveLaunch();
    });
    child.once("error", (type, location) => {
      const message = `本地服务进程异常：${type}${location ? ` · ${location}` : ""}`;
      if (!settled) fail(new Error(message));
      else {
        if (managedServer === child) managedServer = null;
        handleUnexpectedServerExit(message);
      }
    });
    child.once("exit", code => {
      const wasManaged = managedServer === child;
      if (wasManaged) managedServer = null;
      if (!settled) fail(new Error(`本地服务提前退出（代码 ${code}）。`));
      else if (wasManaged) handleUnexpectedServerExit(`退出代码：${code}`);
    });
  });
}

function stopManagedServer() {
  const child = managedServer;
  managedServer = null;
  child?.kill();
}

function startDesktop() {
  if (startingDesktop) return startingDesktop;
  startingDesktop = (async () => {
    try {
      await launchPrivateServer();
      configureSession();
      registerIpc();
      hostWindow = createHostWindow();
      await loadWindowUrl(hostWindow, hostUrl, "主界面");
    } catch (error) {
      dialog.showErrorBox("克里斯提娜启动失败", error.message || String(error));
      app.quit();
      return;
    }
    try {
      await showPetWindow();
    } catch (error) {
      notifyPetVisibility(false);
      showHostWindow();
      if (isLive(hostWindow)) {
        void dialog.showMessageBox(hostWindow, {
          type: "warning",
          title: "桌宠没有完成启动",
          message: "透明桌宠没有完成界面校验，已改为打开主界面。",
          detail: `${String(error?.message || error).slice(0, 260)}\n可以在主界面点击“桌宠”重试。`,
          buttons: ["知道了"],
          noLink: true
        });
      }
    }
  })().finally(() => { startingDesktop = null; });
  return startingDesktop;
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (isLive(petWindow) && petRendererReady) {
      placePetWindow(petWindow);
      petWindow.show();
      petWindow.focus();
      petWindow.moveTop();
    } else {
      showHostWindow();
    }
  });
  app.whenReady().then(() => {
    if (process.platform === "win32") app.setAppUserModelId("local.amadeus.christina");
    const keepPetOnScreen = () => {
      if (isLive(petWindow)) placePetWindow(petWindow);
    };
    screen.on("display-added", keepPetOnScreen);
    screen.on("display-removed", keepPetOnScreen);
    screen.on("display-metrics-changed", keepPetOnScreen);
    return startDesktop();
  });
}

app.on("activate", () => {
  if (isLive(petWindow) && petRendererReady) {
    placePetWindow(petWindow);
    petWindow.show();
    petWindow.focus();
    petWindow.moveTop();
  } else if (!showHostWindow()) {
    void startDesktop();
  }
});

app.on("before-quit", () => {
  quitting = true;
  resetPetEdgeTracking();
  stopManagedServer();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
