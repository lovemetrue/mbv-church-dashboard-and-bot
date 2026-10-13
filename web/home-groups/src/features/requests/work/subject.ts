import type { OtherItem, RequestItem, StrangeMark } from '@contracts';

/**
 * Минимум полей, которые нужны блоку «Работа с заявкой»: заявка из подбора и «другое обращение»
 * устроены по-разному, но звонят, передают, правят и закрывают их одинаково. Блок не знает ни про
 * предложения, ни про корзины: ему важно лишь, открыта ли запись, готова ли и аннулирована ли.
 */
export interface WorkSubject {
  /** request — идёт в подбор группы; other — всё остальное (возврат из закрытого говорит по-другому). */
  kind: 'request' | 'other';
  id: number;
  fio: string;
  phone: string | null;
  ageLabel: string | null;
  place: string | null;
  /** Улица и дом, удобное время: у «другого обращения» их в списке нет (null), правка всё равно возможна. */
  address: string | null;
  schedule: string | null;
  note: string | null;
  responsible: string | null;
  callback: boolean;
  /** Метка «Странный человек» на человеке записи; null — нет. */
  strange: StrangeMark | null;
  /** open — в работе; done — обработана или утверждена; cancelled — аннулирована. */
  state: 'open' | 'done' | 'cancelled';
}

export function subjectOfRequest(r: RequestItem): WorkSubject {
  return {
    kind: 'request',
    id: r.id,
    fio: r.fio,
    phone: r.phone,
    ageLabel: r.ageLabel,
    place: r.place,
    address: r.streetInfo.text,
    schedule: r.scheduleInfo.text,
    note: r.note,
    responsible: r.responsible,
    callback: r.callback,
    strange: r.strange,
    state: r.bucket === 'done' ? 'done' : r.bucket === 'cancelled' ? 'cancelled' : 'open',
  };
}

export function subjectOfOther(o: OtherItem): WorkSubject {
  return {
    kind: 'other',
    id: o.id,
    fio: o.fio,
    phone: o.phone,
    ageLabel: o.ageLabel,
    place: o.place,
    address: null,
    schedule: null,
    note: o.note,
    responsible: o.responsible,
    callback: o.callback,
    strange: o.strange,
    state: o.state,
  };
}
