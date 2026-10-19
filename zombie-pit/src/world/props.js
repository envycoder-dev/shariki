// Реквизит: позиция обороны, ящик, прожекторы, бочки с огнём, ограждение, знаки, грузовик, ферма, деревья, заборы.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { RNG, makeNoise3D, clamp, lerp } from '../core/noise.js';
import { TAU, radiusAt } from './shape.js';

// ---------- палитра (линейные множители к текстурам) ----------
const C = {
  W: [1, 1, 1], OLIVE: [0.3, 0.34, 0.2], OLIVE_D: [0.2, 0.23, 0.14], STEEL: [0.55, 0.56, 0.58], DARK: [0.11, 0.11, 0.11],
  BLACK: [0.04, 0.04, 0.04], WOOD: [0.78, 0.74, 0.68], RED: [0.55, 0.06, 0.04], YELLOW: [0.85, 0.55, 0.08],
  BARN: [0.5, 0.17, 0.11], ROPE: [0.55, 0.48, 0.35], CONC: [0.9, 0.9, 0.86], BLUE: [0.12, 0.2, 0.32],
};

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(1, 1, 1);
const Y = new THREE.Vector3(0, 1, 0);
export function M(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx, order = 'XYZ') {
  return new THREE.Matrix4().compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, order)), _s.set(sx, sy, sz));
}

