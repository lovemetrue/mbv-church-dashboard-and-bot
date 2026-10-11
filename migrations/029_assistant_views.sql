-- Представления и роль «только чтение» для чат-помощника (кнопка «✦ Помощник»).
--
-- Помощник пишет запросы сам, поэтому изолирован базой, а не просьбой вести себя осторожно:
--   • запросы выполняются от роли assistant_ro (SET LOCAL ROLE), у которой есть доступ ТОЛЬКО к представлениям схемы assistant;
--   • к самим таблицам users, requests, groups у роли доступа нет: представления работают с правами владельца;
--   • ИМЁН В ПРЕДСТАВЛЕНИЯХ НЕТ. Вместо имени у каждого человека постоянный условный номер: Участник-1042, Заявитель-77,
--     Человек-5, Ведущий-3fa9c1, Координатор-b21e07. Один и тот же человек всегда получает один и тот же номер, поэтому
--     «кто в нескольких группах» и «кто ведёт несколько групп» считаются как обычно. Настоящие имена подставляет сервис
--     уже в ответе, который видит служитель; во внешнюю модель имена не уходят;
--   • телефоны замаскированы (видны последние две цифры), «ключ телефона» — необратимый код для поиска дублей;
--   • свободные тексты с заметками (примечания, комментарии, «с кем посещает») в представления не входят: в них пишут имена и номера.
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

-- Вырезает из текста почты, ссылки и номера телефонов.
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

-- Постоянный условный номер по имени (для ведущих, соведущих и координаторов, у которых нет номера в справочнике):
-- одно и то же имя (без учёта регистра и лишних пробелов) всегда даёт один и тот же номер.
CREATE OR REPLACE FUNCTION assistant.name_ref(prefix text, name text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN btrim(coalesce(name, '')) = '' THEN NULL
              ELSE prefix || '-' || left(md5('ref:' || lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))), 6) END
$$;

DROP VIEW IF EXISTS assistant.people, assistant.requests, assistant.groups, assistant.coordinators, assistant.placements, assistant.members CASCADE;

-- Участники кампании (зарегистрированные): Участник-<номер регистрации>.
CREATE VIEW assistant.people AS
SELECT id, 'Участник-' || registration_no AS person, registration_no, platform,
       assistant.phone_mask(phone) AS phone_masked, assistant.phone_key(phone) AS phone_key,
       church, mdg_status,                 -- open хочет открыть, home даёт дом, join хочет в группу, member состоит, leader ведёт
       age, location AS place, assistant.clean(address_raw) AS address, assistant.clean(schedule_raw) AS schedule,
       assistant.name_ref('Ведущий', leader_name) AS leader_of_person,
       complete, registered_at::date AS registered_on, blocked_at IS NOT NULL AS blocked_bot, kit_issued_at IS NOT NULL AS kit_issued
  FROM users
 WHERE registration_no IS NOT NULL;

-- Заявки (не удалённые). type: join_group хочет в группу, lead_group хочет открыть или дать дом, question вопрос,
-- already_member уже состоит, already_leader уже ведёт. person — тот же номер, что в people (Участник-…), а у заявки
-- без регистрации — Заявитель-<номер заявки>.
CREATE VIEW assistant.requests AS
SELECT r.id, r.user_id,
       coalesce('Участник-' || u.registration_no, 'Заявитель-' || r.id) AS person,
       r.type, r.status, r.origin,
       assistant.phone_mask(r.phone) AS phone_masked, assistant.phone_key(r.phone) AS phone_key,
       r.age, r.place, assistant.name_ref('Координатор', r.responsible) AS responsible,
       r.source, r.ministry, r.recommended, r.final_group, r.group_id, r.cancel_reason, r.attendance,
       r.callback AS needs_call,
       coalesce(r.requested_at, r.created_at::date) AS request_date,
       (current_date - coalesce(r.requested_at, r.created_at::date)) AS waiting_days
  FROM requests r
  LEFT JOIN users u ON u.id = r.user_id AND u.registration_no IS NOT NULL
 WHERE r.archived_at IS NULL;

-- Домашние группы (не удалённые). Код — как в интерфейсе (ДГ-0001). Вместимость по умолчанию 10 человек.
CREATE VIEW assistant.groups AS
SELECT id, 'ДГ-' || lpad(id::text, 4, '0') AS code, no,
       assistant.name_ref('Ведущий', leader) AS leader,
       assistant.phone_key(phone) AS leader_phone_key,
       assistant.name_ref('Ведущий', co_leader) AS co_leader,
       district, metro, assistant.clean(address) AS address, status, open_to_new, age, composition, day, "time",
       people, assistant.name_ref('Координатор', coordinator) AS coordinator, feedback_at, (current_date - feedback_at) AS days_since_feedback,
       training, format, checked, campaign_registered, do_not_refer, source
  FROM groups
 WHERE archived_at IS NULL;

-- Координаторы и руководители: условный номер и роль.
CREATE VIEW assistant.coordinators AS
SELECT id, assistant.name_ref('Координатор', name) AS coordinator, role FROM coordinators WHERE archived_at IS NULL;

-- Кого утвердили в какую группу через сервис (заявки со статусом «Исполнена» и группой).
CREATE VIEW assistant.placements AS
SELECT r.id AS request_id, r.user_id,
       coalesce('Участник-' || u.registration_no, 'Заявитель-' || r.id) AS person,
       assistant.phone_key(r.phone) AS phone_key,
       r.group_id, 'ДГ-' || lpad(r.group_id::text, 4, '0') AS group_code, g.district AS group_district, r.handled_at::date AS placed_on
  FROM requests r
  LEFT JOIN users u ON u.id = r.user_id AND u.registration_no IS NOT NULL
  LEFT JOIN groups g ON g.id = r.group_id
 WHERE r.archived_at IS NULL AND r.status = 'Исполнена' AND r.group_id IS NOT NULL;

-- Состав групп, внесённый вручную (ссылки на справочник людей); вместе с placements это полный состав.
CREATE VIEW assistant.members AS
SELECT m.id, m.group_id, 'ДГ-' || lpad(m.group_id::text, 4, '0') AS group_code, g.district AS group_district,
       CASE WHEN m.user_id IS NOT NULL THEN 'Участник-' || u.registration_no
            WHEN m.request_id IS NOT NULL THEN 'Заявитель-' || m.request_id
            ELSE 'Человек-' || m.person_id END AS person,
       assistant.phone_key(coalesce(u.phone, r.phone, p.phone)) AS phone_key,
       m.joined_on
  FROM group_members m
  JOIN groups g ON g.id = m.group_id AND g.archived_at IS NULL
  LEFT JOIN users u ON u.id = m.user_id
  LEFT JOIN requests r ON r.id = m.request_id AND r.archived_at IS NULL
  LEFT JOIN persons p ON p.id = m.person_id AND p.archived_at IS NULL
 WHERE m.archived_at IS NULL;

REVOKE ALL ON SCHEMA assistant FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'assistant_ro') THEN
    GRANT USAGE ON SCHEMA assistant TO assistant_ro;
    GRANT SELECT ON assistant.people, assistant.requests, assistant.groups, assistant.coordinators, assistant.placements, assistant.members TO assistant_ro;
  END IF;
END $$;
