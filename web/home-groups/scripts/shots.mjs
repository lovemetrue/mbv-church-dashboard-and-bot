// Снимки экранов на фикстурах: собирает приложение с VITE_FIXTURES=1 во временный каталог,
// раздаёт его статическим сервером и снимает Chromium (playwright-core, браузер уже установлен
// на машине: НЕ скачиваем). Заодно проверяет, что на 400 px страница не ползёт вбок.
//
//   npm run shots -- <каталог для PNG>        (по умолчанию ./shots)
//   HG_CHROMIUM=/путь/к/chrome npm run shots   (если браузер лежит в другом месте)
//   npm run shots:guide                        снимки для инструкции координаторам (docs/инструкция-координатора/):
//                                              только экраны GUIDE_SHOTS, с красными рамками и номерами «куда нажать»
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUIDE = process.argv.includes('--guide');
const outArg = process.argv.slice(2).find((a) => !a.startsWith('--'));
const outDir = resolve(outArg ?? (GUIDE ? join(root, '../../docs/инструкция-координатора') : join(root, 'shots')));
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
// QR регистрации в режиме фикстур отдаёт «сервер» — здесь его заменяет белый пиксель: до проверки вёрстки
// картинка нужна лишь как место, и лишнего запроса на несуществующий файл (и ошибки в консоли) быть не должно.
const QR_STUB = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4//8/AwAI/AL+XJ/P7wAAAABJRU5ErkJggg==', 'base64');
const server = createServer((req, res) => {
  const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
  if (/^\/api\/v1\/people\/\d+\/qr$/.test(path)) {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(QR_STUB);
    return;
  }
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
  // «Пульт»: таблица, виджеты и панель клетки (click2 — второй клик, например по вкладке панели).
  { name: 'today-pult', url: '/', ready: 'button[aria-label^="Приморский, 26–35:"]', full: true },
  { name: 'today-drawer-requests', url: '/', ready: 'button[aria-label^="Приморский, 26–35:"]', click: 'button[aria-label^="Приморский, 26–35:"]', then: '[role=dialog][aria-label^="Клетка таблицы"] [role=tabpanel] button' },
  { name: 'today-drawer-groups', url: '/', ready: 'button[aria-label^="Приморский, 26–35:"]', click: 'button[aria-label^="Приморский, 26–35:"]', click2: '[role=tab]:has-text("Группы")', then: '[role=dialog][aria-label^="Клетка таблицы"] [role=tabpanel] button[data-group]' },
  { name: 'requests', url: '/?tab=requests&req=1', ready: '[role=dialog][aria-label^="Карточка заявки"]' },
  { name: 'requests-displaced', url: '/?tab=requests&req=17', ready: '[role=dialog][aria-label^="Карточка заявки"]' },
  { name: 'requests-noplan', url: '/?tab=requests&bucket=human&req=11', ready: '[role=dialog][aria-label^="Карточка заявки"]' },
  { name: 'requests-weak', url: '/?tab=requests&bucket=human&req=19', ready: '[role=dialog][aria-label^="Карточка заявки"]' },
  // Окна действий координатора: выбор другой группы и причина отказа (кнопки в карточке заявки 1).
  { name: 'requests-pick', url: '/?tab=requests&req=1', ready: '[role=dialog][aria-label^="Карточка заявки"]', click: 'button[aria-label="Выбрать другую группу из списка"]' },
  // Запасные варианты с кнопкой «Утвердить эту группу»; scroll — прокрутить панель к нужному месту.
  { name: 'requests-alternatives', url: '/?tab=requests&req=7', ready: '[role=dialog][aria-label^="Карточка заявки"]', scroll: 'text=Другие варианты' },
  { name: 'requests-params-edit', url: '/?tab=requests&req=4', ready: '[role=dialog][aria-label^="Карточка заявки"]', click: 'button[aria-label="Изменить удобные день и время"]', scroll: 'input[placeholder^="например: пн"]' },
  // Рабочее место координатора: связь, «в работе у», итог звонка и форма «Править данные» (заявка 1 с планом).
  { name: 'requests-work', url: '/?tab=requests&req=1', ready: '[role=dialog][aria-label^="Карточка заявки"]', scroll: 'text=Связаться' },
  { name: 'requests-work-edit', url: '/?tab=requests&req=1', ready: '[role=dialog][aria-label^="Карточка заявки"]', click: 'button:has-text("Править данные")', then: 'form[aria-label="Правка данных заявки"]', scroll: 'form[aria-label="Правка данных заявки"] button[type=submit]' },
  // Закрытие заявки: окно с выбором исхода и с причинами аннулирования; «Другие обращения»: список, карточки, возврат в работу.
  { name: 'requests-close', url: '/?tab=requests&req=1', ready: '[role=dialog][aria-label^="Карточка заявки"]', click: 'button:has-text("Закрыть заявку…")', then: '[role=dialog][aria-modal=true]' },
  { name: 'requests-close-cancel', url: '/?tab=requests&req=1', ready: '[role=dialog][aria-label^="Карточка заявки"]', click: ['button:has-text("Закрыть заявку…")', 'label:has-text("Аннулировать")', 'label:has-text("Другое")'], then: '[role=dialog][aria-modal=true] textarea' },
  { name: 'others-list', url: '/?tab=requests&view=others', ready: 'ul[aria-label="Список обращений"]' },
  { name: 'others-list-all', url: '/?tab=requests&view=others&ostate=all', ready: 'ul[aria-label="Список обращений"]' },
  { name: 'others-card', url: '/?tab=requests&view=others&req=202', ready: '[role=dialog][aria-label^="Карточка обращения"]' },
  // Разбор «других обращений»: готово к разбору, нужен выбор, группа не найдена; массовая кнопка и её окно; ведущий, связанный с регистрацией.
  { name: 'others-reconcile-ready', url: '/?tab=requests&view=others&req=206', ready: '[role=dialog][aria-label^="Карточка обращения"]' },
  { name: 'others-reconcile-choose', url: '/?tab=requests&view=others&req=208', ready: '[role=dialog][aria-label^="Карточка обращения"]' },
  { name: 'others-reconcile-none', url: '/?tab=requests&view=others&req=209', ready: '[role=dialog][aria-label^="Карточка обращения"]', then: '[role=dialog] select' },
  { name: 'others-reconcile-ready-chip', url: '/?tab=requests&view=others&orec=ready', ready: 'ul[aria-label="Список обращений"]' },
  { name: 'others-ready-confirm', url: '/?tab=requests&view=others', ready: 'ul[aria-label="Список обращений"]', click: 'button:has-text("Разобрать все готовые")', then: '[role=dialog][aria-modal=true]' },
  { name: 'others-card-work', url: '/?tab=requests&view=others&req=202', ready: '[role=dialog][aria-label^="Карточка обращения"]', scroll: 'button:has-text("Закрыть заявку…")' },
  { name: 'others-card-cancelled', url: '/?tab=requests&view=others&ostate=cancelled&req=205', ready: '[role=dialog][aria-label^="Карточка обращения"]', scroll: 'button:has-text("Вернуть в работу")' },
  { name: 'others-reopen', url: '/?tab=requests&view=others&ostate=cancelled&req=205', ready: '[role=dialog][aria-label^="Карточка обращения"]', click: 'button:has-text("Вернуть в работу")', then: '[role=dialog][aria-modal=true]' },
  { name: 'requests-original', url: '/?tab=requests&req=1', ready: '[role=dialog][aria-label^="Карточка заявки"]', click: '[role=dialog] button[aria-expanded="false"]', scroll: 'text=Как система это поняла' },
  // «Подобрать заново»: обычная заявка (кнопка и подсказка) и заявка, у которой данные изменились после закрепления.
  { name: 'requests-rematch', url: '/?tab=requests&req=1', ready: '[role=dialog][aria-label^="Карточка заявки"]', scroll: 'button:has-text("Подобрать заново")' },
  { name: 'requests-datachanged', url: '/?tab=requests&req=2', ready: '[role=dialog][aria-label^="Карточка заявки"]', scroll: 'text=Район, возраст, время или улица изменились' },
  { name: 'requests-queue', url: '/?tab=requests&bucket=queue', ready: 'nav[aria-label="Переход между заявками"]' },
  { name: 'requests-reject', url: '/?tab=requests&req=1', ready: '[role=dialog][aria-label^="Карточка заявки"]', click: 'button[aria-label^="Отклонить группу"]' },
  { name: 'requests-list', url: '/?tab=requests', ready: 'ul[aria-label="Список заявок"]' },
  // «Команда»: сводка руководителя (в фикстурах вход полный, поэтому виден и блок «Выгрузка»).
  { name: 'team', url: '/?tab=team', ready: 'table[aria-label="Нагрузка по координаторам"]', full: true },
  // Массовые действия: выбраны две заявки; затем выбран координатор и открыто окно подтверждения.
  { name: 'requests-bulk', url: '/?tab=requests', ready: 'ul[aria-label="Список заявок"]', click: ['input[aria-label="Выбрать заявку Алексей Орлов"]', 'input[aria-label="Выбрать заявку Мария Соколова"]'], then: 'section[aria-label="Массовые действия"]' },
  { name: 'requests-bulk-confirm', url: '/?tab=requests', ready: 'ul[aria-label="Список заявок"]', click: ['input[aria-label="Выбрать заявку Алексей Орлов"]', 'input[aria-label="Выбрать заявку Мария Соколова"]'], then: 'section[aria-label="Массовые действия"]', select: [['section[aria-label="Массовые действия"] select', 'Петров Г.']], submit: 'section[aria-label="Массовые действия"] button:text-is("Передать")', after: '[role=dialog]' },
  // Отбор «В работе у» и «Мои виды»: выбран ответственный; окно видов со сохранённым видом.
  { name: 'requests-resp', url: '/?tab=requests', ready: 'ul[aria-label="Список заявок"]', select: [['[role=group][aria-label="Отбор списка заявок"] select', 'Пётр Г.']], after: 'ul[aria-label="Список заявок"] li' },
  { name: 'requests-views', url: '/?tab=requests&bucket=ready', ready: 'ul[aria-label="Список заявок"]', click: '[role=group][aria-label="Отбор списка заявок"] button:has-text("Мои виды")', then: '[role=dialog][aria-label="Мои виды"]', fill: [['[role=dialog][aria-label="Мои виды"] input[type=text]', 'Готовые к утверждению']], submit: '[role=dialog][aria-label="Мои виды"] button[type=submit]', after: '[role=dialog][aria-label="Мои виды"] ul' },
  { name: 'reference-views', url: '/?tab=reference', ready: 'table', click: 'button:has-text("Мои виды")', then: '[role=dialog][aria-label="Мои виды"]' },
  { name: 'reference-groups', url: '/?tab=reference&rec=1', ready: '[role=dialog][aria-label^="Карточка группы"]' },
  { name: 'reference-groups-table', url: '/?tab=reference', ready: 'table' },
  { name: 'reference-people', url: '/?tab=reference&ent=people', ready: 'table' },
  { name: 'reference-coordinators', url: '/?tab=reference&ent=coordinators&rec=1', ready: '[role=dialog][aria-label^="Карточка координатора"]' },
  { name: 'reference-filters-open', url: '/?tab=reference', ready: 'table', click: 'button:has-text("Фильтры")' },
  // Правка и удаление записей справочника (в фикстурах вход полный, поэтому «Удалить» видна). Окна — Modal с aria-modal.
  { name: 'manage-group-card', url: '/?tab=reference&rec=2', ready: '[role=dialog][aria-label^="Карточка группы"]', scroll: 'button[aria-label^="Править группу"]' },
  { name: 'manage-group-edit', url: '/?tab=reference&rec=2', ready: '[role=dialog][aria-label^="Карточка группы"]', click: 'button[aria-label^="Править группу"]', then: '[role=dialog][aria-modal=true] select >> nth=3' },
  { name: 'manage-coordinator-edit', url: '/?tab=reference&ent=coordinators&rec=1', ready: '[role=dialog][aria-label^="Карточка координатора"]', click: 'button[aria-label^="Править координатора"]', then: '[role=dialog][aria-modal=true] input' },
  { name: 'manage-group-delete', url: '/?tab=reference&rec=2', ready: '[role=dialog][aria-label^="Карточка группы"]', click: 'button[aria-label^="Удалить группу"]', then: '[role=dialog][aria-modal=true] button:has-text("Удалить")' },
  { name: 'manage-request-delete', url: '/?tab=requests&req=1', ready: '[role=dialog][aria-label^="Карточка заявки"]', scroll: 'button[aria-label^="Удалить заявку"]' },
  { name: 'manage-create-coordinator', url: '/?tab=reference&ent=coordinators', ready: 'table', click: ['button:has-text("+ Создать")', '[role=menuitem]:has-text("Координатор")'], then: '[role=dialog][aria-modal=true] input' },
  { name: 'reference-view-open', url: '/?tab=reference', ready: 'table', click: 'button:has-text("Вид таблицы")' },
  // «Настройки» (в фикстурах вход полный). full — снимок всей страницы: разделы длиннее экрана.
  { name: 'settings-health', url: '/?tab=settings', ready: 'ul[aria-label="Метрики сервера"]', full: true },
  { name: 'settings-errors', url: '/?tab=settings&sec=errors', ready: 'ul[aria-label="Записи об ошибках"]', full: true },
  { name: 'settings-audit', url: '/?tab=settings&sec=audit', ready: 'table[aria-label="Журнал регистрации"]', click: 'button[aria-label^="Что изменилось"]', full: true },
  { name: 'settings-prompts', url: '/?tab=settings&sec=prompts', ready: 'textarea', full: true },
  { name: 'settings-prompts-rollback', url: '/?tab=settings&sec=prompts', ready: 'textarea', click: 'button[aria-label="Сделать действующей версию 2"]' },
  { name: 'settings-users', url: '/?tab=settings&sec=users', ready: 'text=Елена Смирнова', full: true },
  // Окно «Добавить пользователя» и окно со ссылкой (в фикстурах почты нет, поэтому приглашение даёт ссылку).
  { name: 'settings-users-add', url: '/?tab=settings&sec=users', ready: 'text=Елена Смирнова', click: 'button:has-text("Добавить пользователя")', then: '[role=dialog]' },
  { name: 'settings-users-link', url: '/?tab=settings&sec=users', ready: 'text=Елена Смирнова', click: 'button:has-text("Прислать приглашение снова")', then: 'textarea[readonly]' },
  // «+ Создать»: меню и две формы (в фикстурах списки формы приходят не сразу, поэтому ждём поле ввода).
  { name: 'create-menu', url: '/?tab=reference', ready: 'table', click: 'button:has-text("+ Создать")', then: '[role=menu] [role=menuitem]:has-text("Участник")' },
  { name: 'create-request', url: '/?tab=reference', ready: 'table', click: ['button:has-text("+ Создать")', '[role=menuitem]:has-text("Заявка")'], then: '[role=dialog] input[type=text]' },
  { name: 'create-group', url: '/?tab=reference', ready: 'table', click: ['button:has-text("+ Создать")', '[role=menuitem]:has-text("Группа")'], then: '[role=dialog] fieldset' },
  // Регистрация участника: пустая форма, форма с ветвлением (ответ «хочет в группу») и результат после успеха.
  // fill — пары [селектор, значение], select — пары [селектор, значение option]; выполняются после click.
  { name: 'registration-form', url: '/?tab=reference', ready: 'table', click: ['button:has-text("+ Создать")', '[role=menuitem]:has-text("Участник")'], then: '[role=dialog] select' },
  {
    name: 'registration-form-join',
    url: '/?tab=reference',
    ready: 'table',
    click: ['button:has-text("+ Создать")', '[role=menuitem]:has-text("Участник")'],
    then: '[role=dialog] select',
    fill: [['[role=dialog] input[type=text]', 'Анна Петрова']],
    select: [['[role=dialog] select >> nth=1', 'join']],
    after: '[role=dialog] select >> nth=2',
  },
  {
    name: 'registration-done',
    url: '/?tab=reference',
    ready: 'table',
    click: ['button:has-text("+ Создать")', '[role=menuitem]:has-text("Участник")'],
    then: '[role=dialog] select',
    fill: [['[role=dialog] input[type=text] >> nth=0', 'Анна Петрова'], ['[role=dialog] input[type=text] >> nth=1', '+7 911 000 11 22']],
    submit: '[role=dialog] button[type=submit]',
    after: '[role=dialog] img',
  },
  // Справочник «Люди»: карточка человека с номером регистрации и ссылками.
  { name: 'reference-people-card', url: '/?tab=reference&ent=people&rec=u1', ready: '[role=dialog][aria-label^="Карточка человека"]' },
  // «Команда → Кампания «40 дней»», страница /registration для волонтёров, «Настройки → Бот», новые поля правки группы
  // и удаление регистрации из карточки человека.
  { name: 'team-campaign', url: '/?tab=team&sec=campaign', ready: 'ul[aria-label="Материалы по дням кампании"]', full: true },
  { name: 'registration-page', url: '/registration', ready: 'select', full: true },
  {
    name: 'registration-page-join',
    url: '/registration',
    ready: 'select',
    fill: [['input[type=text] >> nth=0', 'Анна Петрова']],
    select: [['select >> nth=1', 'join']],
    after: 'select >> nth=2',
    full: true,
  },
  {
    name: 'registration-page-done',
    url: '/registration',
    ready: 'select',
    fill: [['input[type=text] >> nth=0', 'Анна Петрова'], ['input[type=text] >> nth=1', '+7 911 000 11 22']],
    submit: 'main button[type=submit]:has-text("Зарегистрировать")',
    after: 'main img',
    full: true,
  },
  { name: 'settings-bot', url: '/?tab=settings&sec=bot', ready: 'input[type=radio]', full: true },
  { name: 'settings-bot-list', url: '/?tab=settings&sec=bot', ready: 'input[type=radio]', click: 'label:has-text("Только этим людям")', then: 'input[type=text]', fill: [['input[type=text]', '111111111, max:222222222']], full: true },
  // Помощник: блок подбора с кнопкой, окно подтверждения, карточки с блоком «Помощник» (4 — с определёнными полями, 8 — только вопросы), метка в списке и «Настройки → Помощник».
  { name: 'assistant-panel', url: '/?tab=requests', ready: 'button:has-text("Попросить помощника")' },
  { name: 'assistant-confirm', url: '/?tab=requests', ready: 'button:has-text("Попросить помощника")', click: 'button:has-text("Попросить помощника")', then: '[role=dialog][aria-modal=true]' },
  { name: 'assistant-done', url: '/?tab=requests', ready: 'button:has-text("Попросить помощника")', click: ['button:has-text("Попросить помощника")', 'button:has-text("Да, разобрать")'], then: '[role=status]:has-text("Готово: отправлено")' },
  { name: 'assistant-card', url: '/?tab=requests&req=4', ready: '[role=dialog][aria-label^="Карточка заявки"]', scroll: 'button:has-text("Скопировать вопросы")' },
  { name: 'assistant-card-questions', url: '/?tab=requests&bucket=human&req=8', ready: '[role=dialog][aria-label^="Карточка заявки"]', scroll: 'button:has-text("Скопировать вопросы")' },
  { name: 'assistant-settings', url: '/?tab=settings&sec=assistant', ready: '[role=switch]', full: true },
  { name: 'manage-group-edit-write', url: '/?tab=reference&rec=2', ready: '[role=dialog][aria-label^="Карточка группы"]', click: 'button[aria-label^="Править группу"]', then: '[role=dialog][aria-modal=true] select >> nth=3', scroll: 'text=Новый адрес' },
  { name: 'reference-people-card-delete', url: '/?tab=reference&ent=people&rec=u1', ready: '[role=dialog][aria-label^="Карточка человека"]', click: 'button[aria-label^="Удалить регистрацию"]', then: '[role=dialog][aria-modal=true] button:has-text("Удалить")' },
  // Справочник групп сразу после открытия: закрытая скрыта, отбор по умолчанию виден чипом.
  { name: 'reference-groups-default', url: '/?tab=reference', ready: 'table' },
  // Закрытая группа с длинным ФИО: ведущий обрезан многоточием.
  { name: 'reference-groups-closed', url: '/?tab=reference&f=Статус:eq:Закрыта', ready: 'table' },
  { name: 'reference-filtered', url: '/?tab=reference&f=Район:eq:Приморский&gb=Статус&col=№&col=Ведущий&col=Район&col=Статус&col=Здоровье', ready: 'table' },
  // Состав группы: карточка с направленными и внесёнными вручную (метка «Есть и в…»), окно «Добавить человека» (поиск, выбор, «Уже в составе»
  // и режим «Новый человек») и карточки людей: со списком групп и внесённая вручную с правкой.
  { name: 'members-group-card', url: '/?tab=reference&rec=1', ready: '[role=dialog][aria-label^="Карточка группы"]', scroll: 'ul[aria-label="Состоят в группе"]' },
  { name: 'members-group-empty', url: '/?tab=reference&rec=3', ready: '[role=dialog][aria-label^="Карточка группы"]', scroll: 'button[aria-label="Добавить человека"]' },
  {
    name: 'members-add-search',
    url: '/?tab=reference&rec=4',
    ready: '[role=dialog][aria-label^="Карточка группы"]',
    click: 'button[aria-label="Добавить человека"]',
    then: '[role=dialog][aria-modal=true] ul[aria-label="Люди из справочника"]',
    fill: [['[role=dialog][aria-modal=true] input[type=search]', 'ор']],
    clickAfter: '[role=dialog][aria-modal=true] ul[aria-label="Люди из справочника"] button:not([disabled]) >> nth=0',
  },
  {
    name: 'members-add-new',
    url: '/?tab=reference&rec=4',
    ready: '[role=dialog][aria-label^="Карточка группы"]',
    click: ['button[aria-label="Добавить человека"]', '[role=dialog][aria-modal=true] [role=tab]:has-text("Новый человек")'],
    then: '[role=dialog][aria-modal=true] input[type=text]',
    fill: [
      ['[role=dialog][aria-modal=true] input[type=text] >> nth=0', 'Анна Лебедева'],
      ['[role=dialog][aria-modal=true] input[type=text] >> nth=1', '+7 911 111 22 33'],
      ['[role=dialog][aria-modal=true] input[type=text] >> nth=3', 'Купчино'],
    ],
  },
  { name: 'members-person-card', url: '/?tab=reference&ent=people&rec=u1', ready: '[role=dialog][aria-label^="Карточка человека"]', then: 'button[aria-label="Открыть группу ДГ-0012"]' },
  { name: 'members-person-manual', url: '/?tab=reference&ent=people&rec=p1', ready: '[role=dialog][aria-label^="Карточка человека"]', then: 'button[aria-label^="Править карточку"]' },
  { name: 'members-people-groups-col', url: '/?tab=reference&ent=people&col=ФИО&col=Район&col=Группы', ready: 'table' },
  { name: 'members-groups-col', url: '/?tab=reference&col=№&col=Ведущий&col=Места&col=В составе&sort=В составе:desc', ready: 'table' },
  // Плавающая кнопка «✦ Помощник» (на «Сегодня»), открытое окно с подсказками, ответ с таблицей и раскрытым «Как посмотрел», ошибка сервиса.
  { name: 'chat-fab', url: '/', ready: 'button:has-text("✦ Помощник")' },
  // В демо у входа уже есть прошлый разговор (две реплики): его сервер отдаёт при открытии окна, поэтому подсказок сначала нет.
  { name: 'chat-open', url: '/', ready: 'button:has-text("✦ Помощник")', click: 'button:has-text("✦ Помощник")', then: '[role=dialog][aria-label="Помощник"] [role=log]:has-text("Сколько в Приморском районе групп")' },
  // «Очистить разговор»: экран пустеет только после ответа сервера и возвращает подсказки.
  { name: 'chat-cleared', url: '/', ready: 'button:has-text("✦ Помощник")', click: ['button:has-text("✦ Помощник")', '[role=dialog][aria-label="Помощник"] button:has-text("Очистить разговор")'], then: '[role=dialog][aria-label="Помощник"] [role=group]' },
  {
    name: 'chat-answer',
    url: '/',
    ready: 'button:has-text("✦ Помощник")',
    click: 'button:has-text("✦ Помощник")',
    then: '[role=dialog][aria-label="Помощник"] [role=log]:has-text("Сколько в Приморском районе групп")',
    fill: [['[role=dialog][aria-label="Помощник"] textarea', 'В каком районе перебор групп?']],
    submit: '[role=dialog][aria-label="Помощник"] button[aria-label="Отправить"]',
    after: '[role=dialog][aria-label="Помощник"] table',
    afterClick: '[role=dialog][aria-label="Помощник"] summary',
    scroll: '[role=dialog][aria-label="Помощник"] button:has-text("Скопировать ответ")',
  },
  {
    name: 'chat-error',
    url: '/',
    ready: 'button:has-text("✦ Помощник")',
    click: 'button:has-text("✦ Помощник")',
    then: '[role=dialog][aria-label="Помощник"] [role=log]:has-text("Сколько в Приморском районе групп")',
    fill: [['[role=dialog][aria-label="Помощник"] textarea', 'Покажи, что за ошибка']],
    submit: '[role=dialog][aria-label="Помощник"] button[aria-label="Отправить"]',
    after: '[role=dialog][aria-label="Помощник"] button:has-text("Повторить")',
  },
  // «Данные изменились» → что именно: метка в карточке раскрывается (заявка 2 — два поля, 3 — подробностей нет), то же в строке списка и окно из панели подбора.
  { name: 'changes-card', url: '/?tab=requests&req=2', ready: '[role=dialog][aria-label^="Карточка заявки"]', click: '[role=dialog][aria-label^="Карточка заявки"] button[aria-expanded=false]:has-text("Данные изменились")', then: 'ul[aria-label="Что изменилось"]', scroll: 'ul[aria-label="Что изменилось"]' },
  { name: 'changes-card-none', url: '/?tab=requests&req=3', ready: '[role=dialog][aria-label^="Карточка заявки"]', click: '[role=dialog][aria-label^="Карточка заявки"] button[aria-expanded=false]:has-text("Данные изменились")', then: 'p:has-text("подробности сохраняются")', scroll: 'p:has-text("подробности сохраняются")' },
  { name: 'changes-list', url: '/?tab=requests', ready: 'ul[aria-label="Список заявок"]', click: 'ul[aria-label="Список заявок"] button[aria-expanded=false]:has-text("Данные изменились") >> nth=0', then: 'ul[aria-label="Список заявок"] ul[aria-label="Что изменилось"]', scroll: 'ul[aria-label="Список заявок"] ul[aria-label="Что изменилось"]' },
  { name: 'changes-panel', url: '/?tab=requests', ready: 'ul[aria-label="Список заявок"]', click: 'button:has-text("Данные изменились у")', then: '[role=dialog][aria-modal=true] ul[aria-label="Что изменилось"]' },
  // Метка «Странный человек»: красный значок в списках, плашка и флажок в карточке (заявка 14 отмечена в демо), вопрос при утверждении,
  // чип «Странные», значок в «Людях», в составе группы и в «Других обращениях».
  { name: 'strange-list', url: '/?tab=requests', ready: 'ul[aria-label="Список заявок"] [role=img][aria-label^="Странный человек"]', scroll: 'ul[aria-label="Список заявок"] [role=img][aria-label^="Странный человек"]' },
  { name: 'strange-chip', url: '/?tab=requests&bucket=strange', ready: 'ul[aria-label="Список заявок"] [role=img][aria-label^="Странный человек"]', scroll: 'ul[aria-label="Список заявок"] [role=img][aria-label^="Странный человек"]' },
  { name: 'strange-card', url: '/?tab=requests&req=14', ready: '[role=dialog][aria-label^="Карточка заявки"] [role=note]' },
  { name: 'strange-work', url: '/?tab=requests&req=14', ready: '[role=dialog][aria-label^="Карточка заявки"] [role=note]', scroll: 'button:has-text("Сохранить отметку")' },
  { name: 'strange-work-new', url: '/?tab=requests&req=1', ready: '[role=dialog][aria-label^="Карточка заявки"]', click: 'label:has-text("Странный человек")', then: 'textarea[maxlength="300"]', scroll: 'button:has-text("Сохранить отметку")' },
  {
    name: 'strange-confirm',
    url: '/?tab=requests&req=14',
    ready: '[role=dialog][aria-label^="Карточка заявки"] [role=note]',
    click: ['button[aria-label="Выбрать другую группу из списка"]', '[role=dialog][aria-modal=true] button[aria-label^="Выбрать и утвердить"]:not([disabled]) >> nth=0'],
    then: '[role=dialog][aria-modal=true]:has-text("Всё равно направить")',
  },
  { name: 'strange-people', url: '/?tab=reference&ent=people', ready: 'table [role=img][aria-label^="Странный человек"]', scroll: 'table [role=img][aria-label^="Странный человек"]' },
  { name: 'strange-person-card', url: '/?tab=reference&ent=people&rec=u2', ready: '[role=dialog][aria-label^="Карточка человека"] [role=note]', scroll: 'button:has-text("Снять отметку"), button:has-text("Сохранить отметку")' },
  { name: 'strange-members', url: '/?tab=reference&rec=2', ready: '[role=dialog][aria-label^="Карточка группы"]', scroll: 'ul[aria-label="Состоят в группе"] [role=img][aria-label^="Странный человек"]' },
  { name: 'strange-others', url: '/?tab=requests&view=others', ready: 'ul[aria-label="Список обращений"] [role=img][aria-label^="Странный человек"]', scroll: 'ul[aria-label="Список обращений"] [role=img][aria-label^="Странный человек"]' },
];

// Карточка предложенной группы поверх заявки и кнопки «Карточка группы» в окне «Другая группа».
SCREENS.push(
  {
    name: 'requests-group-preview',
    url: '/?tab=requests&req=1',
    ready: '[role=dialog][aria-label^="Карточка заявки"]',
    click: 'role=button[name="Карточка группы ДГ-0019"]',
    then: 'role=dialog[name="Группа ДГ-0019"]',
  },
  {
    name: 'requests-pick-preview',
    url: '/?tab=requests&req=1',
    ready: '[role=dialog][aria-label^="Карточка заявки"]',
    click: 'button[aria-label="Выбрать другую группу из списка"]',
    then: 'role=dialog[name="Другая группа"] >> role=button[name=/^Карточка группы/]',
  },
);

// «Пароли для команды»: пароль Родионову сгенерирован, показан «глазиком».
SCREENS.push({
  name: 'settings-team-passwords',
  url: '/?tab=settings&sec=users',
  ready: 'role=region[name="Пароли для команды"]',
  click: ['role=button[name="Сгенерировать пароль: Родионов Давид"]'],
  then: '[data-testid="team-password"]',
  clickAfter: 'role=button[name="Показать пароль: Родионов Давид"]',
});

/**
 * Инструкция координаторам: как найти свои группы и проверить их данные. mark — что обвести красной рамкой с номером
 * (номер в рамке = номер шага в docs/ИНСТРУКЦИЯ-КООРДИНАТОРА.md). Имена файлов без ширины и темы: на них ссылается
 * инструкция, и при пересъёмке ссылки не меняются.
 */
const MY = 'Морозов Д.';
const MY_GROUPS = `/?tab=groups&f=${encodeURIComponent('Статус:ne:Закрыта')}&f=${encodeURIComponent('Статус:ne:Аннулирована')}&f=${encodeURIComponent(`Координатор:eq:${MY}`)}`;
SCREENS.push(
  {
    name: 'guide-01-groups',
    url: '/?tab=groups',
    ready: 'table',
    mark: ['[role=tablist][aria-label="Разделы"] >> role=tab[name=/^Группы/]', 'ul[aria-label="Текущий отбор"]', 'role=button[name=/^Фильтры/]'],
  },
  {
    name: 'guide-02-filter',
    url: '/?tab=groups',
    ready: 'table',
    click: 'role=button[name=/^Фильтры/]',
    then: '[role=dialog][aria-label="Фильтры"]',
    select: [
      ['[role=dialog][aria-label="Фильтры"] >> internal:label="Поле"', 'Координатор'],
      ['[role=dialog][aria-label="Фильтры"] >> internal:label="Значение"', MY],
    ],
    mark: [
      '[role=dialog][aria-label="Фильтры"] >> internal:label="Поле"',
      '[role=dialog][aria-label="Фильтры"] >> internal:label="Значение"',
      '[role=dialog][aria-label="Фильтры"] >> role=button[name="Добавить"]',
    ],
  },
  {
    name: 'guide-03-my-groups',
    url: MY_GROUPS,
    ready: 'table',
    mark: ['ul[aria-label="Текущий отбор"] li:has-text("Координатор")', 'text=/^Показано \\d+ из \\d+$/'],
  },
  {
    name: 'guide-04-save-view',
    url: MY_GROUPS,
    ready: 'table',
    click: 'role=button[name=/^Фильтры/]',
    then: '[role=dialog][aria-label="Фильтры"]',
    fill: [['[role=dialog][aria-label="Фильтры"] >> internal:label="Название вида"', 'Мои группы']],
    mark: [
      '[role=dialog][aria-label="Фильтры"] >> internal:label="Название вида"',
      '[role=dialog][aria-label="Фильтры"] >> role=button[name="Сохранить как вид"]',
    ],
  },
  {
    name: 'guide-05-not-checked',
    url: `${MY_GROUPS}&f=${encodeURIComponent('Данные проверены:eq:Нет')}`,
    ready: 'table',
    mark: ['ul[aria-label="Текущий отбор"] li:has-text("Данные проверены")', 'role=columnheader[name=/Данные проверены/]'],
  },
  {
    name: 'guide-06-card',
    url: '/?tab=groups&rec=2',
    ready: '[role=dialog][aria-label^="Карточка группы"]',
    mark: [
      '[role=dialog][aria-label^="Карточка группы"] dt:has-text("Когда")',
      '[role=dialog][aria-label^="Карточка группы"] dt:has-text("Ответ ведущего боту")',
      '[role=dialog][aria-label^="Карточка группы"] >> role=button[name=/^Править/]',
    ],
    markRow: true,
  },
  {
    name: 'guide-07-edit',
    url: '/?tab=groups&rec=2',
    ready: '[role=dialog][aria-label^="Карточка группы"]',
    click: '[role=dialog][aria-label^="Карточка группы"] >> role=button[name=/^Править/]',
    then: '[role=dialog][aria-modal=true] form',
    scroll: '[role=dialog][aria-modal=true] >> internal:label="Данные проверены"',
    mark: [
      '[role=dialog][aria-modal=true] label:has-text("Данные проверены")',
      '[role=dialog][aria-modal=true] >> role=button[name="Сохранить"]',
    ],
  },
  {
    name: 'guide-08-show-all',
    url: '/?tab=groups',
    ready: 'table',
    mark: ['role=button[name="Убрать отбор: Принимает новых = Да"]'],
  },
);
const GUIDE_SHOTS = SCREENS.filter((s) => s.name.startsWith('guide-')).map((s) => [s.name, 1280, 'light']);

const SHOTS_ALL = [
  ...['requests-group-preview', 'requests-pick-preview'].flatMap((s) => [[s, 1280, 'light'], [s, 400, 'light']]),
  ['settings-team-passwords', 1280, 'light'],
  ['settings-team-passwords', 400, 'light'],
  ['settings-team-passwords', 400, 'dark'],
  ...['requests-work', 'requests-work-edit'].flatMap((s) => [[s, 400, 'light'], [s, 1280, 'light'], [s, 400, 'dark'], [s, 400, 'gray']]),
  // [экран, ширина, тема]
  ['reference-groups-closed', 1280, 'light'],
  ...['manage-group-card', 'manage-group-edit', 'manage-coordinator-edit', 'manage-group-delete', 'manage-request-delete', 'manage-create-coordinator'].flatMap((s) => [[s, 400, 'light'], [s, 1280, 'light']]),
  ['manage-group-edit', 400, 'dark'],
  ['manage-group-delete', 400, 'gray'],
  ...['create-menu', 'create-request', 'create-group', 'reference-groups-default'].flatMap((s) => [[s, 1280, 'light'], [s, 400, 'light']]),
  ...['registration-form', 'registration-form-join', 'registration-done', 'reference-people-card'].flatMap((s) => [[s, 1280, 'light'], [s, 400, 'light']]),
  ['registration-done', 400, 'dark'],
  ...['settings-health', 'settings-errors', 'settings-audit', 'settings-prompts'].flatMap((s) => [[s, 1280, 'light'], [s, 400, 'light']]),
  ['settings-prompts-rollback', 400, 'light'],
  ...['settings-users', 'settings-users-add', 'settings-users-link'].flatMap((s) => [[s, 400, 'light'], [s, 1280, 'light']]),
  ['settings-health', 1280, 'dark'],
  ['settings-health', 400, 'gray'],
  ...['today', 'requests', 'reference-groups', 'reference-people'].map((s) => [s, 1280, 'light']),
  // Кампания, страница регистрации, настройка бота, новые поля правки группы, удаление регистрации.
  ...['team-campaign', 'registration-page', 'registration-page-join', 'registration-page-done', 'settings-bot', 'settings-bot-list', 'manage-group-edit-write', 'reference-people-card-delete'].flatMap((s) => [[s, 400, 'light'], [s, 1280, 'light']]),
  ...['assistant-panel', 'assistant-confirm', 'assistant-done', 'assistant-card', 'assistant-card-questions', 'assistant-settings'].flatMap((s) => [[s, 400, 'light'], [s, 1280, 'light']]),
  ['assistant-card', 400, 'dark'],
  ['assistant-settings', 400, 'gray'],
  ['team-campaign', 400, 'dark'],
  ['registration-page', 400, 'gray'],
  ['settings-bot', 400, 'dark'],
  ['today', 1280, 'dark'],
  ['today', 1280, 'gray'],
  ['requests', 1280, 'gray'],
  ['reference-groups', 1280, 'dark'],
  ['requests-list', 1280, 'light'],
  ['requests-displaced', 1280, 'light'],
  ['requests-noplan', 1280, 'light'],
  ['requests-weak', 1280, 'light'],
  ...['requests-rematch', 'requests-datachanged'].flatMap((s) => [[s, 1280, 'light'], [s, 400, 'light']]),
  ['requests-pick', 1280, 'light'],
  ['requests-pick', 400, 'light'],
  ['requests-reject', 400, 'light'],
  ...['requests-alternatives', 'requests-params-edit', 'requests-original', 'requests-queue'].flatMap((s) => [[s, 1280, 'light'], [s, 400, 'light']]),
  ['reference-groups-table', 1280, 'light'],
  ['reference-coordinators', 1280, 'light'],
  ['reference-filtered', 1280, 'light'],
  ['reference-filters-open', 1280, 'light'],
  ['reference-view-open', 1280, 'light'],
  ['reference-filters-open', 400, 'light'],
  ...['today', 'requests', 'requests-list', 'reference-groups', 'reference-groups-table', 'reference-people', 'reference-coordinators', 'reference-filtered', 'requests-noplan'].map((s) => [s, 400, 'light']),
  ['today', 400, 'dark'],
  ['today', 400, 'gray'],
  ...['today-pult', 'today-drawer-requests', 'today-drawer-groups'].flatMap((s) => [[s, 400, 'light'], [s, 1280, 'light']]),
  ['today-pult', 1280, 'dark'],
  ['today-pult', 1024, 'light'],
  ...['requests-resp', 'requests-views', 'reference-views'].flatMap((s) => [[s, 400, 'light'], [s, 1280, 'light']]),
  ...['team', 'requests-bulk', 'requests-bulk-confirm'].flatMap((s) => [[s, 400, 'light'], [s, 1280, 'light']]),
  ...['requests-close', 'requests-close-cancel', 'others-list', 'others-card', 'others-card-work', 'others-card-cancelled', 'others-reopen'].flatMap((s) => [[s, 400, 'light'], [s, 1280, 'light']]),
  ...['others-reconcile-ready', 'others-reconcile-choose', 'others-reconcile-none', 'others-reconcile-ready-chip', 'others-ready-confirm', 'manage-group-card'].flatMap((s) => [[s, 400, 'light'], [s, 1280, 'light']]),
  ['others-reconcile-choose', 400, 'dark'],
  ['others-ready-confirm', 400, 'gray'],
  ['others-list-all', 400, 'light'],
  ['others-list', 400, 'dark'],
  ['others-card-work', 400, 'gray'],
  ['team', 400, 'dark'],
  ['team', 1280, 'gray'],
  ...['members-group-card', 'members-group-empty', 'members-add-search', 'members-add-new', 'members-person-card', 'members-person-manual', 'members-people-groups-col', 'members-groups-col'].flatMap((s) => [[s, 400, 'light'], [s, 1280, 'light']]),
  ['members-group-card', 400, 'dark'],
  ['members-add-search', 400, 'gray'],
  ...['chat-fab', 'chat-open', 'chat-answer', 'chat-error'].flatMap((s) => [[s, 400, 'light'], [s, 1280, 'light']]),
  ['chat-answer', 400, 'dark'],
  ['chat-open', 400, 'gray'],
  ['chat-open', 400, 'dark'],
  ...['chat-cleared'].flatMap((s) => [[s, 400, 'light'], [s, 1280, 'light']]),
  ...['changes-card', 'changes-card-none', 'changes-list', 'changes-panel'].flatMap((s) => [[s, 400, 'light'], [s, 1280, 'light'], [s, 400, 'dark'], [s, 400, 'gray']]),
  ['chat-fab', 1280, 'dark'],
  ...['strange-list', 'strange-chip', 'strange-card', 'strange-work', 'strange-work-new', 'strange-confirm', 'strange-people', 'strange-person-card', 'strange-members', 'strange-others'].flatMap((s) => [[s, 400, 'light'], [s, 1280, 'light']]),
  ...['strange-list', 'strange-card', 'strange-confirm'].flatMap((s) => [[s, 400, 'dark'], [s, 400, 'gray']]),
];

const SHOTS = GUIDE ? GUIDE_SHOTS : SHOTS_ALL.filter(([n]) => !n.startsWith('guide-'));

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
  // HG_ONLY=today-pult,today-drawer-groups — снять только перечисленное (полный прогон долгий).
  if (process.env.HG_ONLY && !process.env.HG_ONLY.split(',').includes(screenName)) continue;
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
  try {
    await page.waitForSelector(screen.ready, { timeout: 15000 });
  } catch (e) {
    // Снимок того, что на экране вместо ожидаемого: по нему видно, почему не дождались.
    await page.screenshot({ path: join(outDir, `${screenName}-не-дождались.png`) });
    throw e;
  }
  await page.evaluate(() => document.fonts.ready);
  // click — один селектор или цепочка (меню «Создать»: сначала кнопка, затем пункт).
  for (const sel of [screen.click].flat().filter(Boolean)) await page.click(sel);
  if (screen.click2) await page.click(screen.click2);
  // Результат клика приходит не сразу (ответ «сервера» фикстур): ждём появления нужного элемента.
  if (screen.then) await page.waitForSelector(screen.then, { timeout: 5000 });
  for (const [sel, text] of screen.fill ?? []) await page.fill(sel, text);
  for (const [sel, value] of screen.select ?? []) await page.selectOption(sel, value);
  // clickAfter — клик уже после ввода (например, выбрать человека из отфильтрованного списка).
  for (const sel of [screen.clickAfter].flat().filter(Boolean)) await page.click(sel);
  if (screen.submit) await page.click(screen.submit);
  if (screen.after) await page.waitForSelector(screen.after, { timeout: 5000 });
  // afterClick — клик уже после ответа «сервера» (например, раскрыть блок «Как посмотрел» под ответом).
  for (const sel of [screen.afterClick].flat().filter(Boolean)) await page.click(sel);
  if (screen.scroll) await page.locator(screen.scroll).first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  if (screen.mark) {
    // markRow — у строки карточки («название — значение») обводим всю строку, а не только название.
    const boxes = [];
    for (const sel of screen.mark) {
      const loc = page.locator(sel).first();
      const target = screen.markRow && /\bdt:has-text/.test(sel) ? loc.locator('xpath=..') : loc;
      const box = await target.boundingBox().catch(() => null);
      if (box) boxes.push(box);
      else problems.push(`${screenName}: не нашлось, что обвести: ${sel}`);
    }
    await page.evaluate((list) => {
      list.forEach((b, i) => {
        const frame = document.createElement('div');
        frame.style.cssText = `position:absolute;z-index:2147483647;pointer-events:none;border:3px solid #e5484d;border-radius:8px;
          left:${b.x + scrollX - 5}px;top:${b.y + scrollY - 5}px;width:${b.width + 10}px;height:${b.height + 10}px;box-sizing:border-box`;
        const badge = document.createElement('div');
        badge.textContent = String(i + 1);
        badge.style.cssText = `position:absolute;z-index:2147483647;pointer-events:none;width:26px;height:26px;border-radius:50%;
          background:#e5484d;color:#fff;font:700 15px/26px system-ui,sans-serif;text-align:center;
          left:${b.x + scrollX - 18}px;top:${b.y + scrollY - 18}px`;
        document.body.append(frame, badge);
      });
    }, boxes);
  }

  if (mobile) {
    // Страховку overflow-x: clip на время проверки снимаем: иначе она прятала бы настоящее переполнение.
    await page.addStyleTag({ content: 'html,body{overflow-x:visible !important}' });
    const r = await page.evaluate(findOverflowing);
    const tag = `${screenName}/${width}/${theme}`;
    if (r.scrollWidth > r.vw || r.bad.length) problems.push(`${tag}: горизонтальная прокрутка (scrollWidth=${r.scrollWidth} > ${r.vw}) ${r.bad.join('; ')}`);
    else console.log(`ок: ${tag} без горизонтальной прокрутки (scrollWidth=${r.scrollWidth}, окно=${r.vw})`);
  }
  const file = join(outDir, GUIDE ? `${screenName}.png` : `${screenName}-${width}-${theme}.png`);
  await page.screenshot({ path: file, fullPage: Boolean(screen.full) });
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
