// Процедурные текстуры мира: бесшовный шум, альбедо + нормали, атлас надписей.
import * as THREE from 'three';
import { mulberry32, RNG, clamp } from '../core/noise.js';

// ---------- бесшовный шум ----------
// Периодический градиентный шум; px/py — период решётки (целые, ≤ 256)
export function makeTileNoise(seed = 1) {
  const rnd = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; const t = p[i]; p[i] = p[j]; p[j] = t; }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const gx = new Float32Array(256), gy = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const a = rnd() * Math.PI * 2; gx[i] = Math.cos(a); gy[i] = Math.sin(a); }
  return function (x, y, px, py = px) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const X0 = ((xi % px) + px) % px, Y0 = ((yi % py) + py) % py;
    const X1 = (X0 + 1) % px, Y1 = (Y0 + 1) % py;
    const h00 = perm[perm[X0] + Y0], h10 = perm[perm[X1] + Y0], h01 = perm[perm[X0] + Y1], h11 = perm[perm[X1] + Y1];
    const d00 = gx[h00] * xf + gy[h00] * yf;
    const d10 = gx[h10] * (xf - 1) + gy[h10] * yf;
    const d01 = gx[h01] * xf + gy[h01] * (yf - 1);
    const d11 = gx[h11] * (xf - 1) + gy[h11] * (yf - 1);
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10), v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const a = d00 + (d10 - d00) * u, b = d01 + (d11 - d01) * u;
    return (a + (b - a) * v) * 1.414;
  };
}

// fbm с периодом 1 по u,v; fx/fy — базовые частоты (целые)
export function tfbm(n, u, v, fx, oct = 4, gain = 0.5, fy = fx) {
  let s = 0, a = 1, norm = 0;
  for (let o = 0; o < oct; o++) { s += a * n(u * fx, v * fy, fx, fy); norm += a; a *= gain; fx *= 2; fy *= 2; }
  return s / norm;
}

// Бесшовный клеточный шум: возвращает объект { f1, f2, id } (переиспользуется)
export function makeWorley(seed, cells) {
  const rnd = mulberry32(seed);
  const px = new Float32Array(cells * cells), py = new Float32Array(cells * cells), rv = new Float32Array(cells * cells);
  for (let i = 0; i < cells * cells; i++) { px[i] = rnd(); py[i] = rnd(); rv[i] = rnd(); }
  const out = { f1: 0, f2: 0, id: 0, r: 0 };
  return function (u, v) {
    const x = u * cells, y = v * cells;
    const xi = Math.floor(x), yi = Math.floor(y);
    let f1 = 9, f2 = 9, id = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cx = xi + dx, cy = yi + dy;
      const k = (((cy % cells) + cells) % cells) * cells + (((cx % cells) + cells) % cells);
      const fx = cx + px[k] - x, fy = cy + py[k] - y;
      const d = fx * fx + fy * fy;
      if (d < f1) { f2 = f1; f1 = d; id = k; } else if (d < f2) f2 = d;
    }
    out.f1 = Math.sqrt(f1); out.f2 = Math.sqrt(f2); out.id = id; out.r = rv[id];
    return out;
  };
}

// ---------- буферы и выгрузка ----------
let maxAniso = 8;
export function setAnisotropy(a) { maxAniso = Math.min(8, a || 1); }

export function dataTexture(data, w, h, srgb, repeat = true) {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = maxAniso;
  t.needsUpdate = true;
  return t;
}

