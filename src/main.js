import "./styles.css";

// Google Maps JS API loads as a global script, not an npm module — lazily
// injected the first time a map is actually shown, and cached so repeat
// visits to the building form don't reload it.
let googleMapsLoadPromise = null;
function loadGoogleMaps() {
  if (googleMapsLoadPromise) return googleMapsLoadPromise;
  googleMapsLoadPromise = new Promise((resolve, reject) => {
    const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (!key) {
      reject(new Error("Map isn't configured on this deployment yet."));
      return;
    }
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=marker&loading=async&callback=__fhgMapsReady`;
    script.async = true;
    window.__fhgMapsReady = () => resolve(window.google.maps);
    script.onerror = () => reject(new Error("Couldn't load Google Maps."));
    document.head.appendChild(script);
  });
  return googleMapsLoadPromise;
}

const app = document.querySelector("#app");

const state = {
  session: null,
  dashboard: null,
  accounts: [],
  inspection: null,
  managerInspection: null,
  propertyInspections: null,
  managerBuildings: [],
  buildingWizard: { step: "closed" },
  selectedExceptionId: null,
  loading: true,
  confirmedOutOfRange: false,
  confirmedAbnormalTagIds: [],
  pendingSubmitForm: null,
  authScreen: "login",
  registration: { role: null, step: "building", building: null, buildingResults: [], buildingSearched: false },
  pendingRequests: [],
  managerSuperintendents: [],
  workOrders: [],
  flagIssueOpen: false,
  flagIssueJustSent: false,
  photoLibrary: { open: false, buildingId: null, dates: [], selectedDate: null, photos: [], loading: false },
  deleteBuildingTarget: null,
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
  verifyCode(pendingToken, code) {
    return this.request("/auth/verify-code", {
      method: "POST",
      body: JSON.stringify({ pendingToken, code }),
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
  adminStats() {
    return this.request("/admin/stats");
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
  inspectionToday() {
    return this.request("/inspections/today");
  },
  inspectionSave(payload) {
    return this.request("/inspections/save", { method: "POST", body: JSON.stringify(payload) });
  },
  inspectionSubmit(payload) {
    return this.request("/inspections/submit", { method: "POST", body: JSON.stringify(payload) });
  },
  inspectionPhoto(payload) {
    return this.request("/inspections/photo", { method: "POST", body: JSON.stringify(payload) });
  },
  managerInspection() {
    return this.request("/manager/inspection");
  },
  managerParametersSave(payload) {
    return this.request("/manager/parameters", { method: "POST", body: JSON.stringify(payload) });
  },
  propertyInspections() {
    return this.request("/property/inspections");
  },
  managerBuildings() {
    return this.request("/manager/buildings");
  },
  managerCreateBuilding(payload) {
    return this.request("/manager/buildings", { method: "POST", body: JSON.stringify(payload) });
  },
  managerUnassignedSuperintendents() {
    return this.request("/manager/superintendents/unassigned");
  },
  managerAssignSuperintendent(payload) {
    return this.request("/manager/buildings/assign", { method: "POST", body: JSON.stringify(payload) });
  },
  managerGenerateTags(payload) {
    return this.request("/manager/tags/generate", { method: "POST", body: JSON.stringify(payload) });
  },
  managerSaveTags(payload) {
    return this.request("/manager/tags/save", { method: "POST", body: JSON.stringify(payload) });
  },
  managerPushLive(payload) {
    return this.request("/manager/buildings/push-live", { method: "POST", body: JSON.stringify(payload) });
  },
  managerDeleteBuilding(payload) {
    return this.request("/manager/buildings/delete", { method: "POST", body: JSON.stringify(payload) });
  },
  managerSuperintendents() {
    return this.request("/manager/superintendents");
  },
  managerPendingRequests() {
    return this.request("/manager/pending-requests");
  },
  managerApproveRequest(userId) {
    return this.request("/manager/pending-requests/approve", { method: "POST", body: JSON.stringify({ userId }) });
  },
  managerDenyRequest(userId) {
    return this.request("/manager/pending-requests/deny", { method: "POST", body: JSON.stringify({ userId }) });
  },
  searchRegistrationBuildings(q) {
    return this.request(`/register/buildings/search?q=${encodeURIComponent(q)}`);
  },
  selfRegister(payload) {
    return this.request("/register", { method: "POST", body: JSON.stringify(payload) });
  },
  geocodeSearch(q) {
    return this.request(`/geocode/search?q=${encodeURIComponent(q)}`);
  },
  flagIssue(payload) {
    return this.request("/inspections/flag-issue", { method: "POST", body: JSON.stringify(payload) });
  },
  managerWorkOrders() {
    return this.request("/manager/work-orders");
  },
  resolveWorkOrder(workOrderId) {
    return this.request("/manager/work-orders/resolve", { method: "POST", body: JSON.stringify({ workOrderId }) });
  },
  photoDates(buildingId) {
    return this.request(`/photos/dates?buildingId=${buildingId}`);
  },
  photoList(buildingId, date) {
    return this.request(`/photos/list?buildingId=${buildingId}&date=${date}`);
  },
  photoViewUrl(key) {
    return `${API_BASE}/api/photos/view?key=${encodeURIComponent(key)}`;
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
    camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2Z"/><circle cx="12" cy="13" r="4"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    command: '<path d="M9 6V3M15 6V3M9 21v-3M15 21v-3M6 9H3M6 15H3M21 9h-3M21 15h-3"/><rect x="6" y="6" width="12" height="12" rx="3"/>',
    logout: '<path d="M10 17l5-5-5-5M15 12H3M15 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    warning: '<path d="M10.3 2.9 1.8 17a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 2.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
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
          <div class="register-links">
            <span>New here?</span>
            <button type="button" class="link-button" id="create-account-link">Create an account</button>
          </div>
        </div>
      </section>
    </main>`;

  document.querySelector("#create-account-link")?.addEventListener("click", () => startRegistration());

  document.querySelector("#login-form").addEventListener("submit", handleLogin);
  document.querySelector('input[name="username"]').focus();
}

const ROLE_LABELS_FOR_REGISTRATION = {
  superintendent: "Superintendent",
  property_manager: "Property Manager",
  regional_manager: "Regional Operations Manager",
};

function startRegistration() {
  state.registration = { role: null, step: "role", building: null, buildingResults: [], buildingSearched: false, regionName: "" };
  renderRegister();
}

function renderRegister() {
  const reg = state.registration;
  setDocumentTitle(reg.role ? `Register as ${ROLE_LABELS_FOR_REGISTRATION[reg.role]}` : "Create an account");
  const titles = { role: "What's your role?", building: "Which building do you cover?", profile: "Create your profile", done: "Request sent" };
  app.innerHTML = `
    <main class="login-page login-page--register">
      <section class="login-panel login-panel--wide">
        <div class="login-form-wrap">
          <div class="mobile-brand brand">
            <span class="brand-mark">${icon("command")}</span>
            <span>FHG <strong>Command</strong></span>
          </div>
          <p class="eyebrow">${reg.role ? `Register as ${escapeHtml(ROLE_LABELS_FOR_REGISTRATION[reg.role])}` : "Create an account"}</p>
          <h2>${titles[reg.step]}</h2>
          ${
            reg.step === "role"
              ? renderRegisterRoleStep()
              : reg.step === "building"
                ? renderRegisterBuildingStep(reg)
                : reg.step === "profile"
                  ? renderRegisterProfileStep(reg)
                  : renderRegisterDoneStep(reg)
          }
          <button type="button" class="link-button" id="back-to-login">← Back to sign in</button>
        </div>
      </section>
    </main>`;

  document.querySelector("#back-to-login")?.addEventListener("click", () => renderLogin());
  document.querySelector("#registration-role-form")?.addEventListener("submit", handleRegistrationRoleSubmit);
  document.querySelector("#registration-building-search")?.addEventListener("input", handleRegistrationBuildingSearch);
  document.querySelectorAll(".registration-building-result").forEach((button) => {
    button.addEventListener("click", () => selectRegistrationBuilding(Number(button.dataset.buildingId), button.dataset.buildingName));
  });
  document.querySelector("#registration-profile-form")?.addEventListener("submit", handleSelfRegisterSubmit);
}

function renderRegisterRoleStep() {
  return `
    <form id="registration-role-form" class="login-form">
      <label><span>I'm a…</span>
        <select name="role" required>
          <option value="" disabled selected>Select your role</option>
          <option value="superintendent">Superintendent</option>
          <option value="property_manager">Property Manager</option>
          <option value="regional_manager">Regional Operations Manager</option>
        </select>
      </label>
      <button class="button button--primary button--full" type="submit"><span>Continue</span>${icon("arrow")}</button>
    </form>`;
}

function handleRegistrationRoleSubmit(event) {
  event.preventDefault();
  const role = new FormData(event.currentTarget).get("role");
  state.registration.role = role;
  state.registration.step = role === "regional_manager" ? "profile" : "building";
  renderRegister();
}

function renderRegisterBuildingStep(reg) {
  return `
    <p class="form-intro">Search for your building by name. If your operations manager hasn't registered it yet, you won't be able to create a profile until they do.</p>
    <label class="inspection-field"><span>Building name</span><input id="registration-building-search" autocomplete="off" placeholder="Start typing…" /></label>
    <div class="registration-building-results">
      ${reg.buildingResults
        .map(
          (b) =>
            `<button type="button" class="registration-building-result" data-building-id="${b.id}" data-building-name="${escapeHtml(b.name)}"><strong>${escapeHtml(b.name)}</strong>${b.address ? `<small>${escapeHtml(b.address)}</small>` : ""}</button>`,
        )
        .join("")}
    </div>
    ${
      reg.buildingSearched && !reg.buildingResults.length
        ? `<p class="form-error" role="alert">Please talk to your operations manager to register the building before you can create a profile.</p>`
        : ""
    }`;
}

function renderRegisterProfileStep(reg) {
  const isManager = reg.role === "regional_manager";
  return `
    <p class="form-intro">${
      isManager
        ? "Registering as a Regional Operations Manager. Once you submit, an administrator will need to approve you before you can sign in."
        : `Registering for <strong>${escapeHtml(reg.building.name)}</strong>. Once you submit, your operations manager will need to approve you before you can sign in.`
    }</p>
    <form id="registration-profile-form" class="login-form">
      <label><span>Full name</span><input name="fullName" required autocomplete="name" /></label>
      <label><span>Email</span><input name="email" type="email" required autocomplete="email" /></label>
      <label><span>Phone <small>(optional)</small></span><input name="phone" type="tel" autocomplete="tel" /></label>
      ${
        isManager
          ? `<label><span>Region name</span><input name="regionName" required autocomplete="off" placeholder="e.g. Central Portfolio" /></label>`
          : ""
      }
      <label><span>Create a password</span><input name="password" type="password" minlength="8" required autocomplete="new-password" /></label>
      <label><span>Profile picture <small>(optional)</small></span><input name="profilePhoto" type="file" accept="image/*" /></label>
      <p class="form-error" id="registration-error" hidden role="alert"></p>
      <button class="button button--primary button--full" type="submit"><span>Submit request</span>${icon("arrow")}</button>
    </form>`;
}

function renderRegisterDoneStep(reg) {
  const approver = reg.role === "regional_manager" ? "an administrator" : "your operations manager";
  return `<div class="finding"><p>${icon("check")} Your request has been sent to ${approver} for approval. You'll be able to sign in once they approve it.</p></div>`;
}

async function handleRegistrationBuildingSearch(event) {
  const q = event.currentTarget.value.trim();
  if (q.length < 2) {
    state.registration.buildingResults = [];
    state.registration.buildingSearched = false;
    renderRegister();
    document.querySelector("#registration-building-search").focus();
    return;
  }
  const { buildings } = await api.searchRegistrationBuildings(q);
  state.registration.buildingResults = buildings;
  state.registration.buildingSearched = true;
  renderRegister();
  const input = document.querySelector("#registration-building-search");
  input.focus();
  input.value = q;
  input.setSelectionRange(q.length, q.length);
}

function selectRegistrationBuilding(id, name) {
  state.registration = { ...state.registration, step: "profile", building: { id, name } };
  renderRegister();
}

async function handleSelfRegisterSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const error = document.querySelector("#registration-error");
  const data = new FormData(form);
  button.disabled = true;
  try {
    const photoFile = data.get("profilePhoto");
    const profilePhoto = photoFile && photoFile.size ? await fileToBase64(photoFile) : null;
    await api.selfRegister({
      role: state.registration.role,
      buildingId: state.registration.building?.id ?? null,
      regionName: data.get("regionName") || null,
      fullName: data.get("fullName"),
      email: data.get("email"),
      phone: data.get("phone"),
      password: data.get("password"),
      profilePhoto,
    });
    state.registration.step = "done";
    renderRegister();
  } catch (requestError) {
    error.textContent = requestError.message;
    error.hidden = false;
    button.disabled = false;
  }
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
    const response = await api.login(data.get("username"), data.get("password"));
    if (response.requiresVerification) {
      renderVerifyCodeScreen(response.pendingToken);
      return;
    }
    state.session = response;
    await loadDashboard();
  } catch (requestError) {
    error.textContent = requestError.message;
    error.hidden = false;
    button.disabled = false;
    button.querySelector("span").textContent = "Enter command center";
  }
}

