#!/usr/bin/env python3
"""Build smoothed macro-relief POM maps from full-resolution base colors.

Supports both staging manifests (assets[].file) and an already published production
pack (assets[].files.baseColor). Thin scratches, rust, labels and cosmetic albedo
marks are flattened; only broad structural regions affect height. Pixels outside
alpha store the neutral height instead of black to prevent silhouette cliffs.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

try:
    import pillow_avif  # noqa: F401 - registers AVIF support for Pillow
except ImportError:
    pillow_avif = None

from scipy.ndimage import (
    binary_closing,
    binary_fill_holes,
    binary_opening,
    distance_transform_edt,
    gaussian_filter,
    label,
    sobel,
)

NEUTRAL = 0.56
PROFILE = "macro-relief-v2"


def disk(radius: int) -> np.ndarray:
    radius = max(1, int(radius))
    yy, xx = np.ogrid[-radius : radius + 1, -radius : radius + 1]
    return (xx * xx + yy * yy) <= radius * radius


def alpha_from_rgba(a: np.ndarray) -> np.ndarray:
    alpha = a[..., 3].astype(np.float32) / 255.0
    if float(np.ptp(alpha)) > 0.01 or float(alpha.mean()) < 0.99:
        return np.clip(alpha, 0.0, 1.0)

    rgb = a[..., :3].astype(np.float32) / 255.0
    vmax = rgb.max(axis=2)
    vmean = rgb.mean(axis=2)
    candidate = (vmax < 0.045) & (vmean < 0.028)
    h, w = candidate.shape
    seen = np.zeros((h, w), dtype=bool)
    stack: list[tuple[int, int]] = []
    for x in range(w):
        if candidate[0, x]: stack.append((0, x))
        if candidate[h - 1, x]: stack.append((h - 1, x))
    for y in range(h):
        if candidate[y, 0]: stack.append((y, 0))
        if candidate[y, w - 1]: stack.append((y, w - 1))
    while stack:
        y, x = stack.pop()
        if y < 0 or y >= h or x < 0 or x >= w or seen[y, x] or not candidate[y, x]:
            continue
        seen[y, x] = True
        stack.extend(((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)))
    foreground = binary_fill_holes(~seen)
    return np.clip(gaussian_filter(foreground.astype(np.float32), 0.8) * 1.25, 0.0, 1.0)


def saturation(rgb: np.ndarray) -> np.ndarray:
    vmax = rgb.max(axis=2)
    vmin = rgb.min(axis=2)
    result = np.zeros_like(vmax)
    np.divide(vmax - vmin, vmax, out=result, where=vmax > 1e-6)
    return result


def retain_structural_components(mask: np.ndarray, *, min_radius: float, min_area: int) -> np.ndarray:
    """Reject thin scratches/text while preserving broad grooves, slots and holes."""
    if not np.any(mask):
        return mask
    labels, count = label(mask)
    if count == 0:
        return np.zeros_like(mask)
    areas = np.bincount(labels.ravel())
    core = distance_transform_edt(mask) >= float(min_radius)
    core_ids = np.unique(labels[core])
    keep = np.zeros(count + 1, dtype=bool)
    for component_id in core_ids:
        if component_id and areas[component_id] >= min_area:
            keep[component_id] = True
    return keep[labels]


def normalized_blur(values: np.ndarray, mask: np.ndarray, sigma: float) -> np.ndarray:
    weight = gaussian_filter(mask.astype(np.float32), sigma)
    weighted = gaussian_filter(values * mask, sigma)
    return np.divide(weighted, np.maximum(weight, 1e-5))


def make_height(rgb: np.ndarray, alpha: np.ndarray) -> tuple[np.ndarray, dict[str, np.ndarray]]:
    r, g, b = (rgb[..., i] for i in range(3))
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    sat = saturation(rgb)
    value = rgb.max(axis=2)
    fg = alpha > 0.035
    min_dim = min(fg.shape)
    area = fg.size

    # Orange paint and brown rust remain cosmetic, at the surrounding plane level.
    orange = fg & (r > g * 1.22) & (r > b * 1.38) & (r > 0.42) & (sat > 0.28)

    # Close white structural regions over scratches and dirt so they stay planar.
    radius_close = max(2, round(min_dim / 360))
    white = fg & (value > 0.69) & (sat < 0.24) & ~orange
    white = binary_closing(white, structure=disk(radius_close))
    white = binary_opening(white, structure=disk(max(1, radius_close // 2)))

    # Keep only dark connected regions with a thick core. Thin printed labels,
    # scratches, grime and rust marks are discarded from macro relief.
    raw_deep = fg & (lum < 0.17) & (sat < 0.42) & ~orange
    raw_recess = fg & (lum < 0.38) & (sat < 0.36) & ~orange
    deep = retain_structural_components(
        raw_deep,
        min_radius=max(2.2, min_dim / 280.0),
        min_area=max(40, round(area * 0.000025)),
    )
    recess = retain_structural_components(
        raw_recess,
        min_radius=max(3.0, min_dim / 230.0),
        min_area=max(80, round(area * 0.000050)),
    )
    recess &= ~deep

    radius_region = max(1, round(min_dim / 520))
    deep = binary_closing(deep, structure=disk(radius_region))
    recess = binary_closing(recess, structure=disk(radius_region))

    base = fg & ~white & ~orange & ~deep & ~recess
    raised_mid = base & (lum > 0.49)
    base_mid = base & ~raised_mid

    # Signed macro levels around the shader neutral value.
    height = np.full(fg.shape, NEUTRAL, dtype=np.float32)
    height[base_mid] = 0.55
    height[raised_mid] = 0.60
    height[white] = 0.70
    height[orange] = NEUTRAL
    height[recess] = 0.39
    height[deep] = 0.25

    # Bevel the boundaries using a masked blur, without bleeding black background
    # into the geometry.
    wall_sigma = max(2.0, min_dim / 330.0)
    smooth = normalized_blur(height, fg.astype(np.float32), wall_sigma)
    height = np.where(fg, 0.18 * height + 0.82 * smooth, NEUTRAL)

    # Fade the outer contour back to neutral before alpha cutout. This removes the
    # vertical wall at texture borders, including decals touching the top/bottom edge.
    edge_width = max(4.0, min_dim / 210.0)
    edge_ramp = np.clip(distance_transform_edt(fg) / edge_width, 0.0, 1.0)
    height = NEUTRAL + (height - NEUTRAL) * edge_ramp

    height = np.where(np.abs(height - NEUTRAL) < 0.012, NEUTRAL, height)
    height = np.clip(height, 0.18, 0.76)
    height[~fg] = NEUTRAL

    return height, {
        "foreground": fg,
        "white": white,
        "orange": orange,
        "recess": recess,
        "deep": deep,
        "base": base,
    }


def make_normal(height: np.ndarray, alpha: np.ndarray, strength: float = 4.5) -> np.ndarray:
    q = gaussian_filter(height, 1.0)
    gx = sobel(q, axis=1) / 8.0
    gy = sobel(q, axis=0) / 8.0
    nx = -gx * strength
    ny = -gy * strength
    nz = np.ones_like(q)
    length = np.sqrt(nx * nx + ny * ny + nz * nz) + 1e-8
    return np.clip(
        np.dstack((nx / length * 0.5 + 0.5, ny / length * 0.5 + 0.5, nz / length * 0.5 + 0.5, alpha)),
        0.0,
        1.0,
    )


def make_orm(height: np.ndarray, alpha: np.ndarray, masks: dict[str, np.ndarray]) -> np.ndarray:
    ao = np.ones_like(height)
    ao -= np.clip((NEUTRAL - height) * 0.55, 0.0, 0.18)
    rough = np.full_like(height, 0.63)
    rough[masks["white"]] = 0.78
    rough[masks["orange"]] = 0.46
    rough[masks["recess"] | masks["deep"]] = 0.70
    metal = np.full_like(height, 0.08)
    metal[masks["orange"]] = 0.02
    ao[alpha < 0.02] = 1.0
    rough[alpha < 0.02] = 0.63
    metal[alpha < 0.02] = 0.0
    return np.dstack((ao, rough, metal, alpha))


def save_rgba(x: np.ndarray, path: Path) -> None:
    Image.fromarray(np.uint8(np.clip(x, 0.0, 1.0) * 255.0), "RGBA").save(path, compress_level=2)


def load_manifest_source(src: Path, item: dict) -> Image.Image:
    if "file" in item:
        return Image.open(src / item["file"]).convert("RGBA")
    files = item.get("files") or {}
    base_rel = files.get("baseColor") or files.get("basecolor")
    if not base_rel:
        raise ValueError(f"{item.get('id')}: missing source file/baseColor")
    return Image.open(src / base_rel).convert("RGBA")


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: build_reference_pom_hd.py SOURCE_DIR OUTPUT_DIR")
    src = Path(sys.argv[1])
    out = Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    stage = json.load(open(src / "manifest.json", encoding="utf-8"))
    manifest = {
        "schema": 3,
        "set": "reference-pom-production-hd",
        "profile": PROFILE,
        "heightConvention": "WHITE_HIGH_BLACK_LOW_SIGNED_AROUND_NEUTRAL",
        "neutralLevel": NEUTRAL,
        "cosmeticDetailPolicy": "scratches-rust-labels-flattened",
        "assets": [],
    }

    for item in stage["assets"]:
        rid = item["id"]
        image = load_manifest_source(src, item)
        rgba_u8 = np.asarray(image)
        alpha = alpha_from_rgba(rgba_u8)
        base = rgba_u8.astype(np.float32) / 255.0
        base[..., 3] = alpha
        height, masks = make_height(base[..., :3], alpha)
        normal = make_normal(height, alpha)
        orm = make_orm(height, alpha, masks)

        dst = out / rid
        dst.mkdir(parents=True, exist_ok=True)
        save_rgba(base, dst / "basecolor.png")
        save_rgba(np.dstack((height, height, height, alpha)), dst / "height.png")
        save_rgba(normal, dst / "normal.png")
        save_rgba(np.dstack((alpha, alpha, alpha, alpha)), dst / "alpha.png")
        save_rgba(orm, dst / "orm.png")
        manifest["assets"].append({
            "id": rid,
            "width": image.width,
            "height": image.height,
            "profile": PROFILE,
            "files": {
                "baseColor": f"{rid}/basecolor.png",
                "height": f"{rid}/height.png",
                "normal": f"{rid}/normal.png",
                "alpha": f"{rid}/alpha.png",
                "orm": f"{rid}/orm.png",
            },
        })

    with open(out / "manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    print("generated", len(manifest["assets"]), PROFILE, "POM decal sets")


if __name__ == "__main__":
    main()
