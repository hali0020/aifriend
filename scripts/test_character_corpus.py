#!/usr/bin/env python3
"""Self-contained regression test for build_character_corpus.py."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "build_character_corpus.py"


def write(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8")


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="character-corpus-test-") as temporary:
        temporary_path = Path(temporary)
        sources = temporary_path / "sources"
        output = temporary_path / "output"
        sources.mkdir()

        write(
            sources / "dialogue.txt",
            "冈部伦太郎：你确定吗？\n"
            "克里斯提娜：先检查证据，再讨论结论。\n"
            "克里斯提娜：先检查证据，再讨论结论。\n",
        )
        write(
            sources / "script.json",
            json.dumps(
                {
                    "dialogues": [
                        {
                            "speaker": "牧濑红莉西",
                            "text": "这是一条没有标点而且刻意写得非常非常非常非常非常非常非常非常非常非常长的测试文本用于验证安全截断机制不会输出完整台词",
                            "tags": ["标签数组绝不能成为目标台词"],
                        },
                        {"角色": "红莉西", "台词": "别误会，我只是提醒你休息。"},
                        {"speaker": "冈部伦太郎", "text": "这一行不能进入目标语料。"},
                        {"speaker": "牧濑红莉栖的母亲", "text": "模糊别名不能被识别。"},
                    ]
                },
                ensure_ascii=False,
            ),
        )
        write(
            sources / "lines.jsonl",
            json.dumps({"character": "牧濑红莉栖", "line": "这个假设还缺少实验数据。"}, ensure_ascii=False)
            + "\n",
        )
        write(
            sources / "episode.srt",
            "1\n00:00:01,000 --> 00:00:03,000\n<b>克里斯蒂娜：难道你没发现逻辑问题吗？</b>\n",
        )
        write(
            sources / "clip.vtt",
            "WEBVTT\n\n00:00:04.000 --> 00:00:06.000\n<v Kurisu>真是的，至少先听我说完。</v>\n",
        )
        write(
            sources / "track.ass",
            "[Script Info]\nTitle: test\n\n[Events]\n"
            "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
            "Dialogue: 0,0:00:07.00,0:00:09.00,Default,牧瀬紅莉栖,0,0,0,,{\\i1}当然，这只是暂定结论。{\\i0}\n",
        )
        write(sources / "ignored.md", "牧濑红莉栖：这个文件格式必须被忽略。\n")
        quarantine = sources / "quarantine"
        quarantine.mkdir()
        write(quarantine / "must-not-ingest.vtt", "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n<v Kurisu>隔离区文本不能进入语料。\n")

        denied_output = temporary_path / "denied-output"
        denied = subprocess.run(
            [sys.executable, str(SCRIPT), "--input", str(sources), "--output", str(denied_output)],
            cwd=ROOT,
            text=True,
            encoding="utf-8",
            capture_output=True,
            check=False,
        )
        assert denied.returncode == 2
        assert not (denied_output / "retrieval_examples.jsonl").exists()

        completed = subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "--input",
                str(sources),
                "--output",
                str(output),
                "--max-quote-chars",
                "48",
                "--confirm-rights",
            ],
            cwd=ROOT,
            text=True,
            encoding="utf-8",
            capture_output=True,
            check=False,
        )
        assert completed.returncode == 0, completed.stderr or completed.stdout

        style = json.loads((output / "style_dictionary.json").read_text(encoding="utf-8"))
        report = json.loads((output / "report.json").read_text(encoding="utf-8"))
        examples = read_jsonl(output / "retrieval_examples.jsonl")
        manifest = read_jsonl(output / "audio_manifest.jsonl")

        assert report["summary"]["candidate_files"] == 6
        assert report["summary"]["processed_files"] == 6
        assert report["summary"]["failed_files"] == 0
        assert report["summary"]["target_records"] == 8
        assert len(examples) == 7, "重复台词应该被去重"
        assert len(manifest) == len(examples)
        assert style["character"]["canonical_name"] == "牧濑红莉栖"
        assert set(style["character"]["aliases"]) == {
            "克里斯提娜",
            "克里斯蒂娜",
            "牧濑红莉西",
            "牧濑红莉栖",
            "红莉西",
            "牧瀬紅莉栖",
            "Kurisu",
        }
        assert all(0 < len(example["response"]) <= 48 for example in examples)
        assert all(example["source"]["file"] for example in examples)
        assert all(example["context"]["type"] == "derived_scene" for example in examples)
        assert any(example["response"].endswith("…") for example in examples)
        assert all(row["audio_path"] == "" for row in manifest)
        assert all(row["rights_confirmed"] is False for row in manifest)
        assert all(row["review_status"] == "needs_audio_and_rights_review" for row in manifest)

        serialized_outputs = "\n".join(
            path.read_text(encoding="utf-8")
            for path in (
                output / "style_dictionary.json",
                output / "retrieval_examples.jsonl",
                output / "audio_manifest.jsonl",
                output / "report.json",
            )
        )
        assert "这个文件格式必须被忽略" not in serialized_outputs
        assert "用于验证安全截断机制不会输出完整台词" not in serialized_outputs
        assert "标签数组绝不能成为目标台词" not in serialized_outputs
        assert "模糊别名不能被识别" not in serialized_outputs

        unlabeled_sources = temporary_path / "unlabeled-sources"
        unlabeled_output = temporary_path / "unlabeled-output"
        unlabeled_sources.mkdir()
        write(unlabeled_sources / "only-her.txt", "[叹气] 真是的。\n结论：证据不足。\n")
        unlabeled = subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "--input",
                str(unlabeled_sources),
                "--output",
                str(unlabeled_output),
                "--unlabeled-is-target",
                "--confirm-rights",
            ],
            cwd=ROOT,
            text=True,
            encoding="utf-8",
            capture_output=True,
            check=False,
        )
        assert unlabeled.returncode == 0, unlabeled.stderr or unlabeled.stdout
        unlabeled_report = json.loads((unlabeled_output / "report.json").read_text(encoding="utf-8"))
        unlabeled_examples = read_jsonl(unlabeled_output / "retrieval_examples.jsonl")
        assert unlabeled_report["summary"]["target_records"] == 2
        assert any(example["response"] == "结论：证据不足。" for example in unlabeled_examples)

    print("character corpus pipeline: ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
