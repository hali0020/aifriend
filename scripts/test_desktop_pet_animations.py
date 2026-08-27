#!/usr/bin/env python3
"""Validate the generated desktop-pet animation pack."""

from __future__ import annotations

import json
from pathlib import Path, PurePosixPath
import re

from PIL import Image
from validate_pet_asset import validate as validate_static_asset


ROOT = Path(__file__).resolve().parents[1]
ANIMATION_ROOT = ROOT / "public" / "desktop-pet-assets" / "animations"
MANIFEST_PATH = ANIMATION_ROOT / "manifest.json"
CATALOG_PATH = ANIMATION_ROOT.parent / "catalog.json"
EXPECTED_STATES = {
    "idle",
    "happy",
    "angry",
    "shy",
    "surprised",
    "sad",
    "smug",
    "thinking",
    "deadpan",
    "sleepy",
    "excited",
    "confused",
    "panicked",
}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> None:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    require(manifest.get("version") == 1, "manifest version must be 1")

    states = manifest.get("states")
    require(isinstance(states, dict), "manifest.states must be an object")
    require(set(states) == EXPECTED_STATES, "manifest state set is incomplete")

    total_frames = 0
    summary: list[str] = []
    for name, state in states.items():
        frames = state.get("frames")
        frame_count = state.get("frameCount")
        canvas = state.get("canvas", {})

        require(state.get("loop") is True, f"{name}: loop must be true")
        require(state.get("pingPong") is True, f"{name}: pingPong must be true")
        require(isinstance(frames, list), f"{name}: frames must be a list")
        require(isinstance(frame_count, int), f"{name}: frameCount must be an integer")
        require(4 <= frame_count <= 12, f"{name}: expected 4-12 total frames")
        require(len(frames) == frame_count, f"{name}: frameCount mismatch")

        width = canvas.get("width")
        height = canvas.get("height")
        require(isinstance(width, int) and isinstance(height, int), f"{name}: invalid canvas")
        require(max(width, height) <= 768, f"{name}: canvas exceeds runtime size limit")

        for index, frame in enumerate(frames):
            relative = frame.get("path")
            duration_ms = frame.get("durationMs")
            require(isinstance(relative, str) and relative, f"{name}[{index}]: missing path")
            pure_path = PurePosixPath(relative)
            require(not pure_path.is_absolute(), f"{name}[{index}]: path must be relative")
            require(".." not in pure_path.parts, f"{name}[{index}]: unsafe path")
            require(pure_path.parts[0] == name, f"{name}[{index}]: state/path mismatch")
            require(isinstance(duration_ms, int) and duration_ms > 0, f"{name}[{index}]: bad duration")

            image_path = ANIMATION_ROOT.joinpath(*pure_path.parts)
            require(image_path.is_file(), f"{name}[{index}]: missing {relative}")
            with Image.open(image_path) as image:
                require(image.format == "PNG", f"{name}[{index}]: frame is not PNG")
                require(image.mode == "RGBA", f"{name}[{index}]: frame must be RGBA")
                require(image.size == (width, height), f"{name}[{index}]: canvas mismatch")
                alpha_min, alpha_max = image.getchannel("A").getextrema()
                require(alpha_min == 0, f"{name}[{index}]: no transparent background")
                require(alpha_max == 255, f"{name}[{index}]: no fully opaque pixels")

        total_frames += frame_count
        summary.append(f"{name}={frame_count}")

    require(total_frames == 84, f"expected 84 frames, found {total_frames}")
    static_assets = sorted((ANIMATION_ROOT.parent).glob("makise-kurisu-chibi-*.png"))
    require(len(static_assets) >= 12, "expected at least the 12 core transparent character poses")
    pose_numbers: list[int] = []
    for asset in static_assets:
        match = re.match(r"makise-kurisu-chibi-(\d{2})-", asset.name)
        require(match is not None, f"unexpected static asset name: {asset.name}")
        pose_numbers.append(int(match.group(1)))
        validate_static_asset(asset)
    require(pose_numbers == list(range(1, max(pose_numbers) + 1)), "static pose numbering must stay contiguous")
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    require(catalog.get("version") == 1, "static asset catalog version must be 1")
    catalog_assets = catalog.get("assets")
    require(isinstance(catalog_assets, list), "static asset catalog must contain an assets list")
    require([item.get("id") for item in catalog_assets] == pose_numbers, "catalog ids must match pose numbering")
    require([item.get("file") for item in catalog_assets] == [asset.name for asset in static_assets], "catalog files must match validated static poses")
    print("animation validation passed")
    print(f"states={len(states)} frames={total_frames}")
    print(f"transparent_static_poses={len(static_assets)}")
    print(" ".join(summary))


if __name__ == "__main__":
    main()
