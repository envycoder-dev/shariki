// Руки в тактических перчатках: SkinnedMesh (кисть + 15 фаланг на костях, жёсткая привязка), рукава с манжетами и складками.
// Локальная система кисти (правая): запястье в начале координат, пальцы вдоль −Z, тыльная сторона +Y, большой палец со стороны −X.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { prep, boxUV, xf } from './geom.js';
import { UV_SCALE } from './textures.js';

const FINGERS = [
  { k: [-0.0285, 0.0005, -0.089], len: [0.043, 0.026, 0.022], r: [0.0099, 0.0084] },
  { k: [-0.0093, 0.002, -0.094], len: [0.047, 0.029, 0.023], r: [0.0102, 0.0086] },
  { k: [0.0103, 0.0005, -0.0905], len: [0.044, 0.027, 0.022], r: [0.0097, 0.0082] },
  { k: [0.0285, -0.0025, -0.0815], len: [0.035, 0.021, 0.02], r: [0.0088, 0.0074] },
];
const THUMB = { k: [-0.025, -0.009, -0.026], rest: [-0.35, 0.72, -0.9], len: [0.04, 0.033, 0.028], r: [0.0128, 0.0112, 0.0104, 0.0089] };
const COL = { back: 0x3d4034, palm: 0x26272a, pad: 0x18191a, cuff: 0x34372d, strap: 0x1f201d, tip: 0x2c2d2a };

const sm = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

// Сужающаяся капсула вдоль −Z: от сустава (0) до следующего (−len)
function capsule(r0, r1, len, radial = 12) {
  const pts = [];
  for (let i = 0; i <= 5; i++) { const a = -Math.PI / 2 + (i / 5) * (Math.PI / 2); pts.push(new THREE.Vector2(r0 * Math.cos(a), r0 * Math.sin(a))); }
  for (let i = 1; i <= 6; i++) { const a = (i / 6) * (Math.PI / 2); pts.push(new THREE.Vector2(Math.max(1e-4, r1 * Math.cos(a)), len + r1 * Math.sin(a))); }
  const g = new THREE.LatheGeometry(pts, radial);
  g.rotateX(-Math.PI / 2);
  g.scale(1.06, 0.88, 1);
  return g;
}

// Цвет по нормали: ладонная сторона (−Y) темнее
function tintByNormal(g, back, palm) {
  const n = g.attributes.normal, c = g.attributes.color, a = new THREE.Color(back), b = new THREE.Color(palm), t = new THREE.Color();
  for (let i = 0; i < n.count; i++) { t.copy(a).lerp(b, sm((-n.getY(i) - 0.1) / 0.5)); c.setXYZ(i, t.r, t.g, t.b); }
}

function palmGeo(s) {
  const g = new RoundedBoxGeometry(0.083, 0.029, 0.1, 5, 0.0125);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i) - 0.046;
    const t = Math.min(1, Math.max(0, -z / 0.09));
    x *= 0.76 + 0.24 * sm(t * 1.3);
    const tx = x * s, q = 1 - (x / 0.042) ** 2;
    if (y > 0) y += 0.004 * q;
    else {
      y -= 0.006 * Math.exp(-((tx + 0.02) ** 2) / 0.0003 - ((z + 0.03) ** 2) / 0.0012);
      y -= 0.0035 * Math.exp(-((tx - 0.026) ** 2) / 0.00022 - ((z + 0.045) ** 2) / 0.002);
    }
    if (z < -0.07) z -= 0.005 * Math.max(0, q) * sm((-z - 0.07) / 0.03);
    z -= 0.004 * tx / 0.042 * sm((-z - 0.07) / 0.03) * -1; // линия костяшек скошена к мизинцу
    p.setXYZ(i, x, y, z);
  }
  return g;
}

function skin(g, bone) {
  const n = g.attributes.position.count;
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { si[i * 4] = bone; sw[i * 4] = 1; }
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
}

