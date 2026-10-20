-- Две просьбы служителей к карточке группы.
--
-- 1. Из «Состава» убраны «Семейная», «Служение» и «Приватная»: «Служение» и «Приватная (Закрытая)» — это формат
--    группы, а не состав, и стояли дважды. Где они записаны, ставим «Смешанная» (повторы убираем, порядок — как в
--    списке `COMPOSITIONS` из `src/core/groups.ts`, неизвестные значения — в конце).
-- 2. Поле «Приём новых» убрано из интерфейса. Его «НЕТ» означало то же, что отметка «Не направлять», поэтому
--    переводим: `do_not_refer = true`, а `open_to_new` очищаем — иначе группа осталась бы закрытой для подбора и
--    после снятия «Не направлять», а поправить «Приём новых» уже негде. «ДА» и «По требованию» не трогаем.
--
-- Происхождение записи не меняем: перенос таблицы церкви (`scripts/import-spreadsheet.mjs`) после вставки вызывает
-- ту же функцию. Кириллицу сравниваем без `lower()`/`upper()`: в базе с локалью C они трогают только латиницу.
CREATE OR REPLACE FUNCTION normalize_group_fields() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  fixed integer;
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
  RETURN fixed;
END
$$;

SELECT normalize_group_fields();
