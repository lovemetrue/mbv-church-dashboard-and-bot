import { useEffect, useId, useRef, useState } from 'react';
import type { CoordinatorContactsView, SendExtraInvitesBody, SettingsBotView } from '@contracts';
import { FORMS, plural } from '../../entities/plural';
import { ru } from '../../shared/i18n/ru';
import { Button, Modal } from '../../shared/ui';
import { botErrorText, hasBotIds, inviteErrorText } from './model';
import { QueryBoundary } from './QueryBoundary';
import { RefreshButton } from './RefreshButton';
import { SectionHead } from './SectionHead';
import { useBotActions, useSettingsBot } from './queries';
import styles from './Settings.module.css';

const t = ru.settings.bot;

type Mode = SettingsBotView['extraQuestions']['mode'];
const MODES: readonly Mode[] = ['off', 'all', 'list'];

type Audience = NonNullable<SendExtraInvitesBody['audience']>;
const AUDIENCES: readonly Audience[] = ['seekers', 'leaders'];

interface Draft {
  mode: Mode;
  ids: string;
}

interface Notice {
  kind: 'ok' | 'error';
  text: string;
}

/**
 * Кому бот задаёт два новых вопроса анкеты. Правка живёт отдельно от данных сервера: `draft === null` — человек
 * ничего не трогал, и форма показывает то, что действует. Поэтому перечитывание настройки по таймеру не затирает
 * набранное (как у инструкций агентов): подменяется только нетронутая форма.
 */
