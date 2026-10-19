// Node-проверка всех рецептов: рендер каждой вариации, пик ≤ 1, не тишина, без NaN, разумная длина, время рендера.
//   node src/audio/test/render-all.mjs [--sr 48000] [--only gun_] [--wav /tmp/dir]
import { CATALOG } from '../catalog.js';
import { makeRand } from '../dsp.js';
import { hashSeed } from '../../core/noise.js';
import { writeFileSync, mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const SR = +opt('sr', '48000'), only = opt('only', ''), wavDir = opt('wav', '');

function stats(ch, sr) {
  let peak = 0, sum = 0, nan = 0, first = -1;
  for (const c of ch) for (let i = 0; i < c.length; i++) {
    const v = c[i];
    if (!Number.isFinite(v)) { nan++; continue; }
    const a = Math.abs(v); if (a > peak) peak = a; sum += v * v;
    if (first < 0 && a > 1e-3) first = i;
  }
  const n = ch[0].length * ch.length;
  return { dur: ch[0].length / sr, peak, rmsDb: 10 * Math.log10(sum / n + 1e-20), nan, onsetMs: first / sr * 1000 };
}

function wav(path, ch, sr) {
  const n = ch[0].length, nc = ch.length, b = Buffer.alloc(44 + n * nc * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * nc * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(nc, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * nc * 2, 28);
  b.writeUInt16LE(nc * 2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * nc * 2, 40);
  for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(ch[c][i] * 32767))), 44 + (i * nc + c) * 2);
  writeFileSync(path, b);
}

let fails = 0, total = 0, totalSec = 0, totalSamples = 0;
const perPri = [0, 0, 0];
const rows = [];
for (const [name, e] of Object.entries(CATALOG)) {
  if (only && !name.startsWith(only)) continue;
  const sr = e.half ? Math.round(SR / 2) : SR;
  for (let vi = 0; vi < e.vars; vi++) {
    const R = makeRand(hashSeed(name + '#' + vi));
    const t0 = performance.now();
    let out = e.make(sr, R, vi, e.vars);
    const ms = performance.now() - t0;
    const ch = Array.isArray(out) ? out : [out];
    const s = stats(ch, sr);
    total += ms; perPri[e.pri] += ms; totalSec += s.dur; totalSamples += ch[0].length * ch.length;
    const bad = [];
    if (s.nan) bad.push('NaN');
    if (s.peak > 1.0) bad.push('peak>1');
    if (s.peak < 0.05 || s.rmsDb < -60) bad.push('silent');
    if (s.dur < 0.03 || s.dur > 12) bad.push('duration');
    if (bad.length) fails++;
    rows.push(`${(name + '#' + vi).padEnd(22)} ${s.dur.toFixed(2).padStart(5)}s peak ${s.peak.toFixed(3)} rms ${s.rmsDb.toFixed(1).padStart(6)}dB onset ${s.onsetMs.toFixed(1).padStart(6)}ms ${ms.toFixed(1).padStart(6)}ms ${bad.join(',')}`);
    if (wavDir && vi === 0) { mkdirSync(wavDir, { recursive: true }); wav(`${wavDir}/${name}.wav`, ch, sr); }
  }
}
console.log(rows.join('\n'));
console.log(`\nrender total ${total.toFixed(0)} ms (pri0 ${perPri[0].toFixed(0)} / pri1 ${perPri[1].toFixed(0)} / pri2 ${perPri[2].toFixed(0)}), audio ${totalSec.toFixed(1)} s, memory ≈ ${(totalSamples * 4 / 1048576).toFixed(1)} MB, fails ${fails}`);
process.exit(fails ? 1 : 0);
