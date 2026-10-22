// Тарифы, дневные лимиты, промокоды и оплата через Platega (platega.io)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { needsBranding } = require('./publication');
const store = require('./db'); // SQLite: тарифы, промокоды, расход — ключ→JSON; платежи — отдельная таблица
const API = (process.env.PLATEGA_URL || 'https://app.platega.io').replace(/\/+$/, '');
const DAY = 864e5;

// null = без лимита
const DEF = {
  trialDays: 3, trialPlan: 'pro', // пробный период при регистрации (0 — выключен)
  burst: 20,   // антиабуз: не больше N сообщений за 5 минут на одного пользователя
  fair: 1000,  // антиабуз для «безлимита»: потолок сообщений в день
  plans: [
    { id: 'free', name: 'Free', price: 0, days: 0, tier: 0, msgs: 20, code: 3, sites: 3, images: 3, videos: 0, desc: 'Чтобы попробовать' },
    { id: 'pro', name: 'Pro', price: 390, days: 30, tier: 1, msgs: 300, code: 50, sites: 30, images: 30, videos: 3, desc: 'Все модели и запас на каждый день' },
    { id: 'max', name: 'Max', price: 990, days: 30, tier: 2, msgs: null, code: null, sites: null, images: 100, videos: 10, desc: 'Без ограничений — для работы' },
  ],
};
const cfg = () => {
  const c = store.kv.get('plans', null); if (!(c && Array.isArray(c.plans) && c.plans.length)) return JSON.parse(JSON.stringify(DEF));
  for (const p of c.plans) {
    if (p.images === undefined) p.images = (DEF.plans.find((x) => x.id === p.id) || { images: 10 }).images; // картинки стоят денег — по умолчанию с лимитом
    if (p.videos === undefined) p.videos = (DEF.plans.find((x) => x.id === p.id) || { videos: 0 }).videos; // видео ещё дороже
  }
  return { ...DEF, ...c };
};
const KEYS = { m: 'msgs', c: 'code', s: 'sites', i: 'images', v: 'videos' };

let US = null; // { loadUsers, saveUsers, loadSettings, saveSettings }
const init = (x) => { US = x; };

/* ---------- тариф пользователя ---------- */
function planOf(u) {
  const now = Date.now();
  let p = null;
  if (u.plan && u.until > now) p = cfg().plans.find((x) => x.id === u.plan) || null;
  if (!p) p = cfg().plans.find((x) => x.id === 'free');
  // временное админское продление лимита сообщений (u.msgExt = {limit, until}) — только вверх
  const ext = u && u.msgExt && u.msgExt.until > now && Number(u.msgExt.limit) > 0 ? Math.floor(Number(u.msgExt.limit)) : 0;
  if (ext && (p.msgs == null || ext > p.msgs)) return Object.assign({}, p, { msgs: ext, extUntil: u.msgExt.until, extLimit: ext });
  return p;
}
// продление: тот же тариф — от даты окончания; другой — остаток пересчитывается по цене
function extend(u, planId, days) {
  const c = cfg(), np = c.plans.find((p) => p.id === planId), now = Date.now();
  if (!np) throw new Error('Нет такого тарифа');
  let base = now;
  if (u.plan && u.until > now) {
    if (u.plan === planId) base = u.until;
    else { const op = c.plans.find((p) => p.id === u.plan); if (op && op.price && np.price) base = now + (u.until - now) * op.price / np.price; }
  }
  u.plan = planId; u.until = Math.round(base + days * DAY);
}
const updateUser = (uid, fn) => store.users.update(uid, fn);
// пробный период — не чаще одного раза в 30 дней с одного IP (иначе бесконечные аккаунты = бесплатный Pro)
function startTrial(u, ip) {
  const c = cfg(); if (!(c.trialDays > 0) || !c.plans.some((p) => p.id === c.trialPlan)) return false;
  if (ip) {
    const now = Date.now(), k = crypto.createHash('sha256').update('trial:' + ip).digest('hex').slice(0, 32);
    const t = Object.fromEntries(Object.entries(store.kv.get('trials', {})).filter(([, at]) => now - at < 30 * DAY));
    if (t[k]) return false;
    t[k] = now; store.kv.set('trials', t);
  }
  u.plan = c.trialPlan; u.until = Date.now() + c.trialDays * DAY; u.trial = true; return true;
}

