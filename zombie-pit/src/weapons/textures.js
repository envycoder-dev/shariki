// Процедурные текстуры и материалы вьюмодели: всё генерируется в DataTexture, без внешних файлов.
import * as THREE from 'three';
import { RNG } from '../core/noise.js';

// Периодический value-noise (тайлится): решётка cx×cy, добавляется в out с весом amp
function lattice(size, cx, cy, rnd, out, amp) {
  const lat = new Float32Array(cx * cy);
  for (let i = 0; i < lat.length; i++) lat[i] = rnd();
  for (let y = 0; y < size; y++) {
    const fy = (y / size) * cy, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty);
    const r0 = (y0 % cy) * cx, r1 = ((y0 + 1) % cy) * cx;
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cx, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx);
      const c0 = x0 % cx, c1 = (x0 + 1) % cx;
      const a = lat[r0 + c0] + (lat[r0 + c1] - lat[r0 + c0]) * sx;
      const b = lat[r1 + c0] + (lat[r1 + c1] - lat[r1 + c0]) * sx;
      out[y * size + x] += (a + (b - a) * sy) * amp;
    }
  }
}

function fbm(size, cx, cy, oct, rnd, gain = 0.5) {
  const out = new Float32Array(size * size);
  let amp = 1, norm = 0;
  for (let o = 0; o < oct; o++) {
    lattice(size, Math.min(size, cx << o), Math.min(size, cy << o), rnd, out, amp);
    norm += amp; amp *= gain;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

// Царапины: тонкие отрезки с переносом через край (тайлинг)
function scratches(size, buf, rnd, count, dir, spread, minL, maxL) {
  for (let s = 0; s < count; s++) {
    let x = rnd() * size, y = rnd() * size;
    const a = dir + (rnd() - 0.5) * spread, len = minL + rnd() * (maxL - minL), v = 0.35 + rnd() * 0.65;
    const dx = Math.cos(a) * 0.5, dy = Math.sin(a) * 0.5, n = len * 2;
    for (let i = 0; i < n; i++) {
      const k = Math.sin((i / n) * Math.PI); // сужение к концам
      const ix = ((Math.floor(x) % size) + size) % size, iy = ((Math.floor(y) % size) + size) % size;
      const j = iy * size + ix;
      buf[j] = Math.max(buf[j], v * k);
      x += dx; y += dy;
    }
  }
}

// Высота → карта нормалей (OpenGL, Y вверх)
function toNormal(h, size, strength) {
  const d = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const yu = ((y + 1) % size) * size, yd = ((y - 1 + size) % size) * size, yr = y * size;
    for (let x = 0; x < size; x++) {
      const xr = (x + 1) % size, xl = (x - 1 + size) % size;
      const dx = (h[yr + xr] - h[yr + xl]) * strength, dy = (h[yu + x] - h[yd + x]) * strength;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1), i = (yr + x) * 4;
      d[i] = (-dx * inv * 0.5 + 0.5) * 255; d[i + 1] = (-dy * inv * 0.5 + 0.5) * 255;
      d[i + 2] = (inv * 0.5 + 0.5) * 255; d[i + 3] = 255;
    }
  }
  return d;
}

function tex(data, size, srgb) {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

const c8 = (v) => (v < 0 ? 0 : v > 1 ? 255 : v * 255);

// Сталь (чёрное азотирование): альбедо, ORM (R — маска износа, G — шероховатость, B — металл), нормали
function steelSet(size, rnd) {
  const N = size * size;
  const base = fbm(size, 4, 4, 5, rnd), brush = fbm(size, 2, 128, 3, rnd, 0.65), fine = fbm(size, 48, 48, 2, rnd);
  const wear = fbm(size, 6, 6, 4, rnd), scr = new Float32Array(N);
  scratches(size, scr, rnd, Math.round(N / 900), 0, 0.5, 6, 40);
  scratches(size, scr, rnd, Math.round(N / 2600), 0, Math.PI, 4, 18);
  const col = new Uint8Array(N * 4), orm = new Uint8Array(N * 4), h = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const v = 0.9 + 0.35 * (base[i] - 0.5) + 0.12 * (brush[i] - 0.5), s = scr[i] * (0.4 + wear[i]);
    const g = 0.27 * v + s * 0.32;
    col[i * 4] = c8(g * 0.97); col[i * 4 + 1] = c8(g * 0.99); col[i * 4 + 2] = c8(g * 1.04); col[i * 4 + 3] = 255;
    orm[i * 4] = c8(wear[i] * 1.4 - 0.2); orm[i * 4 + 1] = c8(0.86 + 0.22 * (brush[i] - 0.5) + 0.15 * (base[i] - 0.5) - s * 0.35);
    orm[i * 4 + 2] = 255; orm[i * 4 + 3] = 255;
    h[i] = brush[i] * 0.5 + fine[i] * 0.25 - scr[i] * 0.9;
  }
  return { map: tex(col, size, true), orm: tex(orm, size), normal: tex(toNormal(h, size, size / 256), size) };
}

