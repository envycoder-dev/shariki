'use strict';
// Общие помощники API-шлюза: ключи, ошибки в форматах OpenAI/Anthropic, SSE, оценка токенов.
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
function randomB62(n) {
  let s = '';
  while (s.length < n) for (const b of crypto.randomBytes(n * 2)) { if (b < 248) { s += B62[b % 62]; if (s.length === n) break; } } // 248 = 62·4 — без смещения
  return s;
}
function toB62(num, len) { let s = ''; for (let i = 0; i < len; i++) { s = B62[num % 62] + s; num = Math.floor(num / 62); } return s; }

// Ключ: prm_ + 36 случайных + 6 символов CRC32 — опечатку видно без запроса к базе, сканеры секретов узнают формат.
const KEY_RE = /^prm_([0-9A-Za-z]{36})([0-9A-Za-z]{6})$/;
const newKey = () => { const body = randomB62(36); return 'prm_' + body + toB62(zlib.crc32(body), 6); };
const keyLooksValid = (k) => { const m = KEY_RE.exec(String(k || '')); return !!m && toB62(zlib.crc32(m[1]), 6) === m[2]; };
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const rid = (prefix, n = 24) => prefix + randomB62(n);

/* ---------- ошибки ---------- */
// kind → [HTTP, тип OpenAI, код OpenAI, тип Anthropic]
const KINDS = {
  invalid: [400, 'invalid_request_error', null, 'invalid_request_error'],
  context: [400, 'invalid_request_error', 'context_length_exceeded', 'invalid_request_error'],
  auth: [401, 'invalid_request_error', 'invalid_api_key', 'authentication_error'],
  permission: [403, 'invalid_request_error', 'permission_denied', 'permission_error'],
  not_found: [404, 'invalid_request_error', 'model_not_found', 'not_found_error'],
  too_large: [413, 'invalid_request_error', 'request_too_large', 'request_too_large'],
  rate_limit: [429, 'rate_limit_error', 'rate_limit_exceeded', 'rate_limit_error'],
  quota: [429, 'insufficient_quota', 'insufficient_quota', 'rate_limit_error'],
  upstream: [502, 'server_error', 'upstream_error', 'api_error'],
  overloaded: [503, 'server_error', 'overloaded', 'overloaded_error'],
  timeout: [504, 'server_error', 'timeout', 'api_error'],
  server: [500, 'server_error', 'internal_error', 'api_error'],
};
class ApiError extends Error {
  constructor(kind, message, extra = {}) { super(message); this.kind = KINDS[kind] ? kind : 'server'; Object.assign(this, extra); }
  get status() { return KINDS[this.kind][0]; }
}
const err = (kind, message, extra) => new ApiError(kind, message, extra);
function errorBody(e, proto) {
  const [, type, code, aType] = KINDS[e.kind] || KINDS.server;
  if (proto === 'messages') return { type: 'error', error: { type: aType, message: e.message } };
  return { error: { message: e.message, type, param: e.param || null, code: e.code || code } };
}
function sendError(res, e, proto) {
  if (res.headersSent) return res.end();
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (e.retryAfter) headers['Retry-After'] = String(Math.max(1, Math.ceil(e.retryAfter)));
  if (e.shouldRetry === false) headers['x-should-retry'] = 'false';
  else if (e.shouldRetry === true) headers['x-should-retry'] = 'true';
  const status = proto === 'messages' && e.kind === 'overloaded' ? 529 : (KINDS[e.kind] || KINDS.server)[0];
  res.writeHead(status, headers);
  res.end(JSON.stringify(errorBody(e, proto)));
}

