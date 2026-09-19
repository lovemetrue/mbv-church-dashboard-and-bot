-- Раньше человек, у которого уже есть Малая группа («уже состою» / «веду
-- группу»), только регистрировался — заявка служителю не заводилась вообще,
-- ни при каких условиях. Теперь анкета всегда заводит и то, и другое: нужны
-- два новых типа заявки под эти ответы.
ALTER TABLE requests DROP CONSTRAINT requests_type_check;
ALTER TABLE requests ADD CONSTRAINT requests_type_check
  CHECK (type IN ('join_group', 'lead_group', 'question', 'already_member', 'already_leader'));
