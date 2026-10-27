"""Assemble GRIDLOCK into one HTML file: ../gridlock.html (standalone, what you open) and out/gridlock_artifact.html."""
import glob, json, os, re, shutil, urllib.request
os.chdir(os.path.dirname(os.path.abspath(__file__)))  # run from anywhere
OUT = 'out'; os.makedirs(OUT, exist_ok=True)

read = lambda p: open(p, encoding='utf-8').read()


def graph():
    """Road graph (tools/process.py) plus the calibration files (tools/*.js), same as tests/load_sim.js."""
    g = json.load(open('data/graph.json'))
    for key, f in (('calib', 'calib.json'), ('baseline', 'baseline.json'), ('demandW', 'demand_w.json')):
        if os.path.exists('data/' + f): g[key] = json.load(open('data/' + f))
    return g


# simulation worker: sim.js with the world modules spliced in at its /*__WORLD__ a.js b.js */ marker
sim = re.sub(r'/\*__WORLD__ ([^*]+)\*/', lambda m: '\n'.join(read(f) for f in m.group(1).split()), read('sim.js'))
app = read('app.js').replace('/*__DIRECTOR__*/', read('director.js')).replace('/*__LIVEAPP__*/', read('live_app.js'))

# voice: base clips, then every data/voiceN.json on top (later files win)
V = {'clips': {}, 'dur': {}, 'cap': {}}
for p in ['data/voice.json'] + sorted(glob.glob('data/voice[0-9]*.json')):
    if os.path.exists(p):
        d = json.load(open(p))
        for k in V: V[k].update(d.get(k, {}))

# fallback snapshot of the data feed, used only when the page can't fetch fresh data
BASE = 'https://raw.githubusercontent.com/jasonalves-debug/gridlock/data/'
LOCAL = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data') + '/'  # collect/loop.sh's folder, if you ran it locally
snap = {}
for key in ('live', 'static'):
    name = f'gridlock_{key}.json'
    try:
        with urllib.request.urlopen(BASE + name, timeout=30) as r: snap[key] = json.loads(r.read())
        print('snapshot', name, 'from GitHub')
    except Exception as e:  # noqa: BLE001
        if os.path.exists(LOCAL + name): snap[key] = json.load(open(LOCAL + name)); print('snapshot', name, 'from local copy:', str(e)[:60])

blocks = {'voice': json.dumps(V, separators=(',', ':')), 'livesnap': json.dumps(snap, separators=(',', ':')).replace('</', '<\\/'),
          'graph': json.dumps(graph(), separators=(',', ':')).replace('</', '<\\/')}
render = read('render.js')
for name, src in [('sim', sim), ('render', render), ('app', app), *blocks.items()]:
    assert '</script' not in src, name
body = (read('page.html') + '\n' + ''.join(f'<script id="{k}" type="application/json">{v}</script>\n' for k, v in blocks.items())
        + f'<script id="simsrc" type="text/plain">{sim}</script>\n<script>{render}</script>\n<script>{app}</script>\n')
os.makedirs('out', exist_ok=True)
open(os.path.join(OUT, 'gridlock_artifact.html'), 'w', encoding='utf-8').write(body)
full = ('<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
        '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}</style></head><body>\n' + body + '</body></html>\n')
open(os.path.join(OUT, 'gridlock.html'), 'w', encoding='utf-8').write(full)
shutil.copy('out/gridlock.html', '../gridlock.html')  # the downloadable game, at the repo root
print(f'artifact {len(body):,}  standalone {len(full):,}  voice clips {len(V["clips"])}')
