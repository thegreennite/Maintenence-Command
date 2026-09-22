import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hashToken, hexToBytes, verifyPassword } from "../worker/security.js";

test("hexToBytes accepts valid hexadecimal values", () => {
  assert.deepEqual([...hexToBytes("00ff10")], [0, 255, 16]);
});

test("hexToBytes rejects malformed values", () => {
  assert.throws(() => hexToBytes("xyz"), /Invalid hexadecimal/);
});

test("seed password verification succeeds and rejects a wrong password", async () => {
  const migration = readFileSync(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8');
  const [, hash, salt] = migration.match(/\('alex.kim', '([^']+)', '([^']+)'/);
  assert.equal(await verifyPassword("FHG-Manager-2026!", salt, hash), true);
  assert.equal(await verifyPassword("wrong", salt, hash), false);
});

test("token hashing is deterministic", async () => {
  assert.equal(await hashToken("session-token"), await hashToken("session-token"));
  assert.notEqual(await hashToken("session-token"), await hashToken("other-token"));
});
