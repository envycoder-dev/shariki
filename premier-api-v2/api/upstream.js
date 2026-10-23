'use strict';
// Запросы к провайдеру модели (OpenAI-совместимый /chat/completions) и разбор его потока в единые события:
//   { t: 'text', d } · { t: 'think', d } · { t: 'tool', i, id, name } · { t: 'args', i, d }
const { err, readSse, randomB62 } = require('./util');

const FIRST_BYTE_MS = Math.min(600, Math.max(1, Number(process.env.MODEL_TIMEOUT) || 180)) * 1000;
const IDLE_MS = Math.max(FIRST_BYTE_MS, 180000);
const TOTAL_MS = 30 * 60000;
// поля, которые провайдер может не поддерживать: если он ругается на одно из них — повторяем без него
const OPTIONAL = ['stream_options', 'parallel_tool_calls', 'temperature', 'top_p', 'frequency_penalty', 'presence_penalty', 'seed', 'stop', 'logprobs', 'top_logprobs', 'user', 'reasoning_effort', 'reasoning', 'logit_bias'];
const learnedCap = new Map(); // id модели → максимум max_tokens, который принял провайдер

function chatUrl(baseUrl) {
  const u = String(baseUrl || '').trim().replace(/\/+$/, '');
  return /\/chat\/completions$/.test(u) ? u : u + '/chat/completions';
}
function nativeUrl(model) {
  const u = String(model.nativeUrl || model.baseUrl || '').trim().replace(/\/+$/, '');
  if (model.native === 'anthropic') return /\/messages$/.test(u) ? u : /\/v1$/.test(u) ? u + '/messages' : u + '/v1/messages';
  return /\/responses$/.test(u) ? u : u + '/responses';
}

