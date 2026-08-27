"""Convert generated chroma-green character art into a clean transparent PNG."""

from pathlib import Path
import sys

import numpy as np
from PIL import Image


def convert(input_path: Path, output_path: Path) -> None:
    rgb = np.asarray(Image.open(input_path).convert("RGB"), dtype=np.float32)
    red, green, blue = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    dominance = green - np.maximum(red, blue)

    # The character palette contains no saturated green. Green dominance is
    # therefore a stable coverage estimate, including antialiased edge pixels.
    alpha = 1.0 - np.clip((dominance - 2.0) / 248.0, 0.0, 1.0)
    alpha[(green > 205.0) & (dominance > 175.0)] = 0.0
    alpha[dominance < 10.0] = 1.0

    safe_alpha = np.maximum(alpha, 1.0 / 255.0)
    chroma = np.array([0.0, 255.0, 0.0], dtype=np.float32)
    foreground = (rgb - (1.0 - alpha[..., None]) * chroma) / safe_alpha[..., None]
    foreground = np.clip(foreground, 0.0, 255.0)

    # Remove residual green spill without changing this character's red-brown,
    # violet, tan, white, black, or skin-tone palette.
    foreground[..., 1] = np.minimum(
        foreground[..., 1],
        np.maximum(foreground[..., 0], foreground[..., 2]) + 2.0,
    )
    foreground[alpha == 0.0] = 0.0

    rgba = np.dstack((foreground, alpha[..., None] * 255.0)).round().astype(np.uint8)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba, "RGBA").save(output_path)


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: chroma_green_to_alpha.py INPUT OUTPUT")
    convert(Path(sys.argv[1]), Path(sys.argv[2]))


if __name__ == "__main__":
    main()
