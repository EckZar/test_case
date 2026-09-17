"""Build a registered 512 px P-07 test fixture from the verified color reference.

Height is an explicitly labelled semantic reconstruction, not an exact 3D bake
and not an enlargement of the old 32 px numeric fixture. Printed markings on
large armor plates are deliberately excluded from relief.
"""
from pathlib import Path
import base64
import hashlib
import io
import json
import os
import urllib.request
import cv2
import numpy as np
from PIL import Image

ROOT = Path('shipmodule-pom-lab')
OUT = ROOT / 'fixtures' / 'p07_512_verified'
OUT.mkdir(parents=True, exist_ok=True)
PARTS = [
 ('d53ec80286436b1986d9e0cead448f331baa071e', 9000),
 ('d96f7e1702361db711eade127cc47eb42ab7694b', 9000),
 ('6fa447bdc89fa516006d19f845219318931954ff', 9000),
 ('e8de0df62671166f6d33c5ae6700498ebaf95ee6', 9000),
 ('6675732c225cd4055e4e1374169682fc0841774f', 9000),
 ('bb1488f00bbfec7fd3f836035a8caaf3d043c689', 1418),
]
parts = []
for sha, expected_length in PARTS:
    headers = {'Accept': 'application/vnd.github+json', 'User-Agent': 'P07-fixture-builder'}
    if os.environ.get('GITHUB_TOKEN'):
        headers['Authorization'] = 'Bearer ' + os.environ['GITHUB_TOKEN']
    request = urllib.request.Request('https://api.github.com/repos/EckZar/test_case/git/blobs/' + sha, headers=headers)
    with urllib.request.urlopen(request, timeout=45) as response:
        blob = json.load(response)
    data = base64.b64decode(blob['content'])
    if len(data) != expected_length:
        raise ValueError('Source part has unexpected length: ' + sha)
    actual = hashlib.sha1(('blob %d\0' % len(data)).encode() + data).hexdigest()
    if actual != sha:
        raise ValueError('Source part failed Git checksum: ' + sha)
    parts.append(data)
source = b''.join(parts)
expected_source = '4e72321a24f8e05290ef48d31525723f7d2c766f4375a8699db936d939b6c7c6'
if hashlib.sha256(source).hexdigest() != expected_source:
    raise ValueError('Full color reference SHA-256 mismatch; do not publish')
image = Image.open(io.BytesIO(source)).convert('RGB')
if image.size != (512, 512):
    raise ValueError('This fixture requires a real 512 px source, not an upscaled thumbnail')
base = np.asarray(image).copy()
if base.std() < 15:
    raise ValueError('Empty or almost constant reference image')
(OUT / 'Reference_BaseColor.webp').write_bytes(source)

