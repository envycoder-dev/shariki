// Декали: один InstancedMesh квадов с атласом (кровь, лужи, подпалины, пробоины, кислота) — один draw call.
// Кольцевой буфер; декаль, до перезаписи которой осталось FADE_AHEAD добавлений, плавно гаснет заранее.
import * as THREE from 'three';
import { flushAttr } from './particles.js';

const FADE_AHEAD = 24;
const FADE_TIME = 1.2;

export class DecalSystem {
  constructor(atlas, cap) {
    this.cap = cap; this.grid = atlas.grid;
    this.head = 0; this.used = 0;
    const geo = new THREE.PlaneGeometry(1, 1);
    this.aRect = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    this.aMat = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); // альфа, шероховатость, металл, эмиссия
    this.aRect.setUsage(THREE.DynamicDrawUsage);
    this.aMat.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aRect', this.aRect);
    geo.setAttribute('aMat', this.aMat);
    const mat = new THREE.MeshStandardMaterial({
      map: atlas.map, normalMap: atlas.normalMap, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, roughness: 1, metalness: 0,
    });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aRect;\nattribute vec4 aMat;\nvarying vec4 vMat;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = aRect.xy + uv * aRect.zw;\nvNormalMapUv = vMapUv;\nvMat = aMat;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec4 vMat;')
        .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.a *= vMat.x;')
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vMat.y;')
        .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vMat.z;')
        .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance += diffuseColor.rgb * vMat.w;');
    };
    this.material = mat;
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.name = 'fx-decals';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.receiveShadow = true;
    this.mesh.visible = false;

    this.basis = new Float32Array(cap * 12); // позиция, t, b, n
    this.wh = new Float32Array(cap * 2);
    this.age = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.fade = new Float32Array(cap).fill(-1);
    this.grow = new Float32Array(cap);
    this.g0 = new Float32Array(cap);
    this.alpha = new Float32Array(cap);
    this.emis = new Float32Array(cap);
    this.pulse = new Uint8Array(cap);
    this.alive = new Uint8Array(cap);
    // грязные диапазоны копятся до фактической загрузки (между рендерами может быть несколько update)
    this.d0 = cap; this.d1 = -1; this.c0 = cap; this.c1 = -1;
    this.mesh.instanceMatrix.onUploadCallback = () => { this.d0 = this.cap; this.d1 = -1; };
    this.aRect.onUploadCallback = () => { this.c0 = this.cap; this.c1 = -1; };
  }

  // Квад в точке (x,y,z) по нормали n (единичной); w,h — размеры, rot — поворот вокруг нормали.
  add(x, y, z, nx, ny, nz, w, h, rot, cell, flip, r, g, b, alpha, rough, metal, emis, life = 1e9, grow = 0, g0 = 1) {
    const i = this.head;
    this.head = (i + 1) % this.cap;
    if (this.used < this.cap) this.used++;
    const j = (i + FADE_AHEAD) % this.cap;
    if (this.alive[j] && this.fade[j] < 0) this.fade[j] = 0;

    let tx = 0, ty = 1, tz = 0;
    if (Math.abs(ny) > 0.9) { tx = 1; ty = 0; }
    const d = tx * nx + ty * ny + tz * nz;
    tx -= nx * d; ty -= ny * d; tz -= nz * d;
    const l = Math.hypot(tx, ty, tz) || 1;
    tx /= l; ty /= l; tz /= l;
    const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
    const c = Math.cos(rot), s = Math.sin(rot);
    const B = this.basis, o = i * 12;
    B[o] = x; B[o + 1] = y; B[o + 2] = z;
    B[o + 3] = tx * c + bx * s; B[o + 4] = ty * c + by * s; B[o + 5] = tz * c + bz * s;
    B[o + 6] = bx * c - tx * s; B[o + 7] = by * c - ty * s; B[o + 8] = bz * c - tz * s;
    B[o + 9] = nx; B[o + 10] = ny; B[o + 11] = nz;
    this.wh[i * 2] = w; this.wh[i * 2 + 1] = h;
    this.alive[i] = 1; this.age[i] = 0; this.life[i] = life; this.fade[i] = -1;
    this.grow[i] = grow; this.g0[i] = grow > 0 ? g0 : 1;
    this.alpha[i] = alpha; this.emis[i] = emis; this.pulse[i] = 0;

    const gsz = 1 / this.grid, col = cell % this.grid, row = Math.floor(cell / this.grid);
    const R = this.aRect.array;
    let u0 = col * gsz, du = gsz;
    if (flip) { u0 += du; du = -du; } // зеркальный вариант без отрицательного масштаба (иначе отсечение граней)
    R[i * 4] = u0; R[i * 4 + 1] = 1 - (row + 1) * gsz; R[i * 4 + 2] = du; R[i * 4 + 3] = gsz;
    const C = this.mesh.instanceColor.array;
    C[i * 3] = r; C[i * 3 + 1] = g; C[i * 3 + 2] = b;
    const A = this.aMat.array;
    A[i * 4] = alpha; A[i * 4 + 1] = rough; A[i * 4 + 2] = metal; A[i * 4 + 3] = emis;
    this._matrix(i, this.g0[i]);
    if (i < this.c0) this.c0 = i;
    if (i > this.c1) this.c1 = i;
    this._dirty(i);
    if (this.mesh.count < this.used) this.mesh.count = this.used;
    this.mesh.visible = true;
    return i;
  }

  _dirty(i) {
    if (i < this.d0) this.d0 = i;
    if (i > this.d1) this.d1 = i;
  }

  _matrix(i, k) {
    const B = this.basis, o = i * 12, M = this.mesh.instanceMatrix.array, m = i * 16;
    const w = this.wh[i * 2] * k, h = this.wh[i * 2 + 1] * k;
    M[m] = B[o + 3] * w; M[m + 1] = B[o + 4] * w; M[m + 2] = B[o + 5] * w; M[m + 3] = 0;
    M[m + 4] = B[o + 6] * h; M[m + 5] = B[o + 7] * h; M[m + 6] = B[o + 8] * h; M[m + 7] = 0;
    M[m + 8] = B[o + 9]; M[m + 9] = B[o + 10]; M[m + 10] = B[o + 11]; M[m + 11] = 0;
    M[m + 12] = B[o]; M[m + 13] = B[o + 1]; M[m + 14] = B[o + 2]; M[m + 15] = 1;
  }

  setPulse(i, on) { this.pulse[i] = on ? 1 : 0; }

  // начать затухание (например, лужа кислоты закончилась)
  expire(i) { if (this.alive[i] && this.fade[i] < 0) this.fade[i] = 0; }

  update(dt, time) {
    const A = this.aMat.array;
    for (let i = 0; i < this.used; i++) {
      if (!this.alive[i]) continue;
      const a = (this.age[i] += dt);
      let changed = false;
      if (this.grow[i] > 0) {
        const t = Math.min(1, a / this.grow[i]);
        const e = 1 - (1 - t) * (1 - t) * (1 - t);
        this._matrix(i, this.g0[i] + (1 - this.g0[i]) * e);
        if (t >= 1) this.grow[i] = 0;
        changed = true;
      }
      if (a > this.life[i] && this.fade[i] < 0) this.fade[i] = 0;
      let al = this.alpha[i], em = this.emis[i];
      if (this.fade[i] >= 0) {
        this.fade[i] += dt;
        const k = 1 - this.fade[i] / FADE_TIME;
        if (k <= 0) {
          this.alive[i] = 0;
          A[i * 4] = 0;
          const M = this.mesh.instanceMatrix.array, m = i * 16;
          for (let q = 0; q < 16; q++) M[m + q] = 0;
          this._dirty(i);
          continue;
        }
        al *= k; em *= k;
        changed = true;
      }
      if (this.pulse[i]) {
        em *= 0.7 + 0.3 * Math.sin(time * 3.1 + i * 1.7) * Math.sin(time * 1.3 + i);
        changed = true;
      }
      if (changed) {
        A[i * 4] = al; A[i * 4 + 3] = em;
        this._dirty(i);
      }
    }
    if (this.d1 >= this.d0) {
      flushAttr(this.mesh.instanceMatrix, this.d1 - this.d0 + 1, this.d0);
      flushAttr(this.aMat, this.d1 - this.d0 + 1, this.d0);
    }
    if (this.c1 >= this.c0) {
      flushAttr(this.aRect, this.c1 - this.c0 + 1, this.c0);
      flushAttr(this.mesh.instanceColor, this.c1 - this.c0 + 1, this.c0);
    }
  }

  clear() {
    this.alive.fill(0);
    this.fade.fill(-1);
    this.used = 0; this.head = 0;
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.d0 = this.cap; this.d1 = -1; this.c0 = this.cap; this.c1 = -1;
  }
}
