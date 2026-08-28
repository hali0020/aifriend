const PET_CHANNEL = "amadeus.desktop-pet.v1";
const PET_PROTOCOL = 1;
const VALID_PHASES = new Set(["idle", "thinking", "streaming", "complete", "error", "aborted"]);
const PET_ANIMATION_STATES = new Set(["idle", "happy", "angry", "shy", "surprised", "sad", "smug", "thinking", "deadpan", "sleepy", "excited", "confused", "panicked"]);
const PET_CHARACTER = "克里斯提娜（牧濑红莉西）";
const PET_ANIMATION_MANIFEST_PATH = "/desktop-pet-assets/animations/manifest.json";
const PET_ANIMATION_MANIFEST_RELATIVE = "desktop-pet-assets/animations/manifest.json";
const PET_ANIMATION_ROOT = "/desktop-pet-assets/animations/";
const PET_POSE_CATALOG_PATH = "/desktop-pet-assets/catalog.json";
const PET_POSE_ROOT = "/desktop-pet-assets/";
const PET_POSE_FILE = /^makise-kurisu-chibi-(\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.png$/;
const PET_POSE_STATE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PET_FRAME_PATH = /^[a-z0-9][a-z0-9_-]*\/frame-[0-9]{2}\.png$/;
const PET_EDGE_STATES = new Set(["none", "moving", "top", "bottom", "left", "right"]);
const PET_EDGE_POSES = Object.freeze({
  none: Object.freeze({ id: 0, state: "" }),
  moving: Object.freeze({ id: 20, state: "dragged-floating" }),
  top: Object.freeze({ id: 36, state: "catching-edge-both-hands" }),
  bottom: Object.freeze({ id: 33, state: "sitting-window-edge" }),
  left: Object.freeze({ id: 19, state: "peeking-edge" }),
  right: Object.freeze({ id: 19, state: "peeking-edge" })
});
const VERIFIED_POSE_CATALOGS = new WeakSet();
const PET_ANIMATION_PATTERNS = [
  ["sleepy", /困|想睡|睡不着|晚安|休息|疲惫|太累|很累|打哈欠/],
  ["panicked", /糟糕|危险|来不及|慌|崩溃|严重错误|失败了/],
  ["sad", /难过|伤心|遗憾|失望|低落|不好受|委屈|状态不太好|心情不好|对不起|抱歉/],
  ["angry", /生气|恼火|可恶|笨蛋|不许|别闹/],
  ["shy", /害羞|脸红|喜欢你|谢谢夸奖|不好意思/],
  ["surprised", /居然|竟然|意外|没想到|真的吗|怎么会/],
  ["excited", /成功|完成了|太好了|好耶|恭喜|赢了|搞定/],
  ["confused", /不明白|不确定|怎么回事|为什么|疑惑|奇怪/],
  ["smug", /当然|显然|早就|我就知道|小菜一碟/],
  ["deadpan", /无语|离谱|算了|真是的/]
];

const PET_STYLE = `
  :root{color-scheme:light;--ink:#26352e;--muted:#6e7c74;--line:#d5ddd7;--glass:#fffdf9ed;--accent:#6f9a82}
  *{box-sizing:border-box}
  html,body{width:100%;height:100%;margin:0;overflow:hidden}
  body{font-family:Inter,"PingFang SC","Microsoft YaHei",sans-serif;color:var(--ink);background:linear-gradient(145deg,#eef3ef,#dfe9e3)}
  button,input{font:inherit}button{cursor:pointer}
  button:focus-visible,input:focus-visible{outline:3px solid #52776655;outline-offset:2px}
  .pet-shell{position:relative;width:100%;height:100%;min-height:320px;padding:8px;isolation:isolate;user-select:none;pointer-events:none}
  .pet-stage{position:relative;width:100%;height:100%;pointer-events:none}
  .pet-card{position:absolute;z-index:4;top:4px;right:14px;left:14px;display:grid;justify-items:center;gap:7px;pointer-events:none}
  .pet-status{position:relative;display:grid;grid-template-columns:7px minmax(0,1fr);align-items:center;column-gap:7px;width:min(190px,calc(100% - 66px));min-height:29px;overflow:hidden;border:1px solid #ffffffd6;border-radius:999px;padding:6px 11px;background:var(--glass);box-shadow:0 5px 15px #263a2f24;pointer-events:auto}
  .pet-status::after{content:"";position:absolute;right:10px;bottom:3px;left:25px;height:2px;border-radius:2px;background:linear-gradient(90deg,var(--accent),#b8cec1)}
  .pet-status i{width:7px;height:7px;border-radius:50%;background:#71a582;box-shadow:0 0 0 3px #71a58220}
  .pet-status b{display:block;overflow:hidden;padding-bottom:2px;font-size:11px;line-height:1.15;text-overflow:ellipsis;white-space:nowrap}
  .pet-status small{display:none}
  .pet-shell[data-phase="thinking"] .pet-status::after,.pet-shell[data-phase="streaming"] .pet-status::after{background:linear-gradient(90deg,var(--accent),#b9d1c3,var(--accent));background-size:180% 100%;animation:pet-progress 1.15s linear infinite}
  .pet-bubble{position:relative;width:min(250px,100%);min-height:0;max-height:74px;overflow:hidden;border:1px solid #cfd8d2;border-radius:16px;padding:9px 12px;background:#fffffff2;color:var(--ink);box-shadow:0 8px 22px #263a2f28;font-size:12px;line-height:1.5;text-align:center;white-space:pre-wrap;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;pointer-events:auto}
  .pet-bubble::after{content:"";position:absolute;bottom:-7px;left:50%;width:12px;height:12px;border-right:1px solid #cfd8d2;border-bottom:1px solid #cfd8d2;background:#fff;transform:translateX(-50%) rotate(45deg)}
  .pet-bubble.expanded{max-height:130px;overflow:auto;display:block;-webkit-line-clamp:unset;text-align:left}
  .pet-avatar{position:absolute;z-index:2;right:50%;bottom:3px;width:224px;height:238px;overflow:visible;border:0;padding:0;background:transparent;transform:translateX(50%);pointer-events:auto}
  .pet-avatar img{width:100%;height:100%;object-fit:contain;object-position:center bottom;filter:drop-shadow(0 12px 8px #1d30262f);pointer-events:none;animation:pet-breathe 4.8s ease-in-out infinite}
  .pet-avatar img[data-fallback="true"]{border-radius:46%;background:#fff;mix-blend-mode:multiply;object-fit:cover;object-position:center 18%}
  .pet-avatar.thinking img{animation:pet-think 1.05s ease-in-out infinite}
  .pet-avatar.speaking img{filter:drop-shadow(0 0 7px #7fb493aa) drop-shadow(0 12px 8px #1d30262f)}
  .pet-name{position:absolute;z-index:3;right:50%;bottom:1px;max-width:190px;overflow:hidden;border:1px solid #ffffffd0;border-radius:999px;padding:4px 10px;background:#ffffffc9;box-shadow:0 4px 12px #20322922;color:#52645a;font-size:10px;text-overflow:ellipsis;white-space:nowrap;transform:translateX(50%);pointer-events:none}
  .pet-controls{position:absolute;z-index:8;top:104px;right:2px;display:flex;flex-direction:column;gap:4px;opacity:0;transform:translateX(3px);transition:opacity .15s ease,transform .15s ease;pointer-events:none}
  .pet-shell:hover .pet-controls,.pet-shell:focus-within .pet-controls{opacity:1;transform:none;pointer-events:auto}
  .pet-controls button{display:grid;width:28px;height:28px;place-items:center;border:1px solid #c4d0c8;border-radius:9px;padding:0;background:#f9fcfaf2;color:#43564c;box-shadow:0 4px 10px #263a2f24;font-size:12px}
  .pet-controls button[hidden]{display:none}
  .pet-bottom{position:absolute;z-index:10;right:6px;bottom:8px;left:6px;display:grid;gap:6px;border:1px solid #ffffffd6;border-radius:15px;padding:8px;background:#f8fbf8f2;box-shadow:0 10px 28px #23352c38;opacity:0;transform:translateY(14px) scale(.97);pointer-events:none;transition:opacity .16s ease,transform .16s ease;user-select:auto}
  .pet-shell.chat-open .pet-bottom{opacity:1;transform:none;pointer-events:auto}
  .pet-form{display:grid;grid-template-columns:1fr auto;gap:6px}
  .pet-form input{min-width:0;border:1px solid var(--line);border-radius:10px;background:#fff;padding:8px 9px;color:var(--ink);outline:none;font-size:12px}
  .pet-form input:focus{border-color:#91aa9d;box-shadow:0 0 0 3px #91aa9d22}
  .pet-form button,.pet-actions button{border:1px solid var(--line);border-radius:9px;background:#fff;padding:7px 9px;color:#506159;font-size:11px}
  .pet-form button{border-color:var(--ink);background:var(--ink);color:#fff}
  .pet-actions{display:flex;gap:5px}.pet-actions button{flex:1}
  .pet-actions button:disabled,.pet-form button:disabled{cursor:not-allowed;opacity:.42}
  .pet-mode{display:none}
  body.native-pet-page{background:transparent!important}
  body.native-pet-page .pet-shell{background:transparent}
  body.native-pet-page .pet-status{-webkit-app-region:drag;app-region:drag}
  body.native-pet-page .pet-avatar,body.native-pet-page .pet-bubble,body.native-pet-page .pet-controls,body.native-pet-page .pet-controls button,body.native-pet-page .pet-bottom,body.native-pet-page button,body.native-pet-page input{-webkit-app-region:no-drag;app-region:no-drag}
  @keyframes pet-breathe{0%,100%{transform:translateY(0) rotate(0)}50%{transform:translateY(-4px) rotate(1deg)}}
  @keyframes pet-think{0%,100%{transform:translateY(0) rotate(-1deg)}50%{transform:translateY(-6px) rotate(1deg)}}
  @keyframes pet-progress{to{background-position:-180% 0}}
  @media(max-height:330px){.pet-avatar{width:190px;height:196px}.pet-bubble{max-height:58px;-webkit-line-clamp:2}.pet-name{display:none}}
  @media(prefers-reduced-motion:reduce){.pet-avatar img,.pet-avatar.thinking img,.pet-status::after{animation:none!important}}
  @media(forced-colors:active){.pet-status,.pet-bubble,.pet-bottom,.pet-controls button{border:1px solid CanvasText}.pet-status i{background:CanvasText}}
`;

const clean = (value, limit = 500) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
const shortReply = value => {
  const text = clean(value, 2000);
  return text.length > 240 ? `${text.slice(0, 239)}…` : text;
};
const isRecord = value => !!value && typeof value === "object" && !Array.isArray(value);
const makeId = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;

function exactKeys(value, expected) {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every(key => keys.includes(key));
}

function trustedPageUrl(pageUrl) {
  const parsed = new URL(String(pageUrl || ""));
  if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) throw new TypeError("桌宠资源基准地址无效");
  return parsed;
}

