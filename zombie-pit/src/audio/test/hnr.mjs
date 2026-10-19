// Периодичность голосов: нормированная автокорреляция → HNR (дБ) и средняя f0 по кадрам 40 мс.
//   node src/audio/test/hnr.mjs vox_walker_groan vox_brute_scream ...
import { CATALOG } from '../catalog.js';
import { makeRand } from '../dsp.js';
import { hashSeed } from '../../core/noise.js';
const SR = 44100;
for (const name of process.argv.slice(2)) {
  const e = CATALOG[name]; const sr = e.half ? SR / 2 : SR;
  const res = [];
  for (let vi = 0; vi < e.vars; vi++) {
    let d = e.make(sr, makeRand(hashSeed(name + '#' + vi)), vi, e.vars); if (Array.isArray(d)) d = d[0];
    const F = Math.round(0.04 * sr), lo = Math.round(sr / 600), hi = Math.round(sr / 30);
    let emax = 0; const fr = [];
    for (let s = 0; s + F + hi < d.length; s += F >> 1) { let en = 0; for (let i = 0; i < F; i++) en += d[s + i] * d[s + i]; fr.push([s, en]); emax = Math.max(emax, en); }
    let hs = 0, n = 0, f0s = 0;
    for (const [s, en] of fr) {
      if (en < emax * 0.05) continue;
      let best = 0, bl = 0;
      for (let L = lo; L <= hi; L++) { let num = 0, a = 0, b = 0; for (let i = 0; i < F; i++) { const x = d[s + i], y = d[s + i + L]; num += x * y; a += x * x; b += y * y; } const r = num / Math.sqrt(a * b + 1e-12); if (r > best) { best = r; bl = L; } }
      const r = Math.min(0.999, Math.max(1e-3, best)); hs += 10 * Math.log10(r / (1 - r)); f0s += sr / bl; n++;
    }
    res.push(`#${vi}: HNR ${(hs / n).toFixed(1)} dB f0≈${(f0s / n).toFixed(0)}`);
  }
  console.log(name.padEnd(22), res.join(' | '));
}
