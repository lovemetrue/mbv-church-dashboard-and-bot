-- Родственники: связь между двумя людьми из «Людей».
--
-- Стороны — те же ключи людей, что у метки «Странный человек» и пола (миграции 055, 057): «u12» — регистрация,
-- «p7» — карточка, «r345» — старая заявка без человека. Одна строка на пару людей, видна с обеих сторон.
--
-- kind — кем b_key приходится a_key: spouse (супруг(а)), parent (родитель), sibling (брат/сестра), other (другое).
-- «Ребёнок» отдельно не хранится: «b — ребёнок a» записывается как «a — родитель b», а обратная степень выводится
-- при чтении (родитель ↔ ребёнок, остальные — сами себе). Так у пары не бывает двух противоречащих строк.
--
-- Сама система людей не связывает: подсказки «возможно, родственник» (та же фамилия и тот же адрес или телефон)
-- считаются на лету и связываются только кнопкой служителя.
CREATE TABLE person_relatives (
  id      bigserial PRIMARY KEY,
  a_key   text NOT NULL CHECK (a_key ~ '^[urp][0-9]{1,15}$'),
  b_key   text NOT NULL CHECK (b_key ~ '^[urp][0-9]{1,15}$'),
  kind    text NOT NULL CHECK (kind IN ('spouse', 'parent', 'sibling', 'other')),
  set_by  text NOT NULL,
  set_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (a_key <> b_key)
);
CREATE UNIQUE INDEX person_relatives_pair ON person_relatives (least(a_key, b_key), greatest(a_key, b_key));
CREATE INDEX person_relatives_b ON person_relatives (b_key);

-- Ключ человека сменился (карточка слилась с регистрацией): связи переезжают. Связь, которая после переезда
-- совпала бы с уже существующей или замкнулась бы на самого человека, лишняя — её убираем.
CREATE FUNCTION person_relatives_move(p_old text, p_new text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM person_relatives r
   WHERE (r.a_key = p_old AND r.b_key = p_new) OR (r.a_key = p_new AND r.b_key = p_old);
  DELETE FROM person_relatives r
   WHERE (r.a_key = p_old OR r.b_key = p_old)
     AND EXISTS (
       SELECT 1 FROM person_relatives x
        WHERE x.id <> r.id
          AND least(x.a_key, x.b_key) = least(CASE WHEN r.a_key = p_old THEN p_new ELSE r.a_key END, CASE WHEN r.b_key = p_old THEN p_new ELSE r.b_key END)
          AND greatest(x.a_key, x.b_key) = greatest(CASE WHEN r.a_key = p_old THEN p_new ELSE r.a_key END, CASE WHEN r.b_key = p_old THEN p_new ELSE r.b_key END));
  UPDATE person_relatives SET a_key = p_new WHERE a_key = p_old;
  UPDATE person_relatives SET b_key = p_new WHERE b_key = p_old;
END
$$;

-- Слияние карточки с регистрацией (миграция 059) — то же, плюс родственники и вариант семейного положения
-- (миграция 070): выбор служителя в карточке не теряется, если у регистрации своего нет.
CREATE OR REPLACE FUNCTION merge_card_into_user(p_person bigint, p_user bigint) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE users x SET
    age = coalesce(x.age, p.age), location = coalesce(x.location, p.place),
    address_raw = coalesce(x.address_raw, p.address), schedule_raw = coalesce(x.schedule_raw, p.schedule),
    hobby = coalesce(x.hobby, p.hobby), profession = coalesce(x.profession, p.profession),
    family_status = coalesce(x.family_status, p.family_status), family_kind = coalesce(x.family_kind, p.family_kind),
    admin_comment = coalesce(x.admin_comment, p.note)
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
  PERFORM person_relatives_move('p' || p_person, 'u' || p_user);
  UPDATE persons SET archived_at = now() WHERE id = p_person;
END
$$;
