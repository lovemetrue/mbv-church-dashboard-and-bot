import ExcelJS from 'exceljs';
import { distribute, type Owner, type Seeker } from '../core/distribution.js';
import { hardFailure, type MatchOptions } from '../core/matching.js';
import { formatPhone } from '../core/phone.js';
import type { DashboardGroup } from '../db/repos/groups.repo.js';
import { CLOSED_STATUSES, type DashboardRequest } from '../db/repos/requests.repo.js';

/**
 * Разовое сопоставление «желающие → группы» одним файлом Excel для служителя.
 *
 * Считается на сервере дашборда по живым данным: людей и телефоны никто не выгружает во
 * внешние сервисы, файл уходит только тому, кто вошёл в дашборд. Правила — те же, что у подбора
 * в карточке заявки (core/matching.ts), распределение по очереди — core/distribution.ts.
 */

export interface ReportRow {
  n: number;
  fio: string;
  phone: string;
  age: string;
  place: string;
  schedule: string;
  address: string;
  status: string;
  date: string;
  responsible: string;
  recommended: string;
  group: string;
  groupWhere: string;
  kind: string;
  score: number | '';
  geo: string;
  principle: string;
  alternatives: string;
  check: string;
  note: string;
}

export interface ReportGroupRow {
  leader: string;
  no: number | null;
  district: string;
  metro: string;
  status: string;
  open: string;
  age: string;
  coordinator: string;
  before: number | null;
  added: number;
  after: number | '';
  inPool: 'да' | 'нет';
  why: string;
  comment: string;
}

export interface ReportOwnerRow {
  fio: string;
  phone: string;
  age: string;
  place: string;
  status: string;
  assigned: number;
  /** ФИО назначенных этому владельцу людей через запятую. */
  people: string;
}

export interface MatchingReport {
  rows: ReportRow[];
  groupRows: ReportGroupRow[];
  ownerRows: ReportOwnerRow[];
  meta: {
    openRequests: number;
    alreadyPlaced: number;
    distributed: number;
    assigned: number;
    noGroup: number;
    needsCheck: number;
    groupsTotal: number;
    pool: number;
    owners: number;
    campaignActive: boolean;
    noReferGroups: { leader: string; status: string; comment: string }[];
  };
}

const isOpen = (r: DashboardRequest): boolean => !CLOSED_STATUSES.includes(r.status);
const text = (v: string | null | undefined): string => v ?? '';

