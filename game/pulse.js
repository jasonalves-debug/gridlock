// ================================================================ PULSE: the front page of Live mode
// One line at the bottom-left says how busy Scarborough is and what just happened. Tap it for the full picture: what changed
// since your last visit, what is happening near your postal code, how today compares with a normal day, and a feed of every
// real event from the last 24 hours. Everything here is read from the same public data the map uses; nothing is simulated.
const SITE = 'https://jasonalves-debug.github.io/gallery/gridlock.html'; // where shared links point when this file is opened from disk
const PULSE = { open: false, filter: 'all', prev: store.get('lastSeen', 0), known: null, fresh: new Set(), unseen: 0, notify: store.get('notify', false),
  cache: null, key: '', focus: null, more: false, hidAt: 0, visits: store.get('visits', 0), flash: 0 };
const P_COL = { police: '#52c7ff', fire: '#ff8a1f', medical: '#ff4f6d', road: '#ffb020', ttc: '#ff4b4b', wx: '#7aa7ff' };
const P_ICON = { police: 'police', fire: 'fire', medical: 'medical', road: 'cone', ttc: 'bus', wx: 'rain' };
const P_NAME = { police: 'Police', fire: 'Fire', medical: 'Medical', road: 'Roads', ttc: 'TTC', wx: 'Weather' };
const live = () => LV.kind === 'live' && ready;
const cap1 = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
const tidy = s => { s = String(s || '').trim(); return s && s === s.toUpperCase() ? cap1(s.toLowerCase()) : s; };
function ago(sec) { sec = Math.max(0, sec); return sec < 90 ? 'just now' : sec < 3600 ? Math.round(sec / 60) + ' min ago' : sec < 86400 ? (sec / 3600).toFixed(sec < 36000 ? 1 : 0).replace(/\.0$/, '') + ' h ago' : Math.round(sec / 86400) + ' d ago'; }
function callTitle(c, t) { const l = tidy(c.label); return !l ? P_NAME[t] + ' call' : /^medical$/i.test(l) ? 'Medical call' : l.replace(/\s*\(.*?\)\s*$/, '') || l; }

// ---------------------------------------------------------------- every real event of the last 24 hours, newest first
function pulseItems() {
  const f = LV.feed || {}, key = (f.generated || '') + '|' + Math.floor(Date.now() / 30000); if (PULSE.cache && PULSE.key === key) return PULSE.cache;
  const now = Date.now() / 1000, P = G.proj, xy = (lat, lng) => [(lng - P.lon0) * P.kx, -(lat - P.lat0) * P.ky], out = [], day = t => t && now - t < 86400 && t <= now + 600;
  H24.cache = null;
  for (const o of h24calls()) if (inScarb(o.c.lat, o.c.lng)) out.push({ id: 'c=' + o.c.id, t: o.c.ts, kind: o.t, title: callTitle(o.c, o.t), sub: o.c.loc || 'Scarborough', x: o.x, y: o.y, hot: o.c.sev === 'high', sel: { k: 'h24', id: o.c.id } });
  for (const h of f.hwy || []) { if (!day(h.start) || !inScarb(h.lat, h.lng)) continue; const [x, y] = xy(h.lat, h.lng), work = h.type === 'roadwork';
    out.push({ id: 'h=' + h.id, t: h.start, kind: 'road', title: `${work ? 'Roadwork' : cap1(String(h.sub || h.type || 'Incident').toLowerCase())} · ${tidy(h.road)}${h.dir ? ' ' + h.dir.toLowerCase() : ''}`, sub: h.full ? 'All lanes closed' : h.lanes ? h.lanes + ' blocked' : 'Ontario 511', x, y, hot: !!h.full || !work, hwy: h.id }); }
  for (const r of f.roads || []) { if (!day(r.start) || !(r.full || r.impact === 'High')) continue; const p = r.line && r.line[0]; if (!p || !inScarb(p[1], p[0])) continue; const [x, y] = xy(p[1], p[0]);
    out.push({ id: 'r=' + r.id, t: r.start, kind: 'road', title: `${r.full ? 'Road closed' : 'Lane closure'} · ${r.road || 'Road'}`, sub: r.from && r.to && r.from !== r.to ? `${r.from} to ${r.to}` : r.from ? 'Near ' + r.from : 'City roadwork', x, y, hot: !!r.full, zone: r.id }); }
  for (const a of f.ttc_alerts || []) { const t = a.periods && a.periods[0] && a.periods[0][0]; if (!day(t)) continue;
    out.push({ id: 't=' + a.id, t, kind: 'ttc', title: (a.header || 'TTC service change').replace(/^\s*[–-]\s*/, ''), sub: a.routes && a.routes.length ? 'Route' + (a.routes.length > 1 ? 's ' : ' ') + a.routes.slice(0, 6).join(', ') : 'TTC service alert' }); }
  out.sort((a, b) => b.t - a.t);
  for (const w of f.alerts || []) out.unshift({ id: 'w=' + w.name, t: now, pin: true, kind: 'wx', title: w.name, sub: (w.text || 'Environment Canada').slice(0, 110), hot: true });
  PULSE.key = key; return (PULSE.cache = out);
}
const inScarb = (lat, lng) => lng > -79.2883 - 0.4075 * (lat - 43.6913) - 0.002; // east of Victoria Park Ave (the feeds cover a box that spills into North York and East York)
const inArea = it => AREA.g && it.x != null && (it.x - AREA.g.x) ** 2 + (it.y - AREA.g.y) ** 2 <= AREA.g.r * AREA.g.r;