// Общая «грязь»: серое альбедо-множитель + ORM
function grimeSet(size, rnd) {
  const N = size * size;
  const a = fbm(size, 4, 4, 5, rnd), b = fbm(size, 16, 16, 3, rnd), w = fbm(size, 6, 6, 4, rnd);
  const col = new Uint8Array(N * 4), orm = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) {
    const g = 0.86 + 0.22 * (a[i] - 0.5) + 0.1 * (b[i] - 0.5) - Math.max(0, a[i] - 0.68) * 0.6;
    col[i * 4] = col[i * 4 + 1] = col[i * 4 + 2] = c8(g); col[i * 4 + 3] = 255;
    orm[i * 4] = c8(w[i] * 1.4 - 0.2); orm[i * 4 + 1] = c8(0.84 + 0.25 * (b[i] - 0.5) + 0.12 * (a[i] - 0.5));
    orm[i * 4 + 2] = 255; orm[i * 4 + 3] = 255;
  }
  return { map: tex(col, size, true), orm: tex(orm, size) };
}

// Мелкий шум полимера и стиплинг рукояти
function polyNormals(size, rnd) {
  const N = size * size;
  const f = fbm(size, 64, 64, 2, rnd), m = fbm(size, 8, 8, 3, rnd);
  const h1 = new Float32Array(N);
  for (let i = 0; i < N; i++) h1[i] = f[i] * 0.6 + m[i] * 0.4;
  const h2 = new Float32Array(N);
  const cnt = Math.round(N / 22);
  for (let c = 0; c < cnt; c++) {
    const cx = rnd() * size, cy = rnd() * size, r = (size / 512) * (2.2 + rnd() * 2.2), r2 = r * r, R = Math.ceil(r);
    const sgn = rnd() < 0.8 ? 1 : -0.6;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const d2 = dx * dx + dy * dy; if (d2 > r2) continue;
      const ix = ((Math.floor(cx) + dx) % size + size) % size, iy = ((Math.floor(cy) + dy) % size + size) % size;
      const j = iy * size + ix, v = (1 - d2 / r2) * sgn;
      if (Math.abs(v) > Math.abs(h2[j])) h2[j] = v;
    }
  }
  for (let i = 0; i < N; i++) h2[i] += f[i] * 0.2;
  return { fine: tex(toNormal(h1, size, size / 160), size), stipple: tex(toNormal(h2, size, size / 300), size) };
}

