import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { getsOf, json, posts } from '../../test/calls';
import { currentSearch, makeClient, renderAt, stubFetchWithFixtures } from '../../test/render';
import { queryKeys } from '../../shared/api/queries';
import type { YMaps } from '../../shared/yandexMaps';
import type { GroupItem, MapBootstrap } from '@contracts';
import { fixtureResponse } from '../../fixtures';
import { MAP_VIEW_KEY, mapTiming, resetMapSession } from './mapSession';

/** Подставная Яндекс.Карта: запоминает метки и вид, отдаёт их тесту, чтобы нажать на метку и сдвинуть карту. */
type Placed = { coords: [number, number]; props: Record<string, unknown>; options: Record<string, unknown>; click: () => void };
const placed: Placed[] = [];
const created: { center: [number, number]; zoom: number; move: (center: [number, number], zoom: number) => void }[] = [];
let destroyed = 0;
const loadMock = vi.fn();

vi.mock('../../shared/yandexMaps', () => ({
  loadYandexMaps: (key: string) => loadMock(key),
}));

function fakeYmaps(): YMaps {
  return {
    ready: (cb: () => void) => cb(),
    Map: class {
      center: [number, number];
      zoom: number;
      handlers: (() => void)[] = [];
      events = { add: (_t: string, h: () => void) => { this.handlers.push(h); } };
      geoObjects = {
        add: (p: Placed) => { placed.push(p); },
        remove: (p: Placed) => { const i = placed.indexOf(p); if (i >= 0) placed.splice(i, 1); },
      };
      constructor(_el: HTMLElement, state: { center: [number, number]; zoom: number }) {
        this.center = state.center;
        this.zoom = state.zoom;
        created.push({ center: state.center, zoom: state.zoom, move: (c, z) => { this.center = c; this.zoom = z; this.handlers.forEach((h) => h()); } });
      }
      setBounds() { this.center = [59.9, 30.3]; this.zoom = 10; }
      getCenter() { return this.center; }
      getZoom() { return this.zoom; }
      destroy() { destroyed += 1; }
    },
    Placemark: class {
      events: { add: (type: string, h: () => void) => void };
      click: () => void = () => {};
      constructor(public coords: [number, number], public props: Record<string, unknown>, public options: Record<string, unknown>) {
        this.events = { add: (_t, h) => { this.click = h; } };
      }
    },
  } as unknown as YMaps;
}

beforeEach(() => {
  placed.length = 0;
  created.length = 0;
  destroyed = 0;
  loadMock.mockReset();
  loadMock.mockResolvedValue(fakeYmaps());
  mapTiming.snapshotDelayMs = 0;
  delete (window as { ymaps?: unknown }).ymaps;
});
afterEach(() => vi.unstubAllGlobals());

const BOOT: MapBootstrap = { apiKey: 'demo-map-key', loadsToday: 7, dailyLimit: 100, staticReady: false, snapshot: null };
const SNAPSHOT = { takenAt: '2026-11-20T09:05:00.000Z', marks: 4, skipped: 0 };
const groupsFixture = () => fixtureResponse('groups') as { items: GroupItem[] };
const hintOf = (g: GroupItem) => `${g.code}, ${g.leader}`;
const onMap = (g: GroupItem) => placed.some((p) => p.props.hintContent === hintOf(g));

async function openMap(overrides: Parameters<typeof stubFetchWithFixtures>[0] = {}, boot: Partial<MapBootstrap> = {}, client = makeClient()) {
  const fetchMock = stubFetchWithFixtures({
    me: () => json({ role: 'super' }),
    'map/config': () => json({ ...BOOT, ...boot }),
    'map/loaded': () => json({ ...BOOT, ...boot, loadsToday: 8 }),
    'map/snapshot': () => json({ ok: true, snapshot: { takenAt: '2026-11-20T10:00:00.000Z', marks: 3, skipped: 0 } }),
    ...overrides,
  });
  renderAt(<App />, '/', client);
  const box = await screen.findByRole('region', { name: 'Карта групп' });
  return { box, fetchMock, client };
}
const showButton = (box: HTMLElement) => within(box).findByRole('button', { name: /Показать карту|Обновить/ });
async function goLive(box: HTMLElement) {
  const user = userEvent.setup();
  await user.click(await showButton(box));
  await waitFor(() => expect(placed.length).toBeGreaterThan(0));
  return user;
}

