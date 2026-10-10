import nodemailer from 'nodemailer';
import { logger } from '../../logger.js';

/**
 * Отправка писем. Интерфейс отдельный, чтобы остальной код и тесты не знали про SMTP: в тестах
 * подставляется запоминающий отправитель, на сервере без настройки почты — «ненастроенный».
 */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  /** Настроена ли отправка. Если нет, ссылки показываются администратору на экране. */
  readonly configured: boolean;
  send(message: MailMessage): Promise<void>;
}

export const unconfiguredMailer: Mailer = {
  configured: false,
  async send() {
    throw new Error('Почта не настроена');
  },
};

export interface SmtpConfig {
  host: string;
  port: number;
  /** true — сразу TLS (обычно порт 465); false — STARTTLS, если сервер предлагает. */
  secure: boolean;
  user?: string;
  password?: string;
  from: string;
}

/**
 * Читает настройки из окружения. Все переменные необязательные: без SMTP_HOST и SMTP_FROM почта
 * считается ненастроенной, и сервис работает как обычно (ссылки показываются на экране).
 * Неполная настройка (есть адрес сервера, нет отправителя) — тоже «не настроено», а не падение.
 */
export function smtpConfigFromEnv(env: NodeJS.ProcessEnv): SmtpConfig | null {
  const host = env['SMTP_HOST']?.trim();
  const from = env['SMTP_FROM']?.trim();
  if (!host || !from) return null;
  const port = Number(env['SMTP_PORT'] ?? '587');
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  const secure = (env['SMTP_SECURE'] ?? (port === 465 ? 'true' : 'false')).trim().toLowerCase() === 'true';
  const user = env['SMTP_USER']?.trim();
  const password = env['SMTP_PASSWORD'];
  return { host, port, secure, from, ...(user ? { user } : {}), ...(password ? { password } : {}) };
}

export function createSmtpMailer(config: SmtpConfig): Mailer {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    ...(config.user ? { auth: { user: config.user, pass: config.password ?? '' } } : {}),
    // Письмо со ссылкой на пароль не должно уходить по открытому каналу.
    requireTLS: !config.secure,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return {
    configured: true,
    async send(message) {
      await transport.sendMail({ from: config.from, to: message.to, subject: message.subject, text: message.text });
      // Адрес получателя в журнал процесса не пишем: это персональные данные.
      logger.info({ subject: message.subject }, 'почта: письмо отправлено');
    },
  };
}

export function mailerFromEnv(env: NodeJS.ProcessEnv): Mailer {
  const config = smtpConfigFromEnv(env);
  return config ? createSmtpMailer(config) : unconfiguredMailer;
}
