-- Две просьбы служителей.
--
-- 1. Статус «Кампания» убран. Он означал «действующая группа, но работает только на время кампании» — это отметка,
--    а не отдельный статус: из-за него группу не находили в отборе «Функционирует». Новая колонка `campaign_only`
--    («Работает только в кампанию»); группы со статусом «Кампания» становятся «Функционирует» с этой отметкой.
-- 2. У потенциальных групп «40 дней» (`campaign_registered`) по умолчанию включено. Существующим потенциальным —
--    всем, кроме удалённых, — проставляем сейчас; снять можно в «Править».
--
-- Обе правки входят в `normalize_group_fields()` (её вызывает перенос таблицы церкви), функция переопределяется
-- целиком: часть из миграции 046 — без изменений.
ALTER TABLE groups ADD COLUMN campaign_only boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION normalize_group_fields() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  fixed integer;
  more integer;
BEGIN
  WITH parts AS (
    SELECT g.id,
           CASE WHEN btrim(x) IN ('Семейная', 'семейная', 'Служение', 'служение', 'Приватная', 'приватная')
                THEN 'Смешанная' ELSE btrim(x) END AS item,
           ord
      FROM groups g, unnest(string_to_array(g.composition, ',')) WITH ORDINALITY AS u(x, ord)
     WHERE btrim(x) <> ''
  ), composed AS (
    SELECT id,
           string_agg(item, ', ' ORDER BY array_position(ARRAY['Смешанная', 'Мужская', 'Женская', 'Ментальная'], item) NULLS LAST, first_ord) AS composition
      FROM (SELECT id, item, min(ord) AS first_ord FROM parts GROUP BY id, item) d
     GROUP BY id
  )
  UPDATE groups g
     SET composition = COALESCE(c.composition, g.composition),
         do_not_refer = g.do_not_refer OR btrim(COALESCE(g.open_to_new, '')) IN ('НЕТ', 'Нет', 'нет'),
         open_to_new = CASE WHEN btrim(COALESCE(g.open_to_new, '')) IN ('НЕТ', 'Нет', 'нет') THEN NULL ELSE g.open_to_new END
    FROM groups g0
    LEFT JOIN composed c ON c.id = g0.id
   WHERE g.id = g0.id
     AND (c.composition IS DISTINCT FROM g0.composition AND c.composition IS NOT NULL
          OR btrim(COALESCE(g0.open_to_new, '')) IN ('НЕТ', 'Нет', 'нет'));
  GET DIAGNOSTICS fixed = ROW_COUNT;

  -- 047: «Кампания» — не статус, а отметка «Работает только в кампанию» у действующей группы.
  UPDATE groups SET status = 'Функционирует', campaign_only = true WHERE status = 'Кампания';
  GET DIAGNOSTICS more = ROW_COUNT;
  fixed := fixed + more;

  -- 047: потенциальная группа по умолчанию участвует в «40 днях». Только у перенесённых из таблицы: у правленых в
  -- интерфейсе (source 'ui') галочку мог снять служитель, и перенос таблицы не должен ставить её обратно.
  UPDATE groups SET campaign_registered = true
   WHERE status = 'Потенциальная' AND source = 'таблица' AND archived_at IS NULL AND NOT campaign_registered;
  GET DIAGNOSTICS more = ROW_COUNT;
  RETURN fixed + more;
END
$$;

SELECT normalize_group_fields();

-- Разово: всем текущим потенциальным, а не только перенесённым из таблицы (функция выше трогает лишь их).
UPDATE groups SET campaign_registered = true
 WHERE status = 'Потенциальная' AND archived_at IS NULL AND NOT campaign_registered;

-- Помощнику — новая отметка в конце представления (так CREATE OR REPLACE сохраняет права роли assistant_ro).
CREATE OR REPLACE VIEW assistant.groups AS
SELECT id, 'ДГ-' || lpad(id::text, 4, '0') AS code, no,
       assistant.name_ref('Ведущий', leader) AS leader,
       assistant.phone_key(phone) AS leader_phone_key,
       assistant.name_ref('Ведущий', co_leader) AS co_leader,
       district, metro, assistant.clean(address) AS address, status, open_to_new, age, composition, day, "time",
       people, assistant.name_ref('Координатор', coordinator) AS coordinator, feedback_at, (current_date - feedback_at) AS days_since_feedback,
       training, format, checked, campaign_registered, do_not_refer, source, capacity, campaign_only
  FROM groups
 WHERE archived_at IS NULL;
