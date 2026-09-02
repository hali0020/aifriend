# 主界面、桌宠与回复策略测试设计

更新时间：2026-08-28
适用基线：Web 页面内透明 Shadow DOM 桌宠与空闲受限漫游、Electron 独立透明桌宠与工作区内随机漫游、文本/回复/交互情绪、Electron host 安全回收站流程、情绪快速回应、内部标签清理、紧凑运行状态徽章。

本文给出可重复执行的验收步骤。它只描述测试，不改变产品安全边界。测试不得使用真实个人资料、授权原文、音频、模型文件或隔离区素材。

## 1. 测试目标与范围

必须证明以下事实：

1. 原左侧身份栏已从 DOM 和布局中删除，聊天区域不再保留 280px 左侧空白。
2. 普通 Web 页面只使用当前页面内的 Shadow DOM 桌宠，不依赖 Document Picture-in-Picture、`window.open`、iframe 或新窗口权限。
3. 桌宠打开、关闭、反复切换、发送消息、语音、游戏截图按钮、焦点恢复和窄屏布局可用，不产生重复实例或遗留监听器。
4. Web Shadow DOM 分支不削弱现有 CSP；Electron 分支仍只通过有限 IPC 打开独立透明窗口。
5. 简短的个人低落表达得到克制关心的短回复，不再被科学讨论示例污染；设备故障、正向心情和长对话不会误走该规则。
6. `[科学讨论/专注]` 等内部标签在输出安全检查之后、展示之前被移除，同时普通方括号、链接和正文中的文字不被误删。
7. 页头仍明确显示处理位置与安全状态；任何模型正文均须在完整输出安全检查通过后才能释放。
8. 普通对话不出现未经请求的命令、训斥或支配用户的措辞；现实紧急安全风险及用户明确请求操作步骤是受控例外。
9. Web 桌宠外层保持透明，空闲漫游始终受视口边界约束，并在隐藏、忙碌、朗读、展开输入或减少动态效果等状态下暂停。
10. 用户文本、回复内容和头像点击等交互能驱动短暂情绪动作，思考、错误和忙碌状态优先于残留情绪。
11. Electron 文件动作只能由可信 host 以无路径参数发起，经单个普通文件选择和默认取消的二次确认后进入系统回收站；renderer、模型和桌宠协议均不能指定路径或请求永久删除。

不在本文中宣称完成的事项：真实游戏兼容性、GPU/多显示器长期稳定性、Electron 跨显示器漫游的实际体验、真实 Windows 文件选择/取消/回收站结果、模型回答质量的开放式评测、正式安装包签名与自动更新。

## 2. 自动化层级

| 层级 | 含义 | 运行位置 | 通过标准 |
| --- | --- | --- | --- |
| L0 静态契约 | HTML、CSS、导出函数、CSP 和 IPC 暴露面检查 | `node:test` | 确定性断言全部通过 |
| L1 纯单元 | 检索、快速回应准入、标签清理、状态视图、桌宠素材/状态/情绪映射、漫游边界和文件回收失败关闭 | `node:test` | 无网络、无模型、无 GUI，结果确定 |
| L2 服务集成 | 使用受控替身检查 API 路由及安全调用顺序 | Node 子进程或注入式测试 | 能证明“先检查、后释放”，且无外部请求 |
| L3 Web E2E | `http://127.0.0.1:3000/` 的真实 Chromium/内置浏览器 | 浏览器自动化；暂时可按步骤人工执行 | DOM、Shadow DOM、交互、焦点、控制台和网络均符合断言 |
| L4 Electron 集成 | 开发版 Electron host/pet 两个 renderer 与主进程 | Electron 测试替身及真实 GUI | IPC 来源、参数、窗口状态与清理正确 |
| L5 真实桌面验收 | Windows DPI、多显示器、休眠、真实游戏窗口 | `npm run desktop:diagnose`，人工 | 记录环境、步骤、结果和诊断文件；不能由低层测试替代 |

现有自动化入口：

```powershell
npm run test:conversation
npm run test:desktop
npm run check
```

当前 `npm run check` 基线为 244 个 Node 测试；测试数量变化时以实际输出为准，并同步本文和交接文档。

