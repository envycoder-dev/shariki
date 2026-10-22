'use strict';
// API для Cursor / Codex / Claude Code: node --test tests/api.test.js (Node.js 22.13+, без npm-зависимостей).
// Сервер и база — во временной копии приложения; модель — поддельный провайдер (tests/fixtures/fake-provider.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { createFakeProvider } = require('./fixtures/fake-provider');

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const mskDay = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);

// SSE-ответ → [{ event, data }]
async function sse(r) {
  const text = await r.text(), out = [];
  for (const block of text.split(/\n\n/)) {
    let event = 'message'; const data = [];
    for (const line of block.split('\n')) { if (line.startsWith('event:')) event = line.slice(6).trim(); else if (line.startsWith('data:')) data.push(line.slice(5).trim()); }
    if (data.length) out.push({ event, data: data.join('\n') === '[DONE]' ? '[DONE]' : JSON.parse(data.join('\n')) });
  }
  return out;
}

test('API gateway: protocols, tools, billing, keys, connect', { timeout: 120000 }, async (t) => {
  const root = path.resolve(__dirname, '..'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'premier-api-'));
  const fake = createFakeProvider(), fakeUrl = await fake.listen();
  let child, store, logs = '';
  t.after(async () => {
    if (child && child.exitCode === null) { child.kill('SIGTERM'); await Promise.race([new Promise((r) => child.once('exit', r)), delay(6000)]); if (child.exitCode === null) child.kill('SIGKILL'); }
    if (store) store.db.close();
    await fake.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  fs.cpSync(root, dir, { recursive: true, filter: (src) => {
    const rel = path.relative(root, src), top = rel.split(path.sep)[0];
    return !rel || ['public', 'locales', 'desktop', 'api'].includes(top) || (!rel.includes(path.sep) && !top.startsWith('.') && /\.(js|json)$/.test(top));
  } });
  store = require(path.join(dir, 'db.js'));
  const sessions = new Map();
  const user = (id, plan = 'free') => {
    store.users.put({ id, login: id, email: id + '@example.invalid', plan, until: Date.now() + 864e5, created: new Date().toISOString() });
    const token = crypto.randomBytes(32).toString('hex'); store.sessions.put(sha(token), id, Date.now() + 3600e3); sessions.set(id, token);
  };
  user('alice'); user('quota'); user('bob', 'pro');
  const prov = { baseUrl: fakeUrl + '/v1', apiKey: 'sk-fake-upstream-key' };
  store.kv.set('models', [
    { id: 'm1', name: 'Test Model', modelId: 'fake-1', ...prov, vision: false, plans: ['free', 'pro', 'max'], weight: 1 },
    { id: 'm2', name: 'Pro Only', modelId: 'fake-2', ...prov, vision: true, plans: ['pro', 'max'], weight: 2 },
    { id: 'm3', name: 'Native Claude', modelId: 'fake-claude', ...prov, nativeUrl: fakeUrl, native: 'anthropic', plans: ['free', 'pro', 'max'], weight: 1 },
  ]);
  store.kv.set('settings', { defaultModel: 'm1' });
  store.kv.set('usage:' + mskDay(), { quota: { m: 20 } });

  const reservation = net.createServer(); await new Promise((r) => reservation.listen(0, '127.0.0.1', r));
  const port = reservation.address().port; await new Promise((r) => reservation.close(r));
  const base = 'http://127.0.0.1:' + port;
  child = spawn(process.execPath, ['server.js'], { cwd: dir, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), ADMIN_PASSWORD: crypto.randomBytes(24).toString('base64url'), PUBLIC_URL: base, TRUST_PROXY: '1', CODE_RUNNER: 'off', API_RPM: '1000' }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (b) => { logs += b; }); child.stderr.on('data', (b) => { logs += b; });
  for (let i = 0; i < 100; i++) { if (child.exitCode !== null) throw new Error('server did not start: ' + logs); try { if ((await fetch(base + '/healthz')).ok) break; } catch {} await delay(100); }

  const dev = async (p, { uid = 'alice', body, method } = {}) => {
    const r = await fetch(base + p, { method: method || (body === undefined ? 'GET' : 'POST'), headers: { Cookie: 'premier_session=' + sessions.get(uid), 'Content-Type': 'application/json', Origin: base }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: r.status, data: await r.json() };
  };
  const v1 = (p, key, body, headers = {}) => fetch(base + p, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const used = async (uid = 'alice') => (await dev('/api/dev/state', { uid })).data.usage.used;

  let key;
  await t.test('dashboard: state and key creation', async () => {
    const s = await dev('/api/dev/state');
    assert.equal(s.status, 200);
    assert.deepEqual(s.data.models.map((m) => m.id), ['test-model', 'pro-only', 'native-claude']);
    assert.equal(s.data.models.find((m) => m.id === 'pro-only').available, false);
    assert.equal(s.data.models.find((m) => m.id === 'pro-only').plan_hint, 'Pro');
    assert.equal(s.data.base_url, base);
    const k = await dev('/api/dev/keys', { body: { name: 'Laptop' } });
    assert.equal(k.status, 201);
    assert.match(k.data.key, /^prm_[0-9A-Za-z]{42}$/);
    assert.ok(!JSON.stringify(k.data.item).includes(k.data.key), 'item must not contain the raw key');
    key = k.data.key;
    assert.equal((await dev('/api/dev/keys', { body: { name: '' } })).status, 400);
    const cross = await fetch(base + '/api/dev/keys', { method: 'POST', headers: { Cookie: 'premier_session=' + sessions.get('alice'), 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{"name":"x"}' });
    assert.equal(cross.status, 403);
    assert.equal((await fetch(base + '/api/dev/state')).status, 401);
  });

  await t.test('auth errors in both formats', async () => {
    let r = await fetch(base + '/v1/models');
    assert.equal(r.status, 401); assert.equal((await r.json()).error.code, 'invalid_api_key');
    r = await v1('/v1/messages', 'prm_' + 'x'.repeat(42), { model: 'test-model', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(r.status, 401); const j = await r.json(); assert.equal(j.type, 'error'); assert.equal(j.error.type, 'authentication_error');
    r = await fetch(base + '/v1/chat/completions', { method: 'OPTIONS', headers: { Origin: 'https://x.example', 'Access-Control-Request-Headers': 'authorization,content-type' } });
    assert.equal(r.status, 204); assert.equal(r.headers.get('access-control-allow-origin'), '*');
  });

  await t.test('models list: OpenAI and Anthropic shapes, plan filter', async () => {
    let j = await (await v1('/v1/models', key)).json();
    assert.equal(j.object, 'list'); assert.deepEqual(j.data.map((m) => m.id), ['test-model', 'native-claude']);
    j = await (await v1('/v1/models', key, undefined, { 'anthropic-version': '2023-06-01' })).json();
    assert.equal(j.data[0].type, 'model'); assert.equal(j.data[0].display_name, 'Test Model'); assert.equal(j.has_more, false);
  });

  await t.test('chat completions: non-stream, stream, usage, provider name hidden', async () => {
    const before = await used();
    let r = await v1('/v1/chat/completions', key, { model: 'test-model', messages: [{ role: 'user', content: 'HELLO' }] }, { 'User-Agent': 'OpenAI/Python 1.99' });
    assert.equal(r.status, 200);
    let j = await r.json();
    assert.equal(j.object, 'chat.completion'); assert.equal(j.model, 'test-model'); assert.equal(j.choices[0].message.content, 'Hello from fake!');
    assert.equal(j.usage.prompt_tokens, 11); assert.equal(j.choices[0].finish_reason, 'stop');
    assert.equal(fake.last().body.model, 'fake-1'); assert.equal(fake.last().headers.authorization, 'Bearer sk-fake-upstream-key');
    r = await v1('/v1/chat/completions', key, { model: 'test-model', stream: true, stream_options: { include_usage: true }, messages: [{ role: 'user', content: 'HELLO' }] });
    assert.match(r.headers.get('content-type'), /text\/event-stream/);
    const ev = await sse(r);
    assert.equal(ev[ev.length - 1].data, '[DONE]');
    const chunks = ev.filter((e) => e.data !== '[DONE]');
    assert.equal(chunks.map((c) => (c.data.choices[0] && c.data.choices[0].delta.content) || '').join(''), 'Hello from fake!');
    assert.ok(chunks.every((c) => c.data.model === 'test-model' && !('provider' in c.data)));
    assert.ok(chunks.some((c) => c.data.usage && c.data.choices.length === 0));
    r = await v1('/v1/chat/completions', key, { model: 'test-model', stream: true, messages: [{ role: 'user', content: 'HELLO' }] });
    assert.ok((await sse(r)).every((e) => e.data === '[DONE]' || e.data.choices.length), 'no usage-only chunk unless include_usage');
    assert.equal(await used(), before + 3);
  });

  await t.test('chat completions: streamed tool call keeps ids and fragments', async () => {
    const r = await v1('/v1/chat/completions', key, { model: 'test-model', stream: true, tools: [{ type: 'function', function: { name: 'get_weather', parameters: { type: 'object', properties: { city: { type: 'string' } } } } }], messages: [{ role: 'user', content: 'TOOL2' }] });
    const chunks = (await sse(r)).filter((e) => e.data !== '[DONE]').map((e) => e.data.choices[0]).filter(Boolean);
    const calls = {};
    for (const c of chunks) for (const tc of c.delta.tool_calls || []) { calls[tc.index] ||= { id: tc.id, args: '' }; calls[tc.index].args += tc.function.arguments || ''; }
    assert.deepEqual(Object.values(calls).map((c) => JSON.parse(c.args).city), ['Paris', 'Rome']);
    assert.equal(calls[0].id, 'functions.get_weather:0');
    assert.equal(chunks[chunks.length - 1].finish_reason, 'tool_calls');
  });

  let toolUseId;
  await t.test('anthropic messages: streamed tool_use, then tool_result round trip', async () => {
    const tools = [{ name: 'get_weather', description: 'weather', input_schema: { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } }, { type: 'web_search_20250305', name: 'web_search' }];
    let r = await v1('/v1/messages', key, { model: 'test-model', max_tokens: 1000, stream: true, system: [{ type: 'text', text: 'x-anthropic-billing-header: cc_version=1' }, { type: 'text', text: 'Be brief.', cache_control: { type: 'ephemeral' } }], tools, messages: [{ role: 'user', content: [{ type: 'text', text: 'TOOL please' }] }, { role: 'system', content: 'Env: linux' }] }, { 'User-Agent': 'claude-cli/2.1.308 (external, cli)', 'anthropic-version': '2023-06-01' });
    assert.equal(r.status, 200);
    const ev = await sse(r);
    assert.deepEqual(ev.map((e) => e.event).filter((x) => x !== 'ping').slice(0, 2), ['message_start', 'content_block_start']);
    assert.equal(ev[0].data.message.model, 'test-model');
    const up = fake.last().body;
    assert.equal(up.messages[0].role, 'system'); assert.equal(up.messages[0].content, 'Be brief.\n\nEnv: linux');
    assert.equal(up.tools.length, 1); assert.ok(!JSON.stringify(up.tools).includes('$schema'));
    const start = ev.find((e) => e.event === 'content_block_start' && e.data.content_block.type === 'tool_use');
    toolUseId = start.data.content_block.id;
    assert.match(toolUseId, /^toolu_[A-Za-z0-9_-]+$/);
    const json = ev.filter((e) => e.event === 'content_block_delta' && e.data.index === start.data.index).map((e) => e.data.delta.partial_json).join('');
    assert.deepEqual(JSON.parse(json), { city: 'Paris' });
    const text = ev.filter((e) => e.event === 'content_block_delta' && e.data.delta.type === 'text_delta').map((e) => e.data.delta.text).join('');
    assert.equal(text, 'Let me check. ');
    const md = ev.find((e) => e.event === 'message_delta');
    assert.equal(md.data.delta.stop_reason, 'tool_use'); assert.equal(md.data.usage.output_tokens, 5); assert.equal(md.data.usage.cache_read_input_tokens, 3);
    assert.equal(ev[ev.length - 1].event, 'message_stop');
    // ответ инструмента: провайдер получает свой исходный id
    r = await v1('/v1/messages', key, { model: 'test-model', max_tokens: 1000, messages: [
      { role: 'user', content: 'TOOL please' },
      { role: 'assistant', content: [{ type: 'thinking', thinking: 'hmm', signature: 'premier-gw' }, { type: 'text', text: 'Let me check. ' }, { type: 'tool_use', id: toolUseId, name: 'get_weather', input: { city: 'Paris' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: [{ type: 'text', text: '22C' }, { type: 'tool_reference', tool_name: 'Grep' }] }] },
    ] });
    const j = await r.json();
    assert.equal(j.type, 'message'); assert.equal(j.content[0].text, 'Sunny, 22°C.'); assert.equal(j.stop_reason, 'end_turn');
    const m = fake.last().body.messages;
    assert.equal(m[1].tool_calls[0].id, 'call_fake1'); assert.equal(m[2].role, 'tool'); assert.equal(m[2].tool_call_id, 'call_fake1');
    assert.match(m[2].content, /22C[\s\S]*Grep/);
  });

  await t.test('anthropic messages: thinking only when requested; images stripped for non-vision model', async () => {
    let j = await (await v1('/v1/messages', key, { model: 'test-model', max_tokens: 100, thinking: { type: 'enabled', budget_tokens: 50 }, messages: [{ role: 'user', content: 'THINK' }] })).json();
    assert.deepEqual(j.content.map((c) => c.type), ['thinking', 'text']); assert.equal(j.content[0].thinking, 'Thinking hard. Done.');
    j = await (await v1('/v1/messages', key, { model: 'test-model', max_tokens: 100, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } }, { type: 'text', text: 'THINK' }] }] })).json();
    assert.deepEqual(j.content.map((c) => c.type), ['text']);
    assert.match(JSON.stringify(fake.last().body.messages), /image omitted/);
  });

  await t.test('responses (Codex): function, custom and namespaced tools; round trip', async () => {
    const tools = [
      { type: 'function', name: 'exec_command', parameters: { type: 'object', properties: { cmd: { type: 'string' } } } },
      { type: 'custom', name: 'apply_patch', description: 'Patch files', format: { type: 'grammar', syntax: 'lark', definition: 'start: "*** Begin Patch"' } },
      { type: 'namespace', name: 'multi_agent_v1', description: 'Agents', tools: [{ type: 'function', name: 'spawn_agent', parameters: { type: 'object', properties: { task: { type: 'string' } } } }] },
      { type: 'web_search', external_web_access: false },
    ];
    const req = (text) => v1('/v1/responses', key, { model: 'test-model', stream: true, store: false, instructions: 'You are Codex.', include: ['reasoning.encrypted_content'], tools, tool_choice: 'auto', parallel_tool_calls: false, input: [{ type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'perm' }] }, { type: 'message', role: 'user', content: [{ type: 'input_text', text }] }] }, { 'User-Agent': 'codex_cli_rs/0.163.0', originator: 'codex_cli_rs' });
    let ev = await sse(await req('TOOL'));
    const types = ev.map((e) => e.event);
    assert.equal(types[0], 'response.created'); assert.equal(types[types.length - 1], 'response.completed');
    assert.deepEqual(ev.map((e) => e.data.sequence_number), ev.map((_, i) => i));
    const done = ev.filter((e) => e.event === 'response.output_item.done').map((e) => e.data.item);
    assert.deepEqual(done.map((i) => i.type), ['message', 'function_call']);
    assert.equal(done[0].content[0].text, 'Let me check. ');
    const fc = done[1]; assert.equal(fc.name, 'get_weather'); assert.deepEqual(JSON.parse(fc.arguments), { city: 'Paris' }); assert.match(fc.call_id, /^call_/);
    const completed = ev[ev.length - 1].data.response;
    assert.equal(completed.usage.input_tokens, 11); assert.equal(completed.output.length, 2); assert.equal(completed.model, 'test-model');
    const up = fake.last().body;
    assert.equal(up.messages[0].content, 'You are Codex.\n\nperm');
    assert.deepEqual(up.tools.map((x) => x.function.name), ['exec_command', 'apply_patch', 'multi_agent_v1__spawn_agent']);
    assert.match(up.tools[1].function.description, /grammar/); assert.equal(up.parallel_tool_calls, false);
    ev = await sse(await req('PATCH'));
    const ct = ev.filter((e) => e.event === 'response.output_item.done').map((e) => e.data.item)[0];
    assert.equal(ct.type, 'custom_tool_call'); assert.equal(ct.name, 'apply_patch'); assert.match(ct.input, /^\*\*\* Begin Patch\n/);
    ev = await sse(await req('NSCALL'));
    const ns = ev.filter((e) => e.event === 'response.output_item.done').map((e) => e.data.item)[0];
    assert.equal(ns.type, 'function_call'); assert.equal(ns.name, 'spawn_agent'); assert.equal(ns.namespace, 'multi_agent_v1');
    // ответ инструмента + reasoning-элемент (провайдеру не нужен)
    const r = await v1('/v1/responses', key, { model: 'test-model', input: [
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'TOOL' }] },
      { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: null },
      { type: 'function_call', call_id: fc.call_id, name: 'get_weather', arguments: fc.arguments },
      { type: 'function_call', call_id: ns.call_id, name: 'spawn_agent', namespace: 'multi_agent_v1', arguments: '{}' },
      { type: 'function_call_output', call_id: fc.call_id, output: '22C' },
    ] });
    const j = await r.json();
    assert.equal(j.object, 'response'); assert.equal(j.status, 'completed'); assert.equal(j.output[0].content[0].text, 'Sunny, 22°C.');
    const m = fake.last().body.messages;
    assert.deepEqual(m[1].tool_calls.map((c) => [c.id, c.function.name]), [['call_fake1', 'get_weather'], ['call_ns1', 'multi_agent_v1__spawn_agent']]);
    assert.deepEqual(m.slice(2).map((x) => [x.role, x.tool_call_id, x.content]), [['tool', 'call_fake1', '22C'], ['tool', 'call_ns1', 'No result: the tool call was interrupted.']]);
    assert.equal((await v1('/v1/responses', key, { model: 'test-model', previous_response_id: 'resp_1', input: 'hi' })).status, 400);
  });

  await t.test('provider quirks: adapts max_tokens, retries 5xx, drops unsupported params, JSON instead of SSE', async () => {
    let r = await v1('/v1/messages', key, { model: 'test-model', max_tokens: 32000, messages: [{ role: 'user', content: 'MAXTOK' }] });
    assert.equal(r.status, 200); assert.equal(fake.last().body.max_tokens, 4096);
    r = await v1('/v1/chat/completions', key, { model: 'test-model', messages: [{ role: 'user', content: 'FAIL500' }] });
    assert.equal(r.status, 200); assert.equal((await r.json()).choices[0].message.content, 'Hello from fake!');
    r = await v1('/v1/chat/completions', key, { model: 'test-model', parallel_tool_calls: true, messages: [{ role: 'user', content: 'NOOPT' }] });
    assert.equal(r.status, 200);
    r = await v1('/v1/chat/completions', key, { model: 'test-model', stream: true, messages: [{ role: 'user', content: 'JSONMODE' }] });
    const ev = await sse(r);
    assert.equal(ev.filter((e) => e.data !== '[DONE]').map((e) => e.data.choices[0].delta.content || '').join(''), 'plain json');
  });

  await t.test('errors are refunded; context overflow is recognisable by Claude Code and Codex', async () => {
    const before = await used();
    let r = await v1('/v1/messages', key, { model: 'test-model', max_tokens: 100, messages: [{ role: 'user', content: 'CTX' }] });
    assert.equal(r.status, 400); let j = await r.json(); assert.equal(j.error.type, 'invalid_request_error'); assert.match(j.error.message, /^prompt is too long/);
    r = await v1('/v1/chat/completions', key, { model: 'test-model', messages: [{ role: 'user', content: 'CTX' }] });
    j = await r.json(); assert.equal(j.error.code, 'context_length_exceeded');
    r = await v1('/v1/responses', key, { model: 'test-model', stream: true, input: 'CUT' });
    const ev = await sse(r);
    assert.equal(ev[ev.length - 1].event, 'response.failed');
    assert.equal(await used(), before + 1, 'only the partially delivered request is charged');
    r = await v1('/v1/chat/completions', key, { model: 'nope', messages: [{ role: 'user', content: 'x' }] });
    assert.equal(r.status, 404); assert.match((await r.json()).error.message, /test-model/);
    r = await v1('/v1/chat/completions', key, { model: 'pro-only', messages: [{ role: 'user', content: 'x' }] });
    assert.equal(r.status, 403);
    assert.equal(await used(), before + 1);
  });

  await t.test('daily quota: 429 without retries', async () => {
    const k = await dev('/api/dev/keys', { uid: 'quota', body: { name: 'q' } });
    const r = await v1('/v1/messages', k.data.key, { model: 'test-model', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(r.status, 429); assert.equal(r.headers.get('x-should-retry'), 'false'); assert.ok(Number(r.headers.get('retry-after')) > 0);
    assert.equal((await r.json()).error.type, 'rate_limit_error');
    const o = await v1('/v1/chat/completions', k.data.key, { model: 'test-model', messages: [{ role: 'user', content: 'hi' }] });
    assert.equal((await o.json()).error.code, 'insufficient_quota');
  });

  await t.test('key restrictions, roll and revoke', async () => {
    const limited = await dev('/api/dev/keys', { body: { name: 'only native', models: ['native-claude'] } });
    assert.equal((await v1('/v1/chat/completions', limited.data.key, { model: 'test-model', messages: [{ role: 'user', content: 'x' }] })).status, 403);
    assert.deepEqual((await (await v1('/v1/models', limited.data.key)).json()).data.map((m) => m.id), ['native-claude']);
    assert.equal((await dev('/api/dev/keys', { body: { name: 'bad', models: ['ghost'] } })).status, 400);
    const ipk = await dev('/api/dev/keys', { body: { name: 'office', ips: ['10.0.0.0/8'] } });
    assert.deepEqual(ipk.data.item.ips, ['10.0.0.0/8']);
    assert.equal((await v1('/v1/models', ipk.data.key, undefined, { 'X-Real-IP': '203.0.113.9' })).status, 403);
    assert.equal((await v1('/v1/models', ipk.data.key, undefined, { 'X-Real-IP': '10.1.2.3' })).status, 200);
    assert.equal((await dev('/api/dev/keys', { body: { name: 'bad ip', ips: ['10.0.0.300'] } })).status, 400);
    const rolled = await dev(`/api/dev/keys/${ipk.data.item.id}/roll`, { body: {} });
    assert.equal((await v1('/v1/models', ipk.data.key, undefined, { 'X-Real-IP': '10.1.2.3' })).status, 401);
    assert.equal((await v1('/v1/models', rolled.data.key, undefined, { 'X-Real-IP': '10.1.2.3' })).status, 200);
    const patched = await dev(`/api/dev/keys/${limited.data.item.id}`, { method: 'PATCH', body: { name: 'renamed', models: null } });
    assert.equal(patched.data.item.name, 'renamed'); assert.equal(patched.data.item.models, null);
    assert.equal((await dev(`/api/dev/keys/${limited.data.item.id}`, { method: 'DELETE', body: {} })).status, 200);
    assert.equal((await v1('/v1/models', limited.data.key)).status, 401);
    assert.equal((await dev(`/api/dev/keys/${limited.data.item.id}`, { uid: 'bob', method: 'DELETE', body: {} })).status, 404, 'other users cannot touch the key');
  });

  await t.test('native Anthropic passthrough keeps the protocol and strips gateway thinking', async () => {
    const r = await v1('/v1/messages', key, { model: 'native-claude', max_tokens: 100, stream: true, messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: [{ type: 'thinking', thinking: 'x', signature: 'premier-gw' }, { type: 'text', text: 'ok' }] }, { role: 'user', content: 'again' }] }, { 'anthropic-version': '2023-06-01', 'anthropic-beta': 'interleaved-thinking-2025-05-14' });
    const ev = await sse(r);
    assert.equal(ev[0].data.message.model, 'native-claude');
    assert.equal(ev.find((e) => e.event === 'content_block_delta').data.delta.text, 'native hi');
    const call = fake.last();
    assert.equal(call.path, '/v1/messages'); assert.equal(call.headers['x-api-key'], 'sk-fake-upstream-key'); assert.equal(call.headers['anthropic-beta'], 'interleaved-thinking-2025-05-14');
    assert.equal(call.body.model, 'fake-claude'); assert.deepEqual(call.body.messages[1].content, [{ type: 'text', text: 'ok' }]);
  });

  await t.test('count_tokens is free; client disconnect aborts the provider request', async () => {
    const before = await used();
    const r = await v1('/v1/messages/count_tokens', key, { model: 'test-model', messages: [{ role: 'user', content: 'hello world '.repeat(100) }] });
    assert.ok((await r.json()).input_tokens > 100);
    const ac = new AbortController(), aborted = fake.state.aborted;
    const s = await v1('/v1/chat/completions', key, { model: 'test-model', stream: true, messages: [{ role: 'user', content: 'SLOW' }] });
    const reader = s.body.getReader(); await reader.read(); ac.abort(); await reader.cancel();
    for (let i = 0; i < 30 && fake.state.aborted === aborted; i++) await delay(100);
    assert.equal(fake.state.aborted, aborted + 1);
    assert.equal(await used(), before + 1);
  });

  await t.test('logs, usage and client detection', async () => {
    await delay(300);
    const l = await dev('/api/dev/logs?limit=200');
    assert.ok(l.data.items.length > 10);
    assert.ok(l.data.items.some((x) => x.client === 'Claude Code' && x.proto === 'messages'));
    assert.ok(l.data.items.some((x) => x.client === 'Codex' && x.proto === 'responses'));
    assert.ok(l.data.items.some((x) => x.status === 400 && x.cost === 0));
    assert.ok(l.data.items.every((x) => !('prompt' in x)));
    const u = await dev('/api/dev/usage?days=7');
    assert.equal(u.data.days.length, 7); assert.ok(u.data.days[6].requests > 10); assert.equal(u.data.by_model[0].model, 'test-model');
    const c = await dev('/api/dev/clients?model=test-model');
    const cc = c.data.clients.find((x) => x.id === 'claude-code');
    assert.match(JSON.stringify(cc), /ANTHROPIC_BASE_URL/); assert.match(JSON.stringify(cc), /__PREMIER_KEY__/);
  });

  await t.test('connect in one command: device code flow', async () => {
    const start = await (await fetch(base + '/api/connect/start?format=env', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client: 'codex', os: 'Linux', host: 'dev-box' }) })).text();
    const val = (k, s) => (new RegExp('^' + k + '=(.*)$', 'm').exec(s) || [])[1];
    const code = val('code', start), device = val('device', start);
    assert.match(code, /^[A-Z]{4}-[A-Z]{4}$/); assert.match(val('url', start), /\/developers\?connect=/);
    const poll = async () => (await fetch(base + '/api/connect/poll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device }) })).json();
    assert.equal((await poll()).status, 'pending');
    const info = await dev('/api/dev/connect/' + code);
    assert.equal(info.data.client, 'Codex'); assert.equal(info.data.host, 'dev-box');
    assert.equal((await dev('/api/dev/connect/' + code, { body: { action: 'approve' } })).status, 200);
    await delay(1100);
    const r = await poll();
    assert.equal(r.status, 'approved'); assert.equal(r.model, 'test-model'); assert.equal(r.base_url, base); assert.match(r.key, /^prm_/);
    assert.equal((await v1('/v1/models', r.key)).status, 200);
    await delay(1100);
    assert.equal((await poll()).status, 'expired', 'the key is handed out only once');
    const sh = await (await fetch(base + '/connect.sh')).text();
    assert.match(sh, /^#!\/bin\/sh/); assert.ok(sh.includes(`BASE='${base}'`));
  });

  await t.test('playground streams through the same gateway', async () => {
    const r = await fetch(base + '/api/dev/playground', { method: 'POST', headers: { Cookie: 'premier_session=' + sessions.get('alice'), 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ model: 'test-model', messages: [{ role: 'user', content: 'HELLO' }] }) });
    const ev = await sse(r);
    assert.equal(ev.filter((e) => e.data !== '[DONE]' && e.data.choices.length).map((e) => e.data.choices[0].delta.content || '').join(''), 'Hello from fake!');
  });

  assert.ok(!/TypeError|ReferenceError/.test(logs), logs);
});
