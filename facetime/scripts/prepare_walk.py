"""Prepare what the FaceTime camera needs to walk through the unit: a panorama for every scan position and
media/walk.json, the graph of positions a person can actually walk between and which way each panorama faces.

    python3 facetime/scripts/prepare_walk.py

The tour stops keep their own panoramas in data/demo; this adds the other scan positions under media/sweeps.
"""

import argparse
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parents[1]
ROOT = HERE.parent
MODEL_ID = "9odpSsu2KYQ"

# Forward, right and up axes of the six skybox images, as in scripts/prepare_demo.py.
FACE_AXES = np.array([
    ((0, 1, 0), (1, 0, 0), (0, 0, -1)),
    ((0, 0, 1), (1, 0, 0), (0, 1, 0)),
    ((1, 0, 0), (0, 0, -1), (0, 1, 0)),
    ((0, 0, -1), (-1, 0, 0), (0, 1, 0)),
    ((-1, 0, 0), (0, 0, 1), (0, 1, 0)),
    ((0, -1, 0), (1, 0, 0), (0, 0, 1)),
], dtype=np.float32)

# Things a person cannot walk through that the scan's room edges call open: the breakfast bar between the
# kitchen and the living room (seen in the panoramas; its free end is by the dining nook).
OBSTACLES = [((-1.13, -2.01), (-1.13, -3.0))]


def heading(sweep):
    """The world direction (degrees, atan2 in model x, y) that the sweep's panorama faces at yaw 0.

    The skybox is in the sweep's own frame, so a world direction `a` is at panorama yaw `heading - a`.
    Checked by eye: from each sweep, that yaw toward a neighbouring sweep looks down the doorway or hall to it.
    """
    q = sweep["rotation"]
    return (math.degrees(2 * math.atan2(q["z"], q["w"])) + 180) % 360 - 180


def panorama_rays(width, height):
    yaw = (np.arange(width, dtype=np.float32) + 0.5) / width * 2 * np.pi - np.pi
    pitch = np.pi / 2 - (np.arange(height, dtype=np.float32) + 0.5) / height * np.pi
    yaw, pitch = np.meshgrid(yaw, pitch)
    return np.stack((np.sin(yaw) * np.cos(pitch), np.sin(pitch), np.cos(yaw) * np.cos(pitch)), axis=-1)


def sample_cube(faces, rays):
    """The picture along each ray, smoothed between face pixels, and which rays had no face to read."""
    best = np.einsum("...i,ji->...j", rays, FACE_AXES[:, 0]).argmax(axis=-1)
    result = np.zeros(rays.shape, dtype=np.float32)
    missing = np.zeros(rays.shape[:-1], dtype=bool)
    for index, axes in enumerate(FACE_AXES):
        pixels = best == index
        if faces[index] is None:
            missing |= pixels
            continue
        face = faces[index]
        size = face.shape[0]
        depth, horizontal, vertical = np.einsum("...i,ji->...j", rays[pixels], axes).T
        x = ((horizontal / depth + 1) * size / 2 - 0.5).clip(0, size - 1.001)
        y = ((1 - vertical / depth) * size / 2 - 0.5).clip(0, size - 1.001)
        x0, y0 = x.astype(int), y.astype(int)
        fx, fy = (x - x0)[:, None], (y - y0)[:, None]
        top = face[y0, x0] * (1 - fx) + face[y0, x0 + 1] * fx
        low = face[y0 + 1, x0] * (1 - fx) + face[y0 + 1, x0 + 1] * fx
        result[pixels] = top * (1 - fy) + low * fy
    return result, missing


def blur_around(row, sigma):
    """A row of colours blurred along the panorama, which wraps."""
    if sigma <= 0:
        return row
    radius = int(sigma * 3)
    kernel = np.exp(-0.5 * (np.arange(-radius, radius + 1) / sigma) ** 2)
    kernel /= kernel.sum()
    padded = np.concatenate((row[-radius:], row, row[:radius]))
    return np.stack([np.convolve(padded[:, c], kernel, mode="valid") for c in range(3)], axis=-1)


