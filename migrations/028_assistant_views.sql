-- Представления и роль «только чтение» для чат-помощника (кнопка «✦ Помощник»).
--
-- Помощник пишет запросы сам, поэтому изолирован базой, а не просьбой вести себя осторожно:
--   • запросы выполняются от роли assistant_ro (SET LOCAL ROLE), у которой есть доступ ТОЛЬКО к представлениям схемы assistant;
--   • к самим таблицам users, requests, groups у роли доступа нет: представления работают с правами владельца;
--   • телефоны в представлениях замаскированы (видны последние две цифры), а «ключ телефона» — необратимый код,
--     по которому находят дубли, не зная номера; почты, ссылки и номера внутри свободного текста вырезаются.
-- Ни имён служителей, ни токенов, ни почт сотрудников, ни чатов и логинов в мессенджерах здесь нет.
--
-- Если у пользователя базы нет права создавать роли, роль не создаётся, помощник отвечает «недоступен», остальное работает.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'assistant_ro') THEN
    CREATE ROLE assistant_ro NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
  EXECUTE format('GRANT assistant_ro TO %I', current_user);
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'нет права создать роль assistant_ro: чат-помощник будет недоступен';
END $$;

CREATE SCHEMA IF NOT EXISTS assistant;

-- Вырезает из свободного текста почты, ссылки и номера телефонов.
CREATE OR REPLACE FUNCTION assistant.clean(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT nullif(btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(coalesce(t, ''), 'https?://\S+|www\.\S+', '***', 'gi'),
        '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}', '***', 'g'),
      '\+?\d[\d\s().-]{6,}\d', '***', 'g')
  ), '')
$$;

-- Телефон: видны только последние две цифры.
CREATE OR REPLACE FUNCTION assistant.phone_mask(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN regexp_replace(coalesce(t, ''), '\D', '', 'g') = '' THEN NULL
              ELSE '+7 *** ***-**-' || right(regexp_replace(t, '\D', '', 'g'), 2) END
$$;

-- «Ключ телефона»: один и тот же номер даёт один и тот же код, по коду номер не восстановить.
CREATE OR REPLACE FUNCTION assistant.phone_key(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN length(regexp_replace(coalesce(t, ''), '\D', '', 'g')) < 7 THEN NULL
              ELSE left(md5('mbv:' || right(regexp_replace(t, '\D', '', 'g'), 10)), 10) END
$$;

DROP VIEW IF EXISTS assistant.people, assistant.requests, assistant.groups, assistant.coordinators, assistant.placements CASCADE;

-- Участники кампании (зарегистрированные).
CREATE VIEW assistant.people AS
SELECT id, registration_no, platform, full_name,
       assistant.phone_mask(phone) AS phone_masked, assistant.phone_key(phone) AS phone_key,
       church, mdg_status,                 -- open хочет открыть, home даёт дом, join хочет в группу, member состоит, leader ведёт
       age, location AS place, assistant.clean(address_raw) AS address, assistant.clean(schedule_raw) AS schedule,
       leader_name, assistant.clean(companions) AS companions, assistant.clean(admin_comment) AS note,
       complete, registered_at::date AS registered_on, blocked_at IS NOT NULL AS blocked_bot, kit_issued_at IS NOT NULL AS kit_issued
  FROM users
 WHERE registration_no IS NOT NULL;

-- Заявки (не удалённые). type: join_group хочет в группу, lead_group хочет открыть или дать дом, question вопрос,
-- already_member уже состоит, already_leader уже ведёт.
CREATE VIEW assistant.requests AS
SELECT id, user_id, type, status, origin, fio,
       assistant.phone_mask(phone) AS phone_masked, assistant.phone_key(phone) AS phone_key,
       age, place, responsible, source, ministry, recommended, final_group, group_id, cancel_reason, attendance,
       assistant.clean(note) AS note, assistant.clean(extra) AS extra,
       assistant.clean(manual_street) AS street_manual, assistant.clean(manual_schedule) AS schedule_manual,
       callback AS needs_call,
       coalesce(requested_at, created_at::date) AS request_date,
       (current_date - coalesce(requested_at, created_at::date)) AS waiting_days
  FROM requests
 WHERE archived_at IS NULL;

-- Домашние группы (не удалённые). Код — как в интерфейсе (ДГ-0001). Вместимость по умолчанию 10 человек.
CREATE VIEW assistant.groups AS
SELECT id, 'ДГ-' || lpad(id::text, 4, '0') AS code, no, leader,
       assistant.phone_mask(phone) AS leader_phone_masked, assistant.phone_key(phone) AS leader_phone_key,
       co_leader, assistant.phone_mask(co_leader_phone) AS co_leader_phone_masked, assistant.phone_key(co_leader_phone) AS co_leader_phone_key,
       district, metro, assistant.clean(address) AS address, status, open_to_new, age, composition, day, "time",
       people, coordinator, feedback_at, (current_date - feedback_at) AS days_since_feedback,
       assistant.clean(comment) AS comment, training, format, checked, campaign_registered, do_not_refer, source
  FROM groups
 WHERE archived_at IS NULL;

-- Координаторы и руководители (имена и роли).
CREATE VIEW assistant.coordinators AS
SELECT id, name, role FROM coordinators WHERE archived_at IS NULL;

-- Кого утвердили в какую группу через сервис (заявки со статусом «Исполнена» и группой).
CREATE VIEW assistant.placements AS
SELECT r.id AS request_id, r.user_id, r.fio, assistant.phone_key(r.phone) AS phone_key,
       r.group_id, 'ДГ-' || lpad(r.group_id::text, 4, '0') AS group_code, g.district AS group_district, r.handled_at::date AS placed_on
  FROM requests r
  LEFT JOIN groups g ON g.id = r.group_id
 WHERE r.archived_at IS NULL AND r.status = 'Исполнена' AND r.group_id IS NOT NULL;

REVOKE ALL ON SCHEMA assistant FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'assistant_ro') THEN
    GRANT USAGE ON SCHEMA assistant TO assistant_ro;
    GRANT SELECT ON assistant.people, assistant.requests, assistant.groups, assistant.coordinators, assistant.placements TO assistant_ro;
  END IF;
END $$;
