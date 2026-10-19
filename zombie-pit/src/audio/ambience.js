// Окружение: ночной ветер с порывами, низкий гул из ямы (биения), сверчки,
// далёкие события раз в 15–40 с (вороны, вой, скрип металла, гром) и редкие стоны из глубины ямы.
const rnd = (a, b) => a + (b - a) * Math.random();
const PIT_Y = -3;

export class Ambience {
  constructor(sys) {
    this.sys = sys;
    this.ctx = sys.ctx;
    this.wind = [];
    this.cricketsOn = false;
    this.started = false;
    this.nextGust = 0; this.nextEvent = 0; this.nextMoan = 0; this.nextCrk = 0;
  }

  start() {
    const c = this.ctx, sys = this.sys, out = sys.ambBus, now = c.currentTime, noise = sys.noiseBuffer;
    // ветер: «тело» (ФНЧ) + свист (узкая полоса); два канала с разными смещениями шума — ширина
    for (const side of [-1, 1]) {
      const src = c.createBufferSource(); src.buffer = noise; src.loop = true;
      const body = c.createBiquadFilter(); body.type = 'lowpass'; body.frequency.value = 260; body.Q.value = 0.5;
      const bodyG = c.createGain(); bodyG.gain.value = 0;
      const wh = c.createBiquadFilter(); wh.type = 'bandpass'; wh.frequency.value = 700; wh.Q.value = 3.5;
      const whG = c.createGain(); whG.gain.value = 0;
      const pan = c.createStereoPanner(); pan.pan.value = side * 0.6;
      src.connect(body); body.connect(bodyG); bodyG.connect(pan);
      src.connect(wh); wh.connect(whG); whG.connect(pan);
      pan.connect(out);
      src.start(now, Math.random() * noise.duration);
      this.wind.push({ body, bodyG, wh, whG, side });
    }
    // гул из ямы: расстроенные низкие осцилляторы (биения ~0.27 Гц) + рокот + «дыхание»; источник в центре ямы
    const dr = c.createGain(); dr.gain.value = 0;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 170; lp.Q.value = 0.7;
    for (const [f, type, a] of [[36.71, 'sine', 0.22], [36.98, 'sine', 0.2], [55.2, 'triangle', 0.1], [73.6, 'sawtooth', 0.035], [110.3, 'sine', 0.025]]) {
      const o = c.createOscillator(); o.type = type; o.frequency.value = f;
      const g = c.createGain(); g.gain.value = a;
      o.connect(g); g.connect(lp); o.start(now);
    }
    const rum = c.createBufferSource(); rum.buffer = noise; rum.loop = true; rum.playbackRate.value = 0.5;
    const rlp = c.createBiquadFilter(); rlp.type = 'lowpass'; rlp.frequency.value = 65; rlp.Q.value = 0.6;
    const rg = c.createGain(); rg.gain.value = 1.6;
    rum.connect(rlp); rlp.connect(rg); rg.connect(lp); rum.start(now, Math.random() * 2);
    lp.connect(dr);
    const breath = c.createBufferSource(); breath.buffer = noise; breath.loop = true; breath.playbackRate.value = 0.8;
    const bbp = c.createBiquadFilter(); bbp.type = 'bandpass'; bbp.frequency.value = 230; bbp.Q.value = 1.4;
    const bg = c.createGain(); bg.gain.value = 0.25;
    const blfo = c.createOscillator(); blfo.frequency.value = 0.11;
    const blg = c.createGain(); blg.gain.value = 0.22;
    blfo.connect(blg); blg.connect(bg.gain); blfo.start(now);
    breath.connect(bbp); bbp.connect(bg); bg.connect(dr); breath.start(now, Math.random() * 3);
    const lfo = c.createOscillator(); lfo.frequency.value = 0.065;
    const lg = c.createGain(); lg.gain.value = 0.22;
    lfo.connect(lg); lg.connect(dr.gain); lfo.start(now);
    dr.gain.setTargetAtTime(0.6, now, 2.5);
    const pn = sys._makePanner(0, PIT_Y, 0, false, { ref: 12, rolloff: 0.7, max: 400, model: 'equalpower' });
    dr.connect(pn); pn.connect(out);
    const near = c.createGain(); near.gain.value = 0.3;
    dr.connect(near); near.connect(out);
    this.started = true;
    this.nextGust = now; this.nextEvent = now + rnd(8, 18); this.nextMoan = now + rnd(4, 9);
  }

