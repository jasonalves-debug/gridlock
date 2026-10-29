// ================================================================ LIVE DATA + CITY LIFE (page side)
// Every launch fetches the newest data: the 5-minute feed (calls, roadwork, digs, 311, TTC alerts, weather) and the daily
// one (schools, towers, worship, building sites, GO timetable, census, holidays). Fallbacks: last saved copy, then the copy
// built into this file. The worker turns the data into behaviour; this file draws it, explains it and narrates it.
const FEED_BASE = 'https://raw.githubusercontent.com/jasonalves-debug/gridlock/data/'; // the repo's `data` branch, refreshed every 5 min
const LV = { feed: null, stat: null, src: 'none', statSrc: 'none', err: null, kind: null, timer: 0, loading: null,
  ws: null, wl: null, zones: [], geo: null, seen: new Set(), prev: null, hits: [] };
const TZ = 'America/Toronto';
function torontoParts(ms) { const p = {}; for (const x of new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, weekday: 'short' }).formatToParts(new Date(ms))) p[x.type] = x.value; return p; }
function torontoMidnight(ms) { const p = torontoParts(ms); return Math.round(ms / 1000 - ((+p.hour % 24) * 3600 + +p.minute * 60 + +p.second)); }
function timeOf(epochS) { const p = torontoParts(epochS * 1000); const h = +p.hour % 24; return `${((h + 11) % 12) + 1}:${p.minute} ${h < 12 ? 'AM' : 'PM'}`; }
const hm = s => { const h = Math.floor(s / 3600) % 24, m = Math.floor(s % 3600 / 60); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const n0 = v => Number(v || 0).toLocaleString('en-CA');
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ---------------------------------------------------------------- fetching
async function getJSON(url, ms) { const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms); try { const r = await fetch(url + '?v=' + Math.floor(Date.now() / 60000), { signal: ctl.signal, cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); } finally { clearTimeout(t); } }
async function fetchFeed(name, key, ms) { // → [data, 'live' | 'saved'] or [null]; keeps a copy for offline launches
  try { const d = await getJSON(FEED_BASE + name, ms); try { localStorage.setItem(key, JSON.stringify(d)); } catch (e) {} return [d, 'live']; }
  catch (err) { LV.err = String(err && err.message || err); try { const d = JSON.parse(localStorage.getItem(key) || 'null'); if (d) return [d, 'saved']; } catch (e) {} return [null]; }
}
function loadFeed(withStatic) {
  return (LV.loading = (async () => {
    LV.err = null;
    const [[feed, src], [stat, ssrc]] = await Promise.all([fetchFeed('gridlock_live.json', 'gl.feed', 9000), withStatic ? fetchFeed('gridlock_static.json', 'gl.static', 15000) : [null]]);
    let snap; const builtIn = () => snap || (snap = (() => { try { return JSON.parse($('livesnap').textContent); } catch (e) { return {}; } })());
    if (feed) { LV.feed = feed; LV.src = src; } else if (!LV.feed && builtIn().live) { LV.feed = builtIn().live; LV.src = 'built-in'; }
    if (stat) { LV.stat = stat; LV.statSrc = ssrc; } else if (!LV.stat && builtIn().static) { LV.stat = builtIn().static; LV.statSrc = 'built-in'; }
    updateLiveUI(); return LV.feed;
  })());
}
const feedTime = () => LV.feed && Date.parse(LV.feed.incidents_generated || LV.feed.generated);
function feedAgeMin() { const g = feedTime(); return g ? Math.max(0, Math.round((Date.now() - g) / 60000)) : null; }
const recentCalls = () => { const now = Date.now() / 1000; return ((LV.feed && LV.feed.calls) || []).filter(c => now - c.ts < 90 * 60).length; };
function wxWord(w) { const c = w.weather_code | 0; const t = w.temperature_2m != null ? Math.round(w.temperature_2m) + '°' : ''; const s = c >= 95 ? 'Thunderstorm' : c >= 71 && c <= 77 || c === 85 || c === 86 ? 'Snow' : c >= 51 && c <= 67 || c >= 80 && c <= 82 ? 'Rain' : c === 45 || c === 48 ? 'Fog' : c >= 2 ? 'Cloudy' : 'Clear'; return `${s} ${t}`.trim(); }
function updateLiveUI() {
  const f = LV.feed, age = feedAgeMin(), fresh = LV.src === 'live' && age !== null && age < 45, el = $('liveStat');
  if (el) el.innerHTML = !f ? 'Live data unavailable right now. You will still get a simulated city.' : `<i class="dot ${fresh ? 'ok' : 'old'}"></i>${LV.src === 'live' ? 'Data' : LV.src === 'saved' ? 'Saved data' : 'Built-in data'} from ${timeOf(feedTime() / 1000)} · ${recentCalls()} recent calls · ${n0((f.roads || []).length + (f.cuts || []).length)} work permits · ${((f.s311 || {}).items || []).length} 311 reports${f.weather ? ' · ' + wxWord(f.weather) : ''}`;
  const b = $('liveBadge'); if (!b || !LV.kind) return;
  b.hidden = false; b.dataset.ok = String(fresh);
  b.querySelector('span').textContent = LV.kind === 'replay' ? 'REPLAY' : LV.src === 'live' ? 'LIVE' : f ? 'OFFLINE' : 'NO DATA';
  b.title = f ? `Data from ${timeOf(feedTime() / 1000)}. Tap for sources.` : 'No live data';
}

// ---------------------------------------------------------------- handing the data to the simulation
function worldInitFor(m, kind) { // m: shift | watch | whatif (live and replay run as watch)
  const mid = torontoMidnight(Date.now()), epoch0 = kind === 'replay' ? mid - 86400 : mid;
  return { epoch0, feed: LV.feed || LV.stat ? { static: LV.stat, live: LV.feed } : null,
    world: { kind: kind || null, epoch0, typical: m !== 'watch', weather: m === 'watch', buses: true } };
}
function replayStart(epoch0) { const now = Date.now() / 1000; const calls = (LV.feed && LV.feed.calls) || []; const first = calls.length ? Math.min(...calls.map(c => c.ts)) : now - 86400; return Math.max(now - 86400, first - 900) - epoch0; }
async function liveAfterReady() { // real calls go in once the player is watching, so each one is seen arriving
  if (!LV.feed) return;
  tvHooks(); setTimeout(areaAfterReady, 1200);
  if (LV.kind) {
    const r = await cmd('liveFeed', { live: { calls: LV.feed.calls, hwy: LV.feed.hwy } }, { calls: true, buses: false });
    const spots = LV.ws ? LV.ws.spots.length : 0;
    if (LV.kind === 'live') setTimeout(() => DIR.say('anchor', ['a:open', 'a:live'], 2), 2500);
    toast('LIVE', LV.kind === 'live' ? `Real Scarborough, ${timeOf(Date.now() / 1000)}. ${r.calls ? countOnScene() + ' real calls on scene, ' : ''}${r.zonesOn || 0} work zones active, ${spots} reported road hazards${r.busRoutes ? ', ' + r.busRoutes + ' TTC routes running' : ''}.` : `Replaying the last 24 hours: ${r.queue} real calls coming up. Use ⏭ to skip ahead.`, 'var(--green)');
  }
  // upstream refreshes every 5 min; check every 2 so new data lands within ~2 min. Buses: the relay caches the TTC feed for 20 s.
  if (LV.kind === 'live' || (mode === 'watch' && !LV.kind)) { clearInterval(LV.timer); LV.timer = setInterval(liveRefresh, 2 * 60 * 1000); }
  if (LV.kind === 'live' && BUS_RELAY) { pollBuses(); setInterval(pollBuses, 20000); document.addEventListener('visibilitychange', () => { if (!document.hidden) pollBuses(); }); }
}
function countOnScene() { return incidents.filter(i => i.real && i.state !== 'cleared').length || 'Several'; }
async function liveRefresh() {
  if (!ready) return; const before = LV.feed && LV.feed.generated; await loadFeed(false); if (!LV.feed || LV.feed.generated === before) return; if (H24.on) h24Bar();
  await cmd('liveFeed', { live: LV.feed }, { calls: LV.kind === 'live' });
}

// ---------------------------------------------------------------- TTC buses where they really are (GPS), Live mode only
// The TTC feed can't be read from a web page, so a small Cloudflare relay (relay/gridlock-buses.js in this repo) passes on
// Scarborough's buses. Asked every 30 s while the game is on screen; the relay asks the TTC at most every 20 s.
const BUS_RELAY = 'https://gridlock-buses.416freeze.workers.dev/';
const RB = { n: 0, at: 0, err: null };
async function pollBuses() {
  if (!ready || document.hidden) return;
  try {
    const r = await fetch(BUS_RELAY, { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json(); if (d.error) throw new Error(d.error);
    const first = !RB.n, res = await cmd('realBuses', d); Object.assign(RB, { n: res.buses, at: Date.now(), err: null });
    if (first && RB.n) toast('TTC', `${RB.n} real buses on the map, live from the TTC's GPS. Where they crawl, traffic slows to match.`, '#ff4b4b');
  } catch (e) { RB.err = String(e.message || e); }
}

// ---------------------------------------------------------------- what the worker sends back
function onWorld(d) {
  if (d.worldStatic) setWorld(d.worldStatic);
  if (d.zones) LV.zones = d.zones;
  if (d.world) worldTick(d.world);
}
function setWorld(ws) {
  const old = LV.ws, had = new Set(old ? old.shuttles.map(s => s.id) : []), has = new Set(ws.shuttles.map(s => s.id));
  if (!old) { R.setLandmarks(landmarks(ws)); R.setRails(ws.rails); }
  LV.ws = ws; LV.zones = ws.zones; LV.geo = null;
  for (const s of ws.shuttles) if (!had.has(s.id)) { const m = s.pts[s.pts.length >> 1]; onEvent({ k: 'shuttle', on: 1, name: s.name, header: s.header, x: m[0], y: m[1], t: simT }); }
  if (old) for (const s of old.shuttles) if (!has.has(s.id)) onEvent({ k: 'shuttle', on: 0, name: s.name, t: simT });
  if (old) return;
  if (ws.detours.length) onEvent({ k: 'detours', routes: [...new Set(ws.detours.map(d => d.route))], t: simT });
  if (ws.spots.length >= 10) onEvent({ k: 'hazards', n: ws.spots.length, t: simT });
}
function landmarks(ws) { // boxes for the real buildings: towers sized from homes per floor, schools and places of worship by type, long side along the street
  const out = [], street = (x, y) => { const r = roadPoint(x, y, 150); return r ? r.ang : 0; };
  for (const [x, y, st, units, ang] of ws.towers) { const area = Math.max(350, Math.min(2600, units * 95 / Math.max(1, st))), w = Math.sqrt(area * 2.2); out.push([x, y, ang, w, area / w, st * 2.9 + 2, 2]); }
  for (const s of ws.schools) { const [w, d, h] = { elem: [60, 32, 8], sec: [95, 50, 11], private: [32, 20, 7] }[s.kind]; out.push([s.x, s.y, street(s.x, s.y), w, d, h, 3]); }
  for (const w of ws.worship) out.push([w.x, w.y, street(w.x, w.y), 26, 16, 10, 3]);
  return out;
}
function worldGeo() { // page-side placement, worked out once per feed: kerb points, crosswalks, gate arms
  if (LV.geo || !LV.ws) return LV.geo; const ws = LV.ws;
  LV.geo = { schools: ws.schools.map((s, i) => ({ kerb: roadPoint(s.x, s.y, 120), walk: ws.guards[i] ? crosswalk(ws.guards[i]) : null })),
    worship: ws.worship.map(w => ({ kerb: roadPoint(w.x, w.y, 80) })), gates: ws.crossings.map(([x, y]) => gateArms(x, y, ws.rails)) };
  return LV.geo;
}
function roadPoint(x, y, r) { // nearest point on a road and its direction
  const n = nearestRoad(x, y, r); if (!n) return null; const p = pts(n.e); let best = null, bd = 1e18;
  for (let i = 0; i < p.length - 1; i++) { const [ax, ay] = p[i], [bx, by] = p[i + 1], vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy || 1, t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / l2));
    const qx = ax + vx * t, qy = ay + vy * t, d = (qx - x) ** 2 + (qy - y) ** 2; if (d < bd) { bd = d; best = { x: qx, y: qy, ang: Math.atan2(vy, vx), e: n.e }; } }
  return best;
}
function crosswalk([x, y]) { const r = roadPoint(x, y, 40); if (!r) return null; const hw = G.lanes[r.e] * 1.7 * (rev[r.e] >= 0 ? 2 : 1) + 1.5; // across the road, 12 m back from the corner
  const back = Math.atan2(y - r.y, x - r.x), ux = Math.cos(r.ang), uy = Math.sin(r.ang), s = (Math.cos(back) * ux + Math.sin(back) * uy) > 0 ? -12 : 12;
  const cx = x + ux * s, cy = y + uy * s, nx = -uy, ny = ux; return [cx - nx * hw, cy - ny * hw, cx + nx * hw, cy + ny * hw]; }
function gateArms(x, y, rails) { // track direction at the crossing; arms lie along the track, 7 m either side of it
  let ang = 0, bd = 1e18; for (const L of rails) for (let i = 0; i < L.length - 1; i++) { const [ax, ay] = L[i], [bx, by] = L[i + 1]; const d = Math.min((ax - x) ** 2 + (ay - y) ** 2, (bx - x) ** 2 + (by - y) ** 2); if (d < bd) { bd = d; ang = Math.atan2(by - ay, bx - ax); } }
  const nx = -Math.sin(ang), ny = Math.cos(ang); return { x, y, ang, arms: [[x + nx * 7, y + ny * 7], [x - nx * 7, y - ny * 7]], name: (() => { const r = nearestRoad(x, y, 40); return r ? nm(r.e) : 'the tracks'; })() };
}

// ---------------------------------------------------------------- city rhythms → toasts and the news desk (detected from state changes)
function worldTick(wl) {
  const p = LV.prev; LV.wl = wl; LV.prev = wl; if (!LV.ws || !p) return;
  const day = wl.day, key = day.date || 'typical', once = (k, f) => { if (!LV.seen.has(k + key)) { LV.seen.add(k + key); f(); } };
  if (day.holiday) once('hol', () => onEvent({ k: 'holiday', name: day.holiday, t: simT }));
  else if (day.dow < 5 && !day.school && simT % 86400 > 6 * 3600) once('nosch', () => onEvent({ k: 'noschool', t: simT }));
  const ph = s => s.filter(q => q[1] === 'am').length, pp = s => s.filter(q => q[1] === 'pm').length;
  if (ph(wl.schools) >= 20 && ph(p.schools) < 20) once('am', () => onEvent({ k: 'schools', phase: 'am', n: ph(wl.schools), t: simT }));
  if (pp(wl.schools) >= 20 && pp(p.schools) < 20) once('pm', () => onEvent({ k: 'schools', phase: 'pm', n: pp(wl.schools), t: simT }));
  if (wl.worship.length >= 15 && p.worship.length < 15) once('wor' + Math.floor(simT % 86400 / 7200), () => onEvent({ k: 'worship', n: wl.worship.length, t: simT }));
  const geo = worldGeo();
  for (const g of wl.gates) if (!p.gates.includes(g)) onEvent({ k: 'gate', i: g, name: geo.gates[g].name, x: geo.gates[g].x, y: geo.gates[g].y, t: simT });
  if (cam.wpp < 2.5 && wl.gates.some(g => inView(R.project(geo.gates[g].x, geo.gates[g].y, 0)))) snd('xbell');
}
function cityEvent(e) { // app.js onEvent hands over the kinds it doesn't know
  switch (e.k) {
    case 'shuttle': if (e.on) { snd('alert'); toast('TTC', `Subway closure: ${e.name}. Shuttle buses are running on the streets above.`, '#ff4b4b', () => flyTo(e.x, e.y, 5000)); } else toast('TTC', `Subway service is back: ${e.name}.`, '#ff4b4b'); break;
    case 'detours': toast('TTC', `Route${e.routes.length > 1 ? 's' : ''} ${e.routes.slice(0, 5).join(', ')}${e.routes.length > 5 ? '…' : ''} ${e.routes.length > 1 ? 'are' : 'is'} on detour today. Buses follow the real detour.`, '#ff4b4b'); break;
    case 'holiday': toast('CITY', `${e.name}. No school and Sunday bus service, so the roads are quieter.`, 'var(--green)'); break;
    case 'noschool': toast('SCHOOL', 'No school today (PA day or break). The morning rush is lighter.', '#ffd23f'); break;
    case 'schools': toast('SCHOOL', e.phase === 'am' ? `Drop-off at ${e.n} schools. School zones are down to 30 km/h and crossing guards are out.` : `School's out at ${e.n} schools. Parents are double-parked at the curb.`, '#ffd23f'); break;
    case 'worship': toast('CITY', `Services at ${e.n} places of worship. Curbs nearby are filling up.`, 'var(--violet)'); break;
    case 'gate': if (!e.quiet && !LV.seen.has('gateToast')) { LV.seen.add('gateToast'); toast('GO', `GO train crossing ${e.name}. The gates are down and traffic is waiting.`, '#39d98a', () => flyTo(e.x, e.y, 700)); }
      { const p = R.project(e.x, e.y, 0); if (p && cam.wpp < 4 && p[0] > 0 && p[0] < innerWidth && p[1] > 0 && p[1] < innerHeight) snd('trainhorn'); } break;
  }
}

// ---------------------------------------------------------------- sunrise / sunset for the sim's date (NOAA solar equations)
const sunCache = new Map();
function sunHours() { // [sunrise, sunset] in local clock hours; a normal mid-October day when the sim isn't on a real date
  const date = LV.wl && LV.wl.day.date; if (!date) return [7.45, 18.45]; let s = sunCache.get(date); if (s) return s;
  const [y, m, d] = date.split('-').map(Number), r = Math.PI / 180, lat = 43.77, lng = -79.23;
  const g = 2 * Math.PI / 365 * ((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 864e5);
  const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const dec = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const ha = Math.acos(Math.cos(90.833 * r) / (Math.cos(lat * r) * Math.cos(dec)) - Math.tan(lat * r) * Math.tan(dec)) / r;
  const off = +torontoParts(Date.UTC(y, m - 1, d, 12)).hour - 12, noon = 720 - 4 * lng - eq; // minutes after UTC midnight
  s = [(noon - 4 * ha) / 60 + off, (noon + 4 * ha) / 60 + off]; sunCache.set(date, s); return s;
}
function dayLabel() { // HUD: weekday + date of the sim day
  const d = LV.wl && LV.wl.day; if (!d || !d.date) return ['TUE', ''];
  const [y, m, dd] = d.date.split('-').map(Number); return [['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'][d.dow], `${['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][m - 1]} ${dd}${d.holiday ? ' · HOLIDAY' : ''}`];
}

// ---------------------------------------------------------------- drawing: sprites under the cars (A) and glows (B)
const near = (x, y, R2) => (x - cam.x) ** 2 + (y - cam.y) ** 2 < R2;
const lerp2 = (a, f) => [a[0] + (a[2] - a[0]) * f, a[1] + (a[3] - a[1]) * f];
function liveSpritesA(put) {
  if (cam.wpp > 4 || !LV.ws) return; const R2 = (cam.h * 1.7) ** 2, t = performance.now() / 1000, ws = LV.ws, wl = LV.wl, geo = worldGeo(), clock = simT % 86400;
  if (wl) for (const g of wl.gates) { const a = geo.gates[g]; for (const [x, y] of a.arms) put(x, y, 0.6, 7, 6, 1, 5, -a.ang); } // crossing gate arms
  if (cam.wpp > 3) return;
  for (const z of LV.zones) { if (!z.on || !z.cones || !near(z.x, z.y, R2)) continue; const cs = z.cones; for (let i = 0; i < cs.length; i += 2) put(cs[i], cs[i + 1], 0.3, 0.55, 20, 1, 2.2, 0); }
  if (wl) for (const i of wl.spots) { const s = ws.spots[i]; if (!near(s.x, s.y, R2)) continue;
    if (s.act === 'pothole') put(s.x, s.y, 0.05, 1.4, 22, 1, 3, s.x % 6); else if (s.act === 'sinkhole') put(s.x, s.y, 0.05, 3.2, 4, 1, 4, 0);
    else if (s.act === 'ponding') put(s.x, s.y, 0.05, 9, 5, 1, 6, 0); else for (let k = -1; k <= 1; k++) put(s.x + k * 3, s.y, 0.3, 0.55, 20, 1, 2.2, 0); }
  if (!wl || cam.wpp > 1.6) return; // people: only close up
  for (const [i, phase, crossing] of wl.schools) { const s = ws.schools[i], g = geo.schools[i]; if (!near(s.x, s.y, R2)) continue;
    if (g.kerb) for (let k = 0; k < 8; k++) { const f = (t * 0.05 + k / 8) % 1, a = phase === 'am' ? [g.kerb.x, g.kerb.y, s.x, s.y] : [s.x, s.y, g.kerb.x, g.kerb.y], [x, y] = lerp2(a, f); put(x + (k % 3 - 1) * 1.2, y + ((k >> 1) % 3 - 1) * 1.2, 0.2, 0.42, 23, Math.min(1, (1 - f) * 6, f * 6), 2.6, 0); }
    if (crossing && g.walk) for (let k = 0; k < 6; k++) { const f = (t * 0.09 + k * 0.07) % 1, [x, y] = lerp2(g.walk, f); put(x + (k % 2) * 0.9, y - (k % 3) * 0.9, 0.2, 0.42, 23, 1, 2.6, 0); }
    if (g.walk) { const [x, y] = lerp2(g.walk, 0.5); put(x, y, 0.25, 0.55, 23, 1, 3.2, 0); } } // the guard, mid-road with the sign
  const dow = wl.day.dow;
  for (const i of wl.worship) { const w = ws.worship[i], g = geo.worship[i]; if (!g.kerb || !near(w.x, w.y, R2)) continue;
    const sv = w.svc.find(([d, a, b]) => d === dow && clock >= a - 2100 && clock < b + 1800) || w.svc[0]; const arriving = clock < sv[1] + 300, leaving = clock > sv[2];
    if (!arriving && !leaving) continue; for (let k = 0; k < 10; k++) { const f = (t * 0.035 + k / 10) % 1, a = arriving ? [g.kerb.x, g.kerb.y, w.x, w.y] : [w.x, w.y, g.kerb.x, g.kerb.y], [x, y] = lerp2(a, f); put(x + ((k * 7) % 5 - 2) * 1.1, y + ((k * 3) % 5 - 2) * 1.1, 0.2, 0.42, 23, Math.min(1, (1 - f) * 6, f * 6), 2.6, 0); } }
}
function liveSpritesB(put) {
  if (!LV.ws) return; const n = envNight(), t = performance.now() / 1000, R2 = (cam.h * 1.8) ** 2, wl = LV.wl, ws = LV.ws;
  if (cam.wpp < 4 && n > 0.3) for (const z of LV.zones) { if (!z.on || !z.cones || z.cones.length < 2 || !near(z.x, z.y, R2)) continue; put(z.cones[0], z.cones[1], 1.2, 4, 21, n, 5, 0); const k = z.cones.length - 2; put(z.cones[k], z.cones[k + 1], 1.2, 4, 21, n, 5, 0); }
  if (!wl || cam.wpp > 4) return; const geo = worldGeo();
  for (const g of wl.gates) { const a = geo.gates[g]; if (!near(a.x, a.y, R2)) continue; a.arms.forEach(([x, y], k) => { const on = ((t * 1.6 | 0) + k) % 2; put(x + Math.cos(a.ang) * 5, y + Math.sin(a.ang) * 5, 1.2, 2.2, 17, on ? 1.4 : 0.15, 4, 0); put(x - Math.cos(a.ang) * 5, y - Math.sin(a.ang) * 5, 1.2, 2.2, 17, on ? 0.15 : 1.4, 4, 0); }); }
  for (const [i] of wl.schools) { const s = ws.schools[i], g = geo.schools[i]; if (g.kerb && near(s.x, s.y, R2)) put(g.kerb.x, g.kerb.y, 1.5, 3, 21, 0.9, 4, 0); } // flashing school-zone beacon
}

// ---------------------------------------------------------------- overlay: markers, cranes, shuttle routes (and what can be tapped)
function badge(c, x, y, icon, col, r, glow) {
  if (glow) { c.fillStyle = col; c.globalAlpha = 0.25 + 0.2 * Math.sin(performance.now() / 260); c.beginPath(); c.arc(x, y, r + 5, 0, 7); c.fill(); c.globalAlpha = 1; }
  c.fillStyle = 'rgba(6,9,13,.88)'; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); c.lineWidth = 2; c.strokeStyle = col; c.stroke();
  const img = iconPath(icon); if (img.complete) c.drawImage(img, x - r * 0.68, y - r * 0.68, r * 1.36, r * 1.36);
}
const inView = p => p && p[0] > -30 && p[0] < innerWidth + 30 && p[1] > 40 && p[1] < innerHeight + 30;
function liveOverlay(c) {
  areaRing(c);
  const hits = LV.hits; hits.length = 0; if (!LV.ws) return; const ws = LV.ws, wl = LV.wl, wpp = cam.wpp, t = performance.now() / 1000;
  const hit = (sel, p) => hits.push({ sel, x: p[0], y: p[1] });
  // TTC subway shuttles: dashed route + chip
  for (const s of ws.shuttles) { if (!s.pts || s.pts.length < 2) continue; c.save(); c.setLineDash([10, 7]); c.lineDashOffset = -t * 20; c.lineWidth = 3; c.strokeStyle = 'rgba(255,75,75,.85)'; c.beginPath(); let first = true;
    for (const [x, y] of s.pts) { const p = R.project(x, y, 0); if (!p) { first = true; continue; } first ? c.moveTo(p[0], p[1]) : c.lineTo(p[0], p[1]); first = false; } c.stroke(); c.restore();
    const m = s.pts[s.pts.length >> 1], p = R.project(m[0], m[1], 0); if (inView(p)) { badge(c, p[0], p[1], 'bus', '#ff4b4b', 11, true); hit({ k: 'shuttle', id: s.id }, p); } }
  // cranes over the big building sites (3-D: mast and a slowly slewing jib)
  if (wpp < 6) { const working = new Set(wl ? wl.sites : []), night = envNight();
    ws.sites.forEach((s, i) => { const b = R.project(s.x, s.y, 0); if (!inView(b)) return;
      if (s.crane) { const H = 48, top = R.project(s.x, s.y, H), a = (s.x * 0.01) + (working.has(i) ? Math.sin(t * 0.05 + i) * 1.4 : 0), jx = Math.cos(a), jy = Math.sin(a);
        const tip = R.project(s.x + jx * 42, s.y + jy * 42, H), tail = R.project(s.x - jx * 14, s.y - jy * 14, H), tro = 18 + (working.has(i) ? 16 * (0.5 + 0.5 * Math.sin(t * 0.13 + i)) : 10);
        const tr = R.project(s.x + jx * tro, s.y + jy * tro, H), hook = R.project(s.x + jx * tro, s.y + jy * tro, H * 0.45);
        if (top && tip && tail) { c.strokeStyle = '#ffc21a'; c.lineCap = 'round'; c.lineWidth = Math.max(1.2, 2.4 / Math.max(1, wpp)); c.beginPath(); c.moveTo(b[0], b[1]); c.lineTo(top[0], top[1]); c.moveTo(tail[0], tail[1]); c.lineTo(tip[0], tip[1]); c.stroke();
          if (tr && hook) { c.lineWidth = 0.8; c.strokeStyle = 'rgba(220,220,220,.7)'; c.beginPath(); c.moveTo(tr[0], tr[1]); c.lineTo(hook[0], hook[1]); c.stroke(); }
          if (night > 0.3 && (t * 0.8 + i) % 1.5 < 0.4) { c.fillStyle = '#ff3b2f'; c.beginPath(); c.arc(top[0], top[1], 2.4, 0, 7); c.fill(); } } }
      if (wpp < 3) { badge(c, b[0], b[1] + 14, 'crane', '#ffc21a', 9, false); hit({ k: 'site', id: i }, [b[0], b[1] + 14]); } }); }
  // 311 road hazards
  if (wpp < 3 && wl) for (const i of wl.spots) { const s = ws.spots[i], p = R.project(s.x, s.y, 0); if (!inView(p)) continue; badge(c, p[0], p[1] - 14, s.act === 'tree' ? 'tree' : 'pothole', '#ff6fb1', 8, false); hit({ k: 'spot', id: i }, [p[0], p[1] - 14]); }
  // schools (active ones visible further out), places of worship
  const act = new Map(wl ? wl.schools.map(q => [q[0], q]) : []);
  ws.schools.forEach((s, i) => { const on = act.has(i); if (!(wpp < 2.6 || (on && wpp < 6))) return; const p = R.project(s.x, s.y, 0); if (!inView(p)) return; badge(c, p[0], p[1], 'school', '#ffd23f', on ? 10 : 8, on); hit({ k: 'school', id: i }, p); });
  const wa = new Set(wl ? wl.worship : []);
  ws.worship.forEach((w, i) => { const on = wa.has(i); if (!(wpp < 2 || (on && wpp < 4))) return; const p = R.project(w.x, w.y, 0); if (!inView(p)) return; badge(c, p[0], p[1], 'worship', '#b98cff', on ? 9 : 7, on); hit({ k: 'worship', id: i }, p); });
  // roadwork and utility digs
  if (wpp < 6) for (const z of LV.zones) { if (!z.on) continue; const p = R.project(z.x, z.y, 0); if (!inView(p)) continue;
    const x = p[0], y = p[1] - 12; c.fillStyle = z.src === 'cut' ? '#ffb020' : '#ff8a1f'; c.beginPath(); c.moveTo(x, y - 8); c.lineTo(x + 8, y); c.lineTo(x, y + 8); c.lineTo(x - 8, y); c.closePath(); c.fill(); c.strokeStyle = 'rgba(0,0,0,.6)'; c.lineWidth = 1.2; c.stroke();
    c.fillStyle = '#111'; c.beginPath(); c.moveTo(x, y - 4.5); c.lineTo(x + 3, y + 3.5); c.lineTo(x - 3, y + 3.5); c.closePath(); c.fill(); hit({ k: 'zone', id: z.id }, [x, y]); }
  if (wpp < 3 && wl && wl.rb) for (const b of wl.rb) { const p = R.project(b[2], b[3], 2); if (inView(p)) hit({ k: 'rbus', id: b[0] }, p); } // real buses: tap the bus
  if (wpp < 3) enf().forEach((en, i) => { const p = R.project(en.x, en.y, 0); if (!inView(p)) return; badge(c, p[0], p[1], en.k === 'red' ? 'redlight' : 'speedcam', en.k === 'red' ? '#ff4b4b' : '#ffd23f', 7, false); hit({ k: 'enf', id: i }, p); });
  if (wl && wl.blk) for (const k of wl.blk) { const p = R.project(k[1], k[2], 0); if (!inView(p)) continue; badge(c, p[0], p[1] - 14, 'bus', '#ff7a00', wpp < 6 ? 11 : 8, true); hit({ k: 'blk', id: k[0] }, [p[0], p[1] - 14]); } // possible blockages
  if (H24.on) { for (const o of h24calls()) { if (H24.f && o.t !== H24.f) continue; const p = R.project(o.x, o.y, 0); if (!inView(p)) continue; // last 24 h: brighter = more recent
      const a = Math.max(0.45, 1 - o.age / 86400 * 0.55), r = (wpp > 8 ? 7 : wpp > 3 ? 9 : 11) + (o.age < 3600 ? 2 : 0); // badge: type icon in a coloured ring; fresh ones bigger and pulsing
      c.globalAlpha = a; badge(c, p[0], p[1] - r, o.t, H24COL[o.t], r, o.age < 3600); c.fillStyle = H24COL[o.t]; c.beginPath(); c.moveTo(p[0] - 3, p[1] - 2); c.lineTo(p[0] + 3, p[1] - 2); c.lineTo(p[0], p[1] + 2); c.fill(); c.globalAlpha = 1; hit({ k: 'h24', id: o.c.id }, [p[0], p[1] - r]); } }
  if (wpp < 4) cams().forEach((cm, i) => { const p = R.project(cm.x, cm.y, 0); if (!inView(p)) return; badge(c, p[0], p[1], 'camera', '#52c7ff', 8, false); hit({ k: 'cam', id: i }, p); });
  // apartment towers are tappable close up (no marker: the building is the marker)
  if (wpp < 1.5) ws.towers.forEach((tw, i) => { if (tw[2] < 6) return; const p = R.project(tw[0], tw[1], tw[2] * 1.5); if (inView(p)) hit({ k: 'tower', id: i }, p); });
  // REAL tags on live incident markers
  c.font = `700 8px ${getMono()}`;
  for (const i of incidents) { if (!i.real || i.state === 'cleared') continue; const p = R.project(i.x, i.y, 0); if (!p) continue; const x = p[0], y = p[1] - 22; c.fillStyle = '#39d98a'; roundRect(c, x - 13, y + 15, 26, 11, 5); c.fill(); c.fillStyle = '#04110a'; c.fillText('REAL', x, y + 20.5); }
}
function pickWorld(px, py) { let best = null, bd = 20 * 20; for (const h of LV.hits) { const d = (h.x - px) ** 2 + (h.y - py) ** 2; if (d < bd) { bd = d; best = h.sel; } } return best; }

// ---------------------------------------------------------------- inspect sheets
const WORLD_SEL = new Set(['zone', 'spot', 'school', 'worship', 'site', 'shuttle', 'tower', 'rbus', 'cam', 'live', 'blk', 'enf', 'h24']);
// ---------------- traffic cameras (City intersections + 511 highways): tap for the latest still, refreshed every minute while open
let CAMS = null;
function cams() { // [{src, name, x, y, views: [[label, url]]}] in map coordinates
  if (CAMS || !LV.stat || !LV.stat.cameras) return CAMS || []; const P = G.proj;
  return (CAMS = LV.stat.cameras.map(c => Object.assign({}, c, { x: (c.lng - P.lon0) * P.kx, y: -(c.lat - P.lat0) * P.ky }))); }
// ---------------- last 24 hours: every real police / fire / medical call, fading with age. On by default in Today, Replayed.
const H24 = { on: false, f: null, cache: null, at: 0 }; // f: null = all types, or 'police' | 'fire' | 'medical'
const H24COL = { police: '#52c7ff', fire: '#ff8a1f', medical: '#ff4f6d' };
function h24calls() { // [{c, t, x, y, age}] — recomputed at most every 5 s
  const nowMs = Date.now(); if (H24.cache && nowMs - H24.at < 5000) return H24.cache; const now = nowMs / 1000, P = G.proj; H24.at = nowMs;
  return (H24.cache = ((LV.feed && LV.feed.calls) || []).filter(c => now - c.ts < 86400 && now - c.ts > -600)
    .map(c => ({ c, t: c.src === 'tps' ? 'police' : c.act === 'medical' ? 'medical' : 'fire', x: (c.lng - P.lon0) * P.kx, y: -(c.lat - P.lat0) * P.ky, age: Math.max(0, now - c.ts) }))); }
function h24Set(on) { H24.on = on; const b = $('h24Btn'); if (b) b.setAttribute('aria-pressed', String(on)); h24Bar(); }
function h24Bar() {
  const el = $('h24bar'); if (!el) return; if (!H24.on) { el.hidden = true; return; } H24.cache = null; const L = h24calls(), n = t => L.filter(o => o.t === t).length;
  const span = L.length ? Math.round(Math.max(...L.map(o => o.age)) / 3600) : 0;
  el.hidden = false; el.innerHTML = `<b>${span >= 23 ? 'Last 24 h' : L.length ? `Last ${Math.max(1, span)} h (filling to 24)` : 'Last 24 h'}</b>`
    + ['police', 'fire', 'medical'].map(t => `<button type="button" data-h24="${t}" aria-pressed="${H24.f === t}" style="--c:${H24COL[t]}"><i></i>${n(t)} ${t}</button>`).join('') + (L.length ? '' : '<span>No calls yet</span>');
}
document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-h24]'); if (b) { H24.f = H24.f === b.dataset.h24 ? null : b.dataset.h24; h24Bar(); return; } if (e.target.closest && e.target.closest('#h24Btn')) h24Set(!H24.on); });
setInterval(() => { if (H24.on) h24Bar(); }, 60000);
let ENF = null;
function enf() { // speed + red-light cameras [{k, name, x, y, since}]
  if (ENF || !LV.stat || !LV.stat.enforce) return ENF || []; const P = G.proj;
  return (ENF = LV.stat.enforce.map(c => Object.assign({}, c, { x: (c.lng - P.lon0) * P.kx, y: -(c.lat - P.lat0) * P.ky }))); }
