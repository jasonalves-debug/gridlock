// GRIDLOCK — app: worker, input, HUD, tools, overlay, audio.
'use strict';
(function () {
const $ = id => document.getElementById(id);
const G = JSON.parse($('graph').textContent);
const SIMSRC = $('simsrc').textContent;
const E = G.ea.length;
const isPhone = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820;
const store = { get(k, d) { try { const v = localStorage.getItem('gl.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem('gl.' + k, JSON.stringify(v)); } catch (e) {} } };

// ---------------------------------------------------------------- icons
const IC = {
  collision: '<path d="M4 15l2-5h6l2 5M4 15h10v3H4zM6 18v1.5M12 18v1.5" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/><path d="M14 8l2.2-3.6M17 10l3.6-1.4M15.4 11.6l3.2 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  power: '<path d="M13 2L5 13h6l-1 9 8-11h-6z" fill="currentColor"/>',
  water: '<path d="M12 3c3.5 4.6 6 8 6 11a6 6 0 0 1-12 0c0-3 2.5-6.4 6-11z" fill="currentColor"/><path d="M9 15a3 3 0 0 0 3 3" stroke="#000" stroke-opacity=".35" stroke-width="1.6" fill="none" stroke-linecap="round"/>',
  closure: '<path d="M12 2l8 3v6c0 5-3.4 8.6-8 11-4.6-2.4-8-6-8-11V5z" fill="currentColor"/><path d="M8.5 12l2.4 2.4 4.6-5" stroke="#000" stroke-opacity=".45" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  flood: '<path d="M3 9c2 0 2-1.5 4.5-1.5S10 9 12 9s2-1.5 4.5-1.5S19 9 21 9M3 14c2 0 2-1.5 4.5-1.5S10 14 12 14s2-1.5 4.5-1.5S19 14 21 14M3 19c2 0 2-1.5 4.5-1.5S10 19 12 19s2-1.5 4.5-1.5S19 19 21 19" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
  barricade: '<rect x="3" y="7" width="18" height="6" rx="1" fill="currentColor"/><path d="M7 7l-3 6M12 7l-3 6M17 7l-3 6M21 8l-2.5 5" stroke="#000" stroke-opacity=".5" stroke-width="1.6"/><path d="M6 13v6M18 13v6" stroke="currentColor" stroke-width="1.8"/>',
  hwy: '<path d="M5 3h14l-1.5 4.5c2 2 3 4.6 1.6 8.2C17.4 19 14.6 21 12 22c-2.6-1-5.4-3-7.1-6.3C3.5 12.1 4.5 9.5 6.5 7.5z" fill="currentColor"/><path d="M8.5 11h7M8.5 14.5h7" stroke="#000" stroke-opacity=".5" stroke-width="1.7"/>',
  roadclosed: '<rect x="3" y="7" width="18" height="6" rx="1" fill="currentColor"/><path d="M7 7l-3 6M12 7l-3 6M17 7l-3 6M21 8l-2.5 5" stroke="#000" stroke-opacity=".5" stroke-width="1.6"/><path d="M6 13v6M18 13v6" stroke="currentColor" stroke-width="1.8"/>',
  police: '<path d="M12 2l8 3v6c0 5-3.4 8.6-8 11-4.6-2.4-8-6-8-11V5z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7.5l1.3 2.7 3 .4-2.2 2.1.5 3-2.6-1.4-2.6 1.4.5-3-2.2-2.1 3-.4z" fill="currentColor"/>',
  signal: '<rect x="8" y="2" width="8" height="17" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="6.5" r="1.8" fill="#ff4438"/><circle cx="12" cy="10.5" r="1.8" fill="#ffb020"/><circle cx="12" cy="14.5" r="1.8" fill="#39d98a"/><path d="M12 19v3" stroke="currentColor" stroke-width="1.8"/>',
  road: '<path d="M8 2L5 22M16 2l3 20M12 4v3M12 10v3M12 16v3" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
  hood: '<path d="M3 11l5-4 5 4v9H3zM13 13l4-3 4 3v7h-8" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linejoin="round"/><path d="M6.5 20v-4h3v4" stroke="currentColor" stroke-width="1.7" fill="none"/>',
  inspect: '<circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M16 16l5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  local: '<path d="M3 11l5-4 5 4v9H3z" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linejoin="round"/><circle cx="17.5" cy="15.5" r="4.5" stroke="currentColor" stroke-width="1.7" fill="none"/><path d="M14.4 18.6l6.2-6.2" stroke="currentColor" stroke-width="1.7"/>',
  sign: '<rect x="3" y="4" width="18" height="10" rx="1.5" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M6 8h3M10.5 8h7M6 11h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M8 14v6M16 14v6" stroke="currentColor" stroke-width="1.8"/>',
  traffic: '<path d="M4 20c2-6 5-9 8-9s6-3 8-9" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round"/><path d="M4 14c2-3 4-4 6-4" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" opacity=".5"/>',
  tilt: '<path d="M3 17l9 4 9-4-9-4z" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linejoin="round"/><path d="M12 13V3M9 6l3-3 3 3" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round"/>',
  rain: '<path d="M7 15a4.5 4.5 0 1 1 1.4-8.8A5.5 5.5 0 0 1 19 8.5a3.5 3.5 0 0 1-.5 6.5z" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linejoin="round"/><path d="M9 18l-1 3M13 18l-1 3M17 18l-1 3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  moon: '<path d="M19 15.5A8 8 0 0 1 8.5 5a8 8 0 1 0 10.5 10.5z" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linejoin="round"/>',
  sun: '<circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.7" fill="none"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  crash: '<path d="M12 2l2.2 6.3L21 9l-5.2 4.3L17.4 21 12 17.3 6.6 21l1.6-7.7L3 9l6.8-.7z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/>',
  speedcam: '<rect x="3" y="7" width="13" height="10" rx="2" fill="currentColor"/><circle cx="9.5" cy="12" r="2.6" fill="#000" opacity=".55"/><path d="M16 10l5-2.5v9L16 14z" fill="currentColor"/><path d="M5 4h4" stroke="currentColor" stroke-width="2"/>',
  redlight: '<rect x="7" y="2" width="10" height="20" rx="3" fill="currentColor"/><circle cx="12" cy="7" r="2.3" fill="#000" opacity=".6"/><circle cx="12" cy="12" r="2.3" fill="#000" opacity=".35"/><circle cx="12" cy="17" r="2.3" fill="#000" opacity=".35"/>',
  cone: '<path d="M10 3h4l4.5 15h-13z" fill="currentColor"/><path d="M8.3 9.5h7.4M7 14h10" stroke="#fff" stroke-width="1.8"/><rect x="3" y="18" width="18" height="3" rx="1" fill="currentColor"/>',
  fire: '<path d="M12 2c1 3.5 5 5.5 5 11a5 5 0 0 1-10 0c0-2.4 1-4 2.4-5.4.2 1.9 1 3 2.1 3.4C11 8.6 11 5 12 2z" fill="currentColor"/>',
  medical: '<rect x="3" y="3" width="18" height="18" rx="4" fill="currentColor"/><path d="M12 7v10M7 12h10" stroke="#000" stroke-opacity=".55" stroke-width="2.6"/>',
  snow: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7M9 4l3 2.5L15 4M9 20l3-2.5 3 2.5" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>',
  fog: '<path d="M4 8h16M2 12h20M4 16h16M7 20h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  school: '<path d="M12 3l9.5 5L12 13 2.5 8z" fill="currentColor"/><path d="M6.5 10.5v5c0 1.6 2.5 3 5.5 3s5.5-1.4 5.5-3v-5M21 8.5v6" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round"/>',
  worship: '<path d="M12 2.5l3 4H9z" fill="currentColor"/><path d="M5 21V11l7-4.5 7 4.5v10z" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linejoin="round"/><path d="M10 21v-3.5a2 2 0 0 1 4 0V21" stroke="currentColor" stroke-width="1.7" fill="none"/>',
  crane: '<path d="M7 21V4.5M7 4.5h13.5M7 4.5L3 8h4M7 8.5l4-4M18 4.5v7" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/><rect x="16" y="11.5" width="4" height="3" fill="currentColor"/><path d="M3.5 21h7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  bus: '<rect x="4" y="3" width="16" height="15" rx="2.5" stroke="currentColor" stroke-width="1.7" fill="none"/><path d="M4 11h16" stroke="currentColor" stroke-width="1.7"/><circle cx="8" cy="14.5" r="1.2" fill="currentColor"/><circle cx="16" cy="14.5" r="1.2" fill="currentColor"/><path d="M7 18v2.5M17 18v2.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  pothole: '<ellipse cx="12" cy="15" rx="8.5" ry="4.5" fill="currentColor"/><path d="M6 9.5l1.8-3M12 8.5V4.5M18 9.5l-1.8-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  tree: '<circle cx="12" cy="9" r="6.5" fill="currentColor"/><path d="M12 15v6.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  camera: '<path d="M3 8h12l4-3v14l-4-3H3z" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linejoin="round"/><circle cx="9" cy="12" r="2.2" fill="currentColor"/>',
  tower: '<rect x="6" y="2.5" width="12" height="19" rx="1" stroke="currentColor" stroke-width="1.7" fill="none"/><path d="M9 6.5h2M13 6.5h2M9 10h2M13 10h2M9 13.5h2M13 13.5h2M10.5 21.5v-4h3v4" stroke="currentColor" stroke-width="1.6"/>',
};
const svg = (k, col) => `<svg viewBox="0 0 24 24" ${col ? `style="color:${col}"` : ''}>${IC[k] || ''}</svg>`;
const INC = {
  hwy: { name: 'Highway closure', col: '#ff6a3d' },
  collision: { name: 'Collision', col: '#ff4438' }, power: { name: 'Power outage', col: '#ffd23f' }, water: { name: 'Water main break', col: '#52a8ff' },
  closure: { name: 'Police investigation', col: '#52c7ff' }, flood: { name: 'Flooded underpass', col: '#4f8dff' }, barricade: { name: "Residents' barricade", col: '#b98cff' }, roadclosed: { name: 'Road closed', col: '#ffb020' }, call: { name: 'Police call', col: '#52c7ff' },
};
// Live mode: the news only covers police, fire and ambulance incidents (not roadwork, detours, GO gates, school runs...)
const isNews = i => LV.kind !== 'live' || i.type === 'call' || i.type === 'collision' || i.type === 'closure' || (i.type === 'hwy' && i.crash);
const SRC_COL = { tps: '#52c7ff', tfs: '#ff5a3c', '511': '#ff6a3d' };
function im(i) { if (i.type === 'call') { const med = i.act === 'medical'; return { name: i.label || (i.src === 'tfs' ? 'Fire call' : 'Police call'), col: med ? '#ff4438' : SRC_COL[i.src] || '#52c7ff', icon: med ? 'medical' : i.src === 'tfs' ? 'fire' : 'police' }; } const m = INC[i.type] || INC.call; if (i.type === 'hwy') { const lab = i.real && i.real.label; return i.crash ? { name: i.real && i.desc ? 'Highway: ' + i.desc.split(/ on HWY/i)[0].trim() : 'Highway crash', col: '#ff2d2d', icon: 'collision' } : { name: lab ? 'Highway work: ' + lab : 'Highway closure', col: '#ffb020', icon: 'cone' }; }
  return i.type === 'roadclosed' ? Object.assign({}, m, { icon: 'cone' }) : m; }
const pathCache = {}; function iconPath(k) { if (!pathCache[k]) { pathCache[k] = new Image(); pathCache[k].src = 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24">${k === 'coneDark' ? IC.cone.replace(/currentColor/g, '#1a1205') : (IC[k] || '').replace(/currentColor/g, '#fff')}</svg>`); } return pathCache[k]; }

// ---------------------------------------------------------------- geometry helpers
const rev = new Int32Array(E).fill(-1); { const m = new Map(); for (let e = 0; e < E; e++) { const k = G.go[e]; if (m.has(k)) { rev[e] = m.get(k); rev[m.get(k)] = e; } else m.set(k, e); } }
function pts(e) { const go = G.go[e], gc = G.gc[e], o = []; for (let i = 0; i < gc; i++) o.push([G.geo[(go + i) * 2], G.geo[(go + i) * 2 + 1]]); if (G.rev[e]) o.reverse(); return o; }
const nm = e => G.name[e] >= 0 ? G.names[G.name[e]] : 'Unnamed road';
let bbox = [1e9, 1e9, -1e9, -1e9]; for (let i = 0; i < G.nx.length; i++) { bbox[0] = Math.min(bbox[0], G.nx[i]); bbox[1] = Math.min(bbox[1], G.ny[i]); bbox[2] = Math.max(bbox[2], G.nx[i]); bbox[3] = Math.max(bbox[3], G.ny[i]); }
// spatial grid of geometry segments
const GC = 250, grid = new Map();
for (let e = 0; e < E; e++) { if (rev[e] >= 0 && rev[e] < e) continue; const p = pts(e); for (let i = 0; i < p.length - 1; i++) { const x0 = Math.min(p[i][0], p[i + 1][0]), x1 = Math.max(p[i][0], p[i + 1][0]), y0 = Math.min(p[i][1], p[i + 1][1]), y1 = Math.max(p[i][1], p[i + 1][1]); for (let cx = Math.floor(x0 / GC); cx <= Math.floor(x1 / GC); cx++) for (let cy = Math.floor(y0 / GC); cy <= Math.floor(y1 / GC); cy++) { const k = cx * 100003 + cy; let a = grid.get(k); if (!a) grid.set(k, a = []); if (a[a.length - 1] !== e) a.push(e); } } }
function segD(px, py, ax, ay, bx, by) { const vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy || 1; let t = ((px - ax) * vx + (py - ay) * vy) / l2; t = Math.max(0, Math.min(1, t)); const dx = px - ax - t * vx, dy = py - ay - t * vy; return [Math.sqrt(dx * dx + dy * dy), (vx * (py - ay) - vy * (px - ax))]; }
function nearestRoad(x, y, r, pred) { let best = -1, bd = r, side = 0; const c0x = Math.floor((x - r) / GC), c1x = Math.floor((x + r) / GC), c0y = Math.floor((y - r) / GC), c1y = Math.floor((y + r) / GC);
  for (let cx = c0x; cx <= c1x; cx++) for (let cy = c0y; cy <= c1y; cy++) { const a = grid.get(cx * 100003 + cy); if (!a) continue; for (const e of a) { if (pred && !pred(e)) continue; const p = pts(e); for (let i = 0; i < p.length - 1; i++) { const [d, cr] = segD(x, y, p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]); if (d < bd) { bd = d; best = e; side = cr; } } } }
  if (best < 0) return null; // side>0 => point is on the right of travel direction (map y-down cross)
  let dirE = best; if (rev[best] >= 0 && side < 0) dirE = rev[best]; return { e: dirE, d: bd }; }
const ctrlAppr = G.ctrls.map(() => []); for (let e = 0; e < E; e++) if (G.ctrl[e] >= 0) ctrlAppr[G.ctrl[e]].push(e);
function ctrlName(c) { const s = new Set(); for (const e of ctrlAppr[c]) if (G.name[e] >= 0) s.add(G.names[G.name[e]]); const a = [...s]; return a.length > 1 ? a.slice(0, 2).join(' & ') : a[0] || 'Intersection'; }
const nodeIn = new Map(); for (let e = 0; e < E; e++) { const b = G.eb[e]; if (!nodeIn.has(b)) nodeIn.set(b, []); nodeIn.get(b).push(e); }
// road label candidates
const labelCand = []; { const lastByName = new Map(); const order = []; for (let e = 0; e < E; e++) if (G.cls[e] <= 3 && G.name[e] >= 0 && (rev[e] < 0 || rev[e] > e) && G.len[e] > 180) order.push(e); order.sort((a, b) => G.cls[a] - G.cls[b] || G.len[b] - G.len[a]);
  for (const e of order) { const p = pts(e); const m = Math.floor((p.length - 1) / 2); const a = p[m], b = p[m + 1] || p[m]; const x = (a[0] + b[0]) / 2, y = (a[1] + b[1]) / 2; const n = G.names[G.name[e]]; const prev = lastByName.get(n) || []; if (prev.some(q => (q[0] - x) ** 2 + (q[1] - y) ** 2 < 1600 ** 2)) continue; prev.push([x, y]); lastByName.set(n, prev); let ang = Math.atan2(b[1] - a[1], b[0] - a[0]); labelCand.push({ x, y, ang, n: n.replace(/ Avenue( East)?$/, ' Ave').replace(/ Road$/, ' Rd').replace(/ Drive$/, ' Dr').replace(/ Boulevard$/, ' Blvd').replace(/ Street( East)?$/, ' St').replace('Highway 401 Express', '401 Express').replace('Highway 401 Collector', '401 Collector'), cls: G.cls[e] }); } }

// ---------------------------------------------------------------- state
let mode = 'shift', profile = 'rush', worker = null, ready = false, simT = 6 * 3600, speed = 10, lastSpeed = 10;
let posBuf = new Float32Array(4 * 15000), spareBuf = new Float32Array(4 * 15000), frameN = 0, frameWaiting = false, lastSlow = 0;
let summary = null, incidents = [], units = [], pool = { police: 6, tow: 4, hydro: 2, water: 2 };
let tool = 'inspect', overlayOn = true, tilt = 0, tiltGoal = 0, selection = null;
const zones = [], signs = []; let reqSeq = 1; const pending = new Map();
let rainOn = 0, snowOn = 0, fogOn = 0, stormOn = 0, flash = 0, nextFlash = 0, ended = false;
const seenInc = new Set();

// ---------------------------------------------------------------- renderer
const glc = $('gl'), ovc = $('ov'), ov = ovc.getContext('2d');
R.init(glc, G, isPhone ? 'phone' : 'high');
const cam = R.cam;
let DPR = Math.min(window.devicePixelRatio || 1, isPhone ? 1.75 : 2);
function resize() { const w = innerWidth, h = innerHeight; R.resize(w, h, DPR); ovc.width = Math.round(w * DPR); ovc.height = Math.round(h * DPR); layout(); }
function fitView(anim) {
  const cx = (bbox[0] + bbox[2]) / 2, cy = (bbox[1] + bbox[3]) / 2; const asp = innerWidth / innerHeight; const tan = Math.tan(20 * Math.PI / 180);
  const topPad = 60, botPad = 20; const usable = Math.max(200, innerHeight - topPad - botPad) / innerHeight;
  const hH = (bbox[3] - bbox[1]) * 1.04 / (2 * tan * usable), hW = (bbox[2] - bbox[0]) * 1.06 / (2 * tan * asp);
  const h = Math.max(hH, hW); const goal = { x: cx, y: cy + (topPad - botPad) / 2 * (2 * h * tan / innerHeight) * -1, h };
  if (anim) camGoal = goal; else { cam.x = goal.x; cam.y = goal.y; cam.h = goal.h; }
}
let camGoal = null;
function flyTo(x, y, h) { camGoal = { x, y: y + (sheetOpen() ? (2 * h * Math.tan(20 * Math.PI / 180) / innerHeight) * innerHeight * 0.16 : 0), h }; }
function sheetOpen() { return !$('sheet').hidden && innerWidth < 900; }
function layout() { const hud = $('hud'), hb = hud.hidden ? 0 : hud.getBoundingClientRect().bottom; $('ticker').style.top = (hb + 4) + 'px'; $('feed').style.top = (hb + 4) + 'px'; }

// ---------------------------------------------------------------- input: pan, pinch, wheel, tilt
const ptrs = new Map(); let pinch = null, tap = null, dragMoved = false;
glc.addEventListener('pointerdown', e => { DIR.userInput(); if ($('feed').hidden === false || $('chips').hidden === false) closePanels(); glc.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, b: e.button }); camGoal = null; audioInit();
  if (ptrs.size === 1) { tap = { x: e.clientX, y: e.clientY, t: performance.now() }; dragMoved = false; } else { tap = null; const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), h: cam.h, my: (a.y + b.y) / 2, pitch: cam.pitch, mid: R.unproject((a.x + b.x) / 2, (a.y + b.y) / 2) }; } });
glc.addEventListener('pointermove', e => { const p = ptrs.get(e.pointerId); if (!p) { hover(e.clientX, e.clientY); return; }
  if (ptrs.size === 1) { const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (p.b === 2 || e.shiftKey) { cam.pitch = Math.max(0, Math.min(0.95, cam.pitch + dy * 0.004)); tiltGoal = cam.pitch; }
    else { const a = R.unproject(p.x, p.y), b = R.unproject(e.clientX, e.clientY); if (a && b) { cam.x -= b[0] - a[0]; cam.y -= b[1] - a[1]; clampCam(); } }
    if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 9) { tap = null; dragMoved = true; } }
  p.x = e.clientX; p.y = e.clientY;
  if (ptrs.size === 2 && pinch) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); cam.h = clampH(pinch.h * pinch.d / Math.max(20, d));
    const my = (a.y + b.y) / 2; cam.pitch = Math.max(0, Math.min(0.95, pinch.pitch + (pinch.my - my) * 0.004)); tiltGoal = cam.pitch;
    R.updateCam(); const m = R.unproject((a.x + b.x) / 2, (a.y + b.y) / 2); if (m && pinch.mid) { cam.x += pinch.mid[0] - m[0]; cam.y += pinch.mid[1] - m[1]; } clampCam(); } });