/* ---------- SSE ---------- */
// Поток событий с обратным давлением и пингами: Claude Code рвёт соединение, если долго тихо.
function sseStream(res, { anthropic = false, keepaliveMs = 12000 } = {}) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  if (res.socket) res.socket.setNoDelay(true);
  let last = Date.now(), closed = false;
  const write = (s) => {
    if (closed || res.destroyed || res.writableEnded) return Promise.resolve();
    last = Date.now();
    if (res.write(s)) return Promise.resolve();
    return new Promise((r) => { const done = () => { res.off('drain', done); res.off('close', done); r(); }; res.once('drain', done); res.once('close', done); });
  };
  const timer = setInterval(() => {
    if (Date.now() - last < keepaliveMs - 500) return;
    write(anthropic ? 'event: ping\ndata: {"type":"ping"}\n\n' : ': keepalive\n\n');
  }, keepaliveMs);
  timer.unref();
  const stop = () => { closed = true; clearInterval(timer); };
  res.on('close', stop);
  return {
    event: (name, data) => write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`),
    data: (data) => write(`data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`),
    raw: write,
    end: () => { stop(); if (!res.writableEnded) res.end(); },
  };
}

// Разбор SSE из ReadableStream (fetch). Отдаёт { event, data } на каждое событие.
async function* readSse(body, signal) {
  const dec = new TextDecoder();
  let buf = '', event = '', data = [];
  for await (const chunk of body) {
    if (signal && signal.aborted) return;
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.search(/\r\n|\n|\r/)) >= 0) {
      if (buf[i] === '\r' && i === buf.length - 1) break; // CRLF мог разорваться между кусками
      const line = buf.slice(0, i);
      buf = buf.slice(i + (buf[i] === '\r' && buf[i + 1] === '\n' ? 2 : 1));
      if (line === '') { if (data.length) yield { event: event || 'message', data: data.join('\n') }; event = ''; data = []; continue; }
      if (line[0] === ':') continue;
      const c = line.indexOf(':'), field = c < 0 ? line : line.slice(0, c);
      let value = c < 0 ? '' : line.slice(c + 1); if (value[0] === ' ') value = value.slice(1);
      if (field === 'data') data.push(value); else if (field === 'event') event = value;
    }
  }
  buf += dec.decode();
  if (buf && buf.startsWith('data:')) data.push(buf.slice(5).trimStart());
  if (data.length) yield { event: event || 'message', data: data.join('\n') };
}

/* ---------- оценка токенов (без токенизатора: ~4 байта UTF-8 на токен) ---------- */
function estimateTokens(messages, tools) {
  let bytes = 0, images = 0;
  for (const m of messages || []) {
    if (typeof m.content === 'string') bytes += Buffer.byteLength(m.content);
    else if (Array.isArray(m.content)) for (const p of m.content) {
      if (p.type === 'text') bytes += Buffer.byteLength(p.text || '');
      else if (p.type === 'image_url') images++;
      else if (p.type === 'file') images += 2;
    }
    if (m.tool_calls) bytes += Buffer.byteLength(JSON.stringify(m.tool_calls));
    bytes += 12;
  }
  if (tools && tools.length) bytes += Buffer.byteLength(JSON.stringify(tools));
  return Math.ceil(bytes / 4) + images * 1100;
}

// Идентификатор вызова инструмента для клиента: исходный id провайдера внутри (base64url) + случайный хвост.
// Так id уникален во всём диалоге (у некоторых провайдеров id повторяются) и обратимо превращается в исходный.
const TOOL_TAIL = 6;
const encodeToolId = (upstreamId, prefix) => prefix + 'pm' + Buffer.from(String(upstreamId)).toString('base64url') + randomB62(TOOL_TAIL);
function decodeToolId(id) {
  const s = String(id || ''); const m = /^(?:toolu_|call_|fc_)pm([A-Za-z0-9_-]+)$/.exec(s);
  if (!m || m[1].length <= TOOL_TAIL) return s;
  const enc = m[1].slice(0, -TOOL_TAIL), raw = Buffer.from(enc, 'base64url').toString('utf8');
  return raw && Buffer.from(raw).toString('base64url') === enc && !/[\u0000-\u001f]/.test(raw) ? raw : s;
}

// Тело запроса: JSON до limit байт, gzip/deflate/br/zstd.
function readJson(req, limit) {
  return new Promise((ok, fail) => {
    const enc = String(req.headers['content-encoding'] || 'identity').toLowerCase();
    let src = req;
    try {
      if (enc === 'gzip' || enc === 'x-gzip') src = req.pipe(zlib.createGunzip());
      else if (enc === 'deflate') src = req.pipe(zlib.createInflate());
      else if (enc === 'br') src = req.pipe(zlib.createBrotliDecompress());
      else if (enc === 'zstd' && zlib.createZstdDecompress) src = req.pipe(zlib.createZstdDecompress());
      else if (enc !== 'identity') return fail(err('invalid', `Unsupported Content-Encoding: ${enc}`));
    } catch { return fail(err('invalid', 'Could not decode the request body')); }
    const parts = []; let n = 0, over = false;
    src.on('data', (c) => { if (over) return; n += c.length; if (n > limit) { over = true; fail(err('too_large', `Request body is larger than ${Math.round(limit / 1048576)} MB`)); req.resume(); } else parts.push(c); });
    src.on('error', () => { if (!over) fail(err('invalid', 'Could not read the request body')); over = true; });
    src.on('end', () => {
      if (over) return;
      const s = Buffer.concat(parts).toString('utf8');
      if (!s.trim()) return fail(err('invalid', 'Request body is empty; send a JSON object'));
      try { const j = JSON.parse(s); if (!j || typeof j !== 'object' || Array.isArray(j)) throw 0; ok(j); }
      catch { fail(err('invalid', 'Request body is not valid JSON')); }
    });
  });
}

// Клиент по заголовкам — для журнала и «подключено» в кабинете.
const CLIENTS = [
  [/claude[- ]?(cli|code)/i, 'Claude Code'], [/codex/i, 'Codex'], [/cursor/i, 'Cursor'], [/\bcline\b/i, 'Cline'],
  [/roo-?code|roocode/i, 'Roo Code'], [/kilo-?code/i, 'Kilo Code'], [/opencode/i, 'OpenCode'], [/aider|litellm/i, 'Aider'],
  [/continue/i, 'Continue'], [/\bzed\b/i, 'Zed'], [/jetbrains|intellij/i, 'JetBrains'], [/crush/i, 'Crush'],
  [/^curl\//i, 'curl'], [/anthropic\/python|anthropic-python/i, 'Anthropic Python'], [/anthropic\/js|anthropic-typescript/i, 'Anthropic Node'],
  [/openai\/python/i, 'OpenAI Python'], [/openai\/js/i, 'OpenAI Node'], [/python-requests|httpx|aiohttp/i, 'Python'],
  [/node-fetch|undici|axios|node\b/i, 'Node.js'], [/premier-playground/i, 'Playground'],
];
function detectClient(req) {
  const h = req.headers, ua = String(h['user-agent'] || '');
  const hints = [ua, String(h.originator || ''), String(h['x-title'] || ''), String(h['http-referer'] || h.referer || ''), String(h['x-client-name'] || '')].join(' ');
  for (const [re, name] of CLIENTS) if (re.test(hints)) return name;
  return ua ? ua.split(/[\s/]/)[0].slice(0, 40) : null;
}

module.exports = { randomB62, newKey, keyLooksValid, sha256, rid, ApiError, err, errorBody, sendError, sseStream, readSse, estimateTokens, encodeToolId, decodeToolId, readJson, detectClient };
