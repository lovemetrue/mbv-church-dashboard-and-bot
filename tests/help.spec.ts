import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { createHelp, searchSections, splitSections } from '../src/home-groups/help.js';

const help = createHelp({ dirs: [process.cwd(), join(process.cwd(), 'docs'), join(process.cwd(), 'docs', 'база-знаний')] });

describe('база знаний', () => {
  test('статья делится на разделы по заголовкам, у раздела — путь из заголовков', () => {
    const parts = splitSections('Статья', 'Вступление\n## Вход\nтекст входа\n### Пароль\nпро пароль\n## Ещё\nещё');
    expect(parts.map((p) => p.title)).toEqual(['Статья', 'Статья → Вход', 'Статья → Вход → Пароль', 'Статья → Ещё']);
    expect(parts[2]!.text).toBe('про пароль');
  });

  test('поиск находит раздел по словам в другой форме, заголовок весит больше текста', () => {
    const parts = splitSections('С', '## Пароль\nкак войти\n## Вход\nпро пароли и логины');
    expect(searchSections(parts, 'забыл пароля').map((p) => p.title)).toEqual(['С → Пароль', 'С → Вход']);
    expect(searchSections(parts, 'что как почему')).toEqual([]);
  });

  test('на типичный вопрос «не вижу заявку» первым находится раздел частых проблем про это', async () => {
    const found = await help.search('Почему я не вижу заявку, которую видят другие?');
    expect(found[0]!.title).toBe('Частые проблемы → Не вижу заявку, карточку или группу, которую видят другие');
  });

  test('статьи из репозитория на месте: частые проблемы, как работает интерфейс, памятка', async () => {
    expect((await help.index()).articles.map((a) => a.title)).toEqual(['Частые проблемы', 'Как работает интерфейс', 'Памятка для команды']);
    expect(await help.article('nope')).toBeNull();
    expect(await help.image('../package.json')).toBeNull();
    expect(await help.image('guide-01-login.png')).not.toBeNull();
  });
});
