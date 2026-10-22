import { describe, expect, test } from 'vitest';
import { parseBucket, parseEntity, parseId, parseOtherFilter, parseReconcileFilter, parseTab, parseView, patchParams, tabParams, visibleTabs } from './params';

const p = (s: string) => new URLSearchParams(s);

describe('состояние экрана в адресе', () => {
  test('неизвестные значения в адресе заменяются значениями по умолчанию', () => {
    expect(parseTab('что-то')).toBe('today');
    expect(parseTab('requests')).toBe('requests');
    expect(parseEntity(null)).toBe('groups');
    expect(parseEntity('people')).toBe('people');
    expect(parseBucket('cancelled')).toBe('all');
    expect(parseBucket('human')).toBe('human');
    expect(parseBucket('queue')).toBe('queue');
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

describe('вкладки по ролям', () => {
  test('«Настройки» видит только полный вход, а пока роль неизвестна вкладки нет', () => {
    expect(visibleTabs('super')).toEqual(['today', 'requests', 'groups', 'kits', 'team', 'reference', 'settings']);
    expect(visibleTabs('admin')).toEqual(['today', 'requests', 'groups', 'kits', 'team', 'reference']);
    expect(visibleTabs(undefined)).toEqual(['today', 'requests', 'groups', 'kits', 'team', 'reference']);
  });

  test('вкладка «Команда» разбирается из адреса и при уходе с неё сбрасывает свои параметры', () => {
    expect(parseTab('team')).toBe('team');
    expect(tabParams(p('tab=requests&resp=Анна&req=3&q=иван'), 'team').toString()).toBe('tab=team&q=%D0%B8%D0%B2%D0%B0%D0%BD');
  });

  test('адрес вкладки «Настройки» разбирается как есть: решение о доступе принимает оболочка', () => {
    expect(parseTab('settings')).toBe('settings');
  });

  test('при смене вкладки на «Настройки» внутренний раздел сбрасывается', () => {
    expect(tabParams(p('tab=settings&sec=audit'), 'reference').toString()).toBe('tab=reference');
  });
});

describe('режим списка «Заявок» в адресе', () => {
  test('view=others включает «Другие обращения», всё остальное — обычный список', () => {
    expect(parseView('others')).toBe('others');
    expect(parseView(null)).toBe('wait');
    expect(parseView('wait')).toBe('wait');
    expect(parseView('что-то')).toBe('wait');
  });

  test('чип обращений: неизвестное значение — «Открытые»', () => {
    expect(parseOtherFilter(null)).toBe('open');
    expect(parseOtherFilter('done')).toBe('done');
    expect(parseOtherFilter('cancelled')).toBe('cancelled');
    expect(parseOtherFilter('all')).toBe('all');
    expect(parseOtherFilter('human')).toBe('open');
  });

  test('при смене вкладки режим списка и чип обращений сбрасываются', () => {
    expect(tabParams(p('tab=requests&view=others&ostate=done&q=иван'), 'team').toString()).toBe('tab=team&q=%D0%B8%D0%B2%D0%B0%D0%BD');
  });

  test('отбор по разбору: известные значения читаются, всё остальное — «Все открытые»', () => {
    expect(parseReconcileFilter(null)).toBe('all');
    expect(parseReconcileFilter('ready')).toBe('ready');
    expect(parseReconcileFilter('choose')).toBe('choose');
    expect(parseReconcileFilter('missing')).toBe('missing');
    expect(parseReconcileFilter('rest')).toBe('rest');
    expect(parseReconcileFilter('all')).toBe('all');
    expect(parseReconcileFilter('done')).toBe('all');
  });

  test('при смене вкладки отбор по разбору сбрасывается вместе с остальным', () => {
    expect(tabParams(p('tab=requests&view=others&orec=ready'), 'team').toString()).toBe('tab=team');
  });
});
