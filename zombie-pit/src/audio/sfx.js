// Рецепты звуков (кроме голосов зомби): (sr, R, ...) → Float32Array (моно) или [L, R].
import {
  TAU, white, buf, SVF, onePole, mixIn, addModes, addThump, addNoise, addRumble, addGrains, addBubble,
  addScrape, addCloth, addWhoosh, addReflection, sawBlep, finish, finishMulti,
} from './dsp.js';
import { exhale } from './vox.js';

// ───────────────────────── Выстрелы ─────────────────────────
// Слои: N-волна/щелчок → «тело» с падением тона → дульная волна (шум с уходящим вниз срезом) →
// «лай» средних частот → отражение от земли → раскатистый хвост → рассеянные отражения → механика.
export const GUNS = {
  pistol: {
    len: 0.95, nwave: 0.3, nwaveW: 0.0003, crack: 0.55, crackTau: 0.002, crackHP: 2800,
    body: 0.95, bodyF0: 215, bodyF1: 64, bodyFT: 0.02, bodyTau: 0.055, bodyDrive: 1.6, sub: 0,
    blast: 1.0, lpA: 9000, lpB: 800, lpT: 0.03, blastTau: 0.01, blastTau2: 0.06,
    bark: 0.6, barkF: 1500, barkQ: 1.3, barkTau: 0.03,
    tail: 0.3, tailTau: 0.3, tailLP: 700, scatter: 9, scatterAmp: 0.14,
    mech: [[0.024, 0.2, [3300, 4800, 6700, 8900]]], drive: 2.4,
  },
  shotgun: {
    len: 1.6, nwave: 0.25, nwaveW: 0.0005, crack: 0.5, crackTau: 0.003, crackHP: 2200,
    body: 1.0, bodyF0: 150, bodyF1: 46, bodyFT: 0.035, bodyTau: 0.12, bodyDrive: 2.0, sub: 0.65, subF0: 72, subF1: 33, subTau: 0.2,
    blast: 1.0, lpA: 7000, lpB: 450, lpT: 0.05, blastTau: 0.016, blastTau2: 0.11,
    bark: 0.5, barkF: 850, barkQ: 1.1, barkTau: 0.05,
    tail: 0.5, tailTau: 0.55, tailLP: 420, scatter: 14, scatterAmp: 0.18,
    mech: [], drive: 2.8,
  },
  rifle: {
    len: 0.85, nwave: 0.85, nwaveW: 0.00035, crack: 0.7, crackTau: 0.0015, crackHP: 3500,
    body: 0.85, bodyF0: 245, bodyF1: 72, bodyFT: 0.016, bodyTau: 0.042, bodyDrive: 2.0, sub: 0.3, subF0: 95, subF1: 50, subTau: 0.07,
    blast: 0.95, lpA: 13000, lpB: 1200, lpT: 0.018, blastTau: 0.008, blastTau2: 0.045,
    bark: 0.65, barkF: 2200, barkQ: 1.5, barkTau: 0.02,
    tail: 0.32, tailTau: 0.3, tailLP: 650, scatter: 10, scatterAmp: 0.15,
    mech: [[0.016, 0.24, [1800, 2700, 3900, 5600]], [0.05, 0.12, [2100, 3300, 4600]]], drive: 3.2,
  },
};

export function gunshot(sr, R, id) {
  const P = GUNS[id] || GUNS.pistol, j = R.j;
  const o = buf(P.len, sr), w = white(R.seed());
  if (P.nwave) {
    const n = Math.max(4, Math.round(j(P.nwaveW, 0.25) * sr));
    for (let i = 0; i < n; i++) o[i] += P.nwave * (1 - 2 * i / (n - 1));
  }
  addNoise(o, 0, sr, w, { atk: 0.00006, tau: j(P.crackTau, 0.25), f0: P.crackHP, mode: 'hp', q: 0.6, amp: P.crack });
  addThump(o, 0, sr, j(P.bodyF0, 0.07), j(P.bodyF1, 0.07), j(P.bodyFT, 0.15), j(P.bodyTau, 0.12), P.body, 0.0005, P.bodyDrive);
  if (P.sub) addThump(o, 0.001, sr, j(P.subF0, 0.07), j(P.subF1, 0.07), P.bodyFT * 1.6, j(P.subTau, 0.12), P.sub, 0.002);
  addNoise(o, 0, sr, w, {
    atk: 0.00025, tau: j(P.blastTau, 0.15), tau2: j(P.blastTau2, 0.15), mix2: 0.4,
    f0: j(P.lpA, 0.12), f1: j(P.lpB, 0.2), fT: j(P.lpT, 0.2), mode: 'lp', q: 0.75, amp: P.blast,
  });
  addNoise(o, 0, sr, w, { atk: 0.0004, tau: j(P.barkTau, 0.2), f0: j(P.barkF, 0.12), mode: 'bp', q: P.barkQ, amp: P.bark });
  addReflection(o, sr, R.r(0.0075, 0.0105), R.r(0.3, 0.42), 2200, 0.12);
  addRumble(o, R.r(0.004, 0.012), sr, w, { tau: j(P.tailTau, 0.15), lp: j(P.tailLP, 0.15), amp: P.tail, atk: 0.02, am: 0.45, amRate: R.r(4, 8) });
  for (let k = 0; k < P.scatter; k++) {
    const t = 0.035 + Math.pow(R.f(), 1.4) * P.len * 0.5;
    addNoise(o, t, sr, w, { atk: 0.0015, tau: R.r(0.004, 0.014), f0: R.r(700, 2200), mode: 'lp', q: 0.7, amp: P.scatterAmp * Math.exp(-t / (P.tailTau * 0.9)) * R.r(0.4, 1) });
  }
  for (const [t, a, fs] of P.mech) addModes(o, j(t, 0.15), sr, fs.map((f) => [j(f, 0.06), R.r(0.4, 1), R.r(0.005, 0.018)]), a);
  return finish(o, sr, { drive: P.drive, peak: 0.97, dc: 18 });
}

// Взрыв гранаты: треск фронта + суббас + взрывная волна + гул + обломки
export function explosion(sr, R) {
  const o = buf(3.8, sr), w = white(R.seed());
  const n = Math.round(0.0007 * sr);
  for (let i = 0; i < n; i++) o[i] += 0.8 * (1 - 2 * i / (n - 1));
  addNoise(o, 0, sr, w, { atk: 0.0002, tau: 0.004, f0: 2500, mode: 'hp', amp: 0.7 });
  addThump(o, 0, sr, R.j(75, 0.1), R.j(27, 0.1), 0.08, 0.35, 1.0, 0.002, 2.5);
  addThump(o, 0.004, sr, R.j(140, 0.1), 45, 0.04, 0.12, 0.5, 0.001, 1.5);
  addNoise(o, 0, sr, w, { atk: 0.0008, tau: 0.04, tau2: 0.35, mix2: 0.5, f0: 7000, f1: 250, fT: 0.12, mode: 'lp', q: 0.7, amp: 1.0, dur: 2.6 });
  addRumble(o, 0.02, sr, w, { tau: 1.1, lp: 160, amp: 0.55, atk: 0.06, am: 0.6, amRate: 3 });
  addReflection(o, sr, R.r(0.009, 0.013), 0.35, 1500, 0.3);
  addGrains(o, sr, R, w, { t0: 0.12, t1: 1.9, count: 45, amp: 0.22, decay: 1.2, fMin: 400, fMax: 3000, tauMin: 0.004, tauMax: 0.02, q: 2.5, curve: 1.8 });
  addGrains(o, sr, R, w, { t0: 0.2, t1: 1.5, count: 14, amp: 0.1, decay: 1, fMin: 2500, fMax: 6000, tauMin: 0.005, tauMax: 0.02, kind: 'ping', curve: 1.5 });
  return finish(o, sr, { drive: 2.2, peak: 0.97 });
}