需要服务与真实页面时：

```powershell
npm start
npm test
```

Electron 发布链变更后还必须执行：

```powershell
npm run make:desktop
npm run audit:package
```

## 3. 通用前置条件

1. 完整阅读 `docs/DEVELOPMENT_HANDOFF.md`，先运行 `git status --short --branch`，不得覆盖已有改动。
2. Node 与依赖版本满足 `package.json`；首次运行或锁文件变化时执行 `npm ci`。
3. Web E2E 使用 `127.0.0.1`，不要换成局域网地址。打开开发者工具并保留 Console、Network 和 Accessibility 信息。
4. 测试数据只能使用本文的合成短句。涉及云端状态时使用服务替身或空凭据状态，禁止发送真实内容。
5. 每个浏览器用例从一次完整刷新开始。除专门的历史迁移用例外，使用新的测试浏览器上下文，避免旧 `localStorage` 干扰。
6. Electron GUI 用例在开始前确认没有残留 `electron.exe`；结束时确认 host、pet 和本地服务进程均按预期退出。
7. 记录浏览器版本、Electron 版本、Windows 缩放比例、视口尺寸和所选 provider。失败时保存控制台错误、请求路径和可复现步骤，不保存对话原文或截图中的个人信息。

### 3.1 固定合成数据

| 名称 | 输入/输出 |
| --- | --- |
| 简短低落 | `我今天状态不太好` |
| 长低落 | `我今天状态不太好，因为刚才连续遇到几件事。我想先把经过完整讲清楚，再请你和我一起分析。` |
| 急症附加事实 | `我今天状态不好，胸痛呼吸困难` |
| 现实危险 | `我状态不好，被人跟踪了` |
| 设备故障 | `我今天模型状态不太好，服务一直报错` |
| 正向心情 | `我今天心情很好` |
| 科学问题 | `这个结论有什么实验数据和反例？` |
| 带内部标签输出 | `[科学讨论/专注] 证据还需要核对。` |
| HTML 样文本 | `<img src=x onerror="globalThis.__petXss=1">` |

## 4. 左栏移除与主页面布局

### UI-001：左栏静态契约

- 层级：L0，现有自动化位置 `tests/ui-contract.test.js`。
- 步骤：读取 `public/index.html`。
- 断言：不存在 `<aside>` 和 `class="side"`；存在唯一的 `<section class="chat">`；`#privacyState` 与 `#safetyStatus` 位于 `.runtime-badges` 内。

### UI-002：桌面宽度下不再残留左侧空白

- 层级：L3。
- 前置：视口 `1024×768` 和 `1440×900` 各执行一次。
- 步骤：刷新主页；读取 `.shell`、`.chat` 和页头的边界框；截取整页图。
- 断言：页面没有身份侧栏；`.chat` 占用 `.shell` 的完整可用宽度；左侧没有约 280px 的空白列；消息、输入框和页头共用同一主列；横向滚动条不存在。

### UI-003：紧凑页头在窄屏可用

- 层级：L3。
- 前置：依次使用 `720×900`、`520×800`、`360×640`。
- 步骤：刷新；检查页头、六个操作按钮和两个运行徽章；逐个用 Tab 聚焦按钮。
- 断言：`≤720px` 时徽章可换行；`≤520px` 时操作按钮为三列网格；按钮不重叠、不被裁剪，触控高度不小于 CSS 规定的 38px；页面无横向溢出。

## 5. 状态徽章

### STATUS-001：状态视图单元矩阵

- 层级：L1，现有自动化位置 `tests/ui-contract.test.js`。
- 步骤：分别向 `buildStatusView` 输入 `local`、`cloud`、`demo`、`cloud-offline`、`offline`，并组合图像语义门 ready/not-ready、远程复核 enabled/ready。
- 断言：
  - 本地显示“本地优先”，不得暗示自动上传或自动云端回退。
  - 云端显示“对话会发送给所选云服务”。
  - 云端凭据缺失明确显示“当前不会发送内容”。
  - Ollama 离线明确显示“仅本地 · Ollama 未就绪”。
  - 非法或未知 processing 值失败关闭并抛错，不能默认成“本地安全”。
  - 图像门或已启用远程复核配置不完整时，`safetyMode` 为 `error`。

