import type { CoordinatorItem, FormMeta, GroupItem } from '@contracts';
import { ru } from '../../shared/i18n/ru';
import { optionsWithPicked } from '../../shared/multiValue';

const m = ru.manage;

/** Описание одного поля формы правки. Имена совпадают с полями `UpdateBody` на сервере. */
export interface EditField {
  name: string;
  label: string;
  /** multi — несколько галочек, значение одной строкой через запятую (см. `toggleInList`). */
  kind: 'text' | 'select' | 'textarea' | 'date' | 'checkbox' | 'multi';
  /** Пустое значение недопустимо: сервер всё равно отказал бы, поэтому «Сохранить» не включается. */
  required?: boolean;
  /** Для select и multi. */
  options?: string[];
  /** Пояснение под полем. */
  hint?: string;
  placeholder?: string;
  inputMode?: 'numeric' | 'tel';
  /** Для date: самая поздняя допустимая дата («2026-10-11»), например «не из будущего». */
  max?: string;
  /** На всю ширину окна, а не в половину. */
  wide?: boolean;
}

export interface EditSpec {
  fields: EditField[];
  /** Значения при открытии формы. У флажка — '1' (отмечен) или ''. */
  initial: Record<string, string>;
  /** Пояснение под полями. */
  note?: string;
}

/**
 * Что отправить на сервер: ТОЛЬКО изменённые поля. Сервер берёт непосланное из базы, поэтому
 * незатронутое поле нельзя слать даже «как было»: закрытые поля (адрес, телефоны) формы не видела,
 * а чужую правку, пришедшую между открытием формы и «Сохранить», мы бы затёрли своими старыми значениями.
 * Очищенное необязательное поле уходит пустой строкой (так сервер его очищает); флажок — '1' или '0'.
 */
export function changedFields(spec: EditSpec, values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of spec.fields) {
    const now = (values[f.name] ?? '').trim();
    const was = (spec.initial[f.name] ?? '').trim();
    if (now === was) continue;
    out[f.name] = f.kind === 'checkbox' ? (now ? '1' : '0') : now;
  }
  return out;
}

/** Обязательные поля, которые человек опустошил. Поле, пустое с самого начала, не считается: его вины нет. */
export function blankRequired(spec: EditSpec, values: Record<string, string>): string[] {
  return spec.fields
    .filter((f) => f.required && (values[f.name] ?? '').trim() === '' && (spec.initial[f.name] ?? '').trim() !== '')
    .map((f) => f.name);
}

/** Значение, которого нет в справочнике (устаревшее или из таблицы), остаётся выбираемым: иначе форма его теряла бы. */
const withCurrent = (list: readonly string[], current: string | null): string[] =>
  current && !list.includes(current) ? [current, ...list] : [...list];

function feedbackNow(days: number | null): string {
  if (days === null) return m.group.feedbackNever;
  if (days === 0) return m.group.feedbackToday;
  return m.group.feedbackAgo(days);
}

/**
 * Форма правки группы. Сервер не отдаёт интерфейсу «время» и «дату обратной связи» в чистом виде
 * (только собранное «Вт, вечер» и «дней назад»), поэтому эти поля пустые и отправляются, только если
 * их вписали; под ними подсказка с текущим значением.
 *
 * Телефоны ведущего и соведущего открываются с текущим значением: по ним координаторы обзванивают ведущих, и
 * правка вслепую («впишите новый, текущий не показывается») только путала. Как и у остальных полей, уходит лишь
 * изменённое; очищенное поле стирает номер.
 */