// ───────────────────────── Попадания ─────────────────────────
export function impact(sr, R, surf) {
  const o = buf(0.7, sr), w = white(R.seed());
  if (surf === 'metal') {
    addNoise(o, 0, sr, w, { atk: 0.00005, tau: 0.0015, f0: 3000, mode: 'hp', amp: 0.8 });
    const b = R.r(700, 1150), rat = [1, 1.58, 2.15, 2.72, 3.91, 5.37];
    addModes(o, 0, sr, rat.map((r, k) => [b * r * R.r(0.97, 1.03), R.r(0.5, 1) / (1 + k * 0.35), R.r(0.12, 0.35) / (1 + k * 0.4)]), 0.6);
    addModes(o, 0, sr, [[R.r(5500, 7500), 0.5, 0.02], [R.r(8000, 9500), 0.3, 0.012]], 0.5);
    addNoise(o, 0, sr, w, { atk: 0.0002, tau: 0.01, f0: 2800, mode: 'bp', q: 1.2, amp: 0.4 });
  } else if (surf === 'wood') {
    addNoise(o, 0, sr, w, { atk: 0.0001, tau: 0.003, f0: 2500, mode: 'bp', q: 0.8, amp: 0.7 });
    const b = R.r(200, 290);
    addModes(o, 0, sr, [[b, 1, 0.045], [b * R.r(2.1, 2.5), 0.7, 0.03], [b * R.r(3.8, 4.4), 0.5, 0.018], [b * R.r(6.2, 7.2), 0.3, 0.01]], 0.7);
    addNoise(o, 0, sr, w, { atk: 0.0004, tau: 0.012, f0: 1200, mode: 'lp', amp: 0.4 });
    addGrains(o, sr, R, w, { t0: 0.002, t1: 0.06, count: 9, amp: 0.3, fMin: 1500, fMax: 6000, tauMin: 0.0008, tauMax: 0.003, q: 1.5 });
  } else if (surf === 'rock' || surf === 'concrete') {
    const conc = surf === 'concrete';
    o[0] += 0.9; o[1] -= 0.6; o[2] += 0.3;
    addNoise(o, 0, sr, w, { atk: 0.00005, tau: 0.0012, f0: 4000, mode: 'hp', amp: 0.9 });
    addNoise(o, 0, sr, w, { atk: 0.0002, tau: 0.007, f0: R.r(2400, 3600), mode: 'bp', q: 1.4, amp: 0.6 });
    addModes(o, 0, sr, [[R.r(1600, 2100), 0.6, 0.012], [R.r(2700, 3300), 0.5, 0.009], [R.r(4000, 4800), 0.4, 0.006]], 0.6);
    addThump(o, 0, sr, conc ? 170 : 220, conc ? 90 : 120, 0.006, 0.014, 0.4, 0.0003);
    addGrains(o, sr, R, w, { t0: 0.03, t1: 0.42, count: R.i(5, 10), amp: 0.22, fMin: 2500, fMax: 7000, tauMin: 0.004, tauMax: 0.014, kind: 'ping', curve: 1.3 });
    if (conc) addNoise(o, 0.003, sr, w, { atk: 0.004, tau: 0.08, f0: 900, mode: 'lp', amp: 0.18 });
  } else if (surf === 'sandbag') {
    addThump(o, 0, sr, R.r(85, 105), 48, 0.02, 0.05, 0.8, 0.0015);
    addNoise(o, 0, sr, w, { atk: 0.001, tau: 0.035, f0: 550, mode: 'lp', amp: 0.6 });
    addNoise(o, 0.01, sr, w, { atk: 0.02, tau: 0.12, f0: 3500, mode: 'hp', q: 0.6, amp: 0.15 });
    addGrains(o, sr, R, w, { t0: 0.02, t1: 0.35, count: 30, amp: 0.08, fMin: 2500, fMax: 7000, tauMin: 0.0006, tauMax: 0.0015, q: 1 });
  } else { // dirt / grass
    addThump(o, 0, sr, R.r(100, 130), 52, 0.012, 0.035, 0.85, 0.0008);
    addNoise(o, 0, sr, w, { atk: 0.0003, tau: 0.018, f0: R.r(1300, 1900), mode: 'lp', amp: 0.7 });
    addNoise(o, 0, sr, w, { atk: 0.0001, tau: 0.002, f0: 2500, mode: 'hp', amp: 0.3 });
    addGrains(o, sr, R, w, { t0: 0.01, t1: R.r(0.25, 0.4), count: R.i(14, 22), amp: 0.3, fMin: 900, fMax: 4500, tauMin: 0.0015, tauMax: 0.005, q: 1.8, curve: 1.6 });
  }
  return finish(o, sr, { peak: 0.9 });
}

// Рикошет: свист кувыркающейся пули с понижением тона
export function ricochet(sr, R) {
  const d = R.r(0.35, 0.55), o = buf(d + 0.05, sr), w = white(R.seed());
  const fA = R.r(4200, 6000), fB = R.r(1500, 2300), wob = R.r(40, 110);
  const flt = new SVF(sr), tmp = new Float32Array(o.length);
  let ph = 0;
  for (let i = 0; i < tmp.length; i++) {
    const t = i / sr, x = Math.min(1, t / d);
    const f = fA * Math.pow(fB / fA, Math.pow(x, 0.7));
    ph += TAU * f * (1 + 0.012 * Math.sin(TAU * wob * t)) / sr;
    if ((i & 15) === 0) flt.set(f, 6);
    const e = Math.min(1, t / 0.012) * Math.pow(1 - x, 1.4) * (0.75 + 0.25 * Math.sin(TAU * wob * t + 1));
    tmp[i] = (Math.sin(ph) * 0.8 + flt.bp(w()) * 1.6) * e;
  }
  mixIn(o, tmp, 0, sr, 0.9);
  addNoise(o, 0, sr, w, { atk: 0.00005, tau: 0.002, f0: 3500, mode: 'hp', amp: 0.4 });
  return finish(o, sr, { peak: 0.9 });
}

// Хлюп: резонансная полоса скользит вверх с рваной амплитудой
function squelch(o, at, sr, R, w, dur, fA, fB, amp) {
  const n = Math.round(dur * sr), tmp = new Float32Array(n), f = new SVF(sr), ga = onePole(60, sr);
  let g = 0, gt = 1, cnt = 0;
  for (let i = 0; i < n; i++) {
    const x = i / n;
    if ((i & 15) === 0) f.set(fA * Math.pow(fB / fA, x), 5);
    if (--cnt <= 0) { cnt = Math.round(sr * R.r(0.004, 0.015)); gt = R.r(0.2, 1); }
    g += ga * (gt - g);
    tmp[i] = f.bp(w()) * Math.sin(Math.PI * Math.pow(x, 0.6)) * g;
  }
  mixIn(o, tmp, at, sr, amp);
}

