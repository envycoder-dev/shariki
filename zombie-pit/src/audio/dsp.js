// Примитивы офлайн-синтеза: чистый JS без WebAudio (работает и в Node для тестов).
// Все функции add* пишут слой в выходной буфер o начиная со времени at (секунды).
import { mulberry32 } from '../core/noise.js';

export const TAU = Math.PI * 2;

// ГПСЧ для параметров звука (детерминированный по seed)
export function makeRand(seed) {
  const f = mulberry32(seed >>> 0);
  return {
    f,
    r: (a, b) => a + (b - a) * f(),
    n: () => f() * 2 - 1,
    i: (a, b) => Math.floor(a + (b - a + 1) * f()),
    c: (p) => f() < p,
    pick: (arr) => arr[Math.floor(f() * arr.length)],
    j: (x, amt) => x * (1 + (f() * 2 - 1) * amt), // x ± amt·100%
    seed: () => ((f() * 4294967296) >>> 0) || 1,
  };
}

// Быстрый белый шум (xorshift32) в [-1, 1)
export function white(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s | 0) * 4.656612873077393e-10; };
}

export const buf = (sec, sr) => new Float32Array(Math.max(1, Math.ceil(sec * sr)));
export const onePole = (fc, sr) => 1 - Math.exp(-TAU * Math.min(fc, sr * 0.45) / sr);

// Фильтр переменных состояний (TPT, Саймер): устойчив при быстрой модуляции частоты.
// После tick(): l — ФНЧ, h — ФВЧ, b·k — полосовой с единичным усилением в центре.
export class SVF {
  constructor(sr) { this.sr = sr; this.ic1 = 0; this.ic2 = 0; this.l = 0; this.b = 0; this.h = 0; this.set(1000, 0.707); }
  set(fc, q) {
    const g = Math.tan(Math.PI * Math.min(Math.max(fc, 8), this.sr * 0.45) / this.sr);
    this.k = 1 / Math.max(q, 0.05);
    this.a1 = 1 / (1 + g * (g + this.k)); this.a2 = g * this.a1; this.a3 = g * this.a2;
    return this;
  }
  tick(v0) {
    const v3 = v0 - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1; this.ic2 = 2 * v2 - this.ic2;
    this.l = v2; this.b = v1; this.h = v0 - this.k * v1 - v2;
    return v2;
  }
  bp(x) { this.tick(x); return this.b * this.k; }
}

// Статический биквад (RBJ) по всему буферу на месте
export function biquad(o, type, f, q, sr, db = 0) {
  const w0 = TAU * Math.min(f, sr * 0.45) / sr, cs = Math.cos(w0), sn = Math.sin(w0), al = sn / (2 * q);
  const A = Math.pow(10, db / 40);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
  else if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
  else if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
  else if (type === 'peak') { b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cs; a2 = 1 - al / A; }
  else if (type === 'ls' || type === 'hs') {
    const s = 2 * Math.sqrt(A) * al, sg = type === 'ls' ? 1 : -1;
    b0 = A * ((A + 1) - sg * (A - 1) * cs + s); b1 = sg * 2 * A * ((A - 1) - sg * (A + 1) * cs); b2 = A * ((A + 1) - sg * (A - 1) * cs - s);
    a0 = (A + 1) + sg * (A - 1) * cs + s; a1 = -sg * 2 * ((A - 1) + sg * (A + 1) * cs); a2 = (A + 1) + sg * (A - 1) * cs - s;
  } else return o;
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < o.length; i++) {
    const x = o[i], y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y; o[i] = y;
  }
  return o;
}

export function lp1(o, fc, sr) { const a = onePole(fc, sr); let y = 0; for (let i = 0; i < o.length; i++) { y += a * (o[i] - y); o[i] = y; } return o; }
export function hp1(o, fc, sr) { const a = onePole(fc, sr); let y = 0; for (let i = 0; i < o.length; i++) { y += a * (o[i] - y); o[i] -= y; } return o; }

export function peakOf(a) { let m = 0; for (let i = 0; i < a.length; i++) { const v = a[i] < 0 ? -a[i] : a[i]; if (v > m) m = v; } return m; }

// Добавить слой src (нормированный по пику) с амплитудой amp
export function mixIn(o, src, at, sr, amp) {
  const p = peakOf(src);
  if (!(p > 1e-12) || !Number.isFinite(p)) return o;
  const k = amp / p, s = Math.max(0, Math.round(at * sr)), n = Math.min(src.length, o.length - s);
  for (let i = 0; i < n; i++) o[s + i] += src[i] * k;
  return o;
}

