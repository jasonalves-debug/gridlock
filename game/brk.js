// ================================================================ BREAKING NEWS (TV mode)
// A fresh real fire, arrest or serious police call interrupts the rundown: stinger, "we're going live to…", a camera cut to the scene, and a small
// staged diorama there: parked emergency vehicles (the sim keeps them for the length of the report), officers, firefighters, flames and smoke.
// Only calls that arrive while the page is open qualify; anything already under way when it opened is not "breaking".
const BRK = { cur: null, q: [], seen: new Set(), emb: [], ot: 0 }, BRK_DUR = 28;
const brkE = x => x * x * (3 - 2 * x), brkC = (x, a, b) => Math.min(1, Math.max(0, (x - a) / (b - a))), brkMix = (p, q, f) => [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f];

// the anchor names the street: "Police have made an arrest, | on Kingston Road, | near Galloway Road." from the call's location text
// ("Kingston Rd & Galloway Rd", "Midland Ave - Eglinton Ave E"), matched to the street names that have anchor clips (voice pack 6)
const BRK_AB = { ave: 'avenue', av: 'avenue', rd: 'road', st: 'street', dr: 'drive', blvd: 'boulevard', cres: 'crescent', crt: 'court', ct: 'court', pkwy: 'parkway', trl: 'trail', sq: 'square', pl: 'place', gt: 'gate', ln: 'lane', cir: 'circle', circ: 'circuit', ter: 'terrace', terr: 'terrace', hwy: 'highway', e: 'east', w: 'west', n: 'north', s: 'south', mt: 'mount' };
let BRK_NM = null;
const brkNorm = t => String(t).toLowerCase().replace(/[.'’]/g, '').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).map(w => BRK_AB[w] || w).filter((w, k, a) => !(k === 0 && /^\d+[a-z]?$/.test(w) && a.length > 1)).join(' ');
function brkStreet(part) {
  if (!BRK_NM) { BRK_NM = new Map(); for (const n of G.names) if (DIR.has('ao:' + n)) { const k = brkNorm(n); BRK_NM.set(k, n); const k2 = k.replace(/ (east|west|north|south)$/, ''); if (!BRK_NM.has(k2)) BRK_NM.set(k2, n); } }
  const k = brkNorm(part); return BRK_NM.get(k) || BRK_NM.get(k.replace(/ (east|west|north|south)$/, '')) || null;
}
function brkVO(b, i) {
  if (!b) return b; const lead = { fire: 'a:lf', arrest: 'a:la', scene: 'a:lp' }[b.k]; if (!DIR.has(lead)) return b;
  const loc = String((i.real && i.real.loc) || i.name || ''), found = [];
  for (const part of loc.split(/\s+(?:&|-|\/|and|at)\s+/i)) { const n = brkStreet(part); if (n && !found.includes(n)) found.push(n); }
  if (!found.length && i.edge != null && i.edge >= 0 && G.name[i.edge] >= 0) { const n = G.names[G.name[i.edge]]; if (DIR.has('an:' + n)) found.push(n); }
  if (!found.length) return b;
  const where = found.length > 1 ? ['ao:' + found[0], 'an:' + found[1]] : ['an:' + found[0]];
  return Object.assign({}, b, { a: ['a:open', lead, ...where, 'a:golive', ...(b.a.includes('a:avoid') ? ['a:avoid'] : [])] });
}
function brkClass(i) { return brkVO(brkClass0(i), i); }
function brkClass0(i) { // → null when it isn't breaking
  if (!i || i.type !== 'call' || i.synth) return null;
  const L = String(i.label || (i.real && i.real.label) || '').toLowerCase(), code = String((i.real && i.real.code) || '').toUpperCase();
  if (i.src === 'tfs') return i.act === 'fire_struct' ? { k: 'fire', tag: 'FIRE CREWS ON SCENE', a: ['a:open', 'a:brkfire', 'a:golive', 'a:avoid'] } : null;
  if (i.src !== 'tps') return null;
  if (code === 'ARR' || /\barrest/.test(L)) return { k: 'arrest', tag: 'POLICE MAKE AN ARREST', a: ['a:open', 'a:brkarrest', 'a:golive'] };
  if (i.act === 'police_crit' || /shoot|shots|gun|stab|homicide|hostage|firearm|weapon/.test(L)) return { k: 'scene', tag: 'POLICE INVESTIGATE', a: ['a:open', 'a:brkpolice', 'a:golive', 'a:avoid'] };
  if (/robbery|abduct/.test(L) || (/assault/.test(L) && /priority|progress|just/.test(L))) return { k: 'scene', tag: 'POLICE RESPOND', a: ['a:open', 'a:brkpolice', 'a:golive'] };
  return null;
}
function brkTrigger(i, b, title, sub) { if (BRK.seen.has(i.id)) return; BRK.seen.add(i.id); BRK.q.push({ i, b, title, sub, at: performance.now() }); }

function brkGeo(i) { // scene centre, road direction, its right-hand normal, and how far the right / left kerbs are from the centreline
  let tx = 1, ty = 0, hr = 7, hl = 7; try { if (i.edge != null && i.edge >= 0) { const e = i.edge, nl = G.lanes[e]; if (i.s != null) { const p = pts(e), a = posAlong(p, Math.max(0, i.s - 4)), b = posAlong(p, i.s + 4); const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy); if (l > 0.1) { tx = dx / l; ty = dy / l; } }
    let tw = -1; for (let q = 0; q < G.ea.length; q++) if (G.ea[q] === G.eb[e] && G.eb[q] === G.ea[e]) { tw = q; break; } // a two-way street has its centreline in the middle; a one-way edge is centred on its own lanes
    hr = tw >= 0 ? nl * 3.4 : nl * 1.7; hl = tw >= 0 ? G.lanes[tw] * 3.4 : nl * 1.7; } } catch (e) {}
  return { x: i.x, y: i.y, tx, ty, nx: -ty, ny: tx, hr, hl };
}
function brkProps(k, g) { // parked emergency vehicles for the scene
  const A = (d, l) => [g.x + g.tx * d + g.nx * l, g.y + g.ty * d + g.ny * l], H = Math.atan2(g.ty, g.tx), out = [], cr = g.hr - 1.9, cl = -(g.hl - 1.9);
  const add = (kind, d, l, turn) => { const [x, y] = A(d, l); out.push({ kind, x, y, ang: H + (turn || 0) }); };
  if (k === 'arrest') { add('police', -11, cr, 0); add('police', -19, cr - 0.2, 0.16); }
  else if (k === 'scene') { add('police', -15, cr, 0.6); add('police', -15, cl, -0.6 + Math.PI); add('police', 15, cr, Math.PI - 0.5); add('ems', 7, cr, 0.1); add('police', 24, cl, Math.PI); }
  else { add('fire', -7, cr, 0); add('fire', -19, cr - 0.3, 0.08); add('fire', 9, cl, Math.PI); add('ems', -31, cr, 0); add('police', -37, cr, 0.1); }
  return out;
}

function brkStart(it) {
  const { i, b } = it, g = brkGeo(i), fire = b.k === 'fire', loc = String(i.name || (i.real && i.real.loc) || it.title || '').toUpperCase();
  const fo = { arrest: [-5, g.hr * 0.5], scene: [0, (g.hr - g.hl) / 2], fire: [-2, g.hr + 4] }[b.k], fx = g.x + g.tx * fo[0] + g.nx * fo[1], fy = g.y + g.ty * fo[0] + g.ny * fo[1]; // aim between the vehicles and the action
  const base = { type: 'orbit', x: fx, y: fy, title: it.title, sub: it.sub, kick: 'BREAKING NEWS', loc, tag: b.tag }, h0 = { arrest: 62, scene: 80, fire: 120 }[b.k], h1 = { arrest: 36, scene: 45, fire: 85 }[b.k];
  const shot = Object.assign({}, base, { move: 'push', h: h0, pitch: fire ? 0.85 : 0.92, dur: 13, spin: 0.05, sting: true, brk: true, anchor: b.a, anchorKey: 'brk' + i.id, pri: 9,
    then: Object.assign({}, base, { kick: 'LIVE', move: 'crane', h: h1, pitch: 0.85, dur: 14, spin: -0.07 }) });
  if (!DIR.cut(shot)) return false;
  if (typeof selection !== 'undefined' && selection) closeSheet();
  BRK.cur = { k: b.k, g, t0: performance.now(), end: performance.now() + BRK_DUR * 1000, it }; BRK.emb.length = 0;
  cmd('addProps', brkProps(b.k, g), BRK.propSecs || BRK_DUR + 4);
  brkAudio(b.k); return true;
}
function brkTick() {
  const now = performance.now(), el = $('brkfx');
  if (BRK.cur && now > BRK.cur.end) BRK.cur = null;
  if (!BRK.cur && BRK.q.length && TV.on) { BRK.q = BRK.q.filter(q => now - q.at < 300000); const it = BRK.q[0]; if (it && brkStart(it)) BRK.q.shift(); }
  if (!TV.on && BRK.cur) BRK.cur = null;
  if (el) { el.classList.toggle('hold', !!BRK.cur); if (!BRK.cur && !el.classList.contains('on')) el.hidden = true; }
}
setInterval(brkTick, 500);
function brkOverlay(s) { // the stinger: flash, red band slams in, "we're going live to …", then settles into a frame around the picture
  const el = $('brkfx'); if (!el) return; $('brkLoc').textContent = s.loc || s.title || ''; $('brkTag').textContent = s.tag || s.sub || '';
  el.hidden = false; el.classList.remove('on'); void el.offsetWidth; el.classList.add('on'); clearTimeout(BRK.ot); BRK.ot = setTimeout(() => { el.classList.remove('on'); if (!BRK.cur) el.hidden = true; }, 4300);
}

// ---------------------------------------------------------------- the staged scenes
function brkArrest(c, T) {
  const g = c.g, A = (d, l) => [g.x + g.tx * d + g.nx * l, g.y + g.ty * d + g.ny * l], out = [], sway = (k, a) => a * Math.sin(T * 1.6 + k * 2.1), kb = g.hr + 2.2;
  const d1 = A(-11, g.hr - 3.9), d2 = A(-18, g.hr - 4), S0 = A(4, kb), t1 = A(0.2, g.hr + 0.7), t2 = A(7, g.hr + 0.5), face = (p, q) => Math.atan2(q[1] - p[1], q[0] - p[0]);
  let o1 = brkMix(d1, t1, brkE(brkC(T, 0.5, 6))), o2 = brkMix(d2, t2, brkE(brkC(T, 1.6, 7.6))), s = S0, sa = 1, sk = T < 6.4 ? 25 : 27, sh = face(S0, o1);
  let h1 = face(d1, t1), h2 = face(d2, t2);
  if (T >= 5) sh = face(S0, o1) + Math.PI * brkE(brkC(T, 5, 7)); // he turns round to be cuffed
  if (T >= 7 && T < 10.5) { o1 = [o1[0] + sway(0, 0.16), o1[1] + sway(1, 0.16)]; h1 = face(o1, S0); h2 = face(o2, S0); }
  if (T >= 10.5) { // walked to the cruiser between the two officers
    const f = brkE(brkC(T, 10.5, 17)), to = A(-11.2, g.hr - 3.2); s = brkMix(S0, to, f); const dir = face(S0, to), px = -Math.sin(dir), py = Math.cos(dir);
    sh = dir; o1 = [s[0] + px * 1.1 - Math.cos(dir) * 0.2, s[1] + py * 1.1 - Math.sin(dir) * 0.2]; o2 = [s[0] - px * 1.1 - Math.cos(dir) * 0.2, s[1] - py * 1.1 - Math.sin(dir) * 0.2]; h1 = h2 = dir;
    if (T > 17) { sa = 1 - brkC(T, 17, 18.4); o2 = brkMix(o2, A(-15.5, g.hr - 4.6), brkE(brkC(T, 17.2, 20))); h2 = face(o2, d1); o1 = brkMix(o1, A(-9.2, g.hr - 4.2), brkE(brkC(T, 17.4, 20))); h1 = face(o1, d1) + 0.6; }
  }
  if (sa > 0.02) out.push({ kind: sk, x: s[0], y: s[1], h: sh + sway(3, 0.05), a: sa, px: 22 });
  out.push({ kind: 24, x: o1[0], y: o1[1], h: h1, px: 22 }, { kind: 24, x: o2[0], y: o2[1], h: h2, px: 22 });
  [[-5, 3.6], [-1, 4.6], [10, 3.9], [14, 4.8]].forEach(([d, l], k) => { const p = A(d, g.hr + l); out.push({ kind: 29, x: p[0], y: p[1], h: face(p, [g.x, g.y]) + sway(k, 0.12), px: 20 }); }); // neighbours watching
  return out;
}
function brkScene(c, T) { // cordon, officers working the scene, paramedics, evidence markers
  const g = c.g, A = (d, l) => [g.x + g.tx * d + g.nx * l, g.y + g.ty * d + g.ny * l], out = [], H = Math.atan2(g.ty, g.tx), face = (p, q) => Math.atan2(q[1] - p[1], q[0] - p[0]), sway = (k, a) => a * Math.sin(T * 1.4 + k * 2.3), mid = (g.hr - g.hl) / 2, half = (g.hr + g.hl) / 2 + 1;
  for (const d of [-27, 30]) { const p = A(d, mid); out.push({ kind: -6, x: p[0], y: p[1], h: H + Math.PI / 2, s: half, px: 8 }); } // tape across the road both ends
  const cen = A(0, mid);
  [[-9, g.hr - 4], [-12, mid - 3], [11, g.hr - 3.6]].forEach(([d, l], k) => { const p = A(d, l); out.push({ kind: 24, x: p[0], y: p[1], h: face(p, cen) + sway(k, 0.15), px: 22 }); });
  { const f = brkE(brkC(T, 0.5, 5.5)), a = brkMix(A(7, g.hr - 3.6), A(1.2, mid + 0.9), f), b = brkMix(A(8.5, g.hr - 3.6), A(1.2, mid - 1.7), f); out.push({ kind: 28, x: a[0], y: a[1], h: face(a, cen), px: 22 }, { kind: 28, x: b[0], y: b[1], h: face(b, cen), px: 22 }); } // paramedics go in
  { const w = Math.sin(T * 0.35), p = A(-23 + w * 2.5, mid + w * 3); out.push({ kind: 24, x: p[0], y: p[1], h: H + Math.PI / 2 * (Math.cos(T * 0.35) > 0 ? 1 : -1), px: 22 }); } // an officer pacing the tape
  { const p = A(-4 + Math.sin(T * 0.5) * 2, mid - 5); out.push({ kind: 24, x: p[0], y: p[1], h: face(p, cen) + 0.4, px: 22 }); }
  [[-2, -1.5], [1.8, -2.6], [3.2, 0.4]].forEach(([d, l]) => { const p = A(d, mid + l); out.push({ kind: -20, x: p[0], y: p[1], s: 0.34, px: 3 }); }); // evidence markers
  [[-6, 3.6], [-2, 4.5], [3, 3.9], [8, 4.8], [12, 3.7]].forEach(([d, l], k) => { const p = A(d, g.hr + l); out.push({ kind: 29, x: p[0], y: p[1], h: face(p, cen) + sway(k, 0.12), px: 20 }); });
  return out;
}
function brkFireFigs(c, T) {
  const g = c.g, A = (d, l) => [g.x + g.tx * d + g.nx * l, g.y + g.ty * d + g.ny * l], out = [], face = (p, q) => Math.atan2(q[1] - p[1], q[0] - p[0]), sway = (k, a) => a * Math.sin(T * 1.5 + k * 2.2), F = A(2, g.hr + 13), cr = g.hr - 3.8;
  const ff = [[A(-7, cr), A(-3, g.hr + 7.5)], [A(-8, cr), A(1.5, g.hr + 6.5)], [A(-19, cr), A(-4, g.hr + 5.8)], [A(9, -(g.hl - 3.8)), A(6, g.hr + 7)]];
  c.nozzle = [];
  ff.forEach(([a, b], k) => { const f = brkE(brkC(T, 0.6 + k * 0.5, 7 + k * 0.5)), p = brkMix(a, b, f); out.push({ kind: 26, x: p[0], y: p[1], h: face(p, F) + sway(k, f > 0.99 ? 0.06 : 0), px: 22 }); if (f > 0.99) c.nozzle.push(p); });
  [[A(-10, cr), 0], [A(-22, cr), 1]].forEach(([p, k]) => out.push({ kind: 26, x: p[0], y: p[1], h: face(p, F) + sway(k + 5, 0.2), px: 22 })); // pump operators
  { const f = brkE(brkC(T, 0.8, 6)), a = brkMix(A(-30, cr), A(-14, g.hr + 2.5), f); out.push({ kind: 28, x: a[0], y: a[1], h: face(a, F), px: 22 }); }
  [[-34, cr], [-27, g.hr + 1.5]].forEach(([d, l], k) => { const p = A(d, l); out.push({ kind: 24, x: p[0], y: p[1], h: face(p, F) + sway(k, 0.2), px: 22 }); });
  [[-6, 3.5], [-2, 4.4], [3, 3.8], [8, 4.6], [12, 3.5]].forEach(([d, l], k) => { const p = A(d, -(g.hl + l)); out.push({ kind: 29, x: p[0], y: p[1], h: face(p, F) + sway(k, 0.12), px: 20 }); });
  return out;
}
function brkSpritesA(put) {
  const c = BRK.cur; if (!c) return; const T = BRK.T != null ? BRK.T : (performance.now() - c.t0) / 1000; if (T > BRK_DUR) return;
  const list = c.k === 'arrest' ? brkArrest(c, T) : c.k === 'scene' ? brkScene(c, T) : brkFireFigs(c, T);
  for (const f of list) { if (f.kind === -6) put(f.x, f.y, 0.3, f.s, 6, 1, f.px, -f.h); else if (f.kind === -20) put(f.x, f.y, 0.3, f.s, 20, 1, f.px, 0); else put(f.x, f.y, 0.15, 0.85, f.kind, f.a == null ? 1 : f.a, (f.px || 20) * (c.k === 'fire' ? 0.55 : 1), -f.h); }
}
function brkSpritesB(put, dt) {
  const c = BRK.cur; if (!c) { BRK.emb.length = 0; return; } const T = BRK.T != null ? BRK.T : (performance.now() - c.t0) / 1000, t = performance.now() / 1000; if (T > BRK_DUR) return; const g = c.g, A = (d, l) => [g.x + g.tx * d + g.nx * l, g.y + g.ty * d + g.ny * l];
  if (c.k !== 'fire') { // strobe wash on the road from the cruisers
    for (const [d, l] of c.k === 'arrest' ? [[-11, g.hr - 1.9], [-19, g.hr - 2]] : [[-15, g.hr - 1.9], [-15, -(g.hl - 1.9)], [15, g.hr - 1.9], [24, -(g.hl - 1.9)]]) { const p = A(d, l); put(p[0], p[1], 0.9, 11, 3, 0.1 * brkC(T, 0, 1.5), 12, 0); } return; }
  const F = A(2, g.hr + 13), grow = 0.35 + 0.65 * brkE(brkC(T, 0, 7)), calm = T > 20 ? 1 - 0.3 * brkC(T, 20, 28) : 1, amp = grow * calm, WX = 2.4, WY = -0.9;
  for (let k = 0; k < 8; k++) { const a = k * 2.4 + 0.6, r = (k % 4) * 2.4 + 1.2, x = F[0] + Math.cos(a) * r, y = F[1] + Math.sin(a) * r * 0.8, fl = 0.75 + 0.25 * Math.sin(t * (6 + k) + k); put(x, y, 3.5 + (k % 3) * 1.3, (3.5 + (k % 5) * 1.5) * amp * fl, 0, 0.75, 9, 0); }
  put(F[0], F[1], 5, 28 * amp, 2, 0.3 + 0.1 * Math.sin(t * 9), 24, 0); put(F[0], F[1], 1, 64 * amp, 2, 0.07 + 0.03 * Math.sin(t * 5), 36, 0);
  const lit = A(-8, g.hr - 3); put(lit[0], lit[1], 1, 16, 3, 0.2 * brkC(T, 0, 2), 14, 0);
  if (Math.random() < dt * 34 * amp && smoke.length < 640) smoke.push({ x: F[0] + (Math.random() - 0.5) * 7, y: F[1] + (Math.random() - 0.5) * 7, z: 6, s: 7, a: 0, life: 13 + Math.random() * 9, vx: WX + Math.random(), vy: WY + Math.random() * 0.6, big: 1 });
  if (Math.random() < dt * 16 * amp) BRK.emb.push({ x: F[0] + (Math.random() - 0.5) * 8, y: F[1] + (Math.random() - 0.5) * 8, z: 5, vx: WX * 1.5 + (Math.random() - 0.5) * 3, vy: WY * 1.5 + (Math.random() - 0.5) * 3, vz: 5 + Math.random() * 6, a: 0, life: 2 + Math.random() * 2 });
  for (const e of BRK.emb) { e.a += dt; e.x += e.vx * dt; e.y += e.vy * dt; e.z += e.vz * dt; e.vz -= 1.5 * dt; put(e.x, e.y, e.z, 0.6, 2, Math.max(0, 1 - e.a / e.life) * 1.4, 3, 0); } BRK.emb = BRK.emb.filter(e => e.a < e.life);
  if (c.nozzle) for (const p of c.nozzle) if (Math.random() < dt * 30 && jets.length < 320) jets.push({ x: p[0], y: p[1], z: 2.2, tx: F[0] + (Math.random() - 0.5) * 9, ty: F[1] + (Math.random() - 0.5) * 9, f: 0 });
}

// ---------------------------------------------------------------- sound under the report (fire crackle, or a police siren wailing past)
let BRK_CRK = null; // 3 s of fire crackle: sparse sharp ticks and the odd louder snap, looped
function brkCrackle() { if (BRK_CRK) return BRK_CRK; const n = AC.sampleRate * 3, b = AC.createBuffer(2, n, AC.sampleRate);
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let k = 0; k < 140; k++) { const at = (Math.random() * (n - 2000)) | 0, big = Math.random() < 0.08, len = big ? 900 : 60 + Math.random() * 260, amp = big ? 0.9 : 0.15 + Math.random() * 0.45;
      for (let j = 0; j < len; j++) d[at + j] += (Math.random() * 2 - 1) * amp * Math.pow(1 - j / len, big ? 2 : 4); } }
  return BRK_CRK = b; }
