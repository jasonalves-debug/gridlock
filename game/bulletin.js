// ---------------------------------------------------------------- "Near me": a vintage local newscast. What happened within 1 km of you, the headlines,
// 401 / DVP traffic and the weather, voiced by the collector (Kokoro), cut together here with synthesised jingles, then the live map at your door.
const BUL = { on: false, want: false, data: null, dataP: null, geoP: null, me: null, seq: [], stop: false, srcs: new Set(), bufs: new Map(), marks: [], ring: null, bedKind: null, bedT: 0, nodes: null, holdT: 0, t0: 0 };
const BUL_R = 1000;
(function bulUI() {
  const st = document.createElement('style');
  st.textContent = `#bul { position: fixed; inset: 0; z-index: 30; pointer-events: none; font-family: 'Alfa Slab One', Rockwell, 'Roboto Slab', Georgia, serif; color: #f4ead2; }
#bul[hidden] { display: none; }
#bul .fx { position: absolute; inset: 0; background: radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(10,6,0,.55) 100%), repeating-linear-gradient(0deg, rgba(0,0,0,.13) 0 1px, rgba(0,0,0,0) 1px 3px); }
#bul .grain { position: absolute; inset: -50%; opacity: .09; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>"); animation: bulGrain .5s steps(4) infinite; }
@keyframes bulGrain { 0% { transform: translate(0,0); } 25% { transform: translate(-3%,2%); } 50% { transform: translate(2%,-3%); } 75% { transform: translate(-2%,-1%); } }
body.bul #gl { filter: sepia(.42) saturate(.72) contrast(1.08) brightness(.96); }
body.bul #hud, body.bul #tools, body.bul #ticker, body.bul #pulse, body.bul #now, body.bul #chase, body.bul #susTag, body.bul #sheet, body.bul #h24bar, body.bul #areabar, body.bul #brkfx, body.bul #bcast, body.bul #tvboard, body.bul #feed, body.bul #chips, body.bul #polRow, body.bul #hint, body.bul #bars { display: none !important; }
#bul .bug { position: absolute; left: 14px; top: calc(env(safe-area-inset-top, 0px) + 12px); display: flex; align-items: stretch; box-shadow: 0 3px 12px rgba(0,0,0,.5); }
#bul .bug b { background: #f4ead2; color: #1b2a4a; padding: 6px 10px; font-size: 17px; letter-spacing: .04em; } #bul .bug span { background: #1b2a4a; padding: 6px 10px; font: 700 16px 'Special Elite', 'Courier New', monospace; }
#bul .bug i { background: #b3261e; color: #fff; padding: 6px 9px; font: 800 13px system-ui, sans-serif; font-style: normal; align-self: stretch; display: flex; align-items: center; animation: bulAir 1.6s ease-in-out infinite; }
@keyframes bulAir { 50% { background: #7d1a14; } }
#bul .card { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; background: radial-gradient(ellipse at center, #2a3b62 0%, #101a30 70%); opacity: 0; transition: opacity .6s; }
#bul .card.show { opacity: 1; } #bul .card .k { font: 700 16px 'Special Elite', 'Courier New', monospace; letter-spacing: .25em; color: #e9c46a; }
#bul .card h1 { margin: 10px 16px; font-size: clamp(38px, 9vw, 92px); line-height: .95; color: #f4ead2; text-shadow: 0 4px 0 #b3261e, 0 8px 22px rgba(0,0,0,.6); letter-spacing: .02em; }
#bul .card .d { font: 700 18px 'Special Elite', 'Courier New', monospace; color: #f4ead2; opacity: .85; }
#bul .card .rays { position: absolute; width: 160vmax; height: 160vmax; background: repeating-conic-gradient(rgba(233,196,106,.09) 0 6deg, rgba(0,0,0,0) 6deg 12deg); animation: bulSpin 40s linear infinite; z-index: -1; }
@keyframes bulSpin { to { transform: rotate(360deg); } }
#bul .leader { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: #14110c; }
#bul .leader[hidden] { display: none; } #bul .leader .c { width: min(60vw, 300px); aspect-ratio: 1; border-radius: 50%; border: 6px solid #d8ccb0; position: relative; display: flex; align-items: center; justify-content: center; }
#bul .leader .c::before { content: ''; position: absolute; inset: 0; border-radius: 50%; background: conic-gradient(rgba(216,204,176,.35) var(--a, 0deg), rgba(0,0,0,0) 0); }
#bul .leader .c b { font-size: min(34vw, 170px); color: #d8ccb0; position: relative; } #bul .leader .msg { position: absolute; bottom: 18%; font: 700 18px 'Special Elite', 'Courier New', monospace; color: #d8ccb0; letter-spacing: .1em; }
#bul .lower { position: absolute; left: 14px; right: 14px; bottom: calc(env(safe-area-inset-bottom, 0px) + 92px); max-width: 760px; transform: translateY(30px); opacity: 0; transition: transform .45s cubic-bezier(.2,.9,.3,1.2), opacity .35s; }
#bul .lower.show { transform: none; opacity: 1; }
#bul .lower .k { display: inline-block; background: #b3261e; color: #fff; padding: 5px 10px; font: 800 14px system-ui, sans-serif; letter-spacing: .08em; }
#bul .lower .t { background: #f4ead2; color: #1b2a4a; padding: 8px 12px 6px; font-size: clamp(22px, 5.4vw, 34px); line-height: 1.08; box-shadow: 0 4px 0 #1b2a4a; }
#bul .lower .s { background: #1b2a4a; color: #f4ead2; padding: 7px 12px; font: 700 clamp(16px, 4vw, 20px)/1.3 'Special Elite', 'Courier New', monospace; min-height: 1.3em; }
#bul .board { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%) scale(.96); width: min(560px, calc(100vw - 28px)); background: #1b2a4a; border: 4px solid #f4ead2; box-shadow: 0 0 0 4px #1b2a4a, 0 14px 40px rgba(0,0,0,.6); opacity: 0; transition: opacity .4s, transform .4s; }
#bul .board.show { opacity: 1; transform: translate(-50%, -50%); } #bul .board .h { background: #f4ead2; color: #1b2a4a; padding: 8px 14px; font-size: 24px; display: flex; justify-content: space-between; }
#bul .board .b { padding: 14px 16px 16px; font: 700 18px/1.4 'Special Elite', 'Courier New', monospace; } #bul .board .big { font-family: 'Alfa Slab One', Rockwell, Georgia, serif; font-size: 72px; line-height: 1; color: #e9c46a; }
#bul .board .row { display: flex; gap: 14px; justify-content: space-between; border-top: 2px dashed rgba(244,234,210,.3); padding-top: 8px; margin-top: 8px; }
#bul .cap { position: absolute; left: 14px; right: 14px; bottom: calc(env(safe-area-inset-bottom, 0px) + 20px); max-width: 760px; font: 600 clamp(16px, 3.9vw, 20px)/1.35 system-ui, sans-serif; color: #fff; text-shadow: 0 2px 4px #000, 0 0 10px #000; min-height: 2.7em; }
#bul .skip { position: absolute; right: 14px; top: calc(env(safe-area-inset-top, 0px) + 12px); pointer-events: auto; font: 800 16px system-ui, sans-serif; color: #1b2a4a; background: #f4ead2; border: 0; border-radius: 8px; padding: 10px 14px; box-shadow: 0 3px 10px rgba(0,0,0,.5); cursor: pointer; }
#newsQuick { display: none; margin: 12px 0 4px; font: 800 18px system-ui, sans-serif; color: #1b2a4a; background: #e9c46a; border: 0; border-radius: 10px; padding: 12px 18px; cursor: pointer; } #start.auto #newsQuick { display: inline-block; } #newsQuick.on { background: #f4ead2; }
@media (max-width: 560px) { #bul .skip { top: calc(env(safe-area-inset-top, 0px) + 58px); padding: 8px 12px; } #bul .bug b { font-size: 15px; } }
#start .mode.news { border-color: #e9c46a; background: linear-gradient(135deg, rgba(233,196,106,.18), rgba(27,42,74,.5)); } #start .mode.news .tag { color: #e9c46a; }`;
  document.head.appendChild(st);
  const el = document.createElement('div'); el.id = 'bul'; el.hidden = true;
  el.innerHTML = `<div class="grain"></div><div class="fx"></div>
<div class="bug"><b>GRIDLOCK REPORT</b><span id="bulClk"></span><i>ON AIR</i></div>
<div class="board" id="bulBoard"><div class="h"><span id="bulBH"></span><span id="bulBH2"></span></div><div class="b" id="bulBB"></div></div>
<div class="lower" id="bulLow"><span class="k" id="bulLK"></span><div class="t" id="bulLT"></div><div class="s" id="bulLS"></div></div>
<div class="cap" id="bulCap"></div>
<div class="card" id="bulCard"><div class="rays"></div><div class="k">SCARBOROUGH EDITION</div><h1>THE GRIDLOCK<br>REPORT</h1><div class="d" id="bulDate"></div></div>
<div class="leader" id="bulLead" hidden><div class="c"><b id="bulN">3</b></div><div class="msg" id="bulMsg">TUNING IN…</div></div>
<button type="button" class="skip" id="bulSkip">Skip report ▸▸</button>`;
  document.body.appendChild(el);
  const modes = document.querySelector('#start .modes');
  if (modes) { const b = document.createElement('button'); b.className = 'mode news'; b.id = 'goNews'; b.type = 'button';
    b.innerHTML = '<span class="tag">● NEAR ME · THE GRIDLOCK REPORT</span><b>My morning report</b><span>Zooms to where you are and reads what happened within 1 km in the last day, then the headlines, 401 and DVP traffic and the weather.</span>';
    modes.insertBefore(b, modes.firstChild); }
  const tv = document.getElementById('tvBtn'); if (tv) { const nb = document.createElement('button'); nb.type = 'button'; nb.className = 'tool'; nb.id = 'newsBtn'; nb.hidden = true; nb.setAttribute('aria-label', 'Play my report'); nb.title = 'The Gridlock Report: what happened near you';
    nb.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="9" width="18" height="11" rx="2"/><path d="M7 9l10-5" stroke-linecap="round"/><circle cx="8.5" cy="14.5" r="2.5"/><path d="M14 13h4M14 16h4" stroke-linecap="round"/></svg>'; tv.parentNode.insertBefore(nb, tv); }
  const lede = document.getElementById('lede'); if (lede) { const q = document.createElement('button'); q.id = 'newsQuick'; q.type = 'button'; q.textContent = '▶ Play my morning report'; lede.after(q); }
})();
function bulHM(ts) { return new Date(ts * 1000).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' }).replace('a.m.', 'AM').replace('p.m.', 'PM'); }
function bulGo() { bulArm(); begin('live'); }
function bulArm() {
  audioInit(); if (muted) setMuted(false); BUL.want = true;
  try { if (!document.getElementById('bulFont')) { const l = document.createElement('link'); l.id = 'bulFont'; l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?family=Alfa+Slab+One&family=Special+Elite&display=swap'; document.head.appendChild(l); } } catch (e) {}
  BUL.dataP = fetch(FEED_BASE + 'bulletin.json?t=' + Date.now(), { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null);
  BUL.geoP = new Promise(res => { let done = false; const fin = v => { if (!done) { done = true; res(v); } };
    if (!navigator.geolocation) return fin(store.get('bulMe', null));
    navigator.geolocation.getCurrentPosition(p => { const v = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }; store.set('bulMe', v); fin(v); }, () => fin(store.get('bulMe', null)), { enableHighAccuracy: false, timeout: 9000, maximumAge: 15 * 60000 });
    setTimeout(() => fin(store.get('bulMe', null)), 10000); });
}
$('goNews').onclick = bulGo;
$('newsBtn').onclick = () => { if (BUL.on || !ready) return; snd('ui'); bulArm(); bulStart(); };
$('newsQuick').onclick = () => { if (ready) { bulArm(); bulStart(); } else { bulArm(); } const q = $('newsQuick'); q.classList.add('on'); q.textContent = '✓ Your report starts when the map opens'; };
if (location.hash === '#news') { const b = $('goNews'); b.classList.add('first'); setTimeout(() => b.scrollIntoView({ block: 'center' }), 50); }

// ---------------------------------------------------------------- audio: a warm, band-limited "AM radio" voice chain, hiss and crackle, synthesised jingles and beds
function bulAudio() {
  if (BUL.nodes || !AC) return BUL.nodes; const N = {};
  N.out = AC.createGain(); N.out.gain.value = 1; const glue = AC.createDynamicsCompressor(); glue.threshold.value = -16; glue.ratio.value = 3; glue.attack.value = 0.01; glue.release.value = 0.25; N.out.connect(glue); glue.connect(master);
  const hp = AC.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 170; const pk = AC.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 2400; pk.gain.value = 4; pk.Q.value = 0.9;
  const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5200; const sh = AC.createWaveShaper(); const cv = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; cv[i] = Math.tanh(x * 1.6) / Math.tanh(1.6); } sh.curve = cv;
  N.voice = AC.createGain(); N.voice.gain.value = 1.05; hp.connect(pk); pk.connect(lp); lp.connect(sh); sh.connect(N.voice); N.voice.connect(N.out); N.vin = hp;
  N.wow = AC.createOscillator(); N.wow.frequency.value = 0.55; N.wowG = AC.createGain(); N.wowG.gain.value = 5; N.wow.connect(N.wowG); N.wow.start();
  N.mus = AC.createGain(); N.mus.gain.value = 0.55; const mlp = AC.createBiquadFilter(); mlp.type = 'lowpass'; mlp.frequency.value = 6500; N.mus.connect(mlp); mlp.connect(N.out);
  N.bed = AC.createGain(); N.bed.gain.value = 0; N.bed.connect(N.mus);
  const hs = AC.createBufferSource(); hs.buffer = noiseB; hs.loop = true; const hb = AC.createBiquadFilter(); hb.type = 'bandpass'; hb.frequency.value = 3200; hb.Q.value = 0.4; N.hiss = AC.createGain(); N.hiss.gain.value = 0; hs.connect(hb); hb.connect(N.hiss); N.hiss.connect(N.out); hs.start();
  return (BUL.nodes = N);
}
function bulEnv(g, t, a, peak, d, sus, rel, end) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * sus), t + a + d); g.gain.setValueAtTime(Math.max(0.0002, peak * sus), end); g.gain.exponentialRampToValueAtTime(0.0001, end + rel); }
const BN = n => 440 * Math.pow(2, (n - 69) / 12);
function bBrass(dst, t, n, dur, vel) { const f = BN(n), lp = AC.createBiquadFilter(), g = AC.createGain(); lp.type = 'lowpass'; lp.Q.value = 1.3; lp.frequency.setValueAtTime(350, t); lp.frequency.exponentialRampToValueAtTime(900 + 2600 * vel, t + 0.05); lp.frequency.exponentialRampToValueAtTime(700 + 1400 * vel, t + 0.35);
  bulEnv(g, t, 0.025, 0.11 * vel, 0.18, 0.7, 0.22, t + dur); lp.connect(g); g.connect(dst);
  for (const d of [-8, 0, 7]) { const o = AC.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = d; const vib = AC.createOscillator(), vg = AC.createGain(); vib.frequency.value = 5.2; vg.gain.value = 0; vg.gain.setValueAtTime(0, t + 0.2); vg.gain.linearRampToValueAtTime(7, t + 0.6); vib.connect(vg); vg.connect(o.detune); vib.start(t); vib.stop(t + dur + 0.4); o.connect(lp); o.start(t); o.stop(t + dur + 0.4); } }
