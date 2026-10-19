// Игрок: движение (ходьба/бег/присед/прыжок), коллизии, камера с покачиванием и тряской,
// фонарик с лёгкой инерцией, здоровье/броня/выносливость, смерть.
import * as THREE from 'three';
import { clamp, damp } from './noise.js';
import { settings, DIFF } from './settings.js';

const WALK = 4.4, SPRINT = 7.0, CROUCH = 2.3, JUMP = 5.4, GRAV = 16;
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();

export class Player {
  constructor({ camera, scene, world, audio, quality }) {
    this.camera = camera; this.world = world; this.audio = audio;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.radius = 0.38;
    // фонарик: свет живёт в сцене и догоняет поворот камеры с небольшой задержкой
    this.flash = new THREE.SpotLight(0xfff1d6, 150, 55, 0.43, 0.6, 1.75);
    this.flash.castShadow = quality === 'high';
    this.flash.shadow.mapSize.set(1024, 1024);
    this.flash.shadow.camera.near = 0.3; this.flash.shadow.camera.far = 45;
    this.flash.shadow.bias = -0.0004; this.flash.shadow.normalBias = 0.02;
    this.flashTarget = new THREE.Object3D();
    this.flash.target = this.flashTarget;
    scene.add(this.flash, this.flashTarget);
    this.flashQ = new THREE.Quaternion();
    this.reset();
  }

  reset() {
    this.pos.set(0, this.world.heightAt(0, 22), 22);
    this.vel.set(0, 0, 0);
    this.yaw = 0; this.pitch = -0.04;
    this.hp = this.maxHp = 100; this.armor = 0;
    this.stamina = 100; this.staminaCd = 0;
    this.alive = true; this.grounded = true; this.crouchK = 0;
    this.lastHurt = 99; this.bob = 0; this.stepDist = 0;
    this.landDip = 0; this.landVel = 0; this.shakeAmt = 0;
    this.deathT = 0; this.fov = settings.fov;
    this.flashOn = true; this.flash.visible = true;
    this.speed01 = 0; this.sprinting = false;
    this.flashQ.setFromEuler(_e.set(this.pitch, this.yaw, 0, 'YXZ'));
    this.god = false;
  }

