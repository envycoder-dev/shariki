/* Premier Developer API dashboard. Vanilla JS, no dependencies.
   Every server-provided string is rendered through textContent (h()/text nodes), never innerHTML. */
(function () {
'use strict';

var doc = document, root = doc.documentElement;
var LANG = /^en/i.test(root.getAttribute('lang') || '') ? 'en' : 'ru';
var PLACEHOLDER = '__PREMIER_KEY__', SENT = '\uE000';
var MAX_KEYS = 10;

try {
  var qTheme = new URLSearchParams(location.search).get('theme');
  if (qTheme === 'dark' || qTheme === 'light') root.setAttribute('data-theme', qTheme);
} catch (e) {}

/* ───────────────────────── i18n ───────────────────────── */
var D = { ru: {}, en: {} };

D.ru = {
  brand_api: 'API',
  nav_overview: 'Обзор', nav_connect: 'Подключение', nav_keys: 'Ключи', nav_models: 'Модели', nav_logs: 'Логи', nav_playground: 'Песочница', nav_docs: 'Документация',
  nav_label: 'Разделы API', skip: 'К содержимому', back_to_chat: 'В чат', lang_label: 'Язык',
  copy: 'Копировать', copied: 'Скопировано', copy_fail: 'Не удалось скопировать', retry: 'Повторить', cancel: 'Отмена', save: 'Сохранить', close: 'Закрыть', done: 'Готово', cont: 'Продолжить', back: 'Назад', change: 'Изменить', loading: 'Загрузка…',   err_generic: 'Что-то пошло не так. Попробуйте ещё раз.', err_network: 'Нет связи с сервером. Проверьте интернет и повторите.', err_load: 'Не удалось загрузить данные',   never: 'никогда', just_now: 'только что', ago_min: '{n} мин назад', ago_h: '{n} ч назад', ago_d: '{n} дн назад', in_min: 'через {n} мин', in_h: 'через {n} ч', in_d: 'через {n} дн',
  u_ms: 'мс', u_s: 'с', today: 'сегодня', tomorrow: 'завтра', sec: 'с',
  msgs: ['сообщение', 'сообщения', 'сообщений'], reqs: ['запрос', 'запроса', 'запросов'], days_n: ['день', 'дня', 'дней'], ips_n: ['адрес', 'адреса', 'адресов'],

  usage_today: 'Сегодня', usage_of: 'из {limit}', usage_unlimited: 'Без лимита', usage_shared: 'Общий лимит с чатом', usage_resets: 'Сброс в {time}', usage_resets_tmr: 'Сброс завтра в {time}', usage_left: 'Осталось {n}', usage_meter: 'Использовано сообщений за сегодня',
  plan_trial: 'Пробный период', plan_until: 'до {date}',

  ov_kicker: 'Premier · API для разработчиков', ov_t1: 'Модели Premier —', ov_t2: 'в любом инструменте',
  ov_sub: 'API, совместимый с OpenAI и Anthropic. Подключайте Claude Code, Codex, Cursor и другие — запросы тратят те же сообщения, что и чат.',
  base_urls: 'Базовые URL', base_openai: 'OpenAI-совместимый', base_anthropic: 'Anthropic-совместимый', base_openai_for: 'Codex, Cursor, Cline, Aider, OpenAI SDK', base_anthropic_for: 'Claude Code, Anthropic SDK', copy_url: 'Копировать URL {name}',
  ov_connect: 'Подключить инструмент', ov_connect_sub: 'Выберите — и мы подготовим готовую команду.',
  tile_claude: 'Терминальный агент', tile_codex: 'CLI-агент', tile_cursor: 'ИИ-редактор', tile_other: 'Cline, OpenCode, Aider, SDK…',
  gs_title: 'Начните за три шага', gs_1_t: 'Создайте ключ', gs_1_d: 'Лучше отдельный ключ на каждый инструмент — так проще отзывать.', gs_2_t: 'Вставьте одну команду', gs_2_d: 'Мы подготовим настройки именно для вашего инструмента.', gs_3_t: 'Смотрите, как он подключается', gs_3_d: 'Эта страница покажет первый запрос в реальном времени.', gs_cta: 'Подключить первый инструмент', gs_cta2: 'Создать ключ',
  chart_title: 'Запросы за 30 дней', chart_empty: 'Пока нет запросов', chart_aria: 'График запросов по дням. Стрелки влево и вправо выбирают день.', chart_ok: 'Успешные',
  m_requests: 'Запросы', m_messages: 'Сообщения', m_errors: 'Ошибки', m_tokens: 'Токены',
  by_model: 'По моделям', by_client: 'По клиентам', recent: 'Последние запросы', all_logs: 'Все логи', recent_empty: 'Запросов пока не было.', no_data: 'Данных пока нет',

  wz_title: 'Подключение инструмента', wz_sub: 'Пять коротких шагов — и ваш инструмент работает на моделях Premier.',
  st_tool: 'Инструмент', st_model: 'Модель', st_key: 'Ключ', st_setup: 'Настройка', st_check: 'Проверка', wz_steps: 'Шаги подключения', wz_step_of: 'Шаг {n} из {m}',
  s1_t: 'Что подключаем?', s1_d: 'Выберите инструмент — подготовим инструкцию именно для него.', badge_quick: 'одна команда',
  s2_t: 'Выберите модель', s2_d: 'Инструмент будет использовать её по умолчанию.', s2_fast: 'Быстрая модель для фоновых задач', s2_fast_d: 'Для коротких служебных запросов. Модель подешевле экономит сообщения.',
  tag_default: 'по умолчанию', tag_cheapest: 'выгоднее всего', warn_chat_only: 'Без вызова инструментов — агенты могут работать нестабильно', no_models: 'На вашем тарифе пока нет доступных моделей.',
  s3_t: 'Ключ доступа', s3_d: 'Ключ — это пропуск инструмента к моделям. Создадим новый или возьмём один из ваших.',
  key_new_for: 'Создать новый ключ для {tool}', key_new_hint: 'Назовём его «{name}». Ключ появится, когда вы нажмёте «Продолжить».', key_limit: 'Достигнут лимит в 10 ключей — выберите существующий или отзовите ненужный.',
  key_existing: 'Или используйте существующий', key_raw_known: 'ключ доступен в этой сессии', key_raw_hidden: 'значение скрыто', key_just: 'только что создан',
  key_note_hidden: 'Существующий ключ нельзя показать повторно, поэтому в командах будет заглушка YOUR_KEY — подставьте свой ключ. Или создайте новый.', creating_key: 'Создаём ключ…', key_created_for: 'Ключ «{name}» создан',
  s4_t: 'Настройте {tool}', s4_d: 'Скопируйте и выполните. Ваша модель и ключ уже подставлены.', quick_t: 'Быстрый способ', quick_badge: 'Рекомендуем', quick_d: 'Выполните в терминале — команда настроит всё сама. Подтвердите вход на этой странице, если появится окно.',
  manual_t: 'Настроить вручную', os_unix: 'macOS / Linux', os_win: 'Windows', your_key: 'YOUR_KEY', key_hint_replace: 'Подставьте свой ключ вместо YOUR_KEY.',
  sum_tool: 'Инструмент', sum_model: 'Модель', sum_fast: 'Быстрая', sum_key: 'Ключ', key_banner_raw: 'Ключ показан только в этой сессии — скопируйте его в безопасное место.', copy_key: 'Копировать ключ',
  waiting: 'Ждём первый запрос…', btn_check: 'Проверить подключение',
  s5_d: 'Запустите {tool} и отправьте любое сообщение — страница обновится сама.', s5_wait: 'Ждём запрос от {tool}', s5_keep: 'Не закрывайте вкладку — проверка идёт автоматически.', s5_tips: 'Если долго ничего не происходит',
  s5_ok_t: '{tool} подключён', s5_ok_d: 'Первый запрос получен {time}. Можно работать!', conn_client: 'Клиент', conn_ip: 'IP-адрес', conn_time: 'Время',
  btn_logs: 'Смотреть логи', btn_another: 'Подключить ещё', btn_overview: 'На обзор', toast_connected: '{tool} подключён ✓',
  clients_err: 'Не удалось загрузить список инструментов',

  keys_t: 'API-ключи', keys_d: 'Ключ открывает доступ к моделям Premier. Храните его как пароль.', keys_new: 'Новый ключ', keys_count: '{n} из {max}',
  col_created: 'Создан', col_last: 'Использован', col_expires: 'Срок', col_today: 'Сегодня',
  never_used: 'не использовался', exp_never: 'Бессрочный', exp_in: 'через {t}', exp_expired: 'Истёк', exp_today: 'Истекает сегодня', all_models: 'Все модели', ip_chip: 'IP: {n}', ip_title: 'Разрешённые IP: {list}',   a_connect: 'Подключить', a_edit: 'Изменить', a_roll: 'Перевыпустить', a_revoke: 'Отозвать', a_connect_aria: 'Подключить инструмент с ключом «{name}»', a_edit_aria: 'Изменить ключ «{name}»', a_roll_aria: 'Перевыпустить ключ «{name}»', a_revoke_aria: 'Отозвать ключ «{name}»',
  keys_empty_t: 'Ключей пока нет', keys_empty_d: 'Создайте первый ключ — это займёт десять секунд.',
  dlg_create_t: 'Новый API-ключ', dlg_edit_t: 'Параметры ключа', f_name: 'Название', f_name_ph: 'Например, Claude Code на ноутбуке', f_name_err: 'Введите название — до 60 символов', f_expiry: 'Срок действия',
  exp_opt_none: 'Бессрочно', exp_opt_30: '30 дней', exp_opt_90: '90 дней', exp_opt_365: '1 год',
  f_models: 'Ограничить моделями', f_models_hint: 'Ничего не выбрано — ключ работает со всеми моделями.', f_ips: 'Разрешённые IP-адреса', f_ips_hint: 'По одному адресу или подсети (CIDR) в строке. Пусто — любой IP.', f_ips_ph: '203.0.113.5\n198.51.100.0/24', f_ips_err: 'Неверный IP-адрес: {v}', f_optional: 'необязательно', btn_create: 'Создать ключ',
  roll_t: 'Перевыпустить ключ?', roll_d: 'Старый ключ «{name}» перестанет работать сразу. Новое значение покажем один раз.', roll_ok: 'Перевыпустить', revoke_t: 'Отозвать ключ?', revoke_d: 'Ключ «{name}» перестанет работать сразу. Это нельзя отменить.', revoke_ok: 'Отозвать',
  once_t: 'Скопируйте ключ сейчас', once_d: 'Это единственный раз, когда мы показываем ключ целиком. Сохраните его в менеджере паролей или сразу настройте инструмент.', once_warn: 'Мы не сможем показать его снова. Потеряете — перевыпустите ключ.', once_use: 'Подключить инструмент с этим ключом', once_for: 'Ключ «{name}»',
  toast_created: 'Ключ создан', toast_rolled: 'Ключ перевыпущен', toast_revoked: 'Ключ отозван', toast_saved: 'Сохранено',

  models_t: 'Модели', models_d: 'Все модели Premier, доступные по API. Идентификатор — значение параметра model.', cost_msg: ['{n} сообщение за запрос', '{n} сообщения за запрос', '{n} сообщений за запрос'],
  badge_vision: 'Изображения', badge_default: 'По умолчанию', agent_yes: 'Готова для агентов (вызов инструментов)', agent_no: 'Только чат — без вызова инструментов', agent_unk: 'Ещё не проверена на агентах', avail_on: 'Доступна на тарифе {plan}', avail_none: 'Недоступна на вашем тарифе', copy_id: 'Копировать идентификатор {id}', 
  logs_t: 'Журнал запросов', logs_d: 'Каждый запрос из ваших инструментов. Сообщения списываются по весу модели.', f_key: 'Ключ', all_keys: 'Все ключи', refresh: 'Обновить',
  col_time: 'Время', col_keyclient: 'Ключ / клиент', col_model: 'Модель', col_status: 'Статус', col_latency: 'Задержка', col_tokens: 'Токены', col_cost: 'Списано',
  logs_more: 'Показать ещё', logs_empty_t: 'Запросов пока нет', logs_empty_d: 'Как только инструмент отправит первый запрос, он появится здесь.', logs_empty_f: 'По этому ключу запросов нет', ttft: 'TTFT', stream: 'поток', unknown_client: 'неизвестный клиент',
  proto_chat: 'Chat', proto_responses: 'Responses', proto_messages: 'Messages', 
  pg_t: 'Песочница', pg_d: 'Проверьте модель прямо здесь — без инструментов и ключей.', pg_model: 'Модель', pg_system: 'Системный промпт', pg_user: 'Сообщение', pg_user_ph: 'Спросите о чём угодно…', pg_send: 'Отправить', pg_stop: 'Остановить', pg_max: 'Макс. токенов',
  pg_cost: 'Запрос спишет {n} из общего дневного лимита.', pg_answer: 'Ответ', pg_empty: 'Ответ появится здесь, слово за словом.', pg_reasoning: 'Рассуждения', pg_stopped: 'Остановлено', pg_ttft: 'До первого токена', pg_total: 'Всего', pg_tokens: 'Токены', pg_running: 'Модель отвечает…', pg_need_msg: 'Введите сообщение', pg_hotkey: 'Ctrl + Enter — отправить', 
  docs_t: 'Документация', docs_d: 'Коротко о том, как устроен API Premier. Всё совместимо с SDK OpenAI и Anthropic.',
  d_base: 'Базовые URL', d_base_d: 'OpenAI-инструменты используют адрес с /v1, Anthropic-инструменты (в том числе Claude Code) — адрес без него.',
  d_auth: 'Авторизация', d_auth_d: 'Передавайте ключ заголовком `Authorization: Bearer YOUR_KEY`. SDK Anthropic отправляют ключ в заголовке `x-api-key` — это тоже работает.',
  d_endpoints: 'Эндпоинты', ep_chat: 'Chat Completions (OpenAI)', ep_resp: 'Responses (OpenAI)', ep_msg: 'Messages (Anthropic)', ep_count: 'Подсчёт токенов (Anthropic)', ep_models: 'Список доступных моделей',
  d_billing: 'Списание сообщений', d_billing_d: 'Каждый запрос списывает вес модели в сообщениях из того же дневного лимита, что и чат. Если запрос завершился ошибкой и ничего не вернул, сообщения возвращаются автоматически.',
  d_limits: 'Лимиты', d_limits_d: 'До {rpm} запросов в минуту и {conc} одновременных запросов.', d_limits_rpm: 'запросов в минуту', d_limits_conc: 'одновременных запросов',
  d_errors: 'Ошибки', d_errors_d: 'Тело ошибки — JSON вида `{"error": "…"}`.', e_401: 'Неверный, истёкший или отозванный ключ', e_403: 'Модель недоступна на вашем тарифе', e_404: 'Неизвестная модель или адрес', e_429: 'Превышен лимит запросов или дневной лимит сообщений. Смотрите заголовок Retry-After.', e_5xx: 'Сбой у провайдера модели — повторите запрос позже', col_code: 'Код', col_meaning: 'Что значит', col_method: 'Метод', col_path: 'Путь', col_desc: 'Описание',
  d_examples: 'Примеры', d_examples_d: 'В примерах подставлена первая доступная вам модель. Вместо YOUR_KEY вставьте свой ключ.', d_jump: 'Разделы документации',

  dv_q: 'Подключить {client} на {os} ({host})?', dv_code: 'Код подтверждения', dv_compare: 'Сверьте код с тем, что показывает терминал.', dv_ip: 'IP-адрес', dv_requested: 'Запрошено', dv_expires: 'Истекает через', dv_approve: 'Подтвердить', dv_deny: 'Отклонить', dv_warn: 'Подтверждайте, только если сами запустили команду.', dv_expired_now: 'Код истёк',
  dv_ok_t: 'Готово!', dv_ok_d: 'Вернитесь в терминал — подключение завершится само.', dv_denied_t: 'Подключение отклонено', dv_denied_d: 'Мы ничего не подключили. Если это были не вы — просто закройте страницу.', dv_nf_t: 'Код устарел или не найден', dv_nf_d: 'Запустите команду в терминале ещё раз — она покажет новый код.',
  user_menu: 'Аккаунт'
};

D.en = {
  brand_api: 'API',
  nav_overview: 'Overview', nav_connect: 'Connect', nav_keys: 'Keys', nav_models: 'Models', nav_logs: 'Logs', nav_playground: 'Playground', nav_docs: 'Docs',
  nav_label: 'API sections', skip: 'Skip to content', back_to_chat: 'Back to chat', lang_label: 'Language',
  copy: 'Copy', copied: 'Copied', copy_fail: 'Couldn’t copy', retry: 'Retry', cancel: 'Cancel', save: 'Save', close: 'Close', done: 'Done', cont: 'Continue', back: 'Back', change: 'Change', loading: 'Loading…',   err_generic: 'Something went wrong. Please try again.', err_network: 'Can’t reach the server. Check your connection and retry.', err_load: 'Couldn’t load data',   never: 'never', just_now: 'just now', ago_min: '{n} min ago', ago_h: '{n} h ago', ago_d: '{n} d ago', in_min: 'in {n} min', in_h: 'in {n} h', in_d: 'in {n} d',
  u_ms: 'ms', u_s: 's', today: 'today', tomorrow: 'tomorrow', sec: 's',
  msgs: ['message', 'messages'], reqs: ['request', 'requests'], days_n: ['day', 'days'], ips_n: ['address', 'addresses'],

  usage_today: 'Today', usage_of: 'of {limit}', usage_unlimited: 'Unlimited', usage_shared: 'Shared with chat', usage_resets: 'Resets at {time}', usage_resets_tmr: 'Resets tomorrow at {time}', usage_left: '{n} left', usage_meter: 'Messages used today',
  plan_trial: 'Trial', plan_until: 'until {date}',

  ov_kicker: 'Premier · Developer API', ov_t1: 'Your Premier models,', ov_t2: 'in any tool',
  ov_sub: 'An OpenAI- and Anthropic-compatible API. Plug in Claude Code, Codex, Cursor and more — requests spend the same daily messages as chat.',
  base_urls: 'Base URLs', base_openai: 'OpenAI-compatible', base_anthropic: 'Anthropic-compatible', base_openai_for: 'Codex, Cursor, Cline, Aider, OpenAI SDK', base_anthropic_for: 'Claude Code, Anthropic SDK', copy_url: 'Copy {name} URL',
  ov_connect: 'Connect a tool', ov_connect_sub: 'Pick one and we’ll prepare a ready-to-run command.',
  tile_claude: 'Terminal agent', tile_codex: 'CLI agent', tile_cursor: 'AI editor', tile_other: 'Cline, OpenCode, Aider, SDKs…',
  gs_title: 'Get started in three steps', gs_1_t: 'Create a key', gs_1_d: 'One key per tool makes it easy to revoke later.', gs_2_t: 'Paste one command', gs_2_d: 'We generate the settings for your exact tool.', gs_3_t: 'Watch it connect', gs_3_d: 'This page shows the first request live.', gs_cta: 'Connect your first tool', gs_cta2: 'Create a key',
  chart_title: 'Requests, last 30 days', chart_empty: 'No requests yet', chart_aria: 'Daily requests chart. Use the left and right arrow keys to pick a day.', chart_ok: 'Successful',
  m_requests: 'Requests', m_messages: 'Messages', m_errors: 'Errors', m_tokens: 'Tokens',
  by_model: 'By model', by_client: 'By client', recent: 'Recent requests', all_logs: 'All logs', recent_empty: 'No requests yet.', no_data: 'No data yet',

  wz_title: 'Connect a tool', wz_sub: 'Five short steps and your tool runs on Premier models.',
  st_tool: 'Tool', st_model: 'Model', st_key: 'Key', st_setup: 'Setup', st_check: 'Check', wz_steps: 'Connection steps', wz_step_of: 'Step {n} of {m}',
  s1_t: 'What are you connecting?', s1_d: 'Pick a tool and we’ll tailor the instructions to it.', badge_quick: 'one command',
  s2_t: 'Choose a model', s2_d: 'The tool will use it by default.', s2_fast: 'Fast model for background tasks', s2_fast_d: 'For short helper requests. A cheaper model saves messages.',
  tag_default: 'default', tag_cheapest: 'best value', warn_chat_only: 'No tool calling — agents may not work reliably', no_models: 'No models are available on your plan yet.',
  s3_t: 'Access key', s3_d: 'The key is the tool’s pass to the models. We’ll create a new one or use one of yours.',
  key_new_for: 'Create a new key for {tool}', key_new_hint: 'We’ll name it “{name}”. It’s created when you press Continue.', key_limit: 'You’ve reached the 10 key limit — pick an existing key or revoke one.',
  key_existing: 'Or use an existing key', key_raw_known: 'available in this session', key_raw_hidden: 'value hidden', key_just: 'just created',
  key_note_hidden: 'An existing key can’t be shown again, so commands will contain a YOUR_KEY placeholder — paste your key there. Or create a new one.', creating_key: 'Creating key…', key_created_for: 'Key “{name}” created',
  s4_t: 'Set up {tool}', s4_d: 'Copy and run. Your model and key are already filled in.', quick_t: 'Quick setup', quick_badge: 'Recommended', quick_d: 'Run it in your terminal — it configures everything. Approve the sign-in on this page if a prompt appears.',
  manual_t: 'Set up manually', os_unix: 'macOS / Linux', os_win: 'Windows', your_key: 'YOUR_KEY', key_hint_replace: 'Replace YOUR_KEY with your key.',
  sum_tool: 'Tool', sum_model: 'Model', sum_fast: 'Fast', sum_key: 'Key', key_banner_raw: 'The key is shown only in this session — copy it somewhere safe.', copy_key: 'Copy key',
  waiting: 'Waiting for the first request…', btn_check: 'Check connection',
  s5_d: 'Launch {tool} and send any message — this page updates by itself.', s5_wait: 'Waiting for a request from {tool}', s5_keep: 'Keep this tab open — we check automatically.', s5_tips: 'If nothing happens',
  s5_ok_t: '{tool} connected', s5_ok_d: 'First request received {time}. You’re all set!', conn_client: 'Client', conn_ip: 'IP address', conn_time: 'Time',
  btn_logs: 'View logs', btn_another: 'Connect another', btn_overview: 'Go to overview', toast_connected: '{tool} connected ✓',
  clients_err: 'Couldn’t load the tool list',

  keys_t: 'API keys', keys_d: 'A key grants access to Premier models. Treat it like a password.', keys_new: 'New key', keys_count: '{n} of {max}',
  col_created: 'Created', col_last: 'Last used', col_expires: 'Expires', col_today: 'Today',
  never_used: 'never used', exp_never: 'No expiry', exp_in: 'in {t}', exp_expired: 'Expired', exp_today: 'Expires today', all_models: 'All models', ip_chip: 'IP: {n}', ip_title: 'Allowed IPs: {list}',   a_connect: 'Connect', a_edit: 'Edit', a_roll: 'Roll', a_revoke: 'Revoke', a_connect_aria: 'Connect a tool with key “{name}”', a_edit_aria: 'Edit key “{name}”', a_roll_aria: 'Roll key “{name}”', a_revoke_aria: 'Revoke key “{name}”',
  keys_empty_t: 'No keys yet', keys_empty_d: 'Create your first key — it takes ten seconds.',
  dlg_create_t: 'New API key', dlg_edit_t: 'Key settings', f_name: 'Name', f_name_ph: 'e.g. Claude Code on laptop', f_name_err: 'Enter a name — up to 60 characters', f_expiry: 'Expiration',
  exp_opt_none: 'Never', exp_opt_30: '30 days', exp_opt_90: '90 days', exp_opt_365: '1 year',
  f_models: 'Restrict to models', f_models_hint: 'None selected — the key works with all models.', f_ips: 'IP allowlist', f_ips_hint: 'One address or CIDR range per line. Empty means any IP.', f_ips_ph: '203.0.113.5\n198.51.100.0/24', f_ips_err: 'Invalid IP address: {v}', f_optional: 'optional', btn_create: 'Create key',
  roll_t: 'Roll this key?', roll_d: 'The old key “{name}” stops working immediately. We’ll show the new value once.', roll_ok: 'Roll key', revoke_t: 'Revoke this key?', revoke_d: 'The key “{name}” stops working immediately. This can’t be undone.', revoke_ok: 'Revoke',
  once_t: 'Copy your key now', once_d: 'This is the only time we show the full key. Save it in a password manager or set up your tool right away.', once_warn: 'We can’t show it again. If you lose it, roll the key.', once_use: 'Connect a tool with this key', once_for: 'Key “{name}”',
  toast_created: 'Key created', toast_rolled: 'Key rolled', toast_revoked: 'Key revoked', toast_saved: 'Saved',

  models_t: 'Models', models_d: 'Every Premier model available over the API. The id is the value of the model parameter.', cost_msg: ['{n} message per request', '{n} messages per request'],
  badge_vision: 'Vision', badge_default: 'Default', agent_yes: 'Ready for agents (tool calling)', agent_no: 'Chat only — no tool calling', agent_unk: 'Not checked yet', avail_on: 'Available on {plan}', avail_none: 'Not available on your plan', copy_id: 'Copy model id {id}', 
  logs_t: 'Request log', logs_d: 'Every request from your tools. Messages are charged by the model’s weight.', f_key: 'Key', all_keys: 'All keys', refresh: 'Refresh',
  col_time: 'Time', col_keyclient: 'Key / client', col_model: 'Model', col_status: 'Status', col_latency: 'Latency', col_tokens: 'Tokens', col_cost: 'Charged',
  logs_more: 'Load more', logs_empty_t: 'No requests yet', logs_empty_d: 'As soon as a tool sends its first request it will show up here.', logs_empty_f: 'No requests for this key', ttft: 'TTFT', stream: 'stream', unknown_client: 'unknown client',
  proto_chat: 'Chat', proto_responses: 'Responses', proto_messages: 'Messages', 
  pg_t: 'Playground', pg_d: 'Try a model right here — no tools or keys needed.', pg_model: 'Model', pg_system: 'System prompt', pg_user: 'Message', pg_user_ph: 'Ask anything…', pg_send: 'Send', pg_stop: 'Stop', pg_max: 'Max tokens',
  pg_cost: 'This request spends {n} from your shared daily limit.', pg_answer: 'Answer', pg_empty: 'The answer will appear here, word by word.', pg_reasoning: 'Reasoning', pg_stopped: 'Stopped', pg_ttft: 'Time to first token', pg_total: 'Total', pg_tokens: 'Tokens', pg_running: 'The model is answering…', pg_need_msg: 'Enter a message', pg_hotkey: 'Ctrl + Enter to send', 
  docs_t: 'Documentation', docs_d: 'A short reference for the Premier API. Everything works with the OpenAI and Anthropic SDKs.',
  d_base: 'Base URLs', d_base_d: 'OpenAI tools use the address with /v1; Anthropic tools (including Claude Code) use the address without it.',
  d_auth: 'Authentication', d_auth_d: 'Send your key as `Authorization: Bearer YOUR_KEY`. Anthropic SDKs send it in the `x-api-key` header — that works too.',
  d_endpoints: 'Endpoints', ep_chat: 'Chat Completions (OpenAI)', ep_resp: 'Responses (OpenAI)', ep_msg: 'Messages (Anthropic)', ep_count: 'Token counting (Anthropic)', ep_models: 'List available models',
  d_billing: 'Billing', d_billing_d: 'Each request spends the model’s weight in messages from the same daily limit as chat. If a request fails and returns nothing, the messages are refunded automatically.',
  d_limits: 'Limits', d_limits_d: 'Up to {rpm} requests per minute and {conc} concurrent requests.', d_limits_rpm: 'requests per minute', d_limits_conc: 'concurrent requests',
  d_errors: 'Errors', d_errors_d: 'The error body is JSON like `{"error": "…"}`.', e_401: 'Invalid, expired or revoked key', e_403: 'Model not available on your plan', e_404: 'Unknown model or path', e_429: 'Rate limit or daily message limit reached. See the Retry-After header.', e_5xx: 'Upstream model provider failure — retry later', col_code: 'Code', col_meaning: 'Meaning', col_method: 'Method', col_path: 'Path', col_desc: 'Description',
  d_examples: 'Examples', d_examples_d: 'Examples use the first model available to you. Replace YOUR_KEY with your key.', d_jump: 'Documentation sections',

  dv_q: 'Connect {client} on {os} ({host})?', dv_code: 'Confirmation code', dv_compare: 'Make sure it matches the code shown in your terminal.', dv_ip: 'IP address', dv_requested: 'Requested', dv_expires: 'Expires in', dv_approve: 'Approve', dv_deny: 'Deny', dv_warn: 'Only approve if you ran the command yourself.', dv_expired_now: 'Code expired',
  dv_ok_t: 'All set!', dv_ok_d: 'Return to your terminal — setup finishes by itself.', dv_denied_t: 'Connection denied', dv_denied_d: 'Nothing was connected. If this wasn’t you, just close this page.', dv_nf_t: 'Code expired or not found', dv_nf_d: 'Run the command in your terminal again to get a new code.',
  user_menu: 'Account'
};

function t(key, vars) {
  var s = D[LANG][key];
  if (s == null) s = D.en[key];
  if (s == null) return key;
  if (typeof s !== 'string') return s;
  return vars ? s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; }) : s;
}

