import { parseRegistrationForm } from '../dashboard/forms.js';
import { mdgRequestType } from '../core/fsm.js';
import { qrPng } from '../core/qr.js';
import type { AuditRepo } from '../db/repos/audit.repo.js';
import type { RequestsRepo, RequestWithUser } from '../db/repos/requests.repo.js';
import type { UsersRepo } from '../db/repos/users.repo.js';
import type { RegistrationCardInfo } from '../dashboard/registrationCard.js';
import type { ActionError, CreateRegistrationOk } from './contracts.js';
import { fieldsToForm } from './create.js';

export type RegistrationOutcome =
  | CreateRegistrationOk
  | { ok: false; error: ActionError['error']; message: string };

/**
 * Регистрация участника служителем (для тех, кто заполнил анкету на бумаге и своего чата с ботом не имеет)
 * и то, что к ней прилагается: QR и данные для печатной карточки.
 *
 * Правила те же, что у «Участник (регистрация)» старого дашборда: форма разбирается теми же функциями,
 * а ответ про Малую группу заводит заявку (`mdgRequestType`) — иначе человек, зарегистрированный вручную,
 * пропал бы из «Заявок». Заявка помечается `origin='ui'`, а служитель получает то же уведомление, что и
 * при заявке из чата.
 */
export function createRegistrar(deps: {
  users: Pick<UsersRepo, 'createManual' | 'findById'>;
  requests: Pick<RequestsRepo, 'create'>;
  audit: Pick<AuditRepo, 'write'>;
  /** Уведомление служителю о заявке; не должно бросать (см. `notifierFromEnv`). */
  notify: (request: RequestWithUser) => Promise<void>;
}) {
  return {
    async register(body: unknown, actor: string): Promise<RegistrationOutcome> {
      const form = fieldsToForm(body);
      if (typeof form === 'string') return { ok: false, error: 'bad_request', message: form };
      const parsed = parseRegistrationForm(form);
      if (!parsed.ok) return { ok: false, error: 'bad_request', message: parsed.error };

      // Своего чата с ботом у такого участника нет: платформа условная, только чтобы удовлетворить схему.
      // В «кем зарегистрирован» — имя того, кто вошёл (личный вход) или логин общего входа.
      const created = await deps.users.createManual({ ...parsed.value, platform: 'telegram', byAdminId: actor });
      const requestType = mdgRequestType(parsed.value.mdgStatus);
      let requestId: number | null = null;
      if (requestType) {
        const request = await deps.requests.create(created.id, requestType, undefined, 'ui');
        requestId = request.id;
        await deps.notify(request);
      }
      // Без ФИО, телефона и ответов: в журнале только что произошло и с чем связано.
      await deps.audit.write(actor, 'registration.create', 'user', created.id, { registrationNo: created.registration_no, requestId });
      return { ok: true, id: created.id, registrationNo: created.registration_no! };
    },

    /** QR без диплинка: служитель сканирует его при выдаче набора — так же, как карточку из бота. */
    async qr(id: number): Promise<Buffer | null> {
      const user = await deps.users.findById(id);
      if (!user?.registration_no) return null;
      return qrPng(`Регистрация №${user.registration_no}`);
    },

    async card(id: number): Promise<RegistrationCardInfo | null> {
      const user = await deps.users.findById(id);
      if (!user?.registration_no) return null;
      return {
        registrationNo: user.registration_no,
        fullName: user.full_name,
        phone: user.phone,
        church: user.church,
        mdgStatus: user.mdg_status,
      };
    },
  };
}

export type Registrar = ReturnType<typeof createRegistrar>;
