'use strict';
// Перевод входящих запросов (Chat Completions, Responses, Anthropic Messages) в один внутренний формат —
// тело OpenAI Chat Completions, которое понимает любой OpenAI-совместимый провайдер.
const { err, decodeToolId } = require('./util');

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v));
const fn = (name, description, parameters) => ({ type: 'function', function: { name, description: description || '', parameters: cleanSchema(parameters) } });

// $schema и пустые схемы ломают часть провайдеров (Gemini и др.)
function cleanSchema(s) {
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (!isObj(v)) return v;
    const o = {};
    for (const [k, x] of Object.entries(v)) if (k !== '$schema') o[k] = walk(x);
    return o;
  };
  const out = isObj(s) ? walk(s) : {};
  if (!out.type) out.type = 'object';
  if (out.type === 'object' && !isObj(out.properties)) out.properties = {};
  return out;
}

function checkName(name, where) {
  if (typeof name !== 'string' || !name) throw err('invalid', `${where}: tool name is required`);
}

// Части содержимого → формат Chat Completions; только текст — склеиваем в строку (так понимают все провайдеры).
function simplify(parts) {
  if (!parts.length) return '';
  if (parts.every((p) => p.type === 'text')) return parts.map((p) => p.text).join('\n\n');
  return parts;
}
const imagePart = (url, detail) => ({ type: 'image_url', image_url: detail ? { url, detail } : { url } });
const filePart = (filename, data) => ({ type: 'file', file: { filename: filename || 'document.pdf', file_data: data } });

// Ассистент: текст и вызовы инструментов одного хода — одно сообщение.
function pushAssistantText(msgs, text) { msgs.push({ role: 'assistant', content: text }); }
function pushToolCall(msgs, call) {
  const last = msgs[msgs.length - 1];
  const tc = { id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } };
  if (last && last.role === 'assistant') { (last.tool_calls ||= []).push(tc); if (last.content === '') last.content = null; }
  else msgs.push({ role: 'assistant', content: null, tool_calls: [tc] });
}

/* ---------- приведение истории к виду, который примут все провайдеры ---------- */
// - у каждого вызова инструмента есть ответ сразу после сообщения ассистента (иначе 400 у OpenAI-совместимых);
// - «осиротевшие» ответы инструментов становятся обычным текстом;
// - пустые сообщения ассистента убираются.
// - все системные сообщения (Claude Code и Codex шлют их и посреди диалога) — одной инструкцией в начале:
//   так их принимает любой провайдер.
const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.filter((p) => p && p.type === 'text').map((p) => p.text).join('\n') : '');
function sanitize(all) {
  const sys = all.filter((m) => m.role === 'system').map((m) => textOf(m.content)).filter((t) => t.trim());
  const msgs = all.filter((m) => m.role !== 'system');
  const out = sys.length ? [{ role: 'system', content: sys.join('\n\n') }] : [];
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.role === 'assistant') {
      const calls = (m.tool_calls || []).filter((c) => c && c.function && c.function.name);
      const seen = new Set();
      for (const c of calls) { if (!c.id || seen.has(c.id)) c.id = 'call_' + i + '_' + seen.size; seen.add(c.id); }
      const empty = (m.content == null || m.content === '' || (Array.isArray(m.content) && !m.content.length)) && !calls.length;
      if (empty) continue;
      out.push(calls.length ? { ...m, content: m.content === '' ? null : m.content, tool_calls: calls } : { role: 'assistant', content: m.content });
      if (!calls.length) continue;
      const results = new Map(), orphans = [];
      let j = i + 1;
      for (; j < msgs.length && msgs[j].role === 'tool'; j++) {
        const t = msgs[j];
        if (seen.has(t.tool_call_id) && !results.has(t.tool_call_id)) results.set(t.tool_call_id, t); else orphans.push(t);
      }
      for (const c of calls) out.push(results.get(c.id) || { role: 'tool', tool_call_id: c.id, content: 'No result: the tool call was interrupted.' });
      for (const t of orphans) out.push({ role: 'user', content: `[Result of tool call ${t.tool_call_id}]\n${str(t.content)}` });
      i = j - 1;
    } else if (m.role === 'tool') out.push({ role: 'user', content: `[Result of tool call ${m.tool_call_id}]\n${str(m.content)}` });
    else out.push(m);
  }
  return out;
}

