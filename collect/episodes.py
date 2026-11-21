"""The Gridlock Report as finished audio: one produced, mixed MP3 per Scarborough postal area (M1B ... M1X),
plus a podcast feed for each. Same content as the map's "Near me" report, but the script is voiced in whole
segments (so it flows like one read, not stitched clips) and mixed here with jingles, beds, an AM-radio voice
and even loudness.

  python collect/episodes.py      every round, after bulletin.py; only re-renders areas whose script changed

Writes data/episodes.json, data/episodes/<FSA>-<stamp>.mp3 (newest two kept) and data/podcast/<FSA>.xml.
"""
import hashlib
import html
import json
import os
import re
import sys
import time
from datetime import datetime
from email.utils import format_datetime

sys.path.insert(0, os.path.dirname(__file__))
import bulletin as B  # noqa: E402
from gridlock.common import TORONTO, load, path, save  # noqa: E402

SR = 24000
OUT = "episodes.json"
EP_DIR, POD_DIR = path("episodes"), path("podcast")
SEG_CACHE = os.path.expanduser("~/.cache/gridlock_seg")
BUDGET = float(os.environ.get("EPISODE_BUDGET", "80"))
RAW = "https://raw.githubusercontent.com/jasonalves-debug/gridlock/data/"
PAGE = "https://jasonalves-debug.github.io/gallery/gridlock-report.html"
COVER = "https://jasonalves-debug.github.io/gallery/gridlock-report-cover.png"
ordinal, when, lower_first = B.ordinal, B.when, B.lower_first


SEV = {"critical": 4, "high": 3, "medium": 2, "low": 1}


def score(c, now):
    return SEV.get(c.get("sev"), 1) + (0.6 if c.get("act") in ("crash2", "crash3", "fire_struct", "gas") else 0) - (now - c["ts"]) / 86400 * 0.8


def dedupe(L):
    out = []
    for c in L:
        if any(abs(k["ts"] - c["ts"]) < 3 * 3600 and abs(k["lat"] - c["lat"]) < 0.0014 and abs(k["lng"] - c["lng"]) < 0.0019 and
               (k["label"] == c["label"] or (k["act"].startswith("crash") and c["act"].startswith("crash"))) for k in out):
            continue
        out.append(c)
    return out


def fsa_of(c, pts):
    """The Scarborough postal area a call is in; None for calls outside Scarborough (the feed also covers the east end)."""
    m = re.match(r"(M1[A-Z])\b", c.get("loc") or "")
    if m:
        return m.group(1)
    if not B.in_scarborough(c.get("lat"), c.get("lng")):
        return None
    best, bd = None, 1e9
    for f, P in pts.items():
        for la, ln in P:
            d = (la - c["lat"]) ** 2 + ((ln - c["lng"]) * 0.72) ** 2
            if d < bd:
                bd, best = d, f
    return best


