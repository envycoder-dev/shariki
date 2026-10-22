'use strict';
const path = require('node:path');
let baseCatalog = {};
try { baseCatalog = require('./locales/en.json'); }
catch (e) { if (e.code !== 'MODULE_NOT_FOUND' || !e.message.includes("'./locales/en.json'")) throw e; }
const catalog = { ...baseCatalog, ...require('./locales/reviews.en.json'), ...require('./locales/api.en.json') };
const supported = new Set(['ru', 'en']);
function languageOf(req) {
  const explicit = new URL(req.url || '/', 'http://localhost').searchParams.get('lang');
  if (supported.has(explicit)) return explicit;
  const cookie = /(?:^|;\s*)premier_lang=(ru|en)(?:;|$)/.exec(req.headers.cookie || '');
  return cookie?.[1] || 'ru';
}
function languageHeaders(req, res) {
  const lang = languageOf(req);
  res.setHeader('Content-Language', lang);
  const vary = String(res.getHeader('Vary') || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!vary.includes('Cookie')) vary.push('Cookie');
  res.setHeader('Vary', vary.join(', '));
  const explicit = new URL(req.url || '/', 'http://localhost').searchParams.get('lang');
  if (supported.has(explicit)) {
    const cookie = `premier_lang=${lang}; Path=/; Max-Age=31536000; SameSite=Lax`;
    const previous = res.getHeader('Set-Cookie');
    res.setHeader('Set-Cookie', [...(previous ? Array.isArray(previous) ? previous : [previous] : []), cookie]);
  }
  return lang;
}
const htmlPath = (dir, page, req) => path.join(dir, languageOf(req) === 'en' ? 'en' : '', page);
const translated = text => catalog[text] || text;
const terms = Object.keys(catalog).sort((a,b)=>b.length-a.length);
const escaped = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pattern = new RegExp(terms.map(k => (/[А-Яа-яЁё]/.test(k[0]) ? '(?<![А-Яа-яЁё])' : '') + escaped(k) + (/[А-Яа-яЁё]/.test(k.at(-1)) ? '(?![А-Яа-яЁё])' : '')).join('|'), 'g');
function localizeResponse(req, data) {
  if (!req || languageOf(req) !== 'en' || !data || typeof data !== 'object' || Array.isArray(data)) return data;
  const out = { ...data };
  // Translate only UI error messages and stock plan descriptions, never names,
  // chat messages, projects, model IDs, keys, memory, files or generated content.
  if (typeof out.error === 'string') out.error = out.error.replace(pattern, m => catalog[m]);
  if (out.s === 'waiting' && typeof out.q === 'string') out.q = out.q.replace(pattern, m => catalog[m]);
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  if (['/api/plans','/api/billing'].includes(pathname) && Array.isArray(out.plans)) out.plans = out.plans.map(p => ({ ...p, desc: translated(p.desc) }));
  return out;
}
module.exports = { languageOf, languageHeaders, htmlPath, localizeResponse };
