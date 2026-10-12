-- Ответы бота про удобное время и адрес не доезжали до потенциальных групп. Группа заводится при регистрации, а вопросы про
-- время и адрес бот задаёт потом (досылка уже зарегистрированным) или адрес вообще не копировался: ответ лежал только в
-- анкете человека (users.address_raw / schedule_raw), а в карточке группы пусто.
-- Функция переносит ответы в реквизиты группы и ничего не затирает:
--   • адрес — в поле «Адрес» (groups.address), только если оно пустое: правка координатора важнее анкеты;
--   • удобное время — в комментарий («Удобное время: …», как и при заведении группы), только для потенциальной группы
--     и если такой строки там ещё нет. День и время суток свободным текстом не разобрать, поэтому поля «День» и «Время»
--     координатор заполняет сам, глядя на комментарий.
-- Вызывается из бота после каждого ответа и при создании заявки, а ниже один раз прогоняется по всем накопившимся группам.
CREATE OR REPLACE FUNCTION sync_potential_group(p_user bigint) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  v_address integer;
  v_comment integer;
BEGIN
  UPDATE groups g SET address = btrim(u.address_raw)
    FROM users u
   WHERE u.id = p_user AND g.leader_user_id = u.id AND g.source_request_id IS NOT NULL AND g.archived_at IS NULL
     AND nullif(btrim(coalesce(g.address, '')), '') IS NULL AND nullif(btrim(coalesce(u.address_raw, '')), '') IS NOT NULL;
  GET DIAGNOSTICS v_address = ROW_COUNT;

  UPDATE groups g SET comment =
         coalesce(nullif(rtrim(coalesce(g.comment, ''), '. '), '') || '. ', '') || 'Удобное время: ' || btrim(u.schedule_raw) || '.'
    FROM users u
   WHERE u.id = p_user AND g.leader_user_id = u.id AND g.source_request_id IS NOT NULL AND g.archived_at IS NULL
     AND g.status = 'Потенциальная'
     AND nullif(btrim(coalesce(u.schedule_raw, '')), '') IS NOT NULL AND coalesce(g.comment, '') NOT LIKE '%Удобное время:%';
  GET DIAGNOSTICS v_comment = ROW_COUNT;

  RETURN v_address + v_comment;
END;
$$;

-- Один раз по всем, кто уже ответил: именно они остались без адреса и времени в карточке группы.
SELECT sync_potential_group(u.id) FROM users u
 WHERE EXISTS (SELECT 1 FROM groups g WHERE g.leader_user_id = u.id AND g.source_request_id IS NOT NULL)
   AND (u.address_raw IS NOT NULL OR u.schedule_raw IS NOT NULL);
