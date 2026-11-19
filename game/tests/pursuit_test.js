// Headless pursuit runs: node tests/pursuit_test.js [runs]
const loadSim = require('./load_sim.js'); const { createSim } = loadSim(); const G = loadSim.graph();
const CAP = 9000, RUNS = +process.argv[2] || 6;
const outcomes = {};
for (let run = 0; run < RUNS; run++) {
  const S = createSim(G, { seed: 11 + run, cap: CAP, targetCars: 5000, mode: 'whatif', startT: (8 + run) * 3600, noIncidents: true }); S.init(); S.setTargetCars(5000);
  for (let i = 0; i < 4 * 400; i++) { S.step(); if (i % 40 === 0) S.treesTick(4); } S.events.length = 0;
  const d = S.debug; let c0 = -1; for (let k = 0; k < 4000; k++) { const c = (k * 7919 + run * 131) % CAP; if (d.alive[c] && G.cls[d.cEdge[c]] >= 2 && G.cls[d.cEdge[c]] <= 3 && d.cV[c] > 5) { c0 = c; break; } }
  const [x, y] = S.posOnEdge(d.cEdge[c0], d.cS[c0] - 2.3, S.laneLat(d.cEdge[c0], d.cLane[c0]));
  const r = S.startPursuit(x, y, 20); if (!r.ok) { console.log('start failed', r); continue; }
  const evs = []; let end = null, maxAff = 0, gaps = [], t0 = Date.now(), errs = 0;
  for (let i = 0; i < 4 * 60 * 12 && !end; i++) { try { S.step(); } catch (err) { console.log('STEP ERROR', err.stack); errs++; break; } if (i % 40 === 0) S.treesTick(4);
    for (const e of S.events.splice(0)) { if (/^pursuit/.test(e.k)) evs.push(e); if (e.k === 'pursuitEnd') end = e; }
    if (i % 4 === 0) { const p = S.pursuit(); if (p) { maxAff = Math.max(maxAff, p.aff || 0); if (p.state === 'flee' && p.gap) gaps.push(p.gap); } } }
  // let the scene play out and make sure it cleans up
  for (let i = 0; i < 4 * 300; i++) { S.step(); for (const e of S.events.splice(0)) if (/^pursuit/.test(e.k)) evs.push(e); }
  const cleared = evs.some(e => e.k === 'pursuitClear');
  console.log(`\nrun ${run}: ${r.desc}  ${(Date.now() - t0) / 1000}s wall`);
  for (const e of evs) if (e.k === 'pursuitMsg' || e.k === 'pursuitStart' || e.k === 'pursuitCrash') console.log(`  ${((e.t - evs[0].t) / 60).toFixed(1).padStart(4)}m ${e.k === 'pursuitMsg' ? '[' + e.kind + '] ' + e.txt : e.k + ' ' + (e.name || '') + (e.hurt != null ? ' hurt ' + e.hurt : '')}`);
  if (end) { console.log(`  END ${end.how} after ${end.mins.toFixed(1)} min, ${end.km.toFixed(2)} km, top ${end.top} km/h, foot ${end.foot}`, JSON.stringify(end.st)); outcomes[end.how] = (outcomes[end.how] || 0) + 1; } else console.log('  no end');
  gaps.sort((a, b) => a - b); console.log(`  lead gap median ${gaps[gaps.length >> 1]} m, p90 ${gaps[Math.floor(gaps.length * 0.9)]} m`); console.log(`  peak drivers affected ${maxAff}, cleaned up ${cleared}, pool police ${S.pool.police}, specials left ${S.specials.filter(u => u.chaseU && u.state !== 'done').length}`);
}
console.log('\noutcomes', outcomes);
