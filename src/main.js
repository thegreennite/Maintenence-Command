import "./styles.css";

const app = document.querySelector("#app");

const state = {
  session: null,
  dashboard: null,
  accounts: [],
  selectedExceptionId: null,
  loading: true,
};

// In dev, Vite proxies /api to the local Worker (see vite.config.js), so a
// relative path works. In production there's no proxy — call the deployed
// Worker's own URL directly (cross-origin), which the Worker is already
// built to support (CORS origin-reflection + SameSite=None cookie).
const API_BASE = import.meta.env.VITE_API_URL || "";

const api = {
  async request(path, options = {}) {
    const response = await fetch(`${API_BASE}/api${path}`, {
      credentials: "include",
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || "The request could not be completed.");
      error.status = response.status;
      throw error;
    }
    return body;
  },
  login(username, password) {
    return this.request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
  },
  logout() {
    return this.request("/auth/logout", { method: "POST" });
  },
  session() {
    return this.request("/auth/me");
  },
  dashboard() {
    return this.request("/dashboard");
  },
  accounts() {
    return this.request("/admin/accounts");
  },
  impersonate(userId) {
    return this.request("/admin/impersonate", {
      method: "POST",
      body: JSON.stringify({ userId }),
    });
  },
  returnToAdmin() {
    return this.request("/admin/return", { method: "POST" });
  },
};

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function initials(name = "") {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function icon(name) {
  const paths = {
    arrow: '<path d="m9 18 6-6-6-6"/>',
    building: '<path d="M3 21h18M6 21V5l6-3 6 3v16M9 9h.01M9 13h.01M9 17h.01M15 9h.01M15 13h.01M15 17h.01"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    command: '<path d="M9 6V3M15 6V3M9 21v-3M15 21v-3M6 9H3M6 15H3M21 9h-3M21 15h-3"/><rect x="6" y="6" width="12" height="12" rx="3"/>',
    logout: '<path d="M10 17l5-5-5-5M15 12H3M15 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    warning: '<path d="M10.3 2.9 1.8 17a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 2.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
  };
  return `<svg class="icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.command}</svg>`;
}

function setDocumentTitle(suffix) {
  document.title = suffix ? `${suffix} · FHG Command` : "FHG Command";
}

function renderLoading() {
  app.innerHTML = `
    <main class="loading-screen" aria-live="polite">
      <div class="brand-mark">${icon("command")}</div>
      <div class="loading-bar"><span></span></div>
      <p>Opening command center…</p>
    </main>`;
}

function renderLogin(message = "") {
  setDocumentTitle("Sign in");
  app.innerHTML = `
    <main class="login-page">
      <section class="login-story" aria-label="FHG Command overview">
        <div class="login-story__inner">
          <div class="brand brand--light">
            <span class="brand-mark">${icon("command")}</span>
            <span>FHG <strong>Command</strong></span>
          </div>
          <div class="story-copy">
            <p class="eyebrow eyebrow--light">Property operations, clearly directed</p>
            <h1>See the signal.<br />Make the call.</h1>
            <p>One calm, focused view of the people, properties, and commitments that need you now.</p>
          </div>
          <div class="story-status">
            <span class="status-dot status-dot--success"></span>
            <span>Operations platform online</span>
          </div>
        </div>
      </section>
      <section class="login-panel">
        <div class="login-form-wrap">
          <div class="mobile-brand brand">
            <span class="brand-mark">${icon("command")}</span>
            <span>FHG <strong>Command</strong></span>
          </div>
          <p class="eyebrow">Secure access</p>
          <h2>Welcome back</h2>
          <p class="form-intro">Sign in with your FHG Command account.</p>
          <form class="login-form" id="login-form">
            <label>
              <span>Username</span>
              <input name="username" autocomplete="username" autocapitalize="none" required />
            </label>
            <label>
              <span>Password</span>
              <input name="password" type="password" autocomplete="current-password" required />
            </label>
            <p class="form-error" id="login-error" ${message ? "" : "hidden"} role="alert">${escapeHtml(message)}</p>
            <button class="button button--primary button--full" type="submit">
              <span>Enter command center</span>${icon("arrow")}
            </button>
          </form>
          <p class="security-note">${icon("shield")} Protected role-based access</p>
        </div>
      </section>
    </main>`;

  document.querySelector("#login-form").addEventListener("submit", handleLogin);
  document.querySelector('input[name="username"]').focus();
}

async function handleLogin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button");
  const error = form.querySelector("#login-error");
  const data = new FormData(form);
  error.hidden = true;
  button.disabled = true;
  button.querySelector("span").textContent = "Signing in…";

  try {
    state.session = await api.login(data.get("username"), data.get("password"));
    await loadDashboard();
  } catch (requestError) {
    error.textContent = requestError.message;
    error.hidden = false;
    button.disabled = false;
    button.querySelector("span").textContent = "Enter command center";
  }
}

