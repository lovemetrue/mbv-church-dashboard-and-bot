import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { REQUEST_STATUSES } from '../src/db/repos/requests.repo.js';
import { AGE_GROUPS } from '../src/core/texts.js';

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
    expect(html).toMatch(/<th[^>]*>Домашняя группа/);
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
    expect(html).toMatch(/<th[^>]*>Куда направляем/);
  });
});

describe('«Возраст» — колонка в таблице заявок', () => {
  test('колонка есть в шапке между «Телефон» и «Место»', () => {
    const theadStart = html.indexOf('id="reqBody"');
    const theadBlock = html.slice(theadStart - 700, theadStart);
    const phoneAt = theadBlock.indexOf('data-key="phone"');
    const ageAt = theadBlock.indexOf('data-key="age"');
    const placeAt = theadBlock.indexOf('data-key="place"');
    expect(phoneAt).toBeGreaterThan(-1);
    expect(ageAt).toBeGreaterThan(phoneAt);
    expect(placeAt).toBeGreaterThan(ageAt);
  });

  // Раньше возраст показывался только в раскрытых подробностях — теперь он
  // и так на виду колонкой, второй раз то же самое поле там не нужно.
  test('в раскрытых подробностях возраст больше не дублируется', () => {
    const fn = html.slice(html.indexOf('function requestDetails'), html.indexOf('function requestDetails') + 1200);
    expect(fn).not.toContain("['Возраст'");
  });
});

/**
 * Человек, который уже состоит в группе (или уже её ведёт), называет ведущего в
 * анкете бота (leader_name у участника) — служителю важно видеть, к кому человек
 * уже прикреплён, а не только то, что он «уже состоит».
 */
describe('«Ведущий группы» в раскрытых подробностях заявки', () => {
  test('показывает leader_name участника', () => {
    const fn = html.slice(html.indexOf('function requestDetails'), html.indexOf('function requestDetails') + 1200);
    expect(fn).toContain("['Ведущий группы', r.leader_name]");
  });
});

/**
 * Возраст в форме заявки — те же категории, что бот спрашивает в анкете
 * (AGE_GROUPS), а не свободный текст: иначе в дашборде и в боте завелись бы два
 * разных словаря одного и того же поля.
 */
describe('возраст в форме заявки — выпадающий список из анкеты', () => {
  test('категории в дашборде совпадают с анкетой бота', () => {
    const form = literal('FORM_AGE_GROUPS');
    for (const group of AGE_GROUPS) {
      expect(form, `категории «${group}» из анкеты нет в форме заявки`).toContain(`'${group}'`);
    }
  });

  test('поле «Возраст» у заявки — select, а не текстовый ввод', () => {
    const fields = literal('REQUEST_FIELDS');
    expect(fields).toMatch(/name: 'age'[\s\S]*?pairs: \[\['', /);
  });
});

describe('сортировка заявок по столбцам', () => {
  test('каждый заголовок таблицы заявок кликабелен для сортировки', () => {
    const keys = ['date', 'fio', 'phone', 'age', 'place', 'group_id', 'recommended', 'status'];
    for (const key of keys) {
      expect(html, `нет сортируемого заголовка для ${key}`).toContain(`class="sortable-req" data-key="${key}"`);
    }
  });

  test('клик по заголовку не путает сортировку заявок с сортировкой групп', () => {
    // Общий обработчик thead th.sortable у групп не должен подхватывать заголовки
    // заявок — иначе клик по «Дате» в заявках отсортировал бы реестр групп.
    expect(html).toContain("querySelectorAll('thead th.sortable-req')");
    expect(html).toContain('state.reqSort');
    expect(html).toContain('state.reqDir');
  });
});
