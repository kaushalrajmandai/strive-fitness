/* ═══════════════════════════════════════════════════════════════
   STRIVE FITNESS — script.js

   TABLE OF CONTENTS:
   1.  Loader
   2.  Touch Detection
   3.  DOM References
   4.  Image Setup (body + clothed athlete)
   5.  Reveal Effect — Settings & State
   6.  Canvas Helpers (draw, resize)
   7.  Blob Shape Drawing (wobbly spotlight)
   8.  Main Draw Loop (revealCanvas animation)
   9.  Custom Cursor (desktop only)
   10. Parallax + Body Reveal Handler (mousemove / touchmove)
   11. Touch / Mouse Leave Events
   12. Click Shatter Effect
   13. STRIVE Green Spotlight Effect
═══════════════════════════════════════════════════════════════ */


/* ─────────────────────────────────────────
   1. Loader
   Hide the full-screen loader overlay after 1400ms
───────────────────────────────────────── */
setTimeout(() => document.getElementById('loader').classList.add('hide'), 1400);


/* ─────────────────────────────────────────
   2. Touch Detection
   Used to disable cursor + adjust behavior on touch devices
───────────────────────────────────────── */
const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;


/* ─────────────────────────────────────────
   3. DOM References
───────────────────────────────────────── */
const cursorEl       = document.getElementById('cursor');
const ringEl         = document.getElementById('ring');
const personWrap     = document.getElementById('personWrap');
const hint           = document.getElementById('hoverHint');
const bgText         = document.getElementById('bgText');          // STRIVE dark layer (parallax source)
const bgFitness      = document.getElementById('bgFitnessEl');     // FITNESS text
const blobs          = document.querySelectorAll('.blob');
const bodyCanvas     = document.getElementById('bodyCanvas');      // shirtless athlete canvas
const revealCanvas   = document.getElementById('revealCanvas');    // clothed athlete canvas
const bCtx           = bodyCanvas.getContext('2d');
const rCtx           = revealCanvas.getContext('2d');
const striveGreenWrap = document.getElementById('striveGreenWrap'); // green spotlight wrapper
const striveGreen    = document.getElementById('striveGreen');     // green spotlight inner text


/* ─────────────────────────────────────────
   4. Image Setup
   bodyImg    = shirtless athlete (always visible on bodyCanvas)
   clothedImg = dressed athlete   (on revealCanvas, blob hole cut out)
───────────────────────────────────────── */
const bodyImg    = new Image();
const clothedImg = new Image();
bodyImg.src    = 'body.png';
clothedImg.src = 'hero.png';


/* ─────────────────────────────────────────
   5. Reveal Effect — Settings & State
───────────────────────────────────────── */

// — Tunable parameters —
const MAX_RADIUS     = 80;    // maximum spotlight radius in canvas px
const LERP_IN        = 0.12;  // how fast spotlight grows when entering body
const LERP_OUT       = 0.03;  // how fast spotlight shrinks when leaving body
const CURSOR_LERP    = 0.12;  // how fast spotlight center follows cursor
const LINGER_MS      = 600;   // ms to wait before closing spotlight after cursor leaves
const BLOB_POINTS    = 64;    // number of points in the wobbly blob shape
const WOBBLE_AMP     = 0.29;  // amplitude of idle blob wobble
const WOBBLE_SPEED   = 0.6;   // speed of idle blob wobble
const MOMENTUM_AMP   = 10;    // how much cursor velocity distorts blob shape
const MOMENTUM_DECAY = 1;     // how quickly momentum falls off (1 = instant decay)

// — State variables —
let mx = 0, my = 0;           // raw mouse position
let rx = 0, ry = 0;           // ring cursor position (lerped)
let spotX = null, spotY = null;              // target spot position (canvas coords)
let smoothX = null, smoothY = null;         // lerped spot position
let prevSmoothX = null, prevSmoothY = null; // previous frame smoothed position
let momentumX = 0, momentumY = 0;           // blob distortion momentum
let spotRadius = 0, targetRadius = 0;       // current and target blob radius
let isOverBody = false;                      // whether cursor is currently over body zone
let lingerTimer = null;                      // timeout handle for linger delay
let time = 0;                                // animation time counter for wobble


