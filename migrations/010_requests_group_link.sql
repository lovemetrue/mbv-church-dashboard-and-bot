-- Заявка ссылается на конкретную домашнюю группу: одно поле одновременно
-- хранит рекомендацию (по возрасту) и итоговое, в т.ч. принудительное,
-- назначение — см. docs/superpowers/specs/2026-09-14-groups-requests-campaign-design.md.
-- FK без ON DELETE: группы у нас не удаляют физически (archive — мягкое удаление),
-- поэтому висячих ссылок не бывает.
ALTER TABLE requests ADD COLUMN group_id bigint REFERENCES groups(id);
CREATE INDEX requests_group_idx ON requests (group_id) WHERE group_id IS NOT NULL;
