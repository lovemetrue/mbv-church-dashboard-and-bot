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

describe('бейдж «40 дней» в реестре групп', () => {
  test('колонка есть в шапке таблицы', () => {
    expect(html).toContain('>40 дней<');
  });

  test('бейдж переиспользует существующий зелёный пилл, а не новый цвет', () => {
    expect(html).toContain('pill live');
  });

  test('есть фильтр по регистрации в кампании', () => {
    expect(html).toContain('id="segCampaign"');
    expect(html).toContain('data-campaign="yes"');
    expect(html).toContain('data-campaign="no"');
  });
});

describe('код домашней группы', () => {
  test('вычисляется из id, без отдельного счётчика в базе', () => {
    expect(html).toContain('function groupCode(id)');
    expect(html).toContain("padStart(4, '0')");
  });
});

describe('подбор ведущего из зарегистрированных участников', () => {
  test('поле выбора кандидата есть в описании полей группы', () => {
    expect(html).toContain("name: 'leaderCandidate'");
  });

  test('выбор кандидата подставляет ФИО и телефон, ничего не отправляя за него', () => {
    expect(html).toContain('function wireLeaderCandidatePicker');
  });
});