document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-cam]'); if (b) select({ k: 'cam', id: +b.dataset.cam }); });
function nearestCam(x, y, r = 600) { let best = -1, bd = r * r; cams().forEach((c, i) => { const d = (c.x - x) ** 2 + (c.y - y) ** 2; if (d < bd) { bd = d; best = i; } }); return best; }
const camSrc = url => url + (url.includes('?') ? '&' : '?') + 't=' + Math.floor(Date.now() / 60000);
document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('.camtab'); if (!b) return; const img = document.querySelector('#sheet img.cam'); if (!img) return;
  img.dataset.src = b.dataset.url; img.src = camSrc(b.dataset.url); img.parentElement.classList.remove('off'); document.querySelectorAll('#sheet .camtab').forEach(t => t.setAttribute('aria-pressed', String(t.dataset.url === b.dataset.url))); if (CAMFS.on) camfsSync(); });
setInterval(() => { const img = document.querySelector('#sheet img.cam'); if (img) img.src = camSrc(img.dataset.src); const f = document.querySelector('#camfs img'); if (f && CAMFS.on) f.src = camSrc(f.dataset.src); }, 60000);

// full-screen camera: tap the photo in the panel. Pinch / scroll to zoom (up to 4x), drag to pan, double-tap toggles 2x,
// X / Esc / swipe down closes. The direction tabs come along.
const CAMFS = { on: false, k: 1, x: 0, y: 0, pts: new Map(), d0: 0, k0: 1, lastTap: 0, sy: 0 };
function camfsOpen() {
  const src = document.querySelector('#sheet img.cam'); if (!src) return;
  let el = document.getElementById('camfs');
  if (!el) {
    el = document.createElement('div'); el.id = 'camfs'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Camera, full screen');
    el.innerHTML = '<div class="cf-top"><span class="cf-t"></span><button class="cf-x" type="button" aria-label="Close">×</button></div><div class="cf-stage"><img alt="Camera image"></div><div class="cf-tabs"></div>';
    document.body.appendChild(el);
    const stage = el.querySelector('.cf-stage'), img = stage.querySelector('img');
    el.querySelector('.cf-x').onclick = camfsClose;
    for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'wheel', 'click', 'touchmove']) el.addEventListener(t, e => e.stopPropagation(), { passive: t !== 'wheel' });
    stage.addEventListener('wheel', e => { e.preventDefault(); camfsZoom(CAMFS.k * Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY); }, { passive: false });
    stage.addEventListener('pointerdown', e => { stage.setPointerCapture(e.pointerId); CAMFS.pts.set(e.pointerId, [e.clientX, e.clientY]); CAMFS.sy = e.clientY;
      if (CAMFS.pts.size === 2) { const [a, b] = [...CAMFS.pts.values()]; CAMFS.d0 = Math.hypot(a[0] - b[0], a[1] - b[1]); CAMFS.k0 = CAMFS.k; }
      const now = performance.now(); if (CAMFS.pts.size === 1 && now - CAMFS.lastTap < 300) { camfsZoom(CAMFS.k > 1.2 ? 1 : 2, e.clientX, e.clientY); CAMFS.lastTap = 0; } else CAMFS.lastTap = now; });
    stage.addEventListener('pointermove', e => { const p = CAMFS.pts.get(e.pointerId); if (!p) return;
      if (CAMFS.pts.size === 2) { CAMFS.pts.set(e.pointerId, [e.clientX, e.clientY]); const [a, b] = [...CAMFS.pts.values()]; camfsZoom(CAMFS.k0 * Math.hypot(a[0] - b[0], a[1] - b[1]) / (CAMFS.d0 || 1), (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); return; }
      if (CAMFS.k > 1.01) { CAMFS.x += e.clientX - p[0]; CAMFS.y += e.clientY - p[1]; camfsApply(); } else { img.style.transform = `translateY(${Math.max(0, e.clientY - CAMFS.sy)}px)`; }
      CAMFS.pts.set(e.pointerId, [e.clientX, e.clientY]); });
    const up = e => { CAMFS.pts.delete(e.pointerId); if (CAMFS.k <= 1.01 && !CAMFS.pts.size) { if (e.clientY - CAMFS.sy > 110) camfsClose(); else camfsApply(); } };
    stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
    el.querySelector('.cf-tabs').addEventListener('click', e => { const b = e.target.closest('.camtab'); if (!b) return; const sb = [...document.querySelectorAll('#sheet .camtab')].find(t => t.dataset.url === b.dataset.url); if (sb) sb.click(); camfsSync(); });
    img.onerror = () => el.classList.add('off'); img.onload = () => el.classList.remove('off');
  }
  CAMFS.on = true; CAMFS.k = 1; CAMFS.x = CAMFS.y = 0; CAMFS.pts.clear(); el.hidden = false; camfsSync(); camfsApply();
}
function camfsSync() { // mirror the panel: title, current view, tabs
  const el = document.getElementById('camfs'), src = document.querySelector('#sheet img.cam'); if (!el || !src) return;
  const img = el.querySelector('img'); if (img.dataset.src !== src.dataset.src) { img.dataset.src = src.dataset.src; img.src = camSrc(src.dataset.src); CAMFS.k = 1; CAMFS.x = CAMFS.y = 0; camfsApply(); }
  el.querySelector('.cf-t').textContent = (document.querySelector('#sheet h2') || {}).textContent || 'Camera';
  el.querySelector('.cf-tabs').innerHTML = [...document.querySelectorAll('#sheet .camtab')].map(t => t.outerHTML).join('');
}
function camfsZoom(k, cx, cy) { // zoom about the point under the finger / cursor
  const stage = document.querySelector('#camfs .cf-stage').getBoundingClientRect(); k = Math.max(1, Math.min(4, k));
  const ox = cx - stage.left - stage.width / 2, oy = cy - stage.top - stage.height / 2, f = k / CAMFS.k;
  CAMFS.x = ox - (ox - CAMFS.x) * f; CAMFS.y = oy - (oy - CAMFS.y) * f; CAMFS.k = k; if (k === 1) CAMFS.x = CAMFS.y = 0; camfsApply();
}
function camfsApply() { const img = document.querySelector('#camfs img'); if (!img) return; const st = img.parentElement.getBoundingClientRect();
  const mx = st.width * (CAMFS.k - 1) / 2, my = st.height * (CAMFS.k - 1) / 2; CAMFS.x = Math.max(-mx, Math.min(mx, CAMFS.x)); CAMFS.y = Math.max(-my, Math.min(my, CAMFS.y));
  img.style.transform = `translate(${CAMFS.x}px, ${CAMFS.y}px) scale(${CAMFS.k})`; }
