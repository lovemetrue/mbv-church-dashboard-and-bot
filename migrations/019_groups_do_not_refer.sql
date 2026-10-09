-- «Не направлять»: группа, куда людей отправлять нельзя. Такие группы скрыты из подбора,
-- но остаются в реестре, поэтому отдельная отметка, а не статус.
ALTER TABLE groups ADD COLUMN do_not_refer boolean NOT NULL DEFAULT false;
