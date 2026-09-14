# Кампания, связь заявка↔группа и переименования в дашборде — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать пункты 1, 3, 4, 8, 9, 10, 11, 12 из спеки — бейдж и фильтр «40 дней» в реестре групп, ослабление запрета на дубль номера на время кампании, подбор ведущего из зарегистрированных участников, код группы, связь заявки с группой (рекомендация по возрасту + принудительное назначение), «Ответственный» как выпадающий список координаторов вместо колонки, колонку «Куда направляем», и переименования вкладок.

**Architecture:** Один новый столбец `requests.group_id → groups.id` обслуживает и рекомендацию, и назначение. Бейдж кампании и код группы — вычисляемые (без новых полей), подбор ведущего — данные, которые бот уже собрал в `users`, просто не были показаны дашборду. Все правки дашборда — в одном файле `dashboard/home-groups.html` (у него нет сборки, только сервер, отдающий его как есть) плюс их серверная подпитка данными.

**Tech Stack:** TypeScript (Node, ESM), PostgreSQL (миграции — обычный SQL), vitest, ванильный JS без фреймворка на странице дашборда.

**Спека:** [docs/superpowers/specs/2026-09-14-groups-requests-campaign-design.md](../specs/2026-09-14-groups-requests-campaign-design.md)

---

## Файловая структура

Создать:
- `migrations/010_requests_group_link.sql`
- `tests/usersRepo.spec.ts`
- `tests/requestsRepo.spec.ts`
- `tests/dashboardHomeGroups.spec.ts`

Изменить:
- `src/broadcast/schedule.ts` — `campaignIsActive`
- `src/core/router.ts` — `leadPhoneTaken` учитывает окно кампании
- `src/db/repos/users.repo.ts` — `leaderCandidates`
- `src/db/repos/groups.repo.ts` — `campaign_registered` в `forDashboard`
- `src/db/repos/requests.repo.ts` — `group_id` во всех методах, работающих с дашбордом
- `src/dashboard/forms.ts` — разбор `groupId`
- `src/dashboard/server.ts` — `DashboardData.leaderCandidates`, `setRequestStatus` с `groupId`
- `src/dashboard/index.ts` — подключение `leaderCandidates`, передача `groupId` в `setRequestStatus`
- `dashboard/home-groups.html` — вся видимая часть: переименования, бейдж, фильтры, подбор ведущего, код группы, колонки заявок
- `tests/helpers/testDb.ts` — `seedUser` принимает весь `MdgStatus`, а не урезанный список
- `tests/schedule.spec.ts`, `tests/leadRequestDedupe.spec.ts`, `tests/groupsRepo.spec.ts`, `tests/dashboardForms.spec.ts`, `tests/dashboardCreateIntegration.spec.ts`, `tests/dashboardRequestStatuses.spec.ts` — новые проверки рядом с существующими

**Порядок задач важен**: миграция → репозитории → формы/сервер → HTML. Каждая задача — отдельный коммит; сборка (`npm run typecheck`) и весь набор тестов (`npm test`) должны быть зелёными перед коммитом задачи, если явно не сказано иное.

---

### Task 1: Миграция — связь заявки с группой

**Files:**
- Create: `migrations/010_requests_group_link.sql`

- [ ] **Step 1: Написать миграцию**

```sql
-- Заявка ссылается на конкретную домашнюю группу: одно поле одновременно
-- хранит рекомендацию (по возрасту) и итоговое, в т.ч. принудительное,
-- назначение — см. docs/superpowers/specs/2026-09-14-groups-requests-campaign-design.md.
-- FK без ON DELETE: группы у нас не удаляют физически (archive — мягкое удаление),
-- поэтому висячих ссылок не бывает.
ALTER TABLE requests ADD COLUMN group_id bigint REFERENCES groups(id);
CREATE INDEX requests_group_idx ON requests (group_id) WHERE group_id IS NOT NULL;
```

- [ ] **Step 2: Применить миграцию на тестовой базе и проверить, что она накатывается**

Run: `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db` (если ещё не поднята), затем `npm test -- tests/groupsRepo.spec.ts`
Expected: тесты проходят как раньше (миграция применяется автоматически хелпером `setupTestDb`, `schema_migrations` получает строку `010_requests_group_link`).

- [ ] **Step 3: Commit**

```bash
git add migrations/010_requests_group_link.sql
git commit -m "Миграция: requests.group_id — связь заявки с домашней группой"
```

---

### Task 2: `campaignIsActive` — идёт ли кампания прямо сейчас

**Files:**
- Modify: `src/broadcast/schedule.ts`
- Test: `tests/schedule.spec.ts`

- [ ] **Step 1: Написать падающий тест**

В `tests/schedule.spec.ts` изменить импорт и добавить блок:

```ts
import { campaignDay, campaignIsActive, dueBroadcast, localDate, localTime } from '../src/broadcast/schedule.js';
```

```ts
describe('campaignIsActive', () => {
  test('до старта кампании — не идёт', () => {
    expect(campaignIsActive(utc('2026-08-30T09:00:00Z'), opts)).toBe(false);
  });

  test('в день старта — идёт', () => {
    expect(campaignIsActive(utc('2026-09-01T09:00:00Z'), opts)).toBe(true);
  });

  test('в последний (сороковой) день — всё ещё идёт', () => {
    expect(campaignIsActive(utc('2026-10-10T09:00:00Z'), opts)).toBe(true);
  });

  test('на следующий день после окончания — уже не идёт', () => {
    expect(campaignIsActive(utc('2026-10-11T09:00:00Z'), opts)).toBe(false);
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npx vitest run tests/schedule.spec.ts -t campaignIsActive`
Expected: FAIL — `campaignIsActive is not a function` (или ошибка импорта).

- [ ] **Step 3: Реализовать**

В `src/broadcast/schedule.ts` добавить после `campaignDay`:

```ts
/**
 * Идёт ли кампания прямо сейчас — от первого дня до последнего включительно.
 * На время кампании дашборд и бот на время снимают некоторые защитные
 * ограничения (например: один номер не может открыть вторую действующую группу).
 */
export function campaignIsActive(now: Date, opts: ScheduleOptions): boolean {
  const day = campaignDay(now, opts);
  return day >= 1 && day <= opts.totalDays;
}
```

- [ ] **Step 4: Запустить и убедиться, что проходит**

Run: `npx vitest run tests/schedule.spec.ts`
Expected: PASS, все тесты файла зелёные.

- [ ] **Step 5: Commit**

```bash
git add src/broadcast/schedule.ts tests/schedule.spec.ts
git commit -m "schedule: campaignIsActive — идёт ли кампания сейчас"
```

---

### Task 3: На время кампании один номер может открыть вторую группу

**Files:**
- Modify: `src/core/router.ts:1-9,219-227` (импорты и `leadPhoneTaken`)
- Test: `tests/leadRequestDedupe.spec.ts`

- [ ] **Step 1: Защитить существующий тест от совпадения с реальным «сегодня»**

Сейчас `beforeEach` в `tests/leadRequestDedupe.spec.ts` ставит `schedule.startDate: '2026-09-01'` — как только эта дата попадёт в прошлое относительно реального времени запуска тестов (а после этой задачи она станет означать «кампания идёт»), тест `'ведущий действующей группы заявку не подаёт'` начнёт втихую проверять не то. Меняем дефолт на заведомо ещё не начавшуюся кампанию:

```ts
  deps = createDeps({
    db,
    platforms: new Map<PlatformName, Platform>([['telegram', tg], ['max', max]]),
    admins: new Map([['telegram', [ADMIN]]]),
    // Далеко в будущем: большинство тестов этого файла проверяют поведение вне
    // кампании. Тест на ослабление правила на время кампании ниже сам строит
    // свой Router с датой начала «сегодня».
    schedule: { startDate: '2099-01-01', broadcastTime: '07:00', totalDays: 40, timezone: 'Europe/Moscow' },
  });
```

- [ ] **Step 2: Запустить существующие тесты — они должны остаться зелёными**

Run: `npx vitest run tests/leadRequestDedupe.spec.ts`
Expected: PASS — смена даты в fixture ничего не меняет для этих тестов, они и раньше не зависели от конкретной даты, кроме побочного совпадения с окном кампании.

