-- Заявка «хочу открыть группу» (lead_group) живёт, пока её группа потенциальная: по ней звонят и ищут людей. Группу,
-- заведённую по заявке (groups.source_request_id, миграция 032), перевели в рабочий статус — заявка сделала своё и
-- закрывается («Исполнена», group_id — эта группа). Без этого в «Хотят открыть группу» висели открытыми люди, которые
-- уже ведут свою группу. Триггер, а не код сервиса: статус меняют и правка группы, и перенос таблицы, и старый дашборд.
-- Закрытые и аннулированные заявки не трогаем; вернуть заявку в работу можно как обычно.
CREATE FUNCTION close_lead_request(p_group bigint) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  n integer;
BEGIN
  UPDATE requests r SET status = 'Исполнена', group_id = g.id, callback = false, handled_at = coalesce(r.handled_at, now())
    FROM groups g
   WHERE g.id = p_group AND g.archived_at IS NULL AND g.status <> 'Потенциальная'
     AND r.id = g.source_request_id AND r.type = 'lead_group' AND r.archived_at IS NULL
     AND r.status NOT IN ('Исполнена', 'Аннулирована');
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;

CREATE FUNCTION groups_close_lead_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source_request_id IS NOT NULL THEN PERFORM close_lead_request(NEW.id); END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER groups_close_lead_request AFTER INSERT OR UPDATE OF status, source_request_id ON groups
  FOR EACH ROW EXECUTE FUNCTION groups_close_lead_request();

CREATE FUNCTION close_lead_requests_of_running_groups() RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  g record;
  closed integer := 0;
BEGIN
  FOR g IN SELECT id FROM groups WHERE source_request_id IS NOT NULL AND archived_at IS NULL AND status <> 'Потенциальная' LOOP
    closed := closed + close_lead_request(g.id);
  END LOOP;
  RETURN closed;
END
$$;
SELECT close_lead_requests_of_running_groups();
