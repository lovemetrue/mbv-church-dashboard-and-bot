import { describe, expect, test } from 'vitest';
import { buildRequests } from './build';

const FIELDS = ['Район', 'Возраст', 'Дни', 'Время суток', 'Улица'];

describe('фикстуры: «что именно изменилось»', () => {
  const items = buildRequests().items;
  const changed = items.filter((r) => r.proposal?.dataChanged);

  test('в демо видны оба вида: у одной заявки два изменённых поля, у другой подробностей нет', () => {
    expect(changed.map((r) => r.proposal!.changes?.length ?? null).sort()).toEqual([2, null].sort());
  });

  test('поля изменений — из списка полей сервера, и «было» отличается от «стало»', () => {
    for (const c of changed.flatMap((r) => r.proposal!.changes ?? [])) {
      expect(FIELDS).toContain(c.field);
      expect(c.before).not.toBe(c.after);
    }
  });

  test('у предложений без изменившихся данных changes = null, как отдаёт сервер', () => {
    for (const r of items.filter((i) => i.proposal && !i.proposal.dataChanged)) expect(r.proposal!.changes).toBeNull();
  });
});
