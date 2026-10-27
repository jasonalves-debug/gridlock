// GRIDLOCK — traffic simulation core. Runs in a Web Worker in the page and in Node for headless tests.
(function (root) {
'use strict';

const DT = 0.25, LANE_W = 3.4;
const T_CAR = 0, T_TRUCK = 1, T_POLICE = 2, T_EMS = 3, T_TOW = 4, T_HYDRO = 5, T_WATER = 6, T_FIRE = 7;
const CLS_RES = 5;

function rngOf(seed) { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

function createSim(G, opts) {
  opts = opts || {};
  const rand = rngOf(opts.seed || 1234);
  const CAP = opts.cap || 14000;
  const N = G.nx.length, E = G.ea.length;
  const NX = Float32Array.from(G.nx), NY = Float32Array.from(G.ny);
  const eA = Int32Array.from(G.ea), eB = Int32Array.from(G.eb), eLanes = Uint8Array.from(G.lanes), eCls = Uint8Array.from(G.cls);
  const eVmax = Float32Array.from(G.spd, v => v / 3.6), eCtrl = Int16Array.from(G.ctrl), eGrp = Uint8Array.from(G.grp), eStop = Uint8Array.from(G.stop);
  const eGo = Int32Array.from(G.go), eGc = Uint16Array.from(G.gc), eRev = Uint8Array.from(G.rev), eUnder = Uint8Array.from(G.under), eName = Int32Array.from(G.name);
  const geo = Float32Array.from(G.geo), nodeHood = Uint8Array.from(G.hood), H = G.hoods.length;
  // cumulative distance along each polyline
  const cum = new Float32Array(geo.length / 2);
  const eLen = new Float32Array(E);
  for (let e = 0; e < E; e++) { const go = eGo[e], gc = eGc[e]; if (eRev[e] === 0 || cum[go + gc - 1] === 0) { let acc = 0; cum[go] = 0; for (let i = 1; i < gc; i++) { const dx = geo[(go + i) * 2] - geo[(go + i - 1) * 2], dy = geo[(go + i) * 2 + 1] - geo[(go + i - 1) * 2 + 1]; acc += Math.sqrt(dx * dx + dy * dy); cum[go + i] = acc; } } eLen[e] = Math.max(1, cum[go + gc - 1]); }
  // bearings
  const bIn = new Float32Array(E), bOut = new Float32Array(E);
  function ptAt(e, k) { const go = eGo[e], gc = eGc[e]; const i = eRev[e] ? go + gc - 1 - k : go + k; return i; }
  for (let e = 0; e < E; e++) { const gc = eGc[e]; let i0 = ptAt(e, 0), i1 = ptAt(e, 1); bOut[e] = Math.atan2(geo[i1 * 2 + 1] - geo[i0 * 2 + 1], geo[i1 * 2] - geo[i0 * 2]);
    i0 = ptAt(e, gc - 2); i1 = ptAt(e, gc - 1); bIn[e] = Math.atan2(geo[i1 * 2 + 1] - geo[i0 * 2 + 1], geo[i1 * 2] - geo[i0 * 2]); }
  // CSR adjacency
  function csr(key) { const start = new Int32Array(N + 1); for (let e = 0; e < E; e++) start[key[e] + 1]++; for (let i = 0; i < N; i++) start[i + 1] += start[i]; const list = new Int32Array(E), fill = start.slice(0, N); for (let e = 0; e < E; e++) list[fill[key[e]]++] = e; return { start, list }; }
  const OUT = csr(eA), IN = csr(eB);
  // reverse edge (same geometry, opposite direction)
  const revEdge = new Int32Array(E).fill(-1);
  { const m = new Map(); for (let e = 0; e < E; e++) { const k = eGo[e]; if (m.has(k)) { const o = m.get(k); revEdge[e] = o; revEdge[o] = e; } else m.set(k, e); } }
  const laneBase = new Int32Array(E + 1); for (let e = 0; e < E; e++) laneBase[e + 1] = laneBase[e] + eLanes[e];
  const NL = laneBase[E];
  const laneHead = new Int32Array(NL).fill(-1), laneTail = new Int32Array(NL).fill(-1), laneBlock = new Float32Array(NL).fill(-1);
  const emx = new Float32Array(E), emy = new Float32Array(E); for (let e = 0; e < E; e++) { const go = eGo[e], gc = eGc[e], m = go + (gc >> 1); emx[e] = (geo[go * 2] + geo[(go + gc - 1) * 2]) / 2; emy[e] = (geo[go * 2 + 1] + geo[(go + gc - 1) * 2 + 1]) / 2; }
  const edgeHood = new Uint8Array(E); for (let e = 0; e < E; e++) edgeHood[e] = nodeHood[eA[e]];
  const edgeVcap = new Float32Array(E).fill(99);
  // several owners can block the same lane / cap the same edge (crash + roadwork); keep the tightest
  const lbOwn = new Map(), vcOwn = new Map();
  function lbApply(ln) { const m = lbOwn.get(ln); let v = -1; if (m) for (const x of m.values()) if (v < 0 || x < v) v = x; laneBlock[ln] = v; }
  function lbSet(ln, s, id) { let m = lbOwn.get(ln); if (!m) lbOwn.set(ln, m = new Map()); m.set(id, s); lbApply(ln); }
  function lbClr(ln, id) { const m = lbOwn.get(ln); if (!m) { laneBlock[ln] = -1; return; } m.delete(id); if (!m.size) lbOwn.delete(ln); lbApply(ln); }
  function vcApply(e) { const m = vcOwn.get(e); let v = 99; if (m) for (const x of m.values()) v = Math.min(v, x); edgeVcap[e] = v; }
  function vcSet(e, v, id) { let m = vcOwn.get(e); if (!m) vcOwn.set(e, m = new Map()); m.set(id, v); vcApply(e); }
  function vcClr(e, id) { const m = vcOwn.get(e); if (!m) { edgeVcap[e] = 99; return; } m.delete(id); if (!m.size) vcOwn.delete(e); vcApply(e); }
  const edgeClosed = new Uint8Array(E), nodeClosed = new Uint8Array(N), localOnly = new Uint8Array(E);
  // controllers
  const C = G.ctrls.length;
  const ctrlCycle = new Float32Array(C), ctrlSplit = new Float32Array(C), ctrlOff = new Float32Array(C), ctrlMode = new Uint8Array(C), ctrlDark = new Uint8Array(C), ctrlPolice = new Uint8Array(C);
  const ctrlBusy = new Float32Array(C), ctrlOldest = new Float32Array(C).fill(1e9), ctrlOldestNext = new Float32Array(C).fill(1e9);
  const ctrlPhase = new Uint8Array(C), ctrlPhaseT = new Float32Array(C), ctrlQ = new Float32Array(C * 2);
  const ctrlAppr = G.ctrls.map(() => []);
  for (let e = 0; e < E; e++) if (eCtrl[e] >= 0) ctrlAppr[eCtrl[e]].push(e);
  for (let c = 0; c < C; c++) { const k = G.ctrls[c]; ctrlCycle[c] = k.cls <= 2 ? 100 : 80; ctrlSplit[c] = k.split >= 1 ? 0.62 : k.split; ctrlOff[c] = rand() * ctrlCycle[c]; }
  const nodeBusy = new Float32Array(N); const ctrlCnt = new Float32Array(C), ctrlFlow = new Float32Array(C), ctrlTot = new Float64Array(C); let flowT = 0;
  const AMBER = 4, ALLRED = 2;
  function sigColor(c, grp, t) { // 0 green 1 amber 2 red
    const cyc = ctrlCycle[c], usable = cyc - 2 * (AMBER + ALLRED), g0 = usable * ctrlSplit[c], g1 = usable - g0;
    const tc = (t + ctrlOff[c]) % cyc;
    if (tc < g0) return grp === 0 ? 0 : 2; if (tc < g0 + AMBER) return grp === 0 ? 1 : 2; if (tc < g0 + AMBER + ALLRED) return 2;
    const t2 = tc - g0 - AMBER - ALLRED; if (t2 < g1) return grp === 1 ? 0 : 2; if (t2 < g1 + AMBER) return grp === 1 ? 1 : 2; return 2;
  }
  function greenShare(c, grp) { const usable = ctrlCycle[c] - 2 * (AMBER + ALLRED); return (grp === 0 ? ctrlSplit[c] : 1 - ctrlSplit[c]) * usable / ctrlCycle[c]; }

  // ---------------------------------------------------------------- destinations
  const D = []; // {kind, name, targets:Int32Array, w, x, y, hood}
  const isT = []; // Uint8Array per dest
  function nodesNear(x, y, r, pred, max) { const out = []; const r2 = r * r; for (let i = 0; i < N; i++) { const dx = NX[i] - x, dy = NY[i] - y; if (dx * dx + dy * dy <= r2 && (!pred || pred(i))) out.push(i); } out.sort((a, b) => ((NX[a] - x) ** 2 + (NY[a] - y) ** 2) - ((NX[b] - x) ** 2 + (NY[b] - y) ** 2)); return max ? out.slice(0, max) : out; }
  const notHwy = i => { for (let k = IN.start[i]; k < IN.start[i + 1]; k++) if (eCls[IN.list[k]] <= 1) return false; return true; };
  function addDest(kind, name, targets, w, x, y, extra) { const t = new Uint8Array(N); for (const n of targets) t[n] = 1; const d = Object.assign({ kind, name, targets: Int32Array.from(targets), w, x, y, hood: nodeHood[targets[0]] }, extra || {}); D.push(d); isT.push(t); return D.length - 1; }
  G.places.forEach(p => { if (p.w > 0) addDest('place', p.n, nodesNear(p.x, p.y, 320, notHwy, 14), p.w, p.x, p.y, { t: p.t }); });
  const portalDest = [];
  G.portals.forEach(p => { const d = addDest('portal', p.name, p.snk, p.w, p.x, p.y, { side: p.side, src: p.src, cls: p.cls }); portalDest.push(d); });
  const hoodDest = G.hoods.map(h => addDest('hood', h.n, nodesNear(h.x, h.y, 700, i => notHwy(i), 40), 1, h.x, h.y));
  if (G.demandW && G.demandW.dest) for (const d of D) { const k = d.kind + ':' + d.name; if (G.demandW.dest[k]) d.w *= G.demandW.dest[k]; }
  // DVP / 404 closures: the streets drivers bail onto (Victoria Park, Pharmacy, a little Warden). Each gets a north and a south end.
  const SPILL = [['Victoria Park Avenue', 0.45], ['Pharmacy Avenue', 0.35], ['Warden Avenue', 0.2]].map(([name, share]) => {
    const re = new RegExp('^' + name.split(' ')[0] + '\\b', 'i'), es = [];
    for (let e = 0; e < E; e++) if (eCls[e] >= 2 && eName[e] >= 0 && re.test(G.names[eName[e]]) && /ave/i.test(G.names[eName[e]])) es.push(e);
    if (es.length < 4) return null;
    const north = es.filter(e => NY[eB[e]] > NY[eA[e]]).sort((a, b) => NY[eA[a]] - NY[eA[b]])[0]; // southbound, northmost
    const south = es.filter(e => NY[eB[e]] < NY[eA[e]] && NY[eA[e]] < 9500).sort((a, b) => NY[eA[b]] - NY[eA[a]])[0]; // northbound, southmost
    if (north === undefined || south === undefined) return null;
    const dS = addDest('spill', name + ' south', nodesNear(NX[eA[south]], NY[eA[south]], 160, null, 6), 0, NX[eA[south]], NY[eA[south]]);
    const dN = addDest('spill', name + ' north', nodesNear(NX[eA[north]], NY[eA[north]], 160, null, 6), 0, NX[eA[north]], NY[eA[north]]);
    return { name, share, sbEdge: north, nbEdge: south, toS: dS, toN: dN, accS: 0, accN: 0 };
  }).filter(Boolean);
  const spill = { S: 0, N: 0 }; // 0..1: how much of the closed highway's traffic is pouring onto these streets, by direction
  const SPECIAL0 = D.length, NSPECIAL = 40;
  const specialFree = []; for (let i = 0; i < NSPECIAL; i++) { addDest('special', '', [0], 0, 0, 0); specialFree.push(SPECIAL0 + i); }
  const ND = D.length;
  const nextLive = new Int32Array(ND * N).fill(-1), nextHab = new Int32Array(ND * N).fill(-1);
  const distLive = new Float32Array(ND * N), distHab = new Float32Array(ND * N);

  // residential spawn edges per hood (weighted by length)
  const hoodRes = Array.from({ length: H }, () => ({ e: [], cw: [], tot: 0 }));
  const hoodResKm = new Float32Array(H);
  for (let e = 0; e < E; e++) if (eCls[e] === CLS_RES && eLen[e] > 25) { const h = hoodRes[edgeHood[e]]; h.tot += eLen[e]; h.e.push(e); h.cw.push(h.tot); hoodResKm[edgeHood[e]] += eLen[e] / 1000; }
  const hoodW = hoodRes.map((h, i) => h.tot * (G.demandW && G.demandW.hood ? G.demandW.hood[i] || 1 : 1)); const hoodWTot = hoodW.reduce((a, b) => a + b, 0);

  // ---------------------------------------------------------------- costs & trees
  const lastCnt = new Uint16Array(E), lastSumV = new Float32Array(E);
  const ttFree = new Float32Array(E), ttEma = new Float32Array(E), lastExit = new Float32Array(E), edgeCnt = new Uint16Array(E), edgeSumV = new Float32Array(E);
  for (let e = 0; e < E; e++) { ttFree[e] = eLen[e] / eVmax[e]; ttEma[e] = ttFree[e]; }
  const costHab = new Float32Array(E), costLive = new Float32Array(E);
  function staticPen(e) {
    const c = eCtrl[e];
    if (c >= 0) { if (ctrlDark[c] && !ctrlPolice[c]) return 35; if (ctrlPolice[c]) return 14; const share = greenShare(c, eGrp[e]); return (1 - share) * (1 - share) * ctrlCycle[c] * 0.5; }
    return eStop[e] === 1 ? 6 : eStop[e] === 2 ? 2 : 0;
  }
  function percMul(e) { return (eCls[e] === CLS_RES ? 1.3 : eCls[e] === 4 ? 1.08 : 1) * (localOnly[e] ? 8 : 1); }
  function percAdd(e) { return eCls[e] === CLS_RES ? 3 : 0; }
  function blocked(e) { return edgeClosed[e] > 0 || nodeClosed[eB[e]] > 0; }
  function updateCosts(live) {
    for (let e = 0; e < E; e++) {
      const base = ttFree[e] + staticPen(e);
      if (live) {
        if (blocked(e)) { costLive[e] = Infinity; continue; }
        let tt = Math.max(base, ttEma[e]);
        if (lastCnt[e] > 0 && simT - lastExit[e] > 25) tt = Math.max(tt, (simT - lastExit[e]) + ttFree[e]);
        if (weather.rain) tt *= 1.12;
        costLive[e] = tt * percMul(e) + percAdd(e);
      } else costHab[e] = base * percMul(e) + percAdd(e);
    }
  }
  // binary heap
  const hk = new Float64Array(E + N + 8), hv = new Int32Array(E + N + 8); let hn = 0;
  function hpush(k, v) { let i = hn++; while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= k) break; hk[i] = hk[p]; hv[i] = hv[p]; i = p; } hk[i] = k; hv[i] = v; }
  function hpop() { const v = hv[0], k = hk[--hn]; const vv = hv[hn]; let i = 0; for (;;) { let c = 2 * i + 1; if (c >= hn) break; if (c + 1 < hn && hk[c + 1] < hk[c]) c++; if (hk[c] >= k) break; hk[i] = hk[c]; hv[i] = hv[c]; i = c; } hk[i] = k; hv[i] = vv; return v; }
  const tmpDist = new Float64Array(N);
  function buildTree(d, cost, next, dist) {
    const off = d * N; tmpDist.fill(Infinity); hn = 0;
    for (const t of D[d].targets) { tmpDist[t] = 0; hpush(0, t); }
    for (let i = 0; i < N; i++) next[off + i] = -1;
    while (hn > 0) { const k0 = hk[0]; const v = hpop(); if (k0 > tmpDist[v]) continue;
      for (let k = IN.start[v]; k < IN.start[v + 1]; k++) { const e = IN.list[k]; const c = cost[e]; if (c === Infinity) continue; const u = eA[e]; const nd = tmpDist[v] + c; if (nd < tmpDist[u]) { tmpDist[u] = nd; next[off + u] = e; hpush(nd, u); } } }
    for (let i = 0; i < N; i++) dist[off + i] = tmpDist[i];
  }
  let treeCursor = 0;
  function refreshSomeTrees(n) { for (let k = 0; k < n; k++) { const d = treeCursor++ % ND; if (D[d].kind === 'special' && !D[d].active) continue; buildTree(d, costLive, nextLive, distLive); } }

  // ---------------------------------------------------------------- vehicles
  const alive = new Uint8Array(CAP), cEdge = new Int32Array(CAP), cLane = new Uint8Array(CAP), cS = new Float32Array(CAP), cV = new Float32Array(CAP);
  const cNext = new Int32Array(CAP), cDest = new Int16Array(CAP), cLive = new Uint8Array(CAP), cType = new Uint8Array(CAP), cLen = new Float32Array(CAP);
  const cAhead = new Int32Array(CAP), cBehind = new Int32Array(CAP), cTick = new Int32Array(CAP), cWait = new Float32Array(CAP), cWaitStart = new Float32Array(CAP);
  const cEnter = new Float32Array(CAP), cStart = new Float32Array(CAP), cFree = new Float32Array(CAP), cDrv = new Float32Array(CAP), cLc = new Float32Array(CAP);
  const cYield = new Float32Array(CAP), cPull = new Float32Array(CAP), cEsc = new Uint8Array(CAP), cWhy = new Uint8Array(CAP), cGrant = new Float32Array(CAP), cLat = new Float32Array(CAP), cOrigH = new Int16Array(CAP), cDestH = new Int16Array(CAP), cStuck = new Float32Array(CAP), cColor = new Uint8Array(CAP), cBrake = new Uint8Array(CAP), cLost = new Uint8Array(CAP);
  const cRoute = new Int32Array(CAP), cRi = new Int32Array(CAP), cStopS = new Float32Array(CAP).fill(-1), cDwell = new Float32Array(CAP), cPark = new Uint8Array(CAP); // scripted trips (world_trips.js)
  const freeList = []; for (let i = CAP - 1; i >= 0; i--) freeList.push(i);
  let nCars = 0;

  function laneOf(e, l) { return laneBase[e] + l; }
  function lAppend(c, ln) { const t = laneTail[ln]; cAhead[c] = t; cBehind[c] = -1; if (t >= 0) cBehind[t] = c; else laneHead[ln] = c; laneTail[ln] = c; }
  function lRemove(c, ln) { const a = cAhead[c], b = cBehind[c]; if (a >= 0) cBehind[a] = b; else laneHead[ln] = b; if (b >= 0) cAhead[b] = a; else laneTail[ln] = a; cAhead[c] = cBehind[c] = -1; }
  function lInsertByS(c, ln) { // keep order front (high s) -> back
    let p = laneTail[ln]; while (p >= 0 && cS[p] < cS[c]) p = cAhead[p];
    // insert behind p
    const b = p >= 0 ? cBehind[p] : laneHead[ln];
    cAhead[c] = p; cBehind[c] = b; if (p >= 0) cBehind[p] = c; else laneHead[ln] = c; if (b >= 0) cAhead[b] = c; else laneTail[ln] = c;
  }
  function gapsAt(ln, s, len, skip) { // returns [gapAhead, gapBehind, aheadId, behindId]
    let p = laneTail[ln], behind = -1; while (p >= 0 && cS[p] < s) { if (p !== skip) behind = p; p = cAhead[p]; } while (p === skip && p >= 0) p = cAhead[p];
    const ga = p >= 0 ? cS[p] - cLen[p] - s : 1e9; const gb = behind >= 0 ? s - len - cS[behind] : 1e9; return [ga, gb, p, behind];
  }

  function turnOf(f, n) { let d = bOut[n] - bIn[f]; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d > 0.55 ? 1 : d < -0.55 ? -1 : 0; } // 1 right, -1 left
  function pickNext(c, e) {
    if (cRoute[c]) { const rn = routeNext(c, e); if (rn !== null) return rn; }
    const b = eB[e], d = cDest[c];
    if (isT[d][b]) return -1;
    const off = d * N; let n = (cLive[c] ? nextLive : nextHab)[off + b];
    if (n < 0 || blocked(n) || n === revEdge[e]) {
      // fallback: best open outgoing edge by live cost-to-go
      let best = -1, bv = Infinity; const dist = cLive[c] ? distLive : distHab;
      for (let k = OUT.start[b]; k < OUT.start[b + 1]; k++) { const o = OUT.list[k]; if (blocked(o)) continue; let v = costLive[o] + dist[off + eB[o]]; if (o === revEdge[e]) v += 600; if (!(v < Infinity)) v = 1e7 + rand(); if (v < bv) { bv = v; best = o; } }
      n = best; if (n >= 0 && !cLive[c]) cLive[c] = 1;
    }
    return n;
  }
  function targetLane(c, e) { // preferred lane on e given the next turn
    const nl = eLanes[e]; if (nl === 1) return 0; const n = cNext[c]; if (n < 0) return nl - 1;
    const t = turnOf(e, n); if (cRoute[c] && t >= 0) return nl - 1; return t < 0 ? 0 : t > 0 ? nl - 1 : -1;
  }
  function entryLane(c, f, fromLane, turn) { const nl = eLanes[f]; if (nl === 1) return 0; if (turn < 0) return 0; if (turn > 0) return nl - 1; const ne = eLanes[cEdge[c]]; return Math.max(0, Math.min(nl - 1, nl - (ne - fromLane))); }

  function spawnCar(e, s, lane, type, dest, origH, live) {
    if (!freeList.length) return -1; const ln = laneOf(e, lane);
    const len = type === T_TRUCK ? 10 : 4.6;
    const [ga, gb] = gapsAt(ln, s, len, -1); if (ga < 4 || gb < 4) return -1;
    if (laneBlock[ln] >= 0 && Math.abs(laneBlock[ln] - s) < 15) return -1;
    const c = freeList.pop(); alive[c] = 1; nCars++;
    cEdge[c] = e; cLane[c] = lane; cS[c] = s; cV[c] = 0; cType[c] = type; cLen[c] = len; cDest[c] = dest; cLive[c] = live ? 1 : 0;
    cDrv[c] = 0.88 + rand() * 0.24; cGrant[c] = 0; cEsc[c] = 0; cYield[c] = 0; cPull[c] = 0; cWait[c] = 0; cWaitStart[c] = 0; cLc[c] = rand() * 2; cLat[c] = lane; cStuck[c] = 0; cLost[c] = 0; cBrake[c] = 0;
    cRoute[c] = 0; cStopS[c] = -1; cPark[c] = 0; cOrigH[c] = origH; cDestH[c] = D[dest].kind === 'hood' || D[dest].kind === 'place' ? D[dest].hood : -1; cColor[c] = (rand() * 255) | 0;
    cEnter[c] = simT; cStart[c] = simT; const fd = distHab[dest * N + eB[e]]; cFree[c] = (fd < 1e8 ? fd : 600) + (eLen[e] - s) / eVmax[e];
    lInsertByS(c, ln); cTick[c] = tick;
    cNext[c] = pickNext(c, e);
    return c;
  }
  function despawn(c, arrived) {
    const ln = laneOf(cEdge[c], cLane[c]); lRemove(c, ln); alive[c] = 0; nCars--; freeList.push(c); if (cRoute[c]) releaseCar(c);
    if (arrived) { const tt = simT - cStart[c]; const delay = Math.max(0, tt - cFree[c]); stats.trips++; stats.delaySum += delay; stats.recentDelay = stats.recentDelay * 0.995 + delay * 0.005; stats.recentTT = stats.recentTT * 0.995 + tt * 0.005; }
  }

  // ---------------------------------------------------------------- state
  let simT = opts.startT || 6 * 3600, tick = 0, stuckNow = 0;
  const weather = { rain: 0, until: 0, intensity: 0 };
  const stats = { incImpact: 0, trips: 0, delaySum: 0, recentDelay: 0, recentTT: 600, emsCalls: 0, emsResp: [], complaints: 0, barricades: 0, spawnFail: 0, gaveUp: 0 };
  const events = [];
  const ev = o => { o.t = simT; events.push(o); };
  let demandScale = opts.demand || 1, targetCars = opts.targetCars || 9000, mode = opts.mode || 'shift';

  // ---------------------------------------------------------------- signals: step
  function ctrlPoliceStep(c) { // adaptive: serve the longer queue
    const q0 = ctrlQ[c * 2], q1 = ctrlQ[c * 2 + 1]; ctrlPhaseT[c] += DT;
    const cur = ctrlPhase[c] & 1, inChange = ctrlPhase[c] >> 1; // inChange: 0 green, 1 clearing
    if (inChange) { if (ctrlPhaseT[c] >= 2.5) { ctrlPhase[c] = (1 - cur); ctrlPhaseT[c] = 0; } return; }
    const qc = cur ? q1 : q0, qo = cur ? q0 : q1;
    if ((ctrlPhaseT[c] > 7 && qo > qc * 1.4 + 1) || ctrlPhaseT[c] > 38 || (qc === 0 && qo > 0 && ctrlPhaseT[c] > 4)) { ctrlPhase[c] = cur | 2; ctrlPhaseT[c] = 0; }
  }
  function policeColor(c, grp) { const cur = ctrlPhase[c] & 1, ch = ctrlPhase[c] >> 1; if (grp !== cur) return 2; return ch ? 1 : 0; }

  // ---------------------------------------------------------------- permission at end of edge
  function priorityApproachBusy(e, b, waited) {
    const tAcc = waited > 25 ? 1.6 : waited > 10 ? 2.4 : 3.2, dAcc = waited > 25 ? 12 : 26;
    for (let k = IN.start[b]; k < IN.start[b + 1]; k++) { const o = IN.list[k]; if (o === e || eStop[o] === 1 || eStop[o] === 2) continue;
      for (let l = 0; l < eLanes[o]; l++) { const h = laneHead[laneOf(o, l)]; if (h < 0) continue; const dist = eLen[o] - cS[h]; if (dist < dAcc && cV[h] > 1.2 && dist / Math.max(cV[h], 0.1) < tAcc) return true; if (dist < 5 && cV[h] > 0.5) return true; } }
    return false;
  }
  let WHY = 0;
  function canEnter(c, e, dist) {
    const f = cNext[c], b = eB[e];
    WHY = 5; if (nodeClosed[b] && !cEsc[c]) return false;
    if (f >= 0 && blocked(f)) return false;
    if (cGrant[c] > simT) return true;
    const ctl = eCtrl[e], emergency = cType[c] >= T_POLICE;
    if (ctl >= 0 && !emergency) {
      WHY = 1; if (ctrlPolice[ctl]) { const col = policeColor(ctl, eGrp[e]); if (col === 2) return false; if (col === 1 && dist > cV[c] * cV[c] / 7 + 2) return false; }
      else if (ctrlDark[ctl]) {
        WHY = 3; if (cWait[c] < 0.6) return false;
        if (simT < ctrlBusy[ctl]) { ctrlOldestNext[ctl] = Math.min(ctrlOldestNext[ctl], cWaitStart[c]); return false; }
        if (cWaitStart[c] > ctrlOldest[ctl] + 0.3) { ctrlOldestNext[ctl] = Math.min(ctrlOldestNext[ctl], cWaitStart[c]); return false; }
        ctrlBusy[ctl] = simT + 2.3; ctrlOldest[ctl] = 1e9; cGrant[c] = simT + 6;
      } else { const col = sigColor(ctl, eGrp[e], simT); if (col === 2) return false; if (col === 1 && dist > cV[c] * cV[c] / 7 + 2) return false; }
    } else if (!emergency && eStop[e] === 1) {
      WHY = 2; if (dist > 6) return false; if (cWait[c] < 0.8) return false;
      if (simT < nodeBusy[b] || priorityApproachBusy(e, b, cWait[c])) return false; nodeBusy[b] = simT + 1.4; cGrant[c] = simT + 6;
    } else if (!emergency && eStop[e] === 2 && dist < 18) {
      WHY = 7;
      if (priorityApproachBusy(e, b, cWait[c])) return false; if (dist < 7) cGrant[c] = simT + 5;
    }
    return true;
  }
  function altNext(c, e) {
    if (cRoute[c]) return;
    const b = eB[e], off = cDest[c] * N; let best = -1, bv = Infinity;
    for (let k = OUT.start[b]; k < OUT.start[b + 1]; k++) { const o = OUT.list[k]; if (o === cNext[c] || blocked(o) || o === revEdge[e]) continue;
      const el = entryLane(c, o, cLane[c], turnOf(e, o)); if (spaceIn(o, el, cLen[c]) < cLen[c] + 2) continue;
      const v = costLive[o] + distLive[off + eB[o]]; if (v < bv) { bv = v; best = o; } }
    if (best >= 0 && bv < 1e8) { cNext[c] = best; cLive[c] = 1; cWait[c] = 0; }
  }
  function spaceIn(f, l, len) { const t = laneTail[laneOf(f, l)]; if (t < 0) return 1e9; return cS[t] - cLen[t]; }

  // ---------------------------------------------------------------- one step
  const IDM = [{ a: 1.7, b: 2.6, T: 1.25, s0: 2.0 }, { a: 0.9, b: 2.0, T: 1.6, s0: 2.6 }];
  function idm(v, v0, gap, dv, p, Tm) {
    if (v0 < 0.1) v0 = 0.1; const sStar = p.s0 + Math.max(0, v * p.T * Tm + v * dv / (2 * Math.sqrt(p.a * p.b)));
    const r = v / v0; const g = Math.max(gap, 0.2); let a = p.a * (1 - r * r * r * r - (sStar / g) * (sStar / g)); return a < -9 ? -9 : a;
  }
  const exitObs = [];
  function stepCars() {
    const Tm = weather.snow ? 1.6 : weather.rain ? 1.35 : weather.fog ? 1.2 : 1, wv = weather.snow ? 0.72 : weather.rain ? 0.86 : weather.fog ? 0.88 : 1;
    for (let ln0 = 0; ln0 < E; ln0++) {
      const e = ln0; const nl = eLanes[e];
      for (let l = 0; l < nl; l++) {
        const ln = laneBase[e] + l;
        let c = laneHead[ln];
        while (c >= 0) {
          const behind = cBehind[c];
          if (cTick[c] === tick) { c = behind; continue; }
          cTick[c] = tick;
          const p = IDM[cType[c] === T_TRUCK ? 1 : 0];
          const L = eLen[e]; const s = cS[c], v = cV[c];
          let v0 = Math.min(eVmax[e] * cDrv[c], edgeVcap[e], cEsc[c] ? 3 : 99, cYield[c] > simT ? 2.5 : 99, spotFlag[e] ? spotCap(e, s) : 99) * wv;
          let gap = 1e9, dv = 0, atLine = false;
          const ah = cAhead[c];
          if (ah >= 0) { gap = cS[ah] - cLen[ah] - s; dv = v - cV[ah]; }
          else {
            const dist = L - s;
            if (cNext[c] < 0 && (cRoute[c] || isT[cDest[c]][eB[e]])) { /* arriving: drive off */ }
            else if (dist < 140 || v * v / 3 > dist - 5) {
              const ok = cNext[c] >= 0 && canEnter(c, e, dist);
              if (!ok) { gap = dist - 1; dv = v; atLine = true; cWhy[c] = WHY; }
              else {
                const f = cNext[c], t = turnOf(e, f); let el = entryLane(c, f, cLane[c], t);
                let sp = spaceIn(f, el, cLen[c]);
                if (sp < cLen[c] + 2) for (let l2 = 0; l2 < eLanes[f]; l2++) { const s2 = spaceIn(f, l2, cLen[c]); if (s2 > sp) { sp = s2; el = l2; } }
                if (sp < cLen[c] + 0.5 && dist < 25) { gap = dist - 1; dv = v; atLine = true; cWhy[c] = 4; if (cWait[c] > (eCls[e] <= 1 ? 1.5 : 12)) altNext(c, e); }
                else if (sp < 1e8) { const tl = laneTail[laneOf(f, el)]; gap = dist + sp; dv = v - cV[tl]; }
                if (t !== 0) { const vt = cType[c] === T_TRUCK ? 5 : 7.5; const vmaxTurn = Math.sqrt(vt * vt + 2 * 1.8 * Math.max(0, dist - 3)); if (vmaxTurn < v0) v0 = vmaxTurn; }
              }
            }
          }
          if (cRoute[c] && cStopS[c] >= 0) { // scripted stop: bus stop, drop-off, or park (trip ends at the kerb)
            const gs = cStopS[c] - s;
            if (gs > -1) { if (gs + 2.3 < gap) { gap = Math.max(0.05, gs + 2.3); dv = v; }
              if (gs < 1.5 && v < 0.5) { if (cPark[c]) { despawn(c, false); c = behind; continue; } gap = 0.05; dv = v; cDwell[c] -= DT; if (cDwell[c] <= 0) cStopS[c] = -1; } }
            else cStopS[c] = -1; }
          const blk = laneBlock[ln];
          if (!atLine) cWhy[c] = 0;
          if (blk >= 0 && blk > s - 1 && !cEsc[c]) { const g2 = blk - s - 3; if (g2 < gap) { gap = g2; dv = v; atLine = true; cWhy[c] = 6; } }
          let a = idm(v, v0, gap, dv, p, Tm);
          let nv = v + a * DT; if (nv < 0) nv = 0;
          let ns = s + (nv < 0.001 && v < 0.001 ? 0 : (v + nv) * 0.5 * DT);
          if (ah >= 0) { const lim = cS[ah] - cLen[ah] - 0.4; if (ns > lim) { ns = Math.max(s, lim); nv = Math.min(nv, cV[ah]); } }
          if (atLine && blk < 0 && ns > L - 0.6) { ns = Math.max(s, L - 0.6); nv = 0; }
          cBrake[c] = a < -0.8 || nv < 0.3 ? 1 : 0;
          // waiting bookkeeping
          if (nv < 0.3) { if (cWait[c] === 0) cWaitStart[c] = simT; cWait[c] += DT; cStuck[c] += DT; } else { cWait[c] = 0; if (nv > 3) cStuck[c] = Math.max(0, cStuck[c] - DT * 2); }
          cV[c] = nv; cS[c] = ns;
          edgeCnt[e]++; edgeSumV[e] += nv;
          if (ns >= L) {
            // cross node
            if (cNext[c] < 0) { if (cRoute[c]) { despawn(c, false); c = behind; continue; } if (isT[cDest[c]][eB[e]]) { exitObs.push(e, simT - cEnter[c]); despawn(c, true); c = behind; continue; } cS[c] = L - 0.01; cV[c] = 0; }
            else {
              const f = cNext[c], t = turnOf(e, f); let el = entryLane(c, f, cLane[c], t);
              let sp = spaceIn(f, el, cLen[c]);
              if (sp < cLen[c] + 0.3) { for (let l2 = 0; l2 < eLanes[f]; l2++) { const s2 = spaceIn(f, l2, cLen[c]); if (s2 > sp) { sp = s2; el = l2; } } }
              if (sp < cLen[c] + 0.3 || blocked(f)) { cS[c] = L - 0.01; cV[c] = Math.min(cV[c], 0.5); }
              else {
                exitObs.push(e, simT - cEnter[c]); lastExit[e] = simT;
                lRemove(c, ln); const ns2 = Math.min(ns - L, sp - 0.5, eLen[f] - 0.1);
                cEdge[c] = f; cLane[c] = el; cS[c] = Math.max(0, ns2); cEnter[c] = simT; cWait[c] = 0; cGrant[c] = 0; cEsc[c] = 0;
                lAppend(c, laneOf(f, el)); if (cRoute[c]) routeEnter(c); cNext[c] = pickNext(c, f);
                if (cNext[c] < 0 && !isT[cDest[c]][eB[f]]) { cLost[c]++; }
              }
            }
          }
          c = behind;
        }
      }
    }
  }

  // lane changes and U-turns (run every step for a stagger of cars)
  function laneChanges() {
    for (let c = tick & 3; c < CAP; c += 4) {
      if (!alive[c]) continue; const e = cEdge[c], nl = eLanes[e];
      cLat[c] += (cLane[c] - cLat[c]) * 0.35; cPull[c] += ((cYield[c] > simT ? 1 : 0) - cPull[c]) * 0.3;
      // U-turn if stuck at a closed node / blocked edge
      if (cWait[c] > 22 && !cEsc[c] && (revEdge[e] < 0 || blocked(revEdge[e]) || cWait[c] > 45) && cAhead[c] < 0 && (nodeClosed[eB[e]] || laneBlock[laneOf(e, cLane[c])] >= 0)) { cEsc[c] = 1; cV[c] = 0; }
      if (cWait[c] > 7 && revEdge[e] >= 0 && !blocked(revEdge[e])) {
        const ln = laneOf(e, cLane[c]); const blk = laneBlock[ln];
        const stuckAtClosure = (cAhead[c] < 0 && (nodeClosed[eB[e]] || (cNext[c] >= 0 && blocked(cNext[c])) || cNext[c] < 0 && !isT[cDest[c]][eB[e]])) || (blk >= 0 && blk - cS[c] < 12 && allLanesBlockedNear(e, blk));
        if (stuckAtClosure) { uturn(c); continue; }
      }
      if (nl < 2) continue;
      cLc[c] -= DT * 4; if (cLc[c] > 0) continue; cLc[c] = 0.8 + rand() * 0.6;
      const ln = laneOf(e, cLane[c]), L = eLen[e], s = cS[c], dist = L - s;
      const blk = laneBlock[ln]; const blockedAhead = blk >= 0 && blk > s && blk - s < 120;
      const tl = targetLane(c, e);
      let want = 0, urgent = false;
      if (blockedAhead) { want = cLane[c] > 0 && laneBlock[ln - 1] < 0 ? -1 : cLane[c] < nl - 1 && laneBlock[ln + 1] < 0 ? 1 : (cLane[c] > 0 ? -1 : 1); urgent = true; }
      else if (tl >= 0 && tl !== cLane[c] && dist < 220) { want = tl < cLane[c] ? -1 : 1; urgent = dist < 90; }
      else if (cAhead[c] >= 0 && cV[cAhead[c]] < eVmax[e] * 0.6 && cS[cAhead[c]] - s < 45 && dist > 120) {
        const dir = rand() < 0.5 ? -1 : 1, nlane = cLane[c] + dir;
        if (nlane >= 0 && nlane < nl && laneBlock[ln + dir] < 0) { const [ga] = gapsAt(ln + dir, s, cLen[c], c); if (ga > cS[cAhead[c]] - s + 12) want = dir; }
      }
      if (!want) continue;
      const nlane = cLane[c] + want; if (nlane < 0 || nlane >= nl) continue;
      const tln = ln + want; const [ga, gb, , bh] = gapsAt(tln, s, cLen[c], c);
      const vb = bh >= 0 ? cV[bh] : 0; const v = cV[c];
      const needA = urgent && v < 1.5 ? 1.2 : 2.5 + v * 0.5, needB = urgent && v < 1.5 && vb < 2 ? 0.8 : 3 + Math.max(0, vb - v) * 1.2 + vb * 0.25;
      if (laneBlock[tln] >= 0 && Math.abs(laneBlock[tln] - s) < 12) continue;
      if (ga > needA && gb > needB) { lRemove(c, ln); cLane[c] = nlane; lInsertByS(c, tln); cLc[c] = 2.5; }
    }
  }
  function allLanesBlockedNear(e, pos) { for (let l = 0; l < eLanes[e]; l++) { const b = laneBlock[laneOf(e, l)]; if (b < 0 || Math.abs(b - pos) > 20) return false; } return true; }
  function uturn(c) {
    const e = cEdge[c], r = revEdge[e]; const ns = Math.max(0, eLen[r] - cS[c] - 2); const l = eLanes[r] - 1;
    const tln = laneOf(r, l); const [ga, gb] = gapsAt(tln, ns, cLen[c], -1); if (ga < 3 || gb < 3) return;
    lRemove(c, laneOf(e, cLane[c])); cEdge[c] = r; cLane[c] = l; cS[c] = ns; cV[c] = 0; cWait[c] = 0; cLive[c] = 1; cEnter[c] = simT;
    lInsertByS(c, tln); cNext[c] = pickNext(c, r); cLat[c] = l;
  }

  // ---------------------------------------------------------------- demand
  function demandAt(h) {
    if (mode === 'whatif') { const p = whatifProfile; return p === 'night' ? 0.18 : p === 'midday' ? 0.55 : 1.0; }
    if (mode === 'watch') { const hh = ((h % 24) + 24) % 24; const wk = offDay(h * 3600); const day = wk ? [[0, 0.15], [6, 0.12], [8, 0.3], [10, 0.6], [13, 0.72], [16, 0.7], [18, 0.6], [21, 0.4], [24, 0.15]] : [[0, 0.12], [5, 0.15], [6.5, 0.6], [8, 1.0], [9.5, 0.6], [12, 0.55], [15.5, 0.75], [17, 1.0], [18.5, 0.7], [21, 0.35], [24, 0.12]]; for (let i = 0; i < day.length - 1; i++) if (hh <= day[i + 1][0]) return day[i][1] + (day[i + 1][1] - day[i][1]) * (hh - day[i][0]) / (day[i + 1][0] - day[i][0]); return 0.12; }
    const pts = [[5, 0.2], [6, 0.32], [6.5, 0.55], [7, 0.82], [7.5, 0.95], [8, 1.0], [8.5, 0.98], [9, 0.78], [9.5, 0.55], [10, 0.45]];
    if (h <= pts[0][0]) return pts[0][1]; for (let i = 0; i < pts.length - 1; i++) if (h <= pts[i + 1][0]) return pts[i][1] + (pts[i + 1][1] - pts[i][1]) * (h - pts[i][0]) / (pts[i + 1][0] - pts[i][0]); return pts[pts.length - 1][1];
  }
  let whatifProfile = opts.profile || 'rush';
  let spawnAcc = 0;
  const destPick = { portalW: [], portalAll: [], jobs: [], hoods: hoodDest };
  D.forEach((d, i) => { if (d.kind === 'portal') { destPick.portalAll.push(i); if (d.side === 'W') destPick.portalW.push(i); } if (d.kind === 'place') destPick.jobs.push(i); });
  // area demand from the real buses (Live): >1 where buses run behind the timetable, so more trips start and end there
  const hoodMul = new Float32Array(H).fill(1); let hoodMulTot = hoodWTot;
  const dw = i => D[i].w * (D[i].hood >= 0 ? hoodMul[D[i].hood] : 1);
  function wpick(list) { let t = 0; for (const i of list) t += dw(i); let r = rand() * t; for (const i of list) { r -= dw(i); if (r <= 0) return i; } return list[list.length - 1]; }
  function pickHood() { let r = rand() * hoodMulTot; for (let h = 0; h < H; h++) { r -= hoodW[h] * hoodMul[h]; if (r <= 0) return h; } return H - 1; }
  function setHoodMul(h, m) { hoodMul[h] = m; let t = 0; for (let k = 0; k < H; k++) t += hoodW[k] * hoodMul[k]; hoodMulTot = t; }
  function spawnTrips(dt) {
    const h = simT / 3600; const dem = demandAt(h) * demandScale;
    // rate tuned so the network carries about targetCars at full demand. In Live the trip time it divides by is a slow
    // 20-minute average, so a sudden jam (crash, closure, buses crawling) lets cars pile up instead of thinning the spawns,
    // and the area multipliers from the real buses add trips on top.
    const isLive = live.kind === 'live';
    if (!isLive || !stats.ttRef || simT - stats.ttRef0 < 1800) { stats.ttRef = stats.recentTT; if (!stats.ttRef0) stats.ttRef0 = simT; }
    else stats.ttRef += (stats.recentTT - stats.ttRef) * Math.min(1, dt / 1200);
    const rate = targetCars / Math.max(240, isLive ? stats.ttRef : stats.recentTT) * dem * (isLive ? hoodMulTot / hoodWTot : 1);
    spawnAcc += rate * dt * (nCars < targetCars * (isLive ? 1.6 : 1.25) ? 1 : 0.2);
    if (spill.S || spill.N) for (const p of SPILL) { // highway refugees on the parallel streets
      const k = 0.25 * p.share * Math.max(0.3, dem) * dt; p.accS += spill.S * k; p.accN += spill.N * k;
      while (p.accS >= 1) { p.accS--; spawnCar(p.sbEdge, 3, (rand() * eLanes[p.sbEdge]) | 0, T_CAR, p.toS, -1, 0); }
      while (p.accN >= 1) { p.accN--; spawnCar(p.nbEdge, 3, (rand() * eLanes[p.nbEdge]) | 0, T_CAR, p.toN, -1, 0); } }
    let tries = 0;
    while (spawnAcc >= 1 && tries++ < 60) {
      spawnAcc -= 1;
      const r = rand(); let truck = rand() < 0.07;
      if (r < 0.58) { // from home
        const hood = pickHood(), HR = hoodRes[hood]; if (!HR.e.length) continue; if (G.hoodHeavy) truck = rand() < Math.min(0.16, G.hoodHeavy[hood] * 1.2);
        let x = rand() * HR.tot, lo = 0, hi = HR.cw.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (HR.cw[m] < x) lo = m + 1; else hi = m; }
        const tw = towerOrigin(hood), e0 = tw ? tw.e : HR.e[lo]; // apartment towers (real unit counts) vs houses
        const q = rand(); const dest = q < 0.30 ? wpick(destPick.portalW) : q < 0.82 ? wpick(destPick.jobs) : hoodDest[(rand() * H) | 0];
        if (D[dest].hood === hood && D[dest].kind === 'hood') continue;
        const s = tw ? tw.s : 5 + rand() * (eLen[e0] - 10);
        if (spawnCar(e0, s, eLanes[e0] - 1, truck ? T_TRUCK : T_CAR, dest, hood, rand() < 0.35) < 0) stats.spawnFail++;
      } else { // from outside
        const pd = wpick(destPick.portalAll); const P = D[pd]; const src = P.src[(rand() * P.src.length) | 0];
        const outs = []; for (let k = OUT.start[src]; k < OUT.start[src + 1]; k++) if (!blocked(OUT.list[k])) outs.push(OUT.list[k]); if (!outs.length) continue;
        const e0 = outs[(rand() * outs.length) | 0];
        let dest;
        if (P.cls === 0) { const q = rand(); dest = q < 0.62 ? wpick(destPick.portalAll.filter(i => i !== pd && D[i].cls === 0)) : q < 0.92 ? wpick(destPick.jobs) : hoodDest[(rand() * H) | 0]; if (dest === undefined) dest = wpick(destPick.jobs); }
        else { const q = rand(); dest = q < 0.7 ? wpick(destPick.jobs) : q < 0.85 ? wpick(destPick.portalAll.filter(i => i !== pd)) : hoodDest[(rand() * H) | 0]; }
        const lane = (rand() * eLanes[e0]) | 0;
        if (spawnCar(e0, 0.5, lane, truck ? T_TRUCK : T_CAR, dest, -1, rand() < 0.35) < 0) stats.spawnFail++;
      }
    }
    if (spawnAcc > 30) spawnAcc = 30;
  }

  // ---------------------------------------------------------------- incidents, units, special vehicles
  const incidents = []; let incSeq = 1;
  const units = []; let unitSeq = 1;
  const pool = { police: 6, tow: 4, hydro: 2, water: 2 };
  function nearestEdge(x, y, pred) { let best = -1, bd = 1e18; for (let e = 0; e < E; e++) { if (pred && !pred(e)) continue; const i = ptAt(e, 0), j = ptAt(e, eGc[e] - 1); const mx = (geo[i * 2] + geo[j * 2]) / 2, my = (geo[i * 2 + 1] + geo[j * 2 + 1]) / 2; const d = (mx - x) ** 2 + (my - y) ** 2; if (d < bd) { bd = d; best = e; } } return best; }
  function posOnEdge(e, s, lat) { // world position
    const go = eGo[e], gc = eGc[e], L = eLen[e]; const rev = eRev[e]; let d = rev ? L - s : s; if (d < 0) d = 0; if (d > L) d = L;
    let i = go; while (i < go + gc - 2 && cum[i + 1] < d) i++;
    const x0 = geo[i * 2], y0 = geo[i * 2 + 1], x1 = geo[i * 2 + 2], y1 = geo[i * 2 + 3]; const seg = cum[i + 1] - cum[i] || 1; const t = (d - cum[i]) / seg;
    let dx = x1 - x0, dy = y1 - y0; const l = Math.sqrt(dx * dx + dy * dy) || 1; dx /= l; dy /= l; if (rev) { dx = -dx; dy = -dy; }
    return [x0 + (x1 - x0) * t - dy * lat, y0 + (y1 - y0) * t + dx * lat, Math.atan2(dy, dx)];
  }
  function laneLat(e, lat) { const nl = eLanes[e]; return revEdge[e] >= 0 ? (lat + 0.5) * LANE_W : (lat - (nl - 1) / 2) * LANE_W; }
  function incAt(inc) { return { x: inc.x, y: inc.y }; }
  function newIncident(type, o) {
    const inc = Object.assign({ id: incSeq++, type, state: 'active', start: simT, crew: null, unit: null, work: 0 }, o);
    incidents.push(inc); applyIncident(inc, 1); if (!o.silent) ev({ k: 'incident', inc: pubInc(inc) }); if (!o.quietResp) respond(inc); return inc;
  }
  function pubInc(i) { return { id: i.id, type: i.type, state: i.state, x: i.x, y: i.y, edge: i.edge, ctrl: i.ctrl, r: i.r, start: i.start, crew: i.crew, queue: i.queue || 0, fire: i.fire, edges: i.edges, nodes: i.nodes, s: i.s, full: i.full, workUntil: i.workUntil, end: i.end, name: i.name, sev: i.sev, etaWork: i.workUntil, unitId: i.unit, hood: i.hood, crash: i.crash, both: i.both, dir: i.dir, at: i.at, blocks: i.blocks, impact: i.impact || 0, real: i.real || null, label: i.label, src: i.src, act: i.act, synth: i.synth, nlanes: i.nlanes, plan: i.plan ? i.plan.map(p => p.kind) : null, desc: i.desc }; }
  function applyIncident(inc, on) {
    const d = on ? 1 : -1;
    if (inc.type === 'collision') { for (const ln of inc.lanes) on ? lbSet(ln, inc.s, inc.id) : lbClr(ln, inc.id); if (inc.rub >= 0) on ? vcSet(inc.rub, 9, inc.id) : vcClr(inc.rub, inc.id); if (inc.full) edgeClosed[inc.edge] += d; }
    else if (inc.type === 'call') { if (inc.lanes) for (const ln of inc.lanes) on ? lbSet(ln, inc.s, inc.id) : lbClr(ln, inc.id); if (inc.edges) for (const e of inc.edges) edgeClosed[e] += d; if (inc.nodes) for (const n of inc.nodes) nodeClosed[n] += d; if (inc.ctrls) for (const c of inc.ctrls) ctrlDark[c] = on ? 1 : 0; if (inc.rub >= 0) on ? vcSet(inc.rub, 7, inc.id) : vcClr(inc.rub, inc.id); }
    else if (inc.type === 'water') { for (const e of inc.edges) { edgeClosed[e] += d; for (let l = 0; l < eLanes[e]; l++) on ? lbSet(laneOf(e, l), e === inc.edge ? inc.s : eLen[e] - inc.s, inc.id) : lbClr(laneOf(e, l), inc.id); } }
    else if (inc.type === 'closure') { for (const n of inc.nodes) nodeClosed[n] += d; }
    else if (inc.type === 'power') { for (const c of inc.ctrls) ctrlDark[c] = on ? 1 : 0; }
    else if (inc.type === 'flood') { for (const e of inc.edges) edgeClosed[e] += d; }
    else if (inc.type === 'barricade' || inc.type === 'roadclosed') { for (const e of inc.edges) edgeClosed[e] += d; }
    else if (inc.type === 'hwy') { const part = inc.nlanes > 0; for (const b of inc.blocks) { const nl = eLanes[b.e]; const k0 = part ? Math.max(0, nl - inc.nlanes) : 0; if (!part || inc.nlanes >= nl) edgeClosed[b.e] += d; for (let l = k0; l < nl; l++) on ? lbSet(laneOf(b.e, l), b.s, inc.id) : lbClr(laneOf(b.e, l), inc.id); } }
  }
  function clearIncident(inc, why) { if (inc.state === 'cleared') return; applyIncident(inc, 0); inc.state = 'cleared'; inc.end = simT; ev({ k: 'cleared', id: inc.id, why, inc: pubInc(inc) }); }
  const CREW_FOR = { collision: 'tow', power: 'hydro', water: 'water', hwy: 'tow' };
  const WORK = { collision: 7 * 60, power: 14 * 60, water: 32 * 60, hwy: 22 * 60 };
  function edgeName(e) { return eName[e] >= 0 ? G.names[eName[e]] : 'a side street'; }
  function crossName(n) { const s = new Set(); for (let k = IN.start[n]; k < IN.start[n + 1]; k++) { const e = IN.list[k]; if (eName[e] >= 0) s.add(G.names[eName[e]]); } const a = [...s].slice(0, 2); return a.length > 1 ? a.join(' & ') : a[0] || 'an intersection'; }
  function ctrlName(c) { return crossName(G.ctrls[c].nodes[0]); }
  function trafficOn(e) { let n = 0; for (let l = 0; l < eLanes[e]; l++) for (let c = laneHead[laneOf(e, l)]; c >= 0; c = cBehind[c]) n++; return n; }

  function makeCollision(e, sev, o) {
    if (e < 0) return null; const nl = eLanes[e]; const s = o && o.s !== undefined ? Math.min(eLen[e] - 6, Math.max(6, o.s)) : Math.min(eLen[e] - 15, Math.max(15, eLen[e] * (0.3 + rand() * 0.5)));
    const nb = sev === 2 ? nl : Math.max(1, Math.min(nl, sev === 1 && nl >= 3 ? 2 : 1));
    const lanes = []; const startL = nb === nl ? 0 : (rand() * (nl - nb + 1)) | 0; for (let l = startL; l < startL + nb; l++) lanes.push(laneOf(e, l));
    const [x, y] = posOnEdge(e, s, laneLat(e, startL + (nb - 1) / 2));
    return newIncident('collision', Object.assign({ edge: e, s, lanes, full: nb === nl, rub: revEdge[e], x, y, sev: nb === nl ? 2 : nb > 1 ? 1 : 0, name: edgeName(e), crew: null, auto: simT + 55 * 60, hood: edgeHood[e], fire: rand() < 0.35 }, o || {}, { s, lanes, x, y }));
  }
  function makeWater(e) {
    if (e < 0) return null; const s = eLen[e] * (0.3 + rand() * 0.4); const edges = [e]; if (revEdge[e] >= 0) edges.push(revEdge[e]);
    const [x, y] = posOnEdge(e, s, 0); return newIncident('water', { edge: e, s, edges, x, y, name: edgeName(e), hood: edgeHood[e] });
  }
  function makeClosure(ctl, dur) {
    const nodes = G.ctrls[ctl].nodes.slice(); const k = G.ctrls[ctl];
    return newIncident('closure', { ctrl: ctl, nodes, x: k.x, y: k.y, name: ctrlName(ctl), auto: simT + dur, hood: nodeHood[nodes[0]] });
  }
  function makePower(x, y, r) {
    const ctrls = []; for (let c = 0; c < C; c++) { const k = G.ctrls[c]; if ((k.x - x) ** 2 + (k.y - y) ** 2 < r * r) ctrls.push(c); }
    const n = nodesNear(x, y, 400, null, 1)[0];
    return newIncident('power', { ctrls, x, y, r, name: n >= 0 ? crossName(n) : 'the area', auto: simT + 100 * 60, hood: n >= 0 ? nodeHood[n] : 0 });
  }
  function crossingName(x, y) { let best = -1, bd = 700 * 700; for (let e = 0; e < E; e++) { if (eCls[e] < 2 || eCls[e] > 3 || eName[e] < 0) continue; const d = (emx[e] - x) ** 2 + (emy[e] - y) ** 2; if (d < bd) { bd = d; best = e; } } return best >= 0 ? G.names[eName[best]] : null; }
  function dirName(a) { const deg = (-a * 180 / Math.PI + 360) % 360; return deg < 45 || deg >= 315 ? 'eastbound' : deg < 135 ? 'northbound' : deg < 225 ? 'westbound' : 'southbound'; }
  function makeHwy(x, y, refEdge, bothWays, crash, o) {
    const blocks = []; const ra = refEdge >= 0 ? bOut[refEdge] : 0;
    for (let e = 0; e < E; e++) { if (eCls[e] !== 0) continue; const go = eGo[e], gc = eGc[e]; let bestD = 1e9, bestS = 0, acc = 0;
      for (let i = 0; i < gc - 1; i++) { const ax = geo[(go + i) * 2], ay = geo[(go + i) * 2 + 1], bx = geo[(go + i + 1) * 2], by = geo[(go + i + 1) * 2 + 1]; const vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy || 1; let t = ((x - ax) * vx + (y - ay) * vy) / l2; t = Math.max(0, Math.min(1, t)); const d = Math.hypot(x - ax - t * vx, y - ay - t * vy); const segL = Math.sqrt(l2); if (d < bestD) { bestD = d; bestS = acc + t * segL; } acc += segL; }
      if (bestD > 110) continue; if (!bothWays && Math.cos(bOut[e] - ra) < 0.3) continue;
      const s = eRev[e] ? eLen[e] - bestS : bestS; blocks.push({ e, s: Math.max(3, Math.min(eLen[e] - 3, s)) }); }
    if (!blocks.length) return null;
    const at = crossingName(x, y); const dn = bothWays ? 'both directions' : dirName(ra);
    const name = `Highway 401 ${dn}${at ? ' at ' + at : ''}`;
    return newIncident('hwy', Object.assign({ blocks, edge: blocks[0].e, s: blocks[0].s, x, y, name, crash: !!crash, fire: !!crash && rand() < 0.7, sev: 2, both: bothWays, hood: nodeHood[eA[blocks[0].e]], auto: crash ? simT + 80 * 60 : 0, dir: dn, at }, o || {}));
  }
  function makeHwyCrash() { const cands = []; for (let e = 0; e < E; e++) if (eCls[e] === 0 && eLen[e] > 200 && emx[e] > -6500 && emx[e] < 4000) cands.push(e); if (!cands.length) return null; const e = cands[(rand() * cands.length) | 0]; return makeHwy(emx[e], emy[e], e, false, true); }
  function makeRoadClosed(e, why) { const edges = [e]; if (revEdge[e] >= 0) edges.push(revEdge[e]); const [x, y] = posOnEdge(e, eLen[e] / 2, 0); return newIncident(why || 'roadclosed', { edge: e, edges, x, y, name: edgeName(e), hood: edgeHood[e], auto: why === 'barricade' ? simT + 30 * 60 : 0 }); }

  // special vehicles (police / tow / hydro / water / ems) — move along their own route, not in lane lists
  const specials = [];
  function nearestNode(x, y, pred) { let best = -1, bd = 1e18; for (let i = 0; i < N; i++) { if (pred && !pred(i)) continue; const d = (NX[i] - x) ** 2 + (NY[i] - y) ** 2; if (d < bd) { bd = d; best = i; } } return best; }
  function allocSpecial(targets) { const d = specialFree.pop(); if (d === undefined) return -1; const T = D[d]; T.targets = Int32Array.from(targets); T.active = true; isT[d].fill(0); for (const t of targets) isT[d][t] = 1; buildTree(d, costLive, nextLive, distLive); return d; }
  function freeSpecial(d) { if (d < 0) return; D[d].active = false; specialFree.push(d); }
  function startSpecial(kind, from, toX, toY, onArrive, extra) {
    const hwyOK = extra && extra.hwy;
    const dn = from.node !== undefined ? from.node : nearestNode(from.x, from.y, i => OUT.start[i + 1] > OUT.start[i] && (hwyOK || notHwy(i)));
    let tn = extra && extra.targets ? extra.targets.slice() : nodesNear(toX, toY, 160, notHwy, 6); if (!tn.length) tn.push(nearestNode(toX, toY));
    const d = allocSpecial(tn); if (d < 0) return null;
    let o = nextLive[d * N + dn], dn2 = dn;
    if (o < 0) { const fx = from.node !== undefined ? NX[from.node] : from.x, fy = from.node !== undefined ? NY[from.node] : from.y; for (const n2 of nodesNear(fx, fy, 600, null, 16)) { const o2 = nextLive[d * N + n2]; if (o2 >= 0) { o = o2; dn2 = n2; break; } } }
    if (o < 0) { freeSpecial(d); return null; }
    const sp = Object.assign({ id: unitSeq++, kind, d, e: o, s: 0, v: 0, x: NX[dn2], y: NY[dn2], ang: 0, onArrive, state: 'enroute', t0: simT }, extra || {});
    specials.push(sp); return sp;
  }
  const EMERG = { police: 1, opp: 1, fire: 1, ems: 1 };
  function markYield(sp) {
    const e = sp.e, L = eLen[e], until = simT + 2.5;
    const mark = (edge, s0, s1) => { for (let l = 0; l < eLanes[edge]; l++) for (let c = laneHead[laneOf(edge, l)]; c >= 0; c = cBehind[c]) { const s = cS[c]; if (s < s0) break; if (s <= s1) cYield[c] = until; } };
    mark(e, sp.s + 2, sp.s + 150);
    const r = revEdge[e]; if (r >= 0) mark(r, L - sp.s - 90, L - sp.s + 60);
    if (L - sp.s < 150 && sp.d >= 0) { const n = nextLive[sp.d * N + eB[e]]; if (n >= 0) mark(n, 0, 150 - (L - sp.s)); }
  }
  function stepSpecials() {
    for (let i = specials.length - 1; i >= 0; i--) {
      const sp = specials[i];
      if (sp.state !== 'enroute') continue;
      const e = sp.e; const L = eLen[e];
      // speed through congestion: lights + others pulling over, still slowed by gridlock
      const cnt = lastCnt[e] / 4, mv = cnt > 0 ? lastSumV[e] / lastCnt[e] : eVmax[e];
      const jam = Math.min(1, cnt * 7 / (L * eLanes[e] + 1));
      const lights = !sp.quiet && EMERG[sp.kind];
      let v0 = eVmax[e] * (lights ? 1.25 : 1.0);
      if (lights) { v0 *= jam > 0.85 ? Math.max(0.18, (mv / eVmax[e]) * 0.6 + 0.2) : 1 - jam * 0.3; markYield(sp); }
      else v0 *= jam > 0.6 ? Math.max(0.12, (mv / eVmax[e]) * 0.7 + 0.12) : 1 - jam * 0.35;
      if (L - sp.s < 30 && eCtrl[e] >= 0) v0 = Math.min(v0, lights ? 9 : 6);
      sp.v += Math.max(-4 * DT, Math.min(2.2 * DT, v0 - sp.v)); sp.s += sp.v * DT;
      while (sp.s >= eLen[sp.e]) {
        const b = eB[sp.e]; sp.s -= eLen[sp.e];
        if (isT[sp.d][b]) { sp.state = 'arrived'; sp.s = eLen[sp.e]; freeSpecial(sp.d); sp.d = -1; sp.arriveT = simT; sp.onArrive && sp.onArrive(sp); break; }
        let n = nextLive[sp.d * N + b]; if (n < 0 || blocked(n)) { let best = -1, bv = Infinity; for (let k = OUT.start[b]; k < OUT.start[b + 1]; k++) { const o = OUT.list[k]; if (edgeClosed[o]) continue; const v = costLive[o] + distLive[sp.d * N + eB[o]]; if (v < bv) { bv = v; best = o; } } n = best; }
        if (n < 0) { sp.state = 'arrived'; freeSpecial(sp.d); sp.d = -1; sp.onArrive && sp.onArrive(sp); break; }
        sp.e = n;
      }
      const [x, y, a] = posOnEdge(sp.e, Math.min(sp.s, eLen[sp.e]), revEdge[sp.e] >= 0 ? (sp.quiet ? laneLat(sp.e, eLanes[sp.e] - 1) : 0.6) : 0); sp.x = x; sp.y = y; sp.ang = a;
    }
  }
  // ---------------- automatic responders (police, OPP, fire, EMS) — not from the player's pool
  function nearestDepot(kind, x, y) { const deps = G.depots.filter(d => d.k === kind); let dep = deps[0], bd = 1e18; for (const d of deps) { const dd = (d.x - x) ** 2 + (d.y - y) ** 2; if (dd < bd) { bd = dd; dep = d; } } return dep; }
  function parkSpot(inc, k) {
    if (inc.blocks && inc.blocks.length) { const b = inc.blocks[k % inc.blocks.length]; const s = Math.max(4, b.s - 14 - Math.floor(k / inc.blocks.length) * 11); const [x, y, a] = posOnEdge(b.e, s, laneLat(b.e, Math.min(eLanes[b.e] - 1, k % eLanes[b.e]))); return [x, y, a + (rand() - 0.5) * 0.5]; }
    if (inc.edge !== undefined && inc.s !== undefined) { const s = Math.max(4, inc.s - 12 - k * 10); const [x, y, a] = posOnEdge(inc.edge, s, laneLat(inc.edge, Math.min(eLanes[inc.edge] - 1, k % 2))); return [x, y, a + (rand() - 0.5) * 0.4]; }
    if (inc.nodes) { const S = new Set(inc.nodes); const appr = []; for (const n of inc.nodes) for (let q = IN.start[n]; q < IN.start[n + 1]; q++) { const e = IN.list[q]; if (!S.has(eA[e])) appr.push(e); } if (appr.length) { const e = appr[k % appr.length]; const [x, y, a] = posOnEdge(e, Math.max(2, eLen[e] - 16), 0); return [x, y, a + Math.PI / 2]; } }
    const t = k * 2.1; return [inc.x + Math.cos(t) * 14, inc.y + Math.sin(t) * 14, t];
  }
  function respond(inc) {
    if (inc.plan) { inc.resp = []; inc.plan.forEach((p, k) => { const dep = p.from || nearestDepot(p.kind, inc.x, inc.y); if (!dep) return; inc.resp.push({ kind: p.kind, dep, targets: inc.nodes ? inc.nodes.slice() : null, at: simT + k * (6 + rand() * 14) + (p.kind === 'ems' ? 30 : 0), k, started: false, quiet: !p.code3 }); }); return; }
    const plan = [];
    const hw = inc.type === 'hwy';
    if (inc.type === 'collision') { plan.push(eCls[inc.edge] <= 1 ? 'opp' : 'police'); if (inc.fire || inc.sev >= 1) plan.push('fire'); if (inc.sev >= 1 || rand() < 0.5) plan.push('ems'); }
    else if (hw) { plan.push('opp', 'opp', 'opp'); if (inc.crash) plan.push('fire', 'fire', 'ems'); }
    else if (inc.type === 'closure') plan.push('police', 'police', 'police');
    else if (inc.type === 'water' || inc.type === 'flood' || inc.type === 'barricade' || inc.type === 'power') plan.push('police');
    inc.resp = [];
    plan.forEach((kind, k) => {
      const depKind = kind === 'opp' ? 'opp' : kind; const dep = nearestDepot(depKind, inc.x, inc.y); if (!dep) return;
      const targets = hw ? inc.blocks.map(b => eA[b.e]) : null;
      const delay = k * (8 + rand() * 20) + (kind === 'fire' ? 25 : kind === 'ems' ? 40 : 0);
      inc.resp.push({ kind, dep, targets, at: simT + delay, k, started: false });
    });
  }
  function stepResponders() {
    for (const inc of incidents) {
      if (!inc.resp) continue;
      for (const r of inc.resp) {
        if (r.started || simT < r.at || inc.state === 'cleared') continue; r.started = true;
        const sp = startSpecial(r.kind, r.dep, inc.x, inc.y, (u) => {
          if (inc.state === 'cleared') { goHome(u); return; }
          const [x, y, a] = parkSpot(inc, r.k); u.x = x; u.y = y; u.ang = a; u.state = 'onscene'; u.onT = simT;
          ev({ k: 'respOnScene', kind: r.kind, unit: u.id, id: inc.id, mins: Math.round((simT - u.t0) / 6) / 10, inc: pubInc(inc) });
        }, { inc: inc.id, responder: true, hwy: r.kind === 'opp', targets: r.targets || undefined, quiet: r.quiet || undefined });
        if (sp) ev({ k: 'respDispatched', kind: r.kind, unit: sp.id, id: inc.id, inc: pubInc(inc), first: r.k === 0 });
      }
    }
  }
  function goHome(u) {
    u.state = 'done'; const dep = nearestDepot(u.kind === 'opp' ? 'opp' : u.kind, u.x, u.y); if (!dep) return;
    const n = nearestNode(u.x, u.y, i => OUT.start[i + 1] > OUT.start[i]);
    const back = startSpecial(u.kind, { node: n }, dep.x, dep.y, (b) => { b.state = 'done'; }, { quiet: true, hwy: true });
    if (back) back.x = u.x, back.y = u.y;
  }
  function stepOnScene() {
    for (const u of specials) {
      if (u.state !== 'onscene') continue; const inc = incidents.find(x => x.id === u.inc);
      if (!inc || inc.state === 'cleared') { goHome(u); continue; }
      if (u.kind === 'fire' && inc.fire && simT - u.onT > 150) { inc.fire = false; ev({ k: 'fireOut', id: inc.id, inc: pubInc(inc) }); }
      if (u.kind === 'ems' && simT - u.onT > 300 && !u.transport) { u.transport = true; u.state = 'done'; const hosp = G.places.filter(p => p.t === 'hospital'); let h = hosp[0], bd = 1e18; for (const p of hosp) { const d = (p.x - u.x) ** 2 + (p.y - u.y) ** 2; if (d < bd) { bd = d; h = p; } }
        const n = nearestNode(u.x, u.y, i => OUT.start[i + 1] > OUT.start[i]); const t = startSpecial('ems', { node: n }, h.x, h.y, (b) => { b.state = 'done'; ev({ k: 'emsHospital', hosp: h.s, mins: Math.round((simT - b.t0) / 6) / 10 }); }, { hwy: true }); if (t) { t.x = u.x; t.y = u.y; ev({ k: 'transport', id: inc.id, hosp: h.n, unit: t.id, inc: pubInc(inc) }); } }
    }
  }
  function dispatch(incId, kind) {
    const inc = incidents.find(i => i.id === incId); if (!inc || inc.state === 'cleared') return { ok: false, msg: 'Already cleared' };
    const need = inc.type === 'hwy' && !inc.crash ? null : CREW_FOR[inc.type]; kind = kind || need; if (!kind) return { ok: false, msg: 'No crew can fix this. Manage the traffic around it.' };
    if (kind !== need) return { ok: false, msg: 'Wrong crew for this job' };
    if (inc.unit) return { ok: false, msg: 'A crew is already assigned' };
    if (pool[kind] <= 0) return { ok: false, msg: `No ${kind === 'tow' ? 'tow trucks' : kind === 'hydro' ? 'Hydro crews' : 'Water crews'} free` };
    const deps = G.depots.filter(d => d.k === kind); let dep = deps[0], bd = 1e18; for (const d of deps) { const dd = (d.x - inc.x) ** 2 + (d.y - inc.y) ** 2; if (dd < bd) { bd = dd; dep = d; } }
    const sp = startSpecial(kind, dep, inc.x, inc.y, (u) => { if (inc.state === 'cleared') { u.state = 'returning'; pool[kind]++; return; } inc.state = 'working'; inc.workUntil = simT + WORK[inc.type] * (inc.type === 'collision' && inc.sev === 2 ? 1.4 : 1); u.state = 'working'; const ps = parkSpot(inc, 5); u.x = ps[0]; u.y = ps[1]; u.ang = ps[2]; ev({ k: 'arrived', id: inc.id, unit: u.id, kind, mins: Math.round((simT - u.t0) / 60), inc: pubInc(inc) }); }, { inc: inc.id, hwy: inc.type === 'hwy', targets: inc.type === 'hwy' ? inc.blocks.map(b => eA[b.e]) : undefined });
    if (!sp) return { ok: false, msg: 'Crew cannot reach that spot' };
    pool[kind]--; inc.unit = sp.id; inc.state = 'enroute'; inc.crew = kind; ev({ k: 'dispatched', id: inc.id, unit: sp.id, kind, inc: pubInc(inc) });
    return { ok: true };
  }
  function sendPolice(ctl) {
    if (ctrlPolice[ctl]) return { ok: false, msg: 'An officer is already there' };
    if (pool.police <= 0) return { ok: false, msg: 'All officers are busy' };
    const k = G.ctrls[ctl]; const deps = G.depots.filter(d => d.k === 'police'); let dep = deps[0], bd = 1e18; for (const d of deps) { const dd = (d.x - k.x) ** 2 + (d.y - k.y) ** 2; if (dd < bd) { bd = dd; dep = d; } }
    const sp = startSpecial('police', dep, k.x, k.y, (u) => { ctrlPolice[ctl] = 1; ctrlPhase[ctl] = 0; ctrlPhaseT[ctl] = 0; u.state = 'working'; u.x = k.x; u.y = k.y; u.until = simT + 40 * 60; u.ctrl = ctl; ev({ k: 'policeOn', ctrl: ctl, name: ctrlName(ctl), unit: u.id, mins: Math.round((simT - u.t0) / 60) }); }, { ctrl: ctl });
    if (!sp) return { ok: false, msg: 'Officer cannot reach that spot' };
    pool.police--; ev({ k: 'policeSent', ctrl: ctl, name: ctrlName(ctl), unit: sp.id }); return { ok: true };
  }
  function recallPolice(ctl) { const u = specials.find(s => s.kind === 'police' && s.ctrl === ctl && s.state === 'working'); if (u) { u.until = simT; } }
  function stepUnits() {
    for (let i = specials.length - 1; i >= 0; i--) {
      const u = specials[i];
      if (u.state === 'working' && u.kind === 'police' && simT >= u.until) { ctrlPolice[u.ctrl] = 0; pool.police++; u.state = 'done'; ev({ k: 'policeOff', ctrl: u.ctrl, name: ctrlName(u.ctrl) }); }
      if (u.state === 'working' && u.inc && !u.responder) { const inc = incidents.find(x => x.id === u.inc); if (!inc || inc.state === 'cleared') { u.state = 'done'; pool[u.kind]++; } else if (simT >= inc.workUntil) { clearIncident(inc, 'crew'); u.state = 'done'; pool[u.kind]++; } }
      if (u.state === 'arrived' && u.kind === 'ems') { u.state = 'done'; }
      if (u.state === 'done' || u.state === 'returning') specials.splice(i, 1);
    }
    for (let i = specials.length - 1; i >= 0; i--) { const u = specials[i]; if (u.responder && u.state === 'arrived') u.state = 'done'; if (u.state === 'done') specials.splice(i, 1);
    }
    for (const inc of incidents) if (inc.state !== 'cleared' && inc.auto && simT >= inc.auto && inc.state !== 'working') clearIncident(inc, 'timeout');
    const act = incidents.filter(i => i.state !== 'cleared'); for (const i of act) { stats.incImpact += i.queue || 0; i.impact = (i.impact || 0) + (i.queue || 0); i.queue = 0; }
    if (act.length) { stuckNow = 0; for (let c = 0; c < CAP; c++) { if (!alive[c] || cV[c] > 1) continue; if (cStuck[c] > 120) stuckNow++; const e = cEdge[c]; for (const i of act) { const r = i.type === 'power' ? i.r + 300 : 650; if ((emx[e] - i.x) ** 2 + (emy[e] - i.y) ** 2 < r * r) i.queue++; } } }
    else { stuckNow = 0; for (let c = 0; c < CAP; c++) if (alive[c] && cV[c] < 1 && cStuck[c] > 120) stuckNow++; }
  }
  // EMS calls
  let nextEms = simT + 300;
  function emsCall() {
    const hood = pickHood(), HR = hoodRes[hood]; if (!HR.e.length) return; const e0 = HR.e[(rand() * HR.e.length) | 0]; const [x, y] = posOnEdge(e0, eLen[e0] / 2, 0);
    const deps = G.depots.filter(d => d.k === 'ems'); let dep = deps[0], bd = 1e18; for (const d of deps) { const dd = (d.x - x) ** 2 + (d.y - y) ** 2; if (dd < bd) { bd = dd; dep = d; } }
    const fromN = nearestNode(dep.x, dep.y, notHwy), toN = nearestNode(x, y, notHwy);
    const sp = startSpecial('ems', dep, x, y, (u) => { const mins = (simT - u.t0) / 60; stats.emsResp.push({ mins, free: u.free / 60 }); ev({ k: 'emsArrived', mins: Math.round(mins * 10) / 10, free: Math.round(u.free / 6) / 10, x, y, hood: G.hoods[hood].n }); });
    if (sp) { let free = 0; { const d0 = allocSpecial([toN]); if (d0 >= 0) { buildTree(d0, costHab, nextHab, distHab); free = distHab[d0 * N + fromN]; freeSpecial(d0); } } sp.free = free < 1e8 ? free : 300; stats.emsCalls++; ev({ k: 'ems', x, y, hood: G.hoods[hood].n, unit: sp.id }); }
  }

  // ---------------------------------------------------------------- neighbourhood anger
  const hoodBase = Float32Array.from(G.calib || new Array(H).fill(5)), hoodCool = new Float32Array(H), hoodCut = new Float32Array(H), hoodAnger = new Float32Array(H), hoodFlag = new Uint8Array(H), hoodCutEdge = new Float32Array(E);
  function stepHoods(dts) {
    hoodCut.fill(0);
    for (let c = 0; c < CAP; c++) { if (!alive[c]) continue; const e = cEdge[c]; if (eCls[e] !== CLS_RES) continue; const h = edgeHood[e]; if (h === cOrigH[c] || h === cDestH[c]) continue; hoodCut[h]++; hoodCutEdge[e] += 1; }
    for (let h = 0; h < H; h++) {
      const base = hoodBase[h], thr = base * 1.5 + 6, scale = Math.max(8, base * 0.6);
      const ex = hoodCut[h] - thr;
      if (ex > 0) hoodAnger[h] = Math.min(100, hoodAnger[h] + Math.min(3, ex / scale) * 2.5 * dts / 60);
      else hoodAnger[h] = Math.max(0, hoodAnger[h] - 5 * dts / 60);
      const a = hoodAnger[h];
      if (a >= 35 && hoodFlag[h] < 1) { hoodFlag[h] = 1; complaint(h, 1); }
      if (a >= 65 && hoodFlag[h] < 2) { hoodFlag[h] = 2; complaint(h, 2); }
      if (a >= 100 && hoodFlag[h] < 3 && simT > hoodCool[h]) { hoodFlag[h] = 3; residentsBlock(h); }
      if (a < 20 && hoodFlag[h] > 0) hoodFlag[h] = 0;
    }
    for (let e = 0; e < E; e++) hoodCutEdge[e] *= 0.92;
  }
  function busiestRes(h) { let best = -1, bv = 0; for (let e = 0; e < E; e++) if (eCls[e] === CLS_RES && edgeHood[e] === h && hoodCutEdge[e] > bv && !edgeClosed[e]) { bv = hoodCutEdge[e]; best = e; } return best; }
  function complaint(h, lvl) { const e = busiestRes(h); stats.complaints++; ev({ k: 'complaint', hood: G.hoods[h].n, h, lvl, street: e >= 0 ? edgeName(e) : null, edge: e }); }
  function residentsBlock(h) { const e = busiestRes(h); hoodCool[h] = simT + 30 * 60; hoodAnger[h] = 60; hoodFlag[h] = 2; if (e < 0) return; stats.barricades++; makeRoadClosed(e, 'barricade'); ev({ k: 'barricade', hood: G.hoods[h].n, street: edgeName(e) }); }

  // ---------------------------------------------------------------- weather & scheduled incidents (shift)
  let schedule = [], nextAuto = simT + 120;
  function autoIncident() {
    const r = rand(); const busy = incidents.filter(i => i.state !== 'cleared').length; if (busy >= 4) return;
    if (r < 0.40) makeCollision(pickBusy(2, 4), rand() < 0.3 ? 2 : rand() < 0.5 ? 1 : 0);
    else if (r < 0.52) makeHwyCrash();
    else if (r < 0.64) makePower(...pickPowerSpot());
    else if (r < 0.74) makeWater(pickBusy(3, 4, true));
    else if (r < 0.86) makeClosure(pickBusyCtrl(), (40 + rand() * 40) * 60);
    else if (!weather.rain && !weather.live) startRain((25 + rand() * 20) * 60); else makeCollision(pickBusy(2, 3), 1); // real weather replaces made-up storms
  }
  function setupShift() {
    const m = t => 6 * 3600 + t * 60;
    schedule = [
      { at: m(14), f: () => makeCollision(pickBusy(2, 3), 0) },
      { at: m(32), f: () => makePower(...pickPowerSpot()) },
      { at: m(50), f: () => makeCollision(pickBusy(2, 2), 1) },
      { at: m(66), f: () => makeWater(pickBusy(3, 4, true)) },
      { at: m(84), f: () => startRain(40 * 60) },
      { at: m(95), f: () => makeHwyCrash() },
      { at: m(118), f: () => makeClosure(pickBusyCtrl(), 70 * 60) },
      { at: m(140), f: () => makeCollision(pickBusy(2, 3), 1) },
      { at: m(160), f: () => makePower(...pickPowerSpot()) },
      { at: m(178), f: () => makeCollision(pickBusy(2, 4), 0) },
    ];
  }
  function pickBusy(c0, c1, anyOK) { let best = -1, bv = -1; for (let k = 0; k < 400; k++) { const e = (rand() * E) | 0; if (eCls[e] < c0 || eCls[e] > c1 || edgeClosed[e] || eLen[e] < 80) continue; if (!anyOK && eLanes[e] < 2) continue; const v = trafficOn(e) + rand() * 2; if (v > bv) { bv = v; best = e; } } return best; }
  function pickBusyCtrl() { let best = 0, bv = -1; for (let k = 0; k < 120; k++) { const c = (rand() * C) | 0; if (G.ctrls[c].cls > 3) continue; let v = 0; for (const e of ctrlAppr[c]) v += trafficOn(e); v += rand() * 3; if (v > bv) { bv = v; best = c; } } return best; }
  function pickPowerSpot() { const c = pickBusyCtrl(); const k = G.ctrls[c]; return [k.x + (rand() - 0.5) * 300, k.y + (rand() - 0.5) * 300, 650 + rand() * 350]; }
  function startRain(dur) {
    weather.rain = 1; weather.until = simT + dur; ev({ k: 'rain', on: 1 });
    const unders = []; for (let e = 0; e < E; e++) if (eUnder[e] && revEdge[e] > e || (eUnder[e] && revEdge[e] < 0)) unders.push(e);
    for (let k = 0; k < 2 && unders.length; k++) { const e = unders.splice((rand() * unders.length) | 0, 1)[0]; const edges = [e]; if (revEdge[e] >= 0) edges.push(revEdge[e]); const [x, y] = posOnEdge(e, eLen[e] / 2, 0); newIncident('flood', { edge: e, edges, x, y, name: edgeName(e), auto: simT + dur + 12 * 60, hood: edgeHood[e] }); }
  }
  function stepWeather() { if (weather.rain && simT >= weather.until) { weather.rain = 0; ev({ k: 'rain', on: 0 }); }
    if (weather.rain && !weather.live && rand() < DT / 420) { const e = pickBusy(2, 4); if (e >= 0) makeCollision(e, 0); } }

/*__WORLD__ world.js world_roads.js world_trips.js world_rail.js */
  // ---------------------------------------------------------------- main loop
  let treeAcc = 0, secAcc = 0;
  function step() {
    tick++; simT += DT;
    stepCars(); laneChanges(); stepSpecials();
    // stats from this step's crossing observations
    for (let i = 0; i < exitObs.length; i += 2) { const e = exitObs[i], t = exitObs[i + 1]; ttEma[e] = ttEma[e] * 0.75 + t * 0.25; if (eCtrl[e] >= 0) { ctrlCnt[eCtrl[e]]++; ctrlTot[eCtrl[e]]++; } }
    exitObs.length = 0;
    for (let c = 0; c < C; c++) { if (ctrlPolice[c]) ctrlPoliceStep(c); if (ctrlDark[c]) { ctrlOldest[c] = ctrlOldestNext[c]; ctrlOldestNext[c] = 1e9; } }
    spawnTrips(DT);
    secAcc += DT;
    if (secAcc >= 1) {
      secAcc -= 1;
      for (let e = 0; e < E; e++) { if (lastCnt[e] === 0) ttEma[e] = ttEma[e] * 0.97 + ttFree[e] * 0.03; }
      // police queue measurement
      for (let c = 0; c < C; c++) if (ctrlPolice[c]) { let q0 = 0, q1 = 0; for (const e of ctrlAppr[c]) for (let l = 0; l < eLanes[e]; l++) for (let k = laneHead[laneOf(e, l)]; k >= 0 && eLen[e] - cS[k] < 80; k = cBehind[k]) if (cV[k] < 2) { if (eGrp[e]) q1++; else q0++; } ctrlQ[c * 2] = q0; ctrlQ[c * 2 + 1] = q1; }
      stepHoods(1); stepResponders(); stepOnScene(); stepUnits(); stepWeather(); stepWorld();
      flowT += 1; if (flowT >= 60) { flowT = 0; for (let c = 0; c < C; c++) { ctrlFlow[c] = ctrlFlow[c] ? ctrlFlow[c] * 0.6 + ctrlCnt[c] * 60 * 0.4 : ctrlCnt[c] * 60; ctrlCnt[c] = 0; } }
      if (mode === 'watch') {
        if (simT >= nextAuto && !live.kind) { autoIncident(); nextAuto = simT + 380 + rand() * 520; }
        if (simT >= nextEms) { emsCall(); nextEms = simT + (420 + rand() * 480); }
        for (const inc of incidents) if (inc.state === 'active' && !inc.unit && (CREW_FOR[inc.type] && !(inc.type === 'hwy' && !inc.crash)) && simT - inc.start > (inc.crewDelay || (inc.crewDelay = 200 + rand() * 300))) dispatch(inc.id);
        for (const inc of incidents) if (inc.type === 'hwy' && !inc.crash && !inc.real && inc.state !== 'cleared' && simT - inc.start > 40 * 60) clearIncident(inc, 'reopened');
      }
      if (mode === 'shift' && !opts.noIncidents) { while (schedule.length && simT >= schedule[0].at) schedule.shift().f(); if (simT >= nextEms) { emsCall(); nextEms = simT + (300 + rand() * 360); } }
      // impatient drivers switch to live routing
      for (let c = (tick * 7) % 50; c < CAP; c += 50) if (alive[c] && !cLive[c] && cStuck[c] > 60) cLive[c] = 1;
      // give up stuck or lost vehicles
      for (let c = (tick * 3) % 20; c < CAP; c += 20) if (alive[c] && (cLost[c] > 25 || cStuck[c] > 1500)) { stats.gaveUp++; if (cLost[c] > 25) stats.lost = (stats.lost || 0) + 1; else stats.stuckOut = (stats.stuckOut || 0) + 1; despawn(c, false); }
    }
    // reset per-step edge accumulators every 4 steps (keep last values for readers)
    if ((tick & 3) === 0) { lastCnt.set(edgeCnt); lastSumV.set(edgeSumV); edgeCnt.fill(0); edgeSumV.fill(0); }
  }
  function treesTick(n) { updateCosts(true); refreshSomeTrees(n); }

  // ---------------------------------------------------------------- outputs
  function writePositions(buf) { // [x, y, ang, flags] per car; returns count
    let k = 0;
    for (let c = 0; c < CAP; c++) {
      if (!alive[c]) continue; const e = cEdge[c];
      const [x, y, a] = posOnEdge(e, cS[c] - cLen[c] * 0.5, laneLat(e, cLat[c]) + cPull[c] * 2.3);
      buf[k++] = x; buf[k++] = y; buf[k++] = a; buf[k++] = cType[c] | (cBrake[c] << 3) | (cColor[c] << 4) | (cLen[c] > 6 ? 1 << 12 : 0);
    }
    for (const u of specials) { if (u.state === 'done') continue; buf[k++] = u.x; buf[k++] = u.y; buf[k++] = u.ang; const t = { police: T_POLICE, opp: T_POLICE, ems: T_EMS, tow: T_TOW, crew: T_TOW, hydro: T_HYDRO, water: T_WATER, fire: T_FIRE }[u.kind]; buf[k++] = t | (u.state === 'working' || u.state === 'onscene' ? 1 << 13 : 0) | (1 << 14) | ((u.id & 255) << 15) | (u.quiet ? 1 << 23 : 0) | (u.kind === 'opp' ? 1 << 4 : 0); }
    k = writeTrains(buf, k); k = writeRealBuses(buf, k);
    return k / 4;
  }
  function edgeSpeeds(out) { for (let e = 0; e < E; e++) { const n = lastCnt[e]; out[e] = n ? Math.min(255, Math.round(lastSumV[e] / n / eVmax[e] * 200)) : 255; } return out; }
  function signalStates(out) { for (let c = 0; c < C; c++) { if (ctrlDark[c] && !ctrlPolice[c]) { out[c] = 255; continue; } let g0, g1; if (ctrlPolice[c]) { g0 = policeColor(c, 0); g1 = policeColor(c, 1); } else { g0 = sigColor(c, 0, simT); g1 = sigColor(c, 1, simT); } out[c] = g0 | (g1 << 2) | (ctrlPolice[c] ? 16 : 0); } return out; }
  function summary() {
    let sumV = 0, n = 0, stopped = 0; for (let c = 0; c < CAP; c++) if (alive[c]) { sumV += cV[c]; n++; if (cV[c] < 0.5) stopped++; }
    const ems = stats.emsResp; const emsAvg = ems.length ? ems.reduce((a, b) => a + b.mins, 0) / ems.length : 0;
    return { incHours: stats.incImpact / 3600, t: simT, stuck: stuckNow, cars: nCars, avgKmh: n ? sumV / n * 3.6 : 0, stopped, trips: stats.trips, avgDelay: stats.trips ? stats.delaySum / stats.trips / 60 : 0, recentDelay: stats.recentDelay / 60, complaints: stats.complaints, barricades: stats.barricades, emsAvg, emsN: ems.length, rain: weather.rain, pool: Object.assign({}, pool), anger: Array.from(hoodAnger, v => Math.round(v)), cut: Array.from(hoodCut), gaveUp: stats.gaveUp };
  }

  // ---------------------------------------------------------------- commands
  const api = {
    N, E, C, D, G, eLen, eLanes, eCls, revEdge, laneBase,
    get t() { return simT; }, set t(v) { simT = v; }, get cars() { return nCars; }, stats, events, incidents, specials, weather, pool, hoodAnger, hoodCut,
    cutEdges(out) { for (let e = 0; e < E; e++) out[e] = eCls[e] === CLS_RES ? Math.min(255, Math.round(hoodCutEdge[e] * 3)) : 0; return out; },
    step, treesTick, writePositions, edgeSpeeds, signalStates, summary, posOnEdge, laneLat, nearestEdge,
    init() { updateCosts(false); for (let d = 0; d < ND; d++) { if (D[d].kind === 'special') continue; buildTree(d, costHab, nextHab, distHab); } updateCosts(true); for (let d = 0; d < ND; d++) if (D[d].kind !== 'special') buildTree(d, costLive, nextLive, distLive); if (mode === 'shift' && !opts.noIncidents) setupShift(); },
    setTargetCars(n) { targetCars = n; }, setTime(t) { simT = t; }, setMode(m, prof) { mode = m; if (prof) whatifProfile = prof; },
    dispatch, sendPolice, recallPolice,
    setSplit(ctl, split) { ctrlSplit[ctl] = Math.max(0.2, Math.min(0.8, split)); ev({ k: 'retimed', ctrl: ctl, name: ctrlName(ctl), split: ctrlSplit[ctl] }); return { ok: true }; },
    getSignal(ctl) { const appr = ctrlAppr[ctl]; const names = [new Set(), new Set()]; for (const e of appr) if (eName[e] >= 0) names[eGrp[e]].add(G.names[eName[e]]); let q = [0, 0]; for (const e of appr) for (let l = 0; l < eLanes[e]; l++) for (let k = laneHead[laneOf(e, l)]; k >= 0 && eLen[e] - cS[k] < 150; k = cBehind[k]) if (cV[k] < 2) q[eGrp[e]]++; return { ctrl: ctl, name: ctrlName(ctl), split: ctrlSplit[ctl], cycle: ctrlCycle[ctl], g0: [...names[0]].join(' / ') || 'Main road', g1: [...names[1]].join(' / ') || 'Cross street', q, police: ctrlPolice[ctl], dark: ctrlDark[ctl], flow: Math.round(ctrlFlow[ctl]), count: G.ctrls[ctl].count >= 0 ? G.counts[G.ctrls[ctl].count] : null }; },
    closeRoad(e) { const exh = incidents.find(i => i.type === 'hwy' && !i.crash && i.state !== 'cleared' && i.blocks.some(b => b.e === e)); if (exh) { clearIncident(exh, 'reopened'); return { ok: true, reopened: true }; }
      if (eCls[e] <= 1) { const i = makeHwy(emx[e], emy[e], e, true, false); return i ? { ok: true, inc: pubInc(i) } : { ok: false, msg: 'Could not close the highway here' }; }
      const ex = incidents.find(i => i.type === 'roadclosed' && i.state !== 'cleared' && i.edges.includes(e)); if (ex) { clearIncident(ex, 'reopened'); return { ok: true, reopened: true }; } makeRoadClosed(e); return { ok: true }; },
    causeHwyCrash() { return makeHwyCrash(); }, ctrlTotals(reset) { const o = Array.from(ctrlTot); if (reset) ctrlTot.fill(0); return o; }, units() { return specials.filter(u => u.state !== 'done').map(u => ({ id: u.id, kind: u.kind, state: u.state, x: u.x, y: u.y, ang: u.ang, inc: u.inc, ctrl: u.ctrl, quiet: !!u.quiet, responder: !!u.responder, v: u.v || 0 })); },
    setLocalOnly(x, y, r, on) { let n = 0; for (let e = 0; e < E; e++) { if (eCls[e] !== CLS_RES) continue; const i = ptAt(e, 0); if ((geo[i * 2] - x) ** 2 + (geo[i * 2 + 1] - y) ** 2 < r * r) { localOnly[e] = on ? 1 : 0; n++; } } ev({ k: 'localOnly', on, x, y, r, n }); return { ok: true, n }; },
    sign(x, y, r) { let n = 0; for (let c = 0; c < CAP; c++) { if (!alive[c] || cLive[c]) continue; const [px, py] = posOnEdge(cEdge[c], cS[c], 0); if ((px - x) ** 2 + (py - y) ** 2 < r * r) { cLive[c] = 1; n++; } } ev({ k: 'sign', x, y, r, n }); return { ok: true, n }; },
    causeCrash(e) { return makeCollision(e, eLanes[e] >= 3 ? 1 : 2); }, causeWater(e) { return makeWater(e); }, causeClosure(ctl) { return makeClosure(ctl, 60 * 60); },
    causePower(x, y) { return makePower(x, y, 750); }, toggleRain() { if (weather.rain) { weather.until = simT; return 0; } startRain(30 * 60); return 1; },
    jumpNext, liveFeed, liveInfo, pubWorld, pubWorldLive, pubZones, realBuses, get spillInfo() { return { spill, streets: SPILL.map(p => [p.name, edgeName(p.sbEdge), edgeName(p.nbEdge)]), hoodMul: Array.from(hoodMul), sched: live.sched.size }; }, setHoodMul, get worldDirty() { return live.dirty ? 2 : live.zonesDirty ? 1 : 0; },
    clearAll() { for (const i of incidents) clearIncident(i, 'reset'); },
    edgeName, ctrlName, hoodNames: G.hoods.map(h => h.n), pubInc,
    debug: { live, rail, ROUTES, cRoute, cWhy, cStuck, cType, eCtrl, eStop, cNext, alive, cEdge, cS, cV, cLane, laneHead, laneTail, cAhead, cBehind, nextLive, nextHab, distHab, distLive, costLive, isT, cDest, ttEma, edgeClosed, nodeClosed, ctrlDark, ctrlPolice, ND, laneBlock },
  };
  return api;
}

