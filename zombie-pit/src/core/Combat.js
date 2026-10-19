// Бой: лучевые попадания по зомби и миру, удар ножом, взрывы. Сам вызывает эффекты, звук и хит-маркеры.
import * as THREE from 'three';

const _v = new THREE.Vector3(), _n = new THREE.Vector3();
const ray = new THREE.Raycaster();

export class Combat {
  constructor({ world, zombies, fx, audio, hud, player, stats }) {
    Object.assign(this, { world, zombies, fx, audio, hud, player, stats });
    this.markerFrame = -1;
    this.frame = 0;
    this.onShake = null;
    this.onPlayerHurt = null;
  }

  /** попадание луча в землю (карта высот), кроме провала ямы */
  hitGround(o, d, maxT) {
    const w = this.world;
    if (d.y > -1e-4) return null;
    let t = Math.max(0, (o.y - w.heightAt(o.x, o.z)) / -d.y);
    for (let i = 0; i < 4; i++) {
      const x = o.x + d.x * t, z = o.z + d.z * t;
      const h = w.heightAt(x, z);
      t = Math.max(0, (o.y - h) / -d.y);
    }
    if (t > maxT) return null;
    const x = o.x + d.x * t, z = o.z + d.z * t;
    if (Math.hypot(x, z) < w.pit.radiusAt(Math.atan2(z, x))) return null;
    const e = 0.3;
    _n.set(w.heightAt(x - e, z) - w.heightAt(x + e, z), 2 * e, w.heightAt(x, z - e) - w.heightAt(x, z + e)).normalize();
    return { t, point: new THREE.Vector3(x, o.y + d.y * t, z), normal: _n.clone(), surface: w.surfaceAt?.(x, z) === 'grass' ? 'grass' : 'dirt' };
  }

  raycastWorld(o, d, maxT) {
    let best = this.hitGround(o, d, maxT);
    const meshes = this.world.raycastMeshes;
    if (meshes && meshes.length) {
      ray.set(o, d); ray.near = 0; ray.far = best ? best.t : maxT;
      const hits = ray.intersectObjects(meshes, true);
      if (hits.length) {
        const h = hits[0];
        let obj = h.object, surface = obj.userData.surface;
        while (!surface && obj.parent) { obj = obj.parent; surface = obj.userData.surface; }
        const normal = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : d.clone().negate();
        if (normal.dot(d) > 0) normal.negate();
        best = { t: h.distance, point: h.point.clone(), normal, surface: surface || 'rock' };
      }
    }
    return best;
  }

  fireBullet({ origin, dir, damage, range = 120, force = 1, weaponId = 'pistol', pellet = false }) {
    const st = this.stats;
    st.shots += pellet ? 1 / 9 : 1;
    const zh = this.zombies.raycast(origin, dir, range);
    const wh = this.raycastWorld(origin, dir, zh ? zh.t : range);
    if (wh && (!zh || wh.t < zh.t)) {
      this.fx?.bulletImpact?.(wh.point, wh.normal, wh.surface);
      if (!pellet || Math.random() < 0.35) this.audio?.bulletImpact?.(wh.point, wh.surface);
      return { point: wh.point, kind: 'world', killed: false, headshot: false, distance: wh.t };
    }
    if (zh) {
      const z = zh.zombie;
      const wasAlive = z.alive;
      const res = z.hit(zh.part, zh.point, dir, damage, { weaponId, force, pellet });
      if (wasAlive) {
        st.hits += pellet ? 1 / 9 : 1;
        if (res.headshot) st.headshotHits++;
        this.marker(res.killed ? 'kill' : res.headshot ? 'headshot' : 'hit');
      }
      if (!pellet || Math.random() < 0.4) this.audio?.fleshHit?.(zh.point, res.headshot);
      return { point: zh.point, kind: 'zombie', killed: res.killed, headshot: res.headshot, distance: zh.t };
    }
    return { point: null, kind: 'none', killed: false, headshot: false, distance: range };
  }

  marker(kind) {
    // дробь даёт много попаданий за кадр — показываем один, самый «сильный» маркер
    if (this.markerFrame === this.frame && kind === 'hit') return;
    this.markerFrame = this.frame;
    this.hud?.hitMarker?.(kind);
    this.audio?.hitMarker?.(kind);
  }

  melee({ origin, dir, range = 1.9, damage = 80, force = 3 }) {
    let best = null, bestD = range + 0.6;
    for (const z of this.zombies.active) {
      if (!z.group.visible || z.sinking) continue;
      for (const part of [z.alive ? 'head' : null, 'chest', 'belly']) {
        if (!part) continue;
        const P = PARTS_BY.get(part);
        if (z.lost[P.limb]) continue;
        z.bone(P.a, _v);
        const dx = _v.x - origin.x, dy = _v.y - origin.y, dz = _v.z - origin.z;
        const d = Math.hypot(dx, dy, dz);
        if (d > bestD) continue;
        const cos = (dx * dir.x + dy * dir.y + dz * dir.z) / (d || 1);
        if (cos < 0.62) continue;
        bestD = d; best = { z, part: P, point: _v.clone() };
      }
    }
    if (!best) {
      const wh = this.raycastWorld(origin, dir, range);
      if (wh) this.fx?.bulletImpact?.(wh.point, wh.normal, wh.surface);
      return { hit: false, killed: false };
    }
    const wasAlive = best.z.alive;
    const res = best.z.hit(best.part, best.point, dir, damage, { weaponId: 'knife', force, melee: true });
    if (wasAlive) this.marker(res.killed ? 'kill' : 'hit');
    this.audio?.fleshHit?.(best.point, false);
    return { hit: true, killed: res.killed };
  }

  explode({ position, radius = 6.5, damage = 300, force = 14 }) {
    this.fx?.explosion?.(position, radius);
    this.audio?.explosion?.(position);
    this.zombies.explode(position, radius, damage, force, 'explosion');
    const p = this.player;
    const d = Math.hypot(p.pos.x - position.x, p.pos.y + 1 - position.y, p.pos.z - position.z);
    if (d < radius) this.onPlayerHurt?.(damage * 0.28 * (1 - d / radius), position, 'explosion');
    this.onShake?.(Math.max(0.15, 1.2 - d / (radius * 2.2)), position);
  }
}

import { PARTS } from '../zombies/Zombie.js';
const PARTS_BY = new Map(PARTS.map((p) => [p.name, p]));
