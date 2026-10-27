// Fits trip demand to the City's turning-movement counts → data/demand_w.json. Run from the game folder: node tools/calib_demand.js [fresh]
const fs = require('fs'); const path = require('path');
const { createSim } = require('../tests/load_sim.js')();
const G = require('../tests/load_sim.js').graph();
const counts = G.counts; const H = G.hoods.length;
let W = { dest: {}, hood: new Array(H).fill(1) };
if (fs.existsSync('data/demand_w.json') && process.argv[2] !== 'fresh') W = JSON.parse(fs.readFileSync('data/demand_w.json', 'utf8'));
function run(seed) {
  G.demandW = W;
  const S = createSim(G, { seed, cap: 16000, targetCars: 8000, mode: 'shift', noIncidents: true, startT: 5.75 * 3600 }); S.init();
  let i = 0; for (; S.t < 7.75 * 3600; i++) { S.step(); if (i % 12 === 0) S.treesTick(3); S.events.length = 0; }
  S.ctrlTotals(true); for (; S.t < 8.75 * 3600; i++) { S.step(); if (i % 12 === 0) S.treesTick(3); S.events.length = 0; }
  return { sim: S.ctrlTotals(false), D: S.D };
}
function evalFit(sim) {
  const rows = []; G.ctrls.forEach((c, k) => { if (c.count < 0) return; const o = counts[c.count]; if (!o.am || o.date < '2015') return; rows.push({ k, real: o.am, sim: sim[k], x: c.x, y: c.y, node: c.nodes[0] }); });
  const scale = rows.reduce((a, r) => a + r.real, 0) / rows.reduce((a, r) => a + r.sim, 0);
  let g5 = 0, g10 = 0, sxy = 0, sxx = 0, syy = 0; const lx = rows.map(r => Math.log(r.real)), ly = rows.map(r => Math.log(Math.max(1, r.sim)));
  const mx = lx.reduce((a, b) => a + b) / lx.length, my = ly.reduce((a, b) => a + b) / ly.length;
  rows.forEach((r, i) => { const s = r.sim * scale; const geh = Math.sqrt(2 * (s - r.real) ** 2 / (s + r.real + 1)); if (geh < 5) g5++; if (geh < 10) g10++; sxy += (lx[i] - mx) * (ly[i] - my); sxx += (lx[i] - mx) ** 2; syy += (ly[i] - my) ** 2; r.ratio = r.real / Math.max(1, s); });
  return { rows, scale, g5: g5 / rows.length, g10: g10 / rows.length, r: sxy / Math.sqrt(sxx * syy) };
}
const iters = +(process.argv[3] || 3); let hist = [];
for (let it = 0; it <= iters; it++) {
  const { sim, D } = run(100 + it); const f = evalFit(sim);
  console.log(`iter ${it}: scale ${f.scale.toFixed(2)} r ${f.r.toFixed(3)} GEH<5 ${(f.g5 * 100).toFixed(0)}% GEH<10 ${(f.g10 * 100).toFixed(0)}%`);
  hist.push({ it, r: f.r, g5: f.g5, g10: f.g10, W: JSON.parse(JSON.stringify(W)) });
  if (it === iters) break;
  const gm = arr => arr.length ? Math.exp(arr.reduce((a, b) => a + Math.log(b), 0) / arr.length) : 1;
  for (const d of D) { if (d.kind !== 'portal' && d.kind !== 'place') continue; const R = d.kind === 'portal' ? 1800 : 1300; const near = f.rows.filter(r => (r.x - d.x) ** 2 + (r.y - d.y) ** 2 < R * R).map(r => Math.max(0.1, Math.min(10, r.ratio)));
    if (near.length < 2) continue; const fct = Math.max(0.55, Math.min(1.8, Math.pow(gm(near), 0.6))); const key = d.kind + ':' + d.name; W.dest[key] = Math.max(0.15, Math.min(8, (W.dest[key] || 1) * fct)); }
  for (let h = 0; h < H; h++) { const near = f.rows.filter(r => G.hood[r.node] === h).map(r => Math.max(0.1, Math.min(10, r.ratio))); if (near.length < 2) continue; const fct = Math.max(0.6, Math.min(1.6, Math.pow(gm(near), 0.5))); W.hood[h] = Math.max(0.3, Math.min(4, W.hood[h] * fct)); }
}
const best = hist.reduce((a, b) => (b.g10 + b.r > a.g10 + a.r ? b : a));
console.log('best iteration', best.it, 'r', best.r.toFixed(3), 'GEH<10', (best.g10 * 100).toFixed(0) + '%');
fs.writeFileSync('data/demand_w.json', JSON.stringify(best.W));
