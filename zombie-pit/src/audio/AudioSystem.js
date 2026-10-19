// Звук «ЯМЫ»: всё синтезируется (WebAudio + генерация отсчётов в JS), без файлов и сети.
// Публичные методы безопасны до init(), при приостановленном контексте и никогда не бросают исключений.
//
// Граф:  источники → sfxBus ─┐
//        реверб/эхо-возвраты ─┼→ sfxVol ─┐
//        ambBus → ambDuck ────┘          ├→ master → лимитер → мягкий клиппер → выход
//        musicBus → musDuck → musicVol ──┘
import { SoundBank } from './bank.js';
import { Ambience } from './ambience.js';
import { Music } from './music.js';
import { ZombieVoice, VOICE_PRIO } from './voice.js';
import { white } from './dsp.js';

export const MAX_ONESHOTS = 32;   // одновременных разовых звуков
export const MAX_VOCAL = 6;       // одновременно говорящих зомби
export const MAX_HRTF = 20;       // дальше — дешёвый equalpower для неважных звуков
export const REF_DIST = 2.5, MAX_DIST = 80, ROLLOFF = 1.1;
const SYNC_BUDGET_MS = 450;      // синхронный рендер в init(): выстрелы, механика, шаги, интерфейс

const clamp01 = (v) => (v > 0 ? (v < 1 ? v : 1) : 0); // NaN → 0
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const nowMs = () => performance.now();
const distGain = (d) => REF_DIST / (REF_DIST + ROLLOFF * (Math.max(d, REF_DIST) - REF_DIST));
const revDist = (d) => REF_DIST / (REF_DIST + 0.3 * Math.max(0, d - REF_DIST)); // реверб гаснет медленнее прямого звука
const airCutoff = (d) => Math.max(1800, 20000 / (1 + d / 14));                 // воздух глушит верх на расстоянии

// Лимиты одновременных копий по ключу (сверх — вытесняется самая слабая/старая)
const POLY = {
  gun_pistol: 4, gun_rifle: 5, gun_shotgun: 3, mech: 4, knife: 2, grenade: 3, casing: 6, imp: 10, ricochet: 3,
  flesh: 6, gore: 4, body: 4, zstep: 8, scrape: 4, acid: 4, explosion: 4, step: 3, player: 1, player2: 2,
  ui: 4, hm: 3, hb: 4, stinger: 3,
};
const GUN_GAIN = { pistol: 0.85, shotgun: 1, rifle: 0.8 };
const HM_GAIN = { hit: 0.3, kill: 0.42, headshot: 0.45 };
const VOICE_GAIN = { groan: 0.6, attack: 0.85, scream: 1, pain: 0.7, death: 0.85, spit: 0.7 };
const TYPE_GAIN = { walker: 1, runner: 1, crawler: 0.9, brute: 1.15, spitter: 0.95, bloater: 1, boss: 1.3 };
const IMPACT = { dirt: 'imp_dirt', grass: 'imp_dirt', mud: 'imp_dirt', wood: 'imp_wood', metal: 'imp_metal', rock: 'imp_rock', stone: 'imp_rock', concrete: 'imp_concrete', sandbag: 'imp_sandbag', sand: 'imp_sandbag' };
const STEPS = { grass: 'step_grass', dirt: 'step_dirt', concrete: 'step_concrete', wood: 'step_wood', rock: 'step_concrete', metal: 'step_concrete', sand: 'step_dirt', mud: 'step_dirt' };
const RELOAD = {
  pistol: { magOut: 'pistol_magOut', magIn: 'pistol_magIn', slide: 'pistol_slide', bolt: 'pistol_slide', shellIn: 'shotgun_shellIn', pump: 'shotgun_pump', grab: 'grab' },
  rifle: { magOut: 'rifle_magOut', magIn: 'rifle_magIn', slide: 'rifle_bolt', bolt: 'rifle_bolt', shellIn: 'shotgun_shellIn', pump: 'shotgun_pump', grab: 'grab' },
  shotgun: { magOut: 'shotgun_shellIn', magIn: 'shotgun_shellIn', slide: 'shotgun_pump', bolt: 'shotgun_pump', shellIn: 'shotgun_shellIn', pump: 'shotgun_pump', grab: 'grab' },
};

