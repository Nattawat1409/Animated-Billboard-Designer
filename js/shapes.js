"use strict";

// flat array layout per shape:
// [ anchor_0, ctrlOut_0, ctrlIn_1,  anchor_1, ctrlOut_1, ctrlIn_2, ... ]
// segment i uses pts[3i], pts[3i+1], pts[3i+2], pts[3((i+1)%N)]


// --- Catmull-Rom → Bezier handle conversion ---
// ctrlOut_i   = curr + (next - prev) / 6
// ctrlIn_i+1  = next - (next2 - curr) / 6
// gives C¹ continuity (smooth tangent at every anchor)
function anchorsToBezier(anchors) {
  const N   = anchors.length;
  const pts = [];
  for (let i = 0; i < N; i++) {
    const prev  = anchors[(i - 1 + N) % N];
    const curr  = anchors[i];
    const next  = anchors[(i + 1) % N];
    const next2 = anchors[(i + 2) % N];
    const ctrlOut = {
      x: curr.x + (next.x - prev.x) / 6,
      y: curr.y + (next.y - prev.y) / 6,
    };
    const ctrlIn = {
      x: next.x - (next2.x - curr.x) / 6,
      y: next.y - (next2.y - curr.y) / 6,
    };
    pts.push({ ...curr }, ctrlOut, ctrlIn);
  }
  return pts;
}


// try all N cyclic rotations, pick the one with min total anchor distance
function reorderToMatch(newPts, refPts) {
  const N = newPts.length / 3;
  let bestOffset = 0, bestDist = Infinity;
  for (let offset = 0; offset < N; offset++) {
    let d = 0;
    for (let i = 0; i < N; i++) {
      const ni = ((i + offset) % N) * 3;
      const ri = i * 3;
      const dx = newPts[ni].x - refPts[ri].x;
      const dy = newPts[ni].y - refPts[ri].y;
      d += dx*dx + dy*dy;
    }
    if (d < bestDist) { bestDist = d; bestOffset = offset; }
  }
  const result = [];
  for (let i = 0; i < N; i++) {
    const src = ((i + bestOffset) % N) * 3;
    result.push({ ...newPts[src] }, { ...newPts[src+1] }, { ...newPts[src+2] });
  }
  return result;
}

// two-pass cycle alignment so last→first transition is also twist-free
// pass1: align each to previous  →  pass2: close loop then re-propagate
function alignCycle(shapes) {
  const n = shapes.length;
  if (n < 2) return shapes.slice();
  const a = [shapes[0]];
  for (let i = 1; i < n; i++) a.push(reorderToMatch(shapes[i], a[i-1]));
  a[0] = reorderToMatch(a[0], a[n-1]);
  for (let i = 1; i < n; i++) a[i] = reorderToMatch(a[i], a[i-1]);
  return a;
}


// --- Shape generators (return anchor arrays, call anchorsToBezier after) ---

function makeCircle(cx, cy, R, N) {
  const anchors = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 - Math.PI / 2;
    anchors.push({ x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) });
  }
  return anchors;
}

// N = petals*2, alternating outer/inner radius
function makeFlower(cx, cy, R, petals, innerRatio = 0.42, rotation = 0) {
  const N = petals * 2;
  const anchors = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 - Math.PI / 2 + rotation;
    const r = (i % 2 === 0) ? R : R * innerRatio;
    anchors.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return anchors;
}

// same as flower but smaller inner ratio → sharper points
function makeStar(cx, cy, R, N, innerRatio = 0.38, rotation = 0) {
  const anchors = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 - Math.PI / 2 + rotation;
    const r = (i % 2 === 0) ? R : R * innerRatio;
    anchors.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return anchors;
}

// parametric heart: x = 16sin³t, y = 13cos(t) - 5cos(2t) - 2cos(3t) - cos(4t)
function makeHeart(cx, cy, R, N) {
  const scale   = R / 17;
  const yOffset = R * 0.08;
  const anchors = [];
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    anchors.push({
      x: cx + scale * 16 * Math.pow(Math.sin(t), 3),
      y: (cy + yOffset) - scale * (13*Math.cos(t) - 5*Math.cos(2*t) - 2*Math.cos(3*t) - Math.cos(4*t)),
    });
  }
  return anchors;
}

function makePolygon(cx, cy, R, N) { return makeCircle(cx, cy, R, N); }

// distribute N anchors evenly along the perimeter of a regular polygon with `sides` corners
// keeps sharp edges regardless of N — used for triangle, hexagon, etc.
function makeRegularPolygon(cx, cy, R, sides, N) {
  const verts = [];
  for (let v = 0; v < sides; v++) {
    const a = (v / sides) * Math.PI * 2 - Math.PI / 2;
    verts.push({ x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) });
  }
  const anchors = [];
  for (let i = 0; i < N; i++) {
    const pos  = (i / N) * sides;
    const edge = Math.floor(pos) % sides;
    const t    = pos - Math.floor(pos);
    const v0   = verts[edge];
    const v1   = verts[(edge + 1) % sides];
    anchors.push({ x: v0.x + (v1.x - v0.x) * t, y: v0.y + (v1.y - v0.y) * t });
  }
  return anchors;
}


// build default preset queue — 4 shapes, all cycle-aligned
function buildPresetQueue(cx, cy, R) {
  const PETALS = 5;
  const N = PETALS * 2;
  const raw = [
    anchorsToBezier(makeCircle(cx, cy, R, N)),
    anchorsToBezier(makeFlower(cx, cy, R,        PETALS, 0.42, 0)),
    anchorsToBezier(makeFlower(cx, cy, R * 0.95, PETALS, 0.38, Math.PI / PETALS)),
    anchorsToBezier(makeHeart (cx, cy, R * 1.05, N)),
  ];
  return { queue: alignCycle(raw), N };
}
