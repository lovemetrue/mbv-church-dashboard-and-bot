/**
 * Права служителя. Только числовые id.
 *
 * Username в списке был удобнее, но создавал ловушку: проверка прав по нему работала,
 * а уведомления молча не доходили — Bot API не умеет писать в личку по username,
 * только по числовому id. Поэтому такой формат больше не поддерживается,
 * а мусор в списке видно в логе при старте (см. splitAdminIds).
 *
 * Свой id человек узнаёт командой /whoami в боте.
 */
export function isAdmin(admins: string[], userId: string): boolean {
  return admins.includes(userId);
}

/** Делит список на годные id и всё остальное, чтобы про остальное сказать вслух. */
export function splitAdminIds(entries: string[]): { ids: string[]; invalid: string[] } {
  const ids: string[] = [];
  const invalid: string[] = [];

  for (const entry of entries) {
    const value = entry.trim();
    if (!value) continue;
    if (/^\d+$/.test(value)) ids.push(value);
    else invalid.push(value);
  }

  return { ids, invalid };
}
