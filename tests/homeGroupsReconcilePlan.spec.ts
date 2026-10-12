import { describe, expect, test } from 'vitest';
import { reconcileKindOf, reconcileOf, readyGroupOf } from '../src/home-groups/reconcile/plan.js';
import type { DashboardGroup } from '../src/db/repos/groups.repo.js';
import type { DashboardRequest } from '../src/db/repos/requests.repo.js';

const group = (id: number, leader: string, over: Partial<DashboardGroup> = {}): DashboardGroup =>
  ({ id, leader, phone: null, phones: [], co_leader: null, co_leader_phone: null, district: 'Приморский', ...over }) as DashboardGroup;
const req = (over: Partial<DashboardRequest>): DashboardRequest =>
  ({ id: 1, type: 'already_member', user_id: 10, fio: 'Доценко Артём', phone: null, phones: [], leader_name: null, ...over }) as DashboardRequest;

const GROUPS = [group(5, 'Малявин Павел', { phones: ['89001112233'] }), group(6, 'Родионов Давид'), group(7, 'Родионов Давид'), group(8, 'Клименко Павел', { co_leader: 'Клименко Марина', co_leader_phone: '+7 961 916-33-78' })];

describe('какие обращения разбираются', () => {
  test('«уже состою» и «уже веду» — да, остальные виды — нет', () => {
    expect(reconcileKindOf('already_member')).toBe('member');
    expect(reconcileKindOf('already_leader')).toBe('leader');
    for (const t of ['join_group', 'lead_group', 'question', 'toString']) expect(reconcileKindOf(t), t).toBeNull();
    expect(reconcileOf(req({ type: 'question' }), GROUPS)).toBeNull();
  });
});

describe('«уже состою в группе»: группа ищется по имени ведущего', () => {
  test('ведущий найден — готово, и сказано какая группа', () => {
    const r = reconcileOf(req({ leader_name: 'Павел Малявин' }), GROUPS)!;
    expect(r).toMatchObject({ kind: 'member', status: 'ready', candidates: [{ groupId: 5, code: 'ДГ-0005', leader: 'Малявин Павел', tier: 'exact' }] });
    expect(r.text).toContain('ДГ-0005');
    expect(readyGroupOf(req({ leader_name: 'Павел Малявин' }), GROUPS)).toBe(5);
  });

  test('у ведущего две группы — выбор, и «готовой» группы нет', () => {
    const r = reconcileOf(req({ leader_name: 'Родионов Давид' }), GROUPS)!;
    expect(r.status).toBe('choose');
    expect(r.candidates.map((c) => c.groupId)).toEqual([6, 7]);
    expect(r.text).toContain('ДГ-0006');
    expect(readyGroupOf(req({ leader_name: 'Родионов Давид' }), GROUPS)).toBeNull();
  });

  test('ведущего нет в справочнике или он не назван — разные подсказки', () => {
    expect(reconcileOf(req({ leader_name: 'Кто-то Неизвестный' }), GROUPS)).toMatchObject({ status: 'none', candidates: [] });
    expect(reconcileOf(req({ leader_name: null }), GROUPS)).toMatchObject({ status: 'noleader' });
  });

  test('у обращения без регистрации человека разобрать нечего: в справочник его вносят руками', () => {
    const r = reconcileOf(req({ user_id: null, leader_name: 'Павел Малявин' }), GROUPS)!;
    expect(r.status).toBe('nouser');
    expect(readyGroupOf(req({ user_id: null, leader_name: 'Павел Малявин' }), GROUPS)).toBeNull();
  });
});

describe('«уже веду группу»: ведущий ищется по самому человеку', () => {
  test('по имени из регистрации', () => {
    expect(readyGroupOf(req({ type: 'already_leader', fio: 'Павел Малявин' }), GROUPS)).toBe(5);
  });

  test('по телефону, даже если имя записано иначе', () => {
    const r = req({ type: 'already_leader', fio: 'П. М.', phones: ['+7 900 111-22-33'] });
    expect(reconcileOf(r, GROUPS)).toMatchObject({ status: 'ready', candidates: [{ groupId: 5, by: 'phone' }] });
  });

  test('телефон второго ведущего тоже находит группу', () => {
    expect(readyGroupOf(req({ type: 'already_leader', fio: 'Совсем Другая', phone: '+79619163378' }), GROUPS)).toBe(8);
  });
});
