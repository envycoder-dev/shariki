// Один зомби: скелет + конечный автомат + ИИ + хитбоксы + урон/расчленение.
import * as THREE from 'three';
import { B, NB, PARENT, newPose, lerpPose, applyPose, createBones, HIPS_P, ROOT_P, ROOT_R } from './rig.js';
import * as A from './anim.js';
import { TYPES, rollColors } from './types.js';
import { makeZombieMaterial, setZombieColors, eyeMaterial, teethMaterial, stumpMaterial, boneMaterial, woundMaterial } from './material.js';
import { SEVER } from './body.js';
import { clamp } from '../core/noise.js';

const IDENTITY = new THREE.Matrix4();
const EYE_GEO = new THREE.SphereGeometry(1, 12, 8);
const WOUND_GEO = (() => {
  const g = new THREE.CircleGeometry(1, 9);
  const p = g.attributes.position;
  for (let i = 1; i < p.count; i++) { const k = 0.7 + Math.random() * 0.5; p.setXY(i, p.getX(i) * k, p.getY(i) * k); }
  return g;
})();
const STUMP_GEO = new THREE.SphereGeometry(1, 10, 8);
const BONE_GEO = new THREE.CylinderGeometry(0.35, 0.45, 1, 6).translate(0, 0.5, 0);

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);
const TAU = Math.PI * 2;

// части тела для попаданий: кости-концы, базовый радиус, множитель урона, конечность
export const PARTS = [
  { name: 'head', a: B.head, b: B.headTop, r: 0.1, mult: 3.0, limb: 'head', girth: 'head' },
  { name: 'neck', a: B.neck, b: B.head, r: 0.06, mult: 2.0, limb: 'head', girth: 'neck' },
  { name: 'chest', a: B.chest, b: B.neck, r: 0.16, mult: 1.0, girth: 'torso' },
  { name: 'belly', a: B.spine, b: B.chest, r: 0.15, mult: 1.0, girth: 'belly' },
  { name: 'pelvis', a: B.hips, b: B.spine, r: 0.15, mult: 0.9, girth: 'torso' },
  { name: 'upperArmL', a: B.armL, b: B.foreL, r: 0.06, mult: 0.6, limb: 'armL', level: 'upper', girth: 'limb' },
  { name: 'foreArmL', a: B.foreL, b: B.handEndL, r: 0.05, mult: 0.5, limb: 'armL', level: 'lower', girth: 'limb' },
  { name: 'upperArmR', a: B.armR, b: B.foreR, r: 0.06, mult: 0.6, limb: 'armR', level: 'upper', girth: 'limb' },
  { name: 'foreArmR', a: B.foreR, b: B.handEndR, r: 0.05, mult: 0.5, limb: 'armR', level: 'lower', girth: 'limb' },
  { name: 'thighL', a: B.thighL, b: B.shinL, r: 0.085, mult: 0.7, limb: 'legL', level: 'upper', girth: 'limb' },
  { name: 'shinL', a: B.shinL, b: B.footL, r: 0.06, mult: 0.55, limb: 'legL', level: 'lower', girth: 'limb' },
  { name: 'thighR', a: B.thighR, b: B.shinR, r: 0.085, mult: 0.7, limb: 'legR', level: 'upper', girth: 'limb' },
  { name: 'shinR', a: B.shinR, b: B.footR, r: 0.06, mult: 0.55, limb: 'legR', level: 'lower', girth: 'limb' },
];

/** пересечение луча с капсулой (iq); возвращает t или -1 */
function capsuleHit(ro, rd, pa, pb, r) {
  const bax = pb.x - pa.x, bay = pb.y - pa.y, baz = pb.z - pa.z;
  const oax = ro.x - pa.x, oay = ro.y - pa.y, oaz = ro.z - pa.z;
  const baba = bax * bax + bay * bay + baz * baz;
  const bard = bax * rd.x + bay * rd.y + baz * rd.z;
  const baoa = bax * oax + bay * oay + baz * oaz;
  const rdoa = rd.x * oax + rd.y * oay + rd.z * oaz;
  const oaoa = oax * oax + oay * oay + oaz * oaz;
  const a = baba - bard * bard;
  let b = baba * rdoa - baoa * bard;
  let c = baba * oaoa - baoa * baoa - r * r * baba;
  let h = b * b - a * c;
  if (h >= 0 && a > 1e-9) {
    const t = (-b - Math.sqrt(h)) / a;
    const y = baoa + t * bard;
    if (y > 0 && y < baba) return t;
  }
  // сферы на концах
  for (const end of [pa, pb]) {
    const ocx = ro.x - end.x, ocy = ro.y - end.y, ocz = ro.z - end.z;
    b = rd.x * ocx + rd.y * ocy + rd.z * ocz;
    c = ocx * ocx + ocy * ocy + ocz * ocz - r * r;
    h = b * b - c;
    if (h > 0) { const t = -b - Math.sqrt(h); if (t > 0) return t; }
  }
  return -1;
}

