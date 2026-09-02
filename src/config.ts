import { z } from 'zod';

/** Список id через запятую: "12345,67890". */
const idList = z
  .string()
  .default('')
  .transform((raw) =>
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const schema = z.object({
  ENABLED_PLATFORMS: z
    .string()
    .default('telegram')
    .transform((raw) =>
      raw
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    )
    .pipe(z.array(z.enum(['telegram', 'max'])).nonempty()),

  BOT_TOKEN_TELEGRAM: z.string().default(''),
  BOT_TOKEN_MAX: z.string().default(''),
  // Адрес API MAX. Значение по умолчанию — рабочий хост; см. комментарий в max.adapter.ts.
  MAX_API_URL: z.string().url().default('https://platform-api.max.ru'),
  // Куда отправлять служителя за статистикой, заявками и заведением групп.
  DASHBOARD_URL: z.string().url().default('https://bloodofjesus.ru/groups'),

  ADMIN_IDS_TELEGRAM: idList,
  ADMIN_IDS_MAX: idList,

  DATABASE_URL: z.string().min(1, 'DATABASE_URL обязателен'),

  /** Первый день кампании в формате YYYY-MM-DD (по московскому времени). */
  CAMPAIGN_START_DATE: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'CAMPAIGN_START_DATE должен быть в формате YYYY-MM-DD'),
  /** Время ежедневной рассылки, HH:MM по московскому времени. */
  BROADCAST_TIME: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'BROADCAST_TIME должен быть в формате HH:MM')
    .default('07:00'),
  /** Сколько сообщений в секунду отправлять в одну платформу. Лимит платформ около 30. */
  BROADCAST_RATE: z.coerce.number().int().positive().max(30).default(20),
  CAMPAIGN_DAYS: z.coerce.number().int().positive().max(365).default(40),
  /** Сколько дней хранить закрытые заявки. По умолчанию около трёх месяцев. */
  REQUESTS_RETENTION_DAYS: z.coerce.number().int().positive().max(3650).default(90),

  /**
   * Кнопка очистки базы у служителей. Нужна на время тестов.
   * z.coerce.boolean() здесь не годится: строка «false» превратилась бы в true.
   */
  ALLOW_DB_RESET: z
    .string()
    .default('false')
    .transform((v) => /^(1|true|yes|да)$/i.test(v.trim())),

  TIMEZONE: z.string().default('Europe/Moscow'),
  LOG_LEVEL: z.string().default('info'),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Некорректная конфигурация в .env:\n${problems}`);
  }

  const cfg = parsed.data;

  // Токен нужен только для включённых платформ, иначе бот молча не отвечал бы.
  for (const platform of cfg.ENABLED_PLATFORMS) {
    const token = platform === 'telegram' ? cfg.BOT_TOKEN_TELEGRAM : cfg.BOT_TOKEN_MAX;
    if (!token) {
      throw new Error(
        `Платформа ${platform} включена в ENABLED_PLATFORMS, но токен не задан ` +
          `(BOT_TOKEN_${platform.toUpperCase()} в .env)`,
      );
    }
  }

  return cfg;
}

export function adminIds(cfg: Config, platform: 'telegram' | 'max'): string[] {
  return platform === 'telegram' ? cfg.ADMIN_IDS_TELEGRAM : cfg.ADMIN_IDS_MAX;
}
