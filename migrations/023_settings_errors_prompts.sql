-- Раздел «Настройки»: журнал ошибок сервисов и версии инструкций агентов.
--  • system_errors — что и где сломалось. Личных данных не хранит (телефоны и почты вырезаются
--    при записи); по размеру ограничен чисткой старых записей.
--  • agent_prompts — тексты инструкций агента по блокам с версиями. Старые версии не удаляются:
--    откат — это «сделать действующей» прежнюю. Нет строк — действует текст по умолчанию из кода.
CREATE TABLE system_errors (
  id      bigserial PRIMARY KEY,
  at      timestamptz NOT NULL DEFAULT now(),
  service text NOT NULL,
  message text NOT NULL,
  context text
);
CREATE INDEX system_errors_at_idx ON system_errors (at DESC);

CREATE TABLE agent_prompts (
  id         bigserial PRIMARY KEY,
  agent_key  text NOT NULL,
  block_key  text NOT NULL,
  version    integer NOT NULL,
  text       text NOT NULL,
  note       text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  active     boolean NOT NULL DEFAULT false,
  UNIQUE (agent_key, block_key, version)
);
-- В блоке одна действующая версия.
CREATE UNIQUE INDEX agent_prompts_one_active ON agent_prompts (agent_key, block_key) WHERE active;
