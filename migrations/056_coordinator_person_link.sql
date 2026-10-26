-- Участник команды («Координаторы»: координатор, распределитель, катализатор…) — ссылка на человека из «Людей», как
-- ведущий и соведущий группы (миграции 030 и 054). «Люди» — сквозной справочник всех, кто имеет отношение к церкви,
-- и служения ссылаются на него, а не держат свои копии имён и телефонов.
--
-- Имя в coordinators.name остаётся: им записаны «в работе у» заявок (requests.responsible) и координатор групп
-- (groups.coordinator), по нему сверяют вход и роли. Чтобы данные не разъехались, имя следует за человеком: правка ФИО
-- в «Людях» переписывает имя участника команды, а с ним заявки и группы (триггер ниже, та же цепочка, что у
-- переименования в форме координатора — CoordinatorsRepo.rename).
ALTER TABLE coordinators
  ADD COLUMN user_id   bigint REFERENCES users(id)   ON DELETE SET NULL,
  ADD COLUMN person_id bigint REFERENCES persons(id) ON DELETE SET NULL,
  ADD CONSTRAINT coordinators_one_ref CHECK (user_id IS NULL OR person_id IS NULL);

-- Один человек — одна строка в команде (ролей у неё сколько угодно, см. coordinator_roles).
CREATE UNIQUE INDEX coordinators_user_unique   ON coordinators (user_id)   WHERE user_id IS NOT NULL AND archived_at IS NULL;
CREATE UNIQUE INDEX coordinators_person_unique ON coordinators (person_id) WHERE person_id IS NOT NULL AND archived_at IS NULL;

-- ФИО сравниваются ключом person_name_key (миграция 045): порядок слов, регистр, «ё» и пробелы не важны.

-- Человек для участника команды по имени: ровно одно совпадение ФИО среди регистраций и карточек — он; ни одного
-- или несколько (тёзки) — новая карточка с этим именем. Угадывать между тёзками нельзя: в команду попал бы чужой
-- человек. Карточку потом можно сменить в форме координатора («Сменить»).
CREATE FUNCTION coordinator_person_for(p_name text, OUT o_user_id bigint, OUT o_person_id bigint) LANGUAGE plpgsql AS $$
DECLARE
  k text := person_name_key(p_name);
  n int;
BEGIN
  SELECT count(*) INTO n FROM (
    SELECT 1 FROM users u WHERE u.registration_no IS NOT NULL AND person_name_key(u.full_name) = k
    UNION ALL
    SELECT 1 FROM persons p WHERE p.archived_at IS NULL AND person_name_key(p.full_name) = k
  ) m;
  IF k IS NOT NULL AND n = 1 THEN
    SELECT u.id INTO o_user_id FROM users u WHERE u.registration_no IS NOT NULL AND person_name_key(u.full_name) = k;
    IF o_user_id IS NULL THEN
      SELECT p.id INTO o_person_id FROM persons p WHERE p.archived_at IS NULL AND person_name_key(p.full_name) = k;
    END IF;
  ELSE
    INSERT INTO persons (full_name, created_by) VALUES (btrim(p_name), 'команда') RETURNING id INTO o_person_id;
  END IF;
END
$$;

-- Привязка уже заведённых. Тот, кого уже взял другой участник команды (два участника с одним именем), получает
-- свою карточку: уникальный индекс не даст двоим ссылаться на одного.
CREATE FUNCTION link_unlinked_coordinators() RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  c record;
  found record;
  linked integer := 0;
BEGIN
  FOR c IN SELECT id, name FROM coordinators WHERE archived_at IS NULL AND user_id IS NULL AND person_id IS NULL ORDER BY id LOOP
    SELECT * INTO found FROM coordinator_person_for(c.name);
    IF found.o_user_id IS NOT NULL AND EXISTS (SELECT 1 FROM coordinators x WHERE x.user_id = found.o_user_id AND x.archived_at IS NULL)
       OR found.o_person_id IS NOT NULL AND EXISTS (SELECT 1 FROM coordinators x WHERE x.person_id = found.o_person_id AND x.archived_at IS NULL) THEN
      INSERT INTO persons (full_name, created_by) VALUES (btrim(c.name), 'команда') RETURNING id INTO found.o_person_id;
      found.o_user_id := NULL;
    END IF;
    UPDATE coordinators SET user_id = found.o_user_id, person_id = found.o_person_id WHERE id = c.id;
    linked := linked + 1;
  END LOOP;
  RETURN linked;
END
$$;
SELECT link_unlinked_coordinators();

-- Заведённый по имени (перенос таблицы церкви, старый дашборд) сразу получает человека — так же, как при привязке выше.
CREATE FUNCTION coordinators_link_person() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  found record;
BEGIN
  IF NEW.user_id IS NULL AND NEW.person_id IS NULL THEN
    SELECT * INTO found FROM coordinator_person_for(NEW.name);
    IF found.o_user_id IS NOT NULL AND EXISTS (SELECT 1 FROM coordinators x WHERE x.user_id = found.o_user_id AND x.archived_at IS NULL)
       OR found.o_person_id IS NOT NULL AND EXISTS (SELECT 1 FROM coordinators x WHERE x.person_id = found.o_person_id AND x.archived_at IS NULL) THEN
      INSERT INTO persons (full_name, created_by) VALUES (btrim(NEW.name), 'команда') RETURNING id INTO found.o_person_id;
      found.o_user_id := NULL;
    END IF;
    NEW.user_id := found.o_user_id;
    NEW.person_id := found.o_person_id;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER coordinators_link_person BEFORE INSERT ON coordinators FOR EACH ROW EXECUTE FUNCTION coordinators_link_person();

-- Имя участника команды следует за ФИО человека: вместе с ним переписываются «в работе у» заявок и координатор групп.
CREATE FUNCTION coordinator_follow_name(p_coordinator bigint, p_name text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  old text;
  fresh text := btrim(p_name);
BEGIN
  SELECT name INTO old FROM coordinators WHERE id = p_coordinator AND archived_at IS NULL FOR UPDATE;
  IF old IS NULL OR fresh = '' OR old = fresh THEN RETURN; END IF;
  UPDATE coordinators SET name = fresh, source = CASE WHEN source = 'таблица' THEN 'ui' ELSE source END WHERE id = p_coordinator;
  UPDATE requests SET responsible = fresh WHERE responsible = old;
  UPDATE groups SET coordinator = fresh WHERE coordinator = old;
END
$$;

CREATE FUNCTION users_rename_coordinator() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  cid bigint;
BEGIN
  FOR cid IN SELECT id FROM coordinators WHERE user_id = NEW.id AND archived_at IS NULL LOOP
    PERFORM coordinator_follow_name(cid, NEW.full_name);
  END LOOP;
  RETURN NULL;
END
$$;
CREATE TRIGGER users_rename_coordinator AFTER UPDATE OF full_name ON users
  FOR EACH ROW WHEN (NEW.full_name IS DISTINCT FROM OLD.full_name) EXECUTE FUNCTION users_rename_coordinator();

CREATE FUNCTION persons_rename_coordinator() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  cid bigint;
BEGIN
  FOR cid IN SELECT id FROM coordinators WHERE person_id = NEW.id AND archived_at IS NULL LOOP
    PERFORM coordinator_follow_name(cid, NEW.full_name);
  END LOOP;
  RETURN NULL;
END
$$;
CREATE TRIGGER persons_rename_coordinator AFTER UPDATE OF full_name ON persons
  FOR EACH ROW WHEN (NEW.full_name IS DISTINCT FROM OLD.full_name) EXECUTE FUNCTION persons_rename_coordinator();