export class Zombie {
  constructor(mgr, variant) {
    this.mgr = mgr;
    this.variant = variant;
    this.group = new THREE.Group();
    this.bones = createBones(variant.joints);
    this.skeleton = new THREE.Skeleton(this.bones, variant.inverses);
    this.material = makeZombieMaterial();
    this.mesh = new THREE.SkinnedMesh(variant.geometry, this.material);
    this.mesh.add(this.bones[0]);
    this.mesh.bind(this.skeleton, IDENTITY);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = mgr.quality === 'high';
    this.group.add(this.mesh);
    const hb = this.bones[B.head], J = variant.joints;
    this.eyes = variant.sockets.map((so) => {
      const e = new THREE.Mesh(EYE_GEO, eyeMaterial(0xffe2a0));
      e.scale.setScalar(so.r * 0.6);
      e.position.set(so.c[0] - J.head[0], so.c[1] - J.head[1], so.c[2] - J.head[2] + so.r * 0.18);
      hb.add(e);
      return { mesh: e, so };
    });
    const tu = new THREE.Mesh(variant.teethUpper, teethMaterial); hb.add(tu);
    const tl = new THREE.Mesh(variant.teethLower, teethMaterial); this.bones[B.jaw].add(tl);
    this.extras = [];
    this.wounds = [];
    for (let i = 0; i < 10; i++) {
      const w = new THREE.Mesh(WOUND_GEO, woundMaterial);
      w.visible = false;
      this.wounds.push(w);
    }
    this.woundIdx = 0;
    this.stumps = [];
    this.pose = newPose(); this.target = newPose(); this.from = newPose();
    this.spring = new Float32Array(14); // [pos,vel] × 7 каналов
    this.bonePos = new Float32Array(NB * 3);
    this.forward = new THREE.Vector3(0, 0, 1);
    this.center = new THREE.Vector3();
    this.lost = {};
    this.limbHp = {};
    this.alive = false;
    this.voice = null;
  }

  get position() { return this.group.position; }

  spawn(type, opts) {
    const m = this.mgr, T = TYPES[type], rng = m.rng, v = this.variant;
    this.type = type; this.T = T;
    this.scale = (opts.scale ?? 1) * (type === 'boss' ? 1 : rng.range(0.93, 1.07));
    this.group.scale.setScalar(this.scale);
    this.colors = rollColors(v.id, type, rng);
    this.colors.height = v.height;
    setZombieColors(this.material, this.colors);
    for (const e of this.eyes) {
      e.mesh.material = eyeMaterial(T.eye);
      e.mesh.visible = !e.so.missing && !(type === 'walker' && rng.chance(0.08));
    }
    for (const x of this.extras) x.parent?.remove(x);
    this.extras.length = 0;
    this.addExtras(rng);
    this.maxHp = this.hp = T.hp * (opts.hpMul ?? m.hpMul);
    this.speed = rng.range(T.speed[0], T.speed[1]) * (opts.speedMul ?? m.speedMul);
    this.style = {
      stride: rng.range(0.8, 1.15),
      limp: type === 'walker' && rng.chance(0.55) ? rng.range(0.4, 1) : 0,
      limpSide: rng.sign(),
      arms: type === 'walker' ? rng.int(0, 2) : type === 'runner' ? rng.int(0, 1) : 1,
      lean: rng.range(-0.05, 0.12), tilt: rng.range(-0.35, 0.35), seed: rng.range(0, 100),
    };
    this.attackStyle = rng.chance(0.5) ? 'swipe' : 'bite';
    for (const b of this.bones) b.scale.set(1, 1, 1);
    for (const s of this.stumps) s.parent?.remove(s);
    this.stumps.length = 0;
    for (const w of this.wounds) { w.visible = false; w.parent?.remove(w); }
    this.lost = {};
    const limbHp = Math.min(this.maxHp * 0.38, 160);
    this.limbHp = { armL: limbHp, armR: limbHp, legL: limbHp * 1.2, legR: limbHp * 1.2 };
    this.headHp = 60;
    this.spring.fill(0);
    this.crawling = false;
    this.alive = true; this.dead = false;
    this.t = rng.range(0, 10); this.st = 0; this.phase = rng.range(0, TAU);
    this.attackCd = 0; this.spitCd = rng.range(1.5, 3); this.chargeCd = rng.range(3, 6); this.chargeT = 0;
    this.groanT = rng.range(1, 5); this.painCd = 0; this.bleedT = 0; this.bleedPos = null;
    this.flung = false; this.vel = new THREE.Vector3(); this.slide = 0;
    this.enraged = false; this.deadT = 0; this.sinking = false;
    this.hitStamp = 0;
    this.blendT = 1; this.blendDur = 0.0001;
    this.yaw = 0;
    if (T.legless) this.makeLegless();
    this.group.visible = true;
    if (!this.group.parent) m.scene.add(this.group);
    if (opts.position) {
      this.group.position.copy(opts.position);
      this.yaw = opts.yaw ?? 0;
      this.setState('move', 0.0001);
    } else {
      // вылезает из ямы: стоим лицом наружу на кромке
      const ang = opts.angle ?? rng.range(0, TAU);
      const R = m.world.pit.radiusAt(ang);
      const back = this.crawling ? -0.87 : 0.75;
      this.group.position.set(Math.cos(ang) * (R + back * this.scale), 0, Math.sin(ang) * (R + back * this.scale));
      this.group.position.y = m.world.heightAt(Math.cos(ang) * (R + 0.6), Math.sin(ang) * (R + 0.6));
      this.yaw = Math.atan2(Math.cos(ang), Math.sin(ang));
      this.climbOffset = this.crawling ? 1.62 : 0;
      const k = { walker: rng.range(0.85, 1.2), runner: 0.5, crawler: 1.0, brute: 1.3, spitter: 0.65, bloater: 1.35, boss: 1.45 }[type];
      this.climbDur = A.CLIPS.climb.R.dur * k;
      this.climbClip = rng.chance(0.5) ? A.CLIPS.climb.R : A.CLIPS.climb.L;
      this.evIdx = 0;
      this.setState('climb', 0.0001);
      m.fx?.dirtBurst?.(_v.set(Math.cos(ang) * R, this.group.position.y, Math.sin(ang) * R), 0.5);
    }
    this.group.rotation.set(0, this.yaw, 0);
    this.voice?.dispose?.();
    this.voice = m.audio?.createVoice?.(type, Math.floor(rng.range(0, 1e6))) ?? null;
    this.computePose(0);
    applyPose(this.bones, this.pose, v.joints);
    this.group.updateMatrixWorld(true);
    this.cacheBones();
    return this;
  }

