-- «Группа не подходит» до того, как бот научился возвращать такие заявки в работу: человек нажал, а заявка осталась
-- «Исполнена», и никто о ней не знал. Возвращаем так же, как теперь делает бот (`PlacementNoticesRepo.answer`): заявка
-- «В работе» с отметкой «нужен звонок», группа записана отклонённой («declined») — заново её не предложат, в журнале —
-- «Возвращена в работу · бот». Идемпотентна: вторая прогонка не найдёт заявок «Исполнена» с этим ответом.
WITH hit AS (
  SELECT DISTINCT ON (n.request_id) n.request_id, n.group_id, r.group_id AS old_group, r.final_group
    FROM placement_notices n
    JOIN requests r ON r.id = n.request_id
   WHERE n.recipient = 'person' AND n.answer = 'not_fit'
     AND r.status = 'Исполнена' AND r.group_id = n.group_id AND r.archived_at IS NULL
   ORDER BY n.request_id, n.id DESC
), rejected AS (
  INSERT INTO placement_proposals (request_id, group_id, source, status, reject_reason, reject_comment, decided_by, decided_at)
  SELECT request_id, group_id, 'manual', 'rejected', 'declined', 'Человек нажал «Группа не подходит» в MAX', 'бот', now() FROM hit
), logged AS (
  INSERT INTO audit_log (actor, service, action, entity_type, entity_id, before, after, note)
  SELECT 'бот', 'bot', 'request.reopen', 'request', request_id,
         jsonb_build_object('status', 'Исполнена', 'group_id', old_group, 'final_group', final_group),
         jsonb_build_object('status', 'В работе', 'callback', true),
         'человек нажал «Группа не подходит» в MAX'
    FROM hit
)
UPDATE requests r
   SET status = 'В работе', group_id = NULL, final_group = NULL, cancel_reason = NULL, callback = true,
       origin = CASE WHEN r.origin = 'таблица' THEN 'ui' ELSE r.origin END
  FROM hit WHERE r.id = hit.request_id;
