// Менеджер зомби: варианты тел, пулы, спавн, общий ИИ (обход ямы/препятствий, расталкивание),
// попадания лучом, взрывы, кислотные плевки и взрыв толстяка.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildBody } from './body.js';
import { boneInverses } from './rig.js';
import { VARIANTS, TYPES } from './types.js';
import { Zombie } from './Zombie.js';
import { RNG, clamp } from '../core/noise.js';
import { sharedTime } from './material.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

function teethGeometry(mouth, hs, origin, upper, rng) {
  const parts = [];
  const n = 8;
  for (let i = 0; i < n; i++) {
    if (rng.chance(0.18)) continue; // выбитые зубы
    const t = (i / (n - 1)) * 2 - 1;
    const w = 0.0058 * hs, h = (0.0085 + rng.range(-0.002, 0.003)) * hs, d = 0.0045 * hs;
    const g = new THREE.BoxGeometry(w, h, d);
    const x = t * 0.024 * hs * (mouth.r[0] / (0.03 * hs));
    const z = mouth.c[2] - 0.012 * hs - t * t * 0.014 * hs;
    const y = mouth.c[1] + (upper ? 0.0035 : -0.0035) * hs;
    g.rotateY(-t * 0.6); g.rotateZ(rng.range(-0.25, 0.25));
    g.translate(x - origin[0], y - origin[1], z - origin[2]);
    parts.push(g);
  }
  return parts.length ? mergeGeometries(parts) : new THREE.BufferGeometry();
}

function makeProps() {
  const std = (c, r = 0.5, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
  // каска строителя
  const hat = new THREE.Group();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.105, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), std(0x9a7a12, 0.45));
  dome.scale.set(1, 0.85, 1.12);
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.125, 0.008, 18), std(0x8a6c10, 0.5));
  brim.position.set(0, 0.002, 0.02); brim.scale.set(1, 1, 1.15);
  hat.add(dome, brim);
  hat.traverse((o) => { o.castShadow = true; });
  // тесак мясника: лезвие + рукоять (по оси кисти: вниз −Y, лезвие вперёд +Z)
  const cleaver = new THREE.Group();
  const blade = new THREE.Mesh(new RoundedBoxGeometry(0.012, 0.2, 0.32, 2, 0.004), std(0x6d6a66, 0.32, 0.9));
  blade.position.set(0, -0.11, 0.2);
  const edge = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.2, 0.02), std(0x9c9a96, 0.2, 1));
  edge.position.set(0, -0.11, 0.365);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.17, 10), std(0x2b1a10, 0.7));
  handle.rotation.x = Math.PI / 2; handle.position.set(0, -0.06, -0.02);
  const blood = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.12, 0.16), std(0x3a0503, 0.25));
  blood.position.set(0, -0.15, 0.27);
  cleaver.add(blade, edge, handle, blood);
  cleaver.position.set(0, -0.09, 0.03);
  cleaver.traverse((o) => { o.castShadow = true; });
  // ржавая арматура, торчащая из груди громилы
  const rebar = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.9, 6), std(0x4a2a18, 0.85, 0.4));
  rebar.castShadow = true;
  return { hardHat: hat, cleaver, rebar };
}

export class ZombieManager {
  constructor({ scene, world, audio, fx, quality = 'high' }) {
    this.scene = scene; this.world = world; this.audio = audio; this.fx = fx; this.quality = quality;
    this.rng = new RNG(20261019);
    this.variants = {};
    this.pools = {};
    this.active = [];
    this.corpses = [];
    this.projectiles = [];
    this.target = new THREE.Vector3(0, 0, 22);
    this.targetHeight = 1.6;
    this.targetAlive = true;
    this.hpMul = 1; this.speedMul = 1;
    this.corpseTime = 14;
    this.maxCorpses = quality === 'low' ? 6 : quality === 'medium' ? 10 : 14;
    this.props = makeProps();
    this.onKill = null; this.onPlayerHit = null; this.onSummon = null; this.onShake = null; this.onSever = null; this.onAcid = null;
    this.acidMat = new THREE.MeshStandardMaterial({ color: 0x3a6a10, emissive: 0x7dff2a, emissiveIntensity: 2.2, roughness: 0.2 });
    this.acidGeo = new THREE.IcosahedronGeometry(0.11, 1);
  }