// Дерево: кольца поперёк V, волокна и поры вдоль U
function woodSet(size, rnd, light, dark, rings, warp) {
  const N = size * size;
  const n1 = fbm(size, 3, 5, 4, rnd), n2 = fbm(size, 2, 96, 3, rnd, 0.6), n3 = fbm(size, 8, 8, 3, rnd);
  const pores = new Float32Array(N);
  scratches(size, pores, rnd, Math.round(N / 700), 0, 0.06, 3, 14);
  const col = new Uint8Array(N * 4), h = new Float32Array(N), orm = new Uint8Array(N * 4);
  const hx = (v) => ({ r: ((v >> 16) & 255) / 255, g: ((v >> 8) & 255) / 255, b: (v & 255) / 255 }); // sRGB 0..1
  const L = hx(light), D = hx(dark);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const g = (y / size) * rings + n1[i] * warp;
    let t = 0.5 + 0.5 * Math.sin(g * Math.PI * 2);
    t = t * t * t;
    const f = Math.min(1, 0.5 * t + 0.45 * n2[i] + 0.25 * (n3[i] - 0.5) + pores[i] * 0.55);
    // sRGB-цвета смешиваются как есть: это альбедо в sRGB
    col[i * 4] = c8(L.r + (D.r - L.r) * f); col[i * 4 + 1] = c8(L.g + (D.g - L.g) * f); col[i * 4 + 2] = c8(L.b + (D.b - L.b) * f); col[i * 4 + 3] = 255;
    h[i] = n2[i] * 0.4 + t * 0.15 - pores[i] * 0.8;
    orm[i * 4] = c8(n3[i] * 1.4 - 0.2); orm[i * 4 + 1] = c8(0.8 + 0.25 * (n2[i] - 0.5) + pores[i] * 0.3); orm[i * 4 + 2] = 255; orm[i * 4 + 3] = 255;
  }
  return { map: tex(col, size, true), normal: tex(toNormal(h, size, size / 300), size), orm: tex(orm, size) };
}

// Бакелит АК-74: рыже-коричневый с мраморными разводами
function bakeliteSet(size, rnd) {
  const N = size * size;
  const a = fbm(size, 3, 3, 5, rnd), b = fbm(size, 12, 12, 3, rnd);
  const col = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) {
    const m = 0.5 + 0.5 * Math.sin((a[i] * 7 + b[i] * 1.5) * Math.PI);
    const k = 0.75 + 0.35 * m + 0.1 * (b[i] - 0.5);
    col[i * 4] = c8(0.47 * k); col[i * 4 + 1] = c8(0.205 * k); col[i * 4 + 2] = c8(0.11 * k); col[i * 4 + 3] = 255;
  }
  return { map: tex(col, size, true) };
}

// Ткань: полотняное переплетение (перчатки, рукава)
function fabricSet(size, rnd, threads) {
  const N = size * size;
  const n = fbm(size, 16, 16, 3, rnd), big = fbm(size, 4, 4, 4, rnd), fib = fbm(size, 128, 128, 1, rnd);
  const h = new Float32Array(N), col = new Uint8Array(N * 4), orm = new Uint8Array(N * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const u = (x / size) * threads, v = (y / size) * threads;
    const iu = Math.floor(u), iv = Math.floor(v), fu = u - iu, fv = v - iv;
    const over = (iu + iv) & 1;
    const hh = over ? Math.sin(Math.PI * fv) * (0.75 + 0.25 * Math.sin(Math.PI * fu)) : Math.sin(Math.PI * fu) * (0.75 + 0.25 * Math.sin(Math.PI * fv));
    h[i] = hh * 0.8 + n[i] * 0.3 + fib[i] * 0.15;
    const g = 0.8 + 0.12 * hh + 0.18 * (big[i] - 0.5) + 0.08 * (fib[i] - 0.5);
    col[i * 4] = col[i * 4 + 1] = col[i * 4 + 2] = c8(g); col[i * 4 + 3] = 255;
    orm[i * 4] = 255; orm[i * 4 + 1] = c8(0.92 + 0.08 * (n[i] - 0.5) - hh * 0.06); orm[i * 4 + 2] = 255; orm[i * 4 + 3] = 255;
  }
  return { map: tex(col, size, true), normal: tex(toNormal(h, size, size / 220), size), orm: tex(orm, size) };
}