class Buf {
  constructor(w, h = w) { this.w = w; this.h = h; this.col = new Float32Array(w * h * 3); this.hgt = new Float32Array(w * h); }
  // fn(u, v, out[r,g,b,h])
  fill(fn) {
    const o = new Float32Array(4), { w, h, col, hgt } = this;
    for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
      fn(x / w, y / h, o);
      col[i * 3] = o[0]; col[i * 3 + 1] = o[1]; col[i * 3 + 2] = o[2]; hgt[i] = o[3];
    }
    return this;
  }
  // мазок (травинка, царапина): полупрозрачная линия с переносом через края
  stroke(x0, y0, x1, y1, width, r, g, b, alpha, dh) {
    const { w, h, col, hgt } = this;
    const len = Math.hypot(x1 - x0, y1 - y0), steps = Math.max(1, Math.ceil(len * 1.5));
    const rad = width * 0.5, ri = Math.ceil(rad);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps, cx = x0 + (x1 - x0) * t, cy = y0 + (y1 - y0) * t;
      const prof = Math.sin(Math.PI * (0.15 + 0.85 * t));
      for (let oy = -ri; oy <= ri; oy++) for (let ox = -ri; ox <= ri; ox++) {
        const dd = Math.hypot(ox, oy) / (rad + 0.5);
        if (dd > 1) continue;
        const px = ((Math.round(cx) + ox) % w + w) % w, py = ((Math.round(cy) + oy) % h + h) % h;
        const i = py * w + px, a = alpha * (1 - dd * dd);
        col[i * 3] += (r - col[i * 3]) * a; col[i * 3 + 1] += (g - col[i * 3 + 1]) * a; col[i * 3 + 2] += (b - col[i * 3 + 2]) * a;
        hgt[i] += dh * a * prof;
      }
    }
  }
  albedo() {
    const { w, h, col } = this, d = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      d[i * 4] = clamp(col[i * 3], 0, 1) * 255; d[i * 4 + 1] = clamp(col[i * 3 + 1], 0, 1) * 255;
      d[i * 4 + 2] = clamp(col[i * 3 + 2], 0, 1) * 255; d[i * 4 + 3] = 255;
    }
    return dataTexture(d, w, h, true);
  }
  // карта нормалей в касательном пространстве (OpenGL), из высоты
  normals(strength = 2) {
    const { w, h, hgt } = this, d = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const xl = (x + w - 1) % w, xr = (x + 1) % w, yu = (y + h - 1) % h, yd = (y + 1) % h;
      const gx = (hgt[y * w + xr] - hgt[y * w + xl]) * strength;
      const gy = (hgt[yd * w + x] - hgt[yu * w + x]) * strength;
      const il = 1 / Math.hypot(gx, gy, 1), i = (y * w + x) * 4;
      d[i] = (-gx * il * 0.5 + 0.5) * 255; d[i + 1] = (-gy * il * 0.5 + 0.5) * 255; d[i + 2] = (il * 0.5 + 0.5) * 255; d[i + 3] = 255;
    }
    return dataTexture(d, w, h, false);
  }
}

const mix = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ---------- конкретные материалы ----------

export function grassGroundTex(size = 512) {
  const n = makeTileNoise(11), n2 = makeTileNoise(12), rng = new RNG(13);
  const b = new Buf(size).fill((u, v, o) => {
    const a = tfbm(n, u, v, 4, 5), c = tfbm(n2, u, v, 16, 3);
    const t = sstep(-0.25, 0.35, a), k = 0.82 + 0.3 * c;
    o[0] = mix(0.21, 0.24, t) * k; o[1] = mix(0.16, 0.25, t) * k; o[2] = mix(0.11, 0.12, t) * k;
    o[3] = 0.25 + 0.2 * a + 0.1 * c;
  });
  const pal = [[0.21, 0.27, 0.11], [0.31, 0.32, 0.15], [0.47, 0.41, 0.25], [0.31, 0.24, 0.14], [0.15, 0.19, 0.08]];
  for (let s = 0; s < size * size / 26; s++) {
    const x = rng.float(0, size), y = rng.float(0, size), a = rng.float(0, Math.PI * 2), L = rng.float(4, 15) * size / 512;
    const c = pal[rng.int(0, pal.length - 1)], k = rng.float(0.8, 1.15);
    b.stroke(x, y, x + Math.cos(a) * L, y + Math.sin(a) * L, rng.float(1, 2.2) * size / 512, c[0] * k, c[1] * k, c[2] * k, 0.85, 0.5);
  }
  return { map: b.albedo(), normalMap: b.normals(3), buf: b };
}

