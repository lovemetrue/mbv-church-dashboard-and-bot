-- Досылка двух вопросов (удобное время, адрес) тем, кто уже зарегистрирован.
--  • users.extra_invited_at — когда человеку отправили приглашение: так он получает его один раз,
--    даже если служитель нажмёт кнопку дважды или рассылка оборвётся.
--  • broadcasts.buttons — кнопки сообщения («Ответить», «Не сейчас»); у обычных рассылок пусто.
ALTER TABLE users ADD COLUMN extra_invited_at timestamptz;
ALTER TABLE broadcasts ADD COLUMN buttons jsonb;
