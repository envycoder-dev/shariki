// Генерация тела зомби: SDF-примитивы → Surface Nets → веса скиннинга, маски одежды/ран,
// наборы треугольников для отрубаемых частей. Тело, голова и кисти полигонизуются с разным шагом.
import * as THREE from 'three';
import { roundCone, ellipsoid, sphere, belowY, makeField, fieldBounds, surfaceNets } from './sdf.js';
import { B, NB, computeJoints } from './rig.js';
import { makeNoise3D, smoothstep, clamp } from '../core/noise.js';

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// ---------------------------------------------------------------- примитивы тела
function bodyPrims(s, R) {
  const { J, H } = { J: R.J, H: s.H };
  const g = s.thick, lg = s.limb, mu = s.muscle, bel = s.belly;
  const P = [];
  P.push(ellipsoid([0, R.hipsY - 0.025 * H, -0.005 * H], [0.15 * H * s.hipW * g, 0.1 * H, 0.105 * H * g], { bone: B.hips, k: 0.04 * H }));
  for (const sx of [1, -1]) {
    P.push(ellipsoid([sx * 0.068 * H * s.hipW, R.hipsY - 0.065 * H, -0.052 * H * g], [0.074 * H * g, 0.084 * H, 0.068 * H * g], { bone: B.hips, k: 0.04 * H }));
  }
  // живот (у толстяка — огромный)
  P.push(ellipsoid([0, R.spineY + (0.015 + 0.02 * bel) * H, (0.012 + 0.075 * bel) * H],
    [0.13 * H * g * (1 + 0.55 * bel), 0.13 * H * (1 + 0.32 * bel), 0.095 * H * g * (1 + 1.25 * bel)], { bone: B.spine, k: 0.06 * H }));
  P.push(ellipsoid([0, R.chestY + 0.025 * H, 0], [0.155 * H * s.shoulderW * g, 0.155 * H * s.torsoLen, 0.105 * H * g], { bone: B.chest, k: 0.07 * H }));
  for (const sx of [1, -1]) {
    P.push(ellipsoid([sx * 0.066 * H * s.shoulderW, R.chestY + 0.07 * H, 0.066 * H * g], [0.068 * H * mu, 0.05 * H * mu, 0.04 * H * mu], { bone: B.chest, k: 0.04 * H }));
    if (s.bust > 0) P.push(sphere([sx * 0.06 * H, R.chestY + 0.045 * H, 0.088 * H * g], 0.052 * H * s.bust, { bone: B.chest, k: 0.035 * H }));
    // трапеции: от основания шеи к плечу
    P.push(roundCone([0, R.neckY - 0.012 * H, -0.028 * H], [sx * R.shX * 0.88, R.shY + 0.012 * H, -0.02 * H],
      0.055 * H * mu, 0.05 * H * mu, { bone: sx > 0 ? B.clavL : B.clavR, k: 0.05 * H }));
  }
  // выпирающий позвоночник у тощих
  if (s.thin) {
    for (let i = 0; i < 7; i++) {
      const y = R.spineY - 0.05 * H + i * 0.055 * H;
      P.push(sphere([0, y, -0.1 * H * g], 0.016 * H, { bone: i < 3 ? B.spine : B.chest, k: 0.02 * H }));
    }
  }
  P.push(roundCone([0, R.neckY - 0.05 * H, -0.015 * H], [0, R.headY + 0.04 * H, 0.004 * H], 0.058 * H * s.neckW, 0.047 * H * s.neckW, { bone: B.neck, k: 0.04 * H }));
  // руки
  for (const [side, sx] of [['L', 1], ['R', -1]]) {
    const S = J['arm' + side], E = J['fore' + side], W = J['hand' + side];
    const arm = B['arm' + side], fore = B['fore' + side];
    P.push(ellipsoid(add(S, [sx * 0.012 * H, 0.012 * H, 0]), [0.062 * H * mu, 0.064 * H * mu, 0.06 * H * mu], { bone: arm, k: 0.05 * H }));
    P.push(roundCone(S, E, 0.05 * H * lg * mu, 0.039 * H * lg, { bone: arm, k: 0.035 * H }));
    P.push(roundCone(mix3(S, E, 0.25), mix3(S, E, 0.72), 0.051 * H * lg * mu, 0.044 * H * lg * mu, { bone: arm, k: 0.03 * H }));
    P.push(roundCone(E, W, 0.04 * H * lg, 0.027 * H * lg, { bone: fore, k: 0.03 * H }));
    P.push(roundCone(mix3(E, W, 0.08), mix3(E, W, 0.5), 0.045 * H * lg * mu, 0.035 * H * lg * mu, { bone: fore, k: 0.03 * H }));
  }
  // ноги
  const shoe = s.shoes === 'none' ? 1 : s.shoes === 'boots' ? 1.22 : 1.16;
  for (const [side, sx] of [['L', 1], ['R', -1]]) {
    const T = J['thigh' + side], K = J['shin' + side], A = J['foot' + side];
    const th = B['thigh' + side], sh = B['shin' + side], ft = B['foot' + side];
    P.push(roundCone(T, K, 0.08 * H * lg * Math.sqrt(g), 0.05 * H * lg, { bone: th, k: 0.05 * H }));
    P.push(ellipsoid([T[0] + sx * 0.008 * H, (T[1] + K[1]) / 2 + 0.04 * H, 0.02 * H], [0.067 * H * lg * Math.sqrt(g), 0.16 * H * s.legLen, 0.065 * H * lg], { bone: th, k: 0.04 * H }));
    P.push(sphere([K[0], K[1] + 0.008 * H, K[2] + 0.04 * H], 0.03 * H * lg, { bone: sh, k: 0.025 * H }));
    P.push(roundCone(K, A, 0.048 * H * lg, 0.03 * H * lg, { bone: sh, k: 0.03 * H }));
    P.push(ellipsoid([K[0], K[1] - 0.12 * H * s.legLen, K[2] - 0.035 * H], [0.046 * H * lg, 0.1 * H * s.legLen, 0.048 * H * lg], { bone: sh, k: 0.04 * H }));
    if (s.shoes === 'boots') P.push(roundCone([A[0], A[1] + 0.13 * H, A[2]], [A[0], A[1], A[2] - 0.005 * H], 0.046 * H, 0.05 * H, { bone: sh, k: 0.02 * H }));
    P.push(roundCone([A[0], A[1] - 0.004 * H, A[2] - 0.035 * H], [A[0], 0.03 * H, 0.15 * H], 0.042 * H * shoe, 0.033 * H * shoe, { bone: ft, k: 0.03 * H }));
    P.push(ellipsoid([A[0], 0.042 * H, 0.06 * H], [0.044 * H * shoe, 0.032 * H * shoe, 0.082 * H * shoe], { bone: ft, k: 0.03 * H }));
  }
  P.push(belowY(0.003 * H, { sub: true, k: 0.008 * H }));
  // открытые рёбра — выемка в боку
  if (s.ribs) P.push(ellipsoid(s.ribs.c, [0.05 * H, 0.07 * H, 0.06 * H], { sub: true, k: 0.02 * H }));
  for (const w of s.craters || []) P.push(sphere(w.c, w.r, { sub: true, k: w.r * 0.6 }));
  // гнойники толстяка
  for (const pu of s.pustules || []) P.push(sphere(pu.c, pu.r, { bone: B.spine, k: pu.r * 0.4 }));
  return P;
}

