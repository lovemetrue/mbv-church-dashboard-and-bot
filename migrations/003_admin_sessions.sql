-- Состояние мини-диалогов служителя (какой день загружаем, кому отвечаем).
-- Отдельно от sessions: служитель сам участник кампании, и его админский диалог
-- не должен сбивать его собственную анкету.
CREATE TABLE admin_sessions (
  user_id    bigint      PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  state      text        NOT NULL DEFAULT 'idle',
  data       jsonb       NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