/* ru plural: forms = [one, few, many]; en: [one, other] */
function pl(n, forms) {
  n = Math.abs(n);
  if (LANG === 'ru') {
    if (n % 1) return forms[1];
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return forms[0];
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
    return forms[2];
  }
  return n === 1 ? forms[0] : forms[1];
}
function tn(key, n) { return pl(n, t(key)); }               // noun form only
function tnum(key, n) { return num(n) + ' ' + tn(key, n); } // "2 messages"
function tcost(n) { return pl(n, t('cost_msg')).replace('{n}', num(n)); }

/* ───────────────────────── formatting ───────────────────────── */
var nf0 = new Intl.NumberFormat(LANG, { maximumFractionDigits: 0 });
var nf1 = new Intl.NumberFormat(LANG, { maximumFractionDigits: 1 });
var nf2 = new Intl.NumberFormat(LANG, { maximumFractionDigits: 2 });
var nfc = new Intl.NumberFormat(LANG, { notation: 'compact', maximumFractionDigits: 1 });
function num(n) { return nf1.format(+n || 0); }
function int(n) { return nf0.format(+n || 0); }
function dtf(opts) { return new Intl.DateTimeFormat(LANG, opts); }
var fDay = dtf({ day: 'numeric', month: 'short' }), fDayY = dtf({ day: 'numeric', month: 'short', year: 'numeric' });
var fTime = dtf({ hour: '2-digit', minute: '2-digit' }), fTimeS = dtf({ hour: '2-digit', minute: '2-digit', second: '2-digit' });
var fFull = dtf({ day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
var fWeekday = dtf({ weekday: 'short', day: 'numeric', month: 'long' });
function isoDay(ms) { var d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function fmtDate(ms) { return (new Date(ms).getFullYear() === new Date().getFullYear() ? fDay : fDayY).format(ms); }
function fmtDateTime(ms) { return fmtDate(ms) + ', ' + fTime.format(ms); }
function fmtLogTime(ms) { return (isoDay(ms) === isoDay(Date.now()) ? '' : fmtDate(ms) + ', ') + fTimeS.format(ms); }
function fmtMs(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return int(ms) + '\u00A0' + t('u_ms');
  if (ms < 60000) return nf2.format(ms / 1000) + '\u00A0' + t('u_s');
  return Math.floor(ms / 60000) + ':' + String(Math.round(ms / 1000) % 60).padStart(2, '0');
}
function ago(ms, now) {
  var d = (now || Date.now()) - ms, a = Math.abs(d), fut = d < 0;
  if (a < 45000) return t('just_now');
  var m = Math.max(1, Math.floor(a / 60000));
  if (m < 60) return t(fut ? 'in_min' : 'ago_min', { n: m });
  var hh = Math.floor(a / 3600000);
  if (hh < 24) return t(fut ? 'in_h' : 'ago_h', { n: hh });
  var dd = Math.floor(a / 86400000);
  if (dd < 30) return t(fut ? 'in_d' : 'ago_d', { n: dd });
  return fmtDate(ms);
}
function timeEl(ms, o) {
  if (ms == null) return h('span', { class: 'dim' }, (o && o.none) || '—');
  return h('time', { datetime: new Date(ms).toISOString(), title: fFull.format(ms), 'data-ts': ms, 'data-rel': o && o.abs ? null : '' }, o && o.abs ? o.abs(ms) : ago(ms));
}
setInterval(function () {
  var els = doc.querySelectorAll('time[data-rel]'), now = Date.now();
  for (var i = 0; i < els.length; i++) els[i].textContent = ago(+els[i].getAttribute('data-ts'), now);
}, 30000);

/* ───────────────────────── DOM helpers ───────────────────────── */
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function append(el, kids) {
  for (var i = 0; i < kids.length; i++) {
    var k = kids[i];
    if (k == null || k === false) continue;
    if (Array.isArray(k)) append(el, k);
    else el.appendChild(k.nodeType ? k : doc.createTextNode(String(k)));
  }
}
function h(tag, attrs) {
  var el = doc.createElement(tag), start = 2;
  if (attrs && (typeof attrs !== 'object' || attrs.nodeType || Array.isArray(attrs))) { start = 1; attrs = null; }
  if (attrs) for (var k in attrs) {
    var v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') { for (var s in v) el.style.setProperty(s, v[s]); }
    else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, Array.prototype.slice.call(arguments, start));
  return el;
}
var SVGNS = 'http://www.w3.org/2000/svg';
function s(tag, attrs) {
  var el = doc.createElementNS(SVGNS, tag);
  if (attrs) for (var k in attrs) if (attrs[k] != null) el.setAttribute(k, attrs[k]);
  for (var i = 2; i < arguments.length; i++) if (arguments[i]) el.appendChild(arguments[i]);
  return el;
}
function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
function frag() { var f = doc.createDocumentFragment(); append(f, Array.prototype.slice.call(arguments)); return f; }
function sk(w, hgt, cls) { return h('span', { class: 'sk ' + (cls || ''), style: { width: w || '100%', height: hgt || '14px' } }); }
function rich(str) { // `code` spans → <code>, **bold** → <strong>; everything else is text
  var out = h('span', { class: 'rich' }), parts = String(str == null ? '' : str).split('`');
  for (var i = 0; i < parts.length; i++) {
    if (!parts[i]) continue;
    if (i % 2) { out.appendChild(h('code', null, parts[i])); continue; }
    var bits = parts[i].split('**');
    for (var j = 0; j < bits.length; j++) if (bits[j]) out.appendChild(j % 2 ? h('strong', null, bits[j]) : doc.createTextNode(bits[j]));
  }
  return out;
}
function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
function uid(p) { return (p || 'id') + '-' + Math.random().toString(36).slice(2, 8); }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
var reduceMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

/* ───────────────────────── icons (static trusted markup) ───────────────────────── */
var ICONS = {
  copy: '<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 8.5-8.5M16 7l3 3M14 9l2 2"/>',
  overview: '<rect x="3.5" y="3.5" width="7" height="8" rx="2"/><rect x="13.5" y="3.5" width="7" height="5" rx="2"/><rect x="13.5" y="11.5" width="7" height="9" rx="2"/><rect x="3.5" y="14.5" width="7" height="6" rx="2"/>',
  connect: '<path d="M9 3v4M15 3v4M6.5 7h11v3.5a5.5 5.5 0 0 1-11 0V7zM12 16v5"/>',
  models: '<rect x="6" y="6" width="12" height="12" rx="2.5"/><rect x="10" y="10" width="4" height="4" rx="1"/><path d="M9 2.5V6M15 2.5V6M9 18v3.5M15 18v3.5M2.5 9H6M2.5 15H6M18 9h3.5M18 15h3.5"/>',
  logs: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
  play: '<path d="m7 4.5 12 7.5-12 7.5z"/>',
  docs: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5v-15z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3"/>',
  arrowr: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  arrowl: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12.5A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5L18 7M9 7V4.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V7"/>',
  roll: '<path d="M20 11a8 8 0 0 0-14.3-4.5L4 8.5M4 4v4.5h4.5M4 13a8 8 0 0 0 14.3 4.5l1.7-2M20 20v-4.5h-4.5"/>',
  pencil: '<path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3zM14.5 7.5l3 3"/>',
  shield: '<path d="M12 3 4.5 6v5.5c0 4.5 3 8 7.5 9.5 4.5-1.5 7.5-5 7.5-9.5V6L12 3z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  bolt: '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6L13 3z"/>',
  chat: '<path d="M20 12a7.5 7.5 0 0 1-10.8 6.7L4 20l1.4-4.6A7.5 7.5 0 1 1 20 12z"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  alert: '<path d="M12 4 2.8 19.5h18.4L12 4zM12 10v4.5M12 17.2h.01"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  terminal: '<rect x="3" y="4.5" width="18" height="15" rx="3"/><path d="m7.5 10 3 2.5-3 2.5M13 15h3.5"/>',
  sparkle: '<path d="M12 3.5 14 10l6.5 2-6.5 2L12 20.5 10 14l-6.5-2L10 10z"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  chevd: '<path d="m6 9 6 6 6-6"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2.5"/>',
  send: '<path d="M20.5 3.5 10 14M20.5 3.5 14 20.5l-4-6.5-6.5-4 17-6.5z"/>',
  pulse: '<path d="M3 12h4l2.5-7 4 14 2.5-7H21"/>',
  code: '<path d="m8 8-4.5 4L8 16M16 8l4.5 4-4.5 4M13.5 5l-3 14"/>',
  file: '<path d="M6.5 3h7L19 8.5V19a2 2 0 0 1-2 2H6.5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M13.5 3v5.5H19"/>',
  asterisk: '<path d="M12 3.5v17M4.6 7.8l14.8 8.4M4.6 16.2l14.8-8.4"/>',
  cursor: '<path d="M5 3.5 19.5 10.5l-6.2 2.1L10.8 19 5 3.5z"/>',
  aider: '<path d="M3.5 18 8.5 6l5 12M5.3 14h6.4M18 8.5V18M18 4.8v.01"/>',
  braces: '<path d="M8.5 4C6 4 6 5.5 6 7.5S6 10.5 4 12c2 1.5 2 2.5 2 4.5S6 20 8.5 20M15.5 4C18 4 18 5.5 18 7.5s0 3 2 4.5c-2 1.5-2 2.5-2 4.5s0 3.5-2.5 3.5"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6"/>',
  cube: '<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3zM4 7.5l8 4.5 8-4.5M12 12v9"/>',
  user: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c.8-4 3.8-6 7.5-6s6.7 2 7.5 6"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.4 3.4 5.4 3.4 8.5s-1 6.1-3.4 8.5c-2.4-2.4-3.4-5.4-3.4-8.5s1-6.1 3.4-8.5z"/>',
  list: '<path d="M8 6.5h12M8 12h12M8 17.5h12"/><circle cx="4.2" cy="6.5" r="1"/><circle cx="4.2" cy="12" r="1"/><circle cx="4.2" cy="17.5" r="1"/>'
};
function ic(name, cls) {
  var sp = doc.createElement('span');
  sp.className = 'ic' + (cls ? ' ' + cls : '');
  sp.setAttribute('aria-hidden', 'true');
  sp.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" focusable="false">' + (ICONS[name] || '') + '</svg>';
  return sp;
}
var TOOL_GLYPH = { 'claude-code': 'asterisk', codex: 'code', cursor: 'cursor', cline: 'sparkle', opencode: 'terminal', aider: 'aider', sdk: 'braces', other: 'grid' };
function toolTile(id, cls) { return h('span', { class: 'ttile ' + (cls || ''), 'aria-hidden': 'true' }, ic(TOOL_GLYPH[id] || 'braces')); }

/* ───────────────────────── announcements, toasts ───────────────────────── */
var srLive = h('div', { class: 'sr', role: 'status', 'aria-live': 'polite' });
function announce(msg) { srLive.textContent = ''; setTimeout(function () { srLive.textContent = msg; }, 30); }
var toastsEl;
function toast(msg, tone, ms) {
  if (!toastsEl) return;
  var el = h('div', { class: 'toast ' + (tone || ''), role: tone === 'bad' ? 'alert' : null },
    ic(tone === 'bad' ? 'alert' : tone === 'ok' ? 'check' : 'info'), h('span', { class: 'toast-t' }, msg));
  toastsEl.appendChild(el);
  requestAnimationFrame(function () { el.classList.add('in'); });
  var kill = function () { el.classList.remove('in'); setTimeout(function () { el.remove(); }, 220); };
  setTimeout(kill, ms || (tone === 'bad' ? 6500 : 3800));
  el.addEventListener('click', kill);
  while (toastsEl.children.length > 4) toastsEl.firstChild.remove();
}

/* ───────────────────────── clipboard ───────────────────────── */
function legacyCopy(text) {
  var ta = h('textarea', { readonly: '', class: 'sr', 'aria-hidden': 'true', tabindex: '-1' });
  ta.value = text; doc.body.appendChild(ta); ta.select();
  var ok = false; try { ok = doc.execCommand('copy'); } catch (e) {}
  ta.remove(); return ok;
}
function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacyCopy(text); });
  }
  return Promise.resolve(legacyCopy(text));
}
function copyBtn(getText, o) {
  o = o || {};
  var lab = o.iconOnly ? null : h('span', { class: 'cb-l' }, t('copy'));
  var b = h('button', { type: 'button', class: 'btn copy-btn ' + (o.cls || ''), 'aria-label': o.aria || t('copy'), title: o.aria || t('copy') },
    h('span', { class: 'cb-i' }, ic('copy', 'i-copy'), ic('check', 'i-check')), lab);
  var timer;
  b.addEventListener('click', function () {
    copyText(typeof getText === 'function' ? getText() : getText).then(function (ok) {
      if (!ok) { toast(t('copy_fail'), 'bad'); return; }
      b.classList.add('done'); if (lab) lab.textContent = t('copied'); announce(t('copied'));
      clearTimeout(timer);
      timer = setTimeout(function () { b.classList.remove('done'); if (lab) lab.textContent = t('copy'); }, 1700);
    });
  });
  return b;
}