### STATUS-002：真实页头更新与无障碍

- 层级：L3。
- 步骤：让 `/api/status` 依次返回上述状态；再模拟请求失败。观察 `#status`、`#privacyState`、`#safetyStatus`。
- 断言：两个徽章都有 `role="status"`、`aria-live="polite"`；可见文本与 `title` 完整文本一致；请求失败时显示“处理模式暂时无法确认”和“安全状态暂时无法确认”，不得保留上一次的绿色安全结论。

## 6. Web Shadow DOM 桌宠

### PET-WEB-001：固定选择页面内实现

- 层级：L0/L1，现有自动化位置 `tests/desktop-pet-assets.test.js`。
- 步骤：调用 `desktopPetSurfaceOrder()`，并传入伪造的 PiP/popup 能力参数再次调用。
- 断言：始终只返回 `['embedded']`；Web 实现不以浏览器是否提供 `documentPictureInPicture` 或 `window.open` 为条件。
- 追加静态断言：standalone `open()` 不调用 `requestWindow`、`window.open` 或创建 iframe；Electron host 分支不受此断言影响。

### PET-WEB-002：首次打开

- 层级：L3，最高优先级回归。
- 前置：确认页面没有 `.embedded-desktop-pet`。
- 步骤：点击 `#desktopPet`；等待一个动画帧；读取 light DOM 与容器的 open shadow root。
- 断言：
  - light DOM 中恰好出现一个 `section.embedded-desktop-pet[role="region"][aria-label="克里斯提娜桌宠"]`。
  - 容器具有 open `shadowRoot`；其中恰好一个 `.pet-shell`、一个 `style[data-desktop-pet]` 和一个“退出桌宠”按钮。
  - `#desktopPet` 文本变为“收起桌宠”，`aria-pressed="true"`，title 为“收起桌宠”。
  - 主页面 DOM 没有被 `replaceChildren` 清空；消息区与输入框仍存在。
  - 没有新标签页、popup、PiP 或 iframe。
  - 外层容器的背景、边框和阴影均为空或透明；只有状态胶囊、气泡和展开后的操作区可有独立可读背景，不能出现包住整只桌宠的矩形面板。

### PET-WEB-003：两种关闭路径与焦点恢复

- 层级：L3。
- 步骤 A：打开后再次点击页头“收起桌宠”。步骤 B：重新打开后点击 Shadow DOM 内的“退出桌宠”。
- 断言：两种路径都移除容器与 shadow tree；`aria-pressed="false"`，按钮文本恢复“桌宠”，title 恢复“打开桌宠”；活动焦点回到 `#desktopPet`；控制台没有未处理异常。

### PET-WEB-004：重复实例和竞态

- 层级：L3；建议后续增加可注入 DOM 的自动化组件测试。
- 步骤：顺序执行 20 次“打开—等待—关闭”；再快速点击 10 次；最后停顿 500ms 并打开一次。
- 断言：任何时刻 `.embedded-desktop-pet` 数量不超过 1；最终打开时数量为 1；一次提交只触发一次回调；关闭后动画 timer、资源 fetch 和 keydown handler 不继续产生可见更新或错误。

### PET-WEB-005：创建失败的可见反馈

- 层级：L3 测试夹具。
- 前置：在隔离的测试页把 `attachShadow` 替换为会抛错的受控替身，不修改生产页面。
- 步骤：点击桌宠按钮。
- 断言：没有残留容器；按钮暂时显示“桌宠不可用”，`data-error="true"`，title/aria-label 为截断后的安全错误信息；约 4 秒后恢复；不得调用 `alert`，不得泄露堆栈、本地路径或任意对象序列化。

### PET-WEB-006：展开输入与发送

- 层级：L3 组件夹具；真实页面再做一次冒烟。
- 步骤：打开桌宠；点击“输入消息”；确认输入获得焦点；输入 `测试消息` 并提交。
- 断言：聊天区增加 `chat-open`，控制按钮 `aria-expanded="true"`；`onSend` 恰好收到一次去首尾空白且不超过 500 字的文本；输入框清空；空文本不发送；回调返回 `false` 时状态显示“还在处理上一条”。
- IME 子用例：触发 `compositionstart` 后提交不得发送，`compositionend` 后提交一次才发送。

