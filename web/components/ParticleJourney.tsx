"use client";
// ParticleJourney: ONE particle system for the whole landing page, on one fixed <canvas>.
//
// The idea in plain words:
//   1. We turn 7 pictures into 7 lists of points: the Mosaic logo, a handshake, a receipt, a storefront, a bank,
//      a shield, and the logo again. Every list has the SAME number of points.
//   2. Particle number i always belongs to point number i of every list. So "morphing" is just sliding each particle
//      from its point in one shape to its point in the next.
//   3. The landing page marks where each shape belongs with data-shape-index="0".."6" (and data-shape-side).
//      GSAP ScrollTrigger (scrub: true) turns the scroll position into one number, `progress`, from 0 to 6.
//      progress = 2.5 means "halfway between shape 2 and shape 3". Scroll back up and the same number comes back,
//      so the animation plays in exact reverse: nothing runs on its own clock except the tiny idle drift.
//   4. A second layer, "dust" (thousands of tiny specks), drifts across the whole page and is pushed away by the cursor.
//      Dust and shapes share this ONE canvas. Dust never reads the scroll progress; only the shape squares do.
//   5. Each frame we draw every particle with fillRect.
//
// Words: lerp = blend between two values (lerp(a, b, 0.5) is halfway); easing = start and end slowly instead of at a
// constant speed; stagger = each particle starts slightly later than the last, so the shape streams apart.
import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { TILES } from "./Logo";
import { handshakeIcon, landmarkIcon, receiptIcon, shieldIcon, storeIcon, type IconNode } from "./journeyIcons";

const SHAPES = 7; // logo, handshake, receipt, storefront, bank, shield, logo
const DESKTOP_COUNT = 900, MOBILE_COUNT = 420; // the shape particles (clean little circles)
const DESKTOP_DUST = 2400, MOBILE_DUST = 700; // the ambient specks
const GRID = 256; // size of the offscreen canvas we draw each shape on, in pixels
const STAGGER = 0.3; // the latest particle starts 30% later than the first

interface Pts { x: Float32Array; y: Float32Array; a: Float32Array } // x, y in 0..1 inside the shape's box; a = opacity (1 or paler)
type Side = "left" | "right" | "center";

// ---------- 1. Turn pictures into points (sampling through an offscreen canvas) ----------

/** Seeded random numbers: the same shapes on every reload. */
function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Draw lucide icon data (a 24x24 grid of paths, rects, circles...) as thick strokes, so the dots have a body to land on. */
function strokeIcon(ctx: CanvasRenderingContext2D, node: IconNode, width = 2.6) {
  const s = (GRID * 0.86) / 24; // scale 24 -> canvas, with a margin
  ctx.save();
  ctx.translate(GRID * 0.07, GRID * 0.07); ctx.scale(s, s);
  ctx.lineWidth = width; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#000";
  for (const [tag, a] of node) {
    const n = (k: string) => Number(a[k] ?? 0);
    ctx.beginPath();
    if (tag === "path") ctx.stroke(new Path2D(String(a.d)));
    else if (tag === "rect") { ctx.roundRect(n("x"), n("y"), n("width"), n("height"), n("rx")); ctx.stroke(); }
    else if (tag === "circle") { ctx.arc(n("cx"), n("cy"), n("r"), 0, Math.PI * 2); ctx.stroke(); }
    else if (tag === "line") { ctx.moveTo(n("x1"), n("y1")); ctx.lineTo(n("x2"), n("y2")); ctx.stroke(); }
    else if (tag === "polyline" || tag === "polygon") {
      const nums = String(a.points).trim().split(/[\s,]+/).map(Number);
      ctx.moveTo(nums[0], nums[1]); for (let i = 2; i < nums.length; i += 2) ctx.lineTo(nums[i], nums[i + 1]);
      if (tag === "polygon") ctx.closePath(); ctx.stroke();
    }
  }
  ctx.restore();
}

/**
 * The MOSAIC "M": the same diamond tiles as the logo (see Logo.tsx), drawn filled. Each tile's tone is stored in the RED
 * channel, so after sampling we can turn "light tile / dark tile" into "bright particle / dim particle".
 */
