import { describe, expect, test } from 'vitest';
import { registrationCardPage, type RegistrationCardInfo } from '../src/dashboard/registrationCard.js';

const info = (patch: Partial<RegistrationCardInfo> = {}): RegistrationCardInfo => ({
  registrationNo: 3178,
  fullName: 'Панов Дмитрий',
  phone: '+79944178986',
  church: 'Церковь «Иисуса Христа» г. Кингисепп',
  mdgStatus: 'open',
  ...patch,
});

const QR_URL = '/groups/registration/qr?id=42';
const LOGO_URL = '/groups/assets/church-logo.png';

/**
 * Печатная карточка — единственное место, куда теперь ведут и таблица
 * «Регистрация», и QR сразу после заведения: раньше там был голый PNG без
 * единого слова о том, кто это и по какому телефону.
 */
describe('печатная карточка регистрации', () => {
  test('несёт номер, QR-картинку и все заполненные поля', () => {
    const html = registrationCardPage(info(), QR_URL, LOGO_URL);
    expect(html).toContain('3178');
    expect(html).toContain(`src="${QR_URL}"`);
    expect(html).toContain('Панов Дмитрий');
    expect(html).toContain('+7 994 417-89-86');
    expect(html).toContain('Церковь «Иисуса Христа» г. Кингисепп');
    expect(html).toContain('готов открыть Малую группу');
  });

  test('незаполненные телефон, церковь и заявку просто не показывает — не выдумывает прочерки', () => {
    const html = registrationCardPage(info({ phone: null, church: null, mdgStatus: null }), QR_URL, LOGO_URL);
    expect(html).not.toContain('Телефон');
    expect(html).not.toContain('Церковь');
    expect(html).not.toContain('Заявка');
  });

  test('имя и церковь экранированы', () => {
    const html = registrationCardPage(info({ fullName: '<script>', church: 'A & B' }), QR_URL, LOGO_URL);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('A &amp; B');
  });

  test('без ФИО показывает честную заглушку, а не пустоту', () => {
    const html = registrationCardPage(info({ fullName: null }), QR_URL, LOGO_URL);
    expect(html).toContain('не указано');
  });

  /**
   * Жалоба служителей: печаталось мелко и с большими отступами по бокам —
   * карточка тонула посреди пустого листа A4. Эмблема — по их же просьбе.
   */
  test('несёт эмблему церкви и размер страницы печати подогнан под саму карточку', () => {
    const html = registrationCardPage(info(), QR_URL, LOGO_URL);
    expect(html).toContain(`<img class="logo" src="${LOGO_URL}"`);
    expect(html).toMatch(/@page\s*{\s*size:/);
  });
});