/* ─────────────────────────────────────────
   6. Canvas Helpers
───────────────────────────────────────── */

// Draw an image centered and contained (letterboxed) in a canvas context
function drawContained(ctx, img, W, H) {
  const iW = img.naturalWidth  || img.width;
  const iH = img.naturalHeight || img.height;
  if (!iW || !iH) return;
  const scale = Math.min(W / iW, H / iH);
  const dW = iW * scale;
  const dH = iH * scale;
  const dx = (W - dW) / 2;
  const dy = (H - dH) / 2;
  ctx.drawImage(img, dx, dy, dW, dH);
}

// Resize both canvases to match personWrap dimensions, then redraw
function resizeCanvases() {
  const W = personWrap.offsetWidth;
  const H = personWrap.offsetHeight;
  bodyCanvas.width    = W; bodyCanvas.height    = H;
  revealCanvas.width  = W; revealCanvas.height  = H;
  drawBody();
}

// Draw the shirtless athlete onto bodyCanvas (static, only redrawn on resize)
function drawBody() {
  const W = bodyCanvas.width;
  const H = bodyCanvas.height;
  bCtx.clearRect(0, 0, W, H);
  if (bodyImg.complete) drawContained(bCtx, bodyImg, W, H);
}


/* ─────────────────────────────────────────
   7. Blob Shape Drawing
   Draws a wobbly organic blob path centered at (cx, cy).
   Idle wobble uses layered sin waves over time.
   Momentum distorts the blob in the direction of cursor movement.
───────────────────────────────────────── */
function drawSmoothBlob(ctx, cx, cy, radius, t, mvx, mvy) {
  const pts = [];
  for (let i = 0; i < BLOB_POINTS; i++) {
    const angle = (i / BLOB_POINTS) * Math.PI * 2;
    // Layered sine waves create organic idle motion
    const idle =
      Math.sin(angle * 2 + t * WOBBLE_SPEED)       * 0.5 +
      Math.sin(angle * 3 - t * WOBBLE_SPEED * 1.4) * 0.3 +
      Math.sin(angle * 7 + t * WOBBLE_SPEED * 0.9) * 0.2;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    // Project cursor velocity onto this point's direction for momentum distortion
    const projection = cosA * mvx + sinA * mvy;
    const r = radius * (1 + WOBBLE_AMP * idle) + projection * MOMENTUM_AMP;
    pts.push({ x: cx + cosA * r, y: cy + sinA * r });
  }

  // Draw smooth Catmull-Rom-like spline through points
  ctx.beginPath();
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    if (i === 0) ctx.moveTo(p1.x, p1.y);
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
  }
  ctx.closePath();
}


