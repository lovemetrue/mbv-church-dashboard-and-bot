-- Снимок карты групп (Yandex Static API) для каждого входа: после перезагрузки страницы показывается картинка, а не
-- живая карта, — живая расходует суточный лимит открытий JS API. Снимок свой у каждого: у каждого свои центр, масштаб
-- и фильтры. `params` — запрос к Яндексу без ключа: тот же вид с теми же метками второй раз не запрашиваем.
CREATE TABLE map_snapshots (
  viewer    text PRIMARY KEY,
  params    text NOT NULL,
  png       bytea NOT NULL,
  marks     int NOT NULL,
  skipped   int NOT NULL DEFAULT 0,
  taken_at  timestamptz NOT NULL DEFAULT now()
);
