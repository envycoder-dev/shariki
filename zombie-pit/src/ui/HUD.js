// HUD поверх канваса: только DOM, обновляем текст/стили лишь при изменениях.
import { clamp } from '../core/noise.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.el = {
      root: $('hud'), cross: $('crosshair'), hit: $('hitmarker'), dirs: $('dmgDirs'), vig: $('vignette'), low: $('lowhp'), acid: $('acidFx'),
      wave: $('waveNum'), left: $('waveLeft'), score: $('score'), money: $('money'), feed: $('feed'),
      hpBar: $('hpBar'), hpNum: $('hpNum'), arRow: $('arRow'), arBar: $('arBar'), arNum: $('arNum'), stam: $('stamBar').firstElementChild,
      ammo: $('ammoMain'), weap: $('weapName'), gren: $('grenades'), slots: $('slots'),
      banner: $('banner'), msg: $('msg'), combo: $('combo'), hint: $('hint'), boss: $('bossBar'), breakT: $('breakTimer'), fps: $('fps'),
      radar: $('radar'),
    };
    this.rctx = this.el.radar.getContext('2d');
    this.cache = {};
    this.vig = 0; this.hitT = 0; this.acidV = 0;
    this.timers = {};
    this.radarPts = [];
  }

  show(v) { this.el.root.classList.toggle('hidden', !v); }

  set(key, el, text) { if (this.cache[key] !== text) { this.cache[key] = text; el.innerHTML = text; } }

  update(dt, s) {
    const e = this.el;
    // жизнь/броня/выносливость
    const hp = Math.max(0, s.hp), hpP = (hp / s.maxHp) * 100;
    if (this.cache.hpP !== Math.round(hpP)) {
      this.cache.hpP = Math.round(hpP);
      e.hpBar.children[1].style.width = hpP + '%';
      e.hpBar.children[0].style.width = hpP + '%';
      e.hpNum.textContent = Math.ceil(hp);
    }
    e.arRow.style.opacity = s.armor > 0 ? 1 : 0.35;
    if (this.cache.ar !== Math.round(s.armor)) { this.cache.ar = Math.round(s.armor); e.arBar.firstElementChild.style.width = s.armor + '%'; e.arNum.textContent = Math.round(s.armor); }
    if (this.cache.st !== Math.round(s.stamina)) { this.cache.st = Math.round(s.stamina); e.stam.style.width = s.stamina + '%'; e.stam.style.opacity = s.stamina > 99 ? 0.25 : 0.9; }
    // оружие
    const w = s.weapon;
    if (w) {
      const res = w.reserve === Infinity ? '∞' : w.reserve;
      this.set('ammo', e.ammo, `${w.reloading ? '<span style="opacity:.45">' + w.mag + '</span>' : w.mag}<small>/ ${res}</small>`);
      e.ammo.classList.toggle('low', w.mag <= Math.max(1, Math.floor(w.magSize * 0.25)));
      this.set('weap', e.weap, w.reloading ? 'Перезарядка…' : w.name);
      this.set('gren', e.gren, `${w.grenades}<svg viewBox="0 0 24 24"><path fill="#cfc8b8" d="M10 3h4v2h-4zM8 6h8l1 2a7 7 0 1 1-10 0z"/></svg>`);
      const sk = w.slots.map((x) => `${x.id}:${x.owned ? 1 : 0}`).join() + w.weaponId;
      if (this.cache.slots !== sk) {
        this.cache.slots = sk;
        e.slots.innerHTML = w.slots.map((x, i) => `<div class="slot ${x.owned ? 'owned' : ''} ${x.id === w.weaponId ? 'active' : ''}">${i + 1} ${x.name}</div>`).join('');
      }
    }
    this.set('score', e.score, String(s.score));
    this.set('money', e.money, '$ ' + s.money);
    // прицел: разброс → расстояние штрихов
    const spread = clamp(s.spread || 1, 0.2, 9);
    const px = 5 + spread * 4.2;
    if (this.cache.spread !== Math.round(px)) {
      this.cache.spread = Math.round(px);
      const c = e.cross.children;
      c[0].style.top = -(px + 9) + 'px'; c[1].style.top = px + 'px';
      c[2].style.left = -(px + 9) + 'px'; c[3].style.left = px + 'px';
    }
    e.cross.style.opacity = s.aiming || !s.alive ? 0 : 1;
    // вспышка урона + низкое здоровье
    this.vig = Math.max(0, this.vig - dt * 1.8);
    e.vig.style.opacity = Math.min(1, this.vig);
    e.low.style.opacity = hpP < 30 && s.alive ? (30 - hpP) / 30 : 0;
    this.acidV = Math.max(0, this.acidV - dt * 0.8);
    e.acid.style.opacity = this.acidV;
    this.hitT -= dt;
    e.hit.style.opacity = this.hitT > 0 ? Math.min(1, this.hitT * 6) : 0;
    for (const k in this.timers) {
      this.timers[k] -= dt;
      if (this.timers[k] <= 0) { delete this.timers[k]; this.fade(k); }
    }
    this.drawRadar(s);
    if (s.fps !== undefined) this.set('fps', e.fps, s.fps);
  }

  fade(k) {
    const e = this.el;
    if (k === 'banner') e.banner.style.opacity = 0;
    if (k === 'msg') e.msg.style.opacity = 0;
    if (k === 'combo') e.combo.style.opacity = 0;
  }

  drawRadar(s) {
    const ctx = this.rctx, W = 200, R = 100, scale = R / 34;
    ctx.clearRect(0, 0, W, W);
    ctx.save();
    ctx.translate(R, R);
    ctx.rotate(s.yaw);
    // кольцо ямы
    ctx.strokeStyle = 'rgba(255,90,60,.55)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(-s.px * scale, -s.pz * scale, 11 * scale, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(120,20,10,.25)'; ctx.fill();
    const pts = s.radar;
    for (let i = 0; i < pts.length; i += 3) {
      const dx = (pts[i] - s.px) * scale, dz = (pts[i + 1] - s.pz) * scale;
      if (dx * dx + dz * dz > (R - 6) * (R - 6)) continue;
      ctx.fillStyle = pts[i + 2] === 2 ? '#ffb020' : '#ff3a2e';
      ctx.beginPath(); ctx.arc(dx, dz, pts[i + 2] === 2 ? 5 : 3.2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    // игрок и сектор обзора
    ctx.fillStyle = 'rgba(255,255,255,.08)';
    ctx.beginPath(); ctx.moveTo(R, R); ctx.arc(R, R, R, -Math.PI / 2 - 0.65, -Math.PI / 2 + 0.65); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.moveTo(R, R - 7); ctx.lineTo(R - 5, R + 5); ctx.lineTo(R + 5, R + 5); ctx.fill();
  }

  hitMarker(kind) {
    this.hitT = kind === 'kill' ? 0.35 : 0.2;
    this.el.hit.classList.toggle('kill', kind === 'kill');
    this.el.hit.style.transform = `scale(${kind === 'kill' ? 1.25 : kind === 'headshot' ? 1.1 : 1})`;
  }

  damage(angle, amount) {
    this.vig = Math.min(1.2, this.vig + 0.35 + amount / 40);
    const d = document.createElement('div');
    d.className = 'dmgdir';
    d.style.transform = `rotate(${angle}rad)`;
    this.el.dirs.appendChild(d);
    setTimeout(() => { d.style.opacity = 0; }, 450);
    setTimeout(() => d.remove(), 1100);
  }

  acid() { this.acidV = Math.min(0.9, this.acidV + 0.35); }

  banner(t1, t2, time = 3.2) {
    const b = this.el.banner;
    b.children[0].textContent = t1; b.children[1].textContent = t2 || '';
    b.style.opacity = 1;
    this.timers.banner = time;
  }

  message(t, time = 1.6) { this.el.msg.textContent = t; this.el.msg.style.opacity = 1; this.timers.msg = time; }

  combo(n) { this.el.combo.textContent = `КОМБО ×${n}`; this.el.combo.style.opacity = 1; this.timers.combo = 1.6; }

  hint(html) { if (this.cache.hint !== html) { this.cache.hint = html; this.el.hint.innerHTML = html || ''; this.el.hint.style.opacity = html ? 1 : 0; } }

  feed(name, headshot, pts) {
    const d = document.createElement('div');
    d.className = 'feed-item';
    d.innerHTML = `${name.toUpperCase()}${headshot ? ' · <span class="hs">В ГОЛОВУ</span>' : ''}<span class="pts">+${pts}</span>`;
    this.el.feed.prepend(d);
    while (this.el.feed.children.length > 6) this.el.feed.lastChild.remove();
    setTimeout(() => { d.style.opacity = 0; }, 3500);
    setTimeout(() => d.remove(), 4100);
  }

  waveNum(n) { this.set('wave', this.el.wave, `ВОЛНА <b>${n}</b>`); }
  waveLeft(n) { this.set('left', this.el.left, `Зомби осталось: ${n}`); }
  breakTimer(sec, hide) {
    const e = this.el.breakT;
    if (hide || sec === null) { e.classList.add('hidden'); return; }
    e.classList.remove('hidden');
    this.set('break', e, `Следующая волна через <b>${sec}</b><br><span style="font-size:12px">B — магазин · N — начать сразу</span>`);
  }
  bossBar(v) { this.el.boss.classList.toggle('hidden', !v); }
  bossHp(k) { const w = Math.round(k * 1000) / 10; if (this.cache.boss !== w) { this.cache.boss = w; this.el.boss.querySelector('i').style.width = w + '%'; } }
  reset() {
    this.cache = {}; this.vig = 0; this.acidV = 0; this.hitT = 0;
    this.el.feed.innerHTML = ''; this.el.dirs.innerHTML = '';
    for (const k of ['banner', 'msg', 'combo']) this.fade(k);
    this.bossBar(false); this.breakTimer(null, true); this.hint('');
  }
}
