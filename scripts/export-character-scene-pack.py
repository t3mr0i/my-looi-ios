"""Export exactly the 200 authored motifs in both full-picture formats."""
from pathlib import Path
import json
import shutil
import zipfile

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "assets/character-scenes"
OUTPUT = ROOT / "output/character-library-export"
manifest = json.loads((SOURCE / "SOURCE.json").read_text())
ids = [asset["id"] for asset in manifest["assets"]]
assert len(ids) == len(set(ids)) == 200
files = [Path(name) for name in ["index.html", "README.md", "catalog.txt", "SOURCE.json", "RENDERED.json", "LICENSE-LUCIDE", "LICENSE-TABLER"]]
for scene_id in ids:
    files.extend([Path("pictures") / f"{scene_id}.png", Path("pictures") / f"{scene_id}.svg", Path("props") / f"{scene_id}.svg"])
for relative in files:
    destination = OUTPUT / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(SOURCE / relative, destination)
archive = ROOT / "output/LOOI-200-Situationsbilder.zip"
with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as pack:
    for relative in files:
        pack.write(OUTPUT / relative, Path("LOOI-200-Situationsbilder") / relative)
with zipfile.ZipFile(archive) as pack:
    assert pack.testzip() is None
    assert len([name for name in pack.namelist() if "/pictures/" in name and name.endswith(".png")]) == 200
    assert len([name for name in pack.namelist() if "/pictures/" in name and name.endswith(".svg")]) == 200
print(f"Exported and verified 200 PNG + 200 SVG pictures, props, gallery and licenses: {archive}")