// ------------------------------------------------------------------ worker glue
if (typeof module !== 'undefined' && module.exports) module.exports = { createSim };
else root.createSim = createSim;

if (typeof WorkerGlobalScope !== 'undefined' && root instanceof WorkerGlobalScope) {
  let S = null, speed = 8, paused = true, last = 0, acc = 0, treeT = 0;
  let posBuf = new Float32Array(4 * 16000), spdBuf = null, sigBuf = null, lastSumT = 0;
  function loop() {
    const now = performance.now();
    if (S && !paused) {
      acc += Math.min(0.25, (now - last) / 1000) * speed;
      const t0 = performance.now(); let n = 0;
      while (acc >= 0.25 && performance.now() - t0 < 30) { S.step(); acc -= 0.25; n++; }
      if (acc > 2) acc = 2;
      treeT += now - last; if (treeT > 120) { treeT = 0; S.treesTick(3); }
      if (S.events.length) { postMessage({ type: 'events', events: S.events.splice(0) }); }
    }
    last = now;
    setTimeout(loop, 4);
  }
  root.onmessage = (m) => {
    const d = m.data;
    if (d.type === 'init') {
      const t0 = performance.now();
      S = createSim(d.graph, d.opts); S.init();
      if (d.opts.feed) { try { S.liveFeed(d.opts.feed, d.opts.world || {}); } catch (err) { postMessage({ type: 'events', events: [{ k: 'liveError', msg: String(err && err.message || err) }] }); } }
      // warm up: let traffic build before the player sees it
      const warm = d.opts.warm || 0; for (let i = 0; i < warm; i++) { S.step(); if (i % 40 === 0) S.treesTick(4); if (i % 400 === 0) postMessage({ type: 'progress', p: i / warm }); }
      S.events.length = 0;
      spdBuf = new Uint8Array(S.E); sigBuf = new Uint8Array(S.C);
      postMessage({ type: 'ready', ms: performance.now() - t0, t: S.t, summary: S.summary(), incidents: S.incidents.map(S.pubInc) });
      last = performance.now(); loop();
    } else if (d.type === 'frame') {
      if (!S) return;
      if (d.buf) posBuf = d.buf;
      const n = S.writePositions(posBuf);
      const msg = { type: 'frame', n, buf: posBuf, t: S.t, rain: S.weather.rain, snow: S.weather.snow || 0, fog: S.weather.fog || 0, storm: S.weather.live ? (S.weather.storm || 0) : (S.weather.rain || 0) };
      const tr = [posBuf.buffer];
      if (d.wantSlow) { msg.units = S.units(); msg.spd = S.edgeSpeeds(new Uint8Array(S.E)); msg.cut = S.cutEdges(new Uint8Array(S.E)); msg.sig = S.signalStates(new Uint8Array(S.C)); msg.summary = S.summary(); msg.incidents = S.incidents.filter(i => i.state !== 'cleared' || S.t - i.end < 20).map(S.pubInc); msg.world = S.pubWorldLive(); const wd = S.worldDirty; if (wd === 2) msg.worldStatic = S.pubWorld(); else if (wd === 1) msg.zones = S.pubZones(); tr.push(msg.spd.buffer, msg.sig.buffer, msg.cut.buffer); }
      postMessage(msg, tr);
    } else if (d.type === 'speed') { speed = d.v; paused = d.v === 0; last = performance.now(); }
    else if (d.type === 'cmd') {
      let r = null; try { r = S[d.fn](...(d.args || [])); if (r && r.id !== undefined && r.type) r = { ok: true, inc: S.pubInc(r) }; } catch (e) { r = { ok: false, msg: String(e && e.message || e) }; }
      if (typeof r === 'number' || r === undefined) r = { ok: true, v: r };
      postMessage({ type: 'reply', id: d.id, r });
      if (S.events.length) postMessage({ type: 'events', events: S.events.splice(0) });
    } else if (d.type === 'getSignal') { postMessage({ type: 'reply', id: d.id, r: S.getSignal(d.ctrl) }); }
  };
}
})(typeof self !== 'undefined' ? self : globalThis);
