-- «Пользователи и роли» одним списком (запрос заказчика):
--  • уровень входа `readonly` — «Только чтение»: видит заявки, группы и людей, но ничего не меняет, подбор не запускает,
--    «Настройки» и сводка «Команды» ему закрыты, «Координаторы» и «Наборы» — только смотреть (server.ts, `readonlyAllows`);
--  • staff.password_sealed — выданный пароль, зашифрованный секретом сервера (как ключи в «Настройках», secrets.ts).
--    Полный вход открывает его «глазиком», чтобы раздать людям, не генерируя новый. Для входа по-прежнему проверяется
--    только хеш; пароль, заданный до этой миграции, не восстановить — у таких колонка пуста.
ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_role_check;
ALTER TABLE staff ADD CONSTRAINT staff_role_check CHECK (role IN ('admin', 'super', 'registration', 'readonly'));
ALTER TABLE staff ADD COLUMN password_sealed text;
