// Оружие и руки от первого лица: отдельная view-сцена, стрельба через combat.fireBullet, отдача, разброс, перезарядки, нож, гранаты.
import * as THREE from 'three';
import { RNG, clamp, lerp, damp } from '../core/noise.js';
import { createMaterials, makeFlashTexture, makeFlameTexture } from './textures.js';
import { buildPistol, buildShotgun, buildRifle, buildKnife, buildGrenade } from './models.js';
import { Hand, buildSleeve } from './hands.js';
import { Spring, EASE, env, sampleKeys, handXform } from './anim.js';
import { Grenades } from './grenades.js';
import { POSE, KNIFE_KEYS, NADE_KEYS, POSES } from './poses.js';

const D2R = Math.PI / 180;

export const DEFS = {
  pistol: {
    id: 'pistol', name: 'Пистолет', magSize: 12, reserveMax: Infinity, grant: Infinity, auto: false, interval: 0.14,
    damage: 34, range: 120, force: 1.5, pellets: 1, spreadHip: 1.4, spreadAds: 0.35, moveSpread: 1.5,
    recoil: 1.1, recover: 0.5, reload: 1.35, reloadEmpty: 1.65, aimFov: 0.85, casing: 'pistol',
    kick: { z: 0.5, rx: 1.9, rz: 0.8, ry: 0.35, y: 0.1 }, punch: 0.012, flash: 2.5, flashScale: 0.75,
  },
  shotgun: {
    id: 'shotgun', name: 'Дробовик', magSize: 6, reserveMax: 40, grant: 18, auto: false, interval: 0.75,
    damage: 15, range: 45, force: 3, pellets: 9, spreadHip: 5.5, spreadAds: 3.8, moveSpread: 0.8,
    recoil: 4, recover: 0.45, aimFov: 0.85, casing: 'shotgun',
    kick: { z: 1.0, rx: 2.8, rz: 1.1, ry: 0.45, y: 0.16 }, punch: 0.04, flash: 4.5, flashScale: 1.3,
  },
  rifle: {
    id: 'rifle', name: 'Автомат', magSize: 30, reserveMax: 240, grant: 120, auto: true, interval: 60 / 620,
    damage: 27, range: 150, force: 2, pellets: 1, spreadHip: 1.8, spreadAds: 0.35, moveSpread: 1.5,
    recoil: 0.68, recover: 0.35, reload: 2.1, reloadEmpty: 2.6, aimFov: 0.75, casing: 'rifle',
    kick: { z: 0.36, rx: 0.62, rz: 0.5, ry: 0.28, y: 0.035 }, punch: 0.007, flash: 2.6, flashScale: 1.0,
  },
};
const ORDER = ['pistol', 'shotgun', 'rifle'];
const NOINPUT = { lookDX: 0, lookDY: 0, speed01: 0, grounded: true, canFire: true };

// временные объекты (горячий путь без аллокаций)
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _qI = new THREE.Quaternion();
const _e1 = new THREE.Euler(), _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _m3 = new THREE.Matrix4();
const _s1 = new THREE.Vector3(1, 1, 1);
const _arr6 = new Array(6).fill(0), _arr6b = new Array(6).fill(0), _arr7 = new Array(7).fill(0);
const _pose = new Float32Array(21);

function trs(m, p, q) { return m.compose(p, q, _s1); }
// смешивание трансформов (позиция + кватернион)
function blendInto(p, q, p2, q2, w) { if (w <= 0) return; p.lerp(p2, w); q.slerp(q2, w); }

export class WeaponSystem {
  constructor({ renderer, camera, scene, audio, fx, combat, world, quality = 'high' } = {}) {
    this.renderer = renderer; this.camera = camera; this.scene = scene;
    this.audio = audio; this.fx = fx; this.combat = combat; this.world = world; this.quality = quality;
    this.rng = new RNG('weapons');
    const size = renderer ? renderer.getSize(new THREE.Vector2()) : new THREE.Vector2(16, 9);
    this.viewScene = new THREE.Scene();
    this.viewCamera = new THREE.PerspectiveCamera(54, size.x / Math.max(1, size.y), 0.01, 10);
    const { m, wearScale } = createMaterials(quality);
    m.sleeve.side = THREE.DoubleSide;
    this.M = m; this.wearScale = wearScale;
    this._setupLights();
    this._setupEnv();

    this.rig = new THREE.Group(); this.viewScene.add(this.rig);
    this.gunRoot = new THREE.Group(); this.rig.add(this.gunRoot);
    this.models = { pistol: buildPistol(m), shotgun: buildShotgun(m), rifle: buildRifle(m) };
    for (const id of ORDER) { const md = this.models[id]; md.root.visible = false; this.gunRoot.add(md.root); md.flash = this._buildFlash(md, DEFS[id].flashScale); }
    this.handR = new Hand(1, m); this.handL = new Hand(-1, m);
    this.gunRoot.add(this.handR.mesh); this.rig.add(this.handL.mesh);
    this.sleeveR = buildSleeve(m, 1); this.sleeveL = buildSleeve(m, -1);
    this.rig.add(this.sleeveR, this.sleeveL);
    this.knife = buildKnife(m); this.knife.visible = false; this.handL.mesh.add(this.knife);
    this.nade = buildGrenade(m); this.nade.visible = false; this.handL.mesh.add(this.nade);
    this.viewScene.traverse((o) => { o.frustumCulled = false; });
    // заранее рассчитанные якоря рук
    this.anchors = {};
    for (const id of ORDER) {
      const P = POSE[id];
      this.anchors[id] = { rh: handXform(P.rh.p, P.rh.fwd, P.rh.palm), lh: handXform(P.lh.p, P.lh.fwd, P.lh.palm), hold: handXform(P.hold.p, P.hold.fwd, P.hold.palm),
        hipQ: new THREE.Quaternion().setFromEuler(new THREE.Euler(...P.hipR)) };
    }
    this.grenadeSim = new Grenades({ scene, world, audio, combat, M: m });

    // состояние
    this.time = 0;
    this.inv = {};
    for (const id of ORDER) this.inv[id] = { owned: false, mag: 0, reserve: 0 };
    this.k = { z: new Spring(170, 0.5), y: new Spring(170, 0.5), rx: new Spring(150, 0.45), ry: new Spring(150, 0.5), rz: new Spring(120, 0.45) };
    this.sw = { yaw: new Spring(90, 0.75), pitch: new Spring(90, 0.75) };
    this.land = { y: new Spring(140, 0.5), rx: new Spring(140, 0.5) };
    this.punch = { pitch: new Spring(220, 0.42), yaw: new Spring(220, 0.42), roll: new Spring(160, 0.4) };
    this._punchOut = { pitch: 0, yaw: 0, roll: 0 };
    this._rec = { pitch: 0, yaw: 0 }; this._recRet = { pitch: 0, yaw: 0 };
    this._o = { gp: [0, 0, 0], gr: [0, 0, 0], wHold: 0, wFree: 0, wCam: 0, free: [0, 0, 0, 0, 0, 0], cam: [0, 0, 0, 0, 0, 0], obj: [0, 0, 0, 0, 0, 0], objVis: true, objFree: false };
    this.lw = { hold: 0, free: 0, cam: 0 };
    this.reset();
    this.onResize(size.x / Math.max(1, size.y));
    this._precompile();
  }

