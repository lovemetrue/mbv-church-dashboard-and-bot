-- Ведущий и соведущий группы — ссылки на людей из справочника «Люди», как это уже было у ведущего (миграция 030).
-- Раньше связать можно было только ведущего и только с регистрацией, и только разбором обращения «уже веду группу».
-- Теперь в форме правки группы ведущего и соведущего выбирают из «Людей»: это регистрация (users) или карточка,
-- внесённая вручную (persons, — соведущие часто не регистрируются в боте). Телефоны ведущих в карточке группы берутся
-- из этих людей, а не из отдельных полей группы.
-- Имя и телефон в самой группе остаются как были: так записано в таблице церкви, по ним ищут и сверяют группы,
-- и они же показываются, пока человек не выбран.
ALTER TABLE groups
  ADD COLUMN leader_person_id    bigint REFERENCES persons(id) ON DELETE SET NULL,
  ADD COLUMN co_leader_user_id   bigint REFERENCES users(id)   ON DELETE SET NULL,
  ADD COLUMN co_leader_person_id bigint REFERENCES persons(id) ON DELETE SET NULL,
  -- Каждая позиция ссылается на одного человека: регистрацию или карточку, не на обе сразу.
  ADD CONSTRAINT groups_leader_one_ref    CHECK (leader_user_id IS NULL OR leader_person_id IS NULL),
  ADD CONSTRAINT groups_co_leader_one_ref CHECK (co_leader_user_id IS NULL OR co_leader_person_id IS NULL);

CREATE INDEX groups_leader_person_idx    ON groups (leader_person_id)    WHERE leader_person_id IS NOT NULL;
CREATE INDEX groups_co_leader_user_idx   ON groups (co_leader_user_id)   WHERE co_leader_user_id IS NOT NULL;
CREATE INDEX groups_co_leader_person_idx ON groups (co_leader_person_id) WHERE co_leader_person_id IS NOT NULL;
