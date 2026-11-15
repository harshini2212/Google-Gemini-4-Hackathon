"""Prepare locally licensed CoStar, Matterport and Vexcel assets for the A5 tour."""

import argparse
import json
import math
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
PROPERTY_ID = 4303509
MODEL_ID = "9odpSsu2KYQ"
STOPS = {
    "living": ("Living room", "twnz", -90, -5, "Fireplace and patio doors"),
    "desk": ("Dining nook", "27n0", 0, -15, "Window-facing spot for a desk"),
    "kitchen": ("Kitchen", "ins0", 279, -8, "Galley counter and cabinets"),
    "bedroom": ("Bedroom", "8ygu", 0, -6, "Window and walk-in closet"),
    "patio": ("Patio", "e41e", 89, -6, "Covered outdoor space"),
}
SITE_BOUNDS = (-95.21046397960292, 29.61505151795257, -95.20934343338013, 29.61568992364249)
PARKING = (-95.20950151043655, 29.61529505145826)

# Forward, right and up axes for the Model API's six skybox images.
FACE_AXES = np.array([
    ((0, 1, 0), (1, 0, 0), (0, 0, -1)),
    ((0, 0, 1), (1, 0, 0), (0, 1, 0)),
    ((1, 0, 0), (0, 0, -1), (0, 1, 0)),
    ((0, 0, -1), (-1, 0, 0), (0, 1, 0)),
    ((-1, 0, 0), (0, 0, 1), (0, 1, 0)),
    ((0, -1, 0), (1, 0, 0), (0, 0, 1)),
], dtype=np.float32)


def read_cube(folder, sweep, replacement=None):
    paths = [folder / f"{sweep}_{i}.jpg" for i in range(6)]
    if replacement:
        paths[4] = replacement
    return [np.asarray(Image.open(p).convert("RGB").resize((1400, 1400), Image.Resampling.LANCZOS)) for p in paths]


def sample_cube(cube, rays):
    best_face = np.einsum("...i,ji->...j", rays, FACE_AXES[:, 0]).argmax(axis=-1)
    result = np.empty(rays.shape, dtype=np.uint8)
    for face, axes in enumerate(FACE_AXES):
        pixels = best_face == face
        depth, horizontal, vertical = np.einsum("...i,ji->...j", rays[pixels], axes).T
        size = cube[face].shape[0]
        x = ((horizontal / depth + 1) * size / 2).astype(int).clip(0, size - 1)
        y = ((1 - vertical / depth) * size / 2).astype(int).clip(0, size - 1)
        result[pixels] = cube[face][y, x]
    return Image.fromarray(result)


def panorama_rays(width=3840, height=1920):
    yaw = (np.arange(width, dtype=np.float32) + 0.5) / width * 2 * np.pi - np.pi
    pitch = np.pi / 2 - (np.arange(height, dtype=np.float32) + 0.5) / height * np.pi
    yaw, pitch = np.meshgrid(yaw, pitch)
    return np.stack((np.sin(yaw) * np.cos(pitch), np.sin(pitch), np.cos(yaw) * np.cos(pitch)), axis=-1)


def poster_rays(yaw, pitch, width=1250, height=700):
    scale = math.tan(math.radians(60) / 2)
    x = (np.arange(width) + 0.5 - width / 2) / (height / 2) * scale
    y = (height / 2 - np.arange(height) - 0.5) / (height / 2) * scale
    x, y = np.meshgrid(x, y)
    yaw, pitch = math.radians(yaw), math.radians(pitch)
    z = math.cos(pitch) - y * math.sin(pitch)
    return np.stack((x * math.cos(yaw) + z * math.sin(yaw), y * math.cos(pitch) + math.sin(pitch),
                     z * math.cos(yaw) - x * math.sin(yaw)), axis=-1).astype(np.float32)


