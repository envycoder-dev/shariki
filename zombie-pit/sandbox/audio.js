// Песочница звука. Обычный режим — кнопки для каждого звука (нужен клик для запуска звука).
// ?selftest — автопроверка: безопасность до init(), init(), вызов всех публичных методов (включая голоса),
// замеры живого выхода (пик/RMS/NaN), спектрограммы предрасчитанных буферов и живых фаз → window.__ready = true.
//   node build.mjs --entry sandbox/audio.js --out sandbox/out/audio.html --dev
import * as THREE from 'three';
import { AudioSystem } from '../src/audio/AudioSystem.js';
import { CATALOG } from '../src/audio/catalog.js';

const SELFTEST = /[?&]selftest/.test(location.search);
const audio = new AudioSystem();
window.audio = audio;
const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 400);
camera.position.set(0, 1.7, 22);
camera.lookAt(0, 1.2, 0);
camera.updateMatrixWorld();
let lastT = performance.now();
setInterval(() => { const t = performance.now(); audio.update((t - lastT) / 1000, camera); lastT = t; }, 16);

const css = document.createElement('style');
css.textContent = `html,body{overflow:auto!important;background:#0d1016;color:#cfd6e2;font:13px system-ui,sans-serif}
body{padding:10px 14px} h1{font-size:18px;margin:4px 0 8px} h2{font-size:14px;margin:12px 0 4px;color:#9fb3d1}
button{background:#1d2633;color:#dde6f3;border:1px solid #33455c;border-radius:4px;padding:4px 8px;margin:2px;cursor:pointer}
button:hover{background:#2a3a50} .row{margin:2px 0} label{margin-right:12px} canvas{display:block}
#log{white-space:pre;font:11px monospace;color:#8fa0b8} .page{display:none} .page.on{display:block}`;
document.head.appendChild(css);
const el = (tag, props = {}, parent = document.body) => { const e = Object.assign(document.createElement(tag), props); parent.appendChild(e); return e; };