  addExtras(rng) {
    const v = this.variant, J = v.joints, hs = v.rig.hs;
    if ((v.id === 'walker_a' || v.id === 'walker_c') && rng.chance(0.18)) {
      const hat = this.mgr.props.hardHat.clone();
      hat.scale.setScalar(hs);
      hat.position.set(0, 0.115 * hs, 0.0);
      hat.rotation.x = rng.range(-0.25, 0.1); hat.rotation.z = rng.range(-0.2, 0.2);
      this.bones[B.head].add(hat); this.extras.push(hat);
    }
    if (this.type === 'boss') {
      const cl = this.mgr.props.cleaver.clone();
      cl.scale.setScalar(v.spec.H * 0.95);
      this.bones[B.handR].add(cl); this.extras.push(cl);
    }
    if (this.type === 'brute') {
      const rb = this.mgr.props.rebar.clone();
      rb.position.set(0.04, 0.05, 0); rb.rotation.set(0.9, 0.3, 0.5);
      this.bones[B.chest].add(rb); this.extras.push(rb);
    }
  }

  makeLegless() {
    this.crawling = true;
    for (const side of ['L', 'R']) {
      this.bones[B['thigh' + side]].scale.setScalar(0.0001);
      this.lost['leg' + side] = 'upper';
      this.addStump(B['thigh' + side]);
    }
  }

  setState(s, blend = 0.25) {
    this.state = s;
    this.st = 0;
    this.from.set(this.pose);
    this.blendT = 0;
    this.blendDur = blend;
    this.hitDone = false;
  }

  // ------------------------------------------------------------ кадр
  update(dt) {
    const m = this.mgr;
    this.t += dt;
    this.st += dt;
    if (this.state === 'dead') { this.updateCorpse(dt); return; }
    this.attackCd -= dt; this.spitCd -= dt; this.chargeCd -= dt; this.painCd -= dt;
    switch (this.state) {
      case 'climb': this.updateClimb(dt); break;
      case 'roar': if (this.st >= A.CLIPS.roar.R.dur) this.setState('move', 0.3); break;
      case 'move': this.think(dt); break;
      case 'attack': this.updateAttack(dt); break;
      case 'stagger':
        if (this.st >= A.CLIPS.stagger.R.dur) {
          this.moveLocal(A.CLIPS.stagger.R.commitZ * this.scale);
          this.from.set(this.pose); this.from[ROOT_P + 2] -= A.CLIPS.stagger.R.commitZ;
          this.state = 'move'; this.st = 0; this.blendT = 0; this.blendDur = 0.2;
        }
        break;
      case 'fall':
        if (this.st >= 0.75) { this.crawling = true; this.setState('move', 0.45); }
        break;
      case 'burst':
        if (this.st >= 0.75) this.die({ dir: this.forward, explosive: false, force: 0, burst: true });
        break;
      case 'dying': this.updateDying(dt); break;
    }
    if (this.bleedT > 0) this.updateBleed(dt);
    this.groanT -= dt;
    if (this.groanT <= 0 && this.alive) {
      this.groanT = m.rng.range(2.5, 8);
      if (this.state === 'move') this.voice?.groan?.();
    }
    this.computePose(dt);
    applyPose(this.bones, this.pose, this.variant.joints);
    this.group.position.y = Math.max(this.group.position.y, -50);
    this.group.rotation.y = this.yaw;
    this.group.updateMatrixWorld(true);
    this.cacheBones();
    this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    if (this.voice) this.voice.setPosition?.(this.headPos(_v));
  }

  updateClimb(dt) {
    const u = this.st / this.climbDur, m = this.mgr;
    const evs = A.CLIPS.climb.R.events;
    while (this.evIdx < evs.length && u >= evs[this.evIdx][0]) {
      const ev = evs[this.evIdx++][1];
      if (ev === 'grabR' || ev === 'grabL') {
        const hb = this.bones[ev === 'grabR' ? B.handR : B.handL];
        hb.getWorldPosition(_v); _v.y = Math.max(_v.y, this.group.position.y);
        m.fx?.dirtBurst?.(_v, 0.7);
        m.audio?.rimScrape?.(_v);
      } else if (ev === 'pull' || ev === 'knee') {
        this.bones[B.chest].getWorldPosition(_v); _v.y = this.group.position.y;
        m.fx?.dirtBurst?.(_v, 0.5);
        if (ev === 'pull') m.audio?.rimScrape?.(_v);
      }
    }
    if (this.crawling && u >= 0.55) { this.setState('move', 0.5); return; }
    if (u >= 1) {
      const roar = this.type === 'brute' || this.type === 'boss' || (this.type === 'walker' && m.rng.chance(0.2)) || this.type === 'runner';
      if (roar) { this.setState('roar', 0.25); (this.type === 'walker' ? this.voice?.groan : this.voice?.scream)?.call(this.voice); }
      else this.setState('move', 0.3);
    }
  }

