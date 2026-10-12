import type { DashboardRequest } from '../../db/repos/requests.repo.js';

/**
 * Суть обращения одной фразой — то, что человек сообщил. В списке «Других обращений» раньше был только вид
 * мелкой подписью, а слова самого человека лежали в «Как пришла» внизу карточки; для сотен обращений это не годилось.
 * Формулировки без указания пола.
 */
const TEXT_LIMIT = 200;

const tidy = (s: string | null | undefined): string | null => {
  const t = s?.replace(/\s+/g, ' ').trim();
  return t ? t : null;
};
const clip = (s: string): string => (s.length > TEXT_LIMIT ? `${s.slice(0, TEXT_LIMIT - 1)}…` : s);

export function gistOf(r: Pick<DashboardRequest, 'type' | 'mdg_status' | 'leader_name' | 'church' | 'text' | 'schedule' | 'manual_schedule' | 'cancel_reason'>): string {
  const church = tidy(r.church);
  const tail = church ? ` Церковь: ${church}.` : '';
  switch (r.type) {
    case 'already_member': {
      const leader = tidy(r.leader_name);
      return `Говорит, что уже состоит в Малой группе. ${leader ? `Ведущий: ${leader}.` : 'Ведущего не назвал.'}${tail}`;
    }
    case 'already_leader':
      return `Говорит, что уже ведёт Малую группу.${tail}`;
    case 'lead_group': {
      const when = tidy(r.manual_schedule) ?? tidy(r.schedule);
      const what = r.mdg_status === 'home' ? 'Может предоставить свой дом для Малой группы.' : 'Хочет открыть Малую группу.';
      return `${what}${when ? ` Удобно: ${clip(when)}.` : ''}${tail}`;
    }
    case 'question': {
      const text = tidy(r.text);
      return text ? `Вопрос служителю: «${clip(text)}»` : 'Вопрос служителю (текст не сохранился).';
    }
    default: {
      const why = tidy(r.cancel_reason);
      // Пол неизвестен: говорим о заявке, а не о человеке.
      return `Заявка в домашнюю группу аннулирована${why ? `: ${why}` : ''}.`;
    }
  }
}