function bTimp(dst, t, n, vel) { const o = AC.createOscillator(), g = AC.createGain(); o.frequency.setValueAtTime(BN(n) * 1.06, t); o.frequency.exponentialRampToValueAtTime(BN(n), t + 0.12); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5 * vel, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4); o.connect(g); g.connect(dst); o.start(t); o.stop(t + 1.5);
  const s = AC.createBufferSource(), bp = AC.createBiquadFilter(), ng = AC.createGain(); s.buffer = noiseB; bp.type = 'bandpass'; bp.frequency.value = 260; bp.Q.value = 1.2; ng.gain.setValueAtTime(0.25 * vel, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.25); s.connect(bp); bp.connect(ng); ng.connect(dst); s.start(t, Math.random()); s.stop(t + 0.3); }
function bClick(dst, t, v) { const s = AC.createBufferSource(), bp = AC.createBiquadFilter(), g = AC.createGain(); s.buffer = noiseB; bp.type = 'bandpass'; bp.frequency.value = 2400 + Math.random() * 1600; bp.Q.value = 2.5; g.gain.setValueAtTime(0.32 * v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.014 + Math.random() * 0.01); s.connect(bp); bp.connect(g); g.connect(dst); s.start(t, Math.random() * 1.5); s.stop(t + 0.04); }
function bTone(dst, t, f, d, v, type) { const o = AC.createOscillator(), g = AC.createGain(); o.type = type || 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.006); g.gain.setValueAtTime(v, t + Math.max(0.01, d - 0.012)); g.gain.exponentialRampToValueAtTime(0.0001, t + d); o.connect(g); g.connect(dst); o.start(t); o.stop(t + d + 0.02); }
function bBell(dst, t, v) { for (const [f, a, d] of [[2093, 1, 1.4], [5230, 0.35, 0.6], [3140, 0.25, 0.9]]) { const o = AC.createOscillator(), g = AC.createGain(); o.frequency.value = f; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09 * a * v, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + d); o.connect(g); g.connect(dst); o.start(t); o.stop(t + d); } }
function bVibe(dst, t, n, v, d) { const f = BN(n), g = AC.createGain(), trem = AC.createOscillator(), tg = AC.createGain(); trem.frequency.value = 5.5; tg.gain.value = 0.35; trem.connect(tg); tg.connect(g.gain); trem.start(t); trem.stop(t + (d || 2));
  for (const [m, a] of [[1, 1], [4, 0.18], [10, 0.05]]) { const o = AC.createOscillator(), og = AC.createGain(); o.frequency.value = f * m; og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.08 * a * v, t + 0.005); og.gain.exponentialRampToValueAtTime(0.0001, t + (d || 2) / m ** 0.3); o.connect(og); og.connect(g); o.start(t); o.stop(t + (d || 2)); } g.connect(dst); }