export function dirtTex(size = 512) {
  const n = makeTileNoise(21), wc = makeWorley(22, 9), wp = makeWorley(23, 34), rng = new RNG(24);
  const b = new Buf(size).fill((u, v, o) => {
    const a = tfbm(n, u, v, 6, 5);
    const c1 = wc(u, v), edge = sstep(0.0, 0.07, c1.f2 - c1.f1), clod = 1 - c1.f1 * 1.4;
    let r = 0.36, g = 0.28, bl = 0.2;
    const k = (0.78 + 0.35 * a) * (0.62 + 0.38 * edge) * (0.92 + 0.16 * c1.r);
    r *= k; g *= k; bl *= k;
    let h = 0.45 + 0.22 * clod + 0.14 * a - (1 - edge) * 0.35;
    const p = wp(u, v);
    if (p.r < 0.45) {
      const pr = 0.16 + 0.14 * p.r;
      if (p.f1 < pr) {
        const t = 1 - p.f1 / pr, gr = 0.38 + 0.25 * ((p.id * 0.618) % 1);
        r = mix(r, gr * 1.05, sstep(0, 0.25, t)); g = mix(g, gr, sstep(0, 0.25, t)); bl = mix(bl, gr * 0.9, sstep(0, 0.25, t));
        h += Math.sqrt(t) * 0.45;
      }
    }
    o[0] = r; o[1] = g; o[2] = bl; o[3] = h;
  });
  for (let s = 0; s < 260; s++) {
    const x = rng.float(0, size), y = rng.float(0, size), a = rng.float(0, Math.PI * 2), L = rng.float(4, 12);
    b.stroke(x, y, x + Math.cos(a) * L, y + Math.sin(a) * L, 1.2, 0.5, 0.44, 0.3, 0.7, 0.2);
  }
  return { map: b.albedo(), normalMap: b.normals(3.5), buf: b };
}

// Упаковка двух карт нормалей в одну: RG — первая, BA — вторая
export function packNormals(bufA, sA, bufB, sB) {
  const w = bufA.w, h = bufA.h, d = new Uint8Array(w * h * 4);
  const enc = (buf, s, x, y, out) => {
    const { hgt } = buf, W = buf.w, H = buf.h;
    const xl = (x + W - 1) % W, xr = (x + 1) % W, yu = (y + H - 1) % H, yd = (y + 1) % H;
    const gx = (hgt[y * W + xr] - hgt[y * W + xl]) * s, gy = (hgt[yd * W + x] - hgt[yu * W + x]) * s;
    const il = 1 / Math.hypot(gx, gy, 1);
    out[0] = (-gx * il * 0.5 + 0.5) * 255; out[1] = (-gy * il * 0.5 + 0.5) * 255;
  };
  const o = [0, 0];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    enc(bufA, sA, x, y, o); d[i] = o[0]; d[i + 1] = o[1];
    enc(bufB, sB, x % bufB.w, y % bufB.h, o); d[i + 2] = o[0]; d[i + 3] = o[1];
  }
  return dataTexture(d, w, h, false);
}

// Порода стенки ямы: светлая детализация, цвет пластов даёт вершинный цвет
export function rockWallTex(size = 512) {
  const n = makeTileNoise(31), n2 = makeTileNoise(32), w = makeWorley(33, 12), wf = makeWorley(34, 40);
  const b = new Buf(size).fill((u, v, o) => {
    const warp = tfbm(n, u, v, 2, 3) * 0.08;
    const lam = Math.sin((v + warp) * Math.PI * 2 * 14 + tfbm(n2, u, v, 3, 2) * 3);
    const a = tfbm(n2, u, v, 8, 5);
    const crack = 1 - Math.abs(tfbm(n, u, v, 6, 3, 0.5, 2));
    const st = w(u, v), sr = 0.25 + 0.15 * st.r, isStone = st.f1 < sr && st.r > 0.35;
    const g = wf(u, v);
    let c = 0.6 + 0.07 * lam + 0.14 * a + (g.f1 < 0.18 ? (0.18 - g.f1) * 0.8 * (g.r - 0.5) : 0);
    let h = 0.45 + 0.06 * lam + 0.18 * a;
    if (isStone) { const t = 1 - st.f1 / sr; c = mix(c, 0.72 + 0.2 * st.r, sstep(0, 0.2, t)); h += Math.sqrt(t) * 0.5; }
    const ck = sstep(0.9, 0.97, crack);
    c *= 1 - ck * 0.65; h -= ck * 0.35;
    o[0] = c * 1.03; o[1] = c; o[2] = c * 0.95; o[3] = h;
  });
  return { map: b.albedo(), normalMap: b.normals(4) };
}

