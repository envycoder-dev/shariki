// Форма мира: радиус кромки ямы, высота рельефа, полярная сетка земли с точным heightAt.
import { makeNoise2D, makeNoise3D, fbm2, clamp, smoothstep } from '../core/noise.js';

export const TAU = Math.PI * 2;
export const PIT_DEPTH = 38;
export const SEG = 320; // сегментов по окружности (общие у земли и стенки ямы)

// ---------- кромка ямы ----------
const LUT_N = 2048;
const rimLut = new Float32Array(LUT_N + 1);
{
  const n = makeNoise2D(1337);
  for (let i = 0; i <= LUT_N; i++) {
    const a = (i / LUT_N) * TAU, c = Math.cos(a), s = Math.sin(a);
    const v = 0.95 * n(c * 0.85 + 3.1, s * 0.85 - 1.7) + 0.38 * n(c * 2.1 + 11.3, s * 2.1 + 5.1) + 0.12 * n(c * 4.6 - 7, s * 4.6 + 2);
    rimLut[i] = clamp(11.2 + 1.12 * Math.tanh(v * 1.25), 10.05, 12.45);
  }
  rimLut[LUT_N] = rimLut[0];
}

/** Радиус кромки ямы для угла atan2(z, x); ∈ [10, 12.5] */
export function radiusAt(angle) {
  let t = angle / TAU; t -= Math.floor(t);
  const f = t * LUT_N, i = f | 0, k = f - i;
  return rimLut[i] + (rimLut[i + 1] - rimLut[i]) * k;
}

// Мелкая «обломанность» видимой кромки (только для вершин сетки)
const jagN = makeNoise2D(4242);
export function rimJag(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return 0.035 * jagN(c * 9, s * 9) + 0.02 * jagN(c * 23 + 5, s * 23);
}

// ---------- рельеф ----------
const hn = makeNoise2D(777), hn2 = makeNoise2D(778), hillN = makeNoise2D(779), slN = makeNoise2D(780);

/** Аналитическая высота (для вершин); d — расстояние от кромки ямы */
export function baseHeight(x, z, d) {
  const r = Math.hypot(x, z);
  let h = 0.085 * hn(x / 19, z / 19) + 0.04 * hn2(x / 7.5, z / 7.5);
  // просадка грунта к провалу
  if (d < 5) h -= 0.22 * (1 - smoothstep(0, 5, d)) * (0.75 + 0.25 * slN(x * 0.25, z * 0.25));
  // холмы за пределами игровой зоны
  const t = smoothstep(50, 160, r);
  if (t > 0) h += t * (5.5 + 9 * fbm2(hillN, x / 150, z / 150, 4) + (r - 50) * 0.04);
  return h;
}

// ---------- полярная сетка земли ----------
export class PolarGrid {
  constructor() {
    const ds = [0];
    let d = 0;
    while (d < 360) { d += 0.09 + 0.02 * d + 0.00026 * d * d; ds.push(d); }
    this.ds = ds;
    this.nr = ds.length;
    const W = SEG + 1, N = this.nr * W;
    this.rim = new Float32Array(W);
    this.px = new Float32Array(N); this.pz = new Float32Array(N); this.py = new Float32Array(N);
    for (let j = 0; j <= SEG; j++) {
      const a = (j % SEG) / SEG * TAU;
      this.rim[j] = radiusAt(a) + rimJag(a);
    }
    for (let i = 0; i < this.nr; i++) for (let j = 0; j <= SEG; j++) {
      const a = (j % SEG) / SEG * TAU, r = this.rim[j] + ds[i], k = i * W + j;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      this.px[k] = x; this.pz[k] = z; this.py[k] = baseHeight(x, z, ds[i]);
    }
  }

  // радиус пересечения луча (ux,uz) с отрезком кольца i в клине j
  _rho(i, j, ux, uz) {
    const a0 = i * (SEG + 1) + j, px = this.px, pz = this.pz;
    const ax = px[a0], az = pz[a0], ex = px[a0 + 1] - ax, ez = pz[a0 + 1] - az;
    return (ax * ez - az * ex) / (ux * ez - uz * ex);
  }

