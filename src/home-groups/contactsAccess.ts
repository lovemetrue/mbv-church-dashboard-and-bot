import type {
  FormMeta, GroupDraftView, GroupItem, GroupMember, GroupsView, KitPerson, OtherItem, PeopleView, PersonItem, RequestItem, RequestsView, Role,
  TeamRoleKind,
} from './contracts.js';

/**
 * Кто какие контакты видит. Правило Давида: персональные данные видит тот, кто взял человека или группу на себя.
 *
 * • Полный вход, лидеры (катализатор, старший координатор) и старший распределитель видят всё. Общий обычный вход
 *   без человека (`mbv_admin`) пока тоже — его отключат, оставив только личные входы.
 * • Остальные личные входы (координатор, распределитель): у заявки, которая «в работе у» них, — всё; у ничьей или
 *   чужой — ФИО, район и последние цифры телефона (улицы, хобби, профессии нет). Адрес группы и телефоны ведущего и
 *   соведущего видны всем (по адресу подбор, по номеру ведущего договариваются); телефоны состава — координатору этой
 *   группы и распределителю, который утвердил в неё человека. Человек из «Людей» — открыт, если он из своей заявки или
 *   из состава своей группы; у ведущего некамерной группы телефон виден всем, как в справочнике групп.
 * • Камерная группа: адрес и телефоны — только лидерам, её координатору и полному входу (отдельное правило выше всех).
 *
 * Снимок представлений один на всех и кэшируется, поэтому скрытие — здесь, на выходе, по вошедшему: иначе первый
 * вошедший решал бы, что увидят остальные. Чат помощника отвечает по всей базе — так решили, пока не трогаем.
 */

/** Кто смотрит: роль входа и, при личном входе, человек из справочника команды. */
export interface Viewer {
  role: Role;
  person: { name: string; teamKinds: readonly TeamRoleKind[] } | null;
}

/** Лидеры: им видны контакты всех камерных групп. Решает смысл роли из справочника, а не её название. */
const LEADER_KINDS: ReadonlySet<TeamRoleKind> = new Set(['catalyst', 'senior']);
/** Видят все контакты, кроме камерных групп: лидеры и старший распределитель (он смотрит за всеми заявками). */
const ALL_CONTACTS_KINDS: ReadonlySet<TeamRoleKind> = new Set(['catalyst', 'senior', 'senior_distributor']);

const sameName = (a: string | null | undefined, b: string | null | undefined): boolean =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** Имя вошедшего, если его контакты ограничены; null — видит всё (кроме камерных групп, см. `seesChamberContacts`). */
function restrictedName(viewer: Viewer): string | null {
  if (viewer.role === 'super' || viewer.person === null) return null;
  if (viewer.person.teamKinds.some((k) => ALL_CONTACTS_KINDS.has(k))) return null;
  return viewer.person.name;
}

/**
 * Последние четыре цифры: по ним человека узнают при звонке и отличают тёзок, а позвонить нельзя. Ссылка «позвонить»
 * по такой строке не строится (в ней меньше семи цифр).
 */
export function maskPhone(phone: string | null): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits.length >= 4 ? `… ${digits.slice(-4, -2)}-${digits.slice(-2)}` : null;
}

/** Видит ли вошедший адрес и телефоны камерной группы: полный и общий вход, лидеры и её координатор. */
export function seesChamberContacts(viewer: Viewer, coordinator: string | null): boolean {
  if (viewer.role === 'super' || viewer.person === null) return true;
  if (viewer.person.teamKinds.some((k) => LEADER_KINDS.has(k))) return true;
  return sameName(viewer.person.name, coordinator);
}

// ── заявки ─────────────────────────────────────────────────────────────────

const HIDDEN_ORIGINAL = new Set(['Улица и дом']);
const maskOriginal = (rows: RequestItem['original']): RequestItem['original'] =>
  rows.filter((f) => !HIDDEN_ORIGINAL.has(f.label)).map((f) => (f.label === 'Телефон' ? { ...f, value: maskPhone(f.value) ?? '' } : f))
    .filter((f) => f.value !== '');

function maskRequest(r: RequestItem): RequestItem {
  return {
    ...r,
    phone: maskPhone(r.phone),
    street: null,
    streetInfo: { ...r.streetInfo, text: null },
    streetGeo: null,
    hobby: null,
    profession: null,
    family: null,
    original: maskOriginal(r.original),
    contactsHidden: true,
  };
}

function maskOther(o: OtherItem): OtherItem {
  return { ...o, phone: maskPhone(o.phone), address: null, hobby: null, profession: null, family: null, original: maskOriginal(o.original), contactsHidden: true };
}

/** Заявки и обращения для вошедшего: чужие и ничьи — без контактов. */
export function requestsFor(view: RequestsView, viewer: Viewer): RequestsView {
  const name = restrictedName(viewer);
  if (name === null) return view;
  return {
    ...view,
    items: view.items.map((r) => (sameName(r.responsible, name) ? r : maskRequest(r))),
    others: view.others.map((o) => (sameName(o.responsible, name) ? o : maskOther(o))),
  };
}

