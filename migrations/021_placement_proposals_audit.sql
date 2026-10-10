-- Предварительные назначения и единый журнал действий.
--  • placement_proposals — «предварительно»: что предложили расчёт или языковая модель и что решил
--    координатор. Предложение заявку не меняет; человек считается распределённым только после
--    «Утвердить» (тогда в одной транзакции меняется и заявка).
--  • audit_log — единый журнал платформы: кто, когда, где, что сделал и что было → стало.
--    Значений личных данных (ФИО, телефонов) в before/after не пишем — только факт и служебные поля.
--  • requests.callback — отметка «нужен звонок»: решение координатора, а не расчёта.
-- Миграция только добавляет: старый дашборд и бот её не замечают.
ALTER TABLE requests ADD COLUMN callback boolean NOT NULL DEFAULT false;

CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  -- Пока нет личных входов, это логин общего входа (mbv_admin / super_mbv_admin).
  actor       text NOT NULL,
  service     text NOT NULL,
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   bigint,
  before      jsonb,
  after       jsonb,
  note        text
);
CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id, at DESC);
CREATE INDEX audit_log_at_idx ON audit_log (at DESC);

CREATE TABLE placement_proposals (
  id             bigserial PRIMARY KEY,
  request_id     bigint NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  -- null — предложен только район (без группы), пригодится агенту.
  group_id       bigint REFERENCES groups(id),
  -- script — расчёт сервиса, agent — языковая модель, manual — координатор выбрал сам.
  source         text NOT NULL CHECK (source IN ('script', 'agent', 'manual')),
  status         text NOT NULL DEFAULT 'proposed'
                 CHECK (status IN ('proposed', 'approved', 'rejected', 'superseded')),
  confidence     integer CHECK (confidence BETWEEN 0 AND 100),
  rationale      jsonb,
  questions      jsonb,
  run_id         bigint,
  prompt_version integer,
  created_at     timestamptz NOT NULL DEFAULT now(),
  decided_by     text,
  decided_at     timestamptz,
  reject_reason  text CHECK (reject_reason IN ('time', 'far', 'age', 'declined', 'other')),
  reject_comment text
);
-- На заявку одно действующее предложение: новое помечает прежнее «заменено».
CREATE UNIQUE INDEX placement_proposals_one_active ON placement_proposals (request_id) WHERE status = 'proposed';
CREATE INDEX placement_proposals_request_idx ON placement_proposals (request_id);