function renderVerifyCodeScreen(pendingToken) {
  setDocumentTitle("Verify it's you");
  app.innerHTML = `
    <main class="login-page">
      <section class="login-story" aria-label="FHG Command overview">
        <div class="login-story__inner">
          <div class="brand brand--light">
            <span class="brand-mark">${icon("command")}</span>
            <span>FHG <strong>Command</strong></span>
          </div>
          <div class="story-copy">
            <p class="eyebrow eyebrow--light">Weekly check</p>
            <h1>One more<br />step this week.</h1>
            <p>We emailed a 6-digit code. This only happens about once a week — most days you'll just sign in normally.</p>
          </div>
        </div>
      </section>
      <section class="login-panel">
        <div class="login-form-wrap">
          <div class="mobile-brand brand">
            <span class="brand-mark">${icon("command")}</span>
            <span>FHG <strong>Command</strong></span>
          </div>
          <p class="eyebrow">Verify it's you</p>
          <h2>Check your email</h2>
          <p class="form-intro">Enter the 6-digit code we just sent.</p>
          <form class="login-form" id="verify-code-form">
            <label>
              <span>Verification code</span>
              <input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required autofocus />
            </label>
            <p class="form-error" id="verify-code-error" hidden role="alert"></p>
            <button class="button button--primary button--full" type="submit">
              <span>Verify &amp; sign in</span>${icon("arrow")}
            </button>
          </form>
          <button type="button" class="link-button" id="back-to-login-from-verify">← Back to sign in</button>
        </div>
      </section>
    </main>`;

  document.querySelector("#verify-code-form").addEventListener("submit", (event) => handleVerifyCode(event, pendingToken));
  document.querySelector("#back-to-login-from-verify").addEventListener("click", () => renderLogin());
  document.querySelector('input[name="code"]').focus();
}

async function handleVerifyCode(event, pendingToken) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button");
  const error = document.querySelector("#verify-code-error");
  const code = new FormData(form).get("code");
  error.hidden = true;
  button.disabled = true;
  button.querySelector("span").textContent = "Verifying…";
  try {
    state.session = await api.verifyCode(pendingToken, code);
    await loadDashboard();
  } catch (requestError) {
    error.textContent = requestError.message;
    error.hidden = false;
    button.disabled = false;
    button.querySelector("span").textContent = "Verify & sign in";
  }
}

async function loadDashboard() {
  renderLoading();
  const isAdminActor = state.session?.actor?.role === "admin";
  const isAdminViewing = state.session?.user?.role === "admin";
  const isSuperintendent = state.session?.user?.role === "superintendent";
  const isRegionalManager = state.session?.user?.role === "regional_manager";
  const isPropertyManager = state.session?.user?.role === "property_manager";
  const [dashboardResponse, accountsResponse, inspectionResponse, managerInspectionResponse, propertyResponse] =
    await Promise.all([
      api.dashboard(),
      isAdminActor ? api.accounts() : Promise.resolve({ accounts: [] }),
      isSuperintendent ? api.inspectionToday() : Promise.resolve(null),
      isRegionalManager ? api.managerInspection() : Promise.resolve(null),
      isPropertyManager ? api.propertyInspections() : Promise.resolve(null),
    ]);
  state.adminStats = isAdminViewing ? await api.adminStats().catch(() => null) : null;
  if (isAdminViewing) {
    state.pendingRequests = (await api.managerPendingRequests().catch(() => ({ requests: [] }))).requests;
  }
  state.dashboard = dashboardResponse.dashboard;
  state.accounts = accountsResponse.accounts;
  state.inspection = inspectionResponse;
  state.managerInspection = managerInspectionResponse;
  state.propertyInspections = propertyResponse;
  if (isRegionalManager) {
    const [buildingsResponse, pendingResponse, superintendentsResponse, workOrdersResponse] = await Promise.all([
      api.managerBuildings(),
      api.managerPendingRequests(),
      api.managerSuperintendents(),
      api.managerWorkOrders(),
    ]);
    state.managerBuildings = buildingsResponse.buildings;
    state.pendingRequests = pendingResponse.requests;
    state.managerSuperintendents = superintendentsResponse.superintendents;
    state.workOrders = workOrdersResponse.workOrders;
    state.selectedExceptionId = state.workOrders.find((w) => w.status === "open")?.id || null;
  }
  renderApp();

  if (isAdminViewing) startAdminStatsAutoRefresh();
  else stopAdminStatsAutoRefresh();
}

// Live usage on the Admin dashboard refetches on its own — no reason to
// make Lucas hit reload to see whether he's approaching a limit.
let adminStatsRefreshTimer = null;
const ADMIN_STATS_REFRESH_MS = 30_000;

function startAdminStatsAutoRefresh() {
  stopAdminStatsAutoRefresh();
  adminStatsRefreshTimer = setInterval(async () => {
    if (state.session?.user?.role !== "admin") {
      stopAdminStatsAutoRefresh();
      return;
    }
    const fresh = await api.adminStats().catch(() => null);
    if (!fresh || state.session?.user?.role !== "admin") return;
    state.adminStats = fresh;
    renderApp();
  }, ADMIN_STATS_REFRESH_MS);
}

function stopAdminStatsAutoRefresh() {
  clearInterval(adminStatsRefreshTimer);
  adminStatsRefreshTimer = null;
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
              <button class="button button--small button--light" id="return-admin">Return to ${escapeHtml(actor.fullName.split(" ")[0])}</button>
            </aside>`
          : ""
      }
      <main class="dashboard">
        ${renderDashboard(state.dashboard)}
      </main>
      <footer class="app-footer"><span>FHG Command</span><span>Phase 5 · Secure operations workspace</span></footer>
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
        : data.kind === "superintendent"
          ? renderInspectionView(state.inspection) +
            renderFlagIssuePanel() +
            (state.inspection?.building ? renderPhotoLibraryCard(state.inspection.building.id, null) : "")
          : data.kind === "property_manager"
            ? renderPropertyView(state.propertyInspections)
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
      ${renderExceptionQueue()}
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
    </div>
    ${renderManagerInspectionPanel(state.managerInspection)}
    ${renderPendingRequestsPanel()}
    ${renderBuildingsPanel()}
    ${renderSuperintendentSwitcherPanel()}
    ${state.managerBuildings.length ? renderPhotoLibraryCard(state.managerBuildings[0].id, state.managerBuildings.map((b) => ({ id: b.id, name: b.name }))) : ""}`;
}

