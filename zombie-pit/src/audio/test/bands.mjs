// Энергия по полосам во времени (дБ относительно максимума) — проверка «формы» звука без прослушивания.
//   node src/audio/test/bands.mjs gun_pistol gun_rifle ...
import { CATALOG } from '../catalog.js';
import { makeRand } from '../dsp.js';
import { hashSeed } from '../../core/noise.js';

const SR = 44100, N = 1024;
const BANDS = [[20, 150], [150, 600], [600, 2000], [2000, 6000], [6000, 16000]];
const SLICES = [[0, 0.005], [0.005, 0.02], [0.02, 0.05], [0.05, 0.1], [0.1, 0.2], [0.2, 0.4], [0.4, 0.8], [0.8, 1.6], [1.6, 3.2]];
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) { const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a), h = len >> 1;
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let j = 0; j < h; j++) { const p = i + j, q = p + h, tr = re[q] * cr - im[q] * ci, ti = re[q] * ci + im[q] * cr; re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti; const nc = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nc; } } }
}
for (const name of process.argv.slice(2)) {
  const e = CATALOG[name]; if (!e) { console.log('?', name); continue; }
  const sr = e.half ? SR / 2 : SR;
  let d = e.make(sr, makeRand(hashSeed(name + '#0')), 0, e.vars); if (Array.isArray(d)) d = d[0];
  const rows = [];
  let top = -Infinity;
  for (const [a, b] of SLICES) {
    const s0 = Math.round(a * sr), s1 = Math.min(d.length, Math.round(b * sr));
    if (s0 >= d.length) break;
    const acc = BANDS.map(() => 0); let frames = 0;
    for (let s = s0; s < s1; s += N / 4) {
      const re = new Float64Array(N), im = new Float64Array(N);
      for (let i = 0; i < N; i++) re[i] = (d[s + i - N / 2] || 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)));
      fft(re, im); frames++;
      for (let k = 1; k < N / 2; k++) { const f = k * sr / N, p = re[k] * re[k] + im[k] * im[k]; BANDS.forEach(([lo, hi], bi) => { if (f >= lo && f < hi) acc[bi] += p; }); }
    }
    const db = acc.map((p) => 10 * Math.log10(p / Math.max(1, frames) + 1e-20));
    db.forEach((v) => { if (v > top) top = v; });
    rows.push([`${(a * 1000).toFixed(0)}-${(b * 1000).toFixed(0)}ms`, db]);
  }
  console.log(`\n${name} (${(d.length / sr).toFixed(2)} s) bands: ${BANDS.map(([a, b]) => `${a}-${b}`).join(' | ')}`);
  for (const [lab, db] of rows) console.log(lab.padEnd(12) + db.map((v) => (v - top).toFixed(0).padStart(6)).join(''));
}
