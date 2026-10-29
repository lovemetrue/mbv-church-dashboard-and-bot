-- Сообщения в боте после «Утвердить»: человеку — «мы подобрали вам группу», ведущему — «вам направлен человек».
-- Пишет их сервис «Домашние группы» в одной транзакции с утверждением, а отправляет бот: только у бота есть
-- соединение с платформой. Строка — и очередь, и след в заявке: дошло ли сообщение и что человек нажал.
CREATE TABLE placement_notices (
  id           bigserial PRIMARY KEY,
  request_id   bigint NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  group_id     bigint NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  recipient    text   NOT NULL CHECK (recipient IN ('person', 'leader')),
  -- Кому писать: регистрация в боте. NULL — человека в боте не нашли (status = 'no_chat'), звонить самим.
  user_id      bigint REFERENCES users(id) ON DELETE SET NULL,
  -- queued — ждёт бота; sent — платформа приняла; failed — не доставить (заблокировал бота и т. п.);
  -- no_chat — писать некуда; cancelled — утверждение отменили раньше, чем бот успел отправить.
  status       text   NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'no_chat', 'cancelled')),
  -- Вид ошибки платформы (blocked, not_found, other), без текста ответа: в нём бывают личные данные.
  error        text,
  attempts     int    NOT NULL DEFAULT 0,
  next_try_at  timestamptz NOT NULL DEFAULT now(),
  sent_at      timestamptz,
  -- Ответ кнопкой: ведущий — will_call / no_time, человек — waiting / not_fit. Последнее нажатие.
  answer       text   CHECK (answer IN ('will_call', 'no_time', 'waiting', 'not_fit')),
  answered_at  timestamptz,
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX placement_notices_request_idx ON placement_notices (request_id);
CREATE INDEX placement_notices_queue_idx ON placement_notices (next_try_at) WHERE status = 'queued';