export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.bank = null;
    this.volumes = { master: 0.85, sfx: 1, music: 0.6 };
    this.initMs = 0;
    this._paused = false;
    this._active = [];   // разовые звуки
    this._vocal = [];    // реплики зомби
    this._hrtf = 0;
    this._lx = 0; this._ly = 1.7; this._lz = 0;
    this._hbLevel = 0; this._hbNext = 0;
    this._intensity = 0;
    this._lastHurt = -1;
    this._warned = new Set();
    this._initT = 0;
  }

  // ───────────── жизненный цикл ─────────────
  init() {
    if (this.ctx) { if (!this._paused) this._resumeCtx(); return; }
    const AC = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
    if (!AC) return;
    const t0 = nowMs();
    this._initT = t0;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this._buildGraph();
    this.bank = new SoundBank(ctx);
    this.bank.renderSync(0, SYNC_BUDGET_MS);
    this.ambience = new Ambience(this);
    this.music = new Music(this);
    this.music.setIntensity(this._intensity);
    this.ready = true;
    this.ambience.start();
    this.music.start();
    this.bank.startBackground();
    this.initMs = nowMs() - t0;
    if (ctx.state !== 'running') { this._resumeCtx(); this._armGesture(); }
  }

  resume() { this._paused = false; this._resumeCtx(); }

  suspend() {
    this._paused = true;
    const c = this.ctx;
    if (c && c.state === 'running') c.suspend().catch(() => {});
  }

  setVolumes(v) {
    if (!v || typeof v !== 'object') return;
    const V = this.volumes;
    if (v.master !== undefined) V.master = clamp01(num(+v.master, V.master));
    if (v.sfx !== undefined) V.sfx = clamp01(num(+v.sfx, V.sfx));
    if (v.music !== undefined) V.music = clamp01(num(+v.music, V.music));
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(V.master, t, 0.03);
    this.sfxVol.gain.setTargetAtTime(V.sfx, t, 0.03);
    this.musicVol.gain.setTargetAtTime(V.music, t, 0.03);
  }

  update(dt, camera) {
    if (!this.ready) return;
    if (camera) this._listener(camera);
    if (this._paused) return;
    this._prune(this.ctx.currentTime);
    this.ambience.update(dt);
    this.music.update(dt);
    if (this._hbLevel > 0) this._heartbeat();
  }

  // ───────────── 2D: оружие ─────────────
  weaponFire(id) {
    if (id === 'knife') { this.knifeSwing(); return; }
    if (id === 'grenade') { this.grenadeThrow(); return; }
    const k = id === 'shotgun' || id === 'rifle' ? id : 'pistol', name = 'gun_' + k;
    const v = this._play(name, { gain: GUN_GAIN[k], jit: 0.06, rev: 0.22, echo: k === 'shotgun' ? 0.55 : 0.42, key: name, prio: 4, duckPrev: true });
    if (v) this._duck(k === 'shotgun' ? 0.4 : 0.55, 0.1, 0.45);
  }
  weaponDry() { this._play('dry', { gain: 0.45, jit: 0.05, rev: 0.03, key: 'mech', prio: 2 }); }
  weaponSwitch() { this._play('switch', { gain: 0.5, jit: 0.05, rev: 0.04, key: 'mech', prio: 2 }); }
  weaponReload(id, step) {
    const map = RELOAD[id] || RELOAD.pistol, name = map[step];
    if (name) this._play(name, { gain: 0.55, jit: 0.04, rev: 0.05, key: 'mech', prio: 2 });
  }
  knifeSwing() { this._play('knifeSwing', { gain: 0.55, jit: 0.08, rev: 0.04, key: 'knife', prio: 2 }); }
  knifeHit() { this._play('knifeHit', { gain: 0.75, jit: 0.06, rev: 0.08, key: 'knife', prio: 3 }); }
  grenadePin() { this._play('grenadePin', { gain: 0.5, jit: 0.04, rev: 0.06, key: 'grenade', prio: 2 }); }
  grenadeThrow() { this._play('grenadeThrow', { gain: 0.55, jit: 0.06, rev: 0.05, key: 'grenade', prio: 2 }); }

  // ───────────── 2D: игрок ─────────────
  footstep(surface, speed01) {
    const s = clamp01(num(speed01, 0.5));
    this._play(STEPS[surface] || 'step_dirt', { gain: 0.2 + 0.25 * s, rate: 0.97 + 0.07 * s, jit: 0.05, rev: 0.04, key: 'step', prio: 1 });
    if (s > 0.7 && Math.random() < 0.35) this._play('gear', { gain: 0.1 + 0.1 * s, jit: 0.08, rev: 0.02, key: 'step', prio: 0.5 });
  }
  jump() { this._play('jump', { gain: 0.42, jit: 0.05, rev: 0.03, key: 'player2', prio: 1.5 }); }
  land(intensity) {
    const i = clamp01(num(intensity, 0.5));
    this._play('land', { gain: 0.25 + 0.5 * i, rate: 1.06 - 0.12 * i, jit: 0.04, rev: 0.05, key: 'player2', prio: 1.5 });
    if (i > 0.65) this._play('player_hurt', { vi: 0, gain: 0.3 * i, jit: 0.05, rev: 0.03, key: 'player', prio: 2 });
  }
  playerHurt(intensity) {
    const i = clamp01(num(intensity, 0.5)), t = nowMs();
    if (t - this._lastHurt < 180) return;
    this._lastHurt = t;
    const vi = Math.min(5, Math.floor(i * 4.2) + (Math.random() < 0.5 ? 1 : 0));
    this._play('player_hurt', { vi, gain: 0.55 + 0.35 * i, jit: 0.04, rev: 0.04, key: 'player', prio: 4 });
  }
  playerDeath() {
    this._play('player_death', { gain: 0.9, jit: 0.02, rev: 0.1, key: 'player', prio: 5 });
    this._play('body', { gain: 0.6, delay: 1.25, jit: 0.04, rev: 0.06, key: 'body', prio: 3 });
    if (this.ready) this._duck(0.4, 2.5, 1.5);
  }
  heartbeat(intensity) {
    const v = clamp01(num(intensity, 0));
    this._hbLevel = v;
    if (v > 0 && this.ready && this._hbNext < this.ctx.currentTime) this._hbNext = this.ctx.currentTime + 0.05;
  }

  // ───────────── 2D: интерфейс и игра ─────────────
  hitMarker(kind) {
    const k = kind === 'kill' || kind === 'headshot' ? kind : 'hit';
    this._play('hm_' + k, { gain: HM_GAIN[k], jit: k === 'headshot' ? 0.015 : 0.04, rev: k === 'headshot' ? 0.05 : 0, key: 'hm', prio: 3 });
  }
  uiHover() { this._play('ui_hover', { gain: 0.14, jit: 0.04, rev: 0, key: 'ui', prio: 1 }); }
  uiClick() { this._play('ui_click', { gain: 0.32, jit: 0.03, rev: 0, key: 'ui', prio: 2 }); }
  buy() { this._play('ui_buy', { gain: 0.5, jit: 0.02, rev: 0.05, key: 'ui', prio: 2 }); }
  denied() { this._play('ui_denied', { gain: 0.42, jit: 0, rev: 0, key: 'ui', prio: 2 }); }
  pickup(kind) {
    const k = kind === 'health' || kind === 'money' ? kind : 'ammo';
    this._play('pick_' + k, { gain: k === 'money' ? 0.4 : 0.48, jit: 0.03, rev: 0.04, key: 'ui', prio: 2 });
  }
  waveStart(n) {
    const w = Math.max(1, num(+n, 1));
    const v = this._play('wave_start', { gain: 0.8, rate: 1 - Math.min(12, w - 1) * 0.008, jit: 0, rev: 0.3, echo: 0.25, key: 'stinger', prio: 5 });
    if (v) this._duck(0.55, 2.4, 1.2);
  }
  waveClear() { this._play('wave_clear', { gain: 0.6, jit: 0, rev: 0.25, key: 'stinger', prio: 4 }); }
  bossIntro() {
    const v = this._play('boss_brass', { gain: 0.9, jit: 0, rev: 0.35, echo: 0.3, key: 'stinger', prio: 5 });
    this._play('vox_boss_scream', { gain: 0.8, rate: 0.95, jit: 0.02, rev: 0.4, echo: 0.25, delay: 0.3, key: 'stinger', prio: 5 });
    if (v) this._duck(0.35, 2.5, 1.5);
  }
  setIntensity(x) {
    this._intensity = clamp01(num(+x, 0));
    if (this.music) this.music.setIntensity(this._intensity);
  }

  // ───────────── 3D ─────────────
  explosion(pos) {
    const v = this._play('explosion', { pos, gain: 1, jit: 0.06, rev: 0.4, echo: 0.6, key: 'explosion', prio: 5, maxDist: 400 });
    if (v) this._duck(0.2 + 0.6 * Math.min(1, v.dist / 50), 0.35, 1.2);
  }
  bulletImpact(pos, surface) {
    const name = IMPACT[surface] || 'imp_dirt';
    const v = this._play(name, { pos, gain: 0.6, jit: 0.07, rev: 0.12, key: 'imp', prio: 1.5 });
    if (!v) return;
    const ric = name === 'imp_metal' ? 0.3 : name === 'imp_rock' || name === 'imp_concrete' ? 0.08 : 0;
    if (ric && Math.random() < ric) this._play('ricochet', { pos, gain: 0.45, jit: 0.08, rev: 0.15, delay: 0.008, key: 'ricochet', prio: 1.5 });
  }
  fleshHit(pos, headshot) { this._play(headshot ? 'flesh_head' : 'flesh', { pos, gain: headshot ? 0.85 : 0.7, jit: 0.07, rev: 0.08, key: 'flesh', prio: 2.5 }); }
  gore(pos) { this._play('gore', { pos, gain: 0.65, jit: 0.07, rev: 0.1, key: 'gore', prio: 2 }); }
  bodyFall(pos, heavy) { this._play(heavy ? 'body_heavy' : 'body', { pos, gain: heavy ? 0.9 : 0.75, jit: 0.06, rev: 0.1, key: 'body', prio: 2 }); }
  shellCasing(pos, kind) {
    const k = kind === 'rifle' || kind === 'shotgun' ? kind : 'pistol';
    this._play('casing_' + k, { pos, gain: 0.3, jit: 0.07, rev: 0.03, key: 'casing', prio: 1 });
  }
  grenadeBounce(pos) { this._play('grenadeBounce', { pos, gain: 0.55, jit: 0.08, rev: 0.06, key: 'grenade', prio: 2 }); }
  zombieStep(pos, heavy) {
    this._play(heavy ? 'zstep_heavy' : 'zstep', { pos, gain: heavy ? 0.65 : 0.38, jit: 0.08, rev: 0.05, key: 'zstep', prio: heavy ? 1.5 : 1, maxDist: heavy ? 60 : 40 });
  }
  rimScrape(pos) { this._play('rimScrape', { pos, gain: 0.55, jit: 0.08, rev: 0.12, key: 'scrape', prio: 1.5 }); }
  acidSpit(pos) { this._play('acidSpit', { pos, gain: 0.6, jit: 0.07, rev: 0.08, key: 'acid', prio: 2 }); }
  acidSplash(pos) { this._play('acidSplash', { pos, gain: 0.6, jit: 0.07, rev: 0.1, key: 'acid', prio: 2 }); }

  createVoice(type, seed) {
    try { return new ZombieVoice(this, type, seed); } catch (e) { this._fail('createVoice', e); return NULL_VOICE; }
  }

  // ───────────── внутреннее ─────────────
  _buildGraph() {
    const c = this.ctx;
    const gain = (v, dest) => { const n = c.createGain(); n.gain.value = v; if (dest) n.connect(dest); return n; };
    const lim = this.limiter = c.createDynamicsCompressor();
    lim.threshold.value = -6; lim.knee.value = 3; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.2;
    const clip = this.clipper = c.createWaveShaper();
    clip.curve = softClipCurve(); clip.oversample = 'none';
    lim.connect(clip); clip.connect(c.destination);
    this.output = clip;
    this.master = gain(this.volumes.master, lim);
    this.sfxVol = gain(this.volumes.sfx, this.master);
    this.musicVol = gain(this.volumes.music, this.master);
    this.sfxBus = gain(1, this.sfxVol);
    this.ambDuck = gain(1, this.sfxVol); this.ambBus = gain(0.9, this.ambDuck);
    this.musDuck = gain(1, this.musicVol); this.musicBus = gain(1, this.musDuck);
    // общий «уличный» реверб
    this.revIn = gain(1);
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 160; hp.Q.value = 0.6;
    const conv = c.createConvolver(); conv.buffer = makeImpulse(c, 1.8);
    this.revOut = gain(0.55, this.sfxVol);
    this.revIn.connect(hp); hp.connect(conv); conv.connect(this.revOut);
    // эхо через поле: 3 приглушённых повтора (~0.26, 0.55, 0.83 с) с разных сторон
    this.echoIn = gain(1);
    const ehp = c.createBiquadFilter(); ehp.type = 'highpass'; ehp.frequency.value = 200; ehp.Q.value = 0.6;
    this.echoIn.connect(ehp);
    this.echoOut = gain(1, this.sfxVol);
    this.echoOut.connect(gain(0.35, this.revIn));
    for (const [d, f, a, p] of [[0.26, 2200, 0.3, -0.45], [0.55, 1300, 0.18, 0.55], [0.83, 800, 0.09, -0.15]]) {
      const dl = c.createDelay(1.5); dl.delayTime.value = d;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = f; lp.Q.value = 0.5;
      const pn = c.createStereoPanner(); pn.pan.value = p;
      ehp.connect(dl); dl.connect(lp); lp.connect(gain(a, pn)); pn.connect(this.echoOut);
    }
    this.noiseBuffer = makeNoise(c, 5);
  }

  _canPlay() {
    const c = this.ctx;
    if (!this.ready || this._paused || !c) return false;
    if (c.state === 'running') return true;
    // контекст ещё запускается — пара звуков встанет в очередь; иначе пропуск (не копим «залп» до resume)
    return c.state === 'suspended' && nowMs() - this._initT < 2000;
  }

  _resumeCtx() {
    const c = this.ctx;
    if (c && c.state !== 'running' && c.state !== 'closed') c.resume().catch(() => {});
  }

  // Если контекст не запустился (политика автозапуска) — запустить на первом жесте
  _armGesture() {
    if (this._armed || typeof window === 'undefined') return;
    this._armed = true;
    const on = () => {
      if (!this._paused) this._resumeCtx();
      if (this.ctx && this.ctx.state === 'running') for (const e of ['pointerdown', 'keydown', 'touchend']) window.removeEventListener(e, on, true);
    };
    for (const e of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(e, on, true);
  }

  _fail(where, e) {
    if (this._warned.has(where)) return;
    this._warned.add(where);
    try { console.warn('[audio] ' + where + ':', e && e.message ? e.message : e); } catch { /* ignore */ }
  }

  _listener(camera) {
    const e = camera.matrixWorld && camera.matrixWorld.elements;
    if (!e) return;
    const px = e[12], py = e[13], pz = e[14];
    let fx = -e[8], fy = -e[9], fz = -e[10], ux = e[4], uy = e[5], uz = e[6];
    const fl = Math.sqrt(fx * fx + fy * fy + fz * fz), ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
    if (!(fl > 1e-6 && ul > 1e-6) || !Number.isFinite(px + py + pz)) return;
    fx /= fl; fy /= fl; fz /= fl; ux /= ul; uy /= ul; uz /= ul;
    this._lx = px; this._ly = py; this._lz = pz;
    const L = this.ctx.listener;
    if (L.positionX) {
      L.positionX.value = px; L.positionY.value = py; L.positionZ.value = pz;
      L.forwardX.value = fx; L.forwardY.value = fy; L.forwardZ.value = fz;
      L.upX.value = ux; L.upY.value = uy; L.upZ.value = uz;
    } else {
      L.setPosition(px, py, pz);
      L.setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }

  _dist(x, y, z) { const dx = x - this._lx, dy = y - this._ly, dz = z - this._lz; return Math.sqrt(dx * dx + dy * dy + dz * dz); }

  _setPannerPos(p, x, y, z) {
    if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z);
  }

  _makePanner(x, y, z, important, opt) {
    const p = this.ctx.createPanner();
    const hrtf = opt && opt.model ? opt.model === 'HRTF' : (important || this._hrtf < MAX_HRTF);
    p.panningModel = hrtf ? 'HRTF' : 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = (opt && opt.ref) || REF_DIST;
    p.maxDistance = (opt && opt.max) || MAX_DIST;
    p.rolloffFactor = (opt && opt.rolloff) || ROLLOFF;
    this._setPannerPos(p, x, y, z);
    return p;
  }

  // Разовый звук: источник → громкость → [воздух] → [паннер] → шина; посылы в реверб и эхо
  _play(name, o) {
    if (!this._canPlay()) return null;
    const c = this.ctx, now = c.currentTime, pos = o.pos;
    let dist = 0, hasPos = false, px = 0, py = 0, pz = 0;
    if (pos) {
      px = +pos.x; py = +pos.y; pz = +pos.z;
      // битая позиция (NaN) — пропуск, а не громкий 2D-звук; без позиции (null) — 2D
      if (!(Number.isFinite(px) && Number.isFinite(py) && Number.isFinite(pz))) return null;
      hasPos = true; dist = this._dist(px, py, pz);
      if (dist > (o.maxDist || MAX_DIST)) return null;
    }
    const gain = num(o.gain, 1), prio = o.prio || 1, key = o.key || name;
    const level = gain * (hasPos ? distGain(dist) : 1);
    if (level < 0.003) return null;
    this._prune(now);
    if (!this._room(key, POLY[key] || 8, level * prio)) return null;
    if (!this._room(null, MAX_ONESHOTS, level * prio)) return null;
    const buffer = this.bank.pick(name, o.vi ?? -1, true);
    if (!buffer) return null;
    const rate = num(o.rate, 1) * (1 + (Math.random() * 2 - 1) * (o.jit ?? 0.06));
    const when = now + Math.max(0, o.delay || 0);
    if (o.duckPrev) this._duckSame(key, now);
    const src = c.createBufferSource(); src.buffer = buffer; src.playbackRate.value = rate;
    const vg = c.createGain(); vg.gain.value = gain;
    src.connect(vg);
    let tail = vg, lp = null, pn = null;
    if (hasPos) {
      if (dist > 8) { lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = airCutoff(dist); lp.Q.value = 0.5; vg.connect(lp); tail = lp; }
      pn = this._makePanner(px, py, pz, prio >= 3);
      tail.connect(pn); pn.connect(this.sfxBus);
    } else tail.connect(o.dest || this.sfxBus);
    let rs = null, es = null;
    const rev = (o.rev ?? 0.12) * (hasPos ? revDist(dist) : 1);
    if (rev > 0.002) { rs = c.createGain(); rs.gain.value = rev; tail.connect(rs); rs.connect(this.revIn); }
    if (o.echo) { es = c.createGain(); es.gain.value = o.echo * (hasPos ? revDist(dist) : 1); tail.connect(es); es.connect(this.echoIn); }
    src.start(when);
    const hrtf = !!pn && pn.panningModel === 'HRTF';
    if (hrtf) this._hrtf++;
    const v = { src, vg, lp, pn, rs, es, key, gain, dist, level: level * prio, t0: when, end: when + buffer.duration / rate, done: false, ducked: false, hrtf };
    src.onended = () => this._release(v);
    this._active.push(v);
    return v;
  }

  // Место под новый звук: если лимит достигнут — вытеснить самый слабый (громкость × остаток), либо пропустить новый
  _room(key, limit, score) {
    const A = this._active, now = this.ctx.currentTime;
    let n = 0, weak = null, ws = Infinity;
    for (let i = 0; i < A.length; i++) {
      const v = A[i];
      if (key !== null && v.key !== key) continue;
      n++;
      const s = v.level * Math.max(0.05, Math.min(1, (v.end - now) / Math.max(0.05, v.end - v.t0)));
      if (s < ws) { ws = s; weak = v; }
    }
    if (n < limit) return true;
    if (!weak || ws > score * 1.5) return false;
    this._kill(weak, 0.03);
    return true;
  }

  // Очередь автомата: хвосты предыдущих выстрелов приглушаются, чтобы не копилась каша
  _duckSame(key, now) {
    const A = this._active;
    for (let i = 0; i < A.length; i++) {
      const v = A[i];
      if (v.key !== key || v.ducked) continue;
      v.ducked = true; v.level *= 0.4;
      try { v.vg.gain.setTargetAtTime(v.gain * 0.4, now, 0.02); } catch { /* ignore */ }
    }
  }

  _kill(v, fade) {
    if (v.done) return;
    const t = this.ctx.currentTime;
    try {
      const g = v.vg.gain;
      g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0, t + fade);
      v.src.stop(t + fade + 0.005);
    } catch { /* уже остановлен */ }
    const i = this._active.indexOf(v);
    if (i >= 0) this._active.splice(i, 1);
  }

  _release(v) {
    if (v.done) return;
    v.done = true;
    const i = this._active.indexOf(v);
    if (i >= 0) this._active.splice(i, 1);
    if (v.hrtf) this._hrtf--;
    disc(v.src); disc(v.vg); disc(v.lp); disc(v.pn); disc(v.rs); disc(v.es);
  }

  // Подстраховка: звуки, чей onended не пришёл (например, контекст был приостановлен)
  _prune(now) {
    const A = this._active;
    for (let i = A.length - 1; i >= 0; i--) if (A[i].end < now - 0.5) this._release(A[i]);
    const V = this._vocal;
    for (let i = V.length - 1; i >= 0; i--) if (V[i].end < now - 0.5) this._releaseVocal(V[i]);
  }

  // Буфер без учёта полифонии (музыка, окружение): pos — [x,y,z], pan, lp, rev, when, dest
  _playBuf(b, o) {
    if (!this._canPlay() || !b) return;
    const c = this.ctx, now = c.currentTime;
    const src = c.createBufferSource(); src.buffer = b; src.playbackRate.value = o.rate || 1;
    const g = c.createGain(); g.gain.value = o.gain ?? 1;
    src.connect(g);
    let tail = g, f = null, p = null, s = null;
    if (o.lp) { f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; f.Q.value = 0.5; tail.connect(f); tail = f; }
    if (o.pos) p = this._makePanner(o.pos[0], o.pos[1], o.pos[2], false, { model: 'equalpower', ref: o.ref, rolloff: o.rolloff, max: 500 });
    else if (o.pan) { p = c.createStereoPanner(); p.pan.value = o.pan; }
    if (p) { tail.connect(p); p.connect(o.dest || this.sfxBus); } else tail.connect(o.dest || this.sfxBus);
    if (o.rev) { s = c.createGain(); s.gain.value = o.rev; tail.connect(s); s.connect(this.revIn); }
    src.start(Math.max(now, o.when || 0));
    src.onended = () => { disc(src); disc(g); disc(f); disc(p); disc(s); };
  }

  // Приглушить окружение и музыку (громкий выстрел/взрыв), затем плавно вернуть
  _duck(depth, hold, release) {
    const t = this.ctx.currentTime;
    duckParam(this.ambDuck.gain, t, depth, hold, release);
    duckParam(this.musDuck.gain, t, 0.5 + 0.5 * depth, hold, release);
  }

  _heartbeat() {
    const now = this.ctx.currentTime, L = this._hbLevel;
    if (this._hbNext < now) this._hbNext = now + 0.03;
    while (this._hbNext < now + 0.2) {
      const per = 60 / (62 + 88 * L), vol = 0.22 + 0.6 * L, d = this._hbNext - now;
      this._play('hb_lub', { gain: vol, delay: d, jit: 0.015, rev: 0, key: 'hb' });
      this._play('hb_dub', { gain: vol * 0.7, delay: d + Math.min(0.3, per * 0.36), jit: 0.015, rev: 0, key: 'hb' });
      this._hbNext += per;
    }
  }

  // ───────────── голоса зомби ─────────────
  _vocalize(vc, action) {
    if (!this._canPlay()) return;
    const c = this.ctx, now = c.currentTime, pr = VOICE_PRIO[action] || 1;
    const cur = vc.cur;
    if (cur && !cur.done && cur.end > now) {
      if (pr <= cur.prio) return;
      this._endVocal(cur, 0.05);
    }
    const dist = vc.hasPos ? this._dist(vc.x, vc.y, vc.z) : 0;
    if (dist > MAX_DIST) return;
    this._prune(now);
    if (this._vocal.length >= MAX_VOCAL) {
      // лимит: вытесняем самую неважную/дальнюю реплику, только если новая заметно важнее или ближе
      let worst = null, ws = Infinity;
      for (let i = 0; i < this._vocal.length; i++) { const a = this._vocal[i], s = a.prio * 20 - a.dist; if (s < ws) { ws = s; worst = a; } }
      if (!worst || pr * 20 - dist <= ws + 5) return;
      this._endVocal(worst, 0.06);
    }
    const name = action === 'spit' ? 'vox_spit' : 'vox_' + vc.type + '_' + action;
    const b = this.bank.pick(name, -1, nowMs() - (this.bank.lastLazy || 0) > 250);
    if (!b) return;
    const src = c.createBufferSource(); src.buffer = b;
    const rate = vc.rate * (1 + (Math.random() * 2 - 1) * 0.04) * (action === 'spit' && vc.type !== 'spitter' ? 0.9 : 1);
    src.playbackRate.value = rate;
    const eq = c.createBiquadFilter(); eq.type = 'peaking'; eq.frequency.value = vc.fmtF; eq.Q.value = 1.3; eq.gain.value = vc.fmtG;
    const gv = VOICE_GAIN[action] * vc.gain * TYPE_GAIN[vc.type];
    const g = c.createGain(); g.gain.value = gv;
    src.connect(eq); eq.connect(g);
    let tail = g, lp = null, pn = null;
    if (vc.hasPos) {
      if (dist > 8) { lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = airCutoff(dist); lp.Q.value = 0.5; g.connect(lp); tail = lp; }
      pn = this._makePanner(vc.x, vc.y, vc.z, true);
      tail.connect(pn); pn.connect(this.sfxBus);
    } else { const k = c.createGain(); k.gain.value = 0.7; tail.connect(k); k.connect(this.sfxBus); lp = k; }
    const rs = c.createGain(); rs.gain.value = 0.16 * revDist(dist);
    tail.connect(rs); rs.connect(this.revIn);
    src.start(now);
    const hrtf = !!pn && pn.panningModel === 'HRTF';
    if (hrtf) this._hrtf++;
    const a = { vc, src, eq, g, lp, panner: pn, rs, prio: pr, dist, end: now + b.duration / rate, done: false, ending: false, hrtf };
    vc.cur = a;
    this._vocal.push(a);
    src.onended = () => this._releaseVocal(a);
  }

  _endVocal(a, fade) {
    if (a.done || a.ending) return;
    a.ending = true;
    const t = this.ctx.currentTime;
    try {
      const g = a.g.gain;
      g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0, t + fade);
      a.src.stop(t + fade + 0.01);
    } catch { /* уже остановлен */ }
    const i = this._vocal.indexOf(a);
    if (i >= 0) this._vocal.splice(i, 1);
    if (a.vc.cur === a) a.vc.cur = null;
  }

  _releaseVocal(a) {
    if (a.done) return;
    a.done = true;
    const i = this._vocal.indexOf(a);
    if (i >= 0) this._vocal.splice(i, 1);
    if (a.vc.cur === a) a.vc.cur = null;
    if (a.hrtf) this._hrtf--;
    disc(a.src); disc(a.eq); disc(a.g); disc(a.lp); disc(a.panner); disc(a.rs);
  }

  // Отладочная статистика (для песочницы)
  stats() {
    return {
      state: this.ctx ? this.ctx.state : 'none', active: this._active.length, vocal: this._vocal.length, hrtf: this._hrtf,
      bankRendered: this.bank ? this.bank.rendered : 0, bankTotal: this.bank ? this.bank.total : 0, initMs: this.initMs,
    };
  }
}

