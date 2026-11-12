"""GRIDLOCK voice pack 6: the anchor names the street in breaking news. "on <street>," and "near <street>." for every arterial and
collector street (graph class <= 4), plus lead-ins that end mid-sentence so they splice: "Police have made an arrest, | on Kingston Road, | near Galloway Road."
Same anchor voice as pack 5 (Kokoro af_heart). Writes data/voice6.json. Usage: python tools/render_voice6.py"""
import json, sys, time, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kokoro_onnx import Kokoro
import numpy as np, base64, subprocess

def said(s): return s.replace('Highway 401 Express', 'the four-oh-one express').replace('Highway 401 Collector', 'the four-oh-one collectors').replace('Highway 2A', 'Highway two A').replace('St Clair', 'Saint Clair')

g = json.load(open('data/graph.json')); best = {}
for e, n in enumerate(g['name']):
    if n >= 0: best[n] = min(best.get(n, 9), g['cls'][e])
names = sorted(g['names'][n] for n, c in best.items() if c <= 4)
T = {}
for i, t in enumerate(['Toronto Fire crews are battling a fire,', 'Firefighters have been called to a fire,', 'Crews are fighting a fire,']): T['a:lf' + ('' if i == 0 else f'~{i + 1}')] = t
for i, t in enumerate(['Police have made an arrest,', 'Officers have taken someone into custody,', 'An arrest has just been made,']): T['a:la' + ('' if i == 0 else f'~{i + 1}')] = t
for i, t in enumerate(['Police are responding to a serious call,', "There's a heavy police response,", 'Officers are on scene of a serious call,']): T['a:lp' + ('' if i == 0 else f'~{i + 1}')] = t
for n in names: T['ao:' + n] = f'on {said(n)},'; T['an:' + n] = f'near {said(n)}.'

def enc(a, sr, kbps=56):
    a = np.asarray(a, dtype=np.float32); nz = np.where(np.abs(a) > 0.01)[0]
    if len(nz): a = a[max(0, nz[0] - int(sr * 0.02)): nz[-1] + int(sr * 0.06)]
    pcm = (np.clip(a, -1, 1) * 32767).astype('<i2').tobytes()
    mp3 = subprocess.run(['ffmpeg', '-v', 'error', '-f', 's16le', '-ar', str(sr), '-ac', '1', '-i', '-', '-c:a', 'libmp3lame', '-b:a', f'{kbps}k', '-f', 'mp3', '-'], input=pcm, capture_output=True, check=True).stdout
    return base64.b64encode(mp3).decode(), len(a) / sr

k = Kokoro('/home/claude/voice/kokoro-v1.0.onnx', '/home/claude/voice/voices-v1.0.bin')
out, durs, cap, t0, N = {}, {}, {}, time.time(), len(T)
for i, (key, text) in enumerate(T.items()):
    a, sr = k.create(text, voice='af_heart', speed=1.0, lang='en-us'); out[key], durs[key] = enc(a, sr); cap[key] = text
    if key.startswith(('ao:', 'an:')): cap[key] = text.replace(said(key[3:]), key[3:])
    if i % 20 == 0 or i == N - 1:
        el = time.time() - t0; print(f'\r[{i + 1:4d}/{N}] {100 * (i + 1) / N:5.1f}%  {el:5.0f}s elapsed, ~{el / (i + 1) * (N - i - 1):4.0f}s left  {key[:34]:34s}', end='', flush=True)
json.dump({'clips': out, 'dur': durs, 'cap': cap}, open('data/voice6.json', 'w'), separators=(',', ':'))
print(f'\nwrote data/voice6.json: {len(out)} clips, {sum(len(v) for v in out.values()) / 1e6:.1f} MB base64')