// UV-проекция «коробкой» по нормали треугольника (в метрах × s)
function boxUV(g, s) {
  const P = g.attributes.position.array, n = P.length / 3, uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i += 3) {
    const ux = P[i * 3 + 3] - P[i * 3], uy = P[i * 3 + 4] - P[i * 3 + 1], uz = P[i * 3 + 5] - P[i * 3 + 2];
    const vx = P[i * 3 + 6] - P[i * 3], vy = P[i * 3 + 7] - P[i * 3 + 1], vz = P[i * 3 + 8] - P[i * 3 + 2];
    const nx = Math.abs(uy * vz - uz * vy), ny = Math.abs(uz * vx - ux * vz), nz = Math.abs(ux * vy - uy * vx);
    for (let k = 0; k < 3; k++) {
      const j = i + k, x = P[j * 3], y = P[j * 3 + 1], z = P[j * 3 + 2];
      if (nx >= ny && nx >= nz) { uv[j * 2] = z * s; uv[j * 2 + 1] = y * s; }
      else if (ny >= nz) { uv[j * 2] = x * s; uv[j * 2 + 1] = z * s; }
      else { uv[j * 2] = x * s; uv[j * 2 + 1] = y * s; }
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

// Корзины геометрии по материалам → один меш на материал
class Bins {
  constructor() { this.map = new Map(); }
  add(key, src, matrix, color = C.W, uv = 1) {
    let g = src.index ? src.toNonIndexed() : src.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (typeof uv === 'number' || !g.attributes.uv) boxUV(g, typeof uv === 'number' ? uv : 1);
    else if (Array.isArray(uv)) { const a = g.attributes.uv.array; for (let i = 0; i < a.length; i += 2) { a[i] *= uv[0]; a[i + 1] *= uv[1]; } }
    if (matrix) g.applyMatrix4(matrix);
    const n = g.attributes.position.count, c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { c[i * 3] = color[0]; c[i * 3 + 1] = color[1]; c[i * 3 + 2] = color[2]; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    if (!this.map.has(key)) this.map.set(key, []);
    this.map.get(key).push(g);
  }
  build(mats, root) {
    const out = {};
    for (const [key, list] of this.map) {
      const mesh = new THREE.Mesh(mergeGeometries(list), mats[key]);
      mesh.name = 'props-' + key;
      const noShadow = key === 'lamp' || key === 'lampF' || key === 'fireglow' || key === 'window' || key === 'amber' || key === 'chem' || key === 'decal';
      mesh.castShadow = !noShadow; mesh.receiveShadow = !mats[key].isMeshBasicMaterial;
      root.add(mesh); out[key] = mesh;
    }
    return out;
  }
}

// Набор деталей в локальной системе объекта
function kit(bins, T) {
  return (key, geo, local, color, uv) => bins.add(key, geo, local ? T.clone().multiply(local) : T, color, uv);
}

// Цилиндр между двумя точками
function rodM(a, b) {
  const d = _v2.subVectors(b, a), len = d.length();
  const q = new THREE.Quaternion().setFromUnitVectors(Y, d.clone().normalize());
  return { m: new THREE.Matrix4().compose(a.clone().addScaledVector(d, 0.5), q, new THREE.Vector3(1, 1, 1)), len };
}
// Брус между двумя точками (локальная X — горизонтальна)
function beamM(a, b) {
  const len = a.distanceTo(b);
  const m = new THREE.Matrix4().lookAt(b, a, Y);
  m.setPosition(a.clone().add(b).multiplyScalar(0.5));
  return { m, len };
}

export function buildProps(ctx) {
  const { heightAt, tex, atlas, envMap, root } = ctx;
  const rng = new RNG(4040);
  const bins = new Bins();
  const colliders = [], marks = [], raycast = [];
  const surf = { wood: [], concrete: [] };
  const dyn = { fires: [], floods: [], sprites: [] };
  const proxyRoot = new THREE.Group(); proxyRoot.name = 'raycastProxies'; proxyRoot.visible = false; root.add(proxyRoot);
  const pBox = new THREE.BoxGeometry(1, 1, 1), pCyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
  const pMat = new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true });
  const proxy = (surface, matrix, cyl = false) => {
    const m = new THREE.Mesh(cyl ? pCyl : pBox, pMat);
    m.matrixAutoUpdate = false; m.matrix.copy(matrix); m.userData.surface = surface;
    proxyRoot.add(m); raycast.push(m);
  };
  const col = (x, z, r) => colliders.push({ x, z, r });
  const blockedBy = [];
  const groundMin = (x, z, r) => Math.min(heightAt(x, z), heightAt(x + r, z), heightAt(x - r, z), heightAt(x, z + r), heightAt(x, z - r));
  const rect = (name) => atlas.rect(name);
  const decalGeo = (w, h, name) => {
    const g = new THREE.PlaneGeometry(w, h), r = rect(name), uv = g.attributes.uv.array;
    for (let i = 0; i < uv.length; i += 2) { uv[i] = lerp(r[0], r[2], uv[i]); uv[i + 1] = lerp(r[1], r[3], uv[i + 1]); }
    return g;
  };
  const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const CY = (rt, rb, h, s = 10, open = false) => new THREE.CylinderGeometry(rt, rb, h, s, 1, open);

  // ================= мешки с песком (U-образная позиция) =================
  const bagGeo = (() => {
    const g = new THREE.BoxGeometry(1, 1, 1, 10, 4, 6);
    g.deleteAttribute('uv'); g.deleteAttribute('normal');
    const m = mergeVertices(g), p = m.attributes.position, nz = makeNoise3D(31);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) * 2, y = p.getY(i) * 2, z = p.getZ(i) * 2;
      const ax = Math.abs(x), az = Math.abs(z), ay = Math.abs(y);
      const pillow = (1 - Math.pow(ax, 4) * 0.55) * (1 - Math.pow(az, 4) * 0.62);
      let yy = y * pillow, xx = x * (1 - 0.06 * ay * ay), zz = z * (1 - 0.16 * ay * ay) * (1 - 0.08 * Math.pow(ax, 6));
      if (x > 0.72) { const t = (x - 0.72) / 0.28; zz *= 1 - 0.32 * t; yy *= 1 - 0.38 * t; }
      const n = 1 + 0.06 * nz(x * 1.5, y * 1.5, z * 1.5);
      p.setXYZ(i, xx * 0.3 * n, (yy * 0.085 + (y < 0 ? 0.012 * (1 - ax * ax) : 0)) * n, zz * 0.17 * n);
    }
    m.computeVertexNormals();
    const uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) { uv[i * 2] = p.getX(i) * 2.4; uv[i * 2 + 1] = (p.getZ(i) + p.getY(i) * 1.5) * 2.4; }
    m.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return m;
  })();
  const BAG_LINES = [
    [[-4.4, 18.6], [-5.8, 19.9], [-5.95, 22.3]],
    [[-5.95, 23.6], [-5.85, 26.9], [-5.2, 27.5], [-1.7, 27.65]],
    [[-0.4, 27.65], [5.2, 27.5], [5.85, 26.9], [5.95, 19.9], [4.5, 18.6]],
  ];
  const bagT = [];
  const bagColor = () => { const k = rng.float(); return k < 0.6 ? [0.95, 0.85, 0.62] : k < 0.85 ? [0.62, 0.66, 0.45] : [0.7, 0.6, 0.46]; };
  for (const pl of BAG_LINES) {
    const segs = []; let total = 0;
    for (let i = 0; i < pl.length - 1; i++) {
      const [ax, az] = pl[i], [bx, bz] = pl[i + 1], len = Math.hypot(bx - ax, bz - az);
      segs.push({ ax, az, dx: (bx - ax) / len, dz: (bz - az) / len, len, s0: total }); total += len;
      // прокси и коллайдеры
      const mx = (ax + bx) / 2, mz = (az + bz) / 2, yaw = Math.atan2(-(bz - az), bx - ax);
      proxy('sandbag', M(mx, heightAt(mx, mz) + 0.45, mz, 0, yaw, 0, len + 0.3, 0.92, 0.78));
    }
    for (let s = 0; s <= total; s += 0.45) {
      const sg = segs.find((q) => s <= q.s0 + q.len + 1e-6) || segs[segs.length - 1], t = s - sg.s0;
      col(sg.ax + sg.dx * t, sg.az + sg.dz * t, 0.45);
    }
    marks.push({ pts: pl, w: 1.3, b: 0.8, r: 0.55, blur: 0.35 });
    const at = (s) => { const sg = segs.find((q) => s <= q.s0 + q.len + 1e-6) || segs[segs.length - 1], t = s - sg.s0; return [sg.ax + sg.dx * t, sg.az + sg.dz * t, sg.dx, sg.dz]; };
    for (let r = 0; r < 6; r++) {
      const off = (r % 2) * 0.29, sides = r < 4 ? [-0.19, 0.19] : [rng.range(-0.04, 0.04)];
      for (let s = 0.3 + off; s < total - 0.12; s += 0.58) {
        const [x0, z0, tx, tz] = at(s);
        for (const sd of sides) {
          const x = x0 - tz * sd + rng.range(-0.025, 0.025), z = z0 + tx * sd + rng.range(-0.025, 0.025);
          const yaw = Math.atan2(-tz, tx) + rng.range(-0.07, 0.07) + (rng.chance(0.5) ? Math.PI : 0);
          const y = heightAt(x, z) + 0.06 + r * 0.148;
          bagT.push([M(x, y, z, rng.range(-0.04, 0.04), yaw, rng.range(-0.04, 0.04), rng.range(0.94, 1.06), rng.range(0.9, 1.05), rng.range(0.95, 1.05)), bagColor()]);
        }
      }
    }
  }
  // россыпь отдельных мешков
  for (const [x, z, yaw] of [[-3.2, 18.2, 0.4], [2.6, 18.4, -0.3], [-7.2, 24.8, 1.2], [7.1, 23.2, 2.0], [-6.6, 18.9, 0.9]]) {
    bagT.push([M(x, heightAt(x, z) + 0.07, z, rng.range(-0.1, 0.1), yaw, rng.range(-0.15, 0.15)), bagColor()]);
  }
  {
    const im = new THREE.InstancedMesh(bagGeo, ctx.mats.fabric, bagT.length);
    const c = new THREE.Color();
    bagT.forEach(([m, cl], i) => { im.setMatrixAt(i, m); im.setColorAt(i, c.setRGB(cl[0], cl[1], cl[2])); });
    im.castShadow = true; im.receiveShadow = true; im.name = 'sandbags';
    im.computeBoundingSphere();
    root.add(im);
    dyn.sandbagCount = bagT.length;
  }

  // ================= ящик снабжения, патроны, генератор =================
  const CRATE = { x: 3.5, z: 25, yaw: -2.28 };
  {
    const { x, z, yaw } = CRATE, y = groundMin(x, z, 0.6);
    const k = kit(bins, M(x, y, z, 0, yaw, 0));
    k('paint', B(1.2, 0.68, 0.74), M(0, 0.36, 0), C.OLIVE, 1.2);
    for (const yy of [0.03, 0.69]) for (const zz of [-0.37, 0.37]) k('paint', B(1.25, 0.065, 0.065), M(0, yy, zz), C.OLIVE_D, 1.5);
    for (const yy of [0.03, 0.69]) for (const xx of [-0.6, 0.6]) k('paint', B(0.065, 0.065, 0.8), M(xx, yy, 0), C.OLIVE_D, 1.5);
    for (const xx of [-0.6, 0.6]) for (const zz of [-0.37, 0.37]) k('paint', B(0.065, 0.72, 0.065), M(xx, 0.36, zz), C.OLIVE_D, 1.5);
    for (const yy of [0.25, 0.47]) for (const zz of [-0.371, 0.371]) k('paint', B(1.14, 0.01, 0.004), M(0, yy, zz), C.BLACK);
    k('paint', B(1.16, 0.004, 0.01), M(0, 0.681, 0), C.BLACK);
    for (const xx of [-0.6, 0.6]) for (const yy of [0.03, 0.69]) for (const zz of [-0.37, 0.37]) k('metal', B(0.1, 0.1, 0.1), M(xx, yy, zz), C.DARK, 3);
    for (const xx of [-0.33, 0.33]) k('metal', B(0.07, 0.09, 0.025), M(xx, 0.6, 0.385), C.DARK, 3);
    for (const xx of [-0.63, 0.63]) k('fabric', new THREE.TorusGeometry(0.075, 0.012, 5, 10, Math.PI), M(xx, 0.48, 0, Math.PI, Math.PI / 2, 0), C.ROPE, [2, 2]);
    k('decal', decalGeo(0.95, 0.36, 'crate'), M(0, 0.37, 0.374), C.W, 'keep');
    k('decal', decalGeo(0.95, 0.36, 'crate'), M(0, 0.37, -0.374, 0, Math.PI, 0), C.W, 'keep');
    k('decal', decalGeo(0.72, 0.27, 'crate'), M(0, 0.7245, 0, -Math.PI / 2, 0, 0), C.W, 'keep');
    k('chem', CY(0.012, 0.012, 0.16, 6), M(0.32, 0.737, 0.12, 0, 0.6, Math.PI / 2), C.W, 1);
    const cs = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.glow, color: new THREE.Color(0.15, 1.6, 0.4), blending: THREE.AdditiveBlending, depthWrite: false }));
    cs.position.set(x + 0.32 * Math.cos(yaw) + 0.12 * Math.sin(yaw), y + 0.75, z - 0.32 * Math.sin(yaw) + 0.12 * Math.cos(yaw)); cs.scale.setScalar(0.7);
    root.add(cs);
    col(x, z, 0.78);
    proxy('wood', M(x, y + 0.36, z, 0, yaw, 0, 1.25, 0.72, 0.8));
    marks.push({ x, z, rect: [1.8, 1.4], rot: yaw, b: 0.6, r: 0.4, blur: 0.3 });
  }
  const ammo = (x, z, yaw, stack) => {
    const y0 = groundMin(x, z, 0.25);
    for (let s = 0; s < stack; s++) {
      const k = kit(bins, M(x, y0 + s * 0.215, z, 0, yaw + rng.range(-0.1, 0.1), 0));
      k('paint', B(0.48, 0.19, 0.2), M(0, 0.095, 0), C.OLIVE_D, 3);
      k('paint', B(0.5, 0.025, 0.215), M(0, 0.2, 0), C.OLIVE_D, 3);
      k('metal', new THREE.TorusGeometry(0.05, 0.007, 4, 8, Math.PI), M(0, 0.212, 0), C.DARK);
      k('decal', decalGeo(0.42, 0.105, 'ammo'), M(0, 0.1, 0.1015), C.W, 'keep');
    }
    col(x, z, 0.3);
    proxy('metal', M(x, y0 + stack * 0.11, z, 0, yaw, 0, 0.5, stack * 0.215, 0.22));
  };
  ammo(4.95, 26.3, -2.0, 2); ammo(2.15, 26.5, -2.6, 1); ammo(5.15, 23.9, -1.4, 1);
  {
    const x = -3.6, z = 26.1, yaw = 0.4, y = groundMin(x, z, 0.4);
    const k = kit(bins, M(x, y, z, 0, yaw, 0));
    const fr = [[-0.34, -0.24], [0.34, -0.24], [0.34, 0.24], [-0.34, 0.24]];
    for (const [a, b] of fr) k('metal', CY(0.017, 0.017, 0.52, 6), M(a, 0.26, b), C.DARK);
    for (const yy of [0.02, 0.52]) {
      for (const b of [-0.24, 0.24]) k('metal', CY(0.017, 0.017, 0.68, 6), M(0, yy, b, 0, 0, Math.PI / 2), C.DARK);
      for (const a of [-0.34, 0.34]) k('metal', CY(0.017, 0.017, 0.48, 6), M(a, yy, 0, Math.PI / 2, 0, 0), C.DARK);
    }
    k('metal', B(0.3, 0.27, 0.3), M(-0.1, 0.18, 0), C.DARK, 3);
    k('paint', CY(0.12, 0.12, 0.26, 14), M(0.17, 0.17, 0, 0, 0, Math.PI / 2), C.RED, 2);
    k('paint', B(0.52, 0.13, 0.36), M(0, 0.45, 0), C.YELLOW, 2);
    k('metal', CY(0.035, 0.035, 0.04, 8), M(0.12, 0.535, 0.08), C.BLACK);
    k('metal', CY(0.045, 0.045, 0.22, 8), M(-0.18, 0.33, -0.17, 0, 0, Math.PI / 2), C.STEEL);
    k('decal', decalGeo(0.4, 0.05, 'gen'), M(0, 0.45, 0.181), C.W, 'keep');
    col(x, z, 0.5);
    proxy('metal', M(x, y + 0.27, z, 0, yaw, 0, 0.7, 0.55, 0.5));
    // канистра
    const kx = -2.85, kz = 26.75, ky = heightAt(kx, kz);
    const kk = kit(bins, M(kx, ky, kz, 0, 1.1, 0));
    kk('paint', B(0.34, 0.45, 0.16), M(0, 0.225, 0), C.RED, 3);
    kk('paint', B(0.12, 0.05, 0.04), M(0.08, 0.47, 0), C.RED, 3);
    proxy('metal', M(kx, ky + 0.22, kz, 0, 1.1, 0, 0.34, 0.45, 0.16));
    marks.push({ x, z, rad: 0.9, b: 0.5, r: 0.5 });
  }

  // ================= настил из досок внутри позиции =================
  {
    const a = [-1.05, 27.9], b = [-0.2, 19.9];
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz), yaw = Math.atan2(dx, dz);
    for (let s = 0.15; s < len; s += 0.3) {
      const t = s / len, x = a[0] + dx * t + rng.range(-0.03, 0.03), z = a[1] + dz * t;
      bins.add('wood', B(1.05 + rng.range(-0.08, 0.08), 0.03, 0.22), M(x, heightAt(x, z) + 0.012, z, rng.range(-0.02, 0.02), yaw + rng.range(-0.06, 0.06), rng.range(-0.02, 0.02)), [0.62, 0.57, 0.5], 0.7);
    }
    surf.wood.push({ x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2, hw: 0.6, hl: len / 2, yaw });
    marks.push({ pts: [a, b], w: 2.0, g: 0.75, blur: 0.5 });
  }

  // ================= бетонные плиты у грузовика =================
  for (const [x, z, yaw] of [[-16.4, 24.1, 0.5], [-13.7, 22.4, 0.42]]) {
    bins.add('concrete', B(3.0, 0.14, 1.75), M(x, heightAt(x, z) - 0.035, z, rng.range(-0.015, 0.015), yaw, rng.range(-0.015, 0.015)), C.CONC, 0.5);
    surf.concrete.push({ x, z, hw: 0.85, hl: 1.5, yaw: yaw + Math.PI / 2 });
    marks.push({ x, z, rect: [3.4, 2.1], rot: yaw, b: 0.3, r: 0.4 });
  }

  // ================= прожекторные вышки =================
  const TOWERS = [
    { x: -17.5, z: 6.5, aim: [-3, -0.5, 0.5], flick: false },
    { x: 16.8, z: 8.5, aim: [3, -0.5, -1.5], flick: false },
    { x: -6, z: -21, aim: [0.5, -0.5, 3.5], flick: true },
  ];
  for (const T of TOWERS) {
    const y0 = groundMin(T.x, T.z, 0.8), H = 6.2, b0 = 0.7, b1 = 0.36;
    const k = kit(bins, M(T.x, y0, T.z));
    const corner = (i, t) => { const sx = i === 0 || i === 3 ? -1 : 1, sz = i < 2 ? -1 : 1, w = lerp(b0, b1, t / H); return new THREE.Vector3(sx * w, t, sz * w); };
    for (let i = 0; i < 4; i++) { const { m, len } = rodM(corner(i, 0), corner(i, H)); k('metal', CY(0.04, 0.045, len, 8), m, C.STEEL, [1, 3]); }
    const lv = 5;
    for (let l = 0; l <= lv; l++) {
      const y = l * H / lv;
      for (let i = 0; i < 4; i++) {
        const a = corner(i, y), b = corner((i + 1) % 4, y);
        const r1 = rodM(a, b); k('metal', CY(0.022, 0.022, r1.len, 6), r1.m, C.STEEL);
        if (l < lv) {
          const a2 = corner(i, y + H / lv), b2 = corner((i + 1) % 4, y + H / lv);
          const d1 = rodM(a, b2), d2 = rodM(b, a2);
          k('metal', CY(0.017, 0.017, d1.len, 5), d1.m, C.STEEL); k('metal', CY(0.017, 0.017, d2.len, 5), d2.m, C.STEEL);
        }
      }
    }
    k('metal', B(1.0, 0.05, 1.0), M(0, H, 0), C.DARK, 2);
    for (let i = 0; i < 4; i++) {
      const a = corner(i, H), b = corner((i + 1) % 4, H);
      a.multiplyScalar(1.35).setY(H + 0.55); b.multiplyScalar(1.35).setY(H + 0.55);
      const r = rodM(a, b); k('metal', CY(0.018, 0.018, r.len, 5), r.m, C.STEEL);
      const p = rodM(new THREE.Vector3(a.x, H, a.z), a); k('metal', CY(0.018, 0.018, p.len, 5), p.m, C.STEEL);
    }
    for (let i = 0; i < 4; i++) { const c = corner(i, 0); k('concrete', B(0.38, 0.3, 0.38), M(c.x, 0.1, c.z), C.CONC, 1); }
    // головы прожекторов
    const L = new THREE.Vector3(T.x, y0 + H + 0.8, T.z), aim = new THREE.Vector3(...T.aim);
    const dir = aim.clone().sub(L).normalize();
    const yaw = Math.atan2(dir.x, dir.z), pitch = -Math.asin(dir.y);
    const hk = kit(bins, M(T.x, y0 + H + 0.8, T.z, pitch, yaw, 0, 1, 1, 1, 'YXZ'));
    k('metal', CY(0.03, 0.03, 0.8, 6), M(0, H + 0.4, 0), C.DARK);
    hk('metal', B(1.5, 0.06, 0.06), M(0, -0.22, -0.05), C.DARK, 2);
    const lensKey = T.flick ? 'lampF' : 'lamp';
    const flood = { spot: null, cone: null, sprites: [], flick: T.flick, base: 2600, f: 1, state: 0, timer: 0 };
    for (const sx of [-0.45, 0.45]) {
      hk('paint', B(0.44, 0.34, 0.17), M(sx, 0, -0.03), C.DARK, 3);
      for (let f = 0; f < 4; f++) hk('metal', B(0.4, 0.012, 0.08), M(sx, -0.12 + f * 0.08, -0.15), C.DARK);
      hk('metal', B(0.04, 0.3, 0.05), M(sx - 0.24, -0.08, -0.03), C.DARK);
      hk('metal', B(0.04, 0.3, 0.05), M(sx + 0.24, -0.08, -0.03), C.DARK);
      hk(lensKey, new THREE.PlaneGeometry(0.38, 0.28), M(sx, 0, 0.056), C.W, 1);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.glow, color: new THREE.Color(2.2, 2.3, 2.6), blending: THREE.AdditiveBlending, depthWrite: false }));
      const lp = new THREE.Vector3(sx, 0, 0.12).applyMatrix4(M(T.x, y0 + H + 0.8, T.z, pitch, yaw, 0, 1, 1, 1, 'YXZ'));
      sp.position.copy(lp); sp.scale.setScalar(1.8); root.add(sp); flood.sprites.push(sp);
    }
    // кабель вниз
    { const r = rodM(new THREE.Vector3(b1 + 0.05, H + 0.6, b1), new THREE.Vector3(b0 + 0.08, 0.05, b0)); k('dark', CY(0.012, 0.012, r.len, 4), r.m, C.BLACK); }
    const spot = new THREE.SpotLight(0xe2ebff, flood.base, 0, 0.4, 0.55, 2);
    spot.position.copy(L).addScaledVector(dir, 0.2); spot.target.position.copy(aim);
    root.add(spot, spot.target);
    flood.spot = spot;
    // объёмный конус
    const len = L.distanceTo(aim) * 0.92, rad = Math.tan(0.4) * len * 0.85;
    const cg = new THREE.ConeGeometry(rad, len, 28, 1, true);
    const cm = new THREE.ShaderMaterial({
      uniforms: { uI: { value: 1 }, uTime: ctx.timeU, tNoise: { value: tex.cloud }, uCol: { value: new THREE.Color(0.75, 0.82, 1.0) } },
      vertexShader: `varying float vT; varying vec3 vW; varying vec3 vN;
        void main(){ vT = uv.y; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform float uI, uTime; uniform vec3 uCol; uniform sampler2D tNoise; varying float vT; varying vec3 vW; varying vec3 vN;
        void main(){
          float t = 1.0 - vT;
          vec3 V = normalize(cameraPosition - vW);
          float edge = pow(abs(dot(V, normalize(vN))), 1.6);
          float n = texture2D(tNoise, vec2(vW.x * 0.06 + vW.z * 0.04 + uTime * 0.008, vW.y * 0.08 - uTime * 0.02)).r;
          float a = pow(1.0 - t, 1.7) * smoothstep(0.0, 0.05, t) * edge * (0.55 + 0.7 * n);
          float fade = smoothstep(0.5, 3.0, distance(cameraPosition, vW));
          gl_FragColor = vec4(uCol * a * uI * 0.07 * fade, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const cone = new THREE.Mesh(cg, cm);
    cone.quaternion.setFromUnitVectors(Y, dir.clone().negate());
    cone.position.copy(L).addScaledVector(dir, len / 2 + 0.1);
    cone.renderOrder = 8;
    root.add(cone);
    flood.cone = cone;
    dyn.floods.push(flood);
    col(T.x, T.z, 1.0);
    proxy('metal', M(T.x, y0 + H / 2, T.z, 0, 0, 0, 1.3, H, 1.3));
    marks.push({ x: T.x, z: T.z, rad: 1.8, r: 0.65, b: 0.35, blur: 0.8 });
  }

  // ================= бочки (две горят, одна тлеет) + декоративные =================
  const drumGeo = (() => {
    const prof = [[0.0, 0.004], [0.27, 0.004], [0.284, 0.014], [0.288, 0.06], [0.294, 0.075], [0.288, 0.09], [0.288, 0.285], [0.296, 0.3], [0.288, 0.315],
      [0.288, 0.565], [0.296, 0.58], [0.288, 0.595], [0.288, 0.79], [0.294, 0.805], [0.288, 0.82], [0.29, 0.866], [0.297, 0.876], [0.292, 0.886], [0.281, 0.88], [0.278, 0.84], [0.278, 0.72]];
    const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 22);
    return g;
  })();
  const BARRELS = [
    { x: -7.2, z: 15.8, fire: 1, light: true },
    { x: 13.6, z: -13.9, fire: 1, light: true },
    { x: -15.6, z: -11.6, fire: 0.3, light: false },
  ];
  for (const b of BARRELS) {
    const y = groundMin(b.x, b.z, 0.3) - 0.02, yaw = rng.range(0, TAU);
    const k = kit(bins, M(b.x, y, b.z, rng.range(-0.03, 0.03), yaw, rng.range(-0.03, 0.03)));
    k('rust', drumGeo, null, C.W, [3, 1.6]);
    k('dark', new THREE.CircleGeometry(0.278, 16), M(0, 0.7, 0, -Math.PI / 2, 0, 0), C.BLACK);
    k('fireglow', new THREE.CircleGeometry(0.25, 16), M(0, 0.705, 0, -Math.PI / 2, 0, 0), C.W);
    for (let h = 0; h < 12; h++) {
      const a = h / 12 * TAU + rng.range(-0.1, 0.1), hy = rng.range(0.1, 0.3);
      k('fireglow', new THREE.CircleGeometry(rng.range(0.016, 0.026), 6), M(Math.sin(a) * 0.291, hy, Math.cos(a) * 0.291, 0, a, 0), C.W);
    }
    dyn.fires.push({ pos: new THREE.Vector3(b.x, y + 0.72, b.z), strength: b.fire, light: b.light });
    col(b.x, b.z, 0.38);
    proxy('metal', M(b.x, y + 0.44, b.z, 0, 0, 0, 0.6, 0.88, 0.6), true);
    marks.push({ x: b.x, z: b.z, rad: 1.5, r: 0.75, b: 0.45, blur: 0.6 });
  }
  for (const [x, z, tipped, cl] of [[-4.75, 27.0, false, C.BLUE], [9.6, 30.6, true, C.RED], [-21.5, 35.2, false, C.OLIVE]]) {
    const y = groundMin(x, z, 0.3);
    const m = tipped ? M(x, y + 0.29, z, 0, 0.7, Math.PI / 2) : M(x, y - 0.02, z, 0, rng.range(0, 6), 0);
    bins.add('rust', drumGeo, m, [cl[0] * 2.4, cl[1] * 2.4, cl[2] * 2.4], [3, 1.6]);
    bins.add('dark', new THREE.CircleGeometry(0.28, 16), m.clone().multiply(M(0, 0.85, 0, -Math.PI / 2, 0, 0)), C.DARK);
    col(x, z, tipped ? 0.45 : 0.36);
    proxy('metal', tipped ? M(x, y + 0.29, z, 0, 0.7, Math.PI / 2, 0.6, 0.88, 0.6) : M(x, y + 0.44, z, 0, 0, 0, 0.6, 0.88, 0.6), true);
  }

  // ================= кольцо ограждения: бетонные блоки, полицейские барьеры, лента =================
  const RING_R = 15.4;
  const jerseyGeo = (() => {
    const s = new THREE.Shape();
    [[-0.3, 0], [0.3, 0], [0.3, 0.08], [0.18, 0.26], [0.09, 0.81], [-0.09, 0.81], [-0.18, 0.26], [-0.3, 0.08]].forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 1.96, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.015, bevelSegments: 1, steps: 1 });
    g.translate(0, 0, -0.98);
    return g;
  })();
  const occupied = [...TOWERS.map((t) => [t.x, t.z, 2.2]), ...BARRELS.map((b) => [b.x, b.z, 1.4])];
  const isFree = (x, z, r) => occupied.every(([ox, oz, or]) => Math.hypot(x - ox, z - oz) > r + or);
  const angFront = (a) => Math.abs(Math.atan2(Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2)));
  let a = 0.12;
  while (a < TAU - 0.12) {
    if (angFront(a) < 0.46) { a += 0.06; continue; }
    const roll = rng.float();
    if (roll < 0.5) {
      const n = rng.int(2, 3);
      for (let i = 0; i < n; i++) {
        const aa = a + (i + 0.5) * 2.02 / RING_R, rr = RING_R + rng.range(-0.15, 0.25);
        const x = Math.cos(aa) * rr, z = Math.sin(aa) * rr;
        if (!isFree(x, z, 1.2)) continue;
        const yaw = -aa + rng.range(-0.07, 0.07), y = groundMin(x, z, 0.9) - 0.03;
        const T = M(x, y, z, 0, yaw, rng.range(-0.015, 0.015));
        const k = kit(bins, T), tint = rng.range(0.85, 1.05);
        k('concrete', jerseyGeo, null, [C.CONC[0] * tint, C.CONC[1] * tint, C.CONC[2] * tint], 0.55);
        for (const sd of [1, -1]) k('decal', decalGeo(1.7, 0.13, rng.chance(0.5) ? 'stripeRW' : 'stripeYB'), M(sd * 0.128, 0.6, 0, 0, sd * Math.PI / 2, 0).multiply(M(0, 0, 0, -0.158 * 0, 0, 0)).multiply(M(0, 0, 0, -0.16, 0, 0)), C.W, 'keep');
        for (const dz of [-0.66, 0, 0.66]) col(x + Math.sin(yaw) * dz, z + Math.cos(yaw) * dz, 0.36);
        proxy('concrete', M(x, y + 0.4, z, 0, yaw, 0, 0.55, 0.81, 2.0));
        occupied.push([x, z, 1.0]);
      }
      a += n * 2.02 / RING_R + rng.range(2.6, 4.6) / RING_R;
    } else if (roll < 0.8) {
      const aa = a + 0.8 / RING_R, rr = RING_R + rng.range(-0.2, 0.2), x = Math.cos(aa) * rr, z = Math.sin(aa) * rr;
      if (isFree(x, z, 1.0)) {
        const yaw = Math.atan2(-Math.cos(aa), -Math.sin(aa)) + rng.range(-0.12, 0.12), y = groundMin(x, z, 0.7);
        const k = kit(bins, M(x, y, z, 0, yaw, 0));
        for (const yy of [0.96, 0.7]) {
          k('wood', B(1.6, 0.18, 0.025), M(0, yy, 0), C.W, 1);
          for (const sd of [1, -1]) k('decal', decalGeo(1.58, 0.17, 'stripeRW'), M(0, yy, sd * 0.0135, 0, sd > 0 ? 0 : Math.PI, 0), C.W, 'keep');
        }
        for (const lx of [-0.66, 0.66]) {
          for (const lz of [-0.3, 0.3]) { const r = rodM(new THREE.Vector3(lx, 0, lz), new THREE.Vector3(lx, 1.02, 0)); k('metal', CY(0.018, 0.018, r.len, 6), r.m, C.STEEL); }
          k('metal', B(0.04, 0.03, 0.66), M(lx, 0.015, 0), C.STEEL);
        }
        k('paint', B(0.1, 0.1, 0.06), M(0.55, 1.1, 0), C.DARK, 3);
        k('amber', new THREE.CylinderGeometry(0.045, 0.045, 0.02, 10), M(0.55, 1.1, 0.035, Math.PI / 2, 0, 0), C.W);
        for (const dx of [-0.6, 0.6]) col(x + Math.cos(yaw) * dx, z - Math.sin(yaw) * dx, 0.32);
        proxy('wood', M(x, y + 0.55, z, 0, yaw, 0, 1.6, 1.1, 0.35));
        occupied.push([x, z, 1.0]);
      }
      a += 1.6 / RING_R + rng.range(2.4, 4.4) / RING_R;
    } else a += rng.range(2.0, 3.6) / RING_R;
  }
  // столбики и лента
  const TAPE_R = 16.3, tapeP = [], tapeU = [], tapeF = [], tapeI = [];
  const posts = [];
  for (let i = 0, n = Math.round(TAU * TAPE_R / 3.2); i < n; i++) {
    const aa = i / n * TAU + rng.range(-0.02, 0.02), rr = TAPE_R + rng.range(-0.2, 0.2);
    const x = Math.cos(aa) * rr, z = Math.sin(aa) * rr;
    if (!isFree(x, z, 0.2)) { posts.push(null); continue; }
    const y = heightAt(x, z), lx = rng.range(-0.06, 0.06), lz = rng.range(-0.06, 0.06);
    if (rng.chance(0.7)) bins.add('metal', CY(0.016, 0.018, 1.1, 6), M(x, y + 0.5, z, lx, 0, lz), [0.5, 0.15, 0.12], 2);
    else bins.add('wood', B(0.05, 1.1, 0.05), M(x, y + 0.5, z, lx, rng.range(0, 3), lz), C.WOOD, 2);
    posts.push(new THREE.Vector3(x + lz * 1.0, y + 0.98, z - lx * 1.0));
  }
  let tapeLen = 0;
  const ribbon = (pts, flut) => {
    const base = tapeP.length / 3;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[Math.min(i + 1, pts.length - 1)], o = pts[Math.max(i - 1, 0)];
      const d = _v.subVectors(q, o).normalize();
      const tw = Math.sin(i * 0.9 + p.x) * 0.5;
      const side = new THREE.Vector3().crossVectors(d, Y).normalize();
      const w = new THREE.Vector3().crossVectors(side, d).normalize().multiplyScalar(Math.cos(tw)).addScaledVector(side, Math.sin(tw)).multiplyScalar(0.026);
      if (i > 0) tapeLen += p.distanceTo(pts[i - 1]);
      tapeP.push(p.x - w.x, p.y - w.y, p.z - w.z, p.x + w.x, p.y + w.y, p.z + w.z);
      tapeU.push(tapeLen / 1.1, 0, tapeLen / 1.1, 1);
      tapeF.push(flut[i], flut[i]);
      if (i < pts.length - 1) { const a0 = base + i * 2; tapeI.push(a0, a0 + 1, a0 + 2, a0 + 1, a0 + 3, a0 + 2); }
    }
  };
  for (let i = 0; i < posts.length; i++) {
    const A = posts[i], Bp = posts[(i + 1) % posts.length];
    if (!A || !Bp) continue;
    const mid = A.clone().add(Bp).multiplyScalar(0.5), am = Math.atan2(mid.z, mid.x);
    const torn = rng.chance(0.14) || (angFront(am) < 0.12);
    if (!torn) {
      const pts = [], fl = [], sag = rng.range(0.05, 0.22);
      for (let s = 0; s <= 12; s++) { const t = s / 12; pts.push(A.clone().lerp(Bp, t).add(_v2.set(0, -sag * 4 * t * (1 - t), 0))); fl.push(4 * t * (1 - t)); }
      ribbon(pts, fl);
    } else {
      for (const [P0, P1] of [[A, Bp], [Bp, A]]) {
        const dir = P1.clone().sub(P0).setY(0).normalize(), L = rng.range(0.35, 0.95), pts = [], fl = [];
        for (let s = 0; s <= 6; s++) { const t = s / 6; pts.push(P0.clone().addScaledVector(dir, t * 0.25 * L).add(_v2.set(0, -t * L, 0))); fl.push(t); }
        ribbon(pts, fl);
      }
    }
  }
  {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(tapeP, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(tapeU, 2));
    g.setAttribute('aFlut', new THREE.Float32BufferAttribute(tapeF, 1));
    g.setIndex(tapeI); g.computeVertexNormals();
    const m = new THREE.MeshStandardMaterial({ map: tex.tape, side: THREE.DoubleSide, roughness: 0.55 });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = ctx.timeU;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aFlut; uniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
float ph = position.x * 1.7 + position.z * 1.3;
transformed += vec3(sin(uTime * 7.0 + ph) * 0.025, sin(uTime * 9.0 + ph * 1.3) * 0.03, cos(uTime * 6.0 + ph) * 0.025) * aFlut;`);
    };
    m.customProgramCacheKey = () => 'yama-tape';
    const tape = new THREE.Mesh(g, m); tape.castShadow = false; tape.receiveShadow = true; tape.name = 'tape';
    root.add(tape);
  }

  // ================= знаки =================
  const SIGNS = [
    { x: 3.7, z: 17.1, face: [0, 22], key: 'sign1', w: 0.8, h: 0.5, post: 1.55 },
    { x: -12.9, z: 11.9, face: 'out', key: 'sign2', w: 1.0, h: 0.62, post: 1.45, two: true },
    { x: 13.4, z: 10.6, face: [6, 22], key: 'sign3', w: 0.9, h: 0.34, post: 1.55 },
    { x: 7.8, z: -16.9, face: 'out', key: 'sign2', w: 1.0, h: 0.62, post: 1.45, two: true },
    { x: -16.4, z: -5.4, face: 'out', key: 'sign1', w: 0.8, h: 0.5, post: 1.5 },
  ];
  for (const s of SIGNS) {
    const dx = s.face === 'out' ? s.x : s.face[0] - s.x, dz = s.face === 'out' ? s.z : s.face[1] - s.z;
    const yaw = Math.atan2(dx, dz), y = heightAt(s.x, s.z), lean = rng.range(-0.05, 0.05);
    const k = kit(bins, M(s.x, y, s.z, rng.range(-0.03, 0.03), yaw, lean));
    const top = s.post + s.h / 2;
    k('metal', B(s.w + 0.04, s.h + 0.04, 0.015), M(0, top, 0), [0.35, 0.36, 0.37], 2);
    k('decal', decalGeo(s.w, s.h, s.key), M(0, top, 0.0085), C.W, 'keep');
    for (const px of s.two ? [-s.w * 0.38, s.w * 0.38] : [0]) k('metal', CY(0.024, 0.026, top + 0.15, 8), M(px, (top + 0.15) / 2, -0.03), [0.42, 0.42, 0.44], 2);
    proxy('metal', M(s.x, y + top, s.z, 0, yaw, 0, s.w + 0.04, s.h + 0.04, 0.05));
  }
  {
    const aa = 2.55, R = radiusAt(aa), rr = R + 3.4, x = Math.cos(aa) * rr, z = Math.sin(aa) * rr, y = heightAt(x, z);
    const k = kit(bins, M(x, y + 0.03, z, -Math.PI / 2 + 0.08, 0.7, 0.05));
    k('metal', B(0.84, 0.54, 0.015), null, [0.35, 0.36, 0.37], 2);
    k('decal', decalGeo(0.8, 0.5, 'sign1'), M(0, 0, 0.0085), C.W, 'keep');
    k('metal', CY(0.024, 0.026, 1.4, 8), M(0.1, -0.9, -0.03, 0, 0, 0.3), [0.42, 0.42, 0.44], 2);
  }

  // ================= военный грузовик =================
  const TRUCK = { x: -20.5, z: 29.8, yaw: 0.45 };
  {
    const { x, z, yaw } = TRUCK, y = groundMin(x, z, 2.5) - 0.06;
    const T = M(x, y, z, 0.012, yaw, -0.02);
    const k = kit(bins, T);
    // колёса
    const tyre = new THREE.LatheGeometry([[0.36, -0.2], [0.5, -0.205], [0.555, -0.175], [0.58, -0.1], [0.585, 0], [0.58, 0.1], [0.555, 0.175], [0.5, 0.205], [0.36, 0.2]].map(([r, h]) => new THREE.Vector2(r, h)), 28);
    for (const ax of [2.45, -1.05, -2.45]) for (const sz of [-1, 1]) {
      const wz = sz * 1.03;
      k('rubber', tyre, M(ax, 0.585, wz, Math.PI / 2, 0, 0), C.W, [5, 1]);
      k('paint', CY(0.36, 0.36, 0.3, 18), M(ax, 0.585, wz, Math.PI / 2, 0, 0), C.OLIVE_D, 2);
      k('metal', CY(0.13, 0.15, 0.36, 10), M(ax, 0.585, wz, Math.PI / 2, 0, 0), C.DARK);
      for (let b = 0; b < 8; b++) { const ba = b / 8 * TAU; k('metal', CY(0.018, 0.018, 0.4, 5), M(ax + Math.cos(ba) * 0.2, 0.585 + Math.sin(ba) * 0.2, wz, Math.PI / 2, 0, 0), C.DARK); }
    }
    for (const ax of [2.45, -1.05, -2.45]) k('metal', CY(0.08, 0.08, 1.9, 8), M(ax, 0.585, 0, Math.PI / 2, 0, 0), C.BLACK);
    for (const sz of [-0.48, 0.48]) k('metal', B(7.0, 0.22, 0.1), M(-0.2, 0.8, sz), C.DARK, 1);
    k('metal', B(3.6, 0.35, 1.0), M(-1.6, 0.6, 0), C.BLACK, 1);
    // кабина и капот (профиль, выдавленный по ширине)
    const cab = new THREE.Shape();
    [[3.5, 0.95], [3.56, 1.55], [3.46, 1.74], [2.0, 1.86], [1.92, 1.96], [1.62, 2.72], [0.72, 2.76], [0.63, 2.62], [0.63, 0.95]].forEach(([px, py], i) => (i ? cab.lineTo(px, py) : cab.moveTo(px, py)));
    cab.closePath();
    const cabG = new THREE.ExtrudeGeometry(cab, { depth: 2.22, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.04, bevelSegments: 2, steps: 1 });
    cabG.translate(0, 0, -1.11);
    k('paint', cabG, null, C.OLIVE, 1);
    for (const sz of [-1, 1]) k('paint', new THREE.CylinderGeometry(0.68, 0.68, 0.52, 16, 1, true, Math.PI / 2, Math.PI), M(2.45, 0.6, sz * 1.03, Math.PI / 2, 0, 0), C.OLIVE, 1);
    // стёкла
    const wsMid = new THREE.Vector3(1.775, 2.34, 0), wsN = new THREE.Vector3(0.77, 0.3, 0).normalize();
    const wsRot = Math.atan2(0.3, 0.77);
    for (const sz of [-0.55, 0.55]) k('glass', new THREE.PlaneGeometry(0.8, 0.95), M(wsMid.x + wsN.x * 0.006, wsMid.y + wsN.y * 0.006, sz, 0, Math.PI / 2, 0).multiply(M(0, 0, 0, -(Math.PI / 2 - wsRot) + Math.PI / 2 - 0.37, 0, 0)), C.W, 1);
    k('metal', B(0.05, 0.85, 0.06), M(1.78, 2.34, 0, 0, 0, 0.37), C.DARK);
    for (const sz of [-1, 1]) {
      k('glass', new THREE.PlaneGeometry(0.78, 0.58), M(1.12, 2.28, sz * 1.165, 0, sz > 0 ? 0 : Math.PI, 0), C.W, 1);
      k('metal', B(0.14, 0.03, 0.03), M(0.9, 1.75, sz * 1.18), C.DARK);
      k('decal', decalGeo(0.62, 0.16, 'doornum'), M(1.15, 1.45, sz * 1.166, 0, sz > 0 ? 0 : Math.PI, 0), C.W, 'keep');
      k('paint', B(0.012, 1.55, 0.02), M(0.66, 1.75, sz * 1.165), C.BLACK);
      k('paint', B(0.012, 0.75, 0.02), M(1.62, 1.35, sz * 1.165), C.BLACK);
      k('metal', B(0.35, 0.05, 0.22), M(1.1, 0.78, sz * 1.25), C.DARK);
      // зеркала
      const r = rodM(new THREE.Vector3(1.85, 2.1, sz * 1.15), new THREE.Vector3(1.95, 2.25, sz * 1.42)); k('metal', CY(0.012, 0.012, r.len, 4), r.m, C.DARK);
      k('paint', B(0.05, 0.3, 0.18), M(1.95, 2.35, sz * 1.45), C.DARK);
      // фары
      k('metal', CY(0.12, 0.12, 0.12, 12), M(3.5, 1.08, sz * 0.86, 0, 0, Math.PI / 2), C.DARK);
      k('glass', new THREE.CircleGeometry(0.1, 12), M(3.565, 1.08, sz * 0.86, 0, Math.PI / 2, 0), [1.6, 1.6, 1.5], 1);
    }
    k('metal', B(0.05, 0.5, 1.3), M(3.585, 1.33, 0), C.DARK, 2);
    for (let i = -5; i <= 5; i++) k('metal', B(0.04, 0.46, 0.025), M(3.61, 1.33, i * 0.11), C.BLACK);
    k('metal', B(0.2, 0.22, 2.5), M(3.66, 0.86, 0), C.DARK, 2);
    for (const sz of [-0.7, 0.7]) k('paint', B(0.12, 0.08, 0.08), M(3.8, 0.86, sz), C.RED, 3);
    k('decal', decalGeo(0.5, 0.125, 'plate'), M(3.765, 0.86, 0, 0, Math.PI / 2, 0), C.W, 'keep');
    k('metal', CY(0.06, 0.06, 1.7, 8), M(0.55, 2.0, 1.02), C.DARK);
    k('metal', CY(0.006, 0.006, 1.6, 4), M(0.72, 3.5, -1.05), C.BLACK);
    k('paint', CY(0.26, 0.26, 1.05, 14), M(1.1, 0.72, -1.08, 0, 0, Math.PI / 2), C.OLIVE_D, 2);
    // кузов
    k('wood', B(4.25, 0.12, 2.46), M(-1.66, 1.24, 0), C.OLIVE, 0.8);
    for (const sz of [-1.2, 1.2]) k('wood', B(4.25, 0.55, 0.06), M(-1.66, 1.57, sz), C.OLIVE, 0.8);
    k('wood', B(0.06, 0.55, 2.46), M(-3.76, 1.57, 0), C.OLIVE, 0.8);
    k('wood', B(0.08, 1.1, 2.46), M(0.43, 1.84, 0), C.OLIVE_D, 0.8);
    k('paint', B(0.3, 0.06, 0.06), M(-3.9, 0.95, 0.9), C.DARK);
    // тент
    {
      const nu = 34, nv = 22, P = [], U = [], I = [], x0 = 0.42, x1 = -3.74;
      for (let i = 0; i <= nu; i++) {
        const t = i / nu, px = lerp(x0, x1, t), rib = Math.pow(Math.sin(Math.PI * ((px - x0) / -1.04 % 1)), 2);
        for (let j = 0; j <= nv; j++) {
          const ph = j / nv * Math.PI, cz = Math.cos(ph), sy = Math.sin(ph);
          const pz = 1.23 * Math.sign(cz) * Math.pow(Math.abs(cz), 0.35);
          let py = 1.82 + 1.12 * Math.pow(sy, 0.55);
          py -= 0.06 * rib * Math.pow(sy, 4) + 0.012 * Math.sin(px * 9 + ph * 7);
          P.push(px, py, pz * (1 - 0.015 * rib)); U.push(t * 4.2, j / nv * 3.2);
        }
      }
      for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const a0 = i * (nv + 1) + j, b0 = a0 + nv + 1; I.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1); }
      const tg = new THREE.BufferGeometry();
      tg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); tg.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
      tg.setIndex(I); tg.computeVertexNormals();
      k('fabric', tg, null, [0.42, 0.45, 0.3], [1, 1]);
      const back = new THREE.Shape();
      for (let j = 0; j <= nv; j++) { const ph = j / nv * Math.PI, cz = Math.cos(ph); const pz = 1.22 * Math.sign(cz) * Math.pow(Math.abs(cz), 0.35), py = 1.82 + 1.1 * Math.pow(Math.sin(ph), 0.55); j ? back.lineTo(pz, py) : back.moveTo(pz, py); }
      back.closePath();
      const bg = new THREE.ShapeGeometry(back);
      k('fabric', bg, M(-3.72, 0, 0, 0, -Math.PI / 2, 0), [0.32, 0.34, 0.22], 2);
      k('fabric', bg, M(0.4, 0, 0, 0, Math.PI / 2, 0), [0.32, 0.34, 0.22], 2);
    }
    const fwd = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    for (let s = -3.4; s <= 3.4; s += 0.85) col(x + fwd.x * s, z + fwd.z * s, 1.3);
    proxy('metal', T.clone().multiply(M(2.1, 1.75, 0, 0, 0, 0, 3.1, 2.0, 2.4)));
    proxy('metal', T.clone().multiply(M(-1.65, 2.0, 0, 0, 0, 0, 4.3, 2.0, 2.5)));
    proxy('metal', T.clone().multiply(M(0, 0.6, 0, 0, 0, 0, 7.4, 1.0, 2.5)));
    marks.push({ x, z, rect: [7.8, 3.0], rot: yaw, b: 0.75, r: 0.6, blur: 0.6 });
    // колея от грузовика к краю поля
    const back = [-fwd.x, -fwd.z], side = [fwd.z, -fwd.x];
    for (const o of [-1.03, 1.03]) {
      const pts = [];
      for (let s = 2.0; s < 60; s += 4) { const bend = s * s * 0.0035; pts.push([x + back[0] * s + side[0] * (o + bend), z + back[1] * s + side[1] * (o + bend)]); }
      marks.push({ pts, w: 0.5, g: 0.9, r: 0.3, blur: 0.15 });
    }
  }

  // ================= ферма за границей зоны =================
  {
    const bx = -48, bz = -58, yaw = -0.62, y = groundMin(bx, bz, 7) - 0.3;
    const k = kit(bins, M(bx, y, bz, 0, yaw, 0));
    for (const sz of [-4.5, 4.5]) k('wood', B(14, 4.4, 0.15), M(0, 2.2, sz), C.BARN, 0.5);
    const gable = new THREE.Shape();
    [[-4.6, 0], [4.6, 0], [4.6, 4.3], [3.0, 6.7], [0, 8.3], [-3.0, 6.7], [-4.6, 4.3]].forEach(([px, py], i) => (i ? gable.lineTo(px, py) : gable.moveTo(px, py)));
    gable.closePath();
    const gg = new THREE.ExtrudeGeometry(gable, { depth: 0.15, bevelEnabled: false });
    for (const sx of [-7, 7]) k('wood', gg, M(sx, 0, 0, 0, Math.PI / 2, 0), C.BARN, 0.5);
    const roof = (z0, y0, z1, y1) => { for (const sd of [1, -1]) { const r = beamM(new THREE.Vector3(0, y0, z0 * sd), new THREE.Vector3(0, y1, z1 * sd)); k('rust', B(14.8, 0.08, r.len + 0.1), r.m, [0.55, 0.42, 0.36], 0.4); } };
    roof(4.85, 4.15, 3.0, 6.75); roof(3.05, 6.7, -0.02, 8.35);
    k('dark', B(0.05, 3.4, 3.0), M(7.06, 1.7, 0), C.BLACK);
    k('wood', B(0.1, 3.4, 1.5), M(7.12, 1.7, -0.75), [0.4, 0.15, 0.1], 0.5);
    k('wood', B(0.1, 3.4, 1.5), M(7.6, 1.7, 1.2, 0, 1.0, 0), [0.4, 0.15, 0.1], 0.5);
    k('wood', B(0.1, 1.3, 1.2), M(7.12, 5.6, 0), [0.4, 0.15, 0.1], 0.5);
    // фермерский дом с горящим окном
    const hx = 55, hz = -64, hyaw = Math.atan2(-55, 86), hy = groundMin(hx, hz, 5) - 0.2;
    const h = kit(bins, M(hx, hy, hz, 0, hyaw, 0));
    for (const sz of [-3.5, 3.5]) h('wood', B(9, 3.1, 0.15), M(0, 1.55, sz), [0.62, 0.58, 0.5], 0.5);
    for (const sx of [-4.5, 4.5]) h('wood', B(0.15, 3.1, 7), M(sx, 1.55, 0), [0.62, 0.58, 0.5], 0.5);
    const tri = new THREE.Shape(); tri.moveTo(-3.6, 0); tri.lineTo(3.6, 0); tri.lineTo(0, 2.1); tri.closePath();
    const tg = new THREE.ExtrudeGeometry(tri, { depth: 0.15, bevelEnabled: false });
    for (const sx of [-4.55, 4.4]) h('wood', tg, M(sx, 3.1, 0, 0, Math.PI / 2, 0), [0.62, 0.58, 0.5], 0.5);
    for (const sd of [1, -1]) { const r = beamM(new THREE.Vector3(0, 2.95, 4.1 * sd), new THREE.Vector3(0, 5.25, -0.02 * sd)); h('rust', B(9.8, 0.08, r.len), r.m, [0.32, 0.3, 0.32], 0.4); }
    h('concrete', B(0.6, 2.0, 0.6), M(2.4, 4.8, -1.2), [0.55, 0.32, 0.26], 1);
    const wins = [-3.0, 0.3, 3.0];
    wins.forEach((wx, i) => {
      if (i === 1) h('window', decalGeo(1.0, 1.2, 'window'), M(wx, 1.65, 3.585), C.W, 'keep');
      else h('glass', new THREE.PlaneGeometry(1.0, 1.2), M(wx, 1.65, 3.585), C.W, 1);
      h('wood', B(1.15, 0.08, 0.06), M(wx, 2.3, 3.6), [0.8, 0.78, 0.72]); h('wood', B(1.15, 0.08, 0.06), M(wx, 1.0, 3.6), [0.8, 0.78, 0.72]);
    });
    h('wood', B(0.95, 2.0, 0.06), M(-1.4, 1.0, 3.6), [0.3, 0.22, 0.16], 1);
    h('wood', B(9.6, 0.15, 2.0), M(0, 0.25, 4.6), C.WOOD, 0.5);
    for (const px of [-4.5, -1.5, 1.5, 4.5]) h('wood', B(0.12, 2.6, 0.12), M(px, 1.55, 5.5), C.WOOD, 1);
    h('rust', B(9.8, 0.06, 2.3), M(0, 2.9, 4.7, 0.18, 0, 0), [0.32, 0.3, 0.32], 0.4);
    const ws = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.glow, color: new THREE.Color(1.6, 0.85, 0.35), blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    ws.position.set(0.3, 1.65, 3.8).applyMatrix4(M(hx, hy, hz, 0, hyaw, 0)); ws.scale.setScalar(3.2);
    root.add(ws);
    marks.push({ pts: [[-6, -16], [-22, -34], [-40, -52]], w: 1.6, g: 0.4, r: 0.35, blur: 0.6 });
  }

  // ================= сухие деревья =================
  const TREES = [[-29, -19, 1], [33, 19, 1], [25, -31, 1], [-37, 9, 1], [-9, 41, 1], [-50, -32, 0], [58, -12, 0], [44, 49, 0], [-60, 24, 0], [12, -58, 0], [-28, 58, 0], [70, 30, 0]];
  for (const [tx, tz, inside] of TREES) {
    const ty = heightAt(tx, tz) - 0.1, H = rng.range(6, 10);
    const T = M(tx, ty, tz, 0, rng.range(0, TAU), 0);
    const branch = (start, dir, len, rad, depth) => {
      const end = start.clone().addScaledVector(dir, len);
      const r = rodM(start, end);
      bins.add('bark', CY(rad * 0.62, rad, r.len, depth < 2 ? 7 : 4, true), T.clone().multiply(r.m), [0.62, 0.58, 0.54], [1, r.len * 0.8]);
      if (depth >= 4 || rad < 0.02) return;
      const n = depth === 0 ? rng.int(3, 4) : rng.int(2, 3);
      for (let i = 0; i < n; i++) {
        const axis = new THREE.Vector3(rng.range(-1, 1), rng.range(-0.3, 0.3), rng.range(-1, 1)).cross(dir).normalize();
        const nd = dir.clone().applyAxisAngle(axis, rng.range(0.35, 0.95)).normalize();
        nd.y = Math.max(nd.y, -0.2); nd.normalize();
        const st = start.clone().addScaledVector(dir, len * rng.range(0.55, 1));
        branch(st, nd, len * rng.range(0.5, 0.75), rad * 0.58, depth + 1);
      }
    };
    branch(new THREE.Vector3(0, 0, 0), new THREE.Vector3(rng.range(-0.12, 0.12), 1, rng.range(-0.12, 0.12)).normalize(), H * 0.42, rng.range(0.2, 0.3), 0);
    if (inside) { col(tx, tz, 0.4); proxy('wood', M(tx, ty + 2, tz, 0, 0, 0, 0.5, 4, 0.5), true); }
    blockedBy.push([tx, tz, 1.0]);
    marks.push({ x: tx, z: tz, rad: 1.2, b: 0.25, r: 0.3 });
  }

  // ================= рулоны сена, покрышки =================
  const bale = new THREE.LatheGeometry([[0, -0.6], [0.6, -0.6], [0.72, -0.55], [0.76, -0.4], [0.77, 0], [0.76, 0.4], [0.72, 0.55], [0.6, 0.6], [0, 0.6]].map(([r, h]) => new THREE.Vector2(r, h)), 20);
  for (const [x, z, yaw, inside] of [[-26.5, -21, 0.3, 1], [-25.0, -22.7, 0.5, 1], [28.5, -11, 1.2, 1], [-38, -48, 0.2, 0], [-36.4, -49.6, 0.25, 0], [-39.5, -46.2, 1.4, 0], [30, 50, 0.6, 0], [31.7, 51.5, 0.7, 0], [64, 4, 2.0, 0]]) {
    const y = groundMin(x, z, 0.7) + 0.72;
    bins.add('straw', bale, M(x, y, z, 0, yaw, Math.PI / 2), C.W, [3, 2]);
    if (inside) { col(x, z, 0.85); proxy('dirt', M(x, y, z, 0, yaw, Math.PI / 2, 1.5, 1.2, 1.5), true); }
    blockedBy.push([x, z, 1.0]);
    marks.push({ x, z, rad: 1.1, b: 0.5, r: 0.3 });
  }
  const tyreG = new THREE.LatheGeometry([[0.3, -0.11], [0.42, -0.13], [0.47, -0.1], [0.48, 0], [0.47, 0.1], [0.42, 0.13], [0.3, 0.11], [0.29, 0], [0.3, -0.11]].map(([r, h]) => new THREE.Vector2(r, h)), 22);
  for (const [x, z, n, lean] of [[-15.4, 32.7, 3, 0], [-12.2, 34.6, 1, 1], [9.2, 33.2, 1, 0], [-17.2, 34.4, 2, 0]]) {
    const y = groundMin(x, z, 0.5);
    for (let i = 0; i < n; i++) bins.add('rubber', tyreG, lean ? M(x, y + 0.45, z, 1.2, 0.4, 0) : M(x + rng.range(-0.05, 0.05), y + 0.13 + i * 0.26, z, rng.range(-0.05, 0.05), rng.range(0, 3), 0), C.W, [6, 1]);
    col(x, z, 0.55);
    proxy('dirt', M(x, y + n * 0.13, z, 0, 0, 0, 0.96, n * 0.26 + 0.2, 0.96), true);
  }

  // ================= сломанные заборы =================
  const fence = (pts, inside) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], len = Math.hypot(bx - ax, bz - az), n = Math.round(len / 2.4);
      for (let s = 0; s < n; s++) {
        if (rng.chance(0.08)) continue;
        const t0 = s / n, t1 = (s + 1) / n, x0 = lerp(ax, bx, t0), z0 = lerp(az, bz, t0), x1 = lerp(ax, bx, t1), z1 = lerp(az, bz, t1);
        const lean = rng.chance(0.15) ? rng.range(-0.35, 0.35) : rng.range(-0.06, 0.06);
        const y0 = heightAt(x0, z0);
        bins.add('wood', B(0.11, 1.3, 0.11), M(x0, y0 + 0.55, z0, lean * 0.5, rng.range(0, 1), lean), C.WOOD, 1.2);
        const inPlay = Math.hypot(x0, z0) < 47.5;
        if (inPlay) col(x0, z0, 0.2);
        for (const ry of [0.45, 0.98]) {
          const roll = rng.float();
          if (roll < 0.18) continue;
          const y1 = heightAt(x1, z1);
          let pA = new THREE.Vector3(x0, y0 + ry, z0), pB = new THREE.Vector3(x1, y1 + ry, z1);
          if (roll < 0.32) pB = pA.clone().lerp(pB, rng.range(0.4, 0.7)).setY(heightAt(lerp(x0, x1, 0.6), lerp(z0, z1, 0.6)) + 0.05);
          const r = beamM(pA, pB);
          bins.add('wood', B(0.035, 0.12, r.len), r.m, C.WOOD, 1.2);
          if (inPlay) for (let q = 0.25; q < r.len; q += 0.6) { const t = q / r.len; col(lerp(pA.x, pB.x, t), lerp(pA.z, pB.z, t), 0.15); }
        }
        if (inPlay) proxy('wood', M(x0, y0 + 0.65, z0, 0, 0, 0, 0.12, 1.3, 0.12));
      }
    }
  };
  fence([[-41.5, -36], [-41.8, -6], [-42.2, -2]], true);
  fence([[-42.0, 2.5], [-41.2, 20], [-40.5, 37]], true);
  fence([[-36, 47.5], [-10, 48.5], [24, 47.2]], false);

  // ================= обломки и доски у кромки =================
  for (let i = 0; i < 9; i++) {
    const aa = rng.range(0, TAU), rr = radiusAt(aa) + rng.range(2.4, 7.5), x = Math.cos(aa) * rr, z = Math.sin(aa) * rr;
    if (!isFree(x, z, 1)) continue;
    bins.add('wood', B(rng.range(1.2, 2.4), 0.03, rng.range(0.12, 0.2)), M(x, heightAt(x, z) + 0.02, z, rng.range(-0.05, 0.05), rng.range(0, TAU), rng.range(-0.05, 0.05)), C.WOOD, 1);
  }
  {
    const x = 8.6, z = 19.4, y = heightAt(x, z), k = kit(bins, M(x, y, z, 0.05, 0.6, 0.12));
    for (const dz of [-0.45, 0, 0.45]) k('wood', B(1.2, 0.08, 0.09), M(0, 0.05, dz), C.WOOD, 1);
    for (let i = 0; i < 6; i++) if (i !== 2) k('wood', B(0.1, 0.022, 1.0), M(-0.5 + i * 0.2, 0.1, 0, 0, 0, i === 4 ? 0.3 : 0), C.WOOD, 1);
  }

  // ================= кусты =================
  {
    const g = new THREE.IcosahedronGeometry(1, 2), p = g.attributes.position, nz = makeNoise3D(91);
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), n = 1 + 0.35 * nz(x * 1.8, y * 1.8, z * 1.8) + 0.15 * nz(x * 5, y * 5, z * 5); p.setXYZ(i, x * n, Math.max(y * n, -0.2), z * n); }
    g.computeVertexNormals();
    const list = [];
    for (let t = 0; t < 400 && list.length < 30; t++) {
      const aa = rng.range(0, TAU), rr = rng.range(29, 75), x = Math.cos(aa) * rr, z = Math.sin(aa) * rr;
      if (Math.hypot(x - TRUCK.x, z - TRUCK.z) < 6 || colliders.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 1.5)) continue;
      list.push([x, z, rng.range(0.6, 1.4)]);
    }
    const im = new THREE.InstancedMesh(g, ctx.mats.leaf, list.length), cc = new THREE.Color();
    list.forEach(([x, z, s], i) => {
      im.setMatrixAt(i, M(x, heightAt(x, z) + s * 0.25, z, 0, rng.range(0, TAU), 0, s * rng.range(0.9, 1.3), s * 0.7, s));
      im.setColorAt(i, cc.setRGB(rng.range(0.6, 0.9), rng.range(0.6, 0.85), rng.range(0.45, 0.6)));
      if (Math.hypot(x, z) < 47) { col(x, z, s * 0.75); }
      blockedBy.push([x, z, s]);
    });
    im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere();
    root.add(im);
  }

  // ---------- сборка ----------
  const meshes = bins.build(ctx.mats, root);
  proxyRoot.updateMatrixWorld(true);
  const blocked = (x, z, pad = 0) => colliders.some((c) => (c.x - x) ** 2 + (c.z - z) ** 2 < (c.r + pad) ** 2) || blockedBy.some(([bx, bz, br]) => (bx - x) ** 2 + (bz - z) ** 2 < (br + pad) ** 2);
  // тропы
  marks.push({ pts: [[0.2, 19.6], [0.4, 16.5], [-0.4, 13.6]], w: 2.4, g: 0.65, r: 0.4, blur: 0.8 });
  const arc = []; for (let t = 0.25; t <= Math.PI - 0.25; t += 0.08) arc.push([Math.cos(t) * 17.6, Math.sin(t) * 17.6]);
  marks.push({ pts: arc, w: 1.5, g: 0.42, r: 0.3, blur: 0.7 });
  marks.push({ pts: [[-1.0, 28.2], [-5, 31], [-12, 31.6], [-17, 28.6]], w: 2.0, g: 0.6, r: 0.3, blur: 0.7 });
  for (const T of TOWERS) marks.push({ pts: [[T.x * 0.84, T.z * 0.84], [T.x, T.z]], w: 1.1, g: 0.35, blur: 0.6 });
  return { colliders, marks, raycast, dyn, surf, meshes, blocked, crate: new THREE.Vector3(CRATE.x, heightAt(CRATE.x, CRATE.z), CRATE.z) };
}

