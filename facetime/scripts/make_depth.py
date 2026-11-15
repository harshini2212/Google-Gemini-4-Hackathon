"""Depth panoramas for the FaceTime walk: how far the room is from every scan position, in every direction.

    python3 facetime/scripts/make_depth.py                  the A5 apartment, into media/depth
    python3 facetime/scripts/make_depth.py alex-springs     a property in properties/, into media/<property>/depth

depthwalk.mjs uses them to slide a 360 photo with the right parallax while the camera walks away from the spot
the photo was taken at.

Source: the scan's MatterPak mesh, an OBJ in the model frame (metres, z up, the same x, y, z as the sweep
positions in model.json). It is read from cache/open/reconstruct/matterpak/<model>/*.zip when that is there;
otherwise the one OBJ is read out of the archive where Matterport keeps it, without downloading the rest (the
point cloud beside it is ten times the size). Blender casts one ray per depth pixel from each sweep position
(make_depth_blender.py); here the misses are filled, the bumps of the mesh are flattened without moving wall,
door and furniture edges, and the result is written out.

Output:
    <sweepId>.bin   little-endian float32, HEIGHT rows of WIDTH: metres from the sweep position to the first
                    surface along the ray of that pixel, always within 0.3 to 30
    index.json      { width, height, sweeps: { <sweepId>: { file, x, y, z, bearing0 } } }
                    and, for a property: on each sweep `lean`, how the tripod stood off level (below), and
                    `flat: true` where the depth is not worth walking with (FLAT, below: cross-dissolve to and
                    from that sweep as before); and beside `sweeps`, `reach`, the longest step in metres that
                    is (a longer one sees too much that neither photo has: cross-dissolve it too).

The convention, the same as the panoramas (scripts/prepare_demo.py `panorama_rays`):
    column u (0 to WIDTH-1)    yaw   = (u + 0.5) / WIDTH * 360 - 180        degrees
    row v    (0 to HEIGHT-1)   pitch = 90 - (v + 0.5) / HEIGHT * 180        degrees, up is positive
    in the panorama's own frame (y up) that ray is (sin yaw cos pitch, sin pitch, cos yaw cos pitch)
    in the world (model.json x, y, z; z up) it points along
        bearing = bearing0 - yaw                                             degrees counter-clockwise from +x
        (cos bearing cos pitch, sin bearing cos pitch, sin pitch)
    bearing0 = degrees(2 * atan2(q.z, q.w)) for the sweep's rotation quaternion q: the world bearing of yaw 0.
That is for a tripod that stood level. In the A5 scan it did to within half a degree, and the tilt is ignored
there, as it is everywhere else in the tour. In the house it leaned up to 1.3 degrees, which moves a door frame
four depth pixels off the photo, so for a property the rays follow the whole rotation: the depth is in the
panorama's own, leaning frame and lines up with the photo, and index.json carries `lean`, nine numbers, the
rotation (rows of a 3 x 3, world to world) that takes the level direction above to the true one.
"""

import argparse
import io
import json
import math
import os
import shutil
import subprocess
import tempfile
import urllib.request
import zipfile
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parents[1]
A5 = "9odpSsu2KYQ"                      # the scan of the apartment, when no property is named
NEAR, FAR = 0.3, 30.0
SKY = 6                                 # pixels: a miss farther than this from any surface is open air: the ground, or FAR away

# What one mesh cannot hold is a door both ways. The house was scanned with its front door shut, then open for the
# two positions at the threshold, and the mesh has scraps of both in the doorway. So each sweep is cast with the
# door as its own photo has it: the scraps taken out, and a flat panel put in where it was shut. Per property:
# the two ends of each door's sill (model x, y), the heights of sill and head, and the sweeps that saw it open.
DOORS = {
    "alex-springs": [{"sill": ((-5.84, -1.95), (-5.84, -0.99)), "low": 0.0, "high": 2.05,
                      "open": ("9fk7m8m55dnpcnt8gbknbeh5a", "c7mz2tchxpsqmdn548i1g8cwd")}],      # entry, living_room_front
}
# Sweeps whose depth is not worth walking with, by property. The side yard: the back door beside it is open in
# the photos taken indoors and shut in its own, and is not in DOORS, so the mesh there is scraps of both.
FLAT = {"alex-springs": ("i5txbbyt6rerzkkgrer76zx0d",)}
# The longest step worth walking with depth, metres. Seen in the walk tests: up to 3.2 m holds together, in
# rooms and out on the porch; 3.8 m down a hall of open doors and 4.4 m round a wall end do not.
REACH = 3.5