export function flesh(sr, R, head) {
  const o = buf(head ? 0.65 : 0.5, sr), w = white(R.seed());
  addThump(o, 0, sr, R.r(130, 160), R.r(60, 75), 0.015, 0.035, 0.85, 0.0008, 1.2);
  addNoise(o, 0, sr, w, { atk: 0.0002, tau: 0.012, f0: R.r(900, 1400), mode: 'bp', q: 0.8, amp: 0.85 });
  squelch(o, R.r(0.005, 0.02), sr, R, w, R.r(0.06, 0.1), R.r(300, 450), R.r(1200, 1800), 0.55);
  for (let k = 0; k < (head ? 8 : 4); k++) addBubble(o, R.r(0.01, 0.15), sr, R.r(500, 1600), R.r(0.04, 0.12), R.r(0.003, 0.008), R.r(1, 3));
  if (head) {
    addNoise(o, 0, sr, w, { atk: 0.00005, tau: 0.0015, f0: 3000, mode: 'hp', amp: 0.8 });
    addModes(o, 0, sr, [[R.r(1900, 2500), 0.6, 0.008], [R.r(3200, 3900), 0.45, 0.006], [R.r(5000, 6000), 0.3, 0.004]], 0.7);
    addGrains(o, sr, R, w, { t0: 0.001, t1: 0.05, count: 14, amp: 0.45, fMin: 1800, fMax: 6500, tauMin: 0.0006, tauMax: 0.002, q: 1.3 });
    squelch(o, R.r(0.04, 0.07), sr, R, w, R.r(0.1, 0.16), 250, 1100, 0.45);
    addGrains(o, sr, R, w, { t0: 0.06, t1: 0.45, count: 14, amp: 0.15, fMin: 600, fMax: 3000, tauMin: 0.002, tauMax: 0.006, q: 3 });
  }
  return finish(o, sr, { peak: 0.9, drive: head ? 1.4 : 1.1 });
}

export function gore(sr, R) {
  const o = buf(1.0, sr), w = white(R.seed());
  addThump(o, 0, sr, 110, 50, 0.02, 0.05, 0.7, 0.002, 1.2);
  addNoise(o, 0, sr, w, { atk: 0.001, tau: 0.04, f0: 600, mode: 'lp', amp: 0.7 });
  addNoise(o, 0, sr, w, { atk: 0.0005, tau: 0.02, f0: 1600, mode: 'bp', q: 0.7, amp: 0.6 });
  squelch(o, 0.01, sr, R, w, 0.14, 250, 1400, 0.55);
  squelch(o, R.r(0.08, 0.15), sr, R, w, 0.12, 400, 1700, 0.4);
  addGrains(o, sr, R, w, { t0: 0.04, t1: 0.75, count: 34, amp: 0.35, decay: 1.4, fMin: 500, fMax: 3500, tauMin: 0.002, tauMax: 0.008, q: 3, curve: 1.6 });
  for (let k = 0; k < 10; k++) addBubble(o, R.r(0.02, 0.4), sr, R.r(400, 1400), R.r(0.04, 0.12), R.r(0.003, 0.01), R.r(1, 3));
  return finish(o, sr, { peak: 0.9, drive: 1.3 });
}

export function bodyFall(sr, R, heavy) {
  const o = buf(heavy ? 1.1 : 0.8, sr), w = white(R.seed()), k = heavy ? 0.72 : 1;
  addThump(o, 0, sr, R.r(75, 90) * k, R.r(40, 46) * k, 0.03, heavy ? 0.12 : 0.075, 1, 0.003, 1.4);
  addNoise(o, 0, sr, w, { atk: 0.002, tau: heavy ? 0.08 : 0.055, f0: heavy ? 280 : 380, mode: 'lp', amp: 0.8 });
  addNoise(o, 0, sr, w, { atk: 0.001, tau: 0.02, f0: 700, mode: 'bp', q: 0.8, amp: 0.45 });
  const t2 = R.r(0.08, 0.17);
  addThump(o, t2, sr, R.r(95, 120) * k, 55 * k, 0.02, 0.04, 0.45, 0.002);
  addNoise(o, t2, sr, w, { atk: 0.001, tau: 0.025, f0: 500, mode: 'lp', amp: 0.35 });
  if (heavy) addThump(o, t2 + R.r(0.08, 0.14), sr, 80, 42, 0.02, 0.06, 0.4, 0.003);
  addCloth(o, 0, R.r(0.25, 0.4), sr, R, w, 0.2);
  addGrains(o, sr, R, w, { t0: 0.01, t1: 0.45, count: heavy ? 24 : 14, amp: 0.18, fMin: 700, fMax: 3500, tauMin: 0.0015, tauMax: 0.005, q: 1.8 });
  return finish(o, sr, { peak: 0.9, drive: 1.3 });
}

export function zombieStep(sr, R, heavy) {
  const o = buf(heavy ? 0.6 : 0.45, sr), w = white(R.seed());
  if (heavy) {
    addThump(o, 0, sr, R.r(60, 72), 30, 0.03, 0.11, 1, 0.003, 1.6);
    addNoise(o, 0, sr, w, { atk: 0.002, tau: 0.06, f0: 320, mode: 'lp', amp: 0.7 });
    addGrains(o, sr, R, w, { t0: 0.01, t1: 0.3, count: 16, amp: 0.2, fMin: 600, fMax: 3000, tauMin: 0.002, tauMax: 0.006, q: 1.8 });
  } else {
    addThump(o, 0, sr, R.r(85, 105), 50, 0.015, 0.035, 0.75, 0.0015);
    addNoise(o, 0, sr, w, { atk: 0.0015, tau: 0.025, f0: 650, mode: 'lp', amp: 0.6 });
    addGrains(o, sr, R, w, { t0: 0.005, t1: 0.12, count: 8, amp: 0.25, fMin: 1000, fMax: 4000, tauMin: 0.0012, tauMax: 0.004, q: 1.8 });
  }
  if (R.c(0.7)) addScrape(o, R.r(0.04, 0.1), R.r(0.1, 0.2), sr, R, w, { f: R.r(900, 1800), q: 0.7, amp: heavy ? 0.2 : 0.3, rate: 120, rough: 0.7, atk: 0.03, rel: 0.06 });
  return finish(o, sr, { peak: 0.9 });
}

// Зомби карабкается через край ямы: скрежет по земле/камню, осыпь, камешки
export function rimScrape(sr, R) {
  const d = R.r(0.9, 1.5), o = buf(d + 0.45, sr), w = white(R.seed());
  const nS = R.i(2, 4);
  for (let k = 0; k < nS; k++) {
    addScrape(o, R.r(0, d * 0.6), R.r(0.2, 0.5), sr, R, w, { f: R.r(1200, 2600), f2: R.r(900, 2000), q: R.r(0.8, 1.6), amp: R.r(0.35, 0.6), rate: R.r(60, 160), rough: 0.9, spike: 0.25, atk: 0.03, rel: 0.08 });
  }
  addRumble(o, 0.02, sr, w, { tau: d * 0.4, lp: 450, amp: 0.3, atk: 0.08, am: 0.8, amRate: 7 });
  addGrains(o, sr, R, w, { t0: 0.05, t1: d + 0.3, count: R.i(18, 30), amp: 0.3, decay: 0.6, fMin: 700, fMax: 4000, tauMin: 0.002, tauMax: 0.007, q: 2, curve: 1.1 });
  addGrains(o, sr, R, w, { t0: 0.1, t1: d + 0.3, count: R.i(3, 6), amp: 0.25, decay: 0.4, fMin: 900, fMax: 2600, tauMin: 0.006, tauMax: 0.02, kind: 'ping', curve: 1 });
  addThump(o, R.r(0.05, d * 0.5), sr, 120, 70, 0.02, 0.03, 0.3, 0.003);
  return finish(o, sr, { peak: 0.9 });
}

