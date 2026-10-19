// Скриншот WebGL-страницы в headless Chrome (SwiftShader, без GPU) + вывод консоли страницы.
//   node tools/shot.mjs --url sandbox/out/x.html --out ../.hoplite/artifacts/x.png
//        [--size 1280x720] [--ready "window.__ready===true"] [--wait 1000] [--eval "js"] [--after 500]
//        [--plan plan.json]   plan: [{ "eval": "js", "after": 800, "out": "a.png" }, ...] — несколько кадров за один запуск
import { chromium } from 'playwright-core';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir, readFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
let url = opt('url', 'dist/index.html');
if (!/^(https?|file):/.test(url)) url = pathToFileURL(resolve(url)).href;
const [w, h] = opt('size', '1280x720').split('x').map(Number);
const timeout = +opt('timeout', '120000');
const ready = opt('ready', 'window.__ready === true');
const planFile = opt('plan');
const plan = planFile ? JSON.parse(await readFile(planFile, 'utf8'))
  : [{ eval: opt('eval'), after: +opt('after', '500'), out: opt('out', 'shots/shot.png') }];

const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/usr/local/bin/google-chrome',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
    '--enable-webgl', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: w, height: h } });
const logs = [];
const live = args.includes('--live');
const log = (s) => { logs.push(s); if (live) console.log(s); };
page.on('console', (m) => log(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => log(`[pageerror] ${e.message}\n${e.stack || ''}`));
page.on('crash', () => log('[crash] page crashed'));
const t0 = Date.now();
await page.goto(url, { waitUntil: 'load', timeout });
try { await page.waitForFunction(ready, null, { timeout, polling: 250 }); }
catch { logs.push(`[shot] ready timeout (${ready})`); }
await page.waitForTimeout(+opt('wait', '800'));
for (const step of plan) {
  if (step.eval) {
    try { const r = await page.evaluate(step.eval); if (r !== undefined) logs.push('[eval] ' + JSON.stringify(r)); }
    catch (e) { logs.push('[eval error] ' + e.message); }
  }
  await page.waitForTimeout(step.after ?? 500);
  if (step.out) {
    await mkdir(dirname(resolve(step.out)), { recursive: true });
    try { await page.screenshot({ path: step.out, timeout: 60000 }); }
    catch (e) { logs.push('[shot error] ' + e.message.split('\n')[0]); break; }
    logs.push(`[shot] saved ${step.out} @ ${Date.now() - t0} ms`);
  }
}
console.log(logs.join('\n'));
await browser.close();