// Сумма затухающих синусоид (модальный синтез): modes = [[freq, amp, tau], ...]
export function addModes(o, at, sr, modes, amp = 1, atk = 0.00015) {
  const s = Math.max(0, Math.round(at * sr)), atkN = Math.max(1, atk * sr);
  for (let m = 0; m < modes.length; m++) {
    const f = modes[m][0], a = modes[m][1] * amp, tau = modes[m][2];
    if (!(f > 0) || f >= sr * 0.47 || !(a !== 0)) continue;
    const w = TAU * f / sr, cw = Math.cos(w), sw = Math.sin(w), d = Math.exp(-1 / (tau * sr));
    const n = Math.min(o.length - s, Math.ceil(tau * sr * 7));
    let sn = 0, cn = 1, e = a;
    for (let i = 0; i < n; i++) {
      o[s + i] += e * sn * (i < atkN ? i / atkN : 1);
      const ns = sn * cw + cn * sw; cn = cn * cw - sn * sw; sn = ns; e *= d;
    }
  }
  return o;
}

// Синус с падением тона f0 → f1 (удар, «тело» выстрела); drive добавляет гармоники
export function addThump(o, at, sr, f0, f1, ftau, tau, amp, atk = 0.001, drive = 0) {
  const s = Math.max(0, Math.round(at * sr)), n = Math.min(o.length - s, Math.ceil(tau * sr * 8));
  const dn = drive > 0 ? Math.tanh(drive) : 1;
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    ph += TAU * (f1 + (f0 - f1) * Math.exp(-t / ftau)) / sr;
    let v = Math.sin(ph);
    if (drive > 0) v = Math.tanh(v * drive) / dn;
    o[s + i] += amp * v * Math.exp(-t / tau) * (t < atk ? t / atk : 1);
  }
  return o;
}

// Шумовой всплеск через SVF. mode: 'lp'|'hp'|'bp'|'raw'. Срез скользит f0 → f1 с постоянной fT.
// Огибающая: атака atk, удержание hold, затем спад tau (+ доля mix2 со спадом tau2)
export function addNoise(o, at, sr, w, p) {
  const atk = p.atk ?? 0.001, hold = p.hold ?? 0, tau = p.tau ?? 0.05, tau2 = p.tau2 ?? 0, mix2 = p.mix2 ?? 0;
  const f0 = p.f0 ?? 1000, f1 = p.f1 ?? f0, fT = p.fT ?? 0.05, q = p.q ?? 0.707, mode = p.mode || 'lp';
  const dur = p.dur || (atk + hold + Math.max(tau, tau2) * 7);
  const s = Math.max(0, Math.round(at * sr)), n = Math.min(Math.ceil(dur * sr), o.length - s);
  if (n <= 0) return o;
  const tmp = new Float32Array(n), f = new SVF(sr).set(f0, q), sweep = f1 !== f0;
  const m = mode === 'lp' ? 0 : mode === 'hp' ? 1 : mode === 'bp' ? 2 : 3;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if (sweep && (i & 15) === 0) f.set(f1 + (f0 - f1) * Math.exp(-t / fT), q);
    const td = t - atk - hold;
    const e = t < atk ? t / atk : td <= 0 ? 1 : (1 - mix2) * Math.exp(-td / tau) + (mix2 ? mix2 * Math.exp(-td / tau2) : 0);
    const x = w();
    if (m === 3) { tmp[i] = x * e; continue; }
    f.tick(x);
    tmp[i] = e * (m === 0 ? f.l : m === 1 ? f.h : f.b * f.k);
  }
  return mixIn(o, tmp, at, sr, p.amp ?? 1);
}

// Низкий раскатистый гул: коричневый шум через ФНЧ с медленной случайной модуляцией
export function addRumble(o, at, sr, w, p) {
  const tau = p.tau ?? 0.5, atk = p.atk ?? 0.02, am = p.am ?? 0.4;
  const dur = p.dur || (atk + tau * 7);
  const s = Math.max(0, Math.round(at * sr)), n = Math.min(Math.ceil(dur * sr), o.length - s);
  if (n <= 0) return o;
  const tmp = new Float32Array(n), a = onePole(p.lp ?? 300, sr), ma = onePole(p.amRate ?? 4, sr);
  const hold = Math.max(16, Math.round(sr / ((p.amRate ?? 4) * 4)));
  let b = 0, y1 = 0, y2 = 0, m = 0, mt = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    b = (b + 0.02 * w()) / 1.02;
    y1 += a * (b - y1); y2 += a * (y1 - y2);
    if (i % hold === 0) mt = w();
    m += ma * (mt - m);
    tmp[i] = y2 * (1 - Math.exp(-t / atk)) * Math.exp(-t / tau) * Math.max(0, 1 + am * 2.5 * m);
  }
  return mixIn(o, tmp, at, sr, p.amp ?? 1);
}

