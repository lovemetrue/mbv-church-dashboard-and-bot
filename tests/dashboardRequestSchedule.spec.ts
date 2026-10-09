import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const html = readFileSync(new URL('../dashboard/home-groups.html', import.meta.url), 'utf-8');

describe('карточка заявки в дашборде', () => {
  test('показывает удобное время и адрес из анкеты: по ним подбирают группу', () => {
    expect(html).toContain("['Удобное время', r.schedule]");
    expect(html).toContain("['Адрес', r.address]");
  });
});
