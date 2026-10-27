// Normal-Tuesday delay curve for the shift report → data/baseline.json. Run from the game folder: node tools/baseline.js
// "Normal" = the city-life layer from the weekly feed (school runs, towers, TTC buses, GO trains) but no roadwork, calls or weather.
const fs = require('fs'); const load = require('../tests/load_sim.js'); const { createSim } = load(); const G = load.graph();
const FEED = 'https://raw.githubusercontent.com/jasonalves-debug/gridlock/data/gridlock_static.json';
(async () => {
  const stat = await (await fetch(FEED)).json(); const acc = {};
  for (const seed of [3, 5]) {
    const S = createSim(G, { seed, cap: 14000, targetCars: 8000, mode: 'shift', noIncidents: true, startT: 5.75 * 3600 }); S.init();
    S.liveFeed({ static: stat, live: null }, { kind: null, typical: true, buses: true });
    for (let i = 0; i < 3600; i++) { S.step(); if (i % 40 === 0) S.treesTick(4); } S.events.length = 0;
    for (let i = 0; i < 3.5 * 3600 * 4; i++) { S.step(); if (i % 12 === 0) S.treesTick(3); S.events.length = 0;
      if (i % 1200 === 0) { const s = S.summary(), k = Math.round((s.t - 21600) / 300); acc[k] = acc[k] || { d: 0, v: 0, st: 0, n: 0 }; acc[k].d += s.recentDelay; acc[k].v += s.avgKmh; acc[k].st += s.stuck; acc[k].n++; } }
  }
  const out = Object.keys(acc).sort((a, b) => a - b).map(k => [+(acc[k].d / acc[k].n).toFixed(2), +(acc[k].v / acc[k].n).toFixed(1), Math.round(acc[k].st / acc[k].n)]);
  console.log(JSON.stringify(out)); fs.writeFileSync('data/baseline.json', JSON.stringify(out));
})();
