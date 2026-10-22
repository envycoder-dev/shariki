'use strict';
// Инструкции подключения для кабинета: Claude Code, Codex, Cursor, Cline/Roo/Kilo, OpenCode, Aider, SDK.
// Ключ в примерах — заглушка __PREMIER_KEY__: кабинет подставляет настоящий ключ, если он только что создан.
const KEY = '__PREMIER_KEY__';

function claudeEnv(origin, model, fast, native) {
  const env = {
    ANTHROPIC_BASE_URL: origin,
    ANTHROPIC_AUTH_TOKEN: KEY,
    ANTHROPIC_MODEL: model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: fast,
  };
  // модели не от Anthropic не знают beta-возможностей Claude Code (отложенная загрузка инструментов и т. п.)
  if (!native) env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = '1';
  return env;
}
const codexToml = (origin, model) => `model = "${model}"
model_provider = "premier"

[model_providers.premier]
name = "Premier"
base_url = "${origin}/v1"
wire_api = "responses"
http_headers = { "Authorization" = "Bearer ${KEY}" }`;

const T = {
  ru: {
    install: 'Установите', ifNot: 'если ещё не установлен',
    cc: ['Агент для программирования в терминале', 'Добавьте Premier в настройки', 'Откройте файл `~/.claude/settings.json` (на Windows — `%USERPROFILE%\\.claude\\settings.json`). Если файла нет — создайте. Если он уже есть, добавьте строки в раздел `env`.', 'Или только для текущего окна терминала', 'Запустите', 'Запустите `claude` в папке проекта. Команда `/status` покажет адрес Premier.'],
    cx: ['Агент OpenAI для терминала', 'Добавьте провайдера Premier', 'Откройте `~/.codex/config.toml` (на Windows — `%USERPROFILE%\\.codex\\config.toml`). Строки `model` и `model_provider` должны стоять в начале файла — до первого раздела в квадратных скобках; прежние такие строки удалите.', 'Запустите', 'Запустите `codex` в папке проекта.'],
    cu: ['Редактор кода с ИИ', 'Вставьте ключ', 'Cursor → Settings → Models → API Keys. В поле «OpenAI API Key» вставьте ключ.', 'Укажите адрес Premier', 'Включите «Override OpenAI Base URL» и вставьте адрес:', 'Добавьте модель', 'Models → «Add model» → впишите ID модели и включите её. Нажмите «Verify».'],
    cl: ['Агенты для VS Code: Cline, Roo Code, Kilo Code', 'Настройте провайдера', 'Откройте настройки расширения → API Provider: «OpenAI Compatible» и заполните поля:', 'Готово', 'Выберите модель и дайте агенту задачу.'],
    oc: ['Открытый агент для терминала', 'Добавьте провайдера', 'Создайте или дополните `~/.config/opencode/opencode.json`:', 'Запустите', 'Запустите `opencode` и выберите модель командой `/models`.'],
    ai: ['Парное программирование в терминале', 'Запустите с адресом Premier', 'Префикс `openai/` перед ID модели обязателен — так Aider понимает, что это OpenAI-совместимый API.'],
    sdk: ['curl, Python, Node.js', 'OpenAI SDK', 'Подходит любая библиотека OpenAI: укажите base_url и ключ.', 'Anthropic SDK', 'curl'],
    checkCommon: ['Запрос появится во вкладке «Журнал» в течение пары секунд.', 'Ошибка 401 — ключ скопирован не полностью или отозван.', 'Ошибка 404 — неверный ID модели: скопируйте его во вкладке «Модели».', 'Ошибка 429 — закончились сообщения на сегодня или слишком много запросов подряд.'],
    cursorNote: 'Cursor отправляет запросы со своих серверов, поэтому сайт должен быть доступен из интернета по HTTPS. Автодополнение Tab работает только на моделях Cursor.',
  },
  en: {
    install: 'Install', ifNot: 'if you have not yet',
    cc: ['Agentic coding in your terminal', 'Add Premier to the settings', 'Open `~/.claude/settings.json` (on Windows `%USERPROFILE%\\.claude\\settings.json`). Create it if it does not exist; if it does, add these lines to its `env` section.', 'Or just for the current terminal window', 'Run it', 'Run `claude` in your project folder. `/status` shows the Premier address.'],
    cx: ['OpenAI coding agent for the terminal', 'Add the Premier provider', 'Open `~/.codex/config.toml` (on Windows `%USERPROFILE%\\.codex\\config.toml`). The `model` and `model_provider` lines must be at the top of the file, before the first [section]; remove older lines with the same names.', 'Run it', 'Run `codex` in your project folder.'],
    cu: ['AI code editor', 'Paste the key', 'Cursor → Settings → Models → API Keys. Paste the key into “OpenAI API Key”.', 'Set the Premier address', 'Turn on “Override OpenAI Base URL” and paste:', 'Add the model', 'Models → “Add model” → type the model ID and enable it. Press “Verify”.'],
    cl: ['VS Code agents: Cline, Roo Code, Kilo Code', 'Configure the provider', 'Open the extension settings → API Provider: “OpenAI Compatible” and fill in:', 'Done', 'Pick the model and give the agent a task.'],
    oc: ['Open-source terminal agent', 'Add the provider', 'Create or extend `~/.config/opencode/opencode.json`:', 'Run it', 'Run `opencode` and pick the model with `/models`.'],
    ai: ['AI pair programming in your terminal', 'Run with the Premier address', 'The `openai/` prefix before the model ID is required: it tells Aider this is an OpenAI-compatible API.'],
    sdk: ['curl, Python, Node.js', 'OpenAI SDK', 'Any OpenAI library works: set base_url and the key.', 'Anthropic SDK', 'curl'],
    checkCommon: ['The request shows up in the Logs tab within a couple of seconds.', '401 means the key is incomplete or revoked.', '404 means a wrong model ID: copy it from the Models tab.', '429 means today’s messages ran out or too many requests at once.'],
    cursorNote: 'Cursor sends requests from its own servers, so the site must be reachable from the internet over HTTPS. Tab autocomplete only works with Cursor’s own models.',
  },
};

