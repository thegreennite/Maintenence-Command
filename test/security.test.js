import test from "node:test";
import assert from "node:assert/strict";
import { hashToken, hexToBytes, verifyPassword } from "../worker/security.js";

test("hexToBytes accepts valid hexadecimal values", () => {
  assert.deepEqual([...hexToBytes("00ff10")], [0, 255, 16]);
});

test("hexToBytes rejects malformed values", () => {
  assert.throws(() => hexToBytes("xyz"), /Invalid hexadecimal/);
});

test("seed password verification succeeds and rejects a wrong password", async () => {
  const salt = "af7afb5593e443f741b84ccb292e5e5d";
  const hash = "e5d8400a890979525e7328f6f4fa8ec111eaa58d5958b326d517f176939d5489";
  assert.equal(await verifyPassword("Ops!Alex2026", salt, hash), true);
  assert.equal(await verifyPassword("wrong", salt, hash), false);
});

test("token hashing is deterministic", async () => {
  assert.equal(await hashToken("session-token"), await hashToken("session-token"));
  assert.notEqual(await hashToken("session-token"), await hashToken("other-token"));
});
