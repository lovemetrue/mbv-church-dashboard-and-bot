// Снимки экранов на фикстурах: собирает приложение с VITE_FIXTURES=1 во временный каталог,
// раздаёт его статическим сервером и снимает Chromium (playwright-core, браузер уже установлен
// на машине: НЕ скачиваем). Заодно проверяет, что на 400 px страница не ползёт вбок.
//
//   npm run shots -- <каталог для PNG>        (по умолчанию ./shots)
//   HG_CHROMIUM=/путь/к/chrome npm run shots   (если браузер лежит в другом месте)
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(process.argv[2] ?? join(root, 'shots'));
const chromePath = process.env.HG_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
mkdirSync(outDir, { recursive: true });

const dist = mkdtempSync(join(tmpdir(), 'hg-shots-'));
console.log('Сборка с фикстурами…');
execFileSync(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', dist, '--emptyOutDir'], {
  cwd: root,
  env: { ...process.env, VITE_FIXTURES: '1', VITE_BASE: '/' },
  stdio: ['ignore', 'ignore', 'inherit'],
});

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};
const server = createServer((req, res) => {
  const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
  let file = join(dist, path);
  if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) file = join(dist, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const origin = `http://127.0.0.1:${server.address().port}`;

// Экраны. req=1 — спокойная заявка с полным планом, 17 — с «вытесненным» вариантом,
// 11 — без плана (нет группы в районе), 19 — слабый план.
const SCREENS = [
  { name: 'today', url: '/', ready: 'text=Спрос и предложение по районам' },
  { name: 'requests', url: '/?tab=requests&req=1', ready: '[role=dialog][aria-label^="Карточка заявки"]' },
  { name: 'requests-displaced', url: '/?tab=requests&req=17', ready: '[role=dialog][aria-label^="Карточка заявки"]' },
  { name: 'requests-noplan', url: '/?tab=requests&bucket=human&req=11', ready: '[role=dialog][aria-label^="Карточка заявки"]' },
  { name: 'requests-weak', url: '/?tab=requests&bucket=human&req=19', ready: '[role=dialog][aria-label^="Карточка заявки"]' },
  { name: 'requests-list', url: '/?tab=requests', ready: 'ul[aria-label="Список заявок"]' },
  { name: 'reference-groups', url: '/?tab=reference&rec=1', ready: '[role=dialog][aria-label^="Карточка группы"]' },
  { name: 'reference-groups-table', url: '/?tab=reference', ready: 'table' },
  { name: 'reference-people', url: '/?tab=reference&ent=people', ready: 'table' },
  { name: 'reference-coordinators', url: '/?tab=reference&ent=coordinators&rec=1', ready: '[role=dialog][aria-label^="Карточка координатора"]' },
  { name: 'reference-filters-open', url: '/?tab=reference', ready: 'table', click: 'button:has-text("Фильтры")' },
  { name: 'reference-view-open', url: '/?tab=reference', ready: 'table', click: 'button:has-text("Вид таблицы")' },
  { name: 'reference-filtered', url: '/?tab=reference&f=Район:eq:Приморский&gb=Статус&col=№&col=Ведущий&col=Район&col=Статус&col=Здоровье', ready: 'table' },
];

const SHOTS = [
  // [экран, ширина, тема]
  ...['today', 'requests', 'reference-groups', 'reference-people'].map((s) => [s, 1280, 'light']),
  ['today', 1280, 'dark'],
  ['today', 1280, 'gray'],
  ['requests', 1280, 'gray'],
  ['reference-groups', 1280, 'dark'],
  ['requests-list', 1280, 'light'],
  ['requests-displaced', 1280, 'light'],
  ['requests-noplan', 1280, 'light'],
  ['requests-weak', 1280, 'light'],
  ['reference-groups-table', 1280, 'light'],
  ['reference-coordinators', 1280, 'light'],
  ['reference-filtered', 1280, 'light'],
  ['reference-filters-open', 1280, 'light'],
  ['reference-view-open', 1280, 'light'],
  ['reference-filters-open', 400, 'light'],
  ...['today', 'requests', 'requests-list', 'reference-groups', 'reference-groups-table', 'reference-people', 'reference-coordinators', 'reference-filtered', 'requests-noplan'].map((s) => [s, 400, 'light']),
  ['today', 400, 'dark'],
  ['today', 400, 'gray'],
];

const browser = await chromium.launch({ executablePath: chromePath, args: ['--no-sandbox'] });
const problems = [];

/** Элементы, которые вылезают за правый край окна и не лежат внутри прокручиваемого блока. */
const findOverflowing = () => {
  const vw = document.documentElement.clientWidth;
  const bad = [];
  const scrollers = (el) => {
    for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX;
      if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') return true;
    }
    return false;
  };
  for (const el of document.body.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    if (r.right > vw + 1 && !scrollers(el)) bad.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} right=${Math.round(r.right)}`);
  }
  return { vw, scrollWidth: document.documentElement.scrollWidth, bad: bad.slice(0, 5) };
};

for (const [screenName, width, theme] of SHOTS) {
  const screen = SCREENS.find((s) => s.name === screenName);
  const mobile = width < 700;
  const ctx = await browser.newContext({
    viewport: { width, height: mobile ? 800 : 900 },
    deviceScaleFactor: mobile ? 2 : 1,
    isMobile: mobile,
    hasTouch: mobile,
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    colorScheme: theme === 'dark' ? 'dark' : 'light',
    reducedMotion: 'reduce',
  });
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem('hg.theme', t);
    } catch {}
  }, theme === 'dark' ? 'auto' : theme);
  const page = await ctx.newPage();
  // Фиксируем время, чтобы приветствие и дата на снимках не гуляли.
  await page.clock.setFixedTime(new Date('2026-10-09T09:30:00+03:00'));
  page.on('pageerror', (e) => problems.push(`${screenName}/${width}: ошибка страницы: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`${screenName}/${width}: console.error: ${m.text()}`));
  page.on('request', (r) => !r.url().startsWith(origin) && !r.url().startsWith('data:') && problems.push(`${screenName}: внешний запрос ${r.url()}`));
  await page.goto(origin + screen.url);
  await page.waitForSelector(screen.ready, { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  if (screen.click) await page.click(screen.click);
  await page.waitForTimeout(150);

  if (mobile) {
    // Страховку overflow-x: clip на время проверки снимаем: иначе она прятала бы настоящее переполнение.
    await page.addStyleTag({ content: 'html,body{overflow-x:visible !important}' });
    const r = await page.evaluate(findOverflowing);
    const tag = `${screenName}/${width}/${theme}`;
    if (r.scrollWidth > r.vw || r.bad.length) problems.push(`${tag}: горизонтальная прокрутка (scrollWidth=${r.scrollWidth} > ${r.vw}) ${r.bad.join('; ')}`);
    else console.log(`ок: ${tag} без горизонтальной прокрутки (scrollWidth=${r.scrollWidth}, окно=${r.vw})`);
  }
  const file = join(outDir, `${screenName}-${width}-${theme}.png`);
  await page.screenshot({ path: file, fullPage: false });
  await ctx.close();
}

await browser.close();
server.close();
rmSync(dist, { recursive: true, force: true });
if (problems.length) {
  console.error('\nПроблемы:\n' + problems.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`\nГотово: ${SHOTS.length} снимков в ${outDir}`);
}
