-- Соведущий группы: имя и телефон. В таблице церкви его записывали вместе с ведущим
-- в одну ячейку телефона, теперь у него свои поля.
ALTER TABLE groups
  ADD COLUMN co_leader       text,
  ADD COLUMN co_leader_phone text;
