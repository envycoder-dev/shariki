'use strict';
// Подключение одной командой: скрипт в терминале получает код, пользователь подтверждает его в кабинете,
// скрипт забирает новый ключ и сам прописывает настройки Claude Code / Codex. Похоже на «gh auth login».
const crypto = require('node:crypto');
const { randomB62, sha256 } = require('./util');

const TTL = 10 * 60000;
const ALPHA = 'BCDFGHJKLMNPQRSTVWXZ'; // без гласных и похожих символов — код не сложится в слово и не спутается
const TOOLS = { 'claude-code': 'Claude Code', codex: 'Codex', both: 'Claude Code + Codex' };
const clean = (s, n) => String(s || '').replace(/[^\w .()-]/g, '').trim().slice(0, n);
const osName = (s) => { const x = clean(s, 30); return /^darwin/i.test(x) ? 'macOS' : /^(mingw|msys|cygwin|windows)/i.test(x) ? 'Windows' : /^linux/i.test(x) ? 'Linux' : x; };

function createConnect({ keys, pickModels }) {
  const byCode = new Map(), byDevice = new Map(), starts = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [c, s] of byCode) if (s.expires < now) { byCode.delete(c); byDevice.delete(s.device); }
    for (const [ip, v] of starts) if (v.until < now) starts.delete(ip);
  }, 60000).unref();

  function start(b, ip) {
    const now = Date.now(), lim = starts.get(ip);
    if (lim && lim.until > now && lim.n >= 10) throw Object.assign(new Error('Слишком много попыток подключения. Подождите 10 минут.'), { status: 429 });
    starts.set(ip, lim && lim.until > now ? { n: lim.n + 1, until: lim.until } : { n: 1, until: now + TTL });
    const tool = TOOLS[b.client] ? b.client : 'claude-code';
    let code;
    do { const c = Array.from({ length: 8 }, () => ALPHA[crypto.randomInt(ALPHA.length)]).join(''); code = c.slice(0, 4) + '-' + c.slice(4); } while (byCode.has(code));
    const device = randomB62(40), s = { code, device: sha256(device), client: tool, os: osName(b.os), host: clean(b.host, 40), ip, created: now, expires: now + TTL, status: 'pending', lastPoll: 0 };
    byCode.set(code, s); byDevice.set(s.device, code);
    return { code, device, interval: 2, expires_in: TTL / 1000 };
  }

  function poll(device) {
    const code = byDevice.get(sha256(String(device || ''))), s = code && byCode.get(code), now = Date.now();
    if (!s || s.expires < now) { if (s) { byCode.delete(code); byDevice.delete(s.device); } return { status: 'expired' }; }
    if (now - s.lastPoll < 1000) return { status: 'slow_down' };
    s.lastPoll = now;
    if (s.status === 'pending') return { status: 'pending' };
    byCode.delete(code); byDevice.delete(s.device);
    if (s.status === 'denied') return { status: 'denied' };
    return { status: 'approved', key: s.key, model: s.model || '', fast: s.fast || '' };
  }

  const find = (code) => { const s = byCode.get(String(code || '').toUpperCase().trim()); return s && s.expires > Date.now() && s.status === 'pending' ? s : null; };
  const info = (code) => { const s = find(code); return s && { code: s.code, client: TOOLS[s.client], os: s.os, host: s.host, ip: s.ip, created: s.created, expires: s.expires }; };

  function decide(code, user, action) {
    const s = find(code);
    if (!s) return null;
    if (action !== 'approve') { s.status = 'denied'; return { ok: true }; }
    const pick = pickModels(user);
    if (!pick.model) throw Object.assign(new Error('На вашем тарифе пока нет моделей для API'), { status: 409 });
    const day = new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
    const { key, item } = keys.create(user.id, { name: `${TOOLS[s.client]} · ${s.host || s.os || 'терминал'} · ${day}`.slice(0, 60) });
    Object.assign(s, { status: 'approved', key, keyId: item.id, uid: user.id, model: pick.model, fast: pick.fast });
    return { ok: true, item };
  }

  return { start, poll, info, decide, TOOLS };
}

module.exports = { createConnect };
