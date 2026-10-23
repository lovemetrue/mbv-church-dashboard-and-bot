import type { GroupDraftView } from '@contracts';
import { ApiError } from '../shared/api/client';
import { buildRequests } from './build';
import { buildOthers } from './others';

/** Черновик «Создать группу по заявке» в демо: проще серверного, но поля те же — ведущий, телефон, район, возраст. */
export function demoGroupDraft(requestId: number): GroupDraftView {
  const join = buildRequests().items.find((r) => r.id === requestId);
  const other = join ? undefined : buildOthers().find((o) => o.id === requestId);
  const item = join ?? other;
  if (!item) throw new ApiError(404, 'Заявка не найдена.', 'not_found');
  const district = join?.district ?? null;
  return {
    requestId,
    fio: item.fio,
    ownGroup: join ? join.ownGroup : other!.ownGroup,
    fields: {
      leader: item.fio,
      status: 'Потенциальная',
      format: 'Основная церковь',
      comment: [`Заведена по заявке №${requestId}`, item.place ? `Место: ${item.place}` : null].filter(Boolean).join('. ') + '.',
      ...(item.phone ? { phone: item.phone } : {}),
      ...(district ? { district } : {}),
      ...(item.ageLabel ? { age: item.ageLabel } : {}),
    },
  };
}