def fill_cap(image, missing, top):
    """Paint a missing ceiling or floor from the edge of what was scanned, softer toward the pole.

    A safety net for a position whose up or down face is not in the cache. The picture there is the wall, ceiling
    or floor colour continued from the last scanned row, which reads as a plain ceiling or floor rather than a hole.
    """
    height, width = missing.shape
    rows = np.arange(height)[:, None]
    column = missing & ((rows < height // 2) if top else (rows >= height // 2))
    if not column.any():
        return
    count = column.sum(axis=0)                               # missing rows in each column
    edge = count if top else height - 1 - count              # the first scanned row past the cap
    step = 1 if top else -1
    seed = np.mean([image[(edge + step * k).clip(0, height - 1), np.arange(width)] for k in range(1, 7)], axis=0)
    levels = [blur_around(seed, sigma * width / 3840) for sigma in (6, 40, 160, 500)]
    levels.append(np.broadcast_to(seed.mean(axis=0), seed.shape))
    longest = count.max()
    for k in range(longest):                                 # k rows from the pole
        row = k if top else height - 1 - k
        inside = k < count
        depth = (1 - (k + 0.5) / np.maximum(count, 1)).clip(0, 1)   # 0 at the scanned edge, 1 at the pole
        place = depth ** 0.7 * (len(levels) - 1)
        lower = np.minimum(place.astype(int), len(levels) - 2)
        weight = (place - lower)[:, None]
        stack = np.stack(levels)
        colour = stack[lower, np.arange(width)] * (1 - weight) + stack[lower + 1, np.arange(width)] * weight
        image[row, inside] = colour[inside]


def panorama(folder, sweep_id, rays):
    # Faces a little finer than the panorama: any finer and reading them one pixel at a time would shimmer.
    side = round(rays.shape[1] * 0.4)
    faces = []
    for index in range(6):
        path = folder / f"{sweep_id}_{index}.jpg"
        faces.append(np.asarray(Image.open(path).convert("RGB").resize((side, side), Image.Resampling.LANCZOS), dtype=np.float32)
                     if path.exists() else None)
    image, missing = sample_cube(faces, rays)
    if missing.any():
        fill_cap(image, missing, top=True)
        fill_cap(image, missing, top=False)
    return Image.fromarray(image.round().clip(0, 255).astype(np.uint8)), [i for i in range(6) if faces[i] is None]


def crossing(p, q, a, b):
    """How far along a-b the walk p-q crosses it, or None."""
    d1 = (q[0] - p[0], q[1] - p[1])
    d2 = (b[0] - a[0], b[1] - a[1])
    den = d1[0] * d2[1] - d1[1] * d2[0]
    if abs(den) < 1e-12:
        return None
    t = ((a[0] - p[0]) * d2[1] - (a[1] - p[1]) * d2[0]) / den
    s = ((a[0] - p[0]) * d1[1] - (a[1] - p[1]) * d1[0]) / den
    return s if 0 < t < 1 and 0 <= s <= 1 else None


def read_walls(path):
    """Every wall of the unit once: its two ends and the doorways in it, as (centre, width) along the wall."""
    if not path.exists():
        return []
    walls = {}
    for room in json.loads(path.read_text()):
        for edge in room["boundary"]["edges"]:
            if edge["type"] != "wall":
                continue
            a, b = [(v["position"]["x"], v["position"]["y"]) for v in edge["vertices"]]
            doors = [(o["relativeCenter"], o["width"]) for o in edge["openings"] if o["type"] == "doorway"]
            walls[edge["id"]] = (a, b, doors)
    return list(walls.values())


def walkable(p, q, walls):
    """Whether a person can walk straight from p to q: the scan's neighbours are lines of sight, not of walking."""
    for a, b in OBSTACLES:
        if crossing(p, q, a, b) is not None:
            return False
    for a, b, doors in walls:
        at = crossing(p, q, a, b)
        if at is None:
            continue
        length = math.dist(a, b)
        if not any(abs(at - centre) * length < width / 2 for centre, width in doors):
            return False
    return True


def prepare(cache, size):
    folder = cache / "matterport" / MODEL_ID
    model = json.loads((folder / "model.json").read_text())
    tour = json.loads((ROOT / "data/demo/tour.json").read_text())
    stops = {stop["sweep"]: key for key, stop in tour["stops"].items()}
    rooms = {room["id"]: room["type"] for room in model["rooms"]}
    walls = read_walls(cache / "matterport/openings" / f"{MODEL_ID}.json")
    where = {s["id"]: (s["x"], s["y"]) for s in model["sweeps"]}

    output = HERE / "media"
    (output / "sweeps").mkdir(parents=True, exist_ok=True)
    rays = panorama_rays(size, size // 2)
    sweeps = []
    for sweep in model["sweeps"]:
        key = sweep["id"]
        entry = {
            "id": key, "x": sweep["x"], "y": sweep["y"],
            "neighbors": [n for n in sweep["neighbors"] if walkable(where[key], where[n], walls)],
            "yawOffset": round(heading(sweep), 2),
            "room": rooms.get(sweep["room_id"], ""),
        }
        if key in stops:
            entry["stop"] = stops[key]                       # its panorama is data/demo/<stop>.webp
        else:
            image, absent = panorama(folder / "faces", key, rays)
            image.save(output / "sweeps" / f"{key}.webp", quality=88)
            entry["pano"] = f"sweeps/{key}.webp"
            if absent:
                entry["levelOnly"] = True                    # faces missing from the cache were painted in: keep the camera level
            print(f"{key}  {entry['room']:12s} {'filled faces ' + str(absent) if absent else ''}")
        sweeps.append(entry)

    for entry in sweeps:                                     # a walk both ways or not at all
        entry["neighbors"] = [n for n in entry["neighbors"]
                              if entry["id"] in next(s for s in sweeps if s["id"] == n)["neighbors"]]
    manifest = {
        "modelId": model["id"],
        # panorama yaw (degrees) of a world direction: yawOffset - degrees(atan2(dy, dx)) in model x, y
        "yaw": "yawOffset - atan2(dy, dx)",
        "sweeps": sweeps,
    }
    (output / "walk.json").write_text(json.dumps(manifest, separators=(",", ":")) + "\n")
    print(f"Prepared {sum('pano' in s for s in sweeps)} panoramas and the walking graph in {output}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, default=Path.home() / "brace/data/cache")
    # 2880 wide is 17 MB in memory against 30 MB at the stops' 3840; ten of them fit the camera's memory budget.
    parser.add_argument("--size", type=int, default=2880, help="Panorama width in pixels")
    args = parser.parse_args()
    prepare(args.cache, args.size)
