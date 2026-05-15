"use strict";

// --- DOM ---
const $ = (id) => document.getElementById(id);
const canvas = $('canvas');
const ctx    = canvas.getContext('2d');

// --- Canvas size ---
(function sizeCanvas() {
  const wrap = $('canvas-wrap');
  const size = Math.min(wrap.clientWidth - 40, wrap.clientHeight - 80, 720);
  canvas.width  = Math.max(420, size);
  canvas.height = canvas.width;
})();

// --- Visual constants ---
const CLOSE_R = 16;
const HIT_R   = 10;

const FILL      = 'rgba(77,217,188,0.22)';
const STROKE    = 'rgba(77,217,188,0.88)';

const GHOST_FILL_ACTIVE = 'rgba(77,217,188,0.05)';
const GHOST_STR_ACTIVE  = 'rgba(77,217,188,0.22)';
const GHOST_FILL_DIM    = 'rgba(77,217,188,0.02)';
const GHOST_STR_DIM     = 'rgba(77,217,188,0.08)';

const ANCHOR_C  = '#ff6b8a';
const HANDLE_C  = '#ffc940';
const PREVIEW_C = 'rgba(77,217,188,0.4)';

// --- App state ---
const S = {
  mode:         'idle',   // idle | drawing | editing | animating
  drawAnchors:  [],
  mouse:        { x: 0, y: 0 },
  currentShape: null,
  dragIdx:      -1,
  animQueue:    [],
  requiredN:    0,
  animRaf:      null,
  animT:        0,
  lastTs:       0,        // 0 = uninitialised, set on first RAF frame
  animSpeed:    1.8,
  bezierMethod: 'canvas',
};


// --- Canvas mode class → drives CSS border glow ---
function setCanvasMode(mode) {
  canvas.classList.remove('mode-drawing', 'mode-editing', 'mode-animating');
  if (mode) canvas.classList.add(`mode-${mode}`);
}


// --- Path builder (supports all 3 Bezier methods) ---
function buildPath(pts) {
  const N = pts.length / 3;
  ctx.beginPath();
  if (S.bezierMethod === 'canvas') {
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 0; i < N; i++) {
      const p1 = pts[i*3+1], p2 = pts[i*3+2], p3 = pts[((i+1)%N)*3];
      ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
    }
  } else {
    const evalFn = S.bezierMethod === 'bernstein' ? cubicBezierBernstein
                 : S.bezierMethod === 'matrix'    ? cubicBezierMatrix
                 :                                  deCasteljauCubic;
    ctx.moveTo(pts[0].x, pts[0].y);
    const STEPS = 24;
    for (let i = 0; i < N; i++) {
      const P0 = pts[i*3], P1 = pts[i*3+1], P2 = pts[i*3+2], P3 = pts[((i+1)%N)*3];
      for (let k = 1; k <= STEPS; k++) {
        const pt = evalFn(k / STEPS, P0, P1, P2, P3);
        ctx.lineTo(pt.x, pt.y);
      }
    }
  }
  ctx.closePath();
}

function deCasteljauCubic(t, P0, P1, P2, P3) {
  return deCasteljau(t, [P0, P1, P2, P3]);
}

