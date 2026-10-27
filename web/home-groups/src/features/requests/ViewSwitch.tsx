import { Chip } from '../../shared/ui';
import { ru } from '../../shared/i18n/ru';
import type { OtherItem, RequestItem } from '@contracts';
import { OTHER_VIEWS, viewOf, type OtherView, type RequestsView } from '../../entities/others';
import { useAppNav } from '../../shared/nav';
import { searchRequests } from './model';
import { matchesOtherSearch } from './others/model';
import styles from './Requests.module.css';

const LABEL: Record<OtherView, (n: number) => string> = {
  leads: ru.requests.view.leads,
  homes: ru.requests.view.homes,
  questions: ru.requests.view.questions,
  members: ru.requests.view.members,
  leaders: ru.requests.view.leaders,
  cancelled: ru.requests.view.cancelled,
};

/**
 * Переключатель «Хотят в группу | Хотят открыть группу (N) | Дают дом (N) | Вопросы (N) | …»: по вкладке на каждый вид
 * обращения. Это не вкладка верхнего уровня, а режим списка внутри «Заявок». N — сколько обращений открыто (поиск и
 * отбор его не меняют), чтобы число подсказывало, есть ли там работа, ещё до перехода. У аннулированных заявок открытых
 * не бывает: там N — сколько их всего, и вкладки нет, пока их нет.
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
  /** Все обращения из ответа сервера: числа считаются здесь, по вкладкам. */
  others: readonly OtherItem[];
  onChange: (v: RequestsView) => void;
}) {
  const search = useAppNav().search;
  const count = (v: OtherView, list: readonly OtherItem[]) => list.filter((o) => viewOf(o) === v).length;
  const open = others.filter((o) => o.state === 'open');
  const hit = search.trim() ? others.filter((o) => matchesOtherSearch(o, search)) : null;
  const tail = (n: number) => ` · ${ru.requests.view.found(n)}`;
  const shown = OTHER_VIEWS.filter((v) => v !== 'cancelled' || view === 'cancelled' || count(v, others) > 0);
  return (
    <div className={styles.views} role="group" aria-label={ru.requests.view.label}>
      <Chip shape="block" pressed={view === 'wait'} onClick={() => onChange('wait')}>
        {ru.requests.view.wait}
        {hit && tail(searchRequests(items, search).length)}
      </Chip>
      {shown.map((v) => (
        <Chip key={v} shape="block" pressed={view === v} onClick={() => onChange(v)}>
          {LABEL[v](count(v, v === 'cancelled' ? others : open))}
          {hit && tail(count(v, hit))}
        </Chip>
      ))}
    </div>
  );
}
