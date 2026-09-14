import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

/**
 * Структурные проверки страницы дашборда, которые не покрыты
 * dashboardRequestStatuses.spec (тот файл — только про статусы заявок).
 */
const html = readFileSync(new URL('../dashboard/home-groups.html', import.meta.url), 'utf8');

describe('переименования вкладок', () => {
  test('«Обзор» стал «Домашние группы»', () => {
    expect(html).toContain('data-view="all">Домашние группы</button>');
    expect(html).not.toMatch(/>Обзор</);
  });

  test('«Заявки» стали «Заявки (МДГ)»', () => {
    expect(html).toContain('data-view="requests">Заявки (МДГ)</button>');
    expect(html).toContain('<h2 class="card-title">Заявки (МДГ)</h2>');
  });
});