export function acidSpit(sr, R) {
  const o = buf(0.6, sr), w = white(R.seed());
  addThump(o, 0, sr, 240, 110, 0.01, 0.02, 0.6, 0.0006);
  addNoise(o, 0, sr, w, { atk: 0.002, tau: 0.07, f0: R.r(1800, 2600), mode: 'bp', q: 0.7, amp: 0.6 });
  addWhoosh(o, 0.01, R.r(0.3, 0.4), sr, w, { f0: 600, fp: 2200, f1: 900, q: 1.2, amp: 0.4, peak: 0.25 });
  for (let k = 0; k < 14; k++) addBubble(o, R.r(0, 0.25), sr, R.r(350, 1400), R.r(0.06, 0.2), R.r(0.004, 0.012), R.r(1, 3));
  return finish(o, sr, { peak: 0.9 });
}

// Шипение кислоты: густой ВЧ треск + шип
function sizzle(o, at, dur, sr, R, w, amp) {
  const n = Math.round(dur * sr), tmp = new Float32Array(n), hp = new SVF(sr).set(4200, 0.6), cr = new SVF(sr).set(6500, 1.2);
  for (let i = 0; i < n; i++) {
    const t = i / sr, e = Math.min(1, t / 0.06) * Math.exp(-t / (dur * 0.35));
    hp.tick(w()); cr.tick(R.f() < 0.012 ? R.n() * 6 : 0);
    tmp[i] = (hp.h * 0.35 + cr.b * cr.k) * e;
  }
  mixIn(o, tmp, at, sr, amp);
}

export function acidSplash(sr, R) {
  const o = buf(1.9, sr), w = white(R.seed());
  addNoise(o, 0, sr, w, { atk: 0.001, tau: 0.05, f0: R.r(1500, 2500), mode: 'bp', q: 0.7, amp: 0.7 });
  addThump(o, 0, sr, 130, 70, 0.015, 0.03, 0.4, 0.001);
  addGrains(o, sr, R, w, { t0: 0.01, t1: 0.35, count: 22, amp: 0.35, fMin: 700, fMax: 4000, tauMin: 0.002, tauMax: 0.006, q: 3 });
  sizzle(o, 0.03, 1.7, sr, R, w, 0.55);
  for (let k = 0; k < 12; k++) addBubble(o, R.r(0.05, 1.2), sr, R.r(800, 2500), R.r(0.02, 0.06), R.r(0.003, 0.008), R.r(1, 2));
  return finish(o, sr, { peak: 0.9 });
}

export function grenadeBounce(sr, R) {
  const o = buf(0.4, sr), w = white(R.seed());
  addThump(o, 0, sr, R.r(150, 190), 90, 0.01, 0.022, 0.7, 0.0006);
  addNoise(o, 0, sr, w, { atk: 0.0003, tau: 0.012, f0: 900, mode: 'lp', amp: 0.45 });
  addModes(o, 0.001, sr, [[R.r(1700, 2100), 0.8, 0.05], [R.r(2900, 3400), 0.6, 0.035], [R.r(4300, 4900), 0.4, 0.02], [R.r(6200, 7000), 0.25, 0.012]], 0.55);
  addGrains(o, sr, R, w, { t0: 0.005, t1: 0.08, count: 5, amp: 0.15, fMin: 1000, fMax: 3500, tauMin: 0.0015, tauMax: 0.004 });
  return finish(o, sr, { peak: 0.9 });
}

// Гильзы: латунь — звонкие пинги 3–5 кГц с отскоками; дробовик — полый пластиковый «ток»
export function casing(sr, R, kind) {
  const o = buf(0.6, sr), w = white(R.seed());
  let t = 0, a = 1;
  if (kind === 'shotgun') {
    const nb = R.i(2, 3);
    for (let b = 0; b < nb; b++) {
      const f = R.r(850, 1150);
      addModes(o, t, sr, [[f, 1, 0.012], [f * R.r(1.6, 1.8), 0.6, 0.008], [f * R.r(2.5, 2.9), 0.35, 0.006]], a);
      addModes(o, t, sr, [[R.r(2800, 3400), 0.4, 0.012]], a * 0.5);
      addNoise(o, t, sr, w, { atk: 0.0002, tau: 0.004, f0: 1500, mode: 'bp', q: 0.9, amp: a * 0.35 });
      t += R.r(0.07, 0.14) * (1 - b * 0.25); a *= R.r(0.35, 0.55);
    }
  } else {
    const base = kind === 'rifle' ? R.r(2900, 3700) : R.r(3600, 4600), tl = kind === 'rifle' ? 1.25 : 1;
    const nb = R.i(3, 4);
    for (let b = 0; b < nb; b++) {
      addModes(o, t, sr, [
        [base * R.r(0.99, 1.01), R.r(0.3, 1), 0.06 * tl], [base * 1.47, R.r(0.3, 1), 0.04 * tl],
        [base * 2.09, R.r(0.2, 0.7), 0.028 * tl], [base * 2.7, R.r(0.15, 0.5), 0.018 * tl], [base * 0.52, R.r(0.1, 0.3), 0.02],
      ], a);
      addNoise(o, t, sr, w, { atk: 0.0001, tau: 0.0015, f0: 5000, mode: 'hp', amp: a * 0.25 });
      t += R.r(0.06, 0.12) * Math.pow(0.75, b); a *= R.r(0.35, 0.6);
    }
  }
  return finish(o, sr, { peak: 0.9 });
}

// ───────────────────────── Механика оружия ─────────────────────────
// Жёсткий металлический щелчок: импульс + моды + (опц.) низкий удар
function clack(o, at, sr, R, w, base, amp, thump = 0) {
  addNoise(o, at, sr, w, { atk: 0.00005, tau: 0.0012, f0: 3500, mode: 'hp', amp: amp * 0.8 });
  addModes(o, at, sr, [
    [base * R.r(0.97, 1.03), 0.8, 0.02], [base * R.r(1.5, 1.6), 0.6, 0.014],
    [base * R.r(2.2, 2.4), 0.45, 0.01], [base * R.r(3.1, 3.4), 0.3, 0.007],
  ], amp);
  if (thump) addThump(o, at, sr, thump, thump * 0.6, 0.008, 0.016, amp * 0.6, 0.0004);
}