def render_finishes(blender, source, destination):
    # Coordinates are on the original face scaled to a 900 px square.
    # The holes preserve windows, sills and the fireplace in the scan.
    mask = Image.new("L", (900, 900), 0)
    draw = ImageDraw.Draw(mask)
    draw.polygon([(211, 341), (420, 281), (710, 298), (702, 323), (702, 343),
                  (714, 328), (714, 643), (210, 584)], fill=255)
    for cutout in [
        [(222, 379), (305, 374), (306, 547), (219, 539)],
        [(558, 359), (688, 353), (690, 553), (697, 569), (690, 580), (549, 567), (552, 550)],
        [(309, 445), (509, 445), (508, 619), (310, 607)],
    ]:
        draw.polygon(cutout, fill=0)
    mask_file = destination / "mask.png"
    mask.filter(ImageFilter.GaussianBlur(0.8)).save(mask_file)
    subprocess.run([blender, "--background", "--factory-startup", "-t", "4",
                    "--python-exit-code", "1", "--python", str(ROOT / "scripts/render_finishes.py"),
                    "--", str(source), str(mask_file), str(destination)],
                   check=True, stdout=subprocess.DEVNULL)


def build_site(aerial, model, source, output):
    west, south, east, north = aerial["bounds"]
    with Image.open(source) as image:
        width, height = image.size
        def original_pixels(lon, lat):
            return ((lon - west) / (east - west) * width, (north - lat) / (north - south) * height)
        cut_west, cut_south, cut_east, cut_north = SITE_BOUNDS
        left, top = original_pixels(cut_west, cut_north)
        right, bottom = original_pixels(cut_east, cut_south)
        crop = (max(0, round(left)), max(0, round(top)), min(width, round(right)), min(height, round(bottom)))
        if crop[2] <= crop[0] or crop[3] <= crop[1]:
            raise RuntimeError("The Vexcel aerial does not cover the tour site.")
        image.crop(crop).convert("RGB").save(output / "site.webp", quality=94)

    def marker(coords):
        x, y = original_pixels(*coords)
        pin = [(x - crop[0]) / (crop[2] - crop[0]), (y - crop[1]) / (crop[3] - crop[1])]
        if not all(0 <= value <= 1 for value in pin):
            raise RuntimeError("A site marker is outside the aerial image.")
        return pin

    anchor = model["geo"]["origin"]
    dx = (PARKING[0] - anchor[0]) * math.cos(math.radians(anchor[1]))
    dy = PARKING[1] - anchor[1]
    return {
        "image": "/tour-media/site.webp",
        "capture": aerial["captured"],
        "size": [crop[2] - crop[0], crop[3] - crop[1]],
        "anchor": marker(anchor),
        "parking": marker(PARKING),
        "distanceFt": round(math.hypot(dx, dy) * 111195 * 3.28084 / 5) * 5,
    }


def read_costar(kit):
    with (kit / "data/apartment-listing.jsonl").open() as records:
        listing = next(row for row in map(json.loads, records) if row["propertyId"] == PROPERTY_ID)
    floor = next(item for item in listing["apartmentModels"] if item["name"] == "A5")
    with (kit / "data/commercial-property.jsonl").open() as records:
        raw = next(row for row in map(json.loads, records) if row["id"] == PROPERTY_ID)
    address = raw["primaryAddress"]
    parking = raw.get("parking") or []
    record = {
        "id": raw["id"], "name": raw["buildingName"],
        "address": " ".join(str(address[key]) for key in ("streetNumber", "streetDirection", "streetName", "streetType", "streetSuffix") if address.get(key)),
        "city": address["city"], "state": address["state"], "zip": address["postcode"][:5],
        "parking_spaces": sum(item.get("totalSpaces") or 0 for item in parking),
        "covered_parking": any(item.get("parkingType") in (3, 4, 9) for item in parking),
    }
    return record, floor