// ================= огонь в бочках: пламя, искры, дым =================
export function buildFires(ctx, fires) {
  const { tex, root, timeU, pointScale } = ctx;
  const rng = new RNG(9191);
  const out = { lights: [], meshes: [] };
  // пламя: «цилиндрические» билборды
  const P = [], UV = [], CEN = [], F = [], I = [];
  fires.forEach((f, fi) => {
    const layers = f.strength > 0.5 ? 4 : 2;
    for (let l = 0; l < layers; l++) {
      const w = (0.42 + 0.22 * rng.float()) * (0.5 + 0.5 * f.strength) * (l === 0 ? 1.15 : 1), h = (0.75 + 0.6 * rng.float()) * f.strength;
      const b = P.length / 3;
      for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
        P.push(0, 0, 0); UV.push(u, v);
        CEN.push(f.pos.x + rng.range(-0.06, 0.06), f.pos.y - 0.08, f.pos.z + rng.range(-0.06, 0.06));
        F.push(w, h, rng.float() * 10 + fi * 3.7, l);
      }
      I.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
  });
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  fg.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  fg.setAttribute('aCenter', new THREE.Float32BufferAttribute(CEN, 3));
  fg.setAttribute('aF', new THREE.Float32BufferAttribute(F, 4));
  fg.setIndex(I);
  const fm = new THREE.ShaderMaterial({
    uniforms: { uTime: timeU, tNoise: { value: tex.cloud } },
    vertexShader: `attribute vec3 aCenter; attribute vec4 aF; varying vec2 vUv; varying float vSeed;
      void main(){
        vec3 toCam = cameraPosition - aCenter; toCam.y = 0.0;
        vec3 fw = normalize(toCam + vec3(1e-4, 0.0, 0.0));
        vec3 right = vec3(fw.z, 0.0, -fw.x);
        vec3 wp = aCenter + right * (uv.x - 0.5) * aF.x + vec3(0.0, uv.y * aF.y, 0.0) + fw * (aF.w * 0.04 - 0.06);
        vUv = uv; vSeed = aF.z;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: `uniform float uTime; uniform sampler2D tNoise; varying vec2 vUv; varying float vSeed;
      void main(){
        vec2 p = vUv;
        float t = uTime * (1.0 + fract(vSeed) * 0.4);
        float n1 = texture2D(tNoise, vec2(p.x * 0.55 + vSeed, p.y * 0.45 - t * 0.55)).g;
        float n2 = texture2D(tNoise, vec2(p.x * 1.1 - vSeed * 0.3, p.y * 0.9 - t * 1.05)).r;
        float wdt = mix(0.48, 0.06, pow(p.y, 0.8));
        float shape = 1.0 - smoothstep(wdt * 0.4, wdt, abs(p.x - 0.5 + (n1 - 0.5) * 0.25 * p.y));
        float f = shape * (1.25 - p.y * 1.15) + (n1 * 0.7 + n2 * 0.6) - 0.72;
        f = clamp(f * 1.6, 0.0, 1.0) * smoothstep(0.0, 0.08, p.y);
        vec3 col = mix(vec3(0.9, 0.12, 0.01), vec3(4.6, 1.9, 0.42), smoothstep(0.2, 0.75, f));
        col = mix(col, vec3(6.5, 4.6, 2.2), smoothstep(0.8, 1.0, f) * (1.0 - p.y));
        gl_FragColor = vec4(col * smoothstep(0.03, 0.35, f), 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const flames = new THREE.Mesh(fg, fm); flames.frustumCulled = false; flames.renderOrder = 9;
  root.add(flames); out.meshes.push(flames);
  // искры над бочками
  const per = 60, n = fires.length * per, eg = new THREE.BufferGeometry();
  const org = new Float32Array(n * 3), sd = new Float32Array(n * 4);
  fires.forEach((f, fi) => { for (let i = 0; i < per; i++) { const k = fi * per + i; org[k * 3] = f.pos.x; org[k * 3 + 1] = f.pos.y; org[k * 3 + 2] = f.pos.z; for (let c = 0; c < 4; c++) sd[k * 4 + c] = rng.float(); sd[k * 4 + 3] = sd[k * 4 + 3] * 0.6 + 0.4 * f.strength; } });
  eg.setAttribute('position', new THREE.BufferAttribute(org, 3));
  eg.setAttribute('aSeed', new THREE.BufferAttribute(sd, 4));
  const em = new THREE.ShaderMaterial({
    uniforms: { uTime: timeU, uScale: pointScale },
    vertexShader: `attribute vec4 aSeed; uniform float uTime, uScale; varying float vA; varying float vH;
      void main(){
        float life = mix(1.6, 3.4, aSeed.x);
        float t = fract(uTime / life + aSeed.y);
        vec3 p = position + vec3((aSeed.z - 0.5) * 0.3, 0.0, (aSeed.w - 0.5) * 0.3);
        p.y += t * mix(2.0, 4.5, aSeed.z) * aSeed.w;
        p.x += sin(uTime * 2.3 + aSeed.x * 30.0) * 0.25 * t + t * t * 0.8;
        p.z += cos(uTime * 1.9 + aSeed.z * 20.0) * 0.25 * t + t * t * 0.3;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        vA = (1.0 - t) * smoothstep(0.0, 0.05, t) * (0.6 + 0.4 * sin(uTime * 13.0 + aSeed.y * 50.0));
        vH = 1.0 - t;
        gl_PointSize = max(1.2, uScale * 0.035 / -mv.z);
      }`,
    fragmentShader: `varying float vA; varying float vH;
      void main(){ float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(mix(vec3(2.0, 0.4, 0.06), vec3(5.0, 2.4, 0.7), vH) * smoothstep(0.5, 0.0, d) * vA, 1.0); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const embers = new THREE.Points(eg, em); embers.frustumCulled = false; embers.renderOrder = 9;
  root.add(embers); out.meshes.push(embers);
  // дым
  const sper = 9, sn = fires.length * sper;
  const sg = new THREE.InstancedBufferGeometry(), plane = new THREE.PlaneGeometry(1, 1);
  sg.index = plane.index; sg.setAttribute('position', plane.attributes.position); sg.setAttribute('uv', plane.attributes.uv);
  const so = new Float32Array(sn * 4), ss = new Float32Array(sn * 4);
  fires.forEach((f, fi) => { for (let i = 0; i < sper; i++) { const k = fi * sper + i; so[k * 4] = f.pos.x; so[k * 4 + 1] = f.pos.y + 0.6; so[k * 4 + 2] = f.pos.z; so[k * 4 + 3] = f.strength; for (let c = 0; c < 4; c++) ss[k * 4 + c] = rng.float(); } });
  sg.setAttribute('aOrg', new THREE.InstancedBufferAttribute(so, 4));
  sg.setAttribute('aSeed', new THREE.InstancedBufferAttribute(ss, 4));
  sg.instanceCount = sn;
  const smm = new THREE.ShaderMaterial({
    uniforms: { uTime: timeU, tSmoke: { value: tex.smoke } },
    vertexShader: `attribute vec4 aOrg; attribute vec4 aSeed; uniform float uTime; varying vec2 vUv; varying float vA;
      void main(){
        float life = mix(6.0, 10.0, aSeed.x);
        float t = fract(uTime / life + aSeed.y);
        vec3 c = aOrg.xyz + vec3(t * t * 3.5 + (aSeed.z - 0.5) * t, t * 6.5, t * 1.4 + (aSeed.w - 0.5) * t);
        float size = mix(0.5, 3.2, t);
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        float rot = aSeed.z * 6.28 + uTime * 0.2 * (aSeed.w - 0.5);
        vec2 q = mat2(cos(rot), -sin(rot), sin(rot), cos(rot)) * position.xy;
        gl_Position = projectionMatrix * viewMatrix * vec4(c + (right * q.x + up * q.y) * size, 1.0);
        vUv = uv; vA = smoothstep(0.0, 0.12, t) * (1.0 - t) * (1.4 - aOrg.w * 0.6);
      }`,
    fragmentShader: `uniform sampler2D tSmoke; varying vec2 vUv; varying float vA;
      void main(){ gl_FragColor = vec4(vec3(0.02, 0.019, 0.018), texture2D(tSmoke, vUv).a * vA * 0.32); }`,
    transparent: true, depthWrite: false,
  });
  const smoke = new THREE.Mesh(sg, smm); smoke.frustumCulled = false; smoke.renderOrder = 10;
  root.add(smoke); out.meshes.push(smoke);
  for (const f of fires) {
    if (!f.light) continue;
    const l = new THREE.PointLight(0xff7a2e, 26, 20, 2);
    l.position.copy(f.pos).add(_v.set(0, 0.6, 0));
    root.add(l);
    out.lights.push({ light: l, base: 26, seed: rng.float() * 100 });
  }
  return out;
}
