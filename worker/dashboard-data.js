// The opening dashboard for every role, computed live from real data --
// this used to be a static mock object (fake work orders, fake coverage,
// fake percentages) left over from the very first UI pass. Every number
// here now comes from D1, scoped by canSeeAllBuildings the same way the
// rest of the manager API is.

import { canSeeAllBuildings, ownedOrSharedSql, effectiveClientId, clientScopeSql } from "./access.js";

export const roleLabels = {
  admin: "Administrator",
  regional_manager: "Area Manager",
  superintendent: "Superintendent",
  cleaner: "Cleaner",
  property_manager: "Property Manager",
  // The agency account (Lucas, overseeing every company) before it's
  // selected a company to look at -- see requireAgencySession in index.js.
  agency: "Agency",
};

const TORONTO_TZ = "America/Toronto";

export function todayIso() {
  return new Date().toLocaleDateString("en-CA", { timeZone: TORONTO_TZ });
}

export function weekdayName(isoDate) {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString("en-US", { weekday: "short" });
}

// Monday-start week containing isoDate -- "resets each week" is just this
// window sliding forward with the calendar, not a stored counter that
// needs a cron job to clear.
export function weekDates(isoDate) {
  const d = new Date(`${isoDate}T00:00:00`);
  const offset = (d.getDay() + 6) % 7; // Mon=0..Sun=6
  const monday = new Date(d);
  monday.setDate(d.getDate() - offset);
  return Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(monday);
    dt.setDate(monday.getDate() + i);
    return dt.toISOString().slice(0, 10);
  });
}

function shiftDates(dates, days) {
  return dates.map((iso) => {
    const dt = new Date(`${iso}T00:00:00`);
    dt.setDate(dt.getDate() + days);
    return dt.toISOString().slice(0, 10);
  });
}

function todayEyebrow() {
  return new Date().toLocaleDateString("en-US", { timeZone: TORONTO_TZ, weekday: "long", month: "long", day: "numeric" });
}

function timeOfDayGreeting(firstName) {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: TORONTO_TZ, hour: "numeric", hour12: false }).format(new Date()));
  const part = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  return `Good ${part}, ${firstName}`;
}

// Of a set of buildings' inspection_days, how many fall on each of the
// given dates -- i.e. how many building-days were actually expected.
export function countExpected(buildings, dates) {
  let total = 0;
  for (const building of buildings) {
    const days = (building.inspection_days || "").split(",");
    for (const iso of dates) {
      if (days.includes(weekdayName(iso))) total += 1;
    }
  }
  return total;
}

async function visibleActiveBuildings(env, session) {
  const scoped = canSeeAllBuildings(session);
  const result = await env.DB.prepare(
    `SELECT id, name, inspection_days, created_by FROM buildings
     WHERE status = 'active' AND deleted_at IS NULL AND ${clientScopeSql("buildings")} AND (${scoped ? "1=1" : ownedOrSharedSql("buildings")})`,
  )
    .bind(effectiveClientId(session), ...(scoped ? [] : [session.id, session.id]))
    .all();
  return result.results;
}

