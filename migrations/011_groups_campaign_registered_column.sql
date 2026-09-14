-- «40 дней» был вычисляемым полем (EXISTS-подзапрос при каждой отдаче дашборда),
-- становится настоящим столбцом: служитель должен уметь поправить руками, если
-- совпадение по телефону промахнулось (другой номер на группе, опечатка и т.п.).
ALTER TABLE groups ADD COLUMN campaign_registered boolean NOT NULL DEFAULT false;

-- Бэкфилл тем же условием, что раньше вычисляли на лету — уже подходящие по
-- номеру группы не должны потерять бейдж при переходе на хранимое поле.
UPDATE groups g SET campaign_registered = true
 WHERE EXISTS (SELECT 1 FROM users u WHERE u.complete = true AND u.phone = ANY(g.phones));
