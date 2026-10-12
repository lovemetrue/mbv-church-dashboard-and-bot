/**
 * Демо-состояние метки «Странный человек». Сервера нет, поэтому без него флажок в карточке ничего бы не менял.
 * Метка привязана к человеку, а не к заявке: ключ — цифры телефона, а если телефона нет, ключ человека справочника
 * («r12», «u2»). Так метка, поставленная на заявке, видна и в «Людях», и в составе группы, и на другой заявке с тем же телефоном.
 * Живёт в модуле, как «разобранные» обращения.
 */
import type { NoPlan, StrangeMark } from '@contracts';
import { phoneDigits } from '../entities/format';

const seed = (by: string, at: string, note: string | null): StrangeMark => ({ by, at, note });

/** Что отмечено «с самого начала»: заявка без регистрации, заявка с карточкой и составом, ведущий и обращение. Заявка № 14 выбрана за то, что в «Нужна помощь» она и так: метка не сдвигает корзины, на которые рассчитаны остальные демо-сценарии. */
const SEED: Record<string, StrangeMark> = {
  // Лариса Кулик, заявка № 14
  '79095503100': seed('mbv_admin', '2026-10-08T09:30:00.000Z', 'По телефону говорила, что за ней следят; просит группу без детей.'),
  // Георгий Шмелёв, заявка № 12 (он же в составе группы ДГ-0004)
  '79162274000': seed('mbv_admin', '2026-10-07T15:10:00.000Z', null),
  // Михаил Громов, участник u2 (в составе группы ДГ-0002)
  '79210001755': seed('mbv_admin', '2026-09-20T11:00:00.000Z', 'Резко реагирует на замечания.'),
  // Игорь Седов, обращение № 201
  '79215550101': seed('mbv_admin', '2026-10-09T08:45:00.000Z', 'Звонил несколько раз за день, разговор сумбурный.'),
};

/** Правки этой сессии: null — метку сняли, даже если она была в SEED. */
const edits = new Map<string, StrangeMark | null>();

/** Для тестов: вернуть демо в начальное состояние. */
export function resetDemoStrange(): void {
  edits.clear();
}

/** Ключ человека: цифры телефона; без телефона — запасной ключ (заявка «r5», участник «u2»). */
export const strangeKey = (phone: string | null | undefined, fallback: string): string => phoneDigits(phone) || fallback;

/** Метка человека с учётом правок этой сессии. */
export function demoStrangeOf(phone: string | null | undefined, fallback: string): StrangeMark | null {
  const key = strangeKey(phone, fallback);
  return edits.has(key) ? (edits.get(key) ?? null) : (SEED[key] ?? null);
}

/** Поставить или снять метку; возвращает true, если ключ записан. */
export function setDemoStrange(key: string, value: boolean, note?: string | null): void {
  const text = note?.trim();
  edits.set(key, value ? { by: 'mbv_admin', at: new Date().toISOString(), note: text ? text : null } : null);
}

/** Почему заявку не подбирают: так её описывает сервер. */
export const STRANGE_NO_PLAN: NoPlan = {
  code: 'strange',
  reason: 'Отмечен как «странный человек»: нужна отдельная группа, подберите её вручную',
};
