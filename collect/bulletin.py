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
ANCHOR, DESK = "af_heart", "af_bella"            # Kokoro voices: news anchor, traffic & weather (its two most natural voices)
ANCHOR_NAME, DESK_NAME = "Peggy Lane", "Ruth Avery"
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
          "Ln": "Lane", "Terr": "Terrace", "Ter": "Terrace", "Gdns": "Gardens", "Grv": "Grove", "Pk": "Park", "Mews": "Mews", "Way": "Way", "Cir.": "Circle",
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
    w = s.split()
    out = []
    for i, x in enumerate(w):
        k = x.strip(".,")
        if k == "St" and i + 1 < len(w) and w[i + 1].strip(".,") not in ("E", "W", "N", "S", "East", "West", "North", "South"):
            out.append("Saint")  # "St Clair Ave E" is said Saint Clair
        else:
            out.append(STREET.get(k, x) if out else x)  # never expand the first word otherwise
    s = " ".join(out)
    return re.sub(r"\bMc([a-z])", lambda m: "Mc" + m.group(1).upper(), s)


def in_scarborough(lat, lng):
    """West of Victoria Park Avenue is the old city / East York, not Scarborough (the feed also covers the east end)."""
    if lat is None or lng is None:
        return True
    return lat > 43.66 and lng > -79.2885 - 0.367 * (lat - 43.6915) - 0.003


SUFFIX = {"Avenue", "Road", "Street", "Drive", "Boulevard"}


def short_street(s):
    """How a broadcaster says a cross street: 'Lawrence Avenue East' -> 'Lawrence East', 'Warden Avenue' -> 'Warden'."""
    w = s.split()
    if len(w) >= 3 and w[-1] in ("East", "West") and w[-2] in SUFFIX:
        return " ".join(w[:-2] + [w[-1]])
    if len(w) >= 2 and w[-1] in SUFFIX:
        return " ".join(w[:-1])
    return s


def place_parts(c):
    """(kind, a, b): ('x', street, street) an intersection, ('near', street, landmark), ('on', street), ('area', name)."""
    loc = (c.get("loc") or "").strip()
    m = re.match(r"(M1[A-Z])\b", loc)
    if m or not loc:
        n = FSA_NAMES.get(m.group(1) if m else "", "")
        return ("area", n or "Scarborough", None)
    raw = [p.strip() for p in re.split(r" - | & ", loc) if p.strip() and p.strip().lower() not in ("scarborough", "east york", "north york", "toronto", "york", "etobicoke", "old toronto")]
    lane = any(re.match(r"(Ln|Ww|Wy)\b", p) for p in raw)
    parts = []
    for p in raw:
        if re.match(r"(Ln|Ww|Wy)\b", p):
            continue  # City laneway and walkway names ("Ln 2 N Queen E Kingston") read terribly
        if re.fullmatch(r"(Cpr|Cnr|Cp Rail|Cn Rail|C P R)", p, re.I):
            parts.append("the rail tracks")
            continue
        if re.search(r"\b401\b", p):
            parts.append("the 401 ramp" if re.search(r"ramp", p, re.I) else "the 401")
            continue
        hw = re.match(r"(\d+[A-Z]?)\s+Hwy\b", p, re.I)
        s = f"Highway {hw.group(1).upper()}" if hw else street(re.sub(r"^\d+[A-Za-z]?\s+", "", p))
        if s and s not in parts:
            parts.append(s)
    if not parts:
        return ("area", "Scarborough", None)
    if len(parts) >= 2:
        land = re.compile(r"metrolinx|ttc|hydro|plaza|mall|park$|rail tracks|creek|river|ravine|trail|playground", re.I)
        if land.search(parts[0]) and not land.search(parts[1]):
            parts = [parts[1], parts[0]]
        if any(land.search(p) for p in parts[1:]):
            return ("near", parts[0], parts[1])
        return ("x", parts[0], parts[1])
    return ("near1" if lane else "on", parts[0], None)


def place(c, bare=False):
    """'at Warden and Lawrence East' / 'on Warden Avenue' ... or, bare, the same without the preposition ('Police rushed to ...')."""
    k, a, b = place_parts(c)
    if k == "x":
        s = f"{short_street(a)} and {short_street(b)}"
        return s if bare else "at " + s
    if k == "near":
        return f"{a} near {b}" if bare else f"on {a} near {b}"
    if k == "near1":
        return f"an address near {a}" if bare else f"near {a}"
    if k == "on":
        return a if bare else "on " + a
    return (f"the {a} area" if a != "Scarborough" else "Scarborough") if bare else (f"in the {a} area" if a != "Scarborough" else "in Scarborough")


