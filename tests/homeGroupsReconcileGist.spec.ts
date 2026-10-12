import { describe, expect, test } from 'vitest';
import { gistOf } from '../src/home-groups/reconcile/gist.js';

const base = { mdg_status: null, leader_name: null, church: null, text: null, schedule: null, manual_schedule: null, cancel_reason: null } as const;

describe('суть обращения одной фразой', () => {
  test('«уже состоит»: ведущий и церковь прямо в фразе', () => {
    expect(gistOf({ ...base, type: 'already_member', leader_name: 'Малявин Павел', church: 'МБВ Колизей' }))
      .toBe('Говорит, что уже состоит в Малой группе. Ведущий: Малявин Павел. Церковь: МБВ Колизей.');
  });

  test('«уже состоит» без ведущего говорит, что ведущего не назвали', () => {
    expect(gistOf({ ...base, type: 'already_member' })).toBe('Говорит, что уже состоит в Малой группе. Ведущего не назвал.');
  });

  test('«уже ведёт»', () => {
    expect(gistOf({ ...base, type: 'already_leader', church: 'МБВ Колизей' })).toBe('Говорит, что уже ведёт Малую группу. Церковь: МБВ Колизей.');
  });

  test('«хочет открыть» и «даёт дом» различаются, удобное время правка координатора важнее анкеты', () => {
    expect(gistOf({ ...base, type: 'lead_group', mdg_status: 'open', schedule: 'вт вечер' })).toBe('Хочет открыть Малую группу. Удобно: вт вечер.');
    expect(gistOf({ ...base, type: 'lead_group', mdg_status: 'home', schedule: 'вт', manual_schedule: 'чт' })).toBe('Может предоставить свой дом для Малой группы. Удобно: чт.');
  });

  test('вопрос показывает сам текст, длинный обрезается', () => {
    expect(gistOf({ ...base, type: 'question', text: ' Как  попасть\nв группу? ' })).toBe('Вопрос служителю: «Как попасть в группу?»');
    const long = gistOf({ ...base, type: 'question', text: 'а'.repeat(500) });
    expect(long.length).toBeLessThan(260);
    expect(long).toContain('…');
    expect(gistOf({ ...base, type: 'question' })).toBe('Вопрос служителю (текст не сохранился).');
  });

  test('аннулированная заявка на подбор говорит о заявке, а не о человеке', () => {
    expect(gistOf({ ...base, type: 'join_group', cancel_reason: 'Не отвечают' })).toBe('Заявка в домашнюю группу аннулирована: Не отвечают.');
  });
});
