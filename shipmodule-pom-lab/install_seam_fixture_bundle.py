from __future__ import annotations

import base64
import hashlib
import json
import shutil
import zipfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
TRANSFER = ROOT / "shipmodule-pom-lab" / "_seam-fixture-install"
EXPECTED_SHA256 = "577740b10e7b1acd80db1209719c2f68c7224af6300b2e13e803c419a590be4c"
EXPECTED_BYTES = 119_933
EXPECTED_MODULES = {
    "angled_hub_a.js", "corner_hub_a.js", "cross_hub_a.js",
    "straight_frame_a.js", "straight_offset_a.js", "straight_offset_b.js",
    "straight_reinforced_a.js", "t_hub_a.js", "y_hub_a.js",
}


def fail(message: str) -> None:
    raise SystemExit(f"Seam fixture installer: {message}")


def safe_members(archive: zipfile.ZipFile) -> list[zipfile.ZipInfo]:
    members = archive.infolist()
    for member in members:
        path = PurePosixPath(member.filename)
        if path.is_absolute() or ".." in path.parts:
            fail(f"unsafe ZIP member {member.filename!r}")
        if not member.filename.startswith("shipmodule-pom-lab/seam-fixtures/"):
            fail(f"unexpected ZIP member {member.filename!r}")
    return members


def main() -> None:
    parts = sorted(TRANSFER.glob("part-*.txt"))
    expected = [f"part-{index:02d}.txt" for index in range(8)]
    if [path.name for path in parts] != expected:
        fail(f"expected 8 transfer chunks, found {[path.name for path in parts]}")
    encoded = "".join("".join(path.read_text(encoding="ascii").split()) for path in parts)
    try:
        payload = base64.b64decode(encoded, validate=True)
    except Exception as error:
        fail(f"invalid base64: {error}")
    if len(payload) != EXPECTED_BYTES:
        fail(f"archive size {len(payload)}, expected {EXPECTED_BYTES}")
    digest = hashlib.sha256(payload).hexdigest()
    if digest != EXPECTED_SHA256:
        fail(f"archive SHA-256 {digest}, expected {EXPECTED_SHA256}")

    destination = ROOT / "shipmodule-pom-lab" / "seam-fixtures"
    if destination.exists():
        shutil.rmtree(destination)
    archive_path = TRANSFER / "seam-fixtures.zip"
    archive_path.write_bytes(payload)
    with zipfile.ZipFile(archive_path) as archive:
        archive.extractall(ROOT, members=safe_members(archive))

    found = {path.name for path in destination.glob("*.js")}
    if found != EXPECTED_MODULES:
        fail(f"module set mismatch: {sorted(found)}")
    for path in destination.glob("*.js"):
        text = path.read_text(encoding="utf-8")
        if not text.startswith("export default ") or "base64" not in text:
            fail(f"invalid fixture module {path.name}")

    manifest = {
        "schema": 1,
        "packId": "shipmodule-seam-pack-v1",
        "moduleCount": len(found),
        "socketStandard": "seam_rail_v1",
        "runtimeProfile": "compact-320-q64-h85-v1",
        "archiveSha256": digest,
        "modules": sorted(found),
    }
    (ROOT / "shipmodule-pom-lab" / "seam-pack-published.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    shutil.rmtree(TRANSFER)
    Path(__file__).unlink()
    workflow = ROOT / ".github" / "workflows" / "install-pom-seam-fixtures.yml"
    if workflow.exists():
        workflow.unlink()
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
