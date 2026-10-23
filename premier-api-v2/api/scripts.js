'use strict';
// Скрипты «подключить одной командой»: curl -fsSL https://сайт/connect.sh | sh   ·   irm https://сайт/connect.ps1 | iex
// Скрипт получает код, пользователь подтверждает его в кабинете, затем скрипт сохраняет ключ в настройках
// Claude Code (~/.claude/settings.json) и/или Codex (~/.codex/config.toml). Перед правкой делается резервная копия.
const { claudeEnv } = require('./clients');

const shq = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";

function sh(origin) {
  return `#!/bin/sh
# Premier API — подключение Claude Code и Codex одной командой.
#   curl -fsSL ${origin}/connect.sh | sh                 — спросит, что подключить
#   curl -fsSL ${origin}/connect.sh | sh -s -- codex     — claude-code | codex | both
set -u
BASE=${shq(origin)}
TOOL="\${1:-\${PREMIER_TOOL:-}}"
B=$(printf '\\033[1m'); D=$(printf '\\033[2m'); G=$(printf '\\033[32m'); R=$(printf '\\033[31m'); A=$(printf '\\033[33m'); N=$(printf '\\033[0m')
[ -t 1 ] || { B=; D=; G=; R=; A=; N=; }
say() { printf '%s\\n' "$*"; }
die() { printf '\\n  %s✗ %s%s\\n\\n' "$R" "$*" "$N" >&2; exit 1; }
command -v curl >/dev/null 2>&1 || die "Нужен curl"
ask() { ans=''; if [ -r /dev/tty ]; then printf '%s' "$1" > /dev/tty; read -r ans < /dev/tty || ans=''; fi; [ -n "$ans" ] || ans="$2"; printf '%s' "$ans"; }

say ""; say "  \${B}Premier API\${N} \${D}·\${N} \${D}$BASE\${N}"
if [ -z "$TOOL" ]; then
  say ""; say "  Что подключить?"; say "    1) Claude Code"; say "    2) Codex CLI"; say "    3) Оба"
  c=$(ask "  Номер [1]: " 1)
  case "$c" in 2) TOOL=codex ;; 3) TOOL=both ;; *) TOOL=claude-code ;; esac
fi
case "$TOOL" in claude|claude-code) TOOL=claude-code ;; codex|both) ;; *) die "Неизвестный инструмент: $TOOL (claude-code, codex, both)" ;; esac

OS=$(uname -s 2>/dev/null | tr -cd 'A-Za-z0-9._-' | cut -c1-20)
HOSTN=$(hostname 2>/dev/null | tr -cd 'A-Za-z0-9._-' | cut -c1-40)
post() { curl -sS --max-time 20 -X POST "$BASE$1?format=env" -H 'Content-Type: application/json' -d "$2" 2>/dev/null; }
val() { printf '%s\\n' "$RESP" | sed -n "s/^$1=//p" | head -n 1; }

RESP=$(post /api/connect/start "{\\"client\\":\\"$TOOL\\",\\"os\\":\\"$OS\\",\\"host\\":\\"$HOSTN\\"}") || die "Сервер $BASE не отвечает"
[ -n "$(val error)" ] && die "$(val error)"
CODE=$(val code); DEVICE=$(val device); URL=$(val url); INTERVAL=$(val interval)
[ -n "$CODE" ] && [ -n "$DEVICE" ] || die "Не удалось начать подключение. Попробуйте ещё раз."

say ""
say "  1. Откройте ссылку (войдите в Premier, если попросит):"
say "     \${B}$URL\${N}"
say "  2. Проверьте, что код совпадает, и нажмите «Подтвердить»:  \${A}\${B}$CODE\${N}"
if command -v open >/dev/null 2>&1 && [ "$(uname -s)" = Darwin ]; then open "$URL" >/dev/null 2>&1 || true
elif command -v wslview >/dev/null 2>&1; then wslview "$URL" >/dev/null 2>&1 || true
elif command -v xdg-open >/dev/null 2>&1 && [ -n "\${DISPLAY:-}\${WAYLAND_DISPLAY:-}" ]; then xdg-open "$URL" >/dev/null 2>&1 & fi
say ""; printf '  %sЖду подтверждения…%s' "$D" "$N"

i=0
while :; do
  sleep "\${INTERVAL:-2}"; i=$((i + 1)); [ "$i" -gt 300 ] && die "Время вышло. Запустите команду ещё раз."
  RESP=$(post /api/connect/poll "{\\"device\\":\\"$DEVICE\\"}") || continue
  case "$(val status)" in
    approved) break ;;
    pending|slow_down) ;;
    denied) printf '\\n'; die "Подключение отклонено в браузере." ;;
    *) printf '\\n'; die "Код устарел. Запустите команду ещё раз." ;;
  esac
done
printf '\\r  %s✓ Подтверждено%s          \\n' "$G" "$N"
KEY=$(val key); MODEL=$(val model); FAST=$(val fast); API=$(val base_url); NATIVE=$(val native)
[ -n "$KEY" ] || die "Сервер не выдал ключ."
[ -n "$MODEL" ] || die "На вашем тарифе нет моделей для API."
[ -n "$API" ] || API="$BASE"
STAMP=$(date +%Y%m%d-%H%M%S)

setup_claude() {
  dir="$HOME/.claude"; f="$dir/settings.json"; mkdir -p "$dir" || return 1
  [ -f "$f" ] && cp "$f" "$f.bak-$STAMP"
  export PREMIER_F="$f" PREMIER_API="$API" PREMIER_KEY="$KEY" PREMIER_MODEL="$MODEL" PREMIER_FAST="$FAST" PREMIER_NATIVE="$NATIVE"
  if command -v node >/dev/null 2>&1; then
    node -e '
const fs = require("fs"), e = process.env, f = e.PREMIER_F;
let s = {};
if (fs.existsSync(f)) { const t = fs.readFileSync(f, "utf8").replace(/^\\uFEFF/, ""); if (t.trim()) s = JSON.parse(t); }
const env = Object.assign({}, s.env, { ANTHROPIC_BASE_URL: e.PREMIER_API, ANTHROPIC_AUTH_TOKEN: e.PREMIER_KEY, ANTHROPIC_MODEL: e.PREMIER_MODEL,
  ANTHROPIC_DEFAULT_OPUS_MODEL: e.PREMIER_MODEL, ANTHROPIC_DEFAULT_SONNET_MODEL: e.PREMIER_MODEL, ANTHROPIC_DEFAULT_HAIKU_MODEL: e.PREMIER_FAST || e.PREMIER_MODEL });
if (e.PREMIER_NATIVE === "1") delete env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS; else env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = "1";
s.env = env;
fs.writeFileSync(f, JSON.stringify(s, null, 2) + "\\n");' || return 1
  elif command -v python3 >/dev/null 2>&1 && python3 -c 'import json' >/dev/null 2>&1; then
    python3 -c '
import json, os
e = os.environ; f = e["PREMIER_F"]; s = {}
if os.path.exists(f):
    t = open(f, encoding="utf-8-sig").read()
    if t.strip(): s = json.loads(t)
env = dict(s.get("env") or {})
env.update(ANTHROPIC_BASE_URL=e["PREMIER_API"], ANTHROPIC_AUTH_TOKEN=e["PREMIER_KEY"], ANTHROPIC_MODEL=e["PREMIER_MODEL"],
  ANTHROPIC_DEFAULT_OPUS_MODEL=e["PREMIER_MODEL"], ANTHROPIC_DEFAULT_SONNET_MODEL=e["PREMIER_MODEL"], ANTHROPIC_DEFAULT_HAIKU_MODEL=e.get("PREMIER_FAST") or e["PREMIER_MODEL"])
if e.get("PREMIER_NATIVE") == "1": env.pop("CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS", None)
else: env["CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS"] = "1"
s["env"] = env
open(f, "w", encoding="utf-8").write(json.dumps(s, indent=2, ensure_ascii=False) + "\\n")' || return 1
  elif [ ! -s "$f" ]; then
    betas=''; [ "$NATIVE" = 1 ] || betas=',
    "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS": "1"'
    printf '{\\n  "env": {\\n    "ANTHROPIC_BASE_URL": "%s",\\n    "ANTHROPIC_AUTH_TOKEN": "%s",\\n    "ANTHROPIC_MODEL": "%s",\\n    "ANTHROPIC_DEFAULT_OPUS_MODEL": "%s",\\n    "ANTHROPIC_DEFAULT_SONNET_MODEL": "%s",\\n    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "%s"%s\\n  }\\n}\\n' "$API" "$KEY" "$MODEL" "$MODEL" "$MODEL" "\${FAST:-$MODEL}" "$betas" > "$f" || return 1
  else return 1; fi
  say "  \${G}✓\${N} Claude Code: $f"
}

setup_codex() {
  dir="\${CODEX_HOME:-$HOME/.codex}"; f="$dir/config.toml"; mkdir -p "$dir" || return 1
  tmp="$f.premier-tmp"; : > "$tmp" || return 1
  if [ -f "$f" ]; then
    cp "$f" "$f.bak-$STAMP"
    # убираем прежние настройки Premier и строки model/model_provider/profile до первой [таблицы]
    awk '
      /^# >>> premier/ { skip = 1; next }
      /^# <<< premier/ { skip = 0; next }
      skip { next }
      /^[ \\t]*\\[/ { top = 1; tbl = ($0 ~ /^[ \\t]*\\[model_providers\\.premier\\][ \\t]*$/) ; if (tbl) next }
      tbl { next }
      !top && /^[ \\t]*(model|model_provider|profile)[ \\t]*=/ { print "# (до Premier) " $0; next }
      { print }
    ' "$f" > "$tmp" || return 1
  fi
  {
    printf '# >>> premier\\nmodel = "%s"\\nmodel_provider = "premier"\\n# <<< premier\\n\\n' "$MODEL"
    cat "$tmp"
    printf '\\n# >>> premier provider\\n[model_providers.premier]\\nname = "Premier"\\nbase_url = "%s/v1"\\nwire_api = "responses"\\nhttp_headers = { "Authorization" = "Bearer %s" }\\n# <<< premier provider\\n' "$API" "$KEY"
  } > "$f.premier-new" && mv "$f.premier-new" "$f" && rm -f "$tmp" || return 1
  chmod 600 "$f" 2>/dev/null || true
  say "  \${G}✓\${N} Codex: $f"
}

say ""
case "$TOOL" in claude-code|both) setup_claude || die "Не удалось записать ~/.claude/settings.json — настройте вручную в кабинете: $BASE/developers#connect/claude-code" ;; esac
case "$TOOL" in codex|both) setup_codex || die "Не удалось записать ~/.codex/config.toml — настройте вручную в кабинете: $BASE/developers#connect/codex" ;; esac

CHECK=$(curl -sS --max-time 20 -o /dev/null -w '%{http_code}' "$API/v1/models" -H "Authorization: Bearer $KEY" -H "x-client-name: $TOOL" 2>/dev/null)
[ "$CHECK" = 200 ] && say "  \${G}✓\${N} Ключ работает, модель: \${B}$MODEL\${N}" || say "  \${A}!\${N} Проверка ключа вернула код \${CHECK:-—}. Посмотрите «Журнал» в кабинете."
say ""
case "$TOOL" in
  claude-code) say "  Готово. Запустите \${B}claude\${N} в папке проекта." ;;
  codex) say "  Готово. Запустите \${B}codex\${N} в папке проекта." ;;
  both) say "  Готово. Запустите \${B}claude\${N} или \${B}codex\${N} в папке проекта." ;;
esac
say "  \${D}Модель и ключи — в кабинете: $BASE/developers\${N}"; say ""
`;
}