// Модель без зрения: картинки и PDF заменяем пометкой, чтобы агент не застрял на одном скриншоте в истории.
function stripMedia(msgs) {
  let n = 0;
  for (const m of msgs) {
    if (!Array.isArray(m.content)) continue;
    m.content = simplify(m.content.map((p) => {
      if (p.type === 'image_url' || p.type === 'file') { n++; return { type: 'text', text: `[${p.type === 'file' ? 'file' : 'image'} omitted: this model does not accept images or files]` }; }
      return p;
    }));
  }
  return n;
}
const hasMedia = (msgs) => msgs.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url' || p.type === 'file'));

/* ---------- OpenAI Chat Completions ---------- */
// Протокол и так «родной» для провайдеров: передаём как есть, убирая только поля, которые знает лишь OpenAI.
const OPENAI_ONLY = ['store', 'metadata', 'service_tier', 'prompt_cache_key', 'prompt_cache_retention', 'safety_identifier', 'prediction', 'modalities', 'audio', 'web_search_options'];
function fromChat(b) {
  if (!Array.isArray(b.messages) || !b.messages.length) throw err('invalid', 'messages: a non-empty array is required', { param: 'messages' });
  if (b.n != null && b.n !== 1) throw err('invalid', 'Only n=1 is supported', { param: 'n' });
  for (const [i, m] of b.messages.entries()) if (!isObj(m) || typeof m.role !== 'string') throw err('invalid', `messages[${i}]: role is required`, { param: 'messages' });
  const body = { ...b };
  for (const k of [...OPENAI_ONLY, 'model', 'stream', 'stream_options', 'n']) delete body[k];
  if (body.max_completion_tokens != null && body.max_tokens == null) { body.max_tokens = body.max_completion_tokens; delete body.max_completion_tokens; }
  return { body, stream: b.stream === true, includeUsage: !!(b.stream_options && b.stream_options.include_usage), wantsThinking: true };
}