def scripts(live, bul, pts):
    """{fsa: {segs: [{who, bed, jin, items: [{t, k, ref}]}]}} for every Scarborough area, plus "_front" and "_back": the parts of the
    map's report everyone shares (its middle, the calls near you, is put together on the phone). Running order, like a morning show:
    weather, then traffic (unplanned trouble only), then the news, starting with police and fire calls close to home, then Toronto's top stories.
    Each item is voiced on its own, so the finished mix knows when every call, story and forecast starts (the map moves its camera on that)."""
    now = datetime.now(TORONTO)
    nts = now.timestamp()
    calls = [c for c in (live.get("calls") or []) if 0 <= nts - c.get("ts", 0) < 86400]
    for c in calls:
        c["_f"] = fsa_of(c, pts)
    hr = now.hour
    greet = "Good morning" if 5 <= hr < 12 else "Good afternoon" if 12 <= hr < 17 else "Good evening"
    part = "this morning" if 4 <= hr < 12 else "this afternoon" if 12 <= hr < 17 else "tonight"
    date = f"{now.strftime('%A')}, {now.strftime('%B')} {ordinal(now.day)}"
    news = ((bul.get("news") or {}).get("items") or [])[:3]
    trd = bul.get("traffic") or {}
    tr, wx = trd.get("text"), (bul.get("weather") or {}).get("text")
    skip = set(trd.get("ids") or [])  # crashes already read in traffic
    A1, D1 = B.ANCHOR_NAME.split()[0], B.DESK_NAME.split()[0]
    I = lambda t, k, ref=None: {"t": t, "k": k, "ref": ref}
    line = lambda c: B.call_line(c, now)

    desk = None
    if tr or wx:
        d = [I(f"Thanks, {A1}.", "deskhi")]
        if wx:
            d.append(I(wx, "weather"))
        if tr:
            d += ([I("Now the roads.", "roads")] if wx else []) + [I(tr, "traffic")]
        d.append(I(f"I'm {B.DESK_NAME}.", "deskout"))
        desk = {"who": "desk", "bed": "desk", "jin": "traffic", "items": d}
    toss = [I(f"We'll start with your weather and traffic. Here's {D1}.", "toss")] if desk else []
    city = None
    if news:
        city = {"who": "anchor", "bed": "news", "jin": "bump",
                "items": [I(f"Across Toronto {part}.", "newsintro")] + [I(B.news_line(x, k), "news", x["id"]) for k, x in enumerate(news)]}
    wet = bool(re.search(r"rain|showers|drizzle|snow|flurr|squall|thunder|fog", wx or "", re.I))
    bye = (["Take it easy on the roads.", "Watch your footing out there.", "Give yourself a little extra time out there."] if wet else
           ["Stay safe out there.", "Have a good one, Scarborough.", "Drive carefully, and we'll talk soon.", "Take care of each other."])[(now.timetuple().tm_yday + hr // 6) % (3 if wet else 4)]
    after = lambda name: f"And that's the Gridlock Report{' for ' + name if name else ''}. I'm {B.ANCHOR_NAME}. {bye}"

    # the map's shared parts: open, weather and traffic, the toss to your calls ... then the city's news and the sign-off
    hello = f"{greet + ', Scarborough' if 5 <= hr < 22 else 'You' + chr(39) + 're up late, Scarborough'}. It's {date}, and this is the Gridlock Report. I'm {B.ANCHOR_NAME}."
    front = {"segs": [{"who": "anchor", "bed": None, "items": [I(hello, "intro")] + toss}] + ([desk] if desk else []) +
             [{"who": "anchor", "bed": None, "items": [I((f"Thanks, {D1}. " if desk else "") + "Now to the news, starting close to home.", "newsin")]}]}
    back = {"segs": ([city] if city else []) + [{"who": "anchor", "bed": None, "items": [I(after(""), "outro")]}]}

    serious = sorted([c for c in calls if c["id"] not in skip and line(c) and (c.get("sev") in ("critical", "high") or c.get("act") in ("fire_struct", "gas", "crash3"))],
                     key=lambda c: -score(c, nts))
    out = {}
    for f, name in B.FSA_NAMES.items():
        mine = [c for c in calls if c["_f"] == f]
        feat = dedupe(sorted([c for c in mine if c["id"] not in skip and c.get("act") not in ("medical", "fire_alarm") and line(c)], key=lambda c: -score(c, nts)))[:3]
        minor = len(mine) - len(feat)
        it = [I(f"{greet}. It's {date}, and this is the Gridlock Report for {name}. I'm {B.ANCHOR_NAME}.", "intro")] + toss
        local = [I((f"Thanks, {D1}. " if desk else "") + f"Now to the news, starting here in {name}.", "newsin")]
        for k, c in enumerate(feat):  # the most serious first, the way a newscast leads
            s = line(c)
            local.append(I(s if k == 0 else (f"Also in {name}, " if k == 1 else "And ") + lower_first(s), "call", c["id"]))
        if not feat:
            local.append(I(f"It's been a quiet day in {name}, with nothing serious reported in the last twenty-four hours.", "quiet"))
        if minor > 0:
            fm = [c for c in mine if c not in feat]
            med = sum(1 for c in fm if c.get("act") in ("medical", "fire_alarm"))
            kind = "mostly medical calls and alarms" if med * 2 >= len(fm) else "mostly minor police calls"
            local.append(I(f"There was also one smaller call in the area." if minor == 1 else f"There were also {B.words(minor)} smaller calls in the area, {kind}.", "minor"))
        wide = dedupe([c for c in serious if c["_f"] != f])[: 1 if len(feat) >= 2 else 2]
        said = set()
        for c in wide:
            reg = "Scarborough" if B.in_scarborough(c.get("lat"), c.get("lng")) else "the city"
            local.append(I((f"Elsewhere in {reg}, " if reg not in said else "And ") + lower_first(line(c)), "call", c["id"]))
            said.add(reg)
        segs = [{"who": "anchor", "bed": None, "items": it}] + ([desk] if desk else []) + [{"who": "anchor", "bed": "wire", "items": local}]
        segs += ([city] if city else []) + [{"who": "anchor", "bed": None, "items": [I(after(name), "outro")]}]
        out[f] = {"name": name, "segs": segs, "local": len(feat), "minor": max(0, minor)}
    out["_front"], out["_back"] = front, back
    return out


# ───────────────────────── voice ─────────────────────────
def voice_pcm(text, who):
    import numpy as np
    v = B.ANCHOR if who == "anchor" else B.DESK
    os.makedirs(SEG_CACHE, exist_ok=True)
    fp = os.path.join(SEG_CACHE, hashlib.sha1(f"{v}|{text}".encode()).hexdigest()[:16] + ".npy")
    if os.path.exists(fp):
        return np.load(fp), False
    s, sr = B.kokoro().create(text, voice=v, speed=1.0, lang="en-us")
    s = np.asarray(s, dtype=np.float32)
    nz = np.flatnonzero(np.abs(s) > 0.01)
    if nz.size:
        s = s[max(0, nz[0] - int(0.03 * sr)): nz[-1] + int(0.15 * sr)]
    np.save(fp, s)
    return s, True


# ───────────────────────── synth (jingles and beds) ─────────────────────────
def _np():
    import numpy as np
    from scipy.signal import butter, sosfilt
    return np, butter, sosfilt


def note(n):
    return 440 * 2 ** ((n - 69) / 12)


class Mix:
    def __init__(self, secs):
        np, self.butter, self.sosfilt = _np()
        self.np = np
        self.buf = np.zeros(int(secs * SR) + SR, dtype=np.float32)
        self.f = {}

    def filt(self, kind, f, x):
        k = (kind, f if not isinstance(f, list) else tuple(f))
        if k not in self.f:
            self.f[k] = self.butter(2, f, btype=kind, fs=SR, output="sos")
        return self.sosfilt(self.f[k], x).astype(self.np.float32)

    def add(self, sig, at, gain=1.0):
        i = int(at * SR)
        if i < 0:
            sig, i = sig[-i:], 0
        if i + len(sig) > len(self.buf):
            self.buf = self.np.concatenate([self.buf, self.np.zeros(i + len(sig) - len(self.buf) + SR, dtype=self.np.float32)])
        self.buf[i:i + len(sig)] += sig * gain

    def t(self, secs):
        return self.np.arange(int(secs * SR)) / SR

    def saw(self, f, secs, cents=0):
        return (self.np.cumsum(self.np.full(int(secs * SR), f * 2 ** (cents / 1200) / SR)) % 1.0) * 2 - 1

    def env(self, secs, a, d, s, r, hold):
        t = self.t(secs)
        e = self.np.where(t < a, t / a, self.np.where(t < a + d, 1 - (1 - s) * (t - a) / d, s))
        return (e * self.np.where(t > hold, self.np.maximum(0, 1 - (t - hold) / r), 1)).astype(self.np.float32)

    def brass(self, n, dur, vel):
        secs = dur + 0.35
        raw = sum(self.saw(note(n), secs, c) for c in (-8, 0, 7)) / 3
        t = self.t(secs)
        x = self.np.clip(t / 0.05, 0, 1) * (1 - 0.4 * self.np.clip((t - 0.05) / 0.3, 0, 1)) * vel
        sig = self.filt("lowpass", 650, raw) * (1 - x) + self.filt("lowpass", 2800, raw) * x
        return sig * self.env(secs, 0.025, 0.18, 0.7, 0.25, dur) * 0.22 * vel

    def timp(self, n, vel):
        t = self.t(1.5)
        f = note(n) * (1 + 0.06 * self.np.exp(-t / 0.04))
        tone = self.np.sin(2 * self.np.pi * self.np.cumsum(f) / SR) * self.np.exp(-t / 0.35)
        nz = self.filt("bandpass", [150, 420], self.np.random.uniform(-1, 1, len(t)).astype(self.np.float32)) * self.np.exp(-t / 0.06)
        return (tone * 0.5 + nz * 0.6) * vel

    def click(self, v):
        t = self.t(0.025)
        return self.filt("bandpass", [2300, 4200], self.np.random.uniform(-1, 1, len(t)).astype(self.np.float32)) * self.np.exp(-t / 0.004) * 0.7 * v

    def tone(self, f, d, v, kind="sine"):
        t = self.t(d)
        ph = 2 * self.np.pi * f * t
        w = self.np.sin(ph) if kind == "sine" else self.np.sign(self.np.sin(ph)) * 0.5 if kind == "square" else 2 / self.np.pi * self.np.arcsin(self.np.sin(ph))
        e = self.np.minimum(1, t / 0.006) * self.np.minimum(1, (d - t) / 0.012)
        return (w * e * v).astype(self.np.float32)

    def bell(self, v):
        t = self.t(1.4)
        return sum(self.np.sin(2 * self.np.pi * f * t) * a * self.np.exp(-t / d) for f, a, d in ((2093, 1, 0.45), (5230, 0.35, 0.2), (3140, 0.25, 0.3))).astype(self.np.float32) * 0.16 * v

    def vibe(self, n, v, d=1.6):
        t = self.t(d)
        f = note(n)
        s = sum(self.np.sin(2 * self.np.pi * f * m * t) * a * self.np.exp(-t / (d * 0.35 / m ** 0.3)) for m, a in ((1, 1), (4, 0.18), (10, 0.05)))
        return (s * (1 - 0.35 * (0.5 + 0.5 * self.np.sin(2 * self.np.pi * 5.5 * t))) * 0.16 * v).astype(self.np.float32)


def jingle(m, kind, at):
    """Adds a jingle at `at` seconds; returns its length."""
    if kind == "open":
        for i in range(26):
            m.add(m.click(0.8), at + i * 0.075 + (i * 37 % 10) * 0.003)
        u, t = 0.065, at + 0.2
        for ch in "NEWS":
            for sym in {"N": "-.", "E": ".", "W": ".--", "S": "..."}[ch]:
                d = u * 3 if sym == "-" else u
                m.add(m.tone(880, d, 0.14), t)
                t += d + u
            t += u * 2
        m.add(m.bell(1), t + 0.05)
        s = max(at + 2.2, t + 0.35)
        for i in range(8):
            m.add(m.timp(41, 0.25 + i * 0.07), s - 0.6 + i * 0.075)
        for o, n, ln in ((0, 58, 0.18), (0.2, 65, 0.18), (0.4, 70, 0.5)):
            m.add(m.brass(n, ln, 0.8), s + o)
            m.add(m.brass(n - 12, ln, 0.5), s + o)
        for k, (o, chord) in enumerate(((1.0, (63, 67, 70)), (1.45, (65, 69, 72)), (1.9, (58, 62, 65, 70)))):
            for n in chord:
                m.add(m.brass(n, 1.6 if k == 2 else 0.32, 1 if k == 2 else 0.85), s + o)
            m.add(m.timp(34 if k == 2 else 41, 0.9), s + o)
        return s - at + 3.6
    if kind == "bump":
        for k, (o, chord) in enumerate(((0, (62, 65, 70)), (0.28, (63, 67, 70)), (0.56, (65, 70, 74)))):
            for n in chord:
                m.add(m.brass(n, 0.9 if k == 2 else 0.18, 0.8), at + o)
        m.add(m.timp(34, 0.8), at + 0.56)
        return 1.9
    if kind == "traffic":
        for i, n in enumerate((72, 76, 79, 84)):
            m.add(m.vibe(n, 1, 1.4), at + i * 0.11)
        for o, d in ((0.62, 0.13), (0.8, 0.2)):
            m.add(m.tone(415, d, 0.08, "square"), at + o)
            m.add(m.tone(523, d, 0.05, "square"), at + o)
        return 1.6
    if kind == "close":
        for i in range(6):
            m.add(m.timp(41, 0.3 + i * 0.1), at + i * 0.08)
        for k, (o, chord) in enumerate(((0.5, (65, 69, 72)), (0.85, (63, 67, 70, 75)), (1.3, (58, 62, 65, 70, 74)))):
            for n in chord:
                m.add(m.brass(n, 2.2 if k == 2 else 0.3, 0.9), at + o)
            m.add(m.timp(34 if k == 2 else 41, 0.9), at + o)
        m.add(m.bell(0.7), at + 3.2)
        return 4.4
    return 0


def bed(m, kind, at, secs, g):
    beat, step, t = 60 / 104, 0, at
    rnd = (hash((kind, round(at, 1))) % 1000) / 1000
    while t < at + secs:
        r = ((step * 7919 + int(rnd * 997)) % 100) / 100
        if kind == "wire":
            if r < 0.62:
                m.add(m.click(0.5 + r * 0.4), t, g)
            if step % 4 == 0:
                m.add(m.tone(55, 0.22, 0.3, "tri"), t, g)
            if step % 64 == 0:
                m.add(m.bell(0.5), t, g)
        elif kind == "news":
            if step % 4 == 0:
                m.add(m.tone(58.27 if step % 8 == 0 else 46.25, 0.3, 0.3, "tri"), t, g)
            if step % 16 == 8:
                for n in (58, 62, 65):
                    m.add(m.brass(n, 0.25, 0.3), t, g)
            if r < 0.2:
                m.add(m.click(0.35), t, g)
        elif kind == "desk":
            if step % 2 == 0:
                m.add(m.vibe((72, 76, 79, 76, 74, 77, 81, 77)[(step // 2) % 8], 0.5, 1.1), t, g)
            if step % 8 == 0:
                m.add(m.tone(65.4, 0.35, 0.25, "tri"), t, g)
        step += 1
        t += beat / 4


def am_voice(m, x):
    np = m.np
    y = m.filt("bandpass", [170, 5200], x)
    y = y + 0.35 * m.filt("bandpass", [1800, 3200], x)
    y = np.tanh(y * 1.6) / np.tanh(1.6)
    rms = float(np.sqrt(np.mean(y ** 2)) or 1e-3)
    return (y * (0.16 / rms)).astype(np.float32)


def render(ep, head="open", close=True):
    """The finished episode as MP3 bytes, its length, and a cue sheet: when each jingle and each spoken item starts.
    head="bump" starts on a short bump (the map's shared closing half); close=False leaves off the closing theme (its opening half)."""
    import lameenc
    m = Mix(30)
    np = m.np
    cues = []
    gap = int(0.32 * SR)
    t = jingle(m, head, 0.05)
    cues.append({"t": 0.05, "d": round(t, 2), "k": head})
    t -= 0.9 if head == "open" else 0.25
    segs = ep["segs"]
    for k, sg in enumerate(segs):
        jin = sg.get("jin") if (k >= 1 or head is None) else None
        if jin == "bump":
            d = jingle(m, "bump", t + 0.35)
            cues.append({"t": round(t + 0.35, 2), "d": d, "k": "bump"})
            t += d + 0.05
        elif jin == "traffic":
            d = jingle(m, "traffic", t + 0.3)
            cues.append({"t": round(t + 0.3, 2), "d": d, "k": "sting"})
            t += d + 0.1
        parts, offs, pos = [], [], 0
        for i, item in enumerate(sg["items"]):
            pcm = voice_pcm(item["t"], sg["who"])[0]
            offs.append((pos, len(pcm)))
            parts.append(pcm)
            parts.append(np.zeros(gap if i < len(sg["items"]) - 1 else 0, dtype=np.float32))
            pos += len(pcm) + gap
        v = am_voice(m, np.concatenate(parts))
        dur = len(v) / SR
        if sg["bed"]:
            bed(m, sg["bed"], t - 0.3, dur + 0.6, 0.22 if sg["bed"] != "news" else 0.18)
        m.add(v, t)
        for item, (o, n) in zip(sg["items"], offs):
            c = {"t": round(t + o / SR, 2), "d": round(n / SR, 2), "k": item["k"], "txt": item["t"], "who": sg["who"]}
            if item.get("ref"):
                c["ref"] = item["ref"]
            cues.append(c)
        t += dur + (0.45 if k < len(segs) - 1 else 0.15)
    if close:
        d = jingle(m, "close", t - 0.2)
        cues.append({"t": round(t - 0.2, 2), "d": d, "k": "close"})
        t += d - 0.2
    buf = m.buf[: int((t + 0.6) * SR)]
    n = len(buf)
    hiss = m.filt("bandpass", [2000, 6000], np.random.uniform(-1, 1, n).astype(np.float32)) * 0.006
    crackle = np.zeros(n, dtype=np.float32)
    idx = np.random.randint(0, n, max(1, int(n / SR * 3)))
    crackle[idx] = np.random.uniform(-0.05, 0.05, len(idx))
    buf = buf + hiss + m.filt("highpass", 1500, crackle)
    buf = m.filt("highpass", 60, buf)
    rms = float(np.sqrt(np.mean(buf ** 2)) or 1e-3)
    buf = np.tanh(buf * (0.13 / rms) * 1.15) * 0.95
    enc = lameenc.Encoder()
    enc.set_bit_rate(64)
    enc.set_in_sample_rate(SR)
    enc.set_channels(1)
    enc.set_quality(2)
    return enc.encode((buf * 32767).astype(np.int16).tobytes()) + enc.flush(), round(n / SR, 1), cues


# ───────────────────────── podcast feeds ─────────────────────────
def podcast(f, name, files):
    esc = html.escape
    items = ""
    for e in files:
        when_dt = datetime.fromtimestamp(e["at"], TORONTO)
        items += (f"<item><title>{esc(when_dt.strftime('%a %b %-d, %-I:%M %p'))}: {esc(name)}</title>"
                  f"<description>{esc(e.get('summary', ''))}</description>"
                  f"<enclosure url=\"{RAW}{e['file']}\" length=\"{e['bytes']}\" type=\"audio/mpeg\"/>"
                  f"<guid isPermaLink=\"false\">{esc(e['file'])}</guid><pubDate>{format_datetime(when_dt)}</pubDate>"
                  f"<itunes:duration>{int(e['dur'])}</itunes:duration></item>")
    return (f"<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<rss version=\"2.0\" xmlns:itunes=\"http://www.itunes.com/dtds/podcast-1.0.dtd\"><channel>"
            f"<title>The Gridlock Report: {esc(name)} ({f})</title><link>{PAGE}</link><language>en-ca</language>"
            f"<description>A short local report for {esc(name)}, Scarborough: the weather and traffic, then the news, starting with police and fire calls in your area, then the top Toronto stories. Refreshed through the day.</description>"
            f"<itunes:author>GRIDLOCK</itunes:author><itunes:image href=\"{COVER}\"/><itunes:explicit>false</itunes:explicit><itunes:category text=\"News\"/>"
            f"<ttl>15</ttl>{items}</channel></rss>\n")


def build():
    t0 = time.time()
    bul = load("bulletin.json", {}) or {}
    live = load("gridlock_live.json", {}) or {}
    stat = load("gridlock_static.json", {}) or {}
    pts = {f: p for f, p in (stat.get("fsa") or {}).items() if f in B.FSA_NAMES}
    if not pts:
        print("episodes: no postal-area points yet")
        return
    prev = load(OUT, {}) or {}
    os.makedirs(EP_DIR, exist_ok=True)
    os.makedirs(POD_DIR, exist_ok=True)
    eps = scripts(live, bul, pts)
    parts = {}
    for name, head, close in (("front", "open", False), ("back", "bump", True)):  # the map's shared opening and closing
        ep, old = eps.pop("_" + name, None), prev.get(name) or {}
        parts[name] = old
        if not ep:
            continue
        key = hashlib.sha1((B.ANCHOR + B.DESK + json.dumps(ep["segs"])).encode()).hexdigest()[:12]
        if key == old.get("key") and old.get("file") and os.path.exists(path(old["file"])):
            continue
        try:
            data, dur, cues = render(ep, head=head, close=close)
            rel = f"episodes/{name}-{datetime.now(TORONTO).strftime('%Y%m%d-%H%M%S')}.mp3"
            open(path(rel), "wb").write(data)
            parts[name] = {"file": rel, "dur": dur, "cues": cues, "at": int(time.time()), "key": key, "prev": old.get("file")}
        except Exception as e:  # noqa: BLE001
            print(f"{name} part failed:", e)
    pf = prev.get("fsa") or {}
    order = sorted(eps, key=lambda f: (pf.get(f) or {}).get("at", 0))  # stalest first
    made, out = 0, {}
    for f in order:
        ep = eps[f]
        key = hashlib.sha1((B.ANCHOR + B.DESK + json.dumps(ep["segs"])).encode()).hexdigest()[:12]
        old = pf.get(f) or {}
        fresh_enough = old.get("key") == key or (old.get("file") and time.time() - old.get("at", 0) < 600)
        if (fresh_enough and old.get("file") and os.path.exists(path(old["file"]))) or time.time() - t0 > BUDGET:
            out[f] = old if old.get("file") else {"name": ep["name"], "file": None}
            continue
        try:
            data, dur, cues = render(ep)
        except Exception as e:  # noqa: BLE001
            print("episode failed:", f, e)
            out[f] = old
            continue
        stamp = datetime.now(TORONTO).strftime("%Y%m%d-%H%M")
        rel = f"episodes/{f}-{stamp}.mp3"
        open(path(rel), "wb").write(data)
        made += 1
        hist = [h for h in (old.get("hist") or []) if os.path.exists(path(h["file"]))][-1:]
        entry = {"name": ep["name"], "file": rel, "dur": dur, "bytes": len(data), "at": int(time.time()), "key": key, "local": ep["local"],
                 "minor": ep["minor"], "cues": cues,
                 "script": [{"v": sg["who"], "t": " ".join(i["t"] for i in sg["items"])} for sg in ep["segs"]],
                 "summary": " ".join(i["t"] for sg in ep["segs"] for i in sg["items"])[:600]}
        entry["hist"] = hist + [{k: entry[k] for k in ("file", "dur", "bytes", "at", "summary")}]
        out[f] = entry
        open(os.path.join(POD_DIR, f + ".xml"), "w").write(podcast(f, ep["name"], list(reversed(entry["hist"]))))
    keep = {h["file"].split("/")[-1] for e in out.values() for h in (e.get("hist") or [])} | {e["file"].split("/")[-1] for e in out.values() if e.get("file")}
    keep |= {x.split("/")[-1] for p_ in parts.values() for x in (p_.get("file"), p_.get("prev")) if x}
    for fn in os.listdir(EP_DIR):
        if fn.endswith(".mp3") and fn not in keep:
            os.remove(os.path.join(EP_DIR, fn))
    save(OUT, {"generated": datetime.now(TORONTO).isoformat(timespec="seconds"), "front": parts.get("front") or {}, "back": parts.get("back") or {}, "fsa": out, "names": B.FSA_NAMES, "points": pts})
    print(f"episodes: {made} rendered, {sum(1 for e in out.values() if e.get('file'))}/{len(out)} areas ready, {time.time() - t0:.0f}s")


if __name__ == "__main__":
    build()
