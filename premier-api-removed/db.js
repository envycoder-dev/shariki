// Хранилище Premier: один файл SQLite (data/premier.db) на встроенном модуле Node (node:sqlite, Node 22.13+).
// Пользователи, сессии и платежи — отдельные таблицы с индексами; остальное (настройки, чаты, память, расход) — пары ключ→JSON.
// Запись атомарная (транзакции, журнал WAL): падение сервера посреди записи не портит данные.
// При первом запуске старые JSON-файлы из data/ переносятся в базу, а сами файлы откладываются в data/legacy-json-<дата>/.
const fs = require('fs'), path = require('path');
const _emit = process.emitWarning; // модуль ещё помечен «экспериментальным» — прячем только это предупреждение
process.emitWarning = (w, ...a) => (String(w && w.message || w).includes('SQLite is an experimental') ? undefined : _emit.call(process, w, ...a));
const [NV, NM] = process.versions.node.split('.').map(Number);
if (NV < 22 || (NV === 22 && NM < 13)) { console.error(`Premier: нужен Node.js 22.13 или новее (сейчас ${process.versions.node}) — в нём есть встроенная база SQLite`); process.exit(1); }
const { DatabaseSync } = require('node:sqlite');

const DATA = path.join(__dirname, 'data');
fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });
const FILE = path.join(DATA, 'premier.db');
const db = new DatabaseSync(FILE);
db.exec(`
  PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, login TEXT NOT NULL, email TEXT, google TEXT, created TEXT, data TEXT NOT NULL);
  CREATE UNIQUE INDEX IF NOT EXISTS users_login ON users (lower(login));
  CREATE INDEX IF NOT EXISTS users_email ON users (email);
  CREATE INDEX IF NOT EXISTS users_google ON users (google);
  CREATE TABLE IF NOT EXISTS sessions (h TEXT PRIMARY KEY, uid TEXT NOT NULL, exp INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS sessions_uid ON sessions (uid);
  CREATE TABLE IF NOT EXISTS payments (id TEXT PRIMARY KEY, tx TEXT, uid TEXT, status TEXT, at INTEGER, data TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS payments_tx ON payments (tx);
  CREATE INDEX IF NOT EXISTS payments_status ON payments (status);
  CREATE INDEX IF NOT EXISTS payments_at ON payments (at);
  -- чаты: по строке на чат (data = NULL — чат удалён, «надгробие» нужно другим устройствам), v — номер правки
  CREATE TABLE IF NOT EXISTS chats (uid TEXT NOT NULL, cid TEXT NOT NULL, v INTEGER NOT NULL, at INTEGER NOT NULL, data TEXT, PRIMARY KEY (uid, cid));
  CREATE INDEX IF NOT EXISTS chats_v ON chats (uid, v);
  -- общий номер правки пользователя и остальное состояние (проекты, порядок чатов, выбранная модель…)
  CREATE TABLE IF NOT EXISTS chatmeta (uid TEXT PRIMARY KEY, rev INTEGER NOT NULL, mv INTEGER NOT NULL, meta TEXT);
  CREATE TABLE IF NOT EXISTS referrals (id TEXT PRIMARY KEY, ref TEXT NOT NULL, ip TEXT, fp TEXT, status TEXT NOT NULL DEFAULT 'pending', msg INTEGER NOT NULL DEFAULT 0, paid INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_referrals_ref ON referrals(ref);
  CREATE INDEX IF NOT EXISTS idx_referrals_ip ON referrals(ip, at);
  CREATE INDEX IF NOT EXISTS idx_referrals_fp ON referrals(fp, at);
  CREATE TABLE IF NOT EXISTS reviews (id TEXT PRIMARY KEY, uid TEXT NOT NULL, nick TEXT NOT NULL, rating INTEGER NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', at INTEGER NOT NULL);
  DROP INDEX IF EXISTS idx_reviews_uid;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_uid_nick ON reviews(uid, nick);
  CREATE INDEX IF NOT EXISTS idx_reviews_status_at ON reviews(status, at DESC);
  CREATE TABLE IF NOT EXISTS modelstats (id INTEGER PRIMARY KEY AUTOINCREMENT, model TEXT NOT NULL, kind TEXT NOT NULL, ok INTEGER NOT NULL, ms INTEGER, first INTEGER, err TEXT, at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_modelstats_model_at ON modelstats(model, at);
`);
try { fs.chmodSync(FILE, 0o600); } catch {}

