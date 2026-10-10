import { DISTRICTS } from './groups.js';
import {
  hardFailure,
  matchesDistrict,
  matchesMetro,
  suggestGroups,
  type MatchGroup,
  type MatchOptions,
  type MatchPerson,
  type Suggestion,
} from './matching.js';

/**
 * Разовое распределение желающих по группам по тем же правилам, что и подбор в дашборде
 * (см. matching.ts), но для целого списка людей сразу.
 *
 * Люди идут по очереди, и после каждого назначения у группы становится на одного участника
 * больше. Так срабатывает очко «меньше участников, чем у соседей»: иначе все желающие одного
 * района легли бы в одну и ту же группу.
 *
 * Те, кто хочет открыть группу, — это будущие новые группы: они идут первыми (правило «новые
 * группы в первую очередь»), у них 0 участников, а район и метро берутся из того, что
 * владелец написал о месте. Человеку такая группа предлагается, только если совпал район или
 * метро: у будущей группы нет ни возраста, ни числа участников, и без этого условия «новые
 * первыми» отправило бы всех желающих к первому же владельцу в любом конце города.
 */

export interface Seeker extends MatchPerson {
  id: number | string;
}

/** Человек, который хочет открыть группу. Без места группу ему не назначить: неизвестно, где она будет. */
export interface Owner {
  id: string;
  name: string;
  place: string | null;
  age: string | null;
}

export interface Assignment {
  seekerId: number | string;
  /** Группа реестра (положительный id) или будущая группа владельца (отрицательный); null — не нашлось. */
  groupId: number | null;
  ownerId: string | null;
  score: number;
  fresh: boolean;
  sameDistrict: boolean;
  sameMetro: boolean;
  /** Назначено без совпадения по месту: человеку стоит позвонить и уточнить. */
  needsCheck: boolean;
  /** По какому принципу распределён: очки и причины словами. */
  principle: string;
  alternatives: Suggestion[];
}

export interface Distribution {
  assignments: Assignment[];
  /** Сколько участников было у группы реестра и сколько добавило это распределение. */
  load: Map<number, { before: number | null; added: number }>;
  /** Сколько людей назначено каждому владельцу. */
  ownerLoad: Map<string, number>;
}

const ALTERNATIVES = 3;

/** Метро и ориентиры владельца: всё, что он написал о месте, кроме названия района. */
function ownerMetro(place: string): string | null {
  const parts = place
    .split(/[,;/]/)
    .map((p) => p.trim())
    .filter((p) => p && !DISTRICTS.some((d) => matchesDistrict(p, d)));
  return parts.length > 0 ? parts.join(', ') : null;
}

const ownerDistrict = (place: string): string => DISTRICTS.find((d) => matchesDistrict(place, d)) ?? 'Не указан';

/** Почему никому из реестра человек не подошёл: на каком условии сколько групп отсеялось. */
export function explainNoMatch(person: MatchPerson, groups: readonly MatchGroup[]): string {
  const count = { status: 0, closed: 0, hidden: 0, age: 0 };
  for (const g of groups) {
    const failure = hardFailure(person, g);
    if (failure) count[failure] += 1;
  }
  return (
    `из ${groups.length} групп не действуют: ${count.status}; приём новых закрыт: ${count.closed}; ` +
    `отмечены «Не направлять»: ${count.hidden}; не подходят по возрасту: ${count.age}.`
  );
}

function principleOf(person: MatchPerson, best: Suggestion, isOwner: boolean): string {
  const tier = best.fresh
    ? `Выбрана новая группа${isOwner ? ' (будущая группа владельца)' : ''}: новые идут первыми.`
    : 'Выбрана действующая группа: подходящих новых меньше трёх.';
  const why = best.reasons.length > 0 ? ` ${best.reasons.join('; ')}.` : '';
  const text = `${tier} Очки: ${best.score}.${why}`;

  if (!person.place?.trim()) {
    return `${text} Внимание: человек не указал район и метро — назначено по возрасту и остальным условиям, нужна проверка.`;
  }
  if (!best.sameDistrict && !best.sameMetro) {
    return `${text} Внимание: нет совпадения по району и метро — назначено по возрасту и остальным условиям, нужна проверка.`;
  }
  return text;
}

export function distribute(
  seekers: readonly Seeker[],
  groups: readonly MatchGroup[],
  owners: readonly Owner[],
  opts: MatchOptions,
): Distribution {
  // Будущие группы владельцев получают отрицательные id, чтобы не пересечься с реестром.
  const ownerByGroupId = new Map<number, Owner>();
  const prospective: MatchGroup[] = [];
  owners.forEach((owner, index) => {
    if (!owner.place?.trim()) return;
    const id = -(index + 1);
    ownerByGroupId.set(id, owner);
    prospective.push({
      id,
      status: 'Кампания',
      open_to_new: 'ДА',
      age: null,
      district: ownerDistrict(owner.place),
      metro: ownerMetro(owner.place),
      people: 0,
      do_not_refer: false,
    });
  });

  const current = new Map<number, MatchGroup>([...prospective, ...groups].map((g) => [g.id, { ...g }]));
  const load = new Map<number, { before: number | null; added: number }>(
    groups.map((g) => [g.id, { before: g.people, added: 0 }]),
  );
  const ownerLoad = new Map<string, number>([...ownerByGroupId.values()].map((o) => [o.id, 0]));
  const assignments: Assignment[] = [];

  for (const seeker of seekers) {
    // Будущие группы владельцев — только те, что рядом с этим человеком.
    const candidates = [...current.values()].filter(
      (g) => !ownerByGroupId.has(g.id) || matchesDistrict(seeker.place, g.district) || matchesMetro(seeker.place, g.metro),
    );
    const found = suggestGroups(seeker, candidates, opts);
    const best = found[0];

    if (!best) {
      assignments.push({
        seekerId: seeker.id, groupId: null, ownerId: null, score: 0, fresh: false,
        sameDistrict: false, sameMetro: false, needsCheck: true,
        principle: `Подходящей группы нет: ${explainNoMatch(seeker, [...current.values()])}`,
        alternatives: [],
      });
      continue;
    }

    const target = current.get(best.groupId)!;
    // Участник добавился: следующему человеку эта группа уже не «маленькая».
    if (target.people !== null) target.people += 1;
    const owner = ownerByGroupId.get(best.groupId) ?? null;
    if (owner) ownerLoad.set(owner.id, (ownerLoad.get(owner.id) ?? 0) + 1);
    else load.get(best.groupId)!.added += 1;

    assignments.push({
      seekerId: seeker.id,
      groupId: best.groupId,
      ownerId: owner?.id ?? null,
      score: best.score,
      fresh: best.fresh,
      sameDistrict: best.sameDistrict,
      sameMetro: best.sameMetro,
      needsCheck: !best.sameDistrict && !best.sameMetro,
      principle: principleOf(seeker, best, owner !== null),
      alternatives: found.slice(1, 1 + ALTERNATIVES),
    });
  }

  return { assignments, load, ownerLoad };
}
