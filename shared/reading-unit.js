// A temperature reading remembers which scale it was typed in: it is saved as the
// number plus a suffix ("72°F", "21.5°C") and is never converted. Every numeric
// check in the app reads the leading number (parseFloat), so the suffix is safe.
//
// Shared by the app and the Worker so the screen, the PDF and the weekly report
// all show a reading the same way.

const SUFFIX = /\s*°\s*([CF])\s*$/i;

// "72°F" -> { number: "72", unit: "F" }.  "72" -> { number: "72", unit: null }.
export function splitReading(raw) {
  const text = String(raw ?? "").trim();
  const match = text.match(SUFFIX);
  if (!match) return { number: text, unit: null };
  return { number: text.slice(0, match.index).trim(), unit: match[1].toUpperCase() };
}

// Attach the scale to a typed number. Anything that isn't a number is left alone.
export function withTempUnit(number, unit) {
  const text = String(number ?? "").trim();
  if ((unit !== "C" && unit !== "F") || !Number.isFinite(Number.parseFloat(text))) return text;
  return `${splitReading(text).number}°${unit}`;
}

// What to print next to a reading: its own scale if it has one, else the gauge's unit.
export function readingParts(raw, gaugeUnit) {
  const { number, unit } = splitReading(raw);
  return { number, unit: unit ? `°${unit}` : gaugeUnit || "" };
}

// One-line text, e.g. "72°F", "55 psi", "21°".
export function readingText(raw, gaugeUnit) {
  const { number, unit } = readingParts(raw, gaugeUnit);
  if (!number) return "";
  return !unit ? number : unit.startsWith("°") ? `${number}${unit}` : `${number} ${unit}`;
}