  // Компиляция всех шейдеров заранее (иначе первая смена оружия даёт фриз)
  _precompile() {
    if (!this.renderer || !this.renderer.compile) return;
    const hidden = [];
    this.viewScene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
    try { this.renderer.compile(this.viewScene, this.viewCamera); } catch (e) { /* не критично */ }
    for (const o of hidden) o.visible = false;
  }

  // ───────────── свет и окружение вьюмодели ─────────────
  _setupLights() {
    const s = this.viewScene;
    s.add(new THREE.HemisphereLight(0x3b4a66, 0x17110c, 0.9));
    const moon = new THREE.DirectionalLight(0xaabfff, 1.4); moon.position.set(-0.45, 0.85, 0.4); moon.target.position.set(0, -0.05, -0.4);
    const rim = new THREE.DirectionalLight(0x9fb4ff, 0.55); rim.position.set(-0.3, 0.6, -1); rim.target.position.set(0.05, -0.1, -0.2);
    const fill = new THREE.DirectionalLight(0xff9a55, 0.22); fill.position.set(0.9, -0.25, -0.5); fill.target.position.set(0, 0, -0.4);
    const spot = new THREE.SpotLight(0xfff1d6, 0.22, 3, 0.75, 1, 2); spot.position.set(0.05, 0.1, 0.06); spot.target.position.set(0.05, -0.1, -0.6);
    this.muzzleLight = new THREE.PointLight(0xffaa55, 0, 1.6, 2);
    s.add(moon, moon.target, rim, rim.target, fill, fill.target, spot, spot.target, this.muzzleLight);
  }

