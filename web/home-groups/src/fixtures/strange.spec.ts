import { afterEach, describe, expect, test } from 'vitest';
import { buildGroups, buildPeople, buildRequests } from './build';
import { fixtureActionResponse } from './index';
import { buildOthers } from './others';
import { resetDemoStrange } from './strange';

afterEach(() => resetDemoStrange());

const requestOf = (id: number) => buildRequests().items.find((r) => r.id === id)!;
const personOf = (key: string) => buildPeople().items.find((p) => p.key === key)!;
const memberOf = (groupId: number, personKey: string) =>
  buildGroups().items.find((g) => g.id === groupId)!.members.find((m) => m.personKey === personKey)!;

describe('демо-данные: метка «Странный человек»', () => {
  test('отмечены заявка без регистрации, заявка с карточкой и составом, участник, ведущий и обращение', () => {
    expect(buildRequests().items.filter((r) => r.strange).map((r) => r.id).sort((a, b) => a - b)).toEqual([12, 14]);
    expect(buildPeople().items.filter((p) => p.strange).map((p) => p.key).sort()).toEqual(['r12', 'r14', 'u2']);
    expect(buildOthers().filter((o) => o.strange).map((o) => o.id)).toEqual([201]);
    expect(memberOf(4, 'r12').strange).not.toBeNull();
    expect(memberOf(2, 'u2').strange).not.toBeNull();
  });

  test('отмеченную заявку подбор не берёт: корзина «Нужна помощь», причина «странный», предложения нет', () => {
    const r = requestOf(14);
    expect(r.bucket).toBe('human');
    expect(r.proposal).toBeNull();
    expect(r.noPlan).toEqual({
      code: 'strange',
      reason: 'Отмечен как «странный человек»: нужна отдельная группа, подберите её вручную',
    });
  });

  test('счётчики корзин сходятся со списком и с отмеченными заявками', () => {
    const view = buildRequests();
    expect(view.counters.human).toBe(view.items.filter((i) => i.bucket === 'human').length);
    expect(view.counters.ready).toBe(view.items.filter((i) => i.bucket === 'ready').length);
  });

  test('POST requests/:id/strange ставит метку человеку: она видна на заявке, в «Людях» и в составе группы', () => {
    expect(requestOf(1).strange).toBeNull();
    expect(fixtureActionResponse('requests/1/strange', { value: true, note: 'Путает имена' })).toEqual({ ok: true });
    expect(requestOf(1).strange).toMatchObject({ note: 'Путает имена' });
    expect(requestOf(1).bucket).toBe('human');
    expect(requestOf(1).noPlan?.code).toBe('strange');
    expect(personOf('r1').strange).not.toBeNull();
  });

  test('POST requests/:id/strange со снятием убирает метку, в том числе стоявшую с начала, и заявка возвращается в подбор', () => {
    const before = requestOf(14);
    fixtureActionResponse('requests/14/strange', { value: false });
    const after = requestOf(14);
    expect(after.strange).toBeNull();
    expect(after.noPlan?.code).not.toBe('strange');
    expect(personOf('r14').strange).toBeNull();
    expect(before.strange).not.toBeNull();
  });

  test('метка привязана к человеку: поставили на заявке № 12 — видна на карточке r12 и в составе группы', () => {
    fixtureActionResponse('requests/12/strange', { value: false });
    expect(personOf('r12').strange).toBeNull();
    expect(memberOf(4, 'r12').strange).toBeNull();
    fixtureActionResponse('requests/12/strange', { value: true });
    expect(personOf('r12').strange).not.toBeNull();
    expect(memberOf(4, 'r12').strange).not.toBeNull();
  });

  test('POST people/strange работает по ключу человека и видна в составе группы', () => {
    expect(personOf('u1').strange).toBeNull();
    expect(fixtureActionResponse('people/strange', { key: 'u1', value: true, note: 'Агрессивен' })).toEqual({ ok: true });
    expect(personOf('u1').strange).toMatchObject({ note: 'Агрессивен' });
    expect(memberOf(1, 'u1').strange).not.toBeNull();
    fixtureActionResponse('people/strange', { key: 'u1', value: false });
    expect(personOf('u1').strange).toBeNull();
  });

  test('POST requests/:id/strange на обращение ставит метку обращению', () => {
    expect(buildOthers().find((o) => o.id === 202)!.strange).toBeNull();
    fixtureActionResponse('requests/202/strange', { value: true });
    expect(buildOthers().find((o) => o.id === 202)!.strange).not.toBeNull();
  });

  test('пустая заметка в демо хранится как null, а не как пустая строка', () => {
    fixtureActionResponse('requests/1/strange', { value: true, note: '   ' });
    expect(requestOf(1).strange?.note).toBeNull();
  });
});
