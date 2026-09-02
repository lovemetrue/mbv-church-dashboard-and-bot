import type { UserRow } from '../db/repos/users.repo.js';
import { MDG_SHORT } from './texts.js';

const TZ = process.env.TIMEZONE ?? 'Europe/Moscow';

const HEADERS = [
  '№ регистрации',
  'Платформа',
  'ФИО',
  'Телефон',
  'Церковь',
  'Малая группа',
  'Ведущий группы',
  'Район / адрес',
  'Возраст',
  'С кем посещает',
  'Анкета заполнена',
  'Набор выдан',
  'Дата регистрации',
  'Регистрировал',
  'Связь',
  'Комментарий служителя',
  'Ник',
] as const;

/** Excel на русской локали ждёт разделителем точку с запятой. */
const SEP = ';';

const CONTACT_LABEL: Record<string, string> = {
  telegram: 'Telegram',
  max: 'MAX',
  call: 'звонок',
};

function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s.includes(SEP) || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replaceAll('"', '""').replace(/\r?\n/g, ' ')}"`;
  }
  return s;
}

function moscowDateTime(d: Date | null): string {
  if (!d) return '';
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}.${get('month')}.${get('year')} ${get('hour')}:${get('minute')}`;
}

/** Выгрузка участников для церкви. BOM в начале, иначе Excel показывает кракозябры. */
export function usersToCsv(users: UserRow[]): string {
  const rows = users.map((u) =>
    [
      u.registration_no,
      u.platform,
      u.full_name,
      u.phone,
      u.church,
      u.mdg_status ? MDG_SHORT[u.mdg_status] : '',
      u.leader_name,
      u.location,
      u.age,
      u.companions,
      u.complete ? 'да' : 'нет',
      u.kit_issued_at ? moscowDateTime(u.kit_issued_at) : 'нет',
      moscowDateTime(u.registered_at),
      u.registered_by ? `служитель ${u.registered_by}` : 'сам',
      u.preferred_contact ? (CONTACT_LABEL[u.preferred_contact] ?? u.preferred_contact) : '',
      u.admin_comment,
      u.username,
    ]
      .map(cell)
      .join(SEP),
  );

  return '﻿' + [HEADERS.join(SEP), ...rows].join('\r\n') + '\r\n';
}
