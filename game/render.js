// GRIDLOCK renderer — WebGL2 roads, cars, lights, FX and bloom.
'use strict';
const R = (function () {
const FOV = 40 * Math.PI / 180, TANH = Math.tan(FOV / 2);
let gl, W = 1, H = 1, DPR = 1, quality = 'high';
const cam = { x: 0, y: 0, h: 20000, pitch: 0, yaw: 0, ex: 0, ey: 0, ez: 0, f: [0, 0, -1], r: [1, 0, 0], u: [0, 1, 0], view: new Float32Array(16), proj: new Float32Array(16), vp: new Float32Array(16), wpp: 1 };
// ---------------------------------------------------------------- math
function norm(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function updateCam() {
  // world: x east, y south (map); GL: X = x, Y = -y, Z up
  const tx = cam.x, ty = -cam.y, p = cam.pitch, h = cam.h, yw = cam.yaw || 0, cy = Math.cos(yw), sy = Math.sin(yw);
  cam.ex = tx + sy * Math.sin(p) * h; cam.ey = ty - cy * Math.sin(p) * h; cam.ez = Math.cos(p) * h;
  const f = norm([tx - cam.ex, ty - cam.ey, -cam.ez]);
  let r = norm(cross(f, [-sy, cy, 0])); if (!isFinite(r[0])) r = [cy, sy, 0];
  const u = cross(r, f); cam.f = f; cam.r = r; cam.u = u;
  const v = cam.view; const e = [cam.ex, cam.ey, cam.ez];
  v[0] = r[0]; v[4] = r[1]; v[8] = r[2]; v[12] = -(r[0] * e[0] + r[1] * e[1] + r[2] * e[2]);
  v[1] = u[0]; v[5] = u[1]; v[9] = u[2]; v[13] = -(u[0] * e[0] + u[1] * e[1] + u[2] * e[2]);
  v[2] = -f[0]; v[6] = -f[1]; v[10] = -f[2]; v[14] = (f[0] * e[0] + f[1] * e[1] + f[2] * e[2]);
  v[3] = 0; v[7] = 0; v[11] = 0; v[15] = 1;
  const asp = W / H, near = Math.max(5, h * 0.02), far = h * 8 + 60000; const P = cam.proj; P.fill(0);
  P[0] = 1 / (TANH * asp); P[5] = 1 / TANH; P[10] = -(far + near) / (far - near); P[11] = -1; P[14] = -2 * far * near / (far - near);
  P[8] = cam.ox || 0; // horizontal shift of the picture centre (TV layout: the subject sits in the part of the screen the side rail leaves free)
  mul(cam.vp, P, v);
  cam.wpp = (2 * h * TANH) / H; // world units per CSS pixel at target
}
function mul(o, a, b) { for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; } return o; }
function project(x, y, z) { // map coords -> CSS px (and depth flag)
  const X = x, Y = -y, Z = z || 0, m = cam.vp;
  const cx = m[0] * X + m[4] * Y + m[8] * Z + m[12], cy = m[1] * X + m[5] * Y + m[9] * Z + m[13], cw = m[3] * X + m[7] * Y + m[11] * Z + m[15];
  if (cw <= 0.0001) return null; return [(cx / cw * 0.5 + 0.5) * W, (1 - (cy / cw * 0.5 + 0.5)) * H, cw];
}
function unproject(px, py) { // CSS px -> map coords on ground
  const nx = px / W * 2 - 1 + (cam.ox || 0), ny = 1 - py / H * 2, asp = W / H;
  const d = norm([cam.f[0] + cam.r[0] * nx * TANH * asp + cam.u[0] * ny * TANH, cam.f[1] + cam.r[1] * nx * TANH * asp + cam.u[1] * ny * TANH, cam.f[2] + cam.r[2] * nx * TANH * asp + cam.u[2] * ny * TANH]);
  if (d[2] > -1e-4) return null; const t = -cam.ez / d[2]; return [cam.ex + d[0] * t, -(cam.ey + d[1] * t)];
}
// ---------------------------------------------------------------- GL helpers
function sh(type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src.split('\n').slice(0, 5).join('\n')); return s; }
function prog(vs, fs) { const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, '#version 300 es\nprecision highp float;\n' + vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, '#version 300 es\nprecision highp float;\n' + fs)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name.replace('[0]', '')] = gl.getUniformLocation(p, a.name); } return { p, u }; }
function buf(data, usage) { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, usage || gl.STATIC_DRAW); return b; }
function vao(bindings) { const v = gl.createVertexArray(); gl.bindVertexArray(v); for (const b of bindings) { gl.bindBuffer(gl.ARRAY_BUFFER, b.buf); let off = 0; for (const [loc, n] of b.attrs) { if (loc >= 0) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, gl.FLOAT, false, b.stride * 4, off * 4); if (b.div) gl.vertexAttribDivisor(loc, 1); } off += n; } } gl.bindVertexArray(null); return v; }
function tex(w, h, fmt, filter) { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); const F = filter || gl.LINEAR; gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, F); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, F); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (fmt === 'r8') gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, null);
  else if (fmt === 'rg8') gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, w, h, 0, gl.RG, gl.UNSIGNED_BYTE, null);
  else if (fmt === 'f16') gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); return t; }
function fbo(t) { const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); return f; }

