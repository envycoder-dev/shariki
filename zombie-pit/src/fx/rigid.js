// Твёрдые тела: ошмётки мяса и гильзы (инстансы, по одному draw call), отлетающие части (внешние Object3D).
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeNoise3D } from '../core/noise.js';
import { GRAVITY, flushAttr } from './particles.js';

const _q = new THREE.Quaternion();
const _ax = new THREE.Vector3();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

// q ← поворот(ω·dt)·q
function integrateQuat(q, w, dt) {
  const wl = w.length();
  if (wl < 1e-6) return;
  _ax.copy(w).divideScalar(wl);
  _q.setFromAxisAngle(_ax, wl * dt);
  q.premultiply(_q).normalize();
}

function randomQuat(q, rng) {
  _ax.set(rng.next() - 0.5, rng.next() - 0.5, rng.next() - 0.5);
  if (_ax.lengthSq() < 1e-6) _ax.set(0, 1, 0);
  q.setFromAxisAngle(_ax.normalize(), rng.next() * Math.PI * 2);
}

// ---------------------------------------------------------------- ошмётки
export class ChunkSystem {
  constructor(cap, meatTex, rng, ground, onSplat) {
    this.cap = cap; this.n = 0; this.rr = 0;
    this.rng = rng; this.ground = ground; this.onSplat = onSplat;
    // деформированный икосаэдр: рваный кусок мяса
    let geo = new THREE.IcosahedronGeometry(1, 2);
    geo.deleteAttribute('normal');
    geo.deleteAttribute('uv');
    geo = mergeVertices(geo);
    const noise = makeNoise3D(31);
    const pos = geo.attributes.position, uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i);
      const d = 1 + noise(_v.x * 1.4, _v.y * 1.4, _v.z * 1.4) * 0.3 + noise(_v.x * 3.6 + 7, _v.y * 3.6, _v.z * 3.6) * 0.12;
      uv[i * 2] = Math.atan2(_v.z, _v.x) / (Math.PI * 2) + 0.5;
      uv[i * 2 + 1] = _v.y * 0.5 + 0.5;
      _v.multiplyScalar(d);
      _v.y *= 0.72;
      pos.setXYZ(i, _v.x, _v.y, _v.z);
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    this.material = new THREE.MeshPhysicalMaterial({
      map: meatTex, color: 0xffffff, roughness: 0.42, clearcoat: 0.75, clearcoatRoughness: 0.16,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.material, cap);
    this.mesh.name = 'fx-chunks';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.items = [];
    for (let i = 0; i < cap; i++) {
      this.items.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(),
        s: new THREE.Vector3(), c: new THREE.Color(), age: 0, life: 0, rest: false, splats: 0, r: 0 });
    }
  }

  spawn(x, y, z, vx, vy, vz, size, life) {
    const rng = this.rng;
    let it;
    if (this.n < this.cap) it = this.items[this.n++];
    else { this.rr = (this.rr + 1) % this.cap; it = this.items[this.rr]; }
    it.p.set(x, y, z); it.v.set(vx, vy, vz);
    randomQuat(it.q, rng);
    it.w.set(rng.next() - 0.5, rng.next() - 0.5, rng.next() - 0.5).multiplyScalar(28);
    it.s.set(size * (0.8 + rng.next() * 0.5), size * (0.6 + rng.next() * 0.4), size * (0.8 + rng.next() * 0.5));
    const k = 0.75 + rng.next() * 0.35;
    it.c.setRGB(k, k * (0.85 + rng.next() * 0.2), k * (0.85 + rng.next() * 0.2));
    it.age = 0; it.life = life; it.rest = false; it.splats = 2; it.r = size * 0.62;
  }

  update(dt) {
    const items = this.items, M = this.mesh.instanceMatrix, C = this.mesh.instanceColor.array;
    for (let i = this.n - 1; i >= 0; i--) {
      const it = items[i];
      it.age += dt;
      if (it.age >= it.life) {
        items[i] = items[this.n - 1]; items[this.n - 1] = it; this.n--;
        continue;
      }
      if (!it.rest) {
        it.v.y -= GRAVITY * dt;
        it.v.multiplyScalar(1 / (1 + 0.15 * dt));
        it.p.addScaledVector(it.v, dt);
        integrateQuat(it.q, it.w, dt);
        it.w.multiplyScalar(1 / (1 + 0.6 * dt));
        const gy = this.ground.heightAt(it.p.x, it.p.z);
        if (it.p.y - it.r < gy) {
          it.p.y = gy + it.r;
          const impact = -it.v.y;
          if (impact > 1.4 && it.splats > 0) {
            it.splats--;
            this.onSplat(it.p.x, gy, it.p.z, it.r * 1.6, 0, it.v.x, it.v.z);
          }
          if (it.v.y < 0) it.v.y = -it.v.y * 0.25;
          it.v.x *= 0.55; it.v.z *= 0.55;
          it.w.multiplyScalar(0.5);
          // перекатывание: ω ≈ (up × v) / r
          it.w.x += (it.v.z / it.r) * 0.3; it.w.z -= (it.v.x / it.r) * 0.3;
          if (it.v.lengthSq() < 0.3 && impact < 1) { it.rest = true; it.v.set(0, 0, 0); it.w.set(0, 0, 0); }
        }
      } else if (it.life - it.age < 1.5) {
        it.p.y -= dt * it.r * 1.6; // погружение в землю
      }
    }
    for (let i = 0; i < this.n; i++) {
      const it = items[i];
      const left = it.life - it.age, k = left < 0.4 ? left / 0.4 : 1;
      _s.copy(it.s).multiplyScalar(k);
      _m.compose(it.p, it.q, _s);
      _m.toArray(M.array, i * 16);
      C[i * 3] = it.c.r; C[i * 3 + 1] = it.c.g; C[i * 3 + 2] = it.c.b;
    }
    flushAttr(M, this.n); flushAttr(this.mesh.instanceColor, this.n);
    this.mesh.count = this.n;
    this.mesh.visible = this.n > 0;
  }

  clear() { this.n = 0; this.mesh.count = 0; this.mesh.visible = false; }
}

