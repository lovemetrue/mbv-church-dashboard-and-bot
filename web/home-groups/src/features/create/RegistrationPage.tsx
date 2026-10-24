import { useId, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { FormMeta } from '@contracts';
import { LOGOUT_URL } from '../../shared/api/base';
import { useMe } from '../../shared/api/queries';
import { ru } from '../../shared/i18n/ru';
import { Button } from '../../shared/ui';
import { KitsScreen } from '../kits/KitsScreen';
import styles from './Create.module.css';
import { FormMetaContent } from './FormMetaGate';
import { RecordForm } from './RecordForm';
import { RegistrationFlow } from './RegistrationFlow';
import { groupSpec, type FormSpec } from './specs';

/** Адрес отдельной страницы регистрации внутри приложения (после основания сборки). */
export const REGISTRATION_PATH = '/registration';

/** Это адрес страницы регистрации? Слэш на конце не мешает. */
export const isRegistrationPath = (pathname: string): boolean => pathname.replace(/\/+$/, '') === REGISTRATION_PATH;

const t = ru.standalone;

type View = 'register' | 'kits';
type What = 'person' | 'group';

/**
 * «Стойка регистрации» — закрытое пространство для команды на месте, по отдельной ссылке: две вкладки — регистрация
 * (участника или новой группы) и выдача наборов. Вход с уровнем «Стойка регистрации» регистрирует только участников:
 * выбора «Группа» у него нет (и сервер такому входу группу создать не даст), пока уровень не известен — тоже нет. Ни шапки, ни остальных вкладок, ни поиска: в толпе люди не должны
 * путаться в разделах. Данные приложения здесь не запрашиваются — только справочники формы, а на вкладке «Наборы» —
 * её счётчики. Вкладка и что регистрируем запоминаются в адресе: обновили страницу — остались там же.
 * «Выйти» — обычная форма POST, как в шапке.
 */
export function RegistrationPage() {
  const [params, setParams] = useSearchParams();
  const view: View = params.get('view') === 'kits' ? 'kits' : 'register';
  const role = useMe().data?.role;
  const canGroup = role === 'admin' || role === 'super';
  const what: What = canGroup && params.get('what') === 'group' ? 'group' : 'person';
  const go = (next: { view?: View; what?: What }) => {
    const v = next.view ?? view;
    const w = next.what ?? what;
    const p = new URLSearchParams();
    if (v === 'kits') p.set('view', 'kits');
    if (v === 'register' && w === 'group') p.set('what', 'group');
    setParams(p, { replace: true });
  };
  const tabsId = useId();

  return (
    <main className={styles.standalone}>
      <header className={styles.standaloneHead}>
        <h1 className={styles.standaloneTitle}>{t.title}</h1>
        <form method="post" action={LOGOUT_URL} className={styles.standaloneLogout}>
          <Button type="submit" variant="ghost">
            {t.logout}
          </Button>
        </form>
      </header>
      <div role="tablist" aria-label={t.tabsLabel} className={styles.stationTabs}>
        {(['register', 'kits'] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            id={`${tabsId}-${v}`}
            aria-selected={view === v}
            aria-controls={`${tabsId}-panel`}
            className={styles.stationTab}
            onClick={() => go({ view: v })}
          >
            {v === 'register' ? t.tabRegister : t.tabKits}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${view}`}>
        {view === 'kits' ? (
          <KitsScreen />
        ) : (
          <>
            {canGroup && (
              <div role="group" aria-label={t.whatLabel} className={styles.stationWhat}>
                {(['person', 'group'] as const).map((w) => (
                  <button key={w} type="button" aria-pressed={what === w} className={styles.stationWhatBtn} onClick={() => go({ what: w })}>
                    {w === 'person' ? t.whatPerson : t.whatGroup}
                  </button>
                ))}
              </div>
            )}
            <div className={styles.standaloneCard}>
              <FormMetaContent>
                {(meta) => (what === 'group' ? <GroupFlow meta={meta} /> : <RegistrationFlow meta={meta} />)}
              </FormMetaContent>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

/** Новая группа на стойке: та же форма, что «+ Создать → Группа», затем код группы и «Завести ещё». */
function GroupFlow({ meta }: { meta: FormMeta }) {
  const spec = useMemo((): FormSpec => groupSpec(meta), [meta]);
  const [created, setCreated] = useState<number | null>(null);
  // Новый ключ пересоздаёт форму целиком: проще и надёжнее, чем обнулять каждое поле и ошибки.
  const [round, setRound] = useState(0);
  if (created !== null) {
    return (
      <div className={styles.done}>
        <p className={styles.doneText} role="status">
          <span className={styles.doneTitle}>{t.groupDone(`ДГ-${String(created).padStart(4, '0')}`)}</span>
        </p>
        <div className={styles.doneActions}>
          <Button
            variant="primary"
            onClick={() => {
              setCreated(null);
              setRound((r) => r + 1);
            }}
          >
            {t.groupAnother}
          </Button>
        </div>
      </div>
    );
  }
  return <RecordForm key={round} spec={spec} path="groups/create" submitLabel={ru.create.submitGroup} onCreated={(c) => setCreated(c.id)} />;
}
