  // ================================================================ WORLD — real Toronto data driving the sim
  // world.js        shared state, geometry lookups, path search, calendar, feed entry point
  // world_roads.js  roadwork + utility digs, 311 road defects, police/fire calls, weather, Ontario 511
  // world_trips.js  scripted trips: TTC buses + detours + subway shuttles, school runs, worship, construction, towers
  // world_rail.js   GO trains on real schedules and the level-crossing gates they drop
  // Everything is optional: without a feed the sim runs exactly as before.
  const live = {
    kind: null, epoch0: 0, typical: false, calendar: null, rates: null, stations: [],
    calls: new Map(), queue: [], pool: [], nextAmb: 0, zones: [], hwy: new Map(), wx: null, built: {}, dirty: true, zonesDirty: false,
  };
  const PJ = G.proj || { lat0: 43.775, lon0: -79.23, kx: 80390, ky: 111320 };
  function ll(lng, lat) { return [(lng - PJ.lon0) * PJ.kx, -(lat - PJ.lat0) * PJ.ky]; }
  function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function secOfDay(t) { return ((t % 86400) + 86400) % 86400; }
  const HM = (h, m) => h * 3600 + (m || 0) * 60;

  // ---------------- street names ("Kennedy Rd" and "Kennedy Road" are the same street)
  const SUF = /\b(road|rd|avenue|ave|av|street|st|drive|dr|boulevard|blvd|crescent|cres|crcs|court|crt|ct|place|pl|lane|ln|way|parkway|pkwy|trail|trl|square|sq|gardens|gdns|circle|circ|cir|terrace|terr|gate|gt|heights|hts|grove|grv|east|e|west|w|north|n|south|s|the)\b/g;
  const nkey = s => (s || '').toLowerCase().replace(/[.'’]/g, '').replace(SUF, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const nameKey = G.names.map(nkey);
  const edgesByName = new Map(); for (let e = 0; e < E; e++) { if (eName[e] < 0) continue; const k = nameKey[eName[e]]; if (!k) continue; let a = edgesByName.get(k); if (!a) edgesByName.set(k, a = []); a.push(e); }

  // ---------------- spatial lookups
  const EG = 80, egrid = new Map();
  for (let e = 0; e < E; e++) { const go = eGo[e], gc = eGc[e]; let lastK = -1;
    for (let i = 0; i < gc - 1; i++) { const ax = geo[(go + i) * 2], ay = geo[(go + i) * 2 + 1], bx = geo[(go + i + 1) * 2], by = geo[(go + i + 1) * 2 + 1];
      for (let cx = Math.floor(Math.min(ax, bx) / EG); cx <= Math.floor(Math.max(ax, bx) / EG); cx++) for (let cy = Math.floor(Math.min(ay, by) / EG); cy <= Math.floor(Math.max(ay, by) / EG); cy++) { const k = cx * 100003 + cy; if (k === lastK) continue; let a = egrid.get(k); if (!a) egrid.set(k, a = []); if (a[a.length - 1] !== e) a.push(e); lastK = k; } } }
  function edgesNear(x, y, r, pred) { // → [{e, d, s}] sorted by distance; s = position along e in its travel direction
    const out = [], seen = new Set();
    for (let cx = Math.floor((x - r) / EG); cx <= Math.floor((x + r) / EG); cx++) for (let cy = Math.floor((y - r) / EG); cy <= Math.floor((y + r) / EG); cy++) { const a = egrid.get(cx * 100003 + cy); if (!a) continue;
      for (const e of a) { if (seen.has(e)) continue; seen.add(e); if (pred && !pred(e)) continue; const go = eGo[e], gc = eGc[e]; let bd = 1e9, bs = 0;
        for (let i = 0; i < gc - 1; i++) { const ax = geo[(go + i) * 2], ay = geo[(go + i) * 2 + 1], bx = geo[(go + i + 1) * 2], by = geo[(go + i + 1) * 2 + 1]; const vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy || 1; let t = ((x - ax) * vx + (y - ay) * vy) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t; const d = Math.hypot(x - ax - t * vx, y - ay - t * vy); if (d < bd) { bd = d; bs = cum[go + i] + t * Math.sqrt(l2); } }
        if (bd <= r) out.push({ e, d: bd, s: eRev[e] ? eLen[e] - bs : bs }); } }
    return out.sort((a, b) => a.d - b.d);
  }
  function edgeNear(x, y, r0, pred) { for (let r = r0; r <= r0 * 8; r *= 2) { const h = edgesNear(x, y, r, pred)[0]; if (h) return h; } return null; }
  const NG = 80, nodeGrid = new Map();
  for (let n = 0; n < N; n++) { if (!(OUT.start[n + 1] > OUT.start[n]) || !notHwy(n)) continue; const k = Math.floor(NX[n] / NG) * 100003 + Math.floor(NY[n] / NG); let a = nodeGrid.get(k); if (!a) nodeGrid.set(k, a = []); a.push(n); }
  function nodesWithin(x, y, r0, r1, pred) { const out = []; for (let cx = Math.floor((x - r1) / NG); cx <= Math.floor((x + r1) / NG); cx++) for (let cy = Math.floor((y - r1) / NG); cy <= Math.floor((y + r1) / NG); cy++) { const a = nodeGrid.get(cx * 100003 + cy); if (!a) continue; for (const n of a) { const d = Math.hypot(NX[n] - x, NY[n] - y); if (d >= r0 && d <= r1 && (!pred || pred(n))) out.push(n); } } return out; }
  function nodeNearDir(x, y, r, dx, dy) { // nearest node with an outgoing edge heading along (dx, dy): keeps divided roads on the right carriageway
    let best = -1, bd = 1e18; const dl = Math.hypot(dx, dy) || 1;
    for (const n of nodesWithin(x, y, 0, r)) { const d = (NX[n] - x) ** 2 + (NY[n] - y) ** 2; let ok = false; for (let k = OUT.start[n]; k < OUT.start[n + 1]; k++) { const o = OUT.list[k]; if (eCls[o] > 1 && (Math.cos(bOut[o]) * dx + Math.sin(bOut[o]) * dy) / dl > 0.5) { ok = true; break; } } const v = d + (ok ? 0 : 2500); if (v < bd) { bd = v; best = n; } }
    return best;
  }
  const outsRes = n => { for (let k = OUT.start[n]; k < OUT.start[n + 1]; k++) if (eCls[OUT.list[k]] === CLS_RES) return true; return false; };
  const outsArterial = n => { for (let k = OUT.start[n]; k < OUT.start[n + 1]; k++) { const c = eCls[OUT.list[k]]; if (c >= 2 && c <= 3) return true; } return false; };

  // ---------------- shortest path on the static network (no highways); binary heap, bounded radius
  const spD = new Float64Array(N).fill(Infinity), spPrev = new Int32Array(N).fill(-1), spTouched = [], spHeap = [];
  function spPush(d, n) { const h = spHeap; h.push([d, n]); let i = h.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (h[p][0] <= h[i][0]) break; const t = h[p]; h[p] = h[i]; h[i] = t; i = p; } }
  function spPop() { const h = spHeap, top = h[0], last = h.pop(); if (h.length) { h[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < h.length && h[l][0] < h[m][0]) m = l; if (r < h.length && h[r][0] < h[m][0]) m = r; if (m === i) break; const t = h[m]; h[m] = h[i]; h[i] = t; i = m; } } return top; }
  function shortPath(a, b, maxD, resCost) {
    if (a === b) return [];
    for (const n of spTouched) { spD[n] = Infinity; spPrev[n] = -1; } spTouched.length = 0; spHeap.length = 0;
    const rc = resCost || 1.6; spD[a] = 0; spTouched.push(a); spPush(0, a);
    while (spHeap.length) { const [d, n] = spPop(); if (d > spD[n]) continue; if (n === b || d > maxD) break;
      for (let k = OUT.start[n]; k < OUT.start[n + 1]; k++) { const o = OUT.list[k]; if (eCls[o] <= 1 || edgeClosed[o]) continue; const m = eB[o]; const nd = d + eLen[o] * (eCls[o] >= CLS_RES ? rc : 1); if (nd < spD[m]) { if (spD[m] === Infinity) spTouched.push(m); spD[m] = nd; spPrev[m] = o; spPush(nd, m); } } }
    if (spD[b] === Infinity) return null; const path = []; let n = b; while (n !== a) { const o = spPrev[n]; if (o < 0 || path.length > 600) return null; path.push(o); n = eA[o]; } return path.reverse();
  }
  function pathAlong(P, step, snap) { // a polyline (sim coordinates) → network edges following it
    const S = []; for (let i = 0; i < P.length - 1; i++) { const L = Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]); const n = Math.max(1, Math.ceil(L / step)); for (let k = 0; k < n; k++) S.push([P[i][0] + (P[i + 1][0] - P[i][0]) * k / n, P[i][1] + (P[i + 1][1] - P[i][1]) * k / n, P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]]); }
    if (P.length > 1) { const q = P.length - 1; S.push([P[q][0], P[q][1], P[q][0] - P[q - 1][0], P[q][1] - P[q - 1][1]]); }
    const nodes = []; for (const p of S) { const n = nodeNearDir(p[0], p[1], snap, p[2], p[3]); if (n >= 0 && n !== nodes[nodes.length - 1]) nodes.push(n); }
    let best = [], cur = [];
    for (let i = 0; i < nodes.length - 1;) { let seg = null, j = i + 1; for (; j < Math.min(nodes.length, i + 4); j++) { seg = shortPath(nodes[i], nodes[j], 1500); if (seg) break; }
      if (!seg) { if (cur.length > best.length) best = cur; cur = []; i++; continue; } for (const e of seg) if (cur[cur.length - 1] !== e) cur.push(e); i = j; }
    if (cur.length > best.length) best = cur;
    const path = []; for (const e of best) { if (path.length && revEdge[e] === path[path.length - 1]) { path.pop(); continue; } path.push(e); } // drop snap U-turns
    return path;
  }
  const pathLen = p => { let L = 0; for (const e of p) L += eLen[e]; return L; };

  // ---------------- calendar: weekday, Ontario holiday, school day (TDSB calendar)
  const dayFmt = typeof Intl !== 'undefined' ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }) : null;
  const DOWS = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }, dayCache = new Map();
  const TYPICAL_DAY = { date: null, dow: 1, holiday: null, school: true }; // shift + sandbox: a normal school Tuesday
  function dayInfo(t) {
    if (live.typical || !live.epoch0 || !dayFmt) return TYPICAL_DAY;
    const di = Math.floor(t / 86400); let d = dayCache.get(di); if (d) return d;
    const p = {}; for (const x of dayFmt.formatToParts(new Date((live.epoch0 + di * 86400 + 43200) * 1000))) p[x.type] = x.value;
    const date = `${p.year}-${p.month}-${p.day}`, dow = DOWS[p.weekday] ?? 1, cal = live.calendar;
    const hol = cal && cal.holidays.find(h => h.date === date); const yr = cal && cal.school.find(y => date >= y.first && date <= y.last);
    d = { date, dow, holiday: hol ? hol.name : null, school: !!(yr && dow < 5 && !hol && !cal.noschool.includes(date)) };
    dayCache.set(di, d); return d;
  }
  const offDay = t => { const d = dayInfo(t); return d.dow >= 5 || !!d.holiday; };

  // ---------------- entry point: the page hands over the weekly ("static") and 15-minute ("live") feeds
  function liveFeed(feed, o) {
    o = o || {};
    if (o.kind !== undefined) live.kind = o.kind; if (o.epoch0) live.epoch0 = o.epoch0; if (o.typical !== undefined) live.typical = o.typical;
    const st = feed.static, lv = feed.live;
    if (st && !live.built.static) {
      live.built.static = true;
      if (st.calendar) { live.calendar = st.calendar; dayCache.clear(); }
      live.stations = (st.stations || []).map(s => { const [x, y] = ll(s.lng, s.lat); return { id: String(s.id), name: s.name, x, y }; });
      if (st.hoods) buildCensus(st.hoods);
      if (st.towers) buildTowers(st.towers);
      if (st.schools) buildSchools(st.schools);
      if (st.worship) buildWorship(st.worship);
      if (st.sites) buildSites(st.sites);
      if (st.go) buildRail(st.go, st.crossings || []);
      live.fsa = st.fsa || {}; live.ttcStatic = st.ttc || []; live.subway = st.subway || {}; if (st.bsched) buildSched(st.bsched); if (st.enforce) buildEnforce(st.enforce);
    }
    if (lv) {
      if (lv.rates) live.rates = lv.rates;
      if (lv.roads) roadworkFromFeed(lv.roads);
      if (lv.cuts) cutsFromFeed(lv.cuts);
      if (lv.s311) spotsFromFeed(lv.s311);
      if (lv.weather && (live.kind || o.weather)) applyWeather(lv.weather);
      if (live.ttcStatic && o.buses !== false) busesFromFeed(live.ttcStatic, lv.ttc_detours || []);
      if (lv.ttc_alerts) shuttlesFromFeed(lv.ttc_alerts);
      if (o.calls && lv.calls) callsFromFeed(lv.calls);
      if (o.calls && lv.hwy && live.kind === 'live') hwyFromFeed(lv.hwy);
    }
    live.dirty = true;
    return liveInfo();
  }
  function liveInfo() {
    let buses = 0, trips = 0; for (let c = 0; c < CAP; c++) if (alive[c] && cRoute[c]) { trips++; const r = ROUTES[cRoute[c] - 1]; if (r && r.kind === 'bus') buses++; }
    return { kind: live.kind, day: dayInfo(simT), calls: live.calls.size, queue: live.queue.length, zones: live.zones.length, zonesOn: live.zones.filter(z => z.on).length,
      busRoutes: live.buses.length, busesOnRoad: buses, scriptedOnRoad: trips, shuttles: live.shuttles.size, schools: live.schools.length, worship: live.worship.length,
      sites: live.sites.length, towers: live.towers.length, spots: live.spots.length, trains: rail.active.length, crossings: rail.crossings.length, wx: weather };
  }
  let worldAcc = 0;
  function stepWorld() { // once per sim second
    worldAcc++;
    if (worldAcc % 30 === 0) { stepZones(); stepSpots(); stepRealCaps(); }
    if (worldAcc % 300 === 0 && live.hwyList && live.kind === 'live') hwyFromFeed(live.hwyList); // work windows open and close
    if (worldAcc % 5 === 0) { stepSchools(); stepWorship(); stepSites(); }
    stepCalls(); stepBuses(); stepShuttles(); stepRail();
  }
  function pubWorld() { // sent to the page after each feed update (zones alone are re-sent when one switches on or off)
    live.dirty = false;
    return { zones: pubZones(), spots: live.spots.map(p => ({ id: p.id, act: p.act, type: p.type, date: p.date, status: p.status, fsa: p.fsa, x: p.x, y: p.y })),
      schools: live.schools.map(s => ({ name: s.name, kind: s.kind, x: s.x, y: s.y, bell: s.bell, end: s.end })), worship: live.worship.map(w => ({ name: w.name, faith: w.faith, x: w.x, y: w.y, svc: w.svc })),
      sites: live.sites.map(s => ({ addr: s.addr, units: s.units, cost: s.cost, use: s.use, desc: s.desc, x: s.x, y: s.y, crane: s.crane })),
      shuttles: [...live.shuttles.values()].map(s => ({ id: s.id, name: s.name, header: s.header, pts: s.pts })),
      detours: live.buses.filter(b => b.detour).map(b => ({ route: b.route, name: b.name, headsign: b.detour })), census: live.census,
      towers: live.towers.map(t => [Math.round(t.x), Math.round(t.y), t.storeys, t.units, +t.ang.toFixed(3), t.addr, t.built]), rails: rail.lines,
      crossings: rail.crossings.map(c => [Math.round(c.x), Math.round(c.y)]), guards: live.schools.map(s => s.guard ? [Math.round(s.guard.x), Math.round(s.guard.y)] : null) };
  }
  function pubWorldLive() { // small, every slow frame
    return { schools: live.schools.map((s, i) => s.phase ? [i, s.phase, s.guard && s.guard.crossing ? 1 : 0] : null).filter(Boolean),
      worship: live.worship.map((w, i) => w.active ? i : -1).filter(i => i >= 0), sites: live.sites.map((s, i) => s.working ? i : -1).filter(i => i >= 0),
      gates: rail.crossings.map((c, i) => c.down ? i : -1).filter(i => i >= 0), rb: [...live.real.buses.values()].map(b => { const [x, y] = realPos(b); return [b.id, b.route, Math.round(x), Math.round(y), b.v == null ? null : +(b.v * 3.6).toFixed(0)]; }),
      spots: live.spots.map((p, i) => p.on ? i : -1).filter(i => i >= 0), day: dayInfo(simT),
      hm: Array.from(hoodMul, v => +v.toFixed(2)), hr: live.real.hr ? Array.from(live.real.hr, v => +v.toFixed(2)) : null, slow: live.real.slow || [], late: live.real.lateN || [0, 0],
      blk: live.real.blk.map(k => [k.id, Math.round(k.x), Math.round(k.y), k.n, k.routes.join(', '), k.mins, k.road]) };
  }

