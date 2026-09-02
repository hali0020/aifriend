# 开发交接与未完成事项

更新时间：2026-09-02

本文是后续开发会话的入口。修改代码、功能、安全策略或桌宠素材前必须先完整阅读；纯学习、只读查看、安装依赖或搭建运行环境时可以跳过。

产品范围固定为本地 AI 桌宠与桌面伴侣；不再保留偏离该定位的行业控制模块、专用数据集或评测入口。后续新增评测应直接覆盖对话、人物风格、桌宠交互、游戏陪玩、隐私与通用内容安全。

## 当前可用基线

- Web 服务与 Electron 桌宠已经接入同一个本地 Agent。
- 主聊天页已删除冗余身份侧栏，隐私与安全状态收拢到紧凑页头。Web 桌宠固定使用页面内 Shadow DOM 浮层，不依赖弹窗、iframe 或画中画；外层没有矩形背景，空闲时只在视口安全范围内受限漫游。Electron host 仍通过受限 IPC 打开独立透明桌宠窗口，并在当前显示器工作区内受限随机漫游；用户手动拖动后会暂停自动移动。
- 默认语言模型为本机 Ollama；本地不可用时不会自动上传到云端。`OLLAMA_URL` 只接受字面量 `http://127.0.0.1` 或 `http://[::1]`（可带端口），拒绝主机名、局域网/公网地址、凭据、路径、查询、片段和 HTTP 重定向。
- 本地 ASR 只在发送录音时以短生命周期 Python 进程按需启动并退出；系统 TTS 只在用户启用语音模式、试听或需要朗读回复时工作，不会加载 faster-whisper。
- 普通对话和游戏分析均有输入、完整输出两道本地文本安全检查。图片还必须先经过严格媒体结构检查和本地视觉语义门；模型缺失、超时、截断、非法/双通道输出或不确定标签均失败即拒绝。
- 可选 OpenAI Moderation 默认关闭。普通图片也必须先通过本地语义门才可能远程复核；个人信息图片在任何远端下游之前阻断，游戏画面始终禁止远程审核。
- Electron renderer 启用 sandbox、context isolation、有限 IPC、来源校验、导航/新窗口阻断和临时本地端口。
- Electron 打包版已分离只读资源、Roaming 用户数据、Local 模型/运行时/诊断和 Chromium `sessionData`；聊天历史及 TTS/游戏偏好不会随 Roaming 漫游。开发版继续使用仓库中的 `data/` 与 `models/`。转写脚本从受 Fuse 保护的 ASAR 提取，并在每次执行前校验 SHA-256；Python 解释器解析为绝对路径。
- 游戏陪玩只接受用户明确选择的窗口并离散截帧给本地视觉模型；不读取游戏内存、不控制键鼠、不落盘、不进入普通聊天历史。取消换窗会保留旧流，变化跳帧有上限，停止会中止所有游戏请求并验证模型释放结果。
- 桌宠静态素材已验收并编入目录 88 张（编号 01–88）；动画共 84 帧。最近 12 张可在桌宠中轮换，约 3.5 秒后恢复待机/边缘姿态。
- 人物提示词使用“克里斯提娜/牧濑红莉西”的理性、证据意识、反问、克制吐槽和嘴硬式关心，不冒充真人或官方产品。
- 普通对话不再用“你只要”“把条件说清楚”“先别”等命令、训斥或支配用户的措辞；只有存在明确、迫近的现实安全风险，或用户明确要求操作步骤时，才允许必要的直接指引。桌宠情绪由用户文本、回复内容和点击/忙碌等交互状态共同驱动。
- 人物风格检索按中文二元/三元片段和场景硬隔离，不再把零分的科学示例默认塞进情绪对话；内部 `[场景/情绪]` 标签只在完整输出安全检查后清理。只有整句属于固定低落短句、且无图片/音频/游戏上下文时才走本地快速回应，附加医疗、现实危险或分析请求时必须走完整安全与模型链。
- Electron host 新增一项窄文件能力：用户从系统文件选择器选择一个普通文件，经默认取消的二次确认后，只能由主进程调用 `shell.trashItem` 移入系统回收站。renderer 不传入或接收路径，模型不能触发；桌宠中的用户点击只发送固定空参数意图，由 host 决定是否调用该能力。目录、符号链接及确认期间发生变化的文件均拒绝，没有 `unlink`、`rm` 或其他永久删除回退。host preload 仅暴露 `togglePet`、`onPetVisibility`、`trashDesktopFile`。
- 公开仓库使用重建后的净化历史；真实用户资料集中在被忽略的 `data/user-profile.local.json`，私有发布元数据集中在被忽略的 `release.local.cjs`，仓库只保留空值/中性示例。
- Windows Forge/Squirrel 构建可生成 `Setup.exe`、`.nupkg` 和 `RELEASES`。Electron 官方 ZIP 以 npm 包内 `checksums.json` 校验，Squirrel 使用固定 SHA-256 的 NuGet 6.11.1；打包采用严格运行时白名单，生成后校验全部应用源文件哈希、HTML/JS 依赖、私密边界和 Electron Fuses。`out/` 与 `downloads/` 缓存不提交。
- `npm run desktop:diagnose` 显式开启纯本地 Crashpad dump、脱敏事件 JSONL 和原始 Chromium 日志；默认关闭、不上传，并限制大小、数量和保留时间。原始日志与 dump 外发前必须人工检查。
- 当前自动化基线为 189 个 Node 测试（以最新 `npm run check` 输出为准），另有桌面启动策略、实际服务/模型冒烟、浏览器页面检查和 Python 语料/素材验证；主界面、桌宠与回复策略的可执行矩阵见 `docs/DESKTOP_PET_TEST_DESIGN.md`。