function camfsClose() { const el = document.getElementById('camfs'); if (el) el.hidden = true; CAMFS.on = false; }
document.addEventListener('click', e => { if (e.target.matches && e.target.matches('#sheet img.cam')) camfsOpen(); });
addEventListener('keydown', e => { if (CAMFS.on && e.key === 'Escape') { e.stopPropagation(); camfsClose(); } }, true);
function worldItem(sel) { const ws = LV.ws; if (!ws) return null;
  if (sel.k === 'zone') return LV.zones.find(z => z.id === sel.id); if (sel.k === 'shuttle') return ws.shuttles.find(s => s.id === sel.id);
  if (sel.k === 'rbus') return LV.wl && LV.wl.rb.find(b => b[0] === sel.id); if (sel.k === 'cam') return cams()[sel.id];
  if (sel.k === 'h24') return h24calls().find(o => o.c.id === sel.id);
  if (sel.k === 'blk') return LV.wl && (LV.wl.blk || []).find(b => b[0] === sel.id); if (sel.k === 'enf') return enf()[sel.id];
  const list = { spot: ws.spots, school: ws.schools, worship: ws.worship, site: ws.sites, tower: ws.towers }[sel.k]; return list ? list[sel.id] : null; }
function worldPos(sel) { const it = worldItem(sel); if (!it) return null; if (sel.k === 'tower') return [it[0], it[1]]; if (sel.k === 'rbus') return [it[2], it[3]]; if (sel.k === 'blk') return [it[1], it[2]]; if (sel.k === 'h24') return [it.x, it.y]; if (sel.k === 'shuttle') return it.pts[it.pts.length >> 1]; return [it.x, it.y]; }
function worldSheetKey(sel) { const wl = LV.wl || {}; return sel.k + sel.id + (LV.feed && LV.feed.generated) + (sel.k === 'school' ? JSON.stringify((wl.schools || []).find(q => q[0] === sel.id)) : sel.k === 'worship' ? (wl.worship || []).includes(sel.id) : sel.k === 'site' ? (wl.sites || []).includes(sel.id) : sel.k === 'rbus' ? String((worldItem(sel) || [])[4]) : sel.k === 'blk' ? JSON.stringify(worldItem(sel)) : ''); }
const head = (icon, col, title, sub) => `<div class="sh-head">${svg(icon, col)}<div><h2>${esc(title)}</h2><div class="sub">${esc(sub)}</div></div><button class="sh-x" type="button" aria-label="Close">×</button></div>`;
const facts = rows => `<div class="facts">${rows.map(([b, s]) => `<div class="fact"><b${String(b).length > 9 ? ' style="font-size:13px"' : ''}>${b}</b><span>${s}</span></div>`).join('')}</div>`;
const body = (html, real) => `<div class="sh-body">${html}${real ? `<br><span class="real">REAL</span> ${real}` : ''}</div>`;
const dateLong = s => s ? new Date(s + 'T12:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const DAYS = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'];
function worldSheetHtml(sel) {
  if (sel.k === 'live') return liveSourcesHtml();
  const it = worldItem(sel); if (!it) return null; const wl = LV.wl || { schools: [], worship: [], sites: [] };
  switch (sel.k) {
    case 'zone': { const z = it, cut = z.src === 'cut', until = z.end ? new Date(z.end * 1000).toLocaleDateString('en-CA', { timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric' }) : dateLong(z.dto) || 'further notice';
      const eff = z.full ? 'The road is closed here. Drivers are detouring.' : z.impact === 'High' || cut ? 'A lane is closed. Traffic squeezes past the work.' : 'Crews are working at the curb. Drivers slow down past it.';
      return head('cone', cut ? '#ffb020' : '#ff8a1f', `${cut ? 'Utility dig' : 'Roadwork'} · ${z.road || 'Road'}`, z.from && z.to && z.from !== z.to ? `${z.from} to ${z.to}` : z.from ? 'Near ' + z.from : '')
        + facts([[z.full ? 'Closed' : z.impact === 'High' || cut ? 'Lane closed' : 'Curb work', 'In the sim'], [until, 'Permit ends'], [z.on ? 'Active' : 'Off now', cut ? 'Crew hours today' : "Today's schedule"]])
        + body(`${eff}${z.why ? ' Work: ' + esc(z.why) + '.' : ''}${z.who ? ' ' + (cut ? 'Utility' : 'Contractor') + ': ' + esc(z.who) + '.' : ''}${cut ? ' The permit covers months; a crew is on site only some days, so the sim picks which days.' : ''}`, cut ? `City of Toronto utility cut permit ${esc(z.rid || '')}` : `City of Toronto road restriction ${esc(z.rid || '')}`); }
    case 'spot': { const s = it, what = { pothole: 'Drivers brake for the hole, then roll over it.', sinkhole: 'Drivers slow right down to get around it.', ponding: 'Water pools in the curb lane when it rains, so drivers move over.', tree: 'A fallen tree or branch blocks the curb lane.', debris: 'Debris in the curb lane. Drivers move over.' }[s.act] || '';
      return head(s.act === 'tree' ? 'tree' : 'pothole', '#ff6fb1', s.type, `Reported ${dateLong(s.date)} · ${s.fsa}`) + facts([[esc(s.status), 'City status'], [s.fsa, 'Postal area'], [s.act === 'ponding' ? (rainOn ? 'Flooded' : 'Dry now') : 'Slowing', 'In the sim']])
        + body(`${what} The City only publishes the postal area of each request, so the exact street here is an estimate.`, 'Toronto 311 service request, still open'); }
    case 'school': { const s = it, q = wl.schools.find(r => r[0] === sel.id), kind = { elem: 'Elementary school', sec: 'Secondary school', private: 'Private school' }[s.kind];
      const day = LV.wl && LV.wl.day, state = q ? (q[1] === 'am' ? 'Drop-off now' : 'Pickup now') : day && !day.school ? 'No school today' : 'Quiet';
      return head('school', '#ffd23f', s.name, kind) + facts([[hm(s.bell), 'Bell (estimated)'], [hm(s.end), 'Dismissal'], [state, 'Right now']])
        + body(`Parents double-park at the curb before the bell and at dismissal, and the school zone drops to 30 km/h.${s.kind === 'elem' ? ' A crossing guard holds traffic at the nearest big intersection.' : ''} Bell times aren't published as data, so each school gets a typical one.`, 'Toronto school locations · TDSB school-year calendar (PA days, breaks)'); }
    case 'worship': { const w = it, on = wl.worship.includes(sel.id), svc = w.svc.map(([d, a, b]) => `${DAYS[d]} ${hm(a)}–${hm(b)}`).join(', ');
      return head('worship', '#b98cff', w.name, w.faith) + facts([[on ? 'Service on' : 'Quiet', 'Right now'], [w.svc.length, w.svc.length > 1 ? 'Services a week' : 'Service a week']])
        + body(`Typical service times for a ${esc(w.faith)} congregation: ${svc}. Cars arrive and park along the street before, and leave together after. Big ones fill the curb lane.`, 'City of Toronto places of worship'); }
    case 'site': { const s = it, on = wl.sites.includes(sel.id);
      return head('crane', '#ffc21a', s.addr, s.use || 'New building') + facts([[s.units ? n0(s.units) : '—', 'New homes'], [s.cost ? '$' + (s.cost >= 1e6 ? Math.round(s.cost / 1e6) + 'M' : n0(s.cost)) : '—', 'Construction value'], [on ? 'Working' : 'Off now', 'Site hours 7–4:30']])
        + body(`${s.desc ? esc(s.desc) + (/[.…!]$/.test(s.desc) ? ' ' : '. ') : ''}Dump trucks run in and out all day${s.crane ? ', the tower crane is up' : ''}.`, 'City of Toronto active building permit'); }
    case 'shuttle': { const s = it;
      return head('bus', '#ff4b4b', `Subway closure · ${s.name}`, 'Shuttle buses running') + body(`${esc(s.header || '')} Shuttle buses run between the closed stations on the street, every few minutes in each direction, and they block a lane at every stop.`, 'TTC service alert (GTFS-Realtime)'); }
    case 'cam': { const c = it, v = c.views[0];
      return head('camera', 'var(--cyan)', c.name, c.src === '511' ? 'Ontario 511 highway camera' : 'City of Toronto traffic camera')
        + `<div class="camv"><img class="cam" alt="Latest camera image, tap for full screen" title="Tap for full screen" data-src="${esc(v[1])}" src="${esc(camSrc(v[1]))}" onerror="this.parentElement.classList.add('off')" onload="this.parentElement.classList.remove('off')"><span>Camera offline right now</span></div>`
        + (c.views.length > 1 ? `<div class="acts">${c.views.map(([l, u], i) => `<button class="act camtab" type="button" data-url="${esc(u)}" aria-pressed="${i === 0}">${esc(l)}</button>`).join('')}</div>` : '')
        + body(`A still photo, refreshed every minute while this is open${c.src === 'city' ? '. The time it was taken is printed on the image' : ''}.`, c.src === '511' ? 'Ontario 511 camera feed' : 'City of Toronto traffic cameras'); }
    case 'rbus': { const [num, route, , , kmh] = it, r = ((LV.stat && LV.stat.ttc) || []).find(q => q.route === route);
      return head('bus', '#ff4b4b', `${route} ${r ? r.name : ''}`.trim(), 'Real TTC bus · live GPS') + facts([[kmh == null ? '—' : kmh < 2 ? 'Stopped' : kmh + ' km/h', 'Speed lately'], [esc(num), 'Bus number']])
        + body("This is where the real bus is, updated every 20 seconds. When real buses crawl on a road, the game's cars there slow down to match.", "TTC GTFS-Realtime vehicle positions"); }
    case 'h24': { const { c, t, age } = it, when = new Date(c.ts * 1000).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' }),
        ago = age < 3600 ? Math.max(1, Math.round(age / 60)) + ' min ago' : (age / 3600).toFixed(1).replace(/\.0$/, '') + ' h ago';
      return head(t, H24COL[t], c.label || (t === 'police' ? 'Police call' : 'Fire call'), c.loc || 'Scarborough')
        + facts([[esc(when), 'Time'], [ago, 'How long ago'], [t === 'police' ? 'Police' + (c.div ? ' · ' + esc(String(c.div)) : '') : 'Fire', 'Responded']])
        + body((c.units && c.units.length ? `Units: ${esc(c.units.join(', '))}. ` : '') + 'One of the real calls from the last 24 hours.', t === 'police' ? 'Toronto Police calls for service' : 'Toronto Fire active incidents'); }
    case 'blk': { const [, x, y, n, routes, mins, road] = it, ci = nearestCam(x, y);
      return head('bus', '#ff7a00', 'Possible blockage', road || 'Scarborough') + facts([[n, 'Buses stopped'], [mins + ' min', 'Not moving'], [esc(routes), 'Routes']])
        + body(`${n} real TTC buses have been stopped here for ${mins} minutes, away from any station or end of the line. That usually means something is blocking the road (a crash, a stalled vehicle, police activity) before it shows up in any official feed. Cars here are slowed down while it lasts.`, 'TTC live bus GPS, read by GRIDLOCK')
        + (ci >= 0 ? `<div class="acts"><button class="act" type="button" data-cam="${ci}">Nearest camera</button></div>` : ''); }
    case 'enf': { const red = it.k === 'red';
      return head(red ? 'redlight' : 'speedcam', red ? '#ff4b4b' : '#ffd23f', it.name, red ? 'Red light camera' : 'Speed camera')
        + (red && it.since ? facts([[esc(it.since.slice(0, 4)), 'Watching since']]) : '')
        + body(red ? 'Photographs vehicles that enter the intersection on a red.' : 'Automated speed enforcement. In the sim, drivers ease off as they pass it.', 'City of Toronto open data'); }
    case 'tower': { const [, , st, units, , addr, built] = it;
      return head('tower', 'var(--cyan)', addr || 'Apartment building', `${st} storeys`) + facts([[n0(units), 'Homes'], [built || '—', 'Built'], [n0(Math.round(units * 0.55)), 'Cars, roughly']])
        + body('Trips in this neighbourhood start at real apartment buildings in proportion to how many homes they have, so the towers empty out in the morning rush.', 'City of Toronto apartment building registry'); }
  }
  return null;
}
function hoodCensusHtml(h) { // census line for a neighbourhood sheet
  const c = LV.ws && LV.ws.census.find(q => { let inside = false; const P = q.poly, x = h.x, y = h.y; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > y) !== (P[j][1] > y) && x < (P[j][0] - P[i][0]) * (y - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0]) inside = !inside; return inside; });
  if (!c) return ''; const pc = v => Math.round(v / c.commuters * 100) + '%';
  return facts([[n0(c.pop), 'People (2021)'], [pc(c.car), 'Drive to work'], [pc(c.transit), 'Take transit']]) + `<div class="sh-body" style="font-size:12px;color:var(--muted)"><span class="real">REAL</span> 2021 Census, ${esc(c.name)}. Areas where more people drive send more cars on school runs.</div>`;
}
function realLine(i) {
  if (!i.real) return ''; const r = i.real; const src = r.src === 'tps' ? 'Toronto Police public calls feed' : r.src === 'tfs' ? 'Toronto Fire Services active incidents' : r.src === '511' ? 'Ontario 511' : 'Live feed';
  return `<div class="sh-body" style="font-size:12.5px;color:var(--muted)"><span class="real">REAL</span> ${src}${r.label ? ` · “${esc(r.label)}”` : ''}${r.units ? ' · units ' + r.units.join(', ') : ''}. The call is real; the traffic around it is simulated.</div>`;
}
const SOURCES = [ // [status key, label, which feed]
  ['tps', 'Toronto Police calls', 'live'], ['tfs', 'Toronto Fire calls', 'live'], ['511', 'Ontario 511 highways', 'live'], ['roads', 'City roadwork permits', 'live'], ['cuts', 'Utility digs (cut permits)', 'live'],
  ['311', '311 road hazards', 'live'], ['ttc_alerts', 'TTC service alerts', 'live'], ['ttc_detours', 'TTC bus detours', 'live'], ['weather', 'Weather now', 'live'], ['alerts', 'Weather warnings', 'live'], ['rates', 'Call history (rates)', 'live'],
  ['ttc', 'TTC routes and schedules', 'static'], ['go', 'GO train timetable', 'static'], ['crossings', 'Railway level crossings', 'static'], ['schools', 'Schools', 'static'], ['towers', 'Apartment towers', 'static'],
  ['sites', 'Building sites', 'static'], ['worship', 'Places of worship', 'static'], ['hoods', '2021 Census by neighbourhood', 'static'], ['calendar', 'Holidays and school calendar', 'static'], ['cameras', 'Traffic cameras', 'static'], ['enforce', 'Speed and red-light cameras', 'static'], ['stations', 'Fire stations', 'static']];
