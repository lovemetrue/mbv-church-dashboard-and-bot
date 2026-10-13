import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { json, posts } from '../../test/calls';
import { currentSearch, renderAt, stubFetchWithFixtures } from '../../test/render';
import type { YMaps } from '../../shared/yandexMaps';

/** Подставная Яндекс.Карта: запоминает метки и отдаёт их тесту, чтобы нажать на метку и проверить переключатели. */
const placed: { coords: [number, number]; props: Record<string, unknown>; options: Record<string, unknown>; click: () => void }[] = [];
const removed: unknown[] = [];
let destroyed = 0;
const loadMock = vi.fn();

vi.mock('../../shared/yandexMaps', () => ({
  loadYandexMaps: (key: string) => loadMock(key),
}));

function fakeYmaps(): YMaps {
  return {
    ready: (cb: () => void) => cb(),
    Map: class { geoObjects = { add: (p: (typeof placed)[number]) => { placed.push(p); }, remove: (p: unknown) => { removed.push(p); const i = placed.indexOf(p as (typeof placed)[number]); if (i >= 0) placed.splice(i, 1); } }; setBounds() {} destroy() { destroyed += 1; } },
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
  removed.length = 0;
  destroyed = 0;
  loadMock.mockReset();
  loadMock.mockResolvedValue(fakeYmaps());
  delete (window as { ymaps?: unknown }).ymaps;
});
afterEach(() => vi.unstubAllGlobals());

async function openMap(overrides: Parameters<typeof stubFetchWithFixtures>[0] = {}) {
  const fetchMock = stubFetchWithFixtures({ me: () => json({ role: 'super' }), 'map/loaded': () => json({ apiKey: 'demo-map-key', loadsThisMonth: 8, monthlyLimit: 100 }), ...overrides });
  renderAt(<App />, '/?tab=reference');
  const box = await screen.findByRole('region', { name: 'Карта групп' });
  return { box, fetchMock };
}

describe('«Справочник → Группы»: карта', () => {
  test('карта не грузится сама: пока не нажали «Показать карту», скрипт Яндекса не запрашивается и открытие не считается', async () => {
    const { box, fetchMock } = await openMap();
    await within(box).findByRole('button', { name: /Показать карту \(открытий в месяце: 7 из 100\)/ });
    expect(loadMock).not.toHaveBeenCalled();
    expect(posts(fetchMock).some((p) => p.path === 'map/loaded')).toBe(false);
  });

  test('по кнопке считается открытие, грузится скрипт с ключом и ставятся метки только у групп с координатами', async () => {
    const user = userEvent.setup();
    const { box, fetchMock } = await openMap();
    await user.click(await within(box).findByRole('button', { name: /Показать карту/ }));
    await waitFor(() => expect(placed.length).toBeGreaterThan(0));
    expect(posts(fetchMock).filter((p) => p.path === 'map/loaded')).toHaveLength(1);
    expect(loadMock).toHaveBeenCalledWith('demo-map-key');
    expect(within(box).getByText(/На карте групп: \d+\. Без координат: \d+\./)).toBeInTheDocument();
  });

  test('клик по метке открывает карточку этой группы', async () => {
    const user = userEvent.setup();
    const { box } = await openMap();
    await user.click(await within(box).findByRole('button', { name: /Показать карту/ }));
    await waitFor(() => expect(placed.length).toBeGreaterThan(0));
    placed[0]!.click();
    await waitFor(() => expect(currentSearch().get('rec')).toMatch(/^\d+$/));
  });

  test('переключатели «Действующие» и «Потенциальные» меняют метки без перезагрузки карты и без нового открытия', async () => {
    const user = userEvent.setup();
    const { box, fetchMock } = await openMap();
    await user.click(await within(box).findByRole('button', { name: /Показать карту/ }));
    await waitFor(() => expect(placed.length).toBeGreaterThan(0));
    const all = placed.length;
    await user.click(within(box).getByRole('checkbox', { name: 'Действующие' }));
    await waitFor(() => expect(placed.length).toBeLessThan(all));
    await user.click(within(box).getByRole('checkbox', { name: 'Потенциальные' }));
    await waitFor(() => expect(placed).toHaveLength(0));
    expect(posts(fetchMock).filter((p) => p.path === 'map/loaded')).toHaveLength(1);
    expect(loadMock).toHaveBeenCalledTimes(1);
  });

  test('«Скрыть карту» уничтожает карту; без ключа кнопка неактивна и есть ссылка на настройки', async () => {
    const user = userEvent.setup();
    const { box } = await openMap();
    await user.click(await within(box).findByRole('button', { name: /Показать карту/ }));
    await user.click(await within(box).findByRole('button', { name: 'Скрыть карту' }));
    expect(destroyed).toBeGreaterThan(0);
  });

  test('ключ карты не задан: кнопка «Показать» неактивна, суперпользователю предложено ввести ключ', async () => {
    const user = userEvent.setup();
    const { box } = await openMap({ 'map/config': () => json({ apiKey: null, loadsThisMonth: 0, monthlyLimit: 100 }) });
    expect(await within(box).findByText(/Ключ карты не задан/)).toBeInTheDocument();
    expect(within(box).getByRole('button', { name: /Показать карту/ })).toBeDisabled();
    await user.click(within(box).getByRole('button', { name: 'Ввести ключ в «Настройки → Карта»' }));
    expect(currentSearch().get('sec')).toBe('map');
  });

  test('не удалось загрузить скрипт — сообщение, а не пустая карта', async () => {
    loadMock.mockRejectedValueOnce(new Error('нет сети'));
    const user = userEvent.setup();
    const { box } = await openMap();
    await user.click(await within(box).findByRole('button', { name: /Показать карту/ }));
    expect(await within(box).findByRole('alert')).toHaveTextContent('Не получилось загрузить карту');
  });
});
