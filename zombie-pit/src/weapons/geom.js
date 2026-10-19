// Геометрические помощники вьюмодели. Координаты оружия: −Z вперёд (к дулу), +Y вверх, +X вправо.
// Профили задаются как [f, u, r?]: f — расстояние вперёд, u — высота, r — радиус скругления угла.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { UV_SCALE } from './textures.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

// Контур со скруглёнными углами (квадратичные кривые)
export function addRounded(path, pts, defR = 0) {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i], a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const r = p[2] ?? defR;
    if (!(r > 0)) { if (i === 0) path.moveTo(p[0], p[1]); else path.lineTo(p[0], p[1]); continue; }
    const da = Math.hypot(a[0] - p[0], a[1] - p[1]), db = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const ra = Math.min(r, da * 0.48), rb = Math.min(r, db * 0.48);
    const x1 = p[0] + ((a[0] - p[0]) / da) * ra, y1 = p[1] + ((a[1] - p[1]) / da) * ra;
    const x2 = p[0] + ((b[0] - p[0]) / db) * rb, y2 = p[1] + ((b[1] - p[1]) / db) * rb;
    if (i === 0) path.moveTo(x1, y1); else path.lineTo(x1, y1);
    path.quadraticCurveTo(p[0], p[1], x2, y2);
  }
  path.closePath();
  return path;
}

export function shape(pts, r = 0, holes) {
  const s = addRounded(new THREE.Shape(), pts, r);
  if (holes) for (const h of holes) s.holes.push(addRounded(new THREE.Path(), h, r));
  return s;
}

function extrude(sh, depth, bevel, seg, cs) {
  return new THREE.ExtrudeGeometry(sh, {
    depth: Math.max(1e-4, depth - 2 * bevel), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel,
    bevelOffset: -bevel, bevelSegments: seg, curveSegments: cs, steps: 1,
  });
}

// Боковой профиль [f,u] → толщина w по X (центр o.x)
export function side(pts, w, o = {}) {
  const b = o.bevel ?? Math.min(0.0012, w * 0.2);
  const g = extrude(shape(pts, o.r ?? 0, o.holes), w, b, o.seg ?? 2, o.cs ?? 6);
  g.rotateY(Math.PI / 2);
  g.translate((o.x ?? 0) - (w - 2 * b) / 2, 0, 0);
  return g;
}

// Поперечное сечение [x,u] вытягивается вдоль оси от f0 до f1
export function prism(pts, f0, f1, o = {}) {
  const b = o.bevel ?? 0;
  const g = extrude(shape(pts, o.r ?? 0, o.holes), f1 - f0, b, o.seg ?? 1, o.cs ?? 4);
  g.translate(0, 0, -f1 + b);
  return g;
}

// Вид сверху [x,f] → по высоте от u0 до u1
export function top(pts, u0, u1, o = {}) {
  const b = o.bevel ?? 0;
  const g = extrude(shape(pts, o.r ?? 0, o.holes), u1 - u0, b, o.seg ?? 1, o.cs ?? 5);
  g.rotateX(-Math.PI / 2);
  g.translate(0, u0 + b, 0);
  return g;
}

// Тело вращения вдоль −Z: профиль [r, f] (f по возрастанию — нормали наружу)
export function lathe(prof, seg = 24, o = {}) {
  const g = new THREE.LatheGeometry(prof.map((p) => new THREE.Vector2(Math.max(0, p[0]), p[1])), seg, o.phi ?? 0);
  g.rotateX(-Math.PI / 2);
  if (o.sx || o.sy) g.scale(o.sx ?? 1, o.sy ?? 1, 1);
  g.translate(o.x ?? 0, o.u ?? 0, 0);
  return g;
}

export function box(w, h, d, r = 0.0008, seg = 2) {
  r = Math.min(r, w * 0.49, h * 0.49, d * 0.49);
  return new RoundedBoxGeometry(w, h, d, seg, Math.max(r, 1e-5));
}

// Цилиндр вдоль X (оси, штифты): от x0 до x1
export function cylX(r, x0, x1, u, f, seg = 12) {
  const g = new THREE.CylinderGeometry(r, r, Math.abs(x1 - x0), seg);
  g.rotateZ(Math.PI / 2);
  g.translate((x0 + x1) / 2, u, -f);
  return g;
}

export function xf(g, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  _e.set(rx, ry, rz); _q.setFromEuler(_e);
  _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
  g.applyMatrix4(_m);
  return g;
}

