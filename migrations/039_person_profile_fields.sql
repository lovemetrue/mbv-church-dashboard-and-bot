-- Хобби, профессия, семейное положение: одни и те же поля у регистрации, заявки и карточки, внесённой вручную. В заявке они,
-- как и телефон с возрастом, переписывают данные регистрации (читаются сначала из заявки, потом из регистрации).
ALTER TABLE users ADD COLUMN hobby text, ADD COLUMN profession text, ADD COLUMN family_status text;
ALTER TABLE requests ADD COLUMN hobby text, ADD COLUMN profession text, ADD COLUMN family_status text;
-- У карточки, внесённой вручную, раньше не было адреса и удобного времени: форма правки у всех людей теперь одна.
ALTER TABLE persons ADD COLUMN address text, ADD COLUMN schedule text,
  ADD COLUMN hobby text, ADD COLUMN profession text, ADD COLUMN family_status text;