function ExtraQuestionsForm({
  current,
  onUnsavedChange,
}: {
  current: SettingsBotView['extraQuestions'];
  /** Сообщает наверх, есть ли набранное, но не сохранённое: рассылка ниже идёт по сохранённой настройке. */
  onUnsavedChange: (unsaved: boolean) => void;
}) {
  const actions = useBotActions();
  const modeId = useId();
  const idsId = useId();
  const idsHintId = useId();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const value: Draft = draft ?? { mode: current.mode, ids: current.ids };
  // Режим «Только этим людям» без единого номера не сохраняется: бот не стал бы спрашивать никого, и это не то, чего хотели.
  const canSave = !pending && (value.mode !== 'list' || hasBotIds(value.ids));
  // Вернули прежнее значение — правки нет. Список номеров важен только в режиме «Только этим людям».
  const unsaved = draft !== null && (draft.mode !== current.mode || (draft.mode === 'list' && draft.ids.trim() !== current.ids.trim()));

  useEffect(() => {
    onUnsavedChange(unsaved);
    // Форма может исчезнуть вместе с набранным: тогда и правки больше нет.
    return () => onUnsavedChange(false);
  }, [unsaved, onUnsavedChange]);

  const edit = (patch: Partial<Draft>) => {
    setDraft({ ...value, ...patch });
    setNotice(null);
  };

  async function save() {
    // Два нажатия подряд могут прийти до перерисовки: одного pending мало.
    if (!canSave || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setNotice(null);
    try {
      // Номера уходят только в режиме «Только этим людям»: в остальных сервер хранит пустую строку.
      await actions.saveExtraQuestions(value.mode === 'list' ? { mode: 'list', ids: value.ids.trim() } : { mode: value.mode });
      setDraft(null);
      setNotice({ kind: 'ok', text: t.saved });
    } catch (e) {
      // Набранное не стираем: человек исправит и повторит.
      setNotice({ kind: 'error', text: botErrorText(e) });
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <div className={styles.block}>
      <p>{t.intro}</p>

      <span id={modeId} className={styles.fieldLabel}>
        {t.modeLabel}
      </span>
      <div role="radiogroup" aria-labelledby={modeId} className={styles.radios}>
        {MODES.map((m) => (
          <label key={m} className={styles.radio}>
            <input type="radio" name={modeId} checked={value.mode === m} onChange={() => edit({ mode: m })} />
            <span>{t.modes[m]}</span>
          </label>
        ))}
      </div>

      {value.mode === 'list' && (
        <>
          <label htmlFor={idsId} className={styles.fieldLabel}>
            {t.idsLabel}
          </label>
          <input
            id={idsId}
            type="text"
            className={styles.control}
            value={value.ids}
            placeholder={t.idsPlaceholder}
            aria-describedby={idsHintId}
            autoComplete="off"
            onChange={(e) => edit({ ids: e.target.value })}
          />
          <p id={idsHintId} className={`${styles.muted} ${styles.hintLine}`}>
            {t.idsHint}
          </p>
        </>
      )}

      <p className={styles.source}>
        {t.source}: <b>{current.source === 'settings' ? t.sourceSettings : t.sourceEnv}</b>
        <br />
        <span className={styles.muted}>{t.envValue(current.envValue)}</span>
      </p>

      {notice && (
        <p className={notice.kind === 'ok' ? styles.noticeOk : styles.noticeError} role={notice.kind === 'ok' ? 'status' : 'alert'}>
          {notice.text}
        </p>
      )}
      <div className={styles.actionsRow}>
        <Button variant="primary" onClick={() => void save()} disabled={!canSave}>
          {pending ? t.saving : t.save}
        </Button>
      </div>
    </div>
  );
}

/**
 * Досылка двух новых вопросов тем, кто уже зарегистрирован. Рассылка уходит живым людям и необратима, поэтому
 * сначала окно подтверждения, а в запрос идёт число, которое человек в нём видел: если получателей стало иначе,
 * сервер отказывает (`conflict`), и ничего не уходит вслепую. Отправка идёт по сохранённой настройке «кому
 * задавать», поэтому при несохранённой правке выше кнопка неактивна.
 */
function ExtraInvites({ invites, unsaved }: { invites: SettingsBotView['invites']; unsaved: boolean }) {
  const i = t.invites;
  const audienceId = useId();
  // Ведущим — отдельная досылка со своим текстом: у них спрашиваем время и адрес группы, а не пожелания.
  const [audience, setAudience] = useState<Audience>('seekers');
  const total = audience === 'leaders' ? invites.leaders : invites.total;
  const actions = useBotActions();
  const titleId = useId();
  const unsavedHintId = useId();
  /** Числа на момент открытия окна: отправляем именно их, даже если обзор успел перечитаться. */
  const [confirming, setConfirming] = useState<
    (Pick<SettingsBotView['invites'], 'total' | 'join' | 'lead'> & { audience: Audience }) | null
  >(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function send(expectedTotal: number, to: Audience) {
    // Два нажатия подряд могут прийти до перерисовки: одного pending мало.
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setNotice(null);
    try {
      const r = await actions.sendExtraQuestions({ expectedTotal, audience: to });
      setNotice({ kind: 'ok', text: i.done(r.sent, r.failed, r.blocked) });
    } catch (e) {
      setNotice({ kind: 'error', text: inviteErrorText(e) });
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  const reason = !invites.available ? i.notConnected : invites.off ? i.off : total === 0 ? i.nobody : null;
  const texts = (
    audience === 'leaders'
      ? [{ title: i.textLeaderTitle, text: invites.textLeader }]
      : [
          { title: i.textJoinTitle, text: invites.textJoin },
          { title: i.textLeadTitle, text: invites.textLead },
        ]
  ).filter((x) => x.text.trim() !== '');

  return (
    <div className={styles.block} role="group" aria-labelledby={titleId}>
      <h3 id={titleId} className={styles.blockTitle}>
        {i.title}
      </h3>
      <p>{i.intro}</p>

      <span id={audienceId} className={styles.fieldLabel}>
        {i.audienceLabel}
      </span>
      <div role="radiogroup" aria-labelledby={audienceId} className={styles.radios}>
        {AUDIENCES.map((a) => (
          <label key={a} className={styles.radio}>
            <input type="radio" name={audienceId} checked={audience === a} onChange={() => setAudience(a)} />
            <span>{i.audiences[a]}</span>
          </label>
        ))}
      </div>

      {invites.available && !invites.off && audience === 'leaders' && (
        <ul className={styles.recipients}>
          <li>
            {i.leadersLabel}: <b>{invites.leaders}</b>
          </li>
        </ul>
      )}
      {invites.available && !invites.off && audience === 'seekers' && (
        <ul className={styles.recipients}>
          <li>
            {i.joinLabel}: <b>{invites.join}</b>
          </li>
          <li>
            {i.leadLabel}: <b>{invites.lead}</b>
          </li>
          <li>
            {i.totalLabel}: <b>{invites.total}</b>
          </li>
        </ul>
      )}

      {texts.length > 0 && (
        <details className={styles.texts}>
          <summary>{i.textsTitle}</summary>
          {texts.map((x) => (
            <div key={x.title}>
              <h4 className={styles.h5}>{x.title}</h4>
              <p className={styles.inviteText}>{x.text}</p>
            </div>
          ))}
        </details>
      )}

      {notice && (
        <p className={notice.kind === 'ok' ? styles.noticeOk : styles.noticeError} role={notice.kind === 'ok' ? 'status' : 'alert'}>
          {notice.text}
        </p>
      )}

      {reason ? (
        <p className={styles.muted}>{reason}</p>
      ) : (
        <>
          <div className={styles.actionsRow}>
            <Button
              variant="primary"
              disabled={pending || unsaved}
              aria-describedby={unsaved ? unsavedHintId : undefined}
              onClick={() => setConfirming({ total, join: invites.join, lead: invites.lead, audience })}
            >
              {pending ? i.sending : i.send(total)}
            </Button>
          </div>
          {unsaved && (
            <p id={unsavedHintId} className={`${styles.muted} ${styles.hintLine}`}>
              {i.unsaved}
            </p>
          )}
        </>
      )}

      {confirming && (
        <Modal title={i.confirmTitle} onClose={() => setConfirming(null)}>
          <p>
            {confirming.audience === 'leaders'
              ? i.confirmLeaders(plural(confirming.total, FORMS.person))
              : i.confirmQuestion(plural(confirming.total, FORMS.person), confirming.join, confirming.lead)}
          </p>
          <div className={styles.dialogFoot}>
            <Button onClick={() => setConfirming(null)}>{i.cancel}</Button>
            <Button
              variant="primary"
              disabled={pending}
              onClick={() => {
                const { total: expected, audience: to } = confirming;
                // Окно закрываем сразу: ход и итог видны в блоке, а не под окном.
                setConfirming(null);
                void send(expected, to);
              }}
            >
              {i.confirmYes}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function BotSection() {
  const query = useSettingsBot();
  const titleId = useId();
  const [unsaved, setUnsaved] = useState(false);
  return (
    <section aria-labelledby={titleId}>
      <SectionHead id={titleId} title={ru.settings.sections.bot}>
        <RefreshButton query={query} />
      </SectionHead>
      <QueryBoundary query={query}>
        {(data) => (
          <>
            <ExtraQuestionsForm current={data.extraQuestions} onUnsavedChange={setUnsaved} />
            <ExtraInvites invites={data.invites} unsaved={unsaved} />
            {data.coordinatorContacts && <CoordinatorContacts view={data.coordinatorContacts} />}
            <p className={`${styles.muted} ${styles.hintBelow}`}>{t.resendHint}</p>
          </>
        )}
      </QueryBoundary>
    </section>
  );
}

/**
 * «Ведущим — контакт координатора»: сколько уйдёт и у каких групп не уйдёт (кодами — без имён), пример текста, кнопка с
 * подтверждением. Уходит живым людям, поэтому подтверждается число, которое человек видел: изменилось — сервер
 * отказывает (`conflict`), ничего не уходит вслепую.
 */
function CoordinatorContacts({ view }: { view: CoordinatorContactsView }) {
  const c = t.coordinators;
  const actions = useBotActions();
  const titleId = useId();
  const [confirming, setConfirming] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function send(expectedTotal: number) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setNotice(null);
    try {
      const r = await actions.sendCoordinatorContacts({ expectedTotal });
      setNotice({ kind: 'ok', text: c.done(r.sent, r.failed, r.blocked) });
    } catch (e) {
      setNotice({ kind: 'error', text: inviteErrorText(e) });
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  const reason = !view.available ? c.notConnected : view.total === 0 ? c.nobody : null;
  const missing = [
    { label: c.noChat, codes: view.noChat },
    { label: c.noCoordinator, codes: view.noCoordinator },
    { label: c.noPhone, codes: view.noPhone },
  ].filter((m) => m.codes.length > 0);

  return (
    <div className={styles.block} role="group" aria-labelledby={titleId}>
      <h3 id={titleId} className={styles.blockTitle}>
        {c.title}
      </h3>
      <p>{c.intro}</p>
      {view.available && (
        <ul className={styles.recipients}>
          <li>
            {c.willSend}: <b>{view.total}</b>
          </li>
          {view.alreadySent > 0 && (
            <li>
              {c.alreadySent}: <b>{view.alreadySent}</b>
            </li>
          )}
          {missing.map((m) => (
            <li key={m.label}>
              {m.label}: <b>{m.codes.length}</b> <span className={styles.muted}>({m.codes.join(', ')})</span>
            </li>
          ))}
        </ul>
      )}
      <details className={styles.texts}>
        <summary>{c.sample}</summary>
        <p className={styles.inviteText}>{c.sampleText}</p>
      </details>
      {notice && (
        <p className={notice.kind === 'ok' ? styles.noticeOk : styles.noticeError} role={notice.kind === 'ok' ? 'status' : 'alert'}>
          {notice.text}
        </p>
      )}
      {reason ? (
        <p className={styles.muted}>{reason}</p>
      ) : (
        <div className={styles.actionsRow}>
          <Button variant="primary" disabled={pending} onClick={() => setConfirming(view.total)}>
            {pending ? c.sending : c.send(view.total)}
          </Button>
        </div>
      )}
      {confirming !== null && (
        <Modal title={c.confirmTitle} onClose={() => setConfirming(null)}>
          <p>{c.confirmQuestion(plural(confirming, FORMS.leaderTo))}</p>
          <div className={styles.dialogFoot}>
            <Button onClick={() => setConfirming(null)}>{c.cancel}</Button>
            <Button
              variant="primary"
              disabled={pending}
              onClick={() => {
                const expected = confirming;
                setConfirming(null);
                void send(expected);
              }}
            >
              {c.confirmYes}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