// ---------------------------------------------------------------- голова
function headPrims(s, R) {
  const hp = R.J.head, hs = R.hs, H = s.H;
  const at = (dx, dy, dz) => [hp[0] + dx * hs, hp[1] + dy * hs, hp[2] + dz * hs];
  const P = [], carve = [];
  P.push(ellipsoid(at(0, 0.105, -0.005), [0.082 * hs, 0.1 * hs, 0.098 * hs], { bone: B.head, k: 0.02 * hs }));
  P.push(ellipsoid(at(0, 0.122, 0.055), [0.072 * hs, 0.04 * hs, 0.05 * hs], { bone: B.head, k: 0.02 * hs }));
  P.push(ellipsoid(at(0, 0.103, 0.079), [0.068 * hs, 0.016 * hs, 0.022 * hs], { bone: B.head, k: 0.012 * hs }));
  P.push(ellipsoid(at(0, 0.068, 0.05), [0.064 * hs, 0.05 * hs, 0.058 * hs], { bone: B.head, k: 0.02 * hs }));
  for (const sx of [1, -1]) P.push(ellipsoid(at(sx * 0.047, 0.078, 0.066), [0.022 * hs, 0.015 * hs, 0.02 * hs], { bone: B.head, k: 0.012 * hs }));
  if (!s.noseMissing) P.push(roundCone(at(0, 0.098, 0.093), at(0, 0.064, 0.112), 0.009 * hs, 0.015 * hs, { bone: B.head, k: 0.01 * hs }));
  for (const [sx, side] of [[1, 'L'], [-1, 'R']]) {
    if (s.earMissing !== side) P.push(ellipsoid(at(sx * 0.083, 0.088, -0.006), [0.011 * hs, 0.029 * hs, 0.019 * hs], { bone: B.head, k: 0.008 * hs }));
  }
  if (!s.jawMissing) {
    P.push(ellipsoid(at(0, 0.03, 0.055), [0.055 * hs * s.jawW, 0.028 * hs, 0.048 * hs], { bone: B.jaw, k: 0.015 * hs }));
    P.push(ellipsoid(at(0, 0.017, 0.087), [0.024 * hs, 0.02 * hs, 0.018 * hs], { bone: B.jaw, k: 0.012 * hs }));
    for (const sx of [1, -1]) P.push(roundCone(at(sx * 0.056, 0.064, 0.0), at(sx * 0.036 * s.jawW, 0.016, 0.062), 0.016 * hs, 0.013 * hs, { bone: B.jaw, k: 0.012 * hs }));
  }
  P.push(roundCone(at(0, -0.045, -0.012), at(0, 0.06, -0.01), 0.052 * H * s.neckW, 0.047 * H * s.neckW, { bone: B.neck, k: 0.02 * hs }));
  if (s.hair === 'long') P.push(ellipsoid(at(0, 0.055, -0.045), [0.09 * hs, 0.125 * hs, 0.07 * hs], { bone: B.head, k: 0.03 * hs }));
  const sockets = [];
  for (const [sx, side] of [[1, 'L'], [-1, 'R']]) {
    const c = at(sx * 0.031, 0.09, 0.082);
    sockets.push({ c, r: 0.019 * hs, side, missing: s.eyeMissing === side });
    carve.push(sphere(c, 0.019 * hs, { sub: true, k: 0.01 * hs }));
  }
  const mouth = { c: at(0, 0.044, 0.096), r: [0.03 * hs * s.mouthW, 0.0065 * hs, 0.035 * hs] };
  carve.push(ellipsoid(mouth.c, mouth.r, { sub: true, k: 0.006 * hs }));
  if (s.noseMissing) carve.push(ellipsoid(at(0, 0.076, 0.1), [0.012 * hs, 0.018 * hs, 0.02 * hs], { sub: true, k: 0.006 * hs }));
  if (s.jawMissing) carve.push(ellipsoid(at(0, 0.03, 0.075), [0.05 * hs, 0.035 * hs, 0.05 * hs], { sub: true, k: 0.01 * hs }));
  return { prims: P.concat(carve), sockets, mouth };
}