function liveSourcesHtml() {
  const f = LV.feed, stl = (f && f.status) || {}, sts = (LV.stat && LV.stat.status) || {}, age = feedAgeMin();
  const row = ([k, label, which]) => { const v = (which === 'live' ? stl : sts)[k]; const ok = /^live/.test(v || ''), kept = /kept last good/.test(v || ''); return `<span>${label}</span><b class="${ok ? 'good' : kept ? 'warn' : v ? 'bad' : ''}" title="${esc(v || '')}">${ok ? '✓ ' + (v.replace(/^live\s*\(?|\)$/g, '').split(/[ ,]/)[0] || '') : v && /^off/.test(v) ? 'off' : kept || (v && /^stale/.test(v)) ? '✓ last copy' : v ? 'unavailable' : '—'}</b>`; };
  return head('traffic', 'var(--green)', 'Live data', f ? `${LV.src === 'live' ? 'Fetched just now' : LV.src === 'saved' ? 'Using the last saved copy' : 'Using the copy built into this file'} · data from ${age} min ago${LV.statSrc !== 'live' ? ` · daily data: ${LV.statSrc === 'saved' ? 'saved copy' : 'built-in copy'}` : ''}` : 'No data')
    + `<div class="rep" style="font-size:13px">${SOURCES.map(row).join('')}<span>TTC live bus GPS</span><b class="${RB.at && Date.now() - RB.at < 120000 ? 'good' : RB.err ? 'bad' : ''}">${RB.at && Date.now() - RB.at < 120000 ? '✓ ' + RB.n : RB.err ? 'unavailable' : LV.kind === 'live' ? '—' : 'Live mode only'}</b></div>`
    + body(`Cars are simulated. What happens to them is real: calls, roadwork, digs, 311 reports, TTC alerts and weather are collected every 5 minutes and checked here every 2 minutes; bus GPS every 20 seconds; camera photos every minute. Timetables, cameras, schools, towers, building sites and the census are refreshed daily.${LV.err ? `<br><span style="color:var(--muted)">Last fetch problem: ${esc(LV.err)}</span>` : ''}`);
}
// ---------------- My area: type the first three characters of a postal code. The camera flies there, a ring marks the area,
// and a panel counts what is going on inside it right now. Remembered between visits.
const AREA = { fsa: store.get('myfsa', null), g: null, open: false, edit: false, msg: '' };
function areaGeom(code) { // centre and radius (map metres) from the FSA's sample points; the median ignores strays
  const pts = (LV.stat && LV.stat.fsa && LV.stat.fsa[code]) || []; if (pts.length < 3) return null; const P = G.proj;
  const xs = pts.map(p => (p[1] - P.lon0) * P.kx), ys = pts.map(p => -(p[0] - P.lat0) * P.ky), med = a => a.slice().sort((p, q) => p - q)[a.length >> 1];
  const x = med(xs), y = med(ys), d = xs.map((v, i) => Math.hypot(v - x, ys[i] - y)).sort((p, q) => p - q);
  return { x, y, r: Math.min(2400, Math.max(700, d[Math.floor(d.length * 0.8)])) };
}
function areaCodes() { return Object.keys((LV.stat && LV.stat.fsa) || {}).sort(); }
function areaSet(raw, fly = true) {
  const code = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
  if (code.length < 3) { AREA.msg = 'Enter the first 3 characters, like M1K.'; areaBar(); return false; }
  const g = areaGeom(code);
  if (!g) { AREA.msg = `${code} isn't in the Scarborough map. Try: ${areaCodes().join(' ')}`; areaBar(); return false; }
  AREA.fsa = code; AREA.g = g; AREA.edit = false; AREA.msg = ''; store.set('myfsa', code); areaBar();
  if (fly) { DIR.hold(90000); flyTo(g.x, g.y, Math.min(4400, Math.max(1700, g.r * 3))); }
  return true;
}
function areaStats() {
  const g = AREA.g, r2 = g.r * g.r, P = G.proj, now = Date.now() / 1000, within = (x, y) => (x - g.x) ** 2 + (y - g.y) ** 2 <= r2;
  const calls = ((LV.feed && LV.feed.calls) || []).filter(c => now - c.ts < 86400 && within((c.lng - P.lon0) * P.kx, -(c.lat - P.lat0) * P.ky));
  const n = f => calls.filter(f).length, hour = calls.filter(c => now - c.ts < 3600).length;
  const live = incidents.filter(i => i.state !== 'cleared' && within(i.x, i.y)), hwy = live.filter(i => i.type === 'hwy').length;
  const zones = (LV.zones || []).filter(z => z.on && within(z.x, z.y)).length;
  const cs = cams().map((c, i) => ({ i, c })).filter(o => within(o.c.x, o.c.y)).sort((a, b) => Math.hypot(a.c.x - g.x, a.c.y - g.y) - Math.hypot(b.c.x - g.x, b.c.y - g.y));
  const enfN = enf().filter(c => within(c.x, c.y)).length;
  return { total: calls.length, hour, pol: n(c => c.src === 'tps'), fire: n(c => c.src !== 'tps' && c.act !== 'medical'), med: n(c => c.src !== 'tps' && c.act === 'medical'), onScene: live.filter(i => i.type === 'call').length, hwy, zones, cams: cs, enfN };
}
function areaBar() {
  const el = $('areabar'); if (!el) return; const b = $('areaBtn'); if (b) b.setAttribute('aria-pressed', String(AREA.open));
  if (!AREA.open) { el.hidden = true; return; } el.hidden = false;
  if (AREA.edit || !AREA.g) {
    el.innerHTML = `<b>My area</b><form id="areaForm"><input id="areaIn" maxlength="3" size="4" placeholder="M1K" autocomplete="postal-code" autocapitalize="characters" spellcheck="false" aria-label="First 3 characters of your postal code" value="${AREA.fsa || ''}"><button type="submit">Go</button><button type="button" data-area="close" aria-label="Close">×</button></form><span>${esc(AREA.msg) || 'First 3 characters of your postal code.'}</span>`;
    const inp = $('areaIn'); inp.addEventListener('keydown', e => e.stopPropagation()); setTimeout(() => inp.focus(), 30);
    $('areaForm').onsubmit = e => { e.preventDefault(); areaSet(inp.value); }; return;
  }
  const s = areaStats(), line = (v, t) => `<div><em>${v}</em><span>${t}</span></div>`;
  el.innerHTML = `<b>${AREA.fsa} · near you</b><div class="areagrid">${line(s.onScene, 'calls on scene now')}${line(s.total, 'calls in 24 h')}${line(s.pol + ' / ' + s.fire + ' / ' + s.med, 'police / fire / medical')}${line(s.zones, 'work zones active')}${line(s.hwy, 'highway incidents')}${line(s.cams.length + s.enfN, 'cameras (' + s.cams.length + ' view, ' + s.enfN + ' enforcement)')}</div>`
    + `<div class="areaact">${s.cams.length ? `<button type="button" data-cam="${s.cams[0].i}">Nearest camera</button>` : ''}<button type="button" data-area="edit">Change</button><button type="button" data-area="close" aria-label="Close">×</button></div>`;
}
function areaRing(c) {
  if (!AREA.g || !AREA.fsa) return; const g = AREA.g, p = R.project(g.x, g.y, 0), q = R.project(g.x + g.r, g.y, 0), q2 = R.project(g.x, g.y + g.r, 0); if (!p || !q || !q2) return;
  const rx = Math.hypot(q[0] - p[0], q[1] - p[1]), ry = Math.hypot(q2[0] - p[0], q2[1] - p[1]); if (rx < 30) return; // too far out: the ring would be a speck
  c.save(); c.setLineDash([8, 8]); c.lineDashOffset = -performance.now() / 80; c.strokeStyle = 'rgba(82,199,255,.8)'; c.fillStyle = 'rgba(82,199,255,.05)'; c.lineWidth = 2;
  c.beginPath(); c.ellipse(p[0], p[1], rx, ry, 0, 0, 7); c.fill(); c.stroke(); c.restore();
  c.font = `800 13px ${getMono()}`; c.textAlign = 'center'; c.fillStyle = 'rgba(8,12,17,.85)'; roundRect(c, p[0] - 26, p[1] - ry - 24, 52, 20, 6); c.fill(); c.fillStyle = '#52c7ff'; c.fillText(AREA.fsa, p[0], p[1] - ry - 10);
}
document.addEventListener('click', e => {
  if (e.target.closest && e.target.closest('#areaBtn')) { AREA.open = !AREA.open; AREA.edit = !AREA.g; areaBar(); return; }
  const b = e.target.closest && e.target.closest('[data-area]'); if (!b) return;
  if (b.dataset.area === 'close') { AREA.open = false; areaBar(); } else if (b.dataset.area === 'edit') { AREA.edit = true; areaBar(); } });