function brkAudio(k) { // the sound of the scene under the anchor: arriving siren, engines idling, doors, radio; for a fire the roar, crackle, pump and hoses
  if (!AC || muted || !noiseB || !master) return; try {
    const t = AC.currentTime, dur = BRK_DUR - 2, bus = AC.createGain(); bus.gain.setValueAtTime(0.0001, t); bus.gain.exponentialRampToValueAtTime(1, t + 1.2); bus.gain.setValueAtTime(1, t + dur - 3); bus.gain.exponentialRampToValueAtTime(0.0001, t + dur); bus.connect(amb);
    const loop = (buf, f, type, q, lv, t0, t1) => { const s = AC.createBufferSource(); s.buffer = buf; s.loop = true; const fl = AC.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = AC.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(lv, t0 + 1.5); s.connect(fl); fl.connect(g); g.connect(bus); s.start(t0, Math.random()); s.stop(t1); return g; };
    const hum = (f, lv, t0) => { const o = AC.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160; const g = AC.createGain(); g.gain.value = lv; o.connect(lp); lp.connect(g); g.connect(bus); o.start(t0); o.stop(t + dur); };
    const door = at => { tone(at, 0.16, 85, 48, 'sine', 0.12, 0.002, bus); nz(at, 0.12, 600, 0.7, 'lowpass', 0.09, 0, bus); nz(at + 0.01, 0.05, 2600, 1.5, 'bandpass', 0.03, 0, bus); };
    const radio = (at, pair) => setTimeout(() => { if (BRK.cur && DIR.has(pair[0])) { DIR.say('chatter', [pair[0]], 0, ''); DIR.say('chatter', [pair[1]], 0, ''); } }, (at - t) * 1000);
    if (k === 'fire') {
      loop(noiseB, 380, 'bandpass', 0.5, 0.05, t, t + dur);                                                   // roar
      const cr = loop(brkCrackle(), 1800, 'highpass', 0.4, 0.22, t + 0.5, t + dur);                              // crackle
      const lfo = AC.createOscillator(), lg = AC.createGain(); lfo.frequency.value = 0.23; lg.gain.value = 0.08; lfo.connect(lg); lg.connect(cr.gain); lfo.start(t); lfo.stop(t + dur);
      hum(46, 0.05, t + 0.3); hum(92.5, 0.02, t + 0.3);                                                         // pumper engine
      for (const [a, l] of [[1.6, 0.55], [2.3, 1.0]]) for (const f of [185, 233, 277]) tone(t + a, l, f, f * 0.97, 'sawtooth', 0.016, 0.03, bus); // air horn
      sirenPass(t + 2.6, { dur: 7.5, peak: 0.035, near: 0.55, dest: bus });
      loop(noiseB, 3200, 'highpass', 0.3, 0.025, t + 7, t + dur);                                                // hose spray
      radio(t + 13, ['c:4a', 'c:4b']);
    } else {
      hum(34, 0.035, t); hum(41, 0.022, t + 0.4);                                                               // cruisers idling
      if (k === 'arrest') { door(t + 0.5); door(t + 1.6); sirenPass(t + 3.5, { dur: 6.5, peak: 0.022, near: 0.3, dest: bus }); radio(t + 12, ['c:2a', 'c:2b']); }
      else { sirenPass(t + 2.2, { dur: 7, peak: 0.034, near: 0.6, yelp: 1.1, dest: bus }); door(t + 8.6); sirenPass(t + 9, { dur: 9, peak: 0.012, near: 0, dest: bus }); radio(t + 13, ['c:6a', 'c:6b']); }
    }
  } catch (e) { console.warn('brkAudio', e); }
}

// test hook: stage a scene at the camera (kind: fire | arrest | scene)
function brkTest(k) {
  let best = -1, bd = 1e12; for (let e = 0; e < G.len.length; e++) { if (G.len[e] < 60 || G.cls[e] > 3) continue; const p = posAlong(pts(e), G.len[e] / 2), d = (p[0] - cam.x) ** 2 + (p[1] - cam.y) ** 2; if (d < bd) { bd = d; best = e; } }
  const s = G.len[best] / 2, p = posAlong(pts(best), s), ttl = { fire: 'FIRE · TEST AVE', arrest: 'ARREST · TEST AVE', scene: 'SHOOTING · TEST AVE' }[k];
  BRK.q.length = 0; BRK.cur = null; brkTrigger({ id: 'test' + Date.now(), edge: best, s, x: p[0], y: p[1], name: 'Test Ave & Sample Rd', type: 'call' }, { k, tag: { fire: 'FIRE CREWS ON SCENE', arrest: 'POLICE MAKE AN ARREST', scene: 'POLICE INVESTIGATE' }[k], a: null }, ttl, 'Test event');
}
