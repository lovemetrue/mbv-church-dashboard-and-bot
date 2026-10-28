import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { HelpArticleView, HelpIndexView } from '@contracts';
import { apiGet } from '../../shared/api/client';
import { API_BASE } from '../../shared/api/base';
import { useMe } from '../../shared/api/queries';
import { ru } from '../../shared/i18n/ru';
import { Button, Chip, ErrorState, LoadingState, Modal } from '../../shared/ui';
import { Markdown } from './Markdown';
import styles from './Help.module.css';

const t = ru.help;

/** Картинки статей лежат рядом с ними (`инструкция-координатора/…png`); сервер отдаёт их по имени файла. */
const imageUrl = (path: string): string => `${API_BASE}help/files/${encodeURIComponent(path.split('/').pop() ?? '')}`;

/**
 * Знак «?» в шапке: база знаний — частые проблемы и инструкции, те же файлы, что читает помощник. Статьи грузятся только
 * при открытии окна: справку открывают редко, а список заявок не должен ждать её.
 */
export function HelpButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" aria-label={t.open} title={t.open} onClick={() => setOpen(true)}>
        <span className={styles.helpBtn} aria-hidden="true">?</span>
      </Button>
      {open && <HelpDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function HelpDialog({ onClose }: { onClose: () => void }) {
  const index = useQuery({ queryKey: ['help'], queryFn: ({ signal }) => apiGet<HelpIndexView>('help', signal), staleTime: 5 * 60_000 });
  const [picked, setPicked] = useState<string | null>(null);
  const current = picked ?? index.data?.articles[0]?.id ?? null;
  const article = useQuery({
    queryKey: ['help', current],
    queryFn: ({ signal }) => apiGet<HelpArticleView>(`help/${current}`, signal),
    enabled: current !== null,
    staleTime: 5 * 60_000,
  });
  const chat = useMe().data?.assistant?.chat === true;

  return (
    <Modal title={t.title} onClose={onClose} wide>
      {index.isPending ? (
        <LoadingState lines={3} />
      ) : index.isError ? (
        <ErrorState error={index.error} onRetry={() => void index.refetch()} />
      ) : (
        <>
          <div className={styles.tabs} role="group" aria-label={t.articles}>
            {index.data.articles.map((a) => (
              <Chip key={a.id} pressed={a.id === current} onClick={() => setPicked(a.id)}>
                {a.title}
              </Chip>
            ))}
          </div>
          {chat && <p className={styles.lead}>{t.askAssistant}</p>}
          {article.isPending ? (
            <LoadingState lines={6} />
          ) : article.isError ? (
            <ErrorState error={article.error} onRetry={() => void article.refetch()} />
          ) : (
            <article aria-label={article.data.title}>
              <Markdown source={article.data.markdown} imageUrl={imageUrl} />
            </article>
          )}
        </>
      )}
    </Modal>
  );
}
