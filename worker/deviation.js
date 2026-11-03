// One definition of "this reading is outside normal" for the whole app --
// the superintendent's prompts (via the tags payload), the nightly record
// stored at submit time, and the weekly report all go through here, so
// they can never disagree about what counts as a deviation.
//
// The rule (shared/machine-range.js): each machine reading is observed for
// its first 3 inspection days in each on/off/auto state, then anything below
// the lowest or above the highest value it has actually read is flagged --
// exact, no plus-or-minus. Manager-set min/max are optional and still win
// when they exist, from day one.
//
// Per machine state: a numeric reading is only compared with past readings
// taken while its machine was in the SAME on/off/auto (hand-off-auto,
// open/closed) state, and a value the crew has called "normal"
// (worker/learned-ranges.js) stretches the range to it.

import { plausibilityFlag } from "../shared/plausibility.js";
import { OBSERVE_DAYS, rangeMonitored, outsideRange, outsideDetail } from "../shared/machine-range.js";
import { STATE_KINDS, stateOf, learningStart } from "./learned-ranges.js";

export const MIN_BASELINE_DAYS = OBSERVE_DAYS;

// Whether this reading learns a range and gets drift flags at all.
export const trendMonitored = rangeMonitored;

// A machine's own on/off/auto-type reading(s): same equipment group, or the same
// system + tag number (checklists from paper sheets often leave the on/off line
// out of the group). Returns a function: reading -> [state reading ids, in checklist order].
export function stateTagIdsFor(tags) {
  const states = [...tags]
    .filter((t) => STATE_KINDS.includes(t.value_type))
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  return (tag) => {
    if (STATE_KINDS.includes(tag.value_type)) return [];
    return states
      .filter(
        (st) =>
          (tag.equipment_group_id != null && st.equipment_group_id === tag.equipment_group_id) ||
          (tag.tag_no && st.tag_no === tag.tag_no && (st.system_name || "") === (tag.system_name || "")),
      )
      .map((st) => st.id);
  };
}

// The state ("on", "off", "auto", "open"...) a numeric reading was taken in: the
// first answered on/off/auto-type reading of the same machine. "" when there is none.
export function readingState(tag, idsFor, valueOf) {
  for (const id of idsFor(tag)) {
    const state = stateOf(valueOf(id));
    if (state) return state;
  }
  return "";
}

// What a machine has read in one state: the exact lowest and highest, how many
// separate inspection days that covers (it observes for OBSERVE_DAYS of them
// before judging anything), and the middle value for display.
function rangeStats(entries) {
  const values = entries.map((e) => e.value).sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  return {
    count: values.length,
    days: new Set(entries.map((e) => e.date)).size,
    min: values[0],
    max: values[values.length - 1],
    avg: values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2,
  };
}

// What every numeric reading in a building has read before `date`: every
// submitted day since the building's learning start (never `date` itself, so
// a day is never judged against itself), kept separately for each state of the
// machine's on/off/auto answer ("" for a reading with no such answer). A state
// needs MIN_BASELINE_DAYS days before it gets a range at all, and readings the
// crew marked abnormal never count.
// Returns { [tagId]: { [state]: stats } }.
export async function loadBaselines(env, buildingId, date) {
  const since = await learningStart(env, buildingId);
  const sql = (skipAbnormal) => `SELECT r.tag_id, r.value, s.inspection_date,
       (SELECT LOWER(TRIM(cr.value)) FROM inspection_readings cr
          JOIN inspection_tags ct ON ct.id = cr.tag_id
         WHERE cr.submission_id = r.submission_id
           AND ((t.equipment_group_id IS NOT NULL AND ct.equipment_group_id = t.equipment_group_id)
             OR (t.tag_no IS NOT NULL AND ct.tag_no = t.tag_no AND COALESCE(ct.system_name, '') = COALESCE(t.system_name, '')))
           AND ct.answer_kind IN ('on_off','hoa','open_closed') AND TRIM(COALESCE(cr.value, '')) != ''
         ORDER BY ct.sort_order LIMIT 1) AS state
     FROM inspection_readings r
     JOIN inspection_submissions s ON s.id = r.submission_id
     JOIN inspection_tags t ON t.id = r.tag_id
     WHERE s.building_id = ? AND s.status = 'submitted'
       AND s.inspection_date >= ? AND s.inspection_date < ?
       AND t.answer_kind = 'numeric' AND r.value IS NOT NULL AND TRIM(r.value) != ''
       ${skipAbnormal ? `AND (r.deviation IS NULL OR r.deviation NOT LIKE '%"ack":"abnormal"%')
       AND r.id NOT IN (SELECT reading_id FROM learning_excluded)` : ""}`;
  let result;
  try {
    result = await env.DB.prepare(sql(true)).bind(buildingId, since, date).all();
  } catch {
    // A company database from before the deviation column existed: still judge, just without
    // leaving out the readings the crew called abnormal.
    result = await env.DB.prepare(sql(false)).bind(buildingId, since, date).all();
  }

  const values = new Map(); // `${tagId}|${state}` -> [{ value, date }]
  for (const row of result.results) {
    const num = Number.parseFloat(row.value);
    if (Number.isNaN(num)) continue;
    const key = `${row.tag_id}|${row.state ?? ""}`;
    if (!values.has(key)) values.set(key, []);
    values.get(key).push({ value: num, date: row.inspection_date });
  }

  const baselines = {};
  for (const [key, list] of values) {
    const stats = rangeStats(list);
    if (stats.days < MIN_BASELINE_DAYS) continue;
    const [tagId, state] = [Number(key.slice(0, key.indexOf("|"))), key.slice(key.indexOf("|") + 1)];
    (baselines[tagId] ||= {})[state] = stats;
  }
  return baselines;
}

