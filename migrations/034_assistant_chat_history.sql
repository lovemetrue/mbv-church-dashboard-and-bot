-- История разговоров с помощником. Раньше её держал интерфейс в памяти страницы: обновили страницу — разговор пропал,
-- а модель не помнила, о чём спрашивали вчера. Теперь вопросы и ответы лежат здесь, по логину того, кто спрашивал, и
-- в модель уходят последние сообщения этого человека.
--
-- Текст ответа хранится с настоящими именами (так его видит служитель), поэтому таблица не входит в схему assistant:
-- роль только для чтения до неё не дотянется. Запросы и таблицы-выдержки не храним: их можно получить повторным вопросом.
CREATE TABLE assistant_chat_messages (
  id         bigserial PRIMARY KEY,
  actor      text        NOT NULL,
  role       text        NOT NULL CHECK (role IN ('user', 'assistant')),
  content    text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assistant_chat_messages_actor_idx ON assistant_chat_messages (actor, id DESC);
