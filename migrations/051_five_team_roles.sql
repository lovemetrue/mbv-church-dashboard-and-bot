-- Роли команды сводятся к пяти: Катализатор, Старший распределитель, Распределитель, Старший координатор, Координатор.
-- Остальные названия («Координатор малых групп», «Молодёжный координатор», роли из таблицы церкви) переносятся на одну
-- из пяти по смыслу и удаляются. У катализатора и старшего распределителя появляется свой смысл (kind): по нему, а не
-- по названию, сервис решает, кто видит контакты камерных групп и что человек видит сразу после входа.
-- Миграция повторяемая: тест гоняет её ещё раз на уже перенесённой базе.

ALTER TABLE team_roles DROP CONSTRAINT IF EXISTS team_roles_kind_check;
ALTER TABLE team_roles ADD CONSTRAINT team_roles_kind_check
  CHECK (kind IN ('catalyst', 'senior_distributor', 'distributor', 'senior', 'coordinator'));

-- Смысл по названию: «старший распределитель» проверяется раньше «распределителя» и «старшего».
CREATE OR REPLACE FUNCTION team_role_kind_guess(role_name text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN lower(role_name) LIKE '%катализ%' THEN 'catalyst'
    WHEN lower(role_name) LIKE '%старш%' AND lower(role_name) LIKE '%распределител%' THEN 'senior_distributor'
    WHEN lower(role_name) LIKE '%распределител%' THEN 'distributor'
    WHEN lower(role_name) LIKE '%старш%' THEN 'senior'
    WHEN lower(role_name) LIKE '%координатор%' THEN 'coordinator'
  END
$$;

-- Одна из пяти ролей по смыслу; без смысла — «Координатор»: так в таблице церкви записаны почти все.
CREATE OR REPLACE FUNCTION team_role_canonical(role_kind text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE role_kind
    WHEN 'catalyst' THEN 'Катализатор'
    WHEN 'senior_distributor' THEN 'Старший распределитель'
    WHEN 'distributor' THEN 'Распределитель'
    WHEN 'senior' THEN 'Старший координатор'
    ELSE 'Координатор'
  END
$$;

-- «Координатор малых групп» становится просто «Координатором» (если такого ещё нет), а не заводится вторая роль.
UPDATE team_roles SET name = 'Координатор'
 WHERE lower(btrim(name)) = 'координатор малых групп'
   AND NOT EXISTS (SELECT 1 FROM team_roles WHERE lower(btrim(name)) = 'координатор');

INSERT INTO team_roles (name, kind) VALUES
  ('Катализатор', 'catalyst'),
  ('Старший распределитель', 'senior_distributor'),
  ('Распределитель', 'distributor'),
  ('Старший координатор', 'senior'),
  ('Координатор', 'coordinator')
ON CONFLICT (lower(btrim(name))) DO NOTHING;
UPDATE team_roles r SET kind = v.kind
  FROM (VALUES ('катализатор', 'catalyst'), ('старший распределитель', 'senior_distributor'), ('распределитель', 'distributor'),
               ('старший координатор', 'senior'), ('координатор', 'coordinator')) AS v(name, kind)
 WHERE lower(btrim(r.name)) = v.name;

-- Люди с лишними ролями получают роль из пяти: по смыслу роли, а где его нет — по названию.
CREATE TEMP TABLE role_move ON COMMIT DROP AS
SELECT r.id AS old_id, t.id AS new_id
  FROM team_roles r
  JOIN team_roles t ON lower(t.name) = lower(team_role_canonical(coalesce(r.kind, team_role_kind_guess(r.name))))
 WHERE lower(btrim(r.name)) NOT IN ('катализатор', 'старший распределитель', 'распределитель', 'старший координатор', 'координатор');

INSERT INTO coordinator_roles (coordinator_id, role_id)
SELECT cr.coordinator_id, m.new_id FROM coordinator_roles cr JOIN role_move m ON m.old_id = cr.role_id
ON CONFLICT DO NOTHING;
DELETE FROM coordinator_roles WHERE role_id IN (SELECT old_id FROM role_move);
DELETE FROM team_roles WHERE id IN (SELECT old_id FROM role_move);

-- Роль по названию для переноса таблицы церкви и старого дашборда. Раньше незнакомое название заводило новую роль, и
-- лишние роли вернулись бы с первым же переносом; теперь оно ложится на одну из пяти по смыслу.
CREATE OR REPLACE FUNCTION team_role_id(role_name text) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  found bigint;
  target text;
BEGIN
  SELECT id INTO found FROM team_roles WHERE lower(btrim(name)) = lower(btrim(role_name));
  IF found IS NOT NULL THEN
    RETURN found;
  END IF;
  target := team_role_canonical(team_role_kind_guess(role_name));
  SELECT id INTO found FROM team_roles WHERE lower(btrim(name)) = lower(target);
  IF found IS NULL THEN
    -- Роль из пяти удалили в «Настройках»: заводим её снова, а не роняем перенос.
    INSERT INTO team_roles (name, kind) VALUES (target, team_role_kind_guess(target))
    ON CONFLICT (lower(btrim(name))) DO NOTHING
    RETURNING id INTO found;
    IF found IS NULL THEN
      SELECT id INTO found FROM team_roles WHERE lower(btrim(name)) = lower(target);
    END IF;
  END IF;
  RETURN found;
END
$$;
