// ---------------------------------------------------------------- pursuit, page side: panel, follow cam, suspect tag, sparks and smoke, helicopter, siren, the arrest at the end
const CH = { p: null, end: null, follow: true, tool: null, log: [], scene: null, flash: [], sparks: [], sus: null, phoneT: 0, screechT: 0, endTimer: 0 };
(function chUI() {
  const st = document.createElement('style');
  st.textContent = `#chase { position: fixed; left: 12px; top: calc(env(safe-area-inset-top, 0px) + 100px); z-index: 7; width: min(470px, calc(100vw - 84px)); background: rgba(9, 12, 18, 0.92); border: 2px solid var(--red); border-radius: 14px; padding: 10px 12px 12px; color: #fff; font: 600 15px/1.35 system-ui, -apple-system, Segoe UI, sans-serif; box-shadow: 0 6px 24px rgba(0,0,0,.5); }
#chase[hidden] { display: none; } #chase.done { border-color: var(--cyan); }
#chase .chTop { display: flex; align-items: baseline; gap: 10px; font-size: 18px; } #chase .chTop b { letter-spacing: .04em; }
#chase .chDot { width: 12px; height: 12px; border-radius: 50%; align-self: center; flex: none; animation: chBlink .5s steps(1) infinite; } #chase.done .chDot { animation: none; background: var(--cyan); }
@keyframes chBlink { 0% { background: #ff2a2a; } 50% { background: #2a6bff; } }
#chKmh { margin-left: auto; font-size: 24px; font-weight: 800; color: var(--amber); } #chClock { color: #c9d3e0; }
#chWhere { margin-top: 4px; font-size: 16px; } #chWhere .warn { color: var(--red); font-weight: 800; }
#chStats { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 6px; font-size: 15px; color: #cfe3f5; } #chStats b { color: #fff; }
#chLog { margin-top: 6px; } #chLog div { font-size: 14px; color: #aab4c0; margin-top: 3px; } #chLog div:first-child { font-size: 15px; color: #fff; }
#chLog .tag { display: inline-block; min-width: 46px; font-weight: 800; font-size: 12px; margin-right: 6px; } #chLog .k911 { color: var(--amber); } #chLog .kradio { color: var(--cyan); } #chLog .kems { color: var(--red); }
#chase .chBtns { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
#chase .chBtns button { font: 700 15px system-ui, sans-serif; color: #fff; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.25); border-radius: 10px; padding: 9px 12px; cursor: pointer; }
#chase .chBtns button[aria-pressed="true"] { background: var(--cyan); color: #04121c; border-color: var(--cyan); } #chase .chBtns button:disabled { opacity: .4; } #chase .chBtns button.off { border-color: var(--red); }
#susTag { position: fixed; z-index: 6; transform: translate(-50%, -170%); background: var(--red); color: #fff; font: 800 14px system-ui, sans-serif; padding: 3px 8px; border-radius: 6px; pointer-events: none; white-space: nowrap; box-shadow: 0 2px 8px rgba(0,0,0,.5); }
#susTag[hidden] { display: none; } #susTag.done { background: var(--cyan); color: #04121c; }
@media (max-width: 520px) { #chLog div:nth-child(n+3) { display: none; } #chase { padding: 8px 10px 10px; } #chase .chBtns button { padding: 8px 10px; } }`;
  document.head.appendChild(st);
  const el = document.createElement('div'); el.id = 'chase'; el.hidden = true;
  el.innerHTML = '<div class="chTop"><span class="chDot"></span><b id="chTitle">PURSUIT</b><span id="chClock">0:00</span><span id="chKmh"></span></div><div id="chWhere"></div><div id="chStats"></div><div id="chLog"></div><div class="chBtns" id="chBtns"></div>';
  document.body.appendChild(el);
  const tag = document.createElement('div'); tag.id = 'susTag'; tag.hidden = true; document.body.appendChild(tag);
})();
const CH_END = { crash: ['CRASHED · IN CUSTODY', 'wrecked the car'], spikes: ['SPIKED · IN CUSTODY', 'ran over the spike strip'], pit: ['PIT · IN CUSTODY', 'was spun out by a PIT manoeuvre'], boxed: ['BOXED IN · IN CUSTODY', 'was boxed in by cruisers'], roadblock: ['ROADBLOCK · IN CUSTODY', 'slammed into the roadblock'], gaveup: ['GAVE UP · IN CUSTODY', 'pulled over and gave up'], escaped: ['GOT AWAY', 'got away'], calledoff: ['CALLED OFF', 'was let go when the chase was called off'] };
function chFmt(s) { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function chNear(x, y) { return Math.hypot(x - cam.x, y - cam.y) < cam.h * 1.6 + 250; }
function chLog(txt, kind) { CH.log.unshift({ txt, kind: kind || 'radio' }); if (CH.log.length > 8) CH.log.pop(); chHud(); }
function chEvent(e) {
  const now = performance.now();
  switch (e.k) {
    case 'pursuitStart': CH.log = []; CH.end = null; CH.scene = null; CH.follow = true; CH.tool = null; CH.p = { state: 'flee', t: 0, kmh: e.kmh, name: e.name, dir: '', desc: e.desc, st: { crashes: 0, hurt: 0, calls: 1, reds: 0, peak: 0 }, units: 1, aff: 0, spikesLeft: 3, blocksLeft: 2, mode: 'road', hp: 100, spikes: [], blocks: [] };
      clearTimeout(CH.endTimer); snd('radio'); chLog(`Unit lights up a ${e.desc} on ${e.name}. It's not stopping!`, 'radio'); toast('PURSUIT', `A ${e.desc} is running from police on ${e.name}.`, 'var(--red)');
      camGoal = { x: e.x, y: e.y, h: Math.min(cam.h, 520) }; break;
    case 'pursuitMsg': chLog(e.txt, e.kind); if (e.kind === '911' && now > CH.phoneT) { CH.phoneT = now + 7000; snd('phone'); } else if (e.kind === 'ems') snd('alert'); else if (e.kind === 'radio' && Math.random() < 0.5) snd('radio'); break;
    case 'pursuitCrash': snd('crash'); CH.flash.push({ x: e.x, y: e.y, t: now, big: 1 }); for (let i = 0; i < 40; i++) chSpark(e.x, e.y, 9); if (smoke.length < 380) for (let i = 0; i < 10; i++) smoke.push({ x: e.x + (Math.random() - .5) * 5, y: e.y + (Math.random() - .5) * 5, z: 1, vx: (Math.random() - .5) * 2, vy: (Math.random() - .5) * 2, s: 3, a: 0, life: 4 + Math.random() * 2, big: true });
      toast('911', e.what === 'roadblock' ? `Suspect hits the roadblock at ${e.name}.` : `Pursuit crash at ${e.name}${e.hurt ? `. ${e.hurt} hurt, paramedics on the way` : ''}.`, 'var(--red)'); break;
    case 'pursuitNear': CH.flash.push({ x: e.x, y: e.y, t: now }); if (chNear(e.x, e.y) && now > CH.screechT) { CH.screechT = now + 900; chScreech(); } break;
    case 'pursuitHonk': if (chNear(e.x, e.y)) for (let i = 0; i < e.n; i++) setTimeout(() => snd('horn'), i * 180 + Math.random() * 200); break;
    case 'pursuitSpiked': for (let i = 0; i < 60; i++) chSpark(e.x, e.y, 6); chScreech(); break;
    case 'pursuitHeli': if (CH.sus) DIR.helis.push({ id: 900 + Math.floor(Math.random() * 90), kind: 'police', inc: -1, x: CH.sus.x + 900, y: CH.sus.y - 2200, z: 230, hd: 0, v: 0, tx: CH.sus.x, ty: CH.sus.y, phase: 'in', ang: 0, R: 120, light: 0,
      follow: () => CH.p && CH.p.state === 'flee' && CH.sus ? CH.sus : CH.scene && performance.now() - CH.scene.t0 < 40000 ? CH.scene.xy : null }); snd('radio'); break;
    case 'pursuitEnd': {
      CH.end = e; CH.tool = null; const m = CH_END[e.how] || ['OVER', 'stopped'];
      if (e.how !== 'escaped' && e.how !== 'calledoff') {
        const g0 = brkGeo({ edge: e.edge, s: e.s, x: e.x, y: e.y }), g2 = Object.assign({}, g0, { x: g0.x + g0.tx * 22, y: g0.y + g0.ty * 22 });
        CH.scene = { g: e.foot ? g2 : g0, g0, foot: e.foot, t0: now, xy: { x: e.x, y: e.y } }; cmd('addProps', brkProps('arrest', CH.scene.g), 70);
        if (CH.follow) camGoal = { x: CH.scene.g.x, y: CH.scene.g.y, h: Math.min(cam.h, 240) };
        snd('clear'); chLog(e.foot ? `He bails and runs on foot! Officers chase him down. In custody.` : `Suspect in custody on ${e.name}.`, 'radio');
      } else snd('alert');
      toast('PURSUIT', `The ${e.desc} ${m[1]} after ${chFmt(e.mins * 60)}. ${e.st.crashes} crash${e.st.crashes === 1 ? '' : 'es'}, ${e.st.hurt} hurt.`, e.how === 'escaped' || e.how === 'calledoff' ? 'var(--amber)' : 'var(--cyan)');
      clearTimeout(CH.endTimer); CH.endTimer = setTimeout(() => { CH.end = null; chHud(); }, 45000); chHud(); break; }
    case 'pursuitClear': CH.p = null; chHud(); break;
  }
}
function chSlow(p) { if (p === undefined) return; if (p && CH.end && p.state === 'flee') CH.end = null; CH.p = p; chHud(); }
function chHud() {
  const el = $('chase'); if (!el) return; const p = CH.p, end = CH.end; if (!p && !end) { el.hidden = true; return; } el.hidden = false;
  const live = p && p.state === 'flee' && !end; el.classList.toggle('done', !live);
  const st = (end ? end.st : p.st) || {};
  $('chTitle').textContent = live ? 'PURSUIT' : end ? (CH_END[end.how] || ['OVER'])[0] : 'PURSUIT';
  $('chClock').textContent = chFmt(end ? end.mins * 60 : p.t); $('chKmh').textContent = live ? p.kmh + ' km/h' : '';
  const warn = live ? (p.mode === 'wrong' ? ' <span class="warn">WRONG WAY</span>' : p.mode === 'curb' ? ' <span class="warn">ON THE SIDEWALK</span>' : '') + (p.flat ? ' <span class="warn">ON THE RIMS</span>' : p.hp < 70 ? ' <span class="warn">SMOKING</span>' : '') : '';
  $('chWhere').innerHTML = live ? `${p.desc} · ${p.name} ${p.dir}${warn}` : end ? `The ${end.desc} ${(CH_END[end.how] || ['', 'stopped'])[1]} on ${end.name}. ${end.km.toFixed(1)} km, top speed ${end.top} km/h.` : '';
  const chips = live ? [['Units', p.units], ['Crashes', st.crashes], ['Hurt', st.hurt], ['911 calls', st.calls], ['Drivers affected', p.aff], ['Reds run', st.reds]] : [['Crashes', st.crashes], ['Hurt', st.hurt], ['911 calls', st.calls], ['Reds run', st.reds], ['Wrong way', st.wrong], ['Near misses', st.near], ['Most drivers affected', st.peak]];
  $('chStats').innerHTML = chips.map(([k, v]) => `<span>${k} <b>${v || 0}</b></span>`).join('');
  $('chLog').innerHTML = CH.log.slice(0, 3).map(l => `<div><span class="tag k${l.kind}">${l.kind === '911' ? '911' : l.kind === 'ems' ? 'EMS' : 'RADIO'}</span>${l.txt.replace(/^911: /, '')}</div>`).join('');
  const btns = live ? [['follow', 'Follow', CH.follow], ['spikes', `Spike strip (${p.spikesLeft})`, CH.tool === 'spikes', p.spikesLeft <= 0], ['block', `Roadblock (${p.blocksLeft})`, CH.tool === 'block', p.blocksLeft <= 0], ['off', 'Call it off', false, false, 'off']] : [['close', 'Close', false]];
  const key = btns.map(b => b.join('|')).join(',');
  if (el.dataset.k !== key) { el.dataset.k = key; $('chBtns').innerHTML = btns.map(([a, l, on, dis, cls]) => `<button type="button" data-a="${a}" aria-pressed="${!!on}" ${dis ? 'disabled' : ''} class="${cls || ''}">${l}</button>`).join(''); }
}
document.addEventListener('click', ev => { const b = ev.target.closest && ev.target.closest('#chBtns button'); if (!b) return; const a = b.dataset.a; snd('ui');
  if (a === 'follow') CH.follow = !CH.follow;
  else if (a === 'spikes' || a === 'block') { CH.tool = CH.tool === a ? null : a; if (CH.tool) toast('PURSUIT', a === 'spikes' ? 'Tap a road ahead of the suspect to lay a spike strip.' : 'Tap an intersection ahead of the suspect to set a roadblock.', 'var(--cyan)'); }
  else if (a === 'off') cmd('pursuitCallOff');
  else if (a === 'close') { CH.end = null; clearTimeout(CH.endTimer); }
  chHud(); });
function chTap(x, y) {
  if (!CH.tool) return false; const t = CH.tool; CH.tool = null; chHud();
  if (t === 'spikes') { const n = nearestRoad(x, y, 30 * cam.wpp + 25); if (!n) { toast('PURSUIT', 'Tap closer to a road.', 'var(--muted)'); return true; } cmd('pursuitSpikes', n.e, x, y).then(r => r && r.ok === false && toast('PURSUIT', r.msg, 'var(--red)')); }
  else cmd('pursuitBlock', x, y).then(r => r && r.ok === false && toast('PURSUIT', r.msg, 'var(--red)'));
  snd('ui'); return true;
}
function chSpark(x, y, sp) { if (CH.sparks.length > 500) return; const a = Math.random() * 6.28, v = Math.random() * sp; CH.sparks.push({ x, y, z: 0.3, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: 2 + Math.random() * sp * 0.6, a: 0, life: 0.4 + Math.random() * 0.6 }); }
function chScreech() { if (!AC || muted) return; const t = AC.currentTime; nz(t, 0.7, 2400, 7, 'bandpass', 0.05, 3300); nz(t + 0.05, 0.6, 1700, 5, 'bandpass', 0.03, 2100); }
function chSiren() { const p = CH.p; return !!(p && p.state === 'flee' && p.lead && chNear(p.lead.x, p.lead.y) && cam.h < 1400); }
function chFrame(dt) {
  CH.sus = null;
  if (CH.p) for (let i = frameN - 1; i >= Math.max(0, frameN - 3000); i--) { const f = posBuf[i * 4 + 3] | 0; if (((f >> 14) & 1) && ((f >> 23) & 1) && (f & 7) <= 1) { CH.sus = { x: posBuf[i * 4], y: posBuf[i * 4 + 1], a: posBuf[i * 4 + 2] }; break; } }
  const s = CH.sus, p = CH.p, live = p && p.state === 'flee' && !CH.end;
  if (live && ptrs.size && dragMoved && CH.follow) { CH.follow = false; chHud(); }
  if (s && CH.follow && ptrs.size === 0 && live) {
    const lead = live ? Math.min(60, cam.h * 0.1) : 0, tx = s.x + Math.cos(s.a) * lead, ty = s.y + Math.sin(s.a) * lead, k = 1 - Math.exp(-dt * 5);
    camGoal = null; cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k; if (live && cam.h > 700) cam.h *= Math.pow(600 / cam.h, k * 0.3);
    if (performance.now() > (CH.holdT || 0)) { CH.holdT = performance.now() + 1000; try { DIR.hold(15000); } catch (err) {} } // keep the auto camera from cutting away mid-chase
  }
  const tag = $('susTag');
  if (tag) { const pr = s && R.project(s.x, s.y, 2); if (pr && pr[0] > 0 && pr[0] < innerWidth && pr[1] > 0 && pr[1] < innerHeight) { tag.hidden = false; tag.style.left = pr[0] + 'px'; tag.style.top = pr[1] + 'px'; tag.classList.toggle('done', !live); const txt = live ? `SUSPECT · ${p.kmh} km/h` : CH.end && CH.end.how !== 'escaped' && CH.end.how !== 'calledoff' ? 'IN CUSTODY' : ''; if (tag.textContent !== txt) tag.textContent = txt; if (!txt) tag.hidden = true; } else tag.hidden = true; }
  if (s && live) {
    if (p.hp < 75 && smoke.length < 380 && Math.random() < dt * (4 + (75 - p.hp) * 0.25)) smoke.push({ x: s.x - Math.cos(s.a) * 2, y: s.y - Math.sin(s.a) * 2, z: 0.8, vx: (Math.random() - .5) * 1.5, vy: (Math.random() - .5) * 1.5, s: 1.2, a: 0, life: 2.5, big: p.hp < 40 });
    if (p.flat && p.kmh > 2) for (let i = 0; i < 3; i++) if (Math.random() < dt * 30) chSpark(s.x - Math.cos(s.a) * 1.5, s.y - Math.sin(s.a) * 1.5, 4);
  }
}
function chSceneFigs(T) {
  const sc = CH.scene; if (!sc) return [];
  if (!sc.foot) return T < 28 ? brkArrest(sc, T) : [];
  if (T >= 8) return T < 30 ? brkArrest(sc, Math.min(27.5, T - 8 + 5)) : [];
  const g = sc.g0, A = (d, l) => [g.x + g.tx * d + g.nx * l, g.y + g.ty * d + g.ny * l], kb = g.hr + 2.2, face = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]);
  const r0 = A(0, g.hr * 0.5), r1 = A(26, kb), rf = brkE(brkC(T, 0.3, 6.2)), r = brkMix(r0, r1, rf), o0 = A(-14, g.hr - 2), o1 = A(24.6, kb), of = brkE(brkC(T, 1.0, 6.6)), o = brkMix(o0, o1, of), o2 = brkMix(A(-20, g.hr - 2), A(21, kb + 1), brkE(brkC(T, 1.8, 7.8)));
  const out = [{ kind: T < 6.3 ? 29 : 25, x: r[0], y: r[1], h: T < 6.3 ? face(r0, r1) : face(r, o), px: 20 }, { kind: 24, x: o[0], y: o[1], h: face(o, r), px: 22 }, { kind: 24, x: o2[0], y: o2[1], h: face(o2, r), px: 22 }];
  [[8, 4.2], [12, 5], [17, 4.4], [30, 4.8]].forEach(([d, l], k) => { const q = A(d, g.hr + l); out.push({ kind: 29, x: q[0], y: q[1], h: face(q, r) + 0.12 * Math.sin(T * 1.5 + k * 2), px: 20 }); });
  return out;
}
function chSpritesA(put) {
  const p = CH.p;
  if (p && p.spikes) for (const k of p.spikes) put(k.x, k.y, 0.3, k.w * 0.5 + 0.5, 6, k.used ? 0.45 : 1, 6, -(k.a + Math.PI / 2));
  if (p && p.blocks) for (const b of p.blocks) for (let k = 0; k < 6; k++) put(b.x + Math.cos(k * 1.05) * 9, b.y + Math.sin(k * 1.05) * 9, 0.3, 1.1, 20, 1, 5, 0);
  if (CH.scene) { const T = (performance.now() - CH.scene.t0) / 1000; for (const f of chSceneFigs(T)) put(f.x, f.y, 0.15, 0.85, f.kind, f.a == null ? 1 : f.a, f.px || 20, -f.h); if (T > 40) CH.scene = null; }
}
function chSpritesB(put, dt) {
  const now = performance.now(), s = CH.sus, p = CH.p;
  if (s && p && p.state === 'flee' && !CH.end) put(s.x, s.y, 0.5, 24, 7, 1, 34, 0);
  CH.flash = CH.flash.filter(f => now - f.t < (f.big ? 4000 : 1600)); for (const f of CH.flash) put(f.x, f.y, 0.5, f.big ? 40 : 22, 7, 1, f.big ? 46 : 30, 0);
  for (const k of CH.sparks) { k.a += dt; k.x += k.vx * dt; k.y += k.vy * dt; k.z = Math.max(0, k.z + k.vz * dt); k.vz -= 22 * dt; put(k.x, k.y, k.z, 0.7, 30, 1 - k.a / k.life, 2, 0); }
  CH.sparks = CH.sparks.filter(k => k.a < k.life);
}
