-- Переписки с участниками больше нет: служитель звонит по телефону из заявки
-- и отмечает её обработанной. Поэтому текст ответа не храним, а поля переименованы
-- из «кто ответил» в «кто обработал».
ALTER TABLE requests DROP COLUMN answer;
ALTER TABLE requests RENAME COLUMN answered_by TO handled_by;
ALTER TABLE requests RENAME COLUMN answered_at TO handled_at;

-- Старые ответы считаем обработанными: статуса «answered» в новом сценарии нет.
UPDATE requests SET status = 'closed' WHERE status = 'answered';
ALTER TABLE requests DROP CONSTRAINT requests_status_check;
ALTER TABLE requests ADD CONSTRAINT requests_status_check CHECK (status IN ('new', 'closed'));
