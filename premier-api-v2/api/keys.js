'use strict';
// Ключи API: в базе только SHA-256. Ограничения: срок, список моделей, список IP/подсетей.
const net = require('node:net');
const { newKey, keyLooksValid, sha256, randomB62 } = require('./util');

const MAX_KEYS = 10;
const parse = (s) => { try { const v = JSON.parse(s); return Array.isArray(v) && v.length ? v : null; } catch { return null; } };
const plainIp = (ip) => String(ip || '').replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, '');

// «203.0.113.5», «203.0.113.0/24», «2001:db8::/32» → нормализованная строка или null
function normIp(s) {
  const m = /^([^/\s]+)(?:\/(\d{1,3}))?$/.exec(String(s || '').trim());
  if (!m) return null;
  const ip = plainIp(m[1]), v = net.isIP(ip);
  if (!v) return null;
  if (m[2] == null) return ip;
  const p = Number(m[2]);
  return p <= (v === 4 ? 32 : 128) ? `${ip}/${p}` : null;
}
const lists = new Map();
function allowed(ips, ip) {
  if (!ips) return true;
  const key = ips.join(',');
  let bl = lists.get(key);
  if (!bl) {
    bl = new net.BlockList();
    for (const e of ips) { const [a, p] = e.split('/'); const t = net.isIP(a) === 6 ? 'ipv6' : 'ipv4'; if (p) bl.addSubnet(a, Number(p), t); else bl.addAddress(a, t); }
    if (lists.size > 500) lists.clear();
    lists.set(key, bl);
  }
  const x = plainIp(ip), t = net.isIP(x);
  return !!t && bl.check(x, t === 6 ? 'ipv6' : 'ipv4');
}

