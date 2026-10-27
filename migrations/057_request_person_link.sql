-- Заявка ссылается на человека из «Людей», а не хранит его данные у себя.
--
-- «Люди» — сквозной справочник: ФИО, телефон, возраст, район, адрес, удобное время, хобби, профессия, семья живут
-- в записи человека — регистрации (users) или карточке (persons). Раньше заявка без регистрации (из таблицы церкви,
-- из формы) держала их в себе, а заявка с регистрацией — копии поверх неё, которые код переписывал при правке; любой
-- путь мимо этого кода — и данные расходились. Метка «Странный человек», пол и состав группы ссылались на заявку
-- ключом r<номер> вместо человека.
--
-- Теперь у каждой заявки есть человек: user_id (регистрация) или person_id (карточка). Поля человека в самой заявке
-- (fio, phone, phones, age, place, hobby, profession, family_status) остаются снимком «как пришла» — их больше не
-- правят и текущие данные из них не берут. Правка координатора улицы и времени (manual_street, manual_schedule)
-- переносится в человека: это его адрес и его удобное время, а не свойство заявки.
--
-- Людей склеиваем по телефону (последние десять цифр): ровно одно совпадение среди регистраций и карточек — он,
-- иначе своя карточка. Тёзок и общие номера не угадываем.
ALTER TABLE requests
  ADD COLUMN person_id bigint REFERENCES persons(id) ON DELETE SET NULL,
  ADD CONSTRAINT requests_one_person CHECK (user_id IS NULL OR person_id IS NULL);
CREATE INDEX requests_person_idx ON requests (person_id) WHERE person_id IS NOT NULL;