// Поза: Float32Array(21) — 4 пальца × [MCP, PIP, DIP, развод] + большой [rx, ry, rz, MCP, IP]
export function pose(f, t) {
  const p = new Float32Array(21);
  for (let i = 0; i < 4; i++) for (let k = 0; k < 4; k++) p[i * 4 + k] = f[i][k] ?? 0;
  for (let k = 0; k < 5; k++) p[16 + k] = t[k] ?? 0;
  return p;
}

export class Hand {
  constructor(side, M) {
    this.side = side;
    const s = side, bones = [], parts = [];
    const root = new THREE.Bone(); bones.push(root);
    const add = (g, bone, color, crease = 1.1, palmTint = true) => {
      const p = prep(g, color, crease);
      if (palmTint) tintByNormal(p, color, COL.palm);
      skin(p, bone); parts.push(p); return p;
    };
    // ладонь, накладка на костяшки, манжета с липучкой
    add(palmGeo(s), 0, COL.back, 1.2);
    const kn = new RoundedBoxGeometry(0.07, 0.0075, 0.021, 3, 0.0034);
    { const p = kn.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) - 7 * p.getX(i) ** 2); }
    xf(kn, s * 0.001, 0.0172, -0.083, 0.12, 0, s * 0.03);
    add(kn, 0, COL.pad, 1.0, false);
    const cuff = new THREE.CylinderGeometry(0.0345, 0.0322, 0.062, 20, 1, true);
    cuff.rotateX(Math.PI / 2); cuff.translate(0, 0, 0.025); cuff.scale(1.14, 0.83, 1);
    add(cuff, 0, COL.cuff, 1.2, false);
    add(xf(new RoundedBoxGeometry(0.036, 0.0052, 0.024, 2, 0.0022), s * 0.004, 0.0262, 0.03), 0, COL.strap, 1.0, false);
    add(xf(new RoundedBoxGeometry(0.008, 0.012, 0.022, 2, 0.003), s * -0.0385, 0.012, 0.03), 0, COL.strap, 1.0, false);

    this.f = [];
    root.updateMatrixWorld(true);
    FINGERS.forEach((F) => {
      const mcp = new THREE.Bone(), pip = new THREE.Bone(), dip = new THREE.Bone();
      mcp.rotation.order = 'YXZ';
      mcp.position.set(s * F.k[0], F.k[1], F.k[2]); root.add(mcp);
      pip.position.set(0, 0, -F.len[0]); mcp.add(pip);
      dip.position.set(0, 0, -F.len[1]); pip.add(dip);
      bones.push(mcp, pip, dip);
      this.f.push([mcp, pip, dip]);
    });
    const cmc = new THREE.Bone(), tm = new THREE.Bone(), ti = new THREE.Bone();
    cmc.position.set(s * THUMB.k[0], THUMB.k[1], THUMB.k[2]);
    cmc.rotation.set(THUMB.rest[0], s * THUMB.rest[1], s * THUMB.rest[2]);
    root.add(cmc);
    tm.position.set(0, 0, -THUMB.len[0]); cmc.add(tm);
    ti.position.set(0, 0, -THUMB.len[1]); tm.add(ti);
    bones.push(cmc, tm, ti);
    this.t = [cmc, tm, ti];
    this.thumbRest = cmc.quaternion.clone();
    root.updateMatrixWorld(true);

    // фаланги
    const seg = (bone, r0, r1, len, color, pad) => {
      const g = capsule(r0, r1, len);
      const p = prep(g, color, 1.3);
      tintByNormal(p, color, COL.palm);
      p.applyMatrix4(bone.matrixWorld);
      skin(p, bones.indexOf(bone)); parts.push(p);
      if (pad) {
        const pd = new RoundedBoxGeometry(r0 * 1.5, 0.0042, len * 0.62, 2, 0.0019);
        pd.translate(0, r0 * 0.86, -len * 0.5);
        const q = prep(pd, COL.pad, 1.0);
        q.applyMatrix4(bone.matrixWorld);
        skin(q, bones.indexOf(bone)); parts.push(q);
      }
    };
    FINGERS.forEach((F, i) => {
      const [mcp, pip, dip] = this.f[i];
      const r0 = F.r[0], r1 = F.r[1], rm = (r0 + r1) / 2;
      seg(mcp, r0, rm + 0.0004, F.len[0], COL.back, true);
      seg(pip, rm + 0.0003, r1 + 0.0003, F.len[1], COL.back, false);
      seg(dip, r1 + 0.0002, r1 * 0.86, F.len[2] - r1 * 0.6, COL.tip, false);
    });
    seg(cmc, THUMB.r[0], THUMB.r[1], THUMB.len[0], COL.back, false);
    seg(tm, THUMB.r[1], THUMB.r[2], THUMB.len[1], COL.back, true);
    seg(ti, THUMB.r[2], THUMB.r[3], THUMB.len[2] - 0.006, COL.tip, false);

    const geo = mergeGeometries(parts, false);
    boxUV(geo, UV_SCALE.glove);
    const mesh = new THREE.SkinnedMesh(geo, M.glove);
    mesh.add(root);
    mesh.bind(new THREE.Skeleton(bones));
    mesh.frustumCulled = false;
    mesh.name = side > 0 ? 'handR' : 'handL';
    this.mesh = mesh;
    this.cur = new Float32Array(21);
  }

  apply(p) {
    const s = this.side;
    this.cur.set(p);
    for (let i = 0; i < 4; i++) {
      const [a, b, c] = this.f[i];
      a.rotation.set(-p[i * 4], s * p[i * 4 + 3], 0);
      b.rotation.set(-p[i * 4 + 1], 0, 0);
      c.rotation.set(-p[i * 4 + 2], 0, 0);
    }
    _e.set(p[16], s * p[17], s * p[18]);
    this.t[0].quaternion.copy(this.thumbRest).multiply(_q.setFromEuler(_e));
    this.t[1].rotation.set(-p[19], 0, 0);
    this.t[2].rotation.set(-p[20], 0, 0);
  }
}
const _e = new THREE.Euler(), _q = new THREE.Quaternion();