- [ ] **Step 3: Написать новый падающий тест на ослабление правила**

Добавить в конец `describe('заявка на открытие группы: сверка телефона', ...)`:

```ts
  test('на время кампании ведущий действующей группы может открыть ещё одну', async () => {
    // «Сегодня» — чтобы тест не зависел от календарной даты запуска.
    const today = new Date().toISOString().slice(0, 10);
    const campaignRouter = new Router(createDeps({
      ...deps.raw,
      schedule: { ...deps.raw.schedule, startDate: today },
    }));

    await seedGroup('Функционирует');
    await seedUser(db, { id: '111', phone: PHONE });
    await campaignRouter.handle(tapLead('111'));

    expect(await leadRequests()).toBe(1);
  });
```

- [ ] **Step 4: Запустить и убедиться, что новый тест падает**

Run: `npx vitest run tests/leadRequestDedupe.spec.ts -t "на время кампании"`
Expected: FAIL — `leadRequests()` возвращает `0`, а не `1` (правило пока действует всегда).

- [ ] **Step 5: Реализовать**

В `src/core/router.ts` добавить импорт (после существующего `import type { Deps } from '../deps.js';`):

```ts
import { campaignIsActive } from '../broadcast/schedule.js';
```

Заменить `leadPhoneTaken`:

```ts
  /**
   * Порядок важен — от него зависит, что человек прочтёт. Про уже принятую заявку
   * говорим «служитель свяжется», про действующую группу — «идите к координатору».
   *
   * На время кампании (день 1..CAMPAIGN_DAYS) вторую проверку снимаем: ведущий
   * действующей группы может на время кампании открыть ещё одну.
   */
  private async leadPhoneTaken(phone: string): Promise<'request' | 'group' | undefined> {
    if (await this.deps.requests.openLeadByPhone(phone)) return 'request';
    if (campaignIsActive(new Date(), this.deps.schedule)) return undefined;
    if (await this.deps.groups.activeLeaderByPhone(phone)) return 'group';
    return undefined;
  }
```

- [ ] **Step 6: Запустить и убедиться, что всё проходит**

Run: `npx vitest run tests/leadRequestDedupe.spec.ts`
Expected: PASS, все тесты файла, включая новый.

- [ ] **Step 7: Commit**

```bash
git add src/core/router.ts tests/leadRequestDedupe.spec.ts
git commit -m "На время кампании один номер может открыть вторую действующую группу"
```

---

### Task 4: Подбор ведущего — кандидаты из зарегистрированных участников

**Files:**
- Modify: `tests/helpers/testDb.ts` (тип `mdgStatus` у `seedUser`)
- Modify: `src/db/repos/users.repo.ts`
- Modify: `src/dashboard/server.ts` (`DashboardData`, `EMPTY_DATA`)
- Modify: `src/dashboard/index.ts` (подключение)
- Modify: `tests/dashboardCreateIntegration.spec.ts` (тестовый `data:`)
- Test: `tests/usersRepo.spec.ts` (создать)

- [ ] **Step 1: Расширить тип `seedUser`, чтобы он принимал весь `MdgStatus`**

`tests/helpers/testDb.ts` сейчас объявляет свой урезанный список статусов (без `'home'`). Импортируем настоящий тип вместо дублирования:

```ts
import { Client, type Pool } from 'pg';
import type { MdgStatus } from '../../src/core/fsm.js';
import { runMigrations } from '../../src/db/migrate.js';
import { createPool } from '../../src/db/pool.js';
```

и заменить в сигнатуре `seedUser`:

```ts
    mdgStatus?: MdgStatus | null;
```

(было `mdgStatus?: 'open' | 'join' | 'member' | 'leader' | null;`).

- [ ] **Step 2: Написать падающий тест на новый метод репозитория**

Create `tests/usersRepo.spec.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { UsersRepo } from '../src/db/repos/users.repo.js';
import { seedUser, setupTestDb, truncateAll } from './helpers/testDb.js';

/**
 * Кандидаты в ведущие: дашборд предлагает их при заведении новой домашней группы
 * вместо повторного набора ФИО и телефона вручную.
 */
let db: Pool;
let repo: UsersRepo;

beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); repo = new UsersRepo(db); });

describe('кандидаты в ведущие', () => {
  test('готов открыть или предоставить дом — оба считаются кандидатами', async () => {
    await seedUser(db, { id: '1', mdgStatus: 'open', fio: 'Открывающий Открыт' });
    await seedUser(db, { id: '2', mdgStatus: 'home', fio: 'Хозяин Дома' });

    const names = (await repo.leaderCandidates()).map((c) => c.full_name).sort();
    expect(names).toEqual(['Открывающий Открыт', 'Хозяин Дома'].sort());
  });

  test('тот, кто уже состоит или уже ведёт группу, кандидатом на новую не считается', async () => {
    await seedUser(db, { id: '1', mdgStatus: 'member' });
    await seedUser(db, { id: '2', mdgStatus: 'leader' });
    await seedUser(db, { id: '3', mdgStatus: 'join' });

    expect(await repo.leaderCandidates()).toEqual([]);
  });

  test('незавершённая анкета не в счёт', async () => {
    await seedUser(db, { id: '1', mdgStatus: 'open', complete: false });
    expect(await repo.leaderCandidates()).toEqual([]);
  });

  test('заблокировавший бота исключён: до него не достучаться', async () => {
    await seedUser(db, { id: '1', mdgStatus: 'open', blocked: true });
    expect(await repo.leaderCandidates()).toEqual([]);
  });

  test('отдаёт весь профиль, который человек заполнил в боте', async () => {
    const id = await seedUser(db, {
      id: '1', mdgStatus: 'open', fio: 'Панов Дмитрий Александрович',
      phone: '+79944178986', church: 'Церковь «Миссия Свет Христа»',
    });
    await db.query(`UPDATE users SET location = 'Лесная', age = '18-25' WHERE id = $1`, [id]);

    const [c] = await repo.leaderCandidates();
    expect(c).toMatchObject({
      full_name: 'Панов Дмитрий Александрович',
      phone: '+79944178986',
      church: 'Церковь «Миссия Свет Христа»',
      mdg_status: 'open',
      location: 'Лесная',
      age: '18-25',
    });
  });
});
```

- [ ] **Step 3: Запустить и убедиться, что падает**

Run: `npx vitest run tests/usersRepo.spec.ts`
Expected: FAIL — `repo.leaderCandidates is not a function`.

- [ ] **Step 4: Реализовать метод**

В `src/db/repos/users.repo.ts` добавить интерфейс и метод (класс `UsersRepo` уже импортирует `MdgStatus` из `../../core/fsm.js`):

```ts
export interface LeaderCandidate {
  id: number;
  full_name: string | null;
  phone: string | null;
  church: string | null;
  mdg_status: MdgStatus | null;
  location: string | null;
  age: string | null;
}
```

```ts
  /**
   * Кандидаты в ведущие новой группы: анкета завершена, человек отметил, что готов
   * открыть группу или предоставить дом, и не заблокировал бота. Используется
   * дашбордом при заведении новой домашней группы.
   */
  async leaderCandidates(): Promise<LeaderCandidate[]> {
    const { rows } = await this.db.query<LeaderCandidate>(
      `SELECT id, full_name, phone, church, mdg_status, location, age
         FROM users
        WHERE complete = true AND mdg_status IN ('open', 'home') AND blocked_at IS NULL
        ORDER BY full_name`,
    );
    return rows;
  }
```

- [ ] **Step 5: Запустить и убедиться, что проходит**

Run: `npx vitest run tests/usersRepo.spec.ts`
Expected: PASS, все пять тестов.

- [ ] **Step 6: Подключить к данным дашборда**

В `src/dashboard/server.ts` расширить интерфейс и дефолт:

```ts
export interface DashboardData {
  groups: readonly object[];
  requests: readonly object[];
  coordinators: readonly object[];
  /** Зарегистрированные участники, готовые открыть группу или предоставить дом. */
  leaderCandidates: readonly object[];
  campaign?: object | null;
}

const EMPTY_DATA: DashboardData = { groups: [], requests: [], coordinators: [], leaderCandidates: [], campaign: null };
```

В `src/dashboard/index.ts` добавить в `data:`:

