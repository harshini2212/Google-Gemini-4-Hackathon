"""Draw the paintable wall of each tour stop as a panorama-sized mask for paint.mjs.

Each wall is outlined by hand on a flat, straight-on picture of it (a "view": the camera at the stop, turned to
`yaw` degrees, looking level, `fov` degrees wide and tall, `size` pixels square), where the edges of a wall are
straight lines. The outline minus its holes (windows, trim, outlets, the fireplace) is blurred a little and then
wrapped into the panorama, the same way scripts/prepare_demo.py wraps the Matterport cube faces.

    python3 facetime/scripts/make_walls.py              # writes facetime/media/walls/<stop>.png and index.json
    python3 facetime/scripts/make_walls.py --preview DIR # also writes DIR/<stop>-<n>.jpg: each view with its outline
"""

import argparse
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
MODEL_ID = "9odpSsu2KYQ"
WIDTH, HEIGHT = 3840, 1920

# Forward, right and up axes of the six Matterport skybox faces (as in scripts/prepare_demo.py).
FACE_AXES = np.array([
    ((0, 1, 0), (1, 0, 0), (0, 0, -1)),
    ((0, 0, 1), (1, 0, 0), (0, 1, 0)),
    ((1, 0, 0), (0, 0, -1), (0, 1, 0)),
    ((0, 0, -1), (-1, 0, 0), (0, 1, 0)),
    ((-1, 0, 0), (0, 0, 1), (0, 1, 0)),
    ((0, -1, 0), (1, 0, 0), (0, 0, 1)),
], dtype=np.float32)

# A view with yaw -90, 0, 90 or 180 and fov 90 is exactly cube face 4, 1, 2 or 3.

# The outline scripts/prepare_demo.py paints sage and clay: cube face 4 of the living room at 900 px. It is
# written as living.png, pixel for pixel the wall of data/demo/living-sage.webp, but index.json lists the tighter
# trace below instead. To use this one, set "file" of WALLS["living"] to "living.png" and drop its "views".
SAGE_AND_CLAY = {
    "yaw": -90, "fov": 90, "size": 900, "blur": 0.8,
    "wall": [[(211, 341), (420, 281), (710, 298), (702, 323), (702, 343), (714, 328), (714, 643), (210, 584)]],
    "holes": [
        [(222, 379), (305, 374), (306, 547), (219, 539)],
        [(558, 359), (688, 353), (690, 553), (697, 569), (690, 580), (549, 567), (552, 550)],
        [(309, 445), (509, 445), (508, 619), (310, 607)],
    ],
}
UNLISTED = {"living.png": [SAGE_AND_CLAY]}

