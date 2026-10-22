import type { KitFindOk, KitIssueOk, KitPerson, KitSearchOk, KitsView } from '@contracts';
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

/** Поиск по ФИО в демо: каждое слово в имени, «ё» как «е» — как на сервере, но без лимита. */
export function searchDemoKits(body: unknown): KitSearchOk {
  const norm = (v: string) => v.toLowerCase().replace(/ё/g, 'е');
  const words = norm(String((body as { query?: unknown } | null)?.query ?? '')).split(/\s+/).filter(Boolean);
  if (words.join('').length < 3) throw new ApiError(400, 'Введите хотя бы 3 буквы имени или фамилии.', 'bad_request');
  const items = people()
    .filter((p) => words.every((w) => norm(p.fio).includes(w)))
    .map((p) => ({ userId: p.userId, registrationNo: p.registrationNo, fio: p.fio, phoneTail: p.phone ? p.phone.slice(-4) : null, issuedAt: p.issuedAt }));
  return { ok: true, items, more: false };
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
