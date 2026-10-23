-- «Формат группы» становится «Направлением» — справочником, как роли команды: «Основное служение», «Подростковое
-- служение», «Молодёжное служение» и филиалы («Филиал «Серебристый»»). Новые филиалы добавляют в «Настройки →
-- Направления». Слово «служение» для поля не годится: в церкви так зовут прославление, службу порядка и т. п., а здесь —
-- зона ответственности.
--
-- Прежние «Приватная (Закрытая)» и «Служение» — не направление, а вид группы: домашняя группа служителей или отдельного
-- служения. Для неё отметка `chamber` («Камерная группа»): людей туда не направляют, а адрес и телефоны видят только
-- лидеры (катализатор, старший координатор), ответственный координатор и полный вход. Направление у таких групп —
-- «Основное служение»; поправить его можно в карточке.

CREATE TABLE group_directions (
  id          bigserial   PRIMARY KEY,
  name        text        NOT NULL CHECK (btrim(name) <> ''),
  position    integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX group_directions_name_unique ON group_directions (lower(btrim(name)));

INSERT INTO group_directions (name, position) VALUES
  ('Основное служение', 1),
  ('Подростковое служение', 2),
  ('Молодёжное служение', 3),
  ('Филиал «Серебристый»', 4);

-- Направление по умолчанию — первое в списке: его получают группы, заведённые без направления (потенциальная группа
-- из заявки «хочу открыть», перенос таблицы церкви со старым словом).
CREATE FUNCTION group_direction_default() RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT id FROM group_directions ORDER BY position, id LIMIT 1
$$;

-- Направление по названию: для переноса таблицы церкви и старого дашборда, где оно пишется словами. Прежние слова
-- формата ложатся на новые направления; незнакомое — на основное (новое направление словами не заводится: филиалы
-- добавляют в «Настройках»).
CREATE FUNCTION group_direction_id(direction_name text) RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    (SELECT id FROM group_directions WHERE lower(btrim(name)) = lower(btrim(direction_name))),
    (SELECT id FROM group_directions
      WHERE lower(btrim(direction_name)) IN ('молодежная', 'молодёжная') AND name = 'Молодёжное служение'),
    group_direction_default()
  )
$$;

ALTER TABLE groups ADD COLUMN direction_id bigint REFERENCES group_directions(id) ON DELETE RESTRICT;
ALTER TABLE groups ADD COLUMN chamber boolean NOT NULL DEFAULT false;
UPDATE groups SET direction_id = group_direction_id(format),
                  chamber = lower(btrim(format)) IN ('приватная (закрытая)', 'служение');
ALTER TABLE groups ALTER COLUMN direction_id SET DEFAULT group_direction_default();
ALTER TABLE groups ALTER COLUMN direction_id SET NOT NULL;
CREATE INDEX groups_direction_idx ON groups (direction_id);

-- Помощнику: столбец format остаётся (CREATE OR REPLACE сохраняет права роли assistant_ro), но в нём теперь
-- направление; камерная отметка — в конце. Адрес камерной группы помощнику не отдаётся: чат открыт любому входу.
CREATE OR REPLACE VIEW assistant.groups AS
SELECT g.id, 'ДГ-' || lpad(g.id::text, 4, '0') AS code, g.no,
       assistant.name_ref('Ведущий', g.leader) AS leader,
       assistant.phone_key(g.phone) AS leader_phone_key,
       assistant.name_ref('Ведущий', g.co_leader) AS co_leader,
       g.district, g.metro, CASE WHEN g.chamber THEN NULL ELSE assistant.clean(g.address) END AS address, g.status, g.open_to_new,
       g.age, g.composition, g.day, g."time",
       g.people, assistant.name_ref('Координатор', g.coordinator) AS coordinator, g.feedback_at, (current_date - g.feedback_at) AS days_since_feedback,
       g.training, d.name AS format, g.checked, g.campaign_registered, g.do_not_refer, g.source, g.capacity, g.campaign_only,
       g.chamber
  FROM groups g JOIN group_directions d ON d.id = g.direction_id
 WHERE g.archived_at IS NULL;