setInterval(() => { if (AREA.open && !AREA.edit && AREA.g) areaBar(); }, 20000);
function areaAfterReady() { if (!LV.kind || !AREA.fsa || !LV.stat) return; if (areaSet(AREA.fsa, true)) toast('MY AREA', `Showing ${AREA.fsa}. Tap the pin to change it.`, 'var(--cyan)'); }
// ---------------- TV mode: the screen on its own. Hides the controls, keeps the screen awake, runs the director's idle tour,
// shows a permanent ticker. Start it from the TV button, the T key, or the TV tile on the start screen (open the file with #tv to feature it).
const TV = { on: false, idleT: 0, fsAsked: false };
const SCENIC = [['Scarborough Town Centre', 43.7764, -79.2577], ['University of Toronto Scarborough', 43.7845, -79.1870], ["Bluffer's Park", 43.7063, -79.2298]];
const inMap = (x, y) => x >= bbox[0] && x <= bbox[2] && y >= bbox[1] && y <= bbox[3];
function camNear(x, y) { const i = nearestCam(x, y, 650); if (i < 0) return null; const c = cams()[i], v = c.views && c.views[0]; return v ? { name: c.name, url: camSrc(v[1]) } : null; }
function tvStops() { // everything worth pointing the camera at right now, each with a weight. The director picks one at random, favouring what it hasn't shown lately.
  const out = [], P = G.proj, wl = LV.wl || {}, xy = (la, ln) => [(ln - P.lon0) * P.kx, -(la - P.lat0) * P.ky];
  const add = (kind, key, w, shot, title, sub) => out.push({ kind, key, w, shot, title, sub });
  for (const i of incidents) { if (i.state === 'cleared' || i.type === 'roadclosed' || !isNews(i)) continue; const [t, s] = DIR.incTitle(i); add('inc', 'i' + i.id, 6, { type: 'orbit', x: i.x, y: i.y, h: i.type === 'hwy' ? 520 : 260, pitch: 0.98, dur: 11, spin: 0.08 }, t, s); }
  for (const [nm, r, x, y] of wl.slow || []) add('slow', 's' + nm, 5 + (1 - r) * 8, { type: 'orbit', x: x - 350, y: y - 200, x1: x + 350, y1: y + 200, h: 420, pitch: 0.95, dur: 12, spin: 0.05 }, nm.toUpperCase(), `Buses at ${Math.round(r * 100)}% of timetable pace`);
  (wl.hm || []).forEach((m, h) => { if (m >= 1.25) { const H = G.hoods[h]; add('hood', 'h' + h, 2 + (m - 1) * 6, { type: 'orbit', x: H.x - 450, y: H.y - 280, x1: H.x + 450, y1: H.y + 280, h: 1200, pitch: 0.9, dur: 13, spin: 0.04 }, H.n.toUpperCase(), 'Buses behind timetable. Traffic likely heavier.'); } });
  const cs = cams(); for (let n = 0; n < 8 && cs.length; n++) { const c = cs[(Math.random() * cs.length) | 0]; if (!inMap(c.x, c.y)) continue; add('cam', 'c' + c.name, 2.2, { type: 'orbit', x: c.x, y: c.y, h: 210, pitch: 1.0, dur: 10, spin: 0.1 }, 'CAMERA · ' + c.name.toUpperCase(), c.src === '511' ? 'Ontario 511 traffic camera' : 'City of Toronto traffic camera'); }
  const sw = (LV.stat && LV.stat.subway) || {}; for (const k in sw) { const [nm, la, ln] = sw[k], [x, y] = xy(la, ln); if (inMap(x, y)) add('stn', 't' + nm, 0.6, { type: 'orbit', x, y, h: 260, pitch: 1.0, dur: 9, spin: 0.1 }, nm.toUpperCase() + ' STATION', 'TTC subway'); }
  for (const [nm, la, ln] of SCENIC) { const [x, y] = xy(la, ln); if (inMap(x, y)) add('scenic', 'sc' + nm, 1.3, { type: 'orbit', x, y, h: 700, pitch: 0.9, dur: 12, spin: 0.05 }, nm.toUpperCase(), 'Scarborough'); }
  const zs = (LV.zones || []).filter(z => z.on && z.road); for (let n = 0; n < 3 && zs.length; n++) { const z = zs[(Math.random() * zs.length) | 0]; add('work', 'z' + z.id, 1.4, { type: 'orbit', x: z.x, y: z.y, h: 300, pitch: 1.0, dur: 9, spin: 0.1 }, 'ROAD WORK · ' + String(z.road).toUpperCase(), String(z.why || 'Work zone').slice(0, 80)); }
  if (AREA.g && AREA.fsa) { const s = areaStats(); add('home', 'home', 3.5, { type: 'orbit', x: AREA.g.x, y: AREA.g.y, h: Math.min(4400, Math.max(1700, AREA.g.r * 3)), pitch: 0.9, dur: 12, spin: 0.05 }, 'HOME WATCH · ' + AREA.fsa, `${s.onScene} calls on scene · ${s.total} in the last 24 hours`); }
  if (envDusk() > 0.45) { const am = simT / 3600 % 24 < 12, [bx, by] = xy(SCENIC[2][1], SCENIC[2][2]), at = inMap(bx, by) ? [bx, by] : [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
    add('sun', 'sun' + Math.floor(Date.now() / 1.2e6), 16, { type: 'orbit', x: at[0], y: at[1], h: 420, pitch: 1.1, dur: 15, spin: 0.035, nopip: true }, am ? 'SUNRISE OVER SCARBOROUGH' : 'SUNSET OVER SCARBOROUGH', clock(simT, true)); }
  if (rainOn || snowOn) { const c = cs.length ? cs[(Math.random() * cs.length) | 0] : null, at = c && inMap(c.x, c.y) ? [c.x, c.y] : [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2]; add('wx', 'wx', 3, { type: 'orbit', x: at[0], y: at[1], h: 500, pitch: 1.05, dur: 11, spin: 0.05 }, snowOn ? 'SNOW ACROSS THE EAST END' : 'RAIN ACROSS THE EAST END', 'Slower roads'); }
  return out;
}
function tvStats() { // the standing lines in the ticker, rebuilt each time it wraps
  const out = [], now = Date.now() / 1000, calls = ((LV.feed && LV.feed.calls) || []).filter(c => now - c.ts < 3600), wx = LV.feed && LV.feed.weather, wl = LV.wl || {};
  if (wx && wx.temperature_2m != null) out.push(`NOW ${Math.round(wx.temperature_2m)}°C${wx.precipitation > 0 ? ' · PRECIPITATION' : ''}`);
  out.push(`CALLS IN THE LAST HOUR: ${calls.length} (${calls.filter(c => c.src === 'tps').length} POLICE · ${calls.filter(c => c.src !== 'tps' && c.act !== 'medical').length} FIRE · ${calls.filter(c => c.src !== 'tps' && c.act === 'medical').length} MEDICAL)`);
  const on = incidents.filter(i => i.type === 'call' && i.state !== 'cleared').length; if (on) out.push(`${on} REAL CALL${on > 1 ? 'S' : ''} ON SCENE NOW`);
  out.push(`HIGHWAYS: ${incidents.filter(i => i.type === 'hwy' && i.state !== 'cleared').length} ACTIVE 511 INCIDENTS`);
  if (wl.late && wl.late[1] >= 8) out.push(`BUS PACE: ${Math.round(100 * (1 - wl.late[0] / wl.late[1]))}% OF BUS-SERVED ROADS ON TIMETABLE`);
  if (wl.slow && wl.slow[0]) out.push(`SLOWEST ROAD: ${wl.slow[0][0].toUpperCase()}, BUSES AT ${Math.round(wl.slow[0][1] * 100)}% OF TIMETABLE PACE`);
  const zn = (LV.zones || []).filter(z => z.on).length; if (zn) out.push(`${zn} ROAD WORK ZONES ACTIVE`);
  return out;
}
let wakeLock = null;
async function tvWake() { try { if (TV.on && navigator.wakeLock && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch (e) {} }
function tvSet(on, fs) {
  if (on === TV.on) return; TV.on = on; document.body.classList.toggle('tv', on); document.body.classList.remove('tvidle'); DIR.setTV(on); const b = $('tvBtn'); if (b) b.setAttribute('aria-pressed', String(on));
  if (on) { DIR.auto = true; $('camBtn').setAttribute('aria-pressed', 'true'); tvWake(); closeSheet(); if (fs && !document.fullscreenElement) { TV.fsAsked = true; try { document.documentElement.requestFullscreen(); } catch (e) {} } tvIdle(); }
  else { if (wakeLock) { wakeLock.release(); wakeLock = null; } clearTimeout(TV.idleT); if (document.fullscreenElement) { TV.fsAsked = false; try { document.exitFullscreen(); } catch (e) {} } }
}
function tvIdle() { document.body.classList.remove('tvidle'); clearTimeout(TV.idleT); TV.idleT = setTimeout(() => document.body.classList.add('tvidle'), 3000); }
addEventListener('pointermove', () => { if (TV.on) tvIdle(); });
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && TV.on && TV.fsAsked) tvSet(false); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) tvWake(); });
document.addEventListener('click', e => { if (e.target.closest && e.target.closest('#tvBtn, #tvExit')) tvSet(!TV.on, true); });
addEventListener('keydown', e => { if (!LV.kind || (e.target && /INPUT|TEXTAREA/.test(e.target.tagName))) return; if (e.key === 't' || e.key === 'T') tvSet(!TV.on, true); }, true);
addEventListener('webglcontextlost', () => { if (TV.on) setTimeout(() => location.reload(), 3000); }, true);
function tvHooks() { DIR.tourSource = tvStops; DIR.camNear = camNear; DIR.tvStats = tvStats; }
loadFeed(true);