  /** строит все варианты тел; прогресс 0..1 */
  async build(onProgress, only) {
    const ids = only || Object.keys(VARIANTS);
    for (let i = 0; i < ids.length; i++) {
      if (!this.variants[ids[i]]) this.buildVariant(ids[i]);
      onProgress?.((i + 1) / ids.length, ids[i]);
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  buildVariant(id) {
    const spec = VARIANTS[id]();
    const body = buildBody(spec);
    const geo = body.geometry;
    geo.setAttribute('aRest', geo.getAttribute('position'));
    const R = body.rig, hs = R.hs, J = body.joints;
    const rng = new RNG(spec.seed);
    const v = {
      id, spec, geometry: geo, joints: J, rig: R, sockets: body.sockets, gibs: body.gibs,
      inverses: boneInverses(J),
      teethUpper: teethGeometry(body.mouth, hs, J.head, true, rng),
      teethLower: teethGeometry(body.mouth, hs, J.jaw, false, rng),
      height: R.headY + 0.2 * hs,
      girth: {
        head: hs, neck: spec.H * spec.neckW, torso: spec.H * spec.thick * (0.5 + 0.5 * spec.shoulderW),
        belly: spec.H * spec.thick * (1 + spec.belly * 0.85), limb: spec.H * spec.limb * Math.sqrt(spec.muscle),
      },
      clipCtx: { lift: 0.11 * spec.H * spec.thick * (1 + 0.55 * spec.belly), kneel: R.kneeY - R.ankleY },
      stats: body.stats,
    };
    this.variants[id] = v;
    this.pools[id] = [];
    return v;
  }

  spawn(type, opts = {}) {
    const T = TYPES[type];
    let vid = opts.variant || this.rng.pick(T.variants);
    if (!this.variants[vid]) {
      vid = T.variants.find((x) => this.variants[x]) || Object.keys(this.variants)[0];
      if (!this.variants[vid]) this.buildVariant(vid);
    }
    const pool = this.pools[vid];
    const z = pool.pop() || new Zombie(this, this.variants[vid]);
    z.released = false;
    if (opts.angle === undefined && !opts.position) opts.angle = this.pickAngle();
    z.spawn(type, opts);
    this.active.push(z);
    return z;
  }

  /** угол появления: не рядом с недавними, чаще с той стороны, куда видит игрок */
  pickAngle() {
    this.recent = this.recent || [];
    let best = 0, bestScore = -1;
    for (let i = 0; i < 8; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      let score = 1;
      for (const r of this.recent) { const d = Math.abs(Math.atan2(Math.sin(a - r), Math.cos(a - r))); score = Math.min(score, d); }
      if (score > bestScore) { bestScore = score; best = a; }
    }
    this.recent.push(best);
    if (this.recent.length > 4) this.recent.shift();
    return best;
  }

  get aliveCount() { let n = 0; for (const z of this.active) if (z.alive) n++; return n; }

  update(dt) {
    sharedTime.value += dt;
    const act = this.active;
    for (let i = 0; i < act.length; i++) act[i].update(dt);
    this.separate(dt);
    // лишние трупы — тонут раньше
    for (let i = this.corpses.length - 1; i >= 0; i--) if (this.corpses[i].released) this.corpses.splice(i, 1);
    let live = 0;
    for (const c of this.corpses) if (!c.sinking) live++;
    for (let i = 0; i < this.corpses.length && live > this.maxCorpses; i++) {
      if (!this.corpses[i].sinking) { this.corpses[i].sinking = true; live--; }
    }
    for (let i = act.length - 1; i >= 0; i--) {
      const z = act[i];
      if (z.released) { act.splice(i, 1); this.pools[z.variant.id].push(z); }
    }
    this.updateProjectiles(dt);
  }

  /** направление движения к цели с обходом ямы */
  steer(z, tgt, out) {
    const p = z.group.position;
    const px = p.x, pz = p.z;
    let dx = tgt.x - px, dz = tgt.z - pz;
    const L2 = dx * dx + dz * dz || 1;
    const t = clamp(-(px * dx + pz * dz) / L2, 0, 1);
    const cx = px + t * dx, cz = pz + t * dz;
    const pit = this.world.pit;
    const Rs = pit.radiusAt(Math.atan2(cz, cx)) + 0.9 + z.T.radius * z.scale;
    const r = Math.hypot(px, pz) || 1;
    if (Math.hypot(cx, cz) < Rs && t > 0.001) {
      const side = px * tgt.z - pz * tgt.x > 0 ? 1 : -1;
      let ux = (-pz / r) * side, uz = (px / r) * side;
      const push = clamp((Rs + 1.2 - r) / 1.5, 0, 1);
      ux += (px / r) * push; uz += (pz / r) * push;
      dx = ux; dz = uz;
    }
    // препятствия мира: отворачиваем по касательной
    const L = Math.hypot(dx, dz) || 1;
    dx /= L; dz /= L;
    for (const c of this.world.colliders) {
      const ox = c.x - px, oz = c.z - pz;
      const rr = c.r + z.T.radius * z.scale + 0.25;
      const ahead = ox * dx + oz * dz;
      if (ahead < 0 || ahead > rr + 2.5) continue;
      const lat = ox * dz - oz * dx;
      if (Math.abs(lat) > rr) continue;
      const s = lat > 0 ? -1 : 1;
      const k = 1 - Math.abs(lat) / rr;
      dx += dz * s * k * 1.5; dz += -dx * s * k * 1.5;
    }
    const L3 = Math.hypot(dx, dz) || 1;
    return out.set(dx / L3, 0, dz / L3);
  }

  /** расталкивание зомби между собой, от игрока и препятствий */
  separate(dt) {
    const act = this.active;
    const pit = this.world.pit;
    for (let i = 0; i < act.length; i++) {
      const a = act[i];
      if (!a.alive || a.state === 'climb') continue;
      const pa = a.group.position;
      const ra = a.T.radius * a.scale;
      for (let j = i + 1; j < act.length; j++) {
        const b = act[j];
        if (!b.alive || b.state === 'climb') continue;
        const pb = b.group.position;
        const rb = b.T.radius * b.scale;
        const dx = pb.x - pa.x, dz = pb.z - pa.z;
        const d2 = dx * dx + dz * dz, rr = ra + rb;
        if (d2 >= rr * rr || d2 < 1e-6) continue;
        const d = Math.sqrt(d2), push = (rr - d) * 0.5;
        const wa = b.type === 'boss' || b.type === 'brute' ? 1.5 : 1, wb = a.type === 'boss' || a.type === 'brute' ? 1.5 : 1;
        pa.x -= (dx / d) * push * wa * 0.8; pa.z -= (dz / d) * push * wa * 0.8;
        pb.x += (dx / d) * push * wb * 0.8; pb.z += (dz / d) * push * wb * 0.8;
      }
      // игрок
      const tdx = pa.x - this.target.x, tdz = pa.z - this.target.z;
      const td = Math.hypot(tdx, tdz), tr = ra + 0.42;
      if (this.targetAlive && td < tr && td > 1e-4) { pa.x += (tdx / td) * (tr - td); pa.z += (tdz / td) * (tr - td); }
      for (const c of this.world.colliders) {
        const cx = pa.x - c.x, cz = pa.z - c.z;
        const cd = Math.hypot(cx, cz), cr = c.r + ra;
        if (cd < cr && cd > 1e-4) { pa.x += (cx / cd) * (cr - cd); pa.z += (cz / cd) * (cr - cd); }
      }
      // не падать обратно в яму
      const r = Math.hypot(pa.x, pa.z);
      const R = pit.radiusAt(Math.atan2(pa.z, pa.x)) + 0.35;
      if (r < R && !a.crawling) { pa.x *= R / r; pa.z *= R / r; }
      const bound = this.world.bounds.radius;
      if (r > bound) { pa.x *= bound / r; pa.z *= bound / r; }
      pa.y = this.world.heightAt(pa.x, pa.z);
    }
  }

  /** ближайшее попадание луча по зомби */
  raycast(origin, dir, maxDist) {
    let best = null, bestT = maxDist;
    for (const z of this.active) {
      if (!z.group.visible || z.sinking) continue;
      const h = z.raycastParts(origin, dir, bestT);
      if (h) { bestT = h.t; best = { zombie: z, part: h.part, t: h.t }; }
    }
    if (best) best.point = new THREE.Vector3().copy(origin).addScaledVector(dir, best.t);
    return best;
  }

  /** взрыв: урон с затуханием, отрыв конечностей, разлёт */
  explode(position, radius, damage, force, weaponId = 'explosion') {
    const results = [];
    for (const z of this.active) {
      if (!z.group.visible || z.sinking) continue;
      const d = z.center.distanceTo(position);
      if (d > radius) continue;
      const k = 1 - d / radius;
      const dir = _v.subVectors(z.center, position).setY(0);
      if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0);
      dir.normalize().y = 0.4;
      dir.normalize();
      const parts = z.alive ? ['chest', k > 0.55 ? 'thighL' : 'belly', k > 0.7 ? 'upperArmR' : 'pelvis'] : ['chest'];
      let res = null;
      for (const pn of parts) {
        const part = PARTS_BY_NAME[pn];
        z.bone(part.a, _v2);
        res = z.hit(part, _v2, dir, (damage * k) / parts.length, { explosive: true, force: force * k, weaponId }) || res;
        if (!z.alive && z.state !== 'dying') break;
      }
      if (z.alive === false && z.state === 'dying' && k > 0.6 && !z.lost.armL && this.rng.chance(0.5)) z.sever('armL', 'upper', dir, force);
      results.push(res);
    }
    return results;
  }

  /** плевок кислотой по навесной траектории с упреждением */
  spit(z, from) {
    const tg = this.target;
    const lead = this.targetVel ? _v3.copy(this.targetVel).multiplyScalar(0.6) : _v3.set(0, 0, 0);
    const tx = tg.x + lead.x, tz = tg.z + lead.z, ty = tg.y + 1.1;
    const dx = tx - from.x, dz = tz - from.z, dist = Math.hypot(dx, dz);
    const T = clamp(dist / 13, 0.45, 1.4);
    const g = 9.8;
    const vel = new THREE.Vector3(dx / T, (ty - from.y + 0.5 * g * T * T) / T, dz / T);
    const mesh = new THREE.Mesh(this.acidGeo, this.acidMat);
    mesh.position.copy(from);
    this.scene.add(mesh);
    this.projectiles.push({ mesh, vel, life: 4 });
    this.audio?.acidSpit?.(from);
  }

  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      p.vel.y -= 9.8 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.rotation.x += dt * 9; p.mesh.rotation.y += dt * 7;
      const pos = p.mesh.position;
      const gy = this.world.heightAt(pos.x, pos.z);
      const tg = this.target;
      const hitPlayer = this.targetAlive && Math.hypot(pos.x - tg.x, pos.z - tg.z) < 0.55 && pos.y > tg.y && pos.y < tg.y + 1.9;
      if (hitPlayer || pos.y <= gy || p.life <= 0) {
        if (hitPlayer) this.onAcid?.(12, pos);
        pos.y = Math.max(pos.y, gy);
        this.fx?.acidSplash?.(pos);
        this.audio?.acidSplash?.(pos);
        if (!hitPlayer) { const h = this.fx?.acidPuddle?.(_v.set(pos.x, gy, pos.z), 1.1, 6); if (h) this.onPuddle?.(h); }
        this.scene.remove(p.mesh);
        this.projectiles.splice(i, 1);
      }
    }
  }

  /** взрыв толстяка: газ, кислота, урон вокруг */
  bloaterBurst(z) {
    const c = _v.copy(z.center);
    this.fx?.gasCloud?.(c, 3.5);
    this.fx?.bloodBurst?.(c, 2.0);
    this.fx?.acidSplash?.(c);
    this.audio?.explosion?.(c);
    this.audio?.gore?.(c);
    this.onShake?.(0.5, c);
    const tg = this.target;
    const d = Math.hypot(c.x - tg.x, c.z - tg.z);
    if (this.targetAlive && d < 3.8) this.onPlayerHit?.(z.T.dmg * (1 - d / 4.5), c, 'bloater');
    const pos = c.clone();
    queueMicrotask(() => this.explode(pos, 3.8, 140, 9, 'explosion'));
    const h = this.fx?.acidPuddle?.(_v2.set(c.x, this.world.heightAt(c.x, c.z), c.z), 2.2, 9);
    if (h) this.onPuddle?.(h);
  }

  /** точки для радара: [x, z, тип] живых */
  radar(out) {
    out.length = 0;
    for (const z of this.active) if (z.alive) out.push(z.group.position.x, z.group.position.z, z.type === 'boss' || z.type === 'brute' ? 2 : 1);
    return out;
  }

  clear() {
    for (const z of this.active) z.release();
    this.update(0);
    this.corpses.length = 0;
    for (const p of this.projectiles) this.scene.remove(p.mesh);
    this.projectiles.length = 0;
  }
}

import { PARTS } from './Zombie.js';
const PARTS_BY_NAME = Object.fromEntries(PARTS.map((p) => [p.name, p]));
