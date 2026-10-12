/**
 * Сверка человека с ведущими групп: по имени и по телефону.
 *
 * Имена приходят свободным текстом («Малявин Павел», «Павел М.», «Артёмкин Константин (и Людмила)»), поэтому
 * сравниваем не строки, а наборы слов: без регистра, без «ё» и «й», в любом порядке. Совпадение бывает двух степеней:
 * точное (все слова человека нашлись у ведущего) и вероятное (фамилия и инициал; номер ведущего при чужом имени). Точное система предлагает
 * подтвердить одной кнопкой, вероятное — только показывает: решает человек. Ошибочно записать человека в чужую группу
 * хуже, чем попросить нажать лишний раз.
 */

export interface LeaderGroup {
  id: number;
  leader: string;
  coLeader: string | null;
  /** Телефоны ведущих как записаны: в одной ячейке бывает несколько номеров и приписки. */
  phones: readonly string[];
}

export type Tier = 'exact' | 'likely';

export interface Candidate {
  groupId: number;
  tier: Tier;
  /** Чем нашли: имя точнее «случайно похожего», телефон точнее имени. */
  by: 'name' | 'phone';
  role: 'leader' | 'coLeader';
}

export interface Subject {
  name: string | null;
  phones: readonly string[];
}

/** Слова, которые ничего не говорят о человеке: союзы между супругами. */
const STOP = new Set(['и', 'с', 'а']);

/** Слова имени: нижний регистр, «ё»→«е», «й»→«и», без знаков; союзы выброшены. Инициалы («П.») остаются однобуквенными словами. */
export function nameTokens(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .toLowerCase()
    .replaceAll('ё', 'е')
    .replaceAll('й', 'и')
    .split(/[^\p{L}]+/u)
    .filter((t) => t !== '' && !STOP.has(t));
}

/**
 * Одно и то же слово в разных формах: «Панов»/«Пановы», «Малявин»/«Малявина», «Дубовицкая»/«Дубовицкий».
 * Короткие слова (до четырёх букв) сравниваются целиком, а «Марина» и «Мария» не склеиваются. Длины отличаются не больше
 * чем на букву: окончание падежа или числа — одна-две буквы, но «Иван»/«Иванов», «Пётр»/«Петров», «Олег»/«Олегович» —
 * имя и фамилия (отчество) от одного корня, то есть разные слова, и по ним человека записывали в чужую группу как «точно».
 */
export function sameToken(a: string, b: string): boolean {
  if (a === b) return true;
  const min = Math.min(a.length, b.length);
  if (min < 4 || Math.abs(a.length - b.length) > 1) return false;
  let prefix = 0;
  while (prefix < min && a[prefix] === b[prefix]) prefix += 1;
  // До семи букв короткое слово должно целиком входить в длинное (отличается только окончание); у длинных фамилий допустимо
  // отличие в последних буквах («Дубовицкая»/«Дубовицкий»).
  return prefix >= (min <= 7 ? min : min - 2);
}

/** Последние десять цифр каждого номера, найденного в тексте; короче десяти цифр — не номер. */
function phoneKeys(texts: readonly (string | null | undefined)[]): Set<string> {
  const keys = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    // Номера в одной ячейке разделены «;», запятыми и приписками с именами: разбираем кусками.
    for (const part of text.split(/[;,\n]|\s{2,}|\p{L}+/u)) {
      const digits = part.replace(/\D/g, '');
      if (digits.length >= 10) keys.add(digits.slice(-10));
    }
  }
  return keys;
}

const hasToken = (tokens: readonly string[], t: string): boolean => tokens.some((x) => sameToken(x, t));

function matchName(subject: readonly string[], leader: readonly string[]): Tier | null {
  const full = subject.filter((t) => t.length > 1);
  const initials = subject.filter((t) => t.length === 1);
  if (full.length >= 2) return full.every((t) => hasToken(leader, t)) ? 'exact' : null;
  if (full.length === 1 && full[0]!.length >= 4 && hasToken(leader, full[0]!) && initials.length > 0) {
    // «Малявин П.»: фамилия нашлась, а инициал должен подойти к другому слову ведущего.
    const rest = leader.filter((t) => !sameToken(t, full[0]!));
    return rest.some((t) => initials.some((i) => t.startsWith(i))) ? 'likely' : null;
  }
  return null;
}

/** Группы, у которых ведущий — этот человек. Точные впереди, группа в результате один раз (лучшим из совпадений). */
export function findGroups(subject: Subject, groups: readonly LeaderGroup[]): Candidate[] {
  const mine = nameTokens(subject.name);
  const myPhones = phoneKeys(subject.phones);
  const best = new Map<number, Candidate>();
  const offer = (c: Candidate): void => {
    const prev = best.get(c.groupId);
    const better = !prev || (prev.tier === 'likely' && c.tier === 'exact') || (prev.tier === c.tier && prev.by === 'name' && c.by === 'phone');
    if (better) best.set(c.groupId, c);
  };

  for (const g of groups) {
    // Имя ведущего и «второго ведущего» сверяем отдельно: в скобках у ведущего тоже бывает супруг(а).
    const leaderTokens = nameTokens(g.leader);
    if (myPhones.size > 0) {
      for (const k of phoneKeys(g.phones)) {
        if (myPhones.has(k)) {
          // Номер один у всей семьи: жена с телефоном мужа делит с ним фамилию, а чужой человек с этим номером —
          // нет. Если имя назвали и ни одного слова ведущего в нём нет, номер сам по себе не доказывает: решает человек.
          const theirs = [...leaderTokens, ...nameTokens(g.coLeader)];
          // Инициалы («П. М.») тоже имя: годится, если хоть одна буква открывает слово ведущего.
          const sameFamily = mine.length === 0 || mine.some((t) => (t.length > 1 ? theirs.some((l) => sameToken(t, l)) : theirs.some((l) => l.startsWith(t))));
          offer({ groupId: g.id, tier: sameFamily ? 'exact' : 'likely', by: 'phone', role: 'leader' });
          break;
        }
      }
    }
    const byLeader = matchName(mine, leaderTokens);
    if (byLeader) offer({ groupId: g.id, tier: byLeader, by: 'name', role: 'leader' });
    else if (g.coLeader) {
      const byCo = matchName(mine, nameTokens(g.coLeader));
      if (byCo) offer({ groupId: g.id, tier: byCo, by: 'name', role: 'coLeader' });
    }
  }
  return [...best.values()].sort((a, b) => Number(b.tier === 'exact') - Number(a.tier === 'exact') || a.groupId - b.groupId);
}

export type ReconcileStatus = 'ready' | 'choose' | 'none' | 'noleader';

export interface ReconcilePlan {
  status: ReconcileStatus;
  candidates: Candidate[];
}

/**
 * Что делать с обращением: готово (одна группа точно), выбор человека (две группы у одного ведущего или только
 * вероятное совпадение), группы нет в справочнике, ведущий вообще не указан.
 */
export function planReconcile(subject: Subject, groups: readonly LeaderGroup[]): ReconcilePlan {
  const candidates = findGroups(subject, groups);
  const exact = candidates.filter((c) => c.tier === 'exact');
  if (exact.length === 1) return { status: 'ready', candidates };
  if (candidates.length > 0) return { status: 'choose', candidates };
  const named = nameTokens(subject.name).length > 0;
  return { status: named ? 'none' : 'noleader', candidates: [] };
}
