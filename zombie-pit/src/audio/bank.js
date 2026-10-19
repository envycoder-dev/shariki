// Банк предрасчитанных звуков: приоритет 0 рендерится синхронно в init(), остальное — в простое браузера.
// Если звук нужен раньше, чем отрендерен, первая вариация считается на лету (lazy).
import { CATALOG } from './catalog.js';
import { makeRand } from './dsp.js';
import { hashSeed } from '../core/noise.js';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class SoundBank {
  constructor(ctx) {
    this.ctx = ctx;
    this.sets = new Map();        // имя → { list: (AudioBuffer|null)[], n, last }
    this.queue = [];              // задания [имя, вариация]
    this.ms = { sync: 0, bg: 0, lazy: 0 };
    this.rendered = 0;
    this.lastLazy = 0;            // время последнего рендера «на лету» (мс)
    this.total = 0;
    this._timer = null;
    this._stopped = false;
    this._resolve = null;
    this.done = new Promise((r) => { this._resolve = r; });
    const names = Object.keys(CATALOG);
    for (const n of names) { const e = CATALOG[n]; this.sets.set(n, { list: new Array(e.vars).fill(null), n: 0, last: -1 }); this.total += e.vars; }
    // очередь: по приоритету, внутри — сначала первые вариации всех звуков
    for (const pri of [0, 1, 2]) {
      const group = names.filter((n) => CATALOG[n].pri === pri);
      const maxV = Math.max(0, ...group.map((n) => CATALOG[n].vars));
      for (let vi = 0; vi < maxV; vi++) for (const n of group) if (vi < CATALOG[n].vars) this.queue.push([n, vi]);
    }
  }

  get pending() { return this.queue.length; }
  has(name) { const s = this.sets.get(name); return !!s && s.n > 0; }

  render(name, vi) {
    const e = CATALOG[name], set = this.sets.get(name);
    if (!e || !set || vi < 0 || vi >= e.vars || set.list[vi]) return;
    const sr = e.half ? Math.round(this.ctx.sampleRate / 2) : this.ctx.sampleRate;
    const data = e.make(sr, makeRand(hashSeed(name + '#' + vi)), vi, e.vars);
    const chs = Array.isArray(data) ? data : [data];
    const ab = this.ctx.createBuffer(chs.length, chs[0].length, sr);
    for (let c = 0; c < chs.length; c++) ab.getChannelData(c).set(chs[c]);
    set.list[vi] = ab; set.n++; this.rendered++;
  }

  _take(name, vi) {
    const q = this.queue;
    for (let i = 0; i < q.length; i++) if (q[i][0] === name && (vi < 0 || q[i][1] === vi)) { const job = q[i]; q.splice(i, 1); return job; }
    return null;
  }

  // Синхронно отрендерить задания с приоритетом ≤ pri, но не дольше budgetMs (остальное — в фоне/на лету)
  renderSync(pri, budgetMs = Infinity) {
    const t0 = now();
    while (this.queue.length && CATALOG[this.queue[0][0]].pri <= pri && now() - t0 < budgetMs) {
      const [n, vi] = this.queue.shift();
      this.render(n, vi);
    }
    this.ms.sync += now() - t0;
    this._checkDone();
  }

  // Фоновый рендер небольшими порциями
  startBackground() {
    if (this._timer || this._stopped) return;
    const ric = typeof requestIdleCallback === 'function' ? requestIdleCallback : null;
    const step = (deadline) => {
      this._timer = null;
      if (this._stopped) return;
      const t0 = now(), budget = deadline && !deadline.didTimeout ? Math.max(4, Math.min(12, deadline.timeRemaining())) : 8;
      while (this.queue.length && now() - t0 < budget) {
        const [n, vi] = this.queue.shift();
        try { this.render(n, vi); } catch (err) { console.warn('[audio] render failed', n, err); }
      }
      this.ms.bg += now() - t0;
      if (this._checkDone()) return;
      this._timer = ric ? ric(step, { timeout: 250 }) : setTimeout(step, 16);
    };
    this._timer = ric ? ric(step, { timeout: 250 }) : setTimeout(step, 16);
  }

  stop() { this._stopped = true; }

  _checkDone() {
    if (this.queue.length) return false;
    if (this._resolve) { this._resolve(); this._resolve = null; }
    return true;
  }

  // Буфер: конкретная вариация (vi ≥ 0) или случайная без повтора подряд; lazy — досчитать на лету
  pick(name, vi = -1, lazy = true) {
    const set = this.sets.get(name);
    if (!set) return null;
    if (vi >= 0 && vi < set.list.length) {
      if (!set.list[vi] && lazy && this._take(name, vi)) this._lazy(name, vi);
      if (set.list[vi]) return set.list[vi];
    }
    if (set.n === 0) {
      if (!lazy) return null;
      const job = this._take(name, -1);
      if (!job) return null;
      this._lazy(job[0], job[1]);
      if (set.n === 0) return null;
    }
    const L = set.list, len = L.length;
    let k = Math.floor(Math.random() * set.n);
    for (let i = 0; i < len; i++) {
      if (!L[i]) continue;
      if (k-- === 0) {
        if (i === set.last && set.n > 1) { for (let j = 1; j < len; j++) { const m = (i + j) % len; if (L[m]) { i = m; break; } } }
        set.last = i;
        return L[i];
      }
    }
    return null;
  }

  _lazy(name, vi) {
    const t0 = now();
    try { this.render(name, vi); } catch (err) { console.warn('[audio] render failed', name, err); }
    this.ms.lazy += now() - t0;
    this.lastLazy = now();
    this._checkDone();
  }

  // Все отрендеренные буферы (для отладки/спектрограмм)
  list() {
    const out = [];
    for (const [name, set] of this.sets) set.list.forEach((b, vi) => { if (b) out.push({ name, vi, buffer: b }); });
    return out;
  }
}
