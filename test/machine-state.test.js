import test from "node:test";
import assert from "node:assert/strict";
import { evaluateDeviation, stateTagIdsFor, readingState } from "../worker/deviation.js";
import { sendAbnormalAlert, alertRecipients } from "../worker/abnormal-alert.js";

const stats = (avg) => ({ count: 4, avg, stdev: 0.7, min: avg - 1, max: avg + 1 });
const inlet = { id: 5, unit: "°", reading_type: "Inlet temperature", value_type: "numeric", tag_no: "Boiler: H1A", system_name: "Building Heating", equipment_group_id: 50, sort_order: 5, tolerance: 3 };
const onOff = { id: 4, value_type: "on_off", tag_no: "Boiler: H1A", system_name: "Building Heating", equipment_group_id: null, sort_order: 4 };

test("the same number is fine when the boiler is off and a flag when it is on", () => {
  const off = evaluateDeviation(inlet, "143", stats(141), null, "off");
  const on = evaluateDeviation(inlet, "143", stats(150), null, "on");
  assert.equal(off, null);
  assert.equal(on.basis, "trend");
  assert.equal(on.state, "on");
});

test("a range the crew marked normal stops the flag", () => {
  assert.equal(evaluateDeviation(inlet, "154", stats(150), null, "on").basis, "trend");
  assert.equal(evaluateDeviation(inlet, "154", stats(150), { lo: 147, hi: 157 }, "on"), null);
  assert.equal(evaluateDeviation(inlet, "158", stats(150), { lo: 147, hi: 157 }, "on").basis, "trend");
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