// Нормали с порогом излома (сглаживание фасок, острые рёбра остаются острыми)
export function creaseNormals(g, angle = 0.8) {
  const pos = g.attributes.position.array, n = pos.length / 3;
  const fn = new Float32Array(n * 3), cos = Math.cos(angle);
  const map = new Map(), keys = new Array(n);
  for (let t = 0; t < n; t += 3) {
    const i0 = t * 3, i1 = i0 + 3, i2 = i0 + 6;
    const ax = pos[i1] - pos[i0], ay = pos[i1 + 1] - pos[i0 + 1], az = pos[i1 + 2] - pos[i0 + 2];
    const bx = pos[i2] - pos[i0], by = pos[i2 + 1] - pos[i0 + 1], bz = pos[i2 + 2] - pos[i0 + 2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    for (let k = 0; k < 3; k++) {
      const v = t + k;
      fn[v * 3] = nx; fn[v * 3 + 1] = ny; fn[v * 3 + 2] = nz;
      const key = Math.round(pos[v * 3] * 1e5) + ',' + Math.round(pos[v * 3 + 1] * 1e5) + ',' + Math.round(pos[v * 3 + 2] * 1e5);
      keys[v] = key;
      let l = map.get(key); if (!l) map.set(key, (l = [])); l.push(v);
    }
  }
  const out = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) {
    const ax = fn[v * 3], ay = fn[v * 3 + 1], az = fn[v * 3 + 2];
    const al = Math.hypot(ax, ay, az) || 1;
    let sx = 0, sy = 0, sz = 0;
    for (const o of map.get(keys[v])) {
      const bx = fn[o * 3], by = fn[o * 3 + 1], bz = fn[o * 3 + 2];
      const bl = Math.hypot(bx, by, bz);
      if (bl < 1e-30) continue;
      if ((ax * bx + ay * by + az * bz) / (al * bl) >= cos) { sx += bx; sy += by; sz += bz; }
    }
    const l = Math.hypot(sx, sy, sz);
    if (l > 1e-30) { out[v * 3] = sx / l; out[v * 3 + 1] = sy / l; out[v * 3 + 2] = sz / l; }
    else { out[v * 3] = ax / al; out[v * 3 + 1] = ay / al; out[v * 3 + 2] = az / al; }
  }
  g.setAttribute('normal', new THREE.BufferAttribute(out, 3));
  return g;
}

// Кубическая проекция UV в метрах (U вдоль ствола на боковых и верхних гранях)
export function boxUV(g, s) {
  const pos = g.attributes.position.array, n = pos.length / 3;
  const uv = new Float32Array(n * 2);
  for (let t = 0; t < n; t += 3) {
    const i0 = t * 3;
    const ax = pos[i0 + 3] - pos[i0], ay = pos[i0 + 4] - pos[i0 + 1], az = pos[i0 + 5] - pos[i0 + 2];
    const bx = pos[i0 + 6] - pos[i0], by = pos[i0 + 7] - pos[i0 + 1], bz = pos[i0 + 8] - pos[i0 + 2];
    const nx = Math.abs(ay * bz - az * by), ny = Math.abs(az * bx - ax * bz), nz = Math.abs(ax * by - ay * bx);
    for (let k = 0; k < 3; k++) {
      const v = t + k, x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
      let u, w;
      if (nx >= ny && nx >= nz) { u = z; w = y; } else if (ny >= nz) { u = z; w = x; } else { u = x; w = y; }
      uv[v * 2] = u * s; uv[v * 2 + 1] = w * s;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

const _c = new THREE.Color();
export function prep(g, color = 0xffffff, crease = 0.8) {
  if (g.index) g = g.toNonIndexed();
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  if (crease > 0) creaseNormals(g, crease);
  else if (!g.attributes.normal) g.computeVertexNormals();
  _c.set(color);
  const n = g.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// Набор деталей, сгруппированных по материалу; build → один меш на материал
export class Parts {
  constructor() { this.groups = new Map(); }
  add(mat, g, color = 0xffffff, crease = 0.8) {
    const p = prep(g, color, crease);
    let l = this.groups.get(mat); if (!l) this.groups.set(mat, (l = [])); l.push(p);
    return p;
  }
  geometry(mat) {
    const l = this.groups.get(mat);
    if (!l || !l.length) return null;
    const g = l.length === 1 ? l[0] : mergeGeometries(l, false);
    boxUV(g, UV_SCALE[mat] ?? 10);
    g.computeBoundingSphere();
    return g;
  }
  // Создаёт меши для всех материалов и добавляет в parent
  build(M, parent, name = '') {
    const out = {};
    for (const key of this.groups.keys()) {
      const mesh = new THREE.Mesh(this.geometry(key), M[key]);
      mesh.name = name + ':' + key; mesh.frustumCulled = false;
      parent.add(mesh); out[key] = mesh;
    }
    return out;
  }
}