// ---------------------------------------------------------------- гильзы
export const CASING_KIND = { pistol: 0, rifle: 1, shotgun: 2 };
const KIND_NAMES = ['pistol', 'rifle', 'shotgun'];
// радиус и длина (чуть крупнее реальных — читаемость в игре)
const CASING_DIM = [{ R: 0.0062, L: 0.024 }, { R: 0.007, L: 0.049 }, { R: 0.0125, L: 0.074 }];
const CASING_LIFE = 8;

function latheFrom(pts, scale, kind, color, metal, rough) {
  const v = pts.map(([r, y]) => new THREE.Vector2(r * scale, y * scale));
  const g = new THREE.LatheGeometry(v, 14);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3), k = new Float32Array(n), pbr = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    col[i * 3] = color[0]; col[i * 3 + 1] = color[1]; col[i * 3 + 2] = color[2];
    k[i] = kind; pbr[i * 2] = metal; pbr[i * 2 + 1] = rough;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aKind', new THREE.BufferAttribute(k, 1));
  g.setAttribute('aPBR', new THREE.BufferAttribute(pbr, 2));
  return g;
}

function casingGeometry() {
  const brass = [0.6, 0.4, 0.12], plastic = [0.32, 0.018, 0.012];
  const s = 1.25;
  const pistol = latheFrom([[0, 0], [0.0047, 0], [0.0049, 0.0006], [0.0049, 0.0012], [0.0042, 0.0015], [0.0042, 0.0023],
    [0.0047, 0.0027], [0.0048, 0.019], [0.0043, 0.019], [0.0041, 0.017], [0, 0.017]], s, 0, brass, 0.85, 0.3);
  pistol.translate(0, -0.019 * s * 0.5, 0);
  const rifle = latheFrom([[0, 0], [0.0055, 0], [0.0056, 0.0012], [0.0047, 0.0016], [0.0047, 0.0027], [0.0055, 0.0033],
    [0.0052, 0.029], [0.0044, 0.0322], [0.0042, 0.033], [0.0042, 0.0392], [0.0038, 0.0392], [0.0036, 0.034], [0, 0.034]], 1.25, 1, brass, 0.85, 0.32);
  rifle.translate(0, -0.0392 * 1.25 * 0.5, 0);
  const sb = 1.1;
  const base = latheFrom([[0, 0], [0.0113, 0], [0.0113, 0.0016], [0.0104, 0.002], [0.0105, 0.0155], [0.0101, 0.016], [0, 0.016]], sb, 2, brass, 0.85, 0.32);
  const hull = latheFrom([[0.0099, 0.0154], [0.0101, 0.0635], [0.0088, 0.0662], [0.004, 0.0673], [0, 0.0675]], sb, 2, plastic, 0, 0.5);
  base.translate(0, -0.0675 * sb * 0.5, 0);
  hull.translate(0, -0.0675 * sb * 0.5, 0);
  return mergeGeometries([pistol, rifle, base, hull]);
}

