// Сборка: esbuild склеивает модули в один IIFE и вклеивает его в HTML.
// Итог — самодостаточный файл без внешних запросов, открывается двойным кликом (file://).
//   node build.mjs                       → dist/index.html (игра)
//   node build.mjs --entry sandbox/x.js --out sandbox/out/x.html --dev   → тестовая сцена
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const flag = (name) => args.includes('--' + name);

const entry = opt('entry', 'src/main.js');
const out = opt('out', 'dist/index.html');
const template = opt('template', entry === 'src/main.js' ? 'src/index.html' : 'tools/sandbox.html');

const t0 = Date.now();
const result = await build({
  entryPoints: [entry], bundle: true, format: 'iife', write: false,
  minify: !flag('dev'), target: ['es2020'], legalComments: 'none', logLevel: 'warning',
  define: { 'process.env.NODE_ENV': '"production"' },
});
// </script внутри строк бандла закрыл бы инлайн-тег
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
let html = await readFile(template, 'utf8');
html = html.replace('<!--APP-->', () => `<script>\n${js}\n</script>`);
await mkdir(dirname(resolve(out)), { recursive: true });
await writeFile(out, html);
console.log(`built ${out} — ${(html.length / 1024).toFixed(0)} KB in ${Date.now() - t0} ms`);
