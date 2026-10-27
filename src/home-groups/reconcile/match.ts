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
  /** Телефоны ведущего как записаны: в одной ячейке бывает несколько номеров и приписки. */
  phones: readonly string[];
  /** Телефоны соведущего: совпадение по ним делает человека соведущим, а не ведущим группы. */
  coLeaderPhones?: readonly string[];
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

/**
 * Слова имени: нижний регистр, «ё»→«е», «й»→«и», без знаков; союзы выброшены. Инициалы («П.») остаются однобуквенными словами.
 * «и» между супругами — союз (строчная и без точки), а «И.» или «И» заглавной — инициал («Петров И.»): их различаем по написанию.
 */
export function nameTokens(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const m of raw.matchAll(/(\p{L}+)(\.?)/gu)) {
    const word = m[1]!;
    const lower = word.toLowerCase();
    if (STOP.has(lower) && word === lower && m[2] === '') continue;
    out.push(lower.replaceAll('ё', 'е').replaceAll('й', 'и'));
  }
  return out;
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

/**
 * Слово похоже на фамилию: окончание -ов/-ев/-ин/-ын/-ский/-цкий/-ых/-ко/-ук/-юк/-як/-дзе (после замены «й»→«и»), от пяти букв.
 * Нужно, чтобы вероятное совпадение шло по фамилии, а не по распространённому имени: иначе «Мария Петрова» цеплялась бы за
 * каждого ведущего Марию. Мужские имена на -ин («Константин», «Валентин») фамилиями не считаем.
 */
const SURNAME_END = /(ов|ова|ев|ева|ин|ина|ын|ына|ски|ска|цки|цка|ых|их|ко|ук|юк|як|дзе)$/;
const FIRST_NAMES_LIKE_SURNAMES = new Set([
  'константин', 'валентин', 'мартин', 'марина', 'ирина', 'алина', 'полина', 'карина', 'арина', 'дарина', 'кристина', 'альбина',
  'регина', 'ангелина', 'валентина', 'екатерина', 'катерина', 'алевтина', 'эвелина', 'виталина', 'снежана', 'любовь',
]);
export const looksLikeSurname = (t: string): boolean => t.length >= 5 && SURNAME_END.test(t) && !FIRST_NAMES_LIKE_SURNAMES.has(t);

/** Слова длиной от семи букв, отличающиеся одной буквой (опечатка, пропуск, лишняя): «Ишмуратова»/«Измуратова». */
export function closeToken(a: string, b: string): boolean {
  if (Math.min(a.length, b.length) < 7 || Math.abs(a.length - b.length) > 1) return false;
  if (a === b) return true;
  const [long, short] = a.length >= b.length ? [a, b] : [b, a];
  let i = 0;
  while (i < short.length && long[i] === short[i]) i += 1;
  if (long.length === short.length) return long.slice(i + 1) === short.slice(i + 1);
  return long.slice(i + 1) === short.slice(i);
}

function matchName(subject: readonly string[], leader: readonly string[]): Tier | null {
  const full = subject.filter((t) => t.length > 1);
  const initials = subject.filter((t) => t.length === 1);
  const leaderFull = leader.filter((t) => t.length > 1);
  const leaderInitials = leader.filter((t) => t.length === 1);
  // Все слова человека нашлись у ведущего.
  if (full.length >= 2 && full.every((t) => hasToken(leader, t))) return 'exact';
  // Ведущий в справочнике записан с инициалом («Ишмуратова Л.»): фамилия совпала, а имя человека начинается на этот инициал.
  if (full.length >= 2 && leaderInitials.length > 0) {
    const named = full.filter((t) => t.length >= 4 && hasToken(leaderFull, t));
    const rest = full.filter((t) => !named.includes(t));
    if (named.length >= 1 && rest.every((t) => leaderInitials.includes(t[0]!))) return 'exact';
  }
  if (full.length === 1 && full[0]!.length >= 4 && hasToken(leader, full[0]!) && initials.length > 0) {
    // «Малявин П.»: фамилия нашлась, а инициал должен подойти к другому слову ведущего.
    const rest = leader.filter((t) => !sameToken(t, full[0]!));
    if (rest.some((t) => initials.some((i) => t.startsWith(i)))) return 'likely';
  }
  // Вероятное: совпала фамилия (в том числе с опечаткой), а имена не противоречат. Так находятся «Коновалов и Маруфов» (ведущим
  // записан один из супругов), одна фамилия без имени и «Измуратова Лилия» вместо «Ишмуратова Лилия». Однофамильцы с другим
  // именем («Малявин Павел» и «Малявин Андрей») не подходят: у обоих осталось по неподошедшему имени. Человек подтверждает
  // вероятное сам: сверху предложено, но не записано.
  const near = (a: string, b: string): boolean => sameToken(a, b) || closeToken(a, b);
  // Если человек назвал инициал, решает правило выше: «Малявин П.» не подходит «Малявину Андрею».
  const hit = initials.length === 0 && full.some((t) => looksLikeSurname(t) && leaderFull.some((l) => near(l, t)));
  if (hit) {
    const spareMine = full.filter((t) => !leaderFull.some((l) => near(l, t)));
    const spareTheirs = leaderFull.filter((l) => !full.some((t) => near(l, t)));
    // Ведущий записан с инициалом, который не подошёл к имени человека («Ишмуратова Л.» и «Ишмуратова Анна»): это другой человек.
    const contradicted = leaderInitials.length > 0 && spareMine.some((t) => !looksLikeSurname(t));
    if (!contradicted && (spareMine.every(looksLikeSurname) || spareTheirs.every(looksLikeSurname))) return 'likely';
  }
  return null;
}

