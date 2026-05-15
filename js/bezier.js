/* ============================================================================
 *  bezier.js — Bézier Curve Mathematics 
 *  utilities used by the morphing engine.
 * ============================================================================ */

"use strict";

// ──────────────────────────────────────────────────────────────────────────
//  BERNSTEIN BASIS POLYNOMIALS
//  B_i^n(t) = C(n,i) · t^i · (1−t)^(n−i)
//  Source: Lecture slide 3 — "Bezier Curve / Bernstein polynomials".
// ──────────────────────────────────────────────────────────────────────────

/** From Binomial coefficient C(n, i) = n! / (i! · (n-i)!). */
function binomial(n, i) {
  if (i < 0 || i > n) return 0;
  let coef = 1;
  for (let k = 0; k < i; k++) coef = coef * (n - k) / (k + 1);
  return coef;
}

/** From Bernstein basis polynomial of degree n at parameter t. */
function bernstein(n, i, t) {
  return binomial(n, i) * Math.pow(t, i) * Math.pow(1 - t, n - i);
}


// ──────────────────────────────────────────────────────────────────────────
//  (1) EXPLICIT BERNSTEIN FORM  — Cubic case (degree n = 3)
//      B(t) = (1−t)³ P₀ + 3t(1−t)² P₁ + 3t²(1−t) P₂ + t³ P₃
// ──────────────────────────────────────────────────────────────────────────

/**
 * Evaluate a cubic Bézier curve at parameter t using the explicit
 * Bernstein polynomial form. Returns the curve point {x, y}.
 *
 * @param {number} t   parameter in [0, 1]
 * @param {{x,y}} P0   start anchor
 * @param {{x,y}} P1   first control handle
 * @param {{x,y}} P2   second control handle
 * @param {{x,y}} P3   end anchor
 */
function cubicBezierBernstein(t, P0, P1, P2, P3) {
  const u   = 1 - t;
  const b0  = u * u * u;          // (1-t)³
  const b1  = 3 * t * u * u;      // 3t(1-t)²
  const b2  = 3 * t * t * u;      // 3t²(1-t)
  const b3  = t * t * t;          // t³

  return {
    x: b0 * P0.x + b1 * P1.x + b2 * P2.x + b3 * P3.x,
    y: b0 * P0.y + b1 * P1.y + b2 * P2.y + b3 * P3.y,
  };
}


// ──────────────────────────────────────────────────────────────────────────
//  (2) MATRIX REPRESENTATION  —  B(t) = G · M · T
//      G = [P₀ P₁ P₂ P₃]                  (control points, row vector)
//          ⎡ −1   3  −3   1 ⎤
//      M = ⎢  3  −6   3   0 ⎥             (Bézier basis matrix)
//          ⎢ −3   3   0   0 ⎥
//          ⎣  1   0   0   0 ⎦
//      T = [t³, t², t, 1]ᵀ                (parameter vector, column)
// ──────────────────────────────────────────────────────────────────────────

/** Cubic Bézier basis matrix M from the lecture. */
const BEZIER_MATRIX = [
  [-1,  3, -3, 1],
  [ 3, -6,  3, 0],
  [-3,  3,  0, 0],
  [ 1,  0,  0, 0],
];

/**
 * Evaluate a cubic Bézier curve at parameter t using the matrix form.
 * Performs the multiplication B(t) = G · M · T explicitly so the math
 * mirrors the lecture's notation exactly.
 */
function cubicBezierMatrix(t, P0, P1, P2, P3) {
  // T = [t³, t², t, 1]
  const T = [t * t * t, t * t, t, 1];
  const M = BEZIER_MATRIX;

  // Compute coefficients = T · M (row × matrix → row of 4 scalars)
  //   coef[j] = Σ_i  T[i] · M[i][j]
  const coef = [0, 0, 0, 0];
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 4; i++) {
      coef[j] += T[i] * M[i][j];
    }
  }

  // Multiply by G = [P₀, P₁, P₂, P₃]
  return {
    x: coef[0] * P0.x + coef[1] * P1.x + coef[2] * P2.x + coef[3] * P3.x,
    y: coef[0] * P0.y + coef[1] * P1.y + coef[2] * P2.y + coef[3] * P3.y,
  };
}


