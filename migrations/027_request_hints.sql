-- Разбор помощника (языковой модели): что он определил в записи человека и какие вопросы советует задать.
-- Группу помощник не выбирает: эти поля подставляются в расчёт там, где скрипт ничего не понял.
-- base_hash — отпечаток записи (место, возраст, удобное время), по которой сделан разбор: человек или координатор
-- поменяли запись — разбор устарел и больше не применяется.
CREATE TABLE request_hints (
  request_id  bigint PRIMARY KEY REFERENCES requests(id) ON DELETE CASCADE,
  district    text,
  age         text,
  days        text[] NOT NULL DEFAULT '{}',
  slot        text,
  questions   jsonb NOT NULL DEFAULT '[]'::jsonb,
  base_hash   text NOT NULL,
  model       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