  _setupEnv() {
    if (!this.renderer) return;
    const sc = new THREE.Scene();
    const geo = new THREE.SphereGeometry(10, 48, 24), p = geo.attributes.position, col = [];
    const d = new THREE.Vector3(), moon = new THREE.Vector3(-0.4, 0.8, -0.45).normalize();
    const fires = [new THREE.Vector3(0.8, 0.05, -0.6), new THREE.Vector3(-0.9, 0.04, 0.3), new THREE.Vector3(0.3, 0.03, 0.95)].map((v) => v.normalize());
    const pit = new THREE.Vector3(0, -0.2, -1).normalize();
    for (let i = 0; i < p.count; i++) {
      d.fromBufferAttribute(p, i).normalize();
      const y = d.y, up = Math.max(0, y);
      let r = 0.03 + (0.012 - 0.03) * Math.min(1, up / 0.6), g = 0.036 + (0.016 - 0.036) * Math.min(1, up / 0.6), b = 0.05 + (0.03 - 0.05) * Math.min(1, up / 0.6);
      if (y < 0) { const k = Math.min(1, -y / 0.25); r = lerp(r * 0.5, 0.008, k); g = lerp(g * 0.5, 0.007, k); b = lerp(b * 0.5, 0.006, k); }
      const md = Math.max(0, d.dot(moon));
      r += 0.35 * md ** 40 + 0.04 * md ** 4; g += 0.4 * md ** 40 + 0.05 * md ** 4; b += 0.55 * md ** 40 + 0.07 * md ** 4;
      for (const f of fires) { const k = Math.max(0, d.dot(f)) ** 30 * 0.5; r += k; g += k * 0.45; b += k * 0.15; }
      const pk = Math.max(0, d.dot(pit)) ** 6 * 0.18; r += pk; g += pk * 0.2; b += pk * 0.06;
      col.push(r, g, b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    sc.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
    const disc = new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3.4, 4.2) }));
    disc.position.copy(moon).multiplyScalar(8); sc.add(disc);
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.envRT = pm.fromScene(sc, 0.02);
    pm.dispose();
    this.viewScene.environment = this.envRT.texture;
    this.viewScene.environmentIntensity = 1.6;
  }

  _buildFlash(md, scale) {
    if (!WeaponSystem._flashAssets) {
      const star = makeFlashTexture(11, 7), flame = makeFlameTexture(5);
      const mk = (map, c) => new THREE.MeshBasicMaterial({ map, color: c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
      const starG = new THREE.PlaneGeometry(0.11, 0.11);
      const fl = new THREE.PlaneGeometry(0.16, 0.06); fl.translate(0.08, 0, 0); fl.rotateY(Math.PI / 2); // вдоль −Z от дула
      const fl2 = fl.clone().rotateZ(Math.PI / 2);
      const flames = new THREE.BufferGeometry().copy(fl);
      { const a = fl.toNonIndexed(), b = fl2.toNonIndexed(); const pos = new Float32Array([...a.attributes.position.array, ...b.attributes.position.array]); const uv = new Float32Array([...a.attributes.uv.array, ...b.attributes.uv.array]); flames.setIndex(null); flames.setAttribute('position', new THREE.BufferAttribute(pos, 3)); flames.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); flames.deleteAttribute('normal'); }
      const cone = new THREE.ConeGeometry(0.018, 0.075, 14, 1, true); cone.rotateX(-Math.PI / 2); cone.translate(0, 0, -0.0375);
      const cc = []; const cp = cone.attributes.position;
      for (let i = 0; i < cp.count; i++) { const t = clamp(-cp.getZ(i) / 0.075, 0, 1); cc.push(3.5 * (1 - t), 2.0 * (1 - t), 0.8 * (1 - t)); }
      cone.setAttribute('color', new THREE.Float32BufferAttribute(cc, 3));
      const coneM = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, opacity: 0.8 });
      WeaponSystem._flashAssets = { starG, flames, cone, starM: mk(star, new THREE.Color(5, 3.6, 2.2)), flameM: mk(flame, new THREE.Color(4.2, 2.6, 1.3)), coneM };
    }
    const A = WeaponSystem._flashAssets;
    const g = new THREE.Group(); g.position.copy(md.muzzle); g.scale.setScalar(scale);
    const star = new THREE.Mesh(A.starG, A.starM), fl = new THREE.Mesh(A.flames, A.flameM), cone = new THREE.Mesh(A.cone, A.coneM);
    for (const o of [star, fl, cone]) { o.frustumCulled = false; o.renderOrder = 10; }
    g.add(star, fl, cone); g.visible = false; md.root.add(g);
    return { g, star, fl, cone };
  }

  // ───────────── публичный API ─────────────
  get aimFovScale() { return lerp(1, DEFS[this.cur].aimFov, this.aimE); }
  consumeRecoil() { const o = this._recRet; o.pitch = this._rec.pitch; o.yaw = this._rec.yaw; this._rec.pitch = 0; this._rec.yaw = 0; return o; }
  get viewPunch() { return this._punchOut; }
  get spread() { return this._spreadShown; }
  get isAiming() { return this.aimT > 0.5; }

  hud() {
    const id = this.cur, w = this.inv[id], d = DEFS[id];
    return {
      weaponId: id, name: d.name, mag: w.mag, magSize: d.magSize, reserve: w.reserve, grenades: this.grenades,
      reloading: !!(this.act && this.act.type === 'reload'),
      slots: ORDER.map((k) => ({ id: k, name: DEFS[k].name, owned: this.inv[k].owned })),
    };
  }

  give(id) {
    const w = this.inv[id]; if (!w) return;
    if (!w.owned) { w.owned = true; w.mag = DEFS[id].magSize; w.reserve = Math.min(DEFS[id].reserveMax, DEFS[id].grant); }
    else this.addAmmo(id, DEFS[id].grant);
  }
  owns(id) { return !!(this.inv[id] && this.inv[id].owned); }
  addAmmo(id, rounds) { const w = this.inv[id]; if (!w) return; w.reserve = Math.min(DEFS[id].reserveMax, w.reserve + rounds); }
  refillAmmo() { for (const id of ORDER) { const w = this.inv[id]; if (w.owned) { w.mag = DEFS[id].magSize; w.reserve = DEFS[id].reserveMax; } } this.slideLocked = false; }
  addGrenades(n) { this.grenades = clamp(this.grenades + n, 0, 4); }
  setActive(id, instant = false) {
    if (!this.owns(id)) return;
    if (instant) { this._equip(id); this.act = null; return; }
    if (id !== this.cur || (this.act && this.act.type === 'switch')) this._startSwitch(id);
  }

  reset() {
    for (const id of ORDER) Object.assign(this.inv[id], { owned: false, mag: 0, reserve: 0 });
    Object.assign(this.inv.pistol, { owned: true, mag: DEFS.pistol.magSize, reserve: Infinity });
    this.grenades = 2;
    this.act = null; this.meleeCD = 0; this.nextFire = 0; this.lastShot = -10; this.burst = 0; this.heat = 0;
    this.aimT = 0; this.aimE = 0; this.sprintT = 0; this.crouchT = 0; this.airT = 0; this.sinceSprint = 1;
    this.bloom = 0; this.bloomAds = 0; this.yawWalk = 0; this.recoverPitch = 0; this.recPending = 0; this.recPendingYaw = 0;
    this.bobPhase = 0; this.bobAmp = 0; this.bobSprint = 0; this.slideT = 1; this.slideLocked = false; this.boltT = 1; this.trigT = 1;
    this.flashT = 1; this.flashFrames = 0; this.dryLatch = false; this.shotIndex = 0;
    this._spreadShown = DEFS.pistol.spreadHip;
    for (const g of [this.k, this.sw, this.land, this.punch]) for (const k in g) g[k].reset();
    this.lw.hold = this.lw.free = this.lw.cam = 0;
    this.grenadeSim?.clear();
    this._equip('pistol');
    this.act = { type: 'switch', t: 0, phase: 'raise', next: 'pistol', silent: true };
  }

  onResize(aspect) {
    this.viewCamera.aspect = aspect; this.viewCamera.updateProjectionMatrix();
    if (this.renderer) { const v = this.renderer.getDrawingBufferSize(new THREE.Vector2()); this.wearScale.value = Math.max(0.5, v.y / 720); }
  }

  // ───────────── внутреннее ─────────────
  _a(name, ...args) { const a = this.audio; if (a && typeof a[name] === 'function') { try { a[name](...args); } catch (e) { /* звук не критичен */ } } }
  _fx(name, ...args) { const f = this.fx; if (f && typeof f[name] === 'function') { try { f[name](...args); } catch (e) { /* эффекты не критичны */ } } }

  _equip(id) {
    this.cur = id;
    for (const k of ORDER) this.models[k].root.visible = k === id;
    const md = this.models[id], A = this.anchors[id];
    this.handR.mesh.position.copy(A.rh.p); this.handR.mesh.quaternion.copy(A.rh.q);
    this.handR.apply(POSES[POSE[id].rhPose]);
    if (md.mag) { md.mag.position.copy(md.magBase); md.mag.visible = true; }
    if (md.shell) md.shell.visible = false;
    this.slideLocked = id === 'pistol' && this.inv.pistol.mag === 0;
    this.bloom = this.bloomAds = 0;
  }

  _startSwitch(id) {
    if (!this.owns(id)) return;
    if (this.act && (this.act.type === 'knife' || this.act.type === 'grenade')) return;
    if (this.act && this.act.type === 'switch') {
      if (this.act.phase === 'lower') { this.act.next = id; return; }
      // во время подъёма — опускаем текущее заново из той же точки
      const k = 1 - this.act.t / 0.3; this.act = { type: 'switch', phase: 'lower', t: 0.25 * clamp(k, 0, 1), next: id };
      return;
    }
    if (id === this.cur) return;
    this.act = { type: 'switch', phase: 'lower', t: 0, next: id };
  }

  _slotId(i) { return ORDER[i] ?? null; }
  _cycle(dir) {
    let i = ORDER.indexOf(this.act && this.act.type === 'switch' ? this.act.next : this.cur);
    for (let n = 0; n < ORDER.length; n++) { i = (i + dir + ORDER.length) % ORDER.length; if (this.inv[ORDER[i]].owned) return ORDER[i]; }
    return null;
  }

  _startReload() {
    const id = this.cur, w = this.inv[id], d = DEFS[id];
    if (this.act || w.mag >= d.magSize || w.reserve <= 0) return false;
    const empty = w.mag === 0;
    if (id === 'shotgun') this.act = { type: 'reload', t: 0, phase: 'start', pt: 0, empty, ev: 0 };
    else this.act = { type: 'reload', t: 0, empty, dur: empty ? d.reloadEmpty : d.reload, ev: 0 };
    if (id === 'shotgun') this.act.dur = Infinity;
    return true;
  }

  _startKnife() {
    if (this.meleeCD > 0) return;
    if (this.act && this.act.type !== 'reload') return;
    this.act = { type: 'knife', t: 0, ev: 0, prevAct: null };
    this.meleeCD = 0.65;
  }

  _startGrenade() {
    if (this.grenades <= 0) return;
    if (this.act && this.act.type !== 'reload') return;
    this.act = { type: 'grenade', t: 0, ev: 0 };
  }

  _canShoot(sprinting) {
    if (this.act) return false;
    if (sprinting || this.sinceSprint < 0.12) return false;
    return true;
  }

  _handleFire(inp, sprinting) {
    const id = this.cur, d = DEFS[id], w = this.inv[id];
    const trig = d.auto ? !!inp.fireDown : !!inp.firePressed;
    if (!inp.fireDown) this.dryLatch = false;
    if (!trig) return;
    // дробовик: выстрел прерывает перезарядку
    if (this.act && this.act.type === 'reload' && id === 'shotgun' && w.mag > 0 && inp.firePressed) { this.act = null; }
    if (!this._canShoot(sprinting)) return;
    if (w.mag > 0) {
      if (this.time >= this.nextFire) this._fire();
    } else if (!this.dryLatch) {
      this.dryLatch = true;
      this._a('weaponDry');
      this.trigT = 0;
      if (w.reserve > 0) this._startReload();
    }
  }

  _camBasis() {
    const c = this.camera;
    c.updateMatrixWorld();
    c.getWorldPosition(this._camPos || (this._camPos = new THREE.Vector3()));
    const e = c.matrixWorld.elements;
    (this._camR || (this._camR = new THREE.Vector3())).set(e[0], e[1], e[2]).normalize();
    (this._camU || (this._camU = new THREE.Vector3())).set(e[4], e[5], e[6]).normalize();
    (this._camF || (this._camF = new THREE.Vector3())).set(-e[8], -e[9], -e[10]).normalize();
  }

  // Точка из пространства оружия → мировая, с поправкой на разницу FOV вьюмодели и основной камеры
  viewToWorld(local, out) {
    out.copy(local).applyMatrix4(this.gunRoot.matrixWorld);
    const k = Math.tan(this.viewCamera.fov * D2R / 2) / Math.tan((this.camera.fov || 75) * D2R / 2);
    out.x *= k; out.y *= k;
    return this.camera.localToWorld(out);
  }

  _spreadTarget(inp) {
    const id = this.cur, d = DEFS[id], a = this.aimE;
    let s = lerp(d.spreadHip, d.spreadAds, a);
    if (id === 'rifle') s += lerp(this.bloom, this.bloomAds, a);
    s += clamp(inp.speed01 || 0, 0, 1) * d.moveSpread * (1 - 0.5 * a);
    if (inp.grounded === false) s += 3;
    if (inp.crouching) s *= 0.85;
    return s;
  }

  _fire() {
    const id = this.cur, d = DEFS[id], w = this.inv[id], md = this.models[id], rnd = this.rng;
    w.mag--;
    this.nextFire = this.time + d.interval;
    this.lastShot = this.time; this.burst++; this.shotIndex++;
    this._a('weaponFire', id);
    this._camBasis();
    const sp = this._spreadTarget(this._inp || NOINPUT);
    const muzzleW = this.viewToWorld(md.muzzle, new THREE.Vector3());
    for (let i = 0; i < d.pellets; i++) {
      // равномерно по диску внутри конуса разброса
      const r = Math.tan(sp * D2R) * Math.sqrt(rnd.next()), a = rnd.next() * Math.PI * 2;
      const dir = this._camF.clone().addScaledVector(this._camR, Math.cos(a) * r).addScaledVector(this._camU, Math.sin(a) * r).normalize();
      const origin = this._camPos.clone();
      let res = null;
      try { res = this.combat?.fireBullet?.({ origin, dir, damage: d.damage, range: d.range, force: d.force, weaponId: id, pellet: i }); } catch (e) { res = null; }
      if (id === 'rifle' && this.shotIndex % 2 === 0) {
        const end = res && res.point ? res.point.clone() : origin.clone().addScaledVector(dir, d.range);
        this._fx('tracer', muzzleW.clone(), end);
      }
    }
    // вспышка
    this.flashT = 0; this.flashFrames = 2;
    const f = md.flash;
    f.star.rotation.z = rnd.next() * Math.PI * 2;
    const sc = 0.75 + rnd.next() * 0.55;
    f.star.scale.setScalar(sc); f.fl.scale.set(0.8 + rnd.next() * 0.6, 0.8 + rnd.next() * 0.5, 0.7 + rnd.next() * 0.7); f.fl.rotation.z = rnd.next() * Math.PI;
    f.cone.scale.set(1, 1, 0.7 + rnd.next() * 0.6);
    this._fx('flash', muzzleW, 0xffaa55, d.flash, 0.06);
    this.heat += id === 'shotgun' ? 1.2 : id === 'rifle' ? 0.22 : 0.35;
    if (id !== 'shotgun') this._eject(d.casing);
    // отдача вьюмодели
    const ads = this.aimE, ks = 1 - 0.5 * ads, K = d.kick;
    this.k.z.v += K.z * ks * (0.9 + rnd.next() * 0.2);
    this.k.y.v += K.y * ks;
    this.k.rx.v += K.rx * ks * (0.85 + rnd.next() * 0.3);
    this.k.ry.v += (rnd.next() - 0.5) * 2 * K.ry * ks;
    this.k.rz.v += (rnd.next() - 0.5) * 2 * K.rz;
    // отдача камеры
    let pitch, yaw;
    if (id === 'rifle') {
      pitch = (0.55 + rnd.next() * 0.25) * D2R;
      this.yawWalk = clamp(this.yawWalk + (rnd.next() - 0.5) * 0.3, -0.3, 0.3);
      yaw = this.yawWalk * 0.6 * D2R;
      this.bloom = Math.min(this.bloom + 0.35, 5 - d.spreadHip);
      this.bloomAds = Math.min(this.bloomAds + 0.08, 0.8);
    } else {
      pitch = d.recoil * (0.9 + rnd.next() * 0.2) * D2R;
      yaw = (rnd.next() - 0.5) * 0.5 * pitch;
    }
    pitch *= 1 - 0.15 * ads;
    this.recPending += pitch; this.recPendingYaw += yaw;
    this.recoverPitch += pitch * d.recover;
    this.punch.pitch.v += d.punch * 30 * (0.8 + rnd.next() * 0.4);
    this.punch.roll.v += (rnd.next() - 0.5) * d.punch * 40;
    this.punch.yaw.v += (rnd.next() - 0.5) * d.punch * 15;
    this.trigT = 0;
    if (id === 'pistol') { this.slideT = 0; if (w.mag === 0) this.slideLocked = true; }
    if (id === 'rifle') this.boltT = 0;
    if (id === 'shotgun') this.act = { type: 'pump', t: 0, ev: 0 };
  }

  _eject(kind) {
    const md = this.models[this.cur], rnd = this.rng;
    this._camBasis();
    const pos = this.viewToWorld(md.eject, new THREE.Vector3());
    const vel = new THREE.Vector3()
      .addScaledVector(this._camR, 1.6 + rnd.next() * 0.9)
      .addScaledVector(this._camU, 1.3 + rnd.next() * 0.9)
      .addScaledVector(this._camF, (rnd.next() - 0.35) * 0.7);
    this._fx('shellCasing', pos, vel, kind);
  }

  _throwGrenade() {
    this._camBasis();
    const pos = this._camPos.clone().addScaledVector(this._camF, 0.45).addScaledVector(this._camR, -0.12).addScaledVector(this._camU, 0.02);
    const vel = this._camF.clone().multiplyScalar(15); vel.y += 4;
    this.grenadeSim.spawn(pos, vel);
    this.grenades = Math.max(0, this.grenades - 1);
    this._a('grenadeThrow');
  }

  // ───────────── кадр ─────────────
  update(dt, s) {
    dt = clamp(dt || 0, 0, 0.05);
    const inp = s || NOINPUT;
    this._inp = inp;
    this.time += dt;
    const sprinting = !!inp.sprinting && inp.grounded !== false;
    this.sinceSprint = sprinting ? 0 : this.sinceSprint + dt;
    this.meleeCD = Math.max(0, this.meleeCD - dt);
    const canAct = inp.canFire !== false;

    // смена оружия
    let want = null;
    if (inp.switchTo !== null && inp.switchTo !== undefined) want = this._slotId(inp.switchTo);
    else if (inp.wheel) want = this._cycle(inp.wheel > 0 ? 1 : -1);
    if (want && this.owns(want) && (want !== this.cur || (this.act && this.act.type === 'switch'))) {
      if (!(this.act && this.act.type === 'reload' && want === this.cur)) {
        if (this.act && (this.act.type === 'reload' || this.act.type === 'pump')) this.act = null;
        this._startSwitch(want);
      }
    }
    if (canAct) {
      if (inp.meleePressed) this._startKnife();
      if (inp.grenadePressed) this._startGrenade();
      if (inp.reloadPressed) this._startReload();
      this._handleFire(inp, sprinting);
    } else this.dryLatch = false;

    this._updateAction(dt, inp);

    // прицеливание
    const busy = this.act && this.act.type !== 'pump';
    const wantAim = !!inp.aimDown && canAct && !sprinting && !busy;
    this.aimT = clamp(this.aimT + (wantAim ? dt : -dt) / 0.18, 0, 1);
    this.aimE = EASE.io(this.aimT);

    // разброс
    const rec = 6 * dt;
    this.bloom = Math.max(0, this.bloom - rec); this.bloomAds = Math.max(0, this.bloomAds - rec * 0.3);
    this._spreadShown = damp(this._spreadShown, this._spreadTarget(inp), 18, dt);

    // дым после серии
    if (this.time - this.lastShot > 0.12) {
      if (this.heat >= 0.9) { this._camBasis(); this._fx('muzzleSmoke', this.viewToWorld(this.models[this.cur].muzzle, new THREE.Vector3()), this._camF.clone()); this.heat = 0; }
      this.burst = 0;
    }
    this.heat = Math.max(0, this.heat - dt * 0.25);

    this._updatePose(dt, inp, sprinting);
    this._updateEffects(dt);
    this._updateRecoil(dt);
    this.grenadeSim.update(dt);
  }

  _updateAction(dt, inp) {
    const a = this.act;
    if (!a) return;
    a.t += dt;
    const id = this.cur, w = this.inv[id], d = DEFS[id], md = this.models[id];
    const evAt = (time, fn) => { if (a.t >= time && (a.evDone || (a.evDone = new Set())) && !a.evDone.has(time)) { a.evDone.add(time); fn(); } };
    switch (a.type) {
      case 'switch':
        if (a.phase === 'lower' && a.t >= 0.25) { this._equip(a.next); a.phase = 'raise'; a.t = 0; this._a('weaponSwitch'); }
        else if (a.phase === 'raise' && a.t >= 0.3) this.act = null;
        break;
      case 'pump':
        evAt(0.16, () => this._a('weaponReload', 'shotgun', 'pump'));
        evAt(0.3, () => this._eject('shotgun'));
        if (a.t >= 0.75) this.act = null;
        break;
      case 'reload':
        if (id === 'shotgun') this._shotgunReloadStep(a, w, d);
        else {
          const T = a.dur;
          if (id === 'pistol') {
            evAt(0.2, () => this._a('weaponReload', id, 'magOut'));
            evAt(0.5, () => this._a('weaponReload', id, 'grab'));
            evAt(0.84, () => { this._a('weaponReload', id, 'magIn'); this._transferMag(w, d); });
            if (a.empty) evAt(1.03, () => { this._a('weaponReload', id, 'slide'); this.slideLocked = false; this.slideT = 0.03; });
          } else {
            evAt(0.34, () => this._a('weaponReload', id, 'magOut'));
            evAt(0.95, () => this._a('weaponReload', id, 'grab'));
            evAt(1.4, () => { this._a('weaponReload', id, 'magIn'); this._transferMag(w, d); });
            if (a.empty) { evAt(1.86, () => this._a('weaponReload', id, 'bolt')); evAt(2.0, () => this._a('weaponReload', id, 'slide')); }
          }
          if (a.t >= T) this.act = null;
        }
        break;
      case 'knife':
        evAt(0.06, () => this._a('knifeSwing'));
        evAt(0.12, () => {
          this._camBasis();
          let r = null;
          try { r = this.combat?.melee?.({ origin: this._camPos.clone(), dir: this._camF.clone(), range: 1.9, damage: 80, force: 3 }); } catch (e) { r = null; }
          if (r && r.hit) { this._a('knifeHit'); this.punch.yaw.v -= 0.6; this.punch.roll.v += 0.8; }
        });
        if (a.t >= 0.5) this.act = null;
        break;
      case 'grenade':
        evAt(0.06, () => this._a('grenadePin'));
        evAt(0.42, () => { this._throwGrenade(); this.punch.pitch.v -= 0.4; });
        if (a.t >= 0.7) this.act = null;
        break;
    }
  }

  _transferMag(w, d) { const n = Math.min(d.magSize - w.mag, w.reserve); w.mag += n; w.reserve -= n; }

  _shotgunReloadStep(a, w, d) {
    const tp = a.t - (a.p0 || 0);
    if (a.phase === 'start' && tp >= 0.35) { a.phase = 'shell'; a.p0 = a.t; a.loaded = false; }
    else if (a.phase === 'shell') {
      if (!a.loaded && tp >= 0.27) { a.loaded = true; w.mag++; w.reserve--; this._a('weaponReload', 'shotgun', 'shellIn'); }
      if (tp >= 0.48) {
        if (w.mag < d.magSize && w.reserve > 0) { a.p0 = a.t; a.loaded = false; }
        else { a.phase = 'end'; a.p0 = a.t; a.pumped = false; }
      }
    } else if (a.phase === 'end') {
      const T = a.empty ? 0.95 : 0.4;
      if (a.empty && !a.pumped && tp >= 0.5) { a.pumped = true; this._a('weaponReload', 'shotgun', 'pump'); }
      if (tp >= T) this.act = null;
    }
    a.tp = a.t - (a.p0 || 0);
  }

  // Анимация действия → смещения оружия и цели левой руки
  _actionPose(o) {
    o.gp[0] = o.gp[1] = o.gp[2] = 0; o.gr[0] = o.gr[1] = o.gr[2] = 0;
    o.wHold = 0; o.wFree = 0; o.wCam = 0; o.objVis = true; o.objFree = false;
    for (let i = 0; i < 6; i++) o.obj[i] = 0;
    const a = this.act, id = this.cur, md = this.models[id], P = POSE[id];
    this.knife.visible = false; this.nade.visible = false;
    if (md.shell) md.shell.visible = false;
    this._pumpZ = 0; this._boltPull = 0;
    if (!a) return;
    const t = a.t;
    if (a.type === 'switch') {
      const k = a.phase === 'lower' ? EASE.i(clamp(t / 0.25, 0, 1)) : 1 - EASE.o(clamp(t / 0.3, 0, 1));
      o.gp[1] -= 0.2 * k; o.gp[2] += 0.04 * k; o.gr[0] -= 0.9 * k; o.gr[2] += 0.25 * k;
    } else if (a.type === 'pump') {
      const e = env(t, 0.14, 0.3, 0.34, 0.52);
      this._pumpZ = 0.085 * e;
      o.gp[2] += 0.012 * e; o.gr[0] -= 0.035 * e; o.gr[2] += 0.04 * e; o.gp[1] -= 0.006 * e;
    } else if (a.type === 'reload') {
      if (id === 'pistol') this._pistolReload(t, a.empty, o, md);
      else if (id === 'rifle') this._rifleReload(t, a.empty, o, md);
      else this._shotgunReload(a, o, md);
    } else if (a.type === 'knife' || a.type === 'grenade') {
      const T = a.type === 'knife' ? 0.5 : 0.7;
      const dip = env(t, 0, 0.09, T - 0.22, T, EASE.o);
      o.gp[0] += 0.035 * dip; o.gp[1] -= 0.11 * dip; o.gp[2] += 0.05 * dip;
      o.gr[0] -= 0.55 * dip; o.gr[1] -= 0.25 * dip; o.gr[2] -= 0.35 * dip;
      o.wCam = 1;
      sampleKeys(a.type === 'knife' ? KNIFE_KEYS : NADE_KEYS, t, o.cam);
      if (a.type === 'knife') this.knife.visible = true;
      else this.nade.visible = t < 0.42;
    }
  }

  _pistolReload(t, empty, o, md) {
    const T = empty ? 1.65 : 1.35;
    const tilt = env(t, 0.0, 0.24, empty ? 1.15 : 0.92, T - 0.02);
    o.gp[0] -= 0.03 * tilt; o.gp[1] += 0.028 * tilt; o.gp[2] += 0.04 * tilt;
    o.gr[0] += 0.22 * tilt; o.gr[1] -= 0.18 * tilt; o.gr[2] += 0.55 * tilt;
    const bump = env(t, 0.82, 0.86, 0.86, 0.98); o.gp[1] += 0.01 * bump; o.gr[0] += 0.06 * bump;
    if (empty) { const sb = env(t, 1.02, 1.05, 1.05, 1.22); o.gp[2] += 0.012 * sb; o.gr[0] += 0.07 * sb; }
    // магазин: вдоль оси рукояти (obj[1] = смещение вдоль оси), боковой сдвиг obj[0], крен obj[5]
    if (t < 0.2) { /* на месте */ }
    else if (t < 0.45) { const u = t - 0.2; o.obj[1] = -(0.25 * u + 4.9 * u * u); o.obj[0] = -0.08 * u; o.obj[3] = -0.6 * u; o.objVis = o.obj[1] > -0.3; }
    else {
      const u = EASE.o(clamp((t - 0.45) / 0.3, 0, 1)), v = EASE.io(clamp((t - 0.75) / 0.1, 0, 1));
      o.obj[1] = lerp(lerp(-0.24, -0.045, u), 0, v); o.obj[0] = lerp(-0.05, 0, u); o.obj[5] = lerp(0.35, 0, u);
    }
    o.wFree = env(t, 0.06, 0.3, 0.42, 0.46);
    o.wHold = env(t, 0.42, 0.46, 0.88, 1.12);
    sampleKeys(P_FREE_PISTOL, t, o.free);
  }

  _rifleReload(t, empty, o, md) {
    const T = empty ? 2.6 : 2.1;
    const tilt = env(t, 0.0, 0.3, empty ? 2.12 : 1.58, T - 0.02);
    o.gp[0] -= 0.045 * tilt; o.gp[1] += 0.04 * tilt; o.gp[2] += 0.07 * tilt;
    o.gr[0] += 0.16 * tilt; o.gr[1] -= 0.28 * tilt; o.gr[2] += 0.6 * tilt;
    const bump = env(t, 1.38, 1.42, 1.42, 1.56); o.gp[1] += 0.012 * bump; o.gr[0] += 0.05 * bump;
    if (empty) {
      const roll = env(t, 1.5, 1.75, 2.08, 2.4); o.gr[2] += 0.35 * roll; o.gr[0] -= 0.05 * roll; o.gp[0] -= 0.02 * roll;
      const pull = env(t, 1.8, 1.93, 1.95, 1.99, EASE.o);
      this._boltPull = 0.06 * pull;
      const kick = env(t, 1.98, 2.0, 2.0, 2.12); o.gp[2] += 0.01 * kick; o.gr[0] += 0.04 * kick;
    }
    // магазин: [x, y, z, rx, ry, rz] относительно гнезда (поворот вокруг переднего зацепа)
    sampleKeys(RIFLE_MAG, t, o.obj);
    o.objVis = !(t > 0.82 && t < 0.9);
    o.wHold = Math.max(env(t, 0.05, 0.3, 0.58, 0.64), env(t, 0.86, 0.92, 1.45, 1.72));
    o.wFree = Math.max(env(t, 0.58, 0.64, 0.86, 0.92), empty ? env(t, 1.5, 1.78, 2.05, 2.32) : 0);
    sampleKeys(empty && t > 1.3 ? P_FREE_RIFLE_BOLT : P_FREE_RIFLE, t, o.free);
  }

  _shotgunReload(a, o, md) {
    const tp = a.tp || 0, ph = a.phase;
    let tilt = 1;
    if (ph === 'start') tilt = EASE.io(clamp(tp / 0.3, 0, 1));
    if (ph === 'end') tilt = 1 - EASE.io(clamp((tp - (a.empty ? 0.45 : 0.05)) / 0.35, 0, 1));
    o.gp[0] -= 0.03 * tilt; o.gp[1] += 0.03 * tilt; o.gp[2] += 0.06 * tilt;
    o.gr[0] += 0.12 * tilt; o.gr[1] -= 0.22 * tilt; o.gr[2] += 0.62 * tilt;
    if (ph === 'start') { o.wFree = EASE.io(clamp((tp - 0.04) / 0.26, 0, 1)); sampleKeys(SHELL_KEYS, 0, o.obj); }
    else if (ph === 'shell') {
      o.wHold = 1;
      sampleKeys(SHELL_KEYS, tp, o.obj);
      o.objVis = tp < 0.285;
      const push = env(tp, 0.2, 0.27, 0.27, 0.36); o.gp[1] += 0.004 * push; o.gr[0] += 0.02 * push;
    } else if (ph === 'end') {
      o.wFree = 1 - EASE.io(clamp(tp / 0.3, 0, 1));
      if (a.empty) { const e = env(tp, 0.45, 0.62, 0.66, 0.85); this._pumpZ = 0.085 * e; o.gp[2] += 0.012 * e; o.gr[0] -= 0.035 * e; }
      sampleKeys(SHELL_KEYS, 0, o.obj);
    }
    sampleKeys(P_FREE_SHOTGUN, 0, o.free);
    if (md.shell) {
      md.shell.visible = ph === 'shell' && o.objVis;
      md.shell.position.set(o.obj[0], o.obj[1], o.obj[2]);
      md.shell.rotation.set(o.obj[3], o.obj[4], o.obj[5]);
    }
  }

  _updatePose(dt, inp, sprinting) {
    const id = this.cur, md = this.models[id], P = POSE[id], A = this.anchors[id], o = this._o;
    this._actionPose(o);
    const a = this.act, busy = a && a.type !== 'pump';
    const aim = this.aimE, calm = 1 - 0.8 * aim;
    // спринт, присед, полёт
    this.sprintT = damp(this.sprintT, sprinting && !busy ? 1 : 0, 9, dt);
    this.crouchT = damp(this.crouchT, inp.crouching ? 1 : 0, 10, dt);
    this.airT = damp(this.airT, inp.grounded === false ? 1 : 0, 8, dt);
    if (inp.landed > 0) { this.land.y.v -= 0.45 * inp.landed; this.land.rx.v -= 1.1 * inp.landed; }
    // покачивание при ходьбе (восьмёрка)
    const moving = inp.grounded === false ? 0 : clamp(inp.speed01 || 0, 0, 1);
    this.bobAmp = damp(this.bobAmp, moving, 7, dt);
    this.bobSprint = damp(this.bobSprint, sprinting ? 1 : 0, 6, dt);
    this.bobPhase += dt * Math.PI * 2 * (0.9 + 0.5 * this.bobSprint) * (0.55 + 0.45 * moving);
    const A0 = this.bobAmp * (1 + 1.3 * this.bobSprint) * calm, ph = this.bobPhase;
    const bx = Math.sin(ph) * 0.010 * A0, by = Math.sin(ph * 2) * 0.006 * A0 - 0.003 * A0;
    // дыхание
    const T = this.time, br = 1 - 0.7 * aim;
    // инерция взгляда
    const inv = 1 / Math.max(dt, 1 / 240);
    const lx = clamp((inp.lookDX || 0) * inv, -4000, 4000), ly = clamp((inp.lookDY || 0) * inv, -4000, 4000);
    const swayK = 0.000045 * (1 - 0.7 * aim);
    const sy = this.sw.yaw.step(dt, clamp(lx * swayK, -0.07, 0.07)), sp = this.sw.pitch.step(dt, clamp(ly * swayK, -0.05, 0.05));
    // пружины отдачи и приземления
    const kz = this.k.z.step(dt), ky = this.k.y.step(dt), krx = this.k.rx.step(dt), kry = this.k.ry.step(dt), krz = this.k.rz.step(dt);
    const ly2 = this.land.y.step(dt), lrx = this.land.rx.step(dt);
    // база: от бедра → прицел
    const hip = P.hip;
    _v1.set(lerp(hip[0], 0, aim), lerp(hip[1], -md.sightU, aim), lerp(hip[2], P.adsZ, aim));
    _q1.copy(A.hipQ).slerp(_qI, aim);
    const sT = this.sprintT * (1 - aim), cT = this.crouchT * (1 - aim);
    const SP = P.sprint;
    const px = bx + sy * -0.12 + SP.p[0] * sT - 0.012 * cT + o.gp[0];
    const py = by + Math.sin(T * 1.7) * 0.0012 * br + sp * 0.08 + SP.p[1] * sT - 0.01 * cT + 0.006 * this.airT + ly2 + ky + o.gp[1];
    const pz = kz + SP.p[2] * sT + 0.012 * cT + o.gp[2];
    const rx = Math.sin(ph * 2) * 0.012 * A0 + Math.sin(T * 1.7 + 0.6) * 0.004 * br + sp + SP.r[0] * sT - 0.03 * this.airT + lrx + krx + o.gr[0];
    const ry = Math.sin(ph) * 0.012 * A0 + Math.sin(T * 0.9) * 0.003 * br + sy + SP.r[1] * sT + kry + o.gr[1];
    const rz = Math.sin(ph) * 0.028 * A0 + sy * 0.6 + SP.r[2] * sT + 0.06 * cT + krz + o.gr[2];
    this.gunRoot.position.set(_v1.x + px, _v1.y + py, _v1.z + pz);
    _e1.set(rx, ry, rz, 'YXZ');
    this.gunRoot.quaternion.copy(_q1).multiply(_q2.setFromEuler(_e1));
    this.gunRoot.updateMatrix();
    this.gunRoot.updateMatrixWorld(true);

    // движущиеся детали
    if (id === 'pistol') {
      this.slideT += dt;
      let so = 0; const st = this.slideT;
      if (st < 0.03) so = st / 0.03; else if (st < 0.08) so = 1 - (st - 0.03) / 0.05;
      if (this.slideLocked && st >= 0.03) so = 1;
      md.slide.position.z = 0.025 * EASE.o(clamp(so, 0, 1));
    } else if (id === 'rifle') {
      this.boltT += dt;
      const bt = this.boltT; let bo = 0;
      if (bt < 0.025) bo = bt / 0.025; else if (bt < 0.06) bo = 1 - (bt - 0.025) / 0.035;
      md.bolt.position.z = Math.max(0.06 * bo, this._boltPull);
    } else if (id === 'shotgun') {
      md.pump.position.z = md.pumpBase + this._pumpZ;
    }
    this.trigT += dt;
    md.trigger.rotation.x = -0.28 * env(this.trigT, 0, 0.02, 0.05, 0.12);
    // магазин
    if (md.mag) {
      md.mag.visible = o.objVis;
      if (id === 'pistol') {
        md.mag.position.copy(md.magBase).addScaledVector(md.magAxis, -o.obj[1]);
        md.mag.position.x += o.obj[0];
        md.mag.rotation.set(-22 * D2R + o.obj[3], 0, o.obj[5]);
      } else {
        md.mag.position.set(md.magBase.x + o.obj[0], md.magBase.y + o.obj[1], md.magBase.z + o.obj[2]);
        md.mag.rotation.set(o.obj[3], o.obj[4], o.obj[5]);
      }
    }
    md.root.updateMatrixWorld(true);

    // левая рука: опора → предмет в руке → свободная поза (в пространстве оружия) → поза в пространстве камеры
    const lw = this.lw, lam = 30;
    lw.hold = damp(lw.hold, o.wHold, lam, dt); lw.free = damp(lw.free, o.wFree, lam, dt); lw.cam = damp(lw.cam, o.wCam, 22, dt);
    // опора
    const sup = A.lh;
    if (id === 'shotgun') { _m2.copy(md.pump.matrix); _m1.multiplyMatrices(this.gunRoot.matrix, _m2).multiply(trs(_m3, sup.p, sup.q)); }
    else _m1.multiplyMatrices(this.gunRoot.matrix, trs(_m3, sup.p, sup.q));
    const LP = _v2, LQ = this._lq || (this._lq = new THREE.Quaternion());
    _m1.decompose(LP, LQ, _v4);
    const wsum = lw.hold + lw.free;
    if (wsum > 1e-3) {
      // предмет: магазин / патрон
      const holdObj = id === 'shotgun' ? md.shell : md.mag;
      _m2.multiplyMatrices(this.gunRoot.matrix, holdObj.matrix).multiply(trs(_m3, A.hold.p, A.hold.q));
      const HP = _v3, HQ = this._hq || (this._hq = new THREE.Quaternion());
      _m2.decompose(HP, HQ, _v4);
      // свободная поза
      _e1.set(o.free[3], o.free[4], o.free[5], 'XYZ');
      _m3.compose(_v4.set(o.free[0], o.free[1], o.free[2]), _q2.setFromEuler(_e1), _s1);
      _m2.multiplyMatrices(this.gunRoot.matrix, _m3);
      const FP = this._fp || (this._fp = new THREE.Vector3()), FQ = this._fq || (this._fq = new THREE.Quaternion());
      _m2.decompose(FP, FQ, _v4);
      const wf = lw.free / Math.max(wsum, 1e-6);
      HP.lerp(FP, wf); HQ.slerp(FQ, wf);
      blendInto(LP, LQ, HP, HQ, Math.min(1, wsum));
    }
    if (lw.cam > 1e-3) {
      _e1.set(o.cam[3], o.cam[4], o.cam[5], 'XYZ');
      _v3.set(o.cam[0], o.cam[1], o.cam[2]); _q2.setFromEuler(_e1);
      blendInto(LP, LQ, _v3, _q2, lw.cam);
    }
    this.handL.mesh.position.copy(LP); this.handL.mesh.quaternion.copy(LQ);
    // пальцы левой руки
    const PZ = POSES;
    _pose.set(PZ[P.lhPose]);
    if (wsum > 1e-3) { const hp = PZ[P.holdPose], fp = PZ[P.freePose || 'relaxed'], wf = lw.free / Math.max(wsum, 1e-6), k = Math.min(1, wsum); for (let i = 0; i < 21; i++) _pose[i] = lerp(_pose[i], lerp(hp[i], fp[i], wf), k); }
    if (lw.cam > 1e-3) { const cp = PZ[a && a.type === 'grenade' ? 'grenade' : 'knife']; for (let i = 0; i < 21; i++) _pose[i] = lerp(_pose[i], cp[i], lw.cam); }
    this.handL.apply(_pose);
    // указательный палец правой руки дожимает спуск
    const rp = PZ[P.rhPose];
    _pose.set(rp); const tp = env(this.trigT, 0, 0.02, 0.05, 0.12); _pose[1] += 0.12 * tp; _pose[2] += 0.1 * tp;
    this.handR.apply(_pose);
    this.rig.updateMatrixWorld(true);
    // рукава: от запястья к локтю (локоть следует за оружием наполовину)
    this._orientSleeve(this.sleeveR, this.handR.mesh, P.elbowR, 0.5);
    this._orientSleeve(this.sleeveL, this.handL.mesh, P.elbowL, 0.3);
    // нож/граната в левой руке
    if (this.knife.visible) { this.knife.position.fromArray(P_KNIFE.p); this.knife.rotation.fromArray(P_KNIFE.r); }
    if (this.nade.visible) { this.nade.position.fromArray(P_NADE.p); this.nade.rotation.fromArray(P_NADE.r); }
  }

  _orientSleeve(sleeve, hand, elbow, follow) {
    const w = _v1.set(0, 0, 0.03).applyMatrix4(hand.matrixWorld);
    const e = _v2.fromArray(elbow);
    e.x += (this.gunRoot.position.x - POSE[this.cur].hip[0]) * follow;
    e.y += (this.gunRoot.position.y - POSE[this.cur].hip[1]) * follow;
    const z = _v3.subVectors(e, w).normalize();
    const up = _v4.set(0, 1, 0).applyQuaternion(hand.getWorldQuaternion(_q2));
    const x = up.cross(z).normalize();
    const y = _v2.crossVectors(z, x);
    _m1.makeBasis(x, y, z);
    sleeve.quaternion.setFromRotationMatrix(_m1);
    sleeve.position.copy(w);
  }

  _updateEffects(dt) {
    const md = this.models[this.cur], f = md.flash;
    this.flashT += dt;
    const on = this.flashFrames > 0 || this.flashT < 0.035;
    f.g.visible = on;
    if (this.flashFrames > 0) this.flashFrames--;
    for (const k of ORDER) if (k !== this.cur) this.models[k].flash.g.visible = false;
    const li = this.flashT < 0.05 ? DEFS[this.cur].flash * 0.28 * (1 - this.flashT / 0.05) : 0;
    this.muzzleLight.intensity = li;
    if (li > 0) this.muzzleLight.position.copy(md.muzzle).applyMatrix4(this.gunRoot.matrix);
  }

  _updateRecoil(dt) {
    // отдача в камеру — плавно за несколько кадров; частичный возврат после серии
    const k = 1 - Math.exp(-dt * 38);
    const p = this.recPending * k, y = this.recPendingYaw * k;
    this.recPending -= p; this.recPendingYaw -= y;
    this._rec.pitch += p; this._rec.yaw += y;
    if (this.time - this.lastShot > 0.11 && this.recoverPitch > 0) {
      const r = this.recoverPitch * (1 - Math.exp(-dt * 7));
      this.recoverPitch -= r; this._rec.pitch -= r;
    }
    const pu = this.punch;
    this._punchOut.pitch = pu.pitch.step(dt) * 0.02;
    this._punchOut.yaw = pu.yaw.step(dt) * 0.02;
    this._punchOut.roll = pu.roll.step(dt) * 0.02;
  }
}

