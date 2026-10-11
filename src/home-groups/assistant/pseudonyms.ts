import type { Pool } from 'pg';

/**
 * Условные номера вместо имён. Помощник (внешняя модель) видит только их: Участник-1042, Заявитель-77, Человек-5,
 * Ведущий-3fa9c1, Координатор-b21e07 (см. migrations/029). Здесь они превращаются обратно в имена, но только в ответе,
 * который видит служитель. И наоборот: если служитель написал в вопросе имя, до модели оно доходит уже номером.
 */
export interface Pseudonyms {
  /** Номера → имена (для ответа и таблиц, которые показываются служителю). */
  toReal(text: string): string;
  /** Имена → номера (для вопроса и результатов запросов, которые уходят модели). */
  toRef(text: string): string;
}

const REF = /(?:Участник|Заявитель|Человек)-\d+|(?:Ведущий|Координатор)-[0-9a-f]{6}/g;

export function buildPseudonyms(pairs: readonly { ref: string; name: string }[]): Pseudonyms {
  const byRef = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const { ref, name } of pairs) {
    const clean = name.trim().replace(/\s+/g, ' ');
    if (clean === '') continue;
    if (!byRef.has(ref)) byRef.set(ref, clean);
    // Короткие слова (одно «Анна») без отчества и фамилии слишком часто встречаются в обычном тексте: не заменяем.
    if (clean.length >= 6 && !byName.has(clean.toLowerCase())) byName.set(clean.toLowerCase(), ref);
  }
  const names = [...byName.keys()].sort((a, b) => b.length - a.length);
  const nameRe = names.length > 0
    ? new RegExp(`(?<![\\p{L}\\p{N}-])(?:${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')).join('|')})(?![\\p{L}\\p{N}-])`, 'giu')
    : null;
  return {
    toReal: (text) => text.replace(REF, (m) => byRef.get(m) ?? m),
    toRef: (text) => (nameRe ? text.replace(nameRe, (m) => byName.get(m.trim().toLowerCase().replace(/\s+/g, ' ')) ?? m) : text),
  };
}

/**
 * Словарь «номер → имя» из самих таблиц (под правами сервиса, не роли помощника). Номера считает та же функция базы,
 * что и в представлениях (`assistant.name_ref`), поэтому они не могут разойтись.
 */
export async function loadPseudonyms(db: Pool): Promise<Pseudonyms> {
  const { rows } = await db.query<{ ref: string; name: string }>(`
    SELECT 'Участник-' || registration_no AS ref, full_name AS name FROM users WHERE registration_no IS NOT NULL AND full_name IS NOT NULL
    UNION ALL SELECT 'Человек-' || id, full_name FROM persons WHERE archived_at IS NULL
    UNION ALL SELECT coalesce('Участник-' || u.registration_no, 'Заявитель-' || r.id), r.fio
      FROM requests r LEFT JOIN users u ON u.id = r.user_id AND u.registration_no IS NOT NULL WHERE r.archived_at IS NULL AND r.fio IS NOT NULL
    UNION ALL SELECT assistant.name_ref('Ведущий', leader), leader FROM groups WHERE archived_at IS NULL
    UNION ALL SELECT assistant.name_ref('Ведущий', co_leader), co_leader FROM groups WHERE archived_at IS NULL AND co_leader IS NOT NULL
    UNION ALL SELECT assistant.name_ref('Ведущий', leader_name), leader_name FROM users WHERE leader_name IS NOT NULL
    UNION ALL SELECT assistant.name_ref('Координатор', name), name FROM coordinators WHERE archived_at IS NULL
    UNION ALL SELECT assistant.name_ref('Координатор', coordinator), coordinator FROM groups WHERE archived_at IS NULL AND coordinator IS NOT NULL
    UNION ALL SELECT assistant.name_ref('Координатор', responsible), responsible FROM requests WHERE archived_at IS NULL AND responsible IS NOT NULL`);
  return buildPseudonyms(rows.filter((r) => r.ref !== null));
}
