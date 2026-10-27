# Build the GRIDLOCK road graph from an Overpass GeoJSON export.
import json, math, sys, collections, bisect

SRC = sys.argv[1] if len(sys.argv) > 1 else 'data/export.geojson'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'data/graph.json'
d = json.load(open(SRC))
F = d['features']

LAT0, LON0 = 43.775, -79.23
KX = math.cos(math.radians(LAT0)) * 111320.0
KY = 110574.0
def proj(lon, lat): return ((lon - LON0) * KX, -(lat - LAT0) * KY)

CLS = {'motorway': 0, 'trunk': 0, 'motorway_link': 1, 'trunk_link': 1, 'primary': 2, 'primary_link': 2,
       'secondary': 3, 'secondary_link': 3, 'tertiary': 4, 'tertiary_link': 4, 'unclassified': 5, 'residential': 5}
DEF_SPEED = {0: 100, 1: 60, 2: 60, 3: 50, 4: 50, 5: 40}
DEF_LANES = {0: 3, 1: 1, 2: 2, 3: 2, 4: 1, 5: 1}

ways = [f for f in F if f['geometry']['type'] == 'LineString' and f['properties'].get('highway') in CLS]
pts = [f for f in F if f['geometry']['type'] == 'Point']

def line_fn(name, key):
    """Return interpolation fn along a named road: key='lat' -> lon(lat); key='lon' -> lat(lon)."""
    p = []
    for f in ways:
        if f['properties'].get('name') == name:
            for lon, lat in f['geometry']['coordinates']: p.append((lat, lon) if key == 'lat' else (lon, lat))
    p.sort()
    ks = [a for a, b in p]; vs = [b for a, b in p]
    def fn(k):
        i = bisect.bisect_left(ks, k)
        if i <= 0: return vs[0]
        if i >= len(ks): return vs[-1]
        return vs[i - 1] + (vs[i] - vs[i - 1]) * (k - ks[i - 1]) / ((ks[i] - ks[i - 1]) or 1e-9)
    return fn
vicpark = line_fn('Victoria Park Avenue', 'lat')
steeles = line_fn('Steeles Avenue East', 'lon')
ROUGE = [(43.60, -79.112), (43.787, -79.116), (43.800, -79.125), (43.8175, -79.1372), (43.832, -79.1597), (43.845, -79.1702), (43.90, -79.1702)]
def rouge(lat):
    for i in range(len(ROUGE) - 1):
        a, b = ROUGE[i], ROUGE[i + 1]
        if a[0] <= lat <= b[0]: return a[1] + (b[1] - a[1]) * (lat - a[0]) / (b[0] - a[0])
    return ROUGE[-1][1]
def inside(lon, lat):
    return lon >= vicpark(lat) - 0.0009 and lat <= steeles(lon) + 0.0007 and lon <= rouge(lat)

# ---- node ids by exact coordinate
nid = {}; NX = []; NY = []; NLL = []
def node(c):
    k = (c[0], c[1])
    if k not in nid:
        nid[k] = len(NX); x, y = proj(*k); NX.append(x); NY.append(y); NLL.append(k)
    return nid[k]
use = collections.Counter()
W = []
for f in ways:
    p = f['properties']; cls = CLS[p['highway']]
    seq = [node(c) for c in f['geometry']['coordinates']]
    W.append((p, cls, seq))
    for i, n in enumerate(seq): use[n] += 2 if i in (0, len(seq) - 1) else 1
isIn = [inside(*NLL[i]) for i in range(len(NX))]

def parse_speed(s, cls):
    if not s: return DEF_SPEED[cls]
    try:
        if 'mph' in s: return round(float(s.split()[0]) * 1.609)
        return int(float(s.split(';')[0]))
    except Exception: return DEF_SPEED[cls]
def parse_int(s, dflt):
    try: return max(1, int(float(str(s).split(';')[0])))
    except Exception: return dflt

names = []; nameIdx = {}
def name_id(n):
    if n is None: return -1
    if n not in nameIdx: nameIdx[n] = len(names); names.append(n)
    return nameIdx[n]

