import test from "node:test";
import assert from "node:assert/strict";
import { mergeDuplicateTasks, duplicateCount } from "../shared/task-dedupe.js";

const t = (title, days, over = {}) => ({ title, location: "", startTime: "", endTime: "", days, ...over });

test("the same task listed once per day becomes one task with all the days", () => {
  const { tasks, merged } = mergeDuplicateTasks([t("Mop lobby floors", ["Mon"]), t("Mop lobby floors", ["Wed"]), t("Mop lobby floors", ["Fri"])]);
  assert.equal(tasks.length, 1);
  assert.deepEqual(tasks[0].days, ["Mon", "Wed", "Fri"]);
  assert.equal(merged, 2);
});
test("capitalisation, plurals and punctuation don't make a new task", () => {
  assert.equal(mergeDuplicateTasks([t("Mop lobby floors", ["Mon"]), t("mop Lobby floor.", ["Tue"])]).tasks.length, 1);
});
test("same task at a different time of day stays separate", () => {
  const { tasks } = mergeDuplicateTasks([t("Empty garbage", ["Mon"], { endTime: "10:00" }), t("Empty garbage", ["Mon"], { endTime: "16:00" })]);
  assert.equal(tasks.length, 2);
});
test("same title in a different place stays separate", () => {
  assert.equal(mergeDuplicateTasks([t("Vacuum", ["Mon"], { location: "Floor 2" }), t("Vacuum", ["Mon"], { location: "Floor 3" })]).tasks.length, 2);
});
test("the first row's settings win and notes are kept", () => {
  const a = t("Clean elevators", ["Mon"], { id: 7 });
  const { tasks } = mergeDuplicateTasks([a, t("Clean elevators", ["Tue"], { details: "Use the glass cleaner" })]);
  assert.equal(tasks[0].id, 7);
  assert.equal(tasks[0].details, "Use the glass cleaner");
});
test("duplicateCount warns without changing anything", () => {
  const list = [t("A", ["Mon"]), t("A", ["Tue"]), t("B", ["Mon"])];
  assert.equal(duplicateCount(list), 1);
  assert.equal(list.length, 3);
  assert.deepEqual(list[0].days, ["Mon"]);
});
test("blank rows are left alone", () => {
  assert.equal(mergeDuplicateTasks([t("", ["Mon"]), t("", ["Tue"])]).tasks.length, 2);
});
