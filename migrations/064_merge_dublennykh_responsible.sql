-- «В работе у» у заявок и «Координатор» у групп — имя участника команды строкой, и оно же ключ связи (CLAUDE.md, 056).
-- У части записей, перенесённых из таблицы церкви, имя записано не так, как в справочнике команды: «Дубленых Дмитрий»
-- вместо «Дублённых Дмитрий Владимирович». Такое имя — «фантом»: в отборе «В работе у» оно стоит отдельным человеком, а
-- его заявки и группы не считаются заявками настоящего координатора (ни «мои», ни контакты).
-- Разовая чистка одного человека — Дублённых Дмитрия (у остальных дублей нет, общую чистку решили не делать): все его
-- написания сливаются в имя из справочника. Написание узнаём по ключу: «ё» как «е», двойная буква как одинарная, без
-- учёта регистра и пробелов, по фамилии и имени (отчество в справочнике есть, в записи — нет). Если в справочнике с этим
-- ключом не ровно один участник команды — не трогаем. Переписанные из таблицы записи становятся «ui», как после правки в
-- интерфейсе: повторный перенос таблицы не вернёт им старое имя.
CREATE TEMP TABLE team_name_fix ON COMMIT DROP AS
WITH coords AS (
  SELECT name,
         array_to_string((regexp_split_to_array(
           regexp_replace(regexp_replace(lower(translate(btrim(name), 'Ёё', 'ее')), '\s+', ' ', 'g'), '(.)\1+', '\1', 'g'), ' '))[1:2], ' ') AS k
    FROM coordinators WHERE archived_at IS NULL
),
uniq AS (SELECT k, min(name) AS name FROM coords WHERE k = 'дубленых дмитрий' GROUP BY k HAVING count(*) = 1),
stale AS (
  SELECT DISTINCT v AS old FROM (
    SELECT responsible AS v FROM requests WHERE responsible IS NOT NULL
    UNION SELECT coordinator FROM groups WHERE coordinator IS NOT NULL
  ) x
  WHERE btrim(v) <> '' AND v NOT IN (SELECT name FROM coordinators WHERE archived_at IS NULL)
)
SELECT s.old, u.name AS new
  FROM stale s
  JOIN uniq u ON u.k = array_to_string((regexp_split_to_array(
         regexp_replace(regexp_replace(lower(translate(btrim(s.old), 'Ёё', 'ее')), '\s+', ' ', 'g'), '(.)\1+', '\1', 'g'), ' '))[1:2], ' ');

UPDATE requests r
   SET responsible = f.new,
       origin = CASE WHEN r.origin = 'таблица' THEN 'ui' ELSE r.origin END
  FROM team_name_fix f
 WHERE r.responsible = f.old;

UPDATE groups g
   SET coordinator = f.new,
       source = CASE WHEN g.source = 'таблица' THEN 'ui' ELSE g.source END
  FROM team_name_fix f
 WHERE g.coordinator = f.old;
