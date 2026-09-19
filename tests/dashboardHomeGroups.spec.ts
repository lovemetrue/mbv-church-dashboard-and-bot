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

describe('блоки KPI: без «Всего», в новом порядке, с «На паузе»', () => {
  test('плитки «Всего групп» и цели больше нет', () => {
    expect(html).not.toContain('id="kpiTotal"');
    expect(html).not.toContain('id="targetBtn"');
    expect(html).not.toContain('id="targetBar"');
    expect(html).not.toContain('targetValue');
  });

  test('плитка «На паузе» появилась', () => {
    expect(html).toContain('id="kpiPaused"');
    expect(html).toContain('>На паузе<');
  });

  test('порядок плиток: Действующие, На паузе, Закрытые, Ведущих, Участников', () => {
    const liveAt = html.indexOf('id="kpiLive"');
    const pausedAt = html.indexOf('id="kpiPaused"');
    const closedAt = html.indexOf('id="kpiClosed"');
    const leadersAt = html.indexOf('id="kpiLeaders"');
    const peopleAt = html.indexOf('id="kpiPeople"');
    expect(liveAt).toBeGreaterThan(-1);
    expect(liveAt).toBeLessThan(pausedAt);
    expect(pausedAt).toBeLessThan(closedAt);
    expect(closedAt).toBeLessThan(leadersAt);
    expect(leadersAt).toBeLessThan(peopleAt);
  });
});

describe('раздел «Участники»', () => {
  test('своя вкладка в навигации', () => {
    expect(html).toContain('data-view="coordinators">Участники</button>');
    expect(html).toContain("coordinators: 'Участники'");
  });

  test('таблица участников на своей вкладке', () => {
    expect(html).toContain('data-section="coordinators"');
    expect(html).toContain('id="coordBody"');
    expect(html).toContain('function renderCoordinators()');
  });

  test('форма заведения нового участника лежит в «Добавить», как остальные', () => {
    expect(html).toContain('id="coordinatorForm"');
    expect(html).toContain("wireForm('#coordinatorForm', '#coordinatorMsg', 'coordinator/create'");
  });

  test('править и убирать можно так же, как группу и заявку', () => {
    expect(html).toContain("kind === 'coordinator' ? COORDINATOR_FIELDS");
    expect(html).toContain("wireRowEditing('#coordBody', 'coordinator'");
  });
});

describe('координатор группы выбирается из списка', () => {
  test('поле «Координатор» больше не свободный текст', () => {
    const block = html.slice(html.indexOf('const GROUP_FIELDS = ['), html.indexOf('const COORDINATOR_FIELDS = ['));
    expect(block).toContain("name: 'coordinator'");
    expect(block).not.toContain("name: 'coordinator', label: 'Координатор', from: 'coordinator', placeholder");
    expect(block).toContain('GROUP_COORDINATOR_NAMES');
  });

  test('список составлен из общего реестра участников плюс текущие значения групп', () => {
    expect(html).toContain('const GROUP_COORDINATOR_NAMES = [...new Set([');
    expect(html).toContain('coordinators.map((c) => c.name)');
    expect(html).toContain("groups.map((g) => g.coordinator).filter(Boolean)");
  });
});

describe('фавикон', () => {
  test('ссылки в <head> есть и помечены id для перестановки на HG_BASE', () => {
    expect(html).toContain('href="assets/computer.png" id="favicon"');
    expect(html).toContain('href="assets/computer.png" id="touchIcon"');
  });

  test('путь переставляется на HG_BASE в скрипте — страница смонтирована на «/groups» без косой черты', () => {
    // Голый относительный href браузер разрешит от корня сайта, а не от «/groups/».
    expect(html).toContain("(window.HG_BASE ?? './') + 'assets/computer.png'");
  });
});

describe('в заявке видны ответы анкеты бота', () => {
  test('церковь и статус по МДГ показаны в подробностях заявки', () => {
    const block = html.slice(html.indexOf('function requestDetails'), html.indexOf('function requestDetails') + 800);
    expect(block).toContain("['Церковь', r.church]");
    expect(block).toContain('r.mdg_status');
  });

  test('подписи МДГ те же, что в боте', () => {
    expect(html).toContain('const MDG_STATUS_LABEL');
    expect(html).toContain('готов открыть Малую группу');
  });
});

describe('«Куда направляем» — выбор из групп, а не свободный текст', () => {
  test('поле собрано из списка домашних групп, а не набрано текстом', () => {
    const block = html.slice(html.indexOf("name: 'recommended'"), html.indexOf("name: 'recommended'") + 200);
    expect(block).toContain('RECOMMENDED_OPTIONS');
    expect(block).toContain('pairs:');
  });

  test('пустой выбор возможен — рекомендация даётся не сразу', () => {
    expect(html).toContain('— не рекомендовано —');
  });

  test('список составлен из групп плюс уже стоящие значения', () => {
    expect(html).toContain('const RECOMMENDED_OPTIONS = [...new Set([');
    expect(html).toContain('groups.map((g) => g.leader)');
  });
});

describe('регистрация участника из дашборда', () => {
  test('своя вкладка в навигации', () => {
    expect(html).toContain('data-view="registration">Регистрация</button>');
    expect(html).toContain("registration: 'Регистрация'");
  });

  test('таблица регистраций на своей вкладке, форма — в «Добавить»', () => {
    expect(html).toContain('data-section="registration"');
    expect(html).toContain('id="regBody"');
    expect(html).toContain('function renderRegistration()');
    expect(html).toContain('id="registrationForm"');
  });

  test('форма собрана из тех же вопросов, что и анкета бота', () => {
    expect(html).toContain('const REGISTRATION_FIELDS');
    expect(html).toContain("name: 'fio'");
    expect(html).toContain("name: 'phone'");
    expect(html).toContain("name: 'mdgStatus'");
  });

  test('QR показывается сразу на странице, без перезагрузки формы', () => {
    expect(html).toContain('id="registrationQr"');
    expect(html).toContain("'registration/create'");
    expect(html).toContain('registration/qr?id=');
    // Остальные формы дашборда перезагружают страницу после успеха — эта нет,
    // иначе показанный QR тут же стёрло бы.
    const block = html.slice(html.indexOf('wireRegistrationForm'), html.indexOf('wireRegistrationForm') + 1800);
    expect(block).not.toContain('location.reload');
  });

  test('QR доступен и в общем списке регистраций, не только сразу после заведения', () => {
    expect(html).toContain('reg-qr');
  });
});

describe('декоративная кнопка города убрана из шапки', () => {
  test('cityChip нет ни в разметке, ни в стилях', () => {
    expect(html).not.toContain('cityChip');
    expect(html).not.toContain('Санкт-Петербург</button>');
  });
});

describe('после загрузки страницы открыта вкладка «Заявки»', () => {
  test('вкладка «Заявки» отмечена выбранной, а не «Домашние группы»', () => {
    expect(html).toContain('data-view="requests">Заявки</button>');
    expect(html).toMatch(/aria-selected="true" data-view="requests"/);
    expect(html).toMatch(/aria-selected="false" data-view="all"/);
  });

  test('начальный view в состоянии — requests', () => {
    expect(html).toContain("view: 'requests'");
  });
});
