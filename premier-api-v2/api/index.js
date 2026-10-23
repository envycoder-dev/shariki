'use strict';
// Кабинет разработчика: /api/dev/* (вход по сессии сайта) и /api/connect/* (скрипт подключения, без входа).
const { createKeys } = require('./keys');
const { createUsage } = require('./usage');
const { createGateway } = require('./gateway');
const { createConnect } = require('./connect');
const { createAgentCheck, ensureSlugs } = require('./models');
const { clients } = require('./clients');
const scripts = require('./scripts');

function createApi(d) {
  // d: { store, bill, loadModels, loadSettings, monitor, clientIp, currentUser, json, origin, languageOf, readBody }
  const keys = createKeys(d.store), usage = createUsage(d.store);
  const agent = createAgentCheck(d.store, d.loadModels, d.monitor);
  const gateway = createGateway({ ...d, keys, usage });
  const fail = (status, message) => Object.assign(new Error(message), { status });

  const planIds = (user) => d.bill.planOf(user).id;
  const modelView = (m, user) => {
    const plans = d.bill.modelPlans(m), ok = plans.includes(planIds(user));
    const np = ok ? null : d.bill.cfg().plans.filter((p) => plans.includes(p.id)).sort((a, b) => a.price - b.price)[0];
    return { id: m.slug, name: m.name, weight: Math.max(0.1, Number(m.weight) || 1), vision: !!m.vision, available: ok, plan_hint: np ? np.name : null, agent: agent.status(m), def: m.id === d.loadSettings().defaultModel, native: m.native || null };
  };
  // модели по умолчанию для подключения: основная — умеет инструменты; быстрая — самая «лёгкая» из подходящих
  function pickModels(user) {
    const list = gateway.available(user, null), ok = list.filter((m) => agent.status(m) !== false);
    const pool = ok.length ? ok : list, def = d.loadSettings().defaultModel;
    const main = pool.find((m) => m.id === def && agent.status(m) === true) || pool.find((m) => agent.status(m) === true) || pool.find((m) => m.id === def) || pool[0];
    const fast = main ? [...pool].sort((a, b) => (Number(a.weight) || 1) - (Number(b.weight) || 1))[0] : null;
    return { model: main ? main.slug : '', fast: fast ? fast.slug : '', native: main && main.native === 'anthropic' ? '1' : '0' };
  }
  const connect = createConnect({ keys, pickModels });

  const keyView = (k, today) => ({ ...k, requests_today: today.get(k.id) || 0 });
  const sameOrigin = (req) => {
    const origin = req.headers.origin;
    if (req.headers['sec-fetch-site'] === 'cross-site' || (origin && origin !== d.origin(req)) || !String(req.headers['content-type'] || '').startsWith('application/json'))
      throw fail(403, 'Запрос должен быть с вашего сайта и в формате JSON');
  };
  const checkModels = (b) => {
    if (!Array.isArray(b.models) || !b.models.length) return;
    const known = new Set(d.loadModels().map((m) => m.slug));
    const bad = b.models.find((x) => !known.has(String(x).trim()));
    if (bad) throw fail(400, `Нет модели с ID «${String(bad).slice(0, 64)}»`);
  };

  // скрипту подключения удобнее «ключ=значение» построчно, чем JSON
  const reply = (res, url, data, status = 200) => {
    if (url.searchParams.get('format') === 'env') {
      res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(Object.entries(data).filter(([, v]) => v != null && typeof v !== 'object').map(([k, v]) => `${k}=${String(v).replace(/[\r\n]/g, ' ')}`).join('\n') + '\n');
    }
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  };

  async function handle(req, res, url) {
    const p = url.pathname, m = req.method, origin = d.origin(req);
    if (p === '/api/connect/start' || p === '/api/connect/poll') {
      if (m !== 'POST') return reply(res, url, { error: 'Use POST' }, 405);
      let b = {};
      try { b = await d.readBody(req, 4096); } catch { return reply(res, url, { error: 'Некорректный запрос' }, 400); }
      try {
        if (p === '/api/connect/start') { const s = connect.start(b || {}, d.clientIp(req)); return reply(res, url, { ...s, url: `${origin}/developers?connect=${s.code}` }); }
        const r = connect.poll(b && b.device);
        if (r.status === 'approved') return reply(res, url, { ...r, base_url: origin, native: (d.loadModels().find((x) => x.slug === r.model) || {}).native === 'anthropic' ? '1' : '0' });
        return reply(res, url, r);
      } catch (e) { return reply(res, url, { error: e.status ? e.message : 'Ошибка сервера' }, e.status || 500); }
    }

    const user = d.currentUser(req);
    if (!user) return d.json(res, 401, { error: 'Войдите в аккаунт' });
    if (m !== 'GET') sameOrigin(req);
    const json = (code, data) => d.json(res, code, data);

    if (p === '/api/dev/state' && m === 'GET') {
      const today = usage.todayByKey(user.id), plan = d.bill.planOf(user), used = d.bill.used(user.id).m;
      return json(200, {
        base_url: origin,
        user: { name: user.name || user.login || '', email: user.email || '' },
        plan: { id: plan.id, name: plan.name, trial: !!(user.trial && user.until > Date.now()), until: plan.id === 'free' ? null : user.until || null },
        usage: { used: Math.round(used * 10) / 10, limit: d.bill.limitOf(plan, 'm'), resets_at: d.bill.resetsAt() },
        limits: gateway.limits,
        models: d.loadModels().map((x) => modelView(x, user)),
        keys: keys.list(user.id).map((k) => keyView(k, today)),
        connect: { sh: `curl -fsSL ${origin}/connect.sh | sh`, ps: `irm ${origin}/connect.ps1 | iex` },
      });
    }
    if (p === '/api/dev/keys' && m === 'POST') {
      const b = await d.readBody(req, 16384); checkModels(b);
      const r = keys.create(user.id, b);
      return json(201, { key: r.key, item: keyView(r.item, new Map()) });
    }
    const km = /^\/api\/dev\/keys\/([A-Za-z0-9]{16})(\/roll)?$/.exec(p);
    if (km) {
      const today = usage.todayByKey(user.id);
      if (km[2] && m === 'POST') { const r = keys.roll(user.id, km[1]); return r ? json(200, { key: r.key, item: keyView(r.item, today) }) : json(404, { error: 'Ключ не найден' }); }
      if (!km[2] && m === 'PATCH') { const b = await d.readBody(req, 16384); checkModels(b); const it = keys.update(user.id, km[1], b); return it ? json(200, { item: keyView(it, today) }) : json(404, { error: 'Ключ не найден' }); }
      if (!km[2] && m === 'DELETE') return keys.remove(user.id, km[1]) ? json(200, { ok: true }) : json(404, { error: 'Ключ не найден' });
    }
    if (p === '/api/dev/usage' && m === 'GET') {
      const s = usage.stats(user.id, Number(url.searchParams.get('days')) || 30), names = new Map(d.loadModels().map((x) => [x.slug, x.name]));
      return json(200, { ...s, by_model: s.by_model.map((r) => ({ ...r, name: names.get(r.model) || r.model })) });
    }
    if (p === '/api/dev/logs' && m === 'GET') {
      const r = usage.list(user.id, { limit: Number(url.searchParams.get('limit')) || 50, before: url.searchParams.get('before'), key: url.searchParams.get('key') });
      const names = new Map(keys.list(user.id).map((k) => [k.id, k.name]));
      return json(200, { items: r.items.map((x) => ({ ...x, key_name: x.key_id ? names.get(x.key_id) || null : null })), next: r.next });
    }
    if (p === '/api/dev/clients' && m === 'GET') {
      const all = d.loadModels().filter((x) => d.bill.modelPlans(x).includes(planIds(user)));
      const pick = pickModels(user);
      const mm = all.find((x) => x.slug === url.searchParams.get('model')) || all.find((x) => x.slug === pick.model) || null;
      const fast = all.find((x) => x.slug === url.searchParams.get('fast')) || all.find((x) => x.slug === pick.fast) || mm;
      return json(200, { clients: clients(d.languageOf(req), origin, mm && { id: mm.slug, name: mm.name, vision: !!mm.vision, native: mm.native }, fast && fast.slug) });
    }
    const cm = /^\/api\/dev\/connect\/([A-Za-z]{4}-?[A-Za-z]{4})$/.exec(p);
    if (cm) {
      const code = cm[1].toUpperCase().replace(/^(.{4})-?(.{4})$/, '$1-$2');
      if (m === 'GET') { const i = connect.info(code); return i ? json(200, i) : json(404, { error: 'Код устарел или не найден' }); }
      if (m === 'POST') { const b = await d.readBody(req, 4096); const r = connect.decide(code, user, b && b.action); return r ? json(200, { ok: true }) : json(404, { error: 'Код устарел или не найден' }); }
    }
    if (p === '/api/dev/playground' && m === 'POST') {
      const b = await d.readBody(req, 262144);
      const msgs = Array.isArray(b.messages) ? b.messages.filter((x) => x && ['system', 'user', 'assistant'].includes(x.role) && typeof x.content === 'string' && x.content.length <= 100000) : [];
      if (!msgs.some((x) => x.role === 'user' && x.content.trim())) return json(400, { error: 'Напишите сообщение' });
      const max = Number.isInteger(b.max_tokens) && b.max_tokens > 0 ? Math.min(b.max_tokens, 8192) : 2048;
      return gateway.generate({ req, res, proto: 'chat', body: { model: b.model, messages: msgs, stream: true, stream_options: { include_usage: true }, max_tokens: max }, user, key: null, client: 'Playground', ip: d.clientIp(req), origin });
    }
    return json(404, { error: 'Not found' });
  }

  return {
    keys, usage, agent, gateway, ensureSlugs,
    matches: (p) => p.startsWith('/api/dev/') || p === '/api/connect/start' || p === '/api/connect/poll',
    handle,
    handleV1: gateway.handle,
    script: (kind, req) => (kind === 'sh' ? scripts.sh(d.origin(req)) : scripts.ps1(d.origin(req))),
  };
}

module.exports = { createApi };
