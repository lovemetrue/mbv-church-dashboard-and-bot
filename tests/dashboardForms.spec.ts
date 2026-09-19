import { describe, expect, test } from 'vitest';
import {
  parseCoordinatorForm, parseCoordinatorUpdate, parseGroupForm, parseRegistrationForm, parseRequestForm,
} from '../src/dashboard/forms.js';

const form = (o: Record<string, string>) => new URLSearchParams(o);

const GROUP_MIN = { leader: 'Иванова Мария', district: 'Невский', format: 'Молодежная', status: 'Функционирует' };
const REQUEST_MIN = { fio: 'Петров Пётр', type: 'join_group', status: 'В работе' };

describe('форма группы', () => {
  test('минимальный набор проходит', () => {
    const r = parseGroupForm(form(GROUP_MIN));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ leader: 'Иванова Мария', district: 'Невский' });
  });

  test('заполняются все поля листа', () => {
    const r = parseGroupForm(form({
      ...GROUP_MIN,
      no: '77', openToNew: 'ДА', phone: '+7 900 111-22-33', age: '35-50',
      metro: 'Пионерская', address: 'ул. Есенина, д. 1', composition: 'Смешанная',
      day: 'Четверг', time: '19:00', people: '8', coordinator: 'Петрова Мария',
      feedbackAt: '2026-08-20', comment: 'Собираются раз в две недели', training: 'Да',
      checked: 'on',
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({
      no: 77, openToNew: 'ДА', age: '35-50', metro: 'Пионерская',
      address: 'ул. Есенина, д. 1', composition: 'Смешанная', day: 'Четверг',
      time: '19:00', people: 8, coordinator: 'Петрова Мария',
      feedbackAt: '2026-08-20', comment: 'Собираются раз в две недели',
      training: 'Да', checked: true,
    });
    // Телефон приводится к виду для ссылки «позвонить».
    expect(r.value.phones).toEqual(['+79001112233']);
  });

  test('без ведущего не принимается', () => {
    const r = parseGroupForm(form({ ...GROUP_MIN, leader: '  ' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('ведущего');
  });

  test('район, формат и статус только из справочника', () => {
    for (const [field, bad] of [['district', 'Марсианский'], ['format', 'Какой-то'], ['status', 'Непонятно']] as const) {
      const r = parseGroupForm(form({ ...GROUP_MIN, [field]: bad }));
      expect(r.ok, field).toBe(false);
    }
  });

  test('закрыть группу через форму можно, хотя бот такой статус не предлагает', () => {
    const r = parseGroupForm(form({ ...GROUP_MIN, status: 'Закрыта' }));
    expect(r.ok).toBe(true);
  });

  test('число человек вне разумных границ отвергается', () => {
    expect(parseGroupForm(form({ ...GROUP_MIN, people: '0' })).ok).toBe(false);
    expect(parseGroupForm(form({ ...GROUP_MIN, people: '500' })).ok).toBe(false);
    expect(parseGroupForm(form({ ...GROUP_MIN, people: 'много' })).ok).toBe(false);
  });

  test('пустые поля становятся пустотой, а не пустой строкой', () => {
    const r = parseGroupForm(form({ ...GROUP_MIN, metro: '', comment: '   ', people: '' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.metro).toBeNull();
    expect(r.value.comment).toBeNull();
    expect(r.value.people).toBeNull();
  });

  test('телефон, который не разобрать, сохраняется текстом', () => {
    const r = parseGroupForm(form({ ...GROUP_MIN, phone: 'спросить у Марины' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.phone).toBe('спросить у Марины');
    expect(r.value.phones).toEqual([]);
  });

  test('неверная дата обратной связи отвергается', () => {
    expect(parseGroupForm(form({ ...GROUP_MIN, feedbackAt: '20.08.2026' })).ok).toBe(false);
    expect(parseGroupForm(form({ ...GROUP_MIN, feedbackAt: '2026-13-40' })).ok).toBe(false);
  });
});

describe('форма заявки', () => {
  test('минимальный набор проходит', () => {
    const r = parseRequestForm(form(REQUEST_MIN));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ fio: 'Петров Пётр', type: 'join_group', status: 'В работе' });
  });

  test('заполняются все поля листа', () => {
    const r = parseRequestForm(form({
      ...REQUEST_MIN,
      phone: '8 (921) 000-11-22', age: '35-45 лет', place: 'Дыбенко',
      source: 'Сайт церкви', ministry: 'Колизей 13:00', responsible: 'Юлия Комарская',
      recommended: 'Артёмкин', recommendedAt: '2026-08-10', finalGroup: 'Ходит с августа',
      cancelReason: '', attendance: 'Посещает', note: 'Вацап', extra: 'Удобно у метро',
      requestedAt: '2026-08-01',
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({
      place: 'Дыбенко', source: 'Сайт церкви', responsible: 'Юлия Комарская',
      recommended: 'Артёмкин', recommendedAt: '2026-08-10', attendance: 'Посещает',
      requestedAt: '2026-08-01',
    });
    expect(r.value.phones).toEqual(['+79210001122']);
    expect(r.value.cancelReason).toBeNull();
  });

  test('без ФИО не принимается: заявка должна быть о конкретном человеке', () => {
    const r = parseRequestForm(form({ ...REQUEST_MIN, fio: '' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('ФИО');
  });

  test('статус и вид только из справочника', () => {
    expect(parseRequestForm(form({ ...REQUEST_MIN, status: 'Придумано' })).ok).toBe(false);
    expect(parseRequestForm(form({ ...REQUEST_MIN, type: 'что_то' })).ok).toBe(false);
  });

  test('все статусы пайплайна принимаются', () => {
    for (const status of ['Новая', 'В ожидании', 'В работе', 'На контроле', 'Исполнена', 'Аннулирована']) {
      expect(parseRequestForm(form({ ...REQUEST_MIN, status })).ok, status).toBe(true);
    }
  });

  test('домашняя группа не выбрана — поле пустое, а не ошибка', () => {
    const r = parseRequestForm(form(REQUEST_MIN));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.groupId).toBeNull();
  });

  test('домашняя группа приходит как id из списка', () => {
    const r = parseRequestForm(form({ ...REQUEST_MIN, groupId: '42' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.groupId).toBe(42);
  });

  test('нечисловой id группы отвергается', () => {
    const r = parseRequestForm(form({ ...REQUEST_MIN, groupId: 'сорок два' }));
    expect(r.ok).toBe(false);
  });
});

describe('форма участника (координатора)', () => {
  test('ФИО и роль проходят', () => {
    const r = parseCoordinatorForm(form({ name: 'Петрова Мария', role: 'Координатор малых групп' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ name: 'Петрова Мария', role: 'Координатор малых групп' });
  });

  test('без ФИО не принимается', () => {
    const r = parseCoordinatorForm(form({ name: '  ', role: 'Координатор' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('ФИО');
  });

  test('без роли не принимается', () => {
    const r = parseCoordinatorForm(form({ name: 'Петрова Мария', role: '' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('роль');
  });

  test('правка требует номер записи', () => {
    const r = parseCoordinatorUpdate(form({ name: 'Петрова Мария', role: 'Координатор' }));
    expect(r.ok).toBe(false);
  });

  test('правка с номером и полями проходит', () => {
    const r = parseCoordinatorUpdate(form({ id: '5', name: 'Петрова Мария', role: 'Координатор' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ id: 5, input: { name: 'Петрова Мария', role: 'Координатор' } });
  });
});

describe('форма регистрации участника (для тех, у кого нет чата с ботом)', () => {
  test('ФИО и телефон — минимум, которого достаточно', () => {
    const r = parseRegistrationForm(form({ fio: 'Петрова Мария', phone: '+7 900 111-22-33' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ fio: 'Петрова Мария', phone: '+79001112233' });
  });

  test('без ФИО не принимается', () => {
    const r = parseRegistrationForm(form({ phone: '+79001112233' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('ФИО');
  });

  test('без телефона не принимается: по нему опознают человека при выдаче набора', () => {
    const r = parseRegistrationForm(form({ fio: 'Петрова Мария' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('телефон');
  });

  test('церковь и статус по МДГ — как в анкете бота', () => {
    const r = parseRegistrationForm(form({
      fio: 'Петрова Мария', phone: '+79001112233', church: 'МБВ (Колизей)', mdgStatus: 'open',
    }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ church: 'МБВ (Колизей)', mdgStatus: 'open' });
  });

  test('придуманный статус по МДГ отвергается', () => {
    const r = parseRegistrationForm(form({ fio: 'Петрова Мария', phone: '+79001112233', mdgStatus: 'придумано' }));
    expect(r.ok).toBe(false);
  });

  test('статус по МДГ можно не выбирать', () => {
    const r = parseRegistrationForm(form({ fio: 'Петрова Мария', phone: '+79001112233' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.mdgStatus).toBeUndefined();
  });
});
