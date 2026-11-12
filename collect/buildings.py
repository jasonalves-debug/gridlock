"""One-off: City of Toronto 3D Massing (real building footprints + heights), cropped to Scarborough, written to out/buildings.json.
Run by .github/workflows/buildings.yml (Actions can reach Toronto open data; the game's build machine can't).
Output: {"src": resource name, "fields": [...], "hfield": name, "rows": [[height_m, [lng, lat, lng, lat, ...]], ...]}"""
import io, json, os, sys, time, urllib.request, zipfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gridlock.common import ckan_resources, W, S, E, N
import shapefile  # pyshp

def log(*a): print(time.strftime('%H:%M:%S'), *a, flush=True)

res = ckan_resources('3d-massing')
for r in res: log('resource:', r.get('name'), r.get('format'), r.get('url'))
shp = [r for r in res if str(r.get('format', '')).upper() in ('SHP', 'ZIP') or str(r.get('url', '')).lower().endswith('.zip')]
import re
yr = lambda r: int((re.search(r'(20\d\d)', r.get('name', '')) or [0, 0])[1])
flat = [r for r in shp if 'MULTIPATCH' not in r.get('name', '').upper() and 'WGS84' in (r.get('name', '') + r.get('url', '')).upper()]
pick = max(flat, key=yr) if flat else (shp[0] if shp else None)  # newest footprint (non-multipatch) edition
if not pick: sys.exit('no shapefile resource in 3d-massing')
log('downloading', pick['name'], pick['url'])
buf = io.BytesIO(); req = urllib.request.Request(pick['url'], headers={'User-Agent': 'gridlock-collector'})
with urllib.request.urlopen(req, timeout=900) as r:
    total = int(r.headers.get('Content-Length') or 0); got = 0; last = 0
    while True:
        b = r.read(1 << 20)
        if not b: break
        buf.write(b); got += len(b)
        if got - last > 50 << 20: last = got; log(f'  {got >> 20} MB' + (f' / {total >> 20} MB' if total else ''))
log('downloaded', got >> 20, 'MB')
z = zipfile.ZipFile(buf); names = z.namelist(); log('zip:', names[:20])
base = next(n[:-4] for n in names if n.lower().endswith('.shp'))
prj = z.read(base + '.prj').decode('latin-1') if base + '.prj' in names else ''
log('prj:', prj[:160])
rd = shapefile.Reader(shp=io.BytesIO(z.read(base + '.shp')), dbf=io.BytesIO(z.read(base + '.dbf')), shx=io.BytesIO(z.read(base + '.shx')) if base + '.shx' in names else None)
fields = [f[0] for f in rd.fields[1:]]; log('fields:', fields, 'records:', len(rd))
up = [f.upper() for f in fields]
hf = next((fields[up.index(k)] for k in ('ELEZ', 'AVG_HEIGHT', 'MAX_HEIGHT', 'HEIGHT') if k in up), None) or next((f for f in fields if 'HEIGHT' in f.upper() and 'MSL' not in f.upper()), None)
log('height field:', hf)
geo = 'GEOGCS' in prj and 'PROJCS' not in prj
tf = None
if not geo:
    from pyproj import CRS, Transformer
    tf = Transformer.from_crs(CRS.from_wkt(prj) if prj else CRS.from_epsg(2019), 4326, always_xy=True); log('reprojecting to WGS84')
rows, n = [], 0
for sr in rd.iterShapeRecords():
    n += 1
    if n % 50000 == 0: log(f'  {n} read, {len(rows)} kept')
    s = sr.shape
    if not s.points: continue
    pts = s.points[: (s.parts[1] if len(s.parts) > 1 else len(s.points))]  # outer ring
    if tf: pts = [tf.transform(x, y) for x, y in pts]
    lng = sum(p[0] for p in pts) / len(pts); lat = sum(p[1] for p in pts) / len(pts)
    if not (W <= lng <= E and S <= lat <= N): continue
    rec = sr.record.as_dict(); h = rec.get(hf) if hf else None
    try: h = round(float(h), 1)
    except (TypeError, ValueError): h = None
    if not h or h <= 0:
        try: h = round(float(rec.get('Elevation', rec.get('HEIGHT_MSL'))) - float(rec.get('Z', rec.get('SURF_ELEV'))), 1)
        except (TypeError, ValueError): h = None
        if not h or h <= 0: h = 6.0
    flat = []
    for x, y in pts: flat += [round(x, 6), round(y, 6)]
    rows.append([h, flat])
os.makedirs('out', exist_ok=True)
sample = rd.record(0).as_dict() if len(rd) else {}
json.dump({'src': pick['name'], 'fields': fields, 'hfield': hf, 'sample': {k: str(v) for k, v in sample.items()}, 'rows': rows}, open('out/buildings.json', 'w'), separators=(',', ':'))
log(f'wrote out/buildings.json: {len(rows)} buildings in Scarborough of {n}, {os.path.getsize("out/buildings.json") >> 20} MB')