function drawShape(pts, fill, stroke, lw = 2, blur = 0, shadowColor = 'transparent') {
  ctx.save();
  if (blur > 0) { ctx.shadowBlur = blur; ctx.shadowColor = shadowColor; }
  buildPath(pts);
  if (fill)   { ctx.fillStyle = fill;     ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
  ctx.restore();
}

// edit overlay: red anchors + gold handles + dashed lines
function drawHandles(pts) {
  const N = pts.length / 3;
  ctx.save();
  ctx.setLineDash([3, 4]);
  ctx.strokeStyle = 'rgba(255,201,74,0.3)';
  ctx.lineWidth   = 1;
  for (let i = 0; i < N; i++) {
    const a = pts[i*3], co = pts[i*3+1], ci = pts[i*3+2], na = pts[((i+1)%N)*3];
    ctx.beginPath(); ctx.moveTo(a.x,  a.y);  ctx.lineTo(co.x, co.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(na.x, na.y); ctx.lineTo(ci.x, ci.y); ctx.stroke();
  }
  ctx.restore();
  ctx.setLineDash([]);
  for (let i = 0; i < N; i++) {
    [pts[i*3+1], pts[i*3+2]].forEach(p => {
      ctx.fillStyle = HANDLE_C; ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(p.x, p.y, 4.5, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    });
  }
  for (let i = 0; i < N; i++) {
    const a = pts[i*3];
    ctx.fillStyle = ANCHOR_C; ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.5;
    ctx.shadowBlur = 6; ctx.shadowColor = 'rgba(255,107,138,0.5)';
    ctx.beginPath(); ctx.arc(a.x, a.y, 7, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;
  }
}

function drawAnimDots(pts) {
  const N = pts.length / 3;
  for (let i = 0; i < N; i++) {
    const a = pts[i*3];
    ctx.fillStyle = 'rgba(77,217,188,0.55)';
    ctx.shadowBlur = 4; ctx.shadowColor = 'rgba(77,217,188,0.5)';
    ctx.beginPath(); ctx.arc(a.x, a.y, 2.5, 0, Math.PI*2); ctx.fill();
    ctx.shadowBlur = 0;
  }
}

// live Catmull-Rom preview while placing anchors
function drawPreview() {
  const placed = S.drawAnchors;
  if (!placed.length) return;
  const pts = [...placed, S.mouse];
  const N   = pts.length;
  if (N >= 2) {
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = PREVIEW_C; ctx.lineWidth = 1.5;
    ctx.shadowBlur = 8; ctx.shadowColor = 'rgba(130,100,255,0.3)';
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 0; i < N - 1; i++) {
      const p0 = pts[Math.max(0, i-1)], p1 = pts[i], p2 = pts[i+1], p3 = pts[Math.min(N-1, i+2)];
      const cp1 = { x: p1.x + (p2.x-p0.x)/6, y: p1.y + (p2.y-p0.y)/6 };
      const cp2 = { x: p2.x - (p3.x-p1.x)/6, y: p2.y - (p3.y-p1.y)/6 };
      ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, p2.x, p2.y);
    }
    ctx.stroke(); ctx.restore();
  }
  placed.forEach((p, i) => {
    const isFirst = (i === 0);
    if (isFirst && placed.length >= 3) {
      const near = dist(S.mouse, p) < CLOSE_R;
      ctx.strokeStyle = near ? 'rgba(130,100,255,0.7)' : 'rgba(130,100,255,0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(p.x, p.y, CLOSE_R, 0, Math.PI*2); ctx.stroke();
    }
    ctx.fillStyle = isFirst ? '#8264ff' : 'rgba(130,100,255,0.65)';
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1;
    ctx.shadowBlur = isFirst ? 8 : 0; ctx.shadowColor = 'rgba(130,100,255,0.5)';
    ctx.beginPath(); ctx.arc(p.x, p.y, isFirst ? 7 : 4.5, 0, Math.PI*2);
    ctx.fill(); ctx.stroke(); ctx.shadowBlur = 0;
  });
}

function drawGrid() {
  ctx.fillStyle = 'rgba(255,255,255,0.018)';
  const step = 30;
  for (let x = step; x < canvas.width;  x += step)
    for (let y = step; y < canvas.height; y += step)
      ctx.fillRect(x - 0.5, y - 0.5, 1, 1);
}

function drawCrosshair() {
  const cx = canvas.width/2, cy = canvas.height/2;
  ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(cx, 0);  ctx.lineTo(cx, canvas.height); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, cy);  ctx.lineTo(canvas.width, cy);  ctx.stroke();
}


// --- Render ---

function staticRender() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid(); drawCrosshair();
  S.animQueue.forEach((shape, idx) => {
    const isLast = idx === S.animQueue.length - 1;
    drawShape(shape,
      `rgba(77,217,188,${isLast ? 0.08 : 0.03})`,
      `rgba(77,217,188,${isLast ? 0.22 : 0.10})`,
      isLast ? 1 : 0.5);
  });
  if (S.mode === 'drawing') {
    drawPreview();
  } else if (S.mode === 'editing' && S.currentShape) {
    drawShape(S.currentShape, FILL, STROKE, 2.5, 12, 'rgba(77,217,188,0.3)');
    drawHandles(S.currentShape);
  }
  updateStatusUI();
}

