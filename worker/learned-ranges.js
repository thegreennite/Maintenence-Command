// Per-machine, per-state memory of what counts as normal.
//
// A boiler reads differently when it is on than when it is off, so a numeric
// reading is judged only against past readings taken in the SAME state of the
// machine's on/off/auto (hand-off-auto, open/closed) answer -- see
// worker/deviation.js. And when a superintendent says a flagged reading is
// normal (right when it's flagged, or at the end of the inspection), the
// allowed range for that reading in that state stretches to exactly that
// value, so the machine stops flagging what its own crew says is ordinary.

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
  // One row per building: learning counts readings from this date on (a reset).
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS learning_reset (
       building_id INTEGER PRIMARY KEY, since TEXT NOT NULL, reset_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  ).run();
  ready.add(env.DB);
}

// The first inspection day that counts toward what a building's machines have learned.
export async function learningStart(env, buildingId) {
  try {
    await ensureLearnedTable(env);
    const row = await env.DB.prepare("SELECT since FROM learning_reset WHERE building_id = ?").bind(buildingId).first();
    return row?.since || "0000-00-00";
  } catch {
    return "0000-00-00";
  }
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

// Called for every reading the super calls normal. Only a reading that was
// flagged for being outside its own machine's range teaches anything: a
// manager's min/max is the manager's call, and a "doesn't look like a real
// number" flag is not something to learn from.
//   deviation: { basis, state, lo, hi } as evaluateDeviation returned it
export async function learnFromNormal(env, { tagId, value, deviation }) {
  if (!deviation || deviation.basis !== "trend") return null;
  const v = Number.parseFloat(value);
  if (!Number.isFinite(v) || deviation.lo == null || deviation.hi == null) return null;
  await ensureLearnedTable(env);
  const state = deviation.state || "";
  const existing = await env.DB.prepare("SELECT lo, hi FROM learned_ranges WHERE tag_id = ? AND state = ?")
    .bind(tagId, state)
    .first();
  const lo = Math.min(existing?.lo ?? deviation.lo, deviation.lo, v);
  const hi = Math.max(existing?.hi ?? deviation.hi, deviation.hi, v);
  await env.DB.prepare(
    `INSERT INTO learned_ranges (tag_id, state, lo, hi, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT (tag_id, state) DO UPDATE SET lo = excluded.lo, hi = excluded.hi, updated_at = CURRENT_TIMESTAMP`,
  )
    .bind(tagId, state, lo, hi)
    .run();
  return { lo, hi };
}
