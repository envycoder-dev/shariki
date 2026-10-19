// Синтез голоса: импульсы голосовой щели (Розенберг) с джиттером и вибрато → 4 параллельные
// скользящие форманты + шум дыхания, хрип, рык (АМ на субгармонике), бульканье, сатурация.
// Используется для зомби, игрока, ворон и далёкого воя.
import { TAU, SVF, white, buf, onePole, curveAt, addBubble, addNoise, addThump, mixIn, finish, lp1, peakOf } from './dsp.js';

// Форманты гласных взрослого мужчины: [частота, ширина полосы]
export const VOWELS = {
  u: [[300, 70], [870, 90], [2240, 130], [3300, 200]],
  o: [[480, 80], [840, 100], [2450, 150], [3350, 220]],
  a: [[730, 110], [1090, 120], [2440, 160], [3400, 250]],
  uh: [[640, 100], [1190, 110], [2390, 160], [3400, 240]],
  ae: [[680, 110], [1700, 130], [2410, 170], [3500, 250]],
  e: [[530, 90], [1840, 120], [2480, 160], [3500, 250]],
  i: [[300, 70], [2290, 110], [3010, 170], [3700, 250]],
  er: [[490, 90], [1350, 110], [1690, 150], [3300, 220]],
};

function vowelAt(path, x, out) {
  let i = 1;
  while (i < path.length && x > path[i][0]) i++;
  const a = path[Math.min(i - 1, path.length - 1)], b = path[Math.min(i, path.length - 1)];
  const A = VOWELS[a[1]] || VOWELS.a, B = VOWELS[b[1]] || VOWELS.a;
  let u = b[0] > a[0] ? (x - a[0]) / (b[0] - a[0]) : 1;
  u = u < 0 ? 0 : u > 1 ? 1 : u; u = u * u * (3 - 2 * u);
  for (let k = 0; k < 4; k++) { out[k] = A[k][0] + (B[k][0] - A[k][0]) * u; out[4 + k] = A[k][1] + (B[k][1] - A[k][1]) * u; }
}