function animLoop(timestamp) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid(); drawCrosshair();

  // dt = 0 on first frame so animation resumes smoothly from paused position
  if (!S.lastTs) S.lastTs = timestamp;
  const dt = Math.min((timestamp - S.lastTs) / 1000, 0.1); // cap at 100ms (tab switch)
  S.lastTs  = timestamp;
  S.animT   = (S.animT + dt / S.animSpeed) % S.animQueue.length;

  const segIdx = Math.floor(S.animT);
  const rawT   = S.animT - segIdx;
  const shapeA = S.animQueue[segIdx];
  const shapeB = S.animQueue[(segIdx + 1) % S.animQueue.length];
  const frame  = interpolateShapes(shapeA, shapeB, rawT);

  // ghost outlines of all shapes in queue
  S.animQueue.forEach((shape, idx) => {
    const active = idx === segIdx || idx === (segIdx+1) % S.animQueue.length;
    drawShape(shape,
      active ? GHOST_FILL_ACTIVE : GHOST_FILL_DIM,
      active ? GHOST_STR_ACTIVE  : GHOST_STR_DIM,
      0.5 + (active ? 0.3 : 0));
  });

  // morphed frame with neon glow
  drawShape(frame, FILL, STROKE, 2.5, 22, 'rgba(77,217,188,0.45)');
  drawAnimDots(frame);

  const tDisp = $('t-display');
  tDisp.textContent = `${segIdx+1} → ${(segIdx+1) % S.animQueue.length + 1}   t = ${rawT.toFixed(3)}`;
  tDisp.classList.add('active');

  updateProgressTrack();
  updateStatusUI();
  const displayIdx = rawT >= 0.5 ? (segIdx + 1) % S.animQueue.length : segIdx;
  highlightActiveQueueItem(displayIdx);
  S.animRaf = requestAnimationFrame(animLoop);
}


// --- Progress track ---

function buildProgressTrack() {
  const rail = $('anim-track-rail'), labels = $('anim-track-labels');
  rail.querySelectorAll('.track-marker').forEach(m => m.remove());
  labels.innerHTML = '';
  const n = S.animQueue.length;
  if (n < 2) return;
  S.animQueue.forEach((_, i) => {
    const pct = (i / n) * 100;
    const marker = document.createElement('div');
    marker.className = 'track-marker'; marker.style.left = pct + '%'; marker.dataset.idx = i;
    rail.appendChild(marker);
    const lbl = document.createElement('span');
    lbl.className = 'track-label'; lbl.textContent = i + 1;
    lbl.style.width = (100/n) + '%'; lbl.style.textAlign = 'center'; lbl.dataset.idx = i;
    labels.appendChild(lbl);
  });
  $('anim-track').style.minWidth = Math.max(160, n * 44) + 'px';
}

function updateProgressTrack() {
  const track = $('anim-track');
  if (S.mode !== 'animating') { track.classList.remove('visible'); return; }
  track.classList.add('visible');
  const pct = (S.animT / S.animQueue.length) * 100;
  $('anim-track-fill').style.width = pct + '%';
  $('anim-track-head').style.left  = pct + '%';
  const seg = Math.floor(S.animT) % S.animQueue.length;
  $('anim-track-rail').querySelectorAll('.track-marker').forEach(m =>
    m.classList.toggle('active', +m.dataset.idx === seg));
  $('anim-track-labels').querySelectorAll('.track-label').forEach(l =>
    l.classList.toggle('active', +l.dataset.idx === seg));
}


// --- Queue thumbnails ---

function makeThumbnailCanvas(shape) {
  const SIZE = 36;
  const tc = document.createElement('canvas');
  tc.width = tc.height = SIZE;
  const tx = tc.getContext('2d');
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  shape.forEach(p => {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  });
  const scale = Math.min((SIZE-8) / Math.max(maxX-minX,1), (SIZE-8) / Math.max(maxY-minY,1)) * 0.9;
  const offX  = (SIZE - (maxX-minX)*scale) / 2 - minX*scale;
  const offY  = (SIZE - (maxY-minY)*scale) / 2 - minY*scale;
  const sc = shape.map(p => ({ x: p.x*scale+offX, y: p.y*scale+offY }));
  const N  = sc.length / 3;
  tx.beginPath(); tx.moveTo(sc[0].x, sc[0].y);
  for (let i = 0; i < N; i++) {
    const p1 = sc[i*3+1], p2 = sc[i*3+2], p3 = sc[((i+1)%N)*3];
    tx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
  }
  tx.closePath();
  tx.fillStyle = 'rgba(77,217,188,0.2)'; tx.strokeStyle = 'rgba(77,217,188,0.8)'; tx.lineWidth = 1;
  tx.shadowBlur = 4; tx.shadowColor = 'rgba(77,217,188,0.4)';
  tx.fill(); tx.stroke();
  return tc;
}

