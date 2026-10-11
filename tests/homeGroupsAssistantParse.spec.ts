import { describe, expect, test } from 'vitest';
import { parseReply } from '../src/home-groups/assistant/parse.js';

const ctx = { refs: new Set(['r1', 'r2', 'r3']), districts: ['Приморский', 'Невский', 'Фрунзенский'] as const, ages: ['18-25', '25-40', '40-55'] as const };
const reply = (items: unknown) => JSON.stringify({ items });

describe('разбор ответа помощника', () => {
  test('верный ответ превращается в разбор по каждой заявке', () => {
    const out = parseReply(reply([
      { ref: 'r1', district: 'Невский', age: '25-40', days: ['Пн', 'Ср'], slot: 'вечер', questions: ['Какие вечера вам удобны?'] },
      { ref: 'r2', district: null, age: null, days: [], slot: null, questions: [] },
    ]), ctx);
    expect(out).toEqual([
      { ref: 'r1', district: 'Невский', age: '25-40', days: ['Пн', 'Ср'], slot: 'вечер', questions: ['Какие вечера вам удобны?'] },
      { ref: 'r2', district: null, age: null, days: [], slot: null, questions: [] },
    ]);
  });

  test('ответ в обрамлении ```json и с лишним текстом вокруг всё равно читается', () => {
    const out = parseReply('Вот результат:\n```json\n' + reply([{ ref: 'r1', district: 'Приморский' }]) + '\n```', ctx);
    expect(out).toEqual([{ ref: 'r1', district: 'Приморский', age: null, days: [], slot: null, questions: [] }]);
  });

  test('выдуманное отбрасывается: район не из справочника, возраст не из списка, день и время не те', () => {
    const [h] = parseReply(reply([{ ref: 'r1', district: 'Лахта', age: 'около 30', days: ['Пн', 'Завтра'], slot: 'ночь', questions: [] }]), ctx);
    expect(h).toEqual({ ref: 'r1', district: null, age: null, days: ['Пн'], slot: null, questions: [] });
  });

  test('район сравнивается без учёта регистра и пробелов, но «Не указан» районом не считается', () => {
    expect(parseReply(reply([{ ref: 'r1', district: ' невский ' }]), ctx)[0]!.district).toBe('Невский');
    expect(parseReply(reply([{ ref: 'r1', district: 'Не указан' }]), ctx)[0]!.district).toBeNull();
  });

  test('чужие и повторные номера заявок игнорируются', () => {
    const out = parseReply(reply([{ ref: 'r9', district: 'Невский' }, { ref: 'r1', district: 'Невский' }, { ref: 'r1', district: 'Приморский' }]), ctx);
    expect(out.map((h) => [h.ref, h.district])).toEqual([['r1', 'Невский']]);
  });

  test('вопросов не больше трёх, слишком короткие и длинные отбрасываются, контакты в них вырезаются', () => {
    const [h] = parseReply(reply([{ ref: 'r1', questions: [
      'Какие вечера вам удобны?', 'ok', 'я'.repeat(300), 'Позвоните на 8 911 000-11-22, чтобы уточнить район проживания', 'В каком районе вы живёте?', 'Сколько вам лет примерно?',
    ] }]), ctx);
    expect(h!.questions).toHaveLength(3);
    expect(h!.questions[0]).toBe('Какие вечера вам удобны?');
    expect(JSON.stringify(h)).not.toMatch(/911|я{20}/);
  });

  test.each(['', 'не json', '[]', '{"items":"нет"}', '{"result":[]}', 'null'])('мусор %j даёт пустой результат, а не ошибку', (raw) => {
    expect(parseReply(raw, ctx)).toEqual([]);
  });
});
