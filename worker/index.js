import {
  clearSessionCookie,
  createSessionToken,
  hashToken,
  readCookie,
  sessionCookie,
  verifyPassword,
} from "./security.js";
import { dashboardForRole, roleLabels } from "./dashboard-data.js";
import { handleInspectionToday, handleInspectionSave, handleInspectionSubmit } from "./inspections.js";
import { handleManagerInspection, handleManagerParametersSave, handleManagerSuperintendents } from "./manager.js";
import { handlePropertyInspections } from "./property.js";
import { handleInspectionPhoto, handleCommandModePhoto } from "./vision.js";
import { handleGroupPhotoUpload } from "./group-photos.js";
import { handleListLocations, handleCreateLocation, handleDeleteLocation, handleAssignTagLocation } from "./locations.js";
import { handleListGroups, handleCreateGroup, handleDeleteGroup, handleAssignTagGroup, handleAssignGroupLocation, handleRenameGroup, handleUpdateTag } from "./groups.js";
import { handleListRoms, handleBuildingSharing, handleShareBuilding, handleUnshareBuilding } from "./sharing.js";
import { handleInspectionHistory, handleInspectionDetail } from "./inspection-history.js";
import {
  handleBuildingsList,
  handleBuildingCreate,
  handleUpdateBuilding,
  handlePushLive,
  handleDeleteBuilding,
  handleUnassignedSuperintendents,
  handleAssignableSuperintendents,
  handleAssignSuperintendent,
  handleRemoveSuperintendent,
  handleGenerateTags,
  handleSaveTags,
  handleBuildingDetail,
  handleCancelDeleteRequest,
} from "./buildings.js";
import {
  handleDeleteRequestsList,
  handleApproveDeleteRequest,
  handleDenyDeleteRequest,
  handleDeletedBuildingsList,
  handleRestoreBuilding,
  purgeExpiredBuildings,
} from "./building-deletion.js";
import {
  handleRemoveAccount,
  handleRestoreAccount,
  handleRemovedAccountsList,
  handleSetClassification,
  handleCreateAccount,
} from "./admin-accounts.js";
import { handleGeocodeSearch } from "./geocode.js";
import {
  handleFlagIssue,
  handleManagerWorkOrders,
  handleResolveWorkOrder,
  handleAssignWorkOrder,
  handleAssignableUsers,
} from "./work-orders.js";
import { handleAdminStats } from "./admin-stats.js";
import { handlePhotoDates, handlePhotoList, handlePhotoView } from "./photos.js";
import { handleCreateNotice, handleDeleteNotice } from "./notices.js";
import { handleUpdateProfile } from "./profile.js";
import { needsVerification, sendVerificationCode, verifyCode } from "./two-factor.js";
import { sendWeeklyDigest } from "./weekly-digest.js";
import {
  handleBuildingSearchForRegistration,
  handleSelfRegister,
  handlePendingRequests,
  handlePendingRequestDecision,
} from "./registration.js";
import { dbForClient, clientForIdentifier, recordLoginDirectory } from "./tenant-db.js";
import { handleListClients, handleSwitchClient, handleCreateBusiness } from "./clients.js";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: cors.allowed ? 204 : 403, headers: cors.headers });
    }

    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({ ok: true, service: "fhg-command-api" }, 200, cors.headers);
    }

    if (!url.pathname.startsWith("/api/")) {
      return json({ error: "Not found" }, 404, cors.headers);
    }

    if (!cors.allowed) {
      return json({ error: "Origin not allowed" }, 403, cors.headers);
    }

    try {
      if (url.pathname === "/api/auth/login" && request.method === "POST") {
        return handleLogin(request, env, cors.headers);
      }
      if (url.pathname === "/api/auth/verify-code" && request.method === "POST") {
        return handleVerifyCode(request, env, cors.headers);
      }

      // Public: no session required — someone filling out the sign-up form
      // doesn't have one yet.
      if (url.pathname === "/api/register/buildings/search" && request.method === "GET") {
        return handleBuildingSearchForRegistration(request, env, cors.headers);
      }
      if (url.pathname === "/api/register" && request.method === "POST") {
        return handleSelfRegister(request, env, cors.headers);
      }
      if (url.pathname === "/api/geocode/search" && request.method === "GET") {
        return handleGeocodeSearch(request, env, cors.headers);
      }
      // "Add a business" -- also public, this IS how a brand-new
      // company's first account gets created.
      if (url.pathname === "/api/business/create" && request.method === "POST") {
        return handleCreateBusiness(request, env, cors.headers);
      }

      if (url.pathname === "/api/auth/logout" && request.method === "POST") {
        return handleLogout(request, env, cors.headers);
      }

      const session = await requireSession(request, env);
      if (!session) return json({ error: "Authentication required" }, 401, cors.headers);
      // From here on, env.DB transparently points at whichever company's
      // database this session actually belongs to (or, for an agency
      // session with no company selected yet, is left untouched --
      // every handler below requires a real role/client_id match, which
      // an agency-with-no-selection session deliberately doesn't have).
      if (session.__db) env = { ...env, DB: session.__db };

      if (url.pathname === "/api/auth/me" && request.method === "GET") {
        return json(sessionPayload(session), 200, cors.headers);
      }

      // Agency-only: the broad, all-companies view and switching which
      // company's data the rest of this app's routes below resolve to.
      if (url.pathname === "/api/clients" && request.method === "GET") {
        return handleListClients(session, env, cors.headers);
      }
      if (url.pathname === "/api/clients/switch" && request.method === "POST") {
        return handleSwitchClient(request, session, env, cors.headers);
      }
      // An agency session with no company selected yet can't go any
      // further than the two routes above -- every other route needs a
      // real company's data to operate on.
      if (session.isAgency && session.companyId == null) {
        return json({ error: "Select a company first." }, 409, cors.headers);
      }

      if (url.pathname === "/api/dashboard" && request.method === "GET") {
        return json({ dashboard: await dashboardForRole(session.role, session.full_name, env, session) }, 200, cors.headers);
      }

      if (url.pathname === "/api/photos/dates" && request.method === "GET") {
        return handlePhotoDates(request, session, env, cors.headers);
      }
      if (url.pathname === "/api/photos/list" && request.method === "GET") {
        return handlePhotoList(request, session, env, cors.headers);
      }
      if (url.pathname === "/api/photos/view" && request.method === "GET") {
        return handlePhotoView(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/profile" && request.method === "POST") {
        return handleUpdateProfile(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/admin/accounts" && request.method === "GET") {
        return handleAccounts(session, env, cors.headers);
      }

      if (url.pathname === "/api/admin/stats" && request.method === "GET") {
        if (session.role !== "admin") {
          return json({ error: "Administrator access required" }, 403, cors.headers);
        }
        return handleAdminStats(env, cors.headers);
      }

      if (url.pathname === "/api/admin/weekly-digest/send-now" && request.method === "POST") {
        if (session.role !== "admin") {
          return json({ error: "Administrator access required" }, 403, cors.headers);
        }
        const result = await sendWeeklyDigest(env);
        return json(result, 200, cors.headers);
      }

      if (url.pathname === "/api/admin/impersonate" && request.method === "POST") {
        return handleImpersonate(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/admin/return" && request.method === "POST") {
        return handleAdminReturn(session, env, cors.headers);
      }

      if (url.pathname === "/api/admin/accounts/create" && request.method === "POST") {
        return handleCreateAccount(request, session, env, cors.headers);
      }
      if (url.pathname === "/api/admin/accounts/remove" && request.method === "POST") {
        return handleRemoveAccount(request, session, env, cors.headers);
      }
      if (url.pathname === "/api/admin/accounts/restore" && request.method === "POST") {
        return handleRestoreAccount(request, session, env, cors.headers);
      }
      if (url.pathname === "/api/admin/accounts/removed" && request.method === "GET") {
        return handleRemovedAccountsList(session, env, cors.headers);
      }
      if (url.pathname === "/api/admin/accounts/classification" && request.method === "POST") {
        return handleSetClassification(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/admin/buildings/delete-requests" && request.method === "GET") {
        return handleDeleteRequestsList(session, env, cors.headers);
      }
      if (url.pathname === "/api/admin/buildings/delete-requests/approve" && request.method === "POST") {
        return handleApproveDeleteRequest(request, session, env, cors.headers);
      }
      if (url.pathname === "/api/admin/buildings/delete-requests/deny" && request.method === "POST") {
        return handleDenyDeleteRequest(request, session, env, cors.headers);
      }
      if (url.pathname === "/api/admin/buildings/deleted" && request.method === "GET") {
        return handleDeletedBuildingsList(session, env, cors.headers);
      }
      if (url.pathname === "/api/admin/buildings/restore" && request.method === "POST") {
        return handleRestoreBuilding(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/inspections/today" && request.method === "GET") {
        if (session.role !== "superintendent") {
          return json({ error: "Superintendent access required" }, 403, cors.headers);
        }
        return handleInspectionToday(session, env, cors.headers);
      }

      if (url.pathname === "/api/inspections/save" && request.method === "POST") {
        if (session.role !== "superintendent") {
          return json({ error: "Superintendent access required" }, 403, cors.headers);
        }
        return handleInspectionSave(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/inspections/submit" && request.method === "POST") {
        if (session.role !== "superintendent") {
          return json({ error: "Superintendent access required" }, 403, cors.headers);
        }
        return handleInspectionSubmit(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/inspections/flag-issue" && request.method === "POST") {
        if (session.role !== "superintendent") {
          return json({ error: "Superintendent access required" }, 403, cors.headers);
        }
        return handleFlagIssue(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/work-orders" && request.method === "GET") {
        if (session.role !== "regional_manager" && session.role !== "admin") {
          return json({ error: "Area Manager or Administrator access required" }, 403, cors.headers);
        }
        return handleManagerWorkOrders(session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/work-orders/resolve" && request.method === "POST") {
        if (session.role !== "regional_manager" && session.role !== "admin") {
          return json({ error: "Area Manager or Administrator access required" }, 403, cors.headers);
        }
        return handleResolveWorkOrder(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/inspections/photo" && request.method === "POST") {
        if (session.role !== "superintendent") {
          return json({ error: "Superintendent access required" }, 403, cors.headers);
        }
        return handleInspectionPhoto(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/inspections/command-photo" && request.method === "POST") {
        if (session.role !== "superintendent") {
          return json({ error: "Superintendent access required" }, 403, cors.headers);
        }
        return handleCommandModePhoto(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/inspections/group-photo" && request.method === "POST") {
        if (session.role !== "superintendent") {
          return json({ error: "Superintendent access required" }, 403, cors.headers);
        }
        return handleGroupPhotoUpload(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/inspection" && request.method === "GET") {
        if (session.role !== "regional_manager" && session.role !== "admin") {
          return json({ error: "Area Manager or Administrator access required" }, 403, cors.headers);
        }
        return handleManagerInspection(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/parameters" && request.method === "POST") {
        if (session.role !== "regional_manager" && session.role !== "admin") {
          return json({ error: "Area Manager or Administrator access required" }, 403, cors.headers);
        }
        return handleManagerParametersSave(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/buildings" && request.method === "GET") {
        if (session.role !== "regional_manager" && session.role !== "admin") {
          return json({ error: "Area Manager or Administrator access required" }, 403, cors.headers);
        }
        return handleBuildingsList(session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/buildings" && request.method === "POST") {
        if (session.role !== "regional_manager" && session.role !== "admin") {
          return json({ error: "Area Manager or Administrator access required" }, 403, cors.headers);
        }
        return handleBuildingCreate(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/superintendents/unassigned" && request.method === "GET") {
        if (session.role !== "regional_manager" && session.role !== "admin") {
          return json({ error: "Area Manager or Administrator access required" }, 403, cors.headers);
        }
        return handleUnassignedSuperintendents(session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/buildings/assign" && request.method === "POST") {
        if (session.role !== "regional_manager" && session.role !== "admin") {
          return json({ error: "Area Manager or Administrator access required" }, 403, cors.headers);
        }
        return handleAssignSuperintendent(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/superintendents/assignable" && request.method === "GET") {
        if (session.role !== "regional_manager" && session.role !== "admin") {
          return json({ error: "Area Manager or Administrator access required" }, 403, cors.headers);
        }
        return handleAssignableSuperintendents(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/superintendents/remove" && request.method === "POST") {
        if (session.role !== "regional_manager" && session.role !== "admin") {
          return json({ error: "Area Manager or Administrator access required" }, 403, cors.headers);
        }
        return handleRemoveSuperintendent(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/tags/generate" && request.method === "POST") {
        if (session.role !== "regional_manager" && session.role !== "admin") {
          return json({ error: "Area Manager or Administrator access required" }, 403, cors.headers);
        }
        return handleGenerateTags(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/tags/save" && request.method === "POST") {
        if (session.role !== "regional_manager" && session.role !== "admin") {
          return json({ error: "Area Manager or Administrator access required" }, 403, cors.headers);
        }
        return handleSaveTags(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/buildings/push-live" && request.method === "POST") {
        if (session.role !== "regional_manager" && session.role !== "admin") {
          return json({ error: "Area Manager or Administrator access required" }, 403, cors.headers);
        }
        return handlePushLive(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/buildings/delete" && request.method === "POST") {
        if (session.role !== "regional_manager" && session.role !== "admin") {
          return json({ error: "Area Manager or Administrator access required" }, 403, cors.headers);
        }
        return handleDeleteBuilding(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/buildings/delete-cancel" && request.method === "POST") {
        if (session.role !== "regional_manager" && session.role !== "admin") {
          return json({ error: "Area Manager or Administrator access required" }, 403, cors.headers);
        }
        return handleCancelDeleteRequest(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/buildings/update" && request.method === "POST") {
        if (session.role !== "regional_manager" && session.role !== "admin") {
          return json({ error: "Area Manager or Administrator access required" }, 403, cors.headers);
        }
        return handleUpdateBuilding(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/buildings/detail" && request.method === "GET") {
        if (session.role !== "regional_manager" && session.role !== "admin") {
          return json({ error: "Area Manager or Administrator access required" }, 403, cors.headers);
        }
        return handleBuildingDetail(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/notices/create" && request.method === "POST") {
        if (session.role !== "regional_manager" && session.role !== "admin") {
          return json({ error: "Area Manager or Administrator access required" }, 403, cors.headers);
        }
        return handleCreateNotice(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/notices/delete" && request.method === "POST") {
        if (session.role !== "regional_manager" && session.role !== "admin") {
          return json({ error: "Area Manager or Administrator access required" }, 403, cors.headers);
        }
        return handleDeleteNotice(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/work-orders/assignable" && request.method === "GET") {
        if (session.role !== "regional_manager" && session.role !== "admin") {
          return json({ error: "Area Manager or Administrator access required" }, 403, cors.headers);
        }
        return handleAssignableUsers(session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/work-orders/assign" && request.method === "POST") {
        if (session.role !== "regional_manager" && session.role !== "admin") {
          return json({ error: "Area Manager or Administrator access required" }, 403, cors.headers);
        }
        return handleAssignWorkOrder(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/locations" && request.method === "GET") {
        if (session.role !== "regional_manager" && session.role !== "admin") {
          return json({ error: "Area Manager or Administrator access required" }, 403, cors.headers);
        }
        return handleListLocations(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/locations/create" && request.method === "POST") {
        if (session.role !== "regional_manager" && session.role !== "admin") {
          return json({ error: "Area Manager or Administrator access required" }, 403, cors.headers);
        }
        return handleCreateLocation(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/locations/delete" && request.method === "POST") {
        if (session.role !== "regional_manager" && session.role !== "admin") {
          return json({ error: "Area Manager or Administrator access required" }, 403, cors.headers);
        }
        return handleDeleteLocation(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/tags/location" && request.method === "POST") {
        if (session.role !== "regional_manager" && session.role !== "admin") {
          return json({ error: "Area Manager or Administrator access required" }, 403, cors.headers);
        }
        return handleAssignTagLocation(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/groups" && request.method === "GET") {
        if (session.role !== "regional_manager" && session.role !== "admin") {
          return json({ error: "Area Manager or Administrator access required" }, 403, cors.headers);
        }
        return handleListGroups(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/groups/create" && request.method === "POST") {
        if (session.role !== "regional_manager" && session.role !== "admin") {
          return json({ error: "Area Manager or Administrator access required" }, 403, cors.headers);
        }
        return handleCreateGroup(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/groups/delete" && request.method === "POST") {
        if (session.role !== "regional_manager" && session.role !== "admin") {
          return json({ error: "Area Manager or Administrator access required" }, 403, cors.headers);
        }
        return handleDeleteGroup(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/tags/group" && request.method === "POST") {
        if (session.role !== "regional_manager" && session.role !== "admin") {
          return json({ error: "Area Manager or Administrator access required" }, 403, cors.headers);
        }
        return handleAssignTagGroup(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/tags/update" && request.method === "POST") {
        if (session.role !== "regional_manager" && session.role !== "admin") {
          return json({ error: "Area Manager or Administrator access required" }, 403, cors.headers);
        }
        return handleUpdateTag(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/groups/assign-location" && request.method === "POST") {
        if (session.role !== "regional_manager" && session.role !== "admin") {
          return json({ error: "Area Manager or Administrator access required" }, 403, cors.headers);
        }
        return handleAssignGroupLocation(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/groups/rename" && request.method === "POST") {
        if (session.role !== "regional_manager" && session.role !== "admin") {
          return json({ error: "Area Manager or Administrator access required" }, 403, cors.headers);
        }
        return handleRenameGroup(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/roms" && request.method === "GET") {
        if (session.role !== "regional_manager" && session.role !== "admin") {
          return json({ error: "Area Manager or Administrator access required" }, 403, cors.headers);
        }
        return handleListRoms(session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/buildings/sharing" && request.method === "GET") {
        if (session.role !== "regional_manager" && session.role !== "admin") {
          return json({ error: "Area Manager or Administrator access required" }, 403, cors.headers);
        }
        return handleBuildingSharing(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/buildings/share" && request.method === "POST") {
        if (session.role !== "regional_manager" && session.role !== "admin") {
          return json({ error: "Area Manager or Administrator access required" }, 403, cors.headers);
        }
        return handleShareBuilding(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/buildings/unshare" && request.method === "POST") {
        if (session.role !== "regional_manager" && session.role !== "admin") {
          return json({ error: "Area Manager or Administrator access required" }, 403, cors.headers);
        }
        return handleUnshareBuilding(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/buildings/inspection-history" && request.method === "GET") {
        // A superintendent may also pull this, but only for their own
        // assigned building -- handleInspectionHistory's ownsBuilding()
        // enforces that (buildingId must equal session.building_id).
        if (session.role !== "regional_manager" && session.role !== "admin" && session.role !== "superintendent") {
          return json({ error: "Access required" }, 403, cors.headers);
        }
        return handleInspectionHistory(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/buildings/inspection-detail" && request.method === "GET") {
        if (session.role !== "regional_manager" && session.role !== "admin" && session.role !== "superintendent") {
          return json({ error: "Access required" }, 403, cors.headers);
        }
        return handleInspectionDetail(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/superintendents" && request.method === "GET") {
        if (session.role !== "regional_manager" && session.role !== "admin") {
          return json({ error: "Area Manager or Administrator access required" }, 403, cors.headers);
        }
        return handleManagerSuperintendents(session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/pending-requests" && request.method === "GET") {
        if (session.role !== "regional_manager" && session.role !== "admin") {
          return json({ error: "Area Manager or Administrator access required" }, 403, cors.headers);
        }
        return handlePendingRequests(session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/pending-requests/approve" && request.method === "POST") {
        if (session.role !== "regional_manager" && session.role !== "admin") {
          return json({ error: "Area Manager or Administrator access required" }, 403, cors.headers);
        }
        return handlePendingRequestDecision(request, session, env, cors.headers, true);
      }

      if (url.pathname === "/api/manager/pending-requests/deny" && request.method === "POST") {
        if (session.role !== "regional_manager" && session.role !== "admin") {
          return json({ error: "Area Manager or Administrator access required" }, 403, cors.headers);
        }
        return handlePendingRequestDecision(request, session, env, cors.headers, false);
      }

      if (url.pathname === "/api/property/inspections" && request.method === "GET") {
        if (session.role !== "property_manager") {
          return json({ error: "Property Manager access required" }, 403, cors.headers);
        }
        return handlePropertyInspections(request, session, env, cors.headers);
      }

      return json({ error: "Not found" }, 404, cors.headers);
    } catch (error) {
      console.error("Request failed", error);
      return json({ error: "Something went wrong" }, 500, cors.headers);
    }
  },

  // Cloudflare cron triggers run on a fixed UTC schedule (wrangler.toml),
  // and a fixed UTC time drifts against Toronto's clock across DST -- so
  // this fires daily and just no-ops on every day that isn't actually
  // Friday in Toronto, rather than trying to express "Friday Toronto time"
  // as a UTC cron expression directly.
  async scheduled(event, env, ctx) {
    // Runs every day (unlike the digest below): anything an admin
    // soft-deleted more than 30 days ago gets permanently purged.
    ctx.waitUntil(
      purgeExpiredBuildings(env).catch((error) => console.error("Building purge cron failed", error)),
    );

    const todayToronto = new Date().toLocaleDateString("en-US", { timeZone: "America/Toronto", weekday: "short" });
    if (todayToronto !== "Fri") return;
    ctx.waitUntil(
      sendWeeklyDigest(env).catch((error) => console.error("Weekly digest cron failed", error)),
    );
  },
};

async function handleLogin(request, env, corsHeaders) {
  const body = await readJson(request);
  const username = String(body.username || "").trim();
  const password = String(body.password || "");

  if (!username || !password) {
    return json({ error: "Username and password are required" }, 400, corsHeaders);
  }

  // The agency (Lucas's cross-company) account is checked first -- it's a
  // separate identity, not a row in any one company's own database.
  const agencyResult = await tryAgencyLogin(request, env, username, password, corsHeaders);
  if (agencyResult) return agencyResult;

  // Otherwise, resolve which company this username belongs to before
  // touching any app data -- a brand new company's users don't live in
  // this Worker's static "DB" binding at all.
  const clientId = await clientForIdentifier(env, username);
  if (!clientId) return json({ error: "Invalid username or password" }, 401, corsHeaders);
  const resolved = await dbForClient(env, clientId);
  if (!resolved) return json({ error: "Invalid username or password" }, 401, corsHeaders);
  const { client, db } = resolved;

  // Look up by username regardless of is_active — a pending/denied account
  // still needs to verify its password before we say anything about status,
  // so a wrong-password guess against a real email doesn't confirm it exists.
  const user = await db.prepare(
    `SELECT id, username, password_hash, password_salt, full_name, job_title, role, region, building_access, status, email, last_2fa_verified_at, ghl_contact_id, is_active, removed_at, classification
     FROM users WHERE username = ?`,
  )
    .bind(username)
    .first();

  const valid = user
    ? await verifyPassword(password, user.password_salt, user.password_hash)
    : false;

  if (!valid) return json({ error: "Invalid username or password" }, 401, corsHeaders);
  user.client_id = client.id;

  if (user.status === "pending") {
    return json({ error: "Your account is still pending approval from your operations manager." }, 403, corsHeaders);
  }
  if (user.status === "denied") {
    return json({ error: "Your registration request was not approved. Contact your operations manager." }, 403, corsHeaders);
  }
  // Admin-removed profile -- password is still valid (it's not a wrong
  // guess), but the account itself no longer has access.
  if (!user.is_active || user.removed_at) {
    return json({ error: "This account has been removed. Contact your administrator." }, 403, corsHeaders);
  }

  // Accounts seeded before self-registration existed (admin, alex.kim, ...)
  // have no email on file -- there's nowhere to send a code, so this can't
  // lock them out. Anyone who actually registered always has a real email.
  const hasEmail = user.email || user.username.includes("@");
  if (hasEmail && needsVerification(user)) {
    try {
      const rawPendingToken = await sendVerificationCode(env, db, user);
      // The client_id prefix lets handleVerifyCode find the right company
      // database again -- a bare pending token doesn't say which one.
      return json({ requiresVerification: true, pendingToken: `${client.id}.${rawPendingToken}` }, 200, corsHeaders);
    } catch (error) {
      console.error("2FA send failed", error);
      return json({ error: "Couldn't send your verification code. Try again in a moment." }, 502, corsHeaders);
    }
  }

  return createSessionForUser(request, env, db, client.id, user, corsHeaders);
}

async function handleVerifyCode(request, env, corsHeaders) {
  const body = await readJson(request);
  const pendingToken = String(body.pendingToken || "");
  const code = String(body.code || "");
  if (!pendingToken || !code) return json({ error: "A code is required." }, 400, corsHeaders);

  const dot = pendingToken.indexOf(".");
  const clientId = dot === -1 ? NaN : Number.parseInt(pendingToken.slice(0, dot), 10);
  const rawToken = dot === -1 ? "" : pendingToken.slice(dot + 1);
  const resolved = Number.isInteger(clientId) ? await dbForClient(env, clientId) : null;
  if (!resolved) return json({ error: "That verification link has expired. Sign in again." }, 401, corsHeaders);
  const { client, db } = resolved;

  const result = await verifyCode(db, rawToken, code);
  if (!result.ok) return json({ error: result.error }, 401, corsHeaders);

  const user = await db.prepare(
    `SELECT id, username, full_name, job_title, role, region, building_id, building_access, status, classification FROM users WHERE id = ?`,
  )
    .bind(result.userId)
    .first();
  if (!user) return json({ error: "Account not found." }, 404, corsHeaders);

  return createSessionForUser(request, env, db, client.id, user, corsHeaders);
}

async function createSessionForUser(request, env, db, clientId, user, corsHeaders) {
  const token = createSessionToken();
  const tokenHash = await hashToken(token);
  const ttlHours = Math.max(1, Number.parseInt(env.SESSION_TTL_HOURS || "12", 10));
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();

  await db.batch([
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(new Date().toISOString()),
    db.prepare(
      "INSERT INTO sessions (token_hash, user_id, actor_user_id, expires_at) VALUES (?, ?, ?, ?)",
    ).bind(tokenHash, user.id, user.id, expiresAt),
  ]);

  user.client_id = clientId;
  const headers = new Headers(corsHeaders);
  // The cookie value carries which company this session belongs to
  // (clientId.token) -- requireSession needs that to know which
  // database to even look the token up in.
  headers.set("Set-Cookie", sessionCookie(request, `${clientId}.${token}`, ttlHours * 60 * 60));
  return json(
    {
      user: publicUser(user),
      actor: publicUser(user),
      isImpersonating: false,
    },
    200,
    headers,
  );
}

// The agency account lives in the control-plane database, entirely
// separate from any one company's users -- it's the one identity that
// needs to reach across every company. Returns a Response if `username`
// matched an agency account (right or wrong password), or null so the
// caller falls through to the normal per-company login.
async function tryAgencyLogin(request, env, username, password, corsHeaders) {
  const agencyUser = await env.CONTROL_DB.prepare(
    "SELECT id, username, password_hash, password_salt, full_name, is_active FROM agency_users WHERE username = ?",
  )
    .bind(username)
    .first();
  if (!agencyUser) return null;

  const valid = await verifyPassword(password, agencyUser.password_salt, agencyUser.password_hash);
  if (!valid) return json({ error: "Invalid username or password" }, 401, corsHeaders);
  if (!agencyUser.is_active) return json({ error: "This account has been removed." }, 403, corsHeaders);

  const token = createSessionToken();
  const tokenHash = await hashToken(token);
  const ttlHours = 12;
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();

  await env.CONTROL_DB.batch([
    env.CONTROL_DB.prepare("DELETE FROM agency_sessions WHERE expires_at <= ?").bind(new Date().toISOString()),
    env.CONTROL_DB.prepare(
      "INSERT INTO agency_sessions (token_hash, agency_user_id, expires_at, last_seen_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)",
    ).bind(tokenHash, agencyUser.id, expiresAt),
  ]);

  const headers = new Headers(corsHeaders);
  headers.set("Set-Cookie", sessionCookie(request, token, ttlHours * 60 * 60, "plc_agency_session"));
  return json(
    {
      user: { id: null, username: agencyUser.username, fullName: agencyUser.full_name, role: "agency", roleLabel: "Agency", isAgency: true },
      actor: { id: null, username: agencyUser.username, fullName: agencyUser.full_name, role: "agency", roleLabel: "Agency", isAgency: true },
      isImpersonating: false,
      activeClientId: null,
    },
    200,
    headers,
  );
}

async function handleLogout(request, env, corsHeaders) {
  const headers = new Headers(corsHeaders);
  const agencyToken = readCookie(request, "plc_agency_session");
  if (agencyToken) {
    await env.CONTROL_DB.prepare("DELETE FROM agency_sessions WHERE token_hash = ?")
      .bind(await hashToken(agencyToken))
      .run();
    headers.append("Set-Cookie", clearSessionCookie(request, "plc_agency_session"));
  }

  const raw = readCookie(request, "fhg_session");
  if (raw) {
    const dot = raw.indexOf(".");
    const clientId = dot === -1 ? NaN : Number.parseInt(raw.slice(0, dot), 10);
    const token = dot === -1 ? "" : raw.slice(dot + 1);
    const resolved = Number.isInteger(clientId) ? await dbForClient(env, clientId) : null;
    if (resolved && token) {
      await resolved.db.prepare("DELETE FROM sessions WHERE token_hash = ?")
        .bind(await hashToken(token))
        .run();
    }
    headers.append("Set-Cookie", clearSessionCookie(request));
  }

  return json({ ok: true }, 200, headers);
}

async function handleAccounts(session, env, corsHeaders) {
  if (session.actor_role !== "admin") {
    return json({ error: "Administrator access required" }, 403, corsHeaders);
  }

  const result = await env.DB.prepare(
    `SELECT id, username, full_name, job_title, role, region, classification
     FROM users WHERE is_active = 1 AND role != 'admin'
     ORDER BY CASE role
       WHEN 'regional_manager' THEN 1
       WHEN 'superintendent' THEN 2
       ELSE 3 END, full_name`,
  ).all();

  return json(
    { accounts: result.results.map((u) => ({ ...publicUser(u), classification: u.classification || "standard" })) },
    200,
    corsHeaders,
  );
}

async function handleImpersonate(request, session, env, corsHeaders) {
  // Admin can switch into any account. A Regional Manager can only switch
  // into a Superintendent within their own region — not another manager,
  // not a Property Manager, not anyone outside the buildings they oversee.
  const isAdmin = session.actor_role === "admin";
  const isManager = session.actor_role === "regional_manager";
  if (!isAdmin && !isManager) {
    return json({ error: "Not permitted" }, 403, corsHeaders);
  }
  // The agency account, viewing a company, is synthesized (id -1) rather
  // than a real row in that company's own users table -- there's no
  // session row to hand off to an impersonated account and back the way
  // a real admin's session works, so this would silently no-op rather
  // than actually switch (see the detailed note on requireAgencySession).
  // Fail loudly here instead of letting the UI hang waiting for a
  // dashboard that never changes.
  if (session.isAgency) {
    return json({ error: "The agency account can't open individual accounts yet — ask that company's own admin." }, 403, corsHeaders);
  }

  const body = await readJson(request);
  const userId = Number.parseInt(body.userId, 10);

  const target = isAdmin
    ? await env.DB.prepare(
        `SELECT id, username, full_name, job_title, role, region
         FROM users WHERE id = ? AND is_active = 1 AND role != 'admin'`,
      )
        .bind(userId)
        .first()
    : await env.DB.prepare(
        `SELECT id, username, full_name, job_title, role, region
         FROM users WHERE id = ? AND is_active = 1 AND role = 'superintendent' AND region = ?`,
      )
        .bind(userId, session.actor_region)
        .first();

  if (!target) return json({ error: "Account not found" }, 404, corsHeaders);

  await env.DB.prepare("UPDATE sessions SET user_id = ?, last_seen_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(target.id, session.session_id)
    .run();

  return json(
    {
      user: publicUser(target),
      actor: actorUser(session),
      isImpersonating: true,
    },
    200,
    corsHeaders,
  );
}

async function handleAdminReturn(session, env, corsHeaders) {
  if (session.actor_role !== "admin" && session.actor_role !== "regional_manager") {
    return json({ error: "Not permitted" }, 403, corsHeaders);
  }
  // See the matching guard in handleImpersonate -- an agency session was
  // never actually impersonating anyone (that call is rejected up front),
  // so there's nothing real to "return" from here either.
  if (session.isAgency) {
    return json({ error: "Not permitted" }, 403, corsHeaders);
  }

  await env.DB.prepare("UPDATE sessions SET user_id = actor_user_id, last_seen_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(session.session_id)
    .run();

  const actor = actorUser(session);
  return json({ user: actor, actor, isImpersonating: false }, 200, corsHeaders);
}

const INACTIVITY_LIMIT_MS = 60 * 60 * 1000;

async function requireSession(request, env) {
  const agencyToken = readCookie(request, "plc_agency_session");
  if (agencyToken) return requireAgencySession(agencyToken, env);

  const raw = readCookie(request, "fhg_session");
  if (!raw) return null;
  const dot = raw.indexOf(".");
  if (dot === -1) return null;
  const clientId = Number.parseInt(raw.slice(0, dot), 10);
  const token = raw.slice(dot + 1);
  if (!Number.isInteger(clientId) || !token) return null;

  const resolved = await dbForClient(env, clientId);
  if (!resolved) return null;
  const { db } = resolved;

  const session = await db.prepare(
    `SELECT s.id AS session_id, s.expires_at, s.last_seen_at,
       u.id, u.username, u.full_name, u.job_title, u.role, u.region, u.building_id, u.building_access, u.classification, u.client_id,
       actor.id AS actor_id, actor.username AS actor_username,
       actor.full_name AS actor_full_name, actor.job_title AS actor_job_title,
       actor.role AS actor_role, actor.region AS actor_region, actor.building_access AS actor_building_access
     FROM sessions s
     JOIN users u ON u.id = s.user_id AND u.is_active = 1
     JOIN users actor ON actor.id = s.actor_user_id AND actor.is_active = 1
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(await hashToken(token), new Date().toISOString())
    .first();
  if (!session) return null;

  // Inactivity timeout: even within the absolute session lifetime, an hour
  // with no requests locks the account out and requires signing back in.
  const idleMs = Date.now() - new Date(session.last_seen_at + "Z").getTime();
  if (idleMs > INACTIVITY_LIMIT_MS) {
    await db.prepare("DELETE FROM sessions WHERE id = ?").bind(session.session_id).run();
    return null;
  }

  await db.prepare("UPDATE sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(session.session_id)
    .run();

  // session.client_id (selected above) is the LOCAL self-id inside this
  // company's own database -- always 1 by construction (see
  // provisionCompanyDatabase) -- and that's what effectiveClientId /
  // clientScopeSql throughout worker/*.js correctly compares against,
  // since that's the only company's data this database even contains.
  // clientId (from the cookie) is the separate control-plane id, used
  // only to have picked the right `db` above and to tell the frontend
  // which real company this is -- it must never be written onto
  // session.client_id, which single-database-per-company code relies on
  // staying local (an earlier draft of this code did exactly that and it
  // silently broke every company except Forest Hill Group's, whose two
  // ids happen to coincidentally both be 1).
  session.companyId = clientId;
  session.__db = db;
  return session;
}

// The agency account (Lucas, overseeing every company) lives in the
// control-plane database, not inside any one company's own users table.
// With no company selected yet, the returned session's role ("agency")
// doesn't satisfy any existing handler's role check, which is exactly
// the "pick a company first" gate the broad view needs. Once a company
// IS selected (see handleSwitchClient in worker/clients.js), this
// synthesizes a session that looks exactly like that company's own
// admin, so every existing handler works completely unchanged -- id -1
// is a sentinel for "the agency account", since there's no real row for
// it in that company's own users table.
async function requireAgencySession(token, env) {
  const row = await env.CONTROL_DB.prepare(
    `SELECT s.id AS session_id, s.expires_at, s.last_seen_at, s.active_client_id,
       a.id AS agency_user_id, a.username, a.full_name, a.is_active
     FROM agency_sessions s JOIN agency_users a ON a.id = s.agency_user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(await hashToken(token), new Date().toISOString())
    .first();
  if (!row || !row.is_active) return null;

  const idleMs = Date.now() - new Date(row.last_seen_at + "Z").getTime();
  if (idleMs > INACTIVITY_LIMIT_MS) {
    await env.CONTROL_DB.prepare("DELETE FROM agency_sessions WHERE id = ?").bind(row.session_id).run();
    return null;
  }
  await env.CONTROL_DB.prepare("UPDATE agency_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(row.session_id)
    .run();

  const base = {
    isAgency: true,
    agencyUserId: row.agency_user_id,
    session_id: row.session_id,
    username: row.username,
    full_name: row.full_name,
  };

  if (row.active_client_id == null) {
    return {
      ...base,
      id: null,
      role: "agency",
      actor_id: null,
      actor_username: row.username,
      actor_full_name: row.full_name,
      actor_role: "agency",
      client_id: null,
      companyId: null,
    };
  }

  const resolved = await dbForClient(env, row.active_client_id);
  if (!resolved) {
    // The company they were inside got suspended/removed since they
    // switched into it -- fall back to the broad view rather than error.
    await env.CONTROL_DB.prepare("UPDATE agency_sessions SET active_client_id = NULL WHERE id = ?")
      .bind(row.session_id)
      .run();
    return requireAgencySession(token, env);
  }

  return {
    ...base,
    id: -1,
    job_title: "Agency",
    role: "admin",
    region: null,
    building_id: null,
    building_access: "all",
    classification: "standard",
    // Local self-id inside the target company's own database, not the
    // control-plane id -- see the matching comment in requireSession.
    client_id: 1,
    actor_id: -1,
    actor_username: row.username,
    actor_full_name: row.full_name,
    actor_job_title: "Agency",
    actor_role: "admin",
    actor_region: null,
    actor_building_access: "all",
    companyId: row.active_client_id,
    __db: resolved.db,
  };
}

function sessionPayload(session) {
  return {
    user: publicUser(session),
    actor: actorUser(session),
    isImpersonating: session.id !== session.actor_id,
    isAgency: session.isAgency === true,
    // The real, control-plane company id -- which company (if any) this
    // session is currently looking at. Switchable for the agency account
    // (see worker/clients.js); everyone else is always looking at their
    // own home company. Not the same as user.clientId below, which is
    // always the harmless-but-meaningless local id (1) inside whichever
    // company database this request resolved to.
    activeClientId: session.companyId ?? null,
  };
}

function displayRoleLabel(role, buildingAccess) {
  if (role === "regional_manager" && buildingAccess === "all") return "Operations Manager";
  return roleLabels[role];
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    fullName: user.full_name,
    jobTitle: user.job_title,
    role: user.role,
    buildingAccess: user.building_access || "own",
    roleLabel: displayRoleLabel(user.role, user.building_access),
    region: user.region,
    classification: user.classification || "standard",
    clientId: user.companyId ?? user.client_id ?? null,
  };
}

function actorUser(session) {
  return publicUser({
    id: session.actor_id,
    username: session.actor_username,
    full_name: session.actor_full_name,
    job_title: session.actor_job_title,
    role: session.actor_role,
    region: session.actor_region,
    building_access: session.actor_building_access,
  });
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const allowedOrigins = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const allowed = !origin || allowedOrigins.includes(origin);
  const headers = new Headers({
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    Vary: "Origin",
  });
  if (origin && allowed) headers.set("Access-Control-Allow-Origin", origin);
  return { allowed, headers };
}

async function readJson(request) {
  if (!request.headers.get("Content-Type")?.includes("application/json")) return {};
  return request.json();
}

function json(data, status = 200, headers = {}) {
  const responseHeaders = new Headers(headers);
  for (const [key, value] of Object.entries(JSON_HEADERS)) responseHeaders.set(key, value);
  responseHeaders.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { status, headers: responseHeaders });
}
