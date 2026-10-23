#!/usr/bin/env python3
"""Генерирует слой темы «Бумага и янтарь» для страниц со старыми тёмными стилями.

Берёт встроенные <style> страницы (и/или внешние .css), находит правила с
жёстко заданными цветами и выпускает те же селекторы, где цвета заменены на
токены из public/tokens.css. Раскладка не трогается. Ручные правки — в
public/theme/app.css, он подключается после сгенерированного файла.

Запуск: python3 scripts/build-theme.py  (после правок стилей в chat.html и др.)
"""
import colorsys, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / 'public'
OUT = PUBLIC / 'theme'
# страница → (источники стилей, имя выходного файла)
TARGETS = {
    'chat': (['chat.html'], 'chat.gen.css'),
    'login': (['login.html'], 'login.gen.css'),
    'language': (['language.css'], 'language.gen.css'),
    'panel': (['panel.html'], 'panel.gen.css'),
}

COLOR = re.compile(r'#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3,4}\b|rgba?\([^)]*\)|\b(?:white|black)\b')
ACCENT_BG = re.compile(r'var\(--accent(?:-h)?\)|#2f6fe4|#3b7bf0|rgb\(47,\s*111,\s*228\)', re.I)


def parse(c):
    c = c.strip().lower()
    if c == 'white': return 255, 255, 255, 1.0
    if c == 'black': return 0, 0, 0, 1.0
    if c.startswith('#'):
        h = c[1:]
        if len(h) in (3, 4): h = ''.join(ch * 2 for ch in h)
        r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
        a = int(h[6:8], 16) / 255 if len(h) == 8 else 1.0
        return r, g, b, a
    nums = re.findall(r'[\d.]+%?', c)
    if len(nums) < 3: return None
    r, g, b = (float(n[:-1]) * 2.55 if n.endswith('%') else float(n) for n in nums[:3])
    a = 1.0
    if len(nums) > 3: a = float(nums[3][:-1]) / 100 if nums[3].endswith('%') else float(nums[3])
    return r, g, b, a


def pct(a):
    return f'{round(a * 100, 1):g}%'


def mix(var, a):
    return f'color-mix(in srgb,var({var}) {pct(a)},transparent)'


def tint(var, base='--p-surface', k=.14):
    return f'color-mix(in srgb,var({var}) {pct(k)},var({base}))'


def convert(raw, prop, rule_has_accent_bg, invert=False):
    p = parse(raw)
    if not p: return raw
    r, g, b, a = p
    h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    hue = h * 360
    textual = prop in ('color', 'caret-color', '-webkit-text-fill-color', 'fill') or prop.endswith('-color') and prop.startswith('text-decoration')
    shadow = 'shadow' in prop
    if s < .14 or l > .96 or l < .03:  # нейтральные
        if invert and a == 1:  # «выбранный» элемент: светлый фон + тёмный текст → инверсия темы
            if l > .8: return 'var(--p-on-accent)' if textual and rule_has_accent_bg else ('var(--p-text)' if not textual else 'var(--p-bg)')
            if l < .2: return 'var(--p-bg)' if textual else 'var(--p-text)'
        if l > .8:
            if a < 1: return mix('--p-text', a)
            if textual: return 'var(--p-on-accent)' if rule_has_accent_bg else 'var(--p-text)'
            if prop.startswith('border') or prop.startswith('outline'): return 'var(--p-line-2)'
            return raw  # белый фон превью/холста остаётся белым
        if l > .45:
            if textual: return 'var(--p-muted)' if l > .6 else 'var(--p-dim)'
            if a < 1: return mix('--p-text', a * .7)
            return 'var(--p-line-2)'
        if a < 1:  # тени, затемнения
            # полупрозрачный цвет страницы (липкие шапки) ≠ затемнение под модалкой (чистый чёрный)
            if not shadow and not textual and a >= .6 and r + g + b > 0: return mix('--p-bg', a)
            if shadow: return f'color-mix(in srgb,var(--p-shadow-c) calc({pct(a)} * var(--p-shadow-k)),transparent)'
            return f'color-mix(in srgb,var(--p-scrim-c) {pct(a)},transparent)'
        if textual: return 'var(--p-text)'
        if prop.startswith('border') or prop.startswith('outline') or prop.startswith('--line'): return 'var(--p-line-2)'
        if l <= .045: return 'var(--p-sunken)'
        if l <= .085: return 'var(--p-bg)'
        if l <= .135: return 'var(--p-surface)'
        if l <= .2: return 'var(--p-surface-2)'
        return 'var(--p-line-2)'
    # цветные
    if 190 <= hue < 255: var, ink = '--p-accent', '--p-accent-ink'
    elif 75 <= hue < 175: var, ink = '--p-ok', '--p-ok'
    elif 18 <= hue < 62: var, ink = '--p-warn', '--p-warn'
    elif hue >= 340 or hue < 18: var, ink = '--p-bad', '--p-bad'
    else: return raw  # фиолетовые/розовые декоративные цвета оставляем
    if a < 1: return mix(var, a)
    if l < .26:  # тёмная подложка в цвет: лёгкий тон на поверхности
        return f'color-mix(in srgb,var({ink}) 55%,var(--p-line-2))' if prop.startswith('border') else tint(var)
    if textual: return f'var({ink})' if l >= .5 else f'var({var})'
    return f'var({var})'