// ───────────── ключи анимаций (пространство оружия) ─────────────
// свободная левая рука при перезарядке пистолета: уходит вниз за кадр
const P_FREE_PISTOL = [[0, [-0.07, -0.2, 0.05, 0.5, 0.2, 0.6]], [1.6, [-0.07, -0.2, 0.05, 0.5, 0.2, 0.6]]];
const P_FREE_RIFLE = [[0, [-0.06, -0.32, -0.06, 0.6, 0.3, 0.8]], [2.6, [-0.06, -0.32, -0.06, 0.6, 0.3, 0.8]]];
// рукоятка взведения: кисть сверху-справа над крышкой
const P_FREE_RIFLE_BOLT = [
  [1.3, [-0.06, -0.32, -0.06, 0.6, 0.3, 0.8]],
  [1.78, [0.01, 0.075, -0.26, 1.5, 1.6, 0.1]],
  [1.8, [0.01, 0.075, -0.26, 1.5, 1.6, 0.1]],
  [1.93, [0.01, 0.075, -0.20, 1.5, 1.6, 0.1], 'o'],
  [2.05, [0.03, 0.09, -0.19, 1.4, 1.6, 0.2]],
  [2.6, [0.03, 0.09, -0.19, 1.4, 1.6, 0.2]],
];
const RIFLE_MAG = [
  [0.3, [0, 0, 0, 0, 0, 0]],
  [0.46, [0, -0.006, 0, 0.5, 0, 0]],
  [0.6, [-0.01, -0.09, 0.03, 0.62, 0, -0.1]],
  [0.84, [-0.12, -0.45, 0.12, 1.6, 0.3, -0.6], 'i'],
  [0.85, [-0.04, -0.34, 0.02, 0.6, 0, 0]],
  [1.0, [-0.04, -0.34, 0.02, 0.6, 0, 0]],
  [1.28, [0, -0.014, -0.004, 0.42, 0, 0], 'o'],
  [1.41, [0, 0, 0, 0, 0, 0]],
];
const P_FREE_SHOTGUN = [[0, [-0.06, -0.25, -0.12, 0.6, 0.2, 0.5]]];
// патрон в пространстве оружия: снизу → к окну подачи → внутрь трубы
const SHELL_KEYS = [
  [0, [-0.035, -0.2, -0.12, 0.2, 0.1, 0]],
  [0.18, [0, -0.052, -0.118, 0.06, 0, 0], 'o'],
  [0.27, [0, -0.028, -0.2, 0, 0, 0]],
  [0.29, [0, -0.028, -0.2, 0, 0, 0]],
  [0.48, [-0.035, -0.2, -0.12, 0.2, 0.1, 0]],
];
const P_KNIFE = { p: [0.004, -0.021, -0.07], r: [0, -Math.PI / 2, 0] };
const P_NADE = { p: [0.0, -0.036, -0.066], r: [0, 0, 0] };