export class CasingSystem {
  constructor(cap, rng, ground, audio) {
    this.cap = cap; this.n = 0; this.rr = 0;
    this.rng = rng; this.ground = ground; this.audio = audio;
    const geo = casingGeometry();
    this.iKind = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    this.iKind.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iKind', this.iKind);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.85, envMapIntensity: 1.5 });
    // одна геометрия на все виды: вершины чужого вида схлопываются в точку
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aKind;\nattribute float iKind;\nattribute vec2 aPBR;\nvarying vec2 vPBR;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nif (abs(aKind - iKind) > 0.5) transformed = vec3(0.0);\nvPBR = aPBR;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vPBR;')
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vPBR.y;')
        .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vPBR.x;');
    };
    this.material = mat;
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.name = 'fx-casings';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.items = [];
    for (let i = 0; i < cap; i++) {
      this.items.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(),
        axis: new THREE.Vector3(), dir: new THREE.Vector3(), base: new THREE.Quaternion(),
        kind: 0, age: 0, state: 0, bounces: 0, speed: 0, roll: 0 });
    }
  }

  spawn(x, y, z, vx, vy, vz, kind) {
    const rng = this.rng;
    let it;
    if (this.n < this.cap) it = this.items[this.n++];
    else { this.rr = (this.rr + 1) % this.cap; it = this.items[this.rr]; }
    it.p.set(x, y, z); it.v.set(vx, vy, vz);
    it.kind = kind; it.age = 0; it.state = 0; it.bounces = 0;
    // ось гильзы ⟂ направлению выброса, кувыркание вокруг третьей оси
    _v.set(vx, vy, vz);
    if (_v.lengthSq() < 1e-6) _v.set(1, 0, 0);
    _ax.crossVectors(_v, UP);
    if (_ax.lengthSq() < 1e-6) _ax.set(1, 0, 0);
    _ax.normalize();
    it.q.setFromUnitVectors(UP, _ax);
    _s.crossVectors(_ax, _v).normalize();
    it.w.copy(_s).multiplyScalar(18 + rng.next() * 22);
    it.w.x += (rng.next() - 0.5) * 6; it.w.z += (rng.next() - 0.5) * 6;
  }

  update(dt) {
    const items = this.items, D = CASING_DIM;
    for (let i = this.n - 1; i >= 0; i--) {
      const it = items[i];
      it.age += dt;
      if (it.age >= CASING_LIFE) {
        items[i] = items[this.n - 1]; items[this.n - 1] = it; this.n--;
        continue;
      }
      const R = D[it.kind].R, hl = D[it.kind].L * 0.5;
      if (it.state === 0) {
        it.v.y -= GRAVITY * dt;
        it.v.multiplyScalar(1 / (1 + 0.15 * dt));
        it.p.addScaledVector(it.v, dt);
        integrateQuat(it.q, it.w, dt);
        _v.set(0, 1, 0).applyQuaternion(it.q);
        const ay = Math.abs(_v.y);
        const rc = ay * hl + Math.sqrt(Math.max(0, 1 - ay * ay)) * R; // нижняя точка цилиндра
        const gy = this.ground.heightAt(it.p.x, it.p.z);
        if (it.p.y - rc < gy) {
          it.p.y = gy + rc;
          if (it.v.y < 0) {
            if (it.bounces === 0 && this.audio && this.audio.shellCasing) this.audio.shellCasing(it.p.clone(), KIND_NAMES[it.kind]);
            it.bounces++;
            it.v.y = -it.v.y * (it.kind === 2 ? 0.25 : 0.42);
            it.v.x *= 0.7; it.v.z *= 0.7;
            const sp = Math.min(1, it.v.length() * 0.6);
            it.w.set(this.rng.next() - 0.5, this.rng.next() - 0.5, this.rng.next() - 0.5).multiplyScalar(60 * sp);
            if (it.bounces >= 3 || it.v.y < 0.6) {
              // переход в качение: ось горизонтальна
              it.axis.set(_v.x, 0, _v.z);
              if (it.axis.lengthSq() < 1e-6) it.axis.set(1, 0, 0);
              it.axis.normalize();
              it.dir.set(-it.axis.z, 0, it.axis.x);
              it.speed = it.v.x * it.dir.x + it.v.z * it.dir.z + (this.rng.next() - 0.5) * 0.3;
              it.base.setFromUnitVectors(UP, it.axis);
              it.roll = 0;
              it.state = 1;
            }
          }
        }
      } else if (it.state === 1) {
        it.speed *= 1 / (1 + 3.5 * dt);
        it.p.addScaledVector(it.dir, it.speed * dt);
        it.roll += (it.speed / R) * dt;
        it.q.setFromAxisAngle(it.axis, it.roll).multiply(it.base);
        it.p.y = this.ground.heightAt(it.p.x, it.p.z) + R;
        if (Math.abs(it.speed) < 0.02) it.state = 2;
      }
    }
    const M = this.mesh.instanceMatrix, K = this.iKind.array;
    for (let i = 0; i < this.n; i++) {
      const it = items[i];
      const left = CASING_LIFE - it.age, k = left < 0.4 ? left / 0.4 : 1;
      _s.set(k, k, k);
      _m.compose(it.p, it.q, _s);
      _m.toArray(M.array, i * 16);
      K[i] = it.kind;
    }
    flushAttr(M, this.n); flushAttr(this.iKind, this.n);
    this.mesh.count = this.n;
    this.mesh.visible = this.n > 0;
  }

  clear() { this.n = 0; this.mesh.count = 0; this.mesh.visible = false; }
}

