// Headless check of the player-sent officers: node tests/officer_test.js
const loadSim = require('./load_sim.js'); const { createSim } = loadSim(); const G = loadSim.graph();
const CAP = 9000;
const mk = () => { const S = createSim(G, { seed: 5, cap: CAP, targetCars: 5000, mode: 'whatif', startT: 8 * 3600, noIncidents: true }); S.init(); S.setTargetCars(5000); for (let i = 0; i < 4 * 420; i++) S.step(); S.events.length = 0; return S; };
function busyEdge(S) { const d = S.debug, cnt = new Map(); for (let c = 0; c < CAP; c++) if (d.alive[c]) cnt.set(d.cEdge[c], (cnt.get(d.cEdge[c]) || 0) + 1); let best = -1, bv = 0; for (const [e, n] of cnt) if (G.cls[e] > 1 && G.cls[e] <= 3 && n > bv) { bv = n; best = e; } return best; }
const probe = mk(), EDGE = busyEdge(probe), UP = []; { const d = probe.debug; /* the busy edge, plus the edges feeding it */ UP.push(EDGE); for (let e = 0; e < G.ea.length; e++) if (G.eb[e] === G.ea[EDGE]) UP.push(e); }
for (const mode of ['speedtrap', 'checkpoint']) {
  const S = mk(), d = S.debug, x = (G.nx[G.ea[EDGE]] + G.nx[G.eb[EDGE]]) / 2, y = (G.ny[G.ea[EDGE]] + G.ny[G.eb[EDGE]]) / 2; const evs = [];
  if (mode) { const r = S.sendOfficer(EDGE, x, y, mode); if (!r.ok) console.log('send failed', r); }
  let slow = 0, n = 0, maxQ = 0, held = 0;
  for (let i = 0; i < 4 * 60 * 24; i++) { S.step(); if (S.events.length) evs.push(...S.events.splice(0));
    if (i % 4 === 0 && i > 4 * 60 * 5) { let q = 0; for (let c = 0; c < CAP; c++) if (d.alive[c] && UP.includes(d.cEdge[c])) { n++; slow += d.cV[c] < 0.5 ? 1 : 0; q += d.cV[c] < 0.5 ? 1 : 0; } maxQ = Math.max(maxQ, q); } }
  console.log(`\n${mode || 'no officer'}: share of cars stopped on the road + feeders ${(100 * slow / Math.max(1, n)).toFixed(1)}%  peak stopped at once ${maxQ}`);
  for (const e of evs.filter(e => /^officer/.test(e.k) && e.k !== 'officerTicket')) console.log('  ', JSON.stringify(e));
  const tk = evs.filter(e => e.k === 'officerTicket'); if (tk.length) console.log('   tickets', tk.length, 'first:', JSON.stringify(tk[0]));
}
