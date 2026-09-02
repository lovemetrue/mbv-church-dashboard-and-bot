-- Поиск незакрытых заявок человека: нужен на каждое нажатие кнопки в меню,
-- чтобы не создавать повторную заявку того же вида.
CREATE INDEX requests_open_by_user_idx ON requests (user_id, type) WHERE status = 'new';