async function loadDashboard() {
  renderLoading();
  const isAdminActor = state.session?.actor?.role === "admin";
  const [dashboardResponse, accountsResponse] = await Promise.all([
    api.dashboard(),
    isAdminActor ? api.accounts() : Promise.resolve({ accounts: [] }),
  ]);
  state.dashboard = dashboardResponse.dashboard;
  state.accounts = accountsResponse.accounts;
  state.selectedExceptionId = state.dashboard?.exceptions?.[0]?.id || null;
  renderApp();
}

function renderApp() {
  const { user, actor, isImpersonating } = state.session;
  setDocumentTitle(user.roleLabel);
  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <a class="brand" href="#" aria-label="FHG Command home">
          <span class="brand-mark">${icon("command")}</span>
          <span>FHG <strong>Command</strong></span>
        </a>
        <div class="topbar__right">
          <span class="role-pill">${escapeHtml(user.roleLabel)}</span>
          <div class="user-identity">
            <span class="avatar">${escapeHtml(initials(user.fullName))}</span>
            <span><strong>${escapeHtml(user.fullName)}</strong><small>${escapeHtml(user.region || user.jobTitle)}</small></span>
          </div>
          <button class="icon-button" id="logout-button" title="Sign out" aria-label="Sign out">${icon("logout")}</button>
        </div>
      </header>
      ${
        isImpersonating
          ? `<aside class="impersonation-bar">
              <span>${icon("shield")} <strong>${escapeHtml(actor.fullName)}</strong> is viewing as ${escapeHtml(user.fullName)}</span>
              <button class="button button--small button--light" id="return-admin">Return to admin</button>
            </aside>`
          : ""
      }
      <main class="dashboard">
        ${renderDashboard(state.dashboard)}
      </main>
      <footer class="app-footer"><span>FHG Command</span><span>Phase 1 · Secure operations workspace</span></footer>
    </div>`;

  document.querySelector("#logout-button").addEventListener("click", handleLogout);
  document.querySelector("#return-admin")?.addEventListener("click", handleReturnToAdmin);
  bindDashboardEvents();
}

function renderDashboard(data) {
  if (!data) return renderErrorState();
  const body =
    data.kind === "regional_manager"
      ? renderManagerDashboard(data)
      : data.kind === "admin"
        ? renderAdminDashboard(data)
        : renderRoleShell(data);

  return `
    <section class="dashboard-heading">
      <div>
        <p class="eyebrow">${escapeHtml(data.eyebrow)}</p>
        <h1>${escapeHtml(data.title)}</h1>
        <p>${escapeHtml(data.summary)}</p>
      </div>
      <div class="live-indicator"><span class="status-dot status-dot--success"></span>Live operational view</div>
    </section>
    ${body}`;
}

function renderManagerDashboard(data) {
  return `
    <section aria-labelledby="portfolio-pulse-title">
      <div class="section-heading"><div><p class="section-kicker">Portfolio Pulse</p><h2 id="portfolio-pulse-title">Right now</h2></div><span>Updated moments ago</span></div>
      <div class="metric-grid">
        ${data.pulse.map(renderMetric).join("")}
      </div>
    </section>
    <div class="operations-grid">
      <section class="card exception-card" aria-labelledby="exception-title">
        <div class="card__header"><div><p class="section-kicker">Exception Queue</p><h2 id="exception-title">Needs your attention</h2></div><span class="count-badge">${data.exceptions.length}</span></div>
        <div class="exception-list">
          ${data.exceptions.map(renderException).join("")}
        </div>
      </section>
      ${renderExceptionDetail(data)}
      <section class="card coverage-card" aria-labelledby="coverage-title">
        <div class="card__header"><div><p class="section-kicker">Today’s Coverage</p><h2 id="coverage-title">People on point</h2></div><span class="quiet-label">Central portfolio</span></div>
        <div class="coverage-list">
          ${data.coverage.map(renderCoverage).join("")}
        </div>
      </section>
      <section class="card recurring-card" aria-labelledby="recurring-title">
        <div class="card__header"><div><p class="section-kicker">Recurring Service</p><h2 id="recurring-title">Weekly completion</h2></div><span class="quiet-label">Week 35</span></div>
        <div class="progress-summary">
          <div class="progress-ring" style="--progress: ${Number(data.recurring.percentage)}%" aria-label="${Number(data.recurring.percentage)} percent complete">
            <span><strong>${Number(data.recurring.percentage)}%</strong><small>complete</small></span>
          </div>
          <div><strong>${Number(data.recurring.completed)} of ${Number(data.recurring.total)}</strong><p>Scheduled services verified</p><span class="tone-text tone-text--warning">${escapeHtml(data.recurring.note)}</span></div>
        </div>
        <div class="progress-track"><span style="width:${Number(data.recurring.percentage)}%"></span></div>
      </section>
    </div>`;
}

function renderMetric(metric) {
  return `<article class="metric-card metric-card--${escapeHtml(metric.tone)}">
    <div class="metric-card__top"><span>${escapeHtml(metric.label)}</span><i></i></div>
    <strong>${escapeHtml(metric.value)}</strong>
    <small>${escapeHtml(metric.delta)}</small>
  </article>`;
}

function renderException(item) {
  const selected = item.id === state.selectedExceptionId;
  return `<button class="exception-item ${selected ? "is-selected" : ""}" data-exception-id="${escapeHtml(item.id)}" aria-pressed="${selected}">
    <span class="urgency-bar urgency-bar--${escapeHtml(item.tone)}"></span>
    <span class="exception-copy"><span class="exception-meta"><strong>${escapeHtml(item.id)}</strong><span class="due due--${escapeHtml(item.tone)}">${icon("clock")}${escapeHtml(item.due)}</span></span><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.property)} · ${escapeHtml(item.owner)}</small></span>
    ${icon("arrow")}
  </button>`;
}

function renderExceptionDetail(data) {
  const item = data.exceptions.find((exception) => exception.id === state.selectedExceptionId) || data.exceptions[0];
  if (!item) return "";
  return `<aside class="card detail-card detail-card--${escapeHtml(item.tone)}" aria-labelledby="detail-title">
    <div class="detail-card__flag">${icon("warning")} Priority detail</div>
    <p class="eyebrow">${escapeHtml(item.id)} · ${escapeHtml(item.property)}</p>
    <h2 id="detail-title">${escapeHtml(item.title)}</h2>
    <p class="detail-copy">${escapeHtml(item.detail)}</p>
    <dl class="detail-facts"><div><dt>Owner</dt><dd>${escapeHtml(item.owner)}</dd></div><div><dt>Response due</dt><dd>${escapeHtml(item.due)}</dd></div></dl>
    <button class="button button--dark" type="button">Open work item ${icon("arrow")}</button>
  </aside>`;
}

function renderCoverage(person) {
  return `<div class="coverage-row">
    <span class="avatar avatar--soft">${escapeHtml(person.initials)}</span>
    <span class="coverage-person"><strong>${escapeHtml(person.name)}</strong><small>${escapeHtml(person.site)}</small></span>
    <span class="status-label status-label--${escapeHtml(person.tone)}"><i></i>${escapeHtml(person.status)}</span>
  </div>`;
}

function renderAdminDashboard(data) {
  return `
    <div class="metric-grid metric-grid--three">${data.stats.map(renderStat).join("")}</div>
    <section class="card admin-panel">
      <div class="card__header"><div><p class="section-kicker">Role Preview</p><h2>Choose a command view</h2></div><span class="quiet-label">Administrator access</span></div>
      <p class="admin-panel__intro">Open another user’s dashboard without using or changing their credentials. Your administrator session remains active.</p>
      <div class="account-grid">
        ${state.accounts.map(renderAccount).join("")}
      </div>
    </section>`;
}

function renderAccount(account) {
  return `<article class="account-card">
    <div class="account-card__top"><span class="avatar avatar--large">${escapeHtml(initials(account.fullName))}</span><span class="role-chip role-chip--${escapeHtml(account.role)}">${escapeHtml(account.roleLabel)}</span></div>
    <div><h3>${escapeHtml(account.fullName)}</h3><p>${escapeHtml(account.region || account.jobTitle)}</p></div>
    <button class="button button--outline impersonate-button" data-user-id="${Number(account.id)}">Open dashboard ${icon("arrow")}</button>
  </article>`;
}

function renderRoleShell(data) {
  return `
    <div class="metric-grid metric-grid--three">${data.stats.map(renderStat).join("")}</div>
    <div class="shell-grid">
      ${data.panels.map((panel, index) => `<section class="card placeholder-card"><span class="placeholder-card__number">0${index + 1}</span><div><h2>${escapeHtml(panel.title)}</h2><p>${escapeHtml(panel.copy)}</p></div><span class="phase-tag">Phase 1</span></section>`).join("")}
    </div>`;
}

function renderStat(stat) {
  return `<article class="metric-card metric-card--${escapeHtml(stat.tone)}">
    <div class="metric-card__top"><span>${escapeHtml(stat.label)}</span><i></i></div>
    <strong class="metric-card__value--wide">${escapeHtml(stat.value)}</strong>
    <small>${escapeHtml(stat.meta)}</small>
  </article>`;
}

function renderErrorState() {
  return `<section class="empty-state"><span>${icon("warning")}</span><h2>Dashboard unavailable</h2><p>This account does not have a configured command view.</p></section>`;
}

function bindDashboardEvents() {
  document.querySelectorAll("[data-exception-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedExceptionId = button.dataset.exceptionId;
      renderApp();
    });
  });
  document.querySelectorAll(".impersonate-button").forEach((button) => {
    button.addEventListener("click", () => handleImpersonate(button));
  });
}

async function handleImpersonate(button) {
  button.disabled = true;
  const label = button.firstChild;
  label.textContent = "Opening… ";
  try {
    state.session = await api.impersonate(Number(button.dataset.userId));
    await loadDashboard();
  } catch (error) {
    button.disabled = false;
    label.textContent = `${error.message} `;
  }
}

async function handleReturnToAdmin(event) {
  event.currentTarget.disabled = true;
  try {
    state.session = await api.returnToAdmin();
    await loadDashboard();
  } catch (error) {
    event.currentTarget.disabled = false;
    event.currentTarget.textContent = error.message;
  }
}

async function handleLogout(event) {
  event.currentTarget.disabled = true;
  try {
    await api.logout();
  } catch {
    // The local session is still cleared from the UI if the API is unavailable.
  }
  state.session = null;
  state.dashboard = null;
  state.accounts = [];
  renderLogin();
}

async function bootstrap() {
  renderLoading();
  try {
    state.session = await api.session();
    await loadDashboard();
  } catch (error) {
    if (error.status && error.status !== 401) {
      renderLogin("The command service is unavailable. Start the local Worker and try again.");
      return;
    }
    renderLogin();
  }
}

bootstrap();
