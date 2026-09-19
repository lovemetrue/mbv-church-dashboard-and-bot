import { formatPhone } from '../core/phone.js';
import { KIT_DATE, MDG_LABEL } from '../core/texts.js';
import type { MdgStatus } from '../core/fsm.js';

export interface RegistrationCardInfo {
  registrationNo: number;
  fullName: string | null;
  phone: string | null;
  church: string | null;
  mdgStatus: MdgStatus | null;
}

/**
 * Печатная карточка регистрации: QR и все заполненные данные одной страницей.
 *
 * В таблице «Регистрация» и в форме заведения показывался только сам QR (просто
 * ссылка на PNG) — открыв или распечатав его, служитель получал голый штрихкод
 * без имени и телефона, хотя в Telegram та же карточка приходит с полным составом
 * данных в подписи к фото. Светлый фон нарочно: страница для печати, а не для
 * экрана дашборда.
 */
export function registrationCardPage(info: RegistrationCardInfo, qrUrl: string): string {
  const rows: [string, string][] = [['ФИО', info.fullName ?? 'не указано']];
  const phone = formatPhone(info.phone);
  if (phone) rows.push(['Телефон', phone]);
  if (info.church) rows.push(['Церковь', info.church]);
  if (info.mdgStatus) rows.push(['Заявка', MDG_LABEL[info.mdgStatus]]);

  const esc = (v: string): string => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  return `<!doctype html>
<html lang="ru"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Регистрация №${info.registrationNo}</title>
<style>
  body { margin: 24px auto; max-width: 380px; padding: 0 20px; color: #111;
         font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; }
  h1 { font-size: 19px; margin: 0 0 4px; }
  .no { color: #444; font-size: 15px; margin: 0 0 18px; }
  .no b { color: #111; }
  img { display: block; width: 220px; height: 220px; margin: 0 auto 20px; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 8px 14px; font-size: 14px; margin: 0 0 20px; }
  dt { color: #666; }
  dd { margin: 0; font-weight: 600; }
  .kit { font-size: 13px; color: #444; }
  @media print { body { margin: 0; } }
</style></head>
<body>
  <h1>Готово, вы зарегистрированы!</h1>
  <p class="no">Ваш номер регистрации: <b>${info.registrationNo}</b></p>
  <img src="${qrUrl}" alt="QR №${info.registrationNo}">
  <dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
  <p class="kit">Набор участника можно получить ${KIT_DATE}. Покажите этот QR-код служителю или назовите номер регистрации.</p>
</body></html>`;
}
