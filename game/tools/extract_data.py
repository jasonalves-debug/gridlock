"""Rebuild game/data/ (git-ignored: road graph, calibration, voice clips) from a built gridlock.html, e.g. after a fresh clone.
Usage: python tools/extract_data.py [path/to/gridlock.html]   (default: ../gridlock.html at the repo root)"""
import json, os, re, sys
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
src = open(sys.argv[1] if len(sys.argv) > 1 else '../gridlock.html', encoding='utf-8').read()
blk = lambda k: json.loads(re.search(r'<script id="%s" type="application/json">(.*?)</script>' % k, src, re.S).group(1))
os.makedirs('data', exist_ok=True)
g = blk('graph')
for key, f in (('calib', 'calib.json'), ('baseline', 'baseline.json'), ('demandW', 'demand_w.json')):
    if key in g: json.dump(g.pop(key), open('data/' + f, 'w')); print('data/' + f)
json.dump(g, open('data/graph.json', 'w')); print('data/graph.json')
v = blk('voice'); json.dump(v, open('data/voice.json', 'w'), separators=(',', ':')); print(f'data/voice.json  {len(v["clips"])} clips (all packs merged)')
