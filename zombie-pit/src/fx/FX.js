// FX — все визуальные эффекты: попадания, кровь, декали, ошмётки, трассеры, вспышки, взрывы, гильзы, дым, кислота, газ.
// Draw calls: glow + soft + debris + decals + chunks + casings = 6 (+ внешние объекты addGib).
import * as THREE from 'three';
import { RNG, clamp } from '../core/noise.js';
import { makeNoiseTexture, makeDecalAtlas, makeMeatTexture, CELL } from './textures.js';
import { GlowSystem, SoftSystem, DebrisSystem, GK, SK, DK, F } from './particles.js';
import { DecalSystem } from './decals.js';
import { ChunkSystem, CasingSystem, GibSystem, CASING_KIND } from './rigid.js';

const QUALITY = {
  low: { glow: 200, soft: 125, debris: 175, decals: 120, chunks: 24, casings: 20, gibs: 16, mul: 0.45 },
  medium: { glow: 400, soft: 250, debris: 350, decals: 200, chunks: 40, casings: 30, gibs: 24, mul: 0.7 },
  high: { glow: 800, soft: 500, debris: 700, decals: 300, chunks: 64, casings: 40, gibs: 32, mul: 1 },
};

// эмиттеры длительных эффектов
const E = { SMOKE: 1, BURN: 2, GAS: 3, ACID: 4, TRICKLE: 5 };
const MAX_SPLATS_PER_FRAME = 24;

const _v = new THREE.Vector3();
const _c = new THREE.Color();

export class FX {
  constructor({ scene, camera, world, audio, quality = 'high' } = {}) {
    this.scene = scene; this.camera = camera; this.world = world; this.audio = audio;
    this.quality = QUALITY[quality] ? quality : 'high';
    const Q = QUALITY[this.quality];
    this.mul = Q.mul;
    this.rng = new RNG(0x5eed);
    this.time = 0;

    this.noiseTex = makeNoiseTexture(128);
    this.atlas = makeDecalAtlas(1024);
    this.meatTex = makeMeatTexture(256);

    this.splatQ = new Float32Array(64 * 7);
    this.splatN = 0;
    const onSplat = (x, y, z, size, kind, vx, vz) => this._queueSplat(x, y, z, size, kind, vx, vz);

    this.glow = new GlowSystem(Q.glow, this.rng, this, this.noiseTex);
    this.soft = new SoftSystem(Q.soft, this.rng, this, this.noiseTex);
    this.debris = new DebrisSystem(Q.debris, this.rng, this, onSplat);
    this.decals = new DecalSystem(this.atlas, Q.decals);
    this.chunks = new ChunkSystem(Q.chunks, this.meatTex, this.rng, this, onSplat);
    this.casings = new CasingSystem(Q.casings, this.rng, this, audio);
    this.gibs = new GibSystem(Q.gibs, scene, this.rng, this,
      (x, y, z, vx, vy, vz, splat) => this._gibTrail(x, y, z, vx, vy, vz, splat), onSplat);

    this.group = new THREE.Group();
    this.group.name = 'FX';
    this.group.add(this.decals.mesh, this.debris.mesh, this.chunks.mesh, this.casings.mesh, this.soft.mesh, this.glow.mesh);

    // пул динамических огней: всегда в сцене (интенсивность 0), чтобы не менялось число источников и не было перекомпиляции шейдеров
    this.lights = [];
    for (let i = 0; i < 4; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 12, 2);
      light.castShadow = false;
      this.group.add(light);
      this.lights.push({ light, t: 1, dur: 1, i0: 0 });
    }