# ---- split ways at junctions, crop
segs = []   # (a, b, poly(node list), props..)
boundary = set()
for p, cls, seq in W:
    # crop: split into inside runs
    runs = []; cur = []
    for n in seq:
        if isIn[n]: cur.append(n)
        else:
            if cur: runs.append((cur, True)); cur = []
            runs.append((None, False))
    if cur: runs.append((cur, True))
    # identify boundary nodes: inside node adjacent to outside node on this way
    for i, n in enumerate(seq):
        if isIn[n] and ((i > 0 and not isIn[seq[i - 1]]) or (i < len(seq) - 1 and not isIn[seq[i + 1]])): boundary.add(n)
    for run, ok in runs:
        if not ok or len(run) < 2: continue
        start = 0
        for i in range(1, len(run)):
            n = run[i]
            if i == len(run) - 1 or use[n] >= 2 or n in boundary:
                segs.append((run[start], n, run[start:i + 1], p, cls)); start = i

# ---- graph nodes = segment endpoints
gid = {}
def g(n):
    if n not in gid: gid[n] = len(gid)
    return gid[n]
edges = []
def rdp(poly, eps):
    if len(poly) < 3: return poly
    ax, ay = NX[poly[0]], NY[poly[0]]; bx, by = NX[poly[-1]], NY[poly[-1]]
    vx, vy = bx - ax, by - ay; L = math.hypot(vx, vy) or 1e-9
    dm, im = -1, 0
    for i in range(1, len(poly) - 1):
        px, py = NX[poly[i]], NY[poly[i]]
        dd = abs((px - ax) * vy - (py - ay) * vx) / L
        if dd > dm: dm, im = dd, i
    if dm > eps: return rdp(poly[:im + 1], eps)[:-1] + rdp(poly[im:], eps)
    return [poly[0], poly[-1]]

