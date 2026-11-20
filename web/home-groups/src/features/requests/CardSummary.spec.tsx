import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { stubFetchWithFixtures } from '../../test/render';
import { CardSummary, scheduleText } from './CardSummary';
import { fixtureItem, json, openCard, viewWith } from './requestsTestKit';

afterEach(() => vi.unstubAllGlobals());

const summaryOf = (card: HTMLElement) => within(within(card).getByRole('banner')).getByRole('group', { name: 'Сводка' });
const rowOf = (root: HTMLElement, label: string) => within(root).getByText(label, { selector: 'dt' }).nextElementSibling!;

describe('CardSummary: сводка в шапке', () => {
  test('адрес с районом, ответственный и время — строками; «Дополнительно» есть, когда заполнено', () => {
    render(<CardSummary address="Малая Бухарестская, 12" district="Фрунзенский" responsible="Анна Л." schedule="вт вечером" extra="из таблицы" />);
    const s = screen.getByRole('group', { name: 'Сводка' });
    expect(rowOf(s, 'Адрес')).toHaveTextContent('Малая Бухарестская, 12 · Фрунзенский');
    expect(rowOf(s, 'Ответственный')).toHaveTextContent('Анна Л.');
    expect(rowOf(s, 'Время')).toHaveTextContent('вт вечером');
    expect(rowOf(s, 'Дополнительно')).toHaveTextContent('из таблицы');
  });

  test('без адреса и ответственного — «адрес не указан» и «не назначен», пустые время и «Дополнительно» не показываются', () => {
    render(<CardSummary address={null} responsible={null} schedule={null} extra={null} />);
    const s = screen.getByRole('group', { name: 'Сводка' });
    expect(rowOf(s, 'Адрес')).toHaveTextContent('адрес не указан');
    expect(rowOf(s, 'Ответственный')).toHaveTextContent('не назначен');
    expect(within(s).queryByText('Время')).not.toBeInTheDocument();
    expect(within(s).queryByText('Дополнительно')).not.toBeInTheDocument();
  });

  test('время: слова человека, а без них — дни и часть дня', () => {
    expect(scheduleText('по вторникам', ['вт'], 'вечер')).toBe('по вторникам');
    expect(scheduleText(null, ['вт', 'чт'], 'вечер')).toBe('вт, чт, вечер');
    expect(scheduleText(null, [], null)).toBeNull();
  });

  test('длинное значение переносится: стиль строки разрешает перенос и не даёт раздуть шапку', () => {
    const css = readFileSync(join(__dirname, 'Requests.module.css'), 'utf8');
    const dd = css.slice(css.indexOf('.summaryRow dd {'), css.indexOf('}', css.indexOf('.summaryRow dd {')));
    expect(dd).toContain('overflow-wrap: anywhere');
    expect(dd).toContain('min-width: 0');
  });
});

describe('Карточка заявки: сводка в шапке и «Контакты»', () => {
  const patch = {
    street: 'Лесной проспект, 5', district: 'Выборгский', place: 'Ладожская', responsible: 'Пётр Г.',
    table: { ...fixtureItem(5).table, extra: 'ходит с мужем' },
  };

  test('в шапке адрес с районом по нему, ответственный и «Дополнительно», а «Место» остаётся в «Контактах»', async () => {
    stubFetchWithFixtures({ requests: () => json(viewWith(5, patch)) });
    const card = await openCard(5);
    const s = summaryOf(card);
    expect(rowOf(s, 'Адрес')).toHaveTextContent('Лесной проспект, 5 · Выборгский');
    expect(rowOf(s, 'Ответственный')).toHaveTextContent('Пётр Г.');
    expect(rowOf(s, 'Дополнительно')).toHaveTextContent('ходит с мужем');
    const contacts = within(card).getByRole('heading', { name: 'Контакты' }).closest('section')!;
    expect(within(contacts).getByText('Место', { selector: 'dt' })).toBeInTheDocument();
    expect(within(contacts).queryByText('Ответственный')).not.toBeInTheDocument();
    expect(within(contacts).queryByText('Дополнительно')).not.toBeInTheDocument();
  });

  test('улица берётся из слов человека, если поле улицы пусто; нет ни того ни другого — «адрес не указан»', async () => {
    stubFetchWithFixtures({ requests: () => json(viewWith(5, { street: null, streetInfo: { text: 'у метро, дом 3', source: 'anketa' } })) });
    expect(rowOf(summaryOf(await openCard(5)), 'Адрес')).toHaveTextContent('у метро, дом 3');
  });

  test('без ответственного — «не назначен»', async () => {
    stubFetchWithFixtures({ requests: () => json(viewWith(5, { responsible: null })) });
    expect(rowOf(summaryOf(await openCard(5)), 'Ответственный')).toHaveTextContent('не назначен');
  });
});
