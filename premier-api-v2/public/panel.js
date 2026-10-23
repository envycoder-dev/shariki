// Панель управления Premier (/panelp)
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const rub = (n) => Number(n || 0).toLocaleString('ru-RU') + ' ₽';
const dt = (t, o = { day: 'numeric', month: 'short', year: 'numeric' }) => new Date(t).toLocaleDateString('ru-RU', o);
const plural = (n, a, b, c) => n % 10 === 1 && n % 100 !== 11 ? a : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? b : c;
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const S = { token: sessionStorage.getItem('premier-admin'), view: null, plans: [] };
function toast(t) { const el = $('toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), 2400); }
const say = (id, t, c = '') => { const el = $(id); if (el) { el.className = 'msg ' + c; el.textContent = t; } };

async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) } });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== '/api/admin/login') { logout('Сессия истекла — войдите снова'); throw new Error('auth'); }
  if (!r.ok) throw new Error(j.error || 'Ошибка ' + r.status);
  return j;
}
const post = (p, b, m = 'POST') => api(p, { method: m, body: JSON.stringify(b || {}) });
const fail = (id) => (e) => { if (e.message !== 'auth') id ? say(id, e.message, 'err') : toast(e.message); };

/* ---------- вход ---------- */
function logout(note) { S.token = null; sessionStorage.removeItem('premier-admin'); $('app').hidden = true; $('login').hidden = false; say('lmsg', note || '', 'err'); $('pw').value = ''; setTimeout(() => $('pw').focus(), 50); }
$('loginF').onsubmit = async (e) => {
  e.preventDefault();
  try { const j = await post('/api/admin/login', { password: $('pw').value }); S.token = j.token; sessionStorage.setItem('premier-admin', j.token); start(); }
  catch (err) { say('lmsg', err.message, 'err'); $('pw').select(); }
};
$('logout').onclick = (e) => { e.preventDefault(); logout(); };

/* ---------- навигация ---------- */
const VIEWS = {
  overview: ['Обзор', 'Главное о вашем Premier за последние дни'],
  models: ['Модели', 'Подключение моделей и выбор, в какие тарифы они входят'],
  plans: ['Тарифы и оплата', 'Цены, лимиты, пробный период, Platega и Crypto Bot'],
  users: ['Пользователи', 'Аккаунты, тарифы и регистрация'],
  payments: ['Платежи', 'История оплат: Platega и Crypto Bot'],
  promos: ['Промокоды', 'Скидки и подарочные тарифы'],
  reviews: ['Отзывы', 'Модерация отзывов пользователей'],
  tools: ['Инструменты', 'Интернет, картинки, Python и встроенный браузер'],
};
async function start() {
  $('login').hidden = true; $('app').hidden = false;
  try { S.plans = (await api('/api/admin/plans')).plans; } catch { return; }
  route();
}
function route() {
  const v = VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : 'overview';
  S.view = v; document.querySelectorAll('.nav a[data-v]').forEach((a) => a.classList.toggle('on', a.dataset.v === v));
  $('vtitle').textContent = VIEWS[v][0]; $('vsub').textContent = VIEWS[v][1]; $('vact').innerHTML = '';
  $('nav').classList.remove('open'); $('overlay').classList.remove('on');
  const el = $('view'); el.style.animation = 'none'; el.offsetHeight; el.style.animation = '';
  el.innerHTML = '<div class="msg">Загружаю…</div>';
  if (v !== 'reviews') refreshReviewCount().catch(fail());
  R[v]().catch(fail());
}
addEventListener('hashchange', route);
$('burger').onclick = () => { $('nav').classList.add('open'); $('overlay').classList.add('on'); };
$('overlay').onclick = () => { $('nav').classList.remove('open'); $('overlay').classList.remove('on'); };
const planName = (id) => (S.plans.find((p) => p.id === id) || {}).name || id;
const planBadge = (id) => { const p = S.plans.find((x) => x.id === id); return `<span class="badge p${p ? p.tier : 0}">${esc(p ? p.name : id)}</span>`; };
const PST = { CONFIRMED: ['Оплачен', 'ok'], PENDING: ['Ожидает', 'warn'], CANCELED: ['Отменён', 'bad'], CHARGEBACKED: ['Возврат', 'bad'] };
const payRows = (list) => list.map((x) => `<tr><td>${new Date(x.created).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}</td><td><div class="who"><span class="av">${esc((x.login || '?')[0])}</span>${esc(x.login)}</div></td><td>${planBadge(x.plan)} <span style="color:var(--dim)">${x.days} дн.</span></td><td>${x.promo ? `<span class="badge">${esc(x.promo)}</span>` : '<span style="color:var(--dim)">—</span>'}</td><td class="r"><b>${rub(x.amount)}</b><small style="display:block;color:var(--dim);font-size:11.5px">${x.provider === 'crypto' ? 'Crypto Bot' : 'Platega'}</small></td><td><span class="badge ${(PST[x.status] || [])[1] || ''}">${(PST[x.status] || [x.status])[0]}</span></td><td class="r">${x.status === 'PENDING' ? `<button class="btn sm" data-paychk="${x.id}">Проверить</button>` : ''}</td></tr>`).join('');
const payTable = (list) => list.length ? `<div class="tw"><table><thead><tr><th>Дата</th><th>Пользователь</th><th>Тариф</th><th>Промокод</th><th class="r">Сумма</th><th>Статус</th><th></th></tr></thead><tbody>${payRows(list)}</tbody></table></div>` : '<div class="empty">Платежей пока нет</div>';

const R = {};
/* ---------- обзор ---------- */
const upt = (sec) => sec < 3600 ? Math.max(1, Math.round(sec / 60)) + ' мин' : sec < 172800 ? Math.round(sec / 3600) + ' ч' : Math.round(sec / 86400) + ' дн';
R.overview = async () => {
  const [s, models, pay, search, code, br, pays, cry, mon] = await Promise.all([api('/api/admin/stats'), api('/api/admin/models'), api('/api/admin/pay'), api('/api/admin/search').catch(() => ({})), api('/api/admin/code').catch(() => ({})), api('/api/admin/browser').catch(() => ({})), api('/api/admin/payments'), api('/api/admin/crypto').catch(() => ({})), api('/api/admin/monitor').catch(() => null)]);
  const t = s.days[s.days.length - 1], max = Math.max(1, ...s.days.map((d) => d.m)), def = models.find((m) => m.def);
  const week = s.days.slice(-7).reduce((n, d) => n + d.m, 0);
  const row = (href, ok, title, note) => `<a href="${href}"><span class="dot ${ok}"></span><b>${title}</b><span>${note}</span></a>`;
  $('view').innerHTML = `<div class="grid g4" style="margin-bottom:16px">
      <div class="stat"><small>Пользователи</small><b>${s.users}</b><span>${S.plans.map((p) => `${esc(p.name)} ${s.plans[p.id] || 0}`).join(' · ')}</span></div>
      <div class="stat"><small>Сообщений сегодня</small><b>${t.m}</b><span>${t.users} ${plural(t.users, 'активный', 'активных', 'активных')} · ${week} за неделю</span></div>
      <div class="stat"><small>Выручка за 30 дней</small><b>${rub(s.revenue30)}</b><span>всего ${rub(s.revenue)}</span></div>
      <div class="stat"><small>Оплат</small><b>${s.paid}</b><span>${s.paid ? 'средний чек ' + rub(Math.round(s.revenue / s.paid)) : 'пока не было'}</span></div></div>
    <div class="grid" style="grid-template-columns:3fr 2fr;align-items:start">
      <div class="card"><h2>Сообщения за 14 дней</h2><div class="sub">Наведите на столбец, чтобы увидеть детали</div>
        <div class="chart">${s.days.map((d, i) => `<div class="col" title="${dt(d.d, { day: 'numeric', month: 'long' })}: ${d.m} сообщ. · ${d.users} польз. · ${d.c} Python · ${d.s} сайтов"><i style="height:${Math.max(2, d.m / max * 100)}%"></i><em>${i % 2 === (s.days.length - 1) % 2 ? new Date(d.d).getDate() : ''}</em></div>`).join('')}</div></div>
      <div class="card"><h2>Состояние</h2><div class="sub">Что подключено</div><div class="state">
        ${row('#models', models.length ? 'ok' : 'bad', 'Модели', models.length ? `${models.length} · по умолчанию ${esc(def ? def.name : '—')}` : 'не подключены')}
        ${row('#plans', pay.ready ? 'ok' : 'warn', 'Оплата Platega', pay.ready ? 'подключена' : 'не настроена')}
        ${row('#plans', cry.ready ? 'ok' : 'warn', 'Оплата Crypto Bot', cry.ready ? 'подключена' + (cry.testnet ? ' (тестовая сеть)' : '') : 'не настроена')}
        ${row('#tools', search.provider && search.provider !== 'off' ? 'ok' : 'warn', 'Поиск в интернете', esc(search.providers?.[search.provider] || 'выключен'))}
        ${row('#tools', code.ok && code.enabled ? 'ok' : 'warn', 'Python', code.ok ? (code.enabled ? (code.mode === 'local' ? 'local' : 'Docker') : 'выключен') : 'недоступен')}
        ${row('#tools', br.installed && br.browser ? 'ok' : 'warn', 'Браузер', br.installed ? (br.browser ? 'включён' : 'выключен') : 'не установлен')}
        ${mon ? row('#overview', mon.stats.errors24h ? 'bad' : 'ok', 'Сервер', `работает ${upt(mon.stats.uptime)} · ${mon.stats.rssMb} МБ памяти · ошибок за сутки: ${mon.stats.errors24h}${mon.stats.alerts ? '' : ' · оповещения не настроены'}`) : ''}
      </div></div></div>
    ${mon && mon.errors.length ? `<div class="card" style="margin-bottom:16px"><h2>Ошибки сервера</h2><div class="sub">Последние ${mon.errors.length}. Оповещения в Telegram: ALERT_TELEGRAM_TOKEN и ALERT_TELEGRAM_CHAT (DEPLOY.md)</div>
      <div class="errs">${mon.errors.slice(0, 15).map((e) => `<details><summary><b>${dt(e.at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</b> ${esc(e.where)} — ${esc(e.msg)}${e.n > 1 ? ` <span class="dim">×${e.n}</span>` : ''}</summary><code>${esc(e.stack || '')}</code></details>`).join('')}</div></div>` : ''}
    <div class="card"><div class="chead"><div><h2>Последние платежи</h2></div><a class="btn sm" href="#payments">Все платежи</a></div>${payTable(pays.slice(0, 5))}</div>`;
};

