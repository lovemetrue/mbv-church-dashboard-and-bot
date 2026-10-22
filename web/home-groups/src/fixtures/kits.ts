import type { KitFindOk, KitIssueOk, KitPerson, KitsView } from '@contracts';
import { ApiError } from '../shared/api/client';
import { RAW_EXTRA_PEOPLE } from './raw';

/**
 * «Наборы» в демо: участники с номером регистрации из фикстур людей. Выдача и отмена в демо запоминаются
 * до перезагрузки страницы — так видно, как меняются карточка, счётчики и «Последние выдачи».
 */
const issued = new Map<number, string>(
  RAW_EXTRA_PEOPLE.filter((p) => p.userId !== null && p.registrationNo !== null && p.kitIssuedOn)
    .map((p) => [p.userId!, `${p.kitIssuedOn}T12:00:00+03:00`]),
);

function people(): KitPerson[] {
  return RAW_EXTRA_PEOPLE.filter((p) => p.userId !== null && p.registrationNo !== null).map((p) => ({
    userId: p.userId!,
    registrationNo: p.registrationNo!,
    fio: p.fio,
    phone: p.phone,
    issuedAt: issued.get(p.userId!) ?? null,
    issuedBy: issued.has(p.userId!) ? 'demo' : null,
  }));
}

export function buildKits(): KitsView {
  const all = people();
  const recent = all.filter((p) => p.issuedAt).sort((a, b) => (b.issuedAt ?? '').localeCompare(a.issuedAt ?? ''));
  const today = new Date().toISOString().slice(0, 10);
  return {
    generatedAt: new Date().toISOString(),
    registered: all.length,
    issued: recent.length,
    issuedToday: recent.filter((p) => p.issuedAt!.startsWith(today)).length,
    recent,
  };
}

/** Разбор кода в демо проще серверного: годится любое число в тексте QR. */
export function findDemoKit(body: unknown): KitFindOk {
  const code = String((body as { code?: unknown } | null)?.code ?? '');
  const no = Number(/(\d+)/.exec(code)?.[1]);
  const person = people().find((p) => p.registrationNo === no);
  if (!person) throw new ApiError(404, Number.isFinite(no) ? `Регистрации №${no} нет.` : 'Это не QR регистрации.', 'not_found');
  return { ok: true, person };
}

export function demoKitAction(action: 'issue' | 'undo', body: unknown): KitIssueOk {
  const userId = Number((body as { userId?: unknown } | null)?.userId);
  const had = issued.has(userId);
  if (action === 'issue' && !had) issued.set(userId, new Date().toISOString());
  if (action === 'undo') issued.delete(userId);
  const person = people().find((p) => p.userId === userId);
  if (!person) throw new ApiError(404, 'Регистрация не найдена.', 'not_found');
  return { ok: true, person, changed: action === 'issue' ? !had : had };
}