def prepare(cache, kit, blender, live):
    record, floor = read_costar(kit)
    target = ROOT / "data/demo"
    target.parent.mkdir(exist_ok=True)
    scratch = ROOT / ".local"
    scratch.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="open-house-", dir=scratch) as directory:
        work = Path(directory)
        output = work / "demo"
        output.mkdir()
        if live:
            from sponsor_api import fetch_aerial, fetch_model
            faces = work / "faces"
            aerial_image = work / "aerial.jpg"
            model = fetch_model(MODEL_ID, [stop[1] for stop in STOPS.values()], faces)
            aerial = fetch_aerial(SITE_BOUNDS, aerial_image)
        else:
            model_folder = cache / "matterport" / MODEL_ID
            building_folder = cache / "buildings" / str(PROPERTY_ID)
            faces = model_folder / "faces"
            aerial_image = building_folder / "aerial.jpg"
            model = json.loads((model_folder / "model.json").read_text())
            aerial = json.loads((building_folder / "building.json").read_text())["aerial"]
        site = build_site(aerial, model, aerial_image, output)
        rays = panorama_rays()
        stops = {}
        for key, (label, prefix, yaw, pitch, detail) in STOPS.items():
            sweep = next(s for s in model["sweeps"] if s["id"].startswith(prefix))
            room_id = next(room["id"] for room in model["rooms"] if room["type"] == "Dining Room") if key == "desk" else sweep["room_id"]
            cube = read_cube(faces, sweep["id"])
            sample_cube(cube, rays).save(output / f"{key}.webp", quality=88)
            sample_cube(cube, poster_rays(yaw, pitch)).save(output / f"{key}-poster.webp", quality=90)
            stops[key] = dict(label=label, detail=detail, sweep=sweep["id"], yaw=yaw, pitch=pitch,
                              pano=f"/tour-media/{key}.webp", poster=f"/tour-media/{key}-poster.webp",
                              roomId=room_id)

        living = stops["living"]
        render_finishes(blender, faces / f"{living['sweep']}_4.jpg", work)
        for finish in ("sage", "clay"):
            cube = read_cube(faces, living["sweep"], work / f"{finish}-4.png")
            sample_cube(cube, rays).save(output / f"living-{finish}.webp", quality=88)
            sample_cube(cube, poster_rays(living["yaw"], living["pitch"])).save(
                output / f"living-{finish}-poster.webp", quality=90)

        manifest = {
            "property": record,
            "floor": {**{key: floor[key] for key in ("name", "numBeds", "numBaths", "minSquareFeet", "minRent", "maxRent")},
                      "scanAreaSqft": model["area_indoor_sqft"]},
            "modelId": model["id"],
            "stops": stops,
            "rooms": [{k: r[k] for k in ("id", "type", "area_sqft", "polygon")}
                      for r in model["rooms"] if r["polygon"] and r["type"] != "Void"],
            "sweeps": [{k: s[k] for k in ("id", "x", "y", "neighbors")} for s in model["sweeps"]],
            "site": site,
        }
        (output / "tour.json").write_text(json.dumps(manifest, separators=(",", ":")) + "\n")
        target.mkdir(exist_ok=True)
        for asset in output.iterdir():
            if asset.name != "tour.json":
                asset.replace(target / asset.name)
        (output / "tour.json").replace(target / "tour.json")
    print(f"Prepared {len(stops)} Matterport views, 2 Blender finishes and the Vexcel site image in {target}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    default_cache = Path.home() / "brace/data"
    parser.add_argument("--cache", type=Path, default=default_cache / "cache")
    parser.add_argument("--kit", type=Path, default=default_cache / "kit")
    parser.add_argument("--live", action="store_true", help="Download the Matterport and Vexcel assets using .env")
    parser.add_argument("--blender", default=os.environ.get("BLENDER_BIN") or shutil.which("blender")
                        or "/Applications/Blender 5.1.app/Contents/MacOS/Blender")
    args = parser.parse_args()
    prepare(args.cache, args.kit, args.blender, args.live)