/* ---------- модели ---------- */
const PRESETS = [
  { t: 'Kimi K3', s: 'OpenRouter · картинки', name: 'Kimi K3', modelId: 'moonshotai/kimi-k3', baseUrl: 'https://openrouter.ai/api/v1', vision: true },
  { t: 'Kimi K2.5', s: 'OpenRouter · дешевле в 4 раза', name: 'Kimi K2.5', modelId: 'moonshotai/kimi-k2.5', baseUrl: 'https://openrouter.ai/api/v1', vision: true },
  { t: 'Своя модель', s: 'Любой OpenAI-совместимый API', name: '', modelId: '', baseUrl: '', vision: false },
];
const chips = (sel, attr) => S.plans.map((p) => `<button type="button" class="chip${sel.includes(p.id) ? ' on' : ''}" ${attr}="${p.id}"><svg><use href="#i-check"/></svg>${esc(p.name)}</button>`).join('');
R.models = async () => {
  const list = await api('/api/admin/models');
  $('vact').innerHTML = '<button class="btn" id="impOpen"><svg><use href="#i-layers"/></svg>Импорт от провайдера</button><button class="btn" id="chkAll"><svg><use href="#i-bolt"/></svg>Проверить все</button><button class="btn pri" id="addOpen"><svg><use href="#i-plus"/></svg>Добавить модель</button><label class="check" style="margin:0 0 0 6px" title="Ключи и запросы из Cursor, Codex, Claude Code"><input type="checkbox" id="apiOpen"> API для пользователей</label>';
  api('/api/admin/api').then((x) => { const c = $('apiOpen'); if (c) { c.checked = x.open; c.onchange = (e) => post('/api/admin/api', { open: e.target.checked }).then(() => toast(e.target.checked ? 'API включён' : 'API выключен — запросы по ключам отклоняются')).catch(fail()); } }).catch(() => {});
  $('view').innerHTML = `<div class="card" id="impCard" hidden></div><div id="mlist">${list.length ? list.map((m, i) => `<div class="model${m.def ? ' def' : ''}" data-id="${m.id}">
      <div class="mtop"><div class="nm"><b>${esc(m.name)}${m.def ? '<span class="badge ok"><svg style="width:11px;height:11px"><use href="#i-star"/></svg>По умолчанию</span>' : ''}${m.vision ? '<span class="badge">картинки</span>' : ''}${m.prompt ? `<span class="badge" title="${esc(m.prompt.slice(0, 300))}">свой промт${m.promptMode === 'replace' ? ' · замена' : ''}</span>` : ''}</b><small>API: <code style="font-family:var(--p-font-mono,monospace)">${esc(m.slug || '')}</code> · ${m.agent === true ? 'готова для агентов' : m.agent === false ? 'без вызова инструментов — Claude Code и Codex с ней не заработают' : 'инструменты ещё не проверены'}${m.native ? ' · прямой протокол ' + (m.native === 'anthropic' ? 'Anthropic' : 'Responses') : ''}<br>Провайдер: ${esc(m.modelId)} · ${esc(host(m.baseUrl))} · ключ ${esc(m.apiKey)}<br><span class="mstx na" data-mst="${m.id}">статус: загрузка…</span></small></div>
        ${m.def ? '' : '<button class="btn sm" data-mdef>Сделать по умолчанию</button>'}<button class="btn sm" data-mtest>Проверить</button><button class="btn sm" data-medit>Изменить</button><span class="mord"><button class="ib" data-mup title="Выше" aria-label="Выше"${i ? '' : ' disabled'}>↑</button><button class="ib" data-mdown title="Ниже" aria-label="Ниже"${i < list.length - 1 ? '' : ' disabled'}>↓</button></span><button class="ib del" data-mdel title="Удалить модель" aria-label="Удалить модель"><svg><use href="#i-trash"/></svg></button></div>
      <div class="mrow2"><span class="lbl">Доступна в тарифах:</span><div class="chips">${chips(m.plans, 'data-mplan')}</div>
        <label class="weight"><span class="lbl">Стоимость запроса</span><input type="number" min="0.1" max="50" step="0.1" value="${m.weight}" data-mweight title="Сколько сообщений лимита списывает один ответ (мин. 0.1)"></label>
        <label class="check" style="margin:0"><input type="checkbox" data-mvision${m.vision ? ' checked' : ''}> понимает картинки</label></div>
      <form class="medit" data-meditf hidden autocomplete="off"><div class="grid g2" style="gap:0 14px">
        <label class="field"><span>Название на сайте</span><input name="name" value="${esc(m.name)}" required maxlength="60"></label>
        <label class="field"><span>ID модели у провайдера</span><input name="modelId" value="${esc(m.modelId)}" required></label>
        <label class="field"><span>URL API</span><input name="baseUrl" value="${esc(m.baseUrl)}" required></label>
        <label class="field"><span>API-ключ</span><input name="apiKey" type="password" placeholder="${esc(m.apiKey)} — оставьте пустым, чтобы не менять"></label></div>
        <div class="grid g2" style="gap:0 14px"><label class="field"><span>Прямой протокол для API <i class="opt">— необязательно</i></span><select name="native"><option value="">Нет — переводить из OpenAI-формата</option><option value="anthropic"${m.native === 'anthropic' ? ' selected' : ''}>Anthropic Messages — для Claude Code</option><option value="responses"${m.native === 'responses' ? ' selected' : ''}>OpenAI Responses — для Codex</option></select><small>Если провайдер сам понимает этот протокол, запросы идут без перевода: работают кэш промпта и размышления</small></label>
        <label class="field"><span>URL прямого протокола</span><input name="nativeUrl" value="${esc(m.nativeUrl || '')}" placeholder="https://api.anthropic.com"><small>Пусто — тот же, что «URL API»</small></label></div>
        <div class="field mprompt"><span>Системный промт <i class="opt">— необязательно</i></span><textarea name="prompt" rows="4"  placeholder="Например: Ты — опытный юрист. Отвечай кратко, ссылайся на статьи закона.">${esc(m.prompt)}</textarea>
        <div class="pm-row"><label class="radio"><input type="radio" name="promptMode" value="add"${m.promptMode !== 'replace' ? ' checked' : ''}> Добавить к стандартному промту Premier</label><label class="radio"><input type="radio" name="promptMode" value="replace"${m.promptMode === 'replace' ? ' checked' : ''}> Заменить полностью</label><span class="pm-len" data-plen></span></div>
        <small>Пользователи промт не видят. «Добавить» — сохраняются правила Premier (Markdown, сайты, инструменты) и ваши инструкции важнее их.</small></div>
        <div class="ptest"><input class="inp" data-pask placeholder="Вопрос для проверки промта, например: Кто ты?"><button type="button" class="btn" data-ptest>Проверить промт</button></div><div class="preply" data-preply hidden></div>
        <div class="btns"><button type="button" class="btn" data-mecancel>Отмена</button><button class="btn pri">Сохранить</button></div></form>
      <div class="msg" data-mmsg style="margin:8px 0 0;min-height:0"></div></div>`).join('') : '<div class="empty">Моделей пока нет — добавьте первую</div>'}</div>
    <div class="card" id="addCard"${list.length ? ' hidden' : ''}><h2>Новая модель</h2><div class="sub">Выберите заготовку или заполните вручную</div>
      <div class="presets">${PRESETS.map((p, i) => `<button type="button" class="preset" data-preset="${i}"><b>${p.t}</b><small>${p.s}</small></button>`).join('')}</div>
      <form id="addF" autocomplete="off"><div class="grid g2" style="gap:0 14px">
        <label class="field"><span>Название на сайте</span><input name="name" required placeholder="Kimi K3"></label>
        <label class="field"><span>ID модели у провайдера</span><input name="modelId" required placeholder="moonshotai/kimi-k3"></label>
        <label class="field"><span>URL API</span><input name="baseUrl" required placeholder="https://openrouter.ai/api/v1"><small>/chat/completions добавится сам</small></label>
        <label class="field"><span>API-ключ</span><input name="apiKey" type="password" required placeholder="sk-..."></label></div>
        <div class="field"><span>Доступна в тарифах</span><div class="chips" id="addPlans">${chips(S.plans.map((p) => p.id), 'data-aplan')}</div></div>
        <div class="grid g2" style="gap:0 14px"><label class="field"><span>Стоимость запроса</span><input name="weight" type="number" min="0.1" max="50" step="0.1" value="1"><small>Сколько сообщений лимита списывает один ответ (мин. 0.1)</small></label><div></div></div>
        <div class="field mprompt"><span>Системный промт <i class="opt">— необязательно</i></span><textarea name="prompt" rows="4"  placeholder="Например: Ты — опытный юрист. Отвечай кратко, ссылайся на статьи закона."></textarea>
        <div class="pm-row"><label class="radio"><input type="radio" name="promptMode" value="add" checked> Добавить к стандартному промту Premier</label><label class="radio"><input type="radio" name="promptMode" value="replace"> Заменить полностью</label><span class="pm-len" data-plen></span></div>
        <small>Пользователи промт не видят. «Добавить» — сохраняются правила Premier (Markdown, сайты, инструменты) и ваши инструкции важнее их.</small></div>
        <label class="check"><input type="checkbox" name="vision"> Модель понимает картинки</label>
        <label class="check"><input type="checkbox" name="def"${list.length ? '' : ' checked'}> Сделать моделью по умолчанию</label>
        <div class="msg" id="amsg"></div>
        <div class="btns"><button type="button" class="btn" id="addCancel"${list.length ? '' : ' hidden'}>Отмена</button><button type="button" class="btn" id="addTest">Проверить</button><button class="btn pri" id="addSave">Подключить</button></div></form></div>`;
  const f = $('addF'), data = () => ({ ...Object.fromEntries(new FormData(f)), vision: f.vision.checked, def: f.def.checked, plans: [...document.querySelectorAll('#addPlans .chip.on')].map((c) => c.dataset.aplan) });
  $('impOpen').onclick = openImport;
  $('addOpen').onclick = () => { $('impCard').hidden = true; $('addCard').hidden = false; $('addCard').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  $('addCancel').onclick = () => { $('addCard').hidden = true; };
  $('addTest').onclick = async () => { if (!f.reportValidity()) return; say('amsg', 'Проверяю…'); try { const j = await post('/api/admin/test', data()); j.ok ? say('amsg', 'Работает. Ответ: ' + (j.reply || '(пусто)').slice(0, 80), 'ok') : say('amsg', j.error, 'err'); } catch (e) { fail('amsg')(e); } };
  f.onsubmit = async (e) => { e.preventDefault(); const d = data(); if (!d.plans.length) return say('amsg', 'Выберите хотя бы один тариф', 'err'); $('addSave').disabled = true; try { await post('/api/admin/models', d); toast('Модель подключена'); R.models(); } catch (err) { fail('amsg')(err); $('addSave').disabled = false; } };
  const mstFmt = (v) => (v == null ? '—' : v >= 1000 ? (v / 1000).toFixed(1).replace('.0', '').replace('.', ',') + 'с' : v + 'мс');
  const mstTm = (v) => (v ? new Date(v).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '');
  const paintStatus = (st) => { if (!Array.isArray(st)) return; document.querySelectorAll('[data-mst]').forEach((el) => { const x = st.find((y) => y.id === el.dataset.mst); const p = x && x.probe; if (!p) { el.className = 'mstx na'; el.textContent = 'статус: данных нет (первый пинг — в течение 5 минут)'; } else if (p.ok) { el.className = 'mstx ok'; el.textContent = 'статус: работает · пинг ' + mstFmt(p.ms) + ' · ' + mstTm(p.at); } else { el.className = 'mstx bad'; el.textContent = 'статус: ' + (p.err || 'ошибка') + ' · ' + mstTm(p.at); } }); };
  api('/api/models/status').then(paintStatus).catch(() => {});
  $('chkAll').onclick = async () => {
    const btn = $('chkAll'); btn.disabled = true;
    document.querySelectorAll('[data-mst]').forEach((el) => { el.className = 'mstx na'; el.textContent = 'статус: проверяю…'; });
    try {
      await post('/api/admin/models/check', {});
      toast('Запускаю проверку всех моделей…');
      const t0 = Date.now();
      const poll = setInterval(async () => {
        try {
          const st = await api('/api/models/status');
          paintStatus(st);
          const fresh = st.filter((x) => x.probe && x.probe.at >= t0 - 10000).length;
          if (fresh >= st.length || Date.now() - t0 > 600000) {
            clearInterval(poll); btn.disabled = false;
            const okN = st.filter((x) => x.probe && x.probe.ok && x.probe.at >= t0 - 10000).length;
            toast(okN === st.length ? 'Проверка готова: работают все ' + st.length + ' моделей' : 'Проверка готова: работает ' + okN + ' из ' + st.length);
          }
        } catch {}
      }, 2500);
    } catch (e) { btn.disabled = false; toast(e.message || 'Не удалось запустить проверку'); }
  };
  $('view').onclick = async (e) => {
    const pr = e.target.closest('[data-preset]'); if (pr) { const p = PRESETS[+pr.dataset.preset]; for (const k of ['name', 'modelId', 'baseUrl']) f[k].value = p[k]; f.vision.checked = p.vision; f.apiKey.focus(); return; }
    const ac = e.target.closest('[data-aplan]'); if (ac) { ac.classList.toggle('on'); return; }
    const card = e.target.closest('.model'); if (!card) return; const id = card.dataset.id, msg = card.querySelector('[data-mmsg]');
    const ch = e.target.closest('[data-mplan]');
    if (ch) { ch.classList.toggle('on'); const plans = [...card.querySelectorAll('[data-mplan].on')].map((c) => c.dataset.mplan); if (!plans.length) { ch.classList.add('on'); return toast('Модель должна входить хотя бы в один тариф'); } post('/api/admin/models/' + id, { plans }, 'PATCH').then(() => toast('Тарифы модели сохранены')).catch(fail()); return; }
    if (e.target.closest('[data-mdef]')) { post('/api/admin/models/' + id, { def: true }, 'PATCH').then(() => { toast('Модель по умолчанию изменена'); R.models(); }).catch(fail()); return; }
    if (e.target.closest('[data-mtest]')) { msg.className = 'msg'; msg.textContent = 'Проверяю…'; try { const j = await post('/api/admin/test', { id }); msg.className = 'msg ' + (j.ok ? 'ok' : 'err'); msg.textContent = j.ok ? 'Работает. Ответ: ' + (j.reply || '(пусто)').slice(0, 80) : j.error; } catch (err) { msg.className = 'msg err'; msg.textContent = err.message; } return; }
    if (e.target.closest('[data-medit]')) { const f2 = card.querySelector('[data-meditf]'); f2.hidden = !f2.hidden; if (!f2.hidden) f2.name.focus(); return; }
    if (e.target.closest('[data-mecancel]')) { card.querySelector('[data-meditf]').hidden = true; return; }
    const mv = e.target.closest('[data-mup],[data-mdown]');
    if (mv) { const ids = list.map((x) => x.id), i = ids.indexOf(id), j = i + (mv.matches('[data-mup]') ? -1 : 1); if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; post('/api/admin/models/order', { ids }).then(() => R.models()).catch(fail()); return; }
    if (e.target.closest('[data-mdel]')) { if (confirm('Удалить эту модель? Пользователи перестанут её видеть.')) api('/api/admin/models/' + id, { method: 'DELETE' }).then(() => { toast('Модель удалена'); R.models(); }).catch(fail()); }
  };
  $('view').onchange = (e) => {
    const card = e.target.closest('.model'); if (!card) return; const id = card.dataset.id;
    if (e.target.matches('[data-mweight]')) post('/api/admin/models/' + id, { weight: +e.target.value }, 'PATCH').then(() => toast('Сохранено')).catch(fail());
    if (e.target.matches('[data-mvision]')) post('/api/admin/models/' + id, { vision: e.target.checked }, 'PATCH').then(() => { toast('Сохранено'); R.models(); }).catch(fail());
  };
};

// счётчик длины промта и проверка промта
document.addEventListener('input', (e) => { if (!e.target.matches('.mprompt textarea')) return; const n = e.target.value.length, l = e.target.closest('.mprompt').querySelector('[data-plen]'); if (l) l.textContent = n ? n.toLocaleString('ru-RU') + ' симв.' : ''; });
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-ptest]'); if (!b) return;
  const f = b.closest('form'), card = b.closest('.model'), out = f.querySelector('[data-preply]'), ask = f.querySelector('[data-pask]').value.trim() || 'Кто ты и что умеешь? Ответь в двух предложениях.';
  out.hidden = false; out.className = 'preply'; out.textContent = 'Спрашиваю модель…'; b.disabled = true;
  try { const j = await post('/api/admin/test', { id: card.dataset.id, ask, prompt: f.prompt.value, promptMode: f.promptMode.value });
    out.className = 'preply ' + (j.ok ? 'ok' : 'err'); out.textContent = j.ok ? (j.reply || '(пустой ответ)') : j.error; }
  catch (err) { out.className = 'preply err'; out.textContent = err.message; } b.disabled = false;
});
// редактирование модели
document.addEventListener('submit', async (e) => {
  const f = e.target.closest('[data-meditf]'); if (!f) return; e.preventDefault();
  const card = f.closest('.model'), msg = card.querySelector('[data-mmsg]'), d = Object.fromEntries(new FormData(f));
  try { await post('/api/admin/models/' + card.dataset.id, d, 'PATCH'); toast('Модель сохранена'); R.models(); } catch (err) { msg.className = 'msg err'; msg.textContent = err.message; }
});

