// ================================================================ TV DESK: the broadcast frame around the picture in TV mode
// On a wide screen the picture gets a news-channel frame: station bar with the segment, clock and weather; a side rail with a real
// traffic camera, the city pulse, the latest real events and what is coming up; the lower third and a categorised ticker underneath.
// On a phone or a narrow window only the lower third and ticker show. Everything in the frame is read from the live feeds.
const TVD = { camAt: 0, cam: null, html: {}, shotKey: '' };
function tvLayout() { const big = TV.on && innerWidth >= 1000 && innerWidth / innerHeight > 1.25; document.body.classList.toggle('tvbig', big); R.cam.ox = big ? 0.26 : 0; }
addEventListener('resize', () => { if (TV.on) tvLayout(); });
function tvPut(id, html) { if (TVD.html[id] === html) return false; TVD.html[id] = html; const el = $(id); if (el) el.innerHTML = html; return true; }
function tvRailCam(force) { // a real camera photo: the one nearest the current shot, else a tour of the others
  const now = performance.now(), sh = DIR.shot, key = sh && sh.x != null ? Math.round(sh.x) + ',' + Math.round(sh.y) : ''; if (!force && now - TVD.camAt < 24000 && key === TVD.shotKey) return; TVD.shotKey = key; TVD.camAt = now;
  let c = sh && sh.x != null ? camNear(sh.x, sh.y) : null; if (!c || (TVD.cam && c.name === TVD.cam.name && now - (TVD.sameSince || 0) > 60000)) { const cs = cams().filter(q => inMap(q.x, q.y)); if (cs.length) { const q = cs[(Math.random() * cs.length) | 0]; c = { name: q.name, url: camSrc(q.views[0][1]) }; } }
  if (!c) { $('tvCamBox').classList.add('off'); return; } if (!TVD.cam || TVD.cam.name !== c.name) TVD.sameSince = now; TVD.cam = c;
  const img = new Image(); img.onload = () => { const el = $('tvCamImg'); el.src = img.src; $('tvCamTag').textContent = c.name.toUpperCase(); const box = $('tvCamBox'); box.classList.remove('off'); box.style.animation = 'none'; void box.offsetWidth; box.style.animation = ''; }; img.onerror = () => { TVD.camAt = now - 20000; }; img.src = c.url;
}
function tvDesk() {
  if (!TV.on || !LV.kind) return; const f = LV.feed || {}, w = f.weather, p = torontoParts(Date.now());
  tvPut('tvTime', timeOf(Date.now() / 1000)); tvPut('tvDate', `${p.weekday.slice(0, 3).toUpperCase()} ${new Intl.DateTimeFormat('en-CA', { timeZone: TZ, month: 'short', day: 'numeric' }).format(new Date()).toUpperCase()}`);
  tvPut('tvWx', w && w.temperature_2m != null ? `<b>${Math.round(w.temperature_2m)}°</b>${esc(wxWord(w).replace(/\s*-?\d+°$/, '').toUpperCase())}` : '');
  const L = pulseLevel(); tvPut('tvPulse', `<h4>CITY PULSE</h4><div class="lv" style="--c:${L.col}"><b>${L.word}</b><span>${esc(levelLine(L).replace(/\s*\(.*\)$/, ''))}</span></div>${pulseChart()}<p><i class="lg bar"></i>police calls per hour <i class="lg dash"></i>normal</p>`);
  const box = $('tvLatest'), room = box && box.parentElement ? box.parentElement.clientHeight - innerHeight * 0.035 : 0, rows = Math.max(1, Math.min(7, Math.floor(room / (innerHeight * 0.0625)))); // only whole rows
  const now = Date.now() / 1000, items = pulseItems().filter(i => !i.pin).slice(0, rows);
  tvPut('tvLatest', items.length ? items.map(it => `<div class="tl${now - it.t < 900 || PULSE.fresh.has(it.id) ? ' new' : ''}" style="--c:${P_COL[it.kind]}"><i>${svg(P_ICON[it.kind], P_COL[it.kind])}</i><div><b>${esc(it.title)}</b><span>${esc(it.sub)}</span></div><time>${ago(now - it.t).replace(' ago', '').replace('just now', 'now')}</time></div>`).join('') : '<p class="none">Nothing reported in the last 24 hours.</p>');
  tvRailCam(false);
}
function tvLead() { // leader line from the docked info card to the clicked item
  requestAnimationFrame(tvLead); const sv = $('tvLead'), sh = $('sheet'); if (!sv) return;
  const big = document.body.classList.contains('tvbig'), on = big && selection && !sh.hidden;
  if (big) { const g = on ? 0.62 : 0.26; R.cam.ox += (g - R.cam.ox) * 0.07; if (Math.abs(g - R.cam.ox) < 0.002) R.cam.ox = g; } // card open: the item sits in the left part of the picture, clear of the card
  if (!on) { sv.classList.remove('on'); return; }
  const w = selPos(selection), p = w && R.project(w[0], w[1], 0), r = sh.getBoundingClientRect(), top = innerHeight * 0.064, right = innerWidth * 0.74;
  if (!p || p[0] < 0 || p[0] > right || p[1] < top || p[1] > innerHeight * 0.8) { sv.classList.remove('on'); return; }
  const x0 = r.left, y0 = r.top + Math.min(r.height / 2, 46), q = (id, o) => { const e = $(id); for (const k in o) e.setAttribute(k, o[k]); };
  q('tvLeadL', { x1: x0, y1: y0, x2: p[0], y2: p[1] }); q('tvLeadR', { cx: p[0], cy: p[1] }); q('tvLeadD', { cx: p[0], cy: p[1] }); sv.classList.add('on');
}
requestAnimationFrame(tvLead);
function tvHoldSel() { // while a card is open keep the camera on it, then let it go after a while so an unattended TV never gets stuck
  if (!TV.on || !selection || $('sheet').hidden) { TVD.selSig = ''; return; }
  const sig = JSON.stringify(selection); if (sig !== TVD.selSig) { TVD.selSig = sig; TVD.selAt = performance.now(); }
  if (performance.now() - TVD.selAt > 45000) { closeSheet(); return; } DIR.hold(0);
}
setInterval(tvHoldSel, 1000);
setInterval(tvDesk, 1000);