## 本轮已完成的原待办

1. 已逐张生成、透明化、人工视觉检查并验证桌宠静态动作 83–88；绿幕源图和失败稿只在 `data/quarantine/imagegen/`，最终 PNG 与 `catalog.json` 已同步。
2. 已在 `/api/chat`、`/api/chat-stream`、`/api/game/analyze-stream` 接入本地图像语义门，并补真实模型 `thinking` 通道、截断拒绝、代理绕过和 307/308 重定向外传测试。
3. 已修复游戏换窗取消、慢变化漏帧、失败后无法重试、旧帧捕获、文字/桌宠游戏请求无法停止、普通历史串入、剧情例句检索、显存释放竞态和 Electron 窗口数量截断等问题；UI 使用“降低剧透”，不作绝对保证。
4. 已加入纯本地 Electron 崩溃诊断、renderer/GPU/utility 事件记录、结构化 JSONL 脱敏/轮换和运行期大小上限；UtilityProcess 的字符串诊断报告只提取白名单摘要和字节数，不保存可能含路径/环境的原文。Chromium 直接写入的 `chromium-raw.log` 无法保证脱敏，按原始诊断材料处理。关闭诊断时仍排空子进程管道，且不改变 Node 未处理异常的默认终止语义。
5. 已加入 Forge/Squirrel 安装器、Windows 图标、Squirrel 启动事件处理、ASAR、Electron Fuses、运行时路径分离、严格发布白名单、相对依赖与源文件哈希审计；第三方运行依赖只打包实际入口，不带测试和仓库元数据。
6. 转写脚本不再裸露在 `app.asar.unpacked`：打包版从完整性保护的 ASAR 提取到用户目录并逐次校验哈希；Python 使用绝对解释器路径，语音状态会检查 `faster-whisper` 并向前端返回准确原因，临时录音在完成后等待删除并清理过期残留。
7. 已删除主页面冗余侧栏，修复内置浏览器中桌宠按钮无响应，并加入页面内 Shadow DOM 桌宠；同时修复中文风格检索零分回退、内部标签泄漏和简短低落回复的长延迟。Web 打开/关闭/唯一实例及短回复已在真实页面验证，Electron 安装包已重建并通过包边界与 Fuse 审计。
8. 已移除普通回复中的命令式、训斥式默认措辞；Web 桌宠改为透明外层和空闲受限漫游，用户文本、回复及交互会切换情绪；Electron 加入工作区内受限随机漫游并在手动拖动后暂停。新增 Electron host 专用的安全回收站流程及确定性测试，`electron/pet-roam.cjs`、`electron/file-trash-service.cjs` 已进入严格包白名单；真实 GUI 结果仍按下节单独验收。

## 仍需外部条件或真实桌面验收

以下事项不能只靠仓库代码诚实地宣称完成：

1. **真实 GUI 长时间运行**：在用户自己的 Windows PowerShell 运行 `npm run desktop:diagnose`，覆盖真实 GPU、多显示器/DPI、休眠唤醒、窗口频繁开关，以及跨显示器漫游和手动拖动暂停；另需实际执行一次“选择普通文件—默认取消确认”和一次确认移入 Windows 回收站，核对文件选择、取消及恢复结果。自动化已验证边界计算和失败关闭策略，但不能代替这些真实桌面结论。
2. **真实游戏体验**：用具体游戏检查独占全屏、HDR、最小化、窗口关闭重开、截帧延迟、显存释放和“降低剧透”体验。程序不读取隐藏状态，因此无法对通用视觉模型作绝对无剧透保证。
3. **正式签名与自动更新**：当前开发 `Setup.exe` 是未签名的本机测试产物。正式发布需要用户提供仓库外管理的代码签名证书/服务，并用两个已签名 GitHub Release 在真实 Windows 机器完成升级和回滚验收；在此之前自动更新保持禁用。
4. **合法角色文本/音频**：仓库没有原作完整台词或语音。只有用户合法持有并确认授权的素材可放入本地 `data/character-sources/`；隔离区、构建产物和训练输出不得提交。
5. **音色克隆**：按用户要求继续暂停。当前系统语音不应宣称是牧濑红莉西或官方声优音色。
6. **视觉安全深化**：当前语义门复用通用 `qwen3-vl:4b`，属于失败关闭的最小实现。发布级方案仍需合法评测集验证误报/漏报，并考虑受限完整解码与重编码以剥除 EXIF/XMP/ICC；不能描述成专用生产级审核器。
7. **继续扩充桌宠动作**：83–88 已完成；无限连续生成没有自然完成条件，按此前收尾决定继续暂停。恢复时仍须逐张生成、逐张验收，不允许批量放行。

