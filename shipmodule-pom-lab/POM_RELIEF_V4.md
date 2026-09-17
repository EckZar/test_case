# POM asymmetric relief v4

Scope: hosted P-07 512 lab and reusable projected PomDecalMaterial; no Hull topology, P02, canonical seam ownership or persistence changes.

The shader uses z=(h-neutralLevel)*(h>=neutralLevel?raiseScale:sinkScale). The polygon is the neutral plane. March starts at the positive envelope and ends at the negative envelope; it does NOT clamp signed height to [0,1]. Legacy defaults neutral=1 / raise=1 / sink=1 preserve the original depth convention. The P-07 preset is neutral=.60, raise=.35, sink=1.25, heightScale=.020.

Quality: original-UV tangent frame for lighting, explicit gradients for BaseColor/Normal/ORM/Emissive/Alpha, texel-travel-aware steps (actual static ceiling 128), binary refinement up to 8 plus final secant interpolation. Optional fixed screen-space jitter is off by default because this lab has no temporal AA. Extreme rays are bounded and faded once.

Wall softness is a CPU height-field preprocessing helper run on control changes, not a full-image blur or five extra samples per ray-march step. It preserves constant plateaus, ignores exterior-mask neighbors and updates the normal from the same processed/signed field. Half-float runtime height retains filtered values without rounding back to 8 bits; it does not create new source detail. BaseColor, ORM and original fixture bytes remain unchanged with five SHA-256 checks.

Limits: vertical walls, overhangs and independently textured sides are not represented by a single height field. Stretched side texels can remain even with more steps. Neutral/gain controls cannot repair semantically incorrect heights per object. A real geometric bevel or authored local height correction may still be needed.

Validation: node --test shipmodule-pom-lab/tests/relief-v4.test.mjs; browser test tests/relief-v4-browser.mjs. The latter records shader errors, frame variance, rendered-pixel changes for each relief control and a separate live-hosted URL result. Scoped PASS is not a full shipModule baseline gate or merge approval.