const PATRONYMIC = /(вич|вна|ична|ич)$/;

/**
 * Имя человека — имя ведущего: каждое его слово есть у ведущего (или соведущего). Отчество, которого в справочнике нет,
 * не мешает: таблица его часто не записывала. Без имени — не противоречит. Инициал («П.») годится, если открывает слово.
 */
function sameName(mine: readonly string[], theirs: readonly string[]): boolean {
  const near = (t: string): boolean => theirs.some((l) => sameToken(t, l) || closeToken(t, l));
  const theirPatronymic = theirs.some((l) => l.length >= 6 && PATRONYMIC.test(l));
  const words = mine.filter((t) => !(t.length >= 6 && PATRONYMIC.test(t) && !theirPatronymic));
  return words.every((t) => (t.length > 1 ? near(t) : theirs.some((l) => l.startsWith(t))));
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
      // Номер ведущего проверяем раньше номера соведущего: у супругов он бывает записан в обеих ячейках.
      const role = [...phoneKeys(g.phones)].some((k) => myPhones.has(k)) ? 'leader'
        : [...phoneKeys(g.coLeaderPhones ?? [])].some((k) => myPhones.has(k)) ? 'coLeader' : null;
      if (role) {
        // Номер один у всей семьи. Тот же человек (те же имя и фамилия) — «точно» на совпавшее место. Семья (та же
        // фамилия, другое имя: «Олейник Анастасия» с общим номером группы «Олейник Иаков») — группа та же, «точно», но
        // это не ведущий: она встаёт соведущей, если место соведущего пустое или там она сама. Иначе, и для чужой
        // фамилии («Бутарев Владимир» с номером группы «Новиковы Тамара и Владимир»), — «похоже», решает человек.
        const leaderName = role === 'leader' ? leaderTokens : nameTokens(g.coLeader);
        const coTokens = nameTokens(g.coLeader);
        const theirs = [...leaderTokens, ...coTokens];
        const mySurnames = mine.filter(looksLikeSurname);
        // Инициалы («П. М.») тоже имя: годится, если хоть одна буква открывает слово ведущего.
        const sameFamily = mySurnames.length > 0
          ? mySurnames.some((t) => theirs.some((l) => sameToken(t, l) || closeToken(t, l)))
          : mine.some((t) => (t.length > 1 ? theirs.some((l) => sameToken(t, l)) : theirs.some((l) => l.startsWith(t))));
        if (sameName(mine, leaderName)) offer({ groupId: g.id, tier: 'exact', by: 'phone', role });
        else if (role === 'leader' && coTokens.length > 0 && sameName(mine, coTokens)) offer({ groupId: g.id, tier: 'exact', by: 'phone', role: 'coLeader' });
        else if (sameFamily && role === 'leader' && coTokens.length === 0) offer({ groupId: g.id, tier: 'exact', by: 'phone', role: 'coLeader' });
        else offer({ groupId: g.id, tier: 'likely', by: 'phone', role });
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
