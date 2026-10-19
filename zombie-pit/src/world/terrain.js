// Земля: полярная сетка с дырой под яму, карта смешивания (splat) и шейдер сплаттинга.
import * as THREE from 'three';
import { makeNoise2D, fbm2, clamp, smoothstep } from '../core/noise.js';
import { SEG, TAU, radiusAt } from './shape.js';
import { dataTexture } from './textures.js';

export const SPLAT_SIZE = 128; // метров на сторону splat-карты
export const SPLAT_RES = 512;
export const CRACK_LEN = 7;    // длина трещин от кромки, м

// Карта смешивания: R — голая земля, G — утоптанная грязь/колея, B — затенение под объектами (без травы)
export function paintSplat(marks) {
  const S = SPLAT_RES, k = S / SPLAT_SIZE;
  const toPx = (x, z) => [(x / SPLAT_SIZE + 0.5) * S, (z / SPLAT_SIZE + 0.5) * S];
  const layer = () => { const c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, S, S); return g; };
  const L = { r: layer(), g: layer(), b: layer() };
  for (const m of marks) {
    for (const ch of ['r', 'g', 'b']) {
      const v = m[ch]; if (!v) continue;
      const g = L[ch];
      g.fillStyle = g.strokeStyle = `rgba(255,255,255,${v})`;
      if (m.pts) {
        g.lineWidth = m.w * k; g.lineCap = 'round'; g.lineJoin = 'round';
        g.beginPath(); m.pts.forEach((p, i) => { const [px, py] = toPx(p[0], p[1]); i ? g.lineTo(px, py) : g.moveTo(px, py); }); g.stroke();
      } else if (m.rect) {
        const [px, py] = toPx(m.x, m.z);
        g.save(); g.translate(px, py); g.rotate(-(m.rot || 0)); g.fillRect(-m.rect[0] * k / 2, -m.rect[1] * k / 2, m.rect[0] * k, m.rect[1] * k); g.restore();
      } else {
        const [px, py] = toPx(m.x, m.z);
        g.beginPath(); g.arc(px, py, m.rad * k, 0, TAU); g.fill();
      }
    }
  }
  // одно размытие на канал (размытие на каждый штрих в canvas очень медленное)
  const blurred = (g) => {
    const c = document.createElement('canvas'); c.width = c.height = S;
    const o = c.getContext('2d'); o.filter = `blur(${0.5 * k}px)`; o.drawImage(g.canvas, 0, 0);
    return o.getImageData(0, 0, S, S).data;
  };
  const dr = blurred(L.r), dg = blurred(L.g), db = blurred(L.b);
  const n = makeNoise2D(2024), n2 = makeNoise2D(2025);
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x, wx = ((x + 0.5) / S - 0.5) * SPLAT_SIZE, wz = ((y + 0.5) / S - 0.5) * SPLAT_SIZE;
    const r = Math.hypot(wx, wz), d = r - radiusAt(Math.atan2(wz, wx));
    // кольцо голой земли вокруг провала + случайные проплешины
    const ring = 1 - smoothstep(1.0, 4.0 + 2.2 * (0.5 + 0.5 * n(wx * 0.12, wz * 0.12)), d);
    const patch = smoothstep(0.38, 0.6, fbm2(n2, wx / 11, wz / 11, 3)) * 0.85;
    const disturbed = (1 - smoothstep(4, 9, d)) * smoothstep(0.1, 0.5, n(wx * 0.3 + 7, wz * 0.3)) * 0.5;
    let R = Math.max(dr[i * 4] / 255, ring, patch, disturbed);
    let G = Math.max(dg[i * 4] / 255, (1 - smoothstep(0.2, 1.6, d)) * 0.5);
    let B = db[i * 4] / 255;
    if (d < 0.6) { R = 1; B = 1; }
    const edge = (x < 2 || y < 2 || x > S - 3 || y > S - 3) ? 0 : 1; // края карты — трава
    data[i * 4] = clamp(R * edge, 0, 1) * 255; data[i * 4 + 1] = clamp(G * edge, 0, 1) * 255;
    data[i * 4 + 2] = clamp(B * edge, 0, 1) * 255; data[i * 4 + 3] = 255;
  }
  const tex = dataTexture(data, S, S, false, false);
  // выборка на CPU (для травы и звука шагов)
  const sample = (wx, wz, out) => {
    const fx = (wx / SPLAT_SIZE + 0.5) * S - 0.5, fy = (wz / SPLAT_SIZE + 0.5) * S - 0.5;
    const x0 = clamp(Math.floor(fx), 0, S - 2), y0 = clamp(Math.floor(fy), 0, S - 2);
    const tx = clamp(fx - x0, 0, 1), ty = clamp(fy - y0, 0, 1);
    for (let c = 0; c < 3; c++) {
      const a = data[(y0 * S + x0) * 4 + c], b = data[(y0 * S + x0 + 1) * 4 + c];
      const e = data[((y0 + 1) * S + x0) * 4 + c], f = data[((y0 + 1) * S + x0 + 1) * 4 + c];
      out[c] = ((a + (b - a) * tx) * (1 - ty) + (e + (f - e) * tx) * ty) / 255;
    }
    return out;
  };
  return { tex, sample, data };
}

// Карта высот (half float) для травы, следующей за камерой
export function heightTexture(heightAt, res = 256) {
  const d = new Uint16Array(res * res * 4);
  for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
    const wx = (x / (res - 1) - 0.5) * SPLAT_SIZE, wz = (y / (res - 1) - 0.5) * SPLAT_SIZE;
    const i = (y * res + x) * 4;
    d[i] = THREE.DataUtils.toHalfFloat(heightAt(wx, wz)); d[i + 3] = THREE.DataUtils.toHalfFloat(1);
  }
  const t = new THREE.DataTexture(d, res, res, THREE.RGBAFormat, THREE.HalfFloatType);
  t.magFilter = t.minFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