const P = new Map(); const q = (sql) => { let s = P.get(sql); if (!s) { s = db.prepare(sql); P.set(sql, s); } return s; };
// вход через GitHub (добавлено позже — у старых баз колонки нет)
if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'github')) db.exec('ALTER TABLE users ADD COLUMN github TEXT');
db.exec('CREATE INDEX IF NOT EXISTS users_github ON users (github)');
db.exec('DROP TABLE IF EXISTS api_keys'); // пользовательский API удалён — ключи больше не храним
const parse = (s, d) => { if (s == null) return d; try { return JSON.parse(s); } catch { return d; } };
function tx(fn) { // вложенные вызовы выполняются внутри внешней транзакции
  if (tx.depth) return fn();
  tx.depth = 1; db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; } finally { tx.depth = 0; }
}

/* ---------- ключ → JSON ---------- */
const kv = {
  get: (k, d) => parse(q('SELECT v FROM kv WHERE k = ?').get(k)?.v, d),
  set: (k, v) => { q('INSERT INTO kv (k, v, at) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, at = excluded.at').run(k, JSON.stringify(v), Date.now()); },
  del: (k) => { q('DELETE FROM kv WHERE k = ?').run(k); },
  keys: (prefix) => q("SELECT k FROM kv WHERE k >= ? AND k < ? ORDER BY k").all(prefix, prefix + '\uffff').map((r) => r.k),
};

/* ---------- пользователи ---------- */
const urow = (r) => (r ? parse(r.data, null) : null);
const users = {
  all: () => q('SELECT data FROM users ORDER BY created, rowid').all().map(urow),
  count: () => q('SELECT count(*) n FROM users').get().n,
  get: (id) => (id ? urow(q('SELECT data FROM users WHERE id = ?').get(String(id))) : null),
  byLogin: (l) => (l ? urow(q('SELECT data FROM users WHERE lower(login) = lower(?)').get(String(l))) : null),
  byEmail: (e) => (e ? urow(q('SELECT data FROM users WHERE email = ? ORDER BY google IS NOT NULL LIMIT 1').get(String(e).toLowerCase())) : null),
  byGoogle: (g) => (g ? urow(q('SELECT data FROM users WHERE google = ?').get(String(g))) : null),
  byGithub: (g) => (g ? urow(q('SELECT data FROM users WHERE github = ?').get(String(g))) : null),
  loginTaken: (l) => !!q('SELECT 1 FROM users WHERE lower(login) = lower(?)').get(String(l)),
  put: (u) => { q(`INSERT INTO users (id, login, email, google, github, created, data) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET login = excluded.login, email = excluded.email, google = excluded.google, github = excluded.github, created = excluded.created, data = excluded.data`)
    .run(u.id, u.login, u.email ? String(u.email).toLowerCase() : null, u.google ? String(u.google) : null, u.github ? String(u.github) : null, u.created || null, JSON.stringify(u)); return u; },
  update: (id, fn) => tx(() => { const u = users.get(id); if (!u) return null; fn(u); users.put(u); return u; }),
  remove: (id) => tx(() => { q('DELETE FROM users WHERE id = ?').run(id); q('DELETE FROM sessions WHERE uid = ?').run(id); q('DELETE FROM kv WHERE k = ? OR k = ?').run('chat:' + id, 'mem:' + id); q('DELETE FROM chats WHERE uid = ?').run(id); q('DELETE FROM chatmeta WHERE uid = ?').run(id); }),
};

/* ---------- сессии (храним только sha256 токена) ---------- */
const sessions = {
  get: (h) => { const s = q('SELECT uid, exp FROM sessions WHERE h = ?').get(h); if (!s) return null; if (s.exp < Date.now()) { sessions.del(h); return null; } return s; },
  put: (h, uid, exp) => { q('INSERT OR REPLACE INTO sessions (h, uid, exp) VALUES (?, ?, ?)').run(h, uid, exp); },
  del: (h) => { q('DELETE FROM sessions WHERE h = ?').run(h); },
  count: (uid) => q('SELECT count(*) n FROM sessions WHERE uid = ? AND exp >= ?').get(uid, Date.now()).n,
  delOthers: (uid, keep) => { q('DELETE FROM sessions WHERE uid = ? AND h != ?').run(uid, keep || ''); },
  purge: () => { q('DELETE FROM sessions WHERE exp < ?').run(Date.now()); },
};
setInterval(() => { try { sessions.purge(); } catch {} }, 3600e3).unref();