function fillLogo(ctx: CanvasRenderingContext2D) {
  const s = (GRID * 0.94) / 218; // the mark is 218 units wide
  ctx.save(); ctx.translate(GRID * 0.03 + 28 * s, GRID / 2 - (137 * s) / 2 + 28 * s); ctx.scale(s, s);
  for (const [r, k, c] of TILES) {
    const tone = parseInt(c.slice(1, 3), 16); // the red value of the tile's colour: bigger = lighter
    ctx.save(); ctx.translate(k * 27, r * 27); ctx.rotate(Math.PI / 4); ctx.fillStyle = `rgb(${tone},0,0)`;
    ctx.beginPath(); ctx.roundRect(-15, -15, 30, 30, 5); ctx.fill(); ctx.restore(); // a little smaller than the logo tile, so thin gaps separate the diamonds
  }
  ctx.restore();
}

/**
 * Pick exactly n points from whatever was drawn: snap to a loose grid (so it feels like mosaic tiles), keep the cells
 * that touch ink, thin them out evenly if there are too many, then order them by angle so neighbours stay neighbours
 * when particles travel from shape to shape.
 */
function sample(draw: (c: CanvasRenderingContext2D) => void, n: number, alphaOf: (x: number, y: number, i: number, tone: number) => number): Pts {
  const cv = document.createElement("canvas"); cv.width = cv.height = GRID;
  const ctx = cv.getContext("2d", { willReadFrequently: true })!;
  draw(ctx);
  const alpha = ctx.getImageData(0, 0, GRID, GRID).data;
  const ink = (x: number, y: number) => alpha[(y * GRID + x) * 4 + 3] > 90;
  let cells: [number, number][] = [];
  for (let g = 12; g >= 2; g -= 0.5) { // smaller cells until we have at least n of them
    cells = [];
    for (let y = g / 2; y < GRID; y += g) for (let x = g / 2; x < GRID; x += g) {
      const cx = Math.round(x), cy = Math.round(y);
      if (ink(cx, cy) || ink(Math.min(GRID - 1, cx + 2), cy) || ink(cx, Math.min(GRID - 1, cy + 2))) cells.push([cx, cy]);
    }
    if (cells.length >= n) break;
  }
  const mx = cells.reduce((t, c) => t + c[0], 0) / cells.length, my = cells.reduce((t, c) => t + c[1], 0) / cells.length;
  cells.sort((a, b) => Math.atan2(a[1] - my, a[0] - mx) - Math.atan2(b[1] - my, b[0] - mx));
  const out: Pts = { x: new Float32Array(n), y: new Float32Array(n), a: new Float32Array(n) };
  for (let i = 0; i < n; i++) {
    const [cx, cy] = cells[Math.min(cells.length - 1, Math.floor((i * cells.length) / n))];
    out.x[i] = cx / GRID; out.y[i] = cy / GRID; out.a[i] = alphaOf(cx / GRID, cy / GRID, i, alpha[(cy * GRID + cx) * 4]);
  }
  return out;
}

/** The 7 shapes, in the order the story tells them. */
function makeShapes(n: number): Pts[] {
  const quarter = (_x: number, _y: number, i: number) => (i % 4 === 0 ? 0.35 : 1); // 25% of the particles are dimmer
  const logo = () => sample(fillLogo, n, (_x, _y, _i, tone) => 0.5 + 0.5 * Math.min(1, tone / 235)); // light tiles = bright particles, dark tiles = dim ones
  const icon = (node: IconNode, width?: number) => sample((c) => strokeIcon(c, node, width), n, quarter); // thinner strokes keep the handshake's fingers apart
  return [logo(), icon(handshakeIcon.filter((_, i) => i !== 4), 1.1), icon(receiptIcon, 2.2), icon(storeIcon), icon(landmarkIcon), icon(shieldIcon), logo()];
}

// ---------- 2. Where each shape sits on screen ----------