export function barkTex(size = 256) {
  const n = makeTileNoise(41), n2 = makeTileNoise(42);
  const b = new Buf(size).fill((u, v, o) => {
    const f = tfbm(n, u, v, 12, 4, 0.55, 2);
    const ridge = 1 - Math.abs(f);
    const a = tfbm(n2, u, v, 8, 3);
    const k = (0.55 + 0.45 * sstep(0.55, 0.95, ridge)) * (0.85 + 0.2 * a);
    o[0] = 0.33 * k; o[1] = 0.29 * k; o[2] = 0.25 * k; o[3] = ridge * 0.8 + a * 0.2;
  });
  return { map: b.albedo(), normalMap: b.normals(4) };
}

export function woodTex(size = 512) {
  const n = makeTileNoise(51), n2 = makeTileNoise(52), rng = new RNG(53);
  const planks = 4, shade = [], off = [];
  for (let i = 0; i < planks; i++) { shade.push(rng.float(0.8, 1.15)); off.push(rng.float(0, 10)); }
  const b = new Buf(size).fill((u, v, o) => {
    const pu = u * planks, pi = Math.floor(pu), lu = pu - pi;
    const g = Math.sin((lu * 9 + tfbm(n, u, v, 4, 4, 0.5, 1) * 3 + off[pi]) * Math.PI * 2);
    const grain = sstep(0.4, 1, Math.abs(g));
    const a = tfbm(n2, u, v, 8, 4, 0.5, 2);
    const seam = sstep(0.0, 0.03, lu) * sstep(0.0, 0.03, 1 - lu);
    let k = shade[pi] * (0.8 + 0.25 * a) * (1 - grain * 0.28) * (0.35 + 0.65 * seam);
    // гвозди
    const nv = (v * 2) % 1;
    if (Math.hypot((lu - 0.5) * 0.25, Math.min(nv, 1 - nv) * 0.5 - 0.02) < 0.007) k *= 0.35;
    o[0] = 0.47 * k; o[1] = 0.41 * k; o[2] = 0.34 * k; o[3] = 0.5 + 0.1 * a - grain * 0.15 - (1 - seam) * 0.5;
  });
  return { map: b.albedo(), normalMap: b.normals(3) };
}

// Краска по металлу/дереву (светлая — тонируется вершинным цветом)
export function paintTex(size = 512) {
  const n = makeTileNoise(61), n2 = makeTileNoise(62), rng = new RNG(63);
  const b = new Buf(size).fill((u, v, o) => {
    const a = tfbm(n, u, v, 6, 4), streak = tfbm(n2, u, v, 24, 2, 0.5, 2);
    const rust = sstep(0.32, 0.5, tfbm(n2, u, v, 5, 5));
    let r = 0.8 + 0.06 * a - 0.05 * streak, g = r, bl = r;
    r = mix(r, 0.62, rust); g = mix(g, 0.36, rust); bl = mix(bl, 0.2, rust);
    o[0] = r; o[1] = g; o[2] = bl; o[3] = 0.5 + 0.05 * a + rust * 0.15;
  });
  for (let s = 0; s < 340; s++) {
    const x = rng.float(0, size), y = rng.float(0, size), a = rng.float(0, Math.PI * 2), L = rng.float(3, 24);
    b.stroke(x, y, x + Math.cos(a) * L, y + Math.sin(a) * L, rng.float(0.8, 1.6), 0.42, 0.4, 0.38, 0.8, -0.3);
  }
  return { map: b.albedo(), normalMap: b.normals(2) };
}

export function rustTex(size = 512) {
  const n = makeTileNoise(71), n2 = makeTileNoise(72), w = makeWorley(73, 30);
  const b = new Buf(size).fill((u, v, o) => {
    const a = tfbm(n, u, v, 6, 5), c = tfbm(n2, u, v, 3, 4), drip = tfbm(n, u, v, 32, 2, 0.5, 2);
    const pit = w(u, v), pt = pit.f1 < 0.12 * pit.r ? 1 : 0;
    let r = mix(0.3, 0.52, sstep(-0.4, 0.5, a)), g = mix(0.15, 0.27, sstep(-0.4, 0.5, a)), bl = mix(0.07, 0.12, sstep(-0.4, 0.5, a));
    const paint = sstep(0.12, 0.22, c - 0.1 * drip);
    r = mix(r, 0.22, paint); g = mix(g, 0.27, paint); bl = mix(bl, 0.3, paint);
    const k = (1 - pt * 0.5) * (0.85 + 0.2 * drip);
    o[0] = r * k; o[1] = g * k; o[2] = bl * k; o[3] = 0.5 + 0.2 * a - pt * 0.3 + paint * 0.1;
  });
  return { map: b.albedo(), normalMap: b.normals(3) };
}

