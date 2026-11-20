-- Возраст группы — набор категорий анкеты (`AGE_GROUPS` в src/core/texts.ts): «подростки (до 18 лет)», «18-25»,
-- «25-40», «40-55», «55-65», «65+». В интерфейсе он отмечается галочками и пишется через запятую в порядке анкеты:
-- «25-40, 40-55». У старых групп стоят диапазоны таблицы церкви, которых среди категорий нет («35-50», «50-60»):
-- форма с галочками их бы не показала. Переводим их в набор категорий, которые диапазон задевает: «35-50» →
-- «25-40, 40-55». Правило — то же, что у колонок матрицы «район × возраст» и у `groupAgeCategories`
-- (src/home-groups/plan/parse.ts): касание в одной цифре не считается («40-55» — только «40-55»), одно число — в
-- категорию этого числа (25 — «18-25»). «Любой», пусто и мусор не трогаем: возраст неизвестен.
--
-- Происхождение записи (`source`) не меняем: это перевод записи, а не правка служителя. Чтобы повторный перенос
-- таблицы не возвращал «35-50», та же нормализация входит в `normalize_group_fields()` — её вызывает перенос.
-- Функция переопределяется целиком: части из миграций 046 и 047 — без изменений.
-- Идемпотентно: каноничная запись остаётся как есть.

CREATE OR REPLACE FUNCTION group_age_categories(raw text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  labels CONSTANT text[] := ARRAY['подростки (до 18 лет)', '18-25', '25-40', '40-55', '55-65', '65+'];
  -- Края категорий для диапазона группы: общая цифра принадлежит обеим соседним, поэтому края смыкаются.
  edge_lo CONSTANT int[] := ARRAY[0, 18, 25, 40, 55, 65];
  edge_hi CONSTANT int[] := ARRAY[18, 25, 40, 55, 65, 121];
  -- Границы для одного числа (как у человека): цифра на стыке — нижней категории.
  one_lo CONSTANT int[] := ARRAY[0, 18, 26, 41, 56, 66];
  one_hi CONSTANT int[] := ARRAY[17, 25, 40, 55, 65, 120];
  parts text[];
  s text;
  m text[];
  lo int;
  hi int;
  picked text[] := ARRAY[]::text[];
BEGIN
  SELECT array_agg(btrim(p)) INTO parts FROM unnest(string_to_array(COALESCE(raw, ''), ',')) AS p WHERE btrim(p) <> '';
  IF parts IS NULL THEN RETURN NULL; END IF;
  -- Уже категории (в любом порядке) — пишем в порядке анкеты.
  IF parts <@ labels THEN
    SELECT array_agg(l ORDER BY i) INTO picked FROM unnest(labels) WITH ORDINALITY AS u(l, i) WHERE l = ANY (parts);
    RETURN array_to_string(picked, ', ');
  END IF;

  -- Разбор — как `ageRange` в src/core/matching.ts.
  s := regexp_replace(lower(raw), 'лет|года?|\s', '', 'g');
  IF s LIKE '%подрост%' THEN
    lo := 12; hi := 17;
  ELSIF s ~ '^\d{1,3}[-–—]\d{1,3}$' THEN
    m := regexp_match(s, '^(\d{1,3})[-–—](\d{1,3})$');
    lo := m[1]::int; hi := m[2]::int;
  ELSIF s ~ '^\d{1,3}\+$' THEN
    lo := (regexp_match(s, '^(\d{1,3})'))[1]::int; hi := 120;
  ELSIF s ~ '^\d+([.,]\d+)?$' THEN
    lo := floor(replace(s, ',', '.')::numeric)::int; hi := lo;
  ELSE
    RETURN NULL;
  END IF;

  FOR i IN 1..6 LOOP
    IF lo = hi THEN
      IF (lo BETWEEN one_lo[i] AND one_hi[i]) OR (i = 6 AND lo > 120) THEN picked := picked || labels[i]; END IF;
    ELSIF lo < edge_hi[i] AND edge_lo[i] < hi THEN
      picked := picked || labels[i];
    END IF;
  END LOOP;
  IF cardinality(picked) = 0 THEN RETURN NULL; END IF;
  RETURN array_to_string(picked, ', ');
END
$$;

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
  fixed := fixed + more;

  -- 068: возраст — набор категорий анкеты («35-50» → «25-40, 40-55»). Неразборчивое («любой») — как было.
  UPDATE groups SET age = group_age_categories(age)
   WHERE group_age_categories(age) IS NOT NULL AND group_age_categories(age) IS DISTINCT FROM age;
  GET DIAGNOSTICS more = ROW_COUNT;
  RETURN fixed + more;
END
$$;

UPDATE groups SET age = group_age_categories(age)
 WHERE group_age_categories(age) IS NOT NULL AND group_age_categories(age) IS DISTINCT FROM age;
