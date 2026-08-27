from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image


MAX_FILE_BYTES = 16 * 1024 * 1024
MAX_DIMENSION = 4096
MAX_PIXELS = 12_000_000


def validate(path: Path) -> dict[str, object]:
    file_size = path.stat().st_size
    if file_size > MAX_FILE_BYTES:
        raise ValueError(
            f"{path.name}: 文件过大（{file_size} 字节，上限 {MAX_FILE_BYTES} 字节）"
        )
    with Image.open(path) as image:
        if image.format != "PNG":
            raise ValueError(
                f"{path.name}: 实际格式必须为 PNG，当前为 {image.format or '未知'}"
            )
        if getattr(image, "is_animated", False) or getattr(image, "n_frames", 1) != 1:
            raise ValueError(f"{path.name}: 桌宠静态母版不能包含动画帧")
        if image.mode != "RGBA":
            raise ValueError(f"{path.name}: 需要 RGBA，当前为 {image.mode}")
        width, height = image.size
        if width < 512 or height < 512:
            raise ValueError(f"{path.name}: 分辨率过低（{width}x{height}）")
        if width > MAX_DIMENSION or height > MAX_DIMENSION:
            raise ValueError(
                f"{path.name}: 单边尺寸超过 {MAX_DIMENSION}（{width}x{height}）"
            )
        if width * height > MAX_PIXELS:
            raise ValueError(
                f"{path.name}: 像素总量超过 {MAX_PIXELS}（{width}x{height}）"
            )
        image.load()
        alpha = image.getchannel("A")
        minimum, maximum = alpha.getextrema()
        histogram = alpha.histogram()
        total_pixels = width * height
        fully_transparent = histogram[0]
        near_transparent = sum(histogram[:17])
        transparent = sum(histogram[:250])
        opaque = sum(histogram[250:])
        if minimum >= 250 or fully_transparent < max(1, total_pixels // 20):
            raise ValueError(f"{path.name}: 没有可用的透明背景")
        if maximum < 250 or opaque == 0:
            raise ValueError(f"{path.name}: 没有足够的不透明角色像素")
        corner_alpha = [alpha.getpixel(point) for point in ((0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1))]
        if max(corner_alpha) > 16:
            raise ValueError(f"{path.name}: 画布角落不是透明背景")
        border_max = max(
            alpha.crop(box).getextrema()[1]
            for box in (
                (0, 0, width, 1),
                (0, height - 1, width, height),
                (0, 1, 1, height - 1),
                (width - 1, 1, width, height - 1),
            )
        )
        if border_max > 16:
            raise ValueError(f"{path.name}: 角色或残留背景接触画布边缘")
        return {
            "file": str(path.resolve()),
            "width": width,
            "height": height,
            "mode": image.mode,
            "format": image.format,
            "file_bytes": file_size,
            "alpha_min": minimum,
            "alpha_max": maximum,
            "fully_transparent_pixels": fully_transparent,
            "near_transparent_pixels": near_transparent,
            "transparent_pixels": transparent,
            "opaque_pixels": opaque,
            "corner_alpha": corner_alpha,
        }


def main() -> int:
    if len(sys.argv) < 2:
        print("用法：python scripts/validate_pet_asset.py <png> [<png> ...]", file=sys.stderr)
        return 2
    reports = []
    for raw_path in sys.argv[1:]:
        reports.append(validate(Path(raw_path)))
    print(json.dumps(reports, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