-- Потенциальная группа из заявки «хочу открыть» заводится без формата: направление ставит значение по умолчанию.
CREATE OR REPLACE FUNCTION ensure_potential_group(p_request bigint) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE
  r record;
  v_id bigint;
  v_digits text;
  v_district text;
  v_comment text;
BEGIN
  SELECT q.id, q.user_id, q.type, q.status, q.origin,
         coalesce(q.fio, u.full_name) AS fio, coalesce(q.phone, u.phone) AS phone,
         coalesce(q.place, u.location) AS place, u.mdg_status, coalesce(u.schedule_raw, '') AS schedule
    INTO r
    FROM requests q LEFT JOIN users u ON u.id = q.user_id
   WHERE q.id = p_request AND q.archived_at IS NULL;
  IF NOT FOUND OR r.type <> 'lead_group' OR r.status IN ('Исполнена', 'Аннулирована') THEN RETURN NULL; END IF;

  SELECT id INTO v_id FROM groups WHERE source_request_id = p_request;
  IF FOUND THEN RETURN v_id; END IF;

  -- Уже ведёт группу: по ссылке на регистрацию…
  IF r.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM groups WHERE leader_user_id = r.user_id AND archived_at IS NULL) THEN RETURN NULL; END IF;
  -- …и по телефону (последние десять цифр) среди телефонов ведущих.
  v_digits := right(regexp_replace(coalesce(r.phone, ''), '\D', '', 'g'), 10);
  IF length(v_digits) = 10 AND EXISTS (
    SELECT 1 FROM groups g, unnest(g.phones || ARRAY[g.co_leader_phone]) AS p(phone)
     WHERE g.archived_at IS NULL AND g.status <> 'Закрыта' AND right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 10) = v_digits
  ) THEN RETURN NULL; END IF;
  -- Второй раз «хочу открыть» от того же человека: группа уже заведена по прежней заявке.
  IF r.user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM groups g JOIN requests q2 ON q2.id = g.source_request_id WHERE q2.user_id = r.user_id AND g.archived_at IS NULL
  ) THEN RETURN NULL; END IF;

  SELECT d INTO v_district
    FROM unnest(ARRAY['Приморский','Выборгский','Центральный','Калининский','Невский','Красногвардейский','Красносельский','Пушкинский',
                      'Адмиралтейский','Василеостровский','Кировский','Московский','Фрунзенский','Петроградский','Петродворцовый',
                      'Колпинский','Кронштадтский','Курортный']) WITH ORDINALITY AS t(d, n)
   WHERE r.place IS NOT NULL AND lower(r.place) LIKE '%' || lower(left(d, length(d) - 2)) || '%'
   ORDER BY n LIMIT 1;

  v_comment := 'Из заявки «' || CASE WHEN r.mdg_status = 'home' THEN 'дам дом' ELSE 'хочу открыть группу' END || '»'
    || CASE WHEN r.place IS NOT NULL AND btrim(r.place) <> '' THEN '. Место: ' || btrim(r.place) ELSE '' END
    || CASE WHEN btrim(r.schedule) <> '' THEN '. Удобное время: ' || btrim(r.schedule) ELSE '' END || '.';

  INSERT INTO groups (leader, phone, phones, district, status, source, comment, leader_user_id, source_request_id, added_by)
  VALUES (coalesce(nullif(btrim(r.fio), ''), 'Без имени'), r.phone, CASE WHEN r.phone IS NULL THEN '{}'::text[] ELSE ARRAY[r.phone] END,
          coalesce(v_district, 'Не указан'), 'Потенциальная',
          CASE WHEN r.origin = 'бот' THEN 'бот' ELSE 'ui' END, v_comment, r.user_id, p_request, 'заявка «хочу открыть»')
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

ALTER TABLE groups DROP COLUMN format;