    this.emitters = [];
    for (let i = 0; i < 48; i++) {
      this.emitters.push({ on: false, type: 0, t: 0, dur: 0, acc: 0, rate: 0, p: new THREE.Vector3(), r: 1, handle: null });
    }
    if (scene) scene.add(this.group);
    // временные значения для генераторов направлений (без аллокаций)
    this._dx = 0; this._dy = 1; this._dz = 0;
    this._nx = 0; this._ny = 1; this._nz = 0;
    this._r = 0; this._g = 0; this._b = 0;
  }

  // ------------------------------------------------------------------ служебное
  heightAt(x, z) {
    const w = this.world;
    if (w && w.heightAt) { const h = w.heightAt(x, z); return h === h && h !== undefined ? h : 0; }
    return 0;
  }

  _rand(a, b) { return a + (b - a) * this.rng.next(); }

  // направление в конусе вокруг (nx,ny,nz), spread ~ тангенс полуугла
  _cone(nx, ny, nz, spread) {
    const r = this.rng;
    let x = nx + (r.next() * 2 - 1) * spread, y = ny + (r.next() * 2 - 1) * spread, z = nz + (r.next() * 2 - 1) * spread;
    const l = Math.hypot(x, y, z) || 1;
    this._dx = x / l; this._dy = y / l; this._dz = z / l;
  }

  _sphere(upBias = 0) {
    const r = this.rng;
    let x, y, z, l;
    do { x = r.next() * 2 - 1; y = r.next() * 2 - 1; z = r.next() * 2 - 1; l = x * x + y * y + z * z; } while (l > 1 || l < 1e-4);
    l = Math.sqrt(l);
    x /= l; y /= l; z /= l;
    if (upBias > 0) { y = Math.abs(y) * (1 - upBias) + upBias * (0.3 + 0.7 * Math.abs(y)); }
    l = Math.hypot(x, y, z);
    this._dx = x / l; this._dy = y / l; this._dz = z / l;
  }

  _groundNormal(x, z) {
    const e = 0.25;
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z), hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    const nx = -hx / (2 * e), nz = -hz / (2 * e), l = Math.hypot(nx, 1, nz);
    this._nx = nx / l; this._ny = 1 / l; this._nz = nz / l;
  }

  _groundDecal(x, z, w, h, rot, cell, r, g, b, alpha, rough, metal, emis, life, grow, g0) {
    const y = this.heightAt(x, z);
    this._groundNormal(x, z);
    const nx = this._nx, ny = this._ny, nz = this._nz;
    return this.decals.add(x + nx * 0.02, y + ny * 0.02, z + nz * 0.02, nx, ny, nz, w, h, rot, cell,
      this.rng.next() < 0.5, r, g, b, alpha, rough, metal, emis, life, grow, g0);
  }

  _bloodColor(dark = 0) {
    const k = this._rand(0.75, 1.15) * (1 - dark * 0.45);
    this._r = 0.1 * k; this._g = 0.0055 * k * this._rand(0.8, 1.2); this._b = 0.0045 * k;
  }

  _cnt(a, b, far) { return Math.round(this._rand(a, b) * this.mul * (far ? 0.3 : 1)); }

  _camDist(x, y, z) {
    const c = this.camera;
    if (!c) return 0;
    const e = c.matrixWorld.elements;
    return Math.hypot(x - e[12], y - e[13], z - e[14]);
  }

  _queueSplat(x, y, z, size, kind, vx, vz) {
    if (this.splatN >= 64) return;
    const o = this.splatN++ * 7, Q = this.splatQ;
    Q[o] = x; Q[o + 1] = y; Q[o + 2] = z; Q[o + 3] = size; Q[o + 4] = kind; Q[o + 5] = vx; Q[o + 6] = vz;
  }

  _processSplats() {
    const Q = this.splatQ, n = Math.min(this.splatN, MAX_SPLATS_PER_FRAME);
    for (let k = 0; k < n; k++) {
      const o = k * 7, x = Q[o], z = Q[o + 2], size = Q[o + 3], kind = Q[o + 4], vx = Q[o + 5], vz = Q[o + 6];
      if (kind === DK.ACID) {
        const d = this._rand(0.08, 0.16);
        this._groundDecal(x, z, d, d, this._rand(0, 6.28), CELL.ACID, 0.18, 0.62, 0.03, 0.85, 0.2, 0, 1.1, this._rand(3, 5), 0, 1);
        continue;
      }
      const hs = Math.hypot(vx, vz);
      const d = (0.05 + size * 7) * this._rand(0.8, 1.3);
      this._bloodColor(this.rng.next() * 0.6);
      if (hs > 2.5 && size < 0.04) {
        // косой удар — вытянутая клякса вдоль скорости
        this._groundDecal(x, z, d * 1.9, d, Math.atan2(-vz, vx), CELL.SPLAT + 1, this._r, this._g, this._b, 0.95, 0.18, 0, 0, 1e9, 0, 1);
      } else {
        const v = this.rng.next();
        const cell = v < 0.3 ? CELL.DROP : v < 0.55 ? CELL.SPLAT : v < 0.8 ? CELL.SPLAT + 4 : CELL.SPLAT + 2;
        this._groundDecal(x, z, d, d, this._rand(0, 6.28), cell, this._r, this._g, this._b, 0.95, 0.17, 0, 0, 1e9, 0.12, 0.5);
      }
    }
    this.splatN = 0;
  }

  _emit(type, x, y, z, r, dur, rate, handle = null) {
    for (let i = 0; i < this.emitters.length; i++) {
      const e = this.emitters[i];
      if (e.on) continue;
      e.on = true; e.type = type; e.t = 0; e.dur = dur; e.acc = 0; e.rate = rate; e.r = r; e.handle = handle;
      e.p.set(x, y, z);
      return e;
    }
    return null;
  }

  // ------------------------------------------------------------------ кадр
  update(dt) {
    dt = Math.min(Math.max(dt, 0), 0.05);
    this.time += dt;
    this.glow.update(dt);
    this.soft.update(dt);
    this.debris.update(dt);
    this.chunks.update(dt);
    this.casings.update(dt);
    this.gibs.update(dt);
    this._updateEmitters(dt);
    this._processSplats();
    this.decals.update(dt, this.time);
    for (let i = 0; i < 4; i++) {
      const L = this.lights[i];
      if (L.t < L.dur) {
        L.t += dt;
        const k = 1 - L.t / L.dur;
        L.light.intensity = k > 0 ? L.i0 * k * k : 0;
      } else if (L.light.intensity !== 0) L.light.intensity = 0;
    }
    this.glow.write(this.time);
    this.soft.write(this.time);
    this.debris.write();
  }

  _updateEmitters(dt) {
    for (let i = 0; i < this.emitters.length; i++) {
      const e = this.emitters[i];
      if (!e.on) continue;
      e.t += dt;
      const t = e.t / e.dur;
      if (e.type === E.ACID) {
        // пузыри и испарения над лужей
        const h = e.handle;
        e.acc += dt * e.rate;
        while (e.acc >= 1) {
          e.acc -= 1;
          const a = this.rng.next() * 6.283, d = Math.sqrt(this.rng.next()) * e.r * 0.8;
          const x = e.p.x + Math.cos(a) * d, z = e.p.z + Math.sin(a) * d, y = this.heightAt(x, z) + 0.03;
          if (this.rng.next() < 0.75) {
            this.glow.spawn(GK.BUBBLE, x, y, z, 0, 0.03, 0, this._rand(0.5, 1.1), 0.012, this._rand(0.03, 0.06),
              0.45, 2.0, 0.22, 1, 0, 0, 0);
          } else {
            const j = this.soft.spawn(SK.FUME, x, y + 0.05, z, this._rand(-0.1, 0.1), this._rand(0.25, 0.5), this._rand(-0.1, 0.1),
              this._rand(1.5, 2.5), 0.12, this._rand(0.4, 0.7), 0.12, 0.34, 0.03, 0.2, 0.8, -0.01);
            this.soft.em[j] = -0.35;
            this.soft.fin[j] = 0.4;
          }
        }
        if (e.t >= e.dur) { e.on = false; if (h) h.alive = false; }
        continue;
      }
      const rate = e.type === E.BURN ? e.rate * (1 - t) : e.rate;
      e.acc += dt * rate;
      while (e.acc >= 1) {
        e.acc -= 1;
        if (e.type === E.SMOKE) this._smokePuff(e);
        else if (e.type === E.BURN) this._burnFlame(e);
        else if (e.type === E.GAS) this._gasPuff(e);
        else if (e.type === E.TRICKLE) this._sandGrain(e);
      }
      if (e.t >= e.dur) e.on = false;
    }
  }

  _smokePuff(e) {
    const s = e.r, p = e.p;
    const x = p.x + this._rand(-0.7, 0.7) * s, y = p.y + this._rand(0.2, 1.0) * s, z = p.z + this._rand(-0.7, 0.7) * s;
    const k = this._rand(0.8, 1.5);
    const i = this.soft.spawn(SK.SMOKE, x, y, z, this._rand(-1, 1) * 1.3 * s, this._rand(1.5, 3.8) * s, this._rand(-1, 1) * 1.3 * s,
      this._rand(3.2, 4.8), this._rand(0.5, 0.8) * s, this._rand(2.0, 3.2) * s, 0.026 * k, 0.023 * k, 0.02 * k,
      this._rand(0.62, 0.85), 1.1, -0.1);
    if (e.t < 0.3) this.soft.em[i] = this._rand(1.2, 2.6); // раскалённый дым светится изнутри
    this.soft.fin[i] = 0.1;
  }

  _burnFlame(e) {
    const s = e.r, p = e.p;
    const a = this.rng.next() * 6.283, d = Math.sqrt(this.rng.next()) * 1.1 * s;
    const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d, y = this.heightAt(x, z) + 0.05;
    const i = this.glow.spawn(GK.FIRE, x, y, z, this._rand(-0.2, 0.2), this._rand(0.8, 1.8), this._rand(-0.2, 0.2),
      this._rand(0.3, 0.6), 0.08 * s, this._rand(0.22, 0.4) * s, 1, 1, 1, this._rand(0.5, 0.8), 2, -0.05, 0);
    this.glow.heat[i] = this._rand(0.75, 1.0);
    if (this.rng.next() < 0.25) {
      this.glow.spawn(GK.EMBER, x, y + 0.1, z, this._rand(-0.4, 0.4), this._rand(1, 2.5), this._rand(-0.4, 0.4),
        this._rand(1, 2), this._rand(0.006, 0.012), 0, 4, 1.6, 0.4, 1, 1.5, -0.02, 0);
    }
  }

  _gasPuff(e) {
    const s = e.r, p = e.p;
    this._sphere(0.3);
    const d = this._rand(0, 0.55) * s;
    const x = p.x + this._dx * d, y = p.y + 0.3 + this._dy * d * 0.5, z = p.z + this._dz * d;
    const sp = this._rand(0.25, 0.8);
    const k = this._rand(0.8, 1.2);
    const i = this.soft.spawn(SK.GAS, x, y, z, this._dx * sp, this._dy * sp * 0.4 + 0.08, this._dz * sp,
      this._rand(3.0, 3.8), 0.3 * s, this._rand(0.65, 0.95) * s, 0.15 * k, 0.21 * k, 0.03 * k, this._rand(0.28, 0.4), 0.7, -0.004);
    this.soft.em[i] = -0.1;
    this.soft.fin[i] = 0.5;
  }

  _sandGrain(e) {
    const p = e.p;
    this.debris.spawn(DK.GRAIN, p.x + this._rand(-0.01, 0.01), p.y, p.z + this._rand(-0.01, 0.01),
      this._rand(-0.1, 0.1), this._rand(-0.2, 0), this._rand(-0.1, 0.1),
      2, this._rand(0.0025, 0.004), 0.22, 0.17, 0.1, 0.9, F.DIE);
  }

  _gibTrail(x, y, z, vx, vy, vz, splat) {
    this._bloodColor(0.3);
    this.debris.spawn(DK.BLOOD, x + this._rand(-0.02, 0.02), y + this._rand(-0.02, 0.02), z + this._rand(-0.02, 0.02),
      vx * 0.3 + this._rand(-0.5, 0.5), vy * 0.3 + this._rand(-0.3, 0.5), vz * 0.3 + this._rand(-0.5, 0.5),
      3, this._rand(0.004, 0.009), this._r, this._g, this._b, 0.16, F.DIE | (splat ? F.SPLAT : 0));
    if (this.rng.next() < 0.12) {
      this.soft.spawn(SK.MIST, x, y, z, vx * 0.1, 0, vz * 0.1, this._rand(0.4, 0.7), 0.04, this._rand(0.12, 0.22),
        0.11, 0.008, 0.006, 0.25, 3, 0.05);
    }
  }

  // ------------------------------------------------------------------ публичный API
  bulletImpact(point, normal, surface = 'dirt') {
    if (!point) return;
    let nx = normal ? normal.x : 0, ny = normal ? normal.y : 1, nz = normal ? normal.z : 0;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    const x = point.x, y = point.y, z = point.z, m = this.mul;
    const far = this._camDist(x, y, z) > 55;
    const ground = (surface === 'dirt' || surface === 'grass') && ny > 0.6;
    const off = ground ? 0.02 : 0.006;
    const dx = x + nx * off, dy = y + ny * off, dz = z + nz * off;
    const rot = this._rand(0, 6.28), flip = this.rng.next() < 0.5;

    if (surface === 'metal') {
      for (let k = this._cnt(14, 24, far); k > 0; k--) {
        this._cone(nx, ny, nz, 0.95);
        const sp = this._rand(4, 14), hot = this._rand(0.7, 1.3);
        this.glow.spawn(GK.SPARK, x, y, z, this._dx * sp, this._dy * sp, this._dz * sp, this._rand(0.18, 0.55),
          this._rand(0.005, 0.009), 0, 7 * hot, 4.4 * hot, 2 * hot, 1, 0.9, 1, F.COLLIDE);
      }
      this.glow.spawn(GK.FLASH, x + nx * 0.03, y + ny * 0.03, z + nz * 0.03, 0, 0, 0, 0.06, 0.05, 0.16, 9, 6, 3.5, 1, 0, 0, 0);
      this.flash(_v.set(x + nx * 0.15, y + ny * 0.15, z + nz * 0.15), 0xffc080, 1.6, 0.07);
      this.soft.spawn(SK.DUST, x + nx * 0.05, y + ny * 0.05, z + nz * 0.05, nx * 0.5, ny * 0.5 + 0.2, nz * 0.5,
        this._rand(0.6, 1.0), 0.03, this._rand(0.15, 0.25), 0.1, 0.1, 0.1, 0.25, 3, -0.02);
      this.decals.add(dx, dy, dz, nx, ny, nz, 0.055, 0.055, rot, CELL.HOLE_METAL, flip, 1, 1, 1, 0.95, 0.45, 0.5, 0);
      return;
    }
    if (surface === 'wood') {
      for (let k = this._cnt(6, 11, far); k > 0; k--) {
        this._cone(nx, ny, nz, 0.85);
        const sp = this._rand(2, 5.5), c = this._rand(0.8, 1.2);
        this.debris.spawn(DK.SPLINTER, x, y, z, this._dx * sp, this._dy * sp, this._dz * sp, this._rand(2.5, 4),
          this._rand(0.008, 0.02), 0.3 * c, 0.2 * c, 0.1 * c, 0.8, 0);
      }
      for (let k = this._cnt(2, 3, far); k > 0; k--) {
        this._cone(nx, ny, nz, 0.5);
        const sp = this._rand(0.4, 1.2);
        this.soft.spawn(SK.DUST, x + nx * 0.04, y + ny * 0.04, z + nz * 0.04, this._dx * sp, this._dy * sp, this._dz * sp,
          this._rand(0.6, 1.0), 0.03, this._rand(0.18, 0.3), 0.2, 0.15, 0.09, 0.35, 3, 0.02);
      }
      this.decals.add(dx, dy, dz, nx, ny, nz, 0.075, 0.075, this._rand(-0.3, 0.3), CELL.HOLE_WOOD, flip, 1, 1, 1, 1, 0.85, 0, 0);
      return;
    }
    if (surface === 'rock' || surface === 'concrete') {
      for (let k = this._cnt(3, 4, far); k > 0; k--) {
        this._cone(nx, ny, nz, 0.55);
        const sp = this._rand(0.5, 1.6);
        this.soft.spawn(SK.DUST, x + nx * 0.05, y + ny * 0.05, z + nz * 0.05, this._dx * sp, this._dy * sp, this._dz * sp,
          this._rand(0.8, 1.4), 0.04, this._rand(0.25, 0.42), 0.16, 0.16, 0.155, 0.45, 2.8, 0.03);
      }
      for (let k = this._cnt(6, 10, far); k > 0; k--) {
        this._cone(nx, ny, nz, 0.8);
        const sp = this._rand(3, 7), c = this._rand(0.7, 1.2);
        this.debris.spawn(DK.CHIP, x, y, z, this._dx * sp, this._dy * sp, this._dz * sp, this._rand(2, 3.5),
          this._rand(0.003, 0.008), 0.13 * c, 0.13 * c, 0.12 * c, 0.85, 0);
      }
      for (let k = this._cnt(2, 4, far); k > 0; k--) {
        this._cone(nx, ny, nz, 0.7);
        const sp = this._rand(5, 11);
        this.glow.spawn(GK.SPARK, x, y, z, this._dx * sp, this._dy * sp, this._dz * sp, this._rand(0.1, 0.25),
          0.006, 0, 6, 3.6, 1.5, 1, 1, 1, F.COLLIDE);
      }
      this.decals.add(dx, dy, dz, nx, ny, nz, 0.12, 0.12, rot, CELL.HOLE_ROCK, flip, 1, 1, 1, 0.95, 0.9, 0, 0);
      return;
    }
    if (surface === 'sandbag') {
      for (let k = this._cnt(3, 4, far); k > 0; k--) {
        this._cone(nx, ny, nz, 0.6);
        const sp = this._rand(0.5, 1.5);
        this.soft.spawn(SK.DUST, x + nx * 0.05, y + ny * 0.05, z + nz * 0.05, this._dx * sp, this._dy * sp, this._dz * sp,
          this._rand(0.9, 1.5), 0.04, this._rand(0.25, 0.42), 0.22, 0.18, 0.12, 0.5, 2.6, 0.05);
      }
      for (let k = this._cnt(5, 8, far); k > 0; k--) {
        this._cone(nx, ny, nz, 0.7);
        const sp = this._rand(1, 3);
        this.debris.spawn(DK.GRAIN, x, y, z, this._dx * sp, this._dy * sp, this._dz * sp, 2, this._rand(0.002, 0.004),
          0.24, 0.19, 0.11, 0.9, F.DIE);
      }
      this._emit(E.TRICKLE, x + nx * 0.01, y - 0.01, z + nz * 0.01, 1, this._rand(0.8, 1.6), 30 * m);
      this.decals.add(dx, dy, dz, nx, ny, nz, 0.075, 0.075, rot, CELL.HOLE_SAND, flip, 1, 1, 1, 1, 0.95, 0, 0);
      return;
    }
    // земля/трава (по умолчанию)
    for (let k = this._cnt(3, 5, far); k > 0; k--) {
      this._cone(nx, ny, nz, 0.6);
      const sp = this._rand(0.4, 1.6);
      this.soft.spawn(SK.DUST, x + nx * 0.06, y + ny * 0.06, z + nz * 0.06, this._dx * sp, this._dy * sp, this._dz * sp,
        this._rand(0.9, 1.6), 0.06, this._rand(0.32, 0.55), 0.085, 0.07, 0.055, 0.55, 2.5, 0.02);
    }
    for (let k = this._cnt(1, 2, far); k > 0; k--) { // фонтанчик земли
      this._cone(nx, ny, nz, 0.25);
      const sp = this._rand(2, 3.2);
      this.soft.spawn(SK.DUST, x, y + 0.03, z, this._dx * sp, this._dy * sp, this._dz * sp, this._rand(0.5, 0.8), 0.03,
        this._rand(0.12, 0.2), 0.06, 0.048, 0.036, 0.6, 3, 0.4);
    }
    for (let k = this._cnt(6, 12, far); k > 0; k--) {
      this._cone(nx, ny, nz, 0.7);
      const sp = this._rand(2, 5.5), c = this._rand(0.7, 1.3);
      this.debris.spawn(DK.CLOD, x, y + 0.01, z, this._dx * sp, this._dy * sp, this._dz * sp, this._rand(2.5, 4),
        this._rand(0.004, 0.012), 0.035 * c, 0.026 * c, 0.018 * c, 0.92, 0);
    }
    this.decals.add(dx, dy, dz, nx, ny, nz, 0.16, 0.16, rot, CELL.HOLE_DIRT, flip, 1, 1, 1, 0.92, 0.95, 0, 0);
  }

  bloodHit(point, dir, intensity = 1) {
    if (!point) return;
    const I = clamp(intensity, 0.2, 3), m = this.mul;
    let dx = dir ? dir.x : 0, dy = dir ? dir.y : 0, dz = dir ? dir.z : -1;
    const dl = Math.hypot(dx, dy, dz) || 1;
    dx /= dl; dy /= dl; dz /= dl;
    const x = point.x, y = point.y, z = point.z;
    const n = Math.round(this._rand(20, 40) * I * m);
    const cap = Math.min(8, Math.round(2 + 3 * I));
    for (let k = 0; k < n; k++) { // выходной конус брызг
      this._cone(dx, dy, dz, 0.38);
      const sp = this._rand(2.5, 8) * (0.7 + 0.3 * I);
      this._bloodColor(this.rng.next());
      this.debris.spawn(DK.BLOOD, x, y, z, this._dx * sp, this._dy * sp + 0.6, this._dz * sp, 3,
        this._rand(0.005, 0.016), this._r, this._g, this._b, 0.15, F.DIE | (k < cap ? F.SPLAT : 0));
    }
    for (let k = Math.round(n * 0.22); k > 0; k--) { // обратные брызги
      this._cone(-dx, -dy, -dz, 0.55);
      const sp = this._rand(0.8, 2.6);
      this._bloodColor(0.5);
      this.debris.spawn(DK.BLOOD, x, y, z, this._dx * sp, this._dy * sp + 0.4, this._dz * sp, 3,
        this._rand(0.004, 0.01), this._r, this._g, this._b, 0.15, F.DIE);
    }
    for (let k = Math.round(this._rand(5, 8) * m); k > 0; k--) { // мелкая быстрая взвесь
      this._cone(dx, dy, dz, 0.25);
      const sp = this._rand(9, 14);
      this.debris.spawn(DK.BLOOD, x, y, z, this._dx * sp, this._dy * sp, this._dz * sp, 2, 0.003, 0.08, 0.005, 0.004, 0.2, F.DIE);
    }
    for (let k = Math.round(this._rand(2, 4) * Math.sqrt(I)); k > 0; k--) { // кровавое облачко
      this._cone(dx, dy, dz, 0.6);
      const sp = this._rand(0.6, 1.8);
      this.soft.spawn(SK.MIST, x + dx * 0.08, y + dy * 0.08, z + dz * 0.08, this._dx * sp, this._dy * sp, this._dz * sp,
        this._rand(0.45, 0.8), 0.06, this._rand(0.32, 0.55) * Math.sqrt(I), 0.13, 0.009, 0.007, 0.42, 3, 0.05);
    }
  }

  bloodBurst(point, intensity = 1) {
    if (!point) return;
    const I = clamp(intensity, 0.3, 3), m = this.mul;
    const x = point.x, y = point.y, z = point.z;
    const n = Math.round(this._rand(60, 120) * I * m);
    const cap = Math.min(14, Math.round(6 + 4 * I));
    for (let k = 0; k < n; k++) {
      this._sphere(0.35);
      const sp = this._rand(1.5, 9) * (0.75 + 0.25 * I);
      this._bloodColor(this.rng.next());
      this.debris.spawn(DK.BLOOD, x + this._dx * 0.05, y + this._dy * 0.05, z + this._dz * 0.05,
        this._dx * sp, this._dy * sp + 1, this._dz * sp, 3, this._rand(0.006, 0.024), this._r, this._g, this._b, 0.15,
        F.DIE | (k < cap ? F.SPLAT : 0));
    }
    for (let k = Math.round(this._rand(6, 10) * Math.sqrt(I) * m); k > 0; k--) {
      this._sphere(0.2);
      const sp = this._rand(0.5, 2.2);
      this.soft.spawn(SK.MIST, x + this._dx * 0.1, y + this._dy * 0.1, z + this._dz * 0.1, this._dx * sp, this._dy * sp, this._dz * sp,
        this._rand(0.8, 1.4), 0.15, this._rand(0.7, 1.2) * Math.sqrt(I), 0.12, 0.008, 0.006, 0.45, 2.5, 0.04);
    }
    for (let k = Math.round(this._rand(4, 8) * Math.min(1.5, I)); k > 0; k--) {
      this._sphere(0.5);
      const sp = this._rand(2, 4.5);
      this.chunks.spawn(x, y, z, this._dx * sp, this._dy * sp + this._rand(1.5, 3.5), this._dz * sp,
        this._rand(0.025, 0.06), this._rand(8, 11));
    }
  }

  bloodPool(point, size = 1) {
    if (!point) return;
    const d = this._rand(0.8, 1.6) * size;
    const k = this._rand(0.8, 1.05);
    this._groundDecal(point.x, point.z, d, d * this._rand(0.85, 1.15), this._rand(0, 6.28), CELL.POOL + (this.rng.next() < 0.5 ? 0 : 1),
      0.05 * k, 0.0032 * k, 0.0025 * k, 0.97, 0.1, 0, 0, 1e9, this._rand(3, 4), 0.1);
  }

  addGib(object3D, velocity, angularVelocity, opts) {
    this.gibs.add(object3D, velocity, angularVelocity, opts);
  }

  tracer(from, to, color = 0xffd27a) {
    if (!from || !to) return;
    _c.set(color);
    this.glow.tracer(from.x, from.y, from.z, to.x, to.y, to.z, _c.r * 9, _c.g * 9, _c.b * 9, 0.011);
  }

  flash(position, color = 0xffaa55, intensity = 3, duration = 0.08) {
    if (!position) return;
    // самый «выгоревший» огонь из пула
    let best = 0, bestK = -1;
    for (let i = 0; i < 4; i++) {
      const L = this.lights[i];
      const k = L.t >= L.dur ? 2 : L.t / L.dur;
      if (k > bestK) { bestK = k; best = i; }
    }
    const L = this.lights[best];
    L.light.position.copy(position);
    L.light.color.set(color);
    L.t = 0; L.dur = Math.max(0.01, duration); L.i0 = intensity;
    L.light.intensity = intensity;
  }

  explosion(position, radius = 5) {
    if (!position) return;
    const s = clamp(radius / 5, 0.4, 2), m = this.mul, ss = Math.sqrt(s);
    const x = position.x, z = position.z, gy = this.heightAt(x, z), y = Math.max(position.y, gy);
    const cy = y + 0.25 * s;
    this.flash(_v.set(x, cy + 0.8 * s, z), 0xff9448, 170 * s, 0.5);
    // ослепительное ядро
    this.glow.spawn(GK.FLASH, x, cy + 0.4 * s, z, 0, 0, 0, 0.12, 0.9 * s, 2.8 * s, 10, 7.5, 5, 1, 0, 0, 0);
    // огненный шар: слои раскалённых клубов
    for (let k = Math.round(28 * Math.pow(s, 0.7) * (0.5 + 0.5 * m)); k > 0; k--) {
      this._sphere(0.35);
      const sp = this._rand(3, 9.5) * s, rr = this._rand(0, 0.35) * s;
      const i = this.glow.spawn(GK.FIRE, x + this._dx * rr, cy + 0.2 * s + this._dy * rr, z + this._dz * rr,
        this._dx * sp, this._dy * sp + 1.5 * s, this._dz * sp, this._rand(0.35, 0.85),
        this._rand(0.35, 0.6) * s, this._rand(1.0, 1.75) * s, 1, 1, 1, this._rand(0.6, 0.9), 4.5, -0.12, 0);
      this.glow.heat[i] = this._rand(1.0, 1.4);
      this.glow.spin[i] = this._rand(-2.5, 2.5);
    }
    for (let k = Math.round(7 * s); k > 0; k--) { // поднимающиеся языки
      const i = this.glow.spawn(GK.FIRE, x + this._rand(-0.4, 0.4) * s, cy + 0.5 * s, z + this._rand(-0.4, 0.4) * s,
        this._rand(-0.8, 0.8), this._rand(4, 7) * ss, this._rand(-0.8, 0.8), this._rand(0.7, 1.1),
        0.5 * s, this._rand(1.1, 1.6) * s, 1, 1, 1, this._rand(0.5, 0.75), 2.2, -0.05, 0);
      this.glow.heat[i] = this._rand(0.8, 1.05);
      this.glow.spin[i] = this._rand(-1.5, 1.5);
    }
    this._emit(E.SMOKE, x, y, z, s, 0.55, (26 * s * m) / 0.55);
    this._emit(E.BURN, x, gy, z, s, 1.8, 16 * s * m);
    // кольцо пыли от ударной волны
    const nr = Math.round(18 * s * m);
    for (let k = 0; k < nr; k++) {
      const a = (k / nr) * 6.283 + this._rand(-0.15, 0.15), cx = Math.cos(a), cz = Math.sin(a), sp = this._rand(7, 12) * s;
      const c = this._rand(0.8, 1.2);
      this.soft.spawn(SK.DUST, x + cx * 0.6 * s, gy + 0.3 * s, z + cz * 0.6 * s, cx * sp, this._rand(0.2, 0.9), cz * sp,
        this._rand(1.6, 2.6), 0.4 * s, this._rand(1.6, 2.4) * s, 0.075 * c, 0.062 * c, 0.05 * c, 0.42, 3.2, 0);
    }
    // столб земли
    for (let k = Math.round(9 * s * m); k > 0; k--) {
      const c = this._rand(0.8, 1.2);
      this.soft.spawn(SK.DUST, x + this._rand(-0.3, 0.3) * s, gy + 0.3, z + this._rand(-0.3, 0.3) * s,
        this._rand(-1.2, 1.2) * s, this._rand(4, 9.5) * s, this._rand(-1.2, 1.2) * s, this._rand(1.8, 3),
        0.3 * s, this._rand(1.0, 1.8) * s, 0.045 * c, 0.036 * c, 0.027 * c, 0.65, 2.2, 0.15);
    }
    // комья земли
    for (let k = Math.round(46 * s * m); k > 0; k--) {
      this._cone(0, 1, 0, 1.1);
      const sp = this._rand(4, 14) * ss, c = this._rand(0.7, 1.3);
      this.debris.spawn(DK.CLOD, x + this._rand(-0.3, 0.3) * s, gy + 0.1, z + this._rand(-0.3, 0.3) * s,
        this._dx * sp, this._dy * sp, this._dz * sp, this._rand(3, 5), this._rand(0.01, 0.045) * ss,
        0.035 * c, 0.026 * c, 0.018 * c, 0.9, 0);
    }
    // искры
    for (let k = Math.round(42 * s * m); k > 0; k--) {
      this._sphere(0.45);
      const sp = this._rand(8, 24) * ss, hot = this._rand(0.7, 1.3);
      this.glow.spawn(GK.SPARK, x, cy + 0.3 * s, z, this._dx * sp, this._dy * sp, this._dz * sp, this._rand(0.5, 1.4),
        this._rand(0.008, 0.016), 0, 7 * hot, 4.2 * hot, 1.8 * hot, 1, 0.7, 1, F.COLLIDE);
    }
    // угольки
    for (let k = Math.round(16 * s * m); k > 0; k--) {
      this._sphere(0.6);
      const sp = this._rand(2, 6) * ss;
      this.glow.spawn(GK.EMBER, x, cy + 0.5 * s, z, this._dx * sp, this._dy * sp + 2, this._dz * sp, this._rand(2, 4),
        this._rand(0.01, 0.02), 0, 5, 2, 0.5, 1, 1.5, 0.08, F.COLLIDE);
    }
    const sd = radius * this._rand(0.65, 0.8);
    this._groundDecal(x, z, sd, sd, this._rand(0, 6.28), CELL.SCORCH, 1, 1, 1, 0.92, 0.95, 0, 0, 1e9, 0.15, 0.6);
  }

  shellCasing(position, velocity, kind = 'pistol') {
    if (!position) return;
    const k = CASING_KIND[kind] !== undefined ? CASING_KIND[kind] : 0;
    this.casings.spawn(position.x, position.y, position.z, velocity ? velocity.x : 0, velocity ? velocity.y : 0,
      velocity ? velocity.z : 0, k);
  }

  muzzleSmoke(position, dir) {
    if (!position) return;
    let dx = dir ? dir.x : 0, dy = dir ? dir.y : 0, dz = dir ? dir.z : -1;
    const dl = Math.hypot(dx, dy, dz) || 1;
    dx /= dl; dy /= dl; dz /= dl;
    for (let k = Math.round(this._rand(3, 5) * Math.max(0.6, this.mul)); k > 0; k--) {
      const o = this._rand(0, 0.12), sp = this._rand(0.6, 1.8);
      const i = this.soft.spawn(SK.SMOKE, position.x + dx * o, position.y + dy * o, position.z + dz * o,
        dx * sp + this._rand(-0.15, 0.15), dy * sp + this._rand(0.2, 0.5), dz * sp + this._rand(-0.15, 0.15),
        this._rand(1.2, 2.2), this._rand(0.03, 0.05), this._rand(0.25, 0.45), 0.12, 0.12, 0.125, this._rand(0.16, 0.26), 2.8, -0.03);
      this.soft.fin[i] = 0.05;
    }
  }

  dirtBurst(position, intensity = 1) {
    if (!position) return;
    const I = clamp(intensity, 0.2, 3), m = this.mul, sI = Math.sqrt(I);
    const x = position.x, z = position.z, y = Math.max(position.y, this.heightAt(x, z));
    for (let k = Math.round(this._rand(10, 25) * I * m); k > 0; k--) {
      this._cone(0, 1, 0, 0.8);
      const sp = this._rand(1.5, 5) * sI, c = this._rand(0.7, 1.3);
      this.debris.spawn(DK.CLOD, x + this._rand(-0.15, 0.15), y + 0.03, z + this._rand(-0.15, 0.15),
        this._dx * sp, this._dy * sp, this._dz * sp, this._rand(2.5, 4), this._rand(0.006, 0.025),
        0.035 * c, 0.026 * c, 0.018 * c, 0.92, 0);
    }
    for (let k = Math.round(this._rand(4, 8) * sI * m); k > 0; k--) {
      const a = this.rng.next() * 6.283, r = this._rand(0.3, 1), c = this._rand(0.8, 1.2);
      this.soft.spawn(SK.DUST, x + Math.cos(a) * 0.15, y + 0.1, z + Math.sin(a) * 0.15,
        Math.cos(a) * r, this._rand(0.4, 1.2), Math.sin(a) * r, this._rand(1.2, 2.2), 0.15 * sI,
        this._rand(0.7, 1.1) * sI, 0.08 * c, 0.066 * c, 0.052 * c, 0.5, 2, 0.02);
    }
  }

  acidSplash(position) {
    if (!position) return;
    const x = position.x, y = position.y, z = position.z, m = this.mul;
    const n = Math.round(this._rand(20, 30) * m);
    for (let k = 0; k < n; k++) {
      this._sphere(0.5);
      const sp = this._rand(1.5, 4.5);
      const i = this.debris.spawn(DK.ACID, x, y + 0.03, z, this._dx * sp, this._dy * sp + 0.5, this._dz * sp, 3,
        this._rand(0.006, 0.016), 0.22, 0.85, 0.05, 0.2, F.DIE | (k < 4 ? F.SPLAT : 0));
      this.debris.emis[i] = 1.6;
    }
    for (let k = Math.round(this._rand(3, 5)); k > 0; k--) {
      this._sphere(0.4);
      const sp = this._rand(0.3, 1.2);
      const i = this.soft.spawn(SK.MIST, x, y + 0.1, z, this._dx * sp, this._dy * sp, this._dz * sp, this._rand(0.7, 1.2),
        0.1, this._rand(0.4, 0.7), 0.15, 0.45, 0.03, 0.3, 2.5, -0.01);
      this.soft.em[i] = -0.3;
    }
    this.glow.spawn(GK.FLASH, x, y + 0.08, z, 0, 0, 0, 0.16, 0.12, 0.55, 1.0, 3.2, 0.4, 1, 0, 0, 0);
  }

  acidPuddle(position, radius = 1, duration = 6) {
    const handle = { position: new THREE.Vector3(), radius, alive: true };
    if (!position) { handle.alive = false; return handle; }
    const x = position.x, z = position.z, y = this.heightAt(x, z);
    handle.position.set(x, y, z);
    const d = radius * 2.1;
    const i = this._groundDecal(x, z, d, d, this._rand(0, 6.28), CELL.ACID, 0.18, 0.62, 0.03, 0.92, 0.16, 0, 1.4,
      duration, 0.35, 0.3);
    this.decals.setPulse(i, true);
    this._emit(E.ACID, x, y, z, radius, duration, 9 * radius * radius * this.mul + 3, handle);
    return handle;
  }

  gasCloud(position, radius = 3) {
    if (!position) return;
    const e = this._emit(E.GAS, position.x, position.y, position.z, radius, 1.0, 20 * this.mul);
    if (e) for (let k = 0; k < 5; k++) this._gasPuff(e);
  }

  clear() {
    this.glow.clear(); this.soft.clear(); this.debris.clear();
    this.glow.geo.instanceCount = 0; this.soft.geo.instanceCount = 0;
    this.glow.mesh.visible = false; this.soft.mesh.visible = false;
    this.debris.mesh.count = 0; this.debris.mesh.visible = false;
    this.decals.clear(); this.chunks.clear(); this.casings.clear(); this.gibs.clear();
    for (let i = 0; i < this.emitters.length; i++) {
      const e = this.emitters[i];
      if (e.on && e.handle) e.handle.alive = false;
      e.on = false; e.handle = null;
    }
    for (let i = 0; i < 4; i++) { const L = this.lights[i]; L.t = L.dur; L.light.intensity = 0; }
    this.splatN = 0;
  }

  setQuality(q) {
    if (QUALITY[q]) { this.quality = q; this.mul = Math.min(QUALITY[q].mul, 1); }
  }

  // число активных элементов (для отладки/сэндбокса)
  stats() {
    return {
      glow: this.glow.n, soft: this.soft.n, debris: this.debris.n, decals: this.decals.used,
      chunks: this.chunks.n, casings: this.casings.n, gibs: this.gibs.n,
    };
  }

  dispose() {
    this.clear();
    if (this.group.parent) this.group.parent.remove(this.group);
    for (const s of [this.glow, this.soft, this.debris, this.decals, this.chunks, this.casings]) {
      s.mesh.geometry.dispose();
      s.material.dispose();
    }
    this.noiseTex.dispose(); this.atlas.map.dispose(); this.atlas.normalMap.dispose(); this.meatTex.dispose();
  }
}
