-- Доступ «только чтение» для AI-помощника: без телефонов, имён, адресов и свободного текста.
--
-- Выполняет владелец сервиса под владельцем базы (пользователь POSTGRES_USER из .env), один раз:
--   docker compose exec -T db psql -U church -d church40 -f - < docs/assistant-readonly.sql
-- Пароль ниже замените на длинный случайный и храните вне репозитория.
--
-- Помощник видит только представления схемы assistant. К таблицам users, requests, groups
-- у него доступа нет вообще: представления выполняются с правами владельца, а ему выданы
-- права только на сами представления.
--
-- Как отозвать доступ целиком:  DROP OWNED BY assistant_ro; DROP ROLE assistant_ro; DROP SCHEMA assistant CASCADE;

CREATE ROLE assistant_ro LOGIN PASSWORD 'ЗАМЕНИТЕ-НА-ДЛИННЫЙ-СЛУЧАЙНЫЙ-ПАРОЛЬ'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 3;

-- Страховки поверх прав: любая транзакция только на чтение, долгие запросы обрываются,
-- а по умолчанию помощник смотрит в свою схему.
ALTER ROLE assistant_ro SET default_transaction_read_only = on;
ALTER ROLE assistant_ro SET statement_timeout = '15s';
ALTER ROLE assistant_ro SET search_path = assistant;

CREATE SCHEMA assistant;

-- Участники. Нет: ФИО, телефон, username, id в мессенджере и id чата, имя ведущего,
-- «с кем посещает», комментарий служителя, адрес и удобное время (свободный текст).
CREATE VIEW assistant.people AS
SELECT id, platform, church, mdg_status, age,
       location AS place,                      -- район и метро, как написал человек
       complete, registered_at, blocked_at IS NOT NULL AS blocked_bot
  FROM users
 WHERE registration_no IS NOT NULL;

-- Заявки. Нет: ФИО, телефоны, ответственный (имя служителя) и все свободные тексты
-- (примечание, дополнительно, вопрос человека): в них люди пишут телефоны и имена.
CREATE VIEW assistant.requests AS
SELECT id, user_id, group_id, type, status, origin, age, place, source, ministry,
       recommended, final_group, cancel_reason, attendance,
       coalesce(requested_at, created_at::date) AS request_date
  FROM requests
 WHERE archived_at IS NULL;

-- Группы. Нет: ФИО ведущего и соведущего, телефоны, адрес, комментарий, координатор.
-- Вместо имени — код группы, как в дашборде (ДГ-0001).
CREATE VIEW assistant.groups AS
SELECT id, 'ДГ-' || lpad(id::text, 4, '0') AS code, no, district, metro, status, open_to_new,
       age, composition, day, "time", people, format, checked, campaign_registered,
       do_not_refer, source
  FROM groups
 WHERE archived_at IS NULL;

GRANT USAGE ON SCHEMA assistant TO assistant_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA assistant TO assistant_ro;