  // ------------------------------------------------------------ ИИ
  think(dt) {
    const m = this.mgr, T = this.T, p = this.group.position;
    const tgt = m.target;
    const head = this.crawling ? this.headPos(_v3) : p;
    const dx = tgt.x - head.x, dz = tgt.z - head.z;
    const dist = Math.hypot(dx, dz);
    m.steer(this, tgt, _v2);
    let wantYaw = Math.atan2(_v2.x, _v2.z);
    // бегство плевуна, если игрок вплотную, но не в зоне удара
    const charging = this.chargeT > 0;
    if (charging) this.chargeT -= dt;
    let turn = T.turn * (charging ? 0.5 : 1);
    let dy = wantYaw - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += clamp(dy, -turn * dt, turn * dt);
    let speed = this.speed * (charging ? (this.type === 'boss' ? 2.6 : 3.0) : 1);
    const ph = this.phase;
    if (this.crawling) speed = this.speed * 0.75 * (0.25 + 1.05 * Math.max(0, Math.sin(ph)));
    else if (this.type === 'walker') speed *= 0.75 + 0.5 * Math.abs(Math.sin(ph));
    else if (this.type === 'spitter') speed *= 0.5 + 0.8 * Math.max(0, Math.sin(ph));
    speed *= 1 - 0.55 * Math.min(1, Math.abs(dy) / 1.5);
    if (this.type === 'spitter' && dist < 9 && dist > 2.2) speed *= 0.2;
    if (m.targetAlive && dist < 1.0 + T.radius * this.scale) speed = 0;
    this.moveLocal(speed * dt);
    // фаза шага от пройденного пути: ноги не скользят
    const stride = this.crawling ? 0.9 : { walker: 1.05, runner: 2.3, brute: 1.45, spitter: 1.15, bloater: 0.85, boss: 1.7 }[this.type];
    const prevPh = this.phase;
    const cadence = this.crawling ? (this.speed * 0.75) / stride : (this.speed * (charging ? 2.4 : 1)) / stride;
    this.phase += TAU * cadence * dt / this.scale;
    if ((this.type === 'brute' || this.type === 'boss' || (this.type === 'runner' && charging === false)) && Math.floor(prevPh / Math.PI) !== Math.floor(this.phase / Math.PI)) {
      if (this.type !== 'runner' || m.rng.chance(0.5)) m.audio?.zombieStep?.(p, this.type !== 'runner');
      if (charging) m.onShake?.(0.15, p);
    }
    if (!m.targetAlive) return;
    const facing = Math.abs(dy) < 0.7;
    // решения об атаке
    if (this.type === 'bloater' && dist < 2.3) { this.setState('burst', 0.15); this.voice?.attack?.(); return; }
    if (this.type === 'spitter' && dist > 4.5 && dist < 17 && this.spitCd <= 0 && facing) {
      this.startAttack(A.CLIPS.spit.R, 'spit'); this.spitCd = this.mgr.rng.range(3, 4.5); return;
    }
    if ((this.type === 'brute' || this.type === 'boss') && !charging && this.chargeCd <= 0 && dist > 6 && dist < 16 && facing) {
      this.chargeT = 1.8; this.chargeCd = this.mgr.rng.range(7, 11);
      this.voice?.scream?.();
    }
    if (this.type === 'runner' && dist < 2.8 && facing && this.attackCd <= 0) { this.startAttack(A.CLIPS.lunge.R, 'lunge'); return; }
    const reach = T.reach * this.scale;
    if (dist < reach && facing && this.attackCd <= 0) {
      const rng = this.mgr.rng;
      if (this.crawling) this.startAttack(A.CRAWL_BITE, 'crawlbite');
      else if (this.type === 'brute') this.startAttack(A.CLIPS.smash.R, 'smash');
      else if (this.type === 'boss') this.startAttack(rng.chance(0.6) ? A.CLIPS.chop.R : A.CLIPS.sweep.R, 'boss');
      else if (this.attackStyle === 'swipe' && !(this.lost.armR && this.lost.armL)) {
        const useLeft = this.lost.armR ? true : this.lost.armL ? false : rng.chance(0.5);
        this.startAttack(useLeft ? A.CLIPS.swipe.L : A.CLIPS.swipe.R, 'swipe');
      } else this.startAttack(A.CLIPS.bite.R, 'bite');
    }
  }

  moveLocal(d) {
    const p = this.group.position;
    p.x += Math.sin(this.yaw) * d; p.z += Math.cos(this.yaw) * d;
    p.y = this.mgr.world.heightAt(p.x, p.z);
  }

  startAttack(clip, kind) {
    this.clip = clip; this.attackKind = kind;
    this.setState('attack', kind === 'crawlbite' ? 0.1 : 0.18);
    this.attackCd = kind === 'spit' ? 0.6 : this.mgr.rng.range(0.4, 0.9);
    if (kind !== 'spit') this.voice?.attack?.();
  }

  updateAttack(dt) {
    const m = this.mgr, clip = this.clip;
    const u = this.st / clip.dur;
    // доворот на цель во время замаха
    if (u < clip.hit) {
      const tg = m.target, p = this.group.position;
      let dy = Math.atan2(tg.x - p.x, tg.z - p.z) - this.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.yaw += clamp(dy, -this.T.turn * 0.45 * dt, this.T.turn * 0.45 * dt);
    }
    if (!this.hitDone && u >= clip.hit) {
      this.hitDone = true;
      if (this.attackKind === 'spit') {
        this.bones[B.jaw].getWorldPosition(_v);
        m.spit(this, _v);
        this.voice?.spit?.();
      } else {
        const origin = this.crawling ? this.headPos(_v) : _v.copy(this.group.position);
        const tg = m.target;
        const dx = tg.x - origin.x, dz = tg.z - origin.z;
        const d = Math.hypot(dx, dz);
        let ang = Math.atan2(dx, dz) - this.yaw; ang = Math.atan2(Math.sin(ang), Math.cos(ang));
        const reach = this.attackKind === 'lunge' ? 2.3 : this.T.reach * this.scale + 0.45;
        const dmg = this.T.dmg * (this.attackKind === 'smash' ? 1 : this.attackKind === 'bite' ? 1.15 : 1);
        if (this.attackKind === 'smash' || (this.attackKind === 'boss' && clip === A.CLIPS.chop.R)) {
          this.bones[B.handR].getWorldPosition(_v2); _v2.y = this.group.position.y;
          m.fx?.dirtBurst?.(_v2, 1.4);
          m.onShake?.(0.6, _v2);
          m.audio?.bodyFall?.(_v2, true);
        }
        if (m.targetAlive && d < reach && Math.abs(ang) < 1.35) m.onPlayerHit?.(dmg, this.group.position, this.type);
      }
    }
    if (u >= 1) this.setState('move', 0.22);
  }

