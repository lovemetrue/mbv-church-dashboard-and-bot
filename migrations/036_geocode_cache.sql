-- Кэш координат адресов (Яндекс.Геокодер). Подбор сравнивает группу и человека по расстоянию, а не по названию улицы:
-- домашняя группа может быть в соседнем квартале. Адрес геокодируется один раз и лежит здесь, чтобы не расходовать
-- лимит запросов и не ходить в сеть при каждом пересчёте плана.
-- Ключ — адрес в нормализованном виде (см. `addressKey`): правка адреса даёт новый ключ и новый запрос.
-- `found = false` — адрес не нашли (или нашли только город/улицу без точки): повторно не спрашиваем, пока адрес тот же.
CREATE TABLE geocode_cache (
  address_key text PRIMARY KEY,
  found       boolean          NOT NULL,
  lat         double precision,
  lon         double precision,
  accuracy    text,
  fetched_at  timestamptz      NOT NULL DEFAULT now(),
  CHECK (NOT found OR (lat IS NOT NULL AND lon IS NOT NULL))
);
