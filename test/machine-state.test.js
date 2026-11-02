import test from "node:test";
import assert from "node:assert/strict";
import { evaluateDeviation, stateTagIdsFor, readingState } from "../worker/deviation.js";
import { sendAbnormalAlert, alertRecipients } from "../worker/abnormal-alert.js";

const stats = (min, max, days = 3) => ({ count: days, days, avg: (min + max) / 2, min, max });
const inlet = { id: 5, unit: "°", reading_type: "Inlet temperature", value_type: "numeric", tag_no: "Boiler: H1A", system_name: "Building Heating", equipment_group_id: 50, sort_order: 5 };
const onOff = { id: 4, value_type: "on_off", tag_no: "Boiler: H1A", system_name: "Building Heating", equipment_group_id: null, sort_order: 4 };

test("the same number is fine when the boiler is off and a flag when it is on", () => {
  const off = evaluateDeviation(inlet, "143", stats(140, 144), null, "off");
  const on = evaluateDeviation(inlet, "143", stats(149, 151), null, "on");
  assert.equal(off, null);
  assert.equal(on.basis, "trend");
  assert.equal(on.state, "on");
});

test("after 3 days the range is exact: no plus or minus", () => {
  assert.equal(evaluateDeviation(inlet, "149", stats(149, 151), null, "on"), null);
  assert.equal(evaluateDeviation(inlet, "151", stats(149, 151), null, "on"), null);
  const above = evaluateDeviation(inlet, "152", stats(149, 151), null, "on");
  assert.equal(above.basis, "trend");
  assert.equal(above.change, 1);
  assert.match(above.detail, /149–151 °; this is 1 above/);
  assert.equal(evaluateDeviation(inlet, "148", stats(149, 151), null, "on").change, -1);
});

test("the first 3 days only observe", () => {
  assert.equal(evaluateDeviation(inlet, "300", stats(149, 151, 2), null, "on")?.basis ?? null, null);
});

test("a value the crew called normal widens the range exactly to it", () => {
  assert.equal(evaluateDeviation(inlet, "154", stats(149, 151), null, "on").basis, "trend");
  assert.equal(evaluateDeviation(inlet, "154", stats(149, 151), { lo: 149, hi: 154 }, "on"), null);
  assert.equal(evaluateDeviation(inlet, "155", stats(149, 151), { lo: 149, hi: 154 }, "on").basis, "trend");
});

test("outside temperature and meters are never learned, only sanity-checked", () => {
  const outside = { id: 9, unit: "°", reading_type: "Outside temperature", value_type: "numeric", tag_no: null, system_name: "General" };
  assert.equal(evaluateDeviation(outside, "21", stats(-1, 2), null, ""), null);
  const meter = { id: 10, unit: "", reading_type: "Water meter", value_type: "numeric", tag_no: "WM1", system_name: "Utilities" };
  assert.equal(evaluateDeviation(meter, "100500", stats(100000, 100400), null, ""), null);
});

test("calling a flagged value normal stores the exact value as the new edge", async () => {
  const { learnFromNormal } = await import("../worker/learned-ranges.js");
  let stored;
  const env = { DB: { prepare(sql) { return { bind(...args) { this.args = args; return this; },
    async run() { if (sql.startsWith("INSERT INTO learned_ranges")) stored = this.args; }, async first() { return null; } }; } } };
  const result = await learnFromNormal(env, { tagId: 5, value: "154", deviation: { basis: "trend", state: "on", lo: 149, hi: 151 } });
  assert.deepEqual(result, { lo: 149, hi: 154 });
  assert.deepEqual(stored, [5, "on", 149, 154]);
});

test("a machine's state is found by group or by matching tag number", () => {
  const idsFor = stateTagIdsFor([onOff, inlet]);
  assert.deepEqual(idsFor(inlet), [4]);
  assert.deepEqual(idsFor(onOff), []);
  const answers = { 4: " Off " };
  assert.equal(readingState(inlet, idsFor, (id) => answers[id]), "off");
  assert.equal(readingState(inlet, idsFor, () => ""), "");
});

test("abnormal readings are emailed to the test PM, on submit only for those marked abnormal", async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ contact: { id: "c1" } }), { status: 200 });
  };
  try {
    const env = {
      GHL_API_BASE: "https://ghl.test", GHL_API_KEY: "k", GHL_LOCATION_ID: "l",
      DB: { prepare(sql) { return { bind() { return this; },
        async first() { return { name: "Test Tower" }; },
        async all() { return { results: [{ id: 5, system_name: "Building Heating", tag_no: "Boiler: H1A", reading_type: "Inlet temperature", unit: "°", group_name: "Boiler H1", value: "154°F", deviation: JSON.stringify({ state: "on", detail: "Usually about 150; this is up 4" }) }] }; } }; } },
    };
    assert.deepEqual(alertRecipients(env), ["lucas.garcia.gla@gmail.com"]);
    const result = await sendAbnormalAlert(env, { buildingId: 1, submissionId: 9, superName: "Jordan Lee", abnormalTagIds: [5] });
    assert.equal(result.sent, 1);
    const email = calls.find((c) => c.url.endsWith("/conversations/messages"));
    assert.match(email.body.subject, /Abnormal reading at Test Tower/);
    assert.match(email.body.html, /154°F/);
    assert.match(email.body.html, /machine was on/);
    assert.equal((await sendAbnormalAlert(env, { buildingId: 1, submissionId: 9, abnormalTagIds: [] })).sent, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a reset makes learning count only readings from its start date", async () => {
  const { loadBaselines } = await import("../worker/deviation.js");
  const seen = [];
  const env = { DB: { prepare(sql) { return { bind(...args) { seen.push({ sql, args }); return this; },
    async run() {}, async first() { return { since: "2026-10-29" }; }, async all() { return { results: [] }; } }; } } };
  await loadBaselines(env, 4, "2026-10-30");
  const q = seen.find((c) => c.sql.includes("FROM inspection_readings r"));
  assert.deepEqual(q.args, [4, "2026-10-29", "2026-10-30"]);
});
