// Per-machine, per-state memory of what counts as normal.
//
// A boiler reads differently when it is on than when it is off, so a numeric
// reading is judged only against past readings taken in the SAME state of the
// machine's on/off/auto (hand-off-auto, open/closed) answer -- see
// worker/deviation.js. And when a superintendent marks a flagged reading
// "normal" at the end of an inspection, the allowed range for that reading in
// that state stretches to include it (plus the usual margin beyond), so the
// machine stops flagging what its own crew says is ordinary.

export const STATE_KINDS = ["on_off", "hoa", "open_closed"];

export const stateOf = (value) => String(value ?? "").trim().toLowerCase();

const ready = new WeakSet();

// Companies created before this feature have no learned_ranges table; make it
// the first time anything touches it. Cheap and idempotent.
export async function ensureLearnedTable(env) {
  if (ready.has(env.DB)) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS learned_ranges (
       tag_id INTEGER NOT NULL, state TEXT NOT NULL DEFAULT '', lo REAL NOT NULL, hi REAL NOT NULL,
       updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (tag_id, state))`,
  ).run();
  ready.add(env.DB);
}

// { [tagId]: { [state]: { lo, hi } } } for every tag in a building.
export async function loadLearned(env, buildingId) {
  try {
    await ensureLearnedTable(env);
    const rows = await env.DB.prepare(
      `SELECT l.tag_id, l.state, l.lo, l.hi FROM learned_ranges l
       JOIN inspection_tags t ON t.id = l.tag_id WHERE t.building_id = ?`,
    )
      .bind(buildingId)
      .all();
    const out = {};
    for (const row of rows.results) (out[row.tag_id] ||= {})[row.state] = { lo: row.lo, hi: row.hi };
    return out;
  } catch (error) {
    console.error("loadLearned failed", error);
    return {};
  }
}

// Called at submit for every reading the super marked "normal". Only a reading
// that was flagged for drifting from its own history teaches anything: a
// manager's min/max is the manager's call, and a "doesn't look like a real
// number" flag is not something to learn from.
//   deviation: the object recordDeviations stored on the reading
//   margin: how far past the accepted value to allow (3 deg, 5 psi, 5 %)
export async function learnFromNormal(env, { tagId, value, deviation, margin }) {
  if (!deviation || deviation.basis !== "trend") return null;
  const v = Number.parseFloat(value);
  if (!Number.isFinite(v) || deviation.baseline == null) return null;
  await ensureLearnedTable(env);
  const state = deviation.state || "";
  const spread = deviation.tolerance ?? margin;
  const existing = await env.DB.prepare("SELECT lo, hi FROM learned_ranges WHERE tag_id = ? AND state = ?")
    .bind(tagId, state)
    .first();
  let lo = existing?.lo ?? deviation.baseline - spread;
  let hi = existing?.hi ?? deviation.baseline + spread;
  if (v > deviation.baseline) hi = Math.max(hi, v + margin);
  else lo = Math.min(lo, v - margin);
  await env.DB.prepare(
    `INSERT INTO learned_ranges (tag_id, state, lo, hi, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT (tag_id, state) DO UPDATE SET lo = excluded.lo, hi = excluded.hi, updated_at = CURRENT_TIMESTAMP`,
  )
    .bind(tagId, state, lo, hi)
    .run();
  return { lo, hi };
}