/* ---------- дневной расход (сутки по Москве) ---------- */
const today = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
let U = { day: null, u: {} }, flushT = null;
function usage() { const d = today(); if (U.day !== d) { if (U.day) flush(); U = { day: d, u: store.kv.get('usage:' + d, {}) }; } return U; }
function flush() { clearTimeout(flushT); flushT = null; if (U.day) store.kv.set('usage:' + U.day, U.u); }
const used = (uid) => ({ m: 0, c: 0, s: 0, i: 0, v: 0, ...usage().u[uid] });
function add(uid, k, n = 1) { const x = usage(); const r = (x.u[uid] ||= { m: 0, c: 0, s: 0, i: 0, v: 0 }); r[k] = Math.max(0, (r[k] || 0) + n); if (!flushT) flushT = setTimeout(flush, 3000); }
function limitOf(p, k) { const v = p[KEYS[k]]; return v == null ? (k === 'm' ? cfg().fair || null : null) : v; }
function left(u, k) { const lim = limitOf(planOf(u), k); return lim == null ? Infinity : Math.max(0, lim - used(u.id)[k]); }
const burstHits = new Map();

// можно ли отправить сообщение этой модели; при успехе сразу списывает
function charge(u, model) {
  const c = cfg(), p = planOf(u), allowed = modelPlans(model);
  if (!allowed.includes(p.id)) { const np = c.plans.filter((x) => allowed.includes(x.id)).sort((a, b) => a.price - b.price)[0]; return { error: np ? `Модель «${model.name}» доступна на тарифе ${np.name}` : `Модель «${model.name}» сейчас недоступна`, code: 'model' }; }
  const w = Math.max(0.1, Number(model.weight) || 1);
  if (left(u, 'm') < w) { const rb = u.refBonus; if (rb && rb.n >= w && rb.until > Date.now()) store.users.update(u.id, (x) => { if (x.refBonus && x.refBonus.n > 0) x.refBonus.n -= w; }); else return { error: p.msgs == null ? 'Достигнут дневной предел. Он обновится в полночь по Москве.' : `Сообщения на сегодня закончились (${p.name}: ${p.msgs} в день). Лимит обновится в полночь по Москве.`, code: 'limit' }; }
  const now = Date.now(), h = (burstHits.get(u.id) || []).filter((t) => now - t < 5 * 60000);
  if (c.burst > 0 && h.length >= c.burst) return { error: 'Слишком много сообщений подряд. Подождите пару минут.', code: 'burst' };
  h.push(now); burstHits.set(u.id, h); add(u.id, 'm', w);
  return { ok: true, weight: w };
}

// на каких тарифах доступна модель (старые модели без списка — по «уровню»)
function modelPlans(m) { const c = cfg(); return Array.isArray(m.plans) ? m.plans.filter((id) => c.plans.some((p) => p.id === id)) : c.plans.filter((p) => p.tier >= (m.tier || 0)).map((p) => p.id); }
const publicPlans = () => cfg().plans.map(({ id, name, price, days, tier, msgs, code, sites, images, videos, desc }) => ({ id, name, price, days, tier, msgs, code, sites, images, videos, desc }));
function summary(u) {
  const p = planOf(u), x = used(u.id), c = cfg();
  return { publicationBranding: needsBranding(u, p), plan: { id: p.id, name: p.name, tier: p.tier, until: p.until, trial: !!(u.trial && p.until) }, used: x,
    limits: { m: limitOf(p, 'm'), c: limitOf(p, 'c'), s: limitOf(p, 's'), i: limitOf(p, 'i'), v: limitOf(p, 'v') }, images: !!(US.imagesOn && US.imagesOn()), videos: !!(US.videosOn && US.videosOn()), unlimited: p.msgs == null,
    plans: publicPlans(), pay: payReady() || cryptoReady() || cisReady() || rbReady(), methods: { card: payReady(), robokassa: rbReady(), cispay: cisReady(), crypto: cryptoReady() }, trialDays: c.trialDays, ref: refInfo(u) };
}


