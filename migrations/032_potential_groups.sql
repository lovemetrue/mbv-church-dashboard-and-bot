-- «Потенциальные» группы: человек, который хочет открыть группу или дать дом, сразу попадает в справочник групп со статусом
-- «Потенциальная». Раньше такие заявки лежали только среди «Других обращений», и будущие ведущие не были видны в общем
-- списке групп. Группа привязана к заявке (source_request_id) и к регистрации человека (leader_user_id, миграция 030).
-- «Потенциальная» не входит в статусы, которые принимают людей, поэтому в подбор такая группа не попадает, пока её не
-- переведут в «Функционирует».
ALTER TABLE groups ADD COLUMN source_request_id bigint REFERENCES requests(id) ON DELETE SET NULL;
-- Одна группа на одну заявку: повторный вызов ничего не создаёт.
CREATE UNIQUE INDEX groups_source_request_uq ON groups (source_request_id) WHERE source_request_id IS NOT NULL;

/*
 * Заводит потенциальную группу по заявке «хочу открыть» и возвращает её номер (или null, если заводить не нужно).
 * Не заводит, если: заявка не того вида или уже закрыта; для неё группа уже есть; этот человек уже ведущий какой-то
 * группы (по ссылке на регистрацию или по телефону). Район определяется по основе названия в месте, как в расчёте
 * подбора; не нашёлся — «Не указан», координатор поправит. Адрес и телефон ведущего в комментарий не копируются:
 * телефон лежит в поле группы, адреса у заявки в справочник не идут.
 */
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

  INSERT INTO groups (leader, phone, phones, district, format, status, source, comment, leader_user_id, source_request_id, added_by)
  VALUES (coalesce(nullif(btrim(r.fio), ''), 'Без имени'), r.phone, CASE WHEN r.phone IS NULL THEN '{}'::text[] ELSE ARRAY[r.phone] END,
          coalesce(v_district, 'Не указан'), 'Основная церковь', 'Потенциальная',
          CASE WHEN r.origin = 'бот' THEN 'бот' ELSE 'ui' END, v_comment, r.user_id, p_request, 'заявка «хочу открыть»')
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Уже накопившиеся открытые заявки «хочу открыть» (скрипт работает по каждой отдельно и ничего не дублирует).
SELECT ensure_potential_group(id) FROM requests WHERE type = 'lead_group' AND archived_at IS NULL ORDER BY id;