function highlightActiveQueueItem(segIdx) {
  document.querySelectorAll('.q-item').forEach((el, i) =>
    el.classList.toggle('active', i === segIdx));
}


// --- Mouse ---

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
    canvas.style.cursor = (S.drawAnchors.length >= 3 && dist(pos, S.drawAnchors[0]) < CLOSE_R) ? 'cell' : 'crosshair';
  }
  if (S.mode === 'editing' && S.dragIdx >= 0) { S.currentShape[S.dragIdx] = { ...pos }; staticRender(); }
  if (S.mode === 'editing' && S.dragIdx < 0)  { canvas.style.cursor = S.currentShape.some(p => dist(pos,p) < HIT_R) ? 'grab' : 'default'; }
});

canvas.addEventListener('mousedown', e => {
  const pos = canvasPos(e);
  if (S.mode === 'drawing') {
    const a = S.drawAnchors;
    if (a.length >= 3 && dist(pos, a[0]) < CLOSE_R) { closeShape(); return; }
    if (S.requiredN > 0 && a.length >= S.requiredN)  { toast(`Shape must have exactly ${S.requiredN} anchors.`); return; }
    a.push({ ...pos }); staticRender();
  }
  if (S.mode === 'editing') {
    let closestIdx = -1, closestD = HIT_R;
    S.currentShape.forEach((p, i) => { const d = dist(pos, p); if (d < closestD) { closestD = d; closestIdx = i; } });
    S.dragIdx = closestIdx;
    if (S.dragIdx >= 0) canvas.style.cursor = 'grabbing';
  }
});

canvas.addEventListener('mouseup',    () => { S.dragIdx = -1; canvas.style.cursor = 'default'; });
canvas.addEventListener('mouseleave', () => { S.dragIdx = -1; });
canvas.addEventListener('dblclick',   () => { if (S.mode === 'drawing' && S.drawAnchors.length >= 3) closeShape(); });


// --- Shape closing ---

function closeShape() {
  const anchors = S.drawAnchors, N = anchors.length;
  if (S.requiredN > 0 && N !== S.requiredN) { toast(`Need ${S.requiredN} anchors (you placed ${N}).`); return; }
  S.currentShape = anchorsToBezier(anchors);
  S.drawAnchors  = [];
  S.mode         = 'editing';
  setCanvasMode('editing');
  $('btn-add').disabled = false; $('btn-discard').disabled = false;
  canvas.style.cursor = 'default';
  staticRender();
}


// --- Buttons ---

$('btn-draw').addEventListener('click', () => {
  if (S.mode === 'animating') stopAnim();
  S.mode = 'drawing'; S.drawAnchors = []; S.currentShape = null; S.dragIdx = -1;
  setCanvasMode('drawing');
  $('btn-add').disabled = true; $('btn-discard').disabled = true;
  canvas.style.cursor = 'crosshair';
  staticRender();
});

$('btn-add').addEventListener('click', () => {
  if (!S.currentShape) return;
  const N = S.currentShape.length / 3;
  if (S.animQueue.length === 0) { S.requiredN = N; }
  else if (N !== S.requiredN)   { toast(`Shape has ${N} anchors but queue needs ${S.requiredN}.`); return; }
  let ordered = S.currentShape;
  if (S.animQueue.length > 0) ordered = reorderToMatch(S.currentShape, S.animQueue[S.animQueue.length-1]);
  S.animQueue.push(ordered);
  S.currentShape = null; S.mode = 'idle'; setCanvasMode(null);
  $('btn-add').disabled = true; $('btn-discard').disabled = true;
  $('btn-play').disabled = S.animQueue.length < 2;
  canvas.style.cursor = 'default';
  updateQueueUI(); staticRender();
});

$('btn-discard').addEventListener('click', () => {
  S.currentShape = null; S.drawAnchors = []; S.mode = 'idle'; setCanvasMode(null);
  $('btn-add').disabled = true; $('btn-discard').disabled = true;
  canvas.style.cursor = 'default'; staticRender();
});

$('btn-play').addEventListener('click', () => {
  if (S.animQueue.length < 2) { toast('Add at least 2 shapes first.'); return; }
  startAnim();
});

$('btn-stop').addEventListener('click', stopAnim);

