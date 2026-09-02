-- Участники кампании. Один человек в каждой платформе учитывается отдельно:
-- один и тот же человек может прийти и в Telegram, и в MAX.
CREATE TABLE users (
  id                bigserial PRIMARY KEY,
  platform          text        NOT NULL CHECK (platform IN ('telegram', 'max')),
  platform_user_id  text        NOT NULL,
  chat_id           text        NOT NULL,
  username          text,
  phone             text,
  last_name         text,
  first_name        text,
  in_small_group    boolean,
  metro             text,
  age               int,
  -- NULL означает, что анкета не дошла до конца: в рассылку такой человек не попадает.
  registered_at     timestamptz,
  -- Человек заблокировал бота или удалил диалог: исключаем из рассылок.
  blocked_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, platform_user_id)
);

CREATE INDEX users_broadcast_idx ON users (platform)
  WHERE registered_at IS NOT NULL AND blocked_at IS NULL;

-- Состояние диалога. Живёт в БД, чтобы анкета переживала рестарт контейнера.
CREATE TABLE sessions (
  user_id    bigint      PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  state      text        NOT NULL DEFAULT 'idle',
  -- Черновик анкеты до фиксации в users.
  data       jsonb       NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Заявки и вопросы, которые бот передаёт служителям.
CREATE TABLE requests (
  id          bigserial   PRIMARY KEY,
  user_id     bigint      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type        text        NOT NULL CHECK (type IN ('join_group', 'lead_group', 'question')),
  text        text,
  status      text        NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'answered', 'closed')),
  answered_by text,
  answer      text,
  answered_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX requests_status_idx ON requests (status, created_at);

-- Контент дней кампании: загружается админом командой /setday.
CREATE TABLE campaign_days (
  day        int         PRIMARY KEY CHECK (day BETWEEN 1 AND 40),
  content    text        NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Одна рассылка: либо день кампании ('day:12'), либо объявление ('adhoc:<uuid>').
CREATE TABLE broadcasts (
  key         text        PRIMARY KEY,
  body        text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

-- Журнал доставки: защищает от повторной рассылки после рестарта и позволяет дослать упавшим.
CREATE TABLE deliveries (
  id             bigserial PRIMARY KEY,
  broadcast_key  text      NOT NULL REFERENCES broadcasts (key) ON DELETE CASCADE,
  user_id        bigint    NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status         text      NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'sent', 'failed', 'blocked')),
  attempts       int       NOT NULL DEFAULT 0,
  last_error     text,
  sent_at        timestamptz,
  UNIQUE (broadcast_key, user_id)
);

CREATE INDEX deliveries_pending_idx ON deliveries (broadcast_key, id) WHERE status = 'pending';