export function groupEditSpec(g: GroupItem, meta: FormMeta): EditSpec {
  const t = m.group.fields;
  const keep = m.group.keepHint;
  return {
    fields: [
      { name: 'leader', label: t.leader, kind: 'text', required: true, wide: true },
      { name: 'district', label: t.district, kind: 'select', required: true, options: withCurrent(meta.districts, g.district) },
      // Подбор сопоставляет сначала по адресу, а если он пуст — по метро или ориентиру: оба поля видны и правятся здесь.
      { name: 'address', label: t.address, kind: 'text', wide: true, hint: m.group.addressHint },
      { name: 'metro', label: t.metro, kind: 'text', wide: true, hint: m.group.metroHint },
      { name: 'format', label: t.format, kind: 'select', required: true, options: withCurrent(meta.groupFormats, g.format) },
      { name: 'status', label: t.status, kind: 'select', required: true, options: withCurrent(meta.groupStatuses, g.status) },
      { name: 'people', label: t.people, kind: 'text', inputMode: 'numeric', placeholder: m.group.peoplePlaceholder },
      { name: 'day', label: t.day, kind: 'select', options: withCurrent(ru.create.days, g.day) },
      {
        name: 'time',
        label: t.time,
        kind: 'text',
        placeholder: m.group.timePlaceholder,
        hint: `${m.group.now(g.whenText ?? m.group.notSpecified)} ${keep}`,
      },
      { name: 'composition', label: t.composition, kind: 'multi', wide: true, options: optionsWithPicked(meta.compositions, g.composition ?? '') },
      { name: 'age', label: t.age, kind: 'select', options: withCurrent(meta.ageGroups, g.ageText) },
      { name: 'openToNew', label: t.openToNew, kind: 'select', options: withCurrent(meta.openToNew.map((o) => o.value), g.openToNew) },
      { name: 'coordinator', label: t.coordinator, kind: 'select', options: withCurrent(meta.coordinators, g.coordinator) },
      { name: 'coLeader', label: t.coLeader, kind: 'text' },
      { name: 'phone', label: t.phone, kind: 'text', inputMode: 'tel' },
      { name: 'coLeaderPhone', label: t.coLeaderPhone, kind: 'text', inputMode: 'tel' },
      
      { name: 'feedbackAt', label: t.feedbackAt, kind: 'date', hint: `${feedbackNow(g.verifiedDaysAgo)} ${keep}` },
      { name: 'openedOn', label: t.openedOn, kind: 'date', hint: m.group.openedOnHint },
      { name: 'training', label: t.training, kind: 'text' },
      { name: 'comment', label: t.comment, kind: 'textarea', wide: true },
      { name: 'checked', label: t.checked, kind: 'checkbox', wide: true },
      { name: 'campaignRegistered', label: t.campaignRegistered, kind: 'checkbox', wide: true },
      { name: 'doNotRefer', label: m.group.doNotRefer, kind: 'checkbox', wide: true, hint: m.group.doNotReferHint },
    ],
    initial: {
      leader: g.leader,
      district: g.district,
      metro: g.metro ?? '',
      format: g.format ?? '',
      status: g.status,
      people: g.people === null ? '' : String(g.people),
      day: g.day ?? '',
      time: '',
      composition: g.composition ?? '',
      age: g.ageText ?? '',
      openToNew: g.openToNew ?? '',
      training: g.training ?? '',
      checked: g.checked ? '1' : '',
      campaignRegistered: g.campaignRegistered ? '1' : '',
      coordinator: g.coordinator ?? '',
      coLeader: g.coLeader ?? '',
      phone: g.phone ?? '',
      coLeaderPhone: g.coLeaderPhone ?? '',
      address: g.address ?? '',
      feedbackAt: '',
      openedOn: g.openedOn ?? '',
      comment: g.comment ?? '',
      doNotRefer: g.doNotRefer ? '1' : '',
    },
  };
}

export function coordinatorEditSpec(c: CoordinatorItem): EditSpec {
  const t = m.coordinator.fields;
  return {
    fields: [
      { name: 'name', label: t.name, kind: 'text', required: true, wide: true },
      { name: 'role', label: t.role, kind: 'text', required: true, wide: true },
    ],
    initial: { name: c.name, role: c.role },
    note: m.coordinator.renameNote,
  };
}
