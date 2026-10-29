"""GRIDLOCK voice pack 4: variants (key~N), TV tour narration, traffic & weather reporter, unit variety, background radio chatter."""
import json, math, sys, time
from kokoro_onnx import Kokoro
sys.path.insert(0, '/home/claude/voice'); from voicekit import enc
D, U, U2, U3, A, T = 'af_alloy', 'am_echo', 'am_onyx', 'af_nova', 'am_michael', 'af_heart'
SPEED = {D: 1.12, U: 1.08, U2: 1.06, U3: 1.08, A: 1.0, T: 1.04}
P = {}
def v(key, voice, *texts):  # first text is the key itself, the rest become key~2, key~3...
    for i, t in enumerate(texts): P[key if i == 0 else f'{key}~{i + 1}'] = (voice, t)
def alt(key, voice, *texts):  # extra variants for a key that already exists in an older pack (start at ~2)
    for i, t in enumerate(texts): P[f'{key}~{i + 2}'] = (voice, t)
# ---- anchor variety
alt('a:open', A, 'Breaking news in Scarborough.', "We're following a developing story in the east end.", 'This just in from Scarborough.', 'Eastwire is following breaking news right now.')
alt('a:avoid', A, 'If you can, stay away from the area.', "Expect delays if you're heading that way.")
alt('a:stay', A, "We'll keep you posted.", 'More as we get it, right here on Eastwire.')
alt('a:reopen', A, 'The scene has cleared, and traffic is starting to move again.')
alt('a:crews', A, 'Crews are working at the scene right now.')
alt('a:chopper', A, 'Chopper Six is overhead right now.', "Here's the view from above.")
alt('a:live', A, "Good to have you with us. Here's the latest across Scarborough.", "Welcome to Eastwire. Here's a look at the city right now.")
alt('a:backed', A, 'Traffic is crawling for blocks in every direction.')
# ---- TV tour narration (anchor)
v('tv:cam', A, "Here's a live look from one of the city's traffic cameras.", "Let's check the cameras.", 'A live look at the roads right now.')
v('tv:stn', A, 'A look near the subway, where the buses and trains meet.', "Here's one of the east end's busiest transit hubs.")
v('tv:scenic', A, 'A look across Scarborough right now.', "Here's the view over the east end.")
v('tv:work', A, 'Road crews are out on this stretch today. Watch for lane closures.', 'Construction is narrowing the road here.')
v('tv:inc', A, 'Emergency crews are on scene here.', 'First responders are at this call right now.')
v('tv:sunrise', A, 'The sun is coming up over Scarborough.', "Good morning, Scarborough. Here's the sunrise.")
v('tv:sunset', A, 'The sun is going down over the east end.', 'Sunset over Scarborough.')
v('tv:night', A, 'Scarborough after dark.', 'A quiet night across the east end.')
v('tv:rain', A, 'Wet roads across the east end right now. Leave a little extra room.')
v('tv:snow', A, 'Snow on the roads in Scarborough. Take it slow out there.')
# ---- traffic & weather reporter
v('t:intro', T, 'Time for Eastwire traffic and weather.', "Let's check the roads and the weather.", "Traffic and weather. Here's where things stand.")
v('t:out', T, "That's Eastwire traffic.", 'Drive safe out there.', "I'll have another update in a few minutes.")
P.update({'t:its': (T, "It's"), 't:degrees': (T, 'degrees,'), 't:minus': (T, 'minus'),
  't:clear': (T, 'under clear skies.'), 't:cloudy': (T, 'and cloudy.'), 't:rain': (T, "and it's raining."), 't:snow': (T, "and it's snowing."), 't:fog': (T, 'with fog around.'), 't:storm': (T, 'with thunderstorms around.'), 't:windy': (T, 'and windy.'),
  't:calls': (T, 'calls to police, fire and paramedics in the last hour.'), 't:call1': (T, 'call to police, fire and paramedics in the last hour.'),
  't:quiet': (T, "It's been a quiet hour for police, fire and paramedics."), 't:busy': (T, "It's been a busy hour for police, fire and paramedics."),
  't:slowon': (T, 'Slow going on'), 't:busesbehind': (T, 'where buses are running well behind schedule.'), 't:slowroad': (T, 'This is one of the slowest roads in Scarborough right now.'),
  't:smooth': (T, 'Buses are mostly on schedule, so traffic is moving well.'), 't:hwy': (T, 'Ontario five-one-one has highway trouble to report.'), 't:hwyok': (T, 'The highways look clear.'),
  't:work': (T, 'Lots of road work out there today, so watch for lane closures.'),
  't:latearound': (T, 'Buses are running late around'), 't:expect': (T, 'so expect more traffic.'), 't:homecheck': (T, 'Checking in on'),
  't:home0': (T, 'All quiet in your area right now.'), 't:homebusy': (T, 'Crews are busy in your area right now.')})
W = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split()
TENS = {20: 'twenty', 30: 'thirty', 40: 'forty', 50: 'fifty', 60: 'sixty'}
def word(n): return W[n] if n < 20 else TENS[n // 10 * 10] + ('' if n % 10 == 0 else '-' + W[n % 10])
for n in range(0, 61): P[f'n:{n}'] = (T, word(n))
for h in range(1, 13):
    P[f't:at:{h}:00'] = (T, f"It's {word(h)} o'clock."); P[f't:at:{h}:30'] = (T, f"It's {word(h)} thirty.")
    P[f't:after:{h}:00'] = (T, f"It's just after {word(h)}."); P[f't:after:{h}:30'] = (T, f"It's just after {word(h)} thirty.")
for f in ['M1B', 'M1C', 'M1E', 'M1G', 'M1H', 'M1J', 'M1K', 'M1L', 'M1M', 'M1N', 'M1P', 'M1R', 'M1S', 'M1T', 'M1V', 'M1W', 'M1X']:
    P['tf:' + f] = (T, f'{f[0]} {word(int(f[1]))} {f[2]}.')
g = json.load(open('/home/claude/gridlock-repo/game/data/graph.json'))
for h in g['hoods']: P['th:' + h['n']] = (T, h['n'] + ',')
tot = {}
for e in range(len(g['ea'])):
    n = g['name'][e]
    if n < 0 or g['cls'][e] > 4: continue
    tot[n] = tot.get(n, 0) + g['len'][e]
def said(s): return s.replace('Highway 401 Express', 'the four-oh-one express').replace('Highway 401 Collector', 'the four-oh-one collectors').replace('Highway 2A', 'Highway two A').replace('St Clair', 'Saint Clair')
for n, L in tot.items():
    if L > 2000: P['tr:' + g['names'][n]] = (T, said(g['names'][n]) + ',')
# ---- field units and dispatch variety
alt('u:copy', U2, 'Ten-four, on our way.'); P['u:copy~3'] = (U3, 'Copy that, responding.'); P['u:copy~4'] = (U, 'Roger, en route.')
alt('u:onscene', U2, 'Arrived on scene.'); P['u:onscene~3'] = (U3, "We're on scene.")
alt('u:gotit', U3, "Ten-four, we've got it.")
alt('u:investigating', U3, 'On scene. Speaking with the caller now.')
alt('d:clear', D, 'Copy, scene is clear.')
# ---- background radio chatter (no incidents, just a city's radio breathing). Pairs are played together.
P.update({'c:1a': (U2, 'Dispatch, four-two-one, back in service.'), 'c:1b': (D, 'Four-two-one, copy.'),
  'c:2a': (U3, 'Four-three-six, clear from the call.'), 'c:2b': (D, 'Ten-four, four-three-six.'),
  'c:3a': (D, 'Units in forty-two, radio check.'), 'c:3b': (U2, 'Four-two-eight, loud and clear.'),
  'c:4a': (U, 'Dispatch, four-one-two, returning to the station.'), 'c:4b': (D, 'Copy, four-one-two.'),
  'c:5a': (U3, 'Four-three-one, starting our patrol.'), 'c:5b': (D, 'Ten-four.'),
  'c:6a': (D, 'Forty-three Division, any unit for a traffic complaint, Lawrence and Markham?'), 'c:6b': (U2, 'Four-three-four, I can take it.'),
  'c:7a': (U, 'Dispatch, four-one-nine, meal break.'), 'c:7b': (D, 'Copy, four-one-nine.')})
k = Kokoro('/home/claude/voice/kokoro-v1.0.onnx', '/home/claude/voice/voices-v1.0.bin')
out, durs, cap, t0 = {}, {}, {}, time.time()
for i, (key, (voice, text)) in enumerate(P.items()):
    a, _ = k.create(text, voice=voice, speed=SPEED[voice], lang='en-us'); out[key], durs[key] = enc(a); cap[key] = text.rstrip(',')
    if i % 25 == 0: print(f'{i}/{len(P)} {round(time.time() - t0)}s', flush=True)
json.dump({'clips': out, 'dur': durs, 'cap': cap}, open('/home/claude/gridlock-repo/game/data/voice4.json', 'w'))
print('done clips', len(out), 'bytes', sum(len(x) for x in out.values()))
