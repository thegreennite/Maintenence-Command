// Dynamic per-company database access. Forest Hill Group uses the fast
// native "DB" Worker binding directly; every other (future) company is
// routed through Cloudflare's D1 HTTP API by database_id, since a
// Worker's bindings are fixed at deploy time and a brand-new company's
// database can't be added as a real binding without a redeploy.
//
// Every handler in this app takes `env` and calls `env.DB.prepare(...)`.
// Nothing about that changes -- what changes is what object gets passed
// in as `env` for a given request: index.js resolves the right company
// first, then calls handlers with a shallow-cloned env whose `.DB` is
// either the real binding (Forest Hill Group) or an HttpD1 instance
// (every other company) that speaks the identical
// prepare().bind().first()/all()/run()/batch() shape.

import { createSessionToken, hashToken } from "./security.js";

const CF_API = "https://api.cloudflare.com/client/v4";

// The same schema migration 0018 gave Forest Hill Group's database --
// reused for every brand-new company so the plan/client_id columns
// worker/*.js already relies on exist identically everywhere. Schema
// only; the self-describing row itself is inserted separately with
// real bound parameters (see provisionCompanyDatabase below).
const LOCAL_CLIENT_SCHEMA_SQL = `
CREATE TABLE clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'basic',
  building_limit INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE users ADD COLUMN client_id INTEGER REFERENCES clients(id);
ALTER TABLE buildings ADD COLUMN client_id INTEGER REFERENCES clients(id);
ALTER TABLE sessions ADD COLUMN active_client_id INTEGER REFERENCES clients(id);
`;

class HttpD1Statement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.params = [];
  }
  bind(...params) {
    this.params = params;
    return this;
  }
  async first() {
    const result = await this.db._query(this.sql, this.params);
    return result.results?.[0] ?? null;
  }
  async all() {
    const result = await this.db._query(this.sql, this.params);
    return { results: result.results || [] };
  }
  async run() {
    const result = await this.db._query(this.sql, this.params);
    return { meta: result.meta || {}, success: true };
  }
}