function createKeys(store) {
  store.db.exec(`CREATE TABLE IF NOT EXISTS api_tokens (
    id TEXT PRIMARY KEY, uid TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, hash TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL, hint TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER,
    last_used INTEGER, last_ip TEXT, last_client TEXT, models TEXT, ips TEXT);
    CREATE INDEX IF NOT EXISTS api_tokens_uid ON api_tokens(uid);`);
  const q = (sql) => store.db.prepare(sql);
  const row = (r) => r && { id: r.id, name: r.name, hint: r.hint, created: r.created, expires: r.expires, last_used: r.last_used, last_ip: r.last_ip, last_client: r.last_client, models: parse(r.models), ips: parse(r.ips) };
  const hintOf = (k) => k.slice(0, 7) + '…' + k.slice(-4);
  const touched = new Map();

  // проверка полей ключа из кабинета; возвращает { name, models, ips } или бросает ошибку с текстом для пользователя
  function clean(b, partial) {
    const out = {};
    if (!partial || 'name' in b) {
      const name = typeof b.name === 'string' ? b.name.trim().replace(/\s+/g, ' ') : '';
      if (!name || name.length > 60) throw Object.assign(new Error('Название ключа: от 1 до 60 символов'), { status: 400 });
      out.name = name;
    }
    if ('models' in b) {
      if (b.models == null || (Array.isArray(b.models) && !b.models.length)) out.models = null;
      else if (Array.isArray(b.models) && b.models.length <= 100 && b.models.every((x) => typeof x === 'string' && x.trim() && x.length <= 128)) out.models = [...new Set(b.models.map((x) => x.trim()))];
      else throw Object.assign(new Error('Модели: список из 1–100 ID'), { status: 400 });
    }
    if ('ips' in b) {
      const raw = b.ips == null ? [] : Array.isArray(b.ips) ? b.ips : String(b.ips).split(/[\s,;]+/);
      const list = raw.map((x) => String(x).trim()).filter(Boolean);
      if (list.length > 50) throw Object.assign(new Error('IP-адресов: не больше 50'), { status: 400 });
      const bad = list.find((x) => !normIp(x));
      if (bad) throw Object.assign(new Error(`Не похоже на IP-адрес или подсеть: ${bad.slice(0, 60)}`), { status: 400 });
      out.ips = list.length ? [...new Set(list.map(normIp))] : null;
    }
    if (!partial && 'expires_days' in b && b.expires_days != null) {
      if (!Number.isInteger(b.expires_days) || b.expires_days < 1 || b.expires_days > 365) throw Object.assign(new Error('Срок ключа: от 1 до 365 дней или без срока'), { status: 400 });
      out.expires = Date.now() + b.expires_days * 86400000;
    }
    return out;
  }

  return {
    MAX_KEYS,
    list: (uid) => q('SELECT * FROM api_tokens WHERE uid = ? ORDER BY created DESC').all(uid).map(row),
    get: (uid, id) => row(q('SELECT * FROM api_tokens WHERE uid = ? AND id = ?').get(uid, String(id))),
    create(uid, b) {
      const c = clean(b, false);
      return store.tx(() => {
        if (q('SELECT count(*) AS n FROM api_tokens WHERE uid = ?').get(uid).n >= MAX_KEYS) throw Object.assign(new Error(`Можно держать не больше ${MAX_KEYS} ключей. Отзовите ненужный и попробуйте снова.`), { status: 409 });
        const key = newKey(), id = randomB62(16);
        q('INSERT INTO api_tokens (id, uid, hash, name, hint, created, expires, models, ips) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(id, uid, sha256(key), c.name, hintOf(key), Date.now(), c.expires || null, c.models ? JSON.stringify(c.models) : null, c.ips ? JSON.stringify(c.ips) : null);
        return { key, item: row(q('SELECT * FROM api_tokens WHERE id = ?').get(id)) };
      });
    },
    update(uid, id, b) {
      const c = clean(b, true);
      const cur = q('SELECT id FROM api_tokens WHERE uid = ? AND id = ?').get(uid, String(id));
      if (!cur) return null;
      if ('name' in c) q('UPDATE api_tokens SET name = ? WHERE id = ?').run(c.name, cur.id);
      if ('models' in c) q('UPDATE api_tokens SET models = ? WHERE id = ?').run(c.models ? JSON.stringify(c.models) : null, cur.id);
      if ('ips' in c) q('UPDATE api_tokens SET ips = ? WHERE id = ?').run(c.ips ? JSON.stringify(c.ips) : null, cur.id);
      return row(q('SELECT * FROM api_tokens WHERE id = ?').get(cur.id));
    },
    // новый секрет с теми же настройками; старый перестаёт работать сразу
    roll(uid, id) {
      const cur = q('SELECT id FROM api_tokens WHERE uid = ? AND id = ?').get(uid, String(id));
      if (!cur) return null;
      const key = newKey();
      q('UPDATE api_tokens SET hash = ?, hint = ?, last_used = NULL, last_ip = NULL, last_client = NULL WHERE id = ?').run(sha256(key), hintOf(key), cur.id);
      return { key, item: row(q('SELECT * FROM api_tokens WHERE id = ?').get(cur.id)) };
    },
    remove: (uid, id) => q('DELETE FROM api_tokens WHERE uid = ? AND id = ?').run(uid, String(id)).changes > 0,
    // ключ из запроса → { key, uid } или { error: 'format' | 'unknown' | 'expired' | 'ip' }
    verify(raw, ip) {
      if (!keyLooksValid(raw)) return { error: 'format' };
      const r = q('SELECT * FROM api_tokens WHERE hash = ?').get(sha256(raw));
      if (!r) return { error: 'unknown' };
      if (r.expires && r.expires <= Date.now()) return { error: 'expired' };
      const k = row(r);
      if (!allowed(k.ips, ip)) return { error: 'ip', ip: plainIp(ip) };
      return { key: k, uid: r.uid };
    },
    // отметка использования: первая — сразу (кабинет ждёт «подключено»), дальше не чаще раза в 5 секунд
    touch(id, ip, client) {
      const now = Date.now(), t = touched.get(id);
      if (t && now - t.at < 5000 && t.client === client) return;
      touched.set(id, { at: now, client });
      if (touched.size > 5000) touched.clear();
      q('UPDATE api_tokens SET last_used = ?, last_ip = ?, last_client = COALESCE(?, last_client) WHERE id = ?').run(now, plainIp(ip).slice(0, 64), client, id);
    },
  };
}

module.exports = { createKeys, normIp, allowed, plainIp };