// ---------------------------------------------------------------- how busy is it, against the same hour of the same weekday over the past weeks
const scarbCall = c => c.src === 'tps' && inScarb(c.lat, c.lng); // police only: weeks of police history exist, the fire history is too thin to compare against
function rateAt(ms) { const r = LV.feed && LV.feed.rates; if (!r) return null; const p = torontoParts(ms), dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday.slice(0, 3)), i = dow * 24 + (+p.hour % 24); return dow < 0 ? null : (r.police[i] || 0); }
function pulseSeries() { // 24 hourly buckets ending now: [{n, typ, h}]
  const end = Date.now(), calls = ((LV.feed && LV.feed.calls) || []).filter(scarbCall), out = [];
  for (let k = 23; k >= 0; k--) { const a = end - (k + 1) * 3600e3, b = end - k * 3600e3; out.push({ n: calls.filter(c => c.ts * 1000 > a && c.ts * 1000 <= b).length, typ: rateAt((a + b) / 2), h: +torontoParts((a + b) / 2).hour % 24 }); }
  return out;
}
function pulseLevel() { // police calls in the last 3 hours against the usual 3 hours
  const s = pulseSeries().slice(-3), n = s.reduce((a, b) => a + b.n, 0), typ = s.every(b => b.typ != null) ? s.reduce((a, b) => a + b.typ, 0) : null;
  if (typ == null || typ < 1.5) return { n, typ, word: n >= 12 ? 'BUSY' : n <= 2 ? 'QUIET' : 'STEADY', col: n >= 12 ? '#ffb020' : n <= 2 ? '#39d98a' : '#52c7ff', r: null };
  const r = n / typ, d = n - typ; // small counts are noisy, so a busy label needs a real gap as well as a ratio
  return r < 0.6 && d <= -2 ? { n, typ, r, word: 'QUIET', col: '#39d98a' } : r >= 1.9 && d >= 7 ? { n, typ, r, word: 'VERY BUSY', col: '#ff4438' } : r >= 1.35 && d >= 4 ? { n, typ, r, word: 'BUSY', col: '#ffb020' } : { n, typ, r, word: 'TYPICAL', col: '#52c7ff' };
}
function dayPart() { const p = torontoParts(Date.now()), h = +p.hour % 24; return `${{ Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' }[p.weekday.slice(0, 3)] || 'day'} ${h < 5 ? 'overnight' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 22 ? 'evening' : 'night'}`; }
function levelLine(L) { if (L.typ != null && L.n === 0) return `No police calls in the last 3 hours (usually ${Math.max(1, Math.round(L.typ))})`; const u = L.typ == null ? '' : ` (${L.n} in 3 hours, usually ${Math.round(L.typ)})`; return L.r == null ? `${L.n} police calls in the last 3 hours` : L.r >= 1.8 ? `About ${L.r.toFixed(L.r < 3 ? 1 : 0).replace(/\.0$/, '')}× the usual police calls for a ${dayPart()}${u}` : Math.abs(L.r - 1) < 0.15 ? `Police calls are about normal for a ${dayPart()}${u}` : `${Math.round(Math.abs(L.r - 1) * 100)}% ${L.r > 1 ? 'more' : 'fewer'} police calls than a normal ${dayPart()}${u}`; }

