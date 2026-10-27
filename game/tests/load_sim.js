// Assembles sim.js + the world modules (same as build.py) and returns { createSim } for headless tests.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
module.exports = function loadSim() {
  const src = fs.readFileSync(path.join(ROOT, 'sim.js'), 'utf8').replace(/\/\*__WORLD__ ([^*]+)\*\//, (_, files) => files.trim().split(/\s+/).map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n'));
  const mod = { exports: {} };
  new Function('module', 'exports', src)(mod, mod.exports);
  return mod.exports;
};
// road graph (tools/process.py) plus the calibration files (tools/*.js), same as build.py
module.exports.graph = () => { const rd = f => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8')), g = rd('graph.json');
  for (const [k, f] of [['calib', 'calib.json'], ['baseline', 'baseline.json'], ['demandW', 'demand_w.json']]) if (fs.existsSync(path.join(ROOT, 'data', f))) g[k] = rd(f);
  return g; };
