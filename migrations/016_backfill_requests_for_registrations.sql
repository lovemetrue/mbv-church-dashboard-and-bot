-- Заявки для регистраций, у которых её нет. Так вышло с теми, кого служитель завёл из
-- дашборда до исправления «ручная регистрация заводит заявку» (коммит edc7e98): они
-- есть в «Регистрации», но не попали в «Заявки». С тех пор любой ответ про малую группу
-- заводит заявку, поэтому дозаводим только пропущенные, ровно по тому же соответствию
-- ответа и типа, что в mdgRequestType (src/core/fsm.ts). Повторный запуск ничего не меняет.
INSERT INTO requests (user_id, type, origin, created_at)
SELECT u.id,
       CASE u.mdg_status
         WHEN 'join'   THEN 'join_group'
         WHEN 'open'   THEN 'lead_group'
         WHEN 'home'   THEN 'lead_group'
         WHEN 'member' THEN 'already_member'
         WHEN 'leader' THEN 'already_leader'
       END,
       'ui',
       COALESCE(u.registered_at, now())
  FROM users u
 WHERE u.complete
   AND u.mdg_status IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM requests r WHERE r.user_id = u.id);
