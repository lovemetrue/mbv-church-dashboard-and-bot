import { useRef, useState, type ButtonHTMLAttributes } from 'react';
import { ru } from '../../shared/i18n/ru';
import { Button, Modal } from '../../shared/ui';
import buttonStyles from '../../shared/ui/Button.module.css';
import styles from './Manage.module.css';
import { useCanDelete, useManageAction } from './useManage';

/** Красная кнопка для необратимых для человека действий; размер и тап-зона те же, что у остальных кнопок. */
export function DangerButton({
  solid = false,
  type = 'button',
  children,
  ...rest
}: { solid?: boolean; children: string } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'>) {
  return (
    <button {...rest} type={type} className={`${buttonStyles.btn} ${buttonStyles.md} ${styles.danger} ${solid ? styles.dangerSolid : ''}`}>
      {children}
    </button>
  );
}

/**
 * Окно подтверждения удаления. Удаление мягкое (запись скрывается), но вернуть её из интерфейса
 * нельзя, поэтому без подтверждения ничего не уходит. Пока идёт запрос, окно не закрывается.
 */
export function DeleteDialog({
  title,
  path,
  onClose,
  onDeleted,
}: {
  title: string;
  /** Адрес действия относительно /api/v1/, например `groups/12/delete`. */
  path: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { run, busy } = useManageAction();
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  busyRef.current = busy;

  async function confirm() {
    setError(null);
    const result = await run(path, {});
    // null — повторное нажатие, пока первый запрос не закончился: ответит первый.
    if (result === null) return;
    if (result.ok) onDeleted();
    else setError(result.message);
  }

  return (
    <Modal title={title} onClose={() => !busyRef.current && onClose()}>
      <p className={styles.confirm}>{ru.manage.deleteText}</p>
      {error && (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      )}
      <div className={`${styles.foot} ${styles.footStatic}`}>
        <Button onClick={onClose} disabled={busy}>
          {ru.manage.cancel}
        </Button>
        <DangerButton solid disabled={busy} onClick={() => void confirm()}>
          {busy ? ru.manage.deleting : ru.manage.delete}
        </DangerButton>
      </div>
    </Modal>
  );
}

/**
 * Кнопка «Удалить» с окном подтверждения. Видна только полному входу: обычному входу её нет вовсе,
 * а не отключена (сервер всё равно ответил бы 403). `onDeleted` вызывается, когда запись удалена и
 * списки перечитаны: тот, кто показывал запись, закрывает её карточку.
 */
export function DeleteRecord({
  label = ru.manage.delete,
  ariaLabel,
  title,
  path,
  onDeleted,
}: {
  label?: string;
  ariaLabel: string;
  title: string;
  path: string;
  onDeleted: () => void;
}) {
  const canDelete = useCanDelete();
  const [open, setOpen] = useState(false);
  if (!canDelete) return null;
  return (
    <>
      <DangerButton aria-label={ariaLabel} onClick={() => setOpen(true)}>
        {label}
      </DangerButton>
      {open && (
        <DeleteDialog
          title={title}
          path={path}
          onClose={() => setOpen(false)}
          onDeleted={() => {
            setOpen(false);
            onDeleted();
          }}
        />
      )}
    </>
  );
}
