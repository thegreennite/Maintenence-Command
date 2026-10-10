import "./style.css";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { createScene, state } from "./scene.js";

gsap.registerPlugin(ScrollTrigger);

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const touch = window.matchMedia("(hover: none)").matches;

// ---------------------------------------------------------------------------
// Camera path: where the 3D world is at the start of each chapter. Scrolling
// between two chapters tweens from one set of numbers to the next.
// ---------------------------------------------------------------------------
const K = {
  hero:   { cx: 10,   cy: 5.6, cz: 14.5, tx: 0, ty: 3.5, tz: 0, bx: 0,  bs: 1,    bry: 0.6, lit: 0,    scan: 0, gauge: 0, shift: -0.2 },
  walk:   { cx: -9,   cy: 4.4, cz: 11.5,  tx: 0, ty: 3.2, tz: 0, bx: 0,  bs: 1,    bry: 1.3, lit: 0.8,  scan: 1, gauge: 0, shift: -0.2 },
  snap:   { cx: 5,    cy: 3,   cz: 12,   tx: 0, ty: 3.2, tz: 0, bx: -3, bs: 0.8,  bry: 2.1, lit: 0.8,  scan: 1, gauge: 0, shift: 0.22 },
  learn:  { cx: 0,    cy: 3.2, cz: 12.5, tx: 0, ty: 3.2, tz: 4, bx: -7, bs: 0.65, bry: 2.6, lit: 0.85, scan: 1, gauge: 1, shift: -0.2 },
  read:   { cx: 11,   cy: 8.5, cz: 15,   tx: 0, ty: 3,   tz: 0, bx: 4,  bs: 0.7,  bry: 3.3, lit: 0.9,  scan: 1, gauge: 0, shift: -0.05 },
  prove:  { cx: -9,   cy: 3.4, cz: 9,    tx: 0, ty: 3,   tz: 0, bx: -2, bs: 0.8,  bry: 4,   lit: 0.95, scan: 1, gauge: 0, shift: 0.1 },
  report: { cx: 0.1,  cy: 17,  cz: 5,    tx: 0, ty: 0,   tz: 0, bx: 0,  bs: 1,    bry: 4.6, lit: 1,    scan: 1, gauge: 0, shift: 0 },
  crew:   { cx: -10,  cy: 3,   cz: 7,    tx: 0, ty: 3.4, tz: 0, bx: 1,  bs: 0.95, bry: 5.3, lit: 1,    scan: 1, gauge: 0, shift: 0.12 },
  cta:    { cx: 9,    cy: 4.6, cz: 12,   tx: 0, ty: 3.4, tz: 0, bx: 0,  bs: 1.05, bry: 6.4, lit: 1,    scan: 1, gauge: 0, shift: 0 },
};
const ORDER = ["hero", "walk", "snap", "learn", "read", "prove", "report", "crew", "cta"];
const LABELS = { hero: "Start", walk: "Walk", snap: "Snap", learn: "Learn", read: "Read", prove: "Prove", report: "Report", crew: "Crew", cta: "Book" };

Object.assign(state, K.hero);

// ---------------------------------------------------------------------------
// 3D scene (falls back to a plain gradient if WebGL isn't available)
// ---------------------------------------------------------------------------
let scene = null;
try {
  scene = createScene($("#gl"));
  if (reduced) scene.setReduced(true);
} catch (error) {
  console.warn("WebGL unavailable — showing the flat version.", error);
  document.documentElement.classList.add("no-webgl");
}

// ---------------------------------------------------------------------------
// Smooth scroll, wired into ScrollTrigger
// ---------------------------------------------------------------------------
let lenis = null;
if (!reduced) {
  lenis = new Lenis({ lerp: 0.09, wheelMultiplier: 0.95, smoothTouch: false });
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
}
const scrollTo = (target) => (lenis ? lenis.scrollTo(target, { offset: -10, duration: 1.6 }) : $(target)?.scrollIntoView({ behavior: "smooth" }));
$$('a[href^="#"]').forEach((a) =>
  a.addEventListener("click", (event) => {
    const id = a.getAttribute("href");
    if (id.length < 2) return;
    event.preventDefault();
    scrollTo(id);
  }),
);