```ts
    data: async () => ({
      groups: await groups.forDashboard(),
      requests: await requests.forDashboard(),
      coordinators: await coordinators.listActive(),
      leaderCandidates: await users.leaderCandidates(),
      campaign: await campaignStats({ users, requests, campaign, deliveries }, schedule),
    }),
```

В `tests/dashboardCreateIntegration.spec.ts` (общий `data:` в `beforeAll`) добавить туда же:

```ts
    data: async () => ({
      groups: await groups.forDashboard(),
      requests: await requests.forDashboard(),
      coordinators: await coordinators.listActive(),
      leaderCandidates: await users.leaderCandidates(),
    }),
```

- [ ] **Step 7: Прогнать полный набор и typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add tests/helpers/testDb.ts src/db/repos/users.repo.ts src/dashboard/server.ts src/dashboard/index.ts tests/dashboardCreateIntegration.spec.ts tests/usersRepo.spec.ts
git commit -m "UsersRepo.leaderCandidates: кандидаты в ведущие для дашборда"
```

---

### Task 5: Бейдж «40 дней» — кто из ведущих зарегистрирован в кампании

**Files:**
- Modify: `src/db/repos/groups.repo.ts`
- Modify: `tests/groupsRepo.spec.ts`

- [ ] **Step 1: Написать падающий тест**

В `tests/groupsRepo.spec.ts` изменить импорт хелперов:

```ts
import { seedUser, setupTestDb, truncateAll } from './helpers/testDb.js';
```

и добавить в `describe('данные для дашборда', ...)`:

```ts
  test('бейдж кампании загорается по совпадению телефона с завершённой регистрацией', async () => {
    await repo.add({ ...MIN, phone: '+79001112233' }, '999', 'telegram');
    await seedUser(db, { id: '1', phone: '+79001112233', complete: true });

    const [g] = await repo.forDashboard();
    expect(g!.campaign_registered).toBe(true);
  });

  test('без завершённой регистрации бейджа нет', async () => {
    await repo.add({ ...MIN, phone: '+79001112233' }, '999', 'telegram');
    await seedUser(db, { id: '1', phone: '+79001112233', complete: false });

    const [g] = await repo.forDashboard();
    expect(g!.campaign_registered).toBe(false);
  });

  test('без совпадения по номеру бейджа нет', async () => {
    await repo.add({ ...MIN, phone: '+79001112233' }, '999', 'telegram');
    const [g] = await repo.forDashboard();
    expect(g!.campaign_registered).toBe(false);
  });
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npx vitest run tests/groupsRepo.spec.ts -t "бейдж"`
Expected: FAIL — `g!.campaign_registered` равно `undefined`, а не `true`/`false`.

- [ ] **Step 3: Реализовать**

В `src/db/repos/groups.repo.ts` добавить в `DashboardGroup`:

```ts
export interface DashboardGroup {
  // ...существующие поля без изменений...
  source: GroupSource;
  /** Ведущий этой группы совпал по телефону с завершённой регистрацией участника кампании. */
  campaign_registered: boolean;
}
```

и переписать `forDashboard`:

```ts
  async forDashboard(): Promise<DashboardGroup[]> {
    const { rows } = await this.db.query<GroupRow & { campaign_registered: boolean }>(
      `SELECT *,
              EXISTS (
                SELECT 1 FROM users u
                 WHERE u.complete = true AND u.phone = ANY(groups.phones)
              ) AS campaign_registered
         FROM groups
        WHERE archived_at IS NULL
        ORDER BY no NULLS LAST, created_at, id`,
    );
    return rows.map((r) => ({
      id: r.id,
      no: r.no,
      leader: r.leader,
      phone: r.phone,
      phones: r.phones ?? [],
      open_to_new: r.open_to_new,
      age: r.age,
      district: r.district,
      metro: r.metro,
      address: r.address,
      composition: r.composition,
      day: r.day,
      time: r.time,
      people: r.people,
      coordinator: r.coordinator,
      feedback_at: r.feedback_at,
      comment: r.comment,
      training: r.training,
      format: r.format,
      status: r.status,
      checked: r.checked,
      source: r.source,
      campaign_registered: r.campaign_registered,
    }));
  }
```

- [ ] **Step 4: Запустить и убедиться, что проходит**

Run: `npx vitest run tests/groupsRepo.spec.ts`
Expected: PASS, весь файл.

- [ ] **Step 5: Commit**

```bash
git add src/db/repos/groups.repo.ts tests/groupsRepo.spec.ts
git commit -m "GroupsRepo: campaign_registered — совпадение ведущего с участником кампании"
```

---

### Task 6: `RequestsRepo` — связь с домашней группой

**Files:**
- Modify: `src/db/repos/requests.repo.ts`
- Test: `tests/requestsRepo.spec.ts` (создать)

- [ ] **Step 1: Написать падающий тест**

Create `tests/requestsRepo.spec.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { RequestsRepo } from '../src/db/repos/requests.repo.js';
import { GroupsRepo } from '../src/db/repos/groups.repo.js';
import { setupTestDb, truncateAll } from './helpers/testDb.js';

/**
 * Связь заявки с группой (group_id): отдельный файл, потому что до сих пор
 * RequestsRepo проверялся только через HTTP в dashboardCreateIntegration.spec —
 * этого хватало для плоских полей, но не для связи с другой таблицей.
 */
let db: Pool;
let requests: RequestsRepo;
let groups: GroupsRepo;

const REQUEST_MIN = { fio: 'Петров Пётр', type: 'join_group' as const, status: 'Новая' as const };
const GROUP_MIN = {
  leader: 'Иванова Мария', district: 'Невский', format: 'Молодежная' as const, status: 'Функционирует' as const,
};

beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => {
  await truncateAll(db);
  requests = new RequestsRepo(db);
  groups = new GroupsRepo(db);
});