def fonts(v):
    lv = v.lower()
    if 'monospace' in lv or 'menlo' in lv or 'consolas' in lv: return 'var(--p-font-mono)'
    if 'onest' in lv or '-apple-system' in lv or 'segoe ui' in lv or 'sans-serif' in lv: return 'var(--p-font)'
    return v


def split_decls(body):
    out, depth, cur = [], 0, ''
    for ch in body:
        if ch == '(': depth += 1
        elif ch == ')': depth -= 1
        if ch == ';' and depth == 0: out.append(cur); cur = ''
        else: cur += ch
    if cur.strip(): out.append(cur)
    return [d.strip() for d in out if d.strip() and ':' in d]


def theme_rule(sel, body):
    decls = split_decls(body)
    has_accent = any(d.split(':', 1)[0].strip().startswith('background') and ACCENT_BG.search(d) for d in decls)
    def lum(d):
        p = parse(COLOR.search(d).group(0)) if COLOR.search(d) else None
        return None if not p or p[3] < 1 else colorsys.rgb_to_hls(p[0] / 255, p[1] / 255, p[2] / 255)
    def solid(prefix):
        for d in decls:
            k, v = (x.strip().lower() for x in d.split(':', 1))
            if (k == prefix or k == prefix + '-color') and 'gradient' not in v:
                h = lum(d)
                if h and h[2] < .14: return h[1]
        return None
    bg_l, fg_l = solid('background'), solid('color')
    invert = bg_l is not None and fg_l is not None and bg_l > .8 and fg_l < .2
    res = []
    for d in decls:
        prop, val = (x.strip() for x in d.split(':', 1))
        lp = prop.lower()
        if lp == 'content' or lp.startswith('-webkit-mask') or lp.startswith('mask') or lp == 'src': continue
        if lp in ('font', 'font-family'):
            if lp == 'font':
                m = re.match(r'(.*?\d[\w.%/]*\s+)([^;]+)$', val)
                if not m: continue
                nv = m.group(1) + fonts(m.group(2))
            else: nv = fonts(val)
            if nv != val: res.append(f'{prop}:{nv}')
            continue
        if 'url(' in val: continue
        nv = COLOR.sub(lambda m: convert(m.group(0), lp, has_accent, invert), val)
        if nv != val: res.append(f'{prop}:{nv}')
    # сокращённое background сбрасывает background-clip и прочие подсвойства — возвращаем их
    if any(r.split(':', 1)[0].strip().lower() == 'background' for r in res):
        res += [d for d in decls if re.match(r'(-webkit-)?background-(clip|size|position|repeat|origin|attachment)\s*:', d, re.I)]
    return f'{sel}{{{";".join(res)}}}' if res else ''


def walk(css):
    out, i, n = [], 0, len(css)
    while i < n:
        j = css.find('{', i)
        if j < 0: break
        sel = css[i:j].strip()
        depth, k = 1, j + 1
        while depth and k < n:
            if css[k] == '{': depth += 1
            elif css[k] == '}': depth -= 1
            k += 1
        body = css[j + 1:k - 1]
        if sel.startswith('@media') or sel.startswith('@supports') or sel.startswith('@container'):
            inner = walk(body)
            if inner: out.append(sel + '{\n' + '\n'.join(inner) + '\n}')
        elif sel.startswith('@keyframes') or sel.startswith('@-webkit-keyframes'):
            # кадры переопределяются целиком: последний @keyframes с тем же именем побеждает
            nb = re.sub(r'([\w-]+)\s*:([^;{}]+)', lambda m: m.group(1) + ':' + COLOR.sub(lambda c: convert(c.group(0), m.group(1).lower(), False), m.group(2)), body)
            if nb != body: out.append(sel + '{' + nb + '}')
        elif sel.startswith('@font-face') or sel.startswith('@import') or sel.startswith('@charset'):
            pass
        else:
            r = theme_rule(sel, body)
            if r: out.append(r)
        i = k
    return out


def sources(names):
    css = []
    for name in names:
        text = (PUBLIC / name).read_text()
        css.append('\n'.join(re.findall(r'<style[^>]*>(.*?)</style>', text, re.S)) if name.endswith('.html') else text)
    return re.sub(r'/\*.*?\*/', '', '\n'.join(css), flags=re.S)


def main():
    OUT.mkdir(exist_ok=True)
    for key, (names, out) in TARGETS.items():
        rules = walk(sources(names))
        head = f'/* Сгенерировано scripts/build-theme.py из {", ".join(names)} — не править вручную. */\n'
        (OUT / out).write_text(head + '\n'.join(rules) + '\n')
        print(f'{out}: {len(rules)} rules')


if __name__ == '__main__':
    main()
