// Premier — клиент: account (общие переменные — в 01-core.js; файлы подключаются по порядку в chat.html)
/* ---------- аккаунт и память ---------- */
async function memApi(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json' } });
  if (r.status === 401) { toLogin(); throw new Error('auth'); }
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Error ' + r.status); return j;
}
var ACC_TABS = [['profile', 'Profile', 'i-user'], ['plan', 'Plan', 'i-card'], ['memory', 'Memory', 'i-brain'], ['voice', 'Voice', 'i-speak'], ['api', 'API', 'i-code'], ['security', 'Security', 'i-lock']];
function myName() { return ME.name || ME.login; }
const signInVia = () => { const v = [ME.google && 'Google', ME.github && 'GitHub'].filter(Boolean); return v.length ? 'via ' + v.join(' or ') : 'using Google or GitHub with this email'; };
function paintMe() { $('meName').textContent = myName(); $('meAv').textContent = (myName() || '?')[0]; }
function openAccount(tab = 'profile') {
  dlgW(false); $('modal').querySelector('.dlg').classList.add('accdlg'); $('dtitle').textContent = 'Account settings'; $('modal').classList.add('on');
  $('dbody').innerHTML = `<div class="acc"><nav class="acc-nav">${ACC_TABS.map(([k, n, i]) => `<button type="button" data-acc="${k}" class="${k === tab ? 'on' : ''}"><svg><use href="#${i}"/></svg>${n}</button>`).join('')}</nav><div class="acc-body" id="accBody"></div></div>`;
  accTab(tab);
}
function accTab(tab) {
  document.querySelectorAll('[data-acc]').forEach((b) => b.classList.toggle('on', b.dataset.acc === tab));
  const el = $('accBody'); el.style.animation = 'none'; el.offsetHeight; el.style.animation = '';
  const since = ME.created ? new Date(ME.created).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' }).replace(' yr.', '') : '';
  if (tab === 'profile') {
    el.innerHTML = `<div class="acc-hero"><div class="acc-av">${esc(myName()[0] || '?')}</div><div><b>${esc(myName())}</b><small>${esc(ME.email || '@' + ME.login)}${since ? ' · since ' + since : ''}</small></div></div>
      <form id="nameF" autocomplete="off"><label class="field"><span>Name</span><input id="nameIn" maxlength="40" value="${esc(myName())}" required><small>This is how Premier displays your name</small></label>
      <label class="field"><span>Email</span><input value="${esc(ME.email || '—')}" disabled><small>Sign in — ${esc(signInVia())}</small></label>
      <div class="msgline" id="nameMsg"></div><div class="btns"><button class="btn pri" id="nameSave">Save</button></div></form>
      <div class="acc-note"><svg><use href="#i-check"/></svg>Chats and projects are saved on the server and available across your devices</div>`;
    $('nameF').onsubmit = async (e) => {
      e.preventDefault(); const name = $('nameIn').value.trim(); if (!name) return;
      try { const u = await memApi('/api/account/name', { method: 'POST', body: JSON.stringify({ name }) }); ME.name = u.name; paintMe(); accTab('profile'); toast('Name saved'); }
      catch (err) { $('nameMsg').className = 'msgline err'; $('nameMsg').textContent = err.message; }
    };
  } else if (tab === 'plan') {
    const B = BILL; if (!B) { el.innerHTML = '<div class="msgline">Loading…</div>'; loadBill().then(() => BILL && accTab('plan')); return; }
    const bar = (k, label) => { const L = B.limits[k], u = B.used[k]; return `<div class="acc-use"><div><span>${label}</span><b>${L == null ? u + ' · unlimited' : `${Math.min(u, L)} of ${L}`}</b></div><div class="pc-bar${L != null && u >= L ? ' out' : L != null && L - u <= Math.max(1, L * 0.15) ? ' low' : ''}"><i style="width:${L == null ? 0 : Math.min(100, u / L * 100)}%"></i></div></div>`; };
    el.innerHTML = `<div class="acc-plan"><div><small>Your plan</small><b>${esc(B.plan.name)}${B.plan.trial ? ' <span class="pc-badge">trial</span>' : ''}</b><span>${B.plan.until ? 'Valid until ' + fmtD(B.plan.until) : 'Free, with no expiration'}</span></div><button class="btn pri" id="accPlans">${B.plan.until ? 'Renew or switch' : 'Upgrade plan'}</button></div>
      <div class="dsec" style="margin-top:18px">Today</div>${bar('m', 'Messages')}${bar('c', 'Python runs')}${bar('s', 'Websites')}${B.images ? bar('i', 'Images') : ''}${B.videos && B.limits.v !== 0 ? bar('v', 'Video') : ''}
      <p class="pnote" style="margin-top:12px">Limits reset at midnight Moscow time.</p>`;
  } else if (tab === 'memory') {
    el.innerHTML = `<label class="check"><input type="checkbox" id="memOn"> The model remembers important details about you and uses them across all chats</label>
      <div id="memList"><div class="msgline">Loading…</div></div>
      <form id="memAdd" autocomplete="off"><label class="field"><span>Add manually</span><input id="memText" maxlength="300" placeholder="For example: My name is Anna and I am a designer. Keep replies short."></label>
      <div class="btns"><button type="button" class="btn" id="memClear">Clear all</button><button class="btn pri">Add</button></div></form>`;
    $('memOn').onchange = (e) => memApi('/api/memory', { method: 'POST', body: JSON.stringify({ on: e.target.checked }) }).then(renderMem).catch(() => {});
    $('memAdd').onsubmit = (e) => { e.preventDefault(); const t = $('memText').value.trim(); if (!t) return; memApi('/api/memory', { method: 'POST', body: JSON.stringify({ text: t }) }).then((x) => { $('memText').value = ''; renderMem(x); }).catch((err) => toast(err.message)); };
    memApi('/api/memory').then(renderMem).catch(() => {});
  } else if (tab === 'voice') {
    const pref = VPREF(), cur = (VOICES.find((v) => v.id === pref.voice) || VOICES[0])?.id, rate = +pref.rate || 1;
    const SAMPLE = 'Hi! I am Premier. This is my voice — calm and clear. What shall we work on today?';
    el.innerHTML = (VOICES.length ? `<div class="dsec">Voice</div><div class="vlist">${VOICES.map((v) => `<label class="vopt${v.id === cur ? ' on' : ''}"><input type="radio" name="voice" value="${esc(v.id)}"${v.id === cur ? ' checked' : ''}><span class="vav">${esc(v.name[0])}</span><span class="vtx"><b>${esc(v.name)}</b><small>${esc((v.kind ? v.kind + ' · ' : '') + (v.engine === 'vosk' ? 'clear sound' : 'clear diction'))}</small></span><button type="button" class="btn vplay" data-vplay="${esc(v.id)}"><svg><use href="#i-speak"/></svg>Listen</button></label>`).join('')}</div>`
      : `<div class="acc-note"><svg><use href="#i-speak"/></svg>No neural voice is installed on the server — your browser voice will read responses.</div>`)
      + `<div class="dsec" style="margin-top:18px">Speed</div><div class="vrate">${[0.85, 1, 1.15, 1.3, 1.5].map((r) => `<button type="button" data-vrate="${r}" class="${r === rate ? 'on' : ''}">${String(r).replace('.', ',')}×</button>`).join('')}</div>
      <p class="pnote" style="margin-top:12px">Click the speaker icon below a response to hear it. Click again to stop.</p>`;
    el.querySelectorAll('input[name=voice]').forEach((r) => (r.onchange = () => { setVPref({ voice: r.value }); el.querySelectorAll('.vopt').forEach((o) => o.classList.toggle('on', o.contains(r))); }));
    el.querySelectorAll('[data-vrate]').forEach((b) => (b.onclick = () => { setVPref({ rate: +b.dataset.vrate }); el.querySelectorAll('[data-vrate]').forEach((x) => x.classList.toggle('on', x === b)); if (AUD) AUD.audio.playbackRate = VRATE(AUD); }));
    el.querySelectorAll('[data-vplay]').forEach((b) => (b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); const keep = el.querySelector('input[name=voice]:checked')?.value; setVPref({ voice: b.dataset.vplay }); speak('__voice:' + b.dataset.vplay, SAMPLE); setVPref({ voice: keep }); }));
  } else if (tab === 'api') {
    el.innerHTML = '<div class="dsec">API for Cursor, Codex and Claude Code</div><p class="pnote">Use Premier models in your editor or terminal agent. Requests spend the same messages as the chat.</p><div class="btns" style="margin-top:16px"><a class="btn pri" href="/developers" target="_blank" rel="noopener">Open the API dashboard</a></div>';
  } else if (tab === 'security') {
    el.innerHTML = `<div class="dsec">Sign in</div>
      ${ME.google ? `<div class="acc-row"><div><b>With Google</b><small>${esc(ME.email || 'Google account')}</small></div></div>` : ''}
      ${ME.github ? `<div class="acc-row"><div><b>With GitHub</b><small>${esc(typeof ME.github === 'string' ? '@' + ME.github : 'GitHub account')}</small></div></div>` : ''}
      ${!ME.google && !ME.github ? `<div class="acc-row"><div><b>By email</b><small>${esc(ME.email || '—')} — sign in with Google or GitHub using this email</small></div></div>` : ''}
      <div class="hr"></div>
      <div class="acc-row"><div><b>Other devices</b><small id="sessInfo">Sign out everywhere except this device</small></div><button class="btn" id="logoutAll">Sign out everywhere</button></div>
      <div class="danger"><div class="acc-row"><div><b>Delete account</b><small>Chats, projects, memory and files will be permanently deleted</small></div><button class="btn dangerb" id="delOpen">Delete</button></div>
        <form id="delF" hidden autocomplete="off"><label class="field" style="margin-top:14px"><span>Type “delete” to confirm</span><input name="password" type="text" autocomplete="off" required></label>
        <div class="msgline err" id="delMsg"></div><div class="btns"><button type="button" class="btn" id="delCancel">Cancel</button><button class="btn dangerb solid">Delete permanently</button></div></form></div>`;
    memApi('/api/account').then((a) => { if ($('sessInfo') && a.sessions > 1) $('sessInfo').textContent = `You are signed in on ${a.sessions} ${plural(a.sessions, 'device', 'devices', 'devices')}. Sign out everywhere except here`; }).catch(() => {});
    $('logoutAll').onclick = () => memApi('/api/account/logout-all', { method: 'POST', body: '{}' }).then(() => { $('sessInfo').textContent = 'Done — other devices have been signed out'; toast('You have signed out on other devices'); }).catch((err) => toast(err.message));
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
  $('memList').innerHTML = x.items.length ? x.items.slice().reverse().map((i) => `<div class="memrow"><span>${esc(i.text)}<small>${new Date(i.at).toLocaleDateString('en-US')}</small></span><button class="ib" data-delmem="${i.id}" aria-label="Forget" title="Forget"><svg><use href="#i-trash"/></svg></button></div>`).join('')
    : `<div class="msgline">${x.on ? 'Nothing here yet. Tell the model about yourself or ask it to remember something.' : 'Memory is off.'}</div>`;
}