// Рукав куртки: труба вдоль +Z от запястья к локтю, складки и манжета
export function buildSleeve(M, side) {
  const NZ = 36, NA = 24, L = 0.46;
  const pos = [], nrmUV = [], col = [], idx = [];
  const cBase = new THREE.Color(0xffffff), cCuff = new THREE.Color(0x8a8f80), t = new THREE.Color();
  for (let j = 0; j <= NZ; j++) {
    const z = -0.02 + (j / NZ) * L;
    for (let i = 0; i <= NA; i++) {
      const a = -Math.PI / 2 + (i / NA) * Math.PI * 2;
      let r = 0.0375 + 0.017 * sm((z - 0.03) / 0.36);
      if (z < 0.028) r *= 1.045; else if (z < 0.036) r *= 0.975;
      const k = sm((z - 0.04) / 0.06);
      const fold = Math.sin(z * 64 + 1.7 * Math.sin(a * 2 + z * 11) + side) * 0.04 + Math.sin(z * 29 + a * 3 + side * 2) * 0.022 + Math.sin(a * 5 + z * 40) * 0.008;
      r *= 1 + fold * k;
      pos.push(r * Math.cos(a) * 1.1, r * Math.sin(a) * 0.9, z);
      nrmUV.push(z * UV_SCALE.sleeve, a * 0.045 * UV_SCALE.sleeve);
      t.copy(cBase).lerp(cCuff, z < 0.03 ? 1 : 0).multiplyScalar(0.92 + 0.08 * Math.sin(z * 64 + a));
      col.push(t.r, t.g, t.b);
    }
  }
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NA; i++) {
    const a = j * (NA + 1) + i, b = a + NA + 1;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(nrmUV, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, M.sleeve);
  mesh.frustumCulled = false;
  mesh.name = side > 0 ? 'sleeveR' : 'sleeveL';
  return mesh;
}