/* ---------- платежи (история не обрезается) ---------- */
const prow = (r) => (r ? parse(r.data, null) : null);
const payments = {
  get: (id) => prow(q('SELECT data FROM payments WHERE id = ?').get(String(id))),
  byTx: (t, provider) => (q('SELECT data FROM payments WHERE tx = ? ORDER BY at DESC').all(String(t)).map(prow).find((p) => !provider || p.provider === provider) || null),
  find: (s) => payments.get(s) || payments.byTx(s),
  put: (p) => { const at = typeof p.created === 'number' ? p.created : Date.parse(p.created || '') || Date.now();
    q(`INSERT INTO payments (id, tx, uid, status, at, data) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET tx = excluded.tx, uid = excluded.uid, status = excluded.status, data = excluded.data`)
    .run(String(p.id), p.tx != null ? String(p.tx) : null, p.uid || null, p.status || null, at, JSON.stringify(p)); return p; },
  all: () => q('SELECT data FROM payments ORDER BY at, rowid').all().map(prow),
  byStatus: (st) => q('SELECT data FROM payments WHERE status = ? ORDER BY at, rowid').all(st).map(prow),
  recent: (n) => q('SELECT data FROM payments ORDER BY at DESC, rowid DESC LIMIT ?').all(n).map(prow).reverse(),
};

/* ---------- чаты: синхронизация по одному чату ----------
   Каждое изменение получает номер rev (общий счётчик пользователя). Устройство отправляет только изменённые чаты
   и получает всё, что поменялось после его последнего номера. Если чат за это время правили на другом устройстве,
   сервер его не перезаписывает, а возвращает свою версию — устройство объединяет и отправляет снова. */
const MAX_CHAT = 8e6;
const chats = {
  rev: (uid) => q('SELECT rev FROM chatmeta WHERE uid = ?').get(uid)?.rev || 0,
  // изменения после since: { rev, meta | null, chats: [{ id, v, data | null }] }
  since(uid, since = 0) {
    const m = q('SELECT rev, mv, meta FROM chatmeta WHERE uid = ?').get(uid);
    if (!m) return { rev: 0, meta: null, chats: [] };
    const rows = q('SELECT cid, v, data FROM chats WHERE uid = ? AND v > ? ORDER BY v').all(uid, since)
      .filter((r) => since > 0 || r.data != null).map((r) => ({ id: r.cid, v: r.v, data: parse(r.data, null) }));
    return { rev: m.rev, meta: m.mv > since ? parse(m.meta, null) : null, chats: rows };
  },
  // put — изменённые чаты, del — id удалённых, meta — остальное состояние (или undefined)
  write(uid, base, { put = [], del = [], meta }) {
    return tx(() => {
      const m = q('SELECT rev, mv FROM chatmeta WHERE uid = ?').get(uid) || { rev: 0, mv: 0 };
      const rev = m.rev + 1, now = Date.now(), conflicts = new Set(); let wrote = false;
      const get = q('SELECT v, data IS NULL dead FROM chats WHERE uid = ? AND cid = ?');
      const up = q('INSERT INTO chats (uid, cid, v, at, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT(uid, cid) DO UPDATE SET v = excluded.v, at = excluded.at, data = excluded.data');
      for (const c of put) {
        if (!c || typeof c.id !== 'string' || !c.id || c.id.length > 64) continue;
        const ex = get.get(uid, c.id);
        if (ex && ex.v > base) { conflicts.add(c.id); continue; } // правили на другом устройстве — вернём их версию
        const d = JSON.stringify(c); if (d.length > MAX_CHAT) throw Object.assign(new Error('Чат слишком большой (больше 8 МБ)'), { status: 413 });
        up.run(uid, c.id, rev, now, d); wrote = true;
      }
      for (const id of del) { if (typeof id !== 'string' || !id || id.length > 64) continue; const ex = get.get(uid, id); if (ex && ex.dead) continue; up.run(uid, id, rev, now, null); wrote = true; } // удаление важнее правки
      let mv = m.mv, metaConflict = false;
      if (meta && typeof meta === 'object') { if (m.mv > base) metaConflict = true; else { mv = rev; wrote = true; } }
      if (!wrote) return { rev: m.rev, conflicts: [...conflicts], metaConflict };
      q(`INSERT INTO chatmeta (uid, rev, mv, meta) VALUES (?, ?, ?, ?) ON CONFLICT(uid) DO UPDATE SET rev = excluded.rev, mv = excluded.mv, meta = COALESCE(excluded.meta, chatmeta.meta)`)
        .run(uid, rev, mv, mv === rev ? JSON.stringify(meta) : null);
      return { rev, conflicts: [...conflicts], metaConflict };
    });
  },
  // целиком (для старого API /api/state и переноса)
  full(uid) {
    const m = q('SELECT rev, meta FROM chatmeta WHERE uid = ?').get(uid); if (!m) return { rev: 0, state: null };
    const meta = parse(m.meta, {}) || {}, list = q('SELECT cid, data FROM chats WHERE uid = ? AND data IS NOT NULL').all(uid).map((r) => parse(r.data, null)).filter(Boolean);
    const ord = new Map((meta.order || []).map((id, i) => [id, i])); list.sort((a, b) => (ord.has(a.id) ? ord.get(a.id) : -1) - (ord.has(b.id) ? ord.get(b.id) : -1));
    const { order, ...rest } = meta; return { rev: m.rev, state: { ...rest, chats: list } };
  },
  replace(uid, state) { // записать состояние целиком (старый API): удалённые чаты помечаются надгробиями
    return tx(() => {
      const ids = new Set((state.chats || []).map((c) => c && c.id).filter(Boolean)), cur = chats.rev(uid);
      const old = q('SELECT cid FROM chats WHERE uid = ? AND data IS NOT NULL').all(uid).map((r) => r.cid).filter((id) => !ids.has(id));
      const { chats: list, ...meta } = state; meta.order = [...ids];
      return chats.write(uid, cur, { put: list || [], del: old, meta });
    });
  },
};

