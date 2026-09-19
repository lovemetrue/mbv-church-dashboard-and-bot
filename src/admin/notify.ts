import { b, esc, link } from '../core/html.js';
import { formatPhone } from '../core/phone.js';
import { MDG_SHORT } from '../core/texts.js';
import type { RequestWithUser } from '../db/repos/requests.repo.js';
import type { Deps } from '../deps.js';

const TYPE_LABEL: Record<RequestWithUser['type'], string> = {
  join_group: 'заявка в домашнюю группу',
  lead_group: 'готов открыть домашнюю группу',
  question: 'вопрос',
};

const PLATFORM_LABEL = { telegram: 'Telegram', max: 'MAX' } as const;

/**
 * Сообщение служителю о новой заявке. Чистая функция, чтобы формат проверялся тестом.
 * Возвращает HTML: всё, что пришло от людей, экранируется через esc().
 *
 * Номер заявки — тот же r.id, что показан в дашборде колонкой «№»: до этой правки
 * дашборд номер вообще не показывал, и служитель не мог найти «заявку №16» никак,
 * кроме поиска по имени. Ссылка ведёт сразу на неё.
 */
export function formatRequest(r: RequestWithUser, dashboardUrl: string): string {
  const nick = r.username ? ` (@${esc(r.username)})` : '';
  const lines = [
    `🔔 ${b(`Заявка №${r.id}`)} · ${esc(TYPE_LABEL[r.type])}`,
    '',
    `👤 ${b(r.full_name ?? 'без имени')}`,
    `📞 ${esc(formatPhone(r.phone)) || 'телефон не указан'}`,
    `💬 ${PLATFORM_LABEL[r.platform]}${nick}`,
  ];

  if (r.registration_no !== null) lines.push(`🎫 Регистрация №${r.registration_no}`);
  if (r.church) lines.push(`⛪️ ${esc(r.church)}`);
  if (r.mdg_status) lines.push(`👥 ${esc(MDG_SHORT[r.mdg_status])}`);

  // Район и возраст всегда отдельными строками: служителю так удобнее читать с телефона.
  lines.push(`📍 Район: ${r.location ? b(r.location) : 'не указан'}`);
  lines.push(`🎂 Возраст: ${r.age ? b(esc(r.age)) : 'не указан'}`);

  if (r.companions) lines.push(`🤝 Планирует посещать: ${esc(r.companions)}`);
  if (r.leader_name) lines.push(`🙋 Ведущий группы: ${esc(r.leader_name)}`);
  if (r.preferred_contact) lines.push(`☎️ Предпочитает: ${esc(r.preferred_contact)}`);

  if (r.text) lines.push('', `💌 ${b('Сообщение')}`, esc(r.text));
  // Переписки с участниками в боте нет: служитель звонит по телефону выше.
  // Закрывать заявку теперь в дашборде — в боте команды /close больше нет.
  lines.push('', `Свяжитесь с человеком по телефону, затем закройте заявку №${r.id} в дашборде.`);
  lines.push(link(`${dashboardUrl}?request=${r.id}`, 'Открыть заявку в дашборде'));

  return lines.join('\n');
}

/** Рассылка служебных сообщений админам на всех включённых платформах. */
export class AdminNotifier {
  constructor(private readonly deps: Deps) {}

  async notifyRequest(request: RequestWithUser): Promise<void> {
    await this.broadcast(formatRequest(request, this.deps.dashboardUrl));
  }

  async broadcast(text: string): Promise<void> {
    for (const [platformName, platform] of this.deps.platforms) {
      const ids = this.deps.admins.get(platformName) ?? [];
      const chats = await this.deps.users.chatIds(platformName, ids);
      for (const adminId of ids) {
        try {
          await platform.sendMessage(chats.get(adminId) ?? adminId, { text, format: 'html' });
        } catch (err) {
          // Недоступный админ не должен ломать обработку сообщения участника.
          this.deps.logger.warn({ platform: platformName, adminId, err }, 'не удалось уведомить админа');
        }
      }
    }
  }

  hasAdmins(): boolean {
    return [...this.deps.platforms.keys()].some((p) => (this.deps.admins.get(p) ?? []).length > 0);
  }
}
