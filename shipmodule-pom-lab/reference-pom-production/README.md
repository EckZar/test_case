# Reference POM Production HD

This directory is the production replacement for the obsolete `reference-pom-assets/*.webp` previews.

## Maps

Each `ref-01` … `ref-10` directory contains:

- `basecolor.png` — native-resolution BaseColor with alpha.
- `height.png` — grayscale POM height, **WHITE_HIGH / BLACK_LOW**.
- `normal.png` — OpenGL-style tangent-space normal derived from the authored height field.
- `alpha.png` — cutout mask.
- `orm.png` — packed AO / Roughness / Metalness.

The browser lab loads these maps directly; it does not downscale them to 512² and does not reconstruct them from the old tiny WebP previews.

## Native source dimensions

| Decal | Resolution |
|---|---:|
| ref-01 | 1024×1536 |
| ref-02 | 1024×1536 |
| ref-03 | 682×2048 |
| ref-04 | 1024×1536 |
| ref-05 | 682×2048 |
| ref-06 | 685×2048 |
| ref-07 | 1254×1254 |
| ref-08 | 1254×1254 |
| ref-09 | 1254×1254 |
| ref-10 | 1254×1254 |

## Runtime

Use `../reference-pom.html` (redirects to the HD lab). The left side is conventional PBR; the right side uses `PomDecalMaterial v4` with the corresponding height map.

POM changes texture-space depth/parallax only; it does not change the real polygon silhouette.
