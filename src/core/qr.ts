import QRCode from 'qrcode';

/**
 * QR-код для выдачи набора. Внутри либо ссылка, открывающая бота с номером регистрации
 * (служитель наводит камеру, бот отмечает выдачу), либо сам номер, если платформа
 * не умеет диплинки: тогда служитель вводит номер руками.
 */
export async function qrPng(payload: string): Promise<Buffer> {
  return QRCode.toBuffer(payload, {
    type: 'png',
    width: 512,
    margin: 2,
    errorCorrectionLevel: 'M',
  });
}

/** Payload диплинка выдачи набора. */
export const kitPayload = (registrationNo: number): string => `kit_${registrationNo}`;

/** Разбор payload из /start: возвращает номер регистрации или null. */
export function parseKitPayload(payload: string | undefined): number | null {
  const match = payload?.match(/^kit_(\d+)$/);
  if (!match) return null;
  const no = Number.parseInt(match[1]!, 10);
  return Number.isFinite(no) ? no : null;
}