function endPtr(e) { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null; if (tap && ptrs.size === 0 && performance.now() - tap.t < 500) onTap(tap.x, tap.y); if (ptrs.size === 0) tap = null; }
glc.addEventListener('pointerup', endPtr); glc.addEventListener('pointercancel', e => { ptrs.delete(e.pointerId); tap = null; pinch = null; });
glc.addEventListener('contextmenu', e => e.preventDefault());
glc.addEventListener('wheel', e => { e.preventDefault(); DIR.userInput(); camGoal = null; const before = R.unproject(e.clientX, e.clientY); cam.h = clampH(cam.h * Math.exp(e.deltaY * 0.0012)); R.updateCam(); const after = R.unproject(e.clientX, e.clientY); if (before && after) { cam.x += before[0] - after[0]; cam.y += before[1] - after[1]; } clampCam(); }, { passive: false });
function clampH(h) { return Math.max(140, Math.min(42000, h)); }
function clampCam() { cam.x = Math.max(bbox[0] - 3000, Math.min(bbox[2] + 3000, cam.x)); cam.y = Math.max(bbox[1] - 3000, Math.min(bbox[3] + 4000, cam.y)); }
addEventListener('keydown', e => { if (e.key === ' ') { e.preventDefault(); setSpeed(speed ? 0 : lastSpeed || 10); } if (e.key === 'Escape') closeSheet(); });

// ---------------------------------------------------------------- worker
function startWorker(opts) {
  const blob = new Blob([SIMSRC], { type: 'text/javascript' }); worker = new Worker(URL.createObjectURL(blob));
  worker.onmessage = onWorker; worker.onerror = e => { $('loadTxt').textContent = 'Simulation failed to start: ' + (e.message || 'unknown error'); };
  worker.postMessage({ type: 'init', graph: G, opts });
}
function cmd(fn, ...args) { return new Promise(res => { const id = reqSeq++; pending.set(id, res); worker.postMessage({ type: 'cmd', id, fn, args }); }); }
function onWorker(m) {
  const d = m.data;
  if (d.type === 'progress') { $('loadBar').style.width = Math.round(d.p * 100) + '%'; $('loadTxt').textContent = 'Morning traffic is building…'; }
  else if (d.type === 'ready') { ready = true; setTimeout(liveAfterReady, 400); $('skipBtn').hidden = LV.kind !== 'replay'; $('h24Btn').hidden = !LV.kind; if (LV.kind === 'replay') h24Set(true); simT = d.t; summary = d.summary; $('start').hidden = true; $('hud').hidden = false; $('tools').hidden = false; buildHud(); layout(); setSpeed(mode === 'shift' ? 10 : LV.kind === 'live' ? 1 : LV.kind === 'replay' ? 10 : 4); if (mode === 'watch') DIR.auto = true; updateLiveUI(); requestFrame(); if (!LV.kind) toast('OPS', mode === 'shift' ? 'Shift started. Tap anything on the map to inspect it.' : mode === 'watch' ? 'The city runs itself. Touch the map to take over.' : 'Sandbox. Tap the crash icon (bottom right) to cause trouble.', 'var(--amber)'); }
  else if (d.type === 'frame') {
    frameWaiting = false; spareBuf = posBuf; posBuf = d.buf; frameN = d.n; simT = d.t; rainOn = d.rain; snowOn = d.snow; fogOn = d.fog; stormOn = d.storm; onWorld(d);
    if (d.spd) { R.setSpeeds(d.spd, d.cut); R.setSignals(d.sig); summary = d.summary; incidents = d.incidents; units = d.units; pool = d.summary.pool; updateHud(); updateFeed(); refreshSheet(); try { DIR.onSlow(); } catch (err) { console.error(err); } }
  }
  else if (d.type === 'events') d.events.forEach(onEvent);
  else if (d.type === 'reply') { const r = pending.get(d.id); pending.delete(d.id); r && r(d.r); }
}
function requestFrame() { if (!worker || frameWaiting) return; frameWaiting = true; const now = performance.now(); const slow = now - lastSlow > 450; if (slow) lastSlow = now; if (spareBuf.byteLength === 0) spareBuf = new Float32Array(4 * 15000); worker.postMessage({ type: 'frame', buf: spareBuf, wantSlow: slow }, [spareBuf.buffer]); }
function setSpeed(v) { if (v) lastSpeed = v; speed = v; worker && worker.postMessage({ type: 'speed', v }); $('playBtn').textContent = v ? '❚❚' : '▶'; $('speedBtn').textContent = lastSpeed + '×'; }