// ---------------------------------------------------------------- кисть
// каноническая левая кисть: запястье в нуле, пальцы вниз (−Y), ладонь к телу (−X), большой палец вперёд (+Z)
function handPrims(s, curl, rng) {
  const h = s.H * s.handSize;
  const P = [];
  P.push(ellipsoid([0.002 * h, -0.05 * h, 0.002 * h], [0.019 * h, 0.05 * h, 0.043 * h], { bone: B.handL, k: 0.012 * h }));
  P.push(ellipsoid([-0.006 * h, -0.035 * h, 0.027 * h], [0.016 * h, 0.03 * h, 0.017 * h], { bone: B.handL, k: 0.01 * h }));
  P.push(roundCone([0, 0.035 * h, 0], [0, -0.02 * h, 0], 0.024 * h * s.limb, 0.029 * h, { bone: B.foreL, k: 0.012 * h }));
  const fz = [0.03, 0.011, -0.009, -0.028], fl = [0.078, 0.086, 0.08, 0.064], fr = [0.0095, 0.0098, 0.0092, 0.0082];
  const dirAt = (a, fan) => { const v = [-Math.sin(a), -Math.cos(a), fan]; const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
  for (let i = 0; i < 4; i++) {
    const len = fl[i] * h, r = fr[i] * h * s.fingerW;
    const c = curl * (0.8 + rng() * 0.45);
    const fan = (fz[i] / 0.03) * 0.06;
    let p = [0, (-0.094 + (i === 0 || i === 3 ? 0.006 : 0)) * h, fz[i] * h];
    const segs = [[0.45, c * 0.45, 1, 0.92], [0.32, c * 1.0, 0.92, 0.82], [0.23, c * 0.9, 0.82, 0.66]];
    let a = 0;
    for (const [lf, da, r0, r1] of segs) {
      a += da;
      const d = dirAt(a, fan);
      const q = [p[0] + d[0] * len * lf, p[1] + d[1] * len * lf, p[2] + d[2] * len * lf];
      P.push(roundCone(p, q, r * r0, r * r1, { bone: B.handL, k: 0.004 * h }));
      p = q;
    }
  }
  // большой палец
  let p = [-0.012 * h, -0.032 * h, 0.036 * h];
  let d = [-0.3, -0.72, 0.62];
  for (const [l, r0, r1, bend] of [[0.042, 0.012, 0.011, 0.25], [0.034, 0.011, 0.0085, 0.45]]) {
    const ln = Math.hypot(d[0], d[1], d[2]); d = [d[0] / ln, d[1] / ln, d[2] / ln];
    const q = [p[0] + d[0] * l * h, p[1] + d[1] * l * h, p[2] + d[2] * l * h];
    P.push(roundCone(p, q, r0 * h * s.fingerW, r1 * h * s.fingerW, { bone: B.handL, k: 0.005 * h }));
    p = q; d = [d[0] - bend * curl, d[1], d[2] - bend * 0.5];
  }
  return P;
}

/** поле кисти в bind-позе: поворот канонической кисти на ±45° вокруг Z и перенос в запястье */
function handField(prims, wrist, sx) {
  const inner = makeField(prims, 0.02);
  const c = Math.SQRT1_2;
  // локаль = Rz(−sx·45°)·(p − W), с отражением X для правой руки
  const f = (x, y, z) => {
    const px = x - wrist[0], py = y - wrist[1], pz = z - wrist[2];
    const lx = c * px + sx * c * py, ly = -sx * c * px + c * py;
    return inner(sx * lx, ly, pz);
  };
  const cb = fieldBounds(prims, 0.015);
  const corners = [];
  for (const X of [cb[0], cb[3]]) for (const Y of [cb[1], cb[4]]) for (const Z of [cb[2], cb[5]]) {
    const xx = sx * X; // обратное преобразование: p = W + Rz(sx·45°)·(sx·x, y, z)
    corners.push([wrist[0] + c * xx - sx * c * Y, wrist[1] + sx * c * xx + c * Y, wrist[2] + Z]);
  }
  const bounds = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9];
  for (const q of corners) for (let i = 0; i < 3; i++) { bounds[i] = Math.min(bounds[i], q[i]); bounds[i + 3] = Math.max(bounds[i + 3], q[i]); }
  const toLocal = (x, y, z) => {
    const px = x - wrist[0], py = y - wrist[1];
    return [sx * (c * px + sx * c * py), -sx * c * px + c * py, z - wrist[2]];
  };
  return { f, bounds, toLocal };
}

