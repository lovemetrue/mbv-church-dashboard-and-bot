import { Chip } from '../../shared/ui';
import { ru } from '../../shared/i18n/ru';
import type { RequestsView } from '../../entities/others';
import styles from './Requests.module.css';

/**
 * Переключатель «Хотят в группу | Другие обращения (N)». Это не вкладка, а режим списка внутри «Заявок»:
 * верхние вкладки остаются прежними. N — сколько обращений открыто всего (поиск и отбор его не меняют),
 * чтобы число подсказывало, есть ли там работа, ещё до перехода.
 */
export function ViewSwitch({
  view,
  openOthers,
  onChange,
}: {
  view: RequestsView;
  openOthers: number;
  onChange: (v: RequestsView) => void;
}) {
  return (
    <div className={styles.views} role="group" aria-label={ru.requests.view.label}>
      <Chip shape="block" pressed={view === 'wait'} onClick={() => onChange('wait')}>
        {ru.requests.view.wait}
      </Chip>
      <Chip shape="block" pressed={view === 'others'} onClick={() => onChange('others')}>
        {ru.requests.view.others(openOthers)}
      </Chip>
    </div>
  );
}
