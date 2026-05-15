/* ============================================================================
 *  app.js — Animated Billboard Designer  (main application)
 *
 *  Responsibilities:
 *    • Canvas setup & responsive sizing
 *    • Application state (mode, queue, current shape, animation time)
 *    • Mouse / keyboard interaction
 *    • Render pipeline (drawing mode preview, edit mode, animation playback)
 *    • Animation loop with ease-in-out morph between shapes
 *    • UI binding (buttons, slider, dropdown, status box, toast)
 *
 *  Depends on:  bezier.js  (math)
 *               shapes.js  (preset generators, anchorsToBezier, reorder)
 * ============================================================================ */

"use strict";

// ──────────────────────────────────────────────────────────────────────────
//  DOM helpers
// ──────────────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const canvas = $('canvas');
const ctx = canvas.getContext('2d');

// ──────────────────────────────────────────────────────────────────────────
//  Canvas sizing  (once on load — coordinates are stored in canvas space)
// ──────────────────────────────────────────────────────────────────────────
(function sizeCanvas() {
  const wrap = $('canvas-wrap');
  const size = Math.min(wrap.clientWidth - 30, wrap.clientHeight - 30, 720);
  canvas.width  = Math.max(420, size);
  canvas.height = canvas.width;
})();

// ──────────────────────────────────────────────────────────────────────────
//  Visual & interaction constants
// ──────────────────────────────────────────────────────────────────────────
const CLOSE_R    = 16;     // px radius to auto-close a shape
const HIT_R      = 10;     // px radius to grab a control point
const FILL       = 'rgba(128,203,196,0.55)';
const STROKE     = 'rgba(128,203,196,0.95)';
const GHOST_F    = 'rgba(128,203,196,0.08)';
const GHOST_S    = 'rgba(128,203,196,0.18)';
const ANCHOR_C   = '#ff6b6b';
const HANDLE_C   = '#ffc94a';
const PREVIEW_C  = 'rgba(128,203,196,0.4)';

// ──────────────────────────────────────────────────────────────────────────
//  Application State
// ──────────────────────────────────────────────────────────────────────────
const S = {
  mode:         'idle',    // 'idle' | 'drawing' | 'editing' | 'animating'

  drawAnchors:  [],        // anchor positions being placed (drawing mode)
  mouse:        { x: 0, y: 0 },

  currentShape: null,      // flat 3N array (editing mode)
  dragIdx:      -1,        // index into currentShape being dragged

  animQueue:    [],        // array of finalised shapes
  requiredN:    0,         // anchor count locked by first shape

  animRaf:      null,
  animT:        0,
  lastTs:       0,
  animSpeed:    1.8,       // seconds per transition

  // Rendering method for the curves (educational toggle)
  bezierMethod: 'canvas',  // 'canvas' | 'bernstein' | 'matrix' | 'decasteljau'
};


// ══════════════════════════════════════════════════════════════════════════
//  RENDER FUNCTIONS
// ══════════════════════════════════════════════════════════════════════════

/**
 * Path-fill a closed Bézier shape from flat control points.
 * The path is built differently depending on S.bezierMethod:
 *   • "canvas"       — uses ctx.bezierCurveTo (fast, GPU-accelerated)
 *   • "bernstein"    — samples each segment via cubicBezierBernstein
 *   • "matrix"       — samples via cubicBezierMatrix  (lecture form G·M·T)
 *   • "decasteljau"  — samples via deCasteljau recursion
 *
 * Switching between methods visually proves all three forms produce the
 * same curve (a key result demonstrated in the lecture).
 */
function drawShape(pts, fill, stroke, lw = 2) {
  const N = pts.length / 3;
  ctx.beginPath();

  if (S.bezierMethod === 'canvas') {
    // Native cubic curve commands — fastest path
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 0; i < N; i++) {
      const p1 = pts[i * 3 + 1];
      const p2 = pts[i * 3 + 2];
      const p3 = pts[((i + 1) % N) * 3];
      ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
    }
  } else {
    // Sample each segment using the chosen math form, draw as polyline
    const evalFn = (S.bezierMethod === 'bernstein')   ? cubicBezierBernstein
                : (S.bezierMethod === 'matrix')       ? cubicBezierMatrix
                : /* de Casteljau */                    deCasteljauCubic;

    ctx.moveTo(pts[0].x, pts[0].y);
    const STEPS = 24;
    for (let i = 0; i < N; i++) {
      const P0 = pts[i * 3];
      const P1 = pts[i * 3 + 1];
      const P2 = pts[i * 3 + 2];
      const P3 = pts[((i + 1) % N) * 3];
      for (let k = 1; k <= STEPS; k++) {
        const pt = evalFn(k / STEPS, P0, P1, P2, P3);
        ctx.lineTo(pt.x, pt.y);
      }
    }
  }

  ctx.closePath();
  if (fill)   { ctx.fillStyle = fill;     ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}