  // ------------------------------------------------------------ поза
  computePose(dt) {
    const tp = this.target, st = this.style;
    switch (this.state) {
      case 'climb': {
        A.neutral(tp);
        A.sampleClip(this.climbClip, Math.min(1, this.st / this.climbDur), tp, this.variant.clipCtx);
        tp[ROOT_P + 2] += this.climbOffset;
        break;
      }
      case 'roar':
        A.neutral(tp);
        A.sampleClip(A.CLIPS.roar.R, this.st / A.CLIPS.roar.R.dur, tp, this.variant.clipCtx);
        if (this.st > 0.3 && this.st < 1.2) { tp[B.head * 3 + 1] += 0.08 * Math.sin(this.t * 31); tp[B.chest * 3 + 2] += 0.04 * Math.sin(this.t * 23); }
        break;
      case 'move': this.gait(tp); break;
      case 'attack':
        if (this.attackKind === 'crawlbite') {
          this.gait(tp);
          A.sampleClip(this.clip, this.st / this.clip.dur, tp, this.variant.clipCtx, true);
        } else {
          A.neutral(tp);
          A.sampleClip(this.clip, Math.min(1, this.st / this.clip.dur), tp, this.variant.clipCtx);
        }
        break;
      case 'stagger':
        A.neutral(tp);
        A.sampleClip(A.CLIPS.stagger.R, Math.min(1, this.st / A.CLIPS.stagger.R.dur), tp, this.variant.clipCtx);
        break;
      case 'fall':
        A.neutral(tp);
        A.sampleClip(A.CLIPS.deathFwd.R, Math.min(0.92, 0.25 + this.st / 0.75 * 0.67), tp, this.variant.clipCtx);
        break;
      case 'burst':
        A.neutral(tp);
        A.sampleClip(A.CLIPS.twitch.R, (this.st / 0.75) % 1, tp, this.variant.clipCtx);
        tp[HIPS_P + 1] += 0.03 * Math.sin(this.t * 40);
        break;
      case 'dying': {
        if (this.deathClip) {
          A.neutral(tp);
          A.sampleClip(this.deathClip, Math.min(1, this.dieU), tp, this.variant.clipCtx);
        } else { // ползун просто обмякает
          A.gaitCrawl(tp, this.phase, this.t, st, !!this.lost.legL && !!this.lost.legR);
          const k = Math.min(1, this.st / 0.6);
          tp[B.neck * 3] += 0.9 * k; tp[B.head * 3] += 0.3 * k; tp[ROOT_R] = 1.57 * k + tp[ROOT_R] * (1 - k);
          tp[B.armL * 3] = -2.3; tp[B.armR * 3] = -1.6; tp[B.foreL * 3] = -0.2; tp[B.foreR * 3] = -0.4;
        }
        break;
      }
    }
    // плавный переход между состояниями
    if (this.blendT < this.blendDur) {
      this.blendT += dt;
      const k = Math.min(1, this.blendT / this.blendDur);
      lerpPose(this.pose, this.from, tp, k * k * (3 - 2 * k));
    } else this.pose.set(tp);
    this.additive(dt);
  }

  gait(tp) {
    const st = this.style, ph = this.phase, t = this.t;
    if (this.crawling) A.gaitCrawl(tp, ph, t, st, !!this.lost.legL && !!this.lost.legR);
    else if (this.type === 'runner') A.gaitRun(tp, ph, t, st);
    else if (this.type === 'brute' || this.type === 'boss') {
      if (this.chargeT > 0) { A.gaitRun(tp, ph, t, { ...st, arms: 1, lean: 0.1 }); tp[B.neck * 3] = 0.4; }
      else A.gaitBrute(tp, ph, t, st);
      if (this.type === 'boss') { tp[B.armR * 3] -= 0.35; tp[B.foreR * 3] = -0.9; }
    } else if (this.type === 'spitter') A.gaitSpitter(tp, ph, t, st);
    else if (this.type === 'bloater') A.gaitBloater(tp, ph, t, st);
    else A.gaitWalk(tp, ph, t, st);
  }

  // пружины вздрагивания + взгляд на игрока + подёргивания
  additive(dt) {
    const s = this.spring, p = this.pose;
    const K = 95, D = 11;
    for (let i = 0; i < 7; i++) {
      const x = s[i * 2], v = s[i * 2 + 1];
      const a = -K * x - D * v;
      s[i * 2 + 1] = v + a * dt;
      s[i * 2] = x + s[i * 2 + 1] * dt;
    }
    p[B.spine * 3] += s[0]; p[B.spine * 3 + 2] += s[2]; p[B.chest * 3 + 1] += s[4];
    p[B.head * 3] += s[6]; p[B.head * 3 + 1] += s[8]; p[B.armL * 3] += s[10]; p[B.armR * 3] += s[12];
    if (!this.alive || this.crawling) return;
    if (this.state === 'move' || this.state === 'attack' || this.state === 'roar') {
      const tg = this.mgr.target, gp = this.group.position;
      let yaw = Math.atan2(tg.x - gp.x, tg.z - gp.z) - this.yaw;
      yaw = clamp(Math.atan2(Math.sin(yaw), Math.cos(yaw)), -1.1, 1.1);
      p[B.neck * 3 + 1] += yaw * 0.35; p[B.head * 3 + 1] += yaw * 0.45;
      if (this.type === 'walker' && Math.sin(this.t * 1.7 + this.style.seed) > 0.97) s[9] += (Math.random() - 0.5) * 2.5;
    }
  }

