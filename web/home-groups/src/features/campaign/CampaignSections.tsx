import { useId, type ReactNode } from 'react';
import type { CampaignView } from '@contracts';
import { formatDateFull } from '../../entities/format';
import { ru } from '../../shared/i18n/ru';
import { Pill } from '../../shared/ui';
import styles from './Campaign.module.css';

const t = ru.campaign;

function Section({ title, children }: { title: string; children: ReactNode }) {
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

/** Что написать в плитке «День кампании»: «13 из 40», «до старта» или «завершена». Дата старта — под ним. */
function dayText(day: CampaignView['day']): string {
  if (day.state === 'идёт') return t.dayRunning(day.number, day.total);
  return day.state === 'до старта' ? t.dayBefore : t.dayFinished;
}

/** Пять плиток сверху. Подпись идёт первой в разметке (список определений), число — под ней. */
export function Tiles({ data }: { data: CampaignView }) {
  const p = data.participants;
  return (
    <section aria-label={t.tilesLabel}>
      <dl className={styles.tiles}>
        <div className={styles.tile}>
          <dt className={styles.tileLabel}>{t.tileRegistered}</dt>
          <dd className={`${styles.tileNum} num`}>{p.registered}</dd>
          <dd className={styles.tileSub}>{t.registeredComplete(p.complete)}</dd>
        </div>
        <div className={styles.tile}>
          <dt className={styles.tileLabel}>{t.tileKits}</dt>
          <dd className={`${styles.tileNum} ${styles.ok} num`}>{p.kitsIssued}</dd>
        </div>
        <div className={styles.tile}>
          <dt className={styles.tileLabel}>{t.tileUnfinished}</dt>
          <dd className={`${styles.tileNum} ${p.unfinished > 0 ? styles.warn : ''} num`}>{p.unfinished}</dd>
        </div>
        <div className={styles.tile}>
          <dt className={styles.tileLabel}>{t.tileNewRequests}</dt>
          <dd className={`${styles.tileNum} num`}>{data.newRequests}</dd>
        </div>
        <div className={styles.tile}>
          <dt className={styles.tileLabel}>{t.tileDay}</dt>
          <dd className={`${styles.tileNum} ${styles.tileText} num`}>{dayText(data.day)}</dd>
          <dd className={styles.tileSub}>{t.dayStart(formatDateFull(data.day.startDate))}</dd>
        </div>
      </dl>
    </section>
  );
}

/** Что ответили про Малую группу: пять ответов, число рядом с подписью. */
export function MdgSection({ mdg }: { mdg: CampaignView['mdg'] }) {
  const keys = ['open', 'home', 'join', 'member', 'leader'] as const;
  return (
    <Section title={t.mdgTitle}>
      <ul className={styles.rows} aria-label={t.mdgLabel}>
        {keys.map((k) => (
          <li key={k} className={styles.row}>
            <span>{t.mdg[k]}</span>
            <b className="num">{mdg[k]}</b>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** Участники по мессенджерам: по карточке на каждый, а не широкая таблица, чтобы на телефоне не прокручивать вбок. */
export function PlatformsSection({ platforms }: { platforms: CampaignView['byPlatform'] }) {
  const rows = [
    ['registered', t.platformRows.registered],
    ['complete', t.platformRows.complete],
    ['kitsIssued', t.platformRows.kitsIssued],
    ['unfinished', t.platformRows.unfinished],
    ['blocked', t.platformRows.blocked],
  ] as const;
  return (
    <Section title={t.platformsTitle}>
      {platforms.length === 0 ? (
        <p className={styles.empty}>{t.platformsEmpty}</p>
      ) : (
        <ul className={styles.platforms} aria-label={t.platformsLabel}>
          {platforms.map((p) => (
            <li key={p.platform} className={styles.platform}>
              <h4 className={styles.h4}>{t.platforms[p.platform]}</h4>
              <dl className={styles.pairs}>
                {rows.map(([field, label]) => (
                  <div key={field} className={styles.row}>
                    <dt>{label}</dt>
                    <dd className="num">{p[field]}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** Сорок клеток: день и длина загруженного материала. Смысл (загружен или нет) продублирован скрытым текстом. */
export function DaysSection({ days }: { days: CampaignView['days'] }) {
  return (
    <Section title={t.daysTitle}>
      <ul className={styles.days} aria-label={t.daysLabel}>
        {days.list.map((d) => (
          <li key={d.day} className={`${styles.dayCell} ${d.loaded ? styles.dayLoaded : ''}`}>
            <span aria-hidden="true" className={styles.dayNo}>
              {d.day}
            </span>
            <span aria-hidden="true" className={`${styles.dayLen} num`}>
              {d.loaded ? d.length : ''}
            </span>
            <span className="visually-hidden">{d.loaded ? t.dayCellLoaded(d.day, d.length) : t.dayCellMissing(d.day)}</span>
          </li>
        ))}
      </ul>
      <p className={styles.hint}>{t.daysCount(days.loaded, days.total)}</p>
      <p className={styles.hint}>{days.ranges ? t.daysRanges(days.ranges) : t.daysNone}</p>
    </Section>
  );
}

/** Ключ рассылки на сервере — «day:12»; номер дня берём из него, а незнакомый ключ показываем как есть. */
function broadcastTitle(key: string): string {
  const m = /^day:(\d+)$/.exec(key);
  return t.broadcastDay(m ? m[1]! : key);
}

/** Журнал последних рассылок: сколько отправлено, не дошло, заблокировано и закончена ли. */
export function BroadcastsSection({ broadcasts }: { broadcasts: CampaignView['broadcasts'] }) {
  return (
    <Section title={t.broadcastsTitle}>
      {broadcasts.length === 0 ? (
        <p className={styles.empty}>{t.broadcastsEmpty}</p>
      ) : (
        <ul className={styles.log} aria-label={t.broadcastsLabel}>
          {broadcasts.map((b) => (
            <li key={b.key} className={styles.logItem}>
              <div className={styles.logHead}>
                <b>{broadcastTitle(b.key)}</b>
                <span className={styles.muted}>{formatDateFull(b.createdAt)}</span>
                <Pill tone={b.finished ? 'ok' : 'warn'}>{b.finished ? t.broadcastDone : t.broadcastRunning}</Pill>
              </div>
              <dl className={styles.stats}>
                <div className={styles.stat}>
                  <dt>{t.broadcastSent}</dt>
                  <dd className="num">{b.sent}</dd>
                </div>
                <div className={styles.stat}>
                  <dt>{t.broadcastFailed}</dt>
                  <dd className="num">{b.failed}</dd>
                </div>
                <div className={styles.stat}>
                  <dt>{t.broadcastBlocked}</dt>
                  <dd className="num">{b.blocked}</dd>
                </div>
                {b.pending > 0 && (
                  <div className={styles.stat}>
                    <dt>{t.broadcastPending}</dt>
                    <dd className="num">{b.pending}</dd>
                  </div>
                )}
              </dl>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
