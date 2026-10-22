'use strict';
// /v1 — API для Cursor, Codex, Claude Code и SDK. Три протокола поверх OpenAI-совместимых провайдеров.
const { err, sendError, sseStream, readJson, readSse, estimateTokens, detectClient } = require('./util');
const conv = require('./convert');
const up = require('./upstream');
const { MessagesOut, ResponsesOut, ChatOut, THINK_SIG } = require('./output');
const { resolve } = require('./models');

const BODY_LIMIT = Math.max(1, Number(process.env.API_BODY_MB) || 32) * 1048576;
const RPM = Math.max(1, Number(process.env.API_RPM) || 60);
const CONCURRENCY = Math.max(1, Number(process.env.API_CONCURRENCY) || 6);
const ROUTES = { '/v1/chat/completions': 'chat', '/v1/responses': 'responses', '/v1/messages': 'messages' };

function createGateway(d) {
  // d: { store, bill, loadModels, loadSettings, monitor, clientIp, keys, usage, origin }
  const active = new Map(), hits = new Map(), fails = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, v] of fails) if (v.until < now) fails.delete(k); for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > 60000) hits.delete(k); }, 60000).unref();
  const alert = (text) => d.monitor.alert && d.monitor.alert('API: ' + text);

  function cors(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', String(req.headers['access-control-request-headers'] || 'authorization, content-type, x-api-key, anthropic-version, anthropic-beta').replace(/[^\w\s,-]/g, '').slice(0, 1000));
    res.setHeader('Access-Control-Expose-Headers', 'retry-after, x-should-retry, request-id');
    res.setHeader('Access-Control-Max-Age', '86400');
  }

  function authenticate(req, ip, origin) {
    const now = Date.now(), f = fails.get(ip);
    if (f && f.until > now && f.n >= 30) throw err('rate_limit', 'Too many failed authentication attempts. Wait a minute.', { retryAfter: Math.ceil((f.until - now) / 1000), shouldRetry: false });
    const h = req.headers;
    const raw = ((/^Bearer\s+(\S+)\s*$/i.exec(String(h.authorization || '')) || [])[1] || String(h['x-api-key'] || h['api-key'] || '')).trim();
    if (!raw) throw err('auth', `Missing API key. Send it as "Authorization: Bearer prm_…" or "x-api-key". Create a key at ${origin}/developers`);
    const v = d.keys.verify(raw, ip);
    if (v.error) {
      if (v.error !== 'ip') { const x = f && f.until > now ? f : { n: 0, until: now + 600000 }; x.n++; fails.set(ip, x); }
      if (v.error === 'format') throw err('auth', 'Invalid API key format. Premier keys look like "prm_…" (46 characters). Copy the key again without spaces.');
      if (v.error === 'expired') throw err('auth', `This API key has expired. Create a new one at ${origin}/developers`);
      if (v.error === 'ip') throw err('permission', `This API key is not allowed from IP ${v.ip}. Edit the key's IP allowlist at ${origin}/developers`);
      throw err('auth', `Invalid API key: it was revoked, rolled or never existed. Check it at ${origin}/developers`);
    }
    const user = d.store.users.get(v.uid);
    if (!user) throw err('auth', 'The account that owns this API key no longer exists.');
    return { key: v.key, user };
  }

  const available = (user, key) => {
    const plan = d.bill.planOf(user).id;
    return d.loadModels().filter((m) => d.bill.modelPlans(m).includes(plan) && (!key || !key.models || key.models.includes(m.slug)));
  };
  const modelObj = (m, anthropic) => (anthropic
    ? { type: 'model', id: m.slug, display_name: m.name, created_at: '2025-01-01T00:00:00Z' }
    : { id: m.slug, object: 'model', created: 1735689600, owned_by: 'premier', name: m.name });

  function takeSlot(uid) {
    const now = Date.now(), h = (hits.get(uid) || []).filter((t) => now - t < 60000);
    if (h.length >= RPM) throw err('rate_limit', `Rate limit: up to ${RPM} requests per minute. Retry shortly.`, { retryAfter: Math.max(1, Math.ceil((h[0] + 60000 - now) / 1000)), shouldRetry: true });
    const a = active.get(uid) || 0;
    if (a >= CONCURRENCY) throw err('rate_limit', `Too many parallel requests: up to ${CONCURRENCY} at a time. Retry shortly.`, { retryAfter: 2, shouldRetry: true });
    h.push(now); hits.set(uid, h); active.set(uid, a + 1);
  }
  const release = (uid) => { const a = (active.get(uid) || 1) - 1; if (a > 0) active.set(uid, a); else active.delete(uid); };

  function quotaError(user, origin) {
    const plan = d.bill.planOf(user), lim = d.bill.limitOf(plan, 'm'), secs = Math.max(60, Math.ceil((d.bill.resetsAt() - Date.now()) / 1000));
    const h = Math.floor(secs / 3600), m = Math.ceil((secs % 3600) / 60);
    return err('quota', `Сообщения на сегодня закончились (${lim ?? '∞'} на тарифе ${plan.name}; лимит общий с чатом). Обновится в 00:00 по Москве — через ${h ? h + ' ч ' : ''}${m} мин. Больше сообщений — на ${origin}/chat. / Daily message limit reached; it resets at 00:00 Moscow time.`, { retryAfter: secs, shouldRetry: false });
  }

  /* ---------- генерация ---------- */
  // ctx: { req, res, proto, body, user, key, client, ip, origin }
  async function generate(ctx) {
    const { req, res, proto, body, user, key } = ctx;
    const started = Date.now();
    const log = { uid: user.id, key_id: key ? key.id : null, proto, client: ctx.client, stream: body.stream === true, status: 200, model: typeof body.model === 'string' ? body.model.slice(0, 64) : null, at: started };
    const ac = new AbortController();
    res.on('close', () => { if (!res.writableFinished) ac.abort(new Error('client closed')); });
    let charge = null, slot = false, delivered = false, ttft = null, usage = null;
    try {
      const parsed = proto === 'chat' ? conv.fromChat(body) : proto === 'responses' ? conv.fromResponses(body) : conv.fromMessages(body);
      log.stream = parsed.stream;
      const models = d.loadModels(), model = resolve(models, body.model);
      if (!model) {
        const list = available(user, key).map((m) => m.slug);
        throw err('not_found', typeof body.model === 'string' && body.model ? `Model "${body.model.slice(0, 100)}" not found. Available: ${list.slice(0, 25).join(', ') || 'none'}.` : 'model: field required. Available: ' + list.slice(0, 25).join(', '), { param: 'model' });
      }
      log.model = model.slug;
      if (key && key.models && !key.models.includes(model.slug)) throw err('permission', `This API key may only use: ${key.models.join(', ')}. Change it at ${ctx.origin}/developers`);
      const plan = d.bill.planOf(user), plans = d.bill.modelPlans(model);
      if (!plans.includes(plan.id)) {
        const np = d.bill.cfg().plans.filter((p) => plans.includes(p.id)).sort((a, b) => a.price - b.price)[0];
        throw err('permission', np ? `Модель «${model.name}» доступна на тарифе ${np.name} — ${ctx.origin}/chat. / "${model.slug}" requires the ${np.name} plan.` : `"${model.slug}" is not available right now.`);
      }
      takeSlot(user.id); slot = true;
      const ch = d.bill.charge(user, model, { burst: false });
      if (ch.error) throw ch.code === 'model' ? err('permission', ch.error) : quotaError(user, ctx.origin);
      charge = ch; log.cost = ch.weight;
      try { d.bill.refMsgTick(user.id); } catch {}
      d.bill.flush();

      const native = (model.native === 'anthropic' && proto === 'messages') || (model.native === 'responses' && proto === 'responses');
      const r = native ? await passthrough(ctx, model, ac.signal, started) : await translated(ctx, parsed, model, ac.signal, started);
      ({ delivered, ttft, usage } = r);
      if (r.error) { log.status = r.error.status; log.err = r.error.message; }
    } catch (e) {
      if (!e || !e.kind) { d.monitor.error('API ' + proto, e); e = err('server', 'Internal server error. It has been logged.'); }
      if (ac.signal.aborted && !res.headersSent) e = err('invalid', 'Client closed the request');
      log.status = ac.signal.aborted && e.kind === 'invalid' ? 499 : e.status; log.err = e.message;
      if (!res.headersSent && !res.destroyed) {
        if (e.raw && e.upstreamStatus) { res.writeHead(e.upstreamStatus, { 'Content-Type': 'application/json' }); res.end(e.raw); }
        else sendError(res, e, proto === 'messages' ? 'messages' : 'openai');
      } else if (!res.writableEnded) res.end();
    } finally {
      if (slot) release(user.id);
      if (charge && !delivered) { d.bill.refund(user, charge); log.cost = 0; }
      log.ms = Date.now() - started; log.ttft = ttft;
      if (usage) { log.in_tok = usage.in; log.out_tok = usage.out; }
      d.usage.log(log);
    }
  }

  async function translated(ctx, parsed, model, signal, started) {
    const { res, proto } = ctx;
    const body = { ...parsed.body, stream: true, stream_options: { include_usage: true } };
    if (!model.vision && conv.hasMedia(body.messages)) conv.stripMedia(body.messages);
    const inputEst = estimateTokens(body.messages, body.tools);
    const upstream = await up.open(model, body, { signal, onAlert: alert });
    const sse = parsed.stream ? sseStream(res, { anthropic: proto === 'messages' }) : null;
    const out = proto === 'messages' ? new MessagesOut({ sse, model: model.slug, thinking: parsed.wantsThinking, inputEst })
      : proto === 'responses' ? new ResponsesOut({ sse, model: model.slug, req: ctx.body, custom: parsed.custom, shell: parsed.shell, ns: parsed.ns, inputEst })
      : new ChatOut({ sse, model: model.slug, includeUsage: parsed.includeUsage, inputEst });
    let ttft = null;
    try {
      await out.start();
      const r = await up.pump(upstream, {
        signal,
        onEvent: async (e) => { if (ttft == null && e.t !== 'args') ttft = Date.now() - started; await out.on(e); },
        onChunk: proto === 'chat' && sse ? (j) => out.chunk(j) : null,
      });
      const fin = await out.finish(r);
      if (sse) { sse.end(); return { delivered: out.delivered, ttft, usage: fin }; }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(fin.body));
      return { delivered: out.delivered, ttft, usage: fin.u };
    } catch (e) {
      if (!sse) { upstream.done(); throw e; }
      const ex = e && e.kind ? e : err('server', 'Internal server error. It has been logged.');
      if (!(e && e.kind)) d.monitor.error('API stream ' + proto, e);
      if (!signal.aborted) { try { await out.fail(ex); } catch {} }
      sse.end();
      return { delivered: out.delivered, ttft, usage: null, error: { status: signal.aborted ? 499 : ex.status, message: ex.message } };
    }
  }

  // Провайдер сам говорит на протоколе клиента (Anthropic Messages / OpenAI Responses) — передаём без перевода:
  // сохраняются кэш промпта, thinking, beta-возможности.
  async function passthrough(ctx, model, signal, started) {
    const { req, res, proto, body } = ctx;
    const b = { ...body, model: model.modelId || model.id };
    let headers;
    if (proto === 'messages') {
      // «размышления», которые выдал шлюз в переводном режиме, у настоящего Anthropic не пройдут проверку подписи
      if (Array.isArray(b.messages)) b.messages = b.messages.map((m) => (Array.isArray(m && m.content) ? { ...m, content: m.content.filter((c) => !(c && (c.type === 'thinking' || c.type === 'redacted_thinking') && c.signature === THINK_SIG)) } : m));
      headers = { 'Content-Type': 'application/json', 'anthropic-version': String(req.headers['anthropic-version'] || '2023-06-01'), 'x-api-key': model.apiKey };
      if (req.headers['anthropic-beta']) headers['anthropic-beta'] = String(req.headers['anthropic-beta']);
      if (!/(^|\.)anthropic\.com$/i.test(hostOf(up.nativeUrl(model)))) headers.Authorization = 'Bearer ' + model.apiKey;
    } else {
      if (Array.isArray(b.input)) b.input = b.input.filter((it) => !(it && it.type === 'reasoning' && !it.encrypted_content));
      headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + model.apiKey };
    }
    let upstream;
    try { upstream = await up.open(model, b, { signal, url: up.nativeUrl(model), headers, native: true, onAlert: alert }); }
    catch (e) { if (e.upstreamText && [400, 413, 422].includes(e.upstreamStatus) && e.kind !== 'context') { e.raw = e.upstreamText; } throw e; }
    const usage = { in: 0, out: 0, cached: 0, think: 0 };
    let delivered = false, ttft = null;
    const fix = (j) => {
      if (proto === 'messages') {
        if (j.type === 'message_start' && j.message) { j.message.model = model.slug; const u = j.message.usage || {}; usage.cached = u.cache_read_input_tokens || 0; usage.in = (u.input_tokens || 0) + usage.cached + (u.cache_creation_input_tokens || 0); usage.out = u.output_tokens || 0; }
        if (j.type === 'message' ) { j.model = model.slug; const u = j.usage || {}; usage.cached = u.cache_read_input_tokens || 0; usage.in = (u.input_tokens || 0) + usage.cached + (u.cache_creation_input_tokens || 0); usage.out = u.output_tokens || 0; if (Array.isArray(j.content) && j.content.length) delivered = true; }
        if (j.type === 'message_delta' && j.usage) usage.out = j.usage.output_tokens || usage.out;
        if (j.type === 'content_block_start') delivered = true;
      } else {
        const r = j.response || (j.object === 'response' ? j : null);
        if (r) { r.model = model.slug; if (r.usage) { usage.in = r.usage.input_tokens || 0; usage.out = r.usage.output_tokens || 0; usage.cached = (r.usage.input_tokens_details || {}).cached_tokens || 0; } if (j.object === 'response' && Array.isArray(j.output) && j.output.length) delivered = true; }
        if (j.type === 'response.output_item.added') delivered = true;
      }
      if (delivered && ttft == null) ttft = Date.now() - started;
      return j;
    };
    const type = String(upstream.res.headers.get('content-type') || '');
    try {
      if (!type.includes('text/event-stream')) {
        const text = await upstream.res.text();
        let j; try { j = JSON.parse(text); } catch { throw err('upstream', 'The model provider returned an unreadable response.'); }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(fix(j)));
        return { delivered, ttft, usage };
      }
      const sse = sseStream(res, { anthropic: proto === 'messages' });
      try {
        for await (const ev of readSse(upstream.res.body, signal)) {
          upstream.kick();
          let j; try { j = JSON.parse(ev.data); } catch { await sse.raw(`${ev.event !== 'message' ? 'event: ' + ev.event + '\n' : ''}data: ${ev.data}\n\n`); continue; }
          fix(j);
          await sse.raw(`${ev.event !== 'message' ? 'event: ' + ev.event + '\n' : ''}data: ${JSON.stringify(j)}\n\n`);
        }
      } catch (e) {
        if (!signal.aborted) {
          const m = 'The connection to the model provider was interrupted. Retry the request.';
          if (proto === 'messages') await sse.event('error', { type: 'error', error: { type: 'api_error', message: m } });
          else await sse.event('response.failed', { type: 'response.failed', response: { status: 'failed', error: { code: 'server_error', message: m } } });
        }
        sse.end();
        return { delivered, ttft, usage, error: { status: signal.aborted ? 499 : 502, message: 'stream interrupted' } };
      }
      sse.end();
      return { delivered, ttft, usage };
    } finally { upstream.done(); }
  }
  const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };

  /* ---------- маршрутизация /v1 ---------- */
  async function handle(req, res, url) {
    cors(req, res);
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const p = url.pathname.replace(/\/+$/, '') || '/';
    const proto = p.startsWith('/v1/messages') ? 'messages' : 'openai';
    const origin = d.origin(req), ip = d.clientIp(req);
    try {
      if (p === '/v1') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true, docs: origin + '/developers' })); }
      if (d.loadSettings().api === false) throw err('permission', 'The API is turned off by the site administrator.');
      const route = ROUTES[p], isModels = p === '/v1/models' || p.startsWith('/v1/models/'), isCount = p === '/v1/messages/count_tokens';
      if (!route && !isModels && !isCount) throw err('not_found', `Unknown endpoint ${req.method} ${p}. Supported: POST /v1/chat/completions, POST /v1/responses, POST /v1/messages, POST /v1/messages/count_tokens, GET /v1/models.`, { code: 'unknown_endpoint' });
      if (isModels ? req.method !== 'GET' : req.method !== 'POST') { res.setHeader('Allow', isModels ? 'GET' : 'POST'); throw err('invalid', `Use ${isModels ? 'GET' : 'POST'} for ${p}`, { code: 'method_not_allowed' }); }
      const { key, user } = authenticate(req, ip, origin);
      const client = detectClient(req);
      d.keys.touch(key.id, ip, client);
      if (isModels) {
        const anthropic = !!req.headers['anthropic-version'];
        const list = available(user, key);
        if (p === '/v1/models') {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          return res.end(JSON.stringify(anthropic ? { data: list.map((m) => modelObj(m, true)), has_more: false, first_id: list[0] ? list[0].slug : null, last_id: list.length ? list[list.length - 1].slug : null } : { object: 'list', data: list.map((m) => modelObj(m, false)) }));
        }
        const m = resolve(list, decodeURIComponent(p.slice('/v1/models/'.length)));
        if (!m) throw err('not_found', 'Model not found or not available on your plan.');
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify(modelObj(m, anthropic)));
      }
      const body = await readJson(req, BODY_LIMIT);
      if (isCount) {
        const parsed = conv.fromMessages({ ...body, max_tokens: 1 });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify({ input_tokens: estimateTokens(parsed.body.messages, parsed.body.tools) }));
      }
      return await generate({ req, res, proto: route, body, user, key, client, ip, origin });
    } catch (e) {
      if (!e || !e.kind) { d.monitor.error('API ' + p, e); e = err('server', 'Internal server error. It has been logged.'); }
      return sendError(res, e, proto);
    }
  }

  return { handle, generate, available, limits: { rpm: RPM, concurrency: CONCURRENCY } };
}

module.exports = { createGateway };
