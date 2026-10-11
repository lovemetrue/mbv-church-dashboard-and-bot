-- Состав группы, внесённый вручную: те, кто уже ходит в группу (в таблице церкви есть только число участников).
-- Кого сервис утвердил в группу, в эту таблицу не копируется: они видны сами, по заявкам со статусом «Исполнена».
-- Удаление мягкое (archived_at): человек вышел из группы или внесён по ошибке, след остаётся.
CREATE TABLE group_members (
  id          bigserial PRIMARY KEY,
  group_id    bigint NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  full_name   text NOT NULL,
  phone       text,
  joined_on   date,
  note        text,
  -- ui — внесён в интерфейсе; импорт — загружен списком (появится позже).
  source      text NOT NULL DEFAULT 'ui' CHECK (source IN ('ui', 'импорт')),
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX group_members_group_idx ON group_members (group_id) WHERE archived_at IS NULL;