function renderPendingRequestsPanel() {
  if (!state.pendingRequests.length) return "";
  return `
    <section class="card" aria-labelledby="pending-title">
      <div class="card__header">
        <div><p class="section-kicker">Awaiting your approval</p><h2 id="pending-title">Pending requests</h2></div>
        <span class="count-badge">${state.pendingRequests.length}</span>
      </div>
      <div class="buildings-list">
        ${state.pendingRequests.map(renderPendingRequestRow).join("")}
      </div>
    </section>`;
}

function renderPendingRequestRow(req) {
  return `
    <div class="building-row" data-request-id="${req.id}">
      <div class="building-row__name">
        <strong>${escapeHtml(req.full_name)}</strong>
        <small>${ROLE_LABELS_FOR_REGISTRATION[req.role] || req.role} · ${escapeHtml(req.building_name)} · ${escapeHtml(req.email)}${req.phone ? " · " + escapeHtml(req.phone) : ""}</small>
      </div>
      <div class="inspection-actions">
        <button type="button" class="button button--outline button--small deny-request" data-user-id="${req.id}">Deny</button>
        <button type="button" class="button button--primary button--small approve-request" data-user-id="${req.id}">Approve</button>
      </div>
    </div>`;
}

function renderSuperintendentSwitcherPanel() {
  if (!state.managerSuperintendents.length) return "";
  return `
    <section class="card" aria-labelledby="switcher-title">
      <div class="card__header"><div><p class="section-kicker">Your superintendents</p><h2 id="switcher-title">View as</h2></div></div>
      <div class="buildings-list">
        ${state.managerSuperintendents
          .map(
            (s) => `
          <div class="building-row">
            <div class="building-row__name"><strong>${escapeHtml(s.full_name)}</strong><small>${escapeHtml(s.building_name)}</small></div>
            <button type="button" class="button button--outline button--small view-as-superintendent" data-user-id="${s.id}">View as ${escapeHtml(s.full_name.split(" ")[0])}</button>
          </div>`,
          )
          .join("")}
      </div>
    </section>`;
}

function renderBuildingsPanel() {
  const wizard = state.buildingWizard;
  return `
    <section class="card buildings-card" aria-labelledby="buildings-title">
      <div class="card__header">
        <div><p class="section-kicker">Central Portfolio</p><h2 id="buildings-title">Buildings</h2></div>
        ${wizard.step === "closed" ? `<button type="button" class="button button--outline button--small" id="register-building-toggle">+ Register a building</button>` : ""}
      </div>
      <div class="buildings-list">
        ${state.managerBuildings.map((b) => renderBuildingRow(b) + (state.deleteBuildingTarget?.id === b.id ? renderDeleteBuildingPanel(b) : "")).join("")}
      </div>
      ${wizard.step !== "closed" ? renderBuildingWizard(wizard) : ""}
    </section>`;
}

function renderDeleteBuildingPanel(building) {
  const required = `I WANT TO DELETE ${building.name}`;
  return `<div class="wizard-panel delete-building-panel">
    <h3>${icon("warning")} Delete ${escapeHtml(building.name)}?</h3>
    <p class="parameters-intro">This permanently removes the building, its checklist, every past inspection, and its work orders. Anyone assigned to it becomes unassigned — their accounts aren't deleted. This can't be undone.</p>
    <label class="inspection-field"><span>Type exactly: <code>${escapeHtml(required)}</code></span>
      <input type="text" id="delete-building-confirm-text" autocomplete="off" placeholder="${escapeHtml(required)}" />
    </label>
    <div class="inspection-actions">
      <button type="button" class="button button--outline" id="cancel-delete-building">Cancel</button>
      <button type="button" class="button button--danger" id="confirm-delete-building" data-building-id="${building.id}" data-required="${escapeHtml(required)}" disabled>Delete permanently</button>
    </div>
    <p class="form-error" id="delete-building-error" hidden role="alert"></p>
  </div>`;
}

function renderBuildingRow(building) {
  const isRegistering = building.status === "registering";
  return `
    <div class="building-row">
      <div class="building-row__name">
        <strong>${escapeHtml(building.name)} ${isRegistering ? '<span class="status-chip status-chip--registering">Registering</span>' : ""}</strong>
        <small>${escapeHtml(building.address || "No address on file")}</small>
      </div>
      <span class="quiet-label">${building.tag_count} reading${building.tag_count === 1 ? "" : "s"}</span>
      <span class="quiet-label">${building.superintendent_count} superintendent${building.superintendent_count === 1 ? "" : "s"} assigned</span>
      ${
        isRegistering && !building.tag_count
          ? `<button type="button" class="button button--outline button--small continue-setup-button" data-building-id="${building.id}" data-building-name="${escapeHtml(building.name)}">Continue setup</button>`
          : isRegistering
            ? `<button type="button" class="button button--primary button--small push-live-button" data-building-id="${building.id}">Push to Super</button>`
            : ""
      }
      <button type="button" class="icon-button delete-building-button" data-building-id="${building.id}" data-building-name="${escapeHtml(building.name)}" title="Delete building" aria-label="Delete ${escapeHtml(building.name)}">${icon("close")}</button>
    </div>`;
}

function renderBuildingWizard(wizard) {
  if (wizard.step === "form") return renderBuildingForm();
  if (wizard.step === "upload") return renderBuildingUploadStep(wizard);
  if (wizard.step === "review") return renderBuildingReviewStep(wizard);
  if (wizard.step === "assign") return renderBuildingAssignStep(wizard);
  return "";
}

function renderBuildingForm() {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return `
    <form id="building-form" class="wizard-panel">
      <h3>Register a new building</h3>
      <label class="inspection-field"><span>Building name</span><input name="name" required autocomplete="off" /></label>
      <label class="inspection-field"><span>Address <small>(optional)</small></span><input name="address" id="building-address-input" autocomplete="off" /></label>
      <div class="map-picker">
        <div class="map-search-results" id="map-search-results"></div>
        <div class="map-picker__canvas" id="building-map" hidden></div>
        <div class="map-save-bar" id="map-save-bar" hidden>
          <span>${icon("check")} <strong id="map-save-bar-address"></strong></span>
          <span class="quiet-label">Saved to this building — drag the pin to adjust</span>
        </div>
        <p class="map-picker__hint" id="map-picker-hint">Type an address above — it locates automatically. Drag the pin after to fine-tune. Optional — you can still register the building without it.</p>
        <input type="hidden" name="latitude" id="building-latitude" />
        <input type="hidden" name="longitude" id="building-longitude" />
      </div>
      <div class="inspection-field"><span>Inspection days</span>
        <div class="day-checkboxes">
          ${days.map((day) => `<label class="day-checkbox"><input type="checkbox" name="days" value="${day}" ${["Mon", "Tue", "Wed", "Thu", "Fri"].includes(day) ? "checked" : ""} />${day}</label>`).join("")}
        </div>
      </div>
      <div class="inspection-actions">
        <button type="button" class="button button--outline" id="cancel-building-form">Cancel</button>
        <button type="submit" class="button button--primary">Create building</button>
      </div>
      <p class="form-error" id="building-form-error" hidden role="alert"></p>
    </form>`;
}

// The map instance needs a live DOM node it owns — kept out of `state` and
// never touched by a full re-render, since renderApp() rebuilding the
// form's innerHTML out from under an initialized map would break it.
let buildingMap = null;
let buildingMarker = null;

async function placeBuildingMapPin(lat, lon, label) {
  document.querySelector("#building-latitude").value = lat;
  document.querySelector("#building-longitude").value = lon;

  if (label) {
    const saveBar = document.querySelector("#map-save-bar");
    saveBar.hidden = false;
    document.querySelector("#map-save-bar-address").textContent = label;
  }

  const canvas = document.querySelector("#building-map");
  canvas.hidden = false;

  let maps;
  try {
    maps = await loadGoogleMaps();
  } catch (error) {
    document.querySelector("#map-picker-hint").textContent = error.message;
    return;
  }
  // The form may have been cancelled/re-rendered while the script loaded —
  // don't touch a canvas node that's no longer in the live wizard.
  if (!document.body.contains(canvas)) return;

  const position = { lat, lng: lon };
  if (!buildingMap) {
    buildingMap = new maps.Map(canvas, { center: position, zoom: 16 });
    buildingMarker = new maps.Marker({ position, map: buildingMap, draggable: true });
    buildingMarker.addListener("dragend", () => {
      const newPosition = buildingMarker.getPosition();
      document.querySelector("#building-latitude").value = newPosition.lat();
      document.querySelector("#building-longitude").value = newPosition.lng();
      document.querySelector("#map-save-bar-address").textContent = "Custom pin location";
      document.querySelector("#map-save-bar").hidden = false;
    });
  } else {
    buildingMap.setCenter(position);
    buildingMarker.setPosition(position);
    maps.event.trigger(buildingMap, "resize");
  }
}

let addressSearchTimer = null;

