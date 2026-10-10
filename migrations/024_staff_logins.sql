-- Личные входы служителей. Это не участники кампании (таблица users), а те, кто работает в интерфейсе.
--  • staff — человек: логин, почта, роль, хеш пароля (только хеш, scrypt). Пароль человек задаёт сам по
--    ссылке: пока ссылкой не воспользовались, password_hash пуст.
--  • staff_tokens — одноразовые ссылки на пароль («приглашение» и «сброс»). Хранится только хеш токена:
--    утечка таблицы не даёт готовых ссылок.
--  • session_version — счётчик: его повышают при отключении и смене пароля, и все прежние входы человека
--    перестают действовать.
-- Включён ли режим личных входов, хранится в app_settings (ключ auth.personal), по умолчанию выключен.
CREATE TABLE staff (
  id               bigserial PRIMARY KEY,
  login            text NOT NULL,
  full_name        text NOT NULL,
  email            text NOT NULL,
  role             text NOT NULL CHECK (role IN ('admin', 'super')),
  password_hash    text,
  active           boolean NOT NULL DEFAULT true,
  session_version  integer NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       text NOT NULL,
  password_set_at  timestamptz,
  last_login_at    timestamptz
);
CREATE UNIQUE INDEX staff_login_lower ON staff (lower(login));
CREATE UNIQUE INDEX staff_email_lower ON staff (lower(email));

CREATE TABLE staff_tokens (
  id         bigserial PRIMARY KEY,
  staff_id   bigint NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  purpose    text NOT NULL CHECK (purpose IN ('invite', 'reset')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz
);
CREATE INDEX staff_tokens_staff_idx ON staff_tokens (staff_id, created_at DESC);
