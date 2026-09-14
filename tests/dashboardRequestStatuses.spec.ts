import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { REQUEST_STATUSES } from '../src/db/repos/requests.repo.js';

/**
 * Дашборд обязан знать все статусы заявок.
 *
 * Домен статусов живёт в базе (CHECK в миграции 007) и в REQUEST_STATUSES, а
 * показывает их единственный html-файл, который больше ничем не покрыт. Так уже
 * вышло: «Новая» была и в базе, и в CHECK, а в фильтре и в бейджах её не было —
 * одиннадцать заявок из 234 нельзя было ни отобрать, ни отличить от «без статуса».
 * Этот тест ловит расхождение до выкладки.
 */
const html = readFileSync(new URL('../dashboard/home-groups.html', import.meta.url), 'utf8');

/** Тело объектного или массивного литерала по имени константы в скрипте страницы. */
function literal(name: string): string {
  const from = html.indexOf(`const ${name} = `);
  expect(from, `в дашборде нет ${name}`).toBeGreaterThan(-1);
  const end = html.indexOf('\n};', from) >= 0 && html.indexOf('\n};', from) < html.indexOf('];', from)
    ? html.indexOf('\n};', from)
    : html.indexOf('];', from);
  return html.slice(from, end);
}

describe('статусы заявок в дашборде', () => {
  test('у каждого статуса есть кнопка фильтра', () => {
    const buttons = [...html.matchAll(/data-req="([^"]*)"/g)].map((m) => m[1]);
    // Пустое значение — кнопка «Все», она сбрасывает фильтр.
    expect(buttons).toContain('');
    for (const status of REQUEST_STATUSES) {
      expect(buttons, `нет кнопки фильтра для статуса «${status}»`).toContain(status);
    }
  });

  test('у каждого статуса есть свой бейдж, а не серый фолбэк', () => {
    const pills = literal('REQUEST_PILL');
    for (const status of REQUEST_STATUSES) {
      expect(pills, `статус «${status}» не описан в REQUEST_PILL`).toContain(`'${status}'`);
    }
  });

  test('«Новая» отличима от остальных: свой цвет, а не общий с «в работе»', () => {
    const pills = literal('REQUEST_PILL');
    expect(pills).toContain("'Новая': ['fresh'");
    expect(html).toContain('.pill.fresh');
    expect(html).toContain('--fresh:');
  });

  test('«Новая» считается своим разрядом, а не «без статуса»', () => {
    // Иначе свежее обращение из бота выглядело бы как незаполненное.
    const outcome = literal('REQ_OUTCOME');
    expect(outcome).toMatch(/label: 'Новые'[\s\S]*?st === 'Новая'/);
  });

  test('в форме правки можно выставить любой статус, кроме «Не указан»', () => {
    const form = literal('FORM_REQUEST_STATUSES');
    for (const status of REQUEST_STATUSES.filter((s) => s !== 'Не указан')) {
      expect(form, `статус «${status}» нельзя выставить в форме`).toContain(`'${status}'`);
    }
    // «Не указан» — это отсутствие статуса в исходной таблице, ставить его руками незачем.
    expect(form).not.toContain("'Не указан'");
  });
});

describe('связь заявки с домашней группой', () => {
  test('в шапке таблицы есть колонка «Домашняя группа»', () => {
    expect(html).toContain('<th>Домашняя группа</th>');
  });

  test('есть фильтр по домашней группе', () => {
    expect(html).toContain('id="reqGroupFilter"');
  });

  test('в раскрытой строке можно принудительно назначить любую группу, не только рекомендованную', () => {
    expect(html).toContain('class="req-group"');
  });

  test('рекомендация помечена звёздочкой, а не отдельным полем-дублёром', () => {
    expect(html).toContain("match ? '★ ' : ''");
  });
});

describe('«Ответственный» — выпадающий список, не колонка', () => {
  test('колонки «Ответственный» в шапке таблицы больше нет', () => {
    expect(html).not.toContain('<th>Ответственный</th>');
  });

  test('в быстрой панели ответственный выбирается из списка координаторов, а не вводится текстом', () => {
    expect(html).toMatch(/<select class="req-owner"/);
  });

  test('текущее значение сохраняется в списке, даже если его нет среди координаторов', () => {
    expect(html).toContain('function responsibleOptions');
  });
});

describe('«Куда направляем»', () => {
  test('колонка есть в шапке и показывает существующее поле «Рекомендованная группа»', () => {
    expect(html).toContain('<th>Куда направляем</th>');
  });
});