// ───────────── спектрограмма ─────────────
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang), h = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < h; j++) {
        const a = i + j, b = a + h, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nc = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nc;
      }
    }
  }
}
const STOPS = [[0, 0, 0, 4], [0.2, 40, 11, 84], [0.4, 120, 28, 109], [0.6, 205, 60, 70], [0.8, 248, 145, 20], [1, 252, 255, 164]];
function cmap(v) {
  v = v < 0 ? 0 : v > 1 ? 1 : v;
  for (let i = 1; i < STOPS.length; i++) if (v <= STOPS[i][0]) {
    const a = STOPS[i - 1], b = STOPS[i], t = (v - a[0]) / (b[0] - a[0]);
    return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
  }
  return STOPS[STOPS.length - 1].slice(1);
}
// Колонки спектра (дБ) → картинка. cols: массив Float32Array модулей в дБ по бинам; binHz — ширина бина
function drawCols(g, x, y, w, h, cols, binHz, o) {
  const img = g.createImageData(w, h), fMin = o.fMin || 40, fMax = o.fMax, lin = !!o.lin;
  let top = -Infinity;
  for (const c of cols) for (let i = 0; i < c.length; i++) if (c[i] > top) top = c[i];
  const floor = top - (o.range || 80);
  for (let px = 0; px < w; px++) {
    const c = cols[Math.min(cols.length - 1, Math.floor(px * cols.length / w))];
    if (!c) continue;
    for (let py = 0; py < h; py++) {
      const u = 1 - py / (h - 1), f = lin ? fMin + (fMax - fMin) * u : fMin * Math.pow(fMax / fMin, u);
      const bf = f / binHz, b0 = Math.min(c.length - 2, Math.floor(bf)), fr = bf - b0;
      const db = c[b0] * (1 - fr) + c[b0 + 1] * fr;
      const [r, gg, bb] = cmap((db - floor) / (top - floor));
      const k = (py * w + px) * 4;
      img.data[k] = r; img.data[k + 1] = gg; img.data[k + 2] = bb; img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, x, y);
}
function bufferCols(data, sr, ncols, N) {
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
  const re = new Float32Array(N), im = new Float32Array(N), cols = [];
  const span = Math.max(1, data.length - N);
  for (let c = 0; c < ncols; c++) {
    const s = Math.floor(c * span / Math.max(1, ncols - 1)) - (data.length < N ? 0 : 0);
    for (let i = 0; i < N; i++) { const v = data[s + i]; re[i] = (v || 0) * win[i]; im[i] = 0; }
    fft(re, im);
    const col = new Float32Array(N / 2);
    for (let i = 0; i < N / 2; i++) col[i] = 20 * Math.log10(Math.hypot(re[i], im[i]) / (N / 4) + 1e-9);
    cols.push(col);
  }
  return cols;
}
function stat(data) {
  let peak = 0, sum = 0, nan = 0;
  for (let i = 0; i < data.length; i++) { const v = data[i]; if (!Number.isFinite(v)) { nan++; continue; } const a = Math.abs(v); if (a > peak) peak = a; sum += v * v; }
  return { peak, rms: 10 * Math.log10(sum / data.length + 1e-20), nan };
}

// ───────────── страницы спектрограмм ─────────────
const PAGES = [
  { id: 'weapons', title: 'Оружие и механика', test: (n) => /^(gun_|dry|pistol_|rifle_|shotgun_|grab|switch|knife|grenadePin|grenadeThrow)/.test(n), vars: (n) => (n.startsWith('gun_') ? 3 : 1) },
  { id: 'world', title: '3D: попадания, плоть, гильзы, взрыв, зомби', test: (n) => /^(imp_|ricochet|flesh|gore|body|casing_|grenadeBounce|explosion|zstep|rimScrape|acid)/.test(n), vars: (n) => (n === 'explosion' ? 2 : 1) },
  { id: 'player', title: 'Игрок, интерфейс, музыка, окружение', test: (n) => /^(step_|gear|jump|land|hb_|player_|hm_|ui_|pick_|wave_|boss_|mus_|amb_)/.test(n), vars: (n) => (n === 'player_hurt' ? 3 : 1) },
  { id: 'voices', title: 'Голоса зомби (линейная шкала 0–5 кГц: гармоники и форманты)', test: (n) => n.startsWith('vox_'), vars: () => 1, lin: true },
];
const pageEls = [];
function showPage(k) { pageEls.forEach((p, i) => p.classList.toggle('on', i === k)); window.scrollTo(0, 0); }
window.showPage = showPage;

function drawBufferPage(page, root) {
  const items = [];
  for (const { name, vi, buffer } of audio.bank.list()) if (page.test(name) && vi < page.vars(name)) items.push({ name, vi, buffer });
  items.sort((a, b) => Object.keys(CATALOG).indexOf(a.name) - Object.keys(CATALOG).indexOf(b.name) || a.vi - b.vi);
  const W = 1580, cw = 194, ch = 92, lh = 26, perRow = Math.floor(W / (cw + 3));
  const rows = Math.ceil(items.length / perRow);
  const cv = el('canvas', { width: W, height: rows * (ch + lh) + 6 }, root);
  const g = cv.getContext('2d');
  g.fillStyle = '#0d1016'; g.fillRect(0, 0, cv.width, cv.height);
  g.font = '11px monospace';
  const out = [];
  items.forEach((it, i) => {
    const x = (i % perRow) * (cw + 3), y = Math.floor(i / perRow) * (ch + lh);
    const d = it.buffer.getChannelData(0), sr = it.buffer.sampleRate, s = stat(d);
    const N = page.lin ? 1024 : 512;
    drawCols(g, x, y + lh, cw, ch, bufferCols(d, sr, cw, N), sr / N, page.lin ? { lin: true, fMin: 0, fMax: 5000, range: 75 } : { fMin: 40, fMax: Math.min(16000, sr / 2), range: 85 });
    g.fillStyle = '#dfe7f2'; g.fillText(`${it.name}#${it.vi}`, x + 2, y + 11);
    g.fillStyle = '#8fa0b8'; g.fillText(`${it.buffer.duration.toFixed(2)}s pk ${s.peak.toFixed(2)} ${s.rms.toFixed(0)}dB`, x + 2, y + 23);
    out.push({ name: it.name + '#' + it.vi, dur: +it.buffer.duration.toFixed(3), peak: +s.peak.toFixed(3), rmsDb: +s.rms.toFixed(1), nan: s.nan });
  });
  return out;
}

// ───────────── замер живого выхода ─────────────
const live = { phases: [], cur: null };
let anOut = null, anPre = null, timer = 0;
function startProbe() {
  const c = audio.ctx;
  anOut = c.createAnalyser(); anOut.fftSize = 2048; anOut.smoothingTimeConstant = 0;
  anPre = c.createAnalyser(); anPre.fftSize = 2048; anPre.smoothingTimeConstant = 0;
  audio.output.connect(anOut);
  audio.limiter.connect(anPre);
  const td = new Float32Array(2048), tp = new Float32Array(2048);
  timer = setInterval(() => {
    const ph = live.cur;
    if (!ph) return;
    anOut.getFloatTimeDomainData(td); anPre.getFloatTimeDomainData(tp);
    let pk = 0, sum = 0, nan = 0, pkPre = 0;
    for (let i = 0; i < td.length; i++) { const v = td[i]; if (!Number.isFinite(v)) { nan++; continue; } const a = Math.abs(v); if (a > pk) pk = a; sum += v * v; const b = Math.abs(tp[i]); if (b > pkPre) pkPre = b; }
    ph.peak = Math.max(ph.peak, pk); ph.peakPre = Math.max(ph.peakPre, pkPre); ph.sum += sum; ph.n += td.length; ph.nan += nan;
    ph.maxRms = Math.max(ph.maxRms, Math.sqrt(sum / td.length));
    ph.redMax = Math.max(ph.redMax, -audio.limiter.reduction);
    const col = new Float32Array(anOut.frequencyBinCount);
    anOut.getFloatFrequencyData(col);
    for (let i = 0; i < col.length; i++) if (!Number.isFinite(col[i])) col[i] = -160;
    ph.cols.push(col);
    ph.maxActive = Math.max(ph.maxActive, audio._active.length);
    ph.maxVocal = Math.max(ph.maxVocal, audio._vocal.length);
  }, 25);
}
function phase(name) {
  if (live.cur) live.phases.push(live.cur);
  live.cur = name ? { name, peak: 0, peakPre: 0, sum: 0, n: 0, nan: 0, maxRms: 0, redMax: 0, cols: [], maxActive: 0, maxVocal: 0 } : null;
}
function drawLivePage(root) {
  const W = 1580, cw = 520, ch = 120, lh = 28, perRow = 3;
  const P = live.phases, rows = Math.ceil(P.length / perRow);
  const cv = el('canvas', { width: W, height: rows * (ch + lh) + 6 }, root);
  const g = cv.getContext('2d');
  g.fillStyle = '#0d1016'; g.fillRect(0, 0, cv.width, cv.height); g.font = '11px monospace';
  const sr = audio.ctx.sampleRate;
  P.forEach((p, i) => {
    const x = (i % perRow) * (cw + 8), y = Math.floor(i / perRow) * (ch + lh);
    if (p.cols.length) drawCols(g, x, y + lh, cw, ch, p.cols, sr / 2048, { fMin: 30, fMax: 16000, range: 90 });
    g.fillStyle = '#dfe7f2'; g.fillText(`live: ${p.name}`, x + 2, y + 11);
    g.fillStyle = '#8fa0b8';
    g.fillText(`out pk ${p.peak.toFixed(3)} rms ${(10 * Math.log10(p.sum / Math.max(1, p.n) + 1e-20)).toFixed(1)}dB | pre-clip pk ${p.peakPre.toFixed(2)} | GR ${p.redMax.toFixed(1)}dB | act ${p.maxActive} voc ${p.maxVocal}`, x + 2, y + 24);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ───────────── самопроверка ─────────────
const ALL_METHODS = ['init', 'resume', 'suspend', 'setVolumes', 'update', 'weaponFire', 'weaponDry', 'weaponSwitch', 'weaponReload',
  'knifeSwing', 'knifeHit', 'grenadePin', 'grenadeThrow', 'footstep', 'jump', 'land', 'playerHurt', 'playerDeath', 'heartbeat',
  'hitMarker', 'uiHover', 'uiClick', 'buy', 'denied', 'pickup', 'waveStart', 'waveClear', 'bossIntro', 'setIntensity', 'explosion',
  'bulletImpact', 'fleshHit', 'gore', 'bodyFall', 'shellCasing', 'grenadeBounce', 'zombieStep', 'rimScrape', 'acidSpit', 'acidSplash', 'createVoice'];

async function selftest() {
  const errors = [], log = (...a) => console.log('[selftest]', ...a), fail = (m) => { errors.push(m); console.error('[selftest] FAIL ' + m); };
  el('h1', { textContent: 'ЯМА — звук: самопроверка' });
  const info = el('div', { id: 'log' });

  // 1) до init(): все методы — без исключений и без эффекта
  const pre = new AudioSystem();
  const weird = [undefined, null, NaN, 'x', -5, 99, {}, V(NaN, 0, 0)];
  let preThrows = 0;
  for (const m of ALL_METHODS) {
    if (m === 'init') continue;
    for (const a of weird) { try { pre[m](a, a, a); } catch { preThrows++; } }
  }
  const pv = pre.createVoice('walker', 1);
  for (const m of ['setPosition', 'groan', 'attack', 'scream', 'pain', 'death', 'spit', 'stop', 'dispose']) { try { pv[m](V(1, 2, 3)); } catch { preThrows++; } }
  if (preThrows) fail(`pre-init throws: ${preThrows}`); else log('pre-init: all public methods are safe no-ops');
  if (pre.ctx) fail('pre-init created a context');

  // 2) init()
  const t0 = performance.now();
  audio.init();
  const initWall = performance.now() - t0;
  audio.init(); // повторный вызов безопасен
  log(`init(): ${initWall.toFixed(0)} ms wall, sync render ${audio.bank.ms.sync.toFixed(0)} ms, ctx ${audio.ctx.state} @ ${audio.ctx.sampleRate} Hz, rendered ${audio.bank.rendered}/${audio.bank.total}`);
  if (initWall > 1500) fail(`init too slow: ${initWall.toFixed(0)} ms`);
  startProbe();
  const tb = performance.now();
  await Promise.race([audio.bank.done, sleep(30000)]);
  log(`background render done in ${(performance.now() - tb).toFixed(0)} ms wall (bg ${audio.bank.ms.bg.toFixed(0)} ms cpu, lazy ${audio.bank.ms.lazy.toFixed(0)} ms), ${audio.bank.rendered}/${audio.bank.total}`);
  if (audio.bank.pending) fail('bank not complete');

  // 3) живые фазы
  phase('ambience + music@0'); await sleep(3500);
  phase('pistol: 4 shots + reload + casings');
  for (let i = 0; i < 4; i++) { audio.weaponFire('pistol'); setTimeout(() => audio.shellCasing(V(0.6, 0.1, 21.5), 'pistol'), 380); await sleep(380); }
  audio.weaponDry(); await sleep(250);
  for (const s of ['magOut', 'magIn', 'slide']) { audio.weaponReload('pistol', s); await sleep(400); }
  phase('shotgun: 3 shots + pump + shells');
  for (let i = 0; i < 3; i++) { audio.weaponFire('shotgun'); await sleep(450); audio.weaponReload('shotgun', 'pump'); setTimeout(() => audio.shellCasing(V(0.7, 0.1, 21.6), 'shotgun'), 300); await sleep(450); }
  for (let i = 0; i < 2; i++) { audio.weaponReload('shotgun', 'shellIn'); await sleep(450); }
  phase('rifle full-auto 10/s x 30');
  for (let i = 0; i < 30; i++) { audio.weaponFire('rifle'); if (i % 2 === 0) setTimeout(() => audio.shellCasing(V(0.6 + Math.random() * 0.5, 0.05, 21.4), 'rifle'), 350); await sleep(100); }
  await sleep(900);
  for (const s of ['magOut', 'magIn', 'bolt', 'grab']) { audio.weaponReload('rifle', s); await sleep(350); }
  audio.weaponSwitch(); await sleep(400);
  phase('impacts / flesh / gore / grenade / explosion');
  const surf = ['dirt', 'wood', 'metal', 'rock', 'concrete', 'sandbag', 'grass', 'metal', 'metal'];
  for (let i = 0; i < surf.length; i++) { audio.bulletImpact(V(-8 + i * 2, 0, 10 - i), surf[i]); await sleep(170); }
  audio.fleshHit(V(2, 1.5, 15), false); await sleep(250); audio.fleshHit(V(-2, 1.7, 14), true); await sleep(300);
  audio.gore(V(1, 1, 13)); await sleep(350); audio.bodyFall(V(1, 0, 13), false); await sleep(500); audio.bodyFall(V(-3, 0, 12), true); await sleep(500);
  audio.knifeSwing(); await sleep(250); audio.knifeHit(); await sleep(400);
  audio.grenadePin(); await sleep(400); audio.grenadeThrow(); await sleep(500);
  audio.grenadeBounce(V(0, 0, 14)); await sleep(350); audio.grenadeBounce(V(0, 0, 12)); await sleep(500);
  audio.explosion(V(0, 0.3, 10)); await sleep(2200);
  phase('zombie world sounds (steps, rim scrape, acid)');
  for (let i = 0; i < 12; i++) { audio.zombieStep(V(Math.sin(i) * 6, 0, 12 + Math.cos(i) * 4), i % 5 === 0); await sleep(120); }
  audio.rimScrape(V(-6, 0, 9)); await sleep(500); audio.rimScrape(V(7, 0, 8)); await sleep(700);
  audio.acidSpit(V(-3, 1.6, 12)); await sleep(500); audio.acidSplash(V(0, 0, 18)); await sleep(1400);
  phase('zombie voices (10 voices, cap 6)');
  const types = ['walker', 'runner', 'crawler', 'brute', 'spitter', 'bloater', 'boss', 'walker', 'runner', 'walker'];
  const voices = types.map((t, i) => { const v = audio.createVoice(t, i * 17 + 3); v.setPosition(V(Math.cos(i) * (6 + i), 1.5, 12 + Math.sin(i) * 5)); return v; });
  voices.forEach((v) => v.groan());
  await sleep(60);
  const vocalAfterGroan = audio._vocal.length;
  if (vocalAfterGroan > 6) fail(`vocal cap exceeded: ${vocalAfterGroan}`);
  await sleep(2200);
  for (let k = 0; k < 6; k++) {
    for (let i = 0; i < voices.length; i++) { const v = voices[i]; v.setPosition(V(Math.cos(i + k) * (5 + i), 1.5, 12 + Math.sin(i + k) * 5)); }
    const v = voices[k % voices.length];
    [() => v.attack(), () => v.scream(), () => v.pain(), () => v.spit(), () => v.groan(), () => v.death()][k]();
    await sleep(700);
  }
  voices[6].scream(); await sleep(1200); voices[3].scream(); await sleep(1200); voices[1].scream(); await sleep(900);
  voices[2].death(); voices[5].death(); await sleep(1500);
  voices.forEach((v) => v.stop()); voices.forEach((v) => v.dispose()); voices[0].groan(); // после dispose — без эффекта
  await sleep(300);
  phase('player: steps, jump, land, hurt, heartbeat, death');
  for (const s of ['grass', 'dirt', 'concrete', 'wood']) for (let i = 0; i < 3; i++) { audio.footstep(s, i / 2); await sleep(i === 2 ? 280 : 380); }
  audio.jump(); await sleep(500); audio.land(0.3); await sleep(500); audio.land(1); await sleep(600);
  audio.playerHurt(0.2); await sleep(500); audio.playerHurt(0.9); await sleep(600);
  audio.heartbeat(0.4); await sleep(2200); audio.heartbeat(1); await sleep(2200); audio.heartbeat(0); await sleep(300);
  audio.playerDeath(); await sleep(2600);
  phase('ui + hit markers + stingers');
  audio.uiHover(); await sleep(200); audio.uiClick(); await sleep(300); audio.buy(); await sleep(800); audio.denied(); await sleep(500);
  for (const k of ['ammo', 'health', 'money']) { audio.pickup(k); await sleep(600); }
  for (const k of ['hit', 'kill', 'headshot']) { audio.hitMarker(k); await sleep(400); }
  audio.waveStart(3); await sleep(4200); audio.waveClear(); await sleep(2500); audio.bossIntro(); await sleep(3500);
  phase('music intensity 0.5'); audio.setIntensity(0.5); await sleep(5000);
  phase('music intensity 1.0 + rifle bursts'); audio.setIntensity(1);
  for (let b = 0; b < 3; b++) { await sleep(1300); for (let i = 0; i < 6; i++) { audio.weaponFire('rifle'); await sleep(100); } }
  await sleep(1500);
  phase(null);
  audio.setIntensity(0);

  // 4) suspend: вызовы не должны копиться; resume
  audio.suspend(); await sleep(200);
  const actBefore = audio._active.length;
  audio.weaponFire('rifle'); audio.explosion(V(0, 0, 5)); audio.footstep('dirt', 1); const sv = audio.createVoice('runner', 5); sv.setPosition(V(1, 1, 20)); sv.scream();
  if (audio._active.length !== actBefore || audio._vocal.length) fail('sounds queued while suspended');
  log(`suspended: ctx ${audio.ctx.state}, queued ${audio._active.length - actBefore}`);
  audio.resume(); await sleep(400);
  log(`resumed: ctx ${audio.ctx.state}`);
  if (audio.ctx.state !== 'running') fail('resume failed');
  // крайние значения громкостей
  audio.setVolumes({ master: 2, sfx: -1, music: NaN }); const vv = { ...audio.volumes };
  audio.setVolumes({ master: 0.85, sfx: 1, music: 0.6 });
  if (vv.master !== 1 || vv.sfx !== 0 || vv.music !== 0.6) fail('setVolumes clamp ' + JSON.stringify(vv));
  // мусорные аргументы после init
  let postThrows = 0;
  for (const m of ALL_METHODS) for (const a of weird) { if (m === 'init' || m === 'suspend') continue; try { audio[m](a, a, a); } catch { postThrows++; } }
  audio.resume(); audio.heartbeat(0); audio.setIntensity(0);
  if (postThrows) fail('post-init throws ' + postThrows);

  // 5) проверки фаз
  for (const p of live.phases) {
    const rms = 10 * Math.log10(p.sum / Math.max(1, p.n) + 1e-20);
    log(`phase "${p.name}": out peak ${p.peak.toFixed(3)}, rms ${rms.toFixed(1)} dB, max win rms ${(20 * Math.log10(p.maxRms + 1e-9)).toFixed(1)} dB, pre-clip peak ${p.peakPre.toFixed(3)}, limiter GR max ${p.redMax.toFixed(1)} dB, active ${p.maxActive}, vocal ${p.maxVocal}, NaN ${p.nan}`);
    if (p.nan) fail(`NaN in "${p.name}"`);
    if (p.peak > 1.0) fail(`clipping in "${p.name}"`);
    if (rms < -75) fail(`silent phase "${p.name}"`);
    if (p.maxVocal > 6) fail(`vocal cap in "${p.name}"`);
    if (p.maxActive > 32) fail(`one-shot cap in "${p.name}"`);
  }

  // 6) буферы: статистика + спектрограммы
  const pages = el('div');
  const stats = [];
  PAGES.forEach((pg) => {
    const d = el('div', { className: 'page' }, pages);
    el('h2', { textContent: pg.title }, d);
    stats.push(...drawBufferPage(pg, d));
    pageEls.push(d);
  });
  const ld = el('div', { className: 'page' }, pages);
  el('h2', { textContent: 'Живой выход (AnalyserNode после лимитера и клиппера), лог-шкала 30 Гц–16 кГц' }, ld);
  drawLivePage(ld);
  pageEls.push(ld);
  let bad = 0;
  for (const s of stats) if (s.nan || s.peak > 1 || s.peak < 0.05 || s.dur < 0.03) { bad++; fail('buffer ' + JSON.stringify(s)); }
  const all = audio.bank.list();
  let mem = 0; for (const b of all) mem += b.buffer.length * b.buffer.numberOfChannels * 4;
  log(`buffers: ${all.length} rendered (${(mem / 1048576).toFixed(1)} MB), drawn ${stats.length}, bad ${bad}`);
  info.textContent = `init ${initWall.toFixed(0)} ms | buffers ${all.length} | errors ${errors.length}\n` + live.phases.map((p) => `${p.name}: peak ${p.peak.toFixed(3)} pre ${p.peakPre.toFixed(2)} GR ${p.redMax.toFixed(1)}dB act ${p.maxActive} voc ${p.maxVocal}`).join('\n');
  showPage(0);
  log(errors.length ? `FAILED (${errors.length})` : 'ALL CHECKS PASSED');
  window.__selftest = { errors, initWall, stats };
  window.__ready = true;
}

// ───────────── ручной режим ─────────────
function manual() {
  el('h1', { textContent: 'ЯМА — звук (песочница)' });
  const top = el('div', { className: 'row' });
  el('button', { textContent: '▶ Включить звук (init)', onclick: () => audio.init() }, top);
  el('button', { textContent: 'pause', onclick: () => audio.suspend() }, top);
  el('button', { textContent: 'resume', onclick: () => audio.resume() }, top);
  const slider = (label, min, max, val, on) => { const l = el('label', { textContent: label + ' ' }, top); const s = el('input', { type: 'range', min, max, step: 0.01, value: val }, l); s.oninput = () => on(+s.value); };
  slider('master', 0, 1, 0.85, (v) => audio.setVolumes({ master: v }));
  slider('sfx', 0, 1, 1, (v) => audio.setVolumes({ sfx: v }));
  slider('music', 0, 1, 0.6, (v) => audio.setVolumes({ music: v }));
  slider('intensity', 0, 1, 0, (v) => audio.setIntensity(v));
  slider('heartbeat', 0, 1, 0, (v) => audio.heartbeat(v));
  const pos = { az: 0, d: 6 };
  const p3 = el('div', { className: 'row' });
  const sl3 = (label, min, max, val, on) => { const l = el('label', { textContent: label + ' ' }, p3); const s = el('input', { type: 'range', min, max, step: 1, value: val }, l); s.oninput = () => on(+s.value); };
  sl3('3D азимут°', -180, 180, 0, (v) => { pos.az = v; });
  sl3('3D дистанция м', 1, 80, 6, (v) => { pos.d = v; });
  const P = () => { const a = pos.az * Math.PI / 180; return V(Math.sin(a) * pos.d, 1, 22 - Math.cos(a) * pos.d); };
  const group = (title, list) => { el('h2', { textContent: title }); const r = el('div', { className: 'row' }); for (const [t, f] of list) el('button', { textContent: t, onclick: f }, r); };
  group('Оружие', [['pistol', () => audio.weaponFire('pistol')], ['shotgun', () => audio.weaponFire('shotgun')], ['rifle', () => audio.weaponFire('rifle')],
    ['rifle auto ×15', async () => { for (let i = 0; i < 15; i++) { audio.weaponFire('rifle'); await sleep(100); } }], ['dry', () => audio.weaponDry()], ['switch', () => audio.weaponSwitch()],
    ...['magOut', 'magIn', 'slide', 'bolt', 'shellIn', 'pump', 'grab'].flatMap((s) => ['pistol', 'rifle', 'shotgun'].map((w) => [`${w} ${s}`, () => audio.weaponReload(w, s)])),
    ['knife swing', () => audio.knifeSwing()], ['knife hit', () => audio.knifeHit()], ['grenade pin', () => audio.grenadePin()], ['grenade throw', () => audio.grenadeThrow()]]);
  group('3D (позиция — слайдеры выше)', [...['dirt', 'wood', 'metal', 'rock', 'concrete', 'sandbag'].map((s) => ['impact ' + s, () => audio.bulletImpact(P(), s)]),
    ['flesh', () => audio.fleshHit(P(), false)], ['headshot', () => audio.fleshHit(P(), true)], ['gore', () => audio.gore(P())], ['body fall', () => audio.bodyFall(P(), false)], ['body heavy', () => audio.bodyFall(P(), true)],
    ...['pistol', 'rifle', 'shotgun'].map((k) => ['casing ' + k, () => audio.shellCasing(P(), k)]), ['grenade bounce', () => audio.grenadeBounce(P())], ['explosion', () => audio.explosion(P())],
    ['zombie step', () => audio.zombieStep(P(), false)], ['brute step', () => audio.zombieStep(P(), true)], ['rim scrape', () => audio.rimScrape(P())], ['acid spit', () => audio.acidSpit(P())], ['acid splash', () => audio.acidSplash(P())]]);
  group('Игрок', [...['grass', 'dirt', 'concrete', 'wood'].flatMap((s) => [[`step ${s}`, () => audio.footstep(s, 0.3)], [`run ${s}`, () => audio.footstep(s, 1)]]),
    ['jump', () => audio.jump()], ['land soft', () => audio.land(0.3)], ['land hard', () => audio.land(1)], ['hurt light', () => audio.playerHurt(0.2)], ['hurt heavy', () => audio.playerHurt(1)], ['death', () => audio.playerDeath()]]);
  group('Интерфейс', [['hover', () => audio.uiHover()], ['click', () => audio.uiClick()], ['buy', () => audio.buy()], ['denied', () => audio.denied()],
    ...['ammo', 'health', 'money'].map((k) => ['pickup ' + k, () => audio.pickup(k)]), ...['hit', 'kill', 'headshot'].map((k) => ['hitmarker ' + k, () => audio.hitMarker(k)]),
    ['wave start', () => audio.waveStart(3)], ['wave clear', () => audio.waveClear()], ['boss intro', () => audio.bossIntro()]]);
  const vs = {};
  const voice = (t) => { vs[t] = vs[t] || audio.createVoice(t, Math.floor(Math.random() * 1000)); vs[t].setPosition(P()); return vs[t]; };
  for (const t of ['walker', 'runner', 'crawler', 'brute', 'spitter', 'bloater', 'boss']) {
    group('Голос: ' + t, ['groan', 'attack', 'scream', 'pain', 'death', 'spit', 'stop'].map((a) => [a, () => voice(t)[a]()]).concat([['новый голос', () => { if (vs[t]) vs[t].dispose(); vs[t] = null; voice(t).groan(); }]]));
  }
  el('div', { id: 'log' });
  setInterval(() => { document.getElementById('log').textContent = JSON.stringify(audio.stats()); }, 500);
  window.__ready = true;
}

if (SELFTEST) selftest().catch((e) => { console.error('[selftest] crashed', e && e.stack ? e.stack : e); window.__ready = true; });
else manual();