function unsafeRelativePath(value) {
  return typeof value !== "string"
    || !value
    || value !== value.trim()
    || value.length > 240
    || value.startsWith("/")
    || value.includes("//")
    || value.includes("\\")
    || value.includes("..")
    || /[%?#\u0000-\u001f\u007f]/.test(value)
    || /^[a-z][a-z0-9+.-]*:/i.test(value);
}

export function desktopPetPoseForEdgeState(value) {
  return PET_EDGE_STATES.has(value) ? PET_EDGE_POSES[value] : null;
}

export function desktopPetSurfaceOrder() {
  return ["embedded"];
}

export function nextDesktopPetRoamTarget({
  viewportWidth,
  viewportHeight,
  petWidth,
  petHeight,
  currentRight,
  currentBottom,
  randomX = 0.5,
  randomY = 0.5,
  margin = 14
} = {}) {
  const values = [viewportWidth, viewportHeight, petWidth, petHeight, currentRight, currentBottom, randomX, randomY, margin];
  if (values.some(value => typeof value !== "number" || !Number.isFinite(value))
    || viewportWidth <= 0 || viewportHeight <= 0 || petWidth <= 0 || petHeight <= 0 || margin < 0) return null;
  const maxRight = Math.max(margin, viewportWidth - petWidth - margin);
  const maxBottom = Math.max(margin, viewportHeight - petHeight - margin);
  const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
  const boundedRandom = value => clamp(value, 0, 1);
  const stepX = Math.min(220, Math.max(36, (maxRight - margin) * 0.45));
  const stepY = Math.min(130, Math.max(28, (maxBottom - margin) * 0.4));
  const right = clamp(currentRight + (boundedRandom(randomX) * 2 - 1) * stepX, margin, maxRight);
  const bottom = clamp(currentBottom + (boundedRandom(randomY) * 2 - 1) * stepY, margin, maxBottom);
  return Object.freeze({ right: Math.round(right), bottom: Math.round(bottom) });
}

export function resolveDesktopPetAnimationManifestUrl(value, pageUrl) {
  if (value !== PET_ANIMATION_MANIFEST_RELATIVE) throw new TypeError("桌宠动画清单必须使用固定相对路径");
  const page = trustedPageUrl(pageUrl);
  const resolved = new URL(value, page);
  if (resolved.origin !== page.origin
    || resolved.pathname !== PET_ANIMATION_MANIFEST_PATH
    || resolved.search
    || resolved.hash) throw new TypeError("桌宠动画清单地址越界");
  return resolved.href;
}

export function resolveDesktopPetAnimationFrameUrl(value, manifestUrl, pageUrl) {
  if (unsafeRelativePath(value) || !PET_FRAME_PATH.test(value)) throw new TypeError("桌宠动画帧路径无效");
  const page = trustedPageUrl(pageUrl);
  const manifest = new URL(String(manifestUrl || ""), page);
  if (manifest.origin !== page.origin
    || manifest.pathname !== PET_ANIMATION_MANIFEST_PATH
    || manifest.search
    || manifest.hash) throw new TypeError("桌宠动画清单地址越界");
  const resolved = new URL(value, manifest);
  if (resolved.origin !== page.origin
    || !resolved.pathname.startsWith(PET_ANIMATION_ROOT)
    || resolved.search
    || resolved.hash) throw new TypeError("桌宠动画帧地址越界");
  return resolved.href;
}

function resolveDesktopPetPoseCatalogUrl(value, pageUrl) {
  if (value !== PET_POSE_CATALOG_PATH && value !== PET_POSE_CATALOG_PATH.slice(1)) throw new TypeError("桌宠姿态清单必须使用固定路径");
  const page = trustedPageUrl(pageUrl);
  const resolved = new URL(value.startsWith("/") ? value : `/${value}`, page);
  if (resolved.origin !== page.origin
    || resolved.pathname !== PET_POSE_CATALOG_PATH
    || resolved.search
    || resolved.hash) throw new TypeError("桌宠姿态清单地址越界");
  return resolved.href;
}

export function parseDesktopPetPoseCatalog(value, {
  pageUrl = "http://127.0.0.1/",
  catalogUrl = PET_POSE_CATALOG_PATH
} = {}) {
  const catalogSource = resolveDesktopPetPoseCatalogUrl(catalogUrl, pageUrl);
  const page = trustedPageUrl(pageUrl);
  if (!exactKeys(value, ["version", "character", "reference", "assets"])
    || value.version !== 1
    || value.character !== PET_CHARACTER
    || typeof value.reference !== "string"
    || !Array.isArray(value.assets)
    || value.assets.length < 1
    || value.assets.length > 99) throw new TypeError("桌宠姿态清单结构无效");

  const states = new Set();
  const files = new Set();
  const assets = value.assets.map((asset, index) => {
    const expectedId = index + 1;
    if (!exactKeys(asset, ["id", "state", "file"])
      || !Number.isSafeInteger(asset.id)
      || asset.id !== expectedId
      || typeof asset.state !== "string"
      || !PET_POSE_STATE.test(asset.state)
      || typeof asset.file !== "string") throw new TypeError("桌宠姿态条目结构无效");
    const match = PET_POSE_FILE.exec(asset.file);
    if (!match
      || Number(match[1]) !== asset.id
      || match[2] !== asset.state
      || states.has(asset.state)
      || files.has(asset.file)) throw new TypeError("桌宠姿态条目编号或文件名无效");
    states.add(asset.state);
    files.add(asset.file);
    const url = new URL(asset.file, catalogSource);
    if (url.origin !== page.origin
      || !url.pathname.startsWith(PET_POSE_ROOT)
      || url.pathname !== `${PET_POSE_ROOT}${asset.file}`
      || url.search
      || url.hash) throw new TypeError("桌宠姿态文件地址越界");
    return Object.freeze({ id: asset.id, state: asset.state, file: asset.file, url: url.href });
  });
  if (value.reference !== assets[0].file) throw new TypeError("桌宠姿态参考图无效");
  const parsed = Object.freeze({
    version: 1,
    character: PET_CHARACTER,
    reference: value.reference,
    assets: Object.freeze(assets)
  });
  VERIFIED_POSE_CATALOGS.add(parsed);
  return parsed;
}

export function selectNextDesktopPetManualPose(catalog, currentId = 0) {
  if (!isRecord(catalog)
    || !VERIFIED_POSE_CATALOGS.has(catalog)
    || !Object.isFrozen(catalog)
    || !Array.isArray(catalog.assets)
    || !Object.isFrozen(catalog.assets)
    || catalog.assets.length < 1) return null;
  const candidates = catalog.assets.slice(-12);
  const currentIndex = Number.isSafeInteger(currentId)
    ? candidates.findIndex(asset => asset.id === currentId)
    : -1;
  const selected = candidates[currentIndex >= 0 ? (currentIndex + 1) % candidates.length : 0];
  if (!selected
    || !Object.isFrozen(selected)
    || !Number.isSafeInteger(selected.id)
    || selected.id < 1
    || typeof selected.state !== "string"
    || !PET_POSE_STATE.test(selected.state)) return null;
  return Object.freeze({ id: selected.id, state: selected.state });
}

export function desktopPetEmotionForText(value) {
  const text = clean(value, 2000);
  for (const [name, pattern] of PET_ANIMATION_PATTERNS) if (pattern.test(text)) return name;
  return "";
}

export function desktopPetAnimationForState(state) {
  if (!isRecord(state)) return "idle";
  if (state.phase === "thinking" || state.phase === "streaming" || state.hostBusy === true || state.gameBusy === true) return "thinking";
  if (state.phase === "error") return "panicked";
  if (state.phase === "aborted") return "deadpan";
  if (PET_ANIMATION_STATES.has(state.emotion)) return state.emotion;
  const inferred = desktopPetEmotionForText(`${state.reply || ""} ${state.label || ""} ${state.detail || ""}`);
  if (inferred) return inferred;
  if (state.speaking || state.phase === "complete") return "happy";
  return "idle";
}

function animationNameForState(state) {
  return desktopPetAnimationForState(state);
}

function createPetFrameAnimator(targetWindow, image, manifestUrl, catalogUrl) {
  let manifest = null;
  let poseCatalog = null;
  let catalogSettled = false;
  let desiredState = "idle";
  let desiredPose = "";
  let desiredPoseId = 0;
  let failedPose = "";
  let activeState = "";
  let activePose = "";
  let pendingKey = "";
  let timer = null;
  let generation = 0;
  let disposed = false;
  let visualAbortController = null;
  const AbortControllerClass = targetWindow.AbortController || globalThis.AbortController;
  const manifestAbortController = AbortControllerClass ? new AbortControllerClass() : null;
  const catalogAbortController = AbortControllerClass ? new AbortControllerClass() : null;
  const pageUrl = window.location.href;
  const reducedMotion = targetWindow.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
  let manifestSource = "";
  let catalogSource = "";
  try { manifestSource = resolveDesktopPetAnimationManifestUrl(manifestUrl, pageUrl); } catch {}
  try { catalogSource = resolveDesktopPetPoseCatalogUrl(catalogUrl, pageUrl); } catch { catalogSettled = true; }

  const stopVisual = () => {
    generation += 1;
    pendingKey = "";
    if (timer !== null) targetWindow.clearTimeout(timer);
    timer = null;
    visualAbortController?.abort();
    visualAbortController = null;
  };

  const beginVisualLoad = key => {
    stopVisual();
    pendingKey = key;
    visualAbortController = AbortControllerClass ? new AbortControllerClass() : null;
    return { currentGeneration: generation, signal: visualAbortController?.signal };
  };

  const setRuntimeSource = source => {
    delete image.dataset.fallback;
    image.dataset.runtimeAsset = "true";
    image.src = source;
  };

  const preload = (sources, signal) => Promise.all(sources.map(source => new Promise(resolve => {
    if (signal?.aborted) return resolve(false);
    const loader = new targetWindow.Image();
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      loader.onload = null;
      loader.onerror = null;
      signal?.removeEventListener("abort", abort);
      resolve(result);
    };
    const abort = () => {
      loader.src = "";
      finish(false);
    };
    loader.onload = () => finish(true);
    loader.onerror = () => finish(false);
    signal?.addEventListener("abort", abort, { once: true });
    loader.src = source;
  })));

  const stateConfig = name => {
    const states = isRecord(manifest?.states) ? manifest.states : {};
    const selectedName = isRecord(states[name]) ? name : "idle";
    const selected = states[selectedName];
    if (!isRecord(selected)
      || !Array.isArray(selected.frames)
      || selected.frames.length < 4
      || selected.frames.length > 12
      || selected.frameCount !== selected.frames.length) return null;
    const frames = [];
    try {
      for (const frame of selected.frames) {
        if (!isRecord(frame)
          || !Number.isSafeInteger(frame.durationMs)
          || frame.durationMs < 40
          || frame.durationMs > 5000
          || frame.path.split("/")[0] !== selectedName) return null;
        frames.push({
          path: frame.path,
          durationMs: frame.durationMs,
          url: resolveDesktopPetAnimationFrameUrl(frame.path, manifestSource, pageUrl)
        });
      }
    } catch {
      return null;
    }
    return { loop: selected.loop !== false, pingPong: selected.pingPong !== false, frames };
  };

  async function play(name, force = false) {
    if (disposed || !manifest || (!force && desiredPose && failedPose !== desiredPose)) return;
    const config = stateConfig(name);
    if (!config) return;
    const key = `animation:${name}`;
    if (pendingKey === key) return;
    const { currentGeneration, signal } = beginVisualLoad(key);
    const loaded = await preload(config.frames.map(frame => frame.url), signal);
    if (disposed || currentGeneration !== generation || pendingKey !== key) return;
    pendingKey = "";
    if (loaded.some(value => !value)) {
      activeState = "";
      return;
    }
    activeState = name;
    activePose = "";
    const lastIndex = config.frames.length - 1;
    if (reducedMotion) {
      setRuntimeSource(config.frames[name === "idle" ? 0 : lastIndex].url);
      return;
    }
    const forward = config.frames.map((_, index) => index);
    const order = config.pingPong === false || config.frames.length < 3
      ? forward
      : [...forward, ...forward.slice(1, -1).reverse()];
    let position = 0;
    const advance = () => {
      if (disposed || currentGeneration !== generation || activeState !== name || desiredPose && failedPose !== desiredPose) return;
      const frame = config.frames[order[position]];
      setRuntimeSource(frame.url);
      position += 1;
      if (position >= order.length) {
        if (config.loop === false) return;
        position = 0;
      }
      timer = targetWindow.setTimeout(advance, frame.durationMs);
    };
    advance();
  }

  function resumeAfterPoseFailure(name, expectedId) {
    if (disposed || desiredPose !== name || desiredPoseId !== expectedId) return;
    failedPose = name;
    activePose = "";
    activeState = "";
    if (manifest) void play(desiredState, true);
  }

  async function showPose(name) {
    if (disposed || !poseCatalog || desiredPose !== name) return;
    const expectedId = desiredPoseId;
    const asset = poseCatalog.assets.find(item => item.id === expectedId && item.state === name);
    if (!asset) {
      stopVisual();
      resumeAfterPoseFailure(name, expectedId);
      return;
    }
    const key = `pose:${expectedId}:${name}`;
    if (pendingKey === key || activePose === name) return;
    const { currentGeneration, signal } = beginVisualLoad(key);
    const [loaded] = await preload([asset.url], signal);
    if (disposed
      || currentGeneration !== generation
      || pendingKey !== key
      || desiredPose !== name
      || desiredPoseId !== expectedId) return;
    pendingKey = "";
    if (!loaded) {
      resumeAfterPoseFailure(name, expectedId);
      return;
    }
    failedPose = "";
    activeState = "";
    activePose = name;
    setRuntimeSource(asset.url);
  }

  function setPose(name = "", id = 0) {
    if (disposed) return false;
    const next = typeof name === "string" && PET_POSE_STATE.test(name) ? name : "";
    const nextId = next && Number.isSafeInteger(id) && id > 0 && id <= 99 ? id : 0;
    if (next && !nextId) return false;
    if (next === desiredPose && nextId === desiredPoseId) return true;
    desiredPose = next;
    desiredPoseId = nextId;
    failedPose = "";
    if (!next) {
      stopVisual();
      activePose = "";
      activeState = "";
      if (manifest) void play(desiredState, true);
    } else if (poseCatalog) {
      void showPose(next);
    } else if (catalogSettled) {
      resumeAfterPoseFailure(next, nextId);
    }
    return true;
  }

  const fetchJson = async (source, controller, maximumLength) => {
    const response = await targetWindow.fetch(source, { cache: "no-store", signal: controller?.signal });
    if (!response.ok) throw new Error(`桌宠资源清单加载失败（${response.status}）`);
    const text = await response.text();
    if (!text || text.length > maximumLength) throw new Error("桌宠资源清单大小无效");
    return JSON.parse(text);
  };

  if (manifestSource) {
    fetchJson(manifestSource, manifestAbortController, 256_000)
      .then(data => {
        if (disposed
          || !isRecord(data)
          || data.version !== 1
          || !isRecord(data.states)
          || Object.keys(data.states).length !== PET_ANIMATION_STATES.size
          || Object.keys(data.states).some(name => !PET_ANIMATION_STATES.has(name))) throw new Error("桌宠动画清单格式无效");
        manifest = data;
        if (!desiredPose || failedPose === desiredPose) return play(desiredState, true);
      })
      .catch(() => {});
  }

  if (catalogSource) {
    fetchJson(catalogSource, catalogAbortController, 256_000)
      .then(data => {
        if (disposed) return;
        poseCatalog = parseDesktopPetPoseCatalog(data, { pageUrl, catalogUrl });
        catalogSettled = true;
        if (desiredPose) return showPose(desiredPose);
      })
      .catch(() => {
        if (disposed) return;
        catalogSettled = true;
        poseCatalog = null;
        if (desiredPose) resumeAfterPoseFailure(desiredPose, desiredPoseId);
      });
  }

  return {
    setState(name) {
      if (disposed) return;
      const next = PET_ANIMATION_STATES.has(name) ? name : "idle";
      desiredState = next;
      if (manifest
        && (!desiredPose || failedPose === desiredPose)
        && next !== activeState
        && pendingKey !== `animation:${next}`) void play(next, failedPose === desiredPose);
    },
    setPose,
    nextPose(currentId = 0) {
      if (disposed || !catalogSettled || !poseCatalog) return null;
      const next = selectNextDesktopPetManualPose(poseCatalog, currentId);
      if (!next || !setPose(next.state, next.id)) return null;
      return next;
    },
    catalogReady() {
      return !disposed && catalogSettled && !!poseCatalog;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      manifestAbortController?.abort();
      catalogAbortController?.abort();
      stopVisual();
      desiredPose = "";
      desiredPoseId = 0;
      activePose = "";
      activeState = "";
    }
  };
}

