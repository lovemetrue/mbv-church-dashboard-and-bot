-- Ответственный в заявках записан в таблице церкви как «Имя Фамилия» («Давид Родионов»), а в справочнике координаторов
-- — «Фамилия Имя» («Родионов Давид»). Новый интерфейс сравнивает имена буква в букву, поэтому один человек выглядел
-- двумя: «Команда» делила его нагрузку на две строки, а выбор в «В работе у» добавлял второе написание.
--
-- Приводим `requests.responsible` и `groups.coordinator` к написанию из справочника (действующие координаторы), если
-- совпадает набор слов без учёта порядка, регистра, лишних пробелов и «ё». Кого в справочнике нет, не трогаем: по
-- одному имени фамилию не угадать. Если у одного набора слов в справочнике два написания, неясно, какое верное, —
-- тоже не трогаем.
--
-- Происхождение записи (`таблица` → `ui`) не меняем: это не правка служителя, а приведение написания, и перенос
-- таблицы церкви (`scripts/import-spreadsheet.mjs`) после вставки сам вызывает ту же функцию.

-- Ключ имени: слова по алфавиту, строчными, «ё» как «е». Кириллицу переводим в строчные явно: `lower()` в базе с
-- локалью C трогает только латиницу.
CREATE OR REPLACE FUNCTION person_name_key(name text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT string_agg(w, ' ' ORDER BY w)
    FROM regexp_split_to_table(
           translate(lower(btrim(name)),
                     'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯё',
                     'абвгдеежзийклмнопрстуфхцчшщъыьэюяе'),
           '\s+') AS w
   WHERE w <> ''
$$;

CREATE OR REPLACE FUNCTION normalize_person_names() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  fixed_requests integer;
  fixed_groups integer;
BEGIN
  CREATE TEMP TABLE person_canon ON COMMIT DROP AS
    SELECT person_name_key(name) AS key, min(name) AS name
      FROM coordinators
     WHERE archived_at IS NULL AND person_name_key(name) IS NOT NULL
     GROUP BY 1
    HAVING count(DISTINCT name) = 1;

  UPDATE requests r SET responsible = c.name
    FROM person_canon c
   WHERE r.responsible IS NOT NULL AND person_name_key(r.responsible) = c.key AND r.responsible <> c.name;
  GET DIAGNOSTICS fixed_requests = ROW_COUNT;

  UPDATE groups g SET coordinator = c.name
    FROM person_canon c
   WHERE g.coordinator IS NOT NULL AND person_name_key(g.coordinator) = c.key AND g.coordinator <> c.name;
  GET DIAGNOSTICS fixed_groups = ROW_COUNT;

  DROP TABLE person_canon;
  RETURN fixed_requests + fixed_groups;
END
$$;

SELECT normalize_person_names();
