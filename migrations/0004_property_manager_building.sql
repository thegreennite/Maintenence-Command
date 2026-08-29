-- Phase 4: assign the Property Manager to a real building so their
-- read-only view has real data. Reuses Harbour Point (the same building
-- Jordan Lee inspects and Alex Kim oversees) rather than an empty
-- unassigned building with no superintendent to ever submit for it.
UPDATE users SET building_id = (SELECT id FROM buildings WHERE name = 'Harbour Point'),
  region = 'Harbour Point'
  WHERE username = 'taylor.morgan';