geo = []  # flat list of x,y for undirected segment polylines
for a, b, poly, p, cls in segs:
    if a == b: continue
    poly = rdp(poly, 1.5)
    L = sum(math.hypot(NX[poly[i + 1]] - NX[poly[i]], NY[poly[i + 1]] - NY[poly[i]]) for i in range(len(poly) - 1))
    if L < 0.5: continue
    go = len(geo) // 2
    for n in poly: geo += [round(NX[n], 1), round(NY[n], 1)]
    gc = len(poly)
    ow = p.get('oneway'); hw = p.get('highway')
    oneway = ow in ('yes', 'true', '1') or (hw in ('motorway', 'motorway_link') and ow != 'no')
    rev = ow == '-1'
    lanes = parse_int(p.get('lanes'), None)
    lf = parse_int(p.get('lanes:forward'), None); lb = parse_int(p.get('lanes:backward'), None)
    spd = parse_speed(p.get('maxspeed'), cls)
    base = dict(cls=cls, spd=spd, name=name_id(p.get('name')), lit=1 if p.get('lit') == 'yes' or cls <= 3 else 0,
                bridge=1 if p.get('bridge') else 0, L=L, go=go, gc=gc)
    def mk(fwd, nl):
        e = dict(base); e['a'] = g(a) if fwd else g(b); e['b'] = g(b) if fwd else g(a); e['rev'] = 0 if fwd else 1
        e['lanes'] = max(1, min(4, nl)); edges.append(e)
    if oneway or rev:
        nl = lanes or DEF_LANES[cls]
        mk(not rev, nl)
    else:
        if lf and lb: nf, nb = lf, lb
        elif lanes: nf = nb = max(1, lanes // 2)
        else: nf = nb = DEF_LANES[cls]
        mk(True, nf); mk(False, nb)

GN = len(gid)
inv = [0] * GN
for n, i in gid.items(): inv[i] = n
GX = [NX[inv[i]] for i in range(GN)]; GY = [NY[inv[i]] for i in range(GN)]

# ---- portals: boundary nodes with edges
portal_nodes = set(gid[n] for n in boundary if n in gid)
# SCC with a virtual outside node linked both ways to all portals
OUTN = GN
adj = collections.defaultdict(list); radj = collections.defaultdict(list)
for i, e in enumerate(edges): adj[e['a']].append(e['b']); radj[e['b']].append(e['a'])
for p in portal_nodes: adj[OUTN].append(p); adj[p].append(OUTN); radj[p].append(OUTN); radj[OUTN].append(p)
def reach(start, A):
    seen = {start}; st = [start]
    while st:
        u = st.pop()
        for v in A[u]:
            if v not in seen: seen.add(v); st.append(v)
    return seen
# largest SCC containing the node set of the main network: use outside if any portals, else node 0
fw = reach(OUTN, adj); bw = reach(OUTN, radj)
keep = (fw & bw) - {OUTN}
print('graph nodes', GN, 'kept', len(keep), 'edges', len(edges), file=sys.stderr)
remap = {}
for i in range(GN):
    if i in keep: remap[i] = len(remap)
edges = [e for e in edges if e['a'] in remap and e['b'] in remap]
for e in edges: e['a'] = remap[e['a']]; e['b'] = remap[e['b']]
GX = [GX[i] for i in sorted(remap, key=remap.get)]; GY = [GY[i] for i in sorted(remap, key=remap.get)]
GLL = [NLL[inv[i]] for i in sorted(remap, key=remap.get)]
portal_nodes = set(remap[p] for p in portal_nodes if p in remap)
GN = len(GX)

out_e = collections.defaultdict(list); in_e = collections.defaultdict(list)
for i, e in enumerate(edges): out_e[e['a']].append(i); in_e[e['b']].append(i)

def nearest_node(x, y, maxd=1e9, pred=None):
    best, bd = -1, maxd * maxd
    for i in range(GN):
        if pred and not pred(i): continue
        dd = (GX[i] - x) ** 2 + (GY[i] - y) ** 2
        if dd < bd: bd, best = dd, i
    return best

# ---- signals: map points to nearest graph node, cluster into controllers
sigpts = [proj(*f['geometry']['coordinates']) for f in pts if f['properties'].get('highway') == 'traffic_signals']
grid = collections.defaultdict(list)
for i in range(GN): grid[(int(GX[i] // 50), int(GY[i] // 50))].append(i)
def near(x, y, r):
    out = []
    for gx in range(int((x - r) // 50), int((x + r) // 50) + 1):
        for gy in range(int((y - r) // 50), int((y + r) // 50) + 1):
            for i in grid.get((gx, gy), ()):
                if (GX[i] - x) ** 2 + (GY[i] - y) ** 2 <= r * r: out.append(i)
    return out
sigNode = set()
for x, y in sigpts:
    c = near(x, y, 30)
    # only nodes that are junctions (degree >= 3 counting both directions)
    c = [i for i in c if len(set([edges[k]['b'] for k in out_e[i]] + [edges[k]['a'] for k in in_e[i]])) >= 3]
    if c: sigNode.add(min(c, key=lambda i: (GX[i] - x) ** 2 + (GY[i] - y) ** 2))
# cluster signalised nodes within 40 m, connected by edges
par = {i: i for i in sigNode}
def find(i):
    while par[i] != i: par[i] = par[par[i]]; i = par[i]
    return i
for i in sigNode:
    for j in near(GX[i], GY[i], 42):
        if j in sigNode and j != i: par[find(i)] = find(j)
clusters = collections.defaultdict(list)
for i in sigNode: clusters[find(i)].append(i)
ctrls = []; nodeCtrl = [-1] * GN
for ns in clusters.values():
    cid = len(ctrls); ctrls.append({'nodes': ns})
    for n in ns: nodeCtrl[n] = cid
def bearing_in(ei):
    e = edges[ei]; go, gc = e['go'], e['gc']
    if e['rev']: x1, y1, x0, y0 = geo[go * 2], geo[go * 2 + 1], geo[go * 2 + 2], geo[go * 2 + 3]
    else: x0, y0, x1, y1 = geo[(go + gc - 2) * 2], geo[(go + gc - 2) * 2 + 1], geo[(go + gc - 1) * 2], geo[(go + gc - 1) * 2 + 1]
    return math.atan2(y1 - y0, x1 - x0)
edgeCtrl = [-1] * len(edges); edgeGroup = [0] * len(edges)
for cid, c in enumerate(ctrls):
    S = set(c['nodes'])
    appr = [k for n in S for k in in_e[n] if edges[k]['a'] not in S]
    if not appr: continue
    top = min(appr, key=lambda k: (edges[k]['cls'], -edges[k]['lanes']))
    ax = bearing_in(top)
    w = [0.0, 0.0]
    for k in appr:
        dd = abs((bearing_in(k) - ax + math.pi / 2) % math.pi - math.pi / 2)
        grp = 0 if dd < math.pi / 4 else 1
        edgeCtrl[k] = cid; edgeGroup[k] = grp
        w[grp] += edges[k]['lanes'] * (6 - edges[k]['cls'])
    c['split'] = round(max(0.3, min(0.72, w[0] / (w[0] + w[1] or 1))), 2) if w[1] > 0 else 1.0
    cx = sum(GX[n] for n in S) / len(S); cy = sum(GY[n] for n in S) / len(S)
    c['x'] = round(cx, 1); c['y'] = round(cy, 1)
    c['cls'] = min(edges[k]['cls'] for k in appr)

# ---- stop signs: mark incoming edge at nearest junction
stopEdge = [0] * len(edges)
for f in pts:
    if f['properties'].get('highway') != 'stop': continue
    x, y = proj(*f['geometry']['coordinates'])
    c = near(x, y, 25)
    c = [i for i in c if len(in_e[i]) >= 2 and nodeCtrl[i] < 0]
    if not c: continue
    n = min(c, key=lambda i: (GX[i] - x) ** 2 + (GY[i] - y) ** 2)
    # incoming edge whose approach passes closest to the stop point
    best, bd = None, 1e18
    for k in in_e[n]:
        e = edges[k]; go, gc = e['go'], e['gc']
        idx = go if e['rev'] else go + gc - 1
        idx2 = go + 1 if e['rev'] else go + gc - 2
        mx, my = (geo[idx * 2] + geo[idx2 * 2]) / 2, (geo[idx * 2 + 1] + geo[idx2 * 2 + 1]) / 2
        dd = (mx - x) ** 2 + (my - y) ** 2
        if dd < bd: bd, best = dd, k
    if best is not None:
        others = [edges[k]['cls'] for k in in_e[n] if k != best and edges[k]['a'] != edges[best]['b']]
        if others and edges[best]['cls'] < max(others): continue   # stop signs face the minor road
        if edges[best]['cls'] <= 2: continue
        stopEdge[best] = 1
# implicit yield: minor road into a node that also has a clearly bigger road, no signal
for n in range(GN):
    if nodeCtrl[n] >= 0: continue
    ins = in_e[n]
    if len(ins) < 2: continue
    mc = min(edges[k]['cls'] for k in ins)
    for k in ins:
        if edges[k]['cls'] >= mc + 1 and edges[k]['cls'] >= 4 and not stopEdge[k] and edges[k]['cls'] != 1: stopEdge[k] = 2

# ---- underpasses: non-bridge arterial edge passing under a bridge
bridgeSegs = []
for e in edges:
    if e['bridge']:
        go, gc = e['go'], e['gc']
        for i in range(gc - 1): bridgeSegs.append((geo[(go + i) * 2], geo[(go + i) * 2 + 1], geo[(go + i + 1) * 2], geo[(go + i + 1) * 2 + 1], e['name']))
def segx(a, b):
    (x1, y1, x2, y2), (x3, y3, x4, y4) = a, b
    d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3)
    if abs(d) < 1e-9: return False
    t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d; u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d
    return 0 <= t <= 1 and 0 <= u <= 1
under = [0] * len(edges)
for k, e in enumerate(edges):
    if e['bridge'] or e['cls'] > 4 or e['cls'] <= 1: continue
    go, gc = e['go'], e['gc']
    for i in range(gc - 1):
        s = (geo[(go + i) * 2], geo[(go + i) * 2 + 1], geo[(go + i + 1) * 2], geo[(go + i + 1) * 2 + 1])
        if any(b[4] != e['name'] and segx(s, b[:4]) for b in bridgeSegs): under[k] = 1; break

# ---- named intersections
byName = collections.defaultdict(set)
for k, e in enumerate(edges):
    if e['name'] >= 0: byName[names[e['name']]].update((e['a'], e['b']))
def X(a, b, dx=0, dy=0):
    A, B = byName.get(a, set()), byName.get(b, set())
    both = A & B
    if both: n = min(both)
    else:
        best, bd = None, 1e18
        for i in A:
            for j in B:
                dd = (GX[i] - GX[j]) ** 2 + (GY[i] - GY[j]) ** 2
                if dd < bd: bd, best = dd, (i, j)
        if not best or bd > 250 ** 2: print('missing', a, b, file=sys.stderr); return None
        n = best[0]
    return (round(GX[n] + dx, 1), round(GY[n] + dy, 1))
R = 'Road'; A = 'Avenue'
HOODS = [
    ("Steeles", 'Midland Avenue', 'Steeles Avenue East', 0, 700), ("L'Amoreaux", 'Birchmount Road', 'Finch Avenue East', 0, -500),
    ("Tam O'Shanter", 'Pharmacy Avenue', 'Sheppard Avenue East', 300, 0), ('Agincourt North', 'Brimley Road', 'Finch Avenue East', 0, -400),
    ('Agincourt', 'Midland Avenue', 'Sheppard Avenue East', 0, 0), ('Milliken', 'McCowan Road', 'McNicoll Avenue', 0, -200),
    ('Malvern', 'Neilson Road', 'Finch Avenue East', 300, 300), ('Rouge', 'Meadowvale Road', 'Sheppard Avenue East', -400, -900),
    ('Wexford', 'Pharmacy Avenue', 'Lawrence Avenue East', 0, -500), ('Dorset Park', 'Kennedy Road', 'Ellesmere Road', 300, 600),
    ('Bendale', 'Brimley Road', 'Lawrence Avenue East', 300, -100), ('Woburn', 'Markham Road', 'Ellesmere Road', 0, -200),
    ('Morningside', 'Morningside Avenue', 'Ellesmere Road', -300, 600), ('West Hill', 'Morningside Avenue', 'Kingston Road', 0, -500),
    ('Highland Creek', 'Military Trail', 'Ellesmere Road', 900, 500), ('Centennial', 'Port Union Road', 'Lawrence Avenue East', 300, 0),
    ('Guildwood', 'Guildwood Parkway', 'Kingston Road', 0, 600), ('Scarborough Village', 'Markham Road', 'Kingston Road', -600, -500),
    ('Eglinton East', 'McCowan Road', 'Eglinton Avenue East', 0, -200), ('Kennedy Park', 'Kennedy Road', 'Eglinton Avenue East', 300, 700),
    ('Ionview', 'Birchmount Road', 'Eglinton Avenue East', 300, -600), ('Clairlea', 'Pharmacy Avenue', 'Eglinton Avenue East', 0, 300),
    ('Oakridge', 'Victoria Park Avenue', 'Danforth Avenue', 900, -200), ('Birch Cliff', 'Birchmount Road', 'Kingston Road', -300, 300),
    ('Cliffcrest', 'Brimley Road', 'Kingston Road', 0, 500), ('Cedarbrae', 'Markham Road', 'Lawrence Avenue East', 0, 300),
]
hoods = []
for nm, a, b, dx, dy in HOODS:
    p = X(a, b, dx, -dy)
    if p: hoods.append({'n': nm, 'x': p[0], 'y': p[1]})
nodeHood = []
for i in range(GN):
    best, bd = 0, 1e18
    for h, H in enumerate(hoods):
        dd = (GX[i] - H['x']) ** 2 + (GY[i] - H['y']) ** 2
        if dd < bd: bd, best = dd, h
    nodeHood.append(best)

PLACES = [  # name, short, type, a, b, dx, dy(north+), weight
    ('Scarborough Town Centre', 'STC', 'mall', 'McCowan Road', 'Ellesmere Road', -450, 450, 10),
    ('Kennedy Station', 'Kennedy Stn', 'transit', 'Kennedy Road', 'Eglinton Avenue East', 0, 0, 8),
    ('Warden Station', 'Warden Stn', 'transit', 'Warden Avenue', 'St Clair Avenue East', 0, 0, 5),
    ('Pacific Mall', 'Pacific Mall', 'mall', 'Kennedy Road', 'Steeles Avenue East', 0, -200, 4),
    ('Agincourt Mall', 'Agincourt Mall', 'mall', 'Kennedy Road', 'Sheppard Avenue East', 200, 0, 3),
    ('U of T Scarborough', 'UTSC', 'school', 'Military Trail', 'Ellesmere Road', 300, -200, 6),
    ('Centennial College', 'Centennial', 'school', 'Progress Avenue', 'Markham Road', 500, 0, 5),
    ('Scarborough General Hospital', 'General', 'hospital', 'McCowan Road', 'Lawrence Avenue East', 500, 0, 4),
    ('Birchmount Hospital', 'Birchmount Hosp', 'hospital', 'Birchmount Road', 'Finch Avenue East', 0, 0, 3),
    ('Centenary Hospital', 'Centenary', 'hospital', 'Neilson Road', 'Ellesmere Road', 0, 0, 3),
    ('Cedarbrae Mall', 'Cedarbrae', 'mall', 'Markham Road', 'Lawrence Avenue East', 0, 0, 2),
    ('Malvern Town Centre', 'Malvern TC', 'mall', 'Neilson Road', 'Finch Avenue East', 300, 400, 2),
    ('Golden Mile', 'Golden Mile', 'jobs', 'Warden Avenue', 'Eglinton Avenue East', 300, 0, 6),
    ('Progress Business Park', 'Progress Park', 'jobs', 'Midland Avenue', 'Progress Avenue', 0, 0, 6),
    ('Milner Business Park', 'Milner Park', 'jobs', 'Markham Road', 'Milner Avenue', 0, 0, 6),
    ('Tapscott Industrial', 'Tapscott', 'jobs', 'Tapscott Road', 'Finch Avenue East', 0, 600, 4),
    ('Consilium Place', 'Consilium', 'jobs', 'McCowan Road', 'Ellesmere Road', 0, 900, 4),
    ("Bluffer's Park", "Bluffer's Park", 'park', 'Brimley Road', 'Kingston Road', 0, -1400, 0),
    ('Toronto Zoo', 'Toronto Zoo', 'park', 'Meadowvale Road', 'Sheppard Avenue East', 0, 500, 0),
]
places = []
for nm, s, t, a, b, dx, dy, w in PLACES:
    p = X(a, b, dx, -dy)
    if p: places.append({'n': nm, 's': s, 't': t, 'x': p[0], 'y': p[1], 'w': w})
DEPOTS = [  # kind, name, a, b, dx, dy
    ('police', '41 Division', 'Birchmount Road', 'Eglinton Avenue East', 300, 0), ('police', '42 Division', 'Markham Road', 'Milner Avenue', -200, 0),
    ('police', '43 Division', 'Morningside Avenue', 'Lawrence Avenue East', 300, 0), ('hydro', 'Toronto Hydro yard', 'Markham Road', 'Milner Avenue', 600, 100),
    ('water', 'Toronto Water yard', 'Midland Avenue', 'Ellesmere Road', 300, 200), ('tow', 'Tow yard', 'Kennedy Road', 'Progress Avenue', -300, 0),
    ('tow', 'Tow yard', 'Warden Avenue', 'Eglinton Avenue East', 0, -200), ('tow', 'Tow yard', 'Markham Road', 'Sheppard Avenue East', 0, 200),
    ('ems', 'EMS Station', 'Kennedy Road', 'Sheppard Avenue East', 0, -300), ('ems', 'EMS Station', 'McCowan Road', 'Eglinton Avenue East', 0, 300),
    ('ems', 'EMS Station', 'Morningside Avenue', 'Sheppard Avenue East', 0, -300), ('ems', 'EMS Station', 'Warden Avenue', 'Lawrence Avenue East', 0, 0),
    ('fire', 'Fire Hall', 'Kennedy Road', 'Sheppard Avenue East', 300, -200), ('fire', 'Fire Hall', 'Midland Avenue', 'Ellesmere Road', 0, -300),
    ('fire', 'Fire Hall', 'McCowan Road', 'Lawrence Avenue East', -300, 0), ('fire', 'Fire Hall', 'Markham Road', 'Finch Avenue East', 0, 300),
    ('fire', 'Fire Hall', 'Morningside Avenue', 'Sheppard Avenue East', 300, 0), ('fire', 'Fire Hall', 'Brimley Road', 'Kingston Road', 0, 400),
    ('fire', 'Fire Hall', 'Warden Avenue', 'St Clair Avenue East', 0, 400), ('fire', 'Fire Hall', 'Pharmacy Avenue', 'Lawrence Avenue East', 0, 300),
    ('opp', 'OPP Highway Patrol', 'Kennedy Road', 'Highway 401 Collector', 0, 0), ('opp', 'OPP Highway Patrol', 'Morningside Avenue', 'Highway 401 Collector', 0, 0),
    ('opp', 'OPP Highway Patrol', 'Victoria Park Avenue', 'Highway 401 Collector', 0, 0),
]
depots = []
for k, nm, a, b, dx, dy in DEPOTS:
    p = X(a, b, dx, -dy)
    if p: depots.append({'k': k, 'n': nm, 'x': p[0], 'y': p[1]})

# ---- portals grouped
pl = []
for p in portal_nodes:
    ins = [k for k in in_e[p]]; outs = [k for k in out_e[p]]
    cls = min([edges[k]['cls'] for k in ins + outs] or [5])
    if cls >= 5: continue  # residential crossings stay quiet
    nm = next((names[edges[k]['name']] for k in ins + outs if edges[k]['name'] >= 0), '')
    lon, lat = GLL[p]
    side = 'W' if lon < vicpark(lat) + 0.002 else ('N' if lat > steeles(lon) - 0.002 else 'E')
    pl.append((p, cls, nm, side))
groups = []
for p, cls, nm, side in sorted(pl, key=lambda t: t[1]):
    for G in groups:
        if G['side'] == side and (G['name'] == nm or (GX[G['nodes'][0]] - GX[p]) ** 2 + (GY[G['nodes'][0]] - GY[p]) ** 2 < 350 ** 2):
            G['nodes'].append(p); break
    else: groups.append({'side': side, 'name': nm, 'cls': cls, 'nodes': [p]})
for G in groups:
    G['src'] = [n for n in G['nodes'] if out_e[n]]; G['snk'] = [n for n in G['nodes'] if in_e[n]]
    G['w'] = {0: 14, 1: 2, 2: 4, 3: 2.5, 4: 1}[G['cls']] * (1.6 if G['side'] == 'W' else 1)
    G['x'] = round(sum(GX[n] for n in G['nodes']) / len(G['nodes']), 1); G['y'] = round(sum(GY[n] for n in G['nodes']) / len(G['nodes']), 1)
groups = [G for G in groups if G['src'] and G['snk']]
print('portals', [(G['side'], G['name'], len(G['nodes'])) for G in groups], file=sys.stderr)

# ---- shoreline: southern envelope of road nodes
xs = sorted(GX); x0, x1 = xs[0], xs[-1]
bins = {}
for i in range(GN):
    b = int((GX[i] - x0) // 150)
    bins[b] = max(bins.get(b, -1e9), GY[i])
shore = []
nb = int((x1 - x0) // 150) + 1
vals = [bins.get(b) for b in range(nb)]
# fill gaps and smooth
for b in range(nb):
    if vals[b] is None:
        l = next((vals[j] for j in range(b, -1, -1) if vals[j] is not None), None); r = next((vals[j] for j in range(b, nb) if vals[j] is not None), None)
        vals[b] = l if r is None else r if l is None else (l + r) / 2
sm = []
for b in range(nb):
    win = [vals[j] for j in range(max(0, b - 2), min(nb, b + 3))]
    sm.append(max(win) + 160)
# only treat as lake where southern edge is south of Kingston Rd belt (y > ~ -?) -> keep all; the lake polygon is drawn below
swi = max(range(GN), key=lambda i: GY[i]); swX, swY = GX[swi], GY[swi]
rx, ry = proj(-79.1175, 43.7925)
shore = [[round(x0 + b * 150, 0), round(v, 0)] for b, v in enumerate(sm) if swX - 1 <= x0 + b * 150 <= rx]
shore = [[round(swX - 4000), round(swY + 900)], [round(swX), round(swY + 160)]] + shore + [[round(rx), round(ry + 120)], [round(rx + 6000), round(ry - 2300)]]

# ---- real traffic counts (City of Toronto turning-movement counts, most recent per location)
import csv, os
counts = []; hoodHeavy = [[] for _ in hoods]; splitsFromCounts = 0
TMC = 'data/tmc/tmc.csv'
if os.path.exists(TMC):
    nodeGrid = collections.defaultdict(list)
    for i in range(GN): nodeGrid[(int(GX[i] // 100), int(GY[i] // 100))].append(i)
    best_for_ctrl = {}
    for row in csv.DictReader(open(TMC, encoding='utf-8-sig')):
        try: lon, lat = float(row['longitude']), float(row['latitude'])
        except ValueError: continue
        if not inside(lon, lat): continue
        yr = int((row['latest_count_date'] or '0')[:4] or 0)
        if yr < 2010: continue
        x, y = proj(lon, lat); bn, bd = -1, 60.0
        for gx in range(int(x // 100) - 1, int(x // 100) + 2):
            for gy in range(int(y // 100) - 1, int(y // 100) + 2):
                for i in nodeGrid.get((gx, gy), ()):
                    d = math.hypot(GX[i] - x, GY[i] - y)
                    if d < bd: bd, bn = d, i
        if bn < 0: continue
        num = lambda k: float(row[k]) if row.get(k) not in (None, '') else 0.0
        rec = {'n': row['location_name'], 'node': bn, 'ctrl': nodeCtrl[bn], 'am': int(num('am_peak_vehicle')), 'pm': int(num('pm_peak_vehicle')), 'date': row['latest_count_date'],
               'heavy': round(num('am_peak_heavy_pct'), 3), 'ped': int(num('total_pedestrian')), 'bike': int(num('total_bike')), 'tot': int(num('total_vehicle')),
               'appr': {k: num(k + '_appr_vehicle') for k in 'nesw'}}
        rec['i'] = len(counts); counts.append(rec)
        hoodHeavy[nodeHood[bn]].append(rec['heavy'])
        c = nodeCtrl[bn]
        if c >= 0 and (c not in best_for_ctrl or rec['date'] > best_for_ctrl[c]['date']): best_for_ctrl[c] = rec
    for c, rec in best_for_ctrl.items():
        S = set(ctrls[c]['nodes']); appr = [k for n in S for k in in_e[n] if edges[k]['a'] not in S]
        g = [set(), set()]
        for k in appr:
            a = bearing_in(k)
            d = 'n' if abs(a - math.pi / 2) < math.pi / 4 else 's' if abs(a + math.pi / 2) < math.pi / 4 else 'w' if abs(a) <= math.pi / 4 else 'e'
            g[edgeGroup[k]].add(d)
        v0 = sum(rec['appr'][d] for d in g[0]); v1 = sum(rec['appr'][d] for d in g[1])
        if v0 > 0 and v1 > 0:
            ctrls[c]['split'] = round(max(0.28, min(0.76, v0 / (v0 + v1))), 2); splitsFromCounts += 1
        ctrls[c]['count'] = rec['i']
print('counts kept', len(counts), 'signal splits from counts', splitsFromCounts, file=sys.stderr)
hoodHeavyAvg = [round(sum(v) / len(v), 3) if v else 0.05 for v in hoodHeavy]
for rec in counts: rec.pop('appr', None); rec.pop('i', None)

def r1(v): return round(v, 1)
out = {
    'proj': {'lat0': LAT0, 'lon0': LON0, 'kx': KX, 'ky': KY},
    'nx': [r1(v) for v in GX], 'ny': [r1(v) for v in GY], 'hood': nodeHood, 'ctrlOf': nodeCtrl,
    'ea': [e['a'] for e in edges], 'eb': [e['b'] for e in edges], 'len': [r1(e['L']) for e in edges],
    'lanes': [e['lanes'] for e in edges], 'spd': [e['spd'] for e in edges], 'cls': [e['cls'] for e in edges],
    'name': [e['name'] for e in edges], 'lit': [e['lit'] for e in edges], 'bridge': [e['bridge'] for e in edges],
    'go': [e['go'] for e in edges], 'gc': [e['gc'] for e in edges], 'rev': [e['rev'] for e in edges],
    'ctrl': edgeCtrl, 'grp': edgeGroup, 'stop': stopEdge, 'under': under,
    'geo': geo, 'names': names,
    'ctrls': [{'x': c.get('x', GX[c['nodes'][0]]), 'y': c.get('y', GY[c['nodes'][0]]), 'split': c.get('split', 0.5), 'cls': c.get('cls', 3), 'nodes': c['nodes'], 'count': c.get('count', -1)} for c in ctrls],
    'counts': counts, 'hoodHeavy': hoodHeavyAvg,
    'hoods': hoods, 'places': places, 'depots': depots,
    'portals': [{'side': G['side'], 'name': G['name'], 'cls': G['cls'], 'src': G['src'], 'snk': G['snk'], 'w': G['w'], 'x': G['x'], 'y': G['y']} for G in groups],
    'shore': shore,
}
json.dump(out, open(OUT, 'w'), separators=(',', ':'))
print('nodes', GN, 'edges', len(edges), 'ctrls', len(ctrls), 'stops', sum(1 for s in stopEdge if s == 1), 'yields', sum(1 for s in stopEdge if s == 2),
      'under', sum(under), 'geo pts', len(geo) // 2, file=sys.stderr)