export function mech(sr, R, name) {
  const o = buf(0.7, sr), w = white(R.seed());
  switch (name) {
    case 'dry':
      clack(o, 0, sr, R, w, R.r(2600, 3200), 0.6);
      addThump(o, 0, sr, 700, 500, 0.003, 0.004, 0.25, 0.0002);
      break;
    case 'pistol_magOut':
      clack(o, 0, sr, R, w, R.r(3500, 4200), 0.45);
      addScrape(o, 0.015, R.r(0.06, 0.09), sr, R, w, { f: 2600, f2: 3200, q: 1.2, amp: 0.35, rate: 400, rough: 0.5, atk: 0.005, rel: 0.02 });
      addModes(o, 0.02, sr, [[R.r(1800, 2200), 0.3, 0.05], [R.r(3800, 4300), 0.2, 0.04]], 0.3);
      break;
    case 'pistol_magIn':
      addScrape(o, 0, R.r(0.05, 0.07), sr, R, w, { f: 2200, f2: 2800, q: 1, amp: 0.3, rate: 400, rough: 0.5, atk: 0.01, rel: 0.01 });
      clack(o, R.r(0.06, 0.075), sr, R, w, R.r(1700, 2100), 1, 260);
      break;
    case 'pistol_slide': {
      addScrape(o, 0, R.r(0.07, 0.09), sr, R, w, { f: 3000, f2: 2200, q: 1, amp: 0.35, rate: 500, rough: 0.6, atk: 0.008, rel: 0.01 });
      clack(o, 0.085, sr, R, w, R.r(2400, 2900), 0.5);
      const tr = R.r(0.17, 0.22);
      addScrape(o, tr, 0.025, sr, R, w, { f: 2600, q: 1, amp: 0.25, rate: 600, rough: 0.4, atk: 0.003, rel: 0.01 });
      clack(o, tr + 0.025, sr, R, w, R.r(2000, 2400), 1, 320);
      addModes(o, tr + 0.03, sr, [[R.r(5000, 5800), 0.2, 0.08]], 0.4);
      break;
    }
    case 'rifle_magOut':
      clack(o, 0, sr, R, w, R.r(1600, 2000), 0.7, 200);
      addScrape(o, 0.02, R.r(0.08, 0.12), sr, R, w, { f: 1800, f2: 2400, q: 1, amp: 0.4, rate: 300, rough: 0.6, atk: 0.01, rel: 0.03 });
      addModes(o, 0.03, sr, [[R.r(900, 1200), 0.4, 0.06], [R.r(2300, 2700), 0.25, 0.04]], 0.35);
      break;
    case 'rifle_magIn':
      addScrape(o, 0, R.r(0.06, 0.09), sr, R, w, { f: 1600, f2: 2200, q: 1, amp: 0.35, rate: 300, rough: 0.6, atk: 0.01, rel: 0.01 });
      clack(o, 0.085, sr, R, w, R.r(1300, 1600), 0.6, 180);
      clack(o, 0.085 + R.r(0.05, 0.08), sr, R, w, R.r(1500, 1800), 1, 200);
      break;
    case 'rifle_bolt': {
      addScrape(o, 0, R.r(0.09, 0.12), sr, R, w, { f: 2000, f2: 1500, q: 0.9, amp: 0.45, rate: 260, rough: 0.8, spike: 0.3, atk: 0.008, rel: 0.01 });
      clack(o, 0.11, sr, R, w, R.r(1500, 1800), 0.7, 170);
      const tr = R.r(0.2, 0.26);
      clack(o, tr, sr, R, w, R.r(1300, 1600), 1, 150);
      addModes(o, tr + 0.002, sr, [[R.r(700, 900), 0.4, 0.06], [R.r(3800, 4400), 0.25, 0.05]], 0.5);
      break;
    }
    case 'shotgun_shellIn':
      addScrape(o, 0, R.r(0.03, 0.05), sr, R, w, { f: 1400, q: 0.8, amp: 0.3, rate: 300, rough: 0.5, atk: 0.005, rel: 0.01 });
      addModes(o, 0.04, sr, [[R.r(1000, 1300), 0.7, 0.012], [R.r(1900, 2200), 0.4, 0.008]], 0.6);
      clack(o, 0.045, sr, R, w, R.r(2800, 3300), 0.55);
      addNoise(o, 0.05, sr, w, { atk: 0.003, tau: 0.02, f0: 2500, mode: 'bp', q: 1, amp: 0.15 });
      break;
    case 'shotgun_pump': {
      addScrape(o, 0, R.r(0.06, 0.08), sr, R, w, { f: 1600, f2: 1200, q: 0.9, amp: 0.4, rate: 250, rough: 0.7, atk: 0.006, rel: 0.01 });
      clack(o, 0.075, sr, R, w, R.r(1100, 1400), 0.85, 150);
      const tf = R.r(0.19, 0.24);
      addScrape(o, tf - 0.05, 0.05, sr, R, w, { f: 1300, f2: 1800, q: 0.9, amp: 0.35, rate: 250, rough: 0.7, atk: 0.006, rel: 0.01 });
      clack(o, tf, sr, R, w, R.r(1300, 1650), 1, 180);
      addModes(o, tf + 0.003, sr, [[R.r(600, 800), 0.35, 0.05], [R.r(3400, 3900), 0.25, 0.05]], 0.45);
      break;
    }
    case 'grab':
      addCloth(o, 0, R.r(0.15, 0.22), sr, R, w, 0.45);
      addThump(o, R.r(0.05, 0.1), sr, 260, 160, 0.01, 0.015, 0.4, 0.001);
      addModes(o, R.r(0.06, 0.1), sr, [[R.r(2500, 3200), 0.3, 0.02], [R.r(4200, 5000), 0.2, 0.015]], 0.25);
      break;
    case 'switch':
      addCloth(o, 0, R.r(0.25, 0.33), sr, R, w, 0.5);
      for (let k = 0; k < 3; k++) addModes(o, R.r(0.04, 0.25), sr, [[R.r(1800, 3000), 0.5, R.r(0.02, 0.05)], [R.r(3500, 5200), 0.3, 0.02]], R.r(0.15, 0.3));
      clack(o, R.r(0.2, 0.28), sr, R, w, R.r(1500, 2000), 0.5, 220);
      break;
    case 'knifeSwing':
      addWhoosh(o, 0, R.r(0.2, 0.28), sr, w, { f0: R.r(300, 450), fp: R.r(2000, 2800), f1: R.r(600, 900), q: 2.2, amp: 0.8, peak: R.r(0.4, 0.5), body: 400 });
      addWhoosh(o, 0.01, 0.2, sr, w, { f0: 3000, fp: 6000, f1: 3000, q: 4, amp: 0.15, peak: 0.45 });
      break;
    case 'knifeHit':
      addNoise(o, 0, sr, w, { atk: 0.0002, tau: 0.012, f0: 4000, mode: 'hp', amp: 0.5 });
      addThump(o, 0.004, sr, 140, 65, 0.015, 0.035, 0.85, 0.001, 1.2);
      addNoise(o, 0.004, sr, w, { atk: 0.001, tau: 0.03, f0: 650, mode: 'lp', amp: 0.6 });
      squelch(o, 0.01, sr, R, w, R.r(0.08, 0.12), 300, 1500, 0.5);
      for (let k = 0; k < 5; k++) addBubble(o, R.r(0.01, 0.12), sr, R.r(500, 1500), R.r(0.05, 0.12), R.r(0.003, 0.008), 2);
      break;
    case 'grenadePin':
      addScrape(o, 0, 0.05, sr, R, w, { f: 3500, f2: 4200, q: 1.5, amp: 0.3, rate: 500, rough: 0.5, atk: 0.005, rel: 0.01 });
      addModes(o, 0.05, sr, [[R.r(2500, 2800), 0.8, 0.3], [R.r(4000, 4300), 0.6, 0.2], [R.r(5800, 6200), 0.4, 0.12], [R.r(7600, 8100), 0.3, 0.07]], 0.8);
      addNoise(o, 0.05, sr, w, { atk: 0.0001, tau: 0.0015, f0: 4000, mode: 'hp', amp: 0.4 });
      break;
    case 'grenadeThrow':
      addCloth(o, 0, 0.2, sr, R, w, 0.3);
      addWhoosh(o, 0.05, R.r(0.32, 0.4), sr, w, { f0: 220, fp: R.r(1000, 1400), f1: 350, q: 1.5, amp: 0.8, peak: 0.45, body: 300 });
      break;
  }
  return finish(o, sr, { peak: 0.9 });
}