export function buildMatchingReport(input: {
  requests: readonly DashboardRequest[];
  groups: readonly DashboardGroup[];
  campaignActive: boolean;
}): MatchingReport {
  const { requests, groups } = input;
  const opts: MatchOptions = { campaignActive: input.campaignActive };

  const seekersAll = requests.filter((r) => r.type === 'join_group' && isOpen(r));
  // Кому группу уже назначили в дашборде или написали итоговую, тех не перераспределяем.
  const placed = seekersAll.filter((r) => r.group_id !== null || r.final_group);
  const todo = seekersAll
    .filter((r) => r.group_id === null && !r.final_group)
    .sort((a, b) => text(a.date).localeCompare(text(b.date)) || a.id - b.id);

  const openers = requests.filter((r) => r.type === 'lead_group' && isOpen(r));
  const owners: Owner[] = openers.map((r) => ({
    id: String(r.id), name: text(r.fio) || 'без имени', place: r.place, age: r.age,
  }));

  const seekers: Seeker[] = todo.map((r) => ({ id: r.id, age: r.age, place: r.place }));
  const { assignments, load, ownerLoad } = distribute(seekers, groups, owners, opts);

  // id будущих групп владельцев отрицательные; см. distribute().
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const ownerByGroupId = new Map<number, Owner>();
  owners.forEach((o, i) => ownerByGroupId.set(-(i + 1), o));
  const label = (id: number): string => {
    const owner = ownerByGroupId.get(id);
    return owner ? `Новая группа: ${owner.name}` : groupById.get(id)?.leader ?? '';
  };
  const where = (id: number): string => {
    const owner = ownerByGroupId.get(id);
    if (owner) return text(owner.place);
    const g = groupById.get(id);
    return g ? [g.district, g.metro].filter(Boolean).join(', ') : '';
  };

  const peopleByOwner = new Map<string, string[]>();
  const rows: ReportRow[] = assignments.map((a, i) => {
    const r = todo[i]!;
    if (a.ownerId) peopleByOwner.set(a.ownerId, [...(peopleByOwner.get(a.ownerId) ?? []), text(r.fio)]);
    const assigned = a.groupId !== null;
    return {
      n: i + 1,
      fio: text(r.fio),
      phone: formatPhone(r.phones[0] ?? r.phone) || text(r.phone),
      age: text(r.age),
      place: text(r.place),
      schedule: text(r.schedule),
      address: text(r.address),
      status: r.status,
      date: text(r.date),
      responsible: text(r.responsible),
      recommended: text(r.recommended),
      group: assigned ? label(a.groupId!) : '',
      groupWhere: assigned ? where(a.groupId!) : '',
      kind: assigned ? (a.fresh ? 'новая' : 'действующая') : '',
      score: assigned ? a.score : '',
      geo: !assigned ? '' : a.sameDistrict && a.sameMetro ? 'район и метро' : a.sameDistrict ? 'район' : a.sameMetro ? 'метро' : 'нет',
      principle: a.principle,
      alternatives: a.alternatives
        .map((s, k) => `${k + 1}) ${label(s.groupId)} (${where(s.groupId)}) — ${s.score} оч.: ${s.reasons.join('; ')}`)
        .join('\n'),
      check: a.needsCheck ? 'да' : '',
      note: [r.note, r.extra].filter(Boolean).join(' | '),
    };
  });

  const groupRows: ReportGroupRow[] = groups
    .map((g) => {
      const l = load.get(g.id)!;
      const failure = hardFailure({ age: null, place: null }, g);
      const why = { status: 'не действует', closed: 'приём новых закрыт', hidden: 'не направлять', age: '' };
      return {
        leader: g.leader, no: g.no, district: g.district, metro: text(g.metro), status: g.status,
        open: text(g.open_to_new), age: text(g.age), coordinator: text(g.coordinator),
        before: l.before, added: l.added, after: l.before === null ? ('' as const) : l.before + l.added,
        inPool: failure ? ('нет' as const) : ('да' as const), why: failure ? why[failure] : '',
        comment: text(g.comment),
      };
    })
    .sort((a, b) => b.added - a.added || a.leader.localeCompare(b.leader, 'ru'));

  const ownerRows: ReportOwnerRow[] = openers.map((r) => ({
    fio: text(r.fio), phone: formatPhone(r.phones[0] ?? r.phone) || text(r.phone), age: text(r.age),
    place: text(r.place), status: r.status,
    assigned: ownerLoad.get(String(r.id)) ?? 0,
    people: (peopleByOwner.get(String(r.id)) ?? []).join(', '),
  }));

  return {
    rows,
    groupRows,
    ownerRows,
    meta: {
      openRequests: seekersAll.length,
      alreadyPlaced: placed.length,
      distributed: todo.length,
      assigned: assignments.filter((a) => a.groupId !== null).length,
      noGroup: assignments.filter((a) => a.groupId === null).length,
      needsCheck: assignments.filter((a) => a.groupId !== null && a.needsCheck).length,
      groupsTotal: groups.length,
      pool: groupRows.filter((g) => g.inPool === 'да').length,
      owners: owners.length,
      campaignActive: input.campaignActive,
      noReferGroups: groups
        .filter((g) => g.do_not_refer)
        .map((g) => ({ leader: g.leader, status: g.status, comment: text(g.comment) })),
    },
  };
}

// ── Excel ────────────────────────────────────────────────────────────────────

const HEAD_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } };
const WARN_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
const BAD_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8CBAD' } };
const BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFD9D9D9' } }, bottom: { style: 'thin', color: { argb: 'FFD9D9D9' } },
  left: { style: 'thin', color: { argb: 'FFD9D9D9' } }, right: { style: 'thin', color: { argb: 'FFD9D9D9' } },
};

interface Column<T> { header: string; width: number; wrap?: boolean; value: (row: T) => ExcelJS.CellValue }

/** Лист-таблица: заголовок, закреплённая шапка, фильтр, рамки. */
function tableSheet<T>(wb: ExcelJS.Workbook, name: string, columns: Column<T>[], data: readonly T[]): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c.header, width: c.width }));
  const head = ws.getRow(1);
  head.height = 34;
  head.eachCell((cell) => {
    cell.fill = HEAD_FILL;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial', size: 10 };
    cell.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
    cell.border = BORDER;
  });
  for (const item of data) {
    const row = ws.addRow(columns.map((c) => c.value(item)));
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.font = { name: 'Arial', size: 10 };
      cell.border = BORDER;
      cell.alignment = { wrapText: columns[col - 1]?.wrap ?? false, vertical: 'top' };
    });
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return ws;
}