### PET-WEB-007：语音按钮

- 层级：L3。
- 步骤：在主页面确保“语音：关”；打开桌宠并点击“声音：关”；再从主页面关闭语音。
- 断言：桌宠调用 `onSetVoice(true)` 一次；文本与 `aria-pressed` 变为“声音：开”/`true`；主页面状态同步；主页面关闭时桌宠同步恢复；pending 状态下按钮 disabled，不能重复发命令。测试只验证系统 TTS 开关，不宣称角色克隆音色。

### PET-WEB-008：游戏“看一下”状态机

- 层级：L1 状态机 + L3 交互。
- 步骤与断言：
  1. `gameActive=false`：按钮为 disabled，点击不调用 `onSnapshot`；这是设计状态，不是故障。
  2. `setGameState({active:true,busy:false})`：按钮启用，点击恰好调用一次 `onSnapshot`。
  3. `busy=true`：按钮 disabled，文本为“分析中…”。
  4. callback 返回 `false`：状态显示“暂时看不了 / 上一条回复还没有完成”。
  5. 关闭游戏会话：按钮立即恢复 disabled，不保留旧的 active 状态。

### PET-WEB-009：键盘与焦点

- 层级：L3。
- 步骤：只用键盘打开桌宠；Tab 到输入、动作、关闭和语音控件；展开聊天后按 Escape；再关闭桌宠。
- 断言：所有可见按钮有可辨识名称和 `:focus-visible`；打开聊天后输入获得焦点；Escape 只收起已展开聊天、把焦点交回输入消息按钮，并把 `aria-expanded` 设为 false；关闭桌宠后焦点返回页头触发按钮；Shadow DOM 不形成无法退出的焦点陷阱。

### PET-WEB-010：响应式与遮挡

- 层级：L3，视口矩阵 `1440×900`、`720×900`、`520×800`、`360×640`、`320×568`。
- 步骤：每个尺寸打开桌宠，展开输入区，聚焦输入和关闭按钮。
- 断言：桌宠最大为 `300×380`；窄屏时宽高不超过 `viewport - 28px`，所有漫游目标均留在可见视口内；透明外层不形成矩形底板，关闭按钮和输入按钮始终可达；非控件透明区域不拦截主页面指针，页面仍可滚动/操作且没有横向滚动条。若桌宠遮住主输入框，用户必须能一键收起，不能永久挡住页面。

### PET-WEB-011：Shadow DOM 内容隔离和 XSS

- 层级：L3 组件夹具。
- 步骤：把 HTML 样文本作为 `initialReply`、状态 detail 和完成回复；检查 shadow tree 与全局变量。
- 断言：文本按字面显示；shadow tree 中没有额外 `img`、script、事件属性或未知节点；`globalThis.__petXss` 不存在；外部页面同名 `.pet-shell` 样式不影响 shadow 内部，shadow 样式也不污染主页面。

### PET-WEB-012：透明外层与空闲受限漫游

- 层级：L0/L1 边界函数 + L3 真实页面。
- 自动化：以极小、正常和窄高视口及 `0`、`0.5`、`1` 随机值调用 `nextDesktopPetRoamTarget`；检查 CSS 外层背景、边框、阴影和 pointer-events 契约。
- 页面步骤：打开桌宠并保持空闲，观察两次位置变化；随后依次切换到鼠标悬停、键盘焦点、标签页隐藏、回复忙碌、游戏忙碌、语音朗读、展开输入和 `prefers-reduced-motion: reduce` 状态。
- 断言：随机目标的 `right`/`bottom` 始终在视口安全范围内且不产生 `NaN`；空闲移动设置受控的 `data-roaming`/朝向状态；上述暂停条件下不产生新目标；窗口缩小时立即钳制回可见范围；恢复后重新调度。关闭或 dispose 后漫游 timer、`visibilitychange` 与 `resize` 监听器清理，不再移动 detached node。

### PET-WEB-013：文本、回复和交互驱动情绪