def when(ts, now):
    if now.timestamp() - ts < 3600:
        return "Within the last hour"
    d = datetime.fromtimestamp(ts, TORONTO)
    h, hw = d.hour, hour_words(d.hour)
    if d.date() == now.date():
        return (f"Overnight, around {hw}" if h < 5 else f"Around {hw} this morning" if h < 12 else "Around noon" if h == 12 else
                f"Around {hw} this afternoon" if h < 17 else f"Around {hw} this evening" if h < 21 else f"Around {hw} tonight")
    return (f"Early yesterday, around {hw}" if h < 5 else f"Yesterday morning, around {hw}" if h < 12 else "Yesterday around noon" if h == 12 else
            f"Yesterday afternoon, around {hw}" if h < 17 else f"Yesterday evening, around {hw}" if h < 21 else f"Last night, around {hw}")


def when_tail(ts, now):
    """The time as it goes at the end of a news sentence: 'around three yesterday afternoon'."""
    age = now.timestamp() - ts
    if age < 3600:
        return "within the last hour"
    d = datetime.fromtimestamp(ts, TORONTO)
    h, hw = d.hour, hour_words(d.hour)
    days = (now.date() - d.date()).days
    if days == 0:
        if h == 0:
            return "around midnight last night"
        return (f"around {hw} this morning" if h < 12 else "around noon" if h == 12 else f"around {hw} this afternoon" if h < 17 else
                f"around {hw} this evening" if h < 21 else f"around {hw} tonight")
    if days == 1:
        if h == 0:
            return "around midnight the night before last"
        return (f"around {hw} yesterday morning" if h < 12 else "around noon yesterday" if h == 12 else f"around {hw} yesterday afternoon" if h < 17 else
                f"around {hw} yesterday evening" if h < 21 else f"around {hw} last night")
    return f"around {hw} {'on ' + d.strftime('%A')}" + ("" if h in (0, 12) else " morning" if h < 12 else " afternoon" if h < 17 else " evening" if h < 21 else " night")


def lower_first(s):
    return s if s.startswith("Toronto") else s[:1].lower() + s[1:]


ORD = {1: "first", 2: "second", 3: "third", 5: "fifth", 8: "eighth", 9: "ninth", 12: "twelfth", 20: "twentieth", 30: "thirtieth"}


