// Игровой цикл волн: состав волн, спавн, очки/деньги/комбо, дроп, магазин, лужи кислоты, рекорды.
import * as THREE from 'three';
import { TYPES } from '../zombies/types.js';
import { RNG, clamp } from './noise.js';
import { DIFF, settings, loadBest, saveBest } from './settings.js';

export const SHOP = [
  { id: 'shotgun', name: 'Дробовик', desc: 'Помповый, 9 дробин. Вблизи разрывает на куски.', price: 900 },
  { id: 'rifle', name: 'Автомат', desc: 'Автоматический огонь, магазин на 30. Против толпы.', price: 1800 },
  { id: 'ammo', name: 'Патроны', desc: 'Полный боезапас для всего оружия.', price: 300 },
  { id: 'grenade', name: 'Граната', desc: 'Радиус 6.5 м. Можно носить до четырёх.', price: 200 },
  { id: 'medkit', name: 'Аптечка', desc: 'Полностью восстанавливает здоровье.', price: 350 },
  { id: 'armor', name: 'Бронежилет', desc: 'Поглощает 60% урона, запас 100.', price: 550 },
];

const pickMat = (c, e) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: 0.2, emissive: e || 0x000000, emissiveIntensity: e ? 2.4 : 0 });

function makePickupMeshes() {
  const ammo = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.22, 0.26), pickMat(0x3b4a2a));
  const strip = new THREE.Mesh(new THREE.BoxGeometry(0.43, 0.04, 0.27), pickMat(0x222222, 0xffc94d));
  strip.position.y = 0.04;
  ammo.add(box, strip);
  const med = new THREE.Group();
  const mb = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.24, 0.24), pickMat(0xd8d4cc));
  const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.245), pickMat(0x550000, 0xff2a20));
  const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.245), pickMat(0x550000, 0xff2a20));
  med.add(mb, c1, c2);
  const gren = new THREE.Group();
  const gb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), pickMat(0x39432a));
  gb.scale.set(1, 1.2, 1);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.012, 6, 16), pickMat(0x222222, 0x9dff4f));
  ring.rotation.x = Math.PI / 2;
  gren.add(gb, ring);
  for (const g of [ammo, med, gren]) g.traverse((o) => { o.castShadow = true; });
  return { ammo, health: med, grenade: gren };
}

export class Game {
  constructor(ctx) {
    this.ctx = ctx;
    this.rng = new RNG((Date.now() & 0xffffff) + 7);
    this.pickups = [];
    this.puddles = [];
    this.meshes = makePickupMeshes();
    this.best = loadBest();
    this.reset();
  }

  reset() {
    for (const p of this.pickups) p.mesh.parent?.remove(p.mesh);
    this.pickups.length = 0;
    this.puddles.length = 0;
    this.wave = 0;
    this.score = 0; this.money = 0;
    this.kills = 0; this.headshots = 0;
    this.stats = { shots: 0, hits: 0, headshotHits: 0 };
    this.time = 0;
    this.phase = 'break';
    this.breakT = 6;
    this.queue = []; this.spawnT = 0; this.maxAlive = 8; this.interval = 2;
    this.combo = 0; this.comboT = 0;
    this.boss = null;
    this.acidT = 0;
    this.over = false;
  }

  get diff() { return DIFF[settings.diff] || DIFF.normal; }

  compose(n) {
    const total = Math.round(7 + n * 3 + Math.pow(n, 1.4));
    const W = { walker: 1 };
    if (n >= 2) W.runner = 0.12 + 0.025 * n;
    if (n >= 3) W.crawler = 0.14;
    if (n >= 4) W.bloater = 0.07 + 0.005 * n;
    if (n >= 6) W.spitter = 0.08 + 0.006 * n;
    if (n >= 7) W.brute = 0.025 + 0.004 * n;
    const keys = Object.keys(W), sum = keys.reduce((a, k) => a + W[k], 0);
    const list = [];
    for (let i = 0; i < total; i++) {
      let r = this.rng.next() * sum;
      for (const k of keys) { r -= W[k]; if (r <= 0) { list.push(k); break; } }
    }
    const intro = { 2: 'runner', 3: 'crawler', 4: 'bloater', 6: 'spitter', 7: 'brute' }[n];
    if (intro) for (let i = 0; i < 2; i++) list[2 + i * 3] = intro;
    if (n === 3) list.push('brute');
    for (let i = list.length - 1; i > 4; i--) { const j = 4 + Math.floor(this.rng.next() * (i - 3)); [list[i], list[j]] = [list[j], list[i]]; }
    if (n % 5 === 0) list.splice(Math.floor(list.length * 0.35), 0, 'boss');
    return { list, maxAlive: Math.min(6 + n * 2, 30), interval: Math.max(0.35, 2.0 - n * 0.12) };
  }

