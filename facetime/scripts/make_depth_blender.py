"""Blender half of make_depth.py: casts one ray per depth pixel from every scan position into the MatterPak mesh.

    Blender --background --factory-startup --python make_depth_blender.py -- mesh.obj model.json out_dir width height

Writes out_dir/<sweepId>.f32: little-endian float32, height rows of width, the distance in metres to the first
surface along the ray of that panorama pixel, 0 where the ray leaves the mesh without hitting anything.

The ray of a pixel is the one in make_depth.py's header: column u is panorama yaw, row v is pitch, and the yaw
is turned into a world bearing with the sweep's bearing0. The mesh is already in the model frame (metres, z up),
the same as the sweep positions, so nothing is moved or scaled.
"""

import json
import math
import sys
import time
from pathlib import Path

import numpy as np
from mathutils.bvhtree import BVHTree


def read_obj(path):
    vertices, faces = [], []
    with open(path) as lines:
        for line in lines:
            if line.startswith("v "):
                vertices.append(tuple(map(float, line.split()[1:4])))
            elif line.startswith("f "):
                corners = [int(corner.split("/")[0]) - 1 for corner in line.split()[1:]]
                for k in range(1, len(corners) - 1):
                    faces.append((corners[0], corners[k], corners[k + 1]))
    return vertices, faces


def main():
    obj, model_file, out_dir, width, height = sys.argv[sys.argv.index("--") + 1:]
    width, height, out_dir = int(width), int(height), Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    model = json.loads(Path(model_file).read_text())

    started = time.time()
    vertices, faces = read_obj(obj)
    tree = BVHTree.FromPolygons(vertices, faces, all_triangles=True)
    print(f"mesh: {len(vertices)} vertices, {len(faces)} triangles, tree in {time.time() - started:.1f} s", flush=True)

    yaw = (np.arange(width) + 0.5) / width * 2 * np.pi - np.pi
    pitch = np.pi / 2 - (np.arange(height) + 0.5) / height * np.pi
    yaw, pitch = np.meshgrid(yaw, pitch)
    for sweep in model["sweeps"]:
        started = time.time()
        q = sweep["rotation"]
        bearing = 2 * math.atan2(q["z"], q["w"]) - yaw            # world bearing of each pixel, radians
        rays = np.stack((np.cos(bearing) * np.cos(pitch), np.sin(bearing) * np.cos(pitch), np.sin(pitch)), axis=-1)
        origin = (sweep["x"], sweep["y"], sweep["z"])
        cast = tree.ray_cast
        depth = np.fromiter((cast(origin, ray)[3] or 0.0 for ray in rays.reshape(-1, 3).tolist()),
                            dtype=np.float32, count=width * height)
        depth.astype("<f4").tofile(out_dir / f"{sweep['id']}.f32")
        print(f"{sweep['id']}  missed {np.mean(depth == 0):.2%}  median {np.median(depth[depth > 0]):.2f} m  "
              f"{time.time() - started:.1f} s", flush=True)


main()