def ordinal(n):
    if n in ORD:
        return ORD[n]
    if n > 20 and n % 10:
        return TENS[n // 10] + "-" + ordinal(n % 10)
    return words(n) + "th"


def an(x):
    return ("an " if x[:1].lower() in "aeiou" else "a ") + x


# what the call was about, as a noun phrase with its article. Police calls are always "a report of ...": a dispatch, not a confirmed crime.
CALL_NP = {"break and enter": "a break-in", "break & enter": "a break-in", "disorderlies": "a disturbance", "disturbance": "a disturbance",
           "unknown trouble": "unknown trouble", "person with a knife": "a person with a knife", "person with a gun": "a person with a gun",
           "damage to property": "property damage", "damage to auto": "a damaged vehicle", "animal complaint": "an animal complaint",
           "trespassing": "a trespasser", "noisy party": "a noisy party", "indecent exposure": "indecent exposure", "theft of vehicle": "a vehicle theft",
           "theft from vehicle": "a theft from a vehicle", "suspicious person": "a suspicious person", "suspicious vehicle": "a suspicious vehicle",
           "shooting": "a shooting", "theft from auto": "a theft from a vehicle", "theft": "a theft", "stabbing": "a stabbing", "robbery": "a robbery", "assault": "an assault", "sexual assault": "a sexual assault"}
UNCLEAR = {"arrest", "hold for", "see officer", "information", "property found", "property lost", "check address"}  # meaning not clear enough to say on air


def call_line(c, now=None):
    """One news sentence for a call, with when it happened at the end. '' when it shouldn't be read out."""
    now = now or datetime.now(TORONTO)
    act, label, src = c.get("act", ""), (c.get("vl") or c.get("label") or "").strip(), c.get("src")
    at, to, w = place(c), place(c, bare=True), when_tail(c["ts"], now) if c.get("ts") else ""
    raw = (c.get("label") or "").lower()
    just = "just occurred" in raw or "just occurred" in label.lower()
    prog = "in progress" in raw or "priority" in label.lower()
    base = re.sub(r"\s*\((just occurred|priority / in progress|priority|just occured)\)", "", label, flags=re.I)
    base = re.sub(r"\s*(just occurred|in progress)$", "", base, flags=re.I).strip().split(" / ")[0].strip()
    if src == "tfs":
        if act.startswith("crash"):
            return f"Firefighters and paramedics were called to a crash with injuries {at} {w}."
        if act == "fire_struct":
            kind = next((k for k in ("residential", "commercial", "vehicle", "high-rise") if k in raw), "")
            return f"Firefighters were called to a reported {kind + ' ' if kind else ''}fire {at} {w}."
        if act == "gas":
            return f"Crews were called to a reported gas leak {at} {w}."
        if act == "fire_small":
            return f"Firefighters were called to {'a grass fire' if 'grass' in raw else 'a small fire'} {at} {w}."
        if act in ("medical", "fire_alarm"):
            return ""
        return f"Toronto Fire responded to {an(clean(c.get('label') or 'a call').lower())} {at} {w}."
    if act in ("crash2", "crash3"):
        return f"Police and paramedics were called to a crash with injuries {at} {w}."
    if act == "crash1":
        return f"Police were called to a collision with no reported injuries {at} {w}."
    if act == "impaired":
        return f"Police were called about a suspected impaired driver {at} {w}."
    if act == "missing":
        return f"Police were called about a missing person {at} {w}."
    if act == "hazard":
        return f"Police were called about a road hazard {at} {w}."
    if act == "medical" or base.lower() in UNCLEAR:
        return ""
    helper = re.match(r"see (fire|amb)", base.lower())
    if helper:
        return f"Police were called to help {'firefighters' if helper.group(1) == 'fire' else 'paramedics'} {at} {w}."
    np_ = CALL_NP.get(base.lower(), an(base.lower()))
    tail = " that had just happened" if just else " in progress" if prog else ""
    vague = place_parts(c)[0] in ("area", "near1")  # "rushed to Scarborough" says nothing; put the place after the call instead
    if act == "police_crit" and not vague:
        return f"Police rushed to {to} {w} after a report of {np_}{tail}."
    if act == "police_crit":
        return f"Police rushed to a report of {np_}{tail} {at} {w}."
    if act == "police_high" and not vague:
        return f"Police were called to {to} {w} for a report of {np_}{tail}."
    return f"Police responded to a report of {np_}{tail} {at} {w}."


# ───────────────────────── headlines ─────────────────────────
LOCAL = re.compile(r"scarborough|toronto|\bttc\b|\bgta\b|ontario|\b401\b|\bdvp\b|don valley|raptors|leafs|blue jays|\bjays\b|argos|\btfc\b|pearson|"
                   r"durham|york region|mississauga|brampton|markham|pickering|queen's park|ford|chow|metrolinx|go transit", re.I)
FAR = re.compile(r"calgary|edmonton|kelowna|vancouver|manitoba|winnipeg|saskatoon|regina|n\.l\.|newfoundland|nova scotia|halifax|b\.c\.|"
                 r"alberta|quebec|montreal|ottawa", re.I)
SPORT = re.compile(r"raptors|leafs|blue jays|\bjays\b|argos|\btfc\b|nhl|nba|mlb|goal|game winner|playoff", re.I)


def fetch_feed(name, url):
    import urllib.request
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (GRIDLOCK news bulletin; github.com/jasonalves-debug/gridlock)"})
    body = urllib.request.urlopen(req, timeout=15).read()
    try:
        raw = [(it.findtext("title"), it.findtext("pubDate"), it.findtext("link"), it.findtext("description")) for it in ET.fromstring(body).iter("item")]
    except ET.ParseError:  # some feeds aren't strict XML: fall back to pulling the fields out by hand
        txt = body.decode("utf-8", "replace")
        g = lambda tag, blk: (re.search(rf"<{tag}[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</{tag}>", blk, re.S) or [None, None])[1]
        raw = [(g("title", b), g("pubDate", b), g("link", b), g("description", b)) for b in re.findall(r"<item\b.*?</item>", txt, re.S)]
    out = []
    for t, d, link, desc in raw:
        t, link = clean(t), (link or "").strip()
        try:
            ts = parsedate_to_datetime(d).timestamp() if d else None
        except Exception:  # noqa: BLE001
            ts = None
        if t and ts:
            out.append({"src": name, "title": t, "ts": int(ts), "link": link, "desc": clean(desc)[:600] if name != "Google News" else ""})
    return out


RELTIME = re.compile(r"\b(today|tonight|tomorrow|this (morning|afternoon|evening|week)|yesterday|last night|later|earlier|(mon|tues|wednes|thurs|fri|satur|sun)day)\b", re.I)
LEAD_OK = {"a", "an", "the", "two", "three", "four", "five", "six", "several", "police", "officials", "crews", "firefighters", "paramedics", "residents",
           "drivers", "commuters", "investigators", "one", "some", "many", "more", "city", "provincial", "federal"}


def lede(title, desc, ts):
    """The outlet's own first sentence, when it's a clean, self-contained summary of the same story. Reads far more naturally than a headline;
    nothing is reworded. Dropped when it leans on 'today' or 'Friday' and wasn't published today, so stale timing never goes on air."""
    if not desc:
        return ""
    s = re.split(r"(?<=[a-z0-9)'\"][.!?])\s+(?=[A-Z\"'])", desc.strip())[0].strip()
    if not s.endswith((".", "!", "?")) or not 8 <= len(s.split()) <= 42 or re.search(r"\b(told|said|says)\b", s.split(",")[0]):
        return ""
    if len(toks(title) & toks(s)) < 2:
        return ""
    if RELTIME.search(s) and datetime.fromtimestamp(ts, TORONTO).date() != datetime.now(TORONTO).date():
        return ""
    return spoken(s) + "."


STOP = set("toronto ontario police after with from into over that this their about says said will have been more than what when where your they them amid plus just near could would should first last year years week".split())
SKIP = re.compile(r"weather|fog advisory|highway closures|road closures|traffic|horoscope|lotto|lottery|crossword|^watch\b|^video\b|^photos?\b|podcast|newsletter|^opinion", re.I)


def spoken(t):
    """A headline made readable aloud: section labels, abbreviations, money and symbols."""
    t = re.sub(r"\s+-\s+[^-]{2,40}$", "", t)  # Google News adds " - Outlet"
    m = re.match(r"^([A-Za-z'&. ]{3,28}):\s+(.+)$", t)
    if m and len(m.group(1).split()) <= 3 and not re.search(r"\b(says|told|warns)\b", m.group(1), re.I):
        t = m.group(2)
    t = re.sub(r"^(UPDATE|BREAKING|EXCLUSIVE|LIVE|WATCH)[: ]+", "", t, flags=re.I)
    t = re.sub(r"\$(\d+(?:\.\d+)?)\s?([MBK])\b", lambda m: f"{m.group(1)} {dict(M='million', B='billion', K='thousand')[m.group(2)]} dollars", t)
    t = re.sub(r"\$(\d+(?:\.\d+)?)\s?(million|billion|thousand)", r"\1 \2 dollars", t)
    t = re.sub(r"\$([\d,]+)", r"\1 dollars", t)
    for a, b2 in ((r"\bPM\b", "Prime Minister"), (r"\bvs\.?\b", "versus"), (r"\bJan\.", "January"), (r"\bFeb\.", "February"), (r"\bAug\.", "August"),
                  (r"\bSept?\.", "September"), (r"\bOct\.", "October"), (r"\bNov\.", "November"), (r"\bDec\.", "December"), (r"%", " percent"),
                  (r"&", "and"), (r"\bU\.S\.", "U.S."), (r"\bEMS\b", "paramedics"), (r"\bOPP\b", "provincial police"), (r"\bSIU\b", "the S I U")):
        t = re.sub(a, b2, t)
    t = t.replace('"', "").replace("'s ", "'s ").strip(" .")
    return t[:1].upper() + t[1:]


ALIAS = {"citynews toronto": "CityNews", "citynews": "CityNews", "cp24.com": "CP24", "cp24": "CP24", "cbc": "CBC Toronto", "cbc news": "CBC Toronto",
         "cbc.ca": "CBC Toronto", "toronto star": "the Toronto Star", "thestar.com": "the Toronto Star", "global news": "Global News", "globalnews.ca": "Global News",
         "ctv news toronto": "CTV News", "ctv news": "CTV News", "toronto sun": "the Toronto Sun", "blogto": "blogTO", "the globe and mail": "the Globe and Mail",
         "narcity": "Narcity", "toronto.com": "Toronto.com", "680 news": "CityNews"}


def outlet_name(s):
    k = re.sub(r"^the ", "", (s or "").strip(), flags=re.I).lower()
    return ALIAS.get(k, s.strip())


def toks(t):
    return {w for w in re.findall(r"[a-z]{4,}", t.lower()) if w not in STOP}


def headlines(prev):
    """Top Toronto stories: the stories the most outlets are carrying, nudged by Google News' own ranking."""
    if prev and time.time() - prev.get("fetched", 0) < 600 and prev.get("v") == 3:   # every 10 minutes is plenty
        return prev
    items, status = [], {}
    for name, url in FEEDS + [("Google News", "https://news.google.com/rss/headlines/section/geo/Toronto?hl=en-CA&gl=CA&ceid=CA:en")]:
        try:
            got = fetch_feed(name, url)
            if name == "Google News":
                for k, it in enumerate(got):
                    m = re.search(r"\s+-\s+([^-]{2,40})$", it["title"])
                    it["src"], it["gn"] = (m.group(1).strip() if m else "Google News"), k
            for it in got:
                it["src"] = outlet_name(it["src"])
            items += got
            status[name] = len(got)
        except Exception as e:  # noqa: BLE001
            status[name] = f"down: {str(e)[:60]}"
    now = time.time()
    clusters = []
    for it in sorted(items, key=lambda x: -x["ts"]):
        if now - it["ts"] > 20 * 3600 or it["ts"] > now + 3600:
            continue
        t = spoken(it["title"])
        if SKIP.search(t) or (FAR.search(t) and not re.search(r"toronto|scarborough|ontario|gta", t, re.I)):
            continue
        tk = toks(t)
        if len(tk) < 2:
            continue
        best = None
        for c in clusters:
            j = len(tk & c["tk"]) / max(1, len(tk | c["tk"]))
            if j > 0.28 or len(tk & c["tk"]) >= 4:
                best = c
                break
        if best:
            best["outlets"].setdefault(it["src"], it)
            best["tk"] |= tk
            if "gn" in it:
                best["gn"] = min(best.get("gn", 99), it["gn"])
        else:
            clusters.append({"tk": set(tk), "outlets": {it["src"]: it}, "gn": it.get("gn", 99)})
    out = []
    for c in clusters:
        outs = c["outlets"]
        # credit a real outlet we fetched directly when we have one, else the one Google News named
        direct = [o for o in outs if o in dict(FEEDS)]
        lead = min(outs.values(), key=lambda x: (x["src"] not in direct, -x["ts"]))
        n = len(outs)
        newest = max(x["ts"] for x in outs.values())
        t = spoken(lead["title"])
        ld = next((x for x in [lede(o["title"], o.get("desc"), o["ts"]) for o in sorted(outs.values(), key=lambda x: x["src"] not in direct)] if x), "")
        sc = n * 2.0 + (2.5 if re.search(r"scarborough", t, re.I) else 0) + (0.8 if LOCAL.search(t) else 0) \
            + (max(0, 12 - c["gn"]) / 10 if c["gn"] < 99 else 0) - (now - newest) / (8 * 3600) - (0.8 if lead["src"] == "blogTO" else 0)
        out.append({"id": "n" + hashlib.sha1(t.encode()).hexdigest()[:10], "src": lead["src"], "title": t, "orig": lead["title"], "ts": newest,
                    "outlets": sorted(outs, key=lambda o: o not in direct)[:4], "n": n, "lede": ld,
                    "lede_src": next((o["src"] for o in sorted(outs.values(), key=lambda x: x["src"] not in direct) if lede(o["title"], o.get("desc"), o["ts"])), ""), "local": bool(re.search(r"scarborough", t, re.I)),
                    "sport": bool(SPORT.search(t)), "score": round(sc, 2)})
    out.sort(key=lambda x: -x["score"])
    final, sport = [], 0
    for it in out:
        if it["sport"]:
            if sport:
                continue
            sport += 1
        final.append(it)
        if len(final) >= 6:
            break
    return {"fetched": int(now), "v": 3, "status": status, "items": final}


def outlet_list(o):
    o = [x for x in o if x != "Google News"]
    return o[0] if len(o) == 1 else ", ".join(o[:-1]) + " and " + o[-1]


def news_line(it, k):
    """A story as the anchor reads it: the outlet's own first sentence with a credit when we have one, otherwise its headline."""
    t = it["title"].rstrip(".!? ")
    outs = [o for o in (it.get("outlets") or [it["src"]]) if o != "Google News"] or [it["src"]]
    ld, who = (it.get("lede") or "").rstrip(".!? "), it.get("lede_src") or outs[0]
    if ld:
        first = ld.split()[0].lower()
        if k % 2 == 0 and first in LEAD_OK:
            s = f"{who} reports {ld[:1].lower() + ld[1:]}."
        elif k % 2 == 0:
            s = f"According to {who}, {ld}."
        else:
            s = f"{ld}, {who} reports."
        if k == 0 and len(outs) >= 3:
            s += f" It's leading at {outlet_list(outs[:3])}."
    else:
        s = [f"{outs[0]} reports: {t}.", f"From {outs[0]}: {t}.", f"And from {outs[0]}: {t}."][k % 3]
    return s[0].upper() + s[1:]


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


ROADWORK = re.compile(r"roadwork|road work|construction|maintenance|engineering|paving|bridge work|resurfacing|utility|planned|scheduled|nightly|daily", re.I)
EMERG = re.compile(r"collision|crash|disabled|stalled|debris|spill|fire|police|investigation|emergency|incident|flood|downed|rollover|jackknif", re.I)


def hwy_name(road):
    r = str(road or "")
    m = re.search(r"\b(4\d\d|2\d|4\d\d[A-Z]?)\b", r)
    if re.search(r"don valley|dvp", r, re.I):
        return "the Don Valley Parkway"
    if re.search(r"gardiner", r, re.I):
        return "the Gardiner"
    return f"the {m.group(1)}" if m else None


def num_words(s):
    return re.sub(r"\b(\d{1,2})\b", lambda m: words(int(m.group(1))), s)


def traffic(live):
    """Only what's unplanned: collisions, disabled vehicles, emergency closures, and serious crashes police and fire were just called to.
    Scheduled roadwork and construction closures are left out on purpose."""
    key = os.environ.get("TOMTOM_KEY", "").strip()
    lines, src, segs, ids = [], "511", [], []
    now = time.time()
    if key:
        try:
            segs = tomtom(key)
            src = "tomtom"
        except Exception as e:  # noqa: BLE001
            print("tomtom failed:", e)
    if src == "tomtom":
        for road, say in (("401", "the 401"), ("DVP", "the Don Valley Parkway")):
            crash = [s for s in segs if s["road"] == road and s["cat"] == 1]
            jams = sorted([s for s in segs if s["road"] == road and s["cat"] == 6 and s["delay"] >= 300], key=lambda s: -s["delay"])
            shut = [s for s in segs if s["road"] == road and s["cat"] in (7, 8) and not ROADWORK.search(s.get("what") or "") and EMERG.search(s.get("what") or "")]
            for s in crash[:1]:
                lines.append(f"Watch for a collision on {say} near {s['from']}.")
            for s in shut[:1]:
                lines.append(f"There's an emergency {'closure' if s['cat'] == 8 else 'lane closure'} on {say} near {s['from']}.")
            for k, s in enumerate(jams[:1]):
                m = max(1, round(s["delay"] / 60))
                lines.append(f"{'On ' + say + ', it' if not (crash or shut) else 'It'}'s slow from {s['from']} to {s['to']}, adding about {words(m)} minutes.")
    # Ontario 511: incidents only (no speeds), never the scheduled roadwork
    for v in (live or {}).get("hwy") or []:
        desc = v.get("desc") or ""
        st, en = v.get("start") or 0, v.get("end") or 0
        if st and st > now or en and en < now or v.get("type") == "roadwork" or ROADWORK.search(desc):
            continue
        if not (v.get("type") in ("accidentsAndIncidents", "incident", "accident") or EMERG.search(desc)):
            continue
        if re.search(r"(Pickering|Ajax|Whitby|Oshawa|Markham|Vaughan|Mississauga)\.", desc) and "Toronto" not in desc:
            continue
        road = hwy_name(v.get("road") or desc)
        if not road or src == "tomtom" and road in ("the 401", "the Don Valley Parkway"):
            continue
        what = re.match(r"(.+?)\s+on\s+(HWY|Highway|DVP|Don Valley|Gardiner)", desc, re.I)
        what = what.group(1).strip().lower() if what else "an incident"
        dirn = (v.get("dir") or "").lower()
        ramp = re.search(r"\b(on-ramp|off-ramp|ramp)\b\s+(?:at|from|to)\s+(.+?)(?:,|\.|$)", desc, re.I)
        btw = re.search(r"between (.+?) and (.+?)(?:,|\.|$)", desc, re.I)
        at = re.search(r"\bat (.+?)(?:,|\.|$)", desc, re.I)
        nm = lambda x: street(re.sub(r"\s*-\s*\w+$", "", x).title())
        where = (f"{dirn} {ramp.group(1).lower()} at {nm(ramp.group(2))}" if ramp else f"{dirn} between {nm(btw.group(1))} and {nm(btw.group(2))}" if btw
                 else f"{dirn} at {nm(at.group(1))}" if at else dirn).strip()
        lanes = "with all lanes closed" if v.get("full") else (f"with {num_words(str(v.get('lanes')).lower())}" if v.get("lanes") and "clos" in str(v.get("lanes")).lower() else "")
        lines.append(f"Watch for {an(what) if not what.startswith(('a ', 'an ')) else what} on {road} {where}{', ' + lanes if lanes else ''}.")
        if len(lines) >= 3:
            break
    # serious crashes police or fire were sent to in the last 45 minutes, in Scarborough or on the DVP
    hw = any(re.search(r"401|Don Valley", x) for x in lines)
    for c in sorted((live or {}).get("calls") or [], key=lambda c: -c.get("ts", 0)):
        age = now - c.get("ts", 0)
        if age > 45 * 60 or len(ids) >= 2 or not str(c.get("act", "")).startswith(("crash2", "crash3")) and not (c.get("src") == "tfs" and str(c.get("act", "")).startswith("crash")):
            continue
        dvp = "don valley" in (c.get("loc") or "").lower()
        if not (dvp or in_scarborough(c.get("lat"), c.get("lng"))):
            continue
        mins = max(5, int(round(age / 300.0)) * 5)
        lines.append(f"{'Police and paramedics were' if c.get('src') == 'tps' else 'Firefighters and paramedics were'} called to a crash with injuries {place(c)} "
                     f"about {words(mins)} minutes ago, so watch for emergency vehicles there.")
        ids.append(c["id"])
        hw = hw or dvp
    if not hw:
        lines.append("No collisions or emergency closures reported on the 401 or the Don Valley Parkway right now." if len(lines) == 0 else
                     "Nothing reported on the 401 or the Don Valley Parkway.")
    return {"src": src, "text": " ".join(lines), "segs": segs[:20], "ids": ids}


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
    sky = code in (0, 1, 2, 3)
    s = f"It's {words(t)} degrees in Scarborough right now" + (f", feeling like {words(feels)}" if feels is not None and abs(feels - t) >= 3 else "") \
        + ((f" under {cond}." if code in (0, 1, 3) else f" with {cond}.") if cond else ".")
    # a weather alert goes first, in Environment Canada's own words
    al, lead = [], ""
    for a in ((live or {}).get("alerts") or []):
        if not a.get("name"):
            continue
        try:
            if a.get("expires") and datetime.fromisoformat(a["expires"].replace("Z", "+00:00")).timestamp() < time.time():
                continue
        except ValueError:
            pass
        al.append(a.get("name"))
        if not lead:
            first = re.split(r"(?<=\.)\s", (a.get("text") or "").strip())[0].strip()
            lead = f"Environment Canada has {an(a['name'])} in effect." + (f" {first}" if first.endswith(".") and len(first.split()) <= 18 else "")
    def day(c, hi_):
        return f"expect {WMO.get(c, 'a mix of weather')}, with a high of {words(hi_)}"
    lo_t = lo[1] if lo[1] is not None else lo[0]
    if now.hour < 15:
        s += f" For the rest of the day, {day(dcode[0], hi[0])}, and a low of {words(lo_t)} tonight."
    else:
        s += f" Overnight, a low of {words(lo_t)}. Tomorrow, {day(dcode[1], hi[1])}."
    p = pop[0] if now.hour < 15 else pop[1]
    dc = dcode[0] if now.hour < 15 else dcode[1]
    if p is not None and p >= 50:
        kind = "snow" if dc in (71, 73, 75, 77, 85, 86) else "thunderstorms" if dc in (95, 96, 99) else "rain" if dc in (51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82) else "precipitation"
        s += f" There's a {words(round(p / 10) * 10)} percent chance of {kind}{' today' if now.hour < 15 else ' tomorrow'}."
    if lead:
        s = lead + " " + s
    return {"text": s, "now": {"t": t, "feels": feels, "code": code, "cond": cond, "day": c.get("is_day")},
            "hi": hi, "lo": lo, "pop": pop, "codes": dcode, "alerts": al}


# ───────────────────────── fixed phrases ─────────────────────────
def hour_words(h):
    w = {0: "midnight", 12: "noon"}.get(h)
    return w or words(h % 12)


def static_phrases():
    A1, D1 = ANCHOR_NAME.split()[0], DESK_NAME.split()[0]
    P = {
        "greet_morning": "Good morning, Scarborough.", "greet_afternoon": "Good afternoon, Scarborough.",
        "greet_evening": "Good evening, Scarborough.", "greet_night": "You're up late, Scarborough.",
        "intro": f"This is the Gridlock Report. I'm {ANCHOR_NAME}.",
        "toss_wx": f"We'll start with your weather and traffic. Here's {D1}.",
        "desk_hi": f"Thanks, {A1}.", "desk_roads": "Now the roads.", "desk_out": f"I'm {DESK_NAME}.",
        "news_in": f"Thanks, {D1}. Now to the news, starting close to home.",
        "near": "Here's what happened within a kilometre of you over the last day.",
        "near_quiet": "It's been quiet within a kilometre of you, with nothing serious reported in the last day.",
        "near_out": "You're outside our coverage area, so here's the picture across Scarborough.",
        "no_loc": "We couldn't find your location, so here's the picture across Scarborough.",
        "top": "Here are the most serious calls in the last day.",
        "wider": "Elsewhere in Scarborough.", "wider2": "Across Scarborough.", "wider_city": "Elsewhere in the city.", "wider2_city": "Across the east end of the city.",
        "news_morning": "Across Toronto this morning.", "news_afternoon": "Across Toronto this afternoon.", "news_evening": "Across Toronto tonight.",
        "signoff": f"And that's the Gridlock Report. I'm {ANCHOR_NAME}. Stay safe out there.",
    }
    for n in range(1, 41):
        P[f"minor_{n}"] = ("There was also one smaller call nearby." if n == 1 else f"There were also {words(n)} smaller calls nearby, mostly alarms and medical calls.")
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
    s = s * (0.16 / max(1e-4, float(np.sqrt(np.mean(s ** 2)))))  # same speech level as the produced episodes
    pk = float(np.max(np.abs(s)))
    if pk > 0.97:
        s = np.tanh(s / pk * 1.4) / np.tanh(1.4) * 0.97
    enc = lameenc.Encoder()
    enc.set_bit_rate(48)
    enc.set_in_sample_rate(sr)
    enc.set_channels(1)
    enc.set_quality(2)
    data = enc.encode((s * 32767).astype(np.int16).tobytes()) + enc.flush()
    return data, round(len(s) / sr, 2)


def fname(text, voice):
    return hashlib.sha1(f"{voice}|1.0|rms|{text}".encode()).hexdigest()[:14] + ".mp3"


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
            cur = (live or {}).get("weather") or {}
            if not wx and cur.get("temperature_2m") is not None:  # current conditions from the live feed, no forecast
                cond = WMO.get(cur.get("weather_code"), "")
                wx = {"text": f"Right now in Scarborough, it's {words(cur['temperature_2m'])} degrees" + (f", with {cond}." if cond else "."),
                      "now": {"t": cur["temperature_2m"], "feels": None, "code": cur.get("weather_code"), "cond": cond}, "hi": [], "lo": [], "alerts": [], "at": int(time.time()) - 600}

    # everything that should have a voice, most urgent first: (key, text, voice)
    want = []
    if tr:
        want.append(("traffic", tr["text"], DESK))
    if wx:
        want.append(("weather", wx["text"], DESK))
    for k, it in enumerate(news.get("items", [])):
        want.append(("n:" + it["id"], news_line(it, k), ANCHOR))
    now = time.time()
    nowdt = datetime.now(TORONTO)
    date = f"{nowdt.strftime('%A')}, {nowdt.strftime('%B')} {ordinal(nowdt.day)}"
    for g, gt in (("morning", "Good morning, Scarborough"), ("afternoon", "Good afternoon, Scarborough"), ("evening", "Good evening, Scarborough"), ("night", "You're up late, Scarborough")):
        want.append(("s:intro_" + g, f"{gt}. It's {date}, and this is the Gridlock Report. I'm {ANCHOR_NAME}.", ANCHOR))
    stat = static_phrases()
    for k, txt in stat.items():
        if not k.startswith("minor_"):
            want.append(("s:" + k, txt, DESK if k.startswith("desk_") else ANCHOR))

    calls = sorted([c for c in live.get("calls") or [] if now - c.get("ts", 0) < 26 * 3600], key=lambda c: -c["ts"])
    lines = {}
    for c in calls:
        ln = call_line(c, nowdt)
        if ln:
            lines[c["id"]] = ln
            want.append(("c:" + c["id"], ln, ANCHOR))
    want += [("s:" + k, txt, ANCHOR) for k, txt in stat.items() if k.startswith("minor_")]
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
    out = {"generated": datetime.now(TORONTO).isoformat(timespec="seconds"), "anchor": ANCHOR_NAME, "desk": DESK_NAME, "deskVoice": DESK,
           "news": news, "traffic": tr, "weather": wx, "lines": lines, "clips": clips, "status": st}
    save(OUT, out)
    print(f"bulletin: {len(news.get('items', []))} headlines, traffic {tr and tr.get('src')}, {made} new clips in {spent:.0f}s, {missing} waiting, {time.time() - t0:.0f}s total")


if __name__ == "__main__":
    build()