/** Wrapper so the cubic-segment signature matches the other two evaluators. */
function deCasteljauCubic(t, P0, P1, P2, P3) {
  return deCasteljau(t, [P0, P1, P2, P3]);
}

/**
 * Edit-overlay: handle lines + control point dots.
 *   Red square anchors • Gold handles • Dashed lines between them.
 *   Mirrors the visual reference shown in the lab PDF.
 */
function drawHandles(pts) {
  const N = pts.length / 3;

  // 1. Dashed handle lines
  ctx.save();
  ctx.setLineDash([3, 4]);
  ctx.strokeStyle = 'rgba(255,201,74,0.35)';
  ctx.lineWidth = 1;
  for (let i = 0; i < N; i++) {
    const a  = pts[i * 3];
    const co = pts[i * 3 + 1];
    const ci = pts[i * 3 + 2];
    const na = pts[((i + 1) % N) * 3];
    ctx.beginPath(); ctx.moveTo(a.x,  a.y);  ctx.lineTo(co.x, co.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(na.x, na.y); ctx.lineTo(ci.x, ci.y); ctx.stroke();
  }
  ctx.restore();

  // 2. Handle dots (gold)
  for (let i = 0; i < N; i++) {
    const co = pts[i * 3 + 1];
    const ci = pts[i * 3 + 2];
    [co, ci].forEach(p => {
      ctx.fillStyle   = HANDLE_C;
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth   = 1;
      ctx.beginPath(); ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    });
  }

  // 3. Anchor squares (red, on top)
  for (let i = 0; i < N; i++) {
    const a = pts[i * 3];
    ctx.fillStyle   = ANCHOR_C;
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth   = 1.5;
    ctx.beginPath(); ctx.arc(a.x, a.y, 7, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
  }
}

/**
 * Live preview while user is placing anchors.
 * Renders a dashed Catmull-Rom curve through the placed anchors plus the
 * cursor, so users see the eventual shape forming in real time.
 */
function drawPreview() {
  const placed = S.drawAnchors;
  if (placed.length === 0) return;

  const pts = [...placed, S.mouse];
  const N   = pts.length;

  if (N >= 2) {
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = PREVIEW_C;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 0; i < N - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(N - 1, i + 2)];
      const cp1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
      const cp2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
      ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, p2.x, p2.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  // Placed anchor dots — first one larger + close-zone indicator
  placed.forEach((p, i) => {
    const isFirst = (i === 0);
    if (isFirst && placed.length >= 3) {
      const near = dist(S.mouse, p) < CLOSE_R;
      ctx.strokeStyle = near ? 'rgba(128,203,196,0.7)' : 'rgba(128,203,196,0.25)';
      ctx.lineWidth   = 1;
      ctx.beginPath(); ctx.arc(p.x, p.y, CLOSE_R, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle   = isFirst ? ANCHOR_C : 'rgba(255,107,107,0.65)';
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth   = 1;
    ctx.beginPath(); ctx.arc(p.x, p.y, isFirst ? 7 : 4.5, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
  });
}

/** Subtle dot-grid background. */
function drawGrid() {
  ctx.fillStyle = 'rgba(255,255,255,0.025)';
  const step = 28;
  for (let x = step; x < canvas.width;  x += step) {
    for (let y = step; y < canvas.height; y += step) {
      ctx.fillRect(x - 0.5, y - 0.5, 1, 1);
    }
  }
}

/** Show anchor positions during animation playback (visual feedback). */
function drawAnimDots(pts) {
  const N = pts.length / 3;
  ctx.fillStyle = 'rgba(255,107,107,0.6)';
  for (let i = 0; i < N; i++) {
    const a = pts[i * 3];
    ctx.beginPath(); ctx.arc(a.x, a.y, 2.5, 0, Math.PI * 2); ctx.fill();
  }
}


// ══════════════════════════════════════════════════════════════════════════
//  MAIN RENDER LOOPS
// ══════════════════════════════════════════════════════════════════════════

/** One-shot render for non-animation modes. */
function staticRender() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // Ghost queued shapes in the background
  S.animQueue.forEach((shape, idx) => {
    const isLast = idx === S.animQueue.length - 1;
    drawShape(shape,
      `rgba(128,203,196,${isLast ? 0.16 : 0.06})`,
      `rgba(128,203,196,${isLast ? 0.30 : 0.12})`,
      isLast ? 1 : 0.5);
  });

  if (S.mode === 'drawing') {
    drawPreview();
  } else if (S.mode === 'editing' && S.currentShape) {
    drawShape(S.currentShape, FILL, STROKE, 2.5);
    drawHandles(S.currentShape);
  }

  updateStatusUI();
}

/** Continuous animation loop (requestAnimationFrame). */
function animLoop(timestamp) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  const dt   = Math.min((timestamp - S.lastTs) / 1000, 0.1);
  S.lastTs   = timestamp;
  S.animT    = (S.animT + dt / S.animSpeed) % S.animQueue.length;

  const segIdx = Math.floor(S.animT);
  const t      = S.animT - segIdx;

  // ── Core morphing: lerp every control point with ease-in-out ──
  const shapeA = S.animQueue[segIdx];
  const shapeB = S.animQueue[(segIdx + 1) % S.animQueue.length];
  const frame  = interpolateShapes(shapeA, shapeB, t);
  // ──────────────────────────────────────────────────────────────

  drawShape(frame, FILL, STROKE, 2.5);
  drawAnimDots(frame);

  $('t-display').textContent =
    `shape ${segIdx + 1} → ${(segIdx + 1) % S.animQueue.length + 1}   t = ${t.toFixed(3)}`;

  updateStatusUI();
  S.animRaf = requestAnimationFrame(animLoop);
}


// ══════════════════════════════════════════════════════════════════════════
//  MOUSE INTERACTION
// ══════════════════════════════════════════════════════════════════════════

function canvasPos(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

canvas.addEventListener('mousemove', e => {
  const pos = canvasPos(e);
  S.mouse = pos;

  if (S.mode === 'drawing') {
    staticRender();
    const near = S.drawAnchors.length >= 3 && dist(pos, S.drawAnchors[0]) < CLOSE_R;
    canvas.style.cursor = near ? 'cell' : 'crosshair';
  }

  if (S.mode === 'editing' && S.dragIdx >= 0) {
    S.currentShape[S.dragIdx] = { ...pos };
    staticRender();
  }

  if (S.mode === 'editing' && S.dragIdx < 0) {
    const hover = S.currentShape.some(p => dist(pos, p) < HIT_R);
    canvas.style.cursor = hover ? 'grab' : 'default';
  }
});

canvas.addEventListener('mousedown', e => {
  const pos = canvasPos(e);

  if (S.mode === 'drawing') {
    const anchors = S.drawAnchors;

    // Close on click near first anchor
    if (anchors.length >= 3 && dist(pos, anchors[0]) < CLOSE_R) {
      closeShape();
      return;
    }

    // Validate against locked anchor count
    if (S.requiredN > 0 && anchors.length >= S.requiredN) {
      toast(`Shape must have ${S.requiredN} anchors. Close now or discard.`);
      return;
    }

    anchors.push({ ...pos });
    staticRender();
  }

  if (S.mode === 'editing') {
    // Find closest draggable point within HIT_R
    let closestIdx = -1, closestD = HIT_R;
    S.currentShape.forEach((p, i) => {
      const d = dist(pos, p);
      if (d < closestD) { closestD = d; closestIdx = i; }
    });
    S.dragIdx = closestIdx;
    if (S.dragIdx >= 0) canvas.style.cursor = 'grabbing';
  }
});

canvas.addEventListener('mouseup',    () => { S.dragIdx = -1; canvas.style.cursor = 'default'; });
canvas.addEventListener('mouseleave', () => { S.dragIdx = -1; });

canvas.addEventListener('dblclick', () => {
  if (S.mode === 'drawing' && S.drawAnchors.length >= 3) closeShape();
});


// ══════════════════════════════════════════════════════════════════════════
//  SHAPE CLOSING
// ══════════════════════════════════════════════════════════════════════════

function closeShape() {
  const anchors = S.drawAnchors;
  const N       = anchors.length;

  if (S.requiredN > 0 && N !== S.requiredN) {
    toast(`Need ${S.requiredN} anchors (you have ${N}).`);
    return;
  }

  // Convert raw anchors → flat Bézier control points
  S.currentShape  = anchorsToBezier(anchors);
  S.drawAnchors   = [];
  S.mode          = 'editing';

  $('btn-add').disabled     = false;
  $('btn-discard').disabled = false;
  canvas.style.cursor = 'default';

  staticRender();
}


// ══════════════════════════════════════════════════════════════════════════
//  BUTTON / CONTROL HANDLERS
// ══════════════════════════════════════════════════════════════════════════

$('btn-draw').addEventListener('click', () => {
  if (S.mode === 'animating') stopAnim();
  S.mode          = 'drawing';
  S.drawAnchors   = [];
  S.currentShape  = null;
  S.dragIdx       = -1;
  $('btn-add').disabled     = true;
  $('btn-discard').disabled = true;
  canvas.style.cursor = 'crosshair';
  staticRender();
});

$('btn-add').addEventListener('click', () => {
  if (!S.currentShape) return;
  const N = S.currentShape.length / 3;

  if (S.animQueue.length === 0) {
    S.requiredN = N;
  } else if (N !== S.requiredN) {
    toast(`Shape has ${N} anchors but queue needs ${S.requiredN}.`);
    return;
  }

  // Reorder to minimise twist relative to the previous shape
  let ordered = S.currentShape;
  if (S.animQueue.length > 0) {
    ordered = reorderToMatch(S.currentShape, S.animQueue[S.animQueue.length - 1]);
  }

  S.animQueue.push(ordered);
  S.currentShape = null;
  S.mode = 'idle';
  $('btn-add').disabled     = true;
  $('btn-discard').disabled = true;
  $('btn-play').disabled    = S.animQueue.length < 2;
  canvas.style.cursor = 'default';

  updateQueueUI();
  staticRender();
});

$('btn-discard').addEventListener('click', () => {
  S.currentShape = null;
  S.drawAnchors  = [];
  S.mode         = 'idle';
  $('btn-add').disabled     = true;
  $('btn-discard').disabled = true;
  canvas.style.cursor = 'default';
  staticRender();
});

$('btn-play').addEventListener('click', () => {
  if (S.animQueue.length < 2) { toast('Add at least 2 shapes.'); return; }
  startAnim();
});

$('btn-stop').addEventListener('click', stopAnim);

$('btn-reset').addEventListener('click', () => {
  stopAnim();
  Object.assign(S, {
    mode: 'idle', drawAnchors: [], currentShape: null, dragIdx: -1,
    animQueue: [], requiredN: 0, animT: 0,
  });
  $('btn-add').disabled     = true;
  $('btn-discard').disabled = true;
  $('btn-play').disabled    = true;
  $('btn-stop').disabled    = true;
  $('t-display').textContent = '';
  canvas.style.cursor = 'default';
  updateQueueUI();
  staticRender();
});

// Speed slider
$('speed-slider').addEventListener('input', () => {
  S.animSpeed = parseFloat($('speed-slider').value);
  $('speed-val').textContent = S.animSpeed.toFixed(1) + 's';
});

// Bézier evaluation method selector (educational toggle)
$('bezier-method').addEventListener('change', () => {
  S.bezierMethod = $('bezier-method').value;
  if (S.mode !== 'animating') staticRender();
});


// ══════════════════════════════════════════════════════════════════════════
//  ANIMATION CONTROL
// ══════════════════════════════════════════════════════════════════════════

function startAnim() {
  if (S.mode === 'animating') return;
  S.mode    = 'animating';
  S.animT   = 0;
  S.lastTs  = performance.now();
  $('btn-play').disabled = true;
  $('btn-stop').disabled = false;
  S.animRaf = requestAnimationFrame(animLoop);
}

function stopAnim() {
  if (S.animRaf) { cancelAnimationFrame(S.animRaf); S.animRaf = null; }
  S.mode = 'idle';
  $('t-display').textContent = '';
  $('btn-play').disabled = S.animQueue.length < 2;
  $('btn-stop').disabled = true;
  staticRender();
}


// ══════════════════════════════════════════════════════════════════════════
//  KEYBOARD SHORTCUTS
// ══════════════════════════════════════════════════════════════════════════

window.addEventListener('keydown', e => {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;

  switch (e.key) {
    case 'd': case 'D':
      $('btn-draw').click(); break;

    case 'p': case 'P':
      if (S.mode === 'animating') stopAnim();
      else $('btn-play').click();
      break;

    case ' ':
      e.preventDefault();
      if (S.mode === 'drawing' && S.drawAnchors.length >= 3) closeShape();
      break;

    case 'Escape':
      if (S.mode === 'editing' || S.mode === 'drawing') $('btn-discard').click();
      if (S.mode === 'animating') stopAnim();
      break;
  }
});


// ══════════════════════════════════════════════════════════════════════════
//  UI UPDATES
// ══════════════════════════════════════════════════════════════════════════

function updateStatusUI() {
  const modeEl = $('st-mode');
  const ptsEl  = $('st-pts');
  const msgEl  = $('st-msg');

  modeEl.textContent = S.mode.toUpperCase();

  switch (S.mode) {
    case 'drawing': {
      const n   = S.drawAnchors.length;
      const req = S.requiredN || '?';
      ptsEl.textContent = `Anchors: ${n} / ${req}`;
      msgEl.textContent = n < 3
        ? 'Click canvas to place anchors'
        : 'Click ① to close, or double-click / Space';
      break;
    }
    case 'editing': {
      const n = S.currentShape.length / 3;
      ptsEl.textContent = `${n} anchors — shape ready`;
      msgEl.textContent = 'Drag red=anchor, gold=handle';
      break;
    }
    case 'animating': {
      const seg  = Math.floor(S.animT) % S.animQueue.length;
      const nxt  = (seg + 1) % S.animQueue.length;
      ptsEl.textContent = `Segment ${seg + 1} → ${nxt + 1}`;
      msgEl.textContent = 'Morphing… press [P] or Stop to pause';
      break;
    }
    default: {
      ptsEl.textContent = `Queue: ${S.animQueue.length} shape(s)`;
      msgEl.textContent = S.animQueue.length >= 2 ? 'Ready ▶ press Play or [P]'
                       : S.animQueue.length === 1 ? 'Add one more shape to animate'
                       : 'Press [D] or "Draw New Shape" to begin';
    }
  }
}

function updateQueueUI() {
  $('q-count').textContent = S.animQueue.length;
  const list = $('queue-list');
  list.innerHTML = '';
  S.animQueue.forEach((shape, i) => {
    const el = document.createElement('div');
    el.className = 'q-item';
    el.innerHTML = `<span class="q-num">SHAPE ${i + 1}</span>
                    <span class="q-pts">${shape.length / 3} pts</span>`;
    list.appendChild(el);
  });
}

let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = '⚠  ' + msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}


// ══════════════════════════════════════════════════════════════════════════
//  INITIALISATION
//  Populate the queue with flower-themed presets so the user sees a working
//  animation immediately. Matches the visual style of image 2 in the lab.
// ══════════════════════════════════════════════════════════════════════════

(function init() {
  const cx = canvas.width  / 2;
  const cy = canvas.height / 2;
  const R  = canvas.width  * 0.20;

  const { queue, N } = buildPresetQueue(cx, cy, R);
  S.animQueue = queue;
  S.requiredN = N;

  $('btn-play').disabled = false;
  updateQueueUI();
  staticRender();
})();

// ══════════════════════════════════════════════════════════════════════════
//  THEME TOGGLE  (light / dark)
// ══════════════════════════════════════════════════════════════════════════

(function initTheme() {
  const root   = document.documentElement;
  const btn    = $('btn-theme');
  const stored = localStorage.getItem('billboard-theme');

  function applyTheme(theme) {
    if (theme === 'light') {
      root.setAttribute('data-theme', 'light');
      btn.textContent = '☽';
      btn.title = 'Switch to dark theme';
    } else {
      root.removeAttribute('data-theme');
      btn.textContent = '☀';
      btn.title = 'Switch to light theme';
    }
    localStorage.setItem('billboard-theme', theme);
  }

  applyTheme(stored === 'light' ? 'light' : 'dark');

  btn.addEventListener('click', () => {
    const current = root.getAttribute('data-theme');
    applyTheme(current === 'light' ? 'dark' : 'light');
  });
})();
