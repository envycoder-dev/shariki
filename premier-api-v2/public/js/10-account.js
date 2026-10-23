// Premier — клиент: account (общие переменные — в 01-core.js; файлы подключаются по порядку в chat.html)
/* ---------- аккаунт и память ---------- */
async function memApi(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json' } });
  if (r.status === 401) { toLogin(); throw new Error('auth'); }
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Ошибка ' + r.status); return j;
}
var ACC_TABS = [['profile', 'Профиль', 'i-user'], ['plan', 'Тариф', 'i-card'], ['memory', 'Память', 'i-brain'], ['voice', 'Голос', 'i-speak'], ['watermark', 'Вотермарк', 'i-globe'], ['api', 'API', 'i-code'], ['models', 'Модели', 'i-pulse'], ['security', 'Безопасность', 'i-lock']];
function myName() { return ME.name || ME.login; }
const signInVia = () => { const v = [ME.google && 'Google', ME.github && 'GitHub'].filter(Boolean); return v.length ? 'через ' + v.join(' или ') : 'через Google или GitHub с этой почтой'; };
function paintMe() { $('meName').textContent = myName(); $('meAv').textContent = (myName() || '?')[0]; }
function openAccount(tab = 'profile') {
  dlgW(false); $('modal').querySelector('.dlg').classList.add('accdlg'); $('dtitle').textContent = 'Настройки аккаунта'; $('modal').classList.add('on');
  $('dbody').innerHTML = `<div class="acc"><nav class="acc-nav">${ACC_TABS.map(([k, n, i]) => `<button type="button" data-acc="${k}" class="${k === tab ? 'on' : ''}"><svg><use href="#${i}"/></svg>${n}</button>`).join('')}</nav><div class="acc-body" id="accBody"></div></div>`;
  accTab(tab);
}
function accTab(tab) {
  if (monTimer) { clearInterval(monTimer); monTimer = null; }
  document.querySelectorAll('[data-acc]').forEach((b) => b.classList.toggle('on', b.dataset.acc === tab));
  const el = $('accBody'); el.style.animation = 'none'; el.offsetHeight; el.style.animation = '';
  const since = ME.created ? new Date(ME.created).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).replace(' г.', '') : '';
  if (tab === 'profile') {
    el.innerHTML = `<div class="acc-hero"><div class="acc-av">${esc(myName()[0] || '?')}</div><div><b>${esc(myName())}</b><small>${esc(ME.email || '@' + ME.login)}${since ? ' · с ' + since : ''}</small></div></div>
      <form id="nameF" autocomplete="off"><label class="field"><span>Имя</span><input id="nameIn" maxlength="40" value="${esc(myName())}" required><small>Так вас видит Premier в интерфейсе</small></label>
      <label class="field"><span>Почта</span><input value="${esc(ME.email || '—')}" disabled><small>Вход — ${esc(signInVia())}</small></label>
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
    const RF = B.ref, refCard = RF && RF.on ? (() => {
      const link = location.origin + '/r/' + RF.code, L = { 3: '+50 сообщений', 10: 'Pro · 7 дней', 25: 'Pro · 14 дней', 50: 'Pro · месяц', 100: 'Max · месяц' }, t = RF.next;
      return `<div class="refcard"><div class="rc-top"><div class="rc-ic"><svg><use href="#i-user"/></svg></div><div class="rc-tt"><b>Пригласи друга</b><small>Ему +50 сообщений, тебе — шаг к бесплатному Pro</small></div></div>
        <div class="rc-link"><code>${esc(link)}</code><button type="button" class="btn rc-copy" id="refCopy"><svg><use href="#i-copy"/></svg>Скопировать</button></div>
        <div class="rc-stats"><div class="rc-stat"><b>${RF.total}</b><small>приглашено</small></div><div class="rc-stat"><b>${RF.active}</b><small>активных</small></div></div>
        ${RF.pending > 0 ? '<div class="rc-warm">' + (RF.pending === 1 ? '1 человек прогревается — станет активным после 3-го сообщения' : RF.pending + (RF.pending % 10 === 1 && RF.pending % 100 !== 11 ? ' человек' : ' человека') + ' прогреваются — станут активными после 3-го сообщения') + '</div>' : ''}
        ${t ? `<div class="rc-prog"><div class="rc-pt"><span>${t.need} ещё до «${L[t.n]}»</span><b>${RF.active} / ${t.n}</b></div><div class="pc-bar"><i style="width:${Math.min(100, Math.round(RF.active / t.n * 100))}%"></i></div></div>` : '<div class="rc-prog"><div class="rc-pt"><span>Все награды получены — спасибо за друзей!</span><b>✓</b></div></div>'}
        <div class="rc-tiers">${RF.tiers.map((x) => `<div class="rc-tier${x.done ? ' done' : ''}"><span class="rc-n">${x.done ? '<svg><use href="#i-check"/></svg>' : x.n}</span><span>${L[x.n]}</span></div>`).join('')}</div>
        ${RF.bonus ? `<div class="rc-chip"><svg><use href="#i-check"/></svg>Бонус: ${RF.bonus.n} сообщений до ${fmtD(RF.bonus.until)}</div>` : ''}</div>`;
    })() : '';
    el.innerHTML = `<div class="acc-plan"><div><small>Ваш тариф</small><b>${esc(B.plan.name)}${B.plan.trial ? ' <span class="pc-badge">пробный</span>' : ''}</b><span>${B.plan.until ? 'Действует до ' + fmtD(B.plan.until) : 'Бесплатно, без срока'}</span></div><button class="btn pri" id="accPlans">${B.plan.until ? 'Продлить или сменить' : 'Улучшить тариф'}</button></div>
      <div class="dsec" style="margin-top:18px">Сегодня</div>${bar('m', 'Сообщения')}${bar('c', 'Запуски Python')}${bar('s', 'Сайты')}${B.images ? bar('i', 'Картинки') : ''}${B.videos && B.limits.v !== 0 ? bar('v', 'Видео') : ''}
      <p class="pnote" style="margin-top:12px">Лимиты обновляются в полночь по Москве.</p>${refCard}`;
    if (RF && RF.on && $('refCopy')) $('refCopy').onclick = () => { const link = location.origin + '/r/' + RF.code; if (navigator.clipboard) navigator.clipboard.writeText(link).then(() => toast('Ссылка скопирована'), () => prompt('Скопируйте ссылку:', link)); else prompt('Скопируйте ссылку:', link); };
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
  
  } else if (tab === 'api') {
    el.innerHTML = '<div class="dsec">API для Cursor, Codex и Claude Code</div><p class="pnote">Подключите модели Premier к любимому редактору или агенту в терминале. Запросы тратят те же сообщения, что и чат.</p><div class="btns" style="margin-top:16px"><a class="btn pri" href="/developers" target="_blank" rel="noopener">Открыть кабинет API</a></div>';
  } else if (tab === 'models') {
    el.innerHTML = '<div class="mst" id="mstBox"><p class="pnote">Загружаем статус моделей…</p></div>';
    loadModelsStatus();
    monTimer = setInterval(loadModelsStatus, 60000);
  } else if (tab === 'security') {
    el.innerHTML = `<div class="dsec">Вход</div>
      ${ME.google ? `<div class="acc-row"><div><b>Через Google</b><small>${esc(ME.email || 'Аккаунт Google')}</small></div></div>` : ''}
      ${ME.github ? `<div class="acc-row"><div><b>Через GitHub</b><small>${esc(typeof ME.github === 'string' ? '@' + ME.github : 'Аккаунт GitHub')}</small></div></div>` : ''}
      ${!ME.google && !ME.github ? `<div class="acc-row"><div><b>По почте</b><small>${esc(ME.email || '—')} — войдите через Google или GitHub с этой почтой</small></div></div>` : ''}
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

/* ---------- статус моделей ---------- */
let monTimer = null;
async function loadModelsStatus() {
  const box = $('mstBox'); if (!box) return;
  let j;
  try { const r = await fetch('/api/models/status'); j = await r.json(); if (!Array.isArray(j)) throw new Error('x'); }
  catch { box.innerHTML = '<div class="mst"><p class="pnote">Не удалось загрузить статус моделей</p></div>'; return; }
  const ms = (v) => (v == null ? '—' : v >= 1000 ? (v / 1000).toFixed(1).replace('.0', '').replace('.', ',') + 'с' : v + 'мс');
  const tm = (v) => (v ? new Date(v).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '');
  box.innerHTML = '<div class="mst">' +
    '<div class="mst-head"><span>Модель</span><span>Пинг</span><span>Запросы за 24ч</span></div>' +
    j.map((x) => {
      const st = x.probe ? (x.probe.ok ? 'ok' : 'bad') : 'na';
      const c = x.chats24h || {};
      return '<div class="mst-row"><div class="mst-name"><i class="mst-dot ' + st + '"></i><div><b>' + esc(x.name) + '</b><small>' +
        (x.probe ? (x.probe.ok ? 'пинг ' + ms(x.probe.ms) : 'ошибка: ' + (x.probe.err || '—')) + ' · ' + tm(x.probe.at) : 'ещё нет данных — первый пинг в течение 5 минут') +
        '</small></div></div><div class="mst-cell">' + (x.probe ? (x.probe.ok ? ms(x.probe.ms) : 'ошибка') : '—') + '</div><div class="mst-cell">' +
        (c.n ? c.n + ' зап. · ' + c.pct + '% успех' + (c.firstMed ? ' · ' + ms(c.firstMed) + ' до слова' : '') : '—') + '</div></div>';
    }).join('') +
    '<p class="mst-note">Пинг — фоновый тестовый запрос к каждой модели каждые 5 минут. «Запросы за 24ч» — реальные чаты: число, доля успешных и медианное время до первого слова. Страница обновляется автоматически.</p></div>';
}
