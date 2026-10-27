"""Place Scarborough fire / medical calls without an outside geocoder.

Toronto Fire lists calls by street names ("SHEPPARD AVE E, SC" / "BRIMLEY RD"), and medical calls only by
postal area (FSA, e.g. "M1B") for privacy. Nominatim misses most intersections and all postal areas, so:
  - intersections: where the two named streets meet in GRIDLOCK's own road graph (game/data/graph.json)
  - postal areas: a fixed point among the area's homes/schools (gridlock_static.json "fsa"), flagged approximate
Outside Scarborough this returns None and the caller falls back to Nominatim.
"""
import json
import os
import re
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
GRAPH = os.path.join(HERE, "..", "game", "data", "graph.json")
DATA = os.environ.get("GRIDLOCK_DATA") or os.path.join(HERE, "..", "data")
ABBR = {"AVENUE": "AVE", "ROAD": "RD", "STREET": "ST", "DRIVE": "DR", "BOULEVARD": "BLVD", "CRESCENT": "CRES", "COURT": "CRT",
        "PLACE": "PL", "TRAIL": "TRL", "CIRCLE": "CIR", "SQUARE": "SQ", "PARKWAY": "PKWY", "TERRACE": "TERR", "GARDENS": "GDNS",
        "HEIGHTS": "HTS", "GATE": "GT", "GROVE": "GRV", "LANE": "LANE", "EAST": "E", "WEST": "W", "NORTH": "N", "SOUTH": "S", "SAINT": "ST"}
_nodes = None  # street name → set of node ids
_xy = None
_fsa = None


def norm(s):
    s = re.sub(r"[^A-Z0-9 ]", " ", (s or "").upper().split(",")[0])
    return " ".join(ABBR.get(w, w) for w in s.split())


def _load():
    global _nodes, _xy
    if _nodes is not None:
        return
    _nodes, _xy = {}, None
    try:
        g = json.load(open(GRAPH))
    except OSError:
        return
    P = g["proj"]
    _xy = [(P["lat0"] - y / P["ky"], P["lon0"] + x / P["kx"]) for x, y in zip(g["nx"], g["ny"])]
    for e, ni in enumerate(g["name"]):
        if ni is None or ni < 0:
            continue
        k = norm(g["names"][ni])
        _nodes.setdefault(k, set()).update((g["ea"][e], g["eb"][e]))


def intersection(a, b):
    """(lat, lng) where streets a and b meet, or None."""
    _load()
    A, B = _nodes.get(norm(a)), _nodes.get(norm(b))
    if not A or not B:
        return None
    common = A & B
    if not common:  # divided roads / slight offsets: closest pair within ~60 m
        best = None
        for i in A:
            la, ga = _xy[i]
            for j in B:
                lb, gb = _xy[j]
                d = (la - lb) ** 2 + ((ga - gb) * 0.72) ** 2
                if best is None or d < best[0]:
                    best = (d, i, j)
        if best is None or best[0] > (60 / 111000) ** 2:
            return None
        common = {best[1], best[2]}
    lat = sum(_xy[i][0] for i in common) / len(common)
    lng = sum(_xy[i][1] for i in common) / len(common)
    return {"lat": round(lat, 6), "lng": round(lng, 6)}


def fsa_point(fsa, seed):
    """A fixed point inside a Scarborough postal area (same call → same point), or None."""
    global _fsa
    if _fsa is None:
        try:
            _fsa = json.load(open(os.path.join(DATA, "gridlock_static.json"))).get("fsa") or {}
        except (OSError, ValueError):
            _fsa = {}
    pts = _fsa.get((fsa or "").upper())
    if not pts:
        return None
    lat, lng = pts[zlib.crc32(str(seed).encode()) % len(pts)]
    return {"lat": lat, "lng": lng}