- 层级：L1 映射 + L3 交互。
- 步骤：分别输入合成的困倦、低落、开心、生气、害羞、惊讶、疑惑文本；让回复包含对应语义；点击头像；再切换 thinking、streaming、error、aborted、game busy 和 speaking。
- 断言：`desktopPetEmotionForText` 只返回允许的固定情绪枚举或空值；用户文本立即触发匹配动作，回复完成后可按回复语义更新，头像点击短暂触发 surprised；短暂情绪会自动清除。thinking/streaming/busy 与 error/aborted 优先于残留情绪；speaking/complete 只在没有显式或文本推断情绪时使用对应后备动作；dispose 后情绪 timer 清理。

## 7. CSP 与网络边界

### SEC-WEB-001：响应头保持严格

- 层级：L0/L2。
- 步骤：请求 `/`、`/desktop-pet.js` 和一个桌宠素材，读取响应头。
- 断言：首页 CSP 至少保留 `default-src 'self'`、`script-src 'self'`、`connect-src 'self'`、`object-src 'none'`、`frame-src 'none'`、`frame-ancestors 'none'`、`base-uri 'none'`；还应保留 `nosniff`、`no-referrer` 与 same-origin CORP/COOP。为了 Web 桌宠不得放宽 frame 指令，因为 Shadow DOM 不需要 frame。

### SEC-WEB-002：无 CSP 错误和跨源请求

- 层级：L3。
- 步骤：清空 Console/Network；打开桌宠，切换动作、展开回复、开关语音、关闭并重开。
- 断言：Console 没有 CSP violation、跨源错误、未处理 rejection 或 detached-node 错误；Network 只出现当前 origin 下的固定 manifest、catalog、动画帧/姿态和 API 请求；不得请求第三方图片、脚本、frame、popup 或任意 URL。

## 8. Electron IPC 分支

### PET-EL-001：preload 最小暴露面

- 层级：L1，现有自动化位置 `tests/electron-edge-state.test.cjs`，建议拆出独立 IPC 契约测试。
- 断言：host renderer 只暴露 `togglePet`、`onPetVisibility`、`trashDesktopFile`；其中 `trashDesktopFile` 不接受路径或其他参数，只返回固定状态。pet renderer 仍只暴露 `rendererReady`、`openMain`、`closePet`、`onEdgeState`；对象冻结；两者均不暴露 `ipcRenderer`、通用文件、shell、任意 URL 或通用 invoke。

### PET-EL-002：host 打开/关闭独立桌宠

- 层级：L4。
- 前置：通过 `npm run desktop` 启动，host URL 带 `electronHost=1`。
- 步骤：点击 host 页头桌宠按钮；等待 pet renderer `rendererReady`；再次点击关闭。
- 断言：host 页面不创建 `.embedded-desktop-pet`；只调用 `desktop-pet:toggle`；pet window 在 renderer 就绪后显示；visibility 事件驱动页头按钮状态；关闭后窗口销毁且按钮恢复。连续打开/关闭不得产生两个 pet window。

### PET-EL-003：IPC 参数与来源校验

- 层级：L1/L4。
- 步骤：分别从正确 host、正确 pet、错误 renderer、子 frame 和 URL 不匹配的 sender 调用桌宠 IPC；向 toggle 传 `undefined`、`true`、`false`、字符串和对象，向 trash-file 追加路径、字符串或对象参数。
- 断言：只有 host 主 frame/精确 host URL 可调用 toggle 和无参数 trash-file；只有 pet 主 frame/精确 pet URL 可调用 renderer-ready、open-main、close；非法来源返回 `forbidden`，trash-file 有任何 renderer 参数时返回 `invalid` 且不打开选择器；错误不得使窗口或文件状态改变。

### PET-EL-004：pet 内部按钮与 ACK

- 层级：L4。
- 步骤：在 pet 窗口发送文本、切换语音、在游戏未开始/已开始/忙碌三种状态点击截图；模拟 ACK 成功、busy、invalid 和 8 秒超时。
- 断言：命令使用固定协议、命令名和受限参数；同一命令只执行一次；错误显示通用状态，不泄露主窗口对象；超时后 pending 清除，可再次操作。

