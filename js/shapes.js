/* ============================================================================
 *  shapes.js — Shape Construction & Preset Generators
 *
 *  Storage convention (matches the lab spec "flat list of control points"):
 *     For a closed curve with N anchors, the shape is a flat array of 3N
 *     points laid out as:
 *
 *         [ anchor_0,  ctrlOut_0,  ctrlIn_1,
 *           anchor_1,  ctrlOut_1,  ctrlIn_2,
 *           …
 *           anchor_{N-1}, ctrlOut_{N-1}, ctrlIn_0 ]
 *
 *     Segment i of the closed curve is the cubic Bézier with:
 *         P₀ = pts[3i]
 *         P₁ = pts[3i + 1]                ← ctrlOut leaving anchor i
 *         P₂ = pts[3i + 2]                ← ctrlIn  arriving at anchor i+1
 *         P₃ = pts[3·((i+1) mod N)]       ← anchor i+1 (wraps for closure)
 *
 *  This dual encoding ("anchor + 2 handles per vertex") lets us both render
 *  the curve and interpolate every control point, exactly as recommended
 *  in Section 2 of the project brief.
 * ============================================================================ */

"use strict";

// ──────────────────────────────────────────────────────────────────────────
//  CATMULL-ROM  →  CUBIC BÉZIER CONVERSION
//  Given N anchor positions (a closed polygon), auto-compute smooth tangent
//  handles so users only need to click anchor points to draw a clean shape.
//
//      ctrlOut_i  = P_i   + (P_{i+1} - P_{i-1}) / 6
//      ctrlIn_{i+1} = P_{i+1} − (P_{i+2} - P_i) / 6
//
//  Result is C¹-continuous (smooth tangents) at every anchor.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Convert N anchor points (closed loop) into a flat array of 3N Bézier
 * control points using Catmull-Rom auto-smoothing.
 *
 * @param {Array<{x,y}>} anchors
 * @returns {Array<{x,y}>} flat array of length 3N
 */
function anchorsToBezier(anchors) {
  const N   = anchors.length;
  const pts = [];

  for (let i = 0; i < N; i++) {
    const prev  = anchors[(i - 1 + N) % N];
    const curr  = anchors[i];
    const next  = anchors[(i + 1)     % N];
    const next2 = anchors[(i + 2)     % N];

    // Tangent leaving curr toward next
    const ctrlOut = {
      x: curr.x + (next.x - prev.x) / 6,
      y: curr.y + (next.y - prev.y) / 6,
    };

    // Tangent arriving at next from curr
    const ctrlIn = {
      x: next.x - (next2.x - curr.x) / 6,
      y: next.y - (next2.y - curr.y) / 6,
    };

    pts.push({ ...curr }, ctrlOut, ctrlIn);
  }

  return pts;
}


// ──────────────────────────────────────────────────────────────────────────
//  TWIST-MINIMISING REORDER
//  Section 4 of the spec: "Proper ordering of control points to avoid
//  twisting artifacts". We test all N cyclic rotations of the new shape's
//  anchors and pick the one with minimum sum-of-squared distances to the
//  reference shape's anchors.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Cyclically re-rotate a flat shape array so its anchors line up with the
 * reference shape, minimising total squared anchor distance.
 *
 * @param {Array<{x,y}>} newPts flat 3N points
 * @param {Array<{x,y}>} refPts flat 3N points (same length)
 * @returns {Array<{x,y}>} reordered copy of newPts
 */
function reorderToMatch(newPts, refPts) {
  const N = newPts.length / 3;
  let bestOffset = 0;
  let bestDist   = Infinity;

  for (let offset = 0; offset < N; offset++) {
    let dist = 0;
    for (let i = 0; i < N; i++) {
      // Compare anchors only (every 3rd point)
      const ni = ((i + offset) % N) * 3;
      const ri = i * 3;
      const dx = newPts[ni].x - refPts[ri].x;
      const dy = newPts[ni].y - refPts[ri].y;
      dist += dx * dx + dy * dy;
    }
    if (dist < bestDist) { bestDist = dist; bestOffset = offset; }
  }

  // Build reordered array
  const result = [];
  for (let i = 0; i < N; i++) {
    const src = ((i + bestOffset) % N) * 3;
    result.push({ ...newPts[src]     },
                { ...newPts[src + 1] },
                { ...newPts[src + 2] });
  }
  return result;
}


