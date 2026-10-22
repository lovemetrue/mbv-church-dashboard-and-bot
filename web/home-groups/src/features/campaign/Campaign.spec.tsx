import type { CampaignView, Me } from '@contracts';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { buildCampaign } from '../../fixtures/campaign';
import { currentSearch, makeClient, renderAt, stubFetchWithFixtures } from '../../test/render';
import { getsOf, json } from '../../test/calls';
import { CAMPAIGN_KEY } from './useCampaign';

afterEach(() => vi.unstubAllGlobals());

/** Статистика, где каждое число своё: перепутанное поле или разрез не пройдёт незамеченным. */
const view = (patch: Partial<CampaignView> = {}): CampaignView => ({
  participants: { registered: 87, complete: 61, incomplete: 26, kitsIssued: 43, blocked: 5, unfinished: 17 },
  mdg: { open: 9, home: 6, join: 31, member: 22, leader: 11 },
  byPlatform: [
    { platform: 'telegram', registered: 58, complete: 42, incomplete: 16, kitsIssued: 30, blocked: 3, unfinished: 12 },
    { platform: 'max', registered: 29, complete: 19, incomplete: 10, kitsIssued: 13, blocked: 2, unfinished: 5 },
  ],
  newRequests: 14,
  days: {
    loaded: 3,
    total: 40,
    ranges: '1-2, 7',
    list: Array.from({ length: 40 }, (_, i) => {
      const day = i + 1;
      const loaded = day === 1 || day === 2 || day === 7;
      return { day, loaded, length: loaded ? day * 100 + 5 : 0 };
    }),
  },
  day: { state: 'идёт', number: 13, total: 40, startDate: '2026-09-28' },
  broadcasts: [
    { key: 'day:12', createdAt: '2026-10-10', finished: true, sent: 71, pending: 0, failed: 2, blocked: 3 },
    { key: 'day:11', createdAt: '2026-10-09', finished: false, sent: 40, pending: 28, failed: 1, blocked: 4 },
  ],
  ...patch,
});

function openCampaign(data: CampaignView | (() => Response) = view(), role: Me['role'] = 'super', url = '/?tab=team&sec=campaign') {
  const client = makeClient();
  const fetchMock = stubFetchWithFixtures({
    campaign: typeof data === 'function' ? data : () => json(data),
    me: () => json({ role }),
  });
  renderAt(<App />, url, client);
  return { fetchMock, client };
}

const region = (name: string) => screen.findByRole('region', { name });
const valueOf = (scope: HTMLElement, label: string) => within(scope).getByText(label).parentElement!;

