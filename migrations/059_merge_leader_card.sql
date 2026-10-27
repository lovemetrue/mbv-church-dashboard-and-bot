-- Карточка человека сливается с регистрацией того же человека не только по телефону при регистрации (миграция 057),
-- но и при разборе «уже веду группу». Ведущим групп из таблицы церкви миграция 057 завела карточки (created_by =
-- 'группа'); человек потом сам пишет боту «я веду группу», и разбор видел у группы «другого ведущего» — свою же
-- карточку — и отказывал. Теперь разбор, убедившись, что карточка — этот же человек (те же ФИО и не чужой телефон, см. card_is_user),
-- сливает её с регистрацией: всё, что ссылалось на карточку, переезжает, пустые поля дополняются, карточка уходит.
--
-- merge_card_into_user — само слияние, без выбора карточки; merge_person_into_user (057) теперь вызывает его же. Заодно
-- переезжает и ссылка пользователя дашборда на человека (staff.person_id, миграция 058), которой в 057 ещё не было.
CREATE FUNCTION merge_card_into_user(p_person bigint, p_user bigint) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE users x SET
    age = coalesce(x.age, p.age), location = coalesce(x.location, p.place),
    address_raw = coalesce(x.address_raw, p.address), schedule_raw = coalesce(x.schedule_raw, p.schedule),
    hobby = coalesce(x.hobby, p.hobby), profession = coalesce(x.profession, p.profession),
    family_status = coalesce(x.family_status, p.family_status), admin_comment = coalesce(x.admin_comment, p.note)
    FROM persons p WHERE x.id = p_user AND p.id = p_person;

  UPDATE requests SET user_id = p_user, person_id = NULL WHERE person_id = p_person;
  -- Состав: уже состоит в той же группе как регистрация — запись по карточке лишняя.
  UPDATE group_members m SET archived_at = now()
   WHERE m.person_id = p_person AND m.archived_at IS NULL
     AND EXISTS (SELECT 1 FROM group_members x WHERE x.group_id = m.group_id AND x.user_id = p_user AND x.archived_at IS NULL);
  UPDATE group_members SET user_id = p_user, person_id = NULL WHERE person_id = p_person AND archived_at IS NULL;
  UPDATE groups SET leader_user_id = p_user, leader_person_id = NULL WHERE leader_person_id = p_person AND leader_user_id IS NULL;
  UPDATE groups SET co_leader_user_id = p_user, co_leader_person_id = NULL WHERE co_leader_person_id = p_person AND co_leader_user_id IS NULL;
  IF NOT EXISTS (SELECT 1 FROM coordinators WHERE user_id = p_user AND archived_at IS NULL) THEN
    UPDATE coordinators SET user_id = p_user, person_id = NULL WHERE person_id = p_person;
  END IF;
  UPDATE staff SET user_id = p_user, person_id = NULL WHERE person_id = p_person;
  INSERT INTO strange_marks (person_key, note, set_by, set_at)
    SELECT 'u' || p_user, note, set_by, set_at FROM strange_marks WHERE person_key = 'p' || p_person
  ON CONFLICT (person_key) DO NOTHING;
  DELETE FROM strange_marks WHERE person_key = 'p' || p_person;
  INSERT INTO person_genders (person_key, gender, set_by, set_at)
    SELECT 'u' || p_user, gender, set_by, set_at FROM person_genders WHERE person_key = 'p' || p_person
  ON CONFLICT (person_key) DO NOTHING;
  DELETE FROM person_genders WHERE person_key = 'p' || p_person;
  UPDATE persons SET archived_at = now() WHERE id = p_person;
END
$$;

-- Карточка и регистрация — один человек: те же ФИО (порядок слов и «ё» не важны, см. 045), а отчество, записанное
-- только в одной из них, не мешает — таблица его часто не записывала. Одного телефона мало: номер бывает общий у семьи,
-- и карточка ведущего «Олейник Иаков» слилась бы с регистрацией его жены с тем же номером. Двух слов хватает, одного нет.
CREATE FUNCTION same_person_name(a text, b text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT x IS NOT NULL AND y IS NOT NULL AND least(cardinality(x), cardinality(y)) >= 2 AND (x <@ y OR y <@ x)
    FROM (SELECT string_to_array(person_name_key(a), ' ') AS x, string_to_array(person_name_key(b), ' ') AS y) w
$$;

-- Слияние при регистрации (057) шло по одному телефону: жена, зарегистрировавшаяся с номером мужа, забирала себе его
-- карточку — его группу, состав, заявки. Теперь и здесь нужны те же ФИО.
CREATE OR REPLACE FUNCTION merge_person_into_user(p_user bigint) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  u users;
  k text;
  pid bigint;
  n int;
BEGIN
  SELECT * INTO u FROM users WHERE id = p_user;
  IF NOT FOUND OR u.registration_no IS NULL THEN RETURN false; END IF;
  k := person_phone_key(u.phone);
  IF k IS NULL THEN RETURN false; END IF;
  SELECT count(*) INTO n FROM users x WHERE x.registration_no IS NOT NULL AND x.id <> p_user AND person_phone_key(x.phone) = k;
  IF n > 0 THEN RETURN false; END IF;
  SELECT count(*), min(id) INTO n, pid FROM persons WHERE archived_at IS NULL AND person_phone_key(phone) = k;
  IF n <> 1 THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM persons WHERE id = pid AND same_person_name(full_name, u.full_name)) THEN RETURN false; END IF;
  PERFORM merge_card_into_user(pid, p_user);
  RETURN true;
END
$$;

-- Разбор: карточка на позиции ведущего — этот же человек, если ФИО те же, а телефон у карточки тот же или не записан.
-- Другой номер при тех же ФИО — однофамилец: его не трогаем.
CREATE FUNCTION card_is_user(p_person bigint, p_user bigint) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM persons p, users u
     WHERE p.id = p_person AND u.id = p_user AND p.archived_at IS NULL AND same_person_name(p.full_name, u.full_name)
       AND (person_phone_key(p.phone) IS NULL OR person_phone_key(p.phone) = person_phone_key(u.phone))
  )
$$;

-- Уже заведённые карточки ведущих групп из таблицы, у которых есть регистрация того же человека (ровно одна: тот же
-- телефон и те же ФИО), сливаются с ней сразу: иначе в «Людях» он двоится, а разбор упирался бы в карточку.
CREATE FUNCTION merge_leader_cards() RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  r record;
  merged integer := 0;
BEGIN
  FOR r IN
    SELECT p.id AS person_id, min(u.id) AS user_id
      FROM persons p
      JOIN users u ON u.registration_no IS NOT NULL
                  AND person_phone_key(u.phone) = person_phone_key(p.phone)
                  AND same_person_name(u.full_name, p.full_name)
     WHERE p.archived_at IS NULL AND p.created_by = 'группа' AND person_phone_key(p.phone) IS NOT NULL
     GROUP BY p.id HAVING count(*) = 1
  LOOP
    PERFORM merge_card_into_user(r.person_id, r.user_id);
    merged := merged + 1;
  END LOOP;
  RETURN merged;
END
$$;
SELECT merge_leader_cards();