export function concreteTex(size = 512) {
  const n = makeTileNoise(81), n2 = makeTileNoise(82), w = makeWorley(83, 60);
  const b = new Buf(size).fill((u, v, o) => {
    const a = tfbm(n, u, v, 8, 5), st = tfbm(n2, u, v, 2, 4), streak = tfbm(n2, u, v, 16, 2, 0.5, 1);
    const p = w(u, v), pore = p.f1 < 0.09 * p.r ? 1 : 0;
    let k = (0.82 + 0.12 * a) * (1 - sstep(0.1, 0.5, st) * 0.3) * (1 - pore * 0.45) * (0.95 + 0.08 * streak);
    o[0] = 0.5 * k; o[1] = 0.5 * k; o[2] = 0.48 * k; o[3] = 0.5 + 0.1 * a - pore * 0.4;
  });
  return { map: b.albedo(), normalMap: b.normals(2.5) };
}

export function burlapTex(size = 256) {
  const n = makeTileNoise(91), N = 40;
  const b = new Buf(size).fill((u, v, o) => {
    const fu = u * N, fv = v * N, iu = Math.floor(fu), iv = Math.floor(fv);
    const weft = (iu + iv) & 1;
    const t = weft ? fv - iv : fu - iu;
    const th = Math.sin(Math.PI * t);
    const fib = tfbm(n, u, v, 32, 3);
    const k = (0.72 + 0.28 * th) * (0.85 + 0.25 * fib);
    o[0] = 0.66 * k; o[1] = 0.58 * k; o[2] = 0.43 * k; o[3] = th * 0.7 + fib * 0.2;
  });
  return { map: b.albedo(), normalMap: b.normals(5) };
}

export function strawTex(size = 256) {
  const n = makeTileNoise(101), rng = new RNG(102);
  const b = new Buf(size).fill((u, v, o) => { const a = tfbm(n, u, v, 8, 3); o[0] = 0.42 + a * 0.05; o[1] = 0.36 + a * 0.05; o[2] = 0.22; o[3] = 0.3; });
  for (let s = 0; s < 2600; s++) {
    const x = rng.float(0, size), y = rng.float(0, size), a = rng.float(-0.35, 0.35), L = rng.float(6, 22), k = rng.float(0.6, 1.2);
    b.stroke(x, y, x + Math.cos(a) * L, y + Math.sin(a) * L, 1.3, 0.56 * k, 0.48 * k, 0.3 * k, 0.8, 0.4);
  }
  return { map: b.albedo(), normalMap: b.normals(3) };
}

export function treadTex(size = 256) {
  const n = makeTileNoise(111);
  const b = new Buf(size).fill((u, v, o) => {
    const a = tfbm(n, u, v, 16, 3);
    const cu = (u * 24) % 1, side = v < 0.5 ? 1 : -1;
    const chev = ((cu + Math.abs(v - 0.5) * 1.2 * side) % 1 + 1) % 1;
    const block = (chev > 0.45 && Math.abs(v - 0.5) > 0.06 && Math.abs(v - 0.5) < 0.4) ? 1 : 0;
    const k = 0.07 + 0.02 * a + block * 0.015;
    o[0] = k; o[1] = k; o[2] = k * 1.05; o[3] = block ? 0.9 : 0.3 + 0.05 * a;
  });
  return { map: b.albedo(), normalMap: b.normals(3) };
}

// Макро-шум: R,G,B — разные октавы, A — пятна
export function macroTex(size = 256) {
  const n = makeTileNoise(121), n2 = makeTileNoise(122), n3 = makeTileNoise(123), w = makeWorley(124, 8);
  const d = new Uint8Array(size * size * 4);
  for (let y = 0, i = 0; y < size; y++) for (let x = 0; x < size; x++, i++) {
    const u = x / size, v = y / size;
    d[i * 4] = clamp(0.5 + 0.55 * tfbm(n, u, v, 4, 5), 0, 1) * 255;
    d[i * 4 + 1] = clamp(0.5 + 0.55 * tfbm(n2, u, v, 8, 4), 0, 1) * 255;
    d[i * 4 + 2] = clamp(0.5 + 0.55 * tfbm(n3, u, v, 2, 5), 0, 1) * 255;
    d[i * 4 + 3] = clamp(w(u, v).f1 * 1.4, 0, 1) * 255;
  }
  return dataTexture(d, size, size, false);
}