// ---------------------------------------------------------------- events
const hoodN = G.hoods.map(h => h.n);
function onEvent(e) {
  const at = clock(e.t);
  switch (e.k) {
    case 'incident': { const i = e.inc; if (i.type === 'barricade' || !isNews(i)) break; const meta = im(i);
      if (i.real || i.type === 'call') { if (i.type === 'call' && i.act !== 'police_crit' && i.act !== 'fire_struct') snd('radio'); else snd(i.type === 'collision' ? 'crash' : 'alert'); toast(i.real ? (i.real.src === 'tfs' ? 'TFS' : i.real.src === '511' ? '511' : 'TPS') : i.src === 'tfs' ? 'FIRE' : 'POLICE', `${meta.name}${i.name ? ' · ' + i.name : ''}${i.real ? ' <span class="real">REAL</span>' : ''}`, meta.col, () => select({ k: 'inc', id: i.id })); break; }
      snd(i.type === 'collision' ? 'crash' : i.type === 'power' ? 'zap' : 'alert');
      toast(i.type === 'closure' ? 'POLICE' : '911', `${meta.name} on ${i.name}. ${i.type === 'collision' ? (i.sev === 2 ? 'All lanes blocked.' : 'Lanes blocked.') : i.type === 'power' ? 'Traffic signals are dark.' : i.type === 'water' ? 'Road is closed both ways.' : i.type === 'closure' ? 'The intersection is shut.' : i.type === 'flood' ? 'Underpass is under water.' : i.type === 'hwy' ? (i.crash ? 'Tractor-trailer rollover. Lanes blocked.' : 'OPP are shutting it down.') : ''}`, meta.col, () => select({ k: 'inc', id: i.id })); break; }
    case 'dispatched': snd('radio'); break;
    case 'arrived': snd('radio'); toast('CREW', `${e.kind === 'tow' ? 'Tow truck' : e.kind === 'hydro' ? 'Toronto Hydro' : 'Toronto Water'} on scene at ${e.inc.name} after ${e.mins} min. Work underway.`, 'var(--amber)'); break;
    case 'cleared': if (e.why === 'reset') break; if (e.inc.type === 'roadclosed') break; snd('clear'); if (e.inc.type === 'call' && !(e.inc.act === 'police_crit' || e.inc.act === 'fire_struct' || e.inc.act === 'gas')) break; toast('CLEAR', `${im(e.inc).name} on ${e.inc.name} is cleared${e.why === 'crew' ? '' : ''}. Traffic will recover.`, 'var(--green)'); break;
    case 'policeSent': snd('radio'); break;
    case 'policeOn': toast('POLICE', `Officer directing traffic at ${e.name} (arrived in ${e.mins} min).`, 'var(--cyan)'); break;
    case 'policeOff': toast('POLICE', `Officer at ${e.name} is back on patrol.`, 'var(--cyan)'); break;
    case 'complaint': snd('phone'); toast('311', e.lvl === 1 ? `${e.hood}: residents report heavy cut-through traffic${e.street ? ' on ' + e.street : ''}.` : `${e.hood} is furious. Residents say they'll block ${e.street || 'the street'} themselves.`, 'var(--violet)', () => select({ k: 'hood', h: e.h })); break;
    case 'barricade': snd('alert'); toast('311', `${e.hood} residents have blocked ${e.street} with their cars and bins.`, 'var(--violet)'); break;
    case 'rain': if (e.on) { toast('WEATHER', e.live ? (e.snow ? 'Real snow is falling in Scarborough. Drivers are slowing down and leaving bigger gaps.' : e.storm ? 'A real thunderstorm is over Scarborough. Roads are slick.' : 'It is raining in Scarborough right now. Drivers are slowing down.') : 'Thunderstorm moving in. Roads are slick and underpasses may flood.', '#7aa7ff'); nextFlash = performance.now() + 4000; } else toast('WEATHER', 'Rain is easing off.', '#7aa7ff'); break;
    case 'emsArrived': if (e.mins > e.free + 3) toast('EMS', `Ambulance reached ${e.hood} in ${e.mins} min. Normally ${e.free} min.`, 'var(--red)'); break;
    case 'retimed': toast('SIGNALS', `Retimed ${e.name}.`, 'var(--amber)'); break;
    default: if (LV.kind !== 'live') cityEvent(e); else if (e.k === 'gate') cityEvent(Object.assign({}, e, { quiet: 1 }));
  }
  try { DIR.onEvent(e); } catch (err) { console.error(err); }
}
function clock(t, withAmPm) { const h = Math.floor(t / 3600) % 24, m = Math.floor(t % 3600 / 60); const h12 = ((h + 11) % 12) + 1; return `${h12}:${String(m).padStart(2, '0')}${withAmPm ? (h < 12 ? ' AM' : ' PM') : ''}`; }

// ---------------------------------------------------------------- ticker: one line under the bar; radio captions take it over while they play; everything lands in the log
const TK = { q: [], cur: null, cap: null, timer: 0, log: [] };
function tickerShow(it) {
  const el = $('ticker'); if (!it) { el.hidden = true; return; }
  el.hidden = false; el.className = (it.cap ? 'cap ' : '') + (it.go ? 'act' : ''); el.style.setProperty('--c', it.col);
  el.innerHTML = `<span class="src">${it.src}</span><span class="msg">${it.msg}</span>`; el.onclick = it.go ? () => { it.go(); tickerNext(); } : null;
}
function tickerNext() { clearTimeout(TK.timer); if (TK.cap) return tickerShow(TK.cap); const it = TK.cur = TK.q.shift() || null; tickerShow(it); if (it) TK.timer = setTimeout(tickerNext, TK.q.length ? 2500 : it.go ? 6500 : 4500); }
function toast(src, msg, col, go) {
  const it = { src, msg, col: col || 'var(--cyan)', go, t: simT }; TK.log.unshift(it); if (TK.log.length > 40) TK.log.pop();
  TK.q.push(it); if (TK.q.length > 3) TK.q.shift(); if (!TK.cur && !TK.cap) tickerNext(); if (!$('feed').hidden) updateFeed();
}
function caption(src, text, anchor, ms) { // dispatch / news anchor speaking
  const c = TK.cap = { src, msg: text.replace(/[&<]/g, ch => ch === '&' ? '&amp;' : '&lt;'), col: anchor ? '#d7141a' : '#3b5266', cap: true };
  if (TK.cur) { TK.q.unshift(TK.cur); TK.cur = null; } tickerNext(); setTimeout(() => { if (TK.cap === c) { TK.cap = null; tickerNext(); } }, ms);
}

