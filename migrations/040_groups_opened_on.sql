-- «Дата открытия» группы: от неё считаются первые четыре месяца, когда группа помечается как новая (росток).
-- У групп, уже лежащих в базе, её нет: открытие неизвестно, поэтому они не считаются новыми (по ним остаётся только
-- пометка «никого нет», если людей в группе нет).
ALTER TABLE groups ADD COLUMN opened_on date;

/*
 * Дату ставит база, чтобы её не забыл ни бот, ни форма, ни перевод статуса:
 *  • группа заведена уже действующей не из выгрузки таблицы (бот, форма) — открыта сегодня;
 *  • группа переведена из «Потенциальной» в любой другой статус — открыта сегодня.
 * Выгрузка таблицы даты не ставит: про сотни старых групп из неё неизвестно, когда они открылись. Заданную вручную дату
 * (в том числе прошлую) база не перезаписывает.
 */
CREATE OR REPLACE FUNCTION groups_set_opened_on() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.opened_on IS NULL AND NEW.status NOT IN ('Потенциальная', 'Закрыта') THEN
    IF TG_OP = 'INSERT' AND NEW.source <> 'таблица' THEN
      NEW.opened_on := current_date;
    ELSIF TG_OP = 'UPDATE' AND OLD.status = 'Потенциальная' THEN
      NEW.opened_on := current_date;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER groups_opened_on BEFORE INSERT OR UPDATE OF status ON groups
  FOR EACH ROW EXECUTE FUNCTION groups_set_opened_on();
