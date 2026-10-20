-- Разово: группам без людей — потенциальным и пустым — пять мест вместо общих десяти (просьба служителей: в новую группу
-- сразу десять человек не направляют). «Пустая» — у действующей, «Кампании» или группы на паузе нет ни числа участников
-- от ведущего, ни людей в составе, ни утверждённых через сервис. Закрытые, «Недвижимость» и убранные не трогаем;
-- уже заданную вместимость — тоже, поэтому повторный запуск ничего не меняет.
-- Правка закрепляет запись за интерфейсом (source 'таблица' → 'ui'), как любая правка в дашборде: иначе повторный
-- перенос таблицы церкви стёр бы новую вместимость.
UPDATE groups g
   SET capacity = 5,
       source = CASE WHEN g.source = 'таблица' THEN 'ui' ELSE g.source END
 WHERE g.capacity IS NULL
   AND g.archived_at IS NULL
   AND (
     g.status = 'Потенциальная'
     OR (
       g.status IN ('Функционирует', 'Кампания', 'На паузе')
       AND COALESCE(g.people, 0) = 0
       AND NOT EXISTS (SELECT 1 FROM group_members m WHERE m.group_id = g.id AND m.archived_at IS NULL)
       AND NOT EXISTS (SELECT 1 FROM requests r WHERE r.group_id = g.id AND r.status = 'Исполнена' AND r.archived_at IS NULL)
     )
   );