/* ───────────────────────── API ───────────────────────── */
var skew = 0; // server clock minus client clock (from the Date header)
function toLogin() { location.assign('/login'); return new Promise(function () {}); }
function api(path, o) {
  o = o || {};
  var method = o.method || 'GET', init = { method: method, credentials: 'same-origin', headers: { Accept: 'application/json' }, signal: o.signal, cache: 'no-store' };
  if (method !== 'GET') {
    init.headers['Content-Type'] = 'application/json';
    if (o.body !== undefined) init.body = JSON.stringify(o.body);
    else if (method === 'POST') init.body = '{}';
  }
  return fetch(path, init).then(function (res) {
    if (res.status === 401) return toLogin();
    var d = res.headers.get('Date');
    if (d) { var sv = Date.parse(d); if (sv) skew = sv - Date.now(); }
    return res.text().then(function (txt) {
      var data = null; try { data = txt ? JSON.parse(txt) : null; } catch (e) {}
      if (!res.ok) {
        var err = new Error(data && typeof data.error === 'string' && data.error ? data.error : t('err_generic'));
        err.status = res.status; err.data = data; throw err;
      }
      return data;
    });
  }, function (e) {
    if (e && e.name === 'AbortError') throw e;
    var err = new Error(t('err_network')); err.network = true; throw err;
  });
}

/* ───────────────────────── dialogs ───────────────────────── */
var dlgStack = [], dlgRoot, appRoot;
var FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
function focusables(el) {
  return Array.prototype.filter.call(el.querySelectorAll(FOCUSABLE), function (n) { return n.getClientRects().length > 0; });
}
function openDialog(o) {
  var prev = doc.activeElement, titleId = uid('dt'), descId = uid('dd'), closing = false;
  var closeBtn = o.noClose ? null : h('button', { type: 'button', class: 'dlg-x', 'aria-label': t('close') }, ic('x'));
  var box = h('div', { class: 'dlg dlg-' + (o.size || 'md') + (o.tone ? ' tone-' + o.tone : ''), role: o.alert ? 'alertdialog' : 'dialog', 'aria-modal': 'true', 'aria-labelledby': o.title ? titleId : null, 'aria-describedby': o.desc ? descId : null, tabindex: '-1' },
    closeBtn,
    o.icon ? h('div', { class: 'dlg-ico' }, ic(o.icon)) : null,
    o.title ? h('h2', { class: 'dlg-t', id: titleId, tabindex: o.focusTitle ? '-1' : null, 'data-autofocus': o.focusTitle ? '' : null }, o.title) : null,
    o.desc ? h('p', { class: 'dlg-d', id: descId }, o.desc) : null,
    o.body ? h('div', { class: 'dlg-b' }, o.body) : null,
    o.footer ? h('div', { class: 'dlg-f' }, o.footer) : null);
  var ov = h('div', { class: 'dlg-ov' }, box);
  var api_ = {
    el: box, body: box.querySelector('.dlg-b'),
    close: function (result) {
      if (closing) return; closing = true;
      var i = dlgStack.indexOf(api_); if (i >= 0) dlgStack.splice(i, 1);
      ov.classList.remove('in');
      var fin = function () {
        ov.remove();
        if (!dlgStack.length) { appRoot.removeAttribute('inert'); appRoot.removeAttribute('aria-hidden'); doc.body.classList.remove('dlg-open'); }
        if (prev && doc.contains(prev) && !dlgStack.length) { try { prev.focus({ preventScroll: true }); } catch (e) {} }
        if (o.onClose) o.onClose(result);
      };
      if (reduceMotion.matches) fin(); else setTimeout(fin, 180);
    }
  };
  ov.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !o.noEsc) { e.stopPropagation(); api_.close('esc'); }
    else if (e.key === 'Tab') {
      var f = focusables(box); if (!f.length) { e.preventDefault(); box.focus(); return; }
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (doc.activeElement === first || doc.activeElement === box)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  ov.addEventListener('mousedown', function (e) { if (e.target === ov && o.backdrop) api_.close('backdrop'); });
  if (closeBtn) closeBtn.addEventListener('click', function () { api_.close('x'); });
  dlgStack.forEach(function (d) { d.el.parentNode.setAttribute('aria-hidden', 'true'); });
  dlgRoot.appendChild(ov); dlgStack.push(api_);
  appRoot.setAttribute('inert', ''); appRoot.setAttribute('aria-hidden', 'true'); doc.body.classList.add('dlg-open');
  requestAnimationFrame(function () {
    ov.classList.add('in');
    var af = box.querySelector('[data-autofocus]') || focusables(box.querySelector('.dlg-b') || box)[0] || focusables(box)[0] || box;
    try { af.focus({ preventScroll: true }); } catch (e) {}
  });
  return api_;
}
function confirmDialog(o) {
  return new Promise(function (resolve) {
    var done = false, d;
    var ok = h('button', { type: 'button', class: 'btn ' + (o.danger ? 'danger-solid' : 'pri'), 'data-autofocus': '' }, o.ok);
    var cancel = h('button', { type: 'button', class: 'btn' }, t('cancel'));
    ok.addEventListener('click', function () { done = true; d.close('ok'); resolve(true); });
    cancel.addEventListener('click', function () { d.close('cancel'); });
    d = openDialog({ title: o.title, desc: o.desc, icon: o.icon || (o.danger ? 'alert' : 'info'), tone: o.danger ? 'danger' : '', size: 'sm', alert: true, backdrop: true, footer: [cancel, ok], onClose: function () { if (!done) resolve(false); } });
  });
}

/* ───────────────────────── syntax highlighting ───────────────────────── */
var STR_DQ = '"(?:[^"\\\\\\n]|\\\\.)*"', STR_SQ = "'(?:[^'\\\\\\n]|\\\\.)*'";
function R(src, flags) { return new RegExp(src, 'y' + (flags || '')); }
var HL = {
  json: [['c', R('\\/\\/.*')], ['k', R(STR_DQ + '(?=\\s*:)')], ['s', R(STR_DQ)], ['n', R('-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?')], ['kw', R('\\b(?:true|false|null)\\b')], ['p', R('[{}\\[\\],:]')]],
  toml: [['c', R('#.*')], ['h', R('(?<=^[ \\t]*)\\[\\[?[^\\]\\n]+\\]\\]?', 'm')], ['k', R('(?<=^[ \\t]*)(?:[A-Za-z0-9_.-]+|"[^"\\n]*")(?=[ \\t]*=)', 'm')], ['s', R(STR_DQ)], ['s', R(STR_SQ)], ['n', R('-?\\d+(?:\\.\\d+)?\\b')], ['kw', R('\\b(?:true|false)\\b')], ['p', R('[=\\[\\]{},]')]],
  bash: [['c', R('(?<!\\S)#.*')], ['s', R('"(?:[^"\\\\]|\\\\[\\s\\S])*"')], ['s', R("'[^']*'")], ['v', R('\\$(?:\\{[^}\\n]+\\}|[A-Za-z_][A-Za-z0-9_]*)')], ['k', R('(?<=(?:^|[;&|]\\s*)(?:export\\s+)?)[A-Za-z_][A-Za-z0-9_]*(?==)', 'm')], ['kw', R('\\b(?:export|set|unset|source|cd|echo|if|then|fi|do|done|for|in|while)\\b')], ['f', R('(?<=(?:^|[|;&(]\\s*))[A-Za-z_./~][\\w./~-]*', 'm')], ['o', R('(?<!\\S)--?[A-Za-z][\\w-]*')], ['p', R('\\\\$|[|&;<>()=]+', 'm')]],
  powershell: [['c', R('(?<!\\S)#.*')], ['s', R('"(?:[^"`]|`[\\s\\S])*"')], ['s', R("'(?:[^']|'')*'")], ['v', R('\\$(?:\\{[^}\\n]+\\}|[A-Za-z_][\\w:]*)')], ['kw', R('\\b(?:if|else|elseif|foreach|function|return|param|try|catch|throw)\\b')], ['f', R('\\b(?:[A-Z][a-z]+-[A-Z][A-Za-z]+|irm|iex|curl|setx|npm|npx|claude|codex)\\b')], ['o', R('(?<!\\S)-[A-Za-z]\\w*')], ['p', R('[|&;={}()]+')]],
  python: [['c', R('#.*')], ['s', R('[rbfRBF]{0,2}(?:"""[\\s\\S]*?"""|\'\'\'[\\s\\S]*?\'\'\')')], ['s', R('[rbfRBF]{0,2}' + STR_DQ)], ['s', R('[rbfRBF]{0,2}' + STR_SQ)], ['kw', R('\\b(?:import|from|as|def|class|return|if|else|elif|for|in|while|with|try|except|finally|raise|lambda|None|True|False|and|or|not|async|await|yield|pass)\\b')], ['n', R('\\b\\d+(?:\\.\\d+)?\\b')], ['d', R('@\\w+')], ['f', R('\\b[A-Za-z_]\\w*(?=\\()')], ['k', R('\\b[A-Za-z_]\\w*(?==)')], ['p', R('[()\\[\\]{},.:=]+')]],
  js: [['c', R('\\/\\/.*|\\/\\*[\\s\\S]*?\\*\\/')], ['s', R('`(?:[^`\\\\]|\\\\[\\s\\S])*`')], ['s', R(STR_DQ)], ['s', R(STR_SQ)], ['kw', R('\\b(?:import|from|export|const|let|var|function|return|if|else|for|of|in|while|await|async|new|class|try|catch|throw|typeof|null|undefined|true|false)\\b')], ['n', R('\\b\\d+(?:\\.\\d+)?\\b')], ['f', R('\\b[A-Za-z_$][\\w$]*(?=\\()')], ['k', R('\\b[A-Za-z_$][\\w$]*(?=\\s*:)')], ['p', R('[(){}\\[\\],.:;=]+')]]
};
var HL_ALIAS = { sh: 'bash', shell: 'bash', zsh: 'bash', ps: 'powershell', ps1: 'powershell', pwsh: 'powershell', javascript: 'js', node: 'js', ts: 'js', py: 'python' };
function langKey(l) { l = String(l || 'text').toLowerCase(); return HL_ALIAS[l] || l; }
function tokenize(lang, code) {
  var rules = HL[langKey(lang)];
  if (!rules) return [['', code]];
  var out = [], plain = '', i = 0, n = code.length, wordRe = /[A-Za-z0-9_]+/y;
  while (i < n) {
    var hit = null;
    for (var r = 0; r < rules.length; r++) {
      var re = rules[r][1]; re.lastIndex = i;
      var m = re.exec(code);
      if (m && m[0].length) { hit = [rules[r][0], m[0]]; break; }
    }
    if (hit) { if (plain) { out.push(['', plain]); plain = ''; } out.push(hit); i += hit[1].length; }
    else { wordRe.lastIndex = i; var w = wordRe.exec(code); var step = w ? w[0].length : 1; plain += code.substr(i, step); i += step; }
  }
  if (plain) out.push(['', plain]);
  return out;
}
var LANG_LABEL = { bash: 'Terminal', powershell: 'PowerShell', json: 'JSON', toml: 'TOML', python: 'Python', js: 'JavaScript', text: '' };

/* key context: raw key shown in snippets when known */
function keyNode(raw) {
  return raw ? h('span', { class: 'tk-key' }, raw) : h('span', { class: 'keychip', title: t('key_hint_replace') }, t('your_key'));
}
function withKey(str, raw) { return String(str == null ? '' : str).split(PLACEHOLDER).join(raw || t('your_key')); }

function codeBlock(o) {
  var raw = o.raw || '', src = String(o.code == null ? '' : o.code);
  var copyStr = withKey(src, raw);
  var lk = langKey(o.lang), label = o.file || LANG_LABEL[lk] || (o.lang && o.lang !== 'text' ? String(o.lang) : '');
  var codeEl = h('code', { class: 'lang-' + lk });
  tokenize(lk, src.split(PLACEHOLDER).join(SENT)).forEach(function (tk) {
    var pieces = tk[1].split(SENT), wrap = tk[0] ? h('span', { class: 'tk-' + tk[0] }) : codeEl;
    pieces.forEach(function (p, i) {
      if (i) wrap.appendChild(keyNode(raw));
      if (p) wrap.appendChild(doc.createTextNode(p));
    });
    if (tk[0]) codeEl.appendChild(wrap);
  });
  return h('figure', { class: 'code' + (o.wrap ? ' wrap' : '') + (o.compact ? ' compact' : '') },
    h('figcaption', { class: 'code-h' },
      h('span', { class: 'code-file' }, o.file ? ic('file') : ic(lk === 'bash' || lk === 'powershell' ? 'terminal' : 'code'), h('span', { class: 'code-name', title: label }, label || ' ')),
      copyBtn(copyStr, { cls: 'sm ghost-x', aria: t('copy') + ': ' + (label || 'code') })),
    h('pre', { class: 'code-pre', tabindex: '0' }, codeEl));
}

/* ───────────────────────── tabs / segmented ───────────────────────── */
function tabs(items, o) {
  o = o || {};
  var id = uid('tb'), active = o.active || items[0].id, tabEls = {}, panels = {};
  var list = h('div', { class: 'tabs ' + (o.cls || ''), role: 'tablist', 'aria-label': o.label || null });
  var wrap = h('div', { class: 'tabs-wrap' }, list);
  items.forEach(function (it) {
    var b = h('button', { type: 'button', class: 'tab', role: 'tab', id: id + '-t-' + it.id, 'aria-controls': id + '-p-' + it.id, tabindex: '-1' }, it.label);
    b.addEventListener('click', function () { select(it.id, true); });
    tabEls[it.id] = b; list.appendChild(b);
    panels[it.id] = h('div', { class: 'tab-panel', role: 'tabpanel', id: id + '-p-' + it.id, 'aria-labelledby': id + '-t-' + it.id, hidden: '' });
    wrap.appendChild(panels[it.id]);
  });
  list.addEventListener('keydown', function (e) {
    var ids = items.map(function (x) { return x.id; }), i = ids.indexOf(active), n = i;
    if (e.key === 'ArrowRight') n = (i + 1) % ids.length; else if (e.key === 'ArrowLeft') n = (i - 1 + ids.length) % ids.length;
    else if (e.key === 'Home') n = 0; else if (e.key === 'End') n = ids.length - 1; else return;
    e.preventDefault(); select(ids[n], true); tabEls[ids[n]].focus();
  });
  function select(sid, user) {
    active = sid;
    items.forEach(function (it) {
      var on = it.id === sid;
      tabEls[it.id].setAttribute('aria-selected', on ? 'true' : 'false'); tabEls[it.id].tabIndex = on ? 0 : -1;
      tabEls[it.id].classList.toggle('on', on);
      if (on) { if (!panels[it.id].firstChild) panels[it.id].appendChild(it.render()); panels[it.id].removeAttribute('hidden'); } else panels[it.id].setAttribute('hidden', '');
    });
    if (user && o.onChange) o.onChange(sid);
  }
  select(active);
  wrap.select = select;
  return wrap;
}
function segmented(items, value, onChange, label) {
  var el = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label || null }), btns = {};
  items.forEach(function (it) {
    var b = h('button', { type: 'button', class: 'seg-b', role: 'radio', 'aria-checked': 'false' }, it.label);
    b.addEventListener('click', function () { set(it.id); onChange(it.id); });
    btns[it.id] = b; el.appendChild(b);
  });
  function set(v) { items.forEach(function (it) { var on = it.id === v; btns[it.id].setAttribute('aria-checked', on ? 'true' : 'false'); btns[it.id].classList.toggle('on', on); btns[it.id].tabIndex = on ? 0 : -1; }); }
  el.addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    var ids = items.map(function (x) { return x.id; }), cur = ids.filter(function (id) { return btns[id].classList.contains('on'); })[0], i = ids.indexOf(cur);
    var n = ids[(i + (e.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length]; e.preventDefault(); set(n); btns[n].focus(); onChange(n);
  });
  set(value);
  return el;
}

