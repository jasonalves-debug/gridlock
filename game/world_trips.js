  // ================================================================ WORLD — scripted trips
  // A scripted trip is an ordinary car (same lanes, car-following, signals) that follows a fixed list of edges instead of
  // a routing tree. It can stop (bus stop, school drop-off) or park (the trip ends at the kerb). If its next edge closes,
  // it falls back to normal routing. Used by TTC buses + detours, subway shuttles, school runs, worship, construction trucks.
  const ROUTES = [], routeFree = [];
  const LOOK = { bus: { type: T_TRUCK, len: 12, color: 255 }, shuttle: { type: T_TRUCK, len: 12, color: 252 }, truck: { type: T_TRUCK, len: 10, color: 253 }, car: { type: T_CAR, len: 4.6, color: -1 } };
  function addRoute(r) { const i = routeFree.length ? routeFree.pop() : ROUTES.length; ROUTES[i] = r; return i; }
  function dropRoute(i) { ROUTES[i] = null; routeFree.push(i); }
  function releaseCar(c) { const ri = cRoute[c] - 1; cRoute[c] = 0; cStopS[c] = -1; cPark[c] = 0; const r = ROUTES[ri]; if (r && r.oneOff) dropRoute(ri); }
  function spawnOnRoute(ri, at) {
    const r = ROUTES[ri], L = LOOK[r.look]; let i = 0, acc = 0;
    if (at) while (i < r.path.length - 1 && acc + eLen[r.path[i]] < at) { acc += eLen[r.path[i]]; i++; }
    const e = r.path[i], s = at ? Math.max(3, Math.min(eLen[e] - 3, at - acc)) : r.startS !== undefined ? r.startS : 4;
    const c = spawnCar(e, s, eLanes[e] - 1, L.type, r.dest, edgeHood[e], 0);
    if (c < 0) { if (r.oneOff) dropRoute(ri); return -1; }
    cRoute[c] = ri + 1; cRi[c] = i; cLen[c] = L.len; if (L.color >= 0) cColor[c] = L.color;
    cNext[c] = r.path[i + 1] !== undefined ? r.path[i + 1] : -1; setStop(c, r, i, s);
    return c;
  }
  function setStop(c, r, i, sNow) {
    cStopS[c] = -1; cPark[c] = 0;
    const st = r.stops && r.stops.get(i);
    if (st) { if (st.s > sNow - 1) { cStopS[c] = st.s; cDwell[c] = st.dwell; cPark[c] = st.park ? 1 : 0; } return; }
    if (r.kind === 'bus' && i > 0) { // far-side stops after signals, mid-block stops on long blocks
      const f = r.path[i]; if (eCtrl[r.path[i - 1]] >= 0 && eLen[f] > 40) cStopS[c] = Math.min(16, eLen[f] * 0.35); else if (eLen[f] > 420) cStopS[c] = eLen[f] * 0.5;
      if (cStopS[c] >= 0) cDwell[c] = 9 + rand() * 16 + demandAt(simT / 3600) * 8; }
  }
  function routeNext(c, e) { // next edge on the script; -1 at the end; null = fall back to normal routing
    const r = ROUTES[cRoute[c] - 1]; if (!r) { cRoute[c] = 0; return null; }
    const p = r.path; let i = cRi[c];
    if (p[i] !== e) { i = p.indexOf(e, Math.max(0, i - 2)); if (i < 0) { releaseCar(c); cLive[c] = 1; return null; } cRi[c] = i; }
    const n = p[i + 1]; if (n === undefined) return -1;
    if (blocked(n)) { releaseCar(c); cLive[c] = 1; return null; }
    return n;
  }
  function routeEnter(c) { const r = ROUTES[cRoute[c] - 1]; if (!r) return; cRi[c]++; setStop(c, r, cRi[c], 0); }
  function oneOff(kind, path, look, stops, startS) { const last = path[path.length - 1]; return addRoute({ kind, oneOff: true, path, look, stops, startS, dest: hoodDest[nodeHood[eB[last]]] }); }
  const pick = (arr, k) => arr[(k >>> 0) % arr.length];
  function sampleNodes(nodes, n, seed) { if (nodes.length <= n) return nodes; const out = []; for (let i = 0; i < n; i++) out.push(nodes[hash(seed + i) % nodes.length]); return out; }

  // ---------------- TTC buses on real routes at real frequencies; real detour shapes when TTC publishes one
  live.buses = [];
  function busesFromFeed(routes, detours) {
    const det = new Map(detours.map(d => [d.route + '|' + d.dir, d]));
    for (const r of routes) {
      const key = r.route + '|' + r.dir, d = det.get(key), sig = d ? d.headsign + d.line.length : '';
      let b = live.buses.find(q => q.key === key); if (b && b.sig === sig) continue;
      const path = pathAlong((d ? d.line : r.line).map(p => ll(p[0], p[1])), 110, 45); const len = pathLen(path);
      if (path.length < 4 || len < 800) continue;
      const route = { kind: 'bus', path, look: 'bus', dest: hoodDest[nodeHood[eB[path[path.length - 1]]]] };
      if (b) { ROUTES[b.ri] = route; Object.assign(b, { sig, len, detour: d ? d.headsign : null }); continue; } // buses already out re-find their edge or fall back
      b = { key, route: r.route, name: r.name, dir: r.dir, ri: addRoute(route), tph: r.tph, next: simT + rand() * 300, sig, len, detour: d ? d.headsign : null };
      live.buses.push(b);
      const tph = busTph(b, simT); if (tph >= 0.5) for (let at = rand() * 23400 / tph; at < len - 100; at += 23400 / tph) spawnOnRoute(b.ri, at); // already out, ~6.5 m/s average
    }
  }
  function busTph(b, t) { const d = dayInfo(t), k = d.holiday || d.dow === 6 ? 'su' : d.dow === 5 ? 'sa' : 'wd'; return (b.tph && b.tph[k] && b.tph[k][Math.floor(secOfDay(t) / 3600)]) || 0; }
  function stepBuses() { if (live.real.on) return; for (const b of live.buses) { if (simT < b.next) continue; const tph = busTph(b, simT); if (tph < 0.3) { b.next = simT + 900; continue; } b.next = simT + (spawnOnRoute(b.ri, 0) >= 0 ? 3600 / tph * (0.85 + rand() * 0.3) : 20); } }

  // ---------------- real TTC buses: live GPS positions (via the relay) replace the scheduled ones while the feed works.
  // Each bus is snapped to the curb lane of the road it's on and glides to its new fix over 30 s. How fast buses move
  // between fixes is the best live congestion signal we have: where real buses crawl, the sim's cars are slowed to match.
  live.real = { buses: new Map(), on: false, caps: new Map() };
  const BUS_LANE_ROADS = /^(eglinton ave e|kingston rd|morningside ave)$/i; // red bus lanes: bus speed there says nothing about car traffic
  const GLIDE = 30, CAP_TTL = 600;
  let bays = null; // subway station bus bays: buses sit there between trips
  function realBuses(feed) {
    const R = live.real; bays = bays || Object.values(live.subway || {}).map(([, lat, lng]) => ll(lng, lat));
    for (const [id, route, lat, lng, brg, ts] of feed.v || []) {
      const [x, y] = ll(lng, lat), dir = brg == null ? null : Math.atan2(-Math.cos(brg * Math.PI / 180), Math.sin(brg * Math.PI / 180));
      let best = null, score = 60; // nearest road whose direction matches the bus's heading
      for (const h of edgesNear(x, y, 35, e => eCls[e] >= 2)) { const a = posOnEdge(h.e, h.s, 0)[2], turn = dir == null ? 0 : Math.abs(((a - dir + 3 * Math.PI) % (2 * Math.PI)) - Math.PI), sc = h.d + turn * 20; if (sc < score) { score = sc; best = h; } }
      if (!best) continue;
      const [px, py, pa] = posOnEdge(best.e, best.s, laneLat(best.e, eLanes[best.e] - 1));
      let b = R.buses.get(id);
      if (!b) R.buses.set(id, b = { id, route, x0: px, y0: py, a0: pa, x: px, y: py, a: pa, t0: simT, ts, e: best.e, v: null });
      else if (ts > b.ts) {
        const dt = ts - b.ts, dist = Math.hypot(px - b.x, py - b.y); b.v = dt > 0 ? dist / dt : b.v;
        if (dist < 8) { if (!b.still) b.still = b.ts; } else b.still = 0; // feed time it stopped moving
        if (dt >= 10 && dt <= 180 && dist >= 8 && !bays.some(([sx, sy]) => (sx - px) ** 2 + (sy - py) ** 2 < 150 * 150)) observe(best.e, dist / dt);
        const [cx, cy, ca] = realPos(b); Object.assign(b, { x0: cx, y0: cy, a0: ca, x: px, y: py, a: pa, t0: simT, ts, e: best.e, route });
      }
      b.seen = simT; if (ts > (R.feedT || 0)) R.feedT = ts;
    }
    for (const [id, b] of R.buses) if (simT - b.seen > 300) R.buses.delete(id);
    const was = R.on; R.on = R.buses.size > 0;
    if (R.on && !was) for (let c = 0; c < CAP; c++) if (alive[c] && cRoute[c] && ROUTES[cRoute[c] - 1] && ROUTES[cRoute[c] - 1].kind === 'bus') despawn(c, false); // scheduled buses make way
    return { buses: R.buses.size, slowed: R.caps.size };
  }
  // The TTC timetable's own pace for each stretch (weekday, by time of day; it already allows for normal rush hour).
  // A bus running well behind that pace is the congestion signal: "late" catches the 15-20 km/h crawl the old fixed 10 km/h rule missed.
  live.sched = new Map(); // edge → [m/s per period]
  function buildSched(list) {
    for (const [la, ga, lb, gb, sp] of list) {
      const [ax, ay] = ll(ga, la), [bx, by] = ll(gb, lb), L = Math.hypot(bx - ax, by - ay), dir = Math.atan2(by - ay, bx - ax); if (L < 50) continue;
      for (let d = 25; d < L; d += 50) {
        const x = ax + (bx - ax) * d / L, y = ay + (by - ay) * d / L; let best = -1, score = 40;
        for (const h of edgesNear(x, y, 30, e => eCls[e] >= 2)) { const a = posOnEdge(h.e, h.s, 0)[2], turn = Math.abs(((a - dir + 3 * Math.PI) % (2 * Math.PI)) - Math.PI); if (turn > 0.8) continue; const sc = h.d + turn * 20; if (sc < score) { score = sc; best = h.e; } }
        if (best >= 0 && !live.sched.has(best)) live.sched.set(best, sp);
      }
    }
  }
  function schedSpeed(e) { const sp = live.sched.get(e); if (!sp) return 0; const h = secOfDay(simT) / 3600, k = h >= 5 && h < 7 ? 0 : h >= 7 && h < 9.5 ? 1 : h >= 9.5 && h < 15 ? 2 : h >= 15 && h < 19 ? 3 : 4; return sp[k] || sp[2] || 0; }
  function observe(e, v) { // a moving bus's speed on this road (m/s, stops included)
    if (BUS_LANE_ROADS.test(edgeName(e) || '')) return;
    const R = live.real, c = R.caps.get(e) || { v, n: 0, on: false }; c.v = c.n ? c.v * 0.5 + v * 0.5 : v; c.n++; c.t = simT; R.caps.set(e, c);
    const exp = schedSpeed(e); c.r = exp ? Math.min(1.5, c.v / exp) : null; // pace vs timetable: 1 = on schedule, 0.5 = taking twice as long
    // Badly behind schedule (or, with no timetable here, under 10 km/h): the road is jammed right now, so the cars on it are capped.
    // Moderately late roads aren't capped; they raise the area's traffic instead (stepAreas).
    let cap = 99;
    if (c.n >= 2) cap = c.r != null ? (c.r < 0.5 ? Math.max(2.5, eVmax[e] * c.r) : 99) : (c.v < 2.8 ? Math.max(2.5, c.v * 2) : 99);
    if (cap < eVmax[e]) { vcSet(e, cap, 'rb'); c.on = true; } else if (c.on) { vcClr(e, 'rb'); c.on = false; }
  }
  // Every 30 s: for each neighbourhood with a few buses reporting, how far behind the timetable are they on average?
  // Behind → more trips start and end there (up to ~2x); on time or ahead → normal. Eases in and out.
  function stepAreas() {
    const sum = new Float32Array(H), cnt = new Float32Array(H);
    for (const [e, c] of live.real.caps) if (c.r != null && simT - c.t < 600) { const h = edgeHood[e]; if (h >= 0) { sum[h] += c.r; cnt[h]++; } }
    const R = live.real; if (!R.hr || R.hr.length !== H) R.hr = new Float32Array(H).fill(1);
    const by = new Map(); let nLate = 0, nAll = 0; // for the broadcast: slowest named roads and the share of roads behind timetable
    for (const [e, c] of R.caps) if (c.r != null && simT - c.t < 600) { nAll++; if (c.r < 0.75) nLate++; const nm = edgeName(e); if (!nm || c.n < 2) continue; const o = by.get(nm) || { s: 0, n: 0, e, lo: 9 }; o.s += c.r; o.n++; if (c.r < o.lo) { o.lo = c.r; o.e = e; } by.set(nm, o); }
    R.lateN = [nLate, nAll];
    R.slow = [...by].filter(([, o]) => o.s / o.n < 0.7).sort((a, b) => a[1].s / a[1].n - b[1].s / b[1].n).slice(0, 4).map(([nm, o]) => { const [x, y] = posOnEdge(o.e, eLen[o.e] / 2, 0); return [nm, +(o.s / o.n).toFixed(2), Math.round(x), Math.round(y)]; });
    for (let h = 0; h < H; h++) {
      const r = cnt[h] >= 3 ? sum[h] / cnt[h] : 1; R.hr[h] = r; const target = r >= 0.9 ? 1 : Math.min(2.2, Math.pow(0.9 / Math.max(0.3, r), 1.5)); // 75% of timetable pace → 1.3x trips, 50% → 2.2x
      const m = hoodMul[h] + (target - hoodMul[h]) * 0.25; if (Math.abs(m - hoodMul[h]) > 0.002) setHoodMul(h, m);
    }
  }
  // Possible blockage: 2+ real buses that haven't moved for 4+ minutes within 150 m of each other, on a road,
  // away from subway bus bays and route ends (where buses wait between trips). Often a crash or stalled vehicle
  // before anyone reports it. Cars on that road slow right down while it lasts.
  live.real.blk = []; let terms = null;
  function stepBlockages() {
    const R = live.real, now = R.feedT || 0;
    terms = terms || (live.ttcStatic || []).flatMap(r => r.line && r.line.length ? [ll(...r.line[0]), ll(...r.line[r.line.length - 1])] : []);
    const away = (x, y) => !(bays || []).some(([sx, sy]) => (sx - x) ** 2 + (sy - y) ** 2 < 250 * 250) && !terms.some(([tx, ty]) => (tx - x) ** 2 + (ty - y) ** 2 < 300 * 300);
    const st = [...R.buses.values()].filter(b => b.route && b.still && now - b.still >= 240 && simT - b.seen < 120 && eCls[b.e] >= 2 && away(b.x, b.y));
    const groups = [], used = new Set();
    for (const b of st) { if (used.has(b)) continue; const g = st.filter(o => !used.has(o) && (o.x - b.x) ** 2 + (o.y - b.y) ** 2 < 150 * 150); if (g.length < 2) continue; g.forEach(o => used.add(o)); groups.push(g); }
    const keep = new Map(R.blk.map(k => [k.id, k]));
    R.blk = groups.map(g => { const x = g.reduce((a, o) => a + o.x, 0) / g.length, y = g.reduce((a, o) => a + o.y, 0) / g.length, e = g[0].e;
      const old = R.blk.find(k => (k.x - x) ** 2 + (k.y - y) ** 2 < 200 * 200), id = old ? old.id : 'b' + Math.round(x) + '_' + Math.round(y);
      return { id, x, y, e, n: g.length, routes: [...new Set(g.map(o => o.route))], mins: Math.round((now - Math.min(...g.map(o => o.still))) / 60), road: edgeName(e) }; });
    for (const k of R.blk) { keep.delete(k.id); vcSet(k.e, 3, 'blk'); if (revEdge[k.e] >= 0) vcSet(revEdge[k.e], 6, 'blk'); }
    for (const k of keep.values()) { vcClr(k.e, 'blk'); if (revEdge[k.e] >= 0) vcClr(revEdge[k.e], 'blk'); }
  }
  function stepRealCaps() { // every 30 s: expire old slowdowns; if the feed has gone quiet, the scheduled buses come back
    const R = live.real; for (const [e, c] of R.caps) if (simT - c.t > CAP_TTL) { if (c.on) vcClr(e, 'rb'); R.caps.delete(e); }
    for (const [id, b] of R.buses) if (simT - b.seen > 300) R.buses.delete(id); R.on = R.buses.size > 0;
    if (live.kind === 'live') { stepAreas(); stepBlockages(); } }
  function realPos(b) { // [x, y, angle] now: gliding from the previous fix to the latest one
    const f = Math.min(1, (simT - b.t0) / GLIDE), da = ((b.a - b.a0 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
    return [b.x0 + (b.x - b.x0) * f, b.y0 + (b.y - b.y0) * f, b.a0 + da * f];
  }
  function writeRealBuses(buf, k) { // TTC livery, same look as the scheduled buses
    for (const b of live.real.buses.values()) { if (k + 4 > buf.length) break; const [x, y, a] = realPos(b); buf[k++] = x; buf[k++] = y; buf[k++] = a; buf[k++] = T_TRUCK | (255 << 4) | (1 << 12); }
    return k;
  }

  // ---------------- subway closures → shuttle buses on the surface (TTC service alerts)
  live.shuttles = new Map();
  function stationNode(lat, lng) { const [x, y] = ll(lng, lat); for (const r of [400, 1500, 4000]) { const ns = nodesWithin(x, y, 0, r, outsArterial); if (ns.length) return ns.reduce((a, b) => Math.hypot(NX[a] - x, NY[a] - y) < Math.hypot(NX[b] - x, NY[b] - y) ? a : b); } return -1; }
  function shuttlesFromFeed(alerts) {
    const now = live.epoch0 ? live.epoch0 + simT : Date.now() / 1000, want = new Map();
    for (const a of alerts) if (a.shuttle && (!a.periods.length || a.periods.some(([s, t]) => (s || 0) <= now + 600 && now <= (t || 4e9)))) want.set(a.id, a);
    for (const [id, s] of live.shuttles) if (!want.has(id)) { for (const ri of s.ri) dropRoute(ri); live.shuttles.delete(id); }
    for (const [id, a] of want) {
      if (live.shuttles.has(id)) continue; const [an, alat, alng] = a.shuttle.from, [bn, blat, blng] = a.shuttle.to;
      const na = stationNode(alat, alng), nb = stationNode(blat, blng); if (na < 0 || nb < 0 || na === nb) continue;
      const ab = shortPath(na, nb, 25000, 3), ba = shortPath(nb, na, 25000, 3); if (!ab || !ba || !ab.length || !ba.length) continue;
      const mk = p => addRoute({ kind: 'shuttle', path: p, look: 'shuttle', dest: hoodDest[nodeHood[eB[p[p.length - 1]]]], stops: new Map([[p.length - 1, { s: Math.max(4, eLen[p[p.length - 1]] - 10), dwell: 30 }]]) });
      const pts = [[NX[eA[ab[0]]], NY[eA[ab[0]]]]].concat(ab.map(e => [NX[eB[e]], NY[eB[e]]]));
      live.shuttles.set(id, { id, name: `${an} to ${bn}`, header: a.header, ri: [mk(ab), mk(ba)], next: simT, pts });
    }
  }
  function stepShuttles() { for (const s of live.shuttles.values()) if (simT >= s.next) { s.next = simT + 150; for (const ri of s.ri) spawnOnRoute(ri, 0); } } // a shuttle every 2.5 min each way

  // ---------------- census (2021 neighbourhood profiles): car share sets how many parents drive to school
  live.census = [];
  function buildCensus(hoods) {
    live.census = hoods.filter(h => h.commuters).map(h => ({ name: h.name, pop: h.pop, hh: h.hh, car: h.car, transit: h.transit, walk: h.walk, bike: h.bike, commuters: h.commuters, poly: h.poly.map(p => ll(p[0], p[1])) }));
    const shares = live.census.map(h => h.car / h.commuters); live.carMean = shares.reduce((a, b) => a + b, 0) / (shares.length || 1);
  }
  function censusAt(x, y) { for (const h of live.census) { let inside = false; const P = h.poly; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > y) !== (P[j][1] > y) && x < (P[j][0] - P[i][0]) * (y - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0]) inside = !inside; if (inside) return h; } return null; }
  function carShareFactor(x, y) { const h = censusAt(x, y); return h && live.carMean ? Math.max(0.6, Math.min(1.4, h.car / h.commuters / live.carMean)) : 1; }

  // ---------------- schools: bell-time drop-off and pickup runs, 30 km/h school zones, crossing guards
  // Bell times aren't published as data; boards stagger them between 8:30 and 9:00, so each school gets one deterministically.
  live.schools = [];
  const BELLS = { elem: [HM(8, 30), HM(8, 40), HM(8, 45), HM(8, 50), HM(9)], sec: [HM(8, 45), HM(9)], private: [HM(8, 30), HM(8, 45)] };
  const SCHOOL_DAY = { elem: HM(6, 30), sec: HM(6, 15), private: HM(7) };
  const RUNS = { elem: 22, sec: 10, private: 14 }; // cars per bell (each sim car stands for ~2.5 real ones)
  function schoolGuard(x, y) {
    let best = -1, bd = 1e18;
    for (const n of nodesWithin(x, y, 0, 220)) { let ins = 0; for (let q = IN.start[n]; q < IN.start[n + 1]; q++) if (eCls[IN.list[q]] >= 3) ins++; const d = Math.hypot(NX[n] - x, NY[n] - y); if (ins >= 3 && d < bd) { bd = d; best = n; } }
    if (best < 0) return null; const ins = []; for (let q = IN.start[best]; q < IN.start[best + 1]; q++) if (eCls[IN.list[q]] >= 3) ins.push(IN.list[q]);
    return { node: best, x: NX[best], y: NY[best], ins, crossing: false, next: 0 };
  }
  function buildSchools(list) {
    for (const s of list) {
      const [x, y] = ll(s.lng, s.lat); const drop = edgeNear(x, y, 80, e => eCls[e] >= 3 && eCls[e] <= CLS_RES && eLen[e] > 30); if (!drop) continue;
      const homes = nodesWithin(x, y, 350, 1500, outsRes); if (homes.length < 4) continue;
      const h = hash(s.name), bell = pick(BELLS[s.kind], h);
      live.schools.push({ name: s.name, kind: s.kind, x, y, dropE: drop.e, dropS: Math.max(8, Math.min(eLen[drop.e] - 8, drop.s)), bell, end: bell + SCHOOL_DAY[s.kind],
        homes: sampleNodes(homes, 24, s.name), zone: edgesNear(x, y, 160, e => eCls[e] >= 4 && eVmax[e] > 8.5).map(q => q.e), guard: s.kind === 'elem' ? schoolGuard(x, y) : null,
        n: Math.round(RUNS[s.kind] * carShareFactor(x, y)), queue: [], phase: null, zoneOn: false });
    }
  }
  function stepSchools() {
    const day = dayInfo(simT), t = secOfDay(simT);
    for (const s of live.schools) {
      const phase = !day.school ? null : t >= s.bell - HM(0, 35) && t < s.bell + HM(0, 8) ? 'am' : t >= s.end - HM(0, 10) && t < s.end + HM(0, 25) ? 'pm' : null;
      if (phase && phase !== s.phase) { const [a, b, d0, d1] = phase === 'am' ? [s.bell - HM(0, 25), s.bell + HM(0, 2), 15, 40] : [s.end - HM(0, 8), s.end + HM(0, 12), 60, 180];
        s.queue = []; for (let k = 0; k < s.n; k++) { const at = a + rand() * (b - a); if (at > t) s.queue.push({ t: at, dwell: d0 + rand() * (d1 - d0) }); } s.queue.sort((p, q) => p.t - q.t); }
      if (!phase) s.queue.length = 0; s.phase = phase;
      const zoneOn = day.school && t >= s.bell - HM(0, 45) && t < s.end + HM(0, 30);
      if (zoneOn !== s.zoneOn) { for (const e of s.zone) zoneOn ? vcSet(e, 8.3, 'sz' + s.name) : vcClr(e, 'sz' + s.name); s.zoneOn = zoneOn; }
      while (s.queue.length && s.queue[0].t <= t) schoolRun(s, s.queue.shift().dwell);
      if (s.guard) stepGuard(s.guard, !!phase);
    }
  }
  function schoolRun(s, dwell) { // home → stop at the school's kerb (double-parked) → onward
    const from = pick(s.homes, rand() * 1e9), to = pick(s.homes, rand() * 1e9);
    const p1 = shortPath(from, eA[s.dropE], 2600); if (!p1) return; const p2 = shortPath(eB[s.dropE], to, 2600); if (!p2) return;
    spawnOnRoute(oneOff('school', p1.concat([s.dropE], p2), 'car', new Map([[p1.length, { s: s.dropS, dwell }]])), 0);
  }
  function stepGuard(g, on) { // crossing guard: holds every approach for ~12 s about once a minute while kids are coming and going
    const id = 'cg' + g.node, hold = v => { for (const e of g.ins) for (let l = 0; l < eLanes[e]; l++) v ? lbSet(laneOf(e, l), Math.max(1, eLen[e] - 4), id) : lbClr(laneOf(e, l), id); g.crossing = v; };
    if (!on) { if (g.crossing) hold(false); return; }
    if (simT < g.next) return;
    if (g.crossing) { hold(false); g.next = simT + 45 + rand() * 25; } else { hold(true); g.next = simT + 10 + rand() * 5; }
  }

  // ---------------- places of worship: arrivals before the service, kerbside parking, departures after
  live.worship = [];
  const SERVICES = { // [day (0 = Mon), start, end, cars]
    Christian: [[6, HM(10), HM(12), 14]], Catholic: [[6, HM(9, 30), HM(11, 30), 18], [5, HM(17), HM(18), 8]], Orthodox: [[6, HM(10), HM(12, 30), 12]],
    Muslim: [[4, HM(13, 15), HM(14, 15), 26]], Hindu: [[6, HM(10), HM(12, 30), 16], [4, HM(18, 30), HM(20), 10]], Sikh: [[6, HM(10), HM(13), 22]],
    Buddhist: [[6, HM(10), HM(12), 10]], Jewish: [[5, HM(9, 30), HM(12), 4]], Other: [[6, HM(10), HM(12), 8]] };
  const CHURCH_HOLY = /good friday|christmas/i;
  function buildWorship(list) {
    for (const w of list) {
      const [x, y] = ll(w.lng, w.lat); const at = edgeNear(x, y, 60, e => eCls[e] >= 3 && eCls[e] <= CLS_RES && eLen[e] > 30); if (!at) continue;
      const homes = nodesWithin(x, y, 400, 2500, outsRes); if (homes.length < 4) continue;
      live.worship.push({ name: w.name, faith: w.faith, x, y, e: at.e, s: Math.max(8, Math.min(eLen[at.e] - 8, at.s)), homes: sampleNodes(homes, 20, w.name),
        size: 0.5 + (hash(w.name) % 110) / 100, svc: SERVICES[w.faith] || SERVICES.Other, queue: [], cur: null, active: false, parked: false });
    }
  }
  function stepWorship() {
    const day = dayInfo(simT), t = secOfDay(simT);
    for (const w of live.worship) {
      const holy = day.holiday && CHURCH_HOLY.test(day.holiday) && /Christian|Catholic|Orthodox/.test(w.faith);
      const sv = w.svc.find(([d, a, b]) => (d === day.dow || (holy && d === 6)) && t >= a - HM(0, 35) && t < b + HM(0, 30)) || null;
      if (sv !== w.cur) { w.cur = sv; w.queue = []; if (sv) { const [, a, b, n0] = sv, n = Math.round(n0 * w.size * (holy ? 1.6 : 1));
          for (let k = 0; k < n; k++) { const ta = a - HM(0, 30) + rand() * HM(0, 35), tb = b + rand() * HM(0, 25); if (ta > t) w.queue.push({ t: ta, arrive: true }); if (tb > t) w.queue.push({ t: tb, arrive: false }); }
          w.queue.sort((p, q) => p.t - q.t); w.busy = n >= 16; } }
      w.active = !!sv;
      const park = !!sv && w.busy && t >= sv[1] - HM(0, 20) && t < sv[2] + HM(0, 20);
      if (park !== w.parked) { const id = 'wp' + w.name; if (eLanes[w.e] >= 2) park ? lbSet(curbLane(w.e), Math.max(2, w.s - 10), id) : lbClr(curbLane(w.e), id); else park ? vcSet(w.e, 7, id) : vcClr(w.e, id); w.parked = park; }
      while (w.queue.length && w.queue[0].t <= t) { const q = w.queue.shift(), home = pick(w.homes, rand() * 1e9);
        if (q.arrive) { const p = shortPath(home, eA[w.e], 3000); if (p) spawnOnRoute(oneOff('visit', p.concat([w.e]), 'car', new Map([[p.length, { s: w.s, dwell: 0, park: true }]])), 0); }
        else { const p = shortPath(eB[w.e], home, 3000); if (p) spawnOnRoute(oneOff('visit', [w.e].concat(p), 'car', null, w.s), 0); } }
    }
  }

  // ---------------- construction sites (active building permits): dump trucks in and out, hoarding on the kerb lane
  live.sites = [];
  function buildSites(list) {
    for (const s of list) {
      const [x, y] = ll(s.lng, s.lat); const at = edgeNear(x, y, 80, e => eCls[e] >= 2 && eCls[e] <= CLS_RES && eLen[e] > 40); if (!at) continue;
      const far = nodesWithin(x, y, 2500, 6000, outsArterial); if (far.length < 3) continue;
      live.sites.push({ addr: s.addr, units: s.units, cost: s.cost, use: s.use, desc: s.desc, x, y, e: at.e, s: Math.max(10, Math.min(eLen[at.e] - 10, at.s)), far: sampleNodes(far, 16, s.addr),
        crane: s.units >= 40 || s.cost >= 25e6, every: Math.max(240, Math.min(900, 900 - s.cost / 1e6 * 4)), hoard: s.cost >= 20e6 && eLanes[at.e] >= 2, next: 0, out: true, working: false });
    }
  }
  function stepSites() {
    const day = dayInfo(simT), t = secOfDay(simT);
    for (const s of live.sites) {
      const working = !day.holiday && ((day.dow < 5 && t >= HM(7) && t < HM(16, 30)) || (day.dow === 5 && s.cost >= 50e6 && t >= HM(8) && t < HM(14)));
      if (working !== s.working) { if (s.hoard) working ? lbSet(curbLane(s.e), Math.max(2, s.s - 20), 'site' + s.addr) : lbClr(curbLane(s.e), 'site' + s.addr); s.working = working; s.next = simT + rand() * s.every; }
      if (!working || simT < s.next) continue;
      s.next = simT + s.every * (0.7 + rand() * 0.6); s.out = !s.out; const far = pick(s.far, rand() * 1e9);
      if (s.out) { const p = shortPath(eB[s.e], far, 9000, 3); if (p) spawnOnRoute(oneOff('truck', [s.e].concat(p), 'truck', null, s.s), 0); }
      else { const p = shortPath(far, eA[s.e], 9000, 3); if (p) spawnOnRoute(oneOff('truck', p.concat([s.e]), 'truck', new Map([[p.length, { s: s.s, dwell: 0, park: true }]])), 0); }
    }
  }

  // ---------------- apartment towers: trips start where people actually live (units from the City's building registry)
  live.towers = [];
  const towerUnits = new Float32Array(H), towerByHood = Array.from({ length: H }, () => ({ list: [], cw: [], tot: 0 }));
  const HOUSES_PER_KM = 120; // detached/semi homes per km of residential street (both sides), for the tower-vs-house split
  function buildTowers(list) {
    for (const t of list) {
      const [x, y] = ll(t.lng, t.lat); const at = edgeNear(x, y, 60, e => eCls[e] >= 3 && eCls[e] <= CLS_RES && eLen[e] > 20); if (!at) continue;
      const tw = { x, y, storeys: t.storeys, units: t.units, addr: t.addr, built: t.built, ang: posOnEdge(at.e, at.s, 0)[2], e: at.e, s: Math.max(3, Math.min(eLen[at.e] - 3, at.s)), hood: edgeHood[at.e] };
      live.towers.push(tw); const b = towerByHood[tw.hood]; b.tot += tw.units; b.list.push(tw); b.cw.push(b.tot); towerUnits[tw.hood] += tw.units;
    }
  }
  function towerOrigin(h) { // → a tower in hood h, chosen in proportion to tower units vs houses on its streets
    const tu = towerUnits[h]; if (!tu || rand() >= tu / (tu + hoodResKm[h] * HOUSES_PER_KM)) return null;
    const b = towerByHood[h], x = rand() * b.tot; let lo = 0, hi = b.cw.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (b.cw[m] < x) lo = m + 1; else hi = m; } return b.list[lo];
  }