def bearing0(sweep):
    q = sweep["rotation"]
    return (math.degrees(2 * math.atan2(q["z"], q["w"])) + 180) % 360 - 180


def lean(sweep):
    """How the tripod stood off level: the sweep's rotation with its turn about the vertical taken out."""
    q = sweep["rotation"]
    x, y, z, w = q["x"], q["y"], q["z"], q["w"]
    whole = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                      [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                      [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
    turn = 2 * math.atan2(z, w)
    back = np.array([[math.cos(turn), math.sin(turn), 0], [-math.sin(turn), math.cos(turn), 0], [0, 0, 1]])
    return [round(float(value), 6) for value in (whole @ back).ravel()]


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


def fill(depth, reach=None):
    """Rays that left the mesh (windows, mirrors, cracks) take the nearest surface around them.

    With `reach`, only those within that many pixels of a surface do. The rest look out into the open: below the
    horizon at the ground, level with the floor under the tripod and carried on past where the mesh stops, and
    above it at the sky, FAR away.
    """
    depth = depth.copy()
    for ring in range(depth.size):
        missing = ~(depth > 0)
        if not missing.any():
            return depth
        if ring == reach:
            under = depth[-8:][depth[-8:] > 0]
            stand = np.median(under) if under.size else 1.4
            down = np.sin(np.radians((np.arange(depth.shape[0]) + 0.5) / depth.shape[0] * 180 - 90))[:, None]
            ground = np.where(down > 0, stand / np.maximum(down, 1e-6), FAR).clip(NEAR, FAR)
            depth[missing] = np.broadcast_to(ground, depth.shape)[missing]
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


class Remote(io.RawIOBase):
    """A file at a URL, read a piece at a time: enough to take one file out of a large archive."""

    def __init__(self, url, piece=8 << 20):
        self.url, self.piece, self.at, self.start, self.held = url, piece, 0, 0, b""
        with self.ask(0, 0) as reply:
            self.size = int(reply.headers["Content-Range"].rsplit("/", 1)[-1])

    def ask(self, first, last):
        return urllib.request.urlopen(urllib.request.Request(self.url, headers={"Range": f"bytes={first}-{last}"}), timeout=300)

    def seekable(self):
        return True

    def readable(self):
        return True

    def tell(self):
        return self.at

    def seek(self, offset, whence=0):
        self.at = offset + (0, self.at, self.size)[whence]
        return self.at

    def read(self, count=-1):
        count = self.size - self.at if count is None or count < 0 else min(count, self.size - self.at)
        if count <= 0:
            return b""
        if not self.start <= self.at < self.start + len(self.held):
            with self.ask(self.at, min(self.at + max(count, self.piece), self.size) - 1) as reply:
                self.start, self.held = self.at, reply.read()
        data = self.held[self.at - self.start:self.at - self.start + count]
        self.at += len(data)
        return data + self.read(count - len(data)) if len(data) < count else data


def archive_of(cache, model_id):
    """The scan's MatterPak, opened: the cached file, or the one at Matterport read through the backend's own sign-in."""
    folder = cache / "open/reconstruct/matterpak" / model_id
    stored = next(folder.glob("*.zip"), None) if folder.exists() else None
    if stored:
        return zipfile.ZipFile(stored)
    brace = cache.parents[1]                                     # the backend keeps the Matterport keys; ask it for the address
    ask = ("from backend import matterport\n"
           "data = matterport.gql('{ model(id:\"%s\"){ bundle(id:\"mp:matterpak\"){ availability assets{ status url } } } }')\n"
           "bundle = (data.get('model') or {}).get('bundle') or {}\n"
           "print(next((a['url'] for a in bundle.get('assets') or [] if a.get('status') == 'available' and a.get('url')), ''))\n"
           ) % model_id
    found = subprocess.run([str(brace / ".venv/bin/python"), "-c", ask], cwd=brace, capture_output=True, text=True)
    url = found.stdout.strip().splitlines()[-1] if found.stdout.strip() else ""
    if found.returncode or not url.startswith("https://"):
        raise SystemExit(f"No MatterPak mesh for {model_id}: none under {folder}, and Matterport lists none that is ready.")
    return zipfile.ZipFile(Remote(url))


def read_mesh(cache, model_id, target):
    """The mesh of the scan as arrays: the OBJ's corners, and its faces as triangles."""
    vertices, triangles = [], []
    with archive_of(cache, model_id) as pak:
        name = next(n for n in pak.namelist() if n.endswith(".obj"))
        with pak.open(name) as lines:
            for line in io.TextIOWrapper(lines, "ascii", errors="replace"):
                if line.startswith("v "):
                    vertices.append(tuple(map(float, line.split()[1:4])))
                elif line.startswith("f "):
                    corners = [int(corner.split("/")[0]) - 1 for corner in line.split()[1:]]
                    triangles.extend((corners[0], corners[k], corners[k + 1]) for k in range(1, len(corners) - 1))
    np.savez(target, vertices=np.array(vertices, dtype=np.float64), triangles=np.array(triangles, dtype=np.int32))
    return len(triangles)


def with_doors(vertices, triangles, doors, sweeps):
    """The mesh once for each way its doors stood: { name: triangles }, the corners with the door panels' added, and which each sweep takes."""
    centre = vertices[triangles].mean(axis=1)
    sides = vertices[triangles[:, 1:]] - vertices[triangles[:, :1]]
    normal = np.cross(sides[:, 0], sides[:, 1])
    upright = np.abs(normal[:, 2]) < 0.7 * np.linalg.norm(normal, axis=1)
    scraps, panels, corners = [], [], [tuple(v) for v in vertices[:0]]
    for door in doors:
        a, b = (np.array(end, dtype=float) for end in door["sill"])
        length = np.linalg.norm(b - a)
        along, across = (b - a) / length, np.array([a[1] - b[1], b[0] - a[0]]) / length
        east, north = centre[:, 0] - a[0], centre[:, 1] - a[1]
        s, d = east * along[0] + north * along[1], east * across[0] + north * across[1]     # along the sill, and off its plane
        scraps.append(upright & (s > 0.03) & (s < length - 0.03) & (np.abs(d) < 0.12)
                      & (centre[:, 2] > door["low"] + 0.04) & (centre[:, 2] < door["high"]))
        first = len(vertices) + len(corners)
        corners += [(*a, door["low"]), (*b, door["low"]), (*b, door["high"]), (*a, door["high"])]
        panels.append([(first, first + 1, first + 2), (first, first + 2, first + 3)])
    keep = triangles[~np.any(scraps, axis=0)]
    sets, takes = {}, {}
    for sweep in sweeps:
        stood = "".join("1" if sweep["id"] in door["open"] else "0" for door in doors)
        takes[sweep["id"]] = f"doors_{stood}"
        shut = [panel for panel, state in zip(panels, stood) if state == "0"]
        sets[f"doors_{stood}"] = np.vstack([keep] + shut).astype(np.int32)
    return sets, np.vstack([vertices, np.array(corners, dtype=np.float64).reshape(-1, 3)]), takes


def prepare(cache, blender, work, width, name=None):
    height = width // 2
    if name:
        chosen = json.loads((HERE / "properties" / name / "property.json").read_text())
        model_id, output, wanted = chosen["modelId"], HERE / "media" / name / "depth", [s["id"] for s in chosen["sweeps"]]
    else:
        model_id, output, wanted = A5, HERE / "media/depth", None
    model = json.loads((cache / "matterport" / model_id / "model.json").read_text())
    sweeps = [s for s in model["sweeps"] if wanted is None or s["id"] in wanted]
    if wanted and len(sweeps) != len(wanted):
        raise SystemExit(f"{name}: {len(wanted) - len(sweeps)} of its scan positions are not in the scan's model.json.")

    mesh, places, raw = work / "mesh.npz", work / "sweeps.json", work / "raw"
    if not mesh.exists():
        print(f"mesh of {model_id}: {read_mesh(cache, model_id, mesh)} triangles")
    takes = {}
    if DOORS.get(name):
        with np.load(mesh) as data:
            sets, corners, takes = with_doors(data["vertices"], data["triangles"], DOORS[name], sweeps)
        mesh = work / "doors.npz"
        np.savez(mesh, vertices=corners, **sets)
    places.write_text(json.dumps([{"id": s["id"], "x": s["x"], "y": s["y"], "z": s["z"],
                                   "turn": 2 * math.atan2(s["rotation"]["z"], s["rotation"]["w"]),
                                   **({"rotation": s["rotation"]} if name else {}),
                                   **({"triangles": takes[s["id"]]} if takes else {})} for s in sweeps]))
    subprocess.run([blender, "--background", "--factory-startup", "--python-exit-code", "1",
                    "--python", str(Path(__file__).with_name("make_depth_blender.py")),
                    "--", str(mesh), str(places), str(raw), str(width), str(height)],
                   check=True, stdout=subprocess.DEVNULL)

    output.mkdir(parents=True, exist_ok=True)
    index = {}
    for sweep in sweeps:
        key = sweep["id"]
        hit = np.fromfile(raw / f"{key}.f32", dtype="<f4").reshape(height, width).astype(np.float64)
        (raw / f"{key}.f32").unlink()
        hit[~np.isfinite(hit) | (hit > FAR)] = 0                 # a ray that runs out of the unit counts as a miss
        # A house has a street outside: there a ray that meets nothing is the ground or the sky. The apartment is filled as it always was.
        depth = smooth(fill(hit, SKY if name else None).clip(NEAR, FAR)).clip(NEAR, FAR)
        if not np.isfinite(depth).all():
            raise RuntimeError(f"Depth for {key} is not finite.")
        depth.astype("<f4").tofile(output / f"{key}.bin")
        index[key] = {"file": f"{key}.bin", "x": sweep["x"], "y": sweep["y"], "z": sweep["z"],
                      "bearing0": round(bearing0(sweep), 3), **({"lean": lean(sweep)} if name else {}),
                      **({"flat": True} if key in FLAT.get(name, ()) else {})}
        # Straight down is the floor under the tripod, straight up the ceiling: a mesh in another frame fails here.
        print(f"{key}  floor {depth[-1].mean():.2f} m below, ceiling {depth[0].mean():.2f} m above, "
              f"missed {np.mean(hit == 0):.2%}, {depth.min():.2f} to {depth.max():.2f} m{'  (flat)' if 'flat' in index[key] else ''}")
    (output / "index.json").write_text(json.dumps({"width": width, "height": height, **({"reach": REACH} if name else {}),
                                                    "sweeps": index}, indent=1) + "\n")
    print(f"Wrote {len(index)} depth panoramas ({width} x {height}) from the MatterPak mesh to {output}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("property", nargs="?", help="A folder of properties/ (default: the A5 apartment)")
    parser.add_argument("--cache", type=Path, default=Path.home() / "brace/data/cache")
    parser.add_argument("--blender", default=os.environ.get("BLENDER_BIN") or shutil.which("blender")
                        or "/Applications/Blender 5.1.app/Contents/MacOS/Blender")
    parser.add_argument("--work", type=Path, help="Folder for the mesh and the raw casts (default: a temporary one)")
    parser.add_argument("--size", type=int, default=1024, help="Depth panorama width in pixels")
    args = parser.parse_args()
    if args.work:
        args.work.mkdir(parents=True, exist_ok=True)
        prepare(args.cache, args.blender, args.work, args.size, args.property)
    else:
        with tempfile.TemporaryDirectory(prefix="open-house-depth-") as folder:
            prepare(args.cache, args.blender, Path(folder), args.size, args.property)