/* ---------- перенос старых JSON-файлов ---------- */
function migrate() {
  if (kv.get('meta:migrated')) return;
  const rd = (f) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch { return undefined; } };
  const moved = [];
  tx(() => {
    const us = rd('users.json'); if (Array.isArray(us)) { const seen = new Set(); for (const u of us) if (u && u.id && u.login) { let l = u.login; for (let i = 2; seen.has(l.toLowerCase()); i++) l = u.login + i; seen.add(l.toLowerCase()); users.put({ ...u, login: l }); } moved.push('users.json'); }
    const ss = rd('sessions.json'); if (ss && typeof ss === 'object') { for (const [h, s] of Object.entries(ss)) if (s && s.uid && s.exp > Date.now()) sessions.put(h, s.uid, s.exp); moved.push('sessions.json'); }
    const ps = rd('payments.json'); if (Array.isArray(ps)) { for (const p of ps) if (p && p.id) payments.put(p); moved.push('payments.json'); }
    for (const [f, k] of [['settings.json', 'settings'], ['models.json', 'models'], ['agent.json', 'agent'], ['plans.json', 'plans'], ['promos.json', 'promos'], ['trials.json', 'trials']]) { const v = rd(f); if (v !== undefined) { kv.set(k, v); moved.push(f); } }
    for (const [dir, pre] of [['chats', 'chat:'], ['memory', 'mem:'], ['usage', 'usage:']]) {
      let list = []; try { list = fs.readdirSync(path.join(DATA, dir)).filter((f) => f.endsWith('.json')); } catch {}
      for (const f of list) { const v = rd(path.join(dir, f)); if (v !== undefined) kv.set(pre + f.slice(0, -5), v); }
      if (list.length) moved.push(dir);
    }
    kv.set('meta:migrated', { at: new Date().toISOString(), files: moved });
  });
  if (moved.length) {
    const dst = path.join(DATA, 'legacy-json-' + new Date().toISOString().slice(0, 10)); fs.mkdirSync(dst, { recursive: true, mode: 0o700 });
    for (const f of moved) try { fs.renameSync(path.join(DATA, f), path.join(dst, f)); } catch {}
    console.log(`Хранилище: данные перенесены в SQLite (${moved.join(', ')}). Старые файлы — в ${path.relative(process.cwd(), dst) || dst}`);
  }
}
migrate();
// чаты из одной большой записи «chat:<uid>» → по строке на чат
if (!kv.get('meta:chats-split')) tx(() => {
  for (const k of kv.keys('chat:')) { const st = kv.get(k, null), uid = k.slice(5); if (st && st.state && Array.isArray(st.state.chats) && !chats.rev(uid)) chats.replace(uid, st.state); kv.del(k); }
  kv.set('meta:chats-split', { at: new Date().toISOString() });
});

// резервная копия: node -e "require('./db').backup('/путь/premier-backup.db')"
const backup = (to) => { db.exec('VACUUM INTO ' + "'" + String(to).replace(/'/g, "''") + "'"); return to; };
process.on('exit', () => { try { db.close(); } catch {} });
module.exports = { db, tx, kv, users, sessions, payments, chats, backup, FILE };