// ══════════════════════════════════════════════════════════════════════════
//  PRESET SHAPE GENERATORS
//  Each generator returns an array of ANCHOR points (not yet converted to
//  Bézier control points). Call anchorsToBezier() to obtain the flat 3N
//  representation used by the renderer / animator.
// ══════════════════════════════════════════════════════════════════════════

/**
 * Circle preset — N evenly spaced anchors on a circle.
 *
 * @param {number} cx  center x
 * @param {number} cy  center y
 * @param {number} R   radius
 * @param {number} N   anchor count
 */
function makeCircle(cx, cy, R, N) {
  const anchors = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 - Math.PI / 2;  // start at top
    anchors.push({ x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) });
  }
  return anchors;
}

/**
 * Flower preset — `petals` symmetric petals via alternating outer/inner radii.
 * Total anchor count = 2·petals.  With Catmull-Rom auto-smoothing this gives
 * the soft, blob-petal look shown in the example animation.
 *
 * @param {number} cx
 * @param {number} cy
 * @param {number} R           outer (tip) radius
 * @param {number} petals      number of petals
 * @param {number} innerRatio  inner radius / outer radius (0..1)
 * @param {number} rotation    starting angle in radians
 */
function makeFlower(cx, cy, R, petals, innerRatio = 0.4, rotation = 0) {
  const N = petals * 2;
  const anchors = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 - Math.PI / 2 + rotation;
    const r = (i % 2 === 0) ? R : R * innerRatio;
    anchors.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return anchors;
}

/**
 * Heart preset — uses the classic parametric heart curve:
 *     x = 16 sin³(t)
 *     y = 13 cos(t) − 5 cos(2t) − 2 cos(3t) − cos(4t)
 * Scaled to fit roughly within radius R, with the heart axis vertical.
 * Sampled at N parameter values evenly spaced in [0, 2π).
 *
 * @param {number} cx
 * @param {number} cy
 * @param {number} R   target outer extent
 * @param {number} N   anchor count
 */
function makeHeart(cx, cy, R, N) {
  const scale   = R / 17;        // empirical fit for the parametric formula
  const yOffset = R * 0.08;       // shift the heart slightly down for visual balance
  const anchors = [];

  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    anchors.push({
      x: cx + scale * 16 * Math.pow(Math.sin(t), 3),
      y: (cy + yOffset)
         - scale * (13 * Math.cos(t)
                  -  5 * Math.cos(2 * t)
                  -  2 * Math.cos(3 * t)
                  -      Math.cos(4 * t)),
    });
  }
  return anchors;
}


// ──────────────────────────────────────────────────────────────────────────
//  Convenience: build a full preset queue ready for animation.
//  Used by app.js on startup so users see a working animation immediately.
//  All presets share the same anchor count N for morph compatibility.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Build the default preset queue (flower-themed, matching the lab example).
 *
 * @param {number} cx
 * @param {number} cy
 * @param {number} R    base radius (≈ 17 % of canvas width)
 * @returns {{queue: Array, N: number}}
 *   queue: flat-Bézier shape array (after Catmull-Rom + reorder)
 *   N:     locked anchor count for the whole queue
 */
function buildPresetQueue(cx, cy, R) {
  const PETALS = 5;
  const N      = PETALS * 2;     // = 10 anchors per shape

  // 1) Smooth circle (warm-up frame)
  const circle  = anchorsToBezier(makeCircle(cx, cy, R, N));

  // 2) Five-petal flower (the main visual goal — matches image 2)
  const flowerA = anchorsToBezier(
    makeFlower(cx, cy, R, PETALS, 0.42, 0)
  );

  // 3) Same flower rotated half a petal — creates the gentle "rotation" morph
  const flowerB = anchorsToBezier(
    makeFlower(cx, cy, R * 0.95, PETALS, 0.38, Math.PI / PETALS)
  );

  // 4) Heart — different topology, demonstrates broader morphing capability
  const heart   = anchorsToBezier(makeHeart(cx, cy, R * 1.05, N));

  // Reorder each shape relative to the previous one to minimise twist
  const A = circle;
  const B = reorderToMatch(flowerA, A);
  const C = reorderToMatch(flowerB, B);
  const D = reorderToMatch(heart,   C);

  return { queue: [A, B, C, D], N };
}