  /** ввод → движение; возвращает состояние для оружия */
  update(dt, inp, opts) {
    const st = this._st || (this._st = {});
    if (!this.alive) { this.updateDeath(dt); st.speed01 = 0; st.landed = 0; return st; }
    const sens = 0.0021 * settings.sens * (opts.aiming ? 0.65 : 1);
    this.yaw -= inp.m.dx * sens;
    this.pitch -= inp.m.dy * sens * (settings.invert ? -1 : 1);
    this.pitch = clamp(this.pitch, -1.52, 1.52);
    let fx = 0, fz = 0;
    if (opts.control) {
      if (inp.down('KeyW') || inp.down('ArrowUp')) fz += 1;
      if (inp.down('KeyS') || inp.down('ArrowDown')) fz -= 1;
      if (inp.down('KeyA') || inp.down('ArrowLeft')) fx -= 1;
      if (inp.down('KeyD') || inp.down('ArrowRight')) fx += 1;
    }
    const crouch = opts.control && (inp.down('ControlLeft') || inp.down('ControlRight') || inp.down('KeyC'));
    this.crouchK = damp(this.crouchK, crouch ? 1 : 0, 12, dt);
    const wantSprint = opts.control && (inp.down('ShiftLeft') || inp.down('ShiftRight')) && fz > 0 && !crouch && !opts.aiming;
    this.staminaCd -= dt;
    const sprint = wantSprint && this.stamina > (this.sprinting ? 0 : 12);
    const speed = crouch ? CROUCH : sprint ? SPRINT : opts.aiming ? WALK * 0.62 : WALK;
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    let wx = -s * fz + c * fx, wz = -c * fz - s * fx;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx /= wl; wz /= wl; }
    const acc = this.grounded ? 11 : 2.2;
    this.vel.x = damp(this.vel.x, wx * speed, acc, dt);
    this.vel.z = damp(this.vel.z, wz * speed, acc, dt);
    if (opts.control && inp.hit('Space') && this.grounded && !crouch) {
      this.vel.y = JUMP; this.grounded = false; this.audio?.jump?.();
    }
    this.vel.y -= GRAV * dt;
    this.pos.addScaledVector(this.vel, dt);
    this.collide();
    const gy = this.world.heightAt(this.pos.x, this.pos.z);
    let landed = 0;
    if (this.pos.y <= gy || (this.grounded && this.vel.y <= 0 && this.pos.y - gy < 0.35)) {
      if (!this.grounded) {
        landed = clamp(-this.vel.y / 9, 0, 1);
        this.landVel -= landed * 2.2;
        this.audio?.land?.(landed);
      }
      this.pos.y = gy; this.vel.y = 0; this.grounded = true;
    } else this.grounded = false;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.sprinting = sprint && hs > WALK * 0.9;
    if (this.sprinting) { this.stamina = Math.max(0, this.stamina - 19 * dt); this.staminaCd = 0.9; }
    else if (this.staminaCd <= 0) this.stamina = Math.min(100, this.stamina + 16 * dt);
    this.speed01 = clamp(hs / SPRINT, 0, 1);
    // шаги и покачивание
    if (this.grounded && hs > 0.5) {
      const stride = this.sprinting ? 1.25 : crouch ? 0.8 : 1.0;
      this.bob += (hs / stride) * Math.PI * dt * 0.5;
      this.stepDist += hs * dt;
      if (this.stepDist > stride * 1.1) {
        this.stepDist = 0;
        this.audio?.footstep?.(this.world.surfaceAt?.(this.pos.x, this.pos.z) || 'grass', this.speed01);
      }
    }
    // пружина приземления
    this.landVel += (-this.landDip * 90 - this.landVel * 12) * dt;
    this.landDip += this.landVel * dt;
    this.lastHurt += dt;
    if (this.lastHurt > 5 && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + 4 * dt);
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 1.6);
    if (opts.control && inp.hit('KeyF')) { this.flashOn = !this.flashOn; this.flash.visible = this.flashOn; this.audio?.uiClick?.(); }
    st.speed01 = this.speed01; st.sprinting = this.sprinting; st.grounded = this.grounded;
    st.crouching = crouch; st.landed = landed;
    return st;
  }

  collide() {
    const p = this.pos, w = this.world;
    for (const c of w.colliders) {
      const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), r = c.r + this.radius;
      if (d < r && d > 1e-5) { p.x += (dx / d) * (r - d); p.z += (dz / d) * (r - d); }
    }
    const r = Math.hypot(p.x, p.z) || 1e-5;
    const R = w.pit.radiusAt(Math.atan2(p.z, p.x)) + 0.75;
    if (r < R) { p.x *= R / r; p.z *= R / r; }
    const B = w.bounds.radius - 0.8;
    if (r > B) { p.x *= B / r; p.z *= B / r; }
  }

  shake(a) { this.shakeAmt = Math.min(1.2, this.shakeAmt + a); }

  damage(amount, from, kind, diff = 'normal') {
    if (!this.alive || this.god) return 0;
    amount *= DIFF[diff]?.dmg ?? 1;
    if (this.armor > 0) { const ab = Math.min(this.armor, amount * 0.6); this.armor -= ab; amount -= ab; }
    this.hp -= amount;
    this.lastHurt = 0;
    this.shake(0.22 + amount / 45);
    this.audio?.playerHurt?.(clamp(amount / 30, 0.2, 1));
    if (this.hp <= 0) { this.hp = 0; this.alive = false; this.deathT = 0; this.audio?.playerDeath?.(); }
    return amount;
  }

  updateDeath(dt) {
    this.deathT += dt;
    this.vel.set(0, 0, 0);
  }

  /** ставит основную камеру: отдача и тряска добавляются к взгляду */
  updateCamera(dt, recoil, punch, fovScale, t) {
    const cam = this.camera;
    if (recoil) { this.pitch = clamp(this.pitch + recoil.pitch, -1.52, 1.52); this.yaw += recoil.yaw; }
    const k = this.speed01;
    const eye = 1.66 - 0.55 * this.crouchK;
    const bobY = Math.abs(Math.sin(this.bob)) * 0.045 * k - 0.02 * k;
    const bobX = Math.sin(this.bob) * 0.03 * k;
    const sh = this.shakeAmt * this.shakeAmt;
    const nx = (Math.sin(t * 37.1) + Math.sin(t * 23.7)) * 0.5, ny = (Math.sin(t * 41.3) + Math.sin(t * 29.9)) * 0.5;
    let y = this.pos.y + eye + bobY + this.landDip * 0.12;
    let roll = Math.sin(this.bob) * 0.006 * k + (punch?.roll || 0);
    let pitch = this.pitch + (punch?.pitch || 0) + ny * sh * 0.045;
    let yaw = this.yaw + (punch?.yaw || 0) + nx * sh * 0.045;
    if (!this.alive) {
      const d = Math.min(1, this.deathT / 1.1);
      const e = d * d;
      y = this.pos.y + eye * (1 - e) + 0.25 * e;
      roll += 0.9 * e; pitch = pitch * (1 - e) + 0.35 * e;
    }
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    cam.position.set(this.pos.x + c * bobX, y, this.pos.z - s * bobX);
    cam.rotation.set(pitch, yaw, roll, 'YXZ');
    const sprintFov = this.sprinting ? 5 : 0;
    this.fov = damp(this.fov, (settings.fov + sprintFov) * (fovScale || 1), 10, dt);
    if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
    // фонарик: чуть ниже и правее глаз, догоняет взгляд
    _q.setFromEuler(_e.set(this.pitch, this.yaw, 0, 'YXZ'));
    this.flashQ.slerp(_q, 1 - Math.exp(-14 * dt));
    _v.set(0.18, -0.22, -0.1).applyQuaternion(_q).add(cam.position);
    this.flash.position.copy(_v);
    _v.set(0, 0, -10).applyQuaternion(this.flashQ).add(this.flash.position);
    this.flashTarget.position.copy(_v);
    this.flashTarget.updateMatrixWorld();
  }
}
