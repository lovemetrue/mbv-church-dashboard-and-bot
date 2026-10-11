/**
 * Дополнения к заявкам для режима фикстур: откуда взяты время и улица и что человек заполнил сам.
 * Вынесено отдельно от raw.ts, чтобы не раздувать сырые данные и не мешать правке групп.
 * Вымышленные данные; у заявок из таблицы анкеты нет, поэтому у них всё пусто.
 */
import type { OriginalField, ParamInfo } from '@contracts';
import { formatPhone } from '../entities/format';
import type { RawRequest } from './raw';

export interface RequestExtras {
  scheduleInfo: ParamInfo;
  streetInfo: ParamInfo;
  original: OriginalField[];
}

const none: ParamInfo = { text: null, source: null };
const anketa = (text: string): ParamInfo => ({ text, source: 'anketa' });
const manual = (text: string): ParamInfo => ({ text, source: 'manual' });

/** Что человек написал в анкете бота: время, улица и ответ про Малую группу — в порядке вопросов. */
const answers = (
  r: RawRequest,
  time: string | null,
  street: string | null,
  mdg = 'Хочу вступить в группу',
): OriginalField[] => [
  { label: 'Имя', value: r.fio },
  ...(r.phone ? [{ label: 'Телефон', value: formatPhone(r.phone) }] : []),
  ...(r.ageLabel ? [{ label: 'Возраст', value: r.ageLabel }] : []),
  ...(r.place ? [{ label: 'Где удобно', value: r.place }] : []),
  ...(time ? [{ label: 'Удобные день и время', value: time }] : []),
  ...(street ? [{ label: 'Улица, дом', value: street }] : []),
  { label: 'Малая группа', value: mdg },
];

/**
 * Что сказал человек про время и улицу (id заявки → слова из анкеты) и кто потом поправил.
 * Значения подобраны так, чтобы были все случаи: время понято, время не разобрано, правка координатора.
 */
const SAID: Record<number, { time?: ParamInfo; street?: ParamInfo }> = {
  1: { time: anketa('вт, чт вечером'), street: anketa('Комендантский пр.') },
  3: { time: anketa('по понедельникам днём') },
  4: { time: anketa('четверг или пятница, вечером') },
  6: { time: anketa('среда, пятница после работы'), street: manual('Лиговский пр.') },
  7: { time: anketa('по субботам с утра') },
  8: { time: anketa('как получится, лучше ближе к выходным') },
  9: { time: manual('пн, ср днём'), street: anketa('пр. Просвещения') },
  13: { time: anketa('четверг вечером'), street: anketa('ул. Шаврова') },
  14: { time: anketa('в пятницу') },
  15: { time: anketa('пятница, суббота вечером') },
  17: { time: anketa('чт после работы'), street: anketa('ул. Харченко') },
  19: { time: anketa('понедельник с утра') },
};

export function requestExtras(r: RawRequest): RequestExtras {
  const said = SAID[r.id] ?? {};
  const fromBot = r.source.startsWith('Бот');
  return {
    scheduleInfo: said.time ?? none,
    streetInfo: said.street ?? none,
    // В анкете человек писал сам; координаторскую правку в «исходное» не кладём.
    original: fromBot
      ? answers(
          r,
          said.time?.source === 'anketa' ? said.time.text : null,
          said.street?.source === 'anketa' ? said.street.text : null,
        )
      : [],
  };
}
