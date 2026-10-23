'use strict';
// Поддельный провайдер модели для тестов API: OpenAI-совместимый /v1/chat/completions и Anthropic /v1/messages.
// Сценарий выбирается по тексту последнего сообщения (HELLO, TOOL, TOOL2, PATCH, THINK, MAXTOK, CTX, FAIL500, SLOW, JSONMODE…).
const http = require('node:http');

const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => (p && p.type === 'text' ? p.text : '')).join(' ') : '');

function createFakeProvider() {
  const calls = [], state = { fail500: 0, aborted: 0 };
  const srv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', async () => {
      let body = {}; try { body = JSON.parse(raw || '{}'); } catch {}
      calls.push({ path: req.url, headers: req.headers, body });
      res.on('close', () => { if (!res.writableFinished) state.aborted++; });
      if (req.url.endsWith('/messages')) return anthropic(body, res);
      if (!req.url.endsWith('/chat/completions')) { res.writeHead(404); return res.end('{}'); }
      const msgs = body.messages || [], last = msgs[msgs.length - 1] || {}, text = textOf(last.content);
      const errorJson = (code, message) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message, type: 'invalid_request_error' } })); };
      if (/FAIL500/.test(text) && state.fail500++ % 2 === 0) { res.writeHead(500); return res.end('{"error":{"message":"boom"}}'); }
      if (/MAXTOK/.test(text) && (body.max_tokens || 0) > 4096) return errorJson(400, `max_tokens: ${body.max_tokens} > 4096, which is the maximum allowed number of output tokens for fake-1`);
      if (/CTX/.test(text)) return errorJson(400, "This model's maximum context length is 8192 tokens. However, your messages resulted in 9000 tokens.");
      if (/NOOPT/.test(text) && body.parallel_tool_calls !== undefined) return errorJson(400, 'Unrecognized request argument supplied: parallel_tool_calls');
      if (/JSONMODE/.test(text)) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ id: 'x', choices: [{ index: 0, message: { role: 'assistant', content: 'plain json' }, finish_reason: 'stop' }], usage: { prompt_tokens: 7, completion_tokens: 2 } })); }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const send = (o) => res.write('data: ' + JSON.stringify(o) + '\n\n');
      const chunk = (delta, finish = null) => send({ id: 'gen-1', object: 'chat.completion.chunk', created: 1, model: 'fake-1', provider: 'SecretUpstream', choices: [{ index: 0, delta, finish_reason: finish }] });
      const usage = () => { if (!/NOUSAGE/.test(text)) send({ id: 'gen-1', object: 'chat.completion.chunk', choices: [], usage: { prompt_tokens: 11, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 3 } } }); };
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      res.write(': OPENROUTER PROCESSING\n\n');
      if (last.role === 'tool') { chunk({ role: 'assistant', content: 'Sunny, ' }); chunk({ content: '22°C.' }); chunk({}, 'stop'); usage(); }
      else if (/TOOL2/.test(text)) {
        chunk({ role: 'assistant', content: null, tool_calls: [{ index: 0, id: 'functions.get_weather:0', type: 'function', function: { name: 'get_weather', arguments: '' } }] });
        chunk({ tool_calls: [{ index: 0, function: { arguments: '{"city":"Paris"}' } }] });
        chunk({ tool_calls: [{ index: 1, id: 'functions.get_weather:1', type: 'function', function: { name: 'get_weather', arguments: '{"city":' } }] });
        chunk({ tool_calls: [{ index: 1, function: { arguments: '"Rome"}' } }] });
        chunk({}, 'tool_calls'); usage();
      } else if (/PATCH/.test(text)) {
        chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'call_patch1', type: 'function', function: { name: 'apply_patch', arguments: '{"input":"*** Begin Patch\\n*** Add File: a.txt\\n+hi\\n*** End Patch"}' } }] });
        chunk({}, 'tool_calls'); usage();
      } else if (/NSCALL/.test(text)) {
        chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'call_ns1', type: 'function', function: { name: 'multi_agent_v1__spawn_agent', arguments: '{"task":"x"}' } }] });
        chunk({}, 'tool_calls'); usage();
      } else if (/TOOL/.test(text)) {
        chunk({ role: 'assistant', content: 'Let me check. ' });
        chunk({ tool_calls: [{ index: 0, id: 'call_fake1', type: 'function', function: { name: 'get_weather', arguments: '' } }] });
        for (const part of ['{"ci', 'ty": "Pa', 'ris"}']) chunk({ tool_calls: [{ index: 0, function: { arguments: part } }] });
        chunk({}, 'stop'); usage(); // некоторые провайдеры пишут stop вместо tool_calls
      } else if (/THINK/.test(text)) {
        chunk({ role: 'assistant', reasoning_content: 'Thinking hard. ' }); chunk({ reasoning_content: 'Done.' }); chunk({ content: 'Answer: 42' }); chunk({}, 'stop'); usage();
      } else if (/SLOW/.test(text)) {
        for (let i = 0; i < 40 && !res.destroyed; i++) { chunk({ content: 'tick ' }); await wait(100); }
        chunk({}, 'stop'); usage();
      } else if (/CUT/.test(text)) { chunk({ role: 'assistant', content: 'partial' }); return setTimeout(() => res.destroy(), 50); }
      else { chunk({ role: 'assistant', content: 'Hello ' }); chunk({ content: 'from ' }); chunk({ content: 'fake!' }); chunk({}, 'stop'); usage(); }
      res.write('data: [DONE]\n\n'); res.end();
    });
  });
  function anthropic(body, res) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const ev = (name, data) => res.write(`event: ${name}\ndata: ${JSON.stringify({ type: name, ...data })}\n\n`);
    ev('message_start', { message: { id: 'msg_native', type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, usage: { input_tokens: 20, cache_read_input_tokens: 100, cache_creation_input_tokens: 0, output_tokens: 1 } } });
    ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
    ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'native hi' } });
    ev('content_block_stop', { index: 0 });
    ev('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 4 } });
    ev('message_stop', {});
    res.end();
  }
  return {
    calls, state,
    listen: () => new Promise((r) => srv.listen(0, '127.0.0.1', () => r('http://127.0.0.1:' + srv.address().port))),
    close: () => new Promise((r) => { srv.closeAllConnections(); srv.close(r); }),
    last: () => calls[calls.length - 1],
  };
}

module.exports = { createFakeProvider };