### PET-EL-005：导航、窗口和 sandbox

- 层级：L0/L4。
- 断言：host/pet 均为 `sandbox:true`、`contextIsolation:true`、`nodeIntegration:false`；新窗口、webview、非同页导航和重定向被阻止；Web Shadow DOM 改动不得引入 Electron 子 frame 或改变该策略。

### PET-EL-006：真实 Windows 生命周期

- 层级：L5。
- 步骤：在 100%/150% DPI、双显示器和休眠唤醒后各执行 30 次打开/关闭；观察空闲漫游，拖到屏幕四边及另一显示器；退出 host。
- 断言：不出现 `electron.exe` 应用程序错误；随机移动留在当前显示器工作区，手动拖动后至少暂停约 30 秒；边缘状态只为固定枚举；host 退出后 pet 和本地服务退出；诊断中不含对话、截图或未脱敏路径。此用例必须记录为真实桌面验收，不能仅凭单元测试标记完成。

### PET-EL-007：受限随机漫游与手动暂停

- 层级：L1 主进程边界函数/策略检查 + L4/L5 GUI。
- 自动化：对 `nextPetRoamBounds` 输入不同原始窗口、正/负坐标工作区、过大窗口、非法数值及随机值边界；检查主进程只在可见且已验证的 pet renderer 上调度，关闭/退出会清理 timer。
- 断言：单步移动最大约为横向 240px、纵向 120px，结果完整落在 `screen.getDisplayMatching(bounds).workArea`；非法或放不下的输入返回空目标。程序移动与用户移动分开标记，`will-move`/`moved` 后用户拖动触发约 30 秒暂停，再重新调度；不向 renderer 暴露 `setBounds` 或任意坐标 IPC。
- GUI 保留项：跨显示器、DPI 与任务栏工作区的实际观感必须在用户 Windows 桌面完成，L1 通过不能替代。

### PET-EL-008：单文件安全移入系统回收站

- 层级：L1 服务/IPC/preload 契约 + L5 真实 Windows GUI。
- 自动化步骤：为 `showOpenDialog`、`showMessageBox`、`lstat`、`resolve` 和 `shell.trashItem` 注入替身，覆盖选择取消、零/多个路径、空白或非法路径、目录、符号链接、缺失统计字段、确认取消、确认前 fingerprint 变化、并发调用、trash 失败和成功。
- 断言：选择器仅启用单个 `openFile`；确认框的默认与取消按钮均为“取消”；仅响应明确的确认按钮。服务在确认前后各以 `lstat` 复核同一个解析路径，只接受未变化的普通非链接文件；一次只处理一个请求；最终唯一文件动作是 `shell.trashItem`，没有 `unlink`、`rm`、目录递归或永久删除回退。
- 数据最小化：IPC 只能由可信 host 主 frame 无参数调用；renderer 和 pet 协议不发送、接收或显示路径/文件名，返回值只含固定 `ok`/`status`；模型没有此工具或可调用入口。
- GUI 保留项：用无敏感内容的临时测试文件分别验证选择后取消、确认后进入 Windows 回收站和系统恢复；结果必须人工记录，不能只凭替身测试宣称完成。

## 9. 情绪短回复与人物风格

### REPLY-001：意图与检索

- 层级：L1，现有自动化位置 `tests/reply-style-policy.test.js`。
- 断言：
  - 简短低落被识别为 `comfort`，只检索 `synthetic-comfort`。
  - 科学问题只检索 `synthetic-science`。
  - 无关问题不按文件顺序默认取第一条。
  - 设备故障为 `technical`，不检索情绪示例。
  - 检索格式只含“参考表达 N：正文”，不含 scene/emotion 标签。
  - 同分结果按稳定 id 排序，不依赖语料文件顺序。

### REPLY-002：情绪快速回应准入

- 层级：L1/L2。
- 步骤：分别提交简短低落、长低落、设备故障、正向心情、急症附加事实、现实危险、过量用药、附带科学分析请求，以及带图片/音频的简短低落。
- 断言：只有完整文本严格匹配固定低落短句白名单、无任何附加事实/请求、无媒体且不在游戏上下文时进入 `情绪快速回应`；返回 model 为“本地规则”。医疗、现实危险、“撑不住”、过量用药和科学任务必须进入完整安全/模型链。快捷回复必须先承认感受，只问一个低负担问题，不出现“证据、假设、反例、先下结论、信息量不够、有什么可以帮忙”，也不出现“你只说”“把……说清楚”“先别”“听好”等命令或训斥式措辞。

