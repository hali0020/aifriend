"""Build a desktop-pet animation from three transparent PNG keyframes.

The default six-frame sequence is:

    idle -> idle/mid transition -> mid -> two mid/peak transitions -> peak

Colour interpolation happens in premultiplied-alpha space.  This matters for
antialiased hair and clothing edges: fully transparent RGB values cannot bleed
black (or any other matte colour) into the visible transition frames.

Example:

    python scripts/build_desktop_pet_animation.py `
      --idle idle.png --mid mid.png --peak peak.png `
      --state happy --output-root public/desktop-pet-assets/animations `
      --max-edge 768 `
      --durations 700 90 110 90 90 180
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path, PurePosixPath
import re
import sys
from typing import Sequence

import numpy as np
from PIL import Image


DEFAULT_FRAME_COUNT = 6
MIN_FRAME_COUNT = 4
MAX_FRAME_COUNT = 12
DEFAULT_MAX_EDGE = 768
DEFAULT_DURATIONS_MS = (700, 90, 110, 90, 90, 180)
STATE_NAME_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]*$")


def positive_duration(value: str) -> int:
    """Return a positive duration in milliseconds for argparse."""
    try:
        duration = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"not an integer: {value!r}") from exc
    if duration <= 0:
        raise argparse.ArgumentTypeError("durations must be positive integers")
    return duration


def output_edge(value: str) -> int:
    try:
        edge = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"not an integer: {value!r}") from exc
    if edge < 256 or edge > 4096:
        raise argparse.ArgumentTypeError("max edge must be between 256 and 4096 pixels")
    return edge


def parse_durations(tokens: Sequence[str], frame_count: int) -> tuple[int, ...]:
    """Accept whitespace-separated values, comma-separated values, or both."""
    values: list[int] = []
    for token in tokens:
        for part in token.split(","):
            stripped = part.strip()
            if stripped:
                values.append(positive_duration(stripped))
    if len(values) != frame_count:
        raise argparse.ArgumentTypeError(
            f"expected {frame_count} frame durations, received {len(values)}"
        )
    return tuple(values)


def default_durations(frame_count: int) -> tuple[int, ...]:
    """Return readable defaults while giving the idle and peak frames longer holds."""
    if frame_count == DEFAULT_FRAME_COUNT:
        return DEFAULT_DURATIONS_MS
    mid_index = (frame_count - 1) // 2
    durations = [90] * frame_count
    durations[0] = 700
    durations[mid_index] = 110
    durations[-1] = 180
    return tuple(durations)


def validate_state_name(value: str) -> str:
    """Keep state output inside OUTPUT_ROOT and paths portable across platforms."""
    if not STATE_NAME_PATTERN.fullmatch(value):
        raise argparse.ArgumentTypeError(
            "state must start with a letter or digit and contain only letters, "
            "digits, underscores, or hyphens"
        )
    return value


def load_transparent_png(path: Path) -> Image.Image:
    """Load an image and reject inputs that do not actually carry an alpha channel."""
    if not path.is_file():
        raise ValueError(f"input does not exist: {path}")
    try:
        with Image.open(path) as source:
            if source.format != "PNG":
                raise ValueError(f"input must be a PNG: {path}")
            has_alpha = "A" in source.getbands() or "transparency" in source.info
            if not has_alpha:
                raise ValueError(f"input PNG has no alpha channel: {path}")
            return source.convert("RGBA")
    except (OSError, Image.DecompressionBombError) as exc:
        raise ValueError(f"could not read PNG {path}: {exc}") from exc


def common_canvas(images: Sequence[Image.Image]) -> tuple[int, int]:
    if not images:
        raise ValueError("at least one image is required")
    return max(image.width for image in images), max(image.height for image in images)


def place_center(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    """Contain a keyframe on a shared canvas without resizing or stretching it."""
    canvas_width, canvas_height = size
    if image.width > canvas_width or image.height > canvas_height:
        raise ValueError("target canvas is smaller than an input image")
    canvas = Image.new("RGBA", size, (0, 0, 0, 0))
    x = (canvas_width - image.width) // 2
    y = (canvas_height - image.height) // 2
    canvas.alpha_composite(image, (x, y))
    return canvas


def smoothstep(value: float) -> float:
    """Ease a normalized interpolation value without overshoot."""
    value = min(1.0, max(0.0, value))
    return value * value * (3.0 - 2.0 * value)


def premultiplied_blend(first: Image.Image, second: Image.Image, amount: float) -> Image.Image:
    """Interpolate two same-sized RGBA images without transparent-edge halos."""
    if first.size != second.size:
        raise ValueError("images must share a canvas before blending")

    weight = np.float32(smoothstep(amount))
    first_rgba = np.asarray(first, dtype=np.float32) / np.float32(255.0)
    second_rgba = np.asarray(second, dtype=np.float32) / np.float32(255.0)

    first_alpha = first_rgba[..., 3:4]
    second_alpha = second_rgba[..., 3:4]
    alpha = first_alpha * (1.0 - weight) + second_alpha * weight
    premultiplied = (
        first_rgba[..., :3] * first_alpha * (1.0 - weight)
        + second_rgba[..., :3] * second_alpha * weight
    )

    rgb = np.zeros_like(premultiplied)
    np.divide(premultiplied, alpha, out=rgb, where=alpha > (0.5 / 255.0))
    rgba = np.concatenate(
        (np.clip(rgb, 0.0, 1.0), np.clip(alpha, 0.0, 1.0)), axis=2
    )
    pixels = np.rint(rgba * np.float32(255.0)).astype(np.uint8)
    pixels[pixels[..., 3] == 0, :3] = 0
    return Image.fromarray(pixels, "RGBA")


def build_frames(
    idle: Image.Image,
    mid: Image.Image,
    peak: Image.Image,
    frame_count: int = DEFAULT_FRAME_COUNT,
    max_edge: int = DEFAULT_MAX_EDGE,
) -> list[Image.Image]:
    """Return a key/transition sequence on one transparent canvas."""
    if not MIN_FRAME_COUNT <= frame_count <= MAX_FRAME_COUNT:
        raise ValueError(
            f"frame_count must be between {MIN_FRAME_COUNT} and {MAX_FRAME_COUNT}"
        )
    canvas_size = common_canvas((idle, mid, peak))
    canvases = [
        place_center(image, canvas_size) for image in (idle, mid, peak)
    ]
    longest_edge = max(canvas_size)
    if longest_edge > max_edge:
        scale = max_edge / longest_edge
        output_size = (
            max(1, round(canvas_size[0] * scale)),
            max(1, round(canvas_size[1] * scale)),
        )
        canvases = [
            image.resize(output_size, Image.Resampling.LANCZOS) for image in canvases
        ]
    idle_canvas, mid_canvas, peak_canvas = canvases
    mid_index = (frame_count - 1) // 2
    frames: list[Image.Image] = []
    for index in range(frame_count):
        if index == 0:
            frame = idle_canvas
        elif index < mid_index:
            frame = premultiplied_blend(idle_canvas, mid_canvas, index / mid_index)
        elif index == mid_index:
            frame = mid_canvas
        elif index < frame_count - 1:
            frame = premultiplied_blend(
                mid_canvas,
                peak_canvas,
                (index - mid_index) / (frame_count - 1 - mid_index),
            )
        else:
            frame = peak_canvas
        frames.append(frame)
    return frames


def save_png_atomic(image: Image.Image, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f".{destination.name}.tmp")
    try:
        image.save(temporary, format="PNG", optimize=True)
        os.replace(temporary, destination)
    finally:
        if temporary.exists():
            temporary.unlink()


def load_manifest(path: Path) -> dict:
    if not path.exists():
        return {"version": 1, "states": {}}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"could not read existing manifest {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError(f"manifest root must be an object: {path}")
    states = data.setdefault("states", {})
    if not isinstance(states, dict):
        raise ValueError(f"manifest 'states' must be an object: {path}")
    data.setdefault("version", 1)
    return data


def write_manifest_atomic(path: Path, manifest: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    try:
        temporary.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def build_animation(
    *,
    idle_path: Path,
    mid_path: Path,
    peak_path: Path,
    state: str,
    output_root: Path,
    durations_ms: Sequence[int],
    frame_count: int = DEFAULT_FRAME_COUNT,
    max_edge: int = DEFAULT_MAX_EDGE,
) -> tuple[Path, list[Path]]:
    """Build frame PNGs and add or replace one state in manifest.json."""
    if not MIN_FRAME_COUNT <= frame_count <= MAX_FRAME_COUNT:
        raise ValueError(
            f"frame_count must be between {MIN_FRAME_COUNT} and {MAX_FRAME_COUNT}"
        )
    if len(durations_ms) != frame_count or any(value <= 0 for value in durations_ms):
        raise ValueError(f"durations_ms must contain {frame_count} positive values")
    if not STATE_NAME_PATTERN.fullmatch(state):
        raise ValueError(f"unsafe state name: {state!r}")

    idle = load_transparent_png(idle_path)
    mid = load_transparent_png(mid_path)
    peak = load_transparent_png(peak_path)
    frames = build_frames(idle, mid, peak, frame_count, max_edge)

    manifest_path = output_root / "manifest.json"
    # Validate an existing manifest before touching any frame files.
    manifest = load_manifest(manifest_path)
    state_directory = output_root / state
    destinations = [
        state_directory / f"frame-{index:02d}.png" for index in range(frame_count)
    ]
    for frame, destination in zip(frames, destinations):
        save_png_atomic(frame, destination)

    width, height = frames[0].size
    manifest["states"][state] = {
        "loop": True,
        "pingPong": True,
        "canvas": {"width": width, "height": height},
        "frameCount": frame_count,
        "frames": [
            {
                "path": PurePosixPath(state, destination.name).as_posix(),
                "durationMs": int(duration),
            }
            for destination, duration in zip(destinations, durations_ms)
        ],
    }
    write_manifest_atomic(manifest_path, manifest)
    return manifest_path, destinations


def create_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Build transparent desktop-pet frames from idle, mid, and peak PNGs "
            "using premultiplied-alpha interpolation."
        )
    )
    parser.add_argument("--idle", required=True, type=Path, help="base/idle transparent PNG")
    parser.add_argument("--mid", required=True, type=Path, help="middle-pose transparent PNG")
    parser.add_argument("--peak", required=True, type=Path, help="peak-pose transparent PNG")
    parser.add_argument("--state", required=True, type=validate_state_name, help="state name")
    parser.add_argument(
        "--frame-count",
        type=int,
        choices=range(MIN_FRAME_COUNT, MAX_FRAME_COUNT + 1),
        default=DEFAULT_FRAME_COUNT,
        metavar=f"{{{MIN_FRAME_COUNT}..{MAX_FRAME_COUNT}}}",
        help=f"number of output frames (default: {DEFAULT_FRAME_COUNT})",
    )
    parser.add_argument(
        "--output-root",
        required=True,
        type=Path,
        help="animations directory that will contain STATE/ and manifest.json",
    )
    parser.add_argument(
        "--max-edge",
        type=output_edge,
        default=DEFAULT_MAX_EDGE,
        help=f"maximum output canvas edge in pixels (default: {DEFAULT_MAX_EDGE})",
    )
    parser.add_argument(
        "--durations",
        nargs="+",
        metavar="MS",
        default=None,
        help=(
            "one positive duration per frame in milliseconds; accepts either "
            "space-separated values or a comma-separated value (defaults use "
            "longer holds on idle, mid, and peak)"
        ),
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = create_parser()
    arguments = parser.parse_args(argv)
    try:
        durations = (
            parse_durations(arguments.durations, arguments.frame_count)
            if arguments.durations is not None
            else default_durations(arguments.frame_count)
        )
        manifest_path, frames = build_animation(
            idle_path=arguments.idle,
            mid_path=arguments.mid,
            peak_path=arguments.peak,
            state=arguments.state,
            output_root=arguments.output_root,
            durations_ms=durations,
            frame_count=arguments.frame_count,
            max_edge=arguments.max_edge,
        )
    except (argparse.ArgumentTypeError, ValueError, OSError) as exc:
        parser.error(str(exc))

    print(f"built {len(frames)} frames for state {arguments.state!r}")
    with Image.open(frames[0]) as first_frame:
        print(f"canvas: {first_frame.width}x{first_frame.height}")
    print(f"manifest: {manifest_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
