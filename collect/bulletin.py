"""News bulletin feed for GRIDLOCK's "Near me" report: local headlines, 401 / DVP traffic, the weather,
and the voice clips the page plays (Kokoro neural TTS, voiced here once, shared by everyone).

  python collect/bulletin.py      every round; only voices text it hasn't voiced yet, within a time budget

Writes data/bulletin.json and data/voice/*.mp3. The page picks which calls are near the listener and
stitches the clips together; anything without a clip yet is read by the phone's own voice instead.
"""
import hashlib
import html
import json
import os
import re
import sys
import time
import xml.etree.ElementTree as ET
from datetime import datetime
from email.utils import parsedate_to_datetime

sys.path.insert(0, os.path.dirname(__file__))
from gridlock.common import TORONTO, get, load, path, save  # noqa: E402

OUT = "bulletin.json"
VOICE_DIR = path("voice")
ANCHOR, DESK = "am_michael", "af_heart"          # Kokoro voices: news anchor, traffic & weather
ANCHOR_NAME, DESK_NAME = "Gordon Hale", "Peggy Lane"
BUDGET = float(os.environ.get("VOICE_BUDGET", "75"))  # seconds of synthesis per round
MODEL_DIR = os.path.expanduser(os.environ.get("KOKORO_DIR", "~/.cache/kokoro"))
MODEL_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"

FEEDS = [("CityNews", "https://toronto.citynews.ca/feed/"),
         ("CBC Toronto", "https://www.cbc.ca/webfeed/rss/rss-canada-toronto"),
         ("CP24", "https://www.cp24.com/arc/outboundfeeds/rss/category/local/?outputType=xml"),
         ("Global News", "https://globalnews.ca/toronto/feed/"),
         ("the Toronto Star", "https://www.thestar.com/search/?f=rss&t=article&c=news/gta*&l=50&s=start_time&sd=desc"),
         ("blogTO", "https://feeds.feedburner.com/blogto")]

FSA_NAMES = {"M1B": "Malvern", "M1C": "Highland Creek", "M1E": "West Hill", "M1G": "Woburn", "M1H": "Cedarbrae", "M1J": "Scarborough Village",
             "M1K": "Kennedy Park", "M1L": "Clairlea and Golden Mile", "M1M": "Cliffside", "M1N": "Birch Cliff", "M1P": "Dorset Park",
             "M1R": "Wexford and Maryvale", "M1S": "Agincourt", "M1T": "Tam O'Shanter", "M1V": "Milliken", "M1W": "L'Amoreaux", "M1X": "the Rouge"}
STREET = {"Ave": "Avenue", "Rd": "Road", "St": "Street", "Dr": "Drive", "Blvd": "Boulevard", "Cres": "Crescent", "Crt": "Court", "Ct": "Court",
          "Pkwy": "Parkway", "Sq": "Square", "Trl": "Trail", "Gt": "Gate", "Pl": "Place", "Hts": "Heights", "Cir": "Circle", "Crcl": "Circle", "Crcs": "Circus", "Lawn": "Lawn", "Hwy": "Highway",
          "Ln": "Lane", "Terr": "Terrace", "Gdns": "Gardens", "Grv": "Grove", "Pk": "Park", "Mews": "Mews", "Way": "Way", "Cir.": "Circle",
          "E": "East", "W": "West", "N": "North", "S": "South"}
NUM = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen",
       "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"]
TENS = {2: "twenty", 3: "thirty", 4: "forty", 5: "fifty", 6: "sixty", 7: "seventy", 8: "eighty", 9: "ninety"}


