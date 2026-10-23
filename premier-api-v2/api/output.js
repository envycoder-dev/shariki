'use strict';
// Ответ клиенту в его протоколе: из единых событий провайдера собираем поток или JSON
// Anthropic Messages, OpenAI Responses или Chat Completions.
const { rid, encodeToolId, err } = require('./util');

const THINK_SIG = 'premier-gw'; // подпись «размышлений» шлюза: в нативный Anthropic такие блоки не пересылаем
const parseArgs = (s) => { try { const v = JSON.parse(s || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; } };
const usageOf = (u, est) => u || { in: est.in || 0, out: est.out || 0, cached: 0, think: 0, approx: true };

/* ---------- Anthropic Messages ---------- */
class MessagesOut {
  constructor({ sse, model, thinking, inputEst }) {
    Object.assign(this, { sse, model, thinking, inputEst, id: rid('msg_'), blocks: [], cur: null, tool: new Map(), outChars: 0, delivered: false });
  }
  ev(name, data) { return this.sse ? this.sse.event(name, { type: name, ...data }) : null; }
  async start() {
    await this.ev('message_start', { message: { id: this.id, type: 'message', role: 'assistant', model: this.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: this.inputEst, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } });
    await this.ev('ping', {});
  }
  async openBlock(block) {
    await this.closeBlock();
    const index = this.blocks.length;
    this.blocks.push({ ...block, _args: '' });
    this.cur = index;
    await this.ev('content_block_start', { index, content_block: block });
    return index;
  }
  async closeBlock() {
    if (this.cur == null) return;
    const index = this.cur, b = this.blocks[index];
    this.cur = null;
    if (b.type === 'thinking') { b.signature = THINK_SIG; await this.ev('content_block_delta', { index, delta: { type: 'signature_delta', signature: THINK_SIG } }); }
    await this.ev('content_block_stop', { index });
  }
  async on(e) {
    if (e.t === 'text') {
      if (this.cur == null || this.blocks[this.cur].type !== 'text') await this.openBlock({ type: 'text', text: '' });
      this.blocks[this.cur].text += e.d; this.outChars += e.d.length; this.delivered = true;
      await this.ev('content_block_delta', { index: this.cur, delta: { type: 'text_delta', text: e.d } });
    } else if (e.t === 'think') {
      if (!this.thinking) return;
      if (this.cur == null || this.blocks[this.cur].type !== 'thinking') await this.openBlock({ type: 'thinking', thinking: '', signature: '' });
      this.blocks[this.cur].thinking += e.d; this.outChars += e.d.length; this.delivered = true;
      await this.ev('content_block_delta', { index: this.cur, delta: { type: 'thinking_delta', thinking: e.d } });
    } else if (e.t === 'tool') {
      const index = await this.openBlock({ type: 'tool_use', id: encodeToolId(e.id, 'toolu_'), name: e.name, input: {} });
      this.tool.set(e.i, index); this.delivered = true;
    } else if (e.t === 'args') {
      const index = this.tool.get(e.i);
      if (index == null) return;
      if (index !== this.cur) throw err('upstream', 'The model provider interleaved parallel tool calls. Retry the request.');
      this.blocks[index]._args += e.d; this.outChars += e.d.length;
      await this.ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: e.d } });
    }
  }
  async finish({ finish, usage }) {
    await this.closeBlock();
    const u = usageOf(usage, { in: this.inputEst, out: Math.ceil(this.outChars / 4) });
    const hasTool = this.blocks.some((b) => b.type === 'tool_use');
    const stop = finish === 'length' ? 'max_tokens' : hasTool ? 'tool_use' : finish === 'content_filter' ? 'refusal' : 'end_turn';
    const usageOut = { input_tokens: Math.max(0, u.in - u.cached), cache_creation_input_tokens: 0, cache_read_input_tokens: u.cached, output_tokens: u.out };
    if (this.sse) {
      await this.ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: usageOut });
      await this.ev('message_stop', {});
      return u;
    }
    const content = this.blocks.map(({ _args, ...b }) => (b.type === 'tool_use' ? { ...b, input: parseArgs(_args) } : b));
    return { u, body: { id: this.id, type: 'message', role: 'assistant', model: this.model, content, stop_reason: stop, stop_sequence: null, usage: usageOut } };
  }
  async fail(e) { if (this.sse) await this.sse.event('error', { type: 'error', error: { type: e.kind === 'overloaded' ? 'overloaded_error' : e.kind === 'rate_limit' ? 'rate_limit_error' : e.kind === 'context' || e.kind === 'invalid' ? 'invalid_request_error' : 'api_error', message: e.message } }); }
}