  // ------------------------------------------------------------ попадания
  cacheBones() {
    const bp = this.bonePos;
    for (let i = 0; i < NB; i++) {
      const e = this.bones[i].matrixWorld.elements;
      bp[i * 3] = e[12]; bp[i * 3 + 1] = e[13]; bp[i * 3 + 2] = e[14];
    }
    this.center.set(bp[B.spine * 3], bp[B.spine * 3 + 1], bp[B.spine * 3 + 2]);
  }

  bone(i, out) { const bp = this.bonePos; return out.set(bp[i * 3], bp[i * 3 + 1], bp[i * 3 + 2]); }
  headPos(out) { return this.bone(B.head, out); }

  /** луч против капсул тела; возвращает {t, part} или null */
  raycastParts(ro, rd, maxT) {
    const c = this.center;
    const R = 1.25 * this.scale * this.variant.spec.H;
    const ocx = ro.x - c.x, ocy = ro.y - c.y, ocz = ro.z - c.z;
    const b = rd.x * ocx + rd.y * ocy + rd.z * ocz;
    const cc = ocx * ocx + ocy * ocy + ocz * ocz - R * R;
    if (b * b - cc < 0 || (-b + Math.sqrt(Math.max(0, b * b - cc))) < 0) return null;
    let best = maxT, bestPart = null;
    const g = this.variant.girth;
    for (const part of PARTS) {
      if (part.limb && this.lost[part.limb] && (this.lost[part.limb] === 'upper' || part.level === 'lower' || part.limb === 'head')) continue;
      const r = part.r * g[part.girth] * this.scale;
      const t = capsuleHit(ro, rd, this.bone(part.a, _v), this.bone(part.b, _v2), r);
      if (t > 0 && t < best) { best = t; bestPart = part; }
    }
    return bestPart ? { t: best, part: bestPart } : null;
  }

  /** урон по части тела */
  hit(part, point, dir, amount, opts = {}) {
    const m = this.mgr, rng = m.rng;
    const headshot = part.limb === 'head';
    if (!this.alive) {
      m.fx?.bloodHit?.(point, dir, 0.6);
      if (part.limb === 'head' && !this.lost.head) { this.headHp -= amount * 2; if (this.headHp <= 0) this.sever('head', 'upper', dir, opts.force || 2); }
      else if (part.limb && !this.lost[part.limb]) { this.limbHp[part.limb] -= amount * 1.5; if (this.limbHp[part.limb] <= 0) this.sever(part.limb, part.level, dir, opts.force || 2); }
      return { killed: false, headshot: false, corpse: true };
    }
    const mult = part.mult * (this.type === 'boss' && headshot ? 0.7 : 1);
    const dmg = amount * mult;
    this.hp -= dmg;
    this.material.userData.u.uDamage.value = clamp(1 - this.hp / this.maxHp, 0, 1) * 0.8;
    let severed = null;
    if (part.limb && part.limb !== 'head' && this.type !== 'boss') {
      this.limbHp[part.limb] -= amount * (opts.pellet ? 1.35 : 1);
      if (this.limbHp[part.limb] <= 0 && this.lost[part.limb] !== 'upper' && !(this.lost[part.limb] === 'lower' && part.level === 'lower')) severed = part.limb;
    }
    if (severed) this.sever(severed, part.level, dir, opts.force || 2);
    this.flinch(part, dir, Math.min(1.6, (dmg / this.maxHp) * 4 + 0.25) * (opts.force ? Math.min(2, 0.6 + opts.force * 0.25) : 1));
    this.addWound(part, point, dir);
    m.fx?.bloodHit?.(point, dir, headshot ? 1.4 : 0.7 + Math.min(1, dmg / 60));
    if (this.hp <= 0) {
      const pop = { shotgun: 0.9, rifle: 0.6, pistol: 0.42, explosion: 0.7 }[opts.weaponId] ?? 0;
      if (headshot && !this.lost.head && rng.chance(Math.min(1, pop + (dmg > 90 ? 0.3 : 0)))) this.sever('head', 'upper', dir, opts.force || 3);
      this.die({ dir, part, explosive: !!opts.explosive, force: opts.force || 1, headshot, weaponId: opts.weaponId });
      return { killed: true, headshot, severed };
    }
    if (this.painCd <= 0 && rng.chance(0.45)) { this.voice?.pain?.(); this.painCd = 1.2; }
    const heavy = dmg > this.maxHp * 0.4 || (opts.force || 0) > 9;
    if (heavy && (this.state === 'move' || this.state === 'attack') && !this.crawling && this.type !== 'boss' && this.type !== 'brute') {
      this.setState('stagger', 0.08);
    }
    if (this.type === 'boss' && !this.enraged && this.hp < this.maxHp * 0.5) {
      this.enraged = true; this.speed *= 1.25;
      this.setState('roar', 0.2); this.voice?.scream?.();
      m.onSummon?.(this);
    }
    return { killed: false, headshot, severed };
  }

  flinch(part, dir, k) {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const lx = dir.x * c - dir.z * s, lz = dir.x * s + dir.z * c;
    const sp = this.spring, imp = 7 * k;
    if (part.limb === 'head') { sp[7] += lz * imp * 1.6; sp[9] += (Math.random() - 0.5) * imp * 1.4; }
    sp[1] += lz * imp; sp[3] += -lx * imp * 0.8; sp[5] += (Math.random() - 0.5) * imp;
    if (part.limb === 'armL') sp[11] += (Math.random() - 0.3) * imp * 2;
    if (part.limb === 'armR') sp[13] += (Math.random() - 0.3) * imp * 2;
  }