-- Последние десять цифр номера; короче — не номер.
CREATE FUNCTION person_phone_key(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN length(d) >= 10 THEN right(d, 10) END FROM (SELECT regexp_replace(coalesce(p, ''), '\D', '', 'g') AS d) x
$$;

-- Пустые поля человека дополняются из заявки, заполненные не трогаются; правка координатора (улица, время) — главнее.
CREATE FUNCTION request_fill_person(p_request bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  r requests;
BEGIN
  SELECT * INTO r FROM requests WHERE id = p_request;
  IF r.user_id IS NOT NULL THEN
    UPDATE users SET
      phone = coalesce(phone, r.phone, r.phones[1]),
      age = coalesce(age, r.age), location = coalesce(location, r.place),
      hobby = coalesce(hobby, r.hobby), profession = coalesce(profession, r.profession), family_status = coalesce(family_status, r.family_status),
      address_raw = coalesce(r.manual_street, address_raw), schedule_raw = coalesce(r.manual_schedule, schedule_raw)
     WHERE id = r.user_id;
  ELSIF r.person_id IS NOT NULL THEN
    UPDATE persons SET
      phone = coalesce(phone, r.phones[1], r.phone),
      age = coalesce(age, r.age), place = coalesce(place, r.place),
      hobby = coalesce(hobby, r.hobby), profession = coalesce(profession, r.profession), family_status = coalesce(family_status, r.family_status),
      address = coalesce(r.manual_street, address), schedule = coalesce(r.manual_schedule, schedule)
     WHERE id = r.person_id;
  END IF;
END
$$;

-- Человек для заявки без него: по телефону (ровно одно совпадение) или новая карточка из данных заявки.
-- Удалённой заявке карточку не заводим: её человека в «Людях» не было и появляться ему незачем.
CREATE FUNCTION request_link_person(p_request bigint) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  r requests;
  k text;
  n int;
  v_user bigint;
  v_person bigint;
BEGIN
  SELECT * INTO r FROM requests WHERE id = p_request FOR UPDATE;
  IF NOT FOUND OR r.user_id IS NOT NULL OR r.person_id IS NOT NULL THEN RETURN false; END IF;
  SELECT person_phone_key(x) INTO k FROM unnest(coalesce(r.phones, '{}') || ARRAY[r.phone]) AS x WHERE person_phone_key(x) IS NOT NULL LIMIT 1;
  IF k IS NOT NULL THEN
    SELECT count(*) INTO n FROM (
      SELECT 1 FROM users u WHERE u.registration_no IS NOT NULL AND person_phone_key(u.phone) = k
      UNION ALL
      SELECT 1 FROM persons p WHERE p.archived_at IS NULL AND person_phone_key(p.phone) = k
    ) m;
    IF n = 1 THEN
      SELECT u.id INTO v_user FROM users u WHERE u.registration_no IS NOT NULL AND person_phone_key(u.phone) = k;
      IF v_user IS NULL THEN
        SELECT p.id INTO v_person FROM persons p WHERE p.archived_at IS NULL AND person_phone_key(p.phone) = k;
      END IF;
    END IF;
  END IF;
  IF v_user IS NULL AND v_person IS NULL THEN
    IF r.archived_at IS NOT NULL THEN RETURN false; END IF;
    INSERT INTO persons (full_name, phone, created_by)
    VALUES (coalesce(nullif(btrim(r.fio), ''), 'Без имени'), coalesce(r.phones[1], r.phone), 'заявка')
    RETURNING id INTO v_person;
  END IF;
  UPDATE requests SET user_id = v_user, person_id = v_person WHERE id = p_request;
  PERFORM request_fill_person(p_request);
  RETURN true;
END
$$;

-- Перенос уже заведённых: человек каждой заявке, затем ключи r<номер> (метка, пол, состав группы) — на человека.
CREATE FUNCTION link_unlinked_requests() RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  q record;
  linked integer := 0;
  new_key text;
BEGIN
  -- Правка координатора у заявок с регистрацией — в регистрацию (свежая заявка последней, её правка и остаётся).
  FOR q IN SELECT id FROM requests WHERE user_id IS NOT NULL AND (manual_street IS NOT NULL OR manual_schedule IS NOT NULL
             OR hobby IS NOT NULL OR profession IS NOT NULL OR family_status IS NOT NULL) ORDER BY id LOOP
    PERFORM request_fill_person(q.id);
  END LOOP;

  FOR q IN SELECT id FROM requests WHERE user_id IS NULL AND person_id IS NULL ORDER BY id LOOP
    IF request_link_person(q.id) THEN linked := linked + 1; END IF;
  END LOOP;

  FOR q IN SELECT r.id, CASE WHEN r.user_id IS NOT NULL THEN 'u' || r.user_id ELSE 'p' || r.person_id END AS key
             FROM requests r WHERE r.user_id IS NOT NULL OR r.person_id IS NOT NULL LOOP
    new_key := q.key;
    IF EXISTS (SELECT 1 FROM strange_marks WHERE person_key = 'r' || q.id) THEN
      INSERT INTO strange_marks (person_key, note, set_by, set_at)
        SELECT new_key, note, set_by, set_at FROM strange_marks WHERE person_key = 'r' || q.id
      ON CONFLICT (person_key) DO NOTHING;
      DELETE FROM strange_marks WHERE person_key = 'r' || q.id;
    END IF;
    IF EXISTS (SELECT 1 FROM person_genders WHERE person_key = 'r' || q.id) THEN
      INSERT INTO person_genders (person_key, gender, set_by, set_at)
        SELECT new_key, gender, set_by, set_at FROM person_genders WHERE person_key = 'r' || q.id
      ON CONFLICT (person_key) DO NOTHING;
      DELETE FROM person_genders WHERE person_key = 'r' || q.id;
    END IF;
  END LOOP;

  -- Состав: внесённый «по заявке» становится внесённым по человеку. Если этот человек уже в той же группе — запись
  -- по заявке лишняя, её убираем (мягко, как всё в составе).
  UPDATE group_members m SET archived_at = now()
    FROM requests r
   WHERE m.request_id = r.id AND m.archived_at IS NULL
     AND EXISTS (SELECT 1 FROM group_members x WHERE x.group_id = m.group_id AND x.archived_at IS NULL AND x.id <> m.id
                  AND ((r.user_id IS NOT NULL AND x.user_id = r.user_id) OR (r.person_id IS NOT NULL AND x.person_id = r.person_id)));
  UPDATE group_members m SET user_id = r.user_id, person_id = r.person_id, request_id = NULL
    FROM requests r
   WHERE m.request_id = r.id AND (r.user_id IS NOT NULL OR r.person_id IS NOT NULL);
  RETURN linked;
END
$$;
SELECT link_unlinked_requests();

-- Новая заявка без человека (перенос таблицы церкви, форма, старый дашборд) получает его сразу.
CREATE FUNCTION requests_link_person() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.user_id IS NULL AND NEW.person_id IS NULL THEN PERFORM request_link_person(NEW.id); END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER requests_link_person AFTER INSERT ON requests FOR EACH ROW EXECUTE FUNCTION requests_link_person();

-- Заявку удалили (дубль, заведена по ошибке): карточка, заведённая только ради неё и больше ни к чему не привязанная
-- (других заявок, состава, групп, команды нет), уходит вместе с ней — так раньше пропадал «человек из заявки». Человек,
-- у которого есть что-то ещё, остаётся: «Люди» — общий справочник, удаление заявки его не стирает.
CREATE FUNCTION requests_archive_orphan_person() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.person_id IS NOT NULL THEN
    UPDATE persons p SET archived_at = now()
     WHERE p.id = NEW.person_id AND p.archived_at IS NULL AND p.created_by = 'заявка'
       AND NOT EXISTS (SELECT 1 FROM requests r WHERE r.person_id = p.id AND r.archived_at IS NULL)
       AND NOT EXISTS (SELECT 1 FROM group_members m WHERE m.person_id = p.id AND m.archived_at IS NULL)
       AND NOT EXISTS (SELECT 1 FROM groups g WHERE g.archived_at IS NULL AND (g.leader_person_id = p.id OR g.co_leader_person_id = p.id))
       AND NOT EXISTS (SELECT 1 FROM coordinators c WHERE c.person_id = p.id AND c.archived_at IS NULL);
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER requests_archive_orphan_person AFTER UPDATE OF archived_at ON requests
  FOR EACH ROW WHEN (OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL) EXECUTE FUNCTION requests_archive_orphan_person();

-- Ведущие групп из таблицы церкви: имя и телефон записаны текстом. Каждому — человек (по телефону — ровно одно
-- совпадение, иначе карточка с его именем и телефоном), как у ведущих, выбранных в правке группы (миграция 054).
-- Пару в одной строке («Елена и Сергей Н.») не связываем: её разбивают на двух людей в правке группы.
CREATE FUNCTION group_leader_person(p_name text, p_phone text, OUT o_user bigint, OUT o_person bigint) LANGUAGE plpgsql AS $$
DECLARE
  k text := person_phone_key(p_phone);
  n int;
BEGIN
  IF btrim(coalesce(p_name, '')) = '' OR p_name ~* '(\s(и|&)\s|,|/|\+)' THEN RETURN; END IF;
  IF k IS NOT NULL THEN
    SELECT count(*) INTO n FROM (
      SELECT 1 FROM users u WHERE u.registration_no IS NOT NULL AND person_phone_key(u.phone) = k
      UNION ALL SELECT 1 FROM persons p WHERE p.archived_at IS NULL AND person_phone_key(p.phone) = k
    ) m;
    IF n = 1 THEN
      SELECT u.id INTO o_user FROM users u WHERE u.registration_no IS NOT NULL AND person_phone_key(u.phone) = k;
      IF o_user IS NULL THEN SELECT p.id INTO o_person FROM persons p WHERE p.archived_at IS NULL AND person_phone_key(p.phone) = k; END IF;
      RETURN;
    END IF;
  END IF;
  INSERT INTO persons (full_name, phone, created_by) VALUES (btrim(p_name), p_phone, 'группа') RETURNING id INTO o_person;
END
$$;

CREATE FUNCTION link_unlinked_group_leaders() RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  g record;
  found record;
  linked integer := 0;
BEGIN
  FOR g IN SELECT id, leader, phone, co_leader, co_leader_phone, leader_user_id, leader_person_id, co_leader_user_id, co_leader_person_id
             FROM groups WHERE archived_at IS NULL ORDER BY id LOOP
    IF g.leader_user_id IS NULL AND g.leader_person_id IS NULL THEN
      SELECT * INTO found FROM group_leader_person(g.leader, g.phone);
      IF found.o_user IS NOT NULL OR found.o_person IS NOT NULL THEN
        -- Один человек на обеих позициях — это опечатка таблицы: соведущего тогда не трогаем.
        UPDATE groups SET leader_user_id = found.o_user, leader_person_id = found.o_person WHERE id = g.id;
        linked := linked + 1;
      END IF;
    END IF;
    IF g.co_leader_user_id IS NULL AND g.co_leader_person_id IS NULL AND btrim(coalesce(g.co_leader, '')) <> '' THEN
      SELECT * INTO found FROM group_leader_person(g.co_leader, g.co_leader_phone);
      IF (found.o_user IS NOT NULL OR found.o_person IS NOT NULL) AND NOT EXISTS (
        SELECT 1 FROM groups x WHERE x.id = g.id AND ((found.o_user IS NOT NULL AND x.leader_user_id = found.o_user) OR (found.o_person IS NOT NULL AND x.leader_person_id = found.o_person))
      ) THEN
        UPDATE groups SET co_leader_user_id = found.o_user, co_leader_person_id = found.o_person WHERE id = g.id;
        linked := linked + 1;
      END IF;
    END IF;
  END LOOP;
  RETURN linked;
END
$$;
SELECT link_unlinked_group_leaders();

-- Помощник видит данные человека, а не снимок заявки.
CREATE OR REPLACE VIEW assistant.requests AS
SELECT r.id, r.user_id,
       coalesce('Участник-' || u.registration_no, 'Заявитель-' || r.id) AS person,
       r.type, r.status, r.origin,
       assistant.phone_mask(coalesce(u.phone, p.phone, r.phone)) AS phone_masked, assistant.phone_key(coalesce(u.phone, p.phone, r.phone)) AS phone_key,
       coalesce(u.age, p.age, r.age) AS age, coalesce(u.location, p.place, r.place) AS place, assistant.name_ref('Координатор', r.responsible) AS responsible,
       r.source, r.ministry, r.recommended, r.final_group, r.group_id, r.cancel_reason, r.attendance,
       r.callback AS needs_call,
       coalesce(r.requested_at, r.created_at::date) AS request_date,
       (current_date - coalesce(r.requested_at, r.created_at::date)) AS waiting_days
  FROM requests r
  LEFT JOIN users u ON u.id = r.user_id AND u.registration_no IS NOT NULL
  LEFT JOIN persons p ON p.id = r.person_id
 WHERE r.archived_at IS NULL;
