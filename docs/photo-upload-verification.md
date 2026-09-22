# Photo Upload Verification — 2026-09-21

## Follow-up: Clear all includes photos

Deployed Pages `7ed707aa` and Worker `26ad89ed-81a2-42fe-a59f-a8a8458b182f`. Six unit tests passed, including scoped reset and submitted-inspection rejection. Build and whitespace checks passed.

`QA_LIVE=1 QA_CLEAR=1 python3 scripts/photo-browser-qa.py` passed against production using isolated QA building 10. Uploaded three real GHL-backed images; cancelling Clear All preserved proof; confirming cleared readings, proof records, and today's inspection photo-library index. Reload confirmed the green proof indicator did not return and database checks confirmed no remaining QA photo references. QA building/account archived after testing. Original GHL files remain recoverable; no physical media deletion was performed. Scope is today's draft for the authenticated building, not older days or building-sheet imports.

## Follow-up: Live-only capture and animated feedback

Deployed https://8a6d2f15.power-log-command.pages.dev to the main Power Log Command domain. Repeated `QA_LIVE=1 python3 scripts/photo-browser-qa.py` successfully against the public domain (QA building 9, archived afterward).

- Command Mode live capture immediately updates the regular checklist's green proof block, without a reload.
- Successful GHL save shows an animated green check; deliberately injected HTTP 503 shows an animated red error and retry message, never a success indicator.
- Removed existing-photo and device-upload choices from inspection capture; handlers reject files not produced by the in-page camera. This is a browser-workflow restriction, not tamper-proof device attestation.
- Timestamp is taken at the shutter moment. A fresh geolocation request replaces the previous indefinite session cache. Location failure is explicitly shown as unavailable.
- Verified timestamp near shutter time and simulated GPS (43.65, -79.38) in the real API response and persisted database row.
- Three real GHL-backed photos decoded in the library; proof state persisted after reload.
- Repeated 100-camera lifecycle test, cancellation, and permission-denied/no-upload-fallback checks: passed. Build, four unit tests, and diff whitespace check passed.
- Success/error screenshots: `/var/folders/k_/2sfdmjyx5w70lz156yf13l_00000gn/T/plc-photo-qa-_2ysqlka/`.

These are desktop Chromium tests with simulated camera/GPS, not physical-phone GPS validation. The earlier existing-photo fallback described below has been superseded. Timestamp/GPS are metadata, not a burned-in image overlay. Administrative building-sheet imports remain outside this inspection-photo change.

Deployed frontend: https://power-log-command.pages.dev

Pages deployment: https://b8513b75.power-log-command.pages.dev

Worker version: c4502a75-f168-4f4a-8fd8-c80534dc06b2

## Verified after deployment

Ran `QA_LIVE=1 python3 scripts/photo-browser-qa.py` against the public website, without intercepting frontend or API requests. Used the user's supplied local JPG and a Chromium simulated camera fed from that image. An isolated QA building and temporary account were created and archived after testing; real inspection records were not changed.

- Real login and QA dashboard loaded.
- Original JPG uploaded through the proof-photo input: HTTP 200 and GHL URL.
- In-page camera capture uploaded: HTTP 200 and GHL URL.
- Section-photo in-page capture returned HTTP 200 and structured AI results.
- All three library images decoded successfully in the browser.
- All three database photo records explicitly reported GHL as the backend.
- Proof-photo state persisted after reload.
- No browser page errors.

Live screenshot evidence: `/var/folders/k_/2sfdmjyx5w70lz156yf13l_00000gn/T/plc-photo-qa-8vfxmz8e/library.png`

Also ran `python3 scripts/camera-browser-qa.py`: 100 sequential simulated camera captures passed, every camera track was stopped and dialog removed, cancellation released the camera, and denied permission allowed the existing-photo fallback. This lifecycle stress test did not perform 100 network uploads.

`npm test`: 4 passed. `npm run build`: passed. `git diff --check`: passed.

## Change and limitations

Single-photo capture buttons now open an in-page camera instead of sending Chrome into the background to launch an external camera. Captures have a bounded resolution and release camera resources. The existing-photo picker remains an explicit fallback.

The exact low-memory toast is defined in Chromium as a restart during the file-picker operation; it does not establish that GHL storage is full. Reference: https://chromium.googlesource.com/chromium/src/+/e710ff9cf5df1216d8cd85114da372145036e612/ui/android/java/strings/android_ui_strings.grd

These tests used desktop Chromium with a mobile viewport and simulated camera, not a physical Samsung device. They verify the deployed upload/storage/display workflow, not Android OS memory behavior, photographic gauge-reading accuracy, annual storage capacity, or sustained multi-building load. Physical-device acceptance remains necessary. Test photos were retained under the archived QA buildings for evidence.