// ───────────────────────── Игрок ─────────────────────────
export function footstep(sr, R, surf) {
  const o = buf(0.4, sr), w = white(R.seed()), toe = R.r(0.035, 0.07);
  if (surf === 'grass') {
    addThump(o, 0, sr, R.r(85, 110), 55, 0.02, 0.025, 0.35, 0.002);
    addNoise(o, 0, sr, w, { atk: 0.004, tau: 0.03, f0: 400, mode: 'lp', amp: 0.35 });
    addScrape(o, 0.005, R.r(0.1, 0.16), sr, R, w, { f: R.r(2500, 4000), q: 0.7, amp: 0.55, rate: 220, rough: 0.95, atk: 0.006, rel: 0.06 });
    addGrains(o, sr, R, w, { t0: 0, t1: 0.12, count: 10, amp: 0.25, fMin: 2000, fMax: 6000, tauMin: 0.0015, tauMax: 0.004, q: 1.5 });
  } else if (surf === 'concrete') {
    addNoise(o, 0, sr, w, { atk: 0.0003, tau: 0.006, f0: 2600, mode: 'bp', q: 1.2, amp: 0.6 });
    addModes(o, 0, sr, [[R.r(900, 1300), 0.5, 0.008], [R.r(2000, 2600), 0.35, 0.006], [R.r(3800, 4600), 0.2, 0.004]], 0.6);
    addThump(o, 0, sr, 140, 80, 0.01, 0.015, 0.35, 0.0008);
    addScrape(o, toe, R.r(0.05, 0.08), sr, R, w, { f: R.r(1500, 3000), q: 0.8, amp: 0.25, rate: 300, rough: 0.6, atk: 0.005, rel: 0.03 });
    addNoise(o, toe + 0.01, sr, w, { atk: 0.0004, tau: 0.005, f0: 3000, mode: 'bp', q: 1, amp: 0.3 });
  } else if (surf === 'wood') {
    const fb = R.r(150, 210);
    addModes(o, 0, sr, [[fb, 1, 0.06], [fb * 2.3, 0.6, 0.035], [fb * 4.1, 0.4, 0.02], [fb * 6.8, 0.25, 0.012]], 0.6);
    addNoise(o, 0, sr, w, { atk: 0.0005, tau: 0.008, f0: 1800, mode: 'bp', q: 0.9, amp: 0.4 });
    addModes(o, toe, sr, [[fb * 1.1, 0.6, 0.04], [fb * 2.6, 0.4, 0.025], [fb * 4.4, 0.3, 0.015]], 0.35);
    addNoise(o, toe, sr, w, { atk: 0.0005, tau: 0.006, f0: 2200, mode: 'bp', q: 0.9, amp: 0.2 });
  } else { // dirt
    addThump(o, 0, sr, R.r(90, 120), 55, 0.015, 0.03, 0.5, 0.0015);
    addNoise(o, 0, sr, w, { atk: 0.002, tau: 0.025, f0: 700, mode: 'lp', amp: 0.5 });
    addGrains(o, sr, R, w, { t0: 0.003, t1: 0.14, count: 16, amp: 0.35, fMin: 900, fMax: 4000, tauMin: 0.0015, tauMax: 0.005, q: 2 });
    addNoise(o, toe, sr, w, { atk: 0.003, tau: 0.02, f0: 1500, mode: 'bp', q: 0.8, amp: 0.25 });
  }
  return finish(o, sr, { peak: 0.9 });
}

// Звяканье снаряжения на бегу
export function gear(sr, R) {
  const o = buf(0.3, sr), w = white(R.seed());
  const n = R.i(2, 4);
  for (let k = 0; k < n; k++) addModes(o, R.r(0, 0.1), sr, [[R.r(2000, 3500), 0.6, R.r(0.02, 0.05)], [R.r(4000, 6000), 0.3, 0.02]], R.r(0.3, 0.7));
  addCloth(o, 0, 0.15, sr, R, w, 0.4);
  return finish(o, sr, { peak: 0.9 });
}

export function jump(sr, R) {
  const o = buf(0.5, sr), w = white(R.seed());
  addCloth(o, 0, R.r(0.18, 0.25), sr, R, w, 0.45);
  mixIn(o, exhale(sr, R, 0.22), 0.02, sr, 0.55);
  return finish(o, sr, { peak: 0.9 });
}

export function land(sr, R) {
  const o = buf(0.55, sr), w = white(R.seed());
  addThump(o, 0, sr, R.r(70, 85), 42, 0.02, 0.06, 1, 0.002, 1.3);
  addNoise(o, 0, sr, w, { atk: 0.001, tau: 0.04, f0: 420, mode: 'lp', amp: 0.7 });
  addGrains(o, sr, R, w, { t0: 0.003, t1: 0.15, count: 12, amp: 0.25, fMin: 900, fMax: 4000, tauMin: 0.0015, tauMax: 0.004 });
  addCloth(o, 0.01, 0.2, sr, R, w, 0.3);
  for (let k = 0; k < 3; k++) addModes(o, R.r(0.01, 0.08), sr, [[R.r(2000, 3500), 0.5, R.r(0.02, 0.04)]], R.r(0.12, 0.25));
  return finish(o, sr, { peak: 0.9 });
}

// Удар сердца: «лаб» (ниже) и «даб» (выше, короче)
export function heartbeat(sr, R, dub) {
  const o = buf(0.3, sr), w = white(R.seed());
  addThump(o, 0, sr, dub ? 72 : 60, dub ? 50 : 40, 0.03, dub ? 0.045 : 0.06, 1, 0.006, 1.2);
  addNoise(o, 0, sr, w, { atk: 0.003, tau: 0.02, f0: 160, mode: 'lp', amp: 0.4 });
  return finish(o, sr, { peak: 0.9 });
}

// ───────────────────────── Интерфейс ─────────────────────────
function chime(o, at, sr, f, amp, tau = 0.6) {
  addModes(o, at, sr, [[f, 1, tau], [f * 2, 0.35, tau * 0.6], [f * 3, 0.12, tau * 0.4]], amp, 0.008);
}

