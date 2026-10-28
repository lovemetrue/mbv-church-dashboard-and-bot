import { useCanChange } from '../../shared/access';
import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { FormMeta, GroupDraftView, OwnGroup } from '@contracts';
import { ApiError, apiGet } from '../../shared/api/client';
import { ru } from '../../shared/i18n/ru';
import { useAppNav } from '../../shared/nav';
import { Button, DrawerSection, ErrorState, LoadingState } from '../../shared/ui';
import styles from './Create.module.css';
import { FormMetaGate } from './FormMetaGate';
import { RecordForm } from './RecordForm';
import { groupSpec, type FormSpec } from './specs';

const t = ru.create.fromRequest;

/**
 * «Группа по заявке» в карточке заявки и обращения. Пример, ради которого это сделано: человек ответил «уже веду
 * группу», а потом решил открыть свою. Кнопка открывает обычную форму «Новая группа», заполненную по заявке (поля
 * считает сервер — тем же разбором, что подбор), и новая группа связывается с заявкой. Если группа по заявке уже есть
 * (так бывает и у «хочу открыть группу»: потенциальная заводится сама), вместо кнопки — ссылка на неё.
 */
export function GroupFromRequestSection({ requestId, ownGroup }: { requestId: number; ownGroup: OwnGroup | null }) {
  const nav = useAppNav();
  const [open, setOpen] = useState(false);
  // Код новой группы до того, как список заявок перечитается и принесёт `ownGroup`.
  const [created, setCreated] = useState<OwnGroup | null>(null);
  const group = ownGroup ?? created;
  // «Только чтение» группу не заводит; ссылку на уже заведённую — видит.
  if (!useCanChange() && !group) return null;
  return (
    <DrawerSection title={t.title}>
      {group ? (
        <>
          <p role="status" className={styles.fromRequestText}>{created && !ownGroup ? t.created(group.code) : t.exists(group.code)}</p>
          <Button size="sm" onClick={() => nav.openGroup(group.id)}>{t.open(group.code)}</Button>
        </>
      ) : (
        <>
          <p className={styles.fromRequestText}>{t.hint}</p>
          <Button onClick={() => setOpen(true)}>{t.create}</Button>
        </>
      )}
      {open && (
        <GroupFromRequestDialog
          requestId={requestId}
          onClose={() => setOpen(false)}
          onCreated={(id) => {
            setOpen(false);
            setCreated({ id, code: `ДГ-${String(id).padStart(4, '0')}`, status: 'Потенциальная' });
          }}
        />
      )}
    </DrawerSection>
  );
}

function GroupFromRequestDialog({ requestId, onClose, onCreated }: { requestId: number; onClose: () => void; onCreated: (id: number) => void }) {
  const draft = useQuery({
    queryKey: ['group-draft', requestId],
    queryFn: ({ signal }) => apiGet<GroupDraftView>(`requests/${requestId}/group-draft`, signal),
    // Черновик нужен свежим на момент открытия формы: заявку могли только что поправить.
    staleTime: 0,
    gcTime: 0,
    retry: (count, error) => count < 2 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
  });
  // Пока идёт отправка, окно не закрывается: группа всё равно создастся, а человек не узнал бы, чем кончилось.
  const busy = useRef(false);
  const close = () => !busy.current && onClose();
  return (
    <FormMetaGate title={t.dialogTitle(draft.data?.fio ?? '')} onClose={close}>
      {(meta) =>
        draft.data ? (
          <DraftForm meta={meta} draft={draft.data} onClose={onClose} onCreated={onCreated} onBusyChange={(b) => { busy.current = b; }} />
        ) : draft.isError ? (
          <>
            <p role="alert">{t.draftFailed}</p>
            <ErrorState error={draft.error} onRetry={() => void draft.refetch()} />
          </>
        ) : (
          <LoadingState lines={4} />
        )
      }
    </FormMetaGate>
  );
}

function DraftForm({ meta, draft, onClose, onCreated, onBusyChange }: {
  meta: FormMeta;
  draft: GroupDraftView;
  onClose: () => void;
  onCreated: (id: number) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  // Форма та же, что у «+ Создать → Группа», только начальные значения — из заявки, а номер заявки уходит скрытым полем.
  // Выбор ведущего из «Людей» здесь не нужен: ведущий уже известен — это человек из заявки.
  const spec = useMemo((): FormSpec => {
    const base = groupSpec(meta);
    return {
      ...base,
      fields: base.fields.filter((f) => f.name !== 'leaderKey'),
      initial: { ...base.initial, ...draft.fields },
      hidden: { sourceRequestId: String(draft.requestId) },
    };
  }, [meta, draft]);
  return (
    <RecordForm
      spec={spec}
      path="groups/create"
      submitLabel={ru.create.submitGroup}
      onClose={onClose}
      onCreated={(c) => onCreated(c.id)}
      onBusyChange={onBusyChange}
    />
  );
}
