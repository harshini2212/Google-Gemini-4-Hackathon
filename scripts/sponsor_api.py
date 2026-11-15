"""Fetch the original, address-matched sponsor assets used by the demo."""

import base64
from concurrent.futures import ThreadPoolExecutor
import json
import os
import re
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from shapely.geometry import LineString
from shapely.ops import polygonize
from shapely.wkt import loads


def post(url, payload, headers, provider):
    request = Request(url, data=json.dumps(payload).encode(), headers={
        **headers, "Content-Type": "application/json",
    })
    try:
        with urlopen(request, timeout=35) as response:
            return response.read()
    except HTTPError as error:
        raise RuntimeError(f"{provider} returned HTTP {error.code}.") from None
    except (URLError, TimeoutError):
        raise RuntimeError(f"{provider} could not be reached.") from None


def setting(name):
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Set {name} in .env to download the demo data.")
    return value


def matterport(query):
    auth = base64.b64encode(f"{setting('MATTERPORT_API_KEY')}:{setting('MATTERPORT_API_TOKEN')}".encode())
    body = post("https://api.matterport.com/api/models/graph", {"query": query},
                {"Authorization": f"Basic {auth.decode()}"}, "Matterport")
    data = json.loads(body).get("data", {}).get("model")
    if not data:
        raise RuntimeError("Matterport did not return the demo model.")
    return data


def room_polygon(room):
    lines = []
    for edge in (room.get("boundary") or {}).get("edges") or []:
        if len(edge["vertices"]) != 2:
            continue
        points = [vertex["position"] for vertex in edge["vertices"]]
        lines.append(LineString([(point["x"], point["y"]) for point in points]))
    boundary = max(polygonize(lines), key=lambda item: item.area, default=None)
    return list(boundary.exterior.coords) if boundary else None


def fetch_model(model_id, stop_prefixes, folder):
    raw = matterport(f'''{{ model(id:"{model_id}") {{
        id dimensionEstimates(units:metric) {{ areaIndoor }}
        geocoordinates {{ origin: geoLocationOf(modelLocation:{{x:0,y:0,z:0}}) {{ lat long }} }}
        rooms {{ id classifications {{ label }} dimensionEstimates(units:metric) {{ areaIndoor }}
          boundary {{ edges {{ vertices {{ position {{ x y }} }} }} }} }}
        locations {{ id position {{ x y }} neighbors room {{ id }} }}
    }} }}''')
    origin = raw["geocoordinates"]["origin"]
    sweeps = [
        {"id": sweep["id"], **sweep["position"], "neighbors": sweep["neighbors"],
         "room_id": (sweep.get("room") or {}).get("id")}
        for sweep in raw["locations"]
    ]
    stops = [next(s["id"] for s in sweeps if s["id"].startswith(prefix)) for prefix in stop_prefixes]
    ids = ",".join(map(json.dumps, dict.fromkeys(stops)))
    skyboxes = matterport(f'''{{ model(id:"{model_id}") {{
        panoLocations(ids:[{ids}]) {{ id skybox(resolution:"2k") {{ children }} }}
    }} }}''')["panoLocations"]
    cube_urls = {item["id"]: (item.get("skybox") or {}).get("children", []) for item in skyboxes}
    if any(len(cube_urls.get(sweep, [])) != 6 for sweep in stops):
        raise RuntimeError("Matterport did not return all six panorama faces for each tour stop.")
    folder.mkdir()

    def download(face):
        sweep, index, url = face
        try:
            with urlopen(url, timeout=35) as response:
                (folder / f"{sweep}_{index}.jpg").write_bytes(response.read())
        except (URLError, TimeoutError):
            raise RuntimeError("A Matterport panorama face could not be downloaded.") from None

    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(download, ((sweep, index, url) for sweep, urls in cube_urls.items()
                                 for index, url in enumerate(urls))))
    rooms = [
        {"id": room["id"], "type": (room.get("classifications") or [{}])[0].get("label") or "Unlabelled",
         "polygon": room_polygon(room),
         "area_sqft": round(((room.get("dimensionEstimates") or {}).get("areaIndoor") or 0) * 10.7639, 1)}
        for room in raw["rooms"]
    ]
    return {"id": raw["id"], "area_indoor_sqft": round(raw["dimensionEstimates"]["areaIndoor"] * 10.7639),
            "geo": {"origin": [float(origin["long"]), float(origin["lat"])]}, "rooms": rooms, "sweeps": sweeps}


def fetch_aerial(bounds, path):
    west, south, east, north = bounds
    extent = f"POLYGON(({west} {south},{east} {south},{east} {north},{west} {north},{west} {south}))"
    image = post("https://api.vexcelgroup.com/v2/ortho/extract", {
        "wkt": extent, "srid": 4326, "layer": "urban", "collection": "us-tx-pearland-2026",
        "buffer-meter": 0, "crop": "bounding_box", "image-format": "jpeg", "destination-dimensions": "1600,1100",
    }, {"X-API-KEY": setting("VEXCEL_API_KEY")}, "Vexcel")
    xmp = re.search(rb"<x:xmpmeta.*?</x:xmpmeta>", image, re.S)
    metadata = dict(re.findall(r"<Vexcel:([\w-]+)>(.*?)</Vexcel:", xmp[0].decode(), re.S)) if xmp else {}
    if not metadata.get("geometry") or not metadata.get("last-capture-date"):
        raise RuntimeError("The Vexcel image did not include its capture date and map bounds.")
    path.write_bytes(image)
    return {"bounds": loads(metadata["geometry"]).bounds, "captured": metadata["last-capture-date"]}