// ---------------------------------------------------------------- the one-line strip
function pulseStrip() {
  const el = $('pulse'); if (!el) return; const on = live() && !PULSE.open && !TV.on && !(sheetOpen() || (!$('areabar').hidden && innerWidth < 900));
  document.body.classList.toggle('haspulse', live() && !TV.on); if (!on) { el.hidden = true; return; }
  const L = pulseLevel(), it = pulseItems().find(i => !i.pin), nw = PULSE.fresh.size || PULSE.sinceN;
  el.hidden = false; el.style.setProperty('--c', L.col); el.classList.toggle('flash', performance.now() < PULSE.flash);
  el.innerHTML = `<b class="lvl"><i></i>${L.word}</b>` + (nw ? `<em>${nw} new</em>` : '') + `<span class="msg">${!PULSE.fresh.size && PULSE.sinceN ? `since you looked at ${timeOf(PULSE.prev / 1000)}` : it ? `${esc(it.title)} · ${esc(it.sub)} · ${ago(Date.now() / 1000 - it.t)}` : esc(levelLine(L))}</span><span class="go">›</span>`;
}

// ---------------------------------------------------------------- the panel
function pulseChart() {
  const s = pulseSeries(), max = Math.max(4, ...s.map(b => Math.max(b.n, b.typ || 0))), W = 288, H = 64, bw = W / 24, y = v => H - 2 - v / max * (H - 8);
  const bars = s.map((b, i) => `<rect x="${(i * bw + 1.5).toFixed(1)}" y="${y(b.n).toFixed(1)}" width="${(bw - 3).toFixed(1)}" height="${Math.max(1, H - 2 - y(b.n)).toFixed(1)}" rx="1.5" fill="${i === 23 ? '#e7edf2' : b.typ != null && b.n > b.typ * 1.5 && b.n >= 4 ? '#ffb020' : '#52c7ff'}" opacity="${i === 23 ? 1 : 0.75}"><title>${hr12(b.h)}: ${b.n} police calls${b.typ != null ? ', usually ' + b.typ.toFixed(1) : ''}</title></rect>`).join('');
  const line = s.every(b => b.typ != null) ? `<polyline points="${s.map((b, i) => `${(i * bw + bw / 2).toFixed(1)},${y(b.typ).toFixed(1)}`).join(' ')}" fill="none" stroke="#8796a4" stroke-width="1.5" stroke-dasharray="3 3"/>` : '';
  const ticks = [0, 6, 12, 18, 23].map(i => `<text x="${(i === 23 ? W : i === 0 ? 0 : i * bw + bw / 2).toFixed(1)}" y="${H + 13}" text-anchor="${i === 23 ? 'end' : i === 0 ? 'start' : 'middle'}">${i === 23 ? 'now' : hr12(s[i].h)}</text>`).join('');
  return `<svg class="pchart" viewBox="0 0 ${W} ${H + 16}" role="img" aria-label="Calls per hour over the last 24 hours">${bars}${line}${ticks}</svg>`;
}
const hr12 = h => `${((h + 11) % 12) + 1}${h < 12 ? 'am' : 'pm'}`;
function nearestHood(x, y) { let best = -1, bd = 1e18; G.hoods.forEach((h, i) => { const d = (h.x - x) ** 2 + (h.y - y) ** 2; if (d < bd) { bd = d; best = i; } }); return best; }
function pulseToday(items) { // the day so far, in three facts
  const calls = items.filter(i => i.sel), by = {}, hood = {}; if (calls.length < 5) return '';
  for (const c of calls) { by[c.title] = (by[c.title] || 0) + 1; const h = nearestHood(c.x, c.y); if (h >= 0) hood[h] = (hood[h] || 0) + 1; }
  const top = o => Object.entries(o).sort((a, b) => b[1] - a[1])[0], [tt, tn] = top(by), [hh, hn] = top(hood), n = k => calls.filter(c => c.kind === k).length;
  return `<div class="prow3"><div><b>${n('police')}</b><span>police</span></div><div><b>${n('fire')}</b><span>fire</span></div><div><b>${n('medical')}</b><span>medical</span></div></div>`
    + `<p class="pnote">Most calls: <button type="button" class="plink" data-hood="${hh}">${esc(G.hoods[hh].n)}</button> (${hn}). Most common: ${esc(tt.toLowerCase())} (${tn}).</p>`;
}
function vitals() {
  const f = LV.feed || {}, w = f.weather, wl = LV.wl || {}, zones = (LV.zones || []).filter(z => z.on).length, alerts = (f.ttc_alerts || []).length, v = [];
  const hour = ((f.calls) || []).filter(c => Date.now() / 1000 - c.ts < 3600 && inScarb(c.lat, c.lng)).length;
  v.push([hour, 'calls this hour', 'police, fire, medical', "data-f='all'"]);
  if (w) v.push([Math.round(w.temperature_2m) + '°', wxWord(w).replace(/\s*-?\d+°$/, '').toLowerCase(), w.wind_gusts_10m >= 40 ? `gusts ${Math.round(w.wind_gusts_10m)} km/h` : `wind ${Math.round(w.wind_speed_10m || 0)} km/h`, '']);
  v.push([zones, 'work zones active', `${(f.hwy || []).length} on highways`, "data-f='road'"]);
  v.push([RB.n && Date.now() - RB.at < 120000 ? RB.n : alerts, RB.n && Date.now() - RB.at < 120000 ? 'TTC buses live' : 'TTC alerts', RB.n && Date.now() - RB.at < 120000 ? `${alerts} service alerts` : '', "data-f='ttc'"]);
  if (wl.slow && wl.slow.length) { const s = wl.slow[0]; v.push([Math.round(s[1] * 100) + '%', 'of normal speed', esc(s[0]), `data-fly='${Math.round(s[2])},${Math.round(s[3])}'`]); }
  if (wl.late && wl.late[1] >= 8) v.push([Math.round(wl.late[0] / wl.late[1] * 100) + '%', 'bus stretches slow', 'from live bus GPS', '']);
  return `<div class="pvit" style="grid-template-columns:repeat(${v.length === 4 ? 2 : 3},1fr)">${v.slice(0, 6).map(([b, l, s, a]) => `<button type="button" ${a || 'disabled'}><b>${b}</b><span>${l}</span><small>${s}</small></button>`).join('')}</div>`;
}
function itemRow(it) {
  const isNew = PULSE.fresh.has(it.id) || (PULSE.prev && it.t * 1000 > PULSE.prev && !it.pin && Date.now() - PULSE.prev > 20 * 60000);
  return `<button type="button" class="pit${it.hot ? ' hot' : ''}" data-it="${esc(it.id)}" style="--c:${P_COL[it.kind]}"><span class="ic">${svg(P_ICON[it.kind], P_COL[it.kind])}</span><span class="tx"><b>${esc(it.title)}${isNew ? '<em>NEW</em>' : ''}</b><span>${esc(it.sub)}</span></span><time>${it.pin ? 'now' : ago(Date.now() / 1000 - it.t).replace(' ago', '')}</time></button>`;
}
function sinceHtml(items) {
  const gap = Date.now() - PULSE.prev; if (!PULSE.prev || gap < 20 * 60000) return '';
  const cut = Math.max(PULSE.prev, Date.now() - 86400e3) / 1000, L = items.filter(i => !i.pin && i.t > cut), n = k => L.filter(i => i.kind === k).length, capped = gap > 86400e3;
  const when = capped ? 'In the last 24 hours' : `Since you last looked (${gap < 3600e3 ? Math.round(gap / 60000) + ' min ago' : timeOf(PULSE.prev / 1000)})`;
  const parts = [[n('police'), 'police call'], [n('fire'), 'fire call'], [n('medical'), 'medical call'], [n('road'), 'road closure'], [n('ttc'), 'TTC change']].filter(p => p[0]).map(([c, w]) => `${c} ${w}${c > 1 ? 's' : ''}`);
  const hot = L.filter(i => i.hot).slice(0, 2);
  return `<section class="psince"><h3>${when}</h3><p>${parts.length ? parts.join(' · ') : 'Nothing new. A quiet stretch.'}</p>${hot.map(itemRow).join('')}</section>`;
}
function nearHtml(items) {
  if (!AREA.fsa || !AREA.g) return `<section><h3>Near you</h3><form id="pfsa" class="pform"><input id="pfsaIn" maxlength="3" placeholder="M1K" autocomplete="postal-code" autocapitalize="characters" spellcheck="false" aria-label="First 3 characters of your postal code"><button type="submit">Show my area</button></form><p class="pnote" id="pfsaMsg">${esc(AREA.msg) || 'Type the first 3 characters of your postal code. It stays on this device.'}</p></section>`;
  const L = items.filter(inArea), hour = L.filter(i => Date.now() / 1000 - i.t < 3600).length, canN = 'Notification' in window;
  return `<section><h3>${esc(AREA.fsa)} · near you</h3><p>${L.length ? `${L.length} event${L.length > 1 ? 's' : ''} in the last 24 hours${hour ? `, ${hour} in the last hour` : ''}.` : 'Nothing reported in the last 24 hours.'}</p>${L.slice(0, 3).map(itemRow).join('')}`
    + `<div class="pacts"><button type="button" data-p="area">Show on map</button>${L.length > 3 ? '<button type="button" data-p="nearall">See all ' + L.length + '</button>' : ''}${canN ? `<button type="button" data-p="notify" aria-pressed="${PULSE.notify && Notification.permission === 'granted'}">${PULSE.notify && Notification.permission === 'granted' ? 'Alerts on' : 'Alert me'}</button>` : ''}<button type="button" data-p="fsa">Change</button></div></section>`;
}
function lookHtml(items) { // a real photo: the traffic camera nearest your area, else nearest the newest event
  let ci = -1, why = ''; if (AREA.g) { ci = nearestCam(AREA.g.x, AREA.g.y, 2500); why = 'nearest to ' + AREA.fsa; }
  if (ci < 0) for (const it of items) { if (it.x == null || it.pin) continue; ci = nearestCam(it.x, it.y, 700); if (ci >= 0) { why = `near ${it.title.toLowerCase()}, ${ago(Date.now() / 1000 - it.t)}`; break; } }
  if (ci < 0) return ''; const c = cams()[ci], v = c.views[0];
  return `<section><h3>Live look</h3><button type="button" class="pcam" data-cam="${ci}"><img alt="Traffic camera at ${esc(c.name)}" src="${esc(camSrc(v[1]))}" onerror="this.parentElement.classList.add('off')"><span><b>${esc(c.name)}</b>${esc(why)} · photo from the last minute</span></button></section>`;
}
function pulsePanel() {
  const el = $('now'); if (!el) return; if (!PULSE.open || !live() || TV.on) { el.hidden = true; return; }
  const keep = el.querySelector('.pbody') ? el.querySelector('.pbody').scrollTop : 0, typing = document.activeElement && document.activeElement.id === 'pfsaIn'; if (typing) return;
  const items = pulseItems(), L = pulseLevel(), age = feedAgeMin(), f = PULSE.filter;
  const list = items.filter(i => f === 'all' ? true : f === 'near' ? inArea(i) : f === 'calls' ? !!i.sel : i.kind === f), shown = list.slice(0, PULSE.more ? 200 : 25);
  const chips = [['all', 'All'], ...(AREA.g ? [['near', AREA.fsa]] : []), ['police', 'Police'], ['fire', 'Fire'], ['medical', 'Medical'], ['road', 'Roads'], ['ttc', 'TTC']];
  el.hidden = false;
  el.innerHTML = `<header><div><h2>Scarborough right now</h2><p><i class="dot ${LV.src === 'live' && age !== null && age < 20 ? 'ok' : 'old'}"></i>${age === null ? 'No live data' : age < 1 ? 'Updated just now' : `Updated ${age} min ago`} · ${timeOf(Date.now() / 1000)}</p></div><button type="button" class="px" data-p="close" aria-label="Close">×</button></header><div class="pbody">`
    + `<section class="plevel" style="--c:${L.col}"><b>${L.word}</b><span>${esc(levelLine(L))}</span></section>`
    + vitals() + sinceHtml(items) + nearHtml(items) + lookHtml(items)
    + `<section><h3>Police calls per hour · last 24 hours</h3>${pulseChart()}<p class="pnote"><i class="lg bar"></i>today <i class="lg dash"></i>a normal ${dayPart().split(' ')[0]}</p>${pulseToday(items)}</section>`
    + `<section><h3>Everything, newest first</h3><div class="pchips">${chips.map(([k, l]) => `<button type="button" data-f="${k}" aria-pressed="${f === k}">${esc(l)}</button>`).join('')}</div>`
    + (shown.length ? shown.map(itemRow).join('') : '<p class="pnote">Nothing of this kind in the last 24 hours.</p>') + (list.length > shown.length ? `<button type="button" class="pmore" data-p="more">Show all ${list.length}</button>` : '') + '</section>'
    + `<footer><div class="pacts"><button type="button" data-p="share">Share</button><button type="button" data-p="tv">TV mode</button><button type="button" data-p="sources">Sources</button><button type="button" data-p="menu">Replay &amp; sandbox</button></div><p class="pnote">Unofficial. Built from public City, TTC, police, fire and Ontario 511 data, a few minutes behind real life. The cars are simulated. In an emergency call 911.</p></footer></div>`;
  el.querySelector('.pbody').scrollTop = keep;
  const form = $('pfsa'); if (form) { const inp = $('pfsaIn'); inp.addEventListener('keydown', e => e.stopPropagation()); form.onsubmit = e => { e.preventDefault(); if (areaSet(inp.value, true)) { AREA.open = false; areaBar(); inp.blur(); if (innerWidth < 900) pulseOpen(false); } else { $('pfsaMsg').textContent = AREA.msg; } pulsePanel(); }; }
}
function pulseOpen(on) { PULSE.open = on; document.body.classList.toggle('nowopen', on); if (on) { closePanels(); closeSheet(); PULSE.unseen = 0; PULSE.sinceN = 0; document.title = 'Gridlock: Scarborough'; } else { PULSE.fresh.clear(); PULSE.more = false; } pulsePanel(); pulseStrip(); }
function pulseGo(it) {
  if (!it) return; DIR.hold(90000); PULSE.focus = it.x != null ? { x: it.x, y: it.y, col: P_COL[it.kind], until: performance.now() + 20000 } : null;
  if (innerWidth < 900) pulseOpen(false);
  if (it.sel) return select(it.sel);
  if (it.hwy != null) { const i = incidents.find(q => q.real && q.real.src === '511' && Math.hypot(q.x - it.x, q.y - it.y) < 400 && q.state !== 'cleared'); if (i) return select({ k: 'inc', id: i.id }); }
  if (it.zone != null) { const z = (LV.zones || []).find(q => q.rid === it.zone || q.id === it.zone); if (z) return select({ k: 'zone', id: z.id }); }
  if (it.x != null) flyTo(it.x, it.y, 2400); else toast(P_NAME[it.kind].toUpperCase(), `${it.title}. ${it.sub}`, P_COL[it.kind]);
}
function pulseOverlay(c) { // a ring on the thing just picked from the feed
  const f = PULSE.focus; if (!f) return; const left = f.until - performance.now(); if (left <= 0) { PULSE.focus = null; return; }
  const p = R.project(f.x, f.y, 0); if (!p) return; const t = performance.now() / 1000;
  for (let k = 0; k < 2; k++) { const ph = (t * 0.7 + k * 0.5) % 1; c.globalAlpha = (1 - ph) * Math.min(1, left / 2000); c.strokeStyle = f.col; c.lineWidth = 3; c.beginPath(); c.arc(p[0], p[1], 14 + ph * 34, 0, 7); c.stroke(); } c.globalAlpha = 1;
}

