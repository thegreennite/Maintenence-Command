import test from "node:test";
import assert from "node:assert/strict";
import { plausibilityFlag } from "../shared/plausibility.js";

const tag = (over = {}) => ({ value_type: "numeric", unit: "", system_name: "Boiler", reading_type: "Speed", ...over });

test("a million on a gauge with no range and no history is questioned", () => {
  assert.ok(plausibilityFlag(tag({ unit: "RPM" }), "1000000", null));
  assert.ok(plausibilityFlag(tag(), "1000000", null));
  assert.ok(plausibilityFlag(tag(), "1,000,000", null));
});
test("physically impossible values for the unit are questioned", () => {
  assert.ok(plausibilityFlag(tag({ unit: "%" }), "150", null));
  assert.ok(plausibilityFlag(tag({ unit: "%" }), "-3", null));
  assert.ok(plausibilityFlag(tag({ unit: "°F" }), "9000", null));
  assert.ok(plausibilityFlag(tag({ unit: "PSI" }), "99999", null));
  assert.ok(plausibilityFlag(tag({ unit: "", reading_type: "INTEL PRESS." }), "50000", null));
});
test("normal values pass", () => {
  assert.equal(plausibilityFlag(tag({ unit: "PSI" }), "62", "60"), null);
  assert.equal(plausibilityFlag(tag({ unit: "%" }), "100", null), null);
  assert.equal(plausibilityFlag(tag({ unit: "RPM" }), "1780", "1775"), null);
  assert.equal(plausibilityFlag(tag({ unit: "RPM" }), "0", "1775"), null, "a standby pump reading zero is normal");
  assert.equal(plausibilityFlag(tag({ unit: "Hz" }), "60", null), null);
});
test("a 10x jump or a missing digit against the last reading is questioned", () => {
  assert.ok(plausibilityFlag(tag({ unit: "RPM" }), "17800", "1780"));
  assert.ok(plausibilityFlag(tag({ unit: "PSI" }), "6", "60"));
});
test("meters only count up", () => {
  const meter = tag({ system_name: "Water Meter", reading_type: "Reading 2" });
  assert.equal(plausibilityFlag(meter, "13720", "13700"), null);
  assert.ok(plausibilityFlag(meter, "136962", "13700"), "the 136,962 typo in real data");
  assert.ok(plausibilityFlag(meter, "13000", "13700"), "went down");
  assert.equal(plausibilityFlag(meter, "2300000", "2290000"), null, "a genuinely huge running total is fine");
});
test("non-numeric reading types are never judged", () => {
  assert.equal(plausibilityFlag(tag({ value_type: "on_off" }), "1000000", null), null);
});
