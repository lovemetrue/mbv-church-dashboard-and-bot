import { Chip } from '../../shared/ui';
import { ru } from '../../shared/i18n/ru';
import type { OtherItem } from '@contracts';
import { isLead, type RequestsView } from '../../entities/others';
import styles from './Requests.module.css';

/**
 * Переключатель «Хотят в группу | Хотят открыть группу (N) | Другие обращения (N)». Это не вкладка, а режим списка внутри «Заявок»:
 * верхние вкладки остаются прежними. N — сколько обращений открыто всего (поиск и отбор его не меняют),
 * чтобы число подсказывало, есть ли там работа, ещё до перехода.
 */
export function ViewSwitch({
  view,
  others,
  onChange,
}: {
  view: RequestsView;
  /** Все обращения из ответа сервера: числа открытых считаются здесь, отдельно для «открыть группу» и остальных. */
  others: readonly OtherItem[];
  onChange: (v: RequestsView) => void;
}) {
  const openLeads = others.filter((o) => o.state === 'open' && isLead(o)).length;
  const openOthers = others.filter((o) => o.state === 'open' && !isLead(o)).length;
  return (
    <div className={styles.views} role="group" aria-label={ru.requests.view.label}>
      <Chip shape="block" pressed={view === 'wait'} onClick={() => onChange('wait')}>
        {ru.requests.view.wait}
      </Chip>
      <Chip shape="block" pressed={view === 'leads'} onClick={() => onChange('leads')}>
        {ru.requests.view.leads(openLeads)}
      </Chip>
      <Chip shape="block" pressed={view === 'others'} onClick={() => onChange('others')}>
        {ru.requests.view.others(openOthers)}
      </Chip>
    </div>
  );
}