  addWound(part, point, dir) {
    const w = this.wounds[this.woundIdx++ % this.wounds.length];
    const bone = this.bones[part.a];
    bone.add(w);
    _m.copy(bone.matrixWorld).invert();
    w.position.copy(point).applyMatrix4(_m);
    // нормаль: от оси части к точке попадания
    this.bone(part.a, _v); this.bone(part.b, _v2);
    _v3.subVectors(_v2, _v);
    const t = clamp(_v3.dot(_v.subVectors(point, this.bone(part.a, _v))) / Math.max(1e-6, _v3.lengthSq()), 0, 1);
    this.bone(part.a, _v).addScaledVector(_v3, t);
    _v2.subVectors(point, _v).normalize();
    _q.setFromRotationMatrix(_m.extractRotation(bone.matrixWorld)).invert();
    _v2.applyQuaternion(_q);
    w.quaternion.setFromUnitVectors(_up.set(0, 0, 1), _v2);
    _up.set(0, 1, 0);
    w.position.addScaledVector(_v2, 0.004);
    const sc = (0.022 + Math.random() * 0.02) / (this.scale * bone.getWorldScale(_v).x);
    w.scale.setScalar(sc);
    w.visible = true;
  }

  addStump(boneIdx) {
    const parent = this.bones[PARENT[boneIdx]];
    const g = new THREE.Group();
    const r = boneIdx === B.head ? 0.05 : (boneIdx === B.thighL || boneIdx === B.thighR) ? 0.075 : 0.045;
    const k = this.variant.girth.limb;
    const s = new THREE.Mesh(STUMP_GEO, stumpMaterial);
    s.scale.set(r * k, r * 0.55 * k, r * k);
    const bn = new THREE.Mesh(BONE_GEO, boneMaterial);
    bn.scale.set(r * 0.35 * k, r * 0.9, r * 0.35 * k);
    // обрубок смотрит вдоль отрубленной кости
    const lp = this.bones[boneIdx].position;
    g.position.copy(lp);
    _v.copy(lp).normalize();
    if (boneIdx === B.head) _v.set(0, 1, 0);
    g.quaternion.setFromUnitVectors(_up, _v);
    g.add(s, bn);
    parent.add(g);
    this.stumps.push(g);
    return g;
  }