const asDate = (iso: string): ExcelJS.CellValue => {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d;
};

const MOSCOW = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

function infoLines(m: MatchingReport['meta'], now: Date): { text: string; kind?: 'title' | 'h' }[] {
  const lines: { text: string; kind?: 'title' | 'h' }[] = [
    { text: 'Разовое сопоставление желающих и групп', kind: 'title' },
    { text: `Сформировано ${MOSCOW.format(now)} (Москва) по текущим данным дашборда.` },
    { text: '' },
    { text: 'ЧТО ВЗЯТО', kind: 'h' },
    { text: `Открытых заявок «хочу в группу»: ${m.openRequests}. У ${m.alreadyPlaced} из них группа уже назначена или указана итоговая — их не распределяли. Распределено: ${m.distributed}.` },
    { text: `Групп в реестре: ${m.groupsTotal}; участвуют в подборе: ${m.pool}. Остальные отсеяны жёсткими условиями (лист «Группы после распределения», колонка «Почему не в подборе»).` },
    { text: `Хотят открыть группу: ${m.owners}. Их будущие группы считаются новыми и идут первыми (лист «Хотят открыть»).` },
    { text: '' },
    { text: 'ПРАВИЛА', kind: 'h' },
    { text: 'Группа отсекается, если не выполнено хотя бы одно: статус «Функционирует» или «Кампания»; приём новых не «Нет»; возраст пересекается с возрастом человека; нет отметки «Не направлять».' },
    { text: `Очки: тот же район +3; то же метро или ориентир +2; статус «Кампания» в период кампании +2 (${m.campaignActive ? 'кампания идёт' : 'сейчас кампания не идёт, поэтому очков за это нет'}); участников меньше, чем в соседних группах района, +1.` },
    { text: 'Новые группы идут первыми; действующие добавляются, только если подходящих новых меньше трёх. Если возраст неизвестен («любой», пусто), по возрасту группа не отсекается; граница диапазонов считается пересечением.' },
    { text: '' },
    { text: 'КАК РАСПРЕДЕЛЯЛИ', kind: 'h' },
    { text: 'Люди шли по очереди, от самых давних заявок. После каждого назначения у группы на одного участника больше, поэтому очко «меньше участников, чем у соседей» работает и желающие одного района не попадают в одну группу. Вместимость групп правилами не ограничена: смотрите «Участников станет» на листе групп (5 и больше назначенных выделены).' },
    { text: 'Район и метро берутся из свободного текста, который человек написал. Район засчитывается, только если он назван; по названию станции район не определяется.' },
    { text: '' },
    { text: `ЧТО ПРОВЕРИТЬ ВРУЧНУЮ (${m.needsCheck} из ${m.assigned} назначений)`, kind: 'h' },
    { text: 'Колонка «Нужна проверка» = да, когда группа назначена без совпадения по району и метро: человек не указал место или назвал станцию, у которой нет подходящей группы. Тогда назначение основано только на возрасте и нагрузке групп.' },
  ];
  if (m.noGroup > 0) lines.push({ text: `Без группы осталось ${m.noGroup} человек: в комментарии написано, на каком условии отсеялись группы.` });
  lines.push({ text: '' }, { text: 'ГРУППЫ С ОТМЕТКОЙ «НЕ НАПРАВЛЯТЬ» (в подбор не вошли)', kind: 'h' });
  if (m.noReferGroups.length === 0) lines.push({ text: 'Таких групп нет.' });
  for (const g of m.noReferGroups) {
    lines.push({ text: `• ${g.leader} (${g.status})${g.comment ? `: «${g.comment}»` : ''}` });
  }
  return lines;
}