describe('«Сегодня»: карта групп', () => {
  test('после загрузки страницы без снимка карта не грузится сама: кнопка с расходом за сутки, скрипт не запрошен', async () => {
    const { box, fetchMock } = await openMap();
    await within(box).findByRole('button', { name: /Показать карту \(открытий сегодня: 7 из 100\)/ });
    expect(loadMock).not.toHaveBeenCalled();
    expect(posts(fetchMock).some((p) => p.path === 'map/loaded')).toBe(false);
  });

  test('есть снимок — после загрузки страницы видна картинка с датой и кнопка «Обновить», живая карта не грузится', async () => {
    // Вид сохранён с прошлого раза: снимок уже от него, заново не снимаем.
    window.localStorage.setItem(MAP_VIEW_KEY, JSON.stringify({ center: [59.9, 30.3], zoom: 11 }));
    const { box, fetchMock } = await openMap({}, { staticReady: true, snapshot: SNAPSHOT });
    const img = await within(box).findByRole('img', { name: 'Снимок карты домашних групп' });
    expect(img.getAttribute('src')).toMatch(/api\/v1\/map\/snapshot\.png\?t=2026-11-20T09%3A05%3A00\.000Z$/);
    expect(within(box).getByText(/Снимок карты от 20\.11\.2026/)).toBeInTheDocument();
    expect(within(box).getByRole('button', { name: /Обновить \(открытий сегодня: 7 из 100\)/ })).toBeEnabled();
    await new Promise((r) => setTimeout(r, 20));
    expect(loadMock).not.toHaveBeenCalled();
    expect(posts(fetchMock).some((p) => p.path === 'map/loaded' || p.path === 'map/snapshot')).toBe(false);
  });

  test('на снимке сменили фильтр — снимок переснимается от того же вида, живая карта не грузится', async () => {
    window.localStorage.setItem(MAP_VIEW_KEY, JSON.stringify({ center: [59.9, 30.3], zoom: 11 }));
    const user = userEvent.setup();
    const { box, fetchMock } = await openMap({}, { staticReady: true, snapshot: SNAPSHOT });
    await within(box).findByRole('img', { name: 'Снимок карты домашних групп' });
    await waitFor(() => expect(within(box).getByText(/На карте групп: [1-9]/)).toBeInTheDocument());
    await user.click(within(box).getByRole('checkbox', { name: 'Действующие' }));
    await waitFor(() => expect(posts(fetchMock).some((p) => p.path === 'map/snapshot')).toBe(true));
    expect(posts(fetchMock).find((p) => p.path === 'map/snapshot')!.body).toMatchObject({ center: { lat: 59.9, lon: 30.3 }, zoom: 11 });
    // Ответ сервера — новый снимок: картинка берётся по новому адресу.
    await waitFor(() => expect(within(box).getByRole('img', { name: 'Снимок карты домашних групп' }).getAttribute('src')).toMatch(/10%3A00%3A00/));
    expect(loadMock).not.toHaveBeenCalled();
  });

  test('«Обновить» включает живую карту: одно открытие в счётчике, свежие данные групп, снимок со страницы уходит', async () => {
    const { box, fetchMock } = await openMap({}, { staticReady: true, snapshot: SNAPSHOT });
    const before = getsOf(fetchMock, 'groups');
    await goLive(box);
    expect(posts(fetchMock).filter((p) => p.path === 'map/loaded')).toHaveLength(1);
    expect(loadMock).toHaveBeenCalledWith('demo-map-key');
    expect(getsOf(fetchMock, 'groups')).toBeGreaterThan(before);
    expect(within(box).queryByRole('img', { name: 'Снимок карты домашних групп' })).toBeNull();
    expect(within(box).getByRole('button', { name: 'Обновить' })).toBeInTheDocument();
    expect(within(box).getByText(/На карте групп: \d+\. Без координат: \d+\./)).toBeInTheDocument();
  });

  test('переходы между вкладками лимит не тратят: вернувшись на «Сегодня», карта живая сразу, без кнопки', async () => {
    const { box, fetchMock } = await openMap();
    const user = await goLive(box);
    await user.click(screen.getByRole('tab', { name: /^Заявки/ }));
    await screen.findByRole('list', { name: 'Список заявок' });
    placed.length = 0;
    await user.click(screen.getByRole('tab', { name: 'Сегодня' }));
    await waitFor(() => expect(placed.length).toBeGreaterThan(0));
    expect(posts(fetchMock).filter((p) => p.path === 'map/loaded')).toHaveLength(1);
  });

  test('метки зафиксированы между нажатиями «Обновить»: новые данные групп появляются на карте только по кнопке', async () => {
    let base = groupsFixture();
    const { box, fetchMock, client } = await openMap({ groups: () => json(base) });
    const user = await goLive(box);
    const moved = base.items.find((g) => onMap(g))!;
    // Группу закрыли, и список групп в фоне обновился, а картина на карте — нет, пока не нажали «Обновить».
    base = { ...base, items: base.items.map((g) => (g.id === moved.id ? { ...g, status: 'Закрыта' } : g)) };
    const gets = getsOf(fetchMock, 'groups');
    await client.refetchQueries({ queryKey: queryKeys.groups });
    expect(getsOf(fetchMock, 'groups')).toBeGreaterThan(gets);
    await new Promise((r) => setTimeout(r, 20));
    expect(onMap(moved)).toBe(true);
    await user.click(within(box).getByRole('button', { name: 'Обновить' }));
    await waitFor(() => expect(onMap(moved)).toBe(false));
  });

  test('клик по метке открывает карточку этой группы', async () => {
    const { box } = await openMap();
    await goLive(box);
    placed[0]!.click();
    await waitFor(() => expect(currentSearch().get('rec')).toMatch(/^\d+$/));
  });

  test('камерных групп на карте нет никогда, «Не направлять» скрыты; галочка показывает их серой меткой, камерные — всё равно нет', async () => {
    const fixture = groupsFixture();
    const usable = fixture.items.filter((g) => g.coords !== null && g.status === 'Функционирует' && !g.chamber && g.district !== 'Онлайн');
    const [chamber, noRefer] = [usable[0]!, usable[1]!];
    const items = fixture.items.map((g) => (g.id === chamber.id ? { ...g, chamber: true, doNotRefer: true } : g.id === noRefer.id ? { ...g, doNotRefer: true } : g));
    const { box } = await openMap({ groups: () => json({ ...fixture, items }) });
    const user = await goLive(box);
    const checkbox = within(box).getByRole('checkbox', { name: 'Не направлять' });
    expect(checkbox).not.toBeChecked();
    expect(onMap(noRefer)).toBe(false);
    expect(onMap(chamber)).toBe(false);
    await user.click(checkbox);
    await waitFor(() => expect(onMap(noRefer)).toBe(true));
    expect(placed.find((p) => p.props.hintContent === hintOf(noRefer))!.options.preset).toBe('islands#grayCircleDotIcon');
    expect(placed.find((p) => p.props.hintContent === hintOf(usable[2]!))!.options.preset).toBe('islands#blueCircleDotIcon');
    expect(onMap(chamber)).toBe(false);
  });

  test('переключатели «Действующие» и «Потенциальные» меняют метки без перезагрузки карты и без нового открытия', async () => {
    const { box, fetchMock } = await openMap();
    const user = await goLive(box);
    const all = placed.length;
    await user.click(within(box).getByRole('checkbox', { name: 'Действующие' }));
    await waitFor(() => expect(placed.length).toBeLessThan(all));
    await user.click(within(box).getByRole('checkbox', { name: 'Потенциальные' }));
    await waitFor(() => expect(placed).toHaveLength(0));
    expect(posts(fetchMock).filter((p) => p.path === 'map/loaded')).toHaveLength(1);
    expect(loadMock).toHaveBeenCalledTimes(1);
  });

  test('«Без онлайн-групп» отмечена сразу: онлайн-группы на карту не ставятся, а сняв галочку, их видно', async () => {
    const base = groupsFixture();
    const online = base.items.find((g) => g.coords !== null && g.status === 'Функционирует' && !g.chamber && !g.doNotRefer)!;
    const items = base.items.map((g) => (g.id === online.id ? { ...g, district: 'Онлайн' } : g));
    const { box } = await openMap({ groups: () => json({ ...base, items }) });
    const checkbox = within(box).getByRole('checkbox', { name: 'Без онлайн-групп' });
    expect(checkbox).toBeChecked();
    const user = await goLive(box);
    expect(onMap(online)).toBe(false);
    await user.click(checkbox);
    await waitFor(() => expect(onMap(online)).toBe(true));
  });

  test('фильтры как в справочнике: отбор по полю группы оставляет на карте только подходящие метки, чип отбора снимает его', async () => {
    const { box, fetchMock } = await openMap();
    const user = await goLive(box);
    const all = placed.length;
    const code = String(placed[0]!.props.hintContent).split(',')[0]!;
    await user.click(within(box).getByRole('button', { name: /^Фильтры/ }));
    const dlg = screen.getByRole('dialog', { name: 'Фильтры' });
    await user.selectOptions(within(dlg).getByLabelText('Поле'), 'Код');
    await user.click(within(dlg).getByRole('checkbox', { name: code }));
    await user.click(within(dlg).getByRole('button', { name: 'Добавить' }));
    await waitFor(() => expect(placed).toHaveLength(1));
    expect(within(box).getByText(/На карте групп: 1\./)).toBeInTheDocument();
    await user.click(within(box).getByRole('button', { name: new RegExp(`^Убрать отбор: Код`) }));
    await waitFor(() => expect(placed).toHaveLength(all));
    expect(posts(fetchMock).filter((p) => p.path === 'map/loaded')).toHaveLength(1);
    expect(loadMock).toHaveBeenCalledTimes(1);
  });

  test('центр, масштаб, переключатели и фильтры переживают перезагрузку страницы', async () => {
    const { box } = await openMap();
    const user = await goLive(box);
    await user.click(within(box).getByRole('checkbox', { name: 'Потенциальные' }));
    created.at(-1)!.move([59.8, 30.1], 13);
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem(MAP_VIEW_KEY)!)).toMatchObject({ center: [59.8, 30.1], zoom: 13, kinds: { potential: false } }));
    // «F5»: страница заново, скрипта Яндекса нет, вид — из браузера.
    const saved = window.localStorage.getItem(MAP_VIEW_KEY)!;
    cleanup();
    resetMapSession();
    window.localStorage.setItem(MAP_VIEW_KEY, saved);
    const reopened = await openMap();
    expect(within(reopened.box).getByRole('checkbox', { name: 'Потенциальные' })).not.toBeChecked();
    await goLive(reopened.box);
    expect(created.at(-1)).toMatchObject({ center: [59.8, 30.1], zoom: 13 });
  });

  test('живая карта шлёт серверу вид и номера групп с метками для снимка; без ключа Static API — не шлёт', async () => {
    const withStatic = await openMap({}, { staticReady: true });
    await goLive(withStatic.box);
    await waitFor(() => expect(posts(withStatic.fetchMock).some((p) => p.path === 'map/snapshot')).toBe(true));
    const sent = posts(withStatic.fetchMock).filter((p) => p.path === 'map/snapshot').at(-1)!.body as { center: unknown; zoom: number; groupIds: number[] };
    expect(sent.center).toEqual({ lat: 59.9, lon: 30.3 });
    expect(sent.zoom).toBe(10);
    expect(sent.groupIds).toHaveLength(placed.length);
  });

  test('без ключа Static API снимок не запрашивается', async () => {
    const { box, fetchMock } = await openMap();
    const user = await goLive(box);
    await user.click(within(box).getByRole('checkbox', { name: 'Потенциальные' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(posts(fetchMock).some((p) => p.path === 'map/snapshot')).toBe(false);
  });

  test('ключ карты не задан: кнопка неактивна, суперпользователю предложено ввести ключ', async () => {
    const user = userEvent.setup();
    const { box } = await openMap({}, { apiKey: null, loadsToday: 0 });
    expect(await within(box).findByText(/Ключ карты не задан/)).toBeInTheDocument();
    expect(within(box).getByRole('button', { name: /Показать карту/ })).toBeDisabled();
    await user.click(within(box).getByRole('button', { name: 'Ввести ключ в «Настройки → Карта»' }));
    expect(currentSearch().get('sec')).toBe('map');
  });

  test('не удалось загрузить скрипт — сообщение, а не пустая карта', async () => {
    loadMock.mockRejectedValueOnce(new Error('нет сети'));
    const user = userEvent.setup();
    const { box } = await openMap();
    await user.click(await showButton(box));
    expect(await within(box).findByRole('alert')).toHaveTextContent('Не получилось загрузить карту');
  });
});

describe('«Заявки»: карта в сворачиваемом блоке', () => {
  test('блок свёрнут; раскрыли — та же карта со свежими данными групп, даже если список групп только что загружен', async () => {
    const fetchMock = stubFetchWithFixtures({ me: () => json({ role: 'super' }), 'map/config': () => json(BOOT) });
    const user = userEvent.setup();
    // Сначала «Сегодня»: группы уже в кэше и свежие, сами по себе они не перечитаются.
    renderAt(<App />, '/');
    await screen.findByRole('region', { name: 'Карта групп' });
    await waitFor(() => expect(getsOf(fetchMock, 'groups')).toBeGreaterThan(0));
    await user.click(screen.getByRole('tab', { name: /^Заявки/ }));
    const toggle = await screen.findByRole('button', { name: 'Карта групп' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: 'Карта групп' })).toBeNull();
    const before = getsOf(fetchMock, 'groups');
    await user.click(toggle);
    const box = await screen.findByRole('region', { name: 'Карта групп' });
    await waitFor(() => expect(getsOf(fetchMock, 'groups')).toBeGreaterThan(before));
    expect(within(box).getByRole('checkbox', { name: 'Не направлять' })).toBeInTheDocument();
  });

  test('раскрытие блока при живой карте ставит метки сразу и открытий не тратит', async () => {
    const { box, fetchMock } = await openMap();
    const user = await goLive(box);
    await user.click(screen.getByRole('tab', { name: /^Заявки/ }));
    placed.length = 0;
    await user.click(await screen.findByRole('button', { name: 'Карта групп' }));
    await waitFor(() => expect(placed.length).toBeGreaterThan(0));
    expect(posts(fetchMock).filter((p) => p.path === 'map/loaded')).toHaveLength(1);
  });
});
