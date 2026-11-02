// Per-account add-ons the admin switches on from the accounts panel.
// Right now there's one: "scheduling" (cleaning/duty schedules and the
// day's task checklist). It's off for everyone by default -- clients get
// Inspect Funnels on its own, and scheduling is added to specific
// accounts. Turning it off only hides it: schedules, tasks and completion
// history all stay in the database.
//
// Kept in its own table (created on demand, like learned_ranges) rather
// than a users column, because company databases have no migration
// tooling and ALTER TABLE ADD COLUMN can't be made idempotent.

export const FEATURES = { scheduling: "Schedules" };

const ready = new WeakSet();

async function ensureFeatureTable(db) {
  if (ready.has(db)) return;
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS feature_access (
         user_id INTEGER NOT NULL,
         feature TEXT NOT NULL,
         enabled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
         PRIMARY KEY (user_id, feature)
       )`,
    )
    .run();
  ready.add(db);
}

export async function hasFeature(db, userId, feature) {
  if (!userId) return false;
  await ensureFeatureTable(db);
  const row = await db.prepare("SELECT 1 AS on_ FROM feature_access WHERE user_id = ? AND feature = ?").bind(userId, feature).first();
  return Boolean(row);
}

export async function usersWithFeature(db, feature) {
  await ensureFeatureTable(db);
  const rows = await db.prepare("SELECT user_id FROM feature_access WHERE feature = ?").bind(feature).all();
  return new Set(rows.results.map((row) => row.user_id));
}

// Admins always have scheduling; everyone else needs it switched on.
export function canUseScheduling(session) {
  return session?.role === "admin" || session?.scheduling === true;
}

export async function handleSetFeature(request, session, env, corsHeaders) {
  if (session.role !== "admin") return jsonError("Administrator access required.", 403, corsHeaders);
  const body = await request.json().catch(() => ({}));
  const userId = Number.parseInt(body.userId, 10);
  const feature = String(body.feature || "");
  if (!FEATURES[feature]) return jsonError("Not a valid feature.", 400, corsHeaders);
  const user = await env.DB.prepare("SELECT id FROM users WHERE id = ? AND is_active = 1").bind(userId).first();
  if (!user) return jsonError("Account not found.", 404, corsHeaders);

  await ensureFeatureTable(env.DB);
  await env.DB.prepare(
    body.enabled
      ? "INSERT OR IGNORE INTO feature_access (user_id, feature) VALUES (?, ?)"
      : "DELETE FROM feature_access WHERE user_id = ? AND feature = ?",
  )
    .bind(userId, feature)
    .run();
  return jsonOk({ ok: true }, corsHeaders);
}

function jsonOk(data, headers) {
  return new Response(JSON.stringify(data), { status: 200, headers: withJsonHeaders(headers) });
}

function jsonError(message, status, headers) {
  return new Response(JSON.stringify({ error: message }), { status, headers: withJsonHeaders(headers) });
}

function withJsonHeaders(headers) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json; charset=utf-8");
  responseHeaders.set("Cache-Control", "no-store");
  return responseHeaders;
}
