// SDF-примитивы и полигонизация Surface Nets: из набора капсул/эллипсоидов получается
// цельная гладкая сетка (без швов в суставах), которую потом скиним на скелет.

function bbox(ax, ay, az, bx, by, bz, m) {
  return [Math.min(ax, bx) - m, Math.min(ay, by) - m, Math.min(az, bz) - m,
    Math.max(ax, bx) + m, Math.max(ay, by) + m, Math.max(az, bz) + m];
}

/** конус со скруглёнными концами (iq), a→b, радиусы r1→r2 */
export function roundCone(a, b, r1, r2, opts = {}) {
  const ax = a[0], ay = a[1], az = a[2];
  const bax = b[0] - ax, bay = b[1] - ay, baz = b[2] - az;
  const l2 = Math.max(bax * bax + bay * bay + baz * baz, 1e-8);
  const rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1 / l2;
  const srr = Math.sign(rr) * rr * rr;
  const f = (x, y, z) => {
    const pax = x - ax, pay = y - ay, paz = z - az;
    const yy = pax * bax + pay * bay + paz * baz;
    const zz = yy - l2;
    const qx = pax * l2 - bax * yy, qy = pay * l2 - bay * yy, qz = paz * l2 - baz * yy;
    const x2 = qx * qx + qy * qy + qz * qz;
    const k = srr * x2;
    if (Math.sign(zz) * a2 * zz * zz * l2 > k) return Math.sqrt(x2 + zz * zz * l2) * il2 - r2;
    if (Math.sign(yy) * a2 * yy * yy * l2 < k) return Math.sqrt(x2 + yy * yy * l2) * il2 - r1;
    return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - r1;
  };
  return { f, box: bbox(ax, ay, az, b[0], b[1], b[2], Math.max(r1, r2)), ...opts };
}

/** эллипсоид (приближённое SDF), opts.rot — 3x3 мир→локаль (row-major) */
export function ellipsoid(c, r, opts = {}) {
  const cx = c[0], cy = c[1], cz = c[2];
  const rx = r[0], ry = r[1], rz = r[2];
  const irx = 1 / rx, iry = 1 / ry, irz = 1 / rz;
  const rot = opts.rot;
  const rmin = Math.min(rx, ry, rz);
  const f = (x, y, z) => {
    let px = x - cx, py = y - cy, pz = z - cz;
    if (rot) {
      const lx = rot[0] * px + rot[1] * py + rot[2] * pz;
      const ly = rot[3] * px + rot[4] * py + rot[5] * pz;
      const lz = rot[6] * px + rot[7] * py + rot[8] * pz;
      px = lx; py = ly; pz = lz;
    }
    const ax = px * irx, ay = py * iry, az = pz * irz;
    const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
    const bx = ax * irx, by = ay * iry, bz = az * irz;
    const k1 = Math.sqrt(bx * bx + by * by + bz * bz);
    return k1 < 1e-9 ? -rmin : (k0 * (k0 - 1)) / k1;
  };
  const m = Math.max(rx, ry, rz);
  return { f, box: [cx - m, cy - m, cz - m, cx + m, cy + m, cz + m], ...opts };
}

export function sphere(c, r, opts = {}) {
  const cx = c[0], cy = c[1], cz = c[2];
  const f = (x, y, z) => Math.hypot(x - cx, y - cy, z - cz) - r;
  return { f, box: [cx - r, cy - r, cz - r, cx + r, cy + r, cz + r], ...opts };
}

/** скруглённый параллелепипед по осям */
export function roundBox(c, h, round, opts = {}) {
  const cx = c[0], cy = c[1], cz = c[2];
  const hx = h[0] - round, hy = h[1] - round, hz = h[2] - round;
  const f = (x, y, z) => {
    const qx = Math.abs(x - cx) - hx, qy = Math.abs(y - cy) - hy, qz = Math.abs(z - cz) - hz;
    const mx = Math.max(qx, 0), my = Math.max(qy, 0), mz = Math.max(qz, 0);
    return Math.sqrt(mx * mx + my * my + mz * mz) + Math.min(Math.max(qx, qy, qz), 0) - round;
  };
  return { f, box: [cx - h[0], cy - h[1], cz - h[2], cx + h[0], cy + h[1], cz + h[2]], ...opts };
}

/** полупространство y < h (для плоских подошв) */
export function belowY(h, opts = {}) {
  return { f: (x, y) => y - h, box: [-1e3, -1e3, -1e3, 1e3, h + 0.02, 1e3], ...opts };
}

export function smin(a, b, k) {
  if (k <= 0) return a < b ? a : b;
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return (a < b ? a : b) - h * h * k * 0.25;
}

/** поле расстояний набора примитивов: сначала гладкое объединение, затем гладкое вычитание (p.sub) */
export function makeField(prims, pad = 0.04) {
  const add = [], sub = [];
  for (const p of prims) {
    const m = (p.k || 0) + pad;
    const b = p.box;
    const q = { f: p.f, k: p.k || 0, b: [b[0] - m, b[1] - m, b[2] - m, b[3] + m, b[4] + m, b[5] + m] };
    (p.sub ? sub : add).push(q);
  }
  return (x, y, z) => {
    let d = 1;
    for (let i = 0; i < add.length; i++) {
      const p = add[i], b = p.b;
      if (x < b[0] || y < b[1] || z < b[2] || x > b[3] || y > b[4] || z > b[5]) continue;
      d = smin(d, p.f(x, y, z), p.k);
    }
    for (let i = 0; i < sub.length; i++) {
      const p = sub[i], b = p.b;
      if (x < b[0] || y < b[1] || z < b[2] || x > b[3] || y > b[4] || z > b[5]) continue;
      d = -smin(-d, p.f(x, y, z), p.k);
    }
    return d;
  };
}