function handleAddressInput(event) {
  const q = event.currentTarget.value.trim();
  const resultsBox = document.querySelector("#map-search-results");
  clearTimeout(addressSearchTimer);

  if (q.length < 4) {
    resultsBox.innerHTML = "";
    return;
  }

  // Debounced — this hits a free public geocoder (Nominatim), which asks
  // callers not to fire a request on every keystroke.
  addressSearchTimer = setTimeout(() => runAddressSearch(q), 500);
}

async function runAddressSearch(q) {
  const resultsBox = document.querySelector("#map-search-results");
  resultsBox.innerHTML = `<p class="map-picker__hint">Locating…</p>`;
  try {
    const { results } = await api.geocodeSearch(q);
    if (!results.length) {
      resultsBox.innerHTML = `<p class="map-picker__hint">No results found.</p>`;
      return;
    }
    // Auto-place the closest match immediately — no extra click required —
    // while still listing alternates in case it's the wrong one.
    placeBuildingMapPin(results[0].lat, results[0].lon, results[0].label);
    resultsBox.innerHTML = results
      .map(
        (r, index) =>
          `<button type="button" class="map-search-result ${index === 0 ? "is-selected" : ""}" data-lat="${r.lat}" data-lon="${r.lon}" data-label="${escapeHtml(r.label)}">${escapeHtml(r.label)}</button>`,
      )
      .join("");
    resultsBox.querySelectorAll(".map-search-result").forEach((button) => {
      button.addEventListener("click", () => {
        placeBuildingMapPin(Number(button.dataset.lat), Number(button.dataset.lon), button.dataset.label);
        resultsBox.querySelectorAll(".map-search-result").forEach((b) => b.classList.remove("is-selected"));
        button.classList.add("is-selected");
      });
    });
  } catch (error) {
    resultsBox.innerHTML = `<p class="map-picker__hint">${escapeHtml(error.message)}</p>`;
  }
}

function renderBuildingUploadStep(wizard) {
  return `
    <div class="wizard-panel">
      <h3>${escapeHtml(wizard.building.name)} — build the checklist</h3>
      <p class="parameters-intro">Attach photos of this building's paper inspection sheet — every page/section at once works fine, up to 20 — and the AI will propose one combined digital checklist. You'll review and edit it before it goes live.</p>
      <label class="button button--outline photo-capture__button" for="building-sheet-photo">${icon("camera")} Attach photos of the sheet (up to 20)</label>
      <input type="file" accept="image/*" capture="environment" id="building-sheet-photo" multiple hidden />
      <p class="photo-capture__status" id="building-sheet-status"></p>
    </div>`;
}

function renderBuildingReviewStep(wizard) {
  return `
    <form id="tags-review-form" class="wizard-panel">
      <h3>Review the proposed checklist</h3>
      <p class="parameters-intro">Edit anything that's wrong, remove rows that shouldn't be there, or add ones the AI missed. Nothing is saved until you activate it.</p>
      <div class="tags-review-table">
        <div class="tags-review-row tags-review-row--head">
          <span>System</span><span>Tag no.</span><span>Reading</span><span>Unit</span><span>Type</span><span></span>
        </div>
        ${wizard.proposedTags.map((tag, index) => renderTagReviewRow(tag, index)).join("")}
      </div>
      <div class="inspection-actions inspection-actions--split">
        <button type="button" class="button button--outline button--small" id="add-tag-row">+ Add a row</button>
        <div class="inspection-actions">
          <button type="button" class="button button--outline" id="cancel-tags-review">Cancel</button>
          <button type="submit" class="button button--primary">Activate checklist</button>
        </div>
      </div>
      <p class="form-error" id="tags-review-error" hidden role="alert"></p>
    </form>`;
}

function renderTagReviewRow(tag, index) {
  return `
    <div class="tags-review-row" data-row-index="${index}">
      <input type="text" data-field="system_name" value="${escapeHtml(tag.system_name || "")}" placeholder="System" />
      <input type="text" data-field="tag_no" value="${escapeHtml(tag.tag_no || "")}" placeholder="—" />
      <input type="text" data-field="reading_type" value="${escapeHtml(tag.reading_type || "")}" placeholder="Reading" />
      <input type="text" data-field="unit" value="${escapeHtml(tag.unit || "")}" placeholder="—" />
      <select data-field="value_type">
        <option value="numeric" ${tag.value_type !== "on_off" ? "selected" : ""}>Numeric</option>
        <option value="on_off" ${tag.value_type === "on_off" ? "selected" : ""}>On/off</option>
      </select>
      <button type="button" class="icon-button remove-tag-row" title="Remove this row" aria-label="Remove this row">${icon("warning")}</button>
    </div>`;
}

function renderBuildingAssignStep(wizard) {
  if (!wizard.unassignedSupers.length) {
    return `<div class="wizard-panel"><h3>Checklist activated</h3><p class="parameters-intro">No unassigned superintendent accounts are available right now. An admin can assign one to ${escapeHtml(wizard.building.name)} later.</p><div class="inspection-actions"><button type="button" class="button button--primary" id="close-building-wizard">Done</button></div></div>`;
  }
  return `
    <form id="assign-superintendent-form" class="wizard-panel">
      <h3>Assign a superintendent</h3>
      <label class="inspection-field"><span>Who covers ${escapeHtml(wizard.building.name)}?</span>
        <select name="userId" required>
          <option value="" disabled selected>Select a superintendent</option>
          ${wizard.unassignedSupers.map((super_) => `<option value="${super_.id}">${escapeHtml(super_.full_name)}</option>`).join("")}
        </select>
      </label>
      <div class="inspection-actions">
        <button type="button" class="button button--outline" id="skip-assign-superintendent">Skip for now</button>
        <button type="submit" class="button button--primary">Assign</button>
      </div>
      <p class="form-error" id="assign-error" hidden role="alert"></p>
    </form>`;
}

function resetBuildingWizard() {
  state.buildingWizard = { step: "closed" };
  buildingMap = null;
  buildingMarker = null;
}

async function handleCreateBuilding(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const error = document.querySelector("#building-form-error");
  const data = new FormData(form);
  const days = Array.from(form.querySelectorAll('input[name="days"]:checked')).map((el) => el.value);
  try {
    const latitude = data.get("latitude") ? Number.parseFloat(data.get("latitude")) : null;
    const longitude = data.get("longitude") ? Number.parseFloat(data.get("longitude")) : null;
    const { building } = await api.managerCreateBuilding({
      name: data.get("name"),
      address: data.get("address"),
      inspectionDays: days,
      latitude,
      longitude,
    });
    state.managerBuildings.push({ ...building, tag_count: 0, superintendent_count: 0 });
    state.buildingWizard = { step: "upload", building };
    renderApp();
  } catch (requestError) {
    error.textContent = requestError.message;
    error.hidden = false;
  }
}

const MAX_SHEET_PHOTOS = 20;

async function handleBuildingSheetPhoto(event) {
  const input = event.currentTarget;
  const files = Array.from(input.files || []);
  if (!files.length) return;
  const status = document.querySelector("#building-sheet-status");
  if (files.length > MAX_SHEET_PHOTOS) {
    status.textContent = `Up to ${MAX_SHEET_PHOTOS} photos at a time — you selected ${files.length}.`;
    status.className = "photo-capture__status photo-capture__status--warning";
    input.value = "";
    return;
  }
  status.className = "photo-capture__status photo-capture__status--busy";
  const stopAnimation = startReadingAnimation(status, { estimateSeconds: 6 + files.length * 2 });
  try {
    const images = await Promise.all(
      files.map(async (file) => ({ data: await fileToBase64(file), mediaType: file.type })),
    );
    const { proposedTags } = await api.managerGenerateTags({
      buildingId: state.buildingWizard.building.id,
      images,
    });
    stopAnimation();
    if (!proposedTags.length) {
      status.textContent = `Couldn't confidently read ${files.length === 1 ? "that photo" : "those photos"} — try a clearer, closer shot of one section.`;
      status.className = "photo-capture__status photo-capture__status--warning";
      return;
    }
    state.buildingWizard = { ...state.buildingWizard, step: "review", proposedTags };
    renderApp();
  } catch (requestError) {
    stopAnimation();
    status.textContent = requestError.message;
    status.className = "photo-capture__status photo-capture__status--warning";
  } finally {
    input.value = "";
  }
}

function readTagsFromReviewForm(form) {
  return Array.from(form.querySelectorAll(".tags-review-row:not(.tags-review-row--head)")).map((row) => ({
    system_name: row.querySelector('[data-field="system_name"]').value.trim(),
    tag_no: row.querySelector('[data-field="tag_no"]').value.trim() || null,
    reading_type: row.querySelector('[data-field="reading_type"]').value.trim(),
    unit: row.querySelector('[data-field="unit"]').value.trim() || null,
    value_type: row.querySelector('[data-field="value_type"]').value,
  }));
}

async function handleActivateChecklist(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const error = document.querySelector("#tags-review-error");
  const tags = readTagsFromReviewForm(form).filter((tag) => tag.system_name && tag.reading_type);
  if (!tags.length) {
    error.textContent = "Add at least one reading before activating.";
    error.hidden = false;
    return;
  }
  try {
    await api.managerSaveTags({ buildingId: state.buildingWizard.building.id, tags });
    const { superintendents } = await api.managerUnassignedSuperintendents();
    state.managerBuildings = state.managerBuildings.map((b) =>
      b.id === state.buildingWizard.building.id ? { ...b, tag_count: tags.length } : b,
    );
    state.buildingWizard = { ...state.buildingWizard, step: "assign", unassignedSupers: superintendents };
    renderApp();
  } catch (requestError) {
    error.textContent = requestError.message;
    error.hidden = false;
  }
}