// ---------------------------------------------------------------- new data: flash the strip, count in the tab title, notify if asked
function pulseOnFeed() {
  if (!LV.feed) return; PULSE.cache = null; const items = pulseItems(), ids = new Set(items.map(i => i.id)), now = Date.now() / 1000;
  if (PULSE.known && live()) { const fresh = items.filter(i => !PULSE.known.has(i.id) && !i.pin && now - i.t < 5400);
    if (fresh.length) { fresh.forEach(i => PULSE.fresh.add(i.id)); PULSE.flash = performance.now() + 6000;
      if (document.hidden) { PULSE.unseen += fresh.length; document.title = `(${PULSE.unseen}) Gridlock: Scarborough`;
        if (PULSE.notify && 'Notification' in window && Notification.permission === 'granted') for (const it of fresh.filter(i => inArea(i) || (i.hot && !AREA.g)).slice(0, 3)) { try { const n = new Notification(`${it.title}${inArea(it) ? ' · near you' : ''}`, { body: `${it.sub} · ${timeOf(it.t)}`, tag: it.id }); n.onclick = () => { window.focus(); pulseGo(it); n.close(); }; } catch (e) {} } } } }
  PULSE.known = ids; pulseStrip(); pulsePanel();
}
async function pulseNotify() {
  if (!('Notification' in window)) return; if (PULSE.notify && Notification.permission === 'granted') { PULSE.notify = false; store.set('notify', false); return pulsePanel(); }
  let p = Notification.permission; if (p === 'default') { try { p = await Notification.requestPermission(); } catch (e) {} }
  if (p !== 'granted') { toast('ALERTS', 'Notifications are blocked for this page in your browser settings.', 'var(--muted)'); return; }
  PULSE.notify = true; store.set('notify', true); toast('ALERTS', `On. You will get a notification for new events in ${AREA.fsa || 'Scarborough'} while this page is open in a tab.`, 'var(--green)'); pulsePanel();
}