function bMorse(dst, t, s) { const u = 0.065; const M = { N: '-.', E: '.', W: '.--', S: '...' }; for (const ch of s) { for (const sym of M[ch] || '') { const d = sym === '-' ? u * 3 : u; bTone(dst, t, 880, d, 0.07); t += d + u; } t += u * 2; } return t; }
// jingles: return their length in seconds
function bulJingle(kind) {
  const N = bulAudio(); if (!N) return 0; const d = N.mus, t = AC.currentTime + 0.05;
  if (kind === 'open') {
    for (let i = 0; i < 26; i++) bClick(d, t + i * 0.075 + Math.random() * 0.03, 0.8); const m = bMorse(d, t + 0.2, 'NEWS'); bBell(d, m + 0.05, 1);
    const s = Math.max(t + 2.2, m + 0.35); for (let i = 0; i < 8; i++) bTimp(d, s - 0.6 + i * 0.075, 41, 0.25 + i * 0.07);
    [[0, 58, 0.18], [0.2, 65, 0.18], [0.4, 70, 0.5]].forEach(([o, n, l]) => { bBrass(d, s + o, n, l, 0.8); bBrass(d, s + o, n - 12, l, 0.5); });
    [[1.0, [63, 67, 70]], [1.45, [65, 69, 72]], [1.9, [58, 62, 65, 70]]].forEach(([o, ch], k) => { for (const n of ch) bBrass(d, s + o, n, k === 2 ? 1.6 : 0.32, k === 2 ? 1 : 0.85); bTimp(d, s + o, k === 2 ? 34 : 41, 0.9); });
    return s - t + 3.6; }
  if (kind === 'bump') { [[0, [62, 65, 70]], [0.28, [63, 67, 70]], [0.56, [65, 70, 74]]].forEach(([o, ch], k) => { for (const n of ch) bBrass(d, t + o, n, k === 2 ? 0.9 : 0.18, 0.8); }); bTimp(d, t + 0.56, 34, 0.8); return 1.9; }
  if (kind === 'traffic') { [72, 76, 79, 84].forEach((n, i) => bVibe(d, t + i * 0.11, n, 1, 1.4)); bTone(d, t + 0.62, 415, 0.13, 0.05, 'square'); bTone(d, t + 0.8, 415, 0.2, 0.05, 'square'); bTone(d, t + 0.62, 523, 0.13, 0.03, 'square'); bTone(d, t + 0.8, 523, 0.2, 0.03, 'square'); return 1.6; }
  if (kind === 'weather') { [84, 79, 76, 72, 67].forEach((n, i) => bVibe(d, t + i * 0.14, n, 0.9, 2.2)); return 1.8; }
  if (kind === 'cue') { bTone(d, t, 1320, 0.07, 0.05); bTone(d, t + 0.11, 1320, 0.07, 0.05); bClick(d, t + 0.22, 1); return 0.35; }
  if (kind === 'close') { for (let i = 0; i < 6; i++) bTimp(d, t + i * 0.08, 41, 0.3 + i * 0.1); [[0.5, [65, 69, 72]], [0.85, [63, 67, 70, 75]], [1.3, [58, 62, 65, 70, 74]]].forEach(([o, ch], k) => { for (const n of ch) bBrass(d, t + o, n, k === 2 ? 2.2 : 0.3, 0.9); bTimp(d, t + o, k === 2 ? 34 : 41, 0.9); }); bBell(d, t + 3.2, 0.7); return 4.2; }
  return 0;
}
function bulBedTick() { // background beds, scheduled a little ahead
  const N = BUL.nodes; if (!N || !BUL.on || !BUL.bedKind) return; const now = AC.currentTime; if (BUL.bedT < now) BUL.bedT = now + 0.05;
  const beat = 60 / 104;
  while (BUL.bedT < now + 0.35) { const t = BUL.bedT, k = BUL.bedKind, step = Math.round(t / (beat / 4));
    if (k === 'wire') { if (Math.random() < 0.62) bClick(N.bed, t, 0.55 + Math.random() * 0.4); if (step % 4 === 0) bTone(N.bed, t, 55, 0.22, 0.13, 'triangle'); if (step % 64 === 0) bBell(N.bed, t, 0.5); }
    else if (k === 'news') { if (step % 4 === 0) bTone(N.bed, t, step % 8 === 0 ? 58.27 : 46.25, 0.3, 0.12, 'triangle'); if (step % 16 === 8) for (const n of [58, 62, 65]) bBrass(N.bed, t, n, 0.25, 0.25); if (Math.random() < 0.2) bClick(N.bed, t, 0.35); }
    else if (k === 'desk') { if (step % 2 === 0) { const arp = [72, 76, 79, 76, 74, 77, 81, 77]; bVibe(N.bed, t, arp[(step / 2) % 8], 0.45, 1.1); } if (step % 8 === 0) bTone(N.bed, t, 65.4, 0.35, 0.1, 'triangle'); }
    BUL.bedT += beat / 4; }
}
function bulBed(kind, lvl) { const N = bulAudio(); if (!N) return; BUL.bedKind = kind; N.bed.gain.setTargetAtTime(kind ? (lvl || 0.5) : 0, AC.currentTime, 0.4); }
function bulDuck(on) { const N = BUL.nodes; if (N) N.bed.gain.setTargetAtTime(BUL.bedKind ? (on ? 0.22 : 0.5) : 0, AC.currentTime, on ? 0.08 : 0.5); }
async function bulLoad(key) { // decode a voice clip once
  const c = BUL.data && BUL.data.clips && BUL.data.clips[key]; if (!c || !c.f || !AC) return null; if (BUL.bufs.has(key)) return BUL.bufs.get(key);
  const p = fetch(FEED_BASE + c.f).then(r => r.ok ? r.arrayBuffer() : Promise.reject(r.status)).then(b => new Promise((res, rej) => AC.decodeAudioData(b, res, rej))).catch(() => null);
  BUL.bufs.set(key, p); return p;
}
let bulVoiceList = null;
function bulSpeakFallback(text, desk) { // the phone's own voice, for anything the collector hasn't voiced yet
  return new Promise(res => { try { const u = new SpeechSynthesisUtterance(text); if (!bulVoiceList) bulVoiceList = speechSynthesis.getVoices();
    const vs = bulVoiceList.filter(v => /^en(-|_)(CA|US|GB)/i.test(v.lang)), pref = vs.find(v => /natural|neural|premium|enhanced/i.test(v.name) && (desk ? /female|aria|jenny|samantha|zira/i.test(v.name) : /male|guy|davis|daniel|alex/i.test(v.name))) || vs.find(v => /natural|neural|premium|enhanced|google/i.test(v.name)) || vs[0];
    if (pref) u.voice = pref; u.rate = 1.0; u.pitch = desk ? 1.05 : 0.92; u.onend = u.onerror = () => res(); speechSynthesis.speak(u); setTimeout(res, 2000 + text.length * 90); } catch (e) { res(); } });
}
async function bulSay(key, text, nocap) {
  const c = (BUL.data && BUL.data.clips && BUL.data.clips[key]) || {}; text = text || c.t || ''; if (!text && !c.f) return; const desk = c.v === 'af_heart' || key.startsWith('s:desk') || key === 'traffic' || key === 'weather';
  $('bulCap').textContent = nocap ? '' : text; bulDuck(true);
  const buf = await bulLoad(key);
  if (BUL.stop) return;
  if (buf) { const N = bulAudio(); await new Promise(res => { const s = AC.createBufferSource(); s.buffer = buf; N.wowG.connect(s.detune); s.connect(N.vin); s.onended = () => { BUL.srcs.delete(s); res(); }; BUL.srcs.add(s); s.start(); setTimeout(res, buf.duration * 1000 + 1500); }); }
  else await bulSpeakFallback(text, desk);
  bulDuck(false);
}
const bulWait = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------- the script
function bulKeyTime(ts) { if (Date.now() / 1000 - ts < 3600) return 's:t_recent'; const d = new Date(ts * 1000), now = new Date(); return (d.toDateString() === now.toDateString() ? 's:t_today_' : 's:t_yday_') + d.getHours(); }
function bulPlace(c) { const loc = c.loc || ''; const m = loc.match(/^(M1[A-Z])/); if (m || !loc) return m ? m[1] + ' area' : 'Scarborough'; return loc.split(' - ').filter(p => !/^Ln\b/.test(p)).map(p => p.replace(/\bMc([a-z])/g, (a, b) => 'Mc' + b.toUpperCase())).join(' & '); }
function bulLine(c) { const L = BUL.data && BUL.data.lines && BUL.data.lines[c.id]; if (L) return L; const lab = (c.label || 'a call').toLowerCase().replace('&', 'and'); return `${c.src === 'tps' ? 'Police' : 'Toronto Fire'} responded to ${/^[aeiou]/.test(lab) ? 'an' : 'a'} ${lab}, ${bulPlace(c).replace('&', 'and')}.`; }
function bulDedupe(L) { const out = []; for (const o of L) { if (out.some(k => Math.abs(k.c.ts - o.c.ts) < 3 * 3600 && Math.hypot(k.x - o.x, k.y - o.y) < 150 && (k.c.label === o.c.label || (k.c.act.startsWith('crash') && o.c.act.startsWith('crash'))))) continue; out.push(o); } return out; }
const BUL_SEV = { critical: 4, high: 3, medium: 2, low: 1 };
function bulScore(o) { const c = o.c; return (BUL_SEV[c.sev] || 1) + (c.act === 'crash2' || c.act === 'crash3' || c.act === 'fire_struct' || c.act === 'gas' ? 0.6 : 0) - o.age / 86400 * 0.8; }
function bulMinor(c) { return c.act === 'medical' || c.act === 'fire_alarm'; }
function bulBuild(me) {
  const D = BUL.data || {}, hr = new Date().getHours(), seq = [], calls = h24calls().filter(o => (BUL_SEV[o.c.sev] || 0) > 0);
  const greet = hr >= 5 && hr < 12 ? 'morning' : hr < 17 && hr >= 12 ? 'afternoon' : hr >= 17 && hr < 22 ? 'evening' : 'night';
  const meXY = me && me.inside ? me : null, far = o => !meXY || Math.hypot(o.x - meXY.x, o.y - meXY.y) > (/\(approx|^M1/i.test(o.c.loc || '') ? 1500 : BUL_R);
  seq.push({ k: 'card' }, { k: 'jingle', j: 'open' }, { k: 'cardOff' });
  seq.push({ k: 'cam', x: meXY ? meXY.x : 0, y: meXY ? meXY.y : 0, h: meXY ? 1500 : 9000, slow: true }, { k: 'say', key: 's:greet_' + greet }, { k: 'say', key: 's:intro' });
  let near = [], feat = [];
  if (meXY) { near = calls.filter(o => !far(o)); feat = bulDedupe(near.filter(o => !bulMinor(o.c)).sort((a, b) => bulScore(b) - bulScore(a))).slice(0, 4).sort((a, b) => a.c.ts - b.c.ts); }
  const callItem = (o, lab) => { const c = o.c, dist = meXY ? Math.round(Math.hypot(o.x - meXY.x, o.y - meXY.y) / 10) * 10 : 0;
    seq.push({ k: 'jingle', j: 'cue' }, { k: 'cam', x: o.x, y: o.y, h: 420, mark: o }, { k: 'low', kick: `${c.src === 'tps' ? 'TORONTO POLICE' : 'TORONTO FIRE'} · ${bulHM(c.ts)}`, title: (c.label || '').toUpperCase(), sub: bulPlace(c) + (dist ? ` · ${dist >= 1000 ? (dist / 1000).toFixed(1) + ' km' : dist + ' m'} from you` : '') },
      { k: 'say', key: bulKeyTime(c.ts) }, { k: 'say', key: 'c:' + c.id, text: bulLine(c) }, { k: 'lowOff' }); };
  if (!me) seq.push({ k: 'say', key: 's:no_loc' }); else if (!me.inside) seq.push({ k: 'say', key: 's:near_out' });
  else { seq.push({ k: 'ring', on: true }, { k: 'say', key: feat.length ? 's:near' : 's:near_quiet' }); }
  if (feat.length) { seq.push({ k: 'ring', on: false }, { k: 'bed', b: 'wire' }); feat.forEach(o => callItem(o)); }
  const minor = near.length - feat.length; if (minor > 0) seq.push({ k: 'cam', x: meXY.x, y: meXY.y, h: 1500 }, { k: 'say', key: 's:minor_' + Math.min(40, minor) });
  const wide = calls.filter(o => far(o) && (o.c.sev === 'critical' || o.c.sev === 'high' || o.c.act === 'fire_struct' || o.c.act === 'gas' || o.c.act === 'crash3')).sort((a, b) => bulScore(b) - bulScore(a)); const wideP = bulDedupe(wide.filter(o => !feat.includes(o))).slice(0, feat.length >= 3 ? 1 : feat.length ? 2 : 3).sort((a, b) => a.c.ts - b.c.ts);
  if (wideP.length) { seq.push({ k: 'ring', on: false }, { k: 'bed', b: 'wire' }, { k: 'say', key: feat.length ? 's:wider' : (me && me.inside ? 's:wider2' : 's:top') }); wideP.forEach(o => callItem(o)); }
  seq.push({ k: 'bed', b: null }, { k: 'ring', on: false });
  const pick = ((D.news && D.news.items) || []).slice(0, 3); // already ranked by the collector: the stories the most outlets carry
  if (pick.length) { seq.push({ k: 'cam', x: meXY ? meXY.x : 0, y: meXY ? meXY.y : 0, h: meXY ? 2600 : 9000, slow: true }, { k: 'jingle', j: 'bump' }, { k: 'bed', b: 'news' }, { k: 'say', key: 's:news_' + (hr < 12 && hr >= 4 ? 'morning' : hr < 17 && hr >= 12 ? 'afternoon' : 'evening') });
    pick.forEach(it => seq.push({ k: 'low', kick: it.src.replace(/^the /, '').toUpperCase() + ' · ' + bulHM(it.ts), title: it.title, sub: '' }, { k: 'say', key: 'n:' + it.id, nocap: true }, { k: 'lowOff' }));
    seq.push({ k: 'bed', b: null }); }
  if (D.traffic || D.weather) { seq.push({ k: 'say', key: 's:toss' }, { k: 'jingle', j: 'traffic' }, { k: 'bed', b: 'desk' }, { k: 'say', key: 's:desk_hi' });
    if (D.traffic) { const hw = bulHwyView(meXY); seq.push({ k: 'cam', x: hw.x, y: hw.y, h: 1800, slow: true }, { k: 'board', kind: 'traffic' }, { k: 'say', key: 'traffic' }, { k: 'boardOff' }); }
    if (D.weather) seq.push({ k: 'jingle', j: 'weather' }, { k: 'say', key: 's:desk_wx' }, { k: 'board', kind: 'weather' }, { k: 'say', key: 'weather' }, { k: 'boardOff' }, { k: 'say', key: 's:desk_out' });
    seq.push({ k: 'bed', b: null }, { k: 'say', key: 's:thanks' }); }
  seq.push({ k: 'cam', x: meXY ? meXY.x : 0, y: meXY ? meXY.y : 0, h: meXY ? 900 : 6000, slow: true }, { k: 'say', key: 's:signoff' }, { k: 'jingle', j: 'close' });
  return seq;
}
function bulHwyView(me) { // a stretch of the 401 near the listener
  let best = null, bd = 1e18; const ex = me ? me.x : 0, ey = me ? me.y : 0;
  for (let e = 0; e < G.cls.length; e += 3) { if (G.cls[e] !== 0) continue; const a = G.ea ? G.ea[e] : -1; if (a < 0) continue; const x = G.nx[a], y = G.ny[a], d = (x - ex) ** 2 + (y - ey) ** 2; if (d < bd) { bd = d; best = { x, y }; } }
  return best || { x: ex, y: ey };
}
function bulBoard(kind) {
  const D = BUL.data || {}, B = $('bulBoard');
  if (kind === 'traffic') { $('bulBH').textContent = '401 · DVP'; $('bulBH2').textContent = 'TRAFFIC';
    const segs = (D.traffic && D.traffic.segs) || [], lines = segs.filter(s => s.cat === 6 || s.cat === 1).slice(0, 4).map(s => `<div class="row"><span>${s.road === 'DVP' ? 'DVP' : '401'} ${s.from} → ${s.to}</span><span>${s.cat === 1 ? 'CRASH' : '+' + Math.max(1, Math.round(s.delay / 60)) + ' min'}</span></div>`).join('');
    $('bulBB').innerHTML = lines || `<div>${(D.traffic && D.traffic.text) || ''}</div>`; }
  else { const w = D.weather || {}, n = w.now || {}; $('bulBH').textContent = 'SCARBOROUGH'; $('bulBH2').textContent = 'WEATHER';
    const hi = w.hi || [], lo = w.lo || [], late = new Date().getHours() >= 15;
    $('bulBB').innerHTML = `<div style="display:flex;align-items:center;gap:16px"><span class="big">${Math.round(n.t)}°</span><span>${(n.cond || '').toUpperCase()}${n.feels != null && Math.abs(n.feels - n.t) >= 3 ? `<br>FEELS LIKE ${Math.round(n.feels)}°` : ''}</span></div>
      ${hi.length ? `<div class="row"><span>${late ? 'TONIGHT' : 'TODAY'}</span><span>${late ? 'LOW ' + Math.round(lo[1] ?? lo[0]) + '°' : 'HIGH ' + Math.round(hi[0]) + '°'}</span></div><div class="row"><span>${late ? 'TOMORROW' : 'TONIGHT'}</span><span>${late ? 'HIGH ' + Math.round(hi[1]) + '°' : 'LOW ' + Math.round(lo[1] ?? lo[0]) + '°'}</span></div>` : ''}${(w.alerts || []).length ? `<div class="row"><span style="color:#e9c46a">${w.alerts[0].toUpperCase()}</span></div>` : ''}`; }
  B.classList.add('show');
}
function bulType(el, txt) { el.textContent = ''; let i = 0; clearInterval(el._t); el._t = setInterval(() => { el.textContent = txt.slice(0, ++i); if (i >= txt.length) clearInterval(el._t); }, 28); }
async function bulRun() {
  const seq = BUL.seq;
  for (const s of seq) {
    if (BUL.stop) break;
    if (s.k === 'card') { $('bulDate').textContent = new Date().toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase(); $('bulCard').classList.add('show'); }
    else if (s.k === 'cardOff') $('bulCard').classList.remove('show');
    else if (s.k === 'jingle') { const d = bulJingle(s.j); await bulWait(d * 1000 * (s.j === 'open' ? 1 : 0.8)); }
    else if (s.k === 'bed') bulBed(s.b);
    else if (s.k === 'cam') { if (s.mark) BUL.marks = [{ x: s.x, y: s.y, t: performance.now() }]; camGoal = { x: s.x, y: s.y, h: s.h }; if (!s.slow) await bulWait(900); }
    else if (s.k === 'ring') BUL.ring = s.on && BUL.me && BUL.me.inside ? BUL.me : null;
    else if (s.k === 'low') { $('bulLK').textContent = s.kick; $('bulLT').textContent = s.title; $('bulLow').classList.add('show'); bulType($('bulLS'), s.sub || ''); $('bulLS').style.display = s.sub ? '' : 'none'; }
    else if (s.k === 'lowOff') { $('bulLow').classList.remove('show'); await bulWait(250); }
    else if (s.k === 'board') bulBoard(s.kind);
    else if (s.k === 'boardOff') $('bulBoard').classList.remove('show');
    else if (s.k === 'say') { await bulSay(s.key, s.text, s.nocap); await bulWait(220); }
  }
  bulEnd();
}
async function bulStart() {
  BUL.on = true; BUL.stop = false; document.body.classList.add('bul'); $('bul').hidden = false; $('bulCap').textContent = ''; const lead = $('bulLead'); lead.hidden = false;
  const N = bulAudio(); if (N) N.hiss.gain.setTargetAtTime(0.012, AC.currentTime, 0.5);
  let n = 3; $('bulN').textContent = n; const tick = setInterval(() => { n = n > 1 ? n - 1 : 3; $('bulN').textContent = n; if (N) bTone(N.mus, AC.currentTime, 1000, 0.08, 0.05); }, 800);
  const sweep = setInterval(() => { const a = ((performance.now() % 800) / 800) * 360; lead.querySelector('.c').style.setProperty('--a', a + 'deg'); }, 30);
  const [data, geo] = await Promise.all([Promise.race([BUL.dataP, bulWait(9000).then(() => null)]), Promise.race([BUL.geoP, bulWait(10000).then(() => null)])]);
  BUL.data = data || { clips: {}, lines: {} };
  if (geo) { const P = G.proj, x = (geo.lng - P.lon0) * P.kx, y = -(geo.lat - P.lat0) * P.ky; BUL.me = { x, y, lat: geo.lat, lng: geo.lng, inside: inMap(x, y) }; } else BUL.me = null;
  BUL.seq = bulBuild(BUL.me);
  $('bulMsg').textContent = 'WARMING UP THE TUBES…';
  const keys = BUL.seq.filter(s => s.k === 'say').map(s => s.key); await Promise.race([Promise.all(keys.slice(0, 14).map(bulLoad)), bulWait(6000)]); keys.forEach(bulLoad);
  clearInterval(tick); clearInterval(sweep); lead.hidden = true;
  if (BUL.me && BUL.me.inside) { cam.x = BUL.me.x; cam.y = BUL.me.y; cam.h = Math.max(cam.h, 6000); }
  BUL.t0 = performance.now(); bulRun();
}
function bulEnd() {
  if (!BUL.on) return; BUL.on = false; BUL.stop = true; for (const s of BUL.srcs) { try { s.stop(); } catch (e) {} } BUL.srcs.clear(); try { speechSynthesis.cancel(); } catch (e) {}
  bulBed(null); if (BUL.nodes) BUL.nodes.hiss.gain.setTargetAtTime(0, AC.currentTime, 0.4);
  document.body.classList.remove('bul'); $('bul').hidden = true; $('bulLow').classList.remove('show'); $('bulBoard').classList.remove('show'); $('bulCard').classList.remove('show'); BUL.marks = []; BUL.ring = null;
  if (BUL.me && BUL.me.inside) camGoal = { x: BUL.me.x, y: BUL.me.y, h: 900 };
  toast('REPORT', BUL.me && BUL.me.inside ? 'That was your report. You\'re on the live map, centred on you.' : 'That was your report. You\'re on the live map.', 'var(--cyan)');
}
$('bulSkip').onclick = () => { snd('ui'); bulEnd(); };
setInterval(() => { if (!BUL.on) return; bulBedTick(); const c = $('bulClk'); if (c) c.textContent = new Date().toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' }).replace('a.m.', 'AM').replace('p.m.', 'PM'); if (performance.now() > BUL.holdT) { BUL.holdT = performance.now() + 1000; try { DIR.hold(15000); } catch (e) {} } }, 100);
function bulSprites(put) {
  if (!BUL.on) return; const now = performance.now();
  if (BUL.ring) { put(BUL.ring.x, BUL.ring.y, 0.5, BUL_R, 11, 0.45, 6, 0); put(BUL.ring.x, BUL.ring.y, 0.6, 40 + 10 * Math.sin(now / 300), 7, 1, 30, 0); }
  for (const m of BUL.marks) put(m.x, m.y, 0.5, 30 + 8 * Math.sin((now - m.t) / 200), 7, 1, 40, 0);
}