WALLS = {
    "living": {
        "label": "the fireplace wall",
        "file": "living-tight.png",
        "views": [{
            # The same wall as SAGE_AND_CLAY above, traced again at 2000 px so the paint meets the windows,
            # mantel, stone, baseboard and blinds without the grey gaps that outline leaves.
            "yaw": -90, "fov": 90, "size": 2000,
            "wall": [[(467.5, 758), (933.5, 624.5), (1579, 663.5), (1579.5, 709), (1557, 729.5), (1557, 762.5),
                      (1579.5, 742.5), (1579.5, 1421), (1430, 1405.5), (1270, 1388), (1130, 1372.5), (655, 1317),
                      (466.5, 1298)]],
            "holes": [
                [(499.5, 842.5), (675.5, 832), (673.5, 1194), (681.5, 1195.5), (681.5, 1201), (673, 1215),
                 (492, 1202.5), (482, 1189.5), (482, 1184), (498.5, 1184.5)],            # left window and sill
                [(1239.5, 797.5), (1529, 787), (1527.5, 1251), (1547, 1255), (1547, 1262.5), (1531.5, 1280.5),
                 (1236, 1256), (1226.5, 1239.5), (1226.5, 1229.5), (1238.5, 1230.5)],    # right window and sill
                [(665.5, 992), (1130, 992.5), (1130, 1006), (1129, 1006), (1127, 1380), (694, 1325),
                 (694, 1270), (696.5, 1005.5), (665.5, 1005)],                           # mantel and stone
            ],
        }],
    },
    "bedroom": {
        "label": "the wall with the window",
        "views": [{
            "yaw": 0, "fov": 90, "size": 2000,
            "wall": [[(573, 708), (980, 720), (1100, 723.5), (1400, 729), (1399, 1000), (1396, 1304), (573, 1312)]],
            "holes": [
                [(917, 811), (1218, 814), (1217, 1184), (1227, 1184), (1227, 1204), (905, 1206), (905, 1186),
                 (914, 1186)],                                             # window and sill
                [(717, 1218), (737, 1218), (737, 1250), (717, 1250)],      # cable outlet
                [(781, 1222), (804, 1222), (804, 1256), (781, 1256)],      # power outlet
            ],
        }],
    },
    "desk": {
        "label": "the wall with the window",
        "views": [{
            "yaw": 0, "fov": 90, "size": 2000,
            "wall": [[(280.5, 521), (850, 509.5), (1434.5, 493.5), (1434.5, 1620), (850, 1600), (280.5, 1580.5)]],
            "holes": [
                [(568, 682), (1118.5, 674), (1120.5, 1366), (1138, 1369), (1138, 1386), (1124, 1405),
                 (562, 1396.5), (545, 1378), (545, 1364), (571, 1361)],    # window and sill
                [(1307, 1444), (1349.5, 1444), (1349.5, 1508.5), (1307, 1508.5)],  # outlet
            ],
        }],
    },
    "kitchen": {
        "label": "the far wall with the window, past the counter",
        "views": [{
            "yaw": 270, "fov": 90, "size": 2000,
            # The lower left corner follows the end of the counter, which stands in front of the wall.
            "wall": [[(459, 708.5), (1130, 732.5), (1124, 1339), (695, 1346), (695, 1318), (710.5, 1316.5),
                      (723, 1272), (754, 1217.5), (452, 1221.5)]],
            "holes": [
                [(641, 812.5), (961.5, 821.5), (960, 1206.5), (968.5, 1208), (968.5, 1217), (959, 1230),
                 (622, 1229), (622, 1211), (636.5, 1211)],                  # window and sill
                [(1059.5, 1246), (1081.5, 1246), (1081.5, 1281), (1059.5, 1281)],  # outlet
            ],
        }],
    },
}


def panorama_rays(width=WIDTH, height=HEIGHT):
    yaw = (np.arange(width, dtype=np.float32) + 0.5) / width * 2 * np.pi - np.pi
    pitch = np.pi / 2 - (np.arange(height, dtype=np.float32) + 0.5) / height * np.pi
    yaw, pitch = np.meshgrid(yaw, pitch)
    return np.stack((np.sin(yaw) * np.cos(pitch), np.sin(pitch), np.cos(yaw) * np.cos(pitch)), axis=-1)


def view_axes(yaw):
    yaw = math.radians(yaw)
    return (np.array([math.sin(yaw), 0, math.cos(yaw)], dtype=np.float32),
            np.array([math.cos(yaw), 0, -math.sin(yaw)], dtype=np.float32),
            np.array([0, 1, 0], dtype=np.float32))


def draw_view(view):
    """The view's mask: its wall outlines filled, its holes cut, edges softened."""
    mask = Image.new("L", (view["size"], view["size"]), 0)
    draw = ImageDraw.Draw(mask)
    for outline in view["wall"]:
        draw.polygon(outline, fill=255)
    for hole in view.get("holes", []):
        draw.polygon(hole, fill=0)
    return mask.filter(ImageFilter.GaussianBlur(view.get("blur", 1.5)))


