/**
 * Составы групп для режима фикстур. Здесь только «что внесено вручную»: имя и телефон человека не
 * копируются, а читаются из справочника людей по ключу (u1, r12, p1), как и на сервере. Направленные
 * через сервис (`placed`) в таблицу не входят: они берутся из закрытых заявок (build.ts).
 */

export interface RawManualMember {
  /** Номер строки состава. */
  id: number;
  groupId: number;
  /** Ключ человека в справочнике: u — участник, r — заявка без регистрации, p — карточка, внесённая вручную. */
  personKey: string;
  date: string | null;
  note: string | null;
}

/**
 * Дарья Ефимова (u1) состоит сразу в двух группах: так в демо видна метка «Есть и в…».
 * Группы 3 и 5 без состава: так виден пустой состав.
 */
export const RAW_MANUAL_MEMBERS: RawManualMember[] = [
  { id: 1, groupId: 1, personKey: 'u1', date: '2026-09-01', note: 'Ходит с лета' },
  { id: 2, groupId: 1, personKey: 'p1', date: '2026-08-18', note: null },
  { id: 3, groupId: 2, personKey: 'u2', date: '2026-07-06', note: null },
  { id: 4, groupId: 4, personKey: 'u1', date: '2026-09-15', note: null },
  { id: 5, groupId: 4, personKey: 'r12', date: null, note: 'Пришёл по приглашению ведущего' },
];
