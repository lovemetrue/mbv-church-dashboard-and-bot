-- Уровень входа «Стойка регистрации» (registration): личный вход для волонтёров у стойки. Сервер пускает его только
-- на страницу /registration — регистрация участника и выдача наборов; заявки, группы, справочник и «Настройки» ему
-- закрыты (403). Ограничение у колонки было безымянным в 024, поэтому снимаем его по имени, которое дал Postgres.
ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_role_check;
ALTER TABLE staff ADD CONSTRAINT staff_role_check CHECK (role IN ('admin', 'super', 'registration'));