// ---------------------------------------------------------------- веса
function addWeights(out, vi, acc) {
  // четыре самых сильных кости
  const idx = [0, 0, 0, 0], w = [0, 0, 0, 0];
  for (let b = 0; b < NB; b++) {
    const v = acc[b];
    if (v <= w[3]) continue;
    let k = 3;
    while (k > 0 && w[k - 1] < v) { w[k] = w[k - 1]; idx[k] = idx[k - 1]; k--; }
    w[k] = v; idx[k] = b;
  }
  const sum = w[0] + w[1] + w[2] + w[3] || 1;
  for (let k = 0; k < 4; k++) { out.si[vi * 4 + k] = idx[k]; out.sw[vi * 4 + k] = w[k] / sum; }
}

function weightsByPrims(mesh, prims, tau, out, base) {
  const acc = new Float32Array(NB);
  const list = prims.filter((p) => !p.sub && p.bone !== undefined);
  const m = tau * 5;
  const P = mesh.positions;
  for (let i = 0, vi = 0; i < P.length; i += 3, vi++) {
    acc.fill(0);
    const x = P[i], y = P[i + 1], z = P[i + 2];
    let best = 1e9, bestBone = B.hips;
    for (const p of list) {
      const b = p.box;
      if (x < b[0] - m || y < b[1] - m || z < b[2] - m || x > b[3] + m || y > b[4] + m || z > b[5] + m) continue;
      const d = p.f(x, y, z);
      if (d < best) { best = d; bestBone = p.bone; }
      acc[p.bone] += Math.exp(-Math.max(d, 0) / tau);
    }
    if (best > 1e8) acc[bestBone] = 1;
    addWeights(out, base + vi, acc);
  }
}

