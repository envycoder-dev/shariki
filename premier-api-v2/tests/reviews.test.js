'use strict';
// Run with Node.js 24: node --test tests/reviews.test.js (no npm dependencies).
// The server and database live in a disposable copy, never the production data/.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn } = require('node:child_process');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

test('Premier reviews: isolated HTTP E2E', { timeout: 45000 }, async (t) => {
  const root = path.resolve(__dirname, '..'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'premier-reviews-'));
  let child, store, logs = '';
  t.after(async () => {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([new Promise((r) => child.once('exit', r)), delay(6000)]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    if (store) store.db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  // Copy runtime sources only: never data/, credentials, backups or browser caches.
  fs.cpSync(root, dir, { recursive: true, filter: (src) => {
    const rel = path.relative(root, src), top = rel.split(path.sep)[0];
    return !rel || ['public', 'locales', 'desktop', 'api'].includes(top) || (!rel.includes(path.sep) && !top.startsWith('.') && /\.(js|json)$/.test(top));
  } });
  store = require(path.join(dir, 'db.js'));
  const sessions = new Map();
  function user(id, plan = 'free', until = Date.now() + 864e5) {
    const u = { id, login: id, email: id + '@example.invalid', plan, until, created: new Date().toISOString() };
    store.users.put(u);
    const token = crypto.randomBytes(32).toString('hex');
    store.sessions.put(sha(token), id, Date.now() + 3600e3); sessions.set(id, token); return u;
  }
  for (let i = 1; i <= 25; i++) user('tester' + i, i === 1 ? 'pro' : 'free');
  user('expired', 'max', Date.now() - 1000);
  const reservation = net.createServer(); await new Promise((r) => reservation.listen(0, '127.0.0.1', r));
  const port = reservation.address().port; await new Promise((r) => reservation.close(r));
  const base = 'http://127.0.0.1:' + port, password = crypto.randomBytes(24).toString('base64url');
  child = spawn(process.execPath, ['server.js'], { cwd: dir, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), ADMIN_PASSWORD: password, PUBLIC_URL: base, TRUST_PROXY: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (b) => { logs += b; }); child.stderr.on('data', (b) => { logs += b; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error('Server did not start: ' + logs);
    try { if ((await fetch(base + '/healthz')).ok) { ready = true; break; } } catch {}
    await delay(100);
  }
  assert.ok(ready, logs);
  let adminToken;
  async function call(url, { uid, admin = false, body, ip = '203.0.113.1', method } = {}) {
    const headers = { 'Content-Type': 'application/json', 'X-Real-IP': ip };
    if (uid) headers.Cookie = 'premier_session=' + sessions.get(uid);
    if (admin && adminToken) headers.Authorization = 'Bearer ' + adminToken;
    const r = await fetch(base + url, { method: method || (body === undefined ? 'GET' : 'POST'), headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: r.status, data: await r.json(), headers: r.headers };
  }
  const review = (extra = {}) => ({ nick: 'tester1', rating: 5, text: 'Очень удобный сервис, использую для кода и своих проектов.', consent: true, ...extra });
  const login = await call('/api/admin/login', { body: { password } }); assert.equal(login.status, 200); adminToken = login.data.token;
  let id;
  await t.test('guest and non-admin protection', async () => {
    assert.equal((await call('/api/reviews', { body: review() })).status, 401);
    assert.equal((await call('/api/admin/reviews')).status, 401);
    assert.equal((await call('/api/admin/reviews?summary=1', { uid: 'tester1' })).status, 401);
    assert.equal((await call('/api/admin/reviews', { uid: 'tester1', body: { id: 'abcdef123456', action: 'approve' } })).status, 401);
  });
  await t.test('pending → invisible → approve → public → same-nick 409 → different nick 201', async () => {
    const created = await call('/api/reviews', { uid: 'tester1', body: review() }); assert.equal(created.status, 201); assert.deepEqual(created.data, { ok: true });
    assert.deepEqual((await call('/api/reviews')).data, []);
    let rows = (await call('/api/admin/reviews', { admin: true })).data;
    assert.equal(rows.length, 1); assert.equal(rows[0].status, 'pending'); id = rows[0].id; assert.match(id, /^[a-f0-9]{12}$/);
    assert.equal((await call('/api/admin/reviews?summary=1', { admin: true })).data.pending, 1);
    assert.equal((await call('/api/admin/reviews', { admin: true, body: { id, action: 'approve' } })).status, 200);
    rows = (await call('/api/reviews')).data; assert.equal(rows.length, 1); assert.equal(rows[0].plan, 'pro'); assert.equal(rows[0].uid, undefined); assert.equal(rows[0].status, undefined);
    const duplicate = await call('/api/reviews', { uid: 'tester1', body: review() }); assert.equal(duplicate.status, 409); assert.equal(duplicate.data.error, 'Отзыв с этим ником уже оставлен');
    const second = await call('/api/reviews', { uid: 'tester1', body: review({ nick: 'tester1.alt', text: 'Второй отзыв с одного аккаунта, но с другим ником — разрешено.' }) }); assert.equal(second.status, 201); assert.deepEqual(second.data, { ok: true });
  });
  await t.test('reject, duplicate in rejected state, delete, unknown record/action', async () => {
    assert.equal((await call('/api/admin/reviews', { admin: true, body: { id, action: 'reject' } })).status, 200);
    assert.deepEqual((await call('/api/reviews')).data, []);
    assert.equal((await call('/api/reviews', { uid: 'tester1', body: review() })).status, 409);
    assert.equal((await call('/api/admin/reviews', { admin: true, body: { id, action: 'publish' } })).status, 400);
    assert.equal((await call('/api/admin/reviews', { admin: true, body: { id: '000000000000', action: 'approve' } })).status, 404);
    assert.equal((await call('/api/admin/reviews', { admin: true, body: { id, action: 'delete' } })).status, 200);
    assert.equal((await call('/api/admin/reviews', { admin: true, body: { id, action: 'delete' } })).status, 404);
    assert.equal((await call('/api/reviews', { uid: 'tester1', body: review() })).status, 201);
  });
  await t.test('strict validation and nickname ownership (case-insensitive)', async () => {
    const cases = [null, [], review({ consent: false }), review({ consent: 'true' }), review({ rating: 0 }), review({ rating: 6 }), review({ rating: 4.5 }), review({ rating: '5' }), review({ text: ' '.repeat(30) }), review({ text: 'a'.repeat(19) }), review({ text: 'a'.repeat(2001) }), review({ nick: 'аbc' }), review({ nick: 'x' }), review({ nick: 'a'.repeat(25) }), review({ nick: '<img>' }), review({ nick: 'bad nick' })];
    for (let i = 0; i < cases.length; i++) assert.equal((await call('/api/reviews', { uid: 'tester2', ip: '198.51.100.' + (i + 1), body: cases[i] })).status, 400, JSON.stringify(cases[i]));
    const taken = await call('/api/reviews', { uid: 'tester2', ip: '198.51.100.50', body: review({ nick: 'TESTER1' }) }); assert.equal(taken.status, 400); assert.equal(taken.data.error, 'Ник уже занят');
    assert.equal((await call('/api/reviews', { uid: 'tester2', ip: '198.51.100.51', body: review({ nick: 'TeStEr2', text: 'a'.repeat(20) }) })).status, 201);
    assert.equal((await call('/api/reviews', { uid: 'tester3', ip: '198.51.100.52', body: review({ nick: 'tester3', text: 'b'.repeat(2000) }) })).status, 201);
  });
  await t.test('rate limit counts attempts and does not affect auth limits', async () => {
    for (let i = 0; i < 5; i++) assert.equal((await call('/api/reviews', { uid: 'tester4', ip: '192.0.2.40', body: review({ consent: false }) })).status, 400);
    const blocked = await call('/api/reviews', { uid: 'tester4', ip: '192.0.2.40', body: review({ nick: 'tester4' }) }); assert.equal(blocked.status, 429); assert.equal(blocked.headers.get('retry-after'), '3600');
    assert.equal((await call('/api/reviews', { uid: 'tester4', ip: '192.0.2.41', body: review({ nick: 'tester4' }) })).status, 201);
    // .40 is still throttled (6 attempts): the limiter answers 429 before the same-nick 409 check.
    assert.equal((await call('/api/reviews', { uid: 'tester4', ip: '192.0.2.40', body: review({ nick: 'tester4' }) })).status, 429);
  });
  await t.test('parallel submissions produce exactly one pending review', async () => {
    const responses = await Promise.all(Array.from({ length: 4 }, () => call('/api/reviews', { uid: 'tester5', ip: '192.0.2.50', body: review({ nick: 'tester5' }) })));
    assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409, 409, 409]);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM reviews WHERE uid = ?').get('tester5').n, 1);
  });
  await t.test('English errors and user text kept verbatim; expired plan is free', async () => {
    const bad = await call('/api/reviews?lang=en', { uid: 'tester6', ip: '192.0.2.60', body: review({ consent: false }) }); assert.equal(bad.data.error, 'Please consent to publication');
    const text = '<img src=x onerror="window.__reviewXss=1"> Отличный сервис для проектов & учёбы!';
    assert.equal((await call('/api/reviews', { uid: 'expired', ip: '192.0.2.61', body: review({ nick: 'expired', text }) })).status, 201);
    const row = store.db.prepare('SELECT * FROM reviews WHERE uid = ?').get('expired');
    await call('/api/admin/reviews', { admin: true, body: { id: row.id, action: 'approve' } });
    const pub = (await call('/api/reviews?lang=en')).data.find((r) => r.id === row.id); assert.equal(pub.text, text); assert.equal(pub.plan, 'free');
    const dupEn = await call('/api/reviews?lang=en', { uid: 'expired', ip: '192.0.2.61', body: review({ nick: 'expired' }) }); assert.equal(dupEn.status, 409); assert.equal(dupEn.data.error, 'You have already submitted a review with this nickname');
  });
  await t.test('pagination: public 24, admin 100, complete pending count', async () => {
    const insert = store.db.prepare('INSERT INTO reviews (id,uid,nick,rating,text,status,at) VALUES (?,?,?,?,?,?,?)');
    for (let i = 0; i < 135; i++) insert.run(crypto.randomBytes(6).toString('hex'), 'seed' + i, 'seed' + i, 4, 'Длинный тестовый отзыв для пагинации.', i < 30 ? 'approved' : 'pending', 1000 + i);
    const a = await call('/api/reviews'), b = await call('/api/reviews?page=2'); assert.equal(a.data.length, 24); assert.equal(b.data.length, 7);
    const all = [...a.data, ...b.data]; assert.equal(new Set(all.map((r) => r.id)).size, 31); assert.ok(all.every((r, i) => !i || all[i - 1].at >= r.at));
    assert.equal((await call('/api/admin/reviews', { admin: true })).data.length, 100);
    assert.ok((await call('/api/admin/reviews?page=2', { admin: true })).data.length > 0);
    const expected = store.db.prepare("SELECT COUNT(*) AS n FROM reviews WHERE status='pending'").get().n;
    assert.ok(expected > 100); assert.equal((await call('/api/admin/reviews?summary=1', { admin: true })).data.pending, expected);
    assert.deepEqual((await call('/api/reviews?page=0')).data, a.data);
  });
  await t.test('HTML routes and immutable admin cache version', async () => {
    assert.equal((await fetch(base + '/')).status, 200);
    const en = await (await fetch(base + '/?lang=en')).text(); assert.ok(en.includes('id="reviewForm"')); assert.ok(en.includes('What users say'));
    const panel = await fetch(base + '/panelp'); assert.match(panel.headers.get('cache-control'), /no-store/); assert.match(await panel.text(), /panel\.js\?v=29/);
  });
});