// ---------------------------------------------------------------- HUD
function setMuted(m) { muted = m; store.set('muted', m); if (master) master.gain.setTargetAtTime(m ? 0 : 0.8, AC.currentTime, 0.05); const w = document.getElementById('muteWave'); if (w) w.style.opacity = m ? 0.15 : 1; }
function buildHud() {
  $('muteBtn').onclick = () => { audioInit(); setMuted(!muted); }; setMuted(muted);
  const speeds = isPhone ? [1, 4, 10] : [1, 4, 10, 20];
  $('playBtn').onclick = () => { setSpeed(speed ? 0 : lastSpeed); snd('ui'); };
  $('speedBtn').onclick = () => { setSpeed(speeds[(speeds.indexOf(lastSpeed) + 1) % speeds.length]); snd('ui'); };
  $('statBtn').onclick = () => togglePanel('chips', 'statBtn'); $('incBtn').onclick = () => togglePanel('feed', 'incBtn');
  $('progWrap').hidden = mode !== 'shift';
  const tr = $('toolRow'); tr.querySelectorAll('.tool:not(#camBtn):not(#muteBtn):not(#h24Btn)').forEach(b => b.remove());
  const tools = [['traffic', 'Traffic colours'], ['tilt', '3D view'], ['sign', 'Warning sign'], ['local', 'Local traffic only'], ['inspect', 'Inspect']];
  if (mode === 'whatif') tools.splice(4, 0, ['cause', 'Cause trouble']);
  tools.forEach(([k, l], i) => { const b = document.createElement('button'); b.className = 'tool' + (i === 0 || i === 2 ? ' sep' : ''); b.type = 'button'; b.id = 'tool-' + k; b.title = l; b.setAttribute('aria-label', l); b.innerHTML = svg(k === 'cause' ? 'crash' : k); b.onclick = () => onTool(k); tr.appendChild(b); });
  const cr = $('causeRow'); cr.innerHTML = '';
  for (const [k, l, ic] of [['crash', 'Crash', 'collision'], ['water', 'Water main', 'water'], ['closure', 'Police closure', 'closure'], ['power', 'Power cut', 'power'], ['rain', 'Storm', 'rain'], ['close', 'Close road', 'roadclosed']]) { const b = document.createElement('button'); b.className = 'tool cause'; b.type = 'button'; b.id = 'tool-' + k; b.title = l; b.setAttribute('aria-label', l); b.innerHTML = svg(ic); b.onclick = () => onTool(k); cr.appendChild(b); }
  syncTools();
}
let panelTimer = 0;
function closePanels() { for (const [p, b] of [['chips', 'statBtn'], ['feed', 'incBtn']]) { $(p).hidden = true; $(b).setAttribute('aria-expanded', 'false'); } clearTimeout(panelTimer); layout(); }
function togglePanel(id, btn) { // stats row and incident list: open on tap, close on a second tap or a touch on the map (stats also close themselves)
  const el = $(id), open = el.hidden; closePanels();
  el.hidden = !open; $(btn).setAttribute('aria-expanded', String(open)); snd('ui');
  if (open && id === 'chips') panelTimer = setTimeout(closePanels, 8000);
  if (open) { updateHud(); updateFeed(); } layout();
}
function syncTools() {
  document.querySelectorAll('.tool').forEach(b => { const k = b.id.slice(5); let on = k === tool; if (k === 'traffic') on = overlayOn; if (k === 'tilt') on = tiltGoal > 0.1; if (k === 'cause') on = !$('causeRow').hidden; if (k === 'rain') on = !!rainOn; if (b.id === 'h24Btn') on = H24.on; b.setAttribute('aria-pressed', String(on)); });
  const hints = { local: 'Tap a neighbourhood street to make it local traffic only. Tap again to remove.', sign: 'Tap where drivers should see a warning sign. They will reroute.', crash: 'Tap a road to cause a crash.', water: 'Tap a road to break a water main under it.', closure: 'Tap an intersection to have police close it.', power: 'Tap a spot to cut the power there.', close: 'Tap a road to close or reopen it.' };
  const h = $('hint'); if (hints[tool]) { h.textContent = hints[tool]; h.hidden = false; } else h.hidden = true;
}
function onTool(k) {
  snd('ui');
  if (k === 'traffic') { overlayOn = !overlayOn; return syncTools(); }
  if (k === 'tilt') { tiltGoal = tiltGoal > 0.1 ? 0 : 0.78; return syncTools(); }
  if (k === 'cause') { $('causeRow').hidden = !$('causeRow').hidden; if ($('causeRow').hidden && ['crash', 'water', 'closure', 'power', 'close'].includes(tool)) tool = 'inspect'; return syncTools(); }
  if (k === 'rain') { cmd('toggleRain').then(r => { rainOn = r.v; syncTools(); }); return; }
  tool = tool === k ? 'inspect' : k; closeSheet(); syncTools();
}
function baselineAt(t) { const b = G.baseline || []; const i = Math.max(0, Math.min(b.length - 1, Math.round((t - 21600) / 300))); return b[i] || [0, 40, 0]; }
let hudT = 0;
function updateHud() {
  if (!summary) return; const s = summary;
  const h = Math.floor(simT / 3600) % 24; $('clk').textContent = clock(simT); const [dl, dd0] = dayLabel(); $('clkd').innerHTML = `${h < 12 ? 'AM' : 'PM'}<span class="dw"> · ${dl}</span><span class="dt"> ${dd0}</span>`;
  $('wx').innerHTML = snowOn ? IC.snow : rainOn ? IC.rain : fogOn ? IC.fog : envNight() > 0.5 ? IC.moon : IC.sun;
  if (mode === 'shift') $('prog').style.width = Math.max(0, Math.min(100, (simT - 21600) / (34200 - 21600) * 100)) + '%';
  const base = baselineAt(simT); const dd = s.recentDelay - (mode === 'shift' ? base[0] : 0);
  const chips = [];
  if (mode === 'shift') chips.push(['Trip delay', (Math.abs(dd) < 0.05 ? '' : dd >= 0 ? '+' : '−') + Math.abs(dd).toFixed(1) + ' min', dd > 2.5 ? 'bad' : dd > 0.8 ? 'warn' : 'good', 'vs a normal Tuesday']);
  else chips.push(['Trip delay', s.recentDelay.toFixed(1) + ' min', s.recentDelay > 6 ? 'bad' : s.recentDelay > 3 ? 'warn' : 'good']);
  chips.push(['Stuck >2 min', s.stuck.toLocaleString('en-CA'), s.stuck > 600 ? 'bad' : s.stuck > 250 ? 'warn' : '']);
  chips.push(['Avg speed', Math.round(s.avgKmh) + ' km/h', '']);
  chips.push(['Cars', s.cars.toLocaleString('en-CA'), '']);
  const maxA = Math.max(...s.anger); chips.push(['311 calls', String(s.complaints), s.complaints ? 'mood' : '']);
  if (mode === 'shift') chips.push(['EMS avg', s.emsN ? s.emsAvg.toFixed(1) + ' min' : '–', s.emsAvg > 6 ? 'bad' : '']);
  chips.push(['Police · Tow · Hydro · Water', `${pool.police} · ${pool.tow} · ${pool.hydro} · ${pool.water}`, '', 'Units free']);
  const sb = $('statBtn'); $('statV').textContent = chips[0][1]; sb.dataset.tone = chips[0][2]; sb.title = chips[0][3] || 'Average extra minutes per trip right now';
  const box = $('chips'); if (box.hidden) { if (mode === 'shift' && simT >= 34200 && !ended) endShift(); return; }
  if (box.children.length !== chips.length) { box.innerHTML = chips.map(() => '<div class="chip"><span class="k"></span><span class="v"></span></div>').join(''); requestAnimationFrame(layout); }
  chips.forEach((c, i) => { const el = box.children[i]; el.dataset.tone = c[2] || ''; el.children[0].textContent = c[0]; el.children[1].textContent = c[1]; el.title = c[3] || ''; });
  if (mode === 'shift' && simT >= 34200 && !ended) endShift();
}
function updateFeed() {
  const rank = i => i.type === 'call' ? (i.act === 'police_crit' || i.act === 'fire_struct' || i.act === 'gas' ? 1 : 2) : 0; const act = incidents.filter(i => i.state !== 'cleared' && i.type !== 'roadclosed').sort((a, b) => rank(a) - rank(b) || b.start - a.start);
  const btn = $('incBtn'); $('incN').textContent = act.length; btn.dataset.n = act.length; btn.dataset.tone = act.some(i => rank(i) < 2) ? 'bad' : act.length ? 'warn' : '';
  const feed = $('feed'); if (feed.hidden) return;
  const row = i => { const m = im(i); const st = i.type === 'call' ? (i.real ? 'Real call' : 'Call') : i.state === 'working' ? `Crew working · ${Math.max(0, Math.ceil((i.workUntil - simT) / 60))} min left` : i.state === 'enroute' ? 'Crew on the way' : needsCrew(i) ? 'Needs a crew' : i.type === 'closure' ? 'Police on scene' : i.type === 'barricade' ? 'Residents protesting' : i.type === 'flood' ? 'Draining' : 'Active';
    return `<button class="inc" type="button" data-inc="${i.id}">${svg(m.icon || i.type, m.col)}<span><span class="tt">${m.name}</span><span class="mm">${i.name || ''} · ${st}</span></span><span class="q" title="Cars stuck nearby">${i.queue > 20 ? Math.round(i.queue / 10) * 10 : ''}</span></button>`; };
  const html = `<h4>ACTIVE · ${act.length}</h4>${act.length ? act.slice(0, 30).map(row).join('') : '<div class="none">Nothing happening right now.</div>'}`
    + (TK.log.length ? `<h4>RECENT</h4>` + TK.log.map((it, n) => `<button class="logl" type="button" style="--c:${it.col}" ${it.go ? `data-go="${n}"` : ''}><time>${clock(it.t)}</time><b>${it.src}</b><span>${it.msg}</span></button>`).join('') : '');
  if (html === feed._html) return; feed._html = html; feed.innerHTML = html; // rebuilt only when something changed, so taps aren't lost
  feed.querySelectorAll('[data-inc]').forEach(b => b.onclick = () => { togglePanel('feed', 'incBtn'); select({ k: 'inc', id: +b.dataset.inc }); });
  feed.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { togglePanel('feed', 'incBtn'); TK.log[+b.dataset.go].go(); });
}
const SIM_SCALE = (G.demandW && G.demandW.scale) || 2.45;
const needsCrew = i => (['collision', 'power', 'water'].includes(i.type) || (i.type === 'hwy' && i.crash)) && i.state === 'active';
const CREW = { collision: ['tow', 'Send tow truck'], power: ['hydro', 'Send Toronto Hydro'], water: ['water', 'Send Toronto Water'], hwy: ['tow', 'Send heavy tow'] };

