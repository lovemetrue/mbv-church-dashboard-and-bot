import { createHash } from 'node:crypto';
import type { PlanRequest } from './types.js';

/**
 * Отпечаток данных заявки, от которых зависит подбор: район, возраст, дни, время суток и улица.
 * Закреплённое предложение хранит его: изменился отпечаток — данные новые, группу надо пересчитать.
 * Имя, телефон и прочее на подбор не влияют и в отпечаток не входят.
 */
export function inputSignature(r: Pick<PlanRequest, 'district' | 'ageRange' | 'days' | 'slot' | 'street'>): string {
  const canonical = JSON.stringify([r.district, r.ageRange, [...r.days].sort(), r.slot, (r.street ?? '').trim().toLowerCase() || null]);
  return createHash('sha1').update(canonical).digest('hex').slice(0, 16);
}
