-- Семейное положение — выбор, а не только свободный текст.
--
-- family_status — как написал человек боту или внёс координатор («женат, двое детей»): его не трогаем и показываем
-- подсказкой. Рядом — family_kind: каноничный вариант 'single' (холост / не замужем), 'married' (женат / замужем) или
-- NULL (не указано). Он живёт в записи человека — регистрации (users) и карточке (persons); у заявки поля нет: её
-- family_status — снимок «как пришла» (миграция 057), а вариант читается у её человека.
--
-- Распознавание текста — family_kind_of(). Такое же правило есть в коде (src/core/family.ts, familyKindOf), обе
-- проверяет одна таблица примеров. Триггер раскладывает текст при каждой записи: ответ бота, правку старого
-- дашборда, слияние карточки с регистрацией — бот и старый дашборд о варианте не знают. Выбор служителя главнее:
-- если в той же правке поменялся сам family_kind, триггер его не перетирает; новый текст без выбора — распознаётся заново.
--
-- Файл можно прогнать повторно (тест так проверяет бэкфилл): IF NOT EXISTS, OR REPLACE, DROP … IF EXISTS.

CREATE OR REPLACE FUNCTION family_kind_of(p text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  -- lower() при локали C кириллицу не опускает, поэтому — translate.
  t text := btrim(regexp_replace(
    translate(lower(coalesce(p, '')), 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯё', 'абвгдеежзийклмнопрстуфхцчшщъыьэюяе'),
    '\s+', ' ', 'g'));
  -- Границы слова — вручную, как в коде: «муж» в «мужчина» не считается.
  neg constant text := '(?<![а-яa-z])(не\s+(был\s+|была\s+)?(женат[а-я]*|замужем|в\s+браке)|без\s+(мужа|жены|супруг[а-я]*))(?![а-яa-z])';
  single_re constant text := '(?<![а-яa-z])(холост[а-я]*|одинок[а-я]*|свободн[а-я]*|свободен|развед[а-я]*|развод[а-я]*|вдов[а-я]*)(?![а-яa-z])';
  married_re constant text := '(?<![а-яa-z])(женат[а-я]*|замужем|замужн[а-я]*|в\s+браке|супруг[а-я]*|муж|мужа|мужем|жена|жены|женой|венчан[а-я]*)(?![а-яa-z])';
  rest text;
  is_single boolean;
  is_married boolean;
BEGIN
  IF t = '' THEN RETURN NULL; END IF;
  is_single := t ~ neg;
  rest := regexp_replace(t, neg, ' ', 'g');
  is_single := is_single OR rest ~ single_re;
  is_married := rest ~ married_re;
  IF is_single = is_married THEN RETURN NULL; END IF;
  RETURN CASE WHEN is_single THEN 'single' ELSE 'married' END;
END
$$;

ALTER TABLE users   ADD COLUMN IF NOT EXISTS family_kind text CHECK (family_kind IN ('single', 'married'));
ALTER TABLE persons ADD COLUMN IF NOT EXISTS family_kind text CHECK (family_kind IN ('single', 'married'));

CREATE OR REPLACE FUNCTION family_kind_follow() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.family_kind IS NULL THEN NEW.family_kind := family_kind_of(NEW.family_status); END IF;
  ELSIF NEW.family_status IS DISTINCT FROM OLD.family_status AND NEW.family_kind IS NOT DISTINCT FROM OLD.family_kind THEN
    NEW.family_kind := family_kind_of(NEW.family_status);
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS users_family_kind ON users;
CREATE TRIGGER users_family_kind BEFORE INSERT OR UPDATE OF family_status, family_kind ON users
  FOR EACH ROW EXECUTE FUNCTION family_kind_follow();
DROP TRIGGER IF EXISTS persons_family_kind ON persons;
CREATE TRIGGER persons_family_kind BEFORE INSERT OR UPDATE OF family_status, family_kind ON persons
  FOR EACH ROW EXECUTE FUNCTION family_kind_follow();

-- Старые ответы. Уже выбранное (повторный прогон) не трогаем.
UPDATE users   SET family_kind = family_kind_of(family_status) WHERE family_kind IS NULL AND family_status IS NOT NULL;
UPDATE persons SET family_kind = family_kind_of(family_status) WHERE family_kind IS NULL AND family_status IS NOT NULL;