// ---------------------------------------------------------------------------
// Words that rise out of a mask
// ---------------------------------------------------------------------------
function splitWords(el) {
  const out = [];
  const walk = (node, into) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === 3) {
        child.textContent.split(/(\s+)/).forEach((part) => {
          if (!part) return;
          if (/^\s+$/.test(part)) {
            into.append(document.createTextNode(" "));
            return;
          }
          const outer = document.createElement("span");
          outer.className = "w";
          const inner = document.createElement("span");
          inner.className = "wi";
          inner.textContent = part;
          outer.append(inner);
          into.append(outer);
          out.push(inner);
        });
      } else if (child.nodeType === 1) {
        const clone = child.cloneNode(false);
        walk(child, clone);
        into.append(clone);
      }
    });
  };
  const holder = document.createDocumentFragment();
  walk(el, holder);
  el.textContent = "";
  el.append(holder);
  return out;
}

// ---------------------------------------------------------------------------
// Everything that depends on layout is built after the loader finishes
// ---------------------------------------------------------------------------
function build() {
  const sections = Object.fromEntries(ORDER.map((id) => [id, $(`[data-chapter="${id}"]`)]));

  // -- walk: pinned, the building is inspected while the phone steps through ----
  const phone = $("#phone");
  const screens = $$(".phone__screen", phone);
  const caption = $("#phoneCaption");
  const captions = ['<b>Step 1</b> Enter the reading', "<b>Step 2</b> It asks when something looks off"];
  let step = 0;
  const setStep = (n) => {
    if (n === step) return;
    step = n;
    caption.innerHTML = captions[n];
    screens.forEach((s, i) => s.classList.toggle("is-on", i === n));
    phone.classList.remove("buzz");
    void phone.offsetWidth;
    phone.classList.add("buzz");
  };
  if (!reduced) {
    state.lit = 0.04;
    state.scan = 0;
    ScrollTrigger.create({
      trigger: sections.walk,
      start: "top top",
      end: "+=240%",
      pin: true,
      scrub: true,
      onUpdate: (self) => {
        state.scan = self.progress;
        state.lit = 0.04 + self.progress * 0.76;
        setStep(self.progress > 0.52 ? 1 : 0);
      },
    });
  } else {
    state.lit = 1;
  }

  // Created AFTER the pin above, so these triggers account for the pin's extra scroll length.
  // -- camera path --------------------------------------------------------
  if (!reduced) {
    for (let i = 1; i < ORDER.length; i++) {
      const prev = K[ORDER[i - 1]];
      const next = K[ORDER[i]];
      const from = { ...prev };
      const to = { ...next };
      // Inside the pinned "walk" chapter, lit and scan are driven by the scan timeline instead.
      if (ORDER[i] === "walk") for (const k of ["lit", "scan"]) { delete from[k]; delete to[k]; }
      gsap.fromTo(state, from, {
        ...to,
        ease: "none",
        immediateRender: false,
        scrollTrigger: { trigger: sections[ORDER[i]], start: ORDER[i] === "walk" ? "top 90%" : "top 85%", end: ORDER[i] === "walk" ? "top top" : "top 10%", scrub: 1.1 },
      });
    }
  }

  // -- snap: the photo flies into frame, with a flash ------------------------------
  if (!reduced) {
    gsap.fromTo(state, { polaroid: 0 }, {
      polaroid: 1, ease: "none", immediateRender: false,
      scrollTrigger: {
        trigger: sections.snap, start: "top 65%", end: "top 15%", scrub: 0.8,
        onEnter: () => doFlash(),
        onLeaveBack: () => (state.polaroid = 0),
      },
    });
    gsap.fromTo(state, { polaroid: 1 }, {
      polaroid: 0, ease: "none", immediateRender: false,
      scrollTrigger: { trigger: sections.snap, start: "bottom 75%", end: "bottom 35%", scrub: 0.8 },
    });
  } else {
    state.polaroid = 0;
  }

  // -- learn: the needle finds normal, then drifts -------------------------------------
  const status = $("#gaugeStatus");
  const paintStatus = () => {
    const v = state.needle;
    const next = v >= 0.74 ? "alert" : v >= 0.4 ? "ok" : "learn";
    if (status.dataset.s === next) return;
    status.dataset.s = next;
    status.textContent = { learn: "Learning the baseline…", ok: "Normal range learned ✓", alert: "Drift detected — flagged for review" }[next];
  };
  gsap.ticker.add(paintStatus);
  if (!reduced) {
    state.needle = 0.14;
    gsap.fromTo(state, { needle: 0.14 }, { needle: 0.53, ease: "none", immediateRender: false, scrollTrigger: { trigger: sections.learn, start: "top 55%", end: "top 15%", scrub: 0.6 } });
    gsap.fromTo(state, { needle: 0.53 }, { needle: 0.94, ease: "none", immediateRender: false, scrollTrigger: { trigger: sections.learn, start: "center 55%", end: "bottom 45%", scrub: 0.6 } });
  } else {
    state.needle = 0.53;
  }

  // -- text + cards ---------------------------------------------------------------------
  $$(".reveal").forEach((el) => {
    const words = splitWords(el);
    if (reduced) return;
    gsap.set(words, { yPercent: 115 });
    ScrollTrigger.create({
      trigger: el, start: "top 86%", once: true,
      onEnter: () => gsap.to(words, { yPercent: 0, duration: 1.05, stagger: 0.045, ease: "expo.out" }),
    });
  });
  if (!reduced) {
    $$(".reveal-p").forEach((el) => {
      gsap.from(el, { y: 36, opacity: 0, duration: 1, ease: "power3.out", scrollTrigger: { trigger: el, start: "top 90%", once: true } });
    });
    $$(".trio, .cards3").forEach((group) => {
      gsap.from($$(".reveal-card", group), { y: 70, opacity: 0, duration: 1.1, stagger: 0.14, ease: "power3.out", scrollTrigger: { trigger: group, start: "top 85%", once: true } });
    });
    $$(".sheet__row").forEach((row, i) => {
      gsap.from(row, { x: -60, opacity: 0, duration: 0.9, delay: i * 0.05, ease: "power3.out", scrollTrigger: { trigger: row, start: "top 92%", once: true } });
    });
    $$(".sheet i.bad").forEach((cell) => {
      gsap.fromTo(cell, { boxShadow: "0 0 0 0 rgba(216,75,62,0)" }, { boxShadow: "0 0 0 10px rgba(216,75,62,0.0)", duration: 1.4, repeat: -1, ease: "power2.out", onRepeat: () => {}, scrollTrigger: { trigger: cell, start: "top 85%", toggleActions: "play pause resume pause" } });
    });
    $$("[data-parallax]").forEach((el) => {
      const amount = Number(el.dataset.parallax) || 40;
      gsap.fromTo(el, { y: amount }, { y: -amount, ease: "none", scrollTrigger: { trigger: el, start: "top bottom", end: "bottom top", scrub: true } });
    });
    $$(".num").forEach((el) => {
      gsap.from(el, { x: -40, opacity: 0, duration: 0.9, ease: "power3.out", scrollTrigger: { trigger: el, start: "top 90%", once: true } });
    });
    $$("[data-count]").forEach((el) => {
      const end = Number(el.dataset.count);
      const obj = { n: 0 };
      ScrollTrigger.create({ trigger: el, start: "top 90%", once: true, onEnter: () => gsap.to(obj, { n: end, duration: 1.4, ease: "power2.out", onUpdate: () => (el.textContent = Math.round(obj.n)) }) });
    });
    // phones + frames lift slightly as they pass
    $$(".frame, .browser, .phone--small").forEach((el) => {
      gsap.from(el, { y: 90, opacity: 0, scale: 0.94, duration: 1.2, ease: "power3.out", scrollTrigger: { trigger: el, start: "top 90%", once: true } });
    });
  }

  // -- progress bar + chapter dots -------------------------------------------------------------
  const bar = $("#progressbar");
  ScrollTrigger.create({ start: 0, end: "max", onUpdate: (self) => (bar.style.transform = `scaleX(${self.progress})`) });
  const dots = $("#dots");
  const dotEls = {};
  ORDER.forEach((id) => {
    const li = document.createElement("li");
    li.innerHTML = `<button type="button" aria-label="${LABELS[id]}" data-cursor="${LABELS[id]}"><span>${LABELS[id]}</span></button>`;
    li.firstChild.addEventListener("click", () => scrollTo(sections[id]));
    dots.append(li);
    dotEls[id] = li;
  });
  // The active chapter is whichever section has crossed the middle of the screen.
  const paintChapter = () => {
    let active = ORDER[0];
    for (const id of ORDER) if (sections[id].getBoundingClientRect().top <= innerHeight * 0.55) active = id;
    if (active === current && dotEls[active].classList.contains("is-on")) return;
    current = active;
    ORDER.forEach((id) => dotEls[id].classList.toggle("is-on", id === active));
  };
  ScrollTrigger.create({ start: 0, end: "max", onUpdate: paintChapter, onRefresh: paintChapter });
  gsap.ticker.add(paintChapter);

  // nav hides on the way down, returns on the way up
  let lastY = 0;
  ScrollTrigger.create({
    start: 0, end: "max",
    onUpdate: (self) => {
      const y = self.scroll();
      $("#nav").classList.toggle("is-hidden", y > lastY && y > 240);
      $("#nav").classList.toggle("is-solid", y > 80);
      lastY = y;
    },
  });

  ScrollTrigger.refresh();
  // Late-loading images and fonts change the page height: re-measure every trigger.
  $$("img").forEach((img) => { if (!img.complete) img.addEventListener("load", () => ScrollTrigger.refresh(), { once: true }); });
  window.addEventListener("load", () => ScrollTrigger.refresh());
  document.fonts?.ready.then(() => ScrollTrigger.refresh());
}