async function handleAssignSuperintendentSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const error = document.querySelector("#assign-error");
  const userId = new FormData(form).get("userId");
  try {
    await api.managerAssignSuperintendent({ buildingId: state.buildingWizard.building.id, userId });
    state.managerBuildings = state.managerBuildings.map((b) =>
      b.id === state.buildingWizard.building.id ? { ...b, superintendent_count: b.superintendent_count + 1 } : b,
    );
    resetBuildingWizard();
    renderApp();
  } catch (requestError) {
    error.textContent = requestError.message;
    error.hidden = false;
  }
}

function renderManagerInspectionPanel(data) {
  if (!data) return "";
  const groups = groupTagsBySystem(data.tags);
  return `
    <section class="card inspection-card" aria-labelledby="manager-inspection-title">
      <div class="card__header">
        <div>
          <p class="section-kicker">${escapeHtml(data.building.name)} · Today's Inspection</p>
          <h2 id="manager-inspection-title">${escapeHtml(formatInspectionDate(data.date))}</h2>
        </div>
        ${renderInspectionStatusBadge(data)}
      </div>
      <form id="parameters-form" class="inspection-form">
        <p class="parameters-intro">Set an optional normal range for any reading. Submitted values outside it are flagged automatically — a value just past the edge shows yellow, further out shows red. Leave a reading blank to skip evaluating it.</p>
        ${Object.entries(groups)
          .map(([system, tags]) => renderParameterGroup(system, tags))
          .join("")}
        <div class="inspection-actions">
          <button type="submit" class="button button--primary" id="save-parameters-button">Save parameters</button>
        </div>
        <p class="form-error" id="parameters-error" hidden role="alert"></p>
      </form>
    </section>`;
}

function renderParameterGroup(system, tags) {
  return `
    <fieldset class="inspection-group">
      <legend>${escapeHtml(system)}</legend>
      <div class="parameter-list">
        ${tags.map(renderParameterRow).join("")}
      </div>
    </fieldset>`;
}

function renderParameterRow(tag) {
  const label = [tag.tag_no, tag.reading_type].filter(Boolean).join(" — ");
  return `
    <div class="parameter-row">
      <div class="parameter-row__reading">
        <span class="parameter-row__label">${escapeHtml(label)}${tag.unit ? ` <small>(${escapeHtml(tag.unit)})</small>` : ""}</span>
        <span class="parameter-row__value">${tag.value ? escapeHtml(tag.value) : "—"}</span>
        ${renderFlagBadge(tag.flag)}
      </div>
      <div class="parameter-row__inputs">
        ${
          tag.value_type === "on_off"
            ? `<label class="parameter-inline"><span>Expected</span>
                <select data-param-tag-id="${tag.id}" data-param-field="expected">
                  <option value="" ${!tag.parameter?.expected ? "selected" : ""}>Not evaluated</option>
                  <option value="on" ${tag.parameter?.expected === "on" ? "selected" : ""}>On</option>
                  <option value="off" ${tag.parameter?.expected === "off" ? "selected" : ""}>Off</option>
                </select>
              </label>`
            : `<label class="parameter-inline"><span>Min</span>
                <input type="number" step="any" data-param-tag-id="${tag.id}" data-param-field="min" value="${tag.parameter?.min ?? ""}" />
              </label>
              <label class="parameter-inline"><span>Max</span>
                <input type="number" step="any" data-param-tag-id="${tag.id}" data-param-field="max" value="${tag.parameter?.max ?? ""}" />
              </label>`
        }
      </div>
    </div>`;
}

function renderFlagBadge(flag) {
  if (!flag) return `<span class="flag-badge flag-badge--neutral">Not evaluated</span>`;
  const labels = { green: "Normal", yellow: "Needs a look", red: "Abnormal" };
  return `<span class="flag-badge flag-badge--${flag}">${escapeHtml(labels[flag])}</span>`;
}

function collectParametersForm(form) {
  const byTag = {};
  form.querySelectorAll("[data-param-tag-id]").forEach((field) => {
    const tagId = field.dataset.paramTagId;
    byTag[tagId] ||= { tagId };
    byTag[tagId][field.dataset.paramField] = field.value;
  });
  return { buildingId: state.managerInspection.building.id, parameters: Object.values(byTag) };
}

async function handleParametersSave(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = document.querySelector("#save-parameters-button");
  const error = document.querySelector("#parameters-error");
  button.disabled = true;
  button.textContent = "Saving…";
  try {
    state.managerInspection = await api.managerParametersSave(collectParametersForm(form));
    renderApp();
  } catch (requestError) {
    error.textContent = requestError.message;
    error.hidden = false;
    button.disabled = false;
    button.textContent = "Save parameters";
  }
}

function renderMetric(metric) {
  return `<article class="metric-card metric-card--${escapeHtml(metric.tone)}">
    <div class="metric-card__top"><span>${escapeHtml(metric.label)}</span><i></i></div>
    <strong>${escapeHtml(metric.value)}</strong>
    <small>${escapeHtml(metric.delta)}</small>
  </article>`;
}

