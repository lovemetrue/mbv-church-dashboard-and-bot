import { beforeEach, describe, expect, test } from 'vitest';
import {
  deleteView,
  loadViews,
  parseFilter,
  parseTableState,
  saveView,
  serializeFilter,
  serializeTableState,
  type FieldDef,
  type TableState,
} from './index';

const defs: FieldDef[] = [
  { key: 'Район', groupable: true },
  { key: 'Проверена, дн.', kind: 'number' },
  { key: 'Статус', groupable: true },
];
const columns = ['Район', 'Проверена, дн.', 'Статус'];
const DEFAULT = ['Район', 'Статус'];

describe('состояние таблицы в адресе страницы', () => {
  test('отбор с двоеточием и процентом в значении переживает запись и чтение', () => {
    const f = { field: 'Район', op: 'eq' as const, value: 'Парнас: 100% свой' };
    expect(parseFilter(serializeFilter(f), defs)).toEqual(f);
  });

  test('полное состояние восстанавливается из параметров адреса', () => {
    const state: TableState = {
      filters: [
        { field: 'Район', op: 'eq', value: 'Приморский' },
        { field: 'Проверена, дн.', op: 'ge', value: '31' },
        { field: 'Статус', op: 'empty', value: '' },
      ],
      text: 'олег',
      columns: ['Район', 'Проверена, дн.'],
      sort: { field: 'Проверена, дн.', dir: 'desc' },
      group: 'Район',
    };
    const url = serializeTableState(state, DEFAULT).toString();
    const back = parseTableState(new URLSearchParams(url), defs, columns);
    expect(back).toEqual(state);
  });

  test('столбцы по умолчанию в адрес не попадают', () => {
    const p = serializeTableState({ filters: [], text: '', columns: [...DEFAULT], sort: null, group: null }, DEFAULT);
    expect(p.toString()).toBe('');
  });

  test('чужие поля, неизвестные условия и пустые значения из адреса отбрасываются', () => {
    const p = new URLSearchParams();
    p.append('f', 'Нет такого:eq:1');
    p.append('f', 'Район:xx:1');
    p.append('f', 'Район:eq:');
    p.append('f', 'мусор');
    p.append('f', 'Район:eq:Невский');
    p.set('gb', 'Проверена, дн.');
    p.set('sort', 'Район:sideways');
    p.append('col', 'Выдуманный');
    const s = parseTableState(p, defs, columns);
    expect(s.filters).toEqual([{ field: 'Район', op: 'eq', value: 'Невский' }]);
    expect(s.group).toBeNull();
    expect(s.sort).toBeNull();
    expect(s.columns).toBeNull();
  });

  test('столбцы из адреса выстраиваются в порядке справочника', () => {
    const p = new URLSearchParams();
    p.append('col', 'Статус');
    p.append('col', 'Район');
    expect(parseTableState(p, defs, columns).columns).toEqual(['Район', 'Статус']);
  });
});

describe('сохранённые виды', () => {
  beforeEach(() => window.localStorage.clear());

  test('вид сохраняется, читается и удаляется', () => {
    const filters = [{ field: 'Район', op: 'eq' as const, value: 'Невский' }];
    saveView('groups', { name: 'Невский', filters, columns: ['Район'], group: 'Район', sort: null });
    expect(loadViews('groups')).toEqual([{ name: 'Невский', filters, columns: ['Район'], group: 'Район', sort: null }]);
    expect(loadViews('people')).toEqual([]);
    deleteView('groups', 'Невский');
    expect(loadViews('groups')).toEqual([]);
  });

  test('вид с тем же названием заменяется, пустое название игнорируется', () => {
    saveView('groups', { name: 'Мой', filters: [] });
    saveView('groups', { name: 'Мой', filters: [{ field: 'A', op: 'empty', value: '' }] });
    saveView('groups', { name: '   ', filters: [] });
    const views = loadViews('groups');
    expect(views).toHaveLength(1);
    expect(views[0]!.filters).toHaveLength(1);
  });

  test('испорченные данные в хранилище не ломают страницу', () => {
    window.localStorage.setItem('hg.views.groups', '{не json');
    expect(loadViews('groups')).toEqual([]);
    window.localStorage.setItem('hg.views.groups', JSON.stringify([{ name: 1 }, { name: 'ok', filters: [] }]));
    expect(loadViews('groups').map((v) => v.name)).toEqual(['ok']);
  });

  test('если хранилище недоступно, чтение и запись молча не работают', () => {
    const orig = Storage.prototype.getItem;
    const origSet = Storage.prototype.setItem;
    Storage.prototype.getItem = () => {
      throw new Error('запрещено');
    };
    Storage.prototype.setItem = () => {
      throw new Error('запрещено');
    };
    try {
      expect(loadViews('groups')).toEqual([]);
      expect(() => saveView('groups', { name: 'x', filters: [] })).not.toThrow();
    } finally {
      Storage.prototype.getItem = orig;
      Storage.prototype.setItem = origSet;
    }
  });
});
