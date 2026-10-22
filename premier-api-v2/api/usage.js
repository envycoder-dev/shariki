'use strict';
// Журнал запросов к API (без текстов запросов и ответов) и статистика для кабинета.
const KEEP_DAYS = 31;
const MSK = 3 * 3600e3; // сутки лимитов считаются по Москве — так же, как в тарифах
const dayOf = (ms) => new Date(ms + MSK).toISOString().slice(0, 10);
const dayStart = (ms = Date.now()) => { const d = new Date(ms + MSK); d.setUTCHours(0, 0, 0, 0); return d.getTime() - MSK; };

function createUsage(store) {
  store.db.exec(`CREATE TABLE IF NOT EXISTS api_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, key_id TEXT, at INTEGER NOT NULL,
    model TEXT, proto TEXT, client TEXT, stream INTEGER, status INTEGER, ms INTEGER, ttft INTEGER,
    in_tok INTEGER, out_tok INTEGER, cost REAL, err TEXT);
    CREATE INDEX IF NOT EXISTS api_log_uid_at ON api_log(uid, at);`);
  const q = (sql) => store.db.prepare(sql);
  const prune = () => { try { q('DELETE FROM api_log WHERE at < ?').run(Date.now() - KEEP_DAYS * 86400000); } catch {} };
  prune(); setInterval(prune, 6 * 3600e3).unref();

  return {
    dayStart,
    log(r) {
      try {
        q('INSERT INTO api_log (uid, key_id, at, model, proto, client, stream, status, ms, ttft, in_tok, out_tok, cost, err) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(r.uid, r.key_id || null, r.at || Date.now(), r.model || null, r.proto || null, r.client ? String(r.client).slice(0, 60) : null, r.stream ? 1 : 0, r.status | 0, r.ms | 0, r.ttft == null ? null : r.ttft | 0, r.in_tok | 0, r.out_tok | 0, Number(r.cost) || 0, r.err ? String(r.err).slice(0, 300) : null);
      } catch (e) { console.log('api log:', e.message); }
    },
    todayByKey(uid) {
      const m = new Map();
      for (const r of q('SELECT key_id, count(*) AS n FROM api_log WHERE uid = ? AND at >= ? GROUP BY key_id').all(uid, dayStart())) m.set(r.key_id, r.n);
      return m;
    },
    stats(uid, days) {
      days = Math.min(KEEP_DAYS, Math.max(1, days | 0 || 30));
      const from = dayStart() - (days - 1) * 86400000;
      const rows = q(`SELECT date((at + ${MSK}) / 1000, 'unixepoch') AS day, count(*) AS requests, sum(cost) AS messages, sum(status >= 400) AS errors, sum(in_tok) AS in_tok, sum(out_tok) AS out_tok
        FROM api_log WHERE uid = ? AND at >= ? GROUP BY day`).all(uid, from);
      const byDay = new Map(rows.map((r) => [r.day, r]));
      const out = [];
      for (let i = 0; i < days; i++) {
        const day = dayOf(from + i * 86400000 + 3600e3), r = byDay.get(day);
        out.push({ day, requests: r ? r.requests : 0, messages: r ? Math.round(r.messages * 10) / 10 : 0, errors: r ? r.errors : 0, in_tok: r ? r.in_tok : 0, out_tok: r ? r.out_tok : 0 });
      }
      const by_model = q('SELECT model, count(*) AS requests, sum(cost) AS messages FROM api_log WHERE uid = ? AND at >= ? GROUP BY model ORDER BY requests DESC LIMIT 20').all(uid, from)
        .map((r) => ({ model: r.model, requests: r.requests, messages: Math.round(r.messages * 10) / 10 }));
      const by_client = q('SELECT coalesce(client, ?) AS client, count(*) AS requests FROM api_log WHERE uid = ? AND at >= ? GROUP BY 1 ORDER BY requests DESC LIMIT 12').all('—', uid, from);
      return { days: out, by_model, by_client };
    },
    list(uid, { limit = 50, before = null, key = null } = {}) {
      limit = Math.min(200, Math.max(1, limit | 0 || 50));
      const args = [uid]; let where = 'uid = ?';
      if (before) { where += ' AND id < ?'; args.push(Number(before) | 0); }
      if (key) { where += ' AND key_id = ?'; args.push(String(key)); }
      const items = q(`SELECT * FROM api_log WHERE ${where} ORDER BY id DESC LIMIT ?`).all(...args, limit + 1);
      const more = items.length > limit; if (more) items.pop();
      return { items: items.map((r) => ({ id: r.id, at: r.at, key_id: r.key_id, client: r.client, model: r.model, proto: r.proto, stream: !!r.stream, status: r.status, ms: r.ms, ttft: r.ttft, in_tok: r.in_tok, out_tok: r.out_tok, cost: Math.round(r.cost * 10) / 10, err: r.err })), next: more ? items[items.length - 1].id : null };
    },
  };
}

module.exports = { createUsage, dayStart };
