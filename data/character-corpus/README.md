# 本地人物风格素材管线

这套管线只读取你主动放入本机目录的文本，不联网、不下载、不解包游戏，也不尝试判断素材授权。请只使用你有权处理的字幕、脚本或设定集摘录。

## 1. 准备素材

在项目根目录创建 `data/character-sources/`，放入以下格式之一：

- `.txt`
- `.json`
- `.jsonl`
- `.srt`
- `.vtt`
- `.ass`

其他扩展名会被忽略。脚本识别以下说话人别名：`克里斯提娜`、`克里斯蒂娜`、`牧濑红莉西`、`牧濑红莉栖`、`红莉西`、`牧瀬紅莉栖`、`Kurisu`。

文本最好保留明确的说话人标签，例如：

```text
冈部伦太郎：……
牧濑红莉栖：……
```

JSON/JSONL 支持常见字段名，例如 `speaker`/`character`/`角色` 与 `text`/`line`/`dialogue`/`台词`。SRT/VTT 可在字幕正文里使用 `角色：台词`；VTT 也支持 `<v Kurisu>台词</v>`。ASS 优先读取 Events 中 Dialogue 行的 `Name` 字段。

如果某个文件已确认每一行都是她的台词、但完全没有说话人标签，可以显式加入 `--unlabeled-is-target`。不要对混合角色字幕使用这个选项，否则其他人的台词也会被纳入。

## 2. 构建

在项目根目录下执行：

```powershell
python .\scripts\build_character_corpus.py --confirm-rights
```

也可以指定目录与限制：

```powershell
python .\scripts\build_character_corpus.py `
  --input .\data\character-sources `
  --output .\data\character-corpus `
  --max-examples 80 `
  --max-quote-chars 32 `
  --confirm-rights
```

只要识别到目标角色台词，脚本就要求显式提供 `--confirm-rights`。这个开关表示你已经确认拥有将输入文本用于本地处理或训练所需的权利；它不是自动授权，也不能替代许可文件。

脚本不主动调用网络客户端，并拒绝 URL 与 UNC 网络共享路径；映射盘或系统挂载点仍需你自行确认。单个文件默认限制为 20 MB。默认每条最多 32 字、每个源文件最多 12 条，且检索清单与音频清单内的原文合计不超过 2400 字。可以通过 `--max-per-source` 与 `--max-export-chars` 调整，但仍受硬上限约束。

## 3. 输出

- `style_dictionary.json`：统计得到的节奏、标点、功能词、场景分布、互动方式和表达边界，不保存完整台词。
- `retrieval_examples.jsonl`：去重后的短例句；包含派生的场景提示、情绪，以及源文件/行号/时间码。为防止还原连续剧情，不导出上一句其他角色原文。
- `audio_manifest.jsonl`：语音训练对齐模板。`audio_path`、`rights_basis` 默认留空，`rights_confirmed` 默认是 `false`。
- `report.json`：处理数量、文件哈希、错误与安全设置，便于回溯素材来源。

音频清单不会自动把文字“变成原声”。你需要为每行填入本地授权的干净音频片段，并确认起止点、逐字文本、角色、情绪和授权依据。只有人工核对后，才把 `rights_confirmed` 改为 `true` 并进入训练集。

文字模型使用 `retrieval_examples.jsonl` 时，应把短句当作语气参考并重新组织回答，不要拼接、背诵或续写原作剧情。`style_dictionary.json` 已包含相同的运行边界。

## 4. 自检

```powershell
python .\scripts\test_character_corpus.py
```

测试会在系统临时目录创建合成素材，覆盖六种格式、全部别名、重复去除、长句截断、来源记录和音频授权默认值，不读取你的真实素材。