function ps1(origin) {
  return `# Premier API — подключение Claude Code и Codex одной командой (Windows PowerShell 5.1+ / PowerShell 7).
#   irm ${origin}/connect.ps1 | iex
#   $env:PREMIER_TOOL='codex'; irm ${origin}/connect.ps1 | iex     — claude-code | codex | both
& {
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$Base = '${origin.replace(/'/g, "''")}'
$Utf8 = New-Object System.Text.UTF8Encoding $false
function Fail($m) { Write-Host ""; Write-Host "  x $m" -ForegroundColor Red; Write-Host ""; throw $m }
Write-Host ""; Write-Host "  Premier API  $Base" -ForegroundColor White
$Tool = "$env:PREMIER_TOOL"
if (-not $Tool) {
  Write-Host ""; Write-Host "  Что подключить?"; Write-Host "    1) Claude Code"; Write-Host "    2) Codex CLI"; Write-Host "    3) Оба"
  $c = Read-Host "  Номер [1]"
  $Tool = switch ($c) { '2' { 'codex' } '3' { 'both' } default { 'claude-code' } }
}
if ($Tool -eq 'claude') { $Tool = 'claude-code' }
if (@('claude-code', 'codex', 'both') -notcontains $Tool) { Fail "Неизвестный инструмент: $Tool (claude-code, codex, both)" }
$HostName = ("$env:COMPUTERNAME" -replace '[^A-Za-z0-9._-]', '')
if ($HostName.Length -gt 40) { $HostName = $HostName.Substring(0, 40) }
function Post($path, $body) { Invoke-RestMethod -Method Post -Uri "$Base$path" -ContentType 'application/json' -Body ($body | ConvertTo-Json -Compress) -TimeoutSec 20 }
try { $s = Post '/api/connect/start' @{ client = $Tool; os = 'Windows'; host = $HostName } } catch { Fail "Сервер $Base не отвечает: $($_.Exception.Message)" }
if ($s.error) { Fail $s.error }
Write-Host ""
Write-Host "  1. Откройте ссылку (войдите в Premier, если попросит):"
Write-Host "     $($s.url)" -ForegroundColor White
Write-Host -NoNewline "  2. Проверьте, что код совпадает, и нажмите «Подтвердить»:  "; Write-Host $s.code -ForegroundColor Yellow
try { Start-Process $s.url } catch {}
Write-Host ""; Write-Host -NoNewline "  Жду подтверждения..." -ForegroundColor DarkGray
$r = $null
for ($i = 0; $i -lt 300; $i++) {
  Start-Sleep -Seconds ([int]$s.interval)
  try { $r = Post '/api/connect/poll' @{ device = $s.device } } catch { continue }
  if ($r.status -eq 'approved') { break }
  if ($r.status -eq 'denied') { Fail 'Подключение отклонено в браузере.' }
  if ($r.status -ne 'pending' -and $r.status -ne 'slow_down') { Fail 'Код устарел. Запустите команду ещё раз.' }
}
if (-not $r -or $r.status -ne 'approved') { Fail 'Время вышло. Запустите команду ещё раз.' }
Write-Host ""; Write-Host "  + Подтверждено" -ForegroundColor Green
$Key = $r.key; $Model = $r.model; $Fast = if ($r.fast) { $r.fast } else { $r.model }; $Api = if ($r.base_url) { $r.base_url } else { $Base }
if (-not $Model) { Fail 'На вашем тарифе нет моделей для API.' }
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

if ($Tool -eq 'claude-code' -or $Tool -eq 'both') {
  $dir = Join-Path $HOME '.claude'; $f = Join-Path $dir 'settings.json'
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $cfg = New-Object PSObject
  if (Test-Path $f) { Copy-Item $f "$f.bak-$Stamp"; $t = [IO.File]::ReadAllText($f).TrimStart([char]0xFEFF); if ($t.Trim()) { $cfg = $t | ConvertFrom-Json } }
  if (-not ($cfg.PSObject.Properties.Name -contains 'env') -or -not $cfg.env) { $cfg | Add-Member -NotePropertyName env -NotePropertyValue (New-Object PSObject) -Force }
  $vals = [ordered]@{ ANTHROPIC_BASE_URL = $Api; ANTHROPIC_AUTH_TOKEN = $Key; ANTHROPIC_MODEL = $Model; ANTHROPIC_DEFAULT_OPUS_MODEL = $Model; ANTHROPIC_DEFAULT_SONNET_MODEL = $Model; ANTHROPIC_DEFAULT_HAIKU_MODEL = $Fast }
  if ($r.native -ne '1') { $vals['CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS'] = '1' } elseif ($cfg.env.PSObject.Properties.Name -contains 'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS') { $cfg.env.PSObject.Properties.Remove('CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS') }
  foreach ($k in $vals.Keys) { $cfg.env | Add-Member -NotePropertyName $k -NotePropertyValue $vals[$k] -Force }
  [IO.File]::WriteAllText($f, ($cfg | ConvertTo-Json -Depth 32), $Utf8)
  Write-Host "  + Claude Code: $f" -ForegroundColor Green
}

if ($Tool -eq 'codex' -or $Tool -eq 'both') {
  $dir = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME '.codex' }; $f = Join-Path $dir 'config.toml'
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $out = New-Object System.Collections.Generic.List[string]
  if (Test-Path $f) {
    Copy-Item $f "$f.bak-$Stamp"
    $skip = $false; $top = $true; $tbl = $false
    foreach ($line in [IO.File]::ReadAllLines($f)) {
      if ($line -match '^# >>> premier') { $skip = $true; continue }
      if ($line -match '^# <<< premier') { $skip = $false; continue }
      if ($skip) { continue }
      if ($line -match '^\\s*\\[') { $top = $false; $tbl = $line -match '^\\s*\\[model_providers\\.premier\\]\\s*$'; if ($tbl) { continue } }
      if ($tbl) { continue }
      if ($top -and $line -match '^\\s*(model|model_provider|profile)\\s*=') { $out.Add("# (до Premier) $line"); continue }
      $out.Add($line)
    }
  }
  $head = @('# >>> premier', "model = \`"$Model\`"", 'model_provider = "premier"', '# <<< premier', '')
  $tail = @('', '# >>> premier provider', '[model_providers.premier]', 'name = "Premier"', "base_url = \`"$Api/v1\`"", 'wire_api = "responses"', "http_headers = { \`"Authorization\`" = \`"Bearer $Key\`" }", '# <<< premier provider')
  [IO.File]::WriteAllText($f, (($head + $out + $tail) -join "\`n") + "\`n", $Utf8)
  Write-Host "  + Codex: $f" -ForegroundColor Green
}

try { Invoke-RestMethod -Uri "$Api/v1/models" -Headers @{ Authorization = "Bearer $Key"; 'x-client-name' = $Tool } -TimeoutSec 20 | Out-Null; Write-Host "  + Ключ работает, модель: $Model" -ForegroundColor Green }
catch { Write-Host "  ! Проверка ключа не прошла: $($_.Exception.Message). Посмотрите «Журнал» в кабинете." -ForegroundColor Yellow }
Write-Host ""
switch ($Tool) { 'claude-code' { Write-Host '  Готово. Запустите claude в папке проекта.' } 'codex' { Write-Host '  Готово. Запустите codex в папке проекта.' } default { Write-Host '  Готово. Запустите claude или codex в папке проекта.' } }
Write-Host "  Модель и ключи — в кабинете: $Base/developers" -ForegroundColor DarkGray; Write-Host ""
}
`;
}

module.exports = { sh, ps1, claudeEnv };
