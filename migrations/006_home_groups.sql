-- Ведущие домашних групп, которых служители добавляют через бота.
-- Дашборд показывает их вместе с выгрузкой из таблицы церкви, поэтому названия
-- района, формата и статуса должны совпадать с теми, что в таблице, — их выбирают
-- кнопками, руками не вводят (см. src/core/groups.ts).
CREATE TABLE home_groups (
  id             BIGSERIAL PRIMARY KEY,
  leader         TEXT NOT NULL,
  phone          TEXT,
  district       TEXT NOT NULL,
  format         TEXT NOT NULL,
  status         TEXT NOT NULL,
  people         INT,
  -- Кто и откуда добавил: нужно, чтобы было к кому вернуться с вопросом.
  added_by       TEXT NOT NULL,
  added_platform TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Убираем мягко: ошибочная запись исчезает из дашборда, но история остаётся.
  archived_at    TIMESTAMPTZ
);

CREATE INDEX home_groups_active_idx ON home_groups (created_at DESC) WHERE archived_at IS NULL;
