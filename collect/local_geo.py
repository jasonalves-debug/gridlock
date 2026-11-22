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
        "HEIGHTS": "HTS", "GATE": "GT", "GROVE": "GRV", "LANE": "LANE", "EAST": "E", "WEST": "W", "NORTH": "N", "SOUTH": "S", "SAINT": "ST",
        # Toronto Fire spellings that differ from the road graph's
        "CRCL": "CIR", "CRCT": "CIRCUIT", "PTWY": "PATHWAY", "TER": "TERR"}
_nodes = None  # street name → set of node ids
_xy = None
_fsa = None


def norm(s):
    s = re.sub(r"[^A-Z0-9 ]", " ", (s or "").upper().split(",")[0])
    return " ".join(ABBR.get(w, w) for w in s.split())


def _graph():
    """The road graph: game/data/graph.json when it's been extracted, otherwise straight out of the built
    gridlock.html (game/data/ is git-ignored, so a fresh clone or GitHub Actions run doesn't have it)."""
    try:
        return json.load(open(GRAPH))
    except OSError:
        pass
    try:
        html = open(os.path.join(HERE, "..", "gridlock.html"), encoding="utf-8").read()
        m = re.search(r'<script id="graph" type="application/json">(.*?)</script>', html, re.S)
        return json.loads(m.group(1)) if m else None
    except OSError:
        return None


def _load():
    global _nodes, _xy
    if _nodes is not None:
        return
    _nodes, _xy = {}, None
    g = _graph()
    if not g:
        print("  [local_geo] no road graph found: Scarborough intersections will fall back to Nominatim")
        return
    P = g["proj"]
    _xy = [(P["lat0"] - y / P["ky"], P["lon0"] + x / P["kx"]) for x, y in zip(g["nx"], g["ny"])]
    for e, ni in enumerate(g["name"]):
        if ni is None or ni < 0:
            continue
        k = norm(g["names"][ni])
        _nodes.setdefault(k, set()).update((g["ea"][e], g["eb"][e]))


def _street(name, loose=False):
    """Node ids for a street; 'LAWRENCE AVE' with no direction matches 'LAWRENCE AVE E' / 'W'.
    loose: a bare name ('MANSE') matches any street that starts with it ('MANSE RD')."""
    k = norm(name)
    if k in _nodes:
        return _nodes[k]
    hit = set()
    for d in ("E", "W", "N", "S"):
        hit |= _nodes.get(f"{k} {d}", set())
    if not hit and loose and len(k) >= 4:
        for key, ids in _nodes.items():
            if key.startswith(k + " "):
                hit |= ids
    return hit or None


def street_point(name, max_km=1.2):
    """Middle of a short street (crescents, courts, side streets), for calls with no usable cross street.
    Long roads return None: their middle could be kilometres from the call."""
    _load()
    S = _street(name) if _nodes else None
    if not S:
        return None
    lats, lngs = [_xy[i][0] for i in S], [_xy[i][1] for i in S]
    if ((max(lats) - min(lats)) * 111) ** 2 + ((max(lngs) - min(lngs)) * 80) ** 2 > max_km ** 2:
        return None
    return {"lat": round(sum(lats) / len(lats), 6), "lng": round(sum(lngs) / len(lngs), 6)}


def walkway(text):
    """Toronto Fire walkway codes name the corner they're next to: 'WW E MANSE N LAWRENCE' = by Manse & Lawrence."""
    m = re.match(r"^(?:WW|LN)\s+(?:\d+\s+)?[NSEW]\s+(.+?)\s+[NSEW]\s+(.+)$", (text or "").strip().upper())
    return intersection(m.group(1), m.group(2), loose=True) if m else None


def intersection(a, b, loose=False):
    """(lat, lng) where streets a and b meet, or None."""
    _load()
    if not _nodes:
        return None
    A, B = _street(a, loose), _street(b, loose)
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
        if best is None or best[0] > (90 / 111000) ** 2:
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