const msgOf = (text) => {
  try { const j = JSON.parse(text); const e = j.error || j; return String((e && (e.message || e.msg || e.detail)) || (typeof j.error === 'string' ? j.error : '') || text); } catch { return String(text || ''); }
};
// Сообщение провайдера наружу — без адресов и ключей
const scrub = (s) => String(s).replace(/https?:\/\/\S+/g, '[url]').replace(/\b(sk|rk|pk|key|prm)[-_][A-Za-z0-9_-]{8,}/gi, '[redacted]').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').replace(/\s+/g, ' ').trim().slice(0, 400);
const CONTEXT_RE = /context.{0,20}(length|window|limit)|too many tokens|prompt is too long|input is too long|reduce the length|maximum context|exceeds? the (model'?s? )?(context|maximum)|context_length_exceeded|token limit/i;

function upstreamError(status, text, retryAfter, onAlert) {
  const raw = msgOf(text), m = scrub(raw);
  if (CONTEXT_RE.test(raw)) return err('context', 'prompt is too long: ' + (m || 'the conversation does not fit into the model context window'));
  if (status === 400 || status === 413 || status === 422) return err('invalid', 'The model provider rejected the request: ' + (m || 'HTTP ' + status));
  if (status === 401 || status === 403 || status === 402) {
    if (onAlert) onAlert(`Провайдер модели ответил ${status}: ${m}`);
    return err('upstream', status === 402 ? 'The model provider account is out of credit. The administrator has been notified.' : 'The model provider rejected the server credentials. The administrator has been notified.');
  }
  if (status === 404) return err('upstream', 'The model is not available at the provider right now: ' + m);
  if (status === 429) return err('rate_limit', 'The model provider is rate limiting requests, retry shortly.' + (m ? ' (' + m + ')' : ''), { retryAfter: Math.min(120, Number(retryAfter) || 10), shouldRetry: true });
  if (status === 408 || status === 504) return err('timeout', 'The model provider timed out. Retry the request.', { retryAfter: 5 });
  return err('overloaded', `The model provider is temporarily unavailable (HTTP ${status}). Retry shortly.`, { retryAfter: 5, shouldRetry: true });
}

// Подстраиваемся под ограничения провайдера по тексту ошибки 400. Возвращает новое тело или null.
function adapt(body, text, modelId) {
  const raw = msgOf(text), low = raw.toLowerCase(), b = { ...body };
  const ask = b.max_tokens ?? b.max_completion_tokens;
  // «maximum context length is 128000 … (100000 in the messages, 40000 in the completion)» — уменьшаем ответ
  const ctx = /maximum context length is (\d+)/i.exec(raw), inMsg = /(\d+) in the messages/i.exec(raw) || /input(?: length)?(?: of)? (\d+) tokens/i.exec(raw);
  if (ask && ctx && inMsg) {
    const room = Number(ctx[1]) - Number(inMsg[1]) - 64;
    if (room >= 512 && room < ask) { b[b.max_tokens != null ? 'max_tokens' : 'max_completion_tokens'] = room; return b; }
    return null;
  }
  if (b.max_tokens != null && /max_completion_tokens/.test(low) && /max_tokens/.test(low)) { b.max_completion_tokens = b.max_tokens; delete b.max_tokens; return b; }
  if (ask && /max_tokens|max_completion_tokens|max_output_tokens|maximum (output|completion)|output tokens|completion tokens/.test(low) && !CONTEXT_RE.test(raw)) {
    const nums = (raw.match(/\d{3,7}/g) || []).map(Number).filter((n) => n >= 256 && n < ask);
    const key = b.max_tokens != null ? 'max_tokens' : 'max_completion_tokens';
    if (nums.length) { b[key] = Math.max(...nums); learnedCap.set(modelId, b[key]); } else delete b[key];
    return b;
  }
  for (const k of OPTIONAL) if (k in b && low.includes(k)) { delete b[k]; return b; }
  if (b.stream_options && /stream.?options|include_usage/.test(low)) { delete b.stream_options; return b; }
  return null;
}

const sleep = (ms, signal) => new Promise((r) => { const t = setTimeout(r, ms); signal && signal.addEventListener('abort', () => { clearTimeout(t); r(); }, { once: true }); });

// Открыть поток к провайдеру: повтор при сетевой ошибке/5xx (один раз) и подстройка под 400.
// Возвращает { res, ac, kick, done } — kick() продлевает таймер тишины, done() снимает таймеры.
async function open(model, body, { signal, url, headers, onAlert, native = false }) {
  const ac = new AbortController();
  const onAbort = () => ac.abort(signal.reason);
  if (signal) { if (signal.aborted) throw err('invalid', 'Request cancelled'); signal.addEventListener('abort', onAbort, { once: true }); }
  let idle = null; const total = setTimeout(() => ac.abort(new Error('total timeout')), TOTAL_MS);
  const kick = (ms = IDLE_MS) => { clearTimeout(idle); idle = setTimeout(() => ac.abort(new Error('idle timeout')), ms); };
  const done = () => { clearTimeout(idle); clearTimeout(total); if (signal) signal.removeEventListener('abort', onAbort); };
  let b = { ...body };
  if (!native) {
    const cap = learnedCap.get(model.id);
    if (cap) for (const k of ['max_tokens', 'max_completion_tokens']) if (b[k] > cap) b[k] = cap;
  }
  try {
    for (let attempt = 0, retried = false; attempt < 6; attempt++) {
      kick(FIRST_BYTE_MS);
      let r;
      try {
        r = await fetch(url || chatUrl(model.baseUrl), { method: 'POST', signal: ac.signal, headers: headers || { 'Content-Type': 'application/json', Authorization: 'Bearer ' + model.apiKey }, body: JSON.stringify(native ? b : { ...b, model: model.modelId || model.id }) });
      } catch (e) {
        if (signal && signal.aborted) throw err('invalid', 'Request cancelled');
        const timeout = /timeout/i.test(String(ac.signal.reason && ac.signal.reason.message));
        if (!retried && !timeout) { retried = true; await sleep(1500, signal); continue; }
        throw timeout ? err('timeout', 'The model did not start answering in time. Retry the request.', { retryAfter: 5 }) : err('overloaded', 'Could not reach the model provider. Retry shortly.', { retryAfter: 5, shouldRetry: true });
      }
      if (r.ok) { kick(); return { res: r, ac, kick, done, body: b }; }
      const text = await r.text().catch(() => '');
      if (!native && (r.status === 400 || r.status === 422)) { const nb = adapt(b, text, model.id); if (nb) { b = nb; continue; } }
      if (r.status >= 500 && r.status !== 501 && !retried) { retried = true; await sleep(1500, signal); if (signal && signal.aborted) throw err('invalid', 'Request cancelled'); continue; }
      const e = upstreamError(r.status, text, r.headers.get('retry-after'), onAlert);
      e.upstreamStatus = r.status; e.upstreamText = native ? text : null;
      throw e;
    }
    throw err('upstream', 'The model provider rejected the request.');
  } catch (e) { done(); throw e; }
}

const normUsage = (u) => (u ? {
  in: Number(u.prompt_tokens ?? u.input_tokens) || 0,
  out: Number(u.completion_tokens ?? u.output_tokens) || 0,
  cached: Number((u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) ?? u.cache_read_input_tokens) || 0,
  think: Number(u.completion_tokens_details && u.completion_tokens_details.reasoning_tokens) || 0,
} : null);

// Разбор потока Chat Completions. onChunk получает каждый (исправленный) кусок — для прозрачной передачи клиенту.
async function pump(up, { onEvent, onChunk, signal }) {
  const st = { finish: null, usage: null, tools: new Map(), last: -1, done: false };
  const emit = onEvent || (async () => {});
  const handle = async (j, whole) => {
    if (j.error) { const code = Number(j.error.code || j.error.status) || 502; throw upstreamError(code >= 400 && code < 600 ? code : 502, JSON.stringify(j)); }
    if (j.usage) st.usage = j.usage;
    const ch = Array.isArray(j.choices) ? j.choices[0] : null;
    if (ch) {
      const d = (whole ? ch.message : ch.delta) || {};
      if (Array.isArray(d.tool_calls)) for (const tc of d.tool_calls) {
        if (!tc || typeof tc !== 'object') continue;
        tc.function ||= {};
        let i = Number.isInteger(tc.index) ? tc.index : null;
        if (i == null) { // Gemini и др. не всегда присылают index
          const known = tc.id ? [...st.tools.entries()].find(([, t]) => t.up === tc.id) : null;
          i = known ? known[0] : tc.id || tc.function.name || st.last < 0 ? st.tools.size : st.last;
          tc.index = i;
        }
        let t = st.tools.get(i);
        if (!t) { t = { id: tc.id || 'call_' + randomB62(24), up: tc.id, name: '', args: '', started: false }; st.tools.set(i, t); if (!tc.id) tc.id = t.id; }
        if (tc.function.name && !t.name) t.name = tc.function.name;
        let a = tc.function.arguments;
        if (a != null && typeof a !== 'string') { a = JSON.stringify(a); tc.function.arguments = a; }
        if (a) t.args += a;
        if (t.name && !t.started) { t.started = true; await emit({ t: 'tool', i, id: t.id, name: t.name }); if (t.args) await emit({ t: 'args', i, d: t.args }); }
        else if (a && t.started) await emit({ t: 'args', i, d: a });
        st.last = i;
      }
      const rz = d.reasoning_content ?? d.reasoning;
      if (typeof rz === 'string' && rz) await emit({ t: 'think', d: rz });
      if (typeof d.content === 'string' && d.content) await emit({ t: 'text', d: d.content });
      if (typeof d.refusal === 'string' && d.refusal) await emit({ t: 'text', d: d.refusal });
      if (ch.finish_reason) st.finish = ch.finish_reason;
    }
    if (onChunk) await onChunk(j);
  };
  try {
    const type = String(up.res.headers.get('content-type') || '');
    if (type.includes('application/json')) { // провайдер проигнорировал stream: true
      const text = await up.res.text();
      let j; try { j = JSON.parse(text); } catch { throw err('upstream', 'The model provider returned an unreadable response.'); }
      // для прозрачной передачи клиенту — в виде одного куска потока
      if (Array.isArray(j.choices)) j = { ...j, object: 'chat.completion.chunk', choices: j.choices.map((c) => ({ index: c.index || 0, delta: c.message || {}, finish_reason: c.finish_reason || 'stop' })) };
      await handle(j, false); st.done = true;
    } else {
      for await (const ev of readSse(up.res.body, signal)) {
        up.kick();
        if (ev.data === '[DONE]') { st.done = true; break; }
        let j; try { j = JSON.parse(ev.data); } catch { continue; }
        await handle(j, false);
      }
    }
  } catch (e) {
    if (e && e.kind) throw e;
    if (signal && signal.aborted) throw err('invalid', 'Request cancelled');
    const reason = String(up.ac.signal.reason && up.ac.signal.reason.message || '');
    if (/timeout/.test(reason)) throw err('timeout', 'The model stopped responding. Retry the request.', { retryAfter: 5 });
    throw err('upstream', 'The connection to the model provider was interrupted. Retry the request.', { retryAfter: 2 });
  } finally { up.done(); }
  if (!st.finish && !st.done) throw err('upstream', 'The model provider closed the stream before finishing. Retry the request.', { retryAfter: 2 });
  for (const [i, t] of st.tools) if (!t.started) { t.started = true; t.name ||= 'unknown_tool'; await emit({ t: 'tool', i, id: t.id, name: t.name }); if (t.args) await emit({ t: 'args', i, d: t.args }); }
  let finish = st.finish || 'stop';
  if (st.tools.size && finish === 'stop') finish = 'tool_calls';
  return { finish, usage: normUsage(st.usage), tools: st.tools };
}

module.exports = { open, pump, chatUrl, nativeUrl, upstreamError, normUsage, scrub, msgOf, adapt, learnedCap };
