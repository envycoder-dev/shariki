// Premier — клиент
let MODELS = [], CFG = { search: false }, VOICES = [];
const ME = window.ME || { id: 'guest', login: 'Гость' };
const KEY = 'premier-v4:' + ME.id;
// старые чаты (до появления аккаунтов) достаются первому вошедшему в этом браузере
if (!localStorage.getItem(KEY) && localStorage.getItem('premier-v4')) { localStorage.setItem(KEY, localStorage.getItem('premier-v4')); localStorage.removeItem('premier-v4'); }
const toLogin = () => location.replace('/login');
const S = JSON.parse(localStorage.getItem(KEY) || 'null') || { projects: [{ id: 'p1', name: 'Работа' }, { id: 'p2', name: 'Учёба' }], chats: [], cur: null, proj: null, model: null, side: true };
S.del ||= [];
/* ---------- синхронизация с сервером: чаты одинаковые на всех устройствах ---------- */
const SYNC = JSON.parse(localStorage.getItem(KEY + ':sync') || 'null') || { rev: 0, dirty: true };
let saveWarned = false, pushT = null, pushing = false, editN = 0;
const persistLocal = () => {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { if (!saveWarned) { saveWarned = true; toast('Память браузера заполнена — чаты всё равно сохраняются на сервере'); } }
  try { localStorage.setItem(KEY + ':sync', JSON.stringify(SYNC)); } catch {}
};
const save = () => { SYNC.dirty = true; editN++; persistLocal(); clearTimeout(pushT); pushT = setTimeout(push, 1200); };
const cleanState = () => JSON.parse(JSON.stringify(S, (k, v) => (k === 'live' || k === 'thinking' || k === 'stepOn') ? undefined : v));
async function push() {
  if (pushing || busy) { clearTimeout(pushT); pushT = setTimeout(push, 1500); return; }
  pushing = true; const n = editN; let again = false;
  try {
    const r = await fetch('/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rev: SYNC.rev, state: cleanState() }) });
    if (r.status === 401) return toLogin();
    const j = await r.json().catch(() => ({}));
    if (r.status === 409) { mergeIn(j.state); SYNC.rev = j.rev; again = true; prep(); render(); return; }
    if (!r.ok) throw new Error(j.error || r.status);
    SYNC.rev = j.rev; if (editN === n) SYNC.dirty = false; persistLocal();
  } catch { clearTimeout(pushT); pushT = setTimeout(push, 10000); }
  finally { pushing = false; if (again) push(); }
}
const weight = (c) => c.msgs.length * 1e7 + c.msgs.reduce((n, m) => n + (m.t || '').length, 0);
function mergeIn(R) {
  if (!R) return;
  const del = new Set([...(S.del || []), ...(R.del || [])]), mine = new Map(S.chats.map((c) => [c.id, c]));
  const extra = (R.chats || []).filter((c) => !mine.has(c.id) && !del.has(c.id));
  S.chats = [...extra, ...S.chats.filter((c) => !del.has(c.id)).map((c) => { const o = (R.chats || []).find((x) => x.id === c.id); return o && weight(o) > weight(c) ? o : c; })];
  const pids = new Set(S.projects.map((x) => x.id)); S.projects = [...S.projects, ...(R.projects || []).filter((x) => !pids.has(x.id))];
  S.del = [...del].slice(-500);
  if (S.cur && !S.chats.some((c) => c.id === S.cur)) S.cur = null;
}
function replaceState(R) {
  const side = S.side; for (const k of Object.keys(S)) delete S[k];
  Object.assign(S, { projects: [], chats: [], del: [] }, R, { side });
  if (S.cur && !S.chats.some((c) => c.id === S.cur)) S.cur = null;
}
function prep() { S.chats.forEach((c) => c.msgs.forEach((m) => { m.id = m.id || uid(); if (m !== LIVE) { m.live = false; m.thinking = false; } seen.add(m.id); })); }
let LIVE = null;
async function pull(initial) {
  if (busy || pushing) return;
  try {
    const r = await fetch('/api/state'); if (r.status === 401) return toLogin();
    const j = await r.json(); if (busy) return;
    if (!j.state) { if (initial) { SYNC.dirty = true; push(); } return; }
    if (j.rev === SYNC.rev) { if (SYNC.dirty) push(); return; }
    if (SYNC.dirty) { mergeIn(j.state); SYNC.rev = j.rev; persistLocal(); push(); } else { replaceState(j.state); SYNC.rev = j.rev; persistLocal(); }
    prep(); if (A.open && !findMsg(A.mid)) closeArt(); render();
  } catch {}
}
const $ = (id) => document.getElementById(id);
const uid = () => Math.random().toString(36).slice(2, 9);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cur = () => S.chats.find((c) => c.id === S.cur);
const curModel = () => MODELS.find((m) => m.id === S.model);
const mobile = () => matchMedia('(max-width:860px)').matches;
let busy = null, busyChat = null, filter = '';
const A = { open: false, mid: null, k: 0, tab: 'preview', follow: false, shown: '' };
S.chats.forEach((c) => c.msgs.forEach((m) => { m.id = m.id || uid(); m.live = false; m.thinking = false; }));
const seen = new Set(S.chats.flatMap((c) => c.msgs.map((m) => m.id)));
const markSeen = () => { const c = cur(); if (c) c.msgs.forEach((m) => seen.add(m.id)); };

/* ---------- markdown + artifacts ---------- */
const FENCE = /```([\w-]*)([^\n]*)\n([\s\S]*?)(```|$)/g;
const isHtml = (lang, code) => /^html?$/i.test(lang) || (!lang && /^\s*<(!doctype|html)/i.test(code));
const artTitle = (code) => (code.match(/<title>([^<]*)<\/title>/i)?.[1] || '').trim() || 'Сайт';
/* файлы: ```html:my-site/index.html  (а также path=…, file=…, ```index.html) */
function normPath(p) {
  const out = [];
  for (const seg of p.replace(/\\/g, '/').split('/')) { if (!seg || seg === '.') continue; if (seg === '..') out.pop(); else out.push(seg.replace(/[<>:"|?*\x00-\x1f]/g, '_')); }
  return out.join('/').slice(0, 200);
}
function fpath(lang, info) {
  info = info.trim(); let m;
  if (lang && /^[.\/]/.test(info)) return normPath(lang + info.split(/\s/)[0]);
  if ((m = info.match(/^:\s*(\S+)/))) return normPath(m[1]);
  if ((m = info.match(/\b(?:path|file|filename|name|title)\s*=\s*["']?([^"'\s]+)/i))) return normPath(m[1]);
  if ((m = info.match(/^([\w.\-\/]+\.\w{1,8})$/))) return normPath(m[1]);
  return null;
}
function getFiles(src) {
  const map = new Map(); let m; FENCE.lastIndex = 0;
  while ((m = FENCE.exec(src))) { const p = fpath(m[1], m[2]); if (p) { map.delete(p); map.set(p, { path: p, code: m[3], closed: !!m[4], lang: m[1] }); } }
  return [...map.values()];
}
const entryOf = (files) => files.filter((f) => /\.html?$/i.test(f.path)).sort((a, b) => (/(^|\/)index\.html?$/i.test(b.path) - /(^|\/)index\.html?$/i.test(a.path)) || a.path.length - b.path.length)[0];
function inlineSite(files, entry) {
  const dir = entry.path.replace(/[^/]*$/, '');
  const get = (ref) => /^(https?:|data:|blob:|\/\/|#|mailto:)/i.test(ref) ? null : files.find((f) => f.path === normPath(dir + ref.split(/[?#]/)[0]));
  let h = entry.code;
  h = h.replace(/<link\b[^>]*>/gi, (tag) => { if (!/stylesheet/i.test(tag)) return tag; const f = get(tag.match(/href\s*=\s*["']([^"']+)/i)?.[1] || ''); return f ? `<style>\n${f.code.replace(/<\/style/gi, '<\\/style')}\n</style>` : tag; });
  h = h.replace(/<script\b([^>]*?)\ssrc\s*=\s*["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (tag, a, src, b) => { const f = get(src); return f ? `<script${a}${b}>\n${f.code.replace(/<\/script/gi, '<\\/script')}\n</script>` : tag; });
  h = h.replace(/(src|href)\s*=\s*["']([^"']+\.svg)["']/gi, (all, attr, ref) => { const f = get(ref); return f ? `${attr}="data:image/svg+xml;charset=utf-8,${encodeURIComponent(f.code)}"` : all; });
  return h;
}
function getArts(src) {
  const arts = []; let m; FENCE.lastIndex = 0;
  while ((m = FENCE.exec(src))) if (!fpath(m[1], m[2]) && isHtml(m[1], m[3])) arts.push({ code: m[3], closed: !!m[4], title: artTitle(m[3]) });
  const files = getFiles(src), en = entryOf(files);
  if (en) arts.push({ code: inlineSite(files, en), closed: files.every((f) => f.closed), title: artTitle(en.code), pack: true });
  return arts;
}
const fmtB = (n) => n < 1024 ? n + ' Б' : n < 1048576 ? (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' КБ' : (n / 1048576).toFixed(1) + ' МБ';
const plural = (n, a, b, c) => n % 10 === 1 && n % 100 !== 11 ? a : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? b : c;
function packCard(mid, src, k) {
  const files = getFiles(src), done = files.every((f) => f.closed), en = entryOf(files), name = packRoot(files, src).root;
  const size = files.reduce((n, f) => n + new Blob([f.code]).size, 0);
  return `<div class="pack${done ? '' : ' building'}"><div class="pack-h"><span class="art-ic"><svg><use href="#i-zip"/></svg></span><span class="art-t"><b>${esc(files.length === 1 ? files[0].path.split('/').pop() : name + '.zip')}</b><small>${done ? `${files.length} ${plural(files.length, 'файл', 'файла', 'файлов')} · ${fmtB(size)}` : `Собираю файлы… ${files.length}`}</small></span></div>
    <div class="pack-b">${files.length === 1 ? `<button class="btn pri" data-fdl="${mid}" data-fp="${esc(files[0].path)}"${done ? '' : ' disabled'}>Скачать файл</button>` : ''}<button class="btn${files.length === 1 ? '' : ' pri'}" data-zip="${mid}" data-fmt="zip"${done ? '' : ' disabled'}>Скачать ZIP</button><button class="btn" data-zip="${mid}" data-fmt="tgz"${done ? '' : ' disabled'}>TAR.GZ</button>${en ? `<button class="btn" data-art="${mid}:${k}">Превью</button>` : ''}</div></div>`;
}
function md(src, mid) {
  const out = []; let last = 0, m, k = 0, packAt = -1; FENCE.lastIndex = 0;
  while ((m = FENCE.exec(src))) {
    out.push(block(src.slice(last, m.index)));
    const lang = m[1], code = m[3], closed = !!m[4], fp = fpath(lang, m[2]);
    if (fp && mid) {
      if (packAt < 0) { packAt = out.length; out.push(''); }
      const n = code.replace(/\n$/, '').split('\n').length;
      out.push(`<details class="fileb"><summary><svg><use href="#i-file"/></svg><span class="fp">${esc(fp)}</span><small>${closed ? n + ' ' + plural(n, 'строка', 'строки', 'строк') : 'пишу…'}</small></summary><div class="pre"><div class="bar"><span>${esc(fp)}</span><span><button data-fdl="${mid}" data-fp="${esc(fp)}">Скачать</button><button data-copycode>Копировать</button></span></div><pre><code>${esc(code.replace(/\n$/, ''))}</code></pre></div></details>`);
    } else if (mid && isHtml(lang, code)) {
      const on = A.open && A.mid === mid && A.k === k;
      out.push(`<button class="art${closed ? '' : ' building'}${on ? ' cur' : ''}" data-art="${mid}:${k}"><span class="art-ic"><svg><use href="#i-globe"/></svg></span><span class="art-t"><b>${esc(artTitle(code))}</b><small>${closed ? 'Сайт · HTML' : 'Создаю сайт…'}</small></span><span class="art-go">${on ? 'Открыт' : 'Открыть'}</span></button>`);
      k++;
    } else out.push(`<div class="pre"><div class="bar"><span>${esc(lang || 'код')}</span><button data-copycode>Копировать</button></div><pre><code>${esc(code.replace(/\n$/, ''))}</code></pre></div>`);
    last = FENCE.lastIndex;
  }
  out.push(block(src.slice(last).replace(/`{1,3}[\w-]*$/, '')));
  if (packAt >= 0) out[packAt] = packCard(mid, src, k);
  return out.join('');
}

/* ---------- архивы: ZIP и TAR.GZ прямо в браузере ---------- */
function packRoot(files, src) {
  const firsts = new Set(files.map((f) => f.path.includes('/') ? f.path.split('/')[0] : ''));
  if (files.length && firsts.size === 1 && !firsts.has('')) return { root: [...firsts][0], prefix: '' };
  const en = entryOf(files), t = en ? artTitle(en.code) : '';
  const slug = (t && t !== 'Сайт' ? t : 'project').toLowerCase().replace(/[«»"'.,!?:;()]/g, '').trim().replace(/\s+/g, '-').replace(/[^\wа-яё-]/gi, '').slice(0, 40) || 'project';
  return { root: slug, prefix: slug + '/' };
}
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (d) => { let c = 0xffffffff; for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
async function squeeze(data, fmt) {
  try { return new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new CompressionStream(fmt))).arrayBuffer()); } catch { return null; }
}
async function makeZip(entries) {
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  const d = new Date(), time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const e of entries) {
    const name = enc.encode(e.name), data = enc.encode(e.code), crc = crc32(data);
    const def = await squeeze(data, 'deflate-raw'), useDef = def && def.length < data.length, body = useDef ? def : data;
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, useDef ? 8 : 0, true);
    h.setUint16(10, time, true); h.setUint16(12, date, true); h.setUint32(14, crc, true); h.setUint32(18, body.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, useDef ? 8 : 0, true);
    c.setUint16(12, time, true); c.setUint16(14, date, true); c.setUint32(16, crc, true); c.setUint32(20, body.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    parts.push(h, name, body); central.push(c, name); off += 30 + name.length + body.length;
  }
  const csize = central.reduce((n, x) => n + x.byteLength, 0), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true); end.setUint32(12, csize, true); end.setUint32(16, off, true);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}
async function makeTgz(entries) {
  const enc = new TextEncoder(), chunks = [];
  for (const e of entries) {
    const data = enc.encode(e.code), h = new Uint8Array(512); let name = enc.encode(e.name), prefix = new Uint8Array(0);
    if (name.length > 100) { const i = e.name.lastIndexOf('/', e.name.length - 1); prefix = enc.encode(e.name.slice(0, i)); name = enc.encode(e.name.slice(i + 1)); }
    const put = (str, at, len) => h.set(typeof str === 'string' ? enc.encode(str).slice(0, len) : str.slice(0, len), at);
    put(name, 0, 100); put('0000644\0', 100, 8); put('0000000\0', 108, 8); put('0000000\0', 116, 8);
    put(data.length.toString(8).padStart(11, '0') + '\0', 124, 12); put(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0', 136, 12);
    put('        ', 148, 8); put('0', 156, 1); put('ustar\0', 257, 6); put('00', 263, 2); put(prefix, 345, 155);
    put(h.reduce((a, b) => a + b, 0).toString(8).padStart(6, '0') + '\0 ', 148, 8);
    chunks.push(h, data, new Uint8Array((512 - (data.length % 512)) % 512));
  }
  chunks.push(new Uint8Array(1024));
  const gz = await squeeze(new Blob(chunks), 'gzip');
  return gz ? new Blob([gz], { type: 'application/gzip' }) : new Blob(chunks, { type: 'application/x-tar' });
}
function saveBlob(blob, name) { const u = URL.createObjectURL(blob), l = document.createElement('a'); l.href = u; l.download = name; document.body.appendChild(l); l.click(); l.remove(); setTimeout(() => URL.revokeObjectURL(u), 5000); }
async function downloadPack(mid, fmt) {
  const src = findMsg(mid)?.t || '', files = getFiles(src); if (!files.length) return;
  const { root, prefix } = packRoot(files, src), entries = files.map((f) => ({ name: prefix + f.path, code: f.code }));
  try { const blob = fmt === 'tgz' ? await makeTgz(entries) : await makeZip(entries); saveBlob(blob, root + (fmt === 'tgz' ? (blob.type === 'application/gzip' ? '.tar.gz' : '.tar') : '.zip')); }
  catch (e) { toast('Не удалось собрать архив: ' + e.message); }
}
const inline = (t) => esc(t).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
// таблицы Markdown: | a | b | + строка-разделитель |---|:---:|
const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
const isRow = (l) => /^\s*\|.*\|\s*$/.test(l || '');
const isSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l || '');
function table(rows) {
  const al = cells(rows[1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /-+:$/.test(c) ? 'right' : ''));
  const td = (tag, c, i) => `<${tag}${al[i] ? ` style="text-align:${al[i]}"` : ''}>${inline(c)}</${tag}>`;
  return `<div class="tbl"><table><thead><tr>${cells(rows[0]).map((c, i) => td('th', c, i)).join('')}</tr></thead><tbody>${rows.slice(2).map((r) => `<tr>${cells(r).map((c, i) => td('td', c, i)).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function block(t) {
  let h = '', list = null; const close = () => { if (list) { h += `</${list}>`; list = null; } };
  const lines = t.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]; let m;
    if (isRow(line) && isSep(lines[i + 1])) { close(); const rows = [line, lines[i + 1]]; i += 2; while (i < lines.length && isRow(lines[i])) rows.push(lines[i++]); i--; h += table(rows); continue; }
    if (!line.trim() || /^\s*([-*]|\d+[.)])\s*$/.test(line)) { close(); continue; }
    if ((m = line.match(/^#{1,4}\s+(.*)/))) { close(); h += `<h3>${inline(m[1])}</h3>`; }
    else if ((m = line.match(/^\s*[-*]\s+(.*)/))) { if (list !== 'ul') { close(); h += '<ul>'; list = 'ul'; } h += `<li>${inline(m[1])}</li>`; }
    else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== 'ol') { close(); h += '<ol>'; list = 'ol'; } h += `<li>${inline(m[1])}</li>`; }
    else { close(); h += `<p>${inline(line)}</p>`; }
  }
  close(); return h;
}

/* ---------- render ---------- */
function renderSide() {
  $('projects').innerHTML = S.projects.map((p) => `<button class="item ${S.proj === p.id ? 'on' : ''}" data-p="${p.id}"><svg><use href="#i-folder"/></svg><span>${esc(p.name)}</span><span class="gear" data-pset="${p.id}" role="button" aria-label="Настройки проекта" title="Настройки проекта"><svg><use href="#i-gear"/></svg></span></button>`).join('');
  const p = S.projects.find((x) => x.id === S.proj);
  $('chatsHead').textContent = p ? 'Чаты в «' + p.name + '»' : 'Недавние';
  const list = S.chats.filter((c) => (!S.proj || c.proj === S.proj) && (!filter || c.title.toLowerCase().includes(filter)));
  $('chats').innerHTML = list.map((c) => `<button class="item ${c.id === S.cur ? 'on' : ''}" data-c="${c.id}"><span>${esc(c.title)}</span><span class="x" data-del="${c.id}" role="button" aria-label="Удалить чат" title="Удалить" style="flex:none;display:grid"><svg style="width:13px;height:13px"><use href="#i-x"/></svg></span></button>`).join('') || `<div class="empty-s">${filter ? 'Ничего не найдено' : 'Здесь появятся ваши чаты'}</div>`;
  requestAnimationFrame(placeHL);
  $('side').classList.toggle('closed', !S.side && !mobile());
  $('openSide').hidden = S.side && !mobile();
}
function placeHL() {
  const hl = $('hl'), on = $('chats').querySelector('.item.on');
  if (!on) { hl.style.opacity = 0; return; }
  hl.style.transform = `translateY(${on.offsetTop}px)`; hl.style.height = on.offsetHeight + 'px'; hl.style.opacity = 1;
  if (hl.classList.contains('noanim')) requestAnimationFrame(() => hl.classList.remove('noanim'));
}
function renderTop() {
  const m = curModel();
  $('mname').textContent = m ? m.name : (MODELS.length ? 'Выберите модель' : 'Нет моделей');
  $('menu').innerHTML = MODELS.length
    ? MODELS.map((x) => `<button class="opt ${x.id === S.model ? 'on' : ''}${locked(x) ? ' locked' : ''}" data-m="${x.id}" role="menuitem"><div><b>${esc(x.name)}${locked(x) ? ` <span class="lockt">${esc(tierName(x))}</span>` : ''}</b>${x.weight && x.weight !== 1 ? `<small>1 запрос = ${x.weight} ${x.weight < 1 ? 'сообщения' : plural(x.weight, 'сообщение', 'сообщения', 'сообщений')} лимита</small>` : ''}</div><svg class="ck"><use href="#i-check"/></svg></button>`).join('')
    : `<div class="opt" style="cursor:default"><div><b>Модели не подключены</b><small>Разработчик может добавить их в Панели</small></div></div>`;
  const c = cur(), p = S.projects.find((x) => x.id === (c ? c.proj : S.proj));
  $('crumb').innerHTML = (p ? esc(p.name) + (c ? ' / ' : '') : '') + (c ? '<b>' + esc(c.title) + '</b>' : '');
  $('ptag').textContent = p && !c ? 'в проекте «' + p.name + '»' : '';
}
const SUGG = [
  ['i-edit', 'Составить план', 'Разложить задачу на шаги', 'Составь план запуска небольшого проекта'],
  ['i-globe', 'Создать сайт', 'С живым превью рядом', 'Сделай одностраничный сайт для кофейни: меню, фото, контакты'],
  ['i-code', 'Помочь с кодом', 'Написать или объяснить', 'Напиши функцию на JavaScript, которая убирает дубликаты из массива'],
  ['i-brain', 'Сформулировать идею', 'Коротко и понятно', 'Помоги сформулировать идею продукта в двух предложениях']];
function greet() {
  const h = new Date().getHours(), g = h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер';
  const n = ME.id !== 'guest' ? String(ME.name || '').trim().split(/\s+/)[0] : '';
  return esc(n ? g + ', ' + n : g);
}
function renderChat() {
  const c = cur(), col = $('col');
  const empty = !c || !c.msgs.length;
  document.querySelector('.main').classList.toggle('empty', empty);
  $('sugg').innerHTML = empty && MODELS.length ? `<div class="sugg">${SUGG.map(([ic, t, h, q]) => `<button data-s="${esc(q)}"><svg><use href="#${ic}"/></svg><span><b>${t}</b><small>${h}</small></span></button>`).join('')}</div>` : '';
  if (empty) {
    const p = S.projects.find((x) => x.id === S.proj);
    const sub = !MODELS.length ? 'Модели пока не подключены' : (p ? 'Новый чат в этом проекте' : 'Чем займёмся сегодня?');
    col.innerHTML = `<div class="hello"><h1>${p ? esc(p.name) : greet()}</h1><p class="hi-sub">${sub}</p>${p ? `<div class="pinfo">${p.instructions ? 'Инструкции: ' + esc(p.instructions.length > 140 ? p.instructions.slice(0, 140) + '…' : p.instructions) + ' ' : 'У проекта пока нет инструкций. '}<button data-pset="${p.id}">${p.instructions ? 'Изменить' : 'Добавить'}</button></div>` : ''}</div>`;
    return;
  }
  col.innerHTML = c.msgs.map((m, i) => {
    const cls = seen.has(m.id) ? '' : ' in'; seen.add(m.id);
    if (m.r === 'u') return `<div class="msg u-wrap${cls}" data-id="${m.id}">${uAtts(m)}${m.pick ? `<div class="u"><div class="upick"><svg><use href="#i-pick"/></svg>${esc(m.pick.name)}${m.pick.text ? ' — «' + esc(m.pick.text.slice(0, 40)) + '»' : ''}</div></div>` : ''}${m.t ? `<div class="u"><div class="bub">${esc(m.t)}</div></div>` : ''}<div class="acts u"><button class="ib" data-edit="${i}" aria-label="Изменить" title="Изменить"><svg><use href="#i-edit"/></svg></button><button class="ib" data-copy="${i}" aria-label="Копировать" title="Копировать"><svg><use href="#i-copy"/></svg></button></div></div>`;
    const body = m.err ? `<div class="errbox">${esc(m.err)}</div>` : md(stripLog(m.t), m.id) + (m.live && !m.thinking ? '<span class="cursor"></span>' : '');
    return `<div class="msg a${cls}" data-id="${m.id}"><div class="who"><div class="mark${m.thinking ? ' breathe' : ''}">P</div>Premier <i>· ${esc(m.m || '')}${m.thinking ? ' · думает…' : ''}</i></div>${thinkHtml(m)}${stepsHtml(m)}${fsHtml(m)}${agHtml(m)}${runsHtml(m)}<div class="md">${body}</div>${outsHtml(m)}${m.live ? '' : srcHtml(m)}${m.live ? '' : `<div class="acts">${m.err ? '' : `<button class="ib" data-copy="${i}" aria-label="Копировать" title="Копировать"><svg><use href="#i-copy"/></svg></button>`}<button class="ib" data-redo="${i}" aria-label="Сгенерировать заново" title="Сгенерировать заново"><svg><use href="#i-redo"/></svg></button>${(TTS || VOICES.length) && !m.err && m.t ? `<button class="ib${SPEAK === m.id ? ' on' + (SPEAK_LOAD ? ' load' : '') : ''}" data-speak="${m.id}" aria-label="${SPEAK === m.id ? 'Остановить' : 'Озвучить'}" title="${SPEAK === m.id ? 'Остановить' : 'Озвучить'}"><svg><use href="#i-speak"/></svg></button>` : ''}</div>`}</div>`;
  }).join('');
}
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
function stepsHtml(m) {
  if (!m.steps?.length) return '';
  return `<div class="steps">${m.steps.map((st, i) => {
    const on = m.live && m.stepOn && i === m.steps.length - 1;
    const [ic, label] = st.s === 'search' ? ['i-search', (on ? 'Ищу: ' : 'Искал: ') + '«' + st.q + '»'] : st.s === 'read' ? ['i-book', (on ? 'Читаю: ' : 'Прочитал: ') + host(st.q)]
      : st.s === 'view' ? ['i-globe', (on ? 'Смотрю: ' : 'Посмотрел: ') + host(st.q)]
      : st.s === 'check' ? ['i-globe', on ? 'Проверяю сайт в браузере…' : st.ok ? 'Проверил сайт в браузере — всё в порядке' : 'Проверил сайт в браузере']
      : st.s === 'fix' ? ['i-warn', on ? 'Нашёл недочёты — исправляю…' : 'Нашёл недочёты и исправил']
      : st.s === 'mem' ? ['i-brain', 'Запомнил: ' + st.q] : st.s === 'forget' ? ['i-brain', 'Забыл: ' + st.q]
      : st.s === 'code' ? ['i-code', on ? 'Выполняю код…' : 'Выполнил код']
      : st.s === 'image' ? ['i-image', (on ? 'Рисую: ' : 'Нарисовал: ') + '«' + st.q + '»']
      : st.s === 'video' ? ['i-video', (on ? 'Снимаю видео: ' : 'Сделал видео: ') + '«' + st.q + '»'] : ['i-warn', 'Не удалось: ' + st.q];
    return `<div class="step${on ? ' on' : ''}"><svg><use href="#${ic}"/></svg><span>${esc(label)}</span></div>`;
  }).join('')}</div>`;
}
const OPEN = new Set();
document.addEventListener('toggle', (e) => { const k = e.target.dataset?.key; if (k) e.target.open ? OPEN.add(k) : OPEN.delete(k); }, true);
function thinkHtml(m) {
  if (!m.think) return '';
  const on = m.live && !m.t, k = m.id + ':think';
  return `<details class="think${on ? ' on' : ''}" data-key="${k}"${on || OPEN.has(k) ? ' open' : ''}><summary><svg><use href="#i-brain"/></svg><span>${on ? 'Размышляю…' : 'Размышления' + (m.thinkMs ? ' · ' + Math.max(1, Math.round(m.thinkMs / 1000)) + ' с' : '')}</span></summary><div class="think-b">${esc(m.think.trim())}</div></details>`;
}
function runsHtml(m) {
  if (!m.runs?.length) return '';
  return `<div class="runs">${m.runs.map((r, i) => {
    const k = m.id + ':r' + i, ok = r.exit === 0 && !r.timeout;
    return `<details class="run" data-key="${k}"${OPEN.has(k) ? ' open' : ''}><summary><svg><use href="#i-code"/></svg><b>Python</b><span class="${ok ? '' : 'bad'}">${r.timeout ? 'остановлен по времени' : ok ? 'выполнен' : 'ошибка'} · ${(r.ms / 1000).toFixed(1)} с</span></summary><div class="pre"><div class="bar"><span>python</span><button data-copycode>Копировать</button></div><pre><code>${esc(r.code)}</code></pre>${r.out ? `<div class="outp">${esc(r.out)}</div>` : ''}${r.err ? `<div class="outp err">${esc(r.err)}</div>` : ''}</div></details>`;
  }).join('')}</div>`;
}
// строки-журналы, которые раньше дописывались в ответы; модели иногда пишут их сами, ничего не сделав — не показываем и не отправляем
const LOG_RE = /^[ \t]*\[(Действия на компьютере|Изменения в папке|Нарисованные картинки|Сделанные видео|Созданные файлы):[^\n]*\][ \t]*$/gm;
const stripLog = (t) => String(t || '').replace(LOG_RE, '').replace(/\n{3,}/g, '\n\n').trim();
// история для модели. Что реально выполнено инструментами, сообщаем заметкой в начале СЛЕДУЮЩЕГО сообщения пользователя,
// а не в тексте ответа ассистента — иначе модель копирует формат и «выполняет» действия на словах
function buildHistory(list) {
  const out = []; let log = [];
  for (const x of list) {
    if (x.r === 'u') {
      let c = apiContent(x);
      if (log.length) {
        const note = '(Журнал Premier — что на самом деле выполнили инструменты в прошлом ответе ассистента: ' + log.join('; ') + '. Ассистент такие заметки не пишет.)\n\n';
        c = typeof c === 'string' ? note + c : [{ type: 'text', text: note + (c.find((p) => p.type === 'text')?.text || '') }, ...c.filter((p) => p.type !== 'text')];
        log = [];
      }
      out.push({ role: 'user', content: c });
    } else {
      out.push({ role: 'assistant', content: stripLog(x.t) || '(ответ без текста)' });
      log = [
        ...(x.runs?.some((r) => r.files?.length) ? ['созданы файлы ' + x.runs.flatMap((r) => (r.files || []).map((f) => f.name)).join(', ')] : []),
        ...(x.gens?.length ? ['нарисованы картинки: ' + x.gens.map((g) => '«' + (g.prompt || '').slice(0, 200) + '»').join(', ')] : []),
        ...(x.vids?.length ? ['сделаны видео: ' + x.vids.map((g) => '«' + (g.prompt || '').slice(0, 200) + '»').join(', ')] : []),
        fsSummary(x), agSummary(x)].filter(Boolean);
      if ((x.agops?.length || x.fsops?.length) && !log.some((l) => /компьютер|папк/.test(l))) log.push('действий на компьютере и в папке не было');
      else if (!x.agops?.length && !x.fsops?.length && /(удал|созда|переимен|перемест|запуст|выполн)\S*/i.test(x.t || '') && (typeof AG !== 'undefined' && AG.conn)) log.push('инструменты компьютера в этом ответе НЕ вызывались — значит, ничего на компьютере не изменилось');
    }
  }
  return out;
}
function gensHtml(m) {
  const kind = m.live && m.stepOn ? m.steps?.at(-1)?.s : '', wait = kind === 'image' || kind === 'video';
  const n = (m.gens?.length || 0) + (m.vids?.length || 0) + (wait ? 1 : 0);
  if (!n) return '';
  const dl = '<svg><use href="#i-dl"/></svg>';
  return `<div class="gens${n > 1 ? ' multi' : ''}">${(m.gens || []).map((g, i) => `<figure class="gen"><img src="${esc(g.url)}" alt="${esc(g.prompt || 'Картинка')}" title="${esc(g.prompt || '')}" data-zoom loading="lazy"><a class="gen-dl" href="${esc(g.url)}?dl=1" download="premier-${i + 1}.${esc(g.name.split('.').pop())}" aria-label="Скачать" title="Скачать">${dl}</a></figure>`).join('')}${(m.vids || []).map((v, i) => `<figure class="gen vid"><video src="${esc(v.url)}" controls playsinline loop preload="metadata" title="${esc(v.prompt || '')}"></video><a class="gen-dl" href="${esc(v.url)}?dl=1" download="premier-video-${i + 1}.${esc(v.name.split('.').pop())}" aria-label="Скачать" title="Скачать">${dl}</a></figure>`).join('')}${wait ? drawHtml(m, kind) : ''}</div>`;
}
// «модель рисует»: живая анимация, пока картинка/видео готовится
function drawHtml(m, kind) {
  const v = kind === 'video', p = v && Number.isFinite(m.vprog) ? m.vprog : null;
  m.drawAt ||= Date.now(); const sec = Math.round((Date.now() - m.drawAt) / 1000), t = sec >= 60 ? Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0') : sec + ' с';
  return `<figure class="gen draw${v ? ' v' : ''}"><div class="dblobs"><i></i><i></i><i></i><i></i></div><div class="dgrain"></div>
    <div class="dpen"><svg><use href="#i-${v ? 'video' : 'edit'}"/></svg></div>
    <figcaption><b>${v ? 'Снимаю видео' : 'Рисую картинку'}</b><span data-dtime>${p != null ? p + '% · ' : ''}${t}</span>${v ? `<em class="dbar"><i style="width:${p ?? 3}%"></i></em><small>Видео делается 1–5 минут — не закрывайте вкладку</small>` : ''}</figcaption></figure>`;
}
setInterval(() => { // тикаем таймер в карточке рисования без полной перерисовки чата
  if (!LIVE?.drawAt) return; const el = document.querySelector('.gen.draw [data-dtime]'); if (!el) return;
  const sec = Math.round((Date.now() - LIVE.drawAt) / 1000), t = sec >= 60 ? Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0') : sec + ' с';
  el.textContent = (Number.isFinite(LIVE.vprog) ? LIVE.vprog + '% · ' : '') + t;
}, 1000);
function outsHtml(m) {
  const list = (m.runs || []).flatMap((r) => r.files || []); if (!list.length) return gensHtml(m);
  return `<div class="outs">${list.map((f) => f.image
    ? `<div class="imgw"><img src="${esc(f.url)}" alt="${esc(f.name)}" data-zoom loading="lazy"><a href="${esc(f.url)}?dl=1" download="${esc(f.name)}">${esc(f.name)} · скачать</a></div>`
    : `<a class="ofile" href="${esc(f.url)}?dl=1" download="${esc(f.name)}"><span class="art-ic"><svg><use href="#i-file"/></svg></span><span style="min-width:0"><b>${esc(f.name)}</b><small>${fmtB(f.size)} · скачать</small></span></a>`).join('')}</div>` + gensHtml(m);
}
function srcHtml(m) {
  if (!m.sources?.length) return '';
  return `<div class="srcs">${m.sources.map((x, i) => `<a class="src" href="${esc(x.url)}" target="_blank" rel="noopener" title="${esc(x.title)}"><b>${i + 1}</b><span>${esc(host(x.url))}</span></a>`).join('')}</div>`;
}
function renderSend() {
  $('webBtn').hidden = !CFG.search; $('webBtn').classList.toggle('on', !!S.web); $('webBtn').setAttribute('aria-pressed', String(!!S.web));
  const b = $('send'); const st = !!(busy && busyChat === S.cur);
  b.classList.toggle('stop', st);
  b.disabled = !st && ((!$('q').value.trim() && !PEND.length) || !MODELS.length);
  b.setAttribute('aria-label', st ? 'Остановить' : 'Отправить');
}
function render() { renderSide(); renderTop(); renderChat(); renderSend(); }
const toBottom = () => { const c = $('chat'); c.scrollTop = c.scrollHeight; };

/* ---------- models ---------- */
async function loadModels() {
  try { MODELS = await (await fetch('/api/models')).json(); } catch { MODELS = []; }
  try { CFG = await (await fetch('/api/config')).json(); } catch { CFG = { search: false }; }
  pickModel();
  save(); render();
}

/* ---------- chat ---------- */
async function stream(c, msg) {
  const model = curModel();
  if (!model) { msg.err = 'Модель не выбрана.'; save(); render(); return; }
  msg.m = model.name; msg.live = true; msg.thinking = true; msg.t = ''; delete msg.err; delete msg.steps; delete msg.sources; delete msg.think; delete msg.thinkMs; delete msg.runs; delete msg.gens; delete msg.vids; delete msg.vprog; delete msg.drawAt; delete msg.fsops; delete msg.agops; msg.stepOn = false; LIVE = msg;
  const history = buildHistory(c.msgs.filter((x) => x !== msg && !x.err && (x.t || x.files?.length || x.images?.length || x.agops?.length || x.fsops?.length)));
  const proj = S.projects.find((p) => p.id === c.proj);
  const ac = new AbortController(); busy = ac; busyChat = c.id;
  render(); toBottom();
  const folderInfo = await fsInfo();
  try {
    const r = await fetch('/api/chat', { method: 'POST', signal: ac.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: model.id, messages: history, instructions: proj?.instructions || '', web: !!(S.web && CFG.search), ...(folderInfo ? { folder: folderInfo } : {}), ...(agUsable() ? { agent: true, agentAuto: AG.auto } : {}) }) });
    if (r.status === 401) return toLogin();
    if (!r.ok) { const j = await r.json().catch(() => ({})); if (j.code === 'limit' || j.code === 'model') { setTimeout(() => openPlans(j.error), 300); loadBill(); } throw new Error(j.error || 'Ошибка сервера ' + r.status); }
    const reader = r.body.getReader(), dec = new TextDecoder();
    let first = true, pending = false;
    const paint = () => {
      pending = false;
      if (!msg.live) return; // ответ уже закончился — финальная отрисовка сделана, курсор не возвращаем
      const el = document.querySelector(`[data-id="${msg.id}"] .md`);
      if (!el) return;
      const ch = $('chat'), near = ch.scrollHeight - ch.scrollTop - ch.clientHeight < 80;
      el.innerHTML = md(msg.t, msg.id) + (msg.t ? '<span class="cursor"></span>' : '');
      const tb = document.querySelector(`[data-id="${msg.id}"] .think-b`);
      if (msg.think && !tb) renderChat(); else if (tb && tb.textContent !== msg.think.trim()) { const atEnd = tb.scrollHeight - tb.scrollTop - tb.clientHeight < 30; tb.textContent = msg.think.trim(); if (atEnd) tb.scrollTop = tb.scrollHeight; }
      followArt(msg);
      if (near) toBottom();
    };
    let buf = '', raw = '', srvThink = '', inThink = '', thinkAt = 0;
    const setThink = () => { const t = srvThink + (inThink ? (srvThink ? '\n' : '') + inThink : ''); if (t) { msg.think = t; thinkAt ||= Date.now(); } };
    const ndjson = (r.headers.get('content-type') || '').includes('ndjson');
    const handle = (o) => {
      if (o.t) {
        raw += o.t;
        const tm = raw.match(/^\s*<think>([\s\S]*?)(<\/think>\s*|$)/);
        if (tm) { inThink = tm[1]; msg.t = tm[2] ? raw.slice(tm[0].length) : ''; setThink(); }
        else msg.t = raw.trim() && '<think>'.startsWith(raw.trimStart()) ? '' : raw;
        if (msg.t && msg.think && !msg.thinkMs) { msg.thinkMs = Date.now() - thinkAt; renderChat(); }
        if ((first && msg.t) || (msg.stepOn && msg.t)) { first = false; msg.thinking = false; msg.stepOn = false; renderChat(); }
        if (!pending) { pending = true; requestAnimationFrame(paint); }
      } else if (o.r) {
        srvThink += o.r; setThink(); msg.thinking = false;
        if (!pending) { pending = true; requestAnimationFrame(paint); }
      } else if (o.fs) {
        fsHandle(o.fs, msg);
      } else if (o.ag) { agHandle(o.ag, msg);
      } else if (o.agres) { agResult(o.agres, msg);
      } else if (o.img) {
        (msg.gens ||= []).push(o.img); msg.stepOn = false; delete msg.drawAt; renderChat(); toBottom();
      } else if (o.vid) {
        (msg.vids ||= []).push(o.vid); msg.stepOn = false; delete msg.drawAt; delete msg.vprog; renderChat(); toBottom();
      } else if (o.vp != null) {
        msg.vprog = o.vp; const b = document.querySelector('.gen.draw .dbar i'); if (b) b.style.width = Math.max(3, o.vp) + '%';
      } else if (o.run) {
        (msg.runs ||= []).push(o.run); msg.stepOn = false; renderChat(); toBottom();
      } else if (o.s === 'ok') { const ch = (msg.steps || []).filter((x) => x.s === 'check').pop(); if (ch) ch.ok = true; msg.stepOn = false; renderChat(); } else if (o.s) { (msg.steps ||= []).push({ s: o.s, q: o.q }); msg.stepOn = o.s !== 'fail'; renderChat(); toBottom(); }
      else if (o.src) msg.sources = o.src;
      else if (o.bill) { BILL = o.bill; renderPlan(); }
      else if (o.e) throw new Error(o.e);
    };
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      const chunk = dec.decode(value, { stream: true });
      if (!ndjson) { handle({ t: chunk }); continue; }
      buf += chunk;
      const lines = buf.split('\n'); buf = lines.pop();
      for (const line of lines) { if (!line.trim()) continue; let o; try { o = JSON.parse(line); } catch { continue; } handle(o); }
    }
    if (!msg.t && !msg.gens?.length && !msg.vids?.length && !msg.fsops?.some((o) => o.op) && !msg.agops?.some((o) => o.write)) msg.err = 'Модель вернула пустой ответ.';
  } catch (e) {
    if (e.name === 'AbortError') { if (!msg.t) msg.t = 'Генерация остановлена.'; }
    else msg.err = e.message || 'Не удалось получить ответ.';
  }
  fsCancel(msg); busy = null; busyChat = null; LIVE = null; msg.live = false; msg.thinking = false; msg.stepOn = false;
  if (msg.think && !msg.thinkMs && thinkAt) msg.thinkMs = Date.now() - thinkAt;
  if (A.follow && A.mid === msg.id) { A.follow = false; const a = getArts(msg.t)[A.k]; if (a) showArt(msg.id, A.k, 'preview'); }
  save(); render();
}
function stop() { if (busy) busy.abort(); }
function send(t) {
  t = t.trim();
  const files = PEND.filter((x) => x.kind === 'file' && x.text != null), images = PEND.filter((x) => x.kind === 'img' && x.url);
  if ((!t && !files.length && !images.length) || !MODELS.length) return;
  if (busy) { toast('Модель ещё отвечает — дождитесь завершения'); return; }
  if (PEND.some((x) => x.loading)) { toast('Подождите, файлы ещё читаются'); return; }
  if (images.length && !curModel()?.vision) { toast('Эта модель не понимает картинки — выберите другую'); return; }
  const cm = curModel();
  if (cm && locked(cm)) { openPlans(`Модель «${cm.name}» доступна на тарифе ${tierName(cm)}. Выберите другую модель или улучшите тариф.`); return; }
  if (BILL && BILL.limits.m != null && BILL.used.m + (cm?.weight || 1) > BILL.limits.m) { openPlans(BILL.unlimited ? 'Достигнут дневной предел. Он обновится в полночь по Москве.' : `Сообщения на сегодня закончились (${BILL.plan.name}: ${BILL.limits.m} в день). Лимит обновится в полночь по Москве — или улучшите тариф прямо сейчас.`); return; }
  let c = cur();
  const title = t || files[0]?.name || 'Картинка';
  if (!c) { c = { id: uid(), title: title.length > 42 ? title.slice(0, 42) + '…' : title, proj: S.proj, msgs: [] }; S.chats.unshift(c); S.cur = c.id; }
  const um = { id: uid(), r: 'u', t };
  if (files.length) um.files = files.map((f) => ({ name: f.name, size: f.size, text: f.text }));
  if (images.length) um.images = images.map((x) => x.url);
  if (PICK) { um.pick = PICK; PICK = null; renderPick(); }
  if (rec) rec.stop();
  c.msgs.push(um); PEND = []; renderAtts();
  const a = { id: uid(), r: 'a', t: '' }; c.msgs.push(a);
  $('q').value = ''; grow(); save(); stream(c, a);
}
function grow() {
  const q = $('q'), m = $('mirror'); m.style.width = q.clientWidth + 'px'; m.style.font = getComputedStyle(q).font; m.textContent = q.value + ' ';
  const h = Math.max(26, Math.min(200, m.scrollHeight)); q.style.height = h + 'px'; q.style.overflowY = m.scrollHeight > 200 ? 'auto' : 'hidden';
}
function switchTo(fn) {
  const col = $('col'); closeArt(); col.classList.add('fade'); fn(); renderSide(); renderTop();
  setTimeout(() => { markSeen(); renderChat(); renderSend(); toBottom(); col.classList.remove('fade'); }, 150);
}
function closeMobile() { $('side').classList.remove('mopen'); $('overlay').classList.remove('on'); }
function flash(b) { b.innerHTML = '<svg class="pop"><use href="#i-check"/></svg>'; setTimeout(() => (b.innerHTML = '<svg class="pop"><use href="#i-copy"/></svg>'), 1200); }


/* ---------- artifact pane ---------- */
function findMsg(mid) { for (const c of S.chats) { const m = c.msgs.find((x) => x.id === mid); if (m) return m; } }
function curArt() { const m = A.mid && findMsg(A.mid); return m ? getArts(m.t)[A.k] : null; }
function paneUI() {
  const a = curArt(); if (!a) return;
  $('ptitle').textContent = a.title;
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === A.tab));
  const prev = A.tab === 'preview';
  $('pFrame').classList.toggle('hide', !prev || !a.closed);
  $('pWait').classList.toggle('hide', !prev || a.closed);
  $('pCode').classList.toggle('hide', prev);
  if (!prev && $('pCode').textContent !== a.code) { const pc = $('pCode'), atEnd = pc.scrollHeight - pc.scrollTop - pc.clientHeight < 40; pc.textContent = a.code; if (A.follow && atEnd) pc.scrollTop = pc.scrollHeight; }
  if (prev && a.closed && A.shown !== a.code) { A.shown = a.code; const f = $('pFrame'), n = f.cloneNode(false); n.removeAttribute('srcdoc'); n.srcdoc = withPick(a.code); n.classList.remove('hide'); f.replaceWith(n); if (picking) setPicking(false); }
}
function showArt(mid, k, tab) {
  const changed = A.mid !== mid || A.k !== k;
  Object.assign(A, { open: true, mid, k, tab: tab || A.tab }); if (changed) A.shown = '';
  $('pane').classList.add('on'); paneUI(); renderPub();
  document.querySelectorAll('.art').forEach((b) => { const on = b.dataset.art === mid + ':' + k; b.classList.toggle('cur', on); b.querySelector('.art-go').textContent = on ? 'Открыт' : 'Открыть'; });
}
function closeArt() { A.open = false; A.follow = false; A.mid = null; A.shown = ''; $('pane').classList.remove('on'); $('pFrame').srcdoc = ''; document.querySelectorAll('.art.cur').forEach((b) => { b.classList.remove('cur'); b.querySelector('.art-go').textContent = 'Открыть'; }); }
function followArt(msg) {
  const arts = getArts(msg.t); if (!arts.length) return;
  const k = arts.length - 1, a = arts[k];
  if (a.pack) { if (a.closed && A.follow && A.mid === msg.id) { A.follow = false; showArt(msg.id, k, 'preview'); } return; }
  if (!a.closed) { if (!(A.open && A.mid === msg.id && A.k === k)) { A.follow = true; showArt(msg.id, k, 'code'); } else paneUI(); }
  else if (A.follow && A.mid === msg.id && A.k === k) { A.follow = false; showArt(msg.id, k, 'preview'); }
}
function artBlobUrl() { const a = curArt(); return a ? URL.createObjectURL(new Blob([a.code], { type: 'text/html' })) : null; }

/* ---------- developer panel ---------- */
const dlgW = (w) => { const d = $('modal').querySelector('.dlg'); d.classList.toggle('wide', !!w); d.classList.remove('accdlg'); };
function closePanel() { $('modal').classList.remove('on'); }


/* ---------- attachments ---------- */
let PEND = [];
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|html?|css|js|mjs|ts|tsx|jsx|py|rb|go|rs|java|kt|c|h|cpp|hpp|cs|php|sh|bat|ps1|sql|yaml|yml|toml|ini|cfg|log|env|vue|svelte|swift|dart|r|lua|tex|srt|vtt)$/i;
const MAX_TEXT = 100000, MAX_FILE = 200 * 1024 * 1024;
const fmtSize = (n) => n < 1024 ? n + ' Б' : n < 1048576 ? Math.round(n / 1024) + ' КБ' : (n / 1048576).toFixed(1) + ' МБ';
function toast(t) { const el = $('toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), 2600); }
function renderAtts() {
  const el = $('atts'); el.hidden = !PEND.length;
  el.innerHTML = PEND.map((x) => x.kind === 'img'
    ? `<div class="att img${x.loading ? ' loading' : ''}">${x.url ? `<img src="${x.url}" alt="">` : ''}<button type="button" class="rm" data-rmatt="${x.id}" aria-label="Убрать"><svg style="width:12px;height:12px"><use href="#i-x"/></svg></button></div>`
    : `<div class="att${x.loading ? ' loading' : ''}"><span class="ai"><svg><use href="#i-file"/></svg></span><span style="min-width:0"><span class="nm">${esc(x.name)}</span><small>${x.loading ? 'читаю…' : fmtSize(x.size)}</small></span><button type="button" class="rm" data-rmatt="${x.id}" aria-label="Убрать"><svg style="width:12px;height:12px"><use href="#i-x"/></svg></button></div>`).join('');
}
function uAtts(m) {
  if (!m.files?.length && !m.images?.length) return '';
  return `<div class="uatt">${(m.images || []).map((u) => `<img src="${u}" alt="Картинка" data-zoom>`).join('')}${(m.files || []).map((f) => `<div class="att"><span class="ai"><svg><use href="#i-file"/></svg></span><span style="min-width:0"><span class="nm">${esc(f.name)}</span><small>${fmtSize(f.size)}</small></span></div>`).join('')}</div>`;
}
function apiContent(m) {
  let text = (m.files || []).map((f) => `[Файл: ${f.name}]\n${f.text}\n[Конец файла]`).join('\n\n');
  if (m.t) text = text ? text + '\n\n' + m.t : m.t;
  if (m.pick) text = `[Пользователь выбрал элемент на сайте «${m.pick.title}»]\nСелектор: ${m.pick.sel}\nHTML элемента:\n\`\`\`html\n${m.pick.html}\n\`\`\`\nИзмени именно этот элемент по просьбе ниже (остальное оставь как есть) и пришли сайт целиком тем же способом, что и раньше.\n\n` + text;
  if (!text && m.images?.length) text = 'Что на картинке?';
  if (!m.images?.length) return text;
  return [{ type: 'text', text }, ...m.images.map((url) => ({ type: 'image_url', image_url: { url } }))];
}
function addFiles(list) {
  for (const f of list) {
    if (f.size > MAX_FILE) { toast(`«${f.name}» больше 200 МБ`); continue; }
    const item = { id: uid(), name: f.name, size: f.size, loading: true, kind: f.type.startsWith('image/') ? 'img' : 'file' };
    PEND.push(item);
    (item.kind === 'img' ? readImage(f).then((u) => (item.url = u)) : readText(f).then((t) => { item.text = t.length > MAX_TEXT ? t.slice(0, MAX_TEXT) + '\n…[обрезано]' : t; }))
      .catch((e) => { PEND = PEND.filter((x) => x !== item); toast(`«${f.name}»: ${e.message}`); })
      .finally(() => { item.loading = false; renderAtts(); renderSend(); });
  }
  renderAtts(); renderSend();
}
function readImage(f) {
  return new Promise((ok, fail) => {
    const img = new Image(), u = URL.createObjectURL(f);
    img.onload = () => {
      const max = 1280, k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(u); ok(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(u); fail(new Error('не удалось открыть картинку')); };
    img.src = u;
  });
}
async function readText(f) {
  const n = f.name.toLowerCase();
  if (n.endsWith('.pdf')) return readPdf(f);
  if (n.endsWith('.zip')) return readZip(f);
  if (/\.(docx|xlsx|pptx)$/.test(n)) return readOffice(f, n.slice(-4));
  if (TEXT_EXT.test(n) || f.type.startsWith('text/') || /json|xml|javascript/.test(f.type)) return f.text();
  throw new Error('такой формат пока не поддерживается');
}
// --- PDF через pdf.js (грузится с CDN при первом использовании) ---
let pdfjsP = null;
async function readPdf(f) {
  pdfjsP ||= import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.min.mjs').then((m) => { m.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs'; return m; });
  let pdfjs; try { pdfjs = await pdfjsP; } catch { pdfjsP = null; throw new Error('не удалось загрузить модуль PDF'); }
  const doc = await pdfjs.getDocument({ data: await f.arrayBuffer() }).promise;
  const out = [];
  for (let i = 1; i <= Math.min(doc.numPages, 200); i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    out.push(tc.items.map((x) => x.str + (x.hasEOL ? '\n' : '')).join(''));
    if (out.join('').length > MAX_TEXT) break;
  }
  const t = out.join('\n\n').trim();
  if (!t) throw new Error('в PDF нет текста (возможно, это скан)');
  return t;
}
// --- DOCX / XLSX / PPTX: мини-распаковщик zip без библиотек ---
async function unzip(buf) {
  const v = new DataView(buf), files = {}; let e = buf.byteLength - 22;
  while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('файл повреждён');
  let p = v.getUint32(e + 16, true); const cnt = v.getUint16(e + 10, true), dec = new TextDecoder();
  for (let i = 0; i < cnt; i++) {
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true), nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), off = v.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(buf, p + 46, nl));
    files[name] = { method, size, off }; p += 46 + nl + xl + cl;
  }
  const get = async (name) => {
    const f = files[name]; if (!f) return null;
    const ln = v.getUint16(f.off + 26, true), lx = v.getUint16(f.off + 28, true);
    const data = new Uint8Array(buf, f.off + 30 + ln + lx, f.size);
    if (f.method === 0) return dec.decode(data);
    const ds = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return await new Response(ds).text();
  };
  get.names = Object.keys(files); return get;
}
// --- ZIP: text files (skip node_modules/.git/binary) ---
async function readZip(f) {
  const get = await unzip(await f.arrayBuffer());
  const names = (get.names || []).filter((k) => !k.endsWith('/') && !/node_modules|\.git\//.test(k));
  const parts = []; let total = 0, skipped = 0;
  for (const k of names.slice(0, 500)) {
    if (total > MAX_TEXT - 2000) break;
    let t; try { t = await get(k); } catch { skipped++; continue; }
    if (t == null) continue;
    if (/[-]/.test(t.slice(0, 4000))) { skipped++; continue; }
    parts.push('File: ' + k + '\n```\n' + t + '\n```'); total += t.length;
  }
  if (!parts.length) throw new Error('no text files found in zip');
  return parts.join('\n\n') + (skipped ? '\n(' + skipped + ' binary files skipped)' : '');
}

async function readOffice(f, ext) {
  const get = await unzip(await f.arrayBuffer());
  if (ext === 'docx') {
    const x = await get('word/document.xml'); if (!x) throw new Error('не похоже на документ Word');
    return x.split(/<\/w:p>/).map((par) => xmlText(par.replace(/<w:tab\/>/g, '\t').replace(/<w:br\/>/g, '\n'))).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  if (ext === 'pptx') {
    const out = [];
    for (let i = 1; i <= 300; i++) { const x = await get(`ppt/slides/slide${i}.xml`); if (!x) break; out.push(`--- Слайд ${i} ---\n` + x.split(/<\/a:p>/).map(xmlText).filter((s) => s.trim()).join('\n')); }
    if (!out.length) throw new Error('в презентации нет слайдов'); return out.join('\n\n');
  }
  const ss = await get('xl/sharedStrings.xml');
  const strings = ss ? [...ss.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => xmlText(m[1])) : [];
  const wb = (await get('xl/workbook.xml')) || '', names = [...wb.matchAll(/<sheet [^>]*name="([^"]*)"/g)].map((m) => xmlText(m[1]));
  const out = [];
  for (let i = 1; i <= 50; i++) {
    const x = await get(`xl/worksheets/sheet${i}.xml`); if (!x) break;
    const rows = [...x.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((r) => [...r[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map((c) => {
      const t = (c[1].match(/t="(\w+)"/) || [])[1], val = ((c[2] || '').match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      if (t === 's') return strings[+val] ?? ''; if (t === 'inlineStr') return xmlText(c[2] || ''); return val != null ? xmlText(val) : '';
    }).join('\t'));
    out.push(`--- Лист: ${names[i - 1] || i} ---\n` + rows.join('\n'));
  }
  if (!out.length) throw new Error('в таблице нет листов'); return out.join('\n\n');
}
$('fileIn').onchange = (e) => { addFiles([...e.target.files]); e.target.value = ''; };
const box = $('form');
['dragenter', 'dragover'].forEach((ev) => box.addEventListener(ev, (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); box.classList.add('drag'); } }));
['dragleave', 'drop'].forEach((ev) => box.addEventListener(ev, () => box.classList.remove('drag')));
box.addEventListener('drop', (e) => { if (e.dataTransfer?.files?.length) { e.preventDefault(); addFiles([...e.dataTransfer.files]); } });
$('q').addEventListener('paste', (e) => { const fs = [...(e.clipboardData?.files || [])]; if (fs.length) { e.preventDefault(); addFiles(fs); } });

/* ---------- project settings ---------- */
function projectModal(pid) {
  dlgW(false);
  const p = pid ? S.projects.find((x) => x.id === pid) : null;
  $('dtitle').textContent = p ? 'Настройки проекта' : 'Новый проект';
  $('dbody').innerHTML = `<form id="projF">
    <label class="field"><span>Название</span><input name="name" required maxlength="60" value="${esc(p?.name || '')}" placeholder="Например, Маркетинг"></label>
    <label class="field"><span>Инструкции для модели</span><textarea name="instructions" maxlength="6000" placeholder="Например: ты маркетолог в кофейне «Утро». Отвечай кратко, по-дружески, предлагай идеи для соцсетей.">${esc(p?.instructions || '')}</textarea><small>Модель будет учитывать их во всех чатах этого проекта.</small></label>
    <div class="btns">${p ? '<button type="button" class="btn danger" id="projDel">Удалить проект</button><div class="sp"></div>' : ''}<button type="button" class="btn" id="projCancel">Отмена</button><button class="btn pri">${p ? 'Сохранить' : 'Создать'}</button></div></form>`;
  $('modal').classList.add('on'); setTimeout(() => $('projF').querySelector('[name=name]').focus(), 50);
  $('projCancel').onclick = closePanel;
  if (p) $('projDel').onclick = () => {
    if (!confirm(`Удалить проект «${p.name}»? Чаты останутся в «Недавних».`)) return;
    S.projects = S.projects.filter((x) => x !== p); S.chats.forEach((c) => { if (c.proj === p.id) c.proj = null; });
    if (S.proj === p.id) S.proj = null; save(); closePanel(); render();
  };
  $('projF').onsubmit = (e) => {
    e.preventDefault(); const f = new FormData(e.target), name = f.get('name').trim(), instructions = f.get('instructions').trim();
    if (!name) return;
    if (p) Object.assign(p, { name, instructions }); else { const np = { id: uid(), name, instructions }; S.projects.push(np); S.proj = np.id; S.cur = null; }
    save(); closePanel(); render(); toast(p ? 'Проект сохранён' : 'Проект создан');
  };
}

/* ---------- publish ---------- */
function pubOf() { const m = A.mid && findMsg(A.mid); return m?.pubs?.[A.k] || null; }
function renderPub() {
  const pb = $('pubbar'), pub = pubOf(), a = curArt();
  $('pPub').hidden = !a || !a.closed;
  if (!pub) { pb.hidden = true; return; }
  const url = location.origin + pub.path;
  pb.hidden = false;
  pb.innerHTML = `<span>Опубликовано:</span><a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a><button data-pubcopy="${esc(url)}">Копировать</button><button data-unpub>Снять</button>`;
}
async function publishArt() {
  const a = curArt(), m = A.mid && findMsg(A.mid); if (!a || !a.closed || !m) return;
  if (m.pubs?.[A.k]) { renderPub(); return; }
  try {
    const r = await fetch('/api/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ html: a.code, title: a.title }) });
    if (r.status === 401) return toLogin();
    const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Ошибка ' + r.status);
    (m.pubs ||= {})[A.k] = { id: j.id, path: j.path, key: j.key }; save(); renderPub();
    navigator.clipboard?.writeText(location.origin + j.path).catch(() => {}); toast('Сайт опубликован, ссылка скопирована');
  } catch (e) { toast(e.message); }
}
async function unpublishArt() {
  const m = A.mid && findMsg(A.mid), pub = pubOf(); if (!pub) return;
  if (!confirm('Снять сайт с публикации? Ссылка перестанет работать.')) return;
  try { await fetch('/api/publish/' + pub.id, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: pub.key }) }); } catch {}
  delete m.pubs[A.k]; save(); renderPub(); toast('Публикация снята');
}

/* ---------- events ---------- */
document.addEventListener('click', (e) => {
  const t = e.target;
  if (!t.closest('.model')) $('menu').classList.remove('open');
  const del = t.closest('[data-del]');
  if (del) { e.stopPropagation(); if (confirm('Удалить этот чат?')) { S.chats = S.chats.filter((c) => c.id !== del.dataset.del); S.del.push(del.dataset.del); if (S.cur === del.dataset.del) { if (busyChat === del.dataset.del) stop(); closeArt(); S.cur = null; } save(); render(); } return; }
  const ps = t.closest('[data-pset]');
  if (ps) { e.stopPropagation(); projectModal(ps.dataset.pset); return; }
  const zi = t.closest('[data-zoom]');
  if (zi) { const w = window.open(); if (w) w.document.write('<body style="margin:0;background:#111;display:grid;place-items:center;min-height:100vh"><img src="' + zi.src + '" style="max-width:100%;max-height:100vh">'); return; }
  const b = t.closest('button'); if (!b) return;
  const d = b.dataset;
  if (d.zip) { downloadPack(d.zip, d.fmt); return; }
  if (d.speak) { speak(d.speak); return; }
  if (d.unpick !== undefined) { PICK = null; renderPick(); return; }
  if (d.delmem) { memApi('/api/memory/' + d.delmem, { method: 'DELETE' }).then(renderMem); return; }
  if (b.id === 'pPick') { setPicking(!picking); return; }
  if (b.id === 'micBtn') { toggleMic(); return; }
  if (b.id === 'meBtn') { openAccount(); return; }
  if (d.acc) { accTab(d.acc); return; }
  if (b.id === 'pcUp' || b.id === 'accPlans') { openPlans(); return; }
  if (d.buy) { buyPlan(d.buy, b); return; }
  if (b.id === 'memClear') { if (confirm('Стереть всё, что модель о вас запомнила?')) memApi('/api/memory', { method: 'DELETE' }).then(renderMem); return; }
  if (d.fdl) { e.preventDefault(); const f = getFiles(findMsg(d.fdl)?.t || '').find((x) => x.path === d.fp); if (f) saveBlob(new Blob([f.code], { type: 'text/plain;charset=utf-8' }), f.path.split('/').pop()); return; }
  if (d.rmatt) { PEND = PEND.filter((x) => x.id !== d.rmatt); renderAtts(); renderSend(); return; }
  if (b.id === 'attachBtn') { $('fileIn').click(); return; }
  if (b.id === 'fsBtn') { fsMenu(); return; }
  if (b.id === 'agBtn') { agMenu(); return; }
  if (b.id === 'webBtn') { S.web = !S.web; save(); renderSend(); toast(S.web ? 'Интернет включён — модель сможет искать' : 'Интернет выключен'); return; }
  if (b.id === 'pPub') { publishArt(); return; }
  if (d.pubcopy !== undefined) { navigator.clipboard?.writeText(d.pubcopy); b.textContent = 'Скопировано'; setTimeout(() => (b.textContent = 'Копировать'), 1400); return; }
  if (d.unpub !== undefined) { unpublishArt(); return; }
  if (b.id === 'mbtn') { $('menu').classList.toggle('open'); return; }
  if (b.id === 'logoutBtn') { fetch('/api/auth/logout', { method: 'POST' }).finally(toLogin); return; }
  if (d.art) { const [mid, k] = d.art.split(':'); if (A.open && A.mid === mid && A.k === +k) { closeArt(); return; } const a = getArts(findMsg(mid).t)[+k]; A.follow = !a.closed; showArt(mid, +k, a.closed ? 'preview' : 'code'); return; }
  if (d.tab) { A.tab = d.tab; paneUI(); return; }
  if (b.id === 'pClose') { closeArt(); return; }
  if (b.id === 'pReload') { A.shown = ''; A.tab = 'preview'; paneUI(); return; }
  if (b.id === 'pOpen') { const u = artBlobUrl(); if (u) window.open(u, '_blank'); return; }
  if (b.id === 'pDl') { const u = artBlobUrl(); if (!u) return; const l = document.createElement('a'); l.href = u; l.download = (curArt().title.replace(/[^\wа-яё -]/gi, '').trim() || 'site') + '.html'; l.click(); return; }
  if (b.id === 'pCopy') { navigator.clipboard?.writeText(curArt()?.code || ''); flash(b); return; }
  if (b.id === 'dclose') { closePanel(); return; }
  if (d.m) { $('menu').classList.remove('open'); const mm = MODELS.find((x) => x.id === d.m); if (mm && locked(mm)) { openPlans(`Модель «${mm.name}» доступна на тарифе ${tierName(mm)}`); return; } S.model = d.m; }
  else if (d.p) { switchTo(() => { S.proj = S.proj === d.p ? null : d.p; S.cur = null; }); closeMobile(); save(); return; }
  else if (d.c) { if (d.c === S.cur) { closeMobile(); return; } switchTo(() => { S.cur = d.c; }); closeMobile(); save(); return; }
  else if (d.s) { send(d.s); return; }
  else if (d.copy !== undefined) { navigator.clipboard?.writeText(cur().msgs[+d.copy].t); flash(b); return; }
  else if (d.copycode !== undefined) { navigator.clipboard?.writeText(b.closest('.pre').querySelector('code').innerText); b.textContent = 'Скопировано'; setTimeout(() => (b.textContent = 'Копировать'), 1400); return; }
  else if (d.redo !== undefined) { if (busy) return; const c = cur(), i = +d.redo; c.msgs.splice(i); const a = { id: uid(), r: 'a', t: '' }; c.msgs.push(a); stream(c, a); return; }
  else if (d.edit !== undefined) { if (busy) return; const c = cur(), i = +d.edit, em = c.msgs[i]; $('q').value = em.t; PEND = [...(em.files || []).map((f) => ({ id: uid(), kind: 'file', ...f })), ...(em.images || []).map((u) => ({ id: uid(), kind: 'img', url: u }))]; renderAtts(); PICK = em.pick || null; renderPick(); c.msgs.splice(i); grow(); $('q').focus(); }
  else if (b.id === 'newChat') { switchTo(() => { S.cur = null; }); closeMobile(); save(); $('q').focus(); return; }
  else if (b.id === 'newProj') { projectModal(null); return; }
  else if (b.id === 'closeSide') { if (mobile()) closeMobile(); else S.side = false; }
  else if (b.id === 'openSide') { if (mobile()) { $('side').classList.add('mopen'); $('overlay').classList.add('on'); return; } S.side = true; }
  else return;
  save(); render();
});
$('modal').addEventListener('mousedown', (e) => { if (e.target.id === 'modal') closePanel(); });
$('overlay').onclick = closeMobile;
$('form').onsubmit = (e) => { e.preventDefault(); if (busy && busyChat !== S.cur) { toast('Модель ещё отвечает в другом чате — дождитесь или вернитесь туда'); return; } busy ? stop() : send($('q').value); };
$('q').onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!busy) send($('q').value); } };
$('q').oninput = () => { grow(); renderSend(); };
$('find').oninput = (e) => { filter = e.target.value.trim().toLowerCase(); renderSide(); };
addEventListener('resize', () => { renderSide(); grow(); });
addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('menu').classList.remove('open'); closeMobile(); if ($('modal').classList.contains('on')) closePanel(); else if (A.open && mobile()) closeArt(); } });
paintMe();
// карточка Telegram-канала: скрывается навсегда после закрытия или подписки
if (!localStorage.getItem('premier-tg-hidden')) $('tgCard').hidden = false;
const hideTg = () => { localStorage.setItem('premier-tg-hidden', '1'); $('tgCard').hidden = true; };
$('tgClose').onclick = hideTg; $('tgCard').querySelector('.tgsub').addEventListener('click', () => setTimeout(hideTg, 300));

/* ---------- аккаунт и память ---------- */
async function memApi(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json' } });
  if (r.status === 401) { toLogin(); throw new Error('auth'); }
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Ошибка ' + r.status); return j;
}
var ACC_TABS = [['profile', 'Профиль', 'i-user'], ['plan', 'Тариф', 'i-card'], ['watermark', 'Вотермарк', 'i-globe'], ['memory', 'Память', 'i-brain'], ['voice', 'Голос', 'i-speak'], ['security', 'Безопасность', 'i-lock']];
function myName() { return ME.name || ME.login; }
function paintMe() { $('meName').textContent = myName(); $('meAv').textContent = (myName() || '?')[0]; }
function openAccount(tab = 'profile') {
  dlgW(false); $('modal').querySelector('.dlg').classList.add('accdlg'); $('dtitle').textContent = 'Настройки аккаунта'; $('modal').classList.add('on');
  $('dbody').innerHTML = `<div class="acc"><nav class="acc-nav">${ACC_TABS.map(([k, n, i]) => `<button type="button" data-acc="${k}" class="${k === tab ? 'on' : ''}"><svg><use href="#${i}"/></svg>${n}</button>`).join('')}</nav><div class="acc-body" id="accBody"></div></div>`;
  accTab(tab);
}
function accTab(tab) {
  document.querySelectorAll('[data-acc]').forEach((b) => b.classList.toggle('on', b.dataset.acc === tab));
  const el = $('accBody'); el.style.animation = 'none'; el.offsetHeight; el.style.animation = '';
  const since = ME.created ? new Date(ME.created).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).replace(' г.', '') : '';
  if (tab === 'profile') {
    el.innerHTML = `<div class="acc-hero"><div class="acc-av">${esc(myName()[0] || '?')}</div><div><b>${esc(myName())}</b><small>${esc(ME.email || '@' + ME.login)}${since ? ' · с ' + since : ''}</small></div></div>
      <form id="nameF" autocomplete="off"><label class="field"><span>Имя</span><input id="nameIn" maxlength="40" value="${esc(myName())}" required><small>Так вас видит Premier в интерфейсе</small></label>
      <label class="field"><span>Аккаунт Google</span><input value="${esc(ME.email || '—')}" disabled><small>Вход — через этот Google-аккаунт</small></label>
      <div class="msgline" id="nameMsg"></div><div class="btns"><button class="btn pri" id="nameSave">Сохранить</button></div></form>
      <div class="acc-note"><svg><use href="#i-check"/></svg>Чаты и проекты хранятся на сервере и доступны на всех ваших устройствах</div>`;
    $('nameF').onsubmit = async (e) => {
      e.preventDefault(); const name = $('nameIn').value.trim(); if (!name) return;
      try { const u = await memApi('/api/account/name', { method: 'POST', body: JSON.stringify({ name }) }); ME.name = u.name; paintMe(); accTab('profile'); toast('Имя сохранено'); }
      catch (err) { $('nameMsg').className = 'msgline err'; $('nameMsg').textContent = err.message; }
    };
  } else if (tab === 'plan') {
    const B = BILL; if (!B) { el.innerHTML = '<div class="msgline">Загружаю…</div>'; loadBill().then(() => BILL && accTab('plan')); return; }
    const bar = (k, label) => { const L = B.limits[k], u = B.used[k]; return `<div class="acc-use"><div><span>${label}</span><b>${L == null ? u + ' · без ограничений' : `${Math.min(u, L)} из ${L}`}</b></div><div class="pc-bar${L != null && u >= L ? ' out' : L != null && L - u <= Math.max(1, L * 0.15) ? ' low' : ''}"><i style="width:${L == null ? 0 : Math.min(100, u / L * 100)}%"></i></div></div>`; };
    el.innerHTML = `<div class="acc-plan"><div><small>Ваш тариф</small><b>${esc(B.plan.name)}${B.plan.trial ? ' <span class="pc-badge">пробный</span>' : ''}</b><span>${B.plan.until ? 'Действует до ' + fmtD(B.plan.until) : 'Бесплатно, без срока'}</span></div><button class="btn pri" id="accPlans">${B.plan.until ? 'Продлить или сменить' : 'Улучшить тариф'}</button></div>
      <div class="dsec" style="margin-top:18px">Сегодня</div>${bar('m', 'Сообщения')}${bar('c', 'Запуски Python')}${bar('s', 'Сайты')}${B.images ? bar('i', 'Картинки') : ''}${B.videos && B.limits.v !== 0 ? bar('v', 'Видео') : ''}
      <p class="pnote" style="margin-top:12px">Лимиты обновляются в полночь по Москве.</p>`;
  } else if (tab === 'memory') {
    el.innerHTML = `<label class="check"><input type="checkbox" id="memOn"> Модель запоминает важное о вас и учитывает это во всех чатах</label>
      <div id="memList"><div class="msgline">Загружаю…</div></div>
      <form id="memAdd" autocomplete="off"><label class="field"><span>Добавить вручную</span><input id="memText" maxlength="300" placeholder="Например: Меня зовут Аня, я дизайнер. Отвечай коротко."></label>
      <div class="btns"><button type="button" class="btn" id="memClear">Стереть всё</button><button class="btn pri">Добавить</button></div></form>`;
    $('memOn').onchange = (e) => memApi('/api/memory', { method: 'POST', body: JSON.stringify({ on: e.target.checked }) }).then(renderMem).catch(() => {});
    $('memAdd').onsubmit = (e) => { e.preventDefault(); const t = $('memText').value.trim(); if (!t) return; memApi('/api/memory', { method: 'POST', body: JSON.stringify({ text: t }) }).then((x) => { $('memText').value = ''; renderMem(x); }).catch((err) => toast(err.message)); };
    memApi('/api/memory').then(renderMem).catch(() => {});
  } else if (tab === 'voice') {
    const pref = VPREF(), cur = (VOICES.find((v) => v.id === pref.voice) || VOICES[0])?.id, rate = +pref.rate || 1;
    const SAMPLE = 'Привет! Я Premier. Так звучит мой голос — спокойно и понятно. Чем займёмся сегодня?';
    el.innerHTML = (VOICES.length ? `<div class="dsec">Голос</div><div class="vlist">${VOICES.map((v) => `<label class="vopt${v.id === cur ? ' on' : ''}"><input type="radio" name="voice" value="${esc(v.id)}"${v.id === cur ? ' checked' : ''}><span class="vav">${esc(v.name[0])}</span><span class="vtx"><b>${esc(v.name)}</b><small>${esc((v.kind ? v.kind + ' · ' : '') + (v.engine === 'vosk' ? 'чистый звук' : 'чёткая дикция'))}</small></span><button type="button" class="btn vplay" data-vplay="${esc(v.id)}"><svg><use href="#i-speak"/></svg>Прослушать</button></label>`).join('')}</div>`
      : `<div class="acc-note"><svg><use href="#i-speak"/></svg>Нейросетевой голос на сервере не установлен — ответы читает голос вашего браузера.</div>`)
      + `<div class="dsec" style="margin-top:18px">Скорость</div><div class="vrate">${[0.85, 1, 1.15, 1.3, 1.5].map((r) => `<button type="button" data-vrate="${r}" class="${r === rate ? 'on' : ''}">${String(r).replace('.', ',')}×</button>`).join('')}</div>
      <p class="pnote" style="margin-top:12px">Нажмите на значок динамика под ответом, чтобы прослушать его. Нажмите ещё раз — чтобы остановить.</p>`;
    el.querySelectorAll('input[name=voice]').forEach((r) => (r.onchange = () => { setVPref({ voice: r.value }); el.querySelectorAll('.vopt').forEach((o) => o.classList.toggle('on', o.contains(r))); }));
    el.querySelectorAll('[data-vrate]').forEach((b) => (b.onclick = () => { setVPref({ rate: +b.dataset.vrate }); el.querySelectorAll('[data-vrate]').forEach((x) => x.classList.toggle('on', x === b)); if (AUD) AUD.audio.playbackRate = VRATE(AUD); }));
    el.querySelectorAll('[data-vplay]').forEach((b) => (b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); const keep = el.querySelector('input[name=voice]:checked')?.value; setVPref({ voice: b.dataset.vplay }); speak('__voice:' + b.dataset.vplay, SAMPLE); setVPref({ voice: keep }); }));
  } else if (tab === 'watermark') {
    const B = BILL;
    const forced = !B || !B.plan || !B.plan.id || B.plan.id === 'free' || B.plan.trial === true || (B.plan.until && Number(B.plan.until) <= Date.now());
    const on = forced || ME.wm === true;
    el.innerHTML = `<label class="check"><input type="checkbox" id="wmUser" ${on ? 'checked' : ''}${forced ? ' disabled' : ''}> Показывать бейдж «Сделано в Premier» на моих опубликованных сайтах</label>
      ${forced ? '<p class="pnote">На бесплатном тарифе бейдж всегда включён — отключить его нельзя.</p>' : '<p class="pnote">У Pro и Max бейдж выключен по умолчанию. Включите его, если хотите поддержать Premier — под вашими сайтами появится карточка со ссылкой на нас.</p>'}
      <div class="dsec" style="margin-top:16px">Так это выглядит под вашим сайтом</div>
      <div style="display:flex;gap:10px;align-items:center;border:1px solid #34343c;border-radius:12px;padding:12px 16px;background:#1b1d25;font-size:14px;line-height:1.45"><span style="font-size:18px">⚡</span><span><b>Сделано за 1 минуту в Premier</b> — <a href="https://ide.kgpix.bond/" target="_blank" rel="noopener">создать свой сайт или игру бесплатно</a></span></div>`;
    if (!forced) $('wmUser').onchange = (e) => memApi('/api/account/watermark', { method: 'POST', body: JSON.stringify({ on: e.target.checked }) }).then((x) => { ME.wm = x.wm === true; toast(x.wm ? 'Бейдж включён — будет показан на ваших сайтах' : 'Бейдж выключен'); }).catch((err) => toast(err.message));
  
  } else if (tab === 'security') {
    el.innerHTML = `<div class="dsec">Вход</div>
      <div class="acc-row"><div><b>Через Google</b><small>${esc(ME.email || 'Аккаунт Google')}</small></div></div>
      <div class="hr"></div>
      <div class="acc-row"><div><b>Другие устройства</b><small id="sessInfo">Выйти из аккаунта везде, кроме этого устройства</small></div><button class="btn" id="logoutAll">Выйти везде</button></div>
      <div class="danger"><div class="acc-row"><div><b>Удалить аккаунт</b><small>Чаты, проекты, память и файлы будут удалены навсегда</small></div><button class="btn dangerb" id="delOpen">Удалить</button></div>
        <form id="delF" hidden autocomplete="off"><label class="field" style="margin-top:14px"><span>Введите слово «удалить», чтобы подтвердить</span><input name="password" type="text" autocomplete="off" required></label>
        <div class="msgline err" id="delMsg"></div><div class="btns"><button type="button" class="btn" id="delCancel">Отмена</button><button class="btn dangerb solid">Удалить навсегда</button></div></form></div>`;
    memApi('/api/account').then((a) => { if ($('sessInfo') && a.sessions > 1) $('sessInfo').textContent = `Вы вошли на ${a.sessions} ${plural(a.sessions, 'устройстве', 'устройствах', 'устройствах')}. Выйти везде, кроме этого`; }).catch(() => {});
    $('logoutAll').onclick = () => memApi('/api/account/logout-all', { method: 'POST', body: '{}' }).then(() => { $('sessInfo').textContent = 'Готово — другие устройства отключены'; toast('Вы вышли на других устройствах'); }).catch((err) => toast(err.message));
    $('delOpen').onclick = () => { $('delF').hidden = false; $('delOpen').hidden = true; $('delF').password.focus(); };
    $('delCancel').onclick = () => { $('delF').hidden = true; $('delOpen').hidden = false; };
    $('delF').onsubmit = async (e) => {
      e.preventDefault();
      try { await memApi('/api/account', { method: 'DELETE', body: JSON.stringify({ confirm: e.target.password.value }) }); localStorage.removeItem(KEY); localStorage.removeItem(KEY + ':sync'); location.replace('/'); }
      catch (err) { $('delMsg').textContent = err.message; }
    };
  }
}
function renderMem(x) {
  if (!x || !$('memList')) return;
  $('memOn').checked = x.on;
  $('memList').innerHTML = x.items.length ? x.items.slice().reverse().map((i) => `<div class="memrow"><span>${esc(i.text)}<small>${new Date(i.at).toLocaleDateString('ru-RU')}</small></span><button class="ib" data-delmem="${i.id}" aria-label="Забыть" title="Забыть"><svg><use href="#i-trash"/></svg></button></div>`).join('')
    : `<div class="msgline">${x.on ? 'Пока пусто. Расскажите о себе в чате или попросите «запомни, что…».' : 'Память выключена.'}</div>`;
}

/* ---------- голос: ввод и озвучка ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const TTS = 'speechSynthesis' in window;
let rec = null, SPEAK = null;
if (SR) $('micBtn').hidden = false;
function toggleMic() {
  if (rec) { rec.stop(); return; }
  try { rec = new SR(); } catch { toast('Голосовой ввод недоступен в этом браузере'); return; }
  rec.lang = /^en/i.test(navigator.language) ? 'en-US' : 'ru-RU'; rec.interimResults = true; rec.continuous = true;
  const base = $('q').value.trim() ? $('q').value.replace(/\s*$/, ' ') : ''; let fin = '';
  rec.onresult = (e) => { let mid = ''; for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript; e.results[i].isFinal ? (fin += t) : (mid += t); } $('q').value = base + fin + mid; grow(); renderSend(); };
  rec.onerror = (e) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('Разрешите доступ к микрофону'); else if (!['aborted', 'no-speech'].includes(e.error)) toast('Голосовой ввод: ' + e.error); };
  rec.onend = () => { rec = null; $('micBtn').classList.remove('on'); $('micBtn').title = 'Голосовой ввод'; $('q').focus(); };
  try { rec.start(); } catch { rec = null; return; }
  $('micBtn').classList.add('on'); $('micBtn').title = 'Остановить запись'; toast('Говорите… Нажмите на микрофон ещё раз, чтобы закончить');
}
/* ---------- озвучка: голос на сервере (RHVoice), запасной — голос браузера ---------- */
let SPEAK_LOAD = false, AUD = null, KEEP = null;
const VPREF = () => { try { return JSON.parse(localStorage.getItem('premier-voice') || '{}'); } catch { return {}; } };
const setVPref = (o) => localStorage.setItem('premier-voice', JSON.stringify({ ...VPREF(), ...o }));
fetch('/api/tts').then((r) => (r.ok ? r.json() : null)).then((d) => { VOICES = d?.voices || []; if (VOICES.length) renderChat(); }).catch(() => {});
// текст ответа → текст для чтения вслух: без разметки, кода и ссылок; числа, валюты и сокращения — словами
function speakText(t) {
  return String(t || '')
    .replace(/```[\s\S]*?(```|$)/g, '\nПример кода — смотрите на экране.\n')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/(?:www\.)?([^\/\s)]+)[^\s)]*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^[ \t]*\|?[ \t:|-]*-{3,}[ \t:|-]*$/gm, '')
    .replace(/^[ \t]*\|(.+)\|[ \t]*$/gm, (_, r) => r.split('|').map((x) => x.trim()).filter(Boolean).join(', ') + '.')
    .replace(/^#{1,6}\s*(.+?)\s*$/gm, '$1.')
    .replace(/^\s*[-*•+]\s+/gm, '').replace(/^\s*>\s?/gm, '')
    .replace(/(\d)[ \u00a0\u202f](?=\d{3}(?!\d))/g, '$1')
    .replace(/(\d)\s*₽/g, '$1 рублей').replace(/₽/g, 'рублей').replace(/(\d)\s*руб(?![а-яё])\.?/g, '$1 рублей')
    .replace(/\$\s*(\d[\d.,]*)/g, '$1 долларов').replace(/(\d)\s*\$/g, '$1 долларов').replace(/(\d)\s*€/g, '$1 евро').replace(/€\s*(\d[\d.,]*)/g, '$1 евро')
    .replace(/(\d)\s*%/g, '$1 процентов').replace(/(\d)\s*°C?/g, '$1 градусов')
    .replace(/(?<!\p{L})т\.\s?е\./gu, 'то есть').replace(/(?<!\p{L})т\.\s?д\./gu, 'так далее').replace(/(?<!\p{L})т\.\s?п\./gu, 'тому подобное').replace(/(?<!\p{L})т\.\s?к\./gu, 'так как')
    .replace(/(?<!\p{L})напр\./gu, 'например').replace(/(?<!\p{L})г\.\s(?=[А-ЯЁ])/gu, 'город ').replace(/(\d)\s?г\.(?!\p{L})/gu, '$1 год').replace(/(\d)\s?млн(?!\p{L})\.?/gu, '$1 миллионов').replace(/(\d)\s?млрд(?!\p{L})\.?/gu, '$1 миллиардов').replace(/(\d)\s?тыс(?!\p{L})\.?/gu, '$1 тысяч')
    .replace(/\s(—|–|-)\s/g, ', ').replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '')
    .replace(/[*_~#|<>]/g, '').replace(/[ \t]+/g, ' ')
    .replace(/([^.!?:;,\n])\s*\n+/g, '$1.\n').replace(/\n{2,}/g, '\n').replace(/\.{2,}/g, '.').replace(/([!?])\./g, '$1')
    .trim().slice(0, 12000);
}
// режем на фразы: первая — короткая, чтобы звук пошёл быстрее
function speakChunks(text) {
  text = text.replace(/\s*\n\s*/g, ' '); const parts = text.match(/[^.!?…]+(?:[.!?…]+|$)/g) || [text], out = []; let c = '';
  for (const p of parts) { const lim = out.length ? 260 : 140; if ((c + p).length > lim && c.trim()) { out.push(c.trim()); c = p; } else c += p; }
  if (c.trim()) out.push(c.trim());
  return out.flatMap((x) => (x.length > 500 ? x.match(/.{1,480}(\s|$)/g) : [x])).map((x) => x.trim()).filter((x) => /[\p{L}\p{N}]/u.test(x));
}
function silentWav() { const n = 400, b = new DataView(new ArrayBuffer(44 + n * 2)), w = (o, s) => [...s].forEach((ch, i) => b.setUint8(o + i, ch.charCodeAt(0)));
  w(0, 'RIFF'); b.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true); b.setUint32(24, 22050, true); b.setUint32(28, 44100, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); w(36, 'data'); b.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([b], { type: 'audio/wav' })); }
function stopSpeak() {
  if (TTS) speechSynthesis.cancel(); clearInterval(KEEP); KEEP = null;
  if (AUD) { AUD.stop = true; try { AUD.audio.pause(); } catch {} AUD.wake?.(); AUD = null; }
  const was = SPEAK; SPEAK = null; SPEAK_LOAD = false; if (was) renderChat();
}
function speak(mid, txt) {
  if (SPEAK === mid) { stopSpeak(); return; }
  stopSpeak();
  const text = speakText(txt ?? findMsg(mid)?.t); if (!text) return;
  SPEAK = mid; SPEAK_LOAD = !!VOICES.length; renderChat();
  if (VOICES.length) speakNeural(mid, text); else speakBrowser(mid, text);
}
// скорость задаёт сервер (без искажений); если её сменили во время чтения — досдвигаем плеером
const VRATE = (ses) => (+VPREF().rate || 1) / (ses.rate || 1);
async function speakNeural(mid, text) {
  const pref = VPREF(), voice = (VOICES.find((v) => v.id === pref.voice) || VOICES[0]).id, rate = +pref.rate || 1;
  const chunks = speakChunks(text), ses = { mid, stop: false, rate, audio: new Audio() }; AUD = ses;
  ses.audio.preservesPitch = true; ses.audio.src = silentWav(); ses.audio.play().catch(() => {}); // разблокирует звук на iPhone, пока идёт запрос
  const jobs = [];
  const want = (i) => { if (i < chunks.length && !jobs[i]) { jobs[i] = fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: chunks[i], voice, rate }) }).then((r) => { if (!r.ok) throw new Error('tts ' + r.status); return r.blob(); }); jobs[i].catch(() => {}); } return jobs[i]; };
  let i = 0;
  try {
    for (; i < chunks.length; i++) {
      want(i); want(i + 1); want(i + 2);
      const blob = await jobs[i]; if (ses.stop) return;
      if (SPEAK_LOAD) { SPEAK_LOAD = false; renderChat(); }
      const url = URL.createObjectURL(blob); ses.audio.src = url; ses.audio.playbackRate = VRATE(ses);
      await new Promise((ok, fail) => { ses.wake = ok; ses.audio.onended = ok; ses.audio.onerror = fail; ses.audio.play().catch(fail); });
      URL.revokeObjectURL(url); jobs[i] = null; if (ses.stop) return;
    }
  } catch {
    if (ses.stop) return;
    if (i === 0 && TTS) { AUD = null; SPEAK_LOAD = false; renderChat(); speakBrowser(mid, text); return; } // сервер не ответил — читаем голосом браузера
    toast('Не удалось озвучить ответ');
  } finally { if (AUD === ses) { AUD = null; SPEAK = null; SPEAK_LOAD = false; renderChat(); } }
}
function speakBrowser(mid, text) {
  if (!TTS) { SPEAK = null; renderChat(); toast('Озвучка недоступна в этом браузере'); return; }
  const ss = speechSynthesis, ru = /[а-яё]/i.test(text), lang = ru ? 'ru' : 'en', rate = +VPREF().rate || 1;
  const voices = ss.getVoices().filter((v) => v.lang.toLowerCase().startsWith(lang));
  const voice = voices.find((v) => /natural|neural|online|google|milena|yuri|irina|svetlana|dmitry|pavel/i.test(v.name)) || voices[0];
  const chunks = speakChunks(text);
  chunks.forEach((ch, i) => {
    const u = new SpeechSynthesisUtterance(ch); u.lang = ru ? 'ru-RU' : 'en-US'; if (voice) u.voice = voice; u.rate = rate;
    if (i === chunks.length - 1) u.onend = u.onerror = () => { if (SPEAK === mid) { clearInterval(KEEP); KEEP = null; SPEAK = null; renderChat(); } };
    ss.speak(u);
  });
  // Chrome обрывает длинное чтение примерно через 15 секунд — периодически «будим» синтезатор
  clearInterval(KEEP); KEEP = setInterval(() => { if (!ss.speaking) return; ss.pause(); ss.resume(); }, 10000);
}
if (TTS) speechSynthesis.getVoices();

/* ---------- выбор элемента на сайте ---------- */
let PICK = null, picking = false;
function pickAgent() {
  let on = false, box = null, lab = null;
  const mk = () => { box = document.createElement('div'); box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #5e9fe8;background:rgba(94,159,232,.12);border-radius:3px;display:none'; lab = document.createElement('div'); lab.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;background:#5e9fe8;color:#fff;font:12px/1.4 system-ui,sans-serif;padding:2px 7px;border-radius:4px;display:none;max-width:60vw;overflow:hidden;white-space:nowrap;text-overflow:ellipsis'; document.documentElement.append(box, lab); };
  const name = (e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
  const sel = (e) => { const p = []; while (e && e.nodeType === 1 && e !== document.body && p.length < 6) { if (e.id) { p.unshift('#' + CSS.escape(e.id)); break; } let s = e.tagName.toLowerCase(); const sib = [...e.parentNode.children].filter((x) => x.tagName === e.tagName); if (sib.length > 1) s += ':nth-of-type(' + (sib.indexOf(e) + 1) + ')'; p.unshift(s); e = e.parentElement; } return p.join(' > ') || 'body'; };
  const set = (v) => { on = v; if (!box) mk(); if (!v) { box.style.display = lab.style.display = 'none'; } document.documentElement.style.cursor = v ? 'crosshair' : ''; };
  addEventListener('mouseover', (ev) => { const e = ev.target; if (!on || !e || e === document.documentElement || e === document.body) return; const r = e.getBoundingClientRect(); Object.assign(box.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', display: 'block' }); lab.textContent = name(e); Object.assign(lab.style, { left: Math.max(0, r.left) + 'px', top: (r.top > 24 ? r.top - 22 : r.bottom + 4) + 'px', display: 'block' }); }, true);
  for (const t of ['mousedown', 'pointerdown', 'mouseup']) addEventListener(t, (ev) => { if (on) { ev.preventDefault(); ev.stopPropagation(); } }, true);
  addEventListener('click', (ev) => { if (!on) return; ev.preventDefault(); ev.stopPropagation(); const e = ev.target; parent.postMessage({ premier: 'picked', sel: sel(e), name: name(e), text: (e.innerText || e.getAttribute('alt') || '').trim().replace(/\s+/g, ' ').slice(0, 120), html: e.outerHTML.slice(0, 2500) }, '*'); set(false); }, true);
  addEventListener('keydown', (e) => { if (on && e.key === 'Escape') { set(false); parent.postMessage({ premier: 'pickoff' }, '*'); } }, true);
  addEventListener('message', (e) => { if (e.data && e.data.premier === 'pick') set(!!e.data.on); });
}
const PICK_TAG = '<script>(' + pickAgent.toString() + ')()<\/script>';
const withPick = (code) => /<\/body>/i.test(code) ? code.replace(/<\/body>(?![\s\S]*<\/body>)/i, PICK_TAG + '</body>') : code + PICK_TAG;
function setPicking(v) {
  picking = v; $('pPick').classList.toggle('on', v);
  if (v && A.tab !== 'preview') { A.tab = 'preview'; paneUI(); }
  $('pFrame').contentWindow?.postMessage({ premier: 'pick', on: v }, '*');
  if (v) toast('Наведите на элемент сайта и нажмите на него');
}
addEventListener('message', (e) => {
  if (e.source !== $('pFrame').contentWindow || !e.data?.premier) return;
  if (e.data.premier === 'pickoff') { picking = false; $('pPick').classList.remove('on'); return; }
  if (e.data.premier !== 'picked') return;
  picking = false; $('pPick').classList.remove('on');
  PICK = { sel: String(e.data.sel).slice(0, 300), name: String(e.data.name).slice(0, 80), text: String(e.data.text || '').slice(0, 120), html: String(e.data.html).slice(0, 2500), title: curArt()?.title || 'Сайт' };
  renderPick(); if (mobile()) closeArt(); $('q').focus();
});
function renderPick() {
  const c = $('pickChip'); c.hidden = !PICK;
  c.innerHTML = PICK ? `<svg><use href="#i-pick"/></svg><span>Элемент: <b>${esc(PICK.name)}</b>${PICK.text ? ' — «' + esc(PICK.text.slice(0, 60)) + '»' : ''}</span><button type="button" data-unpick aria-label="Убрать элемент"><svg><use href="#i-x"/></svg></button>` : '';
  $('q').placeholder = PICK ? 'Что изменить в этом элементе?' : 'Спросите что угодно';
}

/* ---------- тарифы и оплата ---------- */
let BILL = null;
const PL = { promo: null };
const fmtD = (t) => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
const rub = (n) => Number(n).toLocaleString('ru-RU') + ' ₽';
const tierName = (m) => (BILL?.plans.filter((p) => (m.plans || []).includes(p.id)).sort((a, b) => a.price - b.price)[0] || {}).name || 'Pro';
const locked = (m) => !!BILL && !(m.plans || []).includes(BILL.plan.id);
async function loadBill() {
  try { const r = await fetch('/api/billing'); if (r.status === 401) return toLogin(); if (r.ok) BILL = await r.json(); } catch {}
  pickModel(); renderPlan(); renderTop();
}
// модель по умолчанию; недоступную по тарифу меняем на доступную
function pickModel() {
  const ok = (m) => m && !locked(m), c = curModel();
  if (ok(c)) return;
  const d = MODELS.find((m) => m.def);
  const next = ok(d) ? d : MODELS.find(ok) || d || MODELS[0];
  if (next && next.id !== S.model) { S.model = next.id; save(); }
}
function renderPlan() {
  const b = BILL; $('planCard').hidden = !b; if (!b) return;
  const top = Math.max(...b.plans.map((p) => p.tier));
  $('pcName').innerHTML = esc(b.plan.name) + (b.plan.trial ? ' <span class="pc-badge">пробный</span>' : '');
  $('pcUp').textContent = b.plan.tier >= top ? 'Тарифы' : 'Улучшить';
  const L = b.limits.m, u = b.used.m, bar = !b.unlimited && L != null;
  $('pcBarW').hidden = !bar;
  if (bar) { $('pcBar').style.width = Math.min(100, u / L * 100) + '%'; $('pcBarW').className = 'pc-bar' + (u >= L ? ' out' : L - u <= Math.max(2, L * 0.15) ? ' low' : ''); }
  $('pcText').textContent = (bar ? `${Math.min(u, L)} из ${L} ${plural(L, 'сообщения', 'сообщений', 'сообщений')} сегодня` : 'Без ограничений') + (b.plan.until ? ' · до ' + fmtD(b.plan.until) : '');
}
function planFeats(p) {
  const top = Math.max(...BILL.plans.map((x) => x.tier)), mods = MODELS.filter((m) => (m.plans || []).includes(p.id)).map((m) => m.name);
  const lim = (n, one, few, many, unl) => n == null ? unl : `${n} ${plural(n, one, few, many)} в день`;
  return [
    lim(p.msgs, 'сообщение', 'сообщения', 'сообщений', 'Сообщения без ограничений'),
    mods.length && mods.length === MODELS.length && MODELS.length > 1 ? 'Все модели: ' + mods.join(', ') : mods.length ? 'Модели: ' + mods.join(', ') : 'Базовые модели',
    lim(p.code, 'запуск', 'запуска', 'запусков', 'Python без ограничений').replace(/в день$/, 'Python в день'),
    lim(p.sites, 'сайт', 'сайта', 'сайтов', 'Сайты без ограничений'),
    ...(BILL.images ? [lim(p.images, 'картинка', 'картинки', 'картинок', 'Картинки без ограничений')] : []),
    ...(BILL.videos ? [p.videos === 0 ? 'Без видео' : lim(p.videos, 'видео', 'видео', 'видео', 'Видео без ограничений')] : []),
    'Интернет, память, файлы и голос',
  ];
}
function openPlans(reason) {
  if (!BILL) { loadBill().then(() => BILL && openPlans(reason)); return; }
  dlgW(true); $('dtitle').textContent = 'Тарифы Premier'; $('modal').classList.add('on');
  const top = Math.max(...BILL.plans.map((x) => x.tier)), pro = BILL.plans.find((x) => x.tier === 1);
  const cards = BILL.plans.map((p) => {
    const cur = p.id === BILL.plan.id, disc = PL.promo && (!PL.promo.plan || PL.promo.plan === p.id) && p.price > 0 ? Math.max(1, Math.round(p.price * (100 - PL.promo.discount) / 100)) : null;
    let btn;
    if (!p.price) btn = `<button class="btn" disabled>${cur ? 'Ваш тариф' : 'Бесплатно'}</button>`;
    else if (!BILL.pay) btn = `<button class="btn" disabled>Оплата скоро</button>`;
    else btn = `<button class="btn ${p === pro || cur ? 'pri' : ''}" data-buy="${p.id}">${cur ? 'Продлить' : p.tier < BILL.plan.tier ? 'Перейти' : 'Оплатить'} ${rub(disc ?? p.price)}</button>`;
    return `<div class="plan${p === pro ? ' hot' : ''}${cur ? ' cur' : ''}">${p === pro ? '<span class="tag">Популярный</span>' : ''}
      <div><h3>${esc(p.name)}${cur ? ' <span class="pc-badge">сейчас</span>' : ''}</h3><p>${esc(p.desc || '')}</p></div>
      <div class="price">${p.price ? (disc != null ? `<s>${p.price}</s>` : '') + rub(disc ?? p.price) + ` <small>/ ${p.days} дн.</small>` : '0 ₽'}</div>
      <ul>${planFeats(p).map((f) => `<li><svg><use href="#i-check"/></svg><span>${esc(f)}</span></li>`).join('')}</ul>${btn}</div>`;
  }).join('');
  $('dbody').innerHTML = `${reason ? `<div class="reason">${esc(reason)}</div>` : ''}
    ${BILL.plan.until ? `<div class="msgline">Сейчас: <b>${esc(BILL.plan.name)}</b>${BILL.plan.trial ? ' (пробный период)' : ''} до ${fmtD(BILL.plan.until)}. Продление добавляет дни к текущему сроку.</div>` : ''}
    ${BILL.methods?.card && BILL.methods?.crypto ? `<div class="paym" role="radiogroup" aria-label="Способ оплаты"><span>Способ оплаты</span><div class="seg"><button type="button" data-paym="card" aria-checked="${payMethod() === 'card'}">Карта или СБП</button><button type="button" data-paym="crypto" aria-checked="${payMethod() === 'crypto'}">Криптовалюта</button></div></div>` : ''}
    <div class="plans">${cards}</div>
    <form class="promo" id="promoF" autocomplete="off"><input id="promoIn" placeholder="Промокод" maxlength="30" value="${esc(PL.promo?.code || '')}"><button class="btn">Применить</button><span class="msgline" id="promoMsg">${PL.promo ? `Скидка ${PL.promo.discount}% применится при оплате` : ''}</span></form>
    <div class="msgline" id="payMsg"></div>
    <p class="pnote">${BILL.pay ? (payMethod() === 'crypto' ? 'Оплата в @CryptoBot: USDT, TON, BTC и другие монеты — сумма пересчитывается из рублей по курсу.' : 'Оплата картой или через СБП (Platega).') + ' Без автопродления — тариф действует оплаченный срок.' : 'Онлайн-оплата скоро появится — а пока тариф можно получить через <a href="https://t.me/freeb404f" target="_blank" rel="noopener">наш Telegram</a>.'} Лимиты обновляются в полночь по Москве.</p>`;
  $('dbody').querySelectorAll('[data-paym]').forEach((b) => { b.onclick = () => { PL.method = b.dataset.paym; try { localStorage.setItem('premier:paym', PL.method); } catch {} openPlans(reason); }; });
  $('promoF').onsubmit = async (e) => {
    e.preventDefault(); const code = $('promoIn').value.trim(); if (!code) return;
    const say = (t, c = '') => { $('promoMsg').className = 'msgline ' + c; $('promoMsg').textContent = t; };
    try {
      const j = await memApi('/api/billing/promo', { method: 'POST', body: JSON.stringify({ code }) });
      if (j.gift) { PL.promo = null; BILL = j.billing; renderPlan(); renderTop(); openPlans(); toast(`Промокод активирован: ${BILL.plan.name} до ${fmtD(BILL.plan.until)}`); }
      else { PL.promo = j; openPlans(reason); }
    } catch (err) { say(err.message, 'err'); }
  };
}
function payMethod() {
  const m = BILL?.methods || {}; if (!m.card) return m.crypto ? 'crypto' : 'card'; if (!m.crypto) return 'card';
  if (!PL.method) { try { PL.method = localStorage.getItem('premier:paym'); } catch {} }
  return PL.method === 'crypto' ? 'crypto' : 'card';
}
async function buyPlan(id, b) {
  const method = payMethod(), crypto_ = method === 'crypto';
  // счёт Crypto Bot открываем в новой вкладке (Telegram), а здесь ждём оплату; окно открываем сразу, иначе браузер заблокирует
  const w = crypto_ && !/Telegram/i.test(navigator.userAgent) ? window.open('', '_blank') : null;
  b.disabled = true; const t = b.textContent; b.textContent = crypto_ ? 'Создаю счёт…' : 'Переходим к оплате…';
  try {
    const j = await memApi('/api/pay/create', { method: 'POST', body: JSON.stringify({ plan: id, method, promo: PL.promo && (!PL.promo.plan || PL.promo.plan === id) ? PL.promo.code : '' }) });
    if (!crypto_) { location.href = j.url; return; }
    if (w) { w.location.href = j.url; } else { location.href = j.url; return; }
    b.textContent = 'Жду оплату…'; $('payMsg').className = 'msgline';
    $('payMsg').innerHTML = `Счёт открыт в Crypto Bot. Не видите? <a href="${esc(j.url)}" target="_blank" rel="noopener">Открыть счёт</a>. Тариф включится сам после оплаты.`;
    watchPay(j.order, 1200).finally(() => { b.disabled = false; b.textContent = t; });
  }
  catch (err) { if (w) w.close(); b.disabled = false; b.textContent = t; $('payMsg').className = 'msgline err'; $('payMsg').textContent = err.message; }
}
// ждём подтверждения платежа (возврат со страницы оплаты или счёт в Crypto Bot)
async function watchPay(order, tries = 20) {
  for (let i = 0; i < tries; i++) {
    try {
      const j = await (await fetch('/api/pay/check?order=' + encodeURIComponent(order))).json();
      if (j.status === 'CONFIRMED') { BILL = j.billing; renderPlan(); renderTop(); if ($('modal').classList.contains('on') && $('dtitle').textContent === 'Тарифы Premier') $('modal').classList.remove('on'); toast(`Оплата прошла! ${BILL.plan.name} активен до ${fmtD(BILL.plan.until)}`); return 'ok'; }
      if (j.status === 'CANCELED') { toast('Платёж отменён или счёт истёк'); return 'cancel'; }
    } catch {}
    await new Promise((r) => setTimeout(r, 3000));
  }
  toast('Платёж ещё обрабатывается — тариф включится автоматически'); return 'wait';
}
// возврат со страницы оплаты
(async () => {
  const q = new URLSearchParams(location.search), st = q.get('pay'), order = q.get('order'); if (!st) return;
  history.replaceState(null, '', '/chat');
  if (st === 'fail') { toast('Оплата не прошла — попробуйте ещё раз'); return; }
  toast('Проверяю оплату…');
  await watchPay(order);
})();

/* ---------- запуск ---------- */
render(); loadModels(); loadBill(); renderPick();
pull(true);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pull(false); });
