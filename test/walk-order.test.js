import test from "node:test";
import assert from "node:assert/strict";
import { walkOrder, previewNewReading } from "../shared/walk-order.js";

const t = (id, sort_order, equipment_group_id = null) => ({ id, sort_order, equipment_group_id });
// Boiler (group 1) first scanned at 0, a loose gauge at 1, pump (group 2) at 2, boiler's other reading scanned late at 5.
const tags = [t("a", 0, 1), t("b", 1), t("c", 2, 2), t("d", 3, 2), t("e", 5, 1)];

test("a machine is walked as one block at its earliest reading's position", () => {
  assert.deepEqual(walkOrder(tags).map((x) => x.id), ["a", "e", "b", "c", "d"]);
});
test("a new reading in a machine lands last inside that machine", () => {
  const p = previewNewReading(tags, 2);
  assert.equal(p.position, 6);
  assert.equal(p.after.id, "d");
  assert.equal(p.before, null);
});
test("a new reading in the first machine lands at the end of that machine, before the next item", () => {
  const p = previewNewReading(tags, 1);
  assert.equal(p.position, 3);
  assert.equal(p.after.id, "e");
  assert.equal(p.before.id, "b");
});
test("a new ungrouped reading goes to the very end", () => {
  const p = previewNewReading(tags, null);
  assert.equal(p.position, 6);
  assert.equal(p.total, 6);
  assert.equal(p.after.id, "d");
});
test("an empty checklist puts it first", () => {
  assert.deepEqual(previewNewReading([], null), { position: 1, total: 1, after: null, before: null });
});