let current = "hero";

// ---------------------------------------------------------------------------
// Little things: flash, cursor, magnetic buttons, tilt, marquee, form
// ---------------------------------------------------------------------------
function doFlash() {
  const f = $("#flash");
  gsap.killTweensOf(f);
  gsap.fromTo(f, { opacity: 0.85 }, { opacity: 0, duration: 0.7, ease: "power2.out" });
}

if (!touch) {
  const cursor = $("#cursor");
  const label = $("#cursorlabel");
  const pos = { x: innerWidth / 2, y: innerHeight / 2, tx: innerWidth / 2, ty: innerHeight / 2 };
  window.addEventListener("pointermove", (e) => { pos.tx = e.clientX; pos.ty = e.clientY; cursor.classList.add("is-live"); });
  gsap.ticker.add(() => {
    pos.x += (pos.tx - pos.x) * 0.2;
    pos.y += (pos.ty - pos.y) * 0.2;
    cursor.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;
  });
  document.addEventListener("pointerover", (e) => {
    const el = e.target.closest?.("[data-cursor], a, button, input");
    cursor.classList.toggle("is-link", Boolean(el));
    label.textContent = el?.dataset?.cursor || "";
    cursor.classList.toggle("has-label", Boolean(el?.dataset?.cursor));
  });
  document.addEventListener("pointerdown", () => cursor.classList.add("is-down"));
  document.addEventListener("pointerup", () => cursor.classList.remove("is-down"));

  $$(".magnetic").forEach((el) => {
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      gsap.to(el, { x: (e.clientX - r.left - r.width / 2) * 0.28, y: (e.clientY - r.top - r.height / 2) * 0.4, duration: 0.4, ease: "power3.out" });
    });
    el.addEventListener("pointerleave", () => gsap.to(el, { x: 0, y: 0, duration: 0.7, ease: "elastic.out(1, 0.45)" }));
  });
  $$("[data-tilt]").forEach((el) => {
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      gsap.to(el, { rotationY: px * 10, rotationX: -py * 8, transformPerspective: 900, duration: 0.5, ease: "power3.out" });
    });
    el.addEventListener("pointerleave", () => gsap.to(el, { rotationY: 0, rotationX: 0, duration: 0.8, ease: "power3.out" }));
  });
}