/* ─────────────────────────────────────────
   8. Main Draw Loop
   Runs every frame via requestAnimationFrame.
   Draws clothed athlete on revealCanvas, then cuts the blob hole
   using destination-out compositing to reveal bodyCanvas below.
───────────────────────────────────────── */
function draw() {
  const W = revealCanvas.width;
  const H = revealCanvas.height;
  rCtx.clearRect(0, 0, W, H);
  if (!clothedImg.complete) { requestAnimationFrame(draw); return; }

  time += 0.03;

  // Lerp spotlight radius toward target (faster in, slower out)
  const lerpSpeed = isOverBody ? LERP_IN : LERP_OUT;
  spotRadius += (targetRadius - spotRadius) * lerpSpeed;

  // Initialise smooth position on first entry
  if (smoothX === null && spotX !== null) {
    smoothX = spotX; smoothY = spotY;
    prevSmoothX = spotX; prevSmoothY = spotY;
  }

  // Lerp smooth position toward target, compute momentum from delta
  if (spotX !== null) {
    prevSmoothX = smoothX; prevSmoothY = smoothY;
    smoothX += (spotX - smoothX) * CURSOR_LERP;
    smoothY += (spotY - smoothY) * CURSOR_LERP;
    const rawVX = smoothX - prevSmoothX;
    const rawVY = smoothY - prevSmoothY;
    momentumX += (rawVX - momentumX) * 0.3;
    momentumY += (rawVY - momentumY) * 0.3;
  }
  momentumX *= (1 - MOMENTUM_DECAY);
  momentumY *= (1 - MOMENTUM_DECAY);

  // Draw clothed athlete
  rCtx.save();
  drawContained(rCtx, clothedImg, W, H);

  // Cut blob-shaped hole to reveal shirtless layer underneath
  if (smoothX !== null && spotRadius > 1) {
    rCtx.globalCompositeOperation = 'destination-out';

    // Radial gradient for soft falloff edge on the hole
    const grad = rCtx.createRadialGradient(smoothX, smoothY, 0, smoothX, smoothY, spotRadius * 1.4);
    grad.addColorStop(0,    'rgba(0,0,0,1)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0.97)');
    grad.addColorStop(0.78, 'rgba(0,0,0,0.7)');
    grad.addColorStop(0.92, 'rgba(0,0,0,0.2)');
    grad.addColorStop(1,    'rgba(0,0,0,0)');
    rCtx.fillStyle = grad;

    drawSmoothBlob(rCtx, smoothX, smoothY, spotRadius, time, momentumX, momentumY);
    rCtx.fill();
  }
  rCtx.restore();

  requestAnimationFrame(draw);
}

// Start draw loop once both images are loaded
let loaded = 0;
function onLoad() {
  loaded++;
  if (loaded === 2) { resizeCanvases(); draw(); }
}
bodyImg.onload    = onLoad;
clothedImg.onload = onLoad;
if (bodyImg.complete)    onLoad(); // handle cached images
if (clothedImg.complete) onLoad();

window.addEventListener('resize', resizeCanvases);


/* ─────────────────────────────────────────
   9. Custom Cursor (desktop only)
   .cursor snaps to mouse, .cursor-ring lerps with 10% ease.
   Both change size/style when hovering interactive elements.
───────────────────────────────────────── */
if (!isTouch) {
  // Snap dot to cursor
  document.addEventListener('mousemove', (e) => {
    mx = e.clientX; my = e.clientY;
    cursorEl.style.left = mx + 'px';
    cursorEl.style.top  = my + 'px';
  });

  // Lerp ring toward cursor
  (function animRing() {
    rx += (mx - rx) * 0.1;
    ry += (my - ry) * 0.1;
    ringEl.style.left = rx + 'px';
    ringEl.style.top  = ry + 'px';
    requestAnimationFrame(animRing);
  })();

  // Expand ring when hovering buttons/links
  document.querySelectorAll('button, a').forEach((el) => {
    el.addEventListener('mouseenter', () => {
      ringEl.style.width  = '58px'; ringEl.style.height = '58px';
      cursorEl.style.width = '5px'; cursorEl.style.height = '5px';
    });
    el.addEventListener('mouseleave', () => {
      ringEl.style.width  = '38px'; ringEl.style.height = '38px';
      cursorEl.style.width = '10px'; cursorEl.style.height = '10px';
    });
  });
}


