// The order a superintendent walks the readings in command mode -- one
// definition, used both by command mode itself and by the manager's
// "where will this show up?" preview, so they can never disagree.
//
// Always the original scanned/created order: a machine's position is wherever
// its EARLIEST reading originally landed (not equipment_groups.sort_order, and
// deliberately not the machine board's own drag-and-drop order, which is for a
// manager's organising and must never reshuffle what a super walks through).
// A reading with no machine sits at its own position. Inside a machine, readings
// keep their original order -- so a brand new reading (appended at the end of
// everything) lands last within its machine, or last overall if ungrouped.
export function walkOrder(tags) {
  const groupPosition = new Map();
  for (const tag of [...tags].sort((a, b) => a.sort_order - b.sort_order)) {
    if (tag.equipment_group_id != null && !groupPosition.has(tag.equipment_group_id)) {
      groupPosition.set(tag.equipment_group_id, tag.sort_order);
    }
  }
  return [...tags].sort((a, b) => {
    const pa = a.equipment_group_id == null ? a.sort_order : groupPosition.get(a.equipment_group_id);
    const pb = b.equipment_group_id == null ? b.sort_order : groupPosition.get(b.equipment_group_id);
    if (pa !== pb) return pa - pb;
    return a.sort_order - b.sort_order;
  });
}

// Where a reading added to `groupId` (null = ungrouped) would land.
export function previewNewReading(tags, groupId) {
  const next = Math.max(-1, ...tags.map((t) => (Number.isFinite(t.sort_order) ? t.sort_order : -1))) + 1;
  const probe = { id: "__new__", sort_order: next, equipment_group_id: groupId };
  const ordered = walkOrder([...tags, probe]);
  const index = ordered.findIndex((t) => t.id === "__new__");
  return { position: index + 1, total: ordered.length, after: ordered[index - 1] || null, before: ordered[index + 1] || null };
}
