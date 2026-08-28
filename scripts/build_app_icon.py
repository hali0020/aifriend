"""Build the Windows application icon from the tracked avatar asset."""

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public" / "christina-avatar.webp"
OUTPUT = ROOT / "assets" / "amadeus.ico"


def main() -> None:
    with Image.open(SOURCE) as source:
        rgba = source.convert("RGBA")
        side = max(rgba.size)
        square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        square.alpha_composite(rgba, ((side - rgba.width) // 2, (side - rgba.height) // 2))
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        square.save(OUTPUT, format="ICO", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print(OUTPUT)


if __name__ == "__main__":
    main()
