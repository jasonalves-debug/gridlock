"""Real buildings for the renderer: City of Toronto 3D Massing (2025), from the `assets` branch (collect/buildings.py, run in Actions),
turned into oriented boxes in map metres: each footprint's minimum-area rectangle, shrunk to the footprint's own area when it's an L or a U.
Writes geo/buildings.json: {"n": count, "b64": base64 of uint16 rows [x*2, y*2, angle*10000/pi, w*10, d*10, h*10] (x, y from the map origin + 16384 m)}
Usage: python tools/buildings.py <buildings.json from the assets branch>"""
import base64, json, math, struct, sys, time, os
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
g = json.load(open('data/graph.json')); P = g['proj']
xs, ys = g['nx'], g['ny']; X0, X1, Y0, Y1 = min(xs) - 300, max(xs) + 300, min(ys) - 300, max(ys) + 300
src = json.load(open(sys.argv[1])); rows = src['rows']; print(src['src'], len(rows), 'footprints')

def hull(pts):
    pts = sorted(set(pts))
    if len(pts) < 3: return pts
    cr = lambda o, a, b: (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, up = [], []
    for p in pts:
        while len(lo) >= 2 and cr(lo[-2], lo[-1], p) <= 0: lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(up) >= 2 and cr(up[-2], up[-1], p) <= 0: up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]

def area(r): return abs(sum(r[i][0] * r[i - 1][1] - r[i - 1][0] * r[i][1] for i in range(len(r)))) / 2

out, skip, t0 = [], {'small': 0, 'outside': 0, 'thin': 0}, time.time()
for k, (h, flat) in enumerate(rows):
    if k % 20000 == 0: print(f'\r[{k:6d}/{len(rows)}] {100 * k / len(rows):5.1f}%  kept {len(out)}', end='', flush=True)
    pts = [((flat[i] - P['lon0']) * P['kx'], -(flat[i + 1] - P['lat0']) * P['ky']) for i in range(0, len(flat), 2)]
    A = area(pts)
    if A < 18: skip['small'] += 1; continue
    cx = sum(p[0] for p in pts) / len(pts); cy = sum(p[1] for p in pts) / len(pts)
    if not (X0 < cx < X1 and Y0 < cy < Y1): skip['outside'] += 1; continue
    H = hull(pts); best = None
    for i in range(len(H)):  # rotating calipers: the minimum-area box has a side along a hull edge
        ax, ay = H[i]; bx, by = H[(i + 1) % len(H)]; L = math.hypot(bx - ax, by - ay)
        if L < 1e-6: continue
        ux, uy = (bx - ax) / L, (by - ay) / L
        us = [p[0] * ux + p[1] * uy for p in H]; vs = [-p[0] * uy + p[1] * ux for p in H]
        w, d = max(us) - min(us), max(vs) - min(vs)
        if best is None or w * d < best[0]:
            mu, mv = (max(us) + min(us)) / 2, (max(vs) + min(vs)) / 2
            best = (w * d, w, d, math.atan2(uy, ux), mu * ux - mv * uy, mu * uy + mv * ux)
    if not best: continue
    _, w, d, ang, bx, by = best
    if w < d: w, d, ang = d, w, ang + math.pi / 2  # long side along local x (a house's ridge runs that way)
    fill = A / max(1e-6, w * d)
    if fill < 0.8: s = math.sqrt(max(fill, 0.35) / 0.8); w *= s; d *= s  # an L or U: don't let the box swallow the yard it wraps
    if d < 2.0: skip['thin'] += 1; continue
    ang = ang % math.pi
    h = max(2.6, min(300.0, h if h and h > 0 else 6.0))
    out.append((int(round((bx + 16384) * 2)), int(round((by + 16384) * 2)), int(round(ang / math.pi * 10000)), int(round(min(w, 6000) * 10)), int(round(min(d, 6000) * 10)), int(round(h * 10))))
print(f'\r[{len(rows)}/{len(rows)}] 100.0%  kept {len(out)}  skipped {skip}')
blob = b''.join(struct.pack('<6H', *[min(65535, max(0, v)) for v in r]) for r in out)
os.makedirs('geo', exist_ok=True)
json.dump({'src': src['src'], 'n': len(out), 'b64': base64.b64encode(blob).decode()}, open('geo/buildings.json', 'w'), separators=(',', ':'))
print(f'wrote geo/buildings.json: {len(out)} buildings, {os.path.getsize("geo/buildings.json") / 1e6:.1f} MB')
