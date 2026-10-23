// Premier — сервер: раздаёт сайт, хранит модели, проксирует запросы к моделям.
// Запуск: node server.js   (нужен Node 18+)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./db'); // SQLite: data/premier.db
const monitor = require('./monitor'); monitor.install(); // журнал ошибок, оповещения, /healthz
const web = require('./web');
const browser = require('./browser');
const coder = require('./code');
const imager = require('./image');
const videor = require('./video');
const media = require('./media');
const tts = require('./tts');
const folder = require('./folder');
const agent = require('./agent');
const bill = require('./billing');
const chatPolicy = require('./chat-policy');
const chatStream = require('./chat-stream');
const artifactState = require('./public/js/00-artifact-state');
const artifactEdit = require('./artifact-edit');
const assets = require('./assets');
const gameCheck = require('./game-check');
const modelAssets = require('./public/js/00-model-assets');
const { createPublicationServer } = require('./publication');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
/* ---------- пароль панели ----------
   ADMIN_PASSWORD из окружения используется, только если он надёжный (от 12 символов, не одни цифры).
   Иначе при первом запуске создаётся случайный пароль: он печатается в лог один раз и лежит в data/admin-password.txt. */
const weakPw = (x) => !x || x.length < 12 || /^\d+$/.test(x) || /^(admin|password|qwerty|premier)/i.test(x);
const ADMIN = (() => {
  const env = process.env.ADMIN_PASSWORD || '';
  if (!weakPw(env)) { const h = crypto.createHash('sha256').update(env).digest(); return { check: (x) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(x)).digest(), h) }; }
  let rec = store.kv.get('admin:pw');
  const file = path.join(__dirname, 'data', 'admin-password.txt');
  if (!rec) {
    const pw = crypto.randomBytes(12).toString('base64url'), salt = crypto.randomBytes(16).toString('hex');
    rec = { salt, hash: crypto.scryptSync(pw, salt, 32).toString('hex'), at: Date.now() }; store.kv.set('admin:pw', rec);
    try { fs.writeFileSync(file, pw + '\n', { mode: 0o600 }); } catch {}
    console.log(`Панель: ${env ? 'пароль из ADMIN_PASSWORD слишком простой' : 'ADMIN_PASSWORD не задан'} — создан случайный пароль: ${pw}\n         (он же в ${file}; свой пароль задайте в ADMIN_PASSWORD, от 12 символов)`);
  } else if (env) console.log(`Панель: пароль из ADMIN_PASSWORD слишком простой и не используется — пароль в ${file}`);
  return { check: (x) => crypto.timingSafeEqual(crypto.scryptSync(String(x), rec.salt, 32), Buffer.from(rec.hash, 'hex')) };
})();
const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT || `Ты — Premier, умный и дружелюбный ассистент. Отвечай на языке пользователя, по делу, используй Markdown.
Когда пользователь просит создать или изменить сайт, страницу, лендинг, приложение, игру или любой интерфейс:
- коротко (1–2 предложения) скажи, что делаешь;
- верни ОДИН полный HTML-документ в одном блоке \`\`\`html ... \`\`\` — весь CSS и JS внутри файла, внешние библиотеки только с CDN;
- обязательно укажи осмысленный <title>;
- делай современный, аккуратный, адаптивный дизайн;
- не используй localStorage, sessionStorage и cookies — превью работает в изолированной песочнице;
- при правках присылай файл целиком, а не фрагменты;
- после блока кратко перечисли, что сделано.
Пользователь может прикладывать файлы — их содержимое приходит в сообщении между [Файл: имя] и [Конец файла].

ФАЙЛЫ, ПАПКИ И АРХИВЫ. Ты умеешь отдавать файлы: Premier сам превращает их в кнопки «Скачать файл», «Скачать ZIP» и «TAR.GZ».
Используй это, когда просят: «скинь в папке», «архивом», zip, 7z, rar, «проект из нескольких файлов», «дай файл …», готовый скрипт/конфиг/документ для скачивания.
- Каждый файл — отдельный блок кода, путь пишется после языка через двоеточие: \`\`\`html:moy-sait/index.html … \`\`\`, \`\`\`css:moy-sait/style.css … \`\`\`, \`\`\`markdown:moy-sait/README.md … \`\`\`.
- Все файлы клади в одну корневую папку с коротким латинским именем (она же станет именем архива).
- Сайт в папке: index.html + style.css + script.js (и другие файлы при необходимости), подключай их относительными путями (href="style.css", src="script.js"). Картинки — только по внешним ссылкам или SVG-файлами.
- Пиши файлы целиком, без «…» и сокращений. Только текстовые файлы.
- Если просят 7z или rar — делай так же: пользователь получит ZIP, он открывается любым архиватором (одной фразой упомяни это).
- Никогда не говори, что не можешь отправлять файлы или архивы, и не объясняй, как собрать архив вручную.
- Обычный «сделай сайт» без просьбы о папке/архиве — по-прежнему один HTML-файл без пути.`;
const SITES_DIR = path.join(__dirname, 'data', 'sites');
const PUBLISH_OFF = process.env.PUBLISH === 'off';
const pubHits = new Map();
const SETTINGS_DEF = { provider: 'duckduckgo', key: '', browser: true, selfcheck: true, code: true };
const loadSettings = () => ({ ...SETTINGS_DEF, ...store.kv.get('settings', {}) });
const saveSettings = (x) => store.kv.set('settings', x);
const WEB_NOTE = `\n\nУ тебя есть доступ в интернет через инструменты web_search и fetch_page.
- Ищи, когда вопрос касается свежих событий, цен, курсов, погоды, расписаний, конкретных фактов, в которых ты не уверен, или когда пользователь просит найти/проверить.
- Для простых вопросов и творческих задач интернет не нужен.
- Если сниппетов мало — открой 1–2 самые полезные страницы через fetch_page.
- В ответе ссылайся на источники Markdown-ссылками: [название](url). Не выдумывай ссылки.`;
const IMG_MODE_NOTE = '\n\nРЕЖИМ КАРТИНОК: пользователь включил кнопку «Картинка». Просьбы про изображение, арт, дизайн, иконки и макеты выполняй инструментом generate_image — не кодом, HTML или SVG. Если он уточняет или правит уже нарисованную картинку, это снова generate_image: новый промт с учётом уточнений, use_attached: true, чтобы сохранить детали. Вопросы, не связанные с картинками, отвечай обычным текстом.';
const VIEW_TOOL = { type: 'function', function: { name: 'view_page', description: 'Открыть страницу в браузере и посмотреть на её скриншот (дизайн, картинки, графики, расположение элементов). Используй, когда важно, как страница выглядит, а не только её текст.', parameters: { type: 'object', properties: { url: { type: 'string', description: 'Адрес страницы' } }, required: ['url'] } } };
const BROWSER_NOTE = '\n- fetch_page открывает страницу в настоящем браузере (Chromium): работают сайты, которые подгружают содержимое скриптами.';
const BROWSER_VIEW_NOTE = '\n- view_page показывает скриншот страницы — используй, когда нужно увидеть дизайн, картинки или графики.';
const LIMIT_SITE = '\n\nЛИМИТ: сегодня пользователь исчерпал создание сайтов по своему тарифу. Если он просит новый сайт или лендинг целиком — вежливо объясни это и предложи улучшить тариф (кнопка «Тарифы» в левом меню). Отвечать на вопросы и показывать небольшие фрагменты кода можно.';
const LIMIT_CODE = '\n\nЛИМИТ: запуски Python на сегодня исчерпаны по тарифу пользователя. Если нужен расчёт кодом — скажи об этом и предложи улучшить тариф или посчитать без запуска.';
const CHECK_PROMPT = (issues, vision, pack) => `[Автоматическая проверка Premier] Проверка в Chromium на desktop и mobile выявила проблемы:\n- ${issues.join('\n- ')}` +
  `\nИсправь только эти проблемы и верни ${pack ? 'файлы целиком с прежними путями' : 'полный HTML в блоке html'}. Ответ OK не считается исправлением. После этого Premier повторит проверку. Не заявляй заранее, что результат проверен.`;
