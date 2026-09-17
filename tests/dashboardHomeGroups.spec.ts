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

  test('«Заявки (МДГ)» снова просто «Заявки»', () => {
    expect(html).toContain('data-view="requests">Заявки</button>');
    expect(html).toContain('<h2 class="card-title">Заявки</h2>');
    expect(html).not.toContain('Заявки (МДГ)');
  });
});

describe('порядок и заголовок вкладок', () => {
  test('«Аналитика» идёт первой, перед «Домашними группами»', () => {
    const analyticsAt = html.indexOf('data-view="analytics"');
    const allAt = html.indexOf('data-view="all"');
    const requestsAt = html.indexOf('data-view="requests"');
    const campaignAt = html.indexOf('data-view="campaign"');
    expect(analyticsAt).toBeGreaterThan(-1);
    expect(analyticsAt).toBeLessThan(allAt);
    expect(allAt).toBeLessThan(requestsAt);
    expect(requestsAt).toBeLessThan(campaignAt);
  });

  test('заголовок над разделом меняется вместе с вкладкой, а не висит один навсегда', () => {
    expect(html).toContain('id="pageTitle"');
    expect(html).toContain('PAGE_TITLES');
    expect(html).not.toContain('<h1>Аналитика домашних групп</h1>');
  });
});

describe('графики переехали с «Домашних групп» на «Аналитику»', () => {
  test('на «Домашних группах» блоки с data-section="analytics" больше не показываются автоматически', () => {
    expect(html).toContain("state.view === 'all' && !tags.includes('analytics')");
  });

  test('«Распределение по районам» теперь на «Аналитике», а не рядом с картой', () => {
    const geoAt = html.indexOf('data-section="geo"');
    const ranksAt = html.indexOf('Распределение по районам');
    const analyticsAt = html.indexOf('data-section="analytics"');
    // Блок с рейтингом районов должен идти уже после закрытия секции карты
    // и быть помечен как аналитика, а не гео.
    expect(ranksAt).toBeGreaterThan(geoAt);
    expect(analyticsAt).toBeGreaterThan(-1);
    expect(analyticsAt).toBeLessThan(ranksAt);
  });

  test('карта на «Домашних группах» больше не делит место с рейтингом районов', () => {
    expect(html).not.toContain('class="grid-main" data-section="geo"');
  });
});

describe('клик по карте района фильтрует только таблицу под ней', () => {
  test('KPI и графики аналитики читают район-независимый список', () => {
    expect(html).toContain('function visibleIgnoringDistrict()');
    expect(html).toContain('const rows = visibleIgnoringDistrict();');
    // Не должно остаться мест, где KPI/аналитика берут district-зависимый visible().
    expect(html).not.toMatch(/const rows = visible\(\);/);
  });

  test('«Закрытые домашние группы» больше не срезаются по району с карты', () => {
    expect(html).not.toContain("g.status === 'Закрыта' &&\n    (!state.district");
    expect(html).toContain("countBy(groups.filter((g) => g.status === 'Закрыта'), 'district')");
  });

  test('«Распределение по районам» больше не кликабельно как фильтр', () => {
    const block = html.slice(html.indexOf('function renderRanks()'), html.indexOf('function renderFeedback'));
    expect(block).not.toContain('state.district = state.district === name');
    expect(block).not.toContain('aria-pressed');
  });

  test('карта по-прежнему устанавливает district для таблицы', () => {
    const block = html.slice(html.indexOf('function renderMap()'), html.indexOf('function renderRanks'));
    expect(block).toContain('state.district = state.district === name');
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