// ---------------------------------------------------------------- маски
function computeMask(p, dom, s, R, head, noise, out, oi) {
  const H = s.H, [x, y, z] = p;
  const n1 = noise(x * 9, y * 9, z * 9), n2 = noise(x * 23 + 5, y * 23, z * 23);
  const tearN = noise(x * 8 + 13, y * 8, z * 8) * 0.6 + noise(x * 22, y * 22 + 7, z * 22) * 0.4;
  const torso = dom === B.spine || dom === B.chest || dom === B.clavL || dom === B.clavR || dom === B.neck;
  const upperArm = dom === B.armL || dom === B.armR, fore = dom === B.foreL || dom === B.foreR;
  const hips = dom === B.hips, thigh = dom === B.thighL || dom === B.thighR, shin = dom === B.shinL || dom === B.shinR;
  const foot = dom === B.footL || dom === B.footR, isHead = dom === B.head || dom === B.jaw;
  const sx = x >= 0 ? 1 : -1;
  const S = R.J[sx > 0 ? 'armL' : 'armR'];
  const along = (x - S[0]) * sx * Math.SQRT1_2 + (S[1] - y) * Math.SQRT1_2;
  const waist = R.hipsY + 0.05 * H + n1 * 0.012 * H;
  let shirt = 0, pants = 0, shoes = 0, wound = 0, hair = 0, cav = 0, ribs = 0, glow = 0;

  if (s.shirt !== 'none') {
    const sleeve = { long: R.ua + R.fa - 0.03 * H, hoodie: R.ua + R.fa - 0.01 * H, short: 0.55 * R.ua, tank: -1, gown: 0.35 * R.ua, apron: -1, overalls: -1 }[s.shirt];
    let hem = waist - 0.035 * H;
    if (s.shirt === 'gown') hem = R.kneeY + 0.12 * H;
    let collar = R.neckY - 0.005 * H + n2 * 0.006 * H;
    if (s.shirt === 'tank' || s.shirt === 'gown') collar -= 0.06 * H * smoothstep(0.0, 0.07 * H, z) * (1 - smoothstep(0.05 * H, 0.09 * H, Math.abs(x)));
    if (s.shirt === 'hoodie') collar += 0.03 * H;
    let cover = 0;
    if ((torso || (hips && y > hem) || (s.shirt === 'gown' && (hips || thigh))) && y >= hem + n2 * 0.015 * H && y <= collar) cover = 1;
    if ((upperArm || fore) && along < sleeve + n2 * 0.02 * H) cover = 1;
    if (s.shirt === 'tank' && torso && Math.abs(x) > R.shX * 0.62 && y > R.chestY - 0.02 * H) cover = 0;
    if (s.shirt === 'apron') {
      cover = 0;
      if ((torso || hips || thigh) && z > 0.025 * H && y > R.kneeY + 0.05 * H && y < R.chestY + 0.09 * H) cover = 1;
      if (torso && Math.abs(Math.abs(x) - 0.08 * H) < 0.018 * H && y > R.chestY) cover = 1;
    }
    cover *= 1 - smoothstep(0.55 - s.tear * 0.12, 0.6 - s.tear * 0.12, tearN);
    shirt = cover;
  }
  if (s.pants !== 'none') {
    let cover = 0;
    const bottom = s.pants === 'shorts' ? R.kneeY + 0.07 * H : R.ankleY + (s.shoes === 'boots' ? 0.09 : 0.045) * H;
    if ((hips && y < waist) || thigh || shin) cover = y > bottom + n2 * 0.02 * H ? 1 : 0;
    if (s.pants === 'overalls') {
      if (torso && z > 0.02 * H && y < R.chestY + 0.07 * H) cover = 1;
      if (torso && Math.abs(Math.abs(x) - 0.075 * H) < 0.02 * H) cover = 1;
    }
    if (shin || thigh) {
      const kneeHole = Math.hypot(y - R.kneeY, (z - 0.05 * H) * 1.6) < 0.05 * H * s.tear + n1 * 0.02 * H;
      if (kneeHole) cover = 0;
    }
    cover *= 1 - smoothstep(0.47 - s.tear * 0.12, 0.53 - s.tear * 0.12, tearN * 0.9 + 0.08);
    pants = Math.max(pants, cover);
  } else if (hips && y < waist && y > R.hipY - 0.07 * H) pants = 1;
  if (s.shoes !== 'none') {
    const top = R.ankleY + (s.shoes === 'boots' ? 0.12 : 0.025) * H + n2 * 0.006 * H;
    if ((foot || shin || dom === B.toeL || dom === B.toeR) && y < top) shoes = 1;
  }
  if (isHead && head) {
    const hy = (y - R.headY) / R.hs, hz = (z - R.J.head[2]) / R.hs;
    if (s.hair !== 'none') {
      let line = 0.088 + 0.045 * smoothstep(0.0, 0.09, hz);
      if (s.hair === 'long') line = hz < 0.02 ? -0.06 : line;
      let h = hy > line + n2 * 0.01 ? 1 : 0;
      if (s.hair === 'patchy') h *= smoothstep(-0.1, 0.25, noise(x * 30, y * 30, z * 30));
      if (Math.abs(x) > 0.08 * R.hs && hy < 0.1 && s.hair !== 'long') h = 0; // уши
      hair = h;
    }
    for (const so of head.sockets) {
      const d = dist3(p, so.c);
      cav = Math.max(cav, 1 - smoothstep(so.r * 0.7, so.r * 1.25, d));
    }
    const m = head.mouth, dx = (x - m.c[0]) / (m.r[0] * 1.25), dy = (y - m.c[1]) / (m.r[1] * 2.2), dz = (z - m.c[2]) / (m.r[2] * 1.2);
    const md = Math.sqrt(dx * dx + dy * dy + dz * dz);
    cav = Math.max(cav, 1 - smoothstep(0.75, 1.05, md));
    if (s.jawMissing && y < R.headY + 0.06 * R.hs && hz > 0.0) wound = 1;
    if (s.noseMissing && Math.hypot(x, y - (R.headY + 0.076 * R.hs), z - (R.J.head[2] + 0.1 * R.hs)) < 0.026 * R.hs) cav = Math.max(cav, 0.8);
  }
  for (const w of s.wounds) {
    const d = dist3(p, w.c) + n2 * 0.012 * H;
    wound = Math.max(wound, 1 - smoothstep(w.r * 0.45, w.r, d));
  }
  for (const w of s.craters || []) {
    const d = dist3(p, w.c);
    wound = Math.max(wound, 1 - smoothstep(w.r * 1.2, w.r * 1.9, d));
  }
  if (s.ribs) {
    const d = dist3(p, s.ribs.c);
    const r = 1 - smoothstep(0.05 * H, 0.085 * H, d + n2 * 0.01);
    ribs = r; wound = Math.max(wound, r * 0.6);
    if (r > 0.1) shirt *= 1 - r;
  }
  for (const pu of s.pustules || []) {
    const d = dist3(p, pu.c);
    glow = Math.max(glow, 1 - smoothstep(pu.r * 0.55, pu.r * 1.15, d));
  }
  if (glow > 0) shirt *= 1 - glow;
  out.m1[oi * 4] = shirt; out.m1[oi * 4 + 1] = pants; out.m1[oi * 4 + 2] = shoes; out.m1[oi * 4 + 3] = wound;
  out.m2[oi * 4] = hair; out.m2[oi * 4 + 1] = cav; out.m2[oi * 4 + 2] = ribs; out.m2[oi * 4 + 3] = glow;
}

