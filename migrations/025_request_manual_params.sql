-- Параметры подбора, которые координатор поправил вручную: улица и удобные дни/время свободным
-- текстом. Ответ человека из анкеты бота (users.address_raw, users.schedule_raw) не затирается:
-- правка лежит рядом и имеет приоритет, а «убрать правку» возвращает анкету.
ALTER TABLE requests
  ADD COLUMN manual_street   text,
  ADD COLUMN manual_schedule text;
