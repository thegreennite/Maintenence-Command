// What a machine has shown it does, and whether a new reading is outside it.
// Shared by the app (to question the value on the spot) and the Worker (to
// record it at submit and in the weekly report), so they can never disagree.
//
// The rule Lucas set:
// - Every machine reading is observed for its first OBSERVE_DAYS inspection
//   days (per on/off/auto state). Nothing is flagged for drift while it learns,
//   so the crew has to enter the genuine values.
// - After that, normal is EXACTLY the lowest-to-highest value the machine has
//   actually read in that state. No plus-or-minus margin: anything below the
//   lowest or above the highest is flagged.
// - When the super says a flagged value is normal, the range stretches to that
//   exact value, straight away.
// - Readings that aren't a machine (outside temperature and other weather /
//   building-wide readings) swing on their own, so they are never learned --
//   only the common-sense check applies to them.

export const OBSERVE_DAYS = 3;

const NOT_A_MACHINE = /\b(outside|outdoor|ambient|weather|exterior)\b/i;

// Judged by name, not by whether the reading has a machine tag: tank levels and
// room temperatures often come off the paper sheet with no tag number but still
// belong to the plant room.
export function isMachineReading(tag) {
  return !NOT_A_MACHINE.test(`${tag.system_name || ""} ${tag.tag_no || ""} ${tag.reading_type || ""}`);
}

// Water, gas and electrical meters are running totals that only ever climb, so
// "outside what it has read before" is every single day for them.
export function isCumulativeMeter(tag) {
  return /\bmeter\b/i.test(`${tag.system_name || ""} ${tag.reading_type || ""}`);
}

// Whether this reading learns a range and gets drift flags at all.
export function rangeMonitored(tag) {
  if (tag.monitor_trend === 0) return false;
  if (tag.value_type && tag.value_type !== "numeric") return false;
  if (isCumulativeMeter(tag)) return false;
  return isMachineReading(tag);
}

// The allowed range: what the machine has read (history.min..history.max),
// widened by anything the super has called normal (learned.lo..learned.hi).
export function allowedRange(history, learned) {
  if (!history) return null;
  return {
    lo: Math.min(history.min, learned?.lo ?? Infinity),
    hi: Math.max(history.max, learned?.hi ?? -Infinity),
  };
}

const round = (n) => Math.round(n * 100) / 100;

// null when the value is inside the machine's range (or it can't be judged yet),
// otherwise { lo, hi, change } -- change is how far outside, negative when below.
export function outsideRange(rawValue, history, learned) {
  if (!history || (history.days ?? history.count ?? 0) < OBSERVE_DAYS) return null;
  const num = Number.parseFloat(String(rawValue ?? "").replace(/,/g, ""));
  if (!Number.isFinite(num)) return null;
  const { lo, hi } = allowedRange(history, learned);
  if (num >= lo && num <= hi) return null;
  return { lo: round(lo), hi: round(hi), change: round(num > hi ? num - hi : num - lo) };
}

export function rangeText(lo, hi, unit) {
  const u = unit ? ` ${unit}` : "";
  return lo === hi ? `${lo}${u}` : `${lo}–${hi}${u}`;
}

// "Normal so far is 140–151 °; this is 3 above."
export function outsideDetail(out, unit, state) {
  const when = state ? ` when ${state}` : "";
  return `Normal for this machine${when} is ${rangeText(out.lo, out.hi, unit)}; this is ${Math.abs(out.change)} ${out.change > 0 ? "above" : "below"}`;
}
