import type { KitsIssuedView, Me } from '@contracts';
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { json } from '../../test/calls';
import { renderAt, stubFetchWithFixtures } from '../../test/render';
import { KitsIssuedModal, matchesIssued } from './KitsIssuedModal';

afterEach(() => vi.unstubAllGlobals());

const list: KitsIssuedView = {
  generatedAt: 'g',
  items: [{ userId: 7, registrationNo: 7, fio: 'Анна Смирнова', phone: '… 11-22', issuedAt: '2026-10-22T08:30:00Z', issuedBy: 'p_ivanova' }],
};

const open = (role: Me['role']) => {
  stubFetchWithFixtures({ me: () => json({ role }), 'kits/issued': () => json(list) });
  renderAt(<KitsIssuedModal onClose={() => {}} />);
};

describe('окно выданных наборов', () => {
  test('«Только чтение» видит список, но «Отменить выдачу» у него нет', async () => {
    open('readonly');
    const dialog = await screen.findByRole('dialog', { name: 'Выданные наборы' });
    expect(await within(dialog).findByText('Анна Смирнова')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /Отменить выдачу/ })).not.toBeInTheDocument();
  });

  test('обычному входу кнопка отмены доступна', async () => {
    open('admin');
    expect(await screen.findByRole('button', { name: 'Отменить выдачу: Анна Смирнова' })).toBeInTheDocument();
  });

  test('хвост телефона из закрытого входа показывается как пришёл', async () => {
    open('admin');
    expect(await screen.findByText('… 11-22')).toBeInTheDocument();
  });

  test('поиск: одна цифра — номер регистрации, не телефон; от четырёх цифр — и телефон', () => {
    const p = { ...list.items[0]!, phone: '+7 911 000-11-22' };
    expect(matchesIssued(p, '7')).toBe(true);
    expect(matchesIssued(p, '1')).toBe(false);
    expect(matchesIssued(p, '№ 11')).toBe(false);
    expect(matchesIssued(p, '1122')).toBe(true);
    expect(matchesIssued(p, '№1122')).toBe(false);
    expect(matchesIssued(p, 'СМИРНОВА анна')).toBe(true);
  });
});