// ---------------------------------------------------------------- shaders
const CAM_U = 'uniform mat4 uVP; uniform float uWpp; uniform float uTime; uniform float uNight; uniform float uDay; uniform float uRain;';
const OUTAGE_U = 'uniform vec4 uOut[8]; uniform int uNOut; float outage(vec2 p){ float k = 1.0; for (int i = 0; i < 8; i++) { if (i >= uNOut) break; float d = length(p - uOut[i].xy); k = min(k, smoothstep(uOut[i].z * 0.92, uOut[i].z * 1.05, d)); } return k; }';
const P = {};
function buildPrograms() {
  // land: baked land use (parks, lawns, paved) tinted by season; dark map from high up, natural colours close in
  P.ground = prog(`layout(location=0) in vec2 aP; ${CAM_U} out vec2 vW; void main(){ gl_Position = uVP * vec4(aP.x, -aP.y, 0.0, 1.0); vW = aP; }`,
    `in vec2 vW; ${CAM_U} uniform sampler2D uLand; uniform sampler2D uFill; uniform vec4 uExt; uniform float uSeason; uniform float uSnowG; out vec4 o;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
    vec3 cpal(float h){ return h < 0.24 ? vec3(0.86, 0.87, 0.88) : h < 0.44 ? vec3(0.50, 0.52, 0.55) : h < 0.62 ? vec3(0.07, 0.07, 0.08) : h < 0.74 ? vec3(0.24, 0.25, 0.27) : h < 0.84 ? vec3(0.55, 0.08, 0.07) : h < 0.93 ? vec3(0.11, 0.20, 0.44) : vec3(0.62, 0.57, 0.48); }
    void main(){ vec2 uv = (vW - uExt.xy) * uExt.zw; vec4 lu = texture(uLand, clamp(uv, 0.0, 1.0)) * step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
      float close = clamp((6.0 - uWpp) / 4.5, 0.0, 1.0), fine = clamp((1.8 - uWpp) / 1.2, 0.0, 1.0), fill = smoothstep(0.35, 0.65, texture(uFill, clamp(uv, 0.0, 1.0)).r);
      vec3 lawn = mix(vec3(0.19, 0.29, 0.13), vec3(0.27, 0.31, 0.15), uSeason), park = mix(vec3(0.11, 0.24, 0.10), vec3(0.20, 0.25, 0.12), uSeason);
      float n = vn(vW / 140.0) * 0.55 + vn(vW / 31.0) * 0.45, n2 = vn(vW / 9.0), n3 = vn(vW / 420.0);
      vec3 grass = mix(lawn, park, clamp(lu.g, 0.0, 1.0)); grass *= 0.78 + 0.40 * n; grass = mix(grass, grass * vec3(1.16, 1.04, 0.74), smoothstep(0.5, 0.85, n2 * 0.6 + n3 * 0.5) * 0.4); // worn, drier patches
      grass *= 1.0 + (hash(floor(vW * 0.9)) - 0.5) * 0.14 * fine;
      grass = mix(grass, vec3(0.075, 0.125, 0.06) * (0.8 + 0.4 * n2), lu.r * 0.85); // forest floor
      vec2 g = vec2(dot(vW, vec2(0.956, -0.292)), dot(vW, vec2(0.292, 0.956)));
      { vec2 pc = floor(g / 320.0); if (hash(pc + 3.7) < 0.34 && close > 0.0) { vec2 ctr = (pc + 0.5) * 320.0 + (vec2(hash(pc + 1.1), hash(pc + 2.2)) - 0.5) * 150.0, pl = g - ctr, a = abs(pl); // a soccer pitch in some open parks
          if (a.x < 54.0 && a.y < 36.0) { vec2 cw = vec2(0.956, -0.292) * ctr.x + vec2(0.292, 0.956) * ctr.y, e = vec2(0.956, -0.292) * 46.0; vec4 s0 = texture(uLand, (cw - uExt.xy) * uExt.zw), s1 = texture(uLand, (cw + e - uExt.xy) * uExt.zw), s2 = texture(uLand, (cw - e - uExt.xy) * uExt.zw);
            if (min(s0.g, min(s1.g, s2.g)) > 0.62 && max(s0.r, max(s1.r, s2.r)) < 0.3 && max(s0.b, max(s1.b, s2.b)) < 0.3) { float aa = max(uWpp * 0.6, 0.3), lw = 0.4;
              vec3 turf = mix(vec3(0.15, 0.34, 0.13), vec3(0.20, 0.33, 0.14), uSeason) * (0.93 + 0.12 * step(0.5, fract(pl.x / 10.0)));
              float box = max(1.0 - smoothstep(lw, lw + aa, abs(a.x - 50.0)), 1.0 - smoothstep(lw, lw + aa, abs(a.y - 32.0))) * step(a.x, 50.6) * step(a.y, 32.6);
              float mid = max(1.0 - smoothstep(lw, lw + aa, a.x), 1.0 - smoothstep(lw, lw + aa, abs(length(pl) - 9.0))) * step(a.y, 32.0);
              float pen = max(1.0 - smoothstep(lw, lw + aa, abs(a.x - 34.0)) * 1.0, 1.0 - smoothstep(lw, lw + aa, abs(a.y - 20.0))) * step(34.0 - lw - aa, a.x) * step(a.x, 50.0) * step(a.y, 20.0 + lw + aa);
              grass = mix(grass, turf, step(a.x, 53.0) * step(a.y, 35.0)); grass = mix(grass, vec3(0.86, 0.87, 0.84), max(box, max(mid, pen)) * 0.75 * clamp((3.0 - uWpp) / 1.5, 0.0, 1.0)); } } } }
      { float res = lu.a * (1.0 - smoothstep(0.25, 0.5, lu.g)) * clamp((3.2 - uWpp) / 1.6, 0.0, 1.0); if (res > 0.01) { vec2 cg = floor(g / vec2(15.0, 36.0)), fg = fract(g / vec2(15.0, 36.0)); float tone = hash(cg + 0.7); // back yards: a patchwork of lawns, fences, the odd pool, deck or garden bed
          grass = mix(grass, grass * (0.93 + 0.14 * tone), res);
          float fence = max(step(fg.x, 0.035), step(fg.y, 0.014)) * fine; grass = mix(grass, grass * 0.72, fence * res * 0.5 * fill);
                    } }
      // paved lots: where the land map says commercial, with a ragged edge so they read as separate properties
      float pm = smoothstep(0.40, 0.52, lu.b + (n - 0.5) * 0.24) * (1.0 - smoothstep(0.3, 0.55, lu.g)) * lu.a;
      vec3 asphalt = vec3(0.225, 0.228, 0.24) * (0.88 + 0.22 * vn(vW / 17.0)) * (1.0 + (hash(floor(vW * 0.7)) - 0.5) * 0.08 * fine);
      vec3 land = mix(grass, asphalt, pm);
      // parking rows follow the Scarborough street grid (about 17 degrees off north): painted stalls, and cars in some of them
      float lot = pm * clamp((2.6 - uWpp) / 1.2, 0.0, 1.0), lamp = 0.0, sodium = 0.0;
      if (fill > 0.01) { // neighbourhood fill: the traffic model leaves out many small streets, so the gaps get generic side streets, driveways and yards (houses are placed to match)
        float sy = abs(mod(g.y + 39.0, 78.0) - 39.0), sx = abs(mod(g.x + 130.0, 260.0) - 130.0), d = min(sy, sx), aa = max(uWpp * 0.7, 0.25);
        float road = 1.0 - smoothstep(3.7, 3.7 + aa, d), walk = (1.0 - smoothstep(0.55, 0.55 + aa, abs(d - 6.3))) * clamp((2.8 - uWpp) / 1.4, 0.0, 1.0);
        float lotx = fract(g.x / 16.5), drive = step(0.12, lotx) * step(lotx, 0.30) * step(3.7, sy) * step(sy, 13.0) * step(14.0, sx) * clamp((2.8 - uWpp) / 1.4, 0.0, 1.0);
        vec2 did = vec2(floor(g.x / 16.5), floor((g.y + 39.0) / 78.0) * 2.0 + step(39.0, mod(g.y + 39.0, 78.0))); float pc = step(hash(did + 2.9), 0.45 + 0.25 * uNight) * drive * smoothstep(0.42, 0.36, abs(lotx - 0.21) / 0.18) * step(abs(sy - 9.0), 2.2) * fine;
        land = mix(land, vec3(0.50, 0.50, 0.48), max(walk, drive) * fill * 0.9); land = mix(land, cpal(hash(did + 5.5)) * (0.75 + 0.3 * smoothstep(2.2, 0.0, abs(sy - 9.0))), pc * fill);
        land = mix(land, vec3(0.232, 0.242, 0.262) * (0.94 + 0.12 * hash(floor(vW * 1.7))), road * fill);
        float du = mod(g.x, 42.0) - 21.0; sodium = exp(-(du * du + sy * sy) / 75.0) * fill * (1.0 - smoothstep(8.0, 14.0, sy)); }
      if (lot > 0.01) { float row = mod(g.y, 17.0), back = step(11.6, row), inBand = step(row, 5.2) + back * step(row, 16.8);
        float sx = g.x / 2.75, fx = fract(sx), t = (row - back * 11.6) / 5.2, aa = uWpp * 0.3;
        float paint = (1.0 - smoothstep(0.03, 0.03 + aa, min(fx, 1.0 - fx))) * inBand;
        vec2 id = vec2(floor(sx), floor(g.y / 17.0) * 2.0 + back); float busy = 0.25 + 0.5 * vn(vW / 90.0);
        float car = inBand * step(hash(id), busy * mix(0.3, 1.0, uDay)) * smoothstep(0.37, 0.37 - aa, abs(fx - 0.5)) * smoothstep(0.44, 0.44 - aa * 0.6, abs(t - 0.5));
        vec3 cc = cpal(hash(id + 7.3)); cc = mix(cc, vec3(0.05, 0.07, 0.10), max(smoothstep(0.07, 0.03, abs(t - 0.32)), smoothstep(0.06, 0.03, abs(t - 0.74))) * 0.85); cc *= 0.82 + 0.3 * smoothstep(0.3, 0.0, abs(fx - 0.5));
        float shadow = inBand * step(hash(vec2(floor(sx - 0.18), id.y)), busy * mix(0.3, 1.0, uDay)) * smoothstep(0.37, 0.3, abs(fract(sx - 0.18) - 0.5)) * smoothstep(0.46, 0.4, abs(t - 0.56));
        land = mix(land, vec3(0.74, 0.74, 0.70), paint * 0.55 * lot); land *= 1.0 - 0.35 * shadow * lot * (1.0 - car) * uDay; land = mix(land, cc, car * lot);
        vec2 lg = (fract(g / 34.0) - 0.5) * 34.0; lamp = exp(-dot(lg, lg) / 110.0) * pm; }
      land = mix(land, vec3(0.80, 0.83, 0.88), uSnowG * (0.55 + 0.25 * n));
      vec3 nearC = land * mix(vec3(0.11, 0.135, 0.20), vec3(1.0), uDay) + (vec3(1.0, 0.80, 0.52) * lamp * 0.11 + vec3(1.0, 0.60, 0.26) * sodium * 0.30) * uNight;
      vec3 farC = vec3(0.022 + uDay * 0.05, 0.03 + uDay * 0.055, 0.04 + uDay * 0.06) * (vec3(1.0) + lu.g * vec3(-0.10, 0.28, -0.05) + lu.b * 0.18);
      vec3 c = mix(farC, nearC, close * (0.3 + 0.7 * lu.a)); c *= mix(1.0, 0.8, uRain); o = vec4(c, 1.0); }`);
  P.flat = prog(`layout(location=0) in vec2 aP; layout(location=1) in vec4 aC; ${CAM_U} out vec4 vC; out vec2 vW; void main(){ gl_Position = uVP * vec4(aP.x, -aP.y, 0.0, 1.0); vC = aC; vW = aP; }`,
    `in vec4 vC; in vec2 vW; ${CAM_U} out vec4 o; void main(){ vec3 c = vC.rgb; float w = 0.5 + 0.5 * sin(vW.x * 0.004 + uTime * 0.25) * sin(vW.y * 0.003 - uTime * 0.2); c += vC.a * w * 0.012 * (1.0 + uDay * 2.0); float close = clamp((6.0 - uWpp) / 4.5, 0.0, 1.0); c = mix(c, mix(vec3(0.016, 0.035, 0.06), vec3(0.09, 0.22, 0.32), uDay) * (0.85 + 0.3 * w), close * vC.a); o = vec4(c, 1.0); }`);
  P.rail = prog(`layout(location=0) in vec2 aP; layout(location=1) in vec2 aN; layout(location=2) in vec2 aI; ${CAM_U} out float vLat; out float vDist; out float vPx;
    void main(){ float hw = 2.6, useHw = max(hw, 0.8 * uWpp); vec2 p = aP + aN * aI.x * useHw; gl_Position = uVP * vec4(p.x, -p.y, 0.0, 1.0); vLat = aI.x * useHw; vDist = aI.y; vPx = useHw / uWpp; }`,
    `in float vLat; in float vDist; in float vPx; ${CAM_U} out vec4 o;
    void main(){ float aa = uWpp * 0.8, detail = clamp((1.6 - uWpp) / 1.0, 0.0, 1.0), x = abs(vLat);
      vec3 ballast = mix(vec3(0.050, 0.047, 0.044), vec3(0.29, 0.27, 0.25), uDay), tie = mix(vec3(0.035, 0.03, 0.026), vec3(0.21, 0.17, 0.14), uDay), steel = mix(vec3(0.13, 0.13, 0.14), vec3(0.60, 0.60, 0.63), uDay);
      float t = (1.0 - smoothstep(0.12, 0.12 + aa, abs(fract(vDist / 0.65) - 0.5) * 0.65)) * (1.0 - smoothstep(1.3, 1.3 + aa, x));
      float r = 1.0 - smoothstep(0.07, 0.07 + aa, abs(x - 0.75));
      vec3 c = mix(ballast, tie, t * detail); c = mix(c, steel, max(r * detail, (1.0 - detail) * 0.35));
      o = vec4(c, 1.0 - smoothstep(vPx - 0.75, vPx + 0.25, x / uWpp)); }`);
  P.road = prog(`layout(location=0) in vec2 aP; layout(location=1) in vec2 aN; layout(location=2) in vec4 aI; layout(location=3) in vec3 aJ; ${CAM_U} uniform float uPass;
    out float vSide; out float vPx; out float vCls; out float vLit; out vec2 vW; out float vA; out float vHw; out float vDist; out vec2 vLanes;
    void main(){ float side = aI.x, hw = aI.y + uPass * 4.4, minPx = aI.z; float cls = floor(aI.w / 2.0); float lit = mod(aI.w, 2.0);
      float hwPx = hw / uWpp; float useHw = max(hw, minPx * 0.5 * uWpp); vec2 p = aP + aN * side * useHw;
      gl_Position = uVP * vec4(p.x, -p.y, 0.0, 1.0); vSide = side; vPx = max(hwPx, minPx * 0.5); vCls = cls; vLit = lit; vW = p; vA = clamp(hwPx * 2.0 / max(minPx, 0.01), 0.0, 1.0);
      vHw = hw; vDist = aJ.x; vLanes = aJ.yz; }`,
    `in float vSide; in float vPx; in float vCls; in float vLit; in vec2 vW; in float vA; in float vHw; in float vDist; in vec2 vLanes; ${CAM_U} ${OUTAGE_U} uniform float uPass; uniform float uSnowG; out vec4 o;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float line(float x, float c, float w, float aa){ return 1.0 - smoothstep(w * 0.5, w * 0.5 + aa, abs(x - c)); }
    void main(){ float edge = 1.0 - smoothstep(vPx - 0.75, vPx + 0.25, abs(vSide) * vPx);
      if (uPass > 0.5) { // beside the road: curb, grass boulevard, concrete sidewalk (gravel shoulder on a highway)
        float d = abs(vSide) * vHw - (vHw - 4.4), sd = clamp((2.6 - uWpp) / 1.4, 0.0, 1.0); if (d < -0.5 || sd <= 0.0) discard;
        vec3 conc = mix(vec3(0.085, 0.09, 0.105), vec3(0.56, 0.55, 0.52), uDay), grass = mix(vec3(0.022, 0.032, 0.03), vec3(0.20, 0.27, 0.15), uDay), grav = mix(vec3(0.05, 0.05, 0.055), vec3(0.37, 0.35, 0.32), uDay);
        float j = 1.0 - 0.10 * step(0.93, fract(vDist / 1.6)) * clamp((1.0 - uWpp) / 0.6, 0.0, 1.0);
        vec3 sc = vCls < 1.5 ? grav * (0.92 + 0.16 * hash(floor(vW * 1.3))) : d < 0.35 ? conc * 1.12 : d < 1.9 ? grass * (0.9 + 0.2 * hash(floor(vW * 1.1))) : conc * j;
        sc = mix(sc, vec3(0.82, 0.85, 0.9) * mix(0.16, 1.0, uDay), uSnowG * 0.6); sc *= mix(1.0, 0.82, uRain);
        o = vec4(sc, sd * (1.0 - smoothstep(3.5, 4.3, d)) * edge); return; }
      vec3 dayC = vCls < 0.5 ? vec3(0.40,0.40,0.42) : vCls < 1.5 ? vec3(0.36,0.36,0.38) : vCls < 2.5 ? vec3(0.33,0.34,0.37) : vCls < 3.5 ? vec3(0.30,0.31,0.34) : vCls < 4.5 ? vec3(0.27,0.28,0.30) : vec3(0.23,0.24,0.26);
      vec3 nightC = vCls < 0.5 ? vec3(0.085,0.08,0.075) : vCls < 2.5 ? vec3(0.07,0.068,0.066) : vec3(0.055,0.056,0.06);
      vec3 c = mix(nightC, dayC, uDay);
      float detail = clamp((1.4 - uWpp) / 0.9, 0.0, 1.0);
      float lat = vSide * vHw;
      float g = hash(floor(vW * 1.7)); float patchN = hash(floor(vW / 7.0)); c *= 1.0 + ((g - 0.5) * 0.10 + (patchN - 0.5) * 0.07) * detail;
      float k = outage(vW);
      float du = (fract(vDist / 36.0) - 0.5) * 36.0; float lampSide = fract(vDist / 72.0) < 0.5 ? 1.0 : -1.0;
      float pool = exp(-du * du / 70.0) * exp(-pow(lat - lampSide * vHw * 0.75, 2.0) / (vHw * vHw * 0.9 + 6.0));
      vec3 sodium = vec3(1.0, 0.60, 0.26);
      float baseGlow = vCls < 0.5 ? 0.11 : vCls < 2.5 ? 0.09 : vCls < 4.5 ? 0.07 : 0.05;
      float glow = mix(baseGlow, baseGlow * 0.5 + pool * 0.55, detail);
      c += sodium * glow * vLit * uNight * k;
      if (detail > 0.0 && vCls < 4.5) {
        float aa = uWpp * 0.9; vec3 wht = vec3(0.78, 0.78, 0.74) * mix(0.55, 1.0, uDay); vec3 ylw = vec3(0.85, 0.66, 0.15) * mix(0.55, 1.0, uDay);
        float m = 0.0; vec3 mc = wht; float dash = step(0.45, fract(vDist / 9.0));
        if (vLanes.y > 0.5) { float yl = line(lat, -0.18, 0.12, aa) + line(lat, 0.18, 0.12, aa); if (yl > 0.0) { m = min(1.0, yl); mc = ylw; }
          for (int i = 1; i < 4; i++) { if (float(i) < vLanes.x) m = max(m, line(lat, float(i) * 3.4, 0.13, aa) * dash); if (float(i) < vLanes.y) m = max(m, line(lat, -float(i) * 3.4, 0.13, aa) * dash); } }
        else { float w0 = -vLanes.x * 1.7; for (int i = 1; i < 5; i++) if (float(i) < vLanes.x) m = max(m, line(lat, w0 + float(i) * 3.4, 0.13, aa) * dash); }
        m = max(m, line(abs(lat), vHw - 0.7, 0.12, aa) * 0.8);
        c = mix(c, mc * (1.0 + glow * uNight * 2.0), m * detail * 0.85);
      }
      c += uRain * (0.025 + pool * 0.10 * uNight * vLit) * detail;
      c *= mix(1.0, 0.85, uRain);
      float a = edge * (vCls > 4.5 ? mix(0.55, 1.0, vA) : 1.0);
      o = vec4(c, a); }`);
  P.bld = prog(`layout(location=0) in vec3 aP; layout(location=1) in vec3 aN; layout(location=2) in vec4 aI; layout(location=3) in vec4 aJ; ${CAM_U} uniform float uGrow;
    out vec3 vN; out vec3 vL; out float vSeed; out vec3 vW; out float vKind; out vec4 vQ;
    void main(){ float c = cos(aI.z), s = sin(aI.z); float h = aJ.z * uGrow; vQ = vec4(aP.xy * aJ.xy, aJ.xy);
      vec2 l = vec2(aP.x * aJ.x, aP.y * aJ.y); vec2 p = aI.xy + vec2(l.x * c - l.y * s, l.x * s + l.y * c);
      vec3 n = vec3(aN.x * c - aN.y * s, aN.x * s + aN.y * c, aN.z);
      gl_Position = uVP * vec4(p.x, -p.y, aP.z * h + 0.02, 1.0);
      vN = n; vL = vec3(aP.x * aJ.x + aP.y * aJ.y, aP.z * aJ.z, aP.z); vSeed = aI.w; vW = vec3(p, aP.z * h); vKind = aJ.w; }`,
    `in vec3 vN; in vec3 vL; in float vSeed; in vec3 vW; in float vKind; in vec4 vQ; ${CAM_U} ${OUTAGE_U} uniform float uSnowG; out vec4 o;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main(){ bool roof = vN.z > 0.3; float hs = fract(vSeed * 13.7); vec3 base = hs < 0.30 ? mix(vec3(0.42, 0.25, 0.19), vec3(0.52, 0.33, 0.25), vSeed) : hs < 0.52 ? mix(vec3(0.58, 0.54, 0.46), vec3(0.70, 0.66, 0.58), vSeed) : hs < 0.70 ? mix(vec3(0.44, 0.44, 0.44), vec3(0.60, 0.60, 0.59), vSeed) : hs < 0.85 ? vec3(0.72, 0.72, 0.70) : mix(vec3(0.36, 0.42, 0.48), vec3(0.50, 0.44, 0.34), vSeed); // brick, beige siding, grey, white, blue-grey
      vec3 nn = normalize(vN * vec3(1.0, -1.0, 1.0)), amb = mix(vec3(0.27, 0.28, 0.31), vec3(0.44, 0.50, 0.60), nn.z * 0.5 + 0.5), sunC = vec3(1.0, 0.94, 0.84);
      if (vKind > 0.5) base = mix(vec3(0.38, 0.40, 0.44), vec3(0.55, 0.56, 0.58), vSeed);
      if (vKind > 2.5) base = mix(vec3(0.40, 0.25, 0.19), vec3(0.52, 0.34, 0.25), vSeed); // school / place of worship: brick
      else if (vKind > 1.5) base = vSeed > 0.6 ? mix(vec3(0.46, 0.36, 0.30), vec3(0.56, 0.44, 0.36), vSeed) : mix(vec3(0.50, 0.49, 0.46), vec3(0.62, 0.61, 0.57), vSeed); // apartment tower: concrete or brick
      vec3 sun = normalize(vec3(-0.5, 0.35, 0.8)); float diff = max(0.0, dot(vN * vec3(1.0, -1.0, 1.0), sun));
      vec3 c;
      if (roof) { float det = clamp((1.6 - uWpp) / 1.0, 0.0, 1.0); vec3 rc;
        if (vKind > 0.5) { float rt = fract(vSeed * 7.3); rc = rt < 0.45 ? mix(vec3(0.24, 0.25, 0.27), vec3(0.32, 0.32, 0.33), rt * 2.0) : rt < 0.8 ? vec3(0.37, 0.36, 0.34) : vec3(0.46, 0.47, 0.48); // flat roof: dark membrane, gravel or white, with a parapet, seams, units and skylights
          vec2 e = vQ.zw * 0.5 - abs(vQ.xy); float ed = min(e.x, e.y), rim = 1.0 - smoothstep(0.5, 0.9, ed); rc *= 1.0 + 0.30 * rim * det; rc *= 1.0 - 0.22 * det * smoothstep(2.2, 0.9, ed) * (1.0 - rim);
          rc *= 0.96 + 0.08 * hash(floor(vQ.xy / 2.3) + vSeed); rc *= 1.0 - 0.10 * det * max(step(0.96, fract(vQ.x / 6.0)), step(0.96, fract(vQ.y / 6.0)));
          vec2 cl = floor(vQ.xy / 7.0), f = fract(vQ.xy / 7.0); float pick = hash(cl + vSeed * 31.0), inr = step(2.4, ed);
          float unit = step(0.72, pick) * step(0.22, f.x) * step(f.x, 0.62) * step(0.28, f.y) * step(f.y, 0.64) * inr, sky = step(pick, 0.14) * step(0.3, f.x) * step(f.x, 0.5) * step(0.25, f.y) * step(f.y, 0.75) * inr;
          rc = mix(rc, vec3(0.62, 0.63, 0.65) * (0.85 + 0.3 * step(0.5, fract(vQ.x / 0.5))), unit * det); rc *= 1.0 - 0.38 * det * step(0.72, pick) * step(0.62, f.x) * step(f.x, 0.74) * step(0.28, f.y) * step(f.y, 0.64) * inr;
          rc = mix(rc, vec3(0.30, 0.42, 0.52), sky * det); }
        else { float t = fract(vSeed * 5.7); rc = t < 0.34 ? vec3(0.23, 0.21, 0.20) : t < 0.6 ? vec3(0.33, 0.25, 0.20) : t < 0.82 ? vec3(0.30, 0.30, 0.31) : vec3(0.38, 0.20, 0.16); // shingles: charcoal, brown, grey, red
          rc *= 1.0 - 0.07 * det * step(0.5, fract(vQ.y * 1.4)); }
        rc = mix(rc, vec3(0.86, 0.88, 0.92), uSnowG * 0.75);
        c = rc * (amb * 0.95 + sunC * diff * 0.62) * mix(0.34, 1.0, uDay) + vec3(0.0, 0.01, 0.03) * uNight; }
      else { c = base * (amb * 0.9 + sunC * diff * 0.66) * mix(0.26, 1.0, uDay); c *= 0.58 + 0.42 * smoothstep(0.0, 0.22, vL.z); }
      bool shop = vKind > 0.5 && vKind < 1.5 && !roof && vL.y < 4.5;
      if (shop) { float lit = outage(vW.xy); // ground floor of a plaza or office: glass storefronts under a band of shop signs
        if (vL.y < 3.3) { float fxs = fract(vL.x / 3.2), pane = step(0.07, fxs) * step(fxs, 0.93) * step(0.4, vL.y) * step(vL.y, 3.05);
          vec3 glass = mix(vec3(0.06, 0.09, 0.13), vec3(0.22, 0.30, 0.38), smoothstep(0.4, 3.3, vL.y)) + 0.10 * diff; c = mix(c, glass * mix(0.3, 1.0, uDay), pane * 0.92);
          c += vec3(1.0, 0.80, 0.52) * pane * uNight * 0.6 * lit * step(hash(vec2(floor(vL.x / 3.2), vSeed * 91.0)), 0.78); }
        else { float sx = vL.x / 9.6 + vSeed * 13.0, hsn = hash(vec2(floor(sx), vSeed * 57.0)), band = step(3.45, vL.y) * step(vL.y, 4.35) * step(0.07, fract(sx)) * step(fract(sx), 0.93);
          vec3 sign = hsn < 0.2 ? vec3(0.76, 0.09, 0.09) : hsn < 0.38 ? vec3(0.09, 0.26, 0.64) : hsn < 0.52 ? vec3(0.94, 0.70, 0.08) : hsn < 0.66 ? vec3(0.08, 0.46, 0.24) : hsn < 0.8 ? vec3(0.90, 0.90, 0.88) : vec3(0.88, 0.40, 0.07);
          c = mix(c, sign * (0.5 + 0.55 * diff) * mix(0.35, 1.0, uDay), band); c += sign * band * uNight * 0.85 * lit; } }
      if (!roof && !shop) { bool tower = vKind > 1.5 && vKind < 2.5; float wx = vL.x / (tower ? 3.4 : 2.6), wz = vL.y / 3.0; vec2 cell = floor(vec2(wx, wz)); vec2 f = fract(vec2(wx, wz));
        float win = step(0.25, f.x) * step(f.x, 0.75) * step(0.3, f.y) * step(f.y, 0.75) * step(0.6, vL.y);
        if (tower) c *= 1.0 - 0.3 * step(0.86, f.y) * step(3.0, vL.y); // balcony slab edges
        float on = step(hash(cell + vSeed * 17.0), tower ? 0.62 : vKind > 0.5 ? 0.55 : 0.5);
        vec3 wc = mix(vec3(1.0, 0.7, 0.38), vec3(0.7, 0.8, 1.0), step(0.85, hash(cell * 1.7 + vSeed)));
        c = mix(c, vec3(0.10, 0.14, 0.19) + 0.10 * diff, win * 0.75 * uDay); c += wc * win * on * uNight * (vKind > 0.5 ? 1.4 : 1.35) * outage(vW.xy); }
      c *= mix(1.0, 0.85, uRain);
      o = vec4(c, 1.0); }`);
  // planar shadows: the same boxes flattened onto the ground along the sun direction; the stencil keeps overlaps from doubling
  P.shd = prog(`layout(location=0) in vec3 aP; layout(location=2) in vec4 aI; layout(location=3) in vec4 aJ; ${CAM_U} uniform float uGrow; uniform vec2 uSh; uniform float uTree;
    void main(){ vec2 p; float z;
      if (uTree > 0.5) { float r = aI.z * mix(1.0, 1.15 * (1.0 - aP.z * 0.85), step(0.5, aJ.y)); p = aI.xy + aP.xy * r; z = aP.z * aI.w * uGrow; }
      else { float c = cos(aI.z), s = sin(aI.z); vec2 l = vec2(aP.x * aJ.x, aP.y * aJ.y); p = aI.xy + vec2(l.x * c - l.y * s, l.x * s + l.y * c); z = aP.z * aJ.z * uGrow; }
      p += uSh * z; gl_Position = uVP * vec4(p.x, -p.y, 0.0, 1.0); }`,
    `uniform float uA; out vec4 o; void main(){ o = vec4(0.0, 0.01, 0.03, uA); }`);
  // trees: low-poly canopies, coloured by season; bare ones are drawn as a see-through mesh of twigs
  P.tree = prog(`layout(location=0) in vec3 aP; layout(location=1) in vec3 aN; layout(location=2) in vec4 aI; layout(location=3) in vec4 aJ; ${CAM_U} uniform float uGrow; uniform float uSeason;
    out vec3 vN; out float vSeed; out float vZ; out float vKind; out float vBare;
    void main(){ float con = step(0.5, aJ.y), bare = (1.0 - con) * step(aJ.x, smoothstep(0.55, 0.95, uSeason) * 0.72); float r = aI.z * mix(1.0, 1.15 * (1.0 - aP.z * 0.85), con) * (1.0 - 0.18 * bare);
      float sway = sin(uTime * 0.9 + aJ.x * 40.0) * 0.12 * aP.z; vec2 p = aI.xy + aP.xy * r + vec2(sway, sway * 0.6);
      gl_Position = uVP * vec4(p.x, -p.y, aP.z * aI.w * uGrow + 0.02, 1.0); vN = aN; vSeed = aJ.x; vZ = aP.z; vKind = aJ.y; vBare = bare; }`,
    `in vec3 vN; in float vSeed; in float vZ; in float vKind; in float vBare; ${CAM_U} uniform float uSeason; uniform float uSnowG; out vec4 o;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main(){ vec3 sun = normalize(vec3(-0.5, 0.35, 0.8)); float diff = max(0.0, dot(vN * vec3(1.0, -1.0, 1.0), sun)); float t = fract(vSeed * 9.7); vec3 c;
      if (vKind > 0.5) c = mix(vec3(0.06, 0.17, 0.09), vec3(0.10, 0.24, 0.12), t);
      else if (vBare > 0.5) { if (hash(floor(gl_FragCoord.xy * 0.5) + vSeed) < 0.32) discard; c = mix(vec3(0.20, 0.17, 0.14), vec3(0.29, 0.25, 0.20), t); }
      else { vec3 green = mix(vec3(0.12, 0.29, 0.09), vec3(0.25, 0.42, 0.13), t), fall = t < 0.3 ? vec3(0.74, 0.38, 0.07) : t < 0.55 ? vec3(0.62, 0.17, 0.08) : t < 0.85 ? vec3(0.80, 0.62, 0.12) : vec3(0.30, 0.38, 0.12);
        c = mix(green, fall, smoothstep(0.25, 0.5, uSeason) * (1.0 - smoothstep(0.96, 1.0, uSeason))); }
      c *= (0.42 + 0.62 * diff) * (0.72 + 0.4 * vZ); c = mix(c, vec3(0.88, 0.90, 0.94), uSnowG * smoothstep(0.2, 0.7, vN.z) * 0.8);
      c *= mix(vec3(0.16, 0.19, 0.27), vec3(1.0), uDay); c *= mix(1.0, 0.85, uRain); o = vec4(c, 1.0); }`);
  P.ov = prog(`layout(location=0) in vec2 aP; layout(location=1) in vec2 aN; layout(location=2) in vec4 aI; ${CAM_U} uniform sampler2D uSpd; uniform float uOvA;
    out vec4 vC; out float vSide; out float vPx;
    void main(){ float side = aI.x, hw = aI.y, off = aI.z; int ec = int(aI.w + 0.5); int e = ec % 100000; int cls = ec / 100000;
      vec2 tv = texelFetch(uSpd, ivec2(e % 2048, e / 2048), 0).rg; float sv = tv.r * 255.0; float cut = tv.g * 255.0;
      float hwU = max(hw, 0.85 * uWpp); float offU = max(off, 1.3 * uWpp);
      vec2 p = aP + aN * (offU + side * hwU); gl_Position = uVP * vec4(p.x, -p.y, 0.0, 1.0);
      float r = sv / 200.0; vec3 c = r > 0.72 ? vec3(0.18,0.85,0.45) : r > 0.45 ? vec3(1.0,0.72,0.12) : r > 0.18 ? vec3(1.0,0.28,0.18) : vec3(0.65,0.05,0.12);
      float a = sv > 254.0 ? 0.0 : (r > 0.72 ? 0.35 : 0.9);
      if (cls == 5) { a *= 0.45; float ck = smoothstep(8.0, 60.0, cut); if (ck > 0.0) { c = mix(c, vec3(0.78, 0.45, 1.0), ck); a = max(a, ck * 0.95); } }
      vC = vec4(c, a * uOvA); vSide = side; vPx = hwU / uWpp; }`,
    `in vec4 vC; in float vSide; in float vPx; out vec4 o; void main(){ float a = 1.0 - smoothstep(vPx - 0.6, vPx + 0.3, abs(vSide) * vPx); o = vec4(vC.rgb, vC.a * a); }`);
  const CAR_COMMON = `
    float fl = aI.w; int f = int(fl + 0.5); int type = f & 7; int brake = (f >> 3) & 1; int col = (f >> 4) & 255; int lng = (f >> 12) & 1; int work = (f >> 13) & 1; int special = (f >> 14) & 1;
    int uid = (f >> 15) & 255; int quiet = (f >> 23) & 1;
    bool bus = lng == 1 && (col == 255 || col == 252); bool coach = lng == 1 && col == 254; float len = coach ? 25.0 : type == 7 ? 11.0 : bus ? 12.0 : lng == 1 ? 10.0 : (type >= 4 ? 8.0 : (type >= 2 ? 5.2 : 4.6)); float wid = coach ? 3.2 : type == 7 || bus ? 2.6 : lng == 1 ? 2.5 : (type >= 4 ? 2.4 : 2.0);`;
  P.car = prog(`layout(location=0) in vec2 aQ; layout(location=1) in vec4 aI; ${CAM_U} out vec2 vQ; out vec3 vCol; out float vPx; flat out int vType; flat out int vBrake;
    vec3 pal(int i){ int k = i % 10; return k == 0 ? vec3(0.92) : k == 1 ? vec3(0.62,0.64,0.66) : k == 2 ? vec3(0.07,0.07,0.08) : k == 3 ? vec3(0.28,0.29,0.31) : k == 4 ? vec3(0.62,0.08,0.07) : k == 5 ? vec3(0.12,0.22,0.48) : k == 6 ? vec3(0.08,0.12,0.22) : k == 7 ? vec3(0.66,0.6,0.5) : k == 8 ? vec3(0.85,0.85,0.88) : vec3(0.18,0.33,0.25); }
    void main(){ ${CAR_COMMON}
      float lpx = len / uWpp; float s = max(1.0, 3.2 / max(lpx, 0.01));
      vec2 q = aQ * 1.35 * vec2(len * 0.5, wid * 0.5) * vec2(s, max(s * 0.7, 1.0)); float c = cos(aI.z), sn = sin(aI.z);
      vec2 p = aI.xy + vec2(q.x * c - q.y * sn, q.x * sn + q.y * c);
      gl_Position = uVP * vec4(p.x, -p.y, 0.15, 1.0); vQ = aQ * 1.35; vPx = lpx * s; vType = type; vBrake = brake;
      vec3 bc = pal(col); if (lng == 1) bc = (col % 3 == 0) ? vec3(0.9,0.75,0.2) : vec3(0.85,0.86,0.88); if (bus) bc = col == 252 ? vec3(0.93,0.93,0.95) : vec3(0.86,0.09,0.07); if (coach) bc = vec3(0.12,0.42,0.22); if (lng == 1 && col == 253) bc = vec3(0.92,0.66,0.08);
      if (type == 2) bc = (special == 1 && (col & 1) == 1) ? vec3(0.13) : vec3(0.95); if (type == 3) bc = vec3(0.96,0.95,0.92); if (type == 7) bc = vec3(0.78,0.07,0.05); if (type == 4) bc = vec3(0.95,0.68,0.1); if (type == 5) bc = vec3(1.0,0.5,0.1); if (type == 6) bc = vec3(0.15,0.45,0.85);
      vCol = bc; }`,
    `in vec2 vQ; in vec3 vCol; in float vPx; flat in int vType; flat in int vBrake; ${CAM_U} uniform float uShOnly; out vec4 o;
    void main(){ vec2 q = abs(vQ); float r = 0.35; vec2 d = q - vec2(1.0 - r); float sd = length(max(d, 0.0)) - r; float aa = 2.0 / max(vPx, 1.0); float a = 1.0 - smoothstep(-aa, aa, sd);
      vec2 qs = abs(vQ - vec2(0.12, -0.18)); vec2 ds = qs - vec2(0.75); float sds = length(max(ds, 0.0)) - 0.3; float sh = (1.0 - smoothstep(-0.05, 0.45, sds)) * 0.55 * mix(0.5, 1.0, uDay) * step(4.0, vPx);
      if (uShOnly > 0.5) { float s2 = (1.0 - smoothstep(-0.25, 0.5, sds)) * 0.5 * mix(0.45, 1.0, uDay); if (s2 < 0.01) discard; o = vec4(0.0, 0.0, 0.0, s2); return; }
      if (a < 0.01) { if (sh < 0.01) discard; o = vec4(0.0, 0.0, 0.0, sh); return; }
      float roof = smoothstep(0.62, 0.5, abs(vQ.y)) * step(-0.45, vQ.x) * step(vQ.x, 0.35);
      vec3 c = vCol * mix(0.85, 1.0, roof);
      float wind = step(0.35, vQ.x) * step(vQ.x, 0.6) * step(abs(vQ.y), 0.7); c = mix(c, vec3(0.05,0.07,0.1), wind * 0.8);
      float amb = mix(0.42, 1.0, uDay); c *= amb; c += vec3(0.05, 0.035, 0.02) * (1.0 - uDay) * roof;
      if (vType == 2) { c = mix(c, vec3(0.02), step(abs(vQ.x), 0.25)); }
      o = vec4(c, max(a, sh * (1.0 - a))); }`);
  // close up, vehicles are solid: a body with wheels and lights, a glass cabin on cars, windows on buses, a cab and box on trucks
  P.car3 = prog(`layout(location=0) in vec3 aP; layout(location=1) in vec3 aN; layout(location=2) in vec4 aI; ${CAM_U} uniform float uPart;
    out vec3 vN; out vec3 vLN; out vec3 vL; out vec3 vCol; out vec3 vDim; out float vSeed; flat out int vType; flat out int vKind; flat out int vBrake; flat out int vSp;
    vec3 pal(int i){ int k = i % 10; return k == 0 ? vec3(0.92) : k == 1 ? vec3(0.62,0.64,0.66) : k == 2 ? vec3(0.07,0.07,0.08) : k == 3 ? vec3(0.28,0.29,0.31) : k == 4 ? vec3(0.62,0.08,0.07) : k == 5 ? vec3(0.12,0.22,0.48) : k == 6 ? vec3(0.08,0.12,0.22) : k == 7 ? vec3(0.66,0.6,0.5) : k == 8 ? vec3(0.85,0.85,0.88) : vec3(0.18,0.33,0.25); }
    void main(){ ${CAR_COMMON}
      int kind = bus ? 2 : coach ? 3 : lng == 1 ? 4 : type == 7 ? 5 : type == 3 ? 6 : type >= 4 ? 7 : 0;
      float ht = kind == 0 ? (type >= 2 ? 0.88 : 0.80) : kind == 2 ? 3.0 : kind == 3 ? 3.3 : kind == 4 ? 3.5 : kind == 5 ? 3.1 : kind == 6 ? 2.5 : 2.3;
      vec3 l, n = aN; vLN = aN; vN = aN; vL = vec3(0.0); vDim = vec3(len, wid, ht); vCol = vec3(0.0); vSeed = fract(float(uid) * 0.6180339); vType = type; vKind = kind; vBrake = brake; vSp = (special == 1 && quiet == 0) ? 1 : 0;
      if (uPart < 0.5) l = vec3(aP.x * len, aP.y * wid, 0.2 + aP.z * (ht - 0.2));
      else { if (kind != 0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        float top = step(0.5, aP.z), cl = len * mix(0.60, 0.40, top), cw = wid * mix(0.94, 0.80, top);
        l = vec3(aP.x * cl - len * 0.05, aP.y * cw, ht + aP.z * 0.60); n = normalize(vec3(aN.x, aN.y, aN.z + 0.4 * (1.0 - abs(aN.z)))); }
      float c = cos(aI.z), s = sin(aI.z); vec2 p = aI.xy + vec2(l.x * c - l.y * s, l.x * s + l.y * c);
      vN = vec3(n.x * c - n.y * s, n.x * s + n.y * c, n.z); vL = l; gl_Position = uVP * vec4(p.x, -p.y, l.z, 1.0);
      vec3 bc = pal(col); if (lng == 1) bc = (col % 3 == 0) ? vec3(0.9,0.75,0.2) : vec3(0.85,0.86,0.88); if (bus) bc = col == 252 ? vec3(0.93,0.93,0.95) : vec3(0.86,0.09,0.07); if (coach) bc = vec3(0.12,0.42,0.22); if (lng == 1 && col == 253) bc = vec3(0.92,0.66,0.08);
      if (type == 2) bc = (special == 1 && (col & 1) == 1) ? vec3(0.13) : vec3(0.95); if (type == 3) bc = vec3(0.96,0.95,0.92); if (type == 7) bc = vec3(0.78,0.07,0.05); if (type == 4) bc = vec3(0.95,0.68,0.1); if (type == 5) bc = vec3(1.0,0.5,0.1); if (type == 6) bc = vec3(0.15,0.45,0.85);
      vCol = bc; }`,
    `in vec3 vN; in vec3 vLN; in vec3 vL; in vec3 vCol; in vec3 vDim; in float vSeed; flat in int vType; flat in int vKind; flat in int vBrake; flat in int vSp; ${CAM_U} uniform float uPart; out vec4 o;
    void main(){ vec3 n = normalize(vN), sun = normalize(vec3(-0.5, 0.35, 0.8)); float diff = max(0.0, dot(n * vec3(1.0, -1.0, 1.0), sun));
      vec3 amb = mix(vec3(0.28, 0.29, 0.32), vec3(0.48, 0.54, 0.64), n.z * 0.5 + 0.5), c = vCol, em = vec3(0.0); float len = vDim.x, wid = vDim.y, ht = vDim.z, gm = 0.0, lightsOn = clamp(uNight + uRain * 0.6, 0.0, 1.0);
      bool top = vLN.z > 0.5, front = vLN.x > 0.5, rear = vLN.x < -0.5, side = abs(vLN.y) > 0.5; float strobe = step(0.5, fract(uTime * 2.3 + vSeed)), flick = 0.55 + 0.45 * step(0.5, fract(uTime * 13.0 + vSeed * 3.0));
      if (uPart > 0.5) { // cabin
        if (!top) { float along = side ? (vL.x + len * 0.05) / (len * 0.25) : vL.y / (wid * 0.43); gm = step(abs(along), 0.9) * step(ht + 0.08, vL.z) * step(vL.z, ht + 0.54); if (side) gm *= step(0.08, abs(along + 0.1)); }
        else if (vType == 2 && abs(vL.x + len * 0.03) < 0.16 && abs(vL.y) < wid * 0.34) { vec3 bar = vL.y > 0.0 ? vec3(1.0, 0.06, 0.04) : vec3(0.1, 0.25, 1.0); c = mix(vec3(0.25), bar, 0.6); if (vSp == 1) em += bar * flick * 2.6 * (vL.y > 0.0 ? strobe : 1.0 - strobe); } }
      else { float lz0 = vKind == 0 ? 0.46 : 0.62, lz1 = vKind == 0 ? 0.72 : 1.0, lamp = step(wid * 0.24, abs(vL.y)) * step(lz0, vL.z) * step(vL.z, lz1);
        if (front) { c = mix(c, vec3(0.93, 0.93, 0.86), lamp); em += vec3(1.0, 0.93, 0.8) * lamp * lightsOn * 1.6; }
        if (rear) { c = mix(c, vec3(0.5, 0.03, 0.03), lamp); em += vec3(1.0, 0.06, 0.04) * lamp * (lightsOn * 0.7 + float(vBrake) * 1.8); }
        float wr = vKind == 0 ? 0.34 : 0.5, wxo = len * (vKind == 0 ? 0.31 : 0.34);
        if (side) { float wd = length(vec2(abs(vL.x) - wxo, vL.z - wr)); c = mix(c, vec3(0.03), smoothstep(wr + 0.04, wr - 0.02, wd)); c = mix(c, vec3(0.42), smoothstep(wr * 0.5, wr * 0.4, wd)); }
        if (vKind == 2 || vKind == 3) { // bus, coach
          if (side) gm = step(1.3, vL.z) * step(vL.z, 2.35) * step(abs(vL.x), len * 0.47) * step(0.08, fract(vL.x / 1.45));
          if (front) gm = step(1.15, vL.z) * step(vL.z, 2.6) * step(abs(vL.y), wid * 0.44); if (rear) gm = step(1.7, vL.z) * step(vL.z, 2.4) * step(abs(vL.y), wid * 0.36);
          if (top) { c = mix(c, vec3(0.90, 0.90, 0.92), 0.8); c *= 1.0 - 0.18 * step(abs(abs(vL.x) - len * 0.22), 0.7) * step(abs(vL.y), wid * 0.3); }
          if (vKind == 2 && side && vL.z < 1.2 && vL.z > 0.95) c = mix(c, vec3(0.95), 0.9); }
        else if (vKind == 4) { // truck: cab and box
          bool cab = vL.x > len * 0.24; if (!cab) c = mix(vec3(0.84, 0.84, 0.82), vec3(0.62, 0.66, 0.72), step(0.6, vSeed)); c *= 1.0 - 0.6 * step(abs(vL.x - len * 0.24), 0.12);
          if (cab && top) c *= 0.9; if (front) gm = step(1.7, vL.z) * step(vL.z, 2.7) * step(abs(vL.y), wid * 0.42); if (cab && side) gm = step(1.8, vL.z) * step(vL.z, 2.6) * step(len * 0.30, vL.x) * step(vL.x, len * 0.46); }
        else if (vKind == 5) { // fire truck
          if (side && vL.z > 0.95 && vL.z < 1.25) c = vec3(0.95, 0.93, 0.85); if (top) c = mix(c, vec3(0.72), step(abs(vL.y), wid * 0.22) * step(vL.x, len * 0.2) * (0.4 + 0.6 * step(0.5, fract(vL.x / 0.55))));
          if (front) gm = step(1.5, vL.z) * step(vL.z, 2.5) * step(abs(vL.y), wid * 0.42); if (side) gm = step(1.7, vL.z) * step(vL.z, 2.4) * step(len * 0.2, vL.x) * step(vL.x, len * 0.44); }
        else if (vKind == 6) { // ambulance
          if (side && vL.z > 0.85 && vL.z < 1.15) c = vec3(0.95, 0.45, 0.05); if (front) gm = step(1.3, vL.z) * step(vL.z, 2.1) * step(abs(vL.y), wid * 0.42); if (side) gm = step(1.4, vL.z) * step(vL.z, 2.0) * step(len * 0.2, vL.x) * step(vL.x, len * 0.44); }
        else if (vKind == 7) { if (front) gm = step(1.3, vL.z) * step(vL.z, 2.05) * step(abs(vL.y), wid * 0.42); if (side) gm = step(1.4, vL.z) * step(vL.z, 2.0) * step(len * 0.12, vL.x) * step(vL.x, len * 0.42); if (top && vL.x < len * 0.08) c *= 0.55; }
        if (top && vKind >= 5 && vL.x > len * 0.26 && vL.x < len * 0.34 && abs(vL.y) < wid * 0.4) { vec3 a = vKind == 7 ? vec3(1.0, 0.55, 0.05) : vec3(1.0, 0.06, 0.04), b = vKind == 7 ? vec3(1.0, 0.75, 0.2) : vec3(1.0, 0.92, 0.85); vec3 bar = vL.y > 0.0 ? a : b; c = mix(vec3(0.3), bar, 0.5); if (vSp == 1) em += bar * flick * 2.6 * (vL.y > 0.0 ? strobe : 1.0 - strobe); } }
      vec3 glass = mix(vec3(0.04, 0.06, 0.09), vec3(0.26, 0.36, 0.48), clamp(n.z * 0.9 + 0.3, 0.0, 1.0)); c = mix(c, glass, gm);
      vec3 lit = c * (amb * 0.9 + vec3(1.0, 0.95, 0.86) * diff * 0.72) * mix(0.30, 1.0, uDay); lit += gm * vec3(0.9, 0.95, 1.0) * pow(diff, 6.0) * 0.35 * uDay; lit += c * vec3(1.0, 0.72, 0.42) * 0.10 * uNight;
      if ((vKind == 2 || vKind == 3) && gm > 0.5) lit += vec3(1.0, 0.9, 0.7) * 0.16 * uNight; // lit bus interior
      lit += em; lit *= mix(1.0, 0.86, uRain); o = vec4(lit, 1.0); }`);
  P.light = prog(`layout(location=0) in vec2 aQ; layout(location=1) in vec4 aI; ${CAM_U} out vec2 vL; out float vLen; out float vWid; out float vPx; flat out int vType; flat out int vBrake; flat out int vWork; flat out int vSpecial; flat out int vCoach; out float vSeed;
    void main(){ ${CAR_COMMON}
      float lpx = len / uWpp; float s = max(1.0, 3.6 / max(lpx, 0.01));
      float reach = special == 1 ? 26.0 : 22.0; bool strobing = special == 1 && quiet == 0;
      float back = len * 0.5 + 2.5, front = len * 0.5 + reach * min(1.0, lpx / 6.0) + 2.0;
      float side = strobing ? 34.0 : wid * 0.5 + 6.0; if (strobing) back = max(back, 34.0); if (strobing) front = max(front, 34.0);
      vec2 local = vec2(mix(-back, front, aQ.x * 0.5 + 0.5), aQ.y * side) * s;
      float c = cos(aI.z), sn = sin(aI.z); vec2 p = aI.xy + vec2(local.x * c - local.y * sn, local.x * sn + local.y * c);
      gl_Position = uVP * vec4(p.x, -p.y, 0.2, 1.0);
      vL = local / s; vLen = len; vWid = wid; vPx = lpx; vType = type; vBrake = brake; vWork = work; vSpecial = strobing ? 1 : 0; vCoach = coach ? (brake == 1 ? 1 : 2) : 0; vSeed = fract(float(uid) * 0.6180339); }`,
    `in vec2 vL; in float vLen; in float vWid; in float vPx; flat in int vType; flat in int vBrake; flat in int vWork; flat in int vSpecial; flat in int vCoach; in float vSeed; ${CAM_U} out vec4 o;
    float spot(vec2 p, vec2 c, float r){ float d = length(p - c) / r; return exp(-d * d * 2.5); }
    void main(){ if (vCoach == 2) discard; vec2 p = vL; float hl = vLen * 0.5, hw = vWid * 0.5; vec3 col = vec3(0.0);
      float far = clamp(1.0 - vPx / 10.0, 0.0, 1.0);
      float lightsOn = clamp(uNight + uRain * 0.6, 0.0, 1.0);
      // headlights
      vec3 hc = vec3(1.0, 0.92, 0.78);
      float h = spot(p, vec2(hl, hw * 0.6), 0.55) + spot(p, vec2(hl, -hw * 0.6), 0.55);
      float cone = 0.0; if (p.x > hl) { float dx = p.x - hl; float spread = 1.2 + dx * 0.32; cone = exp(-pow(p.y / spread, 2.0) * 1.6) * exp(-dx / 9.0) * 0.16 * (1.0 - far); }
      col += hc * (h * 2.4 + cone) * lightsOn;
      // tail / brake
      float t = spot(p, vec2(-hl, hw * 0.65), 0.45) + spot(p, vec2(-hl, -hw * 0.65), 0.45);
      float bk = vCoach == 1 ? 0.0 : float(vBrake);
      col += vec3(1.0, 0.06, 0.04) * t * (lightsOn * 0.9 + bk * 2.2);
      // far-zoom streak: compact glow so traffic reads as streams of light
      float sx = clamp((p.x + hl) / (2.0 * hl), 0.0, 1.0); float core = exp(-pow(length(vec2(max(abs(p.x) - hl, 0.0), p.y)) / (hw * 1.4), 2.0));
      col += mix(vec3(1.0, 0.12, 0.06) * (0.5 + bk * 0.6), hc * 0.9, sx) * core * far * (0.12 + lightsOn * 0.28);
      // emergency strobes
      if (vSpecial == 1) {
        float ph = fract(uTime * 2.3 + vSeed); float strobe = step(0.5, ph); float flick = 0.55 + 0.45 * step(0.5, fract(uTime * 13.0 + vSeed * 3.0));
        float d2 = dot(p, p); float halo = exp(-d2 / 40.0); float wash = exp(-d2 / 420.0) * (0.25 + uNight * 0.55);
        vec3 a = vec3(1.0, 0.06, 0.04), b = vec3(0.12, 0.3, 1.0);
        if (vType == 7 || vType == 3) b = vec3(1.0, 0.92, 0.85);
        if (vType >= 4 && vType <= 6) { a = vec3(1.0, 0.55, 0.05); b = vec3(1.0, 0.75, 0.2); }
        vec3 sc = mix(a, b, strobe) * flick;
        col += sc * (halo * 2.4 + wash * 0.9) * clamp(uWpp * 7.0, 0.2, 1.0); // glow shrinks when the camera is close so it doesn't blow out the scene
      }
      o = vec4(col, 1.0); }`);
  P.sprite = prog(`layout(location=0) in vec2 aQ; layout(location=1) in vec4 aI; layout(location=2) in vec4 aJ; ${CAM_U} out vec2 vQ; flat out int vK; out float vA; out float vT; out float vSeed;
    void main(){ int k = int(aJ.x + 0.5); float size = max(aI.w, aJ.z * uWpp); vec3 c = vec3(aI.x, -aI.y, aI.z);
      vec2 q = aQ; float rot = aJ.w; q = vec2(q.x * cos(rot) - q.y * sin(rot), q.x * sin(rot) + q.y * cos(rot));
      vec3 p = c + vec3(q * size, 0.0); gl_Position = uVP * vec4(p, 1.0); vQ = aQ; vK = k; vA = aJ.y; vT = uTime; vSeed = fract(aI.x * 0.013 + aI.y * 0.007); }`,
    `in vec2 vQ; flat in int vK; in float vA; in float vT; in float vSeed; ${CAM_U} out vec4 o;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float sdSeg(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)); }
    float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hash(i), hash(i + vec2(1,0)), f.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y); }
    void main(){ float d = length(vQ); vec4 c = vec4(0.0);
      if (vK == 0) { // fire
        float n = noise(vQ * 3.0 + vec2(0.0, -vT * 3.5) + vSeed * 10.0); float f = smoothstep(1.0, 0.0, d + n * 0.45 - 0.15);
        c = vec4(mix(vec3(1.0, 0.25, 0.02), vec3(1.0, 0.85, 0.35), f * f) * f * 2.4, 0.0); }
      else if (vK == 1) { // smoke (alpha)
        float n = noise(vQ * 2.2 + vSeed * 7.0 + vT * 0.2); float a = smoothstep(1.0, 0.2, d) * (0.55 + n * 0.45) * vA; c = vec4(mix(vec3(0.16, 0.13, 0.12) + vec3(0.18, 0.07, 0.02) * vA, vec3(0.22, 0.22, 0.23), uDay), a * 0.85); }
      else if (vK == 2) { // glow (colour in vA bands) red/blue/amber
        float g = exp(-d * d * 4.0); c = vec4(vec3(1.0, 0.55, 0.08) * g * vA, 0.0); }
      else if (vK == 3) { float g = exp(-d * d * 4.0); float s = step(0.5, fract(vT * 2.4 + vSeed)); c = vec4(mix(vec3(1.0, 0.06, 0.04), vec3(0.08, 0.2, 1.0), s) * g * vA * 2.0, 0.0); }
      else if (vK == 4) { // crater + water
        float rim = smoothstep(0.75, 0.6, d); float ring = exp(-pow((d - 0.78) * 9.0, 2.0)); float w = noise(vQ * 6.0 + vT * 1.5);
        vec3 water = mix(vec3(0.05, 0.12, 0.2), vec3(0.25, 0.5, 0.7), w) * (0.5 + uDay * 0.6);
        float a = smoothstep(1.0, 0.85, d); c = vec4(mix(water, vec3(0.02, 0.02, 0.025), rim * 0.6) + ring * vec3(0.3, 0.25, 0.2), a); }
      else if (vK == 5) { // flood puddle
        float n = noise(vQ * 4.0 + vT * 0.6 + vSeed * 3.0); float a = smoothstep(1.0, 0.6, d + n * 0.25) * 0.85; c = vec4(vec3(0.1, 0.25, 0.42) * (0.6 + 0.4 * n) * (0.6 + uDay * 0.6) + vec3(0.2, 0.35, 0.5) * uNight * 0.2, a); }
      else if (vK == 6) { // barricade bar
        float stripe = step(0.5, fract((vQ.x + vQ.y) * 3.0)); float a = step(abs(vQ.y), 0.22) * step(abs(vQ.x), 1.0); c = vec4(mix(vec3(1.0, 0.45, 0.05), vec3(0.95), stripe) * (0.6 + uNight * 0.5) * 1.3, a); }
      else if (vK == 7) { // pulse ring
        float ph = fract(vT * 0.7 + vSeed); float ring = exp(-pow((d - ph) * 14.0, 2.0)) * (1.0 - ph); c = vec4(vec3(1.0, 0.35, 0.2) * ring * vA * 1.5, 0.0); }
      else if (vK == 8) { // spray particles
        float g = exp(-d * d * 6.0); c = vec4(vec3(0.55, 0.8, 1.0) * g * vA, 0.0); }
      else if (vK == 9) { // dark outage dome (alpha)
        float a = smoothstep(1.0, 0.85, d) * 0.5 * vA * (0.4 + uNight * 0.6); c = vec4(0.0, 0.0, 0.02, a); }
      else if (vK == 10) { // local-only zone
        float ring = smoothstep(0.03, 0.0, abs(d - 0.97)); float fill = step(d, 1.0) * 0.06; c = vec4(vec3(0.75, 0.45, 1.0) * (ring * 0.9 + fill), (ring * 0.9 + fill) * vA); }
      else if (vK == 11) { // selection ring
        float ring = smoothstep(0.06, 0.0, abs(d - 0.9)); c = vec4(vec3(0.3, 0.85, 1.0) * ring * vA * 1.6, 0.0); }
      else if (vK == 20) { // traffic cone / barrel (alpha)
        float a = smoothstep(1.0, 0.75, d); vec3 col = mix(vec3(1.0, 0.4, 0.04), vec3(0.96), step(0.38, d) * step(d, 0.62)); c = vec4(col * (0.6 + uNight * 0.7), a * vA); }
      else if (vK == 21) { // amber work light (additive)
        float g = exp(-d * d * 4.0); float s = step(0.55, fract(vT * 1.1 + vSeed * 3.0)); c = vec4(vec3(1.0, 0.6, 0.06) * g * vA * (0.35 + s * 1.3), 0.0); }
      else if (vK == 22) { // pothole / patch (alpha): ragged dark hole with a paint ring from the City's marking crew
        float n = noise(vQ * 3.5 + vSeed * 9.0); float hole = smoothstep(0.62, 0.5, d + n * 0.22); float ring = exp(-pow((d - 0.85) * 10.0, 2.0)) * step(0.35, fract(atan(vQ.y, vQ.x) * 1.6));
        c = vec4(mix(vec3(0.015, 0.015, 0.018), vec3(1.0, 0.45, 0.6) * (0.5 + uNight * 0.6), ring) , max(hole, ring * 0.8) * vA); }
      else if (vK == 23) { // pedestrian, top view (alpha): coloured shoulders, dark head
        vec3 coat = vSeed < 0.3 ? vec3(0.8, 0.2, 0.15) : vSeed < 0.55 ? vec3(0.15, 0.35, 0.75) : vSeed < 0.75 ? vec3(0.9, 0.75, 0.2) : vec3(0.75, 0.75, 0.78);
        float body = smoothstep(1.0, 0.8, length(vQ / vec2(0.7, 1.0))), head = smoothstep(0.45, 0.35, d);
        c = vec4(mix(coat, vec3(0.12, 0.09, 0.07), head) * mix(0.55, 1.0, uDay), max(body, head) * vA); }
      else if (vK >= 24 && vK <= 29) { // people from above (alpha), facing +x: 24 officer, 25 hands up, 26 firefighter, 27 cuffed, 28 paramedic, 29 bystander
        vec2 q = vQ; vec2 h1 = vec2(0.30, 0.58), h2 = vec2(0.30, -0.58);
        if (vK == 24) { h1 = vec2(0.46, 0.36); h2 = vec2(0.46, -0.36); } else if (vK == 25) { h1 = vec2(0.66, 0.78); h2 = vec2(0.66, -0.78); }
        else if (vK == 27) { h1 = vec2(-0.42, 0.10); h2 = vec2(-0.42, -0.10); } else if (vK == 26) { h1 = vec2(0.74, 0.14); h2 = vec2(0.50, -0.24); }
        float torso = 1.0 - smoothstep(0.0, 0.07, length(q / vec2(0.32, 0.62)) - 1.0);
        float arms = 1.0 - smoothstep(0.0, 0.07, min(sdSeg(q, vec2(0.0, 0.54), h1), sdSeg(q, vec2(0.0, -0.54), h2)) - 0.12);
        float head = 1.0 - smoothstep(0.0, 0.07, length(q - vec2(0.03, 0.0)) - (vK == 26 ? 0.32 : 0.25));
        float hand = max(1.0 - smoothstep(0.0, 0.05, length(q - h1) - 0.11), 1.0 - smoothstep(0.0, 0.05, length(q - h2) - 0.11));
        vec3 cloth = vec3(0.07, 0.12, 0.30), hc = vec3(0.03, 0.05, 0.12);
        if (vK == 25 || vK == 27) { cloth = vec3(0.50, 0.51, 0.54); hc = vec3(0.30, 0.2, 0.14); }
        else if (vK == 26) { cloth = vec3(0.80, 0.62, 0.10); hc = vec3(0.98, 0.82, 0.08); }
        else if (vK == 28) { cloth = vec3(0.16, 0.62, 0.34); hc = vec3(0.12, 0.09, 0.07); }
        else if (vK == 29) { cloth = vSeed < 0.3 ? vec3(0.8, 0.2, 0.15) : vSeed < 0.55 ? vec3(0.15, 0.35, 0.75) : vSeed < 0.75 ? vec3(0.9, 0.75, 0.2) : vec3(0.75, 0.75, 0.78); hc = vec3(0.13, 0.09, 0.07); }
        vec3 col = mix(cloth, hc, head); col = mix(col, cloth * 0.8, arms * (1.0 - head) * (1.0 - torso));
        if (vK == 24) col = mix(col, vec3(0.9, 0.92, 0.95), step(abs(q.y), 0.55) * step(abs(q.x + 0.12), 0.05) * torso * (1.0 - head)); // reflective back stripe / shoulder number
        if (vK == 26) col = mix(col, vec3(0.95, 0.95, 0.9), step(abs(q.y), 0.6) * step(abs(q.x + 0.14), 0.045) * torso * (1.0 - head)); // turnout-coat reflective band
        col = mix(col, vec3(0.86, 0.66, 0.52), hand * (vK == 26 ? 0.0 : 1.0));
        if (vK == 27) col += vec3(0.8) * (1.0 - smoothstep(0.0, 0.06, length(q - vec2(-0.42, 0.0)) - 0.07)); // cuffs
        col *= mix(0.62, 1.12, uDay);
        float m = max(max(torso, arms), max(head, hand)); col *= mix(0.45, 1.0, smoothstep(0.0, 0.9, m + (1.0 - d) * 0.3));
        c = vec4(col, m * vA); }
      else if (vK == 13) { // helicopter body (top view), x = nose
        vec2 q = vQ; float cab = length(q / vec2(0.42, 0.24)) - 1.0; float boom = max(abs(q.y) - 0.05, max(-q.x - 0.95, q.x + 0.1));
        float fin = max(abs(q.y) - 0.16, abs(q.x + 0.92) - 0.05); float skid = max(abs(abs(q.y) - 0.22) - 0.025, abs(q.x - 0.02) - 0.3);
        float dd = min(min(cab, boom * 6.0), min(fin * 6.0, skid * 8.0)); float a = 1.0 - smoothstep(0.0, 0.06, dd);
        vec3 bc = vA > 0.5 ? vec3(0.12, 0.13, 0.15) : vec3(0.9, 0.9, 0.92); if (vA < 0.5) bc = mix(bc, vec3(0.1, 0.35, 0.85), step(0.0, -q.y) * step(q.x, 0.2) * step(-0.6, q.x));
        float glass = step(0.18, q.x) * step(cab, 0.0); bc = mix(bc, vec3(0.05, 0.08, 0.12), glass * 0.8);
        c = vec4(bc * mix(0.35, 1.0, uDay), a); }
      else if (vK == 14) { // rotor disc
        float ring = smoothstep(1.0, 0.95, d) * smoothstep(0.05, 0.12, d); float ang = atan(vQ.y, vQ.x); float blades = 0.5 + 0.5 * cos(ang * 2.0 - vT * 50.0);
        c = vec4(vec3(0.6, 0.62, 0.66) * mix(0.3, 1.0, uDay), ring * (0.12 + blades * 0.1)); }
      else if (vK == 15) { // ground shadow
        float a = smoothstep(1.0, 0.3, d) * 0.45 * vA * mix(0.4, 1.0, uDay); c = vec4(0.0, 0.0, 0.0, a); }
      else if (vK == 16) { // searchlight pool
        float g = smoothstep(1.0, 0.0, d); c = vec4(vec3(1.0, 0.97, 0.88) * g * g * vA * 0.9, 0.0); }
      else if (vK == 17) { // small light dot (nav/beacon)
        float g = exp(-d * d * 8.0); c = vec4(vec3(1.0, 0.15, 0.1) * g * vA * 2.0, 0.0); }
      else if (vK == 18) { // beam segment
        float g = exp(-d * d * 3.0); c = vec4(vec3(1.0, 0.97, 0.9) * g * vA * 0.10, 0.0); }
      else if (vK == 19) { // water jet droplet
        float g = exp(-d * d * 5.0); c = vec4(vec3(0.75, 0.88, 1.0) * g * vA * 0.9, 0.0); }
      else if (vK == 12) { // signal head
        float g = smoothstep(1.0, 0.4, d); c = vec4(vec3(vSeed), 0.0); }
      o = c; }`);
  P.house = prog(`layout(location=0) in vec2 aQ; layout(location=1) in vec4 aI; ${CAM_U} out vec2 vQ; out vec3 vC; out float vA; out vec2 vW;
    void main(){ float size = max(3.2, 1.6 * uWpp); vec2 p = aI.xy + aQ * size; gl_Position = uVP * vec4(p.x, -p.y, 0.0, 1.0); vQ = aQ; vW = aI.xy;
      float on = step(aI.w, 0.25 + uNight * 0.6); vC = mix(vec3(1.0, 0.62, 0.3), vec3(1.0, 0.85, 0.6), aI.z) * (0.5 + aI.z * 0.5);
      if (aI.z > 0.93) vC = vec3(0.45, 0.6, 1.0) * 0.8; float tw = 0.85 + 0.15 * sin(uTime * (0.3 + aI.w) + aI.z * 40.0);
      vA = on * uNight * tw * clamp(2.2 / uWpp, 0.12, 1.0); }`,
    `in vec2 vQ; in vec3 vC; in float vA; in vec2 vW; ${OUTAGE_U} out vec4 o; void main(){ float d = dot(vQ, vQ); float g = exp(-d * 5.0); o = vec4(vC * g * vA * 0.55 * outage(vW), 0.0); }`);
  P.sig = prog(`layout(location=0) in vec2 aQ; layout(location=1) in vec4 aI; ${CAM_U} uniform sampler2D uSig; uniform float uSigA; out vec2 vQ; out vec3 vC; out float vOn;
    void main(){ int ctl = int(aI.z + 0.5); int grp = int(aI.w + 0.5); float sv = texelFetch(uSig, ivec2(ctl % 2048, ctl / 2048), 0).r * 255.0; int s = int(sv + 0.5);
      int st = s == 255 ? 3 : (grp == 0 ? (s & 3) : ((s >> 2) & 3)); bool pol = s != 255 && (s & 16) != 0;
      vC = st == 0 ? vec3(0.1, 1.0, 0.45) : st == 1 ? vec3(1.0, 0.75, 0.05) : st == 2 ? vec3(1.0, 0.08, 0.05) : vec3(0.0);
      if (st == 3) vC = vec3(0.6, 0.0, 0.0) * step(0.5, fract(uTime * 0.8));
      vOn = uSigA; float size = max(1.6, 2.4 * uWpp); vec2 p = aI.xy + aQ * size; gl_Position = uVP * vec4(p.x, -p.y, 0.3, 1.0); vQ = aQ; }`,
    `in vec2 vQ; in vec3 vC; in float vOn; out vec4 o; void main(){ float d = length(vQ); float g = exp(-d * d * 3.0); o = vec4(vC * g * 2.2 * vOn, 0.0); }`);
  // post
  const QV = `layout(location=0) in vec2 aQ; out vec2 vU; void main(){ vU = aQ * 0.5 + 0.5; gl_Position = vec4(aQ, 0.0, 1.0); }`;
  P.bright = prog(QV, `in vec2 vU; uniform sampler2D uT; uniform float uThr; out vec4 o; void main(){ vec3 c = texture(uT, vU).rgb; float l = max(c.r, max(c.g, c.b)); o = vec4(c * smoothstep(uThr, uThr + 0.6, l), 1.0); }`);
  P.blur = prog(QV, `in vec2 vU; uniform sampler2D uT; uniform vec2 uD; out vec4 o; void main(){ vec3 c = texture(uT, vU).rgb * 0.227; c += (texture(uT, vU + uD * 1.385).rgb + texture(uT, vU - uD * 1.385).rgb) * 0.316; c += (texture(uT, vU + uD * 3.23).rgb + texture(uT, vU - uD * 3.23).rgb) * 0.07; o = vec4(c, 1.0); }`);
  P.comp = prog(QV, `in vec2 vU; uniform sampler2D uT; uniform sampler2D uB1; uniform sampler2D uB2; uniform sampler2D uB3; uniform float uTime; uniform float uRain; uniform float uFlash; uniform float uNight; uniform float uDay; uniform vec2 uRes; uniform float uDusk; uniform float uSnow; uniform float uFog; uniform float uLift; uniform sampler2D uDof; uniform float uTilt; uniform float uHaze; out vec4 o;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main(){ vec3 c = texture(uT, vU).rgb; if (uTilt > 0.0) { float k = smoothstep(0.17, 0.5, abs(vU.y - 0.5)) * uTilt; c = mix(c, texture(uDof, vU).rgb, k); } vec3 b = texture(uB1, vU).rgb * 0.6 + texture(uB2, vU).rgb * 0.8 + texture(uB3, vU).rgb * 1.1; c += b * (0.28 + uNight * 0.32);
      // grade: dawn warmth, night blue shadows
      vec3 tint = mix(vec3(0.92, 0.97, 1.12), vec3(1.0), uDay); tint = mix(tint, vec3(1.12, 0.95, 0.86), uDusk); c *= tint;
      if (uHaze > 0.0) { vec3 hc = mix(vec3(0.045, 0.06, 0.10), vec3(0.60, 0.68, 0.76), uDay); hc = mix(hc, vec3(0.80, 0.52, 0.36), uDusk * 0.6); c = mix(c, hc, uHaze * pow(smoothstep(0.5, 1.0, vU.y), 1.8) * 0.34); } // distance haze toward the top of a tilted view
      { float l = dot(c, vec3(0.299, 0.587, 0.114)); c = mix(vec3(l), c, 1.16); vec3 cc = clamp(c, 0.0, 1.0); c = mix(c, cc * cc * (3.0 - 2.0 * cc) + (c - cc), 0.30 * uDay); }
      // TV exposure: lift the shadows so a night or a dark ground never reads as a black screen
      if (uLift > 0.0) { c = pow(max(c, vec3(0.0)), vec3(1.0 - 0.3 * uLift)) * (1.0 + 0.35 * uLift) + vec3(0.012, 0.016, 0.024) * uLift; }
      // rain streaks
      if (uRain > 0.0) { vec2 p = vU * uRes / vec2(3.0, 34.0); p.y += uTime * 26.0; p.x += p.y * 0.12; vec2 id = floor(p); float r = hash(id); float s = step(0.965, r) * smoothstep(0.0, 0.4, fract(p.y)) * smoothstep(1.0, 0.6, fract(p.y)) * smoothstep(0.5, 0.0, abs(fract(p.x) - 0.5)); c += vec3(0.5, 0.6, 0.7) * s * 0.18 * uRain; c = mix(c, c * vec3(0.85, 0.9, 1.0), uRain * 0.3); }
      if (uSnow > 0.0) { for (int L = 0; L < 2; L++) { float sc = L == 0 ? 9.0 : 15.0; vec2 p = vU * uRes / sc; p.y += uTime * (L == 0 ? 2.2 : 1.3); p.x += sin(uTime * 0.7 + p.y * 0.35) * 0.6; vec2 id = floor(p); float r = hash(id + float(L) * 7.0); vec2 f = fract(p) - vec2(0.25 + 0.5 * hash(id + 3.1), 0.25 + 0.5 * r); float flake = step(0.82, r) * smoothstep(0.16, 0.0, length(f)); c += vec3(0.9, 0.93, 1.0) * flake * 0.55 * uSnow; } c = mix(c, c * 0.85 + vec3(0.05, 0.055, 0.065), uSnow * 0.5); }
      if (uFog > 0.0) { float h = 0.55 + 0.45 * smoothstep(0.0, 1.0, vU.y); c = mix(c, vec3(0.42, 0.45, 0.5) * (0.22 + uDay * 0.75), uFog * 0.42 * h); }
      c += vec3(0.75, 0.8, 1.0) * uFlash;
      vec2 q = vU - 0.5; c *= 1.0 - dot(q, q) * 0.55;
      c = c / (1.0 + c * 0.18); c = pow(c, vec3(0.95));
      c += (hash(vU * uRes + uTime) - 0.5) * 0.012;
      o = vec4(c, 1.0); }`);
}