// Геометрия земли из полярной сетки
export function terrainGeometry(grid) {
  const W = SEG + 1, nr = grid.nr, N = nr * W;
  const pos = new Float32Array(N * 3), polar = new Float32Array(N * 2);
  for (let i = 0; i < nr; i++) for (let j = 0; j < W; j++) {
    const k = i * W + j;
    pos[k * 3] = grid.px[k]; pos[k * 3 + 1] = grid.py[k]; pos[k * 3 + 2] = grid.pz[k];
    polar[k * 2] = j / SEG; polar[k * 2 + 1] = grid.ds[i];
  }
  const idx = new Uint32Array((nr - 1) * SEG * 6);
  let t = 0;
  for (let i = 0; i < nr - 1; i++) for (let j = 0; j < SEG; j++) {
    const a = i * W + j, b = a + 1, d = a + W, c = d + 1;
    idx[t++] = a; idx[t++] = b; idx[t++] = d;
    idx[t++] = b; idx[t++] = c; idx[t++] = d;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aPolar', new THREE.BufferAttribute(polar, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  fixSeamNormals(g, nr, W);
  g.computeBoundingSphere();
  return g;
}

// Усреднение нормалей на шве (столбцы 0 и SEG совпадают по позиции)
export function fixSeamNormals(g, rows, W) {
  const n = g.attributes.normal.array;
  for (let i = 0; i < rows; i++) {
    const a = (i * W) * 3, b = (i * W + W - 1) * 3;
    const x = n[a] + n[b], y = n[a + 1] + n[b + 1], z = n[a + 2] + n[b + 2], l = Math.hypot(x, y, z) || 1;
    n[a] = n[b] = x / l; n[a + 1] = n[b + 1] = y / l; n[a + 2] = n[b + 2] = z / l;
  }
}

export function terrainMaterial(tx) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  const uniforms = {
    tGrass: { value: tx.grass.map }, tDirt: { value: tx.dirt.map }, tNrm: { value: tx.groundNormals },
    tMacro: { value: tx.macro }, tSplat: { value: tx.splat }, tCrack: { value: tx.crack },
    uSplatSize: { value: SPLAT_SIZE }, uCrackLen: { value: CRACK_LEN },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aPolar;\nvarying vec2 vPolar;\nvarying vec3 vGW;\nvarying vec3 vGN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPolar = aPolar;\nvGW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvGN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D tGrass, tDirt, tNrm, tMacro, tSplat, tCrack;
uniform float uSplatSize, uCrackLen;
varying vec2 vPolar; varying vec3 vGW; varying vec3 vGN;`)
      .replace('#include <map_fragment>', `
vec2 wp = vGW.xz;
vec4 spl = texture2D(tSplat, wp / uSplatSize + 0.5);
vec4 mac = texture2D(tMacro, wp * 0.011);
vec4 mac2 = texture2D(tMacro, wp * 0.043 + vec2(0.37, 0.71));
float brk = (mac2.g - 0.5) + (texture2D(tMacro, wp * 0.23).r - 0.5) * 0.7;
float wDirt = smoothstep(0.3, 0.62, spl.r + brk * 0.45);
float wMud = smoothstep(0.32, 0.7, spl.g + brk * 0.35);
vec2 uvA = wp * 0.38;
vec2 uvB = mat2(0.8, -0.6, 0.6, 0.8) * wp * 0.121 + 0.5;
vec2 uvD = wp * 0.43;
vec2 uvE = mat2(0.6, 0.8, -0.8, 0.6) * wp * 0.147;
vec3 grassC = mix(texture2D(tGrass, uvA).rgb, texture2D(tGrass, uvB).rgb, 0.3 + 0.4 * mac.r);
vec3 dirtC = mix(texture2D(tDirt, uvD).rgb, texture2D(tDirt, uvE).rgb, 0.3 + 0.35 * mac2.r);
vec3 mudC = dirtC * vec3(0.5, 0.46, 0.43);
vec3 alb = mix(grassC, dirtC, wDirt);
alb = mix(alb, mudC, wMud);
alb *= 0.74 + 0.52 * mac.b;
alb = mix(alb, alb * vec3(1.2, 1.02, 0.7), smoothstep(0.5, 0.8, mac.g) * (1.0 - wDirt) * 0.7);
alb *= 1.0 - spl.b * 0.5;
float pd = vPolar.y;
float crk = 0.0;
if (pd < uCrackLen) crk = texture2D(tCrack, vec2(vPolar.x, pd / uCrackLen)).r * (1.0 - smoothstep(uCrackLen * 0.6, uCrackLen, pd));
alb *= 1.0 - crk * 0.9;
alb *= mix(0.55, 1.0, smoothstep(0.0, 0.7, pd));
diffuseColor.rgb *= alb;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(mix(0.92, 0.97, wDirt), 0.6, wMud * 0.85);')
      .replace('#include <normal_fragment_maps>', `
vec2 ng = texture2D(tNrm, uvA).rg * 2.0 - 1.0;
vec2 nd = texture2D(tNrm, uvD).ba * 2.0 - 1.0;
vec2 np = mix(ng, nd, max(wDirt, wMud) * 0.9) * (1.0 - 0.5 * wMud);
vec3 wn = normalize(normalize(vGN) + vec3(np.x, 0.0, np.y) * 0.95);
normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);`);
  };
  mat.customProgramCacheKey = () => 'yama-terrain';
  return mat;
}