// Россыпь коротких зёрен: обломки, комья, капли ('noise') или камешки/металл ('ping')
export function addGrains(o, sr, R, w, p) {
  const t0 = p.t0 ?? 0, t1 = p.t1 ?? 0.3, count = p.count ?? 10, amp = p.amp ?? 0.3, decay = p.decay ?? 1;
  const fMin = p.fMin ?? 800, fMax = p.fMax ?? 4000, tMin = p.tauMin ?? 0.002, tMax = p.tauMax ?? 0.01;
  const q = p.q ?? 2, curve = p.curve ?? 1.5, ping = p.kind === 'ping';
  for (let k = 0; k < count; k++) {
    const u = Math.pow(R.f(), curve), t = t0 + (t1 - t0) * u;
    const a = amp * Math.pow(1 - u, decay) * R.r(0.3, 1);
    const f = fMin * Math.pow(fMax / fMin, R.f()), tau = R.r(tMin, tMax);
    if (ping) { addModes(o, t, sr, [[f, 1, tau], [f * R.r(1.4, 2.8), 0.45, tau * 0.6]], a); continue; }
    const n = Math.min(Math.ceil(tau * 6 * sr), o.length - Math.round(t * sr));
    if (n <= 4) continue;
    const g = new Float32Array(n), flt = new SVF(sr).set(f, q);
    for (let i = 0; i < n; i++) g[i] = flt.bp(w()) * Math.exp(-i / (tau * sr));
    mixIn(o, g, t, sr, a);
  }
  return o;
}

// Пузырь (Миннарт): синус с растущей частотой и быстрым спадом
export function addBubble(o, at, sr, f, amp, tau = 0.01, rise = 1.5) {
  const s = Math.max(0, Math.round(at * sr)), n = Math.min(Math.ceil(tau * 6 * sr), o.length - s);
  const span = tau * 6;
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    ph += TAU * f * (1 + rise * t / span) / sr;
    o[s + i] += amp * Math.sin(ph) * Math.exp(-t / tau) * Math.min(1, t / 0.0006);
  }
  return o;
}

// Трение/скрежет: полосовой шум с рваной амплитудой («зацепы»)
export function addScrape(o, at, dur, sr, R, w, p) {
  const s = Math.max(0, Math.round(at * sr)), n = Math.min(Math.ceil(dur * sr), o.length - s);
  if (n <= 0) return o;
  const f0 = p.f ?? 2000, f1 = p.f2 ?? f0, q = p.q ?? 0.9, rate = p.rate ?? 80, rough = p.rough ?? 0.85;
  const atk = p.atk ?? 0.01, rel = p.rel ?? 0.03, spike = p.spike ?? 0.15;
  const tmp = new Float32Array(n), flt = new SVF(sr).set(f0, q), ga = onePole(rate * 1.5, sr);
  const per = Math.max(2, Math.round(sr / rate));
  let g = 0, gt = 0, cnt = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if (f1 !== f0 && (i & 31) === 0) flt.set(f0 + (f1 - f0) * (i / n), q);
    if (--cnt <= 0) { cnt = Math.round(per * R.r(0.3, 1.7)); gt = R.f() < spike ? R.r(1.2, 2.2) : R.f(); }
    g += ga * (gt - g);
    const e = Math.min(1, t / atk) * Math.min(1, Math.max(0, (dur - t) / rel));
    tmp[i] = flt.bp(w()) * (1 - rough + rough * g) * e;
  }
  return mixIn(o, tmp, at, sr, p.amp ?? 0.5);
}

// Шорох ткани: две полосы шума с хаотичными «хрустами»
export function addCloth(o, at, dur, sr, R, w, amp = 0.4) {
  const s = Math.max(0, Math.round(at * sr)), n = Math.min(Math.ceil(dur * sr), o.length - s);
  if (n <= 0) return o;
  const tmp = new Float32Array(n), fa = new SVF(sr).set(R.r(900, 1600), 0.7), fb = new SVF(sr).set(R.r(2800, 4800), 1.1);
  const ga = onePole(120, sr);
  let g = 0, gt = 0, cnt = 0;
  for (let i = 0; i < n; i++) {
    const x = i / n;
    if (--cnt <= 0) { cnt = Math.round(sr * R.r(0.003, 0.018)); gt = Math.pow(R.f(), 2.2); }
    g += ga * (gt - g);
    const v = w();
    tmp[i] = (fa.bp(v) + 0.7 * fb.bp(v)) * (0.12 + g) * Math.pow(Math.sin(Math.PI * x), 0.6);
  }
  return mixIn(o, tmp, at, sr, amp);
}

