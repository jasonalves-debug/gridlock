// Cut-through traffic per neighbourhood on a normal morning → data/calib.json. Run from the game folder: node tools/calib.js
const fs = require('fs'); const { createSim } = require('../tests/load_sim.js')();
const G = require('../tests/load_sim.js').graph();
const S = createSim(G, { seed: 11, cap: 14000, targetCars: 7000, mode: 'whatif' }); S.init();
const H = G.hoods.length, acc = new Float64Array(H); let n = 0;
for (let i = 0; i < 80 * 240; i++) { S.step(); if (i % 12 === 0) S.treesTick(3); S.events.length = 0; if (i > 30 * 240 && i % 240 === 0) { for (let h = 0; h < H; h++) acc[h] += S.hoodCut[h]; n++; } }
const out = G.hoods.map((h, i) => ({ n: h.n, cut: +(acc[i] / n).toFixed(1) }));
console.log(JSON.stringify(out)); console.log(S.summary().gaveUp, S.stats.trips);
fs.writeFileSync('data/calib.json', JSON.stringify(out.map(o => o.cut)));
