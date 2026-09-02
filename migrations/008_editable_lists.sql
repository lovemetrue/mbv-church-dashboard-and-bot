-- Правка и удаление прямо в списках дашборда.
--
-- Заявкам нужно мягкое удаление: ошибочная запись должна исчезать со страницы,
-- но след обращения человека стирать нельзя. У групп такая колонка уже есть.
ALTER TABLE requests ADD COLUMN archived_at timestamptz;

-- Открытые заявки ищем только среди не убранных.
DROP INDEX requests_open_by_user_idx;
CREATE INDEX requests_open_by_user_idx ON requests (user_id, type)
  WHERE status NOT IN ('Исполнена', 'Аннулирована') AND archived_at IS NULL;
