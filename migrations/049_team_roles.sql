-- Справочник ролей команды. Раньше роль у координатора была свободным текстом («Координатор малых групп»,
-- «Молодёжный координатор»…), а смысл роли угадывался по словам: распределителя для автоназначения искали
-- `LIKE '%распределител%'`, отборы после личного входа — по «старш» и «координатор» в тексте. Опечатка или новое
-- название тихо ломали и то и другое.
--  • team_roles — сами роли. name — как её называют; kind — что роль значит для сервиса:
--      distributor — распределитель: ему автоматически назначаются новые заявки, после входа он видит свои и ничьи;
--      coordinator — координатор групп: после входа видит свои группы и свои обращения «хочу открыть группу»;
--      senior      — старший координатор: видит всё, без отборов;
--      NULL        — роль без особого смысла для сервиса (отборов не ставит).
--  • coordinator_roles — какие роли у человека. Ролей может быть несколько («Координатор малых групп» и
--    «Распределитель» сразу), поэтому это отдельная таблица связей, а не колонка у координатора. Текстовая колонка
--    coordinators.role удаляется: держать оба значения — значит дать им разойтись.
CREATE TABLE team_roles (
  id          bigserial   PRIMARY KEY,
  name        text        NOT NULL CHECK (btrim(name) <> ''),
  kind        text        CHECK (kind IN ('distributor', 'coordinator', 'senior')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- Одно название — одна роль: «Распределитель» и «распределитель » не должны стать двумя.
CREATE UNIQUE INDEX team_roles_name_unique ON team_roles (lower(btrim(name)));

-- Смысл роли по названию — тем же правилом, каким его раньше угадывал интерфейс (`teamKindOf`). Нужен для
-- переноса существующих ролей и для новых названий из таблицы церкви; дальше смысл правят в «Настройках».
CREATE FUNCTION team_role_kind_guess(role_name text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN lower(role_name) LIKE '%распределител%' THEN 'distributor'
    WHEN lower(role_name) LIKE '%старш%' THEN 'senior'
    WHEN lower(role_name) LIKE '%координатор%' THEN 'coordinator'
  END
$$;

-- Роль по названию; нет такой — заводится. Нужна переносу таблицы церкви (`scripts/import-spreadsheet.mjs`) и
-- старому дашборду, где роль по-прежнему вводят словами. Новый интерфейс выбирает роль из справочника.
CREATE FUNCTION team_role_id(role_name text) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  found bigint;
BEGIN
  SELECT id INTO found FROM team_roles WHERE lower(btrim(name)) = lower(btrim(role_name));
  IF found IS NULL THEN
    INSERT INTO team_roles (name, kind) VALUES (btrim(role_name), team_role_kind_guess(role_name))
    ON CONFLICT (lower(btrim(name))) DO NOTHING
    RETURNING id INTO found;
    -- Параллельный вызов успел завести ту же роль: берём его строку.
    IF found IS NULL THEN
      SELECT id INTO found FROM team_roles WHERE lower(btrim(name)) = lower(btrim(role_name));
    END IF;
  END IF;
  RETURN found;
END
$$;

-- Основные роли — сразу, чтобы в форме было из чего выбрать даже на пустой базе. «Катализатор» — роль служения без
-- особого смысла для сервиса: отборов не ставит и заявок не получает (смысл можно задать в «Настройках»).
INSERT INTO team_roles (name, kind) VALUES
  ('Координатор малых групп', 'coordinator'),
  ('Старший координатор', 'senior'),
  ('Распределитель', 'distributor'),
  ('Катализатор', NULL)
ON CONFLICT (lower(btrim(name))) DO NOTHING;

-- Роли человека. Удалить роль, пока она у кого-то есть, база не даст (RESTRICT); удаление человека из базы
-- (а не мягкое, archived_at) уносит и его роли.
CREATE TABLE coordinator_roles (
  coordinator_id bigint NOT NULL REFERENCES coordinators(id) ON DELETE CASCADE,
  role_id        bigint NOT NULL REFERENCES team_roles(id) ON DELETE RESTRICT,
  PRIMARY KEY (coordinator_id, role_id)
);
CREATE INDEX coordinator_roles_role_idx ON coordinator_roles (role_id);

-- Каждое уже записанное название становится ролью (с угаданным смыслом), человек получает на неё ссылку.
-- Удалённые (archived) тоже: строка остаётся в базе, и роль у неё должна быть.
INSERT INTO coordinator_roles (coordinator_id, role_id)
SELECT id, team_role_id(CASE WHEN btrim(role) = '' THEN 'Без роли' ELSE role END) FROM coordinators;

-- Роли человека словами, через запятую, в порядке названий — для показа и для помощника.
CREATE FUNCTION coordinator_role_names(p_coordinator bigint) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT string_agg(r.name, ', ' ORDER BY r.name)
    FROM coordinator_roles cr JOIN team_roles r ON r.id = cr.role_id
   WHERE cr.coordinator_id = p_coordinator
$$;

-- Помощнику роли по-прежнему видны словами. CREATE OR REPLACE с тем же набором столбцов сохраняет права
-- роли assistant_ro; заодно представление перестаёт зависеть от текстовой колонки, и её можно удалить. Роли собраны
-- подзапросом, а не через coordinator_role_names: функция выполнялась бы с правами помощника, а у него нет доступа к
-- таблицам вне схемы assistant; таблицы внутри представления читаются с правами его владельца.
CREATE OR REPLACE VIEW assistant.coordinators AS
SELECT c.id, assistant.name_ref('Координатор', c.name) AS coordinator,
       coalesce((SELECT string_agg(r.name, ', ' ORDER BY r.name)
                   FROM coordinator_roles cr JOIN team_roles r ON r.id = cr.role_id
                  WHERE cr.coordinator_id = c.id), '') AS role
  FROM coordinators c
 WHERE c.archived_at IS NULL;

ALTER TABLE coordinators DROP COLUMN role;
