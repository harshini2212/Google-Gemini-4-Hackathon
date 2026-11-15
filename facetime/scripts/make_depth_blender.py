"""Blender half of make_depth.py: casts one ray per depth pixel from every scan position into the MatterPak mesh.

    Blender --background --factory-startup --python make_depth_blender.py -- mesh.npz sweeps.json out_dir width height

mesh.npz holds `vertices` (n x 3, the model frame: metres, z up) and `triangles` (m x 3 vertex numbers), or
several sets of triangles under other names: the same house with a door open, and shut.
sweeps.json is a list of { id, x, y, z, turn } and, for a sweep whose tilt is to be followed, `rotation`, and
for one that takes a set of triangles of its own, `triangles`, its name.

Writes out_dir/<sweepId>.f32: little-endian float32, height rows of width, the distance in metres to the first
surface along the ray of that panorama pixel, 0 where the ray leaves the mesh without hitting anything.

The ray of a pixel is the one in make_depth.py's header: column u is panorama yaw, row v is pitch, and the yaw
is turned into a world bearing with the sweep's `turn` (bearing0, in radians). With `rotation` (the sweep's
quaternion) the ray is turned by all of it instead, which is the same thing for a sweep that stood level.
"""

import json
import sys
import time
from pathlib import Path

import numpy as np
from mathutils.bvhtree import BVHTree


def matrix(q):
    x, y, z, w = q["x"], q["y"], q["z"], q["w"]
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def main():
    mesh, sweeps_file, out_dir, width, height = sys.argv[sys.argv.index("--") + 1:]
    width, height, out_dir = int(width), int(height), Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    started = time.time()
    with np.load(mesh) as data:
        vertices = data["vertices"].tolist()
        trees = {name: BVHTree.FromPolygons(vertices, data[name].tolist(), all_triangles=True) for name in data.files if name != "vertices"}
    print(f"mesh: {len(vertices)} vertices, {len(trees)} sets of triangles, trees in {time.time() - started:.1f} s", flush=True)

    yaw = (np.arange(width) + 0.5) / width * 2 * np.pi - np.pi
    pitch = np.pi / 2 - (np.arange(height) + 0.5) / height * np.pi
    yaw, pitch = np.meshgrid(yaw, pitch)
    for sweep in json.loads(Path(sweeps_file).read_text()):
        started = time.time()
        if "rotation" in sweep:
            # In the sweep's own frame yaw 0 looks along +x and yaw turns clockwise seen from above.
            own = np.stack((np.cos(yaw) * np.cos(pitch), -np.sin(yaw) * np.cos(pitch), np.sin(pitch)), axis=-1)
            rays = own @ matrix(sweep["rotation"]).T
        else:
            bearing = sweep["turn"] - yaw                             # world bearing of each pixel, radians
            rays = np.stack((np.cos(bearing) * np.cos(pitch), np.sin(bearing) * np.cos(pitch), np.sin(pitch)), axis=-1)
        origin = (sweep["x"], sweep["y"], sweep["z"])
        cast = trees[sweep.get("triangles", "triangles")].ray_cast
        depth = np.fromiter((cast(origin, ray)[3] or 0.0 for ray in rays.reshape(-1, 3).tolist()),
                            dtype=np.float32, count=width * height)
        depth.astype("<f4").tofile(out_dir / f"{sweep['id']}.f32")
        print(f"{sweep['id']}  missed {np.mean(depth == 0):.2%}  {time.time() - started:.1f} s", flush=True)


main()