/* ---------- OpenAI Responses ---------- */
class ResponsesOut {
  constructor({ sse, model, req, custom, shell, ns, inputEst }) {
    Object.assign(this, { sse, model, req, custom: custom || new Set(), shell, ns: ns || new Map(), inputEst, id: rid('resp_'), created: Math.floor(Date.now() / 1000), seq: 0, items: [], cur: null, tool: new Map(), outChars: 0, delivered: false });
  }
  ev(type, data) { return this.sse ? this.sse.event(type, { type, sequence_number: this.seq++, ...data }) : null; }
  snapshot(status, extra = {}) {
    const r = this.req;
    return { id: this.id, object: 'response', created_at: this.created, status, error: null, incomplete_details: null, instructions: r.instructions ?? null, max_output_tokens: r.max_output_tokens ?? null, model: this.model,
      output: this.items.filter((x) => x.status !== 'in_progress').map((x) => x.item), parallel_tool_calls: r.parallel_tool_calls ?? true, previous_response_id: null, reasoning: r.reasoning ?? null, store: false,
      temperature: r.temperature ?? null, text: r.text ?? { format: { type: 'text' } }, tool_choice: r.tool_choice ?? 'auto', tools: Array.isArray(r.tools) ? r.tools : [], top_p: r.top_p ?? null, truncation: 'disabled', usage: null, metadata: r.metadata ?? {}, ...extra };
  }
  async start() { const response = this.snapshot('in_progress'); await this.ev('response.created', { response }); await this.ev('response.in_progress', { response }); }
  async openItem(item, kind) {
    await this.closeItem();
    const output_index = this.items.length, x = { item, kind, status: 'in_progress', text: '', args: '' };
    this.items.push(x); this.cur = output_index;
    if (kind === 'custom' || kind === 'shell') return output_index; // объявим целиком при закрытии
    await this.ev('response.output_item.added', { output_index, item });
    if (kind === 'message') await this.ev('response.content_part.added', { item_id: item.id, output_index, content_index: 0, part: { type: 'output_text', text: '', annotations: [], logprobs: [] } });
    if (kind === 'reasoning') await this.ev('response.reasoning_summary_part.added', { item_id: item.id, output_index, summary_index: 0, part: { type: 'summary_text', text: '' } });
    return output_index;
  }
  async closeItem() {
    if (this.cur == null) return;
    const output_index = this.cur, x = this.items[output_index], id = x.item.id;
    this.cur = null; x.status = 'completed';
    if (x.kind === 'message') {
      const part = { type: 'output_text', text: x.text, annotations: [], logprobs: [] };
      await this.ev('response.output_text.done', { item_id: id, output_index, content_index: 0, text: x.text, logprobs: [] });
      await this.ev('response.content_part.done', { item_id: id, output_index, content_index: 0, part });
      x.item = { ...x.item, status: 'completed', content: [part] };
    } else if (x.kind === 'reasoning') {
      await this.ev('response.reasoning_summary_text.done', { item_id: id, output_index, summary_index: 0, text: x.text });
      await this.ev('response.reasoning_summary_part.done', { item_id: id, output_index, summary_index: 0, part: { type: 'summary_text', text: x.text } });
      x.item = { ...x.item, summary: [{ type: 'summary_text', text: x.text }] };
    } else if (x.kind === 'function') {
      await this.ev('response.function_call_arguments.done', { item_id: id, output_index, arguments: x.args });
      x.item = { ...x.item, status: 'completed', arguments: x.args };
    } else if (x.kind === 'custom') {
      const a = parseArgs(x.args);
      x.item = { ...x.item, status: 'completed', input: typeof a.input === 'string' ? a.input : x.args };
      await this.ev('response.output_item.added', { output_index, item: { ...x.item, status: 'in_progress', input: '' } });
    } else if (x.kind === 'shell') {
      const a = parseArgs(x.args);
      x.item = { ...x.item, status: 'completed', action: { type: 'exec', command: Array.isArray(a.command) ? a.command.map(String) : [String(a.command || '')], working_directory: a.workdir || null, timeout_ms: a.timeout_ms || null, env: {}, user: null } };
      await this.ev('response.output_item.added', { output_index, item: { ...x.item, status: 'in_progress' } });
    }
    await this.ev('response.output_item.done', { output_index, item: x.item });
  }
  async on(e) {
    if (e.t === 'text' || e.t === 'think') {
      const kind = e.t === 'text' ? 'message' : 'reasoning';
      if (this.cur == null || this.items[this.cur].kind !== kind) await this.openItem(kind === 'message' ? { id: rid('msg_'), type: 'message', status: 'in_progress', role: 'assistant', content: [] } : { id: rid('rs_'), type: 'reasoning', summary: [] }, kind);
      const x = this.items[this.cur]; x.text += e.d; this.outChars += e.d.length; this.delivered = true;
      if (kind === 'message') await this.ev('response.output_text.delta', { item_id: x.item.id, output_index: this.cur, content_index: 0, delta: e.d, logprobs: [] });
      else await this.ev('response.reasoning_summary_text.delta', { item_id: x.item.id, output_index: this.cur, summary_index: 0, delta: e.d });
    } else if (e.t === 'tool') {
      const call_id = encodeToolId(e.id, 'call_'), nsd = this.ns.get(e.name), name = nsd ? nsd.name : e.name, extra = nsd ? { namespace: nsd.namespace } : {};
      const kind = this.custom.has(e.name) ? 'custom' : this.shell && e.name === 'local_shell' ? 'shell' : 'function';
      const item = kind === 'custom' ? { id: rid('ctc_'), type: 'custom_tool_call', status: 'in_progress', call_id, name, ...extra, input: '' }
        : kind === 'shell' ? { id: rid('lsh_'), type: 'local_shell_call', status: 'in_progress', call_id }
        : { id: rid('fc_'), type: 'function_call', status: 'in_progress', call_id, name, ...extra, arguments: '' };
      this.tool.set(e.i, await this.openItem(item, kind)); this.delivered = true;
    } else if (e.t === 'args') {
      const output_index = this.tool.get(e.i);
      if (output_index == null) return;
      if (output_index !== this.cur) throw err('upstream', 'The model provider interleaved parallel tool calls. Retry the request.');
      const x = this.items[output_index]; x.args += e.d; this.outChars += e.d.length;
      if (x.kind === 'function') await this.ev('response.function_call_arguments.delta', { item_id: x.item.id, output_index, delta: e.d });
    }
  }
  async finish({ finish, usage }) {
    await this.closeItem();
    const u = usageOf(usage, { in: this.inputEst, out: Math.ceil(this.outChars / 4) });
    const usageOut = { input_tokens: u.in, input_tokens_details: { cached_tokens: u.cached }, output_tokens: u.out, output_tokens_details: { reasoning_tokens: u.think }, total_tokens: u.in + u.out };
    const incomplete = finish === 'length';
    const response = this.snapshot(incomplete ? 'incomplete' : 'completed', { usage: usageOut, ...(incomplete ? { incomplete_details: { reason: 'max_output_tokens' } } : {}) });
    if (this.sse) { await this.ev(incomplete ? 'response.incomplete' : 'response.completed', { response }); return u; }
    return { u, body: response };
  }
  async fail(e) {
    const code = e.kind === 'context' ? 'context_length_exceeded' : e.kind === 'rate_limit' ? 'rate_limit_exceeded' : e.kind === 'overloaded' ? 'server_is_overloaded' : 'server_error';
    if (this.sse) await this.ev('response.failed', { response: this.snapshot('failed', { error: { code, message: e.message } }) });
  }
}

