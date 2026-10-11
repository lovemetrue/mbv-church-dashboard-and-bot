import type { GroupBrief, GroupItem, RequestItem } from '@contracts';
import type { BucketFilter } from '../../entities/buckets';
import { phoneDigits } from '../../entities/format';
import { RESP_NOBODY } from '../../shared/nav/params';

/**
 * Поиск по заявкам: ФИО, место, ответственного и комментарий ищем как подстроку без учёта
 * регистра; телефон — по цифрам, чтобы «9114» находил «+7 (911) 4…» в любой записи номера.
 * Цифры сравниваем, только если в запросе их хотя бы три: иначе «1» нашёл бы половину очереди.
 * ФИО с местом склеены (как было: «Орлов Беговая» находит), а ответственный и комментарий
 * проверяются отдельно: запрос из нескольких слов не должен находить заявку «на стыке» чужих полей.
 */
export type Searchable = Pick<RequestItem, 'fio' | 'place' | 'responsible' | 'note' | 'phone'>;

export function matchesSearch(r: Searchable, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (`${r.fio} ${r.place ?? ''}`.toLowerCase().includes(q)) return true;
  if ((r.responsible ?? '').toLowerCase().includes(q) || (r.note ?? '').toLowerCase().includes(q)) return true;
  const digits = phoneDigits(q);
  return digits.length >= 3 && phoneDigits(r.phone).includes(digits);
}

export function searchRequests(items: readonly RequestItem[], query: string): RequestItem[] {
  return items.filter((r) => matchesSearch(r, query));
}

/**
 * Отбор «В работе у»: '' — все, RESP_NOBODY — заявки без ответственного, иначе имя целиком.
 * Применяется вместе с поиском до счётчиков чипов, поэтому числа на чипах и очередь обзвона
 * (с соседними заявками в карточке) видят один и тот же список.
 */
export function filterByResponsible<T extends Pick<RequestItem, 'responsible'>>(items: readonly T[], who: string): T[] {
  if (!who) return [...items];
  if (who === RESP_NOBODY) return items.filter((r) => !r.responsible);
  return items.filter((r) => r.responsible === who);
}

/** Имена для списка «В работе у»: без пустых и повторов, по алфавиту. */
export function responsibleNames(items: readonly Pick<RequestItem, 'responsible'>[]): string[] {
  const names = new Set<string>();
  for (const r of items) if (r.responsible) names.add(r.responsible);
  return [...names].sort((a, b) => a.localeCompare(b, 'ru'));
}

export interface BucketCounts {
  all: number;
  /** «К обзвону»: готовые к утверждению и те, кому надо перезвонить. */
  queue: number;
  ready: number;
  callback: number;
  human: number;
  done: number;
}

/** Счётчики на чипах считаются по найденному, а не по всему: так видно, сколько попало в поиск. */
export function countBuckets(items: readonly RequestItem[]): BucketCounts {
  const c: BucketCounts = { all: 0, queue: 0, ready: 0, callback: 0, human: 0, done: 0 };
  for (const r of items) {
    if (r.bucket === 'cancelled') continue;
    c.all++;
    c[r.bucket]++;
    if (r.bucket === 'ready' || r.bucket === 'callback') c.queue++;
  }
  return c;
}

/**
 * Отбор по чипу. «К обзвону» — ready и callback вместе, сначала callback: тем, кто просил
 * перезвонить, звонят раньше. Внутри группы порядок сохраняется как пришёл с сервера.
 */
export function filterByBucket(items: readonly RequestItem[], bucket: BucketFilter): RequestItem[] {
  const open = items.filter((r) => r.bucket !== 'cancelled');
  if (bucket === 'all') return open;
  if (bucket === 'queue') {
    return [...open.filter((r) => r.bucket === 'callback'), ...open.filter((r) => r.bucket === 'ready')];
  }
  return open.filter((r) => r.bucket === bucket);
}

/** Сколько параметров подбора известно у человека (из четырёх). */
export function knownParams(r: RequestItem): number {
  return r.dataFill.filter(Boolean).length;
}

/**
 * Как система поняла удобное время: «Пн, Ср · вечер». Берём разобранные поля заявки (`days`, `slot`),
 * а не слова человека: именно по ним считается подбор. null — разобрать не удалось.
 */
export function understoodTime(r: Pick<RequestItem, 'days' | 'slot'>): string | null {
  const days = r.days.join(', ');
  if (!days && !r.slot) return null;
  return [days || 'любой день', r.slot ?? ''].filter(Boolean).join(' · ');
}

/** Запись журнала «Заявка создана…»: только её можно раскрыть и сверить с анкетой. */
export const isCreationEntry = (text: string): boolean => /^Заявка (создана|перенесена)/.test(text);

/** Почему в группу сейчас нельзя утвердить; null — можно. Решает расчёт на клиенте только для подсказки: окончательно проверяет сервер. */
export type UnavailableReason = 'doNotRefer' | 'closed' | 'noSeats';

export function unavailableReason(
  brief: Pick<GroupBrief, 'free'>,
  full?: Pick<GroupItem, 'doNotRefer' | 'acceptsNew'>,
): UnavailableReason | null {
  if (full?.doNotRefer) return 'doNotRefer';
  if (full && !full.acceptsNew) return 'closed';
  if (brief.free <= 0) return 'noSeats';
  return null;
}