// origin — адрес сайта; m — { id, name, vision, native }; fast — ID быстрой модели
function clients(lang, origin, m, fast) {
  const t = T[lang] || T.ru, model = m ? m.id : 'MODEL_ID', name = m ? m.name : 'Model';
  fast = fast || model;
  const env = claudeEnv(origin, model, fast, m && m.native === 'anthropic');
  const block = (label, lng, code, file = null) => ({ label, lang: lng, file, code });
  const quick = (tool) => ({ sh: `curl -fsSL ${origin}/connect.sh | sh -s -- ${tool}`, ps: `$env:PREMIER_TOOL='${tool}'; irm ${origin}/connect.ps1 | iex` });
  const curlChat = `curl ${origin}/v1/chat/completions \\\n  -H "Authorization: Bearer ${KEY}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model": "${model}", "messages": [{"role": "user", "content": "Hello!"}]}'`;
  const curlMsg = `curl ${origin}/v1/messages \\\n  -H "x-api-key: ${KEY}" \\\n  -H "anthropic-version: 2023-06-01" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model": "${model}", "max_tokens": 1024, "messages": [{"role": "user", "content": "Hello!"}]}'`;
  return [
    {
      id: 'claude-code', name: 'Claude Code', tagline: t.cc[0], fast_model: true, quick: quick('claude-code'),
      steps: [
        { title: `${t.install} Claude Code`, text: t.ifNot, blocks: [block(null, 'bash', 'npm install -g @anthropic-ai/claude-code')] },
        { title: t.cc[1], text: t.cc[2], blocks: [block(null, 'json', JSON.stringify({ env }, null, 2), '~/.claude/settings.json')] },
        { title: t.cc[3], text: '', blocks: [
          block('macOS / Linux', 'bash', Object.entries(env).map(([k, v]) => `export ${k}="${v}"`).join('\n') + '\nclaude'),
          block('Windows', 'powershell', Object.entries(env).map(([k, v]) => `$env:${k}="${v}"`).join('\n') + '\nclaude'),
        ] },
        { title: t.cc[4], text: t.cc[5], blocks: [] },
      ],
      check: t.checkCommon,
    },
    {
      id: 'codex', name: 'Codex CLI', tagline: t.cx[0], fast_model: false, quick: quick('codex'),
      steps: [
        { title: `${t.install} Codex`, text: t.ifNot, blocks: [block(null, 'bash', 'npm install -g @openai/codex')] },
        { title: t.cx[1], text: t.cx[2], blocks: [block(null, 'toml', codexToml(origin, model), '~/.codex/config.toml')] },
        { title: t.cx[3], text: t.cx[4], blocks: [] },
      ],
      check: t.checkCommon,
    },
    {
      id: 'cursor', name: 'Cursor', tagline: t.cu[0], fast_model: false, quick: null,
      steps: [
        { title: t.cu[1], text: t.cu[2], blocks: [block(null, 'text', KEY)] },
        { title: t.cu[3], text: t.cu[4], blocks: [block(null, 'text', origin + '/v1')] },
        { title: t.cu[5], text: t.cu[6], blocks: [block(null, 'text', model)] },
      ],
      check: [t.cursorNote, ...t.checkCommon],
    },
    {
      id: 'cline', name: 'Cline · Roo · Kilo', tagline: t.cl[0], fast_model: false, quick: null,
      steps: [
        { title: t.cl[1], text: t.cl[2], blocks: [block(null, 'text', `Base URL:  ${origin}/v1\nAPI Key:   ${KEY}\nModel ID:  ${model}${m && m.vision ? '\nSupports Images: on' : ''}`)] },
        { title: t.cl[3], text: t.cl[4], blocks: [] },
      ],
      check: t.checkCommon,
    },
    {
      id: 'opencode', name: 'OpenCode', tagline: t.oc[0], fast_model: false, quick: null,
      steps: [
        { title: `${t.install} OpenCode`, text: t.ifNot, blocks: [block(null, 'bash', 'npm install -g opencode-ai')] },
        { title: t.oc[1], text: t.oc[2], blocks: [block(null, 'json', JSON.stringify({ $schema: 'https://opencode.ai/config.json', provider: { premier: { npm: '@ai-sdk/openai-compatible', name: 'Premier', options: { baseURL: origin + '/v1', apiKey: KEY }, models: { [model]: { name } } } }, model: 'premier/' + model }, null, 2), '~/.config/opencode/opencode.json')] },
        { title: t.oc[3], text: t.oc[4], blocks: [] },
      ],
      check: t.checkCommon,
    },
    {
      id: 'aider', name: 'Aider', tagline: t.ai[0], fast_model: false, quick: null,
      steps: [
        { title: `${t.install} Aider`, text: t.ifNot, blocks: [block(null, 'bash', 'python -m pip install aider-install && aider-install')] },
        { title: t.ai[1], text: t.ai[2], blocks: [
          block('macOS / Linux', 'bash', `export OPENAI_API_BASE="${origin}/v1"\nexport OPENAI_API_KEY="${KEY}"\naider --model openai/${model}`),
          block('Windows', 'powershell', `$env:OPENAI_API_BASE="${origin}/v1"\n$env:OPENAI_API_KEY="${KEY}"\naider --model openai/${model}`),
        ] },
      ],
      check: t.checkCommon,
    },
    {
      id: 'sdk', name: 'SDK & curl', tagline: t.sdk[0], fast_model: false, quick: null,
      steps: [
        { title: t.sdk[1], text: t.sdk[2], blocks: [
          block('Python', 'python', `from openai import OpenAI\n\nclient = OpenAI(base_url="${origin}/v1", api_key="${KEY}")\nr = client.chat.completions.create(\n    model="${model}",\n    messages=[{"role": "user", "content": "Hello!"}],\n)\nprint(r.choices[0].message.content)`),
          block('Node.js', 'js', `import OpenAI from "openai";\n\nconst client = new OpenAI({ baseURL: "${origin}/v1", apiKey: "${KEY}" });\nconst r = await client.chat.completions.create({\n  model: "${model}",\n  messages: [{ role: "user", content: "Hello!" }],\n});\nconsole.log(r.choices[0].message.content);`),
        ] },
        { title: t.sdk[3], text: '', blocks: [block('Python', 'python', `import anthropic\n\nclient = anthropic.Anthropic(base_url="${origin}", api_key="${KEY}")\nr = client.messages.create(\n    model="${model}",\n    max_tokens=1024,\n    messages=[{"role": "user", "content": "Hello!"}],\n)\nprint(r.content[0].text)`)] },
        { title: t.sdk[4], text: '', blocks: [block('Chat Completions', 'bash', curlChat), block('Anthropic Messages', 'bash', curlMsg)] },
      ],
      check: t.checkCommon,
    },
  ];
}

module.exports = { clients, claudeEnv, codexToml, KEY };