def wrap(view, rays):
    """The view's mask in panorama space (bilinear), zero where the view does not see."""
    mask = np.asarray(draw_view(view), dtype=np.float32)
    size = view["size"]
    forward, right, up = view_axes(view["yaw"])
    depth, across, above = (np.einsum("...i,i->...", rays, axis) for axis in (forward, right, up))
    depth = np.maximum(depth, 1e-6)          # rays behind the view land far outside it
    reach = math.tan(math.radians(view["fov"]) / 2)
    x = (across / depth / reach + 1) * size / 2 - 0.5
    y = (1 - above / depth / reach) * size / 2 - 0.5
    seen = (depth > 1e-3) & (x > -0.5) & (x < size - 0.5) & (y > -0.5) & (y < size - 0.5)
    x, y = x[seen].clip(0, size - 1), y[seen].clip(0, size - 1)
    x0, y0 = np.floor(x).astype(int).clip(0, size - 2), np.floor(y).astype(int).clip(0, size - 2)
    fx, fy = x - x0, y - y0
    out = np.zeros(rays.shape[:2], dtype=np.float32)
    out[seen] = ((mask[y0, x0] * (1 - fx) + mask[y0, x0 + 1] * fx) * (1 - fy)
                 + (mask[y0 + 1, x0] * (1 - fx) + mask[y0 + 1, x0 + 1] * fx) * fy)
    return out


def view_photo(faces, sweep, view):
    """The scan as this view sees it, for checking an outline by eye."""
    size = view["size"]
    reach = math.tan(math.radians(view["fov"]) / 2)
    x = (np.arange(size) + 0.5 - size / 2) / (size / 2) * reach
    x, y = np.meshgrid(x, -x)
    forward, right, up = view_axes(view["yaw"])
    rays = forward + x[..., None] * right + y[..., None] * up
    best_face = np.einsum("...i,ji->...j", rays, FACE_AXES[:, 0]).argmax(axis=-1)
    result = np.empty(rays.shape, dtype=np.uint8)
    for face, axes in enumerate(FACE_AXES):
        pixels = best_face == face
        if not pixels.any():
            continue
        cube = np.asarray(Image.open(faces / f"{sweep}_{face}.jpg").convert("RGB"))
        depth, horizontal, vertical = np.einsum("...i,ji->...j", rays[pixels], axes).T
        width = cube.shape[0]
        result[pixels] = cube[((1 - vertical / depth) * width / 2).astype(int).clip(0, width - 1),
                              ((horizontal / depth + 1) * width / 2).astype(int).clip(0, width - 1)]
    return Image.fromarray(result)


def make(cache, output, preview):
    output.mkdir(parents=True, exist_ok=True)
    rays = panorama_rays()
    tour = json.loads((ROOT / "data/demo/tour.json").read_text())

    def save(file, views):
        mask = np.zeros((HEIGHT, WIDTH), dtype=np.float32)
        for view in views:
            mask = np.maximum(mask, wrap(view, rays))
        Image.fromarray(mask.round().astype(np.uint8)).save(output / file, optimize=True)

    for file, views in UNLISTED.items():
        save(file, views)
    index = {}
    for stop, wall in WALLS.items():
        file = wall.get("file", f"{stop}.png")
        if "views" in wall:
            save(file, wall["views"])
        index[stop] = {"file": file, "label": wall["label"]}
        if preview:
            preview.mkdir(parents=True, exist_ok=True)
            faces = cache / "matterport" / MODEL_ID / "faces"
            for number, view in enumerate(wall.get("views", [])):
                photo = view_photo(faces, tour["stops"][stop]["sweep"], view)
                tint = Image.new("RGB", photo.size, (255, 0, 255))
                shade = draw_view(view).point(lambda value: value * 0.45)
                Image.composite(tint, photo, shade).save(preview / f"{stop}-{number}.jpg", quality=88)
    (output / "index.json").write_text(json.dumps(index, indent=2) + "\n")
    print(f"Wrote {len(index)} wall masks to {output}: {', '.join(index)}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--cache", type=Path, default=Path.home() / "brace/data/cache")
    parser.add_argument("--output", type=Path, default=ROOT / "facetime/media/walls")
    parser.add_argument("--preview", type=Path, help="folder for pictures of each view with its outline")
    args = parser.parse_args()
    make(args.cache, args.output, args.preview)
