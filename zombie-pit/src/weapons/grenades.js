// Брошенные гранаты в основной сцене: баллистика, отскоки от земли и коллайдеров, вращение, запал.
import * as THREE from 'three';
import { buildGrenade } from './models.js';

const R = 0.034, G = 18, FUSE = 2.5;
const _n = new THREE.Vector3(), _q = new THREE.Quaternion(), _ax = new THREE.Vector3();

export class Grenades {
  constructor({ scene, world, audio, combat, M }) {
    this.scene = scene; this.world = world; this.audio = audio; this.combat = combat;
    // отдельные материалы без шейдера износа (он рассчитан на дистанцию вьюмодели)
    const plain = (src) => {
      const m = new THREE.MeshStandardMaterial();
      for (const k of ['color', 'map', 'roughnessMap', 'metalnessMap', 'normalMap', 'normalScale', 'metalness', 'roughness', 'vertexColors']) {
        if (src[k] && src[k].clone && !src[k].isTexture) m[k] = src[k].clone(); else m[k] = src[k];
      }
      return m;
    };
    this.proto = buildGrenade({ paint: plain(M.paint), steel: plain(M.steel) });
    this.proto.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = true; } });
    this.list = []; this.pool = [];
  }

  ground(x, z) { const w = this.world; return w && w.heightAt ? w.heightAt(x, z) : 0; }

  spawn(pos, vel) {
    const obj = this.pool.pop() || this.proto.clone();
    obj.position.copy(pos);
    obj.quaternion.setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
    this.scene.add(obj);
    const axis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    this.list.push({ obj, vel: vel.clone(), axis, spin: 9 + Math.random() * 6, fuse: FUSE, lastBounce: -1, t: 0 });
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const g = this.list[i], p = g.obj.position, v = g.vel;
      g.t += dt; g.fuse -= dt;
      v.y -= G * dt;
      p.addScaledVector(v, dt);
      // земля: нормаль по градиенту высоты
      const gy = this.ground(p.x, p.z) + R;
      if (p.y < gy) {
        const e = 0.12, hx = this.ground(p.x + e, p.z) - this.ground(p.x - e, p.z), hz = this.ground(p.x, p.z + e) - this.ground(p.x, p.z - e);
        _n.set(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
        p.y = gy;
        const vn = v.dot(_n);
        if (vn < 0) {
          const imp = -vn;
          v.addScaledVector(_n, -vn);                 // касательная часть
          v.multiplyScalar(imp > 2 ? 0.72 : 0.88);    // трение
          v.addScaledVector(_n, imp * 0.35);          // упругость 0.35
          g.spin = g.spin * 0.6 + Math.hypot(v.x, v.z) * 12;
          g.axis.set(v.z, 0, -v.x).normalize();
          if (!g.axis.lengthSq()) g.axis.set(1, 0, 0);
          if (imp > 1.2 && g.t - g.lastBounce > 0.08) { g.lastBounce = g.t; this.audio?.grenadeBounce?.(p.clone()); }
        }
        const k = Math.exp(-3 * dt);
        v.x *= k; v.z *= k;
        if (Math.abs(v.y) < 0.3) v.y = 0;
      }
      // коллайдеры-окружности
      const cols = this.world?.colliders;
      if (cols) for (const c of cols) {
        const dx = p.x - c.x, dz = p.z - c.z, d2 = dx * dx + dz * dz, rr = c.r + R;
        if (d2 >= rr * rr) continue;
        const hgt = c.h ?? c.height ?? 1.4;
        if (p.y > this.ground(c.x, c.z) + hgt) continue;
        const d = Math.sqrt(d2) || 1e-4, nx = dx / d, nz = dz / d;
        p.x = c.x + nx * rr; p.z = c.z + nz * rr;
        const vn = v.x * nx + v.z * nz;
        if (vn < 0) {
          v.x -= 1.45 * vn * nx; v.z -= 1.45 * vn * nz; v.x *= 0.8; v.z *= 0.8;
          if (-vn > 1.2 && g.t - g.lastBounce > 0.08) { g.lastBounce = g.t; this.audio?.grenadeBounce?.(p.clone()); }
        }
      }
      // вращение
      g.spin *= Math.exp(-0.8 * dt);
      _q.setFromAxisAngle(g.axis, g.spin * dt);
      g.obj.quaternion.premultiply(_q);
      if (g.fuse <= 0) {
        this.combat?.explode?.({ position: p.clone(), radius: 6.5, damage: 300, force: 14 });
        this._remove(i);
      }
    }
  }

  _remove(i) {
    const g = this.list[i];
    this.scene.remove(g.obj); this.pool.push(g.obj);
    this.list.splice(i, 1);
  }

  clear() { while (this.list.length) this._remove(this.list.length - 1); }
}