function disc(n) { if (n) { try { n.disconnect(); } catch { /* ignore */ } } }

function duckParam(p, t, depth, hold, rel) {
  p.cancelScheduledValues(t);
  p.setTargetAtTime(depth, t, 0.015);
  p.setTargetAtTime(1, t + hold, rel);
}

// Мягкий клиппер: линеен до 0.8, выше плавно упирается в 0.99 (вход за ±1 WaveShaper зажимает в края кривой)
function softClipCurve(n = 4096) {
  const k = new Float32Array(n), knee = 0.8, room = 0.99 - knee;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1, a = Math.abs(x);
    k[i] = Math.sign(x) * (a <= knee ? a : knee + room * Math.tanh((a - knee) / room));
  }
  return k;
}

// Импульсная характеристика открытого поля ~1.8 с: ранние отражения + диффузный хвост, ВЧ гаснут быстрее
function makeImpulse(c, dur) {
  const sr = c.sampleRate, n = Math.round(dur * sr), ir = c.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch), w = white(911 + ch * 1777);
    for (const [t, a] of [[0.009, 0.6], [0.017, 0.42], [0.029, 0.35], [0.041, 0.3], [0.056, 0.24], [0.074, 0.2], [0.093, 0.16], [0.12, 0.12]]) {
      const i = Math.round(t * (1 + 0.08 * w()) * sr);
      const s = w() > 0 ? a : -a;
      if (i + 2 < n) { d[i] += s * 0.6; d[i + 1] += s * 0.3; d[i + 2] += s * 0.1; }
    }
    const pre = Math.round(0.012 * sr);
    let l1 = 0, l2 = 0;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sr;
      const a = 1 - Math.exp(-2 * Math.PI * (6500 * Math.exp(-t / 0.45) + 700) / sr);
      l1 += a * (w() - l1); l2 += a * (l1 - l2);
      d[i] += l2 * Math.min(1, t / 0.05) * Math.exp(-t * 6.9 / dur) * 0.9;
    }
  }
  return ir;
}

