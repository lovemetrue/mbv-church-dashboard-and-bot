import { describe, expect, test } from 'vitest';
import { ADMIN_MENU, RETIRED_LABELS, adminMenu, commandByLabel, retiredLabel } from '../src/admin/menu.js';

describe('клавиатура служителя', () => {
  test('на клавиатуре только то, что умеет один бот: рассылки, день и служебное', () => {
    expect(adminMenu(true).flat().map((b) => b.command)).toEqual([
      '/kit', '/broadcast', '/setday', '/start', '/reset',
    ]);
  });

  test('без разрешения на очистку кнопки очистки нет', () => {
    expect(adminMenu(false).flat().map((b) => b.command)).toEqual([
      '/kit', '/broadcast', '/setday', '/start',
    ]);
  });

  test('нажатие кнопки превращается в команду', () => {
    expect(commandByLabel(ADMIN_MENU[0]![0]!.label)).toBe('/kit');
  });

  test('лишние пробелы вокруг подписи не мешают', () => {
    expect(commandByLabel(`  ${ADMIN_MENU[0]![0]!.label}  `)).toBe('/kit');
  });

  test('обычный текст участника командой не считается', () => {
    expect(commandByLabel('Спасибо!')).toBeNull();
    expect(commandByLabel('Статистика')).toBeNull();
  });

  test('подписи не повторяются: иначе кнопка вызывала бы не ту команду', () => {
    const labels = adminMenu(true).flat().map((b) => b.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  test('в ряду не больше двух кнопок, чтобы подписи не обрезались', () => {
    expect(adminMenu(true).every((row) => row.length <= 2)).toBe(true);
  });
});

describe('снятые кнопки', () => {
  test('подписи убранных кнопок узнаются', () => {
    // Клавиатура живёт в клиенте: у служителей она останется старой, пока не обновится.
    expect(retiredLabel('📊 Статистика')).toBe(true);
    expect(retiredLabel('👥 Добавить ведущего')).toBe(true);
    expect(retiredLabel('  📋 Заявки  ')).toBe(true);
    // А вернувшиеся на клавиатуру снятыми уже не считаются.
    expect(retiredLabel('📦 Выдать набор')).toBe(false);
    expect(retiredLabel('📣 Объявление')).toBe(false);
    expect(retiredLabel('✏️ Загрузить день')).toBe(false);
  });

  test('обычный текст снятой кнопкой не считается', () => {
    expect(retiredLabel('Иванов Иван')).toBe(false);
    expect(retiredLabel('')).toBe(false);
  });

  test('в списке снятых нет подписей, которые ещё на клавиатуре', () => {
    const live = new Set(adminMenu(true).flat().map((b) => b.label));
    for (const label of RETIRED_LABELS) expect(live.has(label), label).toBe(false);
  });
});