// ---------------------------------------------------------------- отлетающие части (внешние объекты)
const GIB_SINK = 1.5;

export class GibSystem {
  constructor(cap, scene, rng, ground, onTrail, onSplat) {
    this.cap = cap; this.n = 0;
    this.scene = scene; this.rng = rng; this.ground = ground;
    this.onTrail = onTrail; // (x,y,z, vx,vy,vz, splat)
    this.onSplat = onSplat;
    this.items = [];
    for (let i = 0; i < cap; i++) {
      this.items.push({ obj: null, v: new THREE.Vector3(), w: new THREE.Vector3(), bleed: true, life: 15, radius: 0.1,
        dispose: false, age: 0, rest: false, trail: 0, trailN: 0, splats: 0 });
    }
  }

  add(obj, vel, angVel, opts) {
    if (!obj) return;
    if (this.n >= this.cap) this._remove(0); // самую старую убираем сразу
    const it = this.items[this.n++];
    if (!obj.parent) this.scene.add(obj);
    it.obj = obj;
    if (vel) it.v.copy(vel); else it.v.set(0, 0, 0);
    if (angVel) it.w.copy(angVel); else it.w.set(0, 0, 0);
    it.bleed = opts && opts.bleed !== undefined ? !!opts.bleed : true;
    it.life = opts && opts.lifetime !== undefined ? opts.lifetime : 15;
    it.radius = opts && opts.radius !== undefined ? opts.radius : 0.1;
    it.dispose = !!(opts && opts.disposeGeometry);
    it.age = 0; it.rest = false; it.trail = 0; it.trailN = 0; it.splats = 6;
  }

  _remove(i) {
    const it = this.items[i], o = it.obj;
    if (o) {
      if (o.parent) o.parent.remove(o);
      if (it.dispose) o.traverse((c) => { if (c.geometry) c.geometry.dispose(); }); // материалы общие — не трогаем
    }
    it.obj = null;
    const last = this.items[this.n - 1];
    this.items[this.n - 1] = it; this.items[i] = last;
    this.n--;
  }

  update(dt) {
    for (let i = this.n - 1; i >= 0; i--) {
      const it = this.items[i], o = it.obj;
      it.age += dt;
      if (it.age > it.life) {
        if (it.age > it.life + GIB_SINK) { this._remove(i); continue; }
        o.position.y -= (dt * (it.radius * 2.2 + 0.05)) / GIB_SINK;
        continue;
      }
      if (it.rest) continue;
      const r = it.radius, v = it.v;
      v.y -= GRAVITY * dt;
      v.multiplyScalar(1 / (1 + 0.1 * dt));
      o.position.addScaledVector(v, dt);
      integrateQuat(o.quaternion, it.w, dt);
      it.w.multiplyScalar(1 / (1 + 0.5 * dt));
      const gy = this.ground.heightAt(o.position.x, o.position.z);
      if (o.position.y - r < gy) {
        o.position.y = gy + r;
        const impact = -v.y;
        if (impact > 1.5 && it.bleed && it.splats > 0) {
          it.splats--;
          this.onSplat(o.position.x, gy, o.position.z, r * 1.8, 0, v.x, v.z);
        }
        if (v.y < 0) v.y = -v.y * 0.25;
        v.x *= 0.62; v.z *= 0.62;
        it.w.multiplyScalar(0.55);
        it.w.x += (v.z / r) * 0.25; it.w.z -= (v.x / r) * 0.25;
        if (v.lengthSq() < 0.15 && impact < 0.8) { it.rest = true; v.set(0, 0, 0); it.w.set(0, 0, 0); }
      }
      // кровавый след, пока летит/катится
      if (it.bleed && it.age < it.life * 0.6) {
        const sp = v.length();
        if (sp > 0.7) {
          it.trail -= dt;
          while (it.trail <= 0) {
            it.trail += 0.02;
            it.trailN++;
            this.onTrail(o.position.x, o.position.y, o.position.z, v.x, v.y, v.z, it.trailN % 7 === 0 && it.trailN < 70);
          }
        }
      }
    }
  }

  clear() {
    while (this.n > 0) this._remove(this.n - 1);
  }
}