  startWave() {
    const c = this.ctx;
    this.wave++;
    const n = this.wave;
    const comp = this.compose(n);
    this.queue = comp.list; this.maxAlive = comp.maxAlive; this.interval = comp.interval;
    this.spawnT = 0.5;
    this.phase = 'wave';
    c.zombies.hpMul = (1 + 0.07 * (n - 1)) * this.diff.hp;
    c.zombies.speedMul = 1 + Math.min(0.2, 0.02 * (n - 1));
    c.hud.banner(`ВОЛНА ${n}`, n % 5 === 0 ? 'Из ямы поднимается Мясник' : n === 1 ? 'Они лезут. Держите оборону' : this.introText(n));
    if (n % 5 === 0) c.audio?.bossIntro?.(); else c.audio?.waveStart?.(n);
    c.audio?.setIntensity?.(Math.min(1, 0.45 + n * 0.05));
    c.closeShop?.();
  }

  introText(n) {
    return { 2: 'Осторожно: бегуны', 3: 'Ползуны и первый громила', 4: 'Толстяки взрываются кислотой', 6: 'Плевуны бьют издалека', 7: 'Громилы идут стаей' }[n] || 'Их становится больше';
  }

  update(dt) {
    const c = this.ctx;
    this.time += dt;
    this.comboT -= dt;
    if (this.comboT <= 0) this.combo = 0;
    if (this.phase === 'break') {
      if (!c.shopOpen) this.breakT -= dt;
      c.hud.breakTimer(this.wave === 0 ? null : Math.ceil(this.breakT));
      if (this.breakT <= 0) { c.hud.breakTimer(null, true); this.startWave(); }
    } else if (this.phase === 'wave') {
      this.spawnT -= dt;
      const alive = c.zombies.aliveCount;
      if (this.queue.length && this.spawnT <= 0 && alive < this.maxAlive) {
        const type = this.queue.shift();
        const z = c.zombies.spawn(type);
        if (type === 'boss') { this.boss = z; c.hud.bossBar(true); }
        this.spawnT = this.interval * this.rng.range(0.6, 1.4) * (type === 'boss' ? 3 : 1);
      }
      if (!this.queue.length && alive === 0) this.clearWave();
      c.hud.waveLeft(this.queue.length + alive);
    }
    if (this.boss) {
      if (!this.boss.alive) { this.boss = null; c.hud.bossBar(false); }
      else c.hud.bossHp(this.boss.hp / this.boss.maxHp);
    }
    this.updatePickups(dt);
    this.updatePuddles(dt);
  }

  clearWave() {
    const c = this.ctx;
    const bonus = 100 + 60 * this.wave;
    this.money += bonus; this.score += bonus;
    this.phase = 'break';
    this.breakT = 25;
    c.hud.banner('ВОЛНА ЗАЧИЩЕНА', `+${bonus} $   ·   B — магазин   ·   N — следующая волна`);
    c.audio?.waveClear?.();
    c.audio?.setIntensity?.(0.15);
  }

  skipBreak() { if (this.phase === 'break' && this.wave > 0) this.breakT = 0; }

  onKill(z, info) {
    const c = this.ctx;
    this.kills++;
    if (info.headshot) this.headshots++;
    this.combo = this.comboT > 0 ? Math.min(6, this.combo + 1) : 1;
    this.comboT = 2.4;
    const mult = 1 + (this.combo - 1) * 0.25;
    const pts = Math.round(z.T.score * (info.headshot ? 1.5 : 1) * mult);
    this.score += pts;
    this.money += Math.round(pts * 0.8);
    c.hud.feed(z.T.name, info.headshot, pts);
    if (this.combo >= 2) c.hud.combo(this.combo);
    this.maybeDrop(z);
  }