// ──────────────────────────────────────────────────────────────────────────
//  (3) de CASTELJAU RECURSIVE ALGORITHM
//      b_i^0(t) = b_i                                      (base case)
//      b_i^r(t) = (1−t)·b_i^(r−1)(t)  +  t·b_{i+1}^(r−1)(t)   (recursion)
//
//  Complexity: O(n²)  — n(n+1)/2 additions, n(n+1) multiplications.
//  This is the most numerically stable form and works for any degree.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Evaluate a Bézier curve of arbitrary degree at parameter t using the
 * de Casteljau recursive algorithm.
 *
 * @param {number} t       parameter in [0, 1]
 * @param {{x,y}[]} points control points b₀, b₁, …, bₙ (degree n = points.length − 1)
 * @returns {{x,y}}        curve point B(t)
 */
function deCasteljau(t, points) {
  // Work on a copy so we don't destroy the input
  let b = points.map(p => ({ x: p.x, y: p.y }));
  const u = 1 - t;

  // Successively reduce the array length by 1 on each pass
  while (b.length > 1) {
    const next = [];
    for (let i = 0; i < b.length - 1; i++) {
      next.push({
        x: u * b[i].x + t * b[i + 1].x,
        y: u * b[i].y + t * b[i + 1].y,
      });
    }
    b = next;
  }

  return b[0];
}


// ──────────────────────────────────────────────────────────────────────────
//  EASING & INTERPOLATION  (for shape morphing — Section 3 of the lab spec)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Smoothstep ease-in-out, per the project spec.
 *   t < 0.5  →  2t²
 *   t ≥ 0.5  → −1 + (4 − 2t)·t
 * Produces zero velocity at the endpoints, eliminating abrupt motion.
 */
function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

/** Linear interpolation between scalars. */
function lerp(a, b, t) { return a + (b - a) * t; }

/** Linear interpolation between 2-D points. */
function lerpPoint(p1, p2, t) {
  return { x: lerp(p1.x, p2.x, t), y: lerp(p1.y, p2.y, t) };
}

/**
 * Interpolate every corresponding control point between two shapes.
 * Implements the core morphing math from the lab spec (Section 1).
 *
 * Both shapes MUST have identical point counts AND identical index
 * ordering — the responsibility of the shape-creation pipeline.
 *
 * @param {Array<{x,y}>} A   source shape (length = 3N)
 * @param {Array<{x,y}>} B   target shape (length = 3N)
 * @param {number} t          parameter in [0, 1]; ease-in-out is applied
 * @returns {Array<{x,y}>}    interpolated shape, same length
 */
function interpolateShapes(A, B, t) {
  const e = easeInOut(t);
  return A.map((p, i) => lerpPoint(p, B[i], e));
}


// ──────────────────────────────────────────────────────────────────────────
//  UTILITY — sample N points along a cubic segment
//  Used for the alternate "manual" rendering paths (Bernstein/matrix/de
//  Casteljau) so users can visually confirm all three forms produce the
//  it provide some curve
// ──────────────────────────────────────────────────────────────────────────

/**
 * Generate a poly-line approximation of a cubic Bézier segment by sampling.
 *
 * @param {{x,y}} P0   start anchor
 * @param {{x,y}} P1   first handle
 * @param {{x,y}} P2   second handle
 * @param {{x,y}} P3   end anchor
 * @param {number} steps   number of samples (default 24)
 * @param {Function} evalFn   evaluation function — defaults to Bernstein
 * @returns {Array<{x,y}>}    sampled poly-line points
 */
function sampleCubic(P0, P1, P2, P3, steps = 24, evalFn = cubicBezierBernstein) {
  const out = [];
  for (let i = 0; i <= steps; i++) {
    out.push(evalFn(i / steps, P0, P1, P2, P3));
  }
  return out;
}