export function fieldBounds(prims, pad) {
  const b = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9];
  for (const p of prims) {
    if (p.sub) continue;
    for (let i = 0; i < 3; i++) { b[i] = Math.min(b[i], p.box[i]); b[i + 3] = Math.max(b[i + 3], p.box[i + 3]); }
  }
  for (let i = 0; i < 3; i++) { b[i] -= pad; b[i + 3] += pad; }
  return b;
}

const CO = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];

/**
 * Surface Nets: одна вершина на ячейку со сменой знака, квады на рёбрах решётки.
 * Возвращает { positions, normals, indices } (нормали — градиент поля).
 */
export function surfaceNets(field, bounds, cell) {
  const ox = bounds[0], oy = bounds[1], oz = bounds[2];
  const nx = Math.ceil((bounds[3] - ox) / cell) + 1;
  const ny = Math.ceil((bounds[4] - oy) / cell) + 1;
  const nz = Math.ceil((bounds[5] - oz) / cell) + 1;
  const vals = new Float32Array(nx * ny * nz);
  let n = 0;
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    vals[n++] = field(ox + x * cell, oy + y * cell, oz + z * cell);
  }
  const sx = 1, sy = nx, sz = nx * ny;
  const cx = nx - 1, cy = ny - 1, cz = nz - 1;
  const cellVert = new Int32Array(cx * cy * cz).fill(-1);
  const pos = [];
  const cornerOff = CO.map(([a, b, c]) => a * sx + b * sy + c * sz);
  const v = new Float32Array(8);
  for (let z = 0; z < cz; z++) for (let y = 0; y < cy; y++) for (let x = 0; x < cx; x++) {
    const base = x * sx + y * sy + z * sz;
    let mask = 0;
    for (let c = 0; c < 8; c++) { const val = vals[base + cornerOff[c]]; v[c] = val; if (val < 0) mask |= 1 << c; }
    if (mask === 0 || mask === 255) continue;
    let px = 0, py = 0, pz = 0, cnt = 0;
    for (let e = 0; e < 12; e++) {
      const a = EDGES[e][0], b = EDGES[e][1];
      const va = v[a], vb = v[b];
      if ((va < 0) === (vb < 0)) continue;
      const t = va / (va - vb);
      const A = CO[a], B = CO[b];
      px += A[0] + t * (B[0] - A[0]); py += A[1] + t * (B[1] - A[1]); pz += A[2] + t * (B[2] - A[2]);
      cnt++;
    }
    cellVert[x + cx * (y + cy * z)] = pos.length / 3;
    pos.push(ox + (x + px / cnt) * cell, oy + (y + py / cnt) * cell, oz + (z + pz / cnt) * cell);
  }
  const idx = [];
  const cv = (x, y, z) => cellVert[x + cx * (y + cy * z)];
  const quad = (a, b, c, d) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    idx.push(a, b, c, a, c, d);
  };
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const i0 = x * sx + y * sy + z * sz;
    const inside = vals[i0] < 0;
    // ребро вдоль X: ячейки вокруг в порядке против часовой вокруг +X
    if (x < nx - 1 && y > 0 && z > 0 && y < ny - 1 && z < nz - 1 && inside !== (vals[i0 + sx] < 0)) {
      const q0 = cv(x, y - 1, z - 1), q1 = cv(x, y, z - 1), q2 = cv(x, y, z), q3 = cv(x, y - 1, z);
      if (inside) quad(q0, q1, q2, q3); else quad(q0, q3, q2, q1);
    }
    if (y < ny - 1 && x > 0 && z > 0 && x < nx - 1 && z < nz - 1 && inside !== (vals[i0 + sy] < 0)) {
      const q0 = cv(x - 1, y, z - 1), q1 = cv(x - 1, y, z), q2 = cv(x, y, z), q3 = cv(x, y, z - 1);
      if (inside) quad(q0, q1, q2, q3); else quad(q0, q3, q2, q1);
    }
    if (z < nz - 1 && x > 0 && y > 0 && x < nx - 1 && y < ny - 1 && inside !== (vals[i0 + sz] < 0)) {
      const q0 = cv(x - 1, y - 1, z), q1 = cv(x, y - 1, z), q2 = cv(x, y, z), q3 = cv(x - 1, y, z);
      if (inside) quad(q0, q1, q2, q3); else quad(q0, q3, q2, q1);
    }
  }
  // уточнение вершин к поверхности + нормали из градиента
  const positions = new Float32Array(pos);
  const normals = new Float32Array(pos.length);
  const e = cell * 0.5;
  for (let i = 0; i < positions.length; i += 3) {
    let x = positions[i], y = positions[i + 1], z = positions[i + 2];
    for (let it = 0; it < 2; it++) {
      const d = field(x, y, z);
      const gx = field(x + e, y, z) - field(x - e, y, z);
      const gy = field(x, y + e, z) - field(x, y - e, z);
      const gz = field(x, y, z + e) - field(x, y, z - e);
      const g2 = gx * gx + gy * gy + gz * gz;
      if (g2 < 1e-12) break;
      const s = (d * 2 * e) / g2;
      const lim = cell * 0.5;
      x -= Math.max(-lim, Math.min(lim, gx * s));
      y -= Math.max(-lim, Math.min(lim, gy * s));
      z -= Math.max(-lim, Math.min(lim, gz * s));
      if (it === 1) {
        const il = 1 / Math.sqrt(g2);
        normals[i] = gx * il; normals[i + 1] = gy * il; normals[i + 2] = gz * il;
      }
    }
    positions[i] = x; positions[i + 1] = y; positions[i + 2] = z;
  }
  return { positions, normals, indices: idx };
}