// ---------------------------------------------------------------- links: #M1K, #c=<call>, #at=<lat>,<lng>, #tv, #menu
const BOOT = decodeURIComponent(location.hash.slice(1));
function shareUrl(frag) { return (/^https?:$/.test(location.protocol) ? location.origin + location.pathname : SITE) + (frag ? '#' + frag : ''); }
async function shareIt(text, frag) {
  const url = shareUrl(frag); try { if (navigator.share) { await navigator.share({ title: 'Gridlock: Scarborough', text, url }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(`${text} ${url}`); toast('SHARE', 'Link copied. Paste it anywhere.', 'var(--green)'); } catch (e) { toast('SHARE', esc(url), 'var(--green)'); }
}
function pulseBoot() { // runs once Live is on screen
  const m = BOOT; if (/^[Mm]1[A-Za-z]$/.test(m)) { areaSet(m, true); return; }
  if (m.startsWith('c=')) { const it = pulseItems().find(i => i.id === m); if (it) pulseGo(it); else toast('LINK', 'That call is more than 24 hours old, so it has dropped off the map.', 'var(--muted)'); return; }
  if (m.startsWith('at=')) { const [lat, lng] = m.slice(3).split(',').map(Number), P = G.proj; if (isFinite(lat) && isFinite(lng)) { DIR.hold(90000); flyTo((lng - P.lon0) * P.kx, -(lat - P.lat0) * P.ky, 2200); } return; }
  if (!PULSE.visits && innerWidth >= 900) pulseOpen(true); // first visit on a big screen: show the front page
}
function pulseAfterReady() {
  if (LV.kind !== 'live') return; store.set('visits', PULSE.visits + 1);
  PULSE.known = new Set(pulseItems().map(i => i.id)); { const gap = Date.now() - PULSE.prev; PULSE.sinceN = PULSE.prev && gap > 20 * 60000 && gap < 86400e3 ? pulseItems().filter(i => !i.pin && i.t * 1000 > PULSE.prev).length : 0; } pulseStrip(); setTimeout(pulseBoot, 1500);
  setInterval(() => { pulseStrip(); if (PULSE.open) pulsePanel(); }, 15000);
  setInterval(() => { if (!document.hidden) store.set('lastSeen', Date.now()); }, 60000);
  const leave = () => { store.set('lastSeen', Date.now()); PULSE.hidAt = Date.now(); };
  addEventListener('pagehide', leave);
  document.addEventListener('visibilitychange', () => { if (document.hidden) return leave();
    if (PULSE.hidAt && Date.now() - PULSE.hidAt > 20 * 60000) PULSE.prev = PULSE.hidAt; // back after a while: "since you last looked" starts over
    PULSE.unseen = 0; document.title = 'Gridlock: Scarborough'; liveRefresh(); pulseStrip(); pulsePanel(); });
}
document.addEventListener('click', e => {
  const t = e.target; if (!t.closest) return;
  if (t.closest('#pulse')) { pulseOpen(true); snd('ui'); return; }
  const sh = t.closest('[data-share]'); if (sh) { shareIt(sh.dataset.title || 'Happening in Scarborough', sh.dataset.share); return; }
  const now = t.closest('#now'); if (!now) return;
  if (t.closest('[data-cam]')) { if (innerWidth < 900) pulseOpen(false); return; } // the camera sheet itself is opened by the map's own handler
  const it = t.closest('[data-it]'); if (it) { pulseGo(pulseItems().find(i => i.id === it.dataset.it)); snd('ui'); return; }
  const f = t.closest('[data-f]'); if (f) { PULSE.filter = f.dataset.f; PULSE.more = false; pulsePanel(); const s = now.querySelector('.pchips'); if (s && f.closest('.pvit')) s.scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
  const fl = t.closest('[data-fly]'); if (fl) { const [x, y] = fl.dataset.fly.split(',').map(Number); DIR.hold(90000); if (innerWidth < 900) pulseOpen(false); flyTo(x, y, 2600); return; }
  const hd = t.closest('[data-hood]'); if (hd) { if (innerWidth < 900) pulseOpen(false); select({ k: 'hood', h: +hd.dataset.hood }); return; }
  const p = t.closest('[data-p]'); if (!p) return;
  switch (p.dataset.p) {
    case 'close': pulseOpen(false); break;
    case 'more': PULSE.more = true; pulsePanel(); break;
    case 'area': if (innerWidth < 900) pulseOpen(false); areaSet(AREA.fsa, true); break;
    case 'nearall': PULSE.filter = 'near'; PULSE.more = true; pulsePanel(); now.querySelector('.pchips').scrollIntoView({ block: 'start', behavior: 'smooth' }); break;
    case 'fsa': AREA.fsa = null; AREA.g = null; AREA.msg = ''; store.set('myfsa', null); pulsePanel(); { const i = $('pfsaIn'); if (i) i.focus(); } break;
    case 'notify': pulseNotify(); break;
    case 'share': shareIt(`Scarborough right now: ${pulseLevel().word.toLowerCase()}. Live calls, closures and transit on one map.`, AREA.fsa || ''); break;
    case 'tv': pulseOpen(false); tvSet(true, true); break;
    case 'sources': if (innerWidth < 900) pulseOpen(false); selection = { k: 'live', id: 0 }; renderSheet(true); break;
    case 'menu': location.hash = 'menu'; location.reload(); break;
  }
});
addEventListener('keydown', e => { if (PULSE.open && e.key === 'Escape') pulseOpen(false); });