// Облака: R — крупные, G — детальные, B — кратеры для диска луны
export function cloudTex(size = 256) {
  const n = makeTileNoise(131), n2 = makeTileNoise(132), w = makeWorley(133, 7);
  const d = new Uint8Array(size * size * 4);
  for (let y = 0, i = 0; y < size; y++) for (let x = 0; x < size; x++, i++) {
    const u = x / size, v = y / size;
    d[i * 4] = clamp(0.5 + 0.6 * tfbm(n, u, v, 3, 6, 0.55), 0, 1) * 255;
    d[i * 4 + 1] = clamp(0.5 + 0.6 * tfbm(n2, u, v, 6, 5, 0.55), 0, 1) * 255;
    const c = w(u, v), cr = sstep(0.0, 0.3, c.f1) * 0.6 + 0.4 * sstep(0.2, 0.5, c.f2 - c.f1);
    d[i * 4 + 2] = clamp(cr * (0.85 + 0.3 * tfbm(n, u, v, 8, 3)), 0, 1) * 255;
    d[i * 4 + 3] = 255;
  }
  return dataTexture(d, size, size, false);
}

// ---------- canvas-текстуры ----------
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function canvasTex(c, srgb = true, repeat = false) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = maxAniso;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Мягкое круглое пятно (спрайты свечения)
export function glowTex(size = 128) {
  const c = canvas(size, size), g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,255,255,0.55)');
  gr.addColorStop(0.5, 'rgba(255,255,255,0.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  return canvasTex(c, false);
}

// Клуб дыма: мягкая маска × шум (в альфа-канале)
export function smokeTex(size = 128) {
  const n = makeTileNoise(141), d = new Uint8Array(size * size * 4);
  for (let y = 0, i = 0; y < size; y++) for (let x = 0; x < size; x++, i++) {
    const u = x / size, v = y / size, r = Math.hypot(u - 0.5, v - 0.5) * 2;
    const f = 0.5 + 0.6 * tfbm(n, u, v, 4, 4);
    const a = clamp((1 - sstep(0.3, 1, r)) * (f * 1.3 - 0.15), 0, 1);
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255; d[i * 4 + 3] = a * 255;
  }
  const t = dataTexture(d, size, size, false, false);
  return t;
}

// Трещины вокруг кромки в полярной развёртке: u — угол (0..1), v — расстояние от кромки / длина
export function crackTex(w = 2048, h = 256) {
  const c = canvas(w, h), g = c.getContext('2d'), rng = new RNG(151);
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  g.lineCap = 'round'; g.lineJoin = 'round';
  const line = (pts, width, alpha) => {
    for (const ox of [-w, 0, w]) {
      g.beginPath(); g.moveTo(pts[0][0] + ox, pts[0][1]);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0] + ox, pts[i][1]);
      g.strokeStyle = `rgba(255,255,255,${alpha})`; g.lineWidth = width; g.stroke();
    }
  };
  const crack = (x, y, ang, len, width, depth) => {
    const pts = [[x, y]];
    let a = ang;
    for (let s = 0; s < len; s += 6) {
      a += rng.float(-0.45, 0.45); a = a * 0.85 + ang * 0.15;
      x += Math.sin(a) * 6; y += Math.cos(a) * 6;
      pts.push([x, y]);
      if (depth < 2 && rng.chance(0.05)) crack(x, y, ang + rng.sign() * rng.float(0.4, 0.9), (len - s) * rng.float(0.3, 0.6), width * 0.6, depth + 1);
    }
    line(pts, width * 2.6, 0.25); line(pts, width, 0.95);
  };
  for (let i = 0; i < 90; i++) crack(rng.float(0, w), rng.float(-4, 6), rng.float(-0.25, 0.25), rng.float(40, 240), rng.float(1.6, 4.2), 0);
  // концентрические трещины отрыва
  for (let i = 0; i < 40; i++) {
    const pts = [], y0 = rng.float(10, 110), x0 = rng.float(0, w), L = rng.float(60, 320);
    let y = y0;
    for (let s = 0; s <= L; s += 8) { y += rng.float(-1.6, 1.6); pts.push([x0 + s, y]); }
    line(pts, 5, 0.2); line(pts, rng.float(1.2, 2.6), 0.9);
  }
  const t = canvasTex(c, false);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// Лента ограждения: красно-белые полосы + надпись