// ---------------------------------------------------------------- selection sheet
function select(sel) {
  selection = sel; renderSheet(true);
  const p = selPos(sel); if (p) flyTo(p[0], p[1], Math.min(cam.h, sel.k === 'hood' ? 5000 : 2600));
}
function selPos(sel) {
  if (!sel) return null;
  if (WORLD_SEL.has(sel.k)) return worldPos(sel);
  if (sel.k === 'inc') { const i = incidents.find(x => x.id === sel.id); return i ? [i.x, i.y] : null; }
  if (sel.k === 'ctrl') { const c = G.ctrls[sel.c]; return [c.x, c.y]; }
  if (sel.k === 'road') { const p = pts(sel.e); const m = p[Math.floor(p.length / 2)]; return m; }
  if (sel.k === 'hood') { const h = G.hoods[sel.h]; return [h.x, h.y]; }
}
function closeSheet() { selection = null; $('sheet').hidden = true; layout(); }
let sheetSig = null;
let lastCtrlRefresh = 0;
function sheetKey() { const s = selection; if (!s) return ''; if (WORLD_SEL.has(s.k)) return worldSheetKey(s); if (s.k === 'inc') { const i = incidents.find(x => x.id === s.id); return i ? `inc${i.id}${i.state}${pool.police}${pool.tow}${pool.hydro}${pool.water}` : 'gone'; } if (s.k === 'hood') return 'hood' + s.h; return s.k + JSON.stringify(s) + JSON.stringify(pool) + incidents.filter(i => i.state !== 'cleared').length; }
function refreshSheet() {
  if (!selection || $('sheet').hidden) return;
  if (selection.k === 'ctrl') { const si = $('splitIn'); if (document.activeElement === si || performance.now() - lastCtrlRefresh < 2500) return; lastCtrlRefresh = performance.now(); return renderSheet(false); }
  if (sheetKey() !== sheetSig) return renderSheet(false);
  // live numbers only
  if (selection.k === 'inc') { const i = incidents.find(x => x.id === selection.id); if (!i) return; const f = $('sheet').querySelectorAll('.fact b'); if (f.length >= 3) { f[0].textContent = i.queue; f[1].textContent = Math.round((simT - i.start) / 60) + ' min'; f[2].textContent = i.state === 'working' ? `Crew working · ${Math.max(0, Math.ceil((i.workUntil - simT) / 60))} min left` : i.state === 'enroute' ? 'Crew on the way' : i.state === 'cleared' ? 'Cleared' : 'Active'; } }
  if (selection.k === 'hood' && summary) { const h = selection.h; const f = $('sheet').querySelectorAll('.fact b'); if (f.length >= 2) { f[0].textContent = summary.anger[h] + '%'; f[1].textContent = Math.round(summary.cut[h]); } const m = $('sheet').querySelector('.meter i'); if (m) m.style.width = summary.anger[h] + '%'; }
}
async function renderSheet(fresh) {
  const sh = $('sheet'); const sel = selection; if (!sel) return;
  let html = '';
  if (sel.k === 'inc') {
    const i = incidents.find(x => x.id === sel.id); if (!i) { closeSheet(); return; }
    const m = im(i); const age = Math.round((simT - i.start) / 60);
    const desc = {
      collision: i.sev === 2 ? 'Every lane is blocked. Traffic behind it is trapped and drivers are turning down side streets.' : 'Lanes are blocked and drivers are squeezing past. Rubberneckers are slowing the other direction too.',
      power: 'The traffic signals in this area are dark, so every intersection runs as an all-way stop. Throughput collapses. Police can direct the worst ones while Hydro fixes it.',
      water: 'Water main break. The road is torn up and closed both ways. Toronto Water needs about 30 minutes on site once they arrive.',
      closure: 'Police have closed this intersection for an investigation. You can’t clear it. It reopens on its own in about an hour, so keep traffic moving around it.',
      flood: 'This underpass is under water. It reopens after the storm passes and the drains catch up.',
      barricade: 'Fed-up residents have blocked their street. It clears in about 30 minutes. Calm the neighbourhood by taking cut-through traffic off its streets.',
      roadclosed: 'You closed this road.',
      call: ({ police_crit: 'Police have taped off the intersection. Every approach is closed and drivers are detouring.', police_high: 'Two cruisers are parked at the curb with lights on. A lane is lost and drivers slow down to look.', fire_struct: 'Fire trucks fill the road. It is closed in both directions until crews are done.', gas: 'The road is closed while crews deal with the leak.', hydro: 'Wires are down. A lane is blocked and nearby traffic signals are dark.', medical: 'An ambulance is parked at the curb while paramedics work.', missing: 'Officers are canvassing the area. Traffic is unaffected.', hazard: 'Something is blocking a lane. Police are on scene until it is cleared.' })[i.act] || 'A cruiser is on scene. If the road is narrow, traffic slows to get past.',
      hwy: i.crash ? 'A tractor-trailer has rolled over. Every lane in this direction is blocked, OPP are holding traffic and a heavy tow is needed. Drivers are being forced off at the ramps onto local streets.' : 'The 401 is closed here. OPP are holding traffic at the ramps and every driver heading through is being pushed onto the arterials.',
    }[i.type];
    const state = i.state === 'cleared' ? 'Cleared' : i.state === 'working' ? `Crew working · ${Math.max(0, Math.ceil((i.workUntil - simT) / 60))} min left` : i.state === 'enroute' ? 'Crew on the way' : 'Active';
    html = `<div class="sh-head">${svg(m.icon || i.type, m.col)}<div><h2>${m.name}</h2><div class="sub">${i.name}${i.hood !== undefined ? ' · ' + hoodN[i.hood] : ''}</div></div><button class="sh-x" type="button" aria-label="Close">×</button></div>
      <div class="facts"><div class="fact"><b>${i.queue}</b><span>Cars stuck nearby</span></div><div class="fact"><b>${age} min</b><span>Since reported</span></div><div class="fact"><b style="font-size:13px;line-height:1.5">${state}</b><span>Status</span></div></div>
      <div class="sh-body">${desc}</div>${realLine(i)}<div class="acts">`;
    if (CREW[i.type] && i.state === 'active' && (i.type !== 'hwy' || i.crash)) { const [k, l] = CREW[i.type]; html += `<button class="act primary" type="button" data-a="crew" ${pool[k] > 0 ? '' : 'disabled'}>${l} <small>${pool[k]} free</small></button>`; }
    const nc = nearestCtrl(i.x, i.y, i.type === 'power' ? i.r : 900, i.type === 'power');
    if (nc >= 0 && i.state !== 'cleared') html += `<button class="act" type="button" data-a="police" data-c="${nc}" ${pool.police > 0 ? '' : 'disabled'}>Officer to ${ctrlName(nc)} <small>${pool.police} free</small></button>`;
    if (nearestCam(i.x, i.y) >= 0) html += `<button class="act" type="button" data-a="cam">Nearest camera</button>`;
    if (i.state !== 'cleared') html += `<button class="act" type="button" data-a="sign">Warning sign upstream</button>`;
    if (i.type === 'roadclosed' || (i.type === 'hwy' && !i.crash)) html += `<button class="act" type="button" data-a="reopen">${i.type === 'hwy' ? 'Reopen the 401' : 'Reopen road'}</button>`;
    html += `</div>`;
  } else if (WORLD_SEL.has(sel.k)) { html = worldSheetHtml(sel); if (!html) { closeSheet(); return; }
  } else if (sel.k === 'ctrl') {
    const sig = await cmd('getSignal', sel.c); if (selection !== sel) return;
    const pct = Math.round(sig.split * 100);
    html = `<div class="sh-head">${svg('signal')}<div><h2>${sig.name}</h2><div class="sub">${sig.dark ? 'Signals dark (power out)' : sig.police ? 'Officer directing traffic' : `Signal · ${sig.cycle} s cycle`}</div></div><button class="sh-x" type="button" aria-label="Close">×</button></div>
      <div class="split"><div class="names"><span><b>${sig.g0}</b></span><span style="text-align:right"><b>${sig.g1}</b></span></div>
      <input type="range" id="splitIn" min="20" max="80" value="${pct}" aria-label="Green time split" ${sig.dark || sig.police ? 'disabled' : ''}>
      <div class="q"><span>${pct}% green · ${sig.q[0]} waiting</span><span>${100 - pct}% green · ${sig.q[1]} waiting</span></div></div>
      ${sig.count ? `<div class="facts"><div class="fact"><b>${sig.count.am.toLocaleString('en-CA')}</b><span>Real AM peak hour (${sig.count.date.slice(0, 4)})</span></div><div class="fact"><b>${Math.round(sig.flow * SIM_SCALE).toLocaleString('en-CA')}</b><span>Simulated, vehicles/hr now</span></div><div class="fact"><b>${Math.round(sig.count.heavy * 100)}%</b><span>Trucks (real)</span></div></div><div class="sh-body" style="font-size:12px;color:var(--muted)">City of Toronto turning-movement count at ${sig.count.n}. Each simulated car stands for about ${SIM_SCALE.toFixed(1)} real ones.</div>` : ''}
      <div class="acts">${sig.police ? `<button class="act" type="button" data-a="recall">Send officer back</button>` : `<button class="act primary" type="button" data-a="police" data-c="${sel.c}" ${pool.police > 0 ? '' : 'disabled'}>Officer directs traffic <small>${pool.police} free</small></button>`}
      ${mode === 'whatif' ? `<button class="act danger" type="button" data-a="causeClosure">Police close it</button><button class="act danger" type="button" data-a="causePowerHere">Cut power here</button>` : ''}</div>`;
  } else if (sel.k === 'road') {
    const e = sel.e; const sp = summary ? null : null; const lim = G.spd[e]; const closed = incidents.find(i => i.type === 'roadclosed' && i.state !== 'cleared' && i.edges && i.edges.includes(e));
    const rz = LV.zones.find(z => z.on && z.edges.includes(e)); const res = G.cls[e] === 5; const zone = zones.find(z => (z.x - sel.x) ** 2 + (z.y - sel.y) ** 2 < z.r * z.r);
    html = `<div class="sh-head">${svg('road')}<div><h2>${nm(e)}</h2><div class="sub">${['Highway', 'Ramp', 'Major arterial', 'Arterial', 'Collector', 'Neighbourhood street'][G.cls[e]]} · ${lim} km/h · ${G.lanes[e]} lane${G.lanes[e] > 1 ? 's' : ''} this way · ${hoodN[G.hood[G.ea[e]]]}</div></div><button class="sh-x" type="button" aria-label="Close">×</button></div>
      ${rz ? `<div class="sh-body" style="font-size:12.5px"><span class="real">REAL</span> Roadwork here: ${rz.why || 'construction'}${rz.who ? ' (' + rz.who + ')' : ''}. ${rz.full ? 'Road closed.' : rz.impact === 'High' ? 'Curb lane closed.' : 'Traffic slowed past the work.'}</div>` : ''}
      <div class="acts"><button class="act ${closed ? '' : 'danger'}" type="button" data-a="close">${closed ? 'Reopen road' : 'Close road both ways'}</button>
      ${res ? `<button class="act" type="button" data-a="local">${zone ? 'Remove local-only zone' : 'Local traffic only here'}</button>` : ''}
      ${mode === 'whatif' && G.cls[e] <= 4 ? `<button class="act danger" type="button" data-a="causeCrash">Crash here</button><button class="act danger" type="button" data-a="causeWater">Water main here</button>` : ''}</div>`;
  } else if (sel.k === 'hood') {
    const h = sel.h; const a = summary ? summary.anger[h] : 0; const cut = summary ? Math.round(summary.cut[h]) : 0; const base = G.calib ? Math.round(G.calib[h]) : 0;
    html = `<div class="sh-head">${svg('hood', 'var(--violet)')}<div><h2>${hoodN[h]}</h2><div class="sub">Neighbourhood</div></div><button class="sh-x" type="button" aria-label="Close">×</button></div>
      <div class="meter"><i style="width:${a}%"></i></div>
      <div class="facts"><div class="fact"><b>${a}%</b><span>Frustration</span></div><div class="fact"><b>${cut}</b><span>Cutting through now</span></div><div class="fact"><b>${base}</b><span>On a normal morning</span></div></div>${hoodCensusHtml(G.hoods[h])}
      <div class="sh-body">${a > 60 ? 'Residents are fed up. At 100% they block a street themselves.' : a > 25 ? 'Complaints are coming in about drivers using these streets as a shortcut.' : 'Quiet for now.'} Make streets local-only to push through traffic back onto the arterials, or fix the jam that’s sending drivers here.</div>
      <div class="acts"><button class="act primary" type="button" data-a="localHood">Local traffic only (centre of ${hoodN[h]})</button></div>`;
  }
  sh.innerHTML = html; sh.hidden = false; layout(); sheetSig = sheetKey();
  sh.querySelector('.sh-x').onclick = closeSheet;
  sh.querySelectorAll('[data-a]').forEach(b => b.onclick = () => sheetAction(b.dataset.a, b));
  const si = $('splitIn'); if (si) { si.oninput = () => { const v = +si.value; const q = si.parentElement.querySelector('.q').children; q[0].textContent = `${v}% green`; q[1].textContent = `${100 - v}% green`; }; si.onchange = () => cmd('setSplit', sel.c, +si.value / 100); }
}
async function sheetAction(a, b) {
  snd('ui'); const sel = selection; let r = null;
  if (a === 'crew') { const i = incidents.find(x => x.id === sel.id); r = await cmd('dispatch', i.id); }
  else if (a === 'police') { r = await cmd('sendPolice', +b.dataset.c); }
  else if (a === 'recall') { r = await cmd('recallPolice', sel.c); }
  else if (a === 'cam') { const i = incidents.find(x => x.id === sel.id); if (i) select({ k: 'cam', id: nearestCam(i.x, i.y) }); return; }
  else if (a === 'sign') { const i = incidents.find(x => x.id === sel.id); placeSign(i.x, i.y); r = { ok: true }; }
  else if (a === 'reopen') { const i = incidents.find(x => x.id === sel.id); r = await cmd('closeRoad', i.edge); }
  else if (a === 'close') { r = await cmd('closeRoad', sel.e); }
  else if (a === 'local') { toggleZone(sel.x, sel.y); r = { ok: true }; }
  else if (a === 'localHood') { const h = G.hoods[sel.h]; toggleZone(h.x, h.y, 650); r = { ok: true }; }
  else if (a === 'causeClosure') { r = await cmd('causeClosure', sel.c); }
  else if (a === 'causePowerHere') { const c = G.ctrls[sel.c]; r = await cmd('causePower', c.x, c.y); }
  else if (a === 'causeCrash') { r = await cmd('causeCrash', sel.e); }
  else if (a === 'causeWater') { r = await cmd('causeWater', sel.e); }
  if (r && r.ok === false) toast('OPS', r.msg, 'var(--red)');
  setTimeout(() => renderSheet(false), 150);
}
function nearestCtrl(x, y, r, any) { let best = -1, bd = r * r; for (let c = 0; c < G.ctrls.length; c++) { const k = G.ctrls[c]; const d = (k.x - x) ** 2 + (k.y - y) ** 2; if (d < bd && (any || k.cls <= 4)) { bd = d; best = c; } } return best; }

// ---------------------------------------------------------------- tap handling
function onTap(px, py) {
  const w = R.unproject(px, py); if (!w) return; const [x, y] = w;
  if (tool === 'local') { toggleZone(x, y); return; }
  if (tool === 'sign') { placeSign(x, y); return; }
  if (tool === 'power') { cmd('causePower', x, y).then(r => r.ok === false && toast('OPS', r.msg, 'var(--red)')); return; }
  if (tool === 'crash' || tool === 'water' || tool === 'close') { const n = nearestRoad(x, y, 30 * cam.wpp + 25, e => tool === 'close' || G.cls[e] <= 4); if (!n) { toast('OPS', 'Tap closer to a road.', 'var(--muted)'); return; } cmd(tool === 'crash' ? 'causeCrash' : tool === 'water' ? 'causeWater' : 'closeRoad', n.e).then(r => r && r.ok === false && toast('OPS', r.msg, 'var(--red)')); snd('ui'); return; }
  if (tool === 'closure') { const c = pickCtrl(px, py, 40); if (c < 0) { toast('OPS', 'Tap a signalised intersection.', 'var(--muted)'); return; } cmd('causeClosure', c); return; }
  // inspect
  const inc = pickIncident(px, py); if (inc) { select({ k: 'inc', id: inc.id }); snd('ui'); return; }
  const ws = pickWorld(px, py); if (ws) { select(ws); snd('ui'); return; }
  const hd = pickHood(px, py); if (hd >= 0) { select({ k: 'hood', h: hd }); snd('ui'); return; }
  const c = cam.wpp < 7 ? pickCtrl(px, py, 22) : -1; if (c >= 0) { select({ k: 'ctrl', c }); snd('ui'); return; }
  const n = nearestRoad(x, y, 16 * cam.wpp + 8); if (n) { select({ k: 'road', e: n.e, x, y }); snd('ui'); return; }
  closeSheet();
}
function pickIncident(px, py) { let best = null, bd = 30 * 30; for (const i of incidents) { if (i.state === 'cleared') continue; const p = R.project(i.x, i.y, 0); if (!p) continue; const d = (p[0] - px) ** 2 + (p[1] - py + 18) ** 2; if (d < bd) { bd = d; best = i; } } return best; }
function pickCtrl(px, py, r) { let best = -1, bd = r * r; for (let c = 0; c < G.ctrls.length; c++) { const k = G.ctrls[c]; const p = R.project(k.x, k.y, 0); if (!p) continue; const d = (p[0] - px) ** 2 + (p[1] - py) ** 2; if (d < bd) { bd = d; best = c; } } return best; }
let hoodRects = [];
function pickHood(px, py) { for (const r of hoodRects) if (px >= r.x0 && px <= r.x1 && py >= r.y0 && py <= r.y1) return r.h; return -1; }
function hover(px, py) { glc.style.cursor = (pickIncident(px, py) || pickWorld(px, py) || pickHood(px, py) >= 0) ? 'pointer' : tool !== 'inspect' ? 'crosshair' : 'grab'; }
function toggleZone(x, y, r) { const i = zones.findIndex(z => (z.x - x) ** 2 + (z.y - y) ** 2 < z.r * z.r); if (i >= 0) { const z = zones.splice(i, 1)[0]; cmd('setLocalOnly', z.x, z.y, z.r, false); toast('SIGNS', 'Local-only zone removed.', 'var(--violet)'); return; }
  r = r || 420; zones.push({ x, y, r }); cmd('setLocalOnly', x, y, r, true).then(res => toast('SIGNS', `"Local traffic only" signs up on ${res.n} streets. Through traffic will avoid them.`, 'var(--violet)')); snd('ui'); }
