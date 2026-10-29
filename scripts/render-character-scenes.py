"""Render the 200 authored vector scenes for native thumbnails and image export.

Requires librsvg's rsvg-convert. This is an authoring command, never app code.
"""
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
from pathlib import Path
import json
import shutil
import subprocess
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets/character-scenes"
renderer = shutil.which("rsvg-convert")
if not renderer:
    raise SystemExit("Install librsvg (rsvg-convert) to regenerate the PNG pictures.")
catalog = []
for line in (ASSETS / "catalog.txt").read_text().splitlines():
    line = line.strip()
    if line and not line.startswith(("#", "@")):
        catalog.append(line.split("|")[0])
assert len(catalog) == len(set(catalog)) == 200
manifest_path = ASSETS / "RENDERED.json"
previous = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}


def render(scene_id):
    # One reference renderer for native props and exports. Never let a platform
    # SVG decoder reinterpret compact arc flags or rasterize a 24px icon early.
    prop = ASSETS / "props" / f"{scene_id}.svg"
    native = ASSETS / "native-props" / f"{scene_id}.png"
    native.parent.mkdir(parents=True, exist_ok=True)
    # Retire the generated SVG intermediates from the previous native path.
    native.with_suffix(".svg").unlink(missing_ok=True)
    prop_hash = sha256(prop.read_bytes()).hexdigest()
    old = previous.get(scene_id, {})
    if not (native.exists() and old.get("propSvgSha256") == prop_hash
            and old.get("propPngSha256") == sha256(native.read_bytes()).hexdigest()):
        subprocess.run([renderer, "--width", "384", "--height", "384", "--output", str(native), str(prop)], check=True)
    with Image.open(native) as image:
        assert image.size == (384, 384) and image.mode == "RGBA", scene_id
        alpha = image.getchannel("A")
        assert alpha.getextrema() == (0, 255) and alpha.getbbox(), scene_id
        prop_pixels = sha256(image.tobytes()).hexdigest()
    source = ASSETS / "pictures" / f"{scene_id}.svg"
    target = source.with_suffix(".png")
    source_hash = sha256(source.read_bytes()).hexdigest()
    old = previous.get(scene_id)
    if not (target.exists() and old and old["svgSha256"] == source_hash
            and old["pngSha256"] == sha256(target.read_bytes()).hexdigest()):
        subprocess.run([renderer, "--width", "720", "--height", "640", "--output", str(target), str(source)], check=True)
    with Image.open(target) as image:
        pixel_hash = sha256(image.convert("RGBA").tobytes()).hexdigest()
    return scene_id, {"width": 720, "height": 640, "propSvgSha256": prop_hash,
                      "propPngSha256": sha256(native.read_bytes()).hexdigest(), "propPixelSha256": prop_pixels,
                      "propAlphaBounds": alpha.getbbox(), "svgSha256": source_hash,
                      "pngSha256": sha256(target.read_bytes()).hexdigest(), "pixelSha256": pixel_hash}


with ThreadPoolExecutor(max_workers=6) as pool:
    rendered = dict(pool.map(render, catalog))
assert len({entry["pixelSha256"] for entry in rendered.values()}) == 200, "Duplicate rendered pictures"
manifest_path.write_text(json.dumps(rendered, indent=2) + "\n")
print("Rendered and verified 200 visually distinct PNG pictures (720 x 640)")