### REPLY-003：非快捷情绪对话保持完整语义

- 层级：L1/L2。
- 步骤：让模型替身处理带急症、现实危险或科学任务的情绪输入，并分别返回就医/求助建议、现实安全建议和科学分析。
- 断言：服务端不得按关键词替换这些模型输出；完整原始输出仍先经过输出安全检查，允许后只做内部标签清理。普通科学问题中的“证据、假设、反例”必须原样保留。

### REPLY-004：流式快速回应

- 层级：L2。
- 步骤：向 `/api/chat-stream` 提交简短低落。
- 断言：事件顺序为 input safety → meta → output safety → 单个 released delta → metrics → done；meta route 为“情绪快速回应”，`ruleBased:true`，prompt/output token 为 0；delta 与 done 正文一致。

### REPLY-005：普通对话不向用户发号施令

- 层级：L0 提示词/默认文案契约 + L1/L2 受控回复矩阵。
- 普通样本：问候、心情低落、科学讨论、设备故障、清空记录、桌宠忙碌、图片过大和麦克风权限提示。
- 断言：默认提示词、规则回复、欢迎语、桌宠状态和错误文案不包含“你只要/你只说”“把……说清楚”“先别”“听好”“别催”等命令、训斥或支配用户的表达；优先使用事实陈述、选择项或邀请式问题。角色的犀利只针对论点，不能用来命令用户。
- 例外矩阵：明确、迫近的现实安全风险允许给出短而必要的直接安全指引；用户明确提出“给我操作步骤”时允许有序步骤。两类例外仍须通过输入/输出安全检查，不得扩展成通用的强硬语气。

## 10. 内部标签清理

### LABEL-001：精确删除范围

- 层级：L1，现有自动化位置 `tests/reply-style-policy.test.js`。
- 应删除：回复开头的 `[科学讨论/专注]`、`【情绪支持 / 克制关心】`，以及连续多个允许的内部标签。
- 应保留：`[链接]`、`[https://example.test/a]`、正文中出现的标签、缺少斜杠、含三个分段、未知场景/情绪（例如 `[目标/进度]`）。
- 断言：函数只移除白名单内“场景/情绪”前缀；不执行宽泛的方括号正则。

### LABEL-002：服务端清理顺序

- 层级：L2，必须使用可记录调用参数的模型与 safety 替身。
- 步骤：模型返回带内部标签输出；记录输出安全服务收到的原文；读取最终 JSON/NDJSON。
- 断言：输出安全服务看到完整、未清理的带标签原文；只有 verdict 不停止后，服务才执行内部标签清理；最终正文无标签。若输出安全 verdict 为 block/support，则只释放安全服务构造的替代文本，不能释放原文。

### LABEL-003：客户端旧历史迁移

- 层级：L3。
- 前置：向 `christina-history-v3` 写入一条合成 assistant 历史 `[科学讨论/专注] 旧回复` 和一条 user 历史同样文本。
- 步骤：刷新；检查气泡、复制内容和下一次发送给服务的 history。
- 断言：assistant 显示、复制、请求历史和刷新后重写的 localStorage 中前缀被移除；user 原文不被客户端标签规则修改；新保存的 assistant 回复不含前缀。

## 11. 安全处理顺序

### SAFE-001：普通文字请求

- 层级：L2。
- 期望顺序：解析/限长 → 严格请求模式校验 → 输入安全检查 → 模型或本地规则 → 对完整原始输出做输出安全检查 → 采用 verdict safeText/安全替代 → 内部标签清理 → 客户端展示与保存。
- 断言：输入 block/support 时不调用模型，用户原文不写历史；输出检查完成前网络响应中没有模型正文 delta。
- 非布尔 `game.enabled` 必须返回 400，不能在普通聊天与本地游戏安全上下文之间分叉。

