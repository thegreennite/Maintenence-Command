// One definition of "this reading is outside normal" for the whole app --
// the superintendent's prompts (via the tags payload), the nightly record
// stored at submit time, and the weekly report all go through here, so
// they can never disagree about what counts as a deviation.
//
// The rule Lucas set: once a reading has 3 submitted days behind it,
// learn what "normal" is for that specific gauge, then flag any reading
// that moves past a real-world tolerance from it, in either direction
// (drops count the same as rises): 3 degrees for temperature, 5 PSI for
// pressure, 5 points for a percentage. Manager-set min/max still win
// when they exist, and apply from day one.

import { plausibilityFlag } from "../shared/plausibility.js";

export const MIN_BASELINE_DAYS = 3;
export const BASELINE_WINDOW_DAYS = 7;

// Unit first (what the AI checklist extraction fills in), then the
// reading's own name for gauges that came through with no unit at all
// (Crest's booster pumps read "INTEL PRESS." / "OUTLET PRESS." with a
// blank unit but are plainly pressures). Everything else (RPM, amps,
// Hz, kW, meters) deliberately has no fixed tolerance -- no real-world
// number to ground one on -- and falls back to the statistical rule.
export function inferTolerance(unit, readingType) {
  const u = (unit || "").trim().toLowerCase();
  if (u === "°" || u.includes("deg") || /^°?[cf]$/.test(u)) return 3;
  if (u === "psi") return 5;
  if (u === "%" || u === "percent") return 5;
  if (!u) {
    const name = (readingType || "").toLowerCase();
    if (/\bpress|\bpsi\b/.test(name)) return 5;
    if (/\btemp/.test(name)) return 3;
    if (/\bpercent|%/.test(name)) return 5;
  }
  return null;
}

// Utility meters (water, gas, electrical) are running totals that only
// ever climb, so "different from usual" means nothing for them -- every
// single day would look like a jump from the average of the days before.
function isCumulativeMeter(tag) {
  return /\bmeter\b/i.test(`${tag.system_name || ""} ${tag.reading_type || ""}`);
}

// Whether unusual day-to-day movement should be flagged for this reading
// at all. Only readings with a real-world tolerance (temperature,
// pressure, percentage) are -- RPM / amps / Hz / kW on a lead-and-standby
// pump pair drop to zero every time the pumps rotate, which is normal
// operation, not a fault, and flagging it would just teach people to
// click through the prompts. Manager-set min/max still covers any of
// those individually. A manager can also switch it off per reading.
export function trendMonitored(tag) {
  if (tag.monitor_trend === 0) return false;
  if (isCumulativeMeter(tag)) return false;
  return inferTolerance(tag.unit, tag.reading_type) != null;
}

function median(sorted) {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Median + a robust spread (1.4826 * median absolute deviation) instead
// of mean + standard deviation: one bad day shouldn't be able to drag
// the baseline toward itself and hide the next one. A gauge that sat at
// 60 PSI for six days and read 28 on the seventh still has a baseline of
// 60, not 55.
function robustStats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const center = median(sorted);
  const deviations = sorted.map((v) => Math.abs(v - center)).sort((a, b) => a - b);
  return {
    count: values.length,
    avg: center,
    stdev: 1.4826 * median(deviations),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

// Baselines for every numeric reading in a building as of `date`: the
// submitted days in the 7 before it (never `date` itself, so a day is
// never judged against itself). A reading needs MIN_BASELINE_DAYS days
// before it gets a baseline at all.
export async function loadBaselines(env, buildingId, date) {
  const result = await env.DB.prepare(
    `SELECT r.tag_id, r.value
     FROM inspection_readings r
     JOIN inspection_submissions s ON s.id = r.submission_id
     JOIN inspection_tags t ON t.id = r.tag_id
     WHERE s.building_id = ? AND s.status = 'submitted'
       AND s.inspection_date >= date(?, '-${BASELINE_WINDOW_DAYS} days') AND s.inspection_date < ?
       AND t.answer_kind = 'numeric' AND r.value IS NOT NULL AND TRIM(r.value) != ''`,
  )
    .bind(buildingId, date, date)
    .all();

  const valuesByTag = new Map();
  for (const row of result.results) {
    const num = Number.parseFloat(row.value);
    if (Number.isNaN(num)) continue;
    if (!valuesByTag.has(row.tag_id)) valuesByTag.set(row.tag_id, []);
    valuesByTag.get(row.tag_id).push(num);
  }

  const baselines = {};
  for (const [tagId, values] of valuesByTag) {
    if (values.length < MIN_BASELINE_DAYS) continue;
    baselines[tagId] = robustStats(values);
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
export function evaluateDeviation(tag, rawValue, baseline) {
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
  const num = Number.parseFloat(value);
  if (Number.isNaN(num)) return null;

  const tolerance = inferTolerance(tag.unit, tag.reading_type);
  const statistical = Math.max(baseline.stdev * 2, Math.abs(baseline.avg) * 0.15, 1);
  const threshold = Math.min(tolerance, statistical);
  const change = Math.round((num - baseline.avg) * 100) / 100;

  // >= : "50 vs 53" is exactly a 3-degree gap and must flag; readings
  // here are mostly whole numbers, so a strict > would let the boundary
  // case straight through.
  if (Math.abs(num - baseline.avg) < threshold) return sanity();
  return {
    basis: "trend",
    baseline: Math.round(baseline.avg * 100) / 100,
    change,
    tolerance: Math.round(threshold * 100) / 100,
    detail: `Usually about ${Math.round(baseline.avg * 10) / 10}${tag.unit ? ` ${tag.unit}` : ""}; this is ${change > 0 ? "up" : "down"} ${Math.abs(change)}`,
  };
}