// P: dur, f0, pitch [[x,mult]], vowels [[x,'a']], env [[x,amp]], fs (масштаб формант), bw, jitter, shimmer,
//    vib [Гц, глубина], sub (удвоение периода), fry (скрип), rasp, breath, growl (+growlF), chest, wet, drive, lp, voiced
export function voice(sr, R, P) {
  const N = Math.max(16, Math.ceil(P.dur * sr)), o = new Float32Array(N);
  const w = white(R.seed()), w2 = white(R.seed());
  const F = [new SVF(sr), new SVF(sr), new SVF(sr), new SVF(sr)];
  const fg = P.fgain || [1, 0.6, 0.32, 0.16];
  const fs = P.fs ?? 1, bwm = P.bw ?? 1, voiced = P.voiced ?? 1;
  const jitter = P.jitter ?? 0.03, shimmer = P.shimmer ?? 0.15, sub = P.sub ?? 0, fry = P.fry ?? 0;
  const rasp = P.rasp ?? 0.2, breath = P.breath ?? 0.15, growl = P.growl ?? 0, growlF = P.growlF ?? 0.5;
  const chest = P.chest ?? 0, wet = P.wet ?? 0, wetC = P.wetC, fryC = P.fryC;
  const vibR = P.vib ? P.vib[0] : 5, vibD = P.vib ? P.vib[1] : 0.01, wanD = P.wander ?? 0.03;
  const oq = P.oq ?? 0.6, tp = oq * 0.66, tn = oq - tp;
  const pitch = P.pitch || [[0, 1], [1, 1]], env = P.env || [[0, 0], [0.1, 1], [0.8, 0.8], [1, 0]];
  const vowels = P.vowels || [[0, 'a'], [1, 'a']];
  const fm = new Float64Array(8);
  const raspA = onePole(1800, sr), wanA = onePole(2.5, sr) * 32, flA = onePole(P.flutterRate ?? 12, sr) * 32;
  const BL = 32, vibStep = TAU * vibR * BL / sr;
  const [F0, F1, F2, F3] = F, [g0, g1, g2, g3] = fg;
  let ph = 0, gPrev = 0, jit = 1, amp = 1, per = 0, wan = 0, wanT = 0, gph = 0, vph = R.f() * TAU, rn = 0, fl = 0, flT = 0;
  let fBase = 0, wt = 0, fr = 0, e0 = 0, de = 0;
  for (let i = 0; i < N; i++) {
    // управляющие сигналы считаются блоками по 32 отсчёта, огибающая — с линейной интерполяцией
    if (i % BL === 0) {
      const x = i / N, x1 = Math.min(1, (i + BL) / N);
      vowelAt(vowels, x, fm);
      for (let k = 0; k < 4; k++) { const fc = fm[k] * fs; F[k].set(fc, fc / (fm[4 + k] * bwm)); }
      if ((i & 511) === 0) { wanT = w2(); flT = (w2() + 1) * 0.5; }
      wan += wanA * (wanT - wan); fl += flA * (flT - fl);
      vph += vibStep;
      fBase = P.f0 * curveAt(pitch, x) * (1 + vibD * Math.sin(vph) + wanD * wan);
      wt = wet * (wetC ? curveAt(wetC, x) : 1);
      fr = fry * (fryC ? curveAt(fryC, x) : 1);
      e0 = curveAt(env, x); de = (curveAt(env, x1) - e0) / BL;
    }
    const f0 = Math.max(18, fBase * jit);
    ph += f0 / sr;
    if (ph >= 1) {
      ph -= 1; per++;
      jit = 1 + jitter * w2();
      amp = 1 - shimmer * Math.abs(w2());
      // удвоение периода → субгармоника (рык)
      if (sub > 0 && (per & 1)) { amp *= 1 - 0.55 * sub; jit *= 1 + 0.1 * sub; }
      // «вокальный скрип»: редкие длинные неровные периоды
      if (fr > 0 && (w2() + 1) * 0.5 < fr) { jit *= 0.4 + 0.18 * (w2() + 1); amp *= 0.5 + 0.35 * (w2() + 1); }
    }
    const g = ph < tp ? 0.5 * (1 - Math.cos(Math.PI * ph / tp)) : ph < oq ? Math.cos(0.5 * Math.PI * (ph - tp) / tn) : 0;
    let src = (g - gPrev) * sr / (Math.PI * f0) * amp * voiced;
    gPrev = g;
    rn += raspA * (w() - rn);
    src = src * (1 + rasp * rn * 3) + w() * breath * (0.3 + 0.7 * g);
    F0.tick(src); F1.tick(src); F2.tick(src); F3.tick(src);
    let y = g0 * F0.b * F0.k + g1 * F1.b * F1.k + g2 * F2.b * F2.k + g3 * F3.b * F3.k;
    if (chest) y += chest * amp * voiced * Math.sin(TAU * ph - 1.2);
    if (growl) { gph += TAU * f0 * growlF / sr; y *= 1 - growl * 0.5 * (1 - Math.sin(gph)); }
    if (wt > 0) y *= 1 - Math.min(0.92, wt * 0.7 * fl);
    o[i] = y * e0;
    e0 += de;
  }
  // нормировка → пузыри → сатурация → ФНЧ
  const p = peakOf(o);
  if (p > 0) for (let i = 0; i < N; i++) o[i] /= p;
  if (wet > 0) {
    const nb = Math.round(wet * P.dur * (P.bubbles ?? 22));
    for (let k = 0; k < nb; k++) {
      const t = R.r(0, P.dur * 0.97), e = Math.sqrt(Math.max(0.05, curveAt(env, t / P.dur)));
      addBubble(o, t, sr, R.r(220, 1200) * (P.bubbleF ?? 1), R.r(0.06, 0.28) * wet * e, R.r(0.004, 0.018), R.r(0.8, 3));
    }
  }
  const d = P.drive ?? 0;
  if (d > 0) { const td = Math.tanh(d); for (let i = 0; i < N; i++) o[i] = Math.tanh(o[i] * d) / td; }
  if (P.lp) { lp1(o, P.lp, sr); lp1(o, P.lp * 1.4, sr); }
  return finish(o, sr, { peak: P.peak ?? 0.9, dc: 30 });
}