async function submittedCount(env, buildingIds, dates) {
  if (!buildingIds.length || !dates.length) return 0;
  const bPlaceholders = buildingIds.map(() => "?").join(",");
  const dPlaceholders = dates.map(() => "?").join(",");
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM inspection_submissions
     WHERE status = 'submitted' AND building_id IN (${bPlaceholders}) AND inspection_date IN (${dPlaceholders})`,
  )
    .bind(...buildingIds, ...dates)
    .first();
  return row?.c || 0;
}

function initialsOf(name = "") {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

async function buildManagerDashboard(env, session, fullName) {
  const scoped = canSeeAllBuildings(session);
  const today = todayIso();
  const thisWeek = weekDates(today);
  const lastWeek = shiftDates(thisWeek, -7);

  const buildings = await visibleActiveBuildings(env, session);
  const buildingIds = buildings.map((b) => b.id);
  const todayWeekday = weekdayName(today);
  const dueTodayBuildings = buildings.filter((b) => (b.inspection_days || "").split(",").includes(todayWeekday));

  const [workOrderStats, submittedTodayCount, thisWeekSubmitted, lastWeekSubmitted, coverageRows] = await Promise.all([
    env.DB.prepare(
      `SELECT COUNT(*) AS open_count, COUNT(DISTINCT w.building_id) AS building_count,
         SUM(CASE WHEN w.assigned_to IS NULL THEN 1 ELSE 0 END) AS unassigned_count
       FROM work_orders w JOIN buildings b ON b.id = w.building_id
       WHERE w.status = 'open' AND b.deleted_at IS NULL AND ${clientScopeSql("b")} AND (${scoped ? "1=1" : ownedOrSharedSql("b")})`,
    )
      .bind(effectiveClientId(session), ...(scoped ? [] : [session.id, session.id]))
      .first(),
    submittedCount(
      env,
      dueTodayBuildings.map((b) => b.id),
      [today],
    ),
    submittedCount(env, buildingIds, thisWeek),
    submittedCount(env, buildingIds, lastWeek),
    buildingIds.length
      ? env.DB.prepare(
          `SELECT u.id, u.full_name, b.id AS building_id, b.name AS building_name
           FROM users u JOIN buildings b ON b.id = u.building_id
           WHERE u.role = 'superintendent' AND u.status = 'active' AND b.id IN (${buildingIds.map(() => "?").join(",")})
           ORDER BY b.name, u.full_name LIMIT 12`,
        )
          .bind(...buildingIds)
          .all()
      : { results: [] },
  ]);

  const openCount = workOrderStats?.open_count || 0;
  const unassignedCount = workOrderStats?.unassigned_count || 0;
  const buildingCountWithOpen = workOrderStats?.building_count || 0;
  const dueTodayOutstanding = Math.max(dueTodayBuildings.length - submittedTodayCount, 0);

  const thisWeekTotal = countExpected(buildings, thisWeek);
  const lastWeekTotal = countExpected(buildings, lastWeek);
  const thisWeekPct = thisWeekTotal ? Math.round((thisWeekSubmitted / thisWeekTotal) * 100) : 0;
  const lastWeekPct = lastWeekTotal ? Math.round((lastWeekSubmitted / lastWeekTotal) * 100) : 0;
  const pctDelta = thisWeekPct - lastWeekPct;

  // Who's covering what, and where they actually stand today -- checked
  // against inspection_submissions for their building, not guessed.
  const buildingTodayStatus = new Map();
  if (coverageRows.results.length) {
    const relevantBuildingIds = [...new Set(coverageRows.results.map((r) => r.building_id))];
    const subs = await env.DB.prepare(
      `SELECT building_id, status FROM inspection_submissions
       WHERE inspection_date = ? AND building_id IN (${relevantBuildingIds.map(() => "?").join(",")})`,
    )
      .bind(today, ...relevantBuildingIds)
      .all();
    for (const row of subs.results) buildingTodayStatus.set(row.building_id, row.status);
  }
  const coverage = coverageRows.results.map((row) => {
    const buildingScheduledToday = buildings.find((b) => b.id === row.building_id)?.inspection_days?.split(",").includes(todayWeekday);
    const status = buildingTodayStatus.get(row.building_id);
    const label = !buildingScheduledToday ? "Not scheduled today" : status === "submitted" ? "Submitted" : status === "draft" ? "In progress" : "Not started";
    const tone = !buildingScheduledToday ? "neutral" : status === "submitted" ? "success" : status === "draft" ? "neutral" : "warning";
    return { initials: initialsOf(row.full_name), name: row.full_name, site: row.building_name, status: label, tone };
  });

  const firstName = (fullName || "there").split(" ")[0];
  return {
    kind: "regional_manager",
    eyebrow: todayEyebrow(),
    title: timeOfDayGreeting(firstName),
    summary: buildings.length
      ? `Your portfolio is ${openCount ? "steady" : "clear"} — ${openCount} open work order${openCount === 1 ? "" : "s"}${dueTodayOutstanding ? `, ${dueTodayOutstanding} inspection${dueTodayOutstanding === 1 ? "" : "s"} still due today` : ""}.`
      : "No buildings registered yet — register one to start seeing real numbers here.",
    pulse: [
      { label: "Open work orders", value: String(openCount), delta: `Across ${buildingCountWithOpen} building${buildingCountWithOpen === 1 ? "" : "s"}`, tone: openCount ? "danger" : "success" },
      { label: "Due today", value: String(dueTodayOutstanding), delta: `${submittedTodayCount} of ${dueTodayBuildings.length} submitted`, tone: dueTodayOutstanding ? "warning" : "success" },
      { label: "Unassigned", value: String(unassignedCount), delta: `of ${openCount} open work order${openCount === 1 ? "" : "s"}`, tone: unassignedCount ? "danger" : "success" },
      thisWeekTotal
        ? { label: "This week", value: `${thisWeekPct}%`, delta: `${pctDelta >= 0 ? "+" : ""}${pctDelta}% vs last week`, tone: thisWeekPct >= 80 ? "success" : thisWeekPct >= 50 ? "warning" : "danger" }
        : { label: "This week", value: "—", delta: "No buildings scheduled", tone: "neutral" },
    ],
    coverage,
    recurring: {
      completed: thisWeekSubmitted,
      total: thisWeekTotal,
      percentage: thisWeekPct,
      note: thisWeekTotal > thisWeekSubmitted ? `${thisWeekTotal - thisWeekSubmitted} remaining across ${buildings.length} propert${buildings.length === 1 ? "y" : "ies"}` : "Fully caught up this week",
    },
  };
}

async function buildPropertyManagerShell(env, session) {
  const building = session.building_id
    ? await env.DB.prepare("SELECT name FROM buildings WHERE id = ?").bind(session.building_id).first()
    : null;
  return {
    kind: "property_manager",
    eyebrow: building?.name || "No building assigned",
    title: "Property overview",
    summary: "A simple, read-only record of when each daily inspection happened and what it found.",
  };
}

async function buildSuperintendentShell(env, session) {
  const building = session.building_id
    ? await env.DB.prepare("SELECT name FROM buildings WHERE id = ?").bind(session.building_id).first()
    : null;
  return {
    kind: "superintendent",
    eyebrow: building?.name || "No building assigned",
    title: "Your site command center",
    summary: "Complete today's building inspection below — it saves as you go and locks once submitted.",
  };
}

async function buildCleanerShell(env, session) {
  const building = session.building_id
    ? await env.DB.prepare("SELECT name FROM buildings WHERE id = ?").bind(session.building_id).first()
    : null;
  return {
    kind: "cleaner",
    eyebrow: building?.name || "No building assigned",
    title: "Your tasks for today",
    summary: "Check off each task as you finish it — you'll be asked for photos to show the work was done.",
  };
}

async function buildAdminDashboard(env) {
  const [accounts, roleGroups] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS c FROM users WHERE is_active = 1").first(),
    env.DB.prepare("SELECT COUNT(DISTINCT role) AS c FROM users WHERE is_active = 1").first(),
  ]);
  return {
    kind: "admin",
    eyebrow: "System control",
    title: "Command access",
    summary: "Enter any seeded account securely without requesting that user’s password.",
    stats: [
      { label: "Active accounts", value: String(accounts?.c || 0), meta: "Across all roles", tone: "neutral" },
      { label: "Role groups", value: String(roleGroups?.c || 0), meta: "Access policies active", tone: "success" },
      { label: "Environment", value: "Live", meta: "Production D1 + R2 + Workers", tone: "neutral" },
    ],
  };
}

export async function dashboardForRole(role, fullName, env, session) {
  if (role === "regional_manager") return buildManagerDashboard(env, session, fullName);
  if (role === "superintendent") return buildSuperintendentShell(env, session);
  if (role === "cleaner") return buildCleanerShell(env, session);
  if (role === "property_manager") return buildPropertyManagerShell(env, session);
  if (role === "admin") return buildAdminDashboard(env);
  return null;
}
