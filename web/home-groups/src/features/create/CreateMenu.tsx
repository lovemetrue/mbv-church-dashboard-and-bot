import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMe } from '../../shared/api/queries';
import { ru } from '../../shared/i18n/ru';
import { tabParams, useAppNav } from '../../shared/nav';
import { Button } from '../../shared/ui';
import styles from './Create.module.css';
import { CreateDialog, type CreateKind } from './CreateDialog';
import { CreateNotice } from './CreateNotice';

/** «ДГ-0013»: как `groupCode` на сервере, id с нулями до четырёх знаков. */
export const groupCodeOf = (id: number): string => `ДГ-${String(id).padStart(4, '0')}`;

/** Адрес регистрации в старом дашборде; хвостовую косую черту убираем, чтобы не вышло `//registration`. */
const registrationUrl = (legacyUrl: string): string => `${legacyUrl.replace(/\/+$/, '')}/registration`;

interface Notice {
  kind: CreateKind;
  id: number;
}

/**
 * Кнопка «+ Создать» с меню и всем, что за ней: окна форм и подтверждение результата.
 * Меню по шаблону WAI-ARIA (menu button): стрелки, Home/End, Esc возвращает фокус на кнопку,
 * клик вне закрывает. Пока /me не ответил, пункта «Участник» нет: не знаем, есть ли куда вести.
 */
export function CreateMenu() {
  const nav = useAppNav();
  const [, setParams] = useSearchParams();
  const me = useMe();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<CreateKind | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const hintId = useId();
  const nameId = useId();

  const items = (): HTMLElement[] =>
    Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [open]);

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (e.key === 'ArrowDown') next = (at + 1) % list.length;
    else if (e.key === 'ArrowUp') next = (at - 1 + list.length) % list.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = list.length - 1;
    else if (e.key === 'Tab') {
      // Табуляция уводит из меню: оно закрывается, а фокус идёт дальше по странице.
      setOpen(false);
      return;
    } else return;
    e.preventDefault();
    list[next]?.focus();
  };

  const choose = (kind: CreateKind) => {
    // Фокус на кнопку до открытия окна: окно запоминает, откуда пришло, и вернёт фокус туда,
    // а пункт меню к тому времени уже исчез бы из страницы.
    triggerRef.current?.focus();
    setOpen(false);
    setDialog(kind);
  };

  const created = (kind: CreateKind, id: number) => {
    setDialog(null);
    setNotice({ kind, id });
  };

  const openCreated = () => {
    if (!notice) return;
    if (notice.kind === 'request') nav.openRequest(notice.id);
    else {
      // Одним переходом: два подряд (вкладка, затем запись) второй затёр бы первым, они читают один адрес.
      setParams((prev) => {
        const next = tabParams(prev, 'reference');
        next.set('rec', String(notice.id));
        return next;
      });
    }
    setNotice(null);
  };

  const dismissNotice = useCallback(() => setNotice(null), []);
  const legacyUrl = me.data?.legacyUrl;

  return (
    <div className={styles.root} ref={rootRef}>
      <Button
        ref={triggerRef}
        variant="primary"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        {ru.header.create}
        <span aria-hidden="true" className={styles.caret}>
          {' '}
          ▾
        </span>
      </Button>

      {open && (
        <>
          <div className={styles.scrim} aria-hidden="true" />
          <div ref={menuRef} id={menuId} className={styles.menu} role="menu" aria-label={ru.create.menuLabel} onKeyDown={onMenuKey}>
            <button type="button" role="menuitem" tabIndex={-1} className={styles.item} onClick={() => choose('request')}>
              {ru.create.request}
            </button>
            <button type="button" role="menuitem" tabIndex={-1} className={styles.item} onClick={() => choose('group')}>
              {ru.create.group}
            </button>
            {legacyUrl ? (
              <a
                role="menuitem"
                tabIndex={-1}
                className={styles.item}
                aria-describedby={hintId}
                href={registrationUrl(legacyUrl)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
              >
                <span>
                  {ru.create.member}
                  <span aria-hidden="true"> ↗</span>
                </span>
                <span id={hintId} className="visually-hidden">
                  {ru.create.memberOpensOld}
                </span>
              </a>
            ) : me.data ? (
              // Пункт виден, но отключён: служителю надо знать, что регистрация есть и где она. Фокус на нём
              // остаётся (aria-disabled, а не disabled), чтобы скринридер дочитал причину.
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                aria-disabled="true"
                aria-labelledby={nameId}
                aria-describedby={hintId}
                className={`${styles.item} ${styles.itemDisabled}`}
                onClick={(e) => e.preventDefault()}
              >
                <span id={nameId}>{ru.create.member}</span>
                <span id={hintId} className={styles.itemHint}>
                  {ru.create.memberNoLegacy}
                </span>
              </button>
            ) : null}
          </div>
        </>
      )}

      {dialog && <CreateDialog kind={dialog} onClose={() => setDialog(null)} onCreated={(id) => created(dialog, id)} />}
      {notice && (
        <CreateNotice
          text={notice.kind === 'request' ? ru.create.createdRequest(notice.id) : ru.create.createdGroup(groupCodeOf(notice.id))}
          onOpen={openCreated}
          onDismiss={dismissNotice}
        />
      )}
    </div>
  );
}