function makeNoise(c, sec) {
  const n = Math.round(sec * c.sampleRate), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0), w = white(4242);
  for (let i = 0; i < n; i++) d[i] = w() * 0.9;
  return b;
}

// Пустой голос (если создание не удалось)
const NULL_VOICE = Object.freeze({ setPosition() {}, groan() {}, attack() {}, scream() {}, pain() {}, death() {}, spit() {}, stop() {}, dispose() {} });

// Обёртка: публичные методы никогда не бросают исключений (ошибка пишется в консоль один раз)
for (const name of [
  'init', 'resume', 'suspend', 'setVolumes', 'update', 'weaponFire', 'weaponDry', 'weaponSwitch', 'weaponReload',
  'knifeSwing', 'knifeHit', 'grenadePin', 'grenadeThrow', 'footstep', 'jump', 'land', 'playerHurt', 'playerDeath',
  'heartbeat', 'hitMarker', 'uiHover', 'uiClick', 'buy', 'denied', 'pickup', 'waveStart', 'waveClear', 'bossIntro',
  'setIntensity', 'explosion', 'bulletImpact', 'fleshHit', 'gore', 'bodyFall', 'shellCasing', 'grenadeBounce',
  'zombieStep', 'rimScrape', 'acidSpit', 'acidSplash',
]) {
  const fn = AudioSystem.prototype[name];
  AudioSystem.prototype[name] = function (a, b, c) {
    try { fn.call(this, a, b, c); } catch (e) { this._fail(name, e); }
  };
}
