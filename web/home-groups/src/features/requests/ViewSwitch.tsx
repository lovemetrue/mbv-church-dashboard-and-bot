import { Chip } from '../../shared/ui';
import { ru } from '../../shared/i18n/ru';
import type { OtherItem, RequestItem } from '@contracts';
import { isLead, type RequestsView } from '../../entities/others';
import { useAppNav } from '../../shared/nav';
import { searchRequests } from './model';
import { matchesOtherSearch } from './others/model';
import styles from './Requests.module.css';

/**
 * Переключатель «Хотят в группу | Хотят открыть группу (N) | Другие обращения (N)». Это не вкладка, а режим списка внутри «Заявок»:
 * верхние вкладки остаются прежними. N — сколько обращений открыто всего (поиск и отбор его не меняют),
 * чтобы число подсказывало, есть ли там работа, ещё до перехода.
 *
 * Пока в шапке что-то ищут, у каждого режима дописано, сколько там найдено (всех состояний): человек, которого ищут по
 * фамилии, часто лежит не в том режиме, что открыт, и пустой список выглядел как «поиск не работает».
 */
export function ViewSwitch({
  view,
  others,
  items,
  onChange,
}: {
  view: RequestsView;
  /** Заявки «Хотят в группу» — для числа найденного при поиске. */
  items: readonly RequestItem[];
  /** Все обращения из ответа сервера: числа открытых считаются здесь, отдельно для «открыть группу» и остальных. */
  others: readonly OtherItem[];
  onChange: (v: RequestsView) => void;
}) {
  const openLeads = others.filter((o) => o.state === 'open' && isLead(o)).length;
  const openOthers = others.filter((o) => o.state === 'open' && !isLead(o)).length;
  const search = useAppNav().search;
  const found = search.trim()
    ? (() => {
        const hit = others.filter((o) => matchesOtherSearch(o, search));
        return { wait: searchRequests(items, search).length, leads: hit.filter(isLead).length, others: hit.filter((o) => !isLead(o)).length };
      })()
    : null;
  const tail = (n: number) => (found ? ` · ${ru.requests.view.found(n)}` : '');
  return (
    <div className={styles.views} role="group" aria-label={ru.requests.view.label}>
      <Chip shape="block" pressed={view === 'wait'} onClick={() => onChange('wait')}>
        {ru.requests.view.wait}
        {found && tail(found.wait)}
      </Chip>
      <Chip shape="block" pressed={view === 'leads'} onClick={() => onChange('leads')}>
        {ru.requests.view.leads(openLeads)}
        {found && tail(found.leads)}
      </Chip>
      <Chip shape="block" pressed={view === 'others'} onClick={() => onChange('others')}>
        {ru.requests.view.others(openOthers)}
        {found && tail(found.others)}
      </Chip>
    </div>
  );
}