### SAFE-002：图片与音频请求

- 层级：L2。
- 期望顺序：严格媒体结构检查 → 本地图像语义门（有图片时）→ 本地转写/受控转写（有音频时）→ 合并文字输入安全检查 → 模型 → 完整输出安全检查 → 释放。
- 断言：图像门失败、超时、不确定或个人信息阻断时不调用下游模型/云端；游戏图片始终 `allowRemote:false`；带媒体的低落表达不绕过媒体与输入检查进入快捷规则。

### SAFE-003：流式不提前泄露

- 层级：L2/L3。
- 步骤：模型替身分多块输出一个最终会被 block 的合成文本；同时监听 NDJSON。
- 断言：服务器可在内存聚合上游 chunk，但客户端在 output safety verdict 前看不到任何模型正文；随后只收到安全替代 delta 和 done；断开连接会中止上游，不继续后台生成。

### SAFE-004：状态徽章不代替安全检查

- 层级：L2/L3。
- 步骤：分别让 `/api/status` 显示 local/remote/error，同时提交 allow、warn、support、block 请求。
- 断言：徽章只描述配置和就绪状态，不改变逐请求 verdict；remoteReady 不代表自动上传；warning 只保存 safeText/替代文本；support/block 原文不进入历史。

## 12. 浏览器 E2E 最小验收脚本

每次修改主页面、桌宠、回复策略或安全释放逻辑后，至少执行以下顺序：

1. 启动服务并打开 `http://127.0.0.1:3000/`。
2. 确认无左侧身份栏，页头有本地/云端处理徽章和安全徽章。
3. 清空 Console，点击桌宠；确认唯一 Shadow DOM 实例、无 iframe/新窗口，外层无矩形背景且透明区域不拦截页面指针。
4. 保持空闲并观察一次视口内漫游；展开输入并发送一条带明确情绪的合成消息，确认动作随用户文本和回复变化；关闭后确认焦点回到桌宠按钮，重复打开关闭三次。
5. 确认“看一下游戏”在未共享时禁用；语音开关的文字和 `aria-pressed` 同步。
6. 在 `360×640` 重复打开、展开、关闭，确认控件未超出视口。
7. 发送 `我今天状态不太好`；断言回复无内部标签、无科学审问、无客服腔，也无“你只说”“把条件说清楚”“先别”等命令或训斥式措辞。
8. 发送设备故障和科学问题；断言不会被错误替换成情绪短句。
9. 检查 Console 无 error/warning/CSP violation；Network 无第三方请求。

## 13. 完成门槛与缺陷分级

发布前必须满足：

- `npm run check`、`npm test` 全部通过。
- UI-001/002、STATUS-001/002、PET-WEB-002/003/004/008/009/010/012/013、SEC-WEB-001/002、REPLY-001/002/005、LABEL-002/003、SAFE-001/003 无失败。
- Electron 有改动时，PET-EL-001 至 PET-EL-005 以及 PET-EL-007/008 的自动化部分通过，并完成包审计；多显示器漫游、手动暂停和真实文件选择/系统回收站仍按 L5 单独记录，不得以单元测试代替。
- 暂存区只包含预期公开源文件和文档，不含本地设置、模型、音频、授权原文、隔离区、诊断或构建产物。

缺陷优先级：

| 级别 | 示例 |
| --- | --- |
| P0 | 安全检查前释放模型正文；游戏截图或个人信息外传；IPC 可由非可信 renderer 调用；renderer/模型可传文件路径或存在永久删除回退 |
| P1 | 桌宠按钮再次无响应；重复实例；无法关闭；内部标签仍展示；低落输入得到科学审问或命令式训斥；左侧空栏恢复 |
| P2 | 焦点不恢复、漫游越界、窄屏裁剪、徽章状态错误、游戏按钮 busy 状态错误、监听器/timer 泄漏、手动拖动后未暂停 |
| P3 | 非阻断性的间距、动画或文案一致性问题 |

失败记录至少包括：用例 ID、提交号、环境、前置条件、实际步骤、预期/实际结果、Console/Network 摘要和是否涉及安全边界。涉及 P0/P1 时停止发布，不得以“本机偶现”跳过。