/* ───────────────────────── generic UI pieces ───────────────────────── */
function chip(text, tone, iconName, title) { return h('span', { class: 'chip' + (tone ? ' ' + tone : ''), title: title || null }, iconName ? ic(iconName) : null, h('span', null, text)); }
function emptyState(icon, title, desc, action) {
  return h('div', { class: 'empty' }, h('div', { class: 'empty-i' }, ic(icon)), h('h3', null, title), desc ? h('p', null, desc) : null, action || null);
}
function errorState(err, retry) {
  var msg = err && err.message ? err.message : t('err_generic');
  return h('div', { class: 'empty err', role: 'alert' }, h('div', { class: 'empty-i' }, ic('alert')), h('h3', null, t('err_load')), h('p', null, msg),
    retry ? h('button', { type: 'button', class: 'btn', onclick: retry }, ic('roll'), t('retry')) : null);
}
function pageHead(title, desc, actions) {
  return h('header', { class: 'phead' }, h('div', { class: 'phead-t' }, h('h1', { id: 'page-h1', tabindex: '-1' }, title), desc ? h('p', null, desc) : null), actions ? h('div', { class: 'phead-a' }, actions) : null);
}
function btn(label, o) {
  o = o || {};
  var b = h('button', { type: o.type || 'button', class: 'btn' + (o.cls ? ' ' + o.cls : ''), 'aria-label': o.aria || null, title: o.title || null }, o.icon ? ic(o.icon) : null, label != null ? h('span', { class: 'bl' }, label) : null);
  if (o.onclick) b.addEventListener('click', o.onclick);
  return b;
}
function link(label, href, o) {
  o = o || {};
  return h('a', { class: 'btn' + (o.cls ? ' ' + o.cls : ''), href: href, 'aria-label': o.aria || null }, o.icon ? ic(o.icon) : null, h('span', { class: 'bl' }, label), o.iconAfter ? ic(o.iconAfter) : null);
}

/* ───────────────────────── store ───────────────────────── */
var S = { state: null, stateAt: 0, usage: null, usageAt: 0, raw: {}, lastRaw: null };
function loadState() {
  return api('/api/dev/state').then(function (d) {
    d = d || {};
    d.keys = d.keys || []; d.models = d.models || []; d.plan = d.plan || {}; d.usage = d.usage || { used: 0, limit: null, resets_at: null }; d.limits = d.limits || {}; d.user = d.user || {};
    d.base_url = String(d.base_url || location.origin).replace(/\/+$/, '');
    S.state = d; S.stateAt = Date.now(); chromeUpdate();
    return d;
  });
}
function rawFor(keyId) { return keyId ? S.raw[keyId] || null : null; }
function rememberRaw(item, raw) { if (item && raw) { S.raw[item.id] = raw; S.lastRaw = raw; } }
function availModels() { return (S.state ? S.state.models : []).filter(function (m) { return m.available; }); }
function modelById(id) { var ms = S.state ? S.state.models : []; for (var i = 0; i < ms.length; i++) if (ms[i].id === id) return ms[i]; return null; }
function cheapest(list) { return list.reduce(function (b, m) { return !b || m.weight < b.weight ? m : b; }, null); }
function defaultModel(list) { return list.filter(function (m) { return m.def; })[0] || list[0] || null; }
function keyById(id) { var ks = S.state ? S.state.keys : []; for (var i = 0; i < ks.length; i++) if (ks[i].id === id) return ks[i]; return null; }

/* Loads state (cached 20s) and renders; shows a skeleton / error with retry meanwhile. */
function needState(host, skel, render, force) {
  var token = {}; host._tok = token;
  function go(f) {
    if (!f && S.state && Date.now() - S.stateAt < 20000) { render(S.state); return; }
    clear(host).appendChild(skel());
    loadState().then(function (st) {
      if (host._tok !== token || !host.isConnected) return;
      clear(host); render(st);
    }, function (err) {
      if (host._tok !== token || !host.isConnected) return;
      clear(host).appendChild(errorState(err, function () { go(true); }));
    });
  }
  go(force);
}

/* ───────────────────────── chrome ───────────────────────── */
var NAV = [['overview', 'overview'], ['connect', 'connect'], ['keys', 'key'], ['models', 'models'], ['logs', 'logs'], ['playground', 'play'], ['docs', 'docs']];
var navLinks = [], navKeysCount = [], sideUsage, avatarEl, langLinks = [];

function initials(u) {
  var src = (u && (u.name || u.email)) || '?', parts = String(src).trim().split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0] || '?')[0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
}
function buildChrome() {
  var top = doc.getElementById('topbar'), side = doc.getElementById('side'), tabbar = doc.getElementById('tabbar'), skip = doc.querySelector('.skip');
  if (skip) { skip.textContent = t('skip'); skip.addEventListener('click', function (e) { e.preventDefault(); doc.getElementById('main').focus(); }); }
  langLinks = ['ru', 'en'].map(function (l) {
    return h('a', { href: '?lang=' + l, hreflang: l, lang: l, 'aria-current': l === LANG ? 'true' : null, title: l === 'ru' ? 'Русский' : 'English' }, l.toUpperCase());
  });
  avatarEl = h('span', { class: 'avatar', role: 'img', 'aria-label': t('user_menu') }, '·');
  clear(top).appendChild(h('div', { class: 'tb-in' },
    h('a', { class: 'brand', href: '#overview', 'aria-label': 'Premier API' },
      h('img', { class: 'brand-mark', src: '/icon-p-amber.svg', alt: '', width: '28', height: '28' }), h('span', { class: 'brand-n' }, 'Premier'), h('span', { class: 'brand-api' }, t('brand_api'))),
    h('div', { class: 'tb-sp' }),
    h('a', { class: 'btn sm tb-chat', href: '/chat', 'aria-label': t('back_to_chat') }, ic('chat'), h('span', { class: 'bl' }, t('back_to_chat'))),
    h('div', { class: 'lang', role: 'group', 'aria-label': t('lang_label') }, langLinks),
    avatarEl));

  var mk = function (cls, withCount) {
    return NAV.map(function (n) {
      var cnt = n[0] === 'keys' && withCount ? h('span', { class: 'nav-n', hidden: '' }) : null;
      if (cnt) navKeysCount.push(cnt);
      var a = h('a', { class: cls, href: '#' + n[0], 'data-route': n[0] }, ic(n[1]), h('span', { class: 'nav-l' }, t('nav_' + n[0])), cnt);
      navLinks.push(a); return a;
    });
  };
  sideUsage = h('div', { class: 'side-usage' });
  clear(side).appendChild(h('nav', { class: 'side-nav', 'aria-label': t('nav_label') }, mk('nav-i', true)));
  side.appendChild(sideUsage);
  clear(tabbar).appendChild(h('nav', { class: 'tabs-nav', 'aria-label': t('nav_label') }, mk('tab-i', false)));
}
function setActiveNav(route) {
  navLinks.forEach(function (a) {
    var on = a.getAttribute('data-route') === route;
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    if (on && a.classList.contains('tab-i') && a.offsetParent) {
      var bar = a.parentNode; bar.scrollTo ? bar.scrollTo({ left: a.offsetLeft - 20, behavior: reduceMotion.matches ? 'auto' : 'smooth' }) : 0;
    }
  });
  langLinks.forEach(function (a) {
    var q = new URLSearchParams(location.search); q.set('lang', a.getAttribute('hreflang')); q.delete('theme');
    a.setAttribute('href', '?' + q.toString() + location.hash);
  });
}
function chromeUpdate() {
  var st = S.state; if (!st) return;
  if (avatarEl) { avatarEl.textContent = initials(st.user); avatarEl.title = [st.user.name, st.user.email].filter(Boolean).join('\n'); avatarEl.setAttribute('aria-label', t('user_menu') + ': ' + (st.user.email || st.user.name || '')); }
  navKeysCount.forEach(function (n) { n.textContent = st.keys.length; if (st.keys.length) n.removeAttribute('hidden'); else n.setAttribute('hidden', ''); });
  if (sideUsage) {
    clear(sideUsage);
    var u = st.usage, lim = u.limit;
    sideUsage.appendChild(h('div', { class: 'su-top' }, h('span', { class: 'su-k' }, t('usage_today')), planChips(st.plan, true)));
    sideUsage.appendChild(h('div', { class: 'su-n' }, h('b', null, num(u.used)), h('span', null, lim == null ? t('usage_unlimited') : t('usage_of', { limit: num(lim) }))));
    if (lim != null) sideUsage.appendChild(meterEl(u.used, lim, true));
    sideUsage.appendChild(h('div', { class: 'su-f' }, ic('chat'), h('span', null, t('usage_shared'))));
  }
}
function planChips(plan, compact) {
  var out = [];
  if (plan && plan.name) out.push(h('span', { class: 'plan' }, plan.name));
  if (plan && plan.trial) out.push(h('span', { class: 'plan trial', title: plan.until ? t('plan_until', { date: fmtDate(plan.until) }) : null }, t('plan_trial') + (!compact && plan.until ? ' · ' + t('plan_until', { date: fmtDate(plan.until) }) : '')));
  return h('span', { class: 'plans' }, out);
}
function meterEl(used, limit, thin) {
  var pct = limit ? clamp(used / limit * 100, 0, 100) : 0, tone = pct >= 100 ? 'bad' : pct >= 80 ? 'warn' : '';
  var bar = h('i', { style: { width: '0%' } });
  var m = h('div', { class: 'meter' + (thin ? ' thin' : '') + (tone ? ' ' + tone : ''), role: 'progressbar', 'aria-label': t('usage_meter'), 'aria-valuemin': '0', 'aria-valuemax': String(limit), 'aria-valuenow': String(used) }, bar);
  requestAnimationFrame(function () { requestAnimationFrame(function () { bar.style.width = pct + '%'; }); });
  return m;
}
function resetsLabel(ms) {
  if (!ms) return '';
  var now = new Date(), d = new Date(ms), tm = fTime.format(d);
  var tmr = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (isoDay(ms) === isoDay(now.getTime())) return t('usage_resets', { time: tm });
  if (isoDay(ms) === isoDay(tmr.getTime())) return t('usage_resets_tmr', { time: tm });
  return t('usage_resets', { time: fmtDateTime(ms) });
}

/* ───────────────────────── overview ───────────────────────── */
var views = {};
var QUICK = [['claude-code', 'Claude Code', 'tile_claude'], ['codex', 'Codex', 'tile_codex'], ['cursor', 'Cursor', 'tile_cursor'], ['other', null, 'tile_other']];

function ovSkeleton() {
  return h('div', { class: 'ov' }, h('div', { class: 'card hero skel-card' }, h('div', { class: 'hero-main' }, sk('30%', '12px'), sk('80%', '38px'), sk('60%', '16px'), sk('100%', '58px'), sk('100%', '58px')), h('div', { class: 'hero-side' }, sk('100%', '170px'))),
    h('div', { class: 'tiles' }, [1, 2, 3, 4].map(function () { return sk('100%', '84px', 'r'); })));
}
function burl(kind, st) {
  var url = kind === 'openai' ? st.base_url + '/v1' : st.base_url, name = t('base_' + kind);
  return h('div', { class: 'burl' },
    h('div', { class: 'burl-l' }, h('span', { class: 'burl-k' }, name), h('span', { class: 'burl-for' }, t('base_' + kind + '_for'))),
    h('div', { class: 'burl-v' }, h('code', { class: 'burl-code', tabindex: '0' }, url), copyBtn(url, { cls: 'sm', aria: t('copy_url', { name: name }) })));
}
function usageCard(st) {
  var u = st.usage, lim = u.limit, pct = lim ? Math.round(clamp(u.used / lim * 100, 0, 100)) : 0, left = lim != null ? Math.max(0, lim - u.used) : null;
  return h('div', { class: 'usage' },
    h('div', { class: 'usage-h' }, h('span', { class: 'usage-k' }, t('usage_today')), planChips(st.plan)),
    h('div', { class: 'usage-m' },
      h('div', { class: 'usage-n' }, h('b', null, num(u.used)), h('span', null, lim == null ? t('usage_unlimited') : t('usage_of', { limit: num(lim) }) + ' ' + tn('msgs', lim))),
      lim != null ? meterEl(u.used, lim) : h('div', { class: 'meter inf', 'aria-hidden': 'true' }, h('i')),
      h('div', { class: 'usage-sub' }, h('span', null, lim != null ? t('usage_left', { n: num(left) }) : tn('msgs', u.used) + ' ' + t('today')), lim != null ? h('span', null, pct + '%') : null)),
    h('ul', { class: 'usage-f' },
      h('li', null, ic('chat'), t('usage_shared')),
      u.resets_at ? h('li', null, ic('clock'), h('span', { title: fFull.format(u.resets_at) }, resetsLabel(u.resets_at))) : null));
}
function tiles() {
  return h('section', { class: 'sec', 'aria-labelledby': 'sec-tiles' },
    h('div', { class: 'sec-h' }, h('h2', { id: 'sec-tiles' }, t('ov_connect')), h('p', null, t('ov_connect_sub'))),
    h('div', { class: 'tiles' }, QUICK.map(function (q) {
      return h('a', { class: 'tile', href: q[0] === 'other' ? '#connect' : '#connect/' + q[0] },
        toolTile(q[0]), h('span', { class: 'tile-t' }, h('b', null, q[1] || (LANG === 'ru' ? 'Другое' : 'Other')), h('small', null, t(q[2]))), ic('arrowr', 'tile-go'));
    })));
}
function getStarted() {
  var steps = [['key', 'gs_1'], ['terminal', 'gs_2'], ['pulse', 'gs_3']];
  return h('section', { class: 'sec gs', 'aria-labelledby': 'sec-gs' },
    h('div', { class: 'sec-h' }, h('h2', { id: 'sec-gs' }, t('gs_title'))),
    h('ol', { class: 'gs-list' }, steps.map(function (x, i) {
      return h('li', { class: 'gs-i card' }, h('span', { class: 'gs-n' }, String(i + 1)), h('div', { class: 'gs-ic' }, ic(x[0])), h('h3', null, t(x[1] + '_t')), h('p', null, t(x[1] + '_d')));
    })),
    h('div', { class: 'gs-cta' }, link(t('gs_cta'), '#connect', { cls: 'pri lg', iconAfter: 'arrowr' }), link(t('gs_cta2'), '#keys', { cls: 'lg', icon: 'plus' })));
}
function statBox(label, value) { return h('div', { class: 'stat' }, h('span', { class: 'stat-k' }, label), h('b', { class: 'stat-v' }, value)); }
function dayDate(str) { var p = String(str).split('-'); return new Date(+p[0], +p[1] - 1, +p[2], 12); }
function niceMax(v) {
  if (v <= 0) return 4;
  if (v <= 4) return Math.max(2, Math.ceil(v / 2) * 2);
  var e = Math.pow(10, Math.floor(Math.log10(v))), f = v / e;
  return (f <= 2 ? 2 : f <= 4 ? 4 : f <= 6 ? 6 : f <= 8 ? 8 : 10) * e;
}