  sever(limb, level, dir, force) {
    const m = this.mgr;
    const key = limb === 'head' ? 'head' : `${limb}_${level}`;
    const bones = SEVER[key];
    const top = bones[0];
    this.skeleton.update();
    const gib = this.bakeGib(key);
    this.bone(top, _v3);
    if (gib) {
      const vel = _v.copy(dir).multiplyScalar(1.5 + force * 0.6).add(_v2.set((Math.random() - 0.5) * 2, 2.5 + Math.random() * 2.5, (Math.random() - 0.5) * 2));
      const av = new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14);
      m.fx?.addGib?.(gib, vel.clone(), av, { bleed: true, lifetime: 14, radius: limb === 'head' ? 0.1 : 0.07, disposeGeometry: true });
    }
    if (this.lost[limb] === 'lower') this.stumps.forEach((s) => { if (s.parent === this.bones[top]) s.parent.remove(s); });
    this.bones[top].scale.setScalar(0.0001);
    this.lost[limb] = level;
    const st = this.addStump(top);
    m.fx?.bloodBurst?.(_v3, limb === 'head' ? 1.3 : 0.85);
    m.audio?.gore?.(_v3);
    this.bleedT = this.alive ? 3.5 : 1.5;
    this.bleedStump = st;
    m.onSever?.(this, limb);
    if (this.alive && (limb === 'legL' || limb === 'legR') && !this.crawling && this.state !== 'dying') {
      if (this.type === 'brute' || this.type === 'boss') return;
      this.setState('fall', 0.12);
      this.voice?.pain?.();
    }
  }

  updateBleed(dt) {
    this.bleedT -= dt;
    this.bleedAcc = (this.bleedAcc || 0) + dt;
    if (this.bleedAcc > 0.12 && this.bleedStump?.parent) {
      this.bleedAcc = 0;
      this.bleedStump.getWorldPosition(_v);
      _v2.set(0, 1, 0).applyQuaternion(this.bleedStump.getWorldQuaternion(_q));
      _v2.y += 0.3; _v2.normalize();
      this.mgr.fx?.bloodHit?.(_v, _v2, 0.35 * Math.min(1, this.bleedT));
    }
  }

  /** «запекает» текущую позу отрубленной части в отдельный меш */
  bakeGib(key) {
    const tris = this.variant.gibs[key];
    if (!tris || tris.length < 9) return null;
    const geo = this.variant.geometry;
    const rest = geo.attributes.position, m1 = geo.attributes.aMask, m2 = geo.attributes.aMask2;
    const map = new Map();
    const pos = [], rp = [], a1 = [], a2 = [], idx = [];
    const mw = this.mesh.matrixWorld;
    for (let i = 0; i < tris.length; i++) {
      const vi = tris[i];
      let ni = map.get(vi);
      if (ni === undefined) {
        ni = pos.length / 3;
        map.set(vi, ni);
        this.mesh.getVertexPosition(vi, _v).applyMatrix4(mw);
        pos.push(_v.x, _v.y, _v.z);
        rp.push(rest.getX(vi), rest.getY(vi), rest.getZ(vi));
        a1.push(m1.getX(vi), m1.getY(vi), m1.getZ(vi), m1.getW(vi));
        a2.push(m2.getX(vi), m2.getY(vi), m2.getZ(vi), m2.getW(vi));
      }
      idx.push(ni);
    }
    let cx = 0, cy = 0, cz = 0;
    const n = pos.length / 3;
    for (let i = 0; i < pos.length; i += 3) { cx += pos[i]; cy += pos[i + 1]; cz += pos[i + 2]; }
    cx /= n; cy /= n; cz /= n;
    for (let i = 0; i < pos.length; i += 3) { pos[i] -= cx; pos[i + 1] -= cy; pos[i + 2] -= cz; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aRest', new THREE.Float32BufferAttribute(rp, 3));
    g.setAttribute('aMask', new THREE.Float32BufferAttribute(a1, 4));
    g.setAttribute('aMask2', new THREE.Float32BufferAttribute(a2, 4));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mat = makeZombieMaterial(this.colors);
    mat.side = THREE.DoubleSide;
    mat.userData.u.uDamage.value = this.material.userData.u.uDamage.value;
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = true;
    mesh.position.set(cx, cy, cz);
    // кровавый срез в месте отруба
    const top = SEVER[key][0];
    this.bone(top, _v);
    const cap = new THREE.Mesh(STUMP_GEO, stumpMaterial);
    cap.position.set(_v.x - cx, _v.y - cy, _v.z - cz);
    const r = (key === 'head' ? 0.055 : key.includes('upper') && key.startsWith('leg') ? 0.08 : 0.045) * this.variant.girth.limb * this.scale;
    cap.scale.setScalar(r);
    mesh.add(cap);
    return mesh;
  }

  // ------------------------------------------------------------ смерть
  die(info) {
    const m = this.mgr, rng = m.rng;
    this.alive = false;
    this.hp = 0;
    this.deathInfo = info;
    this.voice?.death?.();
    if (this.type === 'bloater') m.bloaterBurst(this);
    let clip = null;
    if (this.crawling) clip = null;
    else if (info.burst || this.type === 'bloater') clip = rng.chance(0.5) ? A.CLIPS.deathBack.R : A.CLIPS.deathKnees.R;
    else {
      const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
      const lx = info.dir.x * c - info.dir.z * s, lz = info.dir.x * s + info.dir.z * c;
      if (this.lost.head && !info.explosive) { clip = A.CLIPS.deathKnees.R; this.preTwitch = 0.6; }
      else if (info.explosive) clip = lz > 0 ? A.CLIPS.deathFwd.R : A.CLIPS.deathBack.R;
      else if (this.type === 'runner' && this.state === 'move') clip = A.CLIPS.deathFwd.R;
      else if (lz > 0.55) clip = A.CLIPS.deathFwd.R;
      else if (Math.abs(lx) > 0.75) clip = lx > 0 ? A.CLIPS.deathSide.L : A.CLIPS.deathSide.R;
      else clip = rng.chance(0.3) ? A.CLIPS.deathKnees.R : rng.chance(0.5) ? A.CLIPS.deathBack.R : A.CLIPS.deathBack.L;
    }
    if (info.explosive) {
      this.flung = true;
      this.vel.copy(info.dir).setY(0).normalize().multiplyScalar(2 + info.force * 0.35);
      this.vel.y = 3.5 + info.force * 0.25;
    } else if (this.type === 'runner' && this.state === 'move') this.slide = this.speed * 0.8;
    this.deathClip = clip;
    this.dieU = 0;
    this.setState('dying', 0.12);
    m.onKill?.(this, info);
  }

  updateDying(dt) {
    const m = this.mgr;
    if (this.preTwitch > 0) { this.preTwitch -= dt; this.st = 0; return; }
    const clip = this.deathClip;
    const dur = clip ? clip.dur * (this.flung ? 0.75 : 1) : 0.6;
    this.dieU = this.st / dur;
    const p = this.group.position;
    if (this.flung) {
      this.vel.y -= 13 * dt;
      p.addScaledVector(this.vel, dt);
      const gy = m.world.heightAt(p.x, p.z);
      if (p.y <= gy) { p.y = gy; this.vel.multiplyScalar(0.35); this.vel.y = 0; if (this.vel.lengthSq() < 0.05) this.flung = false; }
    } else if (this.slide > 0) {
      this.moveLocal(this.slide * dt);
      this.slide = Math.max(0, this.slide - 9 * dt);
    } else p.y = m.world.heightAt(p.x, p.z);
    if (this.dieU >= 1 && !this.flung) {
      this.state = 'dead';
      this.deadT = 0;
      this.dead = true;
      this.bone(B.chest, _v); _v.y = p.y;
      m.fx?.bloodPool?.(_v, this.type === 'brute' || this.type === 'boss' ? 1.6 : 1);
      m.audio?.bodyFall?.(_v, this.type === 'brute' || this.type === 'boss');
      if (this.type === 'brute' || this.type === 'boss') m.onShake?.(0.3, _v);
      this.voice?.dispose?.(); this.voice = null;
      m.corpses.push(this);
    }
  }

  updateCorpse(dt) {
    this.deadT += dt;
    if (this.bleedT > 0) this.updateBleed(dt);
    if (!this.sinking && this.deadT > this.mgr.corpseTime) this.sinking = true;
    if (this.sinking) {
      this.sinkT = (this.sinkT || 0) + dt;
      this.group.position.y -= dt * 0.22;
      this.group.updateMatrixWorld(true);
      this.cacheBones();
      if (this.sinkT > 3) this.release();
    }
  }

  release() {
    this.sinking = false; this.sinkT = 0;
    this.group.visible = false;
    this.group.parent?.remove(this.group);
    this.voice?.dispose?.(); this.voice = null;
    this.released = true;
  }
}