// ---------------------------------------------------------------- scene data
let G = null, roadVao, roadCount = 0, roadVaoRes, roadCountRes = 0, ovVao, ovCount = 0, discVao, discCount = 0, lakeVao, lakeCount = 0, sigVao, sigCount = 0;
let liteMode = false, bldN = 0, houseN = 0, hBld = null, bBld = null, hLit = null, trees = null, landTex = null, landExt = [0, 0, 1, 1], landG = null, landA = null, landF = null, landN = 320, dTex = [], dFbo = [], dTex2 = [], dFbo2 = [], quadBuf, carBuf, carVao, lightVao, spriteBuf, spriteBuf2, spriteVao, postVao;
let depthRb = null, spdTex, sigTex, sceneTex, sceneFbo, bTex = [], bFbo = [], bTex2 = [], bFbo2 = [], halfFloat = false;
const carCap = 26000; let car3Vao = null, landBraw = null, landPx = null;
function init(canvas, graph, q) {
  quality = q || 'high';
  gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
  if (!gl) throw new Error('WebGL2 not supported');
  halfFloat = !!gl.getExtension('EXT_color_buffer_float') || !!gl.getExtension('EXT_color_buffer_half_float');
  G = graph; buildPrograms();
  quadBuf = buf(new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]));
  postVao = vao([{ buf: quadBuf, stride: 2, attrs: [[0, 2]] }]);
  buildRoads(); buildLake(); buildSignals(); buildLand(); REAL = realData(); if (REAL) { buildReal(); bakeLots(); emptyFill(); } else { buildHouses(); bakeLots(); buildFill(); } buildTrees();
  carBuf = buf(new Float32Array(carCap * 4), gl.DYNAMIC_DRAW);
  carVao = vao([{ buf: quadBuf, stride: 2, attrs: [[0, 2]] }, { buf: carBuf, stride: 4, attrs: [[1, 4]], div: 1 }]);
  car3Vao = vao([{ buf: cubeBuf, stride: 6, attrs: [[0, 3], [1, 3]] }, { buf: carBuf, stride: 4, attrs: [[2, 4]], div: 1 }]);
  spriteBuf = buf(new Float32Array(8 * 4000), gl.DYNAMIC_DRAW);
  spriteVao = vao([{ buf: quadBuf, stride: 2, attrs: [[0, 2]] }, { buf: spriteBuf, stride: 8, attrs: [[1, 4], [2, 4]], div: 1 }]);
  spdTex = tex(2048, Math.ceil(G.ea.length / 2048), 'rg8', gl.NEAREST); sigTex = tex(2048, Math.max(1, Math.ceil(G.ctrls.length / 2048)), 'r8', gl.NEAREST);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  const init255 = new Uint8Array(G.ea.length).fill(255); setSpeeds(init255);
}
function resize(cssW, cssH, dpr) {
  W = cssW; H = cssH; DPR = dpr; const c = gl.canvas; c.width = Math.round(W * DPR); c.height = Math.round(H * DPR);
  const fw = c.width, fh = c.height;
  if (sceneTex) { gl.deleteTexture(sceneTex); gl.deleteFramebuffer(sceneFbo); bTex.concat(bTex2, dTex, dTex2).forEach(t => gl.deleteTexture(t)); bFbo.concat(bFbo2, dFbo, dFbo2).forEach(f => gl.deleteFramebuffer(f)); }
  const fmt = halfFloat ? 'f16' : 'rgba8';
  sceneTex = tex(fw, fh, fmt); sceneFbo = fbo(sceneTex); if (depthRb) gl.deleteRenderbuffer(depthRb); depthRb = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, depthRb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH24_STENCIL8, fw, fh); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, depthRb);
  bTex = []; bFbo = []; bTex2 = []; bFbo2 = [];
  for (let i = 0; i < 3; i++) { const s = 2 << i; const w = Math.max(1, Math.round(fw / s)), h = Math.max(1, Math.round(fh / s)); const t = tex(w, h, fmt), t2 = tex(w, h, fmt); bTex.push(t); bTex2.push(t2); bFbo.push(fbo(t)); bFbo2.push(fbo(t2)); bTex[i].w = w; bTex[i].h = h; }
  dTex = []; dFbo = []; dTex2 = []; dFbo2 = []; // soft copies of the whole frame for the tilt-shift focus effect
  for (let i = 0; i < 2; i++) { const s = 2 << i; const w = Math.max(1, Math.round(fw / s)), h = Math.max(1, Math.round(fh / s)); const t = tex(w, h, fmt), t2 = tex(w, h, fmt); t.w = w; t.h = h; dTex.push(t); dTex2.push(t2); dFbo.push(fbo(t)); dFbo2.push(fbo(t2)); }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); updateCam();
}
function polyPts(e) { const go = G.go[e], gc = G.gc[e], out = []; for (let i = 0; i < gc; i++) out.push([G.geo[(go + i) * 2], G.geo[(go + i) * 2 + 1]]); return out; }
function stripVerts(pts, push) { // miter normals
  const n = pts.length; const nrm = [];
  for (let i = 0; i < n - 1; i++) { const dx = pts[i + 1][0] - pts[i][0], dy = pts[i + 1][1] - pts[i][1]; const l = Math.hypot(dx, dy) || 1; nrm.push([-dy / l, dx / l]); }
  for (let i = 0; i < n; i++) { let nx, ny; if (i === 0) [nx, ny] = nrm[0]; else if (i === n - 1) [nx, ny] = nrm[n - 2]; else { const a = nrm[i - 1], b = nrm[i]; nx = a[0] + b[0]; ny = a[1] + b[1]; const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l; const cosT = nx * a[0] + ny * a[1]; const m = Math.min(2.2, 1 / Math.max(0.3, cosT)); nx *= m; ny *= m; } push(pts[i][0], pts[i][1], nx, ny, i); }
}
function capped(p, ext) { const n = p.length; if (n < 2) return p; const q = p.map(a => a.slice()); let dx = q[1][0] - q[0][0], dy = q[1][1] - q[0][1], l = Math.hypot(dx, dy) || 1; q[0][0] -= dx / l * ext; q[0][1] -= dy / l * ext; dx = q[n - 1][0] - q[n - 2][0]; dy = q[n - 1][1] - q[n - 2][1]; l = Math.hypot(dx, dy) || 1; q[n - 1][0] += dx / l * ext; q[n - 1][1] += dy / l * ext; return q; }
function buildRoads() {
  const E = G.ea.length; const rev = new Int32Array(E).fill(-1); const byGo = new Map();
  for (let e = 0; e < E; e++) { const k = G.go[e]; if (byGo.has(k)) { rev[e] = byGo.get(k); rev[byGo.get(k)] = e; } else byGo.set(k, e); }
  R.rev = rev;
  const minPx = [2.6, 1.3, 2.1, 1.7, 1.2, 0.55];
  const order = []; for (let e = 0; e < E; e++) if (rev[e] < 0 || e < rev[e]) order.push(e);
  order.sort((a, b) => G.cls[b] - G.cls[a]);
  const build = (filter) => { const v = [], idx = []; let base = 0;
    for (const e of order) { if (!filter(G.cls[e])) continue; const pts = capped(polyPts(e), G.lanes[e] * 1.7); const lanes = G.lanes[e] + (rev[e] >= 0 ? G.lanes[rev[e]] : 0); const hw = lanes * 1.7 + (G.cls[e] <= 2 ? 1.4 : 0.8); const cls = G.cls[e];
      const packed = cls * 2 + 1;
      const n0 = v.length / 11; const lf = G.lanes[e], lb = rev[e] >= 0 ? G.lanes[rev[e]] : 0; let dist = -G.lanes[e] * 1.7, px0 = pts[0][0], py0 = pts[0][1];
      stripVerts(pts, (x, y, nx, ny) => { dist += Math.hypot(x - px0, y - py0); px0 = x; py0 = y; v.push(x, y, nx, ny, -1, hw, minPx[cls], packed, dist, lf, lb, x, y, nx, ny, 1, hw, minPx[cls], packed, dist, lf, lb); });
      const n = pts.length; for (let i = 0; i < n - 1; i++) { const a = n0 + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } }
    const vb = buf(new Float32Array(v)); const va = vao([{ buf: vb, stride: 11, attrs: [[0, 2], [1, 2], [2, 4], [3, 3]] }]); gl.bindVertexArray(va); const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(idx), gl.STATIC_DRAW); gl.bindVertexArray(null); return [va, idx.length]; };
  [roadVaoRes, roadCountRes] = build(c => c >= 5); [roadVao, roadCount] = build(c => c < 5);
  // traffic overlay per directed edge
  const v = [], idx = [];
  for (let e = 0; e < E; e++) { const cls = G.cls[e]; let pts = polyPts(e); if (G.rev[e]) pts = pts.slice().reverse(); const nl = G.lanes[e];
    const twoWay = rev[e] >= 0; const off = twoWay ? nl * 1.7 : 0; const hw = Math.max(1.2, nl * 1.25 * (twoWay ? 1 : 0.8));
    const n0 = v.length / 8;
    const ec = e + cls * 100000; stripVerts(pts, (x, y, nx, ny) => { v.push(x, y, nx, ny, -1, hw, twoWay ? off : 0, ec, x, y, nx, ny, 1, hw, twoWay ? off : 0, ec); });
    const n = pts.length; for (let i = 0; i < n - 1; i++) { const a = n0 + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } }
  // NB: right-hand normal in map coords (y down) is (-dy, dx); stripVerts gives (-dy, dx) already, the overlay wants the driver's right => same. Flip sign above compensates GL y flip.
  const vb = buf(new Float32Array(v)); ovVao = vao([{ buf: vb, stride: 8, attrs: [[0, 2], [1, 2], [2, 4]] }]); gl.bindVertexArray(ovVao); const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(idx), gl.STATIC_DRAW); gl.bindVertexArray(null); ovCount = idx.length;
}
function buildLake() {
  const s = G.shore; const v = [];
  const col = (dark) => dark ? [0.012, 0.03, 0.055, 1] : [0.03, 0.07, 0.11, 1];
  for (let i = 0; i < s.length - 1; i++) { const a = s[i], b = s[i + 1]; const far = 60000; const ca = col(false), cf = col(true);
    v.push(a[0], a[1], ...ca, b[0], b[1], ...ca, a[0], far, ...cf, b[0], b[1], ...ca, b[0], far, ...cf, a[0], far, ...cf); }
  // far west/east extensions
  const a = s[0], z = s[s.length - 1]; const cf = col(true);
  v.push(a[0] - 60000, a[1] + 20000, ...cf, a[0], a[1], ...col(false), a[0], 60000, ...cf, a[0] - 60000, a[1] + 20000, ...cf, a[0], 60000, ...cf, a[0] - 60000, 60000, ...cf);
  v.push(z[0], z[1], ...col(false), z[0] + 60000, z[1] - 25000, ...cf, z[0] + 60000, 60000, ...cf, z[0], z[1], ...col(false), z[0] + 60000, 60000, ...cf, z[0], 60000, ...cf);
  // tag lake verts with shimmer amount in alpha via colour alpha (1)
  const vb = buf(new Float32Array(v)); lakeVao = vao([{ buf: vb, stride: 6, attrs: [[0, 2], [1, 4]] }]); lakeCount = v.length / 6;
  // land tiles (whole area) drawn first
  const L = [-80000, -80000, 80000, 80000]; const lc = [0.035, 0.045, 0.055, 0];
  const lv = [L[0], L[1], ...lc, L[2], L[1], ...lc, L[0], L[3], ...lc, L[2], L[1], ...lc, L[2], L[3], ...lc, L[0], L[3], ...lc];
  R.landVao = vao([{ buf: buf(new Float32Array(lv)), stride: 6, attrs: [[0, 2], [1, 4]] }]);
}
function buildSignals() {
  const v = []; const E = G.ea.length;
  for (let e = 0; e < E; e++) { const c = G.ctrl[e]; if (c < 0) continue; let pts = polyPts(e); if (G.rev[e]) pts = pts.slice().reverse(); const n = pts.length; const [x1, y1] = pts[n - 1], [x0, y0] = pts[n - 2];
    const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1; const twoWay = R.rev[e] >= 0; const lat = twoWay ? G.lanes[e] * 1.7 + 0.5 : G.lanes[e] * 1.7 + 1.0; const back = Math.min(10, l * 0.4);
    v.push(x1 - dx / l * back - dy / l * lat, y1 - dy / l * back + dx / l * lat, c, G.grp[e]); }
  sigVao = vao([{ buf: quadBuf, stride: 2, attrs: [[0, 2]] }, { buf: buf(new Float32Array(v)), stride: 4, attrs: [[1, 4]], div: 1 }]); sigCount = v.length / 4;
}
let cubeBuf = null;
function cubeGeo() { const f = []; const q = (a, b, c, d, n) => { for (const p of [a, b, c, a, c, d]) f.push(...p, ...n); };
  q([-.5, -.5, 1], [.5, -.5, 1], [.5, .5, 1], [-.5, .5, 1], [0, 0, 1]);
  q([-.5, -.5, 0], [.5, -.5, 0], [.5, -.5, 1], [-.5, -.5, 1], [0, -1, 0]); q([.5, .5, 0], [-.5, .5, 0], [-.5, .5, 1], [.5, .5, 1], [0, 1, 0]);
  q([.5, -.5, 0], [.5, .5, 0], [.5, .5, 1], [.5, -.5, 1], [1, 0, 0]); q([-.5, .5, 0], [-.5, -.5, 0], [-.5, -.5, 1], [-.5, .5, 1], [-1, 0, 0]); return new Float32Array(f); }