/* ---------- импорт моделей от провайдера ---------- */
const PROVIDERS = [
  ['OpenRouter', 'https://openrouter.ai/api/v1'], ['OpenAI', 'https://api.openai.com/v1'], ['DeepSeek', 'https://api.deepseek.com/v1'],
  ['Groq', 'https://api.groq.com/openai/v1'], ['Together', 'https://api.together.xyz/v1'], ['Mistral', 'https://api.mistral.ai/v1'],
  ['Google Gemini', 'https://generativelanguage.googleapis.com/v1beta/openai'], ['xAI', 'https://api.x.ai/v1'], ['Ollama (свой сервер)', 'http://127.0.0.1:11434/v1'],
];
const IMP = { list: [], sel: new Map(), q: '', f: 'chat', src: null };
async function openImport() {
  const c = $('impCard'); c.hidden = false; $('addCard').hidden = true;
  const keys = await api('/api/admin/models/keys').catch(() => []);
  c.innerHTML = `<div class="chead"><div><h2>Импорт моделей от провайдера</h2><div class="sub">Загрузите список по API-ключу, отметьте нужные модели и добавьте их разом</div></div><button type="button" class="ib" id="impClose" aria-label="Закрыть" title="Закрыть"><svg><use href="#i-x"/></svg></button></div>
    <div class="presets">${PROVIDERS.map(([n, u]) => `<button type="button" class="preset" data-prov="${esc(u)}"><b>${esc(n)}</b><small>${esc(host(u))}</small></button>`).join('')}</div>
    <form id="impF" autocomplete="off"><div class="grid g2" style="gap:0 14px">
      <label class="field"><span>URL API</span><input id="impUrl" required placeholder="https://openrouter.ai/api/v1"></label>
      <label class="field"><span>API-ключ</span><input id="impKey" type="password" placeholder="sk-..."></label></div>
      ${keys.length ? `<label class="field"><span>…или ключ уже подключённой модели</span><select id="impFrom"><option value="">— ввести ключ вручную —</option>${keys.map((k) => `<option value="${k.id}" data-url="${esc(k.baseUrl)}">${esc(k.host)} · ${esc(k.key)}</option>`).join('')}</select></label>` : ''}
      <div class="msg" id="impMsg"></div><div class="btns"><button class="btn pri" id="impLoad">Загрузить модели</button></div></form>
    <div id="impRes"></div>`;
  $('impClose').onclick = () => { c.hidden = true; };
  c.querySelectorAll('[data-prov]').forEach((b) => { b.onclick = () => { $('impUrl').value = b.dataset.prov; if ($('impFrom')) { const o = [...$('impFrom').options].find((x) => x.dataset.url && x.dataset.url.replace(/\/+$/, '') === b.dataset.prov); $('impFrom').value = o ? o.value : ''; } $('impKey').focus(); }; });
  if ($('impFrom')) $('impFrom').onchange = () => { const o = $('impFrom').selectedOptions[0]; if (o.dataset.url) $('impUrl').value = o.dataset.url; };
  $('impF').onsubmit = async (e) => {
    e.preventDefault(); const from = $('impFrom')?.value || '', key = $('impKey').value.trim();
    if (!key && !from) return say('impMsg', 'Введите API-ключ или выберите ключ подключённой модели', 'err');
    say('impMsg', 'Загружаю список моделей…'); $('impLoad').disabled = true;
    try { const j = await post('/api/admin/models/fetch', { baseUrl: $('impUrl').value, apiKey: key, fromId: key ? '' : from });
      IMP.list = j.models; IMP.sel = new Map(); IMP.q = ''; IMP.f = j.models.some((x) => x.chat) ? 'chat' : 'all'; IMP.src = { baseUrl: j.baseUrl, apiKey: key, fromId: key ? '' : from };
      say('impMsg', `Найдено моделей: ${j.models.length}`, 'ok'); renderImp(); }
    catch (err) { fail('impMsg')(err); } $('impLoad').disabled = false;
  };
  c.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
const fmtCtx = (n) => n ? (n >= 1e6 ? (n / 1e6).toFixed(n % 1e6 ? 1 : 0) + 'M' : Math.round(n / 1000) + 'K') : '';
const fmtPrice = (x) => x.free ? 'бесплатно' : x.pin != null ? `$${x.pin} / $${x.pout ?? '?'} за 1M` : '';
function impVisible() {
  const q = IMP.q.toLowerCase();
  return IMP.list.filter((x) => (IMP.f === 'all' || (IMP.f === 'chat' && x.chat) || (IMP.f === 'vision' && x.chat && x.vision) || (IMP.f === 'free' && x.free)) && (!q || x.id.toLowerCase().includes(q) || x.name.toLowerCase().includes(q)));
}
function renderImp() {
  const vis = impVisible(), shown = vis.slice(0, 400), n = IMP.sel.size;
  $('impRes').innerHTML = `<div class="imp-bar"><input class="inp" id="impQ" placeholder="Поиск: kimi, gpt, claude…" value="${esc(IMP.q)}">
      <select class="inp" id="impFl" style="width:auto"><option value="chat"${IMP.f === 'chat' ? ' selected' : ''}>Только чат-модели</option><option value="vision"${IMP.f === 'vision' ? ' selected' : ''}>Понимают картинки</option><option value="free"${IMP.f === 'free' ? ' selected' : ''}>Бесплатные</option><option value="all"${IMP.f === 'all' ? ' selected' : ''}>Все</option></select>
      <button type="button" class="btn sm" id="impAll">Отметить видимые</button><button type="button" class="btn sm" id="impNone"${n ? '' : ' disabled'}>Снять все</button></div>
    <div class="imp-list">${shown.length ? shown.map((x) => { const s = IMP.sel.get(x.id); return `<div class="imp-row${s ? ' on' : ''}${x.added ? ' added' : ''}" data-iid="${esc(x.id)}">
      <label class="imp-ck"><input type="checkbox"${s ? ' checked' : ''}${x.added ? ' disabled' : ''}></label>
      <div class="imp-main"><div class="imp-t">${s ? `<input class="imp-name" value="${esc(s.name)}" maxlength="60" title="Название на сайте">` : `<b>${esc(x.name)}</b>`}${x.added ? '<span class="badge ok">уже добавлена</span>' : ''}${x.vision ? '<span class="badge">картинки</span>' : ''}${x.free ? '<span class="badge warn">free</span>' : ''}</div>
        <small>${esc(x.id)}${x.ctx ? ' · ' + fmtCtx(x.ctx) + ' контекст' : ''}${fmtPrice(x) && !x.free ? ' · ' + fmtPrice(x) : ''}</small></div></div>`; }).join('') : '<div class="empty" style="padding:24px">Ничего не найдено</div>'}
      ${vis.length > shown.length ? `<div class="sub" style="padding:10px 4px">Показаны первые 400 из ${vis.length} — уточните поиск</div>` : ''}</div>
    ${n ? `<div class="imp-foot"><div class="field" style="margin:0"><span>Доступны в тарифах</span><div class="chips" id="impPlans">${chips(S.plans.map((p) => p.id), 'data-iplan')}</div></div>
      <label class="field" style="margin:0;width:150px"><span>Стоимость запроса</span><input id="impW" type="number" min="0.1" max="50" step="0.1" value="1"></label>
      <button type="button" class="btn pri" id="impAdd">Добавить выбранные (${n})</button></div><div class="msg" id="impAddMsg"></div>` : ''}`;
  const q = $('impQ'); q.oninput = () => { IMP.q = q.value; const pos = q.selectionStart; renderImp(); const nq = $('impQ'); nq.focus(); nq.setSelectionRange(pos, pos); };
  $('impFl').onchange = () => { IMP.f = $('impFl').value; renderImp(); };
  $('impAll').onclick = () => { for (const x of impVisible().slice(0, 400)) if (!x.added && !IMP.sel.has(x.id)) IMP.sel.set(x.id, { name: x.name, vision: x.vision }); renderImp(); };
  $('impNone').onclick = () => { IMP.sel.clear(); renderImp(); };
  $('impRes').querySelectorAll('.imp-row').forEach((r) => {
    const id = r.dataset.iid, x = IMP.list.find((y) => y.id === id);
    r.querySelector('input[type=checkbox]').onchange = (e) => { e.target.checked ? IMP.sel.set(id, { name: x.name, vision: x.vision }) : IMP.sel.delete(id); renderImp(); };
    const nm = r.querySelector('.imp-name'); if (nm) nm.oninput = () => { IMP.sel.get(id).name = nm.value; };
  });
  $('impRes').querySelectorAll('[data-iplan]').forEach((c) => { c.onclick = () => c.classList.toggle('on'); });
  if ($('impAdd')) $('impAdd').onclick = async () => {
    const plans = [...document.querySelectorAll('#impPlans .chip.on')].map((c) => c.dataset.iplan); if (!plans.length) return say('impAddMsg', 'Выберите хотя бы один тариф', 'err');
    $('impAdd').disabled = true;
    try { const j = await post('/api/admin/models/bulk', { ...IMP.src, plans, weight: +$('impW').value || 1, models: [...IMP.sel].map(([modelId, v]) => ({ modelId, name: v.name.trim() || modelId, vision: v.vision })) });
      toast(`Добавлено моделей: ${j.added}${j.skipped ? `, пропущено (уже были): ${j.skipped}` : ''}`); IMP.sel.clear(); await R.models(); }
    catch (err) { fail('impAddMsg')(err); $('impAdd').disabled = false; }
  };
}

/* ---------- тарифы и оплата ---------- */
R.plans = async () => {
  const [c, models, pay, cr] = await Promise.all([api('/api/admin/plans'), api('/api/admin/models'), api('/api/admin/pay'), api('/api/admin/crypto')]);
  S.plans = c.plans; const v = (x) => x == null ? '' : x;
  const num = (p, k, label, ph = '∞', dis = false) => `<label class="field"><span>${label}</span><input type="number" min="0" data-k="${k}" value="${v(p[k])}" placeholder="${ph}"${dis ? ' disabled' : ''}></label>`;
  $('view').innerHTML = `<form id="plansF" autocomplete="off"><div class="grid g3">${c.plans.map((p) => {
      const mods = models.filter((m) => m.plans.includes(p.id)).map((m) => esc(m.name) + (m.def ? ' ★' : ''));
      return `<div class="plan${p.tier === 1 ? ' hot' : ''}" data-pid="${p.id}"><h3>${planBadge(p.id)}<span style="flex:1"></span></h3>
        <div class="grid g2" style="gap:0 12px"><label class="field"><span>Название</span><input data-k="name" value="${esc(p.name)}" maxlength="30"></label>${num(p, 'price', 'Цена, ₽', '0', p.id === 'free')}</div>
        <label class="field"><span>Описание</span><input data-k="desc" value="${esc(p.desc || '')}" maxlength="120"></label>
        <div class="grid g2" style="gap:0 12px">${num(p, 'days', 'Срок, дней', '—', p.id === 'free')}${num(p, 'msgs', 'Сообщений в день')}${num(p, 'code', 'Python в день')}${num(p, 'sites', 'Сайтов в день')}${num(p, 'images', 'Картинок в день')}${num(p, 'videos', 'Видео в день')}</div>
        <div class="mods"><b style="color:var(--muted);font-weight:500">Модели:</b> ${mods.length ? mods.join(', ') : 'нет — выберите во вкладке «Модели»'}</div></div>`; }).join('')}</div>
    <div class="card" style="margin-top:16px"><h2>Общие настройки</h2><div class="sub">Пустое поле лимита = без ограничений. Лимиты считаются за сутки по Москве.</div>
      <div class="grid g3" style="gap:0 14px">
        <label class="field"><span>Пробный период, дней</span><input name="trialDays" type="number" min="0" max="90" value="${c.trialDays}"><small>Pro для новых пользователей; 0 — выключен</small></label>
        <label class="field"><span>Антиспам: сообщений за 5 минут</span><input name="burst" type="number" min="0" value="${c.burst}"><small>0 — без проверки</small></label>
        <label class="field"><span>Потолок «безлимита» в день</span><input name="fair" type="number" min="0" value="${v(c.fair)}" placeholder="∞"><small>Защита от злоупотреблений</small></label></div>
      <div class="msg" id="plmsg"></div><div class="btns"><button class="btn pri">Сохранить тарифы</button></div></div></form>
    <div class="card"><div class="chead"><div><h2>Оплата через Platega</h2><div class="sub">Карты и СБП. Ключи — в личном кабинете Platega.</div></div><span class="badge ${pay.ready ? 'ok' : 'warn'}">${pay.ready ? 'Подключено' : 'Не подключено'}</span></div>
      <form id="payF" autocomplete="off"><div class="grid g2" style="gap:0 14px">
        <label class="field"><span>Merchant ID</span><input id="payMid" value="${esc(pay.merchant)}" placeholder="из личного кабинета"${pay.env ? ' disabled' : ''}></label>
        <label class="field"><span>API-секрет</span><input id="paySec" type="password" placeholder="${pay.secret ? esc(pay.secret) + ' (сохранён)' : 'X-Secret'}"${pay.env ? ' disabled' : ''}></label></div>
        <label class="field"><span>Callback URL — вставьте в Platega: Настройки → Callback URLs</span><div class="copyrow"><input class="inp" id="payCb" readonly value="${esc(pay.callback)}"><button type="button" class="btn" id="cbCopy">Копировать</button></div></label>
        ${pay.env ? '<div class="msg">Ключи заданы переменными окружения на сервере</div>' : ''}
        <div class="msg" id="paymsg"></div><div class="btns"><button class="btn pri"${pay.env ? ' disabled' : ''}>Сохранить</button></div></form></div>
    <div class="card"><div class="chead"><div><h2>Оплата через Crypto Bot</h2><div class="sub">USDT, TON, BTC и другие монеты в Telegram. Цена в рублях пересчитывается по курсу Crypto Bot</div></div><span class="badge ${cr.ready ? 'ok' : 'warn'}">${cr.ready ? 'Подключено' + (cr.testnet ? ' · тест' : '') : 'Не подключено'}</span></div>
      <form id="cryF" autocomplete="off">
        <label class="field"><span>API-токен — @CryptoBot → Crypto Pay → My Apps → ваше приложение → API Token</span><input id="cryTok" type="password" placeholder="${cr.token ? esc(cr.token) + ' (сохранён)' : '12345:AAbbCCddEE…'}"${cr.env ? ' disabled' : ''}></label>
        <label class="field"><span>Принимаемые монеты</span><input id="cryAs" value="${esc(cr.assets)}" placeholder="USDT,TON,BTC,ETH,LTC,BNB,TRX,USDC"><small>Через запятую. Пользователь выберет монету при оплате</small></label>
        <label class="field"><span>Webhook URL — вставьте в @CryptoBot: My Apps → приложение → Webhooks → Enable Webhooks</span><div class="copyrow"><input class="inp" id="cryWh" readonly value="${esc(cr.webhook)}"><button type="button" class="btn" id="cryCopy">Копировать</button></div><small>Без вебхука оплата тоже засчитается — сайт проверяет счёт сам, пока пользователь ждёт. Вебхук нужен, если он закроет вкладку</small></label>
        <label class="check"><input type="checkbox" id="cryTest"${cr.testnet ? ' checked' : ''}${cr.env ? ' disabled' : ''}> Тестовая сеть (@CryptoTestnetBot) — для проверки без реальных денег</label>
        ${cr.env ? '<div class="msg">Токен задан переменной окружения CRYPTOPAY_TOKEN на сервере</div>' : ''}
        <div class="msg" id="crymsg"></div><div class="btns">${cr.token && !cr.env ? '<button type="button" class="btn" id="cryDel">Отключить</button>' : ''}<button type="button" class="btn" id="cryChk"><svg><use href="#i-bolt"/></svg>Проверить</button><button class="btn pri">Сохранить</button></div></form></div>`;
  $('plansF').onsubmit = async (e) => {
    e.preventDefault(); const f = e.target;
    const plans = [...f.querySelectorAll('[data-pid]')].map((el) => { const o = { id: el.dataset.pid }; el.querySelectorAll('[data-k]').forEach((i) => { o[i.dataset.k] = ['name', 'desc'].includes(i.dataset.k) ? i.value : i.value === '' ? null : +i.value; }); return o; });
    try { const r = await post('/api/admin/plans', { plans, trialDays: +f.trialDays.value || 0, burst: +f.burst.value || 0, fair: f.fair.value === '' ? null : +f.fair.value }); S.plans = r.plans; say('plmsg', 'Сохранено — цены уже обновились в чате и на лендинге', 'ok'); } catch (err) { fail('plmsg')(err); }
  };
  $('cbCopy').onclick = (e) => { navigator.clipboard?.writeText($('payCb').value); e.target.textContent = 'Скопировано'; setTimeout(() => (e.target.textContent = 'Копировать'), 1400); };
  const crySave = () => post('/api/admin/crypto', { token: $('cryTok').value, assets: $('cryAs').value, ...(cr.env ? {} : { testnet: $('cryTest').checked }) });
  $('cryCopy').onclick = (e) => { navigator.clipboard?.writeText($('cryWh').value); e.target.textContent = 'Скопировано'; setTimeout(() => (e.target.textContent = 'Копировать'), 1400); };
  $('cryF').onsubmit = async (e) => { e.preventDefault(); try { await crySave(); toast('Crypto Bot сохранён'); R.plans(); } catch (err) { fail('crymsg')(err); } };
  $('cryChk').onclick = async () => { say('crymsg', 'Проверяю токен…'); try { await crySave(); $('cryTok').value = ''; const j = await post('/api/admin/crypto/test'); j.ok ? say('crymsg', `Работает: приложение «${j.name}» (id ${j.id})`, 'ok') : say('crymsg', j.error, 'err'); } catch (err) { fail('crymsg')(err); } };
  if ($('cryDel')) $('cryDel').onclick = () => { if (confirm('Отключить оплату через Crypto Bot?')) post('/api/admin/crypto', { remove: true }).then(() => { toast('Crypto Bot отключён'); R.plans(); }).catch(fail('crymsg')); };
  $('payF').onsubmit = async (e) => { e.preventDefault(); try { await post('/api/admin/pay', { merchant: $('payMid').value, secret: $('paySec').value }); toast('Ключи Platega сохранены'); R.plans(); } catch (err) { fail('paymsg')(err); } };
};

/* ---------- пользователи ---------- */
R.users = async () => {
  const j = await api('/api/admin/users'); S.plans = j.plans;
  const q = (S.uq || '').toLowerCase(), list = j.users.filter((u) => !q || u.login.toLowerCase().includes(q) || (u.email || '').includes(q));
  $('vact').innerHTML = '<button class="btn pri" id="uNew"><svg><use href="#i-plus"/></svg>Создать аккаунт</button>';
  $('view').innerHTML = `<div class="card" id="uCard" hidden><h2>Новый аккаунт</h2><div class="sub">Пользователь войдёт через Google или GitHub с этой почтой — даже если регистрация закрыта</div>
      <form id="userF" autocomplete="off"><div class="grid g2" style="gap:0 14px"><label class="field"><span>Почта (Google или GitHub)</span><input name="email" type="email" required maxlength="200" placeholder="name@gmail.com"></label><label class="field"><span>Имя (необязательно)</span><input name="name" maxlength="40"></label></div>
      <div class="msg" id="umsg"></div><div class="btns"><button type="button" class="btn" id="uCancel">Отмена</button><button class="btn pri">Создать</button></div></form></div>
    <div class="card"><div class="toolbar"><input class="inp" id="uq" placeholder="Поиск по почте или логину" value="${esc(S.uq || '')}"><span style="flex:1"></span><label class="check" style="margin:0"><input type="checkbox" id="regOpen"${j.register ? ' checked' : ''}> Открытая регистрация</label></div>
      ${list.length ? `<div class="tw"><table><thead><tr><th>Пользователь</th><th>Тариф</th><th>Действует до</th><th class="r">Сообщения (осталось)</th><th>Создан</th><th></th></tr></thead><tbody>${list.map((u) => { const lc = u.msgLeft == null ? '' : u.msgLeft === 0 ? 'bad-t' : u.msgLeft <= 10 ? 'warn-t' : 'ok-t'; return `<tr>
        <td><div class="who"><span class="av">${esc(u.login[0])}</span><span><b style="font-weight:550">${esc(u.name || u.login)}</b><small style="display:block;color:var(--muted);font-size:12px">${esc(u.email || '@' + u.login)}${u.email && !u.google ? ' · ещё не входил' : ''}</small></span></div></td><td>${planBadge(u.plan)}${u.trial ? ' <span class="badge">пробный</span>' : ''}</td>
        <td>${u.until ? dt(u.until) : '<span style="color:var(--dim)">—</span>'}</td><td class="r" title="Осталось на сегодня · использовано/лимит · запуски Python · сайты${u.ext ? ' · продлено до ' + u.ext.limit + ' до ' + dt(u.ext.until) : ''}"><b class="${lc}">${u.msgLeft == null ? '∞' : u.msgLeft}</b><small style="display:block;color:var(--dim);font-size:11.5px">${u.used.m}${u.msgLimit != null ? ' / ' + u.msgLimit : ''} · py ${u.used.c} · сайты ${u.used.s}${u.ext ? ' · продл. до ' + dt(u.ext.until) : ''}</small></td><td>${dt(u.created)}</td>
        <td class="r"><button class="btn sm" data-ugrant="${u.id}">Тариф</button> <button class="ib del" style="display:inline-grid;vertical-align:middle" data-udel="${u.id}" data-login="${esc(u.login)}" title="Удалить" aria-label="Удалить аккаунт"><svg><use href="#i-trash"/></svg></button></td></tr>
        <tr id="ug-${u.id}" hidden><td colspan="6" style="padding-top:0"><div class="grant">Выдать <select id="ugp-${u.id}">${j.plans.map((p) => `<option value="${p.id}"${p.id === (u.plan === 'free' ? 'pro' : u.plan) ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select> на <input type="number" id="ugd-${u.id}" min="1" max="3650" value="30"> дней <label class="check" style="margin:0"><input type="checkbox" id="uge-${u.id}" checked> добавить к текущему сроку</label><span style="flex:1"></span><button class="btn sm pri" data-ugsave="${u.id}">Выдать</button></div><div class="grant" style="margin-top:0;border-top:1px dashed var(--line2);padding-top:10px">Сообщения сегодня: осталось <b>${u.msgLeft == null ? '∞' : u.msgLeft}</b> (использовано ${u.used.m}${u.msgLimit != null ? ' / ' + u.msgLimit : ''}) <span style="flex:1"></span><input type="number" id="uga-${u.id}" min="1" max="100000" value="10" style="width:90px"><button class="btn sm pri" data-ugive="${u.id}">+ Выдать</button> <button class="btn sm" data-utake="${u.id}">− Отнять</button></div><div class="grant" style="margin-top:0;border-top:1px dashed var(--line2);padding-top:10px">Лимит сообщений в день: <b>${u.msgLimit == null ? '∞' : u.msgLimit}</b>${u.ext ? ' (продлено до ' + u.ext.limit + ' до ' + dt(u.ext.until) + ') <button class="btn sm" data-uxoff="' + u.id + '">Снять продление</button>' : ''} <span style="flex:1"></span><input type="number" id="uel-${u.id}" min="1" max="10000" value="10000" style="width:80px" title="До 10000 сообщений"><input type="number" id="ued-${u.id}" min="1" max="30" value="1" style="width:56px" title="Сколько дней"> дн. <button class="btn sm pri" data-ugext="${u.id}">Продлить</button></div></td></tr>`; }).join('')}</tbody></table></div>` : `<div class="empty">${q ? 'Никого не нашлось' : 'Аккаунтов пока нет'}</div>`}
      <div style="font-size:12.5px;color:var(--dim);margin-top:10px">Всего: ${j.users.length} · «Сообщения (осталось)» — остаток на сегодня (использовано/лимит · Python · сайты). «Тариф» — выдача тарифа и выдача/отбор сообщений</div></div>`;
  $('uNew').onclick = () => { $('uCard').hidden = false; $('userF').email.focus(); };
  $('uCancel').onclick = () => { $('uCard').hidden = true; };
  $('uq').oninput = (e) => { S.uq = e.target.value; clearTimeout(S.uqT); S.uqT = setTimeout(() => R.users().then(() => { const i = $('uq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }), 250); };
  $('regOpen').onchange = (e) => post('/api/admin/register', { open: e.target.checked }).then(() => toast(e.target.checked ? 'Регистрация открыта' : 'Регистрация закрыта')).catch(fail());
  $('userF').onsubmit = async (e) => { e.preventDefault(); try { const u = await post('/api/admin/users', Object.fromEntries(new FormData(e.target))); toast(`Аккаунт для «${u.email}» создан`); R.users(); } catch (err) { fail('umsg')(err); } };
  $('view').onclick = (e) => {
    const g = e.target.closest('[data-ugrant]'); if (g) { const r = $('ug-' + g.dataset.ugrant); r.hidden = !r.hidden; return; }
    const mg = e.target.closest('[data-ugive],[data-utake]');
    if (mg) {
      const id = mg.dataset.ugive || mg.dataset.utake, action = mg.dataset.ugive ? 'give' : 'take';
      const n = Math.floor(+$('uga-' + id).value);
      if (!(n > 0 && n <= 100000)) { toast('Количество: от 1 до 100000'); return; }
      mg.disabled = true;
      post('/api/admin/usage', { uid: id, action, amount: n }).then((x) => { toast((action === 'give' ? 'Сообщения выданы' : 'Сообщения отняты') + '. Осталось: ' + (x.msgLeft == null ? '∞' : x.msgLeft)); R.users(); }).catch((err) => { mg.disabled = false; fail()(err); });
      return;
    }
    const ge = e.target.closest('[data-ugext]');
    if (ge) { const id = ge.dataset.ugext, limit = Math.floor(+$('uel-' + id).value), days = Math.floor(+$('ued-' + id).value) || 1; if (!(limit > 0 && limit <= 10000)) { toast('Лимит: от 1 до 10000'); return; } ge.disabled = true; post('/api/admin/msg-ext', { uid: id, limit, days }).then((x) => { toast('Лимит продлён до ' + (x.msgLimit == null ? '∞' : x.msgLimit) + '. Осталось: ' + (x.msgLeft == null ? '∞' : x.msgLeft)); R.users(); }).catch((err) => { ge.disabled = false; fail()(err); }); return; }
    const xo = e.target.closest('[data-uxoff]');
    if (xo) { const id = xo.dataset.xoff; xo.disabled = true; post('/api/admin/msg-ext', { uid: id, action: 'reset' }).then((x) => { toast('Продление снято. Осталось: ' + (x.msgLeft == null ? '∞' : x.msgLeft)); R.users(); }).catch((err) => { xo.disabled = false; fail()(err); }); return; }
    const s = e.target.closest('[data-ugsave]'); if (s) { const id = s.dataset.ugsave; post('/api/admin/users/' + id + '/plan', { plan: $('ugp-' + id).value, days: +$('ugd-' + id).value, extend: $('uge-' + id).checked }).then(() => { toast('Тариф выдан'); R.users(); }).catch(fail()); return; }
    const d = e.target.closest('[data-udel]'); if (d && confirm(`Удалить аккаунт «${d.dataset.login}»? Его чаты, память и файлы будут удалены.`)) api('/api/admin/users/' + d.dataset.udel, { method: 'DELETE' }).then(() => { toast('Аккаунт удалён'); R.users(); }).catch(fail());
  };
};

/* ---------- платежи ---------- */
R.payments = async () => {
  const [list, s] = await Promise.all([api('/api/admin/payments'), api('/api/admin/stats')]);
  const pend = list.filter((x) => x.status === 'PENDING').length;
  $('view').innerHTML = `<div class="grid g3" style="margin-bottom:16px">
      <div class="stat"><small>За 30 дней</small><b>${rub(s.revenue30)}</b></div><div class="stat"><small>Всего</small><b>${rub(s.revenue)}</b><span>${s.paid} ${plural(s.paid, 'оплата', 'оплаты', 'оплат')}</span></div><div class="stat"><small>Ожидают оплаты</small><b>${pend}</b><span>статус обновляется сам</span></div></div>
    <div class="card"><h2>История</h2><div class="sub">Последние 100 платежей. «Проверить» — запросить статус у платёжной системы.</div>${payTable(list)}</div>`;
  $('view').onclick = (e) => { const b = e.target.closest('[data-paychk]'); if (b) { b.disabled = true; post('/api/admin/payments/' + b.dataset.paychk + '/check').then((x) => { toast('Статус: ' + ((PST[x.status] || [x.status])[0])); R.payments(); }).catch((err) => { b.disabled = false; fail()(err); }); } };
};

/* ---------- промокоды ---------- */
R.promos = async () => {
  const list = await api('/api/admin/promos'), paid = S.plans.filter((p) => p.id !== 'free');
  $('view').innerHTML = `<div class="card"><h2>Новый промокод</h2><div class="sub">Скидка применяется при оплате, подарок — сразу включает тариф</div>
      <form id="promoF" autocomplete="off"><div class="grid g3" style="gap:0 14px">
        <label class="field"><span>Код</span><input name="code" required maxlength="30" placeholder="START20" style="text-transform:uppercase"></label>
        <label class="field"><span>Тип</span><select name="kind" id="prKind"><option value="discount">Скидка на оплату, %</option><option value="gift">Подарок: тариф на N дней</option></select></label>
        <label class="field"><span>Тариф</span><select name="plan" id="prPlan"><option value="">любой</option>${paid.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>
        <label class="field" id="prPct"><span>Скидка, %</span><input name="percent" type="number" min="1" max="99" value="20"></label>
        <label class="field" id="prDays" hidden><span>Дней</span><input name="days" type="number" min="1" max="365" value="7"></label>
        <label class="field"><span>Сколько раз можно использовать</span><input name="max" type="number" min="1" placeholder="без ограничений"></label>
        <label class="field"><span>Действует до</span><input name="until" type="date"></label></div>
        <div class="msg" id="prmsg"></div><div class="btns"><button class="btn pri">Создать промокод</button></div></form></div>
    <div class="card"><h2>Промокоды</h2><div class="sub">Один пользователь может активировать код только один раз</div>
      ${list.length ? `<div class="tw"><table><thead><tr><th>Код</th><th>Что даёт</th><th class="r">Использован</th><th>Действует до</th><th></th></tr></thead><tbody>${list.map((x) => `<tr><td><b style="font-family:ui-monospace,Menlo,monospace;letter-spacing:.5px">${esc(x.code)}</b></td><td>${x.kind === 'gift' ? `${planBadge(x.plan)} на ${x.days} дн. бесплатно` : `Скидка ${x.percent}%${x.plan ? ' на ' + esc(planName(x.plan)) : ''}`}</td><td class="r">${x.used}${x.max ? ' из ' + x.max : ''}</td><td>${x.until ? dt(x.until) : '<span style="color:var(--dim)">бессрочно</span>'}${x.until && x.until < Date.now() ? ' <span class="badge bad">истёк</span>' : x.max && x.used >= x.max ? ' <span class="badge">исчерпан</span>' : ''}</td><td class="r"><button class="ib del" style="display:inline-grid" data-prdel="${esc(x.code)}" title="Удалить" aria-label="Удалить промокод"><svg><use href="#i-trash"/></svg></button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Промокодов пока нет</div>'}</div>`;
  $('prKind').onchange = () => { const g = $('prKind').value === 'gift'; $('prPct').hidden = g; $('prDays').hidden = !g; $('prPlan').options[0].hidden = g; if (g && !$('prPlan').value) $('prPlan').selectedIndex = 1; };
  $('promoF').onsubmit = async (e) => { e.preventDefault(); try { const pr = await post('/api/admin/promos', Object.fromEntries(new FormData(e.target))); toast(`Промокод ${pr.code} создан`); R.promos(); } catch (err) { fail('prmsg')(err); } };
  $('view').onclick = (e) => { const b = e.target.closest('[data-prdel]'); if (b && confirm('Удалить промокод ' + b.dataset.prdel + '?')) api('/api/admin/promos/' + encodeURIComponent(b.dataset.prdel), { method: 'DELETE' }).then(() => { toast('Удалено'); R.promos(); }).catch(fail()); };
};

/* ---------- инструменты ---------- */
const vOk = (v) => !!(v.on && v.modelId && v.hasKey && (v.baseUrl || v.effMode !== 'openai'));
R.tools = async () => {
  const [w, c, b, im, vd, wm] = await Promise.all([api('/api/admin/search'), api('/api/admin/code'), api('/api/admin/browser'), api('/api/admin/image'), api('/api/admin/video'), api('/api/admin/watermark').catch(() => ({ on: true }))]);
  $('view').innerHTML = `<div class="card"><div class="chead"><div><h2>Поиск в интернете</h2><div class="sub">Модель ищет свежую информацию и даёт ссылки на источники</div></div></div>
      <form id="webF" autocomplete="off"><div class="grid g2" style="gap:0 14px"><label class="field"><span>Поисковик</span><select id="wProv">${Object.entries(w.providers).map(([k, v]) => `<option value="${k}"${k === w.provider ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
        <label class="field"><span>Ключ поисковика</span><input id="wKey" type="password"></label></div>
        <div class="msg" id="wmsg"></div><div class="btns"><button type="button" class="btn" id="wTest">Проверить</button><button class="btn pri">Сохранить</button></div></form></div>
        <div class="card"><div class="chead"><div><h2>Вотермарк публикаций</h2><div class="sub">Бейдж «Сделано в Premier» под опубликованными сайтами. На free — всегда включён, на pro/max — по желанию при публикации</div></div><span class="badge ${wm.on !== false ? 'ok' : 'warn'}" id="wmBadge">${wm.on !== false ? 'Включено' : 'Выключено'}</span></div>
      <label class="check"><input type="checkbox" id="wmOn"${wm.on !== false ? ' checked' : ''}> Показывать бейдж на опубликованных сайтах</label></div>
    <div class="card"><div class="chead"><div><h2>Генерация изображений</h2><div class="sub">Модель рисует картинки по просьбе пользователя. Лимит в день — во вкладке «Тарифы»</div></div><span class="badge ${im.on && im.baseUrl && im.modelId && im.hasKey ? 'ok' : 'warn'}" id="iBadge">${im.on && im.baseUrl && im.modelId && im.hasKey ? 'Включено' : im.baseUrl ? 'Выключено' : 'Не настроено'}</span></div>
      <div class="ipre"><span>Быстро заполнить:</span><button type="button" class="btn sm" data-ipre="or">OpenRouter · Gemini</button><button type="button" class="btn sm" data-ipre="oai">OpenAI · gpt-image-1</button><button type="button" class="btn sm" data-ipre="tg">Together · Flux</button></div>
      <form id="imgF" autocomplete="off">
        <div class="grid g2" style="gap:0 14px">
          <label class="field"><span>URL API</span><input id="iUrl" value="${esc(im.baseUrl)}" placeholder="https://openrouter.ai/api/v1"><small>Базовый адрес, как у моделей. Можно и полный: …/images/generations</small></label>
          <label class="field"><span>ID модели</span><input id="iModel" value="${esc(im.modelId)}" placeholder="google/gemini-2.5-flash-image"></label>
          <label class="field"><span>API-ключ</span><input id="iKey" type="password" placeholder="${im.hasKey ? esc(im.apiKey) + ' (сохранён)' : 'sk-...'}"></label>
          <label class="field"><span>Формат API</span><select id="iMode"><option value="auto"${im.mode === 'auto' ? ' selected' : ''}>Авто${im.effMode ? ' (сейчас: ' + (im.effMode === 'chat' ? 'chat' : 'images') + ')' : ''}</option><option value="images"${im.mode === 'images' ? ' selected' : ''}>images/generations — OpenAI, Together и др.</option><option value="chat"${im.mode === 'chat' ? ' selected' : ''}>chat/completions — OpenRouter, Gemini</option></select></label>
          <label class="field"><span>Размер (для images)</span><input id="iSize" value="${esc(im.size)}" placeholder="авто по пропорциям"><small>Тьер 1K/2K/3K/4K (пропорция — по запросу модели) или точный, например 1024x1024. «none» — не передавать размер</small></label>
          <label class="field"><span>Доп. параметры, JSON</span><input id="iExtra" value="${esc(im.extra)}" placeholder='{"quality":"medium"}'><small>Добавятся в запрос как есть</small></label>
        </div>
        <label class="check"><input type="checkbox" id="iOn"${im.on ? ' checked' : ''}> Модель может рисовать картинки</label>
        <div class="msg" id="imsg"></div><div class="iprev" id="iPrev" hidden></div>
        <div class="btns"><button type="button" class="btn" id="iTest"><svg><use href="#i-bolt"/></svg>Проверить</button><button class="btn pri">Сохранить</button></div></form></div>
    <div class="card"><div class="chead"><div><h2>Генерация видео</h2><div class="sub">Короткие ролики по просьбе пользователя («сделай видео…», «оживи картинку»). Лимит в день — во вкладке «Тарифы» (Free по умолчанию 0)</div></div><span class="badge ${vOk(vd) ? 'ok' : 'warn'}" id="vBadge">${vOk(vd) ? 'Включено' : vd.modelId ? 'Выключено' : 'Не настроено'}</span></div>
      <div class="ipre"><span>Быстро заполнить:</span><button type="button" class="btn sm" data-vpre="fal">fal.ai · Kling</button><button type="button" class="btn sm" data-vpre="falveo">fal.ai · Veo 3 Fast</button><button type="button" class="btn sm" data-vpre="oai">OpenAI · Sora 2</button><button type="button" class="btn sm" data-vpre="rep">Replicate · Wan</button></div>
      <form id="vidF" autocomplete="off">
        <div class="grid g2" style="gap:0 14px">
          <label class="field"><span>URL API</span><input id="vUrl" value="${esc(vd.baseUrl)}" placeholder="https://queue.fal.run"><small>fal.ai, Replicate или OpenAI-совместимый (/videos)</small></label>
          <label class="field"><span>ID модели</span><input id="vModel" value="${esc(vd.modelId)}" placeholder="fal-ai/kling-video/v2.1/standard/text-to-video"></label>
          <label class="field"><span>API-ключ</span><input id="vKey" type="password" placeholder="${vd.hasKey ? esc(vd.apiKey) + ' (сохранён)' : 'ключ сервиса'}"></label>
          <label class="field"><span>Формат API</span><select id="vMode">${[['auto', 'Авто' + (vd.effMode ? ' (сейчас: ' + vd.effMode + ')' : '')], ['fal', 'fal.ai — очередь задач'], ['replicate', 'Replicate — predictions'], ['openai', 'OpenAI — /videos (Sora)']].map(([k, n]) => `<option value="${k}"${vd.mode === k ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
          <label class="field"><span>Длительность, секунд</span><input id="vSec" value="${esc(vd.seconds)}" placeholder="по умолчанию модели"><small>Например 5 или 8. Чем длиннее — тем дороже</small></label>
          <label class="field"><span>Доп. параметры, JSON</span><input id="vExtra" value="${esc(vd.extra)}" placeholder='{"resolution":"720p"}'><small>Добавятся в запрос как есть</small></label>
        </div>
        <label class="check"><input type="checkbox" id="vOn"${vd.on ? ' checked' : ''}> Модель может делать видео</label>
        <div class="msg" id="vmsg"></div><div class="iprev" id="vPrev" hidden></div>
        <div class="btns"><button type="button" class="btn" id="vTest"><svg><use href="#i-bolt"/></svg>Проверить (платно, 1–5 мин)</button><button class="btn pri">Сохранить</button></div></form></div>
    <div class="card"><div class="chead"><div><h2>Выполнение кода (Python)</h2><div class="sub">Расчёты, графики, Excel/Word/PDF-файлы</div></div><span class="badge ${c.ok ? 'ok' : 'bad'}">${c.ok ? (c.mode === 'local' ? 'local — без изоляции' : 'Docker-песочница') : 'недоступно'}</span></div>
      ${c.ok ? '' : `<div class="msg err">${esc(c.error || '')}</div>`}
      <label class="check"><input type="checkbox" id="cOn"${c.enabled ? ' checked' : ''}> Модель может запускать Python</label>
      <div class="msg" id="cmsg"></div><div class="btns"><button type="button" class="btn" id="cTest"><svg><use href="#i-bolt"/></svg>Проверить</button></div></div>
    <div class="card"><div class="chead"><div><h2>Встроенный браузер</h2><div class="sub">Chromium: чтение сложных сайтов, скриншоты, самопроверка созданных сайтов</div></div><span class="badge ${b.installed ? 'ok' : 'bad'}">${b.installed ? 'установлен · ' + esc(b.lib) : 'не установлен'}</span></div>
      ${b.installed ? (b.error ? `<div class="msg err">Последняя ошибка: ${esc(b.error)}</div>` : '') : '<div class="msg">Выполните в папке проекта: npm install (см. README)</div>'}
      <label class="check"><input type="checkbox" id="bOn"${b.browser ? ' checked' : ''}> Модель открывает страницы в настоящем браузере</label>
      <label class="check"><input type="checkbox" id="bCheck"${b.selfcheck ? ' checked' : ''}> Самопроверка сайтов: модель открывает свой сайт и исправляет ошибки</label>
      <div class="msg" id="bmsg"></div><div class="btns"><button type="button" class="btn" id="bTest"><svg><use href="#i-bolt"/></svg>Проверить браузер</button></div></div>`;
  const ph = () => { const need = ['tavily', 'brave', 'serper'].includes($('wProv').value); $('wKey').disabled = !need; $('wKey').placeholder = need ? (w.hasKey ? w.key + ' (сохранён)' : 'вставьте ключ') : 'не нужен'; };
  $('wProv').onchange = ph; ph();
  const wsave = () => post('/api/admin/search', { provider: $('wProv').value, key: $('wKey').value });
  $('webF').onsubmit = async (e) => { e.preventDefault(); try { await wsave(); $('wKey').value = ''; say('wmsg', 'Сохранено', 'ok'); } catch (err) { fail('wmsg')(err); } };
  $('wTest').onclick = async () => { say('wmsg', 'Ищу «новости сегодня»…'); try { await wsave(); const j = await post('/api/admin/search/test'); j.ok ? say('wmsg', 'Работает: ' + j.results.map((x) => host(x.url)).join(', '), 'ok') : say('wmsg', j.error, 'err'); } catch (err) { fail('wmsg')(err); } };
  const IPRE = { or: ['https://openrouter.ai/api/v1', 'google/gemini-2.5-flash-image', 'chat', ''], oai: ['https://api.openai.com/v1', 'gpt-image-1', 'images', '{"quality":"medium"}'], tg: ['https://api.together.xyz/v1', 'black-forest-labs/FLUX.1-schnell', 'images', '{"response_format":"b64_json","steps":4}'] };
  document.querySelectorAll('[data-ipre]').forEach((x) => { x.onclick = () => { const v = IPRE[x.dataset.ipre]; $('iUrl').value = v[0]; $('iModel').value = v[1]; $('iMode').value = v[2]; $('iExtra').value = v[3]; $('iSize').value = ''; $('iKey').focus(); say('imsg', 'Вставьте ключ этого сервиса и нажмите «Проверить»'); }; });
  const isave = async () => { const j = await post('/api/admin/image', { baseUrl: $('iUrl').value, modelId: $('iModel').value, apiKey: $('iKey').value, mode: $('iMode').value, size: $('iSize').value, extra: $('iExtra').value, on: $('iOn').checked }); $('iKey').value = ''; if (j.hasKey) $('iKey').placeholder = j.apiKey + ' (сохранён)'; const okk = j.on && j.baseUrl && j.modelId && j.hasKey; $('iBadge').className = 'badge ' + (okk ? 'ok' : 'warn'); $('iBadge').textContent = okk ? 'Включено' : j.baseUrl ? 'Выключено' : 'Не настроено'; return j; };
  $('imgF').onsubmit = async (e) => { e.preventDefault(); try { const j = await isave(); say('imsg', j.on && !(j.baseUrl && j.modelId && j.hasKey) ? 'Сохранено, но не хватает URL, модели или ключа' : 'Сохранено', j.on && !(j.baseUrl && j.modelId && j.hasKey) ? 'err' : 'ok'); } catch (err) { fail('imsg')(err); } };
  $('iOn').onchange = () => isave().then(() => say('imsg', 'Сохранено', 'ok')).catch(fail('imsg'));
  $('wmOn').onchange = async () => { try { await post('/api/admin/watermark', { on: $('wmOn').checked }); $('wmBadge').className = 'badge ' + ($('wmOn').checked ? 'ok' : 'warn'); $('wmBadge').textContent = $('wmOn').checked ? 'Включено' : 'Выключено'; } catch (e) { console.error(e); } };
  $('iTest').onclick = async () => { $('iTest').disabled = true; $('iPrev').hidden = true; say('imsg', 'Сохраняю и рисую тестовую картинку… (обычно 5–30 секунд)');
    try { await isave(); const j = await post('/api/admin/image/test'); if (j.ok) { say('imsg', `Работает: ${(j.ms / 1000).toFixed(1)} с, ${Math.round(j.size / 1024)} КБ`, 'ok'); $('iPrev').innerHTML = `<img src="${j.image}" alt="Тестовая картинка">`; $('iPrev').hidden = false; } else say('imsg', j.error, 'err'); }
    catch (err) { fail('imsg')(err); } $('iTest').disabled = false; };
  const VPRE = { fal: ['https://queue.fal.run', 'fal-ai/kling-video/v2.1/standard/text-to-video', 'fal', '5', ''], falveo: ['https://queue.fal.run', 'fal-ai/veo3/fast', 'fal', '8s', '{"generate_audio":false}'], oai: ['https://api.openai.com/v1', 'sora-2', 'openai', '4', ''], rep: ['https://api.replicate.com/v1', 'wan-video/wan-2.2-t2v-fast', 'replicate', '', ''] };
  document.querySelectorAll('[data-vpre]').forEach((x) => { x.onclick = () => { const v = VPRE[x.dataset.vpre]; $('vUrl').value = v[0]; $('vModel').value = v[1]; $('vMode').value = v[2]; $('vSec').value = v[3]; $('vExtra').value = v[4]; $('vKey').focus(); say('vmsg', 'Вставьте ключ этого сервиса и нажмите «Сохранить» или «Проверить»'); }; });
  const vsave = async () => { const j = await post('/api/admin/video', { baseUrl: $('vUrl').value, modelId: $('vModel').value, apiKey: $('vKey').value, mode: $('vMode').value, seconds: $('vSec').value, extra: $('vExtra').value, on: $('vOn').checked }); $('vKey').value = ''; if (j.hasKey) $('vKey').placeholder = j.apiKey + ' (сохранён)'; $('vBadge').className = 'badge ' + (vOk(j) ? 'ok' : 'warn'); $('vBadge').textContent = vOk(j) ? 'Включено' : j.modelId ? 'Выключено' : 'Не настроено'; return j; };
  $('vidF').onsubmit = async (e) => { e.preventDefault(); try { const j = await vsave(); say('vmsg', j.on && !vOk(j) ? 'Сохранено, но не хватает модели или ключа' : 'Сохранено', j.on && !vOk(j) ? 'err' : 'ok'); } catch (err) { fail('vmsg')(err); } };
  $('vOn').onchange = () => vsave().then(() => say('vmsg', 'Сохранено', 'ok')).catch(fail('vmsg'));
  const vwatch = async () => { // тест идёт в фоне на сервере — опрашиваем
    const t = (await api('/api/admin/video')).test || {}; if (!$('vmsg')) return;
    if (t.state === 'run') { say('vmsg', `Делаю тестовое видео… ${t.p ? t.p + '% · ' : ''}${Math.round((Date.now() - t.at) / 1000)} с`); return setTimeout(vwatch, 3000); }
    $('vTest').disabled = false;
    if (t.state === 'ok') { say('vmsg', `Работает: ${(t.ms / 1000).toFixed(0)} с, ${(t.size / 1048576).toFixed(1)} МБ`, 'ok'); $('vPrev').innerHTML = `<video src="${t.url}" controls autoplay muted loop playsinline style="max-width:100%;border-radius:10px"></video>`; $('vPrev').hidden = false; }
    else if (t.state === 'err') say('vmsg', t.error, 'err');
  };
  $('vTest').onclick = async () => { $('vTest').disabled = true; $('vPrev').hidden = true; try { await vsave(); const j = await post('/api/admin/video/test'); if (!j.ok) { say('vmsg', j.error, 'err'); $('vTest').disabled = false; return; } vwatch(); } catch (err) { fail('vmsg')(err); $('vTest').disabled = false; } };
  if (vd.test?.state === 'run') { $('vTest').disabled = true; vwatch(); }
  $('cOn').onchange = () => post('/api/admin/code', { enabled: $('cOn').checked }).then(() => say('cmsg', 'Сохранено', 'ok')).catch(fail('cmsg'));
  $('cTest').onclick = async () => { say('cmsg', 'Запускаю…'); $('cTest').disabled = true; try { const j = await post('/api/admin/code/test'); j.ok ? say('cmsg', j.out + ' · ' + (j.ms / 1000).toFixed(1) + ' с', 'ok') : say('cmsg', j.error, 'err'); } catch (err) { fail('cmsg')(err); } $('cTest').disabled = false; };
  const bsave = () => post('/api/admin/browser', { browser: $('bOn').checked, selfcheck: $('bCheck').checked }).then(() => say('bmsg', 'Сохранено', 'ok')).catch(fail('bmsg'));
  $('bOn').onchange = bsave; $('bCheck').onchange = bsave;
  $('bTest').onclick = async () => { say('bmsg', 'Запускаю браузер… (первый запуск — до 10 секунд)'); $('bTest').disabled = true; try { const j = await post('/api/admin/browser/test'); j.ok ? say('bmsg', 'Работает — страница открыта за ' + (j.ms / 1000).toFixed(1) + ' с', 'ok') : say('bmsg', j.error, 'err'); } catch (err) { fail('bmsg')(err); } $('bTest').disabled = false; };
};

/* ---------- отзывы ---------- */
async function refreshReviewCount() {
  if (!S.token) return;
  const s = await api('/api/admin/reviews?summary=1');
  const el = $('reviewsPending');
  el.textContent = s.pending; el.hidden = !s.pending;
  el.setAttribute('aria-label', 'Ожидают модерации: ' + s.pending);
  return s;
}
R.reviews = async () => {
  const page = S.reviewsPage || 1;
  const [list, summary] = await Promise.all([api('/api/admin/reviews?page=' + page), refreshReviewCount()]);
  if (S.view !== 'reviews') return;
  const statuses = { pending: ['Ожидает', 'warn'], approved: ['Опубликован', 'ok'], rejected: ['Отклонён', 'bad'] };
  $('view').innerHTML = `<div class="review-summary">Всего: ${Number(summary.total)} · Ожидают модерации: ${Number(summary.pending)}</div><div id="reviewAdminList">${list.length ? list.map((r) => {
    const status = statuses[r.status] || ['Неизвестный статус', ''];
    const body = r.text.length > 200 ? `<details class="review-expand"><summary>${esc(r.text.slice(0, 200))}… <span>Читать полностью</span></summary><p>${esc(r.text)}</p></details>` : `<p class="review-body">${esc(r.text)}</p>`;
    return `<article class="card review-admin"><div class="review-admin-head"><b>${esc(r.nick)}</b>${r.plan ? `<span class="badge p${r.plan === 'max' ? 2 : r.plan === 'pro' ? 1 : 0}">${esc({ free: 'Free', pro: 'Pro', max: 'Max' }[r.plan] || r.plan)}</span>` : ''}<span class="review-score">★ ${Number(r.rating)} / 5</span><time>${esc(dt(r.at))}</time><span class="badge ${status[1]}">${status[0]}</span></div>${body}<div class="review-admin-actions"><button class="btn sm review-approve" data-review-action="approve" data-review-id="${esc(r.id)}" ${r.status === 'approved' ? 'disabled' : ''}>Одобрить</button><button class="btn sm review-reject" data-review-action="reject" data-review-id="${esc(r.id)}" ${r.status === 'rejected' ? 'disabled' : ''}>Отклонить</button><button class="btn sm danger review-delete" data-review-action="delete" data-review-id="${esc(r.id)}">Удалить</button></div></article>`;
  }).join('') : '<div class="empty">Отзывов пока нет</div>'}</div><div class="review-pager"><button class="btn sm" data-review-page="${page - 1}" ${page === 1 ? 'disabled' : ''}>← Назад</button><span>Страница ${page}</span><button class="btn sm" data-review-page="${page + 1}" ${page * 100 >= summary.total ? 'disabled' : ''}>Далее →</button></div>`;
  $('view').onclick = async (e) => {
    const pager = e.target.closest('[data-review-page]');
    if (pager && !pager.disabled) { S.reviewsPage = Number(pager.dataset.reviewPage); R.reviews().catch(fail()); return; }
    const btn = e.target.closest('[data-review-action]'); if (!btn || btn.disabled) return;
    const action = btn.dataset.reviewAction;
    if (action === 'delete' && !confirm('Удалить отзыв навсегда? После удаления пользователь сможет оставить новый.')) return;
    const controls = [...btn.closest('article').querySelectorAll('button')];
    const states = controls.map((b) => b.disabled); controls.forEach((b) => { b.disabled = true; });
    try {
      await post('/api/admin/reviews', { id: btn.dataset.reviewId, action });
      toast(action === 'approve' ? 'Отзыв опубликован' : action === 'reject' ? 'Отзыв отклонён' : 'Отзыв удалён');
      if (action === 'delete' && list.length === 1 && page > 1) S.reviewsPage = page - 1;
      if (S.view === 'reviews') await R.reviews(); else await refreshReviewCount();
    } catch (err) { controls.forEach((b, i) => { b.disabled = states[i]; }); fail()(err); }
  };
};

// Refresh the global pending badge without resetting a form in another section.
setInterval(() => { if (S.token && !document.hidden) refreshReviewCount().catch(fail()); }, 60000);
S.token ? start() : logout();