export function ui(sr, R, name) {
  const o = buf(1.2, sr), w = white(R.seed());
  switch (name) {
    case 'hover':
      addModes(o, 0, sr, [[R.r(2900, 3300), 0.6, 0.004], [1700, 0.4, 0.006]], 1);
      break;
    case 'click':
      addNoise(o, 0, sr, w, { atk: 0.0001, tau: 0.002, f0: 2600, mode: 'bp', q: 0.9, amp: 0.6 });
      addThump(o, 0, sr, 950, 620, 0.005, 0.012, 0.7, 0.0005);
      addModes(o, 0, sr, [[3800, 0.25, 0.006]], 1);
      break;
    case 'buy': {
      clack(o, 0, sr, R, w, 1300, 0.7, 240);
      const b = R.r(2300, 2500), part = [1, 2.01, 2.76, 3.52, 4.24];
      addModes(o, 0.075, sr, part.map((r, k) => [b * r, 1 / (1 + k * 0.6), 0.7 / (1 + k * 0.5)]), 0.8);
      addModes(o, 0.12, sr, part.map((r, k) => [b * 1.26 * r, 1 / (1 + k * 0.6), 0.5 / (1 + k * 0.5)]), 0.5);
      for (let k = 0; k < 6; k++) addModes(o, 0.08 + R.r(0, 0.25), sr, [[R.r(4000, 7000), 1, R.r(0.03, 0.08)]], R.r(0.05, 0.15));
      break;
    }
    case 'denied': {
      const n = Math.round(0.36 * sr), tmp = new Float32Array(n), f = new SVF(sr).set(1100, 0.9);
      let p1 = 0, p2 = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr, d1 = 98 / sr, d2 = 103.5 / sr;
        p1 += d1; if (p1 >= 1) p1 -= 1; p2 += d2; if (p2 >= 1) p2 -= 1;
        const on = t < 0.13 ? Math.min(1, t / 0.005, (0.13 - t) / 0.01) : t > 0.18 && t < 0.33 ? Math.min(1, (t - 0.18) / 0.005, (0.33 - t) / 0.015) : 0;
        tmp[i] = f.tick(sawBlep(p1, d1) + sawBlep(p2, d2)) * on;
      }
      mixIn(o, tmp, 0, sr, 0.9);
      break;
    }
    case 'ammo': {
      const n = R.i(3, 5);
      for (let k = 0; k < n; k++) clack(o, k * R.r(0.03, 0.06), sr, R, w, R.r(2200, 3200), R.r(0.4, 0.8));
      addThump(o, 0, sr, 200, 120, 0.01, 0.025, 0.5, 0.001);
      addCloth(o, 0, 0.15, sr, R, w, 0.25);
      break;
    }
    case 'health':
      addScrape(o, 0, 0.12, sr, R, w, { f: 2500, q: 0.6, amp: 0.4, rate: 900, rough: 0.9, spike: 0.4, atk: 0.005, rel: 0.02 });
      chime(o, 0.1, sr, 659.25, 0.5);
      chime(o, 0.22, sr, 987.77, 0.45);
      break;
    case 'money': {
      const n = R.i(7, 11);
      for (let k = 0; k < n; k++) addModes(o, R.r(0, 0.28), sr, [[R.r(4200, 6800), 1, R.r(0.05, 0.15)], [R.r(7000, 9000), 0.4, 0.04]], R.r(0.3, 0.8));
      addNoise(o, 0, sr, w, { atk: 0.003, tau: 0.08, f0: 5000, mode: 'hp', amp: 0.1 });
      break;
    }
    case 'hit':
      addModes(o, 0, sr, [[R.r(3300, 3700), 0.8, 0.006], [R.r(5400, 5900), 0.4, 0.004]], 1);
      addNoise(o, 0, sr, w, { atk: 0.00005, tau: 0.0008, f0: 4000, mode: 'hp', amp: 0.4 });
      break;
    case 'kill':
      addModes(o, 0, sr, [[R.r(1800, 2000), 0.9, 0.018], [R.r(2800, 3000), 0.6, 0.014], [4400, 0.3, 0.01]], 1);
      addThump(o, 0, sr, 240, 160, 0.01, 0.02, 0.5, 0.0005);
      addNoise(o, 0, sr, w, { atk: 0.00005, tau: 0.001, f0: 4000, mode: 'hp', amp: 0.4 });
      break;
    case 'headshot': {
      const f = 3520;
      addModes(o, 0, sr, [[f, 1, 0.22], [f * 1.505, 0.55, 0.14], [f * 2.02, 0.35, 0.08], [f * 2.53, 0.2, 0.05], [1760, 0.25, 0.08]], 1);
      addNoise(o, 0, sr, w, { atk: 0.00005, tau: 0.001, f0: 5000, mode: 'hp', amp: 0.5 });
      break;
    }
  }
  return finish(o, sr, { peak: 0.9 });
}

// Начало волны: зловещий рог/сирена нарастает → удар
export function waveHorn(sr, R) {
  const swell = 2.3, o = buf(4.8, sr), w = white(R.seed());
  const notes = [55, 82.41, 116.54], det = [-0.006, 0, 0.007], phs = new Float64Array(9);
  const n = Math.round((swell + 0.25) * sr), tmp = new Float32Array(n), flt = new SVF(sr);
  for (let i = 0; i < n; i++) {
    const t = i / sr, x = Math.min(1, t / swell), bend = 1 + 0.06 * x * x;
    let v = 0;
    for (let a = 0; a < 3; a++) for (let d = 0; d < 3; d++) {
      const k = a * 3 + d, f = notes[a] * bend * (1 + det[d]) * (1 + 0.004 * Math.sin(TAU * 5.2 * t + a)), dt = f / sr;
      phs[k] += dt; if (phs[k] >= 1) phs[k] -= 1;
      v += sawBlep(phs[k], dt) * (a === 0 ? 1 : 0.7);
    }
    if ((i & 15) === 0) flt.set(120 + 1700 * x * x, 1.4);
    tmp[i] = flt.tick(v) * Math.pow(x, 1.8) * (t > swell ? Math.max(0, 1 - (t - swell) / 0.2) : 1);
  }
  mixIn(o, tmp, 0, sr, 0.7);
  const tb = swell + 0.02;
  addThump(o, tb, sr, 70, 28, 0.06, 0.45, 1, 0.002, 2);
  addNoise(o, tb, sr, w, { atk: 0.0005, tau: 0.03, tau2: 0.25, mix2: 0.5, f0: 5000, f1: 200, fT: 0.08, mode: 'lp', amp: 0.7 });
  addRumble(o, tb + 0.02, sr, w, { tau: 0.7, lp: 140, amp: 0.4, atk: 0.04, am: 0.5, amRate: 3 });
  return finish(o, sr, { peak: 0.95, drive: 1.5 });
}

// Волна отбита: Dsus4 → D (разрешение) + колокольчики
export function relief(sr, R) {
  const o = buf(3.6, sr), n = o.length, tmp = new Float32Array(n), flt = new SVF(sr).set(1500, 0.7);
  const base = [146.83, 220, 392, 587.33], phs = new Float64Array(8);
  for (let i = 0; i < n; i++) {
    const t = i / sr, e = (1 - Math.exp(-t / 0.12)) * Math.exp(-t / 1.3);
    let v = 0;
    for (let a = 0; a < 4; a++) {
      let f = base[a];
      if (a === 2) f = 369.99 + (392 - 369.99) * Math.exp(-Math.max(0, t - 0.55) / 0.08); // кварта → терция
      for (let d = 0; d < 2; d++) {
        const k = a * 2 + d, dt = f * (d ? 1.004 : 0.996) / sr;
        phs[k] += dt; if (phs[k] >= 1) phs[k] -= 1;
        v += sawBlep(phs[k], dt) * (a === 3 ? 0.35 : 0.5);
      }
    }
    tmp[i] = flt.tick(v) * e;
  }
  mixIn(o, tmp, 0, sr, 0.7);
  addModes(o, 0.6, sr, [[1174.66, 0.6, 0.9], [1174.66 * 2.76, 0.12, 0.35], [1479.98, 0.45, 0.8], [1479.98 * 2.76, 0.1, 0.3]], 0.3, 0.01);
  return finish(o, sr, { peak: 0.9 });
}