let roadGrid = null;
function nearRoad(x, y, r, skip) {
  if (!roadGrid) { roadGrid = new Map(); for (let e = 0; e < G.ea.length; e++) { if (R.rev[e] >= 0 && R.rev[e] < e) continue; const p = polyPts(e); for (let i = 0; i < p.length - 1; i++) { const x0 = Math.min(p[i][0], p[i + 1][0]), x1 = Math.max(p[i][0], p[i + 1][0]), y0 = Math.min(p[i][1], p[i + 1][1]), y1 = Math.max(p[i][1], p[i + 1][1]); for (let ax = Math.floor(x0 / 120); ax <= Math.floor(x1 / 120); ax++) for (let ay = Math.floor(y0 / 120); ay <= Math.floor(y1 / 120); ay++) { const k = ax * 100003 + ay; let a = roadGrid.get(k); if (!a) roadGrid.set(k, a = []); a.push(e, i); } } } }
  const cx = Math.floor(x / 120), cy = Math.floor(y / 120);
  for (let ax = cx - 1; ax <= cx + 1; ax++) for (let ay = cy - 1; ay <= cy + 1; ay++) { const a = roadGrid.get(ax * 100003 + ay); if (!a) continue;
    for (let k = 0; k < a.length; k += 2) { const e = a[k]; if (e === skip) continue; const i = a[k + 1]; const go = G.go[e]; const ax0 = G.geo[(go + i) * 2], ay0 = G.geo[(go + i) * 2 + 1], bx = G.geo[(go + i + 1) * 2], by = G.geo[(go + i + 1) * 2 + 1];
      const vx = bx - ax0, vy = by - ay0, l2 = vx * vx + vy * vy || 1; let t = ((x - ax0) * vx + (y - ay0) * vy) / l2; t = Math.max(0, Math.min(1, t)); const hw = (G.lanes[e] + (R.rev[e] >= 0 ? G.lanes[R.rev[e]] : 0)) * 1.7; if (Math.hypot(x - ax0 - t * vx, y - ay0 - t * vy) < r + hw) return true; } }
  return false; }