# The transported image has a known flat background. Only the largest filled
# external contour is used as opacity; dark text and recesses remain opaque.
bg = np.array([31, 36, 43], dtype=np.float32)
difference = np.linalg.norm(base.astype(np.float32) - bg, axis=2)
candidate = (difference > 18).astype(np.uint8) * 255
candidate = cv2.morphologyEx(candidate, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
contours, _ = cv2.findContours(candidate, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
if not contours:
    raise ValueError('No hatch silhouette found')
mask = np.zeros((512, 512), np.uint8)
cv2.drawContours(mask, [max(contours, key=cv2.contourArea)], -1, 255, cv2.FILLED)
inside = mask > 0
if not .25 < inside.mean() < .98:
    raise ValueError('Implausible hatch coverage')

# Explicit mechanical levels. Intensity is used only for material segmentation,
# never as a direct height conversion. Large flat panels have constant height.
gray = cv2.cvtColor(base, cv2.COLOR_RGB2GRAY)
hsv = cv2.cvtColor(base, cv2.COLOR_RGB2HSV)
light_paint = ((gray > 160) & (hsv[:, :, 1] < 60) & inside).astype(np.uint8) * 255
light_paint = cv2.morphologyEx(light_paint, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
light_paint = cv2.morphologyEx(light_paint, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
count, labels, stats, _ = cv2.connectedComponentsWithStats(light_paint)
armor = np.zeros_like(mask)
for index in range(1, count):
    if stats[index, cv2.CC_STAT_AREA] >= 1200:
        component = (labels == index).astype(np.uint8) * 255
        outlines, _ = cv2.findContours(component, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for contour in outlines:
            cv2.drawContours(armor, [contour], -1, 255, cv2.FILLED)
armor[~inside] = 0
if (armor > 0).sum() < 5000:
    raise ValueError('Could not identify the armor panels')

# Soft transitions are restricted to narrow chamfers, never global blur.
height = np.full((512, 512), .38, np.float32)
edge_distance = cv2.distanceTransform(mask, cv2.DIST_L2, 5)
rim = np.clip(edge_distance / 2.0, 0, 1) * np.clip((13 - edge_distance) / 3.0, 0, 1)
height = np.maximum(height, .38 + .25 * rim)
plate_distance = cv2.distanceTransform(armor, cv2.DIST_L2, 5)
height = np.maximum(height, .38 + .49 * np.clip(plate_distance / 2.5, 0, 1))

# Structural dark slots outside the protected armor face become recessed slots.
# This prevents painted letters and barcodes from turning into deep holes.
protected = cv2.dilate(armor, np.ones((5, 5), np.uint8)) > 0
slots = ((gray < 48) & inside & ~protected & (edge_distance > 12)).astype(np.uint8) * 255
slots = cv2.morphologyEx(slots, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
slot_distance = cv2.distanceTransform(slots, cv2.DIST_L2, 5)
height -= .22 * np.clip(slot_distance / 1.5, 0, 1)

# Central pressure-seal pocket. It is a deliberately authored shape, not a
# claimed recovery of hidden geometry from the image.
pocket = np.zeros_like(mask)
cv2.fillConvexPoly(pocket, np.array([[256, 203], [215, 273], [297, 273]], np.int32), 255)
pocket_distance = cv2.distanceTransform(pocket, cv2.DIST_L2, 5)
pocket_weight = np.clip(pocket_distance / 4.0, 0, 1)
height = height * (1 - pocket_weight) + .12 * pocket_weight
height = np.clip(height, 0, 1)
height[~inside] = 1.0
h8 = np.rint(height * 255).astype(np.uint8)
# The actual runtime field is R8; normal generation uses those same R8 values.
h = h8.astype(np.float32) / 255
samples = np.pad(h, 1, mode='edge')
dx = (samples[1:-1, 2:] - samples[1:-1, :-2]) * 512 * .02 * .5
dy = (samples[2:, 1:-1] - samples[:-2, 1:-1]) * 512 * .02 * .5
normal = np.stack([-dx, dy, np.ones_like(dx)], axis=2)
normal /= np.linalg.norm(normal, axis=2, keepdims=True)
normal[~inside] = [0, 0, 1]
normal8 = np.rint((normal * .5 + .5) * 255).astype(np.uint8)

# Utility maps are documented approximations, not independently generated AI
# images with mismatching mechanical details. ORM order is R=AO G=rough B=metal.
neighbor_height = cv2.boxFilter(h, -1, (9, 9), normalize=True)
ao = np.clip(1 - np.maximum(neighbor_height - h, 0) * 1.8, .45, 1)
roughness = np.where(armor > 0, .78, .69).astype(np.float32)
metallic = np.where((armor == 0) & (hsv[:, :, 1] < 22) & (gray > 85) & (gray < 145), .25, 0).astype(np.float32)
ao[~inside] = 1
roughness[~inside] = .9
metallic[~inside] = 0
orm = np.rint(np.stack([ao, roughness, metallic], axis=2) * 255).astype(np.uint8)
rgba = np.concatenate([base, mask[:, :, None]], axis=2)

maps = {'BaseColor.png': base, 'BaseColorAlpha.png': rgba,
        'Height.png': h8, 'Height_16.png': np.rint(height * 65535).astype(np.uint16),
        'Normal_OpenGL.png': normal8, 'ORM.png': orm, 'Alpha.png': mask,
        'AO.png': orm[:, :, 0], 'Roughness.png': orm[:, :, 1], 'Metallic.png': orm[:, :, 2]}
for name, pixels in maps.items():
    Image.fromarray(pixels).save(OUT / name)

# These strings are written by Python and verified before use. No manually
# transcribed image payloads and no image decoding/canvas access in the app.
payload = {'schema': 1, 'size': 512, 'heightConvention': 'WHITE_HIGH_BLACK_LOW',
           'normalHeightScale': .02, 'heightSource': 'semantic-reconstruction-v1',
           'sourceColorSha256': expected_source, 'maps': {}}
for name, pixels in [('base', rgba), ('height', h8), ('normal', normal8), ('orm', orm), ('alpha', mask)]:
    raw = np.flipud(pixels).copy().tobytes()
    payload['maps'][name] = {'length': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(),
                            'base64': base64.b64encode(raw).decode('ascii')}
(ROOT / 'fixture-512.js').write_text('export const fixture512 = ' + json.dumps(payload, separators=(',', ':')) + ';\n', encoding='utf-8')
metadata = {k: v for k, v in payload.items() if k != 'maps'}
metadata['maps'] = {k: {a: b for a, b in v.items() if a != 'base64'} for k, v in payload['maps'].items()}
metadata['limitations'] = ['Height is an authored semantic reconstruction, not an exact bake from a source mesh.',
                          'POM does not change mesh topology or cast geometric silhouette shadows.',
                          'The runtime height field is 8-bit; the 16-bit authoring file is also supplied.']
(OUT / 'manifest.json').write_text(json.dumps(metadata, indent=2) + '\n')
print(json.dumps(metadata, indent=2))
