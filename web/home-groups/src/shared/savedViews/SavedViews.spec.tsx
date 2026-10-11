import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { buildRequests } from '../../fixtures/build';
import { countBuckets } from '../../features/requests/model';
import { currentSearch, renderAt, stubFetchWithFixtures } from '../../test/render';
import { STORAGE_KEY } from './storage';
import { resetSavedViewsMemory } from './storage';
import type { StoredView } from './model';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetSavedViewsMemory();
});

const stored = (): StoredView[] => JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]');
const seed = (views: StoredView[]) => window.localStorage.setItem(STORAGE_KEY, JSON.stringify(views));
const rowsOf = () => within(screen.getByRole('list', { name: 'Список заявок' })).getAllByRole('listitem');

async function openPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /^Мои виды/ }));
  return screen.getByRole('dialog', { name: 'Мои виды' });
}

describe('«Мои виды» на «Заявках»', () => {
  test('текущий отбор сохраняется под именем без вкладки и открытой заявки', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=requests&bucket=ready&resp=' + encodeURIComponent('Анна Л.') + '&req=1');
    await screen.findByRole('list', { name: 'Список заявок' });
    const dlg = await openPanel(user);
    await user.type(within(dlg).getByLabelText('Как назвать вид'), 'Готовые Анны');
    await user.click(within(dlg).getByRole('button', { name: 'Сохранить текущий вид' }));
    expect(stored()).toHaveLength(1);
    const view = stored()[0]!;
    expect(view).toMatchObject({ scope: 'requests', name: 'Готовые Анны' });
    const q = new URLSearchParams(view.query);
    expect(q.get('bucket')).toBe('ready');
    expect(q.get('resp')).toBe('Анна Л.');
    for (const k of ['tab', 'req', 'rec']) expect(q.has(k)).toBe(false);
    expect(within(dlg).getByRole('button', { name: /^Готовые Анны/ })).toBeInTheDocument();
  });

  test('поиск по имени сохраняется только при отметке «Сохранить и поиск»', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=requests&q=' + encodeURIComponent('Соколова'));
    await screen.findByRole('list', { name: 'Список заявок' });
    const dlg = await openPanel(user);
    const box = within(dlg).getByRole('checkbox', { name: 'Сохранить и поиск' });
    expect(box).not.toBeChecked();
    await user.type(within(dlg).getByLabelText('Как назвать вид'), 'Без поиска');
    await user.click(within(dlg).getByRole('button', { name: 'Сохранить текущий вид' }));
    expect(new URLSearchParams(stored()[0]!.query).has('q')).toBe(false);

    await user.click(box);
    await user.clear(within(dlg).getByLabelText('Как назвать вид'));
    await user.type(within(dlg).getByLabelText('Как назвать вид'), 'С поиском');
    await user.click(within(dlg).getByRole('button', { name: 'Сохранить текущий вид' }));
    expect(new URLSearchParams(stored().find((v) => v.name === 'С поиском')!.query).get('q')).toBe('Соколова');
  });

  test('сохранённый вид применяется одним нажатием: отбор заменяется, открытая заявка закрывается', async () => {
    stubFetchWithFixtures();
    seed([{ scope: 'requests', name: 'Нужна помощь', query: 'bucket=human' }]);
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=requests&bucket=ready&resp=' + encodeURIComponent('Анна Л.') + '&req=1');
    await screen.findByRole('list', { name: 'Список заявок' });
    const dlg = await openPanel(user);
    await user.click(within(dlg).getByRole('button', { name: /^Нужна помощь/ }));
    const p = currentSearch();
    expect(p.get('bucket')).toBe('human');
    expect(p.has('resp')).toBe(false);
    expect(p.has('req')).toBe(false);
    expect(p.get('tab')).toBe('requests');
    expect(rowsOf()).toHaveLength(countBuckets(buildRequests().items).human);
    expect(within(dlg).getByRole('status')).toHaveTextContent('Вид «Нужна помощь» применён.');
  });

  test('вид удаляется из списка и из хранилища', async () => {
    stubFetchWithFixtures();
    seed([
      { scope: 'requests', name: 'Первый', query: 'bucket=ready' },
      { scope: 'requests', name: 'Второй', query: 'bucket=done' },
    ]);
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=requests');
    await screen.findByRole('list', { name: 'Список заявок' });
    const dlg = await openPanel(user);
    await user.click(within(dlg).getByRole('button', { name: 'Удалить вид «Первый»' }));
    expect(within(dlg).queryByRole('button', { name: /^Первый/ })).not.toBeInTheDocument();
    expect(within(dlg).getByRole('button', { name: /^Второй/ })).toBeInTheDocument();
    expect(stored().map((v) => v.name)).toEqual(['Второй']);
  });

  test('на «Заявках» не видны виды «Справочника»', async () => {
    stubFetchWithFixtures();
    seed([
      { scope: 'reference', name: 'Чужой', query: 'ent=people' },
      { scope: 'requests', name: 'Свой', query: 'bucket=ready' },
    ]);
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=requests');
    await screen.findByRole('list', { name: 'Список заявок' });
    const dlg = await openPanel(user);
    expect(within(dlg).getByRole('button', { name: /^Свой/ })).toBeInTheDocument();
    expect(within(dlg).queryByRole('button', { name: /^Чужой/ })).not.toBeInTheDocument();
  });

  test('пустое имя не сохраняется и объясняется, поле не длиннее сорока знаков', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=requests');
    await screen.findByRole('list', { name: 'Список заявок' });
    const dlg = await openPanel(user);
    expect(within(dlg).getByLabelText('Как назвать вид')).toHaveAttribute('maxlength', '40');
    await user.click(within(dlg).getByRole('button', { name: 'Сохранить текущий вид' }));
    expect(within(dlg).getByRole('status')).toHaveTextContent('Введите название вида.');
    expect(stored()).toEqual([]);
  });

  test('двадцать первый вид не сохраняется: панель говорит о пределе', async () => {
    stubFetchWithFixtures();
    seed(Array.from({ length: 20 }, (_, i) => ({ scope: 'requests' as const, name: `Вид ${i}`, query: 'bucket=ready' })));
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=requests');
    await screen.findByRole('list', { name: 'Список заявок' });
    const dlg = await openPanel(user);
    await user.type(within(dlg).getByLabelText('Как назвать вид'), 'Лишний');
    await user.click(within(dlg).getByRole('button', { name: 'Сохранить текущий вид' }));
    expect(within(dlg).getByRole('status')).toHaveTextContent('Можно хранить не больше 20 видов');
    expect(stored()).toHaveLength(20);
  });

  test('в списке видно, что вид хранит: корзину, «в работе у» и поиск', async () => {
    stubFetchWithFixtures();
    seed([{ scope: 'requests', name: 'Мои', query: 'bucket=queue&resp=' + encodeURIComponent('Пётр Г.') + '&q=Орлов' }]);
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=requests');
    await screen.findByRole('list', { name: 'Список заявок' });
    const dlg = await openPanel(user);
    const btn = within(dlg).getByRole('button', { name: /^Мои/ });
    expect(btn).toHaveTextContent('К обзвону');
    expect(btn).toHaveTextContent('в работе у Пётр Г.');
    expect(btn).toHaveTextContent('поиск «Орлов»');
  });
});