// ---------------------------------------------------------------- land use, houses, trees
function shoreY(x) { const s = G.shore; if (x <= s[0][0]) return s[0][1]; for (let i = 0; i < s.length - 1; i++) if (x <= s[i + 1][0]) { const t = (x - s[i][0]) / ((s[i + 1][0] - s[i][0]) || 1); return s[i][1] + (s[i + 1][1] - s[i][1]) * t; } return s[s.length - 1][1]; }
function buildLand() { // a small map of what the ground is: how built-up, how green, how paved. Baked once from the road network.
  const N = landN; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (let i = 0; i < G.nx.length; i++) { x0 = Math.min(x0, G.nx[i]); x1 = Math.max(x1, G.nx[i]); y0 = Math.min(y0, G.ny[i]); y1 = Math.max(y1, G.ny[i]); }
  x0 -= 700; y0 -= 700; x1 += 700; y1 += 700; landExt = [x0, y0, 1 / (x1 - x0), 1 / (y1 - y0)];
  const any = new Float32Array(N * N), art = new Float32Array(N * N), cell = (x, y) => { const cx = Math.floor((x - x0) * landExt[2] * N), cy = Math.floor((y - y0) * landExt[3] * N); return cx < 0 || cy < 0 || cx >= N || cy >= N ? -1 : cy * N + cx; };
  for (let e = 0; e < G.ea.length; e++) { if (R.rev[e] >= 0 && R.rev[e] < e) continue; const p = polyPts(e), cls = G.cls[e];
    for (let i = 0; i < p.length - 1; i++) { const l = Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]), n = Math.max(1, Math.round(l / 20)); for (let k = 0; k < n; k++) { const t = (k + 0.5) / n, c = cell(p[i][0] + (p[i + 1][0] - p[i][0]) * t, p[i][1] + (p[i + 1][1] - p[i][1]) * t); if (c < 0) continue; any[c] += l / n; if (cls <= 3) art[c] += (l / n) * (cls <= 1 ? 0.5 : 1); } } }
  for (const p of G.places) if (['mall', 'jobs', 'transit', 'hospital'].includes(p.t)) { const c = cell(p.x, p.y); if (c >= 0) art[c] += 260; }
  const blur = (src, r, passes) => { let a = src, b = new Float32Array(N * N); for (let ps = 0; ps < passes * 2; ps++) { const hz = ps % 2 === 0; for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { let sum = 0, n = 0; for (let d = -r; d <= r; d++) { const xx = hz ? x + d : x, yy = hz ? y : y + d; if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue; sum += a[yy * N + xx]; n++; } b[y * N + x] = sum / n; } const t = a === src ? new Float32Array(N * N) : a; a = b; b = t; } return a; };
  const A = blur(any, 2, 1), B = blur(art, 2, 2), M = blur(any.map(v => v > 0 ? 1 : 0), 6, 2), sm = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  const px = new Uint8Array(N * N * 4); landG = new Float32Array(N * N); landA = new Float32Array(N * N); landBraw = B; landPx = px;
  const hsh = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }, vnj = (x, y) => { const ix = Math.floor(x), iy = Math.floor(y); let fx = x - ix, fy = y - iy; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); return (hsh(ix, iy) * (1 - fx) + hsh(ix + 1, iy) * fx) * (1 - fy) + (hsh(ix, iy + 1) * (1 - fx) + hsh(ix + 1, iy + 1) * fx) * fy; };
  landF = new Float32Array(N * N); // woods: ravines and woodlots are a big part of Scarborough, so the green space is clumped into forest and open meadow
  for (let i = 0; i < N * N; i++) { const a = sm(0.03, 0.3, M[i]), g = (1 - sm(5, 24, A[i])) * a, b = sm(22, 95, B[i]); landG[i] = g; landA[i] = a;
    const wx = x0 + ((i % N) + 0.5) / N / landExt[2], wy = y0 + (Math.floor(i / N) + 0.5) / N / landExt[3], f = sm(0.46, 0.62, 0.6 * vnj(wx / 950, wy / 950) + 0.4 * vnj(wx / 340 + 9.1, wy / 340 + 4.3)) * sm(0.45, 0.75, g); landF[i] = f; px[i * 4] = Math.round(f * 255); px[i * 4 + 1] = Math.round(g * 255); px[i * 4 + 2] = Math.round(b * 255); px[i * 4 + 3] = Math.round(a * 255); }
  landTex = tex(N, N, 'rgba8'); gl.bindTexture(gl.TEXTURE_2D, landTex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, N, N, gl.RGBA, gl.UNSIGNED_BYTE, px);
}
function bakeLots() { // shops and offices sit on paved lots: add each one to the land map's paved channel
  const N = landN, add = new Float32Array(N * N), sm = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let i = 0; i < bldSrc.length; i += 2) { const b = bldSrc[i]; if (!b[7]) continue; const cx = Math.floor((b[0] - landExt[0]) * landExt[2] * N), cy = Math.floor((b[1] - landExt[1]) * landExt[3] * N); if (cx < 1 || cy < 1 || cx >= N - 1 || cy >= N - 1) continue;
    add[cy * N + cx] += 44; add[cy * N + cx - 1] += 13; add[cy * N + cx + 1] += 13; add[(cy - 1) * N + cx] += 13; add[(cy + 1) * N + cx] += 13; }
  for (let i = 0; i < N * N; i++) landPx[i * 4 + 2] = Math.round(sm(22, 95, landBraw[i] + Math.min(70, add[i])) * 255);
  gl.bindTexture(gl.TEXTURE_2D, landTex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, N, N, gl.RGBA, gl.UNSIGNED_BYTE, landPx);
}
let fillTex = null, fillM = null; const fillN = 640, GU = [0.956, -0.292], GV = [0.292, 0.956];
function fillAt(x, y) { const cx = Math.floor((x - landExt[0]) * landExt[2] * fillN), cy = Math.floor((y - landExt[1]) * landExt[3] * fillN); return cx < 0 || cy < 0 || cx >= fillN || cy >= fillN ? 0 : fillM[cy * fillN + cx]; }
function buildFill() { // built-up land with no modelled street nearby, away from parks, woods and paved lots
  const N = fillN, x0 = landExt[0], y0 = landExt[1], w = 1 / landExt[2], h = 1 / landExt[3], m = new Uint8Array(N * N);
  for (let cy = 0; cy < N; cy++) for (let cx = 0; cx < N; cx++) { const x = x0 + (cx + 0.5) / N * w, y = y0 + (cy + 0.5) / N * h, lx = Math.floor((x - x0) * landExt[2] * landN), ly = Math.floor((y - y0) * landExt[3] * landN), li = ly * landN + lx;
    if (landA[li] < 0.6 || landG[li] > 0.58 || landF[li] > 0.3 || landPx[li * 4 + 2] > 92 || y > shoreY(x) - 60) continue; if (nearRoad(x, y, 27)) continue; m[cy * N + cx] = 255; }
  fillM = new Uint8Array(N * N); for (let cy = 1; cy < N - 1; cy++) for (let cx = 1; cx < N - 1; cx++) { if (!m[cy * N + cx]) continue; let n = 0; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (m[(cy + a) * N + cx + b]) n++; if (n >= 7) fillM[cy * N + cx] = 255; }
  fillTex = tex(N, N, 'r8'); gl.bindTexture(gl.TEXTURE_2D, fillTex); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, N, N, gl.RED, gl.UNSIGNED_BYTE, fillM);
  // houses along the made-up streets (rows 78 m apart on the city grid, cross streets every 260 m), matching the ground shader
  let seed = 4242; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }, ang = Math.atan2(GU[1], GU[0]), cs = [[x0, y0], [x0 + w, y0], [x0, y0 + h], [x0 + w, y0 + h]].map(p => [p[0] * GU[0] + p[1] * GU[1], p[0] * GV[0] + p[1] * GV[1]]);
  const gx0 = Math.min(...cs.map(c => c[0])), gx1 = Math.max(...cs.map(c => c[0])), gy0 = Math.min(...cs.map(c => c[1])), gy1 = Math.max(...cs.map(c => c[1])); fillTrees = [];
  for (let k = Math.ceil(gy0 / 78); k * 78 < gy1; k++) for (let j = Math.ceil(gx0 / 16.5); j * 16.5 < gx1; j++) { const gx = j * 16.5 + 10.5, sxd = Math.abs(((gx + 130) % 260 + 260) % 260 - 130); if (sxd < 15) continue;
    for (const s of [-1, 1]) { const r1 = rnd(), r2 = rnd(), r3 = rnd(), wd = 8.5 + r2 * 3.2, dp = 9 + r3 * 3.5, gy = k * 78 + s * (15.5 + r3 * 2 + dp / 2), x = gx * GU[0] + gy * GV[0], y = gx * GU[1] + gy * GV[1];
      if (fillAt(x, y) < 128) continue; if (r1 < 0.06) continue; if (nearRoad(x, y, dp / 2 + 6)) continue;
      const turn = r1 > 0.7; bldSrc.push([x, y, turn ? ang + Math.PI / 2 : ang, r2, turn ? dp : wd, turn ? wd : dp, 4.4 + r3 * 2.6, 0], [x, y, r2, r3]);
      if (r2 < 0.55) { const ty = k * 78 + s * 5.2, tx = gx - 6; fillTrees.push([tx * GU[0] + ty * GV[0], tx * GU[1] + ty * GV[1], 0]); }
      if (r3 < 0.4) { const ty = k * 78 + s * (30 + r1 * 6), tx = gx + (r2 - 0.5) * 8; fillTrees.push([tx * GU[0] + ty * GV[0], tx * GU[1] + ty * GV[1], 1]); } } }
  uploadBuildings([]);
}
let fillTrees = [];
function landAt(x, y) { const cx = Math.floor((x - landExt[0]) * landExt[2] * landN), cy = Math.floor((y - landExt[1]) * landExt[3] * landN); if (cx < 0 || cy < 0 || cx >= landN || cy >= landN) return [0, 0]; return [landG[cy * landN + cx], landA[cy * landN + cx]]; }
// Instances sorted into 480 m cells so only what is on screen gets drawn (there are a few hundred thousand houses and trees).
const CH = 480;
function chunked(inst, stride, mesh, meshStride, meshAttrs, nVert, instAttrs) {
  const n = inst.length / stride, keys = new Int32Array(n), order = new Uint32Array(n); for (let i = 0; i < n; i++) { keys[i] = (Math.floor(inst[i * stride] / CH) + 512) * 1024 + Math.floor(inst[i * stride + 1] / CH) + 512; order[i] = i; }
  order.sort((a, b) => keys[a] - keys[b]); const out = new Float32Array(inst.length), cells = []; let last = -1;
  for (let k = 0; k < n; k++) { const i = order[k]; for (let j = 0; j < stride; j++) out[k * stride + j] = inst[i * stride + j]; if (keys[i] !== last) { last = keys[i]; cells.push([(last >> 10) - 512, (last & 1023) - 512, k, 0]); } cells[cells.length - 1][3]++; }
  const b = buf(out); return { buf: b, cells, n, nVert, stride, instAttrs, vao: vao([{ buf: mesh, stride: meshStride, attrs: meshAttrs }, { buf: b, stride, attrs: instAttrs.map(a => [a[0], a[1]]), div: 1 }]) };
}
let VIS = [0, 0, 0, 0];
function visCells() { const pts = [[0, 0], [W, 0], [0, H], [W, H], [W / 2, 0], [W / 2, H]].map(p => unproject(p[0], p[1])), Rm = Math.max(900, cam.h * 7); let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const p of pts) { if (!p) { x0 = cam.x - Rm; x1 = cam.x + Rm; y0 = cam.y - Rm; y1 = cam.y + Rm; break; } x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  x0 = Math.max(x0, cam.x - Rm) - 150; x1 = Math.min(x1, cam.x + Rm) + 150; y0 = Math.max(y0, cam.y - Rm) - 150; y1 = Math.min(y1, cam.y + Rm) + 150;
  VIS = [Math.floor(x0 / CH), Math.floor(y0 / CH), Math.floor(x1 / CH), Math.floor(y1 / CH)]; }
