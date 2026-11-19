// ---------------------------------------------------------------- player-sent officers: little scenes that play out where the officer is working
const PC = { list: [] };
const PC_WHY = ['outstanding warrant', 'driving while impaired', 'stolen plates', 'suspended licence', 'something in the trunk', 'fake insurance', 'stolen car', 'a very long list of unpaid tickets'];
const PC_ARR = 28;
function pcOn(e) {
  if (e.x == null) return;
  const g = brkGeo({ edge: e.edge, s: e.s, x: e.x, y: e.y }), now = performance.now();
  const sc = { unit: e.unit, mode: e.mode, name: e.name, g, t0: now, cyc: null, next: now + (e.mode === 'checkpoint' ? 9000 : e.mode === 'pullover' ? 6000 : 1e12), arrests: 0, quiet: e.quiet };
  PC.list.push(sc);
  if (e.mode === 'pullover' && !e.quiet) pcPlan(sc, Math.random() < 0.4 ? 'arrest' : 'talk');
}
function pcPlan(sc, kind) {
  const now = performance.now(); sc.cyc = { k: kind, t0: now, why: PC_WHY[Math.floor(Math.random() * PC_WHY.length)] };
  if (kind === 'arrest') { sc.arrests++; cmd('addProps', brkProps('arrest', sc.g), PC_ARR + 4); setTimeout(() => toast('ARREST', `${sc.name}: driver taken in. ${sc.cyc ? sc.cyc.why : ''}`, 'var(--red, #ff5a5a)'), 6500); if (typeof snd === 'function') snd('radio'); }
}
function pcOff(e) {
  const i = PC.list.findIndex(s => s.unit === e.unit); if (i < 0) return; const sc = PC.list[i]; PC.list.splice(i, 1);
  if (sc.arrests) toast('POLICE', `${sc.arrests} arrest${sc.arrests === 1 ? '' : 's'} at the ${sc.mode === 'checkpoint' ? 'checkpoint' : 'stop'} on ${sc.name}.`, 'var(--cyan)');
}
function pcTick() {
  const now = performance.now();
  for (const sc of PC.list) {
    if (sc.cyc && now - sc.cyc.t0 > (sc.cyc.k === 'arrest' ? PC_ARR : 20) * 1000) { sc.cyc = null; if (sc.mode === 'checkpoint') sc.next = now + 12000 + Math.random() * 20000; }
    if (!sc.cyc && sc.mode === 'checkpoint' && now > sc.next) pcPlan(sc, Math.random() < 0.55 ? 'arrest' : 'talk');
  }
}
setInterval(pcTick, 500);
function pcTalk(sc, T) { // officer and driver chatting at the kerb
  const g = sc.g, A = (d, l) => [g.x + g.tx * d + g.nx * l, g.y + g.ty * d + g.ny * l], o = A(-3, g.hr + 0.9), p = A(-1.4, g.hr + 0.9), f = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]);
  return [{ kind: 24, x: o[0], y: o[1], h: f(o, p), px: 22 }, { kind: T < 13 ? 29 : 25, x: p[0], y: p[1], h: f(p, o) + 0.12 * Math.sin(T * 2), px: 20 }];
}
function pcDetour(sc, T) { // tape across the road, an officer at it, neighbours come out to look
  const g = sc.g, A = (d, l) => [g.x + g.tx * d + g.nx * l, g.y + g.ty * d + g.ny * l], H = Math.atan2(g.ty, g.tx), mid = (g.hr - g.hl) / 2, half = (g.hr + g.hl) / 2 + 1, out = [], f = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]);
  const p = A(-3, mid); out.push({ kind: -6, x: p[0], y: p[1], h: H + Math.PI / 2, s: half, px: 8 });
  const o = A(-5.5, mid + 1.5); out.push({ kind: 24, x: o[0], y: o[1], h: f(o, p) + 0.2 * Math.sin(T * 0.8), px: 22 });
  [[-8, 4.4], [-10.5, 5.1], [-6.5, -(g.hl + 4)], [-12, -(g.hl + 4.8)]].forEach(([d, l], k) => { const q = A(d, l < 0 ? l : g.hr + l - 3.4); out.push({ kind: 29, x: q[0], y: q[1], h: f(q, p) + 0.15 * Math.sin(T * 1.2 + k * 2), a: Math.min(1, Math.max(0, (T - 3 - k * 2) / 1.5)), px: 20 }); });
  return out;
}
function pcSprites(put) {
  const now = performance.now();
  for (const sc of PC.list) {
    let list = [];
    if (sc.cyc) { const T = (now - sc.cyc.t0) / 1000; list = sc.cyc.k === 'arrest' ? brkArrest(sc, T) : pcTalk(sc, T); }
    else if (sc.mode === 'detour') list = pcDetour(sc, (now - sc.t0) / 1000);
    for (const f of list) { if (f.kind === -6) put(f.x, f.y, 0.3, f.s, 6, 1, f.px, -f.h); else put(f.x, f.y, 0.15, 0.85, f.kind, f.a == null ? 1 : f.a, f.px || 20, -f.h); }
  }
}
