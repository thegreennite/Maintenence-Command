// One task, one row. The AI (or a person re-typing a paper schedule) can
// list the same task more than once -- once per day, once per page, with a
// plural or different capitalisation. Rows that are the same task at the
// same place and time are merged into one, with their days combined.

const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// "Mop lobby floors" and "mop Lobby floor." are the same task.
function normText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w))
    .join(" ");
}

export function taskKey({ title, location, startTime, endTime }) {
  return [normText(title), normText(location), startTime || "", endTime || ""].join("|");
}

const sortDays = (days) => DAY_ORDER.filter((d) => days.includes(d));

// tasks: [{ title, location, startTime, endTime, days: [..], ... }]
// Keeps the first of each group (so its id / details / settings win),
// unions the days, and reports how many rows were folded in.
export function mergeDuplicateTasks(tasks) {
  const byKey = new Map();
  const out = [];
  let merged = 0;
  for (const task of tasks) {
    if (!normText(task.title)) {
      out.push(task);
      continue;
    }
    const key = taskKey(task);
    const first = byKey.get(key);
    if (!first) {
      byKey.set(key, task);
      out.push(task);
      continue;
    }
    first.days = sortDays([...new Set([...(first.days || []), ...(task.days || [])])]);
    if (!first.details && task.details) first.details = task.details;
    merged += 1;
  }
  return { tasks: out, merged };
}

// Groups that would be merged, for showing a warning before doing it.
export function duplicateCount(tasks) {
  return mergeDuplicateTasks(tasks.map((t) => ({ ...t, days: [...(t.days || [])] }))).merged;
}
