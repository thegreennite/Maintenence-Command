// Schedules: managers upload a paper/PDF/text schedule, the AI turns it into
// an online one, and cleaners / superintendents work through today's checklist
// -- checking a task off asks for a general photo, then detail photos, as
// proof. This module owns its own state and talks to /api/manager/schedules*,
// /api/manager/staff* and /api/schedule/*; main.js only hands it a few
// helpers (see createSchedules) and calls the render / load functions.

import { duplicateCount, mergeDuplicateTasks } from "../shared/task-dedupe.js";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const MAX_FILES = 10;

const clock = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || "");
  if (!m) return "";
  const h = Number(m[1]);
  return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
};

const windowText = (start, end) => (start && end ? `${clock(start)} – ${clock(end)}` : start ? `from ${clock(start)}` : end ? `by ${clock(end)}` : "Any time");

function daysText(days) {
  const list = Array.isArray(days) ? days : String(days || "").split(",").filter(Boolean);
  if (list.length === 7) return "Every day";
  if (list.length === 5 && WEEKDAYS.every((d) => list.includes(d))) return "Mon–Fri";
  if (list.length === 2 && list.includes("Sat") && list.includes("Sun")) return "Weekends";
  return list.join(", ");
}

const roleName = (kind) => (kind === "cleaner" ? "Cleaner" : "Superintendent");
const personLabel = (p) => `${p.fullName}${p.designation ? ` · ${p.designation}` : ""}`;

let uidCounter = 0;
const blankTask = () => ({ uid: ++uidCounter, title: "", details: "", location: "", days: [...WEEKDAYS], startTime: "", endTime: "", enforce: "default", general: "", detail: "" });

function taskFromApi(t) {
  return {
    uid: ++uidCounter,
    id: t.id,
    title: t.title || "",
    details: t.details || "",
    location: t.location || "",
    days: Array.isArray(t.days) ? t.days : String(t.days || "").split(",").filter(Boolean),
    startTime: t.start_time || t.startTime || "",
    endTime: t.end_time || t.endTime || "",
    enforce: t.enforce_times === true ? "yes" : t.enforce_times === false ? "no" : "default",
    general: t.general_photos ?? "",
    detail: t.detail_photos ?? "",
  };
}

function taskToApi(t) {
  return {
    id: t.id || undefined,
    title: t.title,
    details: t.details,
    location: t.location,
    days: t.days,
    startTime: t.startTime || null,
    endTime: t.endTime || null,
    enforceTimes: t.enforce === "yes" ? true : t.enforce === "no" ? false : null,
    generalPhotos: t.general === "" ? null : Number(t.general),
    detailPhotos: t.detail === "" ? null : Number(t.detail),
  };
}