/* ---------- OpenAI Chat Completions ---------- */
// Поток передаётся почти как есть (onChunk); здесь — сборка JSON для stream: false.
class ChatOut {
  constructor({ sse, model, includeUsage, inputEst }) {
    Object.assign(this, { sse, model, includeUsage, inputEst, id: 'chatcmpl-' + rid('', 29), created: Math.floor(Date.now() / 1000), text: '', think: '', tools: new Map(), outChars: 0, delivered: false, sawUsage: false });
  }
  async start() {}
  async chunk(j) { // прозрачная передача куска провайдера
    if (!this.sse) return;
    const usageOnly = !(Array.isArray(j.choices) && j.choices.length);
    if (j.usage) this.sawUsage = true;
    if (usageOnly && !this.includeUsage) return;
    const out = { ...j, id: this.id, object: 'chat.completion.chunk', created: this.created, model: this.model };
    delete out.provider;
    if (!this.includeUsage && !usageOnly) delete out.usage;
    await this.sse.data(out);
  }
  async on(e) {
    if (e.t === 'text') { this.text += e.d; this.outChars += e.d.length; this.delivered = true; }
    else if (e.t === 'think') { this.think += e.d; this.outChars += e.d.length; this.delivered = true; }
    else if (e.t === 'tool') { this.tools.set(e.i, { id: e.id, type: 'function', function: { name: e.name, arguments: '' } }); this.delivered = true; }
    else if (e.t === 'args') { const t = this.tools.get(e.i); if (t) { t.function.arguments += e.d; this.outChars += e.d.length; } }
  }
  async finish({ finish, usage }) {
    const u = usageOf(usage, { in: this.inputEst, out: Math.ceil(this.outChars / 4) });
    const usageOut = { prompt_tokens: u.in, completion_tokens: u.out, total_tokens: u.in + u.out, prompt_tokens_details: { cached_tokens: u.cached }, completion_tokens_details: { reasoning_tokens: u.think } };
    if (this.sse) {
      if (this.includeUsage && !this.sawUsage) await this.sse.data({ id: this.id, object: 'chat.completion.chunk', created: this.created, model: this.model, choices: [], usage: usageOut });
      await this.sse.data('[DONE]');
      return u;
    }
    const tool_calls = [...this.tools.keys()].sort((a, b) => a - b).map((k) => this.tools.get(k));
    const message = { role: 'assistant', content: this.text || (tool_calls.length ? null : ''), ...(this.think ? { reasoning_content: this.think } : {}), ...(tool_calls.length ? { tool_calls } : {}) };
    return { u, body: { id: this.id, object: 'chat.completion', created: this.created, model: this.model, choices: [{ index: 0, message, logprobs: null, finish_reason: finish }], usage: usageOut } };
  }
  async fail(e) { if (this.sse) { await this.sse.data({ error: { message: e.message, type: e.kind === 'rate_limit' ? 'rate_limit_error' : 'server_error', code: e.kind === 'context' ? 'context_length_exceeded' : e.code || null } }); } }
}

module.exports = { MessagesOut, ResponsesOut, ChatOut, THINK_SIG };
