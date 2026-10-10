-- Настройки сервисов платформы одним местом (ключ → значение).
-- Первое применение: подбор для новых заявок — включён ли автоматический запуск и когда запускали
-- в последний раз (ключи matching.auto, matching.last_run). Дальше сюда переедут и другие настройки.
CREATE TABLE app_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);
