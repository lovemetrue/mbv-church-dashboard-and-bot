-- Состав групп. Люди в составе — это ссылки на справочник людей, а не копии имён и телефонов: поправили карточку
-- человека — изменилось везде. Справочник людей собирается из трёх источников:
--   • users — зарегистрированные участники (бот и форма регистрации);
--   • requests — люди из заявок церковной таблицы без регистрации в боте;
--   • persons — карточки, внесённые вручную (например, тот, кто давно ходит в группу и нигде не зарегистрирован).
-- Кого утвердили в группу через сервис, в group_members не копируется: он виден в составе сам, по заявке «Исполнена».

CREATE TABLE persons (
  id          bigserial PRIMARY KEY,
  full_name   text NOT NULL,
  phone       text,
  age         text,
  place       text,
  note        text,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- Удаление мягкое: карточка скрывается, след остаётся.
  archived_at timestamptz
);

CREATE TABLE group_members (
  id          bigserial PRIMARY KEY,
  group_id    bigint NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  -- Ровно одна ссылка на человека (проверяется ниже).
  user_id     bigint REFERENCES users(id) ON DELETE CASCADE,
  request_id  bigint REFERENCES requests(id) ON DELETE CASCADE,
  person_id   bigint REFERENCES persons(id) ON DELETE CASCADE,
  joined_on   date,
  note        text,
  -- ui — внесён в интерфейсе; импорт — загружен списком (появится позже).
  source      text NOT NULL DEFAULT 'ui' CHECK (source IN ('ui', 'импорт')),
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT group_members_one_ref CHECK ((user_id IS NOT NULL)::int + (request_id IS NOT NULL)::int + (person_id IS NOT NULL)::int = 1)
);
-- Один человек в одной группе один раз (убранные в счёт не идут).
CREATE UNIQUE INDEX group_members_user_uq ON group_members (group_id, user_id) WHERE user_id IS NOT NULL AND archived_at IS NULL;
CREATE UNIQUE INDEX group_members_request_uq ON group_members (group_id, request_id) WHERE request_id IS NOT NULL AND archived_at IS NULL;
CREATE UNIQUE INDEX group_members_person_uq ON group_members (group_id, person_id) WHERE person_id IS NOT NULL AND archived_at IS NULL;
CREATE INDEX group_members_group_idx ON group_members (group_id) WHERE archived_at IS NULL;
