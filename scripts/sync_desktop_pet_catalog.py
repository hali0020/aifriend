from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from pathlib import Path
from typing import Sequence

from validate_pet_asset import validate


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ROOT = PROJECT_ROOT / "public" / "desktop-pet-assets"
CATALOG_NAME = "catalog.json"
CHARACTER = "克里斯提娜（牧濑红莉西）"
FILE_PREFIX = "makise-kurisu-chibi-"
ASSET_NAME = re.compile(
    r"^makise-kurisu-chibi-(?P<number>[0-9]{2})-"
    r"(?P<slug>[a-z0-9]+(?:-[a-z0-9]+)*)\.png$"
)


class CatalogError(ValueError):
    """Raised when the asset directory cannot produce a safe catalog."""


def _candidate_pngs(root: Path) -> list[Path]:
    candidates: list[Path] = []
    for entry in root.iterdir():
        if not entry.is_file():
            continue
        name_lower = entry.name.lower()
        if name_lower.startswith(FILE_PREFIX) and name_lower.endswith(".png"):
            candidates.append(entry)
    return sorted(candidates, key=lambda item: item.name)


def build_catalog(root: Path) -> dict[str, object]:
    root = root.resolve()
    if not root.is_dir():
        raise CatalogError(f"素材目录不存在或不是目录：{root}")

    numbered: dict[int, tuple[str, Path]] = {}
    candidates = _candidate_pngs(root)
    if not candidates:
        raise CatalogError(f"未找到 {FILE_PREFIX}NN-slug.png 静态母版：{root}")

    for path in candidates:
        if path.is_symlink():
            raise CatalogError(f"拒绝符号链接素材：{path.name}")
        match = ASSET_NAME.fullmatch(path.name)
        if match is None:
            raise CatalogError(
                "不安全或不规范的素材文件名："
                f"{path.name}；slug 仅允许小写字母、数字和单连字符"
            )

        number = int(match.group("number"))
        if number in numbered:
            previous = numbered[number][1].name
            raise CatalogError(
                f"重复编号 {number:02d}：{previous}、{path.name}"
            )
        numbered[number] = (match.group("slug"), path)

    numbers = sorted(numbered)
    expected = list(range(1, len(numbers) + 1))
    if numbers != expected:
        if numbers[0] != 1:
            raise CatalogError(
                f"编号必须从 01 开始，当前最小编号为 {numbers[0]:02d}"
            )
        missing = sorted(set(range(1, numbers[-1] + 1)) - set(numbers))
        missing_text = "、".join(f"{number:02d}" for number in missing)
        raise CatalogError(f"素材编号存在缺号：{missing_text}")

    assets: list[dict[str, object]] = []
    for number in numbers:
        slug, path = numbered[number]
        try:
            validate(path)
        except (OSError, ValueError) as exc:
            raise CatalogError(f"素材验证失败：{exc}") from exc
        assets.append({"id": number, "state": slug, "file": path.name})

    return {
        "version": 1,
        "character": CHARACTER,
        "reference": assets[0]["file"],
        "assets": assets,
    }


def _load_catalog(path: Path) -> object:
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError:
        return None
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise CatalogError(f"无法读取现有目录清单 {path}：{exc}") from exc


def catalog_matches(path: Path, expected: dict[str, object]) -> bool:
    """Compare catalog content semantically so formatting changes do not matter."""

    return _load_catalog(path) == expected


def write_catalog_atomic(path: Path, catalog: dict[str, object]) -> None:
    payload = json.dumps(catalog, ensure_ascii=False, indent=2) + "\n"
    temporary_path: Path | None = None
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
            temporary_path = Path(handle.name)
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, path)
        temporary_path = None
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="验证桌宠静态母版，并确定性同步 catalog.json。"
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=DEFAULT_ROOT,
        help=f"素材目录（默认：{DEFAULT_ROOT}）",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="只验证并比较 catalog.json，不写入文件。",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        root = args.root.resolve()
        catalog = build_catalog(root)
        catalog_path = root / CATALOG_NAME
        matches = catalog_matches(catalog_path, catalog)
        if args.check:
            if not matches:
                print(f"目录清单需要同步：{catalog_path}", file=sys.stderr)
                return 1
            print(f"目录清单已同步且 {len(catalog['assets'])} 个素材均通过验证：{catalog_path}")
            return 0

        if matches:
            print(f"目录清单无需改动，{len(catalog['assets'])} 个素材均通过验证：{catalog_path}")
            return 0
        write_catalog_atomic(catalog_path, catalog)
        print(f"已原子写入 {len(catalog['assets'])} 个素材：{catalog_path}")
        return 0
    except CatalogError as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 1
    except OSError as exc:
        print(f"文件系统错误：{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