// последний законченный HTML-сайт из ответа (одиночный блок или папка с index.html)
function lastSite(text) {
  const re = /```([\w-]*)([^\n]*)\n([\s\S]*?)```/g; let m, single = null; const files = new Map();
  while ((m = re.exec(text))) {
    const info = m[2].trim(), pm = info.match(/^:\s*(\S+)/) || info.match(/\b(?:path|file|filename)\s*=\s*["']?([^"'\s]+)/i);
    if (pm) files.set(pm[1].replace(/^\.?\//, ''), m[3]);
    else if ((/^html?$/i.test(m[1]) || !m[1]) && /<(!doctype|html|body)\b/i.test(m[3])) single = m[3];
  }
  const idx = [...files.keys()].filter((k) => /\.html?$/i.test(k)).sort((a, b) => /index\.html?$/i.test(b) - /index\.html?$/i.test(a) || a.length - b.length)[0];
  if (idx && files.size) {
    const dir = idx.replace(/[^/]*$/, ''), get = (ref) => files.get(path.posix.normalize(dir + ref.split(/[?#]/)[0]).replace(/^\.\//, ''));
    return { pack: true, html: files.get(idx).replace(/<link\b[^>]*>/gi, (t) => { if (!/stylesheet/i.test(t)) return t; const h = t.match(/href\s*=\s*["']([^"']+)/i)?.[1]; const c = h && !/^(https?:|\/\/)/.test(h) && get(h); return c != null && c !== false ? `<style>${c}</style>` : t; })
      .replace(/<script\b([^>]*?)\ssrc\s*=\s*["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (t, a, src, b) => { const c = !/^(https?:|\/\/)/.test(src) && get(src); return c ? `<script${a}${b}>${c.replace(/<\/script/gi, '<\\/script')}</script>` : t; }) };
  }
  return single ? { pack: false, html: single } : null;
}
/* ---------- чаты и память пользователей (на сервере) ---------- */
const loadState = (uid) => store.chats.full(uid);
const loadMem = (uid) => ({ on: true, items: [], ...store.kv.get('mem:' + uid, {}) });
const saveMem = (uid, x) => store.kv.set('mem:' + uid, x);
const MEM_TOOLS = [
  { type: 'function', function: { name: 'remember', description: 'Сохранить в долговременную память важный факт о пользователе (имя, работа, проекты, предпочтения в ответах), чтобы учитывать его в будущих чатах.', parameters: { type: 'object', properties: { text: { type: 'string', description: 'Факт одной короткой фразой в третьем лице, например: «Зовут Иван, работает дизайнером»' } }, required: ['text'] } } },
  { type: 'function', function: { name: 'forget', description: 'Удалить факт из памяти по его id (когда пользователь просит забыть или факт устарел).', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },
];
const memNote = (items) => `\n\nДОЛГОВРЕМЕННАЯ ПАМЯТЬ. ${items.length ? 'Что ты знаешь о пользователе из прошлых разговоров (id — в скобках):\n' + items.map((x) => `- (${x.id}) ${x.text}`).join('\n') + '\nУчитывай это естественно, не перечисляй без просьбы.' : 'Пока ты ничего не знаешь о пользователе.'}
- Если пользователь сообщает устойчивые факты о себе или предпочтения (имя, работа, проекты, город, стиль ответов) или просит что-то запомнить — вызови remember. Кратко упомяни, что запомнил.
- Не запоминай разовые задачи, мелочи и чувствительные данные (пароли, номера карт, здоровье — только по прямой просьбе).
- Если просит забыть или факт изменился — вызови forget (и при необходимости remember с новым фактом).`;
const tokens = new Map(); // token -> expires
const TOKEN_TTL = 12 * 60 * 60 * 1000;

/* ---------- аккаунты ---------- */
const SESS_TTL = 180 * 24 * 3600 * 1000; // 180 дней
const COOKIE = 'premier_session';
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const publicUser = (u) => ({ id: u.id, login: u.login, name: u.name || u.login, created: u.created, email: u.email || '', google: !!u.google, github: u.github ? (u.ghLogin || true) : false, wm: u.wm === true });
function deleteUser(id) {
  assets.removeUser(id);
  store.users.remove(id); // вместе с сессиями, чатами и памятью
  coder.removeUser(id);
}
bill.init({ loadSettings: () => loadSettings(), saveSettings: (x) => saveSettings(x), imagesOn: () => imager.ready(loadSettings()), videosOn: () => videor.ready(loadSettings()) });
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
// заголовкам X-Forwarded-* верим только от своего прокси (иначе адрес можно подменить); надёжнее всего задать PUBLIC_URL
const viaProxy = (req) => process.env.TRUST_PROXY === '1' || (process.env.TRUST_PROXY !== '0' && fromProxy(req.socket.remoteAddress || ''));
const originOf = (req) => PUBLIC_URL || (((viaProxy(req) && req.headers['x-forwarded-proto'] === 'https') || req.socket.encrypted ? 'https' : 'http') + '://' + String((viaProxy(req) && req.headers['x-forwarded-host']) || req.headers.host || 'localhost').replace(/[^\w.:\-\[\]]/g, ''));
// настоящий IP клиента. Заголовкам прокси верим, только если запрос пришёл от прокси на этой машине/в локальной сети
// (nginx, Caddy, Docker) — иначе их может подделать кто угодно. TRUST_PROXY=0 — никогда не верить, 1 — верить всегда.
const fromProxy = (ip) => /^(::1|127\.|::ffff:127\.|10\.|::ffff:10\.|192\.168\.|::ffff:192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::ffff:172\.(1[6-9]|2\d|3[01])\.|f[cd])/i.test(ip);
const clientIp = (req) => {
  const sock = req.socket.remoteAddress || '?', tp = process.env.TRUST_PROXY;
  if (tp === '0' || (tp !== '1' && !fromProxy(sock))) return sock;
  const real = String(req.headers['x-real-ip'] || '').trim(); if (real) return real;
  const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((x) => x.trim()).filter(Boolean);
  return xff.length ? xff[xff.length - 1] : sock; // последний адрес добавил наш прокси — его не подделать
};
const regOpen = () => loadSettings().register !== false;
// аккаунт заранее (панель): по почте Google; привяжется при первом входе через Google
function createByEmail(email, name) {
  email = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return { err: 'Введите почту' };
  if (store.users.byEmail(email)) return { err: 'Аккаунт с этой почтой уже есть' };
  const u = { id: crypto.randomBytes(6).toString('hex'), login: uniqueLogin(email, name), email, created: new Date().toISOString() };
  const n = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 40); if (n) u.name = n;
  store.users.put(u); return { user: u };
}
function cookies(req) { const o = {}; for (const part of (req.headers.cookie || '').split(';')) { const i = part.indexOf('='); if (i > 0) o[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } return o; }
function currentUser(req) {
  const t = cookies(req)[COOKIE]; if (!t) return null;
  const s = store.sessions.get(sha(t)); if (!s) return null;
  return store.users.get(s.uid);
}
function startSession(req, res, u) {
  const t = crypto.randomBytes(32).toString('hex');
  store.sessions.put(sha(t), u.id, Date.now() + SESS_TTL);
  const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${t}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESS_TTL / 1000}${secure}`);
}
/* ---------- вход через Google (OAuth 2.0) ---------- */
const G_ID = process.env.GOOGLE_CLIENT_ID || '', G_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const googleOn = () => !!(G_ID && G_SECRET);
const gRedirect = (req) => originOf(req) + '/api/auth/google/callback';
const isHttps = (req) => req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted || PUBLIC_URL.startsWith('https:');
function uniqueLogin(email, name) {
  let base = String(email.split('@')[0] || name || 'user').normalize('NFKC').replace(/[^\p{L}\p{N}_.-]/gu, '').slice(0, 24);
  if (base.length < 3) base = (base + 'user').slice(0, 24);
  const taken = (l) => store.users.loginTaken(l);
  let l = base; for (let i = 2; taken(l); i++) l = base + i;
  return l;
}
async function googleUser(code, req, ip) {
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: G_ID, client_secret: G_SECRET, redirect_uri: gRedirect(req), grant_type: 'authorization_code' }), signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.id_token) throw new Error('token: ' + (j.error_description || j.error || r.status));
  // id_token получен напрямую от Google по HTTPS — подпись можно не проверять, но aud/iss/срок проверяем
  const t = JSON.parse(Buffer.from(j.id_token.split('.')[1], 'base64url').toString('utf8'));
  if (t.aud !== G_ID || !/^(https:\/\/)?accounts\.google\.com$/.test(t.iss) || t.exp * 1000 < Date.now()) throw new Error('bad id_token');
  if (!t.sub || !t.email || t.email_verified === false) throw new Error('email not verified');
  const email = String(t.email).toLowerCase();
  let u = store.users.byGoogle(t.sub);
  if (!u) { const pre = store.users.byEmail(email); if (pre && !pre.google) return { user: bill.updateUser(pre.id, (x) => { x.google = t.sub; }) || pre }; }
  if (u) { if (u.email !== email) bill.updateUser(u.id, (x) => { x.email = email; }); return { user: u }; }
  if (!regOpen()) return { err: 'closed' };
  u = { id: crypto.randomBytes(6).toString('hex'), login: uniqueLogin(email, t.name), email, google: t.sub, created: new Date().toISOString() };
  const nm = String(t.name || '').trim().slice(0, 40); if (nm) u.name = nm;
  bill.startTrial(u, ip);
  store.users.put(u); return { user: u, created: true };
}
/* ---------- вход через GitHub (OAuth App) ---------- */
const GH_ID = process.env.GITHUB_CLIENT_ID || '', GH_SECRET = process.env.GITHUB_CLIENT_SECRET || '';
const GH_WEB = (process.env.GITHUB_OAUTH_URL || 'https://github.com').replace(/\/+$/, ''), GH_API = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, ''); // свои адреса — для GitHub Enterprise и тестов
const githubOn = () => !!(GH_ID && GH_SECRET);
const ghRedirect = (req) => originOf(req) + '/api/auth/github/callback';
async function githubUser(code, req, ip) {
  const r = await fetch(GH_WEB + '/login/oauth/access_token', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: GH_ID, client_secret: GH_SECRET, code, redirect_uri: ghRedirect(req) }), signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('token: ' + (j.error_description || j.error || r.status));
  const api = async (p) => { const x = await fetch(GH_API + p, { headers: { Authorization: 'Bearer ' + j.access_token, Accept: 'application/vnd.github+json', 'User-Agent': 'Premier', 'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(15000) }); if (!x.ok) throw new Error(p + ': ' + x.status); return x.json(); };
  const gh = await api('/user'); if (!gh || !gh.id) throw new Error('нет id пользователя');
  // только подтверждённая почта: по ней аккаунт GitHub связывается с уже существующим (например, созданным через Google)
  const emails = await api('/user/emails').catch(() => []);
  const em = (Array.isArray(emails) ? emails : []).filter((e) => e && e.verified && e.email && !/@users\.noreply\.github\.com$/i.test(e.email)).sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0))[0];
  const id = String(gh.id), ghLogin = String(gh.login || '').slice(0, 40);
  let u = store.users.byGithub(id);
  if (u) { if (u.ghLogin !== ghLogin) bill.updateUser(u.id, (x) => { x.ghLogin = ghLogin; }); return { user: u }; }
  if (!em) return { err: 'github_email' };
  const email = String(em.email).toLowerCase();
  const pre = store.users.byEmail(email);
  if (pre && !pre.github) return { user: bill.updateUser(pre.id, (x) => { x.github = id; x.ghLogin = ghLogin; }) || pre };
  if (!regOpen()) return { err: 'closed' };
  u = { id: crypto.randomBytes(6).toString('hex'), login: uniqueLogin(ghLogin ? ghLogin + '@' : email, gh.name), email, github: id, ghLogin, created: new Date().toISOString() };
  const nm = String(gh.name || '').trim().slice(0, 40); if (nm) u.name = nm;
  bill.startTrial(u, ip);
  store.users.put(u); return { user: u, created: true };
}
const authHits = new Map(); // ip -> [timestamps неудачных попыток]
function limited(ip, max, win) { const now = Date.now(); const h = (authHits.get(ip) || []).filter((t) => now - t < win); authHits.set(ip, h); return h.length >= max; }
const hit = (ip) => authHits.get(ip)?.push(Date.now()) ?? authHits.set(ip, [Date.now()]);
setInterval(() => { const old = Date.now() - 864e5; for (const [k, h] of authHits) if (!h.length || h[h.length - 1] < old) authHits.delete(k); }, 600000).unref(); // счётчики не копятся бесконечно

const { languageOf, languageHeaders, htmlPath, localizeResponse } = require('./language');
// apiId/apiAliases остались от удалённого пользовательского API — вычищаем из сохранённых моделей
const loadModels = () => { const models = store.kv.get('models', []); let dirty = false; for (const m of models) if ('apiId' in m || 'apiAliases' in m) { delete m.apiId; delete m.apiAliases; dirty = true; } if (dirty) store.kv.set('models', models); return models; };
const saveModels = (models) => { store.kv.set('models', models); };
const defModel = () => loadSettings().defaultModel || '';
const publicModel = (m) => ({ id: m.id, name: m.name, vision: !!m.vision, plans: bill.modelPlans(m), weight: m.weight || 1, def: m.id === defModel() });
const cleanPlans = (a) => Array.isArray(a) ? [...new Set(a.map(String))].filter((id) => bill.cfg().plans.some((p) => p.id === id)) : null;
const setDef = (id) => { const st = loadSettings(); st.defaultModel = id; saveSettings(st); };
const adminModel = (m) => ({ id: m.id, name: m.name, modelId: m.modelId, baseUrl: m.baseUrl, apiKey: m.apiKey ? m.apiKey.slice(0, 4) + '••••' + m.apiKey.slice(-4) : '', vision: !!m.vision, plans: bill.modelPlans(m), weight: m.weight || 1, def: m.id === defModel(), prompt: m.prompt || '', promptMode: m.promptMode === 'replace' ? 'replace' : 'add' });

function json(res, code, data) { if (res.req) { languageHeaders(res.req, res); res.setHeader('Cache-Control','no-store'); } res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(localizeResponse(res.req, data))); }
// limit — максимальный размер тела: по умолчанию 1 МБ, больше только там, где это нужно (чат с картинками, чаты, публикация)
// Живые генерации, продолжающиеся после отключения клиента (телефон ушёл в фон)
const liveGens = new Map(); // genId -> { uid, lines: [], subs: Set, done, finishedAt, orphanTimer, startedAt, abortNow }
setInterval(() => { const now = Date.now(); for (const [gid, g] of liveGens) { if ((g.done && now - (g.finishedAt || now) > 30 * 60000) || now - g.startedAt > 45 * 60000) liveGens.delete(gid); } }, 5 * 60000).unref();
// сырое тело (для проверки подписи вебхуков)
function readRaw(req, limit = 1e6) {
  return new Promise((ok, fail) => { const parts = []; let n = 0; req.on('data', (c) => { n += c.length; if (n > limit) { fail(Object.assign(new Error('Слишком большой запрос'), { status: 413 })); req.destroy(); } else parts.push(c); }); req.on('end', () => ok(Buffer.concat(parts).toString('utf8'))); req.on('error', fail); });
}
function readBody(req, limit = 1e6) {
  return new Promise((ok, fail) => {
    let s = '', over = false; req.setEncoding('utf8');
    req.on('data', (c) => { if (over) return; s += c; if (s.length > limit) { over = true; s = ''; fail(Object.assign(new Error('Слишком большой запрос'), { status: 413 })); } });
    req.on('end', () => { if (over) return; try { ok(s ? JSON.parse(s) : {}); } catch { fail(new Error('bad json')); } });
  });
}
function isAdmin(req) {
  const t = (req.headers.authorization || '').replace(/^Bearer /, '');
  const exp = tokens.get(t); if (!exp) return false;
  if (exp < Date.now()) { tokens.delete(t); return false; } return true;
}
function endpoint(baseUrl) {
  const u = baseUrl.trim().replace(/\/+$/, '');
  return /\/chat\/completions$/.test(u) ? u : u + '/chat/completions';
}

// ---------- мониторинг моделей: фоновые «пинги» каждые 20 минут ----------
// Сырой текст ошибок провайдеров (их имена, JSON, чужие языки) ни на страницу, ни в базу
// не попадает: всегда заменяется нейтральной формулировкой.
const MON_ERR = { queue: 'Пиковая нагрузка (очередь запросов)', over: 'Узел модели временно перегружен', timeout: 'Таймаут ответа', empty: 'Пустой ответ модели', other: 'Ошибка модели' };
function monSafeErr(e) {
  const s = String(e || '').trim();
  if (!s) return null;
  if (s.startsWith('HTTP 429')) return MON_ERR.queue;
  if (s.startsWith('HTTP 502') || s.startsWith('HTTP 503')) return MON_ERR.over;
  const h = /^HTTP (\d{3})/.exec(s); if (h) return 'Ошибка провайдера (код ' + h[1] + ')';
  if (/таймаут|timeout|abort/i.test(s)) return MON_ERR.timeout;
  if (/пустой ответ/.test(s)) return MON_ERR.empty;
  if (s === MON_ERR.other || s === 'ошибка') return MON_ERR.other;
  return MON_ERR.other;
}
let monBusy = false;
const monRow = (model, ok, ms, first, err) => { try { store.db.prepare('INSERT INTO modelstats (model, kind, ok, ms, first, err, at) VALUES (?,?,?,?,?,?,?)').run(model, 'probe', ok ? 1 : 0, ms, first, monSafeErr(err), Date.now()); } catch {} };
async function probeModels() {
  if (monBusy) return; monBusy = true;
  try {
    for (const m of loadModels()) {
      try {
        const t0 = Date.now();
        const r = await fetch(endpoint(m.baseUrl), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + m.apiKey }, body: JSON.stringify({ model: m.modelId || m.id, messages: [{ role: 'user', content: '1' }], max_tokens: 1, stream: false }), signal: AbortSignal.timeout(60000) });
        const ms = Date.now() - t0;
        if (!r.ok) { if (r.body) { try { await r.body.cancel(); } catch {} } monRow(m.id, false, ms, null, 'HTTP ' + r.status); }
        else { const j = await r.json().catch(() => ({})); const c = j.choices && j.choices[0]; monRow(m.id, !!(c && (c.message || c.text)), ms, null, c ? null : 'пустой ответ'); }
      } catch (e) { monRow(m.id, false, null, null, e && e.name === 'TimeoutError' ? 'таймаут' : 'ошибка'); }
      await new Promise((x) => setTimeout(x, 1500));
    }
    try { store.db.prepare('DELETE FROM modelstats WHERE at < ?').run(Date.now() - 7 * 864e5); } catch {}
  } finally { monBusy = false; }
}
setInterval(() => { probeModels().catch(() => {}); }, 20 * 60e3).unref();
probeModels().catch(() => {});
let adminCheck = null;
async function adminCheckAll() {
  const list = loadModels();
  adminCheck = { at: Date.now(), done: 0, total: list.length };
  for (const m of list) {
    try {
      const t0 = Date.now();
      const r = await fetch(endpoint(m.baseUrl), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + m.apiKey }, body: JSON.stringify({ model: m.modelId || m.id, messages: [{ role: 'user', content: '1' }], max_tokens: 1, stream: false }), signal: AbortSignal.timeout(60000) });
      const ms = Date.now() - t0;
      if (!r.ok) { if (r.body) { try { await r.body.cancel(); } catch {} } monRow(m.id, false, ms, null, 'HTTP ' + r.status); }
      else { const j = await r.json().catch(() => ({})); const c = j.choices && j.choices[0]; monRow(m.id, !!(c && (c.message || c.text)), ms, null, c ? null : 'пустой ответ'); }
    } catch (e) { monRow(m.id, false, null, null, String((e && e.name === 'TimeoutError') ? 'таймаут 60с' : (e && e.message) || e).slice(0, 120)); }
    adminCheck.done++;
    await new Promise((x) => setTimeout(x, 800));
  }
}
const apiBase = (u) => String(u || '').trim().replace(/\/+$/, '').replace(/\/(chat\/completions|models)$/, '');
const modelsUrl = (u) => apiBase(u) + '/models';
const sameBase = (a, b) => apiBase(a) === apiBase(b);
// откуда брать ключ: введён вручную или взять у уже подключённой модели (fromId)
function provSrc(b) {
  let baseUrl = String(b.baseUrl || '').trim(), apiKey = String(b.apiKey || '').trim();
  if (b.fromId) { const ex = loadModels().find((x) => x.id === b.fromId); if (!ex) return { err: 'Модель-источник ключа не найдена' }; apiKey ||= ex.apiKey; baseUrl ||= ex.baseUrl; }
  try { if (!/^https?:$/.test(new URL(baseUrl).protocol)) throw 0; } catch { return { err: 'Укажите URL API, например https://openrouter.ai/api/v1' }; }
  if (!apiKey) return { err: 'Укажите API-ключ' };
  return { baseUrl: apiBase(baseUrl), apiKey };
}
// модель из ответа /models: OpenAI, OpenRouter (имя, картинки, цены, контекст), Ollama, Gemini
function provModel(x) {
  if (typeof x === 'string') x = { id: x };
  const id = String(x.id || x.model || x.name || '').replace(/^models\//, ''); if (!id) return null;
  const inMod = x.architecture?.input_modalities || x.input_modalities || [], outMod = x.architecture?.output_modalities || x.output_modalities || [];
  const nm = String(x.name || x.display_name || x.displayName || '').trim();
  const name = (nm && nm !== id ? nm.replace(/^[^:]{1,40}:\s*/, '') : id.split('/').pop().replace(/[-_]/g, ' ').replace(/\b([a-z])/g, (c) => c.toUpperCase())).slice(0, 60);
  const pr = x.pricing || {}, per = (v) => (v == null || v === '' || isNaN(+v) ? null : +(+v * 1e6).toFixed(3));
  const vision = inMod.includes('image') || /vision|-vl\b|vl-|gpt-4o|gpt-4\.1|gpt-5|claude-3|claude-(sonnet|opus|haiku)|gemini|pixtral|llava|qwen.*vl|kimi-k2\.5|kimi-k3|grok-4/i.test(id);
  const chat = !(outMod.length && (!outMod.includes('text') || outMod.includes('image'))) && !/-image(-preview)?$/.test(id) && !/embed|whisper|tts|dall-e|moderation|transcribe|realtime|davinci|babbage|search-preview|rerank|guard|image-gen|gpt-image|imagen|flux|stable-diffusion|sdxl/i.test(id);
  return { id, name, vision, chat, ctx: x.context_length || x.context_window || x.inputTokenLimit || null, pin: per(pr.prompt), pout: per(pr.completion), free: /:free$/.test(id) || (pr.prompt === '0' && pr.completion === '0'), desc: String(x.description || '').slice(0, 220) };
}
// системный промт модели: необязательный; «add» — дописывается к промту Premier, «replace» — заменяет его целиком
function cleanPrompt(b) {
  const prompt = typeof b.prompt === 'string' ? b.prompt.replace(/\r\n/g, '\n').trim().slice(0, 200000) : '';
  return prompt ? { prompt, promptMode: b.promptMode === 'replace' ? 'replace' : 'add' } : {};
}
function systemFor(model) {
  const p = (model.prompt || '').trim(); if (!p) return SYSTEM_PROMPT;
  if (model.promptMode === 'replace') return p;
  return SYSTEM_PROMPT + '\n\nДополнительные инструкции администратора для этой модели (соблюдай их всегда, они важнее общих правил выше):\n' + p;
}
function validModel(b) {
  const f = ['name', 'modelId', 'baseUrl', 'apiKey'];
  for (const k of f) if (!b[k] || typeof b[k] !== 'string' || !b[k].trim()) return 'Заполните поле: ' + k;
  try { const u = new URL(b.baseUrl); if (!/^https?:$/.test(u.protocol)) throw 0; } catch { return 'Некорректный URL'; }
  return null;
}
async function upstreamError(r) {
  let t = await r.text().catch(() => '');
  try { const j = JSON.parse(t); t = j.error?.message || j.message || t; } catch {}
  const s = String(t).trim();
  // провайдер/CDN вернул HTML-страницу ошибки вместо JSON — не вываливаем разметку в чат
  if (s.startsWith('<')) return `Модель ответила ошибкой ${r.status} — провайдер вернул страницу ошибки (внешний сбой). Попробуйте ещё раз или выберите другую модель.`;
  return `Модель ответила ошибкой ${r.status}: ${s.slice(0, 300)}`;
}

const publications = createPublicationServer({ dir: SITES_DIR, users: store.users, bill, wmOn: () => loadSettings().watermark !== false });

async function handleApi(req, res, url) {
  const p = url.pathname, m = req.method;

  if (p.startsWith('/api/assets/')) {
    const u = currentUser(req); if (!u) return json(res, 401, { error: 'Войдите в аккаунт' });
    if (m !== 'GET') return json(res, 405, { error: 'Только GET' });
    const record = assets.manifest(u.id, p.slice('/api/assets/'.length));
    return json(res, record ? 200 : 404, record || { error: 'Модель не найдена' });
  }
  const ip = clientIp(req);
  // Reviews: public responses never expose account IDs or moderation status.
  if (p === '/api/reviews') {
    if (m === 'GET') {
      const page = Math.min(1000000, Math.max(1, parseInt(url.searchParams.get('page'), 10) || 1));
      const rows = store.db.prepare("SELECT id, uid, nick, rating, text, at FROM reviews WHERE status = 'approved' ORDER BY at DESC, rowid DESC LIMIT 24 OFFSET ?").all((page - 1) * 24);
      return json(res, 200, rows.map(({ uid, ...r }) => {
        const plan = bill.planOf(store.users.get(uid)).id;
        return { ...r, plan: plan === 'pro' || plan === 'max' ? plan : 'free' };
      }));
    }
    if (m !== 'POST') return json(res, 405, { error: 'Метод не поддерживается' });
    const u = currentUser(req); if (!u) return json(res, 401, { error: 'Войдите в аккаунт' });
    const key = 'reviews:' + ip;
    if (limited(key, 5, 3600e3)) { res.setHeader('Retry-After', '3600'); return json(res, 429, { error: 'Слишком много попыток. Попробуйте через час' }); }
    hit(key); // limited() only reads the counter; record every submission attempt.
    if (req.headers['sec-fetch-site'] === 'cross-site' || !/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return json(res, 400, { error: 'Отправьте JSON-запрос с сайта' });
    const b = await readBody(req, 16000);
    if (!b || typeof b !== 'object' || Array.isArray(b)) return json(res, 400, { error: 'Некорректный отзыв' });
    const nick = typeof b.nick === 'string' ? b.nick.trim() : '', text = typeof b.text === 'string' ? b.text.trim() : '';
    if (b.consent !== true) return json(res, 400, { error: 'Нужно согласие на публикацию' });
    if (!Number.isInteger(b.rating) || b.rating < 1 || b.rating > 5) return json(res, 400, { error: 'Выберите оценку от 1 до 5' });
    if (text.length < 20 || text.length > 2000) return json(res, 400, { error: 'Текст отзыва — от 20 до 2000 символов' });
    if (!/^[a-zA-Z0-9_.-]{2,24}$/.test(nick)) return json(res, 400, { error: 'Ник — 2–24 символа: латиница, цифры, _, . и -' });
    const owner = store.users.byLogin(nick);
    if (owner && owner.id !== u.id) return json(res, 400, { error: 'Ник уже занят' });
    // One account may leave several reviews (different nicknames); the same account + nickname pair stays unique.
    if (store.db.prepare('SELECT 1 FROM reviews WHERE uid = ? AND nick = ?').get(u.id, nick)) return json(res, 409, { error: 'Отзыв с этим ником уже оставлен' });
    // The unique (uid, nick) index also protects parallel requests.
    try {
      store.db.prepare("INSERT INTO reviews (id, uid, nick, rating, text, status, at) VALUES (?, ?, ?, ?, ?, 'pending', ?)").run(crypto.randomBytes(6).toString('hex'), u.id, nick, b.rating, text, Date.now());
    } catch (e) {
      if (store.db.prepare('SELECT 1 FROM reviews WHERE uid = ? AND nick = ?').get(u.id, nick)) return json(res, 409, { error: 'Отзыв с этим ником уже оставлен' });
      throw e;
    }
    return json(res, 201, { ok: true });
  }
  if (p === '/api/auth/me' && m === 'GET') { const u = currentUser(req); return json(res, 200, { user: u ? publicUser(u) : null, register: regOpen(), google: googleOn(), github: githubOn() }); }
  if (p === '/api/referrals/bind' && m === 'POST') {
    const u = currentUser(req); if (!u) return json(res, 401, { error: 'Войдите в аккаунт' });
    const b = await readBody(req).catch(() => ({}));
    const r = bill.refBind(u, b.code, clientIp(req), String(b.fp || '').slice(0, 128));
    return json(res, r.code, r);
  }
  if (p === '/api/auth/register' && m === 'POST') { return json(res, 410, { error: 'Регистрация по почте отключена — войдите через Google или GitHub' });
    const b = await readBody(req).catch(() => ({}));
    const refOpen = (() => { try { const c = String(b.ref || ''); return /^[a-f0-9]{12}$/.test(c) && !!store.users.get(c); } catch { return false; } })();
    if (!regOpen() && !refOpen) return json(res, 403, { error: 'Регистрация закрыта — аккаунт выдаёт администратор.' });
    const email = String(b.email || '').trim().toLowerCase();
    const password = String(b.password || '');
    const name = String(b.name || '').trim().slice(0, 40);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json(res, 400, { error: 'Введите корректную почту' });
    if (password.length < 4) return json(res, 400, { error: 'Пароль — минимум 4 символа' });
    if (limited(ip, 3, 10 * 60000)) return json(res, 429, { error: 'Слишком много попыток. Подождите 10 минут.' });
    if (store.users.byEmail(email)) return json(res, 409, { error: 'Такая почта уже есть — войдите под ней' });
    const salt = crypto.randomBytes(16).toString('hex');
    const u = { id: crypto.randomBytes(6).toString('hex'), login: uniqueLogin(email, name || email), email, created: new Date().toISOString() };
    if (name) u.name = name;
    u.pw = { salt, hash: crypto.scryptSync(password, salt, 32).toString('hex') };
    bill.startTrial(u, ip);
    store.users.put(u);
    if (b.ref) { try { bill.refBind(u, b.ref, ip, String(b.fp || '').slice(0, 128)); } catch (e) { console.log('refBind:', e.message); } }
    startSession(req, res, u);
    return json(res, 201, { user: publicUser(u) });
  }
  if (p === '/api/auth/login' && m === 'POST') { return json(res, 410, { error: 'Вход по почте отключён — войдите через Google или GitHub' });
    const b = await readBody(req).catch(() => ({}));
    const email = String(b.email || '').trim().toLowerCase();
    const password = String(b.password || '');
    if (!email || !password) return json(res, 400, { error: 'Введите почту и пароль' });
    const u = store.users.byEmail(email);
    const fail = (code, msg) => { hit(ip); return json(res, code, { error: msg }); };
    if (limited(ip, 10, 10 * 60000)) return json(res, 429, { error: 'Слишком много попыток. Подождите 10 минут.' });
    if (!u || !u.pw) return fail(401, 'Неверная почта или пароль');
    const ok = crypto.timingSafeEqual(crypto.scryptSync(password, u.pw.salt, 32), Buffer.from(u.pw.hash, 'hex'));
    if (!ok) return fail(401, 'Неверная почта или пароль');
    startSession(req, res, u);
    return json(res, 200, { user: publicUser(u) });
  }
  if (p === '/api/auth/google' && m === 'GET') {
    if (!googleOn()) { res.writeHead(302, { Location: '/login?err=google_off' }); return res.end(); }
    const st = crypto.randomBytes(16).toString('hex');
    const q = new URLSearchParams({ client_id: G_ID, redirect_uri: gRedirect(req), response_type: 'code', scope: 'openid email profile', state: st, prompt: 'select_account' });
    res.writeHead(302, { Location: 'https://accounts.google.com/o/oauth2/v2/auth?' + q, 'Set-Cookie': `g_state=${st}; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=600${isHttps(req) ? '; Secure' : ''}` });
    return res.end();
  }
  if (p === '/api/auth/google/callback' && m === 'GET') {
    const back = (err) => { res.writeHead(302, { Location: err ? '/login?err=' + err : '/chat', 'Set-Cookie': 'g_state=; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=0' }); res.end(); };
    if (!googleOn()) return back('google_off');
    if (url.searchParams.get('error')) return back('google_cancel');
    const st = url.searchParams.get('state') || '', code = url.searchParams.get('code') || '', ck = cookies(req).g_state || '';
    if (!st || !ck || st.length !== ck.length || !crypto.timingSafeEqual(Buffer.from(st), Buffer.from(ck)) || !code) return back('google_state');
    if (limited(ip, 20, 10 * 60000)) return back('google_limit');
    try {
      const r = await googleUser(code, req, ip);
      if (r.err) return back(r.err);
      if (r.created) hit(ip);
      startSession(req, res, r.user);
      const sc = res.getHeader('Set-Cookie');
      res.writeHead(302, { Location: '/chat', 'Set-Cookie': [sc, 'g_state=; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=0'] }); return res.end();
    } catch (e) { console.error('Google вход:', e.message); return back('google_fail'); }
  }
  if (p === '/api/auth/github' && m === 'GET') {
    if (!githubOn()) { res.writeHead(302, { Location: '/login?err=github_off' }); return res.end(); }
    const st = crypto.randomBytes(16).toString('hex');
    const q = new URLSearchParams({ client_id: GH_ID, redirect_uri: ghRedirect(req), scope: 'read:user user:email', state: st, allow_signup: 'true' });
    res.writeHead(302, { Location: GH_WEB + '/login/oauth/authorize?' + q, 'Set-Cookie': `gh_state=${st}; Path=/api/auth/github; HttpOnly; SameSite=Lax; Max-Age=600${isHttps(req) ? '; Secure' : ''}` });
    return res.end();
  }
  if (p === '/api/auth/github/callback' && m === 'GET') {
    const clr = 'gh_state=; Path=/api/auth/github; HttpOnly; SameSite=Lax; Max-Age=0';
    const back = (err) => { res.writeHead(302, { Location: err ? '/login?err=' + err : '/chat', 'Set-Cookie': clr }); res.end(); };
    if (!githubOn()) return back('github_off');
    if (url.searchParams.get('error')) return back('github_cancel');
    const st = url.searchParams.get('state') || '', code = url.searchParams.get('code') || '', ck = cookies(req).gh_state || '';
    if (!st || !ck || st.length !== ck.length || !crypto.timingSafeEqual(Buffer.from(st), Buffer.from(ck)) || !code) return back('github_state');
    if (limited(ip, 20, 10 * 60000)) return back('github_limit');
    try {
      const r = await githubUser(code, req, ip);
      if (r.err) return back(r.err);
      if (r.created) hit(ip);
      startSession(req, res, r.user);
      res.writeHead(302, { Location: '/chat', 'Set-Cookie': [res.getHeader('Set-Cookie'), clr] }); return res.end();
    } catch (e) { console.error('GitHub вход:', e.message); return back('github_fail'); }
  }
  if (p === '/api/auth/logout' && m === 'POST') {
    const t = cookies(req)[COOKIE]; if (t) store.sessions.del(sha(t));
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`); return json(res, 200, { ok: true });
  }

  if (p === '/api/pay/crypto' && m === 'POST') { const r = await bill.cryptoCallback(req.headers, await readRaw(req)); return json(res, r.code, { ok: r.code === 200 }); }
  if (p === '/api/pay/cispay' && m === 'POST') { const r = await bill.cisCallback(req.headers, await readRaw(req)); return json(res, r.code, { ok: r.code === 200 }); }
  if (p === '/api/pay/robokassa' && m === 'POST') { const r = bill.rbCallback(Object.fromEntries(new URLSearchParams(await readRaw(req)))); res.writeHead(r.code, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end(r.body || ''); }
  if (p === '/api/pay/callback' && m === 'POST') { const r = await bill.callback(req.headers, await readBody(req)); return json(res, r.code, { ok: r.code === 200 }); }
  if (p === '/api/plans' && m === 'GET') return json(res, 200, { plans: bill.publicPlans(), images: imager.ready(loadSettings()), videos: videor.ready(loadSettings()), trialDays: bill.cfg().trialDays, models: loadModels().map((x) => ({ name: x.name, plans: bill.modelPlans(x) })) });
  if (p.startsWith('/api/billing') || p.startsWith('/api/pay/')) {
    const u = currentUser(req); if (!u) return json(res, 401, { error: 'Войдите в аккаунт' });
    if (p === '/api/billing' && m === 'GET') return json(res, 200, bill.summary(u));
    if (p === '/api/billing/promo' && m === 'POST') {
      if (limited('promo:' + u.id, 10, 10 * 60000)) return json(res, 429, { error: 'Слишком много попыток. Подождите 10 минут.' });
      const r = bill.redeem(u, (await readBody(req)).code); if (r.error) { hit('promo:' + u.id); return json(res, 400, r); }
      return json(res, 200, { ...r, billing: bill.summary(bill.updateUser(u.id, () => {}) || u) });
    }
    if (p === '/api/pay/create' && m === 'POST') {
      const b = await readBody(req);
      try { return json(res, 200, await bill.create(u, String(b.plan || ''), b.promo ? String(b.promo) : '', originOf(req), clientIp(req), b.method === 'crypto' ? 'crypto' : b.method === 'robokassa' ? 'robokassa' : b.method === 'cispay' ? 'cispay' : b.method === 'card' ? 'card' : '')); }
      catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (p === '/api/pay/check' && m === 'GET') {
      let pay = bill.findPay(String(url.searchParams.get('order') || '')); if (!pay || pay.uid !== u.id) return json(res, 404, { error: 'Платёж не найден' });
      if (pay.status === 'PENDING') { try { pay = await bill.sync(pay); } catch (e) { return json(res, 200, { status: 'PENDING', error: e.message }); } }
      return json(res, 200, { status: pay.status, billing: bill.summary(store.users.get(u.id) || u) });
    }
    return json(res, 404, { error: 'Not found' });
  }

  if (p.startsWith('/api/account')) {
    const u = currentUser(req); if (!u) return json(res, 401, { error: 'Войдите в аккаунт' });
    const b = m === 'GET' ? {} : await readBody(req), mySess = sha(cookies(req)[COOKIE] || '');
    if (p === '/api/account' && m === 'GET') return json(res, 200, { ...publicUser(u), sessions: store.sessions.count(u.id) });
    if (p === '/api/account/name' && m === 'POST') {
      const name = String(b.name || '').trim().replace(/\s+/g, ' ');
      if (name.length < 1 || name.length > 40) return json(res, 400, { error: 'Имя: от 1 до 40 символов' });
      const nu = bill.updateUser(u.id, (x) => { x.name = name; }); return json(res, 200, publicUser(nu));
    }
    if (p === '/api/account/watermark' && m === 'POST') { const nu = bill.updateUser(u.id, (x) => { x.wm = !!b.on; }); return json(res, 200, { wm: nu.wm === true }); }
    if (p === '/api/account/logout-all' && m === 'POST') { store.sessions.delOthers(u.id, mySess); return json(res, 200, { ok: true }); }
    if (p === '/api/account' && m === 'DELETE') {
      if (!['удалить', 'delete'].includes(String(b.confirm || '').trim().toLowerCase())) return json(res, 400, { error: 'Введите слово «удалить»' });
      deleteUser(u.id); res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`); return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: 'Not found' });
  }

  // озвучка ответов (RHVoice на этом сервере)
  if (p === '/api/tts') {
    const u = currentUser(req); if (!u) return json(res, 401, { error: 'Войдите в аккаунт' });
    if (m === 'GET') return json(res, 200, { voices: tts.voices() });
    if (m === 'POST') {
      const b = await readBody(req, 20000);
      try {
        const wav = await tts.synth(b.text, String(b.voice || ''), +b.rate || 1);
        res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': wav.length, 'Cache-Control': 'private, max-age=86400' }); return res.end(wav);
      } catch (e) { return json(res, e.status || 503, { error: e.message }); }
    }
    return json(res, 405, { error: 'Method not allowed' });
  }
  if (p.startsWith('/api/state') || p === '/api/sync' || p.startsWith('/api/memory') || p.startsWith('/api/files/')) {
    const u = currentUser(req); if (!u) return json(res, 401, { error: 'Войдите в аккаунт' });
    if (p === '/api/state' && m === 'GET') return json(res, 200, loadState(u.id));
    if (p === '/api/state' && m === 'PUT') { // старый формат (вкладки со старой версией клиента): состояние целиком
      const b = await readBody(req, 15e6), rev = store.chats.rev(u.id);
      if (!b.state || typeof b.state !== 'object' || !Array.isArray(b.state.chats)) return json(res, 400, { error: 'Некорректные данные' });
      if (rev && b.rev !== rev) return json(res, 409, loadState(u.id));
      try { return json(res, 200, { rev: store.chats.replace(u.id, b.state).rev }); } catch (e) { return json(res, e.status || 500, { error: e.message }); }
    }
    // синхронизация по одному чату: GET — изменения после since, POST — отправить свои изменения
    if (p === '/api/sync' && m === 'GET') return json(res, 200, store.chats.since(u.id, Math.max(0, parseInt(url.searchParams.get('since'), 10) || 0)));
    if (p === '/api/sync' && m === 'POST') {
      const b = await readBody(req, 15e6), base = Math.max(0, parseInt(b.base, 10) || 0);
      if ((b.put && !Array.isArray(b.put)) || (b.del && !Array.isArray(b.del)) || (b.meta != null && typeof b.meta !== 'object')) return json(res, 400, { error: 'Некорректные данные' });
      try {
        const w = store.chats.write(u.id, base, { put: (b.put || []).slice(0, 2000), del: (b.del || []).slice(0, 2000), meta: b.meta || undefined });
        const ch = store.chats.since(u.id, base); // всё, что изменилось после base (включая только что записанное — клиент сверит версии)
        return json(res, 200, { ...ch, conflicts: w.conflicts, metaConflict: w.metaConflict });
      } catch (e) { return json(res, e.status || 500, { error: e.message }); }
    }
    if (p === '/api/memory' && m === 'GET') return json(res, 200, loadMem(u.id));
    if (p === '/api/memory' && m === 'POST') { const b = await readBody(req), x = loadMem(u.id); if (typeof b.on === 'boolean') x.on = b.on; if (typeof b.text === 'string' && b.text.trim()) x.items.push({ id: crypto.randomBytes(3).toString('hex'), text: b.text.trim().slice(0, 300), at: Date.now() }); x.items = x.items.slice(-100); saveMem(u.id, x); return json(res, 200, x); }
    if (p === '/api/memory' && m === 'DELETE') { const x = loadMem(u.id); x.items = []; saveMem(u.id, x); return json(res, 200, x); }
    const md_ = p.match(/^\/api\/memory\/([a-f0-9]+)$/);
    if (md_ && m === 'DELETE') { const x = loadMem(u.id); x.items = x.items.filter((i) => i.id !== md_[1]); saveMem(u.id, x); return json(res, 200, x); }
    const fm = p.match(/^\/api\/files\/([a-f0-9]{16})\/([^/]+)$/);
    if (fm && m === 'GET') {
      const name = decodeURIComponent(fm[2]), fp = coder.filePath(u.id, fm[1], name);
      if (!fp) return json(res, 404, { error: 'Файл не найден' });
      return sendMedia(req, res, fp, name, url.searchParams.get('dl') === '1');
    }
    return json(res, 404, { error: 'Not found' });
  }

  if (p === '/api/models' && m === 'GET') return json(res, 200, loadModels().map(publicModel));
  if (p === '/api/models/status' && m === 'GET') {
    try {
      const rows = store.db.prepare('SELECT model, kind, ok, ms, first, err, at FROM modelstats WHERE at > ? ORDER BY at').all(Date.now() - 864e5);
      const by = new Map();
      for (const r of rows) { const e = by.get(r.model) || { p: [], c: [] }; by.set(r.model, e); (r.kind === 'probe' ? e.p : e.c).push(r); }
      return json(res, 200, loadModels().map((x) => {
        const e = by.get(x.id) || { p: [], c: [] };
        const lp = e.p[e.p.length - 1];
        const ch = e.c, okN = ch.filter((y) => y.ok).length;
        const fl = ch.filter((y) => y.first > 0).map((y) => y.first).sort((a, b) => a - b);
        const pr = e.p, upN = pr.filter((y) => y.ok).length;
        const incidents = []; let inc = null;
        for (const y of pr) { if (!y.ok && !inc) inc = { from: y.at, err: monSafeErr(y.err) || 'ошибка', to: null }; else if (y.ok && inc) { inc.to = y.at; incidents.push(inc); inc = null; } }
        if (inc) incidents.push(inc);
        const tl = new Array(48).fill(0);
        for (const y of pr) { const i = 47 - Math.floor((Date.now() - y.at) / 18e5); if (i >= 0 && i < 48) tl[i] = Math.max(tl[i], y.ok ? 1 : 2); }
        return { id: x.id, name: x.name, probe: lp ? { ok: !!lp.ok, ms: lp.ms, at: lp.at, err: monSafeErr(lp.err) } : null, chats24h: { n: ch.length, ok: okN, pct: ch.length ? Math.round((100 * okN) / ch.length) : null, firstMed: fl.length ? fl[Math.floor(fl.length / 2)] : null, lastAt: ch.length ? ch[ch.length - 1].at : null }, up24h: { n: pr.length, pct: pr.length ? Math.round((100 * upN) / pr.length) : null }, incidents: incidents.slice(-20), timeline: tl };
      }));
    } catch (e) { monitor.error('models/status', e); return json(res, 500, { error: 'Не удалось построить статус' }); }
  }

  if (p === '/api/admin/login' && m === 'POST') {
    // 5 ошибок за 10 минут с одного IP — пауза; общий потолок 50 ошибок за час на всех — от перебора с разных адресов
    if (limited('admin:' + ip, 5, 10 * 60000) || limited('admin:*', 50, 3600000)) return json(res, 429, { error: 'Слишком много попыток. Подождите 10 минут.' });
    const b = await readBody(req);
    if (!ADMIN.check(String(b.password || '').slice(0, 200))) {
      hit('admin:' + ip); hit('admin:*'); console.log('Панель: неверный пароль с ' + ip);
      return json(res, 401, { error: 'Неверный пароль' });
    } const token = crypto.randomBytes(24).toString('hex'); tokens.set(token, Date.now() + TOKEN_TTL);
    return json(res, 200, { token });
  }

  if (p.startsWith('/api/admin/')) {
    // тестовое видео панели: <video> не умеет слать заголовок с токеном, секрет — случайный id в адресе
    const vf = p.match(/^\/api\/admin\/video\/file\/([a-f0-9]{16})$/);
    if (vf && m === 'GET') { const d = path.join(__dirname, 'data', 'files', '_admin', vf[1]), n = fs.existsSync(d) && fs.readdirSync(d)[0]; if (!n) return json(res, 404, {}); return sendMedia(req, res, path.join(d, n), n, false); }
    if (!isAdmin(req)) return json(res, 401, { error: 'Нужен вход в панель' });

    if (p === '/api/admin/reviews' && m === 'GET') {
      if (url.searchParams.get('summary') === '1') return json(res, 200, store.db.prepare("SELECT COUNT(*) AS total, COUNT(CASE WHEN status = 'pending' THEN 1 END) AS pending FROM reviews").get());
      const page = Math.min(1000000, Math.max(1, parseInt(url.searchParams.get('page'), 10) || 1));
      return json(res, 200, store.db.prepare('SELECT id, uid, nick, rating, text, status, at FROM reviews ORDER BY at DESC, rowid DESC LIMIT 100 OFFSET ?').all((page - 1) * 100));
    }
    if (p === '/api/admin/reviews' && m === 'POST') {
      const b = await readBody(req, 2000);
      if (!b || !/^[a-f0-9]{12}$/.test(b.id || '') || !['approve', 'reject', 'delete'].includes(b.action)) return json(res, 400, { error: 'Некорректное действие с отзывом' });
      const result = b.action === 'delete'
        ? store.db.prepare('DELETE FROM reviews WHERE id = ?').run(b.id)
        : store.db.prepare('UPDATE reviews SET status = ? WHERE id = ?').run(b.action === 'approve' ? 'approved' : 'rejected', b.id);
      if (!result.changes) return json(res, 404, { error: 'Отзыв не найден' });
      return json(res, 200, { ok: true });
    }

    if (p === '/api/admin/models' && m === 'GET') return json(res, 200, loadModels().map(adminModel));
    if (p === '/api/admin/models/check' && m === 'POST') { if (adminCheck && adminCheck.done < adminCheck.total) return json(res, 429, { error: 'Проверка уже идёт — подождите' }); adminCheckAll(); return json(res, 202, { ok: true }); }

    if (p === '/api/admin/models' && m === 'POST') {
      const b = await readBody(req); const err = validModel(b); if (err) return json(res, 400, { error: err });
      const list = loadModels();
      const item = { id: crypto.randomBytes(6).toString('hex'), name: b.name.trim(), modelId: b.modelId.trim(), baseUrl: b.baseUrl.trim(), apiKey: b.apiKey.trim(), vision: b.vision === true || b.vision === 'on', plans: cleanPlans(b.plans) || bill.cfg().plans.map((p) => p.id), weight: Math.min(50, Math.max(0.1, Math.round((+b.weight || 1) * 10) / 10)), ...cleanPrompt(b) };
      list.push(item); saveModels(list); if (b.def || list.length === 1) setDef(item.id); return json(res, 200, adminModel(item));
    }

    // список моделей провайдера по ключу (OpenAI-совместимый GET /models)
    if (p === '/api/admin/models/fetch' && m === 'POST') {
      const b = await readBody(req), src = provSrc(b); if (src.err) return json(res, 400, { error: src.err });
      try {
        const r = await fetch(modelsUrl(src.baseUrl), { signal: AbortSignal.timeout(20000), headers: { Authorization: 'Bearer ' + src.apiKey, 'HTTP-Referer': PUBLIC_URL || 'https://premier', 'X-Title': 'Premier' } });
        if (!r.ok) return json(res, 400, { error: (await upstreamError(r)).replace('Модель ответила', 'Провайдер ответил') });
        const j = await r.json(), raw = Array.isArray(j) ? j : j.data || j.models || [];
        const have = new Set(loadModels().filter((x) => sameBase(x.baseUrl, src.baseUrl)).map((x) => x.modelId));
        const list = raw.map(provModel).filter(Boolean).slice(0, 3000).map((x) => ({ ...x, added: have.has(x.id) })).sort((a, b) => a.name.localeCompare(b.name));
        if (!list.length) return json(res, 400, { error: 'Провайдер вернул пустой список моделей' });
        return json(res, 200, { baseUrl: src.baseUrl, models: list });
      } catch (e) { return json(res, 400, { error: 'Не удалось получить список: ' + (e.name === 'TimeoutError' ? 'нет ответа 20 секунд' : e.message) }); }
    }
    // добавить сразу несколько моделей одного провайдера
    if (p === '/api/admin/models/bulk' && m === 'POST') {
      const b = await readBody(req, 3e6), src = provSrc(b); if (src.err) return json(res, 400, { error: src.err });
      const list = loadModels(), plans = cleanPlans(b.plans) || bill.cfg().plans.map((x) => x.id), weight = Math.min(50, Math.max(0.1, Math.round((+b.weight || 1) * 10) / 10));
      let added = 0, skipped = 0;
      for (const x of (Array.isArray(b.models) ? b.models : []).slice(0, 300)) {
        const modelId = String(x.modelId || '').trim().slice(0, 200); if (!modelId) continue;
        if (list.some((y) => y.modelId === modelId && sameBase(y.baseUrl, src.baseUrl))) { skipped++; continue; }
        list.push({ id: crypto.randomBytes(6).toString('hex'), name: String(x.name || modelId).trim().slice(0, 60) || modelId, modelId, baseUrl: src.baseUrl, apiKey: src.apiKey, vision: !!x.vision, plans: [...plans], weight, ...cleanPrompt(b) }); added++;
      }
      saveModels(list); if (!defModel() && list.length) setDef(list[0].id);
      return json(res, 200, { added, skipped });
    }
    if (p === '/api/admin/models/order' && m === 'POST') {
      const ids = (await readBody(req)).ids, list = loadModels(); if (!Array.isArray(ids)) return json(res, 400, { error: 'ids' });
      const pos = new Map(ids.map((id, i) => [id, i])); list.sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9)); saveModels(list); return json(res, 200, { ok: true });
    }
    if (p === '/api/admin/models/keys' && m === 'GET') {
      const seen = new Map(); for (const x of loadModels()) { const k = x.baseUrl.replace(/\/+$/, ''); if (!seen.has(k)) seen.set(k, { id: x.id, baseUrl: x.baseUrl, key: x.apiKey.slice(0, 4) + '••••' + x.apiKey.slice(-4), host: (() => { try { return new URL(x.baseUrl).host; } catch { return x.baseUrl; } })() }); }
      return json(res, 200, [...seen.values()]);
    }
    const del = p.match(/^\/api\/admin\/models\/([\w-]+)$/);
    if (del && m === 'PATCH') {
      const b = await readBody(req), list = loadModels(), it = list.find((x) => x.id === del[1]); if (!it) return json(res, 404, { error: 'Модель не найдена' });
      if (cleanPlans(b.plans)) { it.plans = cleanPlans(b.plans); delete it.tier; }
      if ('weight' in b) it.weight = Math.min(50, Math.max(0.1, Math.round((+b.weight || 1) * 10) / 10));
      if ('vision' in b) it.vision = !!b.vision;
      if (typeof b.name === 'string' && b.name.trim()) it.name = b.name.trim().slice(0, 60);
      if (typeof b.apiKey === 'string' && b.apiKey.trim()) it.apiKey = b.apiKey.trim();
      if (typeof b.modelId === 'string' && b.modelId.trim()) it.modelId = b.modelId.trim().slice(0, 200);
      if (typeof b.baseUrl === 'string' && b.baseUrl.trim()) { try { if (!/^https?:$/.test(new URL(b.baseUrl.trim()).protocol)) throw 0; } catch { return json(res, 400, { error: 'Некорректный URL' }); } it.baseUrl = b.baseUrl.trim(); }
      if ('prompt' in b || 'promptMode' in b) { const cp = cleanPrompt({ prompt: 'prompt' in b ? b.prompt : it.prompt, promptMode: b.promptMode || it.promptMode }); delete it.prompt; delete it.promptMode; Object.assign(it, cp); }
      if (b.def === true) setDef(it.id);
      saveModels(list); return json(res, 200, adminModel(it));
    }
    if (del && m === 'DELETE') { const rest = loadModels().filter((x) => x.id !== del[1]); saveModels(rest); if (defModel() === del[1]) setDef(rest[0]?.id || ''); return json(res, 200, { ok: true }); }

    if (p === '/api/admin/test' && m === 'POST') {
      let b = await readBody(req); const ask = typeof b.ask === 'string' ? b.ask.trim().slice(0, 2000) : '';
      const over = 'prompt' in b ? cleanPrompt(b) : null; // проверка ещё не сохранённого промта
      if (b.id) { const ex = loadModels().find((x) => x.id === b.id); if (!ex) return json(res, 404, { error: 'Модель не найдена' }); b = { ...ex }; }
      if (over) { delete b.prompt; delete b.promptMode; Object.assign(b, over); }
      const err = validModel(b); if (err) return json(res, 400, { error: err });
      try {
        const r = await fetch(endpoint(b.baseUrl), {
          method: 'POST', signal: AbortSignal.timeout(ask ? 60000 : 20000),
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + b.apiKey.trim() },
          body: JSON.stringify(ask ? { model: b.modelId.trim(), messages: [{ role: 'system', content: systemFor(b) }, { role: 'user', content: ask }], max_tokens: 600 }
            : { model: b.modelId.trim(), messages: [{ role: 'user', content: 'Ответь одним словом: ок' }], max_tokens: 10 }),
        });
        if (!r.ok) return json(res, 200, { ok: false, error: await upstreamError(r) });
        const j = await r.json(); return json(res, 200, { ok: true, reply: j.choices?.[0]?.message?.content ?? '' });
      } catch (e) { return json(res, 200, { ok: false, error: 'Не удалось подключиться: ' + e.message }); }
    }
    if (p === '/api/admin/search' && m === 'GET') {
      const st = loadSettings();
      return json(res, 200, { provider: st.provider, key: st.key ? st.key.slice(0, 4) + '••••' + st.key.slice(-4) : '', hasKey: !!st.key, providers: web.PROVIDERS });
    }
    if (p === '/api/admin/search' && m === 'POST') {
      const b = await readBody(req), st = loadSettings();
      if (!web.PROVIDERS[b.provider]) return json(res, 400, { error: 'Неизвестный провайдер' });
      st.provider = b.provider; if (typeof b.key === 'string' && b.key.trim()) st.key = b.key.trim();
      if (['tavily', 'brave', 'serper'].includes(st.provider) && !st.key) return json(res, 400, { error: 'Для этого провайдера нужен ключ' });
      saveSettings(st); return json(res, 200, { ok: true });
    }
    if (p === '/api/admin/watermark' && m === 'GET') {
      const st = loadSettings();
      return json(res, 200, { on: st.watermark !== false });
    }
    if (p === '/api/admin/watermark' && m === 'POST') {
      const b = await readBody(req), st = loadSettings();
      st.watermark = !!b.on; saveSettings(st); return json(res, 200, { ok: true });
    }
    if (p === '/api/admin/search/test' && m === 'POST') {
      const st = loadSettings();
      if (st.provider === 'off') return json(res, 200, { ok: false, error: 'Поиск выключен' });
      try { const list = await web.search(st, 'новости сегодня', 3); return json(res, 200, { ok: !!list.length, results: list, error: list.length ? '' : 'Поиск ничего не вернул' }); }
      catch (e) { return json(res, 200, { ok: false, error: e.message }); }
    }
    if (p === '/api/admin/browser' && m === 'GET') { const st = loadSettings(); return json(res, 200, { ...browser.info(), browser: st.browser, selfcheck: st.selfcheck }); }
    if (p === '/api/admin/browser' && m === 'POST') { const b = await readBody(req), st = loadSettings(); st.browser = !!b.browser; st.selfcheck = !!b.selfcheck; saveSettings(st); return json(res, 200, { ok: true }); }
    if (p === '/api/admin/browser/test' && m === 'POST') {
      if (!browser.available()) return json(res, 200, { ok: false, error: 'Библиотека браузера не установлена. Выполните в папке проекта: npm install' });
      try { const t = Date.now(), r = await browser.checkHtml('<!doctype html><title>t</title><h1>Premier: проверка браузера</h1><p>Если вы это читаете — всё работает.</p>', false); return json(res, 200, { ok: true, ms: Date.now() - t, issues: r.issues }); }
      catch (e) { return json(res, 200, { ok: false, error: e.message }); }
    }
    if (p === '/api/admin/image' && m === 'GET') return json(res, 200, imager.adminView(loadSettings()));
    if (p === '/api/admin/image' && m === 'POST') { const st = loadSettings(); try { imager.update(st, await readBody(req)); } catch (e) { return json(res, 400, { error: e.message }); } saveSettings(st); return json(res, 200, imager.adminView(st)); }
    if (p === '/api/admin/image/test' && m === 'POST') {
      const st = loadSettings(), c = imager.cfgOf(st); if (!c.baseUrl || !c.modelId || !c.apiKey) return json(res, 200, { ok: false, error: 'Заполните URL API, ID модели и ключ' });
      const t0 = Date.now();
      try { const g = await imager.generate(st, { prompt: String((await readBody(req)).prompt || 'A cute red fox sitting in a sunny meadow, soft light, illustration') }); return json(res, 200, { ok: true, ms: Date.now() - t0, size: g.buf.length, image: `data:image/${g.ext === 'jpg' ? 'jpeg' : g.ext};base64,` + g.buf.toString('base64') }); }
      catch (e) { return json(res, 200, { ok: false, error: e.message }); }
    }
    if (p === '/api/admin/video' && m === 'GET') return json(res, 200, { ...videor.adminView(loadSettings()), test: VTEST });
    if (p === '/api/admin/video' && m === 'POST') { const st = loadSettings(); try { videor.update(st, await readBody(req)); } catch (e) { return json(res, 400, { error: e.message }); } saveSettings(st); return json(res, 200, videor.adminView(st)); }
    if (p === '/api/admin/video/test' && m === 'POST') { // видео делается минутами — запускаем в фоне, панель опрашивает GET /api/admin/video
      const st = loadSettings(), c = videor.cfgOf(st); if (!c.modelId || !c.apiKey) return json(res, 200, { ok: false, error: 'Заполните ID модели и ключ' });
      if (VTEST.state === 'run') return json(res, 200, { ok: true, test: VTEST });
      VTEST = { state: 'run', at: Date.now(), p: 0 };
      videor.generate(st, { prompt: 'A small red fox walking through a sunny meadow, gentle camera pan, soft light', aspect: 'landscape' }, null, (x) => { VTEST.p = x; })
        .then((g) => { const f = videor.save('_admin', g.buf, g.ext); VTEST = { state: 'ok', ms: Date.now() - VTEST.at, size: g.buf.length, url: '/api/admin/video/file/' + f.url.split('/')[3] }; })
        .catch((e) => { VTEST = { state: 'err', error: e.message }; });
      return json(res, 200, { ok: true, test: VTEST });
    }
    if (p === '/api/admin/code' && m === 'GET') return json(res, 200, { ...(await coder.check()), enabled: loadSettings().code });
    if (p === '/api/admin/code' && m === 'POST') { const b = await readBody(req), st = loadSettings(); st.code = !!b.enabled; saveSettings(st); return json(res, 200, { ok: true }); }
    if (p === '/api/admin/code/test' && m === 'POST') {
      try { const r = await coder.run('import sys, platform\nprint("Python", platform.python_version(), "· 2+2 =", 2+2)', 'admin-test'); return json(res, 200, { ok: r.exit === 0, out: r.stdout.trim(), error: r.stderr.trim().split('\n').pop(), ms: r.ms }); }
      catch (e) { return json(res, 200, { ok: false, error: e.message }); }
    }
    if (p === '/api/admin/users' && m === 'GET') return json(res, 200, { users: store.users.all().map((u) => { const pl = bill.planOf(u), used = bill.used(u.id), lim = bill.limitOf(pl, 'm'); return { ...publicUser(u), plan: pl.id, planName: pl.name, until: pl.until, trial: !!u.trial, used, ext: (u.msgExt && u.msgExt.until > Date.now() ? { limit: Math.floor(Number(u.msgExt.limit)) || 0, until: u.msgExt.until } : null), msgLimit: lim == null ? null : lim, msgLeft: lim == null ? null : Number(Math.max(0, lim - (used.m || 0)).toFixed(1)) }; }), register: regOpen(), plans: bill.publicPlans() });
    if (p === '/api/admin/usage' && m === 'POST') {
      // выдача/отбор дневных сообщений: give — уменьшает счётчик (не ниже 0), take — увеличивает
      const b = await readBody(req);
      const u = store.users.get(String(b.uid || '')); if (!u) return json(res, 404, { error: 'Пользователь не найден' });
      const amount = Math.floor(Number(b.amount));
      if (!(amount > 0 && amount <= 100000)) return json(res, 400, { error: 'Количество: целое от 1 до 100000' });
      bill.add(u.id, 'm', b.action === 'give' ? -amount : amount);
      bill.flush();
      const pl = bill.planOf(u), lim = bill.limitOf(pl, 'm'), used = bill.used(u.id);
      console.log('admin usage: ' + (b.action === 'give' ? 'give' : 'take') + ' ' + amount + ' -> ' + u.id + ' (used ' + used.m + ')');
      return json(res, 200, { ok: true, used, msgLimit: lim == null ? null : lim, msgLeft: lim == null ? null : Number(Math.max(0, lim - (used.m || 0)).toFixed(1)) });
    }
    if (p === '/api/admin/msg-ext' && m === 'POST') {
      // временное повышение дневного лимита сообщений: до 10000, на 1–30 дней; reset — вернуть тарифный
      const b = await readBody(req);
      const uid = String(b.uid || '');
      if (b.action === 'reset') {
        store.users.update(uid, (x) => { delete x.msgExt; });
        const u2 = store.users.get(uid); if (!u2) return json(res, 404, { error: 'Пользователь не найден' });
        const pl = bill.planOf(u2), lim = bill.limitOf(pl, 'm'), used = bill.used(uid);
        console.log('admin msg-ext: reset ' + uid);
        return json(res, 200, { ok: true, ext: null, used, msgLimit: lim == null ? null : lim, msgLeft: lim == null ? null : Number(Math.max(0, lim - (used.m || 0)).toFixed(1)) });
      }
      const u = store.users.get(uid); if (!u) return json(res, 404, { error: 'Пользователь не найден' });
      const limit = Math.floor(Number(b.limit)), days = Math.floor(Number(b.days)) || 1;
      if (!(limit > 0 && limit <= 10000)) return json(res, 400, { error: 'Лимит: от 1 до 10000 сообщений' });
      if (!(days >= 1 && days <= 30)) return json(res, 400, { error: 'Срок: от 1 до 30 дней' });
      const until = Date.now() + days * 864e5;
      store.users.update(uid, (x) => { x.msgExt = { limit, until }; });
      const u2 = store.users.get(uid);
      const pl = bill.planOf(u2), lim = bill.limitOf(pl, 'm'), used = bill.used(uid);
      console.log('admin msg-ext: ' + uid + ' limit=' + limit + ' days=' + days);
      return json(res, 200, { ok: true, ext: { limit, until }, used, msgLimit: lim == null ? null : lim, msgLeft: lim == null ? null : Number(Math.max(0, lim - (used.m || 0)).toFixed(1)) });
    }
    const upl = p.match(/^\/api\/admin\/users\/([a-f0-9]+)\/plan$/);
    if (upl && m === 'POST') {
      const b = await readBody(req), plan = String(b.plan || 'free'), days = Math.round(+b.days || 0);
      if (plan !== 'free' && !bill.cfg().plans.some((x) => x.id === plan)) return json(res, 400, { error: 'Нет такого тарифа' });
      if (plan !== 'free' && !(days > 0 && days <= 3650)) return json(res, 400, { error: 'Укажите число дней (1–3650)' });
      const u = bill.updateUser(upl[1], (x) => { delete x.trial; if (plan === 'free') { delete x.plan; delete x.until; } else if (b.extend) bill.extend(x, plan, days); else { x.plan = plan; x.until = Date.now() + days * 864e5; } });
      return u ? json(res, 200, { ok: true, until: u.until || null }) : json(res, 404, { error: 'Пользователь не найден' });
    }
    if (p === '/api/admin/plans' && m === 'GET') return json(res, 200, bill.cfg());
    if (p === '/api/admin/plans' && m === 'POST') return json(res, 200, bill.saveCfg(await readBody(req)));
    if (p === '/api/admin/stats' && m === 'GET') return json(res, 200, bill.stats());
    if (p === '/api/admin/monitor' && m === 'GET') return json(res, 200, { stats: monitor.stats(), errors: monitor.list().slice(0, 50), chats: monitor.chats() });
    if (p === '/api/admin/pay' && m === 'GET') { const k = bill.keys(); return json(res, 200, { ready: bill.payReady(), env: k.env, merchant: k.id, secret: k.secret ? '••••' + k.secret.slice(-4) : '', callback: originOf(req) + '/api/pay/callback' }); }
    if (p === '/api/admin/pay' && m === 'POST') {
      const b = await readBody(req), st = loadSettings(); st.platega ||= {};
      if (typeof b.merchant === 'string') st.platega.merchant = b.merchant.trim();
      if (typeof b.secret === 'string' && b.secret.trim()) st.platega.secret = b.secret.trim();
      saveSettings(st); return json(res, 200, { ok: true, ready: bill.payReady() });
    }
    if (p === '/api/admin/cispay' && m === 'GET') { const k = bill.cisKeys(); return json(res, 200, { ready: bill.cisReady(), shopId: k.shopId || '', key: k.apiKey ? k.apiKey.slice(0, 12) + '••••' : '', webhook: originOf(req) + '/api/pay/cispay' }); }
    if (p === '/api/admin/robokassa' && m === 'GET') { const k = bill.rbKeys(); return json(res, 200, { ready: bill.rbReady(), login: k.login || '', pass2: k.pass2 ? k.pass2.slice(0, 4) + '••••' : '', resultUrl: originOf(req) + '/api/pay/robokassa' }); }
    if (p === '/api/admin/cispay' && m === 'POST') {
      const b = await readBody(req), st = loadSettings(); st.cispay ||= {};
      if (typeof b.shopId === 'string' && b.shopId.trim()) st.cispay.shopId = b.shopId.trim();
      if (typeof b.apiKey === 'string' && b.apiKey.trim()) st.cispay.apiKey = b.apiKey.trim();
      saveSettings(st); return json(res, 200, { ok: true, ready: bill.cisReady() });
    }
    if (p === '/api/admin/referrals' && m === 'GET') { const st = loadSettings(); return json(res, 200, { on: st.referrals !== false }); }
    if (p === '/api/admin/referrals' && m === 'POST') { const b = await readBody(req), st = loadSettings(); st.referrals = b.on !== false; saveSettings(st); return json(res, 200, { ok: true, on: st.referrals !== false }); }
    if (p === '/api/admin/crypto' && m === 'GET') { const k = bill.cryptoKeys(); return json(res, 200, { ready: bill.cryptoReady(), env: k.env, token: k.token ? k.token.slice(0, 6) + '••••' + k.token.slice(-4) : '', testnet: k.testnet, assets: k.assets, webhook: originOf(req) + '/api/pay/crypto' }); }
    if (p === '/api/admin/crypto' && m === 'POST') {
      const b = await readBody(req), st = loadSettings(); st.cryptobot ||= {};
      if (typeof b.token === 'string' && b.token.trim()) { if (!/^\d+:[A-Za-z0-9_-]{10,}$/.test(b.token.trim())) return json(res, 400, { error: 'Токен Crypto Pay выглядит так: 12345:AAbbCC… (Crypto Bot → Crypto Pay → My Apps → API Token)' }); st.cryptobot.token = b.token.trim(); }
      if (b.remove === true) delete st.cryptobot.token;
      if (typeof b.testnet === 'boolean') st.cryptobot.testnet = b.testnet;
      if (typeof b.assets === 'string') st.cryptobot.assets = b.assets.toUpperCase().replace(/[^A-Z,]/g, '').slice(0, 200);
      saveSettings(st); return json(res, 200, { ok: true, ready: bill.cryptoReady() });
    }
    if (p === '/api/admin/crypto/test' && m === 'POST') { try { const me = await bill.cryptoMe(); return json(res, 200, { ok: true, name: me.name, id: me.app_id }); } catch (e) { return json(res, 200, { ok: false, error: e.message }); } }
    if (p === '/api/admin/payments' && m === 'GET') return json(res, 200, bill.loadPays(100).reverse());
    const pchk = p.match(/^\/api\/admin\/payments\/([\w-]+)\/check$/);
    if (pchk && m === 'POST') { const pay = bill.findPay(pchk[1]); if (!pay) return json(res, 404, { error: 'Платёж не найден' }); try { return json(res, 200, await bill.sync(pay)); } catch (e) { return json(res, 400, { error: e.message }); } }
    if (p === '/api/admin/promos' && m === 'GET') return json(res, 200, bill.loadPromos());
    if (p === '/api/admin/promos' && m === 'POST') {
      const b = await readBody(req), code = String(b.code || '').trim().toUpperCase(), list = bill.loadPromos();
      if (!/^[A-Z0-9А-ЯЁ_-]{3,30}$/.test(code)) return json(res, 400, { error: 'Код: 3–30 символов — буквы, цифры, - или _' });
      if (list.some((x) => x.code === code)) return json(res, 400, { error: 'Такой промокод уже есть' });
      const kind = b.kind === 'gift' ? 'gift' : 'discount', plans = bill.cfg().plans;
      const pr = { code, kind, max: +b.max > 0 ? Math.round(+b.max) : null, used: 0, by: [], until: b.until ? Date.parse(b.until + 'T23:59:59+03:00') || null : null, created: Date.now() };
      if (kind === 'gift') { if (!plans.some((x) => x.id === b.plan && x.id !== 'free')) return json(res, 400, { error: 'Выберите тариф' }); pr.plan = b.plan; pr.days = Math.round(+b.days); if (!(pr.days > 0 && pr.days <= 365)) return json(res, 400, { error: 'Дней: от 1 до 365' }); }
      else { pr.percent = Math.round(+b.percent); if (!(pr.percent > 0 && pr.percent < 100)) return json(res, 400, { error: 'Скидка: от 1 до 99 %' }); pr.plan = plans.some((x) => x.id === b.plan && x.id !== 'free') ? b.plan : null; }
      list.push(pr); bill.savePromos(list); return json(res, 200, pr);
    }
    const prd = p.match(/^\/api\/admin\/promos\/([^/]+)$/);
    if (prd && m === 'DELETE') { const c = decodeURIComponent(prd[1]); bill.savePromos(bill.loadPromos().filter((x) => x.code !== c)); return json(res, 200, { ok: true }); }
    if (p === '/api/admin/users' && m === 'POST') {
      const b = await readBody(req), r = createByEmail(b.email, b.name); if (r.err) return json(res, 400, { error: r.err });
      return json(res, 200, publicUser(r.user));
    }
    const delu = p.match(/^\/api\/admin\/users\/([a-f0-9]+)$/);
    if (delu && m === 'DELETE') {
      deleteUser(delu[1]);
      return json(res, 200, { ok: true });
    }
    if (p === '/api/admin/register' && m === 'POST') { const b = await readBody(req), st = loadSettings(); st.register = !!b.open; saveSettings(st); return json(res, 200, { ok: true }); }
    return json(res, 404, { error: 'Not found' });
  }

  if ((p === '/api/chat' || p === '/api/publish') && !currentUser(req)) return json(res, 401, { error: 'Войдите в аккаунт' });

  if (p === '/api/config' && m === 'GET') { const stc = loadSettings(); return json(res, 200, { search: stc.provider !== 'off', image: imager.ready(stc) }); }

  if (p === '/api/publish' && m === 'POST') {
    if (PUBLISH_OFF) return json(res, 403, { error: 'Публикация отключена' });
    const ip = clientIp(req), now = Date.now(), pu = currentUser(req);
    const hits = (pubHits.get(ip) || []).filter((t) => now - t < 3600000);
    if (hits.length >= 20 || limited('pub:' + pu.id, 50, 864e5)) return json(res, 429, { error: 'Слишком много публикаций, попробуйте позже' });
    const b = await readBody(req, 3e6);
    if (typeof b.html !== 'string' || !b.html.trim()) return json(res, 400, { error: 'Пустой сайт' });
    if (Buffer.byteLength(b.html) > 2e6) return json(res, 400, { error: 'Сайт больше 2 МБ' });
    if (modelAssets.ids(b.html).some(id => !assets.manifest(pu.id, id))) return json(res, 404, { error: 'Модель не найдена у владельца' });
    b.html = modelAssets.rewrite(b.html, originOf(req));
    hits.push(now); pubHits.set(ip, hits); hit('pub:' + pu.id);
    const id = crypto.randomBytes(5).toString('hex'), key = crypto.randomBytes(16).toString('hex');
    fs.mkdirSync(SITES_DIR, { recursive: true });
    fs.writeFileSync(path.join(SITES_DIR, id + '.html'), b.html);
    fs.writeFileSync(path.join(SITES_DIR, id + '.json'), JSON.stringify({ key, uid: pu.id, title: String(b.title || '').slice(0, 200), created: new Date().toISOString() }));
    return json(res, 200, { id, key, path: '/s/' + id, branding: publications.policy(pu) });
  }
  const unp = p.match(/^\/api\/publish\/([a-f0-9]{10})$/);
  if (unp && m === 'DELETE') {
    const b = await readBody(req); let meta;
    try { meta = JSON.parse(fs.readFileSync(path.join(SITES_DIR, unp[1] + '.json'), 'utf8')); } catch { return json(res, 404, { error: 'Не найдено' }); }
    const a = Buffer.from(String(b.key || '')), e = Buffer.from(meta.key);
    if (a.length !== e.length || !crypto.timingSafeEqual(a, e)) return json(res, 403, { error: 'Нет доступа' });
    fs.rmSync(path.join(SITES_DIR, unp[1] + '.html'), { force: true }); fs.rmSync(path.join(SITES_DIR, unp[1] + '.json'), { force: true });
    return json(res, 200, { ok: true });
  }

  // ---- программа-помощник (доступ к компьютеру) ----
  if (p.startsWith('/api/agent/')) {
    const bearer = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (p === '/api/agent/connect' && m === 'POST') { if (limited('agent:' + ip, 10, 10 * 60000) || limited('agent:*', 200, 3600000)) return json(res, 429, { error: 'Слишком много попыток. Подождите 10 минут.' }); const b = await readBody(req, 2e4); const r = agent.connect(b.code, b.info); if (!r) { hit('agent:' + ip); hit('agent:*'); } return r ? json(res, 200, { token: r.token }) : json(res, 403, { error: 'Код неверный или устарел — получите новый в чате (кнопка «Компьютер»)' }); }
    if ((p === '/api/agent/poll' || p === '/api/agent/result') && m === 'POST') {
      const uid = agent.uidOf(bearer); if (!uid || !store.users.get(uid)) return json(res, 401, { error: 'Помощник отключён — привяжите его заново' });
      const b = await readBody(req, 3e6);
      if (p === '/api/agent/result') return json(res, agent.result(uid, b.jid, b.out) ? 200 : 404, {});
      const ac = new AbortController(); res.on('close', () => ac.abort());
      const job = await agent.poll(uid, b.info && typeof b.info === 'object' ? { os: String(b.info.os || '').slice(0, 80), host: String(b.info.host || '').slice(0, 80), home: String(b.info.home || '').slice(0, 300), desktop: String(b.info.desktop || '').slice(0, 300), node: String(b.info.node || '').slice(0, 20) } : null, ac.signal);
      if (res.writableEnded || res.destroyed) return; return job ? json(res, 200, job) : (res.writeHead(204), res.end());
    }
    const u = currentUser(req); if (!u) return json(res, 401, { error: 'Войдите в аккаунт' });
    if (p === '/api/agent/status' && m === 'GET') return json(res, 200, { connected: agent.connected(u.id), info: agent.info(u.id) });
    if (p === '/api/agent/code' && m === 'POST') return json(res, 200, { code: agent.makeCode(u.id), server: originOf(req) });
    if (p === '/api/agent/off' && m === 'POST') { agent.disconnect(u.id); return json(res, 200, { ok: true }); }
    return json(res, 404, { error: 'Не найдено' });
  }
  if (p === '/api/chat/agent' && m === 'POST') {
    const u = currentUser(req); if (!u) return json(res, 401, { error: 'Войдите в аккаунт' });
    const b = await readBody(req); return agent.decide(u.id, b.cid, b.ok) ? json(res, 200, { ok: true }) : json(res, 404, { error: 'Запрос устарел' });
  }
  if (p === '/api/chat/tool' && m === 'POST') {
    const u = currentUser(req); if (!u) return json(res, 401, { error: 'Войдите в аккаунт' });
    const b = await readBody(req, 3e6); return folder.answer(u.id, b.cid, b.result) ? json(res, 200, { ok: true }) : json(res, 404, { error: 'Запрос устарел' });
  }
  if (p === '/api/chat/resume' && m === 'GET') {
    const u = currentUser(req); if (!u) return json(res, 401, { error: 'Войдите в аккаунт' });
    let q; try { q = new URL(req.url, 'http://x').searchParams; } catch { return json(res, 400, { error: 'Bad request' }); }
    const gid = String(q.get('g') || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
    const from = Math.max(0, parseInt(q.get('from') || '0', 10) || 0);
    const g = liveGens.get(gid);
    if (!g || g.uid !== u.id) return json(res, 404, { error: 'Генерация не найдена или уже завершена' });
    if (g.orphanTimer) { clearTimeout(g.orphanTimer); g.orphanTimer = null; }
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
    if (from < g.lines.length) for (const s2 of g.lines.slice(from)) { try { res.write(s2); } catch {} }
    if (g.done) return res.end();
    g.subs.add(res);
    res.on('close', () => { g.subs.delete(res); });
    return;
  }
  if (p === '/api/chat/stop' && m === 'POST') {
    const u = currentUser(req); if (!u) return json(res, 401, { error: 'Войдите в аккаунт' });
    const b = await readBody(req);
    const sgid = String((b && b.mid) || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
    const sg = liveGens.get(sgid);
    if (sg && sg.uid === u.id) { if (sg.orphanTimer) { clearTimeout(sg.orphanTimer); sg.orphanTimer = null; } if (sg.abortNow) sg.abortNow(); }
    return json(res, 200, { ok: true });
  }
  // последняя нарисованная в этом чате картинка: клиент шлёт ассистентским сообщениям gens:[{url:'/api/files/<fid>/image.<ext>'}]
  const lastGenUrl = (raw) => { for (let i = raw.length - 1; i >= 0; i--) { const gs = raw[i]?.role === 'assistant' && Array.isArray(raw[i].gens) ? raw[i].gens : null; if (gs) { const g = gs.find((x) => typeof x?.url === 'string' && /^\/api\/files\//.test(x.url)); if (g) return g.url; } } return null; };
  if (p === '/api/chat' && m === 'POST') {
    const b = await readBody(req, 300e6);
    const _gid = String((b && b.mid) || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
    if (_gid && liveGens.has(_gid) && !liveGens.get(_gid).done) return json(res, 409, { error: 'Эта генерация уже выполняется — дождитесь её окончания' });
    const model = loadModels().find((x) => x.id === b.model);
    if (!model) return json(res, 400, { error: 'Модель не найдена. Подключите её в Панели.' });
    const okPart = (pt) => (pt?.type === 'text' && typeof pt.text === 'string') || (pt?.type === 'image_url' && typeof pt.image_url?.url === 'string' && pt.image_url.url.startsWith('data:image/'));
    const messages = (Array.isArray(b.messages) ? b.messages : [])
      .filter((x) => (x.role === 'user' || x.role === 'assistant') && ((typeof x.content === 'string' && x.content) || (Array.isArray(x.content) && x.content.length && x.content.every(okPart))))
      .slice(-40)
      .map((x) => {
        if (typeof x.content === 'string' || model.vision) return { role: x.role, content: x.content };
        const text = x.content.filter((pt) => pt.type === 'text').map((pt) => pt.text).join('\n');
        return { role: x.role, content: text + (imager.ready(loadSettings()) ? '\n[пользователь приложил картинку — ты её не видишь, но если он просит её изменить или нарисовать на её основе, вызови generate_image с use_attached: true]' : '\n[пользователь приложил картинку, но эта модель не умеет их смотреть]') };
      });
    const instructions = typeof b.instructions === 'string' ? b.instructions.trim().slice(0, 6000) : '';
    const system = systemFor(model) + (instructions ? '\n\nИнструкции проекта от пользователя (следуй им' + (model.prompt ? ', если они не противоречат инструкциям модели выше' : '') + '):\n' + instructions : '');
    if (!messages.length) return json(res, 400, { error: 'Пустой запрос' });
    let base;
    try { base = artifactState.resolve(b.currentArtifact, Array.isArray(b.messages) ? b.messages : []); }
    catch (e) { return json(res, 400, { error: e.message, code: 'artifact_context' }); }
    let task = chatPolicy.taskOf(messages, base);
    // patch: recognized base + no new-site request => point-edit mode (was: create-from-scratch for complaint-style follow-ups)
    if (base && !task.needsBase && task.mode === null && task.intent !== 'image' && task.intent !== 'video') task = { ...task, intent: 'artifact', mode: 'edit', needsBase: false };
    // Файлы на компьютере/в папке обрабатывает соответствующий помощник, не JSON edits.
    const folderActive = b.folder && typeof b.folder === 'object' && typeof b.folder.name === 'string';
    const localArtifact = !folderActive && !(b.agent && agent.connected(currentUser(req)?.id));
    // needsBase без кода — не блокируем (409 убран по запросу пользователя): модель отвечает в обычном режиме
    const editMode = localArtifact && task.mode === 'edit' && !task.needsBase;
    const intent = task.intent;

    const user = currentUser(req), ch = bill.charge(user, model);
    if (ch.error) return json(res, ch.code === 'burst' ? 429 : 402, { error: ch.error, code: ch.code });
    bill.refMsgTick(user.id);
    const sitesLeft = bill.left(user, 's') > 0;
    const st = loadSettings();
    const useWeb = !!b.web && st.provider !== 'off';
    const imgMode = !!b.img; // кнопка «Картинка» в строке ввода: пользователь явно в режиме изображений
    const today = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    // Предыдущие версии убираем из edit-контекста; закреплённая версия — единственная основа.
    const retained = editMode ? messages.filter((m) => m.role !== 'assistant' || !artifactState.latest(media.plain(m.content))) : messages;
    const convo = [{ role: 'system', content: system + '\n\nСегодня: ' + today + '.' + (useWeb ? WEB_NOTE : '') }, ...retained];
    if (editMode) convo.splice(convo.length - 1, 0, { role: 'user', content: artifactEdit.context(base) });

    const ac = new AbortController();
    const genId = _gid;
    const gen = genId ? { uid: user.id, lines: [], subs: new Set(), done: false, finishedAt: 0, orphanTimer: null, startedAt: Date.now(), abortNow: null } : null;
    if (gen) { gen.abortNow = () => ac.abort(); liveGens.set(genId, gen); }
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
    const writeAll = (s, buf) => { if (gen) { if (buf) { gen.lines.push(s); if (gen.lines.length > 50000) gen.lines.splice(0, gen.lines.length - 50000); } for (const r of gen.subs) { if (!r.writableEnded && !r.destroyed) { try { r.write(s); } catch {} } } } else if (!res.writableEnded && !res.destroyed) { try { res.write(s); } catch {} } };
    const genEnd = () => { if (gen && !gen.done) { gen.done = true; gen.finishedAt = Date.now(); for (const r of gen.subs) { try { r.end(); } catch {} } gen.subs.clear(); } if (kb) clearInterval(kb); };
    if (gen) gen.subs.add(res);
    const out = (o) => { writeAll(JSON.stringify(localizeResponse(req, o)) + '\n', true); };
    let kb = setInterval(() => { if (!ac.signal.aborted) writeAll('#kb\n', false); }, 15000); kb.unref();
    res.on('close', () => { if (gen) { gen.subs.delete(res); if (!gen.done && gen.subs.size === 0 && !gen.orphanTimer) { gen.orphanTimer = setTimeout(() => { genEnd(); ac.abort(); }, 10 * 60000); gen.orphanTimer.unref(); } } });
    res.on('finish', () => { genEnd(); });
    const trace = { id: crypto.randomBytes(6).toString('hex'), model: model.id, intent, artifactMode: localArtifact ? task.mode : null,
      ...(editMode ? { baseHash: crypto.createHash('sha256').update(base.source).digest('hex').slice(0, 16) } : {}),
      started: Date.now(), firstTextMs: null, requests: 0, repairs: 0, tools: 0, outcome: 'complete' };
    const timeoutMs = chatStream.timeoutMs();
    let modelSignal = null, waitingTimer = null;
    const stopWaiting = () => { clearInterval(waitingTimer); waitingTimer = null; };
    const requestModel = (body) => {
      trace.requests++;
      stopWaiting();
      const started = Date.now();
      waitingTimer = setInterval(() => {
        if (!ac.signal.aborted) out({ s: 'waiting', q: `Жду ответ модели — ${Math.round((Date.now() - started) / 1000)} с. Запрос ещё выполняется.` });
      }, 30000);
      waitingTimer.unref();
      modelSignal = AbortSignal.any([ac.signal, AbortSignal.timeout(timeoutMs)]);
      return fetch(endpoint(model.baseUrl), {
        method: 'POST', signal: modelSignal,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + model.apiKey },
        body: JSON.stringify(body),
      });
    };
    const textOut = (text) => {
      stopWaiting();
      if (trace.firstTextMs == null) trace.firstTextMs = Date.now() - trace.started;
      out({ t: text });
    };
    res.on('close', stopWaiting);
    const finishTrace = () => {
      stopWaiting();
      const summary = { ...trace, ms: Date.now() - trace.started };
      delete summary.started;
      monitor.chat(summary);
      try { store.db.prepare('INSERT INTO modelstats (model, kind, ok, ms, first, err, at) VALUES (?,?,?,?,?,?,?)').run(trace.model, 'chat', trace.outcome === 'complete' ? 1 : 0, summary.ms, trace.firstTextMs, trace.outcome === 'complete' ? null : trace.outcome, Date.now()); } catch {}
      out({ diag: summary });
    };
    const sources = [], seenUrl = new Set();
    const addSrc = (title, url) => { if (url && !seenUrl.has(url)) { seenUrl.add(url); sources.push({ title: String(title || url).slice(0, 160), url }); } };
    const mem = loadMem(user.id);
    const useBrowser = st.browser && browser.available();
    const useCode = st.code && b.code !== false && bill.left(user, 'c') > 0 && (await coder.check()).ok;
    const imgOn = imager.ready(st), useImg = imgOn && intent !== 'artifact' && bill.left(user, 'i') > 0;
    const vidOn = videor.ready(st), useVid = vidOn && intent !== 'artifact' && bill.left(user, 'v') > 0;
    const fold = b.folder && typeof b.folder === 'object' && typeof b.folder.name === 'string' ? { name: b.folder.name.slice(0, 120), tree: String(b.folder.tree || '').slice(0, 8000) } : null;
    const useAgent = !!b.agent && agent.connected(user.id);
    // Проверка HTML относится к артефакту в чате, не к файлу на ПК.
    const artifact = intent === 'artifact' && !fold && !useAgent;
    const tools = [...(!fold && !useAgent ? [assets.TOOL] : []), ...(useWeb ? web.TOOLS : []), ...(useWeb && useBrowser && model.vision ? [VIEW_TOOL] : []), ...(mem.on ? MEM_TOOLS : []), ...(useCode ? [coder.TOOL] : []), ...(useImg ? [imager.TOOL] : []), ...(useVid ? [videor.TOOL] : []), ...(fold ? folder.TOOLS : []), ...(useAgent ? agent.TOOLS : [])]
      .filter((t) => !artifact || chatPolicy.toolAllowed(t.function.name, intent));
    const notes = (fold ? folder.note(fold) : '') + (useAgent ? agent.note(agent.info(user.id)) : '') + (useImg ? imager.NOTE : imgOn && intent !== 'artifact' ? imager.LIMIT : '') + (useVid ? videor.NOTE : vidOn && intent !== 'artifact' ? videor.LIMIT : '') + (useWeb && useBrowser ? BROWSER_NOTE + (model.vision && !artifact ? BROWSER_VIEW_NOTE : '') : '') + (mem.on ? memNote(mem.items) : '') + (useCode && !artifact ? coder.NOTE : '') + (sitesLeft || editMode ? '' : LIMIT_SITE) + (st.code && !useCode && bill.left(user, 'c') <= 0 ? LIMIT_CODE : '') +
      (artifact ? editMode ? artifactEdit.EDIT_NOTE : chatPolicy.ARTIFACT_NOTE + '\nРежим создания: выполни новую задачу; предыдущие версии не являются закреплённой основой.' : '');
    convo[0].content += notes + (!fold && !useAgent ? assets.NOTE + (artifact ? gameCheck.NOTE : '') : '');
    if (imgMode && useImg) convo[0].content += IMG_MODE_NOTE;
    if (artifact) out({ s: editMode ? 'edit' : 'create', q: editMode ? base.title : '' });
    let toolsOK = tools.length > 0, fellBack = false;
    let full = '';
    // каждый дополнительный раунд с инструментами списывает ещё одно сообщение (с учётом веса модели)
    let charged = ch.weight, pending = false, cut = false;
    const maxTok = 128000; // потолок снят (2026-10-16): не по тарифу, а возможности модели; 128K — предохранитель от чудовищных запросов

    // «нарисуй…» / «сделай видео…» — сразу к модели картинок/видео (модель чата только пишет промт), без сайтов и кода
    const rawMsgs = Array.isArray(b.messages) ? b.messages : [];
    const lastRaw = [...rawMsgs].reverse().find((x) => x?.role === 'user');
    const lastText = media.plain(lastRaw?.content).replace(/^\(Журнал Premier[\s\S]*?Ассистент такие заметки не пишет\.\)\s*/, '').trim();
    const lastRefs = Array.isArray(lastRaw?.content) ? lastRaw.content.filter((x) => x?.type === 'image_url' && /^data:image\//.test(x.image_url?.url || '')).map((x) => x.image_url.url).slice(0, 3) : [];
    const prevA = [...rawMsgs].reverse().find((x) => x?.role === 'assistant');
    const prevImage = /^\(Журнал Premier[^)]*нарисованы картинки/.test(media.plain(lastRaw?.content));
    let want = fold || useAgent ? null : chatPolicy.mediaWant(lastText, { refs: lastRefs.length, prevImage }, intent);
    // Режим «Картинка»: уточнение сразу после нарисованной картинки — снова картинка, даже без глагола «нарисуй».
    if (imgMode && useImg && !want && prevImage) want = 'image';
    if ((want === 'image' && useImg) || (want === 'video' && useVid)) {
      const isV = want === 'video';
      try {
        out({ s: want, q: lastText.slice(0, 160) }); // в чате сразу появляется «рисую…» / «снимаю видео…»
        const pr = await media.refine({ url: endpoint(model.baseUrl), key: model.apiKey, model: model.modelId }, messages, want, ac.signal);
        let file;
        if (isV) {
          let lastP = -1; const g = await videor.generate(st, { prompt: pr.prompt, aspect: pr.aspect, refs: lastRefs }, ac.signal, (x) => { if (x !== lastP) { lastP = x; out({ vp: x }); } });
          bill.add(user.id, 'v'); file = videor.save(user.id, g.buf, g.ext); out({ vid: { ...file, prompt: pr.prompt.slice(0, 1000) } });
        } else {
          let imgRefs = lastRefs;
          if (!imgRefs.length) { const d = imager.refFromSaved(user.id, lastGenUrl(rawMsgs)); if (d && prevImage && (imgMode || (media.EDIT.test(lastText) && lastText.length < 300))) imgRefs = [d]; } // правка/уточнение предыдущей картинки — берём её за основу
          const g = await imager.generate(st, { prompt: pr.prompt, aspect: pr.aspect, refs: imgRefs }, ac.signal);
          bill.add(user.id, 'i'); file = imager.save(user.id, g.buf, g.ext); out({ img: { ...file, prompt: pr.prompt.slice(0, 1000) } });
        }
        out({ t: pr.reply || (isV ? 'Готово! Могу сделать другой вариант — поменять сюжет, стиль или формат.' : 'Готово! Могу изменить стиль, цвета или детали — просто напишите.') });
      } catch (e) {
        if (!ac.signal.aborted) { out({ s: 'fail', q: e.message }); out({ t: (isV ? 'Не получилось сделать видео: ' : 'Не получилось нарисовать картинку: ') + e.message }); }
        trace.outcome = ac.signal.aborted ? 'cancelled' : 'media_error';
        bill.add(user.id, 'm', -ch.weight); // ничего не вышло — сообщение не списываем
      }
      finishTrace(); out({ bill: bill.summary(user) }); genEnd(); return res.end();
    }

    try {
      const ROUNDS = fold || useAgent ? 25 : artifact ? 5 : 9; // Поиск, лицензия, GLB и завершение; HTML-задача не должна уходить в долгую цепочку инструментов.
      let readWeb = false; // модель получила текст из интернета — авто-режим помощника в этом ответе отключается
      for (let round = 0; round < ROUNDS; round++) {
        if (pending) {
          pending = false;
          if (bill.left(user, 'm') >= ch.weight) { bill.add(user.id, 'm', ch.weight); charged += ch.weight; out({ bill: bill.summary(user) }); }
          else {
            // сообщений больше нет — даём модели один последний ответ без инструментов
            toolsOK = false;
            convo.push({ role: 'user', content: 'Лимит сообщений пользователя на сегодня исчерпан, инструменты больше недоступны. Заверши ответ прямо сейчас на основе того, что уже сделано, и кратко скажи, что осталось доделать.' });
            out({ s: 'fail', q: 'Сообщения на сегодня закончились — модель завершает ответ без инструментов' });
          }
        }
        const body = { model: model.modelId, messages: convo, stream: true };
        if (maxTok) body.max_tokens = maxTok;
        if (toolsOK && round < ROUNDS - 1) body.tools = tools;
        let r = await requestModel(body);
        // нестабильный провайдер (5xx): одна повторная попытка после паузы
        if (r.status >= 500 && r.status !== 501 && !ac.signal.aborted) {
          try { if (r.body) await r.body.cancel(); } catch {}
          out({ s: 'waiting', q: `Модель ответила ошибкой ${r.status} — повторная попытка` });
          await new Promise((w) => setTimeout(w, 5000));
          if (!ac.signal.aborted) { try { const r3 = await requestModel(body); if (r3.ok || r3.status < 500) r = r3; else { try { if (r3.body) await r3.body.cancel(); } catch {} } } catch {} }
        }
        if (r.status === 429) {
          const ra = Number(r.headers.get('retry-after')) || 0;
          const waitMs = Math.min(Math.max(ra * 1000, 45000), 150000);
          try { if (r.body) await r.body.cancel(); } catch {}
          console.log('provider 429 - waiting ' + waitMs + 'ms before retry');
          out({ s: 'waiting', q: 'Модель занята — подожду ' + Math.round(waitMs / 1000) + ' с и попробую ещё раз' });
          await new Promise((w) => setTimeout(w, waitMs));
          try {
            const r2 = await requestModel(body);
            if (r2.ok) r = r2; else { try { if (r2.body) await r2.body.cancel(); } catch {} }
          } catch {}
        }
        if (!r.ok) {
          stopWaiting();
          // модель не поддерживает инструменты — ищем сами и подкладываем результаты
          if (body.tools && !fellBack && [400, 422].includes(r.status)) {
            await r.text().catch(() => {}); toolsOK = false; fellBack = true;
            if (notes) convo[0].content = convo[0].content.replace(notes, mem.on && mem.items.length ? '\n\nЧто ты знаешь о пользователе:\n' + mem.items.map((x) => '- ' + x.text).join('\n') : '');
            if (artifact) convo[0].content += editMode ? artifactEdit.EDIT_NOTE : chatPolicy.ARTIFACT_NOTE;
            if (!useWeb) { round--; continue; }
            convo[0].content = convo[0].content.replace(WEB_NOTE, '\n\nНиже — свежие результаты поиска в интернете по запросу пользователя. Используй их и ссылайся на источники Markdown-ссылками [название](url).');
            const last = messages[messages.length - 1], q = (typeof last.content === 'string' ? last.content : last.content.filter((x) => x.type === 'text').map((x) => x.text).join(' ')).slice(-300);
            out({ s: 'search', q });
            try { const list = await web.search(st, q); list.forEach((x) => addSrc(x.title, x.url)); convo[0].content += '\n\nРезультаты поиска по запросу пользователя:\n' + web.formatResults(list); }
            catch (e) { convo[0].content += '\n\n(Поиск не удался: ' + e.message + ')'; }
            round--; continue;
          }
          stopWaiting(); trace.outcome = 'upstream_error';
          out({ e: await upstreamError(r) }); break;
        }
        let text = ''; const calls = [];
        for await (const j of chatStream.events(r)) {
            const delta = j.choices?.[0]?.delta || {};
            if (j.choices?.[0]?.finish_reason === 'length') cut = true;
            if (delta.content) {
              if (!text && full && !/\s$/.test(full)) { full += '\n\n'; if (!editMode) textOut('\n\n'); }
              text += delta.content; full += delta.content;
              if (!editMode) textOut(delta.content);
              else { stopWaiting(); if (trace.firstTextMs == null) trace.firstTextMs = Date.now() - trace.started; }
            } // JSON правок не публикуем как готовый результат до проверки.
            const rz = delta.reasoning_content ?? delta.reasoning; if (typeof rz === 'string' && rz) out({ r: rz });
            for (const tc of delta.tool_calls || []) {
              const i = tc.index ?? calls.length;
              calls[i] ||= { id: '', name: '', args: '' };
              if (tc.id) calls[i].id = tc.id;
              if (tc.function?.name) calls[i].name += tc.function.name;
              if (tc.function?.arguments) calls[i].args += tc.function.arguments;
            }
        }
        stopWaiting();
        const list = calls.filter(Boolean);
        if (!list.length) break;
        list.forEach((c, i) => { if (!c.id) c.id = 'call_' + round + '_' + i; });
        convo.push({ role: 'assistant', content: text || null, tool_calls: list.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args || '{}' } })) });
        const images = [];
        let executed = false;
        for (const c of list) {
          let args;
          let result;
          try {
            trace.tools++;
            if (!tools.some((t) => t.function.name === c.name))
              throw new Error(`Инструмент ${c.name} недоступен для этой задачи. Верни результат кодом или используй доступный инструмент.`);
            try { args = JSON.parse(c.args || '{}'); } catch { throw new Error('Некорректный JSON аргументов инструмента'); }
            args = chatPolicy.validateTool(c.name, args);
            if (c.name === 'download_asset') {
              out({ s: 'asset', q: String(args.name || '3D-модель').slice(0, 120) });
              const record = await assets.download(user.id, args, ac.signal);
              out({ asset: record });
              result = 'Модель действительно скачана. Используй ТОЧНЫЙ ref в GLTFLoader.load. Лицензия записана со слов источника, не проверена автоматически. ' + JSON.stringify(record);
            } else if (c.name === 'web_search') { readWeb = true;
              out({ s: 'search', q: String(args.query || '') });
              const res2 = await web.search(st, args.query); res2.forEach((x) => addSrc(x.title, x.url)); result = web.formatResults(res2);
            } else if (c.name === 'fetch_page') { readWeb = true;
              out({ s: 'read', q: String(args.url || '') });
              let pg; try { pg = useBrowser ? await browser.readPage(args.url) : await web.fetchPage(args.url); } catch (e) { if (!useBrowser || /внутренний|запрещ/.test(e.message)) throw e; pg = await web.fetchPage(args.url); }
              addSrc(pg.title, pg.url); result = `Страница: ${pg.title}\n${pg.url}\n\n${pg.text}`;
            } else if (c.name === 'view_page' && useBrowser && model.vision) { readWeb = true;
              out({ s: 'view', q: String(args.url || '') });
              const v = await browser.viewPage(args.url); addSrc(v.title, v.url);
              result = `Скриншот страницы «${v.title}» (${v.url}) приложен следующим сообщением.`;
              images.push({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + v.image } });
            } else if (c.name === 'remember' && mem.on) {
              const t = String(args.text || '').trim().slice(0, 300); if (!t) throw new Error('пустой факт');
              const fresh = loadMem(user.id); const item = { id: crypto.randomBytes(3).toString('hex'), text: t, at: Date.now() };
              fresh.items = [...fresh.items, item].slice(-100); saveMem(user.id, fresh); mem.items = fresh.items;
              out({ s: 'mem', q: t }); result = 'Сохранено в память (id ' + item.id + ').';
            } else if (c.name === 'forget' && mem.on) {
              const fresh = loadMem(user.id), it = fresh.items.find((x) => x.id === String(args.id));
              if (!it) throw new Error('нет такого факта в памяти');
              fresh.items = fresh.items.filter((x) => x !== it); saveMem(user.id, fresh); mem.items = fresh.items;
              out({ s: 'forget', q: it.text }); result = 'Удалено из памяти.';
            } else if (c.name === 'run_python' && useCode) {
              const codeStr = String(args.code || ''); if (!codeStr.trim()) throw new Error('пустой код');
              if (bill.left(user, 'c') <= 0) throw new Error('лимит запусков Python на сегодня исчерпан — сообщи пользователю, что лимит можно увеличить, сменив тариф');
              bill.add(user.id, 'c');
              out({ s: 'code', q: '' });
              const rr = await coder.run(codeStr, user.id);
              out({ run: { code: codeStr.slice(0, 20000), exit: rr.exit, ms: rr.ms, out: rr.stdout, err: rr.stderr, files: rr.files, timeout: rr.timeout } });
              result = (rr.timeout ? 'Код остановлен: превышен лимит 60 секунд.\n' : `Код завершился с кодом ${rr.exit} за ${(rr.ms / 1000).toFixed(1)} с.\n`) +
                (rr.stdout ? 'Вывод:\n' + rr.stdout + '\n' : 'Вывода нет.\n') + (rr.stderr ? 'Ошибки:\n' + rr.stderr + '\n' : '') +
                (rr.files.length ? 'Созданы файлы (пользователь их видит и может скачать): ' + rr.files.map((f) => f.name).join(', ') : '');
            } else if (fold && folder.NAMES.has(c.name)) {
              result = await folder.ask(user.id, out, c.name, args, ac.signal);
            } else if (useAgent && agent.NAMES.has(c.name)) {
              result = await agent.call(user.id, out, c.name, args, b.agentAuto ? (readWeb ? 'web' : 'all') : false, ac.signal);
            } else if (c.name === 'generate_video' && useVid) {
              if (bill.left(user, 'v') <= 0) throw new Error('лимит видео на сегодня исчерпан — сообщи пользователю, что лимит можно увеличить, сменив тариф');
              const prompt = String(args.prompt || '').trim(); if (!prompt) throw new Error('пустое описание видео');
              let refs = [];
              if (args.use_attached) for (let i = rawMsgs.length - 1; i >= 0 && !refs.length; i--) if (rawMsgs[i]?.role === 'user' && Array.isArray(rawMsgs[i].content)) refs = rawMsgs[i].content.filter((x) => x?.type === 'image_url' && /^data:image\//.test(x.image_url?.url || '')).map((x) => x.image_url.url).slice(0, 1);
              out({ s: 'video', q: prompt.slice(0, 160) });
              let lastP = -1; const g = await videor.generate(st, { prompt, aspect: args.aspect, refs }, ac.signal, (x) => { if (x !== lastP) { lastP = x; out({ vp: x }); } });
              bill.add(user.id, 'v'); const file = videor.save(user.id, g.buf, g.ext);
              out({ vid: { ...file, prompt: prompt.slice(0, 1000) } }); out({ bill: bill.summary(user) });
              result = 'Видео готово и уже показано пользователю под твоим ответом. Не вставляй ссылку. Кратко опиши результат и предложи доработать.';
            } else if (c.name === 'generate_image' && useImg) {
              if (bill.left(user, 'i') <= 0) throw new Error('лимит картинок на сегодня исчерпан — сообщи пользователю, что лимит можно увеличить, сменив тариф');
              const prompt = String(args.prompt || '').trim(); if (!prompt) throw new Error('пустое описание картинки');
              let refs = [], refKind = '';
              const raw = Array.isArray(b.messages) ? b.messages : []; // исходные сообщения: картинки там есть, даже если модель чата их не видит
              if (args.use_attached) {
                for (let i = raw.length - 1; i >= 0 && !refs.length; i--) if (raw[i]?.role === 'user' && Array.isArray(raw[i].content)) refs = raw[i].content.filter((x) => x?.type === 'image_url' && /^data:image\//.test(x.image_url?.url || '')).map((x) => x.image_url.url).slice(0, 3);
                if (!refs.length) { const d = imager.refFromSaved(user.id, lastGenUrl(raw)); if (d) { refs = [d]; refKind = 'prev'; } }
                if (refs.length && !refKind) refKind = 'user';
              } else if (args.use_attached === undefined && prevImage && !media.IMG.test(lastText) && lastText.length < 300) {
                // модель не указала основу, но это уточнение предыдущей картинки (без просьбы нарисовать новую) — берём её автоматически
                const d = imager.refFromSaved(user.id, lastGenUrl(raw)); if (d) { refs = [d]; refKind = 'prev'; }
              }
              out({ s: 'image', q: prompt.slice(0, 160) });
              const g = await imager.generate(st, { prompt, aspect: args.aspect, refs }, ac.signal);
              bill.add(user.id, 'i'); const file = imager.save(user.id, g.buf, g.ext);
              out({ img: { ...file, prompt: prompt.slice(0, 1000) } }); out({ bill: bill.summary(user) });
              result = 'Картинка готова и уже показана пользователю под твоим ответом' + (refKind === 'user' ? ' (за основу взята приложенная им картинка)' : refKind === 'prev' ? ' (за основу взята ранее нарисованная картинка — её детали сохранены)' : '') + '. Не вставляй её ссылкой. Кратко опиши результат и предложи варианты доработки.' + (args.use_attached && !refs.length ? ' Внимание: картинки-основы не нашлось, нарисовано с нуля.' : '');
            } else result = 'Неизвестный инструмент';
            executed = true;
          } catch (e) { result = 'Ошибка: ' + e.message; out({ s: 'fail', q: e.message }); }
          convo.push({ role: 'tool', tool_call_id: c.id, content: result });
        }
        if (images.length) convo.push({ role: 'user', content: [{ type: 'text', text: 'Скриншоты, которые ты запросил:' }, ...images] });
        pending = executed; // За отклонённый вызов/невалидные аргументы не списываем ещё сообщение.
      }
      if (editMode && trace.outcome === 'complete' && !ac.signal.aborted) {
        if (artifactEdit.clarification(full)) {
          trace.outcome = 'needs_clarification'; textOut(full);
        } else {
          let applied = null, editError = '';
          try { applied = artifactEdit.apply(base, full); } catch (e) { editError = e.message; }
          if (!applied) {
            trace.repairs = 1;
            out({ s: 'repair_edit', q: editError });
            const retry = await requestModel({
              model: model.modelId, stream: true, ...(maxTok ? { max_tokens: maxTok } : {}),
              messages: [...convo, { role: 'assistant', content: full || '(Нет правок)' }, { role: 'user', content: artifactEdit.repairNote(editError) }],
            });
            if (retry.ok) {
              let proposed = '';
              for await (const j of chatStream.events(retry)) {
                const d = j.choices?.[0]?.delta || {};
                if (d.content) { proposed += d.content; stopWaiting(); }
                const reasoning = d.reasoning_content ?? d.reasoning;
                if (typeof reasoning === 'string') out({ r: reasoning });
              }
              stopWaiting();
              if (artifactEdit.clarification(proposed)) {
                trace.outcome = 'needs_clarification'; full = proposed; textOut(proposed);
              } else {
                try { applied = artifactEdit.apply(base, proposed); } catch (e) { editError = e.message; }
              }
            } else { stopWaiting(); editError = await upstreamError(retry); }
          }
          if (applied) {
            full = applied.source; cut = false;
            trace.editCount = applied.edits;
            out({ reset: true }); textOut(full);
          } else if (trace.outcome !== 'needs_clarification') {
            trace.outcome = 'edit_rejected'; full = ''; cut = false;
            out({ e: 'Правки не применены; исходная версия сохранена. ' + editError });
          }
        }
      }
      // Один повтор на пустое обещание в режиме создания.
      if (artifact && !editMode && sitesLeft && trace.outcome === 'complete' && !ac.signal.aborted && chatPolicy.needsRepair(full)) {
        trace.repairs = 1;
        out({ s: 'repair', q: 'Модель не прислала полный HTML — запрашиваю завершённый результат один раз.' });
        const repairConvo = [...convo, { role: 'assistant', content: full || '(Ответ без готового результата)' }, { role: 'user', content: chatPolicy.REPAIR_NOTE }];
        let rr = await requestModel({ model: model.modelId, messages: repairConvo, stream: true, ...(maxTok ? { max_tokens: maxTok } : {}) });
        // нестабильный провайдер (5xx): одна повторная попытка после паузы
        if (rr.status >= 500 && rr.status !== 501 && !ac.signal.aborted) {
          try { if (rr.body) await rr.body.cancel(); } catch {}
          await new Promise((w) => setTimeout(w, 5000));
          if (!ac.signal.aborted) { try { const rr2 = await requestModel({ model: model.modelId, messages: repairConvo, stream: true, ...(maxTok ? { max_tokens: maxTok } : {}) }); if (rr2.ok || rr2.status < 500) rr = rr2; else { try { if (rr2.body) await rr2.body.cancel(); } catch {} } } catch {} }
        }
        if (!rr.ok) {
          trace.outcome = 'repair_error'; stopWaiting();
          out({ s: 'fail', q: await upstreamError(rr) });
          out({ e: 'Не удалось получить полный HTML при повторном запросе. Игра или сайт не созданы.' });
        } else {
          // Удаляем старое обещание/оборванный блок, иначе Markdown может
          // принять открывающий fence нового HTML за закрытие старого.
          full = ''; cut = false;
          out({ reset: true });
          let repairCut = false;
          for await (const j of chatStream.events(rr)) {
            const choice = j.choices?.[0], d = choice?.delta || {};
            if (choice?.finish_reason === 'length') repairCut = true;
            if (d.content) { full += d.content; textOut(d.content); }
            if (typeof (d.reasoning_content ?? d.reasoning) === 'string') out({ r: d.reasoning_content ?? d.reasoning });
          }
          cut = chatPolicy.completeHtml(full) ? false : cut || repairCut;
          stopWaiting();
        }
      }
      if (artifact && !editMode && sitesLeft && trace.outcome === 'complete' && !chatPolicy.completeHtml(full)) {
        trace.outcome = chatPolicy.needsRepair(full) ? 'missing_artifact' : 'needs_clarification';
        if (trace.outcome === 'missing_artifact') {
          const error = 'Готовый HTML не получен. Ответ модели нельзя считать созданной игрой или сайтом.';
          out({ s: 'fail', q: error }); out({ e: error });
        }
      }
      // Deterministic browser observations; never accept an LLM's "OK" as proof.
      const found = lastSite(full); if (found && !editMode) bill.add(user.id, 's');
      if (found) {
        const game = gameCheck.isGame(found.html, messages), expectedModels = modelAssets.ids(found.html).length;
        const enabled = useBrowser && st.selfcheck && (sitesLeft || editMode) && !ac.signal.aborted;
        let checked = null, reason = enabled ? '' : 'Самопроверка отключена или Chromium недоступен';
        const check = async (candidate) => browser.checkHtml(modelAssets.rewrite(candidate.html, 'https://premier-assets.invalid'), false, {
          assetResolver: assets.resolver(user.id, candidate.html), game, expectedModels: modelAssets.ids(candidate.html).length,
        });
        if (enabled) {
          out({ s: 'check', q: game ? '3D-сцена, модели и управление' : '' });
          try { checked = await check(found); } catch (e) { reason = 'Проверка не завершена: ' + e.message; }
          // At most one complete-code repair for creation. Edits remain exact patches and are not rewritten.
          if (checked?.issues?.length && !editMode && !ac.signal.aborted) {
            trace.browserRepairs = 1;
            out({ s: 'fix', q: 'Исправление найденных браузером проблем' });
            const prompt = CHECK_PROMPT(checked.issues, !!model.vision, found.pack) + '\nНужен полный исправленный код. Ответ OK не заменяет повторную проверку. Не заявляй успех до результата браузера.';
            const r = await requestModel({ model: model.modelId, messages: [...convo, { role: 'assistant', content: full }, { role: 'user', content: prompt }], stream: true, ...(maxTok ? { max_tokens: maxTok } : {}) });
            if (r.ok) {
              let proposed = '';
              for await (const j of chatStream.events(r)) { const d = j.choices?.[0]?.delta?.content; if(d){stopWaiting(); proposed += d;} }
              const repaired = lastSite(proposed);
              if (repaired && chatPolicy.completeHtml(proposed)) {
                full = proposed; out({ reset: true }); textOut(full);
                out({ s: 'check', q: 'Повторная проверка исправленного результата' });
                try { checked = await check(repaired); reason = ''; } catch(e) { checked=null;reason='Повторная проверка не завершена: '+e.message; }
              }
            } else { await r.text().catch(()=>{}); }
            stopWaiting();
          }
        }
        const validation = gameCheck.report(checked, { game, reason });
        out({ validation }); trace.validation = validation.status;
        if (validation.status === 'passed') out({ s: 'ok', q: '' });
        else out({ s: 'fail', q: (editMode ? 'Правки применены, но браузер нашёл проблемы или не подтвердил результат. ' : '') +
          (validation.status === 'failed' ? 'Проверка не пройдена. ' : 'Работоспособность не подтверждена. ') + validation.checks.filter(x=>!['passed','not_required'].includes(x.status)).map(x=>x.label+': '+x.detail).join('; ') });
      }
    } catch (e) {
      trace.outcome = ac.signal.aborted ? 'cancelled' : modelSignal?.reason?.name === 'TimeoutError' ? 'timeout' : 'error';
      if (!ac.signal.aborted) {
        if (monitor.isBug(e)) monitor.error('чат, модель ' + (model.name || model.id), e);
        out({ e: trace.outcome === 'timeout' ? `Модель не завершила запрос за ${Math.round(timeoutMs / 1000)} с. Попробуйте более быструю модель или более простую задачу.` : 'Ошибка соединения с моделью: ' + e.message });
      }
    }
    if (cut) out({ s: 'fail', q: 'Ответ упёрся в предел длины по тарифу. Напишите «продолжи», чтобы получить остальное' });
    if (sources.length) out({ src: sources.slice(0, 12) });
    if (!full.trim()) bill.add(user.id, 'm', -charged); // ответа нет — сообщения не списываем
    finishTrace();
    out({ bill: bill.summary(user) });
    genEnd();
    return res.end();
  }
  return json(res, 404, { error: 'Not found' });
}

let VTEST = { state: '' };
// отдать картинку/видео; для видео — с поддержкой Range (перемотка, Safari)
const MEDIA = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime' };
function sendMedia(req, res, fp, name, dl) {
  const ext = path.extname(name).toLowerCase(), type = MEDIA[ext], size = fs.statSync(fp).size;
  const h = { 'Content-Type': type || 'application/octet-stream', 'Content-Disposition': (type && !dl ? 'inline' : 'attachment') + `; filename*=UTF-8''${encodeURIComponent(name)}`, 'Content-Security-Policy': 'sandbox', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=86400', 'Accept-Ranges': 'bytes' };
  const rg = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (rg && (rg[1] || rg[2])) {
    let a = rg[1] ? +rg[1] : size - +rg[2], b = rg[1] && rg[2] ? Math.min(+rg[2], size - 1) : size - 1; a = Math.max(0, a);
    if (a > b || a >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
    res.writeHead(206, { ...h, 'Content-Range': `bytes ${a}-${b}/${size}`, 'Content-Length': b - a + 1 }); return fs.createReadStream(fp, { start: a, end: b }).pipe(res);
  }
  res.writeHead(200, { ...h, 'Content-Length': size }); return fs.createReadStream(fp).pipe(res);
}
  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  res.on('finish', () => monitor.request(res.statusCode));
  if (url.pathname === '/healthz') { // для проверки «жив ли сервер» (deploy/healthcheck.sh, внешние мониторы)
    const h = monitor.health({ db: () => store.db.prepare('SELECT 1 AS x').get().x === 1 });
    res.writeHead(h.ok ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); return res.end(JSON.stringify(h));
  }
  // базовые заголовки безопасности: без MIME-угадывания, без утечки полного адреса в Referer,
  // страницы Premier нельзя встроить на чужой сайт (защита от кликджекинга); опубликованные сайты /s/ встраивать можно
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (!url.pathname.startsWith('/s/')) res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  if (PUBLIC_URL.startsWith('https:') || req.socket.encrypted) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  if (assets.serve(req, res, url.pathname)) return;
  if (url.pathname.startsWith('/api/')) {
    try { return await handleApi(req, res, url); }
    catch (e) {
      const bug = monitor.isBug(e); if (bug) monitor.error(`${req.method} ${url.pathname}`, e);
      if (!res.headersSent) return json(res, e.status || (bug ? 500 : 400), { error: bug ? 'Внутренняя ошибка сервера. Она записана в журнал — попробуйте ещё раз' : e.message }); return res.end();
    }
  }
  if (publications.match(url.pathname)) {
    try { return await publications.serve(req, res, url); }
    catch (e) {
      monitor.error('publication', e);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end('Не удалось открыть сайт. Попробуйте ещё раз.');
    }
  }
    if (url.pathname === '/status') { res.writeHead(302, { Location: '/status.html' }); return res.end(); }
  if (/^\/r\/[a-zA-Z0-9_-]{8,64}$/.test(url.pathname)) { res.writeHead(302, { Location: '/login?ref=' + encodeURIComponent(url.pathname.slice(3)) }); return res.end(); }
if (/^\/chat\/?$/.test(url.pathname) || /^\/login\/?$/.test(url.pathname)) {
    const u = currentUser(req), isChat = url.pathname.startsWith('/chat');
    if (isChat && !u) { res.writeHead(302, { Location: '/login' }); return res.end(); }
    if (!isChat && u) { res.writeHead(302, { Location: '/chat' }); return res.end(); }
    languageHeaders(req, res);
    let html = fs.readFileSync(htmlPath(PUBLIC_DIR, isChat ? 'chat.html' : 'login.html', req), 'utf8');
    if (isChat) html = html.replace('<!--ME-->', `<script>window.ME=${JSON.stringify(publicUser(u)).replace(/</g, '\\u003c')}</script>`);
    else html = html.replace('<!--REG-->', `<script>window.REG=${regOpen()};window.GOOGLE=${googleOn()};window.GITHUB=${githubOn()}</script>`);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(html);
  }
  if (['/', '/index.html', '/privacy.html'].includes(url.pathname)) {
    languageHeaders(req, res);
    res.writeHead(200, { 'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store' });
    return res.end(fs.readFileSync(htmlPath(PUBLIC_DIR, url.pathname === '/privacy.html' ? 'privacy.html' : 'index.html', req)));
  }
  if (/^\/en\/(?:chat|login)\.html$/.test(url.pathname)) {
    res.writeHead(302, { Location:'/' + path.basename(url.pathname,'.html') + '?lang=en', 'Cache-Control':'no-store' }); return res.end();
  }
  if (url.pathname === '/privacy') { res.writeHead(302, { Location: '/privacy.html' }); return res.end(); }
  if (url.pathname === '/terms') { res.writeHead(302, { Location: '/terms.html' }); return res.end(); }
  if (url.pathname === '/premier-agent.cmd') { // Windows двойным щелчком: скачивает .ps1-установщик (он сам проверит/поставит Node.js) и запускает
    const code = String(url.searchParams.get('code') || '').toUpperCase().replace(/[^A-F0-9]/g, '').slice(0, 8), srv = originOf(req).replace(/[^\w:/.\-]/g, '');
    const bat = ['@echo off', 'chcp 65001 >nul', 'title Premier Agent', 'set "F=%USERPROFILE%\\premier-agent.ps1"', `curl -fsSL "${srv}/premier-agent.ps1?code=${code}" -o "%F%"`, 'if errorlevel 1 (', '  del "%F%" >nul 2>nul', '  echo Не удалось скачать установщик с ' + srv + ' — проверьте интернет и запустите файл снова.', '  pause', '  exit /b 1', ')', `powershell -NoProfile -ExecutionPolicy Bypass -File "%F%"`, 'pause', ''].join('\r\n');
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="Premier-Agent.cmd"', 'Cache-Control': 'no-store' }); return res.end(bat);
  }
  if (url.pathname === '/premier-agent.ps1') { // сам установщик: сервер и код вшиты; всегда UTF-8 с BOM (иначе PS 5.1 съест кириллицу)
    const code = String(url.searchParams.get('code') || '').toUpperCase().replace(/[^A-F0-9]/g, '').slice(0, 8), srv = originOf(req).replace(/[^\w:/.\-]/g, '');
    const src = '\uFEFF' + fs.readFileSync(path.join(__dirname, 'desktop', 'premier-agent.ps1'), 'utf8').replace(/^\uFEFF/, '').replace('__PREMIER_SERVER__', srv).replace('__PREMIER_CODE__', code);
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': 'attachment; filename="premier-agent.ps1"', 'Cache-Control': 'no-store' }); return res.end(src);
  }
  if (url.pathname === '/premier-agent.js') {
    const src = fs.readFileSync(path.join(__dirname, 'desktop', 'premier-agent.js'), 'utf8').replace('__PREMIER_SERVER__', originOf(req));
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Content-Disposition': 'attachment; filename="premier-agent.js"', 'Cache-Control': 'no-store' }); return res.end(src);
  }
  if (/^\/panelp\/?$/.test(url.pathname)) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'X-Frame-Options': 'DENY' }); return res.end(fs.readFileSync(path.join(PUBLIC_DIR, 'panel.html'))); }
  if (url.pathname === '/panel.html') { res.writeHead(404); return res.end('Not found'); }
  if (/^\/(chat|login)\.html$/.test(url.pathname)) { res.writeHead(302, { Location: url.pathname.replace('.html', '') }); return res.end(); }
  let f = path.normalize(path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : /^\/chat\/?$/.test(url.pathname) ? 'chat.html' : url.pathname));
  if (f !== PUBLIC_DIR && !f.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(data);
  });
}).listen(PORT, process.env.HOST || undefined, () => console.log(`Premier: http://${process.env.HOST || 'localhost'}:${PORT}`)); // HOST=127.0.0.1 — доступ только через прокси
// корректное завершение (браузер закрывается вместе с сервером)
let stopping = false;
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, async () => {
  if (stopping) return;
  stopping = true;
  const force = setTimeout(() => process.exit(0), 5000);
  force.unref();
  try { bill.flush(); } catch {}
  try { await browser.close(); } catch {}
  process.exit(0);
});