function barChart(days, cleanups) {
  var metric = 'requests', active = -1, W = 0, Ht = 210, geo = null, kb = false;
  var svg = s('svg', { class: 'chart-svg', 'aria-hidden': 'true' });
  var tip = h('div', { class: 'chart-tip', 'aria-hidden': 'true' });
  var live = h('div', { class: 'sr', 'aria-live': 'polite' });
  var empty = h('div', { class: 'chart-empty' }, ic('pulse'), h('span', null, t('chart_empty')));
  var host = h('div', { class: 'chart', tabindex: '0', role: 'group', 'aria-label': t('chart_aria') }, svg, tip, empty, live);
  var total = days.reduce(function (a, d) { return a + (+d.requests || 0); }, 0);
  empty.hidden = total > 0;

  function draw() {
    W = host.clientWidth; if (!W) return;
    var padL = 40, padR = 4, padT = 14, padB = 28, ph = Ht - padT - padB, n = days.length || 1;
    var vals = days.map(function (d) { return +d[metric] || 0; });
    var max = niceMax(Math.max.apply(null, vals.concat([0])));
    clear(svg); svg.setAttribute('viewBox', '0 0 ' + W + ' ' + Ht); svg.setAttribute('width', W); svg.setAttribute('height', Ht);
    [0, 0.5, 1].forEach(function (f) {
      var y = Math.round(padT + ph * (1 - f)) + 0.5;
      svg.appendChild(s('line', { x1: padL, x2: W - padR, y1: y, y2: y, class: f === 0 ? 'c-axis' : 'c-grid' }));
      var lb = s('text', { x: padL - 8, y: y + 4, class: 'c-ylab', 'text-anchor': 'end' }); lb.textContent = nfc.format(max * f); svg.appendChild(lb);
    });
    var slot = (W - padL - padR) / n, bw = clamp(slot * 0.64, 3, 24), rx = Math.min(3.5, bw / 2);
    geo = { padL: padL, slot: slot, padT: padT, ph: ph, max: max, bw: bw };
    var step = Math.max(1, Math.ceil(56 / slot));
    days.forEach(function (d, i) {
      var v = vals[i], bh = v > 0 ? Math.max(3, v / max * ph) : 0, x = padL + slot * i + (slot - bw) / 2, y = padT + ph - bh;
      var g = s('g', { class: 'bar' + (i === active ? ' on' : '') });
      if (v > 0) {
        g.appendChild(s('rect', { x: x, y: y, width: bw, height: bh, rx: rx, class: 'c-ok' }));
        var er = metric === 'requests' ? Math.min(+d.errors || 0, v) : 0;
        if (er > 0) g.appendChild(s('rect', { x: x, y: y, width: bw, height: Math.max(3, er / max * ph), rx: rx, class: 'c-err' }));
      } else g.appendChild(s('rect', { x: x, y: padT + ph - 2, width: bw, height: 2, rx: 1, class: 'c-zero' }));
      svg.appendChild(g);
      if ((n - 1 - i) % step === 0) {
        var lab = s('text', { x: x + bw / 2, y: Ht - 8, class: 'c-xlab', 'text-anchor': i === 0 ? 'start' : 'middle' }); lab.textContent = fDay.format(dayDate(d.day)); svg.appendChild(lab);
      }
    });
    if (active >= 0) showTip(active);
  }
  function showTip(i) {
    var d = days[i]; if (!d || !geo) return;
    clear(tip).appendChild(h('div', { class: 'tip-d' }, fWeekday.format(dayDate(d.day))));
    var rows = [[t('m_requests'), int(d.requests), ''], [t('m_messages'), num(d.messages), ''], [t('m_errors'), int(d.errors), +d.errors > 0 ? 'bad' : '']];
    rows.forEach(function (r) { tip.appendChild(h('div', { class: 'tip-r ' + r[2] }, h('span', null, r[0]), h('b', null, r[1]))); });
    tip.classList.add('on');
    var v = +days[i][metric] || 0, bx = geo.padL + geo.slot * i + geo.slot / 2, tw = tip.offsetWidth, th = tip.offsetHeight;
    var by = geo.padT + geo.ph * (1 - v / geo.max);
    tip.style.left = clamp(bx - tw / 2, 0, Math.max(0, W - tw)) + 'px';
    tip.style.top = Math.max(0, by - th - 10) + 'px';
    live.textContent = fWeekday.format(dayDate(d.day)) + ': ' + rows.map(function (r) { return r[0] + ' ' + r[1]; }).join(', ');
  }
  function setActive(i) {
    if (i === active) return; active = i;
    host.classList.toggle('has-active', i >= 0);
    var gs = svg.querySelectorAll('.bar'); for (var k = 0; k < gs.length; k++) gs[k].classList.toggle('on', k === i);
    if (i >= 0) showTip(i); else tip.classList.remove('on');
  }
  function idxAt(e) {
    if (!geo) return -1;
    var x = e.clientX - host.getBoundingClientRect().left, i = Math.floor((x - geo.padL) / geo.slot);
    return i >= 0 && i < days.length ? i : -1;
  }
  host.addEventListener('pointermove', function (e) { kb = false; setActive(idxAt(e)); });
  host.addEventListener('pointerdown', function (e) { setActive(idxAt(e)); });
  host.addEventListener('pointerleave', function () { if (!kb) setActive(-1); });
  host.addEventListener('focus', function () { if (active < 0 && !host.matches(':active')) { kb = true; setActive(days.length - 1); } });
  host.addEventListener('blur', function () { kb = false; setActive(-1); });
  host.addEventListener('keydown', function (e) {
    var i = active < 0 ? days.length - 1 : active;
    if (e.key === 'ArrowLeft') i = Math.max(0, i - 1); else if (e.key === 'ArrowRight') i = Math.min(days.length - 1, i + 1);
    else if (e.key === 'Home') i = 0; else if (e.key === 'End') i = days.length - 1; else return;
    e.preventDefault(); kb = true; setActive(i);
  });
  var raf = 0, ro = window.ResizeObserver ? new ResizeObserver(function () { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); }) : null;
  if (ro) { ro.observe(host); cleanups.push(function () { ro.disconnect(); }); } else window.addEventListener('resize', draw);
  requestAnimationFrame(draw);
  return { el: host, setMetric: function (m) { metric = m; active = -1; tip.classList.remove('on'); host.classList.remove('has-active'); draw(); } };
}

function hbars(items, labelOf, valueOf, fmt) {
  var max = Math.max.apply(null, items.map(valueOf).concat([1]));
  return h('ul', { class: 'hbars' }, items.slice(0, 5).map(function (it) {
    var v = valueOf(it), lab = labelOf(it);
    return h('li', { class: 'hb' }, h('div', { class: 'hb-top' }, h('span', { class: 'hb-l', title: lab }, lab), h('span', { class: 'hb-v' }, fmt(v))), h('div', { class: 'hb-bar' }, h('i', { style: { width: Math.max(2, v / max * 100) + '%' } })));
  }));
}
function statusTone(code) { return code >= 200 && code < 300 ? 'ok' : code >= 500 ? 'bad' : code >= 400 ? 'warn' : ''; }

function recentRow(l) {
  return h('li', { class: 'rr' },
    h('span', { class: 'dot ' + statusTone(l.status), title: String(l.status) }),
    h('div', { class: 'rr-m' }, h('b', { class: 'mono' }, l.model || '—'), h('span', null, (l.client || t('unknown_client')) + ' · ' + (l.key_name || '—'))),
    h('div', { class: 'rr-r' }, l.err ? h('span', { class: 'rr-err', title: l.err }, String(l.status)) : null, timeEl(l.at)));
}

views.overview = function (host) {
  var cleanups = [];
  needState(host, ovSkeleton, function (st) {
    var page = h('div', { class: 'ov' });
    page.appendChild(h('section', { class: 'card hero', 'aria-labelledby': 'page-h1' },
      h('div', { class: 'hero-grid', 'aria-hidden': 'true' }),
      h('div', { class: 'hero-main' },
        h('p', { class: 'eyebrow' }, t('ov_kicker')),
        h('h1', { id: 'page-h1', tabindex: '-1' }, h('span', { class: 'h1-a' }, t('ov_t1')), h('span', { class: 'mark' }, t('ov_t2'))),
        h('p', { class: 'lead' }, t('ov_sub')),
        h('div', { class: 'burls' }, h('div', { class: 'burls-h' }, t('base_urls')), burl('openai', st), burl('anthropic', st))),
      h('aside', { class: 'hero-side' }, usageCard(st))));
    if (!st.keys.length) { page.appendChild(getStarted()); page.appendChild(tiles()); }
    else { page.appendChild(tiles()); data(page); }
    host.appendChild(page);
  });

  function data(page) {
    var chartCard = h('section', { class: 'card pad chart-card', 'aria-labelledby': 'sec-chart' }),
        split = h('div', { class: 'split' }), recent = h('section', { class: 'card pad', 'aria-labelledby': 'sec-recent' });
    chartCard.appendChild(h('div', { class: 'sec-h' }, h('h2', { id: 'sec-chart' }, t('chart_title'))));
    chartCard.appendChild(sk('100%', '240px', 'r'));
    recent.appendChild(h('div', { class: 'sec-h' }, h('h2', { id: 'sec-recent' }, t('recent')), link(t('all_logs'), '#logs', { cls: 'sm ghost-x', iconAfter: 'arrowr' })));
    var recentBody = h('div', { class: 'recent-b' }, sk('100%', '44px'), sk('100%', '44px'), sk('100%', '44px'));
    recent.appendChild(recentBody);
    page.appendChild(chartCard); page.appendChild(split); page.appendChild(recent);

    function loadUsage() {
      var cached = S.usage && Date.now() - S.usageAt < 60000 ? Promise.resolve(S.usage) : api('/api/dev/usage?days=30').then(function (u) { S.usage = u; S.usageAt = Date.now(); return u; });
      cached.then(function (u) {
        if (!host.isConnected) return;
        var days = (u && u.days) || [], byModel = (u && u.by_model) || [], byClient = (u && u.by_client) || [];
        var sum = function (k) { return days.reduce(function (a, d) { return a + (+d[k] || 0); }, 0); };
        var head = chartCard.firstChild; clear(chartCard); chartCard.appendChild(head);
        var chart = barChart(days, cleanups);
        head.appendChild(segmented([{ id: 'requests', label: t('m_requests') }, { id: 'messages', label: t('m_messages') }], 'requests', chart.setMetric, t('chart_title')));
        chartCard.appendChild(h('div', { class: 'stats' }, statBox(t('m_requests'), int(sum('requests'))), statBox(t('m_messages'), num(sum('messages'))), statBox(t('m_errors'), int(sum('errors'))), statBox(t('m_tokens'), nfc.format(sum('in_tok') + sum('out_tok')))));
        chartCard.appendChild(chart.el);
        chartCard.appendChild(h('div', { class: 'legend' }, h('span', null, h('i', { class: 'lg-ok' }), t('chart_ok')), h('span', null, h('i', { class: 'lg-err' }), t('m_errors'))));
        clear(split);
        var card = function (title, body) { return h('section', { class: 'card pad' }, h('div', { class: 'sec-h' }, h('h2', null, title)), body); };
        split.appendChild(card(t('by_model'), byModel.length ? hbars(byModel, function (m) { return m.name || m.model; }, function (m) { return +m.requests || 0; }, function (v) { return int(v) + ' ' + tn('reqs', v); }) : h('p', { class: 'muted' }, t('no_data'))));
        split.appendChild(card(t('by_client'), byClient.length ? hbars(byClient, function (c) { return c.client || t('unknown_client'); }, function (c) { return +c.requests || 0; }, function (v) { return int(v) + ' ' + tn('reqs', v); }) : h('p', { class: 'muted' }, t('no_data'))));
      }, function (err) {
        if (!host.isConnected) return;
        var head = chartCard.firstChild; clear(chartCard); chartCard.appendChild(head); chartCard.appendChild(errorState(err, function () { S.usage = null; chartCard.replaceChildren(head, sk('100%', '240px', 'r')); loadUsage(); }));
      });
    }
    function loadRecent() {
      api('/api/dev/logs?limit=5').then(function (r) {
        if (!host.isConnected) return;
        var items = (r && r.items) || [];
        clear(recentBody).appendChild(items.length ? h('ul', { class: 'rr-list' }, items.slice(0, 5).map(recentRow)) : h('p', { class: 'muted pad-s' }, t('recent_empty')));
      }, function (err) { if (host.isConnected) clear(recentBody).appendChild(errorState(err, function () { clear(recentBody).appendChild(sk('100%', '44px')); loadRecent(); })); });
    }
    loadUsage(); loadRecent();
  }
  return { destroy: function () { host._tok = null; cleanups.forEach(function (f) { f(); }); } };
};

/* ───────────────────────── shared model bits ───────────────────────── */
function agentChip(m) {
  return m.agent === true ? chip(t('agent_yes'), 'ok', 'bolt') : m.agent === false ? chip(t('agent_no'), 'warn', 'chat') : chip(t('agent_unk'), 'muted', 'info');
}
function visionChip() { return chip(t('badge_vision'), 'info', 'eye'); }

/* ───────────────────────── connect wizard ───────────────────────── */
var STEPS = ['tool', 'model', 'key', 'setup', 'check'];
var W = null, wizClients = null, wizCache = {};
function newWizard() { return { tool: null, model: null, fast: null, keyChoice: null, keyId: null, step: 1, maxStep: 1, sig: '', t4: 0, baseLast: null, connected: null, os: /Win/i.test(navigator.userAgent) ? 'win' : 'unix' }; }
W = newWizard();
function wizardWithKey(item) { W = newWizard(); W.keyId = item.id; W.keyChoice = item.id; navigate('#connect'); }
function navigate(hash) { if (location.hash === hash) route(); else location.hash = hash; }
function keyDefaultName(toolName) {
  var d = new Date(), tag = LANG === 'ru' ? String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') : fDay.format(d);
  return (String(toolName).slice(0, 40) + ' · ' + tag).slice(0, 60);
}
function loadClientsFor(model, fast) {
  var ck = (model || '') + '|' + (fast || '');
  if (wizCache[ck]) return Promise.resolve(wizCache[ck]);
  var q = []; if (model) q.push('model=' + encodeURIComponent(model)); if (fast) q.push('fast=' + encodeURIComponent(fast));
  return api('/api/dev/clients' + (q.length ? '?' + q.join('&') : '')).then(function (r) { var list = (r && r.clients) || []; wizCache[ck] = list; return list; });
}
function radioOpt(name, value, checked, disabled, content, onChange, cls) {
  var inp = h('input', { type: 'radio', class: 'opt-in', name: name, value: value, checked: checked ? '' : null, disabled: disabled ? '' : null });
  inp.addEventListener('change', function () { if (inp.checked) onChange(value); });
  return h('label', { class: 'opt' + (disabled ? ' dis' : '') + (cls ? ' ' + cls : '') }, inp, h('span', { class: 'opt-dot', 'aria-hidden': 'true' }), h('span', { class: 'opt-c' }, content));
}

