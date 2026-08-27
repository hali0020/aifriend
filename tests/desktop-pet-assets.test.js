import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  desktopPetPoseForEdgeState,
  parseDesktopPetPoseCatalog,
  resolveDesktopPetAnimationFrameUrl,
  resolveDesktopPetAnimationManifestUrl,
  selectNextDesktopPetManualPose
} from "../public/desktop-pet.js";


const PAGE_URL = "http://127.0.0.1:3000/desktop-pet.html";
const MANIFEST_URL = "http://127.0.0.1:3000/desktop-pet-assets/animations/manifest.json";

function validCatalog() {
  return {
    version: 1,
    character: "克里斯提娜（牧濑红莉西）",
    reference: "makise-kurisu-chibi-01-joyful-wave.png",
    assets: [
      {
        id: 1,
        state: "joyful-wave",
        file: "makise-kurisu-chibi-01-joyful-wave.png"
      },
      {
        id: 2,
        state: "thinking",
        file: "makise-kurisu-chibi-02-thinking.png"
      }
    ]
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function catalogWithCount(count) {
  const assets = Array.from({ length: count }, (_, index) => {
    const id = index + 1;
    const state = `pose-${id}`;
    return {
      id,
      state,
      file: `makise-kurisu-chibi-${String(id).padStart(2, "0")}-${state}.png`
    };
  });
  return {
    version: 1,
    character: "克里斯提娜（牧濑红莉西）",
    reference: assets[0].file,
    assets
  };
}

test("合法姿态 catalog 只返回同源限定目录 URL", () => {
  const parsed = parseDesktopPetPoseCatalog(validCatalog(), { pageUrl: PAGE_URL });
  assert.equal(parsed.version, 1);
  assert.equal(parsed.assets.length, 2);
  assert.deepEqual(
    parsed.assets.map(item => item.url),
    [
      "http://127.0.0.1:3000/desktop-pet-assets/makise-kurisu-chibi-01-joyful-wave.png",
      "http://127.0.0.1:3000/desktop-pet-assets/makise-kurisu-chibi-02-thinking.png"
    ]
  );
  for (const asset of parsed.assets) {
    const url = new URL(asset.url);
    assert.equal(url.origin, "http://127.0.0.1:3000");
    assert.match(url.pathname, /^\/desktop-pet-assets\/makise-kurisu-chibi-[0-9]{2}-[a-z0-9-]+\.png$/);
    assert.equal(url.search, "");
    assert.equal(url.hash, "");
  }
});

test("窗口边缘状态只接受固定枚举并映射到固定素材编号", () => {
  assert.deepEqual(desktopPetPoseForEdgeState("none"), { id: 0, state: "" });
  assert.deepEqual(desktopPetPoseForEdgeState("moving"), { id: 20, state: "dragged-floating" });
  assert.deepEqual(desktopPetPoseForEdgeState("top"), { id: 36, state: "catching-edge-both-hands" });
  assert.deepEqual(desktopPetPoseForEdgeState("bottom"), { id: 33, state: "sitting-window-edge" });
  assert.deepEqual(desktopPetPoseForEdgeState("left"), { id: 19, state: "peeking-edge" });
  assert.deepEqual(desktopPetPoseForEdgeState("right"), { id: 19, state: "peeking-edge" });
  for (const invalid of ["", "Moving", "corner", "../top", 20, null, undefined]) {
    assert.equal(desktopPetPoseForEdgeState(invalid), null);
  }
});

test("40 项 catalog 的手动候选严格取 29–40 并循环", () => {
  const parsed = parseDesktopPetPoseCatalog(catalogWithCount(40), { pageUrl: PAGE_URL });
  assert.deepEqual(selectNextDesktopPetManualPose(parsed, 0), { id: 29, state: "pose-29" });
  assert.deepEqual(selectNextDesktopPetManualPose(parsed, 29), { id: 30, state: "pose-30" });
  assert.deepEqual(selectNextDesktopPetManualPose(parsed, 40), { id: 29, state: "pose-29" });
  assert.deepEqual(selectNextDesktopPetManualPose(parsed, 12), { id: 29, state: "pose-29" });
  const selected = selectNextDesktopPetManualPose(parsed, 30);
  assert.deepEqual(Object.keys(selected).sort(), ["id", "state"]);
  assert.equal(Object.isFrozen(selected), true);
  assert.equal("url" in selected, false);
  assert.equal("file" in selected, false);
});

test("手动姿态选择拒绝空、伪造、克隆和被修改输入", () => {
  assert.equal(selectNextDesktopPetManualPose(null, 0), null);
  assert.equal(selectNextDesktopPetManualPose({ assets: [] }, 0), null);
  const parsed = parseDesktopPetPoseCatalog(validCatalog(), { pageUrl: PAGE_URL });
  const forged = clone(parsed);
  assert.equal(selectNextDesktopPetManualPose(forged, 0), null);
  forged.assets[0].state = "tampered";
  assert.equal(selectNextDesktopPetManualPose(forged, 0), null);
  assert.equal(selectNextDesktopPetManualPose(new Proxy(parsed, {}), 0), null);
  assert.throws(() => { parsed.assets[0].state = "tampered"; }, TypeError);
  assert.deepEqual(selectNextDesktopPetManualPose(parsed, 0), { id: 1, state: "joyful-wave" });
});

test("工作区 catalog 的最近 12 项可动态轮换且边缘映射仍固定", () => {
  const catalogPath = new URL("../public/desktop-pet-assets/catalog.json", import.meta.url);
  const parsed = parseDesktopPetPoseCatalog(
    JSON.parse(readFileSync(catalogPath, "utf8")),
    { pageUrl: PAGE_URL }
  );
  for (const edge of ["moving", "top", "bottom", "left", "right"]) {
    const expected = desktopPetPoseForEdgeState(edge);
    assert.equal(parsed.assets[expected.id - 1]?.state, expected.state, edge);
  }
  const candidates = parsed.assets.slice(-12);
  const first = selectNextDesktopPetManualPose(parsed, 0);
  const second = selectNextDesktopPetManualPose(parsed, first.id);
  const wrapped = selectNextDesktopPetManualPose(parsed, candidates.at(-1).id);
  assert.deepEqual(first, { id: candidates[0].id, state: candidates[0].state });
  assert.deepEqual(second, { id: candidates[1].id, state: candidates[1].state });
  assert.deepEqual(wrapped, { id: candidates[0].id, state: candidates[0].state });
});

test("姿态 catalog 拒绝缺号、乱序和编号不符", () => {
  const missing = validCatalog();
  missing.assets[1].id = 3;
  missing.assets[1].file = "makise-kurisu-chibi-03-thinking.png";
  assert.throws(() => parseDesktopPetPoseCatalog(missing, { pageUrl: PAGE_URL }), /结构无效/);

  const wrongFileNumber = validCatalog();
  wrongFileNumber.assets[1].file = "makise-kurisu-chibi-03-thinking.png";
  assert.throws(() => parseDesktopPetPoseCatalog(wrongFileNumber, { pageUrl: PAGE_URL }), /编号或文件名无效/);

  const wrongSlug = validCatalog();
  wrongSlug.assets[1].file = "makise-kurisu-chibi-02-not-thinking.png";
  assert.throws(() => parseDesktopPetPoseCatalog(wrongSlug, { pageUrl: PAGE_URL }), /编号或文件名无效/);
});

test("姿态 catalog 严格拒绝多余字段、错误 reference 和重复 state", () => {
  const rootExtra = { ...validCatalog(), extra: true };
  assert.throws(() => parseDesktopPetPoseCatalog(rootExtra, { pageUrl: PAGE_URL }), /结构无效/);

  const assetExtra = validCatalog();
  assetExtra.assets[0].extra = true;
  assert.throws(() => parseDesktopPetPoseCatalog(assetExtra, { pageUrl: PAGE_URL }), /条目结构无效/);

  const badReference = validCatalog();
  badReference.reference = badReference.assets[1].file;
  assert.throws(() => parseDesktopPetPoseCatalog(badReference, { pageUrl: PAGE_URL }), /参考图无效/);

  const duplicateState = validCatalog();
  duplicateState.assets[1].state = "joyful-wave";
  duplicateState.assets[1].file = "makise-kurisu-chibi-02-joyful-wave.png";
  assert.throws(() => parseDesktopPetPoseCatalog(duplicateState, { pageUrl: PAGE_URL }), /编号或文件名无效/);
});

test("姿态文件拒绝协议、绝对路径、穿越、查询、片段和编码路径", () => {
  const attacks = [
    "https://evil.example/x.png",
    "data:image/png;base64,AAAA",
    "file:///C:/secret.png",
    "//evil.example/x.png",
    "/desktop-pet-assets/x.png",
    "../x.png",
    "..\\x.png",
    "%2e%2e/x.png",
    "%252e%252e/x.png",
    "makise-kurisu-chibi-01-safe.png?x=1",
    "makise-kurisu-chibi-01-safe.png#x"
  ];
  for (const attack of attacks) {
    const catalog = validCatalog();
    catalog.reference = attack;
    catalog.assets[0].file = attack;
    assert.throws(
      () => parseDesktopPetPoseCatalog(catalog, { pageUrl: PAGE_URL }),
      undefined,
      attack
    );
  }
});

test("姿态 catalog 地址固定且不接受跨源或带参数地址", () => {
  for (const catalogUrl of [
    "https://evil.example/desktop-pet-assets/catalog.json",
    "//evil.example/desktop-pet-assets/catalog.json",
    "/desktop-pet-assets/catalog.json?x=1",
    "/desktop-pet-assets/catalog.json#x",
    "/other/catalog.json"
  ]) {
    assert.throws(
      () => parseDesktopPetPoseCatalog(validCatalog(), { pageUrl: PAGE_URL, catalogUrl }),
      undefined,
      catalogUrl
    );
  }
});

test("动画 manifest 和 frame 仅解析到固定同源目录", () => {
  assert.equal(
    resolveDesktopPetAnimationManifestUrl("desktop-pet-assets/animations/manifest.json", PAGE_URL),
    MANIFEST_URL
  );
  assert.equal(
    resolveDesktopPetAnimationFrameUrl("happy/frame-00.png", MANIFEST_URL, PAGE_URL),
    "http://127.0.0.1:3000/desktop-pet-assets/animations/happy/frame-00.png"
  );
});

test("动画 manifest 拒绝协议、绝对路径、穿越、查询和片段", () => {
  for (const attack of [
    "/desktop-pet-assets/animations/manifest.json",
    "https://evil.example/manifest.json",
    "data:application/json,{}",
    "file:///C:/manifest.json",
    "//evil.example/manifest.json",
    "../animations/manifest.json",
    "desktop-pet-assets/animations/manifest.json?x=1",
    "desktop-pet-assets/animations/manifest.json#x"
  ]) {
    assert.throws(() => resolveDesktopPetAnimationManifestUrl(attack, PAGE_URL), undefined, attack);
  }
});

test("动画 frame 拒绝协议、绝对路径、反斜杠、穿越和参数", () => {
  const attacks = [
    "https://evil.example/x.png",
    "data:image/png;base64,AAAA",
    "file:///C:/x.png",
    "//evil.example/x.png",
    "/happy/frame-00.png",
    "happy\\frame-00.png",
    "../happy/frame-00.png",
    "happy/../frame-00.png",
    "%2e%2e/happy/frame-00.png",
    "%252e%252e/happy/frame-00.png",
    "happy/frame-00.png?x=1",
    "happy/frame-00.png#x"
  ];
  for (const attack of attacks) {
    assert.throws(
      () => resolveDesktopPetAnimationFrameUrl(attack, MANIFEST_URL, PAGE_URL),
      undefined,
      attack
    );
  }
  assert.throws(() => resolveDesktopPetAnimationFrameUrl(
    "happy/frame-00.png",
    "https://evil.example/desktop-pet-assets/animations/manifest.json",
    PAGE_URL
  ));
});

test("解析结果不受输入对象后续修改影响", () => {
  const input = validCatalog();
  const parsed = parseDesktopPetPoseCatalog(input, { pageUrl: PAGE_URL });
  const snapshot = clone(parsed);
  input.assets[0].file = "https://evil.example/x.png";
  assert.deepEqual(clone(parsed), snapshot);
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed.assets), true);
  assert.equal(Object.isFrozen(parsed.assets[0]), true);
});
