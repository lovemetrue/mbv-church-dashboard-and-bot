import { describe, expect, test } from 'vitest';
import { withSuggestions } from '../src/dashboard/suggestions.js';
import type { DashboardGroup } from '../src/db/repos/groups.repo.js';
import type { DashboardRequest } from '../src/db/repos/requests.repo.js';

const group = (patch: Partial<DashboardGroup> = {}): DashboardGroup => ({
  id: 1, no: null, leader: 'Иванова', phone: null, phones: [], open_to_new: 'ДА', age: '25-40',
  district: 'Приморский', metro: 'Пионерская', address: null, composition: null, day: null, time: null,
  people: 8, coordinator: null, co_leader: null, co_leader_phone: null, feedback_at: null, comment: null,
  training: null, format: 'Основная церковь', status: 'Функционирует', checked: true, source: 'ui',
  campaign_registered: false, do_not_refer: false,
  ...patch,
});

const request = (patch: Partial<DashboardRequest> = {}): DashboardRequest => ({
  id: 10, group_id: null, fio: 'Петров Пётр', responsible: null, status: 'Новая', date: '2026-10-01',
  phone: null, phones: [], age: '25-40', place: 'Приморский, м. Пионерская', source: null, ministry: null,
  note: null, extra: null, recommended: null, recommended_at: null, final_group: null, cancel_reason: null,
  attendance: null, type: 'join_group', text: null, origin: 'бот', church: null, mdg_status: 'join',
  leader_name: null, schedule: null, address: null,
  ...patch,
});

const ACTIVE = { campaignActive: true };

describe('подсказки групп для заявок в дашборде', () => {
  test('открытой заявке «хочу в группу» подбираются группы с причинами', () => {
    const [r] = withSuggestions([request()], [group()], ACTIVE);
    expect(r!.suggestions).toHaveLength(1);
    expect(r!.suggestions[0]).toMatchObject({ groupId: 1, score: 5 });
    expect(r!.suggestions[0]!.reasons.join(' ')).toContain('тот же район');
  });

  test('остальным заявкам подсказки не нужны: пустой список, а не отсутствие поля', () => {
    for (const patch of [{ type: 'lead_group' as const }, { type: 'question' as const }, { type: 'already_member' as const }]) {
      expect(withSuggestions([request(patch)], [group()], ACTIVE)[0]!.suggestions).toEqual([]);
    }
  });

  test.each(['Исполнена', 'Аннулирована'] as const)('закрытой заявке («%s») подсказки не считаем', (status) => {
    expect(withSuggestions([request({ status })], [group()], ACTIVE)[0]!.suggestions).toEqual([]);
  });

  test('группа с отметкой «Не направлять» в подсказки не попадает', () => {
    const groups = [group({ id: 1, do_not_refer: true }), group({ id: 2 })];
    expect(withSuggestions([request()], groups, ACTIVE)[0]!.suggestions.map((s) => s.groupId)).toEqual([2]);
  });

  test('остальные поля заявки сохраняются как были', () => {
    const r = request();
    expect(withSuggestions([r], [group()], ACTIVE)[0]).toMatchObject(r);
  });

  test('период кампании учитывается: вне её «Кампания» очков не даёт', () => {
    const g = [group({ status: 'Кампания', district: 'Невский', metro: null })];
    expect(withSuggestions([request()], g, { campaignActive: true })[0]!.suggestions[0]!.score).toBe(2);
    expect(withSuggestions([request()], g, { campaignActive: false })[0]!.suggestions[0]!.score).toBe(0);
  });
});