views.connect = function (host, arg) {
  var alive = true, pollTimer = null, pills = [], osGroups = [], panel, stepper, titleEl, st = null;
  var curClient = null, clientData = null, busy = false;

  function tool() { return (wizClients || []).filter(function (c) { return c.id === W.tool; })[0] || null; }
  function toolName() { var c = tool(); return c ? c.name : ''; }

  needState(host, wizSkeleton, init);

  function wizSkeleton() { return h('div', { class: 'wz' }, sk('40%', '34px'), sk('100%', '56px', 'r'), h('div', { class: 'tool-grid' }, [1, 2, 3, 4, 5, 6].map(function () { return sk('100%', '104px', 'r'); }))); }

  function init(state) {
    st = state;
    var models = availModels();
    if (!W.model || !models.some(function (m) { return m.id === W.model; })) W.model = defaultModel(models) ? defaultModel(models).id : null;
    if (W.fast && !models.some(function (m) { return m.id === W.fast; })) W.fast = null;
    clear(host).appendChild(h('div', { class: 'wz-load' }, sk('100%', '300px', 'r')));
    loadClientsFor(null, null).then(function (list) {
      if (!alive || !host.isConnected) return;
      wizClients = list;
      if (arg && (W.tool !== arg || W.connected)) {
        var found = list.filter(function (c) { return c.id === arg; })[0], keep = W.keyId, keepChoice = W.keyChoice;
        W = newWizard(); W.keyId = keep; W.keyChoice = keepChoice;
        W.model = (defaultModel(models) || {}).id || null;
        if (found) { W.tool = found.id; W.step = 2; W.maxStep = 2; }
      } else if (W.tool && !list.some(function (c) { return c.id === W.tool; })) { W = newWizard(); W.model = (defaultModel(models) || {}).id || null; }
      build();
    }, function (err) {
      if (!alive || !host.isConnected) return;
      clear(host).appendChild(errorState(new Error(err.message || t('clients_err')), function () { needState(host, wizSkeleton, init, true); }));
    });
  }

  function build() {
    clear(host);
    titleEl = h('h1', { id: 'page-h1', tabindex: '-1' }, t('wz_title'));
    stepper = h('ol', { class: 'stepper', 'aria-label': t('wz_steps') });
    panel = h('div', { class: 'wz-panel' });
    host.appendChild(h('div', { class: 'wz' }, h('header', { class: 'phead' }, h('div', { class: 'phead-t' }, titleEl, h('p', null, t('wz_sub')))), stepper, panel));
    show(W.step, 1, true);
  }

  function renderStepper() {
    clear(stepper);
    STEPS.forEach(function (key, i) {
      var n = i + 1, done = n < W.step || (n === 5 && W.connected), cur = n === W.step, reach = n <= W.maxStep && canEnter(n);
      var b = h('button', { type: 'button', class: 'step' + (cur ? ' cur' : '') + (done ? ' done' : ''), 'aria-current': cur ? 'step' : null, disabled: reach ? null : '', 'aria-label': t('wz_step_of', { n: n, m: 5 }) + ': ' + t('st_' + key) },
        h('span', { class: 'step-n' }, done ? ic('check') : String(n)), h('span', { class: 'step-l' }, t('st_' + key)));
      b.addEventListener('click', function () { if (n !== W.step) show(n, n > W.step ? 1 : -1); });
      stepper.appendChild(h('li', { class: 'step-li' + (n < W.step ? ' past' : '') }, b));
    });
  }
  function canEnter(n) { return n === 1 || (n >= 2 && !!W.tool && (n < 4 || (!!W.model && !!W.keyId))); }

  function show(n, dir, first) {
    if (n === 4 && W.keyId) { var sig = W.tool + '|' + W.keyId; if (W.sig !== sig) { W.sig = sig; W.t4 = Date.now(); var k = keyById(W.keyId); W.baseLast = k ? k.last_used || 0 : 0; W.connected = null; } }
    W.step = n; W.maxStep = Math.max(W.maxStep, n);
    pills = []; osGroups = [];
    renderStepper();
    var p = h('div', { class: 'wz-panel ' + (dir > 0 ? 'fwd' : 'back') });
    panel.replaceWith(p); panel = p;
    var render = [step1, step2, step3, step4, step5][n - 1];
    render(p);
    history.replaceState(null, '', '#connect' + (W.tool && n > 1 ? '/' + encodeURIComponent(W.tool) : ''));
    if (n >= 4) startPoll(); else stopPoll();
    if (!first) {
      var hd = p.querySelector('.wz-h h2'); if (hd) { hd.setAttribute('tabindex', '-1'); hd.focus({ preventScroll: true }); }
      var top = stepper.getBoundingClientRect().top; if (top < 0 || top > window.innerHeight * 0.5) window.scrollTo({ top: window.scrollY + top - 90, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
    }
  }
  function stepHead(title, desc) { return h('div', { class: 'wz-h' }, h('h2', null, title), desc ? h('p', null, desc) : null); }
  function foot(left, right) { return h('div', { class: 'wz-f' }, h('div', { class: 'wz-f-l' }, left), h('div', { class: 'wz-f-r' }, right)); }
  function backBtn(to) { return btn(t('back'), { icon: 'arrowl', cls: 'ghost-x', aria: t('back'), onclick: function () { show(to, -1); } }); }
  function nextBtn(label, fn, o) { var b = btn(label || t('cont'), { cls: 'pri' + (o && o.cls ? ' ' + o.cls : ''), onclick: fn }); b.appendChild(ic('arrowr')); return b; }

  /* step 1 — tool */
  function step1(p) {
    p.appendChild(stepHead(t('s1_t'), t('s1_d')));
    p.appendChild(h('div', { class: 'tool-grid' }, (wizClients || []).map(function (c) {
      var b = h('button', { type: 'button', class: 'tool-card' + (c.id === W.tool ? ' on' : '') }, toolTile(c.id),
        h('span', { class: 'tc-t' }, h('b', null, c.name), h('small', null, c.tagline || '')),
        c.quick ? h('span', { class: 'chip accent tc-q' }, ic('bolt'), h('span', null, t('badge_quick'))) : null);
      b.addEventListener('click', function () {
        if (W.tool !== c.id) { W.tool = c.id; W.fast = null; W.maxStep = 1; W.connected = null; W.sig = ''; }
        show(2, 1);
      });
      return b;
    })));
  }

  /* step 2 — model(s) */
  function step2(p) {
    var c = tool(), models = availModels();
    p.appendChild(stepHead(t('s2_t'), t('s2_d')));
    if (!models.length) { p.appendChild(emptyState('models', t('no_models'))); p.appendChild(foot(backBtn(1), null)); return; }
    var warn = h('div', { class: 'callout warn', role: 'status', hidden: '' }, ic('alert'), h('span', null, t('warn_chat_only')));
    function syncWarn() { var m = modelById(W.model); warn.hidden = !(m && m.agent === false && W.tool !== 'sdk'); }
    var list = h('div', { class: 'opts', role: 'radiogroup', 'aria-label': t('s2_t') });
    models.forEach(function (m) {
      list.appendChild(radioOpt('wz-model', m.id, m.id === W.model, false, modelOptContent(m, m.def ? t('tag_default') : null), function (v) { W.model = v; syncWarn(); }));
    });
    p.appendChild(list); p.appendChild(warn); syncWarn();
    if (c && c.fast_model) {
      // фоновые задачи Claude Code (субагент Explore и др.) тоже вызывают инструменты
      var agentOk = models.filter(function (m) { return m.agent !== false; }), cheap = cheapest(agentOk.length ? agentOk : models);
      if (!W.fast || !models.some(function (m) { return m.id === W.fast; })) W.fast = (cheap || {}).id || null;
      var fl = h('div', { class: 'opts compact', role: 'radiogroup', 'aria-label': t('s2_fast') });
      models.forEach(function (m) {
        fl.appendChild(radioOpt('wz-fast', m.id, m.id === W.fast, false, modelOptContent(m, cheap && m.id === cheap.id ? t('tag_cheapest') : null, true), function (v) { W.fast = v; }));
      });
      p.appendChild(h('div', { class: 'wz-sub' }, h('h3', null, t('s2_fast')), h('p', null, t('s2_fast_d'))));
      p.appendChild(fl);
    } else W.fast = null;
    p.appendChild(foot(backBtn(1), nextBtn(null, function () { show(3, 1); })));
  }
  function modelOptContent(m, tag, compact) {
    return h('span', { class: 'mo' },
      h('span', { class: 'mo-top' }, h('b', { class: 'mo-n' }, m.name || m.id), tag ? h('span', { class: 'chip accent' }, tag) : null),
      h('span', { class: 'mo-id mono' }, m.id),
      h('span', { class: 'mo-chips' }, chip(tcost(m.weight), 'muted', 'bolt'), m.vision ? visionChip() : null, compact ? null : agentChip(m)));
  }

  /* step 3 — key */
  function step3(p) {
    var c = tool(), keys = S.state.keys, full = keys.length >= MAX_KEYS, justId = W.keyId && rawFor(W.keyId) ? W.keyId : null;
    if (!keyById(W.keyChoice) && W.keyChoice !== 'new') W.keyChoice = null;
    if (!W.keyChoice) W.keyChoice = full ? (keys[0] ? keys[0].id : null) : 'new';
    p.appendChild(stepHead(t('s3_t'), t('s3_d')));
    var defName = keyDefaultName(c ? c.name : '');
    var note = h('div', { class: 'callout info', role: 'status', hidden: '' }, ic('info'), h('span', null, t('key_note_hidden')));
    function syncNote() { note.hidden = !(W.keyChoice && W.keyChoice !== 'new' && !rawFor(W.keyChoice)); }
    var group = h('div', { class: 'opts', role: 'radiogroup', 'aria-label': t('s3_t') });
    var pick = function (v) { W.keyChoice = v; syncNote(); };
    group.appendChild(radioOpt('wz-key', 'new', W.keyChoice === 'new', full, h('span', { class: 'mo' },
      h('span', { class: 'mo-top' }, h('b', { class: 'mo-n' }, t('key_new_for', { tool: c ? c.name : '' })), chip('+', 'accent', 'plus')),
      h('span', { class: 'mo-d' }, full ? t('key_limit') : t('key_new_hint', { name: defName }))), pick, 'opt-new'));
    if (keys.length) {
      group.appendChild(h('div', { class: 'opts-sep' }, t('key_existing')));
      keys.slice().sort(function (a, b) { return (a.id === justId ? -1 : 0) - (b.id === justId ? -1 : 0); }).forEach(function (k) {
        var known = !!rawFor(k.id);
        group.appendChild(radioOpt('wz-key', k.id, W.keyChoice === k.id, isExpired(k), h('span', { class: 'mo' },
          h('span', { class: 'mo-top' }, h('b', { class: 'mo-n' }, k.name), k.id === justId ? chip(t('key_just'), 'ok', 'check') : null, isExpired(k) ? chip(t('exp_expired'), 'bad') : null),
          h('span', { class: 'mo-id mono' }, k.hint),
          h('span', { class: 'mo-chips' }, chip(k.last_used ? ago(k.last_used) : t('never_used'), 'muted', 'clock'), known ? chip(t('key_raw_known'), 'ok', 'lock') : chip(t('key_raw_hidden'), 'muted', 'lock'))), pick));
      });
    }
    p.appendChild(group); p.appendChild(note); syncNote();
    var go = nextBtn(null, function () {
      if (busy || !W.keyChoice) return;
      if (W.keyChoice !== 'new') { W.keyId = W.keyChoice; show(4, 1); return; }
      busy = true; go.disabled = true; go.classList.add('loading'); go.querySelector('.bl').textContent = t('creating_key');
      api('/api/dev/keys', { method: 'POST', body: { name: defName } }).then(function (r) {
        rememberRaw(r.item, r.key); W.keyId = r.item.id; W.keyChoice = r.item.id;
        toast(t('key_created_for', { name: r.item.name }), 'ok');
        return loadState().catch(function () {}).then(function () { busy = false; if (alive) show(4, 1); });
      }, function (err) {
        busy = false; go.disabled = false; go.classList.remove('loading'); go.querySelector('.bl').textContent = t('cont');
        toast(err.message, 'bad');
        if (err.status === 409) loadState().then(function (s) { st = s; if (alive && W.step === 3) show(3, 1); }, function () {});
      });
    });
    go.disabled = !W.keyChoice;
    p.appendChild(foot(backBtn(2), go));
  }
  function isExpired(k) { return !!k.expires && k.expires < Date.now(); }

  /* step 4 — setup */
  function step4(p) {
    p.appendChild(stepHead(t('s4_t', { tool: toolName() }), t('s4_d')));
    var body = h('div', { class: 'setup' }, sk('100%', '70px', 'r'), sk('100%', '160px', 'r'), sk('100%', '240px', 'r'));
    p.appendChild(body);
    var actions = h('div', { class: 'wz-bar' }, h('div', { class: 'wz-bar-l' }, statusPill()), h('div', { class: 'wz-bar-r' }, backBtn(3), nextBtn(t('btn_check'), function () { show(5, 1); })));
    p.appendChild(actions);
    var model = W.model, fast = tool() && tool().fast_model ? W.fast : null, step = W.step;
    loadClientsFor(model, fast).then(function (list) {
      if (!alive || W.step !== step) return;
      var c = list.filter(function (x) { return x.id === W.tool; })[0] || tool();
      clientData = c; clear(body); renderSetup(body, c);
    }, function (err) {
      if (!alive || W.step !== step) return;
      clear(body).appendChild(errorState(err, function () { show(4, 1); }));
    });
  }
  function renderSetup(body, c) {
    var raw = rawFor(W.keyId), key = keyById(W.keyId), m = modelById(W.model), fm = W.fast ? modelById(W.fast) : null;
    var chipRow = function (label, val, to) {
      return h('button', { type: 'button', class: 'sum-i', 'aria-label': t('change') + ': ' + label, onclick: function () { show(to, -1); } }, h('span', { class: 'sum-k' }, label), h('span', { class: 'sum-v' }, val), ic('pencil', 'sum-e'));
    };
    body.appendChild(h('div', { class: 'sum' },
      chipRow(t('sum_tool'), c.name, 1), chipRow(t('sum_model'), m ? m.name || m.id : W.model, 2),
      fm && c.fast_model ? chipRow(t('sum_fast'), fm.name || fm.id, 2) : null, chipRow(t('sum_key'), key ? key.name : '—', 3)));
    body.appendChild(raw
      ? h('div', { class: 'keybar' }, h('div', { class: 'keybar-l' }, ic('key'), h('div', null, h('code', { class: 'keybar-k', tabindex: '0' }, raw), h('small', null, t('key_banner_raw')))), copyBtn(raw, { cls: 'sm', aria: t('copy_key') }))
      : h('div', { class: 'callout info' }, ic('info'), h('span', null, t('key_note_hidden'))));
    var cb = function (b, wrap) { return codeBlock({ code: b.code, lang: b.lang, file: b.file, raw: raw, wrap: wrap }); };
    var q = c.quick && (c.quick.sh || c.quick.ps) ? c.quick : null;
    if (q) {
      var items = [];
      if (q.sh) items.push({ id: 'unix', label: t('os_unix'), render: function () { return cb({ code: q.sh, lang: 'bash' }, true); } });
      if (q.ps) items.push({ id: 'win', label: t('os_win'), render: function () { return cb({ code: q.ps, lang: 'powershell' }, true); } });
      var tb = tabs(items, { active: items.some(function (i) { return i.id === W.os; }) ? W.os : items[0].id, label: t('quick_t'), cls: 'os-tabs', onChange: function (id) { W.os = id; syncOS(); } });
      osGroups.push({ wrap: tb, map: { unix: 'unix', win: 'win' } });
      body.appendChild(h('section', { class: 'quick card' }, h('div', { class: 'quick-h' }, h('span', { class: 'chip accent' }, ic('sparkle'), h('span', null, t('quick_badge'))), h('h3', null, t('quick_t')), h('p', null, t('quick_d'))), tb));
    }
    var steps = c.steps || [];
    if (steps.length) {
      var ol = h('ol', { class: 'msteps' });
      steps.forEach(function (sp, i) {
        var li = h('li', { class: 'mstep' }, h('span', { class: 'mstep-n', 'aria-hidden': 'true' }, String(i + 1)), h('div', { class: 'mstep-b' }, h('h4', null, sp.title), sp.text ? h('p', null, rich(sp.text)) : null));
        var bodyEl = li.lastChild, blocks = sp.blocks || [], j = 0;
        while (j < blocks.length) {
          if (blocks[j].label && blocks[j + 1] && blocks[j + 1].label) {
            var grp = []; while (j < blocks.length && blocks[j].label) grp.push(blocks[j++]);
            bodyEl.appendChild(blockTabs(grp, cb));
          } else {
            var b = blocks[j++];
            bodyEl.appendChild(h('div', { class: 'blk' }, b.label ? h('div', { class: 'blk-l' }, b.label) : null, cb(b)));
          }
        }
        ol.appendChild(li);
      });
      body.appendChild(h('details', { class: 'manual', open: q ? null : '' }, h('summary', null, h('span', null, t('manual_t')), h('span', { class: 'chip muted' }, String(steps.length)), ic('chevd', 'sum-c')), ol));
      if (q) body.querySelector('details.manual').setAttribute('open', '');
    }
  }
  function osOf(label) { return /windows|powershell|\bwin\b|cmd/i.test(label || '') ? 'win' : /mac|linux|unix|bash|shell|zsh/i.test(label || '') ? 'unix' : null; }
  function blockTabs(grp, cb) {
    var map = {}, items = grp.map(function (b, i) { var id = 'b' + i, os = osOf(b.label); if (os && !map[os]) map[os] = id; return { id: id, label: b.label, render: function () { return cb(b); } }; });
    var active = map[W.os] || items[0].id;
    var tb = tabs(items, { active: active, label: grp[0].label, cls: 'os-tabs sm', onChange: function (id) { var os = osOf(grp[+id.slice(1)].label); if (os) { W.os = os; syncOS(); } } });
    osGroups.push({ wrap: tb, map: map });
    return tb;
  }
  function syncOS() { osGroups.forEach(function (g) { if (g.map[W.os]) g.wrap.select(g.map[W.os]); }); }

  /* live status */
  function statusPill() {
    var el = h('div', { class: 'pill-live', role: 'status' });
    pills.push(el); fillPill(el); return el;
  }
  function fillPill(el) {
    clear(el); el.classList.toggle('ok', !!W.connected);
    if (W.connected) el.appendChild(frag(ic('check'), h('span', null, t('s5_ok_t', { tool: W.connected.client || toolName() }))));
    else el.appendChild(frag(h('span', { class: 'pulse', 'aria-hidden': 'true' }), h('span', null, t('waiting'))));
  }

  /* step 5 — check */
  function step5(p) {
    var box = h('div', { class: 'check' });
    p.appendChild(box); renderCheck(box);
    if (!clientData || clientData.id !== W.tool) loadClientsFor(W.model, tool() && tool().fast_model ? W.fast : null).then(function (l) { clientData = l.filter(function (x) { return x.id === W.tool; })[0] || null; if (alive && W.step === 5 && !W.connected) renderCheck(box); }, function () {});
  }
  function renderCheck(box) {
    clear(box);
    if (W.connected) {
      var cn = W.connected;
      box.appendChild(h('div', { class: 'success' },
        h('div', { class: 'success-ring' }, s('svg', { viewBox: '0 0 52 52', 'aria-hidden': 'true' }, s('circle', { cx: 26, cy: 26, r: 24, class: 'sc-c' }), s('path', { d: 'M15 27l8 8 14-16', class: 'sc-p' }))),
        h('h2', null, t('s5_ok_t', { tool: cn.client || toolName() })),
        h('p', null, t('s5_ok_d', { time: ago(cn.at) })),
        h('dl', { class: 'facts' }, h('div', null, h('dt', null, t('conn_client')), h('dd', null, cn.client || '—')), h('div', null, h('dt', null, t('conn_ip')), h('dd', { class: 'mono' }, cn.ip || '—')), h('div', null, h('dt', null, t('conn_time')), h('dd', null, h('time', { title: fFull.format(cn.at) }, fTimeS.format(cn.at))))),
        h('div', { class: 'success-a' }, link(t('btn_logs'), '#logs', { cls: 'pri', iconAfter: 'arrowr' }), btn(t('btn_another'), { icon: 'plus', onclick: function () { var keep = W.keyId; W = newWizard(); W.keyId = keep; W.keyChoice = keep; W.model = (defaultModel(availModels()) || {}).id || null; show(1, -1); } }), link(t('btn_overview'), '#overview', { cls: 'ghost-x' }))));
      return;
    }
    var c = clientData || tool(), tips = (c && c.check) || [];
    box.appendChild(h('div', { class: 'waiting' },
      h('div', { class: 'radar', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('span', null, toolTile(W.tool))),
      h('h2', null, t('s5_wait', { tool: toolName() })), h('p', null, t('s5_d', { tool: toolName() })), statusPill(),
      h('p', { class: 'keep' }, ic('clock'), t('s5_keep'))));
    if (tips.length) box.appendChild(h('div', { class: 'tips card pad' }, h('h3', null, t('s5_tips')), h('ul', null, tips.map(function (x) { return h('li', null, ic('info'), h('span', null, rich(x))); }))));
    box.appendChild(foot(backBtn(4), null));
  }

  /* polling */
  function startPoll() { if (pollTimer || W.connected) return; schedule(); }
  function schedule() { pollTimer = setTimeout(tick, 2500); }
  function stopPoll() { clearTimeout(pollTimer); pollTimer = null; }
  function tick() {
    pollTimer = null;
    if (!alive || W.connected || W.step < 4) return;
    if (doc.hidden) { schedule(); return; }
    loadState().then(function (s) { st = s; checkConn(); }, function () {}).then(function () { if (alive && !W.connected && W.step >= 4 && !pollTimer) schedule(); });
  }
  function checkConn() {
    var k = keyById(W.keyId);
    if (!k || !k.last_used || W.connected) return;
    if (k.last_used > (W.baseLast || 0) && k.last_used >= W.t4 + skew - 2000) {
      W.connected = { client: k.last_client, ip: k.last_ip, at: k.last_used };
      pills.forEach(fillPill); renderStepper();
      toast(t('toast_connected', { tool: k.last_client || toolName() }), 'ok'); announce(t('s5_ok_t', { tool: k.last_client || toolName() }));
      if (W.step === 4 && !doc.hidden) setTimeout(function () { if (alive && W.step === 4) show(5, 1); }, 900);
      else if (W.step === 5) { var box = panel.querySelector('.check'); if (box) renderCheck(box); }
    }
  }
  function onVis() { if (!doc.hidden && alive && W.step >= 4 && !W.connected) { stopPoll(); tick(); } }
  doc.addEventListener('visibilitychange', onVis);

  return { destroy: function () { alive = false; host._tok = null; stopPoll(); doc.removeEventListener('visibilitychange', onVis); } };
};

/* ───────────────────────── keys ───────────────────────── */
function daysLeft(ms) { return Math.ceil((ms - Date.now()) / 86400000); }
function expiryEl(k) {
  if (!k.expires) return h('span', { class: 'dim' }, t('exp_never'));
  if (k.expires < Date.now()) return chip(t('exp_expired'), 'bad', 'clock', fFull.format(k.expires));
  var n = daysLeft(k.expires), txt = n < 1 ? t('exp_today') : t('exp_in', { t: n + '\u00A0' + tn('days_n', n) });
  return h('span', { title: fFull.format(k.expires), class: n <= 7 ? 'warn-t' : '' }, txt);
}
function modelLabel(id) { var m = modelById(id); return m ? m.name || m.id : id; }
function metaItem(label, val) { return h('div', { class: 'mi' }, h('dt', null, label), h('dd', null, val)); }

views.keys = function (host) {
  var listEl, countEl, alive = true;
  needState(host, function () { return h('div', null, sk('30%', '34px'), sk('100%', '120px', 'r'), sk('100%', '120px', 'r')); }, render);

  function render(st) {
    countEl = h('span', { class: 'count-pill' });
    var newBtn = btn(t('keys_new'), { icon: 'plus', cls: 'pri', onclick: function () { keyDialog(null, refresh); } });
    listEl = h('div', { class: 'klist-w' });
    host.appendChild(pageHead(t('keys_t'), t('keys_d'), [countEl, newBtn]));
    host.appendChild(listEl);
    paint();
    loadState().then(function () { if (alive && host.isConnected) paint(); }, function () {});
  }
  function refresh() { return loadState().then(function () { if (alive && host.isConnected) paint(); }, function (e) { toast(e.message, 'bad'); }); }
  function paint() {
    var keys = S.state.keys;
    countEl.textContent = t('keys_count', { n: keys.length, max: MAX_KEYS });
    countEl.classList.toggle('full', keys.length >= MAX_KEYS);
    clear(listEl);
    if (!keys.length) {
      listEl.appendChild(h('div', { class: 'card' }, emptyState('key', t('keys_empty_t'), t('keys_empty_d'), btn(t('keys_new'), { icon: 'plus', cls: 'pri', onclick: function () { keyDialog(null, refresh); } }))));
      return;
    }
    listEl.appendChild(h('ul', { class: 'klist' }, keys.map(function (k) { return keyRow(k); })));
  }
  function keyRow(k) {
    var expired = !!k.expires && k.expires < Date.now(), mods = k.models && k.models.length ? k.models : null;
    var scope = h('div', { class: 'k-scope' },
      mods ? mods.slice(0, 4).map(function (id) { return h('span', { class: 'mchip mono', title: id }, modelLabel(id)); }) : chip(t('all_models'), 'muted', 'models'),
      mods && mods.length > 4 ? h('span', { class: 'mchip muted' }, '+' + (mods.length - 4)) : null,
      k.ips && k.ips.length ? chip(t('ip_chip', { n: k.ips.length }), 'muted', 'shield', t('ip_title', { list: k.ips.join(', ') })) : null);
    var reqs = +k.requests_today || 0;
    var act = h('div', { class: 'k-act' },
      btn(t('a_connect'), { icon: 'connect', cls: 'sm', aria: t('a_connect_aria', { name: k.name }), onclick: function () { wizardWithKey(k); } }),
      btn(t('a_edit'), { icon: 'pencil', cls: 'sm ico', aria: t('a_edit_aria', { name: k.name }), title: t('a_edit'), onclick: function () { keyDialog(k, refresh); } }),
      btn(t('a_roll'), { icon: 'roll', cls: 'sm ico', aria: t('a_roll_aria', { name: k.name }), title: t('a_roll'), onclick: function () { doRoll(k); } }),
      btn(t('a_revoke'), { icon: 'trash', cls: 'sm ico danger', aria: t('a_revoke_aria', { name: k.name }), title: t('a_revoke'), onclick: function () { doRevoke(k); } }));
    return h('li', { class: 'krow card' + (expired ? ' expired' : '') },
      h('div', { class: 'k-main' }, h('div', { class: 'k-name' }, h('b', { title: k.name }, k.name), expired ? chip(t('exp_expired'), 'bad') : null), h('code', { class: 'k-hint' }, k.hint)),
      h('dl', { class: 'k-meta' },
        metaItem(t('col_created'), timeEl(k.created)),
        metaItem(t('col_last'), k.last_used ? h('span', null, timeEl(k.last_used), k.last_client || k.last_ip ? h('small', { class: 'k-client' }, [k.last_client, k.last_ip].filter(Boolean).join(' · ')) : null) : h('span', { class: 'dim' }, t('never_used'))),
        metaItem(t('col_expires'), expiryEl(k)),
        metaItem(t('col_today'), h('span', null, h('b', { class: 'num' }, int(reqs)), ' ', h('small', null, tn('reqs', reqs))))),
      scope, act);
  }
  function doRoll(k) {
    confirmDialog({ title: t('roll_t'), desc: t('roll_d', { name: k.name }), ok: t('roll_ok'), icon: 'roll' }).then(function (ok) {
      if (!ok) return;
      api('/api/dev/keys/' + encodeURIComponent(k.id) + '/roll', { method: 'POST' }).then(function (r) {
        toast(t('toast_rolled'), 'ok'); refresh(); showOnce(r.item, r.key);
      }, function (e) { toast(e.message, 'bad'); });
    });
  }
  function doRevoke(k) {
    confirmDialog({ title: t('revoke_t'), desc: t('revoke_d', { name: k.name }), ok: t('revoke_ok'), danger: true, icon: 'trash' }).then(function (ok) {
      if (!ok) return;
      api('/api/dev/keys/' + encodeURIComponent(k.id), { method: 'DELETE' }).then(function () {
        delete S.raw[k.id]; if (W.keyId === k.id) { W.keyId = null; W.keyChoice = null; W.maxStep = Math.min(W.maxStep, 3); }
        toast(t('toast_revoked'), 'ok'); refresh();
      }, function (e) { toast(e.message, 'bad'); });
    });
  }
  return { destroy: function () { alive = false; host._tok = null; } };
};

function choiceRow(name, items, value, onChange) {
  var row = h('div', { class: 'choice', role: 'radiogroup' });
  items.forEach(function (it) {
    var inp = h('input', { type: 'radio', name: name, value: it.v, checked: it.v === value ? '' : null });
    inp.addEventListener('change', function () { if (inp.checked) onChange(it.v); });
    row.appendChild(h('label', { class: 'choice-i' }, inp, h('span', null, it.l)));
  });
  return row;
}
var IP_RE4 = /^\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?$/, IP_RE6 = /^[0-9a-fA-F:]*:[0-9a-fA-F:.]*(?:\/\d{1,3})?$/;

function keyDialog(key, after) {
  var edit = !!key, formId = uid('kf'), models = S.state.models, sel = {}, expiry = '';
  (edit && key.models || []).forEach(function (id) { sel[id] = true; });
  var nameIn = h('input', { class: 'inp', id: formId + '-n', type: 'text', maxlength: '60', required: '', autocomplete: 'off', spellcheck: 'false', placeholder: t('f_name_ph'), value: edit ? key.name : '', 'data-autofocus': '', 'aria-describedby': formId + '-ne' });
  var nameErr = h('div', { class: 'f-err', id: formId + '-ne', hidden: '' }, t('f_name_err'));
  var counter = h('span', { class: 'f-count' }, (nameIn.value.length) + '/60');
  nameIn.addEventListener('input', function () { counter.textContent = nameIn.value.length + '/60'; nameErr.hidden = true; nameIn.removeAttribute('aria-invalid'); });
  var chipsEl = h('div', { class: 'mchips', role: 'group', 'aria-label': t('f_models') });
  models.forEach(function (m) {
    var dis = !m.available && !sel[m.id];
    var b = h('button', { type: 'button', class: 'mtoggle', 'aria-pressed': sel[m.id] ? 'true' : 'false', disabled: dis ? '' : null, title: m.id }, ic('check'), h('span', null, m.name || m.id));
    b.addEventListener('click', function () { sel[m.id] = !sel[m.id]; b.setAttribute('aria-pressed', sel[m.id] ? 'true' : 'false'); });
    chipsEl.appendChild(b);
  });
  var ipsIn = h('textarea', { class: 'inp mono', id: formId + '-i', rows: '3', spellcheck: 'false', placeholder: t('f_ips_ph'), 'aria-describedby': formId + '-ie' }); ipsIn.value = edit && key.ips ? key.ips.join('\n') : '';
  var ipsErr = h('div', { class: 'f-err', id: formId + '-ie', hidden: '' });
  var formErr = h('div', { class: 'callout bad', role: 'alert', hidden: '' }, ic('alert'), h('span'));
  var field = function (label, ctl, hint, opt, forId) {
    return h('div', { class: 'field' }, h('div', { class: 'f-row' }, h('label', { class: 'f-l', for: forId || null }, label, opt ? h('span', { class: 'f-opt' }, t('f_optional')) : null)), ctl, hint ? h('p', { class: 'f-hint' }, hint) : null);
  };
  var form = h('form', { id: formId, class: 'kform', novalidate: '' },
    h('div', { class: 'field' }, h('div', { class: 'f-row' }, h('label', { class: 'f-l', for: formId + '-n' }, t('f_name')), counter), nameIn, nameErr),
    edit ? null : field(t('f_expiry'), choiceRow('kf-exp', [{ v: '', l: t('exp_opt_none') }, { v: '30', l: t('exp_opt_30') }, { v: '90', l: t('exp_opt_90') }, { v: '365', l: t('exp_opt_365') }], '', function (v) { expiry = v; })),
    field(t('f_models'), chipsEl, t('f_models_hint'), true),
    field(t('f_ips'), ipsIn, t('f_ips_hint'), true, formId + '-i'), ipsErr, formErr);
  var save = h('button', { type: 'submit', class: 'btn pri', form: formId }, h('span', { class: 'bl' }, edit ? t('save') : t('btn_create'))), cancel = btn(t('cancel'), { onclick: function () { d.close('cancel'); } });
  var d = openDialog({ title: edit ? t('dlg_edit_t') : t('dlg_create_t'), icon: 'key', size: 'md', body: form, footer: [cancel, save] });
  var busy = false;
  form.addEventListener('submit', function (e) {
    e.preventDefault(); if (busy) return;
    var name = nameIn.value.trim();
    if (!name || name.length > 60) { nameErr.hidden = false; nameIn.setAttribute('aria-invalid', 'true'); nameIn.focus(); return; }
    var ips = ipsIn.value.split(/[\n,]+/).map(function (x) { return x.trim(); }).filter(Boolean), bad = ips.filter(function (x) { return !(IP_RE4.test(x) || IP_RE6.test(x)); })[0];
    if (bad) { ipsErr.textContent = t('f_ips_err', { v: bad }); ipsErr.hidden = false; ipsIn.setAttribute('aria-invalid', 'true'); ipsIn.focus(); return; }
    ipsErr.hidden = true; ipsIn.removeAttribute('aria-invalid'); formErr.hidden = true;
    var mods = models.filter(function (m) { return sel[m.id]; }).map(function (m) { return m.id; });
    var body = { name: name, models: mods.length ? mods : null, ips: ips.length ? ips : null };
    if (!edit) body.expires_days = expiry ? +expiry : null;
    busy = true; save.disabled = true; save.classList.add('loading');
    api(edit ? '/api/dev/keys/' + encodeURIComponent(key.id) : '/api/dev/keys', { method: edit ? 'PATCH' : 'POST', body: body }).then(function (r) {
      d.close('ok');
      if (edit) toast(t('toast_saved'), 'ok'); else { toast(t('toast_created'), 'ok'); showOnce(r.item, r.key); }
      if (after) after();
    }, function (err) {
      busy = false; save.disabled = false; save.classList.remove('loading');
      formErr.lastChild.textContent = err.message; formErr.hidden = false; formErr.scrollIntoView({ block: 'nearest' });
    });
  });
}

function showOnce(item, raw) {
  rememberRaw(item, raw);
  var keyEl = h('code', { class: 'once-k', tabindex: '0', id: uid('ok') }, raw);
  var d, use = btn(t('once_use'), { icon: 'connect', onclick: function () { d.close('use'); wizardWithKey(item); } }), done = btn(t('done'), { cls: 'pri', onclick: function () { d.close('done'); } });
  var body = h('div', { class: 'once' },
    item && item.name ? h('div', { class: 'once-for' }, t('once_for', { name: item.name })) : null,
    h('div', { class: 'once-box' }, keyEl, copyBtn(raw, { cls: 'pri', aria: t('copy_key') })),
    h('div', { class: 'callout warn' }, ic('alert'), h('span', null, t('once_warn'))));
  d = openDialog({ title: t('once_t'), desc: t('once_d'), icon: 'lock', size: 'md', body: body, footer: [use, done], tone: 'amber' });
}

/* ───────────────────────── models ───────────────────────── */
views.models = function (host) {
  needState(host, function () { return h('div', null, sk('30%', '34px'), h('div', { class: 'mgrid' }, [1, 2, 3, 4, 5, 6].map(function () { return sk('100%', '190px', 'r'); }))); }, function (st) {
    var ms = st.models.slice().sort(function (a, b) { return (b.available ? 1 : 0) - (a.available ? 1 : 0); });
    host.appendChild(pageHead(t('models_t'), t('models_d')));
    host.appendChild(h('div', { class: 'mgrid' }, ms.map(function (m) {
      var w = +m.weight || 1, unit = pl(w, t('cost_msg')).replace('{n}', '').trim();
      return h('article', { class: 'mcard card' + (m.available ? '' : ' dim') },
        h('div', { class: 'mc-body' },
          h('div', { class: 'mc-top' }, h('h3', { title: m.name }, m.name || m.id), m.def && m.available ? chip(t('badge_default'), 'accent') : null),
          h('div', { class: 'mc-id' }, h('code', { class: 'mono', title: m.id }, m.id), copyBtn(m.id, { iconOnly: true, cls: 'xs', aria: t('copy_id', { id: m.id }) })),
          h('div', { class: 'mc-cost' }, h('b', null, num(w)), h('span', null, unit)),
          h('div', { class: 'mc-chips' }, m.vision ? visionChip() : null, agentChip(m))),
        m.available ? null : h('div', { class: 'mc-lock' }, ic('lock'), h('span', null, m.plan_hint ? t('avail_on', { plan: m.plan_hint }) : t('avail_none'))));
    })));
  });
  return { destroy: function () { host._tok = null; } };
};

/* ───────────────────────── logs ───────────────────────── */
function protoLabel(p) { return D[LANG]['proto_' + p] ? t('proto_' + p) : String(p || '—'); }
function logBody(l) {
  var tone = statusTone(l.status), err = l.err ? h('tr', { class: 'log-err' }, h('td', { colspan: '7' }, ic('alert'), h('span', null, l.err))) : null;
  var cell = function (label, cls) { var td = h('td', { class: cls || '', 'data-label': label }); append(td, Array.prototype.slice.call(arguments, 2)); return td; };
  var main = h('tr', { class: 'log-main' },
    cell(t('col_time'), 'c-time', timeEl(l.at, { abs: fmtLogTime })),
    cell(t('col_keyclient'), 'c-key', h('b', { title: l.key_name }, l.key_name || '—'), h('small', null, l.client || t('unknown_client'))),
    cell(t('col_model'), 'c-model', h('span', { class: 'mono m-id', title: l.model }, l.model || '—'), h('span', { class: 'm-tags' }, h('span', { class: 'ptag' }, protoLabel(l.proto)), l.stream ? h('span', { class: 'ptag s' }, t('stream')) : null)),
    cell(t('col_status'), 'c-st', h('span', { class: 'chip sm ' + tone }, h('span', { class: 'chip-dot' }), h('span', null, String(l.status)))),
    cell(t('col_latency'), 'c-lat', h('span', { class: 'num' }, fmtMs(l.ms)), l.ttft != null ? h('small', null, t('ttft') + ' ' + fmtMs(l.ttft)) : null),
    cell(t('col_tokens'), 'c-tok', h('span', { class: 'num' }, int(l.in_tok), h('i', { class: 'arr' }, '→'), int(l.out_tok))),
    cell(t('col_cost'), 'c-cost', h('span', { class: 'num' + (+l.cost ? '' : ' dim') }, num(l.cost))));
  return h('tbody', { class: 'log' + (l.err ? ' has-err' : '') }, main, err);
}

views.logs = function (host) {
  var alive = true, items = [], next = null, keyFilter = '', loading = false, tableHost, moreHost, seq = 0;
  needState(host, function () { return h('div', null, sk('30%', '34px'), sk('100%', '320px', 'r')); }, render);
  function render(st) {
    var sel = h('select', { class: 'inp sel', id: 'logs-key', 'aria-label': t('f_key') }, h('option', { value: '' }, t('all_keys')), st.keys.map(function (k) { return h('option', { value: k.id }, k.name); }));
    sel.addEventListener('change', function () { keyFilter = sel.value; load(true); });
    var refreshBtn = btn(t('refresh'), { icon: 'roll', cls: 'sm', onclick: function () { load(true); } });
    host.appendChild(pageHead(t('logs_t'), t('logs_d'), [h('label', { class: 'filter', for: 'logs-key' }, h('span', { class: 'filter-l' }, t('f_key')), sel), refreshBtn]));
    tableHost = h('div', { class: 'logs-w' }); moreHost = h('div', { class: 'more' });
    host.appendChild(tableHost); host.appendChild(moreHost);
    load(true);
  }
  function load(reset) {
    if (loading && !reset) return;
    var my = ++seq; loading = true;
    if (reset) { clear(tableHost).appendChild(h('div', { class: 'card pad' }, [1, 2, 3, 4, 5].map(function () { return sk('100%', '38px'); }))); clear(moreHost); }
    var q = '?limit=50' + (!reset && next ? '&before=' + encodeURIComponent(next) : '') + (keyFilter ? '&key=' + encodeURIComponent(keyFilter) : '');
    if (!reset) { var mb = moreHost.querySelector('button'); if (mb) { mb.disabled = true; mb.classList.add('loading'); } }
    api('/api/dev/logs' + q).then(function (r) {
      if (!alive || my !== seq) return; loading = false;
      items = reset ? (r.items || []) : items.concat(r.items || []); next = r.next == null ? null : r.next;
      paint();
    }, function (err) {
      if (!alive || my !== seq) return; loading = false;
      if (reset) clear(tableHost).appendChild(errorState(err, function () { load(true); })); else { toast(err.message, 'bad'); paint(); }
    });
  }
  function paint() {
    clear(tableHost); clear(moreHost);
    if (!items.length) { tableHost.appendChild(h('div', { class: 'card' }, emptyState('logs', keyFilter ? t('logs_empty_f') : t('logs_empty_t'), keyFilter ? null : t('logs_empty_d'), keyFilter ? null : link(t('gs_cta'), '#connect', { cls: 'pri', iconAfter: 'arrowr' })))); return; }
    var table = h('table', { class: 'logs card' },
      h('thead', null, h('tr', null, ['col_time', 'col_keyclient', 'col_model', 'col_status', 'col_latency', 'col_tokens', 'col_cost'].map(function (k) { return h('th', { scope: 'col' }, t(k)); }))),
      items.map(logBody));
    tableHost.appendChild(h('div', { class: 'logs-scroll' }, table));
    if (next) moreHost.appendChild(btn(t('logs_more'), { cls: 'lg', onclick: function () { load(false); } }));
  }
  return { destroy: function () { alive = false; host._tok = null; } };
};

/* ───────────────────────── playground ───────────────────────── */
var PG = { model: null, system: '', user: '', max: 1024, answer: '', reasoning: '', meta: null };
function renderAnswer(text, running) {
  var box = h('div', { class: 'ans' }), parts = text.split('```');
  parts.forEach(function (p, i) {
    if (i % 2 === 0) { if (p.trim() || i === 0) box.appendChild(h('div', { class: 'ans-p' }, rich(p.replace(/^\n+|\n+$/g, '')))); }
    else {
      var nl = p.indexOf('\n'), lang = nl >= 0 ? p.slice(0, nl).trim() : p.trim(), code = nl >= 0 ? p.slice(nl + 1) : '';
      box.appendChild(codeBlock({ code: code.replace(/\n$/, ''), lang: /^[\w+-]{1,16}$/.test(lang) ? lang : 'text', compact: true }));
    }
  });
  if (running) { var last = box.lastChild; (last && last.classList.contains('ans-p') ? last : box).appendChild(h('span', { class: 'caret', 'aria-hidden': 'true' })); }
  return box;
}
views.playground = function (host) {
  var alive = true, ctrl = null, running = false, raf = 0, answer = '', reasoning = '', outEl, metaEl, sendBtn, stopBtn, costEl, errEl;
  needState(host, function () { return h('div', null, sk('30%', '34px'), sk('100%', '360px', 'r')); }, render);

  function render(st) {
    var models = availModels();
    if (!PG.model || !models.some(function (m) { return m.id === PG.model; })) PG.model = (defaultModel(models) || {}).id || null;
    var sel = h('select', { class: 'inp sel', id: 'pg-model' }, models.map(function (m) { return h('option', { value: m.id }, (m.name || m.id)); }));
    sel.value = PG.model || '';
    costEl = h('p', { class: 'f-hint cost-note' }, ic('bolt'), h('span'));
    var syncCost = function () { var m = modelById(sel.value); costEl.lastChild.textContent = t('pg_cost', { n: m ? tnum('msgs', m.weight) : '' }); };
    sel.addEventListener('change', function () { PG.model = sel.value; syncCost(); });
    var sys = h('textarea', { class: 'inp', id: 'pg-sys', rows: '2', placeholder: '' }); sys.value = PG.system;
    var usr = h('textarea', { class: 'inp', id: 'pg-user', rows: '6', placeholder: t('pg_user_ph'), 'data-keys': '' }); usr.value = PG.user;
    var max = h('input', { class: 'inp', id: 'pg-max', type: 'number', min: '16', max: '32768', step: '16', value: String(PG.max) });
    sys.addEventListener('input', function () { PG.system = sys.value; }); usr.addEventListener('input', function () { PG.user = usr.value; });
    max.addEventListener('input', function () { PG.max = +max.value || 1024; });
    sendBtn = btn(t('pg_send'), { icon: 'send', cls: 'pri', type: 'submit' });
    stopBtn = btn(t('pg_stop'), { icon: 'stop', cls: 'danger', onclick: function () { if (ctrl) ctrl.abort(); } }); stopBtn.hidden = true;
    errEl = h('div', { class: 'callout bad', role: 'alert', hidden: '' }, ic('alert'), h('span'));
    var form = h('form', { class: 'pg-form card pad' },
      h('div', { class: 'field' }, h('label', { class: 'f-l', for: 'pg-model' }, t('pg_model')), sel),
      h('div', { class: 'field' }, h('div', { class: 'f-row' }, h('label', { class: 'f-l', for: 'pg-sys' }, t('pg_system'), h('span', { class: 'f-opt' }, t('f_optional')))), sys),
      h('div', { class: 'field' }, h('label', { class: 'f-l', for: 'pg-user' }, t('pg_user')), usr),
      h('div', { class: 'pg-row' }, h('div', { class: 'field sm' }, h('label', { class: 'f-l', for: 'pg-max' }, t('pg_max')), max), h('div', { class: 'pg-btns' }, stopBtn, sendBtn)),
      costEl, h('p', { class: 'f-hint kbd' }, t('pg_hotkey')));
    form.addEventListener('submit', function (e) { e.preventDefault(); send(); });
    usr.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } });
    outEl = h('div', { class: 'pg-out', 'aria-live': 'off' }); metaEl = h('div', { class: 'pg-meta' });
    host.appendChild(pageHead(t('pg_t'), t('pg_d')));
    host.appendChild(h('div', { class: 'pg' }, form, h('section', { class: 'pg-res card', 'aria-label': t('pg_answer') }, h('div', { class: 'pg-res-h' }, h('h2', null, t('pg_answer')), metaEl), errEl, outEl)));
    syncCost();
    if (!models.length) { sendBtn.disabled = true; sel.disabled = true; }
    answer = PG.answer; reasoning = PG.reasoning; paintOut(false); paintMeta(PG.meta);
  }
  function paintOut(live) {
    clear(outEl);
    if (!answer && !reasoning) { outEl.appendChild(live ? h('div', { class: 'typing' }, h('i'), h('i'), h('i'), h('span', { class: 'sr' }, t('pg_running'))) : h('div', { class: 'pg-empty' }, ic('sparkle'), h('p', null, t('pg_empty')))); return; }
    if (reasoning) outEl.appendChild(h('details', { class: 'reason', open: !answer && live ? '' : null }, h('summary', null, ic('sparkle'), t('pg_reasoning'), ic('chevd', 'sum-c')), h('div', { class: 'reason-t' }, reasoning)));
    if (answer || live) outEl.appendChild(renderAnswer(answer, live));
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(function () { raf = 0; if (alive) paintOut(running); }); }
  function paintMeta(m) {
    clear(metaEl); if (!m) return;
    var item = function (k, v) { return h('span', { class: 'pm' }, h('i', null, k), h('b', null, v)); };
    metaEl.appendChild(frag(m.ttft != null ? item(t('pg_ttft'), fmtMs(m.ttft)) : null, item(t('pg_total'), fmtMs(m.total)), m.usage ? item(t('pg_tokens'), int(m.usage.prompt_tokens) + ' → ' + int(m.usage.completion_tokens)) : null));
  }
  function setRunning(on) { running = on; sendBtn.hidden = on; stopBtn.hidden = !on; host.classList.toggle('busy', on); }
  function send() {
    if (running) return;
    var user = PG.user.trim(); if (!user) { toast(t('pg_need_msg'), 'bad'); var u = doc.getElementById('pg-user'); if (u) u.focus(); return; }
    if (!PG.model) return;
    var msgs = []; if (PG.system.trim()) msgs.push({ role: 'system', content: PG.system.trim() }); msgs.push({ role: 'user', content: user });
    answer = ''; reasoning = ''; PG.answer = ''; PG.reasoning = ''; PG.meta = null; errEl.hidden = true; clear(metaEl);
    ctrl = new AbortController(); setRunning(true); paintOut(true);
    var t0 = performance.now(), ttft = null, usage = null, streamErr = null, stopped = false, buf = '';
    function onLine(line) {
      line = line.trim(); if (line.indexOf('data:') !== 0) return;
      var d = line.slice(5).trim(); if (!d || d === '[DONE]') return;
      var j; try { j = JSON.parse(d); } catch (e) { return; }
      if (j.error) { streamErr = typeof j.error === 'string' ? j.error : j.error.message || t('err_generic'); return; }
      var c = j.choices && j.choices[0], dl = c && c.delta;
      if (dl) {
        if (dl.reasoning_content) { reasoning += dl.reasoning_content; if (ttft == null) ttft = performance.now() - t0; }
        if (dl.content) { answer += dl.content; if (ttft == null) ttft = performance.now() - t0; }
        PG.answer = answer; PG.reasoning = reasoning; schedule();
      }
      if (j.usage) usage = j.usage;
    }
    fetch('/api/dev/playground', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify({ model: PG.model, messages: msgs, max_tokens: clamp(PG.max || 1024, 16, 32768) }), signal: ctrl.signal })
      .then(function (res) {
        if (res.status === 401) return toLogin();
        if (!res.ok) return res.text().then(function (txt) { var dd = null; try { dd = JSON.parse(txt); } catch (e) {} var er = new Error(dd && dd.error ? dd.error : t('err_generic')); er.status = res.status; throw er; });
        if (!res.body || !res.body.getReader) return res.text().then(function (txt) { txt.split('\n').forEach(onLine); });
        var reader = res.body.getReader(), dec = new TextDecoder();
        return (function pump() {
          return reader.read().then(function (r) {
            if (r.done) { if (buf) onLine(buf); return; }
            buf += dec.decode(r.value, { stream: true });
            var lines = buf.split('\n'); buf = lines.pop(); lines.forEach(onLine);
            return pump();
          });
        })();
      })
      .catch(function (err) {
        if (err && err.name === 'AbortError') stopped = true;
        else streamErr = err && err.name === 'TypeError' ? t('err_network') : (err && err.message) || t('err_generic');
      })
      .then(function () {
        if (!alive) return;
        setRunning(false); ctrl = null;
        var m = { ttft: ttft, total: performance.now() - t0, usage: usage }; PG.meta = m;
        paintOut(false); paintMeta(m);
        if (stopped) outEl.appendChild(h('div', { class: 'stopped' }, ic('stop'), t('pg_stopped')));
        if (streamErr) { errEl.lastChild.textContent = streamErr; errEl.hidden = false; }
        loadState().catch(function () {});
      });
  }
  return { destroy: function () { alive = false; host._tok = null; if (ctrl) ctrl.abort(); cancelAnimationFrame(raf); } };
};

