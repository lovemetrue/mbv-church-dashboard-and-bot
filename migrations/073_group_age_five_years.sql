-- Возраст группы — набор пятилеток (`GROUP_AGE_BUCKETS` в src/core/texts.ts): «подростки (до 18 лет)», «18-20»,
-- «21-25», «26-30», «31-35», «36-40», «41-45», «46-50», «51-55», «56-60», «61-64», «65+». У старых групп стоят
-- широкие категории анкеты («25-40», «40-55», в том числе списком «25-40, 40-55») и диапазоны таблицы церкви
-- («35-50»), которых среди пятилеток нет: форма с галочками их бы не показала. Переводим их в набор пятилеток,
-- которые диапазон задевает.
--
-- Правило — включительное пересечение, то же, что у `groupAgeCategories` (src/home-groups/plan/parse.ts):
-- граничные возраста не теряются, а диапазон расширяется до полной пятилетки («25-40» → «21-40»). Сужение опаснее:
-- оно молча выкинуло бы подходящих людей из подбора. Диапазоны не пересекаются, поэтому задвоения возраста нет.
-- Список через запятую раскладывается по частям: «25-40, 40-55» → «21-25, 26-30, 31-35, 36-40, 41-45, 46-50, 51-55».
--
-- «Любой», пусто и мусор не трогаем: возраст неизвестен. Происхождение записи (`source`) не меняем: это перевод
-- записи, а не правка служителя. Чтобы повторный перенос таблицы не возвращал «25-40», та же нормализация входит в
-- `normalize_group_fields()` — её вызывает перенос. Функция `group_age_categories` переопределяется целиком
-- (прежняя, с широкими категориями, — в миграции 068); `normalize_group_fields` пересоздаём с тем же телом, что и в
-- 068, чтобы перенос таблицы и дальше приводил возраст к канону — теперь пятилеткам.
-- Идемпотентно: каноничная запись (уже пятилетки) остаётся как есть.

CREATE OR REPLACE FUNCTION group_age_categories(raw text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  labels CONSTANT text[] := ARRAY[
    'подростки (до 18 лет)', '18-20', '21-25', '26-30', '31-35', '36-40',
    '41-45', '46-50', '51-55', '56-60', '61-64', '65+'
  ];
  -- Включительные границы тех же пятилеток (как GROUP_AGE_RANGES в src/home-groups/plan/parse.ts).
  lo_edge CONSTANT int[] := ARRAY[0, 18, 21, 26, 31, 36, 41, 46, 51, 56, 61, 65];
  hi_edge CONSTANT int[] := ARRAY[17, 20, 25, 30, 35, 40, 45, 50, 55, 60, 64, 120];
  parts text[];
  picked boolean[] := ARRAY_FILL(false, ARRAY[12]);
  part text;
  s text;
  m text[];
  lo int;
  hi int;
  i int;
  out_parts text[];
BEGIN
  SELECT array_agg(btrim(p)) INTO parts FROM unnest(string_to_array(COALESCE(raw, ''), ',')) AS p WHERE btrim(p) <> '';
  IF parts IS NULL THEN RETURN NULL; END IF;
  -- Уже пятилетки (в любом порядке) — пишем в порядке анкеты.
  IF parts <@ labels THEN
    SELECT array_agg(l ORDER BY ord) INTO out_parts FROM unnest(labels) WITH ORDINALITY AS u(l, ord) WHERE l = ANY (parts);
    RETURN array_to_string(out_parts, ', ');
  END IF;

  -- Иначе каждую часть (пятилетку, старую категорию или диапазон) раскладываем в пятилетки, которые она задевает.
  FOREACH part IN ARRAY parts LOOP
    -- Разбор — как `ageRange` в src/core/matching.ts.
    s := regexp_replace(lower(part), 'лет|года?|\s', '', 'g');
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
      CONTINUE; -- «любой», мусор — не знаем, пропускаем.
    END IF;

    -- Включительное пересечение: часть задевает пятилетку, если lo <= hi_edge[i] и lo_edge[i] <= hi.
    FOR i IN 1..12 LOOP
      IF lo <= hi_edge[i] AND lo_edge[i] <= hi THEN picked[i] := true; END IF;
    END LOOP;
  END LOOP;

  SELECT array_agg(l ORDER BY ord) INTO out_parts FROM unnest(labels) WITH ORDINALITY AS u(l, ord) WHERE picked[ord];
  IF out_parts IS NULL THEN RETURN NULL; END IF;
  RETURN array_to_string(out_parts, ', ');
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

  -- 073: возраст — набор пятилеток («35-50» → «31-35, 36-40, 41-45, 46-50»). Неразборчивое («любой») — как было.
  UPDATE groups SET age = group_age_categories(age)
   WHERE group_age_categories(age) IS NOT NULL AND group_age_categories(age) IS DISTINCT FROM age;
  GET DIAGNOSTICS more = ROW_COUNT;
  RETURN fixed + more;
END
$$;

UPDATE groups SET age = group_age_categories(age)
 WHERE group_age_categories(age) IS NOT NULL AND group_age_categories(age) IS DISTINCT FROM age;
