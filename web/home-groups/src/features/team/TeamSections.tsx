import { useId } from 'react';
import type { TeamActivity, TeamView, TeamWorkload } from '@contracts';
import { FORMS, plural } from '../../entities/plural';
import { ru } from '../../shared/i18n/ru';
import { useAppNav } from '../../shared/nav';
import { TableScroll } from '../../shared/ui';
import styles from './Team.module.css';

const t = ru.team;

/**
 * Шесть плиток сверху. Подпись идёт первой в разметке (список определений), число — под ней.
 * Плитка «Других обращений открыто» ведёт в «Заявки» в режиме «Другие обращения»: остальные плитки — просто числа.
 */
export function Tiles({ totals }: { totals: TeamView['totals'] }) {
  const nav = useAppNav();
  // Сервер старой версии мог не прислать поле: показываем ноль, а не «undefined».
  const otherOpen = totals.otherOpen ?? 0;
  const tiles: { label: string; value: number; tone?: 'warn' | 'ok'; open?: { aria: string; go: () => void } }[] = [
    { label: t.tileOpen, value: totals.open },
    { label: t.tileUnassigned, value: totals.unassigned, tone: totals.unassigned > 0 ? 'warn' : undefined },
    { label: t.tileCallback, value: totals.callback },
    { label: t.tileOver7, value: totals.over7, tone: totals.over7 > 0 ? 'warn' : undefined },
    { label: t.tileApprovedWeek, value: totals.approvedWeek, tone: 'ok' },
    {
      label: ru.requests.others.teamTile,
      value: otherOpen,
      open: { aria: ru.requests.others.teamTileAria(otherOpen), go: nav.goOthers },
    },
  ];
  return (
    <section aria-label={t.tilesLabel}>
      <dl className={styles.tiles}>
        {tiles.map((tile) => (
          <div key={tile.label} className={styles.tile}>
            <dt className={styles.tileLabel}>{tile.label}</dt>
            <dd className={`${styles.tileNum} ${tile.tone ? styles[tile.tone] : ''} num`}>
              {tile.open ? (
                <button type="button" className={styles.tileLink} aria-label={tile.open.aria} onClick={tile.open.go}>
                  {tile.value}
                </button>
              ) : (
                tile.value
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const id = useId();
  return (
    <section className={styles.panel} aria-labelledby={id}>
      <h3 id={id} className={styles.h3}>
        {title}
      </h3>
      {children}
    </section>
  );
}

/** Полосы «сколько заявки ждут». Число всегда написано, полоса лишь помогает сравнить длину. */
export function AgingSection({ aging }: { aging: TeamView['aging'] }) {
  const max = Math.max(1, ...aging.map((a) => a.count));
  return (
    <Section title={t.agingTitle}>
      <ul className={styles.aging} aria-label={t.agingLabel}>
        {aging.map((a) => (
          <li key={a.label} className={styles.agingRow}>
            <span className={styles.agingLabel}>{a.label}</span>
            <span className={styles.track} aria-hidden="true">
              <span className={styles.fill} style={{ width: a.count > 0 ? `${Math.max(2, Math.round((a.count / max) * 100))}%` : '0' }} />
            </span>
            <span className={`${styles.agingCount} num`}>{a.count}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** Нагрузка по координаторам. Имя — кнопка: открывает «Заявки» с отбором «В работе у» этого человека. */
export function WorkloadSection({ workload }: { workload: TeamWorkload[] }) {
  const nav = useAppNav();
  return (
    <Section title={t.workloadTitle}>
      {workload.length === 0 ? (
        <p className={styles.empty}>{t.workloadEmpty}</p>
      ) : (
        <>
          <TableScroll label={t.workloadTitle} bare>
            <table className={styles.table} aria-label={t.workloadLabel}>
              <thead>
                <tr>
                  <th scope="col">{t.colName}</th>
                  <th scope="col" className={styles.numCol}>{t.colOpen}</th>
                  <th scope="col" className={styles.numCol}>{t.colCallback}</th>
                  <th scope="col" className={styles.numCol}>{t.colOver7}</th>
                  <th scope="col" className={styles.numCol}>{t.colOldest}</th>
                </tr>
              </thead>
              <tbody>
                {workload.map((w) => (
                  <tr key={w.name ?? '\u0000nobody'}>
                    <th scope="row" className={styles.nameCell}>
                      <button type="button" className={styles.linkBtn} onClick={() => nav.goResponsible(w.name)}>
                        {w.name ?? t.nobody}
                      </button>
                    </th>
                    <td className={`${styles.numCol} num`}>{w.open}</td>
                    <td className={`${styles.numCol} num`}>{w.callback}</td>
                    <td className={`${styles.numCol} num`}>{w.over7}</td>
                    <td className={`${styles.numCol} num`}>
                      {w.oldestDays === null ? (
                        <>
                          <span aria-hidden="true">—</span>
                          <span className="visually-hidden">{t.noDate}</span>
                        </>
                      ) : (
                        w.oldestDays
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
          <p className={styles.hint}>{t.workloadHint}</p>
        </>
      )}
    </Section>
  );
}

/** Заявки, которые ждут дольше недели, — самые старые сверху. Нажатие открывает заявку в «Заявках». */
export function StuckSection({ stuck }: { stuck: TeamView['stuck'] }) {
  const nav = useAppNav();
  return (
    <Section title={t.stuckTitle}>
      {stuck.length === 0 ? (
        <p className={styles.empty}>{t.stuckEmpty}</p>
      ) : (
        <ul className={styles.stuck} aria-label={t.stuckLabel}>
          {stuck.map((s) => (
            <li key={s.id}>
              <button type="button" className={styles.stuckBtn} onClick={() => nav.openRequest(s.id)}>
                <b className={styles.stuckName}>{s.fio}</b>
                <span>{t.stuckWaits(plural(s.waitingDays, FORMS.day))}</span>
                <span className={styles.stuckWho}>{s.responsible ? t.stuckWho(s.responsible) : t.nobody}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** Действия за 7 дней по логинам. Пока вход общий, строка одна, и пояснение об этом стоит всегда. */
export function ActivitySection({ activity }: { activity: TeamActivity[] }) {
  return (
    <Section title={t.activityTitle}>
      {activity.length === 0 ? (
        <p className={styles.empty}>{t.activityEmpty}</p>
      ) : (
        <TableScroll label={t.activityTitle} bare>
          <table className={styles.table} aria-label={t.activityLabel}>
            <thead>
              <tr>
                <th scope="col">{t.colActor}</th>
                <th scope="col" className={styles.numCol}>{t.colCalls}</th>
                <th scope="col" className={styles.numCol}>{t.colApproved}</th>
                <th scope="col" className={styles.numCol}>{t.colRejected}</th>
                <th scope="col" className={styles.numCol}>{t.colEdits}</th>
                <th scope="col" className={styles.numCol}>{t.colAssigned}</th>
              </tr>
            </thead>
            <tbody>
              {activity.map((a) => (
                <tr key={a.actor}>
                  <th scope="row" className={`${styles.nameCell} ${styles.actor}`}>
                    {a.actor}
                  </th>
                  <td className={`${styles.numCol} num`}>{a.calls}</td>
                  <td className={`${styles.numCol} num`}>{a.approved}</td>
                  <td className={`${styles.numCol} num`}>{a.rejected}</td>
                  <td className={`${styles.numCol} num`}>{a.edits}</td>
                  <td className={`${styles.numCol} num`}>{a.assigned}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
      <p className={styles.hint}>{t.activityNote}</p>
    </Section>
  );
}