describe('«Команда»: переключатель разделов', () => {
  test('по умолчанию открыт сегодняшний экран «Заявки», а кампанию никто не запрашивает', async () => {
    const { fetchMock } = openCampaign(view(), 'super', '/?tab=team');
    expect(await screen.findByRole('region', { name: 'Итоги по заявкам' })).toBeInTheDocument();
    const group = screen.getByRole('group', { name: 'Разделы «Команды»' });
    expect(within(group).getByRole('button', { name: 'Заявки' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: 'Кампания «40 дней»' })).toHaveAttribute('aria-pressed', 'false');
    expect(getsOf(fetchMock, 'campaign')).toBe(0);
  });

  test('верхних вкладок семь (с «Группами» и «Наборами»): кампания живёт внутри «Команды»', async () => {
    openCampaign();
    await region('Итоги кампании');
    const tabs = within(screen.getByRole('tablist', { name: 'Разделы' })).getAllByRole('tab');
    // У «Заявок» на вкладке стоит число открытых, его в сравнение не берём.
    expect(tabs.map((t) => (t.textContent ?? '').replace(/\d+$/, ''))).toEqual(['Сегодня', 'Заявки', 'Группы', 'Наборы', 'Команда', 'Справочник', 'Настройки']);
    expect(screen.getByRole('tab', { name: 'Команда' })).toHaveAttribute('aria-selected', 'true');
  });

  test('«Кампания» пишет раздел в адрес, «Заявки» возвращает обычный адрес', async () => {
    openCampaign(view(), 'super', '/?tab=team');
    const user = userEvent.setup();
    await screen.findByRole('region', { name: 'Итоги по заявкам' });
    await user.click(screen.getByRole('button', { name: 'Кампания «40 дней»' }));
    await region('Итоги кампании');
    expect(currentSearch().get('sec')).toBe('campaign');
    expect(currentSearch().get('tab')).toBe('team');
    expect(screen.queryByRole('region', { name: 'Итоги по заявкам' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Заявки' }));
    expect(await screen.findByRole('region', { name: 'Итоги по заявкам' })).toBeInTheDocument();
    expect(currentSearch().has('sec')).toBe(false);
  });

  test('блок «Выгрузка» остаётся в разделе «Заявки» и не появляется в кампании', async () => {
    openCampaign(view(), 'super', '/?tab=team');
    expect(await screen.findByRole('region', { name: 'Выгрузка' })).toBeInTheDocument();
    cleanup();
    openCampaign(view(), 'super', '/?tab=team&sec=campaign');
    await region('Итоги кампании');
    await act(async () => {});
    expect(screen.queryByRole('region', { name: 'Выгрузка' })).not.toBeInTheDocument();
  });
});

describe('«Кампания»: плитки', () => {
  test('каждая плитка показывает своё число', async () => {
    openCampaign();
    const tiles = await region('Итоги кампании');
    expect(valueOf(tiles, 'Зарегистрировано')).toHaveTextContent('87');
    expect(valueOf(tiles, 'Зарегистрировано')).toHaveTextContent('с полной анкетой: 61');
    expect(valueOf(tiles, 'Наборов выдано')).toHaveTextContent('43');
    expect(valueOf(tiles, 'Бросили анкету')).toHaveTextContent('17');
    expect(valueOf(tiles, 'Новых заявок')).toHaveTextContent('14');
    expect(valueOf(tiles, 'День кампании')).toHaveTextContent('13 из 40');
  });

  test.each([
    ['идёт', 13, '13 из 40'],
    ['до старта', 0, 'до старта'],
    ['завершена', 41, 'завершена'],
  ] as const)('день кампании в состоянии «%s» подписан словами', async (state, number, text) => {
    openCampaign(view({ day: { state, number, total: 40, startDate: '2026-09-28' } }));
    const tiles = await region('Итоги кампании');
    const cell = valueOf(tiles, 'День кампании');
    expect(cell).toHaveTextContent(text);
    expect(cell).toHaveTextContent('старт: 28.09.2026');
    if (state !== 'идёт') expect(cell).not.toHaveTextContent('из 40');
  });
});

describe('«Кампания»: разрезы', () => {
  test('ответы про Малую группу: у каждой подписи своё число', async () => {
    openCampaign();
    const list = await screen.findByRole('list', { name: 'Ответы про Малую группу' });
    const rows = within(list).getAllByRole('listitem').map((li) => li.textContent);
    expect(rows).toEqual([
      'Хотят открыть группу9',
      'Готовы дать дом6',
      'Ищут группу31',
      'Уже состоят в группе22',
      'Ведут группу11',
    ]);
  });

  test('по мессенджерам: Telegram и MAX не перепутаны, у каждого свои числа', async () => {
    openCampaign();
    const list = await screen.findByRole('list', { name: 'Участники по мессенджерам' });
    const [tg, max] = within(list).getAllByRole('listitem');
    expect(within(tg!).getByRole('heading', { name: 'Telegram' })).toBeInTheDocument();
    expect(valueOf(tg!, 'Зарегистрировано')).toHaveTextContent('58');
    expect(valueOf(tg!, 'С полной анкетой')).toHaveTextContent('42');
    expect(valueOf(tg!, 'Наборов выдано')).toHaveTextContent('30');
    expect(valueOf(tg!, 'Бросили анкету')).toHaveTextContent('12');
    expect(valueOf(tg!, 'Заблокировали бота')).toHaveTextContent('3');
    expect(within(max!).getByRole('heading', { name: 'MAX' })).toBeInTheDocument();
    expect(valueOf(max!, 'Зарегистрировано')).toHaveTextContent('29');
    expect(valueOf(max!, 'С полной анкетой')).toHaveTextContent('19');
    expect(valueOf(max!, 'Наборов выдано')).toHaveTextContent('13');
    expect(valueOf(max!, 'Бросили анкету')).toHaveTextContent('5');
    expect(valueOf(max!, 'Заблокировали бота')).toHaveTextContent('2');
  });

  test('если никто ещё не зарегистрировался, вместо пустого списка сказано словами', async () => {
    openCampaign(view({ byPlatform: [] }));
    const section = await region('По мессенджерам');
    expect(within(section).getByText('Пока никто не зарегистрировался.')).toBeInTheDocument();
    expect(within(section).queryByRole('list')).not.toBeInTheDocument();
  });
});

describe('«Кампания»: сорок дней и рассылки', () => {
  test('сетка показывает все сорок дней: загружен или нет, плюс диапазоны под ней', async () => {
    openCampaign();
    const grid = await screen.findByRole('list', { name: 'Материалы по дням кампании' });
    const cells = within(grid).getAllByRole('listitem');
    expect(cells).toHaveLength(40);
    expect(cells[0]).toHaveTextContent('День 1: материал загружен, 105 зн.');
    expect(cells[1]).toHaveTextContent('День 2: материал загружен, 205 зн.');
    expect(cells[2]).toHaveTextContent('День 3: материала нет');
    expect(cells[6]).toHaveTextContent('День 7: материал загружен, 705 зн.');
    expect(cells[39]).toHaveTextContent('День 40: материала нет');
    const section = await region('Материалы по дням');
    expect(within(section).getByText('Загружены дни: 1-2, 7')).toBeInTheDocument();
    expect(within(section).getByText('Загружено дней: 3 из 40')).toBeInTheDocument();
  });

  test('если ни один день не загружен, подпись об этом, а не пустые диапазоны', async () => {
    const empty = view();
    openCampaign({
      ...empty,
      days: { ...empty.days, loaded: 0, ranges: '', list: empty.days.list.map((d) => ({ ...d, loaded: false, length: 0 })) },
    });
    const section = await region('Материалы по дням');
    expect(within(section).getByText('Загруженных дней пока нет.')).toBeInTheDocument();
    expect(within(section).queryByText(/Загружены дни/)).not.toBeInTheDocument();
  });

  test('журнал рассылок: отправлено, не дошло, заблокировано и закончена ли', async () => {
    openCampaign();
    const log = await screen.findByRole('list', { name: 'Журнал рассылок' });
    const [done, running] = within(log).getAllByRole('listitem');
    expect(done).toHaveTextContent('День 12');
    expect(done).toHaveTextContent('10.10.2026');
    expect(valueOf(done!, 'Отправлено')).toHaveTextContent('71');
    expect(valueOf(done!, 'Не дошло')).toHaveTextContent('2');
    expect(valueOf(done!, 'Заблокировали')).toHaveTextContent('3');
    expect(done).toHaveTextContent('Закончена');
    expect(done).not.toHaveTextContent('Ждут отправки');
    expect(running).toHaveTextContent('День 11');
    expect(valueOf(running!, 'Отправлено')).toHaveTextContent('40');
    expect(valueOf(running!, 'Не дошло')).toHaveTextContent('1');
    expect(valueOf(running!, 'Заблокировали')).toHaveTextContent('4');
    expect(valueOf(running!, 'Ждут отправки')).toHaveTextContent('28');
    expect(running).toHaveTextContent('Идёт');
    expect(running).not.toHaveTextContent('Закончена');
  });

  test('пояснение, где загружаются материалы и отправляются рассылки', async () => {
    openCampaign();
    await region('Итоги кампании');
    expect(screen.getByText('Материалы загружаются и рассылки отправляются в боте.')).toBeInTheDocument();
  });

  test('демо-данные кампании собираются в тот же вид', () => {
    const c = buildCampaign();
    expect(c.days.list).toHaveLength(c.days.total);
    expect(c.days.list.filter((d) => d.loaded)).toHaveLength(c.days.loaded);
    expect(c.byPlatform.reduce((n, p) => n + p.registered, 0)).toBe(c.participants.registered);
  });
});

describe('«Кампания»: загрузка, сбои и обновление', () => {
  test('404 — расписание не задано: понятное сообщение без кнопки «Повторить»', async () => {
    openCampaign(() => json({ error: 'not_found' }, 404));
    expect(await screen.findByText('Кампания пока не настроена')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Повторить' })).not.toBeInTheDocument();
  });

  test('сбой сервера показывает «Не удалось загрузить» с кнопкой «Повторить»', async () => {
    openCampaign(() => json({}, 500));
    expect(await screen.findByText('Не удалось загрузить.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
  });

  test('опрос раз в минуту: данные кампании обновляются сами', async () => {
    const { client } = openCampaign();
    await region('Итоги кампании');
    const query = client.getQueryCache().find({ queryKey: CAMPAIGN_KEY });
    expect(query).toBeDefined();
    const options = query!.observers[0]!.options;
    expect(options.refetchInterval).toBe(60_000);
    expect(options.refetchIntervalInBackground).toBe(false);
  });

  test('сбой фонового обновления оставляет прежние числа и пишет короткую пометку', async () => {
    let fail = false;
    const { client } = openCampaign(() => (fail ? json({}, 500) : json(view())));
    await region('Итоги кампании');
    fail = true;
    await act(async () => {
      await client.refetchQueries({ queryKey: CAMPAIGN_KEY });
    });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Не удалось обновить данные. Показаны прежние.'));
    expect(valueOf(screen.getByRole('region', { name: 'Итоги кампании' }), 'Наборов выдано')).toHaveTextContent('43');
  });
});
