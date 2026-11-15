"""Draw the paintable wall of each tour stop as a panorama-sized mask for paint.mjs.

Each wall is outlined by hand on a flat, straight-on picture of it (a "view": the camera at the stop, turned to
`yaw` degrees, looking level, `fov` degrees wide and tall, `size` pixels square), where the edges of a wall are
straight lines. The outline minus its holes (windows, trim, outlets, the fireplace) is blurred a little and then
wrapped into the panorama, the same way scripts/prepare_demo.py wraps the Matterport cube faces.

    python3 facetime/scripts/make_walls.py               # the A5: facetime/media/walls/<stop>.png and index.json
    python3 facetime/scripts/make_walls.py alex-springs  # the house: facetime/media/alex-springs/walls/
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


# 9530 Alex Springs Lane. Its walls and trim are both white, so every edge here is traced, none found by colour.
# "aim" is where the camera turns to show the wall: yaw in degrees from the stop's own yaw, then pitch.
ALEX_SPRINGS = {
    "living_room": {
        "label": "the long wall on the right",
        "aim": (84, -2),
        "views": [{
            # The whole wall plane, corner to corner: around the hallway arch (its rounded inner faces stay white)
            # and down the narrow strip between the arch and the corner.
            "yaw": 2, "fov": 96, "size": 3000,
            "wall": [[(171.5, 917.5), (250, 899.5), (500, 840.5), (700, 791), (740, 781.5), (770, 776), (800, 771),
                      (820, 769), (845, 768), (1000, 769), (1500, 770), (2000, 771), (2500, 773), (2750, 775.5),
                      (2794.5, 776),                                                    # ceiling, left to right
                      (2793.5, 1100), (2787.5, 1500), (2783.5, 2000), (2781, 2150), (2780.5, 2193.5),  # right corner
                      (2727, 2193.5), (2727, 2100), (2730, 1900), (2731, 1600), (2736, 1300), (2734, 1211),
                      (2728, 1205), (2710, 1196.5), (2680, 1180.5), (2640, 1162), (2600, 1149), (2560, 1138),
                      (2520, 1136), (2480, 1137), (2430, 1143.5), (2380, 1162.5), (2340, 1177.5), (2310, 1191.5),
                      (2290, 1201.5), (2278, 1207), (2272, 1215),                       # over the arch, right to left
                      (2271, 1300), (2270, 1600), (2264, 1900), (2261.5, 2150), (2261, 2195.5),
                      (2150, 2194.5), (1850, 2194.5), (1700, 2193.5), (1550, 2192.5), (1400, 2192.5),
                      (1250, 2191.5), (1100, 2190.5), (200, 2190.5), (171.5, 2191)]],   # baseboard, right to left
            "holes": [
                [(1447.5, 1990), (1488.5, 1990), (1488.5, 2052), (1447.5, 2052)],       # open cable box
                [(1556.5, 1991.5), (1602, 1991.5), (1602, 2063), (1556.5, 2063)],       # outlet
                [(2188, 1473), (2235, 1473), (2235, 1542), (2188, 1542)],               # light switch
            ],
        }],
    },
    "primary_bedroom": {
        "label": "the far wall",
        "aim": (2, -3),
        "views": [{
            "yaw": 177, "fov": 60, "size": 2600,
            "wall": [[(308, 743.5), (400, 743), (800, 740), (1300, 740.5), (1800, 738), (2250, 738.5), (2311, 738),
                      (2319, 900), (2323, 1400), (2338, 1950), (2339, 1979.5),
                      (1900, 1990.5), (1400, 2003), (900, 2017), (400, 2033), (321, 2036.5),
                      (320, 1950), (315.5, 1400), (309, 900)]],
            "holes": [
                [(824.5, 1828.5), (865.5, 1828.5), (865.5, 1892), (824.5, 1892)],       # outlet
                [(1904.5, 1800), (1949, 1800), (1949, 1863.5), (1904.5, 1863.5)],       # cable plate
                [(2115.5, 1798), (2156.5, 1798), (2156.5, 1863.5), (2115.5, 1863.5)],   # outlet
            ],
        }],
    },
    "dining_area": {
        "label": "the wall with the white door",
        "aim": (-6, -3),
        "views": [{
            # Corner to corner: the wall carries on above the door and down the sliver to its right.
            "yaw": 18, "fov": 84, "size": 3000,
            "wall": [[(320, 787), (1000, 796), (2200, 812.5), (2648, 819.5), (2649.5, 1300), (2651, 2000),
                      (2651, 2401), (2007, 2400), (1500, 2401), (900, 2399.5), (318, 2402), (319.5, 1600),
                      (320, 1000)]],
            "holes": [
                [(2006.5, 1015.5), (2636, 1018.5), (2634, 2000), (2632, 2440), (2004.5, 2440)],   # door and casing
                [(1417, 2142), (1475, 2142), (1475, 2231), (1417, 2231)],                         # outlet
                # the two chandelier shades that hang in front of the top of the wall
                [(1185, 760), (1195, 787), (1215, 811), (1245, 825), (1287, 834), (1327, 837), (1367, 832),
                 (1401, 821), (1425, 805), (1437, 788), (1440, 760)],
                [(1497, 790), (1484, 808), (1480, 823), (1481, 838), (1495, 857), (1519, 871), (1550, 880),
                 (1583, 884), (1617, 883), (1651, 877), (1681, 865), (1704, 852), (1714, 838), (1712, 820),
                 (1702, 802), (1686, 790)],
            ],
        }],
    },
    "bedroom_2": {
        "label": "the wall with the window",
        "aim": (0, -3),
        "views": [{
            "yaw": 43, "fov": 66, "size": 2600,
            "wall": [[(178.5, 548.5), (300, 549.5), (700, 548), (1150, 552.5), (1700, 546.5), (2300, 543),
                      (2399, 541.5), (2394, 1400), (2388.5, 2325.5),
                      (2300, 2324), (1800, 2318), (1300, 2308.5), (800, 2301.5), (300, 2290.5), (165, 2288),
                      (172, 1400)]],
            "holes": [
                [(393.5, 821.5), (1038, 823.5), (1032.5, 1894), (1063, 1911.5), (1063, 1934.5), (1039.5, 1936),
                 (1039.5, 1961), (362.5, 1949), (362.5, 1927), (328.5, 1926.5), (328.5, 1914.5), (384, 1893)],  # window, sill, apron
                [(1264.5, 2036), (1326, 2026), (1343.5, 2118.5), (1281, 2130)],          # outlet (it hangs crooked)
            ],
        }],
    },
    "living_room_front": {
        "label": "the long wall at the far end",
        "aim": (2, -4),
        "views": [{
            # The living_room wall again, seen from the entry end of the room: the same outline from further off.
            "yaw": -88, "fov": 54, "size": 2600,
            "wall": [[(162, 746), (200, 736), (400, 694.5), (600, 651), (690, 632), (720, 629.5), (760, 627.5),
                      (800, 627.5), (1100, 635.5), (1700, 650.5), (2000, 658.5), (2300, 667), (2381, 669.5),
                      (2378, 800), (2368.5, 1150), (2363, 1500), (2359, 1800), (2358.5, 1837),      # right corner
                      (2314, 1837), (2315, 1800), (2321, 1500), (2331, 1150), (2333, 1027),
                      (2325, 1022), (2310, 1015), (2285, 1000), (2250, 982), (2210, 967.5), (2170, 959.5),
                      (2130, 959.5), (2090, 964.5), (2050, 974.5), (2010, 991.5), (1980, 1003.5), (1962, 1013.5),
                      (1954, 1022),                                                     # over the arch, right to left
                      (1952, 1150), (1946.5, 1500), (1937, 1800), (1936.5, 1837),
                      (1500, 1840), (900, 1844), (300, 1848), (150.5, 1849),            # baseboard
                      (151, 1800), (156.5, 1400), (160.5, 900)]],
            "holes": [
                [(1264, 1677), (1299, 1677), (1299, 1727.5), (1264, 1727.5)],           # open cable box
                [(1355.5, 1674.5), (1391.5, 1674.5), (1391.5, 1734), (1355.5, 1734)],   # outlet
                [(1876.5, 1241), (1916.5, 1241), (1916.5, 1299), (1876.5, 1299)],       # light switch
            ],
        }],
    },
}

# tintPano's `level` for a white wall: how bright a white wall in full light is in the scan (white paint reflects
# about 85% of the light, which is 237 of 255). A colour painted over white then comes out as dark against the
# white as real paint would, in the wall's own light and shade, and warm white leaves the wall as bright as it was.
WHITE_WALL = 237

PROPERTIES = {
    "a5": {"model": MODEL_ID, "tour": "data/demo/tour.json", "output": "facetime/media/walls",
           "walls": WALLS, "unlisted": UNLISTED},
    "alex-springs": {"model": "ft9fdh4k36m", "tour": "facetime/media/alex-springs/tour.json",
                     "panoramas": "facetime/media/alex-springs", "output": "facetime/media/alex-springs/walls",
                     "walls": ALEX_SPRINGS, "level": WHITE_WALL},
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


def make(name, cache, output, preview):
    place = PROPERTIES[name]
    output = output or ROOT / place["output"]
    output.mkdir(parents=True, exist_ok=True)
    tour = json.loads((ROOT / place["tour"]).read_text())
    rays = {}

    def save(file, views, size=(WIDTH, HEIGHT)):
        if size not in rays:
            rays[size] = panorama_rays(*size)
        mask = np.zeros(size[::-1], dtype=np.float32)
        for view in views:
            mask = np.maximum(mask, wrap(view, rays[size]))
        Image.fromarray(mask.round().astype(np.uint8)).save(output / file, optimize=True)

    for file, views in place.get("unlisted", {}).items():
        save(file, views)
    index = {}
    for stop, wall in place["walls"].items():
        file = wall.get("file", f"{stop}.png")
        if "views" in wall:
            if "panoramas" in place:         # a mask is the size of its own panorama
                with Image.open(ROOT / place["panoramas"] / f"{stop}.webp") as panorama:
                    save(file, wall["views"], panorama.size)
            else:
                save(file, wall["views"])
        index[stop] = {"file": file, "label": wall["label"]}
        if "aim" in wall:                    # where the camera turns to show the wall: yaw from the stop's own, pitch as is
            index[stop]["yaw"], index[stop]["pitch"] = wall["aim"]
        if "level" in place:                 # tintPano's fourth argument for this wall
            index[stop]["level"] = place["level"]
        if preview:
            preview.mkdir(parents=True, exist_ok=True)
            faces = cache / "matterport" / place["model"] / "faces"
            for number, view in enumerate(wall.get("views", [])):
                photo = view_photo(faces, tour["stops"][stop]["sweep"], view)
                tint = Image.new("RGB", photo.size, (255, 0, 255))
                shade = draw_view(view).point(lambda value: value * 0.45)
                Image.composite(tint, photo, shade).save(preview / f"{stop}-{number}.jpg", quality=88)
    (output / "index.json").write_text(json.dumps(index, indent=2) + "\n")
    print(f"Wrote {len(index)} wall masks to {output}: {', '.join(index)}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("property", nargs="?", default="a5", choices=PROPERTIES, help="which home (default: a5)")
    parser.add_argument("--cache", type=Path, default=Path.home() / "brace/data/cache")
    parser.add_argument("--output", type=Path, help="folder for the masks (default: the property's walls folder)")
    parser.add_argument("--preview", type=Path, help="folder for pictures of each view with its outline")
    args = parser.parse_args()
    make(args.property, args.cache, args.output, args.preview)
