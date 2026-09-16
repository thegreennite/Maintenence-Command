import "./styles.css";
import { jsPDF } from "jspdf";

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
  buildingWorld: null,
  buildingWorldEditing: false,
  buildingWorldAssignableUsers: [],
  buildingWorldAssignableSupers: [],
  buildingWorldSharing: [],
  buildingWorldRoms: [],
  buildingWorldLocations: [],
  buildingWorldManagingLocations: false,
  buildingWorldRenamingGroupId: null,
  buildingWorldEditingTagId: null,
  buildingWorldSelectedGroupIds: new Set(),
  buildingWorldRenamingBuilding: false,
  buildingWorldHistory: null,
  commandMode: null,
  // Admin-only: pending building-deletion requests, buildings already
  // soft-deleted (kept 30 days), and removed user profiles.
  adminDeleteRequests: [],
  adminDeletedBuildings: [],
  adminRemovedAccounts: [],
  adminAddingAccount: false,
  adminNewAccountRole: "superintendent",
  adminNewAccountCreated: null,
  // Which building rows on the central portfolio list are expanded inline
  // -- an arrow toggle instead of always fully opening the building world
  // page just to check its region/address/coverage at a glance.
  expandedBuildingRowIds: new Set(),
  // The dashboard's "Today's Inspection" parameters panel -- collapsed by
  // default so it doesn't dump one building's entire reading list onto the
  // dashboard; same arrow-toggle idea as the portfolio rows above.
  managerParametersExpanded: false,
  // Agency (cross-company) account state -- see worker/clients.js.
  agencyClients: [],
  agencyActiveCompanyName: null,
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
  // Agency (cross-company) account only -- see worker/clients.js.
  listClients() {
    return this.request("/clients");
  },
  switchClient(clientId) {
    return this.request("/clients/switch", { method: "POST", body: JSON.stringify({ clientId }) });
  },
  // Public: no session required, this IS how a brand-new company's first
  // account gets created ("Add a business" on the login screen).
  createBusiness(payload) {
    return this.request("/business/create", { method: "POST", body: JSON.stringify(payload) });
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
  managerCancelDeleteRequest(payload) {
    return this.request("/manager/buildings/delete-cancel", { method: "POST", body: JSON.stringify(payload) });
  },
  adminDeleteRequests() {
    return this.request("/admin/buildings/delete-requests");
  },
  adminApproveDeleteRequest(payload) {
    return this.request("/admin/buildings/delete-requests/approve", { method: "POST", body: JSON.stringify(payload) });
  },
  adminDenyDeleteRequest(payload) {
    return this.request("/admin/buildings/delete-requests/deny", { method: "POST", body: JSON.stringify(payload) });
  },
  adminDeletedBuildings() {
    return this.request("/admin/buildings/deleted");
  },
  adminRestoreBuilding(payload) {
    return this.request("/admin/buildings/restore", { method: "POST", body: JSON.stringify(payload) });
  },
  adminCreateAccount(payload) {
    return this.request("/admin/accounts/create", { method: "POST", body: JSON.stringify(payload) });
  },
  adminRemoveAccount(payload) {
    return this.request("/admin/accounts/remove", { method: "POST", body: JSON.stringify(payload) });
  },
  adminRestoreAccount(payload) {
    return this.request("/admin/accounts/restore", { method: "POST", body: JSON.stringify(payload) });
  },
  adminRemovedAccounts() {
    return this.request("/admin/accounts/removed");
  },
  adminSetClassification(payload) {
    return this.request("/admin/accounts/classification", { method: "POST", body: JSON.stringify(payload) });
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
  buildingDetail(buildingId) {
    return this.request(`/manager/buildings/detail?buildingId=${buildingId}`);
  },
  updateBuilding(payload) {
    return this.request("/manager/buildings/update", { method: "POST", body: JSON.stringify(payload) });
  },
  createNotice(payload) {
    return this.request("/manager/notices/create", { method: "POST", body: JSON.stringify(payload) });
  },
  deleteNotice(noticeId) {
    return this.request("/manager/notices/delete", { method: "POST", body: JSON.stringify({ noticeId }) });
  },
  assignableUsers() {
    return this.request("/manager/work-orders/assignable");
  },
  assignWorkOrder(payload) {
    return this.request("/manager/work-orders/assign", { method: "POST", body: JSON.stringify(payload) });
  },
  updateProfile(payload) {
    return this.request("/profile", { method: "POST", body: JSON.stringify(payload) });
  },
  photoViewUrl(key) {
    return `${API_BASE}/api/photos/view?key=${encodeURIComponent(key)}`;
  },
  commandModePhoto(payload) {
    return this.request("/inspections/command-photo", { method: "POST", body: JSON.stringify(payload) });
  },
  groupPhotoUpload(payload) {
    return this.request("/inspections/group-photo", { method: "POST", body: JSON.stringify(payload) });
  },
  managerLocations(buildingId) {
    return this.request(`/manager/locations?buildingId=${buildingId}`);
  },
  createLocation(payload) {
    return this.request("/manager/locations/create", { method: "POST", body: JSON.stringify(payload) });
  },
  deleteLocation(locationId) {
    return this.request("/manager/locations/delete", { method: "POST", body: JSON.stringify({ locationId }) });
  },
  assignTagLocation(payload) {
    return this.request("/manager/tags/location", { method: "POST", body: JSON.stringify(payload) });
  },
  managerGroups(buildingId) {
    return this.request(`/manager/groups?buildingId=${buildingId}`);
  },
  createGroup(payload) {
    return this.request("/manager/groups/create", { method: "POST", body: JSON.stringify(payload) });
  },
  deleteGroup(groupId) {
    return this.request("/manager/groups/delete", { method: "POST", body: JSON.stringify({ groupId }) });
  },
  assignTagGroup(payload) {
    return this.request("/manager/tags/group", { method: "POST", body: JSON.stringify(payload) });
  },
  updateTag(payload) {
    return this.request("/manager/tags/update", { method: "POST", body: JSON.stringify(payload) });
  },
  inspectionHistory(buildingId) {
    return this.request(`/manager/buildings/inspection-history?buildingId=${buildingId}`);
  },
  inspectionDetail(buildingId, date) {
    return this.request(`/manager/buildings/inspection-detail?buildingId=${buildingId}&date=${date}`);
  },
  assignGroupLocation(payload) {
    return this.request("/manager/groups/assign-location", { method: "POST", body: JSON.stringify(payload) });
  },
  renameGroup(payload) {
    return this.request("/manager/groups/rename", { method: "POST", body: JSON.stringify(payload) });
  },
  assignableSuperintendents(buildingId) {
    return this.request(`/manager/superintendents/assignable?buildingId=${buildingId}`);
  },
  removeSuperintendent(userId) {
    return this.request("/manager/superintendents/remove", { method: "POST", body: JSON.stringify({ userId }) });
  },
  listRoms() {
    return this.request("/manager/roms");
  },
  buildingSharing(buildingId) {
    return this.request(`/manager/buildings/sharing?buildingId=${buildingId}`);
  },
  shareBuilding(payload) {
    return this.request("/manager/buildings/share", { method: "POST", body: JSON.stringify(payload) });
  },
  unshareBuilding(payload) {
    return this.request("/manager/buildings/unshare", { method: "POST", body: JSON.stringify(payload) });
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

// Reused on the login form and every "create a password" step of
// registration -- a labeled password input with a show/hide eye toggle.
function renderPasswordField({ label, name, autocomplete, minlength, required = true, fieldId }) {
  const id = fieldId || `pw-${name}`;
  return `
    <label for="${id}">
      <span>${escapeHtml(label)}</span>
      <span class="password-field">
        <input id="${id}" name="${name}" type="password" autocomplete="${autocomplete}" ${minlength ? `minlength="${minlength}"` : ""} ${required ? "required" : ""} />
        <button type="button" class="icon-button password-toggle" data-target="${id}" title="Show password" aria-label="Show password">${icon("eye")}</button>
      </span>
    </label>`;
}

function bindPasswordToggles(root = document) {
  root.querySelectorAll(".password-toggle").forEach((button) => {
    button.addEventListener("click", () => {
      const input = document.querySelector(`#${CSS.escape(button.dataset.target)}`);
      if (!input) return;
      const showing = input.type === "text";
      input.type = showing ? "password" : "text";
      button.innerHTML = icon(showing ? "eye" : "eye-off");
      button.title = showing ? "Show password" : "Hide password";
      button.setAttribute("aria-label", button.title);
    });
  });
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
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    eye: '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"/><circle cx="12" cy="12" r="3"/>',
    "eye-off": '<path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61C3.35 8.36 1 12 1 12s4 8 11 8a9.26 9.26 0 0 0 5.39-1.61M1 1l22 22"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
  };
  return `<svg class="icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.command}</svg>`;
}

function setDocumentTitle(suffix) {
  document.title = suffix ? `${suffix} · Power Log Command` : "Power Log Command";
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
      <section class="login-story" aria-label="Power Log Command overview">
        <div class="login-story__inner">
          <div class="brand brand--light">
            <span class="brand-mark">${icon("command")}</span>
            <span>Power Log <strong>Command</strong></span>
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
          <div class="login-panel__top">
            <div class="mobile-brand brand">
              <span class="brand-mark">${icon("command")}</span>
              <span>Power Log <strong>Command</strong></span>
            </div>
            <button type="button" class="link-button add-business-link" id="add-business-link">+ Add a business</button>
          </div>
          <p class="eyebrow">Secure access</p>
          <h2>Welcome back</h2>
          <p class="form-intro">Sign in with your Power Log Command account.</p>
          <form class="login-form" id="login-form">
            <label>
              <span>Username</span>
              <input name="username" autocomplete="username" autocapitalize="none" required />
            </label>
            ${renderPasswordField({ label: "Password", name: "password", autocomplete: "current-password", fieldId: "login-password" })}
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
  document.querySelector("#add-business-link")?.addEventListener("click", () => renderAddBusinessModal());

  document.querySelector("#login-form").addEventListener("submit", handleLogin);
  bindPasswordToggles();
  document.querySelector('input[name="username"]').focus();
}

// "Add a business" -- self-serve company signup, reachable from the login
// screen without an account. Instant: the new Operations Manager account
// is usable the moment this succeeds, credentials arrive by email.
// `fromAgencyView`: true when opened from inside the already-logged-in
// agency broad view (as opposed to the public login screen) -- changes
// the close button's label/behavior to refresh the companies list
// instead of implying a return to sign-in.
function renderAddBusinessModal(fromAgencyView = false) {
  const existing = document.querySelector("#add-business-modal");
  if (existing) existing.remove();

  const wrap = document.createElement("div");
  wrap.id = "add-business-modal";
  wrap.className = "modal-overlay";
  wrap.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="add-business-title">
      <h3 id="add-business-title">${icon("command")} Set up your company</h3>
      <p class="form-intro">Get your own Power Log Command workspace, fully separate from every other company's. You'll be set up as the Operations Manager — from there you can add Area Managers and Superintendents and start registering buildings.</p>
      <form id="add-business-form" class="login-form">
        <label><span>Company name</span><input name="companyName" required maxlength="120" autocomplete="organization" /></label>
        <label><span>Your name</span><input name="fullName" required maxlength="120" autocomplete="name" /></label>
        <label><span>Your email</span><input name="email" type="email" required autocomplete="email" /></label>
        <label><span>Phone <small>(optional)</small></span><input name="phone" type="tel" autocomplete="tel" /></label>
        <p class="form-error" id="add-business-error" hidden role="alert"></p>
        <div class="inspection-actions">
          <button type="button" class="button button--outline" id="cancel-add-business">Cancel</button>
          <button type="submit" class="button button--primary">Create my workspace</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(wrap);

  wrap.querySelector("#cancel-add-business").addEventListener("click", () => wrap.remove());
  wrap.querySelector("#add-business-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const error = wrap.querySelector("#add-business-error");
    const data = new FormData(form);
    error.hidden = true;
    button.disabled = true;
    button.textContent = "Setting up…";
    try {
      const response = await api.createBusiness({
        companyName: data.get("companyName"),
        fullName: data.get("fullName"),
        email: data.get("email"),
        phone: data.get("phone"),
      });
      wrap.querySelector(".modal-card").innerHTML = `
        <h3>${icon("shield")} You're all set</h3>
        <p>${escapeHtml(response.message)}</p>
        <div class="inspection-actions">
          <button type="button" class="button button--primary" id="close-add-business">${fromAgencyView ? "Done" : "Back to sign in"}</button>
        </div>`;
      wrap.querySelector("#close-add-business").addEventListener("click", async () => {
        wrap.remove();
        if (fromAgencyView) await loadAgencyBroadView();
      });
    } catch (requestError) {
      error.textContent = requestError.message;
      error.hidden = false;
      button.disabled = false;
      button.textContent = "Create my workspace";
    }
  });
}

const ROLE_LABELS_FOR_REGISTRATION = {
  superintendent: "Superintendent",
  property_manager: "Property Manager",
  regional_manager: "Area Manager",
  operations_manager: "Operations Manager",
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
            <span>Power Log <strong>Command</strong></span>
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
  bindPasswordToggles();
}

function renderRegisterRoleStep() {
  return `
    <form id="registration-role-form" class="login-form">
      <label><span>I'm a…</span>
        <select name="role" required>
          <option value="" disabled selected>Select your role</option>
          <option value="superintendent">Superintendent</option>
          <option value="property_manager" disabled>Property Manager (coming soon)</option>
          <option value="regional_manager">Area Manager</option>
          <option value="operations_manager">Operations Manager</option>
        </select>
      </label>
      <button class="button button--primary button--full" type="submit"><span>Continue</span>${icon("arrow")}</button>
    </form>`;
}

function handleRegistrationRoleSubmit(event) {
  event.preventDefault();
  const role = new FormData(event.currentTarget).get("role");
  state.registration.role = role;
  const isManagerTier = role === "regional_manager" || role === "operations_manager";
  state.registration.step = isManagerTier ? "profile" : "building";
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
  const isManager = reg.role === "regional_manager" || reg.role === "operations_manager";
  return `
    <p class="form-intro">${
      isManager
        ? `Registering as an ${escapeHtml(ROLE_LABELS_FOR_REGISTRATION[reg.role])}. Once you submit, an administrator will need to approve you before you can sign in.`
        : `Registering for <strong>${escapeHtml(reg.building.name)}</strong>. Once you submit, your operations manager will need to approve you before you can sign in.`
    }</p>
    <form id="registration-profile-form" class="login-form">
      <label><span>Full name</span><input name="fullName" required autocomplete="name" /></label>
      <label><span>Email</span><input name="email" type="email" required autocomplete="email" /></label>
      <label><span>Phone <small>(optional)</small></span><input name="phone" type="tel" autocomplete="tel" /></label>
      ${
        isManager
          ? `<label><span>Region name</span><input name="regionName" required autocomplete="off" placeholder="e.g. North York" /></label>`
          : ""
      }
      ${renderPasswordField({ label: "Create a password", name: "password", autocomplete: "new-password", minlength: 8, fieldId: "registration-password" })}
      <label><span>Profile picture <small>(optional)</small></span><input name="profilePhoto" type="file" accept="image/*" /></label>
      <label class="consent-checkbox">
        <input type="checkbox" name="consent" required />
        <span>I agree to receive text messages and emails from Power Log Command about my account, assignments, and building operations.</span>
      </label>
      <p class="form-error" id="registration-error" hidden role="alert"></p>
      <button class="button button--primary button--full" type="submit"><span>Submit request</span>${icon("arrow")}</button>
    </form>`;
}

function renderRegisterDoneStep(reg) {
  const approver =
    reg.role === "regional_manager" || reg.role === "operations_manager" ? "an administrator" : "your operations manager";
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
    const profilePhoto = photoFile && photoFile.size ? (await compressImageFile(photoFile, { maxDimension: 600, quality: 0.8 })).base64 : null;
    await api.selfRegister({
      role: state.registration.role,
      buildingId: state.registration.building?.id ?? null,
      regionName: data.get("regionName") || null,
      fullName: data.get("fullName"),
      email: data.get("email"),
      phone: data.get("phone"),
      password: data.get("password"),
      profilePhoto,
      contactConsent: data.get("consent") === "on",
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
  const button = form.querySelector('button[type="submit"]');
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
    if (response.user.role === "agency" && response.activeClientId == null) {
      await loadAgencyBroadView();
    } else {
      await loadDashboard();
    }
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
      <section class="login-story" aria-label="Power Log Command overview">
        <div class="login-story__inner">
          <div class="brand brand--light">
            <span class="brand-mark">${icon("command")}</span>
            <span>Power Log <strong>Command</strong></span>
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
            <span>Power Log <strong>Command</strong></span>
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
  const button = form.querySelector('button[type="submit"]');
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

// Broad, all-companies view for the agency account (Lucas) -- shown
// instead of a normal dashboard whenever no company is selected yet.
async function loadAgencyBroadView() {
  renderLoading();
  const { clients } = await api.listClients().catch(() => ({ clients: [] }));
  state.agencyClients = clients;
  state.agencyActiveCompanyName = null;
  renderApp();
}

async function handleEnterClient(clientId) {
  await api.switchClient(clientId);
  state.session = await api.session();
  state.agencyActiveCompanyName = state.agencyClients.find((c) => c.id === clientId)?.name || null;
  await loadDashboard();
}

async function handleExitAgencyClient() {
  await api.switchClient(null);
  state.session = await api.session();
  await loadAgencyBroadView();
}

async function loadDashboard() {
  renderLoading();
  // An agency session already inside a company (isAgency, but a real
  // company is selected) still needs the company's real name for the
  // "which company am I in" banner -- refetched here too, not just on
  // handleEnterClient, so a page reload while already inside a company
  // shows the right name instead of a blank one.
  if (state.session?.isAgency && state.session?.activeClientId != null && !state.agencyActiveCompanyName) {
    const { clients } = await api.listClients().catch(() => ({ clients: [] }));
    state.agencyClients = clients;
    state.agencyActiveCompanyName = clients.find((c) => c.id === state.session.activeClientId)?.name || null;
  }
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
  state.dashboard = dashboardResponse.dashboard;
  state.accounts = accountsResponse.accounts;
  state.inspection = inspectionResponse;
  state.managerInspection = managerInspectionResponse;
  state.propertyInspections = propertyResponse;
  if (isSuperintendent && inspectionResponse?.building) {
    state.buildingWorldHistory = (
      await api.inspectionHistory(inspectionResponse.building.id).catch(() => ({ submissions: [] }))
    ).submissions;
  }
  // An Administrator gets the same building/superintendent/work-order
  // surface a Regional/Operations Manager does -- canSeeAllBuildings()
  // already covers admin on the backend, this is just wiring the frontend
  // up to actually fetch and show it for that role too.
  if (isRegionalManager || isAdminViewing) {
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
  if (isAdminViewing) {
    const [deleteRequestsResponse, deletedBuildingsResponse, removedAccountsResponse] = await Promise.all([
      api.adminDeleteRequests().catch(() => ({ requests: [] })),
      api.adminDeletedBuildings().catch(() => ({ buildings: [] })),
      api.adminRemovedAccounts().catch(() => ({ accounts: [] })),
    ]);
    state.adminDeleteRequests = deleteRequestsResponse.requests;
    state.adminDeletedBuildings = deletedBuildingsResponse.buildings;
    state.adminRemovedAccounts = removedAccountsResponse.accounts;
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
  const { user, actor, isImpersonating, isAgency } = state.session;
  const isAgencyBroadView = user.role === "agency";
  setDocumentTitle(isAgencyBroadView ? "All companies" : user.roleLabel);
  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <a class="brand" href="#" aria-label="Power Log Command home">
          <span class="brand-mark">${icon("command")}</span>
          <span>Power Log <strong>Command</strong></span>
        </a>
        <div class="topbar__right">
          <span class="role-pill">${escapeHtml(user.roleLabel)}</span>
          ${
            user.id != null
              ? `<button class="user-identity user-identity--button" id="open-profile-edit" title="Edit your profile">
                  <span class="avatar">${escapeHtml(initials(user.fullName))}</span>
                  <span><strong>${escapeHtml(user.fullName)}</strong><small>${escapeHtml(user.jobTitle || "")}</small></span>
                  ${icon("edit")}
                </button>`
              : `<span class="user-identity"><span class="avatar">${escapeHtml(initials(user.fullName))}</span><span><strong>${escapeHtml(user.fullName)}</strong></span></span>`
          }
          <button class="icon-button" id="logout-button" title="Sign out" aria-label="Sign out">${icon("logout")}</button>
        </div>
      </header>
      ${
        isImpersonating
          ? `<aside class="impersonation-bar">
              <span>${icon("shield")} <strong>${escapeHtml(actor.fullName)}</strong> is viewing as ${escapeHtml(user.fullName)}</span>
              <button class="button button--small button--light" id="return-admin">Return to ${escapeHtml(actor.fullName.split(" ")[0])}</button>
            </aside>`
          : isAgency && !isAgencyBroadView
            ? `<aside class="impersonation-bar">
                <span>${icon("shield")} Agency view — <strong>${escapeHtml(state.agencyActiveCompanyName || "this company")}</strong></span>
                <button class="button button--small button--light" id="exit-agency-client">← All companies</button>
              </aside>`
            : ""
      }
      <main class="dashboard">
        ${isAgencyBroadView ? renderAgencyClients() : renderDashboard(state.dashboard)}
      </main>
      <footer class="app-footer"><span>Power Log Command</span><span>Phase 5 · Secure operations workspace</span></footer>
    </div>`;

  document.querySelector("#logout-button").addEventListener("click", handleLogout);
  document.querySelector("#return-admin")?.addEventListener("click", handleReturnToAdmin);
  document.querySelector("#exit-agency-client")?.addEventListener("click", handleExitAgencyClient);
  document.querySelector("#open-profile-edit")?.addEventListener("click", () => renderProfileEditModal(user));
  if (isAgencyBroadView) {
    bindAgencyClientsEvents();
    return;
  }
  if (state.commandMode?.active) {
    bindCommandModeEvents();
  } else {
    bindDashboardEvents();
  }
}

function renderAgencyClients() {
  const clients = state.agencyClients || [];
  return `
    <section class="dashboard-heading">
      <div>
        <p class="eyebrow">Agency view</p>
        <h1>All companies</h1>
        <p>Every company running on Power Log Command. Enter one to see its dashboard exactly as its own Operations Manager would.</p>
      </div>
    </section>
    <section class="card">
      <div class="card__header">
        <div><p class="section-kicker">Companies</p><h2>${clients.length} total</h2></div>
        <button class="button button--primary button--small" id="agency-add-business">+ Add a business</button>
      </div>
      ${
        clients.length
          ? `<div class="agency-client-list">
              ${clients
                .map(
                  (c) => `
                <div class="agency-client-row">
                  <div class="agency-client-row__name">
                    <strong>${escapeHtml(c.name)}</strong>
                    <small>${escapeHtml(c.plan)} plan${c.building_limit != null ? ` · up to ${c.building_limit} buildings` : " · unlimited buildings"}</small>
                  </div>
                  <span class="status-pill status-pill--${c.status === "active" ? "success" : "neutral"}">${escapeHtml(c.status)}</span>
                  <button class="button button--small" data-client-id="${c.id}" data-action="enter-client">Enter company</button>
                </div>`,
                )
                .join("")}
            </div>`
          : `<p class="empty-state">No companies yet — add the first one to get started.</p>`
      }
    </section>`;
}

function bindAgencyClientsEvents() {
  document.querySelector("#agency-add-business")?.addEventListener("click", () => renderAddBusinessModal(true));
  document.querySelectorAll('[data-action="enter-client"]').forEach((button) => {
    button.addEventListener("click", () => handleEnterClient(Number(button.dataset.clientId)));
  });
}

function renderDashboard(data) {
  if (!data) return renderErrorState();
  if (state.commandMode?.active && data.kind === "superintendent") {
    return renderCommandMode();
  }
  if (state.buildingWorld && (data.kind === "regional_manager" || data.kind === "admin")) {
    return renderBuildingWorld();
  }
  const body =
    data.kind === "regional_manager"
      ? renderManagerDashboard(data)
      : data.kind === "admin"
        ? renderAdminDashboard(data)
        : data.kind === "superintendent"
          ? renderInspectionView(state.inspection) +
            renderFlagIssuePanel() +
            (state.inspection?.building
              ? `<section class="card building-world__checklist">
                   <div class="card__header"><div><p class="section-kicker">Inspection history</p><h2>Submitted, by week</h2></div></div>
                   ${renderInspectionHistory(state.inspection.building.id)}
                 </section>` + renderPhotoLibraryCard(state.inspection.building.id, null)
              : "")
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
        <div class="card__header"><div><p class="section-kicker">Today’s Coverage</p><h2 id="coverage-title">People on point</h2></div></div>
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
        <small>${escapeHtml(req.role_label || ROLE_LABELS_FOR_REGISTRATION[req.role] || req.role)} · ${escapeHtml(req.building_name)} · ${escapeHtml(req.email)}${req.phone ? " · " + escapeHtml(req.phone) : ""}</small>
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
        <div><p class="section-kicker">Portfolio</p><h2 id="buildings-title">Buildings</h2></div>
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
  const isAdmin = state.session?.user?.role === "admin";
  return `<div class="wizard-panel delete-building-panel">
    <h3>${icon("warning")} ${isAdmin ? "Delete" : "Request deletion of"} ${escapeHtml(building.name)}?</h3>
    <p class="parameters-intro">${
      isAdmin
        ? "This soft-deletes the building immediately — it disappears from every view, but the full record (checklist, every past inspection, work orders) is kept for 30 days in case it needs to be restored. Anyone assigned to it becomes unassigned; their accounts aren't touched."
        : "This doesn't delete anything yet — it sends a request to an Administrator, who has to approve it before the building actually goes away. You can cancel the request any time before then."
    }</p>
    <label class="inspection-field"><span>Type exactly: <code>${escapeHtml(required)}</code></span>
      <input type="text" id="delete-building-confirm-text" autocomplete="off" placeholder="${escapeHtml(required)}" />
    </label>
    <div class="inspection-actions">
      <button type="button" class="button button--outline" id="cancel-delete-building">Cancel</button>
      <button type="button" class="button button--danger" id="confirm-delete-building" data-building-id="${building.id}" data-required="${escapeHtml(required)}" disabled>${isAdmin ? "Delete permanently" : "Request deletion"}</button>
    </div>
    <p class="form-error" id="delete-building-error" hidden role="alert"></p>
  </div>`;
}

function renderBuildingRow(building) {
  const isRegistering = building.status === "registering";
  const expanded = state.expandedBuildingRowIds.has(building.id);
  const isAdmin = state.session?.user?.role === "admin";
  const pendingDeletion = Boolean(building.delete_requested_at);
  return `
    <div class="building-row">
      <div class="building-row__name">
        <button type="button" class="building-name-link" data-building-id="${building.id}"><strong>${escapeHtml(building.name)}</strong></button>
        ${isRegistering ? '<span class="status-chip status-chip--registering">Registering</span>' : ""}
        ${pendingDeletion ? '<span class="status-chip status-chip--registering">Pending deletion approval</span>' : ""}
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
      ${
        pendingDeletion && !isAdmin
          ? `<button type="button" class="button button--outline button--small cancel-delete-request" data-building-id="${building.id}">Cancel deletion request</button>`
          : `<button type="button" class="icon-button delete-building-button" data-building-id="${building.id}" data-building-name="${escapeHtml(building.name)}" title="${isAdmin ? "Delete building" : "Request deletion"}" aria-label="${isAdmin ? "Delete" : "Request deletion for"} ${escapeHtml(building.name)}">${icon("close")}</button>`
      }
      <button type="button" class="icon-button building-row-toggle ${expanded ? "is-expanded" : ""}" data-building-id="${building.id}" title="${expanded ? "Hide" : "Show"} building info" aria-label="${expanded ? "Hide" : "Show"} building info" aria-expanded="${expanded}">${icon("arrow")}</button>
    </div>
    ${expanded ? renderBuildingRowPreview(building) : ""}`;
}

// The inline preview an arrow-toggle reveals -- enough to place/ID the
// building without fully navigating into its (much heavier) world page.
function renderBuildingRowPreview(building) {
  const days = (building.inspection_days || "").split(",").filter(Boolean);
  const user = state.session.user;
  const isManagerOfAll = user.role === "admin" || user.buildingAccess === "all";
  // Distinguish "sees everything because they're OM/admin" from "was
  // specifically granted access to this one building" -- the latter is
  // the building_managers share, not blanket role-based visibility.
  const ownershipLabel = building.is_owner
    ? "You own this building"
    : isManagerOfAll
      ? "Operations Manager access"
      : "Shared with you";
  return `
    <div class="building-row-preview">
      <div class="building-row-preview__grid">
        <div><span class="quiet-label">Region</span><strong>${building.region ? escapeHtml(building.region) : "Not set — e.g. North York"}</strong></div>
        <div><span class="quiet-label">Inspection days</span><strong>${days.length ? days.map((d) => escapeHtml(d)).join(", ") : "—"}</strong></div>
        <div><span class="quiet-label">Readings</span><strong>${building.tag_count} tag${building.tag_count === 1 ? "" : "s"}</strong></div>
        <div><span class="quiet-label">Coverage</span><strong>${building.superintendent_count} superintendent${building.superintendent_count === 1 ? "" : "s"}</strong></div>
        <div><span class="quiet-label">Ownership</span><strong>${ownershipLabel}</strong></div>
      </div>
      <button type="button" class="button button--outline button--small building-name-link" data-building-id="${building.id}">Open full building page →</button>
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
      <p class="parameters-intro">Attach this building's paper inspection sheet — photos, scanned PDFs, or a mix, every page/section at once works fine, up to 20 files — and the AI will propose one combined digital checklist. You'll review and edit it before it goes live.</p>
      <label class="button button--outline photo-capture__button" for="building-sheet-photo">${icon("camera")} Attach photos or PDFs of the sheet (up to 20)</label>
      <input type="file" accept="image/*,application/pdf" capture="environment" id="building-sheet-photo" multiple hidden />
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

// Reading types that are a closed set of exact expected strings, and
// what those strings are -- one source of truth reused for the checklist
// review dropdown, the manager's "Expected" parameter picker, and command
// mode's one-tap choice buttons. Add a future type here only.
const CLOSED_CHOICE_TYPES = {
  // Boilers, compressors, and most equipment with an on/off state also
  // have an auto mode in real mechanical rooms -- same three-state idea
  // as Hand-Off-Auto below, just labeled the way most supers actually
  // say it out loud ("on, off, or auto").
  on_off: { label: "On/off/auto", options: ["on", "off", "auto"] },
  hoa: { label: "Hand-Off-Auto", options: ["Hand", "Off", "Auto"] },
  open_closed: { label: "Open/Closed", options: ["Open", "Closed"] },
};

function renderTagReviewRow(tag, index) {
  return `
    <div class="tags-review-row" data-row-index="${index}">
      <input type="text" data-field="system_name" value="${escapeHtml(tag.system_name || "")}" placeholder="System" />
      <input type="text" data-field="tag_no" value="${escapeHtml(tag.tag_no || "")}" placeholder="—" />
      <input type="text" data-field="reading_type" value="${escapeHtml(tag.reading_type || "")}" placeholder="Reading" />
      <input type="text" data-field="unit" value="${escapeHtml(tag.unit || "")}" placeholder="—" />
      <select data-field="value_type">
        <option value="numeric" ${!CLOSED_CHOICE_TYPES[tag.value_type] ? "selected" : ""}>Numeric</option>
        ${Object.entries(CLOSED_CHOICE_TYPES)
          .map(([value, { label }]) => `<option value="${value}" ${tag.value_type === value ? "selected" : ""}>${escapeHtml(label)}</option>`)
          .join("")}
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
    status.textContent = `Up to ${MAX_SHEET_PHOTOS} files at a time — you selected ${files.length}.`;
    status.className = "photo-capture__status photo-capture__status--warning";
    input.value = "";
    return;
  }
  status.className = "photo-capture__status photo-capture__status--busy";
  const stopAnimation = startReadingAnimation(status, { estimateSeconds: 6 + files.length * 2 });
  try {
    const images = await Promise.all(
      files.map(async (file) => {
        const { base64, mediaType } = await compressImageFile(file);
        return { data: base64, mediaType };
      }),
    );
    const { proposedTags } = await api.managerGenerateTags({
      buildingId: state.buildingWizard.building.id,
      images,
    });
    stopAnimation();
    if (!proposedTags.length) {
      status.textContent = `Couldn't confidently read ${files.length === 1 ? "that file" : "those files"} — try a clearer photo, a cleaner scan, or one section at a time.`;
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
  const expanded = state.managerParametersExpanded;
  return `
    <section class="card inspection-card" aria-labelledby="manager-inspection-title">
      <div class="card__header">
        <div>
          <p class="section-kicker">${escapeHtml(data.building.name)} · Today's Inspection</p>
          <h2 id="manager-inspection-title">${escapeHtml(formatInspectionDate(data.date))}</h2>
        </div>
        <div class="inspection-card__header-actions">
          ${renderInspectionStatusBadge(data)}
          <button type="button" class="icon-button building-row-toggle ${expanded ? "is-expanded" : ""}" id="toggle-manager-parameters" title="${expanded ? "Hide" : "Show"} parameters" aria-label="${expanded ? "Hide" : "Show"} parameters" aria-expanded="${expanded}">${icon("arrow")}</button>
        </div>
      </div>
      ${expanded ? renderManagerParametersBody(data) : ""}
    </section>`;
}

function renderManagerParametersBody(data) {
  const groups = groupTagsBySystem(data.tags);
  return `
    <form id="parameters-form" class="inspection-form">
      <p class="parameters-intro">Set an optional normal range for any reading. Submitted values outside it are flagged automatically — a value just past the edge shows yellow, further out shows red. Leave a reading blank to skip evaluating it.</p>
      ${Object.entries(groups)
        .map(([system, tags]) => renderParameterGroup(system, tags))
        .join("")}
      <div class="inspection-actions">
        <button type="submit" class="button button--primary" id="save-parameters-button">Save parameters</button>
      </div>
      <p class="form-error" id="parameters-error" hidden role="alert"></p>
    </form>`;
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
          CLOSED_CHOICE_TYPES[tag.value_type]
            ? `<label class="parameter-inline"><span>Expected</span>
                <select data-param-tag-id="${tag.id}" data-param-field="expected">
                  <option value="" ${!tag.parameter?.expected ? "selected" : ""}>Not evaluated</option>
                  ${CLOSED_CHOICE_TYPES[tag.value_type].options
                    .map((opt) => `<option value="${escapeHtml(opt)}" ${tag.parameter?.expected === opt ? "selected" : ""}>${escapeHtml(opt)}</option>`)
                    .join("")}
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
    ${renderBuildingsPanel()}
    ${renderAdminBuildingDeletionsPanel()}
    ${renderAdminAccountsManagePanel()}
    <section class="card admin-panel">
      <div class="card__header"><div><p class="section-kicker">Role Preview</p><h2>Choose a command view</h2></div><span class="quiet-label">Administrator access</span></div>
      <p class="admin-panel__intro">Open another user’s dashboard without using or changing their credentials. Your administrator session remains active.</p>
      <div class="account-grid">
        ${state.accounts.map(renderAccount).join("")}
      </div>
    </section>
    ${renderStatsPanel()}`;
}

const CLASSIFICATION_LABELS = { standard: "Standard", beta_tester: "Beta Tester" };

const ADMIN_CREATABLE_ROLES = {
  superintendent: "Superintendent",
  property_manager: "Property Manager",
  regional_manager: "Area Manager",
  operations_manager: "Operations Manager",
  admin: "Administrator",
};

function renderAdminAddAccountForm() {
  const role = state.adminNewAccountRole;
  const isField = role === "superintendent" || role === "property_manager";
  const isManagerTier = role === "regional_manager" || role === "operations_manager";
  const buildings = state.managerBuildings || [];
  return `
    <form id="add-account-form" class="wizard-panel" style="border-top: 1px solid var(--line);">
      <h3>Add an account</h3>
      <label class="inspection-field"><span>Full name</span><input name="fullName" required autocomplete="off" /></label>
      <label class="inspection-field"><span>Email <small>(this is their username)</small></span><input name="email" type="email" required autocomplete="off" /></label>
      <label class="inspection-field"><span>Phone <small>(optional)</small></span><input name="phone" type="tel" autocomplete="off" /></label>
      <label class="inspection-field"><span>Role</span>
        <select name="role" id="add-account-role">
          ${Object.entries(ADMIN_CREATABLE_ROLES)
            .map(
              ([value, label]) =>
                `<option value="${value}" ${role === value ? "selected" : ""} ${value === "property_manager" ? "disabled" : ""}>${escapeHtml(label)}${value === "property_manager" ? " (coming soon)" : ""}</option>`,
            )
            .join("")}
        </select>
      </label>
      <label class="inspection-field" id="add-account-building-field" ${isField ? "" : "hidden"}><span>Building</span>
        <select name="buildingId">
          <option value="">Choose a building…</option>
          ${buildings.map((b) => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join("")}
        </select>
      </label>
      <label class="inspection-field" id="add-account-region-field" ${isManagerTier ? "" : "hidden"}><span>Region <small>(optional)</small></span><input name="regionName" placeholder="e.g. North York" autocomplete="off" /></label>
      <label class="inspection-field"><span>Temporary password</span>
        <span class="add-account-pw">
          <input name="password" id="add-account-password" type="text" minlength="8" required autocomplete="new-password" placeholder="At least 8 characters" />
          <button type="button" class="button button--outline button--small" id="add-account-generate">Generate</button>
        </span>
      </label>
      <p class="quiet-label">Give them the email and password yourself — this is the only time the password is shown. The account is active right away, no approval needed.</p>
      <div class="inspection-actions">
        <button type="button" class="button button--outline" id="add-account-cancel">Cancel</button>
        <button type="submit" class="button button--primary">Create account</button>
      </div>
      <p class="form-error" id="add-account-error" hidden role="alert"></p>
    </form>`;
}

function renderAdminAccountsManagePanel() {
  const removed = state.adminRemovedAccounts || [];
  const created = state.adminNewAccountCreated;
  return `
    <section class="card">
      <div class="card__header">
        <div><p class="section-kicker">Accounts</p><h2>Manage profiles</h2></div>
        ${state.adminAddingAccount ? "" : `<button type="button" class="button button--primary button--small" id="open-add-account">${icon("plus")} Add account</button>`}
      </div>
      ${
        created
          ? `<div class="add-account-success">
              ${icon("check")} <strong>${escapeHtml(created.fullName)}</strong> added as ${escapeHtml(created.roleLabel)}.
              <span class="add-account-success__creds">Username <code>${escapeHtml(created.username)}</code> · Password <code>${escapeHtml(created.password)}</code></span>
              <button type="button" class="button button--outline button--small" id="dismiss-add-account-success">Got it</button>
            </div>`
          : ""
      }
      ${state.adminAddingAccount ? renderAdminAddAccountForm() : ""}
      <div class="buildings-list">
        ${state.accounts
          .map(
            (a) => `<div class="building-row">
              <div class="building-row__name"><strong>${escapeHtml(a.fullName)}</strong><small>${escapeHtml(a.roleLabel)}${a.region ? ` · ${escapeHtml(a.region)}` : ""}</small></div>
              <select class="account-classification" data-user-id="${a.id}">
                ${Object.entries(CLASSIFICATION_LABELS)
                  .map(([value, label]) => `<option value="${value}" ${a.classification === value ? "selected" : ""}>${escapeHtml(label)}</option>`)
                  .join("")}
              </select>
              <button type="button" class="button button--outline button--small remove-account" data-user-id="${a.id}" data-user-name="${escapeHtml(a.fullName)}">Remove</button>
            </div>`,
          )
          .join("")}
      </div>
      ${
        removed.length
          ? `<details style="margin: 10px 22px 18px;"><summary>Removed (${removed.length})</summary>
              <div class="buildings-list">
                ${removed
                  .map(
                    (a) => `<div class="building-row">
                      <div class="building-row__name"><strong>${escapeHtml(a.full_name)}</strong><small>Removed ${formatTimestamp(a.removed_at)}</small></div>
                      <button type="button" class="button button--outline button--small restore-account" data-user-id="${a.id}">Restore</button>
                    </div>`,
                  )
                  .join("")}
              </div>
            </details>`
          : ""
      }
    </section>`;
}

function renderAdminBuildingDeletionsPanel() {
  const requests = state.adminDeleteRequests || [];
  const deleted = state.adminDeletedBuildings || [];
  if (!requests.length && !deleted.length) return "";
  return `
    <section class="card">
      <div class="card__header"><div><p class="section-kicker">Building deletions</p><h2>Requests &amp; recently deleted</h2></div></div>
      <div class="buildings-list">
        ${
          requests.length
            ? requests
                .map(
                  (r) => `<div class="building-row">
                    <div class="building-row__name"><strong>${escapeHtml(r.name)}</strong><small>Requested by ${escapeHtml(r.requested_by_name || "Unknown")} · ${formatTimestamp(r.delete_requested_at)}</small></div>
                    <button type="button" class="button button--outline button--small deny-delete-request" data-building-id="${r.id}">Deny</button>
                    <button type="button" class="button button--danger button--small approve-delete-request" data-building-id="${r.id}">Approve delete</button>
                  </div>`,
                )
                .join("")
            : `<p class="quiet-label" style="padding: 14px 4px;">No pending delete requests.</p>`
        }
      </div>
      ${
        deleted.length
          ? `<details style="margin: 10px 22px 18px;" open><summary>Recently deleted (${deleted.length})</summary>
              <div class="buildings-list">
                ${deleted
                  .map(
                    (b) => `<div class="building-row">
                      <div class="building-row__name"><strong>${escapeHtml(b.name)}</strong><small>Deleted by ${escapeHtml(b.deleted_by_name || "Unknown")} · ${formatTimestamp(b.deleted_at)} · ${b.daysRemaining} day${b.daysRemaining === 1 ? "" : "s"} left before it's gone for good</small></div>
                      <button type="button" class="button button--outline button--small restore-building" data-building-id="${b.id}">Restore</button>
                    </div>`,
                  )
                  .join("")}
              </div>
            </details>`
          : ""
      }
    </section>`;
}

async function openBuildingWorld(buildingId) {
  state.buildingWorld = { loading: true, buildingId };
  state.buildingWorldEditing = false;
  state.buildingWorldHistory = null;
  renderApp();
  const user = state.session.user;
  const canManageSharing = user.role === "admin" || user.buildingAccess === "all";
  const [detail, assignable, history, assignableSupers, sharing, roms] = await Promise.all([
    api.buildingDetail(buildingId).catch(() => null),
    api.assignableUsers().catch(() => ({ users: [] })),
    api.inspectionHistory(buildingId).catch(() => ({ submissions: [] })),
    api.assignableSuperintendents(buildingId).catch(() => ({ superintendents: [] })),
    api.buildingSharing(buildingId).catch(() => ({ shares: [] })),
    canManageSharing ? api.listRoms().catch(() => ({ roms: [] })) : Promise.resolve({ roms: [] }),
  ]);
  if (!detail) {
    state.buildingWorld = null;
    renderApp();
    return;
  }
  state.buildingWorld = { loading: false, buildingId, ...detail };
  state.buildingWorldAssignableUsers = assignable.users;
  state.buildingWorldHistory = history.submissions;
  state.buildingWorldAssignableSupers = assignableSupers.superintendents;
  state.buildingWorldSharing = sharing.shares;
  state.buildingWorldRoms = roms.roms;
  renderApp();
}

function closeBuildingWorld() {
  buildingMap = null;
  buildingMarker = null;
  state.buildingWorld = null;
  state.buildingWorldEditing = false;
  state.buildingWorldHistory = null;
  renderApp();
}

async function refreshBuildingWorldLocations() {
  const detail = await api.buildingDetail(state.buildingWorld.buildingId).catch(() => null);
  if (!detail) return;
  state.buildingWorld.locations = detail.locations;
  state.buildingWorld.groups = detail.groups;
  state.buildingWorld.tags = detail.tags;
  renderApp();
}

async function handleAddLocation(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const input = form.querySelector('input[name="name"]');
  const name = input.value.trim();
  if (!name) return;
  input.disabled = true;
  try {
    await api.createLocation({ buildingId: state.buildingWorld.buildingId, name });
    input.value = "";
    await refreshBuildingWorldLocations();
  } finally {
    input.disabled = false;
  }
}

async function handleRemoveLocation(button) {
  button.disabled = true;
  try {
    await api.deleteLocation(Number(button.dataset.locationId));
    await refreshBuildingWorldLocations();
  } catch (error) {
    button.disabled = false;
    button.title = error.message;
  }
}

async function handleAssignTagLocation(select) {
  select.disabled = true;
  try {
    await api.assignTagLocation({ tagId: Number(select.dataset.tagId), locationId: select.value || null });
    const tag = state.buildingWorld.tags.find((t) => t.id === Number(select.dataset.tagId));
    if (tag) tag.location_id = select.value ? Number(select.value) : null;
  } catch (error) {
    select.title = error.message;
  } finally {
    select.disabled = false;
  }
}

async function handleAddGroup(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const input = form.querySelector('input[name="name"]');
  const name = input.value.trim();
  if (!name) return;
  input.disabled = true;
  try {
    await api.createGroup({ buildingId: state.buildingWorld.buildingId, name });
    input.value = "";
    await refreshBuildingWorldLocations();
  } finally {
    input.disabled = false;
  }
}

async function handleRemoveGroup(button) {
  button.disabled = true;
  try {
    await api.deleteGroup(Number(button.dataset.groupId));
    await refreshBuildingWorldLocations();
  } catch (error) {
    button.disabled = false;
    button.title = error.message;
  }
}

async function handleAssignTagGroup(select) {
  select.disabled = true;
  try {
    await api.assignTagGroup({ tagId: Number(select.dataset.tagId), groupId: select.value || null });
    const tag = state.buildingWorld.tags.find((t) => t.id === Number(select.dataset.tagId));
    if (tag) tag.equipment_group_id = select.value ? Number(select.value) : null;
  } catch (error) {
    select.title = error.message;
  } finally {
    select.disabled = false;
  }
}

async function refreshBuildingWorldCoverage() {
  const buildingId = state.buildingWorld.buildingId;
  const [detail, assignable] = await Promise.all([
    api.buildingDetail(buildingId).catch(() => null),
    api.assignableSuperintendents(buildingId).catch(() => ({ superintendents: [] })),
  ]);
  if (detail) state.buildingWorld.superintendents = detail.superintendents;
  state.buildingWorldAssignableSupers = assignable.superintendents;
  renderApp();
}

async function handleRemoveSuperintendentClick(button) {
  button.disabled = true;
  try {
    await api.removeSuperintendent(Number(button.dataset.userId));
    await refreshBuildingWorldCoverage();
  } catch (error) {
    button.disabled = false;
    button.title = error.message;
  }
}

async function handleAssignSuperintendentWorldSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const select = form.querySelector('select[name="userId"]');
  const userId = select.value;
  if (!userId) return;
  select.disabled = true;
  try {
    await api.managerAssignSuperintendent({ buildingId: state.buildingWorld.buildingId, userId: Number(userId) });
    await refreshBuildingWorldCoverage();
  } catch (error) {
    select.disabled = false;
    select.title = error.message;
  }
}

async function refreshBuildingWorldSharing() {
  const shares = await api.buildingSharing(state.buildingWorld.buildingId).catch(() => ({ shares: [] }));
  state.buildingWorldSharing = shares.shares;
  renderApp();
}

async function handleShareBuildingSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const select = form.querySelector('select[name="userId"]');
  const userId = select.value;
  if (!userId) return;
  select.disabled = true;
  try {
    await api.shareBuilding({ buildingId: state.buildingWorld.buildingId, userId: Number(userId) });
    await refreshBuildingWorldSharing();
  } catch (error) {
    select.disabled = false;
    select.title = error.message;
  }
}

async function handleUnshareBuildingClick(button) {
  button.disabled = true;
  try {
    await api.unshareBuilding({ buildingId: state.buildingWorld.buildingId, userId: Number(button.dataset.userId) });
    await refreshBuildingWorldSharing();
  } catch (error) {
    button.disabled = false;
    button.title = error.message;
  }
}

async function handleAssignGroupLocationChange(select) {
  select.disabled = true;
  const groupId = Number(select.dataset.groupId);
  const locationId = select.value || null;
  try {
    await api.assignGroupLocation({ groupId, locationId });
    for (const tag of state.buildingWorld.tags) {
      if (tag.equipment_group_id === groupId) tag.location_id = locationId ? Number(locationId) : null;
    }
    select.value = "";
    renderApp();
  } catch (error) {
    select.title = error.message;
  } finally {
    select.disabled = false;
  }
}

function handleChecklistGroupSelectToggle(checkbox) {
  const groupId = Number(checkbox.dataset.groupId);
  if (checkbox.checked) state.buildingWorldSelectedGroupIds.add(groupId);
  else state.buildingWorldSelectedGroupIds.delete(groupId);
  renderApp();
}

async function handleChecklistBulkApply() {
  const select = document.querySelector("#checklist-bulk-location");
  const button = document.querySelector("#checklist-bulk-apply");
  const groupIds = Array.from(state.buildingWorldSelectedGroupIds);
  if (!groupIds.length || !select.value) return;
  const locationId = Number(select.value);
  button.disabled = true;
  try {
    await api.assignGroupLocation({ groupIds, locationId });
    for (const tag of state.buildingWorld.tags) {
      if (groupIds.includes(tag.equipment_group_id)) tag.location_id = locationId;
    }
    state.buildingWorldSelectedGroupIds.clear();
    renderApp();
  } catch (error) {
    button.disabled = false;
    button.title = error.message;
  }
}

function handleChecklistBulkClear() {
  state.buildingWorldSelectedGroupIds.clear();
  renderApp();
}

function handleRenameGroupStart(button) {
  state.buildingWorldRenamingGroupId = Number(button.dataset.groupId);
  renderApp();
  document.querySelector(".rename-group-input")?.focus();
}

function handleRenameGroupCancel() {
  state.buildingWorldRenamingGroupId = null;
  renderApp();
}

async function handleRenameGroupSave(button) {
  const groupId = Number(button.dataset.groupId);
  const input = button.closest(".rename-inline").querySelector(".rename-group-input");
  const name = input.value.trim();
  if (!name) return;
  button.disabled = true;
  try {
    await api.renameGroup({ groupId, name });
    const group = (state.buildingWorld.groups || []).find((g) => g.id === groupId);
    if (group) group.name = name;
    for (const tag of state.buildingWorld.tags) {
      if (tag.equipment_group_id === groupId) tag.equipment_group_name = name;
    }
    state.buildingWorldRenamingGroupId = null;
    renderApp();
  } catch (error) {
    button.disabled = false;
    input.title = error.message;
  }
}

function handleEditReadingChipCancel() {
  state.buildingWorldEditingTagId = null;
  renderApp();
}

async function handleEditReadingChipSave(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const error = document.querySelector("#edit-tag-error");
  const button = form.querySelector('button[type="submit"]');
  const data = new FormData(form);
  const tagId = Number(form.dataset.tagId);
  button.disabled = true;
  try {
    const result = await api.updateTag({
      tagId,
      systemName: data.get("system_name"),
      tagNo: data.get("tag_no"),
      readingType: data.get("reading_type"),
      unit: data.get("unit"),
      valueType: data.get("value_type"),
    });
    const tag = state.buildingWorld.tags.find((t) => t.id === tagId);
    if (tag) {
      tag.system_name = data.get("system_name").trim();
      tag.tag_no = data.get("tag_no").trim() || null;
      tag.reading_type = data.get("reading_type").trim();
      tag.unit = data.get("unit").trim() || null;
      tag.value_type = result.valueType;
    }
    state.buildingWorldEditingTagId = null;
    renderApp();
  } catch (requestError) {
    button.disabled = false;
    error.textContent = requestError.message;
    error.hidden = false;
  }
}

// ---------------------------------------------------------------------
// Reading-chip drag + tap-to-edit, unified. Press anywhere on a chip and
// hold-drag it onto another machine to regroup it; a plain tap opens
// the editor -- decided by how far the pointer actually moved, not by
// which part of the chip was touched (an earlier version required
// grabbing one small grip corner specifically, which isn't how anyone
// actually tries to drag something -- they grab the label). Built on
// Pointer Events, not native HTML5 drag-and-drop, since native DnD
// doesn't work on a touch screen and this app is used mobile-first.
// `chipPointer` is one module-level var (not on `state`) since it's
// pure interaction bookkeeping mid-gesture, torn down on every release
// -- nothing here needs to survive a re-render.
// ---------------------------------------------------------------------
const CHIP_DRAG_THRESHOLD_PX = 6;
let chipPointer = null;

function handleReadingChipPointerDown(event) {
  if (event.pointerType === "mouse" && event.button !== 0) return; // left-click only
  if (event.target.closest("select")) return; // let the per-tag location select open normally
  const chip = event.currentTarget;
  const zone = chip.closest("[data-dropzone]");
  if (!zone) return;

  chipPointer = {
    tagId: Number(chip.dataset.tagId),
    chip,
    originGroupId: zone.dataset.dropzone,
    startX: event.clientX,
    startY: event.clientY,
    pointerId: event.pointerId,
    dragging: false,
    ghost: null,
    hoverZone: null,
  };

  try {
    chip.setPointerCapture(event.pointerId);
  } catch {
    // Pointer capture is a nice-to-have (keeps the drag tracking even if
    // the finger/cursor slips off the chip mid-gesture) -- if the
    // browser refuses it for any reason, the listeners below still work
    // off plain event bubbling, just without that guarantee.
  }
  chip.addEventListener("pointermove", handleReadingChipPointerMove);
  chip.addEventListener("pointerup", handleReadingChipPointerUp);
  chip.addEventListener("pointercancel", handleReadingChipPointerCancel);
}

function positionDragGhost(ghost, x, y) {
  ghost.style.left = `${x}px`;
  ghost.style.top = `${y}px`;
}

function handleReadingChipPointerMove(event) {
  if (!chipPointer) return;
  const dx = event.clientX - chipPointer.startX;
  const dy = event.clientY - chipPointer.startY;

  if (!chipPointer.dragging) {
    if (Math.hypot(dx, dy) < CHIP_DRAG_THRESHOLD_PX) return;
    // Just crossed the threshold -- this is a real drag, not a tap.
    // Spin up the ghost now (not on pointerdown), so a plain click never
    // shows one for an instant.
    chipPointer.dragging = true;
    const rect = chipPointer.chip.getBoundingClientRect();
    const ghost = chipPointer.chip.cloneNode(true);
    ghost.classList.add("reading-chip--ghost");
    ghost.style.width = `${rect.width}px`;
    document.body.appendChild(ghost);
    chipPointer.ghost = ghost;
    chipPointer.chip.classList.add("reading-chip--dragging");
  }

  event.preventDefault();
  positionDragGhost(chipPointer.ghost, event.clientX, event.clientY);
  // Ghost has pointer-events:none (see CSS) specifically so this sees the
  // real drop zone underneath it rather than the ghost itself.
  const el = document.elementFromPoint(event.clientX, event.clientY);
  const zone = el?.closest("[data-dropzone]");
  if (chipPointer.hoverZone && chipPointer.hoverZone !== zone) {
    chipPointer.hoverZone.classList.remove("machine-zone__body--hover");
  }
  if (zone) zone.classList.add("machine-zone__body--hover");
  chipPointer.hoverZone = zone || null;
}

function releaseChipPointer(p) {
  p.chip.removeEventListener("pointermove", handleReadingChipPointerMove);
  p.chip.removeEventListener("pointerup", handleReadingChipPointerUp);
  p.chip.removeEventListener("pointercancel", handleReadingChipPointerCancel);
  try {
    p.chip.releasePointerCapture(p.pointerId);
  } catch {
    // already released (e.g. pointercancel) -- fine to ignore
  }
  p.ghost?.remove();
  p.chip.classList.remove("reading-chip--dragging");
  p.hoverZone?.classList.remove("machine-zone__body--hover");
  chipPointer = null;
}

function handleReadingChipPointerCancel() {
  if (chipPointer) releaseChipPointer(chipPointer);
}

async function handleReadingChipPointerUp() {
  if (!chipPointer) return;
  const p = chipPointer;
  releaseChipPointer(p);

  if (!p.dragging) {
    // Never crossed the drag threshold -- a plain tap, open the editor.
    state.buildingWorldEditingTagId = p.tagId;
    renderApp();
    document.querySelector('#edit-tag-form input[name="system_name"]')?.focus();
    return;
  }

  if (!p.hoverZone) return; // released outside any zone -- treat as cancelled
  const targetGroupId = p.hoverZone.dataset.dropzone;
  if (targetGroupId === p.originGroupId) return; // dropped back where it started

  const tag = state.buildingWorld.tags.find((t) => t.id === p.tagId);
  const previousGroupId = tag?.equipment_group_id ?? null;
  if (tag) tag.equipment_group_id = targetGroupId ? Number(targetGroupId) : null;
  renderApp();
  // A confirming pulse on the zone it landed in -- purely visual, the
  // assignment itself already happened above.
  requestAnimationFrame(() => {
    const landedZone = document.querySelector(`[data-dropzone="${targetGroupId}"]`);
    if (!landedZone) return;
    landedZone.classList.add("machine-zone__body--dropped");
    setTimeout(() => landedZone.classList.remove("machine-zone__body--dropped"), 420);
  });

  try {
    await api.assignTagGroup({ tagId: p.tagId, groupId: targetGroupId || null });
  } catch (error) {
    if (tag) tag.equipment_group_id = previousGroupId;
    renderApp();
  }
}

// One PDF per submitted day, built client-side from the same readings a
// manager sees on screen -- no server-side rendering needed, and it works
// from any browser the moment it's clicked.
async function handleDownloadInspectionPdf(button) {
  const buildingId = Number(button.dataset.buildingId);
  const date = button.dataset.date;
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = "Building PDF…";
  try {
    const detail = await api.inspectionDetail(buildingId, date);
    const doc = new jsPDF({ unit: "pt", format: "letter" });
    const margin = 48;
    let y = margin;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(detail.building.name, margin, y);
    y += 22;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.text(`Daily inspection — ${formatInspectionDate(detail.submission.inspection_date)}`, margin, y);
    y += 16;
    doc.text(`Submitted by ${detail.submission.superintendent_name || "Unknown"} · ${formatTimestamp(detail.submission.submitted_at)}`, margin, y);
    y += 24;

    const groups = groupTagsBySystem(detail.readings.map((r) => ({ ...r, id: `${r.system_name}-${r.tag_no}-${r.reading_type}` })));
    for (const [system, rows] of Object.entries(groups)) {
      if (y > 700) {
        doc.addPage();
        y = margin;
      }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text(system, margin, y);
      y += 16;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      for (const row of rows) {
        if (y > 730) {
          doc.addPage();
          y = margin;
        }
        const label = [row.tag_no, row.reading_type].filter(Boolean).join(" — ");
        const value = row.value ? `${row.value}${row.unit ? ` ${row.unit}` : ""}` : "—";
        const flaggedNote = row.flagged ? "  [flagged]" : "";
        doc.text(`${label}`, margin + 10, y);
        doc.text(`${value}${flaggedNote}`, margin + 320, y);
        y += 15;
      }
      y += 8;
    }

    if (detail.submission.notes) {
      if (y > 680) {
        doc.addPage();
        y = margin;
      }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text("Comments", margin, y);
      y += 16;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      const lines = doc.splitTextToSize(detail.submission.notes, 500);
      doc.text(lines, margin, y);
    }

    doc.save(`${slugify(detail.building.name)}-inspection-${date}.pdf`);
  } catch (error) {
    button.title = error.message;
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

const WORK_ORDER_CATEGORY_LABELS = {
  inventory: "Inventory",
  chemicals: "Chemicals / supplies",
  schedule: "Schedule question",
  method: "Method / procedure question",
  other: "Other",
};

function renderBuildingWorld() {
  const world = state.buildingWorld;
  if (world.loading) {
    return `<section class="card"><p class="empty-state-inline">Loading…</p></section>`;
  }

  const openOrders = world.workOrders.filter((w) => w.status === "open");
  const resolvedOrders = world.workOrders.filter((w) => w.status === "resolved");
  const user = state.session.user;
  const canManageSharing = user.role === "admin" || user.buildingAccess === "all";

  return `
    <section class="building-world">
      <div class="building-world__header">
        <button type="button" class="link-button" id="close-building-world">← All buildings</button>
        <div class="building-world__title">
          ${
            state.buildingWorldRenamingBuilding
              ? `<span class="rename-inline rename-inline--building">
                  <input type="text" id="rename-building-input" value="${escapeHtml(world.building.name)}" maxlength="120" />
                  <button type="button" class="icon-button" id="rename-building-save" title="Save" aria-label="Save building name">${icon("check")}</button>
                  <button type="button" class="icon-button" id="rename-building-cancel" title="Cancel" aria-label="Cancel">${icon("close")}</button>
                </span>`
              : `<span class="building-world__title-row">
                  <h1>${escapeHtml(world.building.name)} ${world.building.status === "registering" ? '<span class="status-chip status-chip--registering">Registering</span>' : ""}</h1>
                  <button type="button" class="icon-button" id="rename-building-start" title="Rename building" aria-label="Rename building">${icon("edit")}</button>
                </span>`
          }
          <p class="quiet-label">${escapeHtml(world.building.address || "No address on file")}</p>
        </div>
        <button type="button" class="button button--outline button--small" id="toggle-building-edit">${icon("edit")} ${state.buildingWorldEditing ? "Cancel edit" : "Edit building"}</button>
      </div>

      ${state.buildingWorldEditing ? renderBuildingWorldEditForm(world.building) : ""}

      <div class="building-world__grid">
        <section class="card">
          <div class="card__header"><div><p class="section-kicker">Notices</p><h2>Posted for whoever's covering this building</h2></div></div>
          <div class="notices-list">
            ${
              world.notices.length
                ? world.notices
                    .map(
                      (n) => `<div class="notice-row">
                <p>${escapeHtml(n.message)}</p>
                <div class="notice-row__meta"><span class="quiet-label">${escapeHtml(n.created_by_name || "Unknown")} · ${formatTimestamp(n.created_at)}</span>
                <button type="button" class="icon-button remove-notice" data-notice-id="${n.id}" title="Remove notice" aria-label="Remove notice">${icon("close")}</button></div>
              </div>`,
                    )
                    .join("")
                : `<p class="quiet-label" style="padding: 4px 22px 18px;">Nothing posted.</p>`
            }
          </div>
          <form id="add-notice-form" class="wizard-panel" style="border-top: 1px solid var(--line);">
            <label class="inspection-field"><span>Post a notice</span><textarea name="message" rows="2" required placeholder="e.g. Elevator contractor Thursday 9am — grant access."></textarea></label>
            <div class="inspection-actions"><button type="submit" class="button button--primary button--small">Post</button></div>
          </form>
        </section>

        <section class="card">
          <div class="card__header"><div><p class="section-kicker">Work orders</p><h2>Open (${openOrders.length})</h2></div></div>
          <div class="buildings-list">
            ${openOrders.length ? openOrders.map(renderBuildingWorldOrder).join("") : `<p class="quiet-label" style="padding: 14px 4px;">Nothing open.</p>`}
          </div>
          ${
            resolvedOrders.length
              ? `<details style="margin: 10px 22px 18px;"><summary>Resolved (${resolvedOrders.length})</summary><div class="buildings-list">${resolvedOrders.map(renderBuildingWorldOrder).join("")}</div></details>`
              : ""
          }
        </section>

        <section class="card">
          <div class="card__header"><div><p class="section-kicker">Coverage</p><h2>Superintendents</h2></div></div>
          <div class="buildings-list">
            ${
              world.superintendents.length
                ? world.superintendents
                    .map(
                      (s) => `<div class="building-row">
                        <div class="building-row__name"><strong>${escapeHtml(s.full_name)}</strong></div>
                        <button type="button" class="button button--outline button--small remove-superintendent" data-user-id="${s.id}">Remove</button>
                      </div>`,
                    )
                    .join("")
                : `<p class="quiet-label" style="padding: 14px 4px;">Nobody assigned yet.</p>`
            }
          </div>
          <form id="assign-superintendent-world-form" class="wizard-panel" style="border-top: 1px solid var(--line);">
            <label class="inspection-field"><span>Assign or move a superintendent here</span>
              <select name="userId" required>
                <option value="" disabled ${!state.buildingWorldAssignableSupers?.length ? "selected" : ""}>${state.buildingWorldAssignableSupers?.length ? "Choose a superintendent" : "None available"}</option>
                ${(state.buildingWorldAssignableSupers || [])
                  .map((s) => `<option value="${s.id}">${escapeHtml(s.full_name)}${s.building_name ? ` — currently at ${escapeHtml(s.building_name)}` : ""}</option>`)
                  .join("")}
              </select>
            </label>
            <div class="inspection-actions"><button type="submit" class="button button--primary button--small" ${!state.buildingWorldAssignableSupers?.length ? "disabled" : ""}>Assign</button></div>
          </form>
        </section>

        ${canManageSharing ? renderBuildingWorldSharing(world) : ""}

        <section class="card">
          <div class="card__header"><div><p class="section-kicker">Recent notes</p><h2>From the daily inspection</h2></div></div>
          <div class="buildings-list">
            ${
              world.recentNotes.length
                ? world.recentNotes
                    .map((n) => `<div class="building-row"><div class="building-row__name"><strong>${escapeHtml(formatInspectionDate(n.inspection_date))}</strong><small>${escapeHtml(n.notes)}</small></div></div>`)
                    .join("")
                : `<p class="quiet-label" style="padding: 14px 4px;">No comments left recently.</p>`
            }
          </div>
        </section>

        <section class="card building-world__checklist">
          <div class="card__header">
            <div><p class="section-kicker">Checklist</p><h2>${world.tags.length} readings</h2></div>
            <form id="add-group-form" class="add-machine-form">
              <input type="text" name="name" placeholder="+ New machine…" maxlength="60" autocomplete="off" />
              <button type="submit" class="button button--outline button--small">Add</button>
            </form>
          </div>
          <div class="location-manager">
            <span class="quiet-label" style="width:100%;">Locations — where each reading physically is, so command mode can walk supers through in order</span>
            ${(world.locations || [])
              .map(
                (l) => `<span class="location-chip">${escapeHtml(l.name)}<button type="button" class="remove-location" data-location-id="${l.id}" title="Delete location" aria-label="Delete location">${icon("close")}</button></span>`,
              )
              .join("")}
            <form id="add-location-form" class="location-add-form">
              <input type="text" name="name" placeholder="+ Add a location…" maxlength="60" autocomplete="off" />
              <button type="submit" class="button button--outline button--small">Add</button>
            </form>
          </div>
          ${renderChecklistBulkBar(world)}
          ${renderMachineBoard(world)}
        </section>

        <section class="card building-world__checklist">
          <div class="card__header"><div><p class="section-kicker">Inspection history</p><h2>Submitted, by week</h2></div></div>
          ${renderInspectionHistory(world.buildingId)}
        </section>
      </div>
    </section>`;
}

// OM/admin only -- an OM can grant a specific ROM full access to a
// building that ROM didn't personally register, at the OM's discretion.
function renderBuildingWorldSharing(world) {
  const shares = state.buildingWorldSharing || [];
  const roms = state.buildingWorldRoms || [];
  const sharedIds = new Set(shares.map((s) => s.user_id));
  const grantable = roms.filter((r) => !sharedIds.has(r.id));
  return `
    <section class="card">
      <div class="card__header"><div><p class="section-kicker">Shared access</p><h2>Area Managers with full access here</h2></div></div>
      <div class="buildings-list">
        ${
          shares.length
            ? shares
                .map(
                  (s) => `<div class="building-row">
                    <div class="building-row__name"><strong>${escapeHtml(s.full_name)}</strong><small>Granted by ${escapeHtml(s.granted_by_name || "Unknown")} · ${formatTimestamp(s.granted_at)}</small></div>
                    <button type="button" class="button button--outline button--small unshare-building" data-user-id="${s.user_id}">Remove</button>
                  </div>`,
                )
                .join("")
            : `<p class="quiet-label" style="padding: 14px 4px;">Only you can manage this building right now.</p>`
        }
      </div>
      <form id="share-building-form" class="wizard-panel" style="border-top: 1px solid var(--line);">
        <label class="inspection-field"><span>Give an Area Manager full access to this building</span>
          <select name="userId" required>
            <option value="" disabled ${!grantable.length ? "selected" : ""}>${grantable.length ? "Choose an Area Manager" : "Nobody left to add"}</option>
            ${grantable.map((r) => `<option value="${r.id}">${escapeHtml(r.full_name)}${r.region ? ` — ${escapeHtml(r.region)}` : ""}</option>`).join("")}
          </select>
        </label>
        <div class="inspection-actions"><button type="submit" class="button button--primary button--small" ${!grantable.length ? "disabled" : ""}>Grant access</button></div>
      </form>
    </section>`;
}

// One section of the checklist card: a real equipment group ("Elevator
// Machine Room") with a bulk "set every reading in here to one location"
// control, or -- for anything nobody's grouped yet -- a plain system-name
// bucket with no bulk control (there's no group to bulk-assign against).
// Appears once a super or manager checks off two or more machines'
// checkboxes -- e.g. Boilers + Domestic Hot Water, both actually sitting
// in MPH -- so they can be tagged to one location together instead of
// working through the per-group select one machine at a time.
function renderChecklistBulkBar(world) {
  const selected = Array.from(state.buildingWorldSelectedGroupIds);
  if (!selected.length) return "";
  const names = selected
    .map((id) => (world.groups || []).find((g) => g.id === id)?.name)
    .filter(Boolean)
    .join(", ");
  return `
    <div class="checklist-bulk-bar">
      <span>${selected.length} machine${selected.length === 1 ? "" : "s"} selected${names ? `: ${escapeHtml(names)}` : ""}</span>
      <select id="checklist-bulk-location">
        <option value="" disabled selected>Set location for all…</option>
        ${(world.locations || []).map((l) => `<option value="${l.id}">${escapeHtml(l.name)}</option>`).join("")}
      </select>
      <button type="button" class="button button--primary button--small" id="checklist-bulk-apply">Apply</button>
      <button type="button" class="button button--outline button--small" id="checklist-bulk-clear">Clear</button>
    </div>`;
}

// ---------------------------------------------------------------------
// The checklist card, merged into one interface: every reading grouped
// into a gray "machine" zone (equipment group), dragged between them to
// regroup, alongside everything a manager actually needs per machine --
// today's photo status, a bulk "set location for all" select, its most
// recent group note, and per-reading location. This used to be two
// separate cards (a plain grouped list, and a separate drag board below
// it) -- merged into one so there's a single place to manage all of it,
// not two showing the same data two different ways.
// ---------------------------------------------------------------------

function renderMachineBoard(world) {
  const tags = world.tags || [];
  const groups = world.groups || [];
  const ungrouped = tags.filter((t) => !t.equipment_group_id);
  return `
    <p class="parameters-intro">Press and drag a reading onto a machine to group it — any machine with readings needs a timestamped photo before the day can be submitted. A quick tap edits it instead.</p>
    <div class="machine-board">
      <div class="machine-zone machine-zone--ungrouped">
        <div class="machine-zone__header">
          <h4>Ungrouped readings<span class="quiet-label"> · ${ungrouped.length}</span></h4>
          <span class="quiet-label">No photo required</span>
        </div>
        <div class="machine-zone__body" data-dropzone="">
          ${
            ungrouped.length
              ? ungrouped.map((t) => renderReadingChip(t, world)).join("")
              : `<p class="machine-zone__empty">Nothing ungrouped.</p>`
          }
        </div>
      </div>
      ${groups.map((g) => renderMachineZone(g, tags, world)).join("")}
    </div>`;
}

function renderMachineZone(group, tags, world) {
  const groupTags = tags.filter((t) => t.equipment_group_id === group.id);
  const isRenaming = state.buildingWorldRenamingGroupId === group.id;
  const isSelected = state.buildingWorldSelectedGroupIds.has(group.id);
  const recentNote = (world.groupNotes || []).find((n) => n.equipment_group_id === group.id);
  const todayPhoto = (world.todayGroupPhotos || []).find((p) => p.equipment_group_id === group.id);
  return `
    <div class="machine-zone" data-group-id="${group.id}">
      <div class="machine-zone__header">
        <input type="checkbox" class="checklist-group-select" data-group-id="${group.id}" title="Select ${escapeHtml(group.name)} for a bulk action" ${isSelected ? "checked" : ""} />
        ${
          isRenaming
            ? `<span class="rename-inline">
                <input type="text" class="rename-group-input" value="${escapeHtml(group.name)}" maxlength="60" />
                <button type="button" class="icon-button rename-group-save" data-group-id="${group.id}" title="Save" aria-label="Save name">${icon("check")}</button>
                <button type="button" class="icon-button rename-group-cancel" title="Cancel" aria-label="Cancel">${icon("close")}</button>
              </span>`
            : `<h4>${escapeHtml(group.name)}<span class="quiet-label"> · ${groupTags.length}</span></h4>
               <button type="button" class="icon-button rename-group-start" data-group-id="${group.id}" title="Rename ${escapeHtml(group.name)}" aria-label="Rename ${escapeHtml(group.name)}">${icon("edit")}</button>
               <button type="button" class="icon-button remove-group" data-group-id="${group.id}" title="Delete machine" aria-label="Delete ${escapeHtml(group.name)}">${icon("close")}</button>`
        }
      </div>
      <div class="machine-zone__meta">
        <span class="machine-photo-badge ${todayPhoto ? "machine-photo-badge--done" : "machine-photo-badge--missing"}" title="${todayPhoto ? `Photographed ${escapeHtml(formatTimestamp(todayPhoto.captured_at))}` : "No photo yet today"}">${todayPhoto ? icon("check") : icon("camera")} ${todayPhoto ? "Photo taken today" : "No photo today"}</span>
        <select class="assign-group-location" data-group-id="${group.id}">
          <option value="">Set location for all…</option>
          ${(world.locations || []).map((l) => `<option value="${l.id}">${escapeHtml(l.name)}</option>`).join("")}
        </select>
      </div>
      ${
        recentNote
          ? `<p class="checklist-section__note">${icon("edit")} <strong>${escapeHtml(formatInspectionDate(recentNote.inspection_date))}:</strong> ${escapeHtml(recentNote.note)}</p>`
          : ""
      }
      <div class="machine-zone__body" data-dropzone="${group.id}">
        ${
          groupTags.length
            ? groupTags.map((t) => renderReadingChip(t, world)).join("")
            : `<p class="machine-zone__empty">Drag a reading here</p>`
        }
      </div>
    </div>`;
}

function renderReadingChip(tag, world) {
  if (state.buildingWorldEditingTagId === tag.id) return renderReadingChipEditForm(tag);
  const label = [tag.tag_no, tag.reading_type].filter(Boolean).join(" — ") || tag.system_name;
  // The whole chip is the drag surface now, not just a small grip corner
  // -- press anywhere and hold-drag to move it, a plain tap opens the
  // editor. See handleReadingChipPointerDown's movement-threshold logic
  // (it explicitly ignores the location <select> below so that still
  // opens normally instead of starting a drag).
  return `
    <div class="reading-chip" data-tag-id="${tag.id}" tabindex="0" role="button" aria-label="${escapeHtml(label)} — drag to move, tap to edit">
      <span class="reading-chip__grip" aria-hidden="true">⠿</span>
      <span class="reading-chip__label">${escapeHtml(label)}</span>
      <select class="assign-tag-location reading-chip__location" data-tag-id="${tag.id}" title="Where this reading physically is">
        <option value="">No location</option>
        ${(world?.locations || []).map((l) => `<option value="${l.id}" ${tag.location_id === l.id ? "selected" : ""}>${escapeHtml(l.name)}</option>`).join("")}
      </select>
    </div>`;
}

function renderReadingChipEditForm(tag) {
  return `
    <form class="reading-chip reading-chip--editing" id="edit-tag-form" data-tag-id="${tag.id}">
      <input type="text" name="system_name" value="${escapeHtml(tag.system_name)}" placeholder="System" required />
      <input type="text" name="tag_no" value="${escapeHtml(tag.tag_no || "")}" placeholder="Tag no. (optional)" />
      <input type="text" name="reading_type" value="${escapeHtml(tag.reading_type)}" placeholder="Reading" required />
      <input type="text" name="unit" value="${escapeHtml(tag.unit || "")}" placeholder="Unit (optional)" />
      <select name="value_type">
        <option value="numeric" ${!CLOSED_CHOICE_TYPES[tag.value_type] ? "selected" : ""}>Numeric</option>
        ${Object.entries(CLOSED_CHOICE_TYPES)
          .map(([value, { label }]) => `<option value="${value}" ${tag.value_type === value ? "selected" : ""}>${escapeHtml(label)}</option>`)
          .join("")}
      </select>
      <div class="reading-chip__edit-actions">
        <button type="submit" class="icon-button" title="Save" aria-label="Save reading">${icon("check")}</button>
        <button type="button" class="icon-button cancel-edit-tag" title="Cancel" aria-label="Cancel">${icon("close")}</button>
      </div>
      <p class="form-error" id="edit-tag-error" hidden role="alert"></p>
    </form>`;
}

// ISO week (Monday-start) so "week of the 25th" groups the way a super
// actually thinks about their schedule, not a Sunday-start calendar week.
function isoWeekInfo(isoDate) {
  const date = new Date(`${isoDate}T00:00:00`);
  const day = (date.getDay() + 6) % 7; // Mon=0 .. Sun=6
  const monday = new Date(date);
  monday.setDate(date.getDate() - day);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  const key = monday.toISOString().slice(0, 10);
  const label = `Week of ${monday.toLocaleDateString(undefined, { month: "long", day: "numeric" })} – ${friday.toLocaleDateString(undefined, { month: "long", day: "numeric" })}`;
  return { key, label };
}

function renderInspectionHistory(buildingId) {
  const submissions = state.buildingWorldHistory;
  if (submissions == null) return `<p class="empty-state-inline" style="padding: 18px 22px;">Loading…</p>`;
  if (!submissions.length) return `<p class="quiet-label" style="padding: 4px 22px 18px;">No submitted inspections yet.</p>`;

  const weeks = {};
  for (const s of submissions) {
    const { key, label } = isoWeekInfo(s.inspection_date);
    if (!weeks[key]) weeks[key] = { label, items: [] };
    weeks[key].items.push(s);
  }
  const orderedKeys = Object.keys(weeks).sort().reverse();

  return orderedKeys
    .map(
      (key, index) => `
        <details class="history-week" ${index === 0 ? "open" : ""}>
          <summary>${escapeHtml(weeks[key].label)}<span class="quiet-label">${weeks[key].items.length} day${weeks[key].items.length === 1 ? "" : "s"}</span></summary>
          ${weeks[key].items
            .map(
              (s) => `<div class="history-day">
                <span><strong>${escapeHtml(formatInspectionDate(s.inspection_date))}</strong> <span class="quiet-label">· ${escapeHtml(s.superintendent_name || "Unknown")} · ${s.reading_count} reading${s.reading_count === 1 ? "" : "s"}</span></span>
                <button type="button" class="button button--outline button--small download-inspection-pdf" data-building-id="${buildingId}" data-date="${s.inspection_date}">${icon("check")} Download PDF</button>
              </div>`,
            )
            .join("")}
        </details>`,
    )
    .join("");
}

function renderBuildingWorldOrder(order) {
  const tone = order.source === "reading" ? "danger" : "warning";
  return `<div class="building-row work-order-row">
    <div class="building-row__name">
      <strong><span class="urgency-dot urgency-dot--${tone}"></span> ${escapeHtml(order.title)}</strong>
      <small>${escapeHtml(order.description || "")}</small>
      <small class="quiet-label">${escapeHtml(order.reported_by || "Unknown")} · ${formatTimestamp(order.created_at)}${order.assigned_to_name ? ` · Assigned to ${escapeHtml(order.assigned_to_name)}` : ""}</small>
    </div>
    ${
      order.status === "open"
        ? `<div class="inspection-actions">
            <select class="assign-work-order-select" data-work-order-id="${order.id}">
              <option value="">Assign to…</option>
              ${state.buildingWorldAssignableUsers.map((u) => `<option value="${u.id}" ${order.assigned_to === u.id ? "selected" : ""}>${escapeHtml(u.full_name)} — ${escapeHtml(u.job_title)}</option>`).join("")}
            </select>
            <button type="button" class="button button--outline button--small resolve-work-order-world" data-work-order-id="${order.id}">Resolve</button>
          </div>`
        : `<span class="quiet-label">Resolved ${formatTimestamp(order.resolved_at)}</span>`
    }
  </div>`;
}

function renderBuildingWorldEditForm(building) {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const currentDays = (building.inspection_days || "").split(",");
  return `
    <form id="building-world-edit-form" class="card wizard-panel">
      <h3>Edit building details</h3>
      <label class="inspection-field"><span>Building name</span><input name="name" value="${escapeHtml(building.name)}" required /></label>
      <label class="inspection-field"><span>Address</span><input name="address" id="building-address-input" value="${escapeHtml(building.address || "")}" autocomplete="off" /></label>
      <label class="inspection-field"><span>Region <small>(your own label — a neighborhood, portfolio name, whatever makes sense to you)</small></span><input name="region" value="${escapeHtml(building.region || "")}" placeholder="e.g. North York" autocomplete="off" /></label>
      <div class="map-picker">
        <div class="map-search-results" id="map-search-results"></div>
        <div class="map-picker__canvas" id="building-map" ${building.latitude ? "" : "hidden"}></div>
        <div class="map-save-bar" id="map-save-bar" ${building.latitude ? "" : "hidden"}>
          <span>${icon("check")} <strong id="map-save-bar-address">Current pinned location</strong></span>
        </div>
        <p class="map-picker__hint" id="map-picker-hint">Type a new address to move the pin, or drag it directly.</p>
        <input type="hidden" name="latitude" id="building-latitude" value="${building.latitude ?? ""}" />
        <input type="hidden" name="longitude" id="building-longitude" value="${building.longitude ?? ""}" />
      </div>
      <div class="inspection-field"><span>Inspection days</span>
        <div class="day-checkboxes">
          ${days.map((day) => `<label class="day-checkbox"><input type="checkbox" name="days" value="${day}" ${currentDays.includes(day) ? "checked" : ""} />${day}</label>`).join("")}
        </div>
      </div>
      <div class="inspection-actions">
        <button type="button" class="button button--outline" id="cancel-building-world-edit">Cancel</button>
        <button type="submit" class="button button--primary">Save changes</button>
      </div>
      <p class="form-error" id="building-world-edit-error" hidden role="alert"></p>
    </form>`;
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
        ${renderUsageBar(usage.r2)}
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
  // Grouped the same way the manager's checklist card is (by equipment
  // group, falling back to system name) so the group a super sees here
  // lines up with the group they can leave a note against below.
  const sections = groupTagsForChecklist(data.tags);
  const groupNotes = data.groupNotes || {};
  const groupPhotos = data.groupPhotos || {};

  return `
    <section class="card inspection-card" aria-labelledby="inspection-title">
      <div class="card__header">
        <div>
          <p class="section-kicker">${escapeHtml(data.building.name)} · Daily Inspection</p>
          <h2 id="inspection-title">${escapeHtml(formatInspectionDate(data.date))}</h2>
        </div>
        <div class="inspection-card__header-actions">
          ${
            !locked && data.tags.length
              ? `<button type="button" class="button button--primary button--small" id="start-command-mode">${icon("camera")} Command mode</button>`
              : ""
          }
          ${renderInspectionStatusBadge(data)}
        </div>
      </div>
      <form id="inspection-form" class="inspection-form">
        ${sections
          .map((section) => renderInspectionGroup(section, data.readings, locked, data.flags, groupNotes, groupPhotos))
          .join("")}
        <label class="inspection-notes">
          <span>Comments</span>
          <textarea name="notes" rows="3" ${locked ? "disabled" : ""} placeholder="Anything the next shift should know…">${escapeHtml(data.notes || "")}</textarea>
        </label>
        ${
          locked
            ? `<p class="inspection-locked-note">${icon("check")} Submitted ${formatTimestamp(data.submittedAt)} — this inspection is locked. Contact your area manager if it needs to be reopened.</p>`
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
                ? lib.photos
                    .map((p) =>
                      p.key.toLowerCase().endsWith(".pdf")
                        ? `<a href="${api.photoViewUrl(p.key)}" target="_blank" rel="noopener" class="photo-library__thumb photo-library__thumb--file">${icon("file")}<span>PDF · ${escapeHtml(formatTimestamp(p.uploadedAt))}</span></a>`
                        : `<a href="${api.photoViewUrl(p.key)}" target="_blank" rel="noopener" class="photo-library__thumb"><img src="${api.photoViewUrl(p.key)}" alt="" loading="lazy" /><span>${escapeHtml(formatTimestamp(p.uploadedAt))}</span></a>`,
                    )
                    .join("")
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

// AI photo reading is manual-entry-only for everyone right now except the
// beta tester (see worker/admin-accounts.js's CLASSIFICATIONS and the
// admin accounts panel that sets this per account).
function aiPhotoEnabled() {
  return state.session?.user?.classification === "beta_tester";
}

function renderInspectionGroup(section, readings, locked, flags = {}, groupNotes = {}, groupPhotos = {}) {
  const { groupId, name, tags } = section;
  const photoInputId = `photo-${slugify(name)}`;
  const note = groupId ? groupNotes[groupId] || "" : "";
  const proof = groupId ? groupPhotos[groupId] : null;
  return `
    <fieldset class="inspection-group">
      <legend>${escapeHtml(name)}</legend>
      ${
        locked || !aiPhotoEnabled()
          ? ""
          : `<div class="photo-capture">
              <label class="button button--outline button--small photo-capture__button" for="${photoInputId}">
                ${icon("camera")} Use a photo for this section
              </label>
              <input type="file" accept="image/*" capture="environment" id="${photoInputId}" data-photo-group="${escapeHtml(name)}" hidden />
              <span class="photo-capture__status" data-photo-status="${escapeHtml(name)}"></span>
            </div>`
      }
      <div class="inspection-grid">
        ${tags.map((tag) => renderInspectionField(tag, readings[tag.id], locked, flags[tag.id])).join("")}
      </div>
      ${
        groupId
          ? `<label class="inspection-group__note">
              <span>${icon("edit")} Note for ${escapeHtml(name)} today</span>
              <textarea data-group-note-id="${groupId}" rows="2" ${locked ? "disabled" : ""} placeholder="Anything worth flagging for this group today — leave blank if nothing to report.">${escapeHtml(note)}</textarea>
            </label>
            ${renderMachinePhotoBlock(groupId, name, proof, locked)}`
          : ""
      }
    </fieldset>`;
}

// The mandatory, timestamped "this machine was actually checked today"
// photo -- required for every equipment group before the whole day can
// be submitted (see missingGroupPhotoNames() and worker/inspections.js's
// matching submit-time check). Separate from the optional AI-reading
// photo-capture block above, which is beta-tester-only and costs a
// Gemini call; this one is a plain upload, free to retake.
function renderMachinePhotoBlock(groupId, name, proof, locked) {
  const inputId = `machine-photo-${groupId}`;
  return `
    <div class="machine-photo ${proof ? "machine-photo--done" : "machine-photo--required"}" data-machine-photo-group="${groupId}">
      <p class="machine-photo__status">
        ${
          proof
            ? `${icon("check")} Photo taken ${escapeHtml(formatTimestamp(proof.capturedAt))}${proof.latitude != null ? " · location tagged" : ""}`
            : `${icon("warning")} Required before submitting: a timestamped photo of ${escapeHtml(name)}`
        }
      </p>
      ${
        locked
          ? ""
          : `<label class="button button--outline button--small" for="${inputId}">${proof ? "Retake photo" : "Take photo"}</label>
             <input type="file" accept="image/*" capture="environment" id="${inputId}" data-machine-photo-id="${groupId}" hidden />`
      }
    </div>`;
}

function renderInspectionField(tag, value, locked, flagged) {
  const label = [tag.tag_no, tag.reading_type].filter(Boolean).join(" — ");
  const fieldId = `tag-input-${tag.id}`;
  return `
    <label class="inspection-field ${flagged ? "inspection-field--flagged" : ""}" data-field-tag-id="${tag.id}" for="${fieldId}">
      <span>${escapeHtml(label)}${tag.unit ? ` <small>(${escapeHtml(tag.unit)})</small>` : ""} ${flagged ? `<small class="inspection-field__flag-note">🚩 flagged in command mode</small>` : ""}</span>
      <span class="inspection-field__row">
        <input
          type="text"
          id="${fieldId}"
          name="tag-${tag.id}"
          data-tag-id="${tag.id}"
          value="${escapeHtml(value ?? "")}"
          ${locked ? "disabled" : ""}
          autocomplete="off"
        />
        ${
          locked || !aiPhotoEnabled()
            ? ""
            : `<label class="icon-button inspection-field__photo-button" for="single-photo-${tag.id}" title="Attach a photo for this reading">${icon("camera")}</label>
               <input type="file" accept="image/*" capture="environment" id="single-photo-${tag.id}" data-single-photo-tag-id="${tag.id}" hidden />`
        }
      </span>
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

// FileReader's native readAsDataURL does this encoding in the browser's
// own C++ code rather than materializing a full JS string one byte-chunk
// at a time and concatenating it (the old approach here) -- on a phone,
// repeated large-photo conversions the manual way were very likely the
// real cause of "low memory, can't upload another photo" after just one
// or two captures in a row. This is a drop-in replacement: same
// signature, same base64-payload-only return value.
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result || "";
      const comma = result.indexOf(",");
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.onerror = () => reject(reader.error || new Error("Couldn't read that photo. Try again."));
    reader.readAsDataURL(file);
  });
}

// iPhones (and some Samsung/Android phones) save camera-roll photos as
// HEIC/HEIF by default. Safari can sometimes decode that straight into a
// canvas; Chrome and Firefox on any platform can't -- createImageBitmap
// just fails silently there. Convert to JPEG first with a WASM decoder
// bundled specifically for this, so "upload from device" works no matter
// what phone or browser took the photo. The live camera capture path
// ("take picture") almost always already hands back a JPEG regardless of
// phone, so this mostly matters for picking an existing photo.
function looksLikeHeic(file) {
  const type = (file.type || "").toLowerCase();
  const name = (file.name || "").toLowerCase();
  return type.includes("heic") || type.includes("heif") || name.endsWith(".heic") || name.endsWith(".heif");
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function normalizeToDecodableImage(file) {
  if (!looksLikeHeic(file)) return file;
  try {
    // Dynamically imported -- it bundles a ~500KB WASM HEIC decoder, no
    // reason to make every visitor download that just to load the app
    // when most photos (especially anything from the live camera capture)
    // never need it. Wrapped in a hard timeout: this decoder runs in its
    // own Web Worker and was observed, during testing, to occasionally
    // never resolve or reject at all (no error, no timeout of its own) --
    // rare, but a photo upload must never be able to hang the UI forever
    // because of it.
    const conversion = (async () => {
      const { default: heic2any } = await import("heic2any");
      const result = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
      return Array.isArray(result) ? result[0] : result;
    })();
    return await withTimeout(conversion, 20_000, "HEIC conversion timed out.");
  } catch (error) {
    console.error("HEIC conversion failed", error);
    const err = new Error(
      "Couldn't read that photo (HEIC/HEIF conversion failed or timed out). Try again, take a new photo with the camera instead, or switch your phone's camera format to \"Most Compatible\" (JPEG) in Settings.",
    );
    err.heicConversionFailed = true;
    throw err;
  }
}

// A modern phone's camera photo (often 12-48MP, 4-15MB) base64-inflates
// well past what the AI endpoints accept and takes noticeably longer to
// upload and process to boot. Gemini doesn't need pixel-for-pixel detail
// to read a gauge or a label -- downscale + re-encode as JPEG client-side
// before every photo upload. Falls back to the raw file if this browser
// can't decode it for some other reason, so a photo can never silently
// fail to send because of this step (HEIC/HEIF is the one format that's
// truly unrecoverable if the WASM decoder itself fails, since the server
// doesn't accept that media type either).
async function compressImageFile(file, { maxDimension = 1600, quality = 0.82 } = {}) {
  const sourceFile = await normalizeToDecodableImage(file);
  try {
    const bitmap = await createImageBitmap(sourceFile);
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    // Explicitly drop the canvas's backing store rather than waiting on
    // GC -- WebKit/Safari in particular holds onto canvas memory longer
    // than you'd expect otherwise, and command mode can run through many
    // photos in one sitting without a page reload in between.
    canvas.width = 0;
    canvas.height = 0;
    if (!blob) throw new Error("Canvas produced no image data.");
    return { base64: await fileToBase64(blob), mediaType: "image/jpeg" };
  } catch (error) {
    if (sourceFile !== file) {
      // Already converted out of HEIC into a real JPEG blob -- send that
      // as-is rather than the original (server-rejected) HEIC bytes.
      return { base64: await fileToBase64(sourceFile), mediaType: "image/jpeg" };
    }
    return { base64: await fileToBase64(file), mediaType: file.type || "image/jpeg" };
  }
}

// Best-effort, short-timeout location fix -- never blocks the photo on
// it. Free (a browser API, not a paid one), so unlike Gemini calls there's
// no cost reason to hold back; it just quietly omits itself if the
// device/browser won't grant it in time.
//
// The browser only ever actually prompts for location permission once
// per site (it remembers "Allow"/"Block" after that) -- but calling
// getCurrentPosition fresh on every single photo still shows a location
// indicator each time and costs a moment waiting on a GPS fix. Since a
// building doesn't move mid-inspection, the first successful fix for
// this session is cached and reused for every later photo instead.
let cachedGeolocation = null;
function getGeolocation(timeoutMs = 4000) {
  if (cachedGeolocation) return Promise.resolve(cachedGeolocation);
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        cachedGeolocation = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        resolve(cachedGeolocation);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}

function formatCoords(latitude, longitude) {
  const lat = `${Math.abs(latitude).toFixed(5)}°${latitude >= 0 ? "N" : "S"}`;
  const lon = `${Math.abs(longitude).toFixed(5)}°${longitude >= 0 ? "E" : "W"}`;
  return `${lat}, ${lon}`;
}

// The mandatory "proof this machine was actually checked today" photo --
// burns a visible timestamp (and geolocation, if granted) directly into
// the image's pixels client-side before it's ever uploaded, specifically
// so it can't be a photo from a previous day. Deliberately a separate,
// plain-upload path from compressImageFile's -- this never goes through
// Gemini, so retaking it costs nothing.
async function captureComplianceProof(file) {
  const geo = await getGeolocation();
  const sourceFile = await normalizeToDecodableImage(file);
  const bitmap = await createImageBitmap(sourceFile);
  const maxDimension = 1600;
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const capturedAt = new Date();
  const stampLine1 = `${capturedAt.toLocaleString("en-US", { timeZone: "America/Toronto", dateStyle: "medium", timeStyle: "short" })} ET`;
  const stampLine2 = geo ? formatCoords(geo.latitude, geo.longitude) : null;
  const barHeight = stampLine2 ? 52 : 32;

  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.fillRect(0, height - barHeight, width, barHeight);
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#ffffff";
  ctx.font = "600 15px Arial, sans-serif";
  ctx.fillText(stampLine1, 12, height - (stampLine2 ? 30 : 11));
  if (stampLine2) {
    ctx.font = "500 13px Arial, sans-serif";
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    ctx.fillText(stampLine2, 12, height - 11);
  }

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) throw new Error("Couldn't process that photo. Try again.");
  return {
    imageBase64: await fileToBase64(blob),
    mediaType: "image/jpeg",
    capturedAt: capturedAt.toISOString(),
    latitude: geo?.latitude ?? null,
    longitude: geo?.longitude ?? null,
  };
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
    const { base64: imageBase64, mediaType } = await compressImageFile(file);
    const response = await api.inspectionPhoto({ tagIds, imageBase64, mediaType });
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

// The per-field camera icon on the regular (non-command-mode) grid — same
// underlying multi-tag endpoint, just called with a single tag.
async function handleSinglePhotoCapture(event) {
  const input = event.currentTarget;
  const file = input.files?.[0];
  if (!file) return;
  const tagId = Number(input.dataset.singlePhotoTagId);
  const field = document.querySelector(`[data-field-tag-id="${tagId}"]`);
  const fieldInput = field?.querySelector("input");
  const photoButton = field?.querySelector(".inspection-field__photo-button");
  if (photoButton) photoButton.classList.add("inspection-field__photo-button--busy");
  try {
    const { base64: imageBase64, mediaType } = await compressImageFile(file);
    const response = await api.inspectionPhoto({ tagIds: [tagId], imageBase64, mediaType });
    const result = response.results?.[0];
    if (result && result.value != null && !result.unclear && fieldInput) {
      fieldInput.value = result.value;
      field.classList.add("inspection-field--filled");
    } else if (fieldInput) {
      field.classList.add("inspection-field--unclear");
    }
  } catch (error) {
    if (field) field.title = error.message;
  } finally {
    if (photoButton) photoButton.classList.remove("inspection-field__photo-button--busy");
    input.value = "";
  }
}

async function handleMachinePhotoCapture(groupId, file) {
  const block = document.querySelector(`[data-machine-photo-group="${groupId}"]`);
  const statusEl = block?.querySelector(".machine-photo__status");
  const originalStatus = statusEl?.innerHTML;
  if (statusEl) statusEl.innerHTML = `${icon("clock")} Stamping and uploading…`;
  try {
    const proof = await captureComplianceProof(file);
    const result = await api.groupPhotoUpload({ groupId, ...proof });
    state.inspection.groupPhotos = {
      ...(state.inspection.groupPhotos || {}),
      [groupId]: { capturedAt: result.capturedAt, latitude: result.latitude, longitude: result.longitude },
    };
    const error = document.querySelector("#inspection-error");
    if (error && !missingGroupPhotoNames().length) error.hidden = true;
    renderApp();
  } catch (error) {
    if (statusEl) statusEl.innerHTML = originalStatus;
    const errorEl = document.querySelector("#inspection-error");
    if (errorEl) {
      errorEl.textContent = error.message;
      errorEl.hidden = false;
    }
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

// The manager-defined equipment group is the more meaningful way to
// organize a checklist than the AI-guessed system_name from the original
// paper sheet -- "Elevator Machine Room" tells a super where to stand;
// "Building Heating" is just a category. Anything without a group yet
// falls back to system_name so it's still organized, not dumped in one
// flat bucket, and naturally clears out as a manager assigns groups.
function groupTagsForChecklist(tags) {
  const sections = [];
  const byGroupId = new Map();
  for (const tag of tags) {
    if (!tag.equipment_group_id) continue;
    if (!byGroupId.has(tag.equipment_group_id)) {
      const entry = { groupId: tag.equipment_group_id, name: tag.equipment_group_name, tags: [] };
      byGroupId.set(tag.equipment_group_id, entry);
      sections.push(entry);
    }
    byGroupId.get(tag.equipment_group_id).tags.push(tag);
  }
  const bySystem = new Map();
  for (const tag of tags) {
    if (tag.equipment_group_id) continue;
    if (!bySystem.has(tag.system_name)) {
      const entry = { groupId: null, name: tag.system_name, tags: [] };
      bySystem.set(tag.system_name, entry);
      sections.push(entry);
    }
    bySystem.get(tag.system_name).tags.push(tag);
  }
  return sections;
}

function formatInspectionDate(isoDate) {
  const date = new Date(`${isoDate}T00:00:00`);
  return date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

function formatTimestamp(isoValue) {
  if (!isoValue) return "";
  // Every timestamp column in this app (submitted_at, created_at, etc.)
  // is SQLite's CURRENT_TIMESTAMP -- real UTC, but formatted as
  // "YYYY-MM-DD HH:MM:SS" with no "Z" or offset. Browsers parse that
  // exact shape as LOCAL time instead of UTC, which was the real bug
  // behind submissions showing hours off (a 2pm Toronto submit reading
  // back as ~6pm -- exactly the UTC-4 gap, read as if it were already
  // Toronto time). Normalize to a real UTC instant before parsing, then
  // always render in Toronto time regardless of the viewer's own device
  // timezone, matching every other "today" boundary in this app.
  const normalized = /[TZ]/.test(isoValue) ? isoValue : `${isoValue.replace(" ", "T")}Z`;
  const formatted = new Date(normalized).toLocaleString("en-US", {
    timeZone: "America/Toronto",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${formatted} ET`;
}

function collectInspectionForm(form) {
  const readings = {};
  form.querySelectorAll("[data-tag-id]").forEach((input) => {
    readings[input.dataset.tagId] = input.value;
  });
  const groupNotes = {};
  form.querySelectorAll("[data-group-note-id]").forEach((textarea) => {
    groupNotes[textarea.dataset.groupNoteId] = textarea.value;
  });
  return { notes: form.querySelector('[name="notes"]').value, readings, groupNotes };
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

  if (CLOSED_CHOICE_TYPES[tag.value_type]) {
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

// ---------------------------------------------------------------------
// Command mode -- a guided, one-reading-at-a-time walkthrough. Ordered by
// physical location (so a super doesn't backtrack between floors), with
// camera / upload / manual entry per item, AI label verification on
// photos, and a normal-vs-abnormal check against both the manager's set
// parameters and this tag's recent history -- all reusing the same
// inspection_readings the regular grid form writes to, just through a
// different UI.
// ---------------------------------------------------------------------

// A pure statistical threshold (2 std-devs, or 15% of the average) let
// real problems slide by whenever a gauge's own history happened to be
// very steady: a boiler that's sat flat at 50° all week has ~0 stdev, so
// the 15%-of-average rule alone allowed a 7.5° swing before flagging --
// a real 3° drift wouldn't have tripped it. Lucas's real-world read: a
// temperature reading should flag past roughly a 3° drift, a PSI
// reading past roughly 5 PSI, no matter how flat that gauge's history
// has been. This caps the statistical threshold at that absolute amount
// for temperature/PSI tags; everything else still falls back to the
// plain statistical rule (no real-world number to ground a tighter cap
// on for RPM/Hz/Kw/Amps/etc.). Matched loosely since the unit string
// comes from free-form AI extraction off a paper sheet (worker/
// buildings.js's handleGenerateTags) and isn't perfectly consistent --
// "°", "F", "deg F" should all read as temperature the same way.
function unitTolerance(unit) {
  const normalized = (unit || "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "°" || normalized.includes("deg") || /^°?[cf]$/.test(normalized)) return 3;
  if (normalized === "psi") return 5;
  return null;
}

// Same trend check the backend used to decide whether history data was
// even worth attaching (see worker/inspections.js loadHistory) -- this is
// the client-side half: does THIS value look like an outlier against it.
function historyFlagFor(tag, rawValue) {
  const h = tag.history;
  if (!h || CLOSED_CHOICE_TYPES[tag.value_type] || rawValue == null || rawValue === "") return null;
  const num = Number.parseFloat(rawValue);
  if (Number.isNaN(num)) return null;
  const statisticalThreshold = Math.max(h.stdev * 2, Math.abs(h.avg) * 0.15, 1);
  const cap = unitTolerance(tag.unit);
  const threshold = cap != null ? Math.min(cap, statisticalThreshold) : statisticalThreshold;
  // >= , not > -- "50 vs 53" (exactly a 3° gap) is Lucas's own example of
  // something that should flag, and readings in this domain are usually
  // whole numbers, so a strict > would silently let the boundary case
  // through.
  return Math.abs(num - h.avg) >= threshold;
}

function startCommandMode() {
  const tags = state.inspection?.tags || [];
  if (!tags.length) return;
  const order = [...tags]
    .sort((a, b) => {
      const la = a.location_sort_order ?? Number.MAX_SAFE_INTEGER;
      const lb = b.location_sort_order ?? Number.MAX_SAFE_INTEGER;
      if (la !== lb) return la - lb;
      return a.sort_order - b.sort_order;
    })
    .map((t) => t.id);

  const readings = { ...(state.inspection.readings || {}) };
  const flags = { ...(state.inspection.flags || {}) };
  const photoKeys = { ...(state.inspection.photoKeys || {}) };
  const groupPhotos = { ...(state.inspection.groupPhotos || {}) };
  const resumeIndex = order.findIndex((id) => !readings[id] && !flags[id]);

  state.commandMode = {
    active: true,
    order,
    index: resumeIndex === -1 ? 0 : resumeIndex,
    readings,
    flags,
    photoKeys,
    groupPhotos,
    pendingGroupPhoto: null,
    groupPhotoUploading: false,
    entryMode: "choose",
    manualDraft: "",
    tempUnit: "C",
    scanResult: null,
    abnormalPrompt: null,
    reviewFlags: false,
    reviewingSingleFlag: false,
    saving: false,
    error: "",
  };
  renderApp();
}

function exitCommandMode() {
  state.commandMode = null;
  renderApp();
}

// A full reset of today's inspection -- every value, flag, and photo
// reference wiped back to blank. Reuses the regular save endpoint rather
// than a dedicated "clear" API: upsertDraft only ever touches a column
// for a tag it's explicitly told about (see worker/inspections.js), so
// sending every tag with an empty value / false flag / null photo forces
// exactly that, without needing new backend surface.
async function handleConfirmClearAll() {
  const modal = document.querySelector("#clear-all-modal");
  const button = modal?.querySelector("#confirm-clear-all");
  if (button) {
    button.disabled = true;
    button.textContent = "Clearing…";
  }
  try {
    const allTagIds = state.inspection.tags.map((t) => t.id);
    const readings = Object.fromEntries(allTagIds.map((id) => [id, ""]));
    const flags = Object.fromEntries(allTagIds.map((id) => [id, false]));
    const photoKeys = Object.fromEntries(allTagIds.map((id) => [id, null]));
    const data = await api.inspectionSave({ notes: state.inspection.notes, readings, flags, photoKeys });

    state.inspection.readings = data.readings;
    state.inspection.flags = data.flags;
    state.inspection.photoKeys = data.photoKeys;
    state.confirmedAbnormalTagIds = [];

    const cm = state.commandMode;
    if (cm) {
      cm.readings = {};
      cm.flags = {};
      cm.photoKeys = {};
      cm.index = 0;
      cm.entryMode = "choose";
      cm.scanResult = null;
      cm.abnormalPrompt = null;
      cm.reviewFlags = false;
      cm.reviewingSingleFlag = false;
      cm.error = "";
    }
    modal?.remove();
    renderApp();
  } catch (error) {
    const modalError = modal?.querySelector("#clear-all-error");
    if (modalError) {
      modalError.textContent = error.message;
      modalError.hidden = false;
    }
    if (button) {
      button.disabled = false;
      button.textContent = "Yes, clear everything";
    }
  }
}

function renderClearAllConfirmModal() {
  const existing = document.querySelector("#clear-all-modal");
  if (existing) existing.remove();

  const wrap = document.createElement("div");
  wrap.id = "clear-all-modal";
  wrap.className = "modal-overlay";
  wrap.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="clear-all-title">
      <h3 id="clear-all-title">${icon("warning")} Clear everything?</h3>
      <p class="parameters-intro">This wipes every value, flag, and photo entered for today's inspection on this building — back to a blank sheet. This can't be undone.</p>
      <p class="form-error" id="clear-all-error" hidden role="alert"></p>
      <div class="inspection-actions">
        <button type="button" class="button button--outline" id="cancel-clear-all">Cancel</button>
        <button type="button" class="button button--danger" id="confirm-clear-all">Yes, clear everything</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);

  wrap.querySelector("#cancel-clear-all").addEventListener("click", () => wrap.remove());
  wrap.querySelector("#confirm-clear-all").addEventListener("click", handleConfirmClearAll);
}

async function commandModeSave() {
  const cm = state.commandMode;
  cm.saving = true;
  try {
    const data = await api.inspectionSave({
      notes: state.inspection.notes,
      readings: cm.readings,
      flags: cm.flags,
      photoKeys: cm.photoKeys,
    });
    state.inspection.readings = data.readings;
    state.inspection.flags = data.flags;
    state.inspection.photoKeys = data.photoKeys;
    state.inspection.status = data.status;
  } catch (error) {
    cm.error = error.message;
  } finally {
    cm.saving = false;
  }
}

// A tag's group requires its own timestamped photo before the day can be
// submitted (see migrations/0017_group_photos.sql). Command mode is
// sequential, so "requires a photo now" means: this was the last reading
// in its group -- the next tag belongs to a different group, or there's
// nothing left -- and that group doesn't have today's photo yet.
function groupNeedsPhotoNow(cm, finishedTag) {
  if (!finishedTag?.equipment_group_id) return false;
  if (cm.groupPhotos[finishedTag.equipment_group_id]) return false;
  const nextTag = state.inspection.tags.find((t) => t.id === cm.order[cm.index + 1]);
  return !nextTag || nextTag.equipment_group_id !== finishedTag.equipment_group_id;
}

function commandModeAdvance() {
  const cm = state.commandMode;
  const finishedTag = state.inspection.tags.find((t) => t.id === cm.order[cm.index]);
  if (groupNeedsPhotoNow(cm, finishedTag)) {
    cm.pendingGroupPhoto = { groupId: finishedTag.equipment_group_id, groupName: finishedTag.equipment_group_name };
    renderApp();
    return;
  }
  commandModeContinueAdvance();
}

function commandModeContinueAdvance() {
  const cm = state.commandMode;
  if (cm.index < cm.order.length - 1) {
    cm.index += 1;
    cm.entryMode = "choose";
    cm.abnormalPrompt = null;
    cm.scanResult = null;
    cm.tempUnit = "C";
    // Skipping straight to the manual box (see skipToManual) bypasses
    // handleCommandModeManualOpen, which is normally what copies an
    // already-recorded value into the draft -- do that here too, or the
    // box would look empty for a tag that's actually already answered.
    cm.manualDraft = cm.readings[cm.order[cm.index]] || "";
    renderApp();
    return;
  }
  const anyFlagged = cm.order.some((id) => cm.flags[id]);
  if (anyFlagged) {
    cm.reviewFlags = true;
    renderApp();
  } else {
    exitCommandMode();
  }
}

// Deferring is allowed mid-walkthrough (hands full, camera acting up) --
// the hard stop is at submit, both client-side (submitInspection) and
// server-side (worker/inspections.js), not here.
function commandModeSkipGroupPhoto() {
  const cm = state.commandMode;
  cm.pendingGroupPhoto = null;
  commandModeContinueAdvance();
}

async function commandModeCaptureGroupPhoto(file) {
  const cm = state.commandMode;
  const groupId = cm.pendingGroupPhoto.groupId;
  cm.groupPhotoUploading = true;
  cm.error = "";
  renderApp();
  try {
    const proof = await captureComplianceProof(file);
    const result = await api.groupPhotoUpload({ groupId, ...proof });
    cm.groupPhotos[groupId] = {
      photoKey: result.photoKey,
      capturedAt: result.capturedAt,
      latitude: result.latitude,
      longitude: result.longitude,
    };
    cm.pendingGroupPhoto = null;
    cm.groupPhotoUploading = false;
    commandModeContinueAdvance();
  } catch (error) {
    cm.groupPhotoUploading = false;
    cm.error = error.message;
    renderApp();
  }
}

async function commandModeAfterValueSettled() {
  const cm = state.commandMode;
  cm.abnormalPrompt = null;
  await commandModeSave();

  if (cm.reviewingSingleFlag) {
    cm.reviewingSingleFlag = false;
    const stillFlagged = cm.order.some((id) => cm.flags[id]);
    if (stillFlagged) {
      cm.reviewFlags = true;
      renderApp();
    } else {
      exitCommandMode();
    }
    return;
  }

  cm.entryMode = "choose";
  commandModeAdvance();
}

async function commandModeAcceptValue(tagId, rawValue, { photoKey } = {}) {
  const cm = state.commandMode;
  const tag = state.inspection.tags.find((t) => t.id === tagId);

  cm.readings[tagId] = rawValue;
  cm.flags[tagId] = false;
  if (photoKey) cm.photoKeys[tagId] = photoKey;
  cm.scanResult = null;
  cm.manualDraft = "";
  cm.error = "";

  const paramFlag = clientFlagFor(tag, rawValue);
  const trendFlag = !paramFlag && historyFlagFor(tag, rawValue);

  if (paramFlag) {
    const detail = tag.parameter?.expected
      ? `Expected "${tag.parameter.expected}" — this doesn't match.`
      : tag.parameter?.min != null
        ? `Outside the normal range your operations manager set (${tag.parameter.min}–${tag.parameter.max}${tag.unit ? ` ${tag.unit}` : ""}).`
        : "This is outside the normal range set for this reading.";
    cm.abnormalPrompt = { tagId, value: rawValue, basis: "parameter", detail };
    cm.entryMode = "choose";
    renderApp();
    return;
  }
  if (trendFlag) {
    const avg = Math.round(tag.history.avg * 10) / 10;
    cm.abnormalPrompt = {
      tagId,
      value: rawValue,
      basis: "history",
      detail: `Recent readings for this item have averaged ${avg}${tag.unit ? ` ${tag.unit}` : ""} — this is a noticeable jump from that.`,
    };
    cm.entryMode = "choose";
    renderApp();
    return;
  }

  await commandModeAfterValueSettled();
}

async function handleCommandModeAbnormalConfirm() {
  const cm = state.commandMode;
  const tagId = cm.abnormalPrompt.tagId;
  if (!state.confirmedAbnormalTagIds.includes(tagId)) {
    state.confirmedAbnormalTagIds.push(tagId);
  }
  await commandModeAfterValueSettled();
}

function handleCommandModeAbnormalIncorrect() {
  const cm = state.commandMode;
  const tagId = cm.abnormalPrompt.tagId;
  cm.abnormalPrompt = null;
  cm.readings[tagId] = "";
  cm.entryMode = "manual";
  cm.manualDraft = "";
  renderApp();
}

async function handleCommandModeFlag() {
  const cm = state.commandMode;
  const tagId = cm.order[cm.index];
  cm.flags[tagId] = true;
  cm.abnormalPrompt = null;
  cm.entryMode = "choose";
  await commandModeSave();

  if (cm.reviewingSingleFlag) {
    cm.reviewingSingleFlag = false;
    cm.reviewFlags = true;
    renderApp();
    return;
  }
  commandModeAdvance();
}

function handleCommandModePrev() {
  const cm = state.commandMode;
  if (cm.index === 0) return;
  cm.index -= 1;
  cm.entryMode = "choose";
  cm.abnormalPrompt = null;
  cm.scanResult = null;
  cm.tempUnit = "C";
  cm.manualDraft = cm.readings[cm.order[cm.index]] || "";
  renderApp();
}

function handleCommandModeNext() {
  const cm = state.commandMode;
  cm.entryMode = "choose";
  cm.abnormalPrompt = null;
  cm.scanResult = null;
  commandModeAdvance();
}

function handleCommandModeManualOpen() {
  const cm = state.commandMode;
  const tagId = cm.order[cm.index];
  cm.entryMode = "manual";
  cm.manualDraft = cm.readings[tagId] || "";
  renderApp();
}

function handleCommandModeManualCancel() {
  const cm = state.commandMode;
  cm.entryMode = "choose";
  renderApp();
}

// Everything in this app assumes one consistent unit per gauge over
// time (min/max parameters, the 7-day trend check) -- so no matter which
// button a super hits, what actually gets stored is always Celsius. The
// °F button is just so they don't have to do the math by hand off an
// old Fahrenheit gauge.
function fahrenheitToCelsius(f) {
  return Math.round(((f - 32) * (5 / 9)) * 10) / 10;
}

function handleCommandModeManualSubmit(event) {
  event.preventDefault();
  const cm = state.commandMode;
  const tagId = cm.order[cm.index];
  const tag = state.inspection.tags.find((t) => t.id === tagId);
  let value = document.querySelector("#command-mode-manual-input").value.trim();
  if (!value) return;
  if (isTemperatureTag(tag) && cm.tempUnit === "F") {
    const num = Number.parseFloat(value);
    if (!Number.isNaN(num)) value = String(fahrenheitToCelsius(num));
  }
  commandModeAcceptValue(tagId, value);
}

function handleCommandModeManualChoice(button) {
  const cm = state.commandMode;
  const tagId = cm.order[cm.index];
  commandModeAcceptValue(tagId, button.dataset.value);
}

async function handleCommandModePhotoInput(event) {
  const input = event.currentTarget;
  const file = input.files?.[0];
  if (!file) return;
  const cm = state.commandMode;
  const tagId = cm.order[cm.index];
  cm.entryMode = "busy";
  cm.error = "";
  renderApp();
  const status = document.querySelector("#command-mode-busy-status");
  const stopAnimation = status ? startReadingAnimation(status, { estimateSeconds: 4 }) : () => {};
  try {
    const { base64: imageBase64, mediaType } = await compressImageFile(file);
    const result = await api.commandModePhoto({ tagId, imageBase64, mediaType });
    stopAnimation();
    cm.scanResult = result;
    cm.entryMode = "scan-result";
    renderApp();
  } catch (error) {
    stopAnimation();
    cm.error = error.message;
    cm.entryMode = "choose";
    renderApp();
  } finally {
    input.value = "";
  }
}

function handleCommandModeScanAccept() {
  const cm = state.commandMode;
  const tagId = cm.order[cm.index];
  const result = cm.scanResult;
  commandModeAcceptValue(tagId, result.value, { photoKey: result.photoKey });
}

function handleCommandModeScanRetake() {
  const cm = state.commandMode;
  cm.scanResult = null;
  cm.entryMode = "choose";
  renderApp();
}

function handleCommandModeScanManual() {
  const cm = state.commandMode;
  const value = cm.scanResult?.value;
  cm.scanResult = null;
  cm.entryMode = "manual";
  cm.manualDraft = value || "";
  renderApp();
}

function handleCommandModeResolveFlag(tagId) {
  const cm = state.commandMode;
  cm.reviewFlags = false;
  cm.reviewingSingleFlag = true;
  cm.index = cm.order.indexOf(tagId);
  cm.entryMode = "choose";
  cm.abnormalPrompt = null;
  cm.scanResult = null;
  renderApp();
}

function renderCommandMode() {
  const cm = state.commandMode;
  const tags = state.inspection.tags;
  const byId = Object.fromEntries(tags.map((t) => [t.id, t]));

  if (cm.reviewFlags) return renderCommandModeFlagReview(cm, byId);
  if (cm.pendingGroupPhoto) return renderCommandModeGroupPhoto(cm);

  const tagId = cm.order[cm.index];
  const tag = byId[tagId];
  const total = cm.order.length;
  const answeredCount = cm.order.filter((id) => (cm.readings[id] && cm.readings[id] !== "") || cm.flags[id]).length;
  const label = [tag.tag_no, tag.reading_type].filter(Boolean).join(" — ");
  const currentValue = cm.readings[tagId];
  const isFlagged = !!cm.flags[tagId];
  // TEMPORARY, per Lucas 2026-09-09: always skip the "choose" stage
  // (camera / upload / enter manually) and land straight in the manual
  // box, for every account -- not just non-beta ones -- while he's doing
  // live speed-matters demos building to building. This has to survive
  // a full page reload (phone locks, Chrome gets closed and reopened)
  // every time command mode is re-entered, which it does automatically
  // since this is evaluated fresh on every render, not sticky state.
  // aiPhotoEnabled() plumbing is untouched below -- restore
  // `&& !aiPhotoEnabled()` here once the photo-entry flow is revisited.
  const skipToManual = cm.entryMode === "choose";

  return `
    <section class="command-mode">
      <div class="command-mode__topbar">
        <button type="button" class="link-button" id="command-mode-exit">← Exit command mode</button>
        <span class="command-mode__progress">${cm.index + 1} of ${total} · ${answeredCount} done</span>
        <button type="button" class="link-button link-button--danger" id="command-mode-clear-all">Clear all</button>
      </div>
      <div class="command-mode__progress-track"><span style="width:${Math.round((cm.index / Math.max(total - 1, 1)) * 100)}%"></span></div>

      <div class="command-mode__stage">
        <p class="command-mode__location">${tag.location_name ? escapeHtml(tag.location_name) : "⚠ No location set for this item"}${tag.equipment_group_name ? ` · ${escapeHtml(tag.equipment_group_name)}` : ""}</p>
        <h1 class="command-mode__label">${escapeHtml(label)}</h1>
        ${
          tag.unit
            ? `<p class="command-mode__unit">Unit: ${escapeHtml(tag.unit)}</p>`
            : CLOSED_CHOICE_TYPES[tag.value_type]
              ? `<p class="command-mode__unit">Expected: ${escapeHtml(CLOSED_CHOICE_TYPES[tag.value_type].options.join(" / "))}</p>`
              : ""
        }

        ${cm.error ? `<p class="form-error">${escapeHtml(cm.error)}</p>` : ""}

        ${
          cm.abnormalPrompt
            ? renderCommandModeAbnormal(cm.abnormalPrompt, tag)
            : cm.entryMode === "scan-result"
              ? renderCommandModeScanResult(cm, tag)
              : cm.entryMode === "manual" || skipToManual
                ? renderCommandModeManualEntry(cm, tag)
                : cm.entryMode === "busy"
                  ? `<div class="command-mode__busy"><span class="loading-bar"><span></span></span><p id="command-mode-busy-status">Reading…</p></div>`
                  : renderCommandModeChoose(currentValue, isFlagged, tag)
        }
      </div>

      ${
        cm.abnormalPrompt || cm.entryMode === "manual" || cm.entryMode === "busy" || cm.entryMode === "scan-result"
          ? ""
          : `<div class="command-mode__nav">
              <button type="button" class="button button--outline" id="command-mode-prev" ${cm.index === 0 ? "disabled" : ""}>← Back</button>
              <button type="button" class="button button--outline" id="command-mode-flag">Flag for later</button>
              <button type="button" class="button button--outline" id="command-mode-next">${cm.index === total - 1 ? "Skip to end" : "Skip →"}</button>
            </div>`
      }
    </section>`;
}

function renderCommandModeChoose(currentValue, isFlagged, tag) {
  return `
    ${
      currentValue
        ? `<div class="command-mode__current"><span>${escapeHtml(currentValue)}</span>${tag.unit ? ` <small>${escapeHtml(tag.unit)}</small>` : ""}</div>`
        : `<p class="command-mode__empty">${isFlagged ? "🚩 Flagged for later — no value yet" : "No value yet"}</p>`
    }
    <div class="command-mode__actions">
      ${
        aiPhotoEnabled()
          ? `<label class="button button--primary command-mode__action" for="command-mode-camera">${icon("camera")} Take picture</label>
             <input type="file" accept="image/*" capture="environment" id="command-mode-camera" hidden />
             <label class="button button--outline command-mode__action" for="command-mode-upload">${icon("image")} Upload from device</label>
             <input type="file" accept="image/*" id="command-mode-upload" hidden />`
          : ""
      }
      <button type="button" class="button ${aiPhotoEnabled() ? "button--outline" : "button--primary"} command-mode__action" id="command-mode-manual">${icon("edit")} Enter manually</button>
    </div>`;
}

// A tag reading in whole degrees with no closed-choice type is a
// temperature -- "°" is the only unit this app hands a super for that.
function isTemperatureTag(tag) {
  return tag.unit === "°" && !CLOSED_CHOICE_TYPES[tag.value_type];
}

function renderCommandModeManualEntry(cm, tag) {
  // Matches skipToManual above (TEMPORARY, everyone skips the "choose"
  // stage right now) -- there's no "choose" screen underneath to cancel
  // back to for anyone at the moment, so don't offer a Cancel that would
  // just redraw the same box. Back/Flag/Skip in the nav bar below still
  // cover leaving a reading blank. Restore `aiPhotoEnabled()` here
  // alongside skipToManual once the photo-entry flow is revisited.
  const showCancel = false;

  // A one-tap choice beats typing "hand" or "auto" on a phone keyboard,
  // and it can't typo into something the flag-matching logic won't
  // recognize -- reuses the same closed-choice list as the checklist
  // review dropdown and the manager's "Expected" parameter picker.
  const choices = CLOSED_CHOICE_TYPES[tag.value_type]?.options;
  if (choices) {
    return `
      <div class="command-mode__manual">
        <div class="command-mode__choice-grid">
          ${choices
            .map(
              (choice) =>
                `<button type="button" class="button button--outline command-mode-manual-choice" data-value="${escapeHtml(choice)}">${escapeHtml(choice)}</button>`,
            )
            .join("")}
        </div>
        ${showCancel ? `<div class="command-mode__manual-actions"><button type="button" class="button button--outline" id="command-mode-manual-cancel">Cancel</button></div>` : ""}
      </div>`;
  }
  const isTemp = isTemperatureTag(tag);
  return `
    <form id="command-mode-manual-form" class="command-mode__manual">
      ${
        isTemp
          ? `<div class="command-mode__unit-toggle" role="group" aria-label="Unit for the value you're about to type">
              <button type="button" class="command-mode-temp-unit ${cm.tempUnit === "C" ? "is-selected" : ""}" data-unit="C">°C</button>
              <button type="button" class="command-mode-temp-unit ${cm.tempUnit === "F" ? "is-selected" : ""}" data-unit="F">°F</button>
            </div>`
          : ""
      }
      <input
        type="text"
        inputmode="decimal"
        id="command-mode-manual-input"
        value="${escapeHtml(cm.manualDraft ?? "")}"
        placeholder="Value"
        autocomplete="off"
      />
      <div class="command-mode__manual-actions">
        ${showCancel ? `<button type="button" class="button button--outline" id="command-mode-manual-cancel">Cancel</button>` : ""}
        <button type="submit" class="button button--primary">Confirm</button>
      </div>
    </form>`;
}

function renderCommandModeScanResult(cm, tag) {
  const r = cm.scanResult;
  return `
    <div class="command-mode__scan-result ${!r.labelConfirmed || r.unclear || r.value == null ? "command-mode__scan-result--warning" : ""}">
      ${
        r.value != null
          ? `<div class="command-mode__current"><span>${escapeHtml(r.value)}</span>${tag.unit ? ` <small>${escapeHtml(tag.unit)}</small>` : ""}</div>`
          : `<p class="command-mode__empty">Couldn't read a value in that photo.</p>`
      }
      ${
        !r.labelConfirmed
          ? `<p class="command-mode__scan-note">${icon("warning")} Couldn't confirm this photo shows "${escapeHtml(tag.tag_no || tag.reading_type)}" — double check it's the right equipment before accepting.</p>`
          : ""
      }
      ${r.unclear ? `<p class="command-mode__scan-note">${icon("warning")} That reading looked blurry or ambiguous.</p>` : ""}
      <p class="quiet-label">Scanned in ${(r.elapsedMs / 1000).toFixed(1)}s</p>
      <div class="command-mode__manual-actions">
        <button type="button" class="button button--outline" id="command-mode-scan-retake">Retake</button>
        <button type="button" class="button button--outline" id="command-mode-scan-manual">Enter manually</button>
        ${r.value != null ? `<button type="button" class="button button--primary" id="command-mode-scan-accept">Accept</button>` : ""}
      </div>
    </div>`;
}

function renderCommandModeAbnormal(prompt, tag) {
  return `
    <div class="command-mode__abnormal">
      <div class="command-mode__current"><span>${escapeHtml(prompt.value)}</span>${tag.unit ? ` <small>${escapeHtml(tag.unit)}</small>` : ""}</div>
      <p class="command-mode__scan-note">${icon("warning")} ${escapeHtml(prompt.detail)}</p>
      <div class="command-mode__manual-actions">
        <button type="button" class="button button--outline" id="command-mode-abnormal-incorrect">Incorrect — re-enter</button>
        <button type="button" class="button button--primary" id="command-mode-abnormal-confirm">Confirm as normal</button>
      </div>
    </div>`;
}

function renderCommandModeGroupPhoto(cm) {
  const { groupName } = cm.pendingGroupPhoto;
  return `
    <section class="command-mode">
      <div class="command-mode__topbar">
        <button type="button" class="link-button" id="command-mode-exit">← Exit command mode</button>
        <span class="command-mode__progress">${cm.index + 1} of ${cm.order.length}</span>
        <span></span>
      </div>
      <div class="command-mode__stage">
        <p class="command-mode__location">Required before moving on</p>
        <h1 class="command-mode__label">${icon("camera")} Photo of ${escapeHtml(groupName || "this machine")}</h1>
        <p class="command-mode__scan-note">${icon("warning")} A timestamp gets stamped onto the photo automatically — this is how we confirm every machine was actually checked today, not just filled in from memory.</p>
        ${cm.error ? `<p class="form-error">${escapeHtml(cm.error)}</p>` : ""}
        ${
          cm.groupPhotoUploading
            ? `<div class="command-mode__busy"><span class="loading-bar"><span></span></span><p>Stamping and uploading…</p></div>`
            : `<div class="command-mode__actions">
                <label class="button button--primary command-mode__action" for="command-mode-group-photo">${icon("camera")} Take the photo</label>
                <input type="file" accept="image/*" capture="environment" id="command-mode-group-photo" hidden />
                <button type="button" class="button button--outline command-mode__action" id="command-mode-group-photo-skip">I'll do this later</button>
              </div>`
        }
      </div>
    </section>`;
}

function renderCommandModeFlagReview(cm, byId) {
  const flaggedIds = cm.order.filter((id) => cm.flags[id]);
  return `
    <section class="command-mode">
      <div class="command-mode__topbar">
        <button type="button" class="link-button" id="command-mode-exit">← Exit command mode</button>
        <button type="button" class="link-button link-button--danger" id="command-mode-clear-all">Clear all</button>
      </div>
      <div class="command-mode__stage command-mode__stage--review">
        <h1 class="command-mode__label">Flagged items</h1>
        <p class="parameters-intro">Resolve these before this inspection can be submitted — an unresolved location assignment doesn't have to mean a wasted trip.</p>
        <div class="command-mode__flag-list">
          ${flaggedIds
            .map((id) => {
              const t = byId[id];
              const label = [t.tag_no, t.reading_type].filter(Boolean).join(" — ");
              return `<div class="building-row">
                <div class="building-row__name"><strong>${escapeHtml(label)}</strong><small>${escapeHtml(t.location_name || "No location set")}</small></div>
                <button type="button" class="button button--outline button--small command-mode-resolve-flag" data-tag-id="${id}">Resolve</button>
              </div>`;
            })
            .join("")}
        </div>
      </div>
    </section>`;
}

function bindCommandModeEvents() {
  document.querySelector("#command-mode-exit")?.addEventListener("click", exitCommandMode);
  document.querySelector("#command-mode-group-photo")?.addEventListener("change", (event) => {
    const file = event.currentTarget.files?.[0];
    if (file) commandModeCaptureGroupPhoto(file);
  });
  document.querySelector("#command-mode-group-photo-skip")?.addEventListener("click", commandModeSkipGroupPhoto);
  document.querySelector("#command-mode-prev")?.addEventListener("click", handleCommandModePrev);
  document.querySelector("#command-mode-next")?.addEventListener("click", handleCommandModeNext);
  document.querySelector("#command-mode-flag")?.addEventListener("click", handleCommandModeFlag);
  document.querySelector("#command-mode-manual")?.addEventListener("click", handleCommandModeManualOpen);
  document.querySelector("#command-mode-manual-cancel")?.addEventListener("click", handleCommandModeManualCancel);
  document.querySelector("#command-mode-manual-form")?.addEventListener("submit", handleCommandModeManualSubmit);
  document.querySelectorAll(".command-mode-manual-choice").forEach((button) => {
    button.addEventListener("click", () => handleCommandModeManualChoice(button));
  });
  document.querySelectorAll(".command-mode-temp-unit").forEach((button) => {
    button.addEventListener("click", () => {
      // Preserve whatever's already typed -- re-rendering to flip the
      // selected-button style would otherwise redraw the input from
      // manualDraft, which is only synced at a few transition points,
      // not on every keystroke.
      const input = document.querySelector("#command-mode-manual-input");
      if (input) state.commandMode.manualDraft = input.value;
      state.commandMode.tempUnit = button.dataset.unit;
      renderApp();
    });
  });
  document.querySelector("#command-mode-camera")?.addEventListener("change", handleCommandModePhotoInput);
  document.querySelector("#command-mode-upload")?.addEventListener("change", handleCommandModePhotoInput);
  document.querySelector("#command-mode-scan-accept")?.addEventListener("click", handleCommandModeScanAccept);
  document.querySelector("#command-mode-scan-retake")?.addEventListener("click", handleCommandModeScanRetake);
  document.querySelector("#command-mode-scan-manual")?.addEventListener("click", handleCommandModeScanManual);
  document.querySelector("#command-mode-abnormal-confirm")?.addEventListener("click", handleCommandModeAbnormalConfirm);
  document.querySelector("#command-mode-abnormal-incorrect")?.addEventListener("click", handleCommandModeAbnormalIncorrect);
  document.querySelectorAll(".command-mode-resolve-flag").forEach((button) => {
    button.addEventListener("click", () => handleCommandModeResolveFlag(Number(button.dataset.tagId)));
  });
  document.querySelector("#command-mode-clear-all")?.addEventListener("click", renderClearAllConfirmModal);
}

// Which equipment groups still need today's required photo -- mirrors
// worker/inspections.js's submit-time check so a super finds out
// immediately instead of after a round trip (the backend still enforces
// this regardless, in case this check is ever out of sync or bypassed).
function missingGroupPhotoNames() {
  const tags = state.inspection?.tags || [];
  const groupPhotos = state.inspection?.groupPhotos || {};
  const seen = new Map();
  for (const tag of tags) {
    if (tag.equipment_group_id && !seen.has(tag.equipment_group_id)) {
      seen.set(tag.equipment_group_id, tag.equipment_group_name);
    }
  }
  return [...seen.entries()].filter(([id]) => !groupPhotos[id]).map(([, name]) => name);
}

async function handleInspectionSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const error = document.querySelector("#inspection-error");
  const missing = missingGroupPhotoNames();
  if (missing.length) {
    if (error) {
      error.textContent = `Take a timestamped photo of these before submitting: ${missing.join(", ")}`;
      error.hidden = false;
    }
    return;
  }
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

function renderProfileEditModal(user) {
  const existing = document.querySelector("#profile-edit-modal");
  if (existing) existing.remove();

  const wrap = document.createElement("div");
  wrap.id = "profile-edit-modal";
  wrap.className = "modal-overlay";
  wrap.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="profile-edit-title">
      <h3 id="profile-edit-title">${icon("edit")} Edit your profile</h3>
      <form id="profile-edit-form" class="login-form">
        <label><span>Full name</span><input name="fullName" value="${escapeHtml(user.fullName)}" required /></label>
        <label><span>Written role</span><input name="jobTitle" value="${escapeHtml(user.jobTitle)}" required maxlength="80" /></label>
        <p class="map-picker__hint">This is what other managers see when deciding who to assign something to — it can be different from your access level (${escapeHtml(user.roleLabel)}). e.g. "Field Inventory Operations Specialist."</p>
        <p class="form-error" id="profile-edit-error" hidden role="alert"></p>
        <div class="inspection-actions">
          <button type="button" class="button button--outline" id="cancel-profile-edit">Cancel</button>
          <button type="submit" class="button button--primary">Save</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(wrap);

  wrap.querySelector("#cancel-profile-edit").addEventListener("click", () => wrap.remove());
  wrap.querySelector("#profile-edit-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const error = wrap.querySelector("#profile-edit-error");
    const data = new FormData(form);
    button.disabled = true;
    try {
      await api.updateProfile({ fullName: data.get("fullName"), jobTitle: data.get("jobTitle") });
      wrap.remove();
      await loadDashboard();
    } catch (requestError) {
      error.textContent = requestError.message;
      error.hidden = false;
      button.disabled = false;
    }
  });
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
  document.querySelectorAll("[data-single-photo-tag-id]").forEach((input) => {
    input.addEventListener("change", handleSinglePhotoCapture);
  });
  document.querySelectorAll("[data-machine-photo-id]").forEach((input) => {
    input.addEventListener("change", (event) => {
      const file = event.currentTarget.files?.[0];
      if (file) handleMachinePhotoCapture(Number(event.currentTarget.dataset.machinePhotoId), file);
    });
  });
  document.querySelector("#start-command-mode")?.addEventListener("click", startCommandMode);
  document.querySelector("#parameters-form")?.addEventListener("submit", handleParametersSave);
  document.querySelector("#toggle-manager-parameters")?.addEventListener("click", () => {
    state.managerParametersExpanded = !state.managerParametersExpanded;
    renderApp();
  });

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
  // A sprinkler VALVE's position is always Open/Closed, no exceptions --
  // the server enforces this regardless of what's picked (see
  // handleSaveTags), but auto-selecting it here means what a manager
  // sees on screen already matches what's actually going to save.
  // Deliberately only looks at tag_no/reading_type, not system_name -- a
  // "Sprinkler System" section legitimately also holds plain numeric
  // readings under the same valve (water/air pressure gauges), and
  // matching on the section name would wrongly force those too.
  document.querySelector("#tags-review-form")?.addEventListener("input", (event) => {
    const field = event.target.dataset?.field;
    if (field !== "tag_no" && field !== "reading_type") return;
    const row = event.target.closest(".tags-review-row");
    const text = ["tag_no", "reading_type"]
      .map((f) => row.querySelector(`[data-field="${f}"]`)?.value || "")
      .join(" ");
    if (/sprinkler/i.test(text)) {
      row.querySelector('[data-field="value_type"]').value = "open_closed";
    }
  });
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
  document.querySelectorAll(".cancel-delete-request").forEach((button) => {
    button.addEventListener("click", () => handleCancelDeleteRequest(button));
  });
  document.querySelectorAll(".approve-delete-request").forEach((button) => {
    button.addEventListener("click", () => handleApproveDeleteRequest(button));
  });
  document.querySelectorAll(".deny-delete-request").forEach((button) => {
    button.addEventListener("click", () => handleDenyDeleteRequest(button));
  });
  document.querySelectorAll(".restore-building").forEach((button) => {
    button.addEventListener("click", () => handleRestoreBuilding(button));
  });
  document.querySelectorAll(".remove-account").forEach((button) => {
    button.addEventListener("click", () => handleRemoveAccount(button));
  });
  document.querySelectorAll(".restore-account").forEach((button) => {
    button.addEventListener("click", () => handleRestoreAccount(button));
  });
  document.querySelectorAll(".account-classification").forEach((select) => {
    select.addEventListener("change", () => handleSetClassification(select));
  });
  document.querySelector("#open-add-account")?.addEventListener("click", () => {
    state.adminAddingAccount = true;
    state.adminNewAccountCreated = null;
    renderApp();
  });
  document.querySelector("#add-account-cancel")?.addEventListener("click", () => {
    state.adminAddingAccount = false;
    renderApp();
  });
  document.querySelector("#dismiss-add-account-success")?.addEventListener("click", () => {
    state.adminNewAccountCreated = null;
    renderApp();
  });
  document.querySelector("#add-account-role")?.addEventListener("change", (event) => {
    state.adminNewAccountRole = event.target.value;
    const isField = ["superintendent", "property_manager"].includes(event.target.value);
    const isManagerTier = ["regional_manager", "operations_manager"].includes(event.target.value);
    document.querySelector("#add-account-building-field").hidden = !isField;
    document.querySelector("#add-account-region-field").hidden = !isManagerTier;
  });
  document.querySelector("#add-account-generate")?.addEventListener("click", () => {
    const field = document.querySelector("#add-account-password");
    field.value = generatePassword();
  });
  document.querySelector("#add-account-form")?.addEventListener("submit", handleAdminAddAccountSubmit);
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

  document.querySelectorAll(".building-name-link").forEach((button) => {
    button.addEventListener("click", () => {
      buildingMap = null;
      buildingMarker = null;
      openBuildingWorld(Number(button.dataset.buildingId));
    });
  });
  document.querySelectorAll(".building-row-toggle").forEach((button) => {
    button.addEventListener("click", () => {
      const id = Number(button.dataset.buildingId);
      if (state.expandedBuildingRowIds.has(id)) state.expandedBuildingRowIds.delete(id);
      else state.expandedBuildingRowIds.add(id);
      renderApp();
    });
  });
  document.querySelector("#close-building-world")?.addEventListener("click", closeBuildingWorld);
  document.querySelector("#toggle-building-edit")?.addEventListener("click", () => {
    buildingMap = null;
    buildingMarker = null;
    state.buildingWorldEditing = !state.buildingWorldEditing;
    renderApp();
  });
  document.querySelector("#rename-building-start")?.addEventListener("click", handleRenameBuildingStart);
  document.querySelector("#rename-building-cancel")?.addEventListener("click", handleRenameBuildingCancel);
  document.querySelector("#rename-building-save")?.addEventListener("click", handleRenameBuildingSave);
  document.querySelector("#rename-building-input")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleRenameBuildingSave();
    } else if (event.key === "Escape") {
      event.preventDefault();
      handleRenameBuildingCancel();
    }
  });
  document.querySelector("#cancel-building-world-edit")?.addEventListener("click", () => {
    buildingMap = null;
    buildingMarker = null;
    state.buildingWorldEditing = false;
    renderApp();
  });
  document.querySelector("#building-world-edit-form")?.addEventListener("submit", handleBuildingWorldEditSubmit);
  document.querySelector("#add-notice-form")?.addEventListener("submit", handleAddNotice);
  document.querySelectorAll(".remove-notice").forEach((button) => {
    button.addEventListener("click", () => handleRemoveNotice(button));
  });
  document.querySelectorAll(".assign-work-order-select").forEach((select) => {
    select.addEventListener("change", () => handleAssignWorkOrderWorld(select));
  });
  document.querySelectorAll(".resolve-work-order-world").forEach((button) => {
    button.addEventListener("click", () => handleResolveWorkOrderWorld(button));
  });
  document.querySelector("#add-location-form")?.addEventListener("submit", handleAddLocation);
  document.querySelectorAll(".remove-location").forEach((button) => {
    button.addEventListener("click", () => handleRemoveLocation(button));
  });
  document.querySelectorAll(".assign-tag-location").forEach((select) => {
    select.addEventListener("change", () => handleAssignTagLocation(select));
  });
  document.querySelector("#add-group-form")?.addEventListener("submit", handleAddGroup);
  document.querySelectorAll(".remove-group").forEach((button) => {
    button.addEventListener("click", () => handleRemoveGroup(button));
  });
  document.querySelectorAll(".assign-tag-group").forEach((select) => {
    select.addEventListener("change", () => handleAssignTagGroup(select));
  });
  document.querySelectorAll(".assign-group-location").forEach((select) => {
    select.addEventListener("change", () => handleAssignGroupLocationChange(select));
  });
  document.querySelectorAll(".checklist-group-select").forEach((checkbox) => {
    checkbox.addEventListener("change", () => handleChecklistGroupSelectToggle(checkbox));
  });
  document.querySelector("#checklist-bulk-apply")?.addEventListener("click", handleChecklistBulkApply);
  document.querySelector("#checklist-bulk-clear")?.addEventListener("click", handleChecklistBulkClear);
  document.querySelectorAll(".reading-chip:not(.reading-chip--editing)").forEach((chip) => {
    chip.addEventListener("pointerdown", handleReadingChipPointerDown);
  });
  document.querySelector("#edit-tag-form")?.addEventListener("submit", handleEditReadingChipSave);
  document.querySelector(".cancel-edit-tag")?.addEventListener("click", handleEditReadingChipCancel);
  document.querySelectorAll(".rename-group-start").forEach((button) => {
    button.addEventListener("click", () => handleRenameGroupStart(button));
  });
  document.querySelectorAll(".rename-group-cancel").forEach((button) => {
    button.addEventListener("click", handleRenameGroupCancel);
  });
  document.querySelectorAll(".rename-group-save").forEach((button) => {
    button.addEventListener("click", () => handleRenameGroupSave(button));
  });
  // querySelectorAll, not querySelector -- the same group can now show a
  // rename box in both the checklist card and the machine organizer at
  // once (two views of the same data), so there can be more than one of
  // these on screen simultaneously.
  document.querySelectorAll(".rename-group-input").forEach((input) => {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.closest(".rename-inline")?.querySelector(".rename-group-save")?.click();
      } else if (event.key === "Escape") {
        event.preventDefault();
        handleRenameGroupCancel();
      }
    });
  });
  document.querySelectorAll(".remove-superintendent").forEach((button) => {
    button.addEventListener("click", () => handleRemoveSuperintendentClick(button));
  });
  document.querySelector("#assign-superintendent-world-form")?.addEventListener("submit", handleAssignSuperintendentWorldSubmit);
  document.querySelector("#share-building-form")?.addEventListener("submit", handleShareBuildingSubmit);
  document.querySelectorAll(".unshare-building").forEach((button) => {
    button.addEventListener("click", () => handleUnshareBuildingClick(button));
  });
  document.querySelectorAll(".download-inspection-pdf").forEach((button) => {
    button.addEventListener("click", () => handleDownloadInspectionPdf(button));
  });

  // The map picker's edit form reuses the registration wizard's map IDs, so
  // an existing pinned location needs its Google Map instance created too --
  // otherwise the visible canvas just sits empty until the address changes.
  if (state.buildingWorldEditing && state.buildingWorld?.building?.latitude != null && !buildingMap) {
    placeBuildingMapPin(state.buildingWorld.building.latitude, state.buildingWorld.building.longitude);
  }
}

function handleRenameBuildingStart() {
  state.buildingWorldRenamingBuilding = true;
  renderApp();
  document.querySelector("#rename-building-input")?.focus();
}

function handleRenameBuildingCancel() {
  state.buildingWorldRenamingBuilding = false;
  renderApp();
}

async function handleRenameBuildingSave() {
  const input = document.querySelector("#rename-building-input");
  const button = document.querySelector("#rename-building-save");
  const name = input.value.trim();
  if (!name) return;
  button.disabled = true;
  const building = state.buildingWorld.building;
  try {
    await api.updateBuilding({
      buildingId: building.id,
      name,
      address: building.address,
      inspectionDays: (building.inspection_days || "").split(",").filter(Boolean),
      latitude: building.latitude,
      longitude: building.longitude,
    });
    building.name = name;
    state.buildingWorld.building = building;
    state.managerBuildings = state.managerBuildings.map((b) => (b.id === building.id ? { ...b, name } : b));
    state.buildingWorldRenamingBuilding = false;
    renderApp();
  } catch (error) {
    button.disabled = false;
    input.title = error.message;
  }
}

async function handleBuildingWorldEditSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const error = document.querySelector("#building-world-edit-error");
  const data = new FormData(form);
  const days = Array.from(form.querySelectorAll('input[name="days"]:checked')).map((el) => el.value);
  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    const latitude = data.get("latitude") ? Number.parseFloat(data.get("latitude")) : null;
    const longitude = data.get("longitude") ? Number.parseFloat(data.get("longitude")) : null;
    const payload = {
      buildingId: state.buildingWorld.buildingId,
      name: data.get("name"),
      address: data.get("address"),
      region: data.get("region"),
      inspectionDays: days,
      latitude,
      longitude,
    };
    await api.updateBuilding(payload);
    const patch = { name: payload.name, address: payload.address, region: payload.region || null, inspection_days: days.join(","), latitude, longitude };
    state.buildingWorld.building = { ...state.buildingWorld.building, ...patch };
    state.managerBuildings = state.managerBuildings.map((b) => (b.id === payload.buildingId ? { ...b, ...patch } : b));
    state.buildingWorldEditing = false;
    buildingMap = null;
    buildingMarker = null;
    renderApp();
  } catch (requestError) {
    submitButton.disabled = false;
    error.textContent = requestError.message;
    error.hidden = false;
  }
}

async function handleAddNotice(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const message = String(data.get("message") || "").trim();
  if (!message) return;
  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    await api.createNotice({ buildingId: state.buildingWorld.buildingId, message });
    const detail = await api.buildingDetail(state.buildingWorld.buildingId);
    state.buildingWorld = { loading: false, buildingId: state.buildingWorld.buildingId, ...detail };
    renderApp();
  } catch (error) {
    submitButton.disabled = false;
    form.querySelector("textarea").title = error.message;
  }
}

async function handleRemoveNotice(button) {
  button.disabled = true;
  try {
    await api.deleteNotice(Number(button.dataset.noticeId));
    state.buildingWorld.notices = state.buildingWorld.notices.filter((n) => n.id !== Number(button.dataset.noticeId));
    renderApp();
  } catch (error) {
    button.disabled = false;
    button.title = error.message;
  }
}

async function handleAssignWorkOrderWorld(select) {
  const workOrderId = Number(select.dataset.workOrderId);
  const assigneeId = Number(select.value);
  if (!assigneeId) return;
  select.disabled = true;
  try {
    await api.assignWorkOrder({ workOrderId, assigneeId });
    const assignee = state.buildingWorldAssignableUsers.find((u) => u.id === assigneeId);
    state.buildingWorld.workOrders = state.buildingWorld.workOrders.map((w) =>
      w.id === workOrderId ? { ...w, assigned_to: assigneeId, assigned_to_name: assignee?.full_name } : w,
    );
    renderApp();
  } catch (error) {
    select.disabled = false;
    select.title = error.message;
  }
}

async function handleResolveWorkOrderWorld(button) {
  button.disabled = true;
  const originalLabel = button.textContent;
  button.textContent = "Resolving…";
  try {
    const workOrderId = Number(button.dataset.workOrderId);
    await api.resolveWorkOrder(workOrderId);
    state.buildingWorld.workOrders = state.buildingWorld.workOrders.map((w) =>
      w.id === workOrderId ? { ...w, status: "resolved" } : w,
    );
    renderApp();
  } catch (error) {
    button.disabled = false;
    button.textContent = originalLabel;
    button.title = error.message;
  }
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
  button.textContent = state.session?.user?.role === "admin" ? "Deleting…" : "Requesting…";
  const error = document.querySelector("#delete-building-error");
  try {
    const buildingId = Number(button.dataset.buildingId);
    const confirmationText = document.querySelector("#delete-building-confirm-text").value;
    const result = await api.managerDeleteBuilding({ buildingId, confirmationText });
    if (result.deleted) {
      // Admin's delete IS the approval -- gone immediately.
      state.managerBuildings = state.managerBuildings.filter((b) => b.id !== buildingId);
    } else {
      // ROM/OM: nothing is gone -- just flag it pending on the row.
      state.managerBuildings = state.managerBuildings.map((b) =>
        b.id === buildingId ? { ...b, delete_requested_at: new Date().toISOString() } : b,
      );
    }
    state.deleteBuildingTarget = null;
    renderApp();
  } catch (requestError) {
    button.disabled = false;
    button.textContent = originalLabel;
    error.textContent = requestError.message;
    error.hidden = false;
  }
}

async function handleCancelDeleteRequest(button) {
  button.disabled = true;
  try {
    const buildingId = Number(button.dataset.buildingId);
    await api.managerCancelDeleteRequest({ buildingId });
    state.managerBuildings = state.managerBuildings.map((b) =>
      b.id === buildingId ? { ...b, delete_requested_at: null } : b,
    );
    renderApp();
  } catch (error) {
    button.disabled = false;
    button.title = error.message;
  }
}

async function handleApproveDeleteRequest(button) {
  button.disabled = true;
  try {
    const buildingId = Number(button.dataset.buildingId);
    await api.adminApproveDeleteRequest({ buildingId });
    state.adminDeleteRequests = state.adminDeleteRequests.filter((r) => r.id !== buildingId);
    state.managerBuildings = state.managerBuildings.filter((b) => b.id !== buildingId);
    const deleted = await api.adminDeletedBuildings().catch(() => null);
    if (deleted) state.adminDeletedBuildings = deleted.buildings;
    renderApp();
  } catch (error) {
    button.disabled = false;
    button.title = error.message;
  }
}

async function handleDenyDeleteRequest(button) {
  button.disabled = true;
  try {
    const buildingId = Number(button.dataset.buildingId);
    await api.adminDenyDeleteRequest({ buildingId });
    state.adminDeleteRequests = state.adminDeleteRequests.filter((r) => r.id !== buildingId);
    state.managerBuildings = state.managerBuildings.map((b) =>
      b.id === buildingId ? { ...b, delete_requested_at: null } : b,
    );
    renderApp();
  } catch (error) {
    button.disabled = false;
    button.title = error.message;
  }
}

async function handleRestoreBuilding(button) {
  button.disabled = true;
  try {
    const buildingId = Number(button.dataset.buildingId);
    await api.adminRestoreBuilding({ buildingId });
    state.adminDeletedBuildings = state.adminDeletedBuildings.filter((b) => b.id !== buildingId);
    const buildings = await api.managerBuildings().catch(() => null);
    if (buildings) state.managerBuildings = buildings.buildings;
    renderApp();
  } catch (error) {
    button.disabled = false;
    button.title = error.message;
  }
}

function generatePassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

async function handleAdminAddAccountSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const error = document.querySelector("#add-account-error");
  const button = form.querySelector('button[type="submit"]');
  const data = new FormData(form);
  const role = data.get("role");
  const payload = {
    fullName: (data.get("fullName") || "").trim(),
    email: (data.get("email") || "").trim(),
    phone: (data.get("phone") || "").trim(),
    role,
    password: data.get("password") || "",
    buildingId: data.get("buildingId") || null,
    regionName: (data.get("regionName") || "").trim(),
  };
  error.hidden = true;
  button.disabled = true;
  try {
    const res = await api.adminCreateAccount(payload);
    const refreshed = await api.accounts().catch(() => null);
    if (refreshed) state.accounts = refreshed.accounts;
    state.adminAddingAccount = false;
    state.adminNewAccountCreated = {
      fullName: payload.fullName,
      username: res.username,
      password: payload.password,
      roleLabel: ADMIN_CREATABLE_ROLES[role],
    };
    renderApp();
  } catch (requestError) {
    button.disabled = false;
    error.textContent = requestError.message;
    error.hidden = false;
  }
}

async function handleRemoveAccount(button) {
  if (!confirm(`Remove ${button.dataset.userName}'s account? They won't be able to log in, but their inspection history is kept.`)) return;
  button.disabled = true;
  try {
    const userId = Number(button.dataset.userId);
    await api.adminRemoveAccount({ userId });
    const removedAccount = state.accounts.find((a) => a.id === userId);
    state.accounts = state.accounts.filter((a) => a.id !== userId);
    if (removedAccount) {
      state.adminRemovedAccounts = [{ id: userId, full_name: removedAccount.fullName, removed_at: new Date().toISOString() }, ...state.adminRemovedAccounts];
    }
    renderApp();
  } catch (error) {
    button.disabled = false;
    button.title = error.message;
  }
}

async function handleRestoreAccount(button) {
  button.disabled = true;
  try {
    const userId = Number(button.dataset.userId);
    await api.adminRestoreAccount({ userId });
    state.adminRemovedAccounts = state.adminRemovedAccounts.filter((a) => a.id !== userId);
    const accounts = await api.accounts().catch(() => null);
    if (accounts) state.accounts = accounts.accounts;
    renderApp();
  } catch (error) {
    button.disabled = false;
    button.title = error.message;
  }
}

async function handleSetClassification(select) {
  select.disabled = true;
  try {
    const userId = Number(select.dataset.userId);
    await api.adminSetClassification({ userId, classification: select.value });
    const account = state.accounts.find((a) => a.id === userId);
    if (account) account.classification = select.value;
  } catch (error) {
    select.title = error.message;
  } finally {
    select.disabled = false;
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
  state.agencyClients = [];
  state.agencyActiveCompanyName = null;
  renderLogin();
}

async function bootstrap() {
  renderLoading();
  try {
    state.session = await api.session();
    if (state.session.user.role === "agency" && state.session.activeClientId == null) {
      await loadAgencyBroadView();
    } else {
      await loadDashboard();
    }
  } catch (error) {
    if (error.status && error.status !== 401) {
      renderLogin("The command service is unavailable. Start the local Worker and try again.");
      return;
    }
    renderLogin();
  }
}

bootstrap();