export class HttpD1 {
  constructor(env, databaseId) {
    this.env = env;
    this.databaseId = databaseId;
  }
  prepare(sql) {
    return new HttpD1Statement(this, sql);
  }
  // Cloudflare's D1 HTTP API has no separate "batch" endpoint -- statements
  // run sequentially instead of atomically. Nothing that currently calls
  // env.DB.batch() in this app straddles a failure boundary that matters
  // (each statement writes independent rows); revisit if that changes.
  async batch(statements) {
    const results = [];
    for (const stmt of statements) results.push(await stmt.run());
    return results;
  }
  async _query(sql, params) {
    const response = await fetch(`${CF_API}/accounts/${this.env.CLOUDFLARE_ACCOUNT_ID}/d1/database/${this.databaseId}/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.env.CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sql, params }),
    });
    const body = await response.json();
    if (!body.success) {
      throw new Error(body.errors?.[0]?.message || `D1 HTTP query failed for database ${this.databaseId}.`);
    }
    return body.result?.[0] || { results: [], meta: {} };
  }
}

// Resolves a client row + an env.DB-shaped client for it. Returns null
// if the client doesn't exist or has been suspended.
export async function dbForClient(env, clientId) {
  const client = await env.CONTROL_DB.prepare(
    "SELECT id, name, plan, building_limit, status, database_kind, database_id, database_name FROM clients WHERE id = ?",
  )
    .bind(clientId)
    .first();
  if (!client || client.status !== "active") return null;

  const db = client.database_kind === "native" ? env.DB : new HttpD1(env, client.database_id);
  return { client, db };
}

// The agency account's real identity inside a given company's own
// database -- role 'admin' so it sees exactly what that company's own
// admin sees, everywhere in worker/*.js, with zero special-casing.
// Unguessable password (nobody knows it, it's never used -- this
// account is only ever reached via the separate agency login) and never
// added to login_directory, so it can't be signed into directly.
const AGENCY_LOCAL_USERNAME = "__agency__";

export async function ensureAgencyUserRow(db) {
  const existing = await db.prepare("SELECT id FROM users WHERE username = ?").bind(AGENCY_LOCAL_USERNAME).first();
  if (existing) return existing.id;

  const randomHex = (bytes) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
  const insert = await db
    .prepare(
      `INSERT INTO users (username, password_hash, password_salt, full_name, job_title, role, building_access, status, is_active, client_id)
       VALUES (?, ?, ?, 'Agency', 'Agency (Power Log Command)', 'admin', 'all', 'active', 1, 1)`,
    )
    .bind(AGENCY_LOCAL_USERNAME, randomHex(32), randomHex(16))
    .run();
  return insert.meta.last_row_id;
}

// Creates a real session row for the agency's local identity in `db` --
// gives handleImpersonate/handleAdminReturn a genuine row to mutate, the
// same as any other admin session. Returns the new session's id.
export async function createAgencyCompanySession(db) {
  const agencyUserId = await ensureAgencyUserRow(db);
  const token = createSessionToken();
  const tokenHash = await hashToken(token);
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  const insert = await db
    .prepare("INSERT INTO sessions (token_hash, user_id, actor_user_id, expires_at) VALUES (?, ?, ?, ?)")
    .bind(tokenHash, agencyUserId, agencyUserId, expiresAt)
    .run();
  return insert.meta.last_row_id;
}

// The control-plane id of the one "native" client (Forest Hill Group) --
// used by the pre-session endpoints in worker/registration.js, which
// only ever run against the static "DB" binding (there's no way yet to
// self-register into any other company), so they need this to record a
// login_directory entry without hardcoding the number 1 and hoping it
// stays true.
export async function getNativeClientId(env) {
  const row = await env.CONTROL_DB.prepare("SELECT id FROM clients WHERE database_kind = 'native' LIMIT 1").first();
  return row?.id ?? null;
}

// Looks up which client a login identifier (email, or a legacy plain
// username) belongs to -- used at login time, before any session or
// client context exists yet. Kept in sync (see recordLoginDirectory)
// whenever a user is created in any company's database.
export async function clientForIdentifier(env, identifier) {
  const normalized = String(identifier || "").trim().toLowerCase();
  if (!normalized) return null;
  const row = await env.CONTROL_DB.prepare("SELECT client_id FROM login_directory WHERE email = ?")
    .bind(normalized)
    .first();
  return row?.client_id ?? null;
}

export async function recordLoginDirectory(env, identifier, clientId) {
  const normalized = String(identifier || "").trim().toLowerCase();
  if (!normalized) return;
  await env.CONTROL_DB.prepare(
    `INSERT INTO login_directory (email, client_id) VALUES (?, ?)
     ON CONFLICT (email) DO UPDATE SET client_id = excluded.client_id`,
  )
    .bind(normalized, clientId)
    .run();
}

// Provisions a brand-new company: creates its D1 database via
// Cloudflare's API, runs every migration file in migrationSql (in
// order) against it, and registers it in the control-plane clients
// table. Returns the new client row. Used by the self-serve "Add a
// business" flow (see handleCreateBusiness in worker/clients.js) --
// this is the one path where a company's database is created at
// runtime rather than by hand with wrangler.
export async function provisionCompanyDatabase(env, { name, plan, buildingLimit, migrationSql }) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "company";
  const databaseName = `plc-${slug}-${Date.now().toString(36)}`;

  const createResponse = await fetch(`${CF_API}/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/d1/database`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: databaseName }),
  });
  const createBody = await createResponse.json();
  if (!createBody.success) {
    throw new Error(createBody.errors?.[0]?.message || "Couldn't create a database for this company.");
  }
  const databaseId = createBody.result.uuid;
  const db = new HttpD1(env, databaseId);

  // Run every migration statement-by-statement (D1's HTTP query endpoint
  // takes one statement per call) against the freshly created database.
  // migrationSql is this app's own trusted schema files (0001-0017) --
  // never anything derived from user input.
  for (const sql of migrationSql) {
    for (const statement of splitSqlStatements(sql)) {
      await db.prepare(statement).run();
    }
  }

  // The base schema files carry leftover demo/seed data from this app's
  // very first development pass -- fixed-username accounts with known,
  // hardcoded password hashes (0001, 0005), plus a demo "Harbour Point"
  // building (0002). Fine for Forest Hill Group's own database (already
  // long since real, moderated data), but replaying those into a
  // brand-new company verbatim would ship every self-serve signup with a
  // working, publicly-known admin backdoor -- so strip them immediately,
  // before any real account gets created.
  // Order matters: the demo superintendent(s) have building_id pointing
  // at Harbour Point, so the seed users have to go before the building
  // itself can be deleted without tripping that foreign key.
  await db.prepare("DELETE FROM inspection_tags WHERE building_id IN (SELECT id FROM buildings WHERE name = 'Harbour Point')").run();
  await db
    .prepare("DELETE FROM users WHERE username IN ('admin', 'alex.kim', 'jordan.lee', 'taylor.morgan', 'sam.rivera')")
    .run();
  await db.prepare("DELETE FROM buildings WHERE name = 'Harbour Point'").run();

  // Every company database keeps a single self-describing row in its own
  // local `clients` table (same shape migration 0018 gave Forest Hill
  // Group) so the plan/building_limit checks already written throughout
  // worker/*.js keep working unchanged, without needing yet another
  // rewrite -- effectiveClientId(session) for a plain company user always
  // resolves to this local id 1, same as it always has for FHG. The
  // control-plane `clients` row (inserted below) is the separate,
  // authoritative cross-company registry the agency account reads.
  for (const statement of splitSqlStatements(LOCAL_CLIENT_SCHEMA_SQL)) {
    await db.prepare(statement).run();
  }
  // Parameterized, unlike the schema statements above -- `name` is
  // untrusted signup input and must never be spliced into raw SQL text.
  await db
    .prepare("INSERT INTO clients (id, name, plan, building_limit) VALUES (1, ?, ?, ?)")
    .bind(name, plan, buildingLimit)
    .run();

  const insert = await env.CONTROL_DB.prepare(
    `INSERT INTO clients (name, plan, building_limit, status, database_kind, database_id, database_name)
     VALUES (?, ?, ?, 'active', 'http', ?, ?)`,
  )
    .bind(name, plan, buildingLimit, databaseId, databaseName)
    .run();

  const client = await env.CONTROL_DB.prepare("SELECT * FROM clients WHERE id = ?")
    .bind(insert.meta.last_row_id)
    .first();
  return { client, db };
}

// Cloudflare's D1 HTTP query endpoint takes one SQL statement per
// call -- migration files are one semicolon-separated statement after
// another (with "--" line comments), so split naively on ";" after
// stripping comment lines. Good enough for this app's own migrations,
// which don't use semicolons inside string literals or triggers.
function splitSqlStatements(sql) {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}