## 下一次开发的固定起点

1. 先查看 `git status --short --branch`，保留已有未提交内容。
2. 阅读本文和 `README.md`，确认本次只处理一个明确范围。
3. 运行 `npm ci`（仅首次或锁文件变化时）。
4. 修改前先运行相关专项测试；修改后至少运行 `npm run check`。需要真实 Agent/模型链时，先启动 `npm start`，再运行 `npm test`。
5. 新增桌宠静态 PNG 时：
   - 使用 `public/desktop-pet-assets/makise-kurisu-chibi-01-joyful-wave.png` 作为风格母版。
   - 最终文件必须为真实 RGBA 静态 PNG、透明背景/四角、连续编号、单文件不超过 16MB。
   - 绿幕、预览和失败稿只放 `data/quarantine/imagegen/`，不得提交。
   - 逐张运行 `python scripts/validate_pet_asset.py <文件>` 并人工查看透明边缘、手指、肢体和动作语义。
   - 最后运行 `npm run catalog:sync`、`npm run test:catalog` 和 `npm run test:pet`。
6. 修改 Electron 发布链时运行 `npm run make:desktop`，随后运行 `npm run audit:package`；需要审计其他架构/路径时使用 `npm run audit:package -- <实际输出目录>`。检查安装器 Authenticode 状态，不得把未签名产物称为正式发布版。
7. 在真实页面验证最近 12 张轮换顺序、待机恢复，并确认浏览器 console 无 error/warning。
8. 提交前运行 `git diff --check`，检查暂存区和实际包内容，不提交 `.env`、本地用户资料、模型、音频、授权原文、隔离区、诊断 dump、`out/`、`work/`、`tmp/` 或运行时状态。

## Electron 发布与诊断约束

- `forge.config.cjs` 的打包规则与 `electron/package-boundary.cjs` 是发布安全边界；`.gitignore` 不能替代它们。新增运行时模块或公开资源必须同步白名单和包审计测试。
- `electron/pet-roam.cjs` 与 `electron/file-trash-service.cjs` 是当前允许进入包的运行时模块；修改文件名、依赖或入口时必须同步严格包白名单、源哈希和 Electron 契约测试。
- `scripts/audit-electron-package.cjs` 必须对实际输出执行，并保持 Fuses：禁用 RunAsNode、`NODE_OPTIONS`、CLI inspect 和额外 `file://` 权限，启用 ASAR 完整性与 OnlyLoadAppFromAsar。
- 打包版设置、资料、记忆和自定义语料位于 Electron 标准 `userData`（Windows 通常在 Roaming AppData）；模型、提取脚本、诊断、Chromium session/cache，以及 localStorage 中的聊天历史与 TTS/游戏偏好位于 Local AppData。旧版 Roaming session 不自动迁移或删除；企业备份/漫游策略仍可能处理 Roaming 数据，卸载也未必删除两处残留，不能把“应用不上传”等同于“操作系统绝不备份”。
- 诊断默认关闭且不得增加自动上传。`events.jsonl` 只保存经过路径、邮箱和常见凭据赋值脱敏的事件元数据，不主动记录对话或截图；`chromium-raw.log` 由 Chromium 直接写入，可能含完整路径、URL 或控制台内容，dump 可能含内存片段。原始日志和 dump 外发前都必须人工检查。
- 完整 `npm audit` 中 Electron Forge 的 `extract-zip` 上游开发依赖仍有告警；`npm audit --omit=dev` 应保持 0。不要运行会降级 Forge 的 `npm audit fix --force`。

## 不可破坏的安全边界

- 不得把“本地优先”悄悄改成自动云端回退；远程处理必须由用户明确选择。
- Ollama 只允许字面量 HTTP 回环地址，固定同源 `/api/*` 且拒绝重定向；不得为兼容代理而放宽。
- 图片先通过结构检查和本地语义门；不确定、超时、模型缺失、截断或非法输出全部失败关闭。
- 游戏截图及其分析始终 `allowRemote: false`。
- `data/user-profile.local.json` 与 `data/memory.json` 只允许进入本地普通聊天；云端模式与游戏陪玩不得读取或发送它们，前端与 Electron IPC 不得暴露原文。
- 被安全策略判为 `support` 或 `block` 的用户原文不写历史；敏感信息只保存脱敏版本。
- 模型完整输出通过输出检查后才能展示，不能为追求流式观感而先泄露再拦截。
- Electron 不开放通用文件、shell、任意 URL 或任意 IPC 能力；唯一文件例外是 host renderer 上无路径参数的 `trashDesktopFile`。主进程自行完成单文件选择、默认取消的二次确认、普通文件/非链接/未变化复核，并且只调用 `shell.trashItem`；不得允许 renderer 或模型传入路径，不得增加永久删除回退。
- 桌宠只覆盖显示，不向游戏或其他进程注入代码。
- 不抓取、打包或提交未经许可的完整原作脚本、Alarm/导航语音包或社区转载资源。