/* ---------- OpenAI Responses (Codex) ---------- */
function respParts(content) {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (!Array.isArray(content)) return [];
  const parts = [];
  for (const p of content) {
    if (!isObj(p)) continue;
    if (p.type === 'input_text' || p.type === 'output_text' || p.type === 'text' || p.type === 'summary_text') parts.push({ type: 'text', text: str(p.text) });
    else if (p.type === 'refusal') parts.push({ type: 'text', text: str(p.refusal) });
    else if (p.type === 'input_image') {
      const url = typeof p.image_url === 'string' ? p.image_url : isObj(p.image_url) ? p.image_url.url : null;
      parts.push(url ? imagePart(url, p.detail && p.detail !== 'auto' ? p.detail : undefined) : { type: 'text', text: '[image omitted: file_id references are not supported]' });
    } else if (p.type === 'input_file') {
      if (typeof p.file_data === 'string') parts.push(filePart(p.filename, p.file_data.startsWith('data:') ? p.file_data : 'data:application/pdf;base64,' + p.file_data));
      else parts.push({ type: 'text', text: `[file omitted: ${p.filename || p.file_url || p.file_id || 'unsupported reference'}]` });
    }
  }
  return parts;
}
function toolOutput(output) {
  if (typeof output === 'string') return { text: output, media: [] };
  const parts = respParts(output), media = parts.filter((p) => p.type !== 'text');
  return { text: parts.filter((p) => p.type === 'text').map((p) => p.text).join('\n'), media };
}
// имя функции для провайдера: только [a-zA-Z0-9_-], до 64 символов
const nsName = (namespace, name) => `${namespace}__${name}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
function grammarNote(format) {
  if (!isObj(format) || format.type !== 'grammar' || typeof format.definition !== 'string') return '';
  return `\n\nThe "input" string must follow this ${format.syntax || ''} grammar exactly:\n${format.definition}`;
}
function fromResponses(b) {
  if (b.previous_response_id) throw err('invalid', 'previous_response_id is not supported: responses are not stored. Send the whole conversation in `input` with store=false (Codex does this automatically).', { param: 'previous_response_id' });
  if (b.conversation) throw err('invalid', 'conversation is not supported: send the whole conversation in `input`.', { param: 'conversation' });
  const input = typeof b.input === 'string' ? [{ role: 'user', content: b.input }] : Array.isArray(b.input) ? b.input : null;
  if (!input) throw err('invalid', 'input: a string or an array of items is required', { param: 'input' });
  const msgs = [];
  if (typeof b.instructions === 'string' && b.instructions.trim()) msgs.push({ role: 'system', content: b.instructions });
  const tools = [], custom = new Set(), ns = new Map(); let shell = false;
  const list = [];
  for (const t of Array.isArray(b.tools) ? b.tools : []) {
    if (isObj(t) && t.type === 'namespace' && Array.isArray(t.tools)) { // Codex: группа инструментов (multi_agent_v1 и т. п.)
      for (const x of t.tools) if (isObj(x) && typeof x.name === 'string') { const flat = nsName(t.name, x.name); ns.set(flat, { name: x.name, namespace: t.name }); list.push({ ...x, name: flat, description: [t.description, x.description].filter(Boolean).join(' — ') }); }
    } else list.push(t);
  }
  for (const t of list) {
    if (!isObj(t)) continue;
    if (t.type === 'function') { checkName(t.name, 'tools'); tools.push(fn(t.name, t.description, t.parameters)); }
    else if (t.type === 'custom') {
      checkName(t.name, 'tools'); custom.add(t.name);
      tools.push(fn(t.name, (t.description || '') + grammarNote(t.format), { type: 'object', properties: { input: { type: 'string', description: 'The raw tool input.' } }, required: ['input'], additionalProperties: false }));
    } else if (t.type === 'local_shell') {
      shell = true;
      tools.push(fn('local_shell', 'Run a command on the local machine. `command` is argv (for example ["bash","-lc","ls"]).', { type: 'object', properties: { command: { type: 'array', items: { type: 'string' } }, workdir: { type: 'string' }, timeout_ms: { type: 'integer' } }, required: ['command'] }));
    }
    // web_search, file_search, mcp, image_generation и т. п. выполняет сервер OpenAI — здесь их нет, пропускаем
  }
  let pendingMedia = [];
  const flushMedia = () => { if (pendingMedia.length) { msgs.push({ role: 'user', content: [{ type: 'text', text: 'Attachments from the tool results above:' }, ...pendingMedia] }); pendingMedia = []; } };
  for (const it of input) {
    if (!isObj(it)) continue;
    const type = it.type || (it.role ? 'message' : '');
    if (type !== 'function_call_output' && type !== 'custom_tool_call_output' && type !== 'local_shell_call_output') flushMedia();
    if (type === 'message') {
      const role = it.role === 'developer' ? 'system' : it.role;
      if (role === 'assistant') pushAssistantText(msgs, respParts(it.content).filter((p) => p.type === 'text').map((p) => p.text).join(''));
      else if (role === 'user' || role === 'system') { const c = simplify(respParts(it.content)); if (c !== '' && !(Array.isArray(c) && !c.length)) msgs.push({ role, content: c }); }
    } else if (type === 'function_call') pushToolCall(msgs, { id: decodeToolId(it.call_id), name: it.namespace ? nsName(it.namespace, it.name) : it.name, arguments: typeof it.arguments === 'string' ? it.arguments : JSON.stringify(it.arguments ?? {}) });
    else if (type === 'custom_tool_call') pushToolCall(msgs, { id: decodeToolId(it.call_id), name: it.namespace ? nsName(it.namespace, it.name) : it.name, arguments: JSON.stringify({ input: str(it.input) }) });
    else if (type === 'local_shell_call') pushToolCall(msgs, { id: decodeToolId(it.call_id || it.id), name: 'local_shell', arguments: JSON.stringify(isObj(it.action) ? { command: it.action.command, workdir: it.action.working_directory || it.action.workdir, timeout_ms: it.action.timeout_ms } : {}) });
    else if (type === 'function_call_output' || type === 'custom_tool_call_output' || type === 'local_shell_call_output') {
      const o = toolOutput(it.output);
      msgs.push({ role: 'tool', tool_call_id: decodeToolId(it.call_id || it.id), content: o.text || (o.media.length ? '(see attachments below)' : '(empty output)') });
      pendingMedia.push(...o.media);
    }
    // reasoning, web_search_call, item_reference, compaction — модель их не принимает, пропускаем
  }
  flushMedia();
  const body = { messages: sanitize(msgs) };
  if (tools.length) {
    body.tools = tools;
    const tc = b.tool_choice;
    if (tc === 'auto' || tc === 'none' || tc === 'required') body.tool_choice = tc;
    else if (isObj(tc) && (tc.type === 'function' || tc.type === 'custom') && tc.name) body.tool_choice = { type: 'function', function: { name: tc.name } };
    if (typeof b.parallel_tool_calls === 'boolean' && !b.parallel_tool_calls) body.parallel_tool_calls = false;
  }
  if (Number.isInteger(b.max_output_tokens) && b.max_output_tokens > 0) body.max_tokens = b.max_output_tokens;
  if (typeof b.temperature === 'number') body.temperature = b.temperature;
  if (typeof b.top_p === 'number') body.top_p = b.top_p;
  const f = isObj(b.text) && isObj(b.text.format) ? b.text.format : null;
  if (f && f.type === 'json_schema' && isObj(f.schema)) body.response_format = { type: 'json_schema', json_schema: { name: f.name || 'output', schema: f.schema, ...(typeof f.strict === 'boolean' ? { strict: f.strict } : {}) } };
  else if (f && f.type === 'json_object') body.response_format = { type: 'json_object' };
  if (!body.messages.some((m) => m.role !== 'system')) throw err('invalid', 'input: at least one message is required', { param: 'input' });
  return { body, stream: b.stream === true, custom, shell, ns, wantsThinking: true };
}

/* ---------- Anthropic Messages (Claude Code) ---------- */
function anthropicMedia(c) {
  const s = c.source;
  if (c.type === 'image') {
    if (isObj(s) && s.type === 'base64' && s.data) return imagePart(`data:${s.media_type || 'image/png'};base64,${s.data}`);
    if (isObj(s) && s.type === 'url' && s.url) return imagePart(s.url);
    return { type: 'text', text: '[image omitted: unsupported image source]' };
  }
  // document
  if (isObj(s) && s.type === 'text') return { type: 'text', text: (c.title ? c.title + '\n' : '') + str(s.data) };
  if (isObj(s) && s.type === 'content' && Array.isArray(s.content)) return { type: 'text', text: s.content.filter((x) => x && x.type === 'text').map((x) => x.text).join('\n') };
  if (isObj(s) && s.type === 'base64' && s.data) return filePart(c.title ? c.title + '.pdf' : 'document.pdf', `data:${s.media_type || 'application/pdf'};base64,${s.data}`);
  if (isObj(s) && s.type === 'url' && s.url) return { type: 'text', text: `[document: ${s.url}]` };
  return { type: 'text', text: '[document omitted: unsupported source]' };
}
function fromMessages(b) {
  if (!Array.isArray(b.messages) || !b.messages.length) throw err('invalid', 'messages: a non-empty array is required');
  const msgs = [];
  const sys = typeof b.system === 'string' ? b.system
    : Array.isArray(b.system) ? b.system.filter((x) => isObj(x) && x.type === 'text' && typeof x.text === 'string' && !x.text.startsWith('x-anthropic-billing-header')).map((x) => x.text).join('\n\n') : '';
  if (sys.trim()) msgs.push({ role: 'system', content: sys });
  for (const [i, m] of b.messages.entries()) {
    if (!isObj(m) || !['user', 'assistant', 'system'].includes(m.role)) throw err('invalid', `messages.${i}.role: must be "user" or "assistant"`);
    const blocks = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : Array.isArray(m.content) ? m.content : null;
    if (!blocks) throw err('invalid', `messages.${i}.content: must be a string or an array of content blocks`);
    if (m.role === 'system') { msgs.push({ role: 'system', content: blocks.filter((c) => isObj(c) && c.type === 'text').map((c) => str(c.text)).join('\n\n') }); continue; }
    if (m.role === 'assistant') {
      const text = blocks.filter((c) => isObj(c) && c.type === 'text').map((c) => str(c.text)).join('');
      pushAssistantText(msgs, text);
      for (const c of blocks) if (isObj(c) && (c.type === 'tool_use' || c.type === 'server_tool_use')) pushToolCall(msgs, { id: decodeToolId(c.id), name: c.name, arguments: JSON.stringify(c.input ?? {}) });
      continue; // thinking / redacted_thinking провайдеру не отправляем — так же, как в чате
    }
    const tools = [], media = [], parts = [];
    for (const c of blocks) {
      if (!isObj(c)) continue;
      if (c.type === 'tool_result') {
        let text = '';
        if (typeof c.content === 'string') text = c.content;
        else if (Array.isArray(c.content)) for (const x of c.content) {
          if (!isObj(x)) continue;
          if (x.type === 'text') text += (text ? '\n' : '') + str(x.text);
          else if (x.type === 'tool_reference') text += (text ? '\n' : '') + `Tool "${str(x.tool_name)}" is now loaded and can be called.`;
          else if (x.type === 'image' || x.type === 'document') { const p = anthropicMedia(x); if (p.type === 'text') text += (text ? '\n' : '') + p.text; else media.push(p); }
        }
        tools.push({ role: 'tool', tool_call_id: decodeToolId(c.tool_use_id), content: (c.is_error ? 'Error: ' : '') + (text || (media.length ? '(see attachments below)' : '(empty result)')) });
      } else if (c.type === 'text') parts.push({ type: 'text', text: str(c.text) });
      else if (c.type === 'image' || c.type === 'document') parts.push(anthropicMedia(c));
    }
    msgs.push(...tools);
    const all = [...(media.length ? [{ type: 'text', text: 'Attachments from the tool results above:' }, ...media] : []), ...parts];
    if (all.length) msgs.push({ role: 'user', content: simplify(all) });
  }
  const body = { messages: sanitize(msgs) };
  const tools = [];
  for (const t of Array.isArray(b.tools) ? b.tools : []) {
    if (!isObj(t) || typeof t.name !== 'string') continue;
    if (t.type && t.type !== 'custom') continue; // серверные инструменты Anthropic (web_search_*, code_execution_*) здесь не выполнить
    if (!isObj(t.input_schema)) continue;
    tools.push(fn(t.name, t.description, t.input_schema));
  }
  const tc = isObj(b.tool_choice) ? b.tool_choice : null;
  if (tools.length && !(tc && tc.type === 'none')) {
    body.tools = tools;
    if (tc && tc.type === 'any') body.tool_choice = 'required';
    else if (tc && tc.type === 'tool' && tc.name) body.tool_choice = { type: 'function', function: { name: tc.name } };
    if (tc && tc.disable_parallel_tool_use === true) body.parallel_tool_calls = false;
  }
  if (Number.isInteger(b.max_tokens) && b.max_tokens > 0) body.max_tokens = b.max_tokens;
  if (typeof b.temperature === 'number') body.temperature = b.temperature;
  if (typeof b.top_p === 'number') body.top_p = b.top_p;
  if (Array.isArray(b.stop_sequences) && b.stop_sequences.length) body.stop = b.stop_sequences.filter((x) => typeof x === 'string' && x).slice(0, 4);
  if (!body.messages.some((m) => m.role !== 'system')) throw err('invalid', 'messages: at least one non-empty message is required');
  const th = isObj(b.thinking) ? b.thinking.type : null;
  return { body, stream: b.stream === true, wantsThinking: th === 'enabled' || th === 'adaptive' };
}

module.exports = { fromChat, fromResponses, fromMessages, sanitize, stripMedia, hasMedia, cleanSchema };
