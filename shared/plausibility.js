// "Does this number even make sense?" -- a common-sense check on every
// numeric reading, whether or not a manager set a range and whether or not
// the reading has any history yet. The learned-baseline check
// (worker/deviation.js) only covers temperature / pressure / percentage
// readings with 3+ days behind them, and manager min/max only exists where
// one was typed in, so before this a reading like an RPM gauge or a meter
// accepted literally anything (1000000 went straight through).
//
// Shared by the app (to question the value on the spot) and the Worker
// (to record it at submit, so a prompt that didn't show can't hide it).

const BOUNDS = {
  temperature: { min: -60, max: 700, label: "temperature" },
  pressure: { min: -15, max: 1500, label: "pressure" },
  percent: { min: 0, max: 100, label: "percentage" },
  rpm: { min: 0, max: 20000, label: "speed" },
  hz: { min: 0, max: 500, label: "frequency" },
  amps: { min: 0, max: 10000, label: "current" },
  kw: { min: 0, max: 100000, label: "power" },
  volts: { min: 0, max: 100000, label: "voltage" },
};

const LARGEST_PLAUSIBLE = 1_000_000;

function readingKind(tag) {
  const unit = (tag.unit || "").trim().toLowerCase();
  const name = `${tag.system_name || ""} ${tag.reading_type || ""}`.toLowerCase();
  if (unit === "°" || unit.includes("deg") || /^°?[cf]$/.test(unit)) return "temperature";
  if (unit === "psi") return "pressure";
  if (unit === "%" || unit === "percent") return "percent";
  if (unit === "rpm") return "rpm";
  if (unit === "hz") return "hz";
  if (unit === "a" || unit.startsWith("amp")) return "amps";
  if (unit === "kw") return "kw";
  if (unit === "v" || unit.startsWith("volt")) return "volts";
  if (!unit) {
    if (/\bpress|\bpsi\b/.test(name)) return "pressure";
    if (/\btemp/.test(name)) return "temperature";
    if (/\bpercent|%/.test(name)) return "percent";
  }
  return null;
}

const isMeter = (tag) => /\bmeter\b/i.test(`${tag.system_name || ""} ${tag.reading_type || ""}`);

function toNumber(raw) {
  if (raw == null) return null;
  const n = Number.parseFloat(String(raw).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

const fmt = (n) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });

// Returns { detail } when the value should be questioned, otherwise null.
// lastValue: the reading's most recent submitted value, if there is one.
export function plausibilityFlag(tag, rawValue, lastValue) {
  if (tag.value_type && tag.value_type !== "numeric") return null;
  const value = toNumber(rawValue);
  if (value == null) return null;
  const last = toNumber(lastValue);
  const unit = tag.unit ? ` ${tag.unit}` : "";

  const kind = readingKind(tag);
  const bounds = kind && BOUNDS[kind];
  if (bounds && (value < bounds.min || value > bounds.max)) {
    return { detail: `${fmt(value)}${unit} isn't a realistic ${bounds.label} reading (usually between ${fmt(bounds.min)} and ${fmt(bounds.max)}). Did you mistype it?` };
  }

  if (last != null) {
    if (isMeter(tag)) {
      // A utility meter is a running total: it only ever goes up.
      if (value < last) return { detail: `Lower than the last reading (${fmt(last)}) — a meter only counts up. Did you mistype it?` };
      // A running total doubling between two checks means a mistyped digit, not real use.
      if (last > 0 && value >= last * 2) return { detail: `About ${fmt(Math.round((value / last) * 10) / 10)}× the last reading (${fmt(last)}). Did you mistype it?` };
    } else if (Math.abs(last) > 0) {
      if (Math.abs(value) >= 10 && Math.abs(value) >= Math.abs(last) * 10) {
        return { detail: `About ${fmt(Math.round(Math.abs(value / last)))}× the last reading (${fmt(last)}${unit}). Did you mistype it?` };
      }
      if (Math.abs(last) >= 10 && value !== 0 && Math.abs(value) <= Math.abs(last) / 10) {
        return { detail: `A tenth or less of the last reading (${fmt(last)}${unit}) — a digit may be missing.` };
      }
    }
  }

  if (Math.abs(value) >= LARGEST_PLAUSIBLE && !(isMeter(tag) && last != null && last >= LARGEST_PLAUSIBLE / 10)) {
    return { detail: `${fmt(value)}${unit} is an unusually large number. Did you mistype it?` };
  }
  return null;
}