$('btn-reset').addEventListener('click', () => {
  stopAnim();
  Object.assign(S, { mode:'idle', drawAnchors:[], currentShape:null, dragIdx:-1, animQueue:[], requiredN:0, animT:0, lastTs:0 });
  setCanvasMode(null);
  $('btn-add').disabled = true; $('btn-discard').disabled = true;
  $('btn-play').disabled = true; $('btn-stop').disabled = true;
  const td = $('t-display'); td.textContent = ''; td.classList.remove('active');
  canvas.style.cursor = 'default';
  updateQueueUI(); staticRender();
});

$('speed-slider').addEventListener('input', () => {
  S.animSpeed = parseFloat($('speed-slider').value);
  $('speed-val').textContent = S.animSpeed.toFixed(1) + 's';
});

$('bezier-method').addEventListener('change', () => {
  S.bezierMethod = $('bezier-method').value;
  if (S.mode !== 'animating') staticRender();
});

$('btn-preset').addEventListener('click', () => {
  if (S.mode === 'animating') stopAnim();
  const cx = canvas.width/2, cy = canvas.height/2, R = canvas.width*0.20;
  const preset   = $('preset-select').value;
  const naturalN = { circle:8, flower5:10, flower6:12, star5:10, star6:12, heart:10, hexagon:12, triangle:10 };
  const N        = S.requiredN > 0 ? S.requiredN : (naturalN[preset] || 10);
  if (['flower5','flower6','star5','star6'].includes(preset) && N % 2 !== 0) {
    toast(`${preset} needs even anchor count (queue uses ${N}).`); return;
  }
  let anchors;
  switch (preset) {
    case 'flower5': case 'flower6': anchors = makeFlower(cx, cy, R, N/2, 0.42, 0);  break;
    case 'star5':   case 'star6':   anchors = makeStar(cx, cy, R, N, 0.38, 0);       break;
    case 'heart':                   anchors = makeHeart(cx, cy, R*1.05, N);           break;
    case 'triangle':                anchors = makeRegularPolygon(cx, cy, R, 3, N);    break;
    case 'hexagon':                 anchors = makeRegularPolygon(cx, cy, R, 6, N);    break;
    default:                        anchors = makeCircle(cx, cy, R, N);               break;
  }
  let shape = anchorsToBezier(anchors);
  const actual = shape.length / 3;
  if (S.requiredN > 0 && actual !== S.requiredN) { toast(`Preset has ${actual} anchors but queue needs ${S.requiredN}.`); return; }
  if (S.animQueue.length > 0) shape = reorderToMatch(shape, S.animQueue[S.animQueue.length-1]);
  else S.requiredN = actual;
  S.animQueue.push(shape);
  $('btn-play').disabled = S.animQueue.length < 2;
  updateQueueUI(); staticRender();
  toast(`Added ${preset} (${actual} anchors)`);
});


// --- Animation control ---

function startAnim() {
  if (S.mode === 'animating') return;
  S.mode = 'animating'; S.animT = 0; S.lastTs = 0;
  setCanvasMode('animating');
  $('btn-play').disabled = true; $('btn-stop').disabled = false;
  S.animRaf = requestAnimationFrame(animLoop);
}

function stopAnim() {
  if (S.animRaf) { cancelAnimationFrame(S.animRaf); S.animRaf = null; }
  S.mode = 'idle'; S.lastTs = 0;
  setCanvasMode(null);
  const td = $('t-display'); td.textContent = ''; td.classList.remove('active');
  $('anim-track').classList.remove('visible');
  document.querySelectorAll('.q-item').forEach(el => el.classList.remove('active'));
  $('btn-play').disabled = S.animQueue.length < 2; $('btn-stop').disabled = true;
  staticRender();
}


// --- Keyboard shortcuts ---

