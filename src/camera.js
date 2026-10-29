// Capture inside the page: Android's external camera/file picker can kill
// Chrome while it is in the background, losing the pending file selection.
const captures = new WeakMap();
export function liveCaptureTime(file) { return captures.get(file); }

export function showPhotoFeedback(success, message) {
  document.querySelector('.photo-feedback')?.remove();
  const panel = document.createElement('div');
  panel.className = `photo-feedback photo-feedback--${success ? 'success' : 'error'}`;
  panel.setAttribute('role', success ? 'status' : 'alert');
  panel.innerHTML = `<svg viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="23"/><path d="${success ? 'M14 27l8 8 17-18' : 'M18 18l16 16M34 18L18 34'}"/></svg><div><strong>${success ? 'Photo Saved' : 'Photo Not Saved'}</strong><p></p></div><button type="button" aria-label="Dismiss photo notification">×</button>`;
  panel.querySelector('p').textContent = message;
  panel.querySelector('button').onclick = () => panel.remove();
  document.body.append(panel);
  if (success) setTimeout(() => panel.remove(), 5000);
}

export function installCameraCapture() {
  let active = false;
  document.addEventListener('click', (event) => {
    if (event.target.matches?.('input[type="file"][capture]:not([multiple])')) {
      event.preventDefault();
      if (!active) openCamera(event.target);
    }
  }, true);
  document.addEventListener("click", (event) => {
    const label = event.target.closest("label[for]");
    const input = label && document.getElementById(label.htmlFor);
    if (!input?.matches('input[type="file"][capture]') || input.multiple) return;
    event.preventDefault();
    if (!active) openCamera(input);
  }, true);

  async function openCamera(input) {
    active = true;
    let stream;
    const dialog = document.createElement("dialog");
    dialog.className = "inspection-camera";
    dialog.innerHTML = `<h2>Take Inspection Photo</h2>
      <div class="inspection-camera__view"><video autoplay muted playsinline></video></div>
      <p role="status">Starting camera…</p>
      <div class="inspection-camera__actions">
        <button type="button" class="button button--primary" data-shutter disabled>Take Photo</button>
        <button type="button" class="button button--outline" data-cancel>Cancel</button>
      </div>`;
    document.body.append(dialog);
    const video = dialog.querySelector("video");
    const status = dialog.querySelector('[role="status"]');
    const shutter = dialog.querySelector("[data-shutter]");
    function stop() {
      stream?.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
    }
    function close() {
      stop();
      dialog.close();
      dialog.remove();
      active = false;
      window.removeEventListener("pagehide", close);
    }
    dialog.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
    dialog.querySelector("[data-cancel]").onclick = close;
    window.addEventListener("pagehide", close);
    shutter.onclick = async () => {
      shutter.disabled = true;
      const canvas = document.createElement("canvas");
      try {
        if (!video.videoWidth || !video.videoHeight) throw new Error("Camera is not ready yet.");
        const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
        const capturedAt = new Date().toISOString();
        stop();
        status.textContent = "Preparing photo…";
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
        if (!blob) throw new Error("Could not capture the photo. Please reopen the camera.");
        if (!dialog.isConnected) return;
        if (!input.isConnected) throw new Error("The inspection changed. Close this camera and try again.");
        const transfer = new DataTransfer();
        const file = new File([blob], `inspection-${Date.now()}.jpg`, { type: "image/jpeg" });
        transfer.items.add(file);
        input.files = transfer.files;
        captures.set(input.files[0], capturedAt);
        close();
        input.dispatchEvent(new Event("change", { bubbles: true }));
      } catch (error) {
        status.textContent = error.message;
        showPhotoFeedback(false, error.message);
      } finally {
        canvas.width = canvas.height = 0;
      }
    };
    dialog.showModal();
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera access is unavailable.");
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280, max: 1920 }, height: { ideal: 720, max: 1920 } },
      });
      if (!dialog.isConnected) { stop(); return; }
      video.srcObject = stream;
      await video.play();
      enableTapToFocus(video, stream.getVideoTracks()[0]);
      shutter.disabled = false;
      status.textContent = "Frame the equipment, then tap Take Photo.";
    } catch (error) {
      stop();
      status.textContent = error.name === "NotAllowedError"
        ? "Camera permission was denied. Allow camera access in this site's settings, then reopen the camera. Live photos are required."
        : "Could not start the camera. Close and try again. Live photos are required.";
      showPhotoFeedback(false, status.textContent);
    }
  }
}

// Tap the picture to focus there (where the phone's camera lets a web page do that --
// most Android phones in Chrome; iPhone Safari doesn't, and just keeps its own autofocus).
// Never blocks or changes the photo: if anything is unsupported it quietly does nothing.
function enableTapToFocus(video, track) {
  const caps = track?.getCapabilities?.() || {};
  const modes = caps.focusMode || [];
  if (!modes.length) return;
  // Let the camera keep refocusing on its own between taps.
  if (modes.includes("continuous")) track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(() => {});

  const view = video.parentElement;
  video.addEventListener("pointerdown", (event) => {
    const box = video.getBoundingClientRect();
    // The picture is letterboxed inside the <video> (object-fit: contain): only taps on the image count.
    const scale = Math.min(box.width / video.videoWidth, box.height / video.videoHeight);
    const shownW = video.videoWidth * scale;
    const shownH = video.videoHeight * scale;
    const left = box.left + (box.width - shownW) / 2;
    const top = box.top + (box.height - shownH) / 2;
    const x = (event.clientX - left) / shownW;
    const y = (event.clientY - top) / shownH;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;

    const ring = document.createElement("span");
    ring.className = "inspection-camera__focus";
    const viewBox = view.getBoundingClientRect();
    ring.style.left = `${event.clientX - viewBox.left}px`;
    ring.style.top = `${event.clientY - viewBox.top}px`;
    view.append(ring);
    setTimeout(() => ring.remove(), 900);

    const mode = modes.includes("single-shot") ? "single-shot" : modes.includes("manual") ? "manual" : null;
    if (!mode) return;
    const constraint = { focusMode: mode, pointsOfInterest: [{ x, y }] };
    track
      .applyConstraints({ advanced: [constraint] })
      .catch(() => track.applyConstraints({ advanced: [{ focusMode: mode }] }).catch(() => {}))
      .then(() => {
        // After the one-off focus, go back to continuous so the next shot isn't left blurry.
        if (modes.includes("continuous")) setTimeout(() => track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(() => {}), 1200);
      });
  });
}
