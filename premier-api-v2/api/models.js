'use strict';
// Модели в API: читаемые ID («claude-sonnet-4.5»), поиск по ID, доступ по тарифу и проверка «готова для агентов».
const crypto = require('node:crypto');
const up = require('./upstream');

const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
const SLUG_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const slugify = (name) => String(name || '').toLowerCase().replace(/[а-яё]/g, (c) => TR[c] ?? '').replace(/[^a-z0-9.]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').replace(/-{2,}/g, '-').slice(0, 64) || 'model';

// Каждой модели — постоянный ID для API. Старый apiId (прежний API) сохраняем, если он есть. Возвращает true, если что-то поменялось.
function ensureSlugs(models) {
  let changed = false;
  const used = new Set();
  for (const m of models) {
    if (typeof m.slug === 'string' && SLUG_RE.test(m.slug) && !used.has(m.slug)) { used.add(m.slug); continue; }
    if (m.slug !== undefined) { delete m.slug; changed = true; }
  }
  for (const m of models) {
    if (m.slug) continue;
    const base = typeof m.apiId === 'string' && SLUG_RE.test(m.apiId) && !used.has(m.apiId) ? m.apiId : slugify(m.name);
    let s = base;
    for (let n = 2; used.has(s); n++) s = base.slice(0, 60) + '-' + n;
    m.slug = s; used.add(s); changed = true;
  }
  for (const m of models) if ('apiId' in m || 'apiAliases' in m) { delete m.apiId; delete m.apiAliases; changed = true; }
  return changed;
}

function resolve(models, id) {
  if (typeof id !== 'string' || !id.trim()) return null;
  const s = id.trim(), low = s.toLowerCase();
  return models.find((m) => m.slug === s) || models.find((m) => m.slug && m.slug.toLowerCase() === low) || models.find((m) => m.id === s) || models.find((m) => m.modelId === s) || null;
}

/* ---------- «готова для агентов»: модель умеет вызывать инструменты в потоке ---------- */
const sig = (m) => crypto.createHash('sha256').update([m.baseUrl, m.modelId, m.apiKey].join('\n')).digest('hex').slice(0, 16);
function createAgentCheck(store, loadModels, monitor) {
  const KEY = 'api:agent';
  const all = () => store.kv.get(KEY, {});
  const status = (m) => { const r = all()[m.id]; return r && r.sig === sig(m) ? r.ok : null; };
  let busy = false;
  async function check(m) {
    const body = {
      messages: [{ role: 'system', content: 'You are a test harness. Always use the provided tool to answer.' }, { role: 'user', content: 'What is the weather in Paris right now? Call the get_weather tool.' }],
      tools: [{ type: 'function', function: { name: 'get_weather', description: 'Get the current weather for a city', parameters: { type: 'object', properties: { city: { type: 'string', description: 'City name' } }, required: ['city'] } } }],
      stream: true, stream_options: { include_usage: true }, max_tokens: 400,
    };
    const signal = AbortSignal.timeout(90000);
    try {
      const u = await up.open(m, body, { signal });
      const r = await up.pump(u, { signal });
      const t = [...r.tools.values()][0];
      let args = null; try { args = JSON.parse(t && t.args || 'null'); } catch {}
      return { ok: !!(t && t.name === 'get_weather' && args && typeof args.city === 'string'), err: t ? null : 'no tool call' };
    } catch (e) { return { ok: null, err: String(e.message || e).slice(0, 200) }; } // сбой провайдера ≠ «не умеет инструменты»
  }
  // проверяем модели без свежего результата: раз в 3 дня или после смены провайдера/ключа
  async function run(force) {
    if (busy) return; busy = true;
    try {
      for (const m of loadModels()) {
        const cur = all()[m.id];
        if (!force && cur && cur.sig === sig(m) && cur.ok !== null && Date.now() - cur.at < 3 * 86400000) continue;
        const r = await check(m);
        const map = all(); map[m.id] = { ok: r.ok, at: Date.now(), sig: sig(m), err: r.err }; store.kv.set(KEY, map);
      }
      const ids = new Set(loadModels().map((m) => m.id)), map = all(); let dirty = false;
      for (const id of Object.keys(map)) if (!ids.has(id)) { delete map[id]; dirty = true; }
      if (dirty) store.kv.set(KEY, map);
    } catch (e) { monitor && monitor.error('api agent check', e); }
    finally { busy = false; }
  }
  return { status, run, check, raw: all };
}

module.exports = { ensureSlugs, resolve, slugify, createAgentCheck };