// Типы зомби: базовый тон, масштаб формант (размер глотки), хрип, рык, мокрота
export const ZTYPES = {
  walker: { f0: 92, fs: 0.86, bw: 1.25, jitter: 0.045, shimmer: 0.28, rasp: 0.45, breath: 0.22, growl: 0.35, sub: 0.22, wet: 0.12, fry: 0.06, drive: 2.4, lp: 5200, chest: 0.2 },
  runner: { f0: 150, fs: 1.04, bw: 1.35, jitter: 0.06, shimmer: 0.3, rasp: 0.8, breath: 0.42, growl: 0.25, sub: 0.12, wet: 0.05, fry: 0.03, drive: 3.2, lp: 8500, chest: 0.05 },
  crawler: { f0: 80, fs: 0.92, bw: 1.45, jitter: 0.07, shimmer: 0.35, rasp: 0.6, breath: 0.3, growl: 0.45, sub: 0.32, wet: 0.6, fry: 0.3, drive: 2.6, lp: 4200, chest: 0.12 },
  brute: { f0: 56, fs: 0.72, bw: 1.3, jitter: 0.035, shimmer: 0.22, rasp: 0.45, breath: 0.24, growl: 0.75, sub: 0.55, wet: 0.1, fry: 0.08, drive: 3.6, lp: 3800, chest: 0.45 },
  spitter: { f0: 112, fs: 0.95, bw: 1.35, jitter: 0.05, shimmer: 0.3, rasp: 0.4, breath: 0.28, growl: 0.3, sub: 0.15, wet: 0.85, fry: 0.12, drive: 2.3, lp: 5000, chest: 0.1, bubbles: 30 },
  bloater: { f0: 70, fs: 0.8, bw: 1.55, jitter: 0.05, shimmer: 0.3, rasp: 0.35, breath: 0.3, growl: 0.45, sub: 0.3, wet: 0.95, fry: 0.15, drive: 2.4, lp: 3400, chest: 0.32, bubbles: 26, bubbleF: 0.6 },
  boss: { f0: 42, fs: 0.62, bw: 1.35, jitter: 0.04, shimmer: 0.2, rasp: 0.55, breath: 0.3, growl: 0.9, sub: 0.75, wet: 0.15, fry: 0.1, drive: 4.5, lp: 3200, chest: 0.55 },
};

// Голос зомби: action = 'groan'|'attack'|'scream'|'pain'|'death'
export function zombieVox(sr, R, type, action) {
  const T = ZTYPES[type] || ZTYPES.walker, big = type === 'brute' || type === 'boss';
  const P = { ...T, f0: R.j(T.f0, 0.08), vib: [R.r(3.5, 6.5), R.r(0.008, 0.025)] };
  if (action === 'attack') {
    P.dur = R.r(0.45, 0.75); P.f0 *= big ? 1.35 : 1.5;
    P.pitch = [[0, 0.85], [0.18, 1.15], [0.55, 1.05], [1, 0.8]];
    P.vowels = [[0, 'a'], [0.4, R.pick(['ae', 'a'])], [1, 'uh']];
    P.env = [[0, 0], [0.05, 1], [0.5, 0.85], [1, 0]];
    P.rasp += 0.3; P.breath += 0.15; P.growl = Math.min(1, P.growl + 0.2); P.drive *= 1.3;
    P.vib = [R.r(6, 9), 0.03];
  } else if (action === 'scream') {
    if (type === 'runner') {
      P.dur = R.r(0.9, 1.4); P.f0 *= R.r(3.0, 3.8); P.fs *= 1.12;
      P.pitch = [[0, 0.7], [0.12, 1.08], [0.55, 1.0], [1, 0.72]];
      P.vowels = [[0, 'ae'], [0.3, 'i'], [1, 'e']];
      P.rasp = 1.0; P.breath = 0.65; P.drive = 4.0; P.growl = 0.2; P.vib = [R.r(7, 10), 0.035]; P.lp = 9500;
    } else if (big) {
      P.dur = R.r(1.3, 2.0); P.f0 *= R.r(1.45, 1.7);
      P.pitch = [[0, 0.8], [0.15, 1.08], [0.7, 1.0], [1, 0.7]];
      P.vowels = [[0, 'o'], [0.25, 'a'], [1, 'uh']];
      P.growl = 0.95; P.sub = Math.min(0.9, P.sub + 0.2); P.drive *= 1.35; P.rasp += 0.25; P.vib = [R.r(4, 6), 0.02];
    } else {
      P.dur = R.r(0.9, 1.4); P.f0 *= R.r(2.0, 2.5);
      P.pitch = [[0, 0.75], [0.15, 1.08], [0.6, 1.0], [1, 0.75]];
      P.vowels = [[0, 'a'], [0.4, 'ae'], [1, 'a']];
      P.rasp += 0.35; P.breath += 0.2; P.drive *= 1.4; P.vib = [R.r(6, 8), 0.03];
    }
    P.env = [[0, 0], [0.06, 1], [0.7, 0.9], [1, 0]];
  } else if (action === 'pain') {
    P.dur = R.r(0.25, 0.45); P.f0 *= R.r(1.25, 1.5);
    P.pitch = [[0, 1.12], [0.25, 1.0], [1, 0.72]];
    P.vowels = [[0, R.pick(['uh', 'a'])], [1, 'u']];
    P.env = [[0, 0], [0.06, 1], [0.4, 0.8], [1, 0]];
    P.rasp += 0.15;
  } else if (action === 'death') {
    P.dur = R.r(1.5, 2.3) * (big ? 1.2 : 1); P.f0 *= 1.15;
    P.pitch = [[0, 1.2], [0.15, 1.05], [0.6, 0.7], [1, 0.42]];
    P.vowels = [[0, 'a'], [0.45, 'o'], [1, 'u']];
    P.env = [[0, 0], [0.04, 1], [0.35, 0.85], [0.75, 0.5], [1, 0]];
    P.wet = Math.min(1, P.wet + 0.35); P.wetC = [[0, 0.3], [0.5, 0.8], [1, 1.3]];
    P.fry = Math.max(P.fry, 0.25); P.fryC = [[0, 0.2], [0.5, 0.6], [1, 2.5]];
    P.bubbles = (P.bubbles || 22) + 10;
  } else { // groan: «ооо» → «ааа», 1–2.5 с
    P.dur = R.r(1.1, 2.3) * (big ? 1.12 : 1);
    const pk = R.r(0.2, 0.45);
    P.pitch = [[0, R.r(0.85, 0.95)], [pk, R.r(1.0, 1.12)], [R.r(0.6, 0.75), R.r(0.92, 1.02)], [1, R.r(0.72, 0.85)]];
    P.vowels = [[0, R.pick(['u', 'o'])], [R.r(0.35, 0.55), R.pick(['a', 'uh', 'a'])], [1, R.pick(['uh', 'o', 'er'])]];
    P.env = [[0, 0], [R.r(0.08, 0.18), 0.9], [pk + 0.05, 1], [0.72, R.r(0.7, 0.9)], [1, 0]];
  }
  return voice(sr, R, P);
}