/* ───────────────────────── docs ───────────────────────── */
function exampleSet(base, model) {
  var P = PLACEHOLDER;
  return [
    ['curl-openai', 'curl · OpenAI', 'bash', 'curl ' + base + '/v1/chat/completions \\\n  -H "Authorization: Bearer ' + P + '" \\\n  -H "Content-Type: application/json" \\\n  -d \'{\n    "model": "' + model + '",\n    "messages": [{"role": "user", "content": "Hello!"}]\n  }\''],
    ['curl-responses', 'curl · Responses', 'bash', 'curl ' + base + '/v1/responses \\\n  -H "Authorization: Bearer ' + P + '" \\\n  -H "Content-Type: application/json" \\\n  -d \'{\n    "model": "' + model + '",\n    "input": "Hello!"\n  }\''],
    ['curl-anthropic', 'curl · Anthropic', 'bash', 'curl ' + base + '/v1/messages \\\n  -H "x-api-key: ' + P + '" \\\n  -H "anthropic-version: 2023-06-01" \\\n  -H "Content-Type: application/json" \\\n  -d \'{\n    "model": "' + model + '",\n    "max_tokens": 1024,\n    "messages": [{"role": "user", "content": "Hello!"}]\n  }\''],
    ['py-openai', 'Python · openai', 'python', 'from openai import OpenAI\n\nclient = OpenAI(base_url="' + base + '/v1", api_key="' + P + '")\n\nresp = client.chat.completions.create(\n    model="' + model + '",\n    messages=[{"role": "user", "content": "Hello!"}],\n)\nprint(resp.choices[0].message.content)'],
    ['node-openai', 'Node · openai', 'js', 'import OpenAI from "openai";\n\nconst client = new OpenAI({ baseURL: "' + base + '/v1", apiKey: "' + P + '" });\n\nconst resp = await client.chat.completions.create({\n  model: "' + model + '",\n  messages: [{ role: "user", content: "Hello!" }],\n});\nconsole.log(resp.choices[0].message.content);'],
    ['py-anthropic', 'Python · anthropic', 'python', 'import anthropic\n\nclient = anthropic.Anthropic(base_url="' + base + '", api_key="' + P + '")\n\nmsg = client.messages.create(\n    model="' + model + '",\n    max_tokens=1024,\n    messages=[{"role": "user", "content": "Hello!"}],\n)\nprint(msg.content[0].text)']
  ];
}
views.docs = function (host) {
  needState(host, function () { return h('div', null, sk('30%', '34px'), sk('100%', '200px', 'r'), sk('100%', '200px', 'r')); }, function (st) {
    var raw = S.lastRaw || '', first = availModels()[0], model = first ? first.id : 'MODEL_ID', base = st.base_url, secs = [];
    var sec = function (id, title, desc, content) {
      var el = h('section', { class: 'card pad doc', id: 'doc-' + id, 'aria-labelledby': 'doc-h-' + id }, h('h2', { id: 'doc-h-' + id }, title), desc ? h('p', { class: 'doc-d' }, rich(desc)) : null, content);
      secs.push([id, title, el]); return el;
    };
    var table = function (head, rows) {
      return h('div', { class: 'tbl-w' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, head.map(function (c) { return h('th', { scope: 'col' }, c); }))), h('tbody', null, rows.map(function (r) { return h('tr', null, r.map(function (c, i) { return h('td', { 'data-label': head[i] }, c); })); }))));
    };
    var urlRow = function (kind, url) { return h('div', { class: 'burl plain' }, h('div', { class: 'burl-l' }, h('span', { class: 'burl-k' }, t('base_' + kind)), h('span', { class: 'burl-for' }, t('base_' + kind + '_for'))), h('div', { class: 'burl-v' }, h('code', { class: 'burl-code', tabindex: '0' }, url), copyBtn(url, { cls: 'sm', aria: t('copy_url', { name: t('base_' + kind) }) }))); };
    var method = function (m) { return h('span', { class: 'method ' + m.toLowerCase() }, m); };
    var path = function (p) { return h('code', { class: 'mono path' }, p); };
    var codeCell = function (n) { return h('b', { class: 'http ' + (n >= 500 ? 'bad' : n >= 400 ? 'warn' : 'ok') }, String(n)); };

    var wrap = h('div', { class: 'docs' });
    wrap.appendChild(sec('base', t('d_base'), t('d_base_d'), h('div', { class: 'burls plain' }, urlRow('openai', base + '/v1'), urlRow('anthropic', base))));
    wrap.appendChild(sec('auth', t('d_auth'), t('d_auth_d'), codeBlock({ code: 'Authorization: Bearer ' + PLACEHOLDER + '\n# or, for Anthropic SDKs\nx-api-key: ' + PLACEHOLDER, lang: 'bash', raw: raw, file: 'headers' })));
    wrap.appendChild(sec('endpoints', t('d_endpoints'), null, table([t('col_method'), t('col_path'), t('col_desc')], [
      [method('POST'), path('/v1/chat/completions'), t('ep_chat')], [method('POST'), path('/v1/responses'), t('ep_resp')], [method('POST'), path('/v1/messages'), t('ep_msg')],
      [method('POST'), path('/v1/messages/count_tokens'), t('ep_count')], [method('GET'), path('/v1/models'), t('ep_models')]])));
    var lim = st.limits || {}, limRows = [];
    if (lim.rpm) limRows.push(h('div', { class: 'lim' }, h('b', null, int(lim.rpm)), h('span', null, t('d_limits_rpm'))));
    if (lim.concurrency) limRows.push(h('div', { class: 'lim' }, h('b', null, int(lim.concurrency)), h('span', null, t('d_limits_conc'))));
    wrap.appendChild(sec('billing', t('d_billing'), t('d_billing_d'), null));
    if (limRows.length) wrap.appendChild(sec('limits', t('d_limits'), lim.rpm && lim.concurrency ? t('d_limits_d', { rpm: int(lim.rpm), conc: int(lim.concurrency) }) : null, h('div', { class: 'lims' }, limRows)));
    wrap.appendChild(sec('errors', t('d_errors'), t('d_errors_d'), table([t('col_code'), t('col_meaning')], [[codeCell(401), t('e_401')], [codeCell(403), t('e_403')], [codeCell(404), t('e_404')], [codeCell(429), t('e_429')], [h('span', null, codeCell(502), ' / ', codeCell(503)), t('e_5xx')]])));
    var ex = exampleSet(base, model);
    wrap.appendChild(sec('examples', t('d_examples'), t('d_examples_d'), tabs(ex.map(function (e) { return { id: e[0], label: e[1], render: function () { return codeBlock({ code: e[3], lang: e[2], raw: raw, file: e[1] }); } }; }), { label: t('d_examples'), cls: 'ex-tabs' })));

    var jump = h('nav', { class: 'jump', 'aria-label': t('d_jump') }, secs.map(function (x) {
      var b = h('button', { type: 'button', class: 'jump-i' }, x[1]);
      b.addEventListener('click', function () { x[2].scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'start' }); });
      return b;
    }));
    host.appendChild(pageHead(t('docs_t'), t('docs_d')));
    host.appendChild(jump); host.appendChild(wrap);
  });
  return { destroy: function () { host._tok = null; } };
};

