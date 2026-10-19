// Тёмная эмбиент-музыка. setIntensity(0..1): при 0 — только дрон; выше — пульс и низкие томы (90–110 bpm),
// диссонантный струнный пэд (расстроенные пилы через ФНЧ), у вершины — тремоло-кластер и «подъёмы».
import { clamp, smoothstep } from '../core/noise.js';

// Аккорды пэда (Гц): мрачные кластеры с малой секундой, меняются каждые 4 такта
const CHORDS = [
  [73.42, 110.0, 155.56, 220.0],
  [65.41, 98.0, 138.59, 196.0],
  [58.27, 87.31, 123.47, 174.61],
  [73.42, 103.83, 155.56, 207.65],
];
const TOMS_LOW = [0, 6, 10];
const TOMS_HIGH = [0, 3, 6, 8, 10, 11, 14];
const TOM_RATE = [1, 1, 1.25, 1.12, 1, 1, 1.25, 1, 1, 1, 1.12, 1.12, 1, 1, 1.25, 1];

export class Music {
  constructor(sys) {
    this.sys = sys;
    this.ctx = sys.ctx;
    this.target = 0; this.level = 0; this.applied = -1;
    this.step = 0; this.nextT = 0;
    this.started = false;
  }

  start() {
    const c = this.ctx, out = this.sys.musicBus, now = c.currentTime;
    const osc = (type, f, g, dest, detune = 0) => {
      const o = c.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = detune;
      const a = c.createGain(); a.gain.value = g; o.connect(a); a.connect(dest); o.start(now);
      return o;
    };
    const lfo = (f, depth, param) => { const o = c.createOscillator(); o.frequency.value = f; const g = c.createGain(); g.gain.value = depth; o.connect(g); g.connect(param); o.start(now); };
    // дрон
    this.bedG = c.createGain(); this.bedG.gain.value = 0; this.bedG.connect(out);
    const bedLP = c.createBiquadFilter(); bedLP.type = 'lowpass'; bedLP.frequency.value = 210; bedLP.Q.value = 0.9; bedLP.connect(this.bedG);
    osc('sine', 36.71, 0.35, bedLP); osc('triangle', 73.42, 0.28, bedLP); osc('sine', 73.42, 0.22, bedLP, 11); osc('sine', 110, 0.1, bedLP, -6);
    lfo(0.045, 70, bedLP.frequency);
    // струнный пэд
    this.padG = c.createGain(); this.padG.gain.value = 0; this.padG.connect(out);
    this.padLP = c.createBiquadFilter(); this.padLP.type = 'lowpass'; this.padLP.frequency.value = 260; this.padLP.Q.value = 2.2; this.padLP.connect(this.padG);
    lfo(0.09, 90, this.padLP.frequency);
    this.padOsc = [];
    for (const f of CHORDS[0]) for (const d of [-9, 8]) this.padOsc.push(osc('sawtooth', f, 0.1, this.padLP, d));
    // напряжение: высокий кластер с тремоло
    this.tensG = c.createGain(); this.tensG.gain.value = 0; this.tensG.connect(out);
    const tbp = c.createBiquadFilter(); tbp.type = 'bandpass'; tbp.frequency.value = 1150; tbp.Q.value = 0.8; tbp.connect(this.tensG);
    const trem = c.createGain(); trem.gain.value = 0.5; trem.connect(tbp);
    lfo(8.5, 0.45, trem.gain);
    osc('sawtooth', 587.33, 0.12, trem); osc('sawtooth', 622.25, 0.1, trem); osc('sawtooth', 880, 0.05, trem, 7);
    this.started = true;
    this.nextT = now + 0.1;
    this._apply(now);
  }

  setIntensity(x) { this.target = clamp(+x || 0, 0, 1); }

  update(dt) {
    if (!this.started) return;
    const now = this.ctx.currentTime;
    this.level += (this.target - this.level) * (1 - Math.exp(-Math.min(0.25, Math.max(0, dt || 0)) * 0.8));
    if (Math.abs(this.level - this.applied) > 0.01) this._apply(now);
    this._schedule(now);
  }

  _apply(now) {
    const I = this.level;
    this.applied = I;
    this.bedG.gain.setTargetAtTime(0.5 * (1 - 0.35 * I), now, 0.6);
    this.padG.gain.setTargetAtTime(smoothstep(0.25, 0.7, I) * 0.55, now, 0.6);
    this.padLP.frequency.setTargetAtTime(220 + 1400 * I * I, now, 0.6);
    this.tensG.gain.setTargetAtTime(smoothstep(0.65, 1, I) * 0.22, now, 0.6);
  }

  // Планировщик ударных с упреждением ~0.2 с (шаг — шестнадцатая)
  _schedule(now) {
    const I = this.level, st = 60 / (90 + 20 * I) / 4;
    if (this.nextT < now) this.nextT = now + 0.05;
    while (this.nextT < now + 0.2) {
      const s = this.step % 16, bar = (this.step / 16) | 0, t = this.nextT;
      if (s === 0 && bar % 4 === 0) {
        const ch = CHORDS[(bar / 4) % CHORDS.length];
        for (let i = 0; i < this.padOsc.length; i++) this.padOsc[i].frequency.setTargetAtTime(ch[i >> 1], t, 0.7);
      }
      this._hit(s, bar, t, I, st);
      this.nextT += st; this.step++;
    }
  }

  _hit(s, bar, t, I, st) {
    const perc = smoothstep(0.15, 0.45, I);
    if (perc <= 0.01) return;
    if (s === 0 || s === 8) this._drum('mus_pulse', 0.6 * perc, 1, t);
    if (I > 0.55 && (s === 6 || s === 14)) this._drum('mus_pulse', 0.3 * perc, 1, t);
    const tomG = smoothstep(0.3, 0.5, I);
    if (tomG > 0.01 && (I > 0.7 ? TOMS_HIGH : TOMS_LOW).includes(s)) this._drum('mus_tom', (s === 0 ? 0.5 : 0.34) * perc * tomG, TOM_RATE[s], t);
    const tickG = smoothstep(0.55, 0.8, I);
    if (tickG > 0.01 && (s % 2 === 0 || I > 0.82)) this._drum('mus_tick', (s % 4 === 0 ? 0.2 : 0.11) * tickG, 1, t);
    // «подъём» к началу следующей фразы (4 такта)
    if (I > 0.72 && s === 0 && bar % 4 === 2) this._drum('mus_riser', 0.22 * smoothstep(0.72, 1, I), 1, t + 32 * st - 2.4);
  }

  _drum(name, gain, rate, when) {
    const sys = this.sys, b = sys.bank.pick(name, -1, false);
    if (b) sys._playBuf(b, { when, gain, rate, dest: sys.musicBus });
  }
}
