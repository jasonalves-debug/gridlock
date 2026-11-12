"""GRIDLOCK voice pack 5: re-render every clip with Kokoro's best-rated voices, plus breaking-news anchor lines.
Kokoro's own grades: af_heart A, af_bella A-; the male voices top out at C+ and am_echo/am_onyx are D (the robotic ones).
  anchor (a:, tv:)                 af_heart   clean, the voice of breaking news
  traffic & weather (t: n: tf: th: tr:)  af_bella   clean
  dispatcher (d: r: l: p:, chatter)      af_bella   faster; the radio filter in the page sets it apart
  field units (u:, chatter)        am_fenrir / am_puck / am_michael / af_sarah (all through the radio filter)
Writes data/voice5.json, which build.py lays over the older packs (same keys, so nothing in the page changes).
Usage: python tools/render_voice5.py <texts.json>   (texts.json: key -> spoken text, recovered from the built page)"""
import base64, json, subprocess, sys, time
import numpy as np
from kokoro_onnx import Kokoro

texts = json.load(open(sys.argv[1]))
ANCHOR, TRAFFIC, DISPATCH = ('af_heart', 1.0), ('af_bella', 1.04), ('af_bella', 1.12)
UNITS = [('am_fenrir', 1.06), ('am_puck', 1.06), ('af_sarah', 1.08), ('am_michael', 1.04)]
# breaking news: who's on air for a fresh fire / arrest / serious police call
NEW = {'a:golive': ["We're going live to the scene.", "Let's go live to the scene now.", "We're taking you there live.", "Here's a live look at the scene."],
       'a:brkfire': ['Toronto Fire crews are battling a fire in Scarborough right now.', 'Firefighters have been called to a fire in the east end.', 'Crews are fighting a fire in Scarborough at this hour.'],
       'a:brkarrest': ['Police have made an arrest in Scarborough.', 'Officers have taken someone into custody in the east end.', 'An arrest has just been made in Scarborough.'],
       'a:brkpolice': ['Police are responding to a serious call in Scarborough.', "There's a heavy police response in the east end right now.", 'Officers are on scene of a serious call in Scarborough.']}
for k, vs in NEW.items():
    for i, t in enumerate(vs): texts[k if i == 0 else f'{k}~{i + 1}'] = t
CHAT_UNIT = {'c:1a': 1, 'c:2a': 2, 'c:3b': 1, 'c:4a': 0, 'c:5a': 2, 'c:6b': 1, 'c:7a': 0}  # the rest of c: are the dispatcher


def role(k):
    pre = k.split(':')[0]
    if pre in ('a', 'tv'): return ANCHOR, 56
    if pre in ('t', 'n', 'tf', 'th', 'tr'): return TRAFFIC, 56
    if pre == 'u': v = k.split('~'); return UNITS[(int(v[1]) - 1 if len(v) > 1 else 0) % 4], 40
    if pre == 'c': return (UNITS[CHAT_UNIT[k]] if k in CHAT_UNIT else DISPATCH), 40
    return DISPATCH, 40  # d: r: l: p:


def enc(a, sr, kbps):  # float mono -> mp3 (base64) at 24 kHz, trimmed of edge silence, plus its duration
    a = np.asarray(a, dtype=np.float32); thr = 0.01; nz = np.where(np.abs(a) > thr)[0]
    if len(nz): a = a[max(0, nz[0] - int(sr * 0.02)): nz[-1] + int(sr * 0.06)]
    pcm = (np.clip(a, -1, 1) * 32767).astype('<i2').tobytes()
    mp3 = subprocess.run(['ffmpeg', '-v', 'error', '-f', 's16le', '-ar', str(sr), '-ac', '1', '-i', '-', '-c:a', 'libmp3lame', '-b:a', f'{kbps}k', '-f', 'mp3', '-'], input=pcm, capture_output=True, check=True).stdout
    return base64.b64encode(mp3).decode(), len(a) / sr


k = Kokoro('/home/claude/voice/kokoro-v1.0.onnx', '/home/claude/voice/voices-v1.0.bin')
out, durs, cap, t0, N = {}, {}, {}, time.time(), len(texts)
for i, (key, text) in enumerate(texts.items()):
    (voice, speed), kbps = role(key)
    a, sr = k.create(text, voice=voice, speed=speed, lang='en-us')
    out[key], durs[key] = enc(a, sr, kbps)
    if key.split('~')[0] in NEW: cap[key] = text  # older keys keep their captions
    if i % 20 == 0 or i == N - 1:
        el = time.time() - t0; print(f'\r[{i + 1:4d}/{N}] {100 * (i + 1) / N:5.1f}%  {el:5.0f}s elapsed, ~{el / (i + 1) * (N - i - 1):4.0f}s left  {key[:30]:30s}', end='', flush=True)
json.dump({'clips': out, 'dur': durs, 'cap': cap}, open('data/voice5.json', 'w'), separators=(',', ':'))
print(f'\nwrote data/voice5.json: {len(out)} clips, {sum(len(v) for v in out.values()) / 1e6:.1f} MB base64')