function safeState(value) {
  if (!isRecord(value) || !isRecord(value.response) || !isRecord(value.speech) || !isRecord(value.game)) return null;
  const phase = VALID_PHASES.has(value.response.phase) ? value.response.phase : "idle";
  return {
    reply: shortReply(value.reply) || "所以，今天想聊什么？",
    label: clean(value.response.label, 60) || "连接正常",
    detail: clean(value.response.detail, 160),
    phase,
    thinking: phase === "thinking" || phase === "streaming",
    speaking: value.speech.speaking === true,
    voice: value.speech.enabled === true,
    gameActive: value.game.active === true,
    gameBusy: value.game.busy === true,
    hostBusy: value.hostBusy === true,
    emotion: PET_ANIMATION_STATES.has(value.emotion) ? value.emotion : ""
  };
}

function installPetUi(doc, avatarUrl, spriteUrl, native = false, mountRoot = null) {
  let petStyle = (mountRoot || doc).querySelector("style[data-desktop-pet]");
  if (!petStyle) {
    const meta = doc.createElement("meta");
    meta.name = "viewport";
    meta.content = "width=device-width,initial-scale=1";
    if (!mountRoot && !doc.querySelector('meta[name="viewport"]')) doc.head.append(meta);
    petStyle = doc.createElement("style");
    petStyle.dataset.desktopPet = "";
    petStyle.textContent = mountRoot
      ? `:host{display:block;width:100%;height:100%;color-scheme:light;--ink:#26352e;--muted:#6e7c74;--line:#d5ddd7;--glass:#fffdf9ed;--accent:#6f9a82}${PET_STYLE}`
      : PET_STYLE;
    if (!mountRoot) doc.head.append(petStyle);
  }
  if (!mountRoot) {
    doc.title = "克里斯提娜 · 桌宠";
    doc.body.classList.toggle("native-pet-page", native);
  }
  const root = doc.createElement("main");
  root.className = "pet-shell";
  root.innerHTML = `<section class="pet-stage"><div class="pet-controls"><button class="pet-chat" type="button" title="输入消息" aria-label="输入消息" aria-expanded="false">⌨</button><button class="pet-action" type="button" title="切换桌宠动作" aria-label="切换桌宠动作">动</button><button class="pet-main" type="button" title="返回主界面" aria-label="返回主界面">↗</button><button class="pet-close" type="button" title="退出桌宠" aria-label="退出桌宠">×</button></div><section class="pet-card"><div class="pet-status" role="status" aria-live="polite" aria-atomic="true"><i aria-hidden="true"></i><div><b></b><small></small></div></div><button class="pet-bubble" type="button" aria-expanded="false" title="展开或收起回复"></button></section><button class="pet-avatar" type="button" title="按住拖动桌宠"><img alt="克里斯提娜 2D 桌宠"></button><div class="pet-name">克里斯提娜 · 牧濑红莉西</div></section><section class="pet-bottom"><form class="pet-form"><input maxlength="500" autocomplete="off" placeholder="直接问她…" aria-label="给克里斯提娜发送消息"><button type="submit">发送</button></form><div class="pet-actions"><button class="pet-snapshot" type="button">看一下游戏</button><button class="pet-voice" type="button" aria-pressed="false">声音：关</button><button class="pet-trash" type="button" hidden>移入回收站</button></div><div class="pet-mode"></div></section>`;
  if (mountRoot) mountRoot.replaceChildren(petStyle, root);
  else doc.body.replaceChildren(root);
  const refs = {
    root,
    avatar: root.querySelector(".pet-avatar"),
    avatarImage: root.querySelector(".pet-avatar img"),
    reply: root.querySelector(".pet-bubble"),
    label: root.querySelector(".pet-status b"),
    detail: root.querySelector(".pet-status small"),
    form: root.querySelector(".pet-form"),
    input: root.querySelector(".pet-form input"),
    send: root.querySelector(".pet-form button"),
    snapshot: root.querySelector(".pet-snapshot"),
    voice: root.querySelector(".pet-voice"),
    trash: root.querySelector(".pet-trash"),
    chat: root.querySelector(".pet-chat"),
    action: root.querySelector(".pet-action"),
    main: root.querySelector(".pet-main"),
    close: root.querySelector(".pet-close"),
    mode: root.querySelector(".pet-mode")
  };
  const avatarSource = new URL(avatarUrl, window.location.href).href;
  const preferredSprite = String(spriteUrl || "");
  const sources = [
    preferredSprite,
    preferredSprite.endsWith(".webp") ? preferredSprite.replace(/\.webp$/i, ".png") : "",
    avatarUrl
  ].filter((value, index, values) => value && values.indexOf(value) === index).map(value => new URL(value, window.location.href).href);
  let sourceIndex = 0;
  refs.avatarImage.addEventListener("error", () => {
    if (refs.avatarImage.dataset.runtimeAsset === "true") return;
    sourceIndex += 1;
    if (sourceIndex >= sources.length) return;
    if (sources[sourceIndex] === avatarSource) refs.avatarImage.dataset.fallback = "true";
    refs.avatarImage.src = sources[sourceIndex];
  });
  refs.avatarImage.src = sources[0] || avatarSource;
  const expand = () => {
    const expanded = refs.reply.classList.toggle("expanded");
    refs.reply.setAttribute("aria-expanded", String(expanded));
  };
  refs.avatar.addEventListener("click", expand);
  refs.reply.addEventListener("click", expand);
  return refs;
}

