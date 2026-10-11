import type { ReactNode } from 'react';
import { ru } from '../../shared/i18n/ru';
import buttonStyles from '../../shared/ui/Button.module.css';

/**
 * Ссылка, оформленная как кнопка, для адресов не из приложения (печатная карточка, QR): они
 * открываются в новой вкладке, чтобы не потерять открытое окно. `noopener` обязателен: вкладка
 * не должна получить доступ к странице служителя через `window.opener`.
 * Скринридеру добавляем «откроется в новой вкладке»: из названия это не видно.
 */
export function LinkButton({
  href,
  variant = 'default',
  children,
}: {
  href: string;
  variant?: 'default' | 'primary';
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`${buttonStyles.btn} ${buttonStyles[variant]} ${buttonStyles.md}`}
    >
      {children}
      <span className="visually-hidden"> {ru.create.registration.newTab}</span>
    </a>
  );
}