// ── группы ─────────────────────────────────────────────────────────────────

/** Группы, контакты которых вошедшему открыты: его группы как координатора и те, куда он утвердил человека. */
function ownGroupIds(groups: GroupsView, requests: RequestsView, name: string): Set<number> {
  const ids = new Set<number>();
  for (const g of groups.items) if (sameName(g.coordinator, name)) ids.add(g.id);
  for (const r of requests.items) if (r.finalGroup && sameName(r.responsible, name)) ids.add(r.finalGroup.id);
  // «Хочу открыть группу», взятое себе: потенциальная группа по нему — тоже его.
  for (const o of requests.others) {
    if (!sameName(o.responsible, name)) continue;
    if (o.ownGroup) ids.add(o.ownGroup.id);
  }
  return ids;
}

const maskMember = (m: GroupMember): GroupMember => ({ ...m, phone: maskPhone(m.phone) });

/** Камерная группа без адреса и телефонов. Имя ведущего остаётся. */
function withoutChamberContacts(g: GroupItem): GroupItem {
  return {
    ...g,
    phone: null,
    coLeaderPhone: null,
    address: null,
    addressGeo: null,
    coords: null,
    leaderAnswer: g.leaderAnswer ? { ...g.leaderAnswer, address: null } : null,
    members: g.members.map(maskMember),
    contactsHidden: true,
  };
}

/**
 * Обычная чужая группа: адрес и телефоны ведущего и соведущего видны (по адресу подбор, по номеру ведущего договариваются
 * о человеке — так решили), телефоны состава — последние цифры.
 */
function withMaskedPhones(g: GroupItem): GroupItem {
  return { ...g, members: g.members.map(maskMember), contactsHidden: true };
}

/** Список групп для вошедшего. */
export function groupsFor(view: GroupsView, viewer: Viewer, requests: RequestsView): GroupsView {
  const name = restrictedName(viewer);
  const own = name !== null ? ownGroupIds(view, requests, name) : null;
  if (name === null && !view.items.some((g) => g.chamber)) return view;
  return {
    ...view,
    items: view.items.map((g) => {
      if (g.chamber && !seesChamberContacts(viewer, g.coordinator)) return withoutChamberContacts(g);
      if (name === null || own?.has(g.id)) return g;
      return withMaskedPhones(g);
    }),
  };
}

// ── люди ───────────────────────────────────────────────────────────────────

function maskPerson(p: PersonItem, keepPhone = false): PersonItem {
  return { ...p, phone: keepPhone ? p.phone : maskPhone(p.phone), address: null, addressGeo: null, hobby: null, profession: null, family: null, contactsHidden: true };
}

/** Справочник людей: открыты люди из своих заявок и из состава своих групп (как координатора). */
export function peopleFor(view: PeopleView, viewer: Viewer, groups: GroupsView, requests: RequestsView): PeopleView {
  const name = restrictedName(viewer);
  if (name === null) return view;
  const ownRequests = new Set([...requests.items, ...requests.others].filter((r) => sameName(r.responsible, name)).map((r) => r.id));
  const ownGroupCodes = new Set(groups.items.filter((g) => sameName(g.coordinator, name)).map((g) => g.code));
  // Номер ведущего виден всем, как в справочнике групп (`withMaskedPhones`): это тот же номер из той же карточки. Кроме
  // камерных групп — там телефоны ведущих скрыты и в «Людях».
  const openLeaderGroups = new Set(groups.items.filter((g) => !g.chamber || seesChamberContacts(viewer, g.coordinator)).map((g) => g.id));
  return {
    ...view,
    items: view.items.map((p) =>
      (p.requestId !== null && ownRequests.has(p.requestId)) || p.groups.some((c) => ownGroupCodes.has(c))
        ? p
        // Участник команды — тоже: его номер виден в «Координаторах» всем, кто вошёл, это один и тот же номер.
        : maskPerson(p, p.team != null || (p.leads ?? []).some((l) => openLeaderGroups.has(l.groupId)))),
  };
}

// ── прочее: черновик группы по заявке, списки форм, наборы ────────────────────

/** Черновик группы по заявке: телефон человека — только если заявка его. */
export function draftFor(draft: GroupDraftView, viewer: Viewer, requests: RequestsView): GroupDraftView {
  const name = restrictedName(viewer);
  if (name === null || !draft.fields['phone']) return draft;
  const mine = [...requests.items, ...requests.others].some((r) => r.id === draft.requestId && sameName(r.responsible, name));
  if (mine) return draft;
  const { phone: _hidden, ...fields } = draft.fields;
  return { ...draft, fields };
}

/** Найденный на «Наборах» участник: при ограниченном входе — последние цифры телефона, чтобы отличить тёзок. */
export function kitPersonFor(person: KitPerson, viewer: Viewer): KitPerson {
  return restrictedName(viewer) === null ? person : { ...person, phone: maskPhone(person.phone) };
}
