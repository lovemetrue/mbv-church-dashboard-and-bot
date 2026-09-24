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
 * Печатная карточка регистрации: эмблема, QR и все заполненные данные одной
 * страницей.
 *
 * В таблице «Регистрация» и в форме заведения показывался только сам QR (просто
 * ссылка на PNG) — открыв или распечатав его, служитель получал голый штрихкод
 * без имени и телефона, хотя в Telegram та же карточка приходит с полным составом
 * данных в подписи к фото. Светлый фон нарочно: страница для печати, а не для
 * экрана дашборда.
 *
 * `@page` нарочно узкий (а не оставлен по умолчанию под A4/Letter): иначе при
 * печати маленькая карточка тонет посреди почти пустого листа по ширине — с
 * этим уже приходили жалобы, что «печатает мелко и с большими отступами по
 * бокам». 1 CSS-px печатается как 1/96 дюйма, поэтому 420px здесь и 130mm в
 * @page — одна и та же ширина, только в разных единицах для экрана и для
 * печати. Высоту `size` не умеет ставить в «auto» вместе с шириной — понимает
 * только пару конкретных чисел, — поэтому 240mm подобраны с запасом под самую
 * длинную карточку (все четыре поля: ФИО, телефон, церковь, заявка).
 */
export function registrationCardPage(info: RegistrationCardInfo, qrUrl: string, logoUrl: string): string {
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
  @page { size: 130mm 240mm; margin: 8mm; }
  body { margin: 24px auto; max-width: 420px; padding: 0 16px; color: #111; text-align: center;
         font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; }
  .logo { display: block; width: 210px; margin: 0 auto 16px; }
  h1 { font-size: 26px; margin: 0 0 6px; }
  .no { color: #444; font-size: 19px; margin: 0 0 20px; }
  .no b { color: #111; }
  .qr { display: block; width: 240px; height: 240px; margin: 0 auto 22px; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 10px 16px; font-size: 19px;
       margin: 0 0 22px; text-align: left; justify-content: center; }
  dt { color: #666; }
  dd { margin: 0; font-weight: 600; }
  .kit { font-size: 16px; color: #444; }
  @media print { body { margin: 0; } }
</style></head>
<body>
  <img class="logo" src="${logoUrl}" alt="Миссия Благая Весть">
  <h1>Готово, вы зарегистрированы!</h1>
  <p class="no">Ваш номер регистрации: <b>${info.registrationNo}</b></p>
  <img class="qr" src="${qrUrl}" alt="QR №${info.registrationNo}">
  <dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
  <p class="kit">Набор участника можно получить ${KIT_DATE}. Покажите этот QR-код служителю или назовите номер регистрации.</p>
</body></html>`;
}