describe('«Мои виды» без хранилища браузера', () => {
  const breakStorage = () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('хранилище закрыто');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('хранилище закрыто');
    });
  };

  test('панель не падает, вид живёт до закрытия страницы, об этом сказано', async () => {
    stubFetchWithFixtures();
    breakStorage();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=requests&bucket=ready');
    await screen.findByRole('list', { name: 'Список заявок' });
    const dlg = await openPanel(user);
    await user.type(within(dlg).getByLabelText('Как назвать вид'), 'Временный');
    await user.click(within(dlg).getByRole('button', { name: 'Сохранить текущий вид' }));
    expect(within(dlg).getByRole('button', { name: /^Временный/ })).toBeInTheDocument();
    expect(within(dlg).getByText(/сохранятся только до закрытия страницы/)).toBeInTheDocument();
  });

  test('при уходе на другую вкладку и возврате временный вид остаётся', async () => {
    stubFetchWithFixtures();
    breakStorage();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=requests');
    await screen.findByRole('list', { name: 'Список заявок' });
    let dlg = await openPanel(user);
    await user.type(within(dlg).getByLabelText('Как назвать вид'), 'Временный');
    await user.click(within(dlg).getByRole('button', { name: 'Сохранить текущий вид' }));
    await user.click(screen.getByRole('tab', { name: /^Справочник/ }));
    await screen.findByRole('table');
    await user.click(screen.getByRole('tab', { name: /^Заявки/ }));
    await screen.findByRole('list', { name: 'Список заявок' });
    dlg = await openPanel(user);
    expect(within(dlg).getByRole('button', { name: /^Временный/ })).toBeInTheDocument();
  });
});

