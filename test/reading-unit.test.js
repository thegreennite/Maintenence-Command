import test from "node:test";
import assert from "node:assert/strict";
import { splitReading, withTempUnit, readingParts, readingText } from "../shared/reading-unit.js";
import { plausibilityFlag } from "../shared/plausibility.js";

test("Fahrenheit and Celsius are saved exactly as typed, with their scale", () => {
  assert.equal(withTempUnit("72", "F"), "72°F");
  assert.equal(withTempUnit("21.5", "C"), "21.5°C");
  assert.equal(withTempUnit("72°F", "F"), "72°F");
});

test("nothing is converted when the number comes back out", () => {
  assert.deepEqual(splitReading("72°F"), { number: "72", unit: "F" });
  assert.deepEqual(splitReading("72 °f"), { number: "72", unit: "F" });
  assert.deepEqual(splitReading("55"), { number: "55", unit: null });
});

test("non-numbers and unknown scales are left alone", () => {
  assert.equal(withTempUnit("hand", "F"), "hand");
  assert.equal(withTempUnit("72", null), "72");
});

test("display uses the reading's own scale, else the gauge unit", () => {
  assert.equal(readingText("72°F", "°"), "72°F");
  assert.equal(readingText("72", "°"), "72°");
  assert.equal(readingText("55", "psi"), "55 psi");
  assert.deepEqual(readingParts("72°F", "°"), { number: "72", unit: "°F" });
});

test("the suffix does not upset the plausibility check", () => {
  const tag = { value_type: "numeric", unit: "°", system_name: "Boiler", reading_type: "Supply temp" };
  assert.equal(plausibilityFlag(tag, "180°F", null), null);
  assert.ok(plausibilityFlag(tag, "9000°F", null));
});