// Плевок кислотой: горловое «кхх» → губное «п» → короткое «ту» + брызги
export function zombieSpit(sr, R, type = 'spitter') {
  const T = ZTYPES[type] || ZTYPES.spitter;
  const o = buf(0.85, sr), w = white(R.seed());
  const kh = R.r(0.18, 0.28);
  {
    const n = Math.round(kh * sr), tmp = new Float32Array(n), f = new SVF(sr), rr = R.r(32, 48);
    for (let i = 0; i < n; i++) {
      const t = i / sr, x = t / kh;
      if ((i & 15) === 0) f.set(1400 + 1400 * x, 1.3);
      tmp[i] = f.bp(w()) * Math.pow(x, 1.3) * (0.55 + 0.45 * Math.sin(TAU * rr * t));
    }
    mixIn(o, tmp, 0, sr, 0.55);
  }
  const tp = kh + R.r(0.025, 0.05);
  addThump(o, tp, sr, 280, 120, 0.008, 0.018, 0.7, 0.0004);
  addNoise(o, tp, sr, w, { atk: 0.0002, tau: 0.007, f0: 1500, mode: 'hp', amp: 0.55 });
  const vo = voice(sr, R, { ...T, dur: R.r(0.12, 0.18), f0: T.f0 * 1.7, pitch: [[0, 1.1], [1, 0.8]], vowels: [[0, 'u'], [1, 'u']], env: [[0, 0], [0.12, 1], [0.6, 0.7], [1, 0]], wet: 0, growl: 0.2, drive: 1.5 });
  mixIn(o, vo, tp + 0.012, sr, 0.5);
  addNoise(o, tp + 0.005, sr, w, { atk: 0.002, tau: 0.05, f0: 2600, mode: 'hp', q: 0.7, amp: 0.4 });
  for (let k = 0; k < 9; k++) addBubble(o, tp + R.r(0, 0.25), sr, R.r(400, 1500), R.r(0.05, 0.18), R.r(0.004, 0.012), R.r(1, 3));
  return finish(o, sr, { peak: 0.9 });
}