function placeSign(x, y) { signs.push({ x, y, t: simT }); cmd('sign', x, y, 1600).then(r => toast('SIGNS', `Message sign up. ${r.n} drivers nearby are rerouting.`, 'var(--amber)')); snd('ui'); }

// ---------------------------------------------------------------- time of day
function envNight() { const h = simT / 3600 % 24; if (mode === 'whatif' && profile === 'night') return 1; if (mode === 'whatif' && profile === 'midday') return 0; const [sr, ss] = sunHours(); const morn = 1 - smooth(sr - 0.75, sr + 0.4, h), eve = smooth(ss - 0.4, ss + 0.75, h); return Math.max(morn, eve); }
function envDusk() { const h = simT / 3600 % 24, [sr, ss] = sunHours(); return Math.max(0, 1 - Math.abs(h - sr) / 0.55) * 0.8 + Math.max(0, 1 - Math.abs(h - ss) / 0.55) * 0.8; }
function smooth(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

// ---------------------------------------------------------------- sprites & particles
const SP = new Float32Array(8 * 4000); let smoke = [], spray = [], jets = [];
function posAlong(p, d) { let acc = 0; for (let i = 0; i < p.length - 1; i++) { const L = Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]); if (acc + L >= d) { const f = (d - acc) / (L || 1); return [p[i][0] + (p[i + 1][0] - p[i][0]) * f, p[i][1] + (p[i + 1][1] - p[i][1]) * f]; } acc += L; } return p[p.length - 1].slice(); }
function buildSprites(dt) {
  let n = 0; const put = (x, y, z, size, kind, alpha, minPx, rot) => { if (n >= 3990) return; const o = n * 8; SP[o] = x; SP[o + 1] = y; SP[o + 2] = z; SP[o + 3] = size; SP[o + 4] = kind; SP[o + 5] = alpha; SP[o + 6] = minPx; SP[o + 7] = rot; n++; };
  const act = incidents.filter(i => i.state !== 'cleared');
  // A: alpha-under
  for (const i of act) {
    if (i.type === 'power') put(i.x, i.y, 0, i.r, 9, 1, 0, 0);
    if (i.type === 'water') { put(i.x, i.y, 0, 26, 5, 1, 14, 0); put(i.x, i.y, 0, 7, 4, 1, 9, 0); }
    if (i.type === 'flood' && i.edge !== undefined) { const p = pts(i.edge); const L = p.length; for (let k = 0; k < L; k++) put(p[k][0], p[k][1], 0, 24, 5, 1, 10, 0); const m = p[Math.floor(L / 2)]; put(m[0], m[1], 0, 30, 5, 1, 12, 0); }
    if ((i.type === 'barricade' || i.type === 'roadclosed') && i.edge !== undefined) { const p = pts(i.edge); for (const [a, b] of [[p[0], p[1]], [p[p.length - 1], p[p.length - 2]]]) { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; const ox = a[0] + dx / l * 9, oy = a[1] + dy / l * 9; const ang = Math.atan2(dy, dx); put(ox, oy, 0.3, (G.lanes[i.edge] * 1.7 + 1.5), 6, 1, 6, -(ang + Math.PI / 2)); } }
    if (i.type === 'closure' && i.nodes) { const S = new Set(i.nodes); for (const nd of i.nodes) for (const e of nodeIn.get(nd) || []) { if (S.has(G.ea[e])) continue; const p = pts(e); const L = p.length; const a = p[L - 1], b = p[L - 2]; const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; const back = Math.min(26, l * 0.6); const ox = a[0] + dx / l * back + dy / l * 0, oy = a[1] + dy / l * back; put(ox, oy, 0.3, G.lanes[e] * 1.8 + 1.2, 6, 1, 6, -(Math.atan2(dy, dx) + Math.PI / 2)); } }
  }
  for (const z of zones) put(z.x, z.y, 0, z.r, 10, 1, 0, 0);
  liveSpritesA(put);
  for (const i of act) if (i.type === 'hwy' && i.blocks) for (const b of i.blocks) { const p = pts(b.e); const tot = G.len[b.e]; const pos = posAlong(p, Math.max(2, b.s - 28)); const pos2 = posAlong(p, Math.min(tot, b.s + 1)); const ang = Math.atan2(pos2[1] - pos[1], pos2[0] - pos[0]); put(pos[0], pos[1], 0.3, G.lanes[b.e] * 1.8 + 1.5, 6, 1, 6, -(ang + Math.PI / 2)); }
  DIR.heliSprites(put, 'shadow');
  const aN = n;
  // B: additive
  const t = performance.now() / 1000;
  for (const i of act) {
    if (i.type !== 'roadclosed') put(i.x, i.y, 0.5, 32, 7, i.state === 'working' ? 0.35 : 1, 40, 0);
    if (i.type === 'collision' && i.fire && i.state !== 'working') { put(i.x, i.y, 1.2, 7, 0, 1, 12, 0); put(i.x + 2.5, i.y - 2, 1.2, 4.5, 0, 1, 7, 0); put(i.x, i.y, 0.8, 22, 2, 0.9 + 0.3 * Math.sin(t * 9), 14, 0); if (Math.random() < dt * 9 && smoke.length < 260) smoke.push({ x: i.x + (Math.random() - .5) * 3, y: i.y + (Math.random() - .5) * 3, z: 2, s: 4, a: 0, life: 9 + Math.random() * 6, vx: 1.6 + Math.random(), vy: -0.6 + Math.random() * .4 }); }
    if (i.type === 'collision' && i.state === 'working') put(i.x, i.y, 1, 14, 2, 0.8 + 0.5 * Math.sin(t * 6), 10, 0);
    if (i.type === 'closure') { for (let k = 0; k < 3; k++) put(i.x + Math.cos(k * 2.1) * 12, i.y + Math.sin(k * 2.1) * 12, 1, 16, 3, 1, 16, 0); }
    if (i.type === 'water') { if (Math.random() < dt * 30 && spray.length < 300) spray.push({ x: i.x, y: i.y, z: 0, vx: (Math.random() - .5) * 4, vy: (Math.random() - .5) * 4, vz: 9 + Math.random() * 6, life: 1.5, a: 0 }); if (i.state === 'working') put(i.x + 8, i.y, 1, 12, 2, 1, 8, 0); }
    if (i.type === 'power' && i.state === 'working') put(i.x, i.y, 1, 14, 2, 1, 10, 0);
  }
  for (const s of signs) { if (simT - s.t > 1200) continue; put(s.x, s.y, 1, 9, 2, 0.8 + 0.4 * Math.sin(t * 4), 9, 0); }
  liveSpritesB(put);
  for (const p of spray) { p.a += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vz -= 18 * dt; put(p.x, p.y, Math.max(0, p.z), 1.2, 8, 1 - p.a / p.life, 2, 0); }
  spray = spray.filter(p => p.a < p.life);
  if (selection) { const p = selPos(selection); if (p) put(p[0], p[1], 0.6, selection.k === 'hood' ? 700 : 40, 11, 1, 40, 0); }
  DIR.heliSprites(put, 'add');
  for (const i of act) if (i.type === 'hwy' && i.blocks) for (const b of i.blocks) { const p = pts(b.e); for (let f = 0; f < 6; f++) { const pos = posAlong(p, Math.max(1, b.s - 40 - f * 14)); const lat = (f / 5 - 0.5) * G.lanes[b.e] * 3.2; const d = posAlong(p, Math.max(1, b.s - 39 - f * 14)); const nx = -(d[1] - pos[1]), ny = d[0] - pos[0], nl = Math.hypot(nx, ny) || 1; put(pos[0] + nx / nl * lat, pos[1] + ny / nl * lat, 0.4, 1.4, 17, 0.8 + 0.4 * Math.sin(t * 17 + f * 2), 3, 0); } }
  for (const i of act) if ((i.type === 'hwy' && i.crash && i.fire) && i.state !== 'working') { put(i.x, i.y, 1.5, 11, 0, 1, 14, 0); put(i.x + 4, i.y - 3, 1.5, 7, 0, 1, 9, 0); put(i.x, i.y, 0.8, 34, 2, 0.9 + 0.3 * Math.sin(t * 9), 18, 0); if (Math.random() < dt * 16 && smoke.length < 420) smoke.push({ x: i.x + (Math.random() - .5) * 6, y: i.y + (Math.random() - .5) * 6, z: 3, s: 7, a: 0, life: 14 + Math.random() * 8, vx: 2.2 + Math.random(), vy: -0.8 + Math.random() * .6, big: 1 }); }
  // fire hoses: trucks on scene spray at the fire
  for (const u of units) { if (u.kind !== 'fire' || u.state !== 'onscene') continue; const inc = act.find(i => i.id === u.inc); if (!inc || !inc.fire) continue; if (Math.random() < dt * 40 && jets.length < 300) jets.push({ x: u.x, y: u.y, z: 3, tx: inc.x + (Math.random() - 0.5) * 4, ty: inc.y + (Math.random() - 0.5) * 4, f: 0 }); }
  for (const j of jets) { j.f += dt * 1.6; const f = j.f; put(j.x + (j.tx - j.x) * f, j.y + (j.ty - j.y) * f, 3 + Math.sin(f * Math.PI) * 9, 0.9, 19, 1 - f * 0.6, 2, 0); }
  jets = jets.filter(j => j.f < 1);
  const addN = n - aN;
  // C: smoke
  const sm0 = n;
  DIR.heliSprites(put, 'body');
  for (const p of smoke) { p.a += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += (p.big ? 7 : 4.5) * dt; p.s += (p.big ? 4.2 : 2.6) * dt; const f = p.a / p.life; put(p.x, p.y, p.z, p.s, 1, Math.min(1, f * 5) * (1 - f) * 0.9, 3, 0); }
  smoke = smoke.filter(p => p.a < p.life);
  R.setSprites(SP, n); return { aN, addN, smokeStart: sm0, smokeN: n - sm0 };
}
// wreck cars appended to the instance buffer
function addWrecks(buf, n) { for (const i of incidents) { if (i.type === 'hwy' && i.crash && i.state !== 'cleared' && n < R.carCap - 3) { const a = (i.id * 2.3) % 6.28; buf[n * 4] = i.x; buf[n * 4 + 1] = i.y; buf[n * 4 + 2] = a; buf[n * 4 + 3] = 1 | (1 << 3) | (3 << 4) | (1 << 12); n++; buf[n * 4] = i.x + Math.cos(a + 1.2) * 8; buf[n * 4 + 1] = i.y + Math.sin(a + 1.2) * 8; buf[n * 4 + 2] = a + 1.3; buf[n * 4 + 3] = 1 | (1 << 3) | (5 << 4) | (1 << 12); n++; buf[n * 4] = i.x - 9; buf[n * 4 + 1] = i.y + 3; buf[n * 4 + 2] = a - 0.6; buf[n * 4 + 3] = 0 | (1 << 3) | (44 << 4); n++; continue; } if (i.type !== 'collision' || i.state === 'cleared' || n >= R.carCap - 2) continue; const a = (i.id * 1.7) % 6.28; buf[n * 4] = i.x - 2; buf[n * 4 + 1] = i.y; buf[n * 4 + 2] = a; buf[n * 4 + 3] = 0 | (1 << 3) | ((i.id * 37 % 255) << 4); n++; buf[n * 4] = i.x + 3; buf[n * 4 + 1] = i.y + 1.5; buf[n * 4 + 2] = a + 0.9; buf[n * 4 + 3] = 0 | (1 << 3) | ((i.id * 91 % 255) << 4); n++; } return n; }