export function createSchedules(deps) {
  const { request, escapeHtml: esc, icon, rerender, getBuildings, photoUrl, photoMeta, prepareSheetPage, getGeolocation, liveCaptureTime, queueScroll } = deps;

  const S = {
    open: false,
    lockedBuilding: null, // set while embedded on one building's page
    lockedBuildingName: "",
    tab: "schedules",
    buildingId: null,
    loading: false,
    loadedFor: null,
    error: "",
    notice: null, // {type: "ok" | "err", text}
    schedules: [],
    staff: [],
    presets: { cleaner: [], superintendent: [] },
    staffEdits: {},
    draft: null,
    proof: { date: null, data: null, loading: false, error: "" },
    mine: null,
    work: { taskId: null, busy: false, error: "", note: "" },
    justDone: null,
  };
  const previews = new Map();
  const previewUrl = (file) => {
    if (!file.type.startsWith("image/")) return null;
    if (!previews.has(file)) previews.set(file, URL.createObjectURL(file));
    return previews.get(file);
  };
  const clearPreviews = () => {
    for (const url of previews.values()) URL.revokeObjectURL(url);
    previews.clear();
  };

  const setNotice = (type, text) => {
    S.notice = { type, text };
    queueScroll("#sch-notice");
  };

  // ---------- manager: loading ----------
  function activeBuildings() {
    return (getBuildings() || []).filter((b) => b.status === "active");
  }

  async function loadBuilding() {
    const buildings = activeBuildings();
    if (S.lockedBuilding != null) S.buildingId = S.lockedBuilding;
    else {
      if (!buildings.length) return;
      if (!buildings.some((b) => b.id === S.buildingId)) S.buildingId = buildings[0].id;
    }
    S.loading = true;
    S.error = "";
    rerender();
    try {
      const [schedules, staff] = await Promise.all([
        request(`/manager/schedules?buildingId=${S.buildingId}`),
        request(`/manager/staff?buildingId=${S.buildingId}`),
      ]);
      S.schedules = schedules.schedules;
      S.staff = staff.staff;
      S.presets = staff.presets || S.presets;
      S.staffEdits = {};
      S.loadedFor = S.buildingId;
      if (S.tab === "proof") await loadProof(false);
    } catch (error) {
      S.error = error.message;
      S.loadedFor = S.buildingId; // show the error instead of retrying forever
    }
    S.loading = false;
    rerender();
  }

  async function loadProof(render = true) {
    S.proof.loading = true;
    S.proof.error = "";
    if (render) rerender();
    try {
      S.proof.data = await request(`/manager/schedules/completions?buildingId=${S.buildingId}${S.proof.date ? `&date=${S.proof.date}` : ""}`);
      S.proof.date = S.proof.data.date;
    } catch (error) {
      S.proof.error = error.message;
    }
    S.proof.loading = false;
    if (render) rerender();
  }

  // ---------- manager: rendering ----------
  function renderManagerCard({ embedded = false } = {}) {
    const buildings = activeBuildings();
    const locked = S.lockedBuilding != null;
    const open = embedded || S.open;
    const body = !open
      ? ""
      : !buildings.length && !locked
        ? `<p class="empty-state sch-pad">Register and activate a building first — schedules belong to a building.</p>`
        : `<div class="sch-body">
            ${
              locked
                ? ""
                : buildings.length > 1
                ? `<label class="inspection-field sch-building"><span>Building</span>
                    <select data-sch-f="building">${buildings.map((b) => `<option value="${b.id}" ${b.id === S.buildingId ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select></label>`
                : `<p class="quiet-label sch-building-name">${esc(buildings[0].name)}</p>`
            }
            <div class="sch-tabs" role="tablist">
              ${[["schedules", "Schedules"], ["proof", "Proof of work"], ["team", "Team"]]
                .map(([id, label]) => `<button type="button" role="tab" class="sch-tab ${S.tab === id ? "is-active" : ""}" aria-selected="${S.tab === id}" data-sch-act="tab" data-tab="${id}">${label}</button>`)
                .join("")}
            </div>
            ${S.notice ? `<p id="sch-notice" class="sch-notice sch-notice--${S.notice.type}" role="${S.notice.type === "err" ? "alert" : "status"}">${esc(S.notice.text)}</p>` : ""}
            ${S.error ? `<p class="form-error" role="alert">${esc(S.error)}</p>` : ""}
            ${(S.loadedFor === null && !S.error) || (S.loading && S.loadedFor !== S.buildingId) ? `<p class="sch-loading">Loading…</p>` : S.tab === "schedules" ? renderSchedulesTab() : S.tab === "proof" ? renderProofTab() : renderTeamTab()}
          </div>`;
    if (embedded) return `<section class="sch-card sch-card--embedded" id="sch-card">${body}</section>`;
    return `
      <section class="card sch-card ${S.open ? "is-open" : ""}" id="sch-card" aria-labelledby="sch-title">
        <div class="card__header">
          <div><p class="section-kicker">Schedules</p><h2 id="sch-title">Cleaning &amp; duty schedules</h2></div>
          <button type="button" class="button ${S.open ? "button--outline" : "button--primary"} button--small" data-sch-act="toggle">${S.open ? "Close" : "Open"}</button>
        </div>
        ${S.open ? body : `<p class="parameters-intro sch-pad">Upload a schedule, let the AI build the online version, and see photo proof as each task gets done.</p>`}
      </section>`;
  }

  function renderSchedulesTab() {
    if (S.draft) return renderDraft();
    return `
      <div class="sch-toolbar"><button type="button" class="button button--primary button--small" data-sch-act="new">${icon("plus")} New schedule</button></div>
      ${
        S.schedules.length
          ? S.schedules.map(renderScheduleItem).join("")
          : `<p class="empty-state">No schedules for this building yet. Tap “New schedule” and upload one.</p>`
      }`;
  }

  function renderScheduleItem(s) {
    return `
      <article class="sch-item">
        <div class="sch-item__top">
          <div>
            <strong>${esc(s.name)}</strong>
            <small>${s.tasks.length} task${s.tasks.length === 1 ? "" : "s"} · ${s.enforce_times ? "times enforced" : "times not enforced"} · photos ${s.default_general_photos} general + ${s.default_detail_photos} detail</small>
          </div>
          <div class="sch-item__actions">
            <button type="button" class="button button--outline button--small" data-sch-act="edit" data-id="${s.id}">Edit</button>
            <button type="button" class="button button--outline button--small" data-sch-act="archive" data-id="${s.id}">Archive</button>
          </div>
        </div>
        <div class="sch-chips">${
          s.assignees.length
            ? s.assignees.map((a) => `<span class="sch-chip sch-chip--${a.kind}">${esc(personLabel(a))}</span>`).join("")
            : `<span class="sch-chip sch-chip--warn">Nobody assigned yet</span>`
        }</div>
        <details class="sch-tasklist"><summary>View tasks</summary>
          <ul>${s.tasks
            .map(
              (t) => `<li><strong>${esc(t.title)}</strong><span>${esc(daysText(t.days))} · ${esc(windowText(t.start_time, t.end_time))}${t.location ? ` · ${esc(t.location)}` : ""}${
                (t.enforce_times ?? s.enforce_times) ? " · enforced" : ""
              }</span></li>`,
            )
            .join("")}</ul>
        </details>
      </article>`;
  }

  function renderDraft() {
    const d = S.draft;
    return d.step === "upload" ? renderUploadStep(d) : renderReviewStep(d);
  }

  function renderUploadStep(d) {
    return `
      <div class="sch-wizard" id="sch-wizard">
        <ol class="sch-steps" aria-label="Progress"><li class="is-current"><b>1</b>Upload</li><li><b>2</b>Review &amp; assign</li></ol>
        <h3>Upload the schedule</h3>
        <p class="parameters-intro">Add a photo of the paper schedule, pick photos or PDFs you already have, or paste the text. The AI reads it and builds the online schedule — you'll check it before anyone sees it.</p>
        <div class="sheet-picker">
          <label class="button button--outline sheet-picker__button" for="sch-camera">${icon("camera")} Take a photo</label>
          <label class="button button--outline sheet-picker__button" for="sch-files">${icon("image")} Choose photos or PDFs</label>
        </div>
        <input type="file" accept="image/*" capture="environment" id="sch-camera" data-sch-file hidden />
        <input type="file" accept="image/*,application/pdf" id="sch-files" data-sch-file multiple hidden />
        ${
          d.files.length
            ? `<ul class="sheet-thumbs" aria-label="Pages added">${d.files
                .map((file, i) => {
                  const url = previewUrl(file);
                  return `<li class="sheet-thumb">
                    ${url ? `<img src="${url}" alt="Page ${i + 1}" />` : `<span class="sheet-thumb__pdf">${icon("file")}<b>PDF</b></span>`}
                    <span class="sheet-thumb__label">Page ${i + 1}</span>
                    <button type="button" class="icon-button sheet-thumb__remove" data-sch-act="remove-file" data-index="${i}" title="Remove this page" aria-label="Remove page ${i + 1}">${icon("close")}</button>
                  </li>`;
                })
                .join("")}</ul>`
            : ""
        }
        <label class="inspection-field"><span>…or paste the schedule text <small>(optional)</small></span>
          <textarea rows="4" data-sch-f="text" placeholder="e.g. Lobby floors — Mon/Wed/Fri 6–8 AM&#10;Garbage rooms — daily by 2 PM">${esc(d.text)}</textarea></label>
        <p class="photo-capture__status ${d.notice ? "photo-capture__status--warning" : ""}" id="sch-upload-status">${esc(d.notice)}</p>
        <div class="inspection-actions inspection-actions--split">
          <button type="button" class="button button--outline button--small" data-sch-act="manual">Skip the AI — type it in myself</button>
          <div class="inspection-actions">
            <button type="button" class="button button--outline" data-sch-act="cancel-draft">Cancel</button>
            <button type="button" class="button button--primary" data-sch-act="analyze" ${d.files.length || d.text.trim() ? "" : "disabled"}>Read it with AI</button>
          </div>
        </div>
      </div>`;
  }

  function renderStaffCheckboxes(d) {
    if (!S.staff.length) {
      return `<p class="quiet-label">No cleaners or superintendents are set up for this building yet — add them from the Admin screen, or have them register, then assign them here.</p>`;
    }
    return `<div class="sch-assignees">${S.staff
      .map(
        (p) => `<label class="sch-assignee"><input type="checkbox" data-sch-f="assignee" value="${p.id}" ${d.assigneeIds.includes(p.id) ? "checked" : ""} />
          <span><strong>${esc(p.fullName)}</strong><small>${roleName(p.kind)}${p.designation ? ` · ${esc(p.designation)}` : ""}</small></span></label>`,
      )
      .join("")}</div>`;
  }

  function renderReviewStep(d) {
    const editing = d.mode === "edit";
    return `
      <form class="sch-wizard" id="sch-wizard" data-sch-form>
        ${editing ? "" : `<ol class="sch-steps" aria-label="Progress"><li class="is-done"><b>${icon("check")}</b>Upload</li><li class="is-current"><b>2</b>Review &amp; assign</li></ol>`}
        <h3>${editing ? "Edit schedule" : "Review the schedule"}</h3>
        ${d.aiNote ? `<p class="sch-aihint">${icon("check")} ${esc(d.aiNote)}</p>` : ""}
        <label class="inspection-field"><span>Schedule name</span><input type="text" data-sch-f="name" value="${esc(d.name)}" maxlength="80" required /></label>

        <fieldset class="sch-fieldset">
          <legend>Photo proof &amp; times</legend>
          <div class="sch-defaults">
            <label class="inspection-field"><span>General photos <small>per task</small></span><input type="number" min="0" max="10" inputmode="numeric" data-sch-f="def-general" value="${d.defaults.general}" placeholder="e.g. 1" /></label>
            <label class="inspection-field"><span>Detail photos <small>per task</small></span><input type="number" min="0" max="10" inputmode="numeric" data-sch-f="def-detail" value="${d.defaults.detail}" placeholder="e.g. 3" /></label>
          </div>
          <p class="quiet-label">Photos each person must take to prove a task is done. Leave blank for none — for example, 1 general photo of the whole area and 3 close-ups.</p>
          <label class="sch-switch"><input type="checkbox" data-sch-f="def-enforce" ${d.defaults.enforce ? "checked" : ""} />
            <span><strong>Enforce times</strong><small>On: a task can only be checked off inside its time window. Off: the times are a guide, and finishing late is recorded as late. Each task can override this.</small></span></label>
        </fieldset>

        <fieldset class="sch-fieldset">
          <legend>Who is this for?</legend>
          ${renderStaffCheckboxes(d)}
        </fieldset>

        ${renderTasksSheet(d)}

        <p class="form-error" id="sch-form-error" ${d.error ? "" : "hidden"} role="alert">${esc(d.error || "")}</p>
        <div class="inspection-actions">
          <button type="button" class="button button--outline" data-sch-act="cancel-draft">Cancel</button>
          <button type="submit" class="button button--primary" ${d.busy ? "disabled" : ""}>${d.busy ? "Saving…" : editing ? "Save changes" : "Activate schedule"}</button>
        </div>
      </form>`;
  }

  const DOW = ["M", "T", "W", "T", "F", "S", "S"];

  // What's wrong, if anything, before this can be activated.
  function draftIssues(d) {
    const filled = d.tasks.filter((t) => t.title.trim());
    const dupes = duplicateCount(filled);
    const noDays = filled.filter((t) => !t.days.length).length;
    const needTimes = filled.filter((t) => (t.enforce === "yes" || (t.enforce === "default" && d.defaults.enforce)) && !t.startTime && !t.endTime).length;
    return { dupes, noDays, needTimes, any: dupes + noDays + needTimes > 0 };
  }

  function renderIssuesBanner(d) {
    const issues = draftIssues(d);
    return `${
      issues.any
        ? `<div class="sch-issues" role="status">
            ${issues.dupes ? `<p>${icon("warning")} ${issues.dupes} task${issues.dupes === 1 ? " looks" : "s look"} like a duplicate. <button type="button" class="link-button" data-sch-act="merge-dupes">Merge ${issues.dupes === 1 ? "it" : "them"}</button></p>` : ""}
            ${issues.noDays ? `<p>${icon("warning")} ${issues.noDays} task${issues.noDays === 1 ? " has" : "s have"} no days ticked.</p>` : ""}
            ${issues.needTimes ? `<p>${icon("warning")} ${issues.needTimes} enforced task${issues.needTimes === 1 ? " has" : "s have"} no start or end time.</p>` : ""}
          </div>`
        : d.tasks.length
          ? `<p class="sch-allgood">${icon("check")} Nothing to fix — check the grid against your paper schedule, then activate.</p>`
          : ""
    }`;
  }

  // Edits that don't redraw the page (typing, ticking a day) still keep the warnings honest.
  // Only touches the page when the warnings actually changed -- redrawing a
  // button between mouse-down and mouse-up (typing, then clicking "Merge")
  // would swallow the click.
  let bannerHtml = "";
  function refreshIssues() {
    const slot = document.querySelector("#sch-issues-slot");
    if (!slot || !S.draft) return;
    const html = renderIssuesBanner(S.draft);
    if (html === bannerHtml) return;
    bannerHtml = html;
    slot.innerHTML = html;
  }

  function renderTasksSheet(d) {
    const allSelected = d.tasks.length > 0 && d.selected.length === d.tasks.length;
    return `
      <div class="sch-tasks">
        <p class="admin-subhead">Tasks <span class="quiet-label">· ${d.tasks.length} — tick the boxes on the left to change several at once</span></p>
        <div id="sch-issues-slot">${(bannerHtml = renderIssuesBanner(d))}</div>
        ${d.selected.length ? renderBulkBar(d) : ""}
        <div class="sch-sheet" role="table" aria-label="Tasks by day">
          <div class="sch-sheet__head" role="row">
            <label class="sch-sel" title="Select all"><input type="checkbox" data-sch-act="select-all" ${allSelected ? "checked" : ""} aria-label="Select all tasks" /></label>
            <span class="sch-sheet__task">Task</span>
            <span class="sch-sheet__days">${DOW.map((l, i) => `<b title="${DAYS[i]}">${l}</b>`).join("")}</span>
            <span class="sch-sheet__times">Start – End</span>
            <span></span>
          </div>
          ${d.tasks.map((t, i) => renderTaskRow(t, i, d)).join("")}
        </div>
        <button type="button" class="button button--outline button--small sch-add-task" data-sch-act="add-task">${icon("plus")} Add a task</button>
      </div>`;
  }

  function renderBulkBar(d) {
    const n = d.selected.length;
    return `
      <div class="sch-bulk" role="region" aria-label="Change the selected tasks">
        <div class="sch-bulk__top">
          <strong>${n} selected</strong>
          <button type="button" class="link-button" data-sch-act="bulk-clear">Clear</button>
        </div>
        <div class="sch-bulk__group"><span>Days</span>
          <button type="button" class="sch-day sch-day--preset" data-sch-act="bulk-days" data-preset="weekdays">Mon–Fri</button>
          <button type="button" class="sch-day sch-day--preset" data-sch-act="bulk-days" data-preset="all">Every day</button>
          <button type="button" class="sch-day sch-day--preset" data-sch-act="bulk-days" data-preset="weekend">Weekends</button>
        </div>
        <div class="sch-bulk__group"><span>Times</span>
          <input type="time" data-sch-f="bulk-start" value="${esc(d.bulk.start)}" aria-label="Start time for selected" /> –
          <input type="time" data-sch-f="bulk-end" value="${esc(d.bulk.end)}" aria-label="End time for selected" />
          <button type="button" class="button button--outline button--small" data-sch-act="bulk-times">Apply</button>
        </div>
        <div class="sch-bulk__group"><span>Enforce</span>
          <select data-sch-f="bulk-enforce" aria-label="Enforce times for selected">
            <option value="">Choose…</option><option value="default">Use schedule setting</option><option value="yes">Enforce</option><option value="no">Don’t enforce</option>
          </select>
        </div>
        <div class="sch-bulk__group"><span>Photos</span>
          <input type="number" min="0" max="10" inputmode="numeric" placeholder="General" data-sch-f="bulk-general" value="${esc(d.bulk.general)}" aria-label="General photos for selected" />
          <input type="number" min="0" max="10" inputmode="numeric" placeholder="Detail" data-sch-f="bulk-detail" value="${esc(d.bulk.detail)}" aria-label="Detail photos for selected" />
          <button type="button" class="button button--outline button--small" data-sch-act="bulk-photos">Apply</button>
        </div>
        <div class="sch-bulk__group">
          ${
            d.confirmBulkRemove
              ? `<span class="tag-delete-confirm"><span>Remove ${n} task${n === 1 ? "" : "s"}?</span>
                  <button type="button" class="button button--danger button--small" data-sch-act="bulk-remove-yes">Yes, remove</button>
                  <button type="button" class="button button--outline button--small" data-sch-act="bulk-remove-no">No</button></span>`
              : `<button type="button" class="button button--outline button--small" data-sch-act="bulk-remove">${icon("trash")} Remove selected</button>`
          }
        </div>
      </div>`;
  }

  function renderTaskRow(t, i, d) {
    const open = d.expanded.includes(t.uid);
    const confirming = d.confirmRemove === i;
    const noDays = t.title.trim() && !t.days.length;
    return `
      <div class="sch-row ${open ? "is-open" : ""} ${d.selected.includes(t.uid) ? "is-selected" : ""} ${noDays ? "has-issue" : ""}" data-i="${i}" data-uid="${t.uid}">
        <label class="sch-sel"><input type="checkbox" data-sch-f="t-sel" data-i="${i}" ${d.selected.includes(t.uid) ? "checked" : ""} aria-label="Select task ${i + 1}" /></label>
        <div class="sch-row__title">
          <input type="text" data-sch-f="t-title" data-i="${i}" value="${esc(t.title)}" placeholder="Task name, e.g. Mop lobby floors" maxlength="120" aria-label="Task ${i + 1} name" />
          ${t.location && !open ? `<small>${esc(t.location)}</small>` : ""}
        </div>
        <div class="sch-row__days" role="group" aria-label="Days">
          ${DAYS.map((day, k) => `<button type="button" class="sch-dow ${t.days.includes(day) ? "is-on" : ""}" aria-pressed="${t.days.includes(day)}" aria-label="${day}" title="${day}" data-sch-act="toggle-day" data-i="${i}" data-day="${day}">${DOW[k]}</button>`).join("")}
        </div>
        <div class="sch-row__times">
          <input type="time" data-sch-f="t-start" data-i="${i}" value="${esc(t.startTime)}" aria-label="Start time" />
          <span>–</span>
          <input type="time" data-sch-f="t-end" data-i="${i}" value="${esc(t.endTime)}" aria-label="End time" />
        </div>
        <button type="button" class="icon-button sch-row__more" data-sch-act="toggle-expand" data-i="${i}" aria-expanded="${open}" title="${open ? "Hide" : "More"} settings" aria-label="${open ? "Hide" : "More"} settings for task ${i + 1}">${icon(open ? "close" : "edit")}</button>
        ${
          open
            ? `<div class="sch-row__extra">
                <div class="sch-grid">
                  <label class="inspection-field"><span>Where <small>optional</small></span><input type="text" data-sch-f="t-location" data-i="${i}" value="${esc(t.location)}" maxlength="120" /></label>
                  <label class="inspection-field"><span>Times</span>
                    <select data-sch-f="t-enforce" data-i="${i}">
                      <option value="default" ${t.enforce === "default" ? "selected" : ""}>Use schedule setting</option>
                      <option value="yes" ${t.enforce === "yes" ? "selected" : ""}>Enforce</option>
                      <option value="no" ${t.enforce === "no" ? "selected" : ""}>Don’t enforce</option>
                    </select></label>
                  <span></span>
                  <label class="inspection-field"><span>General photos</span><input type="number" min="0" max="10" inputmode="numeric" data-sch-f="t-general" data-i="${i}" value="${esc(String(t.general))}" placeholder="${d.defaults.general || 0}" /></label>
                  <label class="inspection-field"><span>Detail photos</span><input type="number" min="0" max="10" inputmode="numeric" data-sch-f="t-detail" data-i="${i}" value="${esc(String(t.detail))}" placeholder="${d.defaults.detail || 0}" /></label>
                </div>
                <label class="inspection-field"><span>Notes <small>optional</small></span><input type="text" data-sch-f="t-details" data-i="${i}" value="${esc(t.details)}" maxlength="500" /></label>
                <div class="sch-row__remove">
                  ${
                    confirming
                      ? `<span class="tag-delete-confirm"><span>Remove this task?</span>
                          <button type="button" class="button button--danger button--small" data-sch-act="remove-task-yes" data-i="${i}">Yes, remove</button>
                          <button type="button" class="button button--outline button--small" data-sch-act="remove-task-no">No</button></span>`
                      : `<button type="button" class="button button--outline button--small" data-sch-act="remove-task" data-i="${i}">${icon("trash")} Remove this task</button>`
                  }
                </div>
              </div>`
            : ""
        }
      </div>`;
  }

  const STATUS_LABEL = { done: "Done", missed: "Missed", in_progress: "In progress", todo: "To do", upcoming: "Upcoming" };

  function renderProofTab() {
    const p = S.proof;
    const data = p.data;
    const photoLink = (ph) =>
      `<figure class="sch-proof-fig"><a class="sch-proof-photo ${ph.offSite ? "is-offsite" : ""}" href="${photoUrl(ph.key, S.buildingId)}" target="_blank" rel="noopener"><img src="${photoUrl(ph.key, S.buildingId)}" alt="${ph.kind} photo" loading="lazy" /><span>${ph.kind === "general" ? "General" : "Detail"}${ph.offSite ? " · away from building" : ""}</span></a><figcaption>${photoMeta({ capturedAt: ph.capturedAt, latitude: ph.latitude, longitude: ph.longitude, distanceM: ph.distanceM })}</figcaption></figure>`;
    return `
      <div class="sch-daybar">
        <button type="button" class="icon-button" data-sch-act="proof-prev" aria-label="Previous day">${icon("arrow").replace("<svg", '<svg style="transform:rotate(180deg)"')}</button>
        <input type="date" data-sch-f="proof-date" value="${esc(p.date || "")}" aria-label="Day" />
        <button type="button" class="icon-button" data-sch-act="proof-next" aria-label="Next day">${icon("arrow")}</button>
      </div>
      ${p.error ? `<p class="form-error" role="alert">${esc(p.error)}</p>` : ""}
      ${
        !data
          ? `<p class="sch-loading">${p.loading ? "Loading…" : "Pick a day."}</p>`
          : `<p class="sch-summary"><strong>${data.summary.done} of ${data.summary.total}</strong> done${data.summary.missed ? ` · <span class="sch-bad">${data.summary.missed} missed</span>` : ""} <span class="quiet-label">· ${esc(data.weekday)}</span></p>
             ${
               data.tasks.length
                 ? data.tasks
                     .map(
                       (t) => `<article class="sch-proof sch-proof--${t.status}">
                        <div class="sch-proof__top">
                          <div><strong>${esc(t.title)}</strong><small>${esc(windowText(t.startTime, t.endTime))}${t.location ? ` · ${esc(t.location)}` : ""}${t.enforce ? " · enforced" : ""} · ${esc(t.scheduleName)}</small></div>
                          <span class="sch-pill sch-pill--${t.status}">${STATUS_LABEL[t.status] || t.status}${t.late ? " · late" : ""}</span>
                        </div>
                        ${t.completedBy ? `<p class="quiet-label">${t.status === "done" ? "Completed" : "Started"} by <strong>${esc(t.completedBy.name)}</strong>${t.completedBy.designation ? ` (${esc(t.completedBy.designation)})` : ""}${t.completedAt ? ` · ${esc(new Date(`${t.completedAt.replace(" ", "T")}Z`).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))}` : ""}</p>` : ""}
                        ${t.photos.length ? `<div class="sch-proof__photos">${t.photos.map(photoLink).join("")}</div><p class="quiet-label">${t.photos.filter((x) => x.kind === "general").length}/${t.requiredGeneral} general · ${t.photos.filter((x) => x.kind === "detail").length}/${t.requiredDetail} detail</p>` : ""}
                      </article>`,
                     )
                     .join("")
                 : `<p class="empty-state">Nothing was scheduled for this day.</p>`
             }`
      }`;
  }

  function staffEdit(p) {
    return S.staffEdits[p.id] || (S.staffEdits[p.id] = { kind: p.kind, designation: p.designation || "" });
  }

  function renderTeamTab() {
    if (!S.staff.length) return `<p class="empty-state">No cleaners or superintendents on this building yet.</p>`;
    return `
      <p class="parameters-intro">Set each person as a Cleaner or a Superintendent, then add a variant if it applies — pick one or type your own.</p>
      ${S.staff
        .map((p) => {
          const e = staffEdit(p);
          const presets = S.presets[e.kind] || [];
          return `<div class="sch-staff" data-id="${p.id}">
            <div class="sch-staff__name"><strong>${esc(p.fullName)}</strong></div>
            <label class="inspection-field"><span>Role</span>
              <select data-sch-f="staff-kind" data-id="${p.id}"><option value="cleaner" ${e.kind === "cleaner" ? "selected" : ""}>Cleaner</option><option value="superintendent" ${e.kind === "superintendent" ? "selected" : ""}>Superintendent</option></select></label>
            <label class="inspection-field"><span>Variant <small>optional</small></span><input type="text" maxlength="40" data-sch-f="staff-designation" data-id="${p.id}" value="${esc(e.designation)}" placeholder="e.g. ${esc(presets[0] || "Custom")}" /></label>
            <div class="sch-presets">${presets.map((v) => `<button type="button" class="sch-day" data-sch-act="staff-preset" data-id="${p.id}" data-value="${esc(v)}">${esc(v)}</button>`).join("")}</div>
            <button type="button" class="button button--primary button--small" data-sch-act="staff-save" data-id="${p.id}">Save</button>
          </div>`;
        })
        .join("")}`;
  }

  // ---------- manager: actions ----------
  const newDraft = (extra = {}) => ({
    mode: "new",
    step: "upload",
    files: [],
    text: "",
    notice: "",
    name: "",
    defaults: { general: "", detail: "", enforce: false },
    assigneeIds: [],
    tasks: [],
    busy: false,
    error: "",
    confirmRemove: null,
    selected: [], // task uids ticked for a bulk edit
    expanded: [], // task uids showing their extra settings
    bulk: { start: "", end: "", general: "", detail: "" },
    confirmBulkRemove: false,
    ...extra,
  });

  function closeDraft() {
    clearPreviews();
    S.draft = null;
  }

  async function analyze() {
    const d = S.draft;
    const button = document.querySelector('[data-sch-act="analyze"]');
    const status = document.querySelector("#sch-upload-status");
    if (button) button.disabled = true;
    if (status) {
      status.className = "photo-capture__status photo-capture__status--busy";
      status.textContent = "Reading the schedule… this takes a few seconds.";
    }
    try {
      const images = await Promise.all(d.files.map(prepareSheetPage));
      const result = await request("/manager/schedules/analyze", {
        method: "POST",
        body: JSON.stringify({ buildingId: S.buildingId, images, text: d.text.trim() || undefined }),
      });
      if (!result.tasks.length) {
        d.notice = "Couldn’t find any tasks — add a clearer photo, paste the text, or type it in yourself.";
        rerender();
        return;
      }
      clearPreviews();
      d.files = [];
      d.step = "review";
      d.name = result.name;
      d.tasks = result.tasks.map(taskFromApi);
      d.aiNote = `The AI found ${result.tasks.length} task${result.tasks.length === 1 ? "" : "s"}${result.merged ? ` (merged ${result.merged} duplicate${result.merged === 1 ? "" : "s"})` : ""}. Check the grid against your paper schedule, then choose who it's for.`;
      queueScroll("#sch-wizard");
      rerender();
    } catch (error) {
      d.notice = error.message;
      rerender();
    }
  }

  async function saveDraft(form) {
    const d = S.draft;
    d.error = "";
    d.busy = true;
    const submit = form.querySelector('button[type="submit"]');
    if (submit) {
      submit.disabled = true;
      submit.textContent = "Saving…";
    }
    const body = {
      name: d.name.trim(),
      defaults: { generalPhotos: Number(d.defaults.general) || 0, detailPhotos: Number(d.defaults.detail) || 0, enforceTimes: d.defaults.enforce },
      assigneeIds: d.assigneeIds,
      tasks: d.tasks.map(taskToApi),
    };
    try {
      if (d.mode === "edit") await request("/manager/schedules/update", { method: "POST", body: JSON.stringify({ scheduleId: d.scheduleId, ...body }) });
      else await request("/manager/schedules/create", { method: "POST", body: JSON.stringify({ buildingId: S.buildingId, ...body }) });
      const wasEdit = d.mode === "edit";
      closeDraft();
      const fresh = await request(`/manager/schedules?buildingId=${S.buildingId}`);
      S.schedules = fresh.schedules;
      setNotice("ok", wasEdit ? "Schedule saved." : "Schedule is live — assigned people will see today's tasks on their screen.");
      rerender();
    } catch (error) {
      d.busy = false;
      d.error = error.message;
      rerender();
      queueScroll("#sch-form-error");
    }
  }

  async function onAction(el) {
    const act = el.dataset.schAct;
    const i = el.dataset.i !== undefined ? Number(el.dataset.i) : null;
    const d = S.draft;
    switch (act) {
      case "toggle":
        S.open = !S.open;
        S.notice = null;
        if (S.open && (S.loadedFor === null || S.loadedFor !== S.buildingId)) {
          await loadBuilding();
          return;
        }
        rerender();
        return;
      case "tab":
        S.tab = el.dataset.tab;
        S.notice = null;
        if (S.tab === "proof" && !S.proof.data) {
          await loadProof();
          return;
        }
        rerender();
        return;
      case "new":
        S.draft = newDraft();
        S.notice = null;
        rerender();
        return;
      case "cancel-draft":
        closeDraft();
        rerender();
        return;
      case "remove-file": {
        const [removed] = d.files.splice(i, 1);
        if (removed && previews.has(removed)) {
          URL.revokeObjectURL(previews.get(removed));
          previews.delete(removed);
        }
        d.notice = "";
        rerender();
        return;
      }
      case "analyze":
        await analyze();
        return;
      case "manual":
        d.step = "review";
        d.tasks = [blankTask()];
        d.aiNote = "";
        rerender();
        return;
      case "add-task": {
        const fresh = blankTask();
        d.tasks.push(fresh);
        d.expanded.push(fresh.uid);
        queueScroll(`.sch-row[data-uid="${fresh.uid}"]`);
        rerender();
        return;
      }
      case "toggle-expand": {
        const uid = d.tasks[i].uid;
        d.expanded = d.expanded.includes(uid) ? d.expanded.filter((x) => x !== uid) : [...d.expanded, uid];
        rerender();
        return;
      }
      case "select-all":
        d.selected = d.selected.length === d.tasks.length ? [] : d.tasks.map((t) => t.uid);
        d.confirmBulkRemove = false;
        rerender();
        return;
      case "bulk-clear":
        d.selected = [];
        d.confirmBulkRemove = false;
        rerender();
        return;
      case "bulk-days": {
        const days = el.dataset.preset === "all" ? [...DAYS] : el.dataset.preset === "weekend" ? ["Sat", "Sun"] : [...WEEKDAYS];
        for (const t of d.tasks) if (d.selected.includes(t.uid)) t.days = [...days];
        rerender();
        return;
      }
      case "bulk-times":
        for (const t of d.tasks) {
          if (!d.selected.includes(t.uid)) continue;
          t.startTime = d.bulk.start;
          t.endTime = d.bulk.end;
        }
        rerender();
        return;
      case "bulk-photos":
        for (const t of d.tasks) {
          if (!d.selected.includes(t.uid)) continue;
          t.general = d.bulk.general;
          t.detail = d.bulk.detail;
        }
        rerender();
        return;
      case "bulk-remove":
        d.confirmBulkRemove = true;
        rerender();
        return;
      case "bulk-remove-no":
        d.confirmBulkRemove = false;
        rerender();
        return;
      case "bulk-remove-yes":
        d.tasks = d.tasks.filter((t) => !d.selected.includes(t.uid));
        d.selected = [];
        d.confirmBulkRemove = false;
        rerender();
        return;
      case "merge-dupes": {
        const { tasks } = mergeDuplicateTasks(d.tasks.filter((t) => t.title.trim()).concat([]));
        const blanks = d.tasks.filter((t) => !t.title.trim());
        d.tasks = [...tasks, ...blanks];
        d.selected = d.selected.filter((uid) => d.tasks.some((t) => t.uid === uid));
        rerender();
        return;
      }
      case "remove-task":
        d.confirmRemove = i;
        rerender();
        return;
      case "remove-task-no":
        d.confirmRemove = null;
        rerender();
        return;
      case "remove-task-yes": {
        const [gone] = d.tasks.splice(i, 1);
        d.selected = d.selected.filter((x) => x !== gone.uid);
        d.expanded = d.expanded.filter((x) => x !== gone.uid);
        d.confirmRemove = null;
        rerender();
        return;
      }
      case "toggle-day": {
        const t = d.tasks[i];
        t.days = t.days.includes(el.dataset.day) ? t.days.filter((x) => x !== el.dataset.day) : DAYS.filter((x) => t.days.includes(x) || x === el.dataset.day);
        el.classList.toggle("is-on", t.days.includes(el.dataset.day));
        el.setAttribute("aria-pressed", String(t.days.includes(el.dataset.day)));
        refreshIssues();
        return;
      }
      case "days-preset":
        d.tasks[i].days = el.dataset.preset === "all" ? [...DAYS] : [...WEEKDAYS];
        rerender();
        return;
      case "edit": {
        const s = S.schedules.find((x) => x.id === Number(el.dataset.id));
        if (!s) return;
        S.draft = newDraft({
          mode: "edit",
          step: "review",
          scheduleId: s.id,
          name: s.name,
          defaults: { general: s.default_general_photos || "", detail: s.default_detail_photos || "", enforce: s.enforce_times },
          assigneeIds: s.assignees.map((a) => a.id),
          tasks: s.tasks.map(taskFromApi),
        });
        S.notice = null;
        queueScroll("#sch-wizard");
        rerender();
        return;
      }
      case "archive": {
        const s = S.schedules.find((x) => x.id === Number(el.dataset.id));
        if (!s || !confirm(`Archive “${s.name}”? It disappears from everyone's checklist. Past proof of work is kept.`)) return;
        try {
          await request("/manager/schedules/update", { method: "POST", body: JSON.stringify({ scheduleId: s.id, status: "archived" }) });
          S.schedules = S.schedules.filter((x) => x.id !== s.id);
          setNotice("ok", `“${s.name}” archived.`);
        } catch (error) {
          setNotice("err", error.message);
        }
        rerender();
        return;
      }
      case "proof-prev":
      case "proof-next": {
        const base = new Date(`${S.proof.date || new Date().toISOString().slice(0, 10)}T12:00:00Z`);
        base.setUTCDate(base.getUTCDate() + (act === "proof-next" ? 1 : -1));
        S.proof.date = base.toISOString().slice(0, 10);
        await loadProof();
        return;
      }
      case "staff-preset": {
        const e = S.staffEdits[el.dataset.id];
        if (e) e.designation = el.dataset.value;
        rerender();
        return;
      }
      case "staff-save": {
        const id = Number(el.dataset.id);
        const e = S.staffEdits[id];
        if (!e) return;
        el.disabled = true;
        try {
          await request("/manager/staff/update", { method: "POST", body: JSON.stringify({ userId: id, kind: e.kind, designation: e.designation }) });
          const [staff, schedules] = await Promise.all([request(`/manager/staff?buildingId=${S.buildingId}`), request(`/manager/schedules?buildingId=${S.buildingId}`)]);
          S.staff = staff.staff;
          S.schedules = schedules.schedules;
          S.staffEdits = {};
          setNotice("ok", "Saved.");
        } catch (error) {
          setNotice("err", error.message);
        }
        rerender();
        return;
      }
      default:
    }
  }

  function onField(el, isChange) {
    const f = el.dataset.schF;
    const d = S.draft;
    const i = el.dataset.i !== undefined ? Number(el.dataset.i) : null;
    // A late edit event from a row that was just merged or removed.
    if (i !== null && d && f?.startsWith("t-") && !d.tasks[i]) return;
    switch (f) {
      case "building":
        if (!isChange) return;
        S.buildingId = Number(el.value);
        S.proof = { date: null, data: null, loading: false, error: "" };
        S.draft = null;
        S.notice = null;
        loadBuilding();
        return;
      case "text":
        d.text = el.value;
        document.querySelector('[data-sch-act="analyze"]')?.toggleAttribute("disabled", !d.files.length && !d.text.trim());
        return;
      case "name":
        d.name = el.value;
        return;
      case "def-general":
        d.defaults.general = el.value;
        return;
      case "def-detail":
        d.defaults.detail = el.value;
        return;
      case "def-enforce":
        d.defaults.enforce = el.checked;
        refreshIssues();
        return;
      case "assignee": {
        const id = Number(el.value);
        d.assigneeIds = el.checked ? [...new Set([...d.assigneeIds, id])] : d.assigneeIds.filter((x) => x !== id);
        return;
      }
      case "t-sel": {
        const uid = d.tasks[i].uid;
        d.selected = el.checked ? [...new Set([...d.selected, uid])] : d.selected.filter((x) => x !== uid);
        d.confirmBulkRemove = false;
        rerender();
        return;
      }
      case "bulk-start": d.bulk.start = el.value; return;
      case "bulk-end": d.bulk.end = el.value; return;
      case "bulk-general": d.bulk.general = el.value; return;
      case "bulk-detail": d.bulk.detail = el.value; return;
      case "bulk-enforce":
        if (!isChange || !el.value) return;
        for (const t of d.tasks) if (d.selected.includes(t.uid)) t.enforce = el.value;
        rerender();
        return;
      case "t-title": d.tasks[i].title = el.value; refreshIssues(); return;
      case "t-details": d.tasks[i].details = el.value; return;
      case "t-location": d.tasks[i].location = el.value; refreshIssues(); return;
      case "t-start": d.tasks[i].startTime = el.value; refreshIssues(); return;
      case "t-end": d.tasks[i].endTime = el.value; refreshIssues(); return;
      case "t-enforce": d.tasks[i].enforce = el.value; refreshIssues(); return;
      case "t-general": d.tasks[i].general = el.value; return;
      case "t-detail": d.tasks[i].detail = el.value; return;
      case "proof-date":
        if (isChange && el.value) {
          S.proof.date = el.value;
          loadProof();
        }
        return;
      case "staff-kind": {
        const e = S.staffEdits[el.dataset.id];
        if (!e || !isChange) return;
        e.kind = el.value;
        rerender();
        return;
      }
      case "staff-designation": {
        const e = S.staffEdits[el.dataset.id];
        if (e) e.designation = el.value;
        return;
      }
      default:
    }
  }

  function onFiles(input) {
    const d = S.draft;
    if (!d) return;
    const added = Array.from(input.files || []);
    input.value = "";
    if (!added.length) return;
    const merged = [...d.files, ...added];
    d.files = merged.slice(0, MAX_FILES);
    d.notice = merged.length > MAX_FILES ? `Up to ${MAX_FILES} pages at a time — kept the first ${MAX_FILES}.` : "";
    rerender();
  }

  // ---------- field staff: today's checklist ----------
  async function loadMine() {
    try {
      S.mine = await request("/schedule/today");
    } catch {
      S.mine = null;
    }
  }

  const photosOf = (t, kind) => t.photos.filter((p) => p.kind === kind);

  function taskNote(t) {
    if (t.status === "done") return `Done${t.completedAt ? ` at ${new Date(`${t.completedAt.replace(" ", "T")}Z`).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}${t.late ? " · late" : ""}`;
    if (t.status === "missed") return "Time window passed";
    if (t.windowState === "before") return `Opens at ${clock(t.startTime)}`;
    if (t.status === "in_progress") return `${photosOf(t, "general").length}/${t.requiredGeneral} general · ${photosOf(t, "detail").length}/${t.requiredDetail} detail photos`;
    return "";
  }

  function renderMyTasks() {
    const m = S.mine;
    if (!m || !m.tasks.length) return "";
    const pct = Math.round((m.summary.done / m.summary.total) * 100);
    return `
      <section class="card sch-mine" id="sch-mine" aria-labelledby="sch-mine-title">
        <div class="card__header">
          <div><p class="section-kicker">Today's checklist</p><h2 id="sch-mine-title">${m.summary.done} of ${m.summary.total} done</h2></div>
          ${m.summary.done === m.summary.total ? `<span class="status-pill status-pill--success">${icon("check")} All done</span>` : ""}
        </div>
        <div class="progress-track sch-mine__bar"><span style="width:${pct}%"></span></div>
        ${S.work.error ? `<p class="form-error sch-pad" id="sch-work-error" role="alert">${esc(S.work.error)}</p>` : ""}
        <div class="sch-mine__list">${m.tasks.map(renderMyTask).join("")}</div>
      </section>`;
  }

  function renderMyTask(t) {
    const open = S.work.taskId === t.id && t.status !== "done";
    const blocked = t.status !== "done" && (t.windowState === "before" || t.windowState === "after");
    const note = taskNote(t);
    return `
      <article class="sch-task sch-task--${t.status} ${S.justDone === t.id ? "just-done" : ""} ${open ? "is-open" : ""}" data-task="${t.id}">
        <div class="sch-task__row">
          <button type="button" class="sch-check" data-sch-act="work" data-task="${t.id}" ${t.status === "done" || blocked ? "disabled" : ""}
            aria-label="${t.status === "done" ? `${esc(t.title)} is done` : `Check off ${esc(t.title)}`}" aria-expanded="${open}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>
          </button>
          <div class="sch-task__main">
            <strong>${esc(t.title)}</strong>
            <small>${esc(windowText(t.startTime, t.endTime))}${t.enforce ? " · enforced" : ""}${t.location ? ` · ${esc(t.location)}` : ""}</small>
            ${t.details ? `<small class="sch-task__details">${esc(t.details)}</small>` : ""}
            ${note ? `<small class="sch-task__note sch-task__note--${t.status}">${esc(note)}</small>` : ""}
          </div>
          ${t.status !== "done" && !blocked ? `<button type="button" class="button button--small ${t.status === "in_progress" ? "button--primary" : "button--outline"}" data-sch-act="work" data-task="${t.id}">${t.status === "in_progress" ? "Continue" : "Start"}</button>` : ""}
        </div>
        ${open ? renderFlow(t) : ""}
      </article>`;
  }

  function renderFlow(t) {
    const g = photosOf(t, "general");
    const dt = photosOf(t, "detail");
    const needG = t.requiredGeneral;
    const needD = t.requiredDetail;
    const gDone = g.length >= needG;
    const dDone = dt.length >= needD;
    const ready = gDone && dDone;
    const kind = !gDone ? "general" : "detail";
    const bid = S.mine.buildingId;
    const stage = ready ? 3 : gDone ? 2 : 1;
    const prompt = ready
      ? needG + needD === 0
        ? "No photos needed for this one. Mark the task complete."
        : "All photos are in. Mark the task complete."
      : kind === "general"
        ? needG > 1
          ? `General photo ${g.length + 1} of ${needG} — show the whole area.`
          : "Take a general photo — show the whole area."
        : `Detail photo ${dt.length + 1} of ${needD} — get close to what you cleaned or checked.`;
    const thumb = (p) => `<li class="sch-thumb"><img src="${photoUrl(p.key, bid)}" alt="${p.kind} photo" loading="lazy" />
      <button type="button" class="icon-button sch-thumb__x" data-sch-act="photo-remove" data-id="${p.id}" aria-label="Remove this photo">${icon("close")}</button></li>`;
    return `
      <div class="sch-flow" id="sch-flow">
        <ol class="sch-flow__steps" aria-label="Steps">
          <li class="${stage > 1 ? "is-done" : "is-current"}"><b>${stage > 1 ? icon("check") : "1"}</b>General<small>${Math.min(g.length, needG)}/${needG}</small></li>
          <li class="${stage > 2 ? "is-done" : stage === 2 ? "is-current" : ""}"><b>${stage > 2 ? icon("check") : "2"}</b>Details<small>${Math.min(dt.length, needD)}/${needD}</small></li>
          <li class="${stage === 3 ? "is-current" : ""}"><b>3</b>Finish</li>
        </ol>
        <p class="sch-flow__prompt">${esc(prompt)}</p>
        ${g.length || dt.length ? `<ul class="sch-thumbs">${[...g, ...dt].map(thumb).join("")}</ul>` : ""}
        ${S.work.note ? `<p class="sch-notice sch-notice--ok">${esc(S.work.note)}</p>` : ""}
        <div class="sch-flow__actions">
          ${
            ready
              ? `<button type="button" class="button button--primary" data-sch-act="finish" data-task="${t.id}" ${S.work.busy ? "disabled" : ""}>${S.work.busy ? "Saving…" : "Mark task complete"}</button>`
              : `<label class="button button--primary ${S.work.busy ? "is-disabled" : ""}" for="sch-photo-input">${icon("camera")} ${S.work.busy ? "Uploading…" : kind === "general" ? "Take general photo" : "Take detail photo"}</label>
                 <input type="file" accept="image/*" capture="environment" id="sch-photo-input" data-sch-photo data-task="${t.id}" data-kind="${kind}" hidden ${S.work.busy ? "disabled" : ""} />`
          }
          <button type="button" class="button button--outline" data-sch-act="work-close">${ready ? "Not yet" : "Save &amp; finish later"}</button>
        </div>
      </div>`;
  }

  async function refreshMine({ scrollTo } = {}) {
    await loadMine();
    if (scrollTo) queueScroll(scrollTo);
    rerender();
  }

  async function onPhoto(input) {
    const file = input.files?.[0];
    if (!file || S.work.busy) return;
    const taskId = Number(input.dataset.task);
    const kind = input.dataset.kind;
    S.work.busy = true;
    S.work.error = "";
    S.work.note = "";
    rerender();
    try {
      const geo = await getGeolocation().catch(() => null);
      const body = new FormData();
      body.append("taskId", String(taskId));
      body.append("kind", kind);
      body.append("photo", file, file.name || "task.jpg");
      body.append("capturedAt", liveCaptureTime(file) || new Date().toISOString());
      if (geo) {
        body.append("latitude", String(geo.latitude));
        body.append("longitude", String(geo.longitude));
      }
      const res = await request("/schedule/task-photo", { method: "POST", body });
      S.work.note = res.locationMismatch ? "Photo saved — but you appear to be away from the building." : "Photo saved.";
      S.work.busy = false;
      await refreshMine({ scrollTo: "#sch-flow" });
    } catch (error) {
      S.work.busy = false;
      S.work.error = error.message;
      await refreshMine({ scrollTo: "#sch-work-error" });
    }
  }

  async function onWorkAction(el) {
    const act = el.dataset.schAct;
    if (act === "work") {
      const id = Number(el.dataset.task);
      S.work = { taskId: S.work.taskId === id ? null : id, busy: false, error: "", note: "" };
      queueScroll(S.work.taskId ? "#sch-flow" : "#sch-mine");
      rerender();
    } else if (act === "work-close") {
      S.work = { taskId: null, busy: false, error: "", note: "" };
      queueScroll("#sch-mine");
      rerender();
    } else if (act === "photo-remove") {
      if (S.work.busy) return;
      el.disabled = true;
      try {
        await request("/schedule/task-photo/remove", { method: "POST", body: JSON.stringify({ photoId: Number(el.dataset.id) }) });
        S.work.note = "";
      } catch (error) {
        S.work.error = error.message;
      }
      await refreshMine();
    } else if (act === "finish") {
      S.work.busy = true;
      S.work.error = "";
      rerender();
      const taskId = Number(el.dataset.task);
      try {
        await request("/schedule/complete", { method: "POST", body: JSON.stringify({ taskId }) });
        S.justDone = taskId;
        S.work = { taskId: null, busy: false, error: "", note: "" };
        await refreshMine({ scrollTo: `[data-task="${taskId}"]` });
        setTimeout(() => (S.justDone = null), 2500);
      } catch (error) {
        S.work.busy = false;
        S.work.error = error.message;
        await refreshMine({ scrollTo: "#sch-work-error" });
      }
    }
  }

  // ---------- events (delegated once; the page re-renders wholesale) ----------
  function install() {
    document.addEventListener("click", (event) => {
      const el = event.target.closest?.("[data-sch-act]");
      if (!el || el.disabled) return;
      const act = el.dataset.schAct;
      if (["work", "work-close", "photo-remove", "finish"].includes(act)) onWorkAction(el);
      else onAction(el);
    });
    document.addEventListener("input", (event) => {
      const el = event.target;
      if (el.dataset?.schF && !(el instanceof HTMLSelectElement) && el.type !== "checkbox" && el.type !== "date") onField(el, false);
    });
    document.addEventListener("change", (event) => {
      const el = event.target;
      if (el.dataset?.schF) onField(el, true);
      else if (el.matches?.("input[data-sch-file]")) onFiles(el);
      else if (el.matches?.("input[data-sch-photo]")) onPhoto(el);
    });
    document.addEventListener("submit", (event) => {
      const form = event.target.closest?.("[data-sch-form]");
      if (!form) return;
      event.preventDefault();
      saveDraft(form);
    });
  }

  return {
    install,
    renderManagerCard,
    renderMyTasks,
    loadMine,
    reset() {
      closeDraft();
      Object.assign(S, { open: false, loadedFor: null, schedules: [], staff: [], mine: null, notice: null, proof: { date: null, data: null, loading: false, error: "" }, work: { taskId: null, busy: false, error: "", note: "" } });
    },
    // True while a half-filled editor or an upload is open: callers skip
    // background re-renders that would wipe it.
    isBusy: () => Boolean(S.draft) || S.work.busy,
    // Today's checklist numbers for a tab badge, or null when this person has no tasks.
    taskSummary: () => (S.mine && S.mine.tasks.length ? S.mine.summary : null),
    // Mid-task (camera flow open) -- keep the tasks screen showing.
    isWorking: () => S.work.taskId != null,
    // Called after a render that shows the embedded tool: lock it to one
    // building (or null = the manager's own picker) and load if needed.
    activate(buildingId = null) {
      if ((S.lockedBuilding ?? null) !== buildingId) {
        S.lockedBuilding = buildingId;
        S.loadedFor = null;
        S.draft = null;
        S.notice = null;
        S.proof = { date: null, data: null, loading: false, error: "" };
        if (buildingId != null) S.buildingId = buildingId;
      }
      if (S.loading) return;
      if (S.loadedFor !== null && S.loadedFor === S.buildingId) return;
      loadBuilding();
    },
  };
}
