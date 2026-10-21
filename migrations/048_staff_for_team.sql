-- Пароли для команды из «Настроек». Ссылки «задайте пароль сами» не прижились: почта на сервере не настроена, а
-- ссылки живут недолго. Теперь у каждого из справочника команды (`coordinators`: координаторы, распределители)
-- администратор может сгенерировать пароль и раздать его лично.
--  • staff.coordinator_id — чья это учётная запись в справочнике команды. Запись заводится при первой генерации
--    пароля; у одного человека из справочника — не больше одной.
--  • staff.email становится необязательной: у заведённых из справочника почты нет, вход — по логину. Почта
--    по-прежнему нужна, чтобы получить ссылку «Забыли пароль» письмом.
ALTER TABLE staff ALTER COLUMN email DROP NOT NULL;
ALTER TABLE staff ADD COLUMN coordinator_id bigint REFERENCES coordinators(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX staff_coordinator_unique ON staff (coordinator_id) WHERE coordinator_id IS NOT NULL;
