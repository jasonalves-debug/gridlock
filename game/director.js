// ================================================================ DIRECTOR — voices, choppers, camera shots, broadcast, tension
const DIR = (function () {
  const VOICE = (() => { try { return JSON.parse($('voice').textContent); } catch (e) { return { clips: {}, dur: {} }; } })();
  const buffers = {}; let decoding = false, chatIn = null, radioIn = null, anchorIn = null, duck = null, musicBus = null, sfxDuck = null;
  let autoCam = store.get('autocam', true);
  const helis = []; let heliSeq = 1;
  let shot = null, shotQ = [], lastShotEnd = -1e9, savedCam = null, lastUser = 0;
  let pressure = 0, pressureT = 0; const broadcastSeen = new Set(); const stuckSeen = new Set(); const stuckClock = new Map();
  const headlines = []; let crawlX = 0;
  let tv = false, tourSource = null, camNear = null, tvStats = null, heavyOn = false, lastHeavy = 0, pipT = 0, pipCam = null, lastTourKind = '', first = true, lastVo = 0, lastBoard = 0, boardSource = null, chatNext = performance.now() + 30000; const tourSeen = new Map();
  // ---------------------------------------------------------------- audio graph for voices & music
  function audioReady() {
    if (!AC || radioIn) return !!radioIn;
    sfxDuck = AC.createGain(); sfxDuck.gain.value = 1;
    // radio: band-limited, a little gritty, compressed
    radioIn = AC.createGain(); radioIn.gain.value = 1.1;
    const hp = AC.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 420; hp.Q.value = 0.7;
    const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3100; lp.Q.value = 0.9;
    const pk = AC.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 1800; pk.gain.value = 5; pk.Q.value = 1;
    const sh = AC.createWaveShaper(); const cv = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; cv[i] = Math.tanh(x * 2.2) / Math.tanh(2.2) * 0.85; } sh.curve = cv;
    const rc = AC.createDynamicsCompressor(); rc.threshold.value = -24; rc.ratio.value = 6; rc.attack.value = 0.003; rc.release.value = 0.12;
    const rg = AC.createGain(); rg.gain.value = 0.55;
    chatIn = AC.createGain(); chatIn.gain.value = 0.32; const cl = AC.createBiquadFilter(); cl.type = 'lowpass'; cl.frequency.value = 2400; chatIn.connect(cl); cl.connect(radioIn); // background chatter: same radio, further away
    radioIn.connect(hp); hp.connect(pk); pk.connect(lp); lp.connect(sh); sh.connect(rc); rc.connect(rg); rg.connect(master);
    // anchor: clean, gently compressed
    anchorIn = AC.createGain(); anchorIn.gain.value = 1; const ac2 = AC.createDynamicsCompressor(); ac2.threshold.value = -20; ac2.ratio.value = 3; const ag = AC.createGain(); ag.gain.value = 0.62;
    const hs = AC.createBiquadFilter(); hs.type = 'highshelf'; hs.frequency.value = 5000; hs.gain.value = 2;
    anchorIn.connect(hs); hs.connect(ac2); ac2.connect(ag); ag.connect(master);
    musicBus = AC.createGain(); musicBus.gain.value = 0.0; musicBus.connect(master);
    if (!decoding) { decoding = true; decodeAll(); }
    startMusic();
    return true;
  }
  async function decodeAll() {
    const keys = Object.keys(VOICE.clips || {});
    for (let i = 0; i < keys.length; i += 12) {
      await Promise.all(keys.slice(i, i + 12).map(async k => { try { const b = Uint8Array.from(atob(VOICE.clips[k]), c => c.charCodeAt(0)); buffers[k] = await AC.decodeAudioData(b.buffer); } catch (e) {} }));
    }
  }
  // ---------------------------------------------------------------- speech queue
  const speechQ = []; let speaking = false;
  const CAPTION = { 'd:dispatch': 'Dispatch.', 'd:allunits': 'All units,', 'd:41': '41 Division,', 'd:42': '42 Division,', 'd:43': '43 Division,', 'd:opp': 'OPP Highway Safety,', 'd:fire': 'Fire,', 'd:pumper': 'Pumper 221,', 'd:medic': 'Paramedics,', 'd:code3': 'respond code three,', 'd:respond': 'respond,',
    'd:collision': 'motor vehicle collision', 'd:injuries': 'collision with injuries', 'd:vfire': 'vehicle fire', 'd:rollover': 'tractor-trailer rollover', 'd:hwyclosed': 'highway closure', 'd:water': 'water main break', 'd:power': 'power outage, signals are dark', 'd:investigation': 'police investigation, intersection closed', 'd:flood': 'flooded underpass', 'd:blockade': 'residents blocking the roadway', 'd:medical': 'medical emergency',
    'd:on': 'on', 'd:at': 'at', 'd:and': 'and', 'd:wb': 'westbound,', 'd:eb': 'eastbound,', 'd:both': 'both directions,', 'd:tow': 'Tow truck is en route.', 'd:hydro': 'Toronto Hydro crew is en route.', 'd:wcrew': 'Toronto Water crew is en route.', 'd:clear': 'Scene is clear. Roadway reopening.', 'd:heavy': 'Be advised, heavy traffic in the area.', 'd:401closed': 'All units, the 401 is closed.', 'd:officer': 'Officer, take traffic control at', 'd:residents': 'Calls coming in from residents about cut-through traffic.', 'd:emscall': 'Paramedics, respond code three, medical emergency.', 'd:emsdelay': 'Paramedics report delays, traffic is not moving.',
    'u:copy': 'Copy, en route.', 'u:onscene': 'On scene.', 'u:tow': 'On scene, we will need a tow.', 'u:fireon': 'Fire on scene. Knocking it down.', 'u:fireout': 'Fire is out.', 'u:transport': 'Medics transporting to hospital.', 'u:stuck': 'We are stuck in traffic. Nothing is moving.', 'u:closing': 'Setting up a closure. Diverting traffic.', 'u:opp': 'OPP on scene. Highway is shut down.', 'u:gotit': 'Copy. We have got it.', 'u:controlling': 'Directing traffic at the intersection.', 'u:crewdone': 'Crew is done. Clearing the scene.',
    'a:open': 'This is Eastwire News, breaking in Scarborough.', 'a:401': 'We are following breaking news on the 401.', 'a:chopper': 'Our chopper is over the scene right now.', 'a:backed': 'Traffic is backed up for kilometres.', 'a:avoid': 'Police are asking drivers to avoid the area.', 'a:crews': 'Emergency crews are on scene.', 'a:fire': 'Firefighters are battling a vehicle fire.', 'a:hwyboth': 'The highway is closed in both directions.', 'a:sidestreets': 'Drivers are pouring onto side streets.', 'a:residents': 'Residents say they have had enough of cut-through traffic.', 'a:dark': 'Traffic signals are dark across the neighbourhood.', 'a:water': 'A water main break has torn up the road.', 'a:investigation': 'Police have shut down an intersection for an investigation.', 'a:patient': 'Paramedics are rushing a patient to hospital.', 'a:reopen': 'Lanes are reopening, but expect delays.', 'a:stay': 'Stay with Eastwire for updates.', 'a:collision': 'A serious collision is snarling traffic.', 'a:storm': 'A thunderstorm is lashing the east end.', 'a:standstill': 'Scarborough is at a standstill this morning.', 'a:blocked': 'Frustrated residents have blocked their own street.' };
  function captionText(keys) { return keys.map(k => k.startsWith('r:') ? k.slice(2) : CAPTION[k] || (VOICE.cap && VOICE.cap[k]) || (k.startsWith('l:') ? k.slice(2) + ',' : k.startsWith('p:') ? k.slice(2) + ',' : '')).join(' ').replace(/ ,/g, ',').replace(/\s+/g, ' ').trim().replace(/(^|[.?!]\s+)([a-z])/g, (m, a, b) => a + b.toUpperCase()); }
  const lastVar = new Map();
  function pickVar(k) { // a line recorded more than once (key, key~2, key~3...) gets a different take each time
    if (!k || !VOICE.clips[k + '~2']) return k; const opts = [k]; for (let i = 2; VOICE.clips[k + '~' + i]; i++) opts.push(k + '~' + i);
    const prev = lastVar.get(k); let c; do { c = opts[(Math.random() * opts.length) | 0]; } while (c === prev); lastVar.set(k, c); return c; }
  const has = k => !!VOICE.clips[k];
  const voDur = keys => keys.reduce((s, k) => s + ((VOICE.dur && VOICE.dur[k]) || 0.8) + 0.05, 0);
  function say(chain, keys, pri, src) {
    pri = pri == null ? 1 : pri;
    keys = keys.filter(k => k && (VOICE.clips[k] || k.startsWith('r:') === false)).map(pickVar); if (!keys.length) return;
    if (speechQ.length > 5) { const i = speechQ.findIndex(q => q.pri < pri); if (i >= 0) speechQ.splice(i, 1); else return; }
    speechQ.push({ t: performance.now(), chain, keys, pri, src: src || (chain === 'anchor' ? 'EASTWIRE' : chain === 'traffic' ? 'EASTWIRE TRAFFIC' : 'DISPATCH') }); speechQ.sort((a, b) => b.pri - a.pri); pump();
  }
  function pump() {
    if (speaking) return; while (speechQ.length && speechQ[0].pri < 3 && performance.now() - speechQ[0].t > 14000) speechQ.shift(); if (!speechQ.length) return; const item = speechQ.shift();
    if (!AC || muted || !audioReady()) { speechQ.length = 0; return; } // sound off: the ticker already carries the news, so no captions
    speaking = true;
    let t = AC.currentTime + 0.05; const chat = item.chain === 'chatter', radio = item.chain === 'radio' || chat; const dest = chat ? chatIn : radio ? radioIn : anchorIn;
    if (radio) squelch(t, chat); t += radio ? 0.12 : 0;
    for (const k of item.keys) { const b = buffers[k]; if (!b) continue; const s = AC.createBufferSource(); s.buffer = b; s.playbackRate.value = radio ? 1.04 : 1; s.connect(dest); s.start(t); t += b.duration / s.playbackRate.value + (k.startsWith('d:') && /,$/.test(CAPTION[k] || '') ? 0.02 : 0.04); }
    if (radio) squelch(t + 0.02, chat);
    if (!radio && musicBus) { musicBus.gain.setTargetAtTime(0.25 * musicLevel(), AC.currentTime, 0.2); }
    const ms = (t - AC.currentTime) * 1000 + 350; if (!chat) caption(item.src, captionText(item.keys), !radio, ms);
    setTimeout(() => { speaking = false; if (!radio && musicBus) musicBus.gain.setTargetAtTime(musicLevel(), AC.currentTime, 0.6); pump(); }, ms);
  }
  function squelch(t, quiet) { if (!AC) return; const q = quiet ? 0.3 : 1; const s = AC.createBufferSource(); s.buffer = noiseB; const f = AC.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 1.2; const g = AC.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.09 * q, t + 0.005); g.gain.exponentialRampToValueAtTime(0.001, t + 0.09); s.connect(f); f.connect(g); g.connect(master); s.start(t, Math.random()); s.stop(t + 0.12); const o = AC.createOscillator(); o.frequency.value = 1450; const og = AC.createGain(); og.gain.setValueAtTime(0.02 * q, t); og.gain.exponentialRampToValueAtTime(0.0005, t + 0.05); o.connect(og); og.connect(master); o.start(t); o.stop(t + 0.06); }
  const NSUF = /\b(road|rd|avenue|ave|av|street|st|drive|dr|boulevard|blvd|crescent|cres|court|crt|ct|place|pl|lane|ln|way|parkway|pkwy|trail|trl|square|sq|gardens|gdns|circle|cir|terrace|gate|heights|east|e|west|w|north|n|south|s|the)\b/g;
  const nk = t => (t || '').toLowerCase().replace(/[.'’]/g, '').replace(NSUF, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const RK = new Map(); for (const k of Object.keys(VOICE.clips)) if (k.startsWith('r:')) { const q = nk(k.slice(2)); if (q && !RK.has(q)) RK.set(q, k); }
  const rk = n => !n ? null : VOICE.clips['r:' + n] ? 'r:' + n : RK.get(nk(n)) || null;
  function division(x, y) { let best = null, bd = 1e18; for (const d of G.depots) { if (d.k !== 'police') continue; const dd = (d.x - x) ** 2 + (d.y - y) ** 2; if (dd < bd) { bd = dd; best = d; } } return best ? 'd:' + best.n.slice(0, 2) : 'd:dispatch'; }
  function crossKeys(name) { const parts = (name || '').split(/ & | - /); if (parts.length === 2 && rk(parts[0]) && rk(parts[1])) return ['d:at', rk(parts[0]), 'd:and', rk(parts[1])]; return rk(parts[0]) ? ['d:on', rk(parts[0])] : []; }
  // ---------------------------------------------------------------- broadcast / headlines
  function headline(t) { const now = Date.now(); if (headlines.some(h => h.x === t && now - h.t < 1800000)) return; headlines.unshift({ x: t, t: now }); if (headlines.length > 8) headlines.pop(); $('bcCrawl').textContent = headlines.map(h => h.x).join('   ●   '); }
  const ago = ms => { const m = Math.round(ms / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : Math.floor(m / 60) + ' h ago'; };
  function tickerText() { const now = Date.now(); const hs = headlines.filter(h => now - h.t < 10800000).slice(0, 6).map(h => `${h.x} · ${ago(now - h.t)}`); return [...hs, ...(tvStats ? tvStats() : [])].join('   ●   ') || 'EASTWIRE · SCARBOROUGH LIVE'; }
  // ---------------------------------------------------------------- picture-in-picture: the nearest real traffic camera
  function pipShow(s) { const el = $('bcPip'); if (!el) return; pipCam = null; if (camNear && !s.nopip && s.type !== 'follow' && s.type !== 'wide' && s.x != null) pipCam = camNear(s.x, s.y); if (!pipCam) { el.hidden = true; return; }
    const img = $('bcPipImg'); el.hidden = true; img.onerror = () => { el.hidden = true; }; img.onload = () => { el.hidden = false; }; img.src = pipCam.url; $('bcPipTag').textContent = 'CAM · ' + pipCam.name.toUpperCase(); pipT = performance.now(); }
  // ---------------------------------------------------------------- idle tour (TV mode): weighted pick of things worth looking at right now
  function pickTour() {
    if (!tourSource) return null; const list = tourSource(); if (!list.length) return null; const now = performance.now();
    const w = list.map(c => { const age = now - (tourSeen.get(c.key) || -1e9); return c.w * (age < 300000 ? 0.04 : age < 900000 ? 0.35 : 1) * (c.kind === lastTourKind ? 0.45 : 1); });
    let r = Math.random() * w.reduce((a, b) => a + b, 0), i = 0; while (i < w.length - 1 && (r -= w[i]) > 0) i++;
    const c = list[i]; tourSeen.set(c.key, now); lastTourKind = c.kind; return c; }
  function lowerThird(title, sub, kick) { $('bcTitle').textContent = title; $('bcSub').textContent = sub; const kk = $('bcKick'); kk.textContent = kick || ''; kk.hidden = !kick; const lt = $('bcTitle'), ls = $('bcSub'); [kk, lt, ls].forEach(el => { el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; }); }
  function incTitle(i) {
    if (i.type === 'hwy' && i.real && i.desc) { // Ontario 511's own words: "Disabled Vehicle on HWY 401 Eastbound EXPRESS at PORT UNION ROAD, Toronto. Left lane closed."
      const d = i.desc, what = (d.split(/ on HWY/i)[0] || i.real.label || 'Incident').trim(), where = (/ at ([^,.]+)/i.exec(d) || [])[1], rest = d.split(/\.\s+/).slice(1).join('. ').replace(/\.$/, '');
      return [`401 ${what.toUpperCase()} · ${(i.dir || '').toUpperCase()}`, `${where ? 'At ' + where.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) + ' · ' : ''}${rest || 'Ontario 511'}`]; }
    if (i.type === 'hwy') return [i.crash ? `401 CRASH · ${(i.dir || '').toUpperCase()}` : `401 CLOSED · ${(i.dir || '').toUpperCase()}`, `${i.at ? 'At ' + i.at + ' · ' : ''}${i.crash ? 'Tractor-trailer rollover, OPP on scene' : 'OPP holding traffic at the ramps'}`];
    if (i.type === 'call') return [`${(i.label || 'Police call').toUpperCase()}`, `${i.name || ''}${i.real ? ' · Real call' : ''}`];
    if (i.type === 'hwy' && i.real) return [`HIGHWAY ${(i.real.label || 'INCIDENT').toUpperCase()}`, `${i.real.loc || ''} · Ontario 511`];
    const m = INC[i.type]; return [`${m.name.toUpperCase()} · ${(i.name || '').toUpperCase()}`, ({ collision: i.fire ? 'Vehicle on fire, crews responding' : 'Lanes blocked, crews responding', power: 'Signals dark, intersections running as all-way stops', water: 'Road torn up and closed both ways', closure: 'Police investigation, intersection shut', flood: 'Underpass under water', barricade: 'Residents block their own street', roadclosed: 'Road closed' })[i.type] || ''];
  }
  // ---------------------------------------------------------------- helicopters
  function spawnHeli(kind, inc) {
    if (helis.filter(h => h.kind === kind && h.phase !== 'out').length >= (kind === 'news' ? 2 : 1)) { const h = helis.find(h => h.kind === kind && h.phase !== 'out'); if (h && inc) { h.inc = inc.id; h.tx = inc.x; h.ty = inc.y; h.phase = 'in'; } return h; }
    const from = kind === 'news' ? { x: inc.x - 2600, y: inc.y + 900 } : { x: inc.x + 700, y: inc.y - 2400 };
    const h = { id: heliSeq++, kind, inc: inc.id, x: from.x, y: from.y, z: kind === 'news' ? 320 : 260, hd: 0, v: 0, tx: inc.x, ty: inc.y, phase: 'in', ang: Math.random() * 6.28, R: kind === 'news' ? 300 : 220, light: 0 };
    helis.push(h); return h;
  }
  function stepHelis(dt) {
    const k = Math.min(speed || 0, 5) || 0.2; const live = new Map(incidents.filter(i => i.state !== 'cleared').map(i => [i.id, i]));
    for (let n = helis.length - 1; n >= 0; n--) {
      const h = helis[n]; const inc = live.get(h.inc); h.age = (h.age || 0) + dt; if (inc) h.seen = true;
      if (!inc && h.phase !== 'out' && (h.seen || h.age > 20)) { const other = incidents.filter(i => i.state !== 'cleared' && (i.type === 'hwy' || (i.type === 'collision' && i.sev >= 1) || i.type === 'closure')).sort((a, b) => b.start - a.start)[0]; if (other && h.kind === 'news') { h.inc = other.id; h.tx = other.x; h.ty = other.y; } else { h.phase = 'out'; h.tx = h.kind === 'news' ? bbox[0] - 6000 : h.x; h.ty = h.kind === 'news' ? h.y : bbox[1] - 6000; } }
      let gx = h.tx, gy = h.ty;
      if (h.phase === 'orbit') { h.ang += dt * k * (34 / h.R); gx = h.tx + Math.cos(h.ang) * h.R; gy = h.ty + Math.sin(h.ang) * h.R; }
      const dx = gx - h.x, dy = gy - h.y, d = Math.hypot(dx, dy);
      if (h.phase === 'in' && d < h.R + 40) { h.phase = 'orbit'; h.ang = Math.atan2(h.y - h.ty, h.x - h.tx); if (h.kind === 'news' && !broadcastSeen.has('chop' + h.inc)) { broadcastSeen.add('chop' + h.inc); const ci = incidents.find(q => q.id === h.inc); if (ci && bigInc(ci)) { say('anchor', ['a:chopper', ci.type === 'hwy' ? 'a:backed' : 'a:avoid'], 2); requestShot({ type: 'chopper', chain: true, heli: h.id, inc: ci.id, x: ci.x, y: ci.y, dur: 9, pri: 2, title: 'EASTWIRE CHOPPER 6 · LIVE', sub: incTitle(ci)[0].replace(' · ', ' · ') }); } } }
      const vmax = h.phase === 'orbit' ? 34 : 62; const want = Math.min(vmax, d * 0.6);
      const ux = d > 0.1 ? dx / d : 0, uy = d > 0.1 ? dy / d : 0;
      h.v += (want - h.v) * Math.min(1, dt * k * 0.8); h.x += ux * h.v * dt * k; h.y += uy * h.v * dt * k;
      const tgtHd = h.phase === 'orbit' ? Math.atan2(h.ty - h.y, h.tx - h.x) * 0.3 + Math.atan2(uy, ux) * 0.7 : Math.atan2(uy, ux);
      let dh = tgtHd - h.hd; while (dh > Math.PI) dh -= 6.283; while (dh < -Math.PI) dh += 6.283; h.hd += dh * Math.min(1, dt * 2.5);
      h.light += ((h.phase === 'orbit' && envNight() > 0.3 ? 1 : 0) - h.light) * Math.min(1, dt * 2);
      if (h.phase === 'out' && d < 200) helis.splice(n, 1);
    }
  }
  function heliSprites(put, pass) {
    const t = performance.now() / 1000;
    for (const h of helis) {
      if (pass === 'shadow') { const n = envNight(); const sx = h.x + h.z * 0.35, sy = h.y + h.z * 0.22; put(sx, sy, 0.4, 8, 15, 1 - n * 0.8, 3, -h.hd); continue; }
      if (pass === 'body') { put(h.x, h.y, h.z, 7, 13, h.kind === 'police' ? 1 : 0, 6, -h.hd); put(h.x + Math.cos(h.hd) * 0.5, h.y + Math.sin(h.hd) * 0.5, h.z + 1.5, 6.8, 14, 1, 6, 0); continue; }
      if (pass === 'add') {
        const blink = (t * 1.3 + h.id * 0.37) % 1 < 0.12 ? 1 : 0; put(h.x, h.y, h.z + 2, 1.6, 17, blink * 1.5 + 0.2, 3, 0);
        if (h.light > 0.02) { const wob = Math.sin(t * 0.7 + h.id) * 18, wob2 = Math.cos(t * 0.5 + h.id) * 18; const gx = h.tx + wob, gy = h.ty + wob2;
          put(gx, gy, 0.6, 26, 16, h.light, 14, 0);
          for (let s = 1; s < 10; s++) { const f = s / 10; put(h.x + (gx - h.x) * f, h.y + (gy - h.y) * f, h.z * (1 - f), 3 + f * 8, 18, h.light, 3, 0); } }
      }
    }
  }
  // ---------------------------------------------------------------- camera shots
  function requestShot(s) { if (!autoCam || ended) return; s.pri = s.pri || 1; shotQ = shotQ.filter(q => q.pri >= s.pri - 1); shotQ.push(s); shotQ.sort((a, b) => b.pri - a.pri); }
  function startShot(s) {
    if (!savedCam) savedCam = { x: cam.x, y: cam.y, h: cam.h, pitch: cam.pitch, yaw: cam.yaw || 0, tilt: tiltGoal };
    shot = Object.assign({ t: 0, yaw: (cam.yaw || 0) }, s); camGoal = null; document.body.classList.add('cine'); $('bcast').hidden = false;
    const kick = s.kick || (s.sting ? 'BREAKING NEWS' : s.tour ? '' : 'LIVE'); $('bcast').classList.toggle('brk', !!s.sting); $('bcast').classList.toggle('board', !!s.board);
    if (s.title) lowerThird(s.title, s.sub || '', kick); pipShow(s); $('tvboard').classList.toggle('on', !!s.board);
    if (tv && s.x != null && s.type !== 'follow' && s.type !== 'chopper') { if (Math.hypot(s.x - cam.x, s.y - cam.y) > 2500) dipCut(s); else whoosh(0.025); }
    if (s.anchor && !broadcastSeen.has(s.anchorKey)) { broadcastSeen.add(s.anchorKey); say('anchor', s.anchor, 3); }
    if (AC && !muted && s.sting) sting();
  }
  function cineOff() { document.body.classList.remove('cine'); $('bcast').hidden = true; $('bcPip').hidden = true; pipCam = null; $('tvboard').classList.remove('on'); }
  // TV cut: a long move dips to black and lands near the next shot, the way a broadcast cuts between cameras
  function dipCut(s) { const el = $('dip'), mine = shot; el.classList.add('on'); whoosh(0.06);
    setTimeout(() => { if (shot === mine) { cam.x = s.x; cam.y = s.y; cam.h = (s.type === 'wide' ? 6500 : s.h || 420) * 1.3; cam.pitch = s.pitch || (s.type === 'wide' ? 0.8 : 0.95); tiltGoal = cam.pitch; } el.classList.remove('on'); }, 300); }
  function whoosh(g) { if (!AC || muted || !noiseB) return; const t = AC.currentTime, s = AC.createBufferSource(); s.buffer = noiseB; const f = AC.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.4; f.frequency.setValueAtTime(350, t); f.frequency.exponentialRampToValueAtTime(3200, t + 0.32); f.frequency.exponentialRampToValueAtTime(900, t + 0.6);
    const a = AC.createGain(); a.gain.setValueAtTime(0.0001, t); a.gain.exponentialRampToValueAtTime(g, t + 0.3); a.gain.exponentialRampToValueAtTime(0.0001, t + 0.62); const p = AC.createStereoPanner(); p.pan.setValueAtTime(-0.6, t); p.pan.linearRampToValueAtTime(0.6, t + 0.6);
    s.connect(f); f.connect(a); a.connect(p); p.connect(master); s.start(t, Math.random()); s.stop(t + 0.7); }
  function endShot(byUser) {
    if (!shot) return; shot = null; lastShotEnd = performance.now(); cineOff();
    if (savedCam) { if (!tv) { camGoal = { x: savedCam.x, y: savedCam.y, h: savedCam.h }; tiltGoal = savedCam.tilt; yawGoal = savedCam.yaw; } savedCam = null; } // TV mode keeps flying on from wherever the last shot ended
    if (byUser) { lastUser = performance.now(); shotQ = []; }
  }
  let yawGoal = 0;
  function findUnit(id) { for (let i = 0; i < frameN; i++) { const f = posBuf[i * 4 + 3] | 0; if (((f >> 14) & 1) && ((f >> 15) & 255) === (id & 255)) return [posBuf[i * 4], posBuf[i * 4 + 1], posBuf[i * 4 + 2]]; } return null; }
  function followYaw(a) { const gx = Math.cos(a), gy = -Math.sin(a); return Math.atan2(-gx, gy); }
  function stepShot(dt) {
    const now = performance.now();
    if (tv && autoCam && ready && !ended && now - lastUser > 20000) {
      if (shot && shot.tour && shotQ.length && shotQ[0].pri >= 2 && shot.t > 5) { const nx = shotQ.shift(); shot = null; startShot(nx); } // a real incident cuts into the tour
      else if (!shot && !shotQ.length && boardSource && now - lastBoard > 480000) { const b = boardSource(); lastBoard = now; // traffic & weather, every 8 minutes
        if (b) { startShot({ type: 'wide', x: b.x, y: b.y, dur: Math.max(14, voDur(b.vo) + 3), pri: 1, tour: true, board: true, nopip: true, title: 'EASTWIRE TRAFFIC & WEATHER', sub: b.sub, kick: 'TRAFFIC & WEATHER' }); $('tvboard').innerHTML = b.html; say('traffic', b.vo, 2); lastVo = now; } }
      else if (!shot && !shotQ.length) { const c = pickTour(); if (c) { startShot(Object.assign({ tour: true, pri: 0 }, c.shot, { title: c.title, sub: c.sub, kick: c.kick }));
        if (c.vo && now - lastVo > 25000 && !speaking && Math.random() < 0.6) { say(c.chain || 'anchor', c.vo, 1); lastVo = now; } } }
    }
    if (!shot && !shotQ.length && document.body.classList.contains('cine')) cineOff();
    if (!shot && shotQ.length && now - lastShotEnd > (shotQ[0].pri >= 3 || shotQ[0].chain ? 1200 : mode === 'watch' ? 4000 : 22000) && now - lastUser > 6000 && ready) startShot(shotQ.shift());
    if (!shot) { cam.yaw = (cam.yaw || 0) + (((yawGoal - (cam.yaw || 0) + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * Math.min(1, dt * 3); if (Math.abs(yawGoal) < 0.001 && Math.abs(cam.yaw) < 0.001) cam.yaw = 0; return; }
    shot.t += dt; const k = 1 - Math.exp(-dt * 1.6);
    let tx = shot.x, ty = shot.y, th = shot.h || 420, tp = shot.pitch || 0.95, tyaw = cam.yaw;
    if (shot.type === 'follow') { const u = findUnit(shot.unit); if (u) { tx = u[0] + Math.cos(u[2]) * 25; ty = u[1] + Math.sin(u[2]) * 25; tyaw = followYaw(u[2]); shot.lastU = u; } else if (shot.lastU) { tx = shot.lastU[0]; ty = shot.lastU[1]; } th = 230; tp = 1.08; }
    else if (shot.type === 'chopper') { const h = helis.find(q => q.id === shot.heli); if (h) { const mx = h.tx * 0.7 + h.x * 0.3, my = h.ty * 0.7 + h.y * 0.3; tx = mx; ty = my; tyaw = followYaw(Math.atan2(h.ty - h.y, h.tx - h.x)); } th = 360; tp = 1.0; }
    else { tyaw = shot.yaw + shot.t * (shot.spin || 0.1); if (shot.x1 != null) { const f = Math.min(1, shot.t / (shot.dur || 9)), e = f * f * (3 - 2 * f); tx = shot.x + (shot.x1 - shot.x) * e; ty = shot.y + (shot.y1 - shot.y) * e; } if (shot.track) { let sx = shot.x, sy = shot.y, n = 1; for (const u of units) if (u.inc === shot.track && u.state === 'onscene' && Math.hypot(u.x - shot.x, u.y - shot.y) < 700) { sx += u.x; sy += u.y; n++; } tx = sx / n; ty = sy / n; } }
    if (shot.type === 'wide') { th = 6500; tp = 0.8; }
    cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k; cam.h *= Math.pow(th / cam.h, k); cam.pitch += (tp - cam.pitch) * k; tiltGoal = cam.pitch;
    let dy = tyaw - (cam.yaw || 0); while (dy > Math.PI) dy -= 6.283; while (dy < -Math.PI) dy += 6.283; cam.yaw = (cam.yaw || 0) + dy * Math.min(1, dt * (shot.type === 'follow' ? 2.2 : 1.2));
    $('bcClock').textContent = clock(simT, true);
    if (shot.t > (shot.dur || 9)) { const next = shot.then; if (tv && shot.tour && !next) { shot = null; return; } endShot(false); if (next) { lastShotEnd = -1e9; startShot(next); } }
  }
  // ---------------------------------------------------------------- music (tension bed)
  let mNext = 0, mStep = 0; const BPM = 96, S16 = 60 / BPM / 4;
  function musicLevel() { return 0.5 + pressure * 0.5; }
  function startMusic() { const t = AC.currentTime; musicBus.gain.setValueAtTime(0, t); musicBus.gain.linearRampToValueAtTime(musicLevel(), t + 4);
    // drone pair through a slow filter
    const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 260; f.Q.value = 0.6; const dg = AC.createGain(); dg.gain.value = 0.0; f.connect(dg); dg.connect(musicBus);
    [55, 55.4, 82.4].forEach(fr => { const o = AC.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr; const g = AC.createGain(); g.gain.value = 0.05; o.connect(g); g.connect(f); o.start(); });
    const lfo = AC.createOscillator(); lfo.frequency.value = 0.07; const lg = AC.createGain(); lg.gain.value = 120; lfo.connect(lg); lg.connect(f.frequency); lfo.start();
    musicBus._drone = dg; musicBus._filter = f; mNext = AC.currentTime + 0.2; }
  function musicTick() {
    if (!AC || !musicBus || muted) return; const p = pressure; const t0 = AC.currentTime;
    musicBus._drone.gain.setTargetAtTime((tv ? 0.1 : 0.25) + p * 0.55, t0, 1.5); musicBus._filter.frequency.setTargetAtTime(220 + p * 500, t0, 1.5);
    if (mNext < t0) mNext = t0 + 0.02; // stalled: rejoin the grid
    while (mNext < t0 + 0.2) { const t = mNext, st = mStep % 16;
      if (p > 0.25 && st % 4 === 0) { const o = AC.createOscillator(); o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.18); const g = AC.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.16 * Math.min(1, (p - 0.25) * 3), t + 0.005); g.gain.exponentialRampToValueAtTime(0.0008, t + 0.25); o.connect(g); g.connect(musicBus); o.start(t); o.stop(t + 0.3); }
      if (p > 0.45 && (st % 2 === 1)) { const s = AC.createBufferSource(); s.buffer = noiseB; const hf = AC.createBiquadFilter(); hf.type = 'highpass'; hf.frequency.value = 7000; const g = AC.createGain(); const lv = 0.035 * Math.min(1, (p - 0.45) * 3) * (st % 4 === 3 ? 1 : 0.6); g.gain.setValueAtTime(lv, t); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.04); s.connect(hf); hf.connect(g); g.connect(musicBus); s.start(t, Math.random()); s.stop(t + 0.05); }
      if (p > 0.65 && (st === 6 || st === 14)) { const o = AC.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(st === 6 ? 196 : 174.6, t); o.frequency.exponentialRampToValueAtTime(98, t + 0.3); const g = AC.createGain(); g.gain.setValueAtTime(0.07 * Math.min(1, (p - 0.65) * 3), t); g.gain.exponentialRampToValueAtTime(0.0008, t + 0.35); o.connect(g); g.connect(musicBus); o.start(t); o.stop(t + 0.4); }
      if (p > 0.55 && st === 0 && (mStep >> 4) % 2 === 0) { [220, 261.6, 329.6].forEach(fr => { const o = AC.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr * 0.5; const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(200, t + 1.2); const g = AC.createGain(); g.gain.setValueAtTime(0.025 * Math.min(1, (p - 0.55) * 3), t); g.gain.exponentialRampToValueAtTime(0.0008, t + 1.3); o.connect(lp); lp.connect(g); g.connect(musicBus); o.start(t); o.stop(t + 1.4); }); }
      if (tv) { // TV underscore: slow pad chords, soft bass pulse, ticking hats, a bell figure. Sits under the voices (ducked).
        if (st === 0 && (mStep >> 4) % 2 === 0) pad(t, CH[(chordI++) % CH.length], S16 * 32);
        const ch = CH[(chordI + CH.length - 1) % CH.length];
        if (st === 0 || st === 8) tvTone(t, ch[0] / 2, 0.5, 'sine', 0.05);
        if (st % 2 === 0) tvHat(t, st % 4 === 2 ? 0.012 : 0.005);
        if ((st === 0 || st === 6 || st === 10) && (mStep >> 4) % 2 === 1) tvTone(t, ch[(st / 4 | 0) % ch.length] * 2, 1.4, 'sine', 0.014);
      }
      mNext += S16; mStep++; }
  }
  const CH = [[220, 261.63, 329.63, 392], [174.61, 220, 261.63, 329.63], [130.81, 196, 246.94, 329.63], [196, 246.94, 293.66, 392]]; let chordI = 0;
  function tvTone(t, f, d, type, g) { const o = AC.createOscillator(); o.type = type; o.frequency.value = f; const a = AC.createGain(); a.gain.setValueAtTime(0, t); a.gain.linearRampToValueAtTime(g, t + 0.006); a.gain.exponentialRampToValueAtTime(0.0005, t + d); o.connect(a); a.connect(musicBus); o.start(t); o.stop(t + d + 0.05); }
  function tvHat(t, g) { const s = AC.createBufferSource(); s.buffer = noiseB; const f = AC.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 8500; const a = AC.createGain(); a.gain.setValueAtTime(g, t); a.gain.exponentialRampToValueAtTime(0.0003, t + 0.035); s.connect(f); f.connect(a); a.connect(musicBus); s.start(t, Math.random()); s.stop(t + 0.05); }
  function pad(t, notes, d) { const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.6; lp.frequency.setValueAtTime(500, t); lp.frequency.linearRampToValueAtTime(1100, t + d * 0.5); lp.frequency.linearRampToValueAtTime(600, t + d);
    const a = AC.createGain(); a.gain.setValueAtTime(0, t); a.gain.linearRampToValueAtTime(1, t + 1.6); a.gain.setValueAtTime(1, t + d - 1.4); a.gain.linearRampToValueAtTime(0, t + d + 0.3); lp.connect(a); a.connect(musicBus);
    for (const f of notes) for (const det of [-6, 6]) { const o = AC.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det; const g = AC.createGain(); g.gain.value = 0.007; o.connect(g); g.connect(lp); o.start(t); o.stop(t + d + 0.4); } }
  function sting() { if (tv) return newsHit(); const t = AC.currentTime; const s = AC.createBufferSource(); s.buffer = noiseB; const f = AC.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 3; f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(5000, t + 0.9); const g = AC.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.12, t + 0.85); g.gain.linearRampToValueAtTime(0, t + 0.95); s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + 1);
    const o = AC.createOscillator(); o.frequency.setValueAtTime(110, t + 0.9); o.frequency.exponentialRampToValueAtTime(40, t + 1.8); const og = AC.createGain(); og.gain.setValueAtTime(0.4, t + 0.9); og.gain.exponentialRampToValueAtTime(0.001, t + 2); o.connect(og); og.connect(master); o.start(t + 0.9); o.stop(t + 2.1);
    [523.3, 659.3, 784].forEach((fr, i) => { const q = AC.createOscillator(); q.type = 'square'; q.frequency.value = fr; const qg = AC.createGain(); qg.gain.setValueAtTime(0.0, t + 0.9 + i * 0.09); qg.gain.linearRampToValueAtTime(0.03, t + 0.91 + i * 0.09); qg.gain.exponentialRampToValueAtTime(0.0008, t + 1.25 + i * 0.09); const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2500; q.connect(lp); lp.connect(qg); qg.connect(master); q.start(t + 0.9 + i * 0.09); q.stop(t + 1.4 + i * 0.09); }); }
  function newsHit() { // breaking-news sounder: riser, boom, brass stab, three bells
    const t = AC.currentTime, s = AC.createBufferSource(); s.buffer = noiseB; const f = AC.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2; f.frequency.setValueAtTime(250, t); f.frequency.exponentialRampToValueAtTime(6000, t + 0.85); const g = AC.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.1, t + 0.82); g.gain.linearRampToValueAtTime(0, t + 0.9); s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + 1);
    const h = t + 0.88, o = AC.createOscillator(); o.frequency.setValueAtTime(120, h); o.frequency.exponentialRampToValueAtTime(38, h + 0.9); const og = AC.createGain(); og.gain.setValueAtTime(0.45, h); og.gain.exponentialRampToValueAtTime(0.001, h + 1.1); o.connect(og); og.connect(master); o.start(h); o.stop(h + 1.2);
    const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(3400, h); lp.frequency.exponentialRampToValueAtTime(600, h + 0.7); const bg = AC.createGain(); bg.gain.setValueAtTime(0.0001, h); bg.gain.exponentialRampToValueAtTime(1, h + 0.02); bg.gain.exponentialRampToValueAtTime(0.001, h + 0.9); lp.connect(bg); bg.connect(master);
    for (const fr of [220, 277.18, 329.63, 440]) for (const det of [-8, 8]) { const q = AC.createOscillator(); q.type = 'sawtooth'; q.frequency.value = fr; q.detune.value = det; const qg = AC.createGain(); qg.gain.value = 0.022; q.connect(qg); qg.connect(lp); q.start(h); q.stop(h + 1); }
    [1318.5, 1568, 2093].forEach((fr, i) => { const b = AC.createOscillator(); b.frequency.value = fr; const a = AC.createGain(), tt = h + 0.35 + i * 0.16; a.gain.setValueAtTime(0, tt); a.gain.linearRampToValueAtTime(0.045, tt + 0.004); a.gain.exponentialRampToValueAtTime(0.0005, tt + 0.9); b.connect(a); a.connect(master); b.start(tt); b.stop(tt + 1); }); }
  // rotor sound
  let rotor = null;
  function rotorFrame() {
    if (!AC || muted) return; if (!rotor) { const s = AC.createBufferSource(); s.buffer = noiseB; s.loop = true; const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; const am = AC.createGain(); am.gain.value = 0; const lfo = AC.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 17; const lfg = AC.createGain(); lfg.gain.value = 0.5; const base = AC.createConstantSource(); base.offset.value = 0.5; lfo.connect(lfg); lfg.connect(am.gain); base.connect(am.gain); const out = AC.createGain(); out.gain.value = 0; const pan = AC.createStereoPanner(); s.connect(lp); lp.connect(am); am.connect(out); out.connect(pan); pan.connect(master); s.start(); lfo.start(); base.start(); rotor = { out, pan }; }
    let best = 0, pan = 0; for (const h of helis) { const p = R.project(h.x, h.y, h.z); if (!p) continue; const dx = (p[0] - innerWidth / 2) / innerWidth, dy = (p[1] - innerHeight / 2) / innerHeight; const dist = Math.hypot(dx, dy); const zoomK = Math.max(0, Math.min(1, 2.2 - Math.log10(Math.max(1, cam.wpp)) * 1.2)); const v = Math.max(0, 1 - dist * 1.3) * zoomK; if (v > best) { best = v; pan = Math.max(-1, Math.min(1, dx * 1.6)); } }
    rotor.out.gain.setTargetAtTime(best * 0.13, AC.currentTime, 0.3); rotor.pan.pan.setTargetAtTime(pan, AC.currentTime, 0.3);
  }
  // ---------------------------------------------------------------- events
  const bigInc = i => (i.type === 'call' && (i.act === 'police_crit' || i.act === 'fire_struct' || i.act === 'gas')) || i.type === 'hwy' || (i.type === 'collision' && (i.sev >= 1 || i.fire)) || i.type === 'closure' || i.type === 'water' || i.type === 'power';
  const NOT_NEWS = new Set(['shuttle', 'detours', 'hazards', 'holiday', 'noschool', 'schools', 'worship', 'rain', 'gate']);
  function onEvent(e) {
    const i = e.inc;
    if (LV.kind === 'live' && NOT_NEWS.has(e.k)) return; // Live news: police, fire and ambulance only
    switch (e.k) {
      case 'incident': {
        if (i.type === 'roadclosed' || !isNews(i)) break;
        const [title, sub] = incTitle(i); headline(title.replace(' · ', ': '));
        if (i.type === 'hwy' && i.real) { const full = !(i.nlanes > 0); say('radio', ['d:opp', i.crash ? 'd:code3' : 'd:respond', i.crash ? 'd:collision' : full ? 'd:hwyclosed' : 'd:heavy', ...crossKeys(i.at || '')], 2); if (full || i.crash) { spawnHeli('news', i); requestShot({ type: 'orbit', track: i.id, x: i.x, y: i.y, h: 520, pitch: 0.95, dur: 7, pri: 3, title, sub, anchor: ['a:open', 'a:hwyreal'], anchorKey: 'hwy' + i.id, sting: !!i.crash }); } }
        else if (i.type === 'hwy') { say('radio', ['d:opp', 'd:code3', i.crash ? 'd:rollover' : 'd:hwyclosed', i.both ? 'd:both' : i.dir === 'westbound' ? 'd:wb' : i.dir === 'eastbound' ? 'd:eb' : null, rk(i.at) ? 'd:at' : null, rk(i.at)], 3);
          spawnHeli('police', i); setTimeout(() => spawnHeli('news', i), 4000);
          requestShot({ type: 'orbit', track: i.id, x: i.x, y: i.y, h: 520, pitch: 0.95, dur: 6, pri: 3, title, sub, anchor: ['a:open', 'a:401', i.both ? 'a:hwyboth' : 'a:collision'], anchorKey: 'hwy' + i.id, sting: true }); }
        else if (i.type === 'collision') { const road = rk(i.name); say('radio', [division(i.x, i.y), 'd:code3', i.fire ? 'd:vfire' : i.sev >= 1 ? 'd:injuries' : 'd:collision', road ? 'd:on' : null, road], 2);
          if (i.sev >= 1 || i.fire) { spawnHeli('news', i); requestShot({ type: 'orbit', x: i.x, y: i.y, dur: 8, pri: 2, title, sub, anchor: ['a:open', i.fire ? 'a:fire' : 'a:collision'], anchorKey: 'col' + i.id, sting: true }); } }
        else if (i.type === 'power') { say('radio', ['d:dispatch', 'd:power', ...crossKeys(i.name)], 2); spawnHeli('news', i); requestShot({ type: 'wide', x: i.x, y: i.y, h: 3000, pitch: 0.7, dur: 7, pri: 2, title, sub, anchor: ['a:open', 'a:dark'], anchorKey: 'pw' + i.id }); }
        else if (i.type === 'water') { const road = rk(i.name); say('radio', ['d:dispatch', 'd:water', road ? 'd:on' : null, road], 2); requestShot({ type: 'orbit', x: i.x, y: i.y, h: 300, dur: 7, pri: 2, title, sub, anchor: ['a:water'], anchorKey: 'wm' + i.id }); }
        else if (i.type === 'closure') { say('radio', ['d:allunits', 'd:investigation', ...crossKeys(i.name)], 2); spawnHeli('news', i); requestShot({ type: 'orbit', x: i.x, y: i.y, h: 380, dur: 8, pri: 2, title, sub, anchor: ['a:open', 'a:investigation', 'a:avoid'], anchorKey: 'cl' + i.id, sting: true }); }
        else if (i.type === 'call') { const big = i.act === 'police_crit' || i.act === 'fire_struct' || i.act === 'gas'; const lab = 'l:' + (i.label || 'Police incident');
          const head = i.src === 'tfs' ? ['d:respfire', ...((i.real && i.real.units) || []).slice(0, 2).map(u => 'p:' + u).filter(k => VOICE.clips[k])] : [division(i.x, i.y), i.act === 'police_low' || i.act === 'missing' ? 'd:routine' : 'd:priority'];
          say('radio', [...head, lab, ...crossKeys(i.name)], big ? 3 : 1, i.src === 'tfs' ? 'FIRE DISPATCH' : 'DISPATCH');
          if (big) { spawnHeli('news', i); requestShot({ type: 'orbit', x: i.x, y: i.y, h: 380, dur: 8, pri: 2, title, sub, anchor: ['a:open', i.act === 'police_crit' ? 'a:policeop' : i.act === 'gas' ? 'a:gas' : 'a:firescene', 'a:avoid'], anchorKey: 'call' + i.id, sting: true }); } }
        else if (i.type === 'flood') { const road = rk(i.name); say('radio', ['d:dispatch', 'd:flood', road ? 'd:on' : null, road], 1); }
        break; }
      case 'respDispatched': if (e.first && i && bigInc(i)) { say('radio', ['u:copy'], 2, e.kind === 'opp' ? 'OPP' : e.kind === 'fire' ? 'FIRE' : e.kind === 'ems' ? 'EMS' : 'POLICE');
          if (i.type === 'hwy' || (i.type === 'collision' && i.sev >= 1)) requestShot({ type: 'follow', unit: e.unit, inc: i.id, dur: i.type === 'hwy' ? 14 : 7, pri: i.type === 'hwy' ? 3 : 2, title: `${e.kind === 'opp' ? 'OPP' : e.kind === 'fire' ? 'FIRE' : 'POLICE'} RESPONDING`, sub: i.name }); }
        if (e.kind === 'fire' && i && !broadcastSeen.has('fd' + i.id) && broadcastSeen.add('fd' + i.id)) say('radio', ['d:fire', 'd:code3', i.type === 'hwy' ? 'd:rollover' : 'd:vfire'], 1);
        break;
      case 'respOnScene': if (!i) break; if (shot && shot.type === 'follow' && shot.unit === e.unit) shot.dur = Math.min(shot.dur, shot.t + 2); shotQ = shotQ.filter(q => !(q.type === 'follow' && q.unit === e.unit)); { const src = e.kind === 'opp' ? 'OPP' : e.kind === 'fire' ? 'FIRE' : e.kind === 'ems' ? 'EMS' : 'POLICE';
        if (e.kind === 'opp' && !broadcastSeen.has('oppOn' + i.id)) { broadcastSeen.add('oppOn' + i.id); say('radio', ['u:opp'], 2, src); }
        else if (e.kind === 'fire' && i.fire && !broadcastSeen.has('fireOn' + i.id)) { broadcastSeen.add('fireOn' + i.id); say('radio', ['u:fireon'], 2, src); requestShot({ type: 'orbit', x: i.x, y: i.y, h: 200, pitch: 1.0, dur: 7, pri: 2, title: 'FIREFIGHTERS ON SCENE', sub: i.name, spin: 0.15 }); }
        else if (!broadcastSeen.has('on' + i.id)) { broadcastSeen.add('on' + i.id); if (i.type === 'call') { const k = { police_crit: 'u:closing', fire_struct: 'u:fireworking', fire_alarm: 'u:alarm', gas: 'u:roadclosed', missing: null, police_low: speechQ.length < 2 ? 'u:investigating' : null }[i.act]; const kk = k === undefined ? 'u:onscene' : k; if (kk) say('radio', [kk], 1, src); } else say('radio', [i.type === 'collision' ? 'u:tow' : i.type === 'closure' ? 'u:closing' : 'u:onscene'], 1, src); } }
        break;
      case 'fireOut': say('radio', ['u:fireout'], 1, 'FIRE'); break;
      case 'transport': say('radio', ['u:transport'], 1, 'EMS'); break;
      case 'dispatched': say('radio', [e.kind === 'tow' ? 'd:tow' : e.kind === 'hydro' ? 'd:hydro' : 'd:wcrew'], 1); break;
      case 'arrived': say('radio', ['u:gotit'], 1, e.kind === 'tow' ? 'TOW' : e.kind === 'hydro' ? 'HYDRO' : 'WATER'); break;
      case 'policeOn': say('radio', ['u:controlling'], 1, 'POLICE'); break;
      case 'cleared': if (e.why === 'reset' || !i || i.type === 'roadclosed') break; say('radio', ['d:clear'], 1);
        if (bigInc(i)) { headline(`${incTitle(i)[0].split(' · ')[0]} CLEARED`); if (broadcastSeen.has('hwy' + i.id) || broadcastSeen.has('col' + i.id) || broadcastSeen.has('cl' + i.id)) say('anchor', ['a:reopen', 'a:stay'], 1); }
        break;
      case 'complaint': if (e.lvl >= 2) { say('radio', ['d:residents'], 1); if (!broadcastSeen.has('res')) { broadcastSeen.add('res'); say('anchor', ['a:sidestreets', 'a:residents'], 1); } } break;
      case 'barricade': headline(`${e.hood.toUpperCase()} RESIDENTS BLOCK ${e.street.toUpperCase()}`); say('anchor', ['a:blocked'], 2); break;
      case 'rain': if (e.on) { if (e.live) { headline(e.snow ? 'SNOW FALLING ACROSS SCARBOROUGH' : e.storm ? 'THUNDERSTORM OVER THE EAST END' : 'RAIN SLOWING THE DRIVE HOME'); say('anchor', [e.snow ? 'a:snow' : e.storm ? 'a:storm' : 'a:rain'], 1); } else { headline('THUNDERSTORM HITS THE EAST END'); say('anchor', ['a:storm'], 1); } } break;
      case 'ems': say('radio', ['d:emscall'], 1); break;
      // city life (real data): subway closures, detours, calendar, school runs, worship, GO trains, 311
      case 'shuttle': if (!e.on) { headline(`SUBWAY SERVICE RESUMES: ${e.name.toUpperCase()}`); break; }
        headline(`SUBWAY CLOSED: ${e.name.toUpperCase()}`); requestShot({ type: 'wide', x: e.x, y: e.y, dur: 8, pri: 2, title: 'SUBWAY CLOSURE', sub: `Shuttle buses: ${e.name}`, anchor: ['a:subway'], anchorKey: 'sub' + e.name, sting: true }); break;
      case 'detours': headline(`TTC DETOURS: ROUTE${e.routes.length > 1 ? 'S' : ''} ${e.routes.slice(0, 4).join(', ')}`); say('anchor', ['a:detour'], 1); break;
      case 'hazards': headline(`311: ${e.n} OPEN ROAD HAZARD REPORTS`); say('anchor', ['a:potholes'], 1); break;
      case 'holiday': headline(`${e.name.toUpperCase()}: LIGHT TRAFFIC`); say('anchor', ['a:holiday'], 1); break;
      case 'noschool': headline('NO SCHOOL TODAY'); say('anchor', ['a:noschool'], 1); break;
      case 'schools': { headline(e.phase === 'am' ? 'MORNING SCHOOL RUN UNDER WAY' : "SCHOOL'S OUT ACROSS SCARBOROUGH"); say('anchor', [e.phase === 'am' ? 'a:schoolam' : 'a:schoolpm'], 1);
        const s = LV.wl.schools.map(q => LV.ws.schools[q[0]]).filter(q => q.kind === 'elem').sort((a, b) => Math.hypot(a.x - cam.x, a.y - cam.y) - Math.hypot(b.x - cam.x, b.y - cam.y))[0];
        if (s) requestShot({ type: 'orbit', x: s.x, y: s.y, h: 260, pitch: 1.0, dur: 8, pri: 1, title: e.phase === 'am' ? 'SCHOOL DROP-OFF' : 'SCHOOL PICKUP', sub: s.name, spin: 0.12 }); break; }
      case 'worship': headline('SERVICES UNDER WAY, BUSY CURBS'); say('anchor', ['a:worship'], 1); break;
      case 'emsArrived': if (e.mins > e.free + 3) say('radio', ['d:emsdelay'], 2); break;
    }
  }
  // ---------------------------------------------------------------- per-slow-frame: pressure, stuck responders
  function onSlow() {
    if (!summary) return; const s = summary;
    const maxQ = Math.max(0, ...incidents.filter(i => i.state !== 'cleared').map(i => i.queue || 0));
    const hw = incidents.some(i => i.type === 'hwy' && i.state !== 'cleared');
    const target = Math.min(1, 0.35 * Math.min(1, s.stuck / 900) + 0.25 * Math.min(1, maxQ / 350) + 0.2 * Math.max(...s.anger) / 100 + (hw ? 0.2 : 0) + (rainOn ? 0.08 : 0));
    pressure += (target - pressure) * 0.15;
    // heavy-traffic headline. Live: real signals only (buses behind timetable in several areas, plus a real highway closure). Replay: the sim's stuck count.
    const hm = (LV.wl && LV.wl.hm) || [], hot = hm.filter(v => v >= 1.5).length, hwyShut = incidents.some(i => i.type === 'hwy' && i.real && !(i.nlanes > 0) && i.state !== 'cleared');
    const heavy = LV.kind === 'live' ? (hot >= 3 || (hot >= 2 && hwyShut)) : pressure > 0.75, nowMs = Date.now(), liveK = LV.kind === 'live';
    if (heavy && !heavyOn && nowMs - lastHeavy > 2400000) { heavyOn = true; lastHeavy = nowMs; headline(liveK ? 'HEAVY TRAFFIC ACROSS SCARBOROUGH' : 'SCARBOROUGH AT A STANDSTILL'); if (hwyShut || !liveK) say('anchor', ['a:backed'], 2);
      requestShot({ type: 'wide', x: cam.x, y: cam.y, dur: 7, pri: 2, title: liveK ? 'HEAVY TRAFFIC ACROSS SCARBOROUGH' : 'GRIDLOCK ACROSS THE EAST END', sub: liveK ? `${hot} neighbourhoods with buses behind timetable${hwyShut ? ' · highway closure' : ''}` : `${s.stuck.toLocaleString('en-CA')} drivers stuck more than two minutes` }); }
    else if (heavyOn && !heavy) { heavyOn = false; if (nowMs - lastHeavy > 600000) headline('TRAFFIC EASING'); }
    const now = performance.now();
    for (const u of units) {
      if (!u.responder || u.state !== 'enroute' || u.quiet) { stuckClock.delete(u.id); continue; }
      if (u.v < 1.5) { if (!stuckClock.has(u.id)) stuckClock.set(u.id, now); if (now - stuckClock.get(u.id) > 6000 && !stuckSeen.has(u.id)) { stuckSeen.add(u.id); const nm2 = u.kind === 'fire' ? 'Fire truck' : u.kind === 'ems' ? 'Ambulance' : u.kind === 'opp' ? 'OPP cruiser' : 'Police cruiser';
          say('radio', ['u:stuck'], 2, u.kind === 'fire' ? 'FIRE' : u.kind === 'ems' ? 'EMS' : 'POLICE'); toast('911', `${nm2} is stuck in traffic. Clear a path: send an officer to the next intersection or open a road.`, 'var(--red)', () => { flyTo(u.x, u.y, 900); });
          requestShot({ type: 'follow', unit: u.id, dur: 6, pri: 2, title: `${nm2.toUpperCase()} STUCK IN TRAFFIC`, sub: 'Emergency response delayed' }); } }
      else stuckClock.delete(u.id);
    }
  }
  function frame(dt) { stepHelis(dt); stepShot(dt); rotorFrame(); musicTick();
    if (tv) { const cr = $('tvCrawl'); if (cr) { if (!cr.textContent || crawlX < -cr.offsetWidth) { cr.textContent = tickerText(); crawlX = cr.parentElement.offsetWidth * (first ? 0.2 : 1); first = false; } crawlX -= dt * 70; cr.style.transform = `translate(${crawlX}px, -50%)`; $('tvClk').textContent = clock(simT, true); } }
    if (AC && !muted && LV.kind && performance.now() > chatNext) { chatNext = performance.now() + 50000 + Math.random() * 80000; // the radio never quite goes silent
      if (!speaking && !speechQ.length && !(shot && shot.board)) { const n = 1 + ((Math.random() * 7) | 0); if (has('c:' + n + 'a')) { say('chatter', ['c:' + n + 'a'], 0, ''); say('chatter', ['c:' + n + 'b'], 0, ''); } } }
    if (pipCam && shot && performance.now() - pipT > 45000) { const c = camNear && camNear(shot.x, shot.y); pipT = performance.now(); if (c) $('bcPipImg').src = c.url; } const cr = $('bcCrawl'); if (!$('bcast').hidden && cr.textContent) { crawlX -= dt * 70; const w = cr.offsetWidth, W = cr.parentElement.offsetWidth; if (crawlX < -w) crawlX = W; cr.style.left = crawlX + 'px'; } }
  function hold(ms) { if (shot) endShot(true); shotQ = []; lastUser = performance.now() + ms; } // pause the auto camera, e.g. after the viewer picks their own area
  function userInput() { lastUser = performance.now(); if (shot) endShot(true); }
  $('bcBack').onclick = () => endShot(true);
  $('camBtn').setAttribute('aria-pressed', String(autoCam));
  $('camBtn').onclick = () => { autoCam = !autoCam; store.set('autocam', autoCam); $('camBtn').setAttribute('aria-pressed', String(autoCam)); if (!autoCam) { endShot(true); } toast('CAMERA', autoCam ? 'Director camera on. It will cut to big moments.' : 'Director camera off.', 'var(--cyan)'); };
  return { incTitle, setTV(v) { tv = v; crawlX = 0; first = true; lastBoard = performance.now() - 420000; const cr = $('tvCrawl'); if (cr) cr.textContent = ''; if (!v) { shotQ = []; if (shot) endShot(true); } }, set tourSource(f) { tourSource = f; }, set camNear(f) { camNear = f; }, set tvStats(f) { tvStats = f; }, set boardSource(f) { boardSource = f; }, has, voDur, onEvent, onSlow, frame, heliSprites, userInput, hold, audioReady, say, get pressure() { return pressure; }, get shot() { return shot; }, requestShot, set auto(v) { autoCam = v; }, helis };
})();
