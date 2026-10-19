// Пружины и ключевые кадры для анимаций вьюмодели
import * as THREE from 'three';

export class Spring {
  constructor(k = 180, zeta = 0.55) { this.set(k, zeta); this.x = 0; this.v = 0; }
  set(k, zeta) { this.k = k; this.c = 2 * Math.sqrt(k) * zeta; return this; }
  step(dt, target = 0) {
    let n = Math.ceil(dt / 0.006); const h = dt / n;
    while (n--) { this.v += (-(this.x - target) * this.k - this.v * this.c) * h; this.x += this.v * h; }
    return this.x;
  }
  reset() { this.x = 0; this.v = 0; }
}

export const EASE = {
  l: (u) => u,
  io: (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2),
  o: (u) => 1 - Math.pow(1 - u, 3),
  i: (u) => u * u * u,
  s: (u) => u * u * u * (u * (u * 6 - 15) + 10),
  b: (u) => { const c = 1.7; return 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2); }, // с перелётом
};

// keys: [[t, [v...], ease?], ...] → out (линейный массив значений)
export function sampleKeys(keys, t, out) {
  const n = keys[0][1].length;
  if (t <= keys[0][0]) { for (let j = 0; j < n; j++) out[j] = keys[0][1][j]; return out; }
  for (let i = 1; i < keys.length; i++) {
    const k1 = keys[i];
    if (t <= k1[0]) {
      const k0 = keys[i - 1], u = (EASE[k1[2] || 'io'])((t - k0[0]) / Math.max(1e-6, k1[0] - k0[0]));
      for (let j = 0; j < n; j++) out[j] = k0[1][j] + (k1[1][j] - k0[1][j]) * u;
      return out;
    }
  }
  const l = keys[keys.length - 1][1];
  for (let j = 0; j < n; j++) out[j] = l[j];
  return out;
}

// Окно 0→1→0: подъём на [a,b], удержание, спад на [c,d]
export function env(t, a, b, c = Infinity, d = Infinity, ease = EASE.io) {
  if (t <= a || t >= d) return 0;
  if (t < b) return ease((t - a) / (b - a));
  if (t <= c) return 1;
  return 1 - ease((t - c) / (d - c));
}

// Трансформ кисти по смыслу: запястье p, направление выпрямленных пальцев fwd, нормаль ладони palm
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _m = new THREE.Matrix4();
export function handXform(p, fwd, palm) {
  _z.fromArray(fwd).normalize().negate();
  _y.fromArray(palm).negate();
  _y.addScaledVector(_z, -_y.dot(_z)).normalize();
  _x.crossVectors(_y, _z);
  _m.makeBasis(_x, _y, _z);
  return { p: new THREE.Vector3().fromArray(p), q: new THREE.Quaternion().setFromRotationMatrix(_m) };
}