// ---------------------------------------------------------------- overlay (labels, markers)
function drawOverlay() {
  const c = ov; c.setTransform(DPR, 0, 0, DPR, 0, 0); c.clearRect(0, 0, innerWidth, innerHeight);
  const wpp = cam.wpp; hoodRects = [];
  c.textAlign = 'center'; c.textBaseline = 'middle';
  // road labels
  if (wpp < 9) { const placed = []; c.font = `600 ${wpp < 2.5 ? 12 : 11}px ${getFont()}`; for (const L of labelCand) { if (L.cls > (wpp < 2.5 ? 3 : wpp < 5 ? 2 : 1)) continue; const p = R.project(L.x, L.y, 0); if (!p || p[0] < -40 || p[0] > innerWidth + 40 || p[1] < 60 || p[1] > innerHeight - 60) continue; if (placed.some(q => (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 < 150 ** 2)) continue; placed.push(p);
    let a = L.ang; const q = R.project(L.x + Math.cos(a) * 10, L.y + Math.sin(a) * 10, 0); if (q) a = Math.atan2(q[1] - p[1], q[0] - p[0]); if (a > Math.PI / 2) a -= Math.PI; if (a < -Math.PI / 2) a += Math.PI;
    c.save(); c.translate(p[0], p[1]); c.rotate(a); c.lineJoin = 'round'; c.lineWidth = 3; c.strokeStyle = 'rgba(4,7,10,.85)'; c.strokeText(L.n, 0, 0); c.fillStyle = L.cls <= 1 ? 'rgba(255,200,120,.85)' : 'rgba(225,232,240,.78)'; c.fillText(L.n, 0, 0); c.restore(); } }
  // places
  if (wpp < 14) { c.font = `600 10.5px ${getMono()}`; for (const pl of G.places) { const p = R.project(pl.x, pl.y, 0); if (!p) continue; c.fillStyle = 'rgba(82,199,255,.85)'; c.beginPath(); c.arc(p[0], p[1], 2.5, 0, 7); c.fill(); c.lineWidth = 3; c.strokeStyle = 'rgba(4,7,10,.8)'; c.strokeText(pl.s, p[0], p[1] - 10); c.fillText(pl.s, p[0], p[1] - 10); } }
  // neighbourhoods
  const anger = summary ? summary.anger : null; const showH = wpp > 2.2;
  if (showH) { c.font = `700 ${wpp > 25 ? 9 : 11}px ${getFont()}`; c.lineJoin = 'round'; const placedH = []; const ord = G.hoods.map((h, i) => i).sort((a, b) => (anger ? anger[b] - anger[a] : 0)); ord.forEach(i => { const h = G.hoods[i]; const p = R.project(h.x, h.y, 0); if (!p || p[0] < -60 || p[0] > innerWidth + 60) return; const a = anger ? anger[i] : 0; const label = h.n.toUpperCase(); const tw0 = c.measureText(label).width + label.length * 2; if (placedH.some(q => Math.abs(q[0] - p[0]) < (q[2] + tw0) / 2 + 4 && Math.abs(q[1] - p[1]) < 22)) return; placedH.push([p[0], p[1], tw0]);
    c.save(); c.letterSpacing = '2px'; c.lineWidth = 3; c.strokeStyle = 'rgba(4,7,10,.7)'; c.fillStyle = a > 60 ? 'rgba(255,120,140,.95)' : a > 25 ? 'rgba(200,160,255,.95)' : 'rgba(160,175,190,.55)'; c.strokeText(label, p[0], p[1]); c.fillText(label, p[0], p[1]); c.restore();
    const tw = c.measureText(label).width + label.length * 2;
    if (a > 3) { const w = Math.max(40, tw * 0.7); c.fillStyle = 'rgba(255,255,255,.12)'; c.fillRect(p[0] - w / 2, p[1] + 9, w, 3.5); c.fillStyle = a > 60 ? '#ff4b6a' : '#b98cff'; c.fillRect(p[0] - w / 2, p[1] + 9, w * a / 100, 3.5); }
    hoodRects.push({ h: i, x0: p[0] - tw / 2 - 6, x1: p[0] + tw / 2 + 6, y0: p[1] - 12, y1: p[1] + 16 }); }); }
  // units at overview zoom
  if (wpp > 4) for (const u of units) { const p = R.project(u.x, u.y, 0); if (!p) continue; const col = u.kind === 'police' ? '#52c7ff' : u.kind === 'ems' ? '#ff4438' : u.kind === 'tow' ? '#ffb020' : u.kind === 'hydro' ? '#ff8a1f' : '#52a8ff'; c.fillStyle = col; c.beginPath(); c.arc(p[0], p[1], 3.5, 0, 7); c.fill(); if (u.state === 'enroute' && (performance.now() / 300 | 0) % 2) { c.strokeStyle = col; c.lineWidth = 1.5; c.beginPath(); c.arc(p[0], p[1], 7, 0, 7); c.stroke(); } }
  // incident markers
  for (const i of incidents) { if (i.state === 'cleared') continue; const p = R.project(i.x, i.y, 0); if (!p) continue; const m = im(i); const x = p[0], y = p[1] - 22; if (i.type === 'call' && cam.wpp > 9 && !(i.act === 'police_crit' || i.act === 'fire_struct' || i.act === 'gas')) { c.fillStyle = m.col; c.beginPath(); c.arc(x, y + 18, 4, 0, 7); c.fill(); continue; }
    const work = (i.type === 'hwy' && !i.crash) || i.type === 'roadclosed';
    if (work) { // planned work / closures: amber diamond road sign, no pulse
      c.fillStyle = '#ffb020'; c.beginPath(); c.moveTo(x, y - 17); c.lineTo(x + 17, y); c.lineTo(x, y + 17); c.lineTo(x - 17, y); c.closePath(); c.fill(); c.lineWidth = 2; c.strokeStyle = '#1a1205'; c.stroke();
    } else { // emergencies: dark disc, coloured ring, pulsing halo
      const pulse = (performance.now() / 900) % 1; c.strokeStyle = m.col; c.globalAlpha = 1 - pulse; c.lineWidth = 2; c.beginPath(); c.arc(x, y, 15 + pulse * 14, 0, 7); c.stroke(); c.globalAlpha = 1;
      c.fillStyle = 'rgba(6,9,13,.9)'; c.beginPath(); c.arc(x, y, 15, 0, 7); c.fill(); c.lineWidth = 2.5; c.strokeStyle = m.col; c.beginPath(); c.arc(x, y, 15, 0, 7); c.stroke(); }
    if (i.state === 'working' && i.workUntil) { const tot = { collision: 420, power: 840, water: 1920 }[i.type] || 600; const f = 1 - Math.max(0, (i.workUntil - simT)) / tot; c.strokeStyle = '#ffb020'; c.lineWidth = 3; c.beginPath(); c.arc(x, y, 19, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2); c.stroke(); }
    if (!work) { c.fillStyle = m.col; c.beginPath(); c.moveTo(x - 5, y + 13); c.lineTo(x + 5, y + 13); c.lineTo(x, y + 21); c.fill(); }
    const img = iconPath(work ? 'coneDark' : m.icon || i.type); if (img.complete) c.drawImage(img, x - 9, y - 10, 18, 18);
    if (i.queue > 0) { const t = String(i.queue); c.font = `700 10px ${getMono()}`; const w = c.measureText(t).width + 8; c.fillStyle = '#ff4438'; roundRect(c, x + 10, y - 19, w, 14, 7); c.fill(); c.fillStyle = '#fff'; c.fillText(t, x + 10 + w / 2, y - 12); } }
  // outage boundaries
  for (const i of incidents) { if (i.type !== 'power' || i.state === 'cleared') continue; const p = R.project(i.x, i.y, 0), q = R.project(i.x + i.r, i.y, 0); if (!p || !q) continue; const rr = Math.hypot(q[0] - p[0], q[1] - p[1]); c.save(); c.setLineDash([6, 6]); c.lineDashOffset = -performance.now() / 60; c.strokeStyle = 'rgba(255,210,63,.55)'; c.lineWidth = 1.5; c.beginPath(); c.ellipse(p[0], p[1], rr, rr * (R.project(i.x, i.y + i.r, 0) ? Math.abs(R.project(i.x, i.y + i.r, 0)[1] - p[1]) / rr : 1), 0, 0, 7); c.stroke(); c.restore(); if (rr > 40) { c.font = `700 10px ${getMono()}`; c.fillStyle = 'rgba(255,210,63,.8)'; c.fillText('NO POWER', p[0], p[1] - rr * 0.6); } }
  // signs
  for (const s of signs) { if (simT - s.t > 1200) continue; const p = R.project(s.x, s.y, 0); if (!p) continue; c.fillStyle = '#111'; roundRect(c, p[0] - 16, p[1] - 30, 32, 16, 3); c.fill(); c.fillStyle = '#ffb020'; c.font = `700 8px ${getMono()}`; c.fillText('DETOUR', p[0], p[1] - 22); }
  liveOverlay(c);
}
function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
let FONT = null, MONO = null; function getFont() { return FONT || (FONT = getComputedStyle(document.documentElement).getPropertyValue('--f-display')); } function getMono() { return MONO || (MONO = getComputedStyle(document.documentElement).getPropertyValue('--f-mono')); }

// ---------------------------------------------------------------- audio
let AC = null, master = null, bed = null, rainG = null, sirenG = null, sirenO = null, noiseB = null, muted = store.get('muted', false);
function audioInit() {
  if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
  try { AC = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 0.1 }); } catch (e) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e2) { return; } }
  const lim = AC.createDynamicsCompressor(); lim.threshold.value = -2; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.2;
  const ceil = AC.createWaveShaper(); const cv = new Float32Array(2048); for (let i = 0; i < 2048; i++) { const x = i / 1023.5 - 1; cv[i] = Math.tanh(x * 1.1) / Math.tanh(1.1) * 0.93; } ceil.curve = cv;
  master = AC.createGain(); master.gain.value = muted ? 0 : 0.8; master.connect(lim); lim.connect(ceil); ceil.connect(AC.destination);
  noiseB = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate); const nd = noiseB.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  const brown = AC.createBuffer(1, AC.sampleRate * 3, AC.sampleRate), bd = brown.getChannelData(0); let b = 0; for (let i = 0; i < bd.length; i++) { b = (b + 0.02 * (Math.random() * 2 - 1)) / 1.02; bd[i] = b * 3.3; }
  const bs = AC.createBufferSource(); bs.buffer = brown; bs.loop = true; const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700; bed = AC.createGain(); bed.gain.value = 0.0; bs.connect(lp); lp.connect(bed); bed.connect(master); bs.start(); bed.lp = lp;
  const rs = AC.createBufferSource(); rs.buffer = noiseB; rs.loop = true; const hp = AC.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1400; rainG = AC.createGain(); rainG.gain.value = 0; rs.connect(hp); hp.connect(rainG); rainG.connect(master); rs.start();
  setTimeout(() => DIR.audioReady(), 0);
  sirenO = AC.createOscillator(); sirenO.type = 'triangle'; sirenO.frequency.value = 700; const sf = AC.createBiquadFilter(); sf.type = 'bandpass'; sf.frequency.value = 1100; sf.Q.value = 0.8; sirenG = AC.createGain(); sirenG.gain.value = 0; sirenO.connect(sf); sf.connect(sirenG); sirenG.connect(master); sirenO.start();
}
function tone(t, d, f, f2, type, g, att) { const o = AC.createOscillator(); o.type = type || 'sine'; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d); const a = AC.createGain(); a.gain.setValueAtTime(0, t); a.gain.linearRampToValueAtTime(g, t + (att || 0.005)); a.gain.exponentialRampToValueAtTime(0.0008, t + d); o.connect(a); a.connect(master); o.start(t); o.stop(t + d + 0.05); }
function nz(t, d, f, q, type, g, f2) { const s = AC.createBufferSource(); s.buffer = noiseB; const fl = AC.createBiquadFilter(); fl.type = type || 'bandpass'; fl.frequency.setValueAtTime(f, t); if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + d); fl.Q.value = q || 1; const a = AC.createGain(); a.gain.setValueAtTime(0, t); a.gain.linearRampToValueAtTime(g, t + 0.004); a.gain.exponentialRampToValueAtTime(0.0008, t + d); s.connect(fl); fl.connect(a); a.connect(master); s.start(t, Math.random()); s.stop(t + d + 0.05); }
function snd(k, pan) {
  if (!AC || muted) return; const t = AC.currentTime;
  if (k === 'ui') tone(t, 0.06, 1400, 1000, 'square', 0.025);
  else if (k === 'crash') { nz(t, 0.5, 900, 0.8, 'bandpass', 0.35, 300); tone(t, 0.35, 90, 40, 'sine', 0.35); nz(t + 0.08, 0.4, 3500, 2, 'bandpass', 0.12); }
  else if (k === 'zap') { tone(t, 0.25, 120, 60, 'sawtooth', 0.12); nz(t, 0.3, 2400, 4, 'bandpass', 0.12); }
  else if (k === 'alert') { tone(t, 0.12, 880, 0, 'square', 0.05); tone(t + 0.15, 0.12, 660, 0, 'square', 0.05); }
  else if (k === 'radio') { nz(t, 0.08, 2200, 3, 'bandpass', 0.08); tone(t + 0.06, 0.07, 1250, 0, 'sine', 0.06); tone(t + 0.15, 0.07, 1650, 0, 'sine', 0.06); nz(t + 0.24, 0.12, 2200, 3, 'bandpass', 0.05); }
  else if (k === 'clear') { tone(t, 0.18, 660, 0, 'sine', 0.07); tone(t + 0.12, 0.25, 990, 0, 'sine', 0.07); }
  else if (k === 'phone') { for (let i = 0; i < 2; i++) { tone(t + i * 0.22, 0.16, 1700, 0, 'sine', 0.04); tone(t + i * 0.22, 0.16, 2100, 0, 'sine', 0.03); } }
  else if (k === 'horn') { const f = 380 + Math.random() * 120; tone(t, 0.22 + Math.random() * 0.25, f, 0, 'square', 0.018, 0.01); tone(t, 0.22, f * 1.26, 0, 'square', 0.012, 0.01); }
  else if (k === 'thunder') { nz(t, 3.2, 180, 0.6, 'lowpass', 0.5, 50); tone(t, 2.2, 45, 28, 'sine', 0.3, 0.05); }
  else if (k === 'trainhorn') { for (const [d0, len] of [[0, 0.9], [1.05, 0.35], [1.5, 1.1]]) for (const f of [311, 370, 466]) tone(t + d0, len, f, 0, 'sawtooth', 0.011, 0.04); }
  else if (k === 'xbell') { tone(t, 0.18, 1560, 0, 'triangle', 0.02); tone(t + 0.26, 0.18, 1560, 0, 'triangle', 0.02); }
}
let hornT = 0;
function audioFrame(dt, stoppedOnScreen, carsOnScreen, sirenNear) {
  if (!AC || muted) return; const t = AC.currentTime;
  const zoomK = Math.max(0, Math.min(1, 1.6 - Math.log10(Math.max(1, cam.wpp)) * 0.9));
  bed.gain.setTargetAtTime(Math.min(0.3, 0.04 + carsOnScreen / 2500 * 0.25) * (0.35 + zoomK * 0.65), t, 0.5); bed.lp.frequency.setTargetAtTime(300 + zoomK * 900, t, 0.5);
  rainG.gain.setTargetAtTime(rainOn ? 0.07 : 0, t, 1.0);
  sirenG.gain.setTargetAtTime(sirenNear ? 0.045 * zoomK + 0.01 : 0, t, 0.3); if (sirenNear) { const ph = (t % 2.4) / 2.4; sirenO.frequency.setTargetAtTime(ph < 0.5 ? 1350 : 700, t, 0.35); }
  hornT -= dt; if (hornT <= 0) { hornT = 0.4 + Math.random() * 1.6; if (stoppedOnScreen > 25 && zoomK > 0.45 && Math.random() < Math.min(0.9, stoppedOnScreen / 300)) snd('horn'); }
}