// Появление босса: тяжёлый медный кластер + суббас
export function bossBrass(sr, R) {
  const o = buf(3.6, sr), n = o.length, w = white(R.seed()), tmp = new Float32Array(n), flt = new SVF(sr);
  const notes = [32.7, 65.41, 69.3, 98, 130.81], phs = new Float64Array(10);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if ((i & 15) === 0) flt.set(300 + 3200 * Math.exp(-t / 0.35), 1.6);
    const e = Math.min(1, t / 0.012) * (0.35 + 0.65 * Math.exp(-t / 0.5)) * Math.exp(-t / 1.8);
    let v = 0;
    for (let a = 0; a < 5; a++) for (let d = 0; d < 2; d++) {
      const k = a * 2 + d, dt = notes[a] * (d ? 1.005 : 0.995) / sr;
      phs[k] += dt; if (phs[k] >= 1) phs[k] -= 1;
      v += sawBlep(phs[k], dt);
    }
    tmp[i] = flt.tick(v) * e;
  }
  mixIn(o, tmp, 0, sr, 0.85);
  addNoise(o, 0, sr, w, { atk: 0.002, tau: 0.04, f0: 900, mode: 'bp', q: 0.8, amp: 0.3 });
  addThump(o, 0, sr, 65, 30, 0.08, 0.6, 0.9, 0.003, 2);
  addRumble(o, 0.03, sr, w, { tau: 0.9, lp: 120, amp: 0.35, atk: 0.05 });
  return finish(o, sr, { peak: 0.95, drive: 2 });
}

// ───────────────────────── Музыка ─────────────────────────
export function musTom(sr, R) {
  const o = buf(0.9, sr), w = white(R.seed());
  addThump(o, 0, sr, R.j(105, 0.05), R.j(62, 0.05), 0.05, 0.22, 1, 0.003, 1.3);
  addThump(o, 0, sr, R.j(170, 0.05), 110, 0.03, 0.08, 0.3, 0.002);
  addNoise(o, 0, sr, w, { atk: 0.0008, tau: 0.012, f0: 450, mode: 'bp', q: 0.9, amp: 0.35 });
  addNoise(o, 0, sr, w, { atk: 0.0004, tau: 0.004, f0: 2500, mode: 'bp', q: 0.8, amp: 0.12 });
  return finish(o, sr, { peak: 0.9, drive: 1.2 });
}

export function musPulse(sr, R) {
  const o = buf(0.6, sr), w = white(R.seed());
  addThump(o, 0, sr, R.j(64, 0.04), 40, 0.04, 0.17, 1, 0.004, 1.5);
  addNoise(o, 0, sr, w, { atk: 0.001, tau: 0.006, f0: 900, mode: 'lp', amp: 0.15 });
  return finish(o, sr, { peak: 0.9 });
}

export function musTick(sr, R) {
  const o = buf(0.15, sr), w = white(R.seed());
  addNoise(o, 0, sr, w, { atk: 0.0003, tau: 0.012, f0: 6500, mode: 'hp', q: 0.7, amp: 0.6 });
  addModes(o, 0, sr, [[R.r(5000, 5400), 0.4, 0.015], [R.r(7100, 7500), 0.3, 0.01], [R.r(8700, 9200), 0.2, 0.008]], 0.6);
  return finish(o, sr, { peak: 0.9 });
}

// Нарастающий шумовой «подъём» перед сменой фразы
export function musRiser(sr, R) {
  const L = 2.4, o = buf(L + 0.03, sr), w = white(R.seed()), f = new SVF(sr), tmp = new Float32Array(o.length);
  for (let i = 0; i < tmp.length; i++) {
    const t = i / sr, x = Math.min(1, t / L);
    if ((i & 15) === 0) f.set(250 * Math.pow(16, x), 2.5);
    tmp[i] = f.bp(w()) * Math.pow(x, 2.5) * Math.min(1, Math.max(0, (L + 0.025 - t) / 0.025));
  }
  mixIn(o, tmp, 0, sr, 0.8);
  return finish(o, sr, { peak: 0.9, trim: false });
}

// ───────────────────────── Окружение ─────────────────────────
// Сверчки: бесшовная стереопетля из нескольких особей
export function crickets(sr, R) {
  const L = 9.6, N = Math.round(L * sr), l = new Float32Array(N), r = new Float32Array(N);
  for (let c = 0; c < 6; c++) {
    const f = R.r(4100, 5400), pan = R.r(-0.85, 0.85), amp = R.r(0.25, 1);
    const gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
    const k = R.i(9, 18), per = L / k, pulses = R.i(2, 4), prate = R.r(26, 42), pdur = 0.55 / prate, off = R.r(0, per);
    const n = Math.round(pdur * sr);
    for (let m = 0; m < k; m++) {
      if (R.c(0.12)) continue;
      const a = amp * R.r(0.75, 1);
      for (let p = 0; p < pulses; p++) {
        const s = Math.round((off + m * per + p / prate) * sr);
        let ph = R.r(0, TAU), ph2 = 0;
        for (let i = 0; i < n; i++) {
          const e = Math.sin(Math.PI * i / n), dp = TAU * f * (1 + 0.01 * i / n) / sr;
          ph += dp; ph2 += 2 * dp;
          const v = a * e * e * (Math.sin(ph) + 0.15 * Math.sin(ph2));
          const idx = (s + i) % N;
          l[idx] += v * gl; r[idx] += v * gr;
        }
      }
    }
  }
  return finishMulti([l, r], sr, { peak: 0.9 });
}

// Скрип металла: прерывистое трение (stick-slip), возбуждающее резонансы конструкции
export function creak(sr, R) {
  const d = R.r(1.4, 2.6), o = buf(d + 0.35, sr);
  const modes = [[R.r(330, 420), 1, 0.05], [R.r(850, 1000), 0.7, 0.04], [R.r(1600, 1900), 0.5, 0.03], [R.r(2500, 2900), 0.3, 0.02]];
  const r0 = R.r(18, 30), r1 = R.r(40, 80), r2 = R.r(15, 30);
  let t = 0.02;
  while (t < d) {
    const x = t / d, rate = x < 0.5 ? r0 + (r1 - r0) * (x / 0.5) : r1 + (r2 - r1) * ((x - 0.5) / 0.5);
    addModes(o, t, sr, modes, Math.pow(Math.sin(Math.PI * x), 0.6) * R.r(0.6, 1) * 0.3, 0.0003);
    t += R.r(0.85, 1.15) / rate;
  }
  return finish(o, sr, { peak: 0.9 });
}

export function thunder(sr, R) {
  const L = R.r(5, 7), o = buf(L, sr), w = white(R.seed());
  addNoise(o, 0, sr, w, { atk: 0.01, tau: 0.25, f0: 1400, mode: 'lp', amp: 0.35 });
  const n = R.i(3, 5);
  for (let k = 0; k < n; k++) addRumble(o, R.r(0, L * 0.45), sr, w, { tau: R.r(0.6, 1.4), lp: R.r(120, 260), amp: R.r(0.5, 1), atk: R.r(0.1, 0.4), am: 0.7, amRate: R.r(2, 5) });
  return finish(o, sr, { peak: 0.9 });
}