// ---------------------------------------------------------------- сборка
export const SEVER = {
  head: [B.head, B.jaw, B.headTop],
  armL_lower: [B.foreL, B.handL, B.handEndL], armL_upper: [B.armL, B.foreL, B.handL, B.handEndL],
  armR_lower: [B.foreR, B.handR, B.handEndR], armR_upper: [B.armR, B.foreR, B.handR, B.handEndR],
  legL_lower: [B.shinL, B.footL, B.toeL], legL_upper: [B.thighL, B.shinL, B.footL, B.toeL],
  legR_lower: [B.shinR, B.footR, B.toeR], legR_upper: [B.thighR, B.shinR, B.footR, B.toeR],
};

export function buildBody(spec) {
  const t0 = performance.now();
  const s = spec, H = s.H;
  const R = computeJoints(s);
  const noise = makeNoise3D(s.seed);
  let rs = s.seed * 9301 + 49297;
  const rng = () => ((rs = (rs * 9301 + 49297) % 233280) / 233280);

  const bodyP = bodyPrims(s, R);
  const head = headPrims(s, R);
  const parts = [];
  parts.push({ kind: 'body', mesh: surfaceNets(makeField(bodyP), fieldBounds(bodyP, 0.03 * H), 0.026 * H), prims: bodyP });
  parts.push({ kind: 'head', mesh: surfaceNets(makeField(head.prims), fieldBounds(head.prims, 0.012 * H), 0.0088 * R.hs), prims: head.prims });
  const curl = s.curl;
  const hp = handPrims(s, curl, rng);
  for (const [side, sx] of [['L', 1], ['R', -1]]) {
    const hf = handField(hp, R.J['hand' + side], sx);
    parts.push({ kind: 'hand', side, sx, hf, mesh: surfaceNets(hf.f, hf.bounds, 0.0068 * H) });
  }

  let nv = 0, ni = 0;
  for (const p of parts) { nv += p.mesh.positions.length / 3; ni += p.mesh.indices.length; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3);
  const out = { si: new Uint16Array(nv * 4), sw: new Float32Array(nv * 4), m1: new Float32Array(nv * 4), m2: new Float32Array(nv * 4) };
  const index = new Uint32Array(ni);
  let vb = 0, ib = 0;
  const acc = new Float32Array(NB);
  for (const part of parts) {
    const m = part.mesh, n = m.positions.length / 3;
    pos.set(m.positions, vb * 3); nor.set(m.normals, vb * 3);
    for (let i = 0; i < m.indices.length; i++) index[ib + i] = m.indices[i] + vb;
    if (part.kind === 'body') {
      weightsByPrims(m, part.prims, 0.022 * H, out, vb);
    } else if (part.kind === 'head') {
      // голова: челюсть ниже щели рта, шея снизу — по положению, а не по примитивам
      for (let i = 0; i < n; i++) {
        const y = m.positions[i * 3 + 1], z = m.positions[i * 3 + 2];
        const hy = (y - R.headY) / R.hs, hz = (z - R.J.head[2]) / R.hs;
        acc.fill(0);
        const jaw = s.jawMissing ? 0 : smoothstep(0.047, 0.038, hy) * smoothstep(-0.03, 0.02, hz) * smoothstep(-0.025, 0.0, hy);
        const neck = smoothstep(0.03, -0.035, hy) * (1 - jaw);
        acc[B.jaw] = jaw; acc[B.neck] = neck; acc[B.head] = Math.max(0, 1 - jaw - neck);
        addWeights(out, vb + i, acc);
      }
    } else {
      const fore = part.sx > 0 ? B.foreL : B.foreR, hand = part.sx > 0 ? B.handL : B.handR;
      for (let i = 0; i < n; i++) {
        const l = part.hf.toLocal(m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]);
        acc.fill(0);
        const w = smoothstep(0.022 * H, -0.012 * H, l[1]);
        acc[hand] = w; acc[fore] = 1 - w;
        addWeights(out, vb + i, acc);
      }
    }
    for (let i = 0; i < n; i++) {
      const vi = vb + i;
      const dom = out.si[vi * 4];
      computeMask([pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2]], dom, s, R, part.kind === 'head' ? head : null, noise, out, vi);
      if (part.kind === 'hand' && s.gloves) out.m1[vi * 4 + 2] = 1;
    }
    vb += n; ib += m.indices.length;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(out.si, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(out.sw, 4));
  geo.setAttribute('aMask', new THREE.BufferAttribute(out.m1, 4));
  geo.setAttribute('aMask2', new THREE.BufferAttribute(out.m2, 4));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeBoundingSphere();

  // треугольники отрубаемых частей: средний вес выбранных костей ≥ 0.5
  const gibs = {};
  for (const [key, bones] of Object.entries(SEVER)) {
    const set = new Set(bones);
    const vw = new Float32Array(nv);
    for (let v = 0; v < nv; v++) {
      let w = 0;
      for (let k = 0; k < 4; k++) if (set.has(out.si[v * 4 + k])) w += out.sw[v * 4 + k];
      vw[v] = w;
    }
    const tris = [];
    for (let t = 0; t < index.length; t += 3) {
      const a = index[t], b = index[t + 1], c = index[t + 2];
      if (vw[a] + vw[b] + vw[c] >= 1.5) tris.push(a, b, c);
    }
    gibs[key] = new Uint32Array(tris);
  }

  return {
    geometry: geo, joints: R.J, rig: R, sockets: head.sockets, mouth: head.mouth, gibs,
    stats: { verts: nv, tris: index.length / 3, ms: Math.round(performance.now() - t0) },
  };
}