  maybeDrop(z) {
    const r = this.rng, p = z.group.position;
    const big = z.type === 'brute' || z.type === 'boss';
    const lowHp = this.ctx.player.hp < 50;
    const drops = [];
    if (big || r.chance(0.1)) drops.push('ammo');
    if (big || r.chance(lowHp ? 0.1 : 0.04)) drops.push('health');
    if (z.type === 'boss' || r.chance(0.025)) drops.push('grenade');
    drops.forEach((kind, i) => this.spawnPickup(kind, p.x + (i - (drops.length - 1) / 2) * 0.6, p.z));
  }

  spawnPickup(kind, x, z) {
    const w = this.ctx.world;
    // не роняем в яму
    const r = Math.hypot(x, z), R = w.pit.radiusAt(Math.atan2(z, x)) + 1.2;
    if (r < R) { x *= R / r; z *= R / r; }
    const mesh = this.meshes[kind].clone();
    mesh.position.set(x, w.heightAt(x, z) + 0.35, z);
    this.ctx.scene.add(mesh);
    this.pickups.push({ kind, mesh, t: 0, y: mesh.position.y });
  }

  updatePickups(dt) {
    const c = this.ctx, pp = c.player.pos;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.t += dt;
      p.mesh.rotation.y += dt * 1.6;
      p.mesh.position.y = p.y + Math.sin(p.t * 2.5) * 0.06;
      const d = Math.hypot(pp.x - p.mesh.position.x, pp.z - p.mesh.position.z);
      let take = false;
      if (c.player.alive && d < 1.4) {
        if (p.kind === 'ammo') { c.weapons.refillAmmo?.(0.35); c.hud.message('+ Патроны'); take = true; }
        else if (p.kind === 'health' && c.player.hp < c.player.maxHp) { c.player.hp = Math.min(c.player.maxHp, c.player.hp + 40); c.hud.message('+ 40 здоровья'); take = true; }
        else if (p.kind === 'grenade' && (c.weapons.hud?.().grenades ?? 4) < 4) { c.weapons.addGrenades?.(1); c.hud.message('+ Граната'); take = true; }
      }
      if (take) c.audio?.pickup?.(p.kind);
      if (take || p.t > 35) { p.mesh.parent?.remove(p.mesh); this.pickups.splice(i, 1); }
    }
  }

  addPuddle(h) { this.puddles.push(h); }

  updatePuddles(dt) {
    const c = this.ctx, pp = c.player.pos;
    this.acidT -= dt;
    for (let i = this.puddles.length - 1; i >= 0; i--) {
      const h = this.puddles[i];
      if (h.alive === false) { this.puddles.splice(i, 1); continue; }
      const d = Math.hypot(pp.x - h.position.x, pp.z - h.position.z);
      if (d < h.radius && c.player.grounded && this.acidT <= 0) {
        this.acidT = 0.35;
        c.hurtPlayer(3.5, h.position, 'acid');
        c.hud.acid();
      }
    }
  }

  buy(id) {
    const c = this.ctx, item = SHOP.find((s) => s.id === id);
    if (!item || !this.canBuy(item)) { c.audio?.denied?.(); return false; }
    this.money -= item.price;
    const w = c.weapons;
    if (id === 'shotgun' || id === 'rifle') { w.give(id); w.setActive?.(id); }
    else if (id === 'ammo') w.refillAmmo();
    else if (id === 'grenade') w.addGrenades(1);
    else if (id === 'medkit') c.player.hp = c.player.maxHp;
    else if (id === 'armor') c.player.armor = 100;
    c.audio?.buy?.();
    return true;
  }

  canBuy(item) {
    const c = this.ctx;
    if (this.money < item.price) return false;
    if ((item.id === 'shotgun' || item.id === 'rifle') && c.weapons.owns(item.id)) return false;
    if (item.id === 'grenade' && (c.weapons.hud().grenades >= 4)) return false;
    if (item.id === 'medkit' && c.player.hp >= c.player.maxHp) return false;
    if (item.id === 'armor' && c.player.armor >= 100) return false;
    return true;
  }

  finish() {
    if (this.over) return this.best;
    this.over = true;
    const b = this.best;
    const rec = this.score > b.score;
    if (rec) { b.score = this.score; }
    b.wave = Math.max(b.wave, this.wave);
    b.kills = Math.max(b.kills, this.kills);
    saveBest(b);
    return { ...b, record: rec };
  }

  summary() {
    const st = this.stats;
    return {
      wave: this.wave, kills: this.kills, headshots: this.headshots,
      accuracy: st.shots > 0 ? Math.round((st.hits / st.shots) * 100) : 0,
      score: this.score, time: this.time,
    };
  }
}