  update() {
    if (!this.started) return;
    const now = this.ctx.currentTime;
    if (!this.cricketsOn) this._crickets(now);
    else if (now >= this.nextCrk) { this.crkG.gain.setTargetAtTime(rnd(0.05, 0.1), now, 3); this.nextCrk = now + rnd(6, 14); }
    if (now >= this.nextGust) this._gust(now);
    if (now >= this.nextEvent) { this._event(); this.nextEvent = now + rnd(15, 40); }
    if (now >= this.nextMoan) { this._moan(); this.nextMoan = now + rnd(7, 18); }
  }

  // Новый порыв: сила s, плавный подход к цели
  _gust(now) {
    const s = Math.random() < 0.15 ? rnd(0.75, 1) : Math.pow(Math.random(), 1.3) * 0.7 + 0.1;
    const tc = rnd(0.8, 2.6);
    for (const w of this.wind) {
      w.bodyG.gain.setTargetAtTime(0.35 + 0.9 * s, now, tc);
      w.body.frequency.setTargetAtTime(170 + 280 * s, now, tc);
      w.whG.gain.setTargetAtTime(0.12 + 0.75 * s * s, now, tc * 1.2);
      w.wh.frequency.setTargetAtTime(420 + 850 * s + w.side * rnd(30, 120), now, tc * 1.3);
    }
    this.nextGust = now + rnd(2.5, 7);
  }

  _crickets(now) {
    const sys = this.sys, b = sys.bank.pick('amb_crickets', 0, false);
    if (!b) return;
    const c = this.ctx;
    this.crkG = c.createGain(); this.crkG.gain.value = 0; this.crkG.gain.setTargetAtTime(0.08, now, 3);
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2200;
    hp.connect(this.crkG); this.crkG.connect(sys.ambBus);
    for (const [rate, g] of [[1, 1], [0.93, 0.6]]) {
      const s = c.createBufferSource(); s.buffer = b; s.loop = true; s.playbackRate.value = rate;
      const sg = c.createGain(); sg.gain.value = g;
      s.connect(sg); sg.connect(hp); s.start(now, Math.random() * b.duration);
    }
    this.cricketsOn = true; this.nextCrk = now + rnd(6, 14);
  }

  // Далёкое событие в случайном направлении в 35–65 м от слушателя
  _event() {
    const sys = this.sys, r = Math.random();
    const name = r < 0.3 ? 'amb_crow' : r < 0.55 ? 'amb_creak' : r < 0.78 ? 'amb_howl' : 'amb_thunder';
    const b = sys.bank.pick(name, -1, false);
    if (!b) return;
    if (name === 'amb_thunder') { sys._playBuf(b, { gain: rnd(0.4, 0.7), pan: rnd(-0.6, 0.6), lp: 1100, rev: 0.25, dest: sys.ambBus }); return; }
    const a = Math.random() * Math.PI * 2, d = rnd(35, 65);
    const y = name === 'amb_crow' ? rnd(6, 14) : rnd(0, 4);
    const gain = name === 'amb_crow' ? rnd(0.5, 0.8) : name === 'amb_howl' ? rnd(0.35, 0.55) : rnd(0.5, 0.8);
    sys._playBuf(b, {
      gain, rate: rnd(0.94, 1.06), lp: name === 'amb_howl' ? 2200 : rnd(3000, 5000), rev: 0.45, dest: sys.ambBus,
      pos: [sys._lx + Math.cos(a) * d, y, sys._lz + Math.sin(a) * d], ref: 22, rolloff: 1,
    });
  }

  // Глухой стон из глубины ямы (замедленные голоса зомби)
  _moan() {
    const sys = this.sys, r = Math.random();
    const name = r < 0.5 ? 'vox_walker_groan' : r < 0.75 ? 'vox_crawler_groan' : 'vox_brute_groan';
    const b = sys.bank.pick(name, -1, false);
    if (!b) return;
    const a = Math.random() * Math.PI * 2, rr = rnd(1, 6);
    sys._playBuf(b, {
      gain: rnd(0.25, 0.45), rate: rnd(0.55, 0.75), lp: 650, rev: 0.7, dest: sys.ambBus,
      pos: [Math.cos(a) * rr, rnd(-12, -5), Math.sin(a) * rr], ref: 10, rolloff: 0.8,
    });
  }
}