window.addEventListener('keydown', e => {
  if (['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) return;
  switch (e.key) {
    case 'd': case 'D': $('btn-draw').click(); break;
    case 'p': case 'P': S.mode === 'animating' ? stopAnim() : $('btn-play').click(); break;
    case ' ': e.preventDefault(); if (S.mode === 'drawing' && S.drawAnchors.length >= 3) closeShape(); break;
    case 'Escape':
      if (S.mode === 'editing' || S.mode === 'drawing') $('btn-discard').click();
      if (S.mode === 'animating') stopAnim();
      break;
  }
});


// --- UI updates ---

function updateStatusUI() {
  const modeEl = $('st-mode'), ptsEl = $('st-pts'), msgEl = $('st-msg'), badge = $('mode-badge');
  modeEl.textContent = S.mode.toUpperCase();
  modeEl.classList.toggle('pulse', S.mode === 'animating');
  badge.className = `badge-${S.mode}`;
  badge.textContent = S.mode.toUpperCase();
  switch (S.mode) {
    case 'drawing': {
      const n = S.drawAnchors.length, req = S.requiredN || '?';
      ptsEl.textContent = `Anchors: ${n} / ${req}`;
      msgEl.textContent = n < 3 ? 'Click canvas to place anchors' : 'Click ① to close, double-click, or Space';
      break;
    }
    case 'editing':
      ptsEl.textContent = `${S.currentShape.length/3} anchors — shape ready`;
      msgEl.textContent = 'Drag ● anchor or ◆ handle to reshape';
      break;
    case 'animating': {
      const seg = Math.floor(S.animT) % S.animQueue.length;
      ptsEl.textContent = `Morphing ${seg+1} → ${(seg+1) % S.animQueue.length + 1}`;
      msgEl.textContent = 'Press [P] or Stop to pause';
      break;
    }
    default:
      ptsEl.textContent = `Queue: ${S.animQueue.length} shape(s)`;
      msgEl.textContent = S.animQueue.length >= 2 ? 'Ready — press Play or [P]'
                        : S.animQueue.length === 1 ? 'Add one more shape to animate'
                        : 'Press [D] or "Draw New Shape" to begin';
  }
}

function updateQueueUI() {
  $('q-count').textContent = S.animQueue.length;
  const list = $('queue-list');
  list.innerHTML = '';
  S.animQueue.forEach((shape, i) => {
    const el = document.createElement('div');
    el.className = 'q-item';
    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'q-thumb';
    thumbWrap.appendChild(makeThumbnailCanvas(shape));
    const info = document.createElement('div');
    info.className = 'q-info';
    info.innerHTML = `<div class="q-num">SHAPE ${i+1}</div><div class="q-pts">${shape.length/3} pts</div>`;
    const acts = document.createElement('div');
    acts.className = 'q-actions';
    acts.innerHTML =
      `<button class="q-btn q-edit" data-idx="${i}" title="Re-edit">✏</button>` +
      `<button class="q-btn q-del"  data-idx="${i}" title="Remove">✕</button>`;
    el.append(thumbWrap, info, acts);
    list.appendChild(el);
  });
  list.querySelectorAll('.q-edit').forEach(btn => btn.addEventListener('click', () => editQueueItem(+btn.dataset.idx)));
  list.querySelectorAll('.q-del').forEach(btn  => btn.addEventListener('click', () => deleteQueueItem(+btn.dataset.idx)));
  buildProgressTrack();
}

function editQueueItem(idx) {
  if (S.mode === 'animating') stopAnim();
  S.currentShape = S.animQueue[idx].slice();
  S.animQueue.splice(idx, 1);
  S.mode = 'editing'; setCanvasMode('editing');
  $('btn-add').disabled = false; $('btn-discard').disabled = false;
  $('btn-play').disabled = S.animQueue.length < 2;
  canvas.style.cursor = 'default';
  updateQueueUI(); staticRender();
  toast(`Editing shape ${idx+1} — drag points, then ＋ Add to Animation`);
}

function deleteQueueItem(idx) {
  if (S.mode === 'animating') stopAnim();
  S.animQueue.splice(idx, 1);
  if (S.animQueue.length === 0)              { S.requiredN = 0; S.animT = 0; }
  else if (S.animT >= S.animQueue.length)    { S.animT = 0; }
  $('btn-play').disabled = S.animQueue.length < 2;
  updateQueueUI(); staticRender();
}

let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}


// --- Init ---

(function init() {
  const cx = canvas.width/2, cy = canvas.height/2, R = canvas.width*0.20;
  const { queue, N } = buildPresetQueue(cx, cy, R);
  S.animQueue = queue; S.requiredN = N;
  $('btn-play').disabled = false;
  updateQueueUI(); staticRender();
})();


// --- Theme toggle ---

(function initTheme() {
  const root = document.documentElement, btn = $('btn-theme');
  const stored = localStorage.getItem('billboard-theme');
  function applyTheme(theme) {
    if (theme === 'light') { root.setAttribute('data-theme','light'); btn.textContent = '☽'; }
    else                   { root.removeAttribute('data-theme');       btn.textContent = '☀'; }
    localStorage.setItem('billboard-theme', theme);
  }
  applyTheme(stored === 'light' ? 'light' : 'dark');
  btn.addEventListener('click', () => applyTheme(root.getAttribute('data-theme') === 'light' ? 'dark' : 'light'));
})();
