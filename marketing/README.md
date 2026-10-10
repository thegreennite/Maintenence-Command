# Inspect N Snap — marketing site (dev page)

The 3D, scroll-animated website for **inspectnsnap.com**. This is a *dev preview*: it is
`noindex`, shows a "DEV PREVIEW" bar, and its demo form does not send anything yet.

## Run it
```bash
cd marketing
npm install
npm run dev        # http://localhost:5180
npm run build      # -> dist/
npm run deploy:dev # builds and publishes to the inspectnsnap-dev Cloudflare Pages project
```
The dev bar (bottom-left) always shows FPS, current chapter and scroll %.

## How it works
- `src/scene.js` — the Three.js world: a 12-floor building whose windows light up as it is
  "inspected", a gauge that learns a normal range then drifts, and a photo that snaps into frame.
  Everything is driven by one plain `state` object; the render loop just reads it.
- `src/main.js` — Lenis smooth scroll + GSAP ScrollTrigger. A camera path (`K`) tweens `state`
  between chapters; the Walk chapter is pinned; headings split into words and rise out of masks;
  marquees speed up with scroll velocity; magnetic buttons, tilt cards, custom cursor.
- `src/style.css` — layout, type (Inter Tight + Instrument Serif), responsive rules.
- `public/shots/` — real screenshots of the app (taken from a local demo database).

Respects `prefers-reduced-motion` (no smooth scroll, no pinning, static 3D) and falls back to a flat
gradient if WebGL is unavailable.

## Before it goes live on inspectnsnap.com
- [ ] Buy/point the domain (it was unregistered when this was built) and attach it to a Pages project.
- [ ] Hide or remove the `.devbar` in `index.html`; remove the `noindex` meta and `public/_headers` rule.
- [ ] Connect the demo form (`#ctaForm`) to something real (email, GoHighLevel form, Cal.com…).
- [ ] Swap the illustrated sample photos in `public/shots/photo-*.jpg` and the polaroid for real ones, if wanted.
- [ ] Only claims backed by the product are on the page; the weekly-report table is labelled "sample data".
- [ ] Add analytics and an Open Graph image.