/** Собирает файл Excel из отчёта. */
export async function matchingWorkbook(report: MatchingReport, now: Date = new Date()): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Дашборд МБВ';
  wb.created = now;

  const info = wb.addWorksheet('Как считали');
  info.getColumn(1).width = 120;
  infoLines(report.meta, now).forEach((line, i) => {
    const cell = info.getCell(i + 1, 1);
    cell.value = line.text;
    cell.alignment = { wrapText: true, vertical: 'top' };
    cell.font = {
      name: 'Arial', size: line.kind === 'title' ? 14 : 10, bold: line.kind !== undefined,
      color: { argb: line.kind ? 'FF1F3A5F' : 'FF000000' },
    };
  });

  const rows = tableSheet<ReportRow>(wb, 'Распределение', [
    { header: '№', width: 5, value: (r) => r.n },
    { header: 'ФИО', width: 28, wrap: true, value: (r) => r.fio },
    { header: 'Телефон', width: 17, value: (r) => r.phone },
    { header: 'Возраст', width: 11, value: (r) => r.age },
    { header: 'Район / метро (как написал человек)', width: 30, wrap: true, value: (r) => r.place },
    { header: 'Удобное время (из анкеты бота)', width: 24, wrap: true, value: (r) => r.schedule },
    { header: 'Адрес (из анкеты бота)', width: 24, wrap: true, value: (r) => r.address },
    { header: 'Статус заявки', width: 13, value: (r) => r.status },
    { header: 'Дата заявки', width: 12, value: (r) => asDate(r.date) },
    { header: 'Ответственный', width: 18, value: (r) => r.responsible },
    { header: 'Рекомендована в таблице раньше', width: 22, wrap: true, value: (r) => r.recommended },
    { header: 'Назначенная группа (ведущий)', width: 28, wrap: true, value: (r) => r.group },
    { header: 'Район и метро группы', width: 28, wrap: true, value: (r) => r.groupWhere },
    { header: 'Тип группы', width: 13, value: (r) => r.kind },
    { header: 'Очки', width: 7, value: (r) => r.score },
    { header: 'Совпадение по месту', width: 14, value: (r) => r.geo },
    { header: 'Принцип распределения (комментарий)', width: 62, wrap: true, value: (r) => r.principle },
    { header: 'Альтернативные группы', width: 70, wrap: true, value: (r) => r.alternatives },
    { header: 'Нужна проверка', width: 10, value: (r) => r.check },
    { header: 'Примечание из заявки', width: 45, wrap: true, value: (r) => r.note },
  ], report.rows);
  rows.getColumn(9).numFmt = 'DD.MM.YYYY';
  rows.eachRow({ includeEmpty: false }, (row, n) => {
    if (n === 1) return;
    if (row.getCell(12).value === '') row.eachCell({ includeEmpty: true }, (c) => { c.fill = BAD_FILL; });
    else if (row.getCell(19).value === 'да') { row.getCell(19).fill = WARN_FILL; row.getCell(16).fill = WARN_FILL; }
  });

  const owners = tableSheet<ReportOwnerRow>(wb, 'Хотят открыть', [
    { header: 'ФИО', width: 30, wrap: true, value: (o) => o.fio },
    { header: 'Телефон', width: 17, value: (o) => o.phone },
    { header: 'Возраст', width: 11, value: (o) => o.age },
    { header: 'Где (район, метро)', width: 30, wrap: true, value: (o) => o.place },
    { header: 'Статус заявки', width: 13, value: (o) => o.status },
    { header: 'Назначено человек', width: 11, value: (o) => o.assigned },
    { header: 'Кому достались', width: 70, wrap: true, value: (o) => o.people },
  ], report.ownerRows);
  if (report.ownerRows.length === 0) {
    owners.addRow(['Открытых заявок «хочу открыть группу» нет.']);
  }

  const groups = tableSheet<ReportGroupRow>(wb, 'Группы после распределения', [
    { header: 'Ведущий', width: 30, wrap: true, value: (g) => g.leader },
    { header: '№ в реестре', width: 10, value: (g) => g.no ?? '' },
    { header: 'Район', width: 20, value: (g) => g.district },
    { header: 'Метро', width: 30, wrap: true, value: (g) => g.metro },
    { header: 'Статус', width: 15, value: (g) => g.status },
    { header: 'Приём новых', width: 14, value: (g) => g.open },
    { header: 'Возраст группы', width: 11, value: (g) => g.age },
    { header: 'Координатор', width: 20, value: (g) => g.coordinator },
    { header: 'Участников было', width: 11, value: (g) => g.before ?? '' },
    { header: 'Назначено сейчас', width: 11, value: (g) => g.added },
    { header: 'Участников станет', width: 11, value: (g) => g.after },
    { header: 'В подборе', width: 10, value: (g) => g.inPool },
    { header: 'Почему не в подборе', width: 20, value: (g) => g.why },
    { header: 'Комментарий', width: 50, wrap: true, value: (g) => g.comment },
  ], report.groupRows);
  groups.eachRow((row, n) => {
    if (n === 1) return;
    if (row.getCell(12).value === 'нет') row.eachCell({ includeEmpty: true }, (c) => { c.font = { name: 'Arial', size: 10, color: { argb: 'FF7F7F7F' } }; });
    const added = row.getCell(10).value;
    if (typeof added === 'number' && added >= 5) row.getCell(10).fill = WARN_FILL;
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