/* ---------- реферальная программа ---------- */
const REF_TIERS = [ { n: 3, kind: 'bonus' }, { n: 10, plan: 'pro', days: 7 }, { n: 25, plan: 'pro', days: 14 }, { n: 50, plan: 'pro', days: 30 }, { n: 100, plan: 'max', days: 30 } ];
const refOn = () => US.loadSettings().referrals !== false;
function refMergeBonus(uid, n, days) {
  const now = Date.now();
  store.users.update(uid, (x) => {
    const rb = x.refBonus && x.refBonus.n > 0 && x.refBonus.until > now ? x.refBonus : null;
    if (rb) { rb.n += n; rb.until = Math.max(rb.until, now + days * DAY); } else x.refBonus = { n, until: now + days * DAY };
    return x;
  });
}
function refBind(u, code, ip, fp) {
  if (!refOn()) return { code: 403, error: 'Реферальная программа сейчас выключена' };
  code = String(code || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  if (code.length < 8) return { code: 400, error: 'Некорректная ссылка приглашения' };
  if (code === u.id) return { code: 400, error: 'Нельзя пригласить самого себя' };
  const ref = store.users.get(code);
  if (!ref) return { code: 404, error: 'Такого пользователя нет' };
  if (store.db.prepare('SELECT 1 x FROM referrals WHERE id = ?').get(u.id)) return { code: 409, error: 'У вас уже есть пригласивший' };
  const d30 = Date.now() - 30 * 864e5;
  if (ip && store.db.prepare('SELECT 1 x FROM referrals WHERE ip = ? AND at > ?').get(ip, d30)) return { code: 409, error: 'С этого адреса уже был приглашён другой человек' };
  if (fp && store.db.prepare('SELECT 1 x FROM referrals WHERE fp = ? AND at > ?').get(fp, d30)) return { code: 409, error: 'С этого устройства уже был приглашён другой человек' };
  store.db.prepare("INSERT OR IGNORE INTO referrals (id, ref, ip, fp, status, msg, paid, at) VALUES (?, ?, ?, ?, 'pending', 0, 0, ?)").run(u.id, code, ip || '', fp || '', Date.now());
  refMergeBonus(u.id, 50, 3);
  console.log('ref: ' + u.id + ' -> ' + code + ' (привязка)');
  return { code: 200, ok: true, bonus: 50, by: ref.login };
}
function refMsgTick(uid) {
  try {
    const row = store.db.prepare("SELECT ref, status FROM referrals WHERE id = ?").get(uid);
    if (!row || row.status !== 'pending') return;
    const c = store.db.prepare('SELECT COALESCE(msg, 0) + 1 c FROM referrals WHERE id = ?').get(uid).c;
    store.db.prepare('UPDATE referrals SET msg = ? WHERE id = ?').run(c, uid);
    if (c >= 3) {
      store.db.prepare("UPDATE referrals SET status = 'active' WHERE id = ? AND status = 'pending'").run(uid);
      console.log('ref: ' + uid + ' активен -> ' + row.ref);
      refTierCheck(row.ref);
    }
  } catch (e) { console.log('refMsgTick:', e.message); }
}
function refTierCheck(inviterUid) {
  if (!refOn()) return;
  const active = store.db.prepare("SELECT COUNT(*) c FROM referrals WHERE ref = ? AND status = 'active'").get(inviterUid).c;
  const u = store.users.get(inviterUid); if (!u) return;
  const done = Array.isArray(u.refTiers) ? u.refTiers.slice() : [];
  let granted = false;
  for (const t of REF_TIERS) {
    if (active >= t.n && !done.includes(t.n)) {
      done.push(t.n); granted = true;
      if (t.kind === 'bonus') refMergeBonus(inviterUid, 50, 7);
      else {
        const plan = t.plan === 'max' ? 'max' : (planOf(u).id === 'max' ? 'max' : 'pro');
        extend(u, plan, t.days);
        console.log('ref: ' + inviterUid + ' порог ' + t.n + ' -> ' + plan + ' на ' + t.days + ' дн.');
      }
    }
  }
  if (granted) store.users.update(inviterUid, (x) => { x.plan = u.plan; x.until = u.until; x.refTiers = done; return x; });
}
function refPayHook(u) {
  try {
    if (!u || !refOn()) return;
    const row = store.db.prepare('SELECT ref, at, paid FROM referrals WHERE id = ?').get(u.id);
    if (!row || row.paid) return;
    if (Date.now() - row.at > 365 * 864e5) return;
    store.db.prepare('UPDATE referrals SET paid = 1 WHERE id = ?').run(u.id);
    const r = store.users.get(row.ref); if (!r) return;
    const plan = planOf(r).id === 'max' ? 'max' : 'pro';
    extend(r, plan, 2);
    store.users.update(row.ref, (x) => { x.plan = r.plan; x.until = r.until; return x; });
    console.log('ref: платёж ' + u.id + ' -> +2 дн. ' + plan + ' (' + row.ref + ')');
  } catch (e) { console.log('refPayHook:', e.message); }
}
function refInfo(u) {
  let active = 0, pending = 0, total = 0;
  try {
    for (const r of store.db.prepare('SELECT status, COUNT(*) c FROM referrals WHERE ref = ? GROUP BY status').all(u.id)) { total += r.c; if (r.status === 'active') active = r.c; else if (r.status === 'pending') pending = r.c; }
  } catch {}
  const tiers = REF_TIERS.map((t) => ({ n: t.n, done: (u.refTiers || []).includes(t.n) }));
  const next = tiers.find((t) => !t.done) || null;
  return { on: refOn(), code: u.id, active, pending, total, tiers, next: next ? { n: next.n, have: active, need: next.n - active } : null,
    bonus: u.refBonus && u.refBonus.n > 0 && u.refBonus.until > Date.now() ? { n: u.refBonus.n, until: u.refBonus.until } : null };
}

/* ---------- Robokassa: зарубежные карты Visa/MC/UnionPay ---------- */
function rbKeys() { return (US.loadSettings() || {}).robokassa || {}; }
function rbReady() { const k = rbKeys(); return !!(k.login && k.pass1 && k.pass2); }
async function createRobokassa(u, p, amount, promo, origin, id) {
  const k = rbKeys();
  const outSum = (Math.round(amount * 100) / 100).toFixed(2).replace('.', ',');
  const sig = crypto.createHash('md5').update(k.login + ':' + outSum + ':' + k.pass1).digest('hex');
  const params = new URLSearchParams({ MerchantLogin: k.login, OutSum: outSum, InvId: id, Description: 'Premier ' + p.name + ' — ' + p.days + ' дней (' + (u.login || '') + ')', SignatureProvider: sig, Culture: 'ru-RU', Encoding: 'utf-8', IsReturn: 'true', ReturnUrl: origin + '/chat?pay=ok&order=' + id, IsAccount: 'false' });
  if (u.email) params.set('ReceiptEmail', u.email);
  const r = await fetch('https://auth.robokassa.ru/IncomingGate/Payment/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString(), signal: AbortSignal.timeout(20000) });
  const html = await r.text();
  const m = html.match(/<form[^>]*>[\s\S]*?<\/form>/i);
  if (!r.ok || !m) throw new Error('Robokassa не принял платёж (HTTP ' + r.status + ') — попробуйте СБП или крипту');
  store.payments.put({ id, tx: id, uid: u.id, login: u.login, plan: p.id, days: p.days, amount, promo, status: 'PENDING', provider: 'robokassa', created: Date.now() });
  return { form: m[0], order: id };
}
// вебхук Robokassa (ResultUrl): параметры формы; подпись = MD5(MerchantLogin:OutSum:OperationId:Password2)
function rbCallback(b) {
  const k = rbKeys(); if (!k.pass2) return { code: 503, ok: false };
  const { MerchantLogin, OutSum, InvId, OperationId, Result, SignatureProvider } = b || {};
  const exp = crypto.createHash('md5').update([MerchantLogin, OutSum, OperationId, k.pass2].join(':')).digest('hex');
  if (!SignatureProvider || String(SignatureProvider).toLowerCase() !== exp) return { code: 401, ok: false };
  const pay = store.payments.get(String(InvId || ''));
  if (!pay) return { code: 200, ok: true, body: 'OK', ignored: 'no order' };
  const ns = { success: 'CONFIRMED', fail: 'CANCELED', cancel: 'CANCELED' }[String(Result || '').toLowerCase()];
  if (ns) { if (OperationId && pay.tx !== OperationId) pay.tx = OperationId; apply(pay, ns); }
  return { code: 200, ok: true, body: ns === 'CONFIRMED' ? 'OK' : 'FAIL' };
}
/* ---------- промокоды ---------- */
const loadPromos = () => store.kv.get('promos', []);
const savePromos = (x) => store.kv.set('promos', x);
function findPromo(code, uid) {
  const k = String(code || '').trim().toUpperCase(); if (!k) return { error: 'Введите промокод' };
  const pr = loadPromos().find((x) => x.code === k);
  if (!pr || (pr.until && pr.until < Date.now())) return { error: 'Промокод не найден или истёк' };
  if (pr.max && pr.used >= pr.max) return { error: 'Промокод уже использован максимальное число раз' };
  if ((pr.by || []).includes(uid)) return { error: 'Вы уже использовали этот промокод' };
  return { promo: pr };
}
function usePromo(code, uid) { const list = loadPromos(), pr = list.find((x) => x.code === code); if (pr) { pr.used = (pr.used || 0) + 1; pr.by = [...(pr.by || []), uid]; savePromos(list); } }
// подарочный промокод — сразу даёт тариф; скидочный — возвращает процент для оплаты
function redeem(u, code) {
  const r = findPromo(code, u.id); if (r.error) return r;
  const pr = r.promo;
  if (pr.kind === 'gift') { const nu = updateUser(u.id, (x) => extend(x, pr.plan, pr.days)); usePromo(pr.code, u.id); return { gift: true, plan: pr.plan, days: pr.days, until: nu.until }; }
  return { discount: pr.percent, plan: pr.plan || null, code: pr.code };
}

/* ---------- Platega ---------- */
function keys() {
  const st = US.loadSettings().platega || {};
  return { id: process.env.PLATEGA_MERCHANT_ID || st.merchant || '', secret: process.env.PLATEGA_SECRET || st.secret || '', env: !!process.env.PLATEGA_MERCHANT_ID };
}
const payReady = () => { const k = keys(); return !!(k.id && k.secret); };
async function pg(method, p, body) {
  const k = keys();
  const r = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json', 'X-MerchantId': k.id, 'X-Secret': k.secret }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch {}
  if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? 'Platega: неверный Merchant ID или секрет' : `Platega ${r.status}: ${String(j.message || j.error || t).slice(0, 200)}`);
  return j;
}
const loadPays = (n) => (n ? store.payments.recent(n) : store.payments.all()); // история платежей не обрезается

async function create(u, planId, promoCode, origin, ip, method) {
  const avail = { card: payReady(), robokassa: rbReady(), cispay: cisReady(), crypto: cryptoReady() };
  if (!method) method = avail.card ? 'card' : avail.robokassa ? 'robokassa' : avail.cispay ? 'cispay' : 'crypto';
  if (!avail[method]) throw new Error(Object.values(avail).some(Boolean) ? 'Этот способ оплаты сейчас недоступен — выберите другой' : 'Оплата пока не подключена. Напишите нам в Telegram.');
  const p = cfg().plans.find((x) => x.id === planId);
  if (!p || !(p.price > 0) || !(p.days > 0)) throw new Error('Этот тариф нельзя купить');
  let amount = p.price, promo = null;
  if (promoCode) {
    const r = findPromo(promoCode, u.id); if (r.error) throw new Error(r.error);
    if (r.promo.kind !== 'discount') throw new Error('Это подарочный промокод — активируйте его в поле «Промокод»');
    if (r.promo.plan && r.promo.plan !== planId) throw new Error('Промокод действует на другой тариф');
    promo = r.promo.code; amount = Math.max(1, Math.round(p.price * (100 - r.promo.percent) / 100));
  }
  const id = crypto.randomUUID();
  if (method === 'crypto') return createCrypto(u, p, amount, promo, origin, id);
  if (method === 'robokassa') return createRobokassa(u, p, amount, promo, origin, id);
  if (method === 'cispay') return createCispay(u, p, amount, promo, origin, id);
  const j = await pg('POST', '/v2/transaction/process', {
    paymentDetails: { amount, currency: 'RUB' },
    description: `Premier ${p.name} — ${p.days} дней (${u.login})`,
    return: `${origin}/chat?pay=ok&order=${id}`, failedUrl: `${origin}/chat?pay=fail&order=${id}`,
    payload: id, orderId: id, metadata: { userId: u.id, userName: u.login, ...(ip ? { clientIp: ip } : {}) },
  });
  const url = j.redirect || j.url || j.paymentUrl;
  if (!j.transactionId || !url) throw new Error('Platega не вернула ссылку на оплату');
  store.payments.put({ id, tx: j.transactionId, uid: u.id, login: u.login, plan: p.id, days: p.days, amount, promo, status: 'PENDING', created: Date.now() });
  return { url, order: id };
}

// применить новый статус платежа (идемпотентно)
function apply(pay, status) {
  if (!status || status === pay.status) return pay;
  return store.tx(() => { // статус, дни тарифа и промокод меняются вместе или не меняются вовсе
  const it = store.payments.get(pay.id); if (!it || it.status === status) return it || pay;
  const was = it.status; it.status = status; it.updated = Date.now();
  if (status === 'CONFIRMED' && !it.applied) {
    updateUser(it.uid, (x) => { extend(x, it.plan, it.days); delete x.trial; });
    it.applied = true; it.paid = Date.now(); if (it.promo) usePromo(it.promo, it.uid);
    refPayHook(store.users.get(it.uid));
  } else if (status === 'CHARGEBACKED' && it.applied) { // возврат — забираем оплаченные дни
    updateUser(it.uid, (x) => { if (x.plan === it.plan && x.until) x.until -= it.days * DAY; });
    it.applied = false;
  }
  store.payments.put(it); console.log(`${it.provider === 'crypto' ? 'Crypto Bot' : it.provider === 'robokassa' ? 'Robokassa' : it.provider === 'cispay' ? 'cISPay' : 'Platega'}: ${it.id} ${was} → ${status} (${it.login}, ${it.plan})`);
  return it;
  });
}
async function sync(pay) {
  if (!pay || !pay.tx) return pay;
  if (pay.provider === 'cispay') {
    const k = cisKeys(); if (!k.shopId || !k.apiKey) return pay;
    const r = await fetch('https://api.cispay.app/payments/status?id=' + encodeURIComponent(pay.tx), { headers: { 'X-Shop-Id': k.shopId, 'X-Api-Key': k.apiKey }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) return pay;
    const j = await r.json().catch(() => ({}));
    return apply(pay, { pending: 'PENDING', paid: 'CONFIRMED', failed: 'CANCELED', expired: 'CANCELED', refunded: 'CHARGEBACKED' }[String(j.status || '').toLowerCase()] || pay.status);
  }
  if (pay.provider === 'crypto') {
    const r = await cb('getInvoices', { invoice_ids: String(pay.tx) }), inv = (r.items || [])[0];
    if (!inv) return pay;
    return apply(pay, { active: 'PENDING', paid: 'CONFIRMED', expired: 'CANCELED' }[inv.status] || pay.status);
  }
  if (pay.provider === 'robokassa') return pay; // статус приходит только вебхуком (Robokassa его дублирует)
  const j = await pg('GET', '/transaction/' + encodeURIComponent(pay.tx));
  return apply(pay, String(j.status || '').toUpperCase());
}
const findPay = (q) => (q ? store.payments.find(q) : null);

// колбэк Platega: проверяем заголовки, затем перепроверяем статус запросом к API
async function callback(headers, body) {
  const k = keys(), eq = (a, b) => { a = Buffer.from(String(a || '')); b = Buffer.from(String(b || '')); return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b); };
  if (!eq(headers['x-merchantid'], k.id) || !eq(headers['x-secret'], k.secret)) return { code: 401 };
  const pay = findPay(String(body.id || '')) || findPay(String(body.payload || ''));
  if (!pay) return { code: 200 }; // чужой/старый платёж — подтверждаем, чтобы не было повторов
  try { await sync(pay); } catch (e) { console.log('Platega: перепроверка не удалась, беру статус из колбэка:', e.message); apply(pay, String(body.status || '').toUpperCase()); }
  return { code: 200 };
}

/* ---------- Crypto Bot (Crypto Pay API, @CryptoBot / @CryptoTestnetBot) ---------- */
const CRYPTO_ASSETS = 'USDT,TON,BTC,ETH,LTC,BNB,TRX,USDC';
function cryptoKeys() {
  const st = US.loadSettings().cryptobot || {};
  const token = process.env.CRYPTOPAY_TOKEN || st.token || '';
  const testnet = process.env.CRYPTOPAY_TESTNET ? process.env.CRYPTOPAY_TESTNET === '1' : !!st.testnet;
  return { token, testnet, env: !!process.env.CRYPTOPAY_TOKEN, assets: (st.assets || CRYPTO_ASSETS).toUpperCase().replace(/[^A-Z,]/g, '').split(',').filter(Boolean).join(',') || CRYPTO_ASSETS };
}
const cryptoReady = () => !!cryptoKeys().token;
async function cb(method, params) {
  const k = cryptoKeys(); if (!k.token) throw new Error('Crypto Bot не подключён');
  const r = await fetch(`https://${k.testnet ? 'testnet-' : ''}pay.crypt.bot/api/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Crypto-Pay-API-Token': k.token }, body: JSON.stringify(params || {}), signal: AbortSignal.timeout(20000) });
  const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch {}
  if (!j.ok) {
    const n = j.error?.name || j.error?.code || r.status;
    throw new Error(/UNAUTHORIZED|401|EXPIRED_TOKEN/i.test(String(n)) ? 'Crypto Bot: неверный API-токен' + (k.testnet ? ' (включена тестовая сеть — токен должен быть из @CryptoTestnetBot)' : '') : `Crypto Bot: ${String(j.error?.name || j.error?.message || t).slice(0, 200)}`);
  }
  return j.result;
}
async function createCrypto(u, p, amount, promo, origin, id) {
  const k = cryptoKeys();
  const inv = await cb('createInvoice', {
    currency_type: 'fiat', fiat: 'RUB', amount: String(amount), accepted_assets: k.assets,
    description: `Premier ${p.name} — ${p.days} дней`.slice(0, 1024), payload: id, expires_in: 3600, allow_comments: false, allow_anonymous: true,
    ...(/^https:\/\//.test(origin) ? { paid_btn_name: 'callback', paid_btn_url: `${origin}/chat?pay=ok&order=${id}` } : {}),
  });
  const url = inv.bot_invoice_url || inv.mini_app_invoice_url || inv.web_app_invoice_url || inv.pay_url;
  if (!inv.invoice_id || !url) throw new Error('Crypto Bot не вернул ссылку на оплату');
  store.payments.put({ id, tx: String(inv.invoice_id), provider: 'crypto', uid: u.id, login: u.login, plan: p.id, days: p.days, amount, promo, status: 'PENDING', created: Date.now() });
  return { url, order: id, method: 'crypto' };
}
// вебхук Crypto Pay: подпись = HMAC-SHA256(тело запроса, ключ = SHA256(токен)), затем перепроверка статуса запросом к API
async function cryptoCallback(headers, raw) {
  const k = cryptoKeys(); if (!k.token) return { code: 401 };
  const sig = String(headers['crypto-pay-api-signature'] || ''), want = crypto.createHmac('sha256', crypto.createHash('sha256').update(k.token).digest()).update(raw).digest('hex');
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return { code: 401 };
  let body = {}; try { body = JSON.parse(raw); } catch { return { code: 400 }; }
  if (body.update_type !== 'invoice_paid') return { code: 200 };
  const inv = body.payload || {}, pay = findPay(String(inv.payload || '')) || store.payments.byTx(String(inv.invoice_id), 'crypto');
  if (!pay || pay.provider !== 'crypto' || pay.tx !== String(inv.invoice_id)) return { code: 200 };
  try { await sync(pay); } catch (e) { console.log('Crypto Bot: перепроверка не удалась, беру статус из вебхука:', e.message); if (inv.status === 'paid') apply(pay, 'CONFIRMED'); }
  return { code: 200 };
}
const cryptoMe = () => cb('getMe');

// cISPay (СБП): настройки магазина, создание платежа, вебхук
const cisKeys = () => US.loadSettings().cispay || {};
const cisReady = () => { const k = cisKeys(); return !!(k.shopId && k.apiKey); };
async function cisPost(body) {
  const k = cisKeys();
  const r = await fetch('https://api.cispay.app/payments', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shop-Id': k.shopId, 'X-Api-Key': k.apiKey }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch {}
  if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? 'cISPay: неверный Shop ID или API Key' : `cISPay ${r.status}: ${String(j.detail || t).slice(0, 200)}`);
  return j;
}
async function createCispay(u, p, amount, promo, origin, id) {
  const j = await cisPost({ amount: Math.round(amount * 100), currency: 'RUB', order_id: id, customer_id: u.email || u.login, description: `Premier ${p.name} — ${p.days} дней (${u.login})` });
  if (!j.payment_url) throw new Error('cISPay не вернул ссылку на оплату');
  store.payments.put({ id, tx: j.id, uid: u.id, login: u.login, plan: p.id, days: p.days, amount, promo, status: 'PENDING', provider: 'cispay', created: Date.now() });
  return { url: j.payment_url, order: id };
}
// вебхук cISPay: подпись = HMAC-SHA256(тело как есть, ключ = API Key) в x-signature
function cisCallback(hd, raw) {
  const k = cisKeys(); if (!k.apiKey) return { code: 503, ok: false };
  const sig = String(hd['x-signature'] || ''), exp = crypto.createHmac('sha256', k.apiKey).update(raw).digest('hex');
  if (!sig || sig.length !== exp.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) return { code: 401, ok: false };
  let ev; try { ev = JSON.parse(raw); } catch { return { code: 400, ok: false }; }
  const pay = store.payments.get(ev.order_id);
  if (!pay) return { code: 200, ok: true, ignored: 'no order' };
  if (ev.is_sandbox && k.sandboxOk === false) return { code: 200, ok: true, ignored: 'sandbox' };
  const map = { paid: 'CONFIRMED', failed: 'CANCELED', expired: 'CANCELED', refunded: 'CHARGEBACKED' };
  const ns = map[String(ev.status || '').toLowerCase()];
  if (ns) { apply(pay, ns); console.log('cispay webhook ' + pay.id + ' ' + ev.status + (ev.is_sandbox ? ' (sandbox)' : '') + ' -> ' + ns); }
  return { code: 200, ok: true };
}

/* ---------- статистика для панели ---------- */
function stats() {
  const users = store.users.all(), c = cfg(), now = Date.now(), days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now + 3 * 3600e3 - i * DAY).toISOString().slice(0, 10);
    const u = d === today() ? usage().u : store.kv.get('usage:' + d, {});
    const v = Object.values(u); days.push({ d, m: v.reduce((n, x) => n + (x.m || 0), 0), c: v.reduce((n, x) => n + (x.c || 0), 0), s: v.reduce((n, x) => n + (x.s || 0), 0), i: v.reduce((n, x) => n + (x.i || 0), 0), v: v.reduce((n, x) => n + (x.v || 0), 0), users: v.filter((x) => x.m > 0).length });
  }
  const plans = Object.fromEntries(c.plans.map((p) => [p.id, 0]));
  for (const u of users) plans[planOf(u).id] = (plans[planOf(u).id] || 0) + 1;
  const ok = store.payments.byStatus('CONFIRMED');
  return { days, plans, users: users.length, revenue30: ok.filter((x) => (x.paid || x.created) > now - 30 * DAY).reduce((n, x) => n + x.amount, 0), revenue: ok.reduce((n, x) => n + x.amount, 0), paid: ok.length };
}

function saveCfg(b) {
  const c = cfg(), num = (v, d) => (v === null || v === '' ? null : Number.isFinite(+v) && +v >= 0 ? Math.round(+v) : d);
  for (const p of c.plans) {
    const n = (b.plans || []).find((x) => x.id === p.id); if (!n) continue;
    if (typeof n.name === 'string' && n.name.trim()) p.name = n.name.trim().slice(0, 30);
    if (typeof n.desc === 'string') p.desc = n.desc.trim().slice(0, 120);
    if (p.id !== 'free') { p.price = num(n.price, p.price) ?? p.price; p.days = Math.max(1, num(n.days, p.days) ?? p.days); }
    for (const k of ['msgs', 'code', 'sites', 'images', 'videos']) if (k in n) p[k] = num(n[k], p[k]);
  }
  if ('trialDays' in b) c.trialDays = Math.min(90, num(b.trialDays, c.trialDays) ?? 0);
  if ('burst' in b) c.burst = num(b.burst, c.burst) ?? 0;
  if ('fair' in b) c.fair = num(b.fair, c.fair);
  store.kv.set('plans', c); return c;
}

module.exports = { modelPlans, init, cfg, saveCfg, planOf, extend, updateUser, startTrial, used, add, left, limitOf, charge, summary, publicPlans, redeem, loadPromos, savePromos, keys, payReady, cryptoKeys, cryptoReady, cryptoCallback, cryptoMe, create, sync, findPay, cisKeys, cisReady, cisCallback, createCispay, rbKeys, rbReady, rbCallback, refBind, refMsgTick, refInfo, refTierCheck, refMergeBonus, refPayHook, loadPays, callback, stats, flush };