function drawChunked(c, mode) { if (!c || !c.n) return; gl.bindVertexArray(c.vao); gl.bindBuffer(gl.ARRAY_BUFFER, c.buf); const S = c.stride * 4;
  for (const [cx, cy, start, count] of c.cells) { if (cx < VIS[0] || cx > VIS[2] || cy < VIS[1] || cy > VIS[3]) continue; let off = 0; for (const [loc, size] of c.instAttrs) { gl.vertexAttribPointer(loc, size, gl.FLOAT, false, S, start * S + off * 4); off += size; } gl.drawArraysInstanced(mode, 0, c.nVert, count); } }
function gableGeo() { // a house: four walls, two gable ends and a pitched roof with the ridge along local x
  const f = [], q = (a, b, c, d, n) => { for (const p of [a, b, c, a, c, d]) f.push(...p, ...n); }, t = (a, b, c, n) => { for (const p of [a, b, c]) f.push(...p, ...n); }, R = 1.5;
  q([-.5, -.5, 0], [.5, -.5, 0], [.5, -.5, 1], [-.5, -.5, 1], [0, -1, 0]); q([.5, .5, 0], [-.5, .5, 0], [-.5, .5, 1], [.5, .5, 1], [0, 1, 0]);
  q([.5, -.5, 0], [.5, .5, 0], [.5, .5, 1], [.5, -.5, 1], [1, 0, 0]); q([-.5, .5, 0], [-.5, -.5, 0], [-.5, -.5, 1], [-.5, .5, 1], [-1, 0, 0]);
  t([.5, -.5, 1], [.5, .5, 1], [.5, 0, R], [1, 0, 0]); t([-.5, .5, 1], [-.5, -.5, 1], [-.5, 0, R], [-1, 0, 0]);
  q([-.56, -.56, 0.94], [.56, -.56, 0.94], [.56, 0, R], [-.56, 0, R], [0, -0.6, 0.8]); q([.56, .56, 0.94], [-.56, .56, 0.94], [-.56, 0, R], [.56, 0, R], [0, 0.6, 0.8]); return new Float32Array(f); }