describe('заявка ссылается на домашнюю группу', () => {
  test('заведение из дашборда сохраняет привязку', async () => {
    const group = await groups.create(GROUP_MIN, 'ui');
    const id = await requests.createFromDashboard({ ...REQUEST_MIN, groupId: group.id });

    const [row] = await requests.forDashboard();
    expect(row).toMatchObject({ id, group_id: group.id });
  });

  test('без выбора группы поле пустое', async () => {
    await requests.createFromDashboard(REQUEST_MIN);
    const [row] = await requests.forDashboard();
    expect(row!.group_id).toBeNull();
  });

  test('полная правка меняет привязку, включая сброс на пусто', async () => {
    const group = await groups.create(GROUP_MIN, 'ui');
    const id = await requests.createFromDashboard({ ...REQUEST_MIN, groupId: group.id });

    await requests.updateFromDashboard(id, { ...REQUEST_MIN, groupId: null });
    expect((await requests.forDashboard())[0]!.group_id).toBeNull();
  });

  test('быстрое назначение через setStatus проставляет группу', async () => {
    const group = await groups.create(GROUP_MIN, 'ui');
    const id = await requests.createFromDashboard(REQUEST_MIN);

    await requests.setStatus(id, 'В работе', null, group.id);
    const [row] = await requests.forDashboard();
    expect(row).toMatchObject({ status: 'В работе', group_id: group.id });
  });

  test('setStatus без указания группы не стирает уже выбранную', async () => {
    const group = await groups.create(GROUP_MIN, 'ui');
    const id = await requests.createFromDashboard({ ...REQUEST_MIN, groupId: group.id });

    await requests.setStatus(id, 'В работе');
    expect((await requests.forDashboard())[0]!.group_id).toBe(group.id);
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npx vitest run tests/requestsRepo.spec.ts`
Expected: FAIL — TypeScript ругается на неизвестное свойство `groupId`, либо (если типы ослаблены) тесты падают на `group_id: undefined`.

- [ ] **Step 3: Реализовать — типы**

В `src/db/repos/requests.repo.ts` добавить в `DashboardRequest`:

```ts
export interface DashboardRequest {
  id: number;
  group_id: number | null;
  fio: string | null;
  // ...остальные поля без изменений...
}
```

и в `RequestInput`:

```ts
export interface RequestInput {
  fio: string;
  type: RequestType;
  status: RequestStatus;
  groupId?: number | null;
  // ...остальные поля без изменений...
}
```

- [ ] **Step 4: Реализовать — `forDashboard`**

```ts
  async forDashboard(): Promise<DashboardRequest[]> {
    const { rows } = await this.db.query<{
      id: number; group_id: number | null; fio: string | null; responsible: string | null; status: RequestStatus;
      date: string | null; phone: string | null; phones: string[]; age: string | null;
      place: string | null; source: string | null; ministry: string | null; note: string | null;
      extra: string | null; recommended: string | null; recommended_at: string | null;
      final_group: string | null; cancel_reason: string | null; attendance: string | null;
      type: RequestType; text: string | null; origin: 'таблица' | 'бот' | 'ui';
    }>(
      `SELECT r.id, r.group_id,
              coalesce(r.fio, u.full_name) AS fio,
              r.responsible, r.status,
              coalesce(r.requested_at, r.created_at::date) AS date,
              coalesce(r.phone, u.phone) AS phone,
              CASE WHEN array_length(r.phones, 1) > 0 THEN r.phones
                   WHEN u.phone IS NOT NULL THEN ARRAY[u.phone]
                   ELSE '{}'::text[] END AS phones,
              coalesce(r.age, u.age::text) AS age,
              coalesce(r.place, u.location) AS place,
              r.source, r.ministry, r.note, r.extra, r.recommended, r.recommended_at,
              r.final_group, r.cancel_reason, r.attendance, r.type, r.text, r.origin
         FROM requests r
         LEFT JOIN users u ON u.id = r.user_id
        WHERE r.archived_at IS NULL
        ORDER BY coalesce(r.requested_at, r.created_at::date) DESC, r.id DESC`,
    );
    return rows.map((r) => ({ ...r, phones: r.phones ?? [] }));
  }
```

- [ ] **Step 5: Реализовать — `createFromDashboard`**

```ts
  async createFromDashboard(input: RequestInput): Promise<number> {
    const { rows } = await this.db.query<{ id: number }>(
      `INSERT INTO requests (type, status, fio, phone, phones, age, place, responsible, source,
                             ministry, note, extra, recommended, recommended_at, final_group,
                             cancel_reason, attendance, requested_at, group_id, origin)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'ui')
       RETURNING id`,
      [
        input.type,
        input.status,
        input.fio,
        input.phone ?? null,
        input.phones ?? [],
        input.age ?? null,
        input.place ?? null,
        input.responsible ?? null,
        input.source ?? null,
        input.ministry ?? null,
        input.note ?? null,
        input.extra ?? null,
        input.recommended ?? null,
        input.recommendedAt ?? null,
        input.finalGroup ?? null,
        input.cancelReason ?? null,
        input.attendance ?? null,
        input.requestedAt ?? null,
        input.groupId ?? null,
      ],
    );
    return rows[0]!.id;
  }
```

- [ ] **Step 6: Реализовать — `updateFromDashboard` и `setStatus`**

```ts
  async setStatus(
    id: number,
    status: RequestStatus,
    responsible?: string | null,
    groupId?: number | null,
  ): Promise<boolean> {
    const closing = (CLOSED_STATUSES as readonly string[]).includes(status);
    const { rowCount } = await this.db.query(
      `UPDATE requests
          SET status = $2,
              responsible = coalesce($3, responsible),
              group_id = coalesce($5, group_id),
              handled_by = CASE WHEN $4 THEN 'дашборд' ELSE handled_by END,
              handled_at = CASE WHEN $4 THEN now() ELSE handled_at END
        WHERE id = $1 AND archived_at IS NULL`,
      [id, status, responsible ?? null, closing, groupId ?? null],
    );
    return (rowCount ?? 0) > 0;
  }
```

```ts
  async updateFromDashboard(id: number, patch: RequestInput): Promise<boolean> {
    const closing = (CLOSED_STATUSES as readonly string[]).includes(patch.status);
    const { rowCount } = await this.db.query(
      `UPDATE requests SET
         type = $2, status = $3, fio = $4, phone = $5, phones = $6, age = $7, place = $8,
         responsible = $9, source = $10, ministry = $11, note = $12, extra = $13,
         recommended = $14, recommended_at = $15, final_group = $16, cancel_reason = $17,
         attendance = $18, requested_at = $19, group_id = $20,
         handled_by = CASE WHEN $21 THEN 'дашборд' ELSE handled_by END,
         handled_at = CASE WHEN $21 THEN now() ELSE handled_at END
       WHERE id = $1 AND archived_at IS NULL`,
      [
        id,
        patch.type,
        patch.status,
        patch.fio,
        patch.phone ?? null,
        patch.phones ?? [],
        patch.age ?? null,
        patch.place ?? null,
        patch.responsible ?? null,
        patch.source ?? null,
        patch.ministry ?? null,
        patch.note ?? null,
        patch.extra ?? null,
        patch.recommended ?? null,
        patch.recommendedAt ?? null,
        patch.finalGroup ?? null,
        patch.cancelReason ?? null,
        patch.attendance ?? null,
        patch.requestedAt ?? null,
        patch.groupId ?? null,
        closing,
      ],
    );
    return (rowCount ?? 0) > 0;
  }
```

- [ ] **Step 7: Запустить и убедиться, что проходит**

Run: `npx vitest run tests/requestsRepo.spec.ts tests/dashboardCreateIntegration.spec.ts tests/dashboardServer.spec.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/db/repos/requests.repo.ts tests/requestsRepo.spec.ts
git commit -m "RequestsRepo: заявка ссылается на домашнюю группу (group_id)"
```

---

### Task 7: Форма и быстрое назначение — `groupId` из дашборда

**Files:**
- Modify: `src/dashboard/forms.ts`
- Modify: `src/dashboard/server.ts` (`DashboardDeps.setRequestStatus`, обработчик `/request/status`)
- Modify: `src/dashboard/index.ts` (проброс `groupId`)
- Modify: `tests/dashboardForms.spec.ts`
- Modify: `tests/dashboardCreateIntegration.spec.ts`

- [ ] **Step 1: Написать падающие тесты разбора формы**

В `tests/dashboardForms.spec.ts` добавить (после существующих тестов `parseRequestForm`, используя уже определённый там `REQUEST_MIN`):

```ts
  test('домашняя группа не выбрана — поле пустое, а не ошибка', () => {
    const r = parseRequestForm(form(REQUEST_MIN));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.groupId).toBeNull();
  });

  test('домашняя группа приходит как id из списка', () => {
    const r = parseRequestForm(form({ ...REQUEST_MIN, groupId: '42' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.groupId).toBe(42);
  });

  test('нечисловой id группы отвергается', () => {
    const r = parseRequestForm(form({ ...REQUEST_MIN, groupId: 'сорок два' }));
    expect(r.ok).toBe(false);
  });
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npx vitest run tests/dashboardForms.spec.ts`
Expected: FAIL — `r.value.groupId` не существует (тип и рантайм).

- [ ] **Step 3: Реализовать разбор в `forms.ts`**

Добавить рядом с `oneOf`:

```ts
/** Число или пусто: пустой выбор в списке групп значит «не назначена». */
function optionalId(form: URLSearchParams, name: string): number | null | 'invalid' {
  const raw = text(form, name);
  if (raw === null) return null;
  if (!/^\d+$/.test(raw)) return 'invalid';
  return Number(raw);
}
```

В `parseRequestForm` — после разбора `requestedAt` и перед `return`:

```ts
  const groupId = optionalId(form, 'groupId');
  if (groupId === 'invalid') return { ok: false, error: 'Домашняя группа выбирается из списка.' };
```

и добавить `groupId,` в возвращаемый `value`.

В `parseRequestStatus`:

```ts
export function parseRequestStatus(
  form: URLSearchParams,
): Parsed<{ id: number; status: RequestStatus; responsible: string | null; groupId: number | null }> {
  const id = parseId(form, 'заявки');
  if (!id.ok) return id;
  const status = oneOf<RequestStatus>(form, 'status', REQUEST_STATUSES);
  if (!status) return { ok: false, error: 'Выберите статус заявки из списка.' };
  const groupId = optionalId(form, 'groupId');
  if (groupId === 'invalid') return { ok: false, error: 'Домашняя группа выбирается из списка.' };
  return { ok: true, value: { id: id.value, status, responsible: text(form, 'responsible'), groupId } };
}
```

- [ ] **Step 4: Запустить и убедиться, что тесты форм проходят**

Run: `npx vitest run tests/dashboardForms.spec.ts`
Expected: PASS.

- [ ] **Step 5: Прокинуть `groupId` через сервер**

В `src/dashboard/server.ts` изменить сигнатуру в `DashboardDeps`:

```ts
  /** Быстрая смена статуса заявки из списка. false — заявки нет. */
  setRequestStatus?: (id: number, status: string, responsible: string | null, groupId: number | null) => Promise<boolean>;
```

и в обработчике `/request/status`:

```ts
        const { id, status, responsible, groupId } = parsed.value;
        const changed = await deps.setRequestStatus(id, status, responsible, groupId);
```

В `src/dashboard/index.ts`:

```ts
    setRequestStatus: (id, status, responsible, groupId) => requests.setStatus(id, status as never, responsible, groupId),
```

В `tests/dashboardCreateIntegration.spec.ts` (та же строка в `beforeAll`):

```ts
    setRequestStatus: (id, status, responsible, groupId) => requests.setStatus(id, status as never, responsible, groupId),
```

- [ ] **Step 6: Написать падающий интеграционный тест**

В `tests/dashboardCreateIntegration.spec.ts`, в `describe('ведение заявки в дашборде', ...)`:

```ts
  test('быстрое назначение группы через переключатель статуса', async () => {
    const cookie = await login();
    await post('/group/create', {
      leader: 'Иванова Мария', district: 'Невский', format: 'Молодежная', status: 'Функционирует',
    }, cookie);
    const { rows: g } = await db.query<{ id: number }>('SELECT id FROM groups');

    await post('/request/create', { fio: 'Сидоров Сидор', type: 'join_group', status: 'Новая' }, cookie);
    const { rows: r } = await db.query<{ id: number }>('SELECT id FROM requests');

    const res = await post('/request/status', {
      id: String(r[0]!.id), status: 'В работе', groupId: String(g[0]!.id),
    }, cookie);
    expect(res.status).toBe(200);

    const after = await db.query('SELECT group_id FROM requests WHERE id = $1', [r[0]!.id]);
    expect(after.rows[0]).toMatchObject({ group_id: g[0]!.id });
  });
```

- [ ] **Step 7: Запустить и убедиться, что падает, затем что проходит**

Run: `npx vitest run tests/dashboardCreateIntegration.spec.ts`
Expected: сначала FAIL (маршрут ещё не понимает `groupId` до Step 5 — если Step 5 уже сделан, тест должен сразу пройти; порядок здесь важен только для дисциплины TDD, поэтому если этот шаг выполняется после Step 5, просто подтвердите PASS).

- [ ] **Step 8: Прогнать полный набор и typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/dashboard/forms.ts src/dashboard/server.ts src/dashboard/index.ts tests/dashboardForms.spec.ts tests/dashboardCreateIntegration.spec.ts
git commit -m "Дашборд: назначение домашней группы заявке через форму и быстрый переключатель"
```

---

### Task 8: Переименования вкладок

**Files:**
- Modify: `dashboard/home-groups.html:485,568,570,889,2170`
- Test: `tests/dashboardHomeGroups.spec.ts` (создать)

- [ ] **Step 1: Написать падающий тест**

Create `tests/dashboardHomeGroups.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

/**
 * Структурные проверки страницы дашборда, которые не покрыты
 * dashboardRequestStatuses.spec (тот файл — только про статусы заявок).
 */
const html = readFileSync(new URL('../dashboard/home-groups.html', import.meta.url), 'utf8');

describe('переименования вкладок', () => {
  test('«Обзор» стал «Домашние группы»', () => {
    expect(html).toContain('data-view="all">Домашние группы</button>');
    expect(html).not.toMatch(/>Обзор</);
  });

  test('«Заявки» стали «Заявки (МДГ)»', () => {
    expect(html).toContain('data-view="requests">Заявки (МДГ)</button>');
    expect(html).toContain('<h2 class="card-title">Заявки (МДГ)</h2>');
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npx vitest run tests/dashboardHomeGroups.spec.ts`
Expected: FAIL — текущие подписи `Обзор`/`Заявки`.

- [ ] **Step 3: Переименовать**

В `dashboard/home-groups.html`:
- Строка 568: `<button role="tab" aria-selected="true" data-view="all">Обзор</button>` → `<button role="tab" aria-selected="true" data-view="all">Домашние группы</button>`
- Строка 570: `<button role="tab" aria-selected="false" data-view="requests">Заявки</button>` → `<button role="tab" aria-selected="false" data-view="requests">Заявки (МДГ)</button>`
- Строка 889: `<h2 class="card-title">Заявки</h2>` → `<h2 class="card-title">Заявки (МДГ)</h2>`
- Строка 485 (комментарий): `«Обзор»` → `«Домашние группы»`
- Строка 2170 (комментарий): `на «Обзоре»` → `на «Домашних группах»`

- [ ] **Step 4: Запустить и убедиться, что проходит**

Run: `npx vitest run tests/dashboardHomeGroups.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/home-groups.html tests/dashboardHomeGroups.spec.ts
git commit -m "Дашборд: «Обзор» → «Домашние группы», «Заявки» → «Заявки (МДГ)»"
```

---

### Task 9: Реестр групп — бейдж «40 дней», код группы, фильтр

**Files:**
- Modify: `dashboard/home-groups.html`
- Modify: `tests/dashboardHomeGroups.spec.ts`

- [ ] **Step 1: Написать падающие тесты**

Добавить в `tests/dashboardHomeGroups.spec.ts`:

```ts
describe('бейдж «40 дней» в реестре групп', () => {
  test('колонка есть в шапке таблицы', () => {
    expect(html).toContain('>40 дней<');
  });

  test('бейдж переиспользует существующий зелёный пилл, а не новый цвет', () => {
    expect(html).toContain('pill live');
  });

  test('есть фильтр по регистрации в кампании', () => {
    expect(html).toContain('id="segCampaign"');
    expect(html).toContain('data-campaign="yes"');
    expect(html).toContain('data-campaign="no"');
  });
});

describe('код домашней группы', () => {
  test('вычисляется из id, без отдельного счётчика в базе', () => {
    expect(html).toContain('function groupCode(id)');
    expect(html).toContain("padStart(4, '0')");
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npx vitest run tests/dashboardHomeGroups.spec.ts`
Expected: FAIL — ничего из этого в файле ещё нет.

- [ ] **Step 3: Добавить сегментированный фильтр в разметку**

В `dashboard/home-groups.html`, сразу после блока `<div class="seg" id="segStatus">...</div>` (район строк 764-769):

```html
      <div class="seg" id="segCampaign">
        <button aria-selected="true" data-campaign="">Все</button>
        <button data-campaign="yes">Зарегистрированы</button>
        <button data-campaign="no">Не зарегистрированы</button>
      </div>
```

- [ ] **Step 4: Добавить колонку в шапку таблицы**

Заменить строку заголовка (было `<th class="sortable" data-key="leader">Группа <span class="arrow">↓</span></th>`):

```html
            <th class="sortable" data-key="leader">Группа <span class="arrow">↓</span></th>
            <th class="sortable" data-key="campaign_registered">40 дней <span class="arrow">↓</span></th>
```

- [ ] **Step 5: Добавить состояние фильтра и учитывать его в `visible()`**

```js
const state = { district: null, status: '', campaign: '', sort: 'people', dir: -1, view: 'all', request: null };
```

```js
function visible() {
  return groups.filter((g) =>
    (!state.district || g.district === state.district) &&
    (!state.status || g.status === state.status) &&
    (!state.campaign || (state.campaign === 'yes' ? g.campaign_registered : !g.campaign_registered)));
}
```

- [ ] **Step 6: Добавить `groupCode` и вывести код рядом с именем ведущего, бейдж — новой колонкой**

Рядом с `const groups = DATA.groups;`:

```js
/** Код группы: вычисляется из id, отдельного счётчика в базе нет. */
function groupCode(id) { return `ДГ-${String(id).padStart(4, '0')}`; }
```

В `renderTable()` заменить строку шаблона:

```js
  $('#tbody').innerHTML = rows.map((g) => {
    const [cls, label] = STATUS_PILL[g.status] || ['draft', g.status];
    return `<tr class="row">
      <td class="strong"><span class="caret">›</span>${esc(g.leader)} <span class="mono" style="color:var(--text-3)">${groupCode(g.id)}</span>${g.source && g.source !== 'таблица' ? ` <span class="src">${esc(g.source)}</span>` : ''}</td>
      <td>${g.campaign_registered ? '<span class="pill live"><i></i>40 дней</span>' : '—'}</td>
      <td>${esc(g.district)}${g.metro ? ` <span style="color:var(--text-3)">· ${esc(g.metro.split(',')[0])}</span>` : ''}</td>
      <td>${phoneCell(g)}</td>
      <td>${esc(g.coordinator) || '—'}</td>
      <td class="num-cell">${g.people ?? '—'}</td>
      <td class="mono" style="color:var(--text-3)">${ruDate(g.feedback_at)}</td>
      <td><span class="pill ${cls}"><i></i>${esc(label)}</span></td>
    </tr>
    <tr class="detail hidden"><td colspan="8">${details(g)}</td></tr>`;
  }).join('');
```

(были `colspan="7"` — теперь на одну видимую колонку больше.)

- [ ] **Step 7: Навесить обработчик на новый фильтр**

Рядом с обработчиком `#segStatus` (после его блока):

```js
document.querySelectorAll('#segCampaign button').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('#segCampaign button').forEach((x) => x.setAttribute('aria-selected', 'false'));
    b.setAttribute('aria-selected', 'true');
    state.campaign = b.dataset.campaign;
    renderAll();
  };
});
```

- [ ] **Step 8: Запустить и убедиться, что структурные тесты проходят**

Run: `npx vitest run tests/dashboardHomeGroups.spec.ts`
Expected: PASS.

- [ ] **Step 9: Живая проверка в браузере**

Запустить дашборд локально (см. `README.md` про `docker compose` или `npm run dev`, если есть отдельный скрипт для дашборда — иначе поднять контейнеры и открыть `/groups`) и убедиться глазами: колонка «40 дней» стоит сразу после «Группа», бейдж зелёный и совпадает по стилю со статусом «Функционирует», фильтр переключает три состояния.

- [ ] **Step 10: Commit**

```bash
git add dashboard/home-groups.html tests/dashboardHomeGroups.spec.ts
git commit -m "Реестр групп: бейдж «40 дней», код группы, фильтр по регистрации"
```

---

### Task 10: Подбор ведущего из зарегистрированных участников

**Files:**
- Modify: `dashboard/home-groups.html`
- Modify: `tests/dashboardHomeGroups.spec.ts`

- [ ] **Step 1: Написать падающие тесты**

```ts
describe('подбор ведущего из зарегистрированных участников', () => {
  test('поле выбора кандидата есть в описании полей группы', () => {
    expect(html).toContain("name: 'leaderCandidate'");
  });

  test('выбор кандидата подставляет ФИО и телефон, ничего не отправляя за него', () => {
    expect(html).toContain('function wireLeaderCandidatePicker');
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npx vitest run tests/dashboardHomeGroups.spec.ts -t "подбор ведущего"`
Expected: FAIL.

- [ ] **Step 3: Данные и подпись статуса**

Рядом с `const groups = DATA.groups;` добавить:

```js
const leaderCandidates = DATA.leaderCandidates ?? [];

function mdgStatusLabel(status) {
  return status === 'open' ? 'готов открыть Малую группу'
    : status === 'home' ? 'готов предоставить свой дом'
    : status ?? '—';
}

/** Подпись варианта в списке подбора: весь профиль, который человек заполнил в боте. */
function candidateLabel(c) {
  return [c.full_name, c.phone, c.church, mdgStatusLabel(c.mdg_status), c.location, c.age]
    .filter(Boolean).join(' · ');
}
```

- [ ] **Step 4: Добавить поле в `GROUP_FIELDS`**

Сразу после поля `leader`:

```js
const GROUP_FIELDS = [
  { name: 'leader', label: 'ФИО ведущего', required: true, wide: true, from: 'leader', placeholder: 'Иванова Мария Петровна' },
  { name: 'leaderCandidate', label: 'Подобрать из зарегистрированных', wide: true,
    pairs: [['', '— выбрать вручную —'], ...leaderCandidates.map((c) => [String(c.id), candidateLabel(c)])] },
  { name: 'district', label: 'Район', required: true, options: FORM_DISTRICTS, from: 'district' },
  // ...остальные поля без изменений...
```

Поле не привязано к столбцу базы (`from` не указан) — оно только подставляет значения в соседние поля формы, само не сохраняется (сервер молча игнорирует незнакомое имя поля).

- [ ] **Step 5: Автоподстановка ФИО и телефона**

Добавить функцию рядом с `wireRowForm`:

```js
/*
 * Подбор ведущего из уже зарегистрированных участников: выбор в списке
 * подставляет ФИО и телефон в обычные текстовые поля, ничего не отправляя сам —
 * группу мог завести и служитель для человека, который в боте не регистрировался.
 */
function wireLeaderCandidatePicker(root) {
  const select = root.querySelector('[name="leaderCandidate"]');
  if (!select) return;
  select.onchange = () => {
    const c = leaderCandidates.find((x) => String(x.id) === select.value);
    if (!c) return;
    const leaderInput = root.querySelector('[name="leader"]');
    const phoneInput = root.querySelector('[name="phone"]');
    if (leaderInput && c.full_name) leaderInput.value = c.full_name;
    if (phoneInput && c.phone) phoneInput.value = c.phone;
  };
}
```

- [ ] **Step 6: Подключить в форме заведения и в правке строки**

После `$('#groupFields').innerHTML = formFieldsHtml(GROUP_FIELDS, null, 'g');`:

```js
wireLeaderCandidatePicker($('#groupForm'));
```

В `wireRowEditing`, внутри обработчика `.row-edit` (после `wireRowForm(cell.querySelector('.row-form'), kind, row);`):

```js
      if (kind === 'group') wireLeaderCandidatePicker(cell);
```

- [ ] **Step 7: Запустить и убедиться, что проходит**

Run: `npx vitest run tests/dashboardHomeGroups.spec.ts`
Expected: PASS.

- [ ] **Step 8: Живая проверка в браузере**

Открыть вкладку «Добавить», убедиться: под полем ФИО ведущего появился список кандидатов с полным профилем (ФИО · телефон · церковь · статус · район · возраст), выбор подставляет ФИО и телефон в поля выше. Проверить и в правке существующей группы.

- [ ] **Step 9: Commit**

```bash
git add dashboard/home-groups.html tests/dashboardHomeGroups.spec.ts
git commit -m "Подбор ведущего группы из зарегистрированных участников кампании"
```

---

### Task 11: Заявки — колонка «Домашняя группа», рекомендация по возрасту, принудительное назначение

**Files:**
- Modify: `dashboard/home-groups.html`
- Modify: `tests/dashboardRequestStatuses.spec.ts`

- [ ] **Step 1: Написать падающие тесты**

Добавить в `tests/dashboardRequestStatuses.spec.ts` новый `describe`:

```ts
describe('связь заявки с домашней группой', () => {
  test('в шапке таблицы есть колонка «Домашняя группа»', () => {
    expect(html).toContain('<th>Домашняя группа</th>');
  });

  test('есть фильтр по домашней группе', () => {
    expect(html).toContain('id="reqGroupFilter"');
  });

  test('в раскрытой строке можно принудительно назначить любую группу, не только рекомендованную', () => {
    expect(html).toContain('class="req-group"');
  });

  test('рекомендация помечена звёздочкой, а не отдельным полем-дублёром', () => {
    expect(html).toContain("match ? '★ ' : ''");
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npx vitest run tests/dashboardRequestStatuses.spec.ts -t "домашней группой"`
Expected: FAIL.

- [ ] **Step 3: Вспомогательные функции — подпись группы и подбор по возрасту**

Рядом с `AGE_BUCKETS`/`ageBucket()` добавить:

```js
function groupLabel(id) {
  if (!id) return '—';
  const g = groups.find((x) => x.id === id);
  return g ? `${esc(g.leader)} · ${groupCode(g.id)}` : `${groupCode(id)} (архив)`;
}

function bucketRange(bucket) {
  if (bucket === '65+') return [65, 200];
  const [lo, hi] = bucket.split('-').map(Number);
  return [lo, hi];
}

/** Возрастной диапазон группы: свободный текст вида «35-50». Не разобрали — не участвует в подборе. */
function groupAgeRange(raw) {
  const m = raw ? /^(\d{2})\s*[-–—]\s*(\d{2})$/.exec(String(raw).trim()) : null;
  return m ? [Number(m[1]), Number(m[2])] : null;
}

function rangesOverlap(a, b) { return a[0] <= b[1] && b[0] <= a[1]; }

/** Кандидаты в группу для заявки: рекомендованные (по возрасту) — первыми и со звездой. */
function groupOptions(r) {
  const bucket = ageBucket(r.age);
  const reqRange = bucket ? bucketRange(bucket) : null;
  const scored = groups.map((g) => ({
    g,
    match: Boolean(reqRange && groupAgeRange(g.age) && rangesOverlap(reqRange, groupAgeRange(g.age))),
  }));
  scored.sort((a, b) => Number(b.match) - Number(a.match) || a.g.leader.localeCompare(b.g.leader, 'ru'));
  return scored.map(({ g, match }) =>
    `<option value="${g.id}"${g.id === r.group_id ? ' selected' : ''}>${match ? '★ ' : ''}${esc(g.leader)} · ${groupCode(g.id)}</option>`,
  ).join('');
}
```

- [ ] **Step 4: Колонка в таблице**

В шапке заменить:

```html
            <th>Дата</th>
            <th>Человек</th>
            <th>Телефон</th>
            <th>Место</th>
            <th>Домашняя группа</th>
            <th>Ответственный</th>
            <th>Статус</th>
```

(добавили только «Домашняя группа» — «Ответственный» пока остаётся, его уберёт Task 12 отдельным коммитом; строка временно содержит оба столбца.)

В `renderRequests()`:

```js
  $('#reqBody').innerHTML = rows.map((r) => {
    const [cls, label] = REQUEST_PILL[r.status] || ['draft', r.status];
    return `<tr class="row">
      <td class="mono" style="color:var(--text-3);white-space:nowrap">${ruDate(r.date)}</td>
      <td class="strong"><span class="caret">›</span>${r.fio ? esc(r.fio) : '<span style="color:var(--text-3)">без имени</span>'}</td>
      <td>${phoneCell(r)}</td>
      <td>${esc(r.place) || '—'}</td>
      <td>${groupLabel(r.group_id)}</td>
      <td>${esc(r.responsible) || '—'}</td>
      <td><span class="pill ${cls}"><i></i>${esc(label)}</span></td>
    </tr>
    <tr class="detail hidden"><td colspan="7">${requestDetails(r)}</td></tr>`;
  }).join('');
```

(колонка «Ответственный» временно остаётся последней текстовой ячейкой — уберётся в Task 12; `colspan` увеличен с 6 до 7, поскольку колонок стало на одну больше.)

- [ ] **Step 5: Фильтр по группе**

В `state`:

```js
const state = { district: null, status: '', campaign: '', sort: 'people', dir: -1, view: 'all', request: null, groupId: null };
```

`visibleRequests()`:

```js
function visibleRequests() {
  return requests.filter((r) =>
    (!state.request || r.status === state.request) &&
    (!state.groupId || r.group_id === state.groupId));
}
```

Разметка — в `.card-head` секции заявок, сразу после `<div class="seg" id="segRequest">...</div>`:

```html
      <select id="reqGroupFilter" aria-label="Фильтр по домашней группе"></select>
```

Небольшой стиль рядом с остальными компонентными правилами (`.pill`, `.chip` и т.п.) в `<style>`:

```css
#reqGroupFilter {
  background: var(--surface-3);
  border: 1px solid var(--accent);
  border-radius: 6px;
  color: var(--text);
  font: inherit;
  font-size: 12.5px;
  padding: 4px 8px;
  cursor: pointer;
}
```

Заполнение и обработчик — рядом с остальными разовыми привязками событий (после блока `#segRequest`):

```js
$('#reqGroupFilter').innerHTML = '<option value="">Все группы</option>' +
  groups.map((g) => `<option value="${g.id}">${esc(g.leader)} · ${groupCode(g.id)}</option>`).join('');
$('#reqGroupFilter').onchange = (e) => {
  state.groupId = e.target.value ? Number(e.target.value) : null;
  renderRequests();
};
```

- [ ] **Step 6: Быстрая панель «Перевести заявку» — добавить назначение группы**

В `requestDetails()` заменить блок `.req-edit`:

```js
  cells.push(`<div class="wide req-edit">
    <dt>Перевести заявку</dt>
    <dd>
      <select class="req-status" data-id="${r.id}">
        ${FORM_REQUEST_STATUSES.map((v) => `<option value="${esc(v)}"${v === r.status ? ' selected' : ''}>${esc(v)}</option>`).join('')}
      </select>
      <select class="req-group" data-id="${r.id}">
        <option value="">— группа не назначена —</option>
        ${groupOptions(r)}
      </select>
      <input class="req-owner" data-id="${r.id}" placeholder="Ответственный" value="${esc(r.responsible ?? '')}">
      <button class="btn-primary req-save" data-id="${r.id}">Сохранить</button>
      <span class="form-msg req-msg" data-id="${r.id}"></span>
    </dd>
  </div>`);
```

(`.req-owner` остаётся `<input>` до Task 12, где станет `<select>` из координаторов.)

- [ ] **Step 7: Отправка группы вместе со статусом**

В обработчике `.req-save`:

```js
    btn.onclick = async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const msg = $(`#reqBody .req-msg[data-id="${id}"]`);
      const status = $(`#reqBody .req-status[data-id="${id}"]`).value;
      const responsible = $(`#reqBody .req-owner[data-id="${id}"]`).value;
      const groupId = $(`#reqBody .req-group[data-id="${id}"]`).value;
      btn.disabled = true;
      msg.className = 'form-msg req-msg';
      msg.textContent = 'Сохраняем…';
      try {
        const r = await fetch((window.HG_BASE ?? './') + 'request/status', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ id, status, responsible, groupId }),
        });
        if (r.ok) {
```

(дальше — без изменений; закрывающие строки уже существуют.)

- [ ] **Step 8: Добавить поле `groupId` в `REQUEST_FIELDS` (полная форма правки)**

После поля `place`:

```js
  { name: 'place', label: 'Место', from: 'place', placeholder: 'Дыбенко' },
  { name: 'groupId', label: 'Домашняя группа',
    pairs: [['', '— не назначена —'], ...groups.map((g) => [String(g.id), `${g.leader} · ${groupCode(g.id)}`])],
    from: 'group_id' },
```

- [ ] **Step 9: Запустить и убедиться, что проходит**

Run: `npx vitest run tests/dashboardRequestStatuses.spec.ts tests/dashboardHomeGroups.spec.ts`
Expected: PASS.

- [ ] **Step 10: Живая проверка в браузере**

Открыть вкладку «Заявки (МДГ)», раскрыть заявку с указанным возрастом, убедиться: подходящие по возрасту группы отмечены звездой и идут первыми в списке, выбор и «Сохранить» проставляет группу и она сразу видна в новой колонке; фильтр по группе над таблицей отбирает нужные строки.

- [ ] **Step 11: Commit**

```bash
git add dashboard/home-groups.html tests/dashboardRequestStatuses.spec.ts
git commit -m "Заявки: колонка «Домашняя группа», рекомендация по возрасту, принудительное назначение"
```

---

### Task 12: «Ответственный» — скрыть как колонку, сделать выпадающим списком координаторов

**Files:**
- Modify: `dashboard/home-groups.html`
- Modify: `tests/dashboardRequestStatuses.spec.ts`

- [ ] **Step 1: Написать падающие тесты**

```ts
describe('«Ответственный» — выпадающий список, не колонка', () => {
  test('колонки «Ответственный» в шапке таблицы больше нет', () => {
    expect(html).not.toContain('<th>Ответственный</th>');
  });

  test('в быстрой панели ответственный выбирается из списка координаторов, а не вводится текстом', () => {
    expect(html).toMatch(/<select class="req-owner"/);
  });

  test('текущее значение сохраняется в списке, даже если его нет среди координаторов', () => {
    expect(html).toContain('function responsibleOptions');
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npx vitest run tests/dashboardRequestStatuses.spec.ts -t "Ответственный"`
Expected: FAIL.

- [ ] **Step 3: Убрать колонку из шапки и из строки**

Шапка — убрать строку `<th>Ответственный</th>`, оставив «Домашняя группа» (добавленную в Task 11):

```html
            <th>Дата</th>
            <th>Человек</th>
            <th>Телефон</th>
            <th>Место</th>
            <th>Домашняя группа</th>
            <th>Статус</th>
```

(колонку «Куда направляем» добавит Task 13 отдельным коммитом — здесь на этом шаге только убираем «Ответственный».)

В `renderRequests()` убрать ячейку `<td>${esc(r.responsible) || '—'}</td>` из строки таблицы (колонка `groupLabel` уже добавлена в Task 11) и уменьшить `colspan` детальной строки с 7 до 6 — колонок снова стало на одну меньше:

```js
    <tr class="detail hidden"><td colspan="6">${requestDetails(r)}</td></tr>`;
```

- [ ] **Step 4: Список координаторов и подстраховка от «потерянного» значения**

Рядом с `const requests = DATA.requests ?? [];` добавить:

```js
const coordinators = DATA.coordinators ?? [];

/**
 * Варианты для «Ответственный»: список координаторов плюс — если текущее
 * значение заявки не входит в реестр (опечатка, уволенный координатор) —
 * это значение отдельным пунктом. Иначе сохранение молча заменило бы его
 * на первый пункт списка.
 */
function responsibleOptions(current) {
  const names = coordinators.map((c) => c.name);
  const all = current && !names.includes(current) ? [current, ...names] : names;
  return all.map((n) => `<option value="${esc(n)}"${n === current ? ' selected' : ''}>${esc(n)}</option>`).join('');
}
```

- [ ] **Step 5: Быстрая панель — `<select>` вместо `<input>`**

В `requestDetails()`:

```js
      <select class="req-owner" data-id="${r.id}">
        <option value="">— ответственный не выбран —</option>
        ${responsibleOptions(r.responsible)}
      </select>
```

(было `<input class="req-owner" ... value="${esc(r.responsible ?? '')}">` — класс и `data-id` остаются теми же, обработчик сохранения читает `.value` одинаково что у `<input>`, что у `<select>`.)

- [ ] **Step 6: Полная форма правки — `options` вместо свободного текста**

В `REQUEST_FIELDS` перед определением массива добавить константу (после `RESPONSIBLE_OPTIONS` — список координаторов плюс любые уже встречающиеся в заявках значения, на случай если чьё-то имя разошлось с реестром координаторов):

```js
const RESPONSIBLE_OPTIONS = [...new Set([
  ...coordinators.map((c) => c.name),
  ...requests.map((r) => r.responsible).filter(Boolean),
])];
```

и заменить поле:

```js
  { name: 'responsible', label: 'Ответственный', options: RESPONSIBLE_OPTIONS, from: 'responsible' },
```

(было `{ name: 'responsible', label: 'Ответственный', from: 'responsible', placeholder: 'Юлия Комарская' }`.)

- [ ] **Step 7: Запустить и убедиться, что проходит**

Run: `npx vitest run tests/dashboardRequestStatuses.spec.ts`
Expected: PASS.

- [ ] **Step 8: Живая проверка в браузере**

Убедиться: колонки «Ответственный» в таблице больше нет; в быстрой панели и в полной форме правки это теперь список, а не текстовое поле; ранее сохранённые значения не пропадают из списка.

- [ ] **Step 9: Commit**

```bash
git add dashboard/home-groups.html tests/dashboardRequestStatuses.spec.ts
git commit -m "«Ответственный»: выпадающий список координаторов вместо колонки и свободного текста"
```

---

### Task 13: Заявки — колонка «Куда направляем»

**Files:**
- Modify: `dashboard/home-groups.html`
- Modify: `tests/dashboardRequestStatuses.spec.ts`

- [ ] **Step 1: Написать падающий тест**

```ts
describe('«Куда направляем»', () => {
  test('колонка есть в шапке и показывает существующее поле «Рекомендованная группа»', () => {
    expect(html).toContain('<th>Куда направляем</th>');
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npx vitest run tests/dashboardRequestStatuses.spec.ts -t "Куда направляем"`
Expected: FAIL.

- [ ] **Step 3: Добавить колонку**

Шапка — итоговый порядок колонок:

```html
          <tr>
            <th>Дата</th>
            <th>Человек</th>
            <th>Телефон</th>
            <th>Место</th>
            <th>Домашняя группа</th>
            <th>Куда направляем</th>
            <th>Статус</th>
          </tr>
```

В `renderRequests()`, перед ячейкой статуса:

```js
      <td>${groupLabel(r.group_id)}</td>
      <td>${esc(r.recommended) || '—'}</td>
      <td><span class="pill ${cls}"><i></i>${esc(label)}</span></td>
```

и увеличить `colspan` детальной строки с 6 до 7 — колонок снова стало на одну больше:

```js
    <tr class="detail hidden"><td colspan="7">${requestDetails(r)}</td></tr>`;
```

- [ ] **Step 4: Запустить и убедиться, что проходит**

Run: `npx vitest run tests/dashboardRequestStatuses.spec.ts`
Expected: PASS.

- [ ] **Step 5: Живая проверка в браузере**

Убедиться, что колонка показывает то же значение, что раньше было видно только в раскрытой строке как «Рекомендованная группа».

- [ ] **Step 6: Commit**

```bash
git add dashboard/home-groups.html tests/dashboardRequestStatuses.spec.ts
git commit -m "Заявки: видимая колонка «Куда направляем»"
```

---

### Task 14: Итоговая проверка

**Files:** нет изменений — только verification.

- [ ] **Step 1: Полный набор тестов**

Run: `npm test`
Expected: `Test Files` без `failed` (см. ловушку в `CLAUDE.md`: если тестовая база не поднята, файлы с базой падают на `beforeAll`, а сами тесты в них показываются как `skipped` — итоговая строка `Tests … passed` при этом выглядит зелёной).

- [ ] **Step 2: Проверка типов**

Run: `npm run typecheck`
Expected: без ошибок.

- [ ] **Step 3: Мутационная проверка новых веток логики**

Для `campaignIsActive` (Task 2) и `activeLeaderByPhone`/`leadPhoneTaken` (Task 3) — временно сломать реализацию (например, инвертировать `day >= 1 && day <= opts.totalDays` на `day < 1 || day > opts.totalDays`) и убедиться, что соответствующий тест краснеет, затем вернуть как было. Это разовая ручная проверка, в код не попадает.

- [ ] **Step 4: Ручной прогон живого дашборда по всем восьми пунктам**

Открыть дашборд (см. Task 9, Step 9) и пройти по списку: переименованные вкладки, бейдж и фильтр «40 дней», подбор ведущего с полным профилем, код группы, назначение и рекомендация группы для заявки с фильтром, «Ответственный» как список и не как колонка, колонка «Куда направляем».

- [ ] **Step 5: Обновить README дашборда для служителей**

Файл `КАК-РАБОТАЕТ-ДАШБОРД.md` описывает разделы для людей без технического бэкграунда (правило из `CLAUDE.md`: «правя поведение, поправьте и их»). Обновить как минимум:
- раздел «Шапка»: `Обзор` → `Домашние группы`, `Заявки` → `Заявки (МДГ)`;
- раздел «Обзор» → переименовать в «Домашние группы», дописать про бейдж и фильтр «40 дней», подбор ведущего, код группы;
- раздел «Заявки»: дописать про колонку «Домашняя группа» (с рекомендацией по возрасту и фильтром), колонку «Куда направляем», и что «Ответственный» теперь выбирается из списка внутри раскрытой заявки, а не отдельной колонкой.

- [ ] **Step 6: Commit**

```bash
git add КАК-РАБОТАЕТ-ДАШБОРД.md
git commit -m "Документация для служителей: правки дашборда по кампании и заявкам"
```

---

## Что не входит в этот план

Пункт 5 (минимальная статистика для координаторов в самом боте) — отдельная спека и отдельный план: у координаторов сегодня нет способа подтвердить свою личность боту, это самостоятельное архитектурное решение, а не продолжение этого плана.
