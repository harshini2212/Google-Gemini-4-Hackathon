"""Depth panoramas for the FaceTime walk: how far the room is from every scan position, in every direction.

    python3 facetime/scripts/make_depth.py

depthwalk.mjs uses them to slide a 360 photo with the right parallax while the camera walks away from the spot
the photo was taken at.

Source: the scan's MatterPak mesh (cache/open/reconstruct/matterpak/<model>/*.zip, an OBJ in the model frame:
metres, z up, the same x, y, z as the sweep positions in model.json). Blender casts one ray per depth pixel from
each sweep position (make_depth_blender.py); here the misses are filled, the bumps of the mesh are flattened
without moving wall, door and furniture edges, and the result is written out.

Output, in media/depth:
    <sweepId>.bin   little-endian float32, HEIGHT rows of WIDTH: metres from the sweep position to the first
                    surface along the ray of that pixel, always within 0.3 to 30
    index.json      { width, height, sweeps: { <sweepId>: { file, x, y, z, bearing0 } } }

The convention, the same as the panoramas (scripts/prepare_demo.py `panorama_rays`):
    column u (0 to WIDTH-1)    yaw   = (u + 0.5) / WIDTH * 360 - 180        degrees
    row v    (0 to HEIGHT-1)   pitch = 90 - (v + 0.5) / HEIGHT * 180        degrees, up is positive
    in the panorama's own frame (y up) that ray is (sin yaw cos pitch, sin pitch, cos yaw cos pitch)
    in the world (model.json x, y, z; z up) it points along
        bearing = bearing0 - yaw                                             degrees counter-clockwise from +x
        (cos bearing cos pitch, sin bearing cos pitch, sin pitch)
    bearing0 = degrees(2 * atan2(q.z, q.w)) for the sweep's rotation quaternion q: the world bearing of yaw 0.
A sweep's tilt off level (under half a degree in this scan) is ignored, as it is everywhere else in the tour.
"""

import argparse
import json
import math
import os
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parents[1]
MODEL_ID = "9odpSsu2KYQ"
NEAR, FAR = 0.3, 30.0


def bearing0(sweep):
    q = sweep["rotation"]
    return (math.degrees(2 * math.atan2(q["z"], q["w"])) + 180) % 360 - 180


def around(image, radius):
    """The image with `radius` more pixels on every side: the panorama wraps sideways and stops at the poles."""
    wide = np.concatenate((image[:, -radius:], image, image[:, :radius]), axis=1)
    return np.concatenate((np.repeat(wide[:1], radius, axis=0), wide, np.repeat(wide[-1:], radius, axis=0)), axis=0)


def shifted(image, radius):
    """Every neighbour of every pixel within `radius`, as (dy, dx, image moved by that much)."""
    height, width = image.shape
    padded = around(image, radius)
    for dy in range(-radius, radius + 1):
        for dx in range(-radius, radius + 1):
            yield dy, dx, padded[radius + dy:radius + dy + height, radius + dx:radius + dx + width]


def fill(depth):
    """Rays that left the mesh (windows, mirrors, cracks) take the nearest surface around them."""
    depth = depth.copy()
    while True:
        missing = ~(depth > 0)
        if not missing.any():
            return depth
        total, count = np.zeros_like(depth), np.zeros_like(depth)
        for _, _, near in shifted(np.where(missing, 0, depth), 1):
            total += near
            count += near > 0
        ready = missing & (count > 0)
        if not ready.any():
            raise RuntimeError("A depth panorama is empty: the mesh is not around this sweep.")
        depth[ready] = total[ready] / count[ready]


def square_edges(near):
    """Where a surface ends in front of something farther, carry it flat up to its edge.

    `near` is one over the depth. The last pixels of a door leaf, a wall end or a counter are its thin end
    face seen edge-on, caught by the mesh in some rows and not in others; seen from anywhere else that makes
    the edge a staircase. They take the surface's own continuation from the pixels just inside it instead.
    """
    out = near.copy()
    for axis in (1, 0):                                          # edges across the panorama (it wraps), then up and down
        for way in (1, -1):                                      # the farther side is this way
            at = lambda k: np.roll(near, -way * k, axis=axis)    # the value k pixels toward the farther side
            inside, deeper = at(-3), at(-6)
            edge = (near > 1.3 * at(1)) & (np.abs(np.log(inside / near)) < 0.25) & (np.abs(np.log(deeper / inside)) < 0.15)
            if axis == 0:
                edge[:8] = edge[-8:] = False
            slope = (inside - deeper) / 3
            for back in range(3):                                # the edge pixel and the two before it
                out = np.where(np.roll(edge, -way * back, axis=axis), np.roll(inside + (3 - back) * slope, -way * back, axis=axis), out)
    return out


