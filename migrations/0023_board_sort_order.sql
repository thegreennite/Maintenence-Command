-- Separates the manager's checklist-board arrangement from the actual
-- sequence a superintendent walks through in command mode / the daily
-- checklist. sort_order stays exactly what it always was -- the order
-- readings were originally scanned/created in, which the super always
-- follows -- and never changes again once set. board_sort_order is a
-- new, independent column the machine board's drag-and-drop writes to
-- instead, purely for how a manager likes to see things arranged;
-- reordering on the board no longer reshuffles what the super sees.
-- Backfilled from each tag's current sort_order so today's board looks
-- exactly the same as it did a moment ago, before this split existed.
ALTER TABLE inspection_tags ADD COLUMN board_sort_order INTEGER;
UPDATE inspection_tags SET board_sort_order = sort_order WHERE board_sort_order IS NULL;
