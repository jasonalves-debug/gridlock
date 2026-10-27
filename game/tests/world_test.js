// Headless check of the world modules against real feed files.
//   node tests/world_test.js <dir-with-gridlock_live/static.json> [hour] [typical]
const loadSim = require('./load_sim.js'); const { createSim } = loadSim(); const G = loadSim.graph();
const fs = require('fs'), dir = process.argv[2], hour = +(process.argv[3] || 8), typical = process.argv[4] === 'typical';
const st = JSON.parse(fs.readFileSync(dir + '/gridlock_static.json')), lv = JSON.parse(fs.readFileSync(dir + '/gridlock_live.json'));
const now = Date.now() / 1000, mid = Math.floor((now - 4 * 3600) / 86400) * 86400 + 4 * 3600; // Toronto midnight (EDT)
const S = createSim(G, { seed: 9, cap: 14000, targetCars: 8000, mode: typical ? 'shift' : 'watch', startT: hour * 3600 }); S.init();
let t0 = Date.now(); const info = S.liveFeed({ static: st, live: lv }, { kind: null, epoch0: mid, typical, weather: true }); console.log('feed ms', Date.now() - t0); console.log(info);
const secs = +(process.argv[5] || 1800); t0 = Date.now();
for (let i = 0; i < secs * 4; i++) { S.step(); if (i % 40 === 0) S.treesTick(4); if (i % (4 * 600) === 0 && i) console.log('t', (S.t / 3600).toFixed(2), JSON.stringify(S.liveInfo()).slice(0, 300)); }
console.log('sim', secs, 's in', Date.now() - t0, 'ms');
const sm = S.summary(); console.log('cars', sm.cars, 'kmh', sm.avgKmh.toFixed(1), 'stuck', sm.stuck, 'delay', sm.recentDelay.toFixed(2));
const W = S.pubWorld(), WL = S.pubWorldLive(); console.log('pub', Object.fromEntries(Object.entries(W).map(([k, v]) => [k, Array.isArray(v) ? v.length : typeof v])), 'live', JSON.stringify(WL).slice(0, 300));
const kinds = {}; const d = S.debug; for (let c = 0; c < 14000; c++) if (d.alive[c] && d.cRoute[c]) { const r = d.ROUTES[d.cRoute[c] - 1]; kinds[r ? r.kind : '?'] = (kinds[r ? r.kind : '?'] || 0) + 1; } console.log('scripted on road', kinds);