// The most recent submitted value of every numeric reading before `date`
// (looking back two weeks) -- what the "does that number make sense?"
// check compares against, so even a reading with no 3-day baseline yet
// can be sanity-checked against the last time it was read.
export async function loadLastValues(env, buildingId, date) {
  const result = await env.DB.prepare(
    `SELECT r.tag_id, r.value
     FROM inspection_readings r
     JOIN inspection_submissions s ON s.id = r.submission_id
     JOIN inspection_tags t ON t.id = r.tag_id
     WHERE s.building_id = ? AND s.status = 'submitted'
       AND s.inspection_date >= date(?, '-14 days') AND s.inspection_date < ?
       AND t.answer_kind = 'numeric' AND r.value IS NOT NULL AND TRIM(r.value) != ''
     ORDER BY s.inspection_date DESC`,
  )
    .bind(buildingId, date, date)
    .all();
  const last = {};
  for (const row of result.results) {
    if (last[row.tag_id] === undefined && Number.isFinite(Number.parseFloat(String(row.value).replace(/,/g, "")))) last[row.tag_id] = row.value;
  }
  return last;
}

// Returns null when the reading is fine (or can't be judged), otherwise
// { basis, baseline, change, tolerance, detail }.
//   tag: { unit, reading_type, value_type, monitor_trend, parameter }
//   baseline: what this reading has read in its machine's current state (or null)
//   learned: { lo, hi } the crew has marked normal for this state (or null)
//   state: the on/off/auto answer the reading was taken in, recorded on the flag
export function evaluateDeviation(tag, rawValue, baseline, learned = null, state = "") {
  if (rawValue == null || String(rawValue).trim() === "") return null;
  const value = String(rawValue).trim();
  const parameter = tag.parameter;

  // A manager's own spec beats any learned baseline, and works from the
  // first day.
  if (parameter) {
    if (tag.value_type && tag.value_type !== "numeric") {
      if (parameter.expected && value.toLowerCase() !== String(parameter.expected).trim().toLowerCase()) {
        return { basis: "parameter", detail: `Expected "${parameter.expected}"` };
      }
      return null;
    }
    if (parameter.min != null && parameter.max != null) {
      const num = Number.parseFloat(value);
      if (Number.isNaN(num)) return { basis: "parameter", detail: "Not a number" };
      if (num < parameter.min || num > parameter.max) {
        return { basis: "parameter", detail: `Outside ${parameter.min}–${parameter.max}${tag.unit ? ` ${tag.unit}` : ""}` };
      }
      return null;
    }
  }

  if (tag.value_type && tag.value_type !== "numeric") return null;
  const sanity = () => {
    const odd = plausibilityFlag(tag, value, tag.last_value);
    return odd ? { basis: "plausibility", detail: odd.detail } : null;
  };
  if (!baseline || !trendMonitored(tag)) return sanity();

  const out = outsideRange(value, baseline, learned);
  if (!out) return sanity();
  return {
    basis: "trend",
    state,
    baseline: Math.round(baseline.avg * 100) / 100,
    lo: out.lo,
    hi: out.hi,
    change: out.change,
    detail: outsideDetail(out, tag.unit, state),
  };
}
