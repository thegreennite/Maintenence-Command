// The 3D world behind the page: a building that gets inspected floor by floor,
// a gauge that learns what "normal" is, and a photo that snaps into frame.
//
// Everything is driven by one plain object -- `state` -- that the scroll code
// (main.js) tweens. The render loop reads it every frame, so scrolling is just
// animating numbers; there is no scene logic anywhere else.
import * as THREE from "three";

const LIME = new THREE.Color(0xdceb61);
const DIM = new THREE.Color(0x1f5148);
const FOREST = 0x0f3a33;

export const state = {
  // camera + what it looks at
  cx: 10, cy: 5.6, cz: 14.5, tx: 0, ty: 3.5, tz: 0,
  // building
  bx: 0, bs: 1, bry: 0.6,
  // 0..1 progress values
  lit: 0, scan: 0, gauge: 0, needle: 0.2, polaroid: 0,
  // sideways framing: fraction of the viewport the whole scene is pushed by
  shift: -0.16,
};

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x07110f, 0.028);

  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 120);
  scene.add(camera);

  // ---- light ----------------------------------------------------------------
  scene.add(new THREE.HemisphereLight(0xcfe9e1, 0x07110f, 0.85));
  const sun = new THREE.DirectionalLight(0xffffff, 1.7);
  sun.position.set(7, 11, 6);
  scene.add(sun);
  const rim = new THREE.PointLight(0xdceb61, 18, 30, 2);
  rim.position.set(-6, 4, -5);
  scene.add(rim);

  // ---- ground -----------------------------------------------------------------
  const ground = new THREE.Mesh(
    new THREE.CylinderGeometry(11, 11, 0.2, 80),
    new THREE.MeshStandardMaterial({ color: 0x0b2521, roughness: 0.9, metalness: 0.05 }),
  );
  ground.position.y = -0.1;
  scene.add(ground);
  const grid = new THREE.GridHelper(22, 44, 0x2a6a5d, 0x143a34);
  grid.position.y = 0.011;
  grid.material.transparent = true;
  grid.material.opacity = 0.45;
  scene.add(grid);

  // ---- the building -------------------------------------------------------------
  const building = new THREE.Group();
  scene.add(building);
  const FLOORS = 12;
  const FLOOR_H = 0.62;
  const HEIGHT = FLOORS * FLOOR_H;
  const slabMat = new THREE.MeshStandardMaterial({ color: FOREST, roughness: 0.55, metalness: 0.15 });
  const edgeMat = new THREE.LineBasicMaterial({ color: 0xdceb61, transparent: true, opacity: 0.32 });
  for (let i = 0; i < FLOORS; i++) {
    const w = 4.4 - (i % 2 ? 0.08 : 0);
    const d = 3.2 - (i % 2 ? 0.08 : 0);
    const geo = new THREE.BoxGeometry(w, FLOOR_H - 0.06, d);
    const slab = new THREE.Mesh(geo, slabMat);
    slab.position.y = i * FLOOR_H + FLOOR_H / 2;
    building.add(slab);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat);
    edges.position.copy(slab.position);
    building.add(edges);
  }
  // rooftop plant: the mechanical room, the boiler stack
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x174c43, roughness: 0.5, metalness: 0.3 });
  const penthouse = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 1.2), roofMat);
  penthouse.position.set(-0.9, HEIGHT + 0.25, 0.2);
  building.add(penthouse);
  const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 1.1, 20), roofMat);
  stack.position.set(0.9, HEIGHT + 0.55, -0.4);
  building.add(stack);
  const unit = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, 0.7), roofMat);
  unit.position.set(0.6, HEIGHT + 0.15, 0.7);
  building.add(unit);

  // windows: one instanced mesh; each gets its own colour as the scan passes
  const faces = [
    { n: 6, axis: "z", sign: 1, span: 3.6, off: 1.62 },
    { n: 6, axis: "z", sign: -1, span: 3.6, off: 1.62 },
    { n: 4, axis: "x", sign: 1, span: 2.5, off: 2.22 },
    { n: 4, axis: "x", sign: -1, span: 2.5, off: 2.22 },
  ];
  const perFloor = faces.reduce((s, f) => s + f.n, 0);
  const windows = new THREE.InstancedMesh(new THREE.BoxGeometry(0.46, 0.26, 0.05), new THREE.MeshBasicMaterial({ color: 0xffffff }), FLOORS * perFloor);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const meta = []; // per window: floor index + a little random offset
  let wi = 0;
  for (let fl = 0; fl < FLOORS; fl++) {
    for (const f of faces) {
      for (let k = 0; k < f.n; k++) {
        const t = (k + 0.5) / f.n - 0.5;
        const pos = new THREE.Vector3();
        if (f.axis === "z") pos.set(t * f.span, fl * FLOOR_H + FLOOR_H / 2, f.sign * f.off);
        else pos.set(f.sign * f.off, fl * FLOOR_H + FLOOR_H / 2, t * f.span);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.axis === "x" ? Math.PI / 2 : 0);
        m.compose(pos, q, new THREE.Vector3(1, 1, 1));
        windows.setMatrixAt(wi, m);
        windows.setColorAt(wi, DIM);
        meta.push({ floor: fl, jitter: Math.random() * 0.5 });
        wi++;
      }
    }
  }
  building.add(windows);

  // the scan: a lime sheet of light sweeping up the building
  const scanMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uColor: { value: LIME }, uOpacity: { value: 0 } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader:
      "varying vec2 vUv; uniform vec3 uColor; uniform float uOpacity; void main(){ vec2 c = abs(vUv - 0.5) * 2.0; float edge = smoothstep(1.0, 0.55, max(c.x, c.y)); float ring = smoothstep(0.86, 0.97, max(c.x, c.y)) * (1.0 - smoothstep(0.97, 1.0, max(c.x, c.y))); gl_FragColor = vec4(uColor, (edge * 0.16 + ring * 0.9) * uOpacity); }",
  });
  const scan = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 4.4), scanMat);
  scan.rotation.x = -Math.PI / 2;
  building.add(scan);

  // dust in the air
  const dustGeo = new THREE.BufferGeometry();
  const dust = new Float32Array(420 * 3);
  for (let i = 0; i < 420; i++) {
    const r = 3 + Math.random() * 11;
    const a = Math.random() * Math.PI * 2;
    dust[i * 3] = Math.cos(a) * r;
    dust[i * 3 + 1] = Math.random() * 11;
    dust[i * 3 + 2] = Math.sin(a) * r;
  }
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dust, 3));
  const dustPoints = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xdceb61, size: 0.045, transparent: true, opacity: 0.55, depthWrite: false }));
  scene.add(dustPoints);

  // ---- the gauge ------------------------------------------------------------------
  const gauge = new THREE.Group();
  gauge.position.set(0, 3.2, 4);
  scene.add(gauge);
  const face = new THREE.Mesh(new THREE.CircleGeometry(1.6, 72), new THREE.MeshStandardMaterial({ color: 0xe9eee9, roughness: 0.6 }));
  gauge.add(face);
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(1.66, 0.14, 24, 100), new THREE.MeshStandardMaterial({ color: 0x1b2528, roughness: 0.35, metalness: 0.75 }));
  gauge.add(bezel);
  const SWEEP = 270; // degrees of needle travel
  const bandAngle = (v) => 90 + (0.5 - v) * SWEEP; // degrees from +x, anticlockwise
  const band = (v0, v1, color, r0 = 1.06, r1 = 1.3) => {
    const start = THREE.MathUtils.degToRad(bandAngle(v1));
    const len = THREE.MathUtils.degToRad((v1 - v0) * SWEEP);
    const mesh = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 48, 1, start, len), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    mesh.position.z = 0.012;
    return mesh;
  };
  gauge.add(band(0.42, 0.62, 0x2b8065));
  gauge.add(band(0.8, 1.0, 0xd84b3e));
  gauge.add(band(0.0, 0.1, 0xd84b3e));
  const tickMat = new THREE.MeshBasicMaterial({ color: 0x1b2528 });
  for (let i = 0; i <= 27; i++) {
    const v = i / 27;
    const a = THREE.MathUtils.degToRad(bandAngle(v));
    const major = i % 3 === 0;
    const tick = new THREE.Mesh(new THREE.BoxGeometry(major ? 0.05 : 0.025, major ? 0.2 : 0.11, 0.01), tickMat);
    tick.position.set(Math.cos(a) * 1.42, Math.sin(a) * 1.42, 0.016);
    tick.rotation.z = a - Math.PI / 2;
    gauge.add(tick);
  }
  const needle = new THREE.Group();
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.15, 0.02), new THREE.MeshStandardMaterial({ color: 0xd33b30, roughness: 0.4 }));
  blade.position.y = 0.5;
  needle.add(blade);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 0.02), blade.material);
  tail.position.y = -0.15;
  needle.add(tail);
  needle.position.z = 0.04;
  gauge.add(needle);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.06, 24), new THREE.MeshStandardMaterial({ color: 0x1b2528, metalness: 0.7, roughness: 0.3 }));
  hub.rotation.x = Math.PI / 2;
  hub.position.z = 0.05;
  gauge.add(hub);
  const alertRing = new THREE.Mesh(new THREE.RingGeometry(1.78, 1.86, 80), new THREE.MeshBasicMaterial({ color: 0xd84b3e, transparent: true, opacity: 0, side: THREE.DoubleSide }));
  alertRing.position.z = 0.02;
  gauge.add(alertRing);

  // ---- the photo -------------------------------------------------------------------
  const polaroid = new THREE.Group();
  camera.add(polaroid);
  const card = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.25, 0.025), new THREE.MeshStandardMaterial({ color: 0xf6f7f2, roughness: 0.8 }));
  polaroid.add(card);
  // The photo and the caption strip must not overlap (two flat surfaces at the same depth
  // flicker against each other), so there is a clear gap between them, and a small
  // polygon offset keeps both stable in front of the card.
  const PHOTO_W = 0.88;
  const PHOTO_H = 0.84;
  const photoMat = new THREE.MeshBasicMaterial({ color: 0x244e46, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const photo = new THREE.Mesh(new THREE.PlaneGeometry(PHOTO_W, PHOTO_H), photoMat);
  photo.position.set(0, 0.13, 0.016);
  polaroid.add(photo);
  new THREE.TextureLoader().load("./shots/photo-boiler.jpg", (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    // Crop (don't stretch): show the middle of the picture at the frame's own proportions.
    const frameAspect = PHOTO_W / PHOTO_H;
    const imageAspect = tex.image.width / tex.image.height;
    if (imageAspect > frameAspect) {
      tex.repeat.x = frameAspect / imageAspect;
      tex.offset.x = (1 - tex.repeat.x) / 2;
    }
    photoMat.map = tex;
    photoMat.color.set(0xffffff);
    photoMat.needsUpdate = true;
  });
  const cap = document.createElement("canvas");
  cap.width = 512;
  cap.height = 150;
  const cctx = cap.getContext("2d");
  cctx.fillStyle = "#f6f7f2";
  cctx.fillRect(0, 0, 512, 150);
  cctx.fillStyle = "#0f3a33";
  cctx.font = "700 40px Arial, sans-serif";
  cctx.fillText("10:41 AM  ·  ✓", 24, 62);
  cctx.fillStyle = "#5c6b68";
  cctx.font = "500 29px Arial, sans-serif";
  cctx.fillText("43.6426° N, 79.3871° W · 18 m away", 24, 112);
  const capTex = new THREE.CanvasTexture(cap);
  capTex.colorSpace = THREE.SRGBColorSpace;
  const caption = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.264), new THREE.MeshBasicMaterial({ map: capTex, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  caption.position.set(0, -0.455, 0.016);
  polaroid.add(caption);
  polaroid.visible = false;

  // ---- sizing ------------------------------------------------------------------------
  let width = 1;
  let height = 1;
  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, width < 700 ? 1.5 : 1.75);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.fov = width / height < 0.8 ? 46 : 34;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener("resize", resize);

  // ---- frame ---------------------------------------------------------------------------
  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  window.addEventListener("pointermove", (e) => {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
  });
  const color = new THREE.Color();
  const ease = (t) => t * t * (3 - 2 * t);
  const startedAt = performance.now();
  let reduced = false;
  let running = true;
  const stats = { fps: 0, frames: 0, last: performance.now() };

  function frame() {
    const t = reduced ? 0 : (performance.now() - startedAt) / 1000;
    pointer.sx += (pointer.x - pointer.sx) * 0.05;
    pointer.sy += (pointer.y - pointer.sy) * 0.05;

    // camera, with a little parallax from the pointer
    camera.position.set(state.cx + pointer.sx * 0.5, state.cy - pointer.sy * 0.3, state.cz);
    camera.lookAt(state.tx, state.ty, state.tz);
    const shift = width > 760 ? state.shift : state.shift * 0.35;
    camera.setViewOffset(width, height, shift * width, 0, width, height);

    // building
    building.position.x = state.bx;
    building.scale.setScalar(state.bs);
    building.rotation.y = state.bry + t * 0.035;
    scan.position.y = 0.05 + state.scan * (HEIGHT + 0.3);
    scanMat.uniforms.uOpacity.value = state.scan > 0.005 && state.scan < 0.995 ? 1 : 0;

    // windows light up from the bottom as `lit` climbs (with the scan sweep on top)
    const litFloor = state.lit * (FLOORS + 1.2);
    for (let i = 0; i < meta.length; i++) {
      const d = litFloor - meta[i].floor - meta[i].jitter;
      const k = THREE.MathUtils.clamp(d, 0, 1);
      color.copy(DIM).lerp(LIME, ease(k));
      // twinkle on the lit ones
      if (k > 0.99) color.multiplyScalar(0.9 + 0.1 * Math.sin(t * 1.4 + i * 1.7));
      windows.setColorAt(i, color);
    }
    windows.instanceColor.needsUpdate = true;

    // gauge
    const g = ease(THREE.MathUtils.clamp(state.gauge, 0, 1));
    gauge.visible = g > 0.001;
    gauge.scale.setScalar(Math.max(g * 0.85, 0.0001));
    gauge.rotation.y = (1 - g) * 0.9 + Math.sin(t * 0.6) * 0.05;
    needle.rotation.z = THREE.MathUtils.degToRad((0.5 - state.needle) * SWEEP) + Math.sin(t * 9) * 0.004 * g;
    const alert = THREE.MathUtils.clamp((state.needle - 0.74) / 0.1, 0, 1);
    alertRing.material.opacity = alert * (0.45 + 0.4 * Math.sin(t * 6));
    alertRing.scale.setScalar(1 + alert * 0.04 * Math.sin(t * 6));

    // the photo, pinned to the camera so it always lands in frame
    const p = THREE.MathUtils.clamp(state.polaroid, 0, 1);
    polaroid.visible = p > 0.002;
    const e = ease(p);
    polaroid.position.set(THREE.MathUtils.lerp(-0.7, -0.08, e), THREE.MathUtils.lerp(-1.6, 0.05, e), THREE.MathUtils.lerp(-2.0, -3.4, e));
    polaroid.rotation.set(0, THREE.MathUtils.lerp(0.6, -0.12, e), THREE.MathUtils.lerp(-0.8, 0.07, e) + Math.sin(t * 0.8) * 0.01 * e);
    polaroid.scale.setScalar(THREE.MathUtils.lerp(0.2, 0.95, e));

    dustPoints.rotation.y = t * 0.012;
    renderer.render(scene, camera);

    stats.frames++;
    const now = performance.now();
    if (now - stats.last > 1000) {
      stats.fps = Math.round((stats.frames * 1000) / (now - stats.last));
      stats.frames = 0;
      stats.last = now;
    }
  }
  renderer.setAnimationLoop(() => running && frame());

  return {
    stats,
    renderOnce: frame,
    setReduced(v) { reduced = v; },
    pause() { running = false; },
    resume() { running = true; },
    dispose() { renderer.setAnimationLoop(null); renderer.dispose(); },
  };
}