// marquees: always drifting, faster and skewed while you scroll
$$(".marquee__row").forEach((row) => {
  const dir = Number(row.dataset.dir) || -1;
  const half = () => row.scrollWidth / 2;
  let x = dir < 0 ? 0 : -half();
  gsap.ticker.add(() => {
    const v = lenis ? lenis.velocity : 0;
    x += dir * (0.6 + Math.min(Math.abs(v) * 0.5, 14)) * (reduced ? 0 : 1);
    if (x <= -half()) x += half();
    if (x >= 0) x -= half();
    row.style.transform = `translate3d(${x}px,0,0) skewX(${(-v * 0.25).toFixed(2)}deg)`;
  });
});

// the form is a placeholder on the dev page
$("#ctaForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $("#email");
  const note = $("#ctaNote");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value)) {
    note.textContent = "That email doesn’t look right.";
    note.classList.add("is-error");
    return;
  }
  note.classList.remove("is-error");
  note.textContent = "Dev preview: the form isn’t connected yet, so nothing was sent.";
  doFlash();
});

// ---------------------------------------------------------------------------
// Loader -> hero entrance
// ---------------------------------------------------------------------------
async function start() {
  const num = $("#loadnum");
  const counter = { n: 0 };
  const ready = Promise.all([
    document.fonts?.ready ?? Promise.resolve(),
    ...$$("img").slice(0, 6).map((img) => (img.complete ? Promise.resolve() : new Promise((r) => (img.onload = img.onerror = r)))),
  ]).catch(() => {});
  const tween = gsap.to(counter, { n: 90, duration: 1.4, ease: "power1.out", onUpdate: () => (num.textContent = Math.round(counter.n)) });
  await Promise.race([ready, new Promise((r) => setTimeout(r, 4000))]);
  tween.kill();
  await new Promise((resolve) => gsap.to(counter, { n: 100, duration: 0.4, ease: "none", onUpdate: () => (num.textContent = Math.round(counter.n)), onComplete: resolve }));

  document.documentElement.classList.add("is-loaded");
  doFlash();
  const tl = gsap.timeline();
  tl.to("#loader", { yPercent: -100, duration: 1, ease: "expo.inOut" }, 0.15)
    .from(".hero__title .line__in", { yPercent: 118, duration: 1.3, stagger: 0.12, ease: "expo.out" }, 0.7)
    .from(".hero__eyebrow, .hero__lede, .hero__cta > *, .hero__meta > *", { y: 30, opacity: 0, duration: 1, stagger: 0.08, ease: "power3.out" }, 1.0)
    .from(".nav", { yPercent: -100, duration: 0.9, ease: "power3.out" }, 1.1)
    .set("#loader", { display: "none" });
  build();
}

// dev stats (FPS, chapter, scroll)
setInterval(() => {
  const el = $("#devstats");
  if (!el) return;
  const y = lenis ? lenis.scroll : window.scrollY;
  const max = document.documentElement.scrollHeight - innerHeight;
  el.textContent = `${scene ? scene.stats.fps : 0} fps · ${current} · ${Math.round((y / Math.max(max, 1)) * 100)}%${reduced ? " · reduced motion" : ""}`;
}, 400);
document.addEventListener("visibilitychange", () => (document.hidden ? scene?.pause() : scene?.resume()));

window.__site = { state, K, scene, lenis, gsap, ScrollTrigger };
start();