interface Pose { cx: number; cy: number; size: number }
/** The shape's centre and size for a given side. Shapes live in the whitespace opposite the text. */
function poseFor(side: Side, W: number, H: number, mobile: boolean, last: boolean, scale = 1): Pose {
  if (mobile) return { cx: W / 2, cy: H * 0.5, size: Math.min(W * 0.85, H * 0.5) * Math.min(scale, 1.1) }; // faint, behind the text
  const inset = W >= 1024 ? 256 : 0; // the left rail
  const area = W - inset;
  const size = Math.min(H * 0.56, area * 0.3) * (last ? 0.55 : 1) * scale; // about 56% of the screen height (the hero asks for more)
  const cx = inset + area * (side === "left" ? 0.22 : side === "right" ? 0.78 : 0.5);
  return { cx, cy: H * 0.5, size };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

// ---------- 3. The component ----------

export default function ParticleJourney() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    gsap.registerPlugin(ScrollTrigger);

    const color = getComputedStyle(document.documentElement).getPropertyValue("--color-pine").trim(); // from our CSS variables
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches; // visitors who asked for no motion
    const state = { p: 0 }; // progress, 0 to 6: the ONLY thing the scroll controls (the TARGET)
    let sp = 0; // the progress we actually draw: it glides toward the target, so fast flicks of the wheel stay smooth
    let W = 0, H = 0, dpr = 1, mobile = false, count = 0;
    let shapes: Pts[] = [];
    let scatter: { x: Float32Array; y: Float32Array } | null = null; // where each particle goes in the final, window-wide field
    let seed: { phase: Float32Array; px: Float32Array; delay: Float32Array; bend: Float32Array } | null = null;
    let sides: Side[] = [], centers: number[] = [], scales: number[] = [];
    let dust: { x: Float32Array; y: Float32Array; d: Float32Array; ph: Float32Array; sz: Float32Array; al: Float32Array; ox: Float32Array; oy: Float32Array } | null = null;
    let mx = -9999, my = -9999; // the pointer, in screen pixels (far away when there is none)
    let raf = 0;
    let tl: gsap.core.Timeline | null = null;

    /** Per-particle random settings: size (4-6px), idle-drift phase, stagger delay, and how far it bows on its curved path. */
    function makeSeed(n: number) {
      const r = rng(21);
      return {
        phase: Float32Array.from({ length: n }, () => r() * Math.PI * 2),
        px: Float32Array.from({ length: n }, () => 1.5 + r() * 1.0), // radius in px (diameter 3-5)
        delay: Float32Array.from({ length: n }, () => r() * STAGGER),
        bend: Float32Array.from({ length: n }, () => (r() < 0.5 ? -1 : 1) * (0.35 + r() * 0.65)),
      };
    }

    /** Dust: tiny specks spread over the whole page. Depth (d) makes near specks drift and scroll faster than far ones. */
    function makeDust(n: number) {
      const r = rng(5);
      const f = (g: () => number) => Float32Array.from({ length: n }, g);
      return { x: f(r), y: f(r), d: f(() => 0.25 + r() * 0.75), ph: f(() => r() * Math.PI * 2), sz: f(() => 1 + r() * 1.1), al: f(() => 0.12 + r() * 0.3), ox: new Float32Array(n), oy: new Float32Array(n) };
    }
    /** Move and draw the dust: a slow wobble, a gentle scroll parallax, and a push away from the cursor that springs back. */
    function drawDust(t: number) {
      const D = dust; if (!D) return;
      const n = D.x.length, R = 130, R2 = R * R, sy = window.scrollY, TAU = Math.PI * 2;
      // Draw in 4 brightness groups, one path each: thousands of circles for the price of four fills.
      const groups: number[][] = [[], [], [], []];
      for (let i = 0; i < n; i++) {
        const d = D.d[i];
        let x = D.x[i] * W, y = D.y[i] * H;
        if (!reduce) { x += Math.sin(t * 0.12 + D.ph[i]) * 9 * d; y = ((y - sy * 0.12 * d) % H + H) % H + Math.cos(t * 0.1 + D.ph[i] * 1.7) * 9 * d; }
        let tx = 0, ty = 0; // where the cursor wants to push this speck
        if (!reduce) { const dx = x - mx, dy = y - my, dd = dx * dx + dy * dy; if (dd < R2) { const dist = Math.sqrt(dd) || 1, f = 1 - dist / R; tx = (dx / dist) * f * 60 * d; ty = (dy / dist) * f * 60 * d; } }
        D.ox[i] += (tx - D.ox[i]) * 0.1; D.oy[i] += (ty - D.oy[i]) * 0.1; // spring back toward where it should be
        groups[Math.min(3, Math.floor(((D.al[i] - 0.12) / 0.3) * 4))].push(x + D.ox[i], y + D.oy[i], D.sz[i] * 0.55);
      }
      groups.forEach((g, k) => {
        ctx!.globalAlpha = 0.14 + k * 0.09; ctx!.beginPath();
        for (let j = 0; j < g.length; j += 3) { ctx!.moveTo(g[j] + g[j + 2], g[j + 1]); ctx!.arc(g[j], g[j + 1], g[j + 2], 0, TAU); }
        ctx!.fill();
      });
      ctx!.globalAlpha = 1;
    }

    /** Draw all particles for the current progress. */
    function draw(t: number) {
      sp = reduce ? state.p : sp + (state.p - sp) * 0.14; // glide toward the scroll target (reversal still exact: it always ends on the target)
      if (Math.abs(state.p - sp) < 0.0005) sp = state.p;
      ctx!.clearRect(0, 0, W, H);
      const p = Math.min(sp, SHAPES - 1), a = Math.min(Math.floor(p), SHAPES - 2), f = p - a; // between shape a and shape a+1
      const A = shapes[a], B = shapes[a + 1];
      const pa = poseFor(sides[a] ?? "right", W, H, mobile, a === SHAPES - 1, scales[a] ?? 1), pb = poseFor(sides[a + 1] ?? "right", W, H, mobile, a + 1 === SHAPES - 1, scales[a + 1] ?? 1);
      const faint = mobile ? 0.3 : 1; // on phones the shape sits quietly behind the text
      const transit = Math.sin(f * Math.PI); // 0 when a shape is formed, 1 mid-journey
      const drift = reduce ? 0 : 1.5; // 1-2px idle drift
      ctx!.fillStyle = color;
      drawDust(t);
      for (let i = 0; i < count; i++) {
        const ax = pa.cx - pa.size / 2 + A.x[i] * pa.size, ay = pa.cy - pa.size / 2 + A.y[i] * pa.size;
        // The LAST state is not a shape: every particle spreads out over the whole window (a field).
        const toField = a + 1 === SHAPES - 1;
        const bx = toField ? scatter!.x[i] * W : pb.cx - pb.size / 2 + B.x[i] * pb.size, by = toField ? scatter!.y[i] * H : pb.cy - pb.size / 2 + B.y[i] * pb.size;
        const e = reduce ? (f > 0.5 ? 1 : 0) : easeInOut(clamp01((f - seed!.delay[i]) / (1 - STAGGER))); // staggered, eased progress for THIS particle
        let x = lerp(ax, bx, e), y = lerp(ay, by, e);
        const bow = Math.sin(e * Math.PI) * pa.size * 0.45 * seed!.bend[i]; // sin(t*PI): zero at both ends, biggest mid-way -> a curved path
        const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
        x += (-dy / len) * bow; y += (dx / len) * bow; // push sideways, perpendicular to the straight line
        const settled = 1 - Math.sin(e * Math.PI); // drift only while the particle is at rest
        x += Math.sin(t * 0.8 + seed!.phase[i]) * drift * settled; y += Math.cos(t * 0.7 + seed!.phase[i] * 1.3) * drift * settled;
        const al = lerp(A.a[i], B.a[i], e) * (1 - 0.3 * transit) * faint * (toField ? lerp(1, 0.55, e) : 1); // the final field is dimmer, so the headline stays readable
        // A clean circle: no halo. In flight it shrinks a little (it "dissolves"), then grows back as it lands.
        const rad = seed!.px[i] * (0.8 + 0.25 * Math.min(1, pa.size / 420)) * (1 - 0.38 * Math.sin(e * Math.PI));
        ctx!.globalAlpha = Math.min(1, al * 1.05); ctx!.beginPath(); ctx!.arc(x, y, rad, 0, Math.PI * 2); ctx!.fill();
      }
      ctx!.globalAlpha = 1;
      el!.dataset.progress = sp.toFixed(3); el!.dataset.target = state.p.toFixed(3); // handy for tests
    }

    function frame(now: number) { draw(now / 1000); raf = document.hidden ? 0 : requestAnimationFrame(frame); }

    /** Read where the marked sections are, and (re)build the scroll link. */
    function build() {
      tl?.scrollTrigger?.kill(); tl?.kill(); tl = null;
      const marks = [...document.querySelectorAll<HTMLElement>("[data-shape-index]")].sort((x, y) => Number(x.dataset.shapeIndex) - Number(y.dataset.shapeIndex));
      if (marks.length < SHAPES) return;
      sides = marks.map((m) => (m.dataset.shapeSide as Side) ?? "right");
      scales = marks.map((m) => Number(m.dataset.shapeScale ?? 1));
      centers = marks.map((m) => { const r = m.getBoundingClientRect(); return r.top + window.scrollY + r.height / 2; }); // each section's middle, in page pixels
      // The journey must END at the very bottom of the page (the last section may never reach the middle of the screen).
      centers[SHAPES - 1] = Math.max(centers[SHAPES - 2] + 200, Math.min(centers[SHAPES - 1], document.documentElement.scrollHeight - H + H / 2));
      centers[0] = Math.max(centers[0], H / 2); // the hero shape must be fully formed at scroll position 0, so the journey starts there
      state.p = 0;
      if (reduce) { onScrollStatic(); return; }
      // One timeline, one tween per pair of neighbouring shapes. A tween lasts as many "seconds" as the sections are
      // pixels apart, so progress is exactly i when the i-th section is in the middle of the screen. scrub: true ties it to scroll.
      tl = gsap.timeline({ scrollTrigger: { start: Math.max(0, centers[0] - H / 2), end: centers[SHAPES - 1] - H / 2, scrub: true, invalidateOnRefresh: true } });
      // immediateRender: false = do not apply a tween's start value until the scroll reaches it (otherwise the last tween wins at load)
      for (let i = 0; i < SHAPES - 1; i++) tl.fromTo(state, { p: i }, { p: i + 1, duration: centers[i + 1] - centers[i], ease: "none", immediateRender: false });
      ScrollTrigger.refresh();
    }

    /** Reduced motion: no travelling. Show the shape that belongs to the section in the middle of the screen. */
    function onScrollStatic() {
      const mid = window.scrollY + H / 2;
      let k = 0; centers.forEach((c, i) => { if (Math.abs(c - mid) < Math.abs(centers[k] - mid)) k = i; }); // the nearest section
      state.p = k; draw(performance.now() / 1000);
    }

    /** Size the canvas, choose the particle count for this screen, and rebuild. */
    function setup() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth; H = window.innerHeight;
      el!.width = Math.round(W * dpr); el!.height = Math.round(H * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      mobile = W < 768;
      const n = mobile ? MOBILE_COUNT : DESKTOP_COUNT;
      if (n !== count) { count = n; shapes = makeShapes(n); seed = makeSeed(n); { const r = rng(33); scatter = { x: Float32Array.from({ length: n }, () => 0.03 + r() * 0.94), y: Float32Array.from({ length: n }, () => 0.04 + r() * 0.92) }; } dust = makeDust(mobile ? MOBILE_DUST : DESKTOP_DUST); } // ~700 squares + ~2,400 specks on desktop; ~350 + ~700 on phones
      draw(performance.now() / 1000);
    }

    let timer = 0;
    const onResize = () => { clearTimeout(timer); timer = window.setTimeout(() => { setup(); build(); }, 150); }; // wait until resizing stops
    const onVisibility = () => { if (!document.hidden && !raf && !reduce) raf = requestAnimationFrame(frame); }; // pause when the tab is hidden
    const ro = new ResizeObserver(onResize); ro.observe(document.body); // page height changes (fonts, content) move the sections

    setup(); build();
    if (!reduce) raf = requestAnimationFrame(frame); else window.addEventListener("scroll", onScrollStatic, { passive: true });
    const onPointer = (e: PointerEvent) => { if (e.pointerType === "mouse") { mx = e.clientX; my = e.clientY; } };
    const onLeave = () => { mx = my = -9999; };
    window.addEventListener("pointermove", onPointer, { passive: true }); document.documentElement.addEventListener("pointerleave", onLeave);
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);
    document.fonts?.ready.then(() => build()); // headings can change height once the fonts load
    return () => { // clean up when the page is left
      clearTimeout(timer); cancelAnimationFrame(raf); ro.disconnect();
      window.removeEventListener("resize", onResize); window.removeEventListener("scroll", onScrollStatic);
      window.removeEventListener("pointermove", onPointer); document.documentElement.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      tl?.scrollTrigger?.kill(); tl?.kill();
    };
  }, []);

  // One fixed canvas behind the page: never blocks clicks, never wider than the screen (no horizontal scroll).
  return <canvas ref={canvas} aria-hidden className="pointer-events-none fixed inset-0 z-0 h-full w-full" />;
}