export function tapeTex() {
  const c = canvas(512, 32), g = c.getContext('2d');
  g.fillStyle = '#e8e4dc'; g.fillRect(0, 0, 512, 32);
  g.fillStyle = '#c4161c';
  for (let x = -40; x < 560; x += 64) { g.beginPath(); g.moveTo(x, 32); g.lineTo(x + 32, 32); g.lineTo(x + 56, 0); g.lineTo(x + 24, 0); g.fill(); }
  g.fillStyle = 'rgba(20,20,20,0.85)'; g.font = 'bold 20px sans-serif'; g.textBaseline = 'middle';
  g.fillText('ОПАСНО', 150, 17); g.fillText('ОПАСНО', 406, 17);
  return canvasTex(c, true, true);
}

// Атлас надписей и табличек. Возвращает { tex, rect(name) → [u0,v0,u1,v1] }
export function atlasTex() {
  const S = 1024, c = canvas(S, S), g = c.getContext('2d'), rng = new RNG(161);
  g.clearRect(0, 0, S, S);
  const rects = {};
  const reg = (name, x, y, w, h) => { rects[name] = [x / S, 1 - (y + h) / S, (x + w) / S, 1 - y / S]; };
  const grime = (x, y, w, h, n, col, rmax) => {
    for (let i = 0; i < n; i++) {
      g.fillStyle = col.replace('A', rng.float(0.05, 0.25).toFixed(2));
      g.beginPath(); g.arc(x + rng.float(0, w), y + rng.float(0, h), rng.float(2, rmax), 0, 7); g.fill();
    }
  };
  const wear = (x, y, w, h, n) => {
    g.save(); g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < n; i++) { g.fillStyle = `rgba(0,0,0,${rng.float(0.3, 1)})`; g.beginPath(); g.arc(x + rng.float(0, w), y + rng.float(0, h), rng.float(0.8, 3.5), 0, 7); g.fill(); }
    g.restore();
  };
  const font = (px, w = 'bold') => `${w} ${px}px "Arial Black", Impact, "DejaVu Sans", sans-serif`;
  const fitText = (txt, cx, cy, maxW, px, col, w) => {
    g.font = font(px, w); let m = g.measureText(txt).width;
    if (m > maxW) { px *= maxW / m; g.font = font(px, w); }
    g.fillStyle = col; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, cx, cy);
  };
  // 1. трафарет ящика (прозрачный фон)
  fitText('ПРИПАСЫ', 256, 80, 470, 110, 'rgba(226,214,160,0.95)');
  fitText('В/Ч 41729   ГРУЗ № 12-А', 256, 160, 430, 34, 'rgba(226,214,160,0.9)');
  // стенсил-перемычки
  g.save(); g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000';
  for (let x = 30; x < 500; x += 61) g.fillRect(x, 30, 4, 100);
  g.restore(); wear(0, 0, 512, 192, 900); reg('crate', 0, 0, 512, 192);
  // 2. «ОПАСНО! ПРОВАЛ ГРУНТА» (жёлтая)
  g.fillStyle = '#d9a710'; g.fillRect(0, 192, 512, 320);
  g.strokeStyle = '#111'; g.lineWidth = 14; g.strokeRect(10, 202, 492, 300);
  g.fillStyle = '#111'; g.beginPath(); g.moveTo(256, 222); g.lineTo(318, 330); g.lineTo(194, 330); g.closePath(); g.fill();
  g.fillStyle = '#d9a710'; g.beginPath(); g.moveTo(256, 246); g.lineTo(298, 318); g.lineTo(214, 318); g.closePath(); g.fill();
  fitText('!', 256, 292, 60, 62, '#111');
  fitText('ОПАСНО!', 256, 382, 460, 76, '#b3140f');
  fitText('ПРОВАЛ ГРУНТА', 256, 452, 450, 52, '#111');
  grime(0, 192, 512, 320, 160, 'rgba(60,40,20,A)', 14); wear(0, 192, 512, 320, 260); reg('sign1', 0, 192, 512, 320);
  // 3. «КАРАНТИН» (красная)
  g.fillStyle = '#a3110f'; g.fillRect(512, 0, 512, 320);
  g.strokeStyle = '#eee'; g.lineWidth = 10; g.strokeRect(526, 14, 484, 292);
  fitText('КАРАНТИН', 768, 110, 450, 96, '#f2efe6');
  fitText('ВХОД ЗАПРЕЩЁН', 768, 200, 440, 46, '#f2efe6');
  fitText('ОПАСНАЯ ЗОНА · ПРОХОД ЗАКРЫТ', 768, 262, 440, 26, '#f2efe6', '600');
  grime(512, 0, 512, 320, 140, 'rgba(30,20,10,A)', 16); wear(512, 0, 512, 320, 240); reg('sign2', 512, 0, 512, 320);
  // 4. «СТОЙ! ЗАПРЕТНАЯ ЗОНА» (белая)
  g.fillStyle = '#dedad0'; g.fillRect(512, 320, 512, 192);
  g.fillStyle = '#b3140f'; g.fillRect(512, 320, 512, 56);
  fitText('СТОЙ!', 768, 349, 300, 44, '#fff');
  fitText('ЗАПРЕТНАЯ ЗОНА', 768, 420, 460, 50, '#151515');
  fitText('СТРЕЛЯЮТ БЕЗ ПРЕДУПРЕЖДЕНИЯ', 768, 476, 460, 24, '#151515', '600');
  grime(512, 320, 512, 192, 120, 'rgba(50,40,25,A)', 12); wear(512, 320, 512, 192, 200); reg('sign3', 512, 320, 512, 192);
  // 5. полосы
  const stripes = (y, c1, c2) => {
    g.fillStyle = c1; g.fillRect(0, y, 512, 64); g.fillStyle = c2;
    for (let x = -64; x < 576; x += 64) { g.beginPath(); g.moveTo(x, y + 64); g.lineTo(x + 32, y + 64); g.lineTo(x + 64, y); g.lineTo(x + 32, y); g.fill(); }
    grime(0, y, 512, 64, 50, 'rgba(40,30,20,A)', 8);
  };
  stripes(512, '#e9e6de', '#c0151a'); reg('stripeRW', 0, 512, 512, 64);
  stripes(576, '#e0b414', '#141414'); reg('stripeYB', 0, 576, 512, 64);
  // 6. трафарет патронного ящика
  fitText('7,62 ПС', 768, 560, 460, 54, 'rgba(230,220,170,0.92)');
  fitText('440 ШТ.  ПАРТИЯ 18-91', 768, 612, 460, 28, 'rgba(230,220,170,0.9)');
  wear(512, 512, 512, 128, 400); reg('ammo', 512, 512, 512, 128);
  // 7. номерной знак (чёрный, военный)
  g.fillStyle = '#121212'; g.fillRect(512, 640, 256, 64); g.strokeStyle = '#ddd'; g.lineWidth = 3; g.strokeRect(516, 644, 248, 56);
  fitText('47-29 ХА', 640, 672, 230, 40, '#e8e8e8'); reg('plate', 512, 640, 256, 64);
  // 8. номер на двери
  fitText('А-217', 896, 672, 240, 52, 'rgba(235,235,225,0.9)'); wear(768, 640, 256, 64, 150); reg('doornum', 768, 640, 256, 64);
  // 9. «ГЕНЕРАТОР» и «ОГНЕОПАСНО»
  g.fillStyle = '#c99a12'; g.fillRect(0, 640, 512, 64);
  fitText('ОГНЕОПАСНО · 220 В', 256, 672, 480, 36, '#141414'); reg('gen', 0, 640, 512, 64);
  // 10. окно с тёплым светом (для фермы)
  const wg = g.createLinearGradient(0, 720, 0, 976);
  wg.addColorStop(0, '#ffcf8a'); wg.addColorStop(1, '#ff9a3c');
  g.fillStyle = wg; g.fillRect(0, 720, 256, 256);
  g.fillStyle = 'rgba(80,40,20,0.55)'; g.fillRect(30, 740, 70, 236); g.fillRect(170, 740, 70, 236);
  g.fillStyle = '#2a1a10'; g.fillRect(122, 720, 12, 256); g.fillRect(0, 842, 256, 12);
  reg('window', 0, 720, 256, 256);
  const tex = canvasTex(c, true);
  return { tex, rect: (k) => rects[k] };
}