// ---------------------------------------------------------------- report
function endShift() {
  ended = true; setSpeed(0);
  const s = summary; const base = G.baseline || []; const bAvg = base.length ? base.reduce((a, b) => a + b[0], 0) / base.length : 4;
  const dd = s.avgDelay - bAvg * 0.85;
  const crewInc = incidents.filter(i => ['collision', 'power', 'water'].includes(i.type));
  const bAvg2 = base.length ? base.reduce((a, b) => a + b[0], 0) / base.length : 4.7; const dd2 = s.avgDelay - bAvg2;
  let score = 100 - Math.max(0, dd2) * 10 - s.incHours / 60 - s.complaints * 2 - s.barricades * 6 - Math.max(0, s.emsAvg - 5) * 5;
  score = Math.max(0, Math.min(100, Math.round(score)));
  const grade = score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 50 ? 'C' : score >= 35 ? 'D' : 'F';
  const note = { A: 'The mayor’s office has nothing to say about you, which is the highest praise there is.', B: 'Solid shift. A few grumbles on the morning radio, nothing that sticks.', C: 'CP24 ran the traffic map behind the anchor for twenty minutes. Not great.', D: 'Your phone hasn’t stopped. A councillor wants a briefing by noon.', F: 'Scarborough will be talking about this morning for a while.' }[grade];
  const best = store.get('best', 0); if (score > best) store.set('best', score);
  $('repPanel').innerHTML = `<div class="kicker">SHIFT REPORT · TUESDAY 6:00–9:30 AM</div><div style="display:flex;align-items:flex-end;gap:16px"><div class="grade">${grade}</div><div><div style="font-size:22px;font-weight:800;font-stretch:85%">${score} / 100</div><div style="color:var(--muted);font-size:13px">Best: ${Math.max(best, score)}</div></div></div><p class="lede">${note}</p>
    <div class="rep"><span>Extra minutes per trip vs a normal Tuesday</span><b class="${dd2 > 1 ? 'bad' : 'good'}">${dd2 >= 0 ? '+' : '−'}${Math.abs(dd2).toFixed(1)}</b>
    <span>Car-hours lost stuck at incidents</span><b class="${s.incHours > 1500 ? 'bad' : s.incHours < 800 ? 'good' : ''}">${Math.round(s.incHours).toLocaleString('en-CA')}</b>
    <span>Trips completed</span><b>${s.trips.toLocaleString('en-CA')}</b>
    <span>Ambulance response, average</span><b class="${s.emsAvg > 5 ? 'bad' : 'good'}">${s.emsAvg.toFixed(1)} min</b>
    <span>311 complaints</span><b class="${s.complaints > 3 ? 'bad' : ''}">${s.complaints}</b>
    <span>Streets blocked by residents</span><b class="${s.barricades ? 'bad' : 'good'}">${s.barricades}</b>
    <span>Incidents handled</span><b>${crewInc.filter(i => i.state === 'cleared').length} of ${crewInc.length}</b></div>
    <div class="acts"><button class="act primary" type="button" id="again">Run the shift again</button><button class="act" type="button" id="toSandbox">Open the sandbox</button></div>`;
  $('report').hidden = false; $('again').onclick = () => location.reload(); $('toSandbox').onclick = () => { store.set('autostart', 'whatif'); location.reload(); };
}

/*__DIRECTOR__*/
/*__LIVEAPP__*/
// ---------------------------------------------------------------- start
async function begin(m) {
  audioInit(); const kind = m === 'live' || m === 'replay' ? m : null; if (kind) m = 'watch'; mode = m; LV.kind = kind; $('loading').hidden = false; document.querySelectorAll('.mode').forEach(b => b.disabled = true);
  if (LV.loading) { $('loadTxt').textContent = 'Pulling live Toronto data…'; try { await Promise.race([LV.loading, new Promise(r => setTimeout(r, 12000))]); } catch (e) {} }
  const L = worldInitFor(m, kind);
  let startT = m === 'watch' ? 6.75 * 3600 : m === 'shift' ? 5.75 * 3600 : profile === 'rush' ? 7.25 * 3600 : profile === 'midday' ? 11.75 * 3600 : 23.25 * 3600;
  if (kind === 'live') startT = Date.now() / 1000 - L.epoch0 - 900; else if (kind === 'replay') startT = replayStart(L.epoch0) - 900;
  if (kind && !LV.feed) toast('LIVE', 'Live data could not be loaded. Running a simulated day instead.', 'var(--red)');
  startWorker({ seed: (Math.random() * 1e9) | 0, cap: 14000, targetCars: 8000, mode: m, profile, startT, warm: 15 * 60 * 4, feed: L.feed, world: L.world });
}
$('goShift').onclick = () => begin('shift');
$('goWhat').onclick = () => begin('whatif');
$('goWatch').onclick = () => begin('watch');
$('goLive').onclick = () => begin('live');
$('goReplay').onclick = () => begin('replay');
$('liveBadge').onclick = () => { selection = { k: 'live', id: 0 }; renderSheet(true); snd('ui'); };
$('skipBtn').onclick = async () => { const r = await cmd('jumpNext'); if (r && r.ok === false) toast('REPLAY', r.msg, 'var(--muted)'); snd('ui'); };
$('tod').querySelectorAll('button').forEach(b => b.onclick = () => { profile = b.dataset.p; $('tod').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); });
if (store.get('autostart', null) === 'whatif') { store.set('autostart', null); setTimeout(() => begin('whatif'), 50); }

// ---------------------------------------------------------------- main loop
resize(); fitView(false); addEventListener('resize', () => { resize(); });
let perfAcc = 0, perfN = 0, lite = false;
let last = performance.now(), statT = 0, onScreen = { cars: 0, stopped: 0, siren: false };
function frame(now) {
  requestAnimationFrame(frame);
  const rawDt = (now - last) / 1000; const dt = Math.min(0.1, rawDt); last = now;
  if (ready && rawDt < 1) { perfAcc += rawDt; perfN++; if (perfN >= 120) { const avg = perfAcc / perfN; perfAcc = 0; perfN = 0; if (avg > 1 / 28) { if (DPR > 1.01) { DPR = Math.max(1, DPR - 0.35); resize(); } else if (!lite) { lite = true; R.setLite(true); } } } }
  if (camGoal) { const k = 1 - Math.exp(-dt * 3.2); cam.x += (camGoal.x - cam.x) * k; cam.y += (camGoal.y - cam.y) * k; cam.h *= Math.pow(camGoal.h / cam.h, k); if (Math.abs(camGoal.h / cam.h - 1) < 0.002 && Math.hypot(camGoal.x - cam.x, camGoal.y - cam.y) < cam.h * 0.002) camGoal = null; }
  cam.pitch += (tiltGoal - cam.pitch) * (1 - Math.exp(-dt * 4));
  // weather flashes
  if (rainOn && stormOn && now > nextFlash) { flash = 0.9; nextFlash = now + 6000 + Math.random() * 14000; setTimeout(() => snd('thunder'), 600 + Math.random() * 1800); }
  flash *= Math.exp(-dt * 7);
  let n = frameN; if (ready) { n = addWrecks(posBuf, n); R.setCars(posBuf, n); }
  try { DIR.frame(dt); } catch (err) { console.error(err); }
  const spr = buildSprites(dt);
  const night = envNight();
  const outages = incidents.filter(i => i.type === 'power' && i.state !== 'cleared').map(i => [i.x, i.y, i.r]);
  R.draw({ time: now / 1000, night, day: 1 - night, dusk: envDusk(), rain: rainOn && !snowOn ? 1 : 0, snow: snowOn ? 1 : 0, fog: fogOn ? 1 : 0, flash, outages, overlay: overlayOn ? Math.max(0.1, Math.min(1, (cam.wpp - 0.5) / 2.5)) : 0, sigA: Math.max(0, Math.min(1, (3.2 - cam.wpp) / 2)), spriteAlphaN: spr.aN, addN: spr.addN, smokeStart: spr.smokeStart, smokeN: spr.smokeN });
  drawOverlay();
  if (ready) requestFrame();
  statT -= dt; if (statT <= 0 && ready) { statT = 0.5; let cars = 0, stopped = 0, siren = false; const x0 = 0, x1 = innerWidth, y0 = 0, y1 = innerHeight; for (let i = 0; i < frameN; i += 3) { const f = posBuf[i * 4 + 3]; const p = R.project(posBuf[i * 4], posBuf[i * 4 + 1], 0); if (!p || p[0] < x0 || p[0] > x1 || p[1] < y0 || p[1] > y1) continue; cars += 3; if (((f | 0) >> 3) & 1) stopped += 3; } for (let i = Math.max(0, frameN - 90); i < frameN; i++) { const f = posBuf[i * 4 + 3] | 0; if (!((f >> 14) & 1) || ((f >> 13) & 1) || ((f >> 23) & 1)) continue; const ty = f & 7; if (ty !== 2 && ty !== 3 && ty !== 7) continue; const p = R.project(posBuf[i * 4], posBuf[i * 4 + 1], 0); if (p && p[0] > -100 && p[0] < innerWidth + 100 && p[1] > -100 && p[1] < innerHeight + 100) siren = true; } onScreen = { cars, stopped, siren }; }
  audioFrame(dt, onScreen.stopped, onScreen.cars, false); // no siren sound: lights only
}
requestAnimationFrame(frame);
window.__gl = { get LV() { return LV; }, get units() { return units; }, get DIR() { return DIR; }, snd: (k) => snd(k), audioInit: () => audioInit(), cam, get summary() { return summary; }, get incidents() { return incidents; }, cmd, select, setSpeed, get simT() { return simT; }, R, onTap, fitView, toast, caption };
})();
