import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { buildGroups, buildPeople } from '../../fixtures/build';
import { buildOthers } from '../../fixtures/others';
import { resetDemoStrange } from '../../fixtures/strange';
import { currentSearch, renderAt, stubFetchWithFixtures } from '../../test/render';

afterEach(() => {
  vi.unstubAllGlobals();
  resetDemoStrange();
});

const badges = (root: HTMLElement) => within(root).queryAllByRole('img', { name: /^Странный человек/ });
const dataRows = () => within(screen.getByRole('table')).getAllByRole('row').filter((r) => r.querySelector('td'));

describe('«Другие обращения»: метка', () => {
  test('значок стоит в строке отмеченного человека и больше ни в одной', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=requests&view=others');
    const list = await screen.findByRole('list', { name: 'Список обращений' });
    const marked = buildOthers().filter((o) => o.strange);
    expect(marked.map((o) => o.fio)).toEqual(['Игорь Седов']);
    expect(badges(list)).toHaveLength(1);
    const row = within(list).getByRole('button', { name: 'Игорь Седов' }).closest('li')!;
    expect(badges(row)).toHaveLength(1);
  });

  test('подсказка называет автора, дату и заметку', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=requests&view=others');
    const list = await screen.findByRole('list', { name: 'Список обращений' });
    await user.hover(badges(list)[0]!);
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'Странный человек. Отметка: mbv_admin, 09.10.2026. Звонил несколько раз за день, разговор сумбурный.',
    );
  });

  test('в карточке обращения значок в шапке и красная плашка сверху', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=requests&view=others&req=201');
    const card = await screen.findByRole('dialog', { name: /Карточка обращения/ });
    expect(badges(within(card).getByRole('heading', { level: 2 }))).toHaveLength(1);
    expect(within(card).getByRole('note', { name: 'Странный человек' })).toHaveTextContent('Звонил несколько раз за день');
  });

  test('у обращения без метки ни значка, ни плашки', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=requests&view=others&req=202');
    const card = await screen.findByRole('dialog', { name: /Карточка обращения/ });
    expect(badges(card)).toHaveLength(0);
    expect(within(card).queryByRole('note', { name: 'Странный человек' })).not.toBeInTheDocument();
  });
});

describe('Справочник → Люди: метка', () => {
  test('значок стоит в строках отмеченных людей, рядом с кнопкой открытия карточки, а не внутри неё', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=reference&ent=people');
    const table = await screen.findByRole('table');
    const marked = buildPeople().items.filter((p) => p.strange);
    expect(marked.map((p) => p.key).sort()).toEqual(['r12', 'r14', 'u2']);
    expect(badges(table)).toHaveLength(marked.length);
    for (const img of badges(table)) expect(img.closest('button')).toBeNull();
    const row = dataRows().find((r) => within(r).queryByText('Михаил Громов'))!;
    expect(badges(row)).toHaveLength(1);
  });

  test('столбец «Странный человек» можно включить, а по умолчанию он скрыт', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=reference&ent=people');
    const table = await screen.findByRole('table');
    expect(within(table).queryByRole('columnheader', { name: /Странный человек/ })).not.toBeInTheDocument();
  });

  test('быстрый отбор «Странные» оставляет только отмеченных и пишет отбор в адрес', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=reference&ent=people');
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: /^Фильтры/ }));
    await user.click(within(screen.getByRole('dialog', { name: 'Фильтры' })).getByRole('button', { name: 'Странные' }));
    expect(dataRows()).toHaveLength(3);
    expect(currentSearch().getAll('f')).toEqual(['Странный человек:eq:Да']);
    for (const name of ['Лариса Кулик', 'Георгий Шмелёв', 'Михаил Громов']) {
      expect(dataRows().some((r) => within(r).queryByText(name))).toBe(true);
    }
  });

  test('в карточке человека значок в шапке и красная плашка', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=reference&ent=people&rec=u2');
    const card = await screen.findByRole('dialog', { name: /Карточка человека/ });
    expect(badges(within(card).getByRole('heading', { level: 2 }))).toHaveLength(1);
    expect(within(card).getByRole('note', { name: 'Странный человек' })).toHaveTextContent('Резко реагирует на замечания.');
  });

  test('у человека без метки ни значка, ни плашки', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=reference&ent=people&rec=u1');
    const card = await screen.findByRole('dialog', { name: /Карточка человека/ });
    expect(badges(card)).toHaveLength(0);
    expect(within(card).queryByRole('note', { name: 'Странный человек' })).not.toBeInTheDocument();
  });
});

describe('Состав группы: метка', () => {
  test('значок стоит у отмеченного участника состава и нет у остальных', async () => {
    stubFetchWithFixtures();
    // Группа № 27 (id 2): в составе Михаил Громов, на нём стоит метка
    renderAt(<App />, '/?tab=reference&rec=2');
    const card = await screen.findByRole('dialog', { name: /Карточка группы/ });
    const members = (buildGroups().items.find((g) => g.id === 2)?.members ?? []).filter((m) => m.strange);
    expect(members.map((m) => m.fio)).toEqual(['Михаил Громов']);
    const list = await within(card).findByRole('list', { name: 'Состоят в группе' });
    expect(badges(list)).toHaveLength(1);
  });

  test('в группе без отмеченных участников значков нет', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=reference&rec=1');
    const card = await screen.findByRole('dialog', { name: /Карточка группы/ });
    await within(card).findByRole('list', { name: 'Состоят в группе' });
    expect(badges(card)).toHaveLength(0);
  });
});

describe('«Добавить человека» в состав: метка', () => {
  test('в списке людей для выбора отмеченные видны сразу: в обычную группу их добавляют осознанно', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=reference&rec=3');
    const card = await screen.findByRole('dialog', { name: /Карточка группы/ });
    await user.click(await within(card).findByRole('button', { name: 'Добавить человека' }));
    const dialog = await screen.findByRole('dialog', { name: /Добавить человека/ });
    const list = await within(dialog).findByRole('list', { name: 'Люди из справочника' });
    expect(badges(list)).toHaveLength(3);
    const row = within(list).getByText('Михаил Громов').closest('li')!;
    expect(badges(row)).toHaveLength(1);
    for (const img of badges(list)) expect(img.closest('button')).not.toBeNull();
  });
});

describe('«Сегодня»: метка в очереди ожидающих', () => {
  test('внутри кнопки-строки значок без фокуса, с обычным title', async () => {
    stubFetchWithFixtures();
    // Район Фрунзенский / 36–45: в нём ждёт отмеченная Лариса Кулик
    renderAt(<App />, '/?tab=today');
    await screen.findByRole('table');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: (n) => n.startsWith('Фрунзенский, 36–45:') }));
    const panel = await screen.findByRole('dialog', { name: /Клетка таблицы/ });
    const list = await within(panel).findAllByRole('img', { name: /^Странный человек/ });
    expect(list.length).toBeGreaterThan(0);
    for (const img of list) {
      expect(img.closest('button')).not.toBeNull();
      expect(img).toHaveAttribute('title');
      expect(img).not.toHaveAttribute('tabindex');
    }
  });
});
