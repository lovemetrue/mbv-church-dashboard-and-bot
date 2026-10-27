-- Пользователь («Настройки → Пользователи и роли») — учётная запись для входа. Её ФИО — свободная строка (бывает и
-- служебная запись, и человек не из «Людей»), но если это человек из «Людей», рядом хранится ссылка на него, как у
-- ведущих (миграция 054) и участников команды (миграция 056): так видно, чья это запись, и его данные не дублируются.
ALTER TABLE staff
  ADD COLUMN user_id   bigint REFERENCES users(id)   ON DELETE SET NULL,
  ADD COLUMN person_id bigint REFERENCES persons(id) ON DELETE SET NULL,
  ADD CONSTRAINT staff_one_person CHECK (user_id IS NULL OR person_id IS NULL);

-- Заведённые из справочника команды — тот же человек, что и участник команды.
UPDATE staff s SET user_id = c.user_id, person_id = c.person_id
  FROM coordinators c
 WHERE s.coordinator_id = c.id AND s.user_id IS NULL AND s.person_id IS NULL;