// Свист рассекаемого воздуха: полоса шума скользит f0 → fp → f1, пик громкости в peak (доля длительности)
export function addWhoosh(o, at, dur, sr, w, p) {
  const s = Math.max(0, Math.round(at * sr)), n = Math.min(Math.ceil(dur * sr), o.length - s);
  if (n <= 0) return o;
  const f0 = p.f0 ?? 300, fp = p.fp ?? 2000, f1 = p.f1 ?? 600, q = p.q ?? 1.6, pk = p.peak ?? 0.45;
  const tmp = new Float32Array(n), flt = new SVF(sr), body = new SVF(sr).set(p.body ?? 500, 0.6);
  for (let i = 0; i < n; i++) {
    const x = i / n;
    if ((i & 15) === 0) flt.set(x < pk ? f0 * Math.pow(fp / f0, x / pk) : fp * Math.pow(f1 / fp, (x - pk) / (1 - pk)), q);
    const e = x < pk ? Math.pow(x / pk, 2.2) : Math.pow(1 - (x - pk) / (1 - pk), 1.7);
    const v = w();
    tmp[i] = (flt.bp(v) + 0.25 * body.tick(v)) * e;
  }
  return mixIn(o, tmp, at, sr, p.amp ?? 0.5);
}

// Задержанная приглушённая копия уже записанного (отражение от земли)
export function addReflection(o, sr, delay, gain, lp, upTo = 0.2) {
  const d = Math.round(delay * sr), n = Math.min(o.length - d, Math.round(upTo * sr));
  if (n <= 0) return o;
  const src = o.slice(0, n);
  lp1(src, lp, sr);
  for (let i = 0; i < n; i++) o[d + i] += src[i] * gain;
  return o;
}

// Пила с polyBLEP (меньше алиасинга)
export function sawBlep(ph, dt) {
  let v = 2 * ph - 1;
  if (ph < dt) { const t = ph / dt; v -= t + t - t * t - 1; }
  else if (ph > 1 - dt) { const t = (ph - 1) / dt; v -= t * t + t + t + 1; }
  return v;
}

// Финальная обработка: сатурация, удаление DC, обрезка хвостовой тишины, плавный конец, нормировка пика
export function finish(o, sr, opt = {}) {
  const peak = opt.peak ?? 0.9, drive = opt.drive ?? 0, dc = opt.dc ?? 15, fade = opt.fade ?? 0.006;
  for (let i = 0; i < o.length; i++) if (!Number.isFinite(o[i])) o[i] = 0;
  let p = peakOf(o);
  if (!(p > 1e-9)) return new Float32Array(Math.max(1, Math.round(sr * 0.01)));
  if (drive > 0) { const k = drive / p, d = Math.tanh(drive); for (let i = 0; i < o.length; i++) o[i] = Math.tanh(o[i] * k) / d; }
  if (dc) hp1(o, dc, sr);
  let end = o.length;
  if (opt.trim !== false) {
    const thr = peakOf(o) * 2.5e-4;
    while (end > 1 && Math.abs(o[end - 1]) < thr) end--;
    end = Math.min(o.length, end + Math.round(0.005 * sr));
  }
  const out = end < o.length ? o.slice(0, end) : o;
  const fn = Math.min(out.length >> 1, Math.round(fade * sr));
  for (let i = 0; i < fn; i++) out[out.length - 1 - i] *= i / fn;
  p = peakOf(out);
  const k = p > 0 ? peak / p : 0;
  for (let i = 0; i < out.length; i++) out[i] *= k;
  return out;
}

// То же для нескольких каналов (общий пик, без обрезки — для петель)
export function finishMulti(chs, sr, opt = {}) {
  const peak = opt.peak ?? 0.9;
  let p = 0;
  for (const c of chs) { for (let i = 0; i < c.length; i++) if (!Number.isFinite(c[i])) c[i] = 0; if (opt.dc !== 0) hp1(c, opt.dc ?? 15, sr); p = Math.max(p, peakOf(c)); }
  const k = p > 0 ? peak / p : 0;
  for (const c of chs) for (let i = 0; i < c.length; i++) c[i] *= k;
  return chs;
}

// Кусочно-линейная кривая по точкам [[x, y], ...]
export function curveAt(pts, x) {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const a = pts[i - 1], b = pts[i], d = b[0] - a[0];
      return d > 0 ? a[1] + (b[1] - a[1]) * (x - a[0]) / d : b[1];
    }
  }
  return pts[pts.length - 1][1];
}
