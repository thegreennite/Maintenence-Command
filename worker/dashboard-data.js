export const roleLabels = {
  admin: "Administrator",
  regional_manager: "Regional Operations Manager",
  superintendent: "Superintendent",
  property_manager: "Property Manager",
};

const managerDashboard = {
  kind: "regional_manager",
  eyebrow: "Friday, August 28",
  title: "Good morning, Alex",
  summary: "Your portfolio is steady. Three commitments need a closer look today.",
  pulse: [
    { label: "Open commitments", value: "24", delta: "Across 8 properties", tone: "neutral" },
    { label: "Due today", value: "7", delta: "2 before noon", tone: "warning" },
    { label: "Need intervention", value: "3", delta: "1 unassigned", tone: "danger" },
    { label: "On-time verification", value: "94%", delta: "+3.2% this week", tone: "success" },
  ],
  exceptions: [
    {
      id: "WO-2841",
      title: "Water detection — B2 mechanical room",
      property: "Harbour Point",
      owner: "Unassigned",
      due: "19 min",
      tone: "danger",
      detail: "A water sensor alert is awaiting ownership. Building access is available through the east service entrance.",
    },
    {
      id: "WO-2817",
      title: "Elevator service follow-up",
      property: "Lakeshore Residences",
      owner: "Mina Patel",
      due: "48 min",
      tone: "warning",
      detail: "Vendor confirmation is pending. The service window closes at 11:30 AM.",
    },
    {
      id: "WO-2798",
      title: "Garage gate access issue",
      property: "King West Lofts",
      owner: "Jordan Lee",
      due: "1 hr 25 min",
      tone: "warning",
      detail: "Resident access is currently routed through the north gate while the service team responds.",
    },
  ],
  coverage: [
    { initials: "JL", name: "Jordan Lee", site: "Harbour Point", status: "Active", tone: "success" },
    { initials: "MP", name: "Mina Patel", site: "Lakeshore", status: "Available", tone: "neutral" },
    { initials: "DS", name: "Dario Silva", site: "King West", status: "Late start", tone: "warning" },
    { initials: "RN", name: "Riley Nguyen", site: "Riverside", status: "Active", tone: "success" },
  ],
  recurring: {
    completed: 31,
    total: 36,
    percentage: 86,
    note: "5 remaining across 3 properties",
  },
};

const shellData = {
  superintendent: {
    kind: "superintendent",
    eyebrow: "Harbour Point",
    title: "Your site command center",
    summary: "Complete today's building inspection below — it saves as you go and locks once submitted.",
  },
  property_manager: {
    kind: "property_manager",
    eyebrow: "Lakeshore Residences",
    title: "Property overview",
    summary: "A clear, role-specific view of building performance is ready for future workflows.",
    stats: [
      { label: "Portfolio", value: "1 property", meta: "Lakeshore Residences", tone: "neutral" },
      { label: "Operations status", value: "Stable", meta: "No critical notices", tone: "success" },
      { label: "Coverage", value: "On site", meta: "Team available", tone: "success" },
    ],
    panels: [
      { title: "Building summary", copy: "Current property signals and operational context will live in this workspace." },
      { title: "Team communication", copy: "Relevant updates from site operations will be organized here in a later phase." },
    ],
  },
};

export function dashboardForRole(role) {
  if (role === "regional_manager") return managerDashboard;
  if (role in shellData) return shellData[role];
  if (role === "admin") {
    return {
      kind: "admin",
      eyebrow: "System control",
      title: "Command access",
      summary: "Enter any seeded account securely without requesting that user’s password.",
      stats: [
        { label: "Active accounts", value: "4", meta: "Across all roles", tone: "neutral" },
        { label: "Role groups", value: "4", meta: "Access policies active", tone: "success" },
        { label: "Environment", value: "Phase 1", meta: "Foundation ready", tone: "neutral" },
      ],
    };
  }
  return null;
}
