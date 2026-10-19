// Настройки и рекорды в localStorage (работает и для file://).
const KEY = 'yama.settings.v1', BEST = 'yama.best.v1';
const DEFAULTS = { sens: 1, bright: 1, fov: 75, vol: 0.8, music: 0.55, quality: 'high', diff: 'normal', invert: 0, fps: 0 };

function read(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } }
function write(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* приватный режим */ } }

export const settings = { ...DEFAULTS, ...(read(KEY) || {}) };
export const saveSettings = () => write(KEY, settings);
export const DIFF = {
  easy: { dmg: 0.6, hp: 0.8, label: 'Лёгкая' },
  normal: { dmg: 1, hp: 1, label: 'Обычная' },
  hard: { dmg: 1.45, hp: 1.2, label: 'Хардкор' },
};
export function loadBest() { return read(BEST) || { score: 0, wave: 0, kills: 0 }; }
export function saveBest(b) { write(BEST, b); }
