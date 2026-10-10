import { describe, expect, test } from 'vitest';
import { parseBucket, parseEntity, parseId, parseTab, patchParams, tabParams } from './params';

const p = (s: string) => new URLSearchParams(s);

describe('состояние экрана в адресе', () => {
  test('неизвестные значения в адресе заменяются значениями по умолчанию', () => {
    expect(parseTab('что-то')).toBe('today');
    expect(parseTab('requests')).toBe('requests');
    expect(parseEntity(null)).toBe('groups');
    expect(parseEntity('people')).toBe('people');
    expect(parseBucket('cancelled')).toBe('all');
    expect(parseBucket('human')).toBe('human');
    expect(parseId('12')).toBe(12);
    expect(parseId('12abc')).toBeNull();
    expect(parseId(null)).toBeNull();
  });

  test('patchParams меняет, убирает и дописывает параметры, не трогая остальные', () => {
    const out = patchParams(p('tab=requests&bucket=ready&req=3'), { req: '5', bucket: null, q: '' });
    expect(out.toString()).toBe('tab=requests&req=5');
  });

  test('массив значений записывается повторяющимся параметром и заменяет прежние', () => {
    const out = patchParams(p('f=A:eq:1'), { f: ['B:eq:2', 'C:empty:'] });
    expect(out.getAll('f')).toEqual(['B:eq:2', 'C:empty:']);
  });

  test('при смене вкладки остаётся только поиск, остальное сбрасывается', () => {
    const out = tabParams(p('tab=reference&ent=people&f=A:eq:1&rec=u1&q=иван'), 'requests');
    expect(out.toString()).toBe('tab=requests&q=%D0%B8%D0%B2%D0%B0%D0%BD');
  });

  test('«Сегодня» — вкладка по умолчанию и в адрес не пишется', () => {
    expect(tabParams(p('tab=requests&req=1'), 'today').toString()).toBe('');
  });
});
