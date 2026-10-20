-- Помощнику — вместимость каждой группы (миграция 042). Раньше он считал «нет мест» от одного числа на всех и ошибался
-- у групп на пять человек. Пусто — общее значение HG_DEFAULT_CAPACITY: оно живёт в .env, и его сообщает инструкция.
-- CREATE OR REPLACE с новым столбцом в конце сохраняет права роли assistant_ro на представление.
CREATE OR REPLACE VIEW assistant.groups AS
SELECT id, 'ДГ-' || lpad(id::text, 4, '0') AS code, no,
       assistant.name_ref('Ведущий', leader) AS leader,
       assistant.phone_key(phone) AS leader_phone_key,
       assistant.name_ref('Ведущий', co_leader) AS co_leader,
       district, metro, assistant.clean(address) AS address, status, open_to_new, age, composition, day, "time",
       people, assistant.name_ref('Координатор', coordinator) AS coordinator, feedback_at, (current_date - feedback_at) AS days_since_feedback,
       training, format, checked, campaign_registered, do_not_refer, source, capacity
  FROM groups
 WHERE archived_at IS NULL;
