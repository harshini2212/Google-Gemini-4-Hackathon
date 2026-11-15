"""Build the picture bundle the FaceTime camera needs for one property.

    python3 facetime/scripts/prepare_property.py alex-springs

Reads facetime/properties/<slug>/property.json (the scan positions and rooms), places.mjs (where the guide stands
and which way she faces) and site.json (the aerial image under facetime/ and what to mark on it), and writes facetime/media/<slug>/:
a 360 photo per place, tour.json for the camera, and site.webp. The photos come from the Matterport cube faces in
the local cache, with the same projection as scripts/prepare_demo.py.
"""

import argparse
import json
import math
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE.parent / "scripts"))
from prepare_demo import FACE_AXES, panorama_rays  # noqa: E402  (the projection the web tour uses)


def read_cube(folder, sweep, side):
    return [np.asarray(Image.open(folder / f"{sweep}_{i}.jpg").convert("RGB").resize((side, side), Image.Resampling.LANCZOS))
            for i in range(6)]


def panorama(cube, rays):
    best_face = (rays @ FACE_AXES[:, 0].T).argmax(axis=-1)
    result = np.empty(rays.shape, dtype=np.uint8)
    for face, axes in enumerate(FACE_AXES):
        pixels = best_face == face
        depth, horizontal, vertical = (rays[pixels] @ axes.T).T
        size = cube[face].shape[0]
        x = ((horizontal / depth + 1) * size / 2).astype(int).clip(0, size - 1)
        y = ((1 - vertical / depth) * size / 2).astype(int).clip(0, size - 1)
        result[pixels] = cube[face][y, x]
    return Image.fromarray(result)


def prepare(slug, cache):
    source = HERE / "properties" / slug
    record = json.loads((source / "property.json").read_text())
    site = json.loads((source / "site.json").read_text())
    # places.mjs is JavaScript; ask node for it as JSON.
    places = json.loads(subprocess.run(
        ["node", "-e", "import(process.argv[1]).then(m => console.log(JSON.stringify(m)))", str(source / "places.mjs")],
        check=True, capture_output=True, text=True).stdout)["places"]
    model_folder = cache / "matterport" / record["modelId"]
    model = json.loads((model_folder / "model.json").read_text())
    turn = {s["id"]: math.degrees(2 * math.atan2(s["rotation"]["z"], s["rotation"]["w"])) for s in model["sweeps"]}

    target = HERE / "media" / slug
    target.mkdir(parents=True, exist_ok=True)
    large, small = panorama_rays(3840, 1920), panorama_rays(2880, 1440)
    stops = {}
    for key, place in places.items():
        sharp = key in site.get("fullSize", [])
        file = target / f"{key}.webp"
        if not file.exists():
            cube = read_cube(model_folder / "faces", place["sweep"], 2048 if sharp else 1536)
            panorama(cube, large if sharp else small).save(file, quality=86)
        stops[key] = {k: place[k] for k in ("label", "detail", "sweep", "yaw", "pitch")}
        print(f"  {key}: {'3840' if sharp else '2880'} px")

    with Image.open(HERE / site["aerial"]) as aerial:
        aerial.convert("RGB").save(target / "site.webp", quality=92)
        size = list(aerial.size)

    tour = {
        "property": {"name": record["name"], "address": record["address"], "caption": site["caption"]},
        "modelId": record["modelId"],
        "stops": stops,
        "rooms": record["rooms"],
        # yawOffset: the world bearing (degrees counter-clockwise from +x) that a panorama faces at yaw 0.
        "sweeps": [{**sweep, "yawOffset": round(turn[sweep["id"]], 2)} for sweep in record["sweeps"]],
        "site": {"image": "site.webp", "size": size, **{k: site[k] for k in
                 ("anchor", "anchorLabel", "parking", "parkingLabel", "title", "detail", "source") if k in site}},
        "plan": site["plan"],
    }
    (target / "tour.json").write_text(json.dumps(tour, separators=(",", ":")) + "\n")
    print(f"Prepared {len(stops)} places for {record['name']} in {target}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("slug")
    parser.add_argument("--cache", type=Path, default=Path.home() / "brace/data/cache")
    args = parser.parse_args()
    prepare(args.slug, args.cache)
