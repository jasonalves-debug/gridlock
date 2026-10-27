  // ================================================================ WORLD — roads: roadwork, utility digs, 311 defects, calls, weather, 511
  const curbLane = e => laneOf(e, eLanes[e] - 1);

  // ---------------- work zones: City road restrictions (on their published schedules) + utility cut permits
  const CUT_DAY_PCT = 6; // a cut permit covers weeks or months; crews are actually digging on roughly 1 weekday in 16
  const UTILITY_CREW = who => /hydro/i.test(who) ? 'hydro' : /water/i.test(who) ? 'water' : 'crew';
  let zoneSeq = 0;
  function zoneEdgesAlong(P, key, both) { // a restriction polyline → the edges it covers, with the covered stretch on each
    const samp = []; if (P.length === 1) samp.push(P[0]); else for (let i = 0; i < P.length - 1; i++) { const L = Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]); const n = Math.max(1, Math.ceil(L / 12)); for (let k = 0; k < n; k++) samp.push([P[i][0] + (P[i + 1][0] - P[i][0]) * k / n, P[i][1] + (P[i + 1][1] - P[i][1]) * k / n]); }
    if (P.length > 1) samp.push(P[P.length - 1]);
    const hit = new Map(), add = (e, s) => { const g = hit.get(e); if (g) { g[0] = Math.min(g[0], s); g[1] = Math.max(g[1], s); } else hit.set(e, [s, s]); };
    let named = false;
    for (const p of samp) for (const h of edgesNear(p[0], p[1], 26, e => eCls[e] >= 2)) { const m = key && eName[h.e] >= 0 && nameKey[eName[h.e]] === key; if (key && !m) continue; named = named || m; add(h.e, h.s); }
    if (!named) for (const p of samp) { const h = edgesNear(p[0], p[1], 15, e => eCls[e] >= 2)[0]; if (h) { add(h.e, h.s); if (revEdge[h.e] >= 0) add(revEdge[h.e], eLen[h.e] - h.s); } }
    let edges = [...hit.entries()].map(([e, g]) => { let s0 = g[0], s1 = g[1]; if (s1 - s0 < 30) { const m = (s0 + s1) / 2; s0 = m - 15; s1 = m + 15; } return { e, s0: Math.max(2, s0), s1: Math.min(eLen[e] - 2, s1) }; });
    const dir = P.length > 1 ? [P[P.length - 1][0] - P[0][0], P[P.length - 1][1] - P[0][1]] : null, dl = dir ? Math.hypot(dir[0], dir[1]) : 0;
    if (!both && dl > 8) { const one = edges.filter(z => (Math.cos(bOut[z.e]) * dir[0] + Math.sin(bOut[z.e]) * dir[1]) / dl > 0.3); if (one.length) edges = one; }
    return edges;
  }
  function roadworkFromFeed(list) {
    const ids = new Set(list.map(r => r.id));
    for (const z of live.zones) if (z.src === 'roads' && !ids.has(z.rid) && z.on) applyZone(z, false);
    live.zones = live.zones.filter(z => z.src !== 'roads' || ids.has(z.rid));
    const have = new Set(live.zones.map(z => z.rid));
    for (const r of list) { if (have.has(r.id)) continue; const P = r.line.map(p => ll(p[0], p[1])); const edges = zoneEdgesAlong(P, nkey(r.road), r.both); if (!edges.length) continue;
      const mid = P[Math.floor(P.length / 2)];
      live.zones.push({ id: zoneSeq++, src: 'roads', rid: r.id, road: r.road, from: r.from, to: r.to, why: r.why, who: r.who, full: !!r.full, impact: r.impact || 'Low',
        start: r.start || 0, end: r.end || 0, sched: r.sched, edges, x: mid[0], y: mid[1], on: false, cones: null, crew: r.impact === 'High' && !r.full ? 'crew' : null, unit: null }); }
    stepZones();
  }
  function cutLocation(c) { // "154 ROBINA AVE (Between GLENHURST AVE AND EARLSDALE AVE)" → a spot on Robina between those two corners
    const street = edgesByName.get(nkey(c.street)); if (!street) return null;
    const corner = other => { const k = nkey(other); if (!k) return -1; for (const e of street) for (const n of [eA[e], eB[e]]) for (let q = IN.start[n]; q < IN.start[n + 1]; q++) { const f = IN.list[q]; if (eName[f] >= 0 && nameKey[eName[f]] === k) return n; } return -1; };
    const na = corner(c.a), nb = corner(c.b); if (na < 0 && nb < 0) return null;
    let x, y; if (na >= 0 && nb >= 0) { const f = 0.3 + (hash(c.id) % 40) / 100; x = NX[na] + (NX[nb] - NX[na]) * f; y = NY[na] + (NY[nb] - NY[na]) * f; } else { const n = na >= 0 ? na : nb; x = NX[n]; y = NY[n]; }
    const h = edgesNear(x, y, 60, e => street.includes(e))[0]; if (!h) return null;
    const s = Math.max(14, Math.min(eLen[h.e] - 14, h.s));
    return { edges: [{ e: h.e, s0: s - 12, s1: s + 12 }], x: posOnEdge(h.e, s, 0)[0], y: posOnEdge(h.e, s, 0)[1] };
  }
  function cutsFromFeed(list) {
    const ids = new Set(list.map(c => c.id));
    for (const z of live.zones) if (z.src === 'cut' && !ids.has(z.rid) && z.on) applyZone(z, false);
    live.zones = live.zones.filter(z => z.src !== 'cut' || ids.has(z.rid));
    const have = new Set(live.zones.map(z => z.rid));
    for (const c of list) { if (have.has(c.id)) continue; const loc = cutLocation(c); if (!loc) continue;
      live.zones.push({ id: zoneSeq++, src: 'cut', rid: c.id, road: c.street, from: c.a, to: c.b, why: c.what, who: c.who, full: false, impact: 'cut',
        start: 0, end: 0, dfrom: c.from, dto: c.to, edges: loc.edges, x: loc.x, y: loc.y, on: false, cones: null, crew: UTILITY_CREW(c.who), unit: null }); }
    stepZones();
  }
  function zoneActive(z, t) {
    const day = dayInfo(t), sod = secOfDay(t);
    if (z.src === 'cut') { if (day.dow >= 5 || day.holiday || sod < HM(7, 30) || sod > HM(15, 30)) return false; if (day.date && (day.date < z.dfrom || day.date > z.dto)) return false; return hash(z.rid + (day.date || 'typical')) % 100 < CUT_DAY_PCT; }
    if (live.epoch0) { const ep = live.epoch0 + t; if ((z.start && ep < z.start) || (z.end && ep > z.end)) return false; }
    if (!z.sched) return true;
    const w = z.sched[day.dow] || z.sched[String(day.dow)]; if (!w) return false; const m = /(\d+):(\d+)\s*-\s*(\d+):(\d+)/.exec(w); if (!m) return true;
    const a = +m[1] * 60 + +m[2], b = +m[3] * 60 + +m[4], tm = sod / 60; return a <= b ? tm >= a && tm < b : tm >= a || tm < b;
  }
  function zoneLaneMode(z, e) { const nl = eLanes[e]; if (z.full) return 'closed'; if (z.impact === 'High') return nl >= 2 ? 'lane' : 'flag'; if (z.impact === 'cut') return nl >= 2 ? 'lane' : 'slow'; return nl >= 3 ? 'lane' : 'slow'; }
  const ZONE_CAP = { flag: 4.5, slow: 7 }; // m/s past single-lane work (flag person / squeezing past)
  function applyZone(z, on) {
    const id = 'z' + z.id, d = on ? 1 : -1;
    for (const { e, s0 } of z.edges) { const m = zoneLaneMode(z, e);
      if (m === 'closed') edgeClosed[e] += d; else if (m === 'lane') on ? lbSet(curbLane(e), s0, id) : lbClr(curbLane(e), id); else on ? vcSet(e, ZONE_CAP[m], id) : vcClr(e, id); }
    if (z.crew) { if (on) { const { e, s0 } = z.edges[0]; const [x, y, a] = posOnEdge(e, Math.max(3, s0 - 7), laneLat(e, eLanes[e] - 1) + (zoneLaneMode(z, e) === 'lane' ? 0 : 2.2)); z.unit = { id: unitSeq++, kind: z.crew, d: -1, e, s: 0, v: 0, x, y, ang: a, state: 'working', t0: simT, quiet: true, crewOf: z.id }; specials.push(z.unit); } else if (z.unit) { z.unit.state = 'done'; z.unit = null; } }
    z.on = on; live.zonesDirty = true;
  }
  function zoneCones(z) {
    if (z.cones) return z.cones; const o = [];
    for (const { e, s0, s1 } of z.edges) { const m = zoneLaneMode(z, e); const lat = m === 'closed' ? 0 : laneLat(e, eLanes[e] - 1) - (m === 'lane' ? LANE_W * 0.45 : -1.2); let n = 0;
      for (let s = s0; s <= s1 && n < 24; s += 7, n++) { const [x, y] = posOnEdge(e, s, lat); o.push(Math.round(x * 10) / 10, Math.round(y * 10) / 10); }
      if (m === 'closed') for (let k = -1; k <= 1; k++) { const [x, y] = posOnEdge(e, s0, k * 2.2); o.push(Math.round(x * 10) / 10, Math.round(y * 10) / 10); } }
    return (z.cones = o);
  }
  function stepZones() { for (const z of live.zones) { const a = zoneActive(z, simT); if (a !== z.on) applyZone(z, a); } }
  function pubZones() { live.zonesDirty = false; return live.zones.map(z => ({ id: z.id, src: z.src, rid: z.rid, road: z.road, from: z.from, to: z.to, why: z.why, who: z.who, full: z.full, impact: z.impact, end: z.end, dto: z.dto, on: z.on, x: z.x, y: z.y, edges: z.edges.map(q => q.e), cones: z.on ? zoneCones(z) : null })); }

  // ---------------- 311 road defects. The City publishes only the postal area (first 3 characters), so each request is
  // placed on a real road inside that area, deterministically (same request, same road, every launch).
  const SPOT = { pothole: { v: 7, len: 16 }, sinkhole: { v: 5, len: 22 }, ponding: { lane: 1, len: 14, rain: 1 }, tree: { lane: 1, v: 4, len: 20 }, debris: { lane: 1, v: 5, len: 8 } };
  live.spots = [];
  const spotFlag = new Uint8Array(E), spotMap = new Map();
  function spotsFromFeed(s311) {
    if (live.spotsStamp === s311.newest + s311.items.length) return; live.spotsStamp = s311.newest + s311.items.length;
    for (const p of live.spots) if (p.on) applySpot(p, false);
    live.spots = [];
    for (const it of s311.items) { const cfg = SPOT[it.act], pts = live.fsa && live.fsa[it.fsa]; if (!cfg || !pts || !pts.length) continue;
      const h = hash(it.id), p = pts[h % pts.length]; let [x, y] = ll(p[1], p[0]); const ang = ((h >>> 8) % 360) * Math.PI / 180, r = 60 + ((h >>> 4) % 340); x += Math.cos(ang) * r; y += Math.sin(ang) * r;
      const hit = edgeNear(x, y, 60, e => eCls[e] >= 2 && eCls[e] <= CLS_RES && eLen[e] > 45); if (!hit) continue;
      const e = hit.e, s = 12 + ((h >>> 12) % Math.max(1, Math.floor(eLen[e] - 24))); const [px, py] = posOnEdge(e, s, laneLat(e, eLanes[e] - 1));
      live.spots.push({ id: it.id, act: it.act, type: it.type, date: it.date, status: it.status, fsa: it.fsa, e, s, x: px, y: py, on: false }); }
    stepSpots();
  }
  function applySpot(p, on) {
    const cfg = SPOT[p.act], id = 'p' + p.id;
    if (cfg.lane && eLanes[p.e] >= 2) on ? lbSet(curbLane(p.e), p.s - cfg.len / 2, id) : lbClr(curbLane(p.e), id);
    else if (cfg.v) { let a = spotMap.get(p.e); if (on) { if (!a) spotMap.set(p.e, a = []); a.push({ id, s0: p.s - cfg.len / 2, s1: p.s + cfg.len / 2, v: cfg.v }); } else if (a) { const i = a.findIndex(q => q.id === id); if (i >= 0) a.splice(i, 1); if (!a.length) spotMap.delete(p.e); } spotFlag[p.e] = spotMap.has(p.e) ? 1 : 0; }
    p.on = on;
  }
  function stepSpots() { for (const p of live.spots) { const want = !SPOT[p.act].rain || !!weather.rain; if (want !== p.on) applySpot(p, want); } }
  function spotCap(e, s) { let v = 99; for (const q of spotMap.get(e)) if (s > q.s0 - 25 && s < q.s1) v = Math.min(v, q.v); return v; } // drivers brake for the hole, then roll over it

  // ---------------- police + fire calls → what happens on the street
  const ACT = {
    police_low: { u: [['police', 0]], dur: 60, block: 'curb' },
    police_med: { u: [['police', 1]], dur: 75, block: 'curb' },
    police_high: { u: [['police', 1], ['police', 1]], dur: 90, block: 'curb', rub: 1 },
    police_crit: { u: [['police', 1], ['police', 1], ['police', 1], ['police', 1]], dur: 150, block: 'node', rub: 1 },
    impaired: { u: [['police', 1]], dur: 60, block: 'curb' },
    missing: { u: [['police', 0], ['police', 0]], dur: 120, block: null },
    medical: { u: [['ems', 1], ['police', 0]], dur: 45, block: 'curb' },
    hazard: { u: [['police', 1]], dur: 60, block: 'lane', rub: 1 },
    fire_alarm: { u: [['fire', 1]], dur: 30, block: 'curb' },
    fire_small: { u: [['fire', 1]], dur: 40, block: 'curb', fire: 1 },
    fire_struct: { u: [['fire', 1], ['fire', 1], ['fire', 1], ['police', 1], ['ems', 1]], dur: 120, block: 'road', fire: 1, rub: 1 },
    gas: { u: [['fire', 1], ['fire', 1], ['police', 1]], dur: 90, block: 'road' },
    hydro: { u: [['fire', 1], ['police', 1]], dur: 120, block: 'lane', dark: 280 },
  };
  const CRASH = { crash1: 0, crash2: 1, crash3: 2, carfire: 1 };
  const callTime = c => c.ts - live.epoch0;
  const callDur = c => (c.act in CRASH ? 90 : ACT[c.act] ? ACT[c.act].dur : 60) * 60;
  function callEdge(x, y, loc) {
    const keys = new Set((loc || '').split(/\s[-&/]\s|&|\//).map(nkey).filter(Boolean)), wantHwy = /\b(hwy|highway|401|dvp)\b/i.test(loc || '');
    let best = null, bv = 1e9; for (const h of edgesNear(x, y, 160, e => wantHwy || eCls[e] >= 2)) { const v = h.d + (eCls[h.e] >= CLS_RES ? 18 : 0) - (eName[h.e] >= 0 && keys.has(nameKey[eName[h.e]]) ? 70 : 0) + (eLen[h.e] < 25 ? 30 : 0); if (v < bv) { bv = v; best = h; } }
    return best;
  }
  const stationFor = unit => { const m = /(\d{3})/.exec(unit || ''); return m ? live.stations.find(s => s.id === m[1]) || null : null; };
  function spawnCall(c, pre, synthetic) {
    const [x0, y0] = ll(c.lng, c.lat); const h = callEdge(x0, y0, c.loc); if (!h) return null;
    const e = h.e, s = Math.max(6, Math.min(eLen[e] - 6, h.s)), t0 = pre ? callTime(c) : simT;
    const name = (c.loc || '').replace(/\s+-\s+/g, ' & ') || edgeName(e);
    const meta = { real: synthetic ? null : { src: c.src, label: c.label, loc: name, rid: c.id, units: c.units || null, code: c.code }, label: c.label, src: c.src, act: c.act, silent: !!pre, quietResp: !!pre, synth: !!synthetic };
    let inc = null;
    if (c.act in CRASH) { inc = makeCollision(e, CRASH[c.act], Object.assign({ s, fire: c.act === 'carfire', name }, meta)); if (inc) { inc.start = t0; inc.auto = t0 + (c.act === 'crash1' ? 60 : 90) * 60; } }
    else { const A = ACT[c.act] || ACT.police_low; const o = Object.assign({ edge: e, s, name, hood: edgeHood[e], auto: t0 + A.dur * 60, fire: !!A.fire && c.src === 'tfs' }, meta);
      [o.x, o.y] = posOnEdge(e, s, laneLat(e, eLanes[e] - 1));
      if ((A.block === 'curb' && eLanes[e] >= 2) || A.block === 'lane') o.lanes = [curbLane(e)];
      if (A.block === 'road') o.edges = revEdge[e] >= 0 ? [e, revEdge[e]] : [e];
      if (A.block === 'node') { let best = -1, bd = 160 * 160; for (let k = 0; k < C; k++) { const q = G.ctrls[k]; const d = (q.x - o.x) ** 2 + (q.y - o.y) ** 2; if (d < bd) { bd = d; best = k; } } o.nodes = best >= 0 ? G.ctrls[best].nodes.slice() : [eB[e]]; if (best >= 0) { o.x = G.ctrls[best].x; o.y = G.ctrls[best].y; o.ctrl = best; } }
      if (A.rub || (A.block === 'curb' && eLanes[e] < 2)) o.rub = A.rub && revEdge[e] >= 0 ? revEdge[e] : e;
      if (A.dark) { o.ctrls = []; for (let k = 0; k < C; k++) { const q = G.ctrls[k]; if ((q.x - o.x) ** 2 + (q.y - o.y) ** 2 < A.dark * A.dark) o.ctrls.push(k); } o.r = A.dark; }
      let plan = A.u.map(([k, c3]) => ({ kind: k, code3: !!c3 }));
      if (c.src === 'tfs' && c.units && c.units.length) plan = c.units.slice(0, 4).map(u => ({ kind: 'fire', code3: true, unit: u, from: stationFor(u) })).concat(plan.filter(p => p.kind !== 'fire'));
      o.plan = plan; inc = newIncident('call', o); if (inc) inc.start = t0; }
    if (inc && pre) placeOnScene(inc);
    return inc;
  }
  function placeOnScene(inc) { // the call started before the page opened: units are already parked there
    const plan = inc.plan || [{ kind: 'police', code3: true }].concat(inc.sev >= 1 ? [{ kind: 'ems', code3: true }] : []).concat(inc.fire ? [{ kind: 'fire', code3: true }] : []);
    plan.forEach((p, k) => { const [x, y, a] = parkSpot(inc, k); specials.push({ id: unitSeq++, kind: p.kind, d: -1, e: inc.edge >= 0 ? inc.edge : 0, s: 0, v: 0, x, y, ang: a, state: 'onscene', t0: simT, onT: simT - 60, inc: inc.id, responder: true, quiet: !p.code3 }); });
  }
  function callsFromFeed(calls) {
    const first = !live.callsSeen; live.callsSeen = true;
    for (const c of calls) {
      if (live.calls.has(c.id)) continue; live.calls.set(c.id, c); live.pool.push(c); if (live.pool.length > 400) live.pool.shift();
      if (live.kind !== 'live' && live.kind !== 'replay') continue;
      const t = callTime(c);
      if (t <= simT) { if (simT - t < callDur(c)) { if (first) spawnCall(c, true); else if (live.kind === 'live') live.queue.push(c); } }
      else if (live.kind === 'replay' || !first) live.queue.push(c);
    }
    live.queue.sort((a, b) => a.ts - b.ts);
  }
  function stepCalls() {
    if (live.kind === 'replay') { while (live.queue.length && callTime(live.queue[0]) <= simT) spawnCall(live.queue.shift(), false); }
    else if (live.kind === 'live') { for (let n = 0; live.queue.length && n < 2; n++) spawnCall(live.queue.shift(), false); }
    else if (live.rates && live.pool.length && mode === 'watch') { // Watch: real call rates for this hour and day, real call mix
      if (!live.nextAmb) live.nextAmb = simT + 60;
      if (simT >= live.nextAmb) { const i = dayInfo(simT).dow * 24 + Math.floor(secOfDay(simT) / 3600); const perHr = (live.rates.police[i] || 0) + (live.rates.fire[i] || 0);
        live.nextAmb = simT + (perHr > 0.05 ? -Math.log(1 - rand()) * 3600 / perHr : 3600);
        const src = live.pool[(rand() * live.pool.length) | 0]; spawnCall(Object.assign({}, src, { lat: src.lat + (rand() - 0.5) * 0.004, lng: src.lng + (rand() - 0.5) * 0.005, loc: '' }), false, true); } }
  }
  function jumpNext() { if (live.kind !== 'replay' || !live.queue.length) return { ok: false, msg: 'No more calls in the replay.' }; const t = callTime(live.queue[0]) - 45; if (t > simT) { simT = t; stepZones(); } return { ok: true, t: simT }; }

  // ---------------- weather (Open-Meteo current conditions)
  function applyWeather(wx) {
    live.wx = wx; const code = wx.weather_code | 0, p = +wx.precipitation || 0;
    const snow = (code >= 71 && code <= 77) || code === 85 || code === 86 || (+wx.snowfall || 0) > 0;
    const rain = !snow && ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95 || p > 0.1);
    const was = weather.rain; weather.snow = snow ? 1 : 0; weather.fog = code === 45 || code === 48 || (wx.visibility != null && wx.visibility < 1000) ? 1 : 0; weather.storm = code >= 95 ? 1 : 0; weather.intensity = p; weather.live = 1;
    if (rain || snow) { weather.rain = 1; weather.until = simT + 6 * 3600; if (!was) { ev({ k: 'rain', on: 1, snow: weather.snow, storm: weather.storm, live: 1 }); if (p >= 4) floodUnderpasses(6 * 3600); } }
    else if (was) weather.until = simT;
    stepSpots();
  }
  function floodUnderpasses(dur) { const unders = []; for (let e = 0; e < E; e++) if (eUnder[e] && (revEdge[e] > e || revEdge[e] < 0)) unders.push(e); for (let k = 0; k < 2 && unders.length; k++) { const e = unders.splice((rand() * unders.length) | 0, 1)[0]; const [x, y] = posOnEdge(e, eLen[e] / 2, 0); newIncident('flood', { edge: e, edges: revEdge[e] >= 0 ? [e, revEdge[e]] : [e], x, y, name: edgeName(e), auto: simT + dur, hood: edgeHood[e] }); } }

  // ---------------- Ontario 511 (401 / DVP), when a key is configured upstream
  // ---------------- speed cameras: drivers ease off as they pass (red-light cameras are on the map only)
  live.enforce = [];
  function buildEnforce(list) {
    for (const c of list) { const [x, y] = ll(c.lng, c.lat); live.enforce.push({ k: c.k, x, y });
      if (c.k === 'speed') for (const h of edgesNear(x, y, 60, e => eCls[e] >= 2).slice(0, 2)) vcSet(h.e, eVmax[h.e] * 0.85, 'ase'); }
  }
  // 511 lists whole construction projects (weeks long); the actual closures are "Nightly" or "Daily" work windows.
  function hwyActive(v) {
    if (/cancel/i.test(v.desc || '')) return false;
    const now = live.epoch0 + simT; if ((v.start && now < v.start) || (v.end && now > v.end)) return false;
    const h = secOfDay(simT) / 3600, long = v.start && v.end && v.end - v.start > 20 * 3600;
    if (/nightly/i.test(v.desc || '') || (long && /roadwork|construction/i.test(v.type || '') && !/daily/i.test(v.desc || ''))) return h >= 22 || h < 5.5;
    if (/daily/i.test(v.desc || '')) return h >= 9.5 && h < 15.5;
    return true;
  }
  function hwyFromFeed(list) {
    live.hwyList = list; const ids = new Set(), sp = { S: 0, N: 0 };
    for (const v of list) {
      if (!hwyActive(v)) continue;
      if (/\b(DVP|Don Valley|404)\b/i.test(v.road || '')) { // just off the map: its traffic spills onto Victoria Park, Pharmacy, Warden
        const k = v.full ? 1 : /crash|accident|collision|incident/i.test(v.type || '') ? 0.6 : 0.3;
        if (/south|both|all/i.test(v.dir || '')) sp.S = Math.max(sp.S, k); if (/north|both|all/i.test(v.dir || '')) sp.N = Math.max(sp.N, k);
        continue; }
      if (!/401/.test(v.road || '')) continue;
      const rid = String(v.id); ids.add(rid); if (live.hwy.has(rid)) continue; const [x, y] = ll(v.lng, v.lat); const h = edgesNear(x, y, 300, e => eCls[e] === 0)[0]; if (!h) continue;
      const crash = /accident|incident|collision/i.test(v.type || ''), nl = /(\d+)/.exec(v.lanes || '');
      const inc = makeHwy(x, y, h.e, /both|all/i.test(v.dir || ''), crash, { real: { src: '511', label: v.sub || v.type, loc: v.road, rid }, nlanes: v.full ? 0 : (nl ? +nl[1] : 1), quietResp: !crash, desc: v.desc, fire: /fire/i.test(v.desc || '') });
      if (inc) { inc.auto = v.end ? Math.max(simT + 600, v.end - live.epoch0) : simT + 90 * 60; live.hwy.set(rid, inc.id); } }
    for (const [rid, iid] of live.hwy) if (!ids.has(rid)) { const inc = incidents.find(i => i.id === iid); if (inc) clearIncident(inc, 'reopened'); live.hwy.delete(rid); }
    if (sp.S !== spill.S || sp.N !== spill.N) { const was = spill.S || spill.N; spill.S = sp.S; spill.N = sp.N; if (!was !== !(sp.S || sp.N)) ev({ k: 'spill', on: sp.S || sp.N ? 1 : 0, dir: sp.S && sp.N ? 'both' : sp.S ? 'southbound' : 'northbound' }); }
  }

