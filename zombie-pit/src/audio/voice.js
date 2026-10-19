// Голос одного зомби. Тембр уникален по seed: высота (playbackRate) + индивидуальная форманта (peaking EQ).
// Звучание идёт через AudioSystem (общий лимит одновременно говорящих зомби).
import { hashSeed, mulberry32 } from '../core/noise.js';
import { ZOMBIE_TYPES } from './catalog.js';

// Важность реплик: более важная прерывает текущую, менее важная пропускается
export const VOICE_PRIO = { groan: 1, spit: 2, pain: 2, attack: 3, scream: 4, death: 5 };

export class ZombieVoice {
  constructor(sys, type, seed) {
    this.sys = sys;
    this.type = ZOMBIE_TYPES.includes(type) ? type : 'walker';
    const r = mulberry32(hashSeed(this.type + ':' + String(seed ?? 0)));
    const big = this.type === 'brute' || this.type === 'boss';
    this.rate = big ? 0.93 + 0.14 * r() : 0.88 + 0.24 * r();
    this.fmtF = 450 * Math.pow(4.5, r());
    this.fmtG = (r() * 2 - 1) * 7;
    this.gain = 0.85 + 0.3 * r();
    this.x = 0; this.y = 1.6; this.z = 0; this.hasPos = false;
    this.cur = null;
    this.disposed = false;
  }

  setPosition(v) {
    if (!v) return;
    const x = +v.x, y = +v.y, z = +v.z;
    if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))) return;
    this.x = x; this.y = y; this.z = z; this.hasPos = true;
    const c = this.cur;
    if (c && c.panner) { try { this.sys._setPannerPos(c.panner, x, y, z); } catch { /* узел уже отключён */ } }
  }

  groan() { this._say('groan'); }
  attack() { this._say('attack'); }
  scream() { this._say('scream'); }
  pain() { this._say('pain'); }
  death() { this._say('death'); }
  spit() { this._say('spit'); }

  _say(action) {
    if (this.disposed) return;
    try { this.sys._vocalize(this, action); } catch (e) { this.sys._fail('voice.' + action, e); }
  }

  stop() {
    try { if (this.cur) this.sys._endVocal(this.cur, 0.08); } catch (e) { this.sys._fail('voice.stop', e); }
  }

  dispose() { this.stop(); this.disposed = true; }
}
