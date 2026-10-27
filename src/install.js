// Making Inspect Funnels installable: registers the service worker and offers an
// "Install app" prompt. Android/desktop Chrome hand us a real install prompt; iPhones and iPads
// don't have one, so for those we show the two taps (Share, then Add to Home Screen).

const KEY = "if-install-dismissed";
const SNOOZE_DAYS = 14;
let deferred = null;

const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const canInstall = () => !isStandalone() && (Boolean(deferred) || isIOS());

function snoozed() {
  try {
    const at = Number(localStorage.getItem(KEY));
    return at && Date.now() - at < SNOOZE_DAYS * 86_400_000;
  } catch {
    return false;
  }
}
function snooze() {
  try {
    localStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* private mode: it just asks again next visit */
  }
}

// "Install the app" links placed in the page (login screen, footer) stay hidden until installing is possible.
export function installLinkHtml() {
  return `<button type="button" class="link-button install-link" data-install hidden>Install the app</button>`;
}
function syncLinks() {
  document.querySelectorAll("[data-install]").forEach((el) => (el.hidden = !canInstall()));
}

function sheet(title, bodyHtml) {
  document.querySelector("#install-sheet")?.remove();
  const wrap = document.createElement("div");
  wrap.id = "install-sheet";
  wrap.className = "modal-overlay";
  wrap.innerHTML = `<div class="modal-card install-card" role="dialog" aria-modal="true" aria-label="${title}">
    <h3>${title}</h3>${bodyHtml}
    <div class="inspection-actions"><button type="button" class="button button--primary" data-close>Got it</button></div></div>`;
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap || e.target.closest("[data-close]")) wrap.remove();
  });
  document.body.appendChild(wrap);
}

function showIosSteps() {
  sheet(
    "Add Inspect Funnels to your home screen",
    `<ol class="install-steps">
      <li><span>1</span><p>Tap the <strong>Share</strong> button <svg class="install-share" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4M6 11v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> at the bottom of Safari.</p></li>
      <li><span>2</span><p>Scroll down and tap <strong>Add to Home Screen</strong>.</p></li>
      <li><span>3</span><p>Tap <strong>Add</strong>. It opens full screen, like any other app.</p></li>
    </ol>
    <p class="quiet-label">Use Safari for this — it's the browser that offers “Add to Home Screen” on iPhone.</p>`,
  );
}

export async function promptInstall() {
  if (deferred) {
    const evt = deferred;
    deferred = null;
    removeBanner();
    evt.prompt();
    try {
      await evt.userChoice;
    } catch {
      /* the person closed the browser's own dialog */
    }
    syncLinks();
    return;
  }
  if (isIOS()) showIosSteps();
  else
    sheet(
      "Install Inspect Funnels",
      `<p>Open this page in Chrome, Edge or Safari, then use the browser menu and choose <strong>Install app</strong> (or <strong>Add to Home Screen</strong>).</p>`,
    );
}

function removeBanner() {
  document.querySelector("#install-banner")?.remove();
}

function showBanner() {
  if (document.querySelector("#install-banner") || !canInstall() || snoozed()) return;
  const banner = document.createElement("aside");
  banner.id = "install-banner";
  banner.className = "install-banner";
  banner.setAttribute("role", "region");
  banner.setAttribute("aria-label", "Install the app");
  banner.innerHTML = `
    <img src="/icons/icon-192.png" alt="" width="46" height="46" />
    <div class="install-banner__text"><strong>Install Inspect Funnels</strong><span>Opens full screen from your home screen.</span></div>
    <button type="button" class="button button--primary button--small" data-go>${deferred ? "Install" : "How"}</button>
    <button type="button" class="icon-button" data-no aria-label="Not now">×</button>`;
  banner.addEventListener("click", (e) => {
    if (e.target.closest("[data-go]")) {
      removeBanner();
      promptInstall();
    } else if (e.target.closest("[data-no]")) {
      snooze();
      removeBanner();
    }
  });
  document.body.appendChild(banner);
}

export function initInstall() {
  if ("serviceWorker" in navigator && import.meta.env.PROD) {
    window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch((error) => console.warn("Service worker not registered", error)));
  }
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event;
    syncLinks();
    setTimeout(showBanner, 4000);
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    removeBanner();
    syncLinks();
  });
  document.addEventListener("click", (e) => {
    if (e.target.closest?.("[data-install]")) promptInstall();
  });
  // The page is redrawn wholesale on every screen change, so keep any install links in step.
  new MutationObserver(syncLinks).observe(document.querySelector("#app"), { childList: true, subtree: true });
  syncLinks();
  if (isIOS() && !isStandalone()) setTimeout(showBanner, 6000);
}
