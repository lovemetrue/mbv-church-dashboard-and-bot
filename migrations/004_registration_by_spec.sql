-- Переход на сценарий из ТЗ: согласие на обработку ПД, ФИО целиком, церковь МБВ,
-- четыре варианта по малой домашней группе, номер регистрации и выдача набора.

-- ФИО теперь одно поле: в ТЗ это один пункт, а разбор на фамилию и имя
-- давал перепутанные значения, когда человек писал имя первым.
ALTER TABLE users ADD COLUMN full_name text;
UPDATE users SET full_name = nullif(trim(coalesce(last_name, '') || ' ' || coalesce(first_name, '')), '');
ALTER TABLE users DROP COLUMN last_name, DROP COLUMN first_name;

-- Локация вместо метро: ТЗ просит улицу и дом.
ALTER TABLE users RENAME COLUMN metro TO location;

-- in_small_group был да/нет, теперь у человека одно из четырёх состояний по МДГ.
ALTER TABLE users DROP COLUMN in_small_group;

ALTER TABLE users
  ADD COLUMN church            text,   -- филиал МБВ, другая церковь или «не посещаю»
  ADD COLUMN mdg_status        text CHECK (mdg_status IN ('open', 'join', 'member', 'leader')),
  ADD COLUMN companions        text,   -- с кем будет посещать МДГ
  ADD COLUMN leader_name       text,   -- ФИО ведущего, если человек уже в группе
  ADD COLUMN consent_at        timestamptz,
  -- Номер регистрации, он же номер на QR-коде для выдачи набора.
  ADD COLUMN registration_no   int UNIQUE,
  -- Анкета доведена до конца или завершена досрочно (ТЗ разрешает выйти в любой момент).
  ADD COLUMN complete          boolean NOT NULL DEFAULT false,
  -- Кто регистрировал: NULL это сам участник, иначе id служителя.
  ADD COLUMN registered_by     text,
  ADD COLUMN preferred_contact text CHECK (preferred_contact IN ('telegram', 'max', 'call')),
  ADD COLUMN admin_comment     text,
  ADD COLUMN kit_issued_at     timestamptz,
  ADD COLUMN kit_issued_by     text;

-- Номера регистрации выдаём последовательностью: так они не повторятся при одновременных анкетах.
CREATE SEQUENCE registration_no_seq START 1;

CREATE INDEX users_registration_no_idx ON users (registration_no) WHERE registration_no IS NOT NULL;
CREATE INDEX users_full_name_idx ON users (lower(full_name));