// Стон игрока от боли: vi — номер вариации, чем больше, тем сильнее напряжение
export function playerHurt(sr, R, vi = 0, nv = 6) {
  const s = nv > 1 ? vi / (nv - 1) : 0.5;
  const vw = R.c(0.5) ? [[0, 'uh'], [1, 'er']] : [[0, 'a'], [0.55, 'uh'], [1, 'u']];
  return voice(sr, R, {
    dur: R.r(0.22, 0.3) + s * 0.18, f0: R.r(112, 128) + s * 40, pitch: [[0, 1.1], [0.18, 1.0], [1, 0.7]], vowels: vw,
    fs: R.r(0.97, 1.03), bw: 1, jitter: 0.015 + 0.03 * s, shimmer: 0.1 + 0.1 * s, rasp: 0.08 + 0.4 * s, breath: 0.15 + 0.15 * s,
    growl: 0.15 * s, sub: 0.12 * s, drive: 1.4 + 1.6 * s, env: [[0, 0], [0.05, 1], [0.4, 0.8], [1, 0]], lp: 7500, chest: 0.15, vib: [5, 0.008],
  });
}

// Смерть игрока: крик → стон → хрип → последний выдох
export function playerDeath(sr, R) {
  const o = buf(2.7, sr);
  const a = voice(sr, R, {
    dur: 1.9, f0: R.r(140, 155), pitch: [[0, 1.15], [0.12, 1.08], [0.4, 0.92], [0.75, 0.68], [1, 0.5]],
    vowels: [[0, 'a'], [0.35, 'a'], [0.7, 'uh'], [1, 'u']], jitter: 0.03, shimmer: 0.15, rasp: 0.35, breath: 0.25, growl: 0.15,
    sub: 0.15, drive: 2.0, fry: 0.15, fryC: [[0, 0], [0.6, 0.4], [1, 3]], wet: 0.25, wetC: [[0, 0], [0.6, 0.5], [1, 1.5]],
    env: [[0, 0], [0.04, 1], [0.3, 0.85], [0.8, 0.45], [1, 0]], lp: 6500, chest: 0.15, vib: [5.5, 0.015], bubbles: 18,
  });
  mixIn(o, a, 0, sr, 0.9);
  mixIn(o, exhale(sr, R, 0.6), 1.95, sr, 0.25);
  return finish(o, sr, { peak: 0.9 });
}

// Выдох «хх» (прыжок, приземление)
export function exhale(sr, R, dur = 0.25) {
  return voice(sr, R, {
    dur, f0: R.r(95, 120), voiced: 0.12, breath: 1, rasp: 0, pitch: [[0, 1], [1, 0.85]], vowels: [[0, 'uh'], [1, 'er']],
    env: [[0, 0], [0.15, 1], [0.5, 0.6], [1, 0]], lp: 5000,
  });
}

// Ворона: 2–4 хриплых «карр»
export function crow(sr, R) {
  const n = R.i(2, 4), o = buf(n * 0.62 + 0.3, sr);
  let t = 0.02;
  for (let k = 0; k < n; k++) {
    const d = R.r(0.22, 0.34);
    const c = voice(sr, R, {
      dur: d, f0: R.r(480, 600), pitch: [[0, 0.85], [0.25, 1.08], [1, 0.82]], vowels: [[0, 'ae'], [0.5, 'a'], [1, 'a']],
      fs: 1.45, bw: 1.6, jitter: 0.08, shimmer: 0.4, rasp: 1.2, breath: 0.5, growl: 0.5, sub: 0.4, drive: 3,
      env: [[0, 0], [0.08, 1], [0.6, 0.8], [1, 0]], lp: 7000, oq: 0.5,
    });
    mixIn(o, c, t, sr, R.r(0.7, 1) * (k === 0 ? 1 : 0.85));
    t += d + R.r(0.12, 0.28);
  }
  return finish(o, sr, { peak: 0.9 });
}

// Далёкий протяжный вой
export function howl(sr, R) {
  return voice(sr, R, {
    dur: R.r(2.8, 3.8), f0: R.r(330, 400), pitch: [[0, 0.8], [0.2, 1.15], [0.6, 1.2], [0.85, 1.05], [1, 0.75]],
    vowels: [[0, 'u'], [0.3, 'o'], [0.8, 'o'], [1, 'u']], fs: 1.3, bw: 1, jitter: 0.008, shimmer: 0.05, rasp: 0.05,
    breath: 0.12, drive: 1.2, env: [[0, 0], [0.15, 0.9], [0.7, 1], [1, 0]], lp: 3000, vib: [5, 0.012], oq: 0.75,
  });
}
