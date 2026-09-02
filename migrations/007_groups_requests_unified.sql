-- Единый источник правды: выгрузка из таблицы церкви переезжает в базу и живёт
-- рядом с тем, что заводят через бота и через дашборд.
--
-- До этой миграции 116 групп, 233 заявки и координаторы были вшиты в HTML-файл
-- дашборда, а таблица home_groups покрывала только 5 из 19 столбцов листа.

-- ── Группы ───────────────────────────────────────────────────────────────────
-- Имя groups в PostgreSQL незарезервировано, кавычки не нужны.
ALTER TABLE home_groups RENAME TO groups;
ALTER INDEX home_groups_active_idx RENAME TO groups_active_idx;

-- Остальные столбцы листа «МАЛЫЕ ГРУППЫ (2026)».
ALTER TABLE groups
  ADD COLUMN no           int,          -- № в реестре таблицы; у 32 строк его нет
  ADD COLUMN open_to_new  text,
  -- phone хранит запись как в таблице (бывает с именами и несколькими номерами),
  -- phones — разобранные номера в E.164 для ссылок «позвонить».
  ADD COLUMN phones       text[] NOT NULL DEFAULT '{}',
  ADD COLUMN age          text,         -- возрастной диапазон группы, не возраст человека
  ADD COLUMN metro        text,
  ADD COLUMN address      text,         -- в таблице помечен «людям не давать»
  ADD COLUMN composition  text,
  ADD COLUMN day          text,
  ADD COLUMN "time"       text,         -- бывает словом: «День», «Вечер»
  ADD COLUMN coordinator  text,
  ADD COLUMN feedback_at  date,
  ADD COLUMN comment      text,
  ADD COLUMN training     text,
  ADD COLUMN checked      boolean,
  ADD COLUMN source       text;

-- У существующих строк источник один — их завели через бота.
UPDATE groups SET source = 'бот' WHERE source IS NULL;
ALTER TABLE groups
  ALTER COLUMN source SET NOT NULL,
  ADD CONSTRAINT groups_source_check CHECK (source IN ('таблица', 'бот', 'ui'));

-- У импортированных строк служителя нет: их никто не заводил в боте.
ALTER TABLE groups
  ALTER COLUMN added_by DROP NOT NULL,
  ALTER COLUMN added_platform DROP NOT NULL;

CREATE INDEX groups_source_idx ON groups (source);

-- ── Заявки ───────────────────────────────────────────────────────────────────
-- У строки из листа ЗАЯВКИ нет участника в боте, поэтому имя и телефон
-- хранятся в самой заявке, а user_id перестаёт быть обязательным.
ALTER TABLE requests ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE requests
  ADD COLUMN fio            text,
  ADD COLUMN phone          text,
  ADD COLUMN phones         text[] NOT NULL DEFAULT '{}',
  ADD COLUMN age            text,
  ADD COLUMN place          text,      -- метро или район, свободный текст
  ADD COLUMN responsible    text,
  ADD COLUMN source         text,      -- откуда пришла заявка
  ADD COLUMN ministry       text,
  ADD COLUMN note           text,
  ADD COLUMN extra          text,
  ADD COLUMN recommended    text,
  ADD COLUMN recommended_at date,
  ADD COLUMN final_group    text,
  ADD COLUMN cancel_reason  text,
  ADD COLUMN attendance     text,
  ADD COLUMN requested_at   date,      -- дата заявки из листа; created_at — дата записи
  ADD COLUMN origin         text;

UPDATE requests SET origin = 'бот' WHERE origin IS NULL;
ALTER TABLE requests
  ALTER COLUMN origin SET NOT NULL,
  -- Обычный источник новых заявок — бот; дашборд и импорт указывают своё явно.
  ALTER COLUMN origin SET DEFAULT 'бот',
  ADD CONSTRAINT requests_origin_check CHECK (origin IN ('таблица', 'бот', 'ui')),
  -- Заявка без участника обязана нести хотя бы имя, иначе она ни о ком.
  ADD CONSTRAINT requests_has_person_check CHECK (user_id IS NOT NULL OR fio IS NOT NULL);

-- Единый домен статусов. В базе было два машинных значения, в листе — шесть
-- человеческих; сводим к одному набору, чтобы заявка бота и заявка из листа
-- велись одинаково. «Не указан» оставляем: в листе такие две строки.
ALTER TABLE requests DROP CONSTRAINT requests_status_check;
UPDATE requests SET status = CASE status
  WHEN 'new'    THEN 'Новая'
  WHEN 'closed' THEN 'Исполнена'
  ELSE status
END;
ALTER TABLE requests
  ALTER COLUMN status SET DEFAULT 'Новая',
  ADD CONSTRAINT requests_status_check CHECK (status IN (
    'Новая', 'В ожидании', 'В работе', 'На контроле', 'Исполнена', 'Аннулирована', 'Не указан'
  ));

-- Открытой считается заявка, которую ещё не исполнили и не аннулировали.
DROP INDEX requests_open_by_user_idx;
CREATE INDEX requests_open_by_user_idx ON requests (user_id, type)
  WHERE status NOT IN ('Исполнена', 'Аннулирована');
CREATE INDEX requests_responsible_idx ON requests (responsible) WHERE responsible IS NOT NULL;

-- ── Координаторы ─────────────────────────────────────────────────────────────
CREATE TABLE coordinators (
  id          bigserial   PRIMARY KEY,
  name        text        NOT NULL,
  role        text        NOT NULL,
  source      text        NOT NULL DEFAULT 'таблица',
  created_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE INDEX coordinators_active_idx ON coordinators (name) WHERE archived_at IS NULL;