function treeGeo() { // faceted canopy: taper up from the trunk, widest a third of the way up, rounded top
  const f = [], rings = [[0.45, 0.16], [1.0, 0.42], [0.72, 0.78], [0.0, 1.0]], S = 6, P = (r, z, k) => [Math.cos(k / S * 6.2832) * r[0], Math.sin(k / S * 6.2832) * r[0], r[1]];
  for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < S; k++) { const a = P(rings[i], 0, k), b = P(rings[i], 0, k + 1), c = P(rings[i + 1], 0, k + 1), d = P(rings[i + 1], 0, k); const tris = rings[i + 1][0] === 0 ? [[a, b, c]] : [[a, b, c], [a, c, d]];
    for (const [p, q, r] of tris) { let n = norm(cross([q[0] - p[0], q[1] - p[1], q[2] - p[2]], [r[0] - p[0], r[1] - p[1], r[2] - p[2]])); if (n[0] * (p[0] + q[0] + r[0]) + n[1] * (p[1] + q[1] + r[1]) + n[2] * ((p[2] + q[2] + r[2]) / 3 - 0.45) < 0) n = [-n[0], -n[1], -n[2]]; for (const v of [p, q, r]) f.push(...v, ...n); } }
  return new Float32Array(f); }
function buildHouses() {
  bldSrc.length = 0; let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let e = 0; e < G.ea.length; e++) { const cls = G.cls[e]; if (cls < 3 || (R.rev[e] >= 0 && R.rev[e] < e)) continue; const p = polyPts(e); const art = cls === 3, step = art ? 52 : cls === 5 ? 16.5 : 21;
    let acc0 = 0; const tot = G.len[e];
    for (let i = 0; i < p.length - 1; i++) { const dx = p[i + 1][0] - p[i][0], dy = p[i + 1][1] - p[i][1], l = Math.hypot(dx, dy); if (l < 1) continue; const nx = -dy / l, ny = dx / l, ang = Math.atan2(dy, dx), half = (G.lanes[e] + (R.rev[e] >= 0 ? G.lanes[R.rev[e]] : 0)) * 1.7;
      for (let d = rnd() * step; d < l; d += step * (0.85 + rnd() * 0.4)) { if (acc0 + d < (art ? 55 : 22) || acc0 + d > tot - (art ? 55 : 22)) continue; for (const side of [-1, 1]) { const r1 = rnd(), r2 = rnd(), r3 = rnd(); if (r1 < (art ? 0.3 : 0.1)) continue;
        if (art) { const w = 26 + r2 * 34, dp = 16 + r3 * 14, off = half + 20 + r3 * 16 + dp / 2, hx = p[i][0] + dx / l * d + nx * off * side, hy = p[i][1] + dy / l * d + ny * off * side; if (nearRoad(hx, hy, dp / 2 + 3, e) || landAt(hx, hy)[1] < 0.5 || hy > shoreY(hx) - 30) continue; bldSrc.push([hx, hy, ang, r2, w, dp, 4.5 + r1 * 5, 1], null); continue; }
        const w = 8.5 + r2 * 3.5, dp = 9 + r3 * 4, off = half + 8.5 + r3 * 4 + dp / 2, hx = p[i][0] + dx / l * d + nx * off * side, hy = p[i][1] + dy / l * d + ny * off * side; if (nearRoad(hx, hy, dp / 2 + 1.5, e) || hy > shoreY(hx) - 20) continue;
        const turn = r1 > 0.62; bldSrc.push([hx, hy, turn ? ang + Math.PI / 2 : ang, r2, turn ? dp : w, turn ? w : dp, 4.4 + r3 * 2.6, 0], [hx, hy, r2, r3]); } }
      acc0 += l; } }
  for (const p of G.places) { if (!['mall', 'jobs', 'school', 'hospital', 'transit'].includes(p.t)) continue; const n = p.t === 'mall' ? 5 : 4; for (let j = 0; j < n; j++) { const ang = rnd() * 6.28, r = 60 + rnd() * 140; const x = p.x + Math.cos(ang) * r, y = p.y + Math.sin(ang) * r; if (nearRoad(x, y, 45)) continue; bldSrc.push([x, y, rnd() * 0.3, rnd(), 40 + rnd() * 60, 30 + rnd() * 50, p.t === 'mall' ? 12 + rnd() * 6 : 14 + rnd() * 30, 1], null); } }
  uploadBuildings([]);
}
// ---------------------------------------------------------------- real buildings (City of Toronto 3D Massing 2025, tools/buildings.py): oriented boxes,
// pitched roofs on houses, flat roofs on everything else at its real height. When present they replace the made-up houses and side streets.
let REAL = null, bldGrid = null; const BG = 40;
function realData() { try { const el = document.getElementById('bld'); if (!el) return null; const j = JSON.parse(el.textContent); if (!j || !j.n) return null;
  const bin = atob(j.b64), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return new Uint16Array(u8.buffer, 0, j.n * 6); } catch (e) { return null; } }
function bldAdd(k, x, y, ang, w, d) { const c = Math.cos(ang), sn = Math.sin(ang), r = Math.hypot(w, d) / 2; for (let ax = Math.floor((x - r) / BG); ax <= Math.floor((x + r) / BG); ax++) for (let ay = Math.floor((y - r) / BG); ay <= Math.floor((y + r) / BG); ay++) { const key = ax * 100003 + ay; let a = bldGrid.get(key); if (!a) bldGrid.set(key, a = []); a.push(k, x, y, c, sn, w / 2, d / 2); } }
function inBld(x, y, pad) { if (!bldGrid) return -1; const a = bldGrid.get(Math.floor(x / BG) * 100003 + Math.floor(y / BG)); if (!a) return -1;
  for (let i = 0; i < a.length; i += 7) { const dx = x - a[i + 1], dy = y - a[i + 2], u = dx * a[i + 3] + dy * a[i + 4], v = -dx * a[i + 4] + dy * a[i + 3]; if (Math.abs(u) < a[i + 5] + pad && Math.abs(v) < a[i + 6] + pad) return a[i]; } return -1; }
function buildReal() {
  bldSrc.length = 0; bldGrid = new Map(); fillTrees = []; const r = REAL, n = r.length / 6; let seed = 31; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < n; i++) { const o = i * 6, x = r[o] / 2 - 16384, y = r[o + 1] / 2 - 16384, ang = r[o + 2] / 10000 * Math.PI, w = r[o + 3] / 10, d = r[o + 4] / 10, h = r[o + 5] / 10, r2 = rnd(), r3 = rnd();
    if (nearRoad(x, y, Math.min(4, d * 0.25)) || y > shoreY(x) - 8) continue; // the model's roads are a little wider than life: skip anything that would sit on the asphalt
    const k = bldSrc.length;
    if (w * d < 300 && h < 12) { bldSrc.push([x, y, ang, r2, w, d, Math.max(2.6, Math.min(8, h * 0.8)), 0], [x, y, r2, r3]); // a house: walls, then the gable on top
      if (r3 < 0.55) { const side = r2 < 0.5 ? -1 : 1, off = d / 2 + 5 + r3 * 7, lat = (r2 - 0.5) * w, tx = x + Math.cos(ang) * lat - Math.sin(ang) * off * side, ty = y + Math.sin(ang) * lat + Math.cos(ang) * off * side; fillTrees.push([tx, ty, r3 < 0.2 ? 1 : 0]); } }
    else bldSrc.push([x, y, ang, r2, w, d, h, h >= 20 ? 2 : 1], null);
    bldAdd(k, x, y, ang, w, d); }
  uploadBuildings([]);
}
function emptyFill() { fillM = new Uint8Array(fillN * fillN); fillTex = tex(fillN, fillN, 'r8'); gl.bindTexture(gl.TEXTURE_2D, fillTex); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, fillN, fillN, gl.RED, gl.UNSIGNED_BYTE, fillM); }
const bldSrc = []; // procedural buildings, pairs of [instance, house-light or null]; towers replace the ones they overlap
let gableBuf = null, treeBuf = null;
function uploadBuildings(clear) {
  const hi = [], bi = [], hv = []; const grid = new Map(); for (const c of clear) { const k = Math.floor(c[0] / 200) * 100003 + Math.floor(c[1] / 200); let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(c); }
  const free = (x, y) => { const gx = Math.floor(x / 200), gy = Math.floor(y / 200); for (let ax = gx - 1; ax <= gx + 1; ax++) for (let ay = gy - 1; ay <= gy + 1; ay++) { const a = grid.get(ax * 100003 + ay); if (a) for (const c of a) if (Math.abs(x - c[0]) < c[2] && Math.abs(y - c[1]) < c[2]) return false; } return true; };
  for (let i = 0; i < bldSrc.length; i += 2) { const b = bldSrc[i]; if (!free(b[0], b[1])) continue; (b[7] ? bi : hi).push(...b); if (bldSrc[i + 1]) hv.push(...bldSrc[i + 1]); }
  cubeBuf = cubeBuf || buf(cubeGeo()); gableBuf = gableBuf || buf(gableGeo()); const IA = [[2, 4], [3, 4]];
  for (const c of [hBld, bBld, hLit]) if (c) { gl.deleteBuffer(c.buf); gl.deleteVertexArray(c.vao); }
  hBld = chunked(new Float32Array(hi), 8, gableBuf, 6, [[0, 3], [1, 3]], 42, IA); bBld = chunked(new Float32Array(bi), 8, cubeBuf, 6, [[0, 3], [1, 3]], 30, IA);
  hLit = chunked(new Float32Array(hv), 4, quadBuf, 2, [[0, 2]], 4, [[1, 4]]); bldN = hBld.n + bBld.n; houseN = hLit.n;
}
function buildTrees() { // street trees, back-yard trees and woods where the land map says nothing is built
  const v = []; let seed = 99; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const add = (x, y, big, con) => { if (y > shoreY(x) - 12) return; if (REAL && inBld(x, y, 1.2) >= 0) return; const r = (con ? 2.2 : 3.2) + rnd() * (big ? 3.4 : 2.2), h = con ? r * (3.2 + rnd() * 1.4) : r * (1.9 + rnd() * 0.9); v.push(x, y, r, h, rnd(), con ? 1 : 0, 0, 0); };
  for (let e = 0; e < G.ea.length; e++) { const cls = G.cls[e]; if (cls < 2 || (R.rev[e] >= 0 && R.rev[e] < e)) continue; const p = polyPts(e), half = (G.lanes[e] + (R.rev[e] >= 0 ? G.lanes[R.rev[e]] : 0)) * 1.7, step = cls === 5 ? 19 : cls === 4 ? 24 : 38; let acc0 = 0; const tot = G.len[e];
    for (let i = 0; i < p.length - 1; i++) { const dx = p[i + 1][0] - p[i][0], dy = p[i + 1][1] - p[i][1], l = Math.hypot(dx, dy); if (l < 1) continue; const nx = -dy / l, ny = dx / l;
      for (let d = rnd() * step; d < l; d += step * (0.7 + rnd() * 0.7)) { if (acc0 + d < 16 || acc0 + d > tot - 16) continue; for (const side of [-1, 1]) { if (rnd() < 0.3) continue; const off = half + 2.6 + rnd() * 1.2, x = p[i][0] + dx / l * d + nx * off * side, y = p[i][1] + dy / l * d + ny * off * side; if (!nearRoad(x, y, 1.2, e)) add(x, y, false, false);
        if (cls >= 4 && rnd() < 0.45) { const o2 = half + 27 + rnd() * 9, x2 = p[i][0] + dx / l * (d + rnd() * 8) + nx * o2 * side, y2 = p[i][1] + dy / l * (d + rnd() * 8) + ny * o2 * side; if (!nearRoad(x2, y2, 9, e)) add(x2, y2, true, rnd() < 0.18); } } }
      acc0 += l; } }
  const x0 = landExt[0], y0 = landExt[1], w = 1 / landExt[2], h = 1 / landExt[3], st = 16; // woods and parks: dense in the forest patches, scattered in the meadows
  for (let y = y0; y < y0 + h; y += st) for (let x = x0; x < x0 + w; x += st) { const [g, a] = landAt(x, y); if (g < 0.45 || a < 0.5) continue; const cx = Math.floor((x - x0) * landExt[2] * landN), cy = Math.floor((y - y0) * landExt[3] * landN), f = landF[cy * landN + cx] || 0;
    const px = x + (rnd() - 0.5) * st, py = y + (rnd() - 0.5) * st; if (rnd() > g * (0.08 + 0.9 * f)) continue; if (!nearRoad(px, py, 7)) add(px, py, true, rnd() < 0.22 + 0.2 * f); }
  for (const [x, y, big] of fillTrees) if (REAL ? !nearRoad(x, y, 1.5) : fillAt(x, y) >= 128) add(x, y, !!big, rnd() < 0.15);
  treeBuf = buf(treeGeo()); trees = chunked(new Float32Array(v), 8, treeBuf, 6, [[0, 3], [1, 3]], 90, [[2, 4], [3, 4]]);
}
let towerVao = null, towerN = 0, railVao = null, railCount = 0;
function setLandmarks(list) { // real buildings [[x, y, angle, w, d, h, kind]] (2 = apartment tower, 3 = school / worship): nudged off the road, replacing the made-up houses they cover
  if (REAL) { for (const [x, y, , w, d, , kind] of list) { let best = -1, bs = -1; const rr = Math.max(20, Math.hypot(w, d) / 2);
      for (let ax = Math.floor((x - rr) / BG); ax <= Math.floor((x + rr) / BG); ax++) for (let ay = Math.floor((y - rr) / BG); ay <= Math.floor((y + rr) / BG); ay++) { const a = bldGrid.get(ax * 100003 + ay); if (!a) continue;
        for (let i = 0; i < a.length; i += 7) { const b = bldSrc[a[i]]; if (!b || b[7] === 0 || Math.hypot(b[0] - x, b[1] - y) > rr + Math.hypot(b[4], b[5]) / 2) continue; const sc = kind === 2 ? b[6] : b[4] * b[5]; if (sc > bs) { bs = sc; best = a[i]; } } }
      if (best >= 0) bldSrc[best][7] = kind; }
    towerN = 0; towerVao = null; uploadBuildings([]); return; }
  const ti = [], clear = [];
  for (const [x0, y0, ang, w, d, h, kind] of list) {
    const nx = -Math.sin(ang), ny = Math.cos(ang); let x = x0, y = y0;
    for (let k = 1; k <= 8 && nearRoad(x, y, d / 2 + 3); k++) { const o = Math.ceil(k / 2) * 8 * (k % 2 ? 1 : -1); x = x0 + nx * o; y = y0 + ny * o; }
    ti.push(x, y, ang, Math.abs(x * 0.37 + y * 0.11) % 1, w, d, h, kind); clear.push([x, y, Math.hypot(w, d) / 2 + 6]);
  }
  towerN = ti.length / 8; towerVao = towerN ? vao([{ buf: cubeBuf, stride: 6, attrs: [[0, 3], [1, 3]] }, { buf: buf(new Float32Array(ti)), stride: 8, attrs: [[2, 4], [3, 4]], div: 1 }]) : null;
  uploadBuildings(clear);
}
function setRails(lines) { // [[[x, y], ...]] track centre lines
  const v = [], idx = [];
  for (const pts of lines) { if (pts.length < 2) continue; const n0 = v.length / 6; let dist = 0, px = pts[0][0], py = pts[0][1];
    stripVerts(pts, (x, y, nx, ny) => { dist += Math.hypot(x - px, y - py); px = x; py = y; v.push(x, y, nx, ny, -1, dist, x, y, nx, ny, 1, dist); });
    for (let i = 0; i < pts.length - 1; i++) { const a = n0 + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } }
  railVao = vao([{ buf: buf(new Float32Array(v)), stride: 6, attrs: [[0, 2], [1, 2], [2, 2]] }]); gl.bindVertexArray(railVao);
  const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(idx), gl.STATIC_DRAW); gl.bindVertexArray(null); railCount = idx.length;
}
function setSpeeds(u8, cut) { gl.bindTexture(gl.TEXTURE_2D, spdTex); const h = Math.ceil(G.ea.length / 2048); const full = new Uint8Array(2048 * h * 2); for (let i = 0; i < 2048 * h; i++) { full[i * 2] = i < u8.length ? u8[i] : 255; full[i * 2 + 1] = cut && i < cut.length ? cut[i] : 0; } gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 2048, h, gl.RG, gl.UNSIGNED_BYTE, full); }
function setSignals(u8) { gl.bindTexture(gl.TEXTURE_2D, sigTex); const h = Math.max(1, Math.ceil(G.ctrls.length / 2048)); const full = new Uint8Array(2048 * h); full.set(u8); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 2048, h, gl.RED, gl.UNSIGNED_BYTE, full); }
let carN = 0; function setCars(f32, n) { gl.bindBuffer(gl.ARRAY_BUFFER, carBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, f32, 0, Math.min(n, carCap) * 4); carN = Math.min(n, carCap); }
let spriteN = 0; function setSprites(f32, n) { gl.bindBuffer(gl.ARRAY_BUFFER, spriteBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, f32, 0, n * 8); spriteN = n; }

