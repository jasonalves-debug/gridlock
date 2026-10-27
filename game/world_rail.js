  // ================================================================ WORLD — GO trains (Stouffville + Lakeshore East) on their real timetable
  // Trains run along the GTFS track shapes, interpolated between scheduled station times. Where a track crosses a road
  // at grade (OpenStreetMap level crossings), the gates drop for each passing train and traffic queues.
  const TRAIN_V = 24, COACH = 26, COACHES = 10, GATE_AHEAD = 480; // m/s between stations, coach length, train length, gate warning distance
  const rail = { shapes: [], trips: {}, crossings: [], active: [], dates: [], lines: [] };
  function buildRail(go, crossings) {
    rail.shapes = go.shapes.map(s => { const P = s.line.map(p => ll(p[0], p[1])), cum = [0]; for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
      const L = cum[cum.length - 1]; return { P, cum, L, scale: L / (s.cum[s.cum.length - 1] || L) }; }); // feed distances → sim metres
    rail.lines = trackLines(rail.shapes);
    rail.trips = go.trips; rail.dates = Object.keys(go.trips).sort();
    const byPlace = new Map(); // one physical crossing can sit on several track shapes
    for (const c of crossings) { const sh = rail.shapes[c.shape]; if (!sh) continue; const key = Math.round(c.lat * 3000) + ':' + Math.round(c.lng * 3000);
      let x = byPlace.get(key); if (!x) { const [px, py] = ll(c.lng, c.lat); x = { x: px, y: py, on: [], edges: edgesNear(px, py, 14, e => eCls[e] >= 2).map(h => ({ e: h.e, s: h.s })), down: false }; byPlace.set(key, x); }
      x.on.push({ shape: c.shape, d: c.d * sh.scale }); }
    rail.crossings = [...byPlace.values()].filter(c => c.edges.length);
  }
  function trackLines(shapes) { // distinct track for drawing: shapes overlap (variants of one line), keep only runs not already covered
    const seen = new Set(), key = (x, y) => Math.round(x / 12) + ':' + Math.round(y / 12), near = (x, y) => { const i = Math.round(x / 12), j = Math.round(y / 12);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (seen.has((i + a) + ':' + (j + b))) return true; return false; };
    const out = [];
    for (const sh of shapes) { let run = []; const dense = [];
      for (let i = 1; i < sh.P.length; i++) { const [ax, ay] = sh.P[i - 1], [bx, by] = sh.P[i], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 10)); for (let k = i === 1 ? 0 : 1; k <= n; k++) dense.push([ax + (bx - ax) * k / n, ay + (by - ay) * k / n]); }
      for (const p of dense) { if (near(p[0], p[1])) { if (run.length > 1) out.push(run); run = []; } else run.push(p); }
      if (run.length > 1) out.push(run); for (const p of dense) seen.add(key(p[0], p[1])); }
    return out.map(r => r.filter((p, i) => i % 3 === 0 || i === r.length - 1)); // 30 m spacing is plenty on GO alignments
  }
  const ymd = date => date ? date.replace(/-/g, '') : null;
  function trainHead(pts, t) { // metres along the track at service time t (extrapolated in and out of the map)
    const n = pts.length; if (t <= pts[0][0]) return pts[0][1] - (pts[0][0] - t) * TRAIN_V; if (t >= pts[n - 1][0]) return pts[n - 1][1] + (t - pts[n - 1][0]) * TRAIN_V;
    let i = 1; while (pts[i][0] < t) i++; const [t0, d0] = pts[i - 1], [t1, d1] = pts[i]; return t1 > t0 ? d0 + (d1 - d0) * (t - t0) / (t1 - t0) : d1;
  }
  function stepRail() { // which trains are on the map, and which gates are down (once per sim second)
    if (!rail.shapes.length) return;
    const today = ymd(dayInfo(simT).date), sod = secOfDay(simT), active = [];
    const days = today ? [[today, 0], [ymd(dayInfo(simT - 86400).date), 86400]] : [[rail.dates[Math.min(1, rail.dates.length - 1)], 0]]; // typical day: any weekday timetable
    for (const [date, off] of days) for (const [si, pts] of rail.trips[date] || []) {
      const t = sod + off, sh = rail.shapes[si]; if (t < pts[0][0] - 1800 || t > pts[pts.length - 1][0] + 1800) continue;
      const d = trainHead(pts, t) * sh.scale; if (d > -60 && d - COACH * COACHES < sh.L + 60) active.push({ sh, si, pts, off }); }
    rail.active = active;
    rail.crossings.forEach((c, i) => {
      const down = active.some(tr => c.on.some(o => o.shape === tr.si && (() => { const d = trainHead(tr.pts, sod + tr.off) * tr.sh.scale; return d > o.d - GATE_AHEAD && d < o.d + COACH * COACHES + 30; })()));
      if (down !== c.down) { for (const { e, s } of c.edges) for (let l = 0; l < eLanes[e]; l++) down ? lbSet(laneOf(e, l), Math.max(1, s - 6), 'gx' + i) : lbClr(laneOf(e, l), 'gx' + i); c.down = down; }
    });
  }
  function shapeAt(sh, d) { // [x, y, angle] at metres d along a track shape
    const C = sh.cum; let lo = 0, hi = C.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (C[m] <= d) lo = m; else hi = m; }
    const a = sh.P[lo], b = sh.P[hi], f = (d - C[lo]) / ((C[hi] - C[lo]) || 1); return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, Math.atan2(b[1] - a[1], b[0] - a[0])];
  }
  function writeTrains(buf, k) { // coaches go into the vehicle buffer: truck type, long, colour code 254 (GO livery); lead coach flagged with the brake bit
    const sod = secOfDay(simT);
    for (const tr of rail.active) { const head = trainHead(tr.pts, sod + tr.off) * tr.sh.scale;
      for (let c = 0; c < COACHES; c++) { const d = head - c * COACH - COACH / 2; if (d < 0 || d > tr.sh.L || k + 4 > buf.length) continue; const [x, y, a] = shapeAt(tr.sh, d);
        buf[k++] = x; buf[k++] = y; buf[k++] = a; buf[k++] = T_TRUCK | (c === 0 ? 1 << 3 : 0) | (254 << 4) | (1 << 12); } }
    return k;
  }