export function createDesktopPet({
  role = "standalone",
  trigger,
  avatarUrl = "/christina-avatar.webp",
  spriteUrl = "/christina-desktop-pet.webp",
  animationUrl = PET_ANIMATION_MANIFEST_RELATIVE,
  poseCatalogUrl = PET_POSE_CATALOG_PATH,
  initialReply,
  onSend,
  onSnapshot,
  onSetVoice,
  onToggleVoice,
  onTrashFile,
  onOpenMain,
  onNativeToggle,
  onNativeClose
} = {}) {
  const resolvedRole = ["standalone", "host", "pet"].includes(role) ? role : "standalone";
  let petWindow = null;
  let embeddedRoot = null;
  let refs = null;
  let animator = null;
  let uiWindow = null;
  let keydownHandler = null;
  let opening = false;
  let mode = resolvedRole === "pet" ? "native" : "closed";
  let nativeVisible = resolvedRole === "host";
  let disposed = false;
  let broadcastTimer = null;
  let readyTimer = null;
  let manualPoseTimer = null;
  let poseResumeTimer = null;
  let emotionTimer = null;
  let roamTimer = null;
  let roamVisibilityHandler = null;
  let roamResizeHandler = null;
  let roamRight = 22;
  let roamBottom = 22;
  let manualPoseId = 0;
  let manualPose = null;
  let poseSuppressed = false;
  let edgeState = "none";
  let receivedState = false;
  let lastHostId = "";
  let lastSequence = 0;
  const hostId = makeId("host");
  const petId = makeId("pet");
  let sequence = 0;
  const pending = new Map();
  const ackCache = new Map();
  const state = {
    reply: shortReply(initialReply) || "所以，今天想聊什么？",
    label: "连接正常",
    detail: "这里随时可以继续。",
    phase: "idle",
    thinking: false,
    speaking: false,
    voice: false,
    gameActive: false,
    gameBusy: false,
    hostBusy: false,
    emotion: ""
  };
  const channel = resolvedRole === "standalone" || !("BroadcastChannel" in window) ? null : new BroadcastChannel(PET_CHANNEL);

  const isStandaloneOpen = () => {
    if (embeddedRoot) return embeddedRoot.isConnected;
    try { return !!petWindow && petWindow !== window && !petWindow.closed; } catch { return false; }
  };
  const isOpen = () => resolvedRole === "standalone" ? isStandaloneOpen() : resolvedRole === "host" ? nativeVisible : !!refs;

  function setText(node, value) {
    if (node && node.textContent !== value) node.textContent = value;
  }

  function syncTrigger() {
    if (!trigger) return;
    const active = isOpen();
    delete trigger.dataset.error;
    trigger.removeAttribute("aria-label");
    trigger.classList.toggle("active", active);
    trigger.setAttribute("aria-pressed", String(active));
    trigger.textContent = active ? "收起桌宠" : "桌宠";
    trigger.title = active ? "收起桌宠" : "打开桌宠";
  }

  function pendingHas(command) {
    for (const item of pending.values()) if (item.command === command) return true;
    return false;
  }

  function poseAllowed() {
    return !poseSuppressed && !state.hostBusy && !state.gameBusy && !state.speaking;
  }

  function effectivePose() {
    if (!poseAllowed()) return PET_EDGE_POSES.none;
    return manualPose || PET_EDGE_POSES[edgeState] || PET_EDGE_POSES.none;
  }

  function render() {
    if (!refs) return;
    refs.root.dataset.phase = state.phase;
    refs.root.dataset.emotion = animationNameForState(state);
    setText(refs.reply, state.reply);
    setText(refs.label, state.label);
    setText(refs.detail, state.detail);
    refs.avatar.classList.toggle("thinking", state.thinking);
    refs.avatar.classList.toggle("speaking", state.speaking);
    animator?.setState(animationNameForState(state));
    const pose = effectivePose();
    animator?.setPose(pose.state, pose.id);
    setText(refs.voice, state.voice ? "声音：开" : "声音：关");
    refs.voice.setAttribute("aria-pressed", String(state.voice));
    refs.snapshot.disabled = !state.gameActive || state.gameBusy || pendingHas("game.snapshot");
    setText(refs.snapshot, state.gameBusy ? "分析中…" : "看一下游戏");
    refs.send.disabled = pendingHas("chat.send");
    refs.voice.disabled = pendingHas("voice.set");
    refs.trash.disabled = pendingHas("file.trash");
    refs.action.disabled = !poseAllowed();
    setText(refs.mode, mode === "pip" ? "置顶桌宠 · 关闭主页面时自动退出" : mode === "native" ? "Electron 桌宠 · 本地连接" : mode === "embedded" ? "页面内桌宠 · 当前标签页" : "迷你窗口 · 是否置顶由系统决定");
  }

  function snapshotState() {
    return {
      reply: shortReply(state.reply),
      response: { phase: state.phase, label: clean(state.label, 60), detail: clean(state.detail, 160) },
      speech: { enabled: state.voice, speaking: state.speaking },
      game: { active: state.gameActive, busy: state.gameBusy },
      hostBusy: state.hostBusy,
      emotion: state.emotion
    };
  }

  function post(message) {
    if (!channel || disposed) return false;
    try { channel.postMessage(message); return true; } catch { return false; }
  }

  function sendState() {
    broadcastTimer = null;
    if (resolvedRole !== "host") return;
    post({ v: PET_PROTOCOL, source: "host", kind: "state", hostId, seq: ++sequence, ts: Date.now(), state: snapshotState() });
  }

  function publish(immediate = false) {
    if (resolvedRole !== "host") return;
    if (immediate) {
      clearTimeout(broadcastTimer);
      broadcastTimer = null;
      sendState();
    } else if (!broadcastTimer) broadcastTimer = setTimeout(sendState, 50);
  }

  function changed(immediate = true) {
    render();
    publish(immediate);
  }

  function setTransientStatus(label, detail) {
    state.label = clean(label, 60) || "连接正常";
    state.detail = clean(detail, 160);
    render();
  }

  function clearRoaming() {
    if (roamTimer !== null) window.clearTimeout(roamTimer);
    roamTimer = null;
    if (roamVisibilityHandler) document.removeEventListener("visibilitychange", roamVisibilityHandler);
    roamVisibilityHandler = null;
    if (roamResizeHandler) window.removeEventListener("resize", roamResizeHandler);
    roamResizeHandler = null;
    embeddedRoot?.removeAttribute("data-roaming");
  }

  function clampRoamingToViewport() {
    if (resolvedRole !== "standalone" || !embeddedRoot?.isConnected) return;
    const target = nextDesktopPetRoamTarget({
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      petWidth: embeddedRoot.offsetWidth || 300,
      petHeight: embeddedRoot.offsetHeight || 380,
      currentRight: roamRight,
      currentBottom: roamBottom,
      randomX: 0.5,
      randomY: 0.5
    });
    if (!target) return;
    roamRight = target.right;
    roamBottom = target.bottom;
    embeddedRoot.style.right = `${target.right}px`;
    embeddedRoot.style.bottom = `${target.bottom}px`;
  }

  function canRoam() {
    if (resolvedRole !== "standalone" || !embeddedRoot?.isConnected || !refs || document.hidden) return false;
    if (state.hostBusy || state.gameBusy || state.speaking || refs.root.classList.contains("chat-open")) return false;
    if (refs.root.matches(":hover") || refs.root.matches(":focus-within")) return false;
    return !window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  }

  function scheduleRoaming(delay = 6500 + Math.round(Math.random() * 4500)) {
    if (resolvedRole !== "standalone" || !embeddedRoot?.isConnected || disposed) return;
    if (roamTimer !== null) window.clearTimeout(roamTimer);
    roamTimer = window.setTimeout(() => {
      roamTimer = null;
      if (canRoam()) {
        const target = nextDesktopPetRoamTarget({
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          petWidth: embeddedRoot.offsetWidth || 300,
          petHeight: embeddedRoot.offsetHeight || 380,
          currentRight: roamRight,
          currentBottom: roamBottom,
          randomX: Math.random(),
          randomY: Math.random()
        });
        if (target) {
          embeddedRoot.dataset.roaming = "true";
          embeddedRoot.dataset.facing = target.right >= roamRight ? "left" : "right";
          roamRight = target.right;
          roamBottom = target.bottom;
          embeddedRoot.style.right = `${target.right}px`;
          embeddedRoot.style.bottom = `${target.bottom}px`;
        }
      }
      scheduleRoaming();
    }, Math.max(1000, delay));
  }

  function startRoaming() {
    clearRoaming();
    roamRight = window.innerWidth <= 720 ? 14 : 22;
    roamBottom = window.innerWidth <= 720 ? 14 : 22;
    roamVisibilityHandler = () => {
      if (document.hidden) {
        if (roamTimer !== null) window.clearTimeout(roamTimer);
        roamTimer = null;
      } else scheduleRoaming(1800);
    };
    roamResizeHandler = () => clampRoamingToViewport();
    document.addEventListener("visibilitychange", roamVisibilityHandler);
    window.addEventListener("resize", roamResizeHandler);
    clampRoamingToViewport();
    scheduleRoaming();
  }

  function applyTransientEmotion(value = "", duration = 4500) {
    if (emotionTimer !== null) window.clearTimeout(emotionTimer);
    emotionTimer = null;
    state.emotion = PET_ANIMATION_STATES.has(value) ? value : "";
    changed();
    if (state.emotion && Number.isFinite(duration) && duration > 0) emotionTimer = window.setTimeout(() => {
      emotionTimer = null;
      state.emotion = "";
      changed();
    }, Math.min(12_000, Math.max(800, duration)));
    return state.emotion;
  }

  function reactToText(text) {
    if (resolvedRole === "pet") return "";
    return applyTransientEmotion(desktopPetEmotionForText(text));
  }

  function cancelPoseOverrides(resetEdge = true, resumeAfterMs = 0) {
    if (manualPoseTimer !== null) window.clearTimeout(manualPoseTimer);
    if (poseResumeTimer !== null) window.clearTimeout(poseResumeTimer);
    manualPoseTimer = null;
    poseResumeTimer = null;
    manualPose = null;
    if (resetEdge) edgeState = "none";
    poseSuppressed = Number.isFinite(resumeAfterMs) && resumeAfterMs > 0;
    animator?.setPose("", 0);
    if (poseSuppressed) poseResumeTimer = window.setTimeout(() => {
      poseResumeTimer = null;
      poseSuppressed = false;
      render();
    }, Math.min(10_000, Math.max(500, resumeAfterMs)));
  }

  function detach(fromWindow = false) {
    const oldWindow = petWindow;
    const oldEmbeddedRoot = embeddedRoot;
    clearRoaming();
    cancelPoseOverrides();
    animator?.dispose();
    animator = null;
    if (uiWindow && keydownHandler) uiWindow.removeEventListener("keydown", keydownHandler);
    uiWindow = null;
    keydownHandler = null;
    petWindow = null;
    embeddedRoot = null;
    refs = null;
    mode = "closed";
    oldEmbeddedRoot?.remove();
    syncTrigger();
    if (!fromWindow && oldWindow && oldWindow !== window) {
      try { oldWindow?.close(); } catch {}
    }
    if (!disposed && trigger?.isConnected) trigger.focus({ preventScroll: true });
  }

  function bindUi(targetWindow, nextMode, native = false, mountRoot = null) {
    animator?.dispose();
    if (uiWindow && keydownHandler) uiWindow.removeEventListener("keydown", keydownHandler);
    refs = installPetUi(targetWindow.document, avatarUrl, spriteUrl, native, mountRoot);
    animator = createPetFrameAnimator(targetWindow, refs.avatarImage, animationUrl, poseCatalogUrl);
    mode = nextMode;
    refs.avatar.title = "点击展开或收起回复";
    refs.avatar.setAttribute("aria-label", "展开或收起桌宠回复");
    const status = refs.root.querySelector(".pet-status");
    if (status && nextMode === "native") {
      status.title = "按住顶部状态条可移动桌宠";
      status.setAttribute("aria-label", "桌宠状态；按住这里可以移动桌宠");
    }
    let composing = false;
    refs.input.addEventListener("compositionstart", () => { composing = true; });
    refs.input.addEventListener("compositionend", () => { composing = false; });
    refs.close.addEventListener("click", () => {
      if (resolvedRole === "pet") onNativeClose?.();
      else detach();
    });
    refs.main.addEventListener("click", () => onOpenMain?.());
    refs.main.hidden = nextMode === "embedded";
    refs.trash.hidden = nextMode !== "native";
    refs.avatar.addEventListener("click", () => applyTransientEmotion("surprised", 1800));
    refs.chat.addEventListener("click", () => {
      const open = refs.root.classList.toggle("chat-open");
      refs.chat.setAttribute("aria-expanded", String(open));
      if (open) requestAnimationFrame(() => refs.input.focus());
    });
    refs.action.addEventListener("click", () => {
      if (!poseAllowed() || !animator?.catalogReady()) return;
      const nextPose = animator.nextPose(manualPoseId);
      if (!nextPose) return;
      if (manualPoseTimer !== null) window.clearTimeout(manualPoseTimer);
      manualPoseId = nextPose.id;
      manualPose = nextPose;
      manualPoseTimer = window.setTimeout(() => {
        manualPoseTimer = null;
        manualPose = null;
        render();
      }, 3500);
    });
    uiWindow = targetWindow;
    keydownHandler = event => {
      if (event.key !== "Escape" || !refs?.root.classList.contains("chat-open")) return;
      refs.root.classList.remove("chat-open");
      refs.chat.setAttribute("aria-expanded", "false");
      refs.chat.focus();
    };
    targetWindow.addEventListener("keydown", keydownHandler);
    refs.voice.addEventListener("click", () => {
      if (resolvedRole === "pet") return sendCommand("voice.set", { enabled: !state.voice });
      state.voice = onSetVoice ? !!onSetVoice(!state.voice) : !!onToggleVoice?.();
      changed();
    });
    refs.trash.addEventListener("click", () => {
      if (resolvedRole === "pet") sendCommand("file.trash", {});
    });
    refs.snapshot.addEventListener("click", async () => {
      if (!state.gameActive || state.gameBusy) return;
      if (resolvedRole === "pet") return sendCommand("game.snapshot", {});
      const sent = await onSnapshot?.();
      if (sent === false) setTransientStatus("暂时看不了", "上一条回复还没有完成。");
    });
    refs.form.addEventListener("submit", async event => {
      event.preventDefault();
      const text = refs.input.value.trim();
      if (!text || composing) return;
      refs.input.value = "";
      if (resolvedRole === "pet") return sendCommand("chat.send", { text });
      const sent = await onSend?.(text);
      if (sent === false) setTransientStatus("还在处理上一条", "上一条完成后就可以继续。");
    });
    if (!native && nextMode !== "embedded") targetWindow.addEventListener("pagehide", () => { if (petWindow === targetWindow) detach(true); }, { once: true });
    render();
    syncTrigger();
  }

  function bindEmbeddedUi() {
    const container = document.createElement("section");
    container.className = "embedded-desktop-pet";
    container.setAttribute("role", "region");
    container.setAttribute("aria-label", "克里斯提娜桌宠");
    const shadow = container.attachShadow({ mode: "open" });
    document.body.append(container);
    embeddedRoot = container;
    petWindow = window;
    bindUi(window, "embedded", false, shadow);
    startRoaming();
  }

  function reportOpenFailure(error) {
    if (!trigger) return;
    const message = clean(error?.message, 160) || "桌宠启动失败";
    trigger.dataset.error = "true";
    trigger.textContent = "桌宠不可用";
    trigger.title = message;
    trigger.setAttribute("aria-label", message);
    window.setTimeout(() => {
      if (trigger.dataset.error !== "true") return;
      delete trigger.dataset.error;
      trigger.removeAttribute("aria-label");
      trigger.title = "打开桌宠";
      syncTrigger();
    }, 4000);
  }

  async function open() {
    if (resolvedRole === "host") return toggleNative(true);
    if (resolvedRole === "pet" || isStandaloneOpen() || opening) return;
    opening = true;
    try {
      bindEmbeddedUi();
    } catch (error) {
      detach(true);
      reportOpenFailure(error);
    } finally {
      opening = false;
    }
  }

  async function toggleNative(forceVisible) {
    if (resolvedRole !== "host") return false;
    try {
      const result = await onNativeToggle?.(forceVisible);
      nativeVisible = typeof result === "boolean" ? result : forceVisible ?? !nativeVisible;
    } catch {
      nativeVisible = false;
    }
    syncTrigger();
    return nativeVisible;
  }

  function close() {
    cancelPoseOverrides();
    if (resolvedRole === "standalone") detach();
    else if (resolvedRole === "host") return toggleNative(false);
    else return onNativeClose?.();
  }

  function toggle() {
    if (resolvedRole === "host") return toggleNative();
    return isStandaloneOpen() ? close() : open();
  }

  function setNativeVisible(visible) {
    if (resolvedRole !== "host") return isOpen();
    nativeVisible = visible === true;
    syncTrigger();
    return nativeVisible;
  }

  function setEdgeState(value = "none") {
    if (!PET_EDGE_STATES.has(value)) return false;
    if (manualPoseTimer !== null) window.clearTimeout(manualPoseTimer);
    manualPoseTimer = null;
    manualPose = null;
    edgeState = value;
    const pose = effectivePose();
    animator?.setPose(pose.state, pose.id);
    return true;
  }

  function mountNative() {
    if (resolvedRole !== "pet" || refs) return;
    bindUi(window, "native", true);
    sendReady();
    readyTimer = setInterval(sendReady, 5000);
  }

  function setStatus(label, detail) {
    if (resolvedRole === "pet") return;
    state.label = clean(label, 60) || "连接正常";
    state.detail = clean(detail, 160);
    changed();
  }

  function begin(detail = "正在核对事实和假设") {
    if (resolvedRole === "pet") return;
    cancelPoseOverrides(false);
    state.phase = "thinking";
    state.hostBusy = true;
    state.thinking = true;
    state.speaking = false;
    state.label = "正在分析";
    state.detail = clean(detail, 160);
    changed();
  }

  function stream(text) {
    if (resolvedRole === "pet") return;
    cancelPoseOverrides(false);
    const next = shortReply(text);
    if (next) state.reply = next;
    state.phase = "streaming";
    state.hostBusy = true;
    state.thinking = true;
    state.label = "正在回复";
    state.detail = "结论还在整理中。";
    changed(false);
  }

  function complete(text, detail = "本地模型") {
    if (resolvedRole === "pet") return;
    cancelPoseOverrides(false, 3500);
    const next = shortReply(text);
    if (next) state.reply = next;
    state.phase = "complete";
    state.hostBusy = false;
    state.thinking = false;
    state.label = "连接正常";
    state.detail = clean(detail, 160);
    applyTransientEmotion(desktopPetEmotionForText(next || state.reply));
  }

  function idle(detail = "当前没有需要提醒的新情况") {
    if (resolvedRole === "pet") return;
    state.phase = "idle";
    state.hostBusy = false;
    state.thinking = false;
    state.label = "观察完成";
    state.detail = clean(detail, 160);
    changed();
  }

  function fail(message, aborted = false) {
    if (resolvedRole === "pet") return;
    cancelPoseOverrides(false, 3500);
    state.phase = aborted ? "aborted" : "error";
    state.hostBusy = false;
    state.thinking = false;
    state.label = aborted ? "已停止" : "连接失败";
    state.detail = clean(message, 160) || (aborted ? "本次回复已中断" : "本地服务恢复后可以重试");
    changed();
  }

  function setSpeaking(value) {
    if (resolvedRole === "pet") return;
    if (value === true) cancelPoseOverrides(false);
    state.speaking = value === true;
    changed();
  }

  function setVoiceEnabled(value) {
    if (resolvedRole === "pet") return;
    state.voice = value === true;
    changed();
  }

  function setGameState({ active, busy } = {}) {
    if (resolvedRole === "pet") return;
    if (busy === true) cancelPoseOverrides(false);
    state.gameActive = active === true;
    state.gameBusy = busy === true;
    changed();
  }

  function setEmotion(value = "") {
    if (resolvedRole === "pet") return;
    applyTransientEmotion(value);
  }

  function ackFor(message, ok, code = "", detail = "") {
    return {
      v: PET_PROTOCOL,
      source: "host",
      kind: "ack",
      petId: clean(message.petId, 100),
      id: clean(message.id, 100),
      ok: ok === true,
      code: clean(code, 30),
      message: clean(detail, 160),
      ts: Date.now()
    };
  }

  function rememberAck(key, ack) {
    ackCache.set(key, ack);
    if (ackCache.size > 100) ackCache.delete(ackCache.keys().next().value);
  }

  async function handleCommand(message) {
    const id = clean(message.id, 100);
    const senderPetId = clean(message.petId, 100);
    if (!id || !senderPetId || !isRecord(message.args)) return;
    const key = `${senderPetId}:${id}`;
    if (ackCache.has(key)) return post(ackCache.get(key));
    const reject = (code, detail) => {
      const ack = ackFor(message, false, code, detail);
      rememberAck(key, ack);
      post(ack);
    };
    let accepted = false;
    let responseCode = "";
    let responseDetail = "";
    try {
      if (message.command === "chat.send") {
        const text = typeof message.args.text === "string" ? message.args.text.trim() : "";
        if (!text || text.length > 500) return reject("invalid", "消息支持 1 到 500 字。");
        if (state.hostBusy) return reject("busy", "上一条回复还没有完成。");
        accepted = await onSend?.(text);
      } else if (message.command === "game.snapshot") {
        if (!state.gameActive) return reject("unavailable", "还没有共享游戏窗口。");
        if (state.hostBusy || state.gameBusy) return reject("busy", "上一项分析还没有完成。");
        accepted = await onSnapshot?.();
      } else if (message.command === "voice.set") {
        if (typeof message.args.enabled !== "boolean") return reject("invalid", "声音状态无效。");
        const result = await onSetVoice?.(message.args.enabled);
        accepted = result === message.args.enabled;
      } else if (message.command === "file.trash") {
        if (Object.keys(message.args).length !== 0) return reject("invalid", "文件清理命令无效。");
        const result = await onTrashFile?.();
        if (result?.status === "trashed" && result.ok === true) {
          accepted = true;
          responseCode = "trashed";
          responseDetail = "所选文件已移入系统回收站。";
        } else if (result?.status === "cancelled" && result.ok === true) {
          accepted = true;
          responseCode = "cancelled";
          responseDetail = "没有移动任何文件。";
        } else {
          const details = {
            busy: "文件选择器正在使用。",
            invalid: "所选内容不是可处理的普通文件。",
            changed: "所选文件在确认期间发生变化；没有移动任何文件。",
            failed: "系统没有完成回收站操作。"
          };
          return reject(clean(result?.status, 30) || "unavailable", details[result?.status] || "文件清理功能暂时不可用。");
        }
      } else return reject("invalid", "不支持的桌宠命令。");
      const ack = ackFor(message, accepted !== false, accepted === false ? "busy" : responseCode, accepted === false ? "当前操作暂时不可用。" : responseDetail);
      rememberAck(key, ack);
      post(ack);
    } catch {
      reject("unavailable", "主界面没有完成这项操作。");
    }
  }

  function sendReady() {
    if (resolvedRole !== "pet") return;
    post({ v: PET_PROTOCOL, source: "pet", kind: "ready", petId, ts: Date.now() });
  }

  function sendCommand(command, args) {
    if (resolvedRole !== "pet" || !channel) return setTransientStatus("主界面未连接", "桌宠重启后可以重新连接主界面。");
    const id = makeId("command");
    const timeout = setTimeout(() => {
      pending.delete(id);
      setTransientStatus("主界面没有回应", "可以返回主界面检查本地服务。");
      render();
    }, 8000);
    pending.set(id, { command, timeout });
    const sent = post({ v: PET_PROTOCOL, source: "pet", kind: "command", petId, id, command, args, ts: Date.now() });
    if (!sent) {
      clearTimeout(timeout);
      pending.delete(id);
      setTransientStatus("主界面未连接", "桌宠重启后可以重新连接主界面。");
    }
    render();
  }

  function applyRemoteState(message) {
    if (!clean(message.hostId, 100) || !Number.isSafeInteger(message.seq) || message.seq < 1) return;
    if (lastHostId === message.hostId && message.seq <= lastSequence) return;
    const next = safeState(message.state);
    if (!next) return;
    if (lastHostId !== message.hostId) lastSequence = 0;
    lastHostId = message.hostId;
    lastSequence = message.seq;
    receivedState = true;
    Object.assign(state, next);
    if (state.phase === "complete" || state.phase === "error" || state.phase === "aborted") {
      cancelPoseOverrides(false, 3500);
    } else if (state.hostBusy || state.gameBusy || state.speaking) cancelPoseOverrides(false);
    render();
  }

  function handleAck(message) {
    if (clean(message.petId, 100) !== petId) return;
    const id = clean(message.id, 100);
    const item = pending.get(id);
    if (!item) return;
    clearTimeout(item.timeout);
    pending.delete(id);
    if (message.ok !== true) setTransientStatus("暂时不能执行", clean(message.message, 160) || "稍后可以重试。");
    else if (item.command === "file.trash") setTransientStatus(message.code === "trashed" ? "已移入回收站" : "没有移动文件", clean(message.message, 160));
    render();
  }

  function onChannelMessage(event) {
    const message = event.data;
    if (!isRecord(message) || message.v !== PET_PROTOCOL) return;
    if (resolvedRole === "host" && message.source === "pet") {
      if (message.kind === "ready" && clean(message.petId, 100)) sendState();
      else if (message.kind === "command") void handleCommand(message);
    } else if (resolvedRole === "pet" && message.source === "host") {
      if (message.kind === "state") applyRemoteState(message);
      else if (message.kind === "ack") handleAck(message);
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    clearRoaming();
    cancelPoseOverrides();
    clearTimeout(broadcastTimer);
    clearInterval(readyTimer);
    if (emotionTimer !== null) window.clearTimeout(emotionTimer);
    emotionTimer = null;
    animator?.dispose();
    animator = null;
    for (const item of pending.values()) clearTimeout(item.timeout);
    pending.clear();
    trigger?.removeEventListener("click", triggerHandler);
    channel?.removeEventListener("message", onChannelMessage);
    channel?.close();
    if (resolvedRole === "standalone") detach();
  }

  const triggerHandler = () => { void toggle(); };
  trigger?.addEventListener("click", triggerHandler);
  channel?.addEventListener("message", onChannelMessage);
  syncTrigger();
  if (resolvedRole === "host") queueMicrotask(() => publish(true));

  return {
    open,
    close,
    toggle,
    mountNative,
    begin,
    stream,
    complete,
    idle,
    fail,
    setStatus,
    setSpeaking,
    setVoiceEnabled,
    setGameState,
    setEmotion,
    reactToText,
    setEdgeState,
    setNativeVisible,
    isOpen,
    dispose,
    hasRemoteState: () => receivedState
  };
}