// ---------------------------------------------------------------- frame
function setCommon(p, env) { gl.useProgram(p.p); const u = p.u; if (u.uVP) gl.uniformMatrix4fv(u.uVP, false, cam.vp); if (u.uWpp) gl.uniform1f(u.uWpp, cam.wpp); if (u.uTime) gl.uniform1f(u.uTime, env.time); if (u.uNight) gl.uniform1f(u.uNight, env.night); if (u.uDay) gl.uniform1f(u.uDay, env.day); if (u.uRain) gl.uniform1f(u.uRain, env.rain);
  if (u.uOut) { const a = new Float32Array(32); const o = env.outages || []; for (let i = 0; i < Math.min(8, o.length); i++) { a[i * 4] = o[i][0]; a[i * 4 + 1] = o[i][1]; a[i * 4 + 2] = o[i][2]; } gl.uniform4fv(u.uOut, a); gl.uniform1i(u.uNOut, Math.min(8, o.length)); } }
function draw(env) {
  updateCam();
  const fw = gl.canvas.width, fh = gl.canvas.height;
  gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFbo); gl.viewport(0, 0, fw, fh);
  const lc = [0.022 + env.day * 0.05, 0.03 + env.day * 0.055, 0.04 + env.day * 0.06];
  gl.clearColor(lc[0], lc[1], lc[2], 1); gl.clearDepth(1); gl.clearStencil(0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
  gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  const snowG = env.snow || 0, season = env.season || 0;
  // land
  setCommon(P.ground, env); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, landTex); gl.uniform1i(P.ground.u.uLand, 0); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, fillTex); gl.uniform1i(P.ground.u.uFill, 1); gl.activeTexture(gl.TEXTURE0); gl.uniform4fv(P.ground.u.uExt, landExt); gl.uniform1f(P.ground.u.uSeason, season); gl.uniform1f(P.ground.u.uSnowG, snowG); gl.bindVertexArray(R.landVao); gl.drawArrays(gl.TRIANGLES, 0, 6);
  // lake
  setCommon(P.flat, env); gl.bindVertexArray(lakeVao); gl.drawArrays(gl.TRIANGLES, 0, lakeCount);
  // rails (under the roads: bridges and level crossings both read right)
  if (railCount) { setCommon(P.rail, env); gl.bindVertexArray(railVao); gl.drawElements(gl.TRIANGLES, railCount, gl.UNSIGNED_INT, 0); }
  // roads
  setCommon(P.road, env); gl.uniform1f(P.road.u.uSnowG, snowG);
  if (cam.wpp < 2.6 && !liteMode) { gl.uniform1f(P.road.u.uPass, 1); gl.bindVertexArray(roadVaoRes); gl.drawElements(gl.TRIANGLES, roadCountRes, gl.UNSIGNED_INT, 0); gl.bindVertexArray(roadVao); gl.drawElements(gl.TRIANGLES, roadCount, gl.UNSIGNED_INT, 0); }
  gl.uniform1f(P.road.u.uPass, 0); gl.bindVertexArray(roadVaoRes); gl.drawElements(gl.TRIANGLES, roadCountRes, gl.UNSIGNED_INT, 0); gl.bindVertexArray(roadVao); gl.drawElements(gl.TRIANGLES, roadCount, gl.UNSIGNED_INT, 0);
  // traffic overlay
  if (env.overlay > 0.01) { setCommon(P.ov, env); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, spdTex); gl.uniform1i(P.ov.u.uSpd, 0); gl.uniform1f(P.ov.u.uOvA, env.overlay); gl.bindVertexArray(ovVao); gl.drawElements(gl.TRIANGLES, ovCount, gl.UNSIGNED_INT, 0); }
  // alpha sprites under cars (puddles, craters, outage shade, zones)
  if (spriteN) { setCommon(P.sprite, env); gl.bindVertexArray(spriteVao); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, env.spriteAlphaN || 0); }
  // shadows, then buildings and trees (depth)
  const grow = Math.max(0, Math.min(1, (6 - cam.wpp) / 3)), tg = towerN ? Math.max(0, Math.min(1, (16 - cam.wpp) / 7)) : 0, treeG = Math.max(0, Math.min(1, (4.2 - cam.wpp) / 2)), detail = grow > 0.01;
  if (detail || tg > 0.01) visCells();
  if (detail || tg > 0.01) { const len = 1 + (env.dusk || 0) * 1.3, shA = (0.16 + 0.26 * env.day) * (1 - 0.5 * (env.rain || 0)) * (1 - 0.4 * (env.fog || 0));
    gl.enable(gl.STENCIL_TEST); gl.stencilFunc(gl.NOTEQUAL, 1, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE); setCommon(P.shd, env); gl.uniform2f(P.shd.u.uSh, 0.62 * len, 0.44 * len); gl.uniform1f(P.shd.u.uA, shA); gl.uniform1f(P.shd.u.uTree, 0);
    if (detail) { gl.uniform1f(P.shd.u.uGrow, grow); drawChunked(hBld, gl.TRIANGLES); drawChunked(bBld, gl.TRIANGLES); }
    if (tg > 0.01) { gl.uniform1f(P.shd.u.uGrow, tg); gl.bindVertexArray(towerVao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 30, towerN); }
    if (detail && treeG > 0.01) { gl.uniform1f(P.shd.u.uTree, 1); gl.uniform1f(P.shd.u.uGrow, treeG); drawChunked(trees, gl.TRIANGLES); }
    gl.disable(gl.STENCIL_TEST); }
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
  if (detail) { gl.disable(gl.BLEND); gl.depthMask(true); setCommon(P.bld, env); gl.uniform1f(P.bld.u.uGrow, grow); gl.uniform1f(P.bld.u.uSnowG, snowG); drawChunked(hBld, gl.TRIANGLES); drawChunked(bBld, gl.TRIANGLES);
    if (treeG > 0.01) { setCommon(P.tree, env); gl.uniform1f(P.tree.u.uGrow, treeG); gl.uniform1f(P.tree.u.uSeason, season); gl.uniform1f(P.tree.u.uSnowG, snowG); drawChunked(trees, gl.TRIANGLES); }
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); }
  if (tg > 0.01) { gl.disable(gl.BLEND); gl.depthMask(true); setCommon(P.bld, env); gl.uniform1f(P.bld.u.uGrow, tg); gl.uniform1f(P.bld.u.uSnowG, snowG); gl.bindVertexArray(towerVao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 30, towerN); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); }
  gl.depthMask(false);
  // cars
  const car3 = cam.wpp < 0.95 && !!car3Vao;
  if (carN) { setCommon(P.car, env); gl.uniform1f(P.car.u.uShOnly, car3 ? 1 : 0); gl.bindVertexArray(carVao); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, carN);
    if (car3) { gl.disable(gl.BLEND); gl.depthMask(true); setCommon(P.car3, env); gl.bindVertexArray(car3Vao); gl.uniform1f(P.car3.u.uPart, 0); gl.drawArraysInstanced(gl.TRIANGLES, 0, 30, carN); gl.uniform1f(P.car3.u.uPart, 1); gl.drawArraysInstanced(gl.TRIANGLES, 0, 30, carN); gl.depthMask(false); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); } }
  // additive: lights, signals, fire/glow sprites
  gl.blendFunc(gl.ONE, gl.ONE);
  if (carN) { setCommon(P.light, env); gl.bindVertexArray(lightVao || (lightVao = carVao)); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, carN); }
  if (houseN && env.night > 0.02) { if (!detail && tg <= 0.01) visCells(); setCommon(P.house, env); drawChunked(hLit, gl.TRIANGLE_STRIP); }
  if (env.sigA > 0.02) { setCommon(P.sig, env); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sigTex); gl.uniform1i(P.sig.u.uSig, 0); gl.uniform1f(P.sig.u.uSigA, env.sigA); gl.bindVertexArray(sigVao); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, sigCount); }
  if ((env.addN || 0) > 0) { setCommon(P.sprite, env); gl.bindVertexArray(spriteVao);
    // additive sprites live after the alpha ones; draw them with instance offset by rebinding attribute pointers
    gl.bindBuffer(gl.ARRAY_BUFFER, spriteBuf); const off = (env.spriteAlphaN || 0) * 32; gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, off); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, off + 16);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, env.addN);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 0); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16); }
  // smoke drawn last with alpha
  if (env.smokeN) { gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); setCommon(P.sprite, env); gl.bindVertexArray(spriteVao); gl.bindBuffer(gl.ARRAY_BUFFER, spriteBuf); const off = env.smokeStart * 32; gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, off); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, off + 16); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, env.smokeN); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 0); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16); }
  // bloom
  gl.depthMask(true); gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.bindVertexArray(postVao);
  gl.useProgram(P.bright.p); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sceneTex); gl.uniform1i(P.bright.u.uT, 0); gl.uniform1f(P.bright.u.uThr, halfFloat ? 0.9 : 0.72);
  gl.bindFramebuffer(gl.FRAMEBUFFER, bFbo[0]); gl.viewport(0, 0, bTex[0].w, bTex[0].h); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  for (let i = 0; i < 3; i++) {
    if (i > 0) { gl.useProgram(P.blur.p); gl.uniform1i(P.blur.u.uT, 0); gl.uniform2f(P.blur.u.uD, 0, 0); gl.bindTexture(gl.TEXTURE_2D, bTex[i - 1]); gl.bindFramebuffer(gl.FRAMEBUFFER, bFbo[i]); gl.viewport(0, 0, bTex[i].w, bTex[i].h); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); }
    gl.useProgram(P.blur.p); gl.uniform1i(P.blur.u.uT, 0);
    gl.uniform2f(P.blur.u.uD, 1 / bTex[i].w, 0); gl.bindTexture(gl.TEXTURE_2D, bTex[i]); gl.bindFramebuffer(gl.FRAMEBUFFER, bFbo2[i]); gl.viewport(0, 0, bTex[i].w, bTex[i].h); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.uniform2f(P.blur.u.uD, 0, 1 / bTex[i].h); gl.bindTexture(gl.TEXTURE_2D, bTex2[i]); gl.bindFramebuffer(gl.FRAMEBUFFER, bFbo[i]); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  const tilt = liteMode ? 0 : (env.tilt || 0);
  if (tilt > 0.01) { gl.useProgram(P.blur.p); gl.uniform1i(P.blur.u.uT, 0); // soft copy of the frame for the out-of-focus bands
    for (let i = 0; i < 2; i++) { gl.uniform2f(P.blur.u.uD, 0, 0); gl.bindTexture(gl.TEXTURE_2D, i ? dTex[0] : sceneTex); gl.bindFramebuffer(gl.FRAMEBUFFER, dFbo[i]); gl.viewport(0, 0, dTex[i].w, dTex[i].h); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.uniform2f(P.blur.u.uD, 1 / dTex[i].w, 0); gl.bindTexture(gl.TEXTURE_2D, dTex[i]); gl.bindFramebuffer(gl.FRAMEBUFFER, dFbo2[i]); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.uniform2f(P.blur.u.uD, 0, 1 / dTex[i].h); gl.bindTexture(gl.TEXTURE_2D, dTex2[i]); gl.bindFramebuffer(gl.FRAMEBUFFER, dFbo[i]); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); } }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, fw, fh);
  const pc = P.comp; gl.useProgram(pc.p);
  gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, dTex[1]); gl.uniform1i(pc.u.uDof, 4); gl.uniform1f(pc.u.uTilt, tilt); gl.uniform1f(pc.u.uHaze, Math.max(0, Math.min(1, (cam.pitch - 0.45) / 0.4)) * Math.max(0, Math.min(1, (8 - cam.wpp) / 5)));
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sceneTex); gl.uniform1i(pc.u.uT, 0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, bTex[0]); gl.uniform1i(pc.u.uB1, 1);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, bTex[1]); gl.uniform1i(pc.u.uB2, 2);
  gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, bTex[2]); gl.uniform1i(pc.u.uB3, 3);
  gl.uniform1f(pc.u.uTime, env.time); gl.uniform1f(pc.u.uRain, env.rain); if (pc.u.uSnow) gl.uniform1f(pc.u.uSnow, env.snow || 0); if (pc.u.uFog) gl.uniform1f(pc.u.uFog, env.fog || 0); gl.uniform1f(pc.u.uFlash, env.flash || 0); gl.uniform1f(pc.u.uNight, env.night); if (pc.u.uLift) gl.uniform1f(pc.u.uLift, env.lift || 0); gl.uniform1f(pc.u.uDay, env.day); gl.uniform1f(pc.u.uDusk, env.dusk || 0); gl.uniform2f(pc.u.uRes, fw, fh);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.activeTexture(gl.TEXTURE0);
}
return { setLite(v) { liteMode = v; }, init, resize, draw, cam, updateCam, project, unproject, setSpeeds, setSignals, setCars, setSprites, setLandmarks, setRails, polyPts, get W() { return W; }, get H() { return H; }, get gl() { return gl; }, carCap };
})();