def words(n):
    n = int(round(n))
    if n < 0:
        return "minus " + words(-n)
    if n <= 20:
        return NUM[n]
    if n < 100:
        return TENS[n // 10] + ("" if n % 10 == 0 else "-" + NUM[n % 10])
    return str(n)


def clean(s):
    s = html.unescape(re.sub(r"<[^>]+>", "", s or "")).strip()
    s = s.replace("‘", "'").replace("’", "'").replace("“", '"').replace("”", '"').replace("—", ", ").replace("–", ", ")
    return re.sub(r"\s+", " ", s)


def street(s):
    s = re.sub(r"\(.*?\)", "", s or "").strip()
    out = []
    for w in s.split():
        k = w.strip(".,")
        out.append(STREET.get(k, w) if out else w)  # never expand the first word ("St Clair")
    s = " ".join(out)
    return re.sub(r"\bMc([a-z])", lambda m: "Mc" + m.group(1).upper(), s)


def place(c):
    loc = (c.get("loc") or "").strip()
    m = re.match(r"(M1[A-Z])\b", loc)
    if m or not loc:
        n = FSA_NAMES.get(m.group(1) if m else "", "")
        return f"in the {n} area" if n else "in Scarborough"
    raw = [p.strip() for p in loc.split(" - ") if p.strip()]
    lane = any(re.match(r"Ln\b", p) for p in raw)
    parts = []
    for p in raw:
        if re.match(r"Ln\b", p):
            continue  # City laneway names ("Ln 2 N Queen E Kingston") read terribly
        if re.search(r"\b401\b", p):
            parts.append("the 401 ramp" if re.search(r"ramp", p, re.I) else "the 401")
            continue
        parts.append(street(p))
    if not parts:
        return "in Scarborough"
    if lane and len(parts) == 1:
        return f"near {parts[0]}"
    if len(parts) >= 2:
        if any(re.search(r"metrolinx|ttc|hydro|plaza|mall|park$", p, re.I) for p in parts[1:]):
            return f"on {parts[0]} near {parts[1]}"
        return f"at {parts[0]} and {parts[1]}"
    return f"on {parts[0]}"


def an(x):
    return ("an " if x[:1].lower() in "aeiou" else "a ") + x


def call_line(c):
    """One sentence for a call, no time in it (the page adds 'around three this morning' in front)."""
    act, label, src = c.get("act", ""), (c.get("vl") or c.get("label") or "").strip(), c.get("src")
    p = place(c)
    raw = (c.get("label") or "").lower()
    just = "just occurred" in raw or "just occurred" in label.lower()
    prog = "in progress" in raw or "priority" in label.lower()
    base = re.sub(r"\s*\((just occurred|priority / in progress|priority|just occured)\)", "", label, flags=re.I)
    base = re.sub(r"\s*(just occurred|in progress)$", "", base, flags=re.I).strip().split(" / ")[0]
    base = {"Break and Enter": "break-in", "Break & Enter": "break-in", "Disorderlies": "disturbance", "Disturbance": "disturbance",
            "Unknown Trouble": "report of unknown trouble", "Person with a Knife": "person with a knife", "Person with a Gun": "person with a gun",
            "Damage to Property": "report of property damage", "Damage to Auto": "damaged vehicle", "Animal Complaint": "animal complaint",
            "Trespassing": "trespasser", "Noisy Party": "noisy party", "Indecent Exposure": "report of indecent exposure"}.get(base, base.lower())
    if src == "tfs":
        if act.startswith("crash"):
            return f"Firefighters and paramedics were called to a crash with injuries {p}."
        if act == "fire_struct":
            return f"Firefighters battled a fire {p}."
        if act == "gas":
            return f"Crews were called to a natural gas leak {p}."
        if act == "fire_small":
            return f"Firefighters put out {'a grass fire' if 'grass' in raw else 'a small fire'} {p}."
        if act == "medical" or act == "fire_alarm":
            return ""
        return f"Toronto Fire responded to {an(clean(c.get('label') or 'a call').lower())} {p}."
    if act in ("crash2", "crash3"):
        return f"Police and paramedics were called to a crash with injuries {p}."
    if act == "crash1":
        return f"Police were called to a fender bender {p}."
    if act == "impaired":
        return f"Police went looking for a suspected impaired driver {p}."
    if act == "missing":
        return f"Police were searching for a missing person {p}."
    if act == "hazard":
        return f"Police were called about a road hazard {p}."
    if act == "medical":
        return ""
    tail = " that had just happened" if just else " in progress" if prog else ""
    if act == "police_crit":
        return f"Police rushed to a report of {an(base)}{tail} {p}."
    if act == "police_high":
        return f"Toronto police were called to a report of {an(base)}{tail} {p}."
    return f"Police were called to {an(base)}{tail} {p}."


# ───────────────────────── headlines ─────────────────────────
LOCAL = re.compile(r"scarborough|toronto|\bttc\b|\bgta\b|ontario|\b401\b|\bdvp\b|don valley|raptors|leafs|blue jays|\bjays\b|argos|\btfc\b|pearson|"
                   r"durham|york region|mississauga|brampton|markham|pickering|queen's park|ford|chow|metrolinx|go transit", re.I)
FAR = re.compile(r"calgary|edmonton|kelowna|vancouver|manitoba|winnipeg|saskatoon|regina|n\.l\.|newfoundland|nova scotia|halifax|b\.c\.|"
                 r"alberta|quebec|montreal|ottawa", re.I)
SPORT = re.compile(r"raptors|leafs|blue jays|\bjays\b|argos|\btfc\b|nhl|nba|mlb|goal|game winner|playoff", re.I)


def fetch_feed(name, url):
    import urllib.request
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (GRIDLOCK news bulletin; github.com/jasonalves-debug/gridlock)"})
    body = urllib.request.urlopen(req, timeout=35).read()
    try:
        raw = [(it.findtext("title"), it.findtext("pubDate"), it.findtext("link")) for it in ET.fromstring(body).iter("item")]
    except ET.ParseError:  # some feeds aren't strict XML: fall back to pulling the fields out by hand
        txt = body.decode("utf-8", "replace")
        g = lambda tag, blk: (re.search(rf"<{tag}[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</{tag}>", blk, re.S) or [None, None])[1]
        raw = [(g("title", b), g("pubDate", b), g("link", b)) for b in re.findall(r"<item\b.*?</item>", txt, re.S)]
    out = []
    for t, d, link in raw:
        t, link = clean(t), (link or "").strip()
        try:
            ts = parsedate_to_datetime(d).timestamp() if d else None
        except Exception:  # noqa: BLE001
            ts = None
        if t and ts:
            out.append({"src": name, "title": t, "ts": int(ts), "link": link})
    return out


def headlines(prev):
    if prev and time.time() - prev.get("fetched", 0) < 600:   # every 10 minutes is plenty
        return prev
    items, status = [], {}
    for name, url in FEEDS:
        try:
            got = fetch_feed(name, url)
            items += got
            status[name] = len(got)
        except Exception as e:  # noqa: BLE001
            status[name] = f"down: {str(e)[:60]}"
    now = time.time()
    keep, seen = [], []
    for it in sorted(items, key=lambda x: -x["ts"]):
        if now - it["ts"] > 18 * 3600 or it["ts"] > now + 3600:
            continue
        t = it["title"]
        if FAR.search(t) and not re.search(r"toronto|scarborough|ontario", t, re.I):
            continue
        toks = set(re.findall(r"[a-z]{4,}", t.lower()))
        if any(len(toks & s) / max(1, len(toks | s)) > 0.4 for s in seen):
            continue
        seen.append(toks)
        sc = (3 if re.search(r"scarborough", t, re.I) else 0) + (1.2 if LOCAL.search(t) else 0) - (now - it["ts"]) / (6 * 3600)
        if it["src"] == "blogTO":
            sc -= 0.6
        it = dict(it, id="n" + hashlib.sha1(t.encode()).hexdigest()[:10], local=bool(re.search(r"scarborough", t, re.I)),
                  sport=bool(SPORT.search(t)), score=round(sc, 2))
        keep.append(it)
    keep.sort(key=lambda x: -x["score"])
    per, final = {}, []
    for it in keep:
        if per.get(it["src"], 0) >= 3:
            continue
        per[it["src"]] = per.get(it["src"], 0) + 1
        final.append(it)
    return {"fetched": int(now), "status": status, "items": final[:10]}


def news_line(it, k):
    t = it["title"].rstrip(".!? ")
    lead = ["From {s}: ", "{s} reports: ", "And from {s}: ", "Also, from {s}: "][k % 4].format(s=it["src"])
    return lead + t + "."


# ───────────────────────── traffic ─────────────────────────
def tt_name(s):
    s = re.sub(r"\(.*?\)", "", s or "")
    s = re.sub(r"/Exit \d+\w*", "", s)
    s = s.replace("Hwy-", "Highway ").replace("Hwy ", "Highway ").replace("/", " and ")
    return street(s.strip(" ,"))


def tomtom(key):
    fields = "{incidents{type,properties{iconCategory,magnitudeOfDelay,events{description},from,to,length,delay,roadNumbers}}}"
    d = get("https://api.tomtom.com/traffic/services/5/incidentDetails", {"key": key, "bbox": "-79.64,43.60,-79.08,43.85", "fields": fields,
                                                                           "language": "en-GB", "timeValidityFilter": "present"}, timeout=25)
    out = []
    for f in d.get("incidents", []):
        p = f.get("properties", {})
        names = " ".join([str(x) for x in (p.get("roadNumbers") or [])] + [p.get("from") or "", p.get("to") or ""])
        road = "401" if re.search(r"\b401\b", names) else "DVP" if re.search(r"DVP|Don Valley", names, re.I) else None
        if road:
            out.append({"road": road, "cat": p.get("iconCategory"), "mag": p.get("magnitudeOfDelay"), "from": tt_name(p.get("from")),
                        "to": tt_name(p.get("to")), "delay": p.get("delay") or 0, "len": p.get("length") or 0,
                        "what": ((p.get("events") or [{}])[0].get("description") or "")})
    return out


def traffic(live):
    key = os.environ.get("TOMTOM_KEY", "").strip()
    lines, src, segs = [], "511", []
    if key:
        try:
            segs = tomtom(key)
            src = "tomtom"
        except Exception as e:  # noqa: BLE001
            print("tomtom failed:", e)
    if src == "tomtom":
        for road, say, fine in (("401", "the 401", "The 401 is moving well across the top of the city."),
                                ("DVP", "the Don Valley Parkway", "The Don Valley Parkway is in good shape.")):
            crash = [s for s in segs if s["road"] == road and s["cat"] == 1]
            jams = sorted([s for s in segs if s["road"] == road and s["cat"] == 6 and s["delay"] >= 120], key=lambda s: -s["delay"])
            shut = [s for s in segs if s["road"] == road and s["cat"] in (7, 8)]
            if not (crash or jams or shut):
                lines.append(fine)
                continue
            for k, s in enumerate(jams[:2]):
                m = max(1, round(s["delay"] / 60))
                lines.append(f"{'On ' + say + ', it' if k == 0 else 'It'}'s slow from {s['from']} to {s['to']}, about {words(m)} extra minute{'s' if m != 1 else ''}.")
            for s in crash[:1]:
                lines.append(f"Watch for a collision on {say} near {s['from']}.")
            for s in shut[:1]:
                lines.append(f"There's a {'closure' if s['cat'] == 8 else 'lane closure'} on {say} near {s['from']}.")
    else:  # Ontario 511: collisions, closures and lane closures, but no speeds
        now = time.time()
        for v in (live or {}).get("hwy") or []:
            if "401" not in str(v.get("road")):
                continue
            st, en = v.get("start") or 0, v.get("end") or 0
            if st and st > now or en and en < now:
                continue
            m = re.search(r"between (.+?) and (.+?)(?:,|\.|$)", v.get("desc") or "", re.I)
            m2 = None if m else re.search(r"\b(?:at|near) (.+?)(?:,|\.|$)", v.get("desc") or "", re.I)
            where = f" between {street(m.group(1).title())} and {street(m.group(2).title())}" if m else f" at {street(m2.group(1).title())}" if m2 else ""
            if not where:
                continue
            dirn = (v.get("dir") or "").lower()
            desc = v.get("desc") or ""
            ramp = re.search(r"(On|Off)-ramp (?:at|from|to) (.+?)(?:,|\.|$)", desc, re.I)
            lanes_of = " express lanes" if re.search(r"express", desc, re.I) else " collectors" if re.search(r"collector", desc, re.I) else ""
            if ramp:
                lines.append(f"The 401 {dirn} {ramp.group(1).lower()}-ramp at {street(ramp.group(2).title())} is {'closed' if v.get('full') else 'down to one lane'}.")
                if len(lines) >= 3:
                    break
                continue
            if v.get("type") in ("accidentsAndIncidents", "incident", "accident") or "collision" in (v.get("desc") or "").lower():
                lines.append(f"There's a collision on the 401 {dirn}{where}.")
            elif v.get("full"):
                lines.append(f"The 401 {dirn}{lanes_of} {'are' if lanes_of.endswith('s') else 'is'} closed{where}.")
            elif v.get("lanes"):
                lines.append(f"Lane closures on the 401 {dirn}{lanes_of}{where}.")
            if len(lines) >= 3:
                break
        if not lines:
            lines.append("No collisions or closures reported on the 401 right now.")
    return {"src": src, "text": " ".join(lines), "segs": segs[:20]}


# ───────────────────────── weather ─────────────────────────
WMO = {0: "clear skies", 1: "mainly clear skies", 2: "a mix of sun and cloud", 3: "cloudy skies", 45: "fog", 48: "freezing fog", 51: "light drizzle",
       53: "drizzle", 55: "heavy drizzle", 56: "freezing drizzle", 57: "freezing drizzle", 61: "light rain", 63: "rain", 65: "heavy rain",
       66: "freezing rain", 67: "freezing rain", 71: "light snow", 73: "snow", 75: "heavy snow", 77: "snow grains", 80: "showers", 81: "showers",
       82: "heavy showers", 85: "snow squalls", 86: "heavy snow squalls", 95: "thunderstorms", 96: "thunderstorms with hail", 99: "thunderstorms with hail"}


def weather(live):
    d = get("https://api.open-meteo.com/v1/forecast", {
        "latitude": 43.775, "longitude": -79.23, "timezone": "America/Toronto", "forecast_days": 2,
        "current": "temperature_2m,apparent_temperature,weather_code,wind_speed_10m,is_day",
        "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max"}, timeout=25)
    c, dy = d.get("current", {}), d.get("daily", {})
    t, feels, code = c.get("temperature_2m"), c.get("apparent_temperature"), c.get("weather_code")
    now = datetime.now(TORONTO)
    hi, lo, pop, dcode = [dy.get(k, [None, None]) for k in ("temperature_2m_max", "temperature_2m_min", "precipitation_probability_max", "weather_code")]
    cond = WMO.get(code, "")
    s = f"Right now in Scarborough, it's {words(t)} degrees" + (f", feeling like {words(feels)}" if feels is not None and abs(feels - t) >= 3 else "") + (f", with {cond}." if cond else ".")
    if now.hour < 15:
        s += f" Today, {WMO.get(dcode[0], 'a mix of weather')}, with a high of {words(hi[0])}."
        s += f" Tonight, a low of {words(lo[1] if lo[1] is not None else lo[0])}."
    else:
        s += f" Tonight, a low of {words(lo[1] if lo[1] is not None else lo[0])}. Tomorrow, {WMO.get(dcode[1], 'a mix of weather')}, high of {words(hi[1])}."
    p = pop[0] if now.hour < 15 else pop[1]
    if p is not None and p >= 50:
        s += f" A {words(round(p / 10) * 10)} percent chance of precipitation."
    al = [a.get("name") for a in ((live or {}).get("alerts") or []) if a.get("name")]
    if al:
        s += f" Environment Canada has {an(al[0])} in effect."
    return {"text": s, "now": {"t": t, "feels": feels, "code": code, "cond": cond, "day": c.get("is_day")},
            "hi": hi, "lo": lo, "pop": pop, "codes": dcode, "alerts": al}


# ───────────────────────── fixed phrases ─────────────────────────
def hour_words(h):
    w = {0: "midnight", 12: "noon"}.get(h)
    return w or words(h % 12)


def static_phrases():
    P = {
        "greet_morning": "Good morning, Scarborough.", "greet_afternoon": "Good afternoon, Scarborough.",
        "greet_evening": "Good evening, Scarborough.", "greet_night": "You're up late, Scarborough.",
        "intro": f"This is the Gridlock Report. I'm {ANCHOR_NAME}.",
        "near": "Here's what happened within a kilometre of you, over the last day.",
        "near_quiet": "First, your street. It's been quiet. Nothing serious reported within a kilometre of you in the last day.",
        "near_out": "You're outside our coverage area, so here's the picture across Scarborough.",
        "no_loc": "We couldn't find your location, so here's the picture across Scarborough.",
        "top": "Here are the top calls across Scarborough in the last day.",
        "wider": "Elsewhere in Scarborough,", "wider2": "And across Scarborough,",
        "news_morning": "In the news this morning.", "news_afternoon": "In the news this afternoon.", "news_evening": "In the news tonight.",
        "toss": f"Now, traffic and weather together. Here's {DESK_NAME.split()[0]}.",
        "desk_hi": f"Thanks, {ANCHOR_NAME.split()[0]}.", "desk_wx": "And a look at the weather.",
        "desk_out": f"I'm {DESK_NAME}.", "thanks": f"Thanks, {DESK_NAME.split()[0]}.",
        "signoff": f"And that's the Gridlock Report. I'm {ANCHOR_NAME}. Stay safe out there.",
        "t_recent": "Within the last hour,",
    }
    for n in range(1, 41):
        P[f"minor_{n}"] = ("There was also one smaller call nearby." if n == 1 else f"There were also {words(n) if n <= 20 else n} smaller calls nearby, mostly alarms and medical calls.")
    for h in range(24):
        hw = hour_words(h)
        at = "" if h in (0, 12) else (" in the morning" if h < 12 else " in the afternoon" if h < 17 else " in the evening" if h < 21 else " at night")
        P[f"t_today_{h}"] = (f"Overnight, around {hw}," if h < 5 else f"Around {hw} this morning," if h < 12 else
                             "Around noon today," if h == 12 else f"Around {hw} this afternoon," if h < 17 else f"Around {hw} this evening," if h < 21 else f"Around {hw} tonight,")
        P[f"t_yday_{h}"] = (f"Early yesterday, around {hw}{at}," if h < 5 else f"Yesterday morning, around {hw}," if h < 12 else
                            "Yesterday around noon," if h == 12 else f"Yesterday afternoon, around {hw}," if h < 17 else f"Last night, around {hw},")
    return P


# ───────────────────────── voice ─────────────────────────
_K = None


def kokoro():
    global _K
    if _K is None:
        import urllib.request
        from kokoro_onnx import Kokoro
        os.makedirs(MODEL_DIR, exist_ok=True)
        for f, name in (("kokoro.onnx", "kokoro-v1.0.int8.onnx"), ("voices.bin", "voices-v1.0.bin")):
            p = os.path.join(MODEL_DIR, f)
            if not os.path.exists(p):
                print("downloading", name)
                urllib.request.urlretrieve(MODEL_URL + name, p + ".part")
                os.replace(p + ".part", p)
        _K = Kokoro(os.path.join(MODEL_DIR, "kokoro.onnx"), os.path.join(MODEL_DIR, "voices.bin"))
    return _K


def synth(text, voice, speed=1.0):
    import lameenc
    import numpy as np
    s, sr = kokoro().create(text, voice=voice, speed=speed, lang="en-us")
    s = np.asarray(s, dtype=np.float32)
    nz = np.flatnonzero(np.abs(s) > 0.01)  # trim the silence Kokoro leaves at both ends
    if nz.size:
        s = s[max(0, nz[0] - int(0.03 * sr)): nz[-1] + int(0.12 * sr)]
    s = s / max(1e-3, float(np.max(np.abs(s)))) * 0.92
    enc = lameenc.Encoder()
    enc.set_bit_rate(48)
    enc.set_in_sample_rate(sr)
    enc.set_channels(1)
    enc.set_quality(2)
    data = enc.encode((s * 32767).astype(np.int16).tobytes()) + enc.flush()
    return data, round(len(s) / sr, 2)


def fname(text, voice):
    return hashlib.sha1(f"{voice}|1.0|{text}".encode()).hexdigest()[:14] + ".mp3"


def build():
    t0 = time.time()
    prev = load(OUT, {}) or {}
    live = load("gridlock_live.json", {}) or {}
    os.makedirs(VOICE_DIR, exist_ok=True)
    st = {}
    try:
        news = headlines(prev.get("news"))
        st["news"] = news.get("status")
    except Exception as e:  # noqa: BLE001
        news, st["news"] = prev.get("news") or {"items": []}, f"down: {e}"
    tr = prev.get("traffic")
    if not tr or time.time() - tr.get("at", 0) > 300:
        try:
            tr = dict(traffic(live), at=int(time.time()))
        except Exception as e:  # noqa: BLE001
            st["traffic"] = f"down: {e}"
    wx = prev.get("weather")
    if not wx or time.time() - wx.get("at", 0) > 900:
        try:
            wx = dict(weather(live), at=int(time.time()))
        except Exception as e:  # noqa: BLE001
            st["weather"] = f"down: {e}"

    # everything that should have a voice, most urgent first: (key, text, voice)
    want = []
    if tr:
        want.append(("traffic", tr["text"], DESK))
    if wx:
        want.append(("weather", wx["text"], DESK))
    for k, it in enumerate(news.get("items", [])):
        want.append(("n:" + it["id"], news_line(it, k), ANCHOR))
    now = time.time()
    calls = sorted([c for c in live.get("calls") or [] if now - c.get("ts", 0) < 26 * 3600], key=lambda c: -c["ts"])
    lines = {}
    for c in calls:
        ln = call_line(c)
        if ln:
            lines[c["id"]] = ln
            want.append(("c:" + c["id"], ln, ANCHOR))
    for k, txt in static_phrases().items():
        want.append(("s:" + k, txt, DESK if k.startswith("desk_") else ANCHOR))

    clips, made, spent = {}, 0, 0.0
    old = (prev.get("clips") or {})
    for key, text, voice in want:
        f = fname(text, voice)
        fp = os.path.join(VOICE_DIR, f)
        if os.path.exists(fp):
            o = old.get(key) or {}
            clips[key] = {"f": "voice/" + f, "t": text, "v": voice, "d": o.get("d") if o.get("f") == "voice/" + f else None}
            continue
        if time.time() - t0 > BUDGET:
            clips[key] = {"f": None, "t": text, "v": voice}
            continue
        try:
            ts = time.time()
            data, dur = synth(text, voice)
            open(fp, "wb").write(data)
            spent += time.time() - ts
            made += 1
            clips[key] = {"f": "voice/" + f, "t": text, "v": voice, "d": dur}
        except Exception as e:  # noqa: BLE001
            print("voice failed:", key, e)
            clips[key] = {"f": None, "t": text, "v": voice}
            st["voice"] = f"down: {str(e)[:80]}"
            break
    for key, text, voice in want:
        clips.setdefault(key, {"f": None, "t": text, "v": voice})
    used = {c["f"].split("/")[-1] for c in clips.values() if c.get("f")}
    for f in os.listdir(VOICE_DIR):
        if f.endswith(".mp3") and f not in used:
            os.remove(os.path.join(VOICE_DIR, f))
    missing = sum(1 for c in clips.values() if not c.get("f"))
    st.setdefault("voice", f"live ({len(clips) - missing} clips, {missing} waiting)")
    out = {"generated": datetime.now(TORONTO).isoformat(timespec="seconds"), "anchor": ANCHOR_NAME, "desk": DESK_NAME,
           "news": news, "traffic": tr, "weather": wx, "lines": lines, "clips": clips, "status": st}
    save(OUT, out)
    print(f"bulletin: {len(news.get('items', []))} headlines, traffic {tr and tr.get('src')}, {made} new clips in {spent:.0f}s, {missing} waiting, {time.time() - t0:.0f}s total")


if __name__ == "__main__":
    build()