/* ─────────────────────────────────────────
   10. Parallax + Body Reveal Handler
   Called on both mousemove and touchmove.
   - Moves blobs, STRIVE, FITNESS with parallax depth
   - Detects if cursor is inside the body hotzone
   - Updates spotlight target position and radius
   - Syncs STRIVE green layer transform to match parallax
───────────────────────────────────────── */
function handleMove(clientX, clientY) {

  // — Parallax (desktop only) —
  if (!isTouch && window.innerWidth > 768) {
    const cx = window.innerWidth  / 2;
    const cy = window.innerHeight / 2;
    const dx = (clientX - cx) / cx; // -1 to +1
    const dy = (clientY - cy) / cy;

    // Each blob moves at a different depth (index × 7px)
    blobs.forEach((b, i) => {
      const f = (i + 1) * 7;
      b.style.transform = `translate(${dx * f}px, ${dy * f}px)`;
    });

    // STRIVE and FITNESS text move together at same depth
    const textTransform = `translate(${dx * 18}px, calc(-50% + ${dy * 8}px))`;
striveGreenWrap.style.transform  = textTransform;
bgFitness.style.transform        = `translate(${dx * 18}px, calc(-50% + ${dy * 8}px))`;
document.querySelector('.bg-text-strive-base').style.transform = textTransform;
  }

  // — Body hotzone detection —
  const rect       = personWrap.getBoundingClientRect();
  const bodyTop    = rect.top    + rect.height * 0.20; // ignore head area
  const bodyBottom = rect.bottom - rect.height * 0.02;
  const bodyLeft   = rect.left   + rect.width  * 0.08;
  const bodyRight  = rect.right  - rect.width  * 0.08;

  const wasOverBody = isOverBody;
  isOverBody = (
    clientX >= bodyLeft && clientX <= bodyRight &&
    clientY >= bodyTop  && clientY <= bodyBottom
  );

  if (isOverBody) {
    clearTimeout(lingerTimer);
    // Convert client coords to canvas coords
    spotX = (clientX - rect.left) * (revealCanvas.width  / rect.width);
    spotY = (clientY - rect.top)  * (revealCanvas.height / rect.height);
    targetRadius = MAX_RADIUS;
    hint.style.opacity = '0'; // hide the hint text
    cursorEl.classList.add('over-body');
    ringEl.classList.add('over-body');
  } else {
    // Only start linger timer on the frame we first leave the body
    if (wasOverBody) {
      clearTimeout(lingerTimer);
      lingerTimer = setTimeout(() => { targetRadius = 0; }, LINGER_MS);
    }
    hint.style.opacity = '1';
    cursorEl.classList.remove('over-body');
    ringEl.classList.remove('over-body');
  }
}

document.addEventListener('mousemove', (e) => handleMove(e.clientX, e.clientY));
document.addEventListener('touchmove', (e) => {
  handleMove(e.touches[0].clientX, e.touches[0].clientY);
}, { passive: true });


/* ─────────────────────────────────────────
   11. Touch / Mouse Leave Events
───────────────────────────────────────── */

// Touch end — start linger then close spotlight
document.addEventListener('touchend', () => {
  clearTimeout(lingerTimer);
  lingerTimer = setTimeout(() => { targetRadius = 0; }, LINGER_MS);
});

// Mouse leaves window entirely — close spotlight immediately
document.addEventListener('mouseleave', () => {
  clearTimeout(lingerTimer);
  targetRadius = 0;
  isOverBody = false;
});


/* ─────────────────────────────────────────
   12. Click Shatter Effect
   Spawns a temporary canvas at click position,
   draws radiating crack lines that fade out.
───────────────────────────────────────── */
const CRACK_COUNT  = 10;
const CRACK_LENGTH = 120;

