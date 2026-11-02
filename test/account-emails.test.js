import test from "node:test";
import assert from "node:assert/strict";
import { sendAccountEmail } from "../worker/account-emails.js";

function mockGhl() {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ contact: { id: "c1" } }), { status: 200 });
  };
  return calls;
}
const env = { GHL_API_BASE: "https://ghl.test", GHL_API_KEY: "k", GHL_LOCATION_ID: "l" };
const db = { prepare() { return { bind() { return this; }, async run() {} }; } };

test("a property manager gets a welcome email on sign-up", async () => {
  const real = globalThis.fetch;
  const calls = mockGhl();
  try {
    const r = await sendAccountEmail(env, db, { id: 17, full_name: "Lucas Garcia", email: "pm@example.com", role: "property_manager" }, "welcome", { buildingName: "Crest" });
    assert.equal(r.sent, true);
    const email = calls.find((c) => c.url.endsWith("/conversations/messages"));
    assert.match(email.body.subject, /Welcome to Inspect Funnels/);
    assert.match(email.body.html, /Property Manager<\/strong> account for <strong>Crest/);
  } finally {
    globalThis.fetch = real;
  }
});

test("a superintendent gets a 'request received' confirmation naming who approves", async () => {
  const real = globalThis.fetch;
  const calls = mockGhl();
  try {
    await sendAccountEmail(env, db, { id: 18, full_name: "Sam Super", email: "s@example.com", role: "superintendent" }, "received", { buildingName: "Crest" });
    const email = calls.find((c) => c.url.endsWith("/conversations/messages"));
    assert.match(email.body.subject, /received/);
    assert.match(email.body.html, /your operations manager for approval/);
  } finally {
    globalThis.fetch = real;
  }
});

test("no email on file, or email not set up: skipped without throwing", async () => {
  assert.equal((await sendAccountEmail({}, db, { email: "x@example.com" }, "welcome")).skipped, "ghl-not-configured");
  assert.equal((await sendAccountEmail(env, db, { username: "jordan.lee" }, "welcome")).skipped, "no-email");
});