function timeAgo(isoValue) {
  if (!isoValue) return "";
  const ms = Date.now() - new Date(isoValue + "Z").getTime();
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function renderExceptionQueue() {
  const open = state.workOrders.filter((w) => w.status === "open");
  if (!open.length) {
    return `<section class="card exception-card" aria-labelledby="exception-title">
      <div class="card__header"><div><p class="section-kicker">Exception Queue</p><h2 id="exception-title">Needs your attention</h2></div><span class="count-badge">0</span></div>
      <p class="empty-state-inline">${icon("check")} Nothing open right now.</p>
    </section>`;
  }
  return `
    <section class="card exception-card" aria-labelledby="exception-title">
      <div class="card__header"><div><p class="section-kicker">Exception Queue</p><h2 id="exception-title">Needs your attention</h2></div><span class="count-badge">${open.length}</span></div>
      <div class="exception-list">
        ${open.map(renderException).join("")}
      </div>
    </section>
    ${renderExceptionDetail(open)}`;
}

function renderException(item) {
  const selected = item.id === state.selectedExceptionId;
  const tone = item.source === "reading" ? "danger" : "warning";
  return `<button class="exception-item ${selected ? "is-selected" : ""}" data-exception-id="${item.id}" aria-pressed="${selected}">
    <span class="urgency-bar urgency-bar--${tone}"></span>
    <span class="exception-copy"><span class="exception-meta"><strong>${escapeHtml(item.category ? CATEGORY_ICON_LABEL[item.category] || item.category : "Reading")}</strong><span class="due due--${tone}">${icon("clock")}${timeAgo(item.created_at)}</span></span><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.building_name)} · ${escapeHtml(item.reported_by || "Unknown")}</small></span>
    ${icon("arrow")}
  </button>`;
}

const CATEGORY_ICON_LABEL = {
  inventory: "Inventory",
  chemicals: "Chemicals",
  schedule: "Schedule",
  method: "Method",
  other: "Flagged",
};

function renderExceptionDetail(open) {
  const item = open.find((w) => w.id === state.selectedExceptionId) || open[0];
  if (!item) return "";
  const tone = item.source === "reading" ? "danger" : "warning";
  return `<aside class="card detail-card detail-card--${tone}" aria-labelledby="detail-title">
    <div class="detail-card__flag">${icon("warning")} Priority detail</div>
    <p class="eyebrow">${escapeHtml(item.building_name)} · ${timeAgo(item.created_at)}</p>
    <h2 id="detail-title">${escapeHtml(item.title)}</h2>
    <p class="detail-copy">${escapeHtml(item.description || "")}</p>
    <dl class="detail-facts"><div><dt>Reported by</dt><dd>${escapeHtml(item.reported_by || "Unknown")}</dd></div><div><dt>Source</dt><dd>${item.source === "reading" ? "Inspection reading" : CATEGORY_ICON_LABEL[item.category] || "Flagged issue"}</dd></div></dl>
    <button class="button button--dark resolve-work-order" type="button" data-work-order-id="${item.id}">Mark resolved ${icon("check")}</button>
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
    ${renderPendingRequestsPanel()}
    <section class="card admin-panel">
      <div class="card__header"><div><p class="section-kicker">Role Preview</p><h2>Choose a command view</h2></div><span class="quiet-label">Administrator access</span></div>
      <p class="admin-panel__intro">Open another user’s dashboard without using or changing their credentials. Your administrator session remains active.</p>
      <div class="account-grid">
        ${state.accounts.map(renderAccount).join("")}
      </div>
    </section>
    ${renderStatsPanel()}`;
}

function renderStatsPanel() {
  if (!state.adminStats) {
    return `<section class="card"><div class="card__header"><div><p class="section-kicker">Infrastructure</p><h2>Connections &amp; usage</h2></div></div><p class="empty-state-inline">Couldn't load live usage right now.</p></section>`;
  }
  const { connections, usage } = state.adminStats;
  return `
    <section class="card" aria-labelledby="connections-title">
      <div class="card__header"><div><p class="section-kicker">Infrastructure</p><h2 id="connections-title">What's connected</h2></div></div>
      <div class="buildings-list">
        ${connections.map(renderConnectionRow).join("")}
      </div>
    </section>
    <section class="card" aria-labelledby="usage-title">
      <div class="card__header"><div><p class="section-kicker">Live usage</p><h2 id="usage-title">Free tier vs. today</h2></div><span class="quiet-label"><span class="status-dot status-dot--success"></span> Auto-refreshing every 30s — Cloudflare only</span></div>
      <div class="usage-bars">
        ${renderUsageBar(usage.workers)}
        ${renderUsageBar(usage.d1?.storage)}
        ${renderUsageBar(usage.d1?.rowsRead)}
        ${renderUsageBar(usage.d1?.rowsWritten)}
        ${renderUsageBar(usage.pages)}
      </div>
      <p class="map-picker__hint">Gemini and Google Maps usage aren't pulled live here yet — check console.cloud.google.com for those.</p>
    </section>`;
}

function renderConnectionRow(conn) {
  const isLive = conn.status === "connected";
  return `<div class="building-row">
    <div class="building-row__name"><strong>${escapeHtml(conn.name)}</strong><small>${escapeHtml(conn.role)}${conn.note ? " — " + escapeHtml(conn.note) : ""}</small></div>
    <span class="status-chip ${isLive ? "status-chip--live" : "status-chip--registering"}">${isLive ? "Connected" : "Not set up"}</span>
  </div>`;
}

function renderUsageBar(metric) {
  if (!metric || metric.error) return "";
  const tone = metric.percent >= 90 ? "danger" : metric.percent >= 60 ? "warning" : "success";
  // The real percent is what's shown in the label — this is just a visual
  // floor so real, nonzero usage doesn't render as an invisible sliver.
  const barWidth = metric.percent > 0 ? Math.max(metric.percent, 1.5) : 0;
  return `<div class="usage-bar">
    <div class="usage-bar__label"><span>${escapeHtml(metric.label)}</span><span class="quiet-label">${formatNumber(metric.used)} / ${formatNumber(metric.limit)} ${escapeHtml(metric.unit)} · ${escapeHtml(metric.period)} · ${metric.percent}%</span></div>
    <div class="usage-bar__track"><span class="usage-bar__fill usage-bar__fill--${tone}" style="width:${barWidth}%"></span></div>
  </div>`;
}

function formatNumber(n) {
  return new Intl.NumberFormat("en-US").format(n);
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

function renderInspectionView(data) {
  if (!data) return renderErrorState();
  const locked = data.status === "submitted";
  const groups = groupTagsBySystem(data.tags);

  return `
    <section class="card inspection-card" aria-labelledby="inspection-title">
      <div class="card__header">
        <div>
          <p class="section-kicker">${escapeHtml(data.building.name)} · Daily Inspection</p>
          <h2 id="inspection-title">${escapeHtml(formatInspectionDate(data.date))}</h2>
        </div>
        ${renderInspectionStatusBadge(data)}
      </div>
      <form id="inspection-form" class="inspection-form">
        ${Object.entries(groups)
          .map(([system, tags]) => renderInspectionGroup(system, tags, data.readings, locked))
          .join("")}
        <label class="inspection-notes">
          <span>Comments</span>
          <textarea name="notes" rows="3" ${locked ? "disabled" : ""} placeholder="Anything the next shift should know…">${escapeHtml(data.notes || "")}</textarea>
        </label>
        ${
          locked
            ? `<p class="inspection-locked-note">${icon("check")} Submitted ${formatTimestamp(data.submittedAt)} — this inspection is locked. Contact your regional manager if it needs to be reopened.</p>`
            : `<div class="inspection-actions">
                <button type="button" class="button button--outline" id="save-draft-button">Save draft</button>
                <button type="submit" class="button button--primary" id="submit-inspection-button">Submit inspection</button>
              </div>
              <p class="form-error" id="inspection-error" hidden role="alert"></p>`
        }
      </form>
    </section>`;
}

const ISSUE_CATEGORIES = {
  inventory: "Inventory",
  chemicals: "Chemicals / supplies",
  schedule: "Schedule question",
  method: "Method / procedure question",
  other: "Something else",
};

function renderPhotoLibraryCard(defaultBuildingId, buildingOptions) {
  const lib = state.photoLibrary;
  if (!lib.open) {
    return `<section class="card">
      <div class="card__header">
        <div><p class="section-kicker">Photo history</p><h2>Photo library</h2></div>
        <button type="button" class="button button--outline button--small" id="open-photo-library" data-default-building-id="${defaultBuildingId}">${icon("image")} Open library</button>
      </div>
    </section>`;
  }
  return `<section class="card">
    <div class="card__header">
      <div><p class="section-kicker">Photo history</p><h2>Photo library</h2></div>
      <button type="button" class="icon-button" id="close-photo-library" aria-label="Close photo library">${icon("close")}</button>
    </div>
    <div class="photo-library">
      ${
        buildingOptions
          ? `<label class="inspection-field"><span>Building</span>
              <select id="photo-library-building">
                ${buildingOptions.map((b) => `<option value="${b.id}" ${b.id === lib.buildingId ? "selected" : ""}>${escapeHtml(b.name)}</option>`).join("")}
              </select>
            </label>`
          : ""
      }
      <div class="photo-library__layout">
        <div class="photo-library__dates">
          ${
            lib.dates.length
              ? lib.dates.map((d) => `<button type="button" class="photo-library__date ${d === lib.selectedDate ? "is-selected" : ""}" data-date="${d}">${escapeHtml(formatInspectionDate(d))}</button>`).join("")
              : `<p class="quiet-label">No photos yet.</p>`
          }
        </div>
        <div class="photo-library__grid">
          ${
            lib.loading
              ? `<p class="quiet-label">Loading…</p>`
              : lib.photos.length
                ? lib.photos.map((p) => `<a href="${api.photoViewUrl(p.key)}" target="_blank" rel="noopener" class="photo-library__thumb"><img src="${api.photoViewUrl(p.key)}" alt="" loading="lazy" /><span>${escapeHtml(formatTimestamp(p.uploadedAt))}</span></a>`).join("")
                : lib.selectedDate
                  ? `<p class="quiet-label">Nothing for this day.</p>`
                  : ""
          }
        </div>
      </div>
    </div>
  </section>`;
}

async function openPhotoLibrary(buildingId) {
  state.photoLibrary = { open: true, buildingId, dates: [], selectedDate: null, photos: [], loading: true };
  renderApp();
  const { dates } = await api.photoDates(buildingId);
  state.photoLibrary.dates = dates;
  state.photoLibrary.loading = false;
  if (dates.length) {
    await selectPhotoLibraryDate(dates[0]);
  } else {
    renderApp();
  }
}

async function selectPhotoLibraryDate(date) {
  state.photoLibrary.selectedDate = date;
  state.photoLibrary.loading = true;
  renderApp();
  const { photos } = await api.photoList(state.photoLibrary.buildingId, date);
  state.photoLibrary.photos = photos;
  state.photoLibrary.loading = false;
  renderApp();
}

function renderFlagIssuePanel() {
  if (!state.flagIssueOpen) {
    return `<section class="card flag-issue-card">
      <div class="card__header">
        <div><p class="section-kicker">Need help with something else?</p><h2>Not about a reading</h2></div>
        <button type="button" class="button button--outline button--small" id="open-flag-issue">Flag an issue</button>
      </div>
      ${
        state.flagIssueJustSent
          ? `<p class="parameters-intro">${icon("check")} Sent to your operations manager.</p>`
          : `<p class="parameters-intro">Inventory, low chemicals, a schedule question, or how to clean something — anything that needs your operations manager's attention and isn't something a coworker can answer.</p>`
      }
    </section>`;
  }
  return `<section class="card flag-issue-card">
    <form id="flag-issue-form" class="wizard-panel">
      <h3>Flag an issue for your operations manager</h3>
      <div class="inspection-field"><span>What kind of issue?</span>
        <select name="category">
          ${Object.entries(ISSUE_CATEGORIES)
            .map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`)
            .join("")}
        </select>
      </div>
      <label class="inspection-field"><span>Describe it</span><textarea name="description" rows="3" required placeholder="Be specific — what's needed, and how urgent it is."></textarea></label>
      <div class="inspection-actions">
        <button type="button" class="button button--outline" id="cancel-flag-issue">Cancel</button>
        <button type="submit" class="button button--primary">Send to operations manager</button>
      </div>
      <p class="form-error" id="flag-issue-error" hidden role="alert"></p>
    </form>
  </section>`;
}

async function handleFlagIssueSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const error = document.querySelector("#flag-issue-error");
  const data = new FormData(form);
  button.disabled = true;
  try {
    await api.flagIssue({ category: data.get("category"), description: data.get("description") });
    state.flagIssueOpen = false;
    state.flagIssueJustSent = true;
    renderApp();
  } catch (requestError) {
    error.textContent = requestError.message;
    error.hidden = false;
    button.disabled = false;
  }
}

function renderInspectionStatusBadge(data) {
  if (data.status === "submitted") {
    return `<span class="status-pill status-pill--success">${icon("check")} Submitted</span>`;
  }
  if (data.status === "draft") {
    return `<span class="status-pill status-pill--warning">${icon("clock")} Draft saved</span>`;
  }
  return `<span class="status-pill">${icon("clock")} Not started</span>`;
}

function renderInspectionGroup(system, tags, readings, locked) {
  const groupId = `photo-${slugify(system)}`;
  return `
    <fieldset class="inspection-group">
      <legend>${escapeHtml(system)}</legend>
      ${
        locked
          ? ""
          : `<div class="photo-capture">
              <label class="button button--outline button--small photo-capture__button" for="${groupId}">
                ${icon("camera")} Use a photo for this section
              </label>
              <input type="file" accept="image/*" capture="environment" id="${groupId}" data-photo-group="${escapeHtml(system)}" hidden />
              <span class="photo-capture__status" data-photo-status="${escapeHtml(system)}"></span>
            </div>`
      }
      <div class="inspection-grid">
        ${tags.map((tag) => renderInspectionField(tag, readings[tag.id], locked)).join("")}
      </div>
    </fieldset>`;
}

function renderInspectionField(tag, value, locked) {
  const label = [tag.tag_no, tag.reading_type].filter(Boolean).join(" — ");
  return `
    <label class="inspection-field" data-field-tag-id="${tag.id}">
      <span>${escapeHtml(label)}${tag.unit ? ` <small>(${escapeHtml(tag.unit)})</small>` : ""}</span>
      <input
        type="text"
        name="tag-${tag.id}"
        data-tag-id="${tag.id}"
        value="${escapeHtml(value ?? "")}"
        ${locked ? "disabled" : ""}
        autocomplete="off"
      />
    </label>`;
}

function slugify(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

// A rotating, mildly-funny status so a ~7-9s AI call doesn't read as
// "did this break?" — cycles a message every ~1.5s and counts up real
// elapsed seconds so the humor doesn't outstay a genuinely slow response.
const READING_JOKES = [
  "Squinting at your handwriting…",
  "Arguing with a boiler about its own pressure…",
  "Counting gauges (there are a lot of gauges)…",
  "Politely asking the AI to focus…",
  "Cross-referencing pipe labels…",
  "Zooming in on a smudge, hoping it's a number…",
  "Double-checking it's not just a coffee stain…",
  "Almost there, we promise…",
];

function startReadingAnimation(statusEl, { estimateSeconds = 8 } = {}) {
  const start = Date.now();
  let index = 0;
  const tick = () => {
    const elapsed = Math.round((Date.now() - start) / 1000);
    statusEl.textContent = `${READING_JOKES[index % READING_JOKES.length]} (usually ~${estimateSeconds}s — ${elapsed}s so far)`;
    index += 1;
  };
  tick();
  const interval = setInterval(tick, 1500);
  return () => clearInterval(interval);
}

async function fileToBase64(file) {
  const buffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function handlePhotoCapture(event) {
  const input = event.currentTarget;
  const file = input.files?.[0];
  if (!file) return;
  const system = input.dataset.photoGroup;
  const status = document.querySelector(`[data-photo-status="${CSS.escape(system)}"]`);
  const tagIds = Array.from(document.querySelectorAll(`.inspection-group:has([data-photo-group="${CSS.escape(system)}"]) [data-tag-id]`)).map(
    (el) => Number(el.dataset.tagId),
  );

  status.className = "photo-capture__status photo-capture__status--busy";
  const stopAnimation = startReadingAnimation(status, { estimateSeconds: 6 });
  try {
    const imageBase64 = await fileToBase64(file);
    const response = await api.inspectionPhoto({ tagIds, imageBase64, mediaType: file.type });
    stopAnimation();
    let filled = 0;
    const unclear = [];
    for (const result of response.results) {
      const field = document.querySelector(`[data-field-tag-id="${result.tagId}"] input`);
      if (!field) continue;
      if (result.value != null && !result.unclear) {
        field.value = result.value;
        field.closest("label").classList.add("inspection-field--filled");
        filled += 1;
      } else if (result.unclear) {
        field.closest("label").classList.add("inspection-field--unclear");
        unclear.push(field.closest("label").querySelector("span").textContent);
      }
    }
    status.textContent = unclear.length
      ? `Filled ${filled} — retake for: ${unclear.join(", ")}`
      : filled
        ? `Filled ${filled} reading${filled === 1 ? "" : "s"} from this photo`
        : "Couldn't read any of these readings in that photo — try again";
    status.className = `photo-capture__status ${unclear.length || !filled ? "photo-capture__status--warning" : "photo-capture__status--success"}`;
  } catch (error) {
    stopAnimation();
    status.textContent = error.message;
    status.className = "photo-capture__status photo-capture__status--warning";
  } finally {
    input.value = "";
  }
}

function groupTagsBySystem(tags) {
  const groups = {};
  for (const tag of tags) {
    if (!groups[tag.system_name]) groups[tag.system_name] = [];
    groups[tag.system_name].push(tag);
  }
  return groups;
}

function formatInspectionDate(isoDate) {
  const date = new Date(`${isoDate}T00:00:00`);
  return date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

function formatTimestamp(isoValue) {
  if (!isoValue) return "";
  return new Date(isoValue).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function collectInspectionForm(form) {
  const readings = {};
  form.querySelectorAll("[data-tag-id]").forEach((input) => {
    readings[input.dataset.tagId] = input.value;
  });
  return { notes: form.querySelector('[name="notes"]').value, readings };
}

async function handleInspectionSave(event) {
  const form = document.querySelector("#inspection-form");
  const button = document.querySelector("#save-draft-button");
  const error = document.querySelector("#inspection-error");
  button.disabled = true;
  const originalLabel = button.textContent;
  button.textContent = "Saving…";
  try {
    state.inspection = await api.inspectionSave(collectInspectionForm(form));
    renderApp();
  } catch (requestError) {
    error.textContent = requestError.message;
    error.hidden = false;
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

// Same normal-range logic as the manager's flagging (worker/manager.js) —
// duplicated client-side on purpose, so a superintendent gets caught before
// submitting rather than finding out from the manager afterward.
function clientFlagFor(tag, rawValue) {
  const parameter = tag.parameter;
  if (!parameter || rawValue == null || rawValue === "") return null;

  if (tag.value_type === "on_off") {
    if (!parameter.expected) return null;
    return rawValue.trim().toLowerCase() === parameter.expected.trim().toLowerCase() ? null : "red";
  }

  if (parameter.min == null || parameter.max == null) return null;
  const num = Number.parseFloat(rawValue);
  if (Number.isNaN(num)) return "red";
  if (num >= parameter.min && num <= parameter.max) return null;

  const buffer = Math.max((parameter.max - parameter.min) * 0.1, 1);
  return num >= parameter.min - buffer && num <= parameter.max + buffer ? "yellow" : "red";
}

function findFlaggedReadings(readings) {
  return state.inspection.tags
    .map((tag) => ({ tag, value: readings[tag.id], flag: clientFlagFor(tag, readings[tag.id]) }))
    .filter((item) => item.flag);
}

async function handleInspectionSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const { readings } = collectInspectionForm(form);
  const flagged = findFlaggedReadings(readings);

  if (flagged.length && !state.confirmedOutOfRange) {
    state.pendingSubmitForm = form;
    renderOutOfRangeModal(flagged);
    return;
  }

  await submitInspection(form);
}

async function submitInspection(form) {
  const button = document.querySelector("#submit-inspection-button");
  const error = document.querySelector("#inspection-error");
  if (button) {
    button.disabled = true;
    button.textContent = "Submitting…";
  }
  try {
    state.inspection = await api.inspectionSubmit({
      ...collectInspectionForm(form),
      confirmedAbnormalTagIds: state.confirmedAbnormalTagIds || [],
    });
    state.confirmedOutOfRange = false;
    state.confirmedAbnormalTagIds = [];
    renderApp();
  } catch (requestError) {
    if (error) {
      error.textContent = requestError.message;
      error.hidden = false;
    }
    if (button) {
      button.disabled = false;
      button.textContent = "Submit inspection";
    }
  }
}

function renderOutOfRangeModal(flagged) {
  const existing = document.querySelector("#out-of-range-modal");
  if (existing) existing.remove();

  const wrap = document.createElement("div");
  wrap.id = "out-of-range-modal";
  wrap.className = "modal-overlay";
  wrap.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="out-of-range-title">
      <h3 id="out-of-range-title">${icon("warning")} Double-check before submitting</h3>
      <p>${flagged.length === 1 ? "This reading is" : "These readings are"} outside the normal range. Confirm each one before it goes to your operations manager.</p>
      <div class="out-of-range-list">
        ${flagged
          .map(
            (item) => `
          <div class="out-of-range-item" data-tag-id="${item.tag.id}">
            <div class="out-of-range-item__label"><strong>${escapeHtml([item.tag.tag_no, item.tag.reading_type].filter(Boolean).join(" — "))}</strong><span>You entered: ${escapeHtml(String(item.value))}${item.tag.unit ? " " + escapeHtml(item.tag.unit) : ""}</span></div>
            <div class="out-of-range-item__actions">
              <button type="button" class="button button--small button--outline" data-choice="fix">Let me fix it</button>
              <button type="button" class="button button--small button--light" data-choice="normal">It's normal</button>
              <button type="button" class="button button--small button--danger" data-choice="abnormal">It's abnormal</button>
            </div>
          </div>`,
          )
          .join("")}
      </div>
      <div class="inspection-actions">
        <button type="button" class="button button--outline" id="out-of-range-cancel">Cancel</button>
        <button type="button" class="button button--primary" id="out-of-range-confirm" disabled>Confirm &amp; submit</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);

  const decisions = new Map();
  const confirmButton = wrap.querySelector("#out-of-range-confirm");

  wrap.querySelectorAll(".out-of-range-item").forEach((item) => {
    const tagId = item.dataset.tagId;
    item.querySelectorAll("[data-choice]").forEach((button) => {
      button.addEventListener("click", () => {
        const choice = button.dataset.choice;
        if (choice === "fix") {
          wrap.remove();
          document.querySelector(`[data-field-tag-id="${tagId}"] input`)?.focus();
          return;
        }
        decisions.set(tagId, choice);
        item.querySelectorAll("[data-choice]").forEach((b) => b.classList.remove("is-selected"));
        button.classList.add("is-selected");
        confirmButton.disabled = decisions.size < flagged.length;
      });
    });
  });

  wrap.querySelector("#out-of-range-cancel").addEventListener("click", () => wrap.remove());
  confirmButton.addEventListener("click", async () => {
    state.confirmedOutOfRange = true;
    state.confirmedAbnormalTagIds = Array.from(decisions.entries())
      .filter(([, choice]) => choice === "abnormal")
      .map(([tagId]) => Number(tagId));
    wrap.remove();
    await submitInspection(state.pendingSubmitForm);
  });
}

function renderPropertyView(data) {
  if (!data) return renderErrorState();
  if (!data.days.length) {
    return `<section class="card empty-state"><span>${icon("clock")}</span><h2>No inspections yet</h2><p>${escapeHtml(data.building.name)} hasn't had an inspection submitted yet — check back after today's rounds.</p></section>`;
  }
  return `
    <section class="card" aria-labelledby="property-log-title">
      <div class="card__header">
        <div><p class="section-kicker">${escapeHtml(data.building.name)}</p><h2 id="property-log-title">Inspection log</h2></div>
        <span class="quiet-label">Last ${data.days.length} day${data.days.length === 1 ? "" : "s"}</span>
      </div>
      <div class="property-log">
        <div class="property-log__row property-log__row--head">
          <span>Date</span><span>Status</span><span>Started</span><span>Submitted</span><span>Outcome</span>
        </div>
        ${data.days.map(renderPropertyLogRow).join("")}
      </div>
    </section>`;
}

function renderPropertyLogRow(day) {
  const outcomeLabels = {
    normal: ["Normal", "flag-badge--green"],
    needs_look: ["Needs a look", "flag-badge--yellow"],
    abnormal: ["Abnormal", "flag-badge--red"],
    not_evaluated: ["Not evaluated", "flag-badge--neutral"],
  };
  const [label, tone] = outcomeLabels[day.outcome];
  return `
    <div class="property-log__row">
      <span>${escapeHtml(formatInspectionDate(day.date))}</span>
      <span class="status-pill ${day.status === "submitted" ? "status-pill--success" : "status-pill--warning"}">${day.status === "submitted" ? "Submitted" : "Draft"}</span>
      <span>${escapeHtml(formatTimestamp(day.startedAt) || "—")}</span>
      <span>${escapeHtml(formatTimestamp(day.submittedAt) || "—")}</span>
      <span class="flag-badge ${tone}">${escapeHtml(label)}</span>
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
      state.selectedExceptionId = Number(button.dataset.exceptionId);
      renderApp();
    });
  });
  document.querySelectorAll(".resolve-work-order").forEach((button) => {
    button.addEventListener("click", () => handleResolveWorkOrder(button));
  });
  document.querySelector("#open-flag-issue")?.addEventListener("click", () => {
    state.flagIssueOpen = true;
    state.flagIssueJustSent = false;
    renderApp();
  });
  document.querySelector("#cancel-flag-issue")?.addEventListener("click", () => {
    state.flagIssueOpen = false;
    renderApp();
  });
  document.querySelector("#flag-issue-form")?.addEventListener("submit", handleFlagIssueSubmit);
  document.querySelector("#open-photo-library")?.addEventListener("click", (event) => {
    openPhotoLibrary(Number(event.currentTarget.dataset.defaultBuildingId));
  });
  document.querySelector("#close-photo-library")?.addEventListener("click", () => {
    state.photoLibrary = { open: false, buildingId: null, dates: [], selectedDate: null, photos: [], loading: false };
    renderApp();
  });
  document.querySelector("#photo-library-building")?.addEventListener("change", (event) => {
    openPhotoLibrary(Number(event.currentTarget.value));
  });
  document.querySelectorAll(".photo-library__date").forEach((button) => {
    button.addEventListener("click", () => selectPhotoLibraryDate(button.dataset.date));
  });
  document.querySelectorAll(".impersonate-button").forEach((button) => {
    button.addEventListener("click", () => handleImpersonate(button));
  });
  document.querySelector("#save-draft-button")?.addEventListener("click", handleInspectionSave);
  document.querySelector("#inspection-form")?.addEventListener("submit", handleInspectionSubmit);
  document.querySelectorAll("[data-photo-group]").forEach((input) => {
    input.addEventListener("change", handlePhotoCapture);
  });
  document.querySelector("#parameters-form")?.addEventListener("submit", handleParametersSave);

  document.querySelector("#register-building-toggle")?.addEventListener("click", () => {
    buildingMap = null;
    buildingMarker = null;
    state.buildingWizard = { step: "form" };
    renderApp();
  });
  document.querySelector("#building-address-input")?.addEventListener("input", handleAddressInput);
  document.querySelector("#cancel-building-form")?.addEventListener("click", () => {
    resetBuildingWizard();
    renderApp();
  });
  document.querySelector("#building-form")?.addEventListener("submit", handleCreateBuilding);
  document.querySelector("#building-sheet-photo")?.addEventListener("change", handleBuildingSheetPhoto);
  document.querySelector("#cancel-tags-review")?.addEventListener("click", () => {
    resetBuildingWizard();
    renderApp();
  });
  document.querySelector("#add-tag-row")?.addEventListener("click", () => {
    state.buildingWizard.proposedTags.push({ system_name: "", tag_no: "", reading_type: "", unit: "", value_type: "numeric" });
    renderApp();
  });
  document.querySelectorAll(".remove-tag-row").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.closest("[data-row-index]").dataset.rowIndex);
      state.buildingWizard.proposedTags.splice(index, 1);
      renderApp();
    });
  });
  document.querySelector("#tags-review-form")?.addEventListener("submit", handleActivateChecklist);
  document.querySelector("#assign-superintendent-form")?.addEventListener("submit", handleAssignSuperintendentSubmit);
  document.querySelector("#skip-assign-superintendent")?.addEventListener("click", () => {
    resetBuildingWizard();
    renderApp();
  });
  document.querySelector("#close-building-wizard")?.addEventListener("click", () => {
    resetBuildingWizard();
    renderApp();
  });

  document.querySelectorAll(".approve-request").forEach((button) => {
    button.addEventListener("click", () => handlePendingRequestDecision(button, true));
  });
  document.querySelectorAll(".deny-request").forEach((button) => {
    button.addEventListener("click", () => handlePendingRequestDecision(button, false));
  });
  document.querySelectorAll(".view-as-superintendent").forEach((button) => {
    button.addEventListener("click", () => handleImpersonate(button));
  });
  document.querySelectorAll(".push-live-button").forEach((button) => {
    button.addEventListener("click", () => handlePushLive(button));
  });
  document.querySelectorAll(".delete-building-button").forEach((button) => {
    button.addEventListener("click", () => {
      state.deleteBuildingTarget = { id: Number(button.dataset.buildingId), name: button.dataset.buildingName };
      renderApp();
    });
  });
  document.querySelector("#cancel-delete-building")?.addEventListener("click", () => {
    state.deleteBuildingTarget = null;
    renderApp();
  });
  document.querySelector("#delete-building-confirm-text")?.addEventListener("input", (event) => {
    const confirmButton = document.querySelector("#confirm-delete-building");
    confirmButton.disabled = event.currentTarget.value !== confirmButton.dataset.required;
  });
  document.querySelector("#confirm-delete-building")?.addEventListener("click", (event) => handleDeleteBuilding(event.currentTarget));
  document.querySelectorAll(".continue-setup-button").forEach((button) => {
    button.addEventListener("click", () => {
      buildingMap = null;
      buildingMarker = null;
      state.buildingWizard = {
        step: "upload",
        building: { id: Number(button.dataset.buildingId), name: button.dataset.buildingName },
      };
      renderApp();
    });
  });
}

