from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw


SCRIPT = Path(__file__).with_name("sync_desktop_pet_catalog.py")


def create_asset(root: Path, name: str, *, transparent: bool = True) -> Path:
    path = root / name
    if transparent:
        image = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
        draw = ImageDraw.Draw(image)
        draw.ellipse((96, 64, 416, 448), fill=(126, 72, 63, 255))
    else:
        image = Image.new("RGBA", (512, 512), (126, 72, 63, 255))
    image.save(path)
    return path


class CatalogSyncTests(unittest.TestCase):
    def run_sync(self, root: Path, *arguments: str) -> subprocess.CompletedProcess[str]:
        environment = os.environ.copy()
        environment["PYTHONIOENCODING"] = "utf-8"
        return subprocess.run(
            [sys.executable, str(SCRIPT), "--root", str(root), *arguments],
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            env=environment,
        )

    def test_writes_catalog_and_check_is_read_only(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            create_asset(root, "makise-kurisu-chibi-01-joyful-wave.png")
            create_asset(root, "makise-kurisu-chibi-02-thinking.png")

            written = self.run_sync(root)
            self.assertEqual(written.returncode, 0, written.stderr)
            catalog_path = root / "catalog.json"
            self.assertEqual(list(root.glob(".catalog.json.*.tmp")), [])
            catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
            self.assertEqual(catalog["version"], 1)
            self.assertEqual(catalog["character"], "克里斯提娜（牧濑红莉西）")
            self.assertEqual(catalog["reference"], "makise-kurisu-chibi-01-joyful-wave.png")
            self.assertEqual(
                catalog["assets"],
                [
                    {
                        "id": 1,
                        "state": "joyful-wave",
                        "file": "makise-kurisu-chibi-01-joyful-wave.png",
                    },
                    {
                        "id": 2,
                        "state": "thinking",
                        "file": "makise-kurisu-chibi-02-thinking.png",
                    },
                ],
            )

            before = catalog_path.read_bytes()
            checked = self.run_sync(root, "--check")
            self.assertEqual(checked.returncode, 0, checked.stderr)
            self.assertEqual(catalog_path.read_bytes(), before)

            catalog["version"] = 99
            catalog_path.write_text(json.dumps(catalog), encoding="utf-8")
            mismatched_before = catalog_path.read_bytes()
            mismatch = self.run_sync(root, "--check")
            self.assertEqual(mismatch.returncode, 1)
            self.assertIn("需要同步", mismatch.stderr)
            self.assertEqual(catalog_path.read_bytes(), mismatched_before)

    def test_rejects_missing_number(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            create_asset(root, "makise-kurisu-chibi-01-idle.png")
            create_asset(root, "makise-kurisu-chibi-03-angry.png")
            result = self.run_sync(root)
            self.assertEqual(result.returncode, 1)
            self.assertIn("缺号", result.stderr)
            self.assertFalse((root / "catalog.json").exists())

    def test_rejects_non_one_start(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            create_asset(root, "makise-kurisu-chibi-02-idle.png")
            result = self.run_sync(root)
            self.assertEqual(result.returncode, 1)
            self.assertIn("01", result.stderr)

    def test_rejects_duplicate_number(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            create_asset(root, "makise-kurisu-chibi-01-idle.png")
            create_asset(root, "makise-kurisu-chibi-01-thinking.png")
            result = self.run_sync(root)
            self.assertEqual(result.returncode, 1)
            self.assertIn("重复编号", result.stderr)

    def test_rejects_unsafe_slug(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            create_asset(root, "makise-kurisu-chibi-01-bad_slug.png")
            result = self.run_sync(root)
            self.assertEqual(result.returncode, 1)
            self.assertIn("不安全", result.stderr)

    def test_rejects_asset_without_transparency(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            create_asset(
                root,
                "makise-kurisu-chibi-01-opaque.png",
                transparent=False,
            )
            result = self.run_sync(root)
            self.assertEqual(result.returncode, 1)
            self.assertIn("透明背景", result.stderr)

    def test_rejects_non_png_payload_with_png_extension(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path = root / "makise-kurisu-chibi-01-renamed-webp.png"
            image = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
            draw = ImageDraw.Draw(image)
            draw.ellipse((96, 64, 416, 448), fill=(126, 72, 63, 255))
            image.save(path, format="WEBP", lossless=True)

            result = self.run_sync(root)
            self.assertEqual(result.returncode, 1)
            self.assertIn("实际格式必须为 PNG", result.stderr)

    def test_rejects_oversized_canvas_before_cataloging(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path = root / "makise-kurisu-chibi-01-too-wide.png"
            image = Image.new("RGBA", (4097, 512), (0, 0, 0, 0))
            draw = ImageDraw.Draw(image)
            draw.ellipse((96, 64, 416, 448), fill=(126, 72, 63, 255))
            image.save(path)

            result = self.run_sync(root)
            self.assertEqual(result.returncode, 1)
            self.assertIn("单边尺寸超过 4096", result.stderr)

    def test_rejects_animated_png(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path = root / "makise-kurisu-chibi-01-animated.png"
            first = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
            second = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
            ImageDraw.Draw(first).ellipse((96, 64, 416, 448), fill=(126, 72, 63, 255))
            ImageDraw.Draw(second).ellipse((112, 64, 432, 448), fill=(126, 72, 63, 255))
            first.save(path, save_all=True, append_images=[second], duration=100, loop=0)

            result = self.run_sync(root)
            self.assertEqual(result.returncode, 1)
            self.assertIn("不能包含动画帧", result.stderr)

    def test_rejects_file_larger_than_16_mb_before_decoding(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path = root / "makise-kurisu-chibi-01-too-large.png"
            with path.open("wb") as handle:
                handle.seek(16 * 1024 * 1024)
                handle.write(b"\0")

            result = self.run_sync(root)
            self.assertEqual(result.returncode, 1)
            self.assertIn("文件过大", result.stderr)

    def test_rejects_semtransparent_canvas_with_only_a_thin_clear_border(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path = root / "makise-kurisu-chibi-01-fake-alpha.png"
            image = Image.new("RGBA", (512, 512), (255, 255, 255, 64))
            draw = ImageDraw.Draw(image)
            draw.rectangle((0, 0, 511, 511), outline=(0, 0, 0, 0), width=2)
            draw.ellipse((96, 64, 416, 448), fill=(126, 72, 63, 255))
            image.save(path)

            result = self.run_sync(root)
            self.assertEqual(result.returncode, 1)
            self.assertIn("没有可用的透明背景", result.stderr)

    def test_rejects_nontransparent_content_touching_any_canvas_edge(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path = create_asset(root, "makise-kurisu-chibi-01-edge-touch.png")
            with Image.open(path) as opened:
                image = opened.copy()
            ImageDraw.Draw(image).rectangle((220, 0, 292, 40), fill=(126, 72, 63, 255))
            image.save(path)

            result = self.run_sync(root)
            self.assertEqual(result.returncode, 1)
            self.assertIn("接触画布边缘", result.stderr)


if __name__ == "__main__":
    unittest.main()
