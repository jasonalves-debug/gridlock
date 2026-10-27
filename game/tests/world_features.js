// Feature checks for the world modules: worship on a Sunday, gates under trains, a subway shuttle, holidays, detours.
const loadSim = require('./load_sim.js'); const { createSim } = loadSim(); const G = loadSim.graph();
const fs = require('fs'), dir = process.argv[2];
const st = JSON.parse(fs.readFileSync(dir + '/gridlock_static.json')), lv = JSON.parse(fs.readFileSync(dir + '/gridlock_live.json'));
const now = Date.now() / 1000, mid = Math.floor((now - 4 * 3600) / 86400) * 86400 + 4 * 3600;
function run(label, epoch0, hour, secs, extra) {
  const S = createSim(G, { seed: 4, cap: 14000, targetCars: 8000, mode: 'watch', startT: hour * 3600 }); S.init();
  const live = Object.assign({}, lv, extra || {}); S.liveFeed({ static: st, live }, { kind: null, epoch0, weather: true });
  let gatesDown = 0, gateFlips = 0, prev = new Set(), maxVisit = 0, worshipOn = 0, guards = 0;
  for (let i = 0; i < secs * 4; i++) { S.step(); if (i % 40 === 0) S.treesTick(4);
    if (i % 20 === 0) { const w = S.pubWorldLive(); const g = new Set(w.gates); gatesDown = Math.max(gatesDown, g.size); for (const x of g) if (!prev.has(x)) gateFlips++; prev = g; worshipOn = Math.max(worshipOn, w.worship.length); guards = Math.max(guards, w.schools.filter(s => s[2]).length);
      const d = S.debug; let v = 0; for (let c = 0; c < 14000; c++) if (d.alive[c] && d.cRoute[c] && d.ROUTES[d.cRoute[c] - 1] && d.ROUTES[d.cRoute[c] - 1].kind === 'visit') v++; maxVisit = Math.max(maxVisit, v); } }
  const info = S.liveInfo(), sm = S.summary();
  console.log(label, JSON.stringify(info.day), 'visit cars max', maxVisit, 'worship active max', worshipOn, 'gates max down', gatesDown, 'gate drops', gateFlips, 'guards crossing max', guards, 'shuttles', info.shuttles, 'trains', info.trains, 'cars', sm.cars, 'kmh', sm.avgKmh.toFixed(1));
  return S;
}
run('SUNDAY 9:40', mid + 5 * 86400, 9.66, 1800);
run('FRIDAY 13:00', mid + 3 * 86400, 13.0, 1500);
run('CHRISTMAS 8:30', Math.floor((Date.UTC(2026, 11, 25, 5)) / 1000), 8.5, 600);
const alert = { id: 'test', effect: 'NO_SERVICE', header: 'Line 2: No subway service between Kennedy and Victoria Park stations', routes: [], lines: ['2'], periods: [],
  shuttle: { from: Object.values(st.subway).find(s => s[0] === 'Kennedy'), to: Object.values(st.subway).find(s => s[0] === 'Victoria Park') } };
const S = run('SHUTTLE TEST 11:00', mid, 11, 900, { ttc_alerts: [alert] });
const w = S.pubWorld(); console.log('shuttle pts', w.shuttles.map(s => [s.name, s.pts.length])); console.log('detours', w.detours);