/* ───────────────────────── device approval (?connect=CODE) ───────────────────────── */
function handleConnectParam() {
  var q = new URLSearchParams(location.search), code = (q.get('connect') || '').trim();
  if (!code) return;
  var clean = function () { var u = new URL(location.href); u.searchParams.delete('connect'); history.replaceState(null, '', u.pathname + u.search + u.hash); };
  var result = function (ok, title, text, icon, tone) {
    clean();
    var d = openDialog({ title: title, desc: text, icon: icon, tone: tone, size: 'sm', backdrop: true, focusTitle: true, footer: [btn(t('close'), { cls: ok ? 'pri' : '', onclick: function () { d.close('ok'); } })] });
  };
  var notFound = function () { result(false, t('dv_nf_t'), t('dv_nf_d'), 'clock', 'danger'); };
  if (!/^[A-Za-z0-9-]{3,40}$/.test(code)) { notFound(); return; }
  api('/api/dev/connect/' + encodeURIComponent(code)).then(function (info) {
    if (!info) return notFound();
    var expires = +info.expires || 0, tick, dlg, busy = false;
    var timeEl_ = h('b', { class: 'dv-left' });
    var upd = function () {
      var left = expires ? Math.max(0, Math.round((expires + 0 - (Date.now() + skew)) / 1000)) : null;
      timeEl_.textContent = left == null ? '—' : left <= 0 ? t('dv_expired_now') : Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
      timeEl_.classList.toggle('bad-t', left != null && left <= 0);
      if (left != null && left <= 0) { approve.disabled = true; clearInterval(tick); }
    };
    var errBox = h('div', { class: 'callout bad', role: 'alert', hidden: '' }, ic('alert'), h('span'));
    var fact = function (k, v) { return h('div', { class: 'dv-f' }, h('dt', null, k), h('dd', null, v)); };
    var body = h('div', { class: 'dv' },
      h('div', { class: 'dv-code-w' }, h('span', { class: 'dv-code-k' }, t('dv_code')), h('div', { class: 'dv-code', 'aria-label': String(info.code || code).split('').join(' ') }, info.code || code), h('span', { class: 'dv-hint' }, t('dv_compare'))),
      h('dl', { class: 'dv-facts' }, fact(t('dv_ip'), h('span', { class: 'mono' }, info.ip || '—')), fact(t('dv_requested'), info.created ? timeEl(info.created) : '—'), fact(t('dv_expires'), timeEl_)),
      h('div', { class: 'callout warn' }, ic('shield'), h('span', null, t('dv_warn'))), errBox);
    var approve = btn(t('dv_approve'), { icon: 'check', cls: 'pri' }), deny = btn(t('dv_deny'), { icon: 'x', cls: 'danger' });
    var act = function (action) {
      if (busy) return; busy = true; approve.disabled = true; deny.disabled = true; errBox.hidden = true;
      api('/api/dev/connect/' + encodeURIComponent(info.code || code), { method: 'POST', body: { action: action } }).then(function () {
        clearInterval(tick); dlg.close('done');
        if (action === 'approve') result(true, t('dv_ok_t'), t('dv_ok_d'), 'check', 'ok'); else result(false, t('dv_denied_t'), t('dv_denied_d'), 'x');
        if (action === 'approve') loadState().catch(function () {});
      }, function (err) {
        busy = false; approve.disabled = false; deny.disabled = false;
        if (err.status === 404) { clearInterval(tick); dlg.close('nf'); notFound(); return; }
        errBox.lastChild.textContent = err.message; errBox.hidden = false;
      });
    };
    approve.addEventListener('click', function () { act('approve'); }); deny.addEventListener('click', function () { act('deny'); });
    var client = info.client || '—', os = info.os || '—', host_ = info.host || '—';
    dlg = openDialog({ title: t('dv_q', { client: client, os: os, host: host_ }), icon: 'terminal', size: 'sm', body: body, footer: [deny, approve], noEsc: false, focusTitle: true, onClose: function (r) { clearInterval(tick); if (r !== 'done' && r !== 'nf') clean(); } });
    upd(); tick = setInterval(upd, 1000);
  }, function (err) {
    if (err.status === 404) notFound(); else toast(err.message, 'bad');
  });
}

/* ───────────────────────── router + boot ───────────────────────── */
var current = null, firstRoute = true, mainEl;
function route() {
  var parts = location.hash.replace(/^#\/?/, '').split('/'), name = parts[0] || 'overview', arg = '';
  try { arg = parts[1] ? decodeURIComponent(parts[1]) : ''; } catch (e) {}
  if (!views[name]) { name = 'overview'; arg = ''; }
  if (current && current.destroy) { try { current.destroy(); } catch (e) {} }
  var hostEl = h('div', { class: 'view view-' + name });
  mainEl.replaceChildren(hostEl);
  setActiveNav(name);
  doc.title = t('nav_' + name) + ' · Premier API';
  current = views[name](hostEl, arg) || null;
  window.scrollTo(0, 0);
  if (!firstRoute) requestAnimationFrame(function () { var hd = doc.getElementById('page-h1'); if (hd) hd.focus({ preventScroll: true }); });
  firstRoute = false;
}
function boot() {
  appRoot = doc.getElementById('app'); mainEl = doc.getElementById('main'); dlgRoot = doc.getElementById('dlg-root'); toastsEl = doc.getElementById('toasts');
  doc.body.appendChild(srLive);
  buildChrome();
  window.addEventListener('hashchange', route);
  route();
  handleConnectParam();
}
if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else boot();
})();
