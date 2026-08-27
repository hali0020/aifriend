#!/usr/bin/env python3
"""Build a compact character-style corpus from user-supplied local text files.

The script is intentionally offline and dependency free. It reads only the
explicitly supported subtitle/text formats and never writes the complete source
dialogue back out. Every retained quotation is reduced to one short sentence.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Iterator, Sequence


SCHEMA_VERSION = "1.0"
ALLOWED_EXTENSIONS = {".txt", ".json", ".jsonl", ".srt", ".vtt", ".ass"}
ALIASES = (
    "克里斯提娜",
    "克里斯蒂娜",
    "牧濑红莉西",
    "牧濑红莉栖",
    "红莉西",
    "牧瀬紅莉栖",
    "Kurisu",
)
CANONICAL_NAME = "牧濑红莉栖"

SPEAKER_KEYS = {
    "speaker",
    "character",
    "name",
    "actor",
    "voice",
    "角色",
    "人物",
    "说话人",
    "說話人",
    "发言人",
    "發言人",
}
TEXT_KEYS = {
    "text",
    "line",
    "dialogue",
    "dialog",
    "content",
    "subtitle",
    "utterance",
    "lines",
    "dialogues",
    "utterances",
    "台词",
    "臺詞",
    "文本",
    "内容",
    "內容",
}
START_KEYS = {"start", "start_time", "starttime", "from", "开始", "開始"}
END_KEYS = {"end", "end_time", "endtime", "to", "结束", "結束"}

ALIAS_BY_NORMALIZED = {
    re.sub(r"[\s\[\]【】()（）<>《》:：_\-]+", "", alias).casefold(): alias
    for alias in ALIASES
}
VOICE_TAG_RE = re.compile(r"^\s*<v(?:\.[^\s>]*)?\s+([^>]+)>\s*(.*)$", re.IGNORECASE)
BRACKET_LABEL_RE = re.compile(
    r"^\s*[\[【（(]\s*([^\]】）)\r\n]{1,40})\s*[\]】）)]\s*(?:([:：|｜>\-])\s*)?(.*)$"
)
COLON_LABEL_RE = re.compile(r"^\s*([^\s:：|｜<>]{1,40})\s*[:：|｜]\s*(.+)$")
QUOTED_LABEL_RE = re.compile(r"^\s*([^「『“\"]{1,40})\s*[「『“\"](.+?)[」』”\"]\s*$")
TIMING_RE = re.compile(
    r"(?P<start>\d{1,2}:\d{2}(?::\d{2})?[,.]\d{2,3})\s*-->\s*"
    r"(?P<end>\d{1,2}:\d{2}(?::\d{2})?[,.]\d{2,3})"
)
HTML_TAG_RE = re.compile(r"<[^>]+>")
ASS_TAG_RE = re.compile(r"\{\\[^}]*}")
LEADING_STAGE_RE = re.compile(r"^\s*[（(\[【][^）)\]】\r\n]{0,24}[）)\]】]\s*")
CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")

SCENE_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        "scientific_reasoning",
        (
            "科学",
            "实验",
            "實驗",
            "证据",
            "證據",
            "理论",
            "理論",
            "假设",
            "假說",
            "数据",
            "數據",
            "论文",
            "論文",
            "因果",
            "概率",
            "観測",
            "実験",
            "証拠",
            "science",
            "evidence",
        ),
    ),
    (
        "concern",
        (
            "担心",
            "擔心",
            "小心",
            "休息",
            "没事吧",
            "沒事吧",
            "不要勉强",
            "別勉強",
            "身体",
            "身體",
            "心配",
            "無理しない",
        ),
    ),
    (
        "praise_response",
        ("夸", "誇", "厉害", "厲害", "天才", "优秀", "優秀", "すごい", "天才ね"),
    ),
    (
        "conflict_or_correction",
        (
            "不对",
            "不對",
            "错了",
            "錯了",
            "胡说",
            "胡說",
            "笨蛋",
            "白痴",
            "反对",
            "反對",
            "違う",
            "馬鹿",
            "間違",
        ),
    ),
    (
        "teasing_or_joke",
        ("吐槽", "玩笑", "开玩笑", "開玩笑", "中二", "哼", "呵", "笑", "冗談", "ふふ"),
    ),
)

EMOTION_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("concerned", ("担心", "擔心", "小心", "休息", "没事吧", "心配", "無理しない")),
    ("embarrassed", ("才不是", "别误会", "別誤會", "笨蛋", "哼", "べ、別に", "勘違い")),
    ("annoyed", ("够了", "夠了", "烦", "煩", "胡说", "白痴", "馬鹿", "いい加減")),
    ("teasing", ("中二", "玩笑", "开玩笑", "呵", "ふふ", "冗談")),
    ("confident", ("当然", "當然", "显然", "顯然", "肯定", "当然でしょ", "明らか")),
)

FUNCTIONAL_MARKERS = (
    "但是",
    "不过",
    "不過",
    "所以",
    "因此",
    "也就是说",
    "也就是說",
    "首先",
    "至少",
    "总之",
    "總之",
    "难道",
    "難道",
    "明明",
    "才不是",
    "别误会",
    "別誤會",
    "笨蛋",
    "証拠",
    "つまり",
    "でも",
    "だから",
    "まさか",
    "別に",
)

ENDING_MARKERS = (
    "吧",
    "吗",
    "嗎",
    "呢",
    "啊",
    "呀",
    "哦",
    "哼",
    "对吧",
    "對吧",
    "でしょ",
    "でしょう",
    "よ",
    "ね",
    "わ",
    "の",
    "か",
)

INTERACTION_BLUEPRINTS = {
    "scientific_reasoning": ["核对前提", "说明证据或推理", "给出暂定结论"],
    "concern": ["指出状态或风险", "给出可执行建议", "用一句克制的关心收束"],
    "praise_response": ["校正夸张部分", "接受可验证的事实", "简短回应"],
    "conflict_or_correction": ["直接指出问题", "反问或纠正", "保留清晰边界"],
    "teasing_or_joke": ["抓住逻辑漏洞", "短促吐槽", "回到正题"],
    "everyday": ["直接回应", "必要时补一句解释"],
}

SCENE_CONTEXTS = {
    "scientific_reasoning": "围绕证据、实验或推理展开的讨论",
    "concern": "对方的状态或风险需要被回应",
    "praise_response": "对方给出夸奖或肯定",
    "conflict_or_correction": "需要纠正事实或逻辑错误",
    "teasing_or_joke": "轻松玩笑或可克制吐槽的场景",
    "everyday": "日常交流",
}


@dataclass
class Record:
    source_file: str
    source_format: str
    locator: str
    order: int
    text: str
    speaker: str | None = None
    matched_alias: str | None = None
    start: str | None = None
    end: str | None = None

    @property
    def is_target(self) -> bool:
        return self.matched_alias is not None


class FileCollector:
    """Collect ordered records for one source file."""

    def __init__(self, source_file: str, source_format: str, unlabeled_is_target: bool):
        self.source_file = source_file
        self.source_format = source_format
        self.unlabeled_is_target = unlabeled_is_target
        self.records: list[Record] = []

    def add(
        self,
        text: Any,
        locator: str,
        speaker: Any = None,
        start: Any = None,
        end: Any = None,
    ) -> None:
        if not isinstance(text, str):
            return
        cleaned_speaker = clean_speaker(speaker) if speaker is not None else None
        current_speaker = cleaned_speaker
        block_lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
        for physical_line, raw_line in enumerate(block_lines, start=1):
            if not raw_line.strip():
                current_speaker = cleaned_speaker
                continue
            inferred_speaker, dialogue, speaker_only = split_speaker_label(
                raw_line,
                allow_unknown_speaker=cleaned_speaker is None and not self.unlabeled_is_target,
            )
            if inferred_speaker is not None:
                current_speaker = inferred_speaker
            elif cleaned_speaker is not None:
                current_speaker = cleaned_speaker
            if speaker_only:
                continue
            cleaned_text = clean_dialogue(dialogue)
            if not cleaned_text:
                continue
            alias = match_alias(current_speaker)
            if alias is None and current_speaker is None and self.unlabeled_is_target:
                alias = CANONICAL_NAME
            if len(block_lines) == 1:
                line_locator = locator
            elif locator.startswith("line:") and "#" not in locator:
                try:
                    first_line = int(locator.split(":", 1)[1])
                    line_locator = f"line:{first_line + physical_line - 1}"
                except ValueError:
                    line_locator = f"{locator}#line:{physical_line}"
            else:
                line_locator = f"{locator}#line:{physical_line}"
            self.records.append(
                Record(
                    source_file=self.source_file,
                    source_format=self.source_format,
                    locator=line_locator,
                    order=len(self.records),
                    text=cleaned_text,
                    speaker=current_speaker,
                    matched_alias=alias,
                    start=string_or_none(start),
                    end=string_or_none(end),
                )
            )


def string_or_none(value: Any) -> str | None:
    if value is None:
        return None
    result = str(value).strip()
    return result or None


def normalize_speaker(value: str) -> str:
    return re.sub(r"[\s\[\]【】()（）<>《》:：_\-]+", "", value).casefold()


def clean_speaker(value: Any) -> str | None:
    if not isinstance(value, (str, int, float)):
        return None
    result = HTML_TAG_RE.sub("", str(value)).strip().strip("[]【】()（）<>《》:：|｜")
    return result.strip() or None


def match_alias(speaker: str | None) -> str | None:
    if not speaker:
        return None
    normalized = normalize_speaker(speaker)
    return ALIAS_BY_NORMALIZED.get(normalized)


def split_speaker_label(
    raw_line: str,
    allow_unknown_speaker: bool,
) -> tuple[str | None, str, bool]:
    voice_match = VOICE_TAG_RE.match(raw_line)
    if voice_match:
        speaker = clean_speaker(voice_match.group(1))
        return speaker, voice_match.group(2), not bool(voice_match.group(2).strip())

    # Preserve the semantic WebVTT <v> tag above, then remove ordinary subtitle
    # styling before looking for labels such as <b>克里斯提娜：...</b>.
    label_line = HTML_TAG_RE.sub("", raw_line)

    bracket_match = BRACKET_LABEL_RE.match(label_line)
    if bracket_match:
        candidate = clean_speaker(bracket_match.group(1))
        separator = bracket_match.group(2)
        remainder = bracket_match.group(3)
        # [叹气] 真是的 is a stage cue, while [角色]：台词 is a label.
        if match_alias(candidate) or (allow_unknown_speaker and separator):
            return candidate, remainder, not bool(remainder.strip())

    colon_match = COLON_LABEL_RE.match(label_line)
    if colon_match:
        candidate = clean_speaker(colon_match.group(1))
        if (
            candidate
            and (match_alias(candidate) or allow_unknown_speaker)
            and not re.match(r"^(?:https?|file)$", candidate, re.IGNORECASE)
        ):
            return candidate, colon_match.group(2), False

    quote_match = QUOTED_LABEL_RE.match(label_line)
    if quote_match:
        candidate = clean_speaker(quote_match.group(1))
        if match_alias(candidate) or allow_unknown_speaker:
            return candidate, quote_match.group(2), False

    exact_candidate = clean_speaker(label_line)
    if match_alias(exact_candidate):
        return exact_candidate, "", True
    return None, label_line, False


def clean_dialogue(text: str) -> str:
    result = text.replace("\\N", " ").replace("\\n", " ").replace("&nbsp;", " ")
    result = ASS_TAG_RE.sub("", result)
    result = HTML_TAG_RE.sub("", result)
    result = CONTROL_RE.sub("", result)
    result = LEADING_STAGE_RE.sub("", result)
    result = re.sub(r"\s+", " ", result).strip()
    result = result.strip("「」『』“”\"")
    return result.strip()


def read_text_safely(path: Path, max_file_bytes: int) -> tuple[str, int, str]:
    payload = path.read_bytes()
    size = len(payload)
    if size > max_file_bytes:
        raise ValueError(f"文件超过大小上限（{size} > {max_file_bytes} bytes）")
    if b"\x00" in payload[:1024] and not (payload.startswith(b"\xff\xfe") or payload.startswith(b"\xfe\xff")):
        raise ValueError("文件看起来是二进制内容")
    for encoding in ("utf-8-sig", "utf-16", "gb18030", "cp932"):
        try:
            return payload.decode(encoding), size, hashlib.sha256(payload).hexdigest()
        except UnicodeDecodeError:
            pass
    raise ValueError("无法解码文本；尝试过 UTF-8/UTF-16/GB18030/CP932")


def first_dict_value(mapping: dict[str, Any], keys: set[str]) -> Any:
    for key, value in mapping.items():
        if str(key).strip().casefold() in keys:
            return value
    return None


def walk_json_text(value: Any, pointer: str, collector: FileCollector, speaker: Any) -> None:
    """Read strings only after an explicit text-like field selected the value."""
    if isinstance(value, str):
        collector.add(value, pointer or "/", speaker=speaker)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            child_pointer = f"{pointer}/{index}"
            if isinstance(child, str):
                collector.add(child, child_pointer, speaker=speaker)
            elif isinstance(child, (dict, list)):
                walk_json(child, child_pointer, collector, speaker)
    elif isinstance(value, dict):
        walk_json(value, pointer, collector, speaker)


def walk_json(
    value: Any,
    pointer: str,
    collector: FileCollector,
    inherited_speaker: Any = None,
    top_level_strings_are_text: bool = False,
) -> None:
    if isinstance(value, dict):
        speaker = first_dict_value(value, SPEAKER_KEYS) or inherited_speaker
        start = first_dict_value(value, START_KEYS)
        end = first_dict_value(value, END_KEYS)
        for key, child in value.items():
            normalized_key = str(key).strip().casefold()
            escaped_key = str(key).replace("~", "~0").replace("/", "~1")
            child_pointer = f"{pointer}/{escaped_key}"
            if normalized_key in TEXT_KEYS:
                if isinstance(child, str):
                    collector.add(child, pointer or "/", speaker=speaker, start=start, end=end)
                else:
                    walk_json_text(child, child_pointer, collector, speaker)
            elif isinstance(child, (dict, list)):
                # Recurse to find nested records, but do not interpret arbitrary
                # strings (for example tags/notes arrays) as dialogue.
                walk_json(child, child_pointer, collector, speaker)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            child_pointer = f"{pointer}/{index}"
            if isinstance(child, str) and top_level_strings_are_text:
                collector.add(child, child_pointer, speaker=inherited_speaker)
            elif isinstance(child, (dict, list)):
                walk_json(child, child_pointer, collector, inherited_speaker)
    elif isinstance(value, str) and top_level_strings_are_text:
        collector.add(value, pointer or "/", speaker=inherited_speaker)


def parse_json(text: str, collector: FileCollector) -> None:
    value = json.loads(text)
    walk_json(value, "", collector, top_level_strings_are_text=True)


def parse_jsonl(text: str, collector: FileCollector) -> None:
    for line_number, line in enumerate(text.splitlines(), start=1):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValueError(f"JSONL 第 {line_number} 行无效：{exc.msg}") from exc
        walk_json(value, f"line:{line_number}", collector, top_level_strings_are_text=True)


def parse_txt(text: str, collector: FileCollector) -> None:
    collector.add(text, "line:1")


def subtitle_blocks(text: str) -> Iterator[list[str]]:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    for raw_block in re.split(r"\n\s*\n", normalized):
        lines = [line.strip("\ufeff") for line in raw_block.split("\n") if line.strip()]
        if lines:
            yield lines


def parse_srt_or_vtt(text: str, collector: FileCollector, is_vtt: bool) -> None:
    cue_index = 0
    for lines in subtitle_blocks(text):
        if is_vtt and lines[0].strip().upper().startswith(("WEBVTT", "NOTE", "STYLE", "REGION")):
            continue
        timing_index = next((index for index, line in enumerate(lines) if "-->" in line), None)
        if timing_index is None:
            continue
        timing_match = TIMING_RE.search(lines[timing_index])
        if not timing_match:
            continue
        cue_index += 1
        cue_text = "\n".join(lines[timing_index + 1 :])
        collector.add(
            cue_text,
            f"cue:{cue_index}",
            start=timing_match.group("start").replace(",", "."),
            end=timing_match.group("end").replace(",", "."),
        )


def parse_ass(text: str, collector: FileCollector) -> None:
    in_events = False
    fields = ["layer", "start", "end", "style", "name", "marginl", "marginr", "marginv", "effect", "text"]
    event_index = 0
    for raw_line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = raw_line.strip("\ufeff")
        if line.startswith("[") and line.endswith("]"):
            in_events = line.casefold() == "[events]"
            continue
        if not in_events:
            continue
        if line.casefold().startswith("format:"):
            fields = [part.strip().casefold() for part in line.split(":", 1)[1].split(",")]
            continue
        if not line.casefold().startswith("dialogue:"):
            continue
        event_index += 1
        payload = line.split(":", 1)[1].lstrip()
        parts = payload.split(",", max(0, len(fields) - 1))
        if len(parts) != len(fields):
            continue
        event = dict(zip(fields, parts))
        collector.add(
            event.get("text", ""),
            f"dialogue:{event_index}",
            speaker=event.get("name") or None,
            start=event.get("start"),
            end=event.get("end"),
        )


PARSERS = {
    ".txt": parse_txt,
    ".json": parse_json,
    ".jsonl": parse_jsonl,
    ".srt": lambda text, collector: parse_srt_or_vtt(text, collector, False),
    ".vtt": lambda text, collector: parse_srt_or_vtt(text, collector, True),
    ".ass": parse_ass,
}


def safe_relative(path: Path, root: Path) -> str:
    return path.resolve().relative_to(root.resolve()).as_posix()


def discover_source_files(input_dir: Path, output_dir: Path | None) -> list[Path]:
    root = input_dir.resolve()
    output_root = output_dir.resolve() if output_dir else None
    discovered: list[Path] = []
    for candidate in input_dir.rglob("*"):
        if not candidate.is_file() or candidate.suffix.casefold() not in ALLOWED_EXTENSIONS:
            continue
        relative_parts = candidate.relative_to(input_dir).parts[:-1]
        if any(part.casefold() == "quarantine" for part in relative_parts):
            continue
        resolved = candidate.resolve()
        try:
            resolved.relative_to(root)
        except ValueError:
            continue
        if output_root is not None:
            try:
                resolved.relative_to(output_root)
                continue
            except ValueError:
                pass
        discovered.append(candidate)
    return sorted(discovered, key=lambda item: safe_relative(item, root).casefold())


def parse_source_file(
    path: Path,
    input_root: Path,
    max_file_bytes: int,
    unlabeled_is_target: bool,
) -> tuple[list[Record], dict[str, Any]]:
    relative = safe_relative(path, input_root)
    extension = path.suffix.casefold()
    metadata: dict[str, Any] = {"file": relative, "format": extension.lstrip(".")}
    collector = FileCollector(relative, extension.lstrip("."), unlabeled_is_target)
    try:
        size_bytes = path.stat().st_size
        metadata["size_bytes"] = size_bytes
        if size_bytes > max_file_bytes:
            raise ValueError(f"文件超过大小上限（{size_bytes} > {max_file_bytes} bytes）")
        text, actual_size, digest = read_text_safely(path, max_file_bytes)
        metadata["size_bytes"] = actual_size
        metadata["sha256"] = digest
        PARSERS[extension](text, collector)
        metadata["status"] = "processed"
        metadata["records"] = len(collector.records)
        metadata["target_records"] = sum(record.is_target for record in collector.records)
    except (OSError, UnicodeError, ValueError, json.JSONDecodeError, RecursionError) as exc:
        metadata["status"] = "error"
        metadata["error"] = str(exc)
        collector.records.clear()
    return collector.records, metadata


def normalized_dialogue(text: str) -> str:
    return re.sub(r"[\s\W_]+", "", text, flags=re.UNICODE).casefold()


def short_sentence(text: str, max_chars: int) -> str:
    cleaned = clean_dialogue(text)
    if not cleaned:
        return ""
    segments = re.findall(r"[^。！？!?；;\n]+[。！？!?；;]?", cleaned)
    candidate = segments[0].strip() if segments else cleaned
    if len(candidate) < 8 and len(segments) > 1:
        combined = (candidate + segments[1].strip()).strip()
        if len(combined) <= max_chars:
            candidate = combined
    if len(candidate) <= max_chars:
        return candidate
    available = max_chars - 1
    prefix = candidate[:available]
    cut_points = [prefix.rfind(mark) for mark in ("，", ",", "、", "：", ":")]
    cut_at = max(cut_points)
    if cut_at >= max(8, available // 2):
        prefix = prefix[:cut_at]
    return prefix.rstrip("，,、：:；;。.!！?？ ") + "…"


def classify_scene(text: str) -> str:
    folded = text.casefold()
    for scene, signals in SCENE_RULES:
        if any(signal.casefold() in folded for signal in signals):
            return scene
    return "everyday"


def classify_emotion(text: str) -> str:
    folded = text.casefold()
    for emotion, signals in EMOTION_RULES:
        if any(signal.casefold() in folded for signal in signals):
            return emotion
    if "？" in text or "?" in text:
        return "questioning"
    if "！" in text or "!" in text:
        return "emphatic"
    if "…" in text or "..." in text:
        return "hesitant"
    return "neutral"


def detect_language(text: str) -> str:
    hiragana_or_katakana = len(re.findall(r"[\u3040-\u30ff]", text))
    latin = len(re.findall(r"[A-Za-z]", text))
    han = len(re.findall(r"[\u3400-\u9fff]", text))
    if hiragana_or_katakana:
        return "ja"
    if latin > han:
        return "en"
    return "zh"


def select_examples(
    records_by_file: dict[str, list[Record]],
    max_examples: int,
    max_chars: int,
    max_per_source: int,
    max_export_chars: int,
) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    seen: set[str] = set()
    for source_file in sorted(records_by_file, key=str.casefold):
        all_records = records_by_file[source_file]
        for record in all_records:
            if not record.is_target:
                continue
            response = short_sentence(record.text, max_chars)
            dedupe_key = normalized_dialogue(response.rstrip("…"))
            if not response or len(dedupe_key) < 2 or dedupe_key in seen:
                continue
            seen.add(dedupe_key)
            source: dict[str, Any] = {
                "file": record.source_file,
                "format": record.source_format,
                "locator": record.locator,
            }
            if record.start:
                source["start"] = record.start
            if record.end:
                source["end"] = record.end
            scene = classify_scene(record.text)
            candidates.append(
                {
                    "scene": scene,
                    "emotion": classify_emotion(record.text),
                    "language": detect_language(record.text),
                    "context": {
                        "type": "derived_scene",
                        "text": SCENE_CONTEXTS[scene],
                    },
                    "response": response,
                    "source": source,
                    "matched_alias": record.matched_alias,
                }
            )

    # Round-robin selection keeps a large everyday bucket from hiding rarer modes.
    buckets: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for candidate in candidates:
        buckets[candidate["scene"]].append(candidate)
    scene_order = [*INTERACTION_BLUEPRINTS]
    selected: list[dict[str, Any]] = []
    selected_by_source: Counter[str] = Counter()
    # Response text is intentionally present once in retrieval JSONL and once
    # in the audio manifest, so charge it twice against the export budget.
    exported_quote_chars = 0
    while len(selected) < max_examples and any(buckets.values()):
        popped = False
        for scene in scene_order:
            if buckets[scene] and len(selected) < max_examples:
                candidate = buckets[scene].pop(0)
                popped = True
                source_file = candidate["source"]["file"]
                export_cost = len(candidate["response"]) * 2
                if selected_by_source[source_file] >= max_per_source:
                    continue
                if exported_quote_chars + export_cost > max_export_chars:
                    continue
                selected.append(candidate)
                selected_by_source[source_file] += 1
                exported_quote_chars += export_cost
        if not popped:
            break
    for index, example in enumerate(selected, start=1):
        example["id"] = f"kurisu-{index:04d}"
        example["usage"] = "retrieval_style_reference"
    return selected


def ratio(numerator: int, denominator: int) -> float:
    return round(numerator / denominator, 4) if denominator else 0.0


def build_style_dictionary(
    target_records: Sequence[Record],
    examples: Sequence[dict[str, Any]],
    source_metadata: Sequence[dict[str, Any]],
    max_quote_chars: int,
    max_per_source: int,
    max_export_chars: int,
) -> dict[str, Any]:
    texts = [record.text for record in target_records]
    total = len(texts)
    lengths = [len(text) for text in texts]
    question_count = sum("?" in text or "？" in text for text in texts)
    exclamation_count = sum("!" in text or "！" in text for text in texts)
    ellipsis_count = sum("…" in text or "..." in text for text in texts)
    rational_count = sum(
        any(signal in text.casefold() for signal in ("证据", "證據", "实验", "實驗", "所以", "因此", "つまり", "証拠"))
        for text in texts
    )
    correction_count = sum(
        any(signal in text.casefold() for signal in ("不对", "不對", "错", "錯", "难道", "難道", "違う", "間違"))
        for text in texts
    )
    concern_count = sum(classify_scene(text) == "concern" for text in texts)
    scene_counts = Counter(classify_scene(text) for text in texts)
    emotion_counts = Counter(classify_emotion(text) for text in texts)
    marker_counts = Counter(
        marker
        for text in texts
        for marker in FUNCTIONAL_MARKERS
        if marker.casefold() in text.casefold()
    )
    ending_counts = Counter()
    for text in texts:
        stripped = text.rstrip("。！？!?；;….,， ")
        for ending in ENDING_MARKERS:
            if stripped.endswith(ending):
                ending_counts[ending] += 1
                break

    average_length = round(sum(lengths) / total, 2) if total else 0.0
    if not total:
        summary = ["尚无可用目标角色台词；风格结论保持为空，等待本地素材。"]
    else:
        rhythm = "短促" if average_length <= 20 else "中等长度" if average_length <= 45 else "偏长"
        summary = [f"语句整体为{rhythm}，平均 {average_length} 个字符。"]
        if ratio(question_count, total) >= 0.2:
            summary.append("疑问或反问出现较多，适合用来核对前提或指出逻辑问题。")
        if ratio(rational_count, total) >= 0.1:
            summary.append("可观察到证据、实验或因果连接词，回答可优先呈现推理链。")
        if ratio(correction_count, total) >= 0.1:
            summary.append("纠错表达较明显，语气可以直接，但结论应落回事实。")
        if ratio(concern_count, total) >= 0.05:
            summary.append("关心通常与风险提示或可执行建议一起出现，避免空泛安慰。")
        if ratio(ellipsis_count, total) >= 0.15:
            summary.append("停顿符号较常见，可少量用于犹豫或克制，不宜每句滥用。")

    modes = []
    for scene, response_order in INTERACTION_BLUEPRINTS.items():
        observed = scene_counts.get(scene, 0)
        modes.append(
            {
                "scene": scene,
                "observed_utterances": observed,
                "evidence_level": "high" if observed >= 10 else "medium" if observed >= 3 else "low",
                "recommended_response_order": response_order,
            }
        )

    processed_sources = [item for item in source_metadata if item.get("status") == "processed"]
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "character": {"canonical_name": CANONICAL_NAME, "aliases": list(ALIASES)},
        "corpus": {
            "source_files": len(processed_sources),
            "target_utterances": total,
            "retrieval_examples": len(examples),
            "quote_limit_chars": max_quote_chars,
            "quote_limit_per_source": max_per_source,
            "total_serialized_quote_budget_chars": max_export_chars,
            "serialized_quote_characters": sum(len(example["response"]) * 2 for example in examples),
            "input_policy": "user_supplied_local_text_only",
            "supported_formats": sorted(extension.lstrip(".") for extension in ALLOWED_EXTENSIONS),
        },
        "style_profile": {
            "summary": summary,
            "rhythm": {
                "average_characters": average_length,
                "minimum_characters": min(lengths) if lengths else 0,
                "maximum_characters_observed": max(lengths) if lengths else 0,
            },
            "punctuation": {
                "question_rate": ratio(question_count, total),
                "exclamation_rate": ratio(exclamation_count, total),
                "ellipsis_rate": ratio(ellipsis_count, total),
            },
            "reasoning_and_tone": {
                "reasoning_marker_rate": ratio(rational_count, total),
                "correction_marker_rate": ratio(correction_count, total),
                "concern_scene_rate": ratio(concern_count, total),
            },
            "functional_markers": [
                {"marker": marker, "count": count, "rate": ratio(count, total)}
                for marker, count in marker_counts.most_common()
            ],
            "sentence_endings": [
                {"marker": marker, "count": count, "rate": ratio(count, total)}
                for marker, count in ending_counts.most_common()
            ],
            "scene_distribution": dict(sorted(scene_counts.items())),
            "emotion_distribution": dict(sorted(emotion_counts.items())),
            "interaction_modes": modes,
        },
        "response_guardrails": {
            "preferred": [
                "先回应事实或前提，再表达态度",
                "推理段保持短而完整",
                "吐槽应针对逻辑或情境，不攻击用户身份",
                "关心要落到具体建议，语气保持克制",
            ],
            "avoid": [
                "客服式套话和连续致歉",
                "无条件附和或过度温柔",
                "括号动作、舞台指示和过量卖萌",
                "长篇自我分析或解释自己正在扮演角色",
                "拼接、背诵或续写原作长段台词",
            ],
            "identity_boundary": "作为受角色风格启发的 AI 表达，不声称是现实人物或官方角色实例。",
        },
        "retrieval_policy": {
            "file": "retrieval_examples.jsonl",
            "instruction": "仅将短例句作为语气参考；结合当前问题重新组织回答，不逐字复现。",
            "never_concatenate_source_quotes": True,
            "source_dialogue_context_exported": False,
            "maximum_source_quote_chars": max_quote_chars,
            "maximum_examples_per_source": max_per_source,
            "maximum_serialized_quote_characters": max_export_chars,
        },
    }


def build_audio_manifest(examples: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    manifest: list[dict[str, Any]] = []
    for example in examples:
        source = example["source"]
        manifest.append(
            {
                "id": example["id"],
                "audio_path": "",
                "text": example["response"],
                "speaker": CANONICAL_NAME,
                "matched_alias": example["matched_alias"],
                "language": example["language"],
                "emotion": example["emotion"],
                "scene": example["scene"],
                "source": source,
                "clip_start": source.get("start"),
                "clip_end": source.get("end"),
                "rights_confirmed": False,
                "rights_basis": "",
                "review_status": "needs_audio_and_rights_review",
                "notes": "填入本地授权音频片段；确认文本与音频逐字对齐后再用于训练。",
            }
        )
    return manifest


def json_line(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(value, ensure_ascii=False, indent=2) + "\n"
    write_text_atomically(path, payload)


def write_jsonl(path: Path, values: Iterable[Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = "".join(json_line(value) + "\n" for value in values)
    write_text_atomically(path, payload)


def write_text_atomically(path: Path, payload: str) -> None:
    temporary_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            newline="\n",
            prefix=f".{path.name}.",
            suffix=".tmp",
            dir=path.parent,
            delete=False,
        ) as handle:
            temporary_name = handle.name
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        Path(temporary_name).replace(path)
    finally:
        if temporary_name:
            temporary = Path(temporary_name)
            if temporary.exists():
                temporary.unlink()


def validate_local_directory(raw_path: str, label: str) -> Path:
    if "://" in raw_path:
        raise ValueError(f"{label} 只接受本地目录路径，不接受 URL")
    if raw_path.strip().startswith(("\\\\", "//")):
        raise ValueError(f"{label} 不接受 UNC/网络共享路径")
    path = Path(raw_path).expanduser().resolve()
    if str(path).startswith("\\\\"):
        raise ValueError(f"{label} 不接受 UNC/网络共享路径")
    return path


def build_corpus(args: argparse.Namespace) -> dict[str, Any]:
    input_dir = validate_local_directory(args.input, "--input")
    output_dir = validate_local_directory(args.output, "--output")
    if not input_dir.is_dir():
        raise ValueError(f"输入目录不存在：{input_dir}")
    if input_dir == output_dir:
        raise ValueError("输入目录与输出目录不能相同")
    try:
        input_dir.relative_to(output_dir)
    except ValueError:
        pass
    else:
        raise ValueError("输出目录不能是输入目录的上级目录")

    files = discover_source_files(input_dir, output_dir)
    records_by_file: dict[str, list[Record]] = {}
    source_metadata: list[dict[str, Any]] = []
    for path in files:
        records, metadata = parse_source_file(
            path,
            input_dir,
            args.max_file_mb * 1024 * 1024,
            args.unlabeled_is_target,
        )
        source_metadata.append(metadata)
        if metadata.get("status") == "processed":
            records_by_file[metadata["file"]] = records

    target_records = [record for records in records_by_file.values() for record in records if record.is_target]
    if target_records and not args.confirm_rights:
        raise ValueError(
            "识别到目标台词，但尚未确认处理权利。请确认授权范围后显式加入 --confirm-rights；"
            "脚本不会在未确认时写出引用内容。"
        )
    examples = select_examples(
        records_by_file,
        args.max_examples,
        args.max_quote_chars,
        args.max_per_source,
        args.max_export_chars,
    )
    style_dictionary = build_style_dictionary(
        target_records,
        examples,
        source_metadata,
        args.max_quote_chars,
        args.max_per_source,
        args.max_export_chars,
    )
    audio_manifest = build_audio_manifest(examples)
    report = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": style_dictionary["generated_at"],
        "input_directory": str(input_dir),
        "output_directory": str(output_dir),
        "settings": {
            "max_examples": args.max_examples,
            "max_quote_chars": args.max_quote_chars,
            "max_per_source": args.max_per_source,
            "max_export_chars": args.max_export_chars,
            "max_file_mb": args.max_file_mb,
            "unlabeled_is_target": args.unlabeled_is_target,
            "rights_confirmed_by_user": args.confirm_rights,
        },
        "summary": {
            "candidate_files": len(files),
            "processed_files": sum(item.get("status") == "processed" for item in source_metadata),
            "failed_files": sum(item.get("status") == "error" for item in source_metadata),
            "parsed_records": sum(item.get("records", 0) for item in source_metadata),
            "target_records": len(target_records),
            "deduplicated_examples": len(examples),
        },
        "sources": source_metadata,
        "safety": {
            "network_client_used": False,
            "path_policy": "URL 与 UNC 路径被拒绝；映射盘或挂载点由用户自行确认。",
            "full_source_text_exported": False,
            "quotes_truncated_to_chars": args.max_quote_chars,
            "serialized_quote_characters": sum(len(example["response"]) * 2 for example in examples),
            "rights_assumption": "用户已显式确认文本处理权利；音频仍须逐条确认，清单默认 rights_confirmed=false。",
        },
    }

    output_dir.mkdir(parents=True, exist_ok=True)
    write_json(output_dir / "style_dictionary.json", style_dictionary)
    write_jsonl(output_dir / "retrieval_examples.jsonl", examples)
    write_jsonl(output_dir / "audio_manifest.jsonl", audio_manifest)
    write_json(output_dir / "report.json", report)
    return report


def bounded_integer(minimum: int, maximum: int):
    def parse(value: str) -> int:
        integer = int(value)
        if integer < minimum or integer > maximum:
            raise argparse.ArgumentTypeError(f"必须在 {minimum} 到 {maximum} 之间")
        return integer

    return parse


def build_argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="从本地合法持有的文本/字幕中提取角色风格与短检索示例（完全离线）。"
    )
    parser.add_argument("--input", default="data/character-sources", help="本地素材目录")
    parser.add_argument("--output", default="data/character-corpus", help="输出目录")
    parser.add_argument(
        "--max-examples",
        type=bounded_integer(1, 500),
        default=80,
        help="最多保留多少条去重后的短例句（1-500，默认 80）",
    )
    parser.add_argument(
        "--max-quote-chars",
        type=bounded_integer(16, 64),
        default=32,
        help="每条原文短句最大字符数（16-64，默认 32）",
    )
    parser.add_argument(
        "--max-per-source",
        type=bounded_integer(1, 50),
        default=12,
        help="每个源文件最多导出的短例句数（1-50，默认 12）",
    )
    parser.add_argument(
        "--max-export-chars",
        type=bounded_integer(256, 16000),
        default=2400,
        help="检索和音频清单合计可序列化的原文字符预算（默认 2400）",
    )
    parser.add_argument(
        "--max-file-mb",
        type=bounded_integer(1, 200),
        default=20,
        help="单个素材文件大小上限（默认 20 MB）",
    )
    parser.add_argument(
        "--unlabeled-is-target",
        action="store_true",
        help="仅当一个文件确定全是目标角色台词时使用；把无说话人标签的文本视为目标角色。",
    )
    parser.add_argument(
        "--confirm-rights",
        action="store_true",
        help="确认你拥有将输入文本用于本地处理/训练所需的权利；识别到台词时必须显式提供。",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")
    parser = build_argument_parser()
    args = parser.parse_args(argv)
    try:
        report = build_corpus(args)
    except (OSError, ValueError) as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 2
    print(json.dumps(report["summary"], ensure_ascii=False, indent=2))
    if report["summary"]["failed_files"]:
        print("警告：部分文件未处理；详情见 report.json。", file=sys.stderr)
    if not report["summary"]["target_records"]:
        print("提示：未识别到目标角色台词；请检查说话人标签或显式使用 --unlabeled-is-target。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