def smooth(depth):
    """Flatten the bumps of the mesh without moving its edges.

    Rooms are flat surfaces, and one over the depth is a straight line across a flat surface. So each pixel
    takes the value, at itself, of the plane that best fits one-over-depth around it. The first fit counts
    neighbours by closeness in the picture and in depth (one 15% nearer or farther hardly counts, so the far
    side of a door edge stays out of the door); the next ones count them by how well they agree with the plane
    found so far, which lets go of the few pixels that are not on it: the rounded end of a door leaf, a lump in
    a wall. A door two feet from the scanner comes out flat and its edge straight.
    """
    near = square_edges(np.median(np.stack([image for _, _, image in shifted(1 / depth, 1)]), axis=0))   # the median: single-pixel spikes
    start, slope_x, slope_y = near, np.zeros_like(near), np.zeros_like(near)
    for tolerance in (0.07, 0.03, 0.02, 0.02):
        s = {key: np.zeros_like(near) for key in ("1", "x", "y", "xx", "xy", "yy", "q", "xq", "yq")}
        for dy, dx, other in shifted(start, 5):
            expected = np.maximum(near + slope_x * dx + slope_y * dy, near * 0.5)
            w = np.exp(-(dx * dx + dy * dy) / (2 * 2.5 ** 2) - np.log(other / expected) ** 2 / (2 * tolerance ** 2))
            s["1"] += w; s["x"] += w * dx; s["y"] += w * dy
            s["xx"] += w * dx * dx; s["xy"] += w * dx * dy; s["yy"] += w * dy * dy
            s["q"] += w * other; s["xq"] += w * dx * other; s["yq"] += w * dy * other
        # The plane through the neighbours, by Cramer's rule on the three normal equations.
        a, b, c = s["xx"] * s["yy"] - s["xy"] ** 2, s["x"] * s["yy"] - s["xy"] * s["y"], s["x"] * s["xy"] - s["xx"] * s["y"]
        whole = s["1"] * a - s["x"] * b + s["y"] * c
        # Too few neighbours agree to fit a plane (a thin edge, a corner): keep what the pixel had.
        fits = whole > 1e-3 * s["1"] ** 3
        whole = np.where(fits, whole, 1)
        value = (s["q"] * a - s["xq"] * b + s["yq"] * c) / whole
        along = (-s["q"] * b + s["xq"] * (s["1"] * s["yy"] - s["y"] ** 2) - s["yq"] * (s["1"] * s["xy"] - s["x"] * s["y"])) / whole
        down = (s["q"] * c - s["xq"] * (s["1"] * s["xy"] - s["x"] * s["y"]) + s["yq"] * (s["1"] * s["xx"] - s["x"] ** 2)) / whole
        fits &= (value > start / 1.12) & (value < start * 1.12)
        near, slope_x, slope_y = np.where(fits, value, near), np.where(fits, along, slope_x), np.where(fits, down, slope_y)
    return 1 / near


def cast(blender, mesh, model_file, raw, width, height):
    subprocess.run([blender, "--background", "--factory-startup", "--python-exit-code", "1",
                    "--python", str(Path(__file__).with_name("make_depth_blender.py")),
                    "--", str(mesh), str(model_file), str(raw), str(width), str(height)],
                   check=True, stdout=subprocess.DEVNULL)


def prepare(cache, blender, work, width):
    height = width // 2
    model_file = cache / "matterport" / MODEL_ID / "model.json"
    model = json.loads(model_file.read_text())
    archive = next((cache / "open/reconstruct/matterpak" / MODEL_ID).glob("*.zip"), None)
    if archive is None:
        raise SystemExit(f"No MatterPak mesh for {MODEL_ID} under {cache}/open/reconstruct/matterpak.")

    with zipfile.ZipFile(archive) as pak:
        name = next(n for n in pak.namelist() if n.endswith(".obj"))
        mesh = work / "mesh" / Path(name).name
        if not mesh.exists():
            mesh.parent.mkdir(parents=True, exist_ok=True)
            with pak.open(name) as source, open(mesh, "wb") as target:
                shutil.copyfileobj(source, target)
    raw = work / "raw"
    cast(blender, mesh, model_file, raw, width, height)

    output = HERE / "media/depth"
    output.mkdir(parents=True, exist_ok=True)
    sweeps = {}
    for sweep in model["sweeps"]:
        key = sweep["id"]
        hit = np.fromfile(raw / f"{key}.f32", dtype="<f4").reshape(height, width).astype(np.float64)
        hit[~np.isfinite(hit) | (hit > FAR)] = 0                 # a ray that runs out of the unit counts as a miss
        depth = smooth(fill(hit).clip(NEAR, FAR)).clip(NEAR, FAR)
        if not np.isfinite(depth).all():
            raise RuntimeError(f"Depth for {key} is not finite.")
        depth.astype("<f4").tofile(output / f"{key}.bin")
        sweeps[key] = {"file": f"{key}.bin", "x": sweep["x"], "y": sweep["y"], "z": sweep["z"],
                       "bearing0": round(bearing0(sweep), 3)}
        # Straight down is the floor under the tripod, straight up the ceiling: a mesh in another frame fails here.
        print(f"{key}  floor {depth[-1].mean():.2f} m below, ceiling {depth[0].mean():.2f} m above, "
              f"filled {np.mean(hit == 0):.2%}, {depth.min():.2f} to {depth.max():.2f} m")
    (output / "index.json").write_text(json.dumps({"width": width, "height": height, "sweeps": sweeps}, indent=1) + "\n")
    print(f"Wrote {len(sweeps)} depth panoramas ({width} x {height}) from the MatterPak mesh to {output}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--cache", type=Path, default=Path.home() / "brace/data/cache")
    parser.add_argument("--blender", default=os.environ.get("BLENDER_BIN") or shutil.which("blender")
                        or "/Applications/Blender 5.1.app/Contents/MacOS/Blender")
    parser.add_argument("--work", type=Path, help="Folder for the unpacked mesh and the raw casts (default: a temporary one)")
    parser.add_argument("--size", type=int, default=1024, help="Depth panorama width in pixels")
    args = parser.parse_args()
    if args.work:
        args.work.mkdir(parents=True, exist_ok=True)
        prepare(args.cache, args.blender, args.work, args.size)
    else:
        with tempfile.TemporaryDirectory(prefix="open-house-depth-") as folder:
            prepare(args.cache, args.blender, Path(folder), args.size)
