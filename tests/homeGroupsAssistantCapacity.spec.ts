import { describe, expect, test } from 'vitest';
import { SCHEMA_DOC, systemPrompt } from '../src/home-groups/assistant/chat.js';

describe('помощник и вместимость групп', () => {
  test('свободные места считаются от вместимости группы, а общее значение — только для групп без своей', () => {
    const prompt = systemPrompt({ today: '2026-10-20', capacity: 10 });
    expect(prompt).toContain('COALESCE(capacity, 10)');
    // Прежнее правило «по умолчанию 10 у всех» дало бы неверное «нет мест» у групп на пять человек.
    expect(prompt).not.toMatch(/people больше 10|people не меньше 10/);
    expect(SCHEMA_DOC).toContain("capacity (мест в группе");
  });
});