async function handlePendingRequestDecision(button, approve) {
  button.disabled = true;
  const userId = Number(button.dataset.userId);
  try {
    await (approve ? api.managerApproveRequest(userId) : api.managerDenyRequest(userId));
    state.pendingRequests = state.pendingRequests.filter((req) => req.id !== userId);
    renderApp();
  } catch (error) {
    button.disabled = false;
    button.title = error.message;
  }
}

async function handleResolveWorkOrder(button) {
  button.disabled = true;
  const originalLabel = button.textContent;
  button.textContent = "Resolving…";
  try {
    const workOrderId = Number(button.dataset.workOrderId);
    await api.resolveWorkOrder(workOrderId);
    state.workOrders = state.workOrders.map((w) => (w.id === workOrderId ? { ...w, status: "resolved" } : w));
    const remaining = state.workOrders.filter((w) => w.status === "open");
    state.selectedExceptionId = remaining[0]?.id || null;
    renderApp();
  } catch (error) {
    button.disabled = false;
    button.textContent = originalLabel;
    button.title = error.message;
  }
}

async function handleDeleteBuilding(button) {
  button.disabled = true;
  const originalLabel = button.textContent;
  button.textContent = "Deleting…";
  const error = document.querySelector("#delete-building-error");
  try {
    const buildingId = Number(button.dataset.buildingId);
    const confirmationText = document.querySelector("#delete-building-confirm-text").value;
    await api.managerDeleteBuilding({ buildingId, confirmationText });
    state.managerBuildings = state.managerBuildings.filter((b) => b.id !== buildingId);
    state.deleteBuildingTarget = null;
    renderApp();
  } catch (requestError) {
    button.disabled = false;
    button.textContent = originalLabel;
    error.textContent = requestError.message;
    error.hidden = false;
  }
}

async function handlePushLive(button) {
  button.disabled = true;
  const originalLabel = button.textContent;
  button.textContent = "Pushing live…";
  try {
    const buildingId = Number(button.dataset.buildingId);
    await api.managerPushLive({ buildingId });
    state.managerBuildings = state.managerBuildings.map((b) => (b.id === buildingId ? { ...b, status: "active" } : b));
    renderApp();
  } catch (error) {
    button.disabled = false;
    button.textContent = originalLabel;
    button.title = error.message;
  }
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
  stopAdminStatsAutoRefresh();
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