  _edge(i, j, ux, uz) {
    const a0 = i * (SEG + 1) + j, px = this.px, pz = this.pz;
    const ax = px[a0], az = pz[a0], ex = px[a0 + 1] - ax, ez = pz[a0 + 1] - az;
    const s = clamp((ax * uz - az * ux) / (ux * ez - uz * ex), 0, 1);
    return this.py[a0] + (this.py[a0 + 1] - this.py[a0]) * s;
  }

  /** Точная высота отрисованной поверхности (барицентрика по треугольникам сетки) */
  heightAt(x, z) {
    const W = SEG + 1, px = this.px, pz = this.pz, py = this.py;
    let a = Math.atan2(z, x); if (a < 0) a += TAU;
    let j = Math.floor(a / TAU * SEG); if (j >= SEG) j = SEG - 1;
    const r = Math.hypot(x, z);
    if (r < 1e-5) return py[0];
    const ux = x / r, uz = z / r;
    if (r <= this._rho(0, j, ux, uz)) return this._edge(0, j, ux, uz); // внутри ямы — высота кромки
    let lo = 0, hi = this.nr - 1;
    if (r >= this._rho(hi, j, ux, uz)) return this._edge(hi, j, ux, uz);
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this._rho(m, j, ux, uz) <= r) lo = m; else hi = m; }
    const A = lo * W + j, B = A + 1, D = A + W, C = D + 1;
    // треугольники (A,B,D) и (B,C,D) — как в индексах меша
    let h = this._tri(A, B, D, x, z, true);
    if (h === null) h = this._tri(B, C, D, x, z, false);
    return h;
  }

  _tri(i0, i1, i2, x, z, strict) {
    const px = this.px, pz = this.pz, py = this.py;
    const v0x = px[i1] - px[i0], v0z = pz[i1] - pz[i0], v1x = px[i2] - px[i0], v1z = pz[i2] - pz[i0];
    const v2x = x - px[i0], v2z = z - pz[i0];
    const den = v0x * v1z - v1x * v0z;
    const w1 = (v2x * v1z - v1x * v2z) / den, w2 = (v0x * v2z - v2x * v0z) / den, w0 = 1 - w1 - w2;
    if (strict && (w0 < -1e-7 || w1 < -1e-7 || w2 < -1e-7)) return null;
    return w0 * py[i0] + w1 * py[i1] + w2 * py[i2];
  }

  /** Расстояние от кромки ямы (по видимой кромке) */
  rimDistance(x, z) {
    const a = Math.atan2(z, x);
    return Math.hypot(x, z) - radiusAt(a);
  }
}

// ---------- профиль стенки ямы ----------
const wN = makeNoise3D(9001), wN2 = makeNoise3D(9002);

/** Смещение радиуса стенки от кромки на глубине depth; верх 0..4 м — в пределах ±0.25 */
export function wallOffset(a, depth, R) {
  const c = Math.cos(a) * R, s = Math.sin(a) * R;
  // подрез под дёрном (нависающий край)
  const lip = 0.2 * smoothstep(0.02, 0.32, depth) * (1 - smoothstep(0.55, 1.4, depth));
  const top = (0.075 * wN(c * 0.8, depth * 0.9, s * 0.8) + 0.04 * wN2(c * 2.6, depth * 2.2, s * 2.6)) * smoothstep(0.0, 0.25, depth);
  let off = clamp(lip + top, -0.2, 0.24);
  if (depth > 3.6) {
    const t = smoothstep(3.6, 11, depth);
    const band = wN(c * 0.22, depth * 0.55, s * 0.22);
    const rough = Math.abs(wN2(c * 0.6, depth * 0.45, s * 0.6));
    const big = 1.25 * band + 0.6 * (rough - 0.3) + 0.25 * wN(c * 1.7, depth * 1.4, s * 1.7);
    off += t * big - 3.2 * smoothstep(5, PIT_DEPTH, depth) - 0.9 * smoothstep(4, 9, depth) * (0.5 + 0.5 * band);
  }
  return off;
}