function spawnShatter(clientX, clientY) {
  const canvas = document.createElement('canvas');
  const pad = CRACK_LENGTH + 20;
  canvas.width  = pad * 2;
  canvas.height = pad * 2;
  canvas.style.cssText = `position:fixed;left:${clientX - pad}px;top:${clientY - pad}px;pointer-events:none;z-index:9999;`;
  document.body.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  const cx = pad, cy = pad;
  const cracks = [];

  // Generate crack paths
  for (let i = 0; i < CRACK_COUNT; i++) {
    const angle  = (i / CRACK_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
    const length = CRACK_LENGTH * (0.5 + Math.random() * 0.5);
    const segments = [];
    let x = cx, y = cy, a = angle, remaining = length;

    // Build zigzag segments for each crack
    while (remaining > 0) {
      const actual = Math.min(15 + Math.random() * 25, remaining);
      a += (Math.random() - 0.5) * 0.5;
      const nx = x + Math.cos(a) * actual;
      const ny = y + Math.sin(a) * actual;
      segments.push({ x1: x, y1: y, x2: nx, y2: ny });
      x = nx; y = ny; remaining -= actual;
    }

    // Occasionally add a branch crack
    if (Math.random() > 0.4) {
      const ba = angle + (Math.random() - 0.5) * 1.2;
      const bs = segments[Math.floor(segments.length * 0.4)];
      if (bs) {
        let bx = bs.x2, by = bs.y2, bangle = ba, br = length * 0.4;
        while (br > 0) {
          const al = Math.min(10 + Math.random() * 15, br);
          bangle += (Math.random() - 0.5) * 0.4;
          const bnx = bx + Math.cos(bangle) * al;
          const bny = by + Math.sin(bangle) * al;
          segments.push({ x1: bx, y1: by, x2: bnx, y2: bny });
          bx = bnx; by = bny; br -= al;
        }
      }
    }
    cracks.push({ segments });
  }

  // Animate: draw cracks progressively, then fade out
  const start    = performance.now();
  const drawTime = 300;
  const fadeTime = 500;
  const total    = drawTime + fadeTime;

  function animCracks(now) {
    const elapsed      = now - start;
    if (elapsed >= total) { canvas.remove(); return; }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const drawProgress = Math.min(elapsed / drawTime, 1);
    const fadeProgress = elapsed > drawTime ? (elapsed - drawTime) / fadeTime : 0;
    const opacity      = 1 - fadeProgress;

    cracks.forEach((crack) => {
      const visibleSegs = Math.ceil(drawProgress * crack.segments.length);
      crack.segments.slice(0, visibleSegs).forEach((seg, si) => {
        const distFrac = si / crack.segments.length;
        ctx.beginPath();
        ctx.moveTo(seg.x1, seg.y1);
        ctx.lineTo(seg.x2, seg.y2);
        ctx.strokeStyle = `rgba(20,20,18,${opacity * (1 - distFrac * 0.6)})`;
        ctx.lineWidth   = (1.5 - distFrac * 0.8) * (1 - fadeProgress * 0.5);
        ctx.stroke();
      });
    });

    requestAnimationFrame(animCracks);
  }
  requestAnimationFrame(animCracks);
}

document.addEventListener('click',      (e) => spawnShatter(e.clientX, e.clientY));
document.addEventListener('touchstart', (e) => spawnShatter(e.touches[0].clientX, e.touches[0].clientY), { passive: true });



/* ─────────────────────────────────────────
   13. STRIVE Green Spotlight Effect
   ─────────────────────────────────────────
   How it works:
   - Three STRIVE divs are stacked at the same position (see HTML + CSS).
   - Layer 1 (base): bronze outline — always visible.
   - Layer 2 (dark): solid dark fill — always visible.
   - Layer 3 (green wrap + green inner): green fill clipped to letter
     shapes via background-clip:text on the inner div.

   This function:
   1. Detects if cursor is over the STRIVE text bounding box.
   2. If yes: fades wrapper to opacity:1, and applies a soft radial
      gradient mask to the inner div — this creates the spotlight
      circle. background-clip:text ensures green only shows inside
      the letter shapes, never outside them.
   3. If no: fades wrapper back to opacity:0.

   Note: parallax transform sync is handled inside handleMove() above.
───────────────────────────────────────── */
document.addEventListener('mousemove', (e) => {
  const rect     = striveGreenWrap.getBoundingClientRect();
  const inBounds = (
    e.clientX >= rect.left && e.clientX <= rect.right &&
    e.clientY >= rect.top  && e.clientY <= rect.bottom
  );

  if (inBounds) {
    // Position of cursor relative to the wrapper element
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    striveGreenWrap.style.opacity = '1';

    // Apply spotlight mask to inner div — soft radial gradient
    // black = visible, transparent = hidden
    const mask = `radial-gradient(circle 60px at ${x}px ${y}px, black 60%, transparent 100%)`;
    striveGreen.style.webkitMaskImage = mask;
    striveGreen.style.maskImage       = mask;
  } else {
    striveGreenWrap.style.opacity = '0';
  }
});