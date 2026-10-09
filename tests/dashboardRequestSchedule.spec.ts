import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const html = readFileSync(new URL('../dashboard/home-groups.html', import.meta.url), 'utf-8');

describe('карточка заявки в дашборде', () => {
  test('показывает удобное время и адрес из анкеты: по ним подбирают группу', () => {
    expect(html).toContain("['Удобное время', r.schedule]");
    expect(html).toContain("['Адрес', r.address]");
  });
});

describe('подбор группы в карточке заявки', () => {
  test('у каждой предложенной группы показаны причины и есть кнопка «Выбрать»', () => {
    expect(html).toContain('function suggestionsBlock');
    expect(html).toContain("s.reasons.join(' \\u00b7 ')");
    expect(html).toContain('suggest-pick');
  });

  test('блок показан только у открытых заявок «хочу в группу»', () => {
    expect(html).toContain("r.type !== 'join_group' || r.status === 'Исполнена' || r.status === 'Аннулирована'");
  });

  test('звезда в списке выбора ставится по подбору сервера, а не по возрасту в браузере', () => {
    expect(html).toContain('r.suggestions');
    expect(html).not.toContain('function groupAgeRange');
  });

  test('в форме группы есть «Не направлять», и в таблице такая группа помечена', () => {
    expect(html).toContain("name: 'doNotRefer'");
    expect(html).toContain("from: 'do_not_refer'");
    expect(html).toContain('g.do_not_refer');
  });
});

describe('кнопка сопоставления в шапке', () => {
  test('ссылка на Excel есть, строится от HG_BASE и скрыта на «/registration»', () => {
    expect(html).toContain('id="matchingLink"');
    expect(html).toContain("matchingLink.href = (window.HG_BASE ?? './') + 'matching.xlsx'");
    expect(html).toContain('html[data-standalone="registration"] #matchingLink');
  });
});