// Износ кромок: кривизна из экранной производной нормали (для вьюмодели расстояние почти постоянно)
function addWear(mat, wearScale, { color, k = 2, rough = 0.3, metal = null, bias = 0.25 }) {
  const wc = new THREE.Color(color);
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWearColor = { value: wc };
    sh.uniforms.uWearScale = wearScale;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uWearColor;\nuniform float uWearScale;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      {
        float curv = length(fwidth(normalize(vNormal))) * uWearScale;
        float mask = 1.0;
        #ifdef USE_ROUGHNESSMAP
          mask = texture2D(roughnessMap, vRoughnessMapUv).r;
        #endif
        float wr = clamp((curv * ${k.toFixed(3)} - ${bias.toFixed(3)}) * (0.3 + 1.4 * mask), 0.0, 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, uWearColor, wr);
        roughnessFactor = mix(roughnessFactor, ${rough.toFixed(3)}, wr);
        ${metal !== null ? `metalnessFactor = mix(metalnessFactor, ${metal.toFixed(3)}, wr);` : ''}
      }`);
  };
  mat.customProgramCacheKey = () => `wear|${color}|${k}|${rough}|${metal}|${bias}`;
  return mat;
}

// Масштаб UV (повторов на метр) для каждого типа материала — используется геометрией
export const UV_SCALE = {
  steel: 9, steelHi: 9, poly: 14, grip: 14, wood: 3.2, woodAK: 3.2, bakelite: 6, glove: 26, sleeve: 16,
  brass: 14, red: 10, satin: 9, paint: 12, dots: 1, rubber: 14,
};

export function createMaterials(quality = 'high') {
  const size = quality === 'low' ? 256 : 512;
  const rng = new RNG('yama-weapons-tex'), rnd = rng.next;
  const steel = steelSet(size, rnd), grime = grimeSet(size, rnd), pn = polyNormals(size, rnd);
  const walnut = woodSet(size, rnd, 0x7a4a2a, 0x2e1a0e, 7, 0.9);
  const akwood = woodSet(size, rnd, 0x8d4424, 0x3b160a, 11, 0.6);
  const bak = bakeliteSet(size, rnd);
  const fab = fabricSet(size, rnd, size >= 512 ? 64 : 32);
  const wearScale = { value: 1 };
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const ns = (v) => new THREE.Vector2(v, v);

  const m = {};
  m.steel = addWear(std({ color: 0xffffff, map: steel.map, roughnessMap: steel.orm, metalnessMap: steel.orm, normalMap: steel.normal, normalScale: ns(0.35),
    metalness: 0.9, roughness: 0.42, vertexColors: true, envMapIntensity: 1 }), wearScale, { color: 0x9da1a8, k: 2.2, rough: 0.22, metal: 1 });
  m.poly = addWear(std({ color: 0x2a2b2c, map: grime.map, roughnessMap: grime.orm, normalMap: pn.fine, normalScale: ns(0.5),
    metalness: 0.0, roughness: 0.62, vertexColors: true }), wearScale, { color: 0x56585a, k: 1.6, rough: 0.5, bias: 0.35 });
  m.grip = addWear(std({ color: 0x262728, map: grime.map, roughnessMap: grime.orm, normalMap: pn.stipple, normalScale: ns(0.9),
    metalness: 0.0, roughness: 0.75, vertexColors: true }), wearScale, { color: 0x4c4e50, k: 1.4, rough: 0.6, bias: 0.4 });
  m.wood = addWear(std({ color: 0xffffff, map: walnut.map, roughnessMap: walnut.orm, normalMap: walnut.normal, normalScale: ns(0.45),
    metalness: 0, roughness: 0.48, vertexColors: true }), wearScale, { color: 0x9a6a44, k: 1.5, rough: 0.7, bias: 0.35 });
  m.woodAK = addWear(std({ color: 0xffffff, map: akwood.map, roughnessMap: akwood.orm, normalMap: akwood.normal, normalScale: ns(0.4),
    metalness: 0, roughness: 0.4, vertexColors: true }), wearScale, { color: 0xb07048, k: 1.5, rough: 0.7, bias: 0.35 });
  m.bakelite = addWear(std({ color: 0xffffff, map: bak.map, roughnessMap: grime.orm, normalMap: pn.fine, normalScale: ns(0.25),
    metalness: 0, roughness: 0.42, vertexColors: true }), wearScale, { color: 0xc07a4a, k: 1.5, rough: 0.6, bias: 0.35 });
  m.glove = std({ color: 0xffffff, map: fab.map, roughnessMap: fab.orm, normalMap: fab.normal, normalScale: ns(0.8),
    metalness: 0, roughness: 0.92, vertexColors: true });
  m.sleeve = std({ color: 0x4a5038, map: fab.map, roughnessMap: fab.orm, normalMap: fab.normal, normalScale: ns(0.9),
    metalness: 0, roughness: 0.95, vertexColors: true });
  m.brass = addWear(std({ color: 0xc89a4a, roughnessMap: steel.orm, normalMap: steel.normal, normalScale: ns(0.15),
    metalness: 1, roughness: 0.3, vertexColors: true }), wearScale, { color: 0xffe0a0, k: 2, rough: 0.15 });
  m.red = std({ color: 0x9a1c14, map: grime.map, roughnessMap: grime.orm, normalMap: pn.fine, normalScale: ns(0.2),
    metalness: 0, roughness: 0.45, vertexColors: true });
  m.satin = addWear(std({ color: 0xffffff, roughnessMap: steel.orm, normalMap: steel.normal, normalScale: ns(0.25),
    metalness: 1, roughness: 0.3, vertexColors: true }), wearScale, { color: 0xffffff, k: 2.5, rough: 0.12 });
  m.satin.color.setRGB(0.62, 0.63, 0.65);
  m.paint = addWear(std({ color: 0x4a5236, map: grime.map, roughnessMap: grime.orm, normalMap: pn.fine, normalScale: ns(0.3),
    metalness: 0.15, roughness: 0.62, vertexColors: true }), wearScale, { color: 0x8a8c8e, k: 2, rough: 0.35, metal: 0.9, bias: 0.3 });
  m.rubber = std({ color: 0x1a1a1b, map: grime.map, roughnessMap: grime.orm, normalMap: pn.stipple, normalScale: ns(0.6),
    metalness: 0, roughness: 0.85, vertexColors: true });
  // тритиевые точки: слабое зелёное свечение (чуть выше порога bloom)
  m.dots = new THREE.MeshStandardMaterial({ color: 0x2a3a2a, emissive: 0x6cff3a, emissiveIntensity: 1.6, roughness: 0.3 });
  return { m, wearScale, textures: { steel, grime, pn, walnut, akwood, bak, fab } };
}

// Звёздчатая текстура вспышки выстрела (канвас)
export function makeFlashTexture(seed = 7, spikes = 7) {
  const S = 128, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d'), rnd = new RNG(seed).next;
  g.globalCompositeOperation = 'lighter';
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S * 0.28);
  grd.addColorStop(0, 'rgba(255,255,240,1)'); grd.addColorStop(0.35, 'rgba(255,200,110,0.8)'); grd.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  for (let i = 0; i < spikes; i++) {
    const a = (i / spikes) * Math.PI * 2 + (rnd() - 0.5) * 0.5, len = S * (0.26 + rnd() * 0.22), wd = 0.08 + rnd() * 0.08;
    g.save(); g.translate(S / 2, S / 2); g.rotate(a);
    const lg = g.createLinearGradient(0, 0, len, 0);
    lg.addColorStop(0, 'rgba(255,240,200,0.95)'); lg.addColorStop(0.5, 'rgba(255,170,80,0.55)'); lg.addColorStop(1, 'rgba(255,100,30,0)');
    g.fillStyle = lg; g.beginPath(); g.moveTo(0, -len * wd); g.quadraticCurveTo(len * 0.5, -len * wd * 0.4, len, 0);
    g.quadraticCurveTo(len * 0.5, len * wd * 0.4, 0, len * wd); g.closePath(); g.fill(); g.restore();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Боковой «язык» пламени (вид сбоку, вдоль ствола)
export function makeFlameTexture(seed = 3) {
  const W = 128, H = 64, cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d'), rnd = new RNG(seed).next;
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 9; i++) {
    const y = H / 2 + (rnd() - 0.5) * H * 0.25, len = W * (0.5 + rnd() * 0.5), th = H * (0.1 + rnd() * 0.16);
    const lg = g.createLinearGradient(0, 0, len, 0);
    lg.addColorStop(0, 'rgba(255,245,210,0.9)'); lg.addColorStop(0.4, 'rgba(255,170,70,0.5)'); lg.addColorStop(1, 'rgba(255,90,20,0)');
    g.fillStyle = lg; g.beginPath(); g.moveTo(0, y - th); g.quadraticCurveTo(len * 0.6, y - th * 0.3, len, y); g.quadraticCurveTo(len * 0.6, y + th * 0.3, 0, y + th); g.closePath(); g.fill();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
